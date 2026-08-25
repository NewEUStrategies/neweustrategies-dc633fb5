DROP FUNCTION IF EXISTS public.event_meeting_respond(jsonb);
CREATE FUNCTION public.event_meeting_respond(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_meeting_id uuid := NULLIF(p_payload->>'meeting_id', '')::uuid;
  v_decision text := lower(NULLIF(btrim(COALESCE(p_payload->>'decision', '')), ''));
  v_reason text := NULLIF(btrim(COALESCE(p_payload->>'decline_reason', '')), '');
  v_preferred_table uuid := NULLIF(p_payload->>'table_id', '')::uuid;
  v_row public.event_meetings;
  v_settings public.event_meeting_settings;
  v_me uuid;
  v_seat record;
  v_has_tables boolean;
  v_day date;
  v_taken integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL OR v_meeting_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: meeting_id is required';
  END IF;

  IF v_decision NOT IN ('accept', 'decline') THEN
    RAISE EXCEPTION 'invalid_decision: decision must be accept or decline';
  END IF;

  SELECT * INTO v_row
  FROM public.event_meetings m
  WHERE m.id = v_meeting_id AND m.tenant_id = v_tenant
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: meeting does not exist';
  END IF;

  v_me := public._event_meeting_caller_registration(v_tenant, v_row.event_id);

  IF v_me IS NULL OR v_me <> v_row.invitee_registration_id THEN
    RAISE EXCEPTION 'not_invitee: only the invited person can answer this invitation';
  END IF;

  IF v_row.status <> 'invited' THEN
    RAISE EXCEPTION 'invitation_not_open: this invitation has already been answered';
  END IF;

  IF v_row.expires_at < now() THEN
    RAISE EXCEPTION 'invitation_expired: this invitation expired on %', v_row.expires_at;
  END IF;

  IF v_decision = 'decline' THEN
    IF v_reason IS NULL OR char_length(v_reason) < 3 THEN
      RAISE EXCEPTION 'decline_reason_required: a short reason is required when declining';
    END IF;

    UPDATE public.event_meetings
    SET status = 'declined',
        decline_reason = v_reason,
        responded_at = now(),
        responded_by = v_uid
    WHERE id = v_meeting_id AND tenant_id = v_tenant;

    PERFORM public.emit_domain_event(
      v_tenant,
      'event_meeting',
      v_meeting_id::text,
      'event_meeting.declined.v1',
      jsonb_build_object(
        'event_id', v_row.event_id,
        'meeting_id', v_meeting_id,
        'starts_at', v_row.starts_at
      ),
      v_uid
    );

    RETURN jsonb_build_object('meeting_id', v_meeting_id, 'status', 'declined');
  END IF;

  SELECT * INTO v_settings
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = v_row.event_id;

  IF v_settings.id IS NULL OR NOT v_settings.is_enabled THEN
    RAISE EXCEPTION 'meetings_disabled: the meeting exchange is not enabled for this event';
  END IF;

  IF v_settings.max_meetings_per_day IS NOT NULL THEN
    v_day := (v_row.starts_at AT TIME ZONE v_settings.timezone)::date;

    SELECT max(x.taken)::integer INTO v_taken
    FROM (
      SELECT count(*)::integer AS taken
      FROM public.event_meeting_attendees a
      WHERE a.tenant_id = v_tenant
        AND a.event_id = v_row.event_id
        AND a.registration_id IN (
          v_row.requester_registration_id, v_row.invitee_registration_id
        )
        AND a.status IN ('accepted', 'held', 'no_show')
        AND (a.starts_at AT TIME ZONE v_settings.timezone)::date = v_day
      GROUP BY a.registration_id
    ) x;

    IF COALESCE(v_taken, 0) >= v_settings.max_meetings_per_day THEN
      RAISE EXCEPTION 'daily_limit_reached: one of you already has % meeting(s) that day', v_taken;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.event_meeting_tables t
    WHERE t.tenant_id = v_tenant AND t.event_id = v_row.event_id AND t.is_active
  ) INTO v_has_tables;

  SELECT s.out_table_id, s.out_table_seat INTO v_seat
  FROM public._event_meeting_take_seat(
    v_tenant, v_row.event_id, v_row.starts_at, v_row.ends_at, v_preferred_table, v_meeting_id
  ) s;

  IF v_has_tables AND v_seat.out_table_id IS NULL THEN
    RAISE EXCEPTION 'no_free_table: every table is taken in this slot, pick another time';
  END IF;

  UPDATE public.event_meetings
  SET status = 'accepted',
      table_id = v_seat.out_table_id,
      table_seat = v_seat.out_table_seat,
      responded_at = now(),
      responded_by = v_uid
  WHERE id = v_meeting_id AND tenant_id = v_tenant;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_meeting',
    v_meeting_id::text,
    'event_meeting.accepted.v1',
    jsonb_build_object(
      'event_id', v_row.event_id,
      'meeting_id', v_meeting_id,
      'starts_at', v_row.starts_at,
      'table_id', v_seat.out_table_id,
      'table_seat', v_seat.out_table_seat
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'meeting_id', v_meeting_id,
    'status', 'accepted',
    'starts_at', v_row.starts_at,
    'ends_at', v_row.ends_at,
    'table_id', v_seat.out_table_id,
    'table_seat', v_seat.out_table_seat
  );
EXCEPTION
  WHEN exclusion_violation THEN
    DECLARE
      v_constraint text;
    BEGIN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'event_meeting_attendees_no_overlap' THEN
        RAISE EXCEPTION 'participant_busy: one of you already has a meeting in this slot';
      END IF;
      RAISE EXCEPTION 'table_busy: the seat at this table was taken a moment ago, pick another time';
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_respond(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_respond(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_respond(jsonb) IS
  'Zaproszony przyjmuje zaproszenie (ze przydzialem stolika pod blokada) albo odrzuca je z powodem. Tlumaczy oba ograniczenia EXCLUDE na osobne klucze bledu. Plaszczyzna tresci (public_tenant_id).';