-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S1, 4/5): AGREGAT ZDROWIA E-MAIL DLA HUBA
-- (`admin_revenue_email_health`).
--
-- DEFEKT
--   Hub nie ma jednego, uczciwego odczytu kondycji kanału e-mail. Panel
--   newslettera liczy wskaźniki per kampania w przeglądarce (z limitem
--   wierszy PostgREST), otwarcia jako ZDARZENIA (jeden odbiorca = wiele
--   otwarć, więc wskaźnik potrafił przekroczyć 100%), a brak sygnału od
--   dostawcy (webhooki niepodpięte) wyglądał jak „0 odbić" - zero udawało
--   wynik.
--
-- ZMIANA
--   RPC `admin_revenue_email_health(p_since, p_until) RETURNS jsonb` (panel;
--   bramka `is_admin_or_editor()` - autor 42501; najemca `current_tenant_id()`;
--   BEZ kwot, więc editor dostaje pełny wynik). Okno `[p_since, p_until)`,
--   `p_until > p_since`, najwyżej 400 dni (`REVENUE_CUSTOM_COMPARE_MAX_DAYS`),
--   inaczej 22023 `window_invalid`. Kształt (`-- rpc-shape` w
--   src/lib/revenue/email/parse.ts):
--     {since, until,
--      campaigns: {sent, delivered, unique_opens, unique_clicks, hard_bounces,
--                  soft_bounces, complaints, unsubscribes},
--      list: {start, end, new, unsubscribed, net_growth},
--      doi: {started, confirmed_7d}}
--   Liczby całkowite >= 0; `null` = NIE DA SIĘ policzyć (nigdy 0 udające wynik).
--
--   RZECZYWISTE WARTOŚCI KOLUMN (CHECK-i w bazie, stan na 2026-10-19):
--     * `newsletter_campaign_recipients.status`: pending | sent | failed |
--       skipped | suppressed - `sent_at` ustawia się wyłącznie przy `sent`;
--     * `newsletter_campaign_recipients.delivery_state`: pending | sent |
--       delivered | delayed | bounced | complained | failed | skipped |
--       suppressed - po wysyłce `sent`, dalej przestawia go webhook dostawcy
--       (`email_apply_delivery_event`, razem z `delivered_at`, `bounced_at`,
--       `complained_at`);
--     * `newsletter_campaign_recipients.bounce_class`: NULL | hard | soft |
--       block | unknown;
--     * `newsletter_campaign_events.kind`: open | click (dedup: jeden wiersz
--       na odbiorcę, kampanię, rodzaj i dobę UTC; wypisów tu NIE ma);
--     * `newsletter_subscribers.status`: pending | subscribed | unsubscribed.
--
--   DEFINICJE:
--     KOHORTA KAMPANII = wiersze odbiorców `status = 'sent'` z `sent_at` w oknie.
--     * `sent` - liczność kohorty (0 jest prawdziwym wynikiem).
--     * Gdy kohorta jest pusta, pozostałe pola `campaigns` = null (nie ma
--       mianownika - wskaźnik z zera wysyłek nie istnieje).
--     * `delivered`, `hard_bounces`, `soft_bounces`, `complaints` = null także
--       wtedy, gdy ŻADEN wiersz kohorty nie dostał sygnału dostawcy (stan
--       inny niż `sent` albo któryś ze znaczników czasu) - to znaczy, że
--       webhooki nie działają, a nie że nic nie odbiło.
--       `delivered` = `delivered_at` albo stan `delivered|complained` (skarga
--       przychodzi po doręczeniu); twarde = odbicie z klasą `hard|block`
--       (odrzucenie trwałe, `block` trafia na listę wykluczeń jak `hard`);
--       miękkie = odbicie z klasą `soft|unknown|NULL`.
--     * `unique_opens` / `unique_clicks` - dla KAŻDEJ kampanii liczba
--       RÓŻNYCH `subscriber_id` z kohorty, którzy mają zdarzenie `open` /
--       `click` tej kampanii (kiedykolwiek do teraz), zsumowana po kampaniach
--       (= liczność par kampania-subskrybent). Ten sam człowiek w dwóch
--       kampaniach liczy się dwa razy, w jednej - raz, więc wskaźnik
--       `unique_opens / delivered` nie przekracza 100%.
--     * `unsubscribes` - RÓŻNI subskrybenci kohorty z `unsubscribed_at`
--       w ciągu 7 dni od otrzymania wysyłki z okna (atrybucja okienkowa:
--       token wypisu nie wskazuje kampanii, więc dokładnej atrybucji nie ma).
--     * LISTA (stan z bieżącego wiersza - bez historii statusów):
--       dołączenie = `confirmed_at`, a bez niego `created_at` (wiersz nie
--       `pending`); odejście = `unsubscribed_at` (albo `updated_at`) dla
--       statusu `unsubscribed`, nie wcześniej niż dołączenie. `start`/`end` =
--       na liście w chwili `p_since`/`p_until`; `new`/`unsubscribed` =
--       dołączenia/odejścia w oknie; `net_growth = end - start`
--       (= `new - unsubscribed` z konstrukcji). Kto wypisał się w oknie
--       i wrócił, liczy się jako obecny (status bieżący wygrywa).
--     * DOI - zapisy NOWYCH adresów w oknie, które przeszły double opt-in
--       (status `pending` albo zachowany token potwierdzenia); `confirmed_7d`
--       = potwierdzone w ciągu 7 dni od zapisu; null, gdy `started = 0`.
--       Zapis potwierdzony, a potem wypisany, traci token (wypis go zeruje)
--       i wypada z obu liczb.
--
-- KOLEJNOŚĆ WDROŻENIA: dowolna (nowa funkcja tylko do odczytu). Server fn
-- `getRevenueEmailHealth` (S1) woła ją literałem po wdrożeniu.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowa sygnatura), bezstanowe
-- REVOKE/GRANT. Zero DDL.
-- DOWÓD: supabase/tests/email_health_aggregate_test.sql (liczniki na fiksturze,
-- null zamiast zera, editor tak / autor nie, dwaj najemcy, window_invalid).
-- ============================================================================

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
  ), engagement AS (
    -- Para (kampania, subskrybent) = jeden odbiorca jednej kampanii; zdarzenia
    -- dopasowane po identyfikatorach z kohorty (kampanie najemcy), nie po
    -- `tenant_id` zdarzenia.
    SELECT
      count(DISTINCT (c.campaign_id, c.subscriber_id)) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM public.newsletter_campaign_events e
           WHERE e.campaign_id = c.campaign_id AND e.subscriber_id = c.subscriber_id
             AND e.kind = 'open')) AS unique_opens,
      count(DISTINCT (c.campaign_id, c.subscriber_id)) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM public.newsletter_campaign_events e
           WHERE e.campaign_id = c.campaign_id AND e.subscriber_id = c.subscriber_id
             AND e.kind = 'click')) AS unique_clicks,
      count(DISTINCT c.subscriber_id) FILTER (
        WHERE s.unsubscribed_at >= c.sent_at
          AND s.unsubscribed_at < c.sent_at + interval '7 days') AS unsubscribes
    FROM cohort c
    LEFT JOIN public.newsletter_subscribers s
      ON s.id = c.subscriber_id AND s.tenant_id = v_tenant
   WHERE c.subscriber_id IS NOT NULL
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

COMMENT ON FUNCTION public.admin_revenue_email_health(timestamptz, timestamptz) IS
  'Hub S1: zdrowie kanału e-mail w oknie [p_since, p_until) - kohorta wysyłek (doręczenia, unikalne otwarcia/kliknięcia per kampania, odbicia twarde/miękkie, skargi, wypisy 7 dni), lista (start/koniec/nowi/wypisani/netto), DOI 7 dni. Bez kwot; null = brak danych. admin/editor, najemca z sesji.';
