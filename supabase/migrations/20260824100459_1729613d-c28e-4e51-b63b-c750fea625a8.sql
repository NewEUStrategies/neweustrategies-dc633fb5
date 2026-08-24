DROP FUNCTION IF EXISTS public.events_public_list(uuid, text, text, timestamptz, timestamptz, text, integer, integer);
CREATE FUNCTION public.events_public_list(
  p_type_id uuid DEFAULT NULL,
  p_format text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_scope text DEFAULT 'upcoming',
  p_limit integer DEFAULT 12,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  slug text,
  title_pl text,
  title_en text,
  description_pl text,
  description_en text,
  kind text,
  format text,
  event_type_id uuid,
  type_key text,
  type_name_pl text,
  type_name_en text,
  type_icon text,
  type_accent_color text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  location text,
  cover_url text,
  visibility text,
  min_tier_rank integer,
  tier_locked boolean,
  chatham_house boolean,
  capacity integer,
  seats_left integer,
  registration_mode text,
  ticket_price_cents integer,
  ticket_currency text,
  is_bookmarked boolean,
  has_ended boolean,
  cancelled_at timestamptz,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 12), 1), 60);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
  v_scope text := lower(COALESCE(NULLIF(btrim(COALESCE(p_scope, '')), ''), 'upcoming'));
  v_format text := NULLIF(btrim(COALESCE(p_format, '')), '');
  v_now timestamptz := now();
BEGIN
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  IF v_scope NOT IN ('upcoming', 'past', 'all') THEN
    RAISE EXCEPTION 'invalid_scope: expected upcoming | past | all';
  END IF;

  RETURN QUERY
  SELECT
    e.id, e.slug, e.title_pl, e.title_en, e.description_pl, e.description_en,
    e.kind, e.format, e.event_type_id,
    et.key, et.name_pl, et.name_en, et.icon, et.accent_color,
    e.starts_at, e.ends_at, e.timezone, e.location, e.cover_url,
    e.visibility, e.min_tier_rank,
    NOT CASE
      WHEN e.visibility = 'members'
        THEN public.has_tier_rank(GREATEST(COALESCE(e.min_tier_rank, 0), 1))
      ELSE public.has_tier_rank(COALESCE(e.min_tier_rank, 0))
    END,
    e.chatham_house,
    e.capacity,
    public._event_page_seats_left(v_tenant, e.id),
    e.registration_mode,
    e.ticket_price_cents, e.ticket_currency,
    (v_uid IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.event_bookmarks b
      WHERE b.tenant_id = v_tenant AND b.event_id = e.id AND b.user_id = v_uid
    )),
    (COALESCE(e.ends_at, e.starts_at) < v_now),
    e.cancelled_at,
    count(*) OVER ()::integer
  FROM public.events e
  LEFT JOIN public.event_types et
    ON et.id = e.event_type_id AND et.tenant_id = v_tenant
  WHERE e.tenant_id = v_tenant
    AND e.status = 'published'
    AND (
      v_scope = 'all'
      OR (v_scope = 'upcoming' AND COALESCE(e.ends_at, e.starts_at) >= v_now)
      OR (v_scope = 'past' AND COALESCE(e.ends_at, e.starts_at) < v_now)
    )
    AND (
      p_type_id IS NULL
      OR e.event_type_id = p_type_id
      OR (e.event_type_id IS NULL AND e.kind = (
        SELECT t2.key FROM public.event_types t2
        WHERE t2.id = p_type_id AND t2.tenant_id = v_tenant
      ))
    )
    AND (v_format IS NULL OR v_format = 'all' OR e.format = v_format)
    AND (p_from IS NULL OR e.starts_at >= p_from)
    AND (p_to IS NULL OR e.starts_at <= p_to)
    AND (
      v_q IS NULL
      OR e.title_pl ILIKE '%' || v_q || '%'
      OR e.title_en ILIKE '%' || v_q || '%'
      OR e.location ILIKE '%' || v_q || '%'
      OR e.description_pl ILIKE '%' || v_q || '%'
      OR e.description_en ILIKE '%' || v_q || '%'
    )
  ORDER BY
    CASE WHEN v_scope = 'past' THEN e.starts_at END DESC NULLS LAST,
    CASE WHEN v_scope <> 'past' THEN e.starts_at END ASC NULLS LAST,
    e.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.events_public_list(uuid, text, text, timestamptz, timestamptz, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.events_public_list(uuid, text, text, timestamptz, timestamptz, text, integer, integer)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.events_public_list(uuid, text, text, timestamptz, timestamptz, text, integer, integer) IS
  'Publiczna lista opublikowanych wydarzen najemcy z naglowka hosta: filtry (rodzaj z fallbackiem na legacy kind, format, fraza, zakres dat, zakres czasowy), wolne miejsca, prog warstwy i licznik calosci do paginacji. Plaszczyzna tresci: zero has_role().';

DROP FUNCTION IF EXISTS public.event_bookmark_toggle(jsonb);
CREATE FUNCTION public.event_bookmark_toggle(p_payload jsonb)
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
  v_state boolean := (NULLIF(p_payload->>'state', ''))::boolean;
  v_target uuid;
  v_deleted boolean := false;
  v_created_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to bookmark an event';
  END IF;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  IF v_slug IS NULL AND v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_slug or event_id is required';
  END IF;

  SELECT e.id INTO v_target
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'published'
    AND (
      (v_event_id IS NOT NULL AND e.id = v_event_id)
      OR (v_event_id IS NULL AND e.slug = v_slug)
    );

  IF v_target IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  IF v_state IS DISTINCT FROM false THEN
    INSERT INTO public.event_bookmarks (tenant_id, event_id, user_id)
    VALUES (v_tenant, v_target, v_uid)
    ON CONFLICT (tenant_id, event_id, user_id) DO NOTHING
    RETURNING created_at INTO v_created_at;

    IF v_created_at IS NULL AND v_state IS NULL THEN
      DELETE FROM public.event_bookmarks b
      WHERE b.tenant_id = v_tenant AND b.event_id = v_target AND b.user_id = v_uid;
      v_deleted := true;
    ELSIF v_created_at IS NULL THEN
      SELECT b.created_at INTO v_created_at
      FROM public.event_bookmarks b
      WHERE b.tenant_id = v_tenant AND b.event_id = v_target AND b.user_id = v_uid;
    END IF;
  ELSE
    DELETE FROM public.event_bookmarks b
    WHERE b.tenant_id = v_tenant AND b.event_id = v_target AND b.user_id = v_uid;
    v_deleted := true;
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_target,
    'bookmarked', NOT v_deleted,
    'bookmarked_at', CASE WHEN v_deleted THEN NULL ELSE v_created_at END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_bookmark_toggle(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_bookmark_toggle(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_bookmark_toggle(jsonb) IS
  'Przelacza (bez pola state) albo ustawia (state = true/false) zapamietanie wydarzenia przez wolajacego. Payload: event_slug albo event_id, opcjonalnie state. Najemca z naglowka hosta, uzytkownik z sesji - zadnego z nich nie da sie podac w payloadzie.';

DROP FUNCTION IF EXISTS public.event_bookmarks_mine(text, integer, integer);
CREATE FUNCTION public.event_bookmarks_mine(
  p_scope text DEFAULT 'all',
  p_limit integer DEFAULT 24,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  event_id uuid,
  slug text,
  title_pl text,
  title_en text,
  kind text,
  format text,
  type_name_pl text,
  type_name_en text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  location text,
  cover_url text,
  min_tier_rank integer,
  seats_left integer,
  has_ended boolean,
  cancelled_at timestamptz,
  bookmarked_at timestamptz,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 24), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_scope text := lower(COALESCE(NULLIF(btrim(COALESCE(p_scope, '')), ''), 'all'));
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RETURN;
  END IF;

  IF v_scope NOT IN ('upcoming', 'past', 'all') THEN
    RAISE EXCEPTION 'invalid_scope: expected upcoming | past | all';
  END IF;

  RETURN QUERY
  SELECT
    e.id, e.slug, e.title_pl, e.title_en, e.kind, e.format,
    et.name_pl, et.name_en,
    e.starts_at, e.ends_at, e.timezone, e.location, e.cover_url,
    e.min_tier_rank,
    public._event_page_seats_left(v_tenant, e.id),
    (COALESCE(e.ends_at, e.starts_at) < v_now),
    e.cancelled_at,
    b.created_at,
    count(*) OVER ()::integer
  FROM public.event_bookmarks b
  JOIN public.events e
    ON e.id = b.event_id AND e.tenant_id = b.tenant_id
  LEFT JOIN public.event_types et
    ON et.id = e.event_type_id AND et.tenant_id = v_tenant
  WHERE b.tenant_id = v_tenant
    AND b.user_id = v_uid
    AND e.status = 'published'
    AND (
      v_scope = 'all'
      OR (v_scope = 'upcoming' AND COALESCE(e.ends_at, e.starts_at) >= v_now)
      OR (v_scope = 'past' AND COALESCE(e.ends_at, e.starts_at) < v_now)
    )
  ORDER BY e.starts_at ASC, e.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.event_bookmarks_mine(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_bookmarks_mine(text, integer, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_bookmarks_mine(text, integer, integer) IS
  'Zapamietane wydarzenia WOLAJACEGO w najemcy z naglowka hosta, z licznikiem calosci. Wydarzenie wycofane z publikacji nie wraca, ale wiersz zapamietania zostaje - przywrocenie publikacji przywraca kafel.';

DROP FUNCTION IF EXISTS public.event_ad_placements(text, text);
CREATE FUNCTION public.event_ad_placements(p_slug text, p_position text)
RETURNS TABLE (
  placement_id uuid,
  slot_id uuid,
  ad_position text,
  page_type text,
  config jsonb,
  sort_order integer,
  slot_name text,
  slot_kind text,
  html text,
  script text,
  image_url text,
  image_link text,
  image_alt text,
  width integer,
  height integer,
  requires_consent boolean,
  targeting jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ctx AS (
    SELECT
      public.public_tenant_id() AS tenant_id,
      NULLIF(btrim(COALESCE(p_position, '')), '') AS pos
  ),
  ev AS (
    SELECT e.id, e.tenant_id
    FROM public.events e, ctx c
    WHERE c.tenant_id IS NOT NULL
      AND e.tenant_id = c.tenant_id
      AND e.slug = NULLIF(btrim(COALESCE(p_slug, '')), '')
      AND e.status = 'published'
  )
  SELECT
    p.id,
    p.slot_id,
    p.position::text,
    p.page_type::text,
    p.config,
    p.sort_order,
    s.name,
    s.kind::text,
    s.html,
    s.script,
    s.image_url,
    s.image_link,
    s.image_alt,
    s.width,
    s.height,
    s.requires_consent,
    s.targeting
  FROM public.ad_placements p
  JOIN ev ON ev.tenant_id = p.tenant_id
  JOIN ctx c ON true
  JOIN public.ad_slots s
    ON s.id = p.slot_id AND s.tenant_id = p.tenant_id AND s.status = 'active'
  WHERE p.active
    AND p.position::text = c.pos
    AND p.page_type::text IN ('all', 'event')
    AND (p.page_id IS NULL OR p.page_id = ev.id)
    AND (p.starts_at IS NULL OR p.starts_at <= now())
    AND (p.ends_at IS NULL OR p.ends_at > now())
  ORDER BY p.sort_order, p.id;
$$;

REVOKE ALL ON FUNCTION public.event_ad_placements(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_ad_placements(text, text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_ad_placements(text, text) IS
  'Kreacje reklamowe do emisji na stronie wydarzenia (po slugu i pozycji), w najemcy z naglowka hosta. Uwzglednia page_type all oraz event (EB-937) i przypiecie ad_placements.page_id do tego wydarzenia. Nie oddaje ad_slots.notes.';