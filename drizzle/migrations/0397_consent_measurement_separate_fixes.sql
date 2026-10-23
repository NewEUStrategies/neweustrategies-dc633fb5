-- ============================================================================
-- ZGODA NA POMIAR OTWARĆ I KLIKNIĘĆ JAKO OSOBNE POLE (I9d-Y2b, poprawki R1):
-- SEKRET SKRZYNKI NA STRONIE DOI, PROŚBA ZWIĄZANA Z ADRESEM, KOLUMNY PERSONELU,
-- DOMKNIĘCIE ŁAŃCUCHÓW POMIARU, ODMOWA BEZ ZGODY W REJESTRZE.
-- Decyzje właściciela 2026-10-23: D1 wariant (b), D2 - pomiar tylko dla
-- skrzynki potwierdzonej przez jej właściciela.
--
-- DEFEKT (przegląd R1 PR 533: sql-r1-1, zgoda-r1-1, sql-r1-2, sql-r1-3,
-- zgoda-r1-3, regresje-r1-1, zgoda-r1-2, sql-r1-4)
--   1. (BLOKER) `newsletter_doi_measurement_decide` (20261023090100)
--      uwierzytelniał decyzję wyłącznie tokenem DOI. Personel najemcy
--      (admin, editor) czyta i zmienia przez RLS `confirmation_token`,
--      `consents` i `email` - mógł sam wytworzyć ofertę i zapisać „tak"
--      z kanałem `measurement:doi`, jakby kliknął właściciel skrzynki.
--   2. Link prośby (nonce + HMAC) zapisywał „tak" na BIEŻĄCY adres wiersza:
--      zmiana adresu po wysyłce dawała pomiar adresowi, który niczego nie
--      potwierdził.
--   3. Termin decyzji na stronie DOI liczony od deklaracji, którą odświeża
--      każdy publicznym formularzem - stary link DOI znów udzielał zgody.
--   4. Wypis sprzed 20261023090000 nie zostawił „nie" pomiaru - „Przywróć"
--      w panelu wskrzeszał dawne zaufane potwierdzenie (a).
--   5. Wycofanie zgody newsletter/marketing blokowało pomiar tylko
--      w czytelniku; retencja kasuje ten łańcuch osobno (6 lat) i dawne
--      „tak" pomiaru wracało.
--   6. Odmowa osoby bez zgody (stopka, preferencje, konto) zwracała
--      `already` bez wpisu - prośby jej nie omijały.
--
-- ZMIANA
--   A. Kolumny personelu (`authenticated`): SELECT wszystkich kolumn POZA
--      `confirmation_token`; UPDATE tylko kolumn panelu (status, wypis,
--      imię i nazwisko, język, meta). Token DOI, deklaracja (`consents`),
--      adres i dowody potwierdzenia zapisuje wyłącznie serwer.
--   B. Strona DOI wymaga SEKRETU SKRZYNKI: mail DOI z zaznaczonym polem
--      pomiaru niesie podpisany parametr `m` (HMAC sekretem serwera, domena
--      `md:` - src/lib/privacy/measurementToken.server.ts), związany
--      z subskrybentem, adresem, wersją treści pomiaru i terminem (60 dni od
--      wysłania maila). Serwer sprawdza podpis i podaje bazie jego treść;
--      `newsletter_doi_measurement_state`/`_decide` - nowe sygnatury
--      (p_subscriber, p_email, p_consent_version, p_expires_at), stare
--      (sam token) usunięte. Stan `_newsletter_doi_measurement_offer_state`:
--      termin z podpisu, „nie" pomiaru po wydaniu sekretu = declined;
--      deklaracja odświeżona później nie ma znaczenia.
--   C. Prośby: `newsletter_measurement_requests.email_norm` = adres, na który
--      wyszedł mail (zapis przy zajęciu porcji); potwierdzenie przy innym
--      adresie wiersza - `invalid`. Prośby zajęte wcześniej - adres z chwili
--      tej migracji.
--   D. `email_measurement_withdraw` zapisuje „nie" z kanałem odmowy także
--      bez wcześniejszego „tak" (`already` tylko po odmowie już zapisanej);
--      `email_measurement_state` zwraca `refused`.
--   E. Wycofanie zgody newsletter/marketing zamyka łańcuch pomiaru
--      (wyzwalacz `trg_crm_consent_log_measurement_opt_out`, kanał neutralny
--      `measurement:opt_out`).
--   F. Jednorazowe domknięcie (`_email_measurement_close_backfill`,
--      idempotentne): wypisani z ostatnim słowem „tak" -> „nie"
--      `measurement:unsubscribe`; aktywni z wycofaniem newsletter/marketing
--      nie wcześniejszym niż ostatnie „tak" -> „nie" `measurement:opt_out`.
--
-- SPROSTOWANIE nagłówków 20261023090000/090100 (plików nie edytujemy - limit
-- rozmiaru i zasada): „Przywróć nie wskrzesza zgody" i „wypis zamyka łańcuch"
-- są prawdziwe dopiero z domknięciem F; „token DOI to dowód skrzynki" -
-- nieprawda (token widzi personel), dowodem jest podpisany parametr `m`;
-- „decyzja DOI wygasa 60 dni po deklaracji" - wygasa 60 dni po wysłaniu
-- maila DOI; „wyzwalacz wypisu to jedyny wołający `_close_on_unsubscribe`" -
-- woła go też F.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261023090200; front (trasa
-- `api.public.newsletter.confirm`, mail DOI) - ZARAZ po migracji: stary front
-- woła usunięte sygnatury i dostaje błąd (fail-closed: brak karty).
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, UPDATE tylko pustych `email_norm`,
-- DROP ... IF EXISTS + CREATE, CREATE OR REPLACE, DROP TRIGGER IF EXISTS +
-- CREATE TRIGGER, bezstanowe REVOKE/GRANT/COMMENT, domknięcie F pisze tylko
-- przy ostatnim słowie „tak" (powtórka = 0).
-- DOWÓD: supabase/tests/hub_i9d_y2b_measurement_fixes_test.sql
-- (+ hub_i9d_y2b_measurement_separate_test.sql po przepięciu na nowe sygnatury).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Kolumny personelu.
-- ----------------------------------------------------------------------------
-- Uprawnienie kolumnowe obok tabelowego nic nie zabiera - najpierw REVOKE
-- tabelowe (zabiera też kolumnowe), potem jawne listy. Panel czyta jawne
-- kolumny (SubscribersPanel, SubscriberDetailDialog, przegląd, CRM, widok
-- lejka), a zapisuje status i wypis (SubscribersPanel, crm-funnel).
SET lock_timeout = '5s';
REVOKE SELECT, UPDATE ON public.newsletter_subscribers FROM authenticated;
GRANT SELECT (id, tenant_id, email, display_name, language, source, status, confirmed_at, unsubscribed_at, ip,
              user_agent, meta, created_at, updated_at, confirmation_expires_at, consents, source_form_id,
              source_form_name, first_name, last_name, unsubscribe_token, user_id, last_engaged_at,
              last_human_open_at)
  ON public.newsletter_subscribers TO authenticated;
GRANT UPDATE (status, unsubscribed_at, display_name, first_name, last_name, language, meta, updated_at)
  ON public.newsletter_subscribers TO authenticated;
RESET lock_timeout;

-- ----------------------------------------------------------------------------
-- B) Strona DOI: decyzja tylko z sekretem skrzynki.
-- ----------------------------------------------------------------------------
-- Stan oferty dla treści podpisanego parametru `m` z maila DOI: gone |
-- inactive | granted | none (termin minął, wersja inna niż bieżąca, brak
-- deklaracji) | declined („nie" pomiaru po wydaniu sekretu) | offer.
CREATE OR REPLACE FUNCTION public._newsletter_doi_measurement_offer_state(
  p_subscriber uuid, p_consent_version text, p_expires_at timestamptz)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Lustro MEASUREMENT_CONFIRM_LINK_DAYS (src/lib/privacy/measurement.ts):
  -- sekret z maila DOI działa tyle dni od wysłania maila (termin w podpisie).
  c_offer_days constant integer := 60;
  v_s public.newsletter_subscribers%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM public.newsletter_subscribers s WHERE s.id = p_subscriber;
  IF NOT FOUND THEN
    RETURN 'gone';
  END IF;
  IF v_s.status NOT IN ('subscribed', 'confirmed') THEN
    RETURN 'inactive';
  END IF;
  IF public._email_measurement_consent(v_s.tenant_id, v_s.email) THEN
    RETURN 'granted';
  END IF;
  -- Termin z podpisu: minął albo dalszy niż okno od dziś (+1 dzień na różnicę
  -- zegarów serwera i bazy) - brak oferty. Wersja z podpisu = bieżąca.
  IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + make_interval(days => c_offer_days + 1)
     OR p_consent_version IS DISTINCT FROM public._email_measurement_consent_version()
     OR public._newsletter_measurement_declared_at(v_s.consents) IS NULL THEN
    RETURN 'none';
  END IF;
  -- Każde „nie" pomiaru od wysłania maila (odmowa na stronie DOI, stopka,
  -- wypis i „Przywróć") zamyka ofertę tego maila.
  IF EXISTS (SELECT 1 FROM public.crm_consent_log c
              WHERE c.tenant_id = v_s.tenant_id AND lower(c.email) = lower(v_s.email)
                AND c.consent_key = 'email_measurement' AND NOT c.given
                AND c.created_at >= p_expires_at - make_interval(days => c_offer_days)) THEN
    RETURN 'declined';
  END IF;
  RETURN 'offer';
END;
$$;

REVOKE ALL ON FUNCTION public._newsletter_doi_measurement_offer_state(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._newsletter_doi_measurement_offer_state(uuid, text, timestamptz) IS
  'Zgoda i pomiar (I9d-Y2b R1): stan decyzji o pomiarze na stronie DOI dla treści podpisanego parametru m z maila DOI (wersja, termin = wysłanie + 60 dni) - gone | inactive | granted | none (termin minął albo spoza okna, inna wersja, brak deklaracji) | declined („nie" pomiaru od wysłania maila) | offer. Deklaracja odświeżona później nie przedłuża oferty. Wewnętrzna.';

DROP FUNCTION IF EXISTS public.newsletter_doi_measurement_state(text);
DROP FUNCTION IF EXISTS public.newsletter_doi_measurement_decide(text, boolean, text, text);

-- rpc-shape: newsletter_doi_measurement_state (result, lang)
CREATE OR REPLACE FUNCTION public.newsletter_doi_measurement_state(
  p_token text, p_subscriber uuid, p_email text, p_consent_version text, p_expires_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s public.newsletter_subscribers%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Fa-f0-9]{16,128}$' THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  SELECT * INTO v_s FROM public.newsletter_subscribers s WHERE s.confirmation_token = p_token;
  -- Sekret z maila wiąże subskrybenta i adres: inny wiersz albo adres
  -- zmieniony po wysyłce - jak nieznany token.
  IF NOT FOUND OR v_s.id IS DISTINCT FROM p_subscriber
     OR lower(v_s.email) IS DISTINCT FROM lower(btrim(p_email)) THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  RETURN jsonb_build_object(
    'result', public._newsletter_doi_measurement_offer_state(v_s.id, p_consent_version, p_expires_at),
    'lang', CASE WHEN v_s.language = 'en' THEN 'en' ELSE 'pl' END);
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_doi_measurement_state(text, uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_doi_measurement_state(text, uuid, text, text, timestamptz) TO service_role;

COMMENT ON FUNCTION public.newsletter_doi_measurement_state(text, uuid, text, text, timestamptz) IS
  'Zgoda i pomiar (I9d-Y2b R1): stan karty „Zgoda na pomiar" na stronie potwierdzenia DOI - token DOI plus treść podpisanego parametru m z maila (subskrybent, adres, wersja, termin; podpis HMAC sprawdza serwer TS - sam token, widoczny dla personelu, nie wystarcza). Bez mutacji. Wynik: {result: offer | granted | declined | none | inactive | gone | invalid, lang: pl|en} (invalid - bez lang). Tylko service_role.';

-- rpc-shape: newsletter_doi_measurement_decide (result, lang)
CREATE OR REPLACE FUNCTION public.newsletter_doi_measurement_decide(
  p_token text, p_subscriber uuid, p_email text, p_consent_version text, p_expires_at timestamptz,
  p_grant boolean, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s public.newsletter_subscribers%ROWTYPE;
  v_state text;
  v_lang text;
BEGIN
  IF p_grant IS NULL THEN
    RAISE EXCEPTION 'decision_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_token IS NULL OR p_token !~ '^[A-Fa-f0-9]{16,128}$' THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  -- Blokady jak pisarz „tak": wiersz subskrybenta, potem doradcza adresu.
  SELECT * INTO v_s FROM public.newsletter_subscribers s WHERE s.confirmation_token = p_token FOR UPDATE;
  IF NOT FOUND OR v_s.id IS DISTINCT FROM p_subscriber
     OR lower(v_s.email) IS DISTINCT FROM lower(btrim(p_email)) THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  v_lang := CASE WHEN v_s.language = 'en' THEN 'en' ELSE 'pl' END;
  PERFORM pg_advisory_xact_lock(hashtextextended('email_measurement:' || v_s.tenant_id::text || ':' || lower(v_s.email), 0));
  v_state := public._newsletter_doi_measurement_offer_state(v_s.id, p_consent_version, p_expires_at);
  IF v_state IN ('granted', 'declined') THEN
    RETURN jsonb_build_object('result', 'already', 'lang', v_lang);
  END IF;
  IF v_state <> 'offer' THEN
    -- inactive | none | gone
    RETURN jsonb_build_object('result', v_state, 'lang', v_lang);
  END IF;
  IF p_grant THEN
    v_state := public._email_measurement_grant(v_s.id, 'doi', p_ip, p_user_agent);
    RETURN jsonb_build_object('result', v_state, 'lang', v_lang);
  END IF;
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, form_name, consent_key,
                                      consent_text, consent_version, given, ip, user_agent, lang, created_at)
  VALUES (v_s.tenant_id, v_s.email, 'newsletter', v_s.id, 'measurement:doi_declined', 'email_measurement',
          'email_measurement',
          CASE WHEN v_lang = 'en'
            THEN 'Consent to measuring opens and clicks declined on the newsletter subscription confirmation page.'
            ELSE 'Odmowa zgody na pomiar otwarć i kliknięć na stronie potwierdzenia zapisu na newsletter.'
          END,
          public._email_measurement_consent_version(), false, left(NULLIF(btrim(p_ip), ''), 64),
          left(NULLIF(btrim(p_user_agent), ''), 512), v_lang, clock_timestamp());
  RETURN jsonb_build_object('result', 'declined', 'lang', v_lang);
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_doi_measurement_decide(text, uuid, text, text, timestamptz, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_doi_measurement_decide(text, uuid, text, text, timestamptz, boolean, text, text)
  TO service_role;

COMMENT ON FUNCTION public.newsletter_doi_measurement_decide(text, uuid, text, text, timestamptz, boolean, text, text) IS
  'Zgoda i pomiar (I9d-Y2b R1): decyzja o pomiarze na stronie potwierdzenia DOI (POST) - token DOI plus treść podpisanego parametru m z maila (subskrybent, adres, wersja, termin; podpis HMAC sprawdza serwer TS); tylko w stanie offer: p_grant = true -> _email_measurement_grant z kanałem measurement:doi, false -> „nie" measurement:doi_declined. Wynik: {result: granted | declined | already | inactive | none | gone | invalid, lang}; p_grant NULL - 22023 decision_invalid. Tylko service_role.';

COMMENT ON FUNCTION public._newsletter_measurement_offer_state(uuid) IS
  'Zgoda i pomiar (I9d-Y2b): stan oferty dla PROŚBY po zapisie (newsletter_measurement_request_signup) - gone | inactive | granted | none (brak deklaracji albo starsza niż 60 dni) | declined („nie" pomiaru po deklaracji) | offer. Strona DOI od R1 - _newsletter_doi_measurement_offer_state (termin od wysłania maila). Wewnętrzna.';

-- ----------------------------------------------------------------------------
-- C) Prośby związane z adresem wysyłki.
-- ----------------------------------------------------------------------------
SET lock_timeout = '5s';
ALTER TABLE public.newsletter_measurement_requests ADD COLUMN IF NOT EXISTS email_norm text;
RESET lock_timeout;

COMMENT ON COLUMN public.newsletter_measurement_requests.email_norm IS
  'Zgoda i pomiar (I9d-Y2b R1): adres (lower), na który wyszedł mail prośby - zapis przy zajęciu porcji (newsletter_measurement_claim). Potwierdzenie przy innym adresie wiersza subskrybenta = invalid. Prośby zajęte przed 20261023090300 - adres z chwili tej migracji.';

-- Prośby już zajęte albo wysłane: adres z chwili migracji (najlepsze dostępne
-- przybliżenie adresu wysyłki); niezajęte dostaną adres przy zajęciu.
UPDATE public.newsletter_measurement_requests r
   SET email_norm = lower(s.email)
  FROM public.newsletter_subscribers s
 WHERE s.id = r.subscriber_id AND r.email_norm IS NULL AND (r.attempts > 0 OR r.mailed_at IS NOT NULL);

-- Ciało z 20261023090200; zmiana - zajęcie zapisuje adres wysyłki
-- (`email_norm`), wiersz wyniku niesie ten sam adres.
-- CIALO-Z: 20261023090200
-- rpc-shape: newsletter_measurement_claim (subscriber_id, tenant_id, email, lang,
-- first_name, nonce, consent_version, unsubscribe_token, attempt, origin)
CREATE OR REPLACE FUNCTION public.newsletter_measurement_claim(p_limit integer DEFAULT 50, p_origin text DEFAULT NULL)
RETURNS TABLE (
  subscriber_id uuid,
  tenant_id uuid,
  email text,
  lang text,
  first_name text,
  nonce uuid,
  consent_version text,
  unsubscribe_token text,
  attempt integer,
  origin text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  -- Panel: lustro DATA_RETENTION_RULES.newsletterDailyCap (budżet wspólny
  -- z Y1). Po zapisie: lustro NEWSLETTER_MEASUREMENT_SIGNUP_DAILY_CAP
  -- (src/lib/privacy/measurementReconfirm.ts).
  c_daily_cap constant integer := 200;
  c_signup_daily_cap constant integer := 500;
  c_lease constant interval := interval '15 minutes';
  -- Po 5 nieudanych próbach prośba zostaje „nieudana" (podgląd w panelu).
  c_max_attempts constant integer := 5;
  v_left integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
  v_origin text;
  v_tenant uuid;
  v_take integer;
  v_n integer;
BEGIN
  IF p_origin IS NOT NULL AND p_origin NOT IN ('panel', 'signup') THEN
    RAISE EXCEPTION 'origin_invalid' USING ERRCODE = '22023';
  END IF;
  FOREACH v_origin IN ARRAY CASE WHEN p_origin IS NULL THEN ARRAY['signup', 'panel'] ELSE ARRAY[p_origin] END LOOP
    FOR v_tenant IN
      SELECT DISTINCT r.tenant_id FROM public.newsletter_measurement_requests r
       WHERE r.origin = v_origin AND r.mailed_at IS NULL AND r.attempts < c_max_attempts
         AND (r.claimed_until IS NULL OR r.claimed_until < now())
       ORDER BY r.tenant_id
    LOOP
      EXIT WHEN v_left <= 0;
      v_take := LEAST(v_left, CASE WHEN v_origin = 'signup'
                                   THEN c_signup_daily_cap - public._newsletter_measurement_signup_mail_used(v_tenant)
                                   ELSE c_daily_cap - public._newsletter_oneoff_mail_used(v_tenant) END);
      CONTINUE WHEN v_take <= 0;
      -- Czoło kolejki: prośba nieaktualna (wypis, zgoda udzielona albo „nie"
      -- pomiaru po prośbie) - `skipped`, bez maila.
      WITH head AS (
        SELECT r.subscriber_id AS sid, r.consent_version AS ver FROM public.newsletter_measurement_requests r
         WHERE r.tenant_id = v_tenant AND r.origin = v_origin AND r.mailed_at IS NULL
           AND r.attempts < c_max_attempts AND (r.claimed_until IS NULL OR r.claimed_until < now())
         ORDER BY r.requested_at, r.subscriber_id
         LIMIT v_take
         FOR UPDATE OF r SKIP LOCKED
      )
      UPDATE public.newsletter_measurement_requests r
         SET mailed_at = now(), mail_outcome = 'skipped', claimed_until = NULL
        FROM head h JOIN public.newsletter_subscribers s ON s.id = h.sid
       WHERE r.subscriber_id = h.sid AND r.consent_version = h.ver
         AND (s.status NOT IN ('subscribed', 'confirmed') OR public._email_measurement_consent(v_tenant, s.email)
              OR EXISTS (SELECT 1 FROM public.crm_consent_log c
                          WHERE c.tenant_id = v_tenant AND lower(c.email) = lower(s.email)
                            AND c.consent_key = 'email_measurement' AND NOT c.given
                            AND c.created_at >= r.requested_at));
      RETURN QUERY
        WITH picked AS (
          SELECT r.subscriber_id AS sid, r.consent_version AS ver FROM public.newsletter_measurement_requests r
           WHERE r.tenant_id = v_tenant AND r.origin = v_origin AND r.mailed_at IS NULL
             AND r.attempts < c_max_attempts AND (r.claimed_until IS NULL OR r.claimed_until < now())
           ORDER BY r.requested_at, r.subscriber_id
           LIMIT v_take
           FOR UPDATE OF r SKIP LOCKED
        ), upd AS (
          -- Adres wysyłki zapisany przy zajęciu: link z tego maila potwierdza
          -- zgodę wyłącznie dla tego adresu (newsletter_measurement_confirm).
          UPDATE public.newsletter_measurement_requests r
             SET claimed_until = now() + c_lease, attempts = r.attempts + 1, email_norm = lower(s.email)
            FROM picked p JOIN public.newsletter_subscribers s ON s.id = p.sid
           WHERE r.subscriber_id = p.sid AND r.consent_version = p.ver
          RETURNING r.subscriber_id AS sid, r.tenant_id AS tid, r.nonce AS n, r.consent_version AS ver,
                    r.requested_at AS req, r.attempts AS att, r.origin AS org
        )
        SELECT u.sid, u.tid, s.email, CASE WHEN s.language = 'en' THEN 'en' ELSE 'pl' END, s.first_name, u.n,
               u.ver, s.unsubscribe_token, u.att::integer, u.org
          FROM upd u JOIN public.newsletter_subscribers s ON s.id = u.sid
         ORDER BY u.req, u.sid;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_left := v_left - v_n;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_measurement_claim(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_measurement_claim(integer, text) TO service_role;

COMMENT ON FUNCTION public.newsletter_measurement_claim(integer, text) IS
  'Zgoda i pomiar (I9d-Y2b): porcja próśb o zgodę na pomiar do wysłania - p_origin NULL = oba pochodzenia (najpierw signup), signup|panel = tylko to (inne - 22023 origin_invalid); budżet panelu 200/dobę wspólny z prośbami wygaszania, budżet próśb po zapisie 500/dobę; dzierżawa 15 min, maks. 5 prób; nieaktualne -> skipped; zajęcie zapisuje adres wysyłki (email_norm, R1). Wiersz: subskrybent, najemca, adres, język (pl|en), imię, nonce, wersja treści, token wypisu, próba, pochodzenie (panel|signup). Tylko service_role.';

-- Ciało z 20261023090200; zmiana - potwierdzenie tylko dla adresu, na który
-- wyszedł mail prośby (`email_norm`).
-- CIALO-Z: 20261023090200
-- rpc-shape: newsletter_measurement_confirm (result, tenant_id, lang)
CREATE OR REPLACE FUNCTION public.newsletter_measurement_confirm(
  p_subscriber uuid, p_nonce uuid, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s public.newsletter_subscribers%ROWTYPE;
  v_r public.newsletter_measurement_requests%ROWTYPE;
  v_lang text;
  v_res text;
BEGIN
  IF p_subscriber IS NULL OR p_nonce IS NULL THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  SELECT * INTO v_s FROM public.newsletter_subscribers s WHERE s.id = p_subscriber FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'gone');
  END IF;
  v_lang := CASE WHEN v_s.language = 'en' THEN 'en' ELSE 'pl' END;
  SELECT * INTO v_r FROM public.newsletter_measurement_requests r
   WHERE r.subscriber_id = p_subscriber AND r.tenant_id = v_s.tenant_id AND r.nonce = p_nonce
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'invalid', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
  END IF;
  IF v_r.confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
  END IF;
  IF v_s.status NOT IN ('subscribed', 'confirmed') THEN
    RETURN jsonb_build_object('result', 'inactive', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
  END IF;
  -- Adres wiersza inny niż adres wysyłki (zmiana po wysłaniu maila) albo
  -- prośba bez wysyłki - link nie należy do skrzynki tego adresu.
  IF v_r.email_norm IS DISTINCT FROM lower(v_s.email) THEN
    RETURN jsonb_build_object('result', 'invalid', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
  END IF;

  UPDATE public.newsletter_measurement_requests r SET confirmed_at = now()
   WHERE r.subscriber_id = v_r.subscriber_id AND r.consent_version = v_r.consent_version;
  -- Zgoda na pomiar udzielona w międzyczasie (strona DOI, inny link) - link
  -- zużyty, bez drugiego wpisu (`already` z pisarza).
  v_res := public._email_measurement_grant(v_s.id, CASE WHEN v_r.origin = 'signup' THEN 'signup' ELSE 'reconfirm' END,
                                           p_ip, p_user_agent);
  IF v_res <> 'granted' THEN
    RETURN jsonb_build_object('result', v_res, 'tenant_id', v_s.tenant_id, 'lang', v_lang);
  END IF;
  -- Kliknięcie w link z maila = zaangażowanie (wygaszanie Y1).
  PERFORM public._newsletter_engagement_touch(v_s.tenant_id, v_s.id, NULL, 'form', now());
  RETURN jsonb_build_object('result', 'confirmed', 'tenant_id', v_s.tenant_id, 'lang', v_lang);
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_measurement_confirm(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_measurement_confirm(uuid, uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.newsletter_measurement_confirm(uuid, uuid, text, text) IS
  'Zgoda i pomiar (I9d-Y2b): link „Zgadzam się na pomiar" z prośby (nonce jednorazowy; podpis HMAC sprawdza serwer TS; adres wiersza = adres wysyłki email_norm, inny - invalid) - zgoda na pomiar przez _email_measurement_grant (kanał measurement:signup dla prośby po zapisie, measurement:reconfirm dla prośby z panelu; treść i wersja pola pomiaru, IP, UA), bez wpisu newsletter; znacznik zaangażowania. Wynik: confirmed | already | inactive | gone | invalid (+ tenant_id, lang). Tylko service_role.';

-- ----------------------------------------------------------------------------
-- D) Odmowa także bez wcześniejszej zgody; stan z odmową.
-- ----------------------------------------------------------------------------
-- Ciało z 20261023090000; zmiana - `already` tylko wtedy, gdy ostatnia
-- DECYZJA (udzielenie albo własna odmowa; wypis i retencja to nie decyzja)
-- to już odmowa. Osoba bez zgody dostaje wpis „nie" z kanałem odmowy
-- (wyklucza ją z próśb) i treścią odmowy, osoba ze zgodą - treść wycofania.
-- CIALO-Z: 20261023090000
-- rpc-shape: email_measurement_withdraw (result, tenant_id, lang)
CREATE OR REPLACE FUNCTION public.email_measurement_withdraw(
  p_subscriber uuid DEFAULT NULL,
  p_lead uuid DEFAULT NULL,
  p_channel text DEFAULT 'email_footer',
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s record;
  v_last boolean;
  v_had boolean;
  v_channel text := CASE WHEN p_channel IN ('email_footer', 'preferences', 'account') THEN p_channel
                         ELSE 'email_footer' END;
BEGIN
  IF (p_subscriber IS NULL) = (p_lead IS NULL) THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  SELECT * INTO v_s FROM public._email_measurement_subject(p_subscriber, p_lead);
  IF v_s.tenant_id IS NULL THEN
    RETURN jsonb_build_object('result', 'gone');
  END IF;
  -- Dwa kliknięcia naraz (podgląd linku przez klienta poczty + człowiek):
  -- jeden wpis „nie", drugi widzi `already`.
  PERFORM pg_advisory_xact_lock(hashtextextended('email_measurement:' || v_s.tenant_id::text || ':' || lower(v_s.email), 0));
  SELECT c.given INTO v_last FROM public.crm_consent_log c
   WHERE c.tenant_id = v_s.tenant_id AND lower(c.email) = lower(v_s.email) AND c.consent_key = 'email_measurement'
     AND (c.given OR c.form_id = ANY (public._email_measurement_refusal_channels()))
   ORDER BY c.created_at DESC, c.given, c.id DESC
   LIMIT 1;
  IF v_last IS NOT DISTINCT FROM false THEN
    RETURN jsonb_build_object('result', 'already', 'tenant_id', v_s.tenant_id, 'lang', v_s.lang);
  END IF;
  v_had := public._email_measurement_consent(v_s.tenant_id, v_s.email);
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, form_name, consent_key,
                                      consent_text, consent_version, given, ip, user_agent, lang, created_at)
  VALUES (v_s.tenant_id, v_s.email, v_s.source_type, v_s.source_id, 'measurement:' || v_channel,
          'email_measurement_withdraw', 'email_measurement',
          CASE WHEN v_had AND v_s.lang = 'en'
                 THEN 'Withdrawal of consent to measuring email opens and clicks (newsletter and marketing consent unchanged).'
               WHEN v_had
                 THEN 'Wycofanie zgody na pomiar otwarć i kliknięć w wiadomościach e-mail (zgoda na newsletter i komunikację bez zmian).'
               WHEN v_s.lang = 'en'
                 THEN 'Refusal of consent to measuring email opens and clicks (newsletter and marketing consent unchanged).'
               ELSE 'Odmowa zgody na pomiar otwarć i kliknięć w wiadomościach e-mail (zgoda na newsletter i komunikację bez zmian).'
          END,
          public._email_measurement_consent_version(), false, left(NULLIF(btrim(p_ip), ''), 64),
          left(NULLIF(btrim(p_user_agent), ''), 512), v_s.lang, clock_timestamp());
  RETURN jsonb_build_object('result', 'withdrawn', 'tenant_id', v_s.tenant_id, 'lang', v_s.lang);
END;
$$;

REVOKE ALL ON FUNCTION public.email_measurement_withdraw(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_measurement_withdraw(uuid, uuid, text, text, text) TO service_role;

COMMENT ON FUNCTION public.email_measurement_withdraw(uuid, uuid, text, text, text) IS
  'Zgoda i pomiar (I9d-Y2b R1): wycofanie albo odmowa SAMEGO pomiaru otwarć i kliknięć (subskrybent ALBO kontakt CRM z podpisanego tokenu; kanał email_footer|preferences|account, inny = email_footer) - wpis email_measurement „nie" z kanałem odmowy, wersją treści pomiaru i chwilą zapisu, także bez wcześniejszego „tak" (wyklucza z próśb); zgoda na newsletter bez zmian. already - ostatnia decyzja to już odmowa. Wynik: {result: withdrawn|already|gone|invalid, tenant_id, lang}. Tylko service_role (podpis HMAC sprawdza serwer).';

-- Ciało z 20261020162300; zmiana - pole `refused` (ostatnia decyzja osoby to
-- odmowa): strona linku „Nie mierz" odróżnia „odmowa zapisana" od „pomiar
-- wyłączony, odmowy brak" (przycisk zapisu odmowy).
-- CIALO-Z: 20261020162300
-- rpc-shape: email_measurement_state (result, consent, measured, enabled, tenant_id, lang, refused)
CREATE OR REPLACE FUNCTION public.email_measurement_state(p_subscriber uuid DEFAULT NULL, p_lead uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s record;
  v_consent boolean;
  v_enabled boolean;
  v_refused boolean;
BEGIN
  IF (p_subscriber IS NULL) = (p_lead IS NULL) THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  SELECT * INTO v_s FROM public._email_measurement_subject(p_subscriber, p_lead);
  IF v_s.tenant_id IS NULL THEN
    RETURN jsonb_build_object('result', 'gone');
  END IF;
  v_consent := public._email_measurement_consent(v_s.tenant_id, v_s.email);
  v_enabled := public._newsletter_track_opens(v_s.tenant_id);
  v_refused := COALESCE((SELECT NOT c.given FROM public.crm_consent_log c
                          WHERE c.tenant_id = v_s.tenant_id AND lower(c.email) = lower(v_s.email)
                            AND c.consent_key = 'email_measurement'
                            AND (c.given OR c.form_id = ANY (public._email_measurement_refusal_channels()))
                          ORDER BY c.created_at DESC, c.given, c.id DESC LIMIT 1), false);
  RETURN jsonb_build_object('result', 'ok', 'consent', v_consent, 'measured', v_consent AND v_enabled,
                            'enabled', v_enabled, 'tenant_id', v_s.tenant_id, 'lang', v_s.lang,
                            'refused', v_refused);
END;
$$;

REVOKE ALL ON FUNCTION public.email_measurement_state(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_measurement_state(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.email_measurement_state(uuid, uuid) IS
  'Zgoda i pomiar (I9d-Y2b R1): stan pomiaru dla linku „Nie mierz moich otwarć i kliknięć" (subskrybent ALBO kontakt CRM z podpisanego tokenu). Wynik: {result: ok|gone|invalid, consent, measured, enabled, tenant_id, lang, refused - ostatnia decyzja osoby to odmowa}. Bez mutacji. Tylko service_role.';

-- ----------------------------------------------------------------------------
-- E) Wycofanie zgody newsletter/marketing zamyka łańcuch pomiaru.
-- ----------------------------------------------------------------------------
-- Treści neutralnych wpisów „nie" (wygaśnięcie, nie decyzja osoby o pomiarze).
-- `unsubscribe` = treść `_email_measurement_close_on_unsubscribe` (pgTAP).
CREATE OR REPLACE FUNCTION public._email_measurement_expiry_text(p_reason text, p_lang text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_reason = 'opt_out' AND p_lang = 'en'
      THEN 'Consent to measuring opens and clicks expired - consent to the newsletter or marketing communication was withdrawn.'
    WHEN p_reason = 'opt_out'
      THEN 'Wygaśnięcie zgody na pomiar otwarć i kliknięć - wycofanie zgody na newsletter albo komunikację marketingową.'
    WHEN p_lang = 'en'
      THEN 'Consent to measuring opens and clicks expired - the newsletter subscription ended (unsubscribe, bounce, complaint or staff decision).'
    ELSE 'Wygaśnięcie zgody na pomiar otwarć i kliknięć - koniec subskrypcji newslettera (wypis, odbicie, skarga albo decyzja personelu).'
  END
$$;

REVOKE ALL ON FUNCTION public._email_measurement_expiry_text(text, text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._email_measurement_expiry_text(text, text) IS
  'Zgoda i pomiar (I9d-Y2b R1): treść neutralnego wpisu „nie" pomiaru PL/EN - opt_out (wycofanie zgody newsletter/marketing) albo unsubscribe (koniec subskrypcji; ta sama treść co _email_measurement_close_on_unsubscribe). Wewnętrzna.';

-- Pisarz „nie" przy wycofaniu zgody newsletter/marketing: prosty, sam niczego
-- nie rzuca. Wpis tylko, gdy ostatnie słowo łańcucha pomiaru to „tak"
-- najpóźniej w chwili wycofania (późniejsze „tak" to nowa decyzja - czytelnik
-- też je uznaje); kanał neutralny (nie wyklucza z próśb).
CREATE OR REPLACE FUNCTION public._email_measurement_close_on_opt_out(p_tenant uuid, p_email text, p_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s public.newsletter_subscribers%ROWTYPE;
  v_lang text;
  v_given boolean;
  v_last_at timestamptz;
BEGIN
  SELECT * INTO v_s FROM public.newsletter_subscribers s
   WHERE s.tenant_id = p_tenant AND lower(s.email) = lower(btrim(p_email));
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  v_lang := CASE WHEN v_s.language = 'en' THEN 'en' ELSE 'pl' END;
  PERFORM pg_advisory_xact_lock(hashtextextended('email_measurement:' || v_s.tenant_id::text || ':' || lower(v_s.email), 0));
  SELECT c.given, c.created_at INTO v_given, v_last_at FROM public.crm_consent_log c
   WHERE c.tenant_id = v_s.tenant_id AND lower(c.email) = lower(v_s.email) AND c.consent_key = 'email_measurement'
   ORDER BY c.created_at DESC, c.given, c.id DESC
   LIMIT 1;
  IF v_given IS DISTINCT FROM true OR v_last_at > COALESCE(p_at, 'infinity'::timestamptz) THEN
    RETURN false;
  END IF;
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, form_name, consent_key,
                                      consent_text, consent_version, given, lang, created_at)
  VALUES (v_s.tenant_id, v_s.email, 'newsletter', v_s.id, 'measurement:opt_out', 'email_measurement_opt_out',
          'email_measurement', public._email_measurement_expiry_text('opt_out', v_lang),
          public._email_measurement_consent_version(), false, v_lang, clock_timestamp());
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public._email_measurement_close_on_opt_out(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._email_measurement_close_on_opt_out(uuid, text, timestamptz) IS
  'Zgoda i pomiar (I9d-Y2b R1, sql-r1-4): wpis email_measurement „nie" z kanałem neutralnym measurement:opt_out (wersja pomiaru, chwila zapisu, treść neutralna PL/EN) dla subskrybenta adresu, gdy ostatnie słowo łańcucha pomiaru to „tak" nie późniejsze niż p_at (chwila wycofania zgody newsletter/marketing). Wołają go wyzwalacz trg_crm_consent_log_measurement_opt_out i domknięcie _email_measurement_close_backfill. Zwraca, czy zapisał. Wewnętrzna.';

CREATE OR REPLACE FUNCTION public.tg_crm_consent_log_measurement_opt_out()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._email_measurement_close_on_opt_out(NEW.tenant_id, NEW.email, NEW.created_at);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_crm_consent_log_measurement_opt_out() FROM PUBLIC, anon, authenticated, service_role;

SET lock_timeout = '5s';
DROP TRIGGER IF EXISTS trg_crm_consent_log_measurement_opt_out ON public.crm_consent_log;
CREATE TRIGGER trg_crm_consent_log_measurement_opt_out
  AFTER INSERT ON public.crm_consent_log
  FOR EACH ROW
  WHEN (NEW.consent_key IN ('newsletter', 'marketing') AND NOT NEW.given)
  EXECUTE FUNCTION public.tg_crm_consent_log_measurement_opt_out();
RESET lock_timeout;

COMMENT ON FUNCTION public.tg_crm_consent_log_measurement_opt_out() IS
  'Zgoda i pomiar (I9d-Y2b R1): wpis „nie" newsletter/marketing w rejestrze zgód -> _email_measurement_close_on_opt_out (łańcuch pomiaru nie zależy od retencji łańcucha newsletter/marketing). Wyzwalacz.';

-- ----------------------------------------------------------------------------
-- F) Jednorazowe domknięcie łańcuchów pomiaru.
-- ----------------------------------------------------------------------------
COMMENT ON FUNCTION public._email_measurement_close_on_unsubscribe(uuid) IS
  'Zgoda i pomiar (I9d-Y2b, R1.4): wpis email_measurement „nie" z kanałem neutralnym measurement:unsubscribe (wersja pomiaru, chwila zapisu, treść neutralna PL/EN = _email_measurement_expiry_text(unsubscribe)), gdy ostatnie słowo łańcucha pomiaru brzmi „tak". Woła go wyzwalacz wypisu; wypisy sprzed 20261023090000 domyka _email_measurement_close_backfill (20261023090300). Zwraca, czy zapisał. Wewnętrzna.';
COMMENT ON FUNCTION public.tg_newsletter_unsubscribed_measurement() IS
  'Zgoda i pomiar (I9d-Y2b): przejście subskrybenta na unsubscribed (każdy kanał) -> _email_measurement_close_on_unsubscribe; wypisy sprzed wyzwalacza domyka _email_measurement_close_backfill (20261023090300) - „Przywróć" w panelu nie wskrzesza zgody. Wyzwalacz.';

-- Zestaw „ostatnie słowo" liczony na tym samym obrazie co zapis: blokada
-- rejestru zgód na czas domknięcia zamiast blokad doradczych na adres (ich
-- liczba rosłaby z liczbą wierszy). Powtórka = 0 (ostatnie słowo to już „nie").
CREATE OR REPLACE FUNCTION public._email_measurement_close_backfill()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_version text := public._email_measurement_consent_version();
  v_unsub integer;
  v_opt integer;
BEGIN
  LOCK TABLE public.crm_consent_log IN SHARE ROW EXCLUSIVE MODE;
  -- (1) Koniec subskrypcji: wypisani, także wypisani wcześniej, a dziś
  -- czekający na ponowne potwierdzenie (`pending` z `unsubscribed_at`).
  WITH last AS (
    SELECT s.id, s.tenant_id, s.email, CASE WHEN s.language = 'en' THEN 'en' ELSE 'pl' END AS lang, l.given
      FROM public.newsletter_subscribers s
      CROSS JOIN LATERAL (
        SELECT c.given FROM public.crm_consent_log c
         WHERE c.tenant_id = s.tenant_id AND lower(c.email) = lower(s.email) AND c.consent_key = 'email_measurement'
         ORDER BY c.created_at DESC, c.given, c.id DESC LIMIT 1) l
     WHERE s.status NOT IN ('subscribed', 'confirmed')
       AND (s.status = 'unsubscribed' OR s.unsubscribed_at IS NOT NULL)
  )
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, form_name, consent_key,
                                      consent_text, consent_version, given, lang, created_at)
  SELECT x.tenant_id, x.email, 'newsletter', x.id, 'measurement:unsubscribe', 'email_measurement_unsubscribe',
         'email_measurement', public._email_measurement_expiry_text('unsubscribe', x.lang), v_version, false, x.lang,
         clock_timestamp()
    FROM last x
   WHERE x.given;
  GET DIAGNOSTICS v_unsub = ROW_COUNT;
  -- (2) Aktywni z wycofaniem zgody newsletter/marketing nie wcześniejszym
  -- niż ostatnie „tak" pomiaru (czytelnik już ich nie mierzy - remis też).
  WITH last AS (
    SELECT s.id, s.tenant_id, s.email, CASE WHEN s.language = 'en' THEN 'en' ELSE 'pl' END AS lang,
           l.given, l.created_at AS at,
           (SELECT max(o.created_at) FROM public.crm_consent_log o
             WHERE o.tenant_id = s.tenant_id AND lower(o.email) = lower(s.email)
               AND o.consent_key IN ('newsletter', 'marketing') AND NOT o.given) AS opted_out
      FROM public.newsletter_subscribers s
      CROSS JOIN LATERAL (
        SELECT c.given, c.created_at FROM public.crm_consent_log c
         WHERE c.tenant_id = s.tenant_id AND lower(c.email) = lower(s.email) AND c.consent_key = 'email_measurement'
         ORDER BY c.created_at DESC, c.given, c.id DESC LIMIT 1) l
     WHERE s.status IN ('subscribed', 'confirmed')
  )
  INSERT INTO public.crm_consent_log (tenant_id, email, source_type, source_id, form_id, form_name, consent_key,
                                      consent_text, consent_version, given, lang, created_at)
  SELECT x.tenant_id, x.email, 'newsletter', x.id, 'measurement:opt_out', 'email_measurement_opt_out',
         'email_measurement', public._email_measurement_expiry_text('opt_out', x.lang), v_version, false, x.lang,
         clock_timestamp()
    FROM last x
   WHERE x.given AND x.opted_out IS NOT NULL AND x.at <= x.opted_out;
  GET DIAGNOSTICS v_opt = ROW_COUNT;
  RETURN v_unsub + v_opt;
END;
$$;

REVOKE ALL ON FUNCTION public._email_measurement_close_backfill() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._email_measurement_close_backfill() IS
  'Zgoda i pomiar (I9d-Y2b R1, sql-r1-3/sql-r1-4): jednorazowe domknięcie łańcuchów pomiaru - wypisani (także pending z unsubscribed_at) z ostatnim słowem „tak" -> „nie" measurement:unsubscribe; aktywni z wycofaniem newsletter/marketing nie wcześniejszym niż ostatnie „tak" -> „nie" measurement:opt_out. Blokada SHARE ROW EXCLUSIVE rejestru zgód na czas domknięcia. Zwraca liczbę wpisów; powtórka = 0. Wewnętrzna.';

SET lock_timeout = '5s';
SELECT public._email_measurement_close_backfill();
RESET lock_timeout;
