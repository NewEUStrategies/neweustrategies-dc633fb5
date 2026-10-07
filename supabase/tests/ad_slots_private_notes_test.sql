-- pgTAP: notatki operatora `ad_slots.notes` poza zasiegiem anona i czytelnika
-- (migracja 20261007120100_ad_slots_private_notes, audyt ed13 D-14-3).
--
-- DEFEKT. `anon` i `authenticated` mialy SELECT na CALEJ tabeli, a polityka
-- „Public can read active ad_slots" wpuszczala kazdy aktywny slot najemcy
-- hosta - `GET /rest/v1/ad_slots?select=notes` z kluczem publicznym oddawal
-- warunki umowy i kontakt do reklamodawcy. Ochrona zyla tylko w TS
-- (`PUBLIC_AD_SLOT_COLUMNS`), a test atrapy sprawdzal TS, nie baze.
--
-- CO PRZYPINA:
--   1. uprawnienia kolumnowe: zadna rola klienta nie czyta `notes`, kolumny
--      kreacji zostaja czytelne (front emituje reklamy z tych kolumn),
--   2. zapytanie anona o `notes` konczy sie 42501, a o kolumny publiczne -
--      wierszem (polityka publiczna dziala jak dotad),
--   3. `admin_list_ad_slots()`: redakcja dostaje pelne wiersze SWOJEGO
--      najemcy od najnowszych, czytelnik bez roli - 42501, anon - brak EXECUTE.
-- Rownosc listy kolumn z `PUBLIC_AD_SLOT_COLUMNS` pilnuje kontrakt TS<->SQL
-- (`supabase/tests/ts_sql_contract_test.sql`, sekcja „kolumny publiczne").
BEGIN;
SELECT plan(12);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('ad0a0000-0000-0000-0000-0000000000aa', 'ads-notes-a', 'Ads Notes A', 'ads-notes-a.example'),
  ('ad0b0000-0000-0000-0000-0000000000bb', 'ads-notes-b', 'Ads Notes B', 'ads-notes-b.example');

INSERT INTO auth.users (id, email) VALUES
  ('ad000000-0000-0000-0000-0000000000e1', 'ads-editor@example.org'),
  ('ad000000-0000-0000-0000-0000000000c1', 'ads-reader@example.org');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('ad000000-0000-0000-0000-0000000000e1', 'ads-editor@example.org', 'Ads Editor', 'ad0a0000-0000-0000-0000-0000000000aa'),
  ('ad000000-0000-0000-0000-0000000000c1', 'ads-reader@example.org', 'Ads Reader', 'ad0a0000-0000-0000-0000-0000000000aa');
INSERT INTO public.user_roles (tenant_id, user_id, role) VALUES
  ('ad0a0000-0000-0000-0000-0000000000aa', 'ad000000-0000-0000-0000-0000000000e1', 'editor');

INSERT INTO public.ad_slots (id, tenant_id, name, kind, status, html, notes, created_at) VALUES
  ('ad100000-0000-0000-0000-000000000001', 'ad0a0000-0000-0000-0000-0000000000aa',
   'Baner A starszy', 'html', 'active', '<div>A1</div>', 'umowa A1: 2000 zl', now() - interval '2 days'),
  ('ad100000-0000-0000-0000-000000000002', 'ad0a0000-0000-0000-0000-0000000000aa',
   'Baner A nowszy', 'html', 'active', '<div>A2</div>', 'kontakt: reklamodawca A2', now() - interval '1 day'),
  ('ad100000-0000-0000-0000-000000000003', 'ad0b0000-0000-0000-0000-0000000000bb',
   'Baner B', 'html', 'active', '<div>B</div>', 'umowa B', now());

-- ── 1-4. Uprawnienia kolumnowe ──────────────────────────────────────────────
SELECT ok(
  NOT has_column_privilege('anon', 'public.ad_slots', 'notes', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.ad_slots', 'notes', 'SELECT'),
  'anon i authenticated NIE czytaja ad_slots.notes');
SELECT ok(
  NOT has_table_privilege('anon', 'public.ad_slots', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.ad_slots', 'SELECT'),
  'brak SELECT tabelowego - grant tabelowy spelnialby sprawdzenie dla KAZDEJ kolumny');
SELECT ok(
  (SELECT bool_and(has_column_privilege(r, 'public.ad_slots', c, 'SELECT'))
     FROM unnest(ARRAY['anon', 'authenticated']) r,
          unnest(ARRAY['id', 'tenant_id', 'name', 'kind', 'status', 'html', 'script', 'image_url',
                       'image_link', 'image_alt', 'width', 'height', 'requires_consent',
                       'targeting', 'created_at', 'updated_at']) c),
  'kolumny kreacji zostaja czytelne dla frontu (emisja reklam bez zmian)');
SELECT ok(
  has_table_privilege('authenticated', 'public.ad_slots', 'INSERT')
  AND has_table_privilege('authenticated', 'public.ad_slots', 'UPDATE')
  AND has_table_privilege('authenticated', 'public.ad_slots', 'DELETE'),
  'zapis panelu bez zmian - INSERT/UPDATE/DELETE dalej przez polityke redakcji');

-- ── 5-6. Anon: notatki odmowa, kreacja wierszem ─────────────────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"ads-notes-a.example"}', true);
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT notes FROM public.ad_slots WHERE id = 'ad100000-0000-0000-0000-000000000001'$$,
  '42501', NULL,
  'anon: SELECT notes konczy sie odmowa uprawnien (dawniej oddawal notatki operatora)');
SELECT is(
  (SELECT count(*)::int FROM (
     SELECT id, name, html FROM public.ad_slots
      WHERE tenant_id = 'ad0a0000-0000-0000-0000-0000000000aa') s),
  2,
  'anon: aktywne sloty najemcy hosta nadal czytelne w kolumnach publicznych');
RESET ROLE;

-- ── 7-12. Funkcja redakcji ──────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_list_ad_slots()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_list_ad_slots()', 'EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                   WHERE p.oid = 'public.admin_list_ad_slots()'::regprocedure AND a.grantee = 0),
  'admin_list_ad_slots: bez EXECUTE dla anon i PUBLIC');

SELECT set_config('request.jwt.claims',
  '{"sub":"ad000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT array_agg(s.id ORDER BY s.ordinality)
     FROM public.admin_list_ad_slots() WITH ORDINALITY AS s),
  ARRAY['ad100000-0000-0000-0000-000000000002', 'ad100000-0000-0000-0000-000000000001']::uuid[],
  'redakcja: sloty WYLACZNIE swojego najemcy, od najnowszych');
SELECT is(
  (SELECT notes FROM public.admin_list_ad_slots() s WHERE s.id = 'ad100000-0000-0000-0000-000000000002'),
  'kontakt: reklamodawca A2',
  'redakcja: pelny wiersz z notatkami operatora (formularz slotu)');
SELECT throws_ok(
  $$SELECT notes FROM public.ad_slots$$,
  '42501', NULL,
  'redakcja tez nie czyta notes wprost - jedyna droga to funkcja');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  '{"sub":"ad000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT * FROM public.admin_list_ad_slots()$$,
  '42501', 'forbidden: ad slots are managed by admins and editors',
  'czytelnik bez roli: 42501, nie pusta lista');
RESET ROLE;

SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT * FROM public.admin_list_ad_slots()$$,
  '42501', 'forbidden: ad slots are managed by admins and editors',
  'bez sesji: 42501');
RESET ROLE;

SELECT set_config('request.headers', '', true);
SELECT * FROM finish();
ROLLBACK;
