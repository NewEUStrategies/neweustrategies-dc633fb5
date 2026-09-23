ALTER TABLE public.event_tracks
  ADD COLUMN IF NOT EXISTS sponsor_id uuid;

ALTER TABLE public.event_sessions
  ADD COLUMN IF NOT EXISTS sponsor_id uuid,
  ADD COLUMN IF NOT EXISTS affiliation_pl text,
  ADD COLUMN IF NOT EXISTS affiliation_en text;

ALTER TABLE public.event_tracks DROP CONSTRAINT IF EXISTS event_tracks_sponsor_fk;
ALTER TABLE public.event_tracks ADD CONSTRAINT event_tracks_sponsor_fk
  FOREIGN KEY (tenant_id, event_id, sponsor_id)
  REFERENCES public.event_sponsors (tenant_id, event_id, id)
  ON DELETE SET NULL (sponsor_id);

ALTER TABLE public.event_sessions DROP CONSTRAINT IF EXISTS event_sessions_sponsor_fk;
ALTER TABLE public.event_sessions ADD CONSTRAINT event_sessions_sponsor_fk
  FOREIGN KEY (tenant_id, event_id, sponsor_id)
  REFERENCES public.event_sponsors (tenant_id, event_id, id)
  ON DELETE SET NULL (sponsor_id);

ALTER TABLE public.event_sessions DROP CONSTRAINT IF EXISTS event_sessions_affiliation_pl_len;
ALTER TABLE public.event_sessions ADD CONSTRAINT event_sessions_affiliation_pl_len
  CHECK (affiliation_pl IS NULL OR char_length(btrim(affiliation_pl)) <= 300);

ALTER TABLE public.event_sessions DROP CONSTRAINT IF EXISTS event_sessions_affiliation_en_len;
ALTER TABLE public.event_sessions ADD CONSTRAINT event_sessions_affiliation_en_len
  CHECK (affiliation_en IS NULL OR char_length(btrim(affiliation_en)) <= 300);

COMMENT ON COLUMN public.event_tracks.sponsor_id IS
  'Optional public sponsor attribution for this agenda track. Tenant and event scoped to event_sponsors.';
COMMENT ON COLUMN public.event_sessions.sponsor_id IS
  'Optional public sponsor attribution for this agenda session or debate. Tenant and event scoped to event_sponsors.';
COMMENT ON COLUMN public.event_sessions.affiliation_pl IS
  'Optional Polish editorial affiliation/context for this session or debate.';
COMMENT ON COLUMN public.event_sessions.affiliation_en IS
  'Optional English editorial affiliation/context for this session or debate.';

DROP FUNCTION IF EXISTS public.admin_event_tracks_list(uuid);
CREATE FUNCTION public.admin_event_tracks_list(p_event_id uuid)
 RETURNS TABLE(id uuid, event_id uuid, key text, name_pl text, name_en text, tagline_pl text, tagline_en text, description_pl text, description_en text, cover_url text, accent_color text, sort_order integer, is_active boolean, is_public boolean, default_room_id uuid, default_room_name text, sponsor_id uuid, sponsor_name text, sponsor_logo_url text, sponsor_role text, sessions_count integer, published_count integer, draft_count integer, speakers_count integer, minutes_total integer, first_starts_at timestamp with time zone, last_ends_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    t.id, t.event_id, t.key, t.name_pl, t.name_en,
    t.tagline_pl, t.tagline_en, t.description_pl, t.description_en, t.cover_url,
    t.accent_color, t.sort_order, t.is_active, t.is_public,
    t.default_room_id, r.name,
    t.sponsor_id, spn.snapshot_name, spn.snapshot_logo_url, spn.role,
    COALESCE(u.cnt, 0)::integer,
    COALESCE(u.published_cnt, 0)::integer,
    COALESCE(u.draft_cnt, 0)::integer,
    COALESCE(sp.cnt, 0)::integer,
    COALESCE(u.minutes, 0)::integer,
    u.first_starts_at,
    u.last_ends_at,
    t.created_at, t.updated_at
  FROM public.event_tracks t
  LEFT JOIN public.event_rooms r
    ON r.tenant_id = t.tenant_id AND r.id = t.default_room_id
  LEFT JOIN public.event_sponsors spn
    ON spn.tenant_id = t.tenant_id AND spn.event_id = t.event_id AND spn.id = t.sponsor_id
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS cnt,
      count(*) FILTER (WHERE s.status = 'published')::integer AS published_cnt,
      count(*) FILTER (WHERE s.status <> 'published')::integer AS draft_cnt,
      COALESCE(sum(EXTRACT(EPOCH FROM (s.ends_at - s.starts_at)) / 60), 0)::integer AS minutes,
      min(s.starts_at) AS first_starts_at,
      max(s.ends_at) AS last_ends_at
    FROM public.event_sessions s
    WHERE s.tenant_id = t.tenant_id AND s.track_id = t.id
  ) u ON true
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT ss.speaker_profile_id)::integer AS cnt
    FROM public.event_session_speakers ss
    JOIN public.event_sessions s2
      ON s2.tenant_id = ss.tenant_id AND s2.id = ss.session_id
    WHERE ss.tenant_id = t.tenant_id AND s2.track_id = t.id
  ) sp ON true
  WHERE t.tenant_id = v_tenant
    AND t.event_id = p_event_id
  ORDER BY t.sort_order, t.key;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_event_tracks_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_tracks_list(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_tracks_list(uuid) IS
  'Admin list of event agenda tracks with optional sponsor attribution and derived counts.';

CREATE OR REPLACE FUNCTION public.admin_event_track_save(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
  v_name_pl text := btrim(COALESCE(p_payload->>'name_pl', ''));
  v_name_en text := btrim(COALESCE(p_payload->>'name_en', ''));
  v_room uuid := NULLIF(p_payload->>'default_room_id', '')::uuid;
  v_sponsor uuid := NULLIF(p_payload->>'sponsor_id', '')::uuid;
BEGIN
  IF v_name_pl = '' OR v_name_en = '' THEN
    RAISE EXCEPTION 'invalid_names: both names are required';
  END IF;

  IF v_id IS NOT NULL THEN
    IF p_payload ? 'sponsor_id' AND v_sponsor IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.event_tracks t
      JOIN public.event_sponsors s
        ON s.tenant_id = t.tenant_id AND s.event_id = t.event_id AND s.id = v_sponsor
      WHERE t.id = v_id AND t.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'sponsor_not_found: the sponsor does not belong to this event';
    END IF;

    UPDATE public.event_tracks SET
      name_pl = v_name_pl,
      name_en = v_name_en,
      accent_color = CASE
        WHEN p_payload ? 'accent_color'
          THEN NULLIF(btrim(COALESCE(p_payload->>'accent_color', '')), '')
        ELSE accent_color END,
      tagline_pl = CASE
        WHEN p_payload ? 'tagline_pl'
          THEN NULLIF(btrim(COALESCE(p_payload->>'tagline_pl', '')), '')
        ELSE tagline_pl END,
      tagline_en = CASE
        WHEN p_payload ? 'tagline_en'
          THEN NULLIF(btrim(COALESCE(p_payload->>'tagline_en', '')), '')
        ELSE tagline_en END,
      description_pl = CASE
        WHEN p_payload ? 'description_pl'
          THEN NULLIF(btrim(COALESCE(p_payload->>'description_pl', '')), '')
        ELSE description_pl END,
      description_en = CASE
        WHEN p_payload ? 'description_en'
          THEN NULLIF(btrim(COALESCE(p_payload->>'description_en', '')), '')
        ELSE description_en END,
      cover_url = CASE
        WHEN p_payload ? 'cover_url'
          THEN NULLIF(btrim(COALESCE(p_payload->>'cover_url', '')), '')
        ELSE cover_url END,
      default_room_id = CASE
        WHEN p_payload ? 'default_room_id' THEN v_room
        ELSE default_room_id END,
      sponsor_id = CASE
        WHEN p_payload ? 'sponsor_id' THEN v_sponsor
        ELSE sponsor_id END,
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, sort_order),
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, is_active),
      is_public = COALESCE((NULLIF(p_payload->>'is_public', ''))::boolean, is_public)
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

  IF v_sponsor IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_sponsors s
    WHERE s.id = v_sponsor AND s.tenant_id = v_tenant AND s.event_id = v_event_id
  ) THEN
    RAISE EXCEPTION 'sponsor_not_found: the sponsor does not belong to this event';
  END IF;

  INSERT INTO public.event_tracks (
    tenant_id, event_id, key, name_pl, name_en, accent_color,
    tagline_pl, tagline_en, description_pl, description_en, cover_url,
    default_room_id, sponsor_id, sort_order, is_active, is_public
  ) VALUES (
    v_tenant, v_event_id, v_key, v_name_pl, v_name_en,
    NULLIF(btrim(COALESCE(p_payload->>'accent_color', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'tagline_pl', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'tagline_en', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'description_pl', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'description_en', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'cover_url', '')), ''),
    v_room,
    v_sponsor,
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true),
    COALESCE((NULLIF(p_payload->>'is_public', ''))::boolean, true)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

DROP FUNCTION IF EXISTS public.admin_event_sessions_list(uuid, uuid, uuid, text, text);
CREATE FUNCTION public.admin_event_sessions_list(p_event_id uuid, p_track_id uuid DEFAULT NULL::uuid, p_room_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_q text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, event_id uuid, parent_session_id uuid, title_pl text, title_en text, description_pl text, description_en text, affiliation_pl text, affiliation_en text, starts_at timestamp with time zone, ends_at timestamp with time zone, duration_minutes integer, format text, status text, capacity integer, requires_signup boolean, min_tier_rank integer, chatham_house boolean, is_private boolean, allow_overlap boolean, sort_order integer, published_at timestamp with time zone, cancelled_at timestamp with time zone, track_id uuid, track_key text, track_name_pl text, track_name_en text, track_accent_color text, room_id uuid, room_name text, room_capacity integer, sponsor_id uuid, sponsor_name text, sponsor_logo_url text, sponsor_role text, speakers_count integer, registered_count integer, waitlist_count integer, cancelled_count integer, seats_left integer, has_stream boolean, has_recording boolean, children_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.event_id, s.parent_session_id,
    s.title_pl, s.title_en, s.description_pl, s.description_en,
    s.affiliation_pl, s.affiliation_en,
    s.starts_at, s.ends_at,
    (EXTRACT(EPOCH FROM (s.ends_at - s.starts_at)) / 60)::integer,
    s.format, s.status, s.capacity, s.requires_signup, s.min_tier_rank,
    s.chatham_house, s.is_private, s.allow_overlap, s.sort_order,
    s.published_at, s.cancelled_at,
    s.track_id, t.key, t.name_pl, t.name_en, t.accent_color,
    s.room_id, r.name, r.capacity,
    s.sponsor_id, spn.snapshot_name, spn.snapshot_logo_url, spn.role,
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
  LEFT JOIN public.event_sponsors spn
    ON spn.tenant_id = s.tenant_id AND spn.event_id = s.event_id AND spn.id = s.sponsor_id
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
      OR s.affiliation_pl ILIKE '%' || v_q || '%'
      OR s.affiliation_en ILIKE '%' || v_q || '%'
      OR r.name ILIKE '%' || v_q || '%'
      OR spn.snapshot_name ILIKE '%' || v_q || '%'
    )
  ORDER BY s.starts_at, s.sort_order, s.title_pl;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_event_sessions_list(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sessions_list(uuid, uuid, uuid, text, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_event_session_detail(uuid);
CREATE FUNCTION public.admin_event_session_detail(_id uuid)
 RETURNS TABLE(id uuid, event_id uuid, event_title_pl text, event_title_en text, event_timezone text, event_starts_at timestamp with time zone, event_ends_at timestamp with time zone, parent_session_id uuid, title_pl text, title_en text, description_pl text, description_en text, affiliation_pl text, affiliation_en text, starts_at timestamp with time zone, ends_at timestamp with time zone, format text, status text, capacity integer, requires_signup boolean, min_tier_rank integer, chatham_house boolean, is_private boolean, allow_overlap boolean, stream_url text, recording_url text, sort_order integer, published_at timestamp with time zone, cancelled_at timestamp with time zone, track_id uuid, room_id uuid, sponsor_id uuid, sponsor_name text, sponsor_logo_url text, sponsor_role text, registered_count integer, waitlist_count integer, seats_left integer, speakers jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.event_id, e.title_pl, e.title_en, e.timezone, e.starts_at, e.ends_at,
    s.parent_session_id, s.title_pl, s.title_en, s.description_pl, s.description_en,
    s.affiliation_pl, s.affiliation_en,
    s.starts_at, s.ends_at, s.format, s.status, s.capacity, s.requires_signup,
    s.min_tier_rank, s.chatham_house, s.is_private, s.allow_overlap,
    s.stream_url, s.recording_url, s.sort_order, s.published_at, s.cancelled_at,
    s.track_id, s.room_id,
    s.sponsor_id, spn.snapshot_name, spn.snapshot_logo_url, spn.role,
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
  LEFT JOIN public.event_sponsors spn
    ON spn.tenant_id = s.tenant_id AND spn.event_id = s.event_id AND spn.id = s.sponsor_id
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
$function$;

REVOKE ALL ON FUNCTION public.admin_event_session_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_session_detail(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_event_session_save(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_row public.event_sessions;
  v_event_id uuid;
  v_title_pl text;
  v_title_en text;
  v_desc_pl text;
  v_desc_en text;
  v_aff_pl text;
  v_aff_en text;
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
  v_sponsor uuid;
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
  v_aff_pl := CASE
    WHEN p_payload ? 'affiliation_pl' THEN NULLIF(btrim(COALESCE(p_payload->>'affiliation_pl', '')), '')
    ELSE v_row.affiliation_pl
  END;
  v_aff_en := CASE
    WHEN p_payload ? 'affiliation_en' THEN NULLIF(btrim(COALESCE(p_payload->>'affiliation_en', '')), '')
    ELSE v_row.affiliation_en
  END;
  IF v_aff_pl IS NOT NULL AND char_length(v_aff_pl) > 300 THEN
    RAISE EXCEPTION 'invalid_affiliation: affiliation is too long';
  END IF;
  IF v_aff_en IS NOT NULL AND char_length(v_aff_en) > 300 THEN
    RAISE EXCEPTION 'invalid_affiliation: affiliation is too long';
  END IF;

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

  IF p_payload ? 'sponsor_id' THEN
    v_sponsor := NULLIF(p_payload->>'sponsor_id', '')::uuid;
  ELSE
    v_sponsor := v_row.sponsor_id;
  END IF;
  IF v_sponsor IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_sponsors spn
    WHERE spn.id = v_sponsor AND spn.tenant_id = v_tenant AND spn.event_id = v_event_id
  ) THEN
    RAISE EXCEPTION 'sponsor_not_found: the sponsor does not belong to this event';
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
      title_pl, title_en, description_pl, description_en, affiliation_pl, affiliation_en,
      starts_at, ends_at, format, status, capacity, requires_signup,
      min_tier_rank, chatham_house, is_private, allow_overlap,
      stream_url, recording_url, sponsor_id, sort_order, published_at, cancelled_at, created_by
    ) VALUES (
      v_tenant, v_event_id, v_parent, v_track, v_room,
      v_title_pl, v_title_en, v_desc_pl, v_desc_en, v_aff_pl, v_aff_en,
      v_starts, v_ends, v_format, v_status, v_capacity, v_requires_signup,
      v_min_tier, v_chatham, v_is_private, v_allow_overlap,
      v_stream, v_recording, v_sponsor, v_sort, v_published_at, v_cancelled_at, auth.uid()
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
      affiliation_pl = v_aff_pl,
      affiliation_en = v_aff_en,
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
      sponsor_id = v_sponsor,
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
$function$;

DROP FUNCTION IF EXISTS public.event_agenda(text);
CREATE FUNCTION public.event_agenda(p_slug text)
 RETURNS TABLE(id uuid, event_id uuid, parent_session_id uuid, title_pl text, title_en text, description_pl text, description_en text, affiliation_pl text, affiliation_en text, starts_at timestamp with time zone, ends_at timestamp with time zone, timezone text, format text, status text, sort_order integer, chatham_house boolean, min_tier_rank integer, requires_signup boolean, capacity integer, registered_count integer, seats_left integer, track_id uuid, track_key text, track_name_pl text, track_name_en text, track_accent_color text, track_sponsor_id uuid, track_sponsor_name text, track_sponsor_logo_url text, track_sponsor_role text, room_id uuid, room_name text, room_floor text, session_sponsor_id uuid, session_sponsor_name text, session_sponsor_logo_url text, session_sponsor_role text, has_stream boolean, has_recording boolean, my_signup_status text, access_state text, speakers jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_rank integer := public.current_tier_rank();
  v_event_id uuid;
  v_timezone text;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  SELECT e.id, e.timezone INTO v_event_id, v_timezone
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.slug = p_slug
    AND e.status = 'published';

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH mine AS (
    SELECT g.session_id, g.status
    FROM public.event_session_signups g
    WHERE v_uid IS NOT NULL
      AND g.tenant_id = v_tenant
      AND g.event_id = v_event_id
      AND g.user_id = v_uid
  )
  SELECT
    s.id, s.event_id, s.parent_session_id,
    s.title_pl, s.title_en, s.description_pl, s.description_en,
    s.affiliation_pl, s.affiliation_en,
    s.starts_at, s.ends_at, v_timezone,
    s.format, s.status, s.sort_order, s.chatham_house, s.min_tier_rank,
    s.requires_signup, s.capacity,
    CASE WHEN s.requires_signup THEN COALESCE(c.registered, 0) ELSE 0 END::integer,
    CASE
      WHEN s.capacity IS NULL THEN NULL
      ELSE GREATEST(s.capacity - COALESCE(c.registered, 0), 0)
    END::integer,
    s.track_id, t.key, t.name_pl, t.name_en, t.accent_color,
    ts.id, ts.snapshot_name, ts.snapshot_logo_url, ts.role,
    s.room_id, r.name, r.floor,
    ss.id, ss.snapshot_name, ss.snapshot_logo_url, ss.role,
    (s.stream_url IS NOT NULL),
    (s.recording_url IS NOT NULL),
    m.status,
    CASE
      WHEN s.status = 'cancelled' THEN 'cancelled'
      WHEN m.status = 'registered' THEN 'signed_up'
      WHEN m.status = 'waitlist' THEN 'waitlisted'
      WHEN s.min_tier_rank > 0 AND v_rank < s.min_tier_rank THEN 'tier_required'
      WHEN NOT s.requires_signup THEN 'open'
      WHEN s.capacity IS NOT NULL AND COALESCE(c.registered, 0) >= s.capacity THEN 'full'
      ELSE 'signup_required'
    END::text,
    COALESCE(sp.items, '[]'::jsonb)
  FROM public.event_sessions s
  LEFT JOIN mine m ON m.session_id = s.id AND m.status <> 'cancelled'
  LEFT JOIN public.event_tracks t
    ON t.id = s.track_id AND t.tenant_id = v_tenant
  LEFT JOIN public.event_rooms r
    ON r.id = s.room_id AND r.tenant_id = v_tenant
  LEFT JOIN public.event_sponsors ts
    ON ts.tenant_id = t.tenant_id AND ts.event_id = t.event_id AND ts.id = t.sponsor_id AND ts.is_published
  LEFT JOIN public.event_sponsors ss
    ON ss.tenant_id = s.tenant_id AND ss.event_id = s.event_id AND ss.id = s.sponsor_id AND ss.is_published
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS registered
    FROM public.event_session_signups g0
    WHERE g0.tenant_id = v_tenant
      AND g0.session_id = s.id
      AND g0.status = 'registered'
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'user_id', pr.id,
        'slug', pr.slug,
        'display_name', pr.display_name,
        'avatar_url', pr.avatar_url,
        'headline_pl', spf.headline_pl,
        'headline_en', spf.headline_en,
        'role', es.role,
        'sort_order', es.sort_order
      ) ORDER BY es.sort_order, pr.display_name
    ) AS items
    FROM public.event_session_speakers es
    JOIN public.speaker_profiles spf
      ON spf.id = es.speaker_profile_id
     AND spf.tenant_id = v_tenant
     AND spf.is_public
    JOIN public.profiles pr
      ON pr.id = spf.user_id AND pr.tenant_id = v_tenant
    WHERE es.tenant_id = v_tenant AND es.session_id = s.id
  ) sp ON true
  WHERE s.tenant_id = v_tenant
    AND s.event_id = v_event_id
    AND s.status IN ('published', 'cancelled')
    AND (s.is_private = false OR m.status IS NOT NULL)
  ORDER BY s.starts_at, s.sort_order, s.title_pl;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.event_agenda(text) TO anon, authenticated, service_role;