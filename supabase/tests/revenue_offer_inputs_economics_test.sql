-- pgTAP: macierz oferty, dane wejściowe planu i kosztów, ekonomika
-- jednostkowa (S2, migracja 20261020110700).
--
-- CO PRZYPINA:
--   * macierz: plany najemcy × warstwa × para katalogowa × `for_sale` /
--     `pricing_visible`, konflikty (`no_catalog_pair`, `tier_inactive`,
--     `tier_hidden`, `inactive_for_sale`, `visible_without_plan`); admin widzi
--     liczbę aktywnych subskrypcji planu, editor `NULL`;
--   * dane wejściowe: wyłącznie admin (editor 42501), współbieżność
--     optymistyczna (40001 przy nieaktualnym znaczniku i przy zapisie „nowego"
--     na istniejący), usunięcie obiema wartościami NULL, walidacje (22023 -
--     za długa notatka ODRZUCONA, nie przycięta), zdarzenie
--     `revenue_input.changed.v1` (payload bez kwot i notatki);
--   * ekonomika: bez wsadu wskaźniki NULL i pełne `missing[]` (nigdy
--     zgadywanie); z wsadem CAC, LTV, LTV:CAC, okres zwrotu, realizacja
--     planu - na fiksturze z ręcznie policzonymi wartościami; Rule of 40 bez
--     historii sprzed roku = NULL; dwóch najemców; granty.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test revenue_offer_inputs_economics
BEGIN;
SELECT plan(26);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO public.tenants (id, slug, name) VALUES
  ('d2070000-0000-0000-0000-0000000000a0', 'hub-s2-eco-a', 'Hub S2 ekonomika A'),
  ('d2070000-0000-0000-0000-0000000000b0', 'hub-s2-eco-b', 'Hub S2 ekonomika B');
INSERT INTO auth.users (id, email) VALUES
  ('d2070000-0000-0000-0000-00000000a001', 'admin-a@hub-s2-eco.test'),
  ('d2070000-0000-0000-0000-00000000a002', 'editor-a@hub-s2-eco.test'),
  ('d2070000-0000-0000-0000-00000000a101', 'c1@hub-s2-eco.test'),
  ('d2070000-0000-0000-0000-00000000b001', 'admin-b@hub-s2-eco.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d2070000-0000-0000-0000-00000000a001', 'admin-a@hub-s2-eco.test', 'Admin A', 'd2070000-0000-0000-0000-0000000000a0'),
  ('d2070000-0000-0000-0000-00000000a002', 'editor-a@hub-s2-eco.test', 'Editor A', 'd2070000-0000-0000-0000-0000000000a0'),
  ('d2070000-0000-0000-0000-00000000a101', 'c1@hub-s2-eco.test', 'C1', 'd2070000-0000-0000-0000-0000000000a0'),
  ('d2070000-0000-0000-0000-00000000b001', 'admin-b@hub-s2-eco.test', 'Admin B', 'd2070000-0000-0000-0000-0000000000b0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('d2070000-0000-0000-0000-00000000a001', 'admin', 'd2070000-0000-0000-0000-0000000000a0'),
  ('d2070000-0000-0000-0000-00000000a002', 'editor', 'd2070000-0000-0000-0000-0000000000a0'),
  ('d2070000-0000-0000-0000-00000000b001', 'admin', 'd2070000-0000-0000-0000-0000000000b0');

-- Konflikty oferty: warstwa ulgowa (educator) ukryta w cenniku, studencka
-- nieaktywna, plan roczny Partnera bez pary w katalogu, plan Pro roczny
-- w sprzedaży, ale nieaktywny.
UPDATE public.membership_tiers SET pricing_visible = false
 WHERE tenant_id = 'd2070000-0000-0000-0000-0000000000a0' AND key = 'educator';
UPDATE public.membership_tiers SET active = false
 WHERE tenant_id = 'd2070000-0000-0000-0000-0000000000a0' AND key = 'student';
UPDATE public.access_plans SET active = false
 WHERE tenant_id = 'd2070000-0000-0000-0000-0000000000a0' AND tier_key = 'pro' AND interval = 'year';
INSERT INTO public.access_plans (tenant_id, name_pl, name_en, tier_key, interval, price_cents, currency, active, for_sale)
VALUES ('d2070000-0000-0000-0000-0000000000a0', 'Partner roczny', 'Partner annual', 'partner', 'year', 990000, 'PLN', true, true);
INSERT INTO public.subscriptions (tenant_id, user_id, provider_subscription_id, provider_customer_id, product_id,
  price_id, status, environment, unit_amount_minor, currency, last_event_id)
VALUES ('d2070000-0000-0000-0000-0000000000a0', 'd2070000-0000-0000-0000-00000000a101', 'sub_eco_1', 'cus_eco_1',
        'plan_plus', 'plus_monthly', 'active', 'live', 3900, 'PLN', 'evt_eco_1');

-- Księga do ekonomiki (wrzesień 2026, Europe/Warsaw): s1 nowy we wrześniu,
-- s2 nowy w sierpniu i odszedł we wrześniu, s3 nowy w sierpniu.
DELETE FROM public.mrr_movements WHERE tenant_id = 'd2070000-0000-0000-0000-0000000000a0';
INSERT INTO public.mrr_movements (tenant_id, subscription_id, user_id, environment, occurred_at, kind, reason,
  mrr_before_minor, mrr_after_minor, currency, segment) VALUES
  ('d2070000-0000-0000-0000-0000000000a0', 'd2070000-0000-0000-0000-0000000005a1', NULL, 'live', '2026-09-05', 'new', 'signup', 0, 3900, 'PLN', 'b2c_individual'),
  ('d2070000-0000-0000-0000-0000000000a0', 'd2070000-0000-0000-0000-0000000005a2', NULL, 'live', '2026-08-20', 'new', 'signup', 0, 3900, 'PLN', 'b2c_individual'),
  ('d2070000-0000-0000-0000-0000000000a0', 'd2070000-0000-0000-0000-0000000005a2', NULL, 'live', '2026-09-10', 'churn', 'canceled', 3900, 0, 'PLN', 'b2c_individual'),
  ('d2070000-0000-0000-0000-0000000000a0', 'd2070000-0000-0000-0000-0000000005a3', NULL, 'live', '2026-08-25', 'new', 'signup', 0, 3900, 'PLN', 'b2c_individual');

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
CREATE TEMP TABLE res (name text PRIMARY KEY, r jsonb) ON COMMIT DROP;
GRANT SELECT, INSERT, UPDATE ON res TO authenticated;

-- ── 1. Granty ────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                   AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('admin_revenue_offer_matrix', 'admin_revenue_inputs', 'admin_revenue_input_upsert',
                        'admin_revenue_economics')),
  'acl: 4 RPC panelu - authenticated i service_role, nigdy anon');

-- ── 2. Macierz oferty ────────────────────────────────────────────────────────
SELECT pg_temp.as_user('d2070000-0000-0000-0000-00000000a001');
SET LOCAL ROLE authenticated;
INSERT INTO res SELECT 'matrix_admin', public.admin_revenue_offer_matrix();
SELECT pg_temp.as_user('d2070000-0000-0000-0000-00000000a002');
INSERT INTO res SELECT 'matrix_editor', public.admin_revenue_offer_matrix();
RESET ROLE;

SELECT set_eq($$ SELECT jsonb_object_keys(r) FROM res WHERE name = 'matrix_admin' $$, ARRAY['plans', 'tiers'],
  'macierz: kształt (OFFER_MATRIX_KEYS.root)');
SELECT set_eq($$ SELECT jsonb_object_keys(r -> 'plans' -> 0) FROM res WHERE name = 'matrix_admin' $$,
  ARRAY['plan_id', 'tier_key', 'interval', 'price_cents', 'currency', 'active', 'for_sale', 'catalog_price_id',
        'tier_active', 'pricing_visible', 'active_subscriptions', 'issues'],
  'macierz: kształt planu (OFFER_MATRIX_KEYS.plan)');
SELECT set_eq(
  $$ SELECT (p->>'tier_key') || '/' || (p->>'interval') || ':' || i
       FROM res, jsonb_array_elements(r -> 'plans') p, jsonb_array_elements_text(p -> 'issues') i
      WHERE name = 'matrix_admin' $$,
  ARRAY['educator/month:tier_hidden', 'student/month:tier_inactive', 'student/year:tier_inactive',
        'partner/year:no_catalog_pair', 'pro/year:inactive_for_sale'],
  'macierz: konflikty planów - warstwa ukryta/nieaktywna, brak pary w katalogu, nieaktywny w sprzedaży');
SELECT is(
  (SELECT p->>'catalog_price_id' FROM res, jsonb_array_elements(r -> 'plans') p
    WHERE name = 'matrix_admin' AND p->>'tier_key' = 'student' AND p->>'interval' = 'year'),
  'student_annual',
  'macierz: para katalogowa z lustra (student_annual)');
SELECT ok(
  (SELECT bool_or(t->>'key' = 'presidents_circle' AND t->'issues' ? 'visible_without_plan')
          AND NOT bool_or(t->>'key' = 'reader' AND t->'issues' ? 'visible_without_plan')
     FROM res, jsonb_array_elements(r -> 'tiers') t WHERE name = 'matrix_admin'),
  'macierz: warstwa widoczna w cenniku bez planu w sprzedaży (poza domyślną)');
SELECT is(
  (SELECT (p->>'active_subscriptions')::int FROM res, jsonb_array_elements(r -> 'plans') p
    WHERE name = 'matrix_admin' AND p->>'tier_key' = 'member' AND p->>'interval' = 'month'),
  1,
  'macierz: admin widzi liczbę aktywnych subskrypcji planu');
SELECT ok(
  (SELECT bool_and(p->'active_subscriptions' = 'null'::jsonb) FROM res, jsonb_array_elements(r -> 'plans') p
    WHERE name = 'matrix_editor'),
  'macierz: editor bez liczby płacących (NULL)');

-- ── 3. Dane wejściowe ────────────────────────────────────────────────────────
SELECT pg_temp.as_user('d2070000-0000-0000-0000-00000000a002');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.admin_revenue_inputs('2026-09-01', '2026-09-01') $$, '42501', 'forbidden',
  'dane wejściowe: editor nie czyta (D-06)');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_input_upsert('2026-09-01', 'mrr_plan', 'all', 'PLN', 30000, NULL, NULL, NULL) $$,
  '42501', 'forbidden', 'dane wejściowe: editor nie zapisuje');
SELECT pg_temp.as_user('d2070000-0000-0000-0000-00000000a001');
INSERT INTO res SELECT 'ins', public.admin_revenue_input_upsert('2026-09-01', 'mrr_plan', 'all', 'pln', 30000, NULL, 'Plan Q3', NULL);
SELECT throws_ok(
  $$ SELECT public.admin_revenue_input_upsert('2026-09-01', 'mrr_plan', 'all', 'PLN', 31000, NULL, NULL, '2000-01-01') $$,
  '40001', 'stale_write', 'współbieżność: nieaktualny znacznik -> 40001');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_input_upsert('2026-09-01', 'mrr_plan', 'all', 'PLN', 31000, NULL, NULL, NULL) $$,
  '40001', 'stale_write', 'współbieżność: „nowy" wiersz na istniejący -> 40001');
INSERT INTO res SELECT 'upd', public.admin_revenue_input_upsert('2026-09-01', 'mrr_plan', 'all', 'PLN', 31000, NULL, NULL,
  (SELECT (r #>> '{row,updated_at}')::timestamptz FROM res WHERE name = 'ins'));
SELECT throws_ok(
  $$ SELECT public.admin_revenue_input_upsert('2026-09-01', 'cogs', 'all', 'PLN', 100, NULL, repeat('x', 501), NULL) $$,
  '22023', 'note_too_long', 'walidacja: notatka > 500 znaków odrzucona (nie przycięta)');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_input_upsert('2026-09-01', 'gross_margin_pct', 'all', NULL, NULL, 1.5, NULL, NULL) $$,
  '22023', 'value_invalid', 'walidacja: marża poza [-1, 1]');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_input_upsert('2026-09-15', 'cogs', 'all', 'PLN', 100, NULL, NULL, NULL) $$,
  '22023', 'period_invalid', 'walidacja: okres musi być pierwszym dniem miesiąca');
INSERT INTO res SELECT 'sm', public.admin_revenue_input_upsert('2026-09-01', 'sales_marketing_cost', 'all', 'PLN', 20000, NULL, NULL, NULL);
INSERT INTO res SELECT 'gm', public.admin_revenue_input_upsert('2026-09-01', 'gross_margin_pct', 'all', NULL, NULL, 0.8, NULL, NULL);
INSERT INTO res SELECT 'eb', public.admin_revenue_input_upsert('2026-09-01', 'ebitda_margin_pct', 'all', NULL, NULL, 0.1, NULL, NULL);
INSERT INTO res SELECT 'tmp', public.admin_revenue_input_upsert('2026-09-01', 'cogs', 'all', 'PLN', 500, NULL, NULL, NULL);
INSERT INTO res SELECT 'del', public.admin_revenue_input_upsert('2026-09-01', 'cogs', 'all', 'PLN', NULL, NULL, NULL,
  (SELECT (r #>> '{row,updated_at}')::timestamptz FROM res WHERE name = 'tmp'));
INSERT INTO res SELECT 'list', public.admin_revenue_inputs('2026-08-01', '2026-09-01');
INSERT INTO res SELECT 'eco_empty', public.admin_revenue_economics('2026-08-01', '2026-08-01');
INSERT INTO res SELECT 'eco', public.admin_revenue_economics('2026-09-01', '2026-09-01');
SELECT pg_temp.as_user('d2070000-0000-0000-0000-00000000b001');
INSERT INTO res SELECT 'list_b', public.admin_revenue_inputs('2026-08-01', '2026-09-01');
RESET ROLE;

SELECT results_eq(
  $$ SELECT r->>'op', r #>> '{row,currency}', (r #>> '{row,amount_minor}')::bigint FROM res WHERE name IN ('ins', 'upd') ORDER BY name $$,
  $$ VALUES ('insert'::text, 'PLN'::text, 30000::bigint), ('update'::text, 'PLN'::text, 31000::bigint) $$,
  'zapis: wstawienie (waluta wielkimi) i aktualizacja z aktualnym znacznikiem');
SELECT ok((SELECT r->>'op' = 'delete' AND r->'row' = 'null'::jsonb FROM res WHERE name = 'del'),
  'zapis: obie wartości NULL = usunięcie wiersza');
SELECT is(
  (SELECT string_agg((x->>'kind') || ':' || COALESCE(x->>'amount_minor', x->>'ratio'), ',' ORDER BY x->>'kind')
     FROM res, jsonb_array_elements(r -> 'rows') x WHERE name = 'list'),
  'ebitda_margin_pct:0.1000,gross_margin_pct:0.8000,mrr_plan:31000,sales_marketing_cost:20000',
  'odczyt: wiersze najemcy z zakresu (bez usuniętego)');
SELECT is((SELECT jsonb_array_length(r -> 'rows') FROM res WHERE name = 'list_b'), 0,
  'najemcy: admin B nie widzi danych wejściowych A');
SELECT results_eq(
  $$ SELECT payload->>'kind', payload->>'op' FROM public.domain_events
      WHERE event_type = 'revenue_input.changed.v1' AND tenant_id = 'd2070000-0000-0000-0000-0000000000a0'
        AND payload->>'kind' IN ('mrr_plan', 'cogs')
      ORDER BY payload->>'kind', payload->>'op' $$,
  $$ VALUES ('cogs'::text, 'delete'::text), ('cogs'::text, 'insert'::text),
            ('mrr_plan'::text, 'insert'::text), ('mrr_plan'::text, 'update'::text) $$,
  'zdarzenie: revenue_input.changed.v1 przy każdym zapisie i usunięciu');
SELECT is_empty(
  $$ SELECT k FROM public.domain_events e, jsonb_object_keys(e.payload) k
      WHERE e.event_type = 'revenue_input.changed.v1' AND e.tenant_id = 'd2070000-0000-0000-0000-0000000000a0'
        AND k NOT IN ('period_month', 'kind', 'segment', 'op') $$,
  'zdarzenie: payload bez kwot i notatki');

-- ── 4. Ekonomika ─────────────────────────────────────────────────────────────
SELECT set_eq($$ SELECT jsonb_object_keys(r) FROM res WHERE name = 'eco' $$,
  ARRAY['from_month', 'to_month', 'time_zone', 'months', 'missing', 'rule_of_40'],
  'ekonomika: kształt (ECONOMICS_KEYS.root)');
SELECT ok(
  (SELECT m->'cac_minor' = 'null'::jsonb AND m->'ltv_minor' = 'null'::jsonb AND m->'gross_margin' = 'null'::jsonb
          AND m->'plan_attainment' = 'null'::jsonb
          AND (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(m -> 'missing') x)
              = ARRAY['ebitda_margin_pct', 'gross_margin_pct', 'mrr_plan', 'new_customers_plan', 'sales_marketing_cost']
     FROM res, jsonb_array_elements(r -> 'months') m WHERE name = 'eco_empty' AND m->>'currency' = 'PLN'),
  'ekonomika bez wsadu: wskaźniki NULL i pełne missing[] (bez zgadywania)');
SELECT results_eq(
  $$ SELECT (m->>'mrr_end_minor')::bigint, (m->>'customers_end')::int, (m->>'arpa_minor')::bigint,
            (m->>'new_customers')::int, (m->>'logo_churn_rate')::numeric
       FROM res, jsonb_array_elements(r -> 'months') m WHERE name = 'eco' AND m->>'currency' = 'PLN' $$,
  $$ VALUES (7800::bigint, 2, 3900::bigint, 1, 0.5::numeric) $$,
  'ekonomika: MRR, klienci, ARPA, nowi i churn logo z księgi (miesiąc lokalny)');
SELECT results_eq(
  $$ SELECT (m->>'cac_minor')::bigint, (m->>'ltv_minor')::bigint, (m->>'ltv_cac_ratio')::numeric,
            (m->>'cac_payback_months')::numeric, (m->>'plan_attainment')::numeric
       FROM res, jsonb_array_elements(r -> 'months') m WHERE name = 'eco' AND m->>'currency' = 'PLN' $$,
  $$ VALUES (20000::bigint, 6240::bigint, 0.312::numeric, 6.41::numeric, 0.2516::numeric) $$,
  'ekonomika: CAC, LTV = ARPA × marża / churn, LTV:CAC, okres zwrotu, realizacja planu');
SELECT ok(
  (SELECT (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(m -> 'missing') x) = ARRAY['new_customers_plan']
     FROM res, jsonb_array_elements(r -> 'months') m WHERE name = 'eco' AND m->>'currency' = 'PLN')
  AND (SELECT r->'rule_of_40' = 'null'::jsonb FROM res WHERE name = 'eco'),
  'ekonomika: missing[] = tylko brakujący wsad; Rule of 40 bez historii sprzed roku = NULL');

SELECT * FROM finish();
ROLLBACK;
