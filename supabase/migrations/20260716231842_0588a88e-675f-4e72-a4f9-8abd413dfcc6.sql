
-- ============================================================
-- Fix 1: menus / menu_items public read must scope to public tenant
-- ============================================================
DROP POLICY IF EXISTS menus_read_public ON public.menus;
CREATE POLICY menus_read_public ON public.menus
  FOR SELECT
  TO anon, authenticated
  USING (tenant_id = public_tenant_id());

DROP POLICY IF EXISTS menu_items_read_public ON public.menu_items;
CREATE POLICY menu_items_read_public ON public.menu_items
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.menus m
      WHERE m.id = menu_items.menu_id
        AND m.tenant_id = public_tenant_id()
    )
  );

-- ============================================================
-- Fix 2: member-resources storage policies must scope by tenant path prefix
-- Path convention: <tenant_id>/<user_id>/<timestamp>-<filename>
-- ============================================================
DROP POLICY IF EXISTS "member resources staff read" ON storage.objects;
CREATE POLICY "member resources staff read" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'member-resources'
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    AND (storage.foldername(name))[1] = current_tenant_id()::text
  );

DROP POLICY IF EXISTS "member resources staff insert" ON storage.objects;
CREATE POLICY "member resources staff insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'member-resources'
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    AND (storage.foldername(name))[1] = current_tenant_id()::text
  );

DROP POLICY IF EXISTS "member resources staff delete" ON storage.objects;
CREATE POLICY "member resources staff delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'member-resources'
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
    AND (storage.foldername(name))[1] = current_tenant_id()::text
  );

-- ============================================================
-- Fix 3: profiles - lock anon SELECT to public-facing columns only.
-- Column grants already exclude email/phone/contact_email for anon; make
-- the exclusion explicit and future-proof with REVOKE, and re-grant the
-- vetted public-facing column set so schema drift can't silently leak PII.
-- ============================================================
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (
  id, tenant_id, slug, display_name, avatar_url, cover_url,
  bio, bio_pl, bio_en,
  twitter_url, linkedin_url, website_url, facebook_url, instagram_url, spotify_url,
  job_title, current_company, specialization,
  verified_at, created_at, updated_at
) ON public.profiles TO anon;
