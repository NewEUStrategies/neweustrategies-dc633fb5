-- events-harness: include
-- ============================================================================
-- ZAPIS NA WYDARZENIE - POPRAWKI PO PRZEGLADZIE R38 (CZESC 2): WEJSCIE ZAPISU
-- ROZROZNIA NARUSZENIA UNIKALNOSCI.
--
-- DEFEKT (latest: `event_register_for_client`, 20261012140100_event_register_entry.sql:61-272)
--   `WHEN unique_violation` (:164-173) zamienial KAZDE naruszenie unikalnosci
--   w rdzeniu na `already_registered` bez zgloszenia. Drugi z dwoch
--   pierwszych zapisow nowego adresu (dwa wydarzenia najemcy naraz) trafial
--   w `event_people_tenant_email_uniq`, przegladarka slyszala „sprawdz
--   skrzynke", a zgloszenia i maila nie bylo; zweryfikowany wlasciciel
--   slyszal nieprawdziwe „juz jestes zapisany" na wydarzenie, na ktorym go
--   nie ma.
--
-- ZMIANA: `event_register_for_client` (CREATE OR REPLACE na ciele 20261012140100,
-- jedyna zmiana oznaczona `ZMIANA 20261012 (R38)`): nazwa ograniczenia
-- z `GET STACKED DIAGNOSTICS ... CONSTRAINT_NAME`; „juz zapisany" wylacznie
-- dla `event_registrations_active_uniq`, kazde inne naruszenie to `unknown`
-- z RAISE WARNING (awaria, nie odmowa). Sam wyscig osoby zamyka rdzen
-- (20261012180000: wstawienie ON CONFLICT i sciezka osoby istniejacej).
-- Lista kodow odmow `c_codes` bez zmian - pilnuje jej bramka
-- src/lib/events/__tests__/registrationRefusalCodes.gate.test.ts (kazdy kod
-- ma zdanie `eventRegistration.errors.*` w PL i EN).
--
-- CZEGO TO NIE ZAMYKA: nic ponad opis wyzej - kubelki, odpowiedz neutralna
-- i dostawa bez zmian.
-- KOLEJNOSC WDROZENIA: dowolna (ksztalt odpowiedzi bez zmian).
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_register_oracle_followups_test.sql (asercje 16-20),
--   scripts/events-harness/runtime_test.d/21_register_oracle_followups.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.event_register_for_client(
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
  -- Odpowiedz neutralna (D3) to STALA: ta sama tresc bajt w bajt dla
  -- „utworzono" i „juz zapisany", bez zadnego klucza z rdzenia.
  c_check_email CONSTANT jsonb := '{"ok": true, "outcome": "check_email"}'::jsonb;
  -- Kody odmow kontraktu (REG_DESIGN §2 B1a; kazdy ma tlumaczenie
  -- `eventRegistration.errors.*`). Glowa spoza listy to `unknown` - nowy kod
  -- rdzenia nie wycieknie do przegladarki bez decyzji o jego tresci.
  c_codes CONSTANT text[] := ARRAY[
    'rate_limited', 'invalid_payload', 'invalid_name', 'invalid_email', 'invalid_phone',
    'invalid_job_title', 'invalid_company', 'invalid_social_url', 'invalid_answers',
    'payload_too_large', 'consent_required', 'invalid_event', 'not_found', 'event_cancelled',
    'event_ended', 'registration_disabled', 'registration_external', 'registration_not_open',
    'membership_required', 'ticket_required', 'ticket_not_on_sale', 'ticket_sales_ended',
    'ticket_tier_required', 'invalid_access_code', 'payment_account_required',
    'account_email_required', 'missing_required_fields', 'missing_required_consents',
    'terms_required', 'sold_out', 'already_registered', 'unknown'
  ]::text[];
  -- Ogon (`detail`) tylko przy listach pol, zgod i regulaminow - kazdy inny
  -- ogon to tekst dla programisty, nie dla uczestnika.
  c_detail_codes CONSTANT text[] := ARRAY[
    'missing_required_fields', 'missing_required_consents', 'terms_required'
  ]::text[];
  v_prev_sub text := current_setting('request.jwt.claim.sub', true);
  v_prev_role text := current_setting('request.jwt.claim.role', true);
  v_prev_claims text := current_setting('request.jwt.claims', true);
  v_ip_ok boolean;
  v_user_ok boolean := true;
  v_core jsonb;
  v_head text;
  v_tail text;
  v_error text;
  v_verified boolean;
  v_client jsonb;
  v_delivery jsonb;
  v_constraint text;
BEGIN
  -- Tozsamosc od serwera: najemca z zaufanego hosta, konto ze zweryfikowanej
  -- sesji (albo NULL = gosc), solony skrot adresu - nigdy surowy adres. Brak
  -- ktoregos to blad wolajacego (serwera), nie odpowiedz o zapisie, wiec
  -- wyjatek i zaden kubelek.
  IF _user_id IS NULL THEN
    PERFORM public._require_server_probe(_tenant_id, _ip_subject);
  ELSE
    PERFORM public._require_server_identity(_tenant_id, _user_id, _ip_subject);
  END IF;

  -- KUBELKI PRZED RDZENIEM, POZA JEGO PODTRANSAKCJA (REG-04, D2). Liczy sie
  -- KAZDA proba - takze odrzucona przez rdzen - bo odmowa wraca wartoscia,
  -- a nie wyjatkiem, ktory wycofalby licznik. Gosc: 12 prob na adres
  -- w 10 minut. Zalogowany: 120 na adres (wspolny NAT) i 12 na konto.
  SELECT h.allowed INTO v_ip_ok
    FROM public.rate_limit_hit(
      'event_register.ip', _ip_subject,
      CASE WHEN _user_id IS NULL THEN 12 ELSE 120 END, 10) h;
  IF _user_id IS NOT NULL THEN
    SELECT h.allowed INTO v_user_ok
      FROM public.rate_limit_hit('event_register.user', 'user:' || _user_id::text, 12, 10) h;
  END IF;
  IF NOT COALESCE(v_ip_ok, false) OR NOT COALESCE(v_user_ok, false) THEN
    RETURN jsonb_build_object(
      'client', jsonb_build_object('ok', false, 'error', 'rate_limited'),
      'delivery', NULL);
  END IF;

  -- Rdzen czyta konto takze przez `has_tier_rank` / `current_membership_tier`
  -- (auth.uid()) - na czas wywolania wolajacym JEST konto z sesji (albo gosc).
  PERFORM public._set_request_identity(
    COALESCE(_user_id::text, ''),
    CASE WHEN _user_id IS NULL THEN 'anon' ELSE 'authenticated' END,
    jsonb_strip_nulls(jsonb_build_object(
      'sub', _user_id,
      'role', CASE WHEN _user_id IS NULL THEN 'anon' ELSE 'authenticated' END))::text);

  -- PODTRANSAKCJA: odmowa rdzenia wycofuje WSZYSTKIE jego zapisy (osoba,
  -- zgloszenie, zgody), ale nie kubelki wyzej. Pudla kodow rdzen oddaje
  -- wartoscia, wiec ich liczniki przetrwaja razem z podtransakcja.
  BEGIN
    v_core := public._event_register(_tenant_id, _user_id, _ip_subject, _user_agent, p_payload, true);
  EXCEPTION
    WHEN raise_exception THEN
      v_head := btrim(split_part(SQLERRM, ':', 1));
      v_tail := CASE WHEN strpos(SQLERRM, ':') > 0
                     THEN btrim(substr(SQLERRM, strpos(SQLERRM, ':') + 1)) ELSE '' END;
      IF NOT (v_head = ANY (c_codes)) THEN
        RAISE WARNING 'event_register_for_client: unmapped refusal %', left(v_head, 64);
        v_head := 'unknown';
      END IF;
      v_core := jsonb_build_object('ok', false, 'error', v_head);
      IF v_head = ANY (c_detail_codes) AND v_tail <> '' THEN
        v_core := v_core || jsonb_build_object('detail', v_tail);
      END IF;
    WHEN unique_violation THEN
      -- ZMIANA 20261012 (R38): „JUZ ZAPISANY" WYLACZNIE Z UNIKALNOSCI ZGLOSZENIA.
      -- Wyscig dwoch zapisow tej samej osoby NA TO SAMO wydarzenie trafia
      -- w `event_registrations_active_uniq` - to jest „juz zapisany", bez
      -- identyfikatora zgloszenia (zapis rdzenia wycofany), wiec bez wiadomosci
      -- do skrzynki. Kazde INNE naruszenie (np. kartoteka osoby - rdzen
      -- wstawia ja juz ON CONFLICT, 20261012180000) to awaria: przegladarka
      -- dostaje `unknown`, serwer - slad. Wczesniej kazde szlo jako „juz
      -- zapisany" i nowy adres tracil zapis bez sladu.
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'event_registrations_active_uniq' THEN
        v_core := jsonb_build_object(
          'ok', true,
          'outcome', 'already_registered',
          'verified', public._event_uid_owns_email(
            _user_id,
            CASE WHEN jsonb_typeof(p_payload) = 'object' THEN p_payload->>'email' END));
      ELSE
        RAISE WARNING 'event_register_for_client: unexpected unique violation (%)',
          left(COALESCE(v_constraint, '?'), 64);
        v_core := jsonb_build_object('ok', false, 'error', 'unknown');
      END IF;
    WHEN OTHERS THEN
      -- Awaria, nie odmowa: przegladarka dostaje `unknown`, serwer - slad
      -- (bez DETAIL, ktory moze niesc wartosci z wiersza).
      RAISE WARNING 'event_register_for_client: unexpected % (%)', SQLSTATE, SQLERRM;
      v_core := jsonb_build_object('ok', false, 'error', 'unknown');
  END;

  PERFORM public._set_request_identity(v_prev_sub, v_prev_role, v_prev_claims);

  -- ODMOWA: sam kod (i ogon list).
  IF COALESCE((v_core->>'ok')::boolean, false) IS NOT TRUE THEN
    v_error := v_core->>'error';
    IF v_error IS NULL OR NOT (v_error = ANY (c_codes)) THEN
      v_error := 'unknown';
    END IF;
    v_client := jsonb_build_object('ok', false, 'error', v_error);
    IF v_error = ANY (c_detail_codes) AND COALESCE(v_core->>'detail', '') <> '' THEN
      v_client := v_client || jsonb_build_object('detail', v_core->>'detail');
    END IF;
    RETURN jsonb_build_object('client', v_client, 'delivery', NULL);
  END IF;

  v_verified := COALESCE((v_core->>'verified')::boolean, false);

  -- JUZ ZAPISANY. Wlasciciel adresu dostaje to wprost (to jego adres - nie ma
  -- tu wyroczni). Kazdy inny - stala neutralna; wiadomosc dostaje WLASCICIEL
  -- adresu (dane odbiorcy z kartoteki), bez klucza samoobslugi.
  IF v_core->>'outcome' = 'already_registered' THEN
    IF v_verified THEN
      RETURN jsonb_build_object(
        'client', jsonb_build_object('ok', false, 'error', 'already_registered'),
        'delivery', NULL);
    END IF;
    IF v_core->>'registration_id' IS NULL THEN
      RETURN jsonb_build_object('client', c_check_email, 'delivery', NULL);
    END IF;
    RETURN jsonb_build_object(
      'client', c_check_email,
      'delivery', jsonb_build_object(
        'kind', 'already_registered',
        'registration_id', v_core->'registration_id',
        'status', v_core->'status',
        'recipient', v_core->'recipient',
        'event', v_core->'event',
        'consent_confirmation', NULL));
  END IF;

  IF v_core->>'outcome' IS DISTINCT FROM 'created' THEN
    RAISE WARNING 'event_register_for_client: unexpected core outcome';
    RETURN jsonb_build_object(
      'client', jsonb_build_object('ok', false, 'error', 'unknown'),
      'delivery', NULL);
  END IF;

  -- UTWORZONO. Dostawa zawsze (potwierdzenie z linkiem samoobslugi idzie do
  -- skrzynki), poswiadczenia w przegladarce - tylko dla wlasciciela adresu.
  v_delivery := jsonb_build_object(
    'kind', 'created',
    'registration_id', v_core->'registration_id',
    'manage_token', v_core->'manage_token',
    'qr_token', v_core->'qr_token',
    'status', v_core->'status',
    'recipient', v_core->'recipient',
    'event', v_core->'event',
    'consent_confirmation', COALESCE(v_core->'consent_confirmation', 'null'::jsonb));

  IF v_verified THEN
    v_client := jsonb_build_object(
      'ok', true,
      'outcome', 'registered',
      'registration_id', v_core->'registration_id',
      'event_id', v_core->'event_id',
      'person_id', v_core->'person_id',
      'status', v_core->'status',
      'decision_source', v_core->'decision_source',
      'waitlist_position', v_core->'waitlist_position',
      'ticket_type_id', v_core->'ticket_type_id',
      'group_id', v_core->'group_id',
      'qr_token', v_core->'qr_token',
      'manage_token', v_core->'manage_token',
      'payment_status', v_core->'payment_status',
      'payment_required', v_core->'payment_required',
      'amount_cents', v_core->'amount_cents',
      'currency', v_core->'currency',
      'quote_valid_until', v_core->'quote_valid_until',
      'account_linked', COALESCE(v_core->'account_linked', 'false'::jsonb),
      'consent_confirmation_required', COALESCE(v_core->'consent_confirmation_required', 'false'::jsonb));
  ELSE
    v_client := c_check_email;
  END IF;

  RETURN jsonb_build_object('client', v_client, 'delivery', v_delivery);
END;
$$;
REVOKE ALL ON FUNCTION public.event_register_for_client(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_register_for_client(uuid, uuid, text, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.event_register_for_client(uuid, uuid, text, text, jsonb) IS
  'Publiczny zapis na wydarzenie z funkcji serwerowej (submitEventRegistration) - TYLKO service_role. Najemca z zaufanego hosta, konto ze zweryfikowanej sesji (NULL = gosc), solony skrot adresu ip:<32 hex>, przegladarka - argumentami, nigdy z ladunku. Kubelki event_register.ip (12 gosc / 120 zalogowany na 10 min) i event_register.user (12 / 10 min) przed rdzeniem; odmowy wartoscia. already_registered tylko z naruszenia event_registrations_active_uniq (R38), inne naruszenie unikalnosci = unknown. Zwraca {client, delivery}: client = {ok:false,error,detail?} | stala {ok:true,outcome:check_email} dla niezweryfikowanego | poswiadczenia dla wlasciciela adresu; delivery tylko dla serwera.';