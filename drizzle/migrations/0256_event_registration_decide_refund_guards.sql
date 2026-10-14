CREATE OR REPLACE FUNCTION public.admin_event_registration_decide(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_action text := lower(btrim(COALESCE(p_payload->>'action', '')));
  v_note text := NULLIF(btrim(COALESCE(p_payload->>'note', '')), '');
  v_reason text := NULLIF(btrim(COALESCE(p_payload->>'participant_reason', '')), '');
  v_refund_choice text := NULLIF(lower(btrim(COALESCE(p_payload->>'refund', ''))), '');
  v_reg public.event_registrations;
  v_starts timestamptz;
  v_ends timestamptz;
  v_seats_left integer;
  v_token text;
  v_position integer;
  v_freed boolean := false;
  v_status text;
  v_assess jsonb;
  v_refund jsonb;
  v_job_state text;
  v_promoted jsonb := jsonb_build_object('promoted', 0);
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: registration_id is required';
  END IF;

  IF v_action NOT IN ('approve', 'reject', 'waitlist', 'attended', 'no_show',
                      'cancel', 'paid', 'refund') THEN
    RAISE EXCEPTION 'invalid_action: unknown decision %', v_action;
  END IF;

  IF v_reason IS NOT NULL AND v_action NOT IN ('reject', 'cancel', 'refund') THEN
    RAISE EXCEPTION 'invalid_request: participant_reason is accepted only for reject, cancel or refund';
  END IF;
  IF char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'participant_reason_too_long: at most 1000 characters';
  END IF;
  IF char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'note_too_long: at most 2000 characters';
  END IF;
  IF v_refund_choice IS NOT NULL AND v_refund_choice NOT IN ('full', 'none') THEN
    RAISE EXCEPTION 'invalid_request: refund must be full or none';
  END IF;
  IF v_refund_choice IS NOT NULL AND v_action <> 'cancel' THEN
    RAISE EXCEPTION 'invalid_request: refund choice is accepted only for cancel';
  END IF;

  SELECT * INTO v_reg
  FROM public.event_registrations r
  WHERE r.id = v_id AND r.tenant_id = v_tenant;

  IF v_reg.id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
  END IF;

  SELECT e.starts_at, e.ends_at INTO v_starts, v_ends
  FROM public.events e
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

    IF v_reg.payment_status IN ('paid', 'partially_refunded', 'not_required') THEN
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
        participant_reason = NULL,
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
        participant_reason = NULL,
        qr_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        qr_issued_at = now(),
        promoted_at = CASE WHEN r.status = 'waitlist' THEN now() ELSE r.promoted_at END
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'refund' THEN
    IF v_reg.payment_order_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.event_registrations x
       WHERE x.tenant_id = v_tenant
         AND x.payment_order_id = v_reg.payment_order_id
         AND x.id <> v_id
         AND x.status NOT IN ('cancelled', 'rejected')
    ) THEN
      RAISE EXCEPTION 'refund_order_shared: other active registrations share this payment - settle it in the refund journal or cancel the whole group';
    END IF;

    UPDATE public.event_registrations r
    SET payment_status = 'refunded',
        status = 'cancelled',
        cancelled_at = now(),
        waitlist_position = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        participant_reason = v_reason,
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
        participant_reason = v_reason,
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
        participant_reason = NULL,
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'cancel' THEN
    v_assess := public._event_registration_refund_assess(v_tenant, v_id, 'organizer_cancelled', now());
    IF v_refund_choice = 'none' AND v_assess->>'job_state' IS NOT NULL
       AND (v_note IS NULL OR char_length(v_note) < 3) THEN
      RAISE EXCEPTION 'reason_required: waiving the refund needs an internal note';
    END IF;

    IF v_refund_choice = 'none' AND v_assess->>'job_state' IS NOT NULL THEN
      SELECT j.state INTO v_job_state
        FROM public.event_registration_refund_jobs j
       WHERE j.tenant_id = v_tenant
         AND ((NULLIF(v_assess->>'payment_order_id', '') IS NOT NULL
               AND j.payment_order_id = (v_assess->>'payment_order_id')::uuid)
              OR (NULLIF(v_assess->>'payment_order_id', '') IS NULL
                  AND j.payment_order_id IS NULL AND j.registration_id = v_id))
       FOR UPDATE;
      IF v_job_state IN ('processing', 'submitted', 'completed') THEN
        RAISE EXCEPTION 'refund_in_progress: the refund of this payment is already with the payment provider (%)', v_job_state;
      END IF;
    END IF;

    UPDATE public.event_registrations r
    SET status = 'cancelled',
        cancelled_at = now(),
        waitlist_position = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        participant_reason = v_reason,
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

    v_refund := public._event_registration_cancel_refund(
      v_tenant, v_id, 'organizer_cancelled', v_uid, v_assess,
      v_refund_choice = 'none', v_note);

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
        decision_note = COALESCE(v_note, r.decision_note),
        participant_reason = NULL
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
      'action', v_action,
      'refund_effect', v_refund->>'effect'
    ),
    v_uid
  );

  IF v_freed AND now() < public._event_effective_end(v_starts, v_ends) THEN
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
    'participant_reason', CASE WHEN v_action IN ('reject', 'cancel', 'refund') THEN v_reason END,
    'refund', CASE WHEN v_refund IS NULL THEN NULL ELSE jsonb_build_object(
      'effect', v_refund->>'effect',
      'job_id', v_refund->>'job_id',
      'job_state', v_refund->>'job_state',
      'review_reason', v_refund->>'review_reason',
      'amount_cents', (v_refund->>'amount_cents')::integer,
      'currency', v_refund->>'currency') END,
    'promoted_from_waitlist', COALESCE((v_promoted->>'promoted')::integer, 0),
    'promoted', COALESCE(v_promoted->'registrations', '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_decide(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_decide(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_decide(jsonb) IS
  'Decyzja organizatora o zapisie: approve | reject | waitlist | attended | no_show | cancel | paid | refund. Jawna tablica przejsc, pula pod blokada, slad decyzji. note = WEWNETRZNA notatka (decision_note, <= 2000); participant_reason (<= 1000, tylko reject/cancel/refund) = jedyny tekst dla uczestnika. cancel liczy skutek finansowy i zapisuje zlecenie zwrotu (refund full|none; none wymaga notatki, a zlecenie juz u operatora albo zakonczone -> refund_in_progress). refund na wplacie dzielonej z innym niezamknietym zgloszeniem -> refund_order_shared. approve wydaje kod QR tylko rozliczonemu (paid/partially_refunded/not_required). Awans kolejki tylko przed koncem wydarzenia. Najemca z assert_editor_tenant().';