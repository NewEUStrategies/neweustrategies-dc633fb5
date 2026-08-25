DROP FUNCTION IF EXISTS public.admin_event_meeting_availability_set(jsonb);
CREATE FUNCTION public.admin_event_meeting_availability_set(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_registration_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_row public.event_meeting_availability;
  v_event_id uuid;
  v_starts timestamptz;
  v_ends timestamptz;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_row
    FROM public.event_meeting_availability a
    WHERE a.id = v_id AND a.tenant_id = v_tenant;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'not_found: availability window does not exist in this tenant';
    END IF;

    v_event_id := v_row.event_id;
    v_registration_id := v_row.registration_id;
  ELSE
    IF v_registration_id IS NULL THEN
      RAISE EXCEPTION 'invalid_payload: registration_id is required for a new window';
    END IF;

    SELECT r.event_id INTO v_event_id
    FROM public.event_registrations r
    WHERE r.id = v_registration_id
      AND r.tenant_id = v_tenant
      AND r.status IN ('approved', 'attended');

    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'not_found: participating registration does not exist in this tenant';
    END IF;
  END IF;

  v_starts := COALESCE((NULLIF(p_payload->>'starts_at', ''))::timestamptz, v_row.starts_at);
  v_ends := COALESCE((NULLIF(p_payload->>'ends_at', ''))::timestamptz, v_row.ends_at);

  IF v_starts IS NULL OR v_ends IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: starts_at and ends_at are required';
  END IF;

  IF v_ends <= v_starts THEN
    RAISE EXCEPTION 'invalid_window: the window must end after it starts';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.event_meeting_availability (
      tenant_id, event_id, registration_id, starts_at, ends_at, is_open, note, created_by
    ) VALUES (
      v_tenant, v_event_id, v_registration_id, v_starts, v_ends,
      COALESCE((NULLIF(p_payload->>'is_open', ''))::boolean, true),
      NULLIF(btrim(COALESCE(p_payload->>'note', '')), ''),
      auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_meeting_availability SET
      starts_at = v_starts,
      ends_at = v_ends,
      is_open = COALESCE((NULLIF(p_payload->>'is_open', ''))::boolean, is_open),
      note = CASE
        WHEN p_payload ? 'note' THEN NULLIF(btrim(COALESCE(p_payload->>'note', '')), '')
        ELSE note
      END
    WHERE id = v_id AND tenant_id = v_tenant;
  END IF;

  RETURN v_id;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'availability_overlap: this window overlaps another window of the same person';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_availability_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_availability_set(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_availability_set(jsonb) IS
  'Okno dostepnosci wpisane przez organizatora - jedyna sciezka dla uczestnika BEZ KONTA. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_meeting_availability_delete(uuid);
CREATE FUNCTION public.admin_event_meeting_availability_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_row public.event_meeting_availability;
  v_blocking integer;
BEGIN
  SELECT * INTO v_row
  FROM public.event_meeting_availability a
  WHERE a.id = _id AND a.tenant_id = v_tenant;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: availability window does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_blocking
  FROM public.event_meeting_attendees a
  WHERE a.tenant_id = v_tenant
    AND a.registration_id = v_row.registration_id
    AND a.status IN ('invited', 'accepted', 'held', 'no_show')
    AND a.time_range && v_row.time_range;

  IF v_blocking > 0 THEN
    RAISE EXCEPTION 'availability_has_meetings: % meeting(s) sit inside this window', v_blocking;
  END IF;

  DELETE FROM public.event_meeting_availability
  WHERE id = _id AND tenant_id = v_tenant;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_availability_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_availability_delete(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_availability_delete(uuid) IS
  'Usuwa okno dostepnosci, w ktorym nie ma zadnego spotkania. W przeciwnym razie blad availability_has_meetings. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_meetings_list(jsonb);
CREATE FUNCTION public.admin_event_meetings_list(p_payload jsonb)
RETURNS TABLE (
  id uuid,
  status text,
  is_expired boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  expires_at timestamptz,
  requester_registration_id uuid,
  requester_first_name text,
  requester_last_name text,
  requester_job_title text,
  requester_company text,
  requester_group_name_pl text,
  requester_group_name_en text,
  invitee_registration_id uuid,
  invitee_first_name text,
  invitee_last_name text,
  invitee_job_title text,
  invitee_company text,
  invitee_group_name_pl text,
  invitee_group_name_en text,
  table_id uuid,
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
  cancelled_at timestamptz,
  attendance_marked_at timestamptz,
  rescheduled_from_id uuid,
  created_at timestamptz,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_status text := NULLIF(p_payload->>'status', '');
  v_table_id uuid := NULLIF(p_payload->>'table_id', '')::uuid;
  v_group_id uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_sponsor_id uuid := NULLIF(p_payload->>'sponsor_id', '')::uuid;
  v_day date := (NULLIF(p_payload->>'day', ''))::date;
  v_from timestamptz := (NULLIF(p_payload->>'from', ''))::timestamptz;
  v_to timestamptz := (NULLIF(p_payload->>'to', ''))::timestamptz;
  v_q text := NULLIF(btrim(COALESCE(p_payload->>'q', '')), '');
  v_limit integer := LEAST(GREATEST(COALESCE((NULLIF(p_payload->>'limit', ''))::integer, 25), 1), 200);
  v_offset integer := GREATEST(COALESCE((NULLIF(p_payload->>'offset', ''))::integer, 0), 0);
  v_timezone text;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  SELECT COALESCE(s.timezone, e.timezone, 'Europe/Warsaw') INTO v_timezone
  FROM public.events e
  LEFT JOIN public.event_meeting_settings s
    ON s.tenant_id = e.tenant_id AND s.event_id = e.id
  WHERE e.id = v_event_id AND e.tenant_id = v_tenant;

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  RETURN QUERY
  SELECT
    m.id, m.status,
    (m.status = 'invited' AND m.expires_at < now()),
    m.starts_at, m.ends_at, m.expires_at,
    m.requester_registration_id,
    rp.first_name, rp.last_name, rp.job_title,
    COALESCE(rc.name, rp.company_text),
    rg.name_pl, rg.name_en,
    m.invitee_registration_id,
    ip.first_name, ip.last_name, ip.job_title,
    COALESCE(ic.name, ip.company_text),
    ig.name_pl, ig.name_en,
    m.table_id, t.label, t.zone, m.table_seat,
    m.topic, m.sponsor_id, sp.snapshot_name,
    m.invitation_message, m.decline_reason, m.cancel_reason, m.cancelled_side,
    m.responded_at, m.cancelled_at, m.attendance_marked_at, m.rescheduled_from_id,
    m.created_at,
    count(*) OVER ()::integer
  FROM public.event_meetings m
  JOIN public.event_registrations rr
    ON rr.id = m.requester_registration_id AND rr.tenant_id = m.tenant_id
  JOIN public.event_people rp
    ON rp.id = rr.person_id AND rp.tenant_id = rr.tenant_id
  LEFT JOIN public.crm_companies rc
    ON rc.id = rp.company_id AND rc.tenant_id = rp.tenant_id
  LEFT JOIN public.event_groups rg
    ON rg.id = rr.group_id AND rg.tenant_id = rr.tenant_id
  JOIN public.event_registrations ir
    ON ir.id = m.invitee_registration_id AND ir.tenant_id = m.tenant_id
  JOIN public.event_people ip
    ON ip.id = ir.person_id AND ip.tenant_id = ir.tenant_id
  LEFT JOIN public.crm_companies ic
    ON ic.id = ip.company_id AND ic.tenant_id = ip.tenant_id
  LEFT JOIN public.event_groups ig
    ON ig.id = ir.group_id AND ig.tenant_id = ir.tenant_id
  LEFT JOIN public.event_meeting_tables t
    ON t.id = m.table_id AND t.tenant_id = m.tenant_id
  LEFT JOIN public.event_sponsors sp
    ON sp.id = m.sponsor_id AND sp.tenant_id = m.tenant_id
  WHERE m.tenant_id = v_tenant
    AND m.event_id = v_event_id
    AND (
      v_status IS NULL
      OR v_status = 'all'
      OR (v_status = 'expired' AND m.status = 'invited' AND m.expires_at < now())
      OR (v_status = 'pending' AND m.status = 'invited' AND m.expires_at >= now())
      OR m.status = v_status
    )
    AND (v_table_id IS NULL OR m.table_id = v_table_id)
    AND (v_sponsor_id IS NULL OR m.sponsor_id = v_sponsor_id)
    AND (v_group_id IS NULL OR rr.group_id = v_group_id OR ir.group_id = v_group_id)
    AND (v_day IS NULL OR (m.starts_at AT TIME ZONE v_timezone)::date = v_day)
    AND (v_from IS NULL OR m.starts_at >= v_from)
    AND (v_to IS NULL OR m.starts_at < v_to)
    AND (
      v_q IS NULL
      OR rp.full_name_norm LIKE '%' || lower(v_q) || '%'
      OR ip.full_name_norm LIKE '%' || lower(v_q) || '%'
      OR rp.company_text ILIKE '%' || v_q || '%'
      OR ip.company_text ILIKE '%' || v_q || '%'
      OR rc.name ILIKE '%' || v_q || '%'
      OR ic.name ILIKE '%' || v_q || '%'
      OR m.topic ILIKE '%' || v_q || '%'
    )
  ORDER BY m.starts_at DESC, m.created_at DESC, m.id DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meetings_list(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meetings_list(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meetings_list(jsonb) IS
  'Lista spotkan wydarzenia z filtrami (stan, stolik, grupa, sponsor, dzien w strefie gieldy, fraza), licznikiem calosci i liczonym stanem wygasniecia. Bez danych kontaktowych. Bramka: assert_editor_tenant().';