-- 20260828206000_event_register_paid_ticket_gate.sql
-- events-harness: include
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'not_required';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_registrations'::regclass
      AND conname = 'event_registrations_payment_status_values'
  ) THEN
    ALTER TABLE public.event_registrations
      ADD CONSTRAINT event_registrations_payment_status_values
      CHECK (payment_status IN ('not_required', 'unpaid', 'paid', 'refunded'));
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.event_register(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_event public.events;
  v_ticket public.event_ticket_types;
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug', '')), '');
  v_event_id uuid;
  v_ticket_id uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'email', '')));
  v_first text := btrim(COALESCE(p_payload->>'first_name', ''));
  v_last text := btrim(COALESCE(p_payload->>'last_name', ''));
  v_phone text := NULLIF(btrim(COALESCE(p_payload->>'phone', '')), '');
  v_job text := NULLIF(btrim(COALESCE(p_payload->>'job_title', '')), '');
  v_company text := NULLIF(btrim(COALESCE(p_payload->>'company_text', '')), '');
  v_social text := NULLIF(btrim(COALESCE(p_payload->>'social_profile_url', '')), '');
  v_answers jsonb := COALESCE(p_payload->'answers', '{}'::jsonb);
  v_ip_hash text := NULLIF(btrim(COALESCE(p_payload->>'ip_hash', '')), '');
  v_user_agent text := left(NULLIF(btrim(COALESCE(p_payload->>'user_agent', '')), ''), 400);
  v_marketing boolean := lower(COALESCE(p_payload->>'consent_marketing', '')) IN ('true', 't', '1');
  v_partner boolean := lower(COALESCE(p_payload->>'consent_partner_sharing', '')) IN ('true', 't', '1');
  v_data_ok boolean := lower(COALESCE(p_payload->>'consent_data_processing', '')) IN ('true', 't', '1');
  v_access_code text := upper(btrim(COALESCE(p_payload->>'access_code', '')));
  v_accepted uuid[];
  v_active_tickets integer;
  v_person_id uuid;
  v_bind_uid uuid;
  v_missing text[];
  v_verdict text;
  v_status text;
  v_decision_source text;
  v_group_id uuid;
  v_seats_left integer;
  v_position integer;
  v_token text;
  v_manage text;
  v_reg_id uuid;
  v_rate record;
  v_price integer := 0;
  v_payment text := 'not_required';
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  IF length(p_payload::text) > 65536 THEN
    RAISE EXCEPTION 'payload_too_large: registration payload exceeds 64 kB';
  END IF;

  IF jsonb_typeof(v_answers) <> 'object' THEN
    RAISE EXCEPTION 'invalid_answers: answers must be a JSON object';
  END IF;

  IF v_first = '' OR v_last = '' THEN
    RAISE EXCEPTION 'invalid_name: first name and last name are required';
  END IF;

  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email: a valid e-mail address is required';
  END IF;

  IF NOT v_data_ok THEN
    RAISE EXCEPTION 'consent_required: consent to data processing is required';
  END IF;

  IF v_social IS NOT NULL AND v_social !~ '^https://' THEN
    RAISE EXCEPTION 'invalid_social_url: the profile address must start with https://';
  END IF;

  SELECT * INTO v_rate
  FROM public.rate_limit_hit(
    'event_register',
    v_tenant::text || ':' || COALESCE(v_ip_hash, v_email),
    12,
    10
  );
  IF NOT v_rate.allowed THEN
    RAISE EXCEPTION 'rate_limited: too many registration attempts, try again later';
  END IF;

  v_event_id := CASE
    WHEN COALESCE(p_payload->>'event_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (p_payload->>'event_id')::uuid
    ELSE NULL
  END;
  v_ticket_id := CASE
    WHEN COALESCE(p_payload->>'ticket_type_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (p_payload->>'ticket_type_id')::uuid
    ELSE NULL
  END;

  IF v_event_id IS NULL AND v_slug IS NULL THEN
    RAISE EXCEPTION 'invalid_event: event_id or event_slug is required';
  END IF;

  SELECT COALESCE(array_agg(x::uuid), ARRAY[]::uuid[]) INTO v_accepted
  FROM jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(p_payload->'accepted_term_ids') = 'array'
        THEN p_payload->'accepted_term_ids'
      ELSE '[]'::jsonb
    END
  ) AS t(x)
  WHERE x ~ '^[0-9a-fA-F-]{36}$';

  SELECT * INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND (
      (v_event_id IS NOT NULL AND e.id = v_event_id)
      OR (v_event_id IS NULL AND e.slug = v_slug)
    )
  FOR UPDATE;

  IF v_event.id IS NULL OR v_event.status <> 'published' THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  IF v_event.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_cancelled: the event has been cancelled';
  END IF;

  IF v_event.registration_mode = 'none' THEN
    RAISE EXCEPTION 'registration_disabled: this event does not take registrations';
  END IF;

  IF v_event.registration_mode = 'external' THEN
    RAISE EXCEPTION 'registration_external: registration runs in an external tool';
  END IF;

  IF v_event.rsvp_opens_at IS NOT NULL
     AND v_event.rsvp_opens_at > now()
     AND NOT (
       v_event.early_rsvp_rank IS NOT NULL
       AND public.has_tier_rank(v_event.early_rsvp_rank)
     ) THEN
    RAISE EXCEPTION 'registration_not_open: registration has not opened yet';
  END IF;

  IF v_event.visibility = 'members'
     AND NOT public.has_tier_rank(GREATEST(v_event.min_tier_rank, 1)) THEN
    RAISE EXCEPTION 'membership_required: this event is open to members only';
  END IF;

  SELECT count(*)::integer INTO v_active_tickets
  FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;

  IF v_ticket_id IS NOT NULL THEN
    SELECT * INTO v_ticket
    FROM public.event_ticket_types t
    WHERE t.id = v_ticket_id AND t.tenant_id = v_tenant AND t.event_id = v_event.id
    FOR UPDATE;

    IF v_ticket.id IS NULL OR NOT v_ticket.is_active THEN
      RAISE EXCEPTION 'not_found: ticket does not exist for this event';
    END IF;
    IF v_ticket.sales_from IS NOT NULL AND now() < v_ticket.sales_from THEN
      RAISE EXCEPTION 'ticket_not_on_sale: sales for this ticket have not started';
    END IF;
    IF v_ticket.sales_to IS NOT NULL AND now() > v_ticket.sales_to THEN
      RAISE EXCEPTION 'ticket_sales_ended: sales for this ticket are closed';
    END IF;
    IF v_ticket.min_tier_rank > 0 AND NOT public.has_tier_rank(v_ticket.min_tier_rank) THEN
      RAISE EXCEPTION 'ticket_tier_required: this ticket requires a higher membership tier';
    END IF;
    IF v_ticket.access_code_hash IS NOT NULL THEN
      IF v_access_code = ''
         OR encode(digest(v_access_code, 'sha256'), 'hex') <> v_ticket.access_code_hash THEN
        RAISE EXCEPTION 'invalid_access_code: this ticket requires a valid access code';
      END IF;
    END IF;
    -- CENA WEJSCIOWKI: platny bilet nie moze wyjsc za darmo.
    v_price := COALESCE(public._event_ticket_price_now(
      v_ticket.price_cents, v_ticket.early_bird_price_cents,
      v_ticket.early_bird_until, v_ticket.price_schedule), 0);
    IF v_price > 0 THEN
      v_payment := 'unpaid';
    END IF;

    v_group_id := v_ticket.group_id;
  ELSIF v_active_tickets > 0 THEN
    RAISE EXCEPTION 'ticket_required: this event sells tickets - pick one';
  END IF;

  IF v_group_id IS NULL THEN
    SELECT g.id INTO v_group_id
    FROM public.event_groups g
    WHERE g.tenant_id = v_tenant AND g.event_id = v_event.id AND g.is_default;
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

  SELECT p.id INTO v_person_id
  FROM public.event_people p
  WHERE p.tenant_id = v_tenant AND p.email_norm = v_email;

  v_bind_uid := CASE
    WHEN v_uid IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM public.event_people p2
      WHERE p2.tenant_id = v_tenant
        AND p2.user_id = v_uid
        AND (v_person_id IS NULL OR p2.id <> v_person_id)
    ) THEN NULL
    ELSE v_uid
  END;

  IF v_person_id IS NULL THEN
    INSERT INTO public.event_people (
      tenant_id, user_id, email, first_name, last_name, phone, job_title,
      company_text, social_profile_url, source,
      consent_data_processing_at, consent_marketing_at, consent_partner_sharing_at,
      created_by
    ) VALUES (
      v_tenant, v_bind_uid, v_email, v_first, v_last, v_phone, v_job,
      v_company, v_social, 'self_registration',
      now(),
      CASE WHEN v_marketing THEN now() END,
      CASE WHEN v_partner THEN now() END,
      v_uid
    )
    RETURNING id INTO v_person_id;
  ELSE
    UPDATE public.event_people p SET
      user_id = COALESCE(p.user_id, v_bind_uid),
      first_name = v_first,
      last_name = v_last,
      phone = COALESCE(v_phone, p.phone),
      job_title = COALESCE(v_job, p.job_title),
      company_text = COALESCE(v_company, p.company_text),
      social_profile_url = COALESCE(v_social, p.social_profile_url),
      consent_data_processing_at = COALESCE(p.consent_data_processing_at, now()),
      consent_marketing_at = CASE
        WHEN v_marketing THEN COALESCE(p.consent_marketing_at, now())
        ELSE p.consent_marketing_at
      END,
      consent_partner_sharing_at = CASE
        WHEN v_partner THEN COALESCE(p.consent_partner_sharing_at, now())
        ELSE p.consent_partner_sharing_at
      END,
      consent_withdrawn_at = NULL
    WHERE p.id = v_person_id AND p.tenant_id = v_tenant;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant
      AND r.event_id = v_event.id
      AND r.person_id = v_person_id
      AND r.status NOT IN ('cancelled', 'rejected')
  ) THEN
    RAISE EXCEPTION 'already_registered: this person already has an active registration';
  END IF;

  v_verdict := public._event_registration_verdict(v_tenant, v_event.id, v_answers);

  IF v_verdict = 'reject' THEN
    v_status := 'rejected';
    v_decision_source := 'automatic_rule';
  ELSIF v_verdict = 'approval' THEN
    v_status := 'pending';
  ELSIF v_verdict = 'auto_approve' THEN
    v_status := 'approved';
    v_decision_source := 'automatic_rule';
  ELSE
    v_status := CASE WHEN v_event.registration_flow = 'approval' THEN 'pending' ELSE 'approved' END;
    v_decision_source := CASE WHEN v_status = 'approved' THEN 'system' ELSE NULL END;
  END IF;

  IF v_ticket.id IS NOT NULL AND v_ticket.requires_approval AND v_status = 'approved' THEN
    v_status := 'pending';
    v_decision_source := NULL;
  END IF;

  -- NIEZAPLACONY BILET NIE TRZYMA MIEJSCA W PULI.
  IF v_payment = 'unpaid' AND v_status = 'approved' THEN
    v_status := 'pending';
    v_decision_source := NULL;
  END IF;

  IF v_status = 'approved' THEN
    v_seats_left := public._event_seats_left(v_tenant, v_event.id, v_ticket.id);
    IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
      IF v_ticket.id IS NOT NULL AND NOT v_ticket.waitlist_enabled THEN
        RAISE EXCEPTION 'sold_out: no seats left and the waiting list is closed';
      END IF;
      v_status := 'waitlist';
      v_decision_source := 'capacity';
      v_position := public._event_next_waitlist_position(v_tenant, v_event.id);
    END IF;
  END IF;

  -- KOD QR JEST PRZEPUSTKA, WIEC NIE POWSTAJE PRZED PLATNOSCIA.
  IF v_status = 'approved' AND v_payment <> 'unpaid' THEN
    v_token := public._event_new_qr_token();
  END IF;
  v_manage := public._event_new_qr_token();

  INSERT INTO public.event_registrations (
    tenant_id, event_id, person_id, ticket_type_id, group_id, status,
    registration_mode, answers, source,
    decided_at, decision_source, qr_token_hash, qr_issued_at,
    manage_token_hash, waitlist_position, payment_status, created_by
  ) VALUES (
    v_tenant, v_event.id, v_person_id, v_ticket.id, v_group_id, v_status,
    CASE WHEN v_event.registration_mode = 'form' THEN 'form' ELSE 'rsvp' END,
    v_answers, 'self_registration',
    CASE WHEN v_decision_source IS NOT NULL THEN now() END,
    v_decision_source,
    CASE WHEN v_token IS NOT NULL THEN encode(digest(v_token, 'sha256'), 'hex') END,
    CASE WHEN v_token IS NOT NULL THEN now() END,
    encode(digest(v_manage, 'sha256'), 'hex'),
    v_position,
    v_payment,
    v_uid
  )
  RETURNING id INTO v_reg_id;

  INSERT INTO public.event_term_acceptances (
    tenant_id, term_id, person_id, registration_id, version, ip_hash, user_agent
  )
  SELECT v_tenant, tr.id, v_person_id, v_reg_id, tr.version, v_ip_hash, v_user_agent
  FROM public.event_terms tr
  WHERE tr.tenant_id = v_tenant
    AND tr.event_id = v_event.id
    AND tr.is_active
    AND tr.id = ANY (v_accepted)
  ON CONFLICT (tenant_id, term_id, person_id, version) DO NOTHING;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_reg_id::text,
    'event.registration.created.v1',
    jsonb_build_object(
      'event_id', v_event.id,
      'person_id', v_person_id,
      'status', v_status,
      'ticket_type_id', v_ticket.id,
      'source', 'self_registration'
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'registration_id', v_reg_id,
    'person_id', v_person_id,
    'status', v_status,
    'decision_source', v_decision_source,
    'waitlist_position', v_position,
    'ticket_type_id', v_ticket.id,
    'group_id', v_group_id,
    'qr_token', v_token,
    'manage_token', v_manage,
    'payment_status', v_payment,
    'payment_required', (v_payment = 'unpaid'),
    'amount_cents', CASE WHEN v_payment = 'unpaid' THEN v_price END,
    'currency', CASE WHEN v_payment = 'unpaid' THEN v_ticket.currency END
  );
END;
$$;

COMMENT ON FUNCTION public.event_register(jsonb) IS
  'Publiczny zapis na wydarzenie. Przy wejsciowce platnej zapisuje payment_status = unpaid i NIE wydaje kodu QR - wejsciowka powstaje dopiero po potwierdzeniu platnosci; odpowiedz niesie payment_required, amount_cents i currency. Wczesniej cena nie byla sprawdzana w ogole i platny bilet wychodzil za darmo, z dzialajacym kodem QR.';

-- 20260828207000_event_registration_payment_settlement.sql
-- events-harness: include
CREATE OR REPLACE FUNCTION public.admin_event_registration_decide(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_action text := lower(btrim(COALESCE(p_payload->>'action', '')));
  v_note text := NULLIF(btrim(COALESCE(p_payload->>'note', '')), '');
  v_reg public.event_registrations;
  v_seats_left integer;
  v_token text;
  v_position integer;
  v_freed boolean := false;
  v_status text;
  v_promoted jsonb := jsonb_build_object('promoted', 0);
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: registration_id is required';
  END IF;

  IF v_action NOT IN ('approve', 'reject', 'waitlist', 'attended', 'no_show',
                      'cancel', 'paid', 'refund') THEN
    RAISE EXCEPTION 'invalid_action: unknown decision %', v_action;
  END IF;

  SELECT * INTO v_reg
  FROM public.event_registrations r
  WHERE r.id = v_id AND r.tenant_id = v_tenant;

  IF v_reg.id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
  END IF;

  PERFORM 1 FROM public.events e
  WHERE e.id = v_reg.event_id AND e.tenant_id = v_tenant
  FOR UPDATE;

  IF v_reg.ticket_type_id IS NOT NULL THEN
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.id = v_reg.ticket_type_id AND t.tenant_id = v_tenant
    FOR UPDATE;
  END IF;

  IF NOT (
    (v_action = 'approve' AND v_reg.status IN ('draft', 'pending', 'waitlist', 'rejected', 'cancelled'))
    OR (v_action = 'reject' AND v_reg.status IN ('draft', 'pending', 'waitlist', 'approved'))
    OR (v_action = 'waitlist' AND v_reg.status IN ('draft', 'pending', 'approved'))
    OR (v_action = 'attended' AND v_reg.status IN ('approved', 'no_show'))
    OR (v_action = 'no_show' AND v_reg.status IN ('approved', 'attended'))
    OR (v_action = 'cancel' AND v_reg.status IN ('draft', 'pending', 'waitlist', 'approved'))
    OR (v_action = 'paid' AND v_reg.payment_status = 'unpaid'
        AND v_reg.status IN ('draft', 'pending', 'waitlist', 'approved'))
    OR (v_action = 'refund' AND v_reg.payment_status = 'paid')
  ) THEN
    IF v_action IN ('paid', 'refund') THEN
      RAISE EXCEPTION 'invalid_transition: payment % cannot be %',
        v_reg.payment_status, v_action;
    END IF;
    RAISE EXCEPTION 'invalid_transition: % cannot be %', v_reg.status, v_action;
  END IF;

  v_freed := v_reg.status IN ('approved', 'attended', 'no_show')
    AND v_action IN ('reject', 'waitlist', 'cancel', 'refund');

  IF v_action = 'approve' THEN
    IF v_reg.status IN ('rejected', 'cancelled') AND EXISTS (
      SELECT 1 FROM public.event_registrations r2
      WHERE r2.tenant_id = v_tenant
        AND r2.event_id = v_reg.event_id
        AND r2.person_id = v_reg.person_id
        AND r2.id <> v_reg.id
        AND r2.status NOT IN ('cancelled', 'rejected')
    ) THEN
      RAISE EXCEPTION 'already_registered: this person already has an active registration';
    END IF;

    v_seats_left := public._event_seats_left(v_tenant, v_reg.event_id, v_reg.ticket_type_id);
    IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
      RAISE EXCEPTION 'no_seats_left: no free seat for this ticket - use the waiting list';
    END IF;

    IF v_reg.payment_status <> 'unpaid' THEN
      v_token := public._event_new_qr_token();
    END IF;

    UPDATE public.event_registrations r
    SET status = 'approved',
        waitlist_position = NULL,
        cancelled_at = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        qr_token_hash = CASE
          WHEN v_token IS NOT NULL THEN encode(digest(v_token, 'sha256'), 'hex')
          ELSE NULL
        END,
        qr_issued_at = CASE WHEN v_token IS NOT NULL THEN now() END,
        promoted_at = CASE WHEN r.status = 'waitlist' THEN now() ELSE r.promoted_at END
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'paid' THEN
    IF v_reg.status <> 'approved' THEN
      v_seats_left := public._event_seats_left(v_tenant, v_reg.event_id, v_reg.ticket_type_id);
      IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
        RAISE EXCEPTION 'no_seats_left: no free seat for this ticket - use the waiting list';
      END IF;
    END IF;

    v_token := public._event_new_qr_token();

    UPDATE public.event_registrations r
    SET payment_status = 'paid',
        status = 'approved',
        waitlist_position = NULL,
        cancelled_at = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        qr_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        qr_issued_at = now(),
        promoted_at = CASE WHEN r.status = 'waitlist' THEN now() ELSE r.promoted_at END
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'refund' THEN
    UPDATE public.event_registrations r
    SET payment_status = 'refunded',
        status = 'cancelled',
        cancelled_at = now(),
        waitlist_position = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'reject' THEN
    IF v_note IS NULL OR char_length(v_note) < 3 THEN
      RAISE EXCEPTION 'reason_required: a rejection reason is required';
    END IF;

    UPDATE public.event_registrations r
    SET status = 'rejected',
        waitlist_position = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = v_note,
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'waitlist' THEN
    v_position := public._event_next_waitlist_position(v_tenant, v_reg.event_id);

    UPDATE public.event_registrations r
    SET status = 'waitlist',
        waitlist_position = v_position,
        waitlist_notified_at = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'cancel' THEN
    UPDATE public.event_registrations r
    SET status = 'cancelled',
        cancelled_at = now(),
        waitlist_position = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSE
    UPDATE public.event_registrations r
    SET status = v_action,
        attended_at = CASE
          WHEN v_action = 'attended' THEN COALESCE(r.attended_at, now())
          ELSE NULL
        END,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note)
    WHERE r.id = v_id AND r.tenant_id = v_tenant;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_id::text,
    'event.registration.decided.v1',
    jsonb_build_object(
      'event_id', v_reg.event_id,
      'person_id', v_reg.person_id,
      'from', v_reg.status,
      'action', v_action
    ),
    v_uid
  );

  IF v_freed THEN
    v_promoted := public._event_waitlist_promote(
      v_tenant, v_reg.event_id, v_reg.ticket_type_id, 1
    );
  END IF;

  SELECT r.status INTO v_status
  FROM public.event_registrations r
  WHERE r.id = v_id AND r.tenant_id = v_tenant;

  RETURN jsonb_build_object(
    'registration_id', v_id,
    'action', v_action,
    'status', v_status,
    'waitlist_position', v_position,
    'qr_token', v_token,
    'promoted_from_waitlist', COALESCE((v_promoted->>'promoted')::integer, 0),
    'promoted', COALESCE(v_promoted->'registrations', '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_decide(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_decide(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_decide(jsonb) IS
  'Decyzja organizatora o zapisie: approve | reject | waitlist | attended | no_show | cancel | paid | refund. Jawna tablica dozwolonych przejsc, pula sprawdzana pod blokada, slad decyzji (kto, kiedy, na jakiej podstawie, dlaczego). paid ksieguje wplate, zajmuje miejsce i wydaje kod QR; approve na niezaplaconym zgloszeniu zajmuje miejsce, ale kodu NIE wydaje; refund zdejmuje kod i odwoluje zapis. Zwolnione miejsce promuje kolejke.';