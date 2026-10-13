-- events-harness: include
-- ============================================================================
-- WYDARZENIA: PRZYJECIE ZAPROSZENIA Z PAKIETU NIE PRZYPINA CUDZEGO KONTA (F14,
-- po przegladzie koncowym OPS).
--
-- PROBLEM. Od 20261013111800 `event_package_invite_accept(jsonb)` wreszcie
-- dziala - i nowa osobe z zaproszenia zakladala z `user_id = auth.uid()`.
-- Trasa `/events/invite/$token` wola RPC klientem przegladarki, wiec
-- zalogowany gosc wysyla swoj JWT. Dwa skutki:
--   1. kupujacy pakiet, ktory otworzy link kolegi (np. zeby go sprawdzic),
--      dostaje na swoje konto kartoteke `kolega@...`: widok zarzadzania,
--      wycofanie zgod, odwolanie. Kolega nigdy nie przypnie do niej
--      wlasnego konta - kazda droga wiazania robi `COALESCE(p.user_id, ...)`,
--      a wycofanie zgody partnerskiej (20261013110400) uznaje
--      `p.user_id = auth.uid()` za wlasnosc;
--   2. konto, ktore ma juz osobe w tym najemcy pod innym adresem (zaproszenie
--      na adres sluzbowy, zalogowany prywatnym kontem), wpada w
--      `event_people_tenant_user_uniq` i dostaje surowe 23505 zamiast
--      zgloszenia.
-- `event_register` ma na to regule `v_bind_uid`; przyjecie zaproszenia jej
-- nie mialo.
--
-- ZMIANA: `event_package_invite_accept(jsonb)` - cialo z 20261013111800
-- z JEDNA zmiana merytoryczna w galezi NOWEJ osoby:
--   * konto wolajacego trafia do `user_id` TYLKO gdy (a) w tym najemcy nie
--     ma innej osoby z tym kontem - regula `v_bind_uid` z `event_register`
--     (20261013110100) - ORAZ (b) konto ma POTWIERDZONY adres
--     (`auth.users.email_confirmed_at IS NOT NULL`) rowny adresowi
--     zaproszenia (`lower(btrim(u.email)) = invite_email`; `invite_email`
--     jest juz w postaci kanonicznej - CHECK `event_package_seats_invite_
--     email_shape`). Ten sam dowod tozsamosci co F6 (20261013112300):
--     znajomosc tokenu dowodzi prawa do MIEJSCA, nie do tozsamosci osoby;
--     konto dowodzi tozsamosci dopiero potwierdzonym adresem;
--   * w kazdym innym przypadku osoba powstaje z `user_id = NULL` - dokladnie
--     jak przy przyjeciu anonimowym. Zgloszenie i jednorazowe klucze
--     (`qr_token`, `manage_token`) wracaja jak dotad;
--   * kolizja unikalnosci, ktora zostaje (rownolegle zalozenie osoby z tym
--     samym adresem albo kontem miedzy SELECT-em a INSERT-em), konczy sie
--     odmowa modulu `person_conflict: ... try again` zamiast 23505.
--     Ponowienie trafia juz w galaz istniejacej osoby albo w `user_id NULL`.
--
-- SCALENIE Z MAIN (20261012130001, TIX-07): ta migracja wykonuje sie PO
-- `20261012130001_event_ticket_seat_ledger_part2.sql`, ktora rownolegle
-- naprawila te sama funkcje (bramka platnosci zamowienia). Cialo nizej niesie
-- obie zmiany naraz: delegat z nieoplaconego zamowienia wchodzi jako
-- `pending` bez kodu QR (chyba ze `admit_before_payment`), zwrocone zamowienie
-- odmawia jak anulowane, wynik ma `awaiting_payment`. Roznica wobec main:
-- zuzyte zaproszenie zeruje OBA pola pary (`invite_token_hash`,
-- `invite_email` - 20261013111800, minimalizacja danych), zamiast zostawiac
-- skrot; oplacenie zamowienia odnajduje delegata po `registration_id`, nie po
-- adresie, wiec ta roznica go nie dotyka.
-- `created_by` zostaje `auth.uid()` - to slad AKTORA operacji, nie wlasnosc.
--
-- CZEGO TO NIE ZMIENIA: sygnatury, typu wyniku i ACL (CREATE OR REPLACE
-- zachowuje GRANT-y: anon, authenticated, service_role); galezi ISTNIEJACEJ
-- osoby (jak dotad nie wiaze konta i nie rusza zgod - gwarancja S1);
-- limitu prob; jednorazowosci tokenu; zerowania pary e-mail/token.
-- Danych nie przepisujemy: do 20261013111800 funkcja padala przy kazdym
-- wywolaniu, wiec blednie przypieta osoba moze powstac co najwyzej miedzy
-- wdrozeniem tamtej migracji a ta. Jej rozpoznanie wymaga decyzji czlowieka
-- (konto moglo nalezec do zaproszonego), wiec nie zgadujemy w migracji.
--
-- IDEMPOTENTNA: CREATE OR REPLACE.
-- DOWOD: scripts/events-harness/runtime_test.d/78_ops_followups.sql
-- (sekcja 4): kupujacy z potwierdzonym kontem otwiera cudze zaproszenie ->
-- osoba bez konta; konto z osoba pod innym adresem -> zgloszenie zamiast
-- 23505; zaproszony z potwierdzonym adresem -> osoba przypieta; adres
-- niepotwierdzony -> bez konta; symulowany wyscig -> `person_conflict`.
-- Klient: src/lib/events/publicRegistrationErrors.ts
-- (eventRegistration.errors.personConflict, PL/EN).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.event_package_invite_accept(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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
  v_ip_hash text := NULLIF(btrim(COALESCE(p_payload->>'ip_hash', '')), '');
  v_seat public.event_package_seats;
  v_order public.event_package_orders;
  v_package public.event_ticket_packages;
  v_person_id uuid;
  v_bind_uid uuid;
  v_group_id uuid;
  v_reg_id uuid;
  v_qr text;
  v_manage text;
  v_rate record;
  v_admit boolean;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: invitation does not exist';
  END IF;
  IF v_token = '' THEN
    RAISE EXCEPTION 'invalid_token: the invitation link is incomplete';
  END IF;
  IF v_first = '' OR v_last = '' THEN
    RAISE EXCEPTION 'invalid_name: first name and last name are required';
  END IF;
  IF NOT v_data_ok THEN
    RAISE EXCEPTION 'consent_required: consent to data processing is required';
  END IF;
  IF jsonb_typeof(v_answers) <> 'object' THEN
    RAISE EXCEPTION 'invalid_answers: answers must be a JSON object';
  END IF;

  SELECT * INTO v_rate
  FROM public.rate_limit_hit(
    'event_package_invite_accept',
    v_tenant::text || ':' || COALESCE(v_ip_hash, left(v_token, 12)),
    10,
    10
  );
  IF NOT v_rate.allowed THEN
    RAISE EXCEPTION 'rate_limited: too many attempts, try again later';
  END IF;

  SELECT * INTO v_seat
  FROM public.event_package_seats s
  WHERE s.tenant_id = v_tenant
    AND s.invite_token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
  FOR UPDATE;

  IF v_seat.id IS NULL OR v_seat.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_token: the invitation is not valid';
  END IF;
  IF v_seat.registration_id IS NOT NULL THEN
    RAISE EXCEPTION 'seat_taken: this invitation has already been used';
  END IF;
  IF v_seat.invite_expires_at IS NOT NULL AND now() > v_seat.invite_expires_at THEN
    RAISE EXCEPTION 'invitation_expired: the invitation has expired';
  END IF;

  SELECT * INTO v_order
  FROM public.event_package_orders o
  WHERE o.id = v_seat.package_order_id AND o.tenant_id = v_tenant;

  -- 20261012130001 (TIX-07): zwrocone zamowienie tez nie wpuszcza.
  IF v_order.status IN ('cancelled', 'refunded') THEN
    RAISE EXCEPTION 'order_cancelled: the order behind this seat is cancelled';
  END IF;

  SELECT * INTO v_package
  FROM public.event_ticket_packages p
  WHERE p.id = v_order.package_id AND p.tenant_id = v_tenant;

  -- 20261012130001 (TIX-07): delegat z NIEOPLACONEGO zamowienia wchodzi jako
  -- `pending` bez kodu QR, chyba ze pakiet ma jawna flage zaufania do faktury.
  -- Oplacenie zamowienia zatwierdza go w `_event_package_order_set_status_core`.
  v_admit := v_order.status = 'paid' OR COALESCE(v_package.admit_before_payment, false);

  SELECT pe.id INTO v_person_id
  FROM public.event_people pe
  WHERE pe.tenant_id = v_tenant AND pe.email_norm = v_seat.invite_email;

  IF v_person_id IS NULL THEN
    -- ZMIANA 20261013112700: konto wolajacego przypinamy do NOWEJ osoby tylko
    -- wtedy, gdy nie ma ono innej osoby w tym najemcy (regula `v_bind_uid`
    -- z `event_register`) i ma POTWIERDZONY adres rowny adresowi zaproszenia.
    -- Token dowodzi prawa do miejsca, nie tozsamosci: kupujacy, ktory otworzy
    -- link kolegi, nie zostaje wlascicielem jego kartoteki.
    v_bind_uid := CASE
      WHEN v_uid IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM public.event_people p2
        WHERE p2.tenant_id = v_tenant
          AND p2.user_id = v_uid
      ) THEN NULL
      WHEN EXISTS (
        SELECT 1 FROM auth.users u
        WHERE u.id = v_uid
          AND u.email_confirmed_at IS NOT NULL
          AND lower(btrim(u.email)) = v_seat.invite_email
      ) THEN v_uid
      ELSE NULL
    END;

    BEGIN
      INSERT INTO public.event_people (
        tenant_id, user_id, email, first_name, last_name, job_title, company_text,
        source, consent_data_processing_at, created_by
      ) VALUES (
        v_tenant, v_bind_uid, v_seat.invite_email, v_first, v_last, v_job, v_company,
        'package_invitation', now(), v_uid
      )
      RETURNING id INTO v_person_id;
    EXCEPTION WHEN unique_violation THEN
      -- Wyscig: osoba z tym adresem albo kontem powstala rownolegle miedzy
      -- SELECT-em a INSERT-em. Ponowienie trafi w galaz istniejacej osoby.
      RAISE EXCEPTION 'person_conflict: the participant record changed while accepting the invitation - try again';
    END;
  ELSE
    -- 20261013110100 (S1): bez `consent_withdrawn_at = NULL`. Przyjecie
    -- zaproszenia nie jest zgoda marketingowa ani partnerska, wiec wycofanie
    -- zgod osoby zostaje nietkniete.
    UPDATE public.event_people pe SET
      first_name = v_first,
      last_name = v_last,
      job_title = COALESCE(v_job, pe.job_title),
      company_text = COALESCE(v_company, pe.company_text),
      consent_data_processing_at = COALESCE(pe.consent_data_processing_at, now())
    WHERE pe.id = v_person_id AND pe.tenant_id = v_tenant;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant
      AND r.event_id = v_seat.event_id
      AND r.person_id = v_person_id
      AND r.status NOT IN ('cancelled', 'rejected')
  ) THEN
    RAISE EXCEPTION 'already_registered: this person already has an active registration';
  END IF;

  SELECT t.group_id INTO v_group_id
  FROM public.event_ticket_types t
  WHERE t.id = v_package.ticket_type_id AND t.tenant_id = v_tenant;

  IF v_group_id IS NULL THEN
    SELECT g.id INTO v_group_id
    FROM public.event_groups g
    WHERE g.tenant_id = v_tenant AND g.event_id = v_seat.event_id AND g.is_default;
  END IF;

  v_manage := public._event_new_qr_token();

  -- Najpierw `pending` (20261012130001): miejsce pakietu dalej trzyma pule
  -- biletu, wiec zatwierdzenie nizej nie przekracza puli.
  INSERT INTO public.event_registrations (
    tenant_id, event_id, person_id, ticket_type_id, group_id, status,
    registration_mode, answers, source, manage_token_hash, created_by
  ) VALUES (
    v_tenant, v_seat.event_id, v_person_id, v_package.ticket_type_id, v_group_id,
    'pending', 'form', v_answers, 'package_invitation',
    encode(extensions.digest(v_manage, 'sha256'), 'hex'), v_uid
  )
  RETURNING id INTO v_reg_id;

  -- 20261013111800: e-mail zaproszenia znika RAZEM z tokenem
  -- (`event_package_seats_invite_pair`). Adres zostaje na osobie, ktora
  -- miejsce zajela.
  UPDATE public.event_package_seats s SET
    registration_id = v_reg_id,
    assigned_at = now(),
    invite_token_hash = NULL,
    invite_email = NULL
  WHERE s.id = v_seat.id AND s.tenant_id = v_tenant;

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

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_reg_id::text,
    'event.registration.created.v1',
    jsonb_build_object(
      'event_id', v_seat.event_id,
      'person_id', v_person_id,
      'status', CASE WHEN v_admit THEN 'approved' ELSE 'pending' END,
      'ticket_type_id', v_package.ticket_type_id,
      'source', 'package_invitation'
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'registration_id', v_reg_id,
    'event_id', v_seat.event_id,
    'status', CASE WHEN v_admit THEN 'approved' ELSE 'pending' END,
    'awaiting_payment', NOT v_admit,
    'qr_token', v_qr,
    'manage_token', v_manage
  );
END;
$$;

COMMENT ON FUNCTION public.event_package_invite_accept(jsonb) IS
  'Przyjecie zaproszenia na miejsce z pakietu: tworzy zatwierdzone zgloszenie uczestnika (source = package_invitation) bez zgody partnerskiej i bez czyszczenia wycofania zgod osoby. Nowa osoba dostaje konto wolajacego tylko przy potwierdzonym adresie konta rownym adresowi zaproszenia i braku innej osoby tego konta w najemcy (20261013112700), inaczej user_id NULL; wyscig unikalnosci -> person_conflict. Token porownywany po skrocie, jednorazowy, z limitem prob; zuzycie zeruje token i e-mail zaproszenia naraz (event_package_seats_invite_pair) - adres zostaje na osobie.';
