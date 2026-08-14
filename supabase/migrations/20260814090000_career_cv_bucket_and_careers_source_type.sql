-- Rekrutacja (/zatrudniamy): brakujący bucket CV + znacznik źródła leada.
--
-- 1) BUCKET `career-cv` NIGDY NIE ZOSTAŁ UTWORZONY. Migracja 20260814052939
--    dodała wyłącznie polityki `storage.objects` dla bucketu o tym id, ale sam
--    wiersz w `storage.buckets` nie powstał w żadnej migracji. Skutek: każdy
--    upload CV z formularza (`uploadCv` -> supabase.storage.from('career-cv'))
--    wracał z "Bucket not found", kandydat widział `cvUploadFailed`, a ponieważ
--    CV (plik ALBO link) jest twardym wymogiem schematu, ścieżka „załącz plik"
--    była martwa na świeżej bazie i na każdym środowisku bez ręcznej
--    interwencji w dashboardzie.
--
--    Limit i lista MIME są tu jednocześnie EGZEKUCJĄ SERWEROWĄ: walidacja
--    rozmiaru/typu w `validateCvFile` żyje w przeglądarce, a polityka INSERT-u
--    dla `anon` sprawdza tylko prefiks `uploads/`. Bez `file_size_limit` /
--    `allowed_mime_types` publiczny endpoint przyjmowałby dowolny plik dowolnej
--    wielkości. 5 MB = CV_MAX_BYTES z `src/lib/careers/applicationSchema.ts`.
--
-- 2) `source_type` leada: `crm_upsert_from_form` nie ustawia tej kolumny, więc
--    kandydat lądował w CRM z wartością domyślną 'manual' - nieodróżnialny od
--    kontaktu wpisanego ręcznie przez operatora. Dokładamy wartość 'careers'
--    do checku (funkcję zapisu ustawia server-fn), zgodnie ze wzorcem
--    'club_application' z 20260811151703.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'career-cv', 'career-cv', false, 5242880,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Polityki z 20260814052939 były tworzone bez DROP-a, czyli migracja nie
-- przechodziła powtórnego przebiegu (`supabase db reset` po ręcznym hotfiksie).
-- Odtwarzamy je idempotentnie, w kształcie 1:1, żeby zachować konwencję repo.
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
