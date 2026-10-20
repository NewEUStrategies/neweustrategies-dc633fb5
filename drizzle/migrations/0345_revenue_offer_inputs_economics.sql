-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S2, 8/8): MACIERZ OFERTY, DANE WEJŚCIOWE PLANU
-- I KOSZTÓW, EKONOMIKA JEDNOSTKOWA.
--
-- DEFEKT
--   1. Konfliktów oferty nie widać w jednym miejscu: plan „w sprzedaży" przy
--      warstwie ukrytej albo nieaktywnej, plan bez pary w katalogu cen
--      operatora (kasa odmówi zakupu), warstwa widoczna w cenniku bez planu
--      w sprzedaży - każdy z nich wychodzi dopiero przy reklamacji klienta.
--   2. Plan MRR, koszty sprzedaży i marketingu, COGS i marże żyją w arkuszu
--      poza systemem - CAC, LTV, okres zwrotu i „Rule of 40" nie mają
--      danych, a gdyby je zgadywać, panel pokazywałby liczby bez pokrycia.
--
-- ZMIANA
--   A. `admin_revenue_offer_matrix()` (panel; admin i editor - editor dostaje
--      `active_subscriptions` = NULL, bo liczba płacących to dana handlowa):
--      plany najemcy × warstwa × para katalogowa (`billing_catalog_entry`
--      po warstwie i cyklu, bez `legacy`) × `for_sale` / `pricing_visible`,
--      z listą `issues` per plan (`no_catalog_pair`, `tier_missing`,
--      `tier_inactive`, `tier_hidden`, `inactive_for_sale`) i warstwy
--      z liczbą planów w sprzedaży (`visible_without_plan`).
--   B. `admin_revenue_inputs(p_from_month, p_to_month)` - wiersze
--      `revenue_manual_inputs` z zakresu (maks. 24 miesiące), tylko admin
--      (D-06: plan i koszty to dane finansowe).
--   C. `admin_revenue_input_upsert(p_period_month, p_kind, p_segment,
--      p_currency, p_amount_minor, p_ratio, p_note, p_expected_updated_at)` -
--      tylko admin, najemca z sesji. Kwota (`mrr_plan`,
--      `new_customers_plan` - LICZBA klientów, bo CHECK I0 wiąże kwotę
--      z walutą rynku planu, `sales_marketing_cost`, `cogs`) albo stosunek
--      w [-1, 1] (`gross_margin_pct`, `ebitda_margin_pct`, bez waluty); obie
--      wartości NULL = usunięcie wiersza. Współbieżność optymistyczna:
--      `p_expected_updated_at` różne od zapisanego (albo NULL przy istniejącym
--      wierszu) -> 40001 `stale_write` (kontrakt D-S1-02). Notatka > 500
--      znaków jest ODRZUCANA (22023), nie przycinana. Zdarzenie
--      `revenue_input.changed.v1` (`period_month`, `kind`, `segment`, `op`).
--   D. `admin_revenue_economics(p_from_month, p_to_month, p_time_zone)` -
--      per miesiąc i waluta: MRR na koniec, ARPA, nowi klienci, churn logo,
--      koszty z danych wejściowych, marża (wprost albo 1 − COGS / przychód
--      zrealizowany), CAC, LTV (ARPA × marża / churn), LTV:CAC, okres zwrotu
--      CAC, realizacja planu MRR; `missing[]` - czego brakuje, żeby policzyć
--      wskaźnik (bez wsadu wszystkie wskaźniki ekonomiki = NULL, nigdy
--      zgadywanie); `rule_of_40` dla ostatniego miesiąca (wzrost r/r + marża
--      EBITDA) albo NULL.
--
-- KOLEJNOŚĆ WDROŻENIA: po 110000-110400 (katalog, helpery). Nowe funkcje;
-- `admin_revenue_input_upsert` pisze do tabeli I0 (`revenue_manual_inputs`).
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowe nazwy - bez CIALO-Z),
-- bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/revenue_offer_inputs_economics_test.sql (macierz
-- z konfliktami, editor bez liczby subskrypcji, dane wejściowe tylko admin,
-- 40001, zdarzenie, ekonomika NULL + missing[] bez wsadu, z wsadem - liczby).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Macierz oferty.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_offer_matrix()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_admin boolean;
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_or_editor() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_admin := public.has_role((SELECT auth.uid()), 'admin'::app_role);

  WITH cat AS (
    SELECT * FROM public.billing_catalog_entry(NULL) WHERE NOT legacy
  ), plans AS (
    SELECT p.id, p.tier_key, p.interval::text AS billing_interval, p.price_cents, p.currency,
           p.active, p.for_sale, p.sort_order,
           (SELECT c.price_id FROM cat c WHERE c.tier_key = p.tier_key
                                          AND c.billing_interval = p.interval::text LIMIT 1) AS catalog_price_id,
           t.key AS tier_found, t.active AS tier_active, t.pricing_visible AS tier_visible
      FROM public.access_plans p
      LEFT JOIN public.membership_tiers t ON t.tenant_id = p.tenant_id AND t.key = p.tier_key
     WHERE p.tenant_id = v_tenant
  )
  SELECT jsonb_build_object(
    'plans', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'plan_id', pl.id,
        'tier_key', pl.tier_key,
        'interval', pl.billing_interval,
        'price_cents', pl.price_cents,
        'currency', upper(pl.currency),
        'active', pl.active,
        'for_sale', pl.for_sale,
        'catalog_price_id', pl.catalog_price_id,
        'tier_active', pl.tier_active,
        'pricing_visible', pl.tier_visible,
        'active_subscriptions', CASE WHEN v_admin THEN (
          SELECT count(*) FROM public.subscriptions s
            JOIN cat c ON c.price_id = s.price_id
           WHERE s.tenant_id = v_tenant AND s.environment = 'live'
             AND s.status IN ('active', 'past_due', 'trialing')
             AND c.tier_key = pl.tier_key AND c.billing_interval = pl.billing_interval) END,
        'issues', to_jsonb(array_remove(ARRAY[
          CASE WHEN pl.billing_interval <> 'one_time' AND pl.catalog_price_id IS NULL AND pl.for_sale AND pl.active
               THEN 'no_catalog_pair' END,
          CASE WHEN pl.tier_key IS NOT NULL AND pl.tier_found IS NULL THEN 'tier_missing' END,
          CASE WHEN pl.for_sale AND pl.active AND pl.tier_active IS FALSE THEN 'tier_inactive' END,
          CASE WHEN pl.for_sale AND pl.active AND pl.tier_visible IS FALSE THEN 'tier_hidden' END,
          CASE WHEN pl.for_sale AND NOT pl.active THEN 'inactive_for_sale' END
        ], NULL))
      ) ORDER BY pl.sort_order, pl.tier_key, pl.billing_interval) FROM plans pl), '[]'::jsonb),
    'tiers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'key', t.key,
        'rank', t.rank,
        'active', t.active,
        'pricing_visible', t.pricing_visible,
        'is_default', t.is_default,
        'plans_for_sale', (SELECT count(*) FROM plans pl WHERE pl.tier_key = t.key AND pl.for_sale AND pl.active),
        'issues', to_jsonb(array_remove(ARRAY[
          CASE WHEN t.active AND t.pricing_visible AND NOT t.is_default
                AND NOT EXISTS (SELECT 1 FROM plans pl WHERE pl.tier_key = t.key AND pl.for_sale AND pl.active)
               THEN 'visible_without_plan' END
        ], NULL))
      ) ORDER BY t.rank, t.key)
      FROM public.membership_tiers t WHERE t.tenant_id = v_tenant), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- B) Dane wejściowe - odczyt.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_inputs(
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
  v_rows jsonb;
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', i.id, 'period_month', to_char(i.period_month, 'YYYY-MM-DD'), 'kind', i.kind,
           'segment', i.segment, 'currency', i.currency, 'amount_minor', i.amount_minor,
           'ratio', i.ratio, 'note', i.note, 'updated_at', i.updated_at, 'updated_by', i.updated_by)
         ORDER BY i.period_month, i.kind, i.segment, i.currency), '[]'::jsonb)
    INTO v_rows
    FROM public.revenue_manual_inputs i
   WHERE i.tenant_id = v_tenant AND i.period_month >= p_from_month AND i.period_month <= p_to_month;

  RETURN jsonb_build_object('from_month', to_char(p_from_month, 'YYYY-MM-DD'),
                            'to_month', to_char(p_to_month, 'YYYY-MM-DD'), 'rows', v_rows);
END;
$$;

-- ----------------------------------------------------------------------------
-- C) Dane wejściowe - zapis z kontrolą współbieżności.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_input_upsert(
  p_period_month date,
  p_kind text,
  p_segment text,
  p_currency text,
  p_amount_minor bigint,
  p_ratio numeric,
  p_note text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_uid uuid := (SELECT auth.uid());
  v_segment text := COALESCE(p_segment, 'all');
  v_currency text := upper(NULLIF(btrim(p_currency), ''));
  v_note text := NULLIF(btrim(p_note), '');
  v_row public.revenue_manual_inputs%ROWTYPE;
  v_found boolean;
  v_op text;
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_period_month IS NULL OR p_period_month <> date_trunc('month', p_period_month)::date THEN
    RAISE EXCEPTION 'period_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('mrr_plan', 'new_customers_plan', 'sales_marketing_cost',
                                      'cogs', 'gross_margin_pct', 'ebitda_margin_pct') THEN
    RAISE EXCEPTION 'kind_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_segment NOT IN ('all', 'b2c_individual', 'b2c_reduced', 'b2b_institution') THEN
    RAISE EXCEPTION 'segment_invalid' USING ERRCODE = '22023';
  END IF;
  -- Za długa notatka jest odrzucana, nie przycinana (AGENTS: limity = zapis).
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023';
  END IF;
  IF p_kind IN ('gross_margin_pct', 'ebitda_margin_pct') THEN
    IF p_amount_minor IS NOT NULL OR v_currency IS NOT NULL
       OR (p_ratio IS NOT NULL AND (p_ratio < -1 OR p_ratio > 1)) THEN
      RAISE EXCEPTION 'value_invalid' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_ratio IS NOT NULL OR v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$'
       OR (p_amount_minor IS NOT NULL AND p_amount_minor < 0) THEN
      RAISE EXCEPTION 'value_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.revenue_manual_inputs i
   WHERE i.tenant_id = v_tenant AND i.period_month = p_period_month AND i.kind = p_kind
     AND i.segment = v_segment AND i.currency IS NOT DISTINCT FROM v_currency
   FOR UPDATE;
  v_found := FOUND;
  IF v_found AND v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = '40001';
  END IF;
  IF NOT v_found AND p_expected_updated_at IS NOT NULL THEN
    -- Wiersz, który klient widział, zniknął w innej karcie.
    RAISE EXCEPTION 'stale_write' USING ERRCODE = '40001';
  END IF;

  IF p_amount_minor IS NULL AND p_ratio IS NULL THEN
    IF NOT v_found THEN
      RETURN jsonb_build_object('op', 'noop', 'row', NULL);
    END IF;
    DELETE FROM public.revenue_manual_inputs WHERE id = v_row.id;
    v_op := 'delete';
  ELSIF v_found THEN
    UPDATE public.revenue_manual_inputs
       SET amount_minor = p_amount_minor, ratio = p_ratio, note = v_note,
           updated_by = v_uid, updated_at = clock_timestamp()
     WHERE id = v_row.id
    RETURNING * INTO v_row;
    v_op := 'update';
  ELSE
    INSERT INTO public.revenue_manual_inputs (
      tenant_id, period_month, kind, segment, currency, amount_minor, ratio, note, updated_by, updated_at)
    VALUES (v_tenant, p_period_month, p_kind, v_segment, v_currency, p_amount_minor, p_ratio, v_note,
            v_uid, clock_timestamp())
    RETURNING * INTO v_row;
    v_op := 'insert';
  END IF;

  BEGIN
    PERFORM public.emit_domain_event(v_tenant, 'revenue_input', p_period_month::text,
      'revenue_input.changed.v1',
      jsonb_build_object('period_month', to_char(p_period_month, 'YYYY-MM-DD'), 'kind', p_kind,
                         'segment', v_segment, 'op', v_op),
      v_uid);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public._log_emit_error(v_tenant, 'admin_revenue_input_upsert',
      'revenue_input.changed.v1', SQLSTATE, SQLERRM);
  END;

  RETURN jsonb_build_object('op', v_op, 'row', CASE WHEN v_op = 'delete' THEN NULL ELSE jsonb_build_object(
    'id', v_row.id, 'period_month', to_char(v_row.period_month, 'YYYY-MM-DD'), 'kind', v_row.kind,
    'segment', v_row.segment, 'currency', v_row.currency, 'amount_minor', v_row.amount_minor,
    'ratio', v_row.ratio, 'note', v_row.note, 'updated_at', v_row.updated_at,
    'updated_by', v_row.updated_by) END);
END;
$$;

-- ----------------------------------------------------------------------------
-- D) Ekonomika jednostkowa.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_economics(
  p_from_month date,
  p_to_month date,
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
  v_months jsonb;
  v_rule jsonb;
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
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_time_zone) THEN
    RAISE EXCEPTION 'time_zone_invalid' USING ERRCODE = '22023';
  END IF;

  WITH months AS (
    SELECT m::date AS month,
           (m::timestamp AT TIME ZONE p_time_zone) AS m_start,
           ((m + interval '1 month')::timestamp AT TIME ZONE p_time_zone) AS m_end
      FROM generate_series(p_from_month, p_to_month, interval '1 month') m
  ), ends AS (
    SELECT mo.month, e.currency, e.mrr_minor, e.active_customers
      FROM months mo CROSS JOIN LATERAL public._revenue_mrr_at(v_tenant, mo.m_end) e
  ), inputs AS (
    SELECT i.period_month AS month, i.kind, i.currency, i.amount_minor, i.ratio
      FROM public.revenue_manual_inputs i
     WHERE i.tenant_id = v_tenant AND i.segment = 'all'
       AND i.period_month >= p_from_month AND i.period_month <= p_to_month
  ), cur AS (
    SELECT month, currency FROM ends
    UNION SELECT month, currency FROM inputs WHERE currency IS NOT NULL
  ), base AS (
    SELECT c.month, c.currency, mo.m_start, mo.m_end,
           (SELECT e.mrr_minor FROM ends e WHERE e.month = c.month AND e.currency = c.currency) AS mrr_end,
           (SELECT e.active_customers FROM ends e WHERE e.month = c.month AND e.currency = c.currency) AS customers_end,
           (SELECT count(DISTINCT m.subscription_id) FROM public.mrr_movements m
             WHERE m.tenant_id = v_tenant AND m.environment = 'live' AND m.kind = 'new' AND NOT m.backfilled
               AND m.currency = c.currency AND m.occurred_at >= mo.m_start AND m.occurred_at < mo.m_end) AS new_customers,
           (SELECT amount_minor FROM inputs i WHERE i.month = c.month AND i.kind = 'mrr_plan' AND i.currency = c.currency) AS mrr_plan,
           (SELECT amount_minor FROM inputs i WHERE i.month = c.month AND i.kind = 'new_customers_plan' AND i.currency = c.currency) AS new_plan,
           (SELECT amount_minor FROM inputs i WHERE i.month = c.month AND i.kind = 'sales_marketing_cost' AND i.currency = c.currency) AS sm_cost,
           (SELECT amount_minor FROM inputs i WHERE i.month = c.month AND i.kind = 'cogs' AND i.currency = c.currency) AS cogs,
           (SELECT ratio FROM inputs i WHERE i.month = c.month AND i.kind = 'gross_margin_pct') AS gm_input,
           (SELECT ratio FROM inputs i WHERE i.month = c.month AND i.kind = 'ebitda_margin_pct') AS ebitda,
           (SELECT sum(r.net_minor) FROM public._revenue_realized(v_tenant, mo.m_start, mo.m_end) r
             WHERE r.currency = c.currency) AS realized
      FROM cur c JOIN months mo ON mo.month = c.month
  ), churn AS (
    SELECT b.month, b.currency,
           (SELECT CASE WHEN count(*) FILTER (WHERE s_amt > 0) > 0
                     THEN count(*) FILTER (WHERE s_amt > 0 AND e_amt <= 0)::numeric / count(*) FILTER (WHERE s_amt > 0) END
              FROM (SELECT m.subscription_id,
                           COALESCE(sum(m.delta_minor) FILTER (WHERE m.occurred_at < b.m_start), 0) AS s_amt,
                           COALESCE(sum(m.delta_minor) FILTER (WHERE m.occurred_at < b.m_end), 0) AS e_amt
                      FROM public.mrr_movements m
                     WHERE m.tenant_id = v_tenant AND m.environment = 'live' AND m.currency = b.currency
                       AND m.occurred_at < b.m_end
                     GROUP BY m.subscription_id) x) AS logo_churn
      FROM base b
  ), calc AS (
    SELECT b.*, ch.logo_churn,
           CASE WHEN b.customers_end > 0 THEN b.mrr_end::numeric / b.customers_end END AS arpa,
           COALESCE(b.gm_input, CASE WHEN b.cogs IS NOT NULL AND b.realized > 0
                                     THEN 1 - b.cogs::numeric / b.realized END) AS gm
      FROM base b JOIN churn ch ON ch.month = b.month AND ch.currency = b.currency
  ), metrics AS (
    SELECT c.*,
           CASE WHEN c.sm_cost IS NOT NULL AND c.new_customers > 0 THEN c.sm_cost::numeric / c.new_customers END AS cac,
           CASE WHEN c.arpa IS NOT NULL AND c.gm IS NOT NULL AND c.logo_churn > 0 THEN c.arpa * c.gm / c.logo_churn END AS ltv
      FROM calc c
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'month', to_char(m.month, 'YYYY-MM-DD'),
           'currency', m.currency,
           'mrr_end_minor', m.mrr_end,
           'customers_end', m.customers_end,
           'arpa_minor', round(m.arpa)::bigint,
           'new_customers', m.new_customers,
           'logo_churn_rate', round(m.logo_churn, 4),
           'realized_net_minor', m.realized,
           'sales_marketing_cost_minor', m.sm_cost,
           'cogs_minor', m.cogs,
           'gross_margin', round(m.gm, 4),
           'ebitda_margin', m.ebitda,
           'cac_minor', round(m.cac)::bigint,
           'ltv_minor', round(m.ltv)::bigint,
           'ltv_cac_ratio', CASE WHEN m.ltv IS NOT NULL AND m.cac > 0 THEN round(m.ltv / m.cac, 4) END,
           'cac_payback_months', CASE WHEN m.cac IS NOT NULL AND m.arpa > 0 AND m.gm > 0
                                      THEN round(m.cac / (m.arpa * m.gm), 2) END,
           'mrr_plan_minor', m.mrr_plan,
           'plan_attainment', CASE WHEN m.mrr_plan > 0 THEN round(COALESCE(m.mrr_end, 0)::numeric / m.mrr_plan, 4) END,
           'new_customers_plan', m.new_plan,
           'missing', to_jsonb(array_remove(ARRAY[
             CASE WHEN m.mrr_plan IS NULL THEN 'mrr_plan' END,
             CASE WHEN m.new_plan IS NULL THEN 'new_customers_plan' END,
             CASE WHEN m.sm_cost IS NULL THEN 'sales_marketing_cost' END,
             CASE WHEN m.gm IS NULL THEN 'gross_margin_pct' END,
             CASE WHEN m.ebitda IS NULL THEN 'ebitda_margin_pct' END
           ], NULL))
         ) ORDER BY m.month, m.currency), '[]'::jsonb)
    INTO v_months
    FROM metrics m;

  -- Rule of 40: wzrost MRR r/r ostatniego miesiąca + marża EBITDA, w walucie
  -- wiodącej (największe MRR) - bez marży albo bez historii sprzed roku NULL.
  SELECT CASE WHEN x.prev > 0 AND x.ebitda IS NOT NULL THEN jsonb_build_object(
           'month', to_char(p_to_month, 'YYYY-MM-DD'), 'currency', x.currency,
           'growth_yoy', round(x.cur::numeric / x.prev - 1, 4), 'ebitda_margin', x.ebitda,
           'value', round(x.cur::numeric / x.prev - 1 + x.ebitda, 4)) END
    INTO v_rule
    FROM (
      SELECT e.currency, e.mrr_minor AS cur,
             (SELECT p.mrr_minor FROM public._revenue_mrr_at(v_tenant,
                ((p_to_month - interval '11 months')::timestamp AT TIME ZONE p_time_zone)) p
               WHERE p.currency = e.currency) AS prev,
             (SELECT i.ratio FROM public.revenue_manual_inputs i
               WHERE i.tenant_id = v_tenant AND i.segment = 'all' AND i.kind = 'ebitda_margin_pct'
                 AND i.period_month = p_to_month) AS ebitda
        FROM public._revenue_mrr_at(v_tenant, ((p_to_month + interval '1 month')::timestamp AT TIME ZONE p_time_zone)) e
       ORDER BY e.mrr_minor DESC, e.currency
       LIMIT 1
    ) x;

  RETURN jsonb_build_object(
    'from_month', to_char(p_from_month, 'YYYY-MM-DD'),
    'to_month', to_char(p_to_month, 'YYYY-MM-DD'),
    'time_zone', p_time_zone,
    'months', v_months,
    'missing', COALESCE((SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements(v_months) mo,
                          jsonb_array_elements_text(mo->'missing') x), '[]'::jsonb),
    'rule_of_40', v_rule);
END;
$$;

-- ----------------------------------------------------------------------------
-- Granty: RPC panelu (§4.4).
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.admin_revenue_offer_matrix() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revenue_inputs(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revenue_input_upsert(date, text, text, text, bigint, numeric, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revenue_economics(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revenue_offer_matrix() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revenue_inputs(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revenue_input_upsert(date, text, text, text, bigint, numeric, text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revenue_economics(date, date, text) TO authenticated, service_role;
