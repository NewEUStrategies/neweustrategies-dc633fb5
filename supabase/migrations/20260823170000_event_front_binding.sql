-- ============================================================================
-- Event Builder, etap 5: PUBLICZNA STRONA WYDARZENIA - KONTRAKT ODCZYTU
--
-- STAN PRZED
--
-- Front wydarzenia karmi sie dzisiaj TRZEMA rzeczami i kazda z nich ma inny
-- problem:
--
--   1) `fetchPublicEventBySlug()` (src/lib/community/publicQueries.ts) robi
--      `supabase.from('events').select(EVENT_COLUMNS)` - dwadziescia dwa nazwy
--      kolumn wypisane w stalej tekstowej po stronie klienta. Kazda kolumna
--      dolozona etapem 1 (`format`, `registration_mode`, `registration_flow`,
--      `guest_mode`, `event_type_id`, `branding`, `root_page_id`,
--      `published_at`, `cancelled_at`) NIE JEST w tej stalej, wiec front ich
--      nie widzi. Nazwa rodzaju wydarzenia nie jest widoczna wcale - klient
--      dostaje legacy `kind` i tlumaczy go mapa `eventKindLabel()`, a katalog
--      `event_types` z etapu 1 nie ma jak dojechac.
--
--   2) Strona sklada swoj stan z SIEDMIU niezaleznych zapytan
--      (`public-event`, `event-rsvp`, `event-access`, `event-rsvp-counts`,
--      `event-waitlist-position`, warstwy, moduly). Siedem zapytan to siedem
--      roznych chwil w czasie - a przy pytaniu "czy sa jeszcze miejsca" to
--      znaczy siedem roznych odpowiedzi. Dokladnie ta pulapka, ktora
--      `event_registration_form()` (etap 4) zamknela dla formularza zapisu.
--
--   3) `/events` czyta `events` z `LIMIT 200` bez filtrow i bez licznika
--      calosci, a caly odsiew (nadchodzace / archiwum) robi w `useMemo` po
--      stronie przegladarki. Przy 201 wydarzeniach lista po cichu klamie,
--      a filtry z projektu frontu (rodzaj, format, zakres dat, fraza) nie maja
--      gdzie zaistniec.
--
-- Do tego trzy braki z docs/PROJEKT_FRONT_WYDARZENIA_2026-08-23.md:
--   * nie ma ZADNEJ konfiguracji sekcji strony wydarzenia - kolejnosc i
--     widocznosc blokow (opis, agenda, prelegenci, sponsorzy, materialy,
--     rejestracja, mapa, kontakt) jest zakuta w 590-liniowym pliku trasy;
--   * nie ma zapamietania wydarzenia - `user_bookmarks` ma CHECK
--     `entity_type IN ('post','page')`, wiec wydarzenie sie tam nie zmiesci
--     (zadanie EB-930);
--   * `ad_page_type` nie ma wariantu `'event'` (zadanie EB-937), wiec baner na
--     stronie wydarzenia da sie emitowac wylacznie jako `page_type = 'all'`,
--     czyli WSZEDZIE.
--
-- STAN PO
--
-- Dwie tabele konfiguracyjne, jeden nowy wariant typu wyliczeniowego i szesc
-- funkcji plaszczyzny TRESCI:
--
--   * `event_page_sections` - ktore bloki strony sa widoczne, w jakiej
--     kolejnosci, z jakim naglowkiem i dla kogo. Brak wiersza = poprawna strona
--     (patrz punkt 2 nizej).
--   * `event_bookmarks` - zapamietanie wydarzenia przez uzytkownika.
--   * `ad_page_type += 'event'` - EB-937.
--   * `_event_default_sections()` - kanoniczna lista osmiu sekcji.
--   * `_event_page_seats_left()` - JEDNA definicja liczby wolnych miejsc dla
--     naglowka i dla listy.
--   * `event_page_header(p_slug)` - komplet naglowka strony w jednym wywolaniu.
--   * `event_sections(p_slug)` - uklad i uprawnienia sekcji dla wolajacego.
--   * `events_public_list(...)` - publiczna lista z filtrami i paginacja.
--   * `event_bookmark_toggle(p_payload)` / `event_bookmarks_mine(...)`.
--   * `event_ad_placements(p_slug, p_position)` - domkniecie systemu
--     reklamowego dla strony wydarzenia.
--
-- DLACZEGO TAK
--
-- 1) NAGLOWEK JEST JEDNYM WYWOLANIEM, NIE SIEDMIOMA. Liczba wolnych miejsc,
--    stan zapisow, prog warstwy i wlasny status uczestnika sa ze soba
--    POWIAZANE: "zostalo 3 miejsca" i "jestes na liscie rezerwowej" musza
--    pochodzic z tej samej chwili, inaczej strona pokazuje przycisk, ktory
--    odmawia. Jedno wywolanie to jedna migawka.
--
-- 2) BRAK WIERSZA KONFIGURACJI DAJE POPRAWNA STRONE - i to jest decyzja
--    projektowa, nie wygoda. Rozwazane byly dwa warianty:
--
--    (a) ZASIEW WIERSZY MIGRACJA: osiem wierszy na kazde istniejace wydarzenie
--        plus trigger na INSERT nowego. Odrzucone z trzech powodow:
--        - dziewiata sekcja dolozona w przyszlosci wymaga DRUGIEGO backfillu,
--          bo wydarzenia zasiane dzisiaj nie beda o niej wiedzialy;
--        - wiersz zasiany jest NIEODROZNIALNY od wiersza, ktory redaktor
--          swiadomie ustawil - a to znaczy, ze nie da sie zbudowac operacji
--          "przywroc domyslne", bo nie wiadomo, co bylo decyzja;
--        - trigger na `events` to czwarty trigger na tej tabeli i dodatkowy
--          koszt kazdego importu wydarzen.
--
--    (b) DOMYSLNA LISTA W FUNKCJI, WIERSZ JAKO NADPISANIE. Wybrane.
--        `_event_default_sections()` jest zrodlem kanonicznej listy, a tabela
--        trzyma WYLACZNIE DECYZJE redakcji. Skutki: wydarzenie bez ani jednego
--        wiersza renderuje sie poprawnie od pierwszej sekundy, "przywroc
--        domyslne" to `DELETE`, a dziewiata sekcja pojawia sie na wszystkich
--        wydarzeniach naraz bez zadnego backfillu.
--
-- 3) `guest_mode` PRZESTAJE BYC KOLUMNA BEZ ZNACZENIA. Etap 1 wprowadzil ja
--    z komentarzem "co widzi osoba NIEZAREJESTROWANA na wydarzenie" i do tej
--    pory nic jej nie czytalo. `event_sections()` egzekwuje ja wprost:
--    `hidden` zamyka wszystkie sekcje, `teaser` otwiera opis i agende, `full`
--    otwiera wszystko poza kontaktami. Sekcja zamknieta WRACA w odpowiedzi
--    z `is_locked = true` i powodem - ukrycie jej zamienia bramke w awarie
--    ("gdzie sie podziala agenda?"), a powod jest tym, co front ma napisac.
--
-- 4) ADRES TRANSMISJI I NAGRANIA NIE WYCHODZI Z ZADNEJ FUNKCJI W TYM PLIKU.
--    Naglowek oddaje `has_stream` i `has_recording` - dwa boole. Adresy nadal
--    wychodza WYLACZNIE przez `get_event_access(uuid)` z 20260713093000 i to
--    jest swiadome: tamta funkcja musi znac obejscie stafowe (organizator
--    testuje link przed publikacja), wiec laczy `public_tenant_id()`
--    z `has_role()` i z tego powodu siedzi na liscie wyjatkow bramki
--    `check:sql-tenant-scope` - z obejsciem ZWIAZANYM z `current_tenant_id()`.
--    Zduplikowanie jej tutaj bez tego obejscia dalo by DWA zrodla prawdy
--    o dostepie do transmisji, ktore rozjada sie przy pierwszej zmianie reguly.
--    Front wola wiec: `event_page_header()` po naglowek, `get_event_access()`
--    po adres. Kontrakt jest opisany w komentarzu funkcji.
--
-- 5) LICZBA WOLNYCH MIEJSC LICZY SIE Z DWOCH ZYWYCH SCIEZEK ZAPISU. W bazie
--    istnieja dzisiaj DWIE tabele zajmujace miejsce: legacy `event_rsvps`
--    (pisane przez `rsvp_event()` z 20260713093000, nadal wolane przez
--    `/events/$slug`) i `event_registrations` (etap 4). Liczba liczona z jednej
--    z nich ZANIZA obsadzenie - a zanizone obsadzenie to nadkomplet na sali.
--    `_event_page_seats_left()` bierze MNIEJSZA z dwoch liczb i jest jedynym
--    zrodlem tej wartosci dla naglowka i dla listy, wiec liczba na kaflu jest
--    ta sama co liczba na stronie.
--
-- 6) NOWY WARIANT TYPU WYLICZENIOWEGO JEST DODANY, ALE NIEUZYWANY W TYM PLIKU.
--    PostgreSQL nie pozwala UZYC wartosci typu wyliczeniowego w tej samej
--    transakcji, w ktorej powstala. Repozytorium radzilo sobie z tym osobnymi
--    migracjami zawierajacymi WYLACZNIE `ALTER TYPE ... ADD VALUE IF NOT EXISTS`
--    (20260723150000 dla `plan_interval` = 'quarter', 20260730190000 dla
--    'two_weeks') - z komentarzem mowiacym wprost: "nowej wartosci enum nie
--    wolno UZYC w tej samej transakcji, w ktorej powstala". Trzymamy sie tej
--    zasady: `ALTER TYPE` stoi jako PIERWSZA instrukcja pliku, a zaden dalszy
--    fragment nie zapisuje literalu `'event'` w typie `ad_page_type` - ani
--    w rzutowaniu, ani w predykacie indeksu, ani w wartosci domyslnej.
--    `event_ad_placements()` porownuje `page_type::text = 'event'`, czyli
--    rzutuje KOLUMNE NA TEKST zamiast tekst na typ wyliczeniowy. Roznica jest
--    istotna: rzutowanie literalu na typ wyliczeniowy wymaga jego wartosci
--    W CHWILI ANALIZY zapytania, rzutowanie kolumny na tekst nie wymaga niczego.
--
-- 7) ZAPIS KONFIGURACJI SEKCJI IDZIE POLITYKA RLS, NIE FUNKCJA. Ten plik
--    z zalozenia nie zawiera ani jednej funkcji plaszczyzny administracyjnej
--    (patrz IZOLACJA NAJEMCOW nizej), a konfiguracja sekcji musi byc
--    zapisywalna z panelu. Wzorzec jest w repozytorium i jest przetestowany:
--    `ad_slots` i `ad_placements` sa zarzadzane z `/admin/ads` WPROST przez
--    PostgREST pod politykami "Admins/editors manage ... in tenant"
--    (20260624165807), a `event_types` ma takie polityki obok swoich RPC
--    (20260823120000). Polityka nie jest funkcja, wiec `has_role()` w niej nie
--    miesza plaszczyzn - wiaze rola z `current_tenant_id()`, czyli z tenantem
--    DOMOWYM, dokladnie jak `events staff write`.
--
-- IZOLACJA NAJEMCOW
--
--   * KAZDA funkcja w tym pliku nalezy do plaszczyzny TRESCI: skaluje dane po
--     `public_tenant_id()` (najemca z naglowka hosta) i NIE WOLA `has_role()`
--     ani `is_staff()`. Naglowek `x-tenant-host` ustawia klient
--     (src/integrations/supabase/tenant-host-fetch.ts), wiec jest falsyfikowalny;
--     funkcja skalujaca dane po naglowku, a autoryzujaca po roli w tenancie
--     domowym, pozwolilaby administratorowi najemcy A podszyc sie pod najemce B.
--     To wyciek zamkniety migracja 20260724091000 i pilnowany bramka
--     `check:sql-tenant-scope`.
--   * "Czy wolajacy jest zapisany" rozstrzygamy po `auth.uid()` i po danych
--     wydarzenia W GRANICACH TEGO SAMEGO najemcy z naglowka - nigdy po roli.
--   * Obie nowe tabele maja `tenant_id NOT NULL REFERENCES tenants(id)` oraz
--     KLUCZ OBCY ZLOZONY `(tenant_id, event_id) -> events (tenant_id, id)`
--     opary o ograniczenie `events_tenant_id_key` z 20260823135000. Wiersz nie
--     moze wiec wskazywac wydarzenia obcego najemcy - odrzuca to silnik, nie
--     aplikacja, i robi to takze przy `COPY` i przy migracji danych.
--   * Obie tabele maja RLS wlaczony i JAWNE polityki. Zapamietania widzi
--     WYLACZNIE ich wlasciciel, i to tylko w najemcy, w ktorym powstaly.
--   * Kazda funkcja SECURITY DEFINER ma `SET search_path = public, pg_temp`.
--
-- FORWARD-ONLY I IDEMPOTENTNOSC. `ALTER TYPE ... ADD VALUE IF NOT EXISTS`,
-- `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP POLICY
-- IF EXISTS` przed kazdym `CREATE POLICY`, `DROP FUNCTION IF EXISTS` z pelna
-- sygnatura przed kazdym `CREATE FUNCTION`. Powtorny przebieg na bazie
-- czesciowo zmigrowanej nie nadpisuje zadnej decyzji redakcji.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) EB-937: TYP STRONY REKLAMOWEJ POZNAJE WYDARZENIE
--
-- Bez tego wariantu baner na stronie wydarzenia mozna emitowac tylko jako
-- `page_type = 'all'`, czyli na kazdej stronie serwisu naraz. Enum mial osiem
-- wartosci (`all`, `home`, `post`, `page`, `category`, `tag`, `archive`,
-- `search`) od 20260624165807 i przez to jedna z dwoch pozycji, ktorych front
-- wydarzenia nie umial obsluzyc.
--
-- INSTRUKCJA STOI PIERWSZA I NIC W TYM PLIKU JEJ NIE UZYWA - patrz punkt 6
-- naglowka. Lustro po stronie TypeScriptu (`AdPageType`,
-- `AD_PAGE_TYPE_LABEL_KEYS` w src/lib/ads/types.ts, galaz `/events/` w
-- `adPageTypeForLocation()`) domyka to zadanie po stronie klienta i nalezy do
-- osobnego commitu - baza jest gotowa, zanim klient o wariancie uslyszy.
-- ----------------------------------------------------------------------------
ALTER TYPE public.ad_page_type ADD VALUE IF NOT EXISTS 'event';

-- ----------------------------------------------------------------------------
-- 2) KONFIGURACJA SEKCJI STRONY WYDARZENIA
--
-- CO TU NIE MIESZKA I DLACZEGO
--   * NIE MA kolumny `config jsonb`. Kazda sekcja ma dzisiaj dokladnie te
--     decyzje, ktore sa nizej kolumnami; worek jsonb "na przyszle opcje" jest
--     miejscem, w ktorym powstaja pola bez czytajacego ich kodu.
--   * NIE MA kolumn na TRESC sekcji. Tresc kazdego bloku ma juz swoje zrodlo
--     (`events.description_*`, `event_sessions`, `event_speakers`,
--     `event_sponsors`, `events.location`, `events.host_user_id`), a druga
--     kopia tresci w konfiguracji ukladu to gwarantowany rozjazd.
--   * NAGLOWKI SA NADPISANIEM, NIE WARTOSCIA STARTOWA. `heading_pl/en` z NULL
--     znaczy "uzyj etykiety ze slownika" (`eventFront.sections.*.heading`
--     w src/lib/i18n-event-front.ts). Gdyby domyslne naglowki siedzialy tutaj,
--     tlumaczenie tej samej frazy zylo by w dwoch miejscach - a poprawka
--     literowki w slowniku nie ruszyla by wydarzen zasianych wczesniej.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_page_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  section_key text NOT NULL,
  is_visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  heading_pl text,
  heading_en text,
  visibility text NOT NULL DEFAULT 'public',
  min_tier_rank integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Slownik kluczy jest ZAMKNIETY. Sekcja poza tym zbiorem nie ma komponentu,
  -- ktory by ja narysowal, wiec wiersz z literowka byl by sekcja niewidzialna
  -- bez zadnego bledu - najgorszy rodzaj awarii konfiguracji.
  CONSTRAINT event_page_sections_key_values CHECK (section_key IN (
    'description', 'registration', 'agenda', 'speakers',
    'sponsors', 'materials', 'map', 'contact'
  )),
  CONSTRAINT event_page_sections_visibility_values CHECK (visibility IN (
    'public', 'authenticated', 'registered', 'tier'
  )),
  -- Prog rangi ma sens WYLACZNIE dla widocznosci 'tier' i wtedy musi byc
  -- wiekszy od zera. Bez tego warunku istnieja dwa rozne zapisy tego samego
  -- stanu ("tier z ranga 0" = wszyscy) i front musi zgadywac, ktory wygrywa.
  CONSTRAINT event_page_sections_tier_rank_consistent CHECK (
    (visibility = 'tier' AND min_tier_rank > 0)
    OR (visibility <> 'tier' AND min_tier_rank = 0)
  ),
  CONSTRAINT event_page_sections_heading_pl_len
    CHECK (heading_pl IS NULL OR char_length(btrim(heading_pl)) BETWEEN 1 AND 120),
  CONSTRAINT event_page_sections_heading_en_len
    CHECK (heading_en IS NULL OR char_length(btrim(heading_en)) BETWEEN 1 AND 120),
  CONSTRAINT event_page_sections_sort_order_range
    CHECK (sort_order BETWEEN 0 AND 10000),
  -- Jedna sekcja na wydarzenie ma dokladnie jeden wiersz. Dwa wiersze tego
  -- samego klucza to dwie sprzeczne konfiguracje bez rozstrzygniecia.
  CONSTRAINT event_page_sections_event_key_unique UNIQUE (tenant_id, event_id, section_key),
  -- Tozsamosc w granicach najemcy - kotwica dla przyszlych tabel-wnukow
  -- (np. pozycje w sekcji materialow).
  CONSTRAINT event_page_sections_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_page_sections_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_page_sections IS
  'NADPISANIA ukladu strony wydarzenia. Kanoniczna lista osmiu sekcji zyje w _event_default_sections(); wiersz tutaj zmienia widocznosc, kolejnosc, naglowek albo prog dostepu JEDNEJ sekcji. Brak wiersza = wartosc domyslna, wiec wydarzenie bez konfiguracji renderuje sie poprawnie, a "przywroc domyslne" to DELETE.';
COMMENT ON COLUMN public.event_page_sections.section_key IS
  'Klucz sekcji ze zamknietego slownika osmiu wartosci. Ten sam klucz jest kotwica w adresie (#agenda) i kluczem etykiety w slowniku i18n (eventFront.sections.<key>.heading).';
COMMENT ON COLUMN public.event_page_sections.is_visible IS
  'false = sekcja NIE WRACA z event_sections() w ogole. To jest ukrycie na zyczenie redakcji, w odroznieniu od zamkniecia bramka (is_locked), ktore sekcje zwraca razem z powodem.';
COMMENT ON COLUMN public.event_page_sections.heading_pl IS
  'Naglowek nadpisany przez redakcje. NULL = etykieta ze slownika i18n (eventFront.sections.<key>.heading) - jedno zrodlo tlumaczenia, nie kopia w bazie.';
COMMENT ON COLUMN public.event_page_sections.heading_en IS
  'Jak heading_pl, w wersji angielskiej. Nadpisanie jest per jezyk, bo redakcja czasem zmienia tylko jedna wersje.';
COMMENT ON COLUMN public.event_page_sections.visibility IS
  'Dla kogo sekcja jest OTWARTA: public (kazdy) | authenticated (zalogowany) | registered (z zapisem na to wydarzenie) | tier (od rangi min_tier_rank). Bramka jest liczona w event_sections(); dodatkowo obowiazuje events.guest_mode.';
COMMENT ON COLUMN public.event_page_sections.min_tier_rank IS
  'Prog rangi warstwy czlonkowskiej dla visibility = tier. CHECK wymusza wartosc > 0 wlasnie dla tej widocznosci i 0 dla pozostalych.';

-- Jedyne zapytanie czytajace te tabele (event_sections) pyta o wszystkie
-- wiersze jednego wydarzenia w kolejnosci prezentacji - indeks oddaje je bez
-- sortowania.
CREATE INDEX IF NOT EXISTS event_page_sections_event_order_idx
  ON public.event_page_sections (tenant_id, event_id, sort_order, section_key);

DROP TRIGGER IF EXISTS event_page_sections_touch_updated_at ON public.event_page_sections;
CREATE TRIGGER event_page_sections_touch_updated_at
  BEFORE UPDATE ON public.event_page_sections
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_page_sections TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_page_sections TO authenticated;
GRANT ALL ON public.event_page_sections TO service_role;

ALTER TABLE public.event_page_sections ENABLE ROW LEVEL SECURITY;

-- Plaszczyzna TRESCI: uklad strony jest publiczny razem z wydarzeniem. Dwa
-- warunki, bo publikacja wydarzenia jest decyzja niezalezna od konfiguracji
-- sekcji - uklad szkicu nie ma prawa wyjsc na domene.
DROP POLICY IF EXISTS "event_page_sections_public_read" ON public.event_page_sections;
CREATE POLICY "event_page_sections_public_read"
  ON public.event_page_sections FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_page_sections.event_id
        AND e.tenant_id = event_page_sections.tenant_id
        AND e.status = 'published'
    )
  );

-- Plaszczyzna ADMINISTRACYJNA: tenant DOMOWY wolajacego, nigdy naglowek hosta.
-- Rola `author` nie wystarcza - ta sama granica co w `assert_editor_tenant()`.
DROP POLICY IF EXISTS "event_page_sections_staff_read" ON public.event_page_sections;
CREATE POLICY "event_page_sections_staff_read"
  ON public.event_page_sections FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "event_page_sections_staff_write" ON public.event_page_sections;
CREATE POLICY "event_page_sections_staff_write"
  ON public.event_page_sections FOR ALL
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- 3) ZAPAMIETANIE WYDARZENIA
--
-- DLACZEGO OSOBNA TABELA, A NIE `user_bookmarks`. Tamta tabela ma CHECK
-- `entity_type IN ('post','page')` i klucz `UNIQUE (user_id, entity_type,
-- entity_id)` BEZ tenanta, a jej `entity_id` nie ma zadnego klucza obcego -
-- wiec wiersz moze wskazywac nieistniejacy obiekt i przezyc usuniecie encji.
-- Rozszerzenie slownika o 'event' (zadanie EB-930) daloby zapamietanie
-- wydarzen, ktore NIE gina razem z wydarzeniem i nie sa wiazane z najemca.
-- Wlasna tabela ma jedno i drugie: klucz obcy ZLOZONY do wydarzenia
-- z kaskada i tenanta w kazdym predykacie.
--
-- CZEGO TU NIE MA. Nie ma kolumny na przypomnienie (`remind_before_minutes`)
-- ani na powiadomienie o zmianie terminu. Obie brzmia sensownie i obie byly by
-- METRYKA BEZ PROCESU: w module nie ma dzisiaj harmonogramu, ktory by je
-- odczytal i wyslal. Beda mialy sens razem z takim procesem, nie przed nim -
-- luka jest zapisana w raporcie modulu.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Jedna osoba zapamietuje jedno wydarzenie RAZ. Dwuklik jest wtedy
  -- bezczynnoscia, nie duplikatem.
  CONSTRAINT event_bookmarks_user_event_unique UNIQUE (tenant_id, event_id, user_id),
  CONSTRAINT event_bookmarks_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_bookmarks IS
  'Zapamietanie wydarzenia przez uzytkownika: kto, ktore wydarzenie, kiedy. Widzi je WYLACZNIE wlasciciel i tylko w najemcy, w ktorym powstalo. Zapis wylacznie przez event_bookmark_toggle() - tabela nie ma polityki INSERT ani DELETE dla roli klienckiej.';
COMMENT ON COLUMN public.event_bookmarks.tenant_id IS
  'Najemca, w ktorym zapamietanie powstalo (naglowek hosta w chwili zapisu). Ta sama osoba na dwoch domenach ma dwa niezalezne zbiory zapamietan - obszar roboczy jednej firmy nie pokazuje wyborow zrobionych w drugiej.';

-- "Moje zapamietania" pyta o (najemca, uzytkownik) i sortuje po czasie dodania;
-- klucz UNIQUE (tenant_id, event_id, user_id) tego zapytania nie obsluguje, bo
-- ma uzytkownika na TRZECIEJ pozycji.
CREATE INDEX IF NOT EXISTS event_bookmarks_user_idx
  ON public.event_bookmarks (tenant_id, user_id, created_at DESC);
-- Indeksu na (tenant_id, event_id) NIE DODAJEMY SWIADOMIE: kolumny wiodace
-- klucza UNIQUE (tenant_id, event_id, user_id) obsluguja i sonde "czy juz
-- zapamietane", i przeszukanie potomka przy kaskadzie z `events`. Drugi indeks
-- na tym samym prefiksie byl by kosztem zapisu bez zwrotu.

GRANT SELECT ON public.event_bookmarks TO authenticated;
GRANT ALL ON public.event_bookmarks TO service_role;

ALTER TABLE public.event_bookmarks ENABLE ROW LEVEL SECURITY;

-- Wlasciciel czyta swoje wiersze, i tylko w najemcy, w ktorym powstaly.
-- Tenant jest w predykacie takze dlatego, ze bez niego polityka wlascicielska
-- odczytywala by wiersz w dowolnym kontekscie najemcy - klasa bledu zamknieta
-- migracja 20260803130000 i pilnowana bramka `check:sql-owner-tenant-scope`.
DROP POLICY IF EXISTS "event_bookmarks_owner_read" ON public.event_bookmarks;
CREATE POLICY "event_bookmarks_owner_read"
  ON public.event_bookmarks FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.public_tenant_id())
  );

-- Zapis: BRAK polityki dla roli klienckiej. Jedyna droga to
-- event_bookmark_toggle() - funkcja ustala tenanta z naglowka i uzytkownika
-- z sesji, wiec klient nie moze podac ani jednego, ani drugiego.

-- ----------------------------------------------------------------------------
-- 4) KANONICZNA LISTA SEKCJI
--
-- Kolejnosc domyslna jest kolejnoscia LEKTURY, nie alfabetu: opis mowi o czym
-- to jest, rejestracja stoi zaraz pod nim (bo to jedyna akcja, po ktora
-- czytelnik przyszedl), potem program, ludzie, partnerzy, materialy, dojazd
-- i kontakt.
--
-- DWIE SEKCJE MAJA DOMYSLNIE INNA WIDOCZNOSC NIZ 'public' I OBIE Z POWODU:
--   * `contact` = 'registered', bo etap 1 zdefiniowal `guest_mode = 'full'`
--     jako "wszystko POZA KONTAKTAMI" - dane kontaktowe organizatora nie sa
--     trescia promocyjna;
--   * `materials` = niewidoczna (`is_visible = false`), bo w bazie NIE MA
--     jeszcze zrodla materialow wydarzenia. `member_resources` nie ma zadnego
--     powiazania z wydarzeniem, wiec sekcja wlaczona domyslnie renderowala by
--     pusty blok - atrapa. Klucz zostaje w slowniku, zeby panel mial gdzie
--     pokazac te sekcje w dniu, w ktorym zrodlo powstanie; do tego dnia
--     `event_sections()` zwraca dla niej `has_content = NULL` (nie da sie
--     policzyc), a nie `false` (policzone, wyszlo zero).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_default_sections();
CREATE FUNCTION public._event_default_sections()
RETURNS TABLE (
  section_key text,
  is_visible boolean,
  sort_order integer,
  visibility text,
  min_tier_rank integer
)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT *
  FROM (VALUES
    ('description',  true,  10, 'public',     0),
    ('registration', true,  20, 'public',     0),
    ('agenda',       true,  30, 'public',     0),
    ('speakers',     true,  40, 'public',     0),
    ('sponsors',     true,  50, 'public',     0),
    ('materials',    false, 60, 'registered', 0),
    ('map',          true,  70, 'public',     0),
    ('contact',      true,  80, 'registered', 0)
  ) AS d(section_key, is_visible, sort_order, visibility, min_tier_rank);
$$;

REVOKE ALL ON FUNCTION public._event_default_sections() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._event_default_sections() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public._event_default_sections() IS
  'Kanoniczna lista osmiu sekcji strony wydarzenia z wartosciami startowymi. Zrodlo prawdy dla wydarzen BEZ wierszy w event_page_sections - dodanie dziewiatej sekcji tutaj obejmuje wszystkie wydarzenia naraz, bez backfillu.';

-- ----------------------------------------------------------------------------
-- 5) WOLNE MIEJSCA - JEDNA DEFINICJA DLA NAGLOWKA I DLA LISTY
--
-- DWIE ZYWE SCIEZKI ZAPISU. `event_registrations` (etap 4) i legacy
-- `event_rsvps` (20260713093000, nadal pisane przez `rsvp_event()` z trasy
-- `/events/$slug`) zajmuja miejsca NIEZALEZNIE od siebie. Liczba liczona
-- z jednej z nich zaniza obsadzenie, a zanizone obsadzenie to nadkomplet na
-- sali - wiec bierzemy MNIEJSZA z dwoch liczb wolnych miejsc.
--
-- NULL ZNACZY "BEZ LIMITU", NIE "ZERO". Wydarzenie bez `capacity` oddaje NULL
-- i front ma nie pokazywac przy nim licznika. Zero znaczy komplet.
--
-- TA FUNKCJA LICZY, NIE REZERWUJE - ta sama uwaga co przy
-- `_event_seats_left()`. Sciezka zajmujaca miejsce musi trzymac FOR UPDATE na
-- wierszu nadrzednym; robia to `rsvp_event()` i `event_register()`.
-- ----------------------------------------------------------------------------
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
    -- Brak wiersza rozstrzyga wolajacy (nie ma wydarzenia = nie ma strony),
    -- brak limitu znaczy brak licznika. Oba przypadki to NULL.
    RETURN NULL;
  END IF;

  -- Pula zapisow etapu 4 (razem z pulami biletow, gdy istnieja).
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

-- ----------------------------------------------------------------------------
-- 6) KOMPLET NAGLOWKA STRONY WYDARZENIA
--
-- JEDEN WIERSZ, JEDNA CHWILA W CZASIE. Wszystko, co naglowek musi wiedziec,
-- zeby sie narysowac i podjac decyzje o przycisku: termin ze strefa, miejsce,
-- okladka, marka, rodzaj wydarzenia z nazwa, stan zapisow, wolne miejsca, prog
-- warstwy, regula Chatham House, wlasny status wolajacego i liczniki zakladek.
--
-- CZEGO NIE ODDAJE
--   * `join_url` i `recording_url` - patrz punkt 4 naglowka pliku. Front
--     dostaje `has_stream` i `has_recording`, a adres pobiera z
--     `get_event_access(uuid)`, ktore jest JEDYNYM zrodlem prawdy o dostepie
--     do transmisji (i jedynym, ktore zna obejscie stafowe).
--   * Zadnej danej innej osoby: ani nazwiska uczestnika, ani adresu poczty,
--     ani cudzej pozycji w kolejce.
--   * Wydarzen nieopublikowanych. Szkic i wydarzenie usuniete nie istnieja na
--     tej plaszczyznie - funkcja zwraca zero wierszy, a nie puste kolumny.
--     Wydarzenie ODWOLANE jest oddawane, bo uczestnik ma prawo dowiedziec sie
--     o odwolaniu ze strony, na ktora wraca z zakladki.
--
-- `registration_state` LICZY SIE TUTAJ i uzywa TEGO SAMEGO SLOWNIKA co
-- `closed_reason` z `event_registration_form()` (etap 4) - wspolny slownik
-- znaczy wspolne etykiety i18n i brak dwoch nazw na jeden stan. Jedna wartosc
-- jest DODANA: `event_ended`. Drabinka tamtej funkcji nie sprawdza konca
-- wydarzenia, wiec formularz zapisu na wydarzenie sprzed roku nadal raportuje
-- sie jako otwarty; naglowek nie moze zapraszac do zapisu na cos, co sie
-- skonczylo. Rozjazd jest swiadomy i zapisany w raporcie modulu jako kontrakt
-- miedzymodulowy do domkniecia po stronie tamtej funkcji.
-- ----------------------------------------------------------------------------
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

  -- Prog warstwy: wydarzenie `members` ma prog CO NAJMNIEJ 1, nawet gdy
  -- kolumna mowi 0 - taka sama interpretacja jak w `get_event_access()`
  -- i w `event_registration_form()`, bo trzy rozne interpretacje tej pary
  -- kolumn to trzy rozne odpowiedzi na to samo pytanie.
  v_tier_ok := CASE
    WHEN v_event.visibility = 'members'
      THEN public.has_tier_rank(GREATEST(COALESCE(v_event.min_tier_rank, 0), 1))
    ELSE public.has_tier_rank(COALESCE(v_event.min_tier_rank, 0))
  END;

  SELECT count(*)::integer INTO v_active_tickets
  FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;

  -- Kolejnosc warunkow jest kolejnoscia waznosci - odwolane wydarzenie nie jest
  -- "wyprzedane", a zakonczone nie jest "jeszcze nieotwarte".
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
    -- Wyprzedanie liczymy tylko bez biletow: przy biletach kazdy ma wlasna pule
    -- i wlasny stan, wiec jedna flaga na wydarzeniu klamala by o tych, ktore
    -- jeszcze sa (ta sama regula co w event_registration_form).
    WHEN v_active_tickets = 0 AND v_seats_left IS NOT NULL AND v_seats_left <= 0
      THEN 'sold_out'
    ELSE 'open'
  END;

  -- Wlasny zapis w modelu etapu 4: osoba w kartotece jest wiazana z kontem
  -- kolumna `user_id`, a nie adresem poczty - adres da sie podac cudzy.
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
    -- Chatham House jest BRAMKA, nie etykieta (20260822092000): wejscie wymaga
    -- flagi warstwy. Front musi wiedziec, czy pisze "spotkanie w regule
    -- Chatham House", czy "spotkanie dostepne od warstwy Pro".
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
    -- Liczniki zasilaja plakietki paska zakladek (zadanie EB-941). Kazdy jest
    -- policzony z tabeli, ktora naprawde te tresc trzyma - plakietka bez
    -- liczacego ja zapytania byla by atrapa.
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

-- ----------------------------------------------------------------------------
-- 7) UKLAD I UPRAWNIENIA SEKCJI STRONY
--
-- TRZY BRAMKI SKLADAJA SIE NA JEDNA ODPOWIEDZ, W TEJ KOLEJNOSCI:
--   1) `is_visible` z konfiguracji - redakcja wylaczyla sekcje, wiec nie wraca
--      wcale (to jedyny przypadek, w ktorym sekcja znika);
--   2) `visibility` sekcji - zalogowanie, zapis albo ranga warstwy;
--   3) `events.guest_mode` - co widzi osoba BEZ ZAPISU na to wydarzenie.
--
-- Bramki 2 i 3 nie ukrywaja sekcji, tylko ZAMYKAJA ja z powodem. Ukrycie
-- zamienia bramke w awarie ("gdzie sie podziala agenda?"), a powod jest
-- dokladnie tym, co front ma napisac na karcie zamiast tresci.
--
-- `has_content` LICZY SIE Z PRAWDZIWEGO ZRODLA kazdej sekcji, zeby front nie
-- rysowal pustego bloku i nie potrzebowal na to drugiego zapytania. NULL
-- oznacza "nie da sie policzyc" i wystepuje dokladnie raz: dla `materials`,
-- ktorych zrodla w bazie jeszcze nie ma (patrz punkt 4).
--
-- KTO JEST "ZAPISANY". Zapis POTWIERDZONY, czyli `event_registrations.status`
-- w ('approved','attended') albo legacy `event_rsvps.status = 'going'`.
-- Zgloszenie oczekujace na decyzje ani miejsce w kolejce rezerwowej NIE
-- otwieraja tresci dla zapisanych - inaczej zlozenie formularza dawalo by
-- dostep, ktorego organizator jeszcze nie przyznal.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_sections(text);
CREATE FUNCTION public.event_sections(p_slug text)
RETURNS TABLE (
  section_key text,
  sort_order integer,
  heading_pl text,
  heading_en text,
  visibility text,
  min_tier_rank integer,
  is_locked boolean,
  lock_reason text,
  has_content boolean
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
  v_registered boolean := false;
  v_has_description boolean;
  v_has_agenda boolean;
  v_has_speakers boolean;
  v_has_sponsors boolean;
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

  IF v_uid IS NOT NULL THEN
    v_registered :=
      EXISTS (
        SELECT 1
        FROM public.event_registrations r
        JOIN public.event_people pe
          ON pe.tenant_id = r.tenant_id AND pe.id = r.person_id
        WHERE r.tenant_id = v_tenant
          AND r.event_id = v_event.id
          AND pe.user_id = v_uid
          AND r.status IN ('approved', 'attended')
      )
      OR EXISTS (
        SELECT 1 FROM public.event_rsvps rs
        WHERE rs.tenant_id = v_tenant
          AND rs.event_id = v_event.id
          AND rs.user_id = v_uid
          AND rs.status = 'going'
      );
  END IF;

  v_has_description :=
    btrim(COALESCE(v_event.description_pl, '')) <> ''
    OR btrim(COALESCE(v_event.description_en, '')) <> '';

  v_has_agenda := EXISTS (
    SELECT 1 FROM public.event_sessions s
    WHERE s.tenant_id = v_tenant
      AND s.event_id = v_event.id
      AND s.status = 'published'
      AND s.is_private = false
  );

  -- Prelegenci moga byc przypieci do wydarzenia (legacy `event_speakers`) albo
  -- do jego sesji (`event_session_speakers` z etapu 3). Sekcja ma tresc, gdy
  -- istnieje ktorekolwiek z dwojga.
  v_has_speakers :=
    EXISTS (
      SELECT 1 FROM public.event_speakers sp
      WHERE sp.event_id = v_event.id
    )
    OR EXISTS (
      SELECT 1 FROM public.event_session_speakers es
      WHERE es.tenant_id = v_tenant AND es.event_id = v_event.id
    );

  v_has_sponsors := EXISTS (
    SELECT 1 FROM public.event_sponsors sn
    WHERE sn.tenant_id = v_tenant
      AND sn.event_id = v_event.id
      AND sn.is_published
  );

  RETURN QUERY
  WITH merged AS (
    SELECT
      d.section_key AS k,
      COALESCE(s.is_visible, d.is_visible) AS visible,
      COALESCE(s.sort_order, d.sort_order) AS ord,
      s.heading_pl AS h_pl,
      s.heading_en AS h_en,
      COALESCE(s.visibility, d.visibility) AS vis,
      COALESCE(s.min_tier_rank, d.min_tier_rank) AS rank_min
    FROM public._event_default_sections() d
    LEFT JOIN public.event_page_sections s
      ON s.tenant_id = v_tenant
     AND s.event_id = v_event.id
     AND s.section_key = d.section_key
  ),
  gated AS (
    SELECT
      m.k, m.ord, m.h_pl, m.h_en, m.vis, m.rank_min,
      -- Powod pierwszy pasujacy wygrywa. Kolejnosc nie jest dowolna: brak
      -- zalogowania jest warunkiem MOCNIEJSZYM niz brak zapisu (bez konta nie
      -- ma jak sprawdzic zapisu), a prog warstwy jest niezalezny od jednego
      -- i drugiego.
      CASE
        WHEN m.vis = 'authenticated' AND v_uid IS NULL THEN 'auth_required'
        WHEN m.vis = 'registered' AND NOT v_registered THEN 'registration_required'
        WHEN m.vis = 'tier' AND NOT public.has_tier_rank(m.rank_min) THEN 'tier_required'
        -- Bramka `guest_mode`: co widzi osoba BEZ ZAPISU. 'full' otwiera
        -- wszystko poza kontaktami, 'teaser' opis i agende, 'hidden' nic.
        WHEN NOT v_registered AND v_event.guest_mode = 'hidden'
          THEN 'registration_required'
        WHEN NOT v_registered AND v_event.guest_mode = 'teaser'
          AND m.k NOT IN ('description', 'agenda', 'registration')
          THEN 'registration_required'
        WHEN NOT v_registered AND v_event.guest_mode = 'full' AND m.k = 'contact'
          THEN 'registration_required'
        ELSE 'none'
      END AS reason
    FROM merged m
    WHERE m.visible
  )
  SELECT
    g.k,
    g.ord,
    g.h_pl,
    g.h_en,
    g.vis,
    g.rank_min,
    (g.reason <> 'none'),
    g.reason,
    CASE g.k
      WHEN 'description' THEN v_has_description
      WHEN 'agenda' THEN v_has_agenda
      WHEN 'speakers' THEN v_has_speakers
      WHEN 'sponsors' THEN v_has_sponsors
      WHEN 'registration' THEN (v_event.registration_mode <> 'none')
      WHEN 'map' THEN (btrim(COALESCE(v_event.location, '')) <> '')
      WHEN 'contact' THEN (v_event.host_user_id IS NOT NULL)
      -- 'materials': zrodla w bazie nie ma, wiec nie da sie policzyc. NULL,
      -- nie false - "nie wiem" i "policzone, wyszlo zero" to dwie rozne
      -- odpowiedzi i front reaguje na nie inaczej.
      ELSE NULL
    END
  FROM gated g
  ORDER BY g.ord, g.k;
END;
$$;

REVOKE ALL ON FUNCTION public.event_sections(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_sections(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_sections(text) IS
  'Uklad sekcji strony opublikowanego wydarzenia dla WOLAJACEGO: kolejnosc, nadpisany naglowek, bramka (is_locked + lock_reason z visibility i events.guest_mode) oraz has_content liczony z prawdziwego zrodla kazdej sekcji. Sekcje wylaczone przez redakcje nie wracaja; zamkniete wracaja z powodem.';

-- ----------------------------------------------------------------------------
-- 8) PUBLICZNA LISTA WYDARZEN
--
-- NAZWA MOWI, KTORA TO PLASZCZYZNA. `events_public_list` obok
-- `admin_events_list` czyta sie jednoznacznie; `events_list` obok
-- `admin_events_list` zapraszalo by do wolania jednej z plaszczyzny drugiej -
-- a te dwie funkcje roznia sie tym, ktorego najemce widza.
--
-- FILTRY SA TE, KTORE FRONT MA NAPRAWDE POKAZAC: rodzaj, format, zakres dat,
-- fraza, zakres czasowy (nadchodzace / archiwum / wszystkie). Kazdy jest
-- opcjonalny i kazdy dziala po stronie bazy - dzisiejszy odsiew w `useMemo`
-- nad `LIMIT 200` przestaje byc potrzebny, bo przestaje byc mozliwy do
-- pomylenia z prawda.
--
-- `total_count` JEDZIE W KAZDYM WIERSZU jako funkcja okna. To nie redundancja:
-- bez niej paginacja wymaga drugiego zapytania z tym samym filtrem, a dwa
-- zapytania rozjezdzaja sie przy kazdej publikacji miedzy nimi.
--
-- WYDARZENIA PROGOWANE ZOSTAJA NA LISCIE. Kafel wydarzenia czlonkowskiego jest
-- widoczny dla kazdego (z `tier_locked = true`), bo zamknieta lista nie
-- sprzedaje czlonkostwa, a od tego jest `min_tier_rank` na kaflu. Tresc
-- wydarzenia bramkuje `event_sections()` i `get_event_access()`, nie lista.
-- ----------------------------------------------------------------------------
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
  -- Gorna granica strony jest twarda: `p_limit` przychodzi z zapytania
  -- klienta, wiec bez niej jedno wywolanie z limitem 100000 czyta cale
  -- archiwum najemcy.
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
    -- Zakres czasowy liczy sie po KONCU wydarzenia (albo po jego poczatku, gdy
    -- konca nie ma): trwajace wydarzenie nalezy do nadchodzacych, a nie do
    -- archiwum - dokladnie ta sama regula, ktora dzisiaj stoi w `useMemo`
    -- trasy /events.
    AND (
      v_scope = 'all'
      OR (v_scope = 'upcoming' AND COALESCE(e.ends_at, e.starts_at) >= v_now)
      OR (v_scope = 'past' AND COALESCE(e.ends_at, e.starts_at) < v_now)
    )
    -- Filtr rodzaju obejmuje wydarzenia sprzed katalogu: trzymaja rodzaj
    -- w legacy `kind`, wiec bez drugiego czlonu znikalyby z wlasnego rodzaju.
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
  -- Nadchodzace ida od najblizszego, archiwum od najswiezszego. Dwa wyrazenia
  -- CASE zamiast dynamicznego SQL-a: dla danego zakresu jedno z nich jest
  -- stalym NULL-em, wiec sortuje wylacznie drugie.
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

-- ----------------------------------------------------------------------------
-- 9) ZAPAMIETANIE: PRZELACZNIK
--
-- IDEMPOTENCJA JEST OPCJONALNA I JAWNA. Bez pola `state` funkcja PRZELACZA
-- (klik w gwiazdke), z polem `state` USTAWIA (przywrocenie stanu po
-- ponowieniu zapytania, ktore juz raz doszlo). Bez tej drugiej sciezki
-- ponowienie po zerwanym polaczeniu cofa to, co sie udalo.
--
-- NAJEMCA I UZYTKOWNIK POCHODZA Z KONTEKSTU, NIGDY Z WEJSCIA. `p_payload` nie
-- ma pola `tenant_id` ani `user_id` i gdyby mial, funkcja by ich nie
-- przeczytala - wstrzyknieta wartosc pozwalalaby zapamietac wydarzenie
-- w imieniu kogos innego albo w obcym najemcy.
-- ----------------------------------------------------------------------------
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

  -- Wydarzenie musi byc OPUBLIKOWANE i W TYM najemcy. Zapamietanie szkicu albo
  -- wydarzenia obcej organizacji jest wyciekiem informacji o jego istnieniu.
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
    -- Wstawienie jest bezwarunkowe dla state = true i dla przelaczenia
    -- "nie bylo -> jest". `ON CONFLICT DO NOTHING` zamienia dwuklik
    -- w bezczynnosc zamiast bledu 23505.
    INSERT INTO public.event_bookmarks (tenant_id, event_id, user_id)
    VALUES (v_tenant, v_target, v_uid)
    ON CONFLICT (tenant_id, event_id, user_id) DO NOTHING
    RETURNING created_at INTO v_created_at;

    IF v_created_at IS NULL AND v_state IS NULL THEN
      -- Wiersz juz byl, a wolajacy PRZELACZA - wiec teraz go zdejmujemy.
      DELETE FROM public.event_bookmarks b
      WHERE b.tenant_id = v_tenant AND b.event_id = v_target AND b.user_id = v_uid;
      v_deleted := true;
    ELSIF v_created_at IS NULL THEN
      -- state = true, a wiersz juz istnieje: operacja idempotentna, oddajemy
      -- date pierwszego zapamietania, nie NULL.
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

-- ----------------------------------------------------------------------------
-- 10) ZAPAMIETANIA WOLAJACEGO
--
-- Oddaje TYLKO wiersze wolajacego i tylko z najemcy przegladanej domeny.
-- Kolumny wydarzenia sa te same co na kaflu listy, zeby ekran "Zapamietane"
-- rysowal sie tym samym komponentem co /events - jeden kafel, jeden kontrakt.
-- ----------------------------------------------------------------------------
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
    -- Wydarzenie WYCOFANE z publikacji znika z zapamietanych, ale wiersz
    -- zostaje: przywrocenie publikacji przywraca je na liste bez akcji
    -- uzytkownika. Kasowanie wiersza tutaj byloby cicha utrata jego decyzji.
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

-- ----------------------------------------------------------------------------
-- 11) DOMKNIECIE SYSTEMU REKLAMOWEGO DLA STRONY WYDARZENIA
--
-- CO ISTNIALO. W bazie NIE MA I NIGDY NIE BYLO funkcji rozstrzygajacej, ktore
-- reklamy pokazac - robi to klient: `fetchPlacements()` w src/lib/ads/queries.ts
-- pyta `ad_placements` z `.in('page_type', ['all', pageType])`, filtruje
-- `page_id` po pobraniu, a izolacje najemcow egzekwuje wylacznie polityka
-- "Public can read active ad_placements" (utenantowiona 20260630121500).
--
-- CZEGO TEN KLIENT NIE UMIE DLA WYDARZENIA. Zeby zawezic baner do JEDNEGO
-- wydarzenia, trzeba znac jego `id` - a strona zna `slug`. Dzisiejsza sciezka
-- wymaga wiec najpierw odczytu wydarzenia, potem odczytu placementow, i miesza
-- kolejnosc zaladowania reklamy z kolejnoscia zaladowania tresci (a reklama ma
-- byc leniwa - `useDeferredAd`). Ta funkcja robi jedno wywolanie po SLUGU
-- i oddaje gotowa liste kreacji do emisji.
--
-- WARIANT 'event' JEST TU UZYWANY PRZEZ POROWNANIE TEKSTOWE
-- (`page_type::text`), nie przez rzutowanie literalu na typ wyliczeniowy -
-- patrz punkt 6 naglowka pliku. To warunek poprawnosci, nie stylistyka:
-- rzutowanie literalu wymagalo by wartosci dodanej w TEJ SAMEJ transakcji.
--
-- CZEGO NIE ODDAJE. Kolumny `notes` (notatka wewnetrzna slotu) - reszta
-- kolumn slotu jest juz dzisiaj czytana przez `anon` polityka publiczna, wiec
-- funkcja nie odslania niczego nowego, tylko robi to jednym zapytaniem
-- i w granicach jednego najemcy.
-- ----------------------------------------------------------------------------
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
    -- 'all' = kreacja serwisowa, 'event' = kreacja strony wydarzenia (EB-937).
    AND p.page_type::text IN ('all', 'event')
    -- Przypiecie do konkretnego wydarzenia albo brak przypiecia. Placement
    -- wskazujacy INNE wydarzenie nie emituje sie tutaj.
    AND (p.page_id IS NULL OR p.page_id = ev.id)
    AND (p.starts_at IS NULL OR p.starts_at <= now())
    AND (p.ends_at IS NULL OR p.ends_at > now())
  ORDER BY p.sort_order, p.id;
$$;

REVOKE ALL ON FUNCTION public.event_ad_placements(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_ad_placements(text, text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_ad_placements(text, text) IS
  'Kreacje reklamowe do emisji na stronie wydarzenia (po slugu i pozycji), w najemcy z naglowka hosta. Uwzglednia page_type all oraz event (EB-937) i przypiecie ad_placements.page_id do tego wydarzenia. Nie oddaje ad_slots.notes.';

-- ----------------------------------------------------------------------------
-- 12) INDEKSY, KTORYCH TU NIE MA - I DLACZEGO
--
-- Strona wydarzenia jest najczesciej czytanym ekranem modulu, wiec kazdy
-- indeks byl rozwazony, a te ponizej zostaly ODRZUCONE. Indeks bez uzasadnienia
-- to koszt zapisu bez zwrotu, a lista odrzuconych jest tak samo czescia
-- projektu jak lista dodanych.
--
--   * `events (tenant_id, slug)` - JUZ ISTNIEJE jako ograniczenie UNIQUE
--     z 20260713093000. Odczyt strony po slugu to trafienie w ten indeks;
--     drugi, czesciowy (`WHERE status = 'published'`) oszczedzilby jedno
--     porownanie statusu na jednym wierszu.
--
--   * `events (tenant_id, starts_at) WHERE status = 'published'` - JUZ ISTNIEJE
--     jako `idx_events_tenant_upcoming` z 20260713093000 i obsluguje oba
--     zakresy listy: nadchodzace czytaja go w przod, archiwum w tyl.
--
--   * INDEKS CZESCIOWY NA WYDARZENIACH PRZYSZLYCH jest w PostgreSQL NIEMOZLIWY.
--     Predykat indeksu musi byc IMMUTABLE, a `now()` jest STABLE - baza odrzuca
--     `WHERE starts_at >= now()` bledem 42P17. Poprawnym przyblizeniem jest
--     wlasnie indeks czesciowy po STATUSIE z `starts_at` jako kluczem, czyli
--     ten, ktory juz mamy: zbior "opublikowane" jest maly i stabilny, a granice
--     czasu odcina skan po kluczu.
--
--   * `events (tenant_id, event_type_id, starts_at) WHERE status = 'published'` -
--     odrzucony. Filtr rodzaju obsluguje `events_event_type_idx` z 20260823120000,
--     porzadek obsluguje `idx_events_tenant_upcoming`; trzecia permutacja tych
--     samych kolumn oszczedza jedno sortowanie na kilkuset wierszach jednego
--     najemcy. Do rozwazenia ponownie, gdy jeden najemca przekroczy kilka
--     tysiecy opublikowanych wydarzen.
--
--   * INDEKS TRIGRAMOWY (`gin_trgm_ops`) POD FRAZE - odrzucony. Fraza dziala
--     przez `ILIKE '%...%'`, czyli bez indeksu, ale przeszukiwany zbior to
--     opublikowane wydarzenia JEDNEGO najemcy odciete indeksem czesciowym -
--     rzedy setek wierszy. Indeks GIN na pieciu kolumnach tekstowych obciazalby
--     kazdy zapis wydarzenia, zeby przyspieszyc skan, ktory i tak jest krotszy
--     od jednego round-tripu sieciowego.
--
--   * `event_bookmarks (tenant_id, event_id)` - odrzucony jako duplikat
--     prefiksu klucza UNIQUE (uzasadnienie przy tabeli).
-- ----------------------------------------------------------------------------
