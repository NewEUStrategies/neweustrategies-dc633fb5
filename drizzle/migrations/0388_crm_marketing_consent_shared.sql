-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9, Z-S5-04): JEDEN POMOCNIK WYCOFANIA ZGODY
-- MARKETINGOWEJ KONTAKTU CRM - PERSONEL CRM, WYPIS ZE ŚCIEŻKI, WYGASZANIE
-- NEWSLETTERA.
--
-- DEFEKT
--   1. Z-S5-04: wycofanie zgody marketingowej kontaktu (flaga
--      `crm_leads.marketing_consent = false` + wiersz `given = false`
--      w rejestrze zgód, żeby most wydarzeń i import nie wskrzesiły zgody ze
--      starszego dowodu - R12) żyło w TRZECH kopiach: RPC personelu
--      `crm_leads_marketing_consent_withdraw` (20261012180900), wypis jednym
--      kliknięciem z maila ścieżki `_journey_unsubscribe` (S5, 20261020140500)
--      i usunięcie subskrybenta przy wygaszaniu `_newsletter_sunset_delete`
--      (I9d-Y1, 20261020162000). Kopie już się rozjechały: personel dotykał
--      `updated_at` także kontaktów bez zgody, wypis - nie; każda kolejna
--      zmiana reguły (np. kolumna dowodu) wymagała trzech poprawek.
--
-- ZMIANA
--   A. `_crm_marketing_consent_withdraw(p_tenant, p_lead_ids, p_source_type,
--      p_source_id, p_form_id, p_form_name, p_text, p_lang)` (I9, internal):
--      flaga zdejmowana TYLKO kontaktom, które ją mają (`updated_at` bez
--      zbędnych zmian), wiersz rejestru `marketing`/`given = false` dla
--      KAŻDEGO kontaktu najemcy z adresem (także już odznaczonego - wiersz
--      z tą chwilą zatrzymuje most wydarzeń). Źródło wpisu z argumentów
--      (`source_id` domyślnie = kontakt). Zwraca liczbę wpisów rejestru.
--      Najemca wyłącznie z argumentu wołającego definera (personel - z sesji,
--      wypis - z tokenu wiadomości, retencja - z przebiegu najemcy); bez
--      EXECUTE dla klientów i service_role.
--   B. `crm_leads_marketing_consent_withdraw` (sprzed huba, CIALO-Z niżej):
--      bramka personelu i sufit 500 bez zmian, zapis przez pomocnika
--      (`crm_staff:withdraw`/`staff`).
--   C. `_journey_unsubscribe` (S5, rezerwa I9, CIALO-Z niżej): zgoda przez
--      pomocnika (`journey:unsubscribe`/`journey`); blokada wypisu i wyjście
--      z zapisów marketingowych bez zmian.
--   D. `_newsletter_sunset_delete` (I9d-Y1, CIALO-Z niżej): zgoda kontaktu,
--      której źródłem był newsletter, przez pomocnika (źródło `newsletter`,
--      `retention:newsletter_sunset`, id subskrybenta, język subskrybenta);
--      gdy łańcuch `marketing` dostał już wpis wygaśnięcia w kroku 1, tylko
--      flaga (bez drugiego wiersza). Zdjęcie statusu newslettera kontaktu -
--      bez zmian.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020162600 (I9-A); wymaga 20261012180900,
-- 20261020140500 i 20261020162000. Kształt odpowiedzi RPC personelu bez
-- zmian - wdrożenie przed kodem i po nim jest bezpieczne.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/hub_i9_marketing_consent_shared_test.sql (ACL
-- pomocnika, identyczny ślad rejestru z trzech ścieżek - różni się tylko
-- `form_id`/`form_name`/źródłem, kontakt już odznaczony - wpis jest,
-- `updated_at` bez zmian, obcy najemca nietknięty); istniejące
-- `event_identity_consents_r12_test`, `journeys_tracking_stats_test`
-- i `hub_i9d_y1_newsletter_sunset_test` bez zmian.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Pomocnik.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._crm_marketing_consent_withdraw(
  p_tenant uuid,
  p_lead_ids uuid[],
  p_source_type public.crm_source_type,
  p_source_id uuid,
  p_form_id text,
  p_form_name text,
  p_text text,
  p_lang text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_tenant IS NULL OR p_lead_ids IS NULL OR cardinality(p_lead_ids) = 0 THEN
    RETURN 0;
  END IF;

  -- Flaga tylko tam, gdzie jest - kontakt już odznaczony nie dostaje
  -- nowego `updated_at` (to nie jest zmiana kontaktu).
  UPDATE public.crm_leads l
     SET marketing_consent = false,
         updated_at = now()
   WHERE l.tenant_id = p_tenant
     AND l.id = ANY (p_lead_ids)
     AND l.marketing_consent;

  -- Dowód dla KAŻDEGO kontaktu najemcy z adresem: ostatnie słowo rejestru
  -- („nie" z tą chwilą) wygrywa z flagą i ze starszą zgodą (R12).
  INSERT INTO public.crm_consent_log (
    tenant_id, email, source_type, source_id, form_id, form_name,
    consent_key, consent_text, consent_version, given, ip, user_agent, lang
  )
  SELECT p_tenant, c.email, p_source_type, COALESCE(p_source_id, c.id),
         p_form_id, p_form_name, 'marketing', p_text, NULL, false, NULL, NULL, p_lang
    FROM (SELECT l.id, COALESCE(NULLIF(btrim(l.email), ''), l.email_norm) AS email
            FROM public.crm_leads l
           WHERE l.tenant_id = p_tenant
             AND l.id = ANY (p_lead_ids)) c
   WHERE c.email IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public._crm_marketing_consent_withdraw(
  uuid, uuid[], public.crm_source_type, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._crm_marketing_consent_withdraw(
  uuid, uuid[], public.crm_source_type, uuid, text, text, text, text) IS
  'Z-S5-04 (I9): wspolne wycofanie zgody marketingowej kontaktow CRM najemcy {p_tenant}: marketing_consent = false tylko kontaktom, ktore ja maja, i wiersz crm_consent_log (marketing, given = false, zrodlo z argumentow) dla kazdego kontaktu z adresem. Zwraca liczbe wpisow rejestru. Wolaja: crm_leads_marketing_consent_withdraw (personel), _journey_unsubscribe (wypis ze sciezki), _newsletter_sunset_delete (wygaszanie). Bez EXECUTE dla klientow.';

-- ----------------------------------------------------------------------------
-- B) Personel CRM.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261012180900
CREATE OR REPLACE FUNCTION public.crm_leads_marketing_consent_withdraw(p_lead_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: CRM staff role required';
  END IF;
  -- Ta sama bramka co polityka „Staff update leads" (has_role wiaze role
  -- z najemca z profilu - `current_tenant_id()`).
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'editor')
          OR public.has_role(v_uid, 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden: CRM staff role required';
  END IF;
  IF p_lead_ids IS NULL OR cardinality(p_lead_ids) = 0 THEN
    RETURN 0;
  END IF;
  -- Sufit jak walidator zbiorczej edycji (500 identyfikatorow).
  IF cardinality(p_lead_ids) > 500 THEN
    RAISE EXCEPTION 'invalid_payload: at most 500 contacts at once';
  END IF;

  RETURN public._crm_marketing_consent_withdraw(
    v_tenant, p_lead_ids, 'other'::public.crm_source_type, NULL,
    'crm_staff:withdraw', 'staff',
    'Marketing consent withdrawn in the CRM by staff (manual change, e.g. on the contact''s request).',
    NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_leads_marketing_consent_withdraw(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_leads_marketing_consent_withdraw(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.crm_leads_marketing_consent_withdraw(uuid[]) IS
  'R12 (REG-14): personel CRM (admin/editor/super_admin w najemcy z profilu) odznacza zgode marketingowa kontaktow ({p_lead_ids}, najwyzej 500): marketing_consent = false i wiersz crm_consent_log given=false (consent_key marketing, form_id crm_staff:withdraw, form_name staff) dla kazdego kontaktu najemcy - most wydarzen nie wskrzesza wtedy zgody. Kontakty innego najemcy pomijane. Zwraca liczbe objetych kontaktow. Najemca z current_tenant_id(), nigdy z ladunku. Zapis przez _crm_marketing_consent_withdraw (Z-S5-04).';

-- ----------------------------------------------------------------------------
-- C) Wypis ze ścieżki.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020140500
CREATE OR REPLACE FUNCTION public._journey_unsubscribe(p_tenant uuid, p_lead uuid, p_message_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text;
  v_token text;
  v_result jsonb;
  v_exited integer;
BEGIN
  SELECT COALESCE(NULLIF(btrim(l.email), ''), l.email_norm) INTO v_email
    FROM public.crm_leads l WHERE l.id = p_lead AND l.tenant_id = p_tenant;
  IF v_email IS NULL THEN
    RETURN 0;
  END IF;
  -- Ten sam zapis co wycofanie zgody w CRM - jeden pomocnik (Z-S5-04):
  -- flaga + dowód w księdze, żeby most wydarzeń nie wskrzesił zgody (R12).
  PERFORM public._crm_marketing_consent_withdraw(
    p_tenant, ARRAY[p_lead], 'other'::public.crm_source_type, NULL,
    'journey:unsubscribe', 'journey',
    'Marketing consent withdrawn with the one-click unsubscribe link of a journey email.',
    NULL);

  SELECT s.unsubscribe_token INTO v_token FROM public.newsletter_subscribers s
   WHERE s.tenant_id = p_tenant AND lower(s.email) = lower(v_email);
  IF v_token IS NOT NULL THEN
    -- Istniejący wypis: status subskrybenta + blokada `unsubscribe` jedną transakcją.
    v_result := public.email_unsubscribe_by_token(v_token);
  ELSE
    v_result := public.email_record_suppression(
      p_tenant => p_tenant, p_email => v_email, p_reason => 'unsubscribe',
      p_source => 'system', p_provider => 'self_service',
      p_meta => jsonb_build_object('channel', 'journey_unsubscribe', 'message_id', p_message_id));
  END IF;
  IF COALESCE((v_result ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'suppression_not_recorded: %', COALESCE(v_result ->> 'error', 'unknown')
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.journey_enrollments e
     SET status = 'exited', exit_reason = 'unsubscribed', finished_at = now(),
         next_run_at = NULL, lock_token = NULL, locked_until = NULL
    FROM public.journey_definitions d
   WHERE e.tenant_id = p_tenant AND e.lead_id = p_lead AND e.status IN ('active', 'waiting')
     AND d.tenant_id = e.tenant_id AND d.id = e.journey_id AND d.category = 'marketing';
  GET DIAGNOSTICS v_exited = ROW_COUNT;
  RETURN v_exited;
END;
$$;

REVOKE ALL ON FUNCTION public._journey_unsubscribe(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- D) Wygaszanie newslettera - usunięcie subskrybenta (I9d-Y1).
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020162000

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
    IF v_lead.marketing_consent AND NOT v_other THEN
      IF 'marketing' = ANY (v_keys) THEN
        -- Łańcuch `marketing` ze źródła newslettera ma już wpis wygaśnięcia
        -- z kroku 1 - sama flaga, bez drugiego wiersza rejestru.
        UPDATE public.crm_leads l SET marketing_consent = false, updated_at = now()
         WHERE l.id = v_lead.id AND l.marketing_consent;
      ELSE
        -- Wspólny zapis wycofania (Z-S5-04): flaga + wpis „nie" ze źródłem
        -- newslettera i identyfikatorem subskrybenta.
        PERFORM public._crm_marketing_consent_withdraw(
          p_tenant, ARRAY[v_lead.id], 'newsletter'::public.crm_source_type, p_subscriber,
          c_form, NULL, c_text, CASE WHEN v_s.language = 'en' THEN 'en' ELSE 'pl' END);
      END IF;
    END IF;
    UPDATE public.crm_leads l SET newsletter_status = NULL
     WHERE l.id = v_lead.id AND l.newsletter_status IS NOT NULL;
  END IF;

  -- 3. Zasięg kampanii bez zmian, 4. usunięcie (cykl i wykluczenie -
  --    kaskadą; odbiorcy, doręczenia i blokady - odpięte SET NULL).
  PERFORM public._newsletter_sunset_fold_events(p_tenant, p_subscriber);
  DELETE FROM public.newsletter_subscribers s WHERE s.id = p_subscriber;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public._newsletter_sunset_delete(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
