-- pgTAP: wersje ścieżek i test A/B (migracje 20261020140100, 140300, hub S5).
--
-- Sprawdza:
--   * wariant A/B deterministyczny: kubełek `abs(hashtextextended(zapis:węzeł))
--     % 100` z wagą A, ten sam wynik po powtórce wykonania, jeden przebieg
--     węzła; oba ramiona dostają ruch przy 50/50;
--   * zapisy przypięte do wersji: ponowna publikacja (`drain`) nie zmienia
--     wersji trwającego zapisu, który kończy STARY graf; `exit_all` kończy
--     zapisy poprzednich wersji (`manual`);
--   * `journey.stats_changed.v1` raz na ścieżkę na tick (duplikaty
--     identyfikatorów nie mnożą zdarzeń) i bez wejścia do skrzynki (brak pętli).
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test journeys_versions_ab
BEGIN;
SELECT plan(13);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO public.tenants (id, slug, name) VALUES
  ('e5400000-0000-0000-0000-0000000000a0', 'hub-s5-ab-a', 'Hub S5 A/B A'),
  ('e5400000-0000-0000-0000-0000000000b0', 'hub-s5-ab-b', 'Hub S5 A/B B');
INSERT INTO auth.users (id, email) VALUES
  ('e5400000-0000-0000-0000-00000000a001', 'admin-a@hub-s5-ab.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e5400000-0000-0000-0000-00000000a001', 'admin-a@hub-s5-ab.test', 'Admin A', 'e5400000-0000-0000-0000-0000000000a0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e5400000-0000-0000-0000-00000000a001', 'admin', 'e5400000-0000-0000-0000-0000000000a0');
INSERT INTO public.journey_settings (tenant_id, enabled) VALUES ('e5400000-0000-0000-0000-0000000000a0', true);

INSERT INTO public.crm_leads (id, tenant_id, email, email_norm)
SELECT ('e5400000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'e5400000-0000-0000-0000-0000000000a0',
       'ab' || g || '@hub-s5-ab.test', 'ab' || g || '@hub-s5-ab.test'
  FROM generate_series(1, 200) g;

INSERT INTO public.journey_definitions (id, tenant_id, key, name, status) VALUES
  ('e5400000-0000-0000-0000-0000000010a1', 'e5400000-0000-0000-0000-0000000000a0', 'test-ab', 'A/B', 'active');
INSERT INTO public.journey_versions (id, tenant_id, journey_id, version, trigger_event_type, graph, graph_checksum, reentry) VALUES
  ('e5400000-0000-0000-0000-0000000011a1', 'e5400000-0000-0000-0000-0000000000a0', 'e5400000-0000-0000-0000-0000000010a1', 1,
   'crm_lead.updated.v1',
   '{"nodes":[{"id":"t","type":"trigger","params":{}},
              {"id":"ab","type":"ab_split","params":{"weights":{"A":50,"B":50},"winnerMetric":"goal"}},
              {"id":"xa","type":"exit","params":{}},{"id":"xb","type":"exit","params":{}}],
     "edges":[{"from":"t","to":"ab","branch":"next"},{"from":"ab","to":"xa","branch":"A"},{"from":"ab","to":"xb","branch":"B"}]}',
   'x', 'after_exit');
UPDATE public.journey_definitions SET published_version_id = 'e5400000-0000-0000-0000-0000000011a1'
 WHERE id = 'e5400000-0000-0000-0000-0000000010a1';

CREATE FUNCTION pg_temp.adv(p_e uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t uuid := gen_random_uuid();
BEGIN
  UPDATE public.journey_enrollments SET lock_token = t, locked_until = now() + interval '2 minutes' WHERE id = p_e;
  RETURN public.journey_advance(p_e, t, 25);
END $$;

CREATE TEMP TABLE s5ab ON COMMIT DROP AS
SELECT public._journey_enroll('e5400000-0000-0000-0000-0000000000a0', 'e5400000-0000-0000-0000-0000000010a1',
         'e5400000-0000-0000-0000-0000000011a1', l.id,
         jsonb_build_object('id', gen_random_uuid(), 'event_type', 'crm_lead.updated.v1', 'payload', '{}'::jsonb)) AS id
  FROM public.crm_leads l
 WHERE l.tenant_id = 'e5400000-0000-0000-0000-0000000000a0' AND l.email_norm LIKE 'ab%@hub-s5-ab.test';
SELECT count(pg_temp.adv(id)) FROM s5ab;

-- ── 1. A/B ───────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM s5ab a JOIN public.journey_step_runs sr ON sr.enrollment_id = a.id AND sr.node_id = 'ab'
    WHERE sr.outcome IS DISTINCT FROM
          CASE WHEN abs(hashtextextended(a.id::text || ':ab', 0)) % 100 < 50 THEN 'A' ELSE 'B' END),
  0, 'A/B: wariant = kubełek hashtextextended(zapis:węzeł) % 100 wobec wagi A');
SELECT ok(
  (SELECT count(*) FILTER (WHERE outcome = 'A') > 0 AND count(*) FILTER (WHERE outcome = 'B') > 0
     FROM public.journey_step_runs sr JOIN s5ab a ON a.id = sr.enrollment_id WHERE sr.node_id = 'ab'),
  'A/B 50/50: oba ramiona dostają ruch');
SELECT is(
  (SELECT count(*)::int FROM s5ab a JOIN public.journey_enrollments e ON e.id = a.id
    WHERE e.status = 'completed'), 200, 'A/B: wszystkie zapisy przeszły podział do końca');
-- Powtórka: ten sam zapis, ten sam wynik, jeden przebieg węzła.
CREATE TEMP TABLE s5ab_first ON COMMIT DROP AS
SELECT sr.enrollment_id, sr.outcome FROM public.journey_step_runs sr
 WHERE sr.node_id = 'ab' AND sr.enrollment_id = (SELECT id FROM s5ab LIMIT 1);
UPDATE public.journey_enrollments SET status = 'active', current_node_id = 'ab', finished_at = NULL,
       exit_reason = NULL, next_run_at = now()
 WHERE id = (SELECT enrollment_id FROM s5ab_first);
SELECT pg_temp.adv((SELECT enrollment_id FROM s5ab_first));
SELECT is(
  (SELECT count(*)::int || ':' || max(sr.outcome) FROM public.journey_step_runs sr
    WHERE sr.node_id = 'ab' AND sr.enrollment_id = (SELECT enrollment_id FROM s5ab_first)),
  '1:' || (SELECT outcome FROM s5ab_first), 'A/B: powtórka wykonania odtwarza ten sam wariant (jeden przebieg)');

-- ── 2. Wersje: drain i exit_all ──────────────────────────────────────────────
INSERT INTO public.journey_definitions (id, tenant_id, key, name, status, draft) VALUES
  ('e5400000-0000-0000-0000-0000000010a2', 'e5400000-0000-0000-0000-0000000000a0', 'wersje', 'Wersje', 'draft',
   '{"graph":{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"w","type":"wait","params":{"mode":"duration","minutes":60}},
                       {"id":"v1end","type":"exit","params":{}}],
              "edges":[{"from":"t","to":"w","branch":"next"},{"from":"w","to":"v1end","branch":"next"}]},
     "settings":{"triggerEventType":"crm_lead.updated.v1","reentry":"never"}}');

CREATE TEMP TABLE s5v (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON s5v TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"e5400000-0000-0000-0000-00000000a001","role":"authenticated"}', true);
INSERT INTO s5v SELECT 'p1', public.admin_journey_publish('e5400000-0000-0000-0000-0000000010a2',
  (SELECT updated_at FROM public.journey_definitions WHERE id = 'e5400000-0000-0000-0000-0000000010a2'), 'drain');
RESET ROLE;

CREATE TEMP TABLE s5ver ON COMMIT DROP AS
SELECT public._journey_enroll('e5400000-0000-0000-0000-0000000000a0', 'e5400000-0000-0000-0000-0000000010a2',
         ((SELECT v FROM s5v WHERE k = 'p1') ->> 'version_id')::uuid, 'e5400000-0000-0000-0000-000000000001'::uuid,
         '{"event_type":"crm_lead.updated.v1","payload":{}}'::jsonb) AS id;
SELECT pg_temp.adv((SELECT id FROM s5ver));

-- Wersja 2: inny koniec grafu.
UPDATE public.journey_definitions
   SET draft = jsonb_set(draft, '{graph}',
     '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"w","type":"wait","params":{"mode":"duration","minutes":60}},
                {"id":"v2end","type":"goal","params":{}}],
       "edges":[{"from":"t","to":"w","branch":"next"},{"from":"w","to":"v2end","branch":"next"}]}')
 WHERE id = 'e5400000-0000-0000-0000-0000000010a2';
SET LOCAL ROLE authenticated;
INSERT INTO s5v SELECT 'p2', public.admin_journey_publish('e5400000-0000-0000-0000-0000000010a2',
  (SELECT updated_at FROM public.journey_definitions WHERE id = 'e5400000-0000-0000-0000-0000000010a2'), 'drain');
RESET ROLE;

SELECT is(((SELECT v FROM s5v WHERE k = 'p2') ->> 'version')::int, 2, 'ponowna publikacja: wersja 2');
SELECT is(
  (SELECT e.version_id::text FROM public.journey_enrollments e WHERE e.id = (SELECT id FROM s5ver)),
  (SELECT v FROM s5v WHERE k = 'p1') ->> 'version_id', 'drain: trwający zapis przypięty do wersji 1');
SELECT is(
  (SELECT graph_checksum FROM public.journey_versions WHERE id = ((SELECT v FROM s5v WHERE k = 'p2') ->> 'version_id')::uuid),
  md5((SELECT draft -> 'graph' FROM public.journey_definitions WHERE id = 'e5400000-0000-0000-0000-0000000010a2')::text),
  'publikacja: graph_checksum = md5 grafu');
UPDATE public.journey_step_runs sr SET detail = sr.detail || jsonb_build_object('until', now() - interval '1 second')
 WHERE sr.enrollment_id = (SELECT id FROM s5ver) AND sr.node_id = 'w';
SELECT is(pg_temp.adv((SELECT id FROM s5ver)) ->> 'status', 'completed',
  'drain: zapis wersji 1 kończy STARY graf (exit), nie cel wersji 2');

-- exit_all: trwający zapis wersji 2 kończy się przy publikacji wersji 3.
CREATE TEMP TABLE s5ver2 ON COMMIT DROP AS
SELECT public._journey_enroll('e5400000-0000-0000-0000-0000000000a0', 'e5400000-0000-0000-0000-0000000010a2',
         ((SELECT v FROM s5v WHERE k = 'p2') ->> 'version_id')::uuid, 'e5400000-0000-0000-0000-000000000002'::uuid,
         '{"event_type":"crm_lead.updated.v1","payload":{}}'::jsonb) AS id;
SELECT pg_temp.adv((SELECT id FROM s5ver2));
SET LOCAL ROLE authenticated;
INSERT INTO s5v SELECT 'p3', public.admin_journey_publish('e5400000-0000-0000-0000-0000000010a2',
  (SELECT updated_at FROM public.journey_definitions WHERE id = 'e5400000-0000-0000-0000-0000000010a2'), 'exit_all');
RESET ROLE;
SELECT is(
  (SELECT status || '|' || exit_reason FROM public.journey_enrollments WHERE id = (SELECT id FROM s5ver2)),
  'exited|manual', 'exit_all: zapisy poprzednich wersji kończą się (manual)');
SELECT is(
  (SELECT count(*)::int FROM public.journey_event_routes
    WHERE journey_id = 'e5400000-0000-0000-0000-0000000010a2' AND role = 'exit'
      AND event_type = 'newsletter_subscriber.unsubscribed.v1'),
  1, 'publikacja marketingu: globalna trasa wyjścia przy wypisie z newslettera');

-- ── 3. stats_changed raz na ścieżkę na tick ──────────────────────────────────
SELECT is(
  public.journey_tick_emit_stats(
    ARRAY['e5400000-0000-0000-0000-0000000010a1', 'e5400000-0000-0000-0000-0000000010a1',
          'e5400000-0000-0000-0000-0000000010a2']::uuid[],
    '{"e5400000-0000-0000-0000-0000000010a1":{"enrolled":3,"advanced":5,"finished":2,"emails_queued":1}}'),
  2, 'stats_changed: duplikaty identyfikatorów = jedno zdarzenie na ścieżkę');
SELECT is(
  (SELECT (payload ->> 'enrolled') || '|' || (payload ->> 'emails_queued') FROM public.domain_events
    WHERE event_type = 'journey.stats_changed.v1' AND aggregate_id = 'e5400000-0000-0000-0000-0000000010a1'),
  '3|1', 'stats_changed: liczniki ticku w ładunku');
SELECT is(
  (SELECT count(*)::int FROM public.journey_event_inbox i
     JOIN public.domain_events de ON de.id = i.event_id
    WHERE de.event_type = 'journey.stats_changed.v1' AND de.tenant_id = 'e5400000-0000-0000-0000-0000000000a0'),
  0, 'stats_changed: zdarzenie ścieżki nie wraca do skrzynki (brak pętli)');

SELECT * FROM finish();
ROLLBACK;
