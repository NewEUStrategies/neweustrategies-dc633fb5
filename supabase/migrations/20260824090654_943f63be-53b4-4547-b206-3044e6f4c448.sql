DROP FUNCTION IF EXISTS public.admin_event_registrations_counts(p_event_id uuid, p_ticket_type_id uuid, p_group_id uuid, p_q text, p_from timestamp with time zone, p_to timestamp with time zone);
CREATE OR REPLACE FUNCTION public.admin_event_registrations_counts(
  p_event_id uuid,
  p_ticket_type_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
  v_out jsonb;
  v_capacity integer;
  v_seats_left integer;
BEGIN
  SELECT e.capacity INTO v_capacity
  FROM public.events e
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  v_seats_left := public._event_seats_left(v_tenant, p_event_id, p_ticket_type_id);

  SELECT jsonb_build_object(
    'all', count(*),
    'draft', count(*) FILTER (WHERE r.status = 'draft'),
    'pending', count(*) FILTER (WHERE r.status = 'pending'),
    'approved', count(*) FILTER (WHERE r.status = 'approved'),
    'rejected', count(*) FILTER (WHERE r.status = 'rejected'),
    'waitlist', count(*) FILTER (WHERE r.status = 'waitlist'),
    'cancelled', count(*) FILTER (WHERE r.status = 'cancelled'),
    'attended', count(*) FILTER (WHERE r.status = 'attended'),
    'no_show', count(*) FILTER (WHERE r.status = 'no_show'),
    'awaiting_notice', count(*) FILTER (
      WHERE r.promoted_at IS NOT NULL AND r.waitlist_notified_at IS NULL
    )
  )
  INTO v_out
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.tenant_id = v_tenant
    AND r.event_id = p_event_id
    AND (p_ticket_type_id IS NULL OR r.ticket_type_id = p_ticket_type_id)
    AND (
      p_group_id IS NULL
      OR r.group_id = p_group_id
      OR EXISTS (
        SELECT 1 FROM public.event_group_members m2
        WHERE m2.tenant_id = r.tenant_id
          AND m2.group_id = p_group_id
          AND m2.person_id = r.person_id
      )
    )
    AND (p_from IS NULL OR r.created_at >= p_from)
    AND (p_to IS NULL OR r.created_at <= p_to)
    AND (
      v_q IS NULL
      OR p.full_name_norm LIKE '%' || lower(v_q) || '%'
      OR p.email_norm LIKE '%' || lower(v_q) || '%'
      OR p.company_text ILIKE '%' || v_q || '%'
      OR p.job_title ILIKE '%' || v_q || '%'
    );

  RETURN COALESCE(v_out, jsonb_build_object(
    'all', 0, 'draft', 0, 'pending', 0, 'approved', 0, 'rejected', 0,
    'waitlist', 0, 'cancelled', 0, 'attended', 0, 'no_show', 0, 'awaiting_notice', 0
  )) || jsonb_build_object('capacity', v_capacity, 'seats_left', v_seats_left);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registrations_counts(uuid, uuid, uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registrations_counts(uuid, uuid, uuid, text, timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registrations_counts(uuid, uuid, uuid, text, timestamptz, timestamptz) IS
  'Liczniki zapisow per status pod zakladki listy plus stan pojemnosci. Ignoruje filtr statusu, respektuje pozostale filtry. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_registration_decide(p_payload jsonb);
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
  v_promoted jsonb := jsonb_build_object('promoted', 0);
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: registration_id is required';
  END IF;

  IF v_action NOT IN ('approve', 'reject', 'waitlist', 'attended', 'no_show', 'cancel') THEN
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
  ) THEN
    RAISE EXCEPTION 'invalid_transition: % cannot be %', v_reg.status, v_action;
  END IF;

  v_freed := v_reg.status IN ('approved', 'attended', 'no_show')
    AND v_action IN ('reject', 'waitlist', 'cancel');

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

    v_token := public._event_new_qr_token();

    UPDATE public.event_registrations r
    SET status = 'approved',
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

  RETURN jsonb_build_object(
    'registration_id', v_id,
    'action', v_action,
    'status', CASE WHEN v_action = 'cancel' THEN 'cancelled' ELSE
      CASE WHEN v_action = 'approve' THEN 'approved' ELSE v_action END END,
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
  'Decyzja organizatora o zapisie: approve | reject | waitlist | attended | no_show | cancel. Jawna tablica dozwolonych przejsc, pula sprawdzana pod blokada, slad decyzji (kto, kiedy, na jakiej podstawie, dlaczego). Zwolnione miejsce promuje kolejke.';