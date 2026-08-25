CREATE OR REPLACE FUNCTION public.admin_event_session_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_signups integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_sessions s WHERE s.id = _id AND s.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: session does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_signups
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant
    AND g.session_id = _id
    AND g.status <> 'cancelled';

  IF v_signups > 0 THEN
    RAISE EXCEPTION 'session_has_signups: % active signup(s) - cancel the session instead', v_signups;
  END IF;

  DELETE FROM public.event_sessions WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_session_delete(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_session_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_session_delete(uuid) IS
  'Usuwa sesje bez aktywnych zapisow (razem z jej podsesjami i obsada - kaskada). Sesja z zapisami wymaga odwolania, nie usuniecia.';

CREATE OR REPLACE FUNCTION public.admin_event_sessions_reorder(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_moved integer;
BEGIN
  IF jsonb_typeof(p_payload->'items') <> 'array' THEN
    RAISE EXCEPTION 'invalid_payload: items must be an array of {id, sort_order}';
  END IF;

  UPDATE public.event_sessions s
  SET sort_order = i.sort_order
  FROM (
    SELECT
      (x->>'id')::uuid AS id,
      (x->>'sort_order')::integer AS sort_order
    FROM jsonb_array_elements(p_payload->'items') AS x
    WHERE NULLIF(x->>'id', '') IS NOT NULL
      AND NULLIF(x->>'sort_order', '') IS NOT NULL
  ) i
  WHERE s.id = i.id
    AND s.tenant_id = v_tenant
    AND s.sort_order IS DISTINCT FROM i.sort_order;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sessions_reorder(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_sessions_reorder(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sessions_reorder(jsonb) IS
  'Wsadowa zmiana kolejnosci sesji: {"items":[{"id":uuid,"sort_order":int}]}. Zwraca liczbe przestawionych wierszy. Bramka: assert_editor_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_sessions_set_status(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_status text := COALESCE(NULLIF(p_payload->>'status', ''), '');
  v_ids uuid[];
  v_changed integer := 0;
  v_rec record;
BEGIN
  IF v_status NOT IN ('draft', 'published', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status: status must be draft, published or cancelled';
  END IF;

  IF jsonb_typeof(p_payload->'ids') <> 'array' THEN
    RAISE EXCEPTION 'invalid_payload: ids must be an array of session ids';
  END IF;

  SELECT array_agg((x)::uuid) INTO v_ids
  FROM jsonb_array_elements_text(p_payload->'ids') AS x
  WHERE NULLIF(x, '') IS NOT NULL;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_rec IN
    UPDATE public.event_sessions s
    SET status = v_status,
        published_at = CASE
          WHEN v_status = 'published' THEN COALESCE(s.published_at, now())
          ELSE s.published_at
        END,
        cancelled_at = CASE WHEN v_status = 'cancelled' THEN COALESCE(s.cancelled_at, now()) END
    WHERE s.tenant_id = v_tenant
      AND s.id = ANY (v_ids)
      AND s.status <> v_status
    RETURNING s.id, s.event_id, s.title_pl
  LOOP
    v_changed := v_changed + 1;
    IF v_status IN ('published', 'cancelled') THEN
      PERFORM public.emit_domain_event(
        v_tenant,
        'event_session',
        v_rec.id::text,
        'event_session.' || v_status || '.v1',
        jsonb_build_object(
          'event_id', v_rec.event_id, 'session_id', v_rec.id, 'title_pl', v_rec.title_pl
        ),
        auth.uid()
      );
    END IF;
  END LOOP;

  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sessions_set_status(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_sessions_set_status(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sessions_set_status(jsonb) IS
  'Wsadowa publikacja, wycofanie i odwolanie sesji: {"ids":[uuid],"status":"published"}. Stempluje published_at raz, cancelled_at przy odwolaniu, emituje zdarzenie domenowe. Bramka: assert_editor_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_session_speakers_set(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_session_id uuid := NULLIF(p_payload->>'session_id', '')::uuid;
  v_session public.event_sessions;
  v_keep uuid[] := ARRAY[]::uuid[];
  v_count integer := 0;
  v_item jsonb;
  v_ord integer := 0;
  v_profile uuid;
  v_role text;
  v_sort integer;
  v_allow boolean;
  v_clash text;
BEGIN
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: session_id is required';
  END IF;

  IF jsonb_typeof(p_payload->'speakers') <> 'array' THEN
    RAISE EXCEPTION 'invalid_payload: speakers must be an array';
  END IF;

  SELECT * INTO v_session
  FROM public.event_sessions s
  WHERE s.id = v_session_id AND s.tenant_id = v_tenant;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'not_found: session does not exist in this tenant';
  END IF;

  FOR v_item IN SELECT x FROM jsonb_array_elements(p_payload->'speakers') AS x
  LOOP
    v_ord := v_ord + 1;
    v_profile := NULLIF(v_item->>'speaker_profile_id', '')::uuid;
    v_role := COALESCE(NULLIF(v_item->>'role', ''), 'speaker');
    v_sort := COALESCE((NULLIF(v_item->>'sort_order', ''))::integer, v_ord * 10);
    v_allow := COALESCE((NULLIF(v_item->>'allow_overlap', ''))::boolean, false);

    IF v_profile IS NULL THEN
      RAISE EXCEPTION 'invalid_payload: speaker_profile_id is required for every entry';
    END IF;

    IF v_role NOT IN ('speaker', 'moderator', 'panelist', 'host') THEN
      RAISE EXCEPTION 'invalid_role: role must be speaker, moderator, panelist or host';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.speaker_profiles sp
      WHERE sp.id = v_profile AND sp.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'speaker_not_found: speaker profile does not exist in this tenant';
    END IF;

    IF NOT v_allow AND v_role <> 'host' AND v_session.status <> 'cancelled' THEN
      SELECT s2.title_pl INTO v_clash
      FROM public.event_session_speakers es2
      JOIN public.event_sessions s2
        ON s2.id = es2.session_id AND s2.tenant_id = es2.tenant_id
      WHERE es2.tenant_id = v_tenant
        AND es2.speaker_profile_id = v_profile
        AND es2.session_id <> v_session_id
        AND es2.allow_overlap = false
        AND es2.role <> 'host'
        AND s2.status <> 'cancelled'
        AND s2.time_range && v_session.time_range
      ORDER BY s2.starts_at
      LIMIT 1;

      IF v_clash IS NOT NULL THEN
        RAISE EXCEPTION 'speaker_overlap: the speaker already appears in "%" at this time', v_clash;
      END IF;
    END IF;

    INSERT INTO public.event_session_speakers (
      tenant_id, event_id, session_id, speaker_profile_id, role, sort_order, allow_overlap
    ) VALUES (
      v_tenant, v_session.event_id, v_session_id, v_profile, v_role, v_sort, v_allow
    )
    ON CONFLICT (tenant_id, session_id, speaker_profile_id) DO UPDATE
      SET role = EXCLUDED.role,
          sort_order = EXCLUDED.sort_order,
          allow_overlap = EXCLUDED.allow_overlap,
          updated_at = now();

    v_keep := v_keep || v_profile;
    v_count := v_count + 1;
  END LOOP;

  DELETE FROM public.event_session_speakers es
  WHERE es.tenant_id = v_tenant
    AND es.session_id = v_session_id
    AND NOT (es.speaker_profile_id = ANY (v_keep));

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_session_speakers_set(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_session_speakers_set(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_session_speakers_set(jsonb) IS
  'Zastepuje CALA obsade sesji: {"session_id":uuid,"speakers":[{speaker_profile_id, role, sort_order, allow_overlap}]}. Odrzuca kolizje prelegenta poza furtka allow_overlap i rola host. Bramka: assert_editor_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_session_signups_list(p_session_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  profile_slug text,
  status text,
  registered_at timestamptz,
  cancelled_at timestamptz,
  added_by_staff boolean,
  waitlist_position integer
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
    g.id, g.user_id, pr.display_name, pr.avatar_url, pr.slug,
    g.status, g.registered_at, g.cancelled_at,
    (g.created_by IS NOT NULL AND g.created_by <> g.user_id),
    CASE
      WHEN g.status = 'waitlist' THEN
        row_number() OVER (
          PARTITION BY g.status ORDER BY g.registered_at, g.id
        )::integer
      ELSE NULL
    END
  FROM public.event_session_signups g
  LEFT JOIN public.profiles pr
    ON pr.id = g.user_id AND pr.tenant_id = v_tenant
  WHERE g.tenant_id = v_tenant
    AND g.session_id = p_session_id
  ORDER BY
    CASE g.status WHEN 'registered' THEN 0 WHEN 'waitlist' THEN 1 ELSE 2 END,
    g.registered_at,
    g.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_session_signups_list(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_session_signups_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_session_signups_list(uuid) IS
  'Zapisy na sesje dla panelu: kto, w jakim statusie, z pozycja na liscie rezerwowej. Bez danych kontaktowych - te naleza do modulu uczestnikow. Bramka: assert_editor_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_agenda_conflicts(p_event_id uuid)
RETURNS TABLE (
  kind text,
  session_id uuid,
  session_title_pl text,
  session_title_en text,
  session_starts_at timestamptz,
  other_session_id uuid,
  other_title_pl text,
  other_title_en text,
  subject_id uuid,
  subject_name text,
  expected_value integer,
  actual_value integer
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
    'speaker_overlap'::text,
    sa.id, sa.title_pl, sa.title_en, sa.starts_at,
    sb.id, sb.title_pl, sb.title_en,
    spf.id, pr.display_name,
    NULL::integer, NULL::integer
  FROM public.event_session_speakers ea
  JOIN public.event_session_speakers eb
    ON eb.tenant_id = ea.tenant_id
   AND eb.speaker_profile_id = ea.speaker_profile_id
   AND eb.session_id <> ea.session_id
  JOIN public.event_sessions sa
    ON sa.id = ea.session_id AND sa.tenant_id = ea.tenant_id
  JOIN public.event_sessions sb
    ON sb.id = eb.session_id AND sb.tenant_id = eb.tenant_id
  JOIN public.speaker_profiles spf
    ON spf.id = ea.speaker_profile_id AND spf.tenant_id = ea.tenant_id
  LEFT JOIN public.profiles pr
    ON pr.id = spf.user_id AND pr.tenant_id = ea.tenant_id
  WHERE ea.tenant_id = v_tenant
    AND sa.event_id = p_event_id
    AND sa.id < sb.id
    AND ea.allow_overlap = false
    AND eb.allow_overlap = false
    AND ea.role <> 'host'
    AND eb.role <> 'host'
    AND sa.status <> 'cancelled'
    AND sb.status <> 'cancelled'
    AND sa.time_range && sb.time_range

  UNION ALL

  SELECT
    'outside_event_window'::text,
    s.id, s.title_pl, s.title_en, s.starts_at,
    NULL::uuid, NULL::text, NULL::text,
    e.id, e.title_pl,
    NULL::integer, NULL::integer
  FROM public.event_sessions s
  JOIN public.events e
    ON e.id = s.event_id AND e.tenant_id = s.tenant_id
  WHERE s.tenant_id = v_tenant
    AND s.event_id = p_event_id
    AND s.status <> 'cancelled'
    AND (
      s.starts_at < e.starts_at
      OR (e.ends_at IS NOT NULL AND s.ends_at > e.ends_at)
    )

  UNION ALL

  SELECT
    'capacity_over_room'::text,
    s.id, s.title_pl, s.title_en, s.starts_at,
    NULL::uuid, NULL::text, NULL::text,
    r.id, r.name,
    r.capacity, s.capacity
  FROM public.event_sessions s
  JOIN public.event_rooms r
    ON r.id = s.room_id AND r.tenant_id = s.tenant_id
  WHERE s.tenant_id = v_tenant
    AND s.event_id = p_event_id
    AND s.status <> 'cancelled'
    AND s.capacity IS NOT NULL
    AND r.capacity IS NOT NULL
    AND s.capacity > r.capacity

  UNION ALL

  SELECT
    'overbooked'::text,
    s.id, s.title_pl, s.title_en, s.starts_at,
    NULL::uuid, NULL::text, NULL::text,
    NULL::uuid, NULL::text,
    s.capacity, g.registered
  FROM public.event_sessions s
  JOIN LATERAL (
    SELECT count(*)::integer AS registered
    FROM public.event_session_signups g0
    WHERE g0.tenant_id = s.tenant_id
      AND g0.session_id = s.id
      AND g0.status = 'registered'
  ) g ON true
  WHERE s.tenant_id = v_tenant
    AND s.event_id = p_event_id
    AND s.status <> 'cancelled'
    AND s.capacity IS NOT NULL
    AND g.registered > s.capacity

  ORDER BY 5, 1;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_agenda_conflicts(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_agenda_conflicts(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_agenda_conflicts(uuid) IS
  'Raport kolizji agendy liczony z danych: kolizja prelegenta, sesja poza oknem wydarzenia, limit ponad pojemnosc sali, zapisy ponad limit. Kolizja sali nie wystepuje - jest niemozliwa (EXCLUDE). Bramka: assert_editor_tenant().';

CREATE OR REPLACE FUNCTION public.event_agenda(p_slug text)
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
  timezone text,
  format text,
  status text,
  sort_order integer,
  chatham_house boolean,
  min_tier_rank integer,
  requires_signup boolean,
  capacity integer,
  registered_count integer,
  seats_left integer,
  track_id uuid,
  track_key text,
  track_name_pl text,
  track_name_en text,
  track_accent_color text,
  room_id uuid,
  room_name text,
  room_floor text,
  has_stream boolean,
  has_recording boolean,
  my_signup_status text,
  access_state text,
  speakers jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    s.starts_at, s.ends_at, v_timezone,
    s.format, s.status, s.sort_order, s.chatham_house, s.min_tier_rank,
    s.requires_signup, s.capacity,
    CASE WHEN s.requires_signup THEN COALESCE(c.registered, 0) ELSE 0 END::integer,
    CASE
      WHEN s.capacity IS NULL THEN NULL
      ELSE GREATEST(s.capacity - COALESCE(c.registered, 0), 0)
    END::integer,
    s.track_id, t.key, t.name_pl, t.name_en, t.accent_color,
    s.room_id, r.name, r.floor,
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
$$;

REVOKE ALL ON FUNCTION public.event_agenda(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.event_agenda(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_agenda(text) IS
  'Publiczna agenda opublikowanego wydarzenia po slugu, w najemcy z naglowka hosta. Oddaje sesje opublikowane i odwolane, bez adresow transmisji (tylko flagi), z liczonym access_state i zapisem wolajacego. Plaszczyzna tresci - zero has_role().';

CREATE OR REPLACE FUNCTION public.event_session_signup(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_session_id uuid := NULLIF(p_payload->>'session_id', '')::uuid;
  v_wanted text := COALESCE(NULLIF(p_payload->>'status', ''), 'registered');
  v_session public.event_sessions;
  v_prev text;
  v_registered integer;
  v_final text;
  v_clash text;
  v_promoted uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL OR v_session_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: session_id is required';
  END IF;

  IF v_wanted NOT IN ('registered', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status: status must be registered or cancelled';
  END IF;

  SELECT * INTO v_session
  FROM public.event_sessions s
  WHERE s.id = v_session_id
    AND s.tenant_id = v_tenant
    AND s.status = 'published'
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'not_found: session is not open for signups';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = v_session.event_id
      AND e.tenant_id = v_tenant
      AND e.status = 'published'
  ) THEN
    RAISE EXCEPTION 'not_found: session is not open for signups';
  END IF;

  IF NOT v_session.requires_signup THEN
    RAISE EXCEPTION 'signup_disabled: this session does not take signups';
  END IF;

  SELECT g.status INTO v_prev
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant AND g.session_id = v_session_id AND g.user_id = v_uid;

  IF v_wanted = 'cancelled' THEN
    IF v_prev IS NULL OR v_prev = 'cancelled' THEN
      RETURN jsonb_build_object('status', 'cancelled', 'promoted', false);
    END IF;

    UPDATE public.event_session_signups
    SET status = 'cancelled', cancelled_at = now()
    WHERE tenant_id = v_tenant AND session_id = v_session_id AND user_id = v_uid;

    IF v_prev = 'registered' THEN
      SELECT g.user_id INTO v_promoted
      FROM public.event_session_signups g
      WHERE g.tenant_id = v_tenant
        AND g.session_id = v_session_id
        AND g.status = 'waitlist'
      ORDER BY g.registered_at, g.id
      LIMIT 1;

      IF v_promoted IS NOT NULL THEN
        UPDATE public.event_session_signups
        SET status = 'registered'
        WHERE tenant_id = v_tenant AND session_id = v_session_id AND user_id = v_promoted;
      END IF;
    END IF;

    SELECT count(*)::integer INTO v_registered
    FROM public.event_session_signups g
    WHERE g.tenant_id = v_tenant AND g.session_id = v_session_id AND g.status = 'registered';

    RETURN jsonb_build_object(
      'status', 'cancelled',
      'promoted', v_promoted IS NOT NULL,
      'registered', v_registered,
      'seats_left', CASE
        WHEN v_session.capacity IS NULL THEN NULL
        ELSE GREATEST(v_session.capacity - v_registered, 0)
      END
    );
  END IF;

  IF v_session.min_tier_rank > 0 AND NOT public.has_tier_rank(v_session.min_tier_rank) THEN
    RAISE EXCEPTION 'tier_required: a higher membership tier is required for this session';
  END IF;

  IF NOT v_session.allow_overlap THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_session.event_id::text || ':' || v_uid::text, 0)
    );

    SELECT s2.title_pl INTO v_clash
    FROM public.event_session_signups g2
    JOIN public.event_sessions s2
      ON s2.id = g2.session_id AND s2.tenant_id = g2.tenant_id
    WHERE g2.tenant_id = v_tenant
      AND g2.user_id = v_uid
      AND g2.status = 'registered'
      AND g2.session_id <> v_session_id
      AND s2.status = 'published'
      AND s2.allow_overlap = false
      AND s2.time_range && v_session.time_range
    ORDER BY s2.starts_at
    LIMIT 1;

    IF v_clash IS NOT NULL THEN
      RAISE EXCEPTION 'overlap_conflict: you are already signed up for "%" at this time', v_clash;
    END IF;
  END IF;

  SELECT count(*)::integer INTO v_registered
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant
    AND g.session_id = v_session_id
    AND g.status = 'registered'
    AND g.user_id <> v_uid;

  v_final := CASE
    WHEN v_session.capacity IS NOT NULL AND v_registered >= v_session.capacity THEN 'waitlist'
    ELSE 'registered'
  END;

  INSERT INTO public.event_session_signups (
    tenant_id, event_id, session_id, user_id, status, registered_at, created_by
  ) VALUES (
    v_tenant, v_session.event_id, v_session_id, v_uid, v_final, now(), v_uid
  )
  ON CONFLICT (tenant_id, session_id, user_id) DO UPDATE
    SET status = EXCLUDED.status,
        registered_at = CASE
          WHEN event_session_signups.status = 'cancelled' THEN now()
          ELSE event_session_signups.registered_at
        END,
        cancelled_at = NULL,
        updated_at = now();

  SELECT count(*)::integer INTO v_registered
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant AND g.session_id = v_session_id AND g.status = 'registered';

  RETURN jsonb_build_object(
    'status', v_final,
    'promoted', false,
    'registered', v_registered,
    'seats_left', CASE
      WHEN v_session.capacity IS NULL THEN NULL
      ELSE GREATEST(v_session.capacity - v_registered, 0)
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_session_signup(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.event_session_signup(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_session_signup(jsonb) IS
  'Zapis albo rezygnacja zalogowanego uczestnika na sesje: {"session_id":uuid,"status":"registered|cancelled"}. Limit pod blokada wiersza sesji, kolizja czasowa pod blokada doradcza, lista rezerwowa z awansem FIFO. Plaszczyzna tresci - zero has_role().';

CREATE OR REPLACE FUNCTION public.event_session_access(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_session public.event_sessions;
  v_signed boolean;
BEGIN
  IF v_tenant IS NULL OR _session_id IS NULL THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'not_found');
  END IF;

  SELECT s.* INTO v_session
  FROM public.event_sessions s
  JOIN public.events e
    ON e.id = s.event_id AND e.tenant_id = s.tenant_id
  WHERE s.id = _session_id
    AND s.tenant_id = v_tenant
    AND s.status = 'published'
    AND e.status = 'published';

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'not_found');
  END IF;

  IF v_session.min_tier_rank > 0 AND NOT public.has_tier_rank(v_session.min_tier_rank) THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'tier_required');
  END IF;

  v_signed := NOT v_session.requires_signup OR EXISTS (
    SELECT 1 FROM public.event_session_signups g
    WHERE g.tenant_id = v_tenant
      AND g.session_id = _session_id
      AND g.user_id = v_uid
      AND g.status = 'registered'
  );

  RETURN jsonb_build_object(
    'can_stream', v_signed,
    'can_watch', true,
    'reason', CASE WHEN v_signed THEN 'granted' ELSE 'signup_required' END,
    'stream_url', CASE WHEN v_signed THEN v_session.stream_url END,
    'recording_url', v_session.recording_url,
    'chatham_house', v_session.chatham_house
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_session_access(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.event_session_access(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_session_access(uuid) IS
  'Serwerowa ocena dostepu do transmisji i nagrania sesji: transmisja wymaga rangi warstwy i zapisu, nagranie tylko rangi warstwy. Bez obejscia stafowego (patrz komentarz). Plaszczyzna tresci.';