-- pgTAP: `crm_funnel_stats()` wycofana - migracja
-- 20261117014500_crm_companies_aggregates_definer (czesc druga).
--
-- DEFEKT. Funkcja to SQL SECURITY INVOKER bez filtra i parametru najemcy:
-- liczy `COUNT(*) FILTER` nad calym `crm_funnel_view`. Miala EXECUTE dla
-- authenticated i service_role, a komentarz reklamowal ja jako agregat KPI
-- lejka. Wolana spod service-role (RLS wylaczone) zliczylaby subskrybentow
-- WSZYSTKICH najemcow; aplikacja od 17.11.2026 jej nie wola (liczniki lejka
-- licza zapytania `head: true` z `tenant_id` z sesji).
--
-- CO PRZYPINA:
--   * funkcja ISTNIEJE z niezmienionym ksztaltem (typy generowane z produkcji
--     zostaja zgodne - REVOKE, nie DROP);
--   * zaden wpis ACL nie daje EXECUTE PUBLIC, anon, authenticated ani
--     service_role (sprawdzone i przez `has_function_privilege`, i przez
--     `aclexplode` - PUBLIC nie jest rola, ktora da sie zapytac wprost);
--   * wywolanie jako authenticated i jako service_role konczy sie 42501 -
--     takze przy danych dwoch najemcow, ktore wywolanie spod service-role
--     zliczyloby razem;
--   * komentarz mowi, ze funkcja jest wycofana, zamiast reklamowac ja jako
--     agregat KPI.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test crm_funnel_stats_revoked
BEGIN;
SELECT plan(9);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('cf500000-0000-4000-8000-0000000000a0', 'crm-funnel-rev-a', 'Lejek A'),
  ('cf500000-0000-4000-8000-0000000000b0', 'crm-funnel-rev-b', 'Lejek B');
INSERT INTO auth.users (id, email) VALUES
  ('cf500000-0000-4000-8000-00000000a0a1', 'admin-a@crm-funnel-rev.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('cf500000-0000-4000-8000-00000000a0a1', 'admin-a@crm-funnel-rev.test', 'Admin A', 'cf500000-0000-4000-8000-0000000000a0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('cf500000-0000-4000-8000-00000000a0a1', 'admin', 'cf500000-0000-4000-8000-0000000000a0');
-- Subskrybenci dwoch najemcow: wywolanie spod service-role zliczyloby oba.
INSERT INTO public.newsletter_subscribers (tenant_id, email, status) VALUES
  ('cf500000-0000-4000-8000-0000000000a0', 'sub-a@crm-funnel-rev.test', 'subscribed'),
  ('cf500000-0000-4000-8000-0000000000b0', 'sub-b@crm-funnel-rev.test', 'subscribed');

-- 1-2: funkcja zostaje (REVOKE, nie DROP) z tym samym ksztaltem wyniku
SELECT ok(
  to_regprocedure('public.crm_funnel_stats()') IS NOT NULL,
  'crm_funnel_stats() istnieje - typy generowane z produkcji zostaja zgodne');
SELECT is(
  pg_get_function_result('public.crm_funnel_stats()'::regprocedure),
  'TABLE(total bigint, subscribed bigint, pending bigint, unsubscribed bigint, registered bigint, contacts bigint)',
  'ksztalt wyniku crm_funnel_stats() bez zmian');

-- 3-4: brak EXECUTE dla rol aplikacji i dla PUBLIC
SELECT ok(
  NOT has_function_privilege('anon', 'public.crm_funnel_stats()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.crm_funnel_stats()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.crm_funnel_stats()', 'EXECUTE'),
  'EXECUTE: ani anon, ani authenticated, ani service_role');
SELECT is(
  (SELECT count(*)
     FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = 'public.crm_funnel_stats()'::regprocedure
      AND a.privilege_type = 'EXECUTE'
      AND (a.grantee = 0
           OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')))),
  0::bigint,
  'ACL: zadnego wpisu EXECUTE dla PUBLIC, anon, authenticated ani service_role');

-- 5: komentarz mowi o wycofaniu, nie reklamuje agregatu KPI
SELECT ok(
  obj_description('public.crm_funnel_stats()'::regprocedure, 'pg_proc') LIKE 'WYCOFANA%'
  AND obj_description('public.crm_funnel_stats()'::regprocedure, 'pg_proc') NOT LIKE 'Aggregated marketing-funnel KPIs%',
  'COMMENT: funkcja oznaczona jako wycofana');

-- 6: service_role - 42501 (wczesniej zliczylby subskrybentow obu najemcow)
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.crm_funnel_stats()$$,
  '42501', NULL,
  'service_role: permission denied for function crm_funnel_stats');
RESET ROLE;

-- 7: staff najemcy A (authenticated) - 42501
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"cf500000-0000-4000-8000-00000000a0a1","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.crm_funnel_stats()$$,
  '42501', NULL,
  'authenticated (admin A): permission denied for function crm_funnel_stats');
RESET ROLE;

-- 8: anon - 42501
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.crm_funnel_stats()$$,
  '42501', NULL,
  'anon: permission denied for function crm_funnel_stats');
RESET ROLE;

-- 9: kontrola fikstury - widok naprawde ma wiersze dwoch najemcow (dlatego
-- wywolanie spod service-role bylo przeciekiem, a nie pustym licznikiem)
SELECT is(
  (SELECT count(DISTINCT tenant_id) FROM public.crm_funnel_view
    WHERE email IN ('sub-a@crm-funnel-rev.test', 'sub-b@crm-funnel-rev.test')),
  2::bigint,
  'fikstura: crm_funnel_view widzi subskrybentow dwoch najemcow (wlasciciel, bez RLS)');

SELECT * FROM finish();
ROLLBACK;
