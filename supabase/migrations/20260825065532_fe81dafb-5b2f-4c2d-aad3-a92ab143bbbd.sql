DROP FUNCTION IF EXISTS public.event_meeting_cancel(jsonb);
CREATE FUNCTION public.event_meeting_cancel(p_payload jsonb)
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
  v_reason text := NULLIF(btrim(COALESCE(p_payload->>'reason', '')), '');
  v_row public.event_meetings;
  v_me uuid;
  v_side text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL OR v_meeting_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: meeting_id is required';
  END IF;

  SELECT * INTO v_row
  FROM public.event_meetings m
  WHERE m.id = v_meeting_id AND m.tenant_id = v_tenant
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: meeting does not exist';
  END IF;

  v_me := public._event_meeting_caller_registration(v_tenant, v_row.event_id);

  v_side := CASE
    WHEN v_me = v_row.requester_registration_id THEN 'requester'
    WHEN v_me = v_row.invitee_registration_id THEN 'invitee'
  END;

  IF v_side IS NULL THEN
    RAISE EXCEPTION 'not_a_party: only a party of this meeting can cancel it';
  END IF;

  IF v_row.status NOT IN ('invited', 'accepted') THEN
    RAISE EXCEPTION 'meeting_not_active: only an open invitation or an accepted meeting can be cancelled';
  END IF;

  UPDATE public.event_meetings
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_uid,
      cancelled_side = v_side,
      cancel_reason = v_reason
  WHERE id = v_meeting_id AND tenant_id = v_tenant;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_meeting',
    v_meeting_id::text,
    'event_meeting.cancelled.v1',
    jsonb_build_object(
      'event_id', v_row.event_id,
      'meeting_id', v_meeting_id,
      'by', v_side,
      'starts_at', v_row.starts_at
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'meeting_id', v_meeting_id,
    'status', 'cancelled',
    'cancelled_side', v_side
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_cancel(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_cancel(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_cancel(jsonb) IS
  'Kazda ze stron odwoluje zaproszenie albo przyjete spotkanie; zapisuje, ktora strona to zrobila. Plaszczyzna tresci (public_tenant_id).';

DROP FUNCTION IF EXISTS public.event_meeting_reschedule(jsonb);
CREATE FUNCTION public.event_meeting_reschedule(p_payload jsonb)
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
  v_starts timestamptz := (NULLIF(p_payload->>'starts_at', ''))::timestamptz;
  v_row public.event_meetings;
  v_settings public.event_meeting_settings;
  v_me uuid;
  v_other uuid;
  v_reason text;
  v_ends timestamptz;
  v_expires timestamptz;
  v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL OR v_meeting_id IS NULL OR v_starts IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: meeting_id and starts_at are required';
  END IF;

  SELECT * INTO v_row
  FROM public.event_meetings m
  WHERE m.id = v_meeting_id AND m.tenant_id = v_tenant
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: meeting does not exist';
  END IF;

  v_me := public._event_meeting_caller_registration(v_tenant, v_row.event_id);

  v_other := CASE
    WHEN v_me = v_row.requester_registration_id THEN v_row.invitee_registration_id
    WHEN v_me = v_row.invitee_registration_id THEN v_row.requester_registration_id
  END;

  IF v_me IS NULL OR v_other IS NULL THEN
    RAISE EXCEPTION 'not_a_party: only a party of this meeting can reschedule it';
  END IF;

  IF v_row.status NOT IN ('invited', 'accepted') THEN
    RAISE EXCEPTION 'meeting_not_active: only an open invitation or an accepted meeting can be rescheduled';
  END IF;

  IF v_starts = v_row.starts_at THEN
    RAISE EXCEPTION 'same_slot: the new slot is the same as the current one';
  END IF;

  SELECT * INTO v_settings
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = v_row.event_id;

  IF v_settings.id IS NULL OR NOT v_settings.is_enabled THEN
    RAISE EXCEPTION 'meetings_disabled: the meeting exchange is not enabled for this event';
  END IF;

  v_reason := public._event_meeting_can_invite(v_tenant, v_row.event_id, v_me, v_other);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%: meeting between these two is not allowed', v_reason;
  END IF;

  v_ends := v_starts + make_interval(mins => v_settings.slot_minutes);
  v_expires := LEAST(
    now() + make_interval(hours => v_settings.invite_expires_after_hours),
    v_starts
  );

  UPDATE public.event_meetings
  SET status = 'rescheduled',
      responded_at = now(),
      responded_by = v_uid
  WHERE id = v_meeting_id AND tenant_id = v_tenant;

  INSERT INTO public.event_meetings (
    tenant_id, event_id, requester_registration_id, invitee_registration_id,
    starts_at, ends_at, status, topic, sponsor_id, invitation_message,
    expires_at, invited_by, rescheduled_from_id
  ) VALUES (
    v_tenant, v_row.event_id, v_me, v_other,
    v_starts, v_ends, 'invited',
    v_row.topic, v_row.sponsor_id,
    COALESCE(NULLIF(btrim(COALESCE(p_payload->>'message', '')), ''), v_row.invitation_message),
    v_expires, v_uid, v_meeting_id
  )
  RETURNING id INTO v_new_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_meeting',
    v_new_id::text,
    'event_meeting.rescheduled.v1',
    jsonb_build_object(
      'event_id', v_row.event_id,
      'meeting_id', v_new_id,
      'rescheduled_from_id', v_meeting_id,
      'previous_starts_at', v_row.starts_at,
      'starts_at', v_starts
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'meeting_id', v_new_id,
    'rescheduled_from_id', v_meeting_id,
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

REVOKE ALL ON FUNCTION public.event_meeting_reschedule(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_reschedule(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_reschedule(jsonb) IS
  'Przelozenie spotkania: stary wiersz dostaje stan rescheduled, powstaje NOWE zaproszenie na nowy termin ze sladem rescheduled_from_id. Kto proponuje, ten jest zapraszajacym. Plaszczyzna tresci (public_tenant_id).';

DROP FUNCTION IF EXISTS public.event_meetings_mine(jsonb);
CREATE FUNCTION public.event_meetings_mine(p_payload jsonb)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  side text,
  status text,
  is_expired boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  expires_at timestamptz,
  counterpart_registration_id uuid,
  counterpart_first_name text,
  counterpart_last_name text,
  counterpart_job_title text,
  counterpart_company text,
  table_label text,
  table_zone text,
  table_seat integer,
  topic text,
  sponsor_id uuid,
  sponsor_name text,
  invitation_message text,
  decline_reason text,
  cancel_reason text,
  cancelled_side text,
  responded_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug', '')), '');
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_status text := NULLIF(p_payload->>'status', '');
  v_me uuid;
  v_limit integer := LEAST(GREATEST(COALESCE((NULLIF(p_payload->>'limit', ''))::integer, 100), 1), 300);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
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
    RAISE EXCEPTION 'not_registered: only a participant of this event has meetings here';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.event_id,
    a.side,
    m.status,
    (m.status = 'invited' AND m.expires_at < now()),
    m.starts_at,
    m.ends_at,
    m.expires_at,
    other.id,
    op.first_name,
    op.last_name,
    op.job_title,
    COALESCE(oc.name, op.company_text),
    t.label,
    t.zone,
    m.table_seat,
    m.topic,
    m.sponsor_id,
    sp.snapshot_name,
    m.invitation_message,
    m.decline_reason,
    m.cancel_reason,
    m.cancelled_side,
    m.responded_at,
    m.created_at
  FROM public.event_meeting_attendees a
  JOIN public.event_meetings m
    ON m.id = a.meeting_id AND m.tenant_id = a.tenant_id
  JOIN public.event_registrations other
    ON other.tenant_id = m.tenant_id
   AND other.id = CASE
     WHEN a.side = 'requester' THEN m.invitee_registration_id
     ELSE m.requester_registration_id
   END
  JOIN public.event_people op
    ON op.id = other.person_id AND op.tenant_id = other.tenant_id
  LEFT JOIN public.crm_companies oc
    ON oc.id = op.company_id AND oc.tenant_id = op.tenant_id
  LEFT JOIN public.event_meeting_tables t
    ON t.id = m.table_id AND t.tenant_id = m.tenant_id
  LEFT JOIN public.event_sponsors sp
    ON sp.id = m.sponsor_id AND sp.tenant_id = m.tenant_id
  WHERE a.tenant_id = v_tenant
    AND a.event_id = v_event_id
    AND a.registration_id = v_me
    AND (
      v_status IS NULL
      OR v_status = 'all'
      OR (v_status = 'pending' AND m.status = 'invited' AND m.expires_at >= now())
      OR (v_status = 'expired' AND m.status = 'invited' AND m.expires_at < now())
      OR m.status = v_status
    )
  ORDER BY m.starts_at, m.created_at, m.id
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.event_meetings_mine(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meetings_mine(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meetings_mine(jsonb) IS
  'Spotkania wolajacego uczestnika z danymi drugiej strony (imie, nazwisko, stanowisko, firma - bez kontaktu), strona wolajacego i liczonym stanem wygasniecia. Plaszczyzna tresci (public_tenant_id).';