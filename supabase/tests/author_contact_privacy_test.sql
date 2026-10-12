-- pgTAP: prywatność danych kontaktowych autora (migracja 20260730120000).
--
-- Finding "author contact details exposed to the public by default":
-- author_profiles trzyma PII kontaktowe (phone, contact_email,
-- media_contact_email, media_contact_phone) obok publicznego bio, a widok
-- author_profiles_public (DEFINER-style, 20260724114239) re-eksponował
-- contact_email każdemu anonimowi mimo kolumnowego REVOKE na tabeli bazowej.
-- Ten plik przybija docelowy stan:
--
--   * widok author_profiles_public NIE zawiera żadnej kolumny kontaktowej
--     (jedynie media_contact_name - nazwa osoby, nie kanał kontaktu),
--   * get_expert_hub() nie osadza contact_email w publicznym jsonb,
--   * is_public ma DEFAULT false (privacy by default dla przyszłych ścieżek
--     insertu, które nie ustawią go jawnie),
--   * pełny wiersz czytają wyłącznie: właściciel (get_own_author_profile),
--     admin tego samego tenanta (admin_get_author_profile) - nie-admin
--     i admin obcego tenanta dostają pusty zbiór, anon nie ma EXECUTE.
--   * (20261012200000) widok jest TYLKO DO ODCZYTU dla anon/authenticated:
--     domyślne uprawnienia schematu dawały im INSERT/UPDATE/DELETE na
--     auto-aktualizowalnym widoku DEFINER (właściciel z BYPASSRLS), czyli
--     zapis obok RLS tabeli bazowej; event_speaker_detail nie czyta
--     contact_email z widoku (dryf drizzle 0150 na produkcji).
--
-- Konwencje: plik samowystarczalny (BEGIN/plan/finish/ROLLBACK), wcielenia
-- przez SET LOCAL ROLE + request.jwt.claims, seed z wyłączonymi triggerami
-- auth.users - jak w security_hardening_rls_test.sql.

BEGIN;
SELECT plan(23);

-- ── (1) Kształt publicznej projekcji: zero kanałów kontaktowych ─────────────
SELECT hasnt_column(
  'public', 'author_profiles_public', 'contact_email',
  'widok author_profiles_public NIE ma kolumny contact_email'
);
SELECT hasnt_column(
  'public', 'author_profiles_public', 'phone',
  'widok author_profiles_public NIE ma kolumny phone'
);
SELECT hasnt_column(
  'public', 'author_profiles_public', 'media_contact_email',
  'widok author_profiles_public NIE ma kolumny media_contact_email'
);
SELECT hasnt_column(
  'public', 'author_profiles_public', 'media_contact_phone',
  'widok author_profiles_public NIE ma kolumny media_contact_phone'
);
SELECT has_column(
  'public', 'author_profiles_public', 'media_contact_name',
  'widok author_profiles_public zachowuje media_contact_name (nazwa, nie kanał kontaktu)'
);

-- ── (1b) Widok tylko do odczytu dla ról klienckich (20261012200000) ─────────
SELECT ok(
  has_table_privilege('anon', 'public.author_profiles_public', 'SELECT')
    AND has_table_privilege('authenticated', 'public.author_profiles_public', 'SELECT'),
  'anon i authenticated czytają author_profiles_public (SELECT zostaje)'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.author_profiles_public',
    'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'anon NIE ma żadnego prawa zapisu do author_profiles_public'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.author_profiles_public',
    'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'authenticated NIE ma żadnego prawa zapisu do author_profiles_public'
);
SELECT ok(
  pg_get_functiondef('public.event_speaker_detail(uuid,uuid,boolean)'::regprocedure) !~ 'contact_email',
  'event_speaker_detail() nie czyta contact_email (e-mail autora nie wychodzi oknem prelegenta)'
);

-- ── (2) Privacy by default ──────────────────────────────────────────────────
SELECT col_default_is(
  'public', 'author_profiles', 'is_public', 'false',
  'author_profiles.is_public ma DEFAULT false (publikacja to świadomy opt-in)'
);

-- ── (3) admin_get_author_profile: definicja i uprawnienia ───────────────────
SELECT is_definer(
  'public', 'admin_get_author_profile', ARRAY['uuid'],
  'admin_get_author_profile() jest SECURITY DEFINER (omija kolumnowy REVOKE po weryfikacji roli)'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_get_author_profile(uuid)', 'EXECUTE'),
  'anon NIE może wywołać admin_get_author_profile()'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_get_author_profile(uuid)', 'EXECUTE'),
  'authenticated może wywołać admin_get_author_profile() (guard roli w ciele funkcji)'
);

-- ── (4) get_expert_hub nie osadza contact_email w publicznym payloadzie ─────
SELECT ok(
  pg_get_functiondef('public.get_expert_hub(text)'::regprocedure) !~ 'contact_email',
  'get_expert_hub() nie selektuje contact_email (payload huba bez PII kontaktowego)'
);

-- ── Seed pod testy behawioralne ─────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('e5555555-5555-5555-5555-555555555555', 'tenant-e', 'Tenant E', 'tenant-e.example'),
  ('f6666666-6666-6666-6666-666666666666', 'tenant-f', 'Tenant F', 'tenant-f.example');

INSERT INTO auth.users (id, email) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'owner@e.test'),
  ('e0000000-0000-0000-0000-000000000002', 'admin@e.test'),
  ('e0000000-0000-0000-0000-000000000003', 'reader@e.test'),
  ('f0000000-0000-0000-0000-000000000002', 'admin@f.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'owner@e.test',  'Owner E',  'e5555555-5555-5555-5555-555555555555'),
  ('e0000000-0000-0000-0000-000000000002', 'admin@e.test',  'Admin E',  'e5555555-5555-5555-5555-555555555555'),
  ('e0000000-0000-0000-0000-000000000003', 'reader@e.test', 'Reader E', 'e5555555-5555-5555-5555-555555555555'),
  ('f0000000-0000-0000-0000-000000000002', 'admin@f.test',  'Admin F',  'f6666666-6666-6666-6666-666666666666');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'author', 'e5555555-5555-5555-5555-555555555555'),
  ('e0000000-0000-0000-0000-000000000002', 'admin',  'e5555555-5555-5555-5555-555555555555'),
  ('e0000000-0000-0000-0000-000000000003', 'user',   'e5555555-5555-5555-5555-555555555555'),
  ('f0000000-0000-0000-0000-000000000002', 'admin',  'f6666666-6666-6666-6666-666666666666');

INSERT INTO public.author_profiles (
  user_id, tenant_id, job_title, is_public,
  phone, contact_email, media_contact_name, media_contact_email, media_contact_phone
) VALUES (
  'e0000000-0000-0000-0000-000000000001',
  'e5555555-5555-5555-5555-555555555555',
  'Analyst', true,
  '+48 111 222 333', 'owner@e.test',
  'Press Office E', 'media@e.test', '+48 999 888 777'
);

-- ── (5) Admin tego samego tenanta czyta pełny wiersz ────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT set_config('request.headers', '{"x-tenant-host":"tenant-e.example"}', true);

SELECT is(
  (SELECT contact_email FROM public.admin_get_author_profile('e0000000-0000-0000-0000-000000000001')),
  'owner@e.test',
  'admin tenanta czyta contact_email przez admin_get_author_profile()'
);
SELECT is(
  (SELECT phone FROM public.admin_get_author_profile('e0000000-0000-0000-0000-000000000001')),
  '+48 111 222 333',
  'admin tenanta czyta phone przez admin_get_author_profile()'
);

-- ── (6) Nie-admin dostaje pusty zbiór ───────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.admin_get_author_profile('e0000000-0000-0000-0000-000000000001')),
  0,
  'zwykły użytkownik (bez roli admin) dostaje pusty zbiór z admin_get_author_profile()'
);

-- ── (7) Admin OBCEGO tenanta dostaje pusty zbiór (izolacja tenant_id) ───────
SELECT set_config('request.jwt.claims',
  '{"sub":"f0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.admin_get_author_profile('e0000000-0000-0000-0000-000000000001')),
  0,
  'admin innego tenanta NIE czyta cudzego author_profiles (guard tenant_id)'
);

-- ── (8) Właściciel czyta własny wiersz przez get_own_author_profile() ───────
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(
  (SELECT contact_email FROM public.get_own_author_profile()),
  'owner@e.test',
  'właściciel czyta własny contact_email przez get_own_author_profile()'
);

-- ── (9) Anon widzi publiczną projekcję (wiersz jest, kontaktów nie ma) ──────
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '{"x-tenant-host":"tenant-e.example"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.author_profiles_public
     WHERE user_id = 'e0000000-0000-0000-0000-000000000001'),
  1,
  'anon widzi publiczny profil autora w author_profiles_public (projekcja bez kolumn kontaktowych)'
);

-- ── (10) Zapis przez widok odrzucony, zanim dotknie tabeli bazowej ──────────
-- Widok DEFINER sprawdza tabelę bazową jako właściciel (BYPASSRLS), więc
-- jedyną zaporą jest brak praw zapisu do samego widoku: 42501.
SELECT throws_ok(
  $$UPDATE public.author_profiles_public SET job_title = 'Hijacked'
      WHERE user_id = 'e0000000-0000-0000-0000-000000000001'$$,
  '42501', NULL,
  'anon NIE nadpisze publicznego profilu autora przez author_profiles_public'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

SELECT throws_ok(
  $$DELETE FROM public.author_profiles_public
      WHERE user_id = 'e0000000-0000-0000-0000-000000000001'$$,
  '42501', NULL,
  'zalogowany czytelnik NIE usunie cudzego profilu autora przez author_profiles_public'
);
SELECT throws_ok(
  $$INSERT INTO public.author_profiles_public (user_id, tenant_id, is_public, job_title)
      VALUES ('e0000000-0000-0000-0000-000000000003',
              'f6666666-6666-6666-6666-666666666666', true, 'Planted')$$,
  '42501', NULL,
  'zalogowany czytelnik NIE wstawi profilu (także w obcym tenancie) przez author_profiles_public'
);

SELECT * FROM finish();
ROLLBACK;
