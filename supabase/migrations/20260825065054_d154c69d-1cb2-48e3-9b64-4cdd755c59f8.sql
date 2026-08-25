DROP FUNCTION IF EXISTS public.event_meeting_invite(jsonb);
CREATE FUNCTION public.event_meeting_invite(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug', '')), '');
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_other uuid := NULLIF(p_payload->>'counterpart_registration_id', '')::uuid;
  v_starts timestamptz := (NULLIF(p_payload->>'starts_at', ''))::timestamptz;
  v_settings public.event_meeting_settings;
  v_me uuid;
  v_reason text;
  v_ends timestamptz;
  v_used integer;
  v_day date;
  v_taken integer;
  v_expires timestamptz;
  v_id uuid;
  v_rate record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL OR v_other IS NULL OR v_starts IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: counterpart_registration_id and starts_at are required';
  END IF;

  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'published'
    AND ((v_event_id IS NOT NULL AND e.id = v_event_id) OR (v_slug IS NOT NULL AND e.slug = v_slug));

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  v_me := public._event_meeting_caller_registration(v_tenant, v_event_id);
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_registered: only a participant of this event can send invitations';
  END IF;

  SELECT * INTO v_settings
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id;

  IF v_settings.id IS NULL OR NOT v_settings.is_enabled THEN
    RAISE EXCEPTION 'meetings_disabled: the meeting exchange is not enabled for this event';
  END IF;

  IF (v_settings.invites_open_at IS NOT NULL AND v_settings.invites_open_at > now())
     OR (v_settings.invites_close_at IS NOT NULL AND v_settings.invites_close_at <= now()) THEN
    RAISE EXCEPTION 'exchange_closed: the meeting exchange is not open for invitations right now';
  END IF;

  SELECT * INTO v_rate
  FROM public.rate_limit_hit('event_meeting_invite', v_tenant::text || ':' || v_uid::text, 30, 10);
  IF NOT v_rate.allowed THEN
    RAISE EXCEPTION 'rate_limited: too many invitations sent, try again in a few minutes';
  END IF;

  v_reason := public._event_meeting_can_invite(v_tenant, v_event_id, v_me, v_other);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%: meeting between these two is not allowed', v_reason;
  END IF;

  IF v_settings.max_invites_per_person IS NOT NULL THEN
    SELECT count(*)::integer INTO v_used
    FROM public.event_meetings m
    WHERE m.tenant_id = v_tenant
      AND m.event_id = v_event_id
      AND m.requester_registration_id = v_me
      AND m.status IN ('invited', 'accepted');

    IF v_used >= v_settings.max_invites_per_person THEN
      RAISE EXCEPTION 'invite_limit_reached: you already have % active invitation(s)', v_used;
    END IF;
  END IF;

  v_ends := v_starts + make_interval(mins => v_settings.slot_minutes);
  v_day := (v_starts AT TIME ZONE v_settings.timezone)::date;

  IF v_settings.max_meetings_per_day IS NOT NULL THEN
    SELECT max(x.taken)::integer INTO v_taken
    FROM (
      SELECT count(*)::integer AS taken
      FROM public.event_meeting_attendees a
      WHERE a.tenant_id = v_tenant
        AND a.event_id = v_event_id
        AND a.registration_id IN (v_me, v_other)
        AND a.status IN ('accepted', 'held', 'no_show')
        AND (a.starts_at AT TIME ZONE v_settings.timezone)::date = v_day
      GROUP BY a.registration_id
    ) x;

    IF COALESCE(v_taken, 0) >= v_settings.max_meetings_per_day THEN
      RAISE EXCEPTION 'daily_limit_reached: one of you already has % meeting(s) that day', v_taken;
    END IF;
  END IF;

  v_expires := LEAST(
    now() + make_interval(hours => v_settings.invite_expires_after_hours),
    v_starts
  );

  INSERT INTO public.event_meetings (
    tenant_id, event_id, requester_registration_id, invitee_registration_id,
    starts_at, ends_at, status, topic, sponsor_id, invitation_message,
    expires_at, invited_by
  ) VALUES (
    v_tenant, v_event_id, v_me, v_other,
    v_starts, v_ends, 'invited',
    NULLIF(btrim(COALESCE(p_payload->>'topic', '')), ''),
    NULLIF(p_payload->>'sponsor_id', '')::uuid,
    NULLIF(btrim(COALESCE(p_payload->>'message', '')), ''),
    v_expires, v_uid
  )
  RETURNING id INTO v_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_meeting',
    v_id::text,
    'event_meeting.invited.v1',
    jsonb_build_object(
      'event_id', v_event_id,
      'meeting_id', v_id,
      'requester_registration_id', v_me,
      'invitee_registration_id', v_other,
      'starts_at', v_starts,
      'expires_at', v_expires
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'meeting_id', v_id,
    'status', 'invited',
    'starts_at', v_starts,
    'ends_at', v_ends,
    'expires_at', v_expires
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_invitation: you already have an active invitation with this person in this slot';
  WHEN exclusion_violation THEN
    DECLARE
      v_constraint text;
    BEGIN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'event_meetings_table_no_overlap' THEN
        RAISE EXCEPTION 'table_busy: the seat at this table is already taken in this slot';
      END IF;
      RAISE EXCEPTION 'participant_busy: one of you already has a meeting in this slot';
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_invite(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_invite(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_invite(jsonb) IS
  'Uczestnik wysyla zaproszenie na spotkanie. Siedem warunkow, kazdy z wlasnym kluczem bledu; stolik NIE jest przydzielany przy zaproszeniu. Plaszczyzna tresci (public_tenant_id).';