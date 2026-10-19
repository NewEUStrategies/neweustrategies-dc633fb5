-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S3, 5/5): AGREGATY LEJKA I INWENTARZA DOSTĘPU -
-- `_funnel_counts`, `admin_revenue_funnel`, `admin_revenue_access_inventory`.
--
-- DEFEKT
--   1. Panel nie ma lejka czytelnika. `/admin/monetization` liczy zamówienia
--      i odmowy licznika osobno, bez wspólnego mianownika i bez okna
--      wspólnego z pulpitem; wskaźniki lejka z rejestru S6 (R2P, PHR, PSCR,
--      CCR, CAR, SFCR, wykorzystanie kuponów) nie mają źródła, więc migawka
--      huba pokazuje „źródło niepodłączone" (Z-S6-16).
--   2. Brak inwentarza treści płatnej (DIAGNOZA §1.1): `content_access`
--      czytają wyłącznie edytor wpisu i lista wyjątków (limit 200, tylko
--      `!= inherit`). Nikt nie widzi, ile treści stoi za którą warstwą, ile
--      reguł prowadzi w ślepy zaułek (P14: próg warstwy bez planu w sprzedaży,
--      treść płatna bez żadnej oferty) i ile reguł wskazuje plany wycofane.
--
-- ZMIANA (rejestr S3 w `src/lib/ci/hubDelivery.ts`)
--   A. `_funnel_counts(p_tenant, p_since, p_until, p_segment)` - wewnętrzny
--      (bez EXECUTE dla ról API, może przyjąć najemcę). Jeden przebieg po
--      źródłach okna `[p_since, p_until)`; kształt płaski = kontrakt
--      `REVENUE_FUNNEL_KEYS` (S6, `revenueRaw.ts`, Z-S6-05) + pola huba:
--        * `accounts` - konta założone w oknie (`profiles.created_at`);
--        * `active_accounts` - konta aktywne w oknie: założone, zalogowane
--          (`auth.users.last_sign_in_at`), z odczytem licznika, uderzeniem
--          w paywall albo opłaconym zamówieniem w oknie (suma zbiorów -
--          konto uderzające w paywall jest zawsze aktywne, więc PHR <= 1);
--        * `paywall_hit_accounts`, `paywall_hit_visitors`, `paywall_hits` -
--          wiersze `paywall_hits` przecinające okno (`first_at < until AND
--          last_at >= since`); `paywall_converted_accounts` - konta, które po
--          PIERWSZYM uderzeniu w oknie opłaciły zamówienie przed końcem okna;
--        * kasa - zamówienia `live`, nie `mock`, bez biletów wydarzeń
--          (`metadata.event_id`), założone w oknie: `checkout_started`,
--          `checkout_paid` (opłacone kiedykolwiek - kohorta startu),
--          `checkout_abandoned` = started - paid (CAR = 1 - CCR na TEJ SAMEJ
--          populacji, pgTAP), `checkout_expired` (wygasła sesja);
--        * `first_payments` - pierwsza płatność konta w historii najemcy
--          wypadła w oknie; `registered_paid` - konta z okna, które zapłaciły
--          przed jego końcem;
--        * `signup_form_views`/`signup_form_submits` - `newsletter_popup_events`
--          (`open`/`success`); `visitors_first_party` - unikalne `anon_id`
--          odsłon (strumień zgody analitycznej, osobny - nigdy mianownik);
--        * ułamki w [0, 1] zaokrąglone do 6 miejsc, `null` przy zerowym
--          mianowniku (`null` ≠ 0); `checkout_abandonment_rate` liczony jako
--          `1 - checkout_conversion_rate` (suma = 1 bez dryfu zaokrągleń);
--        * `coupon_redemption_rate` - kody kampanii `sent` ważnych w oknie
--          użyte w opłaconym zamówieniu ÷ kody wydane;
--        * `paid_amount` - `[{currency, amount_minor}]` opłaconych zamówień
--          kohorty (kwoty NIGDY nie są sumowane między walutami);
--        * `signup_sources` - źródła rejestracji kont z okna (ta sama biała
--          lista co `account.registered.v1`), `paywall_reasons` - powody
--          uderzeń; `paywall_data_since` - pierwszy pomiar paywalla najemcy.
--      Segment (`all | b2c_individual | b2c_reduced | b2b_institution`) to
--      `revenue_segment_of_tier(access_plans.tier_key)` zamówienia - zawęża
--      LICZNIKI zakupów (kasa, płacący, konwersje), mianowniki kont zostają
--      całe („ilu zarejestrowanych kupiło segment X").
--   B. `admin_revenue_funnel(p_since, p_until, p_segment, p_track)` - RPC
--      panelu: najemca z sesji (`current_tenant_id()`), bramka
--      `is_admin_or_editor()` (42501), kwoty tylko dla admina (`paid_amount`
--      = NULL dla editora, `amounts_visible`), okno <= 400 dni (22023
--      `window_invalid`), segment i tor z dziedziny (22023). Tor
--      `self_serve` = A; `sales` = historia etapów cyklu życia
--      (`crm_lead_stage_history`, wymiar `lifecycle`) - leady, które w oknie
--      weszły w `lead`, `mql`, `sql`, `opportunity`, `customer` - oraz zadania
--      CRM BEZ anulowanych (D11: `open`, `overdue`, `done_in_window`); `all`
--      = oba. Tor `sales` wymaga aal2 po stronie server fn (`requireCrmStaff`).
--   C. `admin_revenue_access_inventory()` - RPC panelu (admin|editor, bez
--      kwot): liczności `content_access` per typ × tryb × `min_tier_rank` ×
--      polityka licznika, sumy per tryb, warstwy z informacją, czy da się je
--      dziś kupić, ślepe zaułki P14 (`tier_without_offer`,
--      `paid_without_offer`), reguły z planami spoza sprzedaży
--      (`dangling_plans`), reguły z progiem objęte licznikiem
--      (`metered_tier_gated` - P19 wyłącza z nich licznik) i powody uderzeń
--      z ostatnich 30 dni.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020090100 (`paywall_hits`), 20261020090200
-- (`crm_lead_stage_history`, `crm_tasks.source`) i 20261020090500
-- (`revenue_segment_of_tier`). Kod woła RPC literałem przez `RpcCallable`;
-- przed wdrożeniem dostaje PGRST202/42883 i pokazuje stan „źródło jeszcze
-- niewdrożone", nie błąd.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowe sygnatury), bezstanowe
-- REVOKE/GRANT. Zero DDL.
-- DOWÓD: supabase/tests/revenue_funnel_access_test.sql (dwóch najemców,
-- CCR + CAR = 1 na tej samej populacji, editor bez kwot, autor 42501, tor
-- `sales` bez zadań anulowanych, inwentarz = liczności per tryb × próg ×
-- polityka, P14 policzone, kształt `-- rpc-shape`); kontrakt TS:
-- src/lib/revenue/funnel/__tests__/parse.test.ts,
-- src/lib/revenue/access/__tests__/parse.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Liczniki lejka samoobsługowego (wewnętrzny).
-- ----------------------------------------------------------------------------
-- rpc-shape: admin_revenue_funnel (klucze płaskie: accounts, active_accounts,
-- paywall_hit_accounts, paywall_hit_visitors, paywall_hits,
-- paywall_converted_accounts, checkout_started, checkout_paid,
-- checkout_abandoned, checkout_expired, first_payments, registered_paid,
-- signup_form_views, signup_form_submits, visitors_first_party,
-- registered_to_paid_rate, paywall_conversion_rate, paywall_hit_rate,
-- checkout_conversion_rate, checkout_abandonment_rate, coupon_redemption_rate,
-- paid_amount, signup_sources, paywall_reasons, paywall_data_since)
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
BEGIN
  IF p_tenant IS NULL OR p_since IS NULL OR p_until IS NULL OR p_until <= p_since THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;

  -- Konta założone w oknie.
  SELECT count(*) INTO v_accounts
    FROM public.profiles p
   WHERE p.tenant_id = p_tenant AND p.created_at >= p_since AND p.created_at < p_until;

  -- Uderzenia w paywall przecinające okno.
  SELECT count(DISTINCT ph.user_id), count(DISTINCT ph.visitor_hash), COALESCE(sum(ph.hits), 0)
    INTO v_hit_accounts, v_hit_visitors, v_hits
    FROM public.paywall_hits ph
   WHERE ph.tenant_id = p_tenant AND ph.first_at < p_until AND ph.last_at >= p_since;

  SELECT min(ph.first_at) INTO v_data_since
    FROM public.paywall_hits ph WHERE ph.tenant_id = p_tenant;

  -- Konta aktywne: suma zbiorów sygnałów aktywności w oknie.
  SELECT count(*) INTO v_active FROM (
    SELECT p.id AS uid
      FROM public.profiles p
      LEFT JOIN auth.users u ON u.id = p.id
     WHERE p.tenant_id = p_tenant
       AND p.created_at < p_until
       AND ((p.created_at >= p_since)
            OR (u.last_sign_in_at >= p_since AND u.last_sign_in_at < p_until))
    UNION
    SELECT ph.user_id FROM public.paywall_hits ph
     WHERE ph.tenant_id = p_tenant AND ph.user_id IS NOT NULL
       AND ph.first_at < p_until AND ph.last_at >= p_since
    UNION
    SELECT mv.user_id FROM public.metered_views mv
     WHERE mv.tenant_id = p_tenant AND mv.user_id IS NOT NULL
       AND mv.created_at >= p_since AND mv.created_at < p_until
    UNION
    SELECT o.user_id FROM public.payment_orders o
     WHERE o.tenant_id = p_tenant AND o.user_id IS NOT NULL
       AND o.paid_at >= p_since AND o.paid_at < p_until
  ) a WHERE a.uid IS NOT NULL;

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
  -- konwersji rejestracji i konwersji paywalla.
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
    (SELECT count(*) FROM (
        SELECT ph.user_id, min(ph.first_at) AS hit_at
          FROM public.paywall_hits ph
         WHERE ph.tenant_id = p_tenant AND ph.user_id IS NOT NULL
           AND ph.first_at < p_until AND ph.last_at >= p_since
         GROUP BY ph.user_id
      ) h
      WHERE EXISTS (
        SELECT 1 FROM paid x
         WHERE x.user_id = h.user_id AND x.paid_at >= h.hit_at AND x.paid_at < p_until
      ))
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'reason', r.reason, 'accounts', r.accounts, 'visitors', r.visitors, 'hits', r.hits
         ) ORDER BY r.hits DESC, r.reason), '[]'::jsonb)
    INTO v_reasons
    FROM (
      SELECT ph.reason,
             count(DISTINCT ph.user_id) AS accounts,
             count(DISTINCT ph.visitor_hash) AS visitors,
             sum(ph.hits)::bigint AS hits
        FROM public.paywall_hits ph
       WHERE ph.tenant_id = p_tenant AND ph.first_at < p_until AND ph.last_at >= p_since
       GROUP BY ph.reason
    ) r;

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
  'Hub S3: liczniki lejka samoobsługowego najemcy w oknie [since, until) - kształt REVENUE_FUNNEL_KEYS (S6) + pola huba; segment zawęża liczniki zakupów. Wewnętrzny: bez EXECUTE dla ról API.';

-- ----------------------------------------------------------------------------
-- B) RPC lejka dla panelu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_funnel(
  p_since timestamptz,
  p_until timestamptz,
  p_segment text DEFAULT 'all',
  p_track text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_admin boolean;
  v_segment text := COALESCE(p_segment, 'all');
  v_track text := COALESCE(p_track, 'all');
  v_out jsonb;
  v_sales jsonb := NULL;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin_or_editor() THEN
    RAISE EXCEPTION 'forbidden: admin or editor role required' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: caller has no tenant' USING ERRCODE = '42501';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until <= p_since
     OR p_until - p_since > interval '400 days' THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_segment NOT IN ('all', 'b2c_individual', 'b2c_reduced', 'b2b_institution') THEN
    RAISE EXCEPTION 'segment_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_track NOT IN ('self_serve', 'sales', 'all') THEN
    RAISE EXCEPTION 'track_invalid' USING ERRCODE = '22023';
  END IF;
  v_admin := public.has_role(v_uid, 'admin'::app_role);

  v_out := jsonb_build_object(
    'since', p_since,
    'until', p_until,
    'segment', v_segment,
    'track', v_track,
    'amounts_visible', v_admin
  );

  IF v_track IN ('self_serve', 'all') THEN
    v_out := v_out || public._funnel_counts(v_tenant, p_since, p_until, v_segment);
    -- Kwoty wyłącznie dla admina; editor dostaje NULL (nie zero - „nie
    -- pokazujemy", a nie „nic nie zapłacono").
    IF NOT v_admin THEN
      v_out := v_out || jsonb_build_object('paid_amount', NULL);
    END IF;
  END IF;

  IF v_track IN ('sales', 'all') THEN
    SELECT jsonb_build_object(
      'stages', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('stage', st.stage, 'leads', COALESCE(c.n, 0))
                         ORDER BY st.ord)
          FROM (VALUES ('lead', 1), ('mql', 2), ('sql', 3), ('opportunity', 4), ('customer', 5))
                 AS st(stage, ord)
          LEFT JOIN (
            SELECT h.to_value, count(DISTINCT h.lead_id) AS n
              FROM public.crm_lead_stage_history h
             WHERE h.tenant_id = v_tenant AND h.dimension = 'lifecycle'
               AND h.changed_at >= p_since AND h.changed_at < p_until
             GROUP BY h.to_value
          ) c ON c.to_value = st.stage
      ), '[]'::jsonb),
      -- D11: zadania anulowane nie są pracą do zrobienia ani zrobioną.
      'open_tasks', (SELECT count(*) FROM public.crm_tasks t
                      WHERE t.tenant_id = v_tenant AND t.status = 'open'),
      'overdue_tasks', (SELECT count(*) FROM public.crm_tasks t
                         WHERE t.tenant_id = v_tenant AND t.status = 'open' AND t.due_at < now()),
      'done_tasks', (SELECT count(*) FROM public.crm_tasks t
                      WHERE t.tenant_id = v_tenant AND t.status = 'done'
                        AND t.completed_at >= p_since AND t.completed_at < p_until)
    ) INTO v_sales;
  END IF;

  RETURN v_out || jsonb_build_object('sales', v_sales);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revenue_funnel(timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revenue_funnel(timestamptz, timestamptz, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_revenue_funnel(timestamptz, timestamptz, text, text) IS
  'Hub S3: lejek czytelnika [since, until) - tor self_serve (_funnel_counts), sales (historia etapów cyklu życia + zadania bez anulowanych, D11) albo oba; najemca z sesji, admin|editor (42501), kwoty tylko admin (paid_amount NULL dla editora), okno <= 400 dni.';

-- ----------------------------------------------------------------------------
-- C) Inwentarz dostępu dla panelu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_access_inventory()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_rows jsonb;
  v_by_mode jsonb;
  v_tiers jsonb;
  v_dead jsonb;
  v_hits jsonb;
  v_total bigint;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin_or_editor() THEN
    RAISE EXCEPTION 'forbidden: admin or editor role required' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: caller has no tenant' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total FROM public.content_access ca WHERE ca.tenant_id = v_tenant;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'entity_type', r.entity_type, 'mode', r.mode, 'min_tier_rank', r.min_tier_rank,
           'metering_policy', r.metering_policy, 'count', r.n
         ) ORDER BY r.entity_type, r.mode, r.min_tier_rank, r.metering_policy), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT ca.entity_type::text AS entity_type, ca.mode::text AS mode,
             COALESCE(ca.min_tier_rank, 0) AS min_tier_rank,
             COALESCE(ca.metering_policy, 'inherit') AS metering_policy,
             count(*) AS n
        FROM public.content_access ca
       WHERE ca.tenant_id = v_tenant
       GROUP BY 1, 2, 3, 4
    ) r;

  SELECT jsonb_build_object(
           'public', count(*) FILTER (WHERE ca.mode = 'public'),
           'members', count(*) FILTER (WHERE ca.mode = 'members'),
           'paid', count(*) FILTER (WHERE ca.mode = 'paid'),
           'password', count(*) FILTER (WHERE ca.mode = 'password'))
    INTO v_by_mode
    FROM public.content_access ca WHERE ca.tenant_id = v_tenant;

  -- Warstwa jest „do kupienia", gdy ma aktywny plan w sprzedaży, nie jest
  -- schowana z cennika i ma przycisk kasy (`cta_mode = 'auto'`; `contact` =
  -- wyłącznie na zapytanie, `none` = warstwa zamknięta - `tierCtaMode`).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', mt.key, 'rank', mt.rank, 'active', mt.active,
           'pricing_visible', COALESCE(mt.pricing_visible, true),
           'cta_mode', mt.cta_mode,
           'offerable', mt.active AND COALESCE(mt.pricing_visible, true)
                        AND COALESCE(mt.cta_mode, 'auto') = 'auto'
                        AND EXISTS (
                          SELECT 1 FROM public.access_plans ap
                           WHERE ap.tenant_id = v_tenant AND ap.tier_key = mt.key
                             AND ap.active AND ap.for_sale IS DISTINCT FROM false)
         ) ORDER BY mt.rank, mt.key), '[]'::jsonb)
    INTO v_tiers
    FROM public.membership_tiers mt WHERE mt.tenant_id = v_tenant;

  WITH offer AS (
    -- Ranga, którą da się dziś kupić planem w sprzedaży.
    SELECT mt.rank
      FROM public.access_plans ap
      JOIN public.membership_tiers mt ON mt.tenant_id = ap.tenant_id AND mt.key = ap.tier_key
     WHERE ap.tenant_id = v_tenant AND ap.active AND ap.for_sale IS DISTINCT FROM false
       AND mt.active AND COALESCE(mt.pricing_visible, true)
       AND COALESCE(mt.cta_mode, 'auto') = 'auto'
  ), premium AS (
    SELECT 1
      FROM public.access_plans ap
      JOIN public.membership_tiers mt ON mt.tenant_id = ap.tenant_id AND mt.key = ap.tier_key
     WHERE ap.tenant_id = v_tenant AND ap.active AND ap.for_sale IS DISTINCT FROM false
       AND mt.active AND (mt.features ->> 'premium_content')::boolean IS TRUE
     LIMIT 1
  ), gated AS (
    SELECT ca.* FROM public.content_access ca
     WHERE ca.tenant_id = v_tenant AND ca.mode IN ('members', 'paid')
  )
  SELECT jsonb_build_object(
    -- P14: próg warstwy, której nie da się kupić - zalogowany za nisko nie ma
    -- żadnej oferty (ślepy zaułek).
    'tier_without_offer', (SELECT count(*) FROM gated g
                            WHERE COALESCE(g.min_tier_rank, 0) > 0
                              AND NOT EXISTS (SELECT 1 FROM offer o WHERE o.rank >= g.min_tier_rank)),
    -- P14: treść płatna bez progu, bez ceny jednorazowej, bez planu z reguły
    -- w sprzedaży i bez planu z flagą premium_content - nic nie da się kupić.
    'paid_without_offer', (SELECT count(*) FROM gated g
                            WHERE g.mode = 'paid' AND COALESCE(g.min_tier_rank, 0) = 0
                              AND COALESCE(g.one_time_price_cents, 0) <= 0
                              AND NOT EXISTS (
                                SELECT 1 FROM public.access_plans ap
                                 WHERE ap.id = ANY (g.plan_ids) AND ap.tenant_id = v_tenant
                                   AND ap.active AND ap.for_sale IS DISTINCT FROM false)
                              AND NOT EXISTS (SELECT 1 FROM premium)),
    -- Reguły wskazujące plan nieaktywny, wycofany albo usunięty.
    'dangling_plans', (SELECT count(*) FROM public.content_access ca
                        WHERE ca.tenant_id = v_tenant
                          AND EXISTS (
                            SELECT 1 FROM unnest(ca.plan_ids) AS pid
                             WHERE NOT EXISTS (
                               SELECT 1 FROM public.access_plans ap
                                WHERE ap.id = pid AND ap.tenant_id = v_tenant
                                  AND ap.active AND ap.for_sale IS DISTINCT FROM false))),
    -- Treści z progiem objęte licznikiem - P19 wyłącza z nich licznik.
    'metered_tier_gated', (SELECT count(*) FROM gated g
                            WHERE COALESCE(g.min_tier_rank, 0) > 0
                              AND COALESCE(g.metering_policy, 'inherit') <> 'exempt')
  ) INTO v_dead;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'reason', r.reason, 'accounts', r.accounts, 'visitors', r.visitors, 'hits', r.hits
         ) ORDER BY r.hits DESC, r.reason), '[]'::jsonb)
    INTO v_hits
    FROM (
      SELECT ph.reason,
             count(DISTINCT ph.user_id) AS accounts,
             count(DISTINCT ph.visitor_hash) AS visitors,
             sum(ph.hits)::bigint AS hits
        FROM public.paywall_hits ph
       WHERE ph.tenant_id = v_tenant AND ph.last_at >= now() - interval '30 days'
       GROUP BY ph.reason
    ) r;

  RETURN jsonb_build_object(
    'computed_at', now(),
    'total', v_total,
    'rows', v_rows,
    'by_mode', v_by_mode,
    'tiers', v_tiers,
    'dead_ends', v_dead,
    'hits_30d', v_hits
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revenue_access_inventory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revenue_access_inventory() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_revenue_access_inventory() IS
  'Hub S3: inwentarz content_access najemcy z sesji (typ × tryb × min_tier_rank × polityka licznika), warstwy do kupienia, ślepe zaułki P14, plany spoza sprzedaży, P19 i powody uderzeń z 30 dni. Admin|editor (42501), bez kwot.';
