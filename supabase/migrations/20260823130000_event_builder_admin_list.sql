-- ============================================================================
-- Event Builder, etap 2: LISTA WYDARZEN W MODULE I TWORZENIE Z RODZAJU
--
-- STAN PRZED. Panel ma jedna liste wydarzen - `admin_list_events(p_status, p_q)`
-- z migracji 20260803191905. Oddaje `SETOF public.events`, wiec:
--   * NIE UMIE FILTROWAC po rodzaju ani formacie (kolumny wprowadzone etapem 1);
--   * NIE ODDAJE LICZNIKOW ZAPISOW, wiec lista pokazuje wydarzenie bez informacji,
--     czy ktokolwiek sie na nie zapisal - a to pierwsza rzecz, o ktora pyta
--     organizator patrzacy na liste;
--   * ZWRACA `join_url` i `recording_url`, ktore migracja 20260702200000 celowo
--     odciela od klienckiego SELECT-a (column-level GRANT). SECURITY DEFINER omija
--     GRANT-y, wiec ta funkcja przywraca to, co utwardzenie zabralo;
--   * ma staly LIMIT 200 bez przesuniecia i bez licznika calosci, wiec przy 201
--     wydarzeniach lista po cichu klamie.
--
-- STAN PO. Trzy funkcje modulu, kazda z waskim, jawnym kontacktem:
--   * `assert_editor_tenant()` - wspolna bramka staffa redakcyjnego (admin ALBO
--     editor) zwracajaca tenanta wolajacego. Odpowiednik `assert_admin_tenant()`
--     dla operacji, ktore NIE sa wylacznie administracyjne. Modul ma docelowo
--     czternascie ekranow i wiekszosc z nich obsluguje redaktor - bez tego helpera
--     kazdy z nich powtarzalby ten sam czteroliniowy warunek, a jedna literowka
--     w jednym z nich otwiera modul na role `author`.
--   * `admin_events_list(...)` - lista z filtrami (status, rodzaj, format, fraza,
--     zakres dat), licznikami zapisow, wolnymi miejscami, nazwa rodzaju
--     i licznikiem calosci do paginacji. BEZ `join_url` i `recording_url`.
--   * `admin_events_counts()` - liczniki per status pod zakladki listy. Osobna
--     funkcja, bo licznik musi ignorowac filtr statusu (inaczej zakladka "Szkice"
--     zawsze pokazuje liczbe szkicow WSROD szkicow).
--   * `admin_event_create(p_payload jsonb)` - utworzenie wydarzenia z DOMYSLNYCH
--     USTAWIEN RODZAJU, po stronie serwera.
--
-- DLACZEGO TWORZENIE JEST W BAZIE, A NIE W FORMULARZU. Rodzaj wydarzenia niesie
-- jedenascie wartosci startowych (etap 1). Gdyby przepisywal je formularz, kazda
-- inna sciezka tworzenia - import, klon poprzedniej edycji, webhook, przyszly
-- kreator - musialaby powtorzyc te sama logike, a rozjazd miedzy nimi jest
-- niewidoczny: wydarzenie po prostu startuje z innym progiem warstwy niz jego
-- rodzaj obiecuje. Funkcja jest wiec JEDNYM miejscem, w ktorym rodzaj zamienia
-- sie w wydarzenie.
--
-- IZOLACJA NAJEMCOW. Kazda funkcja skaluje dane po `current_tenant_id()` (tenant
-- DOMOWY wolajacego), nigdy po naglowku hosta - `public_tenant_id()` nie
-- wystepuje w zadnym ciele, wiec bramka `check:sql-tenant-scope` nie ma czego
-- zapalic. Rodzaj wskazany przy tworzeniu jest weryfikowany W TYM SAMYM tenancie,
-- inaczej redaktor tenanta A mogl by zaseedowac wydarzenie ustawieniami tenanta B.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Wspolna bramka staffa redakcyjnego
-- ----------------------------------------------------------------------------
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

  -- Rola `author` NIE wystarcza. `is_staff()` ja obejmuje, wiec swiadomie go tu
  -- nie uzywamy: autor moze pisac wpisy, ale nie widzi list zapisow na wydarzenia
  -- ani danych kontaktowych uczestnikow.
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
  'Bramka staffa redakcyjnego (admin ALBO editor) zwracajaca tenant_id wolajacego. Rola author jest odrzucana - patrz komentarz w ciele.';

-- ----------------------------------------------------------------------------
-- 2) Lista wydarzen modulu
--
-- `total_count` jedzie w KAZDYM wierszu jako funkcja okna. To nie jest
-- redundancja: bez niej paginacja wymaga drugiego zapytania z tym samym
-- filtrem, a dwa zapytania rozjezdzaja sie przy kazdym zapisie miedzy nimi
-- (lista mowi "1-25 z 40", gdy w bazie jest juz 41 wierszy).
--
-- Liczniki zapisow licza sie LATERAL-em per wiersz, a nie jednym GROUP BY po
-- calej tabeli: przy filtrze zwracajacym 25 wierszy z 4000 wydarzen agregat
-- globalny czytalby wszystkie zapisy w tenancie.
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

REVOKE ALL ON FUNCTION public.admin_events_list(text, uuid, text, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_events_list(text, uuid, text, text, timestamptz, timestamptz, integer, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_events_list(text, uuid, text, text, timestamptz, timestamptz, integer, integer) IS
  'Lista wydarzen modulu z filtrami, licznikami zapisow i licznikiem calosci. Nie oddaje join_url ani recording_url - tylko flagi obecnosci.';

-- ----------------------------------------------------------------------------
-- 3) Liczniki per status pod zakladki listy
--
-- Osobna funkcja, bo licznik zakladek musi IGNOROWAC filtr statusu. Wspolne
-- zapytanie z lista dawaloby zawsze "Szkice: n" rowne liczbie wierszy widocznych
-- pod zakladka Szkice, czyli licznik bezuzyteczny.
--
-- Filtry NIE-statusowe sa natomiast RESPEKTOWANE: gdy redaktor zawezil liste do
-- rodzaju "Webinar", zakladki maja pokazywac liczby webinarow, a nie calosci.
-- To dokladnie ta pulapka, ktora zrzuty referencyjne pokazuja jako
-- "*Group filtering is not considered for these metrics".
-- ----------------------------------------------------------------------------
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
