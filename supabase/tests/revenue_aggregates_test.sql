-- pgTAP: agregaty przychodu (S2, migracje 20261020110300 i 20261020110400).
--
-- CO PRZYPINA (okno: wrzesień 2026 UTC, waluta wiodąca PLN):
--   * most: start + otwarcie + new + expansion + reactivation + contraction +
--     churn = koniec, per waluta (PLN i EUR osobno - nigdy suma walut), także
--     z filtrem segmentu (ten sam zbiór subskrypcji na początku i na końcu);
--   * migawka semantyczna = kontrakt S6 (`REVENUE_SNAPSHOT_KEYS`, klucze
--     najwyższego poziomu i `movements`): MRR/ARR/ARPA/ARPU, ruchy, liczności,
--     NRR/GRR kohortowo, quick ratio, udziały, windykacja, kohorty M1,
--     trial -> płatny, przychód zrealizowany z dokumentów i z zamówień;
--   * `null` zamiast zera: okno przed początkiem księgi, mianownik zero
--     (kohorty M3/M12), rabat i cena katalogu dla okna historycznego;
--   * sandbox i operator `mock` nie zmieniają wyniku; dokument bez
--     środowiska liczy się jako „nieznany", nie jako przychód;
--   * szereg MRR na koniec kubełka w strefie Europe/Warsaw + migawka dzienna;
--   * churn, kohorty, windykacja, przychód zrealizowany - kształt i liczby;
--   * role: editor -> 42501 w każdym RPC (kwoty tylko admin), anon bez
--     EXECUTE; dwóch najemców; `window_invalid` (22023); helpery bez EXECUTE.
--
-- Kształty RPC innych niż migawka: stałe `*_KEYS` w
-- src/lib/revenue/finance/parse.ts (`-- rpc-shape`) - te same listy niżej.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test revenue_aggregates
BEGIN;
SELECT plan(48);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO public.tenants (id, slug, name) VALUES
  ('d2040000-0000-0000-0000-0000000000a0', 'hub-s2-agg-a', 'Hub S2 agregaty A'),
  ('d2040000-0000-0000-0000-0000000000b0', 'hub-s2-agg-b', 'Hub S2 agregaty B');
INSERT INTO auth.users (id, email) VALUES
  ('d2040000-0000-0000-0000-00000000a001', 'admin-a@hub-s2-agg.test'),
  ('d2040000-0000-0000-0000-00000000a002', 'editor-a@hub-s2-agg.test'),
  ('d2040000-0000-0000-0000-00000000b001', 'admin-b@hub-s2-agg.test');
INSERT INTO auth.users (id, email)
SELECT ('d2040000-0000-0000-0000-00000000a10' || n)::uuid, 'c' || n || '@hub-s2-agg.test'
  FROM generate_series(1, 8) n;
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d2040000-0000-0000-0000-00000000a001', 'admin-a@hub-s2-agg.test', 'Admin A', 'd2040000-0000-0000-0000-0000000000a0'),
  ('d2040000-0000-0000-0000-00000000a002', 'editor-a@hub-s2-agg.test', 'Editor A', 'd2040000-0000-0000-0000-0000000000a0'),
  ('d2040000-0000-0000-0000-00000000b001', 'admin-b@hub-s2-agg.test', 'Admin B', 'd2040000-0000-0000-0000-0000000000b0');
INSERT INTO public.profiles (id, email, display_name, tenant_id)
SELECT ('d2040000-0000-0000-0000-00000000a10' || n)::uuid, 'c' || n || '@hub-s2-agg.test', 'C' || n,
       'd2040000-0000-0000-0000-0000000000a0'
  FROM generate_series(1, 8) n;
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('d2040000-0000-0000-0000-00000000a001', 'admin', 'd2040000-0000-0000-0000-0000000000a0'),
  ('d2040000-0000-0000-0000-00000000a002', 'editor', 'd2040000-0000-0000-0000-0000000000a0'),
  ('d2040000-0000-0000-0000-00000000b001', 'admin', 'd2040000-0000-0000-0000-0000000000b0');

-- Subskrypcje (stan bieżący) bez triggera - księgę budujemy ręcznie z datami.
ALTER TABLE public.subscriptions DISABLE TRIGGER trg_subscriptions_revenue_history;
INSERT INTO public.subscriptions (id, tenant_id, user_id, provider_subscription_id, provider_customer_id,
  product_id, price_id, status, environment, unit_amount_minor, currency, discount_minor_per_period,
  discount_ends_at) VALUES
  ('d2040000-0000-0000-0000-0000000005a1', 'd2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a101', 'sub_agg_1', 'cus_agg_1', 'plan_plus', 'plus_monthly', 'active', 'live', 5900, 'PLN', 1000, now() + interval '60 days'),
  ('d2040000-0000-0000-0000-0000000005a2', 'd2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a102', 'sub_agg_2', 'cus_agg_2', 'plan_plus', 'plus_monthly', 'canceled', 'live', 3900, 'PLN', 0, NULL),
  ('d2040000-0000-0000-0000-0000000005a3', 'd2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a103', 'sub_agg_3', 'cus_agg_3', 'plan_pro', 'pro_monthly', 'active', 'live', 11900, 'PLN', 0, NULL),
  ('d2040000-0000-0000-0000-0000000005a4', 'd2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a104', 'sub_agg_4', 'cus_agg_4', 'plan_plus', 'plus_annual', 'active', 'live', 36000, 'PLN', 0, NULL),
  ('d2040000-0000-0000-0000-0000000005a5', 'd2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a105', 'sub_agg_5', 'cus_agg_5', 'plan_team', 'team_monthly_seat', 'active', 'live', NULL, NULL, 0, NULL),
  ('d2040000-0000-0000-0000-0000000005a6', 'd2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a106', 'sub_agg_6', 'cus_agg_6', 'plan_plus', 'plus_monthly', 'active', 'live', 900, 'EUR', 0, NULL),
  ('d2040000-0000-0000-0000-0000000005a7', 'd2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a107', 'sub_agg_7', 'cus_agg_7', 'plan_plus', 'plus_monthly', 'active', 'sandbox', 100000, 'PLN', 0, NULL),
  ('d2040000-0000-0000-0000-0000000005a8', 'd2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a108', 'sub_agg_8', 'cus_agg_8', 'plan_plus', 'plus_monthly', 'canceled', 'live', 3900, 'PLN', 0, NULL);
ALTER TABLE public.subscriptions ENABLE TRIGGER trg_subscriptions_revenue_history;

CREATE FUNCTION pg_temp.mv(p_sub text, p_user text, p_at timestamptz, p_kind text, p_reason text,
  p_before integer, p_after integer, p_cur text, p_seg text, p_int text,
  p_backfilled boolean DEFAULT false, p_env text DEFAULT 'live',
  p_tenant uuid DEFAULT 'd2040000-0000-0000-0000-0000000000a0') RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.mrr_movements (tenant_id, subscription_id, user_id, environment, occurred_at, kind,
    reason, mrr_before_minor, mrr_after_minor, currency, interval_after, segment, backfilled)
  VALUES (p_tenant, ('d2040000-0000-0000-0000-0000000005' || p_sub)::uuid,
          ('d2040000-0000-0000-0000-00000000' || p_user)::uuid, p_env, p_at, p_kind, p_reason,
          p_before, p_after, p_cur, p_int, p_seg, p_backfilled)
$$;
SELECT pg_temp.mv('a1', 'a101', '2026-08-10', 'new', 'signup', 0, 3900, 'PLN', 'b2c_individual', 'month');
SELECT pg_temp.mv('a1', 'a101', '2026-09-05', 'expansion', 'quantity', 3900, 5900, 'PLN', 'b2c_individual', 'month');
SELECT pg_temp.mv('a2', 'a102', '2026-08-12', 'new', 'signup', 0, 3900, 'PLN', 'b2c_individual', 'month');
SELECT pg_temp.mv('a2', 'a102', '2026-09-15', 'churn', 'canceled', 3900, 0, 'PLN', 'b2c_individual', 'month');
SELECT pg_temp.mv('a3', 'a103', '2026-09-03', 'new', 'trial_converted', 0, 11900, 'PLN', 'b2c_individual', 'month');
SELECT pg_temp.mv('a4', 'a104', '2026-07-01', 'new', 'signup', 0, 3250, 'PLN', 'b2c_individual', 'year');
SELECT pg_temp.mv('a4', 'a104', '2026-09-20', 'contraction', 'price', 3250, 3000, 'PLN', 'b2c_individual', 'year');
SELECT pg_temp.mv('a5', 'a105', '2026-09-02', 'new', 'backfill', 0, 5000, 'PLN', 'b2b_institution', 'month', true);
SELECT pg_temp.mv('a6', 'a106', '2026-08-01', 'new', 'signup', 0, 900, 'EUR', 'b2c_individual', 'month');
SELECT pg_temp.mv('a6', 'a106', '2026-09-10', 'churn', 'unpaid', 900, 0, 'EUR', 'b2c_individual', 'month');
SELECT pg_temp.mv('a6', 'a106', '2026-09-25', 'reactivation', 'resumed', 0, 900, 'EUR', 'b2c_individual', 'month');
SELECT pg_temp.mv('a7', 'a107', '2026-09-05', 'new', 'signup', 0, 100000, 'PLN', 'b2c_individual', 'month', false, 'sandbox');
SELECT pg_temp.mv('b1', 'b001', '2026-09-05', 'new', 'signup', 0, 4900, 'PLN', 'b2c_individual', 'month', false, 'live',
                  'd2040000-0000-0000-0000-0000000000b0');

-- Historia: trial -> płatny (a3, podstawa provider) i trial -> anulowany (a8).
INSERT INTO public.subscription_state_history (tenant_id, subscription_id, user_id, environment, occurred_at,
  status_before, status_after, price_id_before, price_id_after, quantity_before, quantity_after, paused_after,
  cancel_at_period_end_after, payment_failure_count_after, mrr_before_minor, mrr_after_minor, currency,
  mrr_basis, dedupe_key) VALUES
  ('d2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-0000000005a3', 'd2040000-0000-0000-0000-00000000a103', 'live', '2026-09-03',
   'trialing', 'active', 'pro_monthly', 'pro_monthly', 1, 1, false, false, 0, 0, 11900, 'PLN', 'provider', 'agg-h1'),
  ('d2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-0000000005a8', 'd2040000-0000-0000-0000-00000000a108', 'live', '2026-09-04',
   'trialing', 'canceled', 'plus_monthly', 'plus_monthly', 1, 1, false, false, 0, 0, 0, 'PLN', 'provider', 'agg-h2');

-- Windykacja: d1 odzyskany (15 dni), d4 odzyskany (6 dni), d2 utracony, d3 otwarty.
INSERT INTO public.dunning_cycles (tenant_id, subscription_id, user_id, environment, started_at, recovered_at,
  lost_at, outcome, failures, mrr_at_risk_minor, currency) VALUES
  ('d2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-0000000005a1', NULL, 'live', '2026-08-28', '2026-09-12', NULL, 'recovered', 1, 3900, 'PLN'),
  ('d2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-0000000005a6', NULL, 'live', '2026-08-15', NULL, '2026-09-20', 'lost', 3, 900, 'EUR'),
  ('d2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-0000000005a4', NULL, 'live', '2026-09-25', NULL, NULL, 'open', 1, 3000, 'PLN'),
  ('d2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-0000000005a3', NULL, 'live', '2026-09-02', '2026-09-08', NULL, 'recovered', 1, 2000, 'PLN'),
  ('d2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-0000000005a7', NULL, 'sandbox', '2026-09-02', '2026-09-08', NULL, 'recovered', 1, 99999, 'PLN');

-- Przychód zrealizowany: dokumenty i zamówienia (opłacone zakłada serwer).
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.payment_orders (id, tenant_id, user_id, kind, amount_cents, currency, environment, provider,
  status, paid_at, refunded_amount_cents, metadata) VALUES
  ('d2040000-0000-0000-0000-0000000008a2', 'd2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a103', 'subscription', 11900, 'PLN', 'live', 'stripe', 'paid', '2026-09-05', 1900, '{}'),
  ('d2040000-0000-0000-0000-0000000008a5', 'd2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a103', 'one_time', 2500, 'PLN', 'live', 'stripe', 'paid', '2026-09-06', 0, '{"event_id": "d2040000-0000-0000-0000-00000000e001"}'),
  ('d2040000-0000-0000-0000-0000000008a9', 'd2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a103', 'one_time', 7700, 'PLN', 'sandbox', 'stripe', 'paid', '2026-09-06', 0, '{}'),
  ('d2040000-0000-0000-0000-0000000008aa', 'd2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a103', 'one_time', 8800, 'PLN', 'live', 'mock', 'paid', '2026-09-06', 0, '{}');
SELECT set_config('request.jwt.claim.role', '', true);
INSERT INTO public.billing_documents (tenant_id, user_id, order_id, kind, status, provider, provider_document_id,
  amount_cents, currency, environment, issued_at) VALUES
  ('d2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a101', NULL, 'invoice', 'paid', 'stripe', 'in_agg_1', 5900, 'PLN', 'live', '2026-09-05'),
  ('d2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a103', 'd2040000-0000-0000-0000-0000000008a2', 'invoice', 'paid', 'stripe', 'in_agg_2', 11900, 'PLN', NULL, '2026-09-05'),
  ('d2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a103', NULL, 'invoice', 'paid', 'stripe', 'in_agg_3', 10000, 'PLN', 'sandbox', '2026-09-05'),
  ('d2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a103', NULL, 'invoice', 'paid', 'mock', 'in_agg_4', 10000, 'PLN', 'live', '2026-09-05'),
  ('d2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a103', 'd2040000-0000-0000-0000-0000000008a5', 'receipt', 'paid', 'stripe', 'in_agg_5', 2500, 'PLN', 'live', '2026-09-06'),
  ('d2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a106', NULL, 'invoice', 'paid', 'stripe', 'in_agg_6', 900, 'EUR', 'live', '2026-09-07'),
  ('d2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a106', NULL, 'credit_note', 'paid', 'stripe', 'in_agg_7', 900, 'EUR', 'live', '2026-09-08'),
  ('d2040000-0000-0000-0000-0000000000a0', 'd2040000-0000-0000-0000-00000000a106', NULL, 'invoice', 'paid', 'stripe', 'in_agg_8', 4400, 'PLN', NULL, '2026-09-09');

INSERT INTO public.mrr_daily_snapshots (tenant_id, day, environment, currency, segment, mrr_minor,
  active_subscriptions, active_customers, trialing, basis_catalog_share) VALUES
  ('d2040000-0000-0000-0000-0000000000a0', '2026-09-30', 'live', 'PLN', 'b2c_individual', 20800, 3, 3, 0, 0),
  ('d2040000-0000-0000-0000-0000000000a0', '2026-09-30', 'live', 'PLN', 'b2b_institution', 5000, 1, 1, 0, 1);

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
CREATE TEMP TABLE res (name text PRIMARY KEY, r jsonb) ON COMMIT DROP;
GRANT SELECT, INSERT ON res TO authenticated;

-- ── 1. ACL ───────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT bool_and(NOT has_function_privilege(r, p.oid, 'EXECUTE'))
     FROM pg_proc p CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) r
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('_revenue_mrr_at', '_revenue_movements', '_revenue_realized')),
  'acl: helpery _revenue_* bez EXECUTE dla anon, authenticated i service_role');
SELECT ok(
  (SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                   AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('admin_revenue_semantic_snapshot', 'admin_revenue_mrr_bridge', 'admin_revenue_mrr_series',
                        'admin_revenue_churn', 'admin_revenue_cohorts', 'admin_revenue_dunning', 'admin_revenue_realized')),
  'acl: 7 RPC panelu - authenticated i service_role, nigdy anon');

-- ── 2. Role i okno ───────────────────────────────────────────────────────────
SELECT pg_temp.as_user('d2040000-0000-0000-0000-00000000a002');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.admin_revenue_semantic_snapshot('2026-09-01', '2026-10-01') $$, '42501', 'forbidden',
  'rola: editor nie czyta migawki finansowej (42501)');
SELECT throws_ok($$ SELECT public.admin_revenue_mrr_bridge('2026-09-01', '2026-10-01') $$, '42501', 'forbidden',
  'rola: editor nie czyta mostu MRR');
SELECT throws_ok($$ SELECT public.admin_revenue_realized('2026-09-01', '2026-10-01') $$, '42501', 'forbidden',
  'rola: editor nie czyta przychodu zrealizowanego');
SELECT throws_ok($$ SELECT public.admin_revenue_dunning('2026-09-01', '2026-10-01') $$, '42501', 'forbidden',
  'rola: editor nie czyta windykacji');
SELECT pg_temp.as_user('d2040000-0000-0000-0000-00000000a001');
SELECT throws_ok($$ SELECT public.admin_revenue_mrr_bridge('2026-10-01', '2026-09-01') $$, '22023', 'window_invalid',
  'okno: koniec przed początkiem -> 22023');
SELECT throws_ok($$ SELECT public.admin_revenue_churn('2025-01-01', '2026-10-01') $$, '22023', 'window_invalid',
  'okno: dłuższe niż 400 dni -> 22023');
SELECT throws_ok($$ SELECT public.admin_revenue_mrr_series('2026-01-01', '2026-10-01', 'day') $$, '22023', 'grain_invalid',
  'szereg: ziarno dzienne ponad 120 dni -> 22023');

INSERT INTO res SELECT 'snap', public.admin_revenue_semantic_snapshot('2026-09-01', '2026-10-01');
INSERT INTO res SELECT 'snap_now', public.admin_revenue_semantic_snapshot(now() - interval '30 days', now());
INSERT INTO res SELECT 'snap_empty', public.admin_revenue_semantic_snapshot('2026-01-01', '2026-02-01');
INSERT INTO res SELECT 'bridge', public.admin_revenue_mrr_bridge('2026-09-01', '2026-10-01');
INSERT INTO res SELECT 'bridge_b2b', public.admin_revenue_mrr_bridge('2026-09-01', '2026-10-01', 'b2b_institution');
INSERT INTO res SELECT 'bridge_b2c', public.admin_revenue_mrr_bridge('2026-09-01', '2026-10-01', 'b2c_individual');
INSERT INTO res SELECT 'series', public.admin_revenue_mrr_series('2026-06-30 22:00+00', '2026-09-30 22:00+00', 'month', 'Europe/Warsaw');
INSERT INTO res SELECT 'churn', public.admin_revenue_churn('2026-09-01', '2026-10-01');
INSERT INTO res SELECT 'cohorts', public.admin_revenue_cohorts('2026-07-01', '2026-09-01');
INSERT INTO res SELECT 'dunning', public.admin_revenue_dunning('2026-09-01', '2026-10-01');
INSERT INTO res SELECT 'realized', public.admin_revenue_realized('2026-09-01', '2026-10-01');
SELECT pg_temp.as_user('d2040000-0000-0000-0000-00000000b001');
INSERT INTO res SELECT 'snap_b', public.admin_revenue_semantic_snapshot('2026-09-01', '2026-10-01');
RESET ROLE;

-- ── 3. Kształt (kontrakt S6 i `*_KEYS` z finance/parse.ts) ─────────────────
SELECT set_eq(
  $$ SELECT jsonb_object_keys(r) FROM res WHERE name = 'snap' $$,
  ARRAY['data_since', 'computed_at', 'basis_mix',
        'mrr', 'arr', 'arpa', 'arpu', 'net_new_mrr', 'mrr_start', 'mrr_end', 'revenue_realized', 'revenue_realized_orders',
        'movements', 'active_subscriptions', 'active_customers', 'customers_start', 'customers_churned',
        'expansion_share_new_mrr', 'annual_plan_share', 'gross_revenue_churn', 'gross_revenue_retention',
        'involuntary_churn_share', 'dunning_recovery_rate', 'winback_rate_12m', 'returning_subscriber_share',
        'cohort_retention_m1', 'cohort_retention_m3', 'cohort_retention_m12', 'trial_to_paid_rate', 'average_discount',
        'net_revenue_retention', 'saas_quick_ratio', 'price_realization', 'mrr_growth_mom'],
  'kształt: migawka = REVENUE_SNAPSHOT_KEYS (S6)');
SELECT set_eq($$ SELECT jsonb_object_keys(r -> 'movements') FROM res WHERE name = 'snap' $$,
  ARRAY['new', 'expansion', 'reactivation', 'contraction', 'churn'], 'kształt: movements migawki');
SELECT set_eq($$ SELECT jsonb_object_keys(r) FROM res WHERE name = 'bridge' $$,
  ARRAY['since', 'until', 'segment', 'data_since', 'currencies', 'active_subscriptions', 'active_customers'],
  'kształt: most (MRR_BRIDGE_KEYS.root)');
SELECT set_eq($$ SELECT jsonb_object_keys(r -> 'currencies' -> 0) FROM res WHERE name = 'bridge' $$,
  ARRAY['currency', 'start_minor', 'opening_minor', 'new_minor', 'expansion_minor', 'reactivation_minor',
        'contraction_minor', 'churn_minor', 'net_new_minor', 'end_minor', 'active_subscriptions', 'active_customers'],
  'kształt: wiersz waluty mostu (MRR_BRIDGE_KEYS.currency)');
SELECT set_eq($$ SELECT jsonb_object_keys(r -> 'points' -> 0) FROM res WHERE name = 'series' $$,
  ARRAY['bucket_start', 'at', 'currency', 'mrr_minor', 'active_subscriptions', 'snapshot_mrr_minor'],
  'kształt: punkt szeregu (MRR_SERIES_KEYS.point)');
SELECT set_eq($$ SELECT jsonb_object_keys(r) FROM res WHERE name = 'churn' $$,
  ARRAY['since', 'until', 'customers_start', 'customers_churned', 'logo_churn_rate', 'involuntary_share', 'currencies', 'reasons'],
  'kształt: churn (CHURN_KEYS.root)');
SELECT set_eq($$ SELECT jsonb_object_keys(r -> 'currencies' -> 0) FROM res WHERE name = 'churn' $$,
  ARRAY['currency', 'mrr_start_minor', 'churn_minor', 'contraction_minor', 'expansion_minor', 'reactivation_minor',
        'gross_revenue_churn', 'gross_revenue_retention', 'net_revenue_retention'],
  'kształt: waluta churnu (CHURN_KEYS.currency)');
SELECT set_eq($$ SELECT jsonb_object_keys(r) FROM res WHERE name = 'cohorts' $$,
  ARRAY['from_month', 'to_month', 'max_offset', 'cohorts'], 'kształt: kohorty (COHORTS_KEYS.root)');
SELECT set_eq($$ SELECT jsonb_object_keys(r) FROM res WHERE name = 'dunning' $$,
  ARRAY['since', 'until', 'started', 'recovered', 'lost', 'open', 'recovery_rate', 'median_days_to_recover',
        'at_risk', 'recovered_mrr', 'lost_mrr'],
  'kształt: windykacja (DUNNING_KEYS.root)');
SELECT set_eq($$ SELECT jsonb_object_keys(r) FROM res WHERE name = 'realized' $$,
  ARRAY['since', 'until', 'categories', 'totals', 'orders', 'unknown_environment_documents'],
  'kształt: przychód zrealizowany (REALIZED_KEYS.root)');

-- ── 4. Most: identyczność start + Σ = koniec, waluty, segment ──────────────
SELECT results_eq(
  $$ SELECT c->>'currency', (c->>'start_minor')::int, (c->>'opening_minor')::int, (c->>'new_minor')::int,
            (c->>'expansion_minor')::int, (c->>'reactivation_minor')::int, (c->>'contraction_minor')::int,
            (c->>'churn_minor')::int, (c->>'end_minor')::int
       FROM res, jsonb_array_elements(r -> 'currencies') c WHERE name = 'bridge' ORDER BY 1 $$,
  $$ VALUES ('EUR'::text, 900, 0, 0, 0, 900, 0, -900, 900),
            ('PLN'::text, 11050, 5000, 11900, 2000, 0, -250, -3900, 25800) $$,
  'most: liczby per waluta (PLN i EUR osobno), sandbox bez wpływu');
SELECT is_empty(
  $$ SELECT 1 FROM res, jsonb_array_elements(r -> 'currencies') c
      WHERE name IN ('bridge', 'bridge_b2b', 'bridge_b2c')
        AND (c->>'start_minor')::bigint + (c->>'opening_minor')::bigint + (c->>'new_minor')::bigint
            + (c->>'expansion_minor')::bigint + (c->>'reactivation_minor')::bigint
            + (c->>'contraction_minor')::bigint + (c->>'churn_minor')::bigint <> (c->>'end_minor')::bigint $$,
  'most: start + otwarcie + Σ ruchów = koniec (także z filtrem segmentu)');
SELECT results_eq(
  $$ SELECT c->>'currency', (c->>'start_minor')::int, (c->>'opening_minor')::int, (c->>'end_minor')::int
       FROM res, jsonb_array_elements(r -> 'currencies') c WHERE name = 'bridge_b2b' $$,
  $$ VALUES ('PLN'::text, 0, 5000, 5000) $$,
  'most: segment b2b - tylko subskrypcje tego segmentu');
SELECT is((SELECT (r->>'active_subscriptions')::int FROM res WHERE name = 'bridge'), 5,
  'most: aktywne subskrypcje na koniec (wszystkie waluty)');

-- ── 5. Migawka semantyczna ───────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT x->>'currency', (x->>'amount_minor')::bigint FROM res, jsonb_array_elements(r -> 'mrr') x
      WHERE name = 'snap' ORDER BY 1 $$,
  $$ VALUES ('EUR'::text, 900::bigint), ('PLN'::text, 25800::bigint) $$,
  'migawka: MRR na koniec per waluta (= koniec mostu - ten sam helper)');
SELECT ok(
  (SELECT (r #>> '{arr,0,amount_minor}')::bigint = 25800 * 12 AND r #>> '{arr,0,currency}' = 'PLN'
          AND (SELECT (x->>'amount_minor')::bigint FROM jsonb_array_elements(r -> 'arpa') x WHERE x->>'currency' = 'PLN') = 6450
     FROM res WHERE name = 'snap'),
  'migawka: ARR = MRR × 12, ARPA = MRR / klienci (PLN: 25 800 / 4)');
SELECT results_eq(
  $$ SELECT x->>'currency', (x->>'amount_minor')::bigint FROM res, jsonb_array_elements(r -> 'mrr_start') x
      WHERE name = 'snap' ORDER BY 1 $$,
  $$ VALUES ('EUR'::text, 900::bigint), ('PLN'::text, 16050::bigint) $$,
  'migawka: MRR na początku = saldo + otwarcie z backfillu');
SELECT ok(
  (SELECT r #> '{movements,new}' = '[{"currency": "PLN", "amount_minor": 11900}]'::jsonb
          AND r #> '{movements,churn}' = '[{"currency": "EUR", "amount_minor": -900}, {"currency": "PLN", "amount_minor": -3900}]'::jsonb
          AND r #> '{movements,reactivation}' = '[{"currency": "EUR", "amount_minor": 900}]'::jsonb
     FROM res WHERE name = 'snap'),
  'migawka: ruchy per waluta ze znakiem; otwarcie z backfillu nie jest „nowym"');
SELECT results_eq(
  $$ SELECT (r->>'active_subscriptions')::int, (r->>'active_customers')::int, (r->>'customers_start')::int,
            (r->>'customers_churned')::int FROM res WHERE name = 'snap' $$,
  $$ VALUES (5, 5, 5, 1) $$,
  'migawka: liczności aktywnych, klientów na start i odejść');
SELECT results_eq(
  $$ SELECT (r->>'net_revenue_retention')::numeric, (r->>'gross_revenue_retention')::numeric,
            (r->>'gross_revenue_churn')::numeric, (r->>'saas_quick_ratio')::numeric,
            (r->>'expansion_share_new_mrr')::numeric, (r->>'mrr_growth_mom')::numeric
       FROM res WHERE name = 'snap' $$,
  $$ VALUES (0.8660::numeric, 0.7414::numeric, 0.2586::numeric, 3.3494::numeric, 0.1439::numeric, 0.6075::numeric) $$,
  'migawka: NRR/GRR kohortowo, quick ratio, udział rozszerzeń, wzrost - w walucie wiodącej (PLN)');
SELECT results_eq(
  $$ SELECT (r->>'involuntary_churn_share')::numeric, (r->>'returning_subscriber_share')::numeric,
            (r->>'winback_rate_12m')::numeric, (r->>'dunning_recovery_rate')::numeric,
            (r->>'cohort_retention_m1')::numeric, (r->>'trial_to_paid_rate')::numeric,
            (r->>'annual_plan_share')::numeric
       FROM res WHERE name = 'snap' $$,
  $$ VALUES (0.5::numeric, 0.5::numeric, 0.5::numeric, 0.6667::numeric, 0.6667::numeric, 0.5::numeric, 0.2::numeric) $$,
  'migawka: udział odejść za brak płatności, powroty, win-back, windykacja, kohorta M1, trial, plany roczne');
SELECT ok(
  (SELECT r->'cohort_retention_m3' = 'null'::jsonb AND r->'cohort_retention_m12' = 'null'::jsonb
          AND r->'average_discount' = 'null'::jsonb AND r->'price_realization' = 'null'::jsonb
     FROM res WHERE name = 'snap'),
  'migawka: null bez mianownika (kohorty M3/M12) i bez historii (rabat, realizacja ceny)');
SELECT results_eq(
  $$ SELECT (r->>'average_discount')::numeric, (r->>'price_realization')::numeric FROM res WHERE name = 'snap_now' $$,
  $$ VALUES (0.0186::numeric, 1.0394::numeric) $$,
  'migawka „teraz": średni rabat i realizacja ceny z bieżących subskrypcji (migawka vs katalog)');
SELECT is((SELECT r->'basis_mix' FROM res WHERE name = 'snap'), '{"catalog": 0.2, "provider": 0.8}'::jsonb,
  'migawka: podstawa kwot - 4/5 migawka operatora, 1/5 katalog (D-05 jawnie)');
SELECT ok(
  (SELECT r #> '{revenue_realized}' = '[{"currency": "EUR", "amount_minor": 900}, {"currency": "PLN", "amount_minor": 18400}]'::jsonb
          AND r #> '{revenue_realized_orders}' = '[{"currency": "PLN", "amount_minor": 12500}]'::jsonb
     FROM res WHERE name = 'snap'),
  'migawka: przychód zrealizowany netto z dokumentów i z zamówień (bez sandboxu, mock i not)');
SELECT ok(
  (SELECT r->'mrr' = 'null'::jsonb AND r->'movements' = 'null'::jsonb AND r->'net_revenue_retention' = 'null'::jsonb
          AND r->'active_subscriptions' = 'null'::jsonb FROM res WHERE name = 'snap_empty'),
  'migawka: okno przed początkiem księgi = null (brak danych), nie zero');
SELECT ok(
  (SELECT r #> '{mrr}' = '[{"currency": "PLN", "amount_minor": 4900}]'::jsonb FROM res WHERE name = 'snap_b'),
  'najemcy: admin B widzi wyłącznie swoje MRR');
SELECT is((SELECT (r->>'data_since')::timestamptz FROM res WHERE name = 'snap'), '2026-07-01 00:00+00'::timestamptz,
  'migawka: data_since = pierwszy ruch księgi live');

-- ── 6. Szereg MRR ────────────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT p->>'bucket_start', p->>'currency', (p->>'mrr_minor')::bigint, (p->>'snapshot_mrr_minor')::bigint
       FROM res, jsonb_array_elements(r -> 'points') p WHERE name = 'series' ORDER BY 1, 2 $$,
  $$ VALUES ('2026-07-01'::text, 'PLN'::text, 3250::bigint, NULL::bigint),
            ('2026-08-01'::text, 'EUR'::text, 900::bigint, NULL::bigint),
            ('2026-08-01'::text, 'PLN'::text, 11050::bigint, NULL::bigint),
            ('2026-09-01'::text, 'EUR'::text, 900::bigint, NULL::bigint),
            ('2026-09-01'::text, 'PLN'::text, 25800::bigint, 25800::bigint) $$,
  'szereg: MRR na koniec miesiąca LOKALNEGO (Europe/Warsaw) + migawka dzienna (dryf 0)');

-- ── 7. Churn ─────────────────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT (r->>'customers_start')::int, (r->>'customers_churned')::int, (r->>'logo_churn_rate')::numeric,
            (r->>'involuntary_share')::numeric FROM res WHERE name = 'churn' $$,
  $$ VALUES (5, 1, 0.2::numeric, 0.5::numeric) $$,
  'churn: logo 1/5, udział odejść za brak płatności 1/2');
SELECT results_eq(
  $$ SELECT c->>'currency', (c->>'mrr_start_minor')::int, (c->>'net_revenue_retention')::numeric,
            (c->>'gross_revenue_retention')::numeric
       FROM res, jsonb_array_elements(r -> 'currencies') c WHERE name = 'churn' ORDER BY 1 $$,
  $$ VALUES ('EUR'::text, 900, 1.0::numeric, 1.0::numeric), ('PLN'::text, 16050, 0.8660::numeric, 0.7414::numeric) $$,
  'churn: NRR/GRR per waluta (zgodne z migawką dla PLN)');
SELECT set_eq(
  $$ SELECT x->>'reason' || ':' || (x->>'movements') FROM res, jsonb_array_elements(r -> 'reasons') x WHERE name = 'churn' $$,
  ARRAY['canceled:1', 'unpaid:1'],
  'churn: powody odejść z księgi');

-- ── 8. Kohorty ───────────────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT c->>'cohort_month', (c->>'size')::int FROM res, jsonb_array_elements(r -> 'cohorts') c
      WHERE name = 'cohorts' ORDER BY 1 $$,
  $$ VALUES ('2026-07-01'::text, 1), ('2026-08-01'::text, 3), ('2026-09-01'::text, 1) $$,
  'kohorty: pierwszy płatny ruch, bez salda otwarcia (backfill) i bez sandboxu');
SELECT is(
  (SELECT (x->>'share')::numeric FROM res, jsonb_array_elements(r -> 'cohorts') c, jsonb_array_elements(c -> 'retained') x
    WHERE name = 'cohorts' AND c->>'cohort_month' = '2026-08-01' AND (x->>'month_offset')::int = 1),
  0.6667::numeric,
  'kohorty: sierpień po miesiącu - 2 z 3 (odejście a2, powrót a6)');

-- ── 9. Windykacja ────────────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT (r->>'started')::int, (r->>'recovered')::int, (r->>'lost')::int, (r->>'open')::int,
            (r->>'recovery_rate')::numeric, (r->>'median_days_to_recover')::numeric
       FROM res WHERE name = 'dunning' $$,
  $$ VALUES (2, 2, 1, 1, 0.6667::numeric, 10.5::numeric) $$,
  'windykacja: liczby, skuteczność 2/3, mediana dni do odzyskania; sandbox poza');
SELECT ok(
  (SELECT r->'at_risk' = '[{"currency": "PLN", "amount_minor": 3000}]'::jsonb
          AND r->'recovered_mrr' = '[{"currency": "PLN", "amount_minor": 5900}]'::jsonb
          AND r->'lost_mrr' = '[{"currency": "EUR", "amount_minor": 900}]'::jsonb
     FROM res WHERE name = 'dunning'),
  'windykacja: MRR zagrożone, odzyskane i utracone per waluta');

-- ── 10. Przychód zrealizowany ───────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT c->>'category', c->>'currency', (c->>'gross_minor')::int, (c->>'refunds_minor')::int,
            (c->>'net_minor')::int, (c->>'documents')::int
       FROM res, jsonb_array_elements(r -> 'categories') c WHERE name = 'realized' ORDER BY 1, 2 $$,
  $$ VALUES ('event'::text, 'PLN'::text, 2500, 0, 2500, 1),
            ('subscription'::text, 'EUR'::text, 900, 0, 900, 1),
            ('subscription'::text, 'PLN'::text, 17800, 1900, 15900, 2) $$,
  'realizacja: kategorie i waluty, zwrot częściowy z zamówienia, bez sandboxu, mock i not korygujących');
SELECT ok(
  (SELECT r->'totals' = '[{"currency": "EUR", "net_minor": 900, "gross_minor": 900, "refunds_minor": 0}, {"currency": "PLN", "net_minor": 18400, "gross_minor": 20300, "refunds_minor": 1900}]'::jsonb
          AND r->'orders' = '[{"orders": 2, "currency": "PLN", "amount_minor": 12500}]'::jsonb
          AND (r->>'unknown_environment_documents')::int = 1
     FROM res WHERE name = 'realized'),
  'realizacja: sumy per waluta, zamówienia do uzgodnienia, dokument o nieznanym środowisku');
SELECT is(
  (SELECT r #> '{revenue_realized}' FROM res WHERE name = 'snap'),
  (SELECT jsonb_agg(jsonb_build_object('currency', t->>'currency', 'amount_minor', (t->>'net_minor')::bigint) ORDER BY t->>'currency')
     FROM res, jsonb_array_elements(r -> 'totals') t WHERE name = 'realized'),
  'realizacja: migawka i RPC przychodu zrealizowanego dają te same liczby (jedna definicja)');

SELECT * FROM finish();
ROLLBACK;
