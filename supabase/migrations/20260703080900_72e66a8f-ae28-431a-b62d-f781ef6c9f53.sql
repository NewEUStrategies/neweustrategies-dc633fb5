-- ============================================================================
-- PR #41: Multi-tenant security audit (re-audit N1, N2, N4, N6)
-- Migracje: 20260703120000 .. 20260703120300
-- ============================================================================

CREATE OR REPLACE FUNCTION public.request_public_host()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH raw AS (
    SELECT lower(trim(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-tenant-host'
    )) AS h
  )
  SELECT CASE
           WHEN h IS NULL OR h = '' THEN NULL
           WHEN h ~ '^\[' THEN (regexp_match(h, '^\[([^\]]+)\]'))[1]
           ELSE nullif(split_part(h, ':', 1), '')
         END
    FROM raw
$$;

REVOKE ALL ON FUNCTION public.request_public_host() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_public_host()
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.request_public_host() IS
  'Normalized site host (lowercase, no port/brackets) taken from the '
  'x-tenant-host request header set by the app''s Supabase clients. NULL when '
  'the header is absent or the call is not going through PostgREST. Input of '
  'public_tenant_id() - the host -> tenant switch of the anon content plane.';

CREATE OR REPLACE FUNCTION public.public_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH req AS (SELECT public.request_public_host() AS host)
  SELECT COALESCE(
    (SELECT t.id
       FROM public.tenants t, req r
      WHERE r.host IS NOT NULL
        AND lower(t.domain) IN (
              r.host,
              CASE WHEN r.host LIKE 'www.%'
                   THEN substr(r.host, 5)
                   ELSE 'www.' || r.host END
            )
      ORDER BY (lower(t.domain) = r.host) DESC
      LIMIT 1),
    (SELECT id FROM public.tenants WHERE is_default LIMIT 1),
    (SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1)
  )
$$;

REVOKE ALL ON FUNCTION public.public_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_tenant_id()
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.public_tenant_id() IS
  'Tenant of the site the caller is browsing: x-tenant-host header -> '
  'tenants.domain (www./apex aliased), else the default tenant '
  '(tenants.is_default), else the legacy seed (slug ''nes''). Every anon RLS '
  'policy and DEFAULT tenant_id on public-facing tables goes through this '
  'function, which is what makes the whole anon content plane host-aware.';

-- ---------------------------------------------------------------------------
-- trending_posts tenant-scoped
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trending_posts(_days int DEFAULT 7, _limit int DEFAULT 10)
RETURNS TABLE (
  id uuid, slug text, title_pl text, title_en text,
  cover_image_url text, published_at timestamptz,
  parent_page_id uuid, views_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.slug, p.title_pl, p.title_en,
         p.cover_image_url, p.published_at, p.parent_page_id,
         count(v.id) AS views_count
    FROM public.posts p
    JOIN public.post_views v ON v.post_id = p.id
   WHERE p.status = 'published'
     AND p.deleted_at IS NULL
     AND p.tenant_id = public.public_tenant_id()
     AND v.viewed_at > now() - make_interval(days => GREATEST(_days, 1))
   GROUP BY p.id
   ORDER BY views_count DESC, p.published_at DESC NULLS LAST
   LIMIT GREATEST(LEAST(_limit, 50), 1);
$$;

REVOKE ALL ON FUNCTION public.trending_posts(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trending_posts(int, int)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.trending_posts(int, int) IS
  'Top published posts of the CURRENT PUBLIC TENANT (host-aware '
  'public_tenant_id) by post_views count over the last _days, capped at '
  '_limit (hard max 50). SECURITY DEFINER: re-enforces tenant + published + '
  'not-deleted itself, exactly like popular_post_ids. Backs the header '
  '"Trending" ticker.';

-- ---------------------------------------------------------------------------
-- handle_new_user: default = reader, close self-provisioned admin path
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_default_tenant uuid;
  v_tenant_id uuid;
  v_slug text;
  v_first_in_default boolean;
  v_app_signup text;
  v_user_signup text;
  v_role app_role;
BEGIN
  v_app_signup  := NEW.raw_app_meta_data->>'signup_type';
  v_user_signup := NEW.raw_user_meta_data->>'signup_type';

  SELECT COALESCE(
    (SELECT id FROM public.tenants WHERE is_default LIMIT 1),
    (SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1)
  ) INTO v_default_tenant;
  IF v_default_tenant IS NULL THEN
    RAISE EXCEPTION 'handle_new_user: no default tenant configured';
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE tenant_id = v_default_tenant
  ) INTO v_first_in_default;

  IF COALESCE(v_app_signup, v_user_signup) = 'reader' THEN
    v_tenant_id := v_default_tenant;
    v_role := 'user';
  ELSIF v_app_signup = 'staff' THEN
    v_slug := lower(regexp_replace(
      coalesce(NEW.raw_app_meta_data->>'tenant_slug',
               NEW.raw_user_meta_data->>'tenant_slug',
               split_part(NEW.email, '@', 2),
               split_part(NEW.email, '@', 1)),
      '[^a-z0-9]+', '-', 'g'));
    IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_slug) THEN
      v_slug := v_slug || '-' || substr(NEW.id::text, 1, 8);
    END IF;
    INSERT INTO public.tenants (slug, name)
    VALUES (v_slug,
      coalesce(NEW.raw_app_meta_data->>'tenant_name',
               NEW.raw_user_meta_data->>'tenant_name',
               NEW.raw_user_meta_data->>'display_name',
               split_part(NEW.email, '@', 1)))
    RETURNING id INTO v_tenant_id;
    v_role := 'admin';
  ELSIF v_first_in_default THEN
    v_tenant_id := v_default_tenant;
    v_role := 'admin';
  ELSE
    v_tenant_id := v_default_tenant;
    v_role := 'user';
  END IF;

  INSERT INTO public.profiles (id, email, display_name, tenant_id)
  VALUES (NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    v_tenant_id);

  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (NEW.id, v_role, v_tenant_id);

  RETURN NEW;
END $function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.handle_new_user() IS
  'auth.users AFTER INSERT provisioning. Default: reader (''user'' role) in '
  'the default tenant. Tenant creation + admin only via '
  'raw_app_meta_data.signup_type=''staff'' (service-role provisioning) or the '
  'first-account bootstrap of the default tenant. Client-controlled '
  'raw_user_meta_data can only choose ''reader'', never escalate.';

-- ---------------------------------------------------------------------------
-- tenants: column-scoped UPDATE
-- ---------------------------------------------------------------------------

REVOKE UPDATE ON public.tenants FROM anon, authenticated;
GRANT UPDATE (name) ON public.tenants TO authenticated;

COMMENT ON TABLE public.tenants IS
  'Tenant directory. UPDATE for authenticated is column-scoped (name only) - '
  'the RLS policy "Admins update own tenant" limits WHICH row, the column '
  'grant limits WHAT can change. slug/domain/is_default are service-role-only '
  '(domain + is_default drive host -> tenant routing).';