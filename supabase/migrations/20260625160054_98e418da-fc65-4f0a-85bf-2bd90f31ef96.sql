
-- 1) Helper: stable public tenant id (seed tenant 'nes')
CREATE OR REPLACE FUNCTION public.public_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.public_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_tenant_id() TO anon, authenticated, service_role;

-- 2) Tighten has_role to scope strictly to the active tenant
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles ur
     WHERE ur.user_id = _user_id
       AND ur.role    = _role
       AND ur.tenant_id = public.current_tenant_id()
  )
$$;

-- 3) Pages: scope public reads to the public tenant
DROP POLICY IF EXISTS "Public reads published pages" ON public.pages;
CREATE POLICY "Public reads published pages"
  ON public.pages
  FOR SELECT
  TO anon, authenticated
  USING (
    status = 'published'::post_status
    AND deleted_at IS NULL
    AND tenant_id = public.public_tenant_id()
  );

-- 4) Posts: scope public reads to the public tenant
DROP POLICY IF EXISTS "Public reads published posts" ON public.posts;
CREATE POLICY "Public reads published posts"
  ON public.posts
  FOR SELECT
  TO anon, authenticated
  USING (
    status = 'published'::post_status
    AND deleted_at IS NULL
    AND tenant_id = public.public_tenant_id()
  );

-- 5) post_views: remove public SELECT entirely; writes via record_post_view (SECURITY DEFINER)
DROP POLICY IF EXISTS "post_views public read" ON public.post_views;
-- service-role write policy is kept; aggregate reads happen via trending_posts()

-- 6) profiles: hide email from anon while keeping public display fields
DROP POLICY IF EXISTS "Profiles public read" ON public.profiles;

-- Anonymous: may read profile rows but never the email column
CREATE POLICY "Profiles anon public read"
  ON public.profiles
  FOR SELECT
  TO anon
  USING (true);

-- Signed-in users: read own row, same-tenant authors, or admins of the tenant
CREATE POLICY "Profiles authenticated read"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR tenant_id = public.current_tenant_id()
  );

REVOKE SELECT (email) ON public.profiles FROM anon;

-- 7) Lock down SECURITY DEFINER functions that should not be callable directly
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.snapshot_builder_template() FROM PUBLIC, anon, authenticated;
