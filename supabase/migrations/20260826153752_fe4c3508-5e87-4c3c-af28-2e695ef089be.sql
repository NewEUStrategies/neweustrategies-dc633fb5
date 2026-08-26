CREATE OR REPLACE FUNCTION public.admin_event_create(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid := public.assert_event_staff_tenant();
  v_type public.event_types;
  v_type_id uuid := NULLIF(p_payload->>'event_type_id', '')::uuid;
  v_title_pl text := btrim(COALESCE(p_payload->>'title_pl', ''));
  v_title_en text := btrim(COALESCE(p_payload->>'title_en', ''));
  v_starts_at timestamptz := NULLIF(p_payload->>'starts_at', '')::timestamptz;
  v_external_url text := NULLIF(btrim(COALESCE(p_payload->>'external_registration_url', '')), '');
  v_timezone text := NULLIF(btrim(COALESCE(p_payload->>'timezone', '')), '');
  v_format text := NULLIF(btrim(COALESCE(p_payload->>'format', '')), '');
  v_city text := NULLIF(btrim(COALESCE(p_payload->>'city', '')), '');
  v_country text := NULLIF(btrim(COALESCE(p_payload->>'country', '')), '');
  v_slug_base text;
  v_slug text;
  v_suffix integer := 1;
  v_kind text;
  v_ends_at timestamptz := NULLIF(p_payload->>'ends_at', '')::timestamptz;
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

  IF v_type.default_registration_mode = 'external' THEN
    IF v_external_url IS NULL THEN
      RAISE EXCEPTION 'external_url_required: type registers externally and needs a url';
    END IF;
    IF v_external_url !~* '^https://[^[:space:]]+$' THEN
      RAISE EXCEPTION 'external_url_invalid: url must start with https';
    END IF;
    IF char_length(v_external_url) > 2048 THEN
      RAISE EXCEPTION 'external_url_invalid: url is too long';
    END IF;
  ELSE
    v_external_url := NULL;
  END IF;

  -- Format podany w kreatorze WYGRYWA z domyslnym formatem rodzaju: organizator
  -- widzi trzy karty formatu na ekranie tworzenia i wybor, ktorego baza by nie
  -- uszanowala, jest kontrolka klamiaca o skutku. Zbior wartosci pilnuje
  -- `events_format_values`, wiec odmowa musi przyjsc z nazwa powodu.
  IF v_format IS NOT NULL AND v_format NOT IN ('onsite', 'online', 'hybrid') THEN
    RAISE EXCEPTION 'invalid_format: format must be onsite, online or hybrid';
  END IF;
  v_format := COALESCE(v_format, v_type.default_format);

  -- Strefa musi byc nazwa IANA znana serwerowi: napis, ktorego Postgres nie zna,
  -- rozjechalby kazde pozniejsze liczenie kolizji sesji.
  IF v_timezone IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_timezone) THEN
    RAISE EXCEPTION 'invalid_timezone: unknown time zone name';
  END IF;

  -- Koniec podany wprost ma pierwszenstwo; brak konca liczymy z czasu trwania
  -- rodzaju, tak jak dotad.
  IF v_ends_at IS NOT NULL AND v_ends_at <= v_starts_at THEN
    RAISE EXCEPTION 'invalid_ends_at: end must be after start';
  END IF;

  IF v_ends_at IS NULL AND v_type.default_duration_minutes IS NOT NULL THEN
    v_ends_at := v_starts_at + make_interval(mins => v_type.default_duration_minutes);
  END IF;

  IF v_city IS NOT NULL AND char_length(v_city) > 160 THEN
    RAISE EXCEPTION 'invalid_city: city name is too long';
  END IF;
  IF v_country IS NOT NULL AND char_length(v_country) > 160 THEN
    RAISE EXCEPTION 'invalid_country: country name is too long';
  END IF;

  -- Wydarzenie wylacznie online nie ma miasta: pole zostaloby martwa dana,
  -- ktora po zmianie formatu nagle staje sie adresem, ktorego nikt nie potwierdzil.
  IF v_format = 'online' THEN
    v_city := NULL;
    v_country := NULL;
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
    WHEN v_format = 'online' THEN 'webinar'
    WHEN v_format = 'hybrid' THEN 'hybrid'
    ELSE 'in_person'
  END;

  INSERT INTO public.events (
    tenant_id, slug, title_pl, title_en, starts_at, ends_at,
    status, kind, event_type_id, format,
    registration_mode, registration_flow, guest_mode, external_registration_url,
    capacity, min_tier_rank, chatham_house,
    visibility, created_by, city, country,
    timezone
  ) VALUES (
    v_tenant, v_slug, v_title_pl, v_title_en, v_starts_at, v_ends_at,
    'draft', v_kind, v_type.id, v_format,
    v_type.default_registration_mode, v_type.default_registration_flow,
    v_type.default_guest_mode, v_external_url,
    v_type.default_capacity, v_type.default_min_tier_rank, v_type.default_chatham_house,
    CASE WHEN v_type.default_min_tier_rank > 0 THEN 'members' ELSE 'public' END,
    auth.uid(), v_city, v_country,
    COALESCE(v_timezone, 'Europe/Warsaw')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;