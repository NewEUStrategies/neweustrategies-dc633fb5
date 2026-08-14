-- Rekrutacja: izolacja najemców dla treści strony /zatrudniamy i dla plików CV.
--
-- STAN WYJŚCIOWY (20260813224302 / 20260814052939 / 20260814090000):
--   * `career_roles` i `career_page_sections` NIE MIAŁY kolumny `tenant_id`.
--     `slug` był unikalny GLOBALNIE, a `key` był kluczem głównym bez tenanta -
--     więc dwa najemcy nie mogli mieć oferty o tym samym slugu, a każdy admin
--     edytował te same wiersze. Zgłoszenia, które te oferty generują, są od
--     początku scope'owane (`contact_messages.tenant_id`), czyli izolacja
--     pękała dokładnie na treści, a nie na danych kandydatów.
--   * Polityka odczytu bucketu `career-cv` brzmiała `bucket_id = 'career-cv'
--     AND public.is_staff()`. `is_staff()` sprawdza WYŁĄCZNIE rolę, nie tenanta,
--     a ścieżka `uploads/<data>/<uuid>` nie nosiła tenanta - więc redaktor
--     najemcy A mógł podpisać i odczytać KAŻDE CV każdego najemcy.
--
-- KONWENCJA ŚCIEŻKI po tej migracji: `<tenant_id>/uploads/<YYYY-MM-DD>/<uuid>.<ext>`
-- (ten sam wzorzec, co bucket `cv`: `<tenant>/users/<uid>/<plik>`).
--
-- Plików JUŻ WGRANYCH NIE PRZENOSIMY. `storage.objects.name` buduje klucz
-- obiektu w magazynie, więc UPDATE tej kolumny w SQL rozjechałby wiersz z
-- plikiem (wiersz wskazuje nową ścieżkę, magazyn trzyma starą) i CV przestałoby
-- się otwierać. Zamiast tego polityka odczytu dopuszcza starą ścieżkę TYLKO
-- wtedy, gdy zgłoszenie z TEGO tenanta faktycznie się na nią powołuje - czyli
-- legacy jest dalej czytelne, ale już nie dla obcego najemcy.

-- ---------------------------------------------------------------------------
-- A) career_roles: tenant_id + unikalność slugu w obrębie najemcy
-- ---------------------------------------------------------------------------
ALTER TABLE public.career_roles ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- Backfill: dotychczasowa treść należy do najemcy domyślnego (na produkcji to
-- 'nes'). Wybór po fladze/slugu, nie po zaszytym UUID - patrz nauka z
-- 20260801152304, gdzie zaszyty identyfikator wywracał start świeżej bazy.
UPDATE public.career_roles
   SET tenant_id = COALESCE(
     (SELECT id FROM public.tenants WHERE is_default LIMIT 1),
     (SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1)
   )
 WHERE tenant_id IS NULL;

-- Gdyby baza nie miała ANI najemcy domyślnego, ANI 'nes' (świeża instalacja bez
-- seedu), backfill nic nie ustawi i SET NOT NULL by się wywrócił. Taka tabela
-- jest wtedy pusta, więc kasujemy resztki zamiast blokować migrację.
DELETE FROM public.career_roles WHERE tenant_id IS NULL;

ALTER TABLE public.career_roles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.career_roles
  ALTER COLUMN tenant_id SET DEFAULT public.public_tenant_id();

ALTER TABLE public.career_roles DROP CONSTRAINT IF EXISTS career_roles_tenant_id_fkey;
ALTER TABLE public.career_roles ADD CONSTRAINT career_roles_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- `slug text NOT NULL UNIQUE` z CREATE TABLE dało globalny unique - zdejmujemy
-- go i zakładamy parę (tenant_id, slug). Indeks (nie constraint) wystarcza
-- ON CONFLICT-owi PostgREST-a, którego używa import wbudowanych ofert.
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

-- ---------------------------------------------------------------------------
-- B) career_page_sections: tenant_id w kluczu głównym
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- C) Bucket career-cv: ścieżka niesie tenanta, odczyt zawężony do tenanta
-- ---------------------------------------------------------------------------

-- Indeks pod bramkę legacy w polityce odczytu (EXISTS po ścieżce CV). Bez niego
-- każde podpisanie starego linku robiłoby pełny skan `contact_messages`.
CREATE INDEX IF NOT EXISTS contact_messages_cv_path_idx
  ON public.contact_messages (tenant_id, (custom ->> 'cv_path'))
  WHERE custom ? 'cv_path';

-- Zapis: anonim wgrywa z PUBLICZNEJ strony, więc tenant pochodzi z
-- przeglądanego hosta (`public_tenant_id()`), a nie z roli wołającego. Wymuszamy
-- dokładnie trzy segmenty katalogu, żeby nie dało się wgrać poza konwencję.
DROP POLICY IF EXISTS "career_cv_public_upload" ON storage.objects;
CREATE POLICY "career_cv_public_upload"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'career-cv'
  AND array_length(storage.foldername(name), 1) = 3
  AND (storage.foldername(name))[1] = public.public_tenant_id()::text
  AND (storage.foldername(name))[2] = 'uploads'
);

-- Odczyt: personel widzi WYŁĄCZNIE swojego tenanta. Tenant bierzemy z
-- `current_tenant_id()` (tenant DOMOWY wołającego), nie z nagłówka hosta -
-- inaczej admin najemcy A podmieniłby `x-tenant-host` i przeszedł bramkę.
-- Druga gałąź to pliki sprzed zmiany konwencji: ścieżka nie nosi tenanta, więc
-- prawo do niej wynika z istnienia zgłoszenia w tenancie wołającego.
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
