-- events-harness: include
-- ============================================================================
-- ZAPIS NA WYDARZENIE (B1a, CZESC 2): WEJSCIA. ZAPIS TYLKO PRZEZ SERWER
-- Z KUBELKIEM ADRESU I KONTA, JEDNA ODPOWIEDZ DLA „UTWORZONO" I „JUZ ZAPISANY",
-- FORMULARZ BEZ UKRYTYCH BILETOW, ODSLANIANIE PELNYMI WIERSZAMI.
--
-- DEFEKT
--   1. REG-04. `event_register(jsonb)` (20261007140400:229-692) mial GRANT
--      dla anon i authenticated (20260827220945:580) - przegladarka wolala go
--      wprost, a baza nie znala adresu klienta. Odpowiedz oddawala
--      `registration_id`, `manage_token` i `qr_token` kazdemu, kto podal adres
--      (takze cudzy), a `already_registered` odroznial adres zapisany od
--      swiezego.
--   2. REG-05. `event_registration_form(text)` (20260923110000:38-110)
--      oddawal bilety `is_hidden` kazdemu (filtr byl tylko w przegladarce),
--      a odslanianie kodem (`event_coupon_revealed_tickets`) oddawalo same
--      identyfikatory biletow, ktore formularz juz pokazal.
--   3. REG-13. `closed_reason` formularza nie znal konca wydarzenia.
--
-- ZMIANA
--   A. `event_register_for_client(_tenant_id, _user_id, _ip_subject,
--      _user_agent, p_payload)` - TYLKO service_role (funkcja serwerowa
--      `submitEventRegistration`). Kubelki PRZED rdzeniem: adres 12 / 10 min
--      (gosc) albo 120 / 10 min (zalogowany) i konto 12 / 10 min. Rdzen
--      w podtransakcji: kazda odmowa wraca WARTOSCIA, a licznik zostaje.
--      Odpowiedz `{client, delivery}` (REG_DESIGN §2 B1a): `client` dla
--      przegladarki - niezweryfikowany wolajacy dostaje STALA
--      `{"ok":true,"outcome":"check_email"}` dla „utworzono" i „juz zapisany";
--      `delivery` (adres, klucz samoobslugi, kod QR, link zgody) wylacznie
--      dla serwera, ktory wysyla wynik do SKRZYNKI.
--   B. `event_register(jsonb)` - wrapper zgodnosci nad tym samym rdzeniem
--      (najemca z hosta, konto z JWT, bez adresu), `already_registered` jako
--      wyjatek jak dotad. REVOKE anon/authenticated - tylko service_role
--      (precedens: `event_ticket_checkout_quote`, 20261007140400).
--   C. `event_registration_form(p_event_slug, p_ticket_key DEFAULT NULL)` -
--      DROP starej (text): obie naraz bylyby niejednoznaczne. Bez biletow
--      ukrytych (wyjatek: bilet za KODEM DOSTEPU wskazany kluczem z linku -
--      zapis i tak wymaga kodu), nowe klucze `has_hidden_tickets`
--      i `requires_ticket`, `closed_reason` = `event_ended` po koncu.
--   D. `event_registration_revealed_tickets(...)` - TYLKO service_role:
--      ukryte bilety odslaniane kodem jako PELNE obiekty formularza.
--
-- CZEGO TO NIE ZAMYKA: kubelek zapisu jest na adres i konto - wspolny NAT
-- (sala konferencyjna) dzieli kubelek adresu; zalogowani maja prog 120.
-- Grupy gosci (`event_register_group_guests`) naleza do jednostki B6.
--
-- KOLEJNOSC WDROZENIA: NAJPIERW KOD. `submitEventRegistration` (B1b) woluje
-- `event_register_for_client`, a przy PGRST202/42883 stare `event_register`
-- klientem anonimowym; formularz i odslanianie maja ten sam powrot. Po tej
-- migracji karta przegladarki sprzed wdrozenia dostaje 42501 na
-- `event_register` i ogolny komunikat - przeladowanie naprawia.
-- IDEMPOTENTNA: CREATE OR REPLACE, DROP FUNCTION IF EXISTS (stara sygnatura
-- formularza), bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_register_entry_hardening_test.sql,
--   supabase/tests/event_registration_identity_integrity_test.sql,
--   supabase/tests/ticket_access_code_probe_test.sql,
--   scripts/events-harness/runtime_test.d/21_register_entry_hardening.sql.
-- ============================================================================

-- A) ZAPIS Z SERWERA ----------------------------------------------------------------
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
      -- Wyscig dwoch zapisow tej samej osoby: drugi trafia w unikalny indeks.
      -- To jest „juz zapisany" - bez identyfikatora zgloszenia (zapis rdzenia
      -- wycofany), wiec bez wiadomosci do skrzynki.
      v_core := jsonb_build_object(
        'ok', true,
        'outcome', 'already_registered',
        'verified', public._event_uid_owns_email(
          _user_id,
          CASE WHEN jsonb_typeof(p_payload) = 'object' THEN p_payload->>'email' END));
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
  'Publiczny zapis na wydarzenie z funkcji serwerowej (submitEventRegistration) - TYLKO service_role. Najemca z zaufanego hosta, konto ze zweryfikowanej sesji (NULL = gosc), solony skrot adresu ip:<32 hex>, przegladarka - argumentami, nigdy z ladunku. Kubelki event_register.ip (12 gosc / 120 zalogowany na 10 min) i event_register.user (12 / 10 min) przed rdzeniem; odmowy wartoscia. Zwraca {client, delivery}: client = {ok:false,error,detail?} | stala {ok:true,outcome:check_email} dla niezweryfikowanego | poswiadczenia dla wlasciciela adresu; delivery tylko dla serwera.';

-- B) WRAPPER ZGODNOSCI -------------------------------------------------------------
-- Ten sam rdzen co wejscie serwerowe: najemca z hosta, konto z JWT, bez
-- adresu (brak kubelka i dowodu IP), link zgody nie jest oddawany (mail
-- wysyla tylko sciezka serwerowa). Ksztalt odpowiedzi jak dotad, w tym
-- `already_registered` jako wyjatek. Wylacznie service_role - przegladarka
-- nie ma juz drogi do zapisu z pominieciem kubelka adresu.
CREATE OR REPLACE FUNCTION public.event_register(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v jsonb;
BEGIN
  v := public._event_register(public.public_tenant_id(), auth.uid(), NULL, NULL, p_payload, false);
  IF v->>'outcome' = 'already_registered' THEN
    RAISE EXCEPTION 'already_registered: this person already has an active registration';
  END IF;
  -- Pudlo kodu wraca wartoscia `{ok:false, error}`, jak dotad.
  IF v->>'outcome' IS DISTINCT FROM 'created' THEN
    RETURN v;
  END IF;
  RETURN v - ARRAY['ok', 'outcome', 'verified', 'recipient', 'event', 'consent_confirmation']::text[];
END;
$$;
REVOKE ALL ON FUNCTION public.event_register(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_register(jsonb) TO service_role;

COMMENT ON FUNCTION public.event_register(jsonb) IS
  'Wrapper zgodnosci zapisu na wydarzenie - TYLKO service_role (od 20261012140100; dotad anon). Najemca z hosta, konto z JWT, bez skrotu adresu i bez kubelka; ten sam rdzen _event_register. already_registered jako wyjatek, pudlo kodu jako {ok:false,error}. Przegladarka zapisuje przez submitEventRegistration -> event_register_for_client.';

-- C) FORMULARZ ZAPISU ------------------------------------------------------------------
-- Nowa sygnatura z kluczem biletu z linku (`?ticket=`). Stara (text) znika:
-- f(text) obok f(text, text DEFAULT NULL) daje niejednoznaczne wywolanie,
-- a DROP zabiera tez jej granty.
DROP FUNCTION IF EXISTS public.event_registration_form(text);

CREATE OR REPLACE FUNCTION public.event_registration_form(p_event_slug text, p_ticket_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_event public.events;
  v_slug text := NULLIF(btrim(COALESCE(p_event_slug, '')), '');
  v_ticket_key text := NULLIF(btrim(COALESCE(p_ticket_key, '')), '');
  v_seats_left integer;
  v_reason text;
  v_fields jsonb;
  v_consents jsonb;
  v_tickets jsonb;
  v_terms jsonb;
  v_active_tickets integer;
  v_has_hidden boolean;
BEGIN
  IF v_tenant IS NULL OR v_slug IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;
  SELECT * INTO v_event FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = v_slug AND e.status = 'published';
  IF v_event.id IS NULL THEN RAISE EXCEPTION 'not_found: event does not exist'; END IF;
  v_seats_left := public._event_seats_left(v_tenant, v_event.id, NULL);
  SELECT count(*)::integer, COALESCE(bool_or(t.is_hidden), false)
    INTO v_active_tickets, v_has_hidden
    FROM public.event_ticket_types t
   WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;
  v_reason := CASE
    WHEN v_event.cancelled_at IS NOT NULL THEN 'event_cancelled'
    -- ZMIANA 20261012 (REG-13, D7): ta sama regula konca co zapis.
    WHEN COALESCE(v_event.ends_at, v_event.starts_at) < now() THEN 'event_ended'
    WHEN v_event.registration_mode = 'none' THEN 'registration_disabled'
    WHEN v_event.registration_mode = 'external' THEN 'registration_external'
    WHEN v_event.rsvp_opens_at IS NOT NULL AND v_event.rsvp_opens_at > now()
      AND NOT (v_event.early_rsvp_rank IS NOT NULL AND public.has_tier_rank(v_event.early_rsvp_rank)) THEN 'registration_not_open'
    WHEN v_event.visibility = 'members' AND NOT public.has_tier_rank(GREATEST(v_event.min_tier_rank, 1)) THEN 'membership_required'
    WHEN v_active_tickets = 0 AND v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN 'sold_out'
    ELSE NULL END;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', f.id,'key', f.key,'field_type', f.field_type,'label_pl', f.label_pl,'label_en', f.label_en,'help_pl', f.help_pl,'help_en', f.help_en,'is_required', f.is_required,'options', f.options,'sort_order', f.sort_order) ORDER BY f.sort_order, f.key), '[]'::jsonb)
  INTO v_fields FROM public.event_registration_fields f
  WHERE f.tenant_id = v_tenant AND f.event_id = v_event.id AND f.is_active AND f.field_type <> 'consent';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', f.id,'key', f.key,'field_type', f.field_type,'label_pl', f.label_pl,'label_en', f.label_en,'help_pl', f.help_pl,'help_en', f.help_en,'is_required', f.is_required,'options', f.options,'sort_order', f.sort_order) ORDER BY f.sort_order, f.key), '[]'::jsonb)
  INTO v_consents FROM public.event_registration_fields f
  WHERE f.tenant_id = v_tenant AND f.event_id = v_event.id AND f.is_active AND f.field_type = 'consent';
  -- ZMIANA 20261012 (REG-05, D6): BILETY UKRYTE NIE WYCHODZA. Jedyny wyjatek
  -- to bilet ukryty Z KODEM DOSTEPU wskazany kluczem z linku - zapis i tak
  -- wymaga kodu, a link musi dac sie otworzyc. Bilet ukryty BEZ kodu dostepu
  -- przychodzi wylacznie z odslaniania kodem (event_registration_revealed_tickets).
  SELECT COALESCE(jsonb_agg(public._event_registration_ticket_json(t) ORDER BY t.sort_order, t.key), '[]'::jsonb)
  INTO v_tickets FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active
    AND (NOT t.is_hidden
         OR (v_ticket_key IS NOT NULL AND t.key = v_ticket_key AND t.access_code_hash IS NOT NULL));
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', tr.id,'key', tr.key,'label_pl', tr.label_pl,'label_en', tr.label_en,'body_pl', tr.body_pl,'body_en', tr.body_en,'external_url', tr.external_url,'is_required', tr.is_required,'version', tr.version,'sort_order', tr.sort_order) ORDER BY tr.sort_order, tr.key), '[]'::jsonb)
  INTO v_terms FROM public.event_terms tr
  WHERE tr.tenant_id = v_tenant AND tr.event_id = v_event.id AND tr.is_active AND tr.display IN ('registration', 'registration_and_access');
  RETURN jsonb_build_object(
    'event', jsonb_build_object('id', v_event.id,'slug', v_event.slug,'title_pl', v_event.title_pl,'title_en', v_event.title_en,'starts_at', v_event.starts_at,'ends_at', v_event.ends_at,'timezone', v_event.timezone,'registration_mode', v_event.registration_mode,'registration_flow', v_event.registration_flow,'external_registration_url', v_event.external_registration_url,'capacity', v_event.capacity,'seats_left', v_seats_left,'rsvp_opens_at', v_event.rsvp_opens_at),
    'is_open', (v_reason IS NULL), 'closed_reason', v_reason,
    -- Formularz musi wiedziec, ze bilet jest obowiazkowy, takze gdy lista
    -- jawnych biletow jest pusta (sa wylacznie ukryte), i ze warto pokazac
    -- pole kodu odslaniajacego.
    'has_hidden_tickets', v_has_hidden,
    'requires_ticket', (v_active_tickets > 0),
    'fields', v_fields, 'consents', v_consents, 'tickets', v_tickets, 'terms', v_terms);
END;
$$;
REVOKE ALL ON FUNCTION public.event_registration_form(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_form(text, text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_form(text, text) IS
  'Publiczny formularz zapisu: pola, zgody, regulaminy i bilety wydarzenia najemcy hosta. Bez biletow ukrytych (REG-05) - wyjatek: bilet ukryty z kodem dostepu wskazany kluczem p_ticket_key (link ?ticket=). has_hidden_tickets / requires_ticket dla pola kodu odslaniajacego; closed_reason event_ended po COALESCE(ends_at, starts_at) (REG-13). Regula kwalifikujaca nie wychodzi.';

-- D) ODSLANIANIE KODEM: PELNE WIERSZE ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_registration_revealed_tickets(
  _tenant_id uuid,
  _user_id uuid,
  _probe_subject text,
  p_event_id uuid,
  p_code text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev_sub text := current_setting('request.jwt.claim.sub', true);
  v_prev_role text := current_setting('request.jwt.claim.role', true);
  v_prev_claims text := current_setting('request.jwt.claims', true);
  v_code text := upper(btrim(COALESCE(p_code, '')));
  v_out jsonb;
BEGIN
  -- Solony skrot adresu, nigdy surowy adres - zly ksztalt to blad serwera.
  IF _probe_subject IS NULL OR _probe_subject !~ '^ip:[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'invalid_payload: probe subject must be a salted address hash';
  END IF;
  -- Kazdy powod odmowy (brak najemcy, wydarzenia, kodu, kod za dlugi, kod
  -- nieodslaniajacy, cudzy najemca) to ta sama pusta lista.
  IF _tenant_id IS NULL OR p_event_id IS NULL OR v_code = '' OR char_length(v_code) > 64 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- `tier_locked` biletu liczy `has_tier_rank` (auth.uid()) - na czas
  -- wywolania wolajacym jest konto z sesji albo gosc.
  PERFORM public._set_request_identity(
    COALESCE(_user_id::text, ''),
    CASE WHEN _user_id IS NULL THEN 'anon' ELSE 'authenticated' END,
    jsonb_strip_nulls(jsonb_build_object(
      'sub', _user_id,
      'role', CASE WHEN _user_id IS NULL THEN 'anon' ELSE 'authenticated' END))::text);

  SELECT COALESCE(jsonb_agg(public._event_registration_ticket_json(t) ORDER BY t.sort_order, t.key), '[]'::jsonb)
    INTO v_out
    FROM public.event_ticket_types t
    JOIN public.events e ON e.id = t.event_id AND e.tenant_id = t.tenant_id
   WHERE t.tenant_id = _tenant_id
     AND t.event_id = p_event_id
     AND t.is_active
     AND t.is_hidden
     AND e.status = 'published'
     AND public._event_reveal_coupon_covers(_tenant_id, p_event_id, t.id, v_code);

  PERFORM public._set_request_identity(v_prev_sub, v_prev_role, v_prev_claims);
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.event_registration_revealed_tickets(uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_registration_revealed_tickets(uuid, uuid, text, uuid, text) TO service_role;

COMMENT ON FUNCTION public.event_registration_revealed_tickets(uuid, uuid, text, uuid, text) IS
  'REG-05: ukryte bilety opublikowanego wydarzenia odslaniane kodem reveals_hidden (_event_reveal_coupon_covers) jako pelne obiekty formularza (_event_registration_ticket_json). TYLKO service_role: najemca z hosta, konto z sesji (tier_locked), solony skrot adresu; limit prob stoi przed baza (allowCodeProbe). Kazda odmowa to pusta lista.';
