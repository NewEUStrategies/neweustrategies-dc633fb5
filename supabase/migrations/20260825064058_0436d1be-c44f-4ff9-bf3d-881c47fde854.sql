DROP FUNCTION IF EXISTS public.admin_event_meeting_stats(uuid);
CREATE FUNCTION public.admin_event_meeting_stats(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_timezone text;
  v_grid_slots integer;
  v_out jsonb;
BEGIN
  SELECT COALESCE(s.timezone, e.timezone, 'Europe/Warsaw') INTO v_timezone
  FROM public.events e
  LEFT JOIN public.event_meeting_settings s
    ON s.tenant_id = e.tenant_id AND s.event_id = e.id
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_grid_slots
  FROM public.event_meeting_settings s
  CROSS JOIN unnest(s.meeting_days) AS d(dd)
  CROSS JOIN generate_series(
    ((d.dd + s.day_start_time) AT TIME ZONE s.timezone),
    ((d.dd + s.day_end_time) AT TIME ZONE s.timezone) - make_interval(mins => s.slot_minutes),
    make_interval(mins => s.slot_minutes + s.break_minutes)
  ) AS g(slot_start)
  WHERE s.tenant_id = v_tenant AND s.event_id = p_event_id;

  SELECT jsonb_build_object(
    'total', count(*),
    'invited', count(*) FILTER (WHERE m.status = 'invited' AND m.expires_at >= now()),
    'expired', count(*) FILTER (WHERE m.status = 'invited' AND m.expires_at < now()),
    'accepted', count(*) FILTER (WHERE m.status = 'accepted'),
    'declined', count(*) FILTER (WHERE m.status = 'declined'),
    'cancelled', count(*) FILTER (WHERE m.status = 'cancelled'),
    'rescheduled', count(*) FILTER (WHERE m.status = 'rescheduled'),
    'held', count(*) FILTER (WHERE m.status = 'held'),
    'no_show', count(*) FILTER (WHERE m.status = 'no_show'),
    'confirmed', count(*) FILTER (WHERE m.status IN ('accepted', 'held', 'no_show')),
    'acceptance_rate', CASE
      WHEN count(*) FILTER (
        WHERE m.status IN ('accepted', 'held', 'no_show', 'declined')
      ) = 0 THEN NULL
      ELSE round(
        100.0 * count(*) FILTER (WHERE m.status IN ('accepted', 'held', 'no_show'))
        / count(*) FILTER (WHERE m.status IN ('accepted', 'held', 'no_show', 'declined'))
      )::integer
    END,
    'attendance_rate', CASE
      WHEN count(*) FILTER (WHERE m.status IN ('held', 'no_show')) = 0 THEN NULL
      ELSE round(
        100.0 * count(*) FILTER (WHERE m.status = 'held')
        / count(*) FILTER (WHERE m.status IN ('held', 'no_show'))
      )::integer
    END
  )
  INTO v_out
  FROM public.event_meetings m
  WHERE m.tenant_id = v_tenant AND m.event_id = p_event_id;

  v_out := COALESCE(v_out, '{}'::jsonb) || jsonb_build_object(
    'grid_slots', COALESCE(v_grid_slots, 0),
    'timezone', v_timezone,
    'seats_count', (
      SELECT COALESCE(sum(t.capacity), 0)::integer
      FROM public.event_meeting_tables t
      WHERE t.tenant_id = v_tenant AND t.event_id = p_event_id AND t.is_active
    ),
    'participants_count', (
      SELECT count(*)::integer FROM public.event_registrations r
      WHERE r.tenant_id = v_tenant AND r.event_id = p_event_id
        AND r.status IN ('approved', 'attended')
    ),
    'with_availability_count', (
      SELECT count(DISTINCT a.registration_id)::integer
      FROM public.event_meeting_availability a
      WHERE a.tenant_id = v_tenant AND a.event_id = p_event_id AND a.is_open
    ),
    'with_meeting_count', (
      SELECT count(DISTINCT a.registration_id)::integer
      FROM public.event_meeting_attendees a
      WHERE a.tenant_id = v_tenant AND a.event_id = p_event_id
        AND a.status IN ('accepted', 'held', 'no_show')
    )
  );

  v_out := v_out || jsonb_build_object(
    'without_meeting_count',
      GREATEST((v_out->>'participants_count')::integer - (v_out->>'with_meeting_count')::integer, 0),
    'without_availability_count',
      GREATEST(
        (v_out->>'participants_count')::integer - (v_out->>'with_availability_count')::integer,
        0
      )
  );

  v_out := v_out || jsonb_build_object('tables', COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'sort_order', x->>'label')
    FROM (
      SELECT jsonb_build_object(
        'table_id', t.id,
        'label', t.label,
        'zone', t.zone,
        'capacity', t.capacity,
        'sort_order', t.sort_order,
        'is_active', t.is_active,
        'slots_taken', COALESCE(u.cnt, 0),
        'slots_capacity', COALESCE(v_grid_slots, 0) * t.capacity,
        'utilisation_pct', CASE
          WHEN COALESCE(v_grid_slots, 0) = 0 THEN NULL
          ELSE round(100.0 * COALESCE(u.cnt, 0) / (v_grid_slots * t.capacity))::integer
        END
      ) AS x
      FROM public.event_meeting_tables t
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS cnt
        FROM public.event_meetings m
        WHERE m.tenant_id = t.tenant_id
          AND m.table_id = t.id
          AND m.status IN ('accepted', 'held', 'no_show')
      ) u ON true
      WHERE t.tenant_id = v_tenant AND t.event_id = p_event_id
    ) AS tables_agg
  ), '[]'::jsonb));

  v_out := v_out || jsonb_build_object('by_day', COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'day')
    FROM (
      SELECT jsonb_build_object(
        'day', (m.starts_at AT TIME ZONE v_timezone)::date,
        'confirmed', count(*) FILTER (WHERE m.status IN ('accepted', 'held', 'no_show')),
        'invited', count(*) FILTER (WHERE m.status = 'invited'),
        'total', count(*)
      ) AS x
      FROM public.event_meetings m
      WHERE m.tenant_id = v_tenant AND m.event_id = p_event_id
      GROUP BY (m.starts_at AT TIME ZONE v_timezone)::date
    ) AS days_agg
  ), '[]'::jsonb));

  v_out := v_out || jsonb_build_object('without_meeting', COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'last_name', x->>'first_name')
    FROM (
      SELECT jsonb_build_object(
        'registration_id', r.id,
        'first_name', p.first_name,
        'last_name', p.last_name,
        'job_title', p.job_title,
        'company', COALESCE(c.name, p.company_text),
        'has_availability', EXISTS (
          SELECT 1 FROM public.event_meeting_availability a
          WHERE a.tenant_id = r.tenant_id AND a.registration_id = r.id AND a.is_open
        )
      ) AS x
      FROM public.event_registrations r
      JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      LEFT JOIN public.crm_companies c ON c.id = p.company_id AND c.tenant_id = p.tenant_id
      WHERE r.tenant_id = v_tenant
        AND r.event_id = p_event_id
        AND r.status IN ('approved', 'attended')
        AND NOT EXISTS (
          SELECT 1 FROM public.event_meeting_attendees a
          WHERE a.tenant_id = r.tenant_id
            AND a.registration_id = r.id
            AND a.status IN ('accepted', 'held', 'no_show')
        )
      ORDER BY p.last_name, p.first_name, r.id
      LIMIT 50
    ) AS lonely
  ), '[]'::jsonb));

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_stats(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_stats(uuid) IS
  'Statystyki gieldy: liczniki stanow, wskaznik akceptacji i frekwencji, obciazenie stolikow wzgledem siatki, rozklad po dniach oraz LISTA uczestnikow bez ani jednego spotkania. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_meeting_set_status(jsonb);
CREATE FUNCTION public.admin_event_meeting_set_status(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_meeting_id uuid := NULLIF(p_payload->>'meeting_id', '')::uuid;
  v_status text := NULLIF(p_payload->>'status', '');
  v_reason text := NULLIF(btrim(COALESCE(p_payload->>'reason', '')), '');
  v_row public.event_meetings;
BEGIN
  IF v_meeting_id IS NULL OR v_status IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: meeting_id and status are required';
  END IF;

  IF v_status NOT IN ('held', 'no_show', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status: the organiser may set held, no_show or cancelled';
  END IF;

  SELECT * INTO v_row
  FROM public.event_meetings m
  WHERE m.id = v_meeting_id AND m.tenant_id = v_tenant
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: meeting does not exist in this tenant';
  END IF;

  IF v_status IN ('held', 'no_show') THEN
    IF v_row.status NOT IN ('accepted', 'held', 'no_show') THEN
      RAISE EXCEPTION 'attendance_needs_accepted: attendance can only be marked on an accepted meeting';
    END IF;

    UPDATE public.event_meetings
    SET status = v_status,
        attendance_marked_at = now(),
        attendance_marked_by = auth.uid()
    WHERE id = v_meeting_id AND tenant_id = v_tenant;
  ELSE
    IF v_row.status NOT IN ('invited', 'accepted') THEN
      RAISE EXCEPTION 'meeting_not_active: only an open invitation or an accepted meeting can be cancelled';
    END IF;

    UPDATE public.event_meetings
    SET status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancelled_side = 'organiser',
        cancel_reason = v_reason
    WHERE id = v_meeting_id AND tenant_id = v_tenant;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_meeting',
    v_meeting_id::text,
    'event_meeting.' || v_status || '.v1',
    jsonb_build_object(
      'event_id', v_row.event_id,
      'meeting_id', v_meeting_id,
      'by', 'organiser',
      'starts_at', v_row.starts_at
    ),
    auth.uid()
  );

  RETURN jsonb_build_object('meeting_id', v_meeting_id, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_set_status(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_set_status(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_set_status(jsonb) IS
  'Organizator oznacza frekwencje (held / no_show) albo odwoluje spotkanie (cancelled). Frekwencje wolno nadac wylacznie spotkaniu przyjetemu. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_meeting_free_slots(jsonb);
CREATE FUNCTION public.admin_event_meeting_free_slots(p_payload jsonb)
RETURNS TABLE (
  starts_at timestamptz,
  ends_at timestamptz,
  table_id uuid,
  table_label text,
  table_zone text,
  table_seat integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_a uuid := NULLIF(p_payload->>'a_registration_id', '')::uuid;
  v_b uuid := NULLIF(p_payload->>'b_registration_id', '')::uuid;
BEGIN
  IF v_event_id IS NULL OR v_a IS NULL OR v_b IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id, a_registration_id and b_registration_id are required';
  END IF;

  IF v_a = v_b THEN
    RAISE EXCEPTION 'self_invite: a person cannot meet themselves';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  RETURN QUERY
  SELECT f.starts_at, f.ends_at, f.table_id, f.table_label, f.table_zone, f.table_seat
  FROM public._event_meeting_free_slots(
    v_tenant, v_event_id, v_a, v_b,
    (NULLIF(p_payload->>'from', ''))::timestamptz,
    (NULLIF(p_payload->>'to', ''))::timestamptz,
    (NULLIF(p_payload->>'limit', ''))::integer
  ) f;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_free_slots(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_free_slots(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_free_slots(jsonb) IS
  'Wolne terminy dla wskazanej pary uczestnikow - widok organizatora nad tym samym rdzeniem co event_meeting_free_slots. Bramka: assert_editor_tenant().';