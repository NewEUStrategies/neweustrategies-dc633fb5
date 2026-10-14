-- events-harness: include
-- ============================================================================
-- ZMIANA ADRESU OSOBY PRZEZ ORGANIZATORA ODWIAZUJE KONTO, KTORE NOWEGO ADRESU
-- NIE POTWIERDZILO (PRZEGLAD R12, USTALENIE 2; REG-01, decyzje D1/D14).
--
-- DEFEKT (latest: `admin_event_registration_upsert`,
--   20260824090921:102-128; `admin_event_speaker_upsert`, 20260927000101:537-549)
--   Organizator zmienial adres osoby (przekazanie biletu koledze, poprawka
--   literowki), a `event_people.user_id` zostawal. Konto Z dowiazane do osoby
--   o adresie z@ trzymalo po zmianie na colleague@ cudza kartoteke: widzialo
--   zgloszenia, mialo panel i rezygnacje, a gdy prawdziwy wlasciciel
--   colleague@ (potwierdzone konto Y) zapisywal sie na kolejne wydarzenie,
--   jego zgloszenie trafialo na osobe Z - widoczne w „Moich zgloszeniach" Z
--   (powtorzone: review/R12-identity-consents/p2_identity.sql, czesc B).
--   Do 20261012180500 Z byl tez „wlascicielem" przy zapisie colleague@
--   (nadpisanie danych i zgody `verified_account`).
--
-- ZMIANA 20261012 (R12)
--   A. `_event_person_email_edit_unbind(najemca, osoba, adres_przed)` - po
--      zapisie: gdy adres osoby zmienil sie (po normalizacji), osoba ma konto,
--      a konto NIE ma potwierdzonego NOWEGO adresu (`_event_uid_owns_email`),
--      konto jest odwiazywane z wpisem w `event_person_account_unbinds`
--      (`reason = 'admin_unbind'`, ryzyko z `_event_person_account_risk` dla
--      nowego adresu, adres osoby i konta z chwili odwiazania, `unbound_by`
--      = organizator). Konto, ktore nowy adres potwierdzilo, zostaje -
--      dowiazanie dalej spelnia D1.
--   B. `admin_event_registration_upsert` i `admin_event_speaker_upsert`
--      (CREATE OR REPLACE na najnowszych cialach, zmiany oznaczone) - adres
--      osoby czytany pod blokada PRZED zmiana, po zmianie wolanie (A).
--      `search_path` wpisu organizatora dostaje `pg_temp` na koncu (reszta
--      bez zmian).
--
-- CZEGO TO NIE ZAMYKA: zmiana adresu KONTA (GoTrue) nie przechodzi przez
--   baze modulu - konto dowiazane do osoby o starym adresie traci
--   wlasnosc przy zapisie (20261012180500), ale dowiazanie zostaje do decyzji
--   organizatora (audyt pokazuje je jako niezweryfikowane). Organizator moze
--   przywrocic odwiazanie z dziennika (`admin_event_person_account_restore`,
--   atest na NOWY adres).
-- KOLEJNOSC WDROZENIA: dowolna wzgledem kodu (sygnatury i odpowiedzi bez
--   zmian). PRZED 20261012190000/190100 - to nowy pisarz
--   `event_people.user_id` (wylacznie zerowanie z wpisem dziennika).
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_identity_consents_r12_test.sql (zmiana adresu
--   przez organizatora: user_id NULL, wpis admin_unbind; zapis wlasciciela
--   nowego adresu nie trafia do Z; adres potwierdzony przez konto - bez
--   odwiazania; prelegent),
--   scripts/events-harness/runtime_test.d/25_account_binding_invites.sql.
-- ============================================================================

-- A) ODWIAZANIE PO ZMIANIE ADRESU PRZEZ ORGANIZATORA --------------------------------
-- Wolana PO zapisie osoby, w tej samej transakcji. Wynik: czy odwiazano.
-- Osoba czytana ponownie pod blokada - `email_norm` jest kolumna generowana,
-- wiec dopiero po zapisie ma nowa wartosc.
CREATE OR REPLACE FUNCTION public._event_person_email_edit_unbind(
  p_tenant uuid,
  p_person uuid,
  p_old_email_norm text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_person public.event_people;
  v_account_email text;
BEGIN
  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = p_tenant AND p.id = p_person
   FOR UPDATE;

  IF v_person.id IS NULL
     OR v_person.user_id IS NULL
     OR v_person.email_norm IS NOT DISTINCT FROM NULLIF(lower(btrim(COALESCE(p_old_email_norm, ''))), '')
     -- Konto potwierdzilo NOWY adres - dowiazanie dalej spelnia D1.
     OR public._event_uid_owns_email(v_person.user_id, v_person.email_norm) THEN
    RETURN false;
  END IF;

  SELECT NULLIF(lower(btrim(COALESCE(u.email, ''))), '') INTO v_account_email
    FROM auth.users u WHERE u.id = v_person.user_id;

  INSERT INTO public.event_person_account_unbinds (
    tenant_id, person_id, user_id, email_norm, account_email_norm, risk, reason,
    registrations_by_account, unbound_by
  ) VALUES (
    p_tenant, v_person.id, v_person.user_id, v_person.email_norm, v_account_email,
    public._event_person_account_risk(v_person.user_id, v_person.email_norm, v_person.created_by),
    'admin_unbind',
    (SELECT count(*)::integer FROM public.event_registrations r
      WHERE r.tenant_id = p_tenant AND r.person_id = v_person.id
        AND r.created_by = v_person.user_id),
    auth.uid()
  );

  UPDATE public.event_people p
     SET user_id = NULL
   WHERE p.tenant_id = p_tenant AND p.id = v_person.id AND p.user_id = v_person.user_id;

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public._event_person_email_edit_unbind(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_person_email_edit_unbind(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_person_email_edit_unbind(uuid, uuid, text) IS
  'R12 (REG-01, D14): po zmianie adresu osoby przez organizatora - gdy adres sie zmienil, osoba ma konto, a konto nie potwierdzilo NOWEGO adresu (_event_uid_owns_email), odwiazuje konto z wpisem admin_unbind w event_person_account_unbinds (ryzyko dla nowego adresu, unbound_by = organizator). Zwraca, czy odwiazano. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

-- B) WPIS ORGANIZATORA ---------------------------------------------------------------
-- Cialo z 20260824090921:2-214; zmiany oznaczone `ZMIANA 20261012 (R12...)`.
CREATE OR REPLACE FUNCTION public.admin_event_registration_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_reg_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_person_id uuid := NULLIF(p_payload->>'person_id', '')::uuid;
  v_ticket_id uuid := NULLIF(p_payload->>'ticket_type_id', '')::uuid;
  v_group_id uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_company_id uuid := NULLIF(p_payload->>'company_id', '')::uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'email', '')));
  v_first text := btrim(COALESCE(p_payload->>'first_name', ''));
  v_last text := btrim(COALESCE(p_payload->>'last_name', ''));
  v_status text := COALESCE(NULLIF(p_payload->>'status', ''), 'approved');
  v_source text := COALESCE(NULLIF(p_payload->>'source', ''), 'organizer');
  v_answers jsonb := COALESCE(p_payload->'answers', '{}'::jsonb);
  v_note text := NULLIF(btrim(COALESCE(p_payload->>'note', '')), '');
  v_existing public.event_registrations;
  v_seats_left integer;
  v_position integer;
  v_token text;
  v_old_email_norm text;
BEGIN
  IF v_reg_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.event_registrations r
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant;

    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
    END IF;
    v_event_id := v_existing.event_id;
    v_person_id := v_existing.person_id;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: event_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  IF jsonb_typeof(v_answers) <> 'object' THEN
    RAISE EXCEPTION 'invalid_answers: answers must be a JSON object';
  END IF;

  IF v_status NOT IN ('draft', 'pending', 'approved', 'waitlist') THEN
    RAISE EXCEPTION 'invalid_status: an organiser entry starts as draft, pending, approved or waitlist';
  END IF;

  PERFORM 1 FROM public.events e
  WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  FOR UPDATE;

  IF v_ticket_id IS NOT NULL THEN
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.id = v_ticket_id AND t.tenant_id = v_tenant AND t.event_id = v_event_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: ticket does not exist for this event';
    END IF;
  END IF;

  IF v_person_id IS NULL AND v_email <> '' THEN
    SELECT p.id INTO v_person_id
    FROM public.event_people p
    WHERE p.tenant_id = v_tenant AND p.email_norm = v_email;
  END IF;

  IF v_person_id IS NULL THEN
    IF v_first = '' OR v_last = '' THEN
      RAISE EXCEPTION 'invalid_name: first name and last name are required';
    END IF;
    INSERT INTO public.event_people (
      tenant_id, email, first_name, last_name, phone, job_title,
      company_text, company_id, social_profile_url, source, notes, created_by
    ) VALUES (
      v_tenant,
      NULLIF(v_email, ''),
      v_first,
      v_last,
      NULLIF(btrim(COALESCE(p_payload->>'phone', '')), ''),
      NULLIF(btrim(COALESCE(p_payload->>'job_title', '')), ''),
      NULLIF(btrim(COALESCE(p_payload->>'company_text', '')), ''),
      v_company_id,
      NULLIF(btrim(COALESCE(p_payload->>'social_profile_url', '')), ''),
      v_source,
      NULLIF(btrim(COALESCE(p_payload->>'notes', '')), ''),
      v_uid
    )
    RETURNING id INTO v_person_id;
  ELSE
    -- ZMIANA 20261012 (R12, REG-01): adres osoby PRZED zmiana, pod blokada -
    -- nizej porownujemy go z adresem po zapisie.
    SELECT p.email_norm INTO v_old_email_norm
      FROM public.event_people p
     WHERE p.id = v_person_id AND p.tenant_id = v_tenant
     FOR UPDATE;

    UPDATE public.event_people p SET
      first_name = COALESCE(NULLIF(v_first, ''), p.first_name),
      last_name = COALESCE(NULLIF(v_last, ''), p.last_name),
      email = CASE WHEN p_payload ? 'email' THEN NULLIF(v_email, '') ELSE p.email END,
      phone = CASE
        WHEN p_payload ? 'phone' THEN NULLIF(btrim(COALESCE(p_payload->>'phone', '')), '')
        ELSE p.phone
      END,
      job_title = CASE
        WHEN p_payload ? 'job_title' THEN NULLIF(btrim(COALESCE(p_payload->>'job_title', '')), '')
        ELSE p.job_title
      END,
      company_text = CASE
        WHEN p_payload ? 'company_text' THEN NULLIF(btrim(COALESCE(p_payload->>'company_text', '')), '')
        ELSE p.company_text
      END,
      company_id = CASE WHEN p_payload ? 'company_id' THEN v_company_id ELSE p.company_id END,
      social_profile_url = CASE
        WHEN p_payload ? 'social_profile_url'
          THEN NULLIF(btrim(COALESCE(p_payload->>'social_profile_url', '')), '')
        ELSE p.social_profile_url
      END,
      notes = CASE
        WHEN p_payload ? 'notes' THEN NULLIF(btrim(COALESCE(p_payload->>'notes', '')), '')
        ELSE p.notes
      END
    WHERE p.id = v_person_id AND p.tenant_id = v_tenant;

    -- ZMIANA 20261012 (R12, REG-01): organizator zmienil adres osoby
    -- dowiazanej do konta, ktore NOWEGO adresu nie potwierdzilo - konto
    -- traci kartoteke (wpis `admin_unbind` w dzienniku odwiazan). Inaczej
    -- konto dawnego adresu zachowywalo zgloszenia, panel i rezygnacje osoby
    -- pod cudzym adresem, a zapis wlasciciela nowego adresu trafial na
    -- kartoteke tego konta.
    PERFORM public._event_person_email_edit_unbind(v_tenant, v_person_id, v_old_email_norm);
  END IF;

  IF v_group_id IS NULL THEN
    SELECT t.group_id INTO v_group_id
    FROM public.event_ticket_types t
    WHERE t.id = v_ticket_id AND t.tenant_id = v_tenant;
  END IF;
  IF v_group_id IS NULL THEN
    SELECT g.id INTO v_group_id
    FROM public.event_groups g
    WHERE g.tenant_id = v_tenant AND g.event_id = v_event_id AND g.is_default;
  END IF;

  IF v_existing.id IS NULL THEN
    IF v_status = 'approved' THEN
      v_seats_left := public._event_seats_left(v_tenant, v_event_id, v_ticket_id);
      IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
        RAISE EXCEPTION 'no_seats_left: no free seat for this ticket - use the waiting list';
      END IF;
      v_token := public._event_new_qr_token();
    ELSIF v_status = 'waitlist' THEN
      v_position := public._event_next_waitlist_position(v_tenant, v_event_id);
    END IF;
  END IF;

  IF v_existing.id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.event_registrations r
      WHERE r.tenant_id = v_tenant
        AND r.event_id = v_event_id
        AND r.person_id = v_person_id
        AND r.status NOT IN ('cancelled', 'rejected')
    ) THEN
      RAISE EXCEPTION 'already_registered: this person already has an active registration';
    END IF;

    INSERT INTO public.event_registrations (
      tenant_id, event_id, person_id, ticket_type_id, group_id, status,
      registration_mode, answers, source,
      decided_by, decided_at, decision_source, decision_note,
      qr_token_hash, qr_issued_at, manage_token_hash, waitlist_position, created_by
    ) VALUES (
      v_tenant, v_event_id, v_person_id, v_ticket_id, v_group_id, v_status,
      'rsvp',
      v_answers, v_source,
      CASE WHEN v_status IN ('approved', 'waitlist') THEN v_uid END,
      CASE WHEN v_status IN ('approved', 'waitlist') THEN now() END,
      CASE WHEN v_status IN ('approved', 'waitlist') THEN 'organizer' END,
      v_note,
      CASE WHEN v_token IS NOT NULL THEN encode(digest(v_token, 'sha256'), 'hex') END,
      CASE WHEN v_token IS NOT NULL THEN now() END,
      encode(digest(public._event_new_qr_token(), 'sha256'), 'hex'),
      v_position,
      v_uid
    )
    RETURNING id INTO v_reg_id;
  ELSE
    UPDATE public.event_registrations r SET
      ticket_type_id = CASE WHEN p_payload ? 'ticket_type_id' THEN v_ticket_id ELSE r.ticket_type_id END,
      group_id = COALESCE(v_group_id, r.group_id),
      answers = CASE WHEN p_payload ? 'answers' THEN v_answers ELSE r.answers END,
      source = v_source,
      decision_note = COALESCE(v_note, r.decision_note)
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_reg_id::text,
    CASE WHEN v_existing.id IS NULL
      THEN 'event.registration.created.v1'
      ELSE 'event.registration.updated.v1'
    END,
    jsonb_build_object(
      'event_id', v_event_id,
      'person_id', v_person_id,
      'status', COALESCE(v_existing.status, v_status),
      'source', v_source
    ),
    v_uid
  );

  RETURN v_reg_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_upsert(jsonb) IS
  'Wpis organizatora: zaklada albo aktualizuje osobe w kartotece i jej zapis na wydarzenie, bez przechodzenia formularza. Sprawdza pule (miejsce jest fizyczne), nie sprawdza pol obowiazkowych. Zmiana adresu osoby dowiazanej do konta, ktore nowego adresu nie potwierdzilo, odwiazuje konto (R12, _event_person_email_edit_unbind, wpis admin_unbind).';

-- C) PRELEGENT ORGANIZATORA --------------------------------------------------------
-- Cialo z 20260927000101:456-610; zmiany oznaczone `ZMIANA 20261012 (R12...)`.
CREATE OR REPLACE FUNCTION public.admin_event_speaker_upsert(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant     uuid := public.assert_event_admin_tenant();
  v_uid        uuid := auth.uid();
  v_event_id   uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_user_id    uuid := NULLIF(p_payload->>'user_id', '')::uuid;
  v_person_id  uuid := NULLIF(p_payload->>'person_id', '')::uuid;
  v_group_id   uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_email      text := NULLIF(btrim(p_payload->>'email'), '');
  v_first      text := NULLIF(btrim(p_payload->>'first_name'), '');
  v_last       text := NULLIF(btrim(p_payload->>'last_name'), '');
  v_profile_id uuid;
  v_entry_id   uuid;
  v_old_email_norm text;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'event_speakers: event_id is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'event_speakers: event not found in tenant' USING ERRCODE = '42501';
  END IF;

  IF v_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles pr
       WHERE pr.id = v_user_id AND pr.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'event_speakers: profile not found in tenant' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.speaker_profiles AS sp (tenant_id, user_id)
    VALUES (v_tenant, v_user_id)
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET updated_at = now()
    RETURNING sp.id INTO v_profile_id;
  ELSE
    IF v_person_id IS NULL THEN
      IF v_first IS NULL OR v_last IS NULL THEN
        RAISE EXCEPTION 'event_speakers: first_name and last_name are required'
          USING ERRCODE = '22023';
      END IF;

      IF v_email IS NOT NULL THEN
        SELECT pe.id INTO v_person_id
          FROM public.event_people pe
         WHERE pe.tenant_id = v_tenant
           AND pe.email_norm = lower(btrim(v_email));
      END IF;
    END IF;

    IF v_person_id IS NULL THEN
      INSERT INTO public.event_people (
        tenant_id, email, first_name, last_name, phone, job_title,
        company_text, social_profile_url, photo_url, bio_pl, bio_en,
        source, consent_data_processing_at, created_by
      ) VALUES (
        v_tenant, v_email, v_first, v_last,
        NULLIF(btrim(p_payload->>'phone'), ''),
        NULLIF(btrim(p_payload->>'job_title'), ''),
        NULLIF(btrim(p_payload->>'company_text'), ''),
        NULLIF(btrim(p_payload->>'social_profile_url'), ''),
        NULLIF(btrim(p_payload->>'photo_url'), ''),
        NULLIF(btrim(p_payload->>'bio_pl'), ''),
        NULLIF(btrim(p_payload->>'bio_en'), ''),
        'organizer', now(), v_uid
      )
      RETURNING id INTO v_person_id;
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM public.event_people pe
         WHERE pe.id = v_person_id AND pe.tenant_id = v_tenant
      ) THEN
        RAISE EXCEPTION 'event_speakers: person not found in tenant' USING ERRCODE = '42501';
      END IF;

      -- ZMIANA 20261012 (R12, REG-01): adres osoby PRZED zmiana, pod blokada.
      SELECT pe.email_norm INTO v_old_email_norm
        FROM public.event_people pe
       WHERE pe.id = v_person_id AND pe.tenant_id = v_tenant
       FOR UPDATE;

      UPDATE public.event_people pe SET
        first_name         = COALESCE(v_first, pe.first_name),
        last_name          = COALESCE(v_last, pe.last_name),
        email              = COALESCE(v_email, pe.email),
        phone              = COALESCE(NULLIF(btrim(p_payload->>'phone'), ''), pe.phone),
        job_title          = COALESCE(NULLIF(btrim(p_payload->>'job_title'), ''), pe.job_title),
        company_text       = COALESCE(NULLIF(btrim(p_payload->>'company_text'), ''), pe.company_text),
        social_profile_url = COALESCE(NULLIF(btrim(p_payload->>'social_profile_url'), ''), pe.social_profile_url),
        photo_url          = COALESCE(NULLIF(btrim(p_payload->>'photo_url'), ''), pe.photo_url),
        bio_pl             = COALESCE(NULLIF(btrim(p_payload->>'bio_pl'), ''), pe.bio_pl),
        bio_en             = COALESCE(NULLIF(btrim(p_payload->>'bio_en'), ''), pe.bio_en),
        consent_data_processing_at = COALESCE(pe.consent_data_processing_at, now())
      WHERE pe.id = v_person_id AND pe.tenant_id = v_tenant;

      -- ZMIANA 20261012 (R12, REG-01): nowy adres prelegenta, ktorego konto
      -- nie potwierdzilo - konto traci kartoteke (jak wpis organizatora
      -- w `admin_event_registration_upsert`).
      PERFORM public._event_person_email_edit_unbind(v_tenant, v_person_id, v_old_email_norm);
    END IF;

    INSERT INTO public.speaker_profiles AS sp (tenant_id, person_id)
    VALUES (v_tenant, v_person_id)
    ON CONFLICT (tenant_id, person_id) WHERE person_id IS NOT NULL DO UPDATE
      SET updated_at = now()
    RETURNING sp.id INTO v_profile_id;

    IF v_group_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.event_groups g
         WHERE g.id = v_group_id AND g.tenant_id = v_tenant AND g.event_id = v_event_id
      ) THEN
        RAISE EXCEPTION 'event_speakers: group not found in event' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.event_group_members (tenant_id, event_id, group_id, person_id, added_by)
      VALUES (v_tenant, v_event_id, v_group_id, v_person_id, v_uid)
      ON CONFLICT (tenant_id, group_id, person_id) DO NOTHING;
    END IF;
  END IF;

  UPDATE public.speaker_profiles sp SET
    headline_pl = COALESCE(NULLIF(btrim(p_payload->>'headline_pl'), ''), sp.headline_pl),
    headline_en = COALESCE(NULLIF(btrim(p_payload->>'headline_en'), ''), sp.headline_en),
    topics_pl   = CASE WHEN p_payload ? 'topics_pl'
                       THEN public._event_speaker_text_array(p_payload->'topics_pl')
                       ELSE sp.topics_pl END,
    topics_en   = CASE WHEN p_payload ? 'topics_en'
                       THEN public._event_speaker_text_array(p_payload->'topics_en')
                       ELSE sp.topics_en END,
    languages   = CASE WHEN p_payload ? 'languages'
                       THEN public._event_speaker_text_array(p_payload->'languages')
                       ELSE sp.languages END,
    is_public   = COALESCE((p_payload->>'is_public')::boolean, sp.is_public),
    card_photo_url    = CASE WHEN p_payload ? 'card_photo_url'
                             THEN NULLIF(btrim(p_payload->>'card_photo_url'), '')
                             ELSE sp.card_photo_url END,
    card_cta_label_pl = CASE WHEN p_payload ? 'card_cta_label_pl'
                             THEN NULLIF(btrim(p_payload->>'card_cta_label_pl'), '')
                             ELSE sp.card_cta_label_pl END,
    card_cta_label_en = CASE WHEN p_payload ? 'card_cta_label_en'
                             THEN NULLIF(btrim(p_payload->>'card_cta_label_en'), '')
                             ELSE sp.card_cta_label_en END,
    card_cta_url      = CASE WHEN p_payload ? 'card_cta_url'
                             THEN NULLIF(btrim(p_payload->>'card_cta_url'), '')
                             ELSE sp.card_cta_url END,
    card_cta_color    = CASE WHEN p_payload ? 'card_cta_color'
                             THEN lower(NULLIF(btrim(p_payload->>'card_cta_color'), ''))
                             ELSE sp.card_cta_color END
  WHERE sp.id = v_profile_id AND sp.tenant_id = v_tenant;

  v_entry_id := public._event_speaker_roster_add(v_tenant, v_event_id, v_profile_id);

  RETURN jsonb_build_object(
    'entry_id', v_entry_id,
    'speaker_profile_id', v_profile_id,
    'person_id', v_person_id,
    'user_id', v_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_speaker_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_speaker_upsert(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_speaker_upsert(jsonb) IS
  'Zaklada prelegenta i podpina go do wydarzenia w JEDNYM zapisie. Tryb osoby (bez user_id): dopasowanie/zalozenie event_people po email_norm + nakladka speaker_profiles(person_id) + wpis event_speaker_entries (_event_speaker_roster_add). Tryb konta (user_id): nakladka speaker_profiles(user_id) + wpis. Pola karty (card_*) po obecnosci klucza. Zgody: wylacznie consent_data_processing_at, source=organizer. Bramka: assert_event_admin_tenant(). Zmiana adresu osoby dowiazanej do konta, ktore nowego adresu nie potwierdzilo, odwiazuje konto (R12, _event_person_email_edit_unbind, wpis admin_unbind).';
