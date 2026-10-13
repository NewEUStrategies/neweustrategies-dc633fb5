-- events-harness: include
-- ============================================================================
-- SCALENIE Z MAIN (PR #504), CZ. 5: PRZYJECIE ZAPROSZENIA Z PAKIETU =
-- REG-01/02/14/15 + R12/R38 (REG) + TIX-07/TIX-04 (main).
--
-- POCHODZENIE
--   * REG: 20261012132200 (REG-15: wlasciciel po potwierdzonym adresie,
--     regulamin, pola, stan wydarzenia, kubelek pudel), 20261012180200 (R38:
--     znaki sterujace), 20261012180550 (R12: wlasciciel = potwierdzony adres
--     ORAZ osoba bez konta albo z kontem wolajacego) - zgody przez rejestr A2,
--     konto tylko przez `_event_bind_uid_for_email`.
--   * main: 20261012130001 (TIX-07) - zaproszenie z NIEOPLACONEGO zamowienia
--     daje zgloszenie `pending` bez kodu QR (wchodzi na miejsce przy oplaceniu
--     zamowienia - `_event_package_order_set_status_core`, albo od razu przy
--     `admit_before_payment`), odpowiedz `awaiting_payment`; zgloszenie
--     wstawiane jako `pending` i przyjmowane DOPIERO po przypisaniu miejsca
--     (TIX-04: miejsce pakietu trzyma pule, dopoki zgloszenie nie jest na
--     miejscu - inaczej ksiega liczy jedno miejsce dwa razy i CHECK
--     `event_ticket_types_sold_within_quota` odrzuca przyjecie przy pelnej
--     puli); zrodlo `package_invitation` (CHECK-i dostaly te wartosc;
--     przeglad zamowien i lejek reklam rozpoznaja po nim delegatow).
--
-- DEFEKT (stan po samym scaleniu): plik REG 20261012180550 sortuje sie PO
--   20261012130001, wiec jego cialo (zbudowane na 20260827221214) wycofywalo
--   TIX-07: delegat zamowienia nieoplaconego dostawal `approved` z kodem QR
--   (wejscie bez zaplaty), zgloszenie wchodzilo `approved` PRZED przypisaniem
--   miejsca (podwojne liczenie w ksiedze), a zrodlo `invitation` gubilo
--   delegatow w `_event_package_order_set_status_core` (oplacenie zamowienia
--   ich nie przyjmowalo, anulowanie nie zamykalo).
--
-- ZMIANA: cialo REG (20261012180550) + zmiany main oznaczone
--   `ZMIANA (scalenie z main, TIX-07)`; obie strony juz zachowywaly skrot
--   tokenu (CHECK `event_package_seats_invite_pair`). Zamowienie zwrocone
--   zostaje osobnym kodem REG `order_refunded` (main: `order_cancelled`) -
--   TS po scaleniu zna oba.
--
-- CZEGO TO NIE ZAMYKA. Zapis `event_people.user_id` dalej wylacznie przez
--   `_event_bind_uid_for_email`; naprawa historii REG-01 biegnie po tej
--   migracji jeszcze raz (20261013900900).
-- KOLEJNOSC WDROZENIA: dowolna wzgledem kodu (klucz `awaiting_payment` czyta
--   TS po scaleniu, `qr_token` moze byc null). PO wszystkich migracjach main
--   i REG, PRZED 20261013900900.
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: scripts/events-harness/runtime_test.d/78_ticket_checkout_integrity.sql
--   (main, TIX-07), 25_account_binding_invites.sql (REG),
--   supabase/tests/event_package_invite_accept_test.sql (REG),
--   event_identity_consents_r12_test.sql (REG), reg_main_merge_test.sql.
-- ============================================================================

-- Cialo z 20261012180550:34-442. Zmiany `ZMIANA (scalenie z main, TIX-07)`.
CREATE OR REPLACE FUNCTION public.event_package_invite_accept(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_token text := btrim(COALESCE(p_payload->>'token', ''));
  v_first text := btrim(COALESCE(p_payload->>'first_name', ''));
  v_last text := btrim(COALESCE(p_payload->>'last_name', ''));
  v_job text := NULLIF(btrim(COALESCE(p_payload->>'job_title', '')), '');
  v_company text := NULLIF(btrim(COALESCE(p_payload->>'company_text', '')), '');
  v_answers jsonb := COALESCE(p_payload->'answers', '{}'::jsonb);
  v_data_ok boolean := lower(COALESCE(p_payload->>'consent_data_processing', '')) IN ('true', 't', '1');
  v_marketing boolean := lower(COALESCE(p_payload->>'consent_marketing', '')) IN ('true', 't', '1');
  v_lang_raw text := lower(btrim(COALESCE(p_payload->>'lang', '')));
  v_version_raw text := btrim(COALESCE(p_payload->>'consent_text_version', ''));
  v_lang text;
  v_text_version integer;
  v_accepted uuid[];
  v_hash text;
  v_seat_id uuid;
  v_order_id uuid;
  v_event_id uuid;
  v_seat public.event_package_seats;
  v_order public.event_package_orders;
  v_event public.events;
  v_package public.event_ticket_packages;
  v_person public.event_people;
  v_missing text[];
  v_verified boolean;
  v_owner boolean;
  v_new_person boolean;
  v_bind_uid uuid;
  v_submitted jsonb;
  v_submitted_profile jsonb;
  v_group_id uuid;
  v_reg_id uuid;
  v_qr text;
  v_manage text;
  v_marketing_recorded boolean := false;
  v_admit boolean;  -- TIX-07 (main)
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: invitation does not exist';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload: invitation payload must be a JSON object';
  END IF;
  IF length(p_payload::text) > 65536 THEN
    RAISE EXCEPTION 'payload_too_large: invitation payload exceeds 64 kB';
  END IF;

  -- Ksztalt tokenu: 32 znaki base64url (organizator) albo 64 hex (kupujacy).
  -- Zly ksztalt nie trafia w indeks - odmowa bez liczenia (nie ma czego
  -- zgadywac), ta sama co dla nieistniejacego tokenu.
  IF v_token !~ '^[A-Za-z0-9_-]{32,128}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  -- Sufity pol - te same liczby co CHECK-i `event_people`
  -- i `REGISTRATION_FIELD_LIMITS` (TS). Za dlugie pole to ODMOWA, nigdy
  -- przyciecie. Walidacja PRZED tokenem: blad formularza nie mowi nic
  -- o zaproszeniu.
  IF v_first = '' OR v_last = '' THEN
    RAISE EXCEPTION 'invalid_name: first name and last name are required';
  END IF;
  IF char_length(v_first) > 80 OR char_length(v_last) > 80 THEN
    RAISE EXCEPTION 'invalid_name: first name and last name are at most 80 characters';
  END IF;
  IF v_job IS NOT NULL AND char_length(v_job) > 160 THEN
    RAISE EXCEPTION 'invalid_job_title: the job title is at most 160 characters';
  END IF;
  IF v_company IS NOT NULL AND char_length(v_company) > 200 THEN
    RAISE EXCEPTION 'invalid_company: the organisation name is at most 200 characters';
  END IF;
  -- ZMIANA 20261012 (R38, REG-04): znaki sterujace (C0, DEL, C1) - ta sama
  -- regula i te same kody co zapis (`_event_text_has_control`), takze PRZED
  -- tokenem. W tekscie jsonb `submitted_profile` kazdy rosl do szesciu
  -- znakow, a zapis osoby istniejacej i nowej nie moze odpowiadac inaczej.
  IF public._event_text_has_control(v_first) OR public._event_text_has_control(v_last) THEN
    RAISE EXCEPTION 'invalid_name: names cannot contain control characters';
  END IF;
  IF public._event_text_has_control(v_job) THEN
    RAISE EXCEPTION 'invalid_job_title: the job title cannot contain control characters';
  END IF;
  IF public._event_text_has_control(v_company) THEN
    RAISE EXCEPTION 'invalid_company: the organisation name cannot contain control characters';
  END IF;
  IF NOT v_data_ok THEN
    RAISE EXCEPTION 'consent_required: consent to data processing is required';
  END IF;
  IF jsonb_typeof(v_answers) <> 'object' THEN
    RAISE EXCEPTION 'invalid_answers: answers must be a JSON object';
  END IF;

  -- Jezyk i wersja tekstow zgod, ktore osoba widziala (jak `_event_register`).
  v_lang := CASE WHEN v_lang_raw = '' THEN 'pl' ELSE v_lang_raw END;
  IF v_lang NOT IN ('pl', 'en') THEN
    RAISE EXCEPTION 'invalid_payload: lang must be pl or en';
  END IF;
  IF v_version_raw = '' THEN
    SELECT t.version INTO v_text_version
      FROM public.event_consent_texts t
     WHERE t.purpose = 'data_processing' AND t.lang = v_lang AND t.retired_at IS NULL;
  ELSIF v_version_raw ~ '^[0-9]{1,6}$' THEN
    v_text_version := v_version_raw::integer;
  ELSE
    RAISE EXCEPTION 'invalid_payload: consent_text_version must be a positive integer';
  END IF;
  BEGIN
    PERFORM public._event_consent_text_check('data_processing', v_text_version, v_lang);
    IF v_marketing THEN
      PERFORM public._event_consent_text_check('marketing', v_text_version, v_lang);
    END IF;
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION 'invalid_payload: consent text version % (%) is unknown',
      COALESCE(v_text_version::text, '?'), v_lang;
  END;

  SELECT COALESCE(array_agg(x::uuid), ARRAY[]::uuid[]) INTO v_accepted
  FROM jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(p_payload->'accepted_term_ids') = 'array'
        THEN p_payload->'accepted_term_ids'
      ELSE '[]'::jsonb
    END
  ) AS t(x)
  WHERE x ~ '^[0-9a-fA-F-]{36}$';

  -- STRAZNIK PRZED WYSZUKANIEM: przy pelnym kubelku nawet dobry token nie
  -- dostaje odpowiedzi - zablokowany nie ma wyroczni.
  PERFORM public._event_invite_probe_guard(v_tenant, v_uid);

  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  SELECT s.id, s.package_order_id, s.event_id INTO v_seat_id, v_order_id, v_event_id
    FROM public.event_package_seats s
   WHERE s.tenant_id = v_tenant
     AND s.invite_token_hash = v_hash
     AND s.revoked_at IS NULL;
  -- PUDLO = WARTOSC. Brak tokenu, token obcego najemcy i miejsce cofniete to
  -- jedna odpowiedz; wyjatek wycofalby zliczenie.
  IF v_seat_id IS NULL THEN
    PERFORM public._event_invite_probe_miss(v_tenant, v_uid);
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  -- BLOKADY: wydarzenie -> zamowienie -> miejsce -> osoba (D11: kazdy
  -- zapisujacy bierze najpierw wydarzenie; anulowanie zamowienia bierze
  -- zamowienie przed miejscami, wiec obie sciezki ida jedna kolejnoscia).
  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.id = v_event_id
   FOR UPDATE;
  SELECT o.* INTO v_order
    FROM public.event_package_orders o
   WHERE o.tenant_id = v_tenant AND o.id = v_order_id
   FOR UPDATE;
  SELECT s.* INTO v_seat
    FROM public.event_package_seats s
   WHERE s.tenant_id = v_tenant AND s.id = v_seat_id
   FOR UPDATE;
  -- Miejsce moglo zostac cofniete albo przeadresowane miedzy odczytem
  -- a blokada - wtedy token juz nie dziala.
  IF v_seat.id IS NULL OR v_seat.revoked_at IS NOT NULL
     OR v_seat.invite_token_hash IS DISTINCT FROM v_hash THEN
    PERFORM public._event_invite_probe_miss(v_tenant, v_uid);
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  IF v_seat.registration_id IS NOT NULL THEN
    RAISE EXCEPTION 'seat_taken: this invitation has already been used';
  END IF;
  IF v_seat.invite_expires_at IS NOT NULL AND now() > v_seat.invite_expires_at THEN
    RAISE EXCEPTION 'invitation_expired: the invitation has expired';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'order_cancelled: the order behind this seat is cancelled';
  END IF;
  -- ZWROCONE zamowienie tez nie oddaje miejsca: pieniadze wrocily do firmy.
  IF v_order.status = 'refunded' THEN
    RAISE EXCEPTION 'order_refunded: the order behind this seat was refunded';
  END IF;

  -- WYDARZENIE (D7): ta sama regula konca co zapis i strona wydarzenia.
  IF v_event.id IS NULL OR v_event.status <> 'published' THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;
  IF v_event.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_cancelled: the event has been cancelled';
  END IF;
  IF COALESCE(v_event.ends_at, v_event.starts_at) < now() THEN
    RAISE EXCEPTION 'event_ended: the event is over';
  END IF;

  -- POLA I ZGODY FORMULARZA - te same zapytania co `_event_register`.
  IF v_event.registration_mode = 'form' THEN
    SELECT COALESCE(array_agg(f.key ORDER BY f.sort_order, f.key), ARRAY[]::text[])
      INTO v_missing
      FROM public.event_registration_fields f
     WHERE f.tenant_id = v_tenant
       AND f.event_id = v_event.id
       AND f.is_active
       AND f.is_required
       AND f.field_type <> 'consent'
       AND NOT public._event_answer_matches('not_empty', 'null'::jsonb, v_answers -> f.key);
    IF COALESCE(array_length(v_missing, 1), 0) > 0 THEN
      RAISE EXCEPTION 'missing_required_fields: %', array_to_string(v_missing, ',');
    END IF;

    SELECT COALESCE(array_agg(f.key ORDER BY f.sort_order, f.key), ARRAY[]::text[])
      INTO v_missing
      FROM public.event_registration_fields f
     WHERE f.tenant_id = v_tenant
       AND f.event_id = v_event.id
       AND f.is_active
       AND f.is_required
       AND f.field_type = 'consent'
       AND NOT public._event_answer_matches('is_true', 'null'::jsonb, v_answers -> f.key);
    IF COALESCE(array_length(v_missing, 1), 0) > 0 THEN
      RAISE EXCEPTION 'missing_required_consents: %', array_to_string(v_missing, ',');
    END IF;
  END IF;

  SELECT COALESCE(array_agg(tr.key ORDER BY tr.sort_order, tr.key), ARRAY[]::text[])
    INTO v_missing
    FROM public.event_terms tr
   WHERE tr.tenant_id = v_tenant
     AND tr.event_id = v_event.id
     AND tr.is_active
     AND tr.is_required
     AND tr.display IN ('registration', 'registration_and_access')
     AND NOT (tr.id = ANY (v_accepted));
  IF COALESCE(array_length(v_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'terms_required: %', array_to_string(v_missing, ',');
  END IF;

  SELECT pk.* INTO v_package
    FROM public.event_ticket_packages pk
   WHERE pk.tenant_id = v_tenant AND pk.id = v_order.package_id;

  -- ZMIANA (scalenie z main, TIX-07): delegat zamowienia NIEOPLACONEGO czeka
  -- bez kodu QR (D11 REG: kod tylko dla rozliczonych), chyba ze organizator
  -- ufa fakturze (`admit_before_payment`). Oplacenie zamowienia przyjmuje go
  -- w `_event_package_order_set_status_core`.
  v_admit := v_order.status = 'paid' OR COALESCE(v_package.admit_before_payment, false);

  -- OSOBA ZAPROSZENIA - pod blokada. Juz zapisana na to wydarzenie: odmowa
  -- PRZED jakimkolwiek zapisem.
  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = v_tenant AND p.email_norm = v_seat.invite_email
   FOR UPDATE;
  v_new_person := v_person.id IS NULL;
  IF NOT v_new_person AND EXISTS (
    SELECT 1 FROM public.event_registrations r
     WHERE r.tenant_id = v_tenant
       AND r.event_id = v_event.id
       AND r.person_id = v_person.id
       AND r.status NOT IN ('cancelled', 'rejected')
  ) THEN
    RAISE EXCEPTION 'already_registered: this person already has an active registration';
  END IF;

  -- KTO MOZE ZMIENIAC KARTOTEKE (D1/D4) - ta sama regula co `_event_register`.
  -- Konto zapisuje sie w `user_id` WYLACZNIE przez `_event_bind_uid_for_email`.
  v_verified := public._event_uid_owns_email(v_uid, v_seat.invite_email);
  -- ZMIANA 20261012 (R12, REG-01/REG-02/REG-15): wlasciciel = wolajacy
  -- z POTWIERDZONYM adresem zaproszenia (D1) ORAZ osoba bez konta albo
  -- z kontem wolajacego - ta sama regula co `_event_register` (20261012180500).
  -- Samo dowiazanie (dryf: zmiana adresu przez organizatora albo konto)
  -- nie daje juz nadpisania imienia, stanowiska i firmy.
  v_owner := COALESCE(
    v_uid IS NOT NULL
    AND v_verified
    AND (v_person.user_id IS NULL OR v_person.user_id = v_uid),
    false);
  v_bind_uid := public._event_bind_uid_for_email(v_tenant, v_uid, v_seat.invite_email);

  IF v_new_person THEN
    INSERT INTO public.event_people (
      tenant_id, user_id, email, first_name, last_name, job_title, company_text,
      source, created_by
    ) VALUES (
      -- ZMIANA (scalenie z main, TIX-07): zrodlo `package_invitation`.
      v_tenant, v_bind_uid, v_seat.invite_email, v_first, v_last, v_job, v_company,
      'package_invitation', v_uid
    )
    RETURNING * INTO v_person;
  ELSIF v_owner THEN
    UPDATE public.event_people p SET
      user_id = COALESCE(p.user_id, v_bind_uid),
      first_name = v_first,
      last_name = v_last,
      job_title = COALESCE(v_job, p.job_title),
      company_text = COALESCE(v_company, p.company_text)
    WHERE p.tenant_id = v_tenant AND p.id = v_person.id
    RETURNING * INTO v_person;
  ELSE
    -- Posiadacz linku, ktory nie jest wlascicielem kartoteki: osoba zostaje
    -- NIETKNIETA (imie, nazwisko, firma, zgody, wycofanie, konto). To, co
    -- przyslal, trafia do zgloszenia do wgladu organizatora - gdy sie rozni.
    v_submitted := jsonb_strip_nulls(jsonb_build_object(
      'first_name', v_first,
      'last_name', v_last,
      'job_title', v_job,
      'company_text', v_company));
    IF NOT (jsonb_strip_nulls(jsonb_build_object(
              'first_name', v_person.first_name,
              'last_name', v_person.last_name,
              'job_title', v_person.job_title,
              'company_text', v_person.company_text)) @> v_submitted) THEN
      v_submitted_profile := v_submitted;
    END IF;
  END IF;

  SELECT t.group_id INTO v_group_id
    FROM public.event_ticket_types t
   WHERE t.tenant_id = v_tenant AND t.id = v_package.ticket_type_id;
  IF v_group_id IS NULL THEN
    SELECT g.id INTO v_group_id
      FROM public.event_groups g
     WHERE g.tenant_id = v_tenant AND g.event_id = v_event.id AND g.is_default;
  END IF;

  v_manage := public._event_new_qr_token();

  -- ZMIANA (scalenie z main, TIX-07/TIX-04): najpierw `pending` bez kodu -
  -- miejsce pakietu dalej trzyma pule biletu (ksiega miejsc main), wiec
  -- zgloszenie przyjete PRZED przypisaniem miejsca liczyloby sie drugi raz.
  -- Przyjecie (z kodem QR) dopiero po przypisaniu, nizej. Zrodlo
  -- `package_invitation` - po nim oplacenie i anulowanie zamowienia znajduja
  -- delegatow.
  INSERT INTO public.event_registrations (
    tenant_id, event_id, person_id, ticket_type_id, group_id, status,
    registration_mode, answers, source, manage_token_hash, created_by,
    submitted_profile, lang
  ) VALUES (
    v_tenant, v_event.id, v_person.id, v_package.ticket_type_id, v_group_id, 'pending',
    CASE WHEN v_event.registration_mode = 'form' THEN 'form' ELSE 'rsvp' END,
    v_answers, 'package_invitation',
    encode(extensions.digest(v_manage, 'sha256'), 'hex'), v_uid,
    v_submitted_profile,
    CASE WHEN v_new_person OR v_owner THEN v_lang END
  )
  RETURNING id INTO v_reg_id;

  -- Miejsce PRZYPISANE, ale adres i skrot tokenu zostaja: para
  -- `event_package_seats_invite_pair` jest spelniona, a ponowne uzycie linku
  -- trafia na `seat_taken` zamiast na „nieznany token".
  UPDATE public.event_package_seats s SET
    registration_id = v_reg_id,
    assigned_at = now()
  WHERE s.tenant_id = v_tenant AND s.id = v_seat.id;

  -- ZMIANA (scalenie z main, TIX-07): przyjecie na miejsce z kodem QR - tylko
  -- zamowienie oplacone albo jawne zaufanie do faktury.
  IF v_admit THEN
    v_qr := public._event_new_qr_token();
    UPDATE public.event_registrations r SET
      status = 'approved',
      decided_at = now(),
      decision_source = 'system',
      qr_token_hash = encode(extensions.digest(v_qr, 'sha256'), 'hex'),
      qr_issued_at = now(),
      updated_at = now()
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant;
  END IF;

  -- Akceptacja regulaminu z wersja. `ip_hash` i `user_agent` NULL: to RPC
  -- klienta nie ma zaufanego podmiotu serwerowego, a wartosc z ladunku nie
  -- jest dowodem (REG-14).
  INSERT INTO public.event_term_acceptances (
    tenant_id, term_id, person_id, registration_id, version, ip_hash, user_agent
  )
  SELECT v_tenant, tr.id, v_person.id, v_reg_id, tr.version, NULL, NULL
    FROM public.event_terms tr
   WHERE tr.tenant_id = v_tenant
     AND tr.event_id = v_event.id
     AND tr.is_active
     AND tr.id = ANY (v_accepted)
  ON CONFLICT (tenant_id, term_id, person_id, version) DO NOTHING;

  -- ZGODY WYLACZNIE PRZEZ REJESTR (A2). Przetwarzanie danych: wpis
  -- `confirmed` z formularza; projekcja tylko dla nowej osoby albo
  -- wlasciciela (cudzej kartoteki nie zmieniamy).
  PERFORM public._event_person_consents_confirm(
    v_tenant, v_person.id, ARRAY['data_processing']::text[], 'registration_form',
    v_event.id, v_reg_id, NULL, v_text_version, v_lang, NULL, NULL,
    v_uid, 'event_package_invite_accept', v_new_person OR v_owner);
  -- Marketing: wylacznie zweryfikowany wlasciciel bez globalnego wycofania
  -- (kanal `verified_account`). Tu nie ma maila double opt-in, wiec kazde
  -- inne zaznaczenie NIE jest zapisywane - nawet jako `pending`.
  IF v_marketing AND v_owner AND v_verified AND v_person.consent_withdrawn_at IS NULL THEN
    PERFORM public._event_person_consents_confirm(
      v_tenant, v_person.id, ARRAY['marketing']::text[], 'verified_account',
      v_event.id, v_reg_id, NULL, v_text_version, v_lang, NULL, NULL,
      v_uid, 'event_package_invite_accept', true);
    v_marketing_recorded := true;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_reg_id::text,
    'event.registration.created.v1',
    jsonb_build_object(
      'event_id', v_event.id,
      'person_id', v_person.id,
      -- ZMIANA (scalenie z main, TIX-07): status i zrodlo jak w wierszu.
      'status', CASE WHEN v_admit THEN 'approved' ELSE 'pending' END,
      'ticket_type_id', v_package.ticket_type_id,
      'source', 'package_invitation'
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'ok', true,
    'registration_id', v_reg_id,
    'event_id', v_event.id,
    'event_slug', v_event.slug,
    -- ZMIANA (scalenie z main, TIX-07): czekajacy na zaplate bez kodu QR.
    'status', CASE WHEN v_admit THEN 'approved' ELSE 'pending' END,
    'awaiting_payment', NOT v_admit,
    'qr_token', v_qr,
    'manage_token', v_manage,
    'account_linked', COALESCE(v_uid IS NOT NULL AND v_person.user_id = v_uid, false),
    'marketing_recorded', v_marketing_recorded
  );
END;
$$;
REVOKE ALL ON FUNCTION public.event_package_invite_accept(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_package_invite_accept(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_package_invite_accept(jsonb) IS
  'REG-15: przyjecie zaproszenia na miejsce z pakietu (token po sha256, najemca z hosta). Pudlo tokenu jako wartosc {ok:false,error:invalid_token} liczone w _event_invite_probe_* (najemca + konto). Pola z sufitami i bez znakow sterujacych (_event_text_has_control, R38) przed tokenem. Wydarzenie opublikowane/nieodwolane/niezakonczone, zamowienie nie cancelled/refunded, pola, zgody formularza i regulaminy obowiazkowe. Konto wiaze sie tylko przez _event_bind_uid_for_email z adresem zaproszenia; kartoteke zmienia tylko wlasciciel (R12: potwierdzony adres zaproszenia ORAZ osoba bez konta albo z kontem wolajacego), cudza kartoteka nietknieta (submitted_profile); zgody przez rejestr A2 (marketing tylko zweryfikowany wlasciciel). Zrodlo package_invitation; zgloszenie wstawiane jako pending, przyjete z kodem QR po przypisaniu miejsca tylko przy zamowieniu oplaconym albo admit_before_payment (TIX-07/TIX-04, awaiting_payment w odpowiedzi); miejsce zachowuje adres i skrot tokenu (ponownie: seat_taken).';
