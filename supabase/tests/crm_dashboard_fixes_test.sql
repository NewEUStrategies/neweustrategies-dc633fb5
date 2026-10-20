-- pgTAP: pulpit CRM bez zadań anulowanych (D11, migracja 20261020130400).
--
-- Sprawdza: `tasksOpen` i `tasksOverdue` liczą tylko `status = 'open'`
-- (anulowane i zrobione poza), `tasksDone` liczy domknięcia w oknie, dane
-- drugiego najemcy nie przeciekają, autor dostaje 42501, kształt `totals`
-- (kontrakt CrmPanel) bez zmian, granty.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test crm_dashboard_fixes
BEGIN;
SELECT plan(8);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('d4500000-0000-0000-0000-0000000000a0', 'hub-s4-dash-a', 'Hub S4 pulpit A'),
  ('d4500000-0000-0000-0000-0000000000b0', 'hub-s4-dash-b', 'Hub S4 pulpit B');

INSERT INTO auth.users (id, email) VALUES
  ('d4500000-0000-0000-0000-00000000a001', 'admin-a@hub-s4-dash.test'),
  ('d4500000-0000-0000-0000-00000000a003', 'author-a@hub-s4-dash.test'),
  ('d4500000-0000-0000-0000-00000000b001', 'admin-b@hub-s4-dash.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d4500000-0000-0000-0000-00000000a001', 'admin-a@hub-s4-dash.test', 'Admin A', 'd4500000-0000-0000-0000-0000000000a0'),
  ('d4500000-0000-0000-0000-00000000a003', 'author-a@hub-s4-dash.test', 'Author A', 'd4500000-0000-0000-0000-0000000000a0'),
  ('d4500000-0000-0000-0000-00000000b001', 'admin-b@hub-s4-dash.test', 'Admin B', 'd4500000-0000-0000-0000-0000000000b0');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('d4500000-0000-0000-0000-00000000a001', 'admin', 'd4500000-0000-0000-0000-0000000000a0'),
  ('d4500000-0000-0000-0000-00000000a003', 'author', 'd4500000-0000-0000-0000-0000000000a0'),
  ('d4500000-0000-0000-0000-00000000b001', 'admin', 'd4500000-0000-0000-0000-0000000000b0');

INSERT INTO public.crm_leads (id, tenant_id, email, email_norm) VALUES
  ('d4500000-0000-0000-0000-0000000001a1', 'd4500000-0000-0000-0000-0000000000a0', 'l@hub-s4-dash.test', 'l@hub-s4-dash.test'),
  ('d4500000-0000-0000-0000-0000000001b1', 'd4500000-0000-0000-0000-0000000000b0', 'l@hub-s4-dash.test', 'l@hub-s4-dash.test');

-- A: otwarte w terminie, otwarte zaległe, anulowane zaległe (automat P13),
-- zrobione w oknie. B: dwa otwarte zaległe (nie mogą przeciec do A).
INSERT INTO public.crm_tasks (tenant_id, lead_id, title, status, due_at, completed_at) VALUES
  ('d4500000-0000-0000-0000-0000000000a0', 'd4500000-0000-0000-0000-0000000001a1', 'Otwarte', 'open', now() + interval '2 days', NULL),
  ('d4500000-0000-0000-0000-0000000000a0', 'd4500000-0000-0000-0000-0000000001a1', 'Zaległe', 'open', now() - interval '2 days', NULL),
  ('d4500000-0000-0000-0000-0000000000a0', 'd4500000-0000-0000-0000-0000000001a1', 'Anulowane', 'cancelled', now() - interval '3 days', NULL),
  ('d4500000-0000-0000-0000-0000000000a0', 'd4500000-0000-0000-0000-0000000001a1', 'Zrobione', 'done', now() - interval '1 day', now() - interval '1 hour'),
  ('d4500000-0000-0000-0000-0000000000b0', 'd4500000-0000-0000-0000-0000000001b1', 'B1', 'open', now() - interval '1 day', NULL),
  ('d4500000-0000-0000-0000-0000000000b0', 'd4500000-0000-0000-0000-0000000001b1', 'B2', 'open', now() - interval '1 day', NULL);

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
CREATE TEMP TABLE res (r jsonb) ON COMMIT DROP;
GRANT SELECT, INSERT ON res TO authenticated;

SELECT ok(
  has_function_privilege('authenticated',
    'public.admin_dashboard_crm(timestamptz,timestamptz,timestamptz,timestamptz,text,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.admin_dashboard_crm(timestamptz,timestamptz,timestamptz,timestamptz,text,integer)', 'EXECUTE'),
  'acl: admin_dashboard_crm dla authenticated (bramka w ciele), nie dla anon');

SELECT pg_temp.as_user('d4500000-0000-0000-0000-00000000a001');
SET LOCAL ROLE authenticated;
INSERT INTO res SELECT public.admin_dashboard_crm(
  now() - interval '7 days', now() + interval '1 minute',
  now() - interval '14 days', now() - interval '7 days', 'day', 0);
RESET ROLE;

SELECT is((SELECT (r -> 'totals' ->> 'tasksOpen')::int FROM res), 2,
  'D11: tasksOpen liczy tylko otwarte (anulowane i zrobione poza)');
SELECT is((SELECT (r -> 'totals' ->> 'tasksOverdue')::int FROM res), 1,
  'D11: tasksOverdue bez anulowanego zaległego zadania');
SELECT is((SELECT (r -> 'totals' ->> 'tasksDone')::int FROM res), 1,
  'tasksDone: domknięcia w oknie bez zmian');
-- Profile fixture'u też zakładają leady (crm_upsert_lead_from_profile), więc
-- wzorcem jest liczba leadów najemcy A, nie stała.
SELECT is((SELECT (r -> 'totals' ->> 'leads')::int FROM res),
  (SELECT count(*)::int FROM public.crm_leads WHERE tenant_id = 'd4500000-0000-0000-0000-0000000000a0'),
  'izolacja: liczniki tylko najemcy z sesji');
SELECT is(
  (SELECT array_agg(k ORDER BY k) FROM res, jsonb_object_keys(r -> 'totals') k),
  ARRAY['companies', 'leads', 'tasksDone', 'tasksOpen', 'tasksOverdue'],
  'kontrakt: klucze totals bez zmian (CrmPanel)');

SELECT pg_temp.as_user('d4500000-0000-0000-0000-00000000b001');
SET LOCAL ROLE authenticated;
SELECT is(
  (public.admin_dashboard_crm(now() - interval '7 days', now(), now() - interval '14 days',
     now() - interval '7 days', 'day', 0) -> 'totals' ->> 'tasksOverdue')::int,
  2, 'izolacja: najemca B widzi własne zaległe');
RESET ROLE;

SELECT pg_temp.as_user('d4500000-0000-0000-0000-00000000a003');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.admin_dashboard_crm(now() - interval '7 days', now(), now() - interval '14 days',
       now() - interval '7 days', 'day', 0) $$,
  '42501', NULL, 'autor: 42501');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
