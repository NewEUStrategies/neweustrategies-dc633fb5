-- pgTAP: publiczny odczyt author_profiles wyłącznie przez widok
-- (migracja 20260817120000).
--
-- Finding "author_profiles - public policies return the full row": polityki
-- "Public can view public author profiles" i "Authenticated can view public
-- author profiles" wpuszczały przy is_public = true CAŁY wiersz tabeli
-- bazowej (RLS nie zawęża kolumn), a granica kontaktowego PII wisiała
-- wyłącznie na kolumnowych REVOKE, które historycznie dryfowały dwukrotnie
-- (20260720090804, 20260720120000). Ten plik przybija stan docelowy:
--
--   * obu publicznych polityk SELECT NIE MA i anon nie ma ŻADNEJ polityki
--     ani ŻADNEGO grantu na tabeli bazowej (SELECT = 42501, nie pusty zbiór),
--   * authenticated nadal nie czyta kolumn kontaktowych, ale zachowuje
--     kolumny bezpieczne (user_id/is_public - kanarek ścieżek upsert
--     i wewnętrznej bazy ekspertów),
--   * publiczna projekcja przechodzi WYŁĄCZNIE przez widok
--     author_profiles_public (DEFINER, bez kolumn kontaktowych): anon
--     i zalogowany czytelnik widzą publiczny profil przez widok, a wiersz
--     tabeli bazowej czyta tylko właściciel i admin tenanta.
--
-- Konwencje: plik samowystarczalny (BEGIN/plan/finish/ROLLBACK), wcielenia
-- przez SET LOCAL ROLE + request.jwt.claims, seed z wyłączonymi triggerami
-- auth.users - jak w author_contact_privacy_test.sql.

BEGIN;
SELECT plan(14);

-- ── (1) Publiczne polityki SELECT zniknęły z tabeli bazowej ─────────────────
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'author_profiles'
      AND policyname IN ('Public can view public author profiles',
                         'Authenticated can view public author profiles')),
  0,
  'polityki "Public/Authenticated can view public author profiles" usunięte (20260817120000)'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'author_profiles'
      AND roles && ARRAY['anon', 'public']::name[]),
  0,
  'anon nie ma ŻADNEJ polityki na author_profiles (wszystkie pozostałe są TO authenticated)'
);

-- ── (2) anon: zero grantów na tabeli bazowej ────────────────────────────────
SELECT ok(
  NOT has_any_column_privilege('anon', 'public.author_profiles', 'SELECT'),
  'anon nie ma SELECT na ŻADNEJ kolumnie tabeli bazowej (REVOKE ALL)'
);
SELECT ok(
  NOT has_any_column_privilege('anon', 'public.author_profiles', 'INSERT')
  AND NOT has_any_column_privilege('anon', 'public.author_profiles', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.author_profiles', 'DELETE'),
  'anon nie ma też żadnego DML na tabeli bazowej'
);

-- ── (3) authenticated: granica kolumn kontaktowych trzyma ───────────────────
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.author_profiles', 'phone', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.author_profiles', 'contact_email', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.author_profiles', 'media_contact_email', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.author_profiles', 'media_contact_phone', 'SELECT'),
  'authenticated NIE czyta phone/contact_email/media_contact_email/media_contact_phone z tabeli bazowej'
);

-- Kanarek przeciw NADgorliwemu REVOKE: bez SELECT na user_id/is_public
-- wywraca się WHERE upsertu właściciela (AuthorProfileEditor) i odczyt
-- wierszy tenanta w wewnętrznej bazie ekspertów.
SELECT ok(
  has_column_privilege('authenticated', 'public.author_profiles', 'user_id', 'SELECT')
  AND has_column_privilege('authenticated', 'public.author_profiles', 'is_public', 'SELECT'),
  'authenticated zachowuje SELECT na kolumnach bezpiecznych (user_id, is_public)'
);

-- ── (4) Publiczna projekcja pozostaje dostępna (kanarek grantów widoku) ─────
SELECT ok(
  has_table_privilege('anon', 'public.author_profiles_public', 'SELECT')
  AND has_table_privilege('authenticated', 'public.author_profiles_public', 'SELECT'),
  'widok author_profiles_public pozostaje jedyną publiczną projekcją (grant dla obu ról)'
);

-- ── Seed pod testy behawioralne ─────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('77777777-7777-7777-7777-777777777777', 'tenant-g', 'Tenant G', 'tenant-g.example');

INSERT INTO auth.users (id, email) VALUES
  ('70000000-0000-0000-0000-000000000001', 'owner@g.test'),
  ('70000000-0000-0000-0000-000000000002', 'admin@g.test'),
  ('70000000-0000-0000-0000-000000000003', 'reader@g.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('70000000-0000-0000-0000-000000000001', 'owner@g.test',  'Owner G',  '77777777-7777-7777-7777-777777777777'),
  ('70000000-0000-0000-0000-000000000002', 'admin@g.test',  'Admin G',  '77777777-7777-7777-7777-777777777777'),
  ('70000000-0000-0000-0000-000000000003', 'reader@g.test', 'Reader G', '77777777-7777-7777-7777-777777777777');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('70000000-0000-0000-0000-000000000001', 'author', '77777777-7777-7777-7777-777777777777'),
  ('70000000-0000-0000-0000-000000000002', 'admin',  '77777777-7777-7777-7777-777777777777'),
  ('70000000-0000-0000-0000-000000000003', 'user',   '77777777-7777-7777-7777-777777777777');

-- Profil PUBLICZNY z kompletem kontaktowego PII - dokładnie ten wiersz,
-- który stare polityki wystawiały każdemu.
INSERT INTO public.author_profiles (
  user_id, tenant_id, job_title, is_public,
  phone, contact_email, media_contact_name, media_contact_email, media_contact_phone
) VALUES (
  '70000000-0000-0000-0000-000000000001',
  '77777777-7777-7777-7777-777777777777',
  'Analyst G', true,
  '+48 111 222 333', 'owner@g.test',
  'Press Office G', 'media@g.test', '+48 999 888 777'
);

-- ── (5) anon: tabela bazowa odcięta, widok działa ───────────────────────────
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '{"x-tenant-host":"tenant-g.example"}', true);

SELECT throws_ok(
  $$ SELECT user_id FROM public.author_profiles $$,
  '42501', NULL,
  'anon: SELECT z tabeli bazowej odrzucony na grantach (42501), zanim RLS cokolwiek policzy'
);

SELECT is(
  (SELECT count(*)::int FROM public.author_profiles_public
    WHERE user_id = '70000000-0000-0000-0000-000000000001'),
  1,
  'anon widzi publiczny profil przez widok author_profiles_public'
);

SELECT is(
  (SELECT job_title FROM public.author_profiles_public
    WHERE user_id = '70000000-0000-0000-0000-000000000001'),
  'Analyst G',
  'anon czyta z widoku dane wizytówki (job_title) - publiczna powierzchnia bez zmian'
);

-- ── (6) Zalogowany czytelnik: wiersz tylko przez widok ──────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT set_config('request.headers', '{"x-tenant-host":"tenant-g.example"}', true);

SELECT is(
  (SELECT count(user_id)::int FROM public.author_profiles
    WHERE user_id = '70000000-0000-0000-0000-000000000001'),
  0,
  'zalogowany nie-właściciel bez roli admin NIE widzi cudzego publicznego wiersza w tabeli bazowej'
);

SELECT is(
  (SELECT count(*)::int FROM public.author_profiles_public
    WHERE user_id = '70000000-0000-0000-0000-000000000001'),
  1,
  'zalogowany czytelnik widzi publiczny profil przez widok (powierzchnia dla klienta bez zmian)'
);

-- ── (7) Właściciel i admin tenanta czytają tabelę bazową jak dotąd ──────────
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(
  (SELECT count(user_id)::int FROM public.author_profiles
    WHERE user_id = '70000000-0000-0000-0000-000000000001'),
  1,
  'właściciel nadal widzi własny wiersz w tabeli bazowej (polityka "Owners can view own author profile")'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT is(
  (SELECT count(user_id)::int FROM public.author_profiles
    WHERE user_id = '70000000-0000-0000-0000-000000000001'),
  1,
  'admin tenanta nadal widzi wiersze swojego tenanta (polityka "Admins can manage tenant author profiles")'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
