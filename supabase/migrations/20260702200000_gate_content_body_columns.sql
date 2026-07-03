-- Enforce the server-side paywall at the PRIVILEGE layer, not just by convention.
--
-- Problem: get_entity_content() (20260625190000) was introduced as the single
-- gated path for post/page bodies, but the body columns themselves stayed
-- directly readable. A table-wide `GRANT SELECT ON posts/pages TO anon,
-- authenticated` (20260531180217) was never narrowed, and in PostgreSQL a
-- table-level SELECT satisfies the access check for EVERY column. So any caller
-- could read content_pl/en, builder_data and blocks_data straight from
-- PostgREST (e.g. `?select=content_pl&status=eq.published`), bypassing
-- has_content_access entirely - anon for members+paid rows, and any signed-in
-- free account for paid rows. get_entity_content was therefore merely the
-- "polite" path (fetchNextPost + the homepage query read the columns directly).
--
-- This is the same bug already fixed for profiles.email in 20260627150000: the
-- only correct fix is to drop the table-wide SELECT and re-grant it on just the
-- non-body columns. The re-grant is computed from the live column list so the
-- allow-list cannot silently drift from the schema; any column added later is
-- NOT auto-exposed (fail-closed) and must be granted explicitly, exactly as the
-- body columns are withheld here.
--
-- After this migration the body columns are readable only via SECURITY DEFINER
-- functions that bypass the column ACL:
--   * readers / SSR         -> get_entity_content()  (entitlement-gated)
--   * staff editors (client)-> get_post_for_edit() / get_page_for_edit() (below)
--   * server functions      -> service_role (untouched, keeps full access)

DO $$
DECLARE
  v_cols text;
BEGIN
  -- posts: re-grant SELECT on every column EXCEPT the gated body columns.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'posts'
     AND column_name NOT IN ('content_pl', 'content_en', 'builder_data', 'blocks_data');
  REVOKE SELECT ON public.posts FROM anon, authenticated;
  EXECUTE format('GRANT SELECT (%s) ON public.posts TO anon, authenticated', v_cols);

  -- pages: same, but pages have no blocks_data column.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'pages'
     AND column_name NOT IN ('content_pl', 'content_en', 'builder_data');
  REVOKE SELECT ON public.pages FROM anon, authenticated;
  EXECUTE format('GRANT SELECT (%s) ON public.pages TO anon, authenticated', v_cols);
END $$;

-- Staff editor read path. The admin editors load the FULL row (incl. body) to
-- populate the edit form, running as the caller's `authenticated` role, which
-- no longer has column SELECT on the body. These SECURITY DEFINER helpers
-- return the row (drafts included) only to a staff member of the row's OWN
-- tenant, re-enforcing staff + tenant themselves (defence in depth, like
-- get_entity_content). slug is unique per tenant, so at most one row.

CREATE OR REPLACE FUNCTION public.get_post_for_edit(_slug text)
RETURNS SETOF public.posts
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF NOT public.is_staff() THEN
    RETURN;
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.*
      FROM public.posts p
     WHERE p.slug = _slug
       AND p.tenant_id = v_tenant
       AND p.deleted_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.get_post_for_edit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_post_for_edit(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_page_for_edit(_slug text)
RETURNS SETOF public.pages
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF NOT public.is_staff() THEN
    RETURN;
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT pg.*
      FROM public.pages pg
     WHERE pg.slug = _slug
       AND pg.tenant_id = v_tenant
       AND pg.deleted_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.get_page_for_edit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_page_for_edit(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_post_for_edit(text) IS
  'Staff-only (is_staff + own tenant) full post row incl. gated body columns, '
  'for the admin editor after body columns were revoked from the authenticated '
  'role. SECURITY DEFINER; re-enforces staff + tenant.';
COMMENT ON FUNCTION public.get_page_for_edit(text) IS
  'Staff-only (is_staff + own tenant) full page row incl. gated body columns, '
  'for the admin editor after body columns were revoked from the authenticated '
  'role. SECURITY DEFINER; re-enforces staff + tenant.';
