CREATE OR REPLACE FUNCTION public.admin_event_track_save(p_payload jsonb)
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
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
  v_name_pl text := btrim(COALESCE(p_payload->>'name_pl', ''));
  v_name_en text := btrim(COALESCE(p_payload->>'name_en', ''));
BEGIN
  IF v_name_pl = '' OR v_name_en = '' THEN
    RAISE EXCEPTION 'invalid_names: both names are required';
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.event_tracks SET
      name_pl = v_name_pl,
      name_en = v_name_en,
      accent_color = CASE
        WHEN p_payload ? 'accent_color'
          THEN NULLIF(btrim(COALESCE(p_payload->>'accent_color', '')), '')
        ELSE accent_color
      END,
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, sort_order),
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, is_active)
    WHERE id = v_id AND tenant_id = v_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: track does not exist in this tenant';
    END IF;

    RETURN v_id;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_event: event_id is required';
  END IF;

  IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
    RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  INSERT INTO public.event_tracks (
    tenant_id, event_id, key, name_pl, name_en, accent_color, sort_order, is_active
  ) VALUES (
    v_tenant, v_event_id, v_key, v_name_pl, v_name_en,
    NULLIF(btrim(COALESCE(p_payload->>'accent_color', '')), ''),
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_track_save(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_track_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_track_save(jsonb) IS
  'Dodanie albo edycja sciezki tematycznej wydarzenia. Klucz jest niezmienny po zapisie. Bramka: assert_editor_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_track_delete(_id uuid)
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
    SELECT 1 FROM public.event_tracks t WHERE t.id = _id AND t.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: track does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.event_sessions s
  WHERE s.tenant_id = v_tenant AND s.track_id = _id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'track_in_use: % session(s) still use this track', v_used;
  END IF;

  DELETE FROM public.event_tracks WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_track_delete(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_track_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_track_delete(uuid) IS
  'Usuwa sciezke, ktorej nie uzywa zadna sesja. Sciezka w uzyciu jest odrzucana bledem track_in_use z liczba sesji.';

CREATE OR REPLACE FUNCTION public.admin_event_rooms_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  name text,
  capacity integer,
  floor text,
  location_note text,
  sort_order integer,
  is_active boolean,
  sessions_count integer,
  booked_minutes integer,
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
    r.id, r.event_id, r.name, r.capacity, r.floor, r.location_note,
    r.sort_order, r.is_active,
    COALESCE(u.cnt, 0)::integer,
    COALESCE(u.minutes, 0)::integer,
    r.created_at, r.updated_at
  FROM public.event_rooms r
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS cnt,
      COALESCE(
        sum(EXTRACT(EPOCH FROM (s.ends_at - s.starts_at)) / 60)::integer, 0
      ) AS minutes
    FROM public.event_sessions s
    WHERE s.tenant_id = v_tenant
      AND s.room_id = r.id
      AND s.status <> 'cancelled'
  ) u ON true
  WHERE r.tenant_id = v_tenant
    AND r.event_id = p_event_id
  ORDER BY r.sort_order, r.name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_rooms_list(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_rooms_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_rooms_list(uuid) IS
  'Sale wydarzenia dla panelu, z licznikiem sesji i suma minut zajetosci. Bramka: assert_editor_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_room_save(p_payload jsonb)
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
  v_name text := btrim(COALESCE(p_payload->>'name', ''));
  v_capacity integer := (NULLIF(p_payload->>'capacity', ''))::integer;
  v_over integer;
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'invalid_name: room name is required';
  END IF;

  IF v_capacity IS NOT NULL AND v_capacity <= 0 THEN
    RAISE EXCEPTION 'invalid_capacity: room capacity must be greater than zero';
  END IF;

  IF v_id IS NOT NULL THEN
    IF p_payload ? 'capacity' AND v_capacity IS NOT NULL THEN
      SELECT count(*)::integer INTO v_over
      FROM public.event_sessions s
      WHERE s.tenant_id = v_tenant
        AND s.room_id = v_id
        AND s.capacity IS NOT NULL
        AND s.capacity > v_capacity;

      IF v_over > 0 THEN
        RAISE EXCEPTION 'capacity_below_sessions: % session(s) have a higher seat limit', v_over;
      END IF;
    END IF;

    UPDATE public.event_rooms SET
      name = v_name,
      capacity = CASE WHEN p_payload ? 'capacity' THEN v_capacity ELSE capacity END,
      floor = CASE
        WHEN p_payload ? 'floor' THEN NULLIF(btrim(COALESCE(p_payload->>'floor', '')), '')
        ELSE floor
      END,
      location_note = CASE
        WHEN p_payload ? 'location_note'
          THEN NULLIF(btrim(COALESCE(p_payload->>'location_note', '')), '')
        ELSE location_note
      END,
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, sort_order),
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, is_active)
    WHERE id = v_id AND tenant_id = v_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: room does not exist in this tenant';
    END IF;

    RETURN v_id;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_event: event_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  INSERT INTO public.event_rooms (
    tenant_id, event_id, name, capacity, floor, location_note, sort_order, is_active
  ) VALUES (
    v_tenant, v_event_id, v_name, v_capacity,
    NULLIF(btrim(COALESCE(p_payload->>'floor', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'location_note', '')), ''),
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_room_save(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_room_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_room_save(jsonb) IS
  'Dodanie albo edycja sali wydarzenia. Odrzuca obnizenie pojemnosci ponizej limitu miejsc przypisanych sesji. Bramka: assert_editor_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_room_delete(_id uuid)
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
    SELECT 1 FROM public.event_rooms r WHERE r.id = _id AND r.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: room does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.event_sessions s
  WHERE s.tenant_id = v_tenant AND s.room_id = _id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'room_in_use: % session(s) still use this room', v_used;
  END IF;

  DELETE FROM public.event_rooms WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_room_delete(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_room_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_room_delete(uuid) IS
  'Usuwa sale, ktorej nie uzywa zadna sesja. Sala w uzyciu jest odrzucana bledem room_in_use z liczba sesji.';

CREATE OR REPLACE FUNCTION public.admin_event_sessions_list(
  p_event_id uuid,
  p_track_id uuid DEFAULT NULL,
  p_room_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_q text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  parent_session_id uuid,
  title_pl text,
  title_en text,
  description_pl text,
  description_en text,
  starts_at timestamptz,
  ends_at timestamptz,
  duration_minutes integer,
  format text,
  status text,
  capacity integer,
  requires_signup boolean,
  min_tier_rank integer,
  chatham_house boolean,
  is_private boolean,
  allow_overlap boolean,
  sort_order integer,
  published_at timestamptz,
  cancelled_at timestamptz,
  track_id uuid,
  track_key text,
  track_name_pl text,
  track_name_en text,
  track_accent_color text,
  room_id uuid,
  room_name text,
  room_capacity integer,
  speakers_count integer,
  registered_count integer,
  waitlist_count integer,
  cancelled_count integer,
  seats_left integer,
  has_stream boolean,
  has_recording boolean,
  children_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.event_id, s.parent_session_id,
    s.title_pl, s.title_en, s.description_pl, s.description_en,
    s.starts_at, s.ends_at,
    (EXTRACT(EPOCH FROM (s.ends_at - s.starts_at)) / 60)::integer,
    s.format, s.status, s.capacity, s.requires_signup, s.min_tier_rank,
    s.chatham_house, s.is_private, s.allow_overlap, s.sort_order,
    s.published_at, s.cancelled_at,
    s.track_id, t.key, t.name_pl, t.name_en, t.accent_color,
    s.room_id, r.name, r.capacity,
    COALESCE(sp.cnt, 0)::integer,
    COALESCE(g.registered, 0)::integer,
    COALESCE(g.waitlist, 0)::integer,
    COALESCE(g.cancelled, 0)::integer,
    CASE
      WHEN s.capacity IS NULL THEN NULL
      ELSE GREATEST(s.capacity - COALESCE(g.registered, 0), 0)
    END::integer,
    (s.stream_url IS NOT NULL),
    (s.recording_url IS NOT NULL),
    COALESCE(ch.cnt, 0)::integer
  FROM public.event_sessions s
  LEFT JOIN public.event_tracks t
    ON t.id = s.track_id AND t.tenant_id = v_tenant
  LEFT JOIN public.event_rooms r
    ON r.id = s.room_id AND r.tenant_id = v_tenant
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_session_speakers es
    WHERE es.tenant_id = v_tenant AND es.session_id = s.id
  ) sp ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE g0.status = 'registered')::integer AS registered,
      count(*) FILTER (WHERE g0.status = 'waitlist')::integer AS waitlist,
      count(*) FILTER (WHERE g0.status = 'cancelled')::integer AS cancelled
    FROM public.event_session_signups g0
    WHERE g0.tenant_id = v_tenant AND g0.session_id = s.id
  ) g ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_sessions c
    WHERE c.tenant_id = v_tenant AND c.parent_session_id = s.id
  ) ch ON true
  WHERE s.tenant_id = v_tenant
    AND s.event_id = p_event_id
    AND (p_track_id IS NULL OR s.track_id = p_track_id)
    AND (p_room_id IS NULL OR s.room_id = p_room_id)
    AND (p_status IS NULL OR p_status = 'all' OR s.status = p_status)
    AND (
      v_q IS NULL
      OR s.title_pl ILIKE '%' || v_q || '%'
      OR s.title_en ILIKE '%' || v_q || '%'
      OR r.name ILIKE '%' || v_q || '%'
    )
  ORDER BY s.starts_at, s.sort_order, s.title_pl;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sessions_list(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_sessions_list(uuid, uuid, uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sessions_list(uuid, uuid, uuid, text, text) IS
  'Agenda wydarzenia dla panelu: sesje z nazwa sciezki i sali, liczba prelegentow, licznikami zapisow i wolnymi miejscami. Bez adresow transmisji - tylko flagi. Bramka: assert_editor_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_session_detail(_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  event_title_pl text,
  event_title_en text,
  event_timezone text,
  event_starts_at timestamptz,
  event_ends_at timestamptz,
  parent_session_id uuid,
  title_pl text,
  title_en text,
  description_pl text,
  description_en text,
  starts_at timestamptz,
  ends_at timestamptz,
  format text,
  status text,
  capacity integer,
  requires_signup boolean,
  min_tier_rank integer,
  chatham_house boolean,
  is_private boolean,
  allow_overlap boolean,
  stream_url text,
  recording_url text,
  sort_order integer,
  published_at timestamptz,
  cancelled_at timestamptz,
  track_id uuid,
  room_id uuid,
  registered_count integer,
  waitlist_count integer,
  seats_left integer,
  speakers jsonb
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
    s.id, s.event_id, e.title_pl, e.title_en, e.timezone, e.starts_at, e.ends_at,
    s.parent_session_id, s.title_pl, s.title_en, s.description_pl, s.description_en,
    s.starts_at, s.ends_at, s.format, s.status, s.capacity, s.requires_signup,
    s.min_tier_rank, s.chatham_house, s.is_private, s.allow_overlap,
    s.stream_url, s.recording_url, s.sort_order, s.published_at, s.cancelled_at,
    s.track_id, s.room_id,
    COALESCE(g.registered, 0)::integer,
    COALESCE(g.waitlist, 0)::integer,
    CASE
      WHEN s.capacity IS NULL THEN NULL
      ELSE GREATEST(s.capacity - COALESCE(g.registered, 0), 0)
    END::integer,
    COALESCE(sp.items, '[]'::jsonb)
  FROM public.event_sessions s
  JOIN public.events e
    ON e.id = s.event_id AND e.tenant_id = s.tenant_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE g0.status = 'registered')::integer AS registered,
      count(*) FILTER (WHERE g0.status = 'waitlist')::integer AS waitlist
    FROM public.event_session_signups g0
    WHERE g0.tenant_id = v_tenant AND g0.session_id = s.id
  ) g ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', es.id,
        'speaker_profile_id', es.speaker_profile_id,
        'user_id', pr.id,
        'display_name', pr.display_name,
        'avatar_url', pr.avatar_url,
        'headline_pl', spf.headline_pl,
        'headline_en', spf.headline_en,
        'role', es.role,
        'sort_order', es.sort_order,
        'allow_overlap', es.allow_overlap
      ) ORDER BY es.sort_order, pr.display_name
    ) AS items
    FROM public.event_session_speakers es
    JOIN public.speaker_profiles spf
      ON spf.id = es.speaker_profile_id AND spf.tenant_id = es.tenant_id
    JOIN public.profiles pr
      ON pr.id = spf.user_id AND pr.tenant_id = es.tenant_id
    WHERE es.tenant_id = v_tenant AND es.session_id = s.id
  ) sp ON true
  WHERE s.tenant_id = v_tenant AND s.id = _id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_session_detail(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_session_detail(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_session_detail(uuid) IS
  'Jedna sesja z obsada (jsonb) i adresami transmisji/nagrania do formularza panelu. Okno czasowe wydarzenia jedzie razem, zeby formularz mogl ostrzec przed walidacja. Bramka: assert_editor_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_session_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_row public.event_sessions;
  v_event_id uuid;
  v_title_pl text;
  v_title_en text;
  v_desc_pl text;
  v_desc_en text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_format text;
  v_status text;
  v_capacity integer;
  v_requires_signup boolean;
  v_min_tier integer;
  v_chatham boolean;
  v_is_private boolean;
  v_allow_overlap boolean;
  v_stream text;
  v_recording text;
  v_sort integer;
  v_track uuid;
  v_room uuid;
  v_parent uuid;
  v_published_at timestamptz;
  v_cancelled_at timestamptz;
  v_conflict text;
  v_prev_status text;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_row
    FROM public.event_sessions s
    WHERE s.id = v_id AND s.tenant_id = v_tenant;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'not_found: session does not exist in this tenant';
    END IF;
  END IF;

  v_event_id := COALESCE(NULLIF(p_payload->>'event_id', '')::uuid, v_row.event_id);
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_event: event_id is required';
  END IF;

  IF v_row.id IS NOT NULL AND v_event_id <> v_row.event_id THEN
    RAISE EXCEPTION 'event_immutable: a session cannot be moved to another event';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  v_title_pl := COALESCE(NULLIF(btrim(COALESCE(p_payload->>'title_pl', '')), ''), v_row.title_pl);
  v_title_en := COALESCE(NULLIF(btrim(COALESCE(p_payload->>'title_en', '')), ''), v_row.title_en);
  IF v_title_pl IS NULL OR v_title_en IS NULL THEN
    RAISE EXCEPTION 'invalid_titles: both titles are required';
  END IF;

  v_desc_pl := CASE
    WHEN p_payload ? 'description_pl' THEN COALESCE(btrim(p_payload->>'description_pl'), '')
    ELSE COALESCE(v_row.description_pl, '')
  END;
  v_desc_en := CASE
    WHEN p_payload ? 'description_en' THEN COALESCE(btrim(p_payload->>'description_en'), '')
    ELSE COALESCE(v_row.description_en, '')
  END;

  v_starts := COALESCE(NULLIF(p_payload->>'starts_at', '')::timestamptz, v_row.starts_at);
  v_ends := COALESCE(NULLIF(p_payload->>'ends_at', '')::timestamptz, v_row.ends_at);
  IF v_starts IS NULL OR v_ends IS NULL THEN
    RAISE EXCEPTION 'invalid_times: both start and end are required';
  END IF;
  IF v_ends <= v_starts THEN
    RAISE EXCEPTION 'invalid_times: end must be after start';
  END IF;

  v_format := COALESCE(NULLIF(p_payload->>'format', ''), v_row.format, 'onsite');
  IF v_format NOT IN ('onsite', 'online', 'hybrid') THEN
    RAISE EXCEPTION 'invalid_format: format must be onsite, online or hybrid';
  END IF;

  v_status := COALESCE(NULLIF(p_payload->>'status', ''), v_row.status, 'draft');
  IF v_status NOT IN ('draft', 'published', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status: status must be draft, published or cancelled';
  END IF;

  v_requires_signup := COALESCE(
    (NULLIF(p_payload->>'requires_signup', ''))::boolean, v_row.requires_signup, false
  );

  IF p_payload ? 'capacity' THEN
    v_capacity := (NULLIF(p_payload->>'capacity', ''))::integer;
  ELSE
    v_capacity := v_row.capacity;
  END IF;
  IF v_capacity IS NOT NULL AND v_capacity < 0 THEN
    RAISE EXCEPTION 'invalid_capacity: seat limit cannot be negative';
  END IF;
  IF v_capacity IS NOT NULL AND NOT v_requires_signup THEN
    RAISE EXCEPTION 'capacity_requires_signup: a seat limit needs signups enabled';
  END IF;

  v_min_tier := COALESCE(
    (NULLIF(p_payload->>'min_tier_rank', ''))::integer, v_row.min_tier_rank, 0
  );
  IF v_min_tier < 0 THEN
    RAISE EXCEPTION 'invalid_tier_rank: membership rank cannot be negative';
  END IF;

  v_chatham := COALESCE(
    (NULLIF(p_payload->>'chatham_house', ''))::boolean, v_row.chatham_house, false
  );
  v_is_private := COALESCE(
    (NULLIF(p_payload->>'is_private', ''))::boolean, v_row.is_private, false
  );
  v_allow_overlap := COALESCE(
    (NULLIF(p_payload->>'allow_overlap', ''))::boolean, v_row.allow_overlap, true
  );

  IF p_payload ? 'stream_url' THEN
    v_stream := NULLIF(btrim(COALESCE(p_payload->>'stream_url', '')), '');
  ELSE
    v_stream := v_row.stream_url;
  END IF;
  IF v_stream IS NOT NULL AND v_stream !~ '^https://' THEN
    RAISE EXCEPTION 'invalid_stream_url: the stream address must start with https://';
  END IF;

  IF p_payload ? 'recording_url' THEN
    v_recording := NULLIF(btrim(COALESCE(p_payload->>'recording_url', '')), '');
  ELSE
    v_recording := v_row.recording_url;
  END IF;
  IF v_recording IS NOT NULL AND v_recording !~ '^https://' THEN
    RAISE EXCEPTION 'invalid_recording_url: the recording address must start with https://';
  END IF;

  IF p_payload ? 'track_id' THEN
    v_track := NULLIF(p_payload->>'track_id', '')::uuid;
  ELSE
    v_track := v_row.track_id;
  END IF;
  IF v_track IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_tracks t
    WHERE t.id = v_track AND t.tenant_id = v_tenant AND t.event_id = v_event_id
  ) THEN
    RAISE EXCEPTION 'track_not_found: the track does not belong to this event';
  END IF;

  IF p_payload ? 'room_id' THEN
    v_room := NULLIF(p_payload->>'room_id', '')::uuid;
  ELSE
    v_room := v_row.room_id;
  END IF;
  IF v_room IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_rooms r
    WHERE r.id = v_room AND r.tenant_id = v_tenant AND r.event_id = v_event_id
  ) THEN
    RAISE EXCEPTION 'room_not_found: the room does not belong to this event';
  END IF;

  IF p_payload ? 'parent_session_id' THEN
    v_parent := NULLIF(p_payload->>'parent_session_id', '')::uuid;
  ELSE
    v_parent := v_row.parent_session_id;
  END IF;
  IF v_parent IS NOT NULL THEN
    IF v_parent = v_id THEN
      RAISE EXCEPTION 'parent_self: a session cannot be its own parent';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.event_sessions p
      WHERE p.id = v_parent AND p.tenant_id = v_tenant AND p.event_id = v_event_id
    ) THEN
      RAISE EXCEPTION 'parent_not_found: the parent session does not belong to this event';
    END IF;
  END IF;

  v_sort := COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, v_row.sort_order);
  IF v_sort IS NULL THEN
    SELECT COALESCE(max(s.sort_order), 0) + 10 INTO v_sort
    FROM public.event_sessions s
    WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id;
  END IF;

  IF v_room IS NOT NULL AND v_status <> 'cancelled' THEN
    SELECT s.title_pl INTO v_conflict
    FROM public.event_sessions s
    WHERE s.tenant_id = v_tenant
      AND s.room_id = v_room
      AND s.status <> 'cancelled'
      AND s.time_range && tstzrange(v_starts, v_ends, '[)')
      AND (v_id IS NULL OR s.id <> v_id)
    ORDER BY s.starts_at
    LIMIT 1;

    IF v_conflict IS NOT NULL THEN
      RAISE EXCEPTION 'room_conflict: room already taken in this slot by "%"', v_conflict;
    END IF;
  END IF;

  v_prev_status := v_row.status;
  v_published_at := CASE
    WHEN v_status = 'published' THEN COALESCE(v_row.published_at, now())
    ELSE v_row.published_at
  END;
  v_cancelled_at := CASE WHEN v_status = 'cancelled' THEN COALESCE(v_row.cancelled_at, now()) END;

  IF v_id IS NULL THEN
    INSERT INTO public.event_sessions (
      tenant_id, event_id, parent_session_id, track_id, room_id,
      title_pl, title_en, description_pl, description_en,
      starts_at, ends_at, format, status, capacity, requires_signup,
      min_tier_rank, chatham_house, is_private, allow_overlap,
      stream_url, recording_url, sort_order, published_at, cancelled_at, created_by
    ) VALUES (
      v_tenant, v_event_id, v_parent, v_track, v_room,
      v_title_pl, v_title_en, v_desc_pl, v_desc_en,
      v_starts, v_ends, v_format, v_status, v_capacity, v_requires_signup,
      v_min_tier, v_chatham, v_is_private, v_allow_overlap,
      v_stream, v_recording, v_sort, v_published_at, v_cancelled_at, auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_sessions SET
      parent_session_id = v_parent,
      track_id = v_track,
      room_id = v_room,
      title_pl = v_title_pl,
      title_en = v_title_en,
      description_pl = v_desc_pl,
      description_en = v_desc_en,
      starts_at = v_starts,
      ends_at = v_ends,
      format = v_format,
      status = v_status,
      capacity = v_capacity,
      requires_signup = v_requires_signup,
      min_tier_rank = v_min_tier,
      chatham_house = v_chatham,
      is_private = v_is_private,
      allow_overlap = v_allow_overlap,
      stream_url = v_stream,
      recording_url = v_recording,
      sort_order = v_sort,
      published_at = v_published_at,
      cancelled_at = v_cancelled_at
    WHERE id = v_id AND tenant_id = v_tenant;
  END IF;

  IF v_status IS DISTINCT FROM v_prev_status AND v_status IN ('published', 'cancelled') THEN
    PERFORM public.emit_domain_event(
      v_tenant,
      'event_session',
      v_id::text,
      'event_session.' || v_status || '.v1',
      jsonb_build_object('event_id', v_event_id, 'session_id', v_id, 'title_pl', v_title_pl),
      auth.uid()
    );
  END IF;

  RETURN v_id;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'room_conflict: room already taken in this slot';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_session_save(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_session_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_session_save(jsonb) IS
  'Dodanie albo edycja sesji agendy. Pole nieobecne w payloadzie zostaje bez zmiany, obecne i puste jest czyszczone. Wydarzenie sesji jest niezmienne. Bramka: assert_editor_tenant().';