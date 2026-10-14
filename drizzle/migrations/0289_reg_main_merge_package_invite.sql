CREATE OR REPLACE FUNCTION public.event_package_invite_accept(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
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

  IF v_token !~ '^[A-Za-z0-9_-]{32,128}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

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

  PERFORM public._event_invite_probe_guard(v_tenant, v_uid);

  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  SELECT s.id, s.package_order_id, s.event_id INTO v_seat_id, v_order_id, v_event_id
    FROM public.event_package_seats s
   WHERE s.tenant_id = v_tenant
     AND s.invite_token_hash = v_hash
     AND s.revoked_at IS NULL;
  IF v_seat_id IS NULL THEN
    PERFORM public._event_invite_probe_miss(v_tenant, v_uid);
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

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
  IF v_order.status = 'refunded' THEN
    RAISE EXCEPTION 'order_refunded: the order behind this seat was refunded';
  END IF;

  IF v_event.id IS NULL OR v_event.status <> 'published' THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;
  IF v_event.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_cancelled: the event has been cancelled';
  END IF;
  IF COALESCE(v_event.ends_at, v_event.starts_at) < now() THEN
    RAISE EXCEPTION 'event_ended: the event is over';
  END IF;

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

  v_admit := v_order.status = 'paid' OR COALESCE(v_package.admit_before_payment, false);

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

  v_verified := public._event_uid_owns_email(v_uid, v_seat.invite_email);
  v_owner := COALESCE(
    v_uid IS NOT NULL
    AND v_verified
    AND (v_person.user_id IS NULL OR v_person.user_id = v_uid),
    false);
  v_bind_uid := public._event_bind_uid_for_email(v_tenant, v_uid, v_seat.invite_email);

  IF v_new_person THEN
    BEGIN
      INSERT INTO public.event_people (
        tenant_id, user_id, email, first_name, last_name, job_title, company_text,
        source, created_by
      ) VALUES (
        v_tenant, v_bind_uid, v_seat.invite_email, v_first, v_last, v_job, v_company,
        'package_invitation', v_uid
      )
      RETURNING * INTO v_person;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'person_conflict: the participant record changed while accepting the invitation - try again';
    END;
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

  UPDATE public.event_package_seats s SET
    registration_id = v_reg_id,
    assigned_at = now(),
    invite_token_hash = NULL,
    invite_email = NULL
  WHERE s.tenant_id = v_tenant AND s.id = v_seat.id;

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

  PERFORM public._event_person_consents_confirm(
    v_tenant, v_person.id, ARRAY['data_processing']::text[], 'registration_form',
    v_event.id, v_reg_id, NULL, v_text_version, v_lang, NULL, NULL,
    v_uid, 'event_package_invite_accept', v_new_person OR v_owner);
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
  'REG-15: przyjecie zaproszenia na miejsce z pakietu (token po sha256, najemca z hosta). Pudlo tokenu jako wartosc {ok:false,error:invalid_token} liczone w _event_invite_probe_* (najemca + konto). Pola z sufitami i bez znakow sterujacych (_event_text_has_control, R38) przed tokenem. Wydarzenie opublikowane/nieodwolane/niezakonczone, zamowienie nie cancelled/refunded, pola, zgody formularza i regulaminy obowiazkowe. Konto wiaze sie tylko przez _event_bind_uid_for_email z adresem zaproszenia; kartoteke zmienia tylko wlasciciel (R12: potwierdzony adres zaproszenia ORAZ osoba bez konta albo z kontem wolajacego), cudza kartoteka nietknieta (submitted_profile); zgody przez rejestr A2 (marketing tylko zweryfikowany wlasciciel). Zrodlo package_invitation; zgloszenie wstawiane jako pending, przyjete z kodem QR po przypisaniu miejsca tylko przy zamowieniu oplaconym albo admit_before_payment (TIX-07/TIX-04, awaiting_payment w odpowiedzi); zuzycie zeruje adres i skrot tokenu miejsca (main 20261013111800); wyscig przy zakladaniu osoby -> person_conflict (main F14). Przyjecie nie czysci consent_withdrawn_at i nie nadaje zgody partnerskiej (main OPS-01 S1).';