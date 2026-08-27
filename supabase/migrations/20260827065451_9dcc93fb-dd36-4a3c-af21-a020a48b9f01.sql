-- ============================================================================
-- PIEC ZAWSZE OBECNYCH STRON WYDARZENIA - Uczestnicy, Prelegenci, Partnerzy,
-- Agenda, Dyskusje.
--
-- PO CO TA MIGRACJA ISTNIEJE
-- Ekran „Strony i menu" mowil „Wydarzenie nie ma jeszcze zadnej strony", bo
-- `admin_event_pages_list` nie mial czego oddac: pozycje menu powstawaly
-- WYLACZNIE recznie, przyciskiem „Nowa strona". Menu wydarzenia bylo wiec
-- puste, a front nie mial czego pokazac. Ta migracja czyni te piec pozycji
-- czescia wydarzenia, a nie czynnoscia redakcji.
--
-- ARCHITEKTURA: PRAWDZIWE WIERSZE `pages` PRZYPIETE W `event_pages`
-- PLUS KOLUMNA-ZNACZNIK `event_pages.module`. Trzy argumenty:
--   (a) `event_pages.page_id uuid NOT NULL REFERENCES public.pages(id)`
--       (20260826120000:70) - pozycja menu bez strony jest dzis w bazie
--       NIEMOZLIWA, wiec wariant „pozycja modulowa bez wiersza pages" wymagalby
--       `DROP NOT NULL` i przepisania czterech RPC;
--   (b) trzy z pieciu modulow maja gotowe szablony ukladu
--       (`src/lib/events/eventPageTemplates.ts`: :119 agenda, :155 prelegenci,
--       :264 partnerzy);
--   (c) znacznik `module` byl w PIERWOTNYM projekcie jako `slot text`
--       (`docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md:546-549`) i wypadl
--       z migracji wdrozeniowej - to powrot do zapisanego projektu, nie nowe
--       pojecie w module.
--
-- ZNACZNIK, A NIE OSOBNA TABELA. `module` jest wlasciwoscia MAPOWANIA, nie
-- strony: ta sama strona przypieta do dwoch wydarzen moze byc agenda jednego
-- i zwyklym zalacznikiem drugiego. Osobna tabela `event_module_pages` trzymalaby
-- te sama krotke (tenant, event, page) w dwoch miejscach i pierwsze rozejscie
-- sie tych dwoch wierszy byloby niewidoczne.
--
-- CZEGO TA MIGRACJA NIE ROBI - swiadomie:
--   * NIE ROBI BACKFILLU dla istniejacych wydarzen. Zasiew idzie leniwie, przy
--     pierwszym wejsciu na ekran „Strony i menu" (patrz krok 4). Trzy argumenty
--     przeciw zasiewowi migracja sa zapisane w 20260823170000:74-89 i wszystkie
--     trzy obowiazuja tu tak samo;
--   * NIE WSTAWIA WIDGETOW MODULOWYCH do tresci tych pieciu stron. Widgety
--     `speakers`, `event-schedule` i `event-sponsors` czytaja dzis RECZNIE
--     WPISANY JSON, nie baze (`src/lib/builder/registry.tsx:1315-1316`
--     `source: "manual"`, `eventId: ""`; `:1354` `days`; `:1449` `tiers`),
--     a kontekstu wydarzenia dla widgetow nie ma (`src/lib/builder/eventContext.ts`
--     NIE ISTNIEJE, zapowiedz EB-902). Wstawienie ich TERAZ opublikowaloby na
--     publicznej stronie wydarzenia ATRAPY z rejestru - czyli nazwiska
--     i poziomy partnerstwa, ktorych nikt nie wpisal. Strona modulowa dostaje
--     wiec naglowek i jedno zdanie, ktore MOWI PRAWDE, a widget dokladamy
--     razem z `eventContext.ts`;
--   * NIE PUBLIKUJE cudzego szkicu korzenia. Zasiew publikuje WYLACZNIE strony,
--     ktore sam zaklada (patrz krok 3);
--   * NIE ZAKLADA TRIGGERA BEFORE DELETE na `event_pages`. Kusi, bo domknelby
--     ochrone pozycji modulowej takze przed `DELETE` wprost z PostgREST - ale
--     `event_pages.page_id` ma `ON DELETE CASCADE` (20260826120000:70), wiec
--     trigger odmawiajacy skasowania zablokowalby USUNIECIE STRONY
--     w `/admin/pages`. Zamiast tego: RPC odmawia (krok 5), a leniwy zasiew
--     ODTWARZA pozycje przy nastepnym wejsciu na ekran.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Kolumna-znacznik
-- ---------------------------------------------------------------------------
--
-- ZBIOR ZAMKNIETY W `CHECK`, nie w kodzie klienta. Znacznik rozstrzyga, czy
-- pozycje wolno odpiac (krok 5) i czy front ma dla niej wlasny widok - literowka
-- w nazwie modulu daje wiec pozycje, ktorej NIE DA SIE ani odpiac, ani obsluzyc.
ALTER TABLE public.event_pages
  ADD COLUMN IF NOT EXISTS module text;

DO $$ BEGIN
  ALTER TABLE public.event_pages
    ADD CONSTRAINT event_pages_module_values
    CHECK (module IS NULL OR module IN
      ('participants', 'speakers', 'partners', 'agenda', 'discussions'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- UNIKAT CZESCIOWY JEST CALA IDEMPOTENCJA ZASIEWU. Bez niego dwa rownolegle
-- wejscia na ekran „Strony i menu" zalozylyby po piec stron kazde, a redaktor
-- zobaczylby dziesiec pozycji i nie mialby jak odgadnac, ktore piec skasowac.
-- `WHERE module IS NOT NULL` jest istotne: pozycji ZWYKLYCH (znacznik NULL)
-- jest w wydarzeniu dowolnie wiele.
CREATE UNIQUE INDEX IF NOT EXISTS event_pages_module_uniq
  ON public.event_pages (tenant_id, event_id, module)
  WHERE module IS NOT NULL;

COMMENT ON COLUMN public.event_pages.module IS
  'Znacznik pozycji modulowej (participants|speakers|partners|agenda|discussions). NULL = zwykla pozycja menu zalozona przez redakcje. Pozycji modulowej NIE WOLNO odpiac - ukrywa sie ja przez in_menu = false.';

-- ---------------------------------------------------------------------------
-- 2. Kanoniczna piatka
-- ---------------------------------------------------------------------------
--
-- WZOROWANE 1:1 NA `_event_default_sections()` (20260823170000:437-448) i z tego
-- samego powodu: lista siedzi W FUNKCJI, a nie w wierszach tabeli, wiec szosty
-- modul dolozony w przyszlosci obejmuje wszystkie wydarzenia naraz i nie wymaga
-- drugiego backfillu.
--
-- IKONA musi pasowac do `event_pages_icon_check` (`^[a-z0-9-]{1,48}$`,
-- 20260826120000:96), KOLOR do `event_pages_color_check` (`^#[0-9A-Fa-f]{6}$`,
-- :94). Nazwy ikon sa z katalogu lucide (`src/lib/icons/lucideIconNodes.generated.ts`),
-- bo rysuje je `DynamicIcon` - nazwa poza katalogiem daje pusty kwadrat.
--
-- IKONA PRELEGENTOW ODBIEGA OD SZABLONU. `eventPageTemplates.ts:155` proponuje
-- dla prelegentow `users`, ale `users` bierze tu pozycja UCZESTNICY - dwie
-- identyczne ikony w jednym menu sa defektem, nie zgodnoscia z szablonem.
-- Prelegenci dostaja `mic`.
--
-- KOLORY SA ZMIERZONE Z PIKSELI ZRZUTU WZORCA
-- `docs/zrzuty/swapcard-2026-08-23/38-preview-event-home-desktop.png` i CZEKAJA
-- NA POTWIERDZENIE WLASCICIELA (pytanie 5.9 specyfikacji). Jesli maja byc
-- z palety marki NES, zmienia je nastepna migracja - jedna funkcja, piec
-- wartosci, zero backfillu.
--
-- TO NIE SA KOLORY GRUP UCZESTNIKOW Z BAZY. Tam jest inna piatka
-- (20260823150000:1184-1195: prelegenci `#7c3aed`, partnerzy `#0d9488`,
-- uczestnicy `#2563eb`) i to sa DWIE ROZNE RZECZY: tamto koloruje przynaleznosc
-- osoby do grupy, to koloruje kafel w menu. Zrownanie ich przez pomylke
-- wygladaloby na porzadek i klamaloby o znaczeniu koloru.
DROP FUNCTION IF EXISTS public._event_default_pages();
CREATE FUNCTION public._event_default_pages()
RETURNS TABLE (
  module text,
  icon text,
  color text,
  sort_order integer,
  title_pl text,
  title_en text,
  intro_pl text,
  intro_en text,
  template_id text
)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT *
  FROM (VALUES
    ('participants', 'users',           '#D73953', 10,
     'Uczestnicy', 'Attendees',
     'Lista uczestników tego wydarzenia pojawi się tutaj.',
     'The list of people attending this event will appear here.',
     NULL::text),
    ('speakers',     'mic',             '#EDAB3E', 20,
     'Prelegenci', 'Speakers',
     'Osoby, które poprowadzą sesje tego wydarzenia.',
     'The people leading the sessions of this event.',
     'event-page-speakers'),
    ('partners',     'handshake',       '#55ABDF', 30,
     'Partnerzy', 'Partners',
     'Instytucje i firmy, bez których to wydarzenie by się nie odbyło.',
     'The institutions and companies that make this event possible.',
     'event-page-sponsors'),
    ('agenda',       'calendar-days',   '#6A48C8', 40,
     'Agenda', 'Agenda',
     'Program może się zmienić - najnowsza wersja jest zawsze na tej stronie.',
     'The programme may change - the latest version is always on this page.',
     'event-page-agenda'),
    ('discussions',  'messages-square', '#74574A', 50,
     'Dyskusje', 'Discussions',
     'Dyskusje otwieramy w dniu wydarzenia.',
     'Discussions open on the day of the event.',
     NULL::text)
  ) AS d(module, icon, color, sort_order, title_pl, title_en, intro_pl, intro_en, template_id);
$fn$;

-- ACL jak kazdego pomocnika `_event_*` tego modulu (20260826120000:225-226).
-- Domyslny ACL funkcji znaczy EXECUTE dla PUBLIC, czyli takze dla `anon`.
REVOKE ALL ON FUNCTION public._event_default_pages() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_default_pages() TO service_role;

COMMENT ON FUNCTION public._event_default_pages() IS
  'Kanoniczna piatka stron modulowych wydarzenia (znacznik, ikona, kolor, kolejnosc, tytuly, wstep, szablon). Zrodlo prawdy zasiewu - szosty modul dopisuje sie tutaj i obejmuje wszystkie wydarzenia naraz.';

-- ---------------------------------------------------------------------------
-- 2b. Dokument buildera strony modulowej
-- ---------------------------------------------------------------------------
--
-- KSZTALT JEST Z `lib/builder/types.ts`, nie wymyslony: sekcja (`kind: section`,
-- `layout.contentWidth = boxed`, `width = 1200`) z jedna kolumna o rozstawie 12
-- i dwoma widgetami - `heading` (`text_pl`/`text_en`/`tag`,
-- `registry.tsx:85`) oraz `text` (`html_pl`/`html_en`, `:162`). To sa dokladnie
-- te wezly, ktore sklada `oneColumn(...)` w `eventPageTemplates.ts:84`.
--
-- BEZ WIDGETU MODULOWEGO - uzasadnienie w naglowku pliku. Strona ma powiedziec
-- prawde, dopoki widget nie umie czytac wydarzenia z bazy.
--
-- FUNKCJA JEST VOLATILE, bo `gen_random_uuid()` jest volatile. Identyfikatory
-- wezlow musza byc rozne w kazdym dokumencie - builder adresuje nimi wezly przy
-- edycji, a dwa wezly o tym samym `id` w jednym dokumencie znaczy, ze edycja
-- jednego rusza drugi.
CREATE OR REPLACE FUNCTION public._event_module_page_document(
  _title_pl text,
  _title_en text,
  _intro_pl text,
  _intro_en text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'version', 1,
    'sections', jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid()::text,
        'kind', 'section',
        'layout', jsonb_build_object(
          'contentWidth', 'boxed',
          'width', 1200,
          'marginBottom', 48
        ),
        'children', jsonb_build_array(
          jsonb_build_object(
            'id', gen_random_uuid()::text,
            'kind', 'column',
            'span', jsonb_build_object('desktop', 12),
            'children', jsonb_build_array(
              jsonb_build_object(
                'id', gen_random_uuid()::text,
                'kind', 'widget',
                'type', 'heading',
                'content', jsonb_build_object(
                  'text_pl', _title_pl,
                  'text_en', _title_en,
                  'tag', 'h1'
                )
              ),
              jsonb_build_object(
                'id', gen_random_uuid()::text,
                'kind', 'widget',
                'type', 'text',
                'content', jsonb_build_object(
                  'html_pl', '<p>' || _intro_pl || '</p>',
                  'html_en', '<p>' || _intro_en || '</p>'
                )
              )
            )
          )
        )
      )
    )
  );
$fn$;

REVOKE ALL ON FUNCTION public._event_module_page_document(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_module_page_document(text, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public._event_module_page_document(text, text, text, text) IS
  'Startowy dokument buildera strony modulowej: naglowek h1 i akapit wstepu. Pomocnik wewnetrzny zasiewu.';

-- ---------------------------------------------------------------------------
-- 3. Zasiew
-- ---------------------------------------------------------------------------
--
-- DLACZEGO `published`, A NIE `draft` - TO JEST BLOKER, KTORY SAM ODTWORZYLBY
-- ZGLOSZONA USTERKE. `event_menu` filtruje pozycje przez
-- `AND pg.status = 'published'` ORAZ `AND public._event_page_chain_published(pg.id)`
-- (20260826120000:795-797), a `admin_event_page_create` wstawia korzen ORAZ
-- strone jako `'draft'` (20260826162459:66 i :89). Zasiew w `'draft'` dalby
-- wiec piec pozycji w panelu i NADAL PUSTE MENU na froncie - czyli dokladnie
-- to, co zglosil wlasciciel, tylko z ladniejszym ekranem w studiu.
--
-- KORZEN TEZ MUSI BYC OPUBLIKOWANY, i to jest drugi bok tego samego bloku:
-- `_event_page_chain_published` wymaga `published` na KAZDYM przodku
-- (20260826120000:265-267), a korzen wydarzenia nie stoi jako pozycja menu,
-- wiec jego szkicowy status nie ma gdzie zostac zauwazony.
--
-- ALE PUBLIKUJEMY WYLACZNIE KORZEN, KTORY ZAKLADAMY SAMI. Korzen istniejacy
-- jako szkic jest DECYZJA redakcji („jeszcze nie pokazujemy tego wydarzenia")
-- i zasiew nie ma prawa jej odwrocic. Skutek jest widoczny w panelu: kolumna
-- ze statusem strony stoi przy kazdym wierszu listy.
--
-- `INSERT` WPROST DO `event_pages`, NIE PRZEZ `admin_event_page_create`.
-- Tamto RPC nie przyjmuje klucza `'color'` (20260826162459:106-112 wstawia
-- wylacznie `icon`, `in_menu`, `sort_order`), a kolor jest tu cala roznica
-- miedzy menu wzorca i piecioma szarymi wierszami. Poza tym tamto RPC stoi na
-- `assert_event_admin_tenant()`, a zasiew wola sie takze z `admin_event_create`,
-- ktore wpuszcza `staff`.
--
-- FUNKCJA JEST IDEMPOTENTNA PO `event_pages_module_uniq`: petla pomija moduly,
-- ktore juz maja wiersz, a `ON CONFLICT DO NOTHING` jest zabezpieczeniem na
-- WYSCIG dwoch rownoleglych wejsc. Gdyby wyscig przegral, strona zalozona
-- chwile wczesniej zostalaby sierota - dlatego przegrany ja kasuje.
CREATE OR REPLACE FUNCTION public._event_seed_default_pages(_tenant uuid, _event_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event public.events;
  v_root uuid;
  v_page_id uuid;
  v_entry_id uuid;
  v_slug text;
  v_try integer;
  v_seeded integer := 0;
  d record;
BEGIN
  IF _tenant IS NULL OR _event_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_event
  FROM public.events e
  WHERE e.id = _event_id AND e.tenant_id = _tenant;

  -- Cicho zero, nie wyjatek: zasiew jest wolany LENIWIE z listy, a lista ma
  -- prawo dostac identyfikator wydarzenia, ktore w tym najemcy nie istnieje
  -- (skasowane w innej karcie). Wyjatek zamienilby to w pusty ekran z bledem.
  IF v_event.id IS NULL THEN
    RETURN 0;
  END IF;

  -- WYJSCIE NA SKROTY. Zasiew biegnie przy KAZDYM wejsciu na ekran „Strony
  -- i menu", wiec typowy przebieg musi byc jednym zapytaniem liczacym, a nie
  -- petla po pieciu modulach z zapytaniem na kazdy.
  IF (
    SELECT count(*) FROM public.event_pages ep
    WHERE ep.tenant_id = _tenant AND ep.event_id = _event_id AND ep.module IS NOT NULL
  ) >= (SELECT count(*) FROM public._event_default_pages()) THEN
    RETURN 0;
  END IF;

  v_root := v_event.root_page_id;

  IF v_root IS NULL THEN
    -- Petla prob jak w `admin_event_page_create` (20260826162459:59-73) i z tego
    -- samego powodu: `_event_unique_page_slug` sprawdza zajetosc SELECT-em,
    -- a INSERT idzie po nim - miedzy jednym a drugim mieszcza sie dwaj
    -- redaktorzy zakladajacy strone o tym samym tytule.
    FOR v_try IN 1..5 LOOP
      BEGIN
        INSERT INTO public.pages (
          tenant_id, slug, title_pl, title_en, status, editor, template_type, menu_order
        ) VALUES (
          _tenant,
          public._event_unique_page_slug(_tenant, v_event.slug),
          v_event.title_pl, v_event.title_en, 'published', 'builder', 'default', 0
        )
        RETURNING id INTO v_root;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_try = 5 THEN RAISE; END IF;
      END;
    END LOOP;

    UPDATE public.events e SET root_page_id = v_root, updated_at = now()
    WHERE e.id = _event_id AND e.tenant_id = _tenant;
  END IF;

  FOR d IN
    SELECT * FROM public._event_default_pages() p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.event_pages ep
      WHERE ep.tenant_id = _tenant
        AND ep.event_id = _event_id
        AND ep.module = p.module
    )
    ORDER BY p.sort_order
  LOOP
    FOR v_try IN 1..5 LOOP
      BEGIN
        -- SLUG JEST PREFIKSOWANY SLUGIEM WYDARZENIA, bo `pages.slug` jest
        -- unikalny W CALYM NAJEMCY (`pages_tenant_slug_uniq`). Bez prefiksu
        -- drugie wydarzenie dostaloby „agenda-2", a to jest adres, ktorego
        -- nikt nie przewidzi, czytajac nazwe wydarzenia.
        v_slug := public._event_unique_page_slug(
          _tenant, v_event.slug || '-' || public._event_slugify(d.title_pl)
        );
        INSERT INTO public.pages (
          tenant_id, parent_id, slug, title_pl, title_en,
          status, editor, template_type, menu_order, builder_data
        ) VALUES (
          _tenant, v_root, v_slug, d.title_pl, d.title_en,
          'published', 'builder', 'default', d.sort_order,
          public._event_module_page_document(d.title_pl, d.title_en, d.intro_pl, d.intro_en)
        )
        RETURNING id INTO v_page_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_try = 5 THEN RAISE; END IF;
      END;
    END LOOP;

    INSERT INTO public.event_pages (
      tenant_id, event_id, page_id, module, icon, color, in_menu, sort_order
    ) VALUES (
      _tenant, _event_id, v_page_id, d.module, d.icon, d.color, true, d.sort_order
    )
    ON CONFLICT (tenant_id, event_id, module) WHERE module IS NOT NULL DO NOTHING
    RETURNING id INTO v_entry_id;

    IF v_entry_id IS NULL THEN
      -- Wyscig przegrany: rownolegly zasiew zdazyl z tym modulem. Strona
      -- zalozona chwile wczesniej nie ma juz do czego nalezec.
      DELETE FROM public.pages WHERE id = v_page_id;
    ELSE
      v_seeded := v_seeded + 1;
    END IF;
  END LOOP;

  -- KORZENIA NIE WYCOFUJEMY, nawet gdy petla nie zalozyla ani jednej strony -
  -- a taki przebieg istnieje: rownolegly zasiew moze wygrac wszystkie piec
  -- modulow. `events.root_page_id` juz na niego wskazuje, a strona glowna
  -- wydarzenia jest potrzebna sama z siebie, wiec jej skasowanie byloby
  -- naprawianiem stanu, ktory nie jest zly.
  RETURN v_seeded;
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_seed_default_pages(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_seed_default_pages(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_seed_default_pages(uuid, uuid) IS
  'Zaklada brakujace strony modulowe wydarzenia (piec z _event_default_pages) razem z korzeniem, od razu jako published. Idempotentna po event_pages_module_uniq. Pomocnik wewnetrzny.';

-- ---------------------------------------------------------------------------
-- 4a. Zasiew na koncu tworzenia wydarzenia
-- ---------------------------------------------------------------------------
--
-- CIALO JEST PRZEPISANE Z 20260826153752 BEZ ZMIAN poza jedna linia
-- `PERFORM public._event_seed_default_pages(...)` przed `RETURN`. Migracje sa
-- jednokierunkowe, wiec dolozenie wywolania wymaga odtworzenia calej funkcji -
-- i to jest cala roznica miedzy tymi dwiema wersjami.
--
-- ZASIEW STOI NA KONCU, PO `INSERT INTO public.events`. Przed nim nie ma czego
-- zasiac: `_event_seed_default_pages` czyta wiersz wydarzenia (slug i tytuly ida
-- do slugu i do tytulu korzenia).
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

  -- PIEC STRON MODULOWYCH POWSTAJE RAZEM Z WYDARZENIEM. Wydarzenie bez menu
  -- to ekran, ktory pyta redakcje o decyzje, ktorej nie ma - te piec pozycji
  -- ma kazde wydarzenie z definicji.
  PERFORM public._event_seed_default_pages(v_tenant, v_id);

  RETURN v_id;
END;
$fn$;

COMMENT ON FUNCTION public.admin_event_create(jsonb) IS
  'Zaklada wydarzenie z rodzaju (slug, format, strefa, tryb zapisow) i zasiewa piec stron modulowych razem z korzeniem.';

-- ---------------------------------------------------------------------------
-- 4b. Leniwy zasiew na wejsciu listy + `module` w odpowiedzi
-- ---------------------------------------------------------------------------
--
-- DLA ISTNIEJACYCH WYDARZEN NIE MA BACKFILLU, wiec ktos musi je dosiac przy
-- pierwszym otwarciu ekranu. To jest TA SAMA sciezka, ktora odtwarza pozycje po
-- skasowaniu strony w `/admin/pages`: `page_id … ON DELETE CASCADE` kasuje
-- pozycje menu razem ze strona (20260826120000:70), a modul nie ma jak temu
-- zapobiec - wiec ma to naprawic.
--
-- FUNKCJA PRZESTAJE BYC `STABLE`, I TO NIE JEST KOSMETYKA. Funkcja `STABLE`
-- albo `IMMUTABLE` NIE MOZE wykonac instrukcji zmieniajacej dane - PostgreSQL
-- odmawia w RUNTIME (`INSERT is not allowed in a non-volatile function`), a nie
-- przy `CREATE FUNCTION`, bo ciala plpgsql nie sa wtedy sprawdzane. Zasiew
-- w funkcji zadeklarowanej `STABLE` wywalilby wiec KAZDE wejscie na ekran
-- „Strony i menu" - to jest dokladnie ta klasa bledu, ktorej czysty przebieg
-- migracji nie widzi. Sprawdzone wykonawczo w
-- `scripts/events-harness/runtime_test.d/90_module_pages.sql`.
DROP FUNCTION IF EXISTS public.admin_event_pages_list(p_event_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_pages_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  page_id uuid,
  page_slug text,
  page_path text,
  page_status text,
  title_pl text,
  title_en text,
  menu_label_pl text,
  menu_label_en text,
  icon text,
  color text,
  in_menu boolean,
  sort_order integer,
  visible_to_groups uuid[],
  module text,
  updated_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_root uuid;
BEGIN
  PERFORM public._event_seed_default_pages(v_tenant, p_event_id);

  -- Korzen czytamy PO zasiewie: zasiew moze go wlasnie zalozyc, a lista bez
  -- korzenia nie pokazuje stron nieprzypietych z jego poddrzewa.
  SELECT e.root_page_id INTO v_root
  FROM public.events e
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;

  RETURN QUERY
  SELECT
    ep.id,
    pg.id,
    pg.slug,
    public._event_page_path(pg.id),
    pg.status::text,
    pg.title_pl,
    pg.title_en,
    ep.menu_label_pl,
    ep.menu_label_en,
    ep.icon,
    ep.color,
    COALESCE(ep.in_menu, false),
    COALESCE(ep.sort_order, 0),
    COALESCE(ep.visible_to_groups, '{}'::uuid[]),
    ep.module,
    pg.updated_at
  FROM public.pages pg
  LEFT JOIN public.event_pages ep
    ON ep.page_id = pg.id AND ep.event_id = p_event_id AND ep.tenant_id = v_tenant
  WHERE pg.tenant_id = v_tenant
    AND pg.deleted_at IS NULL
    AND (
      -- Strony przypiete do wydarzenia (nawet jesli stoja poza poddrzewem -
      -- redaktor moze przypiac istniejaca strone serwisu).
      ep.id IS NOT NULL
      -- Strony z poddrzewa korzenia wydarzenia, jeszcze nieprzypiete.
      OR (v_root IS NOT NULL AND pg.parent_id = v_root)
    )
  ORDER BY COALESCE(ep.in_menu, false) DESC, COALESCE(ep.sort_order, 0), pg.title_pl;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_event_pages_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_pages_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_pages_list(uuid) IS
  'Podstrony wydarzenia: przypiete (event_pages) oraz nieprzypiete strony z poddrzewa korzenia. Dosiewa brakujace strony modulowe na wejsciu. id IS NULL = jeszcze nieprzypieta, module IS NOT NULL = pozycja modulowa.';

-- ---------------------------------------------------------------------------
-- 5. Pozycji modulowej NIE WOLNO odpiac
-- ---------------------------------------------------------------------------
--
-- Dzis `admin_event_page_detach` kasuje mapowanie BEZWARUNKOWO
-- (20260826120000:483-484). Dla pozycji modulowej to znaczy „usun z menu na
-- stale" - a nastepne wejscie na ekran i tak ja odtworzy (krok 4b), wiec
-- przycisk obiecywalby skutek, ktorego nie ma.
--
-- UKRYC WOLNO, ODPIAC NIE. `in_menu = false` jest odwracalne jednym klikniecem
-- i pozycja zostaje w zakladce „Pozostale strony" - dlatego tekst wyjatku
-- WSKAZUJE TE DROGE, a nie tylko odmawia.
DROP FUNCTION IF EXISTS public.admin_event_page_detach(p_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_page_detach(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_module text;
  v_deleted integer;
BEGIN
  SELECT ep.module INTO v_module
  FROM public.event_pages ep
  WHERE ep.id = p_id AND ep.tenant_id = v_tenant;

  IF v_module IS NOT NULL THEN
    RAISE EXCEPTION 'module_page: hide it with in_menu = false instead';
  END IF;

  DELETE FROM public.event_pages ep
  WHERE ep.id = p_id AND ep.tenant_id = v_tenant;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_event_page_detach(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_page_detach(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_page_detach(uuid) IS
  'Odpina strone od menu wydarzenia. NIE usuwa wiersza pages - tresc zostaje. Pozycji modulowej odpiac nie wolno: odmawia z module_page.';

-- ---------------------------------------------------------------------------
-- 6. `module` POZA lista `ON CONFLICT … DO UPDATE SET`
-- ---------------------------------------------------------------------------
--
-- PULAPKA, KTORA MUSI ZOSTAC NAZWANA W TYM MIEJSCU. Klient wysyla przy KAZDEJ
-- zmianie CALY wiersz - `src/lib/events/eventPagesApi.ts:272-296` ma o tym
-- komentarz („ZAPIS NADPISUJE KAZDE POLE, TAKZE POMINIETE") - bo `DO UPDATE SET`
-- podstawia `EXCLUDED` dla wszystkich wymienionych kolumn. Gdyby `module`
-- wszedl na te liste, PIERWSZE przelaczenie „w menu / poza menu" wyczyscilo by
-- znacznik: pozycja przestalaby byc modulowa, dalaby sie odpiac, a leniwy zasiew
-- zalozylby SZOSTA strone o tej samej tresci.
--
-- Cialo jest przepisane z 20260826120000 bez zmian poza tym jednym komentarzem
-- i brakiem `module` w obu listach - to jest cala tresc tego kroku.
CREATE OR REPLACE FUNCTION public.admin_event_page_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_page_id uuid := NULLIF(p_payload->>'page_id', '')::uuid;
  v_icon text := NULLIF(btrim(COALESCE(p_payload->>'icon', '')), '');
  v_color text := NULLIF(upper(btrim(COALESCE(p_payload->>'color', ''))), '');
  v_groups uuid[];
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT ep.event_id, ep.page_id INTO v_event_id, v_page_id
    FROM public.event_pages ep
    WHERE ep.id = v_id AND ep.tenant_id = v_tenant;
    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'not_found: menu entry does not exist in this tenant';
    END IF;
  END IF;

  IF v_event_id IS NULL OR v_page_id IS NULL THEN
    RAISE EXCEPTION 'invalid_page: event and page are required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pages pg
    WHERE pg.id = v_page_id AND pg.tenant_id = v_tenant AND pg.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not_found: page does not exist in this tenant';
  END IF;

  IF v_icon IS NOT NULL AND v_icon !~ '^[a-z0-9-]{1,48}$' THEN
    RAISE EXCEPTION 'invalid_icon: icon must be a kebab-case name';
  END IF;

  IF v_color IS NOT NULL AND v_color !~ '^#[0-9A-F]{6}$' THEN
    RAISE EXCEPTION 'invalid_color: color must be a #RRGGBB value';
  END IF;

  -- Grupa spoza tego wydarzenia w widocznosci pozycji menu znaczy „nikt" -
  -- i to jest cicha awaria, ktora widac dopiero, gdy uczestnik nie widzi
  -- strony. Odrzucamy przy zapisie.
  v_groups := COALESCE((
    SELECT array_agg(value::uuid)
    FROM jsonb_array_elements_text(COALESCE(p_payload->'visible_to_groups', '[]'::jsonb)) AS value
  ), '{}'::uuid[]);

  IF EXISTS (
    SELECT 1 FROM unnest(v_groups) AS gid
    WHERE NOT EXISTS (
      SELECT 1 FROM public.event_groups g
      WHERE g.id = gid AND g.tenant_id = v_tenant AND g.event_id = v_event_id
    )
  ) THEN
    RAISE EXCEPTION 'invalid_group: one of the groups does not belong to this event';
  END IF;

  -- `module` NIE MA ANI W LISCIE KOLUMN INSERT-a, ANI W `DO UPDATE SET`.
  -- W INSERT-cie: znacznik nadaje WYLACZNIE zasiew, wiec pozycja zalozona
  -- rekami redakcji nie ma prawa udawac modulowej. W UPDATE: patrz naglowek
  -- tego kroku.
  INSERT INTO public.event_pages (
    id, tenant_id, event_id, page_id,
    menu_label_pl, menu_label_en, icon, color,
    in_menu, sort_order, visible_to_groups, updated_at
  ) VALUES (
    COALESCE(v_id, gen_random_uuid()), v_tenant, v_event_id, v_page_id,
    NULLIF(btrim(COALESCE(p_payload->>'menu_label_pl', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'menu_label_en', '')), ''),
    v_icon, v_color,
    COALESCE((NULLIF(p_payload->>'in_menu', ''))::boolean, true),
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 0),
    v_groups, now()
  )
  ON CONFLICT (tenant_id, event_id, page_id) DO UPDATE SET
    menu_label_pl = EXCLUDED.menu_label_pl,
    menu_label_en = EXCLUDED.menu_label_en,
    icon = EXCLUDED.icon,
    color = EXCLUDED.color,
    in_menu = EXCLUDED.in_menu,
    sort_order = EXCLUDED.sort_order,
    visible_to_groups = EXCLUDED.visible_to_groups,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_event_page_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_page_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_page_upsert(jsonb) IS
  'Przypina strone do menu wydarzenia albo zmienia jej etykiete, ikone, kolor, kolejnosc i widocznosc per grupa. Znacznika module NIE RUSZA. Grupa spoza wydarzenia jest odrzucana.';

-- ---------------------------------------------------------------------------
-- 7. `module` w publicznym menu
-- ---------------------------------------------------------------------------
--
-- FRONT MUSI ODROZNIC POZYCJE MODULOWA OD ZWYKLEJ, bo dla pieciu modulow ma
-- (albo bedzie mial) wlasny widok, a dla pozostalych rysuje strone z buildera.
-- Bez znacznika musialby zgadywac po slugu - czyli po napisie, ktory redakcja
-- moze zmienic.
--
-- Cialo jest przepisane z 20260826120000 bez zmian poza dolozona kolumna.
DROP FUNCTION IF EXISTS public.event_menu(p_slug text);
CREATE OR REPLACE FUNCTION public.event_menu(p_slug text)
RETURNS TABLE (
  id uuid,
  page_id uuid,
  label_pl text,
  label_en text,
  icon text,
  color text,
  path text,
  sort_order integer,
  module text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_event_id uuid;
  v_registration uuid;
  v_groups uuid[] := '{}'::uuid[];
BEGIN
  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.slug = p_slug
    AND e.status = 'published';

  IF v_event_id IS NULL THEN RETURN; END IF;

  v_registration := public._event_meeting_caller_registration(v_tenant, v_event_id);
  IF v_registration IS NOT NULL THEN
    v_groups := ARRAY(
      SELECT g FROM public._event_meeting_groups(v_tenant, v_event_id, v_registration) AS g
    );
  END IF;

  RETURN QUERY
  SELECT
    ep.id,
    pg.id,
    COALESCE(NULLIF(btrim(ep.menu_label_pl), ''), pg.title_pl),
    COALESCE(NULLIF(btrim(ep.menu_label_en), ''), pg.title_en),
    ep.icon,
    ep.color,
    public._event_page_path(pg.id),
    ep.sort_order,
    ep.module
  FROM public.event_pages ep
  JOIN public.pages pg
    ON pg.id = ep.page_id AND pg.tenant_id = ep.tenant_id
  WHERE ep.tenant_id = v_tenant
    AND ep.event_id = v_event_id
    AND ep.in_menu
    AND pg.deleted_at IS NULL
    AND pg.status = 'published'
    -- Sam status podstrony NIE WYSTARCZA - patrz `_event_page_chain_published`.
    AND public._event_page_chain_published(pg.id)
    AND (
      cardinality(ep.visible_to_groups) = 0
      OR ep.visible_to_groups && v_groups
    )
  ORDER BY ep.sort_order, pg.title_pl;
END;
$fn$;

REVOKE ALL ON FUNCTION public.event_menu(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_menu(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_menu(text) IS
  'Menu podstron opublikowanego wydarzenia widziane przez wolajacego. Pozycja bez grup jest publiczna; z grupami - tylko dla uczestnika z pasujacego zapisu. module IS NOT NULL = jedna z pieciu pozycji modulowych.';