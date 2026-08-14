ALTER TABLE public.career_roles ADD COLUMN IF NOT EXISTS tenant_id uuid;

UPDATE public.career_roles
   SET tenant_id = COALESCE(
     (SELECT id FROM public.tenants WHERE is_default LIMIT 1),
     (SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1)
   )
 WHERE tenant_id IS NULL;

DELETE FROM public.career_roles WHERE tenant_id IS NULL;

ALTER TABLE public.career_roles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.career_roles
  ALTER COLUMN tenant_id SET DEFAULT public.public_tenant_id();

ALTER TABLE public.career_roles DROP CONSTRAINT IF EXISTS career_roles_tenant_id_fkey;
ALTER TABLE public.career_roles ADD CONSTRAINT career_roles_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.career_roles DROP CONSTRAINT IF EXISTS career_roles_slug_key;
DROP INDEX IF EXISTS public.career_roles_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS career_roles_tenant_slug_key
  ON public.career_roles (tenant_id, slug);

DROP INDEX IF EXISTS public.career_roles_sort_idx;
CREATE INDEX IF NOT EXISTS career_roles_tenant_sort_idx
  ON public.career_roles (tenant_id, sort_order, created_at);

DROP POLICY IF EXISTS career_roles_public_read ON public.career_roles;
CREATE POLICY career_roles_public_read ON public.career_roles
  FOR SELECT TO anon, authenticated
  USING (is_published AND tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS career_roles_staff_read ON public.career_roles;
CREATE POLICY career_roles_staff_read ON public.career_roles
  FOR SELECT TO authenticated
  USING (public.is_staff() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS career_roles_staff_write ON public.career_roles;
CREATE POLICY career_roles_staff_write ON public.career_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS career_roles_staff_update ON public.career_roles;
CREATE POLICY career_roles_staff_update ON public.career_roles
  FOR UPDATE TO authenticated
  USING (public.is_staff() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_staff() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS career_roles_staff_delete ON public.career_roles;
CREATE POLICY career_roles_staff_delete ON public.career_roles
  FOR DELETE TO authenticated
  USING (public.is_staff() AND tenant_id = public.current_tenant_id());

ALTER TABLE public.career_page_sections ADD COLUMN IF NOT EXISTS tenant_id uuid;

UPDATE public.career_page_sections
   SET tenant_id = COALESCE(
     (SELECT id FROM public.tenants WHERE is_default LIMIT 1),
     (SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1)
   )
 WHERE tenant_id IS NULL;

DELETE FROM public.career_page_sections WHERE tenant_id IS NULL;

ALTER TABLE public.career_page_sections ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.career_page_sections
  ALTER COLUMN tenant_id SET DEFAULT public.public_tenant_id();

ALTER TABLE public.career_page_sections
  DROP CONSTRAINT IF EXISTS career_page_sections_tenant_id_fkey;
ALTER TABLE public.career_page_sections ADD CONSTRAINT career_page_sections_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.career_page_sections DROP CONSTRAINT IF EXISTS career_page_sections_pkey;
ALTER TABLE public.career_page_sections ADD CONSTRAINT career_page_sections_pkey
  PRIMARY KEY (tenant_id, key);

DROP POLICY IF EXISTS career_sections_public_read ON public.career_page_sections;
CREATE POLICY career_sections_public_read ON public.career_page_sections
  FOR SELECT TO anon, authenticated
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS career_sections_staff_read ON public.career_page_sections;
CREATE POLICY career_sections_staff_read ON public.career_page_sections
  FOR SELECT TO authenticated
  USING (public.is_staff() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS career_sections_staff_write ON public.career_page_sections;
CREATE POLICY career_sections_staff_write ON public.career_page_sections
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS career_sections_staff_update ON public.career_page_sections;
CREATE POLICY career_sections_staff_update ON public.career_page_sections
  FOR UPDATE TO authenticated
  USING (public.is_staff() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_staff() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS career_sections_staff_delete ON public.career_page_sections;
CREATE POLICY career_sections_staff_delete ON public.career_page_sections
  FOR DELETE TO authenticated
  USING (public.is_staff() AND tenant_id = public.current_tenant_id());

CREATE INDEX IF NOT EXISTS contact_messages_cv_path_idx
  ON public.contact_messages (tenant_id, (custom ->> 'cv_path'))
  WHERE custom ? 'cv_path';

DROP POLICY IF EXISTS "career_cv_public_upload" ON storage.objects;
CREATE POLICY "career_cv_public_upload"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'career-cv'
  AND array_length(storage.foldername(name), 1) = 3
  AND (storage.foldername(name))[1] = public.public_tenant_id()::text
  AND (storage.foldername(name))[2] = 'uploads'
);

DROP POLICY IF EXISTS "career_cv_staff_read" ON storage.objects;
CREATE POLICY "career_cv_staff_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'career-cv'
  AND public.is_staff()
  AND (
    (storage.foldername(name))[1] = public.current_tenant_id()::text
    OR EXISTS (
      SELECT 1
        FROM public.contact_messages m
       WHERE m.tenant_id = public.current_tenant_id()
         AND m.custom ->> 'cv_path' = storage.objects.name
    )
  )
);

DROP POLICY IF EXISTS "career_cv_staff_delete" ON storage.objects;
CREATE POLICY "career_cv_staff_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'career-cv'
  AND public.is_staff()
  AND (
    (storage.foldername(name))[1] = public.current_tenant_id()::text
    OR EXISTS (
      SELECT 1
        FROM public.contact_messages m
       WHERE m.tenant_id = public.current_tenant_id()
         AND m.custom ->> 'cv_path' = storage.objects.name
    )
  )
);

COMMENT ON INDEX public.contact_messages_cv_path_idx IS
  'Bramka legacy w politykach bucketu career-cv: prawo do pliku sprzed konwencji <tenant>/uploads/ wynika z referencji w zgloszeniu tego samego najemcy.';