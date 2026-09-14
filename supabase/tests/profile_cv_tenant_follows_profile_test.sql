-- pgTAP: biografia zawodowa podąża za profilem przy przeniesieniu konta
-- (migracja 20260914160000).
--
-- Klasa błędu. Sześć tabel CV ma DOKŁADNIE JEDNĄ politykę właściciela, FOR ALL,
-- z `tenant_id = current_tenant_id()` w USING. `current_tenant_id()` czyta
-- najemca z AKTUALNEGO profilu, a wiersze CV noszą najemcę z chwili zapisania
-- i nikt ich nie przepinał. Po przeniesieniu konta - legalnym dla roli
-- serwerowej, bo `profiles_pin_tenant_id` zwalnia `is_service_role_caller()` -
-- warunek przestawał być spełniony dla wszystkich wierszy naraz i człowiekowi
-- znikała cała biografia: niewidoczna, nieedytowalna, niekasowalna, mimo że
-- wiersze leżą w bazie nietknięte.
--
-- Ten plik przybija OBIE strony kontraktu: że polityki nadal wiążą najemcę
-- (izolacja się nie rozluźniła) i że przeniesienie konta nie odcina
-- właściciela od jego własnych danych.
--
-- Bliźniacze pliki tej samej klasy: push_and_digest_test.sql (sekcja 6),
-- author_profiles_owner_tenant_scope_test.sql (asercje 18-19).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(9);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('cf111111-1111-1111-1111-111111111111', 'cv-tenant-a', 'CV Tenant A'),
  ('cf222222-2222-2222-2222-222222222222', 'cv-tenant-b', 'CV Tenant B');

INSERT INTO auth.users (id, email) VALUES
  ('cf000000-0000-0000-0000-0000000000a1', 'cv-owner@cv.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('cf000000-0000-0000-0000-0000000000a1', 'cv-owner@cv.test', 'CV Owner',
   'cf111111-1111-1111-1111-111111111111');

INSERT INTO public.profile_skills (user_id, tenant_id, label) VALUES
  ('cf000000-0000-0000-0000-0000000000a1', 'cf111111-1111-1111-1111-111111111111', 'Analiza polityk');
INSERT INTO public.profile_education (user_id, tenant_id, school) VALUES
  ('cf000000-0000-0000-0000-0000000000a1', 'cf111111-1111-1111-1111-111111111111', 'SGH');
INSERT INTO public.profile_experiences (user_id, tenant_id, role_title) VALUES
  ('cf000000-0000-0000-0000-0000000000a1', 'cf111111-1111-1111-1111-111111111111', 'Analityk');
INSERT INTO public.profile_awards (user_id, tenant_id, title) VALUES
  ('cf000000-0000-0000-0000-0000000000a1', 'cf111111-1111-1111-1111-111111111111', 'Nagroda');
INSERT INTO public.profile_hobbies (user_id, tenant_id, label) VALUES
  ('cf000000-0000-0000-0000-0000000000a1', 'cf111111-1111-1111-1111-111111111111', 'Bieganie');
INSERT INTO public.profile_cv_files (user_id, tenant_id, file_url, file_name) VALUES
  ('cf000000-0000-0000-0000-0000000000a1', 'cf111111-1111-1111-1111-111111111111',
   'https://cv.example/cv.pdf', 'cv.pdf');

-- ── (1) Kształt: polityki właściciela NADAL wiążą najemcę ────────────────────
-- Naprawa dryfu nie może być pretekstem do rozluźnienia izolacji. Ta asercja
-- oblewa, gdyby ktoś "naprawił" problem, wyjmując tenanta z USING.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profile_skills','profile_education','profile_experiences',
                        'profile_awards','profile_hobbies','profile_cv_files')
      AND qual ~ 'current_tenant_id'),
  6,
  'wszystkie szesc tabel CV nadal wiaze najemce w USING'
);

-- ── (2) Kontrola dodatnia: przed przeniesieniem wlasciciel widzi swoje dane ──
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"cf000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.profile_skills), 1,
  'przed przeniesieniem wlasciciel widzi swoje umiejetnosci'
);

-- ── (3-8) Po przeniesieniu konta KAZDA z szesciu tabel idzie za profilem ─────
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

UPDATE public.profiles
   SET tenant_id = 'cf222222-2222-2222-2222-222222222222'
 WHERE id = 'cf000000-0000-0000-0000-0000000000a1';

SELECT is(
  (SELECT tenant_id FROM public.profile_skills
    WHERE user_id = 'cf000000-0000-0000-0000-0000000000a1'),
  'cf222222-2222-2222-2222-222222222222'::uuid,
  'profile_skills podaza za profilem');

SELECT is(
  (SELECT tenant_id FROM public.profile_education
    WHERE user_id = 'cf000000-0000-0000-0000-0000000000a1'),
  'cf222222-2222-2222-2222-222222222222'::uuid,
  'profile_education podaza za profilem');

SELECT is(
  (SELECT tenant_id FROM public.profile_experiences
    WHERE user_id = 'cf000000-0000-0000-0000-0000000000a1'),
  'cf222222-2222-2222-2222-222222222222'::uuid,
  'profile_experiences podaza za profilem');

SELECT is(
  (SELECT tenant_id FROM public.profile_awards
    WHERE user_id = 'cf000000-0000-0000-0000-0000000000a1'),
  'cf222222-2222-2222-2222-222222222222'::uuid,
  'profile_awards podaza za profilem');

SELECT is(
  (SELECT tenant_id FROM public.profile_hobbies
    WHERE user_id = 'cf000000-0000-0000-0000-0000000000a1'),
  'cf222222-2222-2222-2222-222222222222'::uuid,
  'profile_hobbies podaza za profilem');

SELECT is(
  (SELECT tenant_id FROM public.profile_cv_files
    WHERE user_id = 'cf000000-0000-0000-0000-0000000000a1'),
  'cf222222-2222-2222-2222-222222222222'::uuid,
  'profile_cv_files podaza za profilem');

-- ── (9) Skutek, o ktory chodzi: wlasciciel NADAL widzi swoja biografie ───────
-- Przed naprawa bylo tu ZERO - i tak wlasnie wygladala utrata danych z
-- perspektywy czlowieka: profil pusty, wiersze nietkniete w bazie.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"cf000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT (SELECT count(*)::int FROM public.profile_skills)
        + (SELECT count(*)::int FROM public.profile_education)
        + (SELECT count(*)::int FROM public.profile_experiences)
        + (SELECT count(*)::int FROM public.profile_awards)
        + (SELECT count(*)::int FROM public.profile_hobbies)
        + (SELECT count(*)::int FROM public.profile_cv_files)),
  6,
  'po przeniesieniu wlasciciel NADAL widzi komplet swojej biografii'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
