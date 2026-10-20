-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S2, 5/8): AGREGATY PRZYCHODU DLA HUBA, PULPITU I BI -
-- MIGAWKA SEMANTYCZNA, MOST MRR, SZEREG MRR, CHURN, KOHORTY, WINDYKACJA,
-- PRZYCHÓD ZREALIZOWANY.
--
-- DEFEKT
--   1. `monetization_dashboard` miesza waluty i środowiska (P10), a KPI
--      `/admin/billing` liczy przeglądarka z próbki 500 wierszy bez najemcy
--      w kluczu (brief 04 D8) - trzy ekrany, trzy różne „aktywne subskrypcje".
--   2. Hub, BI i pulpit nie mają jednej definicji wskaźników finansowych
--      (AD-19): MRR, ARR, ARPA, NRR, GRR, churn, quick ratio, windykacja,
--      przychód zrealizowany liczyłby każdy ekran po swojemu.
--
-- ZMIANA - siedem RPC panelu, WYŁĄCZNIE admin (`has_role(admin)` w najemcy
-- z sesji, inaczej 42501; editor dostaje kwoty `NULL` w RPC lejka, tu nie ma
-- nic poza kwotami), najemca z `current_tenant_id()`, okno `[p_since,
-- p_until)` nie dłuższe niż 400 dni (22023 `window_invalid`). Liczby tylko
-- z `live`; kwoty WYŁĄCZNIE per waluta (`[{currency, amount_minor}]`, nigdy
-- suma walut); `null` = nie da się policzyć (brak mianownika, okno przed
-- początkiem księgi), `[]` = zmierzone zero.
--   A. `admin_revenue_semantic_snapshot(p_since, p_until)` - kontrakt
--      `REVENUE_SNAPSHOT_KEYS` (S6, src/lib/analytics/semantic/revenueRaw.ts,
--      `-- rpc-shape`). Ilorazy (ułamki 0-1, NRR, quick ratio, wzrost) liczone
--      w JEDNEJ walucie - wiodącej (największe MRR na końcu okna) - bo iloraz
--      dwóch walut nie istnieje. NRR/GRR kohortowo: subskrypcje z saldem na
--      początku okna, ich saldo na końcu (bez nowych). `average_discount`
--      i `price_realization` tylko dla okna kończącego się „teraz" (rabat
--      i cena katalogu nie mają historii).
--   B. `admin_revenue_mrr_bridge(p_since, p_until, p_segment)` - most per
--      waluta: start + otwarcie (backfill) + new + expansion + reactivation +
--      contraction + churn = koniec (z konstrukcji, dowód w pgTAP) + udział
--      podstawy kwot (`basis_mix`, D-05 - adnotacja źródła kwoty w panelu).
--   C. `admin_revenue_mrr_series(p_since, p_until, p_grain, p_time_zone)` -
--      MRR na koniec każdego kubełka (dzień/tydzień/miesiąc w strefie
--      najemcy, domyślnie Europe/Warsaw - granice LOKALNE, AGENTS) + MRR
--      z migawki dziennej (drugi pomiar; dryf = różnica).
--   D. `admin_revenue_churn(p_since, p_until)` - churn logo i przychodowy,
--      NRR/GRR per waluta, udział odejść za brak płatności, powody odejść.
--   E. `admin_revenue_cohorts(p_from_month, p_to_month)` - retencja logo
--      kohort miesięcznych (pierwszy płatny ruch, bez salda otwarcia),
--      przesunięcia 0-12, maks. 24 kohorty.
--   F. `admin_revenue_dunning(p_since, p_until)` - cykle windykacji: rozpoczęte,
--      odzyskane, utracone, otwarte, skuteczność, mediana dni do odzyskania,
--      MRR zagrożone/odzyskane/utracone per waluta.
--   G. `admin_revenue_realized(p_since, p_until)` - przychód zrealizowany
--      z dokumentów per kategoria i waluta + zamówienia opłacone (drugie
--      źródło do uzgodnienia) + liczba dokumentów o nieznanym środowisku.
--      TEN SAM RPC czytają pulpit, hub i BI.
--   Kształty pozostałych RPC: stałe `*_KEYS` w src/lib/revenue/finance/parse.ts
--   (`-- rpc-shape`), przypięte `set_eq(jsonb_object_keys(...))` w pgTAP.
--
-- KOLEJNOŚĆ WDROŻENIA: po 110300. Nowe funkcje tylko do odczytu; server fns
-- S2 wołają je literałem przez `RpcCallable` (do czasu sygnatur w `types.ts`,
-- N19) i traktują brak funkcji (PGRST202/42883) jako stan „brak danych".
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowe nazwy - bez CIALO-Z),
-- bezstanowe REVOKE/GRANT. Zero DDL.
-- DOWÓD: supabase/tests/revenue_aggregates_test.sql (2 najemców, editor 42501,
-- sandbox bez wpływu, start + Σ = koniec, migawka = suma ruchów, null dla
-- braku danych, waluty rozdzielne, kształt jsonb).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Migawka semantyczna (kontrakt S6).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_semantic_snapshot(
  p_since timestamptz,
  p_until timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_data_since timestamptz;
  v_has_live boolean;
  v_known boolean;
  v_lead text;
  v_end jsonb;
  v_start jsonb;
  v_mv jsonb;
  v_counts record;
  v_rates jsonb;
  v_mix jsonb;
  v_real jsonb;
  v_orders jsonb;
  v_now_window boolean := p_until >= now() - interval '1 day';
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until <= p_since
     OR p_until - p_since > interval '400 days' THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT min(m.occurred_at) INTO v_data_since
    FROM public.mrr_movements m WHERE m.tenant_id = v_tenant AND m.environment = 'live';
  v_has_live := EXISTS (SELECT 1 FROM public.subscriptions s
                         WHERE s.tenant_id = v_tenant AND s.environment = 'live');
  -- Księga zna okno, gdy zaczęła się przed jego końcem; najemca bez żadnej
  -- subskrypcji produkcyjnej ma zmierzone zero, a nie „brak danych".
  v_known := (v_data_since IS NOT NULL AND v_data_since < p_until) OR NOT v_has_live;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', e.currency, 'amount_minor', e.mrr_minor,
                    'customers', e.active_customers, 'subscriptions', e.active_subscriptions,
                    'seats', e.seats) ORDER BY e.mrr_minor DESC, e.currency), '[]'::jsonb)
    INTO v_end FROM public._revenue_mrr_at(v_tenant, p_until) e;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', x.currency, 'amount_minor', x.amount)
                    ORDER BY x.currency), '[]'::jsonb)
    INTO v_start
    FROM (
      SELECT c.currency, sum(c.amount)::bigint AS amount
        FROM (SELECT s.currency, s.mrr_minor AS amount FROM public._revenue_mrr_at(v_tenant, p_since) s
              UNION ALL
              SELECT mv.currency, mv.amount_minor FROM public._revenue_movements(v_tenant, p_since, p_until) mv
               WHERE mv.kind = 'opening') c
       GROUP BY c.currency
    ) x;
  SELECT COALESCE(jsonb_object_agg(k.kind, k.amounts), '{}'::jsonb) INTO v_mv
    FROM (
      SELECT mv.kind, jsonb_agg(jsonb_build_object('currency', mv.currency, 'amount_minor', mv.amount_minor)
                                ORDER BY mv.currency) AS amounts
        FROM public._revenue_movements(v_tenant, p_since, p_until) mv
       WHERE mv.kind <> 'opening'
       GROUP BY mv.kind
    ) k;
  v_lead := (SELECT e->>'currency' FROM jsonb_array_elements(v_end) e LIMIT 1);
  IF v_lead IS NULL THEN
    v_lead := (SELECT s->>'currency' FROM jsonb_array_elements(v_start) s
                ORDER BY (s->>'amount_minor')::bigint DESC LIMIT 1);
  END IF;

  -- Saldo każdej subskrypcji na początku i na końcu okna (wszystkie waluty).
  WITH b AS (
    SELECT m.subscription_id, m.currency,
           COALESCE(sum(m.delta_minor) FILTER (WHERE m.occurred_at < p_since
                    OR (m.backfilled AND m.occurred_at < p_until)), 0) AS s_amt,
           COALESCE(sum(m.delta_minor) FILTER (WHERE m.occurred_at < p_until), 0) AS e_amt,
           (array_agg(COALESCE(m.user_id::text, 'sub:' || m.subscription_id::text)
                      ORDER BY m.occurred_at DESC, m.id DESC))[1] AS customer
      FROM public.mrr_movements m
     WHERE m.tenant_id = v_tenant AND m.environment = 'live' AND m.occurred_at < p_until
     GROUP BY m.subscription_id, m.currency
  ), cust AS (
    SELECT customer, bool_or(s_amt > 0) AS at_start, bool_or(e_amt > 0) AS at_end FROM b GROUP BY customer
  )
  SELECT
    (SELECT count(*) FROM cust WHERE at_start)::integer AS customers_start,
    (SELECT count(*) FROM cust WHERE at_start AND NOT at_end)::integer AS customers_churned,
    (SELECT sum(s_amt) FROM b WHERE currency = v_lead AND s_amt > 0) AS nrr_s,
    (SELECT sum(e_amt) FROM b WHERE currency = v_lead AND s_amt > 0) AS nrr_e,
    (SELECT sum(LEAST(e_amt, s_amt)) FROM b WHERE currency = v_lead AND s_amt > 0) AS grr_g
    INTO v_counts FROM (SELECT 1) one;

  WITH mv AS (
    SELECT * FROM public._revenue_movements(v_tenant, p_since, p_until) WHERE currency = v_lead
  ), sums AS (
    SELECT COALESCE(sum(amount_minor) FILTER (WHERE kind = 'new'), 0) AS n,
           COALESCE(sum(amount_minor) FILTER (WHERE kind = 'expansion'), 0) AS ex,
           COALESCE(sum(amount_minor) FILTER (WHERE kind = 'reactivation'), 0) AS re,
           COALESCE(sum(amount_minor) FILTER (WHERE kind = 'contraction'), 0) AS co,
           COALESCE(sum(amount_minor) FILTER (WHERE kind = 'churn'), 0) AS ch
      FROM mv
  ), lead_amounts AS (
    SELECT (SELECT (s->>'amount_minor')::numeric FROM jsonb_array_elements(v_start) s WHERE s->>'currency' = v_lead) AS st,
           (SELECT (e->>'amount_minor')::numeric FROM jsonb_array_elements(v_end) e WHERE e->>'currency' = v_lead) AS en
  ), churn_mv AS (
    SELECT m.reason, m.kind, m.subscription_id, m.user_id, m.occurred_at
      FROM public.mrr_movements m
     WHERE m.tenant_id = v_tenant AND m.environment = 'live' AND NOT m.backfilled
       AND m.occurred_at >= p_since AND m.occurred_at < p_until
  ), dun AS (
    SELECT count(*) FILTER (WHERE d.recovered_at >= p_since AND d.recovered_at < p_until) AS rec,
           count(*) FILTER (WHERE d.lost_at >= p_since AND d.lost_at < p_until) AS lost
      FROM public.dunning_cycles d WHERE d.tenant_id = v_tenant AND d.environment = 'live'
  ), winback AS (
    SELECT count(DISTINCT c.subscription_id) AS churned,
           count(DISTINCT c.subscription_id) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.mrr_movements r
              WHERE r.tenant_id = v_tenant AND r.environment = 'live' AND r.kind = 'reactivation'
                AND r.occurred_at > c.occurred_at AND r.occurred_at < p_until
                AND (r.subscription_id = c.subscription_id OR r.user_id = c.user_id))) AS won
      FROM public.mrr_movements c
     WHERE c.tenant_id = v_tenant AND c.environment = 'live' AND c.kind = 'churn'
       AND c.reason <> 'currency_switch'
       AND c.occurred_at >= p_until - interval '12 months' AND c.occurred_at < p_until
  ), firsts AS (
    SELECT DISTINCT ON (m.subscription_id) m.subscription_id, m.kind, m.backfilled, m.occurred_at
      FROM public.mrr_movements m
     WHERE m.tenant_id = v_tenant AND m.environment = 'live' AND m.occurred_at < p_until
     ORDER BY m.subscription_id, m.occurred_at, m.id
  ), cohort AS (
    SELECT o.n_off,
           count(*) AS size,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.mrr_movements x
              WHERE x.subscription_id = f.subscription_id AND x.environment = 'live' AND x.occurred_at < p_until
              GROUP BY x.currency HAVING sum(x.delta_minor) > 0)) AS kept
      FROM (VALUES (1), (3), (12)) o(n_off)
      JOIN firsts f ON f.kind = 'new' AND NOT f.backfilled
       AND f.occurred_at >= date_trunc('month', p_until - interval '1 microsecond') - make_interval(months => o.n_off)
       AND f.occurred_at < date_trunc('month', p_until - interval '1 microsecond') - make_interval(months => o.n_off - 1)
     GROUP BY o.n_off
  ), trials AS (
    SELECT count(*) AS ended,
           count(*) FILTER (WHERE h.status_after IN ('active', 'past_due')) AS converted
      FROM public.subscription_state_history h
     WHERE h.tenant_id = v_tenant AND h.environment = 'live' AND h.status_before = 'trialing'
       AND h.status_after <> 'trialing' AND h.occurred_at >= p_since AND h.occurred_at < p_until
  ), active_subs AS (
    SELECT DISTINCT ON (m.subscription_id) m.subscription_id, m.interval_after
      FROM public.mrr_movements m
     WHERE m.tenant_id = v_tenant AND m.environment = 'live' AND m.occurred_at < p_until
       AND m.subscription_id IN (
         SELECT y.subscription_id FROM public.mrr_movements y
          WHERE y.tenant_id = v_tenant AND y.environment = 'live' AND y.occurred_at < p_until
          GROUP BY y.subscription_id, y.currency HAVING sum(y.delta_minor) > 0)
     ORDER BY m.subscription_id, m.occurred_at DESC, m.id DESC
  ), current_price AS (
    SELECT sum(GREATEST(s.unit_amount_minor::numeric * GREATEST(s.quantity, 1), 0)) AS list_amt,
           sum(CASE WHEN s.discount_minor_per_period > 0
                     AND (s.discount_ends_at IS NULL OR s.discount_ends_at > now())
                    THEN s.discount_minor_per_period ELSE 0 END) AS disc_amt,
           sum(p.mrr_minor) AS provider_mrr,
           sum(c.mrr_minor) AS catalog_mrr
      FROM public.subscriptions s
      CROSS JOIN LATERAL public.subscription_mrr_minor(s.tenant_id, s.price_id, s.quantity,
        s.unit_amount_minor, s.currency, s.discount_minor_per_period, s.discount_ends_at, now()) p
      CROSS JOIN LATERAL public.subscription_mrr_minor(s.tenant_id, s.price_id, s.quantity,
        NULL, NULL, 0, NULL, now()) c
     WHERE s.tenant_id = v_tenant AND s.environment = 'live' AND s.status IN ('active', 'past_due')
       AND s.pause_collection_behavior IS NULL AND s.unit_amount_minor IS NOT NULL
       AND upper(s.currency) = v_lead AND p.basis = 'provider' AND c.basis = 'catalog'
       AND c.currency = v_lead
  )
  SELECT jsonb_build_object(
    'expansion_share_new_mrr', (SELECT CASE WHEN n + ex + re > 0 THEN round(ex::numeric / (n + ex + re), 4) END FROM sums),
    'saas_quick_ratio', (SELECT CASE WHEN co + ch < 0 THEN round((n + ex + re)::numeric / -(co + ch), 4) END FROM sums),
    'mrr_growth_mom', (SELECT CASE WHEN st > 0 THEN round((COALESCE(en, 0) - st) / st, 4) END FROM lead_amounts),
    'gross_revenue_churn', CASE WHEN v_counts.nrr_s > 0 THEN round(1 - v_counts.grr_g::numeric / v_counts.nrr_s, 4) END,
    'gross_revenue_retention', CASE WHEN v_counts.nrr_s > 0 THEN round(v_counts.grr_g::numeric / v_counts.nrr_s, 4) END,
    'net_revenue_retention', CASE WHEN v_counts.nrr_s > 0 THEN round(v_counts.nrr_e::numeric / v_counts.nrr_s, 4) END,
    'involuntary_churn_share', (SELECT CASE WHEN count(*) FILTER (WHERE kind = 'churn' AND reason <> 'currency_switch') > 0
        THEN round(count(*) FILTER (WHERE kind = 'churn' AND reason = 'unpaid')::numeric
                   / count(*) FILTER (WHERE kind = 'churn' AND reason <> 'currency_switch'), 4) END FROM churn_mv),
    'returning_subscriber_share', (SELECT CASE WHEN count(*) FILTER (WHERE kind IN ('new', 'reactivation')) > 0
        THEN round(count(*) FILTER (WHERE kind = 'reactivation')::numeric
                   / count(*) FILTER (WHERE kind IN ('new', 'reactivation')), 4) END FROM churn_mv),
    'dunning_recovery_rate', (SELECT CASE WHEN rec + lost > 0 THEN round(rec::numeric / (rec + lost), 4) END FROM dun),
    'winback_rate_12m', (SELECT CASE WHEN churned > 0 THEN round(won::numeric / churned, 4) END FROM winback),
    'cohort_retention_m1', (SELECT CASE WHEN size > 0 THEN round(kept::numeric / size, 4) END FROM cohort WHERE n_off = 1),
    'cohort_retention_m3', (SELECT CASE WHEN size > 0 THEN round(kept::numeric / size, 4) END FROM cohort WHERE n_off = 3),
    'cohort_retention_m12', (SELECT CASE WHEN size > 0 THEN round(kept::numeric / size, 4) END FROM cohort WHERE n_off = 12),
    'trial_to_paid_rate', (SELECT CASE WHEN ended > 0 THEN round(converted::numeric / ended, 4) END FROM trials),
    'annual_plan_share', (SELECT CASE WHEN count(*) > 0 THEN round(count(*) FILTER (WHERE interval_after = 'year')::numeric / count(*), 4) END FROM active_subs),
    'average_discount', (SELECT CASE WHEN v_now_window AND list_amt > 0 THEN round(LEAST(disc_amt / list_amt, 1), 4) END FROM current_price),
    'price_realization', (SELECT CASE WHEN v_now_window AND catalog_mrr > 0 THEN round(provider_mrr::numeric / catalog_mrr, 4) END FROM current_price)
  ) INTO v_rates;

  -- Podstawa kwot aktywnych subskrypcji: ostatnia historia przed końcem okna,
  -- a dla salda otwarcia bez historii - bieżąca migawka na wierszu.
  WITH act AS (
    SELECT DISTINCT y.subscription_id FROM public.mrr_movements y
     WHERE y.tenant_id = v_tenant AND y.environment = 'live' AND y.occurred_at < p_until
     GROUP BY y.subscription_id, y.currency HAVING sum(y.delta_minor) > 0
  ), basis AS (
    SELECT a.subscription_id,
           COALESCE((SELECT h.mrr_basis FROM public.subscription_state_history h
                      WHERE h.subscription_id = a.subscription_id AND h.occurred_at < p_until
                        AND h.mrr_basis IS NOT NULL
                      ORDER BY h.occurred_at DESC, h.id DESC LIMIT 1),
                    (SELECT CASE WHEN s.unit_amount_minor IS NOT NULL THEN 'provider' ELSE 'catalog' END
                       FROM public.subscriptions s WHERE s.id = a.subscription_id),
                    'catalog') AS b
      FROM act a
  )
  SELECT CASE WHEN count(*) > 0 THEN jsonb_build_object(
           'provider', round(count(*) FILTER (WHERE b = 'provider')::numeric / count(*), 4),
           'catalog', round(count(*) FILTER (WHERE b = 'catalog')::numeric / count(*), 4)) END
    INTO v_mix FROM basis;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', r.currency, 'amount_minor', r.net) ORDER BY r.currency), '[]'::jsonb)
    INTO v_real
    FROM (SELECT currency, sum(net_minor)::bigint AS net
            FROM public._revenue_realized(v_tenant, p_since, p_until) GROUP BY currency) r;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', o.currency, 'amount_minor', o.net) ORDER BY o.currency), '[]'::jsonb)
    INTO v_orders
    FROM (SELECT upper(po.currency) AS currency,
                 sum(po.amount_cents - LEAST(COALESCE(po.refunded_amount_cents, 0), po.amount_cents))::bigint AS net
            FROM public.payment_orders po
           WHERE po.tenant_id = v_tenant AND po.environment = 'live' AND po.provider <> 'mock'
             AND po.status IN ('paid', 'refunded') AND po.paid_at >= p_since AND po.paid_at < p_until
           GROUP BY upper(po.currency)) o;

  RETURN jsonb_build_object(
    'data_since', v_data_since,
    'computed_at', now(),
    'basis_mix', v_mix,
    'mrr', CASE WHEN v_known THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', e->>'currency', 'amount_minor', (e->>'amount_minor')::bigint)), '[]'::jsonb) FROM jsonb_array_elements(v_end) e) END,
    'arr', CASE WHEN v_known THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', e->>'currency', 'amount_minor', (e->>'amount_minor')::bigint * 12)), '[]'::jsonb) FROM jsonb_array_elements(v_end) e) END,
    'arpa', CASE WHEN v_known THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', e->>'currency', 'amount_minor', round((e->>'amount_minor')::numeric / (e->>'customers')::numeric)::bigint)), '[]'::jsonb) FROM jsonb_array_elements(v_end) e WHERE (e->>'customers')::integer > 0) END,
    'arpu', CASE WHEN v_known THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', e->>'currency', 'amount_minor', round((e->>'amount_minor')::numeric / (e->>'seats')::numeric)::bigint)), '[]'::jsonb) FROM jsonb_array_elements(v_end) e WHERE (e->>'seats')::integer > 0) END,
    'net_new_mrr', CASE WHEN v_known THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', x.currency, 'amount_minor', x.amount) ORDER BY x.currency), '[]'::jsonb)
                    FROM (SELECT currency, sum(amount_minor)::bigint AS amount FROM public._revenue_movements(v_tenant, p_since, p_until)
                           WHERE kind <> 'opening' GROUP BY currency) x) END,
    'mrr_start', CASE WHEN v_known THEN v_start END,
    'mrr_end', CASE WHEN v_known THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', e->>'currency', 'amount_minor', (e->>'amount_minor')::bigint)), '[]'::jsonb) FROM jsonb_array_elements(v_end) e) END,
    'revenue_realized', v_real,
    'revenue_realized_orders', v_orders,
    'movements', CASE WHEN v_known THEN jsonb_build_object(
      'new', COALESCE(v_mv->'new', '[]'::jsonb), 'expansion', COALESCE(v_mv->'expansion', '[]'::jsonb),
      'reactivation', COALESCE(v_mv->'reactivation', '[]'::jsonb), 'contraction', COALESCE(v_mv->'contraction', '[]'::jsonb),
      'churn', COALESCE(v_mv->'churn', '[]'::jsonb)) END,
    'active_subscriptions', CASE WHEN v_known THEN (SELECT COALESCE(sum((e->>'subscriptions')::integer), 0) FROM jsonb_array_elements(v_end) e) END,
    'active_customers', CASE WHEN v_known THEN (SELECT COALESCE(sum((e->>'customers')::integer), 0) FROM jsonb_array_elements(v_end) e) END,
    'customers_start', CASE WHEN v_known THEN v_counts.customers_start END,
    'customers_churned', CASE WHEN v_known THEN v_counts.customers_churned END
  ) || CASE WHEN v_known THEN v_rates ELSE (
    SELECT jsonb_object_agg(k, NULL::jsonb) FROM jsonb_object_keys(v_rates) k) END;
END;
$$;

-- ----------------------------------------------------------------------------
-- B) Most MRR.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_mrr_bridge(
  p_since timestamptz,
  p_until timestamptz,
  p_segment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_data_since timestamptz;
  v_rows jsonb;
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until <= p_since
     OR p_until - p_since > interval '400 days' THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_segment IS NOT NULL AND p_segment NOT IN ('all', 'b2c_individual', 'b2c_reduced', 'b2b_institution', 'other') THEN
    RAISE EXCEPTION 'segment_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT min(m.occurred_at) INTO v_data_since
    FROM public.mrr_movements m WHERE m.tenant_id = v_tenant AND m.environment = 'live';

  WITH st AS (
    SELECT currency, mrr_minor FROM public._revenue_mrr_at(v_tenant, p_since, p_segment, p_until)
  ), en AS (
    SELECT * FROM public._revenue_mrr_at(v_tenant, p_until, p_segment, p_until)
  ), mv AS (
    SELECT * FROM public._revenue_movements(v_tenant, p_since, p_until, p_segment)
  ), cur AS (
    SELECT currency FROM st UNION SELECT currency FROM en UNION SELECT currency FROM mv
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'currency', c.currency,
           'start_minor', COALESCE((SELECT mrr_minor FROM st WHERE st.currency = c.currency), 0),
           'opening_minor', COALESCE((SELECT sum(amount_minor) FROM mv WHERE mv.currency = c.currency AND kind = 'opening'), 0),
           'new_minor', COALESCE((SELECT sum(amount_minor) FROM mv WHERE mv.currency = c.currency AND kind = 'new'), 0),
           'expansion_minor', COALESCE((SELECT sum(amount_minor) FROM mv WHERE mv.currency = c.currency AND kind = 'expansion'), 0),
           'reactivation_minor', COALESCE((SELECT sum(amount_minor) FROM mv WHERE mv.currency = c.currency AND kind = 'reactivation'), 0),
           'contraction_minor', COALESCE((SELECT sum(amount_minor) FROM mv WHERE mv.currency = c.currency AND kind = 'contraction'), 0),
           'churn_minor', COALESCE((SELECT sum(amount_minor) FROM mv WHERE mv.currency = c.currency AND kind = 'churn'), 0),
           'net_new_minor', COALESCE((SELECT sum(amount_minor) FROM mv WHERE mv.currency = c.currency AND kind <> 'opening'), 0),
           'end_minor', COALESCE((SELECT mrr_minor FROM en WHERE en.currency = c.currency), 0),
           'active_subscriptions', COALESCE((SELECT active_subscriptions FROM en WHERE en.currency = c.currency), 0),
           'active_customers', COALESCE((SELECT active_customers FROM en WHERE en.currency = c.currency), 0)
         ) ORDER BY COALESCE((SELECT mrr_minor FROM en WHERE en.currency = c.currency), 0) DESC, c.currency), '[]'::jsonb)
    INTO v_rows FROM cur c;

  RETURN jsonb_build_object(
    'since', p_since,
    'until', p_until,
    'segment', COALESCE(p_segment, 'all'),
    'data_since', v_data_since,
    -- D-05: udział kwot z migawki operatora vs z katalogu (adnotacja źródła).
    'basis_mix', (
      SELECT CASE WHEN count(*) > 0 THEN jsonb_build_object(
               'provider', round(avg((x.b = 'provider')::integer), 4),
               'catalog', round(avg((x.b = 'catalog')::integer), 4)) END
        FROM (SELECT COALESCE(
                       (SELECT h.mrr_basis FROM public.subscription_state_history h
                         WHERE h.subscription_id = a.subscription_id AND h.occurred_at < p_until
                           AND h.mrr_basis IS NOT NULL ORDER BY h.occurred_at DESC, h.id DESC LIMIT 1),
                       (SELECT CASE WHEN s.unit_amount_minor IS NOT NULL THEN 'provider' ELSE 'catalog' END
                          FROM public.subscriptions s WHERE s.id = a.subscription_id), 'catalog') AS b
                FROM (SELECT DISTINCT y.subscription_id FROM public.mrr_movements y
                       WHERE y.tenant_id = v_tenant AND y.environment = 'live' AND y.occurred_at < p_until
                       GROUP BY y.subscription_id, y.currency HAVING sum(y.delta_minor) > 0) a) x),
    'currencies', CASE WHEN v_data_since IS NULL AND EXISTS (
        SELECT 1 FROM public.subscriptions s WHERE s.tenant_id = v_tenant AND s.environment = 'live')
      THEN NULL ELSE v_rows END,
    'active_subscriptions', (SELECT COALESCE(sum((r->>'active_subscriptions')::integer), 0) FROM jsonb_array_elements(v_rows) r),
    'active_customers', (SELECT COALESCE(sum((r->>'active_customers')::integer), 0) FROM jsonb_array_elements(v_rows) r));
END;
$$;

-- ----------------------------------------------------------------------------
-- C) Szereg MRR (koniec kubełka) + migawka dzienna.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_mrr_series(
  p_since timestamptz,
  p_until timestamptz,
  p_grain text DEFAULT 'month',
  p_time_zone text DEFAULT 'Europe/Warsaw'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_step interval;
  v_points jsonb;
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until <= p_since
     OR p_until - p_since > interval '400 days' THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;
  v_step := CASE p_grain WHEN 'day' THEN interval '1 day' WHEN 'week' THEN interval '1 week'
                         WHEN 'month' THEN interval '1 month' END;
  -- Ziarno dzienne do 120 dni: 400 punktów × przeliczenie salda to koszt bez
  -- czytelnego wykresu.
  IF v_step IS NULL OR (p_grain = 'day' AND p_until - p_since > interval '120 days') THEN
    RAISE EXCEPTION 'grain_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_time_zone) THEN
    RAISE EXCEPTION 'time_zone_invalid' USING ERRCODE = '22023';
  END IF;

  WITH buckets AS (
    SELECT b AS local_start
      FROM generate_series(date_trunc(p_grain, p_since AT TIME ZONE p_time_zone),
                           (p_until AT TIME ZONE p_time_zone) - interval '1 microsecond', v_step) b
  ), edges AS (
    SELECT local_start,
           GREATEST(local_start AT TIME ZONE p_time_zone, p_since) AS b_start,
           LEAST((local_start + v_step) AT TIME ZONE p_time_zone, p_until) AS b_end
      FROM buckets
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'bucket_start', to_char(e.local_start, 'YYYY-MM-DD'),
           'at', e.b_end,
           'currency', x.currency,
           'mrr_minor', x.mrr_minor,
           'active_subscriptions', x.active_subscriptions,
           'snapshot_mrr_minor', (
             SELECT sum(s.mrr_minor)::bigint FROM public.mrr_daily_snapshots s
              WHERE s.tenant_id = v_tenant AND s.environment = 'live' AND s.currency = x.currency
                AND s.day = ((e.b_end - interval '1 microsecond') AT TIME ZONE 'UTC')::date)
         ) ORDER BY e.local_start, x.currency), '[]'::jsonb)
    INTO v_points
    FROM edges e
    CROSS JOIN LATERAL public._revenue_mrr_at(v_tenant, e.b_end) x;

  RETURN jsonb_build_object('since', p_since, 'until', p_until, 'grain', p_grain,
                            'time_zone', p_time_zone, 'points', v_points);
END;
$$;

-- ----------------------------------------------------------------------------
-- D) Churn i retencja przychodu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_churn(
  p_since timestamptz,
  p_until timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_result jsonb;
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until <= p_since
     OR p_until - p_since > interval '400 days' THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;

  WITH b AS (
    SELECT m.subscription_id, m.currency,
           COALESCE(sum(m.delta_minor) FILTER (WHERE m.occurred_at < p_since
                    OR (m.backfilled AND m.occurred_at < p_until)), 0) AS s_amt,
           COALESCE(sum(m.delta_minor) FILTER (WHERE m.occurred_at < p_until), 0) AS e_amt,
           (array_agg(COALESCE(m.user_id::text, 'sub:' || m.subscription_id::text)
                      ORDER BY m.occurred_at DESC, m.id DESC))[1] AS customer
      FROM public.mrr_movements m
     WHERE m.tenant_id = v_tenant AND m.environment = 'live' AND m.occurred_at < p_until
     GROUP BY m.subscription_id, m.currency
  ), cust AS (
    SELECT customer, bool_or(s_amt > 0) AS at_start, bool_or(e_amt > 0) AS at_end FROM b GROUP BY customer
  ), mv AS (
    SELECT * FROM public._revenue_movements(v_tenant, p_since, p_until)
  ), per_cur AS (
    SELECT b.currency,
           sum(b.s_amt) FILTER (WHERE b.s_amt > 0) AS s,
           sum(b.e_amt) FILTER (WHERE b.s_amt > 0) AS e,
           sum(LEAST(b.e_amt, b.s_amt)) FILTER (WHERE b.s_amt > 0) AS g
      FROM b GROUP BY b.currency
  ), reasons AS (
    SELECT m.reason, count(*) AS n,
           jsonb_agg(jsonb_build_object('currency', m.currency, 'amount_minor', m.delta_minor)) AS amounts
      FROM public.mrr_movements m
     WHERE m.tenant_id = v_tenant AND m.environment = 'live' AND m.kind = 'churn'
       AND m.occurred_at >= p_since AND m.occurred_at < p_until
     GROUP BY m.reason
  )
  SELECT jsonb_build_object(
    'since', p_since,
    'until', p_until,
    'customers_start', (SELECT count(*) FROM cust WHERE at_start),
    'customers_churned', (SELECT count(*) FROM cust WHERE at_start AND NOT at_end),
    'logo_churn_rate', (SELECT CASE WHEN count(*) FILTER (WHERE at_start) > 0
                          THEN round(count(*) FILTER (WHERE at_start AND NOT at_end)::numeric
                                     / count(*) FILTER (WHERE at_start), 4) END FROM cust),
    'involuntary_share', (SELECT CASE WHEN sum(n) FILTER (WHERE reason <> 'currency_switch') > 0
                            THEN round(COALESCE(sum(n) FILTER (WHERE reason = 'unpaid'), 0)::numeric
                                       / sum(n) FILTER (WHERE reason <> 'currency_switch'), 4) END FROM reasons),
    'currencies', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'currency', p.currency,
        'mrr_start_minor', COALESCE(p.s, 0),
        'churn_minor', COALESCE((SELECT sum(amount_minor) FROM mv WHERE mv.currency = p.currency AND kind = 'churn'), 0),
        'contraction_minor', COALESCE((SELECT sum(amount_minor) FROM mv WHERE mv.currency = p.currency AND kind = 'contraction'), 0),
        'expansion_minor', COALESCE((SELECT sum(amount_minor) FROM mv WHERE mv.currency = p.currency AND kind = 'expansion'), 0),
        'reactivation_minor', COALESCE((SELECT sum(amount_minor) FROM mv WHERE mv.currency = p.currency AND kind = 'reactivation'), 0),
        'gross_revenue_churn', CASE WHEN p.s > 0 THEN round(1 - p.g::numeric / p.s, 4) END,
        'gross_revenue_retention', CASE WHEN p.s > 0 THEN round(p.g::numeric / p.s, 4) END,
        'net_revenue_retention', CASE WHEN p.s > 0 THEN round(p.e::numeric / p.s, 4) END
      ) ORDER BY COALESCE(p.s, 0) DESC, p.currency) FROM per_cur p), '[]'::jsonb),
    'reasons', COALESCE((SELECT jsonb_agg(jsonb_build_object('reason', r.reason, 'movements', r.n, 'amounts', r.amounts)
                          ORDER BY r.n DESC, r.reason) FROM reasons r), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- E) Kohorty (retencja logo).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_cohorts(
  p_from_month date,
  p_to_month date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_cohorts jsonb;
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_from_month IS NULL OR p_to_month IS NULL
     OR p_from_month <> date_trunc('month', p_from_month)::date
     OR p_to_month <> date_trunc('month', p_to_month)::date
     OR p_to_month < p_from_month OR p_to_month > p_from_month + interval '23 months' THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;

  WITH firsts AS (
    SELECT DISTINCT ON (m.subscription_id) m.subscription_id, m.kind, m.backfilled, m.occurred_at
      FROM public.mrr_movements m
     WHERE m.tenant_id = v_tenant AND m.environment = 'live'
     ORDER BY m.subscription_id, m.occurred_at, m.id
  ), members AS (
    SELECT f.subscription_id, date_trunc('month', f.occurred_at)::date AS cohort_month
      FROM firsts f
     WHERE f.kind = 'new' AND NOT f.backfilled
       AND f.occurred_at >= p_from_month AND f.occurred_at < (p_to_month + interval '1 month')
  ), grid AS (
    SELECT DISTINCT mb.cohort_month, o.n_off
      FROM members mb CROSS JOIN generate_series(0, 12) o(n_off)
     WHERE (mb.cohort_month + make_interval(months => o.n_off + 1)) <= now()
        OR o.n_off = 0
  ), cells AS (
    SELECT g.cohort_month, g.n_off,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.mrr_movements x
              WHERE x.subscription_id = mb.subscription_id AND x.environment = 'live'
                AND x.occurred_at < LEAST(g.cohort_month + make_interval(months => g.n_off + 1), now())
              GROUP BY x.currency HAVING sum(x.delta_minor) > 0)) AS active,
           count(*) AS size
      FROM grid g JOIN members mb ON mb.cohort_month = g.cohort_month
     GROUP BY g.cohort_month, g.n_off
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'cohort_month', to_char(c.cohort_month, 'YYYY-MM-DD'),
           'size', c.size,
           'retained', c.retained) ORDER BY c.cohort_month), '[]'::jsonb)
    INTO v_cohorts
    FROM (
      SELECT cohort_month, max(size) AS size,
             jsonb_agg(jsonb_build_object('month_offset', n_off, 'active', active,
                       'share', CASE WHEN size > 0 THEN round(active::numeric / size, 4) END)
                       ORDER BY n_off) AS retained
        FROM cells GROUP BY cohort_month
    ) c;

  RETURN jsonb_build_object('from_month', to_char(p_from_month, 'YYYY-MM-DD'),
                            'to_month', to_char(p_to_month, 'YYYY-MM-DD'),
                            'max_offset', 12, 'cohorts', v_cohorts);
END;
$$;

-- ----------------------------------------------------------------------------
-- F) Windykacja.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_dunning(
  p_since timestamptz,
  p_until timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_result jsonb;
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until <= p_since
     OR p_until - p_since > interval '400 days' THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;

  WITH c AS (
    SELECT * FROM public.dunning_cycles d WHERE d.tenant_id = v_tenant AND d.environment = 'live'
  ), money AS (
    SELECT 'at_risk' AS k, currency, sum(mrr_at_risk_minor)::bigint AS amt FROM c WHERE outcome = 'open' GROUP BY currency
    UNION ALL
    SELECT 'recovered', currency, sum(mrr_at_risk_minor)::bigint FROM c
     WHERE recovered_at >= p_since AND recovered_at < p_until GROUP BY currency
    UNION ALL
    SELECT 'lost', currency, sum(mrr_at_risk_minor)::bigint FROM c
     WHERE lost_at >= p_since AND lost_at < p_until GROUP BY currency
  )
  SELECT jsonb_build_object(
    'since', p_since,
    'until', p_until,
    'started', (SELECT count(*) FROM c WHERE started_at >= p_since AND started_at < p_until),
    'recovered', (SELECT count(*) FROM c WHERE recovered_at >= p_since AND recovered_at < p_until),
    'lost', (SELECT count(*) FROM c WHERE lost_at >= p_since AND lost_at < p_until),
    'open', (SELECT count(*) FROM c WHERE outcome = 'open'),
    'recovery_rate', (SELECT CASE WHEN count(*) > 0
                        THEN round(count(*) FILTER (WHERE outcome = 'recovered')::numeric / count(*), 4) END
                        FROM c WHERE (recovered_at >= p_since AND recovered_at < p_until)
                                  OR (lost_at >= p_since AND lost_at < p_until)),
    'median_days_to_recover', (SELECT round((percentile_cont(0.5) WITHIN GROUP (
                                 ORDER BY extract(epoch FROM recovered_at - started_at) / 86400))::numeric, 1)
                                 FROM c WHERE recovered_at >= p_since AND recovered_at < p_until),
    'at_risk', COALESCE((SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amt) ORDER BY currency) FROM money WHERE k = 'at_risk'), '[]'::jsonb),
    'recovered_mrr', COALESCE((SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amt) ORDER BY currency) FROM money WHERE k = 'recovered'), '[]'::jsonb),
    'lost_mrr', COALESCE((SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amt) ORDER BY currency) FROM money WHERE k = 'lost'), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- G) Przychód zrealizowany.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_realized(
  p_since timestamptz,
  p_until timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_result jsonb;
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until <= p_since
     OR p_until - p_since > interval '400 days' THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;

  WITH r AS (
    SELECT * FROM public._revenue_realized(v_tenant, p_since, p_until)
  )
  SELECT jsonb_build_object(
    'since', p_since,
    'until', p_until,
    'categories', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', category, 'currency', currency,
                     'gross_minor', gross_minor, 'refunds_minor', refunds_minor, 'net_minor', net_minor,
                     'documents', documents) ORDER BY category, currency) FROM r), '[]'::jsonb),
    'totals', COALESCE((SELECT jsonb_agg(jsonb_build_object('currency', currency, 'gross_minor', g,
                 'refunds_minor', f, 'net_minor', n) ORDER BY currency)
                 FROM (SELECT currency, sum(gross_minor)::bigint g, sum(refunds_minor)::bigint f,
                              sum(net_minor)::bigint n FROM r GROUP BY currency) t), '[]'::jsonb),
    'orders', COALESCE((SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', net,
                 'orders', n) ORDER BY currency)
                 FROM (SELECT upper(po.currency) AS currency,
                              sum(po.amount_cents - LEAST(COALESCE(po.refunded_amount_cents, 0), po.amount_cents))::bigint AS net,
                              count(*)::integer AS n
                         FROM public.payment_orders po
                        WHERE po.tenant_id = v_tenant AND po.environment = 'live' AND po.provider <> 'mock'
                          AND po.status IN ('paid', 'refunded') AND po.paid_at >= p_since AND po.paid_at < p_until
                        GROUP BY upper(po.currency)) o), '[]'::jsonb),
    'unknown_environment_documents', (
      SELECT count(*) FROM public.billing_documents d
        LEFT JOIN public.payment_orders o ON o.id = d.order_id
       WHERE d.tenant_id = v_tenant AND d.issued_at >= p_since AND d.issued_at < p_until
         AND COALESCE(d.environment, o.environment) IS NULL)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- Granty: RPC panelu (§4.4) - authenticated (funkcja sama sprawdza rolę),
-- service_role; nigdy anon.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.admin_revenue_semantic_snapshot(timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revenue_mrr_bridge(timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revenue_mrr_series(timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revenue_churn(timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revenue_cohorts(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revenue_dunning(timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revenue_realized(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revenue_semantic_snapshot(timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revenue_mrr_bridge(timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revenue_mrr_series(timestamptz, timestamptz, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revenue_churn(timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revenue_cohorts(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revenue_dunning(timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revenue_realized(timestamptz, timestamptz) TO authenticated, service_role;
