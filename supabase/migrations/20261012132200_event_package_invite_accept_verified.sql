-- events-harness: include
-- ============================================================================
-- ZAPROSZENIE NA MIEJSCE Z PAKIETU (B2, CZESC 3): PRZYJECIE Z WIAZANIEM KONTA
-- TYLKO PRZEZ POTWIERDZONY ADRES, Z REGULAMINEM, POLAMI I STANEM WYDARZENIA,
-- PUDLA TOKENU LICZONE WARTOSCIA; NOWY PODGLAD ZAPROSZENIA (REG-15, REG-01).
--
-- DEFEKT (jedyna definicja: 20260827221214:561-742).
--   1. Funkcja byla MARTWA: zapisywala `source = 'package_invitation'` do
--      `event_people` (:654) i `event_registrations` (:699) - obie listy CHECK
--      tej wartosci nie znaja - a przy konsumpcji zerowala
--      `invite_token_hash` przy zachowanym `invite_email` (:708), co lamie
--      `event_package_seats_invite_pair`. Kazde przyjecie konczylo sie
--      bledem 23514 (znany wyjatek w check_whitelist_writers_test.sql).
--   2. Nowa osoba dostawala `user_id = auth.uid()` (:653) bez porownania
--      z adresem zaproszenia - posiadacz linku (takze kupujacy, ktory dostaje
--      jawny token) wiazal SWOJE konto z kartoteka zaproszonego. Konto juz
--      dowiazane do innej osoby dostawalo 23505.
--   3. Istniejaca osoba byla nadpisywana (imie, nazwisko) i dostawala
--      `consent_withdrawn_at = NULL` (:657-665) - kazdy posiadacz linku
--      zdejmowal wycofanie zgod (REG-02).
--   4. Brak sprawdzenia wydarzenia (opublikowane, odwolane, zakonczone),
--      zamowienia zwroconego (tylko 'cancelled', :637), regulaminu, pol
--      obowiazkowych i zgod formularza; brak wiersza akceptacji regulaminu.
--   5. Limit prob kluczowany LADUNKIEM (`ip_hash` albo poczatek tokenu,
--      :605-609) i wycofywany kazdym `RAISE invalid_token` (:623).
--
-- ZMIANA
--   A. `_event_invite_probe_guard(najemca, konto)` /
--      `_event_invite_probe_miss(najemca, konto)` - straznik i licznik pudel
--      tokenu: kubelek najemcy (300 / 10 min) i kubelek konta wspolny
--      z sondami kodow (`_coupon_probe_bucket`, 30 / 10 min). Klucze wylacznie
--      z bazy i sesji. Straznik PODGLADA (dobry token nie zjada kubelka),
--      licznik nigdy nie rzuca.
--   B. `event_package_invite_accept(jsonb)` - pelne przepisanie (projekt C5):
--      pudlo tokenu WARTOSCIA `{ok:false,error:'invalid_token'}` (licznik
--      zostaje); blokady wydarzenie -> zamowienie -> miejsce -> osoba (D11);
--      wydarzenie opublikowane, nieodwolane, niezakonczone
--      (`COALESCE(ends_at, starts_at) < now()` - `event_ended`, D7); zamowienie
--      anulowane/zwrocone odrzucone; pola obowiazkowe, zgody formularza
--      i regulaminy jak w `_event_register`; konto wiaze sie WYLACZNIE przez
--      `_event_bind_uid_for_email` z adresem ZAPROSZENIA; istniejaca osobe
--      zmienia tylko jej wlasciciel (inaczej `submitted_profile`); zgody
--      wylacznie przez rejestr A2; zrodlo 'invitation'; miejsce zachowuje
--      adres i skrot tokenu (para CHECK), ponowne uzycie = `seat_taken`;
--      akceptacja regulaminu z wersja; odpowiedz z `account_linked`.
--   C. `event_package_invite_preview(jsonb)` (anon, authenticated) - stan
--      zaproszenia przed wypelnieniem formularza: wydarzenie (slug do
--      formularza), imie z zaproszenia, ZAMASKOWANY adres, czy zalogowane
--      konto ma potwierdzony adres zaproszenia, stan
--      (open/used/expired/order_cancelled/order_refunded/event_cancelled/
--      event_ended/unavailable). Te same pudla i kubelki co przyjecie.
--
-- CZEGO TO NIE ZAMYKA
--   * Token NIE dowodzi skrzynki: kupujacy i organizator dostaja go jawnie
--     (packagesApi.ts, admissionApi.ts) i przekazuja recznie. Miejsce
--     moze wiec zajac kazdy posiadacz linku - ale konto wiaze sie tylko
--     z potwierdzonym adresem zaproszenia, a cudza kartoteka sie nie zmienia.
--   * Zgoda marketingowa: tylko zweryfikowany wlasciciel bez globalnego
--     wycofania (kanal `verified_account`). Ta sciezka nie ma maila double
--     opt-in, wiec zaznaczenie przez kogokolwiek innego NIE jest zapisywane
--     (ani jako `pending`) - zgode da sie wyrazic zwyklym zapisem albo
--     z panelu zgod. Zgody na udostepnianie partnerom zaproszenie nie zbiera.
--   * Dowod adresu IP i przegladarki: to RPC klienta bez zaufanego podmiotu
--     serwerowego - `ip_hash` i `user_agent` akceptacji regulaminu sa NULL
--     (wartosc z ladunku nie jest dowodem).
--   * Zamowienie `pending` (faktura po wydarzeniu) dalej oddaje miejsca -
--     decyzja platnosci B2B poza ta jednostka.
--   * Kubelek najemcy (300 pudel / 10 min) mozna celowo wyczerpac i na chwile
--     zablokowac przyjmowanie zaproszen u najemcy - swiadomy koszt: token ma
--     >= 192 bity, wiec kubelek ogranicza naduzycie, nie zgadywanie.
--
-- KOLEJNOSC WDROZENIA: NAJPIERW KOD. Strona zaproszenia (packageInviteApi.ts)
-- czyta odmowe i jako wyjatek (stara baza), i jako wartosc `{ok:false}`
-- (nowa), a brak `event_package_invite_preview` (42883/PGRST202) traktuje jak
-- podglad niedostepny i pokazuje sam formularz. Stara funkcja i tak nie
-- przyjmowala zadnego zaproszenia (CHECK).
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_package_invite_accept_test.sql,
--   supabase/tests/check_whitelist_writers_test.sql,
--   supabase/tests/event_consent_writers_test.sql,
--   scripts/events-harness/runtime_test.d/25_account_binding_invites.sql.
-- ============================================================================

-- A) KUBELKI PUDEL TOKENU ZAPROSZENIA -----------------------------------------------
-- Okno jak w `rate_limit_hit` (10 minut) - inna arytmetyka dalaby inny
-- `window_start` i podglad czytalby pusty wiersz.
CREATE OR REPLACE FUNCTION public._event_invite_probe_guard(p_tenant uuid, p_uid uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_start timestamptz := to_timestamp((floor(extract(epoch FROM now()) / 600) * 600)::double precision);
  v_count integer;
BEGIN
  -- PODGLAD, nie zliczenie: dobry token nie zjada kubelka.
  IF p_tenant IS NOT NULL THEN
    SELECT rl.count INTO v_count
      FROM public.rate_limits rl
     WHERE rl.scope = 'event_invite_miss.tenant'
       AND rl.subject_id = 'tenant:' || p_tenant::text
       AND rl.window_start = v_start;
    IF COALESCE(v_count, 0) >= 300 THEN
      RAISE EXCEPTION 'rate_limited: too many invitation attempts, try again later';
    END IF;
  END IF;
  -- Kubelek konta wspolny z sondami kodow: konto, ktore zgaduje kody, nie
  -- dostaje drugiej puli na tokeny zaproszen. Bez konta - pominiety.
  PERFORM public._coupon_probe_guard(p_uid, NULL);
END $$;
REVOKE ALL ON FUNCTION public._event_invite_probe_guard(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invite_probe_guard(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._event_invite_probe_miss(p_tenant uuid, p_uid uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_b record;
BEGIN
  -- Bez wyjatku przy przekroczeniu: pudlo i tak jest odmowa, a wyjatek
  -- wycofalby zliczenie. Nastepna proba zatrzyma sie na strazniku.
  IF p_tenant IS NOT NULL THEN
    PERFORM public.rate_limit_hit('event_invite_miss.tenant', 'tenant:' || p_tenant::text, 300, 10);
  END IF;
  -- Polityka kubelka konta z `_coupon_probe_bucket` (jedno miejsce liczb),
  -- ale zliczenie wprost: `_coupon_probe_miss` rzuca przy przekroczeniu.
  IF p_uid IS NOT NULL THEN
    SELECT * INTO v_b FROM public._coupon_probe_bucket(p_uid);
    PERFORM public.rate_limit_hit(v_b.scope, v_b.subject, v_b.max_misses, v_b.window_minutes);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._event_invite_probe_miss(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_invite_probe_miss(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_invite_probe_guard(uuid, uuid) IS
  'REG-15: straznik pudel tokenu zaproszenia pakietowego - 300 na najemce (event_invite_miss.tenant) i 30 na konto (kubelek sond kodow) w oknie 10 minut -> rate_limited. Podglad bez zliczania; NULL pomija dany kubelek. Klucze z bazy i sesji, nigdy z ladunku.';
COMMENT ON FUNCTION public._event_invite_probe_miss(uuid, uuid) IS
  'REG-15: zlicza pudlo tokenu zaproszenia w kubelku najemcy i konta (rate_limit_hit); nigdy nie rzuca, wiec odmowa zwracana wartoscia zostawia licznik.';

-- B) PRZYJECIE ZAPROSZENIA -------------------------------------------------------------
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
  -- Wlasciciel = konto juz dowiazane do osoby albo konto z POTWIERDZONYM
  -- adresem zaproszenia, gdy osoba nie ma konta. Konto zapisuje sie
  -- w `user_id` WYLACZNIE przez `_event_bind_uid_for_email`.
  v_verified := public._event_uid_owns_email(v_uid, v_seat.invite_email);
  v_owner := COALESCE(
    v_uid IS NOT NULL
    AND (v_person.user_id = v_uid OR (v_person.user_id IS NULL AND v_verified)),
    false);
  v_bind_uid := public._event_bind_uid_for_email(v_tenant, v_uid, v_seat.invite_email);

  IF v_new_person THEN
    INSERT INTO public.event_people (
      tenant_id, user_id, email, first_name, last_name, job_title, company_text,
      source, created_by
    ) VALUES (
      v_tenant, v_bind_uid, v_seat.invite_email, v_first, v_last, v_job, v_company,
      'invitation', v_uid
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

  v_qr := public._event_new_qr_token();
  v_manage := public._event_new_qr_token();

  -- Miejsce jest juz oplacone przez firme, wiec zgloszenie wchodzi zatwierdzone;
  -- pula biletu nie jest tu dotykana, bo zajely ja miejsca pakietu.
  INSERT INTO public.event_registrations (
    tenant_id, event_id, person_id, ticket_type_id, group_id, status,
    registration_mode, answers, source, decided_at, decision_source,
    qr_token_hash, qr_issued_at, manage_token_hash, created_by,
    submitted_profile, lang
  ) VALUES (
    v_tenant, v_event.id, v_person.id, v_package.ticket_type_id, v_group_id, 'approved',
    CASE WHEN v_event.registration_mode = 'form' THEN 'form' ELSE 'rsvp' END,
    v_answers, 'invitation', now(), 'system',
    encode(extensions.digest(v_qr, 'sha256'), 'hex'), now(),
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
      'status', 'approved',
      'ticket_type_id', v_package.ticket_type_id,
      'source', 'invitation'
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'ok', true,
    'registration_id', v_reg_id,
    'event_id', v_event.id,
    'event_slug', v_event.slug,
    'status', 'approved',
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
  'REG-15: przyjecie zaproszenia na miejsce z pakietu (token po sha256, najemca z hosta). Pudlo tokenu jako wartosc {ok:false,error:invalid_token} liczone w _event_invite_probe_* (najemca + konto). Wydarzenie opublikowane/nieodwolane/niezakonczone, zamowienie nie cancelled/refunded, pola, zgody formularza i regulaminy obowiazkowe. Konto wiaze sie tylko przez _event_bind_uid_for_email z adresem zaproszenia; cudza kartoteka nietknieta (submitted_profile); zgody przez rejestr A2 (marketing tylko zweryfikowany wlasciciel). Zrodlo invitation; miejsce zachowuje adres i skrot tokenu (ponownie: seat_taken).';

-- C) PODGLAD ZAPROSZENIA -------------------------------------------------------------
-- Strona zaproszenia przed formularzem: czy link dziala, na jakie wydarzenie
-- (slug -> `event_registration_form` z polami i regulaminem) i czy
-- zalogowane konto zostanie dowiazane. Bez blokad. Adres zaproszenia tylko
-- zamaskowany - pelny adres zna zaproszony, nie kazdy posiadacz linku.
-- Wydarzenie nieopublikowane: stan 'unavailable' BEZ danych wydarzenia.
CREATE OR REPLACE FUNCTION public.event_package_invite_preview(p_payload jsonb)
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
  v_seat public.event_package_seats;
  v_order public.event_package_orders;
  v_event public.events;
  v_state text;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: invitation does not exist';
  END IF;
  IF v_token !~ '^[A-Za-z0-9_-]{32,128}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  PERFORM public._event_invite_probe_guard(v_tenant, v_uid);

  SELECT s.* INTO v_seat
    FROM public.event_package_seats s
   WHERE s.tenant_id = v_tenant
     AND s.invite_token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
     AND s.revoked_at IS NULL;
  IF v_seat.id IS NULL THEN
    PERFORM public._event_invite_probe_miss(v_tenant, v_uid);
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  SELECT o.* INTO v_order
    FROM public.event_package_orders o
   WHERE o.tenant_id = v_tenant AND o.id = v_seat.package_order_id;
  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.id = v_seat.event_id;

  IF v_event.id IS NULL OR v_event.status <> 'published' THEN
    RETURN jsonb_build_object('ok', true, 'state', 'unavailable');
  END IF;

  -- Kolejnosc jak w przyjeciu: najpierw to, co dotyczy samego linku.
  v_state := CASE
    WHEN v_seat.registration_id IS NOT NULL THEN 'used'
    WHEN v_seat.invite_expires_at IS NOT NULL AND now() > v_seat.invite_expires_at THEN 'expired'
    WHEN v_order.status = 'cancelled' THEN 'order_cancelled'
    WHEN v_order.status = 'refunded' THEN 'order_refunded'
    WHEN v_event.cancelled_at IS NOT NULL THEN 'event_cancelled'
    WHEN COALESCE(v_event.ends_at, v_event.starts_at) < now() THEN 'event_ended'
    ELSE 'open'
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'state', v_state,
    'event_id', v_event.id,
    'event_slug', v_event.slug,
    'event_title_pl', v_event.title_pl,
    'event_title_en', v_event.title_en,
    'event_starts_at', v_event.starts_at,
    'invite_name', NULLIF(btrim(v_seat.invite_name), ''),
    'invite_email_hint', public._event_email_hint(v_seat.invite_email),
    'account_matches', public._event_uid_owns_email(v_uid, v_seat.invite_email),
    'expires_at', v_seat.invite_expires_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.event_package_invite_preview(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_package_invite_preview(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_package_invite_preview(jsonb) IS
  'REG-15: podglad zaproszenia pakietowego przed przyjeciem (token po sha256, najemca z hosta): stan open|used|expired|order_cancelled|order_refunded|event_cancelled|event_ended|unavailable, wydarzenie (slug do event_registration_form), imie z zaproszenia, zamaskowany adres, account_matches (konto ma potwierdzony adres zaproszenia). Pudlo jako wartosc {ok:false,error:invalid_token} liczone w _event_invite_probe_*.';
