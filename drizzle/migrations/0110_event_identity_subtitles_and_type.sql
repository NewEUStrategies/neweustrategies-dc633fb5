ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS subtitle_pl text,
  ADD COLUMN IF NOT EXISTS subtitle_en text;

COMMENT ON COLUMN public.events.subtitle_pl IS 'Krotki podtytul wydarzenia w jezyku polskim, prezentowany oddzielnie od nazwy.';
COMMENT ON COLUMN public.events.subtitle_en IS 'Krotki podtytul wydarzenia w jezyku angielskim, prezentowany oddzielnie od nazwy.';

GRANT SELECT (subtitle_pl, subtitle_en) ON public.events TO anon, authenticated;
GRANT ALL ON public.events TO service_role;

DROP FUNCTION IF EXISTS public.admin_event_detail(uuid);
CREATE OR REPLACE FUNCTION public.admin_event_detail(p_event_id uuid)
 RETURNS TABLE(id uuid, slug text, title_pl text, title_en text, subtitle_pl text, subtitle_en text, description_pl text, description_en text, status text, starts_at timestamp with time zone, ends_at timestamp with time zone, timezone text, kind text, format text, registration_mode text, registration_flow text, guest_mode text, visibility text, min_tier_rank integer, chatham_house boolean, capacity integer, ticket_price_cents integer, ticket_currency text, cover_url text, location text, street_address text, city text, region text, postal_code text, country text, video_header_platform text, video_header_id text, social_hashtag text, support_email text, languages text[], home_design text, pages_display_mode text, features jsonb, branding jsonb, external_registration_url text, root_page_id uuid, rsvp_opens_at timestamp with time zone, early_rsvp_rank integer, join_url text, recording_url text, published_at timestamp with time zone, cancelled_at timestamp with time zone, event_type_id uuid, type_key text, type_name_pl text, type_name_en text, type_icon text, type_accent_color text, has_stream boolean, has_recording boolean, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.slug, e.title_pl, e.title_en, e.subtitle_pl, e.subtitle_en, e.description_pl, e.description_en,
    e.status, e.starts_at, e.ends_at, e.timezone, e.kind, e.format,
    e.registration_mode, e.registration_flow, e.guest_mode,
    e.visibility, e.min_tier_rank, e.chatham_house, e.capacity,
    e.ticket_price_cents, e.ticket_currency, e.cover_url, e.location,
    e.street_address, e.city, e.region, e.postal_code, e.country,
    e.video_header_platform, e.video_header_id, e.social_hashtag, e.support_email,
    e.languages, e.home_design, e.pages_display_mode, e.features, e.branding,
    e.external_registration_url, e.root_page_id,
    e.rsvp_opens_at, e.early_rsvp_rank,
    e.join_url, e.recording_url,
    e.published_at, e.cancelled_at,
    e.event_type_id, et.key, et.name_pl, et.name_en, et.icon, et.accent_color,
    (e.join_url IS NOT NULL),
    (e.recording_url IS NOT NULL),
    e.created_at, e.updated_at
  FROM public.events e
  LEFT JOIN public.event_types et
    ON et.id = e.event_type_id AND et.tenant_id = v_tenant
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_event_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_detail(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.event_page_header(text);
CREATE OR REPLACE FUNCTION public.event_page_header(p_slug text)
 RETURNS TABLE(id uuid, slug text, title_pl text, title_en text, subtitle_pl text, subtitle_en text, description_pl text, description_en text, kind text, format text, event_type_id uuid, type_key text, type_name_pl text, type_name_en text, type_icon text, type_accent_color text, starts_at timestamp with time zone, ends_at timestamp with time zone, timezone text, has_ended boolean, location text, cover_url text, branding jsonb, root_page_id uuid, visibility text, guest_mode text, min_tier_rank integer, chatham_house boolean, chatham_house_locked boolean, tier_locked boolean, viewer_tier_rank integer, capacity integer, seats_left integer, registration_mode text, registration_flow text, registration_state text, external_registration_url text, rsvp_opens_at timestamp with time zone, ticket_price_cents integer, ticket_currency text, my_registration_status text, my_waitlist_position integer, my_rsvp_status text, is_bookmarked boolean, has_stream boolean, has_recording boolean, speakers_count integer, sessions_count integer, sponsors_count integer, published_at timestamp with time zone, cancelled_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF v_tenant IS NULL OR v_slug IS NULL THEN RETURN; END IF;

  SELECT * INTO v_event FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = v_slug AND e.status = 'published';
  IF v_event.id IS NULL THEN RETURN; END IF;

  v_seats_left := public._event_page_seats_left(v_tenant, v_event.id);
  v_has_ended := COALESCE(v_event.ends_at, v_event.starts_at) < now();
  v_tier_ok := CASE
    WHEN v_event.visibility = 'members' THEN public.has_tier_rank(GREATEST(COALESCE(v_event.min_tier_rank, 0), 1))
    ELSE public.has_tier_rank(COALESCE(v_event.min_tier_rank, 0))
  END;

  SELECT count(*)::integer INTO v_active_tickets FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;

  v_state := CASE
    WHEN v_event.cancelled_at IS NOT NULL THEN 'event_cancelled'
    WHEN v_has_ended THEN 'event_ended'
    WHEN v_event.registration_mode = 'none' THEN 'registration_disabled'
    WHEN v_event.registration_mode = 'external' THEN 'registration_external'
    WHEN v_event.rsvp_opens_at IS NOT NULL AND v_event.rsvp_opens_at > now()
      AND NOT (v_event.early_rsvp_rank IS NOT NULL AND public.has_tier_rank(v_event.early_rsvp_rank)) THEN 'registration_not_open'
    WHEN NOT v_tier_ok THEN 'membership_required'
    WHEN v_active_tickets = 0 AND v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN 'sold_out'
    ELSE 'open'
  END;

  IF v_uid IS NOT NULL THEN
    SELECT r.status, r.waitlist_position INTO v_my_reg_status, v_my_waitlist
    FROM public.event_registrations r
    JOIN public.event_people pe ON pe.tenant_id = r.tenant_id AND pe.id = r.person_id
    WHERE r.tenant_id = v_tenant AND r.event_id = v_event.id AND pe.user_id = v_uid
      AND r.status NOT IN ('cancelled', 'rejected')
    ORDER BY r.created_at DESC LIMIT 1;

    SELECT rs.status INTO v_my_rsvp FROM public.event_rsvps rs
    WHERE rs.event_id = v_event.id AND rs.tenant_id = v_tenant AND rs.user_id = v_uid;
  END IF;

  RETURN QUERY
  SELECT
    v_event.id, v_event.slug, v_event.title_pl, v_event.title_en,
    v_event.subtitle_pl, v_event.subtitle_en,
    v_event.description_pl, v_event.description_en, v_event.kind, v_event.format,
    v_event.event_type_id, et.key, et.name_pl, et.name_en, et.icon, et.accent_color,
    v_event.starts_at, v_event.ends_at, v_event.timezone, v_has_ended,
    v_event.location, v_event.cover_url, v_event.branding, v_event.root_page_id,
    v_event.visibility, v_event.guest_mode, v_event.min_tier_rank, v_event.chatham_house,
    (v_event.chatham_house AND NOT public.has_tier_feature('chatham_house_events')),
    (NOT v_tier_ok), v_rank, v_event.capacity, v_seats_left,
    v_event.registration_mode, v_event.registration_flow, v_state,
    v_event.external_registration_url, v_event.rsvp_opens_at,
    v_event.ticket_price_cents, v_event.ticket_currency,
    v_my_reg_status, v_my_waitlist, v_my_rsvp,
    (v_uid IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.event_bookmarks b
      WHERE b.tenant_id = v_tenant AND b.event_id = v_event.id AND b.user_id = v_uid
    )),
    (v_event.join_url IS NOT NULL), (v_event.recording_url IS NOT NULL),
    (SELECT count(DISTINCT sp.user_id)::integer FROM public.event_speakers sp WHERE sp.event_id = v_event.id),
    (SELECT count(*)::integer FROM public.event_sessions s
      WHERE s.tenant_id = v_tenant AND s.event_id = v_event.id AND s.status = 'published' AND s.is_private = false),
    (SELECT count(*)::integer FROM public.event_sponsors sn
      WHERE sn.tenant_id = v_tenant AND sn.event_id = v_event.id AND sn.is_published),
    v_event.published_at, v_event.cancelled_at
  FROM (SELECT 1) AS one
  LEFT JOIN public.event_types et ON et.id = v_event.event_type_id AND et.tenant_id = v_tenant;
END;
$function$;

REVOKE ALL ON FUNCTION public.event_page_header(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_page_header(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_event_general_save_v2(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid;
  v_type_id uuid;
BEGIN
  v_id := public.admin_event_general_save(p_payload);

  IF p_payload ? 'event_type_id' THEN
    v_type_id := NULLIF(btrim(COALESCE(p_payload->>'event_type_id', '')), '')::uuid;
    IF v_type_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.event_types et
      WHERE et.id = v_type_id AND et.tenant_id = v_tenant AND et.is_active
    ) THEN
      RAISE EXCEPTION 'invalid_event_type: choose an active event type';
    END IF;
  END IF;

  UPDATE public.events e SET
    subtitle_pl = CASE WHEN p_payload ? 'subtitle_pl'
      THEN NULLIF(btrim(COALESCE(p_payload->>'subtitle_pl', '')), '') ELSE e.subtitle_pl END,
    subtitle_en = CASE WHEN p_payload ? 'subtitle_en'
      THEN NULLIF(btrim(COALESCE(p_payload->>'subtitle_en', '')), '') ELSE e.subtitle_en END,
    event_type_id = CASE WHEN p_payload ? 'event_type_id' THEN v_type_id ELSE e.event_type_id END,
    kind = CASE WHEN p_payload ? 'event_type_id'
      THEN (SELECT et.key FROM public.event_types et WHERE et.id = v_type_id AND et.tenant_id = v_tenant)
      ELSE e.kind END,
    updated_at = now()
  WHERE e.id = v_id AND e.tenant_id = v_tenant;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_general_save_v2(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_general_save_v2(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_event_general_save_v2(jsonb) IS
  'Atomowy zapis informacji ogolnych wydarzenia, rozszerzony o podtytuly PL/EN oraz aktywny rodzaj wydarzenia.';
