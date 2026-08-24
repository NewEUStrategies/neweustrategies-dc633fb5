CREATE OR REPLACE FUNCTION public.assert_editor_tenant()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'admin'::app_role) OR public.has_role(v_uid, 'editor'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden: editor role required';
  END IF;

  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = v_uid;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: caller has no tenant';
  END IF;

  RETURN v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_editor_tenant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_editor_tenant() TO authenticated, service_role;

COMMENT ON FUNCTION public.assert_editor_tenant() IS
  'Bramka staffa redakcyjnego (admin ALBO editor) zwracajaca tenant_id wolajacego. Rola author jest odrzucana.';

CREATE OR REPLACE FUNCTION public.admin_events_list(
  p_status text DEFAULT NULL,
  p_type_id uuid DEFAULT NULL,
  p_format text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  slug text,
  title_pl text,
  title_en text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  kind text,
  format text,
  registration_mode text,
  registration_flow text,
  guest_mode text,
  visibility text,
  min_tier_rank integer,
  chatham_house boolean,
  capacity integer,
  ticket_price_cents integer,
  ticket_currency text,
  cover_url text,
  location text,
  published_at timestamptz,
  cancelled_at timestamptz,
  event_type_id uuid,
  type_key text,
  type_name_pl text,
  type_name_en text,
  type_icon text,
  type_accent_color text,
  going_count integer,
  interested_count integer,
  waitlist_count integer,
  seats_left integer,
  speakers_count integer,
  has_stream boolean,
  has_recording boolean,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.slug, e.title_pl, e.title_en, e.status,
    e.starts_at, e.ends_at, e.timezone, e.kind, e.format,
    e.registration_mode, e.registration_flow, e.guest_mode,
    e.visibility, e.min_tier_rank, e.chatham_house, e.capacity,
    e.ticket_price_cents, e.ticket_currency, e.cover_url, e.location,
    e.published_at, e.cancelled_at,
    e.event_type_id,
    et.key, et.name_pl, et.name_en, et.icon, et.accent_color,
    COALESCE(r.going, 0)::integer,
    COALESCE(r.interested, 0)::integer,
    COALESCE(r.waitlist, 0)::integer,
    CASE
      WHEN e.capacity IS NULL THEN NULL
      ELSE GREATEST(e.capacity - COALESCE(r.going, 0), 0)
    END::integer,
    COALESCE(s.cnt, 0)::integer,
    (e.join_url IS NOT NULL),
    (e.recording_url IS NOT NULL),
    count(*) OVER ()::integer
  FROM public.events e
  LEFT JOIN public.event_types et
    ON et.id = e.event_type_id AND et.tenant_id = v_tenant
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE rs.status = 'going')::integer AS going,
      count(*) FILTER (WHERE rs.status = 'interested')::integer AS interested,
      count(*) FILTER (WHERE rs.status = 'waitlist')::integer AS waitlist
    FROM public.event_rsvps rs
    WHERE rs.event_id = e.id
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_speakers sp
    WHERE sp.event_id = e.id
  ) s ON true
  WHERE e.tenant_id = v_tenant
    AND (p_status IS NULL OR p_status = 'all' OR e.status = p_status)
    AND (
      p_type_id IS NULL
      OR e.event_type_id = p_type_id
      OR (e.event_type_id IS NULL AND et.key IS NULL AND e.kind = (
        SELECT t2.key FROM public.event_types t2
        WHERE t2.id = p_type_id AND t2.tenant_id = v_tenant
      ))
    )
    AND (p_format IS NULL OR p_format = 'all' OR e.format = p_format)
    AND (p_from IS NULL OR e.starts_at >= p_from)
    AND (p_to IS NULL OR e.starts_at <= p_to)
    AND (
      v_q IS NULL
      OR e.title_pl ILIKE '%' || v_q || '%'
      OR e.title_en ILIKE '%' || v_q || '%'
      OR e.slug ILIKE '%' || v_q || '%'
      OR e.location ILIKE '%' || v_q || '%'
    )
  ORDER BY e.starts_at DESC, e.id DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_events_list(text, uuid, text, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_events_list(text, uuid, text, text, timestamptz, timestamptz, integer, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_events_list(text, uuid, text, text, timestamptz, timestamptz, integer, integer) IS
  'Lista wydarzen modulu z filtrami, licznikami zapisow i licznikiem calosci. Nie oddaje join_url ani recording_url - tylko flagi obecnosci.';

CREATE OR REPLACE FUNCTION public.admin_events_counts(
  p_type_id uuid DEFAULT NULL,
  p_format text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'all', count(*),
    'draft', count(*) FILTER (WHERE e.status = 'draft'),
    'published', count(*) FILTER (WHERE e.status = 'published'),
    'cancelled', count(*) FILTER (WHERE e.status = 'cancelled'),
    'upcoming', count(*) FILTER (WHERE e.status = 'published' AND e.starts_at >= now()),
    'past', count(*) FILTER (WHERE e.status = 'published' AND e.starts_at < now())
  )
  INTO v_out
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND (
      p_type_id IS NULL
      OR e.event_type_id = p_type_id
      OR (e.event_type_id IS NULL AND e.kind = (
        SELECT t2.key FROM public.event_types t2
        WHERE t2.id = p_type_id AND t2.tenant_id = v_tenant
      ))
    )
    AND (p_format IS NULL OR p_format = 'all' OR e.format = p_format)
    AND (p_from IS NULL OR e.starts_at >= p_from)
    AND (p_to IS NULL OR e.starts_at <= p_to)
    AND (
      v_q IS NULL
      OR e.title_pl ILIKE '%' || v_q || '%'
      OR e.title_en ILIKE '%' || v_q || '%'
      OR e.slug ILIKE '%' || v_q || '%'
      OR e.location ILIKE '%' || v_q || '%'
    );

  RETURN COALESCE(v_out, jsonb_build_object(
    'all', 0, 'draft', 0, 'published', 0, 'cancelled', 0, 'upcoming', 0, 'past', 0
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_events_counts(uuid, text, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_events_counts(uuid, text, text, timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_events_counts(uuid, text, text, timestamptz, timestamptz) IS
  'Liczniki wydarzen per status pod zakladki listy. Ignoruje filtr statusu, respektuje pozostale filtry.';

CREATE OR REPLACE FUNCTION public.admin_event_create(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_type public.event_types;
  v_type_id uuid := NULLIF(p_payload->>'event_type_id', '')::uuid;
  v_title_pl text := btrim(COALESCE(p_payload->>'title_pl', ''));
  v_title_en text := btrim(COALESCE(p_payload->>'title_en', ''));
  v_starts_at timestamptz := NULLIF(p_payload->>'starts_at', '')::timestamptz;
  v_slug_base text;
  v_slug text;
  v_suffix integer := 1;
  v_kind text;
  v_ends_at timestamptz;
  v_id uuid;
BEGIN
  IF v_title_pl = '' OR v_title_en = '' THEN
    RAISE EXCEPTION 'invalid_titles: both titles are required';
  END IF;

  IF v_starts_at IS NULL THEN
    RAISE EXCEPTION 'invalid_starts_at: start date is required';
  END IF;

  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'invalid_type: event type is required';
  END IF;

  SELECT * INTO v_type
  FROM public.event_types et
  WHERE et.id = v_type_id AND et.tenant_id = v_tenant;

  IF v_type.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event type does not exist in this tenant';
  END IF;

  IF NOT v_type.is_active THEN
    RAISE EXCEPTION 'event_type_inactive: type is disabled in this organisation';
  END IF;

  v_slug_base := lower(translate(
    v_title_pl,
    'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ',
    'acelnoszzACELNOSZZ'
  ));
  v_slug_base := regexp_replace(v_slug_base, '[^a-z0-9]+', '-', 'g');
  v_slug_base := btrim(v_slug_base, '-');
  v_slug_base := left(v_slug_base, 110);

  IF char_length(v_slug_base) < 3 THEN
    v_slug_base := v_type.key;
  END IF;

  v_slug := v_slug_base;
  WHILE EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.slug = v_slug
  ) LOOP
    v_suffix := v_suffix + 1;
    v_slug := left(v_slug_base, 110) || '-' || v_suffix::text;
  END LOOP;

  v_kind := CASE
    WHEN v_type.key IN ('webinar', 'briefing', 'roundtable', 'ama', 'in_person', 'hybrid')
      THEN v_type.key
    WHEN v_type.default_format = 'online' THEN 'webinar'
    WHEN v_type.default_format = 'hybrid' THEN 'hybrid'
    ELSE 'in_person'
  END;

  v_ends_at := CASE
    WHEN v_type.default_duration_minutes IS NULL THEN NULL
    ELSE v_starts_at + make_interval(mins => v_type.default_duration_minutes)
  END;

  INSERT INTO public.events (
    tenant_id, slug, title_pl, title_en, starts_at, ends_at,
    status, kind, event_type_id, format,
    registration_mode, registration_flow, guest_mode,
    capacity, min_tier_rank, chatham_house,
    visibility, created_by
  ) VALUES (
    v_tenant, v_slug, v_title_pl, v_title_en, v_starts_at, v_ends_at,
    'draft', v_kind, v_type.id, v_type.default_format,
    v_type.default_registration_mode, v_type.default_registration_flow, v_type.default_guest_mode,
    v_type.default_capacity, v_type.default_min_tier_rank, v_type.default_chatham_house,
    CASE WHEN v_type.default_min_tier_rank > 0 THEN 'members' ELSE 'public' END,
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_create(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_create(jsonb) IS
  'Tworzy wydarzenie w statusie draft, przepisujac ustawienia domyslne z rodzaju. Adres generowany z tytulu polskiego z domknieciem unikalnosci.';