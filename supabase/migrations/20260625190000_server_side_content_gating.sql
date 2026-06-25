-- Server-side paywall / content gating.
--
-- Problem: RLS on posts/pages is row-level ("public reads published"), so the
-- public anon role can read the full body (content_pl/en, builder_data,
-- blocks_data) of every published row regardless of any content_access rule.
-- The paywall was therefore client-side only and trivially bypassable by
-- reading the network payload or the DOM.
--
-- Fix: route the heavy/sensitive content columns through a SECURITY DEFINER
-- function that returns them ONLY when the caller satisfies has_content_access.
-- The public queries stop selecting those columns directly and call this RPC
-- instead. Because the function is SECURITY DEFINER it bypasses RLS, so it
-- re-enforces tenant + published + not-deleted itself (defence in depth) and
-- never exposes drafts or other tenants' rows.

CREATE OR REPLACE FUNCTION public.get_entity_content(
  _entity_type access_entity_type,
  _entity_id uuid
) RETURNS TABLE (
  content_pl text,
  content_en text,
  builder_data jsonb,
  blocks_data jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
BEGIN
  -- Media has no inline body to return here.
  IF _entity_type = 'media' THEN
    RETURN;
  END IF;

  -- Hard gate: the caller (auth.uid(), evaluated inside has_content_access)
  -- must be entitled. Unentitled callers get zero rows -> null content.
  IF NOT public.has_content_access(_entity_type, _entity_id) THEN
    RETURN;
  END IF;

  IF _entity_type = 'post' THEN
    RETURN QUERY
      SELECT p.content_pl, p.content_en, p.builder_data, p.blocks_data
        FROM public.posts p
       WHERE p.id = _entity_id
         AND p.tenant_id = v_tenant
         AND p.status = 'published'
         AND p.deleted_at IS NULL;
  ELSIF _entity_type = 'page' THEN
    RETURN QUERY
      SELECT pg.content_pl, pg.content_en, pg.builder_data, NULL::jsonb
        FROM public.pages pg
       WHERE pg.id = _entity_id
         AND pg.tenant_id = v_tenant
         AND pg.status = 'published'
         AND pg.deleted_at IS NULL;
  END IF;

  RETURN;
END $$;

REVOKE ALL ON FUNCTION public.get_entity_content(access_entity_type, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_entity_content(access_entity_type, uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_entity_content(access_entity_type, uuid) IS
  'Returns the gated body columns (content_pl/en, builder_data, blocks_data) of a '
  'published post/page only when the caller satisfies has_content_access. '
  'SECURITY DEFINER: re-enforces tenant + published + not-deleted. '
  'Backs the server-side paywall - public queries must read body content via this '
  'RPC rather than selecting the columns directly.';
