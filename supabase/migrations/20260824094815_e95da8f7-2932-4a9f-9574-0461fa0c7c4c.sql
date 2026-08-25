DROP FUNCTION IF EXISTS public._event_page_seats_left(uuid, uuid);
CREATE FUNCTION public._event_page_seats_left(_tenant uuid, _event_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capacity integer;
  v_left integer;
  v_rsvp_used integer;
BEGIN
  SELECT e.capacity INTO v_capacity
  FROM public.events e
  WHERE e.id = _event_id AND e.tenant_id = _tenant;

  IF NOT FOUND OR v_capacity IS NULL THEN
    RETURN NULL;
  END IF;

  v_left := public._event_seats_left(_tenant, _event_id, NULL);

  SELECT count(*)::integer INTO v_rsvp_used
  FROM public.event_rsvps r
  WHERE r.event_id = _event_id
    AND r.tenant_id = _tenant
    AND r.status = 'going';

  RETURN LEAST(
    COALESCE(v_left, v_capacity),
    GREATEST(v_capacity - COALESCE(v_rsvp_used, 0), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_page_seats_left(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._event_page_seats_left(uuid, uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public._event_page_seats_left(uuid, uuid) IS
  'Wolne miejsca wydarzenia dla plaszczyzny tresci. MNIEJSZA z dwoch liczb: puli zapisow (_event_seats_left, razem z pulami biletow) i puli legacy event_rsvps - obie sciezki zapisu sa zywe, wiec liczba z jednej zanizala by obsadzenie. NULL = bez limitu. Liczy, nie rezerwuje.';

DROP FUNCTION IF EXISTS public.event_page_header(text);
CREATE FUNCTION public.event_page_header(p_slug text)
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
  has_ended boolean,
  location text,
  cover_url text,
  branding jsonb,
  root_page_id uuid,
  visibility text,
  guest_mode text,
  min_tier_rank integer,
  chatham_house boolean,
  chatham_house_locked boolean,
  tier_locked boolean,
  viewer_tier_rank integer,
  capacity integer,
  seats_left integer,
  registration_mode text,
  registration_flow text,
  registration_state text,
  external_registration_url text,
  rsvp_opens_at timestamptz,
  ticket_price_cents integer,
  ticket_currency text,
  my_registration_status text,
  my_waitlist_position integer,
  my_rsvp_status text,
  is_bookmarked boolean,
  has_stream boolean,
  has_recording boolean,
  speakers_count integer,
  sessions_count integer,
  sponsors_count integer,
  published_at timestamptz,
  cancelled_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_slug, '')), '');
  v_event public.events;
  v_rank integer := public.current_tier_rank();
  v_seats_left integer;
  v_has_ended boolean;
  v_tier_ok boolean;
  v_state text;
  v_active_tickets integer;
  v_my_reg_status text;
  v_my_waitlist integer;
  v_my_rsvp text;
BEGIN
  IF v_tenant IS NULL OR v_slug IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.slug = v_slug
    AND e.status = 'published';

  IF v_event.id IS NULL THEN
    RETURN;
  END IF;

  v_seats_left := public._event_page_seats_left(v_tenant, v_event.id);
  v_has_ended := COALESCE(v_event.ends_at, v_event.starts_at) < now();

  v_tier_ok := CASE
    WHEN v_event.visibility = 'members'
      THEN public.has_tier_rank(GREATEST(COALESCE(v_event.min_tier_rank, 0), 1))
    ELSE public.has_tier_rank(COALESCE(v_event.min_tier_rank, 0))
  END;

  SELECT count(*)::integer INTO v_active_tickets
  FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;

  v_state := CASE
    WHEN v_event.cancelled_at IS NOT NULL THEN 'event_cancelled'
    WHEN v_has_ended THEN 'event_ended'
    WHEN v_event.registration_mode = 'none' THEN 'registration_disabled'
    WHEN v_event.registration_mode = 'external' THEN 'registration_external'
    WHEN v_event.rsvp_opens_at IS NOT NULL
      AND v_event.rsvp_opens_at > now()
      AND NOT (
        v_event.early_rsvp_rank IS NOT NULL
        AND public.has_tier_rank(v_event.early_rsvp_rank)
      ) THEN 'registration_not_open'
    WHEN NOT v_tier_ok THEN 'membership_required'
    WHEN v_active_tickets = 0 AND v_seats_left IS NOT NULL AND v_seats_left <= 0
      THEN 'sold_out'
    ELSE 'open'
  END;

  IF v_uid IS NOT NULL THEN
    SELECT r.status, r.waitlist_position
      INTO v_my_reg_status, v_my_waitlist
    FROM public.event_registrations r
    JOIN public.event_people pe
      ON pe.tenant_id = r.tenant_id AND pe.id = r.person_id
    WHERE r.tenant_id = v_tenant
      AND r.event_id = v_event.id
      AND pe.user_id = v_uid
      AND r.status NOT IN ('cancelled', 'rejected')
    ORDER BY r.created_at DESC
    LIMIT 1;

    SELECT rs.status INTO v_my_rsvp
    FROM public.event_rsvps rs
    WHERE rs.event_id = v_event.id
      AND rs.tenant_id = v_tenant
      AND rs.user_id = v_uid;
  END IF;

  RETURN QUERY
  SELECT
    v_event.id,
    v_event.slug,
    v_event.title_pl,
    v_event.title_en,
    v_event.description_pl,
    v_event.description_en,
    v_event.kind,
    v_event.format,
    v_event.event_type_id,
    et.key,
    et.name_pl,
    et.name_en,
    et.icon,
    et.accent_color,
    v_event.starts_at,
    v_event.ends_at,
    v_event.timezone,
    v_has_ended,
    v_event.location,
    v_event.cover_url,
    v_event.branding,
    v_event.root_page_id,
    v_event.visibility,
    v_event.guest_mode,
    v_event.min_tier_rank,
    v_event.chatham_house,
    (v_event.chatham_house AND NOT public.has_tier_feature('chatham_house_events')),
    (NOT v_tier_ok),
    v_rank,
    v_event.capacity,
    v_seats_left,
    v_event.registration_mode,
    v_event.registration_flow,
    v_state,
    v_event.external_registration_url,
    v_event.rsvp_opens_at,
    v_event.ticket_price_cents,
    v_event.ticket_currency,
    v_my_reg_status,
    v_my_waitlist,
    v_my_rsvp,
    (v_uid IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.event_bookmarks b
      WHERE b.tenant_id = v_tenant AND b.event_id = v_event.id AND b.user_id = v_uid
    )),
    (v_event.join_url IS NOT NULL),
    (v_event.recording_url IS NOT NULL),
    (
      SELECT count(DISTINCT sp.user_id)::integer
      FROM public.event_speakers sp
      WHERE sp.event_id = v_event.id
    ),
    (
      SELECT count(*)::integer
      FROM public.event_sessions s
      WHERE s.tenant_id = v_tenant
        AND s.event_id = v_event.id
        AND s.status = 'published'
        AND s.is_private = false
    ),
    (
      SELECT count(*)::integer
      FROM public.event_sponsors sn
      WHERE sn.tenant_id = v_tenant
        AND sn.event_id = v_event.id
        AND sn.is_published
    ),
    v_event.published_at,
    v_event.cancelled_at
  FROM (SELECT 1) AS one
  LEFT JOIN public.event_types et
    ON et.id = v_event.event_type_id AND et.tenant_id = v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.event_page_header(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_page_header(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_page_header(text) IS
  'Komplet naglowka opublikowanego wydarzenia po slugu, w najemcy z naglowka hosta. Jeden wiersz albo zero. Bez join_url i recording_url (tylko flagi - adresy przez get_event_access). Plaszczyzna tresci: zero has_role().';