DROP FUNCTION IF EXISTS public.admin_event_detail(p_event_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_detail(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  slug text,
  title_pl text,
  title_en text,
  description_pl text,
  description_en text,
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
  street_address text,
  city text,
  region text,
  postal_code text,
  country text,
  video_header_platform text,
  video_header_id text,
  social_hashtag text,
  support_email text,
  languages text[],
  home_design text,
  pages_display_mode text,
  features jsonb,
  branding jsonb,
  external_registration_url text,
  root_page_id uuid,
  rsvp_opens_at timestamptz,
  early_rsvp_rank integer,
  join_url text,
  recording_url text,
  published_at timestamptz,
  cancelled_at timestamptz,
  event_type_id uuid,
  type_key text,
  type_name_pl text,
  type_name_en text,
  type_icon text,
  type_accent_color text,
  has_stream boolean,
  has_recording boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.slug, e.title_pl, e.title_en, e.description_pl, e.description_en,
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
$$;

REVOKE ALL ON FUNCTION public.admin_event_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_detail(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_detail(uuid) IS
  'Jedno wydarzenie w calosci dla studia wydarzenia, razem z adresem transmisji i nagrania - te dwa sa odciete od klienta grantem kolumnowym i wracaja tylko tutaj, za asercja roli redaktora.';

DROP FUNCTION IF EXISTS public.admin_event_general_save(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_general_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event public.events;
  v_slug text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_format text;
  v_cover text;
  v_video_platform text;
  v_video_id text;
  v_support text;
  v_hashtag text;
  v_guest_mode text;
  v_languages text[];
  v_reg_mode text;
  v_reg_flow text;
  v_external text;
  v_visibility text;
  v_currency text;
  v_capacity integer;
  v_min_tier integer;
  v_early_rank integer;
  v_price integer;
  v_join text;
  v_recording text;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_event: event id is required';
  END IF;

  SELECT * INTO v_event FROM public.events e
  WHERE e.id = v_id AND e.tenant_id = v_tenant;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  IF p_payload ? 'title_pl' AND btrim(COALESCE(p_payload->>'title_pl', '')) = '' THEN
    RAISE EXCEPTION 'invalid_titles: both titles are required';
  END IF;
  IF p_payload ? 'title_en' AND btrim(COALESCE(p_payload->>'title_en', '')) = '' THEN
    RAISE EXCEPTION 'invalid_titles: both titles are required';
  END IF;

  v_slug := CASE
    WHEN p_payload ? 'slug' THEN lower(btrim(COALESCE(p_payload->>'slug', '')))
    ELSE v_event.slug
  END;

  IF v_slug !~ '^[a-z0-9-]{3,120}$' THEN
    RAISE EXCEPTION 'invalid_slug: slug must be 3-120 chars of a-z, 0-9 and dashes';
  END IF;

  IF v_slug <> v_event.slug AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.tenant_id = v_tenant AND e.slug = v_slug AND e.id <> v_id
  ) THEN
    RAISE EXCEPTION 'slug_taken: another event already uses this address';
  END IF;

  v_starts := CASE
    WHEN p_payload ? 'starts_at' THEN NULLIF(p_payload->>'starts_at', '')::timestamptz
    ELSE v_event.starts_at
  END;
  IF v_starts IS NULL THEN
    RAISE EXCEPTION 'invalid_starts_at: start date is required';
  END IF;

  v_ends := CASE
    WHEN p_payload ? 'ends_at' THEN NULLIF(p_payload->>'ends_at', '')::timestamptz
    ELSE v_event.ends_at
  END;
  IF v_ends IS NOT NULL AND v_ends <= v_starts THEN
    RAISE EXCEPTION 'invalid_ends_at: end must be after the start';
  END IF;

  v_format := CASE
    WHEN p_payload ? 'format' THEN NULLIF(btrim(COALESCE(p_payload->>'format', '')), '')
    ELSE v_event.format
  END;
  IF v_format IS NULL OR v_format NOT IN ('onsite', 'online', 'hybrid') THEN
    RAISE EXCEPTION 'invalid_format: format must be onsite, online or hybrid';
  END IF;

  v_cover := CASE
    WHEN p_payload ? 'cover_url' THEN NULLIF(btrim(COALESCE(p_payload->>'cover_url', '')), '')
    ELSE v_event.cover_url
  END;

  v_video_platform := CASE
    WHEN p_payload ? 'video_header_platform'
      THEN NULLIF(btrim(COALESCE(p_payload->>'video_header_platform', '')), '')
    ELSE v_event.video_header_platform
  END;
  v_video_id := CASE
    WHEN p_payload ? 'video_header_id'
      THEN NULLIF(btrim(COALESCE(p_payload->>'video_header_id', '')), '')
    ELSE v_event.video_header_id
  END;

  IF v_video_platform IS NOT NULL AND v_video_platform NOT IN ('youtube', 'vimeo') THEN
    RAISE EXCEPTION 'invalid_video_platform: platform must be youtube or vimeo';
  END IF;
  IF v_video_id IS NULL THEN
    v_video_platform := NULL;
  ELSIF v_video_platform IS NULL THEN
    v_video_platform := 'youtube';
  END IF;
  IF v_video_id IS NOT NULL AND v_cover IS NULL THEN
    RAISE EXCEPTION 'cover_required: a video header still needs a cover image for thumbnails';
  END IF;

  v_support := CASE
    WHEN p_payload ? 'support_email'
      THEN NULLIF(lower(btrim(COALESCE(p_payload->>'support_email', ''))), '')
    ELSE v_event.support_email
  END;
  IF v_support IS NOT NULL AND v_support !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid_support_email: support address is not a valid e-mail';
  END IF;

  v_hashtag := CASE
    WHEN p_payload ? 'social_hashtag'
      THEN NULLIF(btrim(ltrim(COALESCE(p_payload->>'social_hashtag', ''), '#')), '')
    ELSE v_event.social_hashtag
  END;
  IF v_hashtag IS NOT NULL AND v_hashtag !~ '^[A-Za-z0-9_]{1,60}$' THEN
    RAISE EXCEPTION 'invalid_hashtag: hashtag may contain letters, digits and underscores only';
  END IF;

  v_guest_mode := CASE
    WHEN p_payload ? 'guest_mode' THEN lower(btrim(COALESCE(p_payload->>'guest_mode', '')))
    ELSE v_event.guest_mode
  END;
  IF v_guest_mode NOT IN ('hidden', 'teaser', 'full') THEN
    RAISE EXCEPTION 'invalid_guest_mode: guest mode must be hidden, teaser or full';
  END IF;

  v_languages := CASE
    WHEN p_payload ? 'languages' THEN (
      SELECT COALESCE(array_agg(DISTINCT lower(btrim(value))), ARRAY[]::text[])
      FROM jsonb_array_elements_text(COALESCE(p_payload->'languages', '[]'::jsonb)) AS value
      WHERE lower(btrim(value)) ~ '^[a-z]{2}(-[a-z]{2})?$'
    )
    ELSE v_event.languages
  END;
  IF array_length(v_languages, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_languages: pick at least one content language';
  END IF;

  v_reg_mode := CASE
    WHEN p_payload ? 'registration_mode'
      THEN lower(btrim(COALESCE(p_payload->>'registration_mode', '')))
    ELSE v_event.registration_mode
  END;
  IF v_reg_mode NOT IN ('rsvp', 'form', 'external', 'none') THEN
    RAISE EXCEPTION 'invalid_registration_mode: mode must be rsvp, form, external or none';
  END IF;

  v_reg_flow := CASE
    WHEN p_payload ? 'registration_flow'
      THEN lower(btrim(COALESCE(p_payload->>'registration_flow', '')))
    ELSE v_event.registration_flow
  END;
  IF v_reg_flow NOT IN ('instant', 'approval') THEN
    RAISE EXCEPTION 'invalid_registration_flow: flow must be instant or approval';
  END IF;

  v_external := CASE
    WHEN p_payload ? 'external_registration_url'
      THEN NULLIF(btrim(COALESCE(p_payload->>'external_registration_url', '')), '')
    ELSE v_event.external_registration_url
  END;

  IF v_reg_mode = 'external' AND v_external IS NULL THEN
    RAISE EXCEPTION 'external_url_required: this mode registers people elsewhere and needs a url';
  END IF;
  IF v_external IS NOT NULL
    AND (v_external !~* '^https://[^[:space:]]+$' OR char_length(v_external) > 2048) THEN
    RAISE EXCEPTION 'external_url_invalid: url must start with https and be under 2048 chars';
  END IF;

  v_visibility := CASE
    WHEN p_payload ? 'visibility' THEN lower(btrim(COALESCE(p_payload->>'visibility', '')))
    ELSE v_event.visibility
  END;
  IF v_visibility NOT IN ('public', 'members') THEN
    RAISE EXCEPTION 'invalid_visibility: visibility must be public or members';
  END IF;

  v_capacity := CASE
    WHEN p_payload ? 'capacity' THEN NULLIF(btrim(COALESCE(p_payload->>'capacity', '')), '')::integer
    ELSE v_event.capacity
  END;
  IF v_capacity IS NOT NULL AND v_capacity < 1 THEN
    RAISE EXCEPTION 'invalid_capacity: leave it empty for no limit; zero seats is the none mode';
  END IF;

  v_min_tier := CASE
    WHEN p_payload ? 'min_tier_rank'
      THEN COALESCE(NULLIF(btrim(COALESCE(p_payload->>'min_tier_rank', '')), '')::integer, 0)
    ELSE v_event.min_tier_rank
  END;
  IF v_min_tier < 0 THEN
    RAISE EXCEPTION 'invalid_tier_rank: tier rank cannot be negative';
  END IF;

  v_early_rank := CASE
    WHEN p_payload ? 'early_rsvp_rank'
      THEN NULLIF(btrim(COALESCE(p_payload->>'early_rsvp_rank', '')), '')::integer
    ELSE v_event.early_rsvp_rank
  END;
  IF v_early_rank IS NOT NULL AND v_early_rank < 0 THEN
    RAISE EXCEPTION 'invalid_tier_rank: tier rank cannot be negative';
  END IF;

  v_price := CASE
    WHEN p_payload ? 'ticket_price_cents'
      THEN NULLIF(btrim(COALESCE(p_payload->>'ticket_price_cents', '')), '')::integer
    ELSE v_event.ticket_price_cents
  END;
  IF v_price IS NOT NULL AND v_price < 100 THEN
    RAISE EXCEPTION 'invalid_price: leave it empty for a free event; the lowest price is 100';
  END IF;

  v_currency := CASE
    WHEN p_payload ? 'ticket_currency'
      THEN upper(btrim(COALESCE(p_payload->>'ticket_currency', '')))
    ELSE v_event.ticket_currency
  END;
  IF v_currency NOT IN ('PLN', 'EUR') THEN
    RAISE EXCEPTION 'invalid_currency: currency must be PLN or EUR';
  END IF;

  v_join := CASE
    WHEN p_payload ? 'join_url' THEN NULLIF(btrim(COALESCE(p_payload->>'join_url', '')), '')
    ELSE v_event.join_url
  END;
  IF v_join IS NOT NULL AND (v_join !~* '^https://[^[:space:]]+$' OR char_length(v_join) > 2048) THEN
    RAISE EXCEPTION 'invalid_join_url: stream url must start with https';
  END IF;

  v_recording := CASE
    WHEN p_payload ? 'recording_url'
      THEN NULLIF(btrim(COALESCE(p_payload->>'recording_url', '')), '')
    ELSE v_event.recording_url
  END;
  IF v_recording IS NOT NULL
    AND (v_recording !~* '^https://[^[:space:]]+$' OR char_length(v_recording) > 2048) THEN
    RAISE EXCEPTION 'invalid_recording_url: recording url must start with https';
  END IF;

  UPDATE public.events e SET
    title_pl = CASE WHEN p_payload ? 'title_pl'
      THEN btrim(p_payload->>'title_pl') ELSE e.title_pl END,
    title_en = CASE WHEN p_payload ? 'title_en'
      THEN btrim(p_payload->>'title_en') ELSE e.title_en END,
    description_pl = CASE WHEN p_payload ? 'description_pl'
      THEN NULLIF(btrim(COALESCE(p_payload->>'description_pl', '')), '') ELSE e.description_pl END,
    description_en = CASE WHEN p_payload ? 'description_en'
      THEN NULLIF(btrim(COALESCE(p_payload->>'description_en', '')), '') ELSE e.description_en END,
    slug = v_slug,
    starts_at = v_starts,
    ends_at = v_ends,
    timezone = CASE WHEN p_payload ? 'timezone'
      THEN COALESCE(NULLIF(btrim(COALESCE(p_payload->>'timezone', '')), ''), e.timezone)
      ELSE e.timezone END,
    format = v_format,
    cover_url = v_cover,
    video_header_platform = v_video_platform,
    video_header_id = v_video_id,
    location = CASE WHEN p_payload ? 'location'
      THEN NULLIF(btrim(COALESCE(p_payload->>'location', '')), '') ELSE e.location END,
    street_address = CASE WHEN p_payload ? 'street_address'
      THEN NULLIF(btrim(COALESCE(p_payload->>'street_address', '')), '') ELSE e.street_address END,
    city = CASE WHEN p_payload ? 'city'
      THEN NULLIF(btrim(COALESCE(p_payload->>'city', '')), '') ELSE e.city END,
    region = CASE WHEN p_payload ? 'region'
      THEN NULLIF(btrim(COALESCE(p_payload->>'region', '')), '') ELSE e.region END,
    postal_code = CASE WHEN p_payload ? 'postal_code'
      THEN NULLIF(btrim(COALESCE(p_payload->>'postal_code', '')), '') ELSE e.postal_code END,
    country = CASE WHEN p_payload ? 'country'
      THEN NULLIF(btrim(COALESCE(p_payload->>'country', '')), '') ELSE e.country END,
    social_hashtag = v_hashtag,
    support_email = v_support,
    guest_mode = v_guest_mode,
    languages = v_languages,
    home_design = CASE WHEN p_payload ? 'home_design'
      THEN COALESCE(NULLIF(btrim(COALESCE(p_payload->>'home_design', '')), ''), e.home_design)
      ELSE e.home_design END,
    pages_display_mode = CASE WHEN p_payload ? 'pages_display_mode'
      THEN COALESCE(NULLIF(btrim(COALESCE(p_payload->>'pages_display_mode', '')), ''), e.pages_display_mode)
      ELSE e.pages_display_mode END,
    registration_mode = v_reg_mode,
    registration_flow = v_reg_flow,
    external_registration_url = v_external,
    visibility = v_visibility,
    capacity = v_capacity,
    min_tier_rank = v_min_tier,
    early_rsvp_rank = v_early_rank,
    rsvp_opens_at = CASE WHEN p_payload ? 'rsvp_opens_at'
      THEN NULLIF(p_payload->>'rsvp_opens_at', '')::timestamptz ELSE e.rsvp_opens_at END,
    ticket_price_cents = v_price,
    ticket_currency = v_currency,
    chatham_house = CASE WHEN p_payload ? 'chatham_house'
      THEN COALESCE((NULLIF(p_payload->>'chatham_house', ''))::boolean, e.chatham_house)
      ELSE e.chatham_house END,
    join_url = v_join,
    recording_url = v_recording,
    updated_at = now()
  WHERE e.id = v_id AND e.tenant_id = v_tenant;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_general_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_general_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_general_save(jsonb) IS
  'Zapis ustawien wydarzenia ze studia: informacje ogolne, strony i menu, tryb goscia oraz rejestracja i dostep (tryb, przebieg, limit, prog warstwy, cena, transmisja, nagranie). Odmowy sa lustrem warunkow tabeli events. Klucz nieobecny w payloadzie = pole nietkniete.';

DROP FUNCTION IF EXISTS public.admin_event_features_save(p_event_id uuid, p_features jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_features_save(p_event_id uuid, p_features jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_in jsonb := COALESCE(p_features, '{}'::jsonb);
  v_current jsonb;
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_keys text[] := ARRAY[
    'pages', 'registration', 'tickets', 'sessions', 'meetings', 'onsite', 'sponsors'
  ];
BEGIN
  SELECT e.features INTO v_current
  FROM public.events e
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  FOREACH v_key IN ARRAY v_keys LOOP
    IF v_in ? v_key THEN
      IF jsonb_typeof(v_in->v_key) <> 'boolean' THEN
        RAISE EXCEPTION 'invalid_feature: % must be true or false', v_key;
      END IF;
      IF NOT (v_in->>v_key)::boolean THEN
        v_out := v_out || jsonb_build_object(v_key, false);
      END IF;
    ELSIF (v_current->>v_key) = 'false' THEN
      v_out := v_out || jsonb_build_object(v_key, false);
    END IF;
  END LOOP;

  UPDATE public.events e
  SET features = v_out, updated_at = now()
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_features_save(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_features_save(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_features_save(uuid, jsonb) IS
  'Przelaczniki modulow wydarzenia. Biala lista kluczy, zapisywane sa wylacznie WYLACZENIA - klucz nieobecny znaczy modul wlaczony, wiec nowy modul nie znika wydarzeniom sprzed jego powstania.';