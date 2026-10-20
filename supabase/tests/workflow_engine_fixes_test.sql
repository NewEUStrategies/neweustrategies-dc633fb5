-- pgTAP: silnik przepisów po naprawach D3-D6 + zdarzenie zmiany przepisu
-- (migracja 20261020130300, hub S4).
--
-- Sprawdza:
--   * D6: to samo zdarzenie dostarczone dwa razy = jeden przebieg (indeks
--     unikalny + zajęcie pary przed krokami), druga dostawa nie powtarza
--     efektu kroku;
--   * D3: przebieg `failed` ma `steps_completed = 0` (savepoint cofnął kroki)
--     i komunikat z numerem i akcją kroku; efekt kroku 1 cofnięty;
--   * D5: awaria całego silnika zostawia ślad w `domain_event_emit_errors`,
--     a zdarzenie źródłowe zostaje zapisane;
--   * D4: autor nie zainstaluje przepisu przez RPC ani nie włączy wyłączonego
--     (RLS), redaktor tak;
--   * `workflow_definition.changed.v1`: emisja przy włączeniu/zmianie, brak
--     emisji przy samym `updated_at`, payload bez treści kroków;
--   * ACL funkcji wyzwalaczy.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test workflow_engine_fixes
BEGIN;
SELECT plan(18);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('d4400000-0000-0000-0000-0000000000a0', 'hub-s4-eng-a', 'Hub S4 silnik A');

INSERT INTO auth.users (id, email) VALUES
  ('d4400000-0000-0000-0000-00000000a001', 'admin-a@hub-s4-eng.test'),
  ('d4400000-0000-0000-0000-00000000a002', 'editor-a@hub-s4-eng.test'),
  ('d4400000-0000-0000-0000-00000000a003', 'author-a@hub-s4-eng.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d4400000-0000-0000-0000-00000000a001', 'admin-a@hub-s4-eng.test', 'Admin A', 'd4400000-0000-0000-0000-0000000000a0'),
  ('d4400000-0000-0000-0000-00000000a002', 'editor-a@hub-s4-eng.test', 'Editor A', 'd4400000-0000-0000-0000-0000000000a0'),
  ('d4400000-0000-0000-0000-00000000a003', 'author-a@hub-s4-eng.test', 'Author A', 'd4400000-0000-0000-0000-0000000000a0');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('d4400000-0000-0000-0000-00000000a001', 'admin', 'd4400000-0000-0000-0000-0000000000a0'),
  ('d4400000-0000-0000-0000-00000000a002', 'editor', 'd4400000-0000-0000-0000-0000000000a0'),
  ('d4400000-0000-0000-0000-00000000a003', 'author', 'd4400000-0000-0000-0000-0000000000a0');

INSERT INTO public.crm_leads (id, tenant_id, email, email_norm) VALUES
  ('d4400000-0000-0000-0000-0000000001a1', 'd4400000-0000-0000-0000-0000000000a0', 'lead@hub-s4-eng.test', 'lead@hub-s4-eng.test');

-- Przepis 1: dwa udane kroki (tag na leadzie zdarzenia). Przepis 2: krok 1
-- udany (tag), krok 2 pada (nieznana akcja) - savepoint cofa oba.
INSERT INTO public.workflow_definitions (id, tenant_id, name, trigger_event_type, steps) VALUES
  ('d4400000-0000-0000-0000-0000000003a1', 'd4400000-0000-0000-0000-0000000000a0', 'Udany',
   'test_engine.ping.v1',
   '[{"action":"add_tag","params":{"tag":"ping-ok"}},{"action":"add_tag","params":{"tag":"ping-ok-2"}}]'),
  ('d4400000-0000-0000-0000-0000000003a2', 'd4400000-0000-0000-0000-0000000000a0', 'Psujący',
   'test_engine.ping.v1',
   '[{"action":"add_tag","params":{"tag":"ping-cofniety"}},{"action":"send_sms","params":{}}]');

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
CREATE FUNCTION pg_temp.deliver(p_id uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.domain_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload)
  VALUES (p_id, 'd4400000-0000-0000-0000-0000000000a0', 'crm_lead',
          'd4400000-0000-0000-0000-0000000001a1', 'test_engine.ping.v1', '{}'::jsonb)
$$;

-- ── 1. Struktura i ACL ───────────────────────────────────────────────────────
SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
           AND indexname = 'workflow_runs_workflow_event_uidx'
           AND indexdef LIKE '%UNIQUE%(workflow_id, event_id)%'),
  'D6: indeks unikalny workflow_runs (workflow_id, event_id)');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.tg_run_workflows_for_event()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.tg_workflow_definitions_emit()', 'EXECUTE'),
  'acl: funkcje wyzwalaczy silnika bez EXECUTE dla authenticated');
SELECT ok(
  has_function_privilege('authenticated', 'public.install_workflow_template(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.install_workflow_template(text)', 'EXECUTE'),
  'acl: install_workflow_template dla authenticated (bramka w ciele), nie dla anon');

-- ── 2. D6: powtórna dostawa zdarzenia ───────────────────────────────────────
SELECT pg_temp.deliver('d4400000-0000-0000-0000-0000000004a1');
-- Odtworzenie szyny: to samo zdarzenie (ten sam id) przychodzi drugi raz.
DELETE FROM public.domain_events WHERE id = 'd4400000-0000-0000-0000-0000000004a1';
UPDATE public.crm_leads SET tags = '{}' WHERE id = 'd4400000-0000-0000-0000-0000000001a1';
SELECT pg_temp.deliver('d4400000-0000-0000-0000-0000000004a1');

SELECT is(
  (SELECT count(*)::int FROM public.workflow_runs
    WHERE workflow_id = 'd4400000-0000-0000-0000-0000000003a1'
      AND event_id = 'd4400000-0000-0000-0000-0000000004a1'),
  1, 'D6: to samo zdarzenie dwa razy = jeden przebieg przepisu');
SELECT ok(
  (SELECT NOT ('ping-ok' = ANY (tags)) FROM public.crm_leads WHERE id = 'd4400000-0000-0000-0000-0000000001a1'),
  'D6: druga dostawa nie wykonała kroków ponownie');
SELECT is(
  (SELECT status || '|' || steps_completed FROM public.workflow_runs
    WHERE workflow_id = 'd4400000-0000-0000-0000-0000000003a1'
      AND event_id = 'd4400000-0000-0000-0000-0000000004a1'),
  'succeeded|2', 'przebieg udany liczy wszystkie kroki');

-- ── 3. D3: uczciwy licznik porażki ──────────────────────────────────────────
SELECT is(
  (SELECT status || '|' || steps_completed FROM public.workflow_runs
    WHERE workflow_id = 'd4400000-0000-0000-0000-0000000003a2'
      AND event_id = 'd4400000-0000-0000-0000-0000000004a1'),
  'failed|0', 'D3: porażka = steps_completed 0 (kroki cofnięte savepointem)');
SELECT matches(
  (SELECT error FROM public.workflow_runs
    WHERE workflow_id = 'd4400000-0000-0000-0000-0000000003a2'
      AND event_id = 'd4400000-0000-0000-0000-0000000004a1'),
  '^step 2 \(send_sms\): workflow: unknown action send_sms',
  'D3: komunikat wskazuje numer i akcję kroku, który padł');
SELECT is(
  (SELECT count(*)::int FROM public.workflow_runs
    WHERE workflow_id = 'd4400000-0000-0000-0000-0000000003a2'
      AND event_id = 'd4400000-0000-0000-0000-0000000004a1'),
  1, 'D6: przebieg nieudany też zajmuje parę - powtórka go nie mnoży');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.crm_leads
               WHERE id = 'd4400000-0000-0000-0000-0000000001a1' AND 'ping-cofniety' = ANY (tags)),
  'D3: efekt kroku 1 nieudanego przebiegu cofnięty');

-- ── 4. D5: ślad awarii silnika ──────────────────────────────────────────────
-- Wymuszona awaria poza krokami: zajęcie przebiegu łamie ograniczenie.
ALTER TABLE public.workflow_runs
  ADD CONSTRAINT hub_s4_engine_fail CHECK (event_id <> 'd4400000-0000-0000-0000-0000000004a2') NOT VALID;
SELECT lives_ok(
  $$ SELECT pg_temp.deliver('d4400000-0000-0000-0000-0000000004a2') $$,
  'D5: awaria silnika nie blokuje zapisu zdarzenia');
ALTER TABLE public.workflow_runs DROP CONSTRAINT hub_s4_engine_fail;
SELECT ok(
  EXISTS (SELECT 1 FROM public.domain_event_emit_errors
           WHERE tenant_id = 'd4400000-0000-0000-0000-0000000000a0'
             AND source = 'tg_run_workflows_for_event'
             AND event_type = 'test_engine.ping.v1'
             AND sqlstate = '23514'),
  'D5: awaria silnika zapisana w domain_event_emit_errors (źródło, typ, SQLSTATE)');

-- ── 5. D4: bramka instalacji i włączania ────────────────────────────────────
SELECT pg_temp.as_user('d4400000-0000-0000-0000-00000000a003');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.install_workflow_template('newsletter-confirmed-to-crm') $$,
  '42501', 'workflows: admin or editor only', 'D4: autor nie zainstaluje przepisu z katalogu');
UPDATE public.workflow_definitions SET enabled = false WHERE id = 'd4400000-0000-0000-0000-0000000003a1';
RESET ROLE;
SELECT is(
  (SELECT enabled FROM public.workflow_definitions WHERE id = 'd4400000-0000-0000-0000-0000000003a1'),
  true, 'D4: autor nie przełączy przepisu (RLS definicji)');

SELECT pg_temp.as_user('d4400000-0000-0000-0000-00000000a002');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.install_workflow_template('newsletter-confirmed-to-crm') $$,
  'D4: redaktor instaluje przepis z katalogu');
RESET ROLE;

-- ── 6. workflow_definition.changed.v1 ───────────────────────────────────────
SELECT is(
  (SELECT payload ->> 'op' FROM public.domain_events
    WHERE event_type = 'workflow_definition.changed.v1'
      AND tenant_id = 'd4400000-0000-0000-0000-0000000000a0'
      AND payload ->> 'workflow_id' = (SELECT id::text FROM public.workflow_definitions
                                         WHERE tenant_id = 'd4400000-0000-0000-0000-0000000000a0'
                                           AND template_key = 'newsletter-confirmed-to-crm')),
  'insert', 'zdarzenie: instalacja przepisu emituje changed.v1 (op insert)');

SELECT pg_temp.as_user('d4400000-0000-0000-0000-00000000a001');
SET LOCAL ROLE authenticated;
UPDATE public.workflow_definitions SET enabled = false WHERE id = 'd4400000-0000-0000-0000-0000000003a1';
UPDATE public.workflow_definitions SET updated_at = now() + interval '1 minute'
 WHERE id = 'd4400000-0000-0000-0000-0000000003a1';
RESET ROLE;
SELECT is(
  (SELECT string_agg((payload ->> 'enabled') || '/' || (payload ->> 'op'), ',' ORDER BY payload ->> 'op')
     FROM public.domain_events
    WHERE event_type = 'workflow_definition.changed.v1'
      AND payload ->> 'workflow_id' = 'd4400000-0000-0000-0000-0000000003a1'),
  'true/insert,false/update',
  'zdarzenie: utworzenie i wyłączenie emitują changed.v1, sam stempel updated_at nie');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.domain_events
               WHERE event_type = 'workflow_definition.changed.v1'
                 AND tenant_id = 'd4400000-0000-0000-0000-0000000000a0'
                 AND (payload ? 'steps' OR payload ? 'name')),
  'zdarzenie: payload bez treści kroków i nazwy przepisu');

SELECT * FROM finish();
ROLLBACK;
