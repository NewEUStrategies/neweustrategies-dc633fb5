-- Studio wydarzenia: kolumny ekranu „Informacje ogolne" + RPC odczytu i zapisu.
--
-- PO CO TA MIGRACJA. Panel wydarzenia dostaje wlasna powierzchnie (sidebar
-- wydarzenia, nie panelu) i pierwszy jej ekran - „Informacje ogolne" - pyta
-- o rzeczy, ktorych `events` dotad nie mialo: adres strukturalny, naglowek
-- wideo, hashtag, adres wsparcia, jezyki tresci oraz dwa ustawienia strony
-- glownej wydarzenia (uklad i tryb prezentacji podstron). Bez tych kolumn ekran
-- musialby albo klamac (pola bez zapisu), albo byc niekompletny.
--
-- ADRES STRUKTURALNY NIE JEST OZDOBA. Bez `street_address`/`city`/`region`/
-- `postal_code`/`country` nie ma `schema.org/Event` z `location.address`, nie ma
-- mapy dojazdu i nie ma „dodaj do kalendarza" z adresem - `events.location`
-- (jedno pole tekstowe) zostaje NAZWA MIEJSCA, a nie calym adresem.
--
-- ZAPIS IDZIE PRZEZ RPC, NIE PRZEZ UPDATE Z KLIENTA. Trzy powody: slug ma
-- unikalnosc w tenancie i wzorzec znakowy (klient nie ma jak sprawdzic kolizji
-- bez wyscigu), `ends_at > starts_at` jest warunkiem bazy, a naglowek wideo bez
-- okladki jest bledem produktowym (miniatura nadal bierze sie z obrazu).
-- Odmowa ma byc jednym, nazwanym bledem, a nie trzema roznymi 23514.

-- ---------------------------------------------------------------------------
-- 1. Kolumny
-- ---------------------------------------------------------------------------

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS street_address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS video_header_platform text,
  ADD COLUMN IF NOT EXISTS video_header_id text,
  ADD COLUMN IF NOT EXISTS social_hashtag text,
  ADD COLUMN IF NOT EXISTS support_email text,
  ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT ARRAY['pl','en']::text[],
  ADD COLUMN IF NOT EXISTS home_design text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS pages_display_mode text NOT NULL DEFAULT 'list',
  ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Warunki dopisywane osobno: ALTER ... ADD COLUMN IF NOT EXISTS nie ma
-- odpowiednika dla CHECK-a, a druga migracja na tej samej kolumnie musi przejsc
-- bez bledu (migracje sa jednokierunkowe i odtwarzane od zera w CI).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_home_design_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_home_design_check
      CHECK (home_design IN ('standard', 'advanced'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_pages_display_mode_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_pages_display_mode_check
      CHECK (pages_display_mode IN ('list', 'grid'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_video_header_platform_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_video_header_platform_check
      CHECK (video_header_platform IS NULL OR video_header_platform IN ('youtube', 'vimeo'));
  END IF;

  -- Naglowek wideo NIE ZWALNIA Z OKLADKI: miniatura w katalogu, w karcie
  -- spolecznosciowej i w e-mailu nadal bierze sie z obrazu. Warunek jest
  -- w bazie, a nie tylko w formularzu, bo wideo da sie ustawic takze importem.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_video_header_requires_cover'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_video_header_requires_cover
      CHECK (video_header_id IS NULL OR cover_url IS NOT NULL);
  END IF;
END;
$$;

COMMENT ON COLUMN public.events.street_address IS 'Adres strukturalny: ulica z numerem. Zrodlo dla schema.org/Event i „dodaj do kalendarza".';
COMMENT ON COLUMN public.events.city IS 'Adres strukturalny: miasto.';
COMMENT ON COLUMN public.events.region IS 'Adres strukturalny: wojewodztwo / stan.';
COMMENT ON COLUMN public.events.postal_code IS 'Adres strukturalny: kod pocztowy.';
COMMENT ON COLUMN public.events.country IS 'Adres strukturalny: kraj (nazwa, nie kod - pole jest przepisywane wprost na strone).';
COMMENT ON COLUMN public.events.video_header_platform IS 'Platforma naglowka wideo: youtube albo vimeo. NULL = brak naglowka wideo.';
COMMENT ON COLUMN public.events.video_header_id IS 'Identyfikator materialu na platformie. Wymaga okladki (events_video_header_requires_cover).';
COMMENT ON COLUMN public.events.social_hashtag IS 'Hashtag wydarzenia bez znaku #. Stopka e-maila, karta spolecznosciowa, widget informacji praktycznych.';
COMMENT ON COLUMN public.events.support_email IS 'Adres wsparcia wydarzenia. NULL = obowiazuje kontakt globalny serwisu.';
COMMENT ON COLUMN public.events.languages IS 'Jezyki TRESCI wydarzenia (kody ISO 639-1) - informacja dla uczestnika, nie przelacznik interfejsu.';
COMMENT ON COLUMN public.events.home_design IS 'Uklad strony glownej wydarzenia: standard (preset) albo advanced (pelna kompozycja w builderze).';
COMMENT ON COLUMN public.events.pages_display_mode IS 'Prezentacja podstron wydarzenia na stronie glownej i w menu: list albo grid.';
COMMENT ON COLUMN public.events.features IS 'Przelaczniki modulow wydarzenia (odpowiednik „Add-on features"). Klucz nieobecny = wartosc z rodzaju wydarzenia.';

-- ---------------------------------------------------------------------------
-- 2. Odczyt jednego wydarzenia dla studia
-- ---------------------------------------------------------------------------
--
-- JEDNO ZAPYTANIE ZAMIAST TABELARYCZNEGO SELECT-a. `join_url` i `recording_url`
-- sa odciete od klienta grantem kolumnowym, a studio musi wiedziec, CZY
-- transmisja i nagranie istnieja. RPC oddaje dwie flagi i nic wiecej - dokladnie
-- jak `admin_events_list`.

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
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
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
  'Jedno wydarzenie w calosci dla studia wydarzenia. Nie oddaje join_url ani recording_url - tylko flagi obecnosci.';

-- ---------------------------------------------------------------------------
-- 3. Zapis ekranu „Informacje ogolne"
-- ---------------------------------------------------------------------------
--
-- KLUCZ NIEOBECNY W PAYLOADZIE = POLE NIETKNIETE. Ekran zapisuje sie w calosci,
-- ale ten sam RPC obsluguje pozniej zapisy czastkowe (np. sam przelacznik
-- „Display mode" z ekranu Strony i menu), a payload z brakiem klucza nie moze
-- kasowac wartosci ustawionej gdzie indziej.

DROP FUNCTION IF EXISTS public.admin_event_general_save(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_general_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
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
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_event: event id is required';
  END IF;

  SELECT * INTO v_event FROM public.events e
  WHERE e.id = v_id AND e.tenant_id = v_tenant;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  -- Tytuly: puste pole znaczy „nie zmieniaj", a nie „skasuj nazwe".
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
  -- Identyfikator bez platformy jest nierenderowalny, a platforma bez
  -- identyfikatora nie ma czego odtworzyc - zerujemy PARE, nie polowe.
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

  -- Hashtag zapisujemy BEZ krzyzyka - znak jest prezentacja, nie trescia.
  v_hashtag := CASE
    WHEN p_payload ? 'social_hashtag'
      THEN NULLIF(btrim(ltrim(COALESCE(p_payload->>'social_hashtag', ''), '#')), '')
    ELSE v_event.social_hashtag
  END;
  IF v_hashtag IS NOT NULL AND v_hashtag !~ '^[A-Za-z0-9_]{1,60}$' THEN
    RAISE EXCEPTION 'invalid_hashtag: hashtag may contain letters, digits and underscores only';
  END IF;

  -- Tryb goscia jest czescia „informacji ogolnych" tylko z punktu widzenia
  -- ZAPISU: ekran, na ktorym stoi, to Grupy i uprawnienia. Kontrakt jest jeden,
  -- bo pole jest jedno - dwa RPC na te sama kolumne to dwa miejsca na regule.
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
    updated_at = now()
  WHERE e.id = v_id AND e.tenant_id = v_tenant;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_general_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_general_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_general_save(jsonb) IS
  'Zapis ekranu Informacje ogolne studia wydarzenia. Klucz nieobecny w payloadzie = pole nietkniete. Pilnuje unikalnosci slugu, kolejnosci dat, pary platforma+identyfikator naglowka wideo i okladki wymaganej przez naglowek wideo.';

-- ---------------------------------------------------------------------------
-- 4. Publikacja i wycofanie wydarzenia (przycisk „Opublikuj" w studiu)
-- ---------------------------------------------------------------------------
--
-- ZNACZNIKI CZASU USTAWIA BAZA, NIE KLIENT. `published_at` i `cancelled_at` sa
-- dowodem, kiedy wydarzenie stalo sie publiczne - wartosc podana z przegladarki
-- jest zegarem przegladarki, a nie faktem.

DROP FUNCTION IF EXISTS public.admin_event_set_status(p_event_id uuid, p_status text);
CREATE OR REPLACE FUNCTION public.admin_event_set_status(p_event_id uuid, p_status text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_status text := lower(btrim(COALESCE(p_status, '')));
  v_event public.events;
BEGIN
  IF v_status NOT IN ('draft', 'published', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status: status must be draft, published or cancelled';
  END IF;

  SELECT * INTO v_event FROM public.events e
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  -- Publikacja bez terminu i bez tytulow to strona, ktora zaraz trzeba zdjac.
  IF v_status = 'published' THEN
    IF btrim(COALESCE(v_event.title_pl, '')) = '' OR btrim(COALESCE(v_event.title_en, '')) = '' THEN
      RAISE EXCEPTION 'invalid_titles: both titles are required before publishing';
    END IF;
    IF v_event.starts_at IS NULL THEN
      RAISE EXCEPTION 'invalid_starts_at: start date is required before publishing';
    END IF;
  END IF;

  UPDATE public.events e SET
    status = v_status,
    published_at = CASE
      WHEN v_status = 'published' THEN COALESCE(e.published_at, now())
      ELSE e.published_at
    END,
    cancelled_at = CASE
      WHEN v_status = 'cancelled' THEN COALESCE(e.cancelled_at, now())
      ELSE NULL
    END,
    updated_at = now()
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;

  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_set_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_set_status(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_set_status(uuid, text) IS
  'Zmiana statusu wydarzenia ze studia (szkic / opublikowane / odwolane). Znaczniki published_at i cancelled_at ustawia baza. Publikacja wymaga obu tytulow i terminu.';

-- ---------------------------------------------------------------------------
-- 5. Branding wydarzenia
-- ---------------------------------------------------------------------------
--
-- KLUCZ NIEOBECNY = DZIEDZICZENIE Z MOTYWU GLOBALNEGO. „Przywroc branding
-- spolecznosci" USUWA klucze, a nie zapisuje wartosci domyslnych - inaczej
-- pozniejsza zmiana motywu globalnego nie dotarlaby do wydarzenia, ktore
-- „zresetowano" (bo mialoby juz wlasna kopie starych kolorow).
--
-- ZBIOR KLUCZY JEST ZAMKNIETY. `branding` to jsonb, wiec bez bialej listy
-- ktokolwiek z rola redaktora moglby wstrzyknac dowolna wartosc do tokenow CSS
-- renderowanych w SSR. Wartosci kolorow przechodza przez wzorzec #RRGGBB,
-- a obrazy tla musza byc adresami https.

DROP FUNCTION IF EXISTS public.admin_event_branding_save(p_event_id uuid, p_branding jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_branding_save(p_event_id uuid, p_branding jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_in jsonb := COALESCE(p_branding, '{}'::jsonb);
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_value text;
  v_color_keys text[] := ARRAY[
    'navigation', 'main_action', 'text', 'blocks_background', 'page_background'
  ];
  v_image_keys text[] := ARRAY['background_image', 'logo', 'logo_dark'];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  -- Tryb prezentacji: jasny albo ciemny. Wartosc spoza zbioru jest odrzucana,
  -- a nie degradowana po cichu - branding jest zapisem swiadomym.
  IF v_in ? 'appearance' THEN
    v_value := lower(btrim(COALESCE(v_in->>'appearance', '')));
    IF v_value NOT IN ('', 'light', 'dark') THEN
      RAISE EXCEPTION 'invalid_appearance: appearance must be light or dark';
    END IF;
    IF v_value <> '' THEN
      v_out := v_out || jsonb_build_object('appearance', v_value);
    END IF;
  END IF;

  FOREACH v_key IN ARRAY v_color_keys LOOP
    IF v_in ? v_key THEN
      v_value := upper(btrim(COALESCE(v_in->>v_key, '')));
      IF v_value <> '' THEN
        IF v_value !~ '^#[0-9A-F]{6}$' THEN
          RAISE EXCEPTION 'invalid_color: % must be a #RRGGBB value', v_key;
        END IF;
        v_out := v_out || jsonb_build_object(v_key, v_value);
      END IF;
    END IF;
  END LOOP;

  FOREACH v_key IN ARRAY v_image_keys LOOP
    IF v_in ? v_key THEN
      v_value := btrim(COALESCE(v_in->>v_key, ''));
      IF v_value <> '' THEN
        IF v_value !~* '^https://[^[:space:]]+$' OR char_length(v_value) > 2048 THEN
          RAISE EXCEPTION 'invalid_image: % must be an https address', v_key;
        END IF;
        v_out := v_out || jsonb_build_object(v_key, v_value);
      END IF;
    END IF;
  END LOOP;

  UPDATE public.events e
  SET branding = v_out, updated_at = now()
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_branding_save(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_branding_save(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_branding_save(uuid, jsonb) IS
  'Branding jednego wydarzenia. Biala lista kluczy, kolory w #RRGGBB, obrazy wylacznie https. Klucz pominiety = dziedziczenie z motywu globalnego.';
