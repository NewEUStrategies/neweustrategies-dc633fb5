-- events-harness: include
-- ============================================================================
-- ZGODY UCZESTNIKOW WYDARZEN: POTWIERDZENIE DOUBLE OPT-IN, WYCOFANIE (KLUCZ
-- SAMOOBSLUGI, KONTO), STAN ZGOD UCZESTNIKA I WGLAD ORGANIZATORA
-- (REG-02 / REG-14, JEDNOSTKA B3).
--
-- DEFEKT.
--   1. REG-14: nic w bazie nie WYCOFUJE zgody uczestnika. Kazde przypisanie
--      `consent_withdrawn_at` w migracjach to `= NULL` (20261007140400:551,
--      20260827221214:664), nie ma RPC, ekranu ani linku, ktory zgasilby
--      marketing albo udostepnianie partnerom, a `crm_leads.marketing_consent`
--      tylko rosnie (most 20260927001400:328). Art. 7 ust. 3 RODO: wycofanie
--      ma byc rownie latwe jak udzielenie.
--   2. REG-02: rejestr zgod (A2, 20261012100100..100300) i rdzen zapisu (B1a,
--      20261012140000) wydaja niezweryfikowanemu zapisujacemu link double
--      opt-in (`/event-consent/confirm#token=`), ale nie ma funkcji, ktora ten
--      link POTWIERDZA - zgoda marketingu/partnerow z formularza zostaje na
--      zawsze 'pending', a organizator nie widzi, co przyslal ktos, kto nie
--      byl wlascicielem adresu (`event_registrations.submitted_profile`).
--
-- ZMIANA (wszystko przez funkcje rejestru A2 - ta migracja NIE pisze kolumn
-- zgod `event_people` sama; pilnuje tego event_consent_writers_test.sql):
--   A. `_event_consent_confirmation_state(link)` - jedna regula stanu linku:
--      already (potwierdzony), expired (zastapiony, po terminie albo adres
--      osoby inny niz adres, na ktory poszedl mail), open.
--   B. `event_consent_confirmation_preview(_tenant_id, token)` - PODGLAD dla
--      strony linku (GET niczego nie zmienia - skanery poczty otwieraja kazdy
--      adres z maila): stan, cele, wydarzenie, dokladne teksty zgod. Bez
--      adresu, imienia i nazwiska. Tylko service_role.
--   C. `event_consent_confirm_for_request(_tenant_id, _user_id, _ip_subject,
--      _user_agent, token)` - POTWIERDZENIE (POST z przycisku): kubelek
--      `event_consent_confirm` (30 / 10 min na najemce i adres, odmowa
--      wartoscia - licznik zostaje), link po sha256 z blokada wiersza, link
--      nieuzywalny zostaje oznaczony jako zastapiony, stempel `confirmed_*`,
--      `_event_person_consents_confirm(..., 'email_double_opt_in', ...)`
--      i - dla marketingu - most CRM, ktory zapisuje zgode z prawdziwym
--      tekstem, wersja, skrotem IP i user agentem z ksiegi.
--   D. `event_consent_withdraw_for_request(_tenant_id, _user_id, _ip_subject,
--      _user_agent, payload)` - WYCOFANIE: osoba WYLACZNIE z klucza
--      samoobslugi (resolver A1, cel 'view' - dziala po anulowaniu i po
--      wygasnieciu klucza: wycofanie to prawo, nie usluga wydarzenia) albo
--      z konta dowiazanego do osoby; nigdy z identyfikatora ani adresu
--      w ladunku. Kubelek `event_consent_withdraw` (20 / 10 min). Odpowiedz
--      STALA `{ok:true}` - nie mowi, czy osoba istnieje i co miala.
--   E. `event_my_consent_state()` - stan zgod zalogowanego uczestnika (osoba
--      najemcy hosta dowiazana do konta), otwarty link DOI i 20 ostatnich
--      wpisow ksiegi (art. 15 RODO). authenticated.
--   F. `admin_event_registration_consent_detail(zgloszenie)` - organizator
--      widzi dane przyslane przy zapisie obok kartoteki (lista roznic), ksiege
--      zgod osoby i otwarty link DOI. Najemca z `assert_event_admin_tenant()`
--      (admin albo super_admin), nigdy z argumentu.
--
-- CZEGO TO NIE ZAMYKA: wypis z maila (`email_unsubscribe_by_token`) -
--   20261012130200; nabor prelegentow (`_event_cfp_resolve_person`) -
--   20261012130100. Wysylka maila DOI i stempel `mailed_at` naleza do sciezki
--   zapisu (B1b). Zgoda na przetwarzanie danych nie jest tu wycofywana - jej
--   koniec to rezygnacja albo usuniecie danych. Wlasciciel klucza samoobslugi
--   moze wycofac zgody osoby, ktorej klucz dotyczy (bezpieczne w skutkach:
--   wycofanie niczego nie udziela, opisane w raporcie jako znane ryzyko).
--
-- KOLEJNOSC WDROZENIA: po 20261012100100..100300 (rejestr) i 20261012100000
--   (resolver klucza). Nowe funkcje - dowolna wzgledem kodu (TS przy
--   PGRST202/42883 pokazuje stan "niedostepne", nie wola niczego innego).
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT.
-- DOWOD: supabase/tests/event_consent_confirm_withdraw_test.sql,
--   scripts/events-harness/runtime_test.d/26_consent_confirm_withdraw.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) STAN LINKU DOUBLE OPT-IN
-- ----------------------------------------------------------------------------
-- Jedna regula dla podgladu i potwierdzenia - dwie kopie rozjechalyby sie przy
-- pierwszej poprawce (podglad mowilby "potwierdz", a przycisk "wygasl").
-- Termin jak w `_event_person_consents_confirm` (A2): potwierdzenie dokladnie
-- w chwili `expires_at` jeszcze przechodzi. Adres osoby inny niz adres linku
-- (organizator zmienil e-mail, kartoteka bez adresu) = link nie jest juz
-- dowodem dla tej skrzynki.
CREATE OR REPLACE FUNCTION public._event_consent_confirmation_state(p_conf public.event_consent_confirmations)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_conf.id IS NULL THEN 'not_found'
    WHEN p_conf.confirmed_at IS NOT NULL THEN 'already'
    WHEN p_conf.superseded_at IS NOT NULL THEN 'expired'
    WHEN now() > p_conf.expires_at THEN 'expired'
    WHEN NOT EXISTS (
      SELECT 1
        FROM public.event_people p
       WHERE p.tenant_id = p_conf.tenant_id
         AND p.id = p_conf.person_id
         AND p.email_norm = p_conf.email_norm
    ) THEN 'expired'
    ELSE 'open'
  END;
$$;

REVOKE ALL ON FUNCTION public._event_consent_confirmation_state(public.event_consent_confirmations)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_consent_confirmation_state(public.event_consent_confirmations)
  TO service_role;

COMMENT ON FUNCTION public._event_consent_confirmation_state(public.event_consent_confirmations) IS
  'Wewnetrzna (REG-14): stan linku double opt-in - not_found (brak wiersza), already (potwierdzony), expired (zastapiony, now() > expires_at albo adres osoby inny niz adres linku), open. Jedna regula podgladu i potwierdzenia.';

-- ----------------------------------------------------------------------------
-- B) PODGLAD LINKU (GET strony potwierdzenia)
-- ----------------------------------------------------------------------------
-- Niczego nie zmienia i nie liczy kubelka: token to 24 losowe bajty (zgadywanie
-- nie ma sensu), a podglad nie oddaje danych osobowych - tylko stan, cele,
-- wydarzenie i teksty zgod, ktore osoba ma potwierdzic. Ksztalt tokenu jak
-- klucz samoobslugi; zly ksztalt to `not_found` bez liczenia skrotu.
CREATE OR REPLACE FUNCTION public.event_consent_confirmation_preview(_tenant_id uuid, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_token text := btrim(COALESCE(p_token, ''));
  v_conf public.event_consent_confirmations%ROWTYPE;
  v_state text;
  v_event jsonb;
  v_texts jsonb;
BEGIN
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant is required';
  END IF;
  IF v_token !~ '^[A-Za-z0-9_-]{32}$' THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  SELECT c.* INTO v_conf
    FROM public.event_consent_confirmations c
   WHERE c.tenant_id = _tenant_id
     AND c.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  v_state := public._event_consent_confirmation_state(v_conf);

  SELECT jsonb_build_object(
           'slug', e.slug,
           'title_pl', e.title_pl,
           'title_en', e.title_en,
           'starts_at', e.starts_at,
           'timezone', e.timezone)
    INTO v_event
    FROM public.events e
   WHERE e.tenant_id = _tenant_id AND e.id = v_conf.event_id;

  -- Teksty, ktore osoba widziala przy zapisie (wersja i jezyk z linku) - to
  -- je potwierdza, a nie biezace napisy formularza.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('purpose', t.purpose, 'body', t.body)
                            ORDER BY t.purpose), '[]'::jsonb)
    INTO v_texts
    FROM public.event_consent_texts t
   WHERE t.purpose = ANY (v_conf.purposes)
     AND t.version = v_conf.text_version
     AND t.lang = v_conf.text_lang;

  RETURN jsonb_build_object(
    'state', v_state,
    'purposes', to_jsonb(v_conf.purposes),
    'lang', v_conf.text_lang,
    'text_version', v_conf.text_version,
    'expires_at', v_conf.expires_at,
    'event', v_event,
    'texts', v_texts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_consent_confirmation_preview(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_consent_confirmation_preview(uuid, text) TO service_role;

COMMENT ON FUNCTION public.event_consent_confirmation_preview(uuid, text) IS
  'REG-14, strona /event-consent/confirm (GET): stan linku double opt-in {state: open|already|expired|not_found, purposes, lang, text_version, expires_at, event{slug,title_pl,title_en,starts_at,timezone}, texts[{purpose,body}]}. Niczego nie zmienia, bez danych osobowych. Najemca z zaufanego hosta (argument) - tylko service_role (previewEventConsent).';

-- ----------------------------------------------------------------------------
-- C) POTWIERDZENIE LINKU (POST z przycisku)
-- ----------------------------------------------------------------------------
-- KUBELEK PRZED WSZYSTKIM I POZA PODTRANSAKCJA: kazda proba sie liczy, odmowy
-- wracaja wartoscia (wyjatek wycofalby licznik). Klucz: najemca + solony
-- skrot adresu - ten sam adres na dwoch domenach to dwa kubelki.
CREATE OR REPLACE FUNCTION public.event_consent_confirm_for_request(
  _tenant_id uuid,
  _user_id uuid,
  _ip_subject text,
  _user_agent text,
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_token text := btrim(COALESCE(p_token, ''));
  v_user_agent text := left(NULLIF(btrim(COALESCE(_user_agent, '')), ''), 400);
  v_allowed boolean;
  v_conf public.event_consent_confirmations%ROWTYPE;
  v_state text;
  v_slug text;
BEGIN
  -- Tozsamosc od serwera: najemca z zaufanego hosta, konto z sesji (albo
  -- NULL - link z maila dziala bez logowania), solony skrot adresu. Brak
  -- ktoregos to blad serwera, nie odpowiedz o linku.
  IF _user_id IS NULL THEN
    PERFORM public._require_server_probe(_tenant_id, _ip_subject);
  ELSE
    PERFORM public._require_server_identity(_tenant_id, _user_id, _ip_subject);
  END IF;

  SELECT h.allowed INTO v_allowed
    FROM public.rate_limit_hit('event_consent_confirm', _tenant_id::text || ':' || _ip_subject, 30, 10) h;
  IF NOT COALESCE(v_allowed, false) THEN
    RETURN jsonb_build_object('ok', false, 'state', 'rate_limited');
  END IF;

  IF v_token !~ '^[A-Za-z0-9_-]{32}$' THEN
    RETURN jsonb_build_object('ok', false, 'state', 'not_found');
  END IF;

  -- Blokada wiersza linku: dwa rownolegle klikniecia nie potwierdza dwa razy
  -- (drugie czeka i widzi `already`).
  SELECT c.* INTO v_conf
    FROM public.event_consent_confirmations c
   WHERE c.tenant_id = _tenant_id
     AND c.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'not_found');
  END IF;

  v_state := public._event_consent_confirmation_state(v_conf);
  IF v_state = 'already' THEN
    RETURN jsonb_build_object('ok', true, 'state', 'already', 'purposes', to_jsonb(v_conf.purposes));
  END IF;
  IF v_state <> 'open' THEN
    -- Link, ktory nie moze juz niczego udzielic (po terminie albo na adres,
    -- ktorego osoba juz nie ma), przestaje byc otwarty: kolejny zapis nie
    -- musi go zastepowac, a podglad mowi to samo co przycisk.
    IF v_conf.confirmed_at IS NULL AND v_conf.superseded_at IS NULL THEN
      UPDATE public.event_consent_confirmations c
         SET superseded_at = now()
       WHERE c.tenant_id = _tenant_id AND c.id = v_conf.id;
    END IF;
    RETURN jsonb_build_object('ok', false, 'state', 'expired');
  END IF;

  -- PODTRANSAKCJA: odmowa funkcji rejestru (druga linia obrony A2) wycofuje
  -- stempel linku i wpisy ksiegi, ale nie kubelek wyzej.
  BEGIN
    UPDATE public.event_consent_confirmations c
       SET confirmed_at = now(),
           confirmed_ip_subject = _ip_subject,
           confirmed_user_agent = v_user_agent,
           confirmed_by_user = _user_id
     WHERE c.tenant_id = _tenant_id AND c.id = v_conf.id;

    PERFORM public._event_person_consents_confirm(
      _tenant_id, v_conf.person_id, v_conf.purposes, 'email_double_opt_in',
      v_conf.event_id, v_conf.registration_id, v_conf.id,
      v_conf.text_version, v_conf.text_lang, _ip_subject, v_user_agent,
      _user_id, 'event_consent_confirm', true);
  EXCEPTION WHEN raise_exception THEN
    RAISE WARNING 'event_consent_confirm_for_request: confirmation % refused (%)', v_conf.id, left(SQLERRM, 200);
    RETURN jsonb_build_object('ok', false, 'state', 'expired');
  END;

  -- Zgoda marketingowa trafia do CRM dopiero teraz - z dowodem z ksiegi
  -- (prawdziwy tekst wersji, 'event-marketing-v<n>-<jezyk>', skrot IP i user
  -- agent potwierdzenia). Most nigdy nie rzuca; blad zostaje w jego stanie.
  IF 'marketing' = ANY (v_conf.purposes) THEN
    SELECT e.slug INTO v_slug
      FROM public.events e
     WHERE e.tenant_id = _tenant_id AND e.id = v_conf.event_id;
    PERFORM public._event_person_crm_sync(
      _tenant_id,
      v_conf.person_id,
      'event_participant',
      CASE WHEN v_slug IS NOT NULL THEN 'event:' || v_slug || ':consent' ELSE 'event:consent' END,
      CASE WHEN v_slug IS NOT NULL THEN ARRAY['event:' || v_slug] ELSE '{}'::text[] END,
      '{}'::jsonb,
      true,
      'event.consent.confirmed',
      jsonb_strip_nulls(jsonb_build_object(
        'event_id', v_conf.event_id,
        'registration_id', v_conf.registration_id,
        'confirmation_id', v_conf.id,
        'summary_pl', 'Uczestnik potwierdzil zgode marketingowa linkiem z maila',
        'summary_en', 'The participant confirmed marketing consent with the e-mail link'))
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'state', 'confirmed', 'purposes', to_jsonb(v_conf.purposes));
END;
$$;

REVOKE ALL ON FUNCTION public.event_consent_confirm_for_request(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_consent_confirm_for_request(uuid, uuid, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.event_consent_confirm_for_request(uuid, uuid, text, text, text) IS
  'REG-02/REG-14: potwierdzenie linku double opt-in (POST z /event-consent/confirm, confirmEventConsent) - TYLKO service_role. Najemca z hosta, konto z sesji (NULL = bez logowania), solony skrot adresu ip:<32 hex> i user agent - argumentami. Kubelek event_consent_confirm 30 / 10 min na najemce i adres (odmowa wartoscia). {ok, state: confirmed|already|expired|not_found|rate_limited, purposes?}. Link nieuzywalny (po terminie, inny adres osoby) zostaje oznaczony superseded_at. Zgody przez _event_person_consents_confirm(email_double_opt_in), marketing do CRM przez _event_person_crm_sync.';

-- ----------------------------------------------------------------------------
-- D) WYCOFANIE (klucz samoobslugi albo konto)
-- ----------------------------------------------------------------------------
-- KTO JEST OSOBA - WYLACZNIE z poswiadczenia:
--   * klucz samoobslugi -> zgloszenie -> osoba (dowod `manage_token`). Cel
--     'view': klucz dziala takze po anulowaniu zgloszenia, a werdykt 'expired'
--     (po koncu wydarzenia) nie blokuje wycofania - zgode wycofuje sie
--     w dowolnej chwili (art. 7 ust. 3 RODO);
--   * konto z sesji -> osoba dowiazana do konta w najemcy (dowod
--     `account_settings`).
-- Identyfikatora osoby ani adresu z ladunku funkcja NIE czyta: inaczej
-- kazdy moglby wycofac (albo sprawdzic) cudze zgody po samym e-mailu.
-- ODPOWIEDZ STALA. `{ok:true}` dla osoby ze zgodami, bez zgod, nieistniejacej
-- i dla nieznanego klucza - wynik nie jest wyrocznia stanu cudzych zgod.
CREATE OR REPLACE FUNCTION public.event_consent_withdraw_for_request(
  _tenant_id uuid,
  _user_id uuid,
  _ip_subject text,
  _user_agent text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c_neutral CONSTANT jsonb := '{"ok": true}'::jsonb;
  v_payload jsonb := CASE WHEN jsonb_typeof(p_payload) = 'object' THEN p_payload ELSE '{}'::jsonb END;
  v_raw jsonb;
  v_items text[];
  v_purposes text[];
  v_token text;
  v_user_agent text := left(NULLIF(btrim(COALESCE(_user_agent, '')), ''), 400);
  v_allowed boolean;
  v_registration uuid;
  v_person uuid;
  v_evidence text;
BEGIN
  IF _user_id IS NULL THEN
    PERFORM public._require_server_probe(_tenant_id, _ip_subject);
  ELSE
    PERFORM public._require_server_identity(_tenant_id, _user_id, _ip_subject);
  END IF;

  SELECT h.allowed INTO v_allowed
    FROM public.rate_limit_hit('event_consent_withdraw', _tenant_id::text || ':' || _ip_subject, 20, 10) h;
  IF NOT COALESCE(v_allowed, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  -- Cele: 'all' | 'marketing' | 'partner_sharing' albo tablica tych wartosci.
  -- Zgody na przetwarzanie danych nie wycofuje sie tutaj (podstawa obslugi
  -- zapisu - jej koniec to rezygnacja).
  v_raw := v_payload->'purposes';
  IF jsonb_typeof(v_raw) = 'string' THEN
    v_items := ARRAY[v_raw #>> '{}'];
  ELSIF jsonb_typeof(v_raw) = 'array' AND jsonb_array_length(v_raw) BETWEEN 1 AND 3 THEN
    v_items := ARRAY(SELECT x FROM jsonb_array_elements_text(v_raw) AS x);
  END IF;
  IF v_items IS NULL OR EXISTS (
       SELECT 1 FROM unnest(v_items) AS u(x)
        WHERE u.x IS NULL OR u.x NOT IN ('all', 'marketing', 'partner_sharing')
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_payload');
  END IF;
  v_purposes := CASE
    WHEN 'all' = ANY (v_items) THEN ARRAY['marketing', 'partner_sharing']::text[]
    ELSE ARRAY(SELECT DISTINCT u.x FROM unnest(v_items) AS u(x) ORDER BY 1)
  END;

  v_token := NULLIF(btrim(COALESCE(v_payload->>'manage_token', '')), '');
  IF v_token IS NOT NULL THEN
    SELECT k.registration_id INTO v_registration
      FROM public._event_manage_token_resolve(_tenant_id, v_token, 'view') k
     WHERE k.verdict IN ('ok', 'expired');
    IF v_registration IS NOT NULL THEN
      SELECT r.person_id INTO v_person
        FROM public.event_registrations r
       WHERE r.tenant_id = _tenant_id AND r.id = v_registration;
    END IF;
    v_evidence := 'manage_token';
  ELSIF _user_id IS NOT NULL THEN
    SELECT p.id INTO v_person
      FROM public.event_people p
     WHERE p.tenant_id = _tenant_id AND p.user_id = _user_id;
    v_evidence := 'account_settings';
  END IF;

  IF v_person IS NOT NULL THEN
    PERFORM public._event_person_consents_withdraw(
      _tenant_id, v_person, v_purposes, v_evidence, _ip_subject, v_user_agent,
      _user_id, 'event_consent_withdraw:' || v_evidence);
  END IF;

  RETURN c_neutral;
END;
$$;

REVOKE ALL ON FUNCTION public.event_consent_withdraw_for_request(uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_consent_withdraw_for_request(uuid, uuid, text, text, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.event_consent_withdraw_for_request(uuid, uuid, text, text, jsonb) IS
  'REG-14: wycofanie zgod marketing/partner_sharing (withdrawEventConsents) - TYLKO service_role. Ladunek {purposes: all|marketing|partner_sharing|[...], manage_token?}. Osoba WYLACZNIE z klucza samoobslugi (_event_manage_token_resolve cel view; takze zgloszenie anulowane i klucz wygasly; dowod manage_token) albo z konta _user_id dowiazanego do osoby (account_settings) - nigdy z identyfikatora ani adresu w ladunku. Kubelek event_consent_withdraw 20 / 10 min. Odpowiedz stala {ok:true} (bez ujawniania stanu); {ok:false,error:rate_limited|invalid_payload}.';

-- ----------------------------------------------------------------------------
-- E) STAN ZGOD ZALOGOWANEGO UCZESTNIKA (art. 15 RODO)
-- ----------------------------------------------------------------------------
-- Najemca z hosta, osoba po `auth.uid()` (dowiazanie wylacznie przez
-- `_event_bind_uid_for_email`, D1). Bez skrotu IP i user agenta w wyniku - to
-- dowod dla organizatora, a uczestnikowi wystarczy, co, kiedy i jakim kanalem.
CREATE OR REPLACE FUNCTION public.event_my_consent_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_person public.event_people%ROWTYPE;
  v_open jsonb;
  v_ledger jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to see your event consents';
  END IF;

  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = v_tenant AND p.user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'linked', false,
      'email', NULL,
      'consents', NULL,
      'open_confirmation', NULL,
      'ledger', '[]'::jsonb);
  END IF;

  SELECT jsonb_build_object(
           'purposes', to_jsonb(c.purposes),
           'created_at', c.created_at,
           'expires_at', c.expires_at)
    INTO v_open
    FROM public.event_consent_confirmations c
   WHERE c.tenant_id = v_tenant
     AND c.person_id = v_person.id
     AND c.confirmed_at IS NULL
     AND c.superseded_at IS NULL
     AND c.expires_at >= now()
   ORDER BY c.created_at DESC
   LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'purpose', r.purpose,
           'status', r.status,
           'evidence', r.evidence,
           'created_at', r.created_at,
           'text_version', r.text_version,
           'text_lang', r.text_lang,
           'event_id', r.event_id,
           'event_title_pl', e.title_pl,
           'event_title_en', e.title_en
         ) ORDER BY r.seq DESC), '[]'::jsonb)
    INTO v_ledger
    FROM (
      SELECT x.*
        FROM public.event_consent_records x
       WHERE x.tenant_id = v_tenant AND x.person_id = v_person.id
       ORDER BY x.seq DESC
       LIMIT 20
    ) r
    LEFT JOIN public.events e ON e.tenant_id = r.tenant_id AND e.id = r.event_id;

  RETURN jsonb_build_object(
    'linked', true,
    'email', v_person.email,
    'consents', jsonb_build_object(
      'data_processing_at', v_person.consent_data_processing_at,
      'marketing_at', v_person.consent_marketing_at,
      'partner_sharing_at', v_person.consent_partner_sharing_at,
      'withdrawn_at', v_person.consent_withdrawn_at),
    'open_confirmation', v_open,
    'ledger', v_ledger);
END;
$$;

REVOKE ALL ON FUNCTION public.event_my_consent_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_consent_state() TO authenticated, service_role;

COMMENT ON FUNCTION public.event_my_consent_state() IS
  'REG-14 (art. 15 RODO): zgody zalogowanego uczestnika w najemcy hosta - osoba po auth.uid() (event_people.user_id). {linked, email, consents{data_processing_at, marketing_at, partner_sharing_at, withdrawn_at}, open_confirmation{purposes, created_at, expires_at}|null, ledger[20 ostatnich: purpose, status, evidence, created_at, text_version, text_lang, event_id, event_title_pl/en]}. Bez skrotu IP i user agenta. auth_required bez sesji.';

-- ----------------------------------------------------------------------------
-- F) WGLAD ORGANIZATORA: DANE Z ZAPISU, KSIEGA, OTWARTY LINK
-- ----------------------------------------------------------------------------
-- Osobne RPC zamiast nowych kolumn `admin_event_registrations_list`: lista
-- jest RETURNS TABLE (zmiana ksztaltu = DROP i nowe typy w calym panelu),
-- a szczegol zgod jest potrzebny dopiero po rozwinieciu wiersza. Roznice
-- liczone kluczami `submitted_profile` (rdzen zapisu zapisuje tylko pola,
-- ktore przyslano, i tylko gdy cos sie roznilo).
CREATE OR REPLACE FUNCTION public.admin_event_registration_consent_detail(p_registration_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_reg record;
  v_person public.event_people%ROWTYPE;
  v_current jsonb;
  v_submitted jsonb;
  v_differences text[];
  v_open jsonb;
  v_ledger jsonb;
BEGIN
  IF p_registration_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: registration_id is required';
  END IF;

  SELECT r.id, r.person_id, r.event_id, r.submitted_profile
    INTO v_reg
    FROM public.event_registrations r
   WHERE r.tenant_id = v_tenant AND r.id = p_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = v_tenant AND p.id = v_reg.person_id;

  v_current := jsonb_build_object(
    'first_name', v_person.first_name,
    'last_name', v_person.last_name,
    'email', v_person.email,
    'phone', v_person.phone,
    'job_title', v_person.job_title,
    'company_text', v_person.company_text,
    'social_profile_url', v_person.social_profile_url);
  v_submitted := CASE
    WHEN jsonb_typeof(v_reg.submitted_profile) = 'object' THEN v_reg.submitted_profile
  END;
  v_differences := ARRAY(
    SELECT s.key
      FROM jsonb_each(COALESCE(v_submitted, '{}'::jsonb)) AS s(key, value)
     WHERE v_current->s.key IS DISTINCT FROM s.value
     ORDER BY s.key
  );

  SELECT jsonb_build_object(
           'purposes', to_jsonb(c.purposes),
           'event_id', c.event_id,
           'registration_id', c.registration_id,
           'created_at', c.created_at,
           'expires_at', c.expires_at,
           'mailed_at', c.mailed_at)
    INTO v_open
    FROM public.event_consent_confirmations c
   WHERE c.tenant_id = v_tenant
     AND c.person_id = v_reg.person_id
     AND c.confirmed_at IS NULL
     AND c.superseded_at IS NULL
     AND c.expires_at >= now()
   ORDER BY c.created_at DESC
   LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'purpose', r.purpose,
           'status', r.status,
           'evidence', r.evidence,
           'created_at', r.created_at,
           'text_version', r.text_version,
           'text_lang', r.text_lang,
           'event_id', r.event_id,
           'registration_id', r.registration_id,
           'email_norm', r.email_norm,
           'ip_subject', r.ip_subject,
           'user_agent', r.user_agent,
           'source', r.source
         ) ORDER BY r.seq DESC), '[]'::jsonb)
    INTO v_ledger
    FROM (
      SELECT x.*
        FROM public.event_consent_records x
       WHERE x.tenant_id = v_tenant AND x.person_id = v_reg.person_id
       ORDER BY x.seq DESC
       LIMIT 50
    ) r;

  RETURN jsonb_build_object(
    'registration_id', v_reg.id,
    'person_id', v_reg.person_id,
    'submitted_profile', v_submitted,
    'current', v_current,
    'differs', cardinality(v_differences) > 0,
    'differences', to_jsonb(v_differences),
    'consents', jsonb_build_object(
      'data_processing_at', v_person.consent_data_processing_at,
      'marketing_at', v_person.consent_marketing_at,
      'partner_sharing_at', v_person.consent_partner_sharing_at,
      'withdrawn_at', v_person.consent_withdrawn_at),
    'open_confirmation', v_open,
    'ledger', v_ledger);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_consent_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_consent_detail(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_consent_detail(uuid) IS
  'REG-02/REG-14, panel zgloszen: dane przyslane przy zapisie (submitted_profile) obok kartoteki osoby (current, differs, differences), projekcja zgod, ksiega zgod osoby (50 najnowszych, z dowodem: kanal, tekst, skrot IP, user agent) i otwarty link double opt-in. Najemca z assert_event_admin_tenant() (admin albo super_admin), nigdy z argumentu. not_found dla cudzego zgloszenia.';
