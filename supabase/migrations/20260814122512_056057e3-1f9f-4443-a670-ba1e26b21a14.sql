-- Rekrutacja (/zatrudniamy): polityki bucketu CV + znacznik źródła leada.
-- (Wiersz bucketu `career-cv` istnieje już w storage.buckets - zakładany przez
-- narzędzie magazynu, nie przez SQL.)
DROP POLICY IF EXISTS "career_cv_public_upload" ON storage.objects;
CREATE POLICY "career_cv_public_upload"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id = 'career-cv' AND (storage.foldername(name))[1] = 'uploads');

DROP POLICY IF EXISTS "career_cv_staff_read" ON storage.objects;
CREATE POLICY "career_cv_staff_read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'career-cv' AND public.is_staff());

DROP POLICY IF EXISTS "career_cv_staff_delete" ON storage.objects;
CREATE POLICY "career_cv_staff_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'career-cv' AND public.is_staff());

ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_source_type_check;
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_source_type_check
  CHECK (source_type IN ('registered','paid_subscriber','event_participant',
    'speaker','expert','contact_form','newsletter','manual','club_application',
    'careers'));