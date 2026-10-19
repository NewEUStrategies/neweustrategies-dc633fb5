-- pgTAP: licznik artykułów - próg rangi (P19), wyczerpanie limitu i tożsamość
-- telemetrii (S3, migracja 20261020120200).
--
-- CO PRZYPINA:
--   * P19: treść z `min_tier_rank` powyżej rangi czytającego NIE jest
--     odblokowywana licznikiem - konto bez warstwy, konto z warstwą niższą
--     (member 10 < pro 20) i gość dostają werdykt „licznik nie dotyczy" (bez
--     body, bez slotu, bez wiersza `metered_views`);
--   * konto z wystarczającą rangą czyta przez `has_content_access` - body bez
--     zużycia licznika (zachowanie sprzed S3);
--   * treść bez progu działa bit w bit jak dotąd (granted + consumed);
--   * `metering.quota_exhausted.v1` raz na konto i miesiąc (znacznik
--     `revenue_event_marks`), payload bez PII; awaria szyny nie zabiera
--     odmowy czytelnikowi;
--   * 1000 wywołań `_metered_view_consume` (przez `consume_metered_view`)
--     bez ANI JEDNEGO skanu sekwencyjnego `metering_event_log`
--     (`pg_stat_xact_user_tables` - liczniki tej transakcji);
--   * `log_metering_event`: `user_id` z `auth.uid()`, cudzy `_visitor_id`
--     od konta odrzucony (42501), za długi powód 22023, anon bez EXECUTE;
--   * atrybuty i ACL rdzenia bez zmian (bez EXECUTE dla ról API).
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test metering_quota_rank_gate
BEGIN;
SELECT plan(24);

ALTER TABLE auth.users DISABLE TRIGGER USER;

UPDATE public.tenants SET is_default = false WHERE is_default;
INSERT INTO public.tenants (id, slug, name, is_default) VALUES
  ('c3200000-0000-0000-0000-0000000000a0', 'hub-s3-meter-a', 'Hub S3 licznik A', true);
SELECT public.seed_membership_tiers('c3200000-0000-0000-0000-0000000000a0');

INSERT INTO auth.users (id, email) VALUES
  ('c3200000-0000-0000-0000-00000000a001', 'plain@hub-s3-meter.test'),
  ('c3200000-0000-0000-0000-00000000a002', 'pro@hub-s3-meter.test'),
  ('c3200000-0000-0000-0000-00000000a003', 'member@hub-s3-meter.test'),
  ('c3200000-0000-0000-0000-00000000a004', 'down@hub-s3-meter.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c3200000-0000-0000-0000-00000000a001', 'plain@hub-s3-meter.test', 'Plain', 'c3200000-0000-0000-0000-0000000000a0'),
  ('c3200000-0000-0000-0000-00000000a002', 'pro@hub-s3-meter.test', 'Pro', 'c3200000-0000-0000-0000-0000000000a0'),
  ('c3200000-0000-0000-0000-00000000a003', 'member@hub-s3-meter.test', 'Member', 'c3200000-0000-0000-0000-0000000000a0'),
  ('c3200000-0000-0000-0000-00000000a004', 'down@hub-s3-meter.test', 'Down', 'c3200000-0000-0000-0000-0000000000a0');
INSERT INTO public.membership_grants (tenant_id, user_id, tier_key) VALUES
  ('c3200000-0000-0000-0000-0000000000a0', 'c3200000-0000-0000-0000-00000000a002', 'pro'),
  ('c3200000-0000-0000-0000-0000000000a0', 'c3200000-0000-0000-0000-00000000a003', 'member');

INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('c3200000-0000-0000-0000-0000000000d1', 'c3200000-0000-0000-0000-0000000000a0', 'meter-home-a');
INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl, content_pl)
SELECT ('c3200000-0000-0000-0000-0000000000e' || n)::uuid, 'meter-post-' || n,
       'c3200000-0000-0000-0000-00000000a001', 'published',
       'c3200000-0000-0000-0000-0000000000a0', 'c3200000-0000-0000-0000-0000000000d1',
       'Post ' || n, '<p>Treść ' || n || '</p>'
  FROM generate_series(1, 6) AS n;
-- e1: płatna bez progu; e2: płatna od Pro (20); e3: tylko dla członków od Pro;
-- e4-e6: płatne bez progu (do wyczerpania limitu).
INSERT INTO public.content_access (tenant_id, entity_type, entity_id, mode, plan_ids, min_tier_rank, metering_policy) VALUES
  ('c3200000-0000-0000-0000-0000000000a0', 'post', 'c3200000-0000-0000-0000-0000000000e1', 'paid', '{}', 0, 'inherit'),
  ('c3200000-0000-0000-0000-0000000000a0', 'post', 'c3200000-0000-0000-0000-0000000000e2', 'paid', '{}', 20, 'inherit'),
  ('c3200000-0000-0000-0000-0000000000a0', 'post', 'c3200000-0000-0000-0000-0000000000e3', 'members', '{}', 20, 'metered'),
  ('c3200000-0000-0000-0000-0000000000a0', 'post', 'c3200000-0000-0000-0000-0000000000e4', 'paid', '{}', 0, 'inherit'),
  ('c3200000-0000-0000-0000-0000000000a0', 'post', 'c3200000-0000-0000-0000-0000000000e5', 'paid', '{}', 0, 'inherit'),
  ('c3200000-0000-0000-0000-0000000000a0', 'post', 'c3200000-0000-0000-0000-0000000000e6', 'paid', '{}', 0, 'inherit');

INSERT INTO public.metering_settings
  (tenant_id, enabled, member_monthly_limit, anon_monthly_limit, meter_paid, meter_members, show_counter)
VALUES ('c3200000-0000-0000-0000-0000000000a0', true, 2, 3, true, true, true)
ON CONFLICT (tenant_id) DO UPDATE SET enabled = true, member_monthly_limit = 2, anon_monthly_limit = 3,
  meter_paid = true, meter_members = true, show_counter = true;

DELETE FROM public.domain_events WHERE tenant_id = 'c3200000-0000-0000-0000-0000000000a0';

-- ── P19: konto bez warstwy ───────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c3200000-0000-0000-0000-00000000a001","role":"authenticated"}', true);

SELECT results_eq(
  $$ SELECT granted, consumed, used, monthly_limit, content_pl
       FROM public.consume_metered_view('post', 'c3200000-0000-0000-0000-0000000000e2') $$,
  $$ VALUES (false, false, 0, 0, NULL::text) $$,
  'P19: treść od Pro nie jest odblokowywana licznikiem kontu bez warstwy');
SELECT results_eq(
  $$ SELECT granted, consumed, content_pl
       FROM public.consume_metered_view('post', 'c3200000-0000-0000-0000-0000000000e3') $$,
  $$ VALUES (false, false, NULL::text) $$,
  'P19: polityka metered nie omija progu rangi (tryb members)');
SELECT results_eq(
  $$ SELECT granted, consumed, used, monthly_limit
       FROM public.consume_metered_view('post', 'c3200000-0000-0000-0000-0000000000e1') $$,
  $$ VALUES (true, true, 1, 2) $$,
  'treść bez progu: zachowanie sprzed S3 (granted + consumed, 1/2)');

-- ── P19: konto z warstwą niższą (member 10 < 20) ─────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"c3200000-0000-0000-0000-00000000a003","role":"authenticated"}', true);
SELECT results_eq(
  $$ SELECT granted, consumed, content_pl
       FROM public.consume_metered_view('post', 'c3200000-0000-0000-0000-0000000000e2') $$,
  $$ VALUES (false, false, NULL::text) $$,
  'P19: warstwa member (10) nie dostaje treści Pro (20) licznikiem');

-- ── Konto z rangą: body przez has_content_access, bez licznika ──────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"c3200000-0000-0000-0000-00000000a002","role":"authenticated"}', true);
SELECT results_eq(
  $$ SELECT granted, consumed, monthly_limit, content_pl IS NOT NULL
       FROM public.consume_metered_view('post', 'c3200000-0000-0000-0000-0000000000e2') $$,
  $$ VALUES (true, false, 0, true) $$,
  'warstwa Pro czyta treść Pro bez zużycia licznika');

RESET ROLE;
SELECT is_empty(
  $$ SELECT 1 FROM public.metered_views
      WHERE tenant_id = 'c3200000-0000-0000-0000-0000000000a0'
        AND entity_id IN ('c3200000-0000-0000-0000-0000000000e2', 'c3200000-0000-0000-0000-0000000000e3') $$,
  'P19: żadnego slotu licznika na treściach z progiem');

-- ── P19: gość przez serwer ──────────────────────────────────────────────────
SET LOCAL ROLE service_role;
SELECT results_eq(
  $$ SELECT granted, consumed, requires_registration, content_pl
       FROM public.consume_metered_view_visitor('c3200000-0000-0000-0000-0000000000a0', 'post',
         'c3200000-0000-0000-0000-0000000000e2', 'c3200000-0000-0000-0000-0000000000f1',
         'ip:' || repeat('a1', 16)) $$,
  $$ VALUES (false, false, false, NULL::text) $$,
  'P19: gość (ranga warstwy domyślnej) nie czyta treści Pro licznikiem');
SELECT results_eq(
  $$ SELECT granted, consumed
       FROM public.consume_metered_view_visitor('c3200000-0000-0000-0000-0000000000a0', 'post',
         'c3200000-0000-0000-0000-0000000000e1', 'c3200000-0000-0000-0000-0000000000f1',
         'ip:' || repeat('a1', 16)) $$,
  $$ VALUES (true, true) $$,
  'gość na treści bez progu: licznik działa jak dotąd');
RESET ROLE;

-- ── Wyczerpanie limitu konta: zdarzenie raz w miesiącu ───────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c3200000-0000-0000-0000-00000000a001","role":"authenticated"}', true);
SELECT results_eq(
  $$ SELECT granted, used FROM public.consume_metered_view('post', 'c3200000-0000-0000-0000-0000000000e4') $$,
  $$ VALUES (true, 2) $$,
  'drugi artykuł zużywa ostatni slot (2/2)');
SELECT results_eq(
  $$ SELECT granted, consumed, used, monthly_limit, remaining
       FROM public.consume_metered_view('post', 'c3200000-0000-0000-0000-0000000000e5') $$,
  $$ VALUES (false, false, 2, 2, 0) $$,
  'trzeci artykuł: odmowa z pełnym stanem licznika');
RESET ROLE;

SELECT results_eq(
  $$ SELECT aggregate_type, aggregate_id, actor_id, payload FROM public.domain_events
      WHERE event_type = 'metering.quota_exhausted.v1' AND tenant_id = 'c3200000-0000-0000-0000-0000000000a0' $$,
  $$ VALUES ('metering', 'c3200000-0000-0000-0000-00000000a001', 'c3200000-0000-0000-0000-00000000a001'::uuid,
             jsonb_build_object('user_id', 'c3200000-0000-0000-0000-00000000a001',
                                'period_month', to_char(now(), 'YYYY-MM'), 'limit', 2)) $$,
  'pierwsza odmowa: metering.quota_exhausted.v1 {user_id, period_month, limit}');
SELECT results_eq(
  $$ SELECT kind, ref FROM public.revenue_event_marks
      WHERE tenant_id = 'c3200000-0000-0000-0000-0000000000a0' $$,
  $$ VALUES ('quota', 'c3200000-0000-0000-0000-00000000a001:' || to_char(now(), 'YYYY-MM')) $$,
  'znacznik quota <konto>:<RRRR-MM> w revenue_event_marks');

-- ── 1000 wywołań: zero skanów sekwencyjnych metering_event_log ───────────────
CREATE TEMP TABLE scan_before ON COMMIT DROP AS
  SELECT COALESCE((SELECT seq_scan FROM pg_stat_xact_user_tables
                    WHERE schemaname = 'public' AND relname = 'metering_event_log'), 0) AS seq_scan;
GRANT SELECT ON scan_before TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c3200000-0000-0000-0000-00000000a001","role":"authenticated"}', true);
SELECT lives_ok(
  $$ DO $do$
     BEGIN
       FOR i IN 1..1000 LOOP
         PERFORM * FROM public.consume_metered_view(
           'post', ('c3200000-0000-0000-0000-0000000000e' || (5 + (i % 2)))::uuid);
       END LOOP;
     END
     $do$ $$,
  '1000 wywołań consume_metered_view po wyczerpaniu limitu');
RESET ROLE;

SELECT is(
  COALESCE((SELECT seq_scan FROM pg_stat_xact_user_tables
             WHERE schemaname = 'public' AND relname = 'metering_event_log'), 0)
    - (SELECT seq_scan FROM scan_before),
  0::bigint,
  '1000 wywołań _metered_view_consume bez skanu sekwencyjnego metering_event_log');
SELECT is(
  (SELECT count(*)::int FROM public.domain_events
    WHERE event_type = 'metering.quota_exhausted.v1' AND tenant_id = 'c3200000-0000-0000-0000-0000000000a0'),
  1, 'tysiąc odmów w miesiącu = jedno zdarzenie quota_exhausted');

-- ── Awaria szyny przy wyczerpaniu: odmowa wraca, ślad zostaje ───────────────
CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid, p_aggregate_type text, p_aggregate_id text, p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb, p_actor_id uuid DEFAULT NULL, p_suppress_actor boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'bus down' USING ERRCODE = 'P0001';
END;
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c3200000-0000-0000-0000-00000000a004","role":"authenticated"}', true);
SELECT public.consume_metered_view('post', 'c3200000-0000-0000-0000-0000000000e1');
SELECT public.consume_metered_view('post', 'c3200000-0000-0000-0000-0000000000e4');
SELECT results_eq(
  $$ SELECT granted, used, remaining FROM public.consume_metered_view('post', 'c3200000-0000-0000-0000-0000000000e5') $$,
  $$ VALUES (false, 2, 0) $$,
  'awaria szyny: czytelnik i tak dostaje odmowę z licznikiem');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.domain_event_emit_errors
    WHERE source = '_metered_view_consume' AND event_type = 'metering.quota_exhausted.v1'
      AND tenant_id = 'c3200000-0000-0000-0000-0000000000a0'),
  1, 'awaria emitera quota zapisana w domain_event_emit_errors');

-- ── log_metering_event: tożsamość z sesji ───────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c3200000-0000-0000-0000-00000000a003","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.log_metering_event('post', 'c3200000-0000-0000-0000-0000000000e2', 'denied',
       'monthly_limit_reached', 'c3200000-0000-0000-0000-0000000000f9', 0, 2) $$,
  '42501', NULL, 'konto nie loguje odmowy z cudzym kluczem gościa');
SELECT throws_ok(
  $$ SELECT public.log_metering_event('post', 'c3200000-0000-0000-0000-0000000000e2', 'denied',
       repeat('r', 121), NULL, 0, 2) $$,
  '22023', NULL, 'powód dłuższy niż 120 znaków -> 22023 (bez przycinania)');
SELECT lives_ok(
  $$ SELECT public.log_metering_event('post', 'c3200000-0000-0000-0000-0000000000e2', 'denied',
       'monthly_limit_reached', NULL, 2, 2) $$,
  'konto loguje własną odmowę');
RESET ROLE;
SELECT results_eq(
  $$ SELECT user_id, visitor_id, outcome FROM public.metering_event_log
      WHERE tenant_id = 'c3200000-0000-0000-0000-0000000000a0' AND outcome = 'denied'
        AND entity_id = 'c3200000-0000-0000-0000-0000000000e2' $$,
  $$ VALUES ('c3200000-0000-0000-0000-00000000a003'::uuid, NULL::uuid, 'denied') $$,
  'wiersz telemetrii: user_id z auth.uid(), bez klucza gościa');

-- ── ACL i atrybuty ──────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.log_metering_event(text, uuid, text, text, uuid, integer, integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.log_metering_event(text, uuid, text, text, uuid, integer, integer)', 'EXECUTE'),
  'log_metering_event: anon bez EXECUTE, konto z EXECUTE');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid)', 'EXECUTE'),
  'rdzeń _metered_view_consume bez EXECUTE dla ról API');
SELECT ok(
  (SELECT bool_and(p.prosecdef AND 'search_path=public, pg_temp' = ANY (p.proconfig))
     FROM pg_proc p
    WHERE p.oid IN ('public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid)'::regprocedure,
                    'public.log_metering_event(text, uuid, text, text, uuid, integer, integer)'::regprocedure)),
  'rdzeń i telemetria: SECURITY DEFINER z search_path public, pg_temp');

SELECT * FROM finish();
ROLLBACK;
