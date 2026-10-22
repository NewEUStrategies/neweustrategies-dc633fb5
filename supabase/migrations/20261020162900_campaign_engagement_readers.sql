-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9, Z-I9c-05, Z-S7-07, Z-I9c-10): CZYTELNICY
-- ZDARZEŃ KAMPANII NEWSLETTERA PO RETENCJI - ARCHIWUM KAMPANII I DZIENNE
-- ZESTAWIENIE ZAMIAST SUROWYCH ZDARZEŃ.
--
-- DEFEKT
--   1. Z-I9c-05: retencja (I9c-X2, `_data_retention_fold_campaign_events`)
--      składa zdarzenia kampanii starsze niż okres kategorii do archiwum
--      kampanii (sumy bez wymiaru dnia) i usuwa surowe; wygaszanie
--      newslettera (I9d-Y1, `_newsletter_sunset_fold_events`) robi to samo
--      ze zdarzeniami usuwanego subskrybenta. Czytelnicy surowych zdarzeń
--      tracili wtedy historię:
--      * zdrowie poczty huba (`admin_revenue_email_health`, S1) - unikalne
--        otwarcia i kliknięcia kohorty liczone z par kampania-subskrybent
--        w surowych zdarzeniach;
--      * Kokpit (`admin_dashboard_marketing`, Z-S7-07) - otwarcia
--        i kliknięcia okna po dacie zdarzenia i tabela ostatnich kampanii;
--      * warstwa semantyczna (`analytics_semantic_snapshot`) - otwarcia,
--        kliknięcia i liczba kampanii okna.
--   2. Z-I9c-10: zasięg unikalny z archiwum (`newsletter_campaign_engagement`)
--      liczy odbiorcę drugi raz, gdy ten otworzy kampanię ponownie po
--      złożeniu jego starszych zdarzeń - wskaźnik mógł przekroczyć 100%.
--
-- ZMIANA
--   A. Tabela `newsletter_campaign_engagement_daily` (najemca, kampania,
--      dzień UTC -> otwarcia, kliknięcia) - BEZ subskrybenta i adresu
--      (minimalizacja); unikalnych nie da się sumować po dniach. RLS,
--      REVOKE dla klientów, zapis i odczyt tylko service_role / definery.
--   B. `_data_retention_fold_campaign_events` i `_newsletter_sunset_fold_events`
--      (I9) dokładają sumy dzienne w tej samej instrukcji co złożenie
--      i DELETE - zestawienie i surowe zdarzenia są rozłączne.
--   C. `_newsletter_engagement_daily_sum` (I9, internal) - suma dnia
--      z zestawienia dla okna (dzień liczy się, gdy jego początek UTC mieści
--      się w oknie; zdarzenia złożone są starsze niż okres retencji, więc
--      okna Kokpitu z ostatnich miesięcy go nie dotyczą).
--   D. `admin_revenue_email_health` (S1, rezerwa I9 - CIALO-Z niżej): zasięg
--      kampanii kohorty = pary z surowych + archiwum kampanii, przycięte do
--      liczności kohorty kampanii.
--   E. `admin_dashboard_marketing` (sprzed huba, CIALO-Z niżej, Z-S7-07):
--      otwarcia i kliknięcia okna = surowe + zestawienie dzienne; tabela
--      kampanii = surowe + archiwum.
--   F. `analytics_semantic_snapshot` (sprzed huba, CIALO-Z niżej): otwarcia,
--      kliknięcia i kampanie okna także z zestawienia; unikalni odbiorcy dni
--      sprzed progu zostają dolną granicą (runbook).
--   G. `newsletter_campaign_engagement` (I9 - druga redefinicja; CIALO-Z
--      z rejestru `HUB_CIALO_Z` = definicja sprzed huba, ciało z 161200):
--      zasięg unikalny przycięty do liczby odbiorców kampanii (`status =
--      'sent'`, wiersze zostają po redakcji); kampania bez wierszy odbiorców -
--      bez cięcia. `search_path` z `pg_temp`.
--   Scoring leadów (`compute_crm_lead_score`) ŚWIADOMIE czyta wyłącznie
--   surowe zdarzenia: dane o zachowaniu osoby mają zniknąć z retencją
--   (minimalizacja) - efektywny horyzont = min(horyzont, retencja), runbook.
--
-- careers-harness: exclude
-- HARNESS KARIERY: plik wspomina `public.contact_messages` (licznik
-- formularzy Kokpitu w przepisanym ciele `admin_dashboard_marketing`), ale
-- sięga do newslettera, płatności, reklam i analityki, których harness
-- celowo nie modeluje; dowód - pgTAP na komplecie migracji
-- (hub_i9_campaign_engagement_readers_test).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020162800; wymaga 20261020161000-161200
-- (archiwum i retencja I9c-X2) i 20261020162000 (wygaszanie I9d-Y1).
-- Kształty odpowiedzi RPC bez zmian - wdrożenie przed kodem i po nim jest
-- bezpieczne. Zdarzenia złożone PRZED tą migracją są tylko w archiwum
-- (bez dnia): tabela kampanii Kokpitu i zdrowie poczty je widzą, okna
-- dzienne Kokpitu i warstwy semantycznej - nie (nie da się ich odtworzyć).
-- IDEMPOTENTNA: CREATE TABLE/INDEX IF NOT EXISTS, ENABLE ROW LEVEL SECURITY,
-- CREATE OR REPLACE FUNCTION, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/hub_i9_campaign_engagement_readers_test.sql (okno
-- sprzed progu identyczne przed złożeniem i po nim: Kokpit - otwarcia,
-- kliknięcia, tabela kampanii; zdrowie poczty - zasięg; warstwa semantyczna
-- - otwarcia, kliknięcia, kampanie; zasięg kampanii 3 odbiorców po powrocie
-- <= 3; wygaszanie dokłada sumy dzienne; ACL tabeli i pomocnika).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Dzienne zestawienie zdarzeń kampanii złożonych przez retencję.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.newsletter_campaign_engagement_daily (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.newsletter_campaigns(id) ON DELETE CASCADE,
  day date NOT NULL,
  opens bigint NOT NULL DEFAULT 0 CHECK (opens >= 0),
  clicks bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, day)
);
CREATE INDEX IF NOT EXISTS newsletter_campaign_engagement_daily_tenant_day_idx
  ON public.newsletter_campaign_engagement_daily (tenant_id, day);

COMMENT ON TABLE public.newsletter_campaign_engagement_daily IS
  'Z-I9c-05 (I9): otwarcia i klikniecia kampanii per dzien UTC ze zdarzen zlozonych przez retencje i wygaszanie newslettera - bez subskrybenta i adresu. Czytaja definery Kokpitu i warstwy semantycznej.';

ALTER TABLE public.newsletter_campaign_engagement_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.newsletter_campaign_engagement_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.newsletter_campaign_engagement_daily TO service_role;

-- ----------------------------------------------------------------------------
-- B) Składanie zdarzeń: retencja i wygaszanie dokładają sumy dzienne.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020161100
CREATE OR REPLACE FUNCTION public._data_retention_fold_campaign_events(
  p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campaign uuid;
  v_total integer := 0;
  v_n integer;
BEGIN
  IF NOT p_execute THEN
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_total FROM (
      SELECT 1 FROM public.newsletter_campaign_events e
       WHERE e.tenant_id = p_tenant AND e.created_at < p_cutoff LIMIT p_limit) x;
    RETURN v_total;
  END IF;
  FOR v_campaign IN
    SELECT DISTINCT e.campaign_id FROM public.newsletter_campaign_events e
     WHERE e.tenant_id = p_tenant AND e.created_at < p_cutoff
  LOOP
    EXIT WHEN v_total >= p_limit;
    WITH old AS (
      SELECT e.id, e.kind, e.subscriber_id, e.created_at FROM public.newsletter_campaign_events e
       WHERE e.tenant_id = p_tenant AND e.campaign_id = v_campaign AND e.created_at < p_cutoff
       FOR UPDATE
    ), daily AS (
      -- Z-I9c-05 (I9): sumy dzienne bez identyfikatorów - okna kokpitu
      -- i warstwy semantycznej sprzed progu (archiwum nie ma wymiaru dnia).
      INSERT INTO public.newsletter_campaign_engagement_daily AS d (
        tenant_id, campaign_id, day, opens, clicks, updated_at)
      SELECT p_tenant, v_campaign, (o.created_at AT TIME ZONE 'UTC')::date,
             count(*) FILTER (WHERE o.kind = 'open'), count(*) FILTER (WHERE o.kind = 'click'), now()
        FROM old o
       GROUP BY (o.created_at AT TIME ZONE 'UTC')::date
      ON CONFLICT (campaign_id, day) DO UPDATE
         SET opens = d.opens + EXCLUDED.opens, clicks = d.clicks + EXCLUDED.clicks, updated_at = now()
      RETURNING 1
    ), stats AS (
      SELECT count(*) FILTER (WHERE o.kind = 'open') AS opens,
             count(*) FILTER (WHERE o.kind = 'click') AS clicks,
             count(DISTINCT o.subscriber_id) FILTER (WHERE o.kind = 'open' AND NOT EXISTS (
               SELECT 1 FROM public.newsletter_campaign_events r
                WHERE r.campaign_id = v_campaign AND r.kind = 'open'
                  AND r.subscriber_id = o.subscriber_id AND r.created_at >= p_cutoff)) AS uo,
             count(DISTINCT o.subscriber_id) FILTER (WHERE o.kind = 'click' AND NOT EXISTS (
               SELECT 1 FROM public.newsletter_campaign_events r
                WHERE r.campaign_id = v_campaign AND r.kind = 'click'
                  AND r.subscriber_id = o.subscriber_id AND r.created_at >= p_cutoff)) AS uc
        FROM old o
    ), fold AS (
      INSERT INTO public.newsletter_campaign_engagement_archive AS a (
        campaign_id, tenant_id, opens, clicks, unique_openers, unique_clickers, archived_before, updated_at)
      SELECT v_campaign, p_tenant, s.opens, s.clicks, s.uo, s.uc, p_cutoff, now() FROM stats s
      ON CONFLICT (campaign_id) DO UPDATE
         SET opens = a.opens + EXCLUDED.opens, clicks = a.clicks + EXCLUDED.clicks,
             unique_openers = a.unique_openers + EXCLUDED.unique_openers,
             unique_clickers = a.unique_clickers + EXCLUDED.unique_clickers,
             archived_before = GREATEST(a.archived_before, EXCLUDED.archived_before), updated_at = now()
      RETURNING 1
    )
    DELETE FROM public.newsletter_campaign_events e USING old WHERE e.id = old.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_fold_campaign_events(uuid, timestamptz, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;

-- CIALO-Z: 20261020162000
CREATE OR REPLACE FUNCTION public._newsletter_sunset_fold_events(p_tenant uuid, p_subscriber uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer := 0;
BEGIN
  WITH old AS (
    SELECT e.id, e.campaign_id, e.kind, e.created_at FROM public.newsletter_campaign_events e
     WHERE e.tenant_id = p_tenant AND e.subscriber_id = p_subscriber
     FOR UPDATE
  ), daily AS (
    -- Z-I9c-05 (I9): te same sumy dzienne co przy składaniu retencji -
    -- usunięcie subskrybenta nie zmienia otwarć i kliknięć dni w kokpicie.
    INSERT INTO public.newsletter_campaign_engagement_daily AS d (
      tenant_id, campaign_id, day, opens, clicks, updated_at)
    SELECT p_tenant, o.campaign_id, (o.created_at AT TIME ZONE 'UTC')::date,
           count(*) FILTER (WHERE o.kind = 'open'), count(*) FILTER (WHERE o.kind = 'click'), now()
      FROM old o
     GROUP BY o.campaign_id, (o.created_at AT TIME ZONE 'UTC')::date
    ON CONFLICT (campaign_id, day) DO UPDATE
       SET opens = d.opens + EXCLUDED.opens, clicks = d.clicks + EXCLUDED.clicks, updated_at = now()
    RETURNING 1
  ), stats AS (
    SELECT o.campaign_id,
           count(*) FILTER (WHERE o.kind = 'open') AS opens,
           count(*) FILTER (WHERE o.kind = 'click') AS clicks,
           (count(*) FILTER (WHERE o.kind = 'open') > 0)::integer AS uo,
           (count(*) FILTER (WHERE o.kind = 'click') > 0)::integer AS uc
      FROM old o GROUP BY o.campaign_id
  ), fold AS (
    INSERT INTO public.newsletter_campaign_engagement_archive AS a (
      campaign_id, tenant_id, opens, clicks, unique_openers, unique_clickers, updated_at)
    SELECT s.campaign_id, p_tenant, s.opens, s.clicks, s.uo, s.uc, now() FROM stats s
    ON CONFLICT (campaign_id) DO UPDATE
       SET opens = a.opens + EXCLUDED.opens, clicks = a.clicks + EXCLUDED.clicks,
           unique_openers = a.unique_openers + EXCLUDED.unique_openers,
           unique_clickers = a.unique_clickers + EXCLUDED.unique_clickers, updated_at = now()
    RETURNING 1
  )
  DELETE FROM public.newsletter_campaign_events e USING old WHERE e.id = old.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._newsletter_sunset_fold_events(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- C) Suma dnia z zestawienia dla okna.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._newsletter_engagement_daily_sum(
  p_tenant uuid,
  p_kind text,
  p_since timestamptz,
  p_until timestamptz,
  p_until_inclusive boolean
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Dzień liczy się, gdy jego początek UTC leży w oknie: [since, until)
  -- (Kokpit) albo [since, until] (warstwa semantyczna, okno domknięte).
  SELECT COALESCE(sum(CASE WHEN p_kind = 'open' THEN d.opens ELSE d.clicks END), 0)::bigint
    FROM public.newsletter_campaign_engagement_daily d
   WHERE d.tenant_id = p_tenant
     AND p_kind IN ('open', 'click')
     AND (d.day::timestamp AT TIME ZONE 'UTC') >= p_since
     AND ((d.day::timestamp AT TIME ZONE 'UTC') < p_until
          OR (p_until_inclusive AND (d.day::timestamp AT TIME ZONE 'UTC') = p_until))
$$;

REVOKE ALL ON FUNCTION public._newsletter_engagement_daily_sum(uuid, text, timestamptz, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- D) Zdrowie poczty huba (S1): zasięg kampanii z archiwum.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020100300
CREATE OR REPLACE FUNCTION public.admin_revenue_email_health(
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
  v_campaigns jsonb;
  v_list jsonb;
  v_doi jsonb;
BEGIN
  IF NOT public.is_admin_or_editor() THEN
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

  -- Kampanie: kohorta wysyłek z okna.
  WITH cohort AS (
    SELECT r.campaign_id, r.subscriber_id, r.sent_at, r.delivery_state, r.bounce_class,
           r.delivered_at, r.bounced_at, r.complained_at
      FROM public.newsletter_campaign_recipients r
     WHERE r.tenant_id = v_tenant
       AND r.status = 'sent'
       AND r.sent_at >= p_since
       AND r.sent_at < p_until
  ), delivery AS (
    SELECT
      count(*) AS sent,
      count(*) FILTER (
        WHERE delivery_state <> 'sent' OR delivered_at IS NOT NULL
           OR bounced_at IS NOT NULL OR complained_at IS NOT NULL) AS signalled,
      count(*) FILTER (
        WHERE delivered_at IS NOT NULL OR delivery_state IN ('delivered', 'complained')) AS delivered,
      count(*) FILTER (
        WHERE (bounced_at IS NOT NULL OR delivery_state = 'bounced')
          AND bounce_class IN ('hard', 'block')) AS hard_bounces,
      count(*) FILTER (
        WHERE (bounced_at IS NOT NULL OR delivery_state = 'bounced')
          AND (bounce_class IS NULL OR bounce_class IN ('soft', 'unknown'))) AS soft_bounces,
      count(*) FILTER (
        WHERE complained_at IS NOT NULL OR delivery_state = 'complained') AS complaints
    FROM cohort
  ), per_campaign AS (
    -- Para (kampania, subskrybent) = jeden odbiorca jednej kampanii; zdarzenia
    -- dopasowane po identyfikatorach z kohorty (kampanie najemcy), nie po
    -- `tenant_id` zdarzenia. Z-I9c-05 (I9): zdarzenia starsze niż okres
    -- retencji są już w archiwum kampanii (zasięg unikalny policzony przy
    -- składaniu), więc zasięg kampanii = pary z surowych + archiwum -
    -- przycięte do liczności kohorty kampanii (Z-I9c-10: powrót odbiorcy po
    -- złożeniu nie podbije wskaźnika ponad 100%).
    SELECT c.campaign_id,
      count(*) AS cohort_n,
      count(DISTINCT c.subscriber_id) FILTER (
        WHERE c.subscriber_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.newsletter_campaign_events e
           WHERE e.campaign_id = c.campaign_id AND e.subscriber_id = c.subscriber_id
             AND e.kind = 'open')) AS raw_opens,
      count(DISTINCT c.subscriber_id) FILTER (
        WHERE c.subscriber_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.newsletter_campaign_events e
           WHERE e.campaign_id = c.campaign_id AND e.subscriber_id = c.subscriber_id
             AND e.kind = 'click')) AS raw_clicks
    FROM cohort c
    GROUP BY c.campaign_id
  ), reach AS (
    SELECT
      COALESCE(sum(LEAST(p.raw_opens + COALESCE(a.unique_openers, 0), p.cohort_n)), 0) AS unique_opens,
      COALESCE(sum(LEAST(p.raw_clicks + COALESCE(a.unique_clickers, 0), p.cohort_n)), 0) AS unique_clicks
    FROM per_campaign p
    LEFT JOIN public.newsletter_campaign_engagement_archive a
      ON a.campaign_id = p.campaign_id AND a.tenant_id = v_tenant
  ), engagement AS (
    SELECT
      r.unique_opens,
      r.unique_clicks,
      (SELECT count(DISTINCT c.subscriber_id)
         FROM cohort c
         JOIN public.newsletter_subscribers s ON s.id = c.subscriber_id AND s.tenant_id = v_tenant
        WHERE s.unsubscribed_at >= c.sent_at
          AND s.unsubscribed_at < c.sent_at + interval '7 days') AS unsubscribes
    FROM reach r
  )
  SELECT jsonb_build_object(
    'sent', d.sent,
    'delivered', CASE WHEN d.sent > 0 AND d.signalled > 0 THEN d.delivered END,
    'unique_opens', CASE WHEN d.sent > 0 THEN e.unique_opens END,
    'unique_clicks', CASE WHEN d.sent > 0 THEN e.unique_clicks END,
    'hard_bounces', CASE WHEN d.sent > 0 AND d.signalled > 0 THEN d.hard_bounces END,
    'soft_bounces', CASE WHEN d.sent > 0 AND d.signalled > 0 THEN d.soft_bounces END,
    'complaints', CASE WHEN d.sent > 0 AND d.signalled > 0 THEN d.complaints END,
    'unsubscribes', CASE WHEN d.sent > 0 THEN e.unsubscribes END
  )
    INTO v_campaigns
    FROM delivery d CROSS JOIN engagement e;

  -- Lista: dołączenia i odejścia z bieżącego stanu wierszy.
  WITH joined AS (
    SELECT
      CASE WHEN s.confirmed_at IS NOT NULL THEN s.confirmed_at
           WHEN s.status <> 'pending' THEN s.created_at END AS joined_at,
      s.status, s.unsubscribed_at, s.updated_at
      FROM public.newsletter_subscribers s
     WHERE s.tenant_id = v_tenant
  ), life AS (
    SELECT j.joined_at,
           CASE WHEN j.status = 'unsubscribed'
                THEN GREATEST(COALESCE(j.unsubscribed_at, j.updated_at), j.joined_at) END AS left_at
      FROM joined j
     WHERE j.joined_at IS NOT NULL
  ), counts AS (
    SELECT
      count(*) FILTER (WHERE joined_at < p_since AND (left_at IS NULL OR left_at >= p_since)) AS list_start,
      count(*) FILTER (WHERE joined_at < p_until AND (left_at IS NULL OR left_at >= p_until)) AS list_end,
      count(*) FILTER (WHERE joined_at >= p_since AND joined_at < p_until) AS joined_in,
      count(*) FILTER (WHERE left_at >= p_since AND left_at < p_until) AS left_in
    FROM life
  )
  SELECT jsonb_build_object(
    'start', list_start,
    'end', list_end,
    'new', joined_in,
    'unsubscribed', left_in,
    'net_growth', list_end - list_start
  )
    INTO v_list
    FROM counts;

  -- Double opt-in: nowe adresy z okna, które przeszły potwierdzenie.
  SELECT jsonb_build_object(
    'started', count(*),
    'confirmed_7d', CASE WHEN count(*) > 0 THEN count(*) FILTER (
      WHERE s.confirmed_at IS NOT NULL AND s.confirmed_at < s.created_at + interval '7 days') END
  )
    INTO v_doi
    FROM public.newsletter_subscribers s
   WHERE s.tenant_id = v_tenant
     AND s.created_at >= p_since
     AND s.created_at < p_until
     AND (s.status = 'pending' OR s.confirmation_token IS NOT NULL OR s.confirmation_expires_at IS NOT NULL);

  RETURN jsonb_build_object(
    'since', p_since,
    'until', p_until,
    'campaigns', v_campaigns,
    'list', v_list,
    'doi', v_doi
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revenue_email_health(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revenue_email_health(timestamptz, timestamptz) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- E) Kokpit - marketing (Z-S7-07).
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20260912110000
CREATE OR REPLACE FUNCTION public.admin_dashboard_marketing(
  p_since timestamptz,
  p_until timestamptz,
  p_prev_since timestamptz,
  p_prev_until timestamptz,
  p_bucket text DEFAULT 'day',
  p_offset_minutes integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.admin_dashboard_tenant();
  v_bucket text := public.admin_dashboard_bucket(p_bucket);
  v_shift  interval := make_interval(mins => coalesce(p_offset_minutes, 0));
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Forbidden: admin or editor role required' USING ERRCODE = '42501';
  END IF;

  -- Z-I9c-05 / Z-S7-07 (I9): otwarcia i kliknięcia okna = zdarzenia surowe
  -- + dzienne zestawienie zdarzeń złożonych przez retencję (dzień liczy się,
  -- gdy jego początek UTC mieści się w oknie); tabela kampanii - surowe
  -- + archiwum kampanii.
  RETURN jsonb_build_object(
    'current', jsonb_build_object(
      'subscribed',   (SELECT count(*) FROM public.newsletter_subscribers s
                        WHERE s.tenant_id = v_tenant AND s.confirmed_at IS NOT NULL
                          AND s.confirmed_at >= p_since AND s.confirmed_at < p_until),
      'unsubscribed', (SELECT count(*) FROM public.newsletter_subscribers s
                        WHERE s.tenant_id = v_tenant AND s.unsubscribed_at IS NOT NULL
                          AND s.unsubscribed_at >= p_since AND s.unsubscribed_at < p_until),
      'sent',         (SELECT coalesce(sum(c.sent_count), 0) FROM public.newsletter_campaigns c
                        WHERE c.tenant_id = v_tenant AND c.finished_at IS NOT NULL
                          AND c.finished_at >= p_since AND c.finished_at < p_until),
      'opens',        (SELECT count(*) FROM public.newsletter_campaign_events e
                        WHERE e.tenant_id = v_tenant AND e.kind = 'open'
                          AND e.created_at >= p_since AND e.created_at < p_until)
                      + public._newsletter_engagement_daily_sum(v_tenant, 'open', p_since, p_until, false),
      'clicks',       (SELECT count(*) FROM public.newsletter_campaign_events e
                        WHERE e.tenant_id = v_tenant AND e.kind = 'click'
                          AND e.created_at >= p_since AND e.created_at < p_until)
                      + public._newsletter_engagement_daily_sum(v_tenant, 'click', p_since, p_until, false),
      'popupViews',   (SELECT count(*) FROM public.popup_events p
                        WHERE p.tenant_id = v_tenant AND p.kind = 'view'
                          AND p.created_at >= p_since AND p.created_at < p_until),
      'popupConversions', (SELECT count(*) FROM public.popup_events p
                        WHERE p.tenant_id = v_tenant AND p.kind = 'conversion'
                          AND p.created_at >= p_since AND p.created_at < p_until),
      'adImpressions',(SELECT count(*) FROM public.ad_events a
                        WHERE a.tenant_id = v_tenant AND a.kind = 'impression'
                          AND a.created_at >= p_since AND a.created_at < p_until),
      'adClicks',     (SELECT count(*) FROM public.ad_events a
                        WHERE a.tenant_id = v_tenant AND a.kind = 'click'
                          AND a.created_at >= p_since AND a.created_at < p_until),
      'orders',       (SELECT count(*) FROM public.payment_orders o
                        WHERE o.tenant_id = v_tenant AND o.paid_at IS NOT NULL
                          AND o.paid_at >= p_since AND o.paid_at < p_until),
      -- PIENIĄDZE ROZBITE PO WALUCIE, nie zsumowane w jedną liczbę.
      -- `payment_orders.currency` jest per zamówienie, więc `sum(amount_cents)`
      -- po całej tabeli dodaje złotówki do euro i daje wielkość, która nie jest
      -- kwotą w żadnej walucie. Panel wybiera z tej listy walutę wiodącą
      -- i mówi wprost, gdy są inne.
      'revenue', coalesce((
        SELECT jsonb_agg(row_to_json(r) ORDER BY r.cents DESC, r.currency)
          FROM (
            SELECT upper(coalesce(nullif(trim(o.currency), ''), 'PLN')) AS currency,
                   sum(o.amount_cents - coalesce(o.refunded_amount_cents, 0)) AS cents,
                   count(*) AS orders
              FROM public.payment_orders o
             WHERE o.tenant_id = v_tenant AND o.paid_at IS NOT NULL
               AND o.paid_at >= p_since AND o.paid_at < p_until
             GROUP BY 1
          ) r
      ), '[]'::jsonb),
      'donations', coalesce((
        SELECT jsonb_agg(row_to_json(r) ORDER BY r.cents DESC, r.currency)
          FROM (
            SELECT upper(coalesce(nullif(trim(d.currency), ''), 'PLN')) AS currency,
                   sum(d.amount_cents) AS cents,
                   count(*) AS orders
              FROM public.donations d
             WHERE d.tenant_id = v_tenant AND d.paid_at IS NOT NULL
               AND d.paid_at >= p_since AND d.paid_at < p_until
             GROUP BY 1
          ) r
      ), '[]'::jsonb),
      'leadForms',    (SELECT count(*) FROM public.contact_messages m
                        WHERE m.tenant_id = v_tenant
                          AND m.created_at >= p_since AND m.created_at < p_until)
    ),
    'previous', jsonb_build_object(
      'subscribed',   (SELECT count(*) FROM public.newsletter_subscribers s
                        WHERE s.tenant_id = v_tenant AND s.confirmed_at IS NOT NULL
                          AND s.confirmed_at >= p_prev_since AND s.confirmed_at < p_prev_until),
      'unsubscribed', (SELECT count(*) FROM public.newsletter_subscribers s
                        WHERE s.tenant_id = v_tenant AND s.unsubscribed_at IS NOT NULL
                          AND s.unsubscribed_at >= p_prev_since AND s.unsubscribed_at < p_prev_until),
      'sent',         (SELECT coalesce(sum(c.sent_count), 0) FROM public.newsletter_campaigns c
                        WHERE c.tenant_id = v_tenant AND c.finished_at IS NOT NULL
                          AND c.finished_at >= p_prev_since AND c.finished_at < p_prev_until),
      'opens',        (SELECT count(*) FROM public.newsletter_campaign_events e
                        WHERE e.tenant_id = v_tenant AND e.kind = 'open'
                          AND e.created_at >= p_prev_since AND e.created_at < p_prev_until)
                      + public._newsletter_engagement_daily_sum(v_tenant, 'open', p_prev_since, p_prev_until, false),
      'clicks',       (SELECT count(*) FROM public.newsletter_campaign_events e
                        WHERE e.tenant_id = v_tenant AND e.kind = 'click'
                          AND e.created_at >= p_prev_since AND e.created_at < p_prev_until)
                      + public._newsletter_engagement_daily_sum(v_tenant, 'click', p_prev_since, p_prev_until, false),
      'popupViews',   (SELECT count(*) FROM public.popup_events p
                        WHERE p.tenant_id = v_tenant AND p.kind = 'view'
                          AND p.created_at >= p_prev_since AND p.created_at < p_prev_until),
      'popupConversions', (SELECT count(*) FROM public.popup_events p
                        WHERE p.tenant_id = v_tenant AND p.kind = 'conversion'
                          AND p.created_at >= p_prev_since AND p.created_at < p_prev_until),
      'adImpressions',(SELECT count(*) FROM public.ad_events a
                        WHERE a.tenant_id = v_tenant AND a.kind = 'impression'
                          AND a.created_at >= p_prev_since AND a.created_at < p_prev_until),
      'adClicks',     (SELECT count(*) FROM public.ad_events a
                        WHERE a.tenant_id = v_tenant AND a.kind = 'click'
                          AND a.created_at >= p_prev_since AND a.created_at < p_prev_until),
      'orders',       (SELECT count(*) FROM public.payment_orders o
                        WHERE o.tenant_id = v_tenant AND o.paid_at IS NOT NULL
                          AND o.paid_at >= p_prev_since AND o.paid_at < p_prev_until),
      -- PIENIĄDZE ROZBITE PO WALUCIE, nie zsumowane w jedną liczbę.
      -- `payment_orders.currency` jest per zamówienie, więc `sum(amount_cents)`
      -- po całej tabeli dodaje złotówki do euro i daje wielkość, która nie jest
      -- kwotą w żadnej walucie. Panel wybiera z tej listy walutę wiodącą
      -- i mówi wprost, gdy są inne.
      'revenue', coalesce((
        SELECT jsonb_agg(row_to_json(r) ORDER BY r.cents DESC, r.currency)
          FROM (
            SELECT upper(coalesce(nullif(trim(o.currency), ''), 'PLN')) AS currency,
                   sum(o.amount_cents - coalesce(o.refunded_amount_cents, 0)) AS cents,
                   count(*) AS orders
              FROM public.payment_orders o
             WHERE o.tenant_id = v_tenant AND o.paid_at IS NOT NULL
               AND o.paid_at >= p_prev_since AND o.paid_at < p_prev_until
             GROUP BY 1
          ) r
      ), '[]'::jsonb),
      'donations', coalesce((
        SELECT jsonb_agg(row_to_json(r) ORDER BY r.cents DESC, r.currency)
          FROM (
            SELECT upper(coalesce(nullif(trim(d.currency), ''), 'PLN')) AS currency,
                   sum(d.amount_cents) AS cents,
                   count(*) AS orders
              FROM public.donations d
             WHERE d.tenant_id = v_tenant AND d.paid_at IS NOT NULL
               AND d.paid_at >= p_prev_since AND d.paid_at < p_prev_until
             GROUP BY 1
          ) r
      ), '[]'::jsonb),
      'leadForms',    (SELECT count(*) FROM public.contact_messages m
                        WHERE m.tenant_id = v_tenant
                          AND m.created_at >= p_prev_since AND m.created_at < p_prev_until)
    ),
    'series', coalesce((
      SELECT jsonb_agg(row_to_json(s) ORDER BY s.bucket)
        FROM (
          SELECT to_char(date_trunc(v_bucket, s.confirmed_at + v_shift), 'YYYY-MM-DD HH24:MI') AS bucket,
                 count(*) AS subscribed
            FROM public.newsletter_subscribers s
           WHERE s.tenant_id = v_tenant AND s.confirmed_at IS NOT NULL
             AND s.confirmed_at >= p_since AND s.confirmed_at < p_until
           GROUP BY 1
        ) s
    ), '[]'::jsonb),
    'campaigns', coalesce((
      SELECT jsonb_agg(row_to_json(c) ORDER BY c.finished_at DESC)
        FROM (
          SELECT c.name,
                 c.sent_count,
                 c.failed_count,
                 c.recipient_count,
                 to_char(c.finished_at + v_shift, 'YYYY-MM-DD HH24:MI') AS finished_at,
                 -- Z-I9c-05 / Z-S7-07 (I9): surowe + archiwum kampanii.
                 (SELECT count(*) FROM public.newsletter_campaign_events e
                   WHERE e.campaign_id = c.id AND e.kind = 'open')
                   + COALESCE((SELECT a.opens FROM public.newsletter_campaign_engagement_archive a
                                WHERE a.campaign_id = c.id AND a.tenant_id = v_tenant), 0) AS opens,
                 (SELECT count(*) FROM public.newsletter_campaign_events e
                   WHERE e.campaign_id = c.id AND e.kind = 'click')
                   + COALESCE((SELECT a.clicks FROM public.newsletter_campaign_engagement_archive a
                                WHERE a.campaign_id = c.id AND a.tenant_id = v_tenant), 0) AS clicks
            FROM public.newsletter_campaigns c
           WHERE c.tenant_id = v_tenant AND c.finished_at IS NOT NULL
             AND c.finished_at >= p_since AND c.finished_at < p_until
           ORDER BY c.finished_at DESC
           LIMIT 8
        ) c
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'subscribers', (SELECT count(*) FROM public.newsletter_subscribers s
                       WHERE s.tenant_id = v_tenant AND s.status = 'subscribed'),
      'pending',     (SELECT count(*) FROM public.newsletter_subscribers s
                       WHERE s.tenant_id = v_tenant AND s.status = 'pending')
    )
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_dashboard_marketing(timestamptz, timestamptz, timestamptz, timestamptz, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_marketing(timestamptz, timestamptz, timestamptz, timestamptz, text, integer) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- F) Warstwa semantyczna.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261003180000
CREATE OR REPLACE FUNCTION public.analytics_semantic_snapshot(
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
  v_tenant uuid := public.assert_admin_tenant();
  v_since  timestamptz := p_since;
  v_until  timestamptz := p_until;
  v_first_party jsonb;
  v_vitals jsonb;
  v_ads jsonb;
  v_newsletter jsonb;
  v_content jsonb;
BEGIN
  IF v_since IS NULL OR v_until IS NULL THEN
    RAISE EXCEPTION 'analytics_semantic_snapshot: since/until are required';
  END IF;
  IF v_since > v_until THEN
    RAISE EXCEPTION 'analytics_semantic_snapshot: since must not exceed until';
  END IF;

  SELECT jsonb_build_object(
    'events_total',   COUNT(*),
    'page_views',     COUNT(*) FILTER (WHERE event_type = 'page_view'),
    'entity_views',   COUNT(*) FILTER (WHERE event_type = 'view'),
    'cta_clicks',     COUNT(*) FILTER (WHERE event_type = 'cta_click'),
    'searches',       COUNT(*) FILTER (WHERE event_type = 'search'),
    'sessions',       COUNT(DISTINCT session_id) FILTER (WHERE session_id IS NOT NULL),
    'visitors',       COUNT(DISTINCT anon_id)    FILTER (WHERE anon_id IS NOT NULL),
    'signed_in_sessions', COUNT(DISTINCT session_id) FILTER (WHERE signed_in AND session_id IS NOT NULL)
  )
  INTO v_first_party
  FROM public.analytics_events
  WHERE tenant_id = v_tenant
    AND created_at >= v_since
    AND created_at <= v_until;

  SELECT jsonb_build_object(
    'samples', COALESCE(SUM(samples), 0),
    'metrics', COALESCE(jsonb_object_agg(metric, jsonb_build_object('p75', p75, 'samples', samples)), '{}'::jsonb)
  )
  INTO v_vitals
  FROM (
    SELECT
      metric,
      percentile_disc(0.75) WITHIN GROUP (ORDER BY value) AS p75,
      COUNT(*)::bigint AS samples
    FROM public.web_vitals
    WHERE tenant_id = v_tenant
      AND created_at >= v_since
      AND created_at <= v_until
    GROUP BY metric
  ) t;

  SELECT jsonb_build_object(
    'impressions', COUNT(*) FILTER (WHERE kind = 'impression'),
    'clicks',      COUNT(*) FILTER (WHERE kind = 'click')
  )
  INTO v_ads
  FROM public.ad_events
  WHERE tenant_id = v_tenant
    AND created_at >= v_since
    AND created_at <= v_until;

  -- Z-I9c-05 (I9): otwarcia, kliknięcia i kampanie także z dziennego
  -- zestawienia zdarzeń złożonych przez retencję (dzień liczy się, gdy jego
  -- początek UTC mieści się w oknie). Unikalnych odbiorców nie da się
  -- sumować po dniach - dla dni sprzed progu to dolna granica (runbook).
  SELECT jsonb_build_object(
    'opens',              COUNT(*) FILTER (WHERE kind = 'open')
                          + public._newsletter_engagement_daily_sum(v_tenant, 'open', v_since, v_until, true),
    'clicks',             COUNT(*) FILTER (WHERE kind = 'click')
                          + public._newsletter_engagement_daily_sum(v_tenant, 'click', v_since, v_until, true),
    'distinct_openers',   COUNT(DISTINCT subscriber_id) FILTER (WHERE kind = 'open'  AND subscriber_id IS NOT NULL),
    'distinct_clickers',  COUNT(DISTINCT subscriber_id) FILTER (WHERE kind = 'click' AND subscriber_id IS NOT NULL),
    'campaigns',          (SELECT COUNT(DISTINCT k.campaign_id) FROM (
                             SELECT e.campaign_id FROM public.newsletter_campaign_events e
                              WHERE e.tenant_id = v_tenant AND e.created_at >= v_since
                                AND e.created_at <= v_until
                             UNION
                             SELECT d.campaign_id FROM public.newsletter_campaign_engagement_daily d
                              WHERE d.tenant_id = v_tenant
                                AND (d.day::timestamp AT TIME ZONE 'UTC') >= v_since
                                AND (d.day::timestamp AT TIME ZONE 'UTC') <= v_until) k)
  )
  INTO v_newsletter
  FROM public.newsletter_campaign_events
  WHERE tenant_id = v_tenant
    AND created_at >= v_since
    AND created_at <= v_until;

  SELECT jsonb_build_object(
    'content_views',  (
      SELECT COUNT(*) FROM public.post_views pv
      WHERE pv.tenant_id = v_tenant AND pv.viewed_at >= v_since AND pv.viewed_at <= v_until
    ),
    'unique_viewers', (
      SELECT COUNT(DISTINCT pv.viewer_hash) FROM public.post_views pv
      WHERE pv.tenant_id = v_tenant AND pv.viewed_at >= v_since AND pv.viewed_at <= v_until
    ),
    'related_clicks', (
      SELECT COUNT(*) FROM public.related_post_clicks rc
      WHERE rc.tenant_id = v_tenant AND rc.clicked_at >= v_since AND rc.clicked_at <= v_until
    ),
    'reads', (
      SELECT COUNT(*) FROM public.user_read_history urh
      WHERE urh.tenant_id = v_tenant AND urh.read_at >= v_since AND urh.read_at <= v_until
    )
  )
  INTO v_content;

  RETURN jsonb_build_object(
    'window', jsonb_build_object('since', v_since, 'until', v_until),
    'first_party', COALESCE(v_first_party, '{}'::jsonb),
    'web_vitals',  COALESCE(v_vitals, '{}'::jsonb),
    'ad_events',   COALESCE(v_ads, '{}'::jsonb),
    'newsletter',  COALESCE(v_newsletter, '{}'::jsonb),
    'content_views', COALESCE(v_content, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_semantic_snapshot(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_semantic_snapshot(timestamptz, timestamptz)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- G) Zaangażowanie kampanii: zasięg przycięty do liczby odbiorców (Z-I9c-10).
-- ----------------------------------------------------------------------------
-- Ciało z 20261020161200 (I9c-X2); znacznik niesie wartość rejestru
-- `HUB_CIALO_Z` (definicja sprzed huba) - bramka dostawy wymaga jej dla
-- funkcji sprzed huba należącej do I9.
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
SET search_path = public, pg_temp
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
  -- Z-I9c-10 (I9): zasięg unikalny przycięty do liczby odbiorców kampanii
  -- (wiersze odbiorców zostają po redakcji): odbiorca z otwarciem przed
  -- progiem i ponownym po złożeniu liczy się raz w archiwum i raz
  -- w surowych - różnica jest marginalna, ale bez przycięcia wskaźnik
  -- mógłby przekroczyć 100%. Kampania bez wierszy odbiorców - bez cięcia.
  RETURN QUERY
  SELECT
    raw.opens + COALESCE(a.opens, 0),
    raw.clicks + COALESCE(a.clicks, 0),
    LEAST(raw.unique_openers + COALESCE(a.unique_openers, 0),
          COALESCE(NULLIF(rcp.n, 0), raw.unique_openers + COALESCE(a.unique_openers, 0))),
    LEAST(raw.unique_clickers + COALESCE(a.unique_clickers, 0),
          COALESCE(NULLIF(rcp.n, 0), raw.unique_clickers + COALESCE(a.unique_clickers, 0)))
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
    ON a.campaign_id = p_campaign AND a.tenant_id = v_tenant
  CROSS JOIN (
    SELECT count(*)::bigint AS n FROM public.newsletter_campaign_recipients r
     WHERE r.campaign_id = p_campaign AND r.tenant_id = v_tenant AND r.status = 'sent'
  ) rcp;
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_campaign_engagement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.newsletter_campaign_engagement(uuid) TO authenticated, service_role;
