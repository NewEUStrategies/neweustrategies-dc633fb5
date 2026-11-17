-- pgTAP: liczniki listy firm CRM (`crm_companies_aggregates`) - migracja
-- 20261117014500_crm_companies_aggregates_definer.
--
-- DEFEKT. Funkcja byla SQL SECURITY INVOKER i czytala
-- `profiles.current_company_id`, ktore nie ma grantu SELECT dla
-- `authenticated` (poprawka PII 20260724090100): kazde wywolanie przez staff
-- CRM konczylo sie 42501, a `listCrmCompanies` padalo przy kazdej niepustej
-- liscie firm. Odczyt spod service-role nie wchodzil w gre - cialo nie zna
-- najemcy, a klucze `company_id` / `current_company_id` nie sa sparowane
-- z `tenant_id`, wiec obce wiersze wskazujace na firme liczylyby sie w liscie.
--
-- CO PRZYPINA:
--   * SECURITY DEFINER z przypieta sciezka; anon bez EXECUTE; grant kolumny
--     `profiles.current_company_id` dla `authenticated` NADAL odebrany;
--   * admin, editor i super_admin najemcy A dostaja liczniki firm A:
--     leady i profile WYLACZNIE z najemcy A (lead i profil najemcy B wskazujace
--     na firme A nie zmieniaja ani liczby, ani daty ostatniej aktywnosci);
--   * firma najemcy B podana przez staff A wypada z wyniku (i odwrotnie);
--   * plain i author A oraz wolajacy bez `sub` - 42501.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test crm_companies_aggregates_tenant
BEGIN;
SELECT plan(14);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c9a00000-0000-4000-8000-0000000000a0', 'crm-agg-a', 'CRM agregaty A'),
  ('c9a00000-0000-4000-8000-0000000000b0', 'crm-agg-b', 'CRM agregaty B');
INSERT INTO auth.users (id, email) VALUES
  ('c9a00000-0000-4000-8000-00000000a0a1', 'admin-a@crm-agg.test'),
  ('c9a00000-0000-4000-8000-00000000a0e1', 'editor-a@crm-agg.test'),
  ('c9a00000-0000-4000-8000-00000000a051', 'super-a@crm-agg.test'),
  ('c9a00000-0000-4000-8000-00000000a0c1', 'author-a@crm-agg.test'),
  ('c9a00000-0000-4000-8000-00000000a0d1', 'plain-a@crm-agg.test'),
  ('c9a00000-0000-4000-8000-00000000a0f1', 'member-a@crm-agg.test'),
  ('c9a00000-0000-4000-8000-00000000b0a1', 'admin-b@crm-agg.test'),
  ('c9a00000-0000-4000-8000-00000000b0f1', 'member-b@crm-agg.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c9a00000-0000-4000-8000-00000000a0a1', 'admin-a@crm-agg.test', 'Admin A', 'c9a00000-0000-4000-8000-0000000000a0'),
  ('c9a00000-0000-4000-8000-00000000a0e1', 'editor-a@crm-agg.test', 'Editor A', 'c9a00000-0000-4000-8000-0000000000a0'),
  ('c9a00000-0000-4000-8000-00000000a051', 'super-a@crm-agg.test', 'Super A', 'c9a00000-0000-4000-8000-0000000000a0'),
  ('c9a00000-0000-4000-8000-00000000a0c1', 'author-a@crm-agg.test', 'Author A', 'c9a00000-0000-4000-8000-0000000000a0'),
  ('c9a00000-0000-4000-8000-00000000a0d1', 'plain-a@crm-agg.test', 'Plain A', 'c9a00000-0000-4000-8000-0000000000a0'),
  ('c9a00000-0000-4000-8000-00000000a0f1', 'member-a@crm-agg.test', 'Member A', 'c9a00000-0000-4000-8000-0000000000a0'),
  ('c9a00000-0000-4000-8000-00000000b0a1', 'admin-b@crm-agg.test', 'Admin B', 'c9a00000-0000-4000-8000-0000000000b0'),
  ('c9a00000-0000-4000-8000-00000000b0f1', 'member-b@crm-agg.test', 'Member B', 'c9a00000-0000-4000-8000-0000000000b0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c9a00000-0000-4000-8000-00000000a0a1', 'admin', 'c9a00000-0000-4000-8000-0000000000a0'),
  ('c9a00000-0000-4000-8000-00000000a0e1', 'editor', 'c9a00000-0000-4000-8000-0000000000a0'),
  ('c9a00000-0000-4000-8000-00000000a051', 'super_admin', 'c9a00000-0000-4000-8000-0000000000a0'),
  ('c9a00000-0000-4000-8000-00000000a0c1', 'author', 'c9a00000-0000-4000-8000-0000000000a0'),
  ('c9a00000-0000-4000-8000-00000000b0a1', 'admin', 'c9a00000-0000-4000-8000-0000000000b0');

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('c9a00000-0000-4000-8000-0000000c0a01', 'c9a00000-0000-4000-8000-0000000000a0', 'Firma A1'),
  ('c9a00000-0000-4000-8000-0000000c0a02', 'c9a00000-0000-4000-8000-0000000000a0', 'Firma A2'),
  ('c9a00000-0000-4000-8000-0000000c0b01', 'c9a00000-0000-4000-8000-0000000000b0', 'Firma B1');

-- Dwa leady A przy A1 + lead B wskazujacy na A1 (obce odwolanie, PÓZNIEJSZA
-- aktywnosc - gdyby sie liczyl, zmienilby i liczbe, i date).
INSERT INTO public.crm_leads (tenant_id, email, email_norm, company_id, last_activity_at) VALUES
  ('c9a00000-0000-4000-8000-0000000000a0', 'l1@crm-agg.test', 'l1@crm-agg.test', 'c9a00000-0000-4000-8000-0000000c0a01', '2026-10-01 10:00:00+00'),
  ('c9a00000-0000-4000-8000-0000000000a0', 'l2@crm-agg.test', 'l2@crm-agg.test', 'c9a00000-0000-4000-8000-0000000c0a01', '2026-10-05 10:00:00+00'),
  ('c9a00000-0000-4000-8000-0000000000b0', 'lb@crm-agg.test', 'lb@crm-agg.test', 'c9a00000-0000-4000-8000-0000000c0a01', '2026-11-01 10:00:00+00');

-- Kontakty: czlonek A przy A1 i czlonek B przypiety do A1 (obce odwolanie).
-- Synchronizacja profil -> lead CRM wylaczona na czas fikstury: inaczej
-- przypiecie dopisaloby leady (z aktywnoscia `now()`) obu czlonkow, a test ma
-- liczyc dokladnie leady wstawione wyzej.
ALTER TABLE public.profiles DISABLE TRIGGER profile_sync_crm_lead;
UPDATE public.profiles SET current_company_id = 'c9a00000-0000-4000-8000-0000000c0a01'
 WHERE id IN ('c9a00000-0000-4000-8000-00000000a0f1', 'c9a00000-0000-4000-8000-00000000b0f1');

CREATE TEMP TABLE expected_a (company_id uuid, leads_count bigint, last_lead_activity_at timestamptz, contacts_count bigint);
INSERT INTO expected_a VALUES
  ('c9a00000-0000-4000-8000-0000000c0a01', 2, '2026-10-05 10:00:00+00', 1),
  ('c9a00000-0000-4000-8000-0000000c0a02', 0, NULL, 0);
GRANT SELECT ON expected_a TO authenticated;

-- 1-4: ksztalt i granty
SELECT is_definer('public', 'crm_companies_aggregates', ARRAY['uuid[]'],
  'crm_companies_aggregates jest SECURITY DEFINER');
SELECT is(
  (SELECT proconfig FROM pg_proc WHERE oid = 'public.crm_companies_aggregates(uuid[])'::regprocedure),
  ARRAY['search_path=public, pg_temp'],
  'crm_companies_aggregates ma przypieta sciezke public, pg_temp');
SELECT ok(
  NOT has_function_privilege('anon', 'public.crm_companies_aggregates(uuid[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.crm_companies_aggregates(uuid[])', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.crm_companies_aggregates(uuid[])', 'EXECUTE'),
  'EXECUTE: authenticated i service_role tak, anon nie');
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.profiles', 'current_company_id', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.profiles', 'email', 'SELECT'),
  'naprawa NIE otwiera grantu: profiles.current_company_id i email nadal bez SELECT dla authenticated');

-- 5: admin A - liczniki firm A tylko z wierszy najemcy A; firma B wypada
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"c9a00000-0000-4000-8000-00000000a0a1","role":"authenticated"}', true);
SELECT results_eq(
  $$SELECT company_id, leads_count, last_lead_activity_at, contacts_count
      FROM public.crm_companies_aggregates(ARRAY['c9a00000-0000-4000-8000-0000000c0a01','c9a00000-0000-4000-8000-0000000c0a02','c9a00000-0000-4000-8000-0000000c0b01']::uuid[])
     ORDER BY company_id$$,
  $$SELECT * FROM expected_a ORDER BY company_id$$,
  'admin A: leady i kontakty wylacznie z najemcy A, firma B poza wynikiem');
RESET ROLE;

-- 6: editor A - to samo
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"c9a00000-0000-4000-8000-00000000a0e1","role":"authenticated"}', true);
SELECT results_eq(
  $$SELECT company_id, leads_count, last_lead_activity_at, contacts_count
      FROM public.crm_companies_aggregates(ARRAY['c9a00000-0000-4000-8000-0000000c0a01','c9a00000-0000-4000-8000-0000000c0a02']::uuid[])
     ORDER BY company_id$$,
  $$SELECT * FROM expected_a ORDER BY company_id$$,
  'editor A: te same liczniki co admin');
RESET ROLE;

-- 7: super_admin A - te same liczniki; obcy lead NIE liczy sie, choc polityka
-- leadow wpuszcza super_admina ponad najemcami
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"c9a00000-0000-4000-8000-00000000a051","role":"authenticated"}', true);
SELECT results_eq(
  $$SELECT company_id, leads_count, last_lead_activity_at, contacts_count
      FROM public.crm_companies_aggregates(ARRAY['c9a00000-0000-4000-8000-0000000c0a01','c9a00000-0000-4000-8000-0000000c0a02']::uuid[])
     ORDER BY company_id$$,
  $$SELECT * FROM expected_a ORDER BY company_id$$,
  'super_admin A: liczniki tylko z najemcy A');
RESET ROLE;

-- 8-9: admin B - widzi wylacznie firme B; firma A z parametru wypada
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"c9a00000-0000-4000-8000-00000000b0a1","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*) FROM public.crm_companies_aggregates(ARRAY['c9a00000-0000-4000-8000-0000000c0a01']::uuid[])),
  0::bigint,
  'admin B: firma najemcy A (z parametru) nie daje zadnego wiersza');
SELECT results_eq(
  $$SELECT company_id, leads_count, contacts_count
      FROM public.crm_companies_aggregates(ARRAY['c9a00000-0000-4000-8000-0000000c0a01','c9a00000-0000-4000-8000-0000000c0b01']::uuid[])$$,
  $$VALUES ('c9a00000-0000-4000-8000-0000000c0b01'::uuid, 0::bigint, 0::bigint)$$,
  'admin B: tylko firma B, bez obcego leada i profilu wskazujacych na A1');
RESET ROLE;

-- 10-12: bez roli staffu CRM i bez sesji - 42501
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"c9a00000-0000-4000-8000-00000000a0d1","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.crm_companies_aggregates(ARRAY['c9a00000-0000-4000-8000-0000000c0a01']::uuid[])$$,
  '42501', 'crm_companies_aggregates: forbidden',
  'uzytkownik A bez roli: 42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"c9a00000-0000-4000-8000-00000000a0c1","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.crm_companies_aggregates(ARRAY['c9a00000-0000-4000-8000-0000000c0a01']::uuid[])$$,
  '42501', 'crm_companies_aggregates: forbidden',
  'author A (staff tresci, nie CRM): 42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.crm_companies_aggregates(ARRAY['c9a00000-0000-4000-8000-0000000c0a01']::uuid[])$$,
  '42501', 'crm_companies_aggregates: unauthenticated',
  'token bez sub: 42501');
RESET ROLE;

-- 13: anon - brak EXECUTE
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT * FROM public.crm_companies_aggregates(ARRAY['c9a00000-0000-4000-8000-0000000c0a01']::uuid[])$$,
  '42501', NULL,
  'anon: permission denied for function');
RESET ROLE;

-- 14: pusta tablica identyfikatorow - pusty wynik, nie blad
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"c9a00000-0000-4000-8000-00000000a0a1","role":"authenticated"}', true);
SELECT is_empty(
  $$SELECT * FROM public.crm_companies_aggregates(ARRAY[]::uuid[])$$,
  'pusta lista firm: pusty wynik');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
