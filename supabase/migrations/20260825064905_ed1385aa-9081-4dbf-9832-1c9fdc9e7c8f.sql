DROP FUNCTION IF EXISTS public.event_meeting_availability_set(jsonb);
CREATE FUNCTION public.event_meeting_availability_set(p_payload jsonb)
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
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_me uuid;
  v_row public.event_meeting_availability;
  v_starts timestamptz := (NULLIF(p_payload->>'starts_at', ''))::timestamptz;
  v_ends timestamptz := (NULLIF(p_payload->>'ends_at', ''))::timestamptz;
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
    RAISE EXCEPTION 'not_registered: only a participant of this event can declare availability';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_meeting_settings s
    WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id AND s.is_enabled
  ) THEN
    RAISE EXCEPTION 'meetings_disabled: the meeting exchange is not enabled for this event';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_row
    FROM public.event_meeting_availability a
    WHERE a.id = v_id AND a.tenant_id = v_tenant AND a.registration_id = v_me;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'not_found: this availability window is not yours';
    END IF;
  END IF;

  v_starts := COALESCE(v_starts, v_row.starts_at);
  v_ends := COALESCE(v_ends, v_row.ends_at);

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
      v_tenant, v_event_id, v_me, v_starts, v_ends,
      COALESCE((NULLIF(p_payload->>'is_open', ''))::boolean, true),
      NULLIF(btrim(COALESCE(p_payload->>'note', '')), ''),
      v_uid
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
    WHERE id = v_id AND tenant_id = v_tenant AND registration_id = v_me;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'starts_at', v_starts,
    'ends_at', v_ends
  );
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'availability_overlap: this window overlaps another window you already declared';
  WHEN check_violation THEN
    RAISE EXCEPTION 'invalid_window: the window must last between 15 minutes and 16 hours';
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_availability_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_availability_set(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_availability_set(jsonb) IS
  'Uczestnik deklaruje albo poprawia WLASNE okno dostepnosci. Identyfikator zapisu ustalany z konta, nie z payloadu. Plaszczyzna tresci (public_tenant_id).';

DROP FUNCTION IF EXISTS public.event_meeting_availability_delete(jsonb);
CREATE FUNCTION public.event_meeting_availability_delete(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_row public.event_meeting_availability;
  v_me uuid;
  v_blocking integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL OR v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: id is required';
  END IF;

  SELECT * INTO v_row
  FROM public.event_meeting_availability a
  WHERE a.id = v_id AND a.tenant_id = v_tenant;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: availability window does not exist';
  END IF;

  v_me := public._event_meeting_caller_registration(v_tenant, v_row.event_id);

  IF v_me IS NULL OR v_me <> v_row.registration_id THEN
    RAISE EXCEPTION 'not_found: this availability window is not yours';
  END IF;

  SELECT count(*)::integer INTO v_blocking
  FROM public.event_meeting_attendees a
  WHERE a.tenant_id = v_tenant
    AND a.registration_id = v_me
    AND a.status IN ('invited', 'accepted', 'held', 'no_show')
    AND a.time_range && v_row.time_range;

  IF v_blocking > 0 THEN
    RAISE EXCEPTION 'availability_has_meetings: % meeting(s) sit inside this window', v_blocking;
  END IF;

  DELETE FROM public.event_meeting_availability
  WHERE id = v_id AND tenant_id = v_tenant AND registration_id = v_me;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_availability_delete(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_availability_delete(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_availability_delete(jsonb) IS
  'Uczestnik usuwa WLASNE okno dostepnosci, w ktorym nie ma zadnego spotkania. Plaszczyzna tresci (public_tenant_id).';

DROP FUNCTION IF EXISTS public.event_meeting_free_slots(jsonb);
CREATE FUNCTION public.event_meeting_free_slots(p_payload jsonb)
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
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug', '')), '');
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_other uuid := NULLIF(p_payload->>'counterpart_registration_id', '')::uuid;
  v_me uuid;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL OR v_other IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: counterpart_registration_id is required';
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
    RAISE EXCEPTION 'not_registered: only a participant of this event can use the meeting exchange';
  END IF;

  v_reason := public._event_meeting_can_invite(v_tenant, v_event_id, v_me, v_other);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%: meeting between these two is not allowed', v_reason;
  END IF;

  RETURN QUERY
  SELECT f.starts_at, f.ends_at, f.table_id, f.table_label, f.table_zone, f.table_seat
  FROM public._event_meeting_free_slots(
    v_tenant, v_event_id, v_me, v_other,
    (NULLIF(p_payload->>'from', ''))::timestamptz,
    (NULLIF(p_payload->>'to', ''))::timestamptz,
    (NULLIF(p_payload->>'limit', ''))::integer
  ) f;
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_free_slots(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_free_slots(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_free_slots(jsonb) IS
  'Wolne terminy uczestnika z jedna wskazana osoba. Wolno pytac wylacznie o pare z soba, i tylko gdy regula widocznosci na to spotkanie pozwala. Plaszczyzna tresci (public_tenant_id).';