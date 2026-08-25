DROP FUNCTION IF EXISTS public.admin_event_meeting_tables_list(uuid);
CREATE FUNCTION public.admin_event_meeting_tables_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  label text,
  zone text,
  capacity integer,
  room_id uuid,
  room_name text,
  note text,
  is_active boolean,
  sort_order integer,
  meetings_count integer,
  minutes_taken integer,
  next_meeting_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    t.id, t.label, t.zone, t.capacity, t.room_id, r.name, t.note,
    t.is_active, t.sort_order,
    COALESCE(u.cnt, 0)::integer,
    COALESCE(u.minutes, 0)::integer,
    u.next_at,
    t.created_at, t.updated_at
  FROM public.event_meeting_tables t
  LEFT JOIN public.event_rooms r
    ON r.id = t.room_id AND r.tenant_id = t.tenant_id
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS cnt,
      COALESCE(sum(EXTRACT(EPOCH FROM (m.ends_at - m.starts_at)) / 60), 0)::integer AS minutes,
      min(m.starts_at) FILTER (WHERE m.starts_at > now()) AS next_at
    FROM public.event_meetings m
    WHERE m.tenant_id = t.tenant_id
      AND m.table_id = t.id
      AND m.status IN ('accepted', 'held', 'no_show')
  ) u ON true
  WHERE t.tenant_id = v_tenant
    AND t.event_id = p_event_id
  ORDER BY t.sort_order, t.label, t.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_tables_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_tables_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_tables_list(uuid) IS
  'Stoliki wydarzenia z obciazeniem (liczba zajetych spotkan, minuty, najblizszy termin). Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_meeting_table_save(jsonb);
CREATE FUNCTION public.admin_event_meeting_table_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_row public.event_meeting_tables;
  v_label text;
  v_capacity integer;
  v_max_seat integer;
  v_sort integer;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_row
    FROM public.event_meeting_tables t
    WHERE t.id = v_id AND t.tenant_id = v_tenant;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'not_found: meeting table does not exist in this tenant';
    END IF;

    v_event_id := v_row.event_id;
  ELSE
    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'invalid_payload: event_id is required for a new table';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = v_event_id AND e.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'not_found: event does not exist in this tenant';
    END IF;
  END IF;

  v_label := COALESCE(
    NULLIF(btrim(COALESCE(p_payload->>'label', '')), ''),
    v_row.label
  );

  IF v_label IS NULL OR char_length(v_label) < 1 THEN
    RAISE EXCEPTION 'invalid_label: the table label is required';
  END IF;

  v_capacity := COALESCE(
    (NULLIF(p_payload->>'capacity', ''))::integer,
    v_row.capacity,
    1
  );

  IF v_capacity < 1 OR v_capacity > 50 THEN
    RAISE EXCEPTION 'invalid_capacity: capacity must be between 1 and 50';
  END IF;

  IF v_id IS NOT NULL AND v_capacity < v_row.capacity THEN
    SELECT max(m.table_seat) INTO v_max_seat
    FROM public.event_meetings m
    WHERE m.tenant_id = v_tenant
      AND m.table_id = v_id
      AND m.status IN ('accepted', 'held', 'no_show');

    IF v_max_seat IS NOT NULL AND v_max_seat > v_capacity THEN
      RAISE EXCEPTION 'table_capacity_in_use: seat % is taken, capacity cannot drop below it',
        v_max_seat;
    END IF;
  END IF;

  v_sort := COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, v_row.sort_order);
  IF v_sort IS NULL THEN
    SELECT COALESCE(max(t.sort_order), 0) + 10 INTO v_sort
    FROM public.event_meeting_tables t
    WHERE t.tenant_id = v_tenant AND t.event_id = v_event_id;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.event_meeting_tables (
      tenant_id, event_id, label, zone, capacity, room_id, note,
      is_active, sort_order, created_by
    ) VALUES (
      v_tenant, v_event_id, v_label,
      NULLIF(btrim(COALESCE(p_payload->>'zone', '')), ''),
      v_capacity,
      NULLIF(p_payload->>'room_id', '')::uuid,
      NULLIF(btrim(COALESCE(p_payload->>'note', '')), ''),
      COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true),
      v_sort,
      auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_meeting_tables SET
      label = v_label,
      zone = CASE
        WHEN p_payload ? 'zone' THEN NULLIF(btrim(COALESCE(p_payload->>'zone', '')), '')
        ELSE zone
      END,
      capacity = v_capacity,
      room_id = CASE
        WHEN p_payload ? 'room_id' THEN NULLIF(p_payload->>'room_id', '')::uuid
        ELSE room_id
      END,
      note = CASE
        WHEN p_payload ? 'note' THEN NULLIF(btrim(COALESCE(p_payload->>'note', '')), '')
        ELSE note
      END,
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, is_active),
      sort_order = v_sort
    WHERE id = v_id AND tenant_id = v_tenant;
  END IF;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'table_label_taken: a table with this label already exists in this event';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_table_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_table_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_table_save(jsonb) IS
  'Dodanie albo edycja stolika. Wydarzenie stolika jest niezmienne; obnizenie pojemnosci ponizej zajetego miejsca jest odrzucane. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_meeting_table_delete(uuid);
CREATE FUNCTION public.admin_event_meeting_table_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_used integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_meeting_tables t
    WHERE t.id = _id AND t.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: meeting table does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.event_meetings m
  WHERE m.tenant_id = v_tenant AND m.table_id = _id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'table_in_use: % meeting(s) still reference this table', v_used;
  END IF;

  DELETE FROM public.event_meeting_tables
  WHERE id = _id AND tenant_id = v_tenant;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_table_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_table_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_table_delete(uuid) IS
  'Usuwa stolik, ktorego nie uzywa zadne spotkanie. W przeciwnym razie blad table_in_use - sciezka wlasciwa to wylaczenie stolika. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_meeting_settings_get(uuid);
CREATE FUNCTION public.admin_event_meeting_settings_get(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_settings public.event_meeting_settings;
  v_event public.events;
  v_out jsonb;
BEGIN
  SELECT * INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  SELECT * INTO v_settings
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = p_event_id;

  v_out := jsonb_build_object(
    'configured', v_settings.id IS NOT NULL,
    'event_id', p_event_id,
    'event_timezone', v_event.timezone,
    'is_enabled', COALESCE(v_settings.is_enabled, false),
    'slot_minutes', COALESCE(v_settings.slot_minutes, 20),
    'break_minutes', COALESCE(v_settings.break_minutes, 5),
    'day_start_time', COALESCE(v_settings.day_start_time, '09:00'::time),
    'day_end_time', COALESCE(v_settings.day_end_time, '17:00'::time),
    'meeting_days', COALESCE(to_jsonb(v_settings.meeting_days), '[]'::jsonb),
    'timezone', COALESCE(v_settings.timezone, v_event.timezone, 'Europe/Warsaw'),
    'invites_open_at', v_settings.invites_open_at,
    'invites_close_at', v_settings.invites_close_at,
    'max_invites_per_person', v_settings.max_invites_per_person,
    'max_meetings_per_day', v_settings.max_meetings_per_day,
    'invite_expires_after_hours', COALESCE(v_settings.invite_expires_after_hours, 72),
    'visibility', COALESCE(v_settings.visibility, 'everyone'),
    'intro_pl', COALESCE(v_settings.intro_pl, ''),
    'intro_en', COALESCE(v_settings.intro_en, ''),
    'updated_at', v_settings.updated_at
  );

  v_out := v_out || jsonb_build_object(
    'requester_groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'group_id', g.id, 'key', g.key, 'name_pl', g.name_pl, 'name_en', g.name_en,
        'can_meet', g.can_meet, 'can_lead_retrieval', g.can_lead_retrieval
      ) ORDER BY g.sort_order, g.key)
      FROM public.event_meeting_rule_groups rg
      JOIN public.event_groups g
        ON g.id = rg.group_id AND g.tenant_id = rg.tenant_id
      WHERE rg.tenant_id = v_tenant AND rg.event_id = p_event_id AND rg.side = 'requester'
    ), '[]'::jsonb),
    'invitee_groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'group_id', g.id, 'key', g.key, 'name_pl', g.name_pl, 'name_en', g.name_en,
        'can_meet', g.can_meet, 'can_lead_retrieval', g.can_lead_retrieval
      ) ORDER BY g.sort_order, g.key)
      FROM public.event_meeting_rule_groups rg
      JOIN public.event_groups g
        ON g.id = rg.group_id AND g.tenant_id = rg.tenant_id
      WHERE rg.tenant_id = v_tenant AND rg.event_id = p_event_id AND rg.side = 'invitee'
    ), '[]'::jsonb),
    'available_groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'group_id', g.id, 'key', g.key, 'name_pl', g.name_pl, 'name_en', g.name_en,
        'can_meet', g.can_meet, 'can_lead_retrieval', g.can_lead_retrieval
      ) ORDER BY g.sort_order, g.key)
      FROM public.event_groups g
      WHERE g.tenant_id = v_tenant AND g.event_id = p_event_id
    ), '[]'::jsonb)
  );

  v_out := v_out || (
    SELECT jsonb_build_object(
      'tables_count', (
        SELECT count(*)::integer FROM public.event_meeting_tables t
        WHERE t.tenant_id = v_tenant AND t.event_id = p_event_id AND t.is_active
      ),
      'seats_count', (
        SELECT COALESCE(sum(t.capacity), 0)::integer FROM public.event_meeting_tables t
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
      )
    )
  );

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_settings_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_settings_get(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_settings_get(uuid) IS
  'Konfiguracja gieldy jednym wywolaniem: siatka, limity, regula z nazwami grup, katalog grup do wyboru i cztery liczby gotowosci. Brak wiersza zwraca configured=false i domysly. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_meeting_settings_save(jsonb);
CREATE FUNCTION public.admin_event_meeting_settings_save(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_row public.event_meeting_settings;
  v_timezone text;
  v_visibility text;
  v_days date[];
  v_requester uuid[];
  v_invitee uuid[];
  v_id uuid;
  v_bad uuid;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  SELECT * INTO v_row
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id;

  v_timezone := COALESCE(
    NULLIF(btrim(COALESCE(p_payload->>'timezone', '')), ''),
    v_row.timezone,
    (SELECT e.timezone FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant),
    'Europe/Warsaw'
  );

  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_timezone) THEN
    RAISE EXCEPTION 'invalid_timezone: % is not a known time zone', v_timezone;
  END IF;

  v_visibility := COALESCE(
    NULLIF(p_payload->>'visibility', ''),
    v_row.visibility,
    'everyone'
  );

  IF v_visibility NOT IN ('everyone', 'groups', 'sponsors_to_attendees', 'disabled') THEN
    RAISE EXCEPTION 'invalid_visibility: unknown exchange visibility rule';
  END IF;

  IF p_payload ? 'meeting_days' THEN
    IF jsonb_typeof(p_payload->'meeting_days') <> 'array' THEN
      RAISE EXCEPTION 'invalid_meeting_days: meeting_days must be a JSON array of dates';
    END IF;
    SELECT array_agg(DISTINCT (d.value #>> '{}')::date ORDER BY (d.value #>> '{}')::date)
      INTO v_days
    FROM jsonb_array_elements(p_payload->'meeting_days') AS d(value);
    v_days := COALESCE(v_days, '{}'::date[]);
  ELSE
    v_days := COALESCE(v_row.meeting_days, '{}'::date[]);
  END IF;

  IF v_visibility = 'groups' THEN
    IF p_payload ? 'requester_group_ids' THEN
      SELECT array_agg(DISTINCT (g.value #>> '{}')::uuid) INTO v_requester
      FROM jsonb_array_elements(COALESCE(p_payload->'requester_group_ids', '[]'::jsonb)) AS g(value);
    ELSE
      SELECT array_agg(rg.group_id) INTO v_requester
      FROM public.event_meeting_rule_groups rg
      WHERE rg.tenant_id = v_tenant AND rg.event_id = v_event_id AND rg.side = 'requester';
    END IF;

    IF p_payload ? 'invitee_group_ids' THEN
      SELECT array_agg(DISTINCT (g.value #>> '{}')::uuid) INTO v_invitee
      FROM jsonb_array_elements(COALESCE(p_payload->'invitee_group_ids', '[]'::jsonb)) AS g(value);
    ELSE
      SELECT array_agg(rg.group_id) INTO v_invitee
      FROM public.event_meeting_rule_groups rg
      WHERE rg.tenant_id = v_tenant AND rg.event_id = v_event_id AND rg.side = 'invitee';
    END IF;

    IF COALESCE(cardinality(v_requester), 0) = 0 OR COALESCE(cardinality(v_invitee), 0) = 0 THEN
      RAISE EXCEPTION 'rule_groups_required: rule `groups` needs at least one group on each side';
    END IF;
  ELSE
    IF p_payload ? 'requester_group_ids' THEN
      SELECT array_agg(DISTINCT (g.value #>> '{}')::uuid) INTO v_requester
      FROM jsonb_array_elements(COALESCE(p_payload->'requester_group_ids', '[]'::jsonb)) AS g(value);
      v_requester := COALESCE(v_requester, '{}'::uuid[]);
    END IF;
    IF p_payload ? 'invitee_group_ids' THEN
      SELECT array_agg(DISTINCT (g.value #>> '{}')::uuid) INTO v_invitee
      FROM jsonb_array_elements(COALESCE(p_payload->'invitee_group_ids', '[]'::jsonb)) AS g(value);
      v_invitee := COALESCE(v_invitee, '{}'::uuid[]);
    END IF;
  END IF;

  INSERT INTO public.event_meeting_settings AS s (
    tenant_id, event_id, is_enabled, slot_minutes, break_minutes,
    day_start_time, day_end_time, meeting_days, timezone,
    invites_open_at, invites_close_at,
    max_invites_per_person, max_meetings_per_day, invite_expires_after_hours,
    visibility, intro_pl, intro_en, updated_by
  ) VALUES (
    v_tenant, v_event_id,
    COALESCE((NULLIF(p_payload->>'is_enabled', ''))::boolean, false),
    COALESCE((NULLIF(p_payload->>'slot_minutes', ''))::integer, 20),
    COALESCE((NULLIF(p_payload->>'break_minutes', ''))::integer, 5),
    COALESCE((NULLIF(p_payload->>'day_start_time', ''))::time, '09:00'::time),
    COALESCE((NULLIF(p_payload->>'day_end_time', ''))::time, '17:00'::time),
    v_days,
    v_timezone,
    (NULLIF(p_payload->>'invites_open_at', ''))::timestamptz,
    (NULLIF(p_payload->>'invites_close_at', ''))::timestamptz,
    (NULLIF(p_payload->>'max_invites_per_person', ''))::integer,
    (NULLIF(p_payload->>'max_meetings_per_day', ''))::integer,
    COALESCE((NULLIF(p_payload->>'invite_expires_after_hours', ''))::integer, 72),
    v_visibility,
    COALESCE(btrim(p_payload->>'intro_pl'), ''),
    COALESCE(btrim(p_payload->>'intro_en'), ''),
    auth.uid()
  )
  ON CONFLICT (tenant_id, event_id) DO UPDATE
  SET is_enabled = COALESCE((NULLIF(p_payload->>'is_enabled', ''))::boolean, s.is_enabled),
      slot_minutes = COALESCE((NULLIF(p_payload->>'slot_minutes', ''))::integer, s.slot_minutes),
      break_minutes = COALESCE((NULLIF(p_payload->>'break_minutes', ''))::integer, s.break_minutes),
      day_start_time = COALESCE((NULLIF(p_payload->>'day_start_time', ''))::time, s.day_start_time),
      day_end_time = COALESCE((NULLIF(p_payload->>'day_end_time', ''))::time, s.day_end_time),
      meeting_days = v_days,
      timezone = v_timezone,
      invites_open_at = CASE
        WHEN p_payload ? 'invites_open_at'
          THEN (NULLIF(p_payload->>'invites_open_at', ''))::timestamptz
        ELSE s.invites_open_at
      END,
      invites_close_at = CASE
        WHEN p_payload ? 'invites_close_at'
          THEN (NULLIF(p_payload->>'invites_close_at', ''))::timestamptz
        ELSE s.invites_close_at
      END,
      max_invites_per_person = CASE
        WHEN p_payload ? 'max_invites_per_person'
          THEN (NULLIF(p_payload->>'max_invites_per_person', ''))::integer
        ELSE s.max_invites_per_person
      END,
      max_meetings_per_day = CASE
        WHEN p_payload ? 'max_meetings_per_day'
          THEN (NULLIF(p_payload->>'max_meetings_per_day', ''))::integer
        ELSE s.max_meetings_per_day
      END,
      invite_expires_after_hours = COALESCE(
        (NULLIF(p_payload->>'invite_expires_after_hours', ''))::integer,
        s.invite_expires_after_hours
      ),
      visibility = v_visibility,
      intro_pl = COALESCE(btrim(p_payload->>'intro_pl'), s.intro_pl),
      intro_en = COALESCE(btrim(p_payload->>'intro_en'), s.intro_en),
      updated_by = auth.uid()
  RETURNING s.id INTO v_id;

  IF v_requester IS NOT NULL THEN
    SELECT x.gid INTO v_bad
    FROM unnest(v_requester) AS x(gid)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.event_groups g
      WHERE g.id = x.gid AND g.tenant_id = v_tenant AND g.event_id = v_event_id
    )
    LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'group_not_found: group % does not belong to this event', v_bad;
    END IF;

    DELETE FROM public.event_meeting_rule_groups rg
    WHERE rg.tenant_id = v_tenant AND rg.event_id = v_event_id AND rg.side = 'requester'
      AND NOT (rg.group_id = ANY (v_requester));

    INSERT INTO public.event_meeting_rule_groups (tenant_id, event_id, group_id, side)
    SELECT v_tenant, v_event_id, x.gid, 'requester'
    FROM unnest(v_requester) AS x(gid)
    ON CONFLICT (tenant_id, event_id, group_id, side) DO NOTHING;
  END IF;

  IF v_invitee IS NOT NULL THEN
    SELECT x.gid INTO v_bad
    FROM unnest(v_invitee) AS x(gid)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.event_groups g
      WHERE g.id = x.gid AND g.tenant_id = v_tenant AND g.event_id = v_event_id
    )
    LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'group_not_found: group % does not belong to this event', v_bad;
    END IF;

    DELETE FROM public.event_meeting_rule_groups rg
    WHERE rg.tenant_id = v_tenant AND rg.event_id = v_event_id AND rg.side = 'invitee'
      AND NOT (rg.group_id = ANY (v_invitee));

    INSERT INTO public.event_meeting_rule_groups (tenant_id, event_id, group_id, side)
    SELECT v_tenant, v_event_id, x.gid, 'invitee'
    FROM unnest(v_invitee) AS x(gid)
    ON CONFLICT (tenant_id, event_id, group_id, side) DO NOTHING;
  END IF;

  RETURN public.admin_event_meeting_settings_get(v_event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_settings_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_settings_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_settings_save(jsonb) IS
  'Zapis konfiguracji gieldy JEDNYM wywolaniem: siatka, okno otwarcia, limity, regula i obie listy grup. Zwraca stan po zapisie (ten sam ksztalt co admin_event_meeting_settings_get). Bramka: assert_editor_tenant().';