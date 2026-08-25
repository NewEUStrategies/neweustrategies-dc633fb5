DROP FUNCTION IF EXISTS public.admin_event_registration_upsert(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_registration_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
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
  'Wpis organizatora: zaklada albo aktualizuje osobe w kartotece i jej zapis na wydarzenie, bez przechodzenia formularza. Sprawdza pule (miejsce jest fizyczne), nie sprawdza pol obowiazkowych.';

DROP FUNCTION IF EXISTS public.admin_event_registration_mark_notified(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_registration_mark_notified(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_ids uuid[];
  v_count integer;
BEGIN
  SELECT COALESCE(array_agg(x::uuid), ARRAY[]::uuid[]) INTO v_ids
  FROM jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(p_payload->'registration_ids') = 'array'
        THEN p_payload->'registration_ids'
      ELSE '[]'::jsonb
    END
  ) AS t(x)
  WHERE x ~ '^[0-9a-fA-F-]{36}$';

  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'invalid_request: registration_ids is required';
  END IF;

  UPDATE public.event_registrations r
  SET waitlist_notified_at = now()
  WHERE r.tenant_id = v_tenant
    AND r.id = ANY (v_ids)
    AND r.waitlist_notified_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_mark_notified(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_mark_notified(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_mark_notified(jsonb) IS
  'Stawia stempel waitlist_notified_at na wskazanych zapisach po wyslaniu wiadomosci o awansie. Zeruje licznik "awansowani, jeszcze niepowiadomieni".';

DROP FUNCTION IF EXISTS public.admin_event_waitlist_promote(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_waitlist_promote(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_reg_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_ticket_id uuid := NULLIF(p_payload->>'ticket_type_id', '')::uuid;
  v_count integer := LEAST(GREATEST(COALESCE((NULLIF(p_payload->>'count', ''))::integer, 1), 1), 500);
  v_reg public.event_registrations;
  v_seats_left integer;
  v_token text;
BEGIN
  IF v_reg_id IS NOT NULL THEN
    SELECT * INTO v_reg
    FROM public.event_registrations r
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant;

    IF v_reg.id IS NULL THEN
      RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
    END IF;
    IF v_reg.status <> 'waitlist' THEN
      RAISE EXCEPTION 'invalid_transition: % is not on the waiting list', v_reg.status;
    END IF;

    PERFORM 1 FROM public.events e
    WHERE e.id = v_reg.event_id AND e.tenant_id = v_tenant
    FOR UPDATE;

    IF v_reg.ticket_type_id IS NOT NULL THEN
      PERFORM 1 FROM public.event_ticket_types t
      WHERE t.id = v_reg.ticket_type_id AND t.tenant_id = v_tenant
      FOR UPDATE;
    END IF;

    v_seats_left := public._event_seats_left(v_tenant, v_reg.event_id, v_reg.ticket_type_id);
    IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
      RAISE EXCEPTION 'no_seats_left: no free seat for this ticket';
    END IF;

    v_token := public._event_new_qr_token();

    UPDATE public.event_registrations r
    SET status = 'approved',
        waitlist_position = NULL,
        waitlist_notified_at = NULL,
        promoted_at = now(),
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        qr_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        qr_issued_at = now()
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant AND r.status = 'waitlist';

    PERFORM public.emit_domain_event(
      v_tenant,
      'event_registration',
      v_reg_id::text,
      'event.registration.promoted.v1',
      jsonb_build_object('event_id', v_reg.event_id, 'person_id', v_reg.person_id, 'manual', true),
      v_uid
    );

    RETURN jsonb_build_object(
      'promoted', 1,
      'registrations', jsonb_build_array(jsonb_build_object(
        'registration_id', v_reg_id,
        'person_id', v_reg.person_id
      )),
      'qr_token', v_token
    );
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: event_id or registration_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  RETURN public._event_waitlist_promote(v_tenant, v_event_id, v_ticket_id, v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_waitlist_promote(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_waitlist_promote(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_waitlist_promote(jsonb) IS
  'Reczna promocja z listy rezerwowej: wskazany zapis poza kolejnoscia (ze sladem decyzji) albo N pierwszych z kolejki. Pula sprawdzana pod blokada wiersza.';