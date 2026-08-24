DROP FUNCTION IF EXISTS public.admin_event_checkpoints_list(uuid);
CREATE OR REPLACE FUNCTION public.admin_event_checkpoints_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  name_pl text,
  name_en text,
  kind text,
  session_id uuid,
  session_title_pl text,
  session_title_en text,
  room_id uuid,
  room_name text,
  sponsor_id uuid,
  sponsor_name text,
  direction_mode text,
  access_mode text,
  capacity integer,
  dedupe_window_seconds integer,
  is_active boolean,
  sort_order integer,
  granted_count integer,
  denied_count integer,
  repeat_count integer,
  occupancy integer,
  device_count integer,
  last_checkin_at timestamptz,
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
    cp.id, cp.event_id, cp.name_pl, cp.name_en, cp.kind,
    cp.session_id, s.title_pl, s.title_en,
    cp.room_id, r.name,
    cp.sponsor_id, sp.snapshot_name,
    cp.direction_mode, cp.access_mode, cp.capacity, cp.dedupe_window_seconds,
    cp.is_active, cp.sort_order,
    COALESCE(agg.granted, 0)::integer,
    COALESCE(agg.denied, 0)::integer,
    COALESCE(agg.repeats, 0)::integer,
    public._event_checkpoint_occupancy(v_tenant, cp.id),
    COALESCE(dev.cnt, 0)::integer,
    agg.last_at,
    cp.created_at, cp.updated_at
  FROM public.event_checkpoints cp
  LEFT JOIN public.event_sessions s
    ON s.tenant_id = cp.tenant_id AND s.id = cp.session_id
  LEFT JOIN public.event_rooms r
    ON r.tenant_id = cp.tenant_id AND r.id = cp.room_id
  LEFT JOIN public.event_sponsors sp
    ON sp.tenant_id = cp.tenant_id AND sp.id = cp.sponsor_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE c.result = 'granted')::integer AS granted,
      count(*) FILTER (WHERE c.result <> 'granted')::integer AS denied,
      COALESCE(sum(c.repeat_count), 0)::integer AS repeats,
      max(c.occurred_at) AS last_at
    FROM public.event_checkins c
    WHERE c.tenant_id = cp.tenant_id AND c.checkpoint_id = cp.id
  ) agg ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_scanner_devices d
    WHERE d.tenant_id = cp.tenant_id
      AND d.checkpoint_id = cp.id
      AND d.revoked_at IS NULL
  ) dev ON true
  WHERE cp.tenant_id = v_tenant
    AND cp.event_id = p_event_id
  ORDER BY cp.sort_order, cp.name_pl;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkpoints_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkpoints_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkpoints_list(uuid) IS
  'Punkty odprawy wydarzenia z licznikami zgod, odmow, powtorzen i aktualna obecnoscia. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_checkpoint_save(jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_checkpoint_save(p_payload jsonb)
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
  v_name_pl text := btrim(COALESCE(p_payload->>'name_pl', ''));
  v_name_en text := btrim(COALESCE(p_payload->>'name_en', ''));
  v_kind text := lower(btrim(COALESCE(p_payload->>'kind', 'event_entry')));
  v_session_id uuid := NULLIF(p_payload->>'session_id', '')::uuid;
  v_room_id uuid := NULLIF(p_payload->>'room_id', '')::uuid;
  v_sponsor_id uuid := NULLIF(p_payload->>'sponsor_id', '')::uuid;
  v_existing public.event_checkpoints;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT cp.* INTO v_existing
    FROM public.event_checkpoints cp
    WHERE cp.id = v_id AND cp.tenant_id = v_tenant;

    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION 'not_found: checkpoint does not exist in this organisation';
    END IF;
    v_event_id := v_existing.event_id;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  IF v_name_pl = '' OR v_name_en = '' THEN
    RAISE EXCEPTION 'invalid_names: the name is required in both languages';
  END IF;

  IF v_kind NOT IN (
    'event_entry', 'session', 'room', 'zone', 'catering', 'cloakroom', 'company_booth'
  ) THEN
    RAISE EXCEPTION 'invalid_kind: unknown checkpoint kind %', v_kind;
  END IF;

  IF v_kind <> 'session' THEN v_session_id := NULL; END IF;
  IF v_kind <> 'company_booth' THEN v_sponsor_id := NULL; END IF;

  IF v_kind = 'session' AND v_session_id IS NULL THEN
    RAISE EXCEPTION 'session_required: a session checkpoint must point at a session';
  END IF;
  IF v_kind = 'company_booth' AND v_sponsor_id IS NULL THEN
    RAISE EXCEPTION 'sponsor_required: a booth checkpoint must point at a sponsor';
  END IF;

  IF v_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_sessions s
    WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id AND s.id = v_session_id
  ) THEN
    RAISE EXCEPTION 'session_not_in_event: the session belongs to another event';
  END IF;

  IF v_room_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_rooms r
    WHERE r.tenant_id = v_tenant AND r.event_id = v_event_id AND r.id = v_room_id
  ) THEN
    RAISE EXCEPTION 'room_not_in_event: the room belongs to another event';
  END IF;

  IF v_sponsor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_sponsors sp
    WHERE sp.tenant_id = v_tenant AND sp.event_id = v_event_id AND sp.id = v_sponsor_id
  ) THEN
    RAISE EXCEPTION 'sponsor_not_in_event: the sponsor belongs to another event';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.event_checkpoints (
      tenant_id, event_id, name_pl, name_en, kind, session_id, room_id, sponsor_id,
      direction_mode, access_mode, capacity, dedupe_window_seconds,
      is_active, sort_order, created_by
    ) VALUES (
      v_tenant, v_event_id, v_name_pl, v_name_en, v_kind, v_session_id, v_room_id, v_sponsor_id,
      COALESCE(NULLIF(p_payload->>'direction_mode', ''), 'in_only'),
      COALESCE(NULLIF(p_payload->>'access_mode', ''), 'control'),
      NULLIF(p_payload->>'capacity', '')::integer,
      COALESCE(NULLIF(p_payload->>'dedupe_window_seconds', '')::integer, 60),
      COALESCE(NULLIF(p_payload->>'is_active', '')::boolean, true),
      COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, 100),
      auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_checkpoints SET
      name_pl = v_name_pl,
      name_en = v_name_en,
      kind = v_kind,
      session_id = v_session_id,
      room_id = v_room_id,
      sponsor_id = v_sponsor_id,
      direction_mode = COALESCE(NULLIF(p_payload->>'direction_mode', ''), direction_mode),
      access_mode = COALESCE(NULLIF(p_payload->>'access_mode', ''), access_mode),
      capacity = CASE
        WHEN p_payload ? 'capacity' THEN NULLIF(p_payload->>'capacity', '')::integer
        ELSE capacity
      END,
      dedupe_window_seconds = COALESCE(
        NULLIF(p_payload->>'dedupe_window_seconds', '')::integer, dedupe_window_seconds
      ),
      is_active = COALESCE(NULLIF(p_payload->>'is_active', '')::boolean, is_active),
      sort_order = COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, sort_order)
    WHERE id = v_id AND tenant_id = v_tenant;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkpoint_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkpoint_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkpoint_save(jsonb) IS
  'Dodanie albo edycja punktu odprawy. Payload jsonb (id, event_id, name_pl, name_en, kind, session_id, room_id, sponsor_id, direction_mode, access_mode, capacity, dedupe_window_seconds, is_active, sort_order). Wiazania spoza rodzaju sa czyszczone, nie odrzucane. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_checkpoint_delete(uuid);
CREATE OR REPLACE FUNCTION public.admin_event_checkpoint_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_used integer;
  v_devices integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_checkpoints cp
    WHERE cp.id = _id AND cp.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: checkpoint does not exist in this organisation';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.event_checkins c
  WHERE c.tenant_id = v_tenant AND c.checkpoint_id = _id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'checkpoint_in_use: % check-in(s) recorded at this checkpoint - deactivate it instead', v_used;
  END IF;

  SELECT count(*)::integer INTO v_devices
  FROM public.event_scanner_devices d
  WHERE d.tenant_id = v_tenant AND d.checkpoint_id = _id AND d.revoked_at IS NULL;

  IF v_devices > 0 THEN
    RAISE EXCEPTION 'checkpoint_has_devices: % scanner credential(s) still point at this checkpoint', v_devices;
  END IF;

  DELETE FROM public.event_checkpoints WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkpoint_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkpoint_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkpoint_delete(uuid) IS
  'Usuniecie punktu odprawy. Odrzucane, gdy punkt ma choc jedna odprawe w dzienniku albo zyjace poswiadczenie urzadzenia - w obu razach wlasciwa operacja jest wylaczenie. Bramka: assert_editor_tenant().';