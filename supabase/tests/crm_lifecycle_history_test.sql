-- pgTAP: cykl życia leada - historia etapów, pierwszeństwo pisarzy, strażnik
-- kolumn huba Z-06 (migracja 20261020130000, hub S4).
--
-- Sprawdza:
--   * historia `crm_lead_stage_history` z GUC `app.change_source` (silnik),
--     a bez GUC - `manual` dla sesji klienta i aktor = `auth.uid()`;
--   * pierwszeństwo `billing > manual > journey = workflow > system`: billing
--     ustawia `customer`, akcja ścieżki `lead` -> `skipped: precedence`,
--     człowiek nie nadpisze płatności, cofnięcie wymaga `p_allow_backward`;
--   * emisja `crm_lead.lifecycle_changed.v1` {lead_id, from, to, source};
--   * Z-06: admin i redaktor przez PostgREST (rola `authenticated` + claims)
--     dostają 42501 przy zmianie `user_id`, `lifecycle_stage`,
--     `lifecycle_changed_at` i `crm_tasks.source`/`origin_ref`; RPC przechodzi;
--     `customer` bez źródła billing - odmowa także dla `service_role`;
--   * granty kolumnowe `crm_tasks` kompletne (nowa kolumna = czerwień);
--   * dwóch najemców (lead B niewidoczny dla RPC A), autor bez dostępu;
--   * backfill historii z `audit_log` idempotentny;
--   * awaria emisji nie wycofuje zapisu leada (ślad w `domain_event_emit_errors`).
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test crm_lifecycle_history
BEGIN;
SELECT plan(39);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('d4100000-0000-0000-0000-0000000000a0', 'hub-s4-lc-a', 'Hub S4 lifecycle A'),
  ('d4100000-0000-0000-0000-0000000000b0', 'hub-s4-lc-b', 'Hub S4 lifecycle B');

INSERT INTO auth.users (id, email) VALUES
  ('d4100000-0000-0000-0000-00000000a001', 'admin-a@hub-s4-lc.test'),
  ('d4100000-0000-0000-0000-00000000a002', 'editor-a@hub-s4-lc.test'),
  ('d4100000-0000-0000-0000-00000000a003', 'author-a@hub-s4-lc.test'),
  ('d4100000-0000-0000-0000-00000000b001', 'admin-b@hub-s4-lc.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d4100000-0000-0000-0000-00000000a001', 'admin-a@hub-s4-lc.test', 'Admin A', 'd4100000-0000-0000-0000-0000000000a0'),
  ('d4100000-0000-0000-0000-00000000a002', 'editor-a@hub-s4-lc.test', 'Editor A', 'd4100000-0000-0000-0000-0000000000a0'),
  ('d4100000-0000-0000-0000-00000000a003', 'author-a@hub-s4-lc.test', 'Author A', 'd4100000-0000-0000-0000-0000000000a0'),
  ('d4100000-0000-0000-0000-00000000b001', 'admin-b@hub-s4-lc.test', 'Admin B', 'd4100000-0000-0000-0000-0000000000b0');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('d4100000-0000-0000-0000-00000000a001', 'admin', 'd4100000-0000-0000-0000-0000000000a0'),
  ('d4100000-0000-0000-0000-00000000a002', 'editor', 'd4100000-0000-0000-0000-0000000000a0'),
  ('d4100000-0000-0000-0000-00000000a003', 'author', 'd4100000-0000-0000-0000-0000000000a0'),
  ('d4100000-0000-0000-0000-00000000b001', 'admin', 'd4100000-0000-0000-0000-0000000000b0');

-- Leady A: l1 (klient w drodze), l2 (ścieżka), l3 (zadania), l4 (backfill);
-- lead B.
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm) VALUES
  ('d4100000-0000-0000-0000-0000000001a1', 'd4100000-0000-0000-0000-0000000000a0', 'l1@hub-s4-lc.test', 'l1@hub-s4-lc.test'),
  ('d4100000-0000-0000-0000-0000000001a2', 'd4100000-0000-0000-0000-0000000000a0', 'l2@hub-s4-lc.test', 'l2@hub-s4-lc.test'),
  ('d4100000-0000-0000-0000-0000000001a3', 'd4100000-0000-0000-0000-0000000000a0', 'l3@hub-s4-lc.test', 'l3@hub-s4-lc.test'),
  ('d4100000-0000-0000-0000-0000000001a4', 'd4100000-0000-0000-0000-0000000000a0', 'l4@hub-s4-lc.test', 'l4@hub-s4-lc.test'),
  ('d4100000-0000-0000-0000-0000000001b1', 'd4100000-0000-0000-0000-0000000000b0', 'b1@hub-s4-lc.test', 'b1@hub-s4-lc.test');

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
CREATE TEMP TABLE res (name text PRIMARY KEY, r jsonb) ON COMMIT DROP;
GRANT SELECT, INSERT ON res TO authenticated, service_role;

-- ── 1. ACL ───────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.crm_set_lifecycle_stage(uuid,text,text,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.crm_set_lifecycle_stage(uuid,text,text,boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.crm_set_lifecycle_stage(uuid,text,text,boolean)', 'EXECUTE'),
  'acl: crm_set_lifecycle_stage wyłącznie dla service_role');
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_crm_set_lifecycle_stage(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_crm_set_lifecycle_stage(uuid,text)', 'EXECUTE'),
  'acl: admin_crm_set_lifecycle_stage dla authenticated, nie dla anon');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.tg_crm_leads_stage_history()', 'EXECUTE'),
  'acl: funkcja wyzwalacza bez EXECUTE dla authenticated');

-- ── 2. Historia: GUC źródła i sesja klienta ─────────────────────────────────
SELECT set_config('app.change_source', 'workflow', true);
UPDATE public.crm_leads SET stage = 'contacted' WHERE id = 'd4100000-0000-0000-0000-0000000001a2';
SELECT set_config('app.change_source', '', true);
SELECT is(
  (SELECT source || '|' || from_value || '>' || to_value FROM public.crm_lead_stage_history
    WHERE lead_id = 'd4100000-0000-0000-0000-0000000001a2' AND dimension = 'crm_stage'),
  'workflow|new>contacted',
  'historia: etap CRM ze źródłem z GUC app.change_source');

SELECT pg_temp.as_user('d4100000-0000-0000-0000-00000000a001');
SET LOCAL ROLE authenticated;
UPDATE public.crm_leads SET stage = 'qualified' WHERE id = 'd4100000-0000-0000-0000-0000000001a1';
RESET ROLE;
SELECT is(
  (SELECT source || '|' || actor_id::text FROM public.crm_lead_stage_history
    WHERE lead_id = 'd4100000-0000-0000-0000-0000000001a1' AND dimension = 'crm_stage'),
  'manual|d4100000-0000-0000-0000-00000000a001',
  'historia: zmiana z panelu (PostgREST) = manual z aktorem admina');

-- ── 3. Z-06: strażnik kolumn huba przez PostgREST ───────────────────────────
SELECT pg_temp.as_user('d4100000-0000-0000-0000-00000000a001');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ UPDATE public.crm_leads SET lifecycle_stage = 'lead' WHERE id = 'd4100000-0000-0000-0000-0000000001a1' $$,
  '42501', 'crm_hub_column_protected', 'Z-06: admin przez PostgREST nie zmieni lifecycle_stage');
SELECT throws_ok(
  $$ UPDATE public.crm_leads SET lifecycle_changed_at = now() WHERE id = 'd4100000-0000-0000-0000-0000000001a1' $$,
  '42501', 'crm_hub_column_protected', 'Z-06: admin nie ustawi lifecycle_changed_at');
RESET ROLE;

SELECT pg_temp.as_user('d4100000-0000-0000-0000-00000000a002');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ UPDATE public.crm_leads SET user_id = 'd4100000-0000-0000-0000-00000000a002' WHERE id = 'd4100000-0000-0000-0000-0000000001a1' $$,
  '42501', 'crm_hub_column_protected', 'Z-06: redaktor nie podepnie konta (user_id) pod lead');
SELECT throws_ok(
  $$ INSERT INTO public.crm_leads (tenant_id, email, email_norm, lifecycle_stage)
     VALUES ('d4100000-0000-0000-0000-0000000000a0', 'new1@hub-s4-lc.test', 'new1@hub-s4-lc.test', 'lead') $$,
  '42501', 'crm_hub_column_protected', 'Z-06: redaktor nie wstawi leada z etapem cyklu życia');
SELECT lives_ok(
  $$ INSERT INTO public.crm_leads (tenant_id, email, email_norm)
     VALUES ('d4100000-0000-0000-0000-0000000000a0', 'new2@hub-s4-lc.test', 'new2@hub-s4-lc.test') $$,
  'Z-06: zwykły INSERT leada z panelu (wartości domyślne) przechodzi');
SELECT lives_ok(
  $$ UPDATE public.crm_leads SET tags = ARRAY['vip'] WHERE id = 'd4100000-0000-0000-0000-0000000001a1' $$,
  'Z-06: zwykła edycja leada (tagi) przez redaktora przechodzi');
RESET ROLE;

-- ── 4. RPC panelu: ręczna zmiana etapu ──────────────────────────────────────
SELECT pg_temp.as_user('d4100000-0000-0000-0000-00000000a002');
SET LOCAL ROLE authenticated;
INSERT INTO res VALUES ('manual_mql',
  public.admin_crm_set_lifecycle_stage('d4100000-0000-0000-0000-0000000001a1', 'mql'));
INSERT INTO res VALUES ('manual_customer',
  public.admin_crm_set_lifecycle_stage('d4100000-0000-0000-0000-0000000001a1', 'customer'));
SELECT throws_ok(
  $$ SELECT public.admin_crm_set_lifecycle_stage('d4100000-0000-0000-0000-0000000001b1', 'lead') $$,
  'P0002', 'lead_not_found', 'najemca: lead innego najemcy = brak (bez wyroczni istnienia)');
SELECT throws_ok(
  $$ SELECT public.admin_crm_set_lifecycle_stage('d4100000-0000-0000-0000-0000000001a1', 'vip') $$,
  '22023', 'lifecycle_stage_invalid', 'walidacja: etap spoza listy D-01 odrzucony');
RESET ROLE;

SELECT is((SELECT r ->> 'changed' FROM res WHERE name = 'manual_mql'), 'true',
  'RPC: redaktor ustawia mql');
SELECT is(
  (SELECT lifecycle_stage FROM public.crm_leads WHERE id = 'd4100000-0000-0000-0000-0000000001a1'),
  'mql', 'RPC: etap zapisany');
SELECT ok(
  (SELECT lifecycle_changed_at IS NOT NULL FROM public.crm_leads WHERE id = 'd4100000-0000-0000-0000-0000000001a1'),
  'RPC: lifecycle_changed_at ostemplowany przez wyzwalacz');
SELECT is(
  (SELECT source || '|' || actor_id::text || '|' || from_value || '>' || to_value
     FROM public.crm_lead_stage_history
    WHERE lead_id = 'd4100000-0000-0000-0000-0000000001a1' AND dimension = 'lifecycle'),
  'manual|d4100000-0000-0000-0000-00000000a002|subscriber>mql',
  'historia: cykl życia z RPC = manual, aktor redaktor');
SELECT is(
  (SELECT payload FROM public.domain_events
    WHERE event_type = 'crm_lead.lifecycle_changed.v1'
      AND aggregate_id = 'd4100000-0000-0000-0000-0000000001a1'),
  jsonb_build_object('lead_id', 'd4100000-0000-0000-0000-0000000001a1', 'from', 'subscriber', 'to', 'mql', 'source', 'manual'),
  'emisja: crm_lead.lifecycle_changed.v1 z payloadem bez PII');
SELECT is((SELECT r ->> 'skipped' FROM res WHERE name = 'manual_customer'), 'billing_owned',
  'RPC: człowiek nie nada etapu klienta (billing_owned)');

SELECT pg_temp.as_user('d4100000-0000-0000-0000-00000000a003');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.admin_crm_set_lifecycle_stage('d4100000-0000-0000-0000-0000000001a1', 'lead') $$,
  '42501', 'forbidden', 'rola: autor -> 42501');
RESET ROLE;

-- ── 5. Pierwszeństwo pisarzy (service_role) ─────────────────────────────────
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('billing_customer',
  public.crm_set_lifecycle_stage('d4100000-0000-0000-0000-0000000001a1', 'customer', 'billing', false));
INSERT INTO res VALUES ('journey_lead',
  public.crm_set_lifecycle_stage('d4100000-0000-0000-0000-0000000001a1', 'lead', 'journey', true));
INSERT INTO res VALUES ('manual_after_billing',
  public.crm_set_lifecycle_stage('d4100000-0000-0000-0000-0000000001a1', 'lead', 'manual', true));
INSERT INTO res VALUES ('wf_mql',
  public.crm_set_lifecycle_stage('d4100000-0000-0000-0000-0000000001a2', 'mql', 'workflow', false));
INSERT INTO res VALUES ('wf_back',
  public.crm_set_lifecycle_stage('d4100000-0000-0000-0000-0000000001a2', 'lead', 'workflow', false));
INSERT INTO res VALUES ('journey_back_allowed',
  public.crm_set_lifecycle_stage('d4100000-0000-0000-0000-0000000001a2', 'lead', 'journey', true));
INSERT INTO res VALUES ('system_over_journey',
  public.crm_set_lifecycle_stage('d4100000-0000-0000-0000-0000000001a2', 'sql', 'system', false));
SELECT throws_ok(
  $$ UPDATE public.crm_leads SET lifecycle_stage = 'customer' WHERE id = 'd4100000-0000-0000-0000-0000000001a2' $$,
  '42501', 'crm_lifecycle_billing_owned',
  'strażnik: service_role bez źródła billing nie ustawi customer');
RESET ROLE;

SELECT is((SELECT r ->> 'changed' FROM res WHERE name = 'billing_customer'), 'true',
  'pierwszeństwo: billing ustawia customer');
SELECT is((SELECT r ->> 'skipped' FROM res WHERE name = 'journey_lead'), 'precedence',
  'pierwszeństwo: krok ścieżki set_lifecycle_stage(lead) po billingu -> skipped precedence');
SELECT is((SELECT r ->> 'skipped' FROM res WHERE name = 'manual_after_billing'), 'precedence',
  'pierwszeństwo: człowiek nie nadpisze etapu z płatności');
SELECT is(
  (SELECT lifecycle_stage FROM public.crm_leads WHERE id = 'd4100000-0000-0000-0000-0000000001a1'),
  'customer', 'pierwszeństwo: lead pozostaje klientem');
SELECT is((SELECT r ->> 'skipped' FROM res WHERE name = 'wf_back'), 'backward',
  'cofnięcie: automat bez p_allow_backward nie cofa etapu');
SELECT is((SELECT r ->> 'changed' FROM res WHERE name = 'journey_back_allowed'), 'true',
  'cofnięcie: ścieżka (= przepis) z p_allow_backward cofa etap przepisu');
SELECT is((SELECT r ->> 'skipped' FROM res WHERE name = 'system_over_journey'), 'precedence',
  'pierwszeństwo: system nie nadpisuje ścieżki');
SELECT is(
  (SELECT string_agg(source, ',' ORDER BY id) FROM public.crm_lead_stage_history
    WHERE lead_id = 'd4100000-0000-0000-0000-0000000001a2' AND dimension = 'lifecycle'),
  'workflow,journey',
  'historia: wyłącznie zmiany wykonane (odmowy nie zostawiają wpisu)');

-- ── 6. Z-06 dla zadań: granty kolumnowe ─────────────────────────────────────
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.crm_tasks', 'source', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'public.crm_tasks', 'source', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.crm_tasks', 'origin_ref', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'public.crm_tasks', 'origin_ref', 'UPDATE'),
  'Z-06: authenticated bez grantu na crm_tasks.source i origin_ref');
SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
    WHERE a.attrelid = 'public.crm_tasks'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname NOT IN ('source', 'origin_ref')
      AND NOT (has_column_privilege('authenticated', 'public.crm_tasks', a.attname, 'INSERT')
               AND has_column_privilege('authenticated', 'public.crm_tasks', a.attname, 'UPDATE'))),
  NULL,
  'Z-06: każda pozostała kolumna crm_tasks ma INSERT i UPDATE dla authenticated (nowa kolumna = dopisz grant)');

SELECT pg_temp.as_user('d4100000-0000-0000-0000-00000000a001');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ INSERT INTO public.crm_tasks (tenant_id, lead_id, title, due_at, created_by, source)
     VALUES ('d4100000-0000-0000-0000-0000000000a0', 'd4100000-0000-0000-0000-0000000001a3', 'X', now(),
             'd4100000-0000-0000-0000-00000000a001', 'workflow') $$,
  '42501', NULL, 'Z-06: admin przez PostgREST nie poda źródła zadania');
INSERT INTO public.crm_tasks (id, tenant_id, lead_id, title, due_at, created_by)
VALUES ('d4100000-0000-0000-0000-0000000002a1', 'd4100000-0000-0000-0000-0000000000a0',
        'd4100000-0000-0000-0000-0000000001a3', 'Telefon', now() + interval '1 day',
        'd4100000-0000-0000-0000-00000000a001');
SELECT throws_ok(
  $$ UPDATE public.crm_tasks SET origin_ref = 'workflow:zajete' WHERE id = 'd4100000-0000-0000-0000-0000000002a1' $$,
  '42501', NULL, 'Z-06: admin nie zajmie origin_ref zadania');
SELECT lives_ok(
  $$ UPDATE public.crm_tasks SET status = 'done' WHERE id = 'd4100000-0000-0000-0000-0000000002a1' $$,
  'Z-06: zwykła edycja zadania (status) przechodzi');
RESET ROLE;
SELECT is(
  (SELECT source FROM public.crm_tasks WHERE id = 'd4100000-0000-0000-0000-0000000002a1'),
  'manual', 'zadanie z panelu dostaje source = manual z wartości domyślnej');

-- ── 7. Backfill historii z audit_log (idempotentny) ─────────────────────────
INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata, created_at)
VALUES ('d4100000-0000-0000-0000-0000000000a0', 'd4100000-0000-0000-0000-00000000a001',
        'crm_lead.stage_change', 'crm_lead', 'd4100000-0000-0000-0000-0000000001a4',
        '{"from":"new","to":"contacted"}', '2026-09-01 10:00+00');
CREATE FUNCTION pg_temp.backfill() RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.crm_lead_stage_history (
    tenant_id, lead_id, dimension, from_value, to_value, source, actor_id, changed_at
  )
  SELECT a.tenant_id, a.entity_id, 'crm_stage', NULLIF(a.metadata ->> 'from', ''),
         a.metadata ->> 'to', 'backfill', a.actor_id, a.created_at
    FROM public.audit_log a
    JOIN public.crm_leads l ON l.id = a.entity_id AND l.tenant_id = a.tenant_id
   WHERE a.action = 'crm_lead.stage_change'
     AND a.entity_type = 'crm_lead'
     AND NULLIF(a.metadata ->> 'to', '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.crm_lead_stage_history h
        WHERE h.tenant_id = a.tenant_id AND h.lead_id = a.entity_id AND h.dimension = 'crm_stage'
     );
$$;
SELECT pg_temp.backfill();
SELECT pg_temp.backfill();
SELECT ok(
  (SELECT count(*) = 1 AND min(source) = 'backfill'
          AND min(changed_at) = '2026-09-01 10:00+00'::timestamptz
          AND min(actor_id::text) = 'd4100000-0000-0000-0000-00000000a001'
     FROM public.crm_lead_stage_history
    WHERE lead_id = 'd4100000-0000-0000-0000-0000000001a4'),
  'backfill: wpis z audit_log ze źródłem backfill, aktorem i czasem wpisu, powtórka bez duplikatu');

-- ── 8. Izolacja awarii emisji (na końcu - podmienia emiter w transakcji) ────
CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid, p_aggregate_type text, p_aggregate_id text, p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb, p_actor_id uuid DEFAULT NULL, p_suppress_actor boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'szyna niedostępna'; END $$;
SET LOCAL ROLE service_role;
INSERT INTO res VALUES ('emit_down',
  public.crm_set_lifecycle_stage('d4100000-0000-0000-0000-0000000001a3', 'lead', 'workflow', false));
RESET ROLE;
SELECT is(
  (SELECT lifecycle_stage FROM public.crm_leads WHERE id = 'd4100000-0000-0000-0000-0000000001a3'),
  'lead', 'awaria emisji: zmiana etapu zapisana mimo padniętej szyny');
SELECT ok(
  EXISTS (SELECT 1 FROM public.crm_lead_stage_history
           WHERE lead_id = 'd4100000-0000-0000-0000-0000000001a3' AND dimension = 'lifecycle'
             AND to_value = 'lead' AND source = 'workflow'),
  'awaria emisji: historia etapu zostaje (osobny blok od emisji)');
SELECT ok(
  EXISTS (SELECT 1 FROM public.domain_event_emit_errors
           WHERE source = 'tg_crm_leads_stage_history' AND tenant_id = 'd4100000-0000-0000-0000-0000000000a0'),
  'awaria emisji: ślad w domain_event_emit_errors');

SELECT * FROM finish();
ROLLBACK;
