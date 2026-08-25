DROP FUNCTION IF EXISTS public.admin_event_meeting_arrange(jsonb);
CREATE FUNCTION public.admin_event_meeting_arrange(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_a uuid := NULLIF(p_payload->>'requester_registration_id', '')::uuid;
  v_b uuid := NULLIF(p_payload->>'invitee_registration_id', '')::uuid;
  v_starts timestamptz := (NULLIF(p_payload->>'starts_at', ''))::timestamptz;
  v_preferred_table uuid := NULLIF(p_payload->>'table_id', '')::uuid;
  v_settings public.event_meeting_settings;
  v_ends timestamptz;
  v_seat record;
  v_has_tables boolean;
  v_id uuid;
  v_day date;
  v_taken integer;
BEGIN
  IF v_event_id IS NULL OR v_a IS NULL OR v_b IS NULL OR v_starts IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id, both registrations and starts_at are required';
  END IF;

  IF v_a = v_b THEN
    RAISE EXCEPTION 'self_invite: a person cannot meet themselves';
  END IF;

  SELECT * INTO v_settings
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id;

  IF v_settings.id IS NULL OR NOT v_settings.is_enabled THEN
    RAISE EXCEPTION 'meetings_disabled: the meeting exchange is not enabled for this event';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant AND r.event_id = v_event_id AND r.id = v_a
      AND r.status IN ('approved', 'attended')
  ) THEN
    RAISE EXCEPTION 'requester_not_participating: the first person is not a participating registration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant AND r.event_id = v_event_id AND r.id = v_b
      AND r.status IN ('approved', 'attended')
  ) THEN
    RAISE EXCEPTION 'invitee_not_participating: the second person is not a participating registration';
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
        AND a.registration_id IN (v_a, v_b)
        AND a.status IN ('accepted', 'held', 'no_show')
        AND (a.starts_at AT TIME ZONE v_settings.timezone)::date = v_day
      GROUP BY a.registration_id
    ) x;

    IF COALESCE(v_taken, 0) >= v_settings.max_meetings_per_day THEN
      RAISE EXCEPTION 'daily_limit_reached: one of the parties already has % meeting(s) that day',
        v_taken;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.event_meeting_tables t
    WHERE t.tenant_id = v_tenant AND t.event_id = v_event_id AND t.is_active
  ) INTO v_has_tables;

  SELECT s.out_table_id, s.out_table_seat INTO v_seat
  FROM public._event_meeting_take_seat(
    v_tenant, v_event_id, v_starts, v_ends, v_preferred_table, NULL
  ) s;

  IF v_has_tables AND v_seat.out_table_id IS NULL THEN
    RAISE EXCEPTION 'no_free_table: no free seat at any active table in this slot';
  END IF;

  INSERT INTO public.event_meetings (
    tenant_id, event_id, requester_registration_id, invitee_registration_id,
    starts_at, ends_at, table_id, table_seat, status,
    topic, sponsor_id, invitation_message,
    expires_at, invited_by, responded_at, responded_by
  ) VALUES (
    v_tenant, v_event_id, v_a, v_b,
    v_starts, v_ends, v_seat.out_table_id, v_seat.out_table_seat, 'accepted',
    NULLIF(btrim(COALESCE(p_payload->>'topic', '')), ''),
    NULLIF(p_payload->>'sponsor_id', '')::uuid,
    NULLIF(btrim(COALESCE(p_payload->>'message', '')), ''),
    v_starts,
    auth.uid(),
    now(),
    auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_meeting',
    v_id::text,
    'event_meeting.arranged.v1',
    jsonb_build_object(
      'event_id', v_event_id,
      'meeting_id', v_id,
      'requester_registration_id', v_a,
      'invitee_registration_id', v_b,
      'starts_at', v_starts
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'meeting_id', v_id,
    'status', 'accepted',
    'starts_at', v_starts,
    'ends_at', v_ends,
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
        RAISE EXCEPTION 'participant_busy: one of the parties already has a meeting in this slot';
      END IF;
      RAISE EXCEPTION 'table_busy: the seat at this table is already taken in this slot';
    END;
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_meeting: this pair already has an active meeting in this slot';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_arrange(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_arrange(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_arrange(jsonb) IS
  'Organizator umawia spotkanie od razu przyjete, ze stolikiem przydzielonym pod blokada. Nie omija siatki, okien dostepnosci, kolizji ani limitu dziennego; omija regule widocznosci i limit zaproszen. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.event_meeting_exchange(jsonb);
CREATE FUNCTION public.event_meeting_exchange(p_payload jsonb)
RETURNS jsonb
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
  v_settings public.event_meeting_settings;
  v_me uuid;
  v_can_meet boolean := false;
  v_invites_used integer := 0;
  v_out jsonb;
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

  SELECT * INTO v_settings
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id;

  v_me := public._event_meeting_caller_registration(v_tenant, v_event_id);

  IF v_me IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public._event_meeting_groups(v_tenant, v_event_id, v_me) AS mg(group_id)
      JOIN public.event_groups g ON g.id = mg.group_id AND g.tenant_id = v_tenant
      WHERE g.can_meet
    ) INTO v_can_meet;

    SELECT count(*)::integer INTO v_invites_used
    FROM public.event_meetings m
    WHERE m.tenant_id = v_tenant
      AND m.event_id = v_event_id
      AND m.requester_registration_id = v_me
      AND m.status IN ('invited', 'accepted');
  END IF;

  v_out := jsonb_build_object(
    'event_id', v_event_id,
    'configured', v_settings.id IS NOT NULL,
    'is_enabled', COALESCE(v_settings.is_enabled, false),
    'visibility', COALESCE(v_settings.visibility, 'disabled'),
    'slot_minutes', v_settings.slot_minutes,
    'break_minutes', v_settings.break_minutes,
    'day_start_time', v_settings.day_start_time,
    'day_end_time', v_settings.day_end_time,
    'meeting_days', COALESCE(to_jsonb(v_settings.meeting_days), '[]'::jsonb),
    'timezone', v_settings.timezone,
    'invites_open_at', v_settings.invites_open_at,
    'invites_close_at', v_settings.invites_close_at,
    'open_now', COALESCE(v_settings.is_enabled, false)
      AND COALESCE(v_settings.visibility, 'disabled') <> 'disabled'
      AND (v_settings.invites_open_at IS NULL OR v_settings.invites_open_at <= now())
      AND (v_settings.invites_close_at IS NULL OR v_settings.invites_close_at > now()),
    'intro_pl', COALESCE(v_settings.intro_pl, ''),
    'intro_en', COALESCE(v_settings.intro_en, ''),
    'invite_expires_after_hours', v_settings.invite_expires_after_hours,
    'max_invites_per_person', v_settings.max_invites_per_person,
    'max_meetings_per_day', v_settings.max_meetings_per_day,
    'my_registration_id', v_me,
    'can_meet', v_can_meet,
    'invites_used', v_invites_used,
    'invites_left', CASE
      WHEN v_settings.max_invites_per_person IS NULL THEN NULL
      ELSE GREATEST(v_settings.max_invites_per_person - v_invites_used, 0)
    END,
    'tables_count', (
      SELECT count(*)::integer FROM public.event_meeting_tables t
      WHERE t.tenant_id = v_tenant AND t.event_id = v_event_id AND t.is_active
    )
  );

  v_out := v_out || jsonb_build_object('my_availability', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', a.id,
      'starts_at', a.starts_at,
      'ends_at', a.ends_at,
      'is_open', a.is_open,
      'note', a.note
    ) ORDER BY a.starts_at)
    FROM public.event_meeting_availability a
    WHERE a.tenant_id = v_tenant
      AND a.event_id = v_event_id
      AND v_me IS NOT NULL
      AND a.registration_id = v_me
  ), '[]'::jsonb));

  v_out := v_out || jsonb_build_object('my_meetings_summary', (
    SELECT jsonb_build_object(
      'incoming_pending', count(*) FILTER (
        WHERE m.status = 'invited' AND m.expires_at >= now()
          AND m.invitee_registration_id = v_me
      ),
      'outgoing_pending', count(*) FILTER (
        WHERE m.status = 'invited' AND m.expires_at >= now()
          AND m.requester_registration_id = v_me
      ),
      'accepted', count(*) FILTER (WHERE m.status = 'accepted'),
      'held', count(*) FILTER (WHERE m.status = 'held')
    )
    FROM public.event_meetings m
    WHERE m.tenant_id = v_tenant
      AND m.event_id = v_event_id
      AND v_me IS NOT NULL
      AND v_me IN (m.requester_registration_id, m.invitee_registration_id)
  ));

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_exchange(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_exchange(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_exchange(jsonb) IS
  'Stan gieldy dla wolajacego uczestnika jednym wywolaniem: siatka, okno otwarcia, limity z licznikiem zuzycia, uprawnienie grupy, wlasne okna dostepnosci i podsumowanie wlasnych spotkan. Plaszczyzna tresci (public_tenant_id).';