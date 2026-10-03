-- pgTAP: referencja `contact_messages.custom ->> 'cv_path'` NIE nadaje prawa do
-- pliku CV innego najemcy (migracja 20261003120000).
--
-- LUKA. Polityki `career_cv_staff_read` / `_staff_delete` z 20260824074231
-- miały gałąź `OR EXISTS (zgłoszenie MOJEGO najemcy z cv_path = name)` bez
-- ograniczenia do plików legacy. Wiersz najemcy A z `cv_path` wskazującym
-- katalog B otwierał personelowi A odczyt (podpisany URL) i usunięcie CV
-- kandydata B. Taki wiersz powstawał sfałszowanym zgłoszeniem publicznym
-- (service_role, `submitContact`) albo wprost z panelu - personel ma UPDATE na
-- `contact_messages` własnego najemcy.
--
-- Ten plik stoi na PEŁNYM schemacie, więc - w odróżnieniu od harnessu
-- `scripts/careers-harness` - dowodzi drogi panelu przez PRAWDZIWĄ politykę
-- "Admins and editors can update contact messages".
--
-- Wiersze-fałszywki zakładamy z WYŁĄCZONYM strażnikiem: tak wygląda stan
-- zastany sprzed migracji, a polityki i GC muszą być odporne także na niego.

BEGIN;
SELECT plan(18);

-- == (1) Struktura ============================================================
SELECT ok(
  (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'career_cv_staff_read')
    ~ 'career_cv_object_owner\(name\) = current_tenant_id\(\)'
  AND (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'career_cv_staff_read')
    !~ '(contact_messages| OR )',
  'career_cv_staff_read: wylacznie wlasciciel obiektu = current_tenant_id(), bez galezi OR po referencji'
);

SELECT ok(
  (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'career_cv_staff_delete')
    ~ 'career_cv_object_owner\(name\) = current_tenant_id\(\)'
  AND (SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'career_cv_staff_delete')
    !~ '(contact_messages| OR )',
  'career_cv_staff_delete: wylacznie wlasciciel obiektu = current_tenant_id(), bez galezi OR po referencji'
);

SELECT has_trigger(
  'public', 'contact_messages', 'trg_contact_messages_career_cv_path_guard',
  'straznik referencji CV stoi na contact_messages'
);

SELECT ok(
  to_regclass('public.contact_messages_cv_path_lookup_idx') IS NOT NULL
  AND to_regclass('public.contact_messages_cv_path_idx') IS NULL,
  'indeks po samej sciezce zastapil nieuzywany indeks (tenant_id, cv_path)'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.career_cv_object_owner(text)', 'EXECUTE'),
  'anonim nie odpyta wlasciciela pliku CV (funkcja SECURITY DEFINER)'
);

-- == Seed: dwaj najemcy, admin po kazdej stronie ==============================
ALTER TABLE auth.users DISABLE TRIGGER USER;
-- storage-api >= 0055 blokuje KAZDY DELETE na storage.objects, o ile nie
-- ustawiono tego GUC (patrz tenant_isolation_three_tenants_test.sql).
SELECT set_config('storage.allow_delete_query', 'true', true);

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('ea111111-1111-1111-1111-111111111111', 'cvref-a', 'CV ref A', 'cvref-a.example'),
  ('eb222222-2222-2222-2222-222222222222', 'cvref-b', 'CV ref B', 'cvref-b.example');

INSERT INTO auth.users (id, email) VALUES
  ('ea000000-0000-0000-0000-000000000001', 'admin@cvref-a.example'),
  ('eb000000-0000-0000-0000-000000000001', 'admin@cvref-b.example');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('ea000000-0000-0000-0000-000000000001', 'admin@cvref-a.example', 'Admin A',
   'ea111111-1111-1111-1111-111111111111'),
  ('eb000000-0000-0000-0000-000000000001', 'admin@cvref-b.example', 'Admin B',
   'eb222222-2222-2222-2222-222222222222');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('ea000000-0000-0000-0000-000000000001', 'admin', 'ea111111-1111-1111-1111-111111111111'),
  ('eb000000-0000-0000-0000-000000000001', 'admin', 'eb222222-2222-2222-2222-222222222222');

INSERT INTO storage.objects (bucket_id, name) VALUES
  ('career-cv', 'eb222222-2222-2222-2222-222222222222/uploads/2026-05-05/bbbb2222-1111-2222-3333-444444444444.pdf'),
  ('career-cv', 'uploads/2026-05-05/aaaa1111-1111-2222-3333-444444444444.pdf');

-- Zgloszenie B z WLASNYM plikiem przechodzi przez straznika; zgloszenie A bez
-- pliku jest celem UPDATE-u panelu w sekcji (3).
INSERT INTO public.contact_messages (id, tenant_id, name, email, message, form_id, custom)
VALUES
  ('ec000000-0000-0000-0000-0000000000b1', 'eb222222-2222-2222-2222-222222222222',
   'Kandydat B', 'kandydat-b@example.org', 'Zgloszenie u najemcy B.', 'careers',
   jsonb_build_object('cv_path',
     'eb222222-2222-2222-2222-222222222222/uploads/2026-05-05/bbbb2222-1111-2222-3333-444444444444.pdf')),
  ('ec000000-0000-0000-0000-0000000000a3', 'ea111111-1111-1111-1111-111111111111',
   'Kandydat A2', 'kandydat-a2@example.com', 'Zgloszenie z linkiem.', 'careers',
   jsonb_build_object('cv_url', 'https://cv.example.com/a2'));

ALTER TABLE public.contact_messages DISABLE TRIGGER trg_contact_messages_career_cv_path_guard;
INSERT INTO public.contact_messages (id, tenant_id, name, email, message, form_id, custom, created_at)
VALUES
  -- Zastane zgloszenie legacy najemcy A - WLASCICIEL pliku legacy.
  ('ec000000-0000-0000-0000-0000000000a1', 'ea111111-1111-1111-1111-111111111111',
   'Kandydat A', 'kandydat-a@example.com', 'Stare zgloszenie u najemcy A.', 'careers',
   jsonb_build_object('cv_path', 'uploads/2026-05-05/aaaa1111-1111-2222-3333-444444444444.pdf'),
   now() - interval '300 days'),
  -- Falszywka w A: wskazuje plik w katalogu B.
  ('ec000000-0000-0000-0000-0000000000a2', 'ea111111-1111-1111-1111-111111111111',
   'Falszerz A', 'falszerz-a@example.com', 'Podrzucona referencja.', 'careers',
   jsonb_build_object('cv_path',
     'eb222222-2222-2222-2222-222222222222/uploads/2026-05-05/bbbb2222-1111-2222-3333-444444444444.pdf'),
   now()),
  -- Falszywka w B: POZNIEJSZA referencja do pliku legacy A.
  ('ec000000-0000-0000-0000-0000000000b2', 'eb222222-2222-2222-2222-222222222222',
   'Falszerz B', 'falszerz-b@example.org', 'Podrzucona referencja legacy.', 'careers',
   jsonb_build_object('cv_path', 'uploads/2026-05-05/aaaa1111-1111-2222-3333-444444444444.pdf'),
   now());
ALTER TABLE public.contact_messages ENABLE TRIGGER trg_contact_messages_career_cv_path_guard;

-- == (2) Wlasciciel obiektu wynika z obiektu, nie z referencji ================
SELECT is(
  public.career_cv_object_owner(
    'eb222222-2222-2222-2222-222222222222/uploads/2026-05-05/bbbb2222-1111-2222-3333-444444444444.pdf'),
  'eb222222-2222-2222-2222-222222222222'::uuid,
  'plik z tenantem w sciezce nalezy do tenanta ze sciezki, mimo referencji w A'
);

SELECT is(
  public.career_cv_object_owner('uploads/2026-05-05/aaaa1111-1111-2222-3333-444444444444.pdf'),
  'ea111111-1111-1111-1111-111111111111'::uuid,
  'plik legacy nalezy do najemcy NAJWCZESNIEJSZEJ referencji (A), nie pozniejszej (B)'
);

-- == (3) Administrator najemcy A =============================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"ea000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT ok(
  public.is_admin_or_editor(),
  'admin A spelnia is_admin_or_editor() - odmowy nizej sa wylacznie kwestia najemcy'
);

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'career-cv'
      AND name = 'uploads/2026-05-05/aaaa1111-1111-2222-3333-444444444444.pdf'),
  1,
  'admin A widzi WLASNY plik legacy (dowod niepustki)'
);

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'career-cv'
      AND name LIKE 'eb222222-2222-2222-2222-222222222222/%'),
  0,
  'admin A z podrzucona referencja NIE widzi CV najemcy B (brak SELECT-a = brak signed URL)'
);

WITH del AS (
  DELETE FROM storage.objects
   WHERE bucket_id = 'career-cv'
     AND name = 'eb222222-2222-2222-2222-222222222222/uploads/2026-05-05/bbbb2222-1111-2222-3333-444444444444.pdf'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM del), 0,
  'admin A z podrzucona referencja NIE usunie CV najemcy B');

-- Droga panelu: UPDATE `custom` przez PRAWDZIWA polityke UPDATE.
SELECT throws_ok(
  $$UPDATE public.contact_messages
       SET custom = custom || jsonb_build_object('cv_path',
         'eb222222-2222-2222-2222-222222222222/uploads/2026-05-05/bbbb2222-1111-2222-3333-444444444444.pdf')
     WHERE id = 'ec000000-0000-0000-0000-0000000000a1'$$,
  '23514', 'career_cv_path_foreign_tenant',
  'panel: admin A nie wpisze do zgloszenia sciezki z katalogu B'
);

SELECT lives_ok(
  $$UPDATE public.contact_messages SET status = 'read'
     WHERE id = 'ec000000-0000-0000-0000-0000000000a1'$$,
  'panel: UPDATE zastanego wiersza legacy, ktory nie rusza sciezki, przechodzi'
);

SELECT lives_ok(
  $$UPDATE public.contact_messages
       SET custom = custom || jsonb_build_object('cv_path',
         'ea111111-1111-1111-1111-111111111111/uploads/2026-05-06/aaaa3333-1111-2222-3333-444444444444.pdf')
     WHERE id = 'ec000000-0000-0000-0000-0000000000a3'$$,
  'panel: sciezka w katalogu WLASNEGO najemcy przechodzi przez straznika'
);

-- == (4) Administrator najemcy B ==============================================
SELECT set_config('request.jwt.claims',
  '{"sub":"eb000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'career-cv'
      AND name LIKE 'eb222222-2222-2222-2222-222222222222/%'),
  1,
  'admin B widzi WLASNE CV (dowod niepustki - plik przetrwal probe usuniecia z A)'
);

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'career-cv'
      AND name = 'uploads/2026-05-05/aaaa1111-1111-2222-3333-444444444444.pdf'),
  0,
  'admin B z POZNIEJSZA referencja legacy NIE widzi pliku najemcy A'
);

RESET ROLE;

-- == (5) Zapis publiczny (service_role) i GC ================================
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$INSERT INTO public.contact_messages (tenant_id, name, email, message, form_id, custom)
    VALUES ('ea111111-1111-1111-1111-111111111111', 'Falszerz', 'f@example.com', 'x', 'careers',
      jsonb_build_object('cv_path',
        'eb222222-2222-2222-2222-222222222222/uploads/2026-05-05/bbbb2222-1111-2222-3333-444444444444.pdf'))$$,
  '23514', 'career_cv_path_foreign_tenant',
  'zapis publiczny (service_role): zgloszenie A ze sciezka w katalogu B odrzucone przez baze'
);
RESET ROLE;

DELETE FROM public.contact_messages WHERE id = 'ec000000-0000-0000-0000-0000000000a2';
SELECT is(
  (SELECT count(*)::int FROM public.career_cv_gc_queue
    WHERE path = 'eb222222-2222-2222-2222-222222222222/uploads/2026-05-05/bbbb2222-1111-2222-3333-444444444444.pdf'),
  0,
  'usuniecie podrzuconego zgloszenia w A NIE kolejkuje CV najemcy B do trwalego usuniecia'
);

SELECT * FROM finish();
ROLLBACK;
