-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9d-Y1, 6/8): RETENCJA DANYCH - WYGASZANIE
-- NIEAKTYWNYCH SUBSKRYBENTÓW NEWSLETTERA (Z-I9c-08, kategoria
-- `newsletter_inactive`). Decyzja właściciela 2026-10-20 („tak, usuwaj"):
-- 12 mies. bez zaangażowania (zakres 6-24) -> JEDNA prośba o potwierdzenie
-- (PL/EN) -> brak reakcji 30 dni -> usunięcie wiersza subskrybenta. Podstawa:
-- RODO art. 5 ust. 1 lit. e, art. 7 ust. 1 (dowód zgody zostaje).
--
-- DEFEKT: subskrybent bez żadnej reakcji od lat dostaje kampanie bez końca
-- (adres i zgoda bez ograniczenia przechowywania), a wysyłka do martwych
-- adresów psuje reputację domeny nadawcy.
--
-- ZMIANA (DECYZJE WYKONAWCZE orkiestratora I9d, dziennik §21.22)
--   A. `_newsletter_last_engagement` - JEDNA definicja ostatniego
--      zaangażowania: zapis i potwierdzenie (`created_at`, `confirmed_at`),
--      znaczniki z 20261020161900 (kliknięcie, formularz, „Chcę dalej";
--      otwarcie ludzkie TYLKO przy włączonym pomiarze otwarć najemcy),
--      logowanie powiązanego konta (`user_id` albo profil z tym adresem),
--      formularze z trwałych źródeł (rejestr zgód - wpis „tak", wiadomość
--      kontaktowa, zgłoszenie na wydarzenie).
--   B. Kandydat (`_data_retention_newsletter_candidates`): `subscribed`/
--      `confirmed` (niepotwierdzony DOI i wypisani - poza zakresem decyzji,
--      zgłoszenie w dzienniku), bez wykluczenia i bez cyklu w toku,
--      ostatnie zaangażowanie starsze niż okres ORAZ co najmniej jedna
--      kampania wysłana do niego w oknie (bez szansy na reakcję nie ma
--      „nieaktywności").
--   C. Przebieg (`_data_retention_newsletter_inactive`, tylko WYKONANIE
--      zmienia stan - podgląd w karencji liczy): (1) cykle z zaangażowaniem
--      po prośbie, wypisem albo wykluczeniem -> skasowane (reset);
--      (2) cykle wysłane ponad 30 dni temu bez reakcji -> usunięcie
--      subskrybenta (D); (3) nowi kandydaci -> cykl (prośba czeka na
--      wysyłkę). Mail wysyła krok TS `jobs-tick` (podpis tokenu i render
--      PL/EN żyją w TS) przez E/F.
--   D. `_newsletter_sunset_delete`: łańcuchy zgód, których ostatnie słowo
--      „tak" pochodzi z newslettera -> wpis wygaśnięcia (od niego biegnie
--      okres dowodowy 6 lat - reguła „czas trwania zgody + 6 lat"); zgoda
--      marketingowa kontaktu CRM -> wycofana (wpis `marketing` „nie"
--      i flaga) TYLKO gdy rejestr nie ma innej zgody marketingowej „tak"
--      (klucze `marketing*`/`newsletter*` z innego źródła); status
--      newslettera kontaktu -> NULL; zdarzenia kampanii subskrybenta ->
--      archiwum kampanii (zasięg unikalny i sumy bez zmian); DELETE wiersza.
--      Lista wyłączeń NIETKNIĘTA (to nie sprzeciw) - klucz obcy blokady
--      tylko odpina subskrybenta (SET NULL).
--   E. `newsletter_sunset_claim(limit)` (service_role): porcja próśb do
--      wysłania - najemcy z kategorią włączoną i po karencji, dzienny limit
--      na najemcę (nazwana stała - reputacja domeny), dzierżawa 15 min.
--   F. `newsletter_sunset_mark(subskrybent, nonce, wynik, kod)`
--      (service_role): `queued`/`duplicate` = wysłany, `suppressed` (lista
--      wyłączeń zablokowała wysyłkę) = jak wysłany (adres i tak
--      nieosiągalny), `failed` = ponowienie po przerwie (1 h x próba,
--      maks. 24 h). Termin reakcji = `mailed_at` + 30 dni.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020161900 (znaczniki, tabele cyklu).
-- Kategoria wchodzi do katalogu w 20261020162200 (rdzeń) - do tego czasu
-- `newsletter_sunset_claim` nie widzi kategorii i nic nie wydaje.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, bezstanowe REVOKE/GRANT. Zero
-- DDL. Powtórka przebiegu nie tworzy drugiego cyklu (klucz = subskrybent).
-- DOWÓD: supabase/tests/hub_i9d_newsletter_sunset_test.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Ostatnie zaangażowanie subskrybenta.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._newsletter_last_engagement(p_subscriber uuid, p_track_opens boolean)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(
           s.created_at, s.confirmed_at, s.last_engaged_at,
           CASE WHEN p_track_opens THEN s.last_human_open_at END,
           (SELECT u.last_sign_in_at FROM auth.users u WHERE u.id = s.user_id),
           (SELECT max(u.last_sign_in_at) FROM public.profiles p JOIN auth.users u ON u.id = p.id
             WHERE p.tenant_id = s.tenant_id AND lower(p.email) = lower(s.email)),
           (SELECT max(c.created_at) FROM public.crm_consent_log c
             WHERE c.tenant_id = s.tenant_id AND lower(c.email) = lower(s.email) AND c.given),
           (SELECT max(cm.created_at) FROM public.contact_messages cm
             WHERE cm.tenant_id = s.tenant_id AND lower(cm.email) = lower(s.email)),
           (SELECT max(r.created_at) FROM public.event_people ep
              JOIN public.event_registrations r ON r.tenant_id = ep.tenant_id AND r.person_id = ep.id
             WHERE ep.tenant_id = s.tenant_id AND ep.email_norm = lower(s.email)))
    FROM public.newsletter_subscribers s
   WHERE s.id = p_subscriber
$$;

REVOKE ALL ON FUNCTION public._newsletter_last_engagement(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- Pomiar otwarć najemcy (karta „Retencja danych", ustawienia silnika S5);
-- brak wiersza = włączony.
CREATE OR REPLACE FUNCTION public._newsletter_track_opens(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT js.open_tracking_enabled FROM public.journey_settings js WHERE js.tenant_id = p_tenant), true)
$$;

REVOKE ALL ON FUNCTION public._newsletter_track_opens(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- B) Kandydaci (zadanie, podgląd, lista w panelu).
-- ----------------------------------------------------------------------------
-- Najpierw tanie odsiewanie po kolumnach wiersza (zaangażowani odpadają bez
-- zapytań do innych tabel), potem pełna definicja A. Kolejność po dacie
-- zapisu (kolumna wiersza), nie po wyniku A - LIMIT przerywa liczenie
-- definicji A po zebraniu porcji, zamiast liczyć ją dla całej listy.
-- Kampania „w oknie" po subskrybencie ALBO po adresie: adres odbiorcy
-- redaguje retencja dziennika wysyłek (od 6 mies.), identyfikator zostaje.
CREATE OR REPLACE FUNCTION public._data_retention_newsletter_candidates(
  p_tenant uuid, p_cutoff timestamptz, p_limit integer)
RETURNS TABLE (subscriber_id uuid, last_engaged timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH cfg AS (SELECT public._newsletter_track_opens(p_tenant) AS track),
  quiet AS (
    SELECT s.id, s.email, s.tenant_id, s.created_at
      FROM public.newsletter_subscribers s CROSS JOIN cfg
     WHERE s.tenant_id = p_tenant AND s.status IN ('subscribed', 'confirmed')
       AND s.created_at < p_cutoff
       AND COALESCE(s.confirmed_at, '-infinity'::timestamptz) < p_cutoff
       AND COALESCE(s.last_engaged_at, '-infinity'::timestamptz) < p_cutoff
       AND (NOT cfg.track OR COALESCE(s.last_human_open_at, '-infinity'::timestamptz) < p_cutoff)
       AND NOT EXISTS (SELECT 1 FROM public.newsletter_sunset_exclusions x WHERE x.subscriber_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM public.newsletter_sunset_requests q WHERE q.subscriber_id = s.id)
       AND (EXISTS (SELECT 1 FROM public.newsletter_campaign_recipients r
                     WHERE r.subscriber_id = s.id AND r.status = 'sent' AND r.sent_at >= p_cutoff)
            OR EXISTS (SELECT 1 FROM public.newsletter_campaign_recipients r
                        WHERE r.tenant_id = s.tenant_id AND lower(r.email) = lower(s.email)
                          AND r.status = 'sent' AND r.sent_at >= p_cutoff))
  )
  SELECT q.id, e.at
    FROM quiet q CROSS JOIN cfg
   CROSS JOIN LATERAL (SELECT public._newsletter_last_engagement(q.id, cfg.track) AS at) e
   WHERE e.at < p_cutoff
   ORDER BY q.created_at, q.id
   LIMIT GREATEST(p_limit, 0)
$$;

REVOKE ALL ON FUNCTION public._data_retention_newsletter_candidates(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- D) Usunięcie subskrybenta po terminie reakcji.
-- ----------------------------------------------------------------------------
-- Zdarzenia kampanii subskrybenta -> archiwum kampanii przed usunięciem:
-- klucz obcy SET NULL zostawiłby otwarcia i kliknięcia, ale zasięg unikalny
-- (`COUNT(DISTINCT subscriber_id)`) by zmalał.
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
    SELECT e.id, e.campaign_id, e.kind FROM public.newsletter_campaign_events e
     WHERE e.tenant_id = p_tenant AND e.subscriber_id = p_subscriber
     FOR UPDATE
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

CREATE OR REPLACE FUNCTION public._newsletter_sunset_delete(p_tenant uuid, p_subscriber uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_text constant text := 'Wygaśnięcie zgody: brak potwierdzenia chęci otrzymywania newslettera (retencja danych)';
  c_form constant text := 'retention:newsletter_sunset';
  v_s public.newsletter_subscribers%ROWTYPE;
  v_email text;
  v_keys text[];
  v_other boolean;
  v_lead record;
BEGIN
  SELECT * INTO v_s FROM public.newsletter_subscribers s
   WHERE s.tenant_id = p_tenant AND s.id = p_subscriber FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  v_email := lower(v_s.email);

  -- 1. Łańcuchy zgód z ostatnim słowem „tak" ze źródła newslettera -> wpis
  --    wygaśnięcia z dziś (od niego biegnie okres dowodowy).
  WITH latest AS (
    SELECT DISTINCT ON (cl.consent_key) cl.email, cl.consent_key, cl.given, cl.source_type
      FROM public.crm_consent_log cl
     WHERE cl.tenant_id = p_tenant AND lower(cl.email) = v_email
     ORDER BY cl.consent_key, cl.created_at DESC, cl.id DESC
  ), ins AS (
    INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, consent_key, consent_text,
                                        given, lang)
    SELECT p_tenant, l.email, 'newsletter', p_subscriber, c_form, l.consent_key, c_text, false,
           CASE WHEN v_s.language = 'en' THEN 'en' ELSE 'pl' END
      FROM latest l WHERE l.given AND l.source_type = 'newsletter'
    RETURNING consent_key
  )
  SELECT COALESCE(array_agg(ins.consent_key), ARRAY[]::text[]) INTO v_keys FROM ins;

  -- 2. Zgoda marketingowa kontaktu CRM - wycofana TYLKO gdy jej źródłem był
  --    newsletter: rejestr nie ma żadnej INNEJ zgody marketingowej „tak"
  --    (klucze `marketing*`/`newsletter*` z innego źródła - formularz,
  --    wydarzenie, import). Zgody na przetwarzanie (`privacy`, `rodo`)
  --    i ciasteczka (`cookies_marketing`) nie są zgodą na e-mail marketingowy,
  --    więc jej nie podtrzymują. Łańcuchy newslettera mają już po kroku 1
  --    ostatnie słowo „nie".
  SELECT EXISTS (
    SELECT 1 FROM (
      SELECT DISTINCT ON (cl.consent_key) cl.given
        FROM public.crm_consent_log cl
       WHERE cl.tenant_id = p_tenant AND lower(cl.email) = v_email
         AND cl.consent_key ~ '^(marketing|newsletter)'
       ORDER BY cl.consent_key, cl.created_at DESC, cl.id DESC) x
     WHERE x.given) INTO v_other;
  SELECT l.id, l.marketing_consent INTO v_lead FROM public.crm_leads l
   WHERE l.tenant_id = p_tenant AND l.email_norm = v_email AND l.anonymized_at IS NULL
   FOR UPDATE;
  IF FOUND THEN
    UPDATE public.crm_leads l
       SET newsletter_status = NULL,
           marketing_consent = CASE WHEN v_other THEN l.marketing_consent ELSE false END
     WHERE l.id = v_lead.id
       AND (l.newsletter_status IS NOT NULL OR (l.marketing_consent AND NOT v_other));
    IF v_lead.marketing_consent AND NOT v_other AND NOT ('marketing' = ANY (v_keys)) THEN
      INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, consent_key,
                                          consent_text, given, lang)
      VALUES (p_tenant, v_s.email, 'newsletter', p_subscriber, c_form, 'marketing', c_text, false,
              CASE WHEN v_s.language = 'en' THEN 'en' ELSE 'pl' END);
    END IF;
  END IF;

  -- 3. Zasięg kampanii bez zmian, 4. usunięcie (cykl i wykluczenie -
  --    kaskadą; odbiorcy, doręczenia i blokady - odpięte SET NULL).
  PERFORM public._newsletter_sunset_fold_events(p_tenant, p_subscriber);
  DELETE FROM public.newsletter_subscribers s WHERE s.id = p_subscriber;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public._newsletter_sunset_delete(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- C) Funkcja kategorii.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._data_retention_newsletter_inactive(
  p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Lustro DATA_RETENTION_RULES.newsletterResponseDays.
  c_response_days constant integer := 30;
  -- Usunięcie to pętla z kilkoma zapisami na wiersz - własny, mniejszy
  -- limit porcji (resztę bierze następny przebieg - `backlog`).
  c_delete_cap constant integer := 500;
  v_track boolean := public._newsletter_track_opens(p_tenant);
  v_due timestamptz := now() - make_interval(days => c_response_days);
  v_delete_limit integer := LEAST(GREATEST(p_limit, 0), c_delete_cap);
  v_id uuid;
  v_reset integer := 0;
  v_deleted integer := 0;
  v_requested integer := 0;
BEGIN
  IF NOT p_execute THEN
    -- PODGLĄD: ile próśb wyszłoby i ile usunięć - bez cyklu i bez maila.
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_requested
      FROM public._data_retention_newsletter_candidates(p_tenant, p_cutoff, p_limit);
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_deleted FROM (
      SELECT 1 FROM public.newsletter_sunset_requests q
        JOIN public.newsletter_subscribers s ON s.id = q.subscriber_id AND s.tenant_id = q.tenant_id
       WHERE q.tenant_id = p_tenant AND q.mailed_at < v_due AND s.status IN ('subscribed', 'confirmed')
         AND NOT EXISTS (SELECT 1 FROM public.newsletter_sunset_exclusions x WHERE x.subscriber_id = q.subscriber_id)
         AND public._newsletter_last_engagement(s.id, v_track) < q.requested_at
       LIMIT p_limit) x;
    RETURN jsonb_build_object('affected', v_requested + v_deleted, 'requested', v_requested, 'deleted', v_deleted,
                              'backlog', v_requested >= p_limit OR v_deleted >= p_limit, 'cutoff', p_cutoff);
  END IF;

  -- 1. Reset: reakcja po prośbie (kliknięcie, otwarcie, logowanie, formularz),
  --    wypis albo wykluczenie - cykl znika, licznik biegnie od nowa.
  WITH gone AS (
    SELECT q.subscriber_id FROM public.newsletter_sunset_requests q
      JOIN public.newsletter_subscribers s ON s.id = q.subscriber_id
     WHERE q.tenant_id = p_tenant
       AND (s.tenant_id <> q.tenant_id OR s.status NOT IN ('subscribed', 'confirmed')
            OR EXISTS (SELECT 1 FROM public.newsletter_sunset_exclusions x WHERE x.subscriber_id = q.subscriber_id)
            OR public._newsletter_last_engagement(s.id, v_track) >= q.requested_at)
     LIMIT p_limit
     FOR UPDATE OF q SKIP LOCKED
  )
  DELETE FROM public.newsletter_sunset_requests q USING gone g WHERE q.subscriber_id = g.subscriber_id;
  GET DIAGNOSTICS v_reset = ROW_COUNT;

  -- 2. Brak reakcji przez 30 dni od wysłania prośby -> usunięcie.
  FOR v_id IN
    SELECT q.subscriber_id FROM public.newsletter_sunset_requests q
      JOIN public.newsletter_subscribers s ON s.id = q.subscriber_id AND s.tenant_id = q.tenant_id
     WHERE q.tenant_id = p_tenant AND q.mailed_at < v_due AND s.status IN ('subscribed', 'confirmed')
       AND NOT EXISTS (SELECT 1 FROM public.newsletter_sunset_exclusions x WHERE x.subscriber_id = q.subscriber_id)
       AND public._newsletter_last_engagement(s.id, v_track) < q.requested_at
     ORDER BY q.mailed_at, q.subscriber_id
     LIMIT v_delete_limit
  LOOP
    IF public._newsletter_sunset_delete(p_tenant, v_id) THEN
      v_deleted := v_deleted + 1;
    END IF;
  END LOOP;

  -- 3. Nowi kandydaci -> cykl (prośbę wysyła krok TS przez claim/mark).
  INSERT INTO public.newsletter_sunset_requests (subscriber_id, tenant_id)
  SELECT c.subscriber_id, p_tenant FROM public._data_retention_newsletter_candidates(p_tenant, p_cutoff, p_limit) c
  ON CONFLICT (subscriber_id) DO NOTHING;
  GET DIAGNOSTICS v_requested = ROW_COUNT;

  RETURN jsonb_build_object('affected', v_requested + v_deleted, 'requested', v_requested, 'deleted', v_deleted,
                            'reset', v_reset,
                            'backlog', v_requested >= p_limit OR v_reset >= p_limit
                                       OR (v_delete_limit > 0 AND v_deleted >= v_delete_limit),
                            'cutoff', p_cutoff);
END;
$$;

REVOKE ALL ON FUNCTION public._data_retention_newsletter_inactive(uuid, timestamptz, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._data_retention_newsletter_inactive(uuid, timestamptz, boolean, integer) IS
  'Retencja danych (I9d, kategoria newsletter_inactive): reset cykli z reakcją, usunięcie subskrybentów bez reakcji 30 dni po prośbie (wygaśnięcie zgód z newslettera, archiwum kampanii, lista wyłączeń nietknięta), nowe cykle dla nieaktywnych dłużej niż okres. Podgląd liczy (bez cyklu i maila). Wewnętrzny.';

-- ----------------------------------------------------------------------------
-- E) Porcja próśb do wysłania (krok TS `jobs-tick`).
-- ----------------------------------------------------------------------------
-- rpc-shape: newsletter_sunset_claim (subscriber_id, tenant_id, email, lang,
-- first_name, nonce, requested_at, delete_after, unsubscribe_token, attempt)
CREATE OR REPLACE FUNCTION public.newsletter_sunset_claim(p_limit integer DEFAULT 50)
RETURNS TABLE (
  subscriber_id uuid,
  tenant_id uuid,
  email text,
  lang text,
  first_name text,
  nonce uuid,
  requested_at timestamptz,
  delete_after timestamptz,
  unsubscribe_token text,
  attempt integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  -- Dzienny limit próśb na najemcę - REPUTACJA DOMENY NADAWCY: prośba idzie
  -- do adresów nieaktywnych od miesięcy, więc fala tysięcy takich wiadomości
  -- jednego dnia (start po karencji u najemcy z dużą listą) podnosi odsetek
  -- odbić i skarg, od których zależy, czy skrzynki przyjmują CAŁĄ pocztę
  -- najemcy (także transakcyjną). Porcja rozkłada start na dni. Lustro TS:
  -- DATA_RETENTION_RULES.newsletterDailyCap.
  c_daily_cap constant integer := 200;
  -- Lustro DATA_RETENTION_RULES.newsletterResponseDays.
  c_response_days constant integer := 30;
  -- Dzierżawa: dren nie zdążył potwierdzić wysyłki (awaria ticku) - po 15 min
  -- prośba wraca do puli; klucz idempotencji maila (nonce) nie dubluje wysyłki.
  c_lease constant interval := interval '15 minutes';
  v_left integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
  v_tenant uuid;
  v_used integer;
  v_take integer;
  v_n integer;
BEGIN
  FOR v_tenant IN
    SELECT DISTINCT q.tenant_id FROM public.newsletter_sunset_requests q
     WHERE q.mailed_at IS NULL AND (q.claimed_until IS NULL OR q.claimed_until < now())
     ORDER BY q.tenant_id
  LOOP
    EXIT WHEN v_left <= 0;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public._data_retention_effective(v_tenant) e
                               WHERE e.category = 'newsletter_inactive' AND e.enabled AND e.enforced);
    SELECT count(*) INTO v_used FROM public.newsletter_sunset_requests q
     WHERE q.tenant_id = v_tenant
       AND (q.mailed_at > now() - interval '24 hours' OR (q.mailed_at IS NULL AND q.claimed_until > now()));
    v_take := LEAST(v_left, c_daily_cap - v_used);
    CONTINUE WHEN v_take <= 0;
    RETURN QUERY
      WITH picked AS (
        SELECT q.subscriber_id AS sid FROM public.newsletter_sunset_requests q
          JOIN public.newsletter_subscribers s ON s.id = q.subscriber_id AND s.tenant_id = q.tenant_id
         WHERE q.tenant_id = v_tenant AND q.mailed_at IS NULL
           AND (q.claimed_until IS NULL OR q.claimed_until < now())
           AND s.status IN ('subscribed', 'confirmed')
         ORDER BY q.requested_at, q.subscriber_id
         LIMIT v_take
         FOR UPDATE OF q SKIP LOCKED
      ), upd AS (
        UPDATE public.newsletter_sunset_requests q
           SET claimed_until = now() + c_lease, attempts = q.attempts + 1
          FROM picked p WHERE q.subscriber_id = p.sid
        RETURNING q.subscriber_id AS sid, q.tenant_id AS tid, q.nonce AS n, q.requested_at AS req, q.attempts AS att
      )
      SELECT u.sid, u.tid, s.email, CASE WHEN s.language = 'en' THEN 'en' ELSE 'pl' END, s.first_name, u.n,
             u.req, now() + make_interval(days => c_response_days), s.unsubscribe_token, u.att::integer
        FROM upd u JOIN public.newsletter_subscribers s ON s.id = u.sid
       ORDER BY u.req, u.sid;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_left := v_left - v_n;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_sunset_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_sunset_claim(integer) TO service_role;

COMMENT ON FUNCTION public.newsletter_sunset_claim(integer) IS
  'Wygaszanie (I9d): porcja próśb o potwierdzenie do wysłania (najemcy z kategorią newsletter_inactive włączoną i po karencji, dzienny limit 200 na najemcę, dzierżawa 15 min). Wiersz: subskrybent, najemca, adres, język (pl|en), imię, nonce, prośba, przewidywany termin usunięcia, token wypisu, próba. Tylko service_role.';

-- ----------------------------------------------------------------------------
-- F) Wynik wysyłki prośby.
-- ----------------------------------------------------------------------------
-- rpc-shape: newsletter_sunset_mark (ok, reason, mailed, retry_at)
CREATE OR REPLACE FUNCTION public.newsletter_sunset_mark(
  p_subscriber uuid, p_nonce uuid, p_outcome text, p_error text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text := CASE WHEN p_error ~ '^[a-z0-9_.:-]{1,64}$' THEN p_error ELSE 'failed' END;
  v_retry timestamptz;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('queued', 'duplicate', 'suppressed', 'failed') THEN
    RAISE EXCEPTION 'outcome_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'failed' THEN
    -- Ponowienie po przerwie rosnącej z liczbą prób (1 h x próba, maks. doba).
    UPDATE public.newsletter_sunset_requests q
       SET claimed_until = now() + make_interval(hours => LEAST(GREATEST(q.attempts, 1), 24)), last_error = v_code
     WHERE q.subscriber_id = p_subscriber AND q.nonce = p_nonce AND q.mailed_at IS NULL
    RETURNING q.claimed_until INTO v_retry;
  ELSE
    UPDATE public.newsletter_sunset_requests q
       SET mailed_at = now(), mail_outcome = p_outcome, claimed_until = NULL, last_error = NULL
     WHERE q.subscriber_id = p_subscriber AND q.nonce = p_nonce AND q.mailed_at IS NULL;
  END IF;
  IF NOT FOUND THEN
    -- Cykl zresetowany, subskrybent usunięty albo wynik już zapisany.
    RETURN jsonb_build_object('ok', false, 'reason', 'gone');
  END IF;
  RETURN jsonb_build_object('ok', true, 'mailed', p_outcome <> 'failed', 'retry_at', v_retry);
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_sunset_mark(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_sunset_mark(uuid, uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.newsletter_sunset_mark(uuid, uuid, text, text) IS
  'Wygaszanie (I9d): wynik wysyłki prośby - queued/duplicate/suppressed = wysłana (termin reakcji 30 dni od teraz; zablokowana listą wyłączeń liczy się jak wysłana), failed = ponowienie po przerwie (kod błędu, nie tekst). Tylko service_role.';
