-- ============================================================================
-- ZGODA NA POMIAR OTWARĆ I KLIKNIĘĆ JAKO OSOBNE POLE (I9d-Y2b, 2/3): DECYZJA
-- WŁAŚCICIELA SKRZYNKI NA STRONIE DOUBLE OPT-IN I PROŚBA PO ZAPISIE BEZ DOI.
-- Decyzje właściciela 2026-10-23: D1 wariant (b), D2 - pomiar tylko dla
-- skrzynki potwierdzonej przez jej właściciela.
--
-- DEFEKT
--   1. Zaznaczone pole pomiaru w formularzu to tylko DEKLARACJA (osoba
--      trzecia może wpisać cudzy adres). Od 20261023090000 nie powstaje z niej
--      zgoda - brak drogi, na której właściciel skrzynki sam ją potwierdza.
--   2. Potwierdzenie double opt-in to GET wywoływany przez `fetch` strony
--      (`src/routes/newsletter.confirm.tsx`) - nie może nieść zgody.
--
-- ZMIANA (projekt I9d-Y2b §3.A9-A10, rozstrzygnięcia R1.6, R1.12, R1.13)
--   A. `newsletter_doi_measurement_state(token)` (service_role, bez mutacji):
--      stan decyzji po tokenie DOI dla karty „Zgoda na pomiar" na stronie
--      potwierdzenia - {result: offer|granted|declined|none|inactive|gone|
--      invalid, lang}. Token zostaje w wierszu po potwierdzeniu, wypis go
--      zeruje (wypisany = invalid; personel i lista wyłączeń go nie zerują -
--      wtedy inactive).
--   B. `newsletter_doi_measurement_decide(token, decyzja, ip, ua)`
--      (service_role, POST strony): „tak" przez `_email_measurement_grant`
--      z kanałem `measurement:doi`, „nie" - wpis `measurement:doi_declined`
--      (kanał własnej odmowy, wyklucza z próśb). Tylko w stanie `offer`
--      (deklaracja nie starsza niż 60 dni, bez wcześniejszej decyzji).
--   C. `newsletter_measurement_requests.origin` (`panel` | `signup`)
--      i `newsletter_measurement_request_signup(subskrybent)` (service_role):
--      prośba o potwierdzenie ze STAŁĄ treścią maila po zapisie bez DOI
--      i w gałęzi „już zapisany" - tylko w stanie `offer`; jedna na wersję
--      treści i subskrybenta (klucz główny tabeli próśb).
--   Najemca zawsze z wiersza subskrybenta (token, identyfikator), nigdy
--   z parametru. Odpowiedzi bez adresu e-mail.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261023090000 (pisarz „tak", stan oferty), przed
-- 20261023090200 (wysyłka próśb rozróżnia `origin`). Trasa TS
-- `api.public.newsletter.confirm` (GET stan, POST decyzja) - po tej migracji.
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, CHECK dodawany warunkowo, CREATE OR
-- REPLACE FUNCTION, bezstanowe REVOKE/GRANT/COMMENT. Zero zmian danych.
-- DOWÓD: supabase/tests/hub_i9d_y2b_measurement_separate_test.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- C1) Pochodzenie prośby o zgodę na pomiar.
-- ----------------------------------------------------------------------------
SET lock_timeout = '5s';
ALTER TABLE public.newsletter_measurement_requests
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'panel';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'newsletter_measurement_requests_origin_check'
                    AND conrelid = 'public.newsletter_measurement_requests'::regclass) THEN
    ALTER TABLE public.newsletter_measurement_requests
      ADD CONSTRAINT newsletter_measurement_requests_origin_check CHECK (origin IN ('panel', 'signup'));
  END IF;
END $$;
RESET lock_timeout;

COMMENT ON COLUMN public.newsletter_measurement_requests.origin IS
  'Zgoda i pomiar (I9d-Y2b): skąd prośba - panel („Poproś o zgodę na pomiar", treść z panelu, budżet wspólny z wygaszaniem Y1) albo signup (deklaracja w formularzu bez double opt-in, stała treść maila, własny budżet i bez okna wysyłki).';
COMMENT ON COLUMN public.newsletter_measurement_requests.consent_version IS
  'Zgoda i pomiar (I9d-Y2b): wersja treści OSOBNEJ zgody na pomiar, o którą prosimy (_email_measurement_consent_version); nowa wersja = nowa prośba możliwa, ta sama - nigdy druga. Wiersze sprzed 20261023090000 mogą nieść wersję treści zgody na newsletter (a).';

-- ----------------------------------------------------------------------------
-- A) Stan decyzji na stronie potwierdzenia double opt-in.
-- ----------------------------------------------------------------------------
-- rpc-shape: newsletter_doi_measurement_state (result, lang)
CREATE OR REPLACE FUNCTION public.newsletter_doi_measurement_state(p_token text)
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
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  RETURN jsonb_build_object('result', public._newsletter_measurement_offer_state(v_s.id),
                            'lang', CASE WHEN v_s.language = 'en' THEN 'en' ELSE 'pl' END);
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_doi_measurement_state(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_doi_measurement_state(text) TO service_role;

COMMENT ON FUNCTION public.newsletter_doi_measurement_state(text) IS
  'Zgoda i pomiar (I9d-Y2b): stan decyzji o pomiarze po tokenie potwierdzenia double opt-in (karta na stronie potwierdzenia; bez mutacji, GET nigdy nie udziela zgody). Wynik: {result: offer | granted | declined | none | inactive | gone | invalid, lang: pl|en} (invalid - bez lang). Tylko service_role.';

-- ----------------------------------------------------------------------------
-- B) Decyzja na stronie potwierdzenia double opt-in (POST).
-- ----------------------------------------------------------------------------
-- rpc-shape: newsletter_doi_measurement_decide (result, lang)
CREATE OR REPLACE FUNCTION public.newsletter_doi_measurement_decide(
  p_token text, p_grant boolean, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL)
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
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  v_lang := CASE WHEN v_s.language = 'en' THEN 'en' ELSE 'pl' END;
  PERFORM pg_advisory_xact_lock(hashtextextended('email_measurement:' || v_s.tenant_id::text || ':' || lower(v_s.email), 0));
  v_state := public._newsletter_measurement_offer_state(v_s.id);
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

REVOKE ALL ON FUNCTION public.newsletter_doi_measurement_decide(text, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_doi_measurement_decide(text, boolean, text, text) TO service_role;

COMMENT ON FUNCTION public.newsletter_doi_measurement_decide(text, boolean, text, text) IS
  'Zgoda i pomiar (I9d-Y2b): decyzja o pomiarze na stronie potwierdzenia double opt-in (POST z tokenem DOI; tylko w stanie offer): p_grant = true -> _email_measurement_grant z kanałem measurement:doi (treść i wersja pola pomiaru, IP, UA), false -> wpis „nie" measurement:doi_declined. Wynik: {result: granted | declined | already | inactive | none | gone | invalid, lang}; p_grant NULL - 22023 decision_invalid. Tylko service_role.';

-- ----------------------------------------------------------------------------
-- C2) Prośba o potwierdzenie po zapisie bez double opt-in.
-- ----------------------------------------------------------------------------
-- rpc-shape: newsletter_measurement_request_signup (result)
CREATE OR REPLACE FUNCTION public.newsletter_measurement_request_signup(p_subscriber uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state text;
  v_tenant uuid;
  v_n integer;
BEGIN
  IF p_subscriber IS NULL THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  v_state := public._newsletter_measurement_offer_state(p_subscriber);
  IF v_state <> 'offer' THEN
    -- gone | inactive | granted | none | declined
    RETURN jsonb_build_object('result', v_state);
  END IF;
  SELECT s.tenant_id INTO v_tenant FROM public.newsletter_subscribers s WHERE s.id = p_subscriber;
  INSERT INTO public.newsletter_measurement_requests (subscriber_id, consent_version, tenant_id, requested_by, origin)
  VALUES (p_subscriber, public._email_measurement_consent_version(), v_tenant, NULL, 'signup')
  ON CONFLICT (subscriber_id, consent_version) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('result', CASE WHEN v_n = 1 THEN 'requested' ELSE 'exists' END);
END;
$$;

REVOKE ALL ON FUNCTION public.newsletter_measurement_request_signup(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_measurement_request_signup(uuid) TO service_role;

COMMENT ON FUNCTION public.newsletter_measurement_request_signup(uuid) IS
  'Zgoda i pomiar (I9d-Y2b): prośba o potwierdzenie zgody na pomiar po zapisie bez double opt-in albo przy ponownym zapisie aktywnego adresu (origin signup, stała treść maila; jedna na wersję treści pomiaru i subskrybenta) - tylko w stanie offer (aktywny subskrybent z deklaracją nie starszą niż 60 dni, bez zgody i bez późniejszego „nie"). Wynik: {result: requested | exists | invalid | gone | inactive | granted | none | declined}. Tylko service_role.';
