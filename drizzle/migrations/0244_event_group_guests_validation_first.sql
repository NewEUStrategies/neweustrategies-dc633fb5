CREATE OR REPLACE FUNCTION public._event_register_group_guests(
  p_tenant uuid,
  p_uid uuid,
  p_lead_registration_id uuid,
  p_guests jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  -- Kody odmow, ktore wychodza do przegladarki (kazdy ma zdanie
  -- `eventRegistration.group.errors.*`). Glowa spoza listy - np. wyjatek
  -- funkcji pomocniczej - to `unknown`: tekst dla programisty nie wycieka.
  -- ZMIANA 20261012 (R38): bez `already_registered` (gosc zapisany jest
  -- pomijany), z `duplicate_guest` (duplikat w liscie, adres prowadzacego).
  c_codes CONSTANT text[] := ARRAY[
    'invalid_guests', 'duplicate_guest', 'not_found', 'event_ended', 'registration_closed',
    'already_settled', 'group_not_enabled', 'group_too_large', 'sold_out',
    'invalid_name', 'invalid_email'
  ]::text[];
  v_tenant uuid := p_tenant;
  v_uid uuid := p_uid;
  v_client jsonb;
  v_notices jsonb := '[]'::jsonb;
  v_head text;
  v_event_id uuid;
  v_ticket_id uuid;
  v_event public.events;
  v_lead public.event_registrations;
  v_ticket public.event_ticket_types;
  v_event_json jsonb;
  v_guest jsonb;
  v_email text;
  v_first text;
  v_last text;
  v_emails text[] := ARRAY[]::text[];
  v_firsts text[] := ARRAY[]::text[];
  v_lasts text[] := ARRAY[]::text[];
  v_lead_email text;
  v_person uuid;
  v_taken_id uuid;
  v_taken_status text;
  v_count integer;
  v_existing integer;
  v_seats integer;
  v_guest_status text;
  v_inherit boolean;
  v_token text;
  v_reg uuid;
  v_notice jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'client', jsonb_build_object('ok', false, 'error', 'account_required'),
      'delivery', '[]'::jsonb);
  END IF;
  -- Bez najemcy (host spoza katalogu) nie ma zgloszenia prowadzacego - jak dotad.
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object(
      'client', jsonb_build_object('ok', false, 'error', 'not_found'),
      'delivery', '[]'::jsonb);
  END IF;

  -- PODTRANSAKCJA: odmowa wycofuje wszystkie zapisy tej proby (osoby, zgloszenia,
  -- zdarzenia), ale nie kubelki liczone przez wejscie.
  BEGIN
    IF jsonb_typeof(p_guests) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_guests';
    END IF;
    v_count := jsonb_array_length(p_guests);
    IF v_count = 0 THEN
      RETURN jsonb_build_object(
        'client', jsonb_build_object('ok', true, 'added', 0),
        'delivery', '[]'::jsonb);
    END IF;
    -- Grupa ma najwyzej 50 osob (CHECK `event_ticket_types_group_max_size_range`),
    -- wiec ponad 49 gosci to limit grupy bez czytania czegokolwiek.
    IF v_count > 49 THEN
      RAISE EXCEPTION 'group_too_large';
    END IF;

    -- ZMIANA 20261012 (R38, REG-04): NAJPIERW CALA LISTA. Ksztalt, imiona,
    -- adresy, znaki sterujace i duplikaty - zanim baza przeczyta cokolwiek
    -- o gosciach. Lista z jednym zlym wierszem dostaje te sama odmowe, bez
    -- wzgledu na to, kto z pozostalych ma juz zapis.
    FOR v_guest IN SELECT g.value FROM jsonb_array_elements(p_guests) AS g(value) LOOP
      IF jsonb_typeof(v_guest) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'invalid_guests';
      END IF;
      v_email := lower(btrim(COALESCE(v_guest->>'email', '')));
      v_first := btrim(COALESCE(v_guest->>'first_name', ''));
      v_last := btrim(COALESCE(v_guest->>'last_name', ''));
      IF v_first = '' OR v_last = '' OR char_length(v_first) > 80 OR char_length(v_last) > 80
         OR public._event_text_has_control(v_first) OR public._event_text_has_control(v_last) THEN
        RAISE EXCEPTION 'invalid_name';
      END IF;
      IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' OR char_length(v_email) > 320
         OR public._event_text_has_control(v_email) THEN
        RAISE EXCEPTION 'invalid_email';
      END IF;
      IF v_email = ANY (v_emails) THEN
        RAISE EXCEPTION 'duplicate_guest';
      END IF;
      v_emails := v_emails || v_email;
      v_firsts := v_firsts || v_first;
      v_lasts := v_lasts || v_last;
    END LOOP;

    -- ZMIANA 20261012 (REG-08, D11): IDENTYFIKACJA BEZ BLOKADY. Tylko po to,
    -- by wiedziec, ktore wydarzenie i bilet zablokowac - blokada zgloszenia
    -- przed wydarzeniem odwracala kolejnosc calego modulu.
    SELECT r.event_id, r.ticket_type_id INTO v_event_id, v_ticket_id
      FROM public.event_registrations r
      LEFT JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
     WHERE r.id = p_lead_registration_id AND r.tenant_id = v_tenant
       AND r.group_lead_registration_id IS NULL
       AND (r.created_by = v_uid OR p.user_id = v_uid);
    IF v_event_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

    -- Wydarzenie -> bilet -> zgloszenie (jak `_event_register`,
    -- `payments_apply_event_ticket_outcome`, `admin_event_registration_decide`).
    SELECT e.* INTO v_event
      FROM public.events e
     WHERE e.id = v_event_id AND e.tenant_id = v_tenant
     FOR UPDATE;
    IF v_event.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

    -- ZMIANA 20261012 (REG-13, D7): ta sama granica co rdzen zapisu.
    IF COALESCE(v_event.ends_at, v_event.starts_at) < now() THEN
      RAISE EXCEPTION 'event_ended';
    END IF;

    IF v_ticket_id IS NOT NULL THEN
      PERFORM 1 FROM public.event_ticket_types t
       WHERE t.id = v_ticket_id AND t.tenant_id = v_tenant AND t.event_id = v_event_id
       FOR UPDATE;
    END IF;

    -- Prowadzacy pod blokada, z TYM SAMYM predykatem wlasnosci: miedzy
    -- odczytem a blokada mogl zostac zamkniety, przeniesiony albo rozliczony.
    SELECT r.* INTO v_lead
      FROM public.event_registrations r
      LEFT JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
     WHERE r.id = p_lead_registration_id AND r.tenant_id = v_tenant
       AND r.event_id = v_event_id
       AND r.group_lead_registration_id IS NULL
       AND (r.created_by = v_uid OR p.user_id = v_uid)
     FOR UPDATE OF r;
    IF v_lead.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
    IF v_lead.status IN ('cancelled', 'rejected') THEN RAISE EXCEPTION 'registration_closed'; END IF;
    IF v_lead.payment_status NOT IN ('unpaid', 'not_required') THEN RAISE EXCEPTION 'already_settled'; END IF;

    -- ZMIANA 20261012 (R38): adres prowadzacego na liscie gosci to duplikat -
    -- wolajacy zna go sam (to jego zgloszenie), wiec odmowa nic nie zdradza.
    SELECT p.email_norm INTO v_lead_email
      FROM public.event_people p
     WHERE p.id = v_lead.person_id AND p.tenant_id = v_tenant;
    IF v_lead_email IS NOT NULL AND v_lead_email = ANY (v_emails) THEN
      RAISE EXCEPTION 'duplicate_guest';
    END IF;

    -- Bilet prowadzacego pod blokada. Ten sam bilet co wyzej to no-op; inny
    -- (organizator zmienil bilet miedzy odczytem a blokada) jest blokowany
    -- teraz - bezpiecznie, bo kazdy zapisujacy miejsca bierze najpierw
    -- wydarzenie, ktore trzymamy.
    SELECT t.* INTO v_ticket
      FROM public.event_ticket_types t
     WHERE t.id = v_lead.ticket_type_id AND t.tenant_id = v_tenant AND t.event_id = v_event_id
     FOR UPDATE;
    IF v_ticket.id IS NULL OR NOT v_ticket.group_registration_enabled THEN
      RAISE EXCEPTION 'group_not_enabled';
    END IF;

    SELECT count(*)::integer INTO v_existing
      FROM public.event_registrations r
     WHERE r.tenant_id = v_tenant
       AND r.group_lead_registration_id = v_lead.id
       AND r.status NOT IN ('cancelled', 'rejected');
    -- Limit i miejsca liczone od CALEJ listy (takze gosci, ktorzy okaza sie
    -- zapisani) - inaczej odmowa zalezalaby od czlonkostwa.
    IF 1 + v_existing + v_count > v_ticket.group_max_size THEN
      RAISE EXCEPTION 'group_too_large';
    END IF;

    -- Pod blokada wydarzenia i biletu - kontrakt `_event_seats_left` spelniony.
    v_seats := public._event_seats_left(v_tenant, v_event_id, v_ticket.id);
    IF v_seats IS NOT NULL AND v_seats < v_count THEN RAISE EXCEPTION 'sold_out'; END IF;

    -- ZMIANA 20261012 (REG-07, D11): miejsce w puli (`approved`) i kod QR
    -- tylko obok prowadzacego NA MIEJSCU z biletem bezplatnym. Prowadzacy
    -- w kolejce albo przyjety bez wplaty (furtka organizatora) - goscie czekaja
    -- w `pending`; przyjmie ich kaskada platnosci prowadzacego
    -- (`_event_apply_outcome_to_group`), tak jak `_event_group_admit_guests`.
    -- Obecny/nieobecny prowadzacy (`attended`/`no_show`) nie przenosi tego
    -- faktu z sali na goscia - gosc dostaje miejsce (`approved`).
    v_guest_status := CASE
      WHEN v_lead.status IN ('approved', 'attended', 'no_show')
           AND v_lead.payment_status = 'not_required' THEN 'approved'
      WHEN v_lead.status IN ('draft', 'pending') THEN v_lead.status
      ELSE 'pending'
    END;
    -- Slad decyzji idzie za gosciem tylko wtedy, gdy gosc idzie za ta sama
    -- decyzja (CHECK `decision_sourced`: decyzja bez zrodla nie istnieje).
    v_inherit := v_guest_status = v_lead.status
      OR (v_guest_status = 'approved' AND v_lead.status IN ('attended', 'no_show'));

    v_event_json := jsonb_build_object(
      'id', v_event.id, 'slug', v_event.slug, 'title_pl', v_event.title_pl,
      'title_en', v_event.title_en, 'starts_at', v_event.starts_at);

    FOR i IN 1 .. v_count LOOP
      v_email := v_emails[i];

      -- ZMIANA 20261012 (REG-14/REG-02, D4): istniejaca osoba NIGDY nie jest
      -- zmieniana (dane, zgody, konto) - prowadzacy nie jest jej wlascicielem.
      -- Nowa osoba: dane od prowadzacego, pochodzenie `invitation`, zadnej
      -- kolumny zgody (zgoda goscia nie istnieje, dopoki on sam jej nie da).
      -- ZMIANA 20261012 (R38): wstawienie ON CONFLICT - rownolegle dopisanie
      -- tego samego nowego adresu (inne wydarzenie) bierze osobe zwyciezcy.
      SELECT p.id INTO v_person
        FROM public.event_people p
       WHERE p.tenant_id = v_tenant AND p.email_norm = v_email;
      IF v_person IS NULL THEN
        INSERT INTO public.event_people (tenant_id, email, first_name, last_name, source, created_by)
        VALUES (v_tenant, v_email, v_firsts[i], v_lasts[i], 'invitation', v_uid)
        ON CONFLICT (tenant_id, email_norm) WHERE email_norm IS NOT NULL DO NOTHING
        RETURNING id INTO v_person;
        IF v_person IS NULL THEN
          SELECT p.id INTO v_person
            FROM public.event_people p
           WHERE p.tenant_id = v_tenant AND p.email_norm = v_email;
        END IF;
      END IF;

      -- ZMIANA 20261012 (R38, REG-04): GOSC JUZ ZAPISANY JEST POMIJANY. Bez
      -- nowego wiersza i bez sladu w odpowiedzi (liczony jako przyjety);
      -- wiadomosc „juz masz zapis" dostaje WLASCICIEL adresu (dane odbiorcy
      -- z kartoteki) - kanalem serwerowym, nigdy przegladarka prowadzacego.
      v_taken_id := NULL;
      v_taken_status := NULL;
      SELECT r.id, r.status INTO v_taken_id, v_taken_status
        FROM public.event_registrations r
       WHERE r.tenant_id = v_tenant AND r.event_id = v_event_id
         AND r.person_id = v_person AND r.status NOT IN ('cancelled', 'rejected')
       LIMIT 1;
      IF v_taken_id IS NOT NULL THEN
        SELECT jsonb_build_object(
                 'kind', 'already_registered',
                 'registration_id', v_taken_id,
                 'status', v_taken_status,
                 'recipient', jsonb_build_object(
                   'email', p.email,
                   'first_name', p.first_name,
                   'lang', public._event_registration_lang(v_tenant, v_taken_id)),
                 'event', v_event_json,
                 'consent_confirmation', NULL)
          INTO v_notice
          FROM public.event_people p
         WHERE p.id = v_person AND p.tenant_id = v_tenant;
        IF v_notice IS NOT NULL THEN
          v_notices := v_notices || jsonb_build_array(v_notice);
        END IF;
        CONTINUE;
      END IF;

      v_token := CASE
        WHEN v_guest_status = 'approved' AND v_lead.payment_status = 'not_required'
          THEN public._event_new_qr_token()
      END;

      INSERT INTO public.event_registrations (
        tenant_id, event_id, person_id, ticket_type_id, group_id, status, registration_mode,
        answers, source, decided_at, decision_source, qr_token_hash, qr_issued_at,
        payment_status, created_by, group_lead_registration_id,
        quoted_price_cents, quoted_currency, quote_valid_until
      ) VALUES (
        v_tenant, v_event_id, v_person, v_ticket.id, v_lead.group_id,
        v_guest_status,
        v_lead.registration_mode, '{}'::jsonb, 'self_registration',
        CASE WHEN v_inherit THEN v_lead.decided_at END,
        CASE WHEN v_inherit THEN v_lead.decision_source END,
        CASE WHEN v_token IS NOT NULL THEN encode(digest(v_token, 'sha256'), 'hex') END,
        CASE WHEN v_token IS NOT NULL THEN now() END,
        v_lead.payment_status, v_uid, v_lead.id,
        -- ZMIANA 20261012 (REG-16, D8): oferta prowadzacego w calosci -
        -- jedno zamowienie grupy liczy wszystkich ta sama cena.
        v_lead.quoted_price_cents, v_lead.quoted_currency, v_lead.quote_valid_until
      ) RETURNING id INTO v_reg;

      PERFORM public.emit_domain_event(v_tenant, 'event_registration', v_reg::text,
        'event.registration.created.v1',
        jsonb_build_object('event_id', v_event_id, 'person_id', v_person,
          'ticket_type_id', v_ticket.id, 'source', 'group_registration',
          'group_lead_registration_id', v_lead.id), v_uid);
    END LOOP;

    -- ZMIANA 20261012 (R38): `added` = liczba poprawnych gosci z listy (pominieci
    -- tez), bez `registration_ids` - lista krotsza od `added` wskazywalaby
    -- pominietych.
    v_client := jsonb_build_object('ok', true, 'added', v_count);
  EXCEPTION
    WHEN raise_exception THEN
      v_head := btrim(split_part(SQLERRM, ':', 1));
      IF NOT (v_head = ANY (c_codes)) THEN
        RAISE WARNING '_event_register_group_guests: unmapped refusal %', left(v_head, 64);
        v_head := 'unknown';
      END IF;
      v_client := jsonb_build_object('ok', false, 'error', v_head);
      v_notices := '[]'::jsonb;
    WHEN OTHERS THEN
      -- Awaria, nie odmowa: wartosc `unknown` (kubelki zostaja), serwer - slad
      -- bez DETAIL, ktory moze niesc wartosci z wiersza.
      RAISE WARNING '_event_register_group_guests: unexpected % (%)', SQLSTATE, SQLERRM;
      v_head := 'unknown';
      v_client := jsonb_build_object('ok', false, 'error', v_head);
      v_notices := '[]'::jsonb;
  END;

  RETURN jsonb_build_object('client', v_client, 'delivery', v_notices);
END;
$$;
REVOKE ALL ON FUNCTION public._event_register_group_guests(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_register_group_guests(uuid, uuid, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public._event_register_group_guests(uuid, uuid, uuid, jsonb) IS
  'Rdzen dopisania gosci do WLASNEGO zgloszenia prowadzacego (najemca i konto z argumentow; wlasnosc: created_by albo osoba z kontem). R38: cala lista walidowana PRZED odczytem czlonkostwa (ksztalt, <= 49 gosci, imiona, adresy, znaki sterujace, duplikat w liscie albo adres prowadzacego -> duplicate_guest); gosc z aktywnym zapisem pomijany bez sladu w client (added = liczba poprawnych gosci), wiadomosc do niego w delivery. Blokady wydarzenie -> bilet -> zgloszenie (REG-08), event_ended (REG-13), status gosci (REG-07), oferta ceny prowadzacego (REG-16), nowa osoba invitation bez zgod ON CONFLICT, istniejaca nietknieta (REG-14/REG-02). Wynik {client, delivery}; kubelki licza wejscia. Tylko service_role.';

CREATE OR REPLACE FUNCTION public.event_register_group_guests_for_client(
  _tenant_id uuid,
  _user_id uuid,
  _ip_subject text,
  p_lead_registration_id uuid,
  p_guests jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_prev_sub text := current_setting('request.jwt.claim.sub', true);
  v_prev_role text := current_setting('request.jwt.claim.role', true);
  v_prev_claims text := current_setting('request.jwt.claims', true);
  v_ip_ok boolean;
  v_user_ok boolean;
  v_out jsonb;
BEGIN
  -- Tozsamosc od serwera: najemca z zaufanego hosta, solony skrot adresu -
  -- nigdy surowy adres. Brak ktoregos to blad serwera, nie odpowiedz.
  -- Bez konta goscia nie ma kogo dopisac: odmowa wartoscia, bez kubelka.
  IF _user_id IS NULL THEN
    PERFORM public._require_server_probe(_tenant_id, _ip_subject);
    RETURN jsonb_build_object(
      'client', jsonb_build_object('ok', false, 'error', 'account_required'),
      'delivery', '[]'::jsonb);
  END IF;
  PERFORM public._require_server_identity(_tenant_id, _user_id, _ip_subject);

  -- KUBELKI PRZED PRACA, POZA PODTRANSAKCJA RDZENIA (R38, REG-04). Adres:
  -- ten sam kubelek i prog co zapis zalogowanego (`event_register.ip`, 120 /
  -- 10 min - kazde wpisanie adresu na liste wydarzenia z jednego IP liczy sie
  -- razem); konto: `event_register.guests` (12 / 10 min, jak dotad). Odmowa
  -- rdzenia wraca wartoscia, wiec zadna proba nie cofa licznika.
  SELECT h.allowed INTO v_ip_ok
    FROM public.rate_limit_hit('event_register.ip', _ip_subject, 120, 10) h;
  SELECT h.allowed INTO v_user_ok
    FROM public.rate_limit_hit('event_register.guests', 'user:' || _user_id::text, 12, 10) h;
  IF NOT COALESCE(v_ip_ok, false) OR NOT COALESCE(v_user_ok, false) THEN
    RETURN jsonb_build_object(
      'client', jsonb_build_object('ok', false, 'error', 'rate_limited'),
      'delivery', '[]'::jsonb);
  END IF;

  -- Na czas wywolania wolajacym JEST konto z sesji (wyzwalacze i zdarzenia
  -- domenowe czytaja auth.uid()); potem poprzednia tozsamosc.
  PERFORM public._set_request_identity(
    _user_id::text, 'authenticated',
    jsonb_build_object('sub', _user_id, 'role', 'authenticated')::text);
  v_out := public._event_register_group_guests(_tenant_id, _user_id, p_lead_registration_id, p_guests);
  PERFORM public._set_request_identity(v_prev_sub, v_prev_role, v_prev_claims);
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.event_register_group_guests_for_client(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_register_group_guests_for_client(uuid, uuid, text, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.event_register_group_guests_for_client(uuid, uuid, text, uuid, jsonb) IS
  'Dopisanie gosci z funkcji serwerowej (registerEventGroupGuests) - TYLKO service_role. Najemca z zaufanego hosta, konto ze zweryfikowanej sesji (NULL = account_required), solony skrot adresu ip:<32 hex> - argumentami. Kubelki event_register.ip (120 / 10 min, wspolny z zapisem) i event_register.guests (12 / 10 min na konto) przed praca. Zwraca {client, delivery}: client {ok:true, added} | {ok:false, error} (bez detail); delivery = wiadomosci event_registration_already_registered dla pominietych gosci - tylko dla serwera.';

CREATE OR REPLACE FUNCTION public.event_register_group_guests(p_lead_registration_id uuid, p_guests jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'account_required');
  END IF;

  SELECT h.allowed INTO v_allowed
    FROM public.rate_limit_hit('event_register.guests', 'user:' || v_uid::text, 12, 10) h;
  IF NOT COALESCE(v_allowed, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  RETURN public._event_register_group_guests(
    public.public_tenant_id(), v_uid, p_lead_registration_id, p_guests)->'client';
END;
$$;
REVOKE ALL ON FUNCTION public.event_register_group_guests(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_register_group_guests(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.event_register_group_guests(uuid, jsonb) IS
  'Wrapper zgodnosci dopisania gosci - TYLKO service_role (od 20261012180300; dotad authenticated). Najemca z hosta, konto z JWT, kubelek konta event_register.guests (12 / 10 min), rdzen _event_register_group_guests; zwraca sam client ({ok:true, added} | {ok:false, error}), bez wiadomosci do pominietych gosci. Przegladarka dopisuje przez registerEventGroupGuests -> event_register_group_guests_for_client.';