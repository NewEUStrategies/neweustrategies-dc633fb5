-- pgTAP: skaner cyklu życia subskrypcji (S2, migracja 20261020110500).
--
-- CO PRZYPINA:
--   * `billing_subscription.trial_ending.v1` RAZ dla triala `live` kończącego
--     się w ciągu 3 dni (znacznik `trial_ending`); trial za 5 dni i sandbox -
--     bez zdarzenia;
--   * `subscription.expired.v1` z powodem: `ended` (rezygnacja na koniec
--     okresu), `unpaid` (brak płatności), `paused` (pauza - win-back jej nie
--     dotyczy), `canceled` (natychmiast); bez zdarzenia: koniec okresu sprzed
--     ponad 7 dni i konto z inną żywą subskrypcją; payload bez PII;
--   * windykacja: cykl `open` starszy niż 30 dni -> `lost`, młodszy zostaje;
--   * migawka dzienna = suma ruchów księgi (dryf 0) per waluta, z segmentem,
--     trialami i udziałem kwot z katalogu;
--   * powtórka przebiegu: zero nowych zdarzeń, znaczników i migawek;
--   * granty: wyłącznie service_role (funkcja serwisowa, najemca z wiersza).
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test revenue_lifecycle_scanner
BEGIN;
SELECT plan(16);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO public.tenants (id, slug, name) VALUES
  ('d2050000-0000-0000-0000-0000000000a0', 'hub-s2-scan-a', 'Hub S2 skaner A');
INSERT INTO auth.users (id, email)
SELECT ('d2050000-0000-0000-0000-00000000a1' || lpad(n::text, 2, '0'))::uuid, 'c' || n || '@hub-s2-scan.test'
  FROM generate_series(1, 12) n;
INSERT INTO public.profiles (id, email, display_name, tenant_id)
SELECT ('d2050000-0000-0000-0000-00000000a1' || lpad(n::text, 2, '0'))::uuid, 'c' || n || '@hub-s2-scan.test',
       'C' || n, 'd2050000-0000-0000-0000-0000000000a0'
  FROM generate_series(1, 12) n;

CREATE FUNCTION pg_temp.sub(p_n integer, p_price text, p_status text, p_env text, p_unit integer, p_cur text,
  p_qty integer DEFAULT 1, p_trial timestamptz DEFAULT NULL, p_end timestamptz DEFAULT NULL,
  p_cancel boolean DEFAULT false, p_fail integer DEFAULT 0, p_user integer DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.subscriptions (id, tenant_id, user_id, provider_subscription_id, provider_customer_id,
    product_id, price_id, status, environment, unit_amount_minor, currency, quantity, trial_ends_at,
    current_period_end, cancel_at_period_end, payment_failure_count, last_event_id)
  VALUES (('d2050000-0000-0000-0000-0000000005' || lpad(p_n::text, 2, '0'))::uuid,
          'd2050000-0000-0000-0000-0000000000a0',
          ('d2050000-0000-0000-0000-00000000a1' || lpad(COALESCE(p_user, p_n)::text, 2, '0'))::uuid,
          'sub_scan_' || p_n, 'cus_scan_' || p_n, 'plan_x', p_price, p_status, p_env, p_unit, p_cur, p_qty,
          p_trial, p_end, p_cancel, p_fail, 'evt_scan_' || p_n)
$$;
-- Triale: 01 za 2 dni (zdarzenie), 02 za 5 dni, 03 sandbox za 1 dzień.
SELECT pg_temp.sub(1, 'pro_monthly', 'trialing', 'live', NULL, NULL, 1, now() + interval '2 days');
SELECT pg_temp.sub(2, 'plus_monthly', 'trialing', 'live', NULL, NULL, 1, now() + interval '5 days');
SELECT pg_temp.sub(3, 'plus_monthly', 'trialing', 'sandbox', NULL, NULL, 1, now() + interval '1 day');
-- Wygaśnięcia: 04 rezygnacja na koniec, 05 brak płatności, 06 pauza,
-- 07 sprzed 20 dni, 08 konto z inną żywą subskrypcją (09), 10 natychmiast.
SELECT pg_temp.sub(4, 'plus_monthly', 'canceled', 'live', 3900, 'PLN', 1, NULL, now() - interval '2 days', true);
SELECT pg_temp.sub(5, 'plus_monthly', 'unpaid', 'live', 3900, 'PLN', 1, NULL, now() - interval '1 day', false, 2);
SELECT pg_temp.sub(6, 'pro_annual', 'paused', 'live', 119000, 'PLN', 1, NULL, now() - interval '3 days');
SELECT pg_temp.sub(7, 'plus_monthly', 'canceled', 'live', 3900, 'PLN', 1, NULL, now() - interval '20 days', true);
SELECT pg_temp.sub(8, 'plus_monthly', 'canceled', 'live', 3900, 'PLN', 1, NULL, now() - interval '1 day', true);
SELECT pg_temp.sub(9, 'plus_annual', 'active', 'live', 39000, 'PLN', 1, NULL, now() + interval '300 days', false, 0, 8);
SELECT pg_temp.sub(10, 'plus_monthly', 'canceled', 'live', 3900, 'PLN', 1, NULL, now() - interval '1 day');
-- Płatne (migawka dzienna): 11 Zespół 12 miejsc z katalogu, 12 EUR z migawki.
SELECT pg_temp.sub(11, 'team_monthly_seat', 'active', 'live', NULL, NULL, 12, NULL, now() + interval '20 days');
SELECT pg_temp.sub(12, 'plus_monthly', 'active', 'live', 900, 'EUR', 1, NULL, now() + interval '20 days');

-- Windykacja: cykl sprzed 31 dni (utrata) i sprzed 10 dni (zostaje otwarty).
INSERT INTO public.dunning_cycles (tenant_id, subscription_id, user_id, environment, started_at, outcome,
  failures, mrr_at_risk_minor, currency) VALUES
  ('d2050000-0000-0000-0000-0000000000a0', 'd2050000-0000-0000-0000-000000000505', NULL, 'live', now() - interval '31 days', 'open', 3, 3900, 'PLN'),
  ('d2050000-0000-0000-0000-0000000000a0', 'd2050000-0000-0000-0000-000000000512', NULL, 'live', now() - interval '10 days', 'open', 1, 900, 'EUR');

-- ── 1. Granty ────────────────────────────────────────────────────────────────
SELECT ok(
  has_function_privilege('service_role', 'public.run_revenue_lifecycle_scanner()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.run_revenue_lifecycle_scanner()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.run_revenue_lifecycle_scanner()', 'EXECUTE')
  AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.run_revenue_lifecycle_scanner()'::regprocedure),
  'acl: skaner tylko dla service_role, SECURITY DEFINER');

-- ── 2. Pierwszy przebieg ─────────────────────────────────────────────────────
CREATE TEMP TABLE run1 ON COMMIT DROP AS SELECT public.run_revenue_lifecycle_scanner() AS r;
SELECT is((SELECT (r->>'trial_ending')::int FROM run1), 1, 'trial: jeden trial live za ≤ 3 dni');
SELECT is(
  (SELECT count(*)::integer FROM public.domain_events
    WHERE event_type = 'billing_subscription.trial_ending.v1' AND aggregate_id = 'd2050000-0000-0000-0000-000000000501'),
  1,
  'trial: zdarzenie dla właściwej subskrypcji');
SELECT is(
  (SELECT count(*)::integer FROM public.domain_events
    WHERE event_type = 'billing_subscription.trial_ending.v1'
      AND aggregate_id IN ('d2050000-0000-0000-0000-000000000502', 'd2050000-0000-0000-0000-000000000503')),
  0,
  'trial: za 5 dni i sandbox - bez zdarzenia');
SELECT set_eq(
  $$ SELECT aggregate_id || ':' || (payload->>'reason') FROM public.domain_events
      WHERE event_type = 'subscription.expired.v1'
        AND aggregate_id LIKE 'd2050000-0000-0000-0000-0000000005%' $$,
  ARRAY['d2050000-0000-0000-0000-000000000504:ended', 'd2050000-0000-0000-0000-000000000505:unpaid',
        'd2050000-0000-0000-0000-000000000506:paused', 'd2050000-0000-0000-0000-000000000510:canceled'],
  'expired: powody ended / unpaid / paused / canceled; bez starych i bez kont z inną żywą subskrypcją');
SELECT is(
  (SELECT payload->>'tier_key' FROM public.domain_events
    WHERE event_type = 'subscription.expired.v1' AND aggregate_id = 'd2050000-0000-0000-0000-000000000506'),
  'pro',
  'expired: warstwa z katalogu cen');
SELECT is_empty(
  $$ SELECT k FROM public.domain_events e, jsonb_object_keys(e.payload) k
      WHERE e.event_type IN ('subscription.expired.v1', 'billing_subscription.trial_ending.v1')
        AND e.aggregate_id LIKE 'd2050000-%'
        AND k NOT IN ('subscription_id', 'user_id', 'tier_key', 'reason', 'trial_ends_at') $$,
  'payload: wyłącznie identyfikatory i enumy (bez PII)');
SELECT ok(
  (SELECT bool_and(actor_id IS NULL) FROM public.domain_events
    WHERE event_type IN ('subscription.expired.v1', 'billing_subscription.trial_ending.v1')
      AND aggregate_id LIKE 'd2050000-%'),
  'zdarzenia skanera bez aktora (p_suppress_actor)');
SELECT results_eq(
  $$ SELECT currency, outcome, lost_at IS NOT NULL FROM public.dunning_cycles
      WHERE tenant_id = 'd2050000-0000-0000-0000-0000000000a0' AND started_at < now() - interval '1 day'
      ORDER BY currency $$,
  $$ VALUES ('EUR'::text, 'open'::text, false), ('PLN'::text, 'lost'::text, true) $$,
  'windykacja: open > 30 dni -> lost, młodszy cykl zostaje otwarty');
SELECT results_eq(
  $$ SELECT currency, sum(mrr_minor)::bigint FROM public.mrr_daily_snapshots
      WHERE tenant_id = 'd2050000-0000-0000-0000-0000000000a0' AND environment = 'live'
        AND day = (now() AT TIME ZONE 'UTC')::date
      GROUP BY currency ORDER BY currency $$,
  $$ SELECT currency, mrr_minor FROM public._revenue_mrr_at('d2050000-0000-0000-0000-0000000000a0', now() + interval '1 second')
      ORDER BY currency $$,
  'migawka dzienna = suma ruchów księgi per waluta (dryf 0)');
SELECT results_eq(
  $$ SELECT segment, mrr_minor::bigint, active_subscriptions, basis_catalog_share FROM public.mrr_daily_snapshots
      WHERE tenant_id = 'd2050000-0000-0000-0000-0000000000a0' AND environment = 'live' AND currency = 'PLN'
        AND day = (now() AT TIME ZONE 'UTC')::date AND mrr_minor > 0
      ORDER BY segment $$,
  $$ VALUES ('b2b_institution'::text, 94800::bigint, 1, 1.0000::numeric(5,4)),
            ('b2c_individual'::text, 3250::bigint, 1, 0.0000::numeric(5,4)) $$,
  'migawka: segment z warstwy, udział kwot z katalogu (Zespół 12 × 79 zł)');
SELECT is(
  (SELECT sum(trialing)::integer FROM public.mrr_daily_snapshots
    WHERE tenant_id = 'd2050000-0000-0000-0000-0000000000a0' AND environment = 'live'
      AND day = (now() AT TIME ZONE 'UTC')::date),
  2,
  'migawka: triale live policzone osobno (bez MRR)');

-- ── 3. Powtórka nic nie dubluje ─────────────────────────────────────────────
CREATE TEMP TABLE counts_before ON COMMIT DROP AS
  SELECT (SELECT count(*) FROM public.domain_events WHERE aggregate_id LIKE 'd2050000-%') AS events,
         (SELECT count(*) FROM public.revenue_event_marks WHERE tenant_id = 'd2050000-0000-0000-0000-0000000000a0') AS marks,
         (SELECT count(*) FROM public.mrr_daily_snapshots WHERE tenant_id = 'd2050000-0000-0000-0000-0000000000a0') AS snaps;
CREATE TEMP TABLE run2 ON COMMIT DROP AS SELECT public.run_revenue_lifecycle_scanner() AS r;
SELECT is((SELECT r FROM run2) - 'snapshots',
  '{"expired": 0, "dunning_lost": 0, "trial_ending": 0}'::jsonb,
  'powtórka: zero nowych zdarzeń skanera');
SELECT is((SELECT (r->>'snapshots')::int FROM run2), 0, 'powtórka: migawka raz na dobę');
SELECT ok(
  (SELECT events FROM counts_before) = (SELECT count(*) FROM public.domain_events WHERE aggregate_id LIKE 'd2050000-%')
  AND (SELECT marks FROM counts_before) = (SELECT count(*) FROM public.revenue_event_marks WHERE tenant_id = 'd2050000-0000-0000-0000-0000000000a0')
  AND (SELECT snaps FROM counts_before) = (SELECT count(*) FROM public.mrr_daily_snapshots WHERE tenant_id = 'd2050000-0000-0000-0000-0000000000a0'),
  'powtórka: te same zdarzenia, znaczniki i migawki');
SELECT set_eq(
  $$ SELECT kind FROM public.revenue_event_marks WHERE tenant_id = 'd2050000-0000-0000-0000-0000000000a0' $$,
  ARRAY['trial_ending', 'expired', 'dunning_lost', 'mrr_snapshot'],
  'znaczniki: każdy rodzaj faktu zapisany');

SELECT * FROM finish();
ROLLBACK;
