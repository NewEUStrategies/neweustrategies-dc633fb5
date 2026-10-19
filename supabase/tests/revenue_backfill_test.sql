-- pgTAP: backfill księgi - środowisko dokumentów i saldo otwarcia MRR
-- (S2, migracja 20261020110200).
--
-- CO PRZYPINA:
--   * idempotencja: blok backfillu uruchomiony DWA RAZY daje ten sam stan
--     (ruchy, środowiska dokumentów);
--   * saldo otwarcia: tylko subskrypcje `live` w stanie płatnym bez żadnego
--     ruchu - `new`, `reason = 'backfill'`, `backfilled = true`, bez historii,
--     w chwili wdrożenia; kwota z migawki operatora albo (D-05) z katalogu;
--     pauza, anulowana, sandbox, cena spoza katalogu - bez ruchu;
--     subskrypcja z ruchem z triggera - bez drugiego ruchu;
--   * środowisko dokumentu: z zamówienia, bez zamówienia - z subskrypcji
--     operatora przez uprawnienie (`external_ref`); bez źródła NULL
--     (= nieznane), wartość już ustawiona bez zmian;
--   * po backfillu trigger liczy „przed" z salda otwarcia (zmiana planu =
--     `contraction`, nie nowy klient); dwóch najemców.
--
-- Blok między znacznikami `backfill:` jest kopią 1:1 z migracji - zgodność
-- pilnuje src/lib/revenue/finance/__tests__/backfillParity.test.ts.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test revenue_backfill
BEGIN;
SELECT plan(14);

-- ── Fixture: subskrypcje sprzed huba (trigger księgi wyłączony) ─────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO public.tenants (id, slug, name) VALUES
  ('d2030000-0000-0000-0000-0000000000a0', 'hub-s2-bf-a', 'Hub S2 backfill A'),
  ('d2030000-0000-0000-0000-0000000000b0', 'hub-s2-bf-b', 'Hub S2 backfill B');
INSERT INTO auth.users (id, email)
SELECT ('d2030000-0000-0000-0000-00000000a10' || n)::uuid, 'c' || n || '@hub-s2-bf.test'
  FROM generate_series(1, 8) n;
INSERT INTO auth.users (id, email) VALUES ('d2030000-0000-0000-0000-00000000b101', 'b1@hub-s2-bf.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id)
SELECT ('d2030000-0000-0000-0000-00000000a10' || n)::uuid, 'c' || n || '@hub-s2-bf.test', 'C' || n,
       'd2030000-0000-0000-0000-0000000000a0'
  FROM generate_series(1, 8) n;
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d2030000-0000-0000-0000-00000000b101', 'b1@hub-s2-bf.test', 'B1', 'd2030000-0000-0000-0000-0000000000b0');

ALTER TABLE public.subscriptions DISABLE TRIGGER trg_subscriptions_revenue_history;
INSERT INTO public.subscriptions (id, tenant_id, user_id, provider_subscription_id, provider_customer_id,
  product_id, price_id, status, environment, unit_amount_minor, currency, pause_collection_behavior) VALUES
  -- a1: płatny, migawka 59 zł; a2: płatny bez migawki (katalog 119 zł);
  -- a3: pauza poboru; a4: anulowana; a5: sandbox; a6: cena spoza katalogu;
  -- a7: ma już ruch; a8: zaległość (wciąż klient); b1: najemca B.
  ('d2030000-0000-0000-0000-0000000005a1', 'd2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-00000000a101', 'sub_bf_a1', 'cus_bf_a1', 'plan_plus', 'plus_monthly', 'active', 'live', 5900, 'PLN', NULL),
  ('d2030000-0000-0000-0000-0000000005a2', 'd2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-00000000a102', 'sub_bf_a2', 'cus_bf_a2', 'plan_pro', 'pro_monthly', 'active', 'live', NULL, NULL, NULL),
  ('d2030000-0000-0000-0000-0000000005a3', 'd2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-00000000a103', 'sub_bf_a3', 'cus_bf_a3', 'plan_plus', 'plus_monthly', 'active', 'live', 3900, 'PLN', 'void'),
  ('d2030000-0000-0000-0000-0000000005a4', 'd2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-00000000a104', 'sub_bf_a4', 'cus_bf_a4', 'plan_plus', 'plus_monthly', 'canceled', 'live', 3900, 'PLN', NULL),
  ('d2030000-0000-0000-0000-0000000005a5', 'd2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-00000000a105', 'sub_bf_a5', 'cus_bf_a5', 'plan_plus', 'plus_monthly', 'active', 'sandbox', 3900, 'PLN', NULL),
  ('d2030000-0000-0000-0000-0000000005a6', 'd2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-00000000a106', 'sub_bf_a6', 'cus_bf_a6', 'plan_x', 'cena_spoza_katalogu', 'active', 'live', 3900, 'PLN', NULL),
  ('d2030000-0000-0000-0000-0000000005a7', 'd2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-00000000a107', 'sub_bf_a7', 'cus_bf_a7', 'plan_plus', 'plus_monthly', 'active', 'live', 3900, 'PLN', NULL),
  ('d2030000-0000-0000-0000-0000000005a8', 'd2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-00000000a108', 'sub_bf_a8', 'cus_bf_a8', 'plan_plus', 'plus_monthly', 'past_due', 'live', 3900, 'PLN', NULL),
  ('d2030000-0000-0000-0000-0000000005b1', 'd2030000-0000-0000-0000-0000000000b0', 'd2030000-0000-0000-0000-00000000b101', 'sub_bf_b1', 'cus_bf_b1', 'plan_plus', 'plus_monthly', 'active', 'live', 4900, 'EUR', NULL);
ALTER TABLE public.subscriptions ENABLE TRIGGER trg_subscriptions_revenue_history;
INSERT INTO public.mrr_movements (tenant_id, subscription_id, user_id, environment, occurred_at, kind, reason,
  mrr_before_minor, mrr_after_minor, currency, segment)
VALUES ('d2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-0000000005a7',
        'd2030000-0000-0000-0000-00000000a107', 'live', now() - interval '1 day', 'new', 'signup', 0, 3900, 'PLN',
        'b2c_individual');

-- Dokumenty: d1 zamówienie live, d2 zamówienie sandbox, d3 uprawnienie ->
-- subskrypcja live, d4 bez powiązań, d5 środowisko już ustawione.
-- Opłacone zamówienie zakłada wyłącznie serwer (strażnik `payment_orders`).
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.payment_orders (id, tenant_id, user_id, kind, amount_cents, currency, environment, status) VALUES
  ('d2030000-0000-0000-0000-0000000008a1', 'd2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-00000000a101', 'subscription', 5900, 'PLN', 'live', 'paid'),
  ('d2030000-0000-0000-0000-0000000008a2', 'd2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-00000000a101', 'one_time', 900, 'PLN', 'sandbox', 'paid');
SELECT set_config('request.jwt.claim.role', '', true);
INSERT INTO public.user_subscriptions (id, tenant_id, user_id, plan_id, status, external_ref)
SELECT 'd2030000-0000-0000-0000-0000000006a2', 'd2030000-0000-0000-0000-0000000000a0',
       'd2030000-0000-0000-0000-00000000a102', p.id, 'active', 'sub_bf_a2'
  FROM public.access_plans p
 WHERE p.tenant_id = 'd2030000-0000-0000-0000-0000000000a0' AND p.tier_key = 'pro' AND p.interval = 'month'
 LIMIT 1;
INSERT INTO public.billing_documents (id, tenant_id, user_id, subscription_id, order_id, kind, status, provider,
  provider_document_id, amount_cents, currency, environment) VALUES
  ('d2030000-0000-0000-0000-0000000007a1', 'd2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-00000000a101', NULL, 'd2030000-0000-0000-0000-0000000008a1', 'invoice', 'paid', 'stripe', 'in_bf_1', 5900, 'PLN', NULL),
  ('d2030000-0000-0000-0000-0000000007a2', 'd2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-00000000a101', NULL, 'd2030000-0000-0000-0000-0000000008a2', 'receipt', 'paid', 'stripe', 'in_bf_2', 900, 'PLN', NULL),
  ('d2030000-0000-0000-0000-0000000007a3', 'd2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-00000000a102', 'd2030000-0000-0000-0000-0000000006a2', NULL, 'invoice', 'paid', 'stripe', 'in_bf_3', 11900, 'PLN', NULL),
  ('d2030000-0000-0000-0000-0000000007a4', 'd2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-00000000a102', NULL, NULL, 'invoice', 'paid', 'stripe', 'in_bf_4', 11900, 'PLN', NULL),
  ('d2030000-0000-0000-0000-0000000007a5', 'd2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-00000000a102', NULL, 'd2030000-0000-0000-0000-0000000008a1', 'invoice', 'paid', 'stripe', 'in_bf_5', 11900, 'PLN', 'sandbox');

-- ── Pierwsze uruchomienie ────────────────────────────────────────────────────
-- backfill:begin
-- ----------------------------------------------------------------------------
-- A) Środowisko dokumentów - porcjami po `id`.
-- ----------------------------------------------------------------------------
DO $backfill_env$
DECLARE
  v_after uuid := '00000000-0000-0000-0000-000000000000';
  v_last uuid;
BEGIN
  LOOP
    -- `uuid` nie ma agregatu `max` - ostatni identyfikator porcji wprost.
    SELECT b.id INTO v_last
      FROM (SELECT d.id FROM public.billing_documents d
             WHERE d.id > v_after AND d.environment IS NULL
             ORDER BY d.id LIMIT 1000) b
     ORDER BY b.id DESC
     LIMIT 1;
    EXIT WHEN v_last IS NULL;
    UPDATE public.billing_documents d
       SET environment = src.environment
      FROM (
        SELECT d2.id,
               COALESCE(
                 CASE WHEN o.environment IN ('sandbox', 'live') THEN o.environment END,
                 CASE WHEN s.environment IN ('sandbox', 'live') THEN s.environment END
               ) AS environment
          FROM public.billing_documents d2
          LEFT JOIN public.payment_orders o ON o.id = d2.order_id
          LEFT JOIN public.user_subscriptions us ON us.id = d2.subscription_id
          LEFT JOIN public.subscriptions s ON s.provider_subscription_id = us.external_ref
         WHERE d2.id > v_after AND d2.id <= v_last AND d2.environment IS NULL
      ) src
     WHERE d.id = src.id AND src.environment IS NOT NULL;
    v_after := v_last;
  END LOOP;
END
$backfill_env$;

-- ----------------------------------------------------------------------------
-- B) Saldo otwarcia MRR (tylko produkcja, tylko bez ruchów).
-- ----------------------------------------------------------------------------
INSERT INTO public.mrr_movements (
  tenant_id, history_id, subscription_id, user_id, environment, occurred_at,
  kind, reason, mrr_before_minor, mrr_after_minor, currency,
  tier_key_before, tier_key_after, interval_before, interval_after, segment, backfilled)
SELECT s.tenant_id, NULL, s.id, s.user_id, s.environment, now(),
       'new', 'backfill', 0, q.mrr_minor, q.currency,
       NULL, q.tier_key, NULL, q.billing_interval,
       public.revenue_segment_of_tier(q.tier_key), true
  FROM public.subscriptions s
  CROSS JOIN LATERAL public.subscription_mrr_minor(
    s.tenant_id, s.price_id, s.quantity, s.unit_amount_minor, s.currency,
    s.discount_minor_per_period, s.discount_ends_at, now()) q
 WHERE s.environment = 'live'
   AND s.status IN ('active', 'past_due')
   AND s.status <> 'paused'
   AND s.pause_collection_behavior IS NULL
   AND q.mrr_minor IS NOT NULL
   AND q.mrr_minor > 0
   AND q.currency ~ '^[A-Z]{3}$'
   AND NOT EXISTS (
     SELECT 1 FROM public.mrr_movements m
      WHERE m.subscription_id = s.id AND m.environment = s.environment);
-- backfill:end

CREATE TEMP TABLE after_first ON COMMIT DROP AS
  SELECT subscription_id, kind, reason, delta_minor, currency, backfilled, history_id, occurred_at
    FROM public.mrr_movements
   WHERE tenant_id IN ('d2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-0000000000b0');
CREATE TEMP TABLE docs_first ON COMMIT DROP AS
  SELECT id, environment FROM public.billing_documents
   WHERE tenant_id = 'd2030000-0000-0000-0000-0000000000a0';

SELECT results_eq(
  $$ SELECT subscription_id::text, kind, reason, delta_minor, currency, backfilled, history_id IS NULL
       FROM after_first WHERE backfilled ORDER BY subscription_id $$,
  $$ VALUES ('d2030000-0000-0000-0000-0000000005a1', 'new'::text, 'backfill'::text, 5900, 'PLN'::text, true, true),
            ('d2030000-0000-0000-0000-0000000005a2', 'new'::text, 'backfill'::text, 11900, 'PLN'::text, true, true),
            ('d2030000-0000-0000-0000-0000000005a8', 'new'::text, 'backfill'::text, 3900, 'PLN'::text, true, true),
            ('d2030000-0000-0000-0000-0000000005b1', 'new'::text, 'backfill'::text, 4900, 'EUR'::text, true, true) $$,
  'saldo otwarcia: płatne live bez ruchów (migawka albo katalog), zaległość też; najemca B osobno');
SELECT ok((SELECT bool_and(occurred_at = now()) FROM after_first WHERE backfilled),
  'saldo otwarcia: w chwili wdrożenia (księga zaczyna się od data_since, bez udawania sprzedaży wstecz)');
SELECT is_empty(
  $$ SELECT 1 FROM after_first WHERE subscription_id IN ('d2030000-0000-0000-0000-0000000005a3',
       'd2030000-0000-0000-0000-0000000005a4', 'd2030000-0000-0000-0000-0000000005a5',
       'd2030000-0000-0000-0000-0000000005a6') $$,
  'saldo otwarcia: pauza, anulowana, sandbox i cena spoza katalogu - bez ruchu');
SELECT is((SELECT count(*)::integer FROM after_first WHERE subscription_id = 'd2030000-0000-0000-0000-0000000005a7'), 1,
  'saldo otwarcia: subskrypcja z ruchem z triggera nie dostaje drugiego');
SELECT is((SELECT environment FROM docs_first WHERE id = 'd2030000-0000-0000-0000-0000000007a1'), 'live',
  'środowisko dokumentu: z zamówienia (live)');
SELECT is((SELECT environment FROM docs_first WHERE id = 'd2030000-0000-0000-0000-0000000007a2'), 'sandbox',
  'środowisko dokumentu: z zamówienia (sandbox)');
SELECT is((SELECT environment FROM docs_first WHERE id = 'd2030000-0000-0000-0000-0000000007a3'), 'live',
  'środowisko dokumentu: bez zamówienia - z subskrypcji operatora przez uprawnienie');
SELECT ok((SELECT environment IS NULL FROM docs_first WHERE id = 'd2030000-0000-0000-0000-0000000007a4'),
  'środowisko dokumentu: bez źródła zostaje NULL (nieznane, nie zgadywane live)');
SELECT is((SELECT environment FROM docs_first WHERE id = 'd2030000-0000-0000-0000-0000000007a5'), 'sandbox',
  'środowisko dokumentu: wartość już ustawiona bez zmian');

-- ── Drugie uruchomienie = ten sam stan ──────────────────────────────────────
-- backfill:begin
-- ----------------------------------------------------------------------------
-- A) Środowisko dokumentów - porcjami po `id`.
-- ----------------------------------------------------------------------------
DO $backfill_env$
DECLARE
  v_after uuid := '00000000-0000-0000-0000-000000000000';
  v_last uuid;
BEGIN
  LOOP
    -- `uuid` nie ma agregatu `max` - ostatni identyfikator porcji wprost.
    SELECT b.id INTO v_last
      FROM (SELECT d.id FROM public.billing_documents d
             WHERE d.id > v_after AND d.environment IS NULL
             ORDER BY d.id LIMIT 1000) b
     ORDER BY b.id DESC
     LIMIT 1;
    EXIT WHEN v_last IS NULL;
    UPDATE public.billing_documents d
       SET environment = src.environment
      FROM (
        SELECT d2.id,
               COALESCE(
                 CASE WHEN o.environment IN ('sandbox', 'live') THEN o.environment END,
                 CASE WHEN s.environment IN ('sandbox', 'live') THEN s.environment END
               ) AS environment
          FROM public.billing_documents d2
          LEFT JOIN public.payment_orders o ON o.id = d2.order_id
          LEFT JOIN public.user_subscriptions us ON us.id = d2.subscription_id
          LEFT JOIN public.subscriptions s ON s.provider_subscription_id = us.external_ref
         WHERE d2.id > v_after AND d2.id <= v_last AND d2.environment IS NULL
      ) src
     WHERE d.id = src.id AND src.environment IS NOT NULL;
    v_after := v_last;
  END LOOP;
END
$backfill_env$;

-- ----------------------------------------------------------------------------
-- B) Saldo otwarcia MRR (tylko produkcja, tylko bez ruchów).
-- ----------------------------------------------------------------------------
INSERT INTO public.mrr_movements (
  tenant_id, history_id, subscription_id, user_id, environment, occurred_at,
  kind, reason, mrr_before_minor, mrr_after_minor, currency,
  tier_key_before, tier_key_after, interval_before, interval_after, segment, backfilled)
SELECT s.tenant_id, NULL, s.id, s.user_id, s.environment, now(),
       'new', 'backfill', 0, q.mrr_minor, q.currency,
       NULL, q.tier_key, NULL, q.billing_interval,
       public.revenue_segment_of_tier(q.tier_key), true
  FROM public.subscriptions s
  CROSS JOIN LATERAL public.subscription_mrr_minor(
    s.tenant_id, s.price_id, s.quantity, s.unit_amount_minor, s.currency,
    s.discount_minor_per_period, s.discount_ends_at, now()) q
 WHERE s.environment = 'live'
   AND s.status IN ('active', 'past_due')
   AND s.status <> 'paused'
   AND s.pause_collection_behavior IS NULL
   AND q.mrr_minor IS NOT NULL
   AND q.mrr_minor > 0
   AND q.currency ~ '^[A-Z]{3}$'
   AND NOT EXISTS (
     SELECT 1 FROM public.mrr_movements m
      WHERE m.subscription_id = s.id AND m.environment = s.environment);
-- backfill:end

SELECT set_eq(
  $$ SELECT subscription_id, kind, reason, delta_minor, currency, backfilled FROM public.mrr_movements
      WHERE tenant_id IN ('d2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-0000000000b0') $$,
  $$ SELECT subscription_id, kind, reason, delta_minor, currency, backfilled FROM after_first $$,
  'idempotencja: drugie uruchomienie nie zmienia ruchów');
SELECT is(
  (SELECT count(*)::integer FROM public.mrr_movements
    WHERE tenant_id IN ('d2030000-0000-0000-0000-0000000000a0', 'd2030000-0000-0000-0000-0000000000b0')),
  (SELECT count(*)::integer FROM after_first),
  'idempotencja: ta sama liczba ruchów (2× = to samo)');
SELECT set_eq(
  $$ SELECT id, environment FROM public.billing_documents WHERE tenant_id = 'd2030000-0000-0000-0000-0000000000a0' $$,
  $$ SELECT id, environment FROM docs_first $$,
  'idempotencja: środowiska dokumentów bez zmian');

-- ── Trigger po backfillu liczy od salda otwarcia ───────────────────────────
UPDATE public.subscriptions SET price_id = 'plus_annual', unit_amount_minor = 59000, last_event_id = 'evt_bf_1'
 WHERE id = 'd2030000-0000-0000-0000-0000000005a1';
SELECT is(
  (SELECT kind || ':' || reason || ':' || delta_minor FROM public.mrr_movements
    WHERE subscription_id = 'd2030000-0000-0000-0000-0000000005a1' AND NOT backfilled),
  'contraction:plan_change:-983',
  'po backfillu: zmiana planu liczona od salda otwarcia (59 zł -> 590/12 zł = contraction)');
SELECT is(
  (SELECT mrr_before_minor FROM public.subscription_state_history
    WHERE subscription_id = 'd2030000-0000-0000-0000-0000000005a1'),
  5900,
  'po backfillu: historia ma MRR przed = saldo otwarcia');

SELECT * FROM finish();
ROLLBACK;
