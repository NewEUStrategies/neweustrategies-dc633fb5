ALTER TABLE public.event_tracks
  ADD COLUMN IF NOT EXISTS tagline_pl text,
  ADD COLUMN IF NOT EXISTS tagline_en text,
  ADD COLUMN IF NOT EXISTS description_pl text,
  ADD COLUMN IF NOT EXISTS description_en text,
  ADD COLUMN IF NOT EXISTS cover_url text,
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_room_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_tracks_tagline_len') THEN
    ALTER TABLE public.event_tracks
      ADD CONSTRAINT event_tracks_tagline_len CHECK (
        (tagline_pl IS NULL OR char_length(tagline_pl) <= 200)
        AND (tagline_en IS NULL OR char_length(tagline_en) <= 200)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_tracks_description_len') THEN
    ALTER TABLE public.event_tracks
      ADD CONSTRAINT event_tracks_description_len CHECK (
        (description_pl IS NULL OR char_length(description_pl) <= 4000)
        AND (description_en IS NULL OR char_length(description_en) <= 4000)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_tracks_cover_url_len') THEN
    ALTER TABLE public.event_tracks
      ADD CONSTRAINT event_tracks_cover_url_len
        CHECK (cover_url IS NULL OR char_length(cover_url) BETWEEN 5 AND 2000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_tracks_default_room_fk') THEN
    ALTER TABLE public.event_tracks
      ADD CONSTRAINT event_tracks_default_room_fk
        FOREIGN KEY (tenant_id, event_id, default_room_id)
        REFERENCES public.event_rooms (tenant_id, event_id, id) ON DELETE SET NULL;
  END IF;
END
$$;

COMMENT ON COLUMN public.event_tracks.is_public IS
  'Pasmo widoczne dla uczestnika. Rozne od is_active, ktore rzadzi dostepnoscia sciezki w selekcie formularza sesji.';
COMMENT ON COLUMN public.event_tracks.default_room_id IS
  'Sala domyslna pasma - podpowiedz przy planowaniu sesji, nie ograniczenie.';

DROP FUNCTION IF EXISTS public.admin_event_tracks_list(uuid);
CREATE FUNCTION public.admin_event_tracks_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  key text,
  name_pl text,
  name_en text,
  tagline_pl text,
  tagline_en text,
  description_pl text,
  description_en text,
  cover_url text,
  accent_color text,
  sort_order integer,
  is_active boolean,
  is_public boolean,
  default_room_id uuid,
  default_room_name text,
  sessions_count integer,
  published_count integer,
  draft_count integer,
  speakers_count integer,
  minutes_total integer,
  first_starts_at timestamptz,
  last_ends_at timestamptz,
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
    t.id, t.event_id, t.key, t.name_pl, t.name_en,
    t.tagline_pl, t.tagline_en, t.description_pl, t.description_en, t.cover_url,
    t.accent_color, t.sort_order, t.is_active, t.is_public,
    t.default_room_id, r.name,
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
$$;

REVOKE ALL ON FUNCTION public.admin_event_tracks_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_tracks_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_tracks_list(uuid) IS
  'Sciezki tematyczne wydarzenia dla panelu, z opisem pasma i statystykami programu. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_track_save(jsonb);
CREATE FUNCTION public.admin_event_track_save(p_payload jsonb)
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
  v_room uuid := NULLIF(p_payload->>'default_room_id', '')::uuid;
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

  INSERT INTO public.event_tracks (
    tenant_id, event_id, key, name_pl, name_en, accent_color,
    tagline_pl, tagline_en, description_pl, description_en, cover_url,
    default_room_id, sort_order, is_active, is_public
  ) VALUES (
    v_tenant, v_event_id, v_key, v_name_pl, v_name_en,
    NULLIF(btrim(COALESCE(p_payload->>'accent_color', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'tagline_pl', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'tagline_en', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'description_pl', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'description_en', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'cover_url', '')), ''),
    v_room,
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true),
    COALESCE((NULLIF(p_payload->>'is_public', ''))::boolean, true)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_track_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_track_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_track_save(jsonb) IS
  'Dodanie albo edycja sciezki tematycznej wydarzenia wraz z opisem pasma. Klucz jest niezmienny po zapisie. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_track_speakers(uuid);
CREATE FUNCTION public.admin_event_track_speakers(p_track_id uuid)
RETURNS TABLE (
  speaker_profile_id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  sessions_count integer,
  roles text[]
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
    sp.id,
    COALESCE(
      pr.display_name,
      NULLIF(btrim(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')), '')
    ),
    COALESCE(pr.avatar_url, pe.photo_url),
    COALESCE(ap.job_title, pe.job_title),
    count(DISTINCT ss.session_id)::integer,
    array_agg(DISTINCT ss.role)
  FROM public.event_session_speakers ss
  JOIN public.event_sessions s
    ON s.tenant_id = ss.tenant_id AND s.id = ss.session_id
  JOIN public.speaker_profiles sp
    ON sp.tenant_id = ss.tenant_id AND sp.id = ss.speaker_profile_id
  LEFT JOIN public.profiles pr
    ON pr.id = sp.user_id AND pr.tenant_id = v_tenant
  LEFT JOIN public.event_people pe
    ON pe.id = sp.person_id AND pe.tenant_id = v_tenant
  LEFT JOIN public.author_profiles ap
    ON ap.user_id = sp.user_id AND ap.tenant_id = v_tenant
  WHERE ss.tenant_id = v_tenant
    AND s.track_id = p_track_id
  GROUP BY sp.id, pr.display_name, pe.first_name, pe.last_name,
           pr.avatar_url, pe.photo_url, ap.job_title, pe.job_title
  ORDER BY count(DISTINCT ss.session_id) DESC, 2;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_track_speakers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_track_speakers(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_track_speakers(uuid) IS
  'Obsada calego pasma: kto wystepuje w sesjach sciezki, w ilu i w jakich rolach. Bramka: assert_editor_tenant().';