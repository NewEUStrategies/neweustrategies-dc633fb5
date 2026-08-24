-- ============================================================================
-- Event Builder, etap 3: AGENDA WYDARZENIA - SESJE, SCIEZKI, SALE, PRELEGENCI
--
-- STAN PRZED. Agenda wydarzenia zyje jako `jsonb` w tresci widgetu
-- `event-schedule` (`days[].sessions[]` w `builder_data`), typowana wylacznie
-- po stronie klienta w `src/lib/events/schedule.ts`. Dla plakatu agendy to
-- wystarcza. Nie wystarcza na nic, co wymaga ADRESOWALNOSCI sesji:
--   * limit miejsc na sesje i zapis na sesje - jsonb nie ma gdzie trzymac
--     wiersza "kto sie zapisal", a limit bez wiersza jest napisem;
--   * kolizja sali - dwie sesje w tej samej sali o tej samej godzinie sa
--     w jsonbie legalne, bo nikt ich nie porownuje;
--   * prelegent wspoldzielony miedzy sesjami - jsonb powtarza jego imie
--     w kazdej sesji (`ScheduleSpeakerRef.name`), wiec zmiana nazwiska
--     wymaga edycji N sesji, a "pokaz mi moje wystapienia" nie da sie
--     zapytac;
--   * widocznosc sesji dla wybranej grupy uczestnikow - jsonb nie zna
--     progu warstwy ani zapisu, wiec kazda sesja jest widoczna dla kazdego;
--   * sortowanie i filtrowanie po czasie W BAZIE - lista sesji na pulpicie
--     musi dzisiaj wczytac caly `builder_data` wydarzenia i posortowac go
--     w JavaScripcie.
--
-- Kontrakt `src/lib/events/schedule.ts` ZOSTAJE nietkniety: widget dalej
-- renderuje agende z tresci widgetu, gdy zrodlem jest `manual`. Ta migracja
-- dodaje DRUGIE, adresowalne zrodlo (`source: "event"` z projektu, par. 4.2),
-- ktore oddaje te same pola co parser jsonb (tytul i opis PL/EN, godziny,
-- sala, prelegenci) i doklada to, czego jsonb nie umie uniesc.
--
-- STAN PO. Piec tabel, dziewietnascie funkcji RPC i jeden trigger walidacyjny:
--   * `event_tracks`  - sciezki tematyczne wydarzenia (klucz, nazwa PL/EN,
--     kolor akcentu, kolejnosc, aktywnosc);
--   * `event_rooms`   - sale i przestrzenie wydarzenia (nazwa wlasna,
--     pojemnosc, pietro, lokalizacja, kolejnosc, aktywnosc);
--   * `event_sessions` - sesja agendy z wygenerowanym przedzialem czasu,
--     formatem, sala, sciezka, limitem miejsc, progiem warstwy, zasada
--     Chatham House, wymogiem zapisu, publikacja, kolejnoscia, adresem
--     transmisji i nagrania oraz sesja nadrzedna (bloki z podsesjami);
--   * `event_session_speakers` - obsada sesji oparta o ISTNIEJACY rejestr
--     `speaker_profiles` (zaden drugi rejestr osob tu nie powstaje) z rola
--     sceniczna i kolejnoscia wystapienia;
--   * `event_session_signups`  - zapis uczestnika na konkretna sesje
--     z limitem miejsc, lista rezerwowa i awansem z listy.
--
-- DLACZEGO TAK
--
-- 1) PRZEDZIAL CZASU JEST KOLUMNA WYGENEROWANA, NIE WYLICZENIEM W ZAPYTANIU.
--    `time_range tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at,
--    '[)')) STORED` daje trzy rzeczy naraz: indeks GiST do kolizji, jeden
--    operator `&&` zamiast czterech porownan w kazdym zapytaniu, i - co
--    najwazniejsze - NOSNIK OGRANICZENIA EXCLUDE. Przedzial jest polotwarty
--    `[)`, wiec sesje styk w styk (10:00-11:00 i 11:00-12:00) NIE koliduja;
--    z przedzialem domknietym kazda agenda blokowalaby sie na samej sobie.
--
-- 2) KOLIZJA SALI JEST OGRANICZENIEM BAZY, NIE WALIDACJA FORMULARZA.
--    `EXCLUDE USING gist (tenant_id WITH =, room_id WITH =, time_range WITH &&)`
--    - sala jest zasobem FIZYCZNYM, wiec podwojna rezerwacja nie jest
--    "ostrzezeniem", tylko stanem niemozliwym. Sprawdzenie w kodzie aplikacji
--    jest wyscigiem (dwa formularze zapisane w tej samej sekundzie przechodza
--    oba), a sprawdzenie w kliencie nie istnieje dla importu i dla `COPY`.
--    Predykat pomija WYLACZNIE sesje odwolane (sala wraca do puli) i sesje bez
--    przypisanej sali. Sesji ROBOCZYCH (`draft`) NIE pomija swiadomie: wartosc
--    ograniczenia jest w chwili WPISYWANIA agendy, a nie w chwili publikacji -
--    inaczej redaktor buduje trzydzieci sesji, klika "opublikuj wszystkie"
--    i dostaje trzydziesci bledow naraz, kazdy o zdarzeniu z zeszlego tygodnia.
--
-- 3) KOLIZJA PRELEGENTA JEST BLOKADA SCIEZKI ZAPISU, NIE OGRANICZENIEM TABELI.
--    Przedzial czasu mieszka na sesji, a obsada na wierszu potomnym, wiec
--    ograniczenie EXCLUDE na obsadzie wymagaloby ZDUBLOWANIA przedzialu w
--    kazdym wierszu obsady i triggera przepisujacego go przy kazdej zmianie
--    godzin sesji. Skutek uboczny byl by gorszy od choroby: przesuniecie sesji
--    na inna godzine - najczestsza operacja w budowaniu agendy - konczylo by
--    sie bledem ograniczenia na TABELI WNUKA, czyli komunikatem o wierszu,
--    ktorego redaktor w tej chwili nie edytuje. Dlatego:
--      * `admin_event_session_speakers_set` ODRZUCA obsadzenie osoby, ktora
--        w tym czasie ma juz inna sesje - z jawna furtka: wiersz obsady niesie
--        `allow_overlap`, a rola `host` (gospodarz otwierajacy dwie sciezki)
--        jest z reguly wylaczona;
--      * `admin_event_agenda_conflicts` RAPORTUJE kolizje powstale POZNIEJ
--        (po przesunieciu godzin, po obnizeniu pojemnosci sali, po zwezeniu
--        okna wydarzenia). Raport jest liczony z danych, nie zgadywany.
--
-- 4) LIMIT MIEJSC SERIALIZUJE SIE BLOKADA WIERSZA SESJI, NIE ODCZYTEM LICZNIKA.
--    `event_session_signup` bierze `SELECT ... FOR UPDATE` na wierszu sesji
--    i dopiero pod ta blokada liczy zajete miejsca (wzorzec `rsvp_event`
--    z 20260713093000). Licznik zmaterializowany na sesji NIE ISTNIEJE
--    swiadomie: licznik jest drugim zrodlem prawdy, ktore rozjezdza sie po
--    pierwszym `DELETE` bez triggera, a lista panelu i tak liczy zapisy
--    LATERAL-em per wiersz.
--
-- 5) LIMIT MIEJSC WYMAGA WLACZONEGO ZAPISU (`CHECK (capacity IS NULL OR
--    requires_signup)`). Limit na sesji, na ktora nie da sie zapisac, jest
--    metryka bez procesu, ktory ja zapisuje - czyli bledem podanym jako
--    funkcja. Pojemnosc SALI jest osobna kolumna na `event_rooms` i sluzy
--    planowaniu, nie egzekwowaniu.
--
-- 6) OBSADA WSKAZUJE `speaker_profiles`, A NIE NOWA TABELE OSOB. Repozytorium
--    ma jeden rejestr prelegentow (nakladka na `profiles`, migracja
--    20260727200000) z `admin_upsert_speaker_profile` i publiczna projekcja
--    `get_public_speakers`. Drugi rejestr oznaczalby dwie karty tej samej
--    osoby i dwie oceny. Prelegent BEZ KONTA (doc par. 4.11, 21 z 21 w danych
--    referencyjnych) to zadanie modulu uczestnikow - patrz KONTRAKT ponizej.
--
-- IZOLACJA NAJEMCOW
--   * Kazda z pieciu tabel ma wlasna kolumne `tenant_id uuid NOT NULL`
--     z kluczem obcym do `tenants` i kaskada usuniecia.
--   * Kazde powiazanie z wydarzeniem jest KLUCZEM OBCYM ZLOZONYM do
--     `events (tenant_id, id)` (ograniczenie `events_tenant_id_key`
--     z 20260823135000), wiec wiersz nie moze wskazac wydarzenia obcego
--     najemcy - baza odrzuca to na poziomie silnika, takze przy imporcie.
--   * Sesja wskazuje sale i sciezke kluczem obcym POTROJNYM
--     `(tenant_id, event_id, room_id) -> event_rooms (tenant_id, event_id, id)`.
--     Dzieki temu warunek "sala i sciezka z TEGO SAMEGO wydarzenia" jest
--     deklaracja schematu, a nie sprawdzeniem w RPC, ktore mozna pominac.
--   * Tabele wnuki (`event_session_speakers`, `event_session_signups`) maja
--     u siebie `UNIQUE (tenant_id, id)` i klucz obcy potrojny do sesji.
--   * Kazda tabela ma wlaczone RLS i JAWNE polityki. Zapis NIE MA zadnej
--     polityki klienckiej - jedyna droga to RPC z bramka
--     `assert_editor_tenant()` (panel) albo `event_session_signup` (uczestnik).
--     Wzorzec `event_rsvps` / `speaker_profiles`.
--   * Plaszczyzna administracyjna uzywa WYLACZNIE `assert_editor_tenant()`
--     (tenant domowy). Plaszczyzna tresci uzywa WYLACZNIE
--     `public_tenant_id()`. Zadne cialo SECURITY DEFINER nie miesza tych
--     dwoch swiatow - naglowek `x-tenant-host` jest falsyfikowalny, wiec
--     mieszanka pozwolilaby podszyc sie pod najemce (bramka
--     `check:sql-tenant-scope`).
--   * `stream_url` i `recording_url` sa ODCIETE od klienckiego SELECT-a
--     grantem kolumnowym (wzorzec `events.join_url` z 20260713093000).
--     Panel czyta je przez `admin_event_session_detail`, uczestnik przez
--     `event_session_access` z serwerowa ocena uprawnien.
--
-- KONTRAKT MIEDZYMODULOWY (do domkniecia przez modul uczestnikow)
--   Rejestr uczestnikow wydarzenia powstaje w migracji POZNIEJSZEJ
--   (20260823150000_event_people_registration.sql: `event_people` - kartoteka
--   osob NAJEMCY, oraz `event_registrations` - zapis osoby na WYDARZENIE), wiec
--   ta migracja nie moze sie do nich odwolac kluczem obcym: w chwili jej
--   wykonania tamte tabele jeszcze nie istnieja.
--
--   WYBOR JEST JAWNY: `event_session_signups` wskazuje `auth.users` przez
--   `user_id`. To jest ta czesc zapisu, ktora da sie DZISIAJ policzyc
--   i wyegzekwowac - limit miejsc, lista rezerwowa z awansem, kolizja czasowa
--   uczestnika, prog warstwy. Alternatywa (trzymac w tej migracji tylko limit,
--   a powiazanie z osoba zostawic modulowi uczestnikow) zostawilaby limit bez
--   procesu, ktory go zapisuje - czyli metryke bez zapisu, czego ten projekt
--   zabrania.
--
--   KROK DO PRZODU dla modulu uczestnikow - jeden ALTER, zero migracji danych
--   (zapisy zalogowanych zostaja jak sa):
--     ALTER TABLE public.event_session_signups
--       ADD COLUMN registration_id uuid,
--       ADD CONSTRAINT event_session_signups_registration_fk
--         FOREIGN KEY (tenant_id, event_id, registration_id)
--         REFERENCES public.event_registrations (tenant_id, event_id, id)
--         ON DELETE CASCADE,
--       ALTER COLUMN user_id DROP NOT NULL,
--       ADD CONSTRAINT event_session_signups_subject_one
--         CHECK ((user_id IS NOT NULL) OR (registration_id IS NOT NULL));
--   `event_registrations` jest tu lepszym celem niz `event_people`, bo niesie
--   trojke (tenant, wydarzenie, zapis) - a wiec pilnuje TAKZE tego, ze na sesje
--   zapisuje sie ktos zarejestrowany na TO wydarzenie. `event_people` ma
--   `UNIQUE (tenant_id, id)` bez `event_id`, wiec sam nie da tej gwarancji.
--
--   Analogicznie obsada sesji: `speaker_profile_id` przestaje byc jedyna droga,
--   gdy trzeba wpisac prelegenta BEZ KONTA -
--     ALTER TABLE public.event_session_speakers
--       ADD COLUMN person_id uuid,
--       ADD CONSTRAINT event_session_speakers_person_fk
--         FOREIGN KEY (tenant_id, person_id)
--         REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE,
--       ALTER COLUMN speaker_profile_id DROP NOT NULL,
--       ADD CONSTRAINT event_session_speakers_subject_one
--         CHECK ((speaker_profile_id IS NOT NULL) <> (person_id IS NOT NULL));
--   Do tego czasu obie sciezki sa pelne i egzekwowalne, tylko wezsze.
--
-- FORWARD-ONLY I IDEMPOTENTNOSC. `CREATE TABLE IF NOT EXISTS`, ograniczenia
-- dokladane blokami `DO $$ ... $$` po `pg_constraint`, polityki i triggery
-- w schemacie `DROP IF EXISTS` + `CREATE`, funkcje `DROP FUNCTION IF EXISTS`
-- z pelna sygnatura + `CREATE FUNCTION`. Powtorny przebieg nie psuje danych.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Rozszerzenie btree_gist
--
-- Ograniczenie EXCLUDE porownuje `tenant_id` i `room_id` (uuid) operatorem `=`
-- W INDEKSIE GiST, a klasy operatorow dla typow btree-owych w GiST wnosi
-- wlasnie btree_gist. Schemat wybieramy dynamicznie: hostowany Supabase trzyma
-- rozszerzenia w `extensions`, lokalna baza CI moze go nie miec.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE EXTENSION btree_gist WITH SCHEMA extensions;
  ELSE
    CREATE EXTENSION btree_gist;
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 0b) Tozsamosc prelegenta w granicach najemcy
--
-- To samo, co `events_tenant_id_key` zrobil dla wydarzenia (20260823135000):
-- bez `UNIQUE (tenant_id, id)` na `speaker_profiles` obsada sesji musialaby
-- trzymac DWA niezalezne klucze obce (tenant i profil), a wtedy wiersz obsady
-- moglby wskazywac prelegenta najemcy A, majac w `tenant_id` najemce B.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.speaker_profiles'::regclass
      AND conname = 'speaker_profiles_tenant_id_key'
  ) THEN
    ALTER TABLE public.speaker_profiles
      ADD CONSTRAINT speaker_profiles_tenant_id_key UNIQUE (tenant_id, id);
  END IF;
END
$$;

COMMENT ON CONSTRAINT speaker_profiles_tenant_id_key ON public.speaker_profiles IS
  'Tozsamosc profilu prelegenta w granicach najemcy. Cel klucza obcego zlozonego (tenant_id, speaker_profile_id) z event_session_speakers.';

-- ----------------------------------------------------------------------------
-- 1) SCIEZKI TEMATYCZNE (tracks)
--
-- Sciezka nalezy do WYDARZENIA, nie do organizacji: "Cyber" na kongresie
-- w marcu i "Cyber" na kongresie w listopadzie to dwie rozne sciezki z dwoma
-- innymi zestawami sesji, a wspolny katalog wymuszalby na redaktorze
-- rozstrzyganie, ktora jest ktora, przy kazdym przypisaniu sesji.
--
-- `key` jest stabilnym identyfikatorem dla adresu URL filtra agendy
-- (`/agenda?track=cyber`) i dla kolorowania w widgecie - dlatego ma format
-- identyczny z `event_types.key` i jest unikalny w obrebie wydarzenia.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  key text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  accent_color text,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_tracks_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT event_tracks_name_pl_len CHECK (char_length(btrim(name_pl)) BETWEEN 2 AND 80),
  CONSTRAINT event_tracks_name_en_len CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 80),
  -- Kolor jedzie do CSS jako zmienna, wiec musi byc literalem heksadecymalnym
  -- (wzorzec `event_types.accent_color` z 20260823120000).
  CONSTRAINT event_tracks_accent_hex CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$'),
  -- Tozsamosc w granicach najemcy (cel kluczy obcych z tabel potomnych).
  CONSTRAINT event_tracks_tenant_id_key UNIQUE (tenant_id, id),
  -- Tozsamosc w granicach najemcy I WYDARZENIA - cel klucza obcego potrojnego
  -- z `event_sessions`, ktory wymusza "sciezka z tego samego wydarzenia".
  CONSTRAINT event_tracks_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_tracks_event_key_unique UNIQUE (tenant_id, event_id, key),
  CONSTRAINT event_tracks_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_tracks IS
  'Sciezki tematyczne agendy jednego wydarzenia. `key` jest stabilnym identyfikatorem filtra agendy; zapis wylacznie przez admin_event_track_save.';
COMMENT ON COLUMN public.event_tracks.is_active IS
  'Wylaczona sciezka znika z selektu w formularzu sesji, ale NIE znika z sesji juz do niej przypisanych - inaczej agenda gubilaby etykiety.';

CREATE INDEX IF NOT EXISTS event_tracks_event_order_idx
  ON public.event_tracks (tenant_id, event_id, sort_order, key);

DROP TRIGGER IF EXISTS event_tracks_touch_updated_at ON public.event_tracks;
CREATE TRIGGER event_tracks_touch_updated_at
  BEFORE UPDATE ON public.event_tracks
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_tracks TO anon;
GRANT SELECT ON public.event_tracks TO authenticated;
GRANT ALL ON public.event_tracks TO service_role;

ALTER TABLE public.event_tracks ENABLE ROW LEVEL SECURITY;

-- Plaszczyzna TRESCI: nazwa sciezki jest widoczna w publicznej agendzie, ale
-- tylko dla OPUBLIKOWANEGO wydarzenia i tylko w obrebie najemcy z naglowka.
-- Wiazanie idzie przez RODZICA (wzorzec przywrocony migracja 20260814210824).
DROP POLICY IF EXISTS "event_tracks_public_read" ON public.event_tracks;
CREATE POLICY "event_tracks_public_read"
  ON public.event_tracks FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_tracks.event_id
        AND e.tenant_id = event_tracks.tenant_id
        AND e.status = 'published'
    )
  );

-- Plaszczyzna ADMINISTRACYJNA: staff redakcyjny widzi sciezki takze
-- w wydarzeniach roboczych, ale WYLACZNIE w swoim tenancie domowym.
DROP POLICY IF EXISTS "event_tracks_staff_read" ON public.event_tracks;
CREATE POLICY "event_tracks_staff_read"
  ON public.event_tracks FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );
-- Zapis: BRAK polityki klienckiej. Jedyna droga to admin_event_track_save /
-- admin_event_track_delete (SECURITY DEFINER, bramka assert_editor_tenant()).

-- ----------------------------------------------------------------------------
-- 2) SALE I PRZESTRZENIE (rooms)
--
-- `name` jest JEDNOJEZYCZNE swiadomie. Nazwa sali to nazwa wlasna miejsca
-- ("Sala Warszawa", "Blue Room", "Foyer") - tak samo jednojezyczna jak
-- `events.location`. Tlumaczenie nazwy wlasnej sali produkuje dwie nazwy
-- tego samego pomieszczenia na dwoch wersjach jezykowych agendy i uczestnika,
-- ktory ich nie znajduje na planie budynku.
--
-- `capacity` sluzy PLANOWANIU (walidacja limitu sesji), nie egzekwowaniu -
-- egzekwowalny limit mieszka na sesji, bo to na sesje sie zapisujemy.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  name text NOT NULL,
  capacity integer,
  floor text,
  location_note text,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_rooms_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT event_rooms_floor_len CHECK (floor IS NULL OR char_length(btrim(floor)) BETWEEN 1 AND 60),
  CONSTRAINT event_rooms_location_note_len
    CHECK (location_note IS NULL OR char_length(location_note) <= 300),
  CONSTRAINT event_rooms_capacity_positive CHECK (capacity IS NULL OR capacity > 0),
  CONSTRAINT event_rooms_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_rooms_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_rooms_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_rooms IS
  'Sale i przestrzenie jednego wydarzenia. Nazwa jest jednojezyczna (nazwa wlasna miejsca). Zapis wylacznie przez admin_event_room_save.';
COMMENT ON COLUMN public.event_rooms.capacity IS
  'Pojemnosc pomieszczenia. Sluzy walidacji limitu miejsc sesji (event_sessions.capacity), nie egzekwowaniu zapisow.';
COMMENT ON COLUMN public.event_rooms.location_note IS
  'Wskazowka dojscia ("wejscie od strony parku", "winda B"). Jednojezyczna z tego samego powodu co nazwa.';

-- Dwie sale o tej samej nazwie w jednym wydarzeniu sa bledem redakcyjnym,
-- ktorego nie da sie odroznic w selekcie. Porownanie po `lower(btrim(...))`,
-- bo "Sala A" i "sala a " to ta sama sala.
CREATE UNIQUE INDEX IF NOT EXISTS event_rooms_event_name_unique
  ON public.event_rooms (tenant_id, event_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS event_rooms_event_order_idx
  ON public.event_rooms (tenant_id, event_id, sort_order, name);

DROP TRIGGER IF EXISTS event_rooms_touch_updated_at ON public.event_rooms;
CREATE TRIGGER event_rooms_touch_updated_at
  BEFORE UPDATE ON public.event_rooms
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_rooms TO anon;
GRANT SELECT ON public.event_rooms TO authenticated;
GRANT ALL ON public.event_rooms TO service_role;

ALTER TABLE public.event_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_rooms_public_read" ON public.event_rooms;
CREATE POLICY "event_rooms_public_read"
  ON public.event_rooms FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_rooms.event_id
        AND e.tenant_id = event_rooms.tenant_id
        AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS "event_rooms_staff_read" ON public.event_rooms;
CREATE POLICY "event_rooms_staff_read"
  ON public.event_rooms FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );
-- Zapis: BRAK polityki klienckiej (admin_event_room_save / _delete).

-- ----------------------------------------------------------------------------
-- 3) SESJE AGENDY
--
-- KLUCZE OBCE DO SALI I SCIEZKI SA POTROJNE: (tenant_id, event_id, room_id).
-- Para (tenant_id, room_id) pilnowalaby tylko najemcy, a chcemy TAKZE
-- wydarzenia - inaczej sesja kongresu marcowego moze wskazac sale kongresu
-- listopadowego i agenda wysyla uczestnika do budynku, ktorego tego dnia nikt
-- nie wynajal.
--
-- ZACHOWANIE PRZY USUNIECIU SALI/SCIEZKI to NO ACTION (domyslne), nie
-- SET NULL i nie CASCADE. Powody, po kolei:
--   * CASCADE usuwalby SESJE przy usunieciu sali - utrata pracy redakcyjnej
--     przy operacji, ktora wyglada niewinnie;
--   * SET NULL na kluczu zlozonym zeruje WSZYSTKIE kolumny klucza (w tym
--     `tenant_id NOT NULL`), a wariant z lista kolumn wymaga PostgreSQL 15;
--   * NO ACTION odrzuca usuniecie sali, ktora ma sesje - i to jest wlasciwa
--     odpowiedz. W przeciwienstwie do RESTRICT sprawdzenie jest odroczone do
--     KONCA INSTRUKCJI, wiec kaskadowe usuniecie WYDARZENIA (ktore usuwa
--     w tej samej instrukcji i sale, i sesje) przechodzi bez bledu.
-- Panel dostaje czysty komunikat wczesniej: admin_event_room_delete liczy
-- sesje i odmawia z bledem `room_in_use`.
--
-- SESJA NADRZEDNA (`parent_session_id`) sluzy blokom zlozonym z podsesji
-- ("Blok panelowy 14:00-17:00" z trzema panelami w srodku). Gniezdzenie jest
-- JEDNOPOZIOMOWE - podsesja nie moze byc rodzicem (trigger walidacyjny).
-- Bez tego ograniczenia agenda staje sie drzewem o nieznanej glebokosci,
-- ktorego zaden widget nie umie zrenderowac, a cykl (A rodzicem B, B rodzicem
-- A) jest w schemacie legalny.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  parent_session_id uuid,
  track_id uuid,
  room_id uuid,
  title_pl text NOT NULL,
  title_en text NOT NULL,
  description_pl text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  -- Przedzial polotwarty: sesje styk w styk nie koliduja (patrz naglowek).
  time_range tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  format text NOT NULL DEFAULT 'onsite',
  status text NOT NULL DEFAULT 'draft',
  capacity integer,
  requires_signup boolean NOT NULL DEFAULT false,
  min_tier_rank integer NOT NULL DEFAULT 0,
  chatham_house boolean NOT NULL DEFAULT false,
  is_private boolean NOT NULL DEFAULT false,
  allow_overlap boolean NOT NULL DEFAULT true,
  stream_url text,
  recording_url text,
  sort_order integer NOT NULL DEFAULT 100,
  published_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sessions_title_pl_len CHECK (char_length(btrim(title_pl)) BETWEEN 2 AND 200),
  CONSTRAINT event_sessions_title_en_len CHECK (char_length(btrim(title_en)) BETWEEN 2 AND 200),
  CONSTRAINT event_sessions_desc_pl_len CHECK (char_length(description_pl) <= 4000),
  CONSTRAINT event_sessions_desc_en_len CHECK (char_length(description_en) <= 4000),
  CONSTRAINT event_sessions_time_order CHECK (ends_at > starts_at),
  -- Sesja dluzsza niz dwa dni to pomylka jednostki albo daty, nie sesja.
  CONSTRAINT event_sessions_duration_sane CHECK (ends_at <= starts_at + interval '48 hours'),
  CONSTRAINT event_sessions_format_values CHECK (format IN ('onsite', 'online', 'hybrid')),
  CONSTRAINT event_sessions_status_values CHECK (status IN ('draft', 'published', 'cancelled')),
  CONSTRAINT event_sessions_capacity_nonneg CHECK (capacity IS NULL OR capacity >= 0),
  -- Limit miejsc bez wlaczonego zapisu jest metryka, ktorej nikt nie egzekwuje
  -- (patrz punkt 5 naglowka). Pojemnosc pomieszczenia mieszka na `event_rooms`.
  CONSTRAINT event_sessions_capacity_needs_signup CHECK (capacity IS NULL OR requires_signup),
  CONSTRAINT event_sessions_tier_rank_nonneg CHECK (min_tier_rank >= 0),
  -- Adresy jada do atrybutu href / do odtwarzacza, wiec musza byc https.
  CONSTRAINT event_sessions_stream_url_https
    CHECK (stream_url IS NULL OR stream_url ~ '^https://'),
  CONSTRAINT event_sessions_recording_url_https
    CHECK (recording_url IS NULL OR recording_url ~ '^https://'),
  CONSTRAINT event_sessions_parent_not_self CHECK (parent_session_id IS DISTINCT FROM id),
  CONSTRAINT event_sessions_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_sessions_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_sessions_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  -- Podsesja ginie razem z blokiem nadrzednym - blok bez zawartosci jest
  -- pusta godzina w agendzie, wiec kaskada jest tu intencja, nie skutkiem.
  CONSTRAINT event_sessions_parent_fk FOREIGN KEY (tenant_id, event_id, parent_session_id)
    REFERENCES public.event_sessions (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sessions_track_fk FOREIGN KEY (tenant_id, event_id, track_id)
    REFERENCES public.event_tracks (tenant_id, event_id, id),
  CONSTRAINT event_sessions_room_fk FOREIGN KEY (tenant_id, event_id, room_id)
    REFERENCES public.event_rooms (tenant_id, event_id, id)
);

COMMENT ON TABLE public.event_sessions IS
  'Sesja agendy wydarzenia. Zrodlo agendy adresowalnej (zapisy, kolizje, prelegenci) obok agendy jsonb w tresci widgetu event-schedule. Zapis wylacznie przez admin_event_session_save.';
COMMENT ON COLUMN public.event_sessions.time_range IS
  'Przedzial polotwarty [starts_at, ends_at) - nosnik ograniczenia EXCLUDE na kolizje sali i operatora && w raporcie kolizji prelegenta.';
COMMENT ON COLUMN public.event_sessions.format IS
  'GDZIE sie dzieje sesja: onsite / online / hybrid. Te same wartosci co events.format, zeby jedna mapa etykiet obslugiwala oba poziomy.';
COMMENT ON COLUMN public.event_sessions.capacity IS
  'Limit miejsc egzekwowany pod blokada wiersza w event_session_signup. Wymaga requires_signup = true (CHECK) - limit bez zapisow nie ma kto egzekwowac.';
COMMENT ON COLUMN public.event_sessions.requires_signup IS
  'Sesja przyjmuje zapisy i wymaga ich do udzialu. false = wejscie wolne dla kazdego, kto ma dostep do wydarzenia (zapis odrzucany bledem signup_disabled).';
COMMENT ON COLUMN public.event_sessions.min_tier_rank IS
  'Prog rangi warstwy czlonkowskiej. 0 = bez progu. Sprawdzany przez has_tier_rank() na plaszczyznie tresci.';
COMMENT ON COLUMN public.event_sessions.chatham_house IS
  'Zasada Chatham House: wolno cytowac tresc, nie wolno przypisywac jej osobom. Front musi to napisac przy sesji, a nie tylko przy wydarzeniu.';
COMMENT ON COLUMN public.event_sessions.is_private IS
  'Sesja widoczna WYLACZNIE dla zapisanych (i dla staffa w panelu). Publiczna agenda jej nie zwraca osobie bez zapisu.';
COMMENT ON COLUMN public.event_sessions.allow_overlap IS
  'true = uczestnik moze byc zapisany na te sesje i na inna w tym samym czasie. false na OBU sesjach blokuje podwojny zapis (wzorzec "Allow overlap").';
COMMENT ON COLUMN public.event_sessions.stream_url IS
  'Adres transmisji. ODCIETY od klienckiego SELECT grantem kolumnowym - droga: event_session_access (uczestnik) albo admin_event_session_detail (panel).';
COMMENT ON COLUMN public.event_sessions.recording_url IS
  'Adres nagrania. Jak stream_url odciety grantem kolumnowym; dostep po randze warstwy, BEZ wymogu zapisu (doktryna get_event_access z 20260713093000).';
COMMENT ON COLUMN public.event_sessions.parent_session_id IS
  'Blok nadrzedny dla podsesji. Gniezdzenie jednopoziomowe - podsesja nie moze byc rodzicem (trigger tg_event_sessions_validate).';

CREATE INDEX IF NOT EXISTS event_sessions_event_time_idx
  ON public.event_sessions (tenant_id, event_id, starts_at, sort_order);
CREATE INDEX IF NOT EXISTS event_sessions_event_status_idx
  ON public.event_sessions (tenant_id, event_id, status);
CREATE INDEX IF NOT EXISTS event_sessions_track_idx
  ON public.event_sessions (tenant_id, track_id) WHERE track_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_sessions_room_idx
  ON public.event_sessions (tenant_id, room_id) WHERE room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_sessions_parent_idx
  ON public.event_sessions (tenant_id, parent_session_id) WHERE parent_session_id IS NOT NULL;
-- Raport kolizji prelegenta i "co sie dzieje teraz" pytaja o PRZEDZIAL, nie
-- o poczatek - indeks GiST na przedziale obsluguje operator &&.
CREATE INDEX IF NOT EXISTS event_sessions_time_range_idx
  ON public.event_sessions USING gist (time_range);

-- ----------------------------------------------------------------------------
-- 3b) Ograniczenie kolizji sali
--
-- Klasa operatorow `gist_uuid_ops` przychodzi z btree_gist, ktore w hostowanym
-- Supabase mieszka w schemacie `extensions` - a ten nie musi byc w search_path
-- w chwili wykonywania migracji. Dlatego nazwa klasy jest skladana dynamicznie
-- z katalogu, zamiast liczyc na sciezke wyszukiwania.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_opclass text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_sessions'::regclass
      AND conname = 'event_sessions_room_no_overlap'
  ) THEN
    RETURN;
  END IF;

  SELECT quote_ident(n.nspname) || '.gist_uuid_ops'
    INTO v_opclass
  FROM pg_opclass oc
  JOIN pg_namespace n ON n.oid = oc.opcnamespace
  JOIN pg_am am ON am.oid = oc.opcmethod
  WHERE oc.opcname = 'gist_uuid_ops' AND am.amname = 'gist'
  LIMIT 1;

  IF v_opclass IS NULL THEN
    RAISE EXCEPTION 'btree_gist_missing: klasa gist_uuid_ops nie istnieje - kolizje sal nie da sie wymusic';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.event_sessions ADD CONSTRAINT event_sessions_room_no_overlap '
    'EXCLUDE USING gist (tenant_id %1$s WITH =, room_id %1$s WITH =, time_range WITH &&) '
    'WHERE (room_id IS NOT NULL AND status <> ''cancelled'')',
    v_opclass
  );
END
$$;

COMMENT ON CONSTRAINT event_sessions_room_no_overlap ON public.event_sessions IS
  'Jedna sala nie moze miec dwoch nieodwolanych sesji w tym samym czasie. Obejmuje TAKZE sesje robocze - kolizja ma bolec przy wpisywaniu agendy, nie przy publikacji.';

DROP TRIGGER IF EXISTS event_sessions_touch_updated_at ON public.event_sessions;
CREATE TRIGGER event_sessions_touch_updated_at
  BEFORE UPDATE ON public.event_sessions
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- Granty KOLUMNOWE: bez `stream_url` i `recording_url` (wzorzec
-- events.join_url). Kolumna `time_range` zostaje w grancie, zeby `select=*`
-- z klienta nie konczylo sie odmowa na kolumnie technicznej.
REVOKE ALL ON public.event_sessions FROM anon, authenticated;
GRANT SELECT (
  id, tenant_id, event_id, parent_session_id, track_id, room_id,
  title_pl, title_en, description_pl, description_en,
  starts_at, ends_at, time_range, format, status, capacity, requires_signup,
  min_tier_rank, chatham_house, is_private, allow_overlap, sort_order,
  published_at, cancelled_at, created_by, created_at, updated_at
) ON public.event_sessions TO anon, authenticated;
GRANT ALL ON public.event_sessions TO service_role;

ALTER TABLE public.event_sessions ENABLE ROW LEVEL SECURITY;

-- Plaszczyzna TRESCI. Cztery warunki naraz, kazdy z innego powodu:
--   * tenant z naglowka - agenda jednego najemcy nie moze wyciec na domene
--     drugiego;
--   * status sesji `published` albo `cancelled` - sesja ODWOLANA musi zostac
--     widoczna, inaczej uczestnik z biletem nie dowie sie, ze jej nie ma;
--   * `NOT is_private` - sesja zamknieta jest poza plaszczyzna publiczna
--     (zapisany czyta ja przez `event_agenda`, ktore zna jego zapis);
--   * wydarzenie RODZIC opublikowane - sesja opublikowana w wydarzeniu
--     roboczym nie jest trescia publiczna.
DROP POLICY IF EXISTS "event_sessions_public_read" ON public.event_sessions;
CREATE POLICY "event_sessions_public_read"
  ON public.event_sessions FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND status IN ('published', 'cancelled')
    AND is_private = false
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_sessions.event_id
        AND e.tenant_id = event_sessions.tenant_id
        AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS "event_sessions_staff_read" ON public.event_sessions;
CREATE POLICY "event_sessions_staff_read"
  ON public.event_sessions FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );
-- Zapis: BRAK polityki klienckiej (admin_event_session_save / _delete /
-- _reorder / _set_status).

-- ----------------------------------------------------------------------------
-- 4) OBSADA SESJI (prelegenci)
--
-- Wskazujemy `speaker_profiles` - JEDYNY rejestr prelegentow w repozytorium
-- (nakladka na `profiles`, migracja 20260727200000, z RPC
-- `admin_upsert_speaker_profile` i publiczna projekcja `get_public_speakers`).
-- Drugi rejestr osob dalby dwie karty tej samej osoby, dwie oceny i dwa
-- zdjecia rozjezdzajace sie po pierwszej zmianie.
--
-- ROLA JEST WLASNOSCIA WIERSZA OBSADY, nie osoby: ta sama osoba jest
-- moderatorem jednej sesji i panelista drugiej. Cztery role pokrywaja
-- rzeczywisty repertuar agend NES (prelegent, moderator, panelista, gospodarz);
-- rozszerzanie ich do wlasnego katalogu per wydarzenie (doc par. 4.2,
-- `event_speaker_roles`) jest swiadomie odlozone - patrz raport.
--
-- `allow_overlap` jest FURTKA do swiadomego zlamania reguly "jedna osoba,
-- jedna sala": nagranie odtwarzane rownolegle, moderator zdalny, gospodarz
-- otwierajacy dwie sciezki. Rola `host` ma furtke z definicji.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_session_speakers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  session_id uuid NOT NULL,
  speaker_profile_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'speaker',
  sort_order integer NOT NULL DEFAULT 100,
  allow_overlap boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_session_speakers_role_values
    CHECK (role IN ('speaker', 'moderator', 'panelist', 'host')),
  CONSTRAINT event_session_speakers_tenant_id_key UNIQUE (tenant_id, id),
  -- Jedna osoba wystepuje w sesji RAZ. Dwa wiersze tej samej osoby w jednej
  -- sesji to dwie karty prelegenta pod jednym tytulem, nie dwie role.
  CONSTRAINT event_session_speakers_unique UNIQUE (tenant_id, session_id, speaker_profile_id),
  CONSTRAINT event_session_speakers_session_fk
    FOREIGN KEY (tenant_id, event_id, session_id)
    REFERENCES public.event_sessions (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_session_speakers_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_session_speakers_profile_fk FOREIGN KEY (tenant_id, speaker_profile_id)
    REFERENCES public.speaker_profiles (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_session_speakers IS
  'Obsada sesji: powiazanie sesji z profilem prelegenta (speaker_profiles) plus rola sceniczna i kolejnosc wystapienia. Zapis wsadowo przez admin_event_session_speakers_set.';
COMMENT ON COLUMN public.event_session_speakers.role IS
  'Rola w TEJ sesji: speaker / moderator / panelist / host. Ta sama osoba moze miec inna role w innej sesji.';
COMMENT ON COLUMN public.event_session_speakers.allow_overlap IS
  'true = swiadome dopuszczenie tej osoby w dwoch rownoleglych sesjach. Rola host ma to z definicji (patrz admin_event_session_speakers_set).';

CREATE INDEX IF NOT EXISTS event_session_speakers_session_idx
  ON public.event_session_speakers (tenant_id, session_id, sort_order);
-- "Pokaz mi moje wystapienia" i raport kolizji pytaja po OSOBIE.
CREATE INDEX IF NOT EXISTS event_session_speakers_profile_idx
  ON public.event_session_speakers (tenant_id, speaker_profile_id);
CREATE INDEX IF NOT EXISTS event_session_speakers_event_idx
  ON public.event_session_speakers (tenant_id, event_id);

DROP TRIGGER IF EXISTS event_session_speakers_touch_updated_at ON public.event_session_speakers;
CREATE TRIGGER event_session_speakers_touch_updated_at
  BEFORE UPDATE ON public.event_session_speakers
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_session_speakers TO anon;
GRANT SELECT ON public.event_session_speakers TO authenticated;
GRANT ALL ON public.event_session_speakers TO service_role;

ALTER TABLE public.event_session_speakers ENABLE ROW LEVEL SECURITY;

-- Plaszczyzna TRESCI: obsada jest widoczna tam, gdzie widoczna jest sesja.
-- Wiazanie idzie przez SESJE, ktora sama wiaze wydarzenie - dwa poziomy
-- w jednym EXISTS, bo polityka na wnuku nie moze wierzyc wlasnym kolumnom.
DROP POLICY IF EXISTS "event_session_speakers_public_read" ON public.event_session_speakers;
CREATE POLICY "event_session_speakers_public_read"
  ON public.event_session_speakers FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1
      FROM public.event_sessions s
      JOIN public.events e
        ON e.id = s.event_id AND e.tenant_id = s.tenant_id
      WHERE s.id = event_session_speakers.session_id
        AND s.tenant_id = event_session_speakers.tenant_id
        AND s.status IN ('published', 'cancelled')
        AND s.is_private = false
        AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS "event_session_speakers_staff_read" ON public.event_session_speakers;
CREATE POLICY "event_session_speakers_staff_read"
  ON public.event_session_speakers FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );
-- Zapis: BRAK polityki klienckiej (admin_event_session_speakers_set).

-- ----------------------------------------------------------------------------
-- 5) ZAPIS NA SESJE
--
-- PODMIOTEM ZAPISU JEST `auth.users`, NIE rekord uczestnika wydarzenia.
-- Rejestr uczestnikow (`event_people`, prelegent i gosc bez konta) powstaje
-- w migracji POZNIEJSZEJ (20260823150000), wiec klucz obcy do niego byl by
-- odwolaniem do tabeli, ktorej jeszcze nie ma. Wybor jest swiadomy: zapis
-- zalogowanego czlonka to ta czesc procesu, ktora DZISIAJ da sie policzyc
-- i wyegzekwowac - limit miejsc, lista rezerwowa, kolizja czasowa uczestnika,
-- prog warstwy. Rozszerzenie na osobe bez konta jest jednym krokiem do przodu
-- i jest opisane w naglowku pliku (KONTRAKT MIEDZYMODULOWY).
--
-- STATUS `cancelled` ZOSTAJE W TABELI, wiersz nie jest usuwany. Rezygnacja
-- jest faktem: organizator musi wiedziec, ze na sesje zapisalo sie 40 osob,
-- z ktorych 12 sie wypisalo, a nie tylko, ze zostalo 28. Unikalnosc
-- (tenant, sesja, uzytkownik) sprawia, ze powrot to UPDATE, nie duplikat.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_session_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  session_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'registered',
  registered_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  -- Kto zapisal: uczestnik sam, czy organizator za niego. Bez tej kolumny
  -- lista zapisow nie odpowiada na pytanie "kto to dodal", ktore pojawia sie
  -- przy pierwszej reklamacji.
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_session_signups_status_values
    CHECK (status IN ('registered', 'waitlist', 'cancelled')),
  CONSTRAINT event_session_signups_cancelled_stamp
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT event_session_signups_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_session_signups_unique UNIQUE (tenant_id, session_id, user_id),
  CONSTRAINT event_session_signups_session_fk
    FOREIGN KEY (tenant_id, event_id, session_id)
    REFERENCES public.event_sessions (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_session_signups_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_session_signups IS
  'Zapis uzytkownika na konkretna sesje. Podmiotem jest auth.users; rozszerzenie na uczestnika bez konta nalezy do modulu uczestnikow (patrz naglowek migracji). Zapis wylacznie przez event_session_signup.';
COMMENT ON COLUMN public.event_session_signups.status IS
  'registered (ma miejsce) / waitlist (lista rezerwowa, awansuje przy zwolnieniu miejsca) / cancelled (rezygnacja - wiersz zostaje jako fakt).';
COMMENT ON COLUMN public.event_session_signups.created_by IS
  'Kto utworzyl wiersz: uczestnik sam (rowne user_id) albo organizator zapisujacy za niego.';

CREATE INDEX IF NOT EXISTS event_session_signups_session_idx
  ON public.event_session_signups (tenant_id, session_id, status);
-- Kolejka rezerwowa jest FIFO - awans bierze najstarszy wiersz.
CREATE INDEX IF NOT EXISTS event_session_signups_waitlist_idx
  ON public.event_session_signups (tenant_id, session_id, registered_at)
  WHERE status = 'waitlist';
CREATE INDEX IF NOT EXISTS event_session_signups_user_idx
  ON public.event_session_signups (user_id, registered_at DESC);
CREATE INDEX IF NOT EXISTS event_session_signups_event_user_idx
  ON public.event_session_signups (tenant_id, event_id, user_id);

DROP TRIGGER IF EXISTS event_session_signups_touch_updated_at ON public.event_session_signups;
CREATE TRIGGER event_session_signups_touch_updated_at
  BEFORE UPDATE ON public.event_session_signups
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- Anon nie ma tu nic do czytania: zapis istnieje tylko dla zalogowanego.
GRANT SELECT ON public.event_session_signups TO authenticated;
GRANT ALL ON public.event_session_signups TO service_role;

ALTER TABLE public.event_session_signups ENABLE ROW LEVEL SECURITY;

-- WLASCICIEL WIERSZA bez warunku tenanta - dokladnie jak "rsvps owner read"
-- z 20260713093000. Zapis powstaje na PLASZCZYZNIE TRESCI (najemca z naglowka
-- hosta), a czlonek moze miec tenant domowy inny niz przegladana domena;
-- dopisanie `current_tenant_id()` ukrywaloby przed nim jego WLASNY zapis.
-- Wiersz nie niesie danych innych osob, wiec nie ma czego przeciekac.
DROP POLICY IF EXISTS "event_session_signups_owner_read" ON public.event_session_signups;
CREATE POLICY "event_session_signups_owner_read"
  ON public.event_session_signups FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "event_session_signups_staff_read" ON public.event_session_signups;
CREATE POLICY "event_session_signups_staff_read"
  ON public.event_session_signups FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );
-- Zapis: BRAK polityki klienckiej (event_session_signup pod blokada wiersza).

-- ----------------------------------------------------------------------------
-- 6) WALIDACJA SESJI W BAZIE, NIE W FORMULARZU
--
-- Trzy warunki, ktorych nie da sie zapisac jako CHECK, bo dotykaja INNYCH
-- WIERSZY. Trigger jest tu jedynym miejscem, ktore obowiazuje kazda sciezke
-- zapisu naraz: formularz, import, klon poprzedniej edycji, `COPY`.
--
--   1) SESJA W GRANICACH CZASOWYCH WYDARZENIA. Sesja przed poczatkiem
--      wydarzenia albo po jego koncu to blad daty (najczesciej zly rok albo
--      zla strefa), a nie decyzja redakcyjna - i w agendzie objawia sie jako
--      pusty dzien z jedna sesja w zeszlym miesiacu. Gorna granica jest
--      sprawdzana TYLKO gdy wydarzenie zna swoj koniec (`events.ends_at` jest
--      nullowalne od migracji zalozycielskiej). WYJATEK JAWNY: nie ma go -
--      wlasciwa naprawa "sesji poza oknem" jest rozszerzenie okna wydarzenia,
--      bo to ono opisuje, kiedy wydarzenie sie dzieje. Zwezenie okna PO
--      wpisaniu agendy nie cofa juz istniejacych sesji (trigger nie strzela
--      przy UPDATE na `events`) - takie rozjechanie raportuje
--      `admin_event_agenda_conflicts`, zeby nie blokowac zmiany godzin
--      wydarzenia bledem na wierszu potomnym.
--
--   2) LIMIT MIEJSC SESJI NIE WIEKSZY NIZ POJEMNOSC SALI. Limit 200 w sali na
--      80 osob jest obietnica, ktorej nie da sie dowiezc.
--
--   3) GNIEZDZENIE JEDNOPOZIOMOWE. Podsesja nie moze byc rodzicem: agenda ma
--      byc lista blokow z podsesjami, nie drzewem o nieznanej glebokosci.
--      Klucz obcy potrojny pilnuje juz, ze rodzic jest z tego samego
--      wydarzenia i najemcy, a CHECK - ze nie jest soba.
--
-- SECURITY DEFINER, bo trigger czyta `events` i `event_rooms`, a wywolujacy
-- (nawet przez RPC definera) nie musi miec do nich polityki SELECT.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_event_sessions_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_starts timestamptz;
  v_event_ends timestamptz;
  v_room_capacity integer;
  v_parent_parent uuid;
BEGIN
  SELECT e.starts_at, e.ends_at
    INTO v_event_starts, v_event_ends
  FROM public.events e
  WHERE e.id = NEW.event_id AND e.tenant_id = NEW.tenant_id;

  IF v_event_starts IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  IF NEW.starts_at < v_event_starts THEN
    RAISE EXCEPTION 'session_before_event: session starts before the event (%)', v_event_starts;
  END IF;

  IF v_event_ends IS NOT NULL AND NEW.ends_at > v_event_ends THEN
    RAISE EXCEPTION 'session_after_event: session ends after the event (%)', v_event_ends;
  END IF;

  IF NEW.room_id IS NOT NULL AND NEW.capacity IS NOT NULL THEN
    SELECT r.capacity INTO v_room_capacity
    FROM public.event_rooms r
    WHERE r.id = NEW.room_id AND r.tenant_id = NEW.tenant_id;

    IF v_room_capacity IS NOT NULL AND NEW.capacity > v_room_capacity THEN
      RAISE EXCEPTION 'capacity_over_room: seat limit % exceeds room capacity %',
        NEW.capacity, v_room_capacity;
    END IF;
  END IF;

  IF NEW.parent_session_id IS NOT NULL THEN
    SELECT s.parent_session_id INTO v_parent_parent
    FROM public.event_sessions s
    WHERE s.id = NEW.parent_session_id AND s.tenant_id = NEW.tenant_id;

    IF v_parent_parent IS NOT NULL THEN
      RAISE EXCEPTION 'parent_depth: a sub-session cannot be a parent session';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_event_sessions_validate() IS
  'Walidacja sesji dotykajaca innych wierszy: okno czasowe wydarzenia, limit miejsc wobec pojemnosci sali, jednopoziomowe gniezdzenie.';

DROP TRIGGER IF EXISTS event_sessions_validate ON public.event_sessions;
CREATE TRIGGER event_sessions_validate
  BEFORE INSERT OR UPDATE OF event_id, starts_at, ends_at, capacity, room_id, parent_session_id
  ON public.event_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_event_sessions_validate();

-- ----------------------------------------------------------------------------
-- 7) PANEL: SCIEZKI
--
-- Lista niesie licznik sesji, bo to on decyduje o dwoch rzeczach w interfejsie:
-- czy przycisk usuniecia ma sens i czy wylaczenie sciezki jest bezpieczne.
-- Licznik bez tej roli byl by ozdoba - z ta rola jest warunkiem operacji.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_tracks_list(uuid);
CREATE FUNCTION public.admin_event_tracks_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  key text,
  name_pl text,
  name_en text,
  accent_color text,
  sort_order integer,
  is_active boolean,
  sessions_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    t.id, t.event_id, t.key, t.name_pl, t.name_en, t.accent_color,
    t.sort_order, t.is_active,
    COALESCE(u.cnt, 0)::integer,
    t.created_at, t.updated_at
  FROM public.event_tracks t
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_sessions s
    WHERE s.tenant_id = v_tenant AND s.track_id = t.id
  ) u ON true
  WHERE t.tenant_id = v_tenant
    AND t.event_id = p_event_id
  ORDER BY t.sort_order, t.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_tracks_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_tracks_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_tracks_list(uuid) IS
  'Sciezki tematyczne wydarzenia dla panelu, z licznikiem sesji. Bramka: assert_editor_tenant().';

-- Klucz sciezki jest NIEZMIENNY po zapisie - tak jak `event_types.key`
-- (20260823120000). Adres filtra agendy (`/agenda?track=cyber`) trafia do
-- zakladek i do materialow drukowanych; zmiana klucza zabija oba.
DROP FUNCTION IF EXISTS public.admin_event_track_save(jsonb);
CREATE FUNCTION public.admin_event_track_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
  v_name_pl text := btrim(COALESCE(p_payload->>'name_pl', ''));
  v_name_en text := btrim(COALESCE(p_payload->>'name_en', ''));
BEGIN
  IF v_name_pl = '' OR v_name_en = '' THEN
    RAISE EXCEPTION 'invalid_names: both names are required';
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.event_tracks SET
      name_pl = v_name_pl,
      name_en = v_name_en,
      accent_color = CASE
        WHEN p_payload ? 'accent_color'
          THEN NULLIF(btrim(COALESCE(p_payload->>'accent_color', '')), '')
        ELSE accent_color
      END,
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, sort_order),
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, is_active)
    WHERE id = v_id AND tenant_id = v_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: track does not exist in this tenant';
    END IF;

    RETURN v_id;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_event: event_id is required';
  END IF;

  IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
    RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
  END IF;

  -- Wydarzenie MUSI nalezec do tenanta wolajacego. Klucz obcy zlozony
  -- odrzucilby obce id sam, ale wtedy panel dostaje `23503` bez wskazania
  -- pola - a redaktor nie ma jak zgadnac, ze chodzi o wydarzenie.
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  INSERT INTO public.event_tracks (
    tenant_id, event_id, key, name_pl, name_en, accent_color, sort_order, is_active
  ) VALUES (
    v_tenant, v_event_id, v_key, v_name_pl, v_name_en,
    NULLIF(btrim(COALESCE(p_payload->>'accent_color', '')), ''),
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_track_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_track_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_track_save(jsonb) IS
  'Dodanie albo edycja sciezki tematycznej wydarzenia. Klucz jest niezmienny po zapisie. Bramka: assert_editor_tenant().';

-- Usuniecie sciezki uzywanej przez sesje jest odrzucane W RPC, zeby panel
-- dostal liczbe zamiast kodu `23503` z klucza obcego. Alternatywa (odpiecie
-- sesji przy usunieciu) po cichu zmienialaby agende - a decyzja "te 12 sesji
-- nie ma juz sciezki" nalezy do redaktora, nie do przycisku usuwania.
DROP FUNCTION IF EXISTS public.admin_event_track_delete(uuid);
CREATE FUNCTION public.admin_event_track_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_used integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_tracks t WHERE t.id = _id AND t.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: track does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.event_sessions s
  WHERE s.tenant_id = v_tenant AND s.track_id = _id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'track_in_use: % session(s) still use this track', v_used;
  END IF;

  DELETE FROM public.event_tracks WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_track_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_track_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_track_delete(uuid) IS
  'Usuwa sciezke, ktorej nie uzywa zadna sesja. Sciezka w uzyciu jest odrzucana bledem track_in_use z liczba sesji.';

-- ----------------------------------------------------------------------------
-- 8) PANEL: SALE
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_rooms_list(uuid);
CREATE FUNCTION public.admin_event_rooms_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  name text,
  capacity integer,
  floor text,
  location_note text,
  sort_order integer,
  is_active boolean,
  sessions_count integer,
  -- Suma godzin zajetosci sali. To jedyna liczba, ktora odpowiada na pytanie
  -- "czy warto wynajmowac ta sale na caly dzien" - i da sie ja policzyc
  -- z przedzialow, wiec nie jest atrapa.
  booked_minutes integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    r.id, r.event_id, r.name, r.capacity, r.floor, r.location_note,
    r.sort_order, r.is_active,
    COALESCE(u.cnt, 0)::integer,
    COALESCE(u.minutes, 0)::integer,
    r.created_at, r.updated_at
  FROM public.event_rooms r
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS cnt,
      COALESCE(
        sum(EXTRACT(EPOCH FROM (s.ends_at - s.starts_at)) / 60)::integer, 0
      ) AS minutes
    FROM public.event_sessions s
    WHERE s.tenant_id = v_tenant
      AND s.room_id = r.id
      AND s.status <> 'cancelled'
  ) u ON true
  WHERE r.tenant_id = v_tenant
    AND r.event_id = p_event_id
  ORDER BY r.sort_order, r.name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_rooms_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_rooms_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_rooms_list(uuid) IS
  'Sale wydarzenia dla panelu, z licznikiem sesji i suma minut zajetosci. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_room_save(jsonb);
CREATE FUNCTION public.admin_event_room_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_name text := btrim(COALESCE(p_payload->>'name', ''));
  v_capacity integer := (NULLIF(p_payload->>'capacity', ''))::integer;
  v_over integer;
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'invalid_name: room name is required';
  END IF;

  IF v_capacity IS NOT NULL AND v_capacity <= 0 THEN
    RAISE EXCEPTION 'invalid_capacity: room capacity must be greater than zero';
  END IF;

  IF v_id IS NOT NULL THEN
    -- Obnizenie pojemnosci ponizej limitu miejsc sesji juz przypisanej do sali
    -- jest odrzucane TUTAJ, bo trigger na sesji strzela tylko przy zapisie
    -- sesji. Bez tego warunku sala na 40 osob miala by sesje z limitem 200,
    -- a raport kolizji zglaszal by blad, ktorego nikt nie wprowadzil.
    IF p_payload ? 'capacity' AND v_capacity IS NOT NULL THEN
      SELECT count(*)::integer INTO v_over
      FROM public.event_sessions s
      WHERE s.tenant_id = v_tenant
        AND s.room_id = v_id
        AND s.capacity IS NOT NULL
        AND s.capacity > v_capacity;

      IF v_over > 0 THEN
        RAISE EXCEPTION 'capacity_below_sessions: % session(s) have a higher seat limit', v_over;
      END IF;
    END IF;

    UPDATE public.event_rooms SET
      name = v_name,
      capacity = CASE WHEN p_payload ? 'capacity' THEN v_capacity ELSE capacity END,
      floor = CASE
        WHEN p_payload ? 'floor' THEN NULLIF(btrim(COALESCE(p_payload->>'floor', '')), '')
        ELSE floor
      END,
      location_note = CASE
        WHEN p_payload ? 'location_note'
          THEN NULLIF(btrim(COALESCE(p_payload->>'location_note', '')), '')
        ELSE location_note
      END,
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, sort_order),
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, is_active)
    WHERE id = v_id AND tenant_id = v_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: room does not exist in this tenant';
    END IF;

    RETURN v_id;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_event: event_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  INSERT INTO public.event_rooms (
    tenant_id, event_id, name, capacity, floor, location_note, sort_order, is_active
  ) VALUES (
    v_tenant, v_event_id, v_name, v_capacity,
    NULLIF(btrim(COALESCE(p_payload->>'floor', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'location_note', '')), ''),
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_room_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_room_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_room_save(jsonb) IS
  'Dodanie albo edycja sali wydarzenia. Odrzuca obnizenie pojemnosci ponizej limitu miejsc przypisanych sesji. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_room_delete(uuid);
CREATE FUNCTION public.admin_event_room_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_used integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_rooms r WHERE r.id = _id AND r.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: room does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.event_sessions s
  WHERE s.tenant_id = v_tenant AND s.room_id = _id;

  -- Klucz obcy do sali jest NO ACTION, wiec baza odrzucilaby to sama - ale
  -- kodem `23503`. Panel potrzebuje liczby sesji, zeby napisac, co odpiac.
  IF v_used > 0 THEN
    RAISE EXCEPTION 'room_in_use: % session(s) still use this room', v_used;
  END IF;

  DELETE FROM public.event_rooms WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_room_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_room_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_room_delete(uuid) IS
  'Usuwa sale, ktorej nie uzywa zadna sesja. Sala w uzyciu jest odrzucana bledem room_in_use z liczba sesji.';

-- ----------------------------------------------------------------------------
-- 9) PANEL: LISTA SESJI JEDNEGO WYDARZENIA
--
-- BEZ PAGINACJI, swiadomie. Agenda jest domknieta wydarzeniem: kongres
-- dwudniowy ma 30-60 sesji, a nie 4000. Paginacja rozbilaby jedyny widok,
-- ktory ma sens dla tych danych - siatke godzina x sala - i wprowadzilaby
-- `total_count` na kazdym wierszu bez powodu.
--
-- Liczniki zapisow licza sie LATERAL-em per wiersz, nie jednym GROUP BY po
-- calej tabeli: filtr po sciezce zwraca 8 sesji z 60, a agregat globalny
-- czytal by zapisy wszystkich.
--
-- Adresy transmisji i nagrania oddajemy TYLKO jako flagi. Lista jest lista;
-- wartosc pobiera formularz przez admin_event_session_detail.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_sessions_list(uuid, uuid, uuid, text, text);
CREATE FUNCTION public.admin_event_sessions_list(
  p_event_id uuid,
  p_track_id uuid DEFAULT NULL,
  p_room_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_q text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  parent_session_id uuid,
  title_pl text,
  title_en text,
  description_pl text,
  description_en text,
  starts_at timestamptz,
  ends_at timestamptz,
  duration_minutes integer,
  format text,
  status text,
  capacity integer,
  requires_signup boolean,
  min_tier_rank integer,
  chatham_house boolean,
  is_private boolean,
  allow_overlap boolean,
  sort_order integer,
  published_at timestamptz,
  cancelled_at timestamptz,
  track_id uuid,
  track_key text,
  track_name_pl text,
  track_name_en text,
  track_accent_color text,
  room_id uuid,
  room_name text,
  room_capacity integer,
  speakers_count integer,
  registered_count integer,
  waitlist_count integer,
  cancelled_count integer,
  seats_left integer,
  has_stream boolean,
  has_recording boolean,
  children_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.event_id, s.parent_session_id,
    s.title_pl, s.title_en, s.description_pl, s.description_en,
    s.starts_at, s.ends_at,
    (EXTRACT(EPOCH FROM (s.ends_at - s.starts_at)) / 60)::integer,
    s.format, s.status, s.capacity, s.requires_signup, s.min_tier_rank,
    s.chatham_house, s.is_private, s.allow_overlap, s.sort_order,
    s.published_at, s.cancelled_at,
    s.track_id, t.key, t.name_pl, t.name_en, t.accent_color,
    s.room_id, r.name, r.capacity,
    COALESCE(sp.cnt, 0)::integer,
    COALESCE(g.registered, 0)::integer,
    COALESCE(g.waitlist, 0)::integer,
    COALESCE(g.cancelled, 0)::integer,
    -- Brak limitu to NULL, nie zero: "bez limitu" i "brak wolnych miejsc" to
    -- dwie rozne odpowiedzi, a zero na liscie czyta sie jako druga z nich
    -- (dokladnie ta decyzja co w admin_events_list).
    CASE
      WHEN s.capacity IS NULL THEN NULL
      ELSE GREATEST(s.capacity - COALESCE(g.registered, 0), 0)
    END::integer,
    (s.stream_url IS NOT NULL),
    (s.recording_url IS NOT NULL),
    COALESCE(ch.cnt, 0)::integer
  FROM public.event_sessions s
  LEFT JOIN public.event_tracks t
    ON t.id = s.track_id AND t.tenant_id = v_tenant
  LEFT JOIN public.event_rooms r
    ON r.id = s.room_id AND r.tenant_id = v_tenant
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_session_speakers es
    WHERE es.tenant_id = v_tenant AND es.session_id = s.id
  ) sp ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE g0.status = 'registered')::integer AS registered,
      count(*) FILTER (WHERE g0.status = 'waitlist')::integer AS waitlist,
      count(*) FILTER (WHERE g0.status = 'cancelled')::integer AS cancelled
    FROM public.event_session_signups g0
    WHERE g0.tenant_id = v_tenant AND g0.session_id = s.id
  ) g ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_sessions c
    WHERE c.tenant_id = v_tenant AND c.parent_session_id = s.id
  ) ch ON true
  WHERE s.tenant_id = v_tenant
    AND s.event_id = p_event_id
    AND (p_track_id IS NULL OR s.track_id = p_track_id)
    AND (p_room_id IS NULL OR s.room_id = p_room_id)
    AND (p_status IS NULL OR p_status = 'all' OR s.status = p_status)
    AND (
      v_q IS NULL
      OR s.title_pl ILIKE '%' || v_q || '%'
      OR s.title_en ILIKE '%' || v_q || '%'
      OR r.name ILIKE '%' || v_q || '%'
    )
  ORDER BY s.starts_at, s.sort_order, s.title_pl;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sessions_list(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sessions_list(uuid, uuid, uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sessions_list(uuid, uuid, uuid, text, text) IS
  'Agenda wydarzenia dla panelu: sesje z nazwa sciezki i sali, liczba prelegentow, licznikami zapisow i wolnymi miejscami. Bez adresow transmisji - tylko flagi. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 10) PANEL: JEDNA SESJA DO FORMULARZA
--
-- Osobna funkcja od listy z dwoch powodow. Pierwszy: TU oddajemy `stream_url`
-- i `recording_url`, bo formularz musi pokazac wartosc, ktora edytuje - a lista
-- nie ma prawa ich wozic (im mniej miejsc z sekretem, tym mniej miejsc do
-- przecieku). Drugi: obsada jedzie jako `jsonb`, wiec formularz otwiera sie
-- jednym wywolaniem, a nie dwoma z wyscigiem miedzy nimi.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_session_detail(uuid);
CREATE FUNCTION public.admin_event_session_detail(_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  event_title_pl text,
  event_title_en text,
  event_timezone text,
  event_starts_at timestamptz,
  event_ends_at timestamptz,
  parent_session_id uuid,
  title_pl text,
  title_en text,
  description_pl text,
  description_en text,
  starts_at timestamptz,
  ends_at timestamptz,
  format text,
  status text,
  capacity integer,
  requires_signup boolean,
  min_tier_rank integer,
  chatham_house boolean,
  is_private boolean,
  allow_overlap boolean,
  stream_url text,
  recording_url text,
  sort_order integer,
  published_at timestamptz,
  cancelled_at timestamptz,
  track_id uuid,
  room_id uuid,
  registered_count integer,
  waitlist_count integer,
  seats_left integer,
  speakers jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.event_id, e.title_pl, e.title_en, e.timezone, e.starts_at, e.ends_at,
    s.parent_session_id, s.title_pl, s.title_en, s.description_pl, s.description_en,
    s.starts_at, s.ends_at, s.format, s.status, s.capacity, s.requires_signup,
    s.min_tier_rank, s.chatham_house, s.is_private, s.allow_overlap,
    s.stream_url, s.recording_url, s.sort_order, s.published_at, s.cancelled_at,
    s.track_id, s.room_id,
    COALESCE(g.registered, 0)::integer,
    COALESCE(g.waitlist, 0)::integer,
    CASE
      WHEN s.capacity IS NULL THEN NULL
      ELSE GREATEST(s.capacity - COALESCE(g.registered, 0), 0)
    END::integer,
    COALESCE(sp.items, '[]'::jsonb)
  FROM public.event_sessions s
  JOIN public.events e
    ON e.id = s.event_id AND e.tenant_id = s.tenant_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE g0.status = 'registered')::integer AS registered,
      count(*) FILTER (WHERE g0.status = 'waitlist')::integer AS waitlist
    FROM public.event_session_signups g0
    WHERE g0.tenant_id = v_tenant AND g0.session_id = s.id
  ) g ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', es.id,
        'speaker_profile_id', es.speaker_profile_id,
        'user_id', pr.id,
        'display_name', pr.display_name,
        'avatar_url', pr.avatar_url,
        'headline_pl', spf.headline_pl,
        'headline_en', spf.headline_en,
        'role', es.role,
        'sort_order', es.sort_order,
        'allow_overlap', es.allow_overlap
      ) ORDER BY es.sort_order, pr.display_name
    ) AS items
    FROM public.event_session_speakers es
    JOIN public.speaker_profiles spf
      ON spf.id = es.speaker_profile_id AND spf.tenant_id = es.tenant_id
    JOIN public.profiles pr
      ON pr.id = spf.user_id AND pr.tenant_id = es.tenant_id
    WHERE es.tenant_id = v_tenant AND es.session_id = s.id
  ) sp ON true
  WHERE s.tenant_id = v_tenant AND s.id = _id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_session_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_session_detail(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_session_detail(uuid) IS
  'Jedna sesja z obsada (jsonb) i adresami transmisji/nagrania do formularza panelu. Okno czasowe wydarzenia jedzie razem, zeby formularz mogl ostrzec przed walidacja. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 11) PANEL: ZAPIS SESJI (dodanie i edycja jednym kontraktem)
--
-- JEDEN ARGUMENT `p_payload jsonb`, a nie dwadziescia pozycyjnych. Sesja ma
-- dzisiaj dziewietnascie pol redakcyjnych i bedzie ich miala wiecej (obraz
-- naglowkowy, skrzynka interakcji, ocena po sesji z projektu). Kazde nowe pole
-- w sygnaturze pozycyjnej to NOWA funkcja w bazie (Postgres przeciaza po
-- sygnaturze), stary klient wolajacy poprzednia i dwa granty do utrzymania.
--
-- POLE NIEOBECNE W PAYLOADZIE ZOSTAJE BEZ ZMIANY, pole obecne z wartoscia
-- pusta jest CZYSZCZONE. Ta roznica jest istotna dla formularzy czesciowych
-- (szybka zmiana godziny z siatki agendy nie moze wyczyscic opisu).
--
-- KOLIZJA SALI JEST SPRAWDZANA DWA RAZY: raz tutaj, zeby panel dostal nazwe
-- sesji, ktora blokuje slot, i raz przez ograniczenie EXCLUDE, ktore jest
-- odporne na wyscig dwoch rownoleglych zapisow. Pierwsze sprawdzenie jest dla
-- czlowieka, drugie dla poprawnosci.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_session_save(jsonb);
CREATE FUNCTION public.admin_event_session_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_row public.event_sessions;
  v_event_id uuid;
  v_title_pl text;
  v_title_en text;
  v_desc_pl text;
  v_desc_en text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_format text;
  v_status text;
  v_capacity integer;
  v_requires_signup boolean;
  v_min_tier integer;
  v_chatham boolean;
  v_is_private boolean;
  v_allow_overlap boolean;
  v_stream text;
  v_recording text;
  v_sort integer;
  v_track uuid;
  v_room uuid;
  v_parent uuid;
  v_published_at timestamptz;
  v_cancelled_at timestamptz;
  v_conflict text;
  v_prev_status text;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_row
    FROM public.event_sessions s
    WHERE s.id = v_id AND s.tenant_id = v_tenant;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'not_found: session does not exist in this tenant';
    END IF;
  END IF;

  v_event_id := COALESCE(NULLIF(p_payload->>'event_id', '')::uuid, v_row.event_id);
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_event: event_id is required';
  END IF;

  -- Przepiecie sesji do innego wydarzenia rozjechalo by ja z sala i sciezka
  -- (klucze obce potrojne) oraz z zapisami uczestnikow. To nie jest edycja,
  -- to przenosiny - i nalezy je zrobic swiadomie, kasujac i tworzac sesje.
  IF v_row.id IS NOT NULL AND v_event_id <> v_row.event_id THEN
    RAISE EXCEPTION 'event_immutable: a session cannot be moved to another event';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  v_title_pl := COALESCE(NULLIF(btrim(COALESCE(p_payload->>'title_pl', '')), ''), v_row.title_pl);
  v_title_en := COALESCE(NULLIF(btrim(COALESCE(p_payload->>'title_en', '')), ''), v_row.title_en);
  IF v_title_pl IS NULL OR v_title_en IS NULL THEN
    RAISE EXCEPTION 'invalid_titles: both titles are required';
  END IF;

  v_desc_pl := CASE
    WHEN p_payload ? 'description_pl' THEN COALESCE(btrim(p_payload->>'description_pl'), '')
    ELSE COALESCE(v_row.description_pl, '')
  END;
  v_desc_en := CASE
    WHEN p_payload ? 'description_en' THEN COALESCE(btrim(p_payload->>'description_en'), '')
    ELSE COALESCE(v_row.description_en, '')
  END;

  v_starts := COALESCE(NULLIF(p_payload->>'starts_at', '')::timestamptz, v_row.starts_at);
  v_ends := COALESCE(NULLIF(p_payload->>'ends_at', '')::timestamptz, v_row.ends_at);
  IF v_starts IS NULL OR v_ends IS NULL THEN
    RAISE EXCEPTION 'invalid_times: both start and end are required';
  END IF;
  IF v_ends <= v_starts THEN
    RAISE EXCEPTION 'invalid_times: end must be after start';
  END IF;

  v_format := COALESCE(NULLIF(p_payload->>'format', ''), v_row.format, 'onsite');
  IF v_format NOT IN ('onsite', 'online', 'hybrid') THEN
    RAISE EXCEPTION 'invalid_format: format must be onsite, online or hybrid';
  END IF;

  v_status := COALESCE(NULLIF(p_payload->>'status', ''), v_row.status, 'draft');
  IF v_status NOT IN ('draft', 'published', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status: status must be draft, published or cancelled';
  END IF;

  v_requires_signup := COALESCE(
    (NULLIF(p_payload->>'requires_signup', ''))::boolean, v_row.requires_signup, false
  );

  IF p_payload ? 'capacity' THEN
    v_capacity := (NULLIF(p_payload->>'capacity', ''))::integer;
  ELSE
    v_capacity := v_row.capacity;
  END IF;
  IF v_capacity IS NOT NULL AND v_capacity < 0 THEN
    RAISE EXCEPTION 'invalid_capacity: seat limit cannot be negative';
  END IF;
  IF v_capacity IS NOT NULL AND NOT v_requires_signup THEN
    RAISE EXCEPTION 'capacity_requires_signup: a seat limit needs signups enabled';
  END IF;

  v_min_tier := COALESCE(
    (NULLIF(p_payload->>'min_tier_rank', ''))::integer, v_row.min_tier_rank, 0
  );
  IF v_min_tier < 0 THEN
    RAISE EXCEPTION 'invalid_tier_rank: membership rank cannot be negative';
  END IF;

  v_chatham := COALESCE(
    (NULLIF(p_payload->>'chatham_house', ''))::boolean, v_row.chatham_house, false
  );
  v_is_private := COALESCE(
    (NULLIF(p_payload->>'is_private', ''))::boolean, v_row.is_private, false
  );
  v_allow_overlap := COALESCE(
    (NULLIF(p_payload->>'allow_overlap', ''))::boolean, v_row.allow_overlap, true
  );

  IF p_payload ? 'stream_url' THEN
    v_stream := NULLIF(btrim(COALESCE(p_payload->>'stream_url', '')), '');
  ELSE
    v_stream := v_row.stream_url;
  END IF;
  IF v_stream IS NOT NULL AND v_stream !~ '^https://' THEN
    RAISE EXCEPTION 'invalid_stream_url: the stream address must start with https://';
  END IF;

  IF p_payload ? 'recording_url' THEN
    v_recording := NULLIF(btrim(COALESCE(p_payload->>'recording_url', '')), '');
  ELSE
    v_recording := v_row.recording_url;
  END IF;
  IF v_recording IS NOT NULL AND v_recording !~ '^https://' THEN
    RAISE EXCEPTION 'invalid_recording_url: the recording address must start with https://';
  END IF;

  IF p_payload ? 'track_id' THEN
    v_track := NULLIF(p_payload->>'track_id', '')::uuid;
  ELSE
    v_track := v_row.track_id;
  END IF;
  IF v_track IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_tracks t
    WHERE t.id = v_track AND t.tenant_id = v_tenant AND t.event_id = v_event_id
  ) THEN
    RAISE EXCEPTION 'track_not_found: the track does not belong to this event';
  END IF;

  IF p_payload ? 'room_id' THEN
    v_room := NULLIF(p_payload->>'room_id', '')::uuid;
  ELSE
    v_room := v_row.room_id;
  END IF;
  IF v_room IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_rooms r
    WHERE r.id = v_room AND r.tenant_id = v_tenant AND r.event_id = v_event_id
  ) THEN
    RAISE EXCEPTION 'room_not_found: the room does not belong to this event';
  END IF;

  IF p_payload ? 'parent_session_id' THEN
    v_parent := NULLIF(p_payload->>'parent_session_id', '')::uuid;
  ELSE
    v_parent := v_row.parent_session_id;
  END IF;
  IF v_parent IS NOT NULL THEN
    IF v_parent = v_id THEN
      RAISE EXCEPTION 'parent_self: a session cannot be its own parent';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.event_sessions p
      WHERE p.id = v_parent AND p.tenant_id = v_tenant AND p.event_id = v_event_id
    ) THEN
      RAISE EXCEPTION 'parent_not_found: the parent session does not belong to this event';
    END IF;
  END IF;

  v_sort := COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, v_row.sort_order);
  IF v_sort IS NULL THEN
    -- Nowa sesja lezy na koncu agendy, a nie w losowym miejscu srodka.
    SELECT COALESCE(max(s.sort_order), 0) + 10 INTO v_sort
    FROM public.event_sessions s
    WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id;
  END IF;

  -- Kolizja sali: komunikat dla czlowieka. Ograniczenie EXCLUDE zostaje jako
  -- linia obrony przed wyscigiem (jego kod 23P01 tlumaczymy nizej).
  IF v_room IS NOT NULL AND v_status <> 'cancelled' THEN
    SELECT s.title_pl INTO v_conflict
    FROM public.event_sessions s
    WHERE s.tenant_id = v_tenant
      AND s.room_id = v_room
      AND s.status <> 'cancelled'
      AND s.time_range && tstzrange(v_starts, v_ends, '[)')
      AND (v_id IS NULL OR s.id <> v_id)
    ORDER BY s.starts_at
    LIMIT 1;

    IF v_conflict IS NOT NULL THEN
      RAISE EXCEPTION 'room_conflict: room already taken in this slot by "%"', v_conflict;
    END IF;
  END IF;

  v_prev_status := v_row.status;
  -- Pierwsza publikacja stempluje date; powrot do szkicu jej NIE czysci,
  -- bo opisuje fakt historyczny (wzorzec events.published_at z etapu 1).
  v_published_at := CASE
    WHEN v_status = 'published' THEN COALESCE(v_row.published_at, now())
    ELSE v_row.published_at
  END;
  v_cancelled_at := CASE WHEN v_status = 'cancelled' THEN COALESCE(v_row.cancelled_at, now()) END;

  IF v_id IS NULL THEN
    INSERT INTO public.event_sessions (
      tenant_id, event_id, parent_session_id, track_id, room_id,
      title_pl, title_en, description_pl, description_en,
      starts_at, ends_at, format, status, capacity, requires_signup,
      min_tier_rank, chatham_house, is_private, allow_overlap,
      stream_url, recording_url, sort_order, published_at, cancelled_at, created_by
    ) VALUES (
      v_tenant, v_event_id, v_parent, v_track, v_room,
      v_title_pl, v_title_en, v_desc_pl, v_desc_en,
      v_starts, v_ends, v_format, v_status, v_capacity, v_requires_signup,
      v_min_tier, v_chatham, v_is_private, v_allow_overlap,
      v_stream, v_recording, v_sort, v_published_at, v_cancelled_at, auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_sessions SET
      parent_session_id = v_parent,
      track_id = v_track,
      room_id = v_room,
      title_pl = v_title_pl,
      title_en = v_title_en,
      description_pl = v_desc_pl,
      description_en = v_desc_en,
      starts_at = v_starts,
      ends_at = v_ends,
      format = v_format,
      status = v_status,
      capacity = v_capacity,
      requires_signup = v_requires_signup,
      min_tier_rank = v_min_tier,
      chatham_house = v_chatham,
      is_private = v_is_private,
      allow_overlap = v_allow_overlap,
      stream_url = v_stream,
      recording_url = v_recording,
      sort_order = v_sort,
      published_at = v_published_at,
      cancelled_at = v_cancelled_at
    WHERE id = v_id AND tenant_id = v_tenant;
  END IF;

  -- Szyna zdarzen: publikacja i odwolanie sesji sa faktami, o ktorych musza
  -- dowiedziec sie powiadomienia i webhooki. Emiter lapie wlasny wyjatek, wiec
  -- awaria szyny nie wywraca zapisu redakcyjnego.
  IF v_status IS DISTINCT FROM v_prev_status AND v_status IN ('published', 'cancelled') THEN
    PERFORM public.emit_domain_event(
      v_tenant,
      'event_session',
      v_id::text,
      'event_session.' || v_status || '.v1',
      jsonb_build_object('event_id', v_event_id, 'session_id', v_id, 'title_pl', v_title_pl),
      auth.uid()
    );
  END IF;

  RETURN v_id;
EXCEPTION
  -- 23P01 = exclusion_violation. Jedyne ograniczenie EXCLUDE na tej tabeli to
  -- kolizja sali, wiec przeklad jest jednoznaczny. Bez niego panel dostaje
  -- surowy komunikat Postgresa z nazwa ograniczenia.
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'room_conflict: room already taken in this slot';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_session_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_session_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_session_save(jsonb) IS
  'Dodanie albo edycja sesji agendy. Pole nieobecne w payloadzie zostaje bez zmiany, obecne i puste jest czyszczone. Wydarzenie sesji jest niezmienne. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 12) PANEL: USUNIECIE SESJI
--
-- Usuniecie sesji z zapisami jest ODRZUCANE. Kaskada skasowalaby wiersze
-- uczestnikow bez sladu, a to jest informacja, ktorej nikt nie odtworzy:
-- kto mial byc na sesji, ktora zniknela. Sciezka wlasciwa jest odwolanie
-- (`status = cancelled`), bo ono zachowuje zapisy i pozwala powiadomic ludzi.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_session_delete(uuid);
CREATE FUNCTION public.admin_event_session_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_signups integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_sessions s WHERE s.id = _id AND s.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: session does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_signups
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant
    AND g.session_id = _id
    AND g.status <> 'cancelled';

  IF v_signups > 0 THEN
    RAISE EXCEPTION 'session_has_signups: % active signup(s) - cancel the session instead', v_signups;
  END IF;

  DELETE FROM public.event_sessions WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_session_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_session_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_session_delete(uuid) IS
  'Usuwa sesje bez aktywnych zapisow (razem z jej podsesjami i obsada - kaskada). Sesja z zapisami wymaga odwolania, nie usuniecia.';

-- ----------------------------------------------------------------------------
-- 13) PANEL: KOLEJNOSC SESJI WSADOWO
--
-- Przeciagniecie jednej sesji w siatce agendy zmienia kolejnosc CALEJ kolumny.
-- Wysylanie tego jako N wywolan daje N transakcji, z ktorych czesc moze sie nie
-- udac - i agenda zostaje w stanie, ktorego nikt nie zamawial. Jedno wywolanie
-- to jedna transakcja: albo cala nowa kolejnosc, albo zadna.
--
-- Wiersze obce tenantowi sa po prostu POMIJANE (warunek `tenant_id`), a funkcja
-- zwraca liczbe faktycznie przestawionych sesji - klient porownuje ja z dlugoscia
-- swojej listy i widzi, ze cos wyparowalo, zamiast dostac cicha zgode.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_sessions_reorder(jsonb);
CREATE FUNCTION public.admin_event_sessions_reorder(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_moved integer;
BEGIN
  IF jsonb_typeof(p_payload->'items') <> 'array' THEN
    RAISE EXCEPTION 'invalid_payload: items must be an array of {id, sort_order}';
  END IF;

  UPDATE public.event_sessions s
  SET sort_order = i.sort_order
  FROM (
    SELECT
      (x->>'id')::uuid AS id,
      (x->>'sort_order')::integer AS sort_order
    FROM jsonb_array_elements(p_payload->'items') AS x
    WHERE NULLIF(x->>'id', '') IS NOT NULL
      AND NULLIF(x->>'sort_order', '') IS NOT NULL
  ) i
  WHERE s.id = i.id
    AND s.tenant_id = v_tenant
    AND s.sort_order IS DISTINCT FROM i.sort_order;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sessions_reorder(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sessions_reorder(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sessions_reorder(jsonb) IS
  'Wsadowa zmiana kolejnosci sesji: {"items":[{"id":uuid,"sort_order":int}]}. Zwraca liczbe przestawionych wierszy. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 14) PANEL: PUBLIKACJA, WYCOFANIE, ODWOLANIE - WSADOWO
--
-- Jedna funkcja na trzy przejscia, bo wszystkie trzy sa TA SAMA operacja
-- (zmiana statusu ze stemplem), a rozbicie na `..._publish`, `..._unpublish`
-- i `..._cancel` dawaloby trzy granty, trzy komentarze i trzy miejsca, w ktorych
-- mozna zapomniec o stemplu.
--
-- Wsadowo, bo agenda publikuje sie CALA: redaktor konczy wpisywanie dnia
-- drugiego i zaznacza dwanascie sesji. Petla po dwunastu wywolaniach w kliencie
-- to dwanascie transakcji i dwanascie okazji na polowiczny stan.
--
-- `published_at` stempluje sie tylko przy PIERWSZEJ publikacji - powtorna
-- publikacja po wycofaniu nie klamie o dacie premiery (wzorzec z etapu 1).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_sessions_set_status(jsonb);
CREATE FUNCTION public.admin_event_sessions_set_status(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_status text := COALESCE(NULLIF(p_payload->>'status', ''), '');
  v_ids uuid[];
  v_changed integer := 0;
  v_rec record;
BEGIN
  IF v_status NOT IN ('draft', 'published', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status: status must be draft, published or cancelled';
  END IF;

  IF jsonb_typeof(p_payload->'ids') <> 'array' THEN
    RAISE EXCEPTION 'invalid_payload: ids must be an array of session ids';
  END IF;

  SELECT array_agg((x)::uuid) INTO v_ids
  FROM jsonb_array_elements_text(p_payload->'ids') AS x
  WHERE NULLIF(x, '') IS NOT NULL;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_rec IN
    UPDATE public.event_sessions s
    SET status = v_status,
        published_at = CASE
          WHEN v_status = 'published' THEN COALESCE(s.published_at, now())
          ELSE s.published_at
        END,
        cancelled_at = CASE WHEN v_status = 'cancelled' THEN COALESCE(s.cancelled_at, now()) END
    WHERE s.tenant_id = v_tenant
      AND s.id = ANY (v_ids)
      AND s.status <> v_status
    RETURNING s.id, s.event_id, s.title_pl
  LOOP
    v_changed := v_changed + 1;
    IF v_status IN ('published', 'cancelled') THEN
      PERFORM public.emit_domain_event(
        v_tenant,
        'event_session',
        v_rec.id::text,
        'event_session.' || v_status || '.v1',
        jsonb_build_object(
          'event_id', v_rec.event_id, 'session_id', v_rec.id, 'title_pl', v_rec.title_pl
        ),
        auth.uid()
      );
    END IF;
  END LOOP;

  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sessions_set_status(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sessions_set_status(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sessions_set_status(jsonb) IS
  'Wsadowa publikacja, wycofanie i odwolanie sesji: {"ids":[uuid],"status":"published"}. Stempluje published_at raz, cancelled_at przy odwolaniu, emituje zdarzenie domenowe. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 15) PANEL: OBSADA SESJI WSADOWO
--
-- Kontrakt jest ZASTAPIENIEM CALEJ OBSADY, nie dokladaniem osob: klient
-- wysyla liste, jaka ma byc, a funkcja doprowadza baze do tego stanu (kasuje
-- nieobecnych, dopisuje nowych, aktualizuje role i kolejnosc). Dokladanie po
-- jednym wymagaloby od klienta drugiego wywolania na usuniecie i trzeciego na
-- zmiane roli, a kazde z nich mogloby sie nie udac osobno.
--
-- KOLIZJA PRELEGENTA jest tu ODRZUCANA, nie raportowana - to jest chwila,
-- w ktorej redaktor podejmuje decyzje, wiec to tutaj ma zobaczyc, ze osoba
-- juz gdzies mowi. Furtki sa dwie i obie jawne: `allow_overlap` na wierszu
-- obsady (swiadome dopuszczenie) oraz rola `host`, ktora z definicji obejmuje
-- rownolegle sciezki. Kolizja powstala POZNIEJ (po przesunieciu godzin sesji)
-- nie ma jak przejsc tedy - lapie ja admin_event_agenda_conflicts.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_session_speakers_set(jsonb);
CREATE FUNCTION public.admin_event_session_speakers_set(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_session_id uuid := NULLIF(p_payload->>'session_id', '')::uuid;
  v_session public.event_sessions;
  v_keep uuid[] := ARRAY[]::uuid[];
  v_count integer := 0;
  v_item jsonb;
  v_ord integer := 0;
  v_profile uuid;
  v_role text;
  v_sort integer;
  v_allow boolean;
  v_clash text;
BEGIN
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: session_id is required';
  END IF;

  IF jsonb_typeof(p_payload->'speakers') <> 'array' THEN
    RAISE EXCEPTION 'invalid_payload: speakers must be an array';
  END IF;

  SELECT * INTO v_session
  FROM public.event_sessions s
  WHERE s.id = v_session_id AND s.tenant_id = v_tenant;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'not_found: session does not exist in this tenant';
  END IF;

  FOR v_item IN SELECT x FROM jsonb_array_elements(p_payload->'speakers') AS x
  LOOP
    v_ord := v_ord + 1;
    v_profile := NULLIF(v_item->>'speaker_profile_id', '')::uuid;
    v_role := COALESCE(NULLIF(v_item->>'role', ''), 'speaker');
    v_sort := COALESCE((NULLIF(v_item->>'sort_order', ''))::integer, v_ord * 10);
    v_allow := COALESCE((NULLIF(v_item->>'allow_overlap', ''))::boolean, false);

    IF v_profile IS NULL THEN
      RAISE EXCEPTION 'invalid_payload: speaker_profile_id is required for every entry';
    END IF;

    IF v_role NOT IN ('speaker', 'moderator', 'panelist', 'host') THEN
      RAISE EXCEPTION 'invalid_role: role must be speaker, moderator, panelist or host';
    END IF;

    -- Profil prelegenta MUSI byc z tego tenanta. Klucz obcy zlozony
    -- (tenant_id, speaker_profile_id) odrzucilby obce id sam, ale bez nazwy pola.
    IF NOT EXISTS (
      SELECT 1 FROM public.speaker_profiles sp
      WHERE sp.id = v_profile AND sp.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'speaker_not_found: speaker profile does not exist in this tenant';
    END IF;

    -- Kolizja: ta sama osoba w innej NIEODWOLANEJ sesji, ktorej przedzial
    -- zachodzi na te. Liczy sie po CALYM tenancie, nie po jednym wydarzeniu -
    -- dwa wydarzenia tego samego dnia to ta sama osoba i ten sam kalendarz.
    IF NOT v_allow AND v_role <> 'host' AND v_session.status <> 'cancelled' THEN
      SELECT s2.title_pl INTO v_clash
      FROM public.event_session_speakers es2
      JOIN public.event_sessions s2
        ON s2.id = es2.session_id AND s2.tenant_id = es2.tenant_id
      WHERE es2.tenant_id = v_tenant
        AND es2.speaker_profile_id = v_profile
        AND es2.session_id <> v_session_id
        AND es2.allow_overlap = false
        AND es2.role <> 'host'
        AND s2.status <> 'cancelled'
        AND s2.time_range && v_session.time_range
      ORDER BY s2.starts_at
      LIMIT 1;

      IF v_clash IS NOT NULL THEN
        RAISE EXCEPTION 'speaker_overlap: the speaker already appears in "%" at this time', v_clash;
      END IF;
    END IF;

    INSERT INTO public.event_session_speakers (
      tenant_id, event_id, session_id, speaker_profile_id, role, sort_order, allow_overlap
    ) VALUES (
      v_tenant, v_session.event_id, v_session_id, v_profile, v_role, v_sort, v_allow
    )
    ON CONFLICT (tenant_id, session_id, speaker_profile_id) DO UPDATE
      SET role = EXCLUDED.role,
          sort_order = EXCLUDED.sort_order,
          allow_overlap = EXCLUDED.allow_overlap,
          updated_at = now();

    v_keep := v_keep || v_profile;
    v_count := v_count + 1;
  END LOOP;

  DELETE FROM public.event_session_speakers es
  WHERE es.tenant_id = v_tenant
    AND es.session_id = v_session_id
    AND NOT (es.speaker_profile_id = ANY (v_keep));

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_session_speakers_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_session_speakers_set(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_session_speakers_set(jsonb) IS
  'Zastepuje CALA obsade sesji: {"session_id":uuid,"speakers":[{speaker_profile_id, role, sort_order, allow_overlap}]}. Odrzuca kolizje prelegenta poza furtka allow_overlap i rola host. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 16) PANEL: ZAPISY NA JEDNA SESJE
--
-- Lista odpowiada na pytanie "kto jest zapisany", a nie tylko "ilu ich jest" -
-- bez tego limit miejsc jest liczba bez tresci, a organizator nie ma jak
-- wpuscic czlowieka z listy rezerwowej.
--
-- Adres e-mail NIE JEST tu oddawany. Dane kontaktowe uczestnikow to plaszczyzna
-- modulu uczestnikow (rejestr, zgody, RODO) i tam maja swoja bramke; agenda
-- potrzebuje nazwy i statusu, zeby wywolac czlowieka po nazwisku.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_session_signups_list(uuid);
CREATE FUNCTION public.admin_event_session_signups_list(p_session_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  profile_slug text,
  status text,
  registered_at timestamptz,
  cancelled_at timestamptz,
  added_by_staff boolean,
  waitlist_position integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    g.id, g.user_id, pr.display_name, pr.avatar_url, pr.slug,
    g.status, g.registered_at, g.cancelled_at,
    (g.created_by IS NOT NULL AND g.created_by <> g.user_id),
    -- Miejsce w kolejce rezerwowej. Liczone FIFO po `registered_at`, dokladnie
    -- w tej samej kolejnosci, w ktorej awansuje event_session_signup.
    CASE
      WHEN g.status = 'waitlist' THEN
        row_number() OVER (
          PARTITION BY g.status ORDER BY g.registered_at, g.id
        )::integer
      ELSE NULL
    END
  FROM public.event_session_signups g
  LEFT JOIN public.profiles pr
    ON pr.id = g.user_id AND pr.tenant_id = v_tenant
  WHERE g.tenant_id = v_tenant
    AND g.session_id = p_session_id
  ORDER BY
    CASE g.status WHEN 'registered' THEN 0 WHEN 'waitlist' THEN 1 ELSE 2 END,
    g.registered_at,
    g.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_session_signups_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_session_signups_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_session_signups_list(uuid) IS
  'Zapisy na sesje dla panelu: kto, w jakim statusie, z pozycja na liscie rezerwowej. Bez danych kontaktowych - te naleza do modulu uczestnikow. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 17) PANEL: RAPORT KOLIZJI AGENDY
--
-- Wszystkie cztery rodzaje kolizji sa LICZONE Z DANYCH, zaden nie jest flaga
-- zapisana przy okazji. To istotne, bo trzy z nich powstaja PO zapisie sesji,
-- bez udzialu redaktora sesji:
--   * `speaker_overlap`      - po przesunieciu godzin jednej z sesji;
--   * `outside_event_window` - po zwezeniu okna czasowego wydarzenia;
--   * `capacity_over_room`   - po obnizeniu pojemnosci sali;
--   * `overbooked`           - po obnizeniu limitu miejsc sesji, na ktora
--                              zapisalo sie wiecej osob.
-- Zaden trigger na sesji ich nie zlapie, bo zmiana nie dotyczy jej wiersza.
-- Kolizja SALI w tym raporcie nie wystepuje - jest niemozliwa (ograniczenie
-- EXCLUDE), a raportowanie stanu niemozliwego to zaproszenie do wiary, ze
-- ograniczenia nie ma.
--
-- Para kolizji prelegenta jest zwracana RAZ (warunek `a.id < b.id`), inaczej
-- panel pokazywalby dwa wiersze o tym samym problemie.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_agenda_conflicts(uuid);
CREATE FUNCTION public.admin_event_agenda_conflicts(p_event_id uuid)
RETURNS TABLE (
  kind text,
  session_id uuid,
  session_title_pl text,
  session_title_en text,
  session_starts_at timestamptz,
  other_session_id uuid,
  other_title_pl text,
  other_title_en text,
  subject_id uuid,
  subject_name text,
  expected_value integer,
  actual_value integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  -- 1) Ta sama osoba w dwoch nachodzacych sesjach, obie bez furtki.
  SELECT
    'speaker_overlap'::text,
    sa.id, sa.title_pl, sa.title_en, sa.starts_at,
    sb.id, sb.title_pl, sb.title_en,
    spf.id, pr.display_name,
    NULL::integer, NULL::integer
  FROM public.event_session_speakers ea
  JOIN public.event_session_speakers eb
    ON eb.tenant_id = ea.tenant_id
   AND eb.speaker_profile_id = ea.speaker_profile_id
   AND eb.session_id <> ea.session_id
  JOIN public.event_sessions sa
    ON sa.id = ea.session_id AND sa.tenant_id = ea.tenant_id
  JOIN public.event_sessions sb
    ON sb.id = eb.session_id AND sb.tenant_id = eb.tenant_id
  JOIN public.speaker_profiles spf
    ON spf.id = ea.speaker_profile_id AND spf.tenant_id = ea.tenant_id
  LEFT JOIN public.profiles pr
    ON pr.id = spf.user_id AND pr.tenant_id = ea.tenant_id
  WHERE ea.tenant_id = v_tenant
    AND sa.event_id = p_event_id
    AND sa.id < sb.id
    AND ea.allow_overlap = false
    AND eb.allow_overlap = false
    AND ea.role <> 'host'
    AND eb.role <> 'host'
    AND sa.status <> 'cancelled'
    AND sb.status <> 'cancelled'
    AND sa.time_range && sb.time_range

  UNION ALL

  -- 2) Sesja poza oknem czasowym wydarzenia (okno zwezone po zapisie sesji).
  SELECT
    'outside_event_window'::text,
    s.id, s.title_pl, s.title_en, s.starts_at,
    NULL::uuid, NULL::text, NULL::text,
    e.id, e.title_pl,
    NULL::integer, NULL::integer
  FROM public.event_sessions s
  JOIN public.events e
    ON e.id = s.event_id AND e.tenant_id = s.tenant_id
  WHERE s.tenant_id = v_tenant
    AND s.event_id = p_event_id
    AND s.status <> 'cancelled'
    AND (
      s.starts_at < e.starts_at
      OR (e.ends_at IS NOT NULL AND s.ends_at > e.ends_at)
    )

  UNION ALL

  -- 3) Limit miejsc sesji wyzszy niz pojemnosc sali (sala zmniejszona pozniej).
  SELECT
    'capacity_over_room'::text,
    s.id, s.title_pl, s.title_en, s.starts_at,
    NULL::uuid, NULL::text, NULL::text,
    r.id, r.name,
    r.capacity, s.capacity
  FROM public.event_sessions s
  JOIN public.event_rooms r
    ON r.id = s.room_id AND r.tenant_id = s.tenant_id
  WHERE s.tenant_id = v_tenant
    AND s.event_id = p_event_id
    AND s.status <> 'cancelled'
    AND s.capacity IS NOT NULL
    AND r.capacity IS NOT NULL
    AND s.capacity > r.capacity

  UNION ALL

  -- 4) Zapisow wiecej niz miejsc (limit obnizony po zapisach).
  SELECT
    'overbooked'::text,
    s.id, s.title_pl, s.title_en, s.starts_at,
    NULL::uuid, NULL::text, NULL::text,
    NULL::uuid, NULL::text,
    s.capacity, g.registered
  FROM public.event_sessions s
  JOIN LATERAL (
    SELECT count(*)::integer AS registered
    FROM public.event_session_signups g0
    WHERE g0.tenant_id = s.tenant_id
      AND g0.session_id = s.id
      AND g0.status = 'registered'
  ) g ON true
  WHERE s.tenant_id = v_tenant
    AND s.event_id = p_event_id
    AND s.status <> 'cancelled'
    AND s.capacity IS NOT NULL
    AND g.registered > s.capacity

  ORDER BY 5, 1;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_agenda_conflicts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_agenda_conflicts(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_agenda_conflicts(uuid) IS
  'Raport kolizji agendy liczony z danych: kolizja prelegenta, sesja poza oknem wydarzenia, limit ponad pojemnosc sali, zapisy ponad limit. Kolizja sali nie wystepuje - jest niemozliwa (EXCLUDE). Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 18) PLASZCZYZNA TRESCI: PUBLICZNA AGENDA PO ADRESIE WYDARZENIA
--
-- WYLACZNIE `public_tenant_id()`, zero `has_role()` i zero `is_staff()`.
-- Naglowek `x-tenant-host` ustawia klient, wiec jest falsyfikowalny; funkcja,
-- ktora skalowalaby dane po naglowku, a autoryzowala po roli w tenancie
-- domowym, pozwolilaby administratorowi najemcy A podszyc sie pod najemce B
-- (dokladnie wyciek zamkniety w 20260724091000, pilnowany przez bramke
-- check:sql-tenant-scope). Staff podglada agende robocza przez funkcje panelu.
--
-- CO JEST ODDAWANE, A CO NIE
--   * `stream_url` i `recording_url` NIE WYCHODZA. Front dostaje `has_stream`
--     i `has_recording`, a adres pobiera przez `event_session_access` z osobna
--     ocena uprawnien - inaczej link do transmisji lezy w odpowiedzi HTTP
--     kazdego, kto otworzyl strone agendy.
--   * Sesje ODWOLANE sa oddawane (z `access_state = 'cancelled'`). Uczestnik
--     ma prawo wiedziec, ze punkt agendy przepadl; ukrycie go zamienia
--     odwolanie w cicha zmiane planu.
--   * Sesje ZAMKNIETE (`is_private`) widzi tylko osoba, ktora ma na nie zapis.
--   * `access_state` jest liczonym stanem, nie flaga z bazy: mowi frontowi,
--     ktory przycisk pokazac (zapisz sie / lista rezerwowa / brak miejsc /
--     wymagana warstwa / jestes zapisany), zeby ta decyzja nie powstawala
--     w trzech komponentach osobno i za kazdym razem inaczej.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_agenda(text);
CREATE FUNCTION public.event_agenda(p_slug text)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  parent_session_id uuid,
  title_pl text,
  title_en text,
  description_pl text,
  description_en text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  format text,
  status text,
  sort_order integer,
  chatham_house boolean,
  min_tier_rank integer,
  requires_signup boolean,
  capacity integer,
  registered_count integer,
  seats_left integer,
  track_id uuid,
  track_key text,
  track_name_pl text,
  track_name_en text,
  track_accent_color text,
  room_id uuid,
  room_name text,
  room_floor text,
  has_stream boolean,
  has_recording boolean,
  my_signup_status text,
  access_state text,
  speakers jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_rank integer := public.current_tier_rank();
  v_event_id uuid;
  v_timezone text;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  SELECT e.id, e.timezone INTO v_event_id, v_timezone
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.slug = p_slug
    AND e.status = 'published';

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH mine AS (
    SELECT g.session_id, g.status
    FROM public.event_session_signups g
    WHERE v_uid IS NOT NULL
      AND g.tenant_id = v_tenant
      AND g.event_id = v_event_id
      AND g.user_id = v_uid
  )
  SELECT
    s.id, s.event_id, s.parent_session_id,
    s.title_pl, s.title_en, s.description_pl, s.description_en,
    s.starts_at, s.ends_at, v_timezone,
    s.format, s.status, s.sort_order, s.chatham_house, s.min_tier_rank,
    s.requires_signup, s.capacity,
    CASE WHEN s.requires_signup THEN COALESCE(c.registered, 0) ELSE 0 END::integer,
    CASE
      WHEN s.capacity IS NULL THEN NULL
      ELSE GREATEST(s.capacity - COALESCE(c.registered, 0), 0)
    END::integer,
    s.track_id, t.key, t.name_pl, t.name_en, t.accent_color,
    s.room_id, r.name, r.floor,
    (s.stream_url IS NOT NULL),
    (s.recording_url IS NOT NULL),
    m.status,
    CASE
      WHEN s.status = 'cancelled' THEN 'cancelled'
      WHEN m.status = 'registered' THEN 'signed_up'
      WHEN m.status = 'waitlist' THEN 'waitlisted'
      WHEN s.min_tier_rank > 0 AND v_rank < s.min_tier_rank THEN 'tier_required'
      WHEN NOT s.requires_signup THEN 'open'
      WHEN s.capacity IS NOT NULL AND COALESCE(c.registered, 0) >= s.capacity THEN 'full'
      ELSE 'signup_required'
    END::text,
    COALESCE(sp.items, '[]'::jsonb)
  FROM public.event_sessions s
  LEFT JOIN mine m ON m.session_id = s.id AND m.status <> 'cancelled'
  LEFT JOIN public.event_tracks t
    ON t.id = s.track_id AND t.tenant_id = v_tenant
  LEFT JOIN public.event_rooms r
    ON r.id = s.room_id AND r.tenant_id = v_tenant
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS registered
    FROM public.event_session_signups g0
    WHERE g0.tenant_id = v_tenant
      AND g0.session_id = s.id
      AND g0.status = 'registered'
  ) c ON true
  LEFT JOIN LATERAL (
    -- Prelegenci: WYLACZNIE kolumny publiczne (ten sam zakres co
    -- get_public_speakers), kazda relacja przypieta do tenanta z naglowka -
    -- bez tego wpis wskazujacy profil innego najemcy wyciekalby jego
    -- nazwisko i zdjecie na obcej domenie.
    SELECT jsonb_agg(
      jsonb_build_object(
        'user_id', pr.id,
        'slug', pr.slug,
        'display_name', pr.display_name,
        'avatar_url', pr.avatar_url,
        'headline_pl', spf.headline_pl,
        'headline_en', spf.headline_en,
        'role', es.role,
        'sort_order', es.sort_order
      ) ORDER BY es.sort_order, pr.display_name
    ) AS items
    FROM public.event_session_speakers es
    JOIN public.speaker_profiles spf
      ON spf.id = es.speaker_profile_id
     AND spf.tenant_id = v_tenant
     AND spf.is_public
    JOIN public.profiles pr
      ON pr.id = spf.user_id AND pr.tenant_id = v_tenant
    WHERE es.tenant_id = v_tenant AND es.session_id = s.id
  ) sp ON true
  WHERE s.tenant_id = v_tenant
    AND s.event_id = v_event_id
    AND s.status IN ('published', 'cancelled')
    -- Sesja zamknieta jest widoczna tylko dla osoby z zapisem.
    AND (s.is_private = false OR m.status IS NOT NULL)
  ORDER BY s.starts_at, s.sort_order, s.title_pl;
END;
$$;

REVOKE ALL ON FUNCTION public.event_agenda(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_agenda(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_agenda(text) IS
  'Publiczna agenda opublikowanego wydarzenia po slugu, w najemcy z naglowka hosta. Oddaje sesje opublikowane i odwolane, bez adresow transmisji (tylko flagi), z liczonym access_state i zapisem wolajacego. Plaszczyzna tresci - zero has_role().';

-- ----------------------------------------------------------------------------
-- 19) PLASZCZYZNA TRESCI: ZAPIS UCZESTNIKA NA SESJE
--
-- TRZY SERIALIZACJE, KAZDA NA INNE ZAGROZENIE
--
--   1) `SELECT ... FOR UPDATE` na wierszu SESJI. Limit miejsc liczony bez
--      blokady jest wyscigiem: dwa zapisy w tej samej milisekundzie czytaja
--      "39 z 40" i oba wchodza. Blokada wiersza nadrzednego szereguje wszystkie
--      zapisy na te sesje - wzorzec `rsvp_event` z 20260713093000.
--
--   2) `pg_advisory_xact_lock` na parze (wydarzenie, uzytkownik). Kolizji
--      CZASOWEJ uczestnika nie da sie zamknac blokada wiersza sesji, bo dotyczy
--      DWOCH roznych sesji - a dwa rownolegle zapisy na dwie nachodzace sesje
--      blokuja rozne wiersze i mijaja sie. Blokada doradcza jest tu jedynym
--      wspolnym zasobem obu transakcji. Zasieg jest waski (jeden uczestnik,
--      jedno wydarzenie), wiec nie serializuje niczego wiecej.
--
--   3) `UNIQUE (tenant_id, session_id, user_id)` - powtorny zapis jest UPDATE,
--      nie duplikatem, wiec dwuklik nie tworzy dwoch miejsc.
--
-- LISTA REZERWOWA MA PROCES, NIE TYLKO STATUS. Zapis na pelna sesje laduje na
-- liscie rezerwowej (`waitlist`), a rezygnacja osoby z miejscem AWANSUJE
-- najstarszy wiersz z listy (FIFO). Bez tego awansu status `waitlist` byl by
-- metryka bez procesu - czyli bledem podanym jako funkcja.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_session_signup(jsonb);
CREATE FUNCTION public.event_session_signup(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_session_id uuid := NULLIF(p_payload->>'session_id', '')::uuid;
  v_wanted text := COALESCE(NULLIF(p_payload->>'status', ''), 'registered');
  v_session public.event_sessions;
  v_prev text;
  v_registered integer;
  v_final text;
  v_clash text;
  v_promoted uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL OR v_session_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: session_id is required';
  END IF;

  IF v_wanted NOT IN ('registered', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status: status must be registered or cancelled';
  END IF;

  -- Blokada wiersza sesji: od tej chwili liczba zajetych miejsc jest stabilna.
  SELECT * INTO v_session
  FROM public.event_sessions s
  WHERE s.id = v_session_id
    AND s.tenant_id = v_tenant
    AND s.status = 'published'
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'not_found: session is not open for signups';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = v_session.event_id
      AND e.tenant_id = v_tenant
      AND e.status = 'published'
  ) THEN
    RAISE EXCEPTION 'not_found: session is not open for signups';
  END IF;

  IF NOT v_session.requires_signup THEN
    RAISE EXCEPTION 'signup_disabled: this session does not take signups';
  END IF;

  SELECT g.status INTO v_prev
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant AND g.session_id = v_session_id AND g.user_id = v_uid;

  IF v_wanted = 'cancelled' THEN
    IF v_prev IS NULL OR v_prev = 'cancelled' THEN
      RETURN jsonb_build_object('status', 'cancelled', 'promoted', false);
    END IF;

    UPDATE public.event_session_signups
    SET status = 'cancelled', cancelled_at = now()
    WHERE tenant_id = v_tenant AND session_id = v_session_id AND user_id = v_uid;

    -- Awans z listy rezerwowej. Tylko gdy zwolnilo sie MIEJSCE (rezygnacja
    -- osoby, ktora je miala) - rezygnacja z listy rezerwowej nie zwalnia nic.
    IF v_prev = 'registered' THEN
      SELECT g.user_id INTO v_promoted
      FROM public.event_session_signups g
      WHERE g.tenant_id = v_tenant
        AND g.session_id = v_session_id
        AND g.status = 'waitlist'
      ORDER BY g.registered_at, g.id
      LIMIT 1;

      IF v_promoted IS NOT NULL THEN
        UPDATE public.event_session_signups
        SET status = 'registered'
        WHERE tenant_id = v_tenant AND session_id = v_session_id AND user_id = v_promoted;
      END IF;
    END IF;

    SELECT count(*)::integer INTO v_registered
    FROM public.event_session_signups g
    WHERE g.tenant_id = v_tenant AND g.session_id = v_session_id AND g.status = 'registered';

    RETURN jsonb_build_object(
      'status', 'cancelled',
      'promoted', v_promoted IS NOT NULL,
      'registered', v_registered,
      'seats_left', CASE
        WHEN v_session.capacity IS NULL THEN NULL
        ELSE GREATEST(v_session.capacity - v_registered, 0)
      END
    );
  END IF;

  IF v_session.min_tier_rank > 0 AND NOT public.has_tier_rank(v_session.min_tier_rank) THEN
    RAISE EXCEPTION 'tier_required: a higher membership tier is required for this session';
  END IF;

  -- Kolizja czasowa uczestnika. Regula dziala tylko miedzy sesjami, ktore OBIE
  -- maja `allow_overlap = false` - inaczej organizator nie mialby jak dopuscic
  -- swiadomego nakladania (rownolegly stream, sesja powtarzana).
  IF NOT v_session.allow_overlap THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_session.event_id::text || ':' || v_uid::text, 0)
    );

    SELECT s2.title_pl INTO v_clash
    FROM public.event_session_signups g2
    JOIN public.event_sessions s2
      ON s2.id = g2.session_id AND s2.tenant_id = g2.tenant_id
    WHERE g2.tenant_id = v_tenant
      AND g2.user_id = v_uid
      AND g2.status = 'registered'
      AND g2.session_id <> v_session_id
      AND s2.status = 'published'
      AND s2.allow_overlap = false
      AND s2.time_range && v_session.time_range
    ORDER BY s2.starts_at
    LIMIT 1;

    IF v_clash IS NOT NULL THEN
      RAISE EXCEPTION 'overlap_conflict: you are already signed up for "%" at this time', v_clash;
    END IF;
  END IF;

  -- Zajete miejsca BEZ wlasnego wiersza: powtorny zapis tej samej osoby nie
  -- moze zajac drugiego miejsca ani wypchnac jej samej na liste rezerwowa.
  SELECT count(*)::integer INTO v_registered
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant
    AND g.session_id = v_session_id
    AND g.status = 'registered'
    AND g.user_id <> v_uid;

  v_final := CASE
    WHEN v_session.capacity IS NOT NULL AND v_registered >= v_session.capacity THEN 'waitlist'
    ELSE 'registered'
  END;

  INSERT INTO public.event_session_signups (
    tenant_id, event_id, session_id, user_id, status, registered_at, created_by
  ) VALUES (
    v_tenant, v_session.event_id, v_session_id, v_uid, v_final, now(), v_uid
  )
  ON CONFLICT (tenant_id, session_id, user_id) DO UPDATE
    SET status = EXCLUDED.status,
        -- Data zapisu decyduje o miejscu w kolejce rezerwowej, wiec powrot po
        -- rezygnacji ustawia sie na koncu kolejki, a nie na starym miejscu.
        registered_at = CASE
          WHEN event_session_signups.status = 'cancelled' THEN now()
          ELSE event_session_signups.registered_at
        END,
        cancelled_at = NULL,
        updated_at = now();

  SELECT count(*)::integer INTO v_registered
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant AND g.session_id = v_session_id AND g.status = 'registered';

  RETURN jsonb_build_object(
    'status', v_final,
    'promoted', false,
    'registered', v_registered,
    'seats_left', CASE
      WHEN v_session.capacity IS NULL THEN NULL
      ELSE GREATEST(v_session.capacity - v_registered, 0)
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_session_signup(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_session_signup(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_session_signup(jsonb) IS
  'Zapis albo rezygnacja zalogowanego uczestnika na sesje: {"session_id":uuid,"status":"registered|cancelled"}. Limit pod blokada wiersza sesji, kolizja czasowa pod blokada doradcza, lista rezerwowa z awansem FIFO. Plaszczyzna tresci - zero has_role().';

-- ----------------------------------------------------------------------------
-- 20) PLASZCZYZNA TRESCI: DOSTEP DO TRANSMISJI I NAGRANIA SESJI
--
-- Odpowiednik `get_event_access` na poziomie sesji, z ta sama doktryna
-- rozdzielenia dwoch zasobow:
--   * TRANSMISJA wymaga rangi warstwy I zapisu (jesli sesja zapisu wymaga) -
--     to jest wejscie na sale, wiec ma te same warunki co wejscie na sale;
--   * NAGRANIE wymaga tylko rangi warstwy - kto ma prawo do tresci, ma prawo
--     do jej powtorki, niezaleznie od tego, czy byl zapisany na termin.
--
-- Funkcja NIE ma obejscia stafowego. Gdyby je miala, musialaby zestawic
-- `public_tenant_id()` z `has_role()` w jednym ciele - a to jest dokladnie ta
-- mieszanka, przez ktora wyciekaly dane miedzy najemcami (bramka
-- check:sql-tenant-scope). Panel czyta adresy przez
-- `admin_event_session_detail`, ktore stoi na tenancie DOMOWYM.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_session_access(uuid);
CREATE FUNCTION public.event_session_access(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_session public.event_sessions;
  v_signed boolean;
BEGIN
  IF v_tenant IS NULL OR _session_id IS NULL THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'not_found');
  END IF;

  SELECT s.* INTO v_session
  FROM public.event_sessions s
  JOIN public.events e
    ON e.id = s.event_id AND e.tenant_id = s.tenant_id
  WHERE s.id = _session_id
    AND s.tenant_id = v_tenant
    AND s.status = 'published'
    AND e.status = 'published';

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'not_found');
  END IF;

  IF v_session.min_tier_rank > 0 AND NOT public.has_tier_rank(v_session.min_tier_rank) THEN
    RETURN jsonb_build_object('can_stream', false, 'can_watch', false, 'reason', 'tier_required');
  END IF;

  v_signed := NOT v_session.requires_signup OR EXISTS (
    SELECT 1 FROM public.event_session_signups g
    WHERE g.tenant_id = v_tenant
      AND g.session_id = _session_id
      AND g.user_id = v_uid
      AND g.status = 'registered'
  );

  RETURN jsonb_build_object(
    'can_stream', v_signed,
    'can_watch', true,
    'reason', CASE WHEN v_signed THEN 'granted' ELSE 'signup_required' END,
    'stream_url', CASE WHEN v_signed THEN v_session.stream_url END,
    'recording_url', v_session.recording_url,
    'chatham_house', v_session.chatham_house
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_session_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_session_access(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_session_access(uuid) IS
  'Serwerowa ocena dostepu do transmisji i nagrania sesji: transmisja wymaga rangi warstwy i zapisu, nagranie tylko rangi warstwy. Bez obejscia stafowego (patrz komentarz). Plaszczyzna tresci.';

-- ----------------------------------------------------------------------------
-- 21) PANEL: ZAPIS UCZESTNIKA PRZEZ ORGANIZATORA
--
-- DLACZEGO TA FUNKCJA MUSI ISTNIEC. Bez niej kolumna `created_by` i wynikajaca
-- z niej flaga `added_by_staff` na liscie zapisow nie maja PROCESU, ktory je
-- zapisuje - byly by liczba zawsze rowna zeru, czyli atrapa. Ta sama zasada
-- dziala w druga strone: organizator, ktory widzi liste rezerwowa i nie ma jak
-- nikogo z niej wpuscic, patrzy na dane, ktorych nie moze uzyc.
--
-- ROZNICE WOBEC SCIEZKI UCZESTNIKA (`event_session_signup`)
--   * plaszczyzna ADMINISTRACYJNA - `assert_editor_tenant()`, tenant domowy,
--     zero `public_tenant_id()`;
--   * dziala TAKZE na sesji roboczej (organizator uklada liste przed
--     publikacja) i na sesji, ktora nie wymaga zapisu - wtedy odmawia, bo
--     wiersz zapisu na sesji bez zapisow nie znaczy nic;
--   * ma jawna FURTKE `force` na przekroczenie limitu miejsc. Furtka nie jest
--     ukryta: nadwyzka pojawia sie w `admin_event_agenda_conflicts` jako
--     `overbooked`, wiec swiadoma decyzja zostaje widoczna, a nie zapomniana.
--   * PROG WARSTWY OBOWIAZUJE TAKZE ORGANIZATORA. Zapis ponad prog dawalby
--     osobe, ktora ma miejsce na liscie i nie ma dostepu do transmisji
--     (`event_session_access` sprawdza range niezaleznie) - czyli zapis, ktory
--     klamie. Wlasciwa droga jest nadanie warstwy albo obnizenie progu.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_session_signup_set(jsonb);
CREATE FUNCTION public.admin_event_session_signup_set(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_session_id uuid := NULLIF(p_payload->>'session_id', '')::uuid;
  v_user_id uuid := NULLIF(p_payload->>'user_id', '')::uuid;
  v_wanted text := COALESCE(NULLIF(p_payload->>'status', ''), 'registered');
  v_force boolean := COALESCE((NULLIF(p_payload->>'force', ''))::boolean, false);
  v_session public.event_sessions;
  v_prev text;
  v_registered integer;
  v_final text;
  v_promoted uuid;
BEGIN
  IF v_session_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: session_id and user_id are required';
  END IF;

  IF v_wanted NOT IN ('registered', 'waitlist', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status: status must be registered, waitlist or cancelled';
  END IF;

  SELECT * INTO v_session
  FROM public.event_sessions s
  WHERE s.id = v_session_id AND s.tenant_id = v_tenant
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'not_found: session does not exist in this tenant';
  END IF;

  IF NOT v_session.requires_signup THEN
    RAISE EXCEPTION 'signup_disabled: this session does not take signups';
  END IF;

  -- Uczestnik musi miec profil W TYM TENANCIE. Bez tego warunku redaktor
  -- zapisalby na sesje konto z innej organizacji, podajac jego identyfikator.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_user_id AND p.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'person_not_found: this account has no profile in your organisation';
  END IF;

  SELECT g.status INTO v_prev
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant AND g.session_id = v_session_id AND g.user_id = v_user_id;

  IF v_wanted = 'cancelled' THEN
    IF v_prev IS NULL OR v_prev = 'cancelled' THEN
      RETURN jsonb_build_object('status', 'cancelled', 'promoted', false);
    END IF;

    UPDATE public.event_session_signups
    SET status = 'cancelled', cancelled_at = now()
    WHERE tenant_id = v_tenant AND session_id = v_session_id AND user_id = v_user_id;

    IF v_prev = 'registered' THEN
      SELECT g.user_id INTO v_promoted
      FROM public.event_session_signups g
      WHERE g.tenant_id = v_tenant
        AND g.session_id = v_session_id
        AND g.status = 'waitlist'
      ORDER BY g.registered_at, g.id
      LIMIT 1;

      IF v_promoted IS NOT NULL THEN
        UPDATE public.event_session_signups
        SET status = 'registered'
        WHERE tenant_id = v_tenant AND session_id = v_session_id AND user_id = v_promoted;
      END IF;
    END IF;

    RETURN jsonb_build_object('status', 'cancelled', 'promoted', v_promoted IS NOT NULL);
  END IF;

  -- Prog warstwy liczymy ISTNIEJACYM helperem `user_tier_rank(user, tenant)`
  -- (20260713174428), a nie wlasnym zapytaniem. Ranga ma TRZY zrodla
  -- (subskrypcja, grant reczny, miejsce w organizacji czlonkowskiej) i kazda
  -- wlasna kopia tej logiki rozjedzie sie z platforma przy pierwszej zmianie
  -- planow - najpewniej cicho, odrzucajac osobe z miejsca organizacyjnego.
  IF v_session.min_tier_rank > 0
     AND public.user_tier_rank(v_user_id, v_tenant) < v_session.min_tier_rank THEN
    RAISE EXCEPTION 'tier_required: this person does not hold the required membership tier';
  END IF;

  SELECT count(*)::integer INTO v_registered
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant
    AND g.session_id = v_session_id
    AND g.status = 'registered'
    AND g.user_id <> v_user_id;

  IF v_wanted = 'registered'
     AND v_session.capacity IS NOT NULL
     AND v_registered >= v_session.capacity
     AND NOT v_force THEN
    RAISE EXCEPTION 'session_full: % of % seats taken - use force to exceed the limit',
      v_registered, v_session.capacity;
  END IF;

  v_final := v_wanted;

  INSERT INTO public.event_session_signups (
    tenant_id, event_id, session_id, user_id, status, registered_at, created_by
  ) VALUES (
    v_tenant, v_session.event_id, v_session_id, v_user_id, v_final, now(), auth.uid()
  )
  ON CONFLICT (tenant_id, session_id, user_id) DO UPDATE
    SET status = EXCLUDED.status,
        registered_at = CASE
          WHEN event_session_signups.status = 'cancelled' THEN now()
          ELSE event_session_signups.registered_at
        END,
        cancelled_at = NULL,
        created_by = COALESCE(event_session_signups.created_by, EXCLUDED.created_by),
        updated_at = now();

  SELECT count(*)::integer INTO v_registered
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant AND g.session_id = v_session_id AND g.status = 'registered';

  RETURN jsonb_build_object(
    'status', v_final,
    'promoted', false,
    'registered', v_registered,
    'over_capacity', v_session.capacity IS NOT NULL AND v_registered > v_session.capacity,
    'seats_left', CASE
      WHEN v_session.capacity IS NULL THEN NULL
      ELSE GREATEST(v_session.capacity - v_registered, 0)
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_session_signup_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_session_signup_set(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_session_signup_set(jsonb) IS
  'Zapis, awans albo wypisanie uczestnika przez organizatora: {"session_id":uuid,"user_id":uuid,"status":"registered|waitlist|cancelled","force":bool}. Prog warstwy obowiazuje; przekroczenie limitu wymaga force i widac je w raporcie kolizji. Bramka: assert_editor_tenant().';
