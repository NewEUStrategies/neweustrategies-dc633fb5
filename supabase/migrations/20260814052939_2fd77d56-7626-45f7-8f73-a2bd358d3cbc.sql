-- CV kandydatów: prywatny bucket, zapis dozwolony dla anonimowych (formularz
-- publiczny), odczyt tylko dla personelu przez podpisane URL-e.
CREATE POLICY "career_cv_public_upload"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id = 'career-cv' AND (storage.foldername(name))[1] = 'uploads');

CREATE POLICY "career_cv_staff_read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'career-cv' AND public.is_staff());

CREATE POLICY "career_cv_staff_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'career-cv' AND public.is_staff());