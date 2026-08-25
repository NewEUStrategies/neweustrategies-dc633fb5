-- ============================================================================
-- Event Builder: SZESC PODMODULOW STAJE SIE ADMINISTRACYJNYCH
--
-- DECYZJA WLASCICIELA PRODUKTU. Agenda, zapisy, sponsorzy, obsluga na miejscu,
-- regulaminy i gielda spotkan maja byc dostepne WYLACZNIE dla administratora.
-- Ekrany tych szesciu tras juz tak dzialaja (`if (!isAdmin)`), ale baza je
-- otwierala szerzej - `assert_editor_tenant()` wpuszczala takze redaktora.
--
-- DLACZEGO POPRAWKA IDZIE DO BAZY, A NIE DO EKRANU. Ekran nie jest granica
-- bezpieczenstwa. Redaktor moze wolac RPC z pominieciem interfejsu - przez
-- klienta Supabase, przez konsole przegladarki, przez zwykly HTTP - i czytac
-- zapisy uczestnikow, dane kontaktowe sponsorow oraz leady zeskanowane na
-- miejscu. Warunek w komponencie React zatrzymuje tylko tego, kto go widzi.
--
-- PROBLEM DO ROZWIAZANIA. Bramke wola 163 razy dziewiec migracji modulu.
-- Migracje sa forward-only, wiec nazwy w tych wywolaniach nie da sie zmienic
-- w miejscu, a przepisanie 160 funkcji `CREATE OR REPLACE` (kazda wymaga
-- PELNEJ definicji) to migracja rzedu pietnastu tysiecy linii - i pietnascie
-- tysiecy okazji na literowke w ciele, ktorego nikt nie przeczyta drugi raz.
--
-- ROZWIAZANIE: DWIE UCZCIWE NAZWY PLUS JEDEN JAWNIE WYCOFANY ALIAS.
--   `assert_event_admin_tenant()` - NOWA, admin albo super_admin. To jest
--       bramka, ktora od dzis obowiazuje w szesciu podmodulach.
--   `assert_event_staff_tenant()` - NOWA, admin, editor albo super_admin.
--       Uzywaja jej WYLACZNIE trzy funkcje ekranu LISTY wydarzen, ktory ma
--       zostac dostepny dla redakcji.
--   `assert_editor_tenant()` - WYCOFANA. Zostaje jako cienki alias, ktory
--       deleguje do `assert_event_admin_tenant()`. Dzieki temu 160 istniejacych
--       wywolan zmienia zachowanie bez przepisywania cial.
--
-- UCZCIWIE O KOSZCIE TEGO WYBORU. W bazie zostaje funkcja, ktorej nazwa mowi
-- `editor`, a ktora redaktora ODRZUCA. To jest mylace i bedzie mylace zawsze -
-- dlatego jej komentarz zaczyna sie od slowa WYCOFANA i wskazuje nastepce.
-- Nowy kod NIE MA prawa jej wolac; od tego jest `assert_event_admin_tenant()`.
--
-- CO SIE NIE ZMIENIA. Katalog rodzajow wydarzen stal na `assert_admin_tenant()`
-- od poczatku i pozostaje bez zmian. Ekran listy wydarzen dziala dalej dla
-- redakcji - jego trzy funkcje sa nizej przepiete na bramke staffa.
--
-- IZOLACJA NAJEMCOW BEZ ZMIAN. Wszystkie trzy bramki zwracaja tenanta DOMOWEGO
-- wolajacego z `profiles`, czyli `_caller_tenant()`. Zaden z nich nie dotyka
-- `public_tenant_id()` - naglowek Host jest falsyfikowalny, a to sa bramki
-- plaszczyzny administracyjnej.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) BRAMKA ADMINISTRACYJNA MODULU
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_event_admin_tenant()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  -- Inwariant aplikacji: super_admin >= admin. Klient liczy tak samo
  -- (`useAuth`: isAdmin = isSuperAdmin || roles.includes("admin")), wiec bramka,
  -- ktora wpuszcza administratora i odbija super administratora, jest bledna.
  IF NOT (
    public.has_role(v_uid, 'admin'::app_role)
    OR public.is_super_admin(v_uid)
  ) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = v_uid;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: caller has no tenant';
  END IF;

  RETURN v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_event_admin_tenant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_event_admin_tenant() TO authenticated, service_role;

COMMENT ON FUNCTION public.assert_event_admin_tenant() IS
  'Bramka administracyjna modulu Wydarzen: admin albo super_admin, nigdy editor ani author. Zwraca tenanta domowego wolajacego. Od 20260824090000 obowiazuje w agendzie, zapisach, sponsorach, obsludze na miejscu, regulaminach i gieldzie spotkan.';

-- ----------------------------------------------------------------------------
-- 2) BRAMKA STAFFA - WYLACZNIE EKRAN LISTY WYDARZEN
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_event_staff_tenant()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  -- Rola `author` NIE wystarcza. `is_staff()` ja obejmuje, wiec swiadomie go tu
  -- nie uzywamy: autor pisze wpisy, ale nie oglada listy wydarzen organizacji.
  IF NOT (
    public.has_role(v_uid, 'admin'::app_role)
    OR public.has_role(v_uid, 'editor'::app_role)
    OR public.is_super_admin(v_uid)
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

REVOKE ALL ON FUNCTION public.assert_event_staff_tenant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_event_staff_tenant() TO authenticated, service_role;

COMMENT ON FUNCTION public.assert_event_staff_tenant() IS
  'Bramka staffa redakcyjnego: admin, editor albo super_admin; odrzuca role author. Uzywaja jej WYLACZNIE trzy funkcje ekranu listy wydarzen (admin_events_list, admin_events_counts, admin_event_create). Kazda inna powierzchnia modulu stoi na assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 3) STARA BRAMKA JAKO JAWNIE WYCOFANY ALIAS
--
-- Sto szescdziesiat wywolan w dziewieciu migracjach zmienia zachowanie tutaj,
-- bez przepisywania ani jednego ciala. Sygnatura i typ zwracany bez zmian, wiec
-- zadna z tamtych funkcji nie wymaga rekompilacji.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_editor_tenant()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.assert_event_admin_tenant();
$$;

REVOKE ALL ON FUNCTION public.assert_editor_tenant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_editor_tenant() TO authenticated, service_role;

COMMENT ON FUNCTION public.assert_editor_tenant() IS
  'WYCOFANA - nie wolac w nowym kodzie. Mimo nazwy NIE wpuszcza roli editor: od 20260824090000 deleguje do assert_event_admin_tenant() (admin albo super_admin). Alias istnieje wylacznie po to, zeby 160 istniejacych wywolan w migracjach modulu Wydarzen zmienilo zachowanie bez przepisywania cial funkcji. Nowy kod administracyjny uzywa assert_event_admin_tenant(), a powierzchnia dostepna dla redakcji - assert_event_staff_tenant().';

-- ----------------------------------------------------------------------------
-- 4) EKRAN LISTY WYDARZEN ZOSTAJE DOSTEPNY DLA REDAKCJI
--
-- Trzy funkcje przepisane w calosci, bo `CREATE OR REPLACE` inaczej nie umie.
-- Cialo pochodzi z ich AKTUALNYCH definicji (lista i liczniki z 20260823130000,
-- tworzenie z 20260823136000 - tam dostalo obsluge adresu zapisow zewnetrznych)
-- i rozni sie od nich DOKLADNIE jednym wywolaniem bramki.
-- ----------------------------------------------------------------------------
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
  v_tenant uuid := public.assert_event_staff_tenant();
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
    -- Brak limitu miejsc to NULL, nie zero: "bez limitu" i "brak wolnych" to
    -- dwie rozne odpowiedzi, a zero na liscie czyta sie jako drugie z nich.
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
    -- Filtr rodzaju obejmuje wydarzenia sprzed katalogu: trzymaja rodzaj
    -- w legacy `kind`, wiec bez drugiego czlonu znikalyby z wlasnego rodzaju.
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
  v_tenant uuid := public.assert_event_staff_tenant();
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

CREATE OR REPLACE FUNCTION public.admin_event_create(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_event_staff_tenant();
  v_type public.event_types;
  v_type_id uuid := NULLIF(p_payload->>'event_type_id', '')::uuid;
  v_title_pl text := btrim(COALESCE(p_payload->>'title_pl', ''));
  v_title_en text := btrim(COALESCE(p_payload->>'title_en', ''));
  v_starts_at timestamptz := NULLIF(p_payload->>'starts_at', '')::timestamptz;
  v_external_url text := NULLIF(btrim(COALESCE(p_payload->>'external_registration_url', '')), '');
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

  -- Rodzaj MUSI nalezec do tenanta wolajacego. Bez tego warunku redaktor
  -- tenanta A zaseedowalby wydarzenie ustawieniami tenanta B, podajac obce id.
  SELECT * INTO v_type
  FROM public.event_types et
  WHERE et.id = v_type_id AND et.tenant_id = v_tenant;

  IF v_type.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event type does not exist in this tenant';
  END IF;

  IF NOT v_type.is_active THEN
    RAISE EXCEPTION 'event_type_inactive: type is disabled in this organisation';
  END IF;

  -- Tryb `external` znaczy: zapisy prowadzi obcy system. Warunek
  -- `events_external_mode_requires_url` na `events` wymaga wtedy adresu, wiec
  -- brak adresu nie jest tu „pustym polem" - jest wydarzeniem, ktorego nie da
  -- sie zapisac. Odmowa musi wiec przyjsc Z NAZWA POWODU, a nie jako naruszenie
  -- warunku bazy, bo z komunikatu o warunku formularz nie zbuduje zdania
  -- dla uzytkownika.
  IF v_type.default_registration_mode = 'external' THEN
    IF v_external_url IS NULL THEN
      RAISE EXCEPTION 'external_url_required: type registers externally and needs a url';
    END IF;
    -- Tylko `https`. Adres zapisow trafia do uczestnika jako odnosnik wychodzacy,
    -- a `http` i `javascript:` w tej roli to dwie rozne klasy szkody: pierwsza
    -- to dane zapisu przesylane jawnym tekstem, druga to wykonanie skryptu
    -- w kontekscie naszej strony.
    IF v_external_url !~* '^https://[^[:space:]]+$' THEN
      RAISE EXCEPTION 'external_url_invalid: url must start with https';
    END IF;
    IF char_length(v_external_url) > 2048 THEN
      RAISE EXCEPTION 'external_url_invalid: url is too long';
    END IF;
  ELSE
    -- Adres podany przy trybie, ktory go nie uzywa, byloby martwym polem
    -- w bazie: nikt go nie czyta, a przy zmianie trybu nagle staje sie
    -- aktywnym odnosnikiem, ktorego nikt swiadomie nie zatwierdzil.
    v_external_url := NULL;
  END IF;

  -- Adres z tytulu polskiego: diakrytyki rozkladane (`unaccent` nie jest
  -- gwarantowane, wiec translate na pary), reszta na myslniki.
  v_slug_base := lower(translate(
    v_title_pl,
    'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ',
    'acelnoszzACELNOSZZ'
  ));
  v_slug_base := regexp_replace(v_slug_base, '[^a-z0-9]+', '-', 'g');
  v_slug_base := btrim(v_slug_base, '-');
  v_slug_base := left(v_slug_base, 110);

  -- Tytul zlozony wylacznie ze znakow niealfanumerycznych da pusty adres,
  -- a CHECK wymaga trzech znakow. Wtedy adres bierzemy z klucza rodzaju.
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

  -- Legacy `kind` ma wlasny CHECK z szescioma wartosciami, wiec rodzaj
  -- redakcyjny poza tym zbiorem nie da sie w nia wpisac. Wtedy `kind` bierze
  -- wartosc najblizsza semantycznie formatowi, a zrodlem prawdy jest
  -- `event_type_id`.
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
    registration_mode, registration_flow, guest_mode, external_registration_url,
    capacity, min_tier_rank, chatham_house,
    visibility, created_by
  ) VALUES (
    v_tenant, v_slug, v_title_pl, v_title_en, v_starts_at, v_ends_at,
    'draft', v_kind, v_type.id, v_type.default_format,
    v_type.default_registration_mode, v_type.default_registration_flow,
    v_type.default_guest_mode, v_external_url,
    v_type.default_capacity, v_type.default_min_tier_rank, v_type.default_chatham_house,
    -- Prog rangi wieksze od zera znaczy tresc czlonkowska - widocznosc musi za
    -- tym pojsc, inaczej wydarzenie jest publiczne i jednoczesnie progowane,
    -- czyli widoczne dla wszystkich i niedostepne dla wiekszosci.
    CASE WHEN v_type.default_min_tier_rank > 0 THEN 'members' ELSE 'public' END,
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


COMMENT ON FUNCTION public.admin_events_list(text, uuid, text, text, timestamptz, timestamptz, integer, integer) IS
  'Lista wydarzen modulu z filtrami i licznikiem calosci. Od 20260824090000 stoi na assert_event_staff_tenant() - ekran listy zostaje dostepny dla redakcji, w odroznieniu od szesciu podmodulow, ktore stalu sie administracyjne.';
COMMENT ON FUNCTION public.admin_events_counts(uuid, text, text, timestamptz, timestamptz) IS
  'Liczniki wydarzen per status pod zakladki listy. Bramka staffa redakcyjnego, tak samo jak lista.';
COMMENT ON FUNCTION public.admin_event_create(jsonb) IS
  'Tworzy wydarzenie z domyslnych ustawien rodzaju. Bramka staffa redakcyjnego. Wejscie: event_type_id, title_pl, title_en, starts_at oraz external_registration_url - wymagany wtedy i tylko wtedy, gdy rodzaj zapisuje uczestnikow w obcym systemie.';
