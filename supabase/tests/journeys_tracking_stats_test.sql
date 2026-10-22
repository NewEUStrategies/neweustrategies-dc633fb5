-- pgTAP: domknięcie kroku maila, śledzenie 1:1, wypis, statystyki per krok,
-- rollup i dopasowanie zdarzeń dostawcy (migracja 20261020140500, hub S5).
--
-- Sprawdza:
--   * `_journey_message_id` = `deterministicMessageId("journey:{zapis}:{węzeł}")`
--     (wartość policzona w TS - parytet tożsamości wiadomości);
--   * `queued` z cudzym identyfikatorem odrzucone; poprawny = wiadomość,
--     krok udany, ścieżka idzie dalej w tej samej dzierżawie;
--   * deduplikacja doby otwarć i kliknięć (per link), otwarcie maszynowe
--     (< `machine_open_seconds` od wysyłki albo flaga proxy);
--   * statystyki węzła z `email_send_log` po `message_id` (wysłane, odbicia,
--     otwarcia unikalne i „ludzkie", kliknięcia, CTOR); zapisy testowe poza;
--   * `email_apply_delivery_event` dopasowuje najemcę po
--     `email_send_log.provider_message_id` (adres w dwóch najemcach);
--   * A/B: `z` wyłącznie przy n ≥ 100 na wariant;
--   * wypis: zgoda wycofana z wpisem w księdze, blokada `unsubscribe`,
--     zapisy MARKETINGOWE kontaktu `exited/unsubscribed`, usługowe zostają;
--   * rollup dzienny idempotentny; ACL funkcji serwisowych.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test journeys_tracking_stats
BEGIN;
SELECT plan(26);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO public.tenants (id, slug, name) VALUES
  ('e5700000-0000-0000-0000-0000000000a0', 'hub-s5-track-a', 'Hub S5 śledzenie A'),
  ('e5700000-0000-0000-0000-0000000000b0', 'hub-s5-track-b', 'Hub S5 śledzenie B');
INSERT INTO auth.users (id, email) VALUES ('e5700000-0000-0000-0000-00000000a001', 'admin-a@hub-s5-track.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e5700000-0000-0000-0000-00000000a001', 'admin-a@hub-s5-track.test', 'Admin A', 'e5700000-0000-0000-0000-0000000000a0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e5700000-0000-0000-0000-00000000a001', 'admin', 'e5700000-0000-0000-0000-0000000000a0');
INSERT INTO public.journey_settings (tenant_id, enabled, machine_open_seconds) VALUES
  ('e5700000-0000-0000-0000-0000000000a0', true, 2);

INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, marketing_consent) VALUES
  ('e5700000-0000-0000-0000-0000000001a1', 'e5700000-0000-0000-0000-0000000000a0', 'odbiorca@hub-s5-track.test', 'odbiorca@hub-s5-track.test', true),
  ('e5700000-0000-0000-0000-0000000001a2', 'e5700000-0000-0000-0000-0000000000a0', 'wypis@hub-s5-track.test', 'wypis@hub-s5-track.test', true);
INSERT INTO public.newsletter_subscribers (tenant_id, email, status) VALUES
  ('e5700000-0000-0000-0000-0000000000a0', 'wypis@hub-s5-track.test', 'confirmed'),
  -- Ten sam adres w drugim najemcy: dopasowanie po adresie byłoby niejednoznaczne.
  ('e5700000-0000-0000-0000-0000000000b0', 'odbiorca@hub-s5-track.test', 'confirmed'),
  ('e5700000-0000-0000-0000-0000000000a0', 'odbiorca@hub-s5-track.test', 'confirmed');
-- Most subskrybent -> CRM mógł dopisać flagę/leady; ustalamy stan wprost.
UPDATE public.crm_leads SET marketing_consent = true
 WHERE id IN ('e5700000-0000-0000-0000-0000000001a1', 'e5700000-0000-0000-0000-0000000001a2');
-- Zgoda odbiorcy na pomiar otwarć i kliknięć - od I9d-Y2 zapis zdarzeń
-- wymaga jej w chwili zdarzenia (przypadki bez zgody: hub_i9d_y2_tracking).
INSERT INTO public.crm_consent_log (tenant_id, email, source_type, consent_key, consent_text, given, created_at)
VALUES ('e5700000-0000-0000-0000-0000000000a0', 'odbiorca@hub-s5-track.test', 'newsletter', 'email_measurement',
        'Zgoda na pomiar otwarć i kliknięć', true, now() - interval '1 day');

INSERT INTO public.journey_definitions (id, tenant_id, key, name, status, category, legal_basis) VALUES
  ('e5700000-0000-0000-0000-0000000010a1', 'e5700000-0000-0000-0000-0000000000a0', 'mail', 'Mail', 'active', 'marketing', NULL),
  ('e5700000-0000-0000-0000-0000000010a2', 'e5700000-0000-0000-0000-0000000000a0', 'usluga', 'Usługa', 'active', 'service', 'Umowa');
INSERT INTO public.journey_versions (id, tenant_id, journey_id, version, trigger_event_type, graph, graph_checksum, reentry) VALUES
  ('e5700000-0000-0000-0000-0000000011a1', 'e5700000-0000-0000-0000-0000000000a0', 'e5700000-0000-0000-0000-0000000010a1', 1,
   'crm_lead.updated.v1',
   '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"m","type":"send_email","params":{}},
              {"id":"w","type":"wait","params":{"mode":"duration","minutes":60}},{"id":"x","type":"exit","params":{}}],
     "edges":[{"from":"t","to":"m","branch":"next"},{"from":"m","to":"w","branch":"next"},{"from":"w","to":"x","branch":"next"}]}',
   'x', 'after_exit'),
  ('e5700000-0000-0000-0000-0000000011a2', 'e5700000-0000-0000-0000-0000000000a0', 'e5700000-0000-0000-0000-0000000010a2', 1,
   'crm_lead.updated.v1',
   '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"w","type":"wait","params":{"mode":"duration","minutes":60}},
              {"id":"x","type":"exit","params":{}}],
     "edges":[{"from":"t","to":"w","branch":"next"},{"from":"w","to":"x","branch":"next"}]}', 'x', 'never');
UPDATE public.journey_definitions SET published_version_id = 'e5700000-0000-0000-0000-0000000011a1' WHERE id = 'e5700000-0000-0000-0000-0000000010a1';
UPDATE public.journey_definitions SET published_version_id = 'e5700000-0000-0000-0000-0000000011a2' WHERE id = 'e5700000-0000-0000-0000-0000000010a2';

CREATE FUNCTION pg_temp.at_mail(p_lead uuid, p_test boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_e uuid; t uuid := gen_random_uuid();
BEGIN
  v_e := public._journey_enroll('e5700000-0000-0000-0000-0000000000a0', 'e5700000-0000-0000-0000-0000000010a1',
    'e5700000-0000-0000-0000-0000000011a1', p_lead,
    jsonb_build_object('id', gen_random_uuid(), 'event_type', 'crm_lead.updated.v1', 'payload', '{}'::jsonb), p_test);
  UPDATE public.journey_enrollments SET lock_token = t, locked_until = now() + interval '2 minutes' WHERE id = v_e;
  PERFORM public.journey_advance(v_e, t, 25);
  RETURN v_e;
END $$;
CREATE FUNCTION pg_temp.tok(p_e uuid) RETURNS uuid LANGUAGE sql AS $$
  SELECT lock_token FROM public.journey_enrollments WHERE id = p_e $$;

CREATE TEMP TABLE s5t (k text PRIMARY KEY, id uuid, v jsonb) ON COMMIT DROP;
INSERT INTO s5t (k, id) VALUES ('e1', pg_temp.at_mail('e5700000-0000-0000-0000-0000000001a1'));

-- ── 1. Tożsamość wiadomości i domknięcie kroku ──────────────────────────────
SELECT is(public._journey_message_id('00000000-0000-4000-8000-000000000001', 'mail_1'),
  'adcf4729-2d9b-4ef2-bf9a-bdd0cbfe79f9', 'parytet: _journey_message_id = deterministicMessageId (TS)');
SELECT throws_ok(
  format($$ SELECT public.journey_complete_email_step(%L, %L, 'm', 'queued', 'obcy-identyfikator') $$,
    (SELECT id FROM s5t WHERE k = 'e1'), pg_temp.tok((SELECT id FROM s5t WHERE k = 'e1'))),
  '22023', 'message_id_mismatch', 'queued z cudzym message_id odrzucone');
UPDATE s5t SET v = public.journey_complete_email_step(id, pg_temp.tok(id), 'm', 'queued',
  public._journey_message_id(id, 'm'), NULL, 'pl', '{"fallback_locale":false}') WHERE k = 'e1';
SELECT is((SELECT (v ->> 'status') || '|' || (v ->> 'completed') FROM s5t WHERE k = 'e1'), 'waiting|queued',
  'queued: krok udany i ścieżka dalej w tej samej dzierżawie (czekanie)');
SELECT is(
  (SELECT count(*)::int FROM public.journey_messages WHERE enrollment_id = (SELECT id FROM s5t WHERE k = 'e1')),
  1, 'queued: jedna wiadomość ścieżki');
INSERT INTO s5t (k, v) SELECT 'mid', to_jsonb(public._journey_message_id((SELECT id FROM s5t WHERE k = 'e1'), 'm'));

-- ── 2. Zdarzenia śledzenia ───────────────────────────────────────────────────
SELECT is(
  (public.journey_record_message_event((SELECT v #>> '{}' FROM s5t WHERE k = 'mid'), 'open') ->> 'machine'),
  'true', 'otwarcie tuż po wysyłce (< 2 s) = maszynowe');
UPDATE public.journey_messages SET queued_at = now() - interval '10 minutes'
 WHERE message_id = (SELECT v #>> '{}' FROM s5t WHERE k = 'mid');
DELETE FROM public.journey_message_events WHERE message_id = (SELECT v #>> '{}' FROM s5t WHERE k = 'mid');
SELECT is(
  (public.journey_record_message_event((SELECT v #>> '{}' FROM s5t WHERE k = 'mid'), 'open') ->> 'machine'),
  'false', 'otwarcie po 10 min = ludzkie');
SELECT is(
  (public.journey_record_message_event((SELECT v #>> '{}' FROM s5t WHERE k = 'mid'), 'open') ->> 'recorded'),
  'false', 'drugie otwarcie tej doby: deduplikacja (bez nowego wiersza)');
SELECT public.journey_record_message_event((SELECT v #>> '{}' FROM s5t WHERE k = 'mid'), 'click', 0, 'https://nes.example/a');
SELECT public.journey_record_message_event((SELECT v #>> '{}' FROM s5t WHERE k = 'mid'), 'click', 0, 'https://nes.example/a');
SELECT public.journey_record_message_event((SELECT v #>> '{}' FROM s5t WHERE k = 'mid'), 'click', 1, 'https://nes.example/b');
SELECT is(
  (SELECT count(*)::int FROM public.journey_message_events
    WHERE message_id = (SELECT v #>> '{}' FROM s5t WHERE k = 'mid') AND kind = 'click'),
  2, 'kliknięcia: deduplikacja doby per link (2 linki = 2 wiersze)');
SELECT is(
  (public.journey_record_message_event((SELECT v #>> '{}' FROM s5t WHERE k = 'mid'), 'open', -1, NULL, true) ->> 'machine'),
  'true', 'flaga proxy (UA) wymusza otwarcie maszynowe');
SELECT is(public.journey_record_message_event('nieznana-wiadomosc', 'open') ->> 'reason', 'unknown_message',
  'nieznana wiadomość: brak zapisu, bez wyjątku');

-- ── 3. Statystyki z dziennika wysyłek ────────────────────────────────────────
INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, tenant_id, provider_message_id) VALUES
  ((SELECT v #>> '{}' FROM s5t WHERE k = 'mid'), 'journey', 'odbiorca@hub-s5-track.test', 'pending', 'e5700000-0000-0000-0000-0000000000a0', NULL),
  ((SELECT v #>> '{}' FROM s5t WHERE k = 'mid'), 'journey', 'odbiorca@hub-s5-track.test', 'sent', 'e5700000-0000-0000-0000-0000000000a0', 'prov-s5-1');
-- Zapis testowy z wysłanym mailem: poza statystykami.
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm) VALUES
  ('e5700000-0000-0000-0000-0000000001a3', 'e5700000-0000-0000-0000-0000000000a0', 'test@hub-s5-track.test', 'test@hub-s5-track.test');
INSERT INTO s5t (k, id) VALUES ('t1', pg_temp.at_mail('e5700000-0000-0000-0000-0000000001a3', true));
UPDATE s5t SET v = public.journey_complete_email_step(id, pg_temp.tok(id), 'm', 'queued',
  public._journey_message_id(id, 'm')) WHERE k = 't1';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"e5700000-0000-0000-0000-00000000a001","role":"authenticated"}', true);
CREATE TEMP TABLE s5stats ON COMMIT DROP AS SELECT public.admin_journey_stats('e5700000-0000-0000-0000-0000000010a1') AS v;
RESET ROLE;
SELECT is(
  (SELECT (n -> 'email' ->> 'queued') || '|' || (n -> 'email' ->> 'sent') || '|' || (n -> 'email' ->> 'unique_opens') || '|'
          || (n -> 'email' ->> 'unique_human_opens') || '|' || (n -> 'email' ->> 'unique_clicks') || '|' || (n -> 'email' ->> 'ctor')
     FROM s5stats, jsonb_array_elements(v -> 'nodes') n WHERE n ->> 'node_id' = 'm'),
  '1|1|1|1|1|1.0000', 'statystyki maila po message_id (zapis testowy poza): 1 wysłany, otwarcie, klik, CTOR');
SELECT is((SELECT (v -> 'journey' ->> 'enrolled') FROM s5stats), '1', 'statystyki ścieżki: zapis testowy poza licznikami');
SELECT ok(
  (SELECT set_eq_ok FROM (SELECT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v) k)
     = ARRAY['journey', 'nodes', 'since', 'source', 'until', 'variants', 'version_id'] AS set_eq_ok FROM s5stats) x),
  'kształt admin_journey_stats (rpc-shape)');

-- ── 4. Zdarzenia dostawcy po provider_message_id ────────────────────────────
SELECT is(
  (public.email_apply_delivery_event('resend', 'ev-s5-1', 'email.complained', 'complained',
     'odbiorca@hub-s5-track.test', 'prov-s5-1') ->> 'tenant_id'),
  'e5700000-0000-0000-0000-0000000000a0', 'skarga: najemca z email_send_log.provider_message_id (adres w 2 najemcach)');
SELECT ok(
  EXISTS (SELECT 1 FROM public.email_suppressions es
           WHERE es.tenant_id = 'e5700000-0000-0000-0000-0000000000a0'
             AND es.email_norm = 'odbiorca@hub-s5-track.test' AND es.reason = 'complaint'),
  'skarga: blokada w najemcy wiadomości');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE s5stats2 ON COMMIT DROP AS SELECT public.admin_journey_stats('e5700000-0000-0000-0000-0000000010a1') AS v;
RESET ROLE;
SELECT is(
  (SELECT n -> 'email' ->> 'complained' FROM s5stats2, jsonb_array_elements(v -> 'nodes') n WHERE n ->> 'node_id' = 'm'),
  '1', 'statystyki: skarga przypisana do kroku przez provider_message_id');

-- ── 5. Wypis z maila ścieżki ─────────────────────────────────────────────────
INSERT INTO s5t (k, id) VALUES ('u1', pg_temp.at_mail('e5700000-0000-0000-0000-0000000001a2'));
UPDATE s5t SET v = public.journey_complete_email_step(id, pg_temp.tok(id), 'm', 'queued',
  public._journey_message_id(id, 'm')) WHERE k = 'u1';
INSERT INTO s5t (k, id) VALUES ('svc', public._journey_enroll('e5700000-0000-0000-0000-0000000000a0',
  'e5700000-0000-0000-0000-0000000010a2', 'e5700000-0000-0000-0000-0000000011a2', 'e5700000-0000-0000-0000-0000000001a2',
  '{"event_type":"crm_lead.updated.v1","payload":{}}', false));
SELECT is(
  (public.journey_record_message_event(public._journey_message_id((SELECT id FROM s5t WHERE k = 'u1'), 'm'), 'unsubscribe') ->> 'exited'),
  '1', 'wypis: aktywny zapis marketingowy kontaktu kończy się');
SELECT is(
  (SELECT status || '|' || exit_reason FROM public.journey_enrollments WHERE id = (SELECT id FROM s5t WHERE k = 'u1')),
  'exited|unsubscribed', 'wypis: powód unsubscribed');
SELECT is((SELECT status FROM public.journey_enrollments WHERE id = (SELECT id FROM s5t WHERE k = 'svc')), 'active',
  'wypis: ścieżka usługowa (podstawa prawna) zostaje');
SELECT is(
  (SELECT l.marketing_consent::text || '|' || (SELECT c.given::text FROM public.crm_consent_log c
     WHERE c.email = 'wypis@hub-s5-track.test' AND c.consent_key = 'marketing' ORDER BY c.created_at DESC LIMIT 1)
     FROM public.crm_leads l WHERE l.id = 'e5700000-0000-0000-0000-0000000001a2'),
  'false|false', 'wypis: zgoda leada wycofana z wpisem w księdze (given=false)');
SELECT is(
  (SELECT s.status || '|' || EXISTS (SELECT 1 FROM public.email_suppressions es
     WHERE es.tenant_id = s.tenant_id AND es.email_norm = 'wypis@hub-s5-track.test' AND es.reason = 'unsubscribe')::text
     FROM public.newsletter_subscribers s
    WHERE s.tenant_id = 'e5700000-0000-0000-0000-0000000000a0' AND s.email = 'wypis@hub-s5-track.test'),
  'unsubscribed|true', 'wypis: subskrybent wypisany z blokadą unsubscribe (istniejące RPC)');

-- ── 6. A/B: z tylko przy n ≥ 100 ─────────────────────────────────────────────
INSERT INTO public.journey_definitions (id, tenant_id, key, name, status) VALUES
  ('e5700000-0000-0000-0000-0000000010a3', 'e5700000-0000-0000-0000-0000000000a0', 'ab-z', 'A/B z', 'active');
INSERT INTO public.journey_versions (id, tenant_id, journey_id, version, trigger_event_type, graph, graph_checksum) VALUES
  ('e5700000-0000-0000-0000-0000000011a3', 'e5700000-0000-0000-0000-0000000000a0', 'e5700000-0000-0000-0000-0000000010a3', 1,
   'crm_lead.updated.v1',
   '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"ab","type":"ab_split","params":{"weights":{"A":50,"B":50},"winnerMetric":"goal"}},
              {"id":"ga","type":"goal","params":{}},{"id":"xb","type":"exit","params":{}}],
     "edges":[{"from":"t","to":"ab","branch":"next"},{"from":"ab","to":"ga","branch":"A"},{"from":"ab","to":"xb","branch":"B"}]}', 'x');
UPDATE public.journey_definitions SET published_version_id = 'e5700000-0000-0000-0000-0000000011a3' WHERE id = 'e5700000-0000-0000-0000-0000000010a3';
-- Syntetyczne zapisy i przebiegi podziału: 99 + 99 (za mało), potem 120 + 120.
CREATE FUNCTION pg_temp.arm(p_n int, p_variant text, p_status text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE i int; v_lead uuid; v_e uuid;
BEGIN
  FOR i IN 1..p_n LOOP
    INSERT INTO public.crm_leads (tenant_id, email, email_norm)
    VALUES ('e5700000-0000-0000-0000-0000000000a0', 'z' || p_variant || i || '-' || gen_random_uuid() || '@x.test',
            'z' || p_variant || i || '-' || gen_random_uuid() || '@x.test') RETURNING id INTO v_lead;
    INSERT INTO public.journey_enrollments (tenant_id, journey_id, version_id, lead_id, status, trigger_snapshot, enrollment_key)
    VALUES ('e5700000-0000-0000-0000-0000000000a0', 'e5700000-0000-0000-0000-0000000010a3', 'e5700000-0000-0000-0000-0000000011a3',
            v_lead, p_status, '{}', v_lead::text) RETURNING id INTO v_e;
    INSERT INTO public.journey_step_runs (tenant_id, enrollment_id, journey_id, version_id, node_id, node_type, status, outcome)
    VALUES ('e5700000-0000-0000-0000-0000000000a0', v_e, 'e5700000-0000-0000-0000-0000000010a3', 'e5700000-0000-0000-0000-0000000011a3',
            'ab', 'ab_split', 'succeeded', p_variant);
  END LOOP;
END $$;
SELECT pg_temp.arm(60, 'A', 'goal_reached'), pg_temp.arm(39, 'A', 'completed'),
       pg_temp.arm(30, 'B', 'goal_reached'), pg_temp.arm(69, 'B', 'completed');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE s5z1 ON COMMIT DROP AS SELECT public.admin_journey_stats('e5700000-0000-0000-0000-0000000010a3') AS v;
RESET ROLE;
SELECT is(
  (SELECT string_agg(COALESCE(x ->> 'z', 'null'), ',' ORDER BY x ->> 'variant') FROM s5z1, jsonb_array_elements(v -> 'variants') x),
  'null,null', 'A/B: 99 zapisów na wariant -> z niepoliczone');
SELECT pg_temp.arm(21, 'A', 'goal_reached'), pg_temp.arm(21, 'B', 'completed');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE s5z2 ON COMMIT DROP AS SELECT public.admin_journey_stats('e5700000-0000-0000-0000-0000000010a3') AS v;
RESET ROLE;
SELECT ok(
  (SELECT (x ->> 'z')::numeric > 1.96 FROM s5z2, jsonb_array_elements(v -> 'variants') x WHERE x ->> 'variant' = 'A'),
  'A/B: 120 zapisów na wariant -> z policzone (A wyraźnie lepsze)');

-- ── 7. Rollup i ACL ──────────────────────────────────────────────────────────
UPDATE public.journey_step_runs SET started_at = now() - interval '1 day'
 WHERE enrollment_id = (SELECT id FROM s5t WHERE k = 'e1');
SELECT cmp_ok(public.journey_rollup_daily(), '>=', 1, 'rollup: dzień zamknięty zapisany');
SELECT is(
  (SELECT entered || '|' || emails_sent FROM public.journey_node_daily_stats
    WHERE journey_id = 'e5700000-0000-0000-0000-0000000010a1' AND node_id = 'm' AND variant = '-'),
  '1|1', 'rollup: węzeł maila (wejścia, wysłane) - powtórka liczy to samo');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.journey_record_message_event(text,text,integer,text,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.journey_complete_email_step(uuid,uuid,text,text,text,text,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.journey_rollup_daily()', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.journey_record_message_event(text,text,integer,text,boolean)', 'EXECUTE'),
  'acl: śledzenie, domknięcie kroku i rollup wyłącznie dla service_role');

SELECT * FROM finish();
ROLLBACK;
