-- pgTAP: dzienne zestawienie statusów zapisów na ścieżki (I9, Z-I9c-06;
-- migracja 20261020162600) - podsumowanie i seria ścieżki przeżywają
-- retencję zapisów.
--
-- CO PRZYPINA:
--   * okno SPRZED progu retencji: podsumowanie (`admin_journey_stats` ->
--     `journey`: wejścia, zakończone, cele, porażki, wyjścia per powód,
--     konwersja) i seria dzienna (`admin_journey_series`: wejścia, cele,
--     wyjścia, maile, kliknięcia) IDENTYCZNE przed czyszczeniem i po nim;
--     okno przecinające próg (surowe + zestawienie) też;
--   * surowe zapisy faktycznie zniknęły (test nie jest pusty), a zestawienie
--     nie niesie kontaktu ani identyfikatora zapisu;
--   * zapis testowy (`is_test`) usunięty, ale NIE złożony;
--   * powtórny przebieg niczego nie dubluje, tryb podglądu niczego nie
--     składa, kolejny zapis po progu dokłada się do istniejącego wiersza;
--   * ACL tabeli: RLS, brak uprawnień anon/authenticated, service_role pisze.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9_journey_enrollment_rollup
BEGIN;
SELECT plan(17);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

-- Najemca po karencji (założony 60 dni temu, bez wierszy ustawień - okres
-- zapisów 13 mies., wykonanie zamiast podglądu).
INSERT INTO public.tenants (id, slug, name, created_at) VALUES
  ('19e90000-0000-4000-8000-0000000000c0', 'i9-zapisy', 'I9 Zapisy', now() - interval '60 days');
INSERT INTO auth.users (id, email) VALUES
  ('19e90000-0000-4000-8000-00000000c001', 'admin@i9-zapisy.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19e90000-0000-4000-8000-00000000c001', 'admin@i9-zapisy.test', 'Admin', '19e90000-0000-4000-8000-0000000000c0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('19e90000-0000-4000-8000-00000000c001', 'admin', '19e90000-0000-4000-8000-0000000000c0');

CREATE TEMP TABLE w (k text PRIMARY KEY, t timestamptz) ON COMMIT DROP;
-- d1-d3: dni sprzed progu (13 mies.); okno „old" kończy się przed progiem.
INSERT INTO w VALUES
  ('d1', date_trunc('day', now() - interval '14 months') + interval '10 hours'),
  ('d2', date_trunc('day', now() - interval '14 months') + interval '1 day 10 hours'),
  ('d3', date_trunc('day', now() - interval '14 months') + interval '2 days 10 hours'),
  ('since', date_trunc('day', now() - interval '15 months')),
  ('until', date_trunc('day', now() - interval '13 months') - interval '2 days');
CREATE FUNCTION pg_temp.w(p text) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT t FROM w WHERE k = p $$;
CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON r, w TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.w(text) TO authenticated;
CREATE FUNCTION pg_temp.as_user(p_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO authenticated;
-- Seria bez pustych dni (porównanie co do dnia, ale czytelny komunikat).
CREATE FUNCTION pg_temp.busy(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(d ORDER BY d ->> 'day'), '[]'::jsonb) FROM jsonb_array_elements(p) d
   WHERE (d ->> 'enrolled')::int + (d ->> 'goal_reached')::int + (d ->> 'exited')::int
         + (d ->> 'emails_queued')::int + (d ->> 'unique_clicks')::int > 0
$$;
GRANT EXECUTE ON FUNCTION pg_temp.busy(jsonb) TO authenticated;

INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, last_activity_at)
SELECT ('19e90000-0000-4000-8000-0000000030a' || n)::uuid, '19e90000-0000-4000-8000-0000000000c0',
       'l' || n || '@i9-zapisy.test', 'l' || n || '@i9-zapisy.test', now() - interval '1 day'
  FROM generate_series(1, 9) n;
INSERT INTO public.journey_definitions (id, tenant_id, key, name, status, category) VALUES
  ('19e90000-0000-4000-8000-0000000050d1', '19e90000-0000-4000-8000-0000000000c0', 'i9-zap', 'Zapisy', 'active', 'marketing');
INSERT INTO public.journey_versions (id, tenant_id, journey_id, version, trigger_event_type, graph, graph_checksum, published_at)
VALUES ('19e90000-0000-4000-8000-0000000050e1', '19e90000-0000-4000-8000-0000000000c0', '19e90000-0000-4000-8000-0000000050d1', 1,
        'account.registered.v1',
        '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"m","type":"send_email","params":{}},{"id":"x","type":"exit","params":{}}],
          "edges":[{"from":"t","to":"m","branch":"next"},{"from":"m","to":"x","branch":"next"}]}',
        'x', pg_temp.w('since'));
UPDATE public.journey_definitions SET published_version_id = '19e90000-0000-4000-8000-0000000050e1'
 WHERE id = '19e90000-0000-4000-8000-0000000050d1';

-- Zapisy: 1 completed (d1), 2 goal_reached (wejście d1, cel d2),
-- 3 exited/unsubscribed (d2), 4 exited/consent (wejście d2, wyjście d3),
-- 5 failed/error (d3), 6 testowy completed (d1 - usunięty, nie złożony),
-- 7 aktywny świeży, 8 completed świeży (zostaje), 9 - dokładany później.
INSERT INTO public.journey_enrollments (id, tenant_id, journey_id, version_id, lead_id, status, current_node_id,
                                        trigger_snapshot, enrollment_key, entered_at, finished_at, exit_reason, is_test)
SELECT ('19e90000-0000-4000-8000-0000000050f' || x.n)::uuid, '19e90000-0000-4000-8000-0000000000c0',
       '19e90000-0000-4000-8000-0000000050d1', '19e90000-0000-4000-8000-0000000050e1',
       ('19e90000-0000-4000-8000-0000000030a' || x.n)::uuid, x.status, x.node, '{}', 'zap-' || x.n,
       x.entered, x.finished, x.reason, x.test
  FROM (VALUES
    (1, 'completed', NULL, pg_temp.w('d1'), pg_temp.w('d1') + interval '3 hours', 'completed', false),
    (2, 'goal_reached', NULL, pg_temp.w('d1'), pg_temp.w('d2'), 'goal', false),
    (3, 'exited', NULL, pg_temp.w('d2'), pg_temp.w('d2') + interval '1 hour', 'unsubscribed', false),
    (4, 'exited', NULL, pg_temp.w('d2'), pg_temp.w('d3'), 'consent', false),
    (5, 'failed', NULL, pg_temp.w('d3'), pg_temp.w('d3') + interval '1 hour', 'error', false),
    (6, 'completed', NULL, pg_temp.w('d1'), pg_temp.w('d1') + interval '1 hour', 'completed', true),
    (7, 'active', 'm', now() - interval '2 hours', NULL::timestamptz, NULL, false),
    (8, 'completed', NULL, now() - interval '3 days', now() - interval '2 days', 'completed', false)
  ) x(n, status, node, entered, finished, reason, test);
-- Mail kroku `m` dla zapisów 1 i 2 (d1): wysłany, zapis 1 kliknął tego dnia.
INSERT INTO public.journey_step_runs (tenant_id, enrollment_id, journey_id, version_id, node_id, node_type, status, started_at)
SELECT '19e90000-0000-4000-8000-0000000000c0', ('19e90000-0000-4000-8000-0000000050f' || n)::uuid,
       '19e90000-0000-4000-8000-0000000050d1', '19e90000-0000-4000-8000-0000000050e1', 'm', 'send_email', 'succeeded',
       pg_temp.w('d1') + interval '10 minutes'
  FROM generate_series(1, 2) n;
INSERT INTO public.journey_messages (message_id, tenant_id, enrollment_id, journey_id, version_id, node_id, lead_id, queued_at)
SELECT 'i9-zap-m' || n, '19e90000-0000-4000-8000-0000000000c0', ('19e90000-0000-4000-8000-0000000050f' || n)::uuid,
       '19e90000-0000-4000-8000-0000000050d1', '19e90000-0000-4000-8000-0000000050e1', 'm',
       ('19e90000-0000-4000-8000-0000000030a' || n)::uuid, pg_temp.w('d1') + interval '10 minutes'
  FROM generate_series(1, 2) n;
INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, tenant_id, created_at)
SELECT 'i9-zap-m' || n, 'journey', 'l' || n || '@i9-zapisy.test', 'sent', '19e90000-0000-4000-8000-0000000000c0',
       pg_temp.w('d1') + interval '11 minutes'
  FROM generate_series(1, 2) n;
INSERT INTO public.journey_message_events (tenant_id, message_id, kind, occurred_at, day)
VALUES ('19e90000-0000-4000-8000-0000000000c0', 'i9-zap-m1', 'click', pg_temp.w('d1') + interval '2 hours',
        (pg_temp.w('d1') AT TIME ZONE 'UTC')::date);

-- ── 1. Odczyt PRZED czyszczeniem ─────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('19e90000-0000-4000-8000-00000000c001');
INSERT INTO r SELECT 'j_old', public.admin_journey_stats('19e90000-0000-4000-8000-0000000050d1', NULL,
                                                         pg_temp.w('since'), pg_temp.w('until')) -> 'journey';
INSERT INTO r SELECT 'j_all', public.admin_journey_stats('19e90000-0000-4000-8000-0000000050d1', NULL,
                                                         pg_temp.w('since'), now()) -> 'journey';
INSERT INTO r SELECT 'j_ver', public.admin_journey_stats('19e90000-0000-4000-8000-0000000050d1',
                                                         '19e90000-0000-4000-8000-0000000050e1',
                                                         pg_temp.w('since'), pg_temp.w('until')) -> 'journey';
INSERT INTO r SELECT 's_old', pg_temp.busy(public.admin_journey_series('19e90000-0000-4000-8000-0000000050d1',
                                                                       pg_temp.w('since'), pg_temp.w('until')));
RESET ROLE;

SELECT is((SELECT v FROM r WHERE k = 'j_old'),
  '{"enrolled": 5, "active": 0, "waiting": 0, "completed": 1, "goal_reached": 1, "failed": 1,
    "exited": {"consent": 1, "unsubscribed": 1}, "goal_rate": 0.2000}'::jsonb,
  'przed: podsumowanie okna sprzed progu z surowych zapisów (bez zapisu testowego - test nie jest pusty)');
SELECT is((SELECT jsonb_array_length(v) FROM r WHERE k = 's_old'), 3,
  'przed: seria ma trzy dni z ruchem (d1, d2, d3)');

-- ── 2. Czyszczenie (najemca po karencji) ─────────────────────────────────────
INSERT INTO r SELECT 'run', public._data_retention_run_tenant('19e90000-0000-4000-8000-0000000000c0', 'schedule', 1000);
SELECT ok((SELECT v -> 'journey_enrollments' ->> 'mode' = 'execute' FROM r WHERE k = 'run')
          AND NOT EXISTS (SELECT 1 FROM public.journey_enrollments
                           WHERE journey_id = '19e90000-0000-4000-8000-0000000050d1'
                             AND finished_at < pg_temp.w('until'))
          AND (SELECT count(*) FROM public.journey_enrollments
                WHERE journey_id = '19e90000-0000-4000-8000-0000000050d1') = 2,
  'czyszczenie: stare zakończone zapisy (także testowy) usunięte, świeże zostają');
SELECT is((SELECT sum(enrollments)::int FROM public.journey_enrollment_daily_stats
            WHERE journey_id = '19e90000-0000-4000-8000-0000000050d1'), 5,
  'zestawienie: pięć zapisów złożonych - zapis testowy pominięty');
SELECT is((SELECT jsonb_agg(jsonb_build_object('entered', entered_day - (pg_temp.w('d1') AT TIME ZONE 'UTC')::date,
                                               'finished', finished_day - (pg_temp.w('d1') AT TIME ZONE 'UTC')::date,
                                               'status', status, 'reason', exit_reason, 'n', enrollments)
                            ORDER BY entered_day, finished_day, status, exit_reason)
             FROM public.journey_enrollment_daily_stats WHERE journey_id = '19e90000-0000-4000-8000-0000000050d1'),
  '[{"entered": 0, "finished": 0, "status": "completed", "reason": "completed", "n": 1},
    {"entered": 0, "finished": 1, "status": "goal_reached", "reason": "goal", "n": 1},
    {"entered": 1, "finished": 1, "status": "exited", "reason": "unsubscribed", "n": 1},
    {"entered": 1, "finished": 2, "status": "exited", "reason": "consent", "n": 1},
    {"entered": 2, "finished": 2, "status": "failed", "reason": "error", "n": 1}]'::jsonb,
  'zestawienie: dzień wejścia, dzień zakończenia, status i powód wyjścia');
SELECT is((SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'journey_enrollment_daily_stats'),
  ARRAY['tenant_id', 'journey_id', 'version_id', 'entered_day', 'finished_day', 'status', 'exit_reason',
        'enrollments', 'updated_at'],
  'zestawienie: bez kontaktu, leada i identyfikatora zapisu (minimalizacja)');

-- ── 3. Odczyt PO czyszczeniu - ten sam wynik ─────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('19e90000-0000-4000-8000-00000000c001');
SELECT is(public.admin_journey_stats('19e90000-0000-4000-8000-0000000050d1', NULL,
                                     pg_temp.w('since'), pg_temp.w('until')) -> 'journey',
  (SELECT v FROM r WHERE k = 'j_old'),
  'podsumowanie: okno sprzed progu identyczne po czyszczeniu (zestawienie zamiast surowych)');
SELECT is(public.admin_journey_stats('19e90000-0000-4000-8000-0000000050d1', NULL,
                                     pg_temp.w('since'), now()) -> 'journey',
  (SELECT v FROM r WHERE k = 'j_all'),
  'podsumowanie: okno przecinające próg identyczne (surowe + zestawienie, aktywny zapis z surowych)');
SELECT is(public.admin_journey_stats('19e90000-0000-4000-8000-0000000050d1', '19e90000-0000-4000-8000-0000000050e1',
                                     pg_temp.w('since'), pg_temp.w('until')) -> 'journey',
  (SELECT v FROM r WHERE k = 'j_ver'),
  'podsumowanie: filtr wersji obejmuje zestawienie');
SELECT is(pg_temp.busy(public.admin_journey_series('19e90000-0000-4000-8000-0000000050d1',
                                                   pg_temp.w('since'), pg_temp.w('until'))),
  (SELECT v FROM r WHERE k = 's_old'),
  'seria: wejścia, cele, wyjścia, maile i kliknięcia dni sprzed progu identyczne po czyszczeniu');
RESET ROLE;

-- ── 4. Idempotencja, podgląd, dokładanie ─────────────────────────────────────
SELECT public._data_retention_run_tenant('19e90000-0000-4000-8000-0000000000c0', 'manual', 1000);
SELECT is((SELECT sum(enrollments)::int FROM public.journey_enrollment_daily_stats
            WHERE journey_id = '19e90000-0000-4000-8000-0000000050d1'), 5,
  'powtórny przebieg: niczego nie dubluje (zapis usunięty nie wraca do składania)');
-- Zapis 9: zakończony obok zapisu 1 (ten sam dzień i powód).
INSERT INTO public.journey_enrollments (id, tenant_id, journey_id, version_id, lead_id, status, trigger_snapshot,
                                        enrollment_key, entered_at, finished_at, exit_reason)
VALUES ('19e90000-0000-4000-8000-0000000050f9', '19e90000-0000-4000-8000-0000000000c0',
        '19e90000-0000-4000-8000-0000000050d1', '19e90000-0000-4000-8000-0000000050e1',
        '19e90000-0000-4000-8000-0000000030a9', 'completed', '{}', 'zap-9', pg_temp.w('d1'),
        pg_temp.w('d1') + interval '5 hours', 'completed');
SELECT is(public._data_retention_journey_enrollments('19e90000-0000-4000-8000-0000000000c0',
            now() - interval '13 months', false, 100) ->> 'affected', '1',
  'podgląd: liczy zapis do usunięcia');
SELECT ok(EXISTS (SELECT 1 FROM public.journey_enrollments WHERE id = '19e90000-0000-4000-8000-0000000050f9')
          AND (SELECT sum(enrollments)::int FROM public.journey_enrollment_daily_stats
                WHERE journey_id = '19e90000-0000-4000-8000-0000000050d1') = 5,
  'podgląd: nic nie usuwa i nic nie składa');
SELECT is(public._data_retention_journey_enrollments('19e90000-0000-4000-8000-0000000000c0',
            now() - interval '13 months', true, 100) ->> 'affected', '1',
  'wykonanie: zapis usunięty');
SELECT is((SELECT enrollments FROM public.journey_enrollment_daily_stats
            WHERE journey_id = '19e90000-0000-4000-8000-0000000050d1' AND status = 'completed'
              AND entered_day = (pg_temp.w('d1') AT TIME ZONE 'UTC')::date), 2,
  'wykonanie: zapis dołożony do istniejącego wiersza (ON CONFLICT n + nowe)');

-- ── 5. ACL ───────────────────────────────────────────────────────────────────
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.journey_enrollment_daily_stats'::regclass)
          AND NOT has_table_privilege('anon', 'public.journey_enrollment_daily_stats', 'SELECT')
          AND NOT has_table_privilege('authenticated', 'public.journey_enrollment_daily_stats', 'SELECT')
          AND NOT has_table_privilege('authenticated', 'public.journey_enrollment_daily_stats', 'INSERT'),
  'ACL: RLS włączone, anon i authenticated bez dostępu do tabeli');
SELECT ok(has_table_privilege('service_role', 'public.journey_enrollment_daily_stats', 'SELECT')
          AND has_table_privilege('service_role', 'public.journey_enrollment_daily_stats', 'INSERT')
          AND NOT has_function_privilege('authenticated',
                'public._data_retention_journey_enrollments(uuid, timestamptz, boolean, integer)', 'EXECUTE')
          AND has_function_privilege('authenticated',
                'public.admin_journey_series(uuid, timestamptz, timestamptz)', 'EXECUTE'),
  'ACL: service_role pisze; funkcja retencji wewnętrzna, seria dla panelu (bramka roli w ciele)');

SELECT * FROM finish();
ROLLBACK;
