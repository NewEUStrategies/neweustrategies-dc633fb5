-- events-harness: include
-- ============================================================================
-- WYDARZENIA: PRZYJECIE ZAPROSZENIA Z PAKIETU ZNOWU DZIALA (przekazanie
-- miedzy strumieniami, wykryte przez S1 przy OPS-01).
--
-- PROBLEM. `event_package_invite_accept(jsonb)` od 20260827221214 pada przy
-- KAZDYM wywolaniu (23514) - zaden uczestnik nie przyjal jeszcze zaproszenia
-- na miejsce z pakietu, wiec w bazie nie ma ani jednego wiersza, ktory by
-- powstal ta droga. Dwa ograniczenia naraz:
--   1. funkcja zapisuje `source = 'package_invitation'` w `event_people`
--      i `event_registrations`, a `event_people_source_values`
--      i `event_registrations_source_values` (20260824085456) znaja tylko
--      siedem wartosci bez tej jednej;
--   2. zuzywajac zaproszenie zeruje `invite_token_hash`, a zostawia
--      `invite_email` - `event_package_seats_invite_pair` wymaga, zeby obie
--      kolumny byly puste albo obie wypelnione.
--
-- ZMIANA:
--   A. Obie listy `source` dostaja `package_invitation` (osma wartosc).
--      Zrodla NIE zmieniamy na `invitation`: lejek reklamowy
--      (`admin_event_ads_funnel`, 20260927001100) odsiewa zgloszenia
--      z miejsc pakietu wlasnie po `r.source IS DISTINCT FROM
--      'package_invitation'` - pakiet jest tam JUZ konwersja, a zgloszenie
--      z jego miejsca liczone drugi raz zawyzaloby wynik kampanii. Zapis
--      `invitation` zrownalby tez gosci z pakietu z zaproszeniami organizatora
--      w kartotece, choc to dwie rozne drogi wejscia.
--   B. `event_package_invite_accept(jsonb)` - cialo z 20261013110100 (S1:
--      bez czyszczenia `consent_withdrawn_at`) z JEDNA zmiana merytoryczna:
--      zuzycie zaproszenia zeruje `invite_email` RAZEM z `invite_token_hash`.
--      Ograniczenie pary zostaje scisle: "e-mail i token" znaczy "zaproszenie
--      czeka na przyjecie" i nic wiecej.
--      Przy okazji `search_path` przechodzi na regule modulu ('public',
--      'pg_temp'), a `digest` jest kwalifikowany schematem `extensions`.
--
-- DLACZEGO E-MAIL ZAPROSZENIA ZNIKA, A NIE ZOSTAJE JAKO DOWOD:
--   * dowod juz jest: osoba jest wyszukiwana (albo zakladana) po
--     `email_norm = invite_email`, a miejsce wskazuje zgloszenie tej osoby
--     (`registration_id`) ze zrodlem `package_invitation`. Druga kopia adresu
--     na miejscu niczego nie dowodzi, a jest kopia danych osobowych, ktorej
--     nie czysci ani wymazanie osoby, ani anonimizacja (minimalizacja danych,
--     art. 5 ust. 1 lit. c RODO);
--   * scisla para nie koliduje z S2 (20261013110500): usuniecie zgloszenia
--     zeruje `registration_id` (ON DELETE SET NULL (registration_id)), a
--     wyzwalacz `event_package_seats_unlinked` stempel przypisania. Miejsce z
--     zachowanym e-mailem i bez tokenu staloby sie wtedy zaproszeniem, ktorego
--     nie da sie przyjac, a poluzowany CHECK ("e-mail bez tokenu tylko przy
--     przypisanym miejscu") odbijalby samo usuniecie;
--   * czytelnicy nie potrzebuja adresu przypisanego miejsca: stan
--     (`admin_event_package_seats_list`, `event_my_package_seats`) sprawdza
--     `registration_id` PRZED `invite_email`, liczniki (`admin_event_package_
--     orders_list`, `event_my_package_orders`) licza zaproszenia tylko przy
--     `registration_id IS NULL`, a oba ekrany pokazuja najpierw imie
--     i nazwisko uczestnika. Przypisanie reczne do istniejacego zgloszenia
--     (`admin_event_package_seat_assign`) tez nie dopisuje adresu - przypisane
--     miejsce bez e-maila jest wiec stanem, ktory czytelnicy juz znaja;
--   * tak samo postepuja juz pozostale drogi: wycofanie zaproszenia
--     (`admin_event_package_seat_revoke`) i anulowanie zamowienia
--     (`admin_event_package_order_set_status`) zeruja obie kolumny naraz.
--   `invite_sent_at`, `invite_expires_at` i `invite_name` zostaja - os czasu
--   zaproszenia nie jest adresem i nie lamie zadnego ograniczenia.
--
-- CZEGO TO NIE ZMIENIA: sygnatury, typu wyniku i ACL funkcji (CREATE OR
-- REPLACE zachowuje GRANT-y: anon, authenticated, service_role); gwarancji S1
-- (przyjecie nie czysci `consent_withdrawn_at` i nie nadaje zgody
-- partnerskiej); limitu prob; jednorazowosci tokenu.
--
-- IDEMPOTENTNA: DROP CONSTRAINT IF EXISTS + ADD (nowa lista jest nadzbiorem
-- starej, wiec istniejace wiersze przechodza walidacje), CREATE OR REPLACE.
-- Danych nie przepisujemy - nie ma wiersza powstalego z przyjecia zaproszenia.
-- DOWOD: scripts/events-harness/runtime_test.d/78_ops_followups.sql
-- (sekcja 1); wpisy `assert_known_defect` w 33_partner_consent_per_
-- registration.sql zdjete, bo defekt jest naprawiony.
-- ============================================================================

-- A) ZRODLO `package_invitation` -------------------------------------------
ALTER TABLE public.event_people DROP CONSTRAINT IF EXISTS event_people_source_values;
ALTER TABLE public.event_people ADD CONSTRAINT event_people_source_values CHECK (source IN (
    'self_registration', 'invitation', 'organizer', 'import', 'crm', 'partner', 'scan',
    'package_invitation'
  ));

ALTER TABLE public.event_registrations DROP CONSTRAINT IF EXISTS event_registrations_source_values;
ALTER TABLE public.event_registrations ADD CONSTRAINT event_registrations_source_values CHECK (source IN (
    'self_registration', 'invitation', 'organizer', 'import', 'crm', 'partner', 'scan',
    'package_invitation'
  ));

COMMENT ON CONSTRAINT event_registrations_source_values ON public.event_registrations IS
  'Droga wejscia zgloszenia. package_invitation = przyjete zaproszenie na miejsce z pakietu (event_package_invite_accept); lejek reklamowy odsiewa je, bo konwersja jest samo zamowienie pakietu.';

-- B) PRZYJECIE ZAPROSZENIA --------------------------------------------------
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
  v_group_id uuid;
  v_reg_id uuid;
  v_qr text;
  v_manage text;
  v_rate record;
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

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'order_cancelled: the order behind this seat is cancelled';
  END IF;

  SELECT * INTO v_package
  FROM public.event_ticket_packages p
  WHERE p.id = v_order.package_id AND p.tenant_id = v_tenant;

  SELECT pe.id INTO v_person_id
  FROM public.event_people pe
  WHERE pe.tenant_id = v_tenant AND pe.email_norm = v_seat.invite_email;

  IF v_person_id IS NULL THEN
    INSERT INTO public.event_people (
      tenant_id, user_id, email, first_name, last_name, job_title, company_text,
      source, consent_data_processing_at, created_by
    ) VALUES (
      v_tenant, v_uid, v_seat.invite_email, v_first, v_last, v_job, v_company,
      'package_invitation', now(), v_uid
    )
    RETURNING id INTO v_person_id;
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

  v_qr := public._event_new_qr_token();
  v_manage := public._event_new_qr_token();

  -- Miejsce jest juz oplacone przez firme, wiec zgloszenie wchodzi zatwierdzone;
  -- pula biletu nie jest tu dotykana, bo zajely ja miejsca pakietu.
  INSERT INTO public.event_registrations (
    tenant_id, event_id, person_id, ticket_type_id, group_id, status,
    registration_mode, answers, source, decided_at, decision_source,
    qr_token_hash, qr_issued_at, manage_token_hash, created_by
  ) VALUES (
    v_tenant, v_seat.event_id, v_person_id, v_package.ticket_type_id, v_group_id,
    'approved', 'form', v_answers, 'package_invitation', now(), 'system',
    encode(extensions.digest(v_qr, 'sha256'), 'hex'), now(),
    encode(extensions.digest(v_manage, 'sha256'), 'hex'), v_uid
  )
  RETURNING id INTO v_reg_id;

  -- ZMIANA 20261013111800: e-mail zaproszenia znika RAZEM z tokenem
  -- (`event_package_seats_invite_pair`). Adres zostaje na osobie, ktora
  -- miejsce zajela - patrz naglowek migracji.
  UPDATE public.event_package_seats s SET
    registration_id = v_reg_id,
    assigned_at = now(),
    invite_token_hash = NULL,
    invite_email = NULL
  WHERE s.id = v_seat.id AND s.tenant_id = v_tenant;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_reg_id::text,
    'event.registration.created.v1',
    jsonb_build_object(
      'event_id', v_seat.event_id,
      'person_id', v_person_id,
      'status', 'approved',
      'ticket_type_id', v_package.ticket_type_id,
      'source', 'package_invitation'
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'registration_id', v_reg_id,
    'event_id', v_seat.event_id,
    'status', 'approved',
    'qr_token', v_qr,
    'manage_token', v_manage
  );
END;
$$;

COMMENT ON FUNCTION public.event_package_invite_accept(jsonb) IS
  'Przyjecie zaproszenia na miejsce z pakietu: tworzy zatwierdzone zgloszenie uczestnika (source = package_invitation) bez zgody partnerskiej i bez czyszczenia wycofania zgod osoby. Token porownywany po skrocie, jednorazowy, z limitem prob; zuzycie zeruje token i e-mail zaproszenia naraz (event_package_seats_invite_pair) - adres zostaje na osobie.';
