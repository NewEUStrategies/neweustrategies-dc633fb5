-- pgTAP: RPC panelu ścieżek i narzędzia admina (migracje 20261020140300,
-- 140400, hub S5).
--
-- Sprawdza:
--   * create (admin|editor; autor odrzucony 42501; klucz zajęty 23505);
--   * save z optymistyczną współbieżnością (`p_expected_updated_at` niezgodne
--     = 40001);
--   * publish: tylko admin; walidacja grafu (22023 `graph_invalid`), brak
--     treści maila (22023 `content_missing`), wersja + suma kontrolna + trasy;
--   * treść maila: tylko węzeł `send_email`, temat > 200 odrzucony (CHECK);
--   * status: tylko admin, `active` wymaga publikacji, archiwum kończy zapisy
--     i zdejmuje trasy, z archiwum nie ma powrotu;
--   * ustawienia: tylko admin, biała lista kluczy, CHECK limitów, domyślnie
--     silnik WYŁĄCZONY, osoba domyślna = personel najemcy;
--   * `enroll_test` tylko własny kontakt (`crm_leads.user_id = auth.uid()`);
--     lista bez zapisów testowych w licznikach;
--   * `simulate` = zero wierszy w journey_*, email_send_log, crm_*;
--   * `trigger_estimate`, `engine_health`, wyjście i pominięcie czekania;
--   * izolacja najemców.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test journeys_admin_rpc
BEGIN;
SELECT plan(37);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO public.tenants (id, slug, name) VALUES
  ('e5600000-0000-0000-0000-0000000000a0', 'hub-s5-rpc-a', 'Hub S5 RPC A'),
  ('e5600000-0000-0000-0000-0000000000b0', 'hub-s5-rpc-b', 'Hub S5 RPC B');
INSERT INTO auth.users (id, email) VALUES
  ('e5600000-0000-0000-0000-00000000a001', 'admin-a@hub-s5-rpc.test'),
  ('e5600000-0000-0000-0000-00000000a002', 'editor-a@hub-s5-rpc.test'),
  ('e5600000-0000-0000-0000-00000000a003', 'autor-a@hub-s5-rpc.test'),
  ('e5600000-0000-0000-0000-00000000b001', 'admin-b@hub-s5-rpc.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e5600000-0000-0000-0000-00000000a001', 'admin-a@hub-s5-rpc.test', 'Admin A', 'e5600000-0000-0000-0000-0000000000a0'),
  ('e5600000-0000-0000-0000-00000000a002', 'editor-a@hub-s5-rpc.test', 'Editor A', 'e5600000-0000-0000-0000-0000000000a0'),
  ('e5600000-0000-0000-0000-00000000a003', 'autor-a@hub-s5-rpc.test', 'Autor A', 'e5600000-0000-0000-0000-0000000000a0'),
  ('e5600000-0000-0000-0000-00000000b001', 'admin-b@hub-s5-rpc.test', 'Admin B', 'e5600000-0000-0000-0000-0000000000b0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e5600000-0000-0000-0000-00000000a001', 'admin', 'e5600000-0000-0000-0000-0000000000a0'),
  ('e5600000-0000-0000-0000-00000000a002', 'editor', 'e5600000-0000-0000-0000-0000000000a0'),
  ('e5600000-0000-0000-0000-00000000a003', 'author', 'e5600000-0000-0000-0000-0000000000a0'),
  ('e5600000-0000-0000-0000-00000000b001', 'admin', 'e5600000-0000-0000-0000-0000000000b0');
-- Kontakt admina A (test na żywo) - wyzwalacz profilu mógł go już założyć.
INSERT INTO public.crm_leads (tenant_id, email, email_norm, user_id)
SELECT 'e5600000-0000-0000-0000-0000000000a0', 'admin-a@hub-s5-rpc.test', 'admin-a@hub-s5-rpc.test',
       'e5600000-0000-0000-0000-00000000a001'
 WHERE NOT EXISTS (SELECT 1 FROM public.crm_leads WHERE user_id = 'e5600000-0000-0000-0000-00000000a001');
UPDATE public.crm_leads SET user_id = 'e5600000-0000-0000-0000-00000000a001'
 WHERE tenant_id = 'e5600000-0000-0000-0000-0000000000a0' AND email_norm = 'admin-a@hub-s5-rpc.test';
-- Edytor A bez kontaktu CRM (test na żywo musi odmówić).
DELETE FROM public.crm_leads WHERE user_id = 'e5600000-0000-0000-0000-00000000a002';
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm) VALUES
  ('e5600000-0000-0000-0000-0000000001a1', 'e5600000-0000-0000-0000-0000000000a0', 'sim@hub-s5-rpc.test', 'sim@hub-s5-rpc.test');
INSERT INTO public.domain_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES
  ('e5600000-0000-0000-0000-0000000000a0', 'checkout', 'o1', 'checkout.abandoned.v1', '{"user_id":"u1","kind":"plan"}'),
  ('e5600000-0000-0000-0000-0000000000a0', 'checkout', 'o2', 'checkout.abandoned.v1', '{"user_id":"u2","kind":"plan"}'),
  ('e5600000-0000-0000-0000-0000000000a0', 'checkout', 'o3', 'checkout.abandoned.v1', '{"user_id":"u2","kind":"ticket"}'),
  ('e5600000-0000-0000-0000-0000000000b0', 'checkout', 'o4', 'checkout.abandoned.v1', '{"user_id":"u9","kind":"plan"}');

CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON r TO authenticated;
CREATE FUNCTION pg_temp.as_user(p_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO authenticated;

-- Graf poprawny: wyzwalacz -> czekanie -> mail -> wyjście.
CREATE FUNCTION pg_temp.draft(p_with_email boolean) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'graph', CASE WHEN p_with_email THEN
      '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"w","type":"wait","params":{"mode":"duration","minutes":60}},
                 {"id":"m","type":"send_email","params":{}},{"id":"x","type":"exit","params":{}}],
        "edges":[{"from":"t","to":"w","branch":"next"},{"from":"w","to":"m","branch":"next"},{"from":"m","to":"x","branch":"next"}]}'::jsonb
    ELSE
      '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"w","type":"wait","params":{"mode":"duration","minutes":60}},
                 {"id":"x","type":"exit","params":{}}],
        "edges":[{"from":"t","to":"w","branch":"next"},{"from":"w","to":"x","branch":"next"}]}'::jsonb END,
    'settings', '{"triggerEventType":"checkout.abandoned.v1","triggerCondition":{"kind":"plan"},"reentry":"never",
                  "goal":{"eventType":"checkout.completed.v1"},"exitEvents":[{"eventType":"retention_flow.completed.v1"}]}'::jsonb)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.draft(boolean) TO authenticated;

SET LOCAL ROLE authenticated;

-- ── 1. Create ────────────────────────────────────────────────────────────────
SELECT pg_temp.as_user('e5600000-0000-0000-0000-00000000a003');
SELECT throws_ok($$ SELECT public.admin_journey_create('autor-test', 'X') $$, '42501', NULL,
  'create: autor odrzucony (42501)');
SELECT pg_temp.as_user('e5600000-0000-0000-0000-00000000a002');
INSERT INTO r SELECT 'c_editor', public.admin_journey_create('kasa', 'Porzucona kasa', 'marketing', NULL, NULL,
  'abandoned_checkout', pg_temp.draft(true));
SELECT is((SELECT v ->> 'status' FROM r WHERE k = 'c_editor'), 'draft', 'create: redaktor zakłada szkic');
SELECT throws_ok($$ SELECT public.admin_journey_create('kasa', 'Duplikat') $$, '23505', 'key_taken',
  'create: klucz zajęty w najemcy (23505)');
SELECT throws_ok($$ SELECT public.admin_journey_create('usluga-x', 'Usługa', 'service') $$, '23514', NULL,
  'create: usługa bez podstawy prawnej odrzucona (CHECK)');

-- ── 2. Save ──────────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT public.admin_journey_save_draft(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid,
       now() - interval '1 day', pg_temp.draft(true)) $$,
  '40001', 'conflict', 'save: niezgodny p_expected_updated_at = konflikt (40001)');
INSERT INTO r SELECT 's1', public.admin_journey_save_draft(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid,
  ((SELECT v FROM r WHERE k = 'c_editor') ->> 'updated_at')::timestamptz, pg_temp.draft(true), 'Porzucona kasa (v1)');
SELECT is((SELECT name FROM public.journey_definitions WHERE id = ((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid),
  'Porzucona kasa (v1)', 'save: szkic i nazwa zapisane');

-- ── 3. Treść maila ───────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT public.admin_journey_email_content_save(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid,
       'w', 'A', 'Temat', NULL, NULL, NULL, '{"version":1,"blocks":[]}') $$,
  '22023', 'node_not_email', 'treść: węzeł inny niż send_email odrzucony');
SELECT throws_ok(
  format($$ SELECT public.admin_journey_email_content_save(%L::uuid, 'm', 'A', %L, NULL, NULL, NULL, '{"version":1,"blocks":[]}') $$,
    (SELECT v FROM r WHERE k = 'c_editor') ->> 'id', repeat('x', 201)),
  '23514', NULL, 'treść: temat > 200 znaków odrzucony (nie przycięty)');

-- ── 4. Publish ───────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT public.admin_journey_publish(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid,
       ((SELECT v FROM r WHERE k = 's1') ->> 'updated_at')::timestamptz) $$,
  '42501', NULL, 'publish: redaktor odrzucony (tylko admin)');
SELECT pg_temp.as_user('e5600000-0000-0000-0000-00000000a001');
SELECT throws_ok(
  $$ SELECT public.admin_journey_publish(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid,
       ((SELECT v FROM r WHERE k = 's1') ->> 'updated_at')::timestamptz) $$,
  '22023', 'content_missing', 'publish: mail bez treści odrzucony');
INSERT INTO r SELECT 'content', public.admin_journey_email_content_save(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid,
  'm', 'A', 'Wróć do koszyka', 'Back to your basket', NULL, NULL, '{"version":1,"blocks":[],"style":{}}');
-- Graf z cyklem (gałąź mail -> czekanie) odrzucony.
INSERT INTO r SELECT 'cyc', public.admin_journey_save_draft(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid,
  ((SELECT v FROM r WHERE k = 's1') ->> 'updated_at')::timestamptz,
  jsonb_set(pg_temp.draft(true), '{graph,edges}',
    '[{"from":"t","to":"w","branch":"next"},{"from":"w","to":"m","branch":"next"},{"from":"m","to":"w","branch":"next"}]'));
SELECT throws_ok(
  $$ SELECT public.admin_journey_publish(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid,
       ((SELECT v FROM r WHERE k = 'cyc') ->> 'updated_at')::timestamptz) $$,
  '22023', 'graph_invalid', 'publish: graf z cyklem odrzucony (walidacja SQL)');
INSERT INTO r SELECT 's2', public.admin_journey_save_draft(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid,
  ((SELECT v FROM r WHERE k = 'cyc') ->> 'updated_at')::timestamptz, pg_temp.draft(true));
INSERT INTO r SELECT 'p1', public.admin_journey_publish(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid,
  ((SELECT v FROM r WHERE k = 's2') ->> 'updated_at')::timestamptz);
SELECT is(((SELECT v FROM r WHERE k = 'p1') ->> 'version')::int, 1, 'publish: wersja 1');
RESET ROLE;
SELECT is(
  (SELECT string_agg(role || ':' || event_type, ',' ORDER BY role, event_type) FROM public.journey_event_routes
    WHERE journey_id = ((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid),
  'enroll:checkout.abandoned.v1,exit:newsletter_subscriber.unsubscribed.v1,exit:retention_flow.completed.v1,goal:checkout.completed.v1',
  'publish: trasy wejścia, celu, wyjścia i globalnego wypisu');
SELECT is(
  (SELECT count(*)::int FROM public.journey_email_contents
    WHERE journey_id = ((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid
      AND version_id = ((SELECT v FROM r WHERE k = 'p1') ->> 'version_id')::uuid),
  1, 'publish: treść maila skopiowana do wersji');
SET LOCAL ROLE authenticated;

-- ── 5. Ustawienia ────────────────────────────────────────────────────────────
INSERT INTO r SELECT 'set0', public.admin_journey_settings_get();
SELECT is((SELECT (v ->> 'enabled') || '|' || (v ->> 'marketing_cap_per_7d') || '|' || (v ->> 'quiet_start') || '-' ||
                  (v ->> 'quiet_end') || '|' || (v ->> 'timezone') FROM r WHERE k = 'set0'),
  'false|3|21:00-08:00|Europe/Warsaw', 'ustawienia: domyślnie silnik WYŁĄCZONY, D-03 (3/7 dni, 21:00-08:00 Warszawa)');
SELECT pg_temp.as_user('e5600000-0000-0000-0000-00000000a002');
SELECT throws_ok($$ SELECT public.admin_journey_settings_save('{"enabled":true}') $$, '42501', NULL,
  'ustawienia: redaktor nie zapisze (tylko admin)');
SELECT pg_temp.as_user('e5600000-0000-0000-0000-00000000a001');
SELECT throws_ok($$ SELECT public.admin_journey_settings_save('{"smtp_password":"x"}') $$, '22023', NULL,
  'ustawienia: klucz spoza białej listy odrzucony');
SELECT throws_ok($$ SELECT public.admin_journey_settings_save('{"marketing_cap_per_7d":21}') $$, '23514', NULL,
  'ustawienia: limit > 20 odrzucony (CHECK)');
SELECT throws_ok($$ SELECT public.admin_journey_settings_save('{"timezone":"Mars/Olympus"}') $$, '22023', 'timezone_invalid',
  'ustawienia: nieznana strefa odrzucona');
SELECT throws_ok($$ SELECT public.admin_journey_settings_save('{"default_task_assignee_id":"e5600000-0000-0000-0000-00000000b001"}') $$,
  '22023', 'assignee_not_staff', 'ustawienia: osoba domyślna spoza personelu najemcy odrzucona');
SELECT throws_ok(format($$ SELECT public.admin_journey_settings_save(jsonb_build_object('sender_name', %L)) $$, repeat('n', 121)),
  '23514', NULL, 'ustawienia: nadawca > 120 znaków odrzucony (nie przycięty)');
INSERT INTO r SELECT 'set1', public.admin_journey_settings_save(
  '{"enabled":true,"sender_name":"Redakcja NES","reply_to":"redakcja@nes.example","quiet_start":"22:00"}');
SELECT is((SELECT (v ->> 'enabled') || '|' || (v ->> 'sender_name') || '|' || (v ->> 'quiet_start') || '|' || (v ->> 'quiet_end')
             FROM r WHERE k = 'set1'),
  'true|Redakcja NES|22:00|08:00', 'ustawienia: łatka zmienia tylko podane klucze');

-- ── 6. Test na żywo, lista, symulacja ────────────────────────────────────────
SELECT pg_temp.as_user('e5600000-0000-0000-0000-00000000a002');
SELECT throws_ok(
  $$ SELECT public.admin_journey_enroll_test(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid) $$,
  'P0002', 'own_lead_missing', 'enroll_test: bez WŁASNEGO kontaktu odmowa (nie cudzy lead)');
SELECT pg_temp.as_user('e5600000-0000-0000-0000-00000000a001');
INSERT INTO r SELECT 'test', public.admin_journey_enroll_test(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid);
RESET ROLE;
SELECT is(
  (SELECT e.is_test::text || '|' || l.user_id::text FROM public.journey_enrollments e
     JOIN public.crm_leads l ON l.id = e.lead_id
    WHERE e.id = ((SELECT v FROM r WHERE k = 'test') ->> 'enrollment_id')::uuid),
  'true|e5600000-0000-0000-0000-00000000a001', 'enroll_test: zapis testowy własnego kontaktu admina');
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'list', public.admin_journey_list(NULL);
SELECT is(
  (SELECT (x ->> 'active') || '|' || (x ->> 'version') FROM r, jsonb_array_elements(r.v) x
    WHERE r.k = 'list' AND x ->> 'key' = 'kasa'),
  '0|1', 'lista: zapis testowy poza licznikiem aktywnych');

RESET ROLE;
CREATE TEMP TABLE s5_counts ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.journey_enrollments) AS e, (SELECT count(*) FROM public.journey_step_runs) AS sr,
       (SELECT count(*) FROM public.journey_messages) AS m, (SELECT count(*) FROM public.email_send_log) AS l,
       (SELECT count(*) FROM public.crm_leads) AS cl, (SELECT count(*) FROM public.crm_tasks) AS ct,
       (SELECT count(*) FROM public.journey_event_inbox) AS i;
GRANT SELECT ON s5_counts TO authenticated;
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'sim', public.admin_journey_simulate(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid,
  'e5600000-0000-0000-0000-0000000001a1');
RESET ROLE;
SELECT ok(
  (SELECT c.e = (SELECT count(*) FROM public.journey_enrollments) AND c.sr = (SELECT count(*) FROM public.journey_step_runs)
      AND c.m = (SELECT count(*) FROM public.journey_messages) AND c.l = (SELECT count(*) FROM public.email_send_log)
      AND c.cl = (SELECT count(*) FROM public.crm_leads) AND c.ct = (SELECT count(*) FROM public.crm_tasks)
      AND c.i = (SELECT count(*) FROM public.journey_event_inbox)
     FROM s5_counts c),
  'simulate: zero nowych wierszy w journey_*, email_send_log, crm_*');
SELECT is(
  (SELECT string_agg(x ->> 'nodeId', '>' ORDER BY ord) FROM r, jsonb_array_elements(r.v -> 'path') WITH ORDINALITY AS p(x, ord)
    WHERE r.k = 'sim'),
  't>w>m>x', 'simulate: ścieżka przez graf');
SELECT is(
  (SELECT r.v -> 'emails' -> 0 ->> 'verdict' FROM r WHERE r.k = 'sim'),
  'no_consent', 'simulate: werdykt maila bez zgody');
SET LOCAL ROLE authenticated;

INSERT INTO r SELECT 'est', public.admin_journey_trigger_estimate('checkout.abandoned.v1', '{"kind":"plan"}', 30);
SELECT is((SELECT (v ->> 'events') || '|' || (v ->> 'contacts') FROM r WHERE k = 'est'), '2|2',
  'trigger_estimate: zdarzenia i kontakty najemcy z warunkiem');
INSERT INTO r SELECT 'health', public.admin_journey_engine_health();
SELECT ok(
  (SELECT (v ->> 'enabled')::boolean AND (v ? 'inbox_pending') AND (v ? 'errors_24h') AND (v ? 'last_errors')
          AND (v ->> 'journeys_active')::int = 1 FROM r WHERE k = 'health'),
  'engine_health: przełącznik, skrzynka, błędy, aktywne ścieżki');

-- ── 7. Wyjście, pominięcie czekania, status ─────────────────────────────────
RESET ROLE;
UPDATE public.journey_enrollments SET lock_token = 'e5600000-0000-0000-0000-00000000ffff', locked_until = now() + interval '2 minutes'
 WHERE id = ((SELECT v FROM r WHERE k = 'test') ->> 'enrollment_id')::uuid;
SELECT public.journey_advance(((SELECT v FROM r WHERE k = 'test') ->> 'enrollment_id')::uuid,
  'e5600000-0000-0000-0000-00000000ffff', 25);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e5600000-0000-0000-0000-00000000a002');
SELECT throws_ok(
  $$ SELECT public.admin_journey_enrollment_skip_wait(((SELECT v FROM r WHERE k = 'test') ->> 'enrollment_id')::uuid) $$,
  '42501', NULL, 'skip_wait: redaktor odrzucony (tylko admin)');
SELECT pg_temp.as_user('e5600000-0000-0000-0000-00000000a001');
INSERT INTO r SELECT 'skip', public.admin_journey_enrollment_skip_wait(((SELECT v FROM r WHERE k = 'test') ->> 'enrollment_id')::uuid);
RESET ROLE;
SELECT is(
  (SELECT e.status || '|' || sr.status || ':' || sr.outcome FROM public.journey_enrollments e
     JOIN public.journey_step_runs sr ON sr.enrollment_id = e.id AND sr.node_id = 'w'
    WHERE e.id = ((SELECT v FROM r WHERE k = 'test') ->> 'enrollment_id')::uuid),
  'active|succeeded:next', 'skip_wait: czekanie zakończone teraz, zapis do wykonania');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e5600000-0000-0000-0000-00000000a002');
INSERT INTO r SELECT 'exit', public.admin_journey_enrollment_exit(((SELECT v FROM r WHERE k = 'test') ->> 'enrollment_id')::uuid);
SELECT is((SELECT v ->> 'exited' FROM r WHERE k = 'exit'), 'true', 'exit: redaktor wyjmuje kontakt (manual)');

SELECT throws_ok(
  $$ SELECT public.admin_journey_set_status(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid, 'paused') $$,
  '42501', NULL, 'status: redaktor odrzucony (tylko admin)');
SELECT pg_temp.as_user('e5600000-0000-0000-0000-00000000b001');
SELECT throws_ok(
  $$ SELECT public.admin_journey_set_status(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid, 'paused') $$,
  'P0002', 'journey_not_found', 'izolacja: admin B nie widzi ścieżki A');
SELECT pg_temp.as_user('e5600000-0000-0000-0000-00000000a001');
INSERT INTO r SELECT 'arch', public.admin_journey_set_status(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid, 'archived');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.journey_event_routes WHERE journey_id = ((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid),
  0, 'archiwum: trasy zdjęte');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.admin_journey_set_status(((SELECT v FROM r WHERE k = 'c_editor') ->> 'id')::uuid, 'active') $$,
  '22023', 'journey_archived', 'archiwum: brak powrotu do active');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
