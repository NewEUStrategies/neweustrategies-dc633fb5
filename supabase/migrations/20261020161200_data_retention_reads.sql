-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9c-X2, 3/5): RETENCJA DANYCH - ODCZYT STARSZYCH
-- OKIEN Z AGREGATÓW. Polecenie właściciela 2026-10-20 (Z-I9b-10).
--
-- DEFEKT
--   1. Po usunięciu surowych wierszy (20261020161100) okno sprzed progu
--      retencji pokazałoby zera: lejek (`_funnel_counts` liczy konta, gości,
--      uderzenia, konwersje i powody z `paywall_hits`), pulpit monetyzacji
--      (`monetization_dashboard` - zdarzenia licznika z `metering_event_log`),
--      zaangażowanie kampanii (`newsletter_campaign_engagement` - zdarzenia
--      kampanii) i statystyki ścieżek (`admin_journey_stats` czyta surowe
--      wiersze dla okien <= 400 dni).
--
-- ZMIANA
--   A. `_funnel_counts` (S3, CIALO-Z niżej): dni < `_data_retention_funnel_cut`
--      najemcy z `funnel_paywall_daily` (konta aktywne, konta i goście
--      z uderzeniem, uderzenia, konwersje segmentu, powody), dni >= granica -
--      jak dotąd z wierszy surowych. Pozostałe liczniki (rejestracje, kasa,
--      formularze, kupony, źródła) bez zmian. Bez pieczęci - wynik identyczny
--      jak przed X2.
--   B. `monetization_dashboard` (CIALO-Z niżej): zdarzenia licznika dni
--      < granica z `metering_events_daily`.
--   C. `newsletter_campaign_engagement` (CIALO-Z niżej): zdarzenia surowe +
--      archiwum kampanii.
--   D. `admin_journey_stats` (S5, CIALO-Z niżej): okno sięgające dnia
--      zapieczętowanego czyta węzły z `journey_node_daily_stats` (jak okno
--      > 400 dni).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020161000 (tabele agregatów, pieczęcie)
-- i 161100 (czyszczenie). Kształty odpowiedzi RPC bez zmian - kod TS nie
-- wymaga wdrożenia razem.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (te same sygnatury), bezstanowe
-- REVOKE/GRANT. Zero DDL.
-- DOWÓD: supabase/tests/hub_i9c_data_retention_aggregates_test.sql (okno
-- sprzed progu: lejek, pulpit, kampania i statystyki ścieżki identyczne przed
-- czyszczeniem i po nim), testy S3/S5 bez zmian asercji.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Lejek: dni sprzed granicy z agregatu dziennego.
-- ----------------------------------------------------------------------------
-- rpc-shape: admin_revenue_funnel (klucze płaskie bez zmian)
-- CIALO-Z: 20261020120400
CREATE OR REPLACE FUNCTION public._funnel_counts(
  p_tenant uuid,
  p_since timestamptz,
  p_until timestamptz,
  p_segment text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_segment text := COALESCE(p_segment, 'all');
  v_accounts bigint := 0;
  v_active bigint := 0;
  v_hit_accounts bigint := 0;
  v_hit_visitors bigint := 0;
  v_hits bigint := 0;
  v_converted bigint := 0;
  v_started bigint := 0;
  v_paid bigint := 0;
  v_expired bigint := 0;
  v_first bigint := 0;
  v_registered_paid bigint := 0;
  v_form_views bigint := 0;
  v_form_submits bigint := 0;
  v_visitors bigint := 0;
  v_codes_issued bigint := 0;
  v_codes_used bigint := 0;
  v_paid_amount jsonb;
  v_sources jsonb;
  v_reasons jsonb;
  v_data_since timestamptz;
  v_ccr numeric;
  -- ZMIANA (I9c-X2): okno dzielone na część z agregatu (dni < granica)
  -- i część surową [v_raw_since, p_until).
  v_cut date;
  v_raw_since timestamptz := p_since;
  v_agg_from date;
  v_agg_until date;
  v_raw boolean := true;
  v_agg record;
BEGIN
  IF p_tenant IS NULL OR p_since IS NULL OR p_until IS NULL OR p_until <= p_since THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;

  v_cut := public._data_retention_funnel_cut(p_tenant);
  IF v_cut IS NOT NULL AND p_since < v_cut::timestamp AT TIME ZONE 'UTC' THEN
    -- Dzień częściowo w oknie liczy się w całości (agregat jest dobowy).
    v_agg_from := (p_since AT TIME ZONE 'UTC')::date;
    v_agg_until := LEAST(v_cut, ((p_until AT TIME ZONE 'UTC') - interval '1 microsecond')::date + 1);
    v_raw_since := LEAST(GREATEST(p_since, v_cut::timestamp AT TIME ZONE 'UTC'), p_until);
    v_raw := v_raw_since < p_until;
  END IF;

  -- Konta założone w oknie.
  SELECT count(*) INTO v_accounts
    FROM public.profiles p
   WHERE p.tenant_id = p_tenant AND p.created_at >= p_since AND p.created_at < p_until;

  -- Uderzenia w paywall przecinające okno (część surowa).
  IF v_raw THEN
    SELECT count(DISTINCT ph.user_id), count(DISTINCT ph.visitor_hash), COALESCE(sum(ph.hits), 0)
      INTO v_hit_accounts, v_hit_visitors, v_hits
      FROM public.paywall_hits ph
     WHERE ph.tenant_id = p_tenant AND ph.first_at < p_until AND ph.last_at >= v_raw_since;
  END IF;

  SELECT min(ph.first_at) INTO v_data_since
    FROM public.paywall_hits ph WHERE ph.tenant_id = p_tenant;
  -- Pierwszy pomiar nie przesuwa się po czyszczeniu: najstarszy dzień agregatu.
  SELECT LEAST(v_data_since, min(f.day)::timestamp AT TIME ZONE 'UTC') INTO v_data_since
    FROM public.funnel_paywall_daily f WHERE f.tenant_id = p_tenant AND f.paywall_hits > 0;

  -- Konta aktywne: suma zbiorów sygnałów aktywności w części surowej okna.
  IF v_raw THEN
    SELECT count(*) INTO v_active FROM (
      SELECT p.id AS uid
        FROM public.profiles p
        LEFT JOIN auth.users u ON u.id = p.id
       WHERE p.tenant_id = p_tenant
         AND p.created_at < p_until
         AND ((p.created_at >= v_raw_since)
              OR (u.last_sign_in_at >= v_raw_since AND u.last_sign_in_at < p_until))
      UNION
      SELECT ph.user_id FROM public.paywall_hits ph
       WHERE ph.tenant_id = p_tenant AND ph.user_id IS NOT NULL
         AND ph.first_at < p_until AND ph.last_at >= v_raw_since
      UNION
      SELECT mv.user_id FROM public.metered_views mv
       WHERE mv.tenant_id = p_tenant AND mv.user_id IS NOT NULL
         AND mv.created_at >= v_raw_since AND mv.created_at < p_until
      UNION
      SELECT o.user_id FROM public.payment_orders o
       WHERE o.tenant_id = p_tenant AND o.user_id IS NOT NULL
         AND o.paid_at >= v_raw_since AND o.paid_at < p_until
    ) a WHERE a.uid IS NOT NULL;
  END IF;

  -- Kohorta kasy: zamówienia założone w oknie (live, nie mock, bez biletów).
  WITH orders AS (
    SELECT o.id, o.status, o.paid_at, o.amount_cents, o.currency, o.metadata
      FROM public.payment_orders o
      LEFT JOIN public.access_plans ap ON ap.id = o.plan_id
     WHERE o.tenant_id = p_tenant
       AND o.environment = 'live' AND o.provider <> 'mock'
       AND NOT (o.metadata ? 'event_id')
       AND o.created_at >= p_since AND o.created_at < p_until
       AND (v_segment = 'all' OR public.revenue_segment_of_tier(ap.tier_key) = v_segment)
  )
  SELECT count(*),
         count(*) FILTER (WHERE status IN ('paid', 'refunded') AND paid_at IS NOT NULL),
         count(*) FILTER (WHERE status = 'canceled' AND metadata ->> 'cancel_reason' = 'session_expired')
    INTO v_started, v_paid, v_expired
    FROM orders;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', x.currency, 'amount_minor', x.amount)
                            ORDER BY x.currency), '[]'::jsonb)
    INTO v_paid_amount
    FROM (
      SELECT upper(o.currency) AS currency, sum(o.amount_cents)::bigint AS amount
        FROM public.payment_orders o
        LEFT JOIN public.access_plans ap ON ap.id = o.plan_id
       WHERE o.tenant_id = p_tenant
         AND o.environment = 'live' AND o.provider <> 'mock'
         AND NOT (o.metadata ? 'event_id')
         AND o.created_at >= p_since AND o.created_at < p_until
         AND o.status IN ('paid', 'refunded') AND o.paid_at IS NOT NULL
         AND (v_segment = 'all' OR public.revenue_segment_of_tier(ap.tier_key) = v_segment)
       GROUP BY upper(o.currency)
    ) x;

  -- Opłacone zamówienia (dowolny moment) - baza dla pierwszej płatności,
  -- konwersji rejestracji i konwersji paywalla (część surowa okna).
  WITH paid AS (
    SELECT o.user_id, o.paid_at
      FROM public.payment_orders o
      LEFT JOIN public.access_plans ap ON ap.id = o.plan_id
     WHERE o.tenant_id = p_tenant
       AND o.environment = 'live' AND o.provider <> 'mock'
       AND NOT (o.metadata ? 'event_id')
       AND o.user_id IS NOT NULL
       AND o.status IN ('paid', 'refunded') AND o.paid_at IS NOT NULL
       AND (v_segment = 'all' OR public.revenue_segment_of_tier(ap.tier_key) = v_segment)
  ), first_paid AS (
    SELECT user_id, min(paid_at) AS first_at FROM paid GROUP BY user_id
  )
  SELECT
    (SELECT count(*) FROM first_paid f WHERE f.first_at >= p_since AND f.first_at < p_until),
    (SELECT count(*) FROM public.profiles p
      WHERE p.tenant_id = p_tenant AND p.created_at >= p_since AND p.created_at < p_until
        AND EXISTS (SELECT 1 FROM paid x WHERE x.user_id = p.id AND x.paid_at < p_until)),
    CASE WHEN v_raw THEN (SELECT count(*) FROM (
        SELECT ph.user_id, min(ph.first_at) AS hit_at
          FROM public.paywall_hits ph
         WHERE ph.tenant_id = p_tenant AND ph.user_id IS NOT NULL
           AND ph.first_at < p_until AND ph.last_at >= v_raw_since
         GROUP BY ph.user_id
      ) h
      WHERE EXISTS (
        SELECT 1 FROM paid x
         WHERE x.user_id = h.user_id AND x.paid_at >= h.hit_at AND x.paid_at < p_until
      )) ELSE 0 END
    INTO v_first, v_registered_paid, v_converted;

  -- Formularze i okienka zapisu.
  SELECT count(*) FILTER (WHERE e.event = 'open'), count(*) FILTER (WHERE e.event = 'success')
    INTO v_form_views, v_form_submits
    FROM public.newsletter_popup_events e
   WHERE e.tenant_id = p_tenant AND e.created_at >= p_since AND e.created_at < p_until;

  -- Odwiedzający z pierwszej strony (strumień zgody analitycznej).
  SELECT count(DISTINCT ae.anon_id) INTO v_visitors
    FROM public.analytics_events ae
   WHERE ae.tenant_id = p_tenant AND ae.created_at >= p_since AND ae.created_at < p_until
     AND ae.event_type = 'page_view' AND ae.anon_id IS NOT NULL;

  -- Kody kampanii wydanych i ważnych w oknie vs użyte w opłaconym zamówieniu.
  WITH codes AS (
    SELECT c.id
      FROM public.b2b_coupons c
      JOIN public.b2b_coupon_campaigns cc ON cc.id = c.campaign_id AND cc.tenant_id = c.tenant_id
     WHERE c.tenant_id = p_tenant AND cc.status = 'sent'
       AND (c.valid_from IS NULL OR c.valid_from < p_until)
       AND (c.valid_until IS NULL OR c.valid_until >= p_since)
  )
  SELECT (SELECT count(*) FROM codes),
         (SELECT count(DISTINCT r.coupon_id)
            FROM public.b2b_coupon_redemptions r
            JOIN codes k ON k.id = r.coupon_id
            JOIN public.payment_orders o ON o.id = r.order_id
           WHERE r.tenant_id = p_tenant
             AND r.created_at >= p_since AND r.created_at < p_until
             AND o.status IN ('paid', 'refunded') AND o.paid_at IS NOT NULL)
    INTO v_codes_issued, v_codes_used;

  -- Źródła rejestracji (ta sama biała lista co account.registered.v1).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('source', s.source, 'accounts', s.n)
                            ORDER BY s.n DESC, s.source), '[]'::jsonb)
    INTO v_sources
    FROM (
      SELECT CASE
               WHEN u.raw_user_meta_data ->> 'signup_source' IN (
                 'auth_page', 'login_popup', 'popup', 'club_gate', 'register_widget',
                 'paywall', 'pricing', 'checkout', 'club_apply', 'join_us_form'
               ) THEN u.raw_user_meta_data ->> 'signup_source'
               ELSE 'unknown'
             END AS source,
             count(*) AS n
        FROM public.profiles p
        LEFT JOIN auth.users u ON u.id = p.id
       WHERE p.tenant_id = p_tenant AND p.created_at >= p_since AND p.created_at < p_until
       GROUP BY 1
    ) s;

  -- Powody: część surowa + dni z agregatu (sumy per powód).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'reason', r.reason, 'accounts', r.accounts, 'visitors', r.visitors, 'hits', r.hits
         ) ORDER BY r.hits DESC, r.reason), '[]'::jsonb)
    INTO v_reasons
    FROM (
      SELECT u.reason, sum(u.accounts)::bigint AS accounts, sum(u.visitors)::bigint AS visitors,
             sum(u.hits)::bigint AS hits
        FROM (
          SELECT ph.reason,
                 count(DISTINCT ph.user_id) AS accounts,
                 count(DISTINCT ph.visitor_hash) AS visitors,
                 sum(ph.hits)::bigint AS hits
            FROM public.paywall_hits ph
           WHERE v_raw AND ph.tenant_id = p_tenant AND ph.first_at < p_until AND ph.last_at >= v_raw_since
           GROUP BY ph.reason
          UNION ALL
          SELECT x.item ->> 'reason', (x.item ->> 'accounts')::bigint, (x.item ->> 'visitors')::bigint,
                 (x.item ->> 'hits')::bigint
            FROM public.funnel_paywall_daily f
           CROSS JOIN LATERAL jsonb_array_elements(f.reasons) AS x(item)
           WHERE v_agg_from IS NOT NULL AND f.tenant_id = p_tenant
             AND f.day >= v_agg_from AND f.day < v_agg_until
        ) u
       GROUP BY u.reason
    ) r;

  -- Dni sprzed granicy: sumy agregatu (konto liczone raz na dzień).
  IF v_agg_from IS NOT NULL THEN
    SELECT COALESCE(sum(f.active_accounts), 0) AS active, COALESCE(sum(f.paywall_hit_accounts), 0) AS accounts,
           COALESCE(sum(f.paywall_hit_visitors), 0) AS visitors, COALESCE(sum(f.paywall_hits), 0) AS hits,
           COALESCE(sum((f.converted ->> v_segment)::bigint), 0) AS converted
      INTO v_agg
      FROM public.funnel_paywall_daily f
     WHERE f.tenant_id = p_tenant AND f.day >= v_agg_from AND f.day < v_agg_until;
    v_active := v_active + v_agg.active;
    v_hit_accounts := v_hit_accounts + v_agg.accounts;
    v_hit_visitors := v_hit_visitors + v_agg.visitors;
    v_hits := v_hits + v_agg.hits;
    v_converted := v_converted + v_agg.converted;
  END IF;

  v_ccr := CASE WHEN v_started > 0 THEN round(v_paid::numeric / v_started, 6) END;

  RETURN jsonb_build_object(
    'accounts', v_accounts,
    'active_accounts', v_active,
    'paywall_hit_accounts', v_hit_accounts,
    'paywall_hit_visitors', v_hit_visitors,
    'paywall_hits', v_hits,
    'paywall_converted_accounts', v_converted,
    'checkout_started', v_started,
    'checkout_paid', v_paid,
    'checkout_abandoned', v_started - v_paid,
    'checkout_expired', v_expired,
    'first_payments', v_first,
    'registered_paid', v_registered_paid,
    'signup_form_views', v_form_views,
    'signup_form_submits', v_form_submits,
    'visitors_first_party', v_visitors,
    'registered_to_paid_rate',
      CASE WHEN v_accounts > 0 THEN round(v_registered_paid::numeric / v_accounts, 6) END,
    'paywall_conversion_rate',
      CASE WHEN v_hit_accounts > 0 THEN round(v_converted::numeric / v_hit_accounts, 6) END,
    'paywall_hit_rate',
      CASE WHEN v_active > 0 THEN round(v_hit_accounts::numeric / v_active, 6) END,
    'checkout_conversion_rate', v_ccr,
    'checkout_abandonment_rate', CASE WHEN v_ccr IS NOT NULL THEN 1 - v_ccr END,
    'coupon_redemption_rate',
      CASE WHEN v_codes_issued > 0 THEN round(v_codes_used::numeric / v_codes_issued, 6) END,
    'paid_amount', v_paid_amount,
    'signup_sources', v_sources,
    'paywall_reasons', v_reasons,
    'paywall_data_since', v_data_since
  );
END;
$$;

REVOKE ALL ON FUNCTION public._funnel_counts(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._funnel_counts(uuid, timestamptz, timestamptz, text) IS
  'Hub S3 (I9c-X2: dni sprzed granicy retencji z funnel_paywall_daily): liczniki lejka samoobsługowego najemcy w oknie [since, until) - kształt REVENUE_FUNNEL_KEYS (S6) + pola huba; segment zawęża liczniki zakupów. Wewnętrzny: bez EXECUTE dla ról API.';

-- ----------------------------------------------------------------------------
-- B) Pulpit monetyzacji: zdarzenia licznika dni sprzed granicy z agregatu.
-- ----------------------------------------------------------------------------
-- Ciało z 20260724100000 (najemca z sesji, bramka admin/editor); zmienia się
-- wyłącznie źródło `metering_events` dla dni < granica retencji.
-- CIALO-Z: 20260724100000
CREATE OR REPLACE FUNCTION public.monetization_dashboard(
  _from timestamptz DEFAULT (now() - interval '30 days'),
  _to timestamptz DEFAULT now(),
  _plan_id uuid DEFAULT NULL,
  _organization_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' STABLE AS $$
DECLARE v_tenant uuid := public.current_tenant_id(); v_out jsonb; -- FIX: był public_tenant_id()
  -- ZMIANA (I9c-X2): dni < granica retencji z `metering_events_daily`.
  v_cut timestamptz := public._data_retention_funnel_cut(public.current_tenant_id())::timestamp AT TIME ZONE 'UTC';
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  WITH mv AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE user_id IS NOT NULL)::int AS members,
           count(*) FILTER (WHERE user_id IS NULL)::int AS anonymous
    FROM public.metered_views
    WHERE tenant_id = v_tenant AND created_at >= _from AND created_at <= _to
  ), ev_rows AS (
    SELECT outcome, 1 AS n
    FROM public.metering_event_log
    WHERE tenant_id = v_tenant AND occurred_at >= GREATEST(_from, COALESCE(v_cut, '-infinity'::timestamptz))
      AND occurred_at <= _to
    UNION ALL
    SELECT d.outcome, d.events
    FROM public.metering_events_daily d
    WHERE v_cut IS NOT NULL AND d.tenant_id = v_tenant
      AND d.day >= (_from AT TIME ZONE 'UTC')::date AND d.day <= (_to AT TIME ZONE 'UTC')::date
      AND d.day < (v_cut AT TIME ZONE 'UTC')::date
  ), ev AS (
    SELECT
      COALESCE(sum(n) FILTER (WHERE outcome='consumed'), 0)::int AS consumed,
      COALESCE(sum(n) FILTER (WHERE outcome='denied'), 0)::int AS denied,
      COALESCE(sum(n) FILTER (WHERE outcome='requires_registration'), 0)::int AS reg_wall
    FROM ev_rows
  ), orders AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status='paid')::int AS paid,
           coalesce(sum(amount_cents) FILTER (WHERE status='paid'),0)::bigint AS revenue_cents
    FROM public.payment_orders
    WHERE tenant_id = v_tenant
      AND created_at >= _from AND created_at <= _to
      AND (_plan_id IS NULL OR plan_id = _plan_id)
  ), coupons AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE active)::int AS active,
           coalesce(sum(redemptions_count),0)::int AS redemptions
    FROM public.b2b_coupons
    WHERE tenant_id = v_tenant
      AND (_organization_id IS NULL OR organization_id = _organization_id)
  ), redemptions AS (
    SELECT count(*)::int AS in_range,
           coalesce(sum(applied_cents),0)::bigint AS discount_cents
    FROM public.b2b_coupon_redemptions r
    WHERE r.tenant_id = v_tenant
      AND r.created_at >= _from AND r.created_at <= _to
      AND (_organization_id IS NULL
           OR EXISTS (SELECT 1 FROM public.b2b_coupons c
                       WHERE c.id = r.coupon_id AND c.organization_id = _organization_id))
  ), cs AS (
    SELECT to_jsonb(cs.*) AS settings
    FROM public.checkout_settings cs
    WHERE cs.tenant_id = v_tenant
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', _from, 'to', _to),
    'metered_views', (SELECT to_jsonb(mv) FROM mv),
    'metering_events', (SELECT to_jsonb(ev) FROM ev),
    'orders', (SELECT to_jsonb(orders) FROM orders),
    'coupons', (SELECT to_jsonb(coupons) FROM coupons),
    'redemptions', (SELECT to_jsonb(redemptions) FROM redemptions),
    'checkout_settings', COALESCE((SELECT settings FROM cs), '{}'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.monetization_dashboard(timestamptz, timestamptz, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.monetization_dashboard(timestamptz, timestamptz, uuid, uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- C) Zaangażowanie kampanii: surowe + archiwum.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20260814215302
CREATE OR REPLACE FUNCTION public.newsletter_campaign_engagement(p_campaign uuid)
RETURNS TABLE (
  opens bigint,
  clicks bigint,
  unique_openers bigint,
  unique_clickers bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_uid IS NULL
     OR v_tenant IS NULL
     OR NOT (
       public.has_role(v_uid, 'admin'::public.app_role)
       OR public.has_role(v_uid, 'editor'::public.app_role)
     )
  THEN
    RAISE EXCEPTION 'forbidden: staff role required' USING ERRCODE = '42501';
  END IF;

  -- ZMIANA (I9c-X2): zdarzenia surowe + archiwum kampanii (zdarzenia
  -- starsze niż okres retencji, zasięg unikalny policzony przy archiwizacji).
  RETURN QUERY
  SELECT
    raw.opens + COALESCE(a.opens, 0),
    raw.clicks + COALESCE(a.clicks, 0),
    raw.unique_openers + COALESCE(a.unique_openers, 0),
    raw.unique_clickers + COALESCE(a.unique_clickers, 0)
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE e.kind = 'open')::bigint AS opens,
      COUNT(*) FILTER (WHERE e.kind = 'click')::bigint AS clicks,
      COUNT(DISTINCT e.subscriber_id) FILTER (WHERE e.kind = 'open')::bigint AS unique_openers,
      COUNT(DISTINCT e.subscriber_id) FILTER (WHERE e.kind = 'click')::bigint AS unique_clickers
    FROM public.newsletter_campaign_events e
    JOIN public.newsletter_campaigns c ON c.id = e.campaign_id
    WHERE e.campaign_id = p_campaign
      AND e.tenant_id = v_tenant
      AND c.tenant_id = v_tenant
  ) raw
  LEFT JOIN public.newsletter_campaign_engagement_archive a
    ON a.campaign_id = p_campaign AND a.tenant_id = v_tenant;
END;
$$;

COMMENT ON FUNCTION public.newsletter_campaign_engagement(uuid) IS
  'Zaangazowanie kampanii dla panelu: sumy zdarzen i ZASIEG UNIKALNY (I9c-X2: plus archiwum zdarzen starszych niz okres retencji). Bramka: admin/editor w tenancie domowym.';

REVOKE ALL ON FUNCTION public.newsletter_campaign_engagement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.newsletter_campaign_engagement(uuid) TO authenticated, service_role;
-- ----------------------------------------------------------------------------
-- D) Statystyki ścieżki: okno z dniem zapieczętowanym - z rollupu.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020140500
CREATE OR REPLACE FUNCTION public.admin_journey_stats(
  p_journey_id uuid,
  p_version_id uuid DEFAULT NULL,
  p_since timestamptz DEFAULT NULL,
  p_until timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Próg istotności A/B (SPEC §5.6): z liczone od 100 zapisów na wariant.
  c_min_n constant integer := 100;
  v_tenant uuid := public._journey_staff_tenant(false);
  v_def record;
  v_graph jsonb;
  v_since timestamptz := COALESCE(p_since, now() - interval '30 days');
  v_until timestamptz := COALESCE(p_until, now());
  v_rollup boolean;
  v_journey jsonb;
  v_nodes jsonb;
  v_variants jsonb := '[]'::jsonb;
  v_ab jsonb;
  v_metric text;
  -- Zapisy okna jako tablica identyfikatorów (jedno przejście filtra okna;
  -- bez tabeli tymczasowej, której analiza statyczna plpgsql_check nie widzi).
  v_ids uuid[];
  v_an bigint;
  v_ag bigint;
  v_ac bigint;
  v_bn bigint;
  v_bg bigint;
  v_bc bigint;
  v_p double precision;
  v_se double precision;
  v_za double precision;
  v_zb double precision;
BEGIN
  IF v_until <= v_since THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT d.id, d.published_version_id INTO v_def FROM public.journey_definitions d
   WHERE d.id = p_journey_id AND d.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT v.graph INTO v_graph FROM public.journey_versions v
   WHERE v.journey_id = v_def.id AND v.tenant_id = v_tenant
     AND v.id = COALESCE(p_version_id, v_def.published_version_id);

  SELECT COALESCE(array_agg(e.id), '{}'::uuid[]) INTO v_ids FROM public.journey_enrollments e
   WHERE e.tenant_id = v_tenant AND e.journey_id = v_def.id AND NOT e.is_test
     AND (p_version_id IS NULL OR e.version_id = p_version_id)
     AND e.entered_at >= v_since AND e.entered_at <= v_until;

  -- ZMIANA (I9c-X2): okno siegajace dnia zapieczetowanego przez retencje -
  -- surowe zapisy i zdarzenia tych dni mogly juz zniknac, rollup jest pelny.
  v_rollup := v_until - v_since > interval '400 days' OR cardinality(v_ids) > 50000
    OR (v_since AT TIME ZONE 'UTC')::date <= public._data_retention_journey_sealed(v_tenant);

  SELECT jsonb_build_object(
    'enrolled', count(*),
    'active', count(*) FILTER (WHERE status = 'active'),
    'waiting', count(*) FILTER (WHERE status = 'waiting'),
    'completed', count(*) FILTER (WHERE status = 'completed'),
    'goal_reached', count(*) FILTER (WHERE status = 'goal_reached'),
    'failed', count(*) FILTER (WHERE status = 'failed'),
    'exited', COALESCE((SELECT jsonb_object_agg(x.exit_reason, x.n) FROM (
        SELECT j.exit_reason, count(*) AS n FROM public.journey_enrollments j
         WHERE j.tenant_id = v_tenant AND j.id = ANY (v_ids) AND j.status = 'exited'
         GROUP BY j.exit_reason) x), '{}'::jsonb),
    'goal_rate', CASE WHEN count(*) > 0
                      THEN round((count(*) FILTER (WHERE status = 'goal_reached'))::numeric / count(*), 4) END
  ) INTO v_journey FROM public.journey_enrollments
   WHERE tenant_id = v_tenant AND id = ANY (v_ids);

  IF v_rollup THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'node_id', r.node_id, 'type', public._journey_node(v_graph, r.node_id) ->> 'type',
      'entered', r.entered, 'succeeded', r.succeeded, 'skipped', r.skipped, 'failed', r.failed,
      'dead', r.dead, 'waiting_now', 0, 'outcomes', '{}'::jsonb,
      'email', CASE WHEN public._journey_node(v_graph, r.node_id) ->> 'type' = 'send_email' THEN jsonb_build_object(
        'queued', r.sent, 'sent', r.sent, 'suppressed', 0, 'bounced', r.bounced, 'complained', r.complained,
        'unique_opens', r.opens, 'unique_human_opens', r.human_opens, 'unique_clicks', r.clicks,
        'ctor', CASE WHEN r.human_opens > 0 THEN round(r.clicks::numeric / r.human_opens, 4) END,
        'unsubscribed', r.unsubs, 'fallback_locale', 0) END
    ) ORDER BY r.node_id), '[]'::jsonb) INTO v_nodes
    FROM (
      SELECT s.node_id, sum(s.entered) AS entered, sum(s.succeeded) AS succeeded, sum(s.skipped) AS skipped,
             sum(s.failed) AS failed, sum(s.dead) AS dead, sum(s.emails_sent) AS sent,
             sum(s.emails_bounced) AS bounced, sum(s.emails_complained) AS complained,
             sum(s.unique_opens) AS opens, sum(s.unique_human_opens) AS human_opens,
             sum(s.unique_clicks) AS clicks, sum(s.unsubscribes) AS unsubs
        FROM public.journey_node_daily_stats s
       WHERE s.tenant_id = v_tenant AND s.journey_id = v_def.id AND s.variant = '-'
         AND (p_version_id IS NULL OR s.version_id = p_version_id)
         AND s.day >= v_since::date AND s.day < v_until::date
       GROUP BY s.node_id
    ) r;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'node_id', n.node_id, 'type', n.node_type,
      'entered', n.entered, 'succeeded', n.succeeded, 'skipped', n.skipped, 'failed', n.failed,
      'dead', n.dead, 'waiting_now', n.waiting_now, 'outcomes', n.outcomes,
      'email', CASE WHEN n.node_type = 'send_email' THEN (
        SELECT jsonb_build_object(
          'queued', count(*),
          'sent', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.email_send_log l
                    WHERE l.message_id = m.message_id AND l.status = 'sent')),
          'suppressed', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.email_send_log l
                    WHERE l.message_id = m.message_id AND l.status = 'suppressed')),
          'bounced', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.email_send_log l
                    JOIN public.email_delivery_events de ON de.provider_message_id = l.provider_message_id
                    WHERE l.message_id = m.message_id AND de.kind = 'bounced')),
          'complained', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.email_send_log l
                    JOIN public.email_delivery_events de ON de.provider_message_id = l.provider_message_id
                    WHERE l.message_id = m.message_id AND de.kind = 'complained')),
          'unique_opens', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'open')),
          'unique_human_opens', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'open' AND NOT me.machine)),
          'unique_clicks', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'click')),
          'ctor', CASE WHEN count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'open' AND NOT me.machine)) > 0
                  THEN round((count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'click')))::numeric
                    / count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'open' AND NOT me.machine)), 4) END,
          'unsubscribed', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'unsubscribe')),
          'fallback_locale', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_step_runs sr
                    WHERE sr.enrollment_id = m.enrollment_id AND sr.node_id = m.node_id
                      AND (sr.detail ->> 'fallback_locale')::boolean))
        )
          FROM public.journey_messages m
         WHERE m.journey_id = v_def.id AND m.node_id = n.node_id
           AND m.tenant_id = v_tenant AND m.enrollment_id = ANY (v_ids)
      ) END
    ) ORDER BY n.node_id), '[]'::jsonb) INTO v_nodes
    FROM (
      SELECT sr.node_id, max(sr.node_type) AS node_type,
             count(*) AS entered,
             count(*) FILTER (WHERE sr.status = 'succeeded') AS succeeded,
             count(*) FILTER (WHERE sr.status = 'skipped') AS skipped,
             count(*) FILTER (WHERE sr.status = 'failed') AS failed,
             count(*) FILTER (WHERE sr.status = 'dead') AS dead,
             (SELECT count(*) FROM public.journey_enrollments j
               WHERE j.tenant_id = v_tenant AND j.id = ANY (v_ids)
                 AND j.current_node_id = sr.node_id AND j.status IN ('active', 'waiting')) AS waiting_now,
             COALESCE((SELECT jsonb_object_agg(o.outcome, o.n) FROM (
                SELECT sr2.outcome, count(*) AS n FROM public.journey_step_runs sr2
                 WHERE sr2.tenant_id = v_tenant AND sr2.enrollment_id = ANY (v_ids)
                   AND sr2.node_id = sr.node_id AND sr2.outcome IS NOT NULL
                 GROUP BY sr2.outcome) o), '{}'::jsonb) AS outcomes
        FROM public.journey_step_runs sr
       WHERE sr.tenant_id = v_tenant AND sr.enrollment_id = ANY (v_ids)
       GROUP BY sr.node_id
    ) n;
  END IF;

  -- Warianty A/B (ramiona podziału): wejścia, kliknięcia, cele, z.
  FOR v_ab IN SELECT n FROM jsonb_array_elements(COALESCE(v_graph -> 'nodes', '[]'::jsonb)) n
               WHERE n ->> 'type' = 'ab_split' LOOP
    v_metric := COALESCE(v_ab -> 'params' ->> 'winnerMetric', 'goal');
    SELECT count(*) AS n,
           count(*) FILTER (WHERE j.status = 'goal_reached') AS goals,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.journey_message_events me ON me.message_id = m.message_id AND me.kind = 'click'
             WHERE m.enrollment_id = j.id)) AS clicks
      INTO v_an, v_ag, v_ac
      FROM public.journey_enrollments j JOIN public.journey_step_runs sr ON sr.enrollment_id = j.id
     WHERE j.tenant_id = v_tenant AND j.id = ANY (v_ids)
       AND sr.node_id = v_ab ->> 'id' AND sr.outcome = 'A';
    SELECT count(*) AS n,
           count(*) FILTER (WHERE j.status = 'goal_reached') AS goals,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.journey_message_events me ON me.message_id = m.message_id AND me.kind = 'click'
             WHERE m.enrollment_id = j.id)) AS clicks
      INTO v_bn, v_bg, v_bc
      FROM public.journey_enrollments j JOIN public.journey_step_runs sr ON sr.enrollment_id = j.id
     WHERE j.tenant_id = v_tenant AND j.id = ANY (v_ids)
       AND sr.node_id = v_ab ->> 'id' AND sr.outcome = 'B';
    v_za := NULL;
    v_zb := NULL;
    IF v_an >= c_min_n AND v_bn >= c_min_n THEN
      -- Test dwóch proporcji (wspólna proporcja w błędzie standardowym).
      IF v_metric = 'click' THEN
        v_p := (v_ac + v_bc)::double precision / (v_an + v_bn);
      ELSE
        v_p := (v_ag + v_bg)::double precision / (v_an + v_bn);
      END IF;
      v_se := sqrt(v_p * (1 - v_p) * (1.0 / v_an + 1.0 / v_bn));
      IF v_se > 0 THEN
        IF v_metric = 'click' THEN
          v_za := ((v_ac::double precision / v_an) - (v_bc::double precision / v_bn)) / v_se;
        ELSE
          v_za := ((v_ag::double precision / v_an) - (v_bg::double precision / v_bn)) / v_se;
        END IF;
        v_zb := -v_za;
      END IF;
    END IF;
    v_variants := v_variants
      || jsonb_build_object('node_id', v_ab ->> 'id', 'variant', 'A', 'metric', v_metric, 'entered', v_an,
                            'unique_clicks', v_ac, 'goal_reached', v_ag,
                            'z', CASE WHEN v_za IS NOT NULL THEN round(v_za::numeric, 3) END)
      || jsonb_build_object('node_id', v_ab ->> 'id', 'variant', 'B', 'metric', v_metric, 'entered', v_bn,
                            'unique_clicks', v_bc, 'goal_reached', v_bg,
                            'z', CASE WHEN v_zb IS NOT NULL THEN round(v_zb::numeric, 3) END);
  END LOOP;

  RETURN jsonb_build_object('since', v_since, 'until', v_until, 'version_id', p_version_id,
                            'source', CASE WHEN v_rollup THEN 'rollup' ELSE 'raw' END,
                            'journey', v_journey, 'nodes', v_nodes, 'variants', v_variants);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_stats(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_stats(uuid, uuid, timestamptz, timestamptz) TO authenticated, service_role;
