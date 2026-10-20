-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9c-X2, 2/5): RETENCJA DANYCH - WYKONANIE PER
-- KATEGORIA I ZADANIE DZIENNE. Polecenie właściciela 2026-10-20 (Z-I9b-10).
--
-- DEFEKT: patrz 20261020161000 (brak okresów i mechanizmu czyszczenia danych
-- żywych kont i kontaktów).
--
-- ZMIANA - każda kategoria osobno, wsadowo (limit wierszy na przebieg),
-- idempotentnie (powtórka nie znajduje już nic do zrobienia), wynik jsonb
-- `{affected, backlog, cutoff}`; tryb PODGLĄDU liczy, nie zmienia danych
-- osobowych (pieczęcie agregatów biegną w obu trybach - to nie usuwanie):
--   * `paywall_metering` - pieczęć lejka, potem `paywall_hits`
--     i `metering_event_log` starsze niż okres -> usunięte;
--   * `email_engagement` - pieczęć statystyk ścieżek, zdarzenia
--     `journey_message_events` -> usunięte; zdarzenia kampanii - zaangażowanie
--     dopisane do archiwum kampanii, potem usunięte;
--   * `email_send_log` - pieczęć statystyk ścieżek, adres i identyfikatory
--     odbiorcy w `email_send_log`, `email_delivery_events`
--     i `newsletter_campaign_recipients` -> `[redacted]`/NULL (szablon,
--     data, status, kampania zostają);
--   * `crm_inactive_contacts` / `crm_customers` - kontakt CRM bez konta,
--     bez aktywności od okresu (formularz, wydarzenie, otwarcie/kliknięcie,
--     notatka, zadanie, zmiana etapu), bez aktywnej subskrypcji newslettera,
--     zapisu na ścieżkę i przedłużenia -> anonimizacja; klient (transakcja)
--     dodatkowo dopiero po późniejszej z dat: koniec przechowywania dowodów
--     księgowych ostatniej transakcji (`accounting_retention_until`)
--     i przedawnienie roszczeń z końcem roku (6 lat);
--   * `audit_log` - wpis starszy niż okres -> usunięty; wpis operacji
--     finansowej - dopiero po terminie dowodów księgowych; IP i przeglądarka
--     po 12 miesiącach -> usunięte;
--   * `journey_enrollments` - pieczęć statystyk, zapisy zakończone dawniej
--     niż okres -> usunięte (kaskada kroków, wiadomości i zdarzeń);
--   * `cancellation_surveys` - ankieta starsza niż okres -> bez konta,
--     subskrypcji, komentarza i kodu kuponu (powód, wynik i data zostają);
--   * `consent_log` - łańcuch zgód (najemca, adres, klucz) z ostatnim słowem
--     „nie" sprzed 6 lat -> usunięty; łańcuch bez podmiotu (kontakt
--     zanonimizowany albo usunięty) dostaje wpis wygaśnięcia - od niego
--     biegnie 6 lat.
--   `_data_retention_run_tenant` - wszystkie kategorie najemcy (podgląd do
--   `enforce_after`, potem wykonanie), wiersz `data_retention_runs` na
--   kategorię, błąd kategorii zapisany kodem i nie zatrzymuje pozostałych.
--   `data_retention_run` - zadanie dzienne (service_role, `jobs-tick`):
--   najemcy bez przebiegu w 20 h (albo z zaległością), budżet czasu,
--   dziennik wysyłek bez najemcy, sprzątanie dziennika przebiegów > 25 mies.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020161000. Harmonogram (`jobs-tick`) woła
-- `data_retention_run` - przed wdrożeniem dostaje PGRST202/42883 i zapisuje
-- krok jako `skipped: migration_pending`.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, bezstanowe REVOKE/GRANT. Zero DDL.
-- DOWÓD: supabase/tests/hub_i9c_data_retention_test.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Reguły pomocnicze.
-- ----------------------------------------------------------------------------
-- Wpis audytu operacji finansowej: lustro AUDIT_FINANCIAL_ACTION_PREFIXES
-- i AUDIT_FINANCIAL_ENTITY_TYPES (src/lib/privacy/dataRetention.ts).
CREATE OR REPLACE FUNCTION public._data_retention_audit_is_financial(p_action text, p_entity_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT lower(COALESCE(p_action, '')) LIKE ANY (ARRAY['membership.%','billing.%','payment.%','refund%','price%','pricing.%','coupon%','discount%','event.invoice.%','order.%'])
      OR lower(COALESCE(p_entity_type, '')) = ANY (ARRAY['membership_grant','payment_order','billing_document','access_plan','b2b_coupon','b2b_coupon_campaign','event_invoice','subscription'])
$$;
REVOKE ALL ON FUNCTION public._data_retention_audit_is_financial(text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Kontakt-klient: ostatni dzień, w którym dane mogą być potrzebne - późniejsza
-- z dat: koniec przechowywania dowodów księgowych ostatniej transakcji (reguła
-- repozytorium, `accounting_retention_until`) i przedawnienie roszczeń
-- (6 lat, koniec roku kalendarzowego).
CREATE OR REPLACE FUNCTION public._data_retention_customer_until(p_last_tx timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(public.accounting_retention_until(p_last_tx),
                  make_date(EXTRACT(YEAR FROM (p_last_tx AT TIME ZONE 'Europe/Warsaw'))::int + 6, 12, 31))
$$;
REVOKE ALL ON FUNCTION public._data_retention_customer_until(timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- Liczba wierszy do limitu (podgląd) - bez pełnego skanu ponad limit.
CREATE OR REPLACE FUNCTION public._data_retention_bounded(p_count bigint, p_limit integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$ SELECT LEAST(COALESCE(p_count, 0), GREATEST(p_limit, 0))::integer $$;
REVOKE ALL ON FUNCTION public._data_retention_bounded(bigint, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- B) Lejek i licznik.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._data_retention_paywall_metering(
  p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date := (p_cutoff AT TIME ZONE 'UTC')::date;
  v_seal jsonb;
  v_cut date;
  v_hits integer := 0;
  v_log integer := 0;
BEGIN
  -- Najpierw agregat dzienny, dopiero potem usuwanie - i tylko do dnia
  -- zapieczętowanego (pieczęć przerwana limitem dni = reszta jutro).
  v_seal := public._data_retention_seal_funnel(p_tenant, v_day);
  v_cut := LEAST(v_day, (v_seal ->> 'sealed_through')::date + 1);
  IF p_execute THEN
    WITH doomed AS (
      SELECT ph.id FROM public.paywall_hits ph
       WHERE ph.tenant_id = p_tenant AND ph.day < v_cut
       ORDER BY ph.day LIMIT p_limit FOR UPDATE SKIP LOCKED)
    DELETE FROM public.paywall_hits ph USING doomed d WHERE ph.id = d.id;
    GET DIAGNOSTICS v_hits = ROW_COUNT;
    WITH doomed AS (
      SELECT ml.id FROM public.metering_event_log ml
       WHERE ml.tenant_id = p_tenant AND ml.occurred_at < v_cut::timestamp AT TIME ZONE 'UTC'
       ORDER BY ml.occurred_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
    DELETE FROM public.metering_event_log ml USING doomed d WHERE ml.id = d.id;
    GET DIAGNOSTICS v_log = ROW_COUNT;
    UPDATE public.data_retention_state st
       SET purged_before = GREATEST(COALESCE(st.purged_before, v_cut), v_cut), updated_at = now()
     WHERE st.tenant_id = p_tenant AND st.scope = 'funnel';
  ELSE
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_hits FROM (
      SELECT 1 FROM public.paywall_hits ph WHERE ph.tenant_id = p_tenant AND ph.day < v_cut LIMIT p_limit) x;
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_log FROM (
      SELECT 1 FROM public.metering_event_log ml
       WHERE ml.tenant_id = p_tenant AND ml.occurred_at < v_cut::timestamp AT TIME ZONE 'UTC' LIMIT p_limit) x;
  END IF;
  RETURN jsonb_build_object('affected', v_hits + v_log,
    'backlog', v_hits >= p_limit OR v_log >= p_limit OR NOT COALESCE((v_seal ->> 'complete')::boolean, false),
    'cutoff', v_cut::timestamp AT TIME ZONE 'UTC');
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_paywall_metering(uuid, timestamptz, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- C) Zdarzenia maili (ścieżki i kampanie).
-- ----------------------------------------------------------------------------
-- Kampania: zdarzenia starsze niż próg -> archiwum kampanii (otwarcia,
-- kliknięcia, zasięg unikalny = subskrybenci bez zdarzenia tego rodzaju po
-- progu), potem usunięcie. Całe kampanie w jednym kroku (spójny zasięg),
-- aż do wyczerpania limitu.
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
      SELECT e.id, e.kind, e.subscriber_id FROM public.newsletter_campaign_events e
       WHERE e.tenant_id = p_tenant AND e.campaign_id = v_campaign AND e.created_at < p_cutoff
       FOR UPDATE
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

CREATE OR REPLACE FUNCTION public._data_retention_email_engagement(
  p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date := (p_cutoff AT TIME ZONE 'UTC')::date;
  v_seal jsonb;
  v_cut timestamptz;
  v_journey integer := 0;
  v_campaign integer;
BEGIN
  v_seal := public._data_retention_seal_journeys(p_tenant, v_day);
  v_cut := LEAST(v_day, (v_seal ->> 'sealed_through')::date + 1)::timestamp AT TIME ZONE 'UTC';
  IF p_execute THEN
    WITH doomed AS (
      SELECT me.id FROM public.journey_message_events me
       WHERE me.tenant_id = p_tenant AND me.occurred_at < v_cut
       ORDER BY me.occurred_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
    DELETE FROM public.journey_message_events me USING doomed d WHERE me.id = d.id;
    GET DIAGNOSTICS v_journey = ROW_COUNT;
  ELSE
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_journey FROM (
      SELECT 1 FROM public.journey_message_events me
       WHERE me.tenant_id = p_tenant AND me.occurred_at < v_cut LIMIT p_limit) x;
  END IF;
  v_campaign := public._data_retention_fold_campaign_events(p_tenant, p_cutoff, p_execute, p_limit);
  RETURN jsonb_build_object('affected', v_journey + v_campaign,
    'backlog', v_journey >= p_limit OR v_campaign >= p_limit
               OR NOT COALESCE((v_seal ->> 'complete')::boolean, false),
    'cutoff', v_cut);
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_email_engagement(uuid, timestamptz, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- D) Dziennik wysyłek: adres i identyfikatory odbiorcy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._data_retention_email_send_log(
  p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_redacted constant text := '[redacted]';
  c_email_re constant text := '[[:alnum:]._%+-]+@[[:alnum:].-]+';
  v_day date := (p_cutoff AT TIME ZONE 'UTC')::date;
  v_seal jsonb;
  v_cut timestamptz;
  v_log integer := 0;
  v_events integer := 0;
  v_recipients integer := 0;
BEGIN
  -- Rollup ścieżek liczy „wysłane" i odbicia z dziennika po identyfikatorze
  -- wiadomości - pieczęć przed redakcją, inaczej statystyki starych dni
  -- straciłyby wysyłki.
  v_seal := public._data_retention_seal_journeys(p_tenant, v_day);
  v_cut := LEAST(v_day, (v_seal ->> 'sealed_through')::date + 1)::timestamp AT TIME ZONE 'UTC';
  IF p_execute THEN
    WITH doomed AS (
      SELECT l.id FROM public.email_send_log l
       WHERE l.tenant_id = p_tenant AND l.created_at < v_cut
         AND (l.recipient_email <> c_redacted OR l.message_id IS NOT NULL
              OR l.provider_message_id IS NOT NULL OR l.metadata IS NOT NULL)
       ORDER BY l.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
    UPDATE public.email_send_log l
       SET recipient_email = c_redacted, message_id = NULL, provider_message_id = NULL, metadata = NULL,
           error_message = regexp_replace(l.error_message, c_email_re, c_redacted, 'g')
      FROM doomed d WHERE l.id = d.id;
    GET DIAGNOSTICS v_log = ROW_COUNT;
    WITH doomed AS (
      SELECT de.id FROM public.email_delivery_events de
       WHERE de.tenant_id = p_tenant AND de.occurred_at < v_cut
         AND (de.email IS NOT NULL OR de.provider_message_id IS NOT NULL OR de.subscriber_id IS NOT NULL
              OR de.diagnostic IS NOT NULL OR de.payload <> '{}'::jsonb)
       ORDER BY de.occurred_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
    UPDATE public.email_delivery_events de
       SET email = NULL, provider_message_id = NULL, subscriber_id = NULL, diagnostic = NULL, payload = '{}'::jsonb
      FROM doomed d WHERE de.id = d.id;
    GET DIAGNOSTICS v_events = ROW_COUNT;
    -- Odbiorcy kampanii: adres jest kluczem (kampania, adres), więc zamiast
    -- jednego znacznika - znacznik z identyfikatorem wiersza.
    WITH doomed AS (
      SELECT r.id FROM public.newsletter_campaign_recipients r
       WHERE r.tenant_id = p_tenant AND r.created_at < p_cutoff AND r.email NOT LIKE '[redacted]%'
       ORDER BY r.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
    UPDATE public.newsletter_campaign_recipients r
       SET email = c_redacted || ':' || r.id::text, subscriber_id = NULL, provider_message_id = NULL, error = NULL
      FROM doomed d WHERE r.id = d.id;
    GET DIAGNOSTICS v_recipients = ROW_COUNT;
  ELSE
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_log FROM (
      SELECT 1 FROM public.email_send_log l
       WHERE l.tenant_id = p_tenant AND l.created_at < v_cut
         AND (l.recipient_email <> c_redacted OR l.message_id IS NOT NULL
              OR l.provider_message_id IS NOT NULL OR l.metadata IS NOT NULL) LIMIT p_limit) x;
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_events FROM (
      SELECT 1 FROM public.email_delivery_events de
       WHERE de.tenant_id = p_tenant AND de.occurred_at < v_cut
         AND (de.email IS NOT NULL OR de.provider_message_id IS NOT NULL OR de.subscriber_id IS NOT NULL
              OR de.diagnostic IS NOT NULL OR de.payload <> '{}'::jsonb) LIMIT p_limit) x;
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_recipients FROM (
      SELECT 1 FROM public.newsletter_campaign_recipients r
       WHERE r.tenant_id = p_tenant AND r.created_at < p_cutoff AND r.email NOT LIKE '[redacted]%' LIMIT p_limit) x;
  END IF;
  RETURN jsonb_build_object('affected', v_log + v_events + v_recipients,
    'backlog', v_log >= p_limit OR v_events >= p_limit OR v_recipients >= p_limit
               OR NOT COALESCE((v_seal ->> 'complete')::boolean, false),
    'cutoff', v_cut);
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_email_send_log(uuid, timestamptz, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- E) Kontakty CRM.
-- ----------------------------------------------------------------------------
-- Kandydaci do anonimizacji: bez konta, bez aktywności od `p_cutoff`, bez
-- aktywnej subskrypcji newslettera (podstawą jest wtedy zgoda niezależna od
-- CRM), bez zapisu na ścieżkę w toku, bez przedłużenia; `last_tx` - ostatnia
-- transakcja (zamówienie z adresem kontaktu, płatne zgłoszenie na wydarzenie).
-- Wspólna dla zadania i panelu (podgląd, lista „do anonimizacji").
CREATE OR REPLACE FUNCTION public._data_retention_crm_candidates(
  p_tenant uuid, p_cutoff timestamptz, p_limit integer)
RETURNS TABLE (lead_id uuid, last_activity timestamptz, last_tx timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH quiet AS MATERIALIZED (
    SELECT l.id, l.email_norm,
           GREATEST(l.created_at, l.last_activity_at, COALESCE(l.lifecycle_changed_at, l.created_at)) AS seen
      FROM public.crm_leads l
     WHERE l.tenant_id = p_tenant AND l.anonymized_at IS NULL AND l.user_id IS NULL
       AND l.created_at < p_cutoff AND l.last_activity_at < p_cutoff
       AND COALESCE(l.lifecycle_changed_at, l.created_at) < p_cutoff
       AND NOT EXISTS (SELECT 1 FROM public.data_retention_crm_extensions x
                        WHERE x.tenant_id = l.tenant_id AND x.lead_id = l.id AND x.extended_until > now())
       AND NOT EXISTS (SELECT 1 FROM public.newsletter_subscribers s
                        WHERE s.tenant_id = l.tenant_id AND lower(s.email) = l.email_norm
                          AND s.status IN ('pending', 'subscribed', 'confirmed'))
       AND NOT EXISTS (SELECT 1 FROM public.journey_enrollments e
                        WHERE e.tenant_id = l.tenant_id AND e.lead_id = l.id AND e.status IN ('active', 'waiting'))
       AND NOT EXISTS (SELECT 1 FROM public.crm_lead_notes n WHERE n.lead_id = l.id AND n.created_at >= p_cutoff)
       AND NOT EXISTS (SELECT 1 FROM public.crm_tasks k
                        WHERE k.lead_id = l.id AND (k.created_at >= p_cutoff OR k.updated_at >= p_cutoff))
       AND NOT EXISTS (SELECT 1 FROM public.crm_lead_stage_history h
                        WHERE h.tenant_id = l.tenant_id AND h.lead_id = l.id AND h.changed_at >= p_cutoff)
       AND NOT EXISTS (SELECT 1 FROM public.journey_enrollments e
                         JOIN public.journey_messages m ON m.enrollment_id = e.id
                         JOIN public.journey_message_events me ON me.message_id = m.message_id
                        WHERE e.tenant_id = l.tenant_id AND e.lead_id = l.id
                          AND me.kind IN ('open', 'click') AND me.occurred_at >= p_cutoff)
       AND NOT EXISTS (SELECT 1 FROM public.newsletter_subscribers s
                         JOIN public.newsletter_campaign_events ce ON ce.subscriber_id = s.id
                        WHERE s.tenant_id = l.tenant_id AND lower(s.email) = l.email_norm
                          AND ce.created_at >= p_cutoff)
       AND NOT EXISTS (SELECT 1 FROM public.event_people p
                         JOIN public.event_registrations r ON r.tenant_id = p.tenant_id AND r.person_id = p.id
                        WHERE p.tenant_id = l.tenant_id AND p.email_norm = l.email_norm AND r.created_at >= p_cutoff)
       AND NOT EXISTS (SELECT 1 FROM public.contact_messages cm
                        WHERE cm.tenant_id = l.tenant_id AND lower(cm.email) = l.email_norm
                          AND cm.created_at >= p_cutoff)
     ORDER BY l.last_activity_at, l.id
     LIMIT GREATEST(p_limit, 0)
  )
  SELECT q.id, q.seen,
         NULLIF(GREATEST(
           COALESCE((SELECT max(COALESCE(o.paid_at, o.created_at)) FROM public.payment_orders o
                      WHERE o.tenant_id = p_tenant AND lower(o.receipt_email) = q.email_norm
                        AND o.status IN ('paid', 'refunded')), '-infinity'::timestamptz),
           COALESCE((SELECT max(COALESCE(r.paid_at, r.created_at)) FROM public.event_people p
                       JOIN public.event_registrations r ON r.tenant_id = p.tenant_id AND r.person_id = p.id
                      WHERE p.tenant_id = p_tenant AND p.email_norm = q.email_norm
                        AND r.payment_status IN ('paid', 'partially_refunded', 'refunded')), '-infinity'::timestamptz)),
           '-infinity'::timestamptz)
    FROM quiet q
$$;
REVOKE ALL ON FUNCTION public._data_retention_crm_candidates(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role;

-- Anonimizacja jednego kontaktu: dane osobowe -> NULL albo losowy adres
-- zastępczy w domenie `.invalid` (bez mapowania); etap, cykl życia, źródło,
-- daty, wynik i liczniki zostają. Notatki personelu usunięte, tytuły zadań
-- zredagowane (status i daty zadań zostają - tor sprzedaży lejka), migawki
-- zapisów na ścieżki bez danych, dziennik wysyłek i wiadomości formularza
-- tego adresu - bez danych. Rejestr zgód zostaje (wyjątek, art. 7 ust. 1),
-- ale łańcuch bez podmiotu dostaje wpis wygaśnięcia - od niego biegnie
-- okres dowodowy kategorii `consent_log`.
CREATE OR REPLACE FUNCTION public._data_retention_anonymize_lead(p_tenant uuid, p_lead uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_redacted constant text := '[redacted]';
  c_skip constant text := 'skipped:data_retention';
  v_email text;
  v_anon text := 'anon-' || replace(gen_random_uuid()::text, '-', '') || '@anonymized.invalid';
BEGIN
  SELECT l.email_norm INTO v_email FROM public.crm_leads l
   WHERE l.tenant_id = p_tenant AND l.id = p_lead AND l.anonymized_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, consent_key, consent_text, given)
  SELECT p_tenant, c.email, 'other', c.consent_key,
         'Wygaśnięcie zgody: kontakt CRM zanonimizowany (retencja danych)', false
    FROM (SELECT DISTINCT ON (cl.consent_key) cl.email, cl.consent_key, cl.given
            FROM public.crm_consent_log cl
           WHERE cl.tenant_id = p_tenant AND lower(cl.email) = v_email
           ORDER BY cl.consent_key, cl.created_at DESC, cl.id DESC) c
   WHERE c.given;

  UPDATE public.crm_leads l
     SET email = v_anon, email_norm = v_anon, first_name = NULL, last_name = NULL, phone = NULL,
         phone_norm = NULL, company = NULL, position = NULL, linkedin_url = NULL, country = NULL,
         company_id = NULL, aliases = '{}'::jsonb, tags = '{}'::text[], score_breakdown = '[]'::jsonb,
         club_specializations = '{}'::text[], follow_up_at = NULL, marketing_consent = false,
         anonymized_at = now()
   WHERE l.tenant_id = p_tenant AND l.id = p_lead;

  DELETE FROM public.crm_lead_notes n WHERE n.lead_id = p_lead;
  UPDATE public.crm_tasks k SET title = c_redacted, note = NULL WHERE k.lead_id = p_lead;
  UPDATE public.journey_enrollments e SET trigger_snapshot = '{}'::jsonb
   WHERE e.tenant_id = p_tenant AND e.lead_id = p_lead;
  UPDATE public.email_send_log s SET recipient_email = c_redacted, provider_message_id = NULL, metadata = NULL
   WHERE s.tenant_id = p_tenant AND lower(s.recipient_email) = v_email;
  UPDATE public.contact_messages cm
     SET name = c_redacted, email = c_redacted, phone = NULL, company = NULL, subject = NULL,
         message = c_redacted, first_name = NULL, last_name = NULL, ip = NULL, user_agent = NULL,
         referer = NULL, page_url = NULL, custom = '{}'::jsonb
   WHERE cm.tenant_id = p_tenant AND lower(cm.email) = v_email;

  -- Emiter leada zgłasza zmianę jako `crm_lead.updated.v1` - anonimizacja nie
  -- jest zmianą kontaktu: ścieżka go nie zapisuje, integracja nie wysyła
  -- dalej (ten sam wzorzec co odcięcie konta, 20261020160700).
  UPDATE public.journey_event_inbox i
     SET processed_at = now(), error = c_skip
   WHERE i.processed_at IS NULL AND i.aggregate_type = 'crm_lead'
     AND i.aggregate_id = p_lead::text AND i.occurred_at = now();
  UPDATE public.integration_deliveries d
     SET status = 'dead', last_error = c_skip
    FROM public.domain_events e
   WHERE d.event_id = e.id AND d.status IN ('queued', 'failed')
     AND e.aggregate_type = 'crm_lead' AND e.aggregate_id = p_lead::text AND e.created_at = now();
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_anonymize_lead(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._data_retention_crm(
  p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit integer, p_customers boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead record;
  v_n integer := 0;
  v_seen integer := 0;
BEGIN
  -- Kandydaci obu kategorii przychodzą razem (filtr transakcji niżej), więc
  -- okno skanu jest szersze niż limit - inaczej strona samych klientów przed
  -- terminem ustawowym blokowałaby kontakty bez transakcji.
  FOR v_lead IN
    SELECT c.lead_id, c.last_tx FROM public._data_retention_crm_candidates(p_tenant, p_cutoff, p_limit * 4) c
  LOOP
    v_seen := v_seen + 1;
    CONTINUE WHEN p_customers AND (v_lead.last_tx IS NULL
                                   OR public._data_retention_customer_until(v_lead.last_tx) >= current_date);
    CONTINUE WHEN NOT p_customers AND v_lead.last_tx IS NOT NULL;
    EXIT WHEN v_n >= p_limit;
    IF p_execute THEN
      IF public._data_retention_anonymize_lead(p_tenant, v_lead.lead_id) THEN
        v_n := v_n + 1;
      END IF;
    ELSE
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('affected', v_n, 'backlog', v_n >= p_limit OR v_seen >= p_limit * 4,
                            'cutoff', p_cutoff);
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_crm(uuid, timestamptz, boolean, integer, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- F) Dziennik audytu panelu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._data_retention_audit_log(
  p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Lustro DATA_RETENTION_RULES.auditNetworkMonths.
  c_network_months constant integer := 12;
  v_network_cut timestamptz := now() - make_interval(months => c_network_months);
  v_plain integer := 0;
  v_financial integer := 0;
  v_network integer := 0;
BEGIN
  IF p_execute THEN
    WITH doomed AS (
      SELECT a.id FROM public.audit_log a
       WHERE a.tenant_id = p_tenant AND a.created_at < p_cutoff
         AND NOT public._data_retention_audit_is_financial(a.action, a.entity_type)
       ORDER BY a.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
    DELETE FROM public.audit_log a USING doomed d WHERE a.id = d.id;
    GET DIAGNOSTICS v_plain = ROW_COUNT;
    WITH doomed AS (
      SELECT a.id FROM public.audit_log a
       WHERE a.tenant_id = p_tenant AND public._data_retention_audit_is_financial(a.action, a.entity_type)
         AND public.accounting_retention_until(a.created_at) < current_date
       ORDER BY a.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
    DELETE FROM public.audit_log a USING doomed d WHERE a.id = d.id;
    GET DIAGNOSTICS v_financial = ROW_COUNT;
    WITH doomed AS (
      SELECT a.id FROM public.audit_log a
       WHERE a.tenant_id = p_tenant AND a.created_at < v_network_cut
         AND (a.ip IS NOT NULL OR COALESCE(a.metadata, '{}'::jsonb) ?| ARRAY['user_agent', 'ua', 'ip', 'ip_address'])
       ORDER BY a.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
    UPDATE public.audit_log a
       SET ip = NULL, metadata = a.metadata - 'user_agent' - 'ua' - 'ip' - 'ip_address'
      FROM doomed d WHERE a.id = d.id;
    GET DIAGNOSTICS v_network = ROW_COUNT;
  ELSE
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_plain FROM (
      SELECT 1 FROM public.audit_log a
       WHERE a.tenant_id = p_tenant AND a.created_at < p_cutoff
         AND NOT public._data_retention_audit_is_financial(a.action, a.entity_type) LIMIT p_limit) x;
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_financial FROM (
      SELECT 1 FROM public.audit_log a
       WHERE a.tenant_id = p_tenant AND public._data_retention_audit_is_financial(a.action, a.entity_type)
         AND public.accounting_retention_until(a.created_at) < current_date LIMIT p_limit) x;
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_network FROM (
      SELECT 1 FROM public.audit_log a
       WHERE a.tenant_id = p_tenant AND a.created_at < v_network_cut
         AND (a.ip IS NOT NULL OR COALESCE(a.metadata, '{}'::jsonb) ?| ARRAY['user_agent', 'ua', 'ip', 'ip_address'])
       LIMIT p_limit) x;
  END IF;
  RETURN jsonb_build_object('affected', v_plain + v_financial + v_network,
    'backlog', v_plain >= p_limit OR v_financial >= p_limit OR v_network >= p_limit, 'cutoff', p_cutoff);
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_audit_log(uuid, timestamptz, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- G) Zapisy na ścieżki po wyjściu, ankiety rezygnacji, rejestr zgód.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._data_retention_journey_enrollments(
  p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date := (p_cutoff AT TIME ZONE 'UTC')::date;
  v_seal jsonb;
  v_cut timestamptz;
  v_n integer := 0;
BEGIN
  v_seal := public._data_retention_seal_journeys(p_tenant, v_day);
  v_cut := LEAST(v_day, (v_seal ->> 'sealed_through')::date + 1)::timestamp AT TIME ZONE 'UTC';
  IF p_execute THEN
    WITH doomed AS (
      SELECT e.id FROM public.journey_enrollments e
       WHERE e.tenant_id = p_tenant AND e.status IN ('completed', 'goal_reached', 'exited', 'failed')
         AND e.finished_at < v_cut
       ORDER BY e.finished_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
    DELETE FROM public.journey_enrollments e USING doomed d WHERE e.id = d.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSE
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_n FROM (
      SELECT 1 FROM public.journey_enrollments e
       WHERE e.tenant_id = p_tenant AND e.status IN ('completed', 'goal_reached', 'exited', 'failed')
         AND e.finished_at < v_cut LIMIT p_limit) x;
  END IF;
  RETURN jsonb_build_object('affected', v_n,
    'backlog', v_n >= p_limit OR NOT COALESCE((v_seal ->> 'complete')::boolean, false), 'cutoff', v_cut);
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_journey_enrollments(uuid, timestamptz, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._data_retention_cancellation_surveys(
  p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_execute THEN
    WITH doomed AS (
      SELECT f.id FROM public.retention_feedback f
       WHERE f.tenant_id = p_tenant AND f.created_at < p_cutoff
         AND (f.user_id IS NOT NULL OR f.subscription_id IS NOT NULL OR f.comment IS NOT NULL
              OR f.coupon_code IS NOT NULL)
       ORDER BY f.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
    UPDATE public.retention_feedback f
       SET user_id = NULL, subscription_id = NULL, comment = NULL, coupon_code = NULL
      FROM doomed d WHERE f.id = d.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSE
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_n FROM (
      SELECT 1 FROM public.retention_feedback f
       WHERE f.tenant_id = p_tenant AND f.created_at < p_cutoff
         AND (f.user_id IS NOT NULL OR f.subscription_id IS NOT NULL OR f.comment IS NOT NULL
              OR f.coupon_code IS NOT NULL) LIMIT p_limit) x;
  END IF;
  RETURN jsonb_build_object('affected', v_n, 'backlog', v_n >= p_limit, 'cutoff', p_cutoff);
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_cancellation_surveys(uuid, timestamptz, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;

-- Łańcuch zgód = (najemca, adres, klucz zgody); ostatnie słowo decyduje.
CREATE OR REPLACE FUNCTION public._data_retention_consent_log(
  p_tenant uuid, p_execute boolean, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Lustro DATA_RETENTION_RULES.consentProofYears.
  c_years constant integer := 6;
  v_cut timestamptz := now() - make_interval(years => c_years);
  v_marked integer := 0;
  v_deleted integer := 0;
BEGIN
  IF p_execute THEN
    -- Wygaśnięcie: zgoda „tak" bez podmiotu (kontakt zanonimizowany albo
    -- usunięty, brak subskrypcji i konta z tym adresem) - wpis „nie" z dziś.
    WITH latest AS (
      SELECT DISTINCT ON (lower(c.email), c.consent_key) c.email, lower(c.email) AS em, c.consent_key, c.given
        FROM public.crm_consent_log c WHERE c.tenant_id = p_tenant
       ORDER BY lower(c.email), c.consent_key, c.created_at DESC, c.id DESC
    )
    INSERT INTO public.crm_consent_log (tenant_id, email, source_type, consent_key, consent_text, given)
    SELECT p_tenant, l.email, 'other', l.consent_key,
           'Wygaśnięcie zgody: brak kontaktu, subskrypcji i konta (retencja danych)', false
      FROM latest l
     WHERE l.given
       AND NOT EXISTS (SELECT 1 FROM public.crm_leads cl
                        WHERE cl.tenant_id = p_tenant AND cl.email_norm = l.em AND cl.anonymized_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.newsletter_subscribers s
                        WHERE s.tenant_id = p_tenant AND lower(s.email) = l.em
                          AND s.status IN ('pending', 'subscribed', 'confirmed'))
       AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.tenant_id = p_tenant AND lower(p.email) = l.em)
     LIMIT p_limit;
    GET DIAGNOSTICS v_marked = ROW_COUNT;

    WITH latest AS (
      SELECT DISTINCT ON (lower(c.email), c.consent_key) lower(c.email) AS em, c.consent_key, c.given, c.created_at
        FROM public.crm_consent_log c WHERE c.tenant_id = p_tenant
       ORDER BY lower(c.email), c.consent_key, c.created_at DESC, c.id DESC
    ), doomed AS (
      SELECT l.em, l.consent_key FROM latest l WHERE NOT l.given AND l.created_at < v_cut LIMIT p_limit
    )
    DELETE FROM public.crm_consent_log c USING doomed d
     WHERE c.tenant_id = p_tenant AND lower(c.email) = d.em AND c.consent_key = d.consent_key;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  ELSE
    SELECT count(*) INTO v_deleted FROM public.crm_consent_log c
      JOIN (SELECT l.em, l.consent_key FROM (
              SELECT DISTINCT ON (lower(c2.email), c2.consent_key) lower(c2.email) AS em, c2.consent_key,
                     c2.given, c2.created_at
                FROM public.crm_consent_log c2 WHERE c2.tenant_id = p_tenant
               ORDER BY lower(c2.email), c2.consent_key, c2.created_at DESC, c2.id DESC) l
             WHERE NOT l.given AND l.created_at < v_cut LIMIT p_limit) d
        ON lower(c.email) = d.em AND c.consent_key = d.consent_key
     WHERE c.tenant_id = p_tenant;
  END IF;
  RETURN jsonb_build_object('affected', v_deleted, 'marked', v_marked,
                            'backlog', v_deleted >= p_limit OR v_marked >= p_limit, 'cutoff', v_cut);
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_consent_log(uuid, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- H) Przebieg najemcy i zadanie dzienne.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._data_retention_run_tenant(
  p_tenant uuid, p_trigger text, p_limit integer DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 50000);
  v_set record;
  v_crm_cut timestamptz;
  v_res jsonb;
  v_out jsonb := '{}'::jsonb;
  v_started timestamptz;
  v_cutoff timestamptz;
BEGIN
  IF p_tenant IS NULL OR p_trigger NOT IN ('schedule', 'manual') THEN
    RAISE EXCEPTION 'run_invalid' USING ERRCODE = '22023';
  END IF;
  -- Jeden przebieg najemcy naraz (noc i „uruchom teraz" z dwóch kart).
  IF NOT pg_try_advisory_xact_lock(hashtextextended('data_retention_run:' || p_tenant::text, 0)) THEN
    RETURN jsonb_build_object('busy', true);
  END IF;
  SELECT e.cutoff INTO v_crm_cut
    FROM public._data_retention_effective(p_tenant) e WHERE e.category = 'crm_inactive_contacts';

  FOR v_set IN SELECT * FROM public._data_retention_effective(p_tenant) LOOP
    CONTINUE WHEN NOT v_set.enabled;
    -- Klient CRM: ten sam próg nieaktywności co kontakty (kategoria ustawowa
    -- go nie ma), termin ustawowy sprawdza funkcja kategorii.
    v_cutoff := CASE v_set.category
                  WHEN 'crm_customers' THEN v_crm_cut
                  WHEN 'consent_log' THEN NULL
                  ELSE v_set.cutoff END;
    v_started := clock_timestamp();
    BEGIN
      v_res := CASE v_set.category
        WHEN 'paywall_metering' THEN public._data_retention_paywall_metering(p_tenant, v_cutoff, v_set.enforced, v_limit)
        WHEN 'email_engagement' THEN public._data_retention_email_engagement(p_tenant, v_cutoff, v_set.enforced, v_limit)
        WHEN 'email_send_log' THEN public._data_retention_email_send_log(p_tenant, v_cutoff, v_set.enforced, v_limit)
        WHEN 'crm_inactive_contacts' THEN public._data_retention_crm(p_tenant, v_cutoff, v_set.enforced, v_limit, false)
        WHEN 'crm_customers' THEN public._data_retention_crm(p_tenant, v_cutoff, v_set.enforced, v_limit, true)
        WHEN 'audit_log' THEN public._data_retention_audit_log(p_tenant, v_cutoff, v_set.enforced, v_limit)
        WHEN 'journey_enrollments' THEN public._data_retention_journey_enrollments(p_tenant, v_cutoff, v_set.enforced, v_limit)
        WHEN 'cancellation_surveys' THEN public._data_retention_cancellation_surveys(p_tenant, v_cutoff, v_set.enforced, v_limit)
        WHEN 'consent_log' THEN public._data_retention_consent_log(p_tenant, v_set.enforced, v_limit)
      END;
      INSERT INTO public.data_retention_runs (tenant_id, category, mode, run_trigger, cutoff, affected, backlog,
                                              started_at, finished_at)
      VALUES (p_tenant, v_set.category, CASE WHEN v_set.enforced THEN 'execute' ELSE 'preview' END, p_trigger,
              COALESCE((v_res ->> 'cutoff')::timestamptz, v_cutoff), COALESCE((v_res ->> 'affected')::integer, 0),
              COALESCE((v_res ->> 'backlog')::boolean, false), v_started, clock_timestamp());
    EXCEPTION WHEN OTHERS THEN
      -- Kategoria z błędem nie zatrzymuje pozostałych; w dzienniku tylko kod.
      v_res := jsonb_build_object('error', SQLSTATE);
      INSERT INTO public.data_retention_runs (tenant_id, category, mode, run_trigger, cutoff, error_code,
                                              started_at, finished_at)
      VALUES (p_tenant, v_set.category, CASE WHEN v_set.enforced THEN 'execute' ELSE 'preview' END, p_trigger,
              v_cutoff, SQLSTATE, v_started, clock_timestamp());
    END;
    v_out := v_out || jsonb_build_object(v_set.category,
      v_res || jsonb_build_object('mode', CASE WHEN v_set.enforced THEN 'execute' ELSE 'preview' END));
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_run_tenant(uuid, text, integer) FROM PUBLIC, anon, authenticated, service_role;

-- Zadanie dzienne (service_role, `jobs-tick` w oknie nocnym). Najemca
-- wchodzi, gdy nie miał przebiegu z harmonogramu przez 20 h albo ostatnie
-- 2 h zostawiły zaległość. Budżet czasu: po 8 s kolejni najemcy czekają na
-- następne wywołanie w oknie (`more: true`).
CREATE OR REPLACE FUNCTION public.data_retention_run(p_limit integer DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_redacted constant text := '[redacted]';
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 50000);
  v_started timestamptz := clock_timestamp();
  v_tenant uuid;
  v_done integer := 0;
  v_more boolean := false;
  v_orphans integer := 0;
  v_pruned integer := 0;
BEGIN
  FOR v_tenant IN
    SELECT t.id FROM public.tenants t
     WHERE NOT EXISTS (SELECT 1 FROM public.data_retention_runs r
                        WHERE r.tenant_id = t.id AND r.run_trigger = 'schedule'
                          AND r.started_at > now() - interval '20 hours')
        OR EXISTS (SELECT 1 FROM public.data_retention_runs r
                    WHERE r.tenant_id = t.id AND r.run_trigger = 'schedule' AND r.backlog
                      AND r.started_at > now() - interval '2 hours')
     ORDER BY t.id
  LOOP
    IF clock_timestamp() - v_started > interval '8 seconds' THEN
      v_more := true;
      EXIT;
    END IF;
    PERFORM public._data_retention_run_tenant(v_tenant, 'schedule', v_limit);
    v_done := v_done + 1;
  END LOOP;

  -- Dziennik wysyłek bez najemcy (adres nierozstrzygnięty) - okres domyślny
  -- kategorii (13 mies.), bo nikt nie może go zmienić.
  WITH doomed AS (
    SELECT l.id FROM public.email_send_log l
     WHERE l.tenant_id IS NULL AND l.created_at < now() - interval '13 months'
       AND (l.recipient_email <> c_redacted OR l.message_id IS NOT NULL OR l.provider_message_id IS NOT NULL)
     ORDER BY l.created_at LIMIT v_limit FOR UPDATE SKIP LOCKED)
  UPDATE public.email_send_log l
     SET recipient_email = c_redacted, message_id = NULL, provider_message_id = NULL, metadata = NULL
    FROM doomed d WHERE l.id = d.id;
  GET DIAGNOSTICS v_orphans = ROW_COUNT;

  -- Dziennik przebiegów sam nie trzyma danych osobowych; 25 miesięcy wystarcza
  -- na porównanie rok do roku w karcie.
  DELETE FROM public.data_retention_runs r WHERE r.started_at < now() - interval '25 months';
  GET DIAGNOSTICS v_pruned = ROW_COUNT;

  RETURN jsonb_build_object('tenants', v_done, 'more', v_more, 'orphan_send_log', v_orphans,
                            'runs_pruned', v_pruned, 'batch_limit', v_limit);
END;
$$;
REVOKE ALL ON FUNCTION public.data_retention_run(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_retention_run(integer) TO service_role;

COMMENT ON FUNCTION public.data_retention_run(integer) IS
  'Retencja danych (I9c-X2): zadanie dzienne z jobs-tick (okno nocne). Każda kategoria osobno, wsadowo (p_limit wierszy na kategorię, 1..50000), podgląd do enforce_after, potem wykonanie; wiersz data_retention_runs na kategorię. Tylko service_role.';
