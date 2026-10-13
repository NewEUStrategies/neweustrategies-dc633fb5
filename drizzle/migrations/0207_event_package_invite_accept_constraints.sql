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