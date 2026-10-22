-- pgTAP: silnik ścieżek - pobranie z dzierżawą, wykonanie węzłów, czekania,
-- warunki, cel i wyjście, ponowienia (migracje 20261020140000-140200, hub S5).
--
-- Sprawdza:
--   * filtr wejścia (kontakt bez warunku nie dostaje wiersza);
--   * 3 polityki ponownego wejścia: `never`, `after_exit`, `cooldown`;
--   * `wait`: `duration`, `until_time` (dzień tygodnia i godzina w strefie
--     najemcy), `until_event` (przebudzenie zdarzeniem) i limit czasu;
--   * `if_else` `all` / `any`;
--   * akcje: tag (raz), cykl życia z historią `journey`, odmowa pierwszeństwa
--     = wynik `precedence`, nie błąd;
--   * cel (trasa `goal` i węzeł `goal`) i wyjście (trasa `exit`, węzeł `exit`);
--   * ponowienie z odstępem 1 min · 4^(n-1), krok `dead` i zapis `failed`
--     po 8 próbach;
--   * sprawiedliwość: ≤ 20 zapisów na najemcę w jednym pobraniu;
--   * ścieżka wstrzymana i wyłączony silnik najemcy pomijane - poza zapisem
--     testowym; dzierżawa chroni przed drugim wykonawcą.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test journeys_engine
BEGIN;
SELECT plan(38);

-- ── Fixture ──────────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('e5300000-0000-0000-0000-0000000000a0', 'hub-s5-engine-a', 'Hub S5 silnik A'),
  ('e5300000-0000-0000-0000-0000000000b0', 'hub-s5-engine-b', 'Hub S5 silnik B'),
  ('e5300000-0000-0000-0000-0000000000c0', 'hub-s5-engine-c', 'Hub S5 silnik C');

INSERT INTO public.journey_settings (tenant_id, enabled, timezone) VALUES
  ('e5300000-0000-0000-0000-0000000000a0', true, 'Europe/Warsaw'),
  ('e5300000-0000-0000-0000-0000000000b0', true, 'Europe/Warsaw'),
  ('e5300000-0000-0000-0000-0000000000c0', false, 'Europe/Warsaw');

-- Leady: l1..l9 w A, lb w B, lc w C.
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, tags)
SELECT ('e5300000-0000-0000-0000-0000000001a' || g)::uuid, 'e5300000-0000-0000-0000-0000000000a0',
       'lead' || g || '@hub-s5-engine.test', 'lead' || g || '@hub-s5-engine.test',
       CASE WHEN g IN (1, 2) THEN ARRAY['vip'] ELSE ARRAY[]::text[] END
  FROM generate_series(1, 9) g;
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm) VALUES
  ('e5300000-0000-0000-0000-0000000001b1', 'e5300000-0000-0000-0000-0000000000b0', 'lead@hub-s5-engine-b.test', 'lead@hub-s5-engine-b.test'),
  ('e5300000-0000-0000-0000-0000000001c1', 'e5300000-0000-0000-0000-0000000000c0', 'lead@hub-s5-engine-c.test', 'lead@hub-s5-engine-c.test');

-- Ścieżka: definicja + wersja + trasa wejścia; zwraca id wersji.
CREATE FUNCTION pg_temp.mk(p_tenant uuid, p_id uuid, p_key text, p_graph jsonb,
                           p_reentry text DEFAULT 'never', p_cooldown int DEFAULT NULL,
                           p_filter jsonb DEFAULT '[]', p_status text DEFAULT 'active',
                           p_trigger text DEFAULT 'crm_lead.updated.v1')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.journey_definitions (id, tenant_id, key, name, status)
  VALUES (p_id, p_tenant, p_key, p_key, p_status);
  INSERT INTO public.journey_versions (id, tenant_id, journey_id, version, trigger_event_type, graph,
                                       graph_checksum, reentry, reentry_cooldown_days, entry_filter, published_at)
  VALUES (v, p_tenant, p_id, 1, p_trigger, p_graph, md5(p_graph::text), p_reentry, p_cooldown, p_filter,
          now() - interval '1 hour');
  UPDATE public.journey_definitions SET published_version_id = v WHERE id = p_id;
  INSERT INTO public.journey_event_routes (tenant_id, event_type, journey_id, version_id, role)
  VALUES (p_tenant, p_trigger, p_id, v, 'enroll');
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.enroll(p_tenant uuid, p_journey uuid, p_lead uuid, p_test boolean DEFAULT false)
RETURNS uuid LANGUAGE sql AS $$
  SELECT public._journey_enroll(p_tenant, p_journey,
    (SELECT published_version_id FROM public.journey_definitions WHERE id = p_journey), p_lead,
    jsonb_build_object('id', gen_random_uuid(), 'event_type', 'crm_lead.updated.v1',
                       'payload', jsonb_build_object('lead_id', p_lead)), p_test)
$$;

-- Dzierżawa jednego zapisu (izoluje przypadki od sprawiedliwości pobrania).
CREATE FUNCTION pg_temp.adv(p_e uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t uuid := gen_random_uuid();
BEGIN
  UPDATE public.journey_enrollments SET lock_token = t, locked_until = now() + interval '2 minutes' WHERE id = p_e;
  RETURN public.journey_advance(p_e, t, 25);
END $$;

-- Czas mija: czekanie bieżącego węzła upływa.
CREATE FUNCTION pg_temp.expire(p_e uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE public.journey_step_runs sr SET detail = sr.detail || jsonb_build_object('until', now() - interval '1 second')
    FROM public.journey_enrollments e
   WHERE e.id = p_e AND sr.enrollment_id = e.id AND sr.node_id = e.current_node_id AND sr.status = 'running';
  UPDATE public.journey_enrollments SET next_run_at = now() - interval '1 second' WHERE id = p_e;
$$;

CREATE FUNCTION pg_temp.st(p_e uuid) RETURNS text LANGUAGE sql AS $$
  SELECT status || '|' || COALESCE(current_node_id, '-') FROM public.journey_enrollments WHERE id = p_e
$$;

CREATE TEMP TABLE s5e (k text PRIMARY KEY, id uuid) ON COMMIT DROP;

-- ── 1. Filtr wejścia ─────────────────────────────────────────────────────────
SELECT pg_temp.mk('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a1', 'filtr',
  '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"x","type":"exit","params":{}}],
    "edges":[{"from":"t","to":"x","branch":"next"}]}',
  'never', NULL, '[{"kind":"has_tag","tag":"vip"}]');
SELECT is(pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a1',
  'e5300000-0000-0000-0000-0000000001a3'), NULL, 'filtr wejścia: kontakt bez tagu nie zapisany');
SELECT is(
  (SELECT count(*)::int FROM public.journey_enrollments WHERE journey_id = 'e5300000-0000-0000-0000-0000000010a1'),
  0, 'filtr wejścia: brak wiersza (kontakt może wejść później)');
SELECT isnt(pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a1',
  'e5300000-0000-0000-0000-0000000001a1'), NULL, 'filtr wejścia: kontakt z tagiem zapisany');

-- Pole ładunku wejścia: `payload @> condition` nie umie zaprzeczenia
-- (win-back bez pauzy, D13) - robi to filtr `trigger_field` `not_in`.
SELECT pg_temp.mk('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010aa', 'winback',
  '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"x","type":"exit","params":{}}],
    "edges":[{"from":"t","to":"x","branch":"next"}]}',
  'after_exit', NULL, '[{"kind":"trigger_field","key":"reason","op":"not_in","values":["paused"]}]');
SELECT is(public._journey_enroll('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010aa',
  (SELECT published_version_id FROM public.journey_definitions WHERE id = 'e5300000-0000-0000-0000-0000000010aa'),
  'e5300000-0000-0000-0000-0000000001a3', '{"event_type":"subscription.expired.v1","payload":{"reason":"paused"}}', false),
  NULL, 'trigger_field not_in: wygaśnięcie z pauzy (reason=paused) nie zapisuje');
SELECT isnt(public._journey_enroll('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010aa',
  (SELECT published_version_id FROM public.journey_definitions WHERE id = 'e5300000-0000-0000-0000-0000000010aa'),
  'e5300000-0000-0000-0000-0000000001a3', '{"event_type":"subscription.expired.v1","payload":{"reason":"canceled"}}', false),
  NULL, 'trigger_field not_in: wygaśnięcie po anulowaniu zapisuje');

-- ── 2. Polityki ponownego wejścia ────────────────────────────────────────────
SELECT pg_temp.mk('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a2', 'never',
  '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"x","type":"exit","params":{}}],
    "edges":[{"from":"t","to":"x","branch":"next"}]}', 'never');
INSERT INTO s5e VALUES ('never1', pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0',
  'e5300000-0000-0000-0000-0000000010a2', 'e5300000-0000-0000-0000-0000000001a2'));
SELECT pg_temp.adv((SELECT id FROM s5e WHERE k = 'never1'));
SELECT is(pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a2',
  'e5300000-0000-0000-0000-0000000001a2'), NULL, 'never: po zakończeniu drugiego wejścia nie ma');

SELECT pg_temp.mk('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a3', 'after-exit',
  '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"w","type":"wait","params":{"mode":"duration","minutes":60}},
             {"id":"x","type":"exit","params":{}}],
    "edges":[{"from":"t","to":"w","branch":"next"},{"from":"w","to":"x","branch":"next"}]}', 'after_exit');
INSERT INTO s5e VALUES ('ae1', pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0',
  'e5300000-0000-0000-0000-0000000010a3', 'e5300000-0000-0000-0000-0000000001a2'));
SELECT is(pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a3',
  'e5300000-0000-0000-0000-0000000001a2'), NULL, 'after_exit: drugie wejście czeka na koniec pierwszego');
SELECT pg_temp.adv((SELECT id FROM s5e WHERE k = 'ae1'));
SELECT pg_temp.expire((SELECT id FROM s5e WHERE k = 'ae1'));
SELECT pg_temp.adv((SELECT id FROM s5e WHERE k = 'ae1'));
SELECT isnt(pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a3',
  'e5300000-0000-0000-0000-0000000001a2'), NULL, 'after_exit: po zakończeniu kontakt wchodzi ponownie');

SELECT pg_temp.mk('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a4', 'cooldown',
  '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"x","type":"exit","params":{}}],
    "edges":[{"from":"t","to":"x","branch":"next"}]}', 'cooldown', 30);
INSERT INTO s5e VALUES ('cd1', pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0',
  'e5300000-0000-0000-0000-0000000010a4', 'e5300000-0000-0000-0000-0000000001a2'));
SELECT pg_temp.adv((SELECT id FROM s5e WHERE k = 'cd1'));
SELECT is(pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a4',
  'e5300000-0000-0000-0000-0000000001a2'), NULL, 'cooldown: w oknie 30 dni brak ponownego wejścia');
UPDATE public.journey_enrollments SET entered_at = now() - interval '31 days' WHERE id = (SELECT id FROM s5e WHERE k = 'cd1');
SELECT isnt(pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a4',
  'e5300000-0000-0000-0000-0000000001a2'), NULL, 'cooldown: po oknie kontakt wchodzi ponownie');

-- ── 3. Czekania ──────────────────────────────────────────────────────────────
SELECT pg_temp.mk('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a5', 'czekania',
  '{"nodes":[{"id":"t","type":"trigger","params":{}},
             {"id":"d","type":"wait","params":{"mode":"duration","minutes":90}},
             {"id":"u","type":"wait","params":{"mode":"until_time","weekdays":[2],"time":"09:30"}},
             {"id":"e","type":"wait","params":{"mode":"until_event","eventType":"checkout.completed.v1","condition":{"kind":"plan"},"timeoutMinutes":120}},
             {"id":"g","type":"goal","params":{}},{"id":"x","type":"exit","params":{}}],
    "edges":[{"from":"t","to":"d","branch":"next"},{"from":"d","to":"u","branch":"next"},
             {"from":"u","to":"e","branch":"next"},{"from":"e","to":"g","branch":"event"},
             {"from":"e","to":"x","branch":"timeout"}]}');
INSERT INTO public.journey_event_routes (tenant_id, event_type, journey_id, version_id, role)
SELECT 'e5300000-0000-0000-0000-0000000000a0', 'checkout.completed.v1', id, published_version_id, 'wake'
  FROM public.journey_definitions WHERE id = 'e5300000-0000-0000-0000-0000000010a5';
INSERT INTO s5e VALUES ('w1', pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0',
  'e5300000-0000-0000-0000-0000000010a5', 'e5300000-0000-0000-0000-0000000001a4'));
SELECT is(pg_temp.adv((SELECT id FROM s5e WHERE k = 'w1')) ->> 'status', 'waiting', 'wait duration: zapis czeka');
SELECT ok(
  (SELECT next_run_at BETWEEN now() + interval '89 minutes' AND now() + interval '91 minutes'
     FROM public.journey_enrollments WHERE id = (SELECT id FROM s5e WHERE k = 'w1')),
  'wait duration: wznowienie za 90 minut');
SELECT is(pg_temp.adv((SELECT id FROM s5e WHERE k = 'w1')) ->> 'status', 'waiting',
  'wait duration: przedwczesne wykonanie wraca do czekania');
SELECT pg_temp.expire((SELECT id FROM s5e WHERE k = 'w1'));
SELECT pg_temp.adv((SELECT id FROM s5e WHERE k = 'w1'));
SELECT is(
  (SELECT extract(isodow FROM next_run_at AT TIME ZONE 'Europe/Warsaw')::int || '|'
          || to_char(next_run_at AT TIME ZONE 'Europe/Warsaw', 'HH24:MI')
     FROM public.journey_enrollments WHERE id = (SELECT id FROM s5e WHERE k = 'w1')),
  '2|09:30', 'wait until_time: wtorek 09:30 czasu najemcy');
SELECT pg_temp.expire((SELECT id FROM s5e WHERE k = 'w1'));
SELECT pg_temp.adv((SELECT id FROM s5e WHERE k = 'w1'));
SELECT is(
  (SELECT wait_event_type || '|' || (wait_deadline > now() + interval '119 minutes')::text
     FROM public.journey_enrollments WHERE id = (SELECT id FROM s5e WHERE k = 'w1')),
  'checkout.completed.v1|true', 'wait until_event: typ zdarzenia i termin zapisane');
-- Zdarzenie niespełniające warunku nie budzi; spełniające - budzi.
INSERT INTO public.journey_event_inbox (tenant_id, event_id, event_type, aggregate_type, aggregate_id, payload, occurred_at)
VALUES ('e5300000-0000-0000-0000-0000000000a0', gen_random_uuid(), 'checkout.completed.v1', 'crm_lead',
        'e5300000-0000-0000-0000-0000000001a4', '{"kind":"ticket"}', now());
SELECT public.journey_ingest_inbox(50);
SELECT is(pg_temp.st((SELECT id FROM s5e WHERE k = 'w1')), 'waiting|e',
  'wait until_event: zdarzenie bez warunku (kind=ticket) nie budzi');
INSERT INTO public.journey_event_inbox (tenant_id, event_id, event_type, aggregate_type, aggregate_id, payload, occurred_at)
VALUES ('e5300000-0000-0000-0000-0000000000a0', gen_random_uuid(), 'checkout.completed.v1', 'crm_lead',
        'e5300000-0000-0000-0000-0000000001a4', '{"kind":"plan"}', now() + interval '1 second');
SELECT is((public.journey_ingest_inbox(50) ->> 'wakes')::int, 1, 'wait until_event: zdarzenie z warunkiem budzi zapis');
SELECT is(pg_temp.adv((SELECT id FROM s5e WHERE k = 'w1')) ->> 'status', 'goal_reached',
  'wait until_event: gałąź event prowadzi do celu');

INSERT INTO s5e VALUES ('w2', pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0',
  'e5300000-0000-0000-0000-0000000010a5', 'e5300000-0000-0000-0000-0000000001a5'));
SELECT pg_temp.adv((SELECT id FROM s5e WHERE k = 'w2'));
SELECT pg_temp.expire((SELECT id FROM s5e WHERE k = 'w2'));
SELECT pg_temp.adv((SELECT id FROM s5e WHERE k = 'w2'));
SELECT pg_temp.expire((SELECT id FROM s5e WHERE k = 'w2'));
SELECT pg_temp.adv((SELECT id FROM s5e WHERE k = 'w2'));
SELECT pg_temp.expire((SELECT id FROM s5e WHERE k = 'w2'));
SELECT is(pg_temp.adv((SELECT id FROM s5e WHERE k = 'w2')) ->> 'status', 'completed',
  'wait until_event: bez zdarzenia limit czasu prowadzi gałęzią timeout');
SELECT is(
  (SELECT outcome FROM public.journey_step_runs WHERE enrollment_id = (SELECT id FROM s5e WHERE k = 'w2') AND node_id = 'e'),
  'timeout', 'wait until_event: wynik kroku = timeout');

-- ── 4. if/else, akcje, cel i wyjście ─────────────────────────────────────────
SELECT pg_temp.mk('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a6', 'warunki',
  '{"nodes":[{"id":"t","type":"trigger","params":{}},
             {"id":"all","type":"if_else","params":{"match":"all","predicates":[{"kind":"has_tag","tag":"vip"},{"kind":"crm_stage","in":["qualified"]}]}},
             {"id":"any","type":"if_else","params":{"match":"any","predicates":[{"kind":"has_tag","tag":"vip"},{"kind":"crm_stage","in":["qualified"]}]}},
             {"id":"tag","type":"add_tag","params":{"tag":"journey-ok"}},
             {"id":"lc","type":"set_lifecycle_stage","params":{"stage":"lead"}},
             {"id":"g","type":"goal","params":{}},{"id":"x","type":"exit","params":{}}],
    "edges":[{"from":"t","to":"all","branch":"next"},{"from":"all","to":"g","branch":"yes"},
             {"from":"all","to":"any","branch":"no"},{"from":"any","to":"tag","branch":"yes"},
             {"from":"any","to":"x","branch":"no"},{"from":"tag","to":"lc","branch":"next"},
             {"from":"lc","to":"x","branch":"next"}]}');
-- l1: vip, stage new -> all=no, any=yes -> tag -> cykl życia -> wyjście.
INSERT INTO s5e VALUES ('c1', pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0',
  'e5300000-0000-0000-0000-0000000010a6', 'e5300000-0000-0000-0000-0000000001a1'));
SELECT is(pg_temp.adv((SELECT id FROM s5e WHERE k = 'c1')) ->> 'status', 'completed', 'if_else any=yes: ścieżka do końca');
SELECT is(
  (SELECT string_agg(node_id || ':' || outcome, ',' ORDER BY started_at, node_id) FROM public.journey_step_runs
    WHERE enrollment_id = (SELECT id FROM s5e WHERE k = 'c1') AND node_id IN ('all', 'any')),
  'all:no,any:yes', 'if_else: all (oba warunki) = no, any (jeden) = yes');
SELECT is(
  (SELECT array_length(array_positions(tags, 'journey-ok'), 1) FROM public.crm_leads WHERE id = 'e5300000-0000-0000-0000-0000000001a1'),
  1, 'akcja add_tag przez run_workflow_step');
SELECT is(
  (SELECT source FROM public.crm_lead_stage_history
    WHERE lead_id = 'e5300000-0000-0000-0000-0000000001a1' AND dimension = 'lifecycle' ORDER BY id DESC LIMIT 1),
  'journey', 'akcja set_lifecycle_stage: historia ze źródłem journey');
-- l2: człowiek ustawił etap dalej - ścieżka nie cofa (wynik precedence).
UPDATE public.crm_leads SET stage = 'qualified' WHERE id = 'e5300000-0000-0000-0000-0000000001a2';
SELECT public.crm_set_lifecycle_stage('e5300000-0000-0000-0000-0000000001a6', 'mql', 'manual', false);
INSERT INTO s5e VALUES ('c2', pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0',
  'e5300000-0000-0000-0000-0000000010a6', 'e5300000-0000-0000-0000-0000000001a2'));
SELECT is(pg_temp.adv((SELECT id FROM s5e WHERE k = 'c2')) ->> 'status', 'goal_reached',
  'if_else all=yes -> węzeł celu = goal_reached');
UPDATE public.crm_leads SET tags = ARRAY['vip'] WHERE id = 'e5300000-0000-0000-0000-0000000001a6';
INSERT INTO s5e VALUES ('c3', pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0',
  'e5300000-0000-0000-0000-0000000010a6', 'e5300000-0000-0000-0000-0000000001a6'));
SELECT pg_temp.adv((SELECT id FROM s5e WHERE k = 'c3'));
SELECT is(
  (SELECT status || ':' || outcome FROM public.journey_step_runs
    WHERE enrollment_id = (SELECT id FROM s5e WHERE k = 'c3') AND node_id = 'lc'),
  'skipped:precedence', 'set_lifecycle_stage za człowiekiem = skipped:precedence (nie błąd)');

-- Trasy celu i wyjścia na aktywnym zapisie.
SELECT pg_temp.mk('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a7', 'cel-wyjscie',
  '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"w","type":"wait","params":{"mode":"duration","minutes":600}},
             {"id":"x","type":"exit","params":{}}],
    "edges":[{"from":"t","to":"w","branch":"next"},{"from":"w","to":"x","branch":"next"}]}');
INSERT INTO public.journey_event_routes (tenant_id, event_type, journey_id, version_id, role, condition)
SELECT 'e5300000-0000-0000-0000-0000000000a0', x.t, d.id, d.published_version_id, x.r, '{}'::jsonb
  FROM public.journey_definitions d,
       (VALUES ('checkout.completed.v1', 'goal'), ('retention_flow.completed.v1', 'exit')) x(t, r)
 WHERE d.id = 'e5300000-0000-0000-0000-0000000010a7';
INSERT INTO s5e VALUES ('g1', pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0',
  'e5300000-0000-0000-0000-0000000010a7', 'e5300000-0000-0000-0000-0000000001a7'));
INSERT INTO s5e VALUES ('x1', pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0',
  'e5300000-0000-0000-0000-0000000010a7', 'e5300000-0000-0000-0000-0000000001a8'));
SELECT pg_temp.adv((SELECT id FROM s5e WHERE k = 'g1'));
SELECT pg_temp.adv((SELECT id FROM s5e WHERE k = 'x1'));
INSERT INTO public.journey_event_inbox (tenant_id, event_id, event_type, aggregate_type, aggregate_id, payload, occurred_at) VALUES
  ('e5300000-0000-0000-0000-0000000000a0', gen_random_uuid(), 'checkout.completed.v1', 'crm_lead',
   'e5300000-0000-0000-0000-0000000001a7', '{}', now() + interval '1 second'),
  ('e5300000-0000-0000-0000-0000000000a0', gen_random_uuid(), 'retention_flow.completed.v1', 'crm_lead',
   'e5300000-0000-0000-0000-0000000001a8', '{}', now() + interval '1 second');
SELECT public.journey_ingest_inbox(50);
SELECT is(
  (SELECT status || '|' || exit_reason FROM public.journey_enrollments WHERE id = (SELECT id FROM s5e WHERE k = 'g1')),
  'goal_reached|goal', 'trasa goal: zdarzenie celu kończy zapis (goal_reached)');
SELECT is(
  (SELECT status || '|' || exit_reason FROM public.journey_enrollments WHERE id = (SELECT id FROM s5e WHERE k = 'x1')),
  'exited|exit_event', 'trasa exit: zdarzenie wyjścia kończy zapis (exit_event)');

-- ── 5. Ponowienia i dead ─────────────────────────────────────────────────────
SELECT pg_temp.mk('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a8', 'awaria',
  '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"bad","type":"set_crm_stage","params":{"stage":"vip","onlyForward":false}},
             {"id":"x","type":"exit","params":{}}],
    "edges":[{"from":"t","to":"bad","branch":"next"},{"from":"bad","to":"x","branch":"next"}]}');
INSERT INTO s5e VALUES ('f1', pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0',
  'e5300000-0000-0000-0000-0000000010a8', 'e5300000-0000-0000-0000-0000000001a9'));
SELECT is(pg_temp.adv((SELECT id FROM s5e WHERE k = 'f1')) ->> 'status', 'retry', 'awaria akcji: ponowienie, nie wyjątek');
SELECT ok(
  (SELECT next_run_at BETWEEN now() + interval '55 seconds' AND now() + interval '65 seconds'
     FROM public.journey_enrollments WHERE id = (SELECT id FROM s5e WHERE k = 'f1')),
  'odstęp po pierwszej próbie = 1 min');
SELECT pg_temp.adv((SELECT id FROM s5e WHERE k = 'f1'));
SELECT ok(
  (SELECT next_run_at BETWEEN now() + interval '235 seconds' AND now() + interval '245 seconds'
     FROM public.journey_enrollments WHERE id = (SELECT id FROM s5e WHERE k = 'f1')),
  'odstęp po drugiej próbie = 4 min');
SELECT pg_temp.adv((SELECT id FROM s5e WHERE k = 'f1')) FROM generate_series(3, 7);
SELECT is(pg_temp.adv((SELECT id FROM s5e WHERE k = 'f1')) ->> 'status', 'dead', 'ósma próba: krok dead');
SELECT is(
  (SELECT e.status || '|' || e.exit_reason || '|' || sr.status || '|' || sr.attempts
     FROM public.journey_enrollments e JOIN public.journey_step_runs sr ON sr.enrollment_id = e.id AND sr.node_id = 'bad'
    WHERE e.id = (SELECT id FROM s5e WHERE k = 'f1')),
  'failed|error|dead|8', 'po 8 próbach: zapis failed (error), krok dead');

-- ── 6. Pobranie: sprawiedliwość, pauza, wyłączony silnik, dzierżawa ─────────
-- Wszystko inne poza terminem - pobranie widzi tylko przypadki tego bloku.
UPDATE public.journey_enrollments SET next_run_at = now() + interval '1 day' WHERE status IN ('active', 'waiting');
UPDATE public.journey_enrollments SET next_run_at = now() + interval '1 day' WHERE tenant_id NOT IN (
  'e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000000b0', 'e5300000-0000-0000-0000-0000000000c0')
   AND status IN ('active', 'waiting');
SELECT pg_temp.mk('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a9', 'masowa',
  '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"x","type":"exit","params":{}}],
    "edges":[{"from":"t","to":"x","branch":"next"}]}', 'after_exit');
SELECT pg_temp.mk('e5300000-0000-0000-0000-0000000000b0', 'e5300000-0000-0000-0000-0000000010b1', 'masowa',
  '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"x","type":"exit","params":{}}],
    "edges":[{"from":"t","to":"x","branch":"next"}]}', 'after_exit');
SELECT pg_temp.mk('e5300000-0000-0000-0000-0000000000c0', 'e5300000-0000-0000-0000-0000000010c1', 'wylaczony',
  '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"x","type":"exit","params":{}}],
    "edges":[{"from":"t","to":"x","branch":"next"}]}', 'after_exit');
-- 25 zapisów najemcy A (różne leady - nowe kontakty), 3 najemcy B.
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm)
SELECT gen_random_uuid(), 'e5300000-0000-0000-0000-0000000000a0', 'masa' || g || '@hub-s5-engine.test',
       'masa' || g || '@hub-s5-engine.test' FROM generate_series(1, 25) g;
SELECT pg_temp.enroll('e5300000-0000-0000-0000-0000000000a0', 'e5300000-0000-0000-0000-0000000010a9', l.id)
  FROM public.crm_leads l WHERE l.email_norm LIKE 'masa%@hub-s5-engine.test';
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm)
SELECT gen_random_uuid(), 'e5300000-0000-0000-0000-0000000000b0', 'masa' || g || '@hub-s5-engine-b.test',
       'masa' || g || '@hub-s5-engine-b.test' FROM generate_series(1, 3) g;
SELECT pg_temp.enroll('e5300000-0000-0000-0000-0000000000b0', 'e5300000-0000-0000-0000-0000000010b1', l.id)
  FROM public.crm_leads l WHERE l.email_norm LIKE 'masa%@hub-s5-engine-b.test';
-- Najemca C: silnik wyłączony - zwykły zapis pominięty, testowy pobrany.
INSERT INTO s5e VALUES ('c_real', pg_temp.enroll('e5300000-0000-0000-0000-0000000000c0',
  'e5300000-0000-0000-0000-0000000010c1', 'e5300000-0000-0000-0000-0000000001c1'));
UPDATE public.journey_enrollments SET status = 'completed', finished_at = now()
 WHERE id = (SELECT id FROM s5e WHERE k = 'c_real');
INSERT INTO s5e VALUES ('c_test', pg_temp.enroll('e5300000-0000-0000-0000-0000000000c0',
  'e5300000-0000-0000-0000-0000000010c1', 'e5300000-0000-0000-0000-0000000001c1', true));
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm) VALUES
  ('e5300000-0000-0000-0000-0000000001c2', 'e5300000-0000-0000-0000-0000000000c0', 'lead2@hub-s5-engine-c.test', 'lead2@hub-s5-engine-c.test');
INSERT INTO s5e VALUES ('c_real2', pg_temp.enroll('e5300000-0000-0000-0000-0000000000c0',
  'e5300000-0000-0000-0000-0000000010c1', 'e5300000-0000-0000-0000-0000000001c2'));
-- Wstrzymana ścieżka najemcy B: jej zapis pominięty.
UPDATE public.journey_definitions SET status = 'paused' WHERE id = 'e5300000-0000-0000-0000-0000000010b1';
CREATE TEMP TABLE s5_claim ON COMMIT DROP AS SELECT * FROM public.journey_claim_due(50, 120);
SELECT is(
  (SELECT count(*)::int FROM s5_claim WHERE tenant_id = 'e5300000-0000-0000-0000-0000000000a0'),
  20, 'sprawiedliwość: najwyżej 20 zapisów najemcy A na pobranie');
SELECT is(
  (SELECT count(*)::int FROM s5_claim WHERE tenant_id = 'e5300000-0000-0000-0000-0000000000b0'),
  0, 'ścieżka wstrzymana (paused): zapisy pominięte');
SELECT is(
  (SELECT string_agg(is_test::text, ',') FROM s5_claim WHERE tenant_id = 'e5300000-0000-0000-0000-0000000000c0'),
  'true', 'silnik wyłączony: pobrany wyłącznie zapis testowy');
SELECT is(
  (SELECT count(*)::int FROM public.journey_claim_due(50, 120) c WHERE c.tenant_id = 'e5300000-0000-0000-0000-0000000000a0'),
  5, 'dzierżawa: drugie pobranie nie bierze zapisów pod dzierżawą (reszta 5)');
SELECT is(
  public.journey_advance((SELECT enrollment_id FROM s5_claim LIMIT 1), gen_random_uuid(), 25) ->> 'status',
  'lost_lock', 'cudzy token dzierżawy: wykonanie odrzucone');

SELECT * FROM finish();
ROLLBACK;
