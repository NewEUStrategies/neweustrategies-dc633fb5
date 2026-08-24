-- ============================================================================
-- Event Builder, etap 8: GIELDA SPOTKAN BIZNESOWYCH 1-1
--                       (dostepnosc, stoliki, zaproszenia, potwierdzenia)
--
-- STAN PRZED
--
-- Platforma ma JEDEN tryb spotkan 1-1: `meeting_slots` + `meeting_bookings`
-- z migracji 20260728090000. Host (uzytkownik z kontem) publikuje wlasne okna,
-- uczestnik rezerwuje jedno z nich, potwierdzenie jest natychmiastowe. To model
-- "godziny konsultacyjne eksperta" i dla widgetu `meeting-booking` jest
-- poprawny. Dla kongresu jest bezuzyteczny, i to z pieciu niezaleznych powodow:
--
--   1. WYMAGA KONTA. `meeting_slots.host_user_id` i
--      `meeting_bookings.attendee_user_id` celuja w `auth.users`. Uczestnik
--      kongresu jest wierszem `event_people` + `event_registrations`
--      (20260823150000) i konta miec NIE MUSI - a to wlasnie ci ludzie chca sie
--      spotkac.
--   2. NIE MA DRUGIEJ STRONY DECYZJI. Rezerwacja jest jednostronna
--      (`status IN ('confirmed','cancelled')`). Gielda kongresowa stoi na
--      ZAPROSZENIU, ktore druga strona przyjmuje albo odrzuca z powodem.
--   3. NIE MA ZASOBU. Spotkanie kongresowe odbywa sie PRZY STOLIKU, ktory jest
--      zasobem wspoldzielonym i skonczonym. `meeting_slots.location` to wolny
--      text - nie da sie na nim policzyc obciazenia ani wymusic wylacznosci.
--   4. NIE MA SIATKI. Kazdy host wpisuje wlasne godziny, wiec dwoch uczestnikow
--      nigdy nie ma wspolnego terminu poza przypadkiem.
--   5. KLUCZ OBCY DO WYDARZENIA JEST POJEDYNCZY (`event_id -> events(id)`),
--      wiec wiersz najemcy A moze wskazac wydarzenie najemcy B. Fundament
--      pod klucze zlozone powstal dopiero w 20260823135000.
--
-- Rozszerzanie tamtych dwoch tabel oznaczaloby wiec: zdjecie NOT NULL z hosta,
-- dodanie drugiej strony decyzji, dodanie zasobu, dodanie siatki i przepisanie
-- kluczy obcych - czyli inna tabele pod ta sama nazwa, z polityklami i RPC
-- napisanymi dla poprzedniego modelu. Dlatego gielda kongresowa dostaje wlasne
-- tabele, a `meeting_slots` zostaje nietkniete: widget `meeting-booking` dalej
-- dziala, a dwa tryby zyja obok siebie, bo opisuja dwie rozne rzeczy.
--
-- STAN PO. Szesc tabel i dwadziescia piec funkcji:
--
--   * `event_meeting_tables`      - stoliki wydarzenia: etykieta, strefa,
--                                   pojemnosc (ile spotkan ROWNOLEGLE),
--                                   aktywnosc, kolejnosc, opcjonalne
--                                   dowiazanie do sali agendy.
--   * `event_meeting_settings`    - JEDEN wiersz na wydarzenie: siatka slotow
--                                   (dlugosc, przerwa, godziny, dni, strefa),
--                                   okno otwarcia gieldy, limity, regula
--                                   widocznosci.
--   * `event_meeting_rule_groups` - grupy uczestnikow po stronie zapraszajacego
--                                   i zaproszonego dla reguly `groups`.
--   * `event_meeting_availability`- okna dostepnosci uczestnika, przedzialy
--                                   rozlaczne z mocy ograniczenia EXCLUDE.
--   * `event_meetings`            - spotkanie: dwie strony, przedzial, stolik
--                                   z numerem miejsca, siedem stanow, powod
--                                   odmowy, slad decyzji, slad przelozenia.
--   * `event_meeting_attendees`   - TABELA POCHODNA, jeden uczestnik na wiersz.
--                                   Nosnik ograniczenia "jeden czlowiek nie ma
--                                   dwoch spotkan w tym samym czasie".
--
-- DLACZEGO TAK
--
-- A) OGRANICZENIA CZASOWE SA PRAWEM BAZY, NIE KODU. Cztery kolizje, ktore
--    w gieldzie spotkan zdarzaja sie NAPRAWDE (dwie osoby akceptuja zaproszenia
--    na ten sam stolik w tej samej sekundzie), zamkniete sa indeksem, nie
--    warunkiem w RPC:
--      * `event_meetings_table_no_overlap` - EXCLUDE USING gist po
--        (tenant, stolik, MIEJSCE przy stoliku, przedzial). Jedno miejsce nie
--        obsluguje dwoch zajetych spotkan w tym samym czasie.
--      * `event_meeting_attendees_no_overlap` - EXCLUDE USING gist po
--        (tenant, zapis uczestnika, przedzial). Jeden czlowiek nie ma dwoch
--        zajetych spotkan w tym samym czasie.
--      * `event_meeting_availability_no_overlap` - EXCLUDE USING gist po
--        (tenant, zapis uczestnika, przedzial). Okna jednego uczestnika sie nie
--        nakladaja.
--      * `event_meetings_pair_slot_uniq` - indeks unikalny czesciowy po parze
--        znormalizowanej i godzinie startu. Jedna para nie ma dwoch aktywnych
--        zaproszen na ten sam termin.
--    RPC sprawdza kazdy z tych warunkow WCZESNIEJ i zwraca czytelny blad, ale
--    to jest uprzejmosc dla czlowieka, nie mechanizm poprawnosci. Mechanizmem
--    jest indeks - bo tylko on obowiazuje takze przy wyscigu dwoch transakcji,
--    przy imporcie i przy `COPY`.
--
-- B) DLACZEGO TABELA POCHODNA UCZESTNICTWA. Uczestnik wystepuje w spotkaniu
--    w DWOCH kolumnach: `requester_registration_id` i
--    `invitee_registration_id`. EXCLUDE porownuje kolumne z ta sama kolumna,
--    wiec na `event_meetings` NIE DA SIE zapisac warunku "ten czlowiek, w tej
--    lub tamtej roli, nie ma juz spotkania w tym czasie" - ograniczenie
--    wylapaloby wylacznie kolizje zaproszajacego z zaproszajacym i zaproszonego
--    z zaproszonym, a przegapiloby dokladnie ten przypadek, ktory zdarza sie
--    najczesciej: A zaprosil B na 10:00, C zaprosil B na 10:00.
--
--    Rozwazone i odrzucone alternatywy:
--      * TRIGGER LICZACY KOLIZJE. Odrzucony: dwie rownolegle transakcje NIE
--        WIDZA SIEBIE (izolacja READ COMMITTED), wiec oba triggery policza zero
--        kolizji i oba zapisza. Trigger daje uprzejmy komunikat, nie gwarancje.
--      * DWA WIERSZE W `event_meetings` (po jednym na strone). Odrzucony:
--        spotkanie przestaje byc jednym faktem, kazda zmiana statusu musi
--        dotknac dwoch wierszy, a rozjazd miedzy nimi jest niewidoczny.
--      * OGRANICZENIE NA WYRAZENIU `unnest(ARRAY[a,b])`. Nie istnieje - EXCLUDE
--        dziala na wierszu, nie na zbiorze wierszy z jednego wiersza.
--    Tabela pochodna rozklada spotkanie na dwa wiersze uczestnictwa, kazdy
--    z jednym czlowiekiem, i dopiero na niej EXCLUDE wyraza to, co mial wyrazic.
--    Utrzymuje ja trigger `event_meetings_sync_attendees` (AFTER INSERT/UPDATE
--    na spotkaniu; usuniecie idzie kaskada klucza obcego), a nie aplikacja -
--    inaczej kazda nowa sciezka zapisu musialaby pamietac o dwoch wierszach.
--    Stan i przedzial sa w tabeli pochodnej ZDUBLOWANE swiadomie: warunek
--    czesciowy ograniczenia EXCLUDE musi czytac kolumny TEJ tabeli.
--
-- C) MIEJSCE PRZY STOLIKU, NIE SAM STOLIK. `event_meeting_tables.capacity`
--    mowi, ile spotkan idzie przy tym miejscu ROWNOLEGLE (stolik dwuosobowy:
--    jedno; przestrzen "Strefa B" z szescioma stanowiskami: szesc). EXCLUDE
--    nie umie powiedziec "najwyzej N", umie powiedziec "najwyzej jedno na
--    klucz" - dlatego spotkanie niesie `table_seat`, numer miejsca w zakresie
--    1..capacity, przydzielany PRZY AKCEPTACJI (nie przy tworzeniu stolika,
--    bo do akceptacji nie wiadomo, czy spotkanie w ogole bedzie). Dla stolika
--    o pojemnosci 1 ograniczenie degeneruje sie dokladnie do wymogu "jeden
--    stolik, jedno spotkanie w danym czasie".
--
-- D) SIATKA SLOTOW JEST KONFIGURACJA, NIE TABELA WIERSZY. Kongres trzydniowy
--    z siatka co 20 minut od 9:00 do 17:00 to 72 sloty na dzien i 216 na
--    wydarzenie - wygenerowanie ich jako wierszy nic nie daje (nikt nie edytuje
--    slotu pojedynczo), a kazda zmiana dlugosci slotu wymagalaby przeliczenia
--    calej tabeli i decyzji, co zrobic ze spotkaniami w starej siatce.
--    Siatka jest wiec szescioma kolumnami konfiguracji, a lista wolnych
--    terminow liczy ja `generate_series` w JEDNYM zapytaniu.
--
-- E) TERMIN WYGASNIECIA JEST ZAPISANY, NIE LICZONY. `expires_at` powstaje przy
--    tworzeniu zaproszenia z `invite_expires_after_hours`. Gdyby byl liczony
--    z reguly przy kazdym odczycie, zmiana reguly uniewaznialaby zaproszenia
--    juz wyslane - a to znaczy, ze uczestnik traci zaproszenie z powodu, ktory
--    powstal po jego wyslaniu. Zmiana reguly dotyczy WYLACZNIE nowych zaproszen.
--    Nie ma za to stanu `expired`: zaproszenie wygasle to `status = 'invited'
--    AND expires_at < now()`, czyli stan LICZONY z danych. Osobny stan
--    wymagalby procesu, ktory go nadaje - a stan, ktorego nic nie zapisuje,
--    jest bledem, nie funkcja.
--
-- F) SIEDEM STANOW, KAZDY Z PISZACA GO SCIEZKA. `invited` (event_meeting_invite),
--    `accepted` / `declined` (event_meeting_respond), `cancelled`
--    (event_meeting_cancel, admin_event_meeting_set_status), `rescheduled`
--    (event_meeting_reschedule), `held` / `no_show`
--    (admin_event_meeting_set_status). Zaden stan nie jest ozdoba.
--
-- IZOLACJA NAJEMCOW
--
--   * Kazda z szesciu tabel ma `tenant_id uuid NOT NULL REFERENCES tenants`.
--   * Kazde dowiazanie do wydarzenia jest KLUCZEM ZLOZONYM
--     `(tenant_id, event_id) -> events (tenant_id, id)` - fundament
--     z 20260823135000. Kazde dowiazanie do zapisu uczestnika, stolika,
--     grupy, sponsora i spotkania jest kluczem POTROJNYM
--     `(tenant_id, event_id, X_id)`, wiec wiersz nie moze wskazac obiektu
--     innego wydarzenia ANI innego najemcy. Zaproszenie miedzy uczestnikami
--     dwoch roznych wydarzen jest w tym schemacie NIEWYRAZALNE - nie dlatego,
--     ze RPC go nie zapisze, ale dlatego, ze klucz obcy go nie przyjmie.
--   * RLS wlaczony na wszystkich szesciu tabelach. Polityki sa WYLACZNIE
--     odczytowe: stafowa w tenancie domowym (`current_tenant_id()`) i stronowa
--     (uczestnik widzi wiersze, w ktorych sam wystepuje, TAKZE zwiazane
--     z tenantem). Zapis nie ma zadnej polityki klienckiej - kazda mutacja idzie
--     przez RPC SECURITY DEFINER. Brak polityki to stan pozadany, nie luka.
--   * Plaszczyzna administracyjna: `assert_editor_tenant()` (admin ALBO editor
--     w tenancie DOMOWYM), nigdy naglowek hosta.
--   * Plaszczyzna uczestnika: `public_tenant_id()` (naglowek hosta), i w zadnym
--     ciele nie wystepuje razem z `has_role()`/`is_staff()` - bramka
--     `check:sql-tenant-scope` nie ma czego zapalic.
--   * `anon` NIE DOSTAJE ZADNEGO GRANTU na tych tabelach ani na tych funkcjach
--     uczestnika, ktore czytaja ludzi. Spotkanie biznesowe jest z definicji
--     miedzy dwiema znanymi osobami; nie ma sciezki, na ktorej lista spotkan
--     albo lista nazwisk mialaby wyjsc do niezalogowanego swiata.
--
-- FORWARD-ONLY I IDEMPOTENTNOSC. `CREATE TABLE IF NOT EXISTS`, ograniczenia
-- EXCLUDE dokladane blokami `DO $$ ... $$` po `pg_constraint`, polityki
-- i triggery w schemacie `DROP IF EXISTS` + `CREATE`, funkcje
-- `DROP FUNCTION IF EXISTS` z pelna sygnatura + `CREATE FUNCTION`. Powtorny
-- przebieg nie psuje danych.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Rozszerzenie btree_gist
--
-- Ograniczenia EXCLUDE tego modulu porownuja `uuid` i `integer` operatorem `=`
-- W INDEKSIE GiST, a klasy operatorow dla typow btree-owych w GiST wnosi
-- wlasnie btree_gist. Schemat wybieramy dynamicznie: hostowany Supabase trzyma
-- rozszerzenia w `extensions`, lokalna baza CI moze go nie miec. Blok jest
-- powtorzeniem tego z 20260823140000 - powtorzonym swiadomie, bo migracja musi
-- dac sie wykonac takze w oderwaniu od poprzedniczki.
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
-- 1) STOLIKI I MIEJSCA SPOTKAN
--
-- Stolik nalezy do WYDARZENIA, nie do organizacji: "Stolik 12" na kongresie
-- marcowym i "Stolik 12" na kongresie listopadowym to dwa rozne stoliki w dwoch
-- roznych budynkach, a wspolny katalog kazalby redaktorowi rozstrzygac, ktory
-- jest ktory, przy kazdym przydziale.
--
-- `capacity` to LICZBA SPOTKAN ROWNOLEGLE przy tym miejscu, nie liczba krzesel.
-- Stolik dwuosobowy ma pojemnosc 1. Przestrzen "Strefa B" z szescioma
-- stanowiskami ma pojemnosc 6 i obsluguje szesc spotkan naraz. To rozroznienie
-- jest jedynym powodem, dla ktorego spotkanie niesie numer miejsca
-- (`table_seat`) - patrz punkt C naglowka.
--
-- `room_id` wiaze stolik z sala agendy (20260823140000), gdy gielda dzieje sie
-- w tej samej sali co sesje. Klucz jest POTROJNY, wiec stolik kongresu
-- marcowego nie wskaze sali kongresu listopadowego. Zachowanie przy usunieciu
-- sali to NO ACTION (domyslne): SET NULL na kluczu zlozonym zeruje WSZYSTKIE
-- kolumny klucza (w tym `tenant_id NOT NULL`), a CASCADE usuwalby stoliki przy
-- usunieciu sali. Panel dostaje czysty komunikat wczesniej - sala z sesjami
-- i tak nie da sie usunac (`room_in_use` w admin_event_room_delete).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_meeting_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  label text NOT NULL,
  zone text,
  capacity integer NOT NULL DEFAULT 1,
  room_id uuid,
  note text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_meeting_tables_label_len
    CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  CONSTRAINT event_meeting_tables_zone_len
    CHECK (zone IS NULL OR char_length(btrim(zone)) BETWEEN 1 AND 120),
  CONSTRAINT event_meeting_tables_note_len
    CHECK (note IS NULL OR char_length(note) <= 300),
  -- Gorna granica to 50 rownoleglych spotkan przy jednym wpisie. Wartosc
  -- wyzsza znaczy, ze redaktor opisal cala hale jako jedno "miejsce" - a wtedy
  -- traci sens jedyna rzecz, ktora stolik wnosi: mozliwosc powiedzenia
  -- uczestnikowi, GDZIE ma sie stawic.
  CONSTRAINT event_meeting_tables_capacity_range CHECK (capacity BETWEEN 1 AND 50),
  CONSTRAINT event_meeting_tables_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_meeting_tables_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_meeting_tables_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_meeting_tables_room_fk FOREIGN KEY (tenant_id, event_id, room_id)
    REFERENCES public.event_rooms (tenant_id, event_id, id)
);

COMMENT ON TABLE public.event_meeting_tables IS
  'Stoliki i miejsca spotkan jednego wydarzenia. Etykieta jest jednojezyczna (nazwa wlasna miejsca). Zapis wylacznie przez admin_event_meeting_table_save.';
COMMENT ON COLUMN public.event_meeting_tables.capacity IS
  'Ile spotkan idzie przy tym miejscu ROWNOLEGLE (nie: ile krzesel). Wyznacza zakres numeru miejsca event_meetings.table_seat: 1..capacity.';
COMMENT ON COLUMN public.event_meeting_tables.zone IS
  'Strefa albo lokalizacja ("Hala 2, poziom 3"). Jednojezyczna z tego samego powodu co etykieta: to nazwa wlasna miejsca, nie tekst redakcyjny.';
COMMENT ON COLUMN public.event_meeting_tables.room_id IS
  'Opcjonalne dowiazanie do sali agendy (event_rooms). Klucz potrojny (tenant_id, event_id, room_id) - sala musi nalezec do TEGO wydarzenia.';
COMMENT ON COLUMN public.event_meeting_tables.is_active IS
  'Wylaczony stolik znika z przydzialu nowych spotkan, ale NIE zabiera stolika spotkaniom juz potwierdzonym. Dlatego wylaczenie jest osobna operacja od usuniecia.';

-- Dwa stoliki o tej samej etykiete w jednym wydarzeniu sa bledem redakcyjnym,
-- ktorego nie da sie odroznic w selekcie. Porownanie po `lower(btrim(...))`,
-- bo "Stolik 12" i "stolik 12 " to ten sam stolik.
CREATE UNIQUE INDEX IF NOT EXISTS event_meeting_tables_event_label_uniq
  ON public.event_meeting_tables (tenant_id, event_id, lower(btrim(label)));

CREATE INDEX IF NOT EXISTS event_meeting_tables_event_order_idx
  ON public.event_meeting_tables (tenant_id, event_id, sort_order, label);
CREATE INDEX IF NOT EXISTS event_meeting_tables_room_idx
  ON public.event_meeting_tables (tenant_id, event_id, room_id)
  WHERE room_id IS NOT NULL;

DROP TRIGGER IF EXISTS event_meeting_tables_touch_updated_at ON public.event_meeting_tables;
CREATE TRIGGER event_meeting_tables_touch_updated_at
  BEFORE UPDATE ON public.event_meeting_tables
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ANON NIE DOSTAJE GRANTU. Rozklad stolikow to informacja operacyjna wydarzenia
-- zamknietego; uczestnik dowiaduje sie o swoim stoliku z wlasnego spotkania
-- (event_meetings_mine), nie z listy calego budynku.
GRANT SELECT ON public.event_meeting_tables TO authenticated;
GRANT ALL ON public.event_meeting_tables TO service_role;

ALTER TABLE public.event_meeting_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_meeting_tables_staff_read" ON public.event_meeting_tables;
CREATE POLICY "event_meeting_tables_staff_read"
  ON public.event_meeting_tables FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );
-- Zapis: BRAK polityki klienckiej (admin_event_meeting_table_save / _delete).

-- ----------------------------------------------------------------------------
-- 2) USTAWIENIA GIELDY: SIATKA SLOTOW, OKNO OTWARCIA, LIMITY, WIDOCZNOSC
--
-- JEDEN WIERSZ NA WYDARZENIE (UNIQUE (tenant_id, event_id)). Brak wiersza znaczy
-- "gielda nieskonfigurowana" i jest stanem POCZATKOWYM kazdego wydarzenia -
-- wszystkie RPC uczestnika odmawiaja wtedy bledem `meetings_disabled`. To
-- swiadomie NIE jest wiersz zakladany triggerem przy tworzeniu wydarzenia:
-- wiekszosc wydarzen (webinar, briefing) gieldy nie ma i nigdy miec nie bedzie,
-- a wiersz z domyslami sugerowalby w panelu funkcje, ktorej nikt nie wlaczyl.
--
-- SIATKA: `slot_minutes` + `break_minutes` + `day_start_time` + `day_end_time`
-- + `meeting_days` + `timezone`. Sloty licza sie od `day_start_time` krokiem
-- `slot_minutes + break_minutes`, a ostatni slot musi zmiescic sie CALY przed
-- `day_end_time`. Przerwa jest osobna kolumna, a nie doliczona do dlugosci:
-- uczestnik widzi na karcie "20 minut", a nie "25 minut, z czego 5 na dojscie".
--
-- `timezone` jest tu, a nie brane z `events.timezone`, bo gielda moze dzialac
-- w innej strefie niz wydarzenie (kongres w Brukseli obslugujacy uczestnikow
-- online z Warszawy ustawia godziny gieldy w strefie miejsca, nie w strefie
-- rejestracji). Domyslna wartosc jest ta sama, wiec typowy przypadek nie wymaga
-- decyzji.
--
-- `meeting_days` to `date[]`, a nie zakres dat, bo kongres trzydniowy z jednym
-- dniem bez gieldy (dzien wizyt studyjnych) jest normalny, a zakres tego nie
-- wyrazi. Tablica dat NIE moze byc kluczem obcym do niczego, wiec nie tworzy
-- dziury w izolacji: to wartosci skalarne wiersza, a nie wskazniki na inne
-- wiersze. Dokladnie odwrotnie niz w przypadku grup - patrz punkt 3.
--
-- LIMITY sa dwa i oba egzekwowane W BAZIE przy tworzeniu zaproszenia:
--   * `max_invites_per_person` - ile AKTYWNYCH zaproszen (wyslanych, jeszcze
--     nierozstrzygnietych plus przyjetych) moze miec jeden uczestnik. Chroni
--     przed uczestnikiem, ktory wysyla zaproszenie do calej listy.
--   * `max_meetings_per_day` - ile ZAJETYCH spotkan moze miec uczestnik
--     w jednym dniu gieldy. Chroni przed dniem bez przerwy na oddech, ktory
--     konczy sie seria nieobecnosci.
-- NULL w obu znaczy "bez limitu" - i to jest inna odpowiedz niz zero.
--
-- WIDOCZNOSC GIELDY ma cztery wartosci i kazda jest egzekwowana przez
-- `_event_meeting_can_invite`:
--   * `everyone`              - kazdy uczestnik, ktorego grupa pozwala na
--                               spotkania, moze zaprosic kazdego takiego.
--   * `groups`                - wylacznie z grup wskazanych jako strona
--                               zapraszajaca do grup wskazanych jako strona
--                               zaproszona (tabela event_meeting_rule_groups).
--   * `sponsors_to_attendees` - zaprasza WYLACZNIE uczestnik z grupy
--                               o uprawnieniu `can_lead_retrieval` (czyli
--                               przedstawiciel firmy partnerskiej - to jedyna
--                               kolumna w event_groups, ktora ta role opisuje
--                               DANYMI, a nie nazwa grupy).
--   * `disabled`              - gielda wylaczona regula, mimo dzialajacej
--                               konfiguracji. Rozne od `is_enabled = false`:
--                               tam gielda jest nieskonfigurowana, tu jest
--                               skonfigurowana i zamknieta na czas trwania.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_meeting_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  slot_minutes integer NOT NULL DEFAULT 20,
  break_minutes integer NOT NULL DEFAULT 5,
  day_start_time time NOT NULL DEFAULT '09:00',
  day_end_time time NOT NULL DEFAULT '17:00',
  meeting_days date[] NOT NULL DEFAULT '{}'::date[],
  timezone text NOT NULL DEFAULT 'Europe/Warsaw',
  invites_open_at timestamptz,
  invites_close_at timestamptz,
  max_invites_per_person integer,
  max_meetings_per_day integer,
  invite_expires_after_hours integer NOT NULL DEFAULT 72,
  visibility text NOT NULL DEFAULT 'everyone',
  intro_pl text NOT NULL DEFAULT '',
  intro_en text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Slot krotszy niz 5 minut nie jest spotkaniem, dluzszy niz 4 godziny nie
  -- jest slotem gieldy.
  CONSTRAINT event_meeting_settings_slot_range CHECK (slot_minutes BETWEEN 5 AND 240),
  CONSTRAINT event_meeting_settings_break_range CHECK (break_minutes BETWEEN 0 AND 120),
  CONSTRAINT event_meeting_settings_day_order CHECK (day_end_time > day_start_time),
  -- Dzien gieldy musi zmiescic co najmniej JEDEN caly slot. Konfiguracja
  -- "sloty 60-minutowe, gielda 9:00-9:30" nie zaproponowalaby nigdy niczego,
  -- a redaktor zobaczylby pusta liste i szukal bledu w danych uczestnikow.
  CONSTRAINT event_meeting_settings_day_fits_slot
    CHECK ((day_end_time - day_start_time) >= make_interval(mins => slot_minutes)),
  CONSTRAINT event_meeting_settings_days_bounded CHECK (cardinality(meeting_days) <= 30),
  CONSTRAINT event_meeting_settings_days_not_null
    CHECK (array_position(meeting_days, NULL::date) IS NULL),
  CONSTRAINT event_meeting_settings_timezone_len
    CHECK (char_length(btrim(timezone)) BETWEEN 2 AND 64),
  CONSTRAINT event_meeting_settings_invites_window
    CHECK (invites_open_at IS NULL OR invites_close_at IS NULL OR invites_close_at > invites_open_at),
  CONSTRAINT event_meeting_settings_max_invites_positive
    CHECK (max_invites_per_person IS NULL OR max_invites_per_person > 0),
  CONSTRAINT event_meeting_settings_max_daily_positive
    CHECK (max_meetings_per_day IS NULL OR max_meetings_per_day > 0),
  -- Godzina to dolna granica sensu (zaproszenie z krotszym terminem wygasa,
  -- zanim czlowiek zdazy je przeczytac), trzydziesci dni to gorna.
  CONSTRAINT event_meeting_settings_expiry_range
    CHECK (invite_expires_after_hours BETWEEN 1 AND 720),
  CONSTRAINT event_meeting_settings_visibility_values CHECK (visibility IN (
    'everyone', 'groups', 'sponsors_to_attendees', 'disabled'
  )),
  CONSTRAINT event_meeting_settings_intro_pl_len CHECK (char_length(intro_pl) <= 1000),
  CONSTRAINT event_meeting_settings_intro_en_len CHECK (char_length(intro_en) <= 1000),
  -- Gielda WLACZONA bez ani jednego dnia nie zaproponuje zadnego terminu.
  -- To jest stan niemozliwy do zauwazenia w panelu (przelacznik na "wlaczone",
  -- lista terminow pusta), wiec baza go nie przyjmuje.
  CONSTRAINT event_meeting_settings_enabled_needs_days
    CHECK (NOT is_enabled OR cardinality(meeting_days) > 0),
  CONSTRAINT event_meeting_settings_event_unique UNIQUE (tenant_id, event_id),
  CONSTRAINT event_meeting_settings_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_meeting_settings_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_meeting_settings IS
  'Konfiguracja gieldy spotkan JEDNEGO wydarzenia: siatka slotow, okno otwarcia na zaproszenia, limity i regula widocznosci. Brak wiersza = gielda nieskonfigurowana. Zapis wylacznie przez admin_event_meeting_settings_save.';
COMMENT ON COLUMN public.event_meeting_settings.is_enabled IS
  'Gielda dziala. Rozne od visibility = disabled: tam gielda jest skonfigurowana i zamknieta regula, tu jest wylaczona jako funkcja wydarzenia.';
COMMENT ON COLUMN public.event_meeting_settings.break_minutes IS
  'Przerwa MIEDZY slotami, osobno od dlugosci slotu. Krok siatki to slot_minutes + break_minutes; uczestnik widzi na karcie dlugosc slotu, nie krok.';
COMMENT ON COLUMN public.event_meeting_settings.meeting_days IS
  'Konkretne dni gieldy, nie zakres: kongres trzydniowy z jednym dniem bez gieldy jest normalny, a zakres tego nie wyrazi.';
COMMENT ON COLUMN public.event_meeting_settings.timezone IS
  'Strefa, w ktorej liczy sie day_start_time i day_end_time. Osobna od events.timezone, bo gielda moze dzialac w strefie MIEJSCA, a wydarzenie sprzedawac bilety w strefie rejestracji.';
COMMENT ON COLUMN public.event_meeting_settings.invites_open_at IS
  'Od kiedy gielda przyjmuje zaproszenia. NULL = od razu. Rozne od meeting_days, ktore mowia, KIEDY spotkania sie odbywaja.';
COMMENT ON COLUMN public.event_meeting_settings.max_invites_per_person IS
  'Ile AKTYWNYCH zaproszen (wyslane nierozstrzygniete + przyjete) moze miec jeden uczestnik. NULL = bez limitu. Egzekwowane w event_meeting_invite.';
COMMENT ON COLUMN public.event_meeting_settings.max_meetings_per_day IS
  'Ile ZAJETYCH spotkan moze miec uczestnik w jednym dniu gieldy. NULL = bez limitu. Egzekwowane w event_meeting_invite i przy akceptacji.';
COMMENT ON COLUMN public.event_meeting_settings.invite_expires_after_hours IS
  'Ile godzin zyje zaproszenie. Wartosc jest KOPIOWANA do event_meetings.expires_at przy tworzeniu - zmiana reguly nie uniewaznia zaproszen juz wyslanych.';
COMMENT ON COLUMN public.event_meeting_settings.visibility IS
  'Kto moze zaprosic kogo: everyone / groups (event_meeting_rule_groups) / sponsors_to_attendees (grupa z can_lead_retrieval) / disabled.';

CREATE INDEX IF NOT EXISTS event_meeting_settings_enabled_idx
  ON public.event_meeting_settings (tenant_id, is_enabled)
  WHERE is_enabled;

DROP TRIGGER IF EXISTS event_meeting_settings_touch_updated_at ON public.event_meeting_settings;
CREATE TRIGGER event_meeting_settings_touch_updated_at
  BEFORE UPDATE ON public.event_meeting_settings
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_meeting_settings TO authenticated;
GRANT ALL ON public.event_meeting_settings TO service_role;

ALTER TABLE public.event_meeting_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_meeting_settings_staff_read" ON public.event_meeting_settings;
CREATE POLICY "event_meeting_settings_staff_read"
  ON public.event_meeting_settings FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );
-- Uczestnik czyta siatke przez event_meeting_exchange(), nie wprost - dlatego
-- nie ma tu polityki uczestnika. Wiersz niesie limity i regule widocznosci,
-- czyli informacje o TAKTYCE organizatora, a nie o wlasnym terminarzu.

-- ----------------------------------------------------------------------------
-- 3) GRUPY W REGULE WIDOCZNOSCI
--
-- Projekt modulu (docs, par. 4.14) zakladal `requester_group_ids uuid[]`
-- i `invitee_group_ids uuid[]` na wierszu reguly. Odrzucone: TABLICA UUID-OW
-- NIE MOZE BYC KLUCZEM OBCYM. Regula z tablica przezylaby usuniecie grupy jako
-- wskaznik w nikad (i cicho przestalaby wpuszczac kogokolwiek), a co gorsza
-- przyjelaby identyfikator grupy z INNEGO wydarzenia albo innego najemcy - bo
-- nie ma mechanizmu, ktory by to sprawdzil. Tabela potomna z kluczem POTROJNYM
-- `(tenant_id, event_id, group_id)` zamyka oba przypadki na poziomie silnika,
-- a usuniecie grupy zabiera ze soba jej wiersze reguly kaskada.
--
-- `side` rozdziela dwie listy w jednej tabeli, zamiast dwoch tabel o identycznym
-- ksztalcie. Ta sama grupa moze wystapic po obu stronach (partnerzy zapraszaja
-- partnerow) i to jest poprawne - dlatego unikalnosc obejmuje `side`.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_meeting_rule_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  group_id uuid NOT NULL,
  side text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_meeting_rule_groups_side_values CHECK (side IN ('requester', 'invitee')),
  CONSTRAINT event_meeting_rule_groups_unique UNIQUE (tenant_id, event_id, group_id, side),
  CONSTRAINT event_meeting_rule_groups_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_meeting_rule_groups_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_meeting_rule_groups_group_fk
    FOREIGN KEY (tenant_id, event_id, group_id)
    REFERENCES public.event_groups (tenant_id, event_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_meeting_rule_groups IS
  'Grupy uczestnikow po stronie zapraszajacej i zaproszonej dla reguly widocznosci `groups`. Klucz potrojny do event_groups - grupa musi nalezec do TEGO wydarzenia. Zapis wsadowo przez admin_event_meeting_settings_save.';
COMMENT ON COLUMN public.event_meeting_rule_groups.side IS
  'requester = grupa, ktora WOLNO zapraszac; invitee = grupa, ktora WOLNO zaprosic. Ta sama grupa moze wystapic po obu stronach.';

CREATE INDEX IF NOT EXISTS event_meeting_rule_groups_event_side_idx
  ON public.event_meeting_rule_groups (tenant_id, event_id, side, group_id);

GRANT SELECT ON public.event_meeting_rule_groups TO authenticated;
GRANT ALL ON public.event_meeting_rule_groups TO service_role;

ALTER TABLE public.event_meeting_rule_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_meeting_rule_groups_staff_read" ON public.event_meeting_rule_groups;
CREATE POLICY "event_meeting_rule_groups_staff_read"
  ON public.event_meeting_rule_groups FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );
-- Zapis: BRAK polityki klienckiej (admin_event_meeting_settings_save).

-- ----------------------------------------------------------------------------
-- 4) OKNA DOSTEPNOSCI UCZESTNIKA
--
-- PODMIOTEM JEST ZAPIS NA WYDARZENIE (`event_registrations`), nie osoba
-- (`event_people`) i nie konto (`auth.users`). Trzy powody, po kolei:
--   * `event_people` ma `UNIQUE (tenant_id, id)` BEZ `event_id`, wiec klucz
--     obcy do kartoteki nie potrafilby zagwarantowac, ze okno dostepnosci
--     nalezy do kogos zapisanego na TO wydarzenie. `event_registrations` ma
--     `UNIQUE (tenant_id, event_id, id)`, wiec klucz potrojny daje te gwarancje
--     jednym wierszem deklaracji.
--   * Ta sama osoba bywa zapisana na dwa wydarzenia i ma na nich rozna
--     dostepnosc. Klucz po osobie mieszalby oba terminarze.
--   * Uczestnik BEZ KONTA istnieje (`event_people.user_id IS NULL`), a jego
--     dostepnosc wpisuje organizator. Klucz po `auth.users` odcialby te sciezke.
--
-- `is_open` odpowiada na pytanie inne niz istnienie okna: uczestnik moze
-- zadeklarowac, ze JEST na miejscu 14:00-16:00, ale NIE PRZYJMUJE wtedy
-- zaproszen (jest na panelu, ktory prowadzi). Okno zamkniete nadal blokuje
-- nakladanie sie okien - bo dwa sprzeczne oswiadczenia o tym samym czasie sa
-- bledem niezaleznie od tego, czy ktores z nich przyjmuje zaproszenia.
--
-- OGRANICZENIE EXCLUDE JEST BEZWARUNKOWE (bez klauzuli WHERE). Przedzialy
-- jednego uczestnika nie moga sie nakladac - takze zamkniete z otwartymi.
-- Nakladajace sie okna dawalyby dwie sprzeczne odpowiedzi na pytanie "czy
-- o 15:00 przyjmujesz zaproszenia", a lista wolnych terminow musialaby
-- zgadywac, ktora jest wazna.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_meeting_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  time_range tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  is_open boolean NOT NULL DEFAULT true,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_meeting_availability_time_order CHECK (ends_at > starts_at),
  -- Kwadrans to dolna granica sensu (krotsze okno nie zmiesci zadnego slotu),
  -- szesnascie godzin gorna - okno dluzsze znaczy pomylke daty, nie deklaracje.
  CONSTRAINT event_meeting_availability_duration_range
    CHECK (ends_at - starts_at BETWEEN interval '15 minutes' AND interval '16 hours'),
  CONSTRAINT event_meeting_availability_note_len
    CHECK (note IS NULL OR char_length(note) <= 300),
  CONSTRAINT event_meeting_availability_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_meeting_availability_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_meeting_availability_registration_fk
    FOREIGN KEY (tenant_id, event_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_meeting_availability IS
  'Okna dostepnosci uczestnika na gieldzie spotkan. Podmiotem jest ZAPIS na wydarzenie, nie osoba - uzasadnienie w komentarzu nad tabela. Przedzialy jednego uczestnika sa rozlaczne z mocy ograniczenia EXCLUDE.';
COMMENT ON COLUMN public.event_meeting_availability.time_range IS
  'Przedzial polotwarty [starts_at, ends_at) - nosnik ograniczenia EXCLUDE i operatora zawierania @> przy sprawdzaniu, czy slot miesci sie w oknie.';
COMMENT ON COLUMN public.event_meeting_availability.is_open IS
  'Czy okno przyjmuje zaproszenia. Okno zamkniete nadal blokuje nakladanie sie okien: dwa sprzeczne oswiadczenia o tym samym czasie sa bledem niezaleznie od tej flagi.';

-- Lista wolnych terminow czyta okna po (najemca, zapis) i sprawdza zawieranie
-- przedzialu, wiec indeks GiST po (tenant_id, registration_id, time_range) jest
-- indeksem TEGO zapytania, a nie ozdoba. Klasa operatorow dla uuid przychodzi
-- z btree_gist, wiec indeks jest tworzony dynamicznie razem z ograniczeniem
-- EXCLUDE (blok nizej) - jedno przejscie po katalogu klas operatorow.
CREATE INDEX IF NOT EXISTS event_meeting_availability_registration_idx
  ON public.event_meeting_availability (tenant_id, registration_id, starts_at);
CREATE INDEX IF NOT EXISTS event_meeting_availability_event_idx
  ON public.event_meeting_availability (tenant_id, event_id, starts_at);

DROP TRIGGER IF EXISTS event_meeting_availability_touch_updated_at
  ON public.event_meeting_availability;
CREATE TRIGGER event_meeting_availability_touch_updated_at
  BEFORE UPDATE ON public.event_meeting_availability
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_meeting_availability TO authenticated;
GRANT ALL ON public.event_meeting_availability TO service_role;

ALTER TABLE public.event_meeting_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_meeting_availability_staff_read"
  ON public.event_meeting_availability;
CREATE POLICY "event_meeting_availability_staff_read"
  ON public.event_meeting_availability FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- Wlasne okna czyta sie przez zapis i kartoteke: uczestnik z kontem widzi
-- wiersze zapisu osoby dowiazanej do jego konta. Warunek tenanta jest tu
-- OBOWIAZKOWY, mimo ze lancuch przez kartoteke wyglada na wystarczajacy -
-- rodzenstwo na tej tabeli tenanta pilnuje, a asymetria "zapisywalne
-- w tenancie domowym, czytelne w dowolnym" to regresja z audytu 2026-08-03
-- na author_profiles.
DROP POLICY IF EXISTS "event_meeting_availability_self_read"
  ON public.event_meeting_availability;
CREATE POLICY "event_meeting_availability_self_read"
  ON public.event_meeting_availability FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND EXISTS (
      SELECT 1
      FROM public.event_registrations r
      JOIN public.event_people p
        ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      WHERE r.id = event_meeting_availability.registration_id
        AND r.tenant_id = event_meeting_availability.tenant_id
        AND p.user_id = (SELECT auth.uid())
    )
  );
-- Zapis: BRAK polityki klienckiej (event_meeting_availability_set / _delete).

-- ----------------------------------------------------------------------------
-- 4b) Rozlacznosc okien jednego uczestnika
--
-- Klasa operatorow `gist_uuid_ops` przychodzi z btree_gist, ktore w hostowanym
-- Supabase mieszka w schemacie `extensions` - a ten nie musi byc w search_path
-- w chwili wykonywania migracji. Dlatego nazwa klasy jest skladana dynamicznie
-- z katalogu, zamiast liczyc na sciezke wyszukiwania (wzorzec z 20260823140000).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_uuid_ops text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_meeting_availability'::regclass
      AND conname = 'event_meeting_availability_no_overlap'
  ) THEN
    RETURN;
  END IF;

  SELECT quote_ident(n.nspname) || '.gist_uuid_ops'
    INTO v_uuid_ops
  FROM pg_opclass oc
  JOIN pg_namespace n ON n.oid = oc.opcnamespace
  JOIN pg_am am ON am.oid = oc.opcmethod
  WHERE oc.opcname = 'gist_uuid_ops' AND am.amname = 'gist'
  LIMIT 1;

  IF v_uuid_ops IS NULL THEN
    RAISE EXCEPTION 'btree_gist_missing: klasa gist_uuid_ops nie istnieje - rozlacznosci okien nie da sie wymusic';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.event_meeting_availability '
    'ADD CONSTRAINT event_meeting_availability_no_overlap '
    'EXCLUDE USING gist (tenant_id %1$s WITH =, registration_id %1$s WITH =, time_range WITH &&)',
    v_uuid_ops
  );
END
$$;

COMMENT ON CONSTRAINT event_meeting_availability_no_overlap
  ON public.event_meeting_availability IS
  'Okna dostepnosci jednego uczestnika sa rozlaczne. Bezwarunkowo - takze okno zamkniete nie moze nachodzic na otwarte, bo to dwa sprzeczne oswiadczenia o tym samym czasie.';

-- ----------------------------------------------------------------------------
-- 5) SPOTKANIE
--
-- OBIE STRONY SA ZAPISAMI NA TO SAMO WYDARZENIE, i to jest wymuszone kluczami,
-- nie kodem: dwa klucze POTROJNE `(tenant_id, event_id, X_registration_id)`
-- celuja w `event_registrations (tenant_id, event_id, id)`. Zaproszenie miedzy
-- uczestnikami dwoch roznych wydarzen albo dwoch roznych najemcow jest w tym
-- schemacie NIEWYRAZALNE - nie dlatego, ze RPC go nie zapisze, ale dlatego, ze
-- klucz obcy go nie przyjmie. `event_meetings_no_self` domyka trzeci przypadek:
-- nie da sie zaprosic samego siebie.
--
-- PARA ZNORMALIZOWANA (`pair_low` / `pair_high`) istnieje, zeby wyrazic wymog
-- "jedna para nie ma dwoch aktywnych zaproszen na ten sam termin". Bez
-- normalizacji ten warunek jest niewyrazalny indeksem: (A zaprasza B) i
-- (B zaprasza A) to dwa rozne wiersze przy tych samych dwoch ludziach.
-- Kolumny sa GENERATED ... STORED, wiec nie da sie ich rozjechac z kolumnami
-- zrodlowymi, i nie da sie ich podac w INSERT.
--
-- STOLIK PRZYDZIELA SIE PRZY AKCEPTACJI, nie przy zaproszeniu. Zaproszenie
-- niepotwierdzone nie moze blokowac zasobu, bo w gieldzie kongresowej wieksza
-- czesc zaproszen nigdy nie zostaje przyjeta - blokowanie stolika na kazde
-- zaproszenie wyczerpuje budynek w pierwszej godzinie.
--
-- `expires_at` JEST ZAPISANY - patrz punkt E naglowka. Nigdy nie wypada po
-- rozpoczeciu spotkania: zaproszenie, ktore wygasa w trakcie spotkania, jest
-- absurdem, wiec RPC bierze `LEAST(now() + regula, starts_at)`.
--
-- `rescheduled_from_id` to SLAD PRZELOZENIA. Przelozenie nie jest zmiana
-- godziny w istniejacym wierszu, tylko zamknieciem starego spotkania
-- (`status = 'rescheduled'`) i utworzeniem nowego zaproszenia, ktore druga
-- strona musi przyjac. Powod: zmiana godziny bez zgody drugiej strony to nie
-- przelozenie, to jednostronne przestawienie cudzego kalendarza. Klucz jest
-- samozwrotny i POTROJNY, a jego zachowanie przy usunieciu to NO ACTION
-- (domyslne) - SET NULL na kluczu zlozonym zeruje takze `tenant_id NOT NULL`,
-- a CASCADE usuwalby spotkanie, ktore SIE ODBYLO, przy porzadkowaniu jego
-- odwolanego poprzednika.
--
-- `sponsor_id` wiaze spotkanie z przypieciem sponsora (20260823160000), czyli
-- odpowiada na pytanie "czego to spotkanie dotyczy" w jezyku danych, a nie
-- w wolnym tekscie. Klucz POTROJNY, wiec sponsor musi byc sponsorem TEGO
-- wydarzenia. `topic` zostaje jako wolny temat dla spotkan, ktore z zadna
-- oferta nie sa zwiazane.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  requester_registration_id uuid NOT NULL,
  invitee_registration_id uuid NOT NULL,
  pair_low uuid GENERATED ALWAYS AS
    (LEAST(requester_registration_id, invitee_registration_id)) STORED,
  pair_high uuid GENERATED ALWAYS AS
    (GREATEST(requester_registration_id, invitee_registration_id)) STORED,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  time_range tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  table_id uuid,
  table_seat integer,
  status text NOT NULL DEFAULT 'invited',
  topic text,
  sponsor_id uuid,
  invitation_message text,
  decline_reason text,
  expires_at timestamptz NOT NULL,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  responded_at timestamptz,
  responded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_side text,
  cancel_reason text,
  attendance_marked_at timestamptz,
  attendance_marked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rescheduled_from_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_meetings_no_self
    CHECK (requester_registration_id <> invitee_registration_id),
  CONSTRAINT event_meetings_time_order CHECK (ends_at > starts_at),
  CONSTRAINT event_meetings_duration_range
    CHECK (ends_at - starts_at BETWEEN interval '5 minutes' AND interval '4 hours'),
  CONSTRAINT event_meetings_status_values CHECK (status IN (
    'invited', 'accepted', 'declined', 'cancelled', 'rescheduled', 'held', 'no_show'
  )),
  -- Stolik bez numeru miejsca i numer miejsca bez stolika sa oba bez sensu:
  -- pierwszy nie wie, KTORE miejsce zajmuje, drugi nie wie, PRZY CZYM.
  CONSTRAINT event_meetings_seat_paired CHECK ((table_id IS NULL) = (table_seat IS NULL)),
  CONSTRAINT event_meetings_seat_positive CHECK (table_seat IS NULL OR table_seat >= 1),
  CONSTRAINT event_meetings_topic_len
    CHECK (topic IS NULL OR char_length(btrim(topic)) BETWEEN 2 AND 200),
  CONSTRAINT event_meetings_message_len
    CHECK (invitation_message IS NULL OR char_length(invitation_message) <= 1000),
  CONSTRAINT event_meetings_decline_reason_len
    CHECK (decline_reason IS NULL OR char_length(decline_reason) <= 1000),
  CONSTRAINT event_meetings_cancel_reason_len
    CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 1000),
  -- Odmowa BEZ POWODU jest dla drugiej strony nierozroznialna od ciszy, a to
  -- jedyna informacja, ktora pozwala jej sprobowac inaczej. Trzy znaki to
  -- prog minimalny, nie zachecajacy - reszte robi tekst pola w panelu.
  CONSTRAINT event_meetings_declined_has_reason CHECK (
    status <> 'declined'
    OR char_length(btrim(COALESCE(decline_reason, ''))) >= 3
  ),
  -- Kazdy stan koncowy jest DATOWANY. Slad decyzji bez daty nie da sie ulozyc
  -- w czasie, a to jedyne, do czego slad decyzji sluzy.
  CONSTRAINT event_meetings_responded_dated CHECK (
    status NOT IN ('accepted', 'declined', 'rescheduled') OR responded_at IS NOT NULL
  ),
  CONSTRAINT event_meetings_responder_dated
    CHECK (responded_by IS NULL OR responded_at IS NOT NULL),
  CONSTRAINT event_meetings_cancelled_dated
    CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CONSTRAINT event_meetings_cancelled_sided
    CHECK (cancelled_at IS NULL OR cancelled_side IS NOT NULL),
  CONSTRAINT event_meetings_cancelled_side_values CHECK (
    cancelled_side IS NULL OR cancelled_side IN ('requester', 'invitee', 'organiser')
  ),
  CONSTRAINT event_meetings_attendance_dated CHECK (
    status NOT IN ('held', 'no_show') OR attendance_marked_at IS NOT NULL
  ),
  -- Zaproszenie, ktore wygasa po rozpoczeciu spotkania, nie wygasa nigdy
  -- w sposob uzyteczny.
  CONSTRAINT event_meetings_expiry_before_start CHECK (expires_at <= starts_at),
  CONSTRAINT event_meetings_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_meetings_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_meetings_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_meetings_requester_fk
    FOREIGN KEY (tenant_id, event_id, requester_registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_meetings_invitee_fk
    FOREIGN KEY (tenant_id, event_id, invitee_registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_meetings_table_fk
    FOREIGN KEY (tenant_id, event_id, table_id)
    REFERENCES public.event_meeting_tables (tenant_id, event_id, id),
  CONSTRAINT event_meetings_sponsor_fk
    FOREIGN KEY (tenant_id, event_id, sponsor_id)
    REFERENCES public.event_sponsors (tenant_id, event_id, id) ON DELETE SET NULL,
  CONSTRAINT event_meetings_rescheduled_from_fk
    FOREIGN KEY (tenant_id, event_id, rescheduled_from_id)
    REFERENCES public.event_meetings (tenant_id, event_id, id)
);

COMMENT ON TABLE public.event_meetings IS
  'Spotkanie biznesowe 1-1 na gieldzie wydarzenia: dwie strony (zapisy na TO wydarzenie), przedzial czasu, stolik z numerem miejsca, siedem stanow, powod odmowy i slad decyzji. Zapis wylacznie przez RPC modulu.';
COMMENT ON COLUMN public.event_meetings.pair_low IS
  'Mniejszy identyfikator pary (GENERATED). Razem z pair_high nosnik indeksu event_meetings_pair_slot_uniq: (A zaprasza B) i (B zaprasza A) to ta sama para.';
COMMENT ON COLUMN public.event_meetings.time_range IS
  'Przedzial polotwarty [starts_at, ends_at) - nosnik ograniczenia EXCLUDE na kolizje miejsca przy stoliku i operatora && w raportach obciazenia.';
COMMENT ON COLUMN public.event_meetings.table_seat IS
  'Numer miejsca przy stoliku, 1..event_meeting_tables.capacity. Przydzielany PRZY AKCEPTACJI. Istnieje, bo EXCLUDE umie powiedziec "najwyzej jedno na klucz", a nie "najwyzej N".';
COMMENT ON COLUMN public.event_meetings.status IS
  'invited (zaproszenie wyslane) / accepted / declined / cancelled / rescheduled (przelozone na nowy wiersz) / held (odbylo sie) / no_show (nieobecnosc). Stan "wygasle" jest LICZONY: status = invited AND expires_at < now().';
COMMENT ON COLUMN public.event_meetings.expires_at IS
  'Termin waznosci zaproszenia, ZAPISANY przy tworzeniu z invite_expires_after_hours. Zmiana reguly nie uniewaznia zaproszen juz wyslanych. Nigdy po starcie spotkania (CHECK expiry_before_start).';
COMMENT ON COLUMN public.event_meetings.rescheduled_from_id IS
  'Spotkanie, ktorego to spotkanie jest przelozeniem. Przelozenie zamyka stary wiersz i tworzy nowy, bo zmiana godziny bez zgody drugiej strony nie jest przelozeniem.';
COMMENT ON COLUMN public.event_meetings.sponsor_id IS
  'Opcjonalne dowiazanie do przypiecia sponsora - "spotkanie dotyczy oferty tego partnera". Klucz potrojny: sponsor musi byc sponsorem TEGO wydarzenia.';
COMMENT ON COLUMN public.event_meetings.cancelled_side IS
  'Kto odwolal: requester / invitee / organiser. Bez tego nie da sie odroznic rezygnacji uczestnika od decyzji organizatora, a to dwie rozne rozmowy z klientem.';

-- Lista panelu: najemca, wydarzenie, stan, potem porzadek prezentacji.
CREATE INDEX IF NOT EXISTS event_meetings_event_status_idx
  ON public.event_meetings (tenant_id, event_id, status, starts_at);
-- "Moje spotkania" po obu stronach. Dwa indeksy, nie jeden po parze
-- znormalizowanej: pytanie brzmi "gdzie wystepuje TEN zapis", a nie "co jest
-- miedzy tymi dwoma", i planista musi umiec odpowiedziec na nie jednym seekiem
-- niezaleznie od roli.
CREATE INDEX IF NOT EXISTS event_meetings_requester_idx
  ON public.event_meetings (tenant_id, requester_registration_id, starts_at);
CREATE INDEX IF NOT EXISTS event_meetings_invitee_idx
  ON public.event_meetings (tenant_id, invitee_registration_id, starts_at);
CREATE INDEX IF NOT EXISTS event_meetings_table_idx
  ON public.event_meetings (tenant_id, table_id, starts_at)
  WHERE table_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_meetings_sponsor_idx
  ON public.event_meetings (tenant_id, event_id, sponsor_id)
  WHERE sponsor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_meetings_time_range_idx
  ON public.event_meetings USING gist (time_range);
-- Lista zaproszen do wygasniecia w panelu i w powiadomieniach ("wygasa za 6
-- godzin"). Warunek czesciowy odcina cala historie, ktora tego pytania nie
-- dotyczy.
CREATE INDEX IF NOT EXISTS event_meetings_expiring_idx
  ON public.event_meetings (tenant_id, event_id, expires_at)
  WHERE status = 'invited';

-- Jedna para uczestnikow nie ma DWOCH AKTYWNYCH zaproszen na ten sam termin.
-- Odrzucone, odwolane i przelozone nie liczy sie: po odmowie wolno zaprosic
-- ponownie na ten sam termin (moglo sie zmienic wszystko poza godzina).
CREATE UNIQUE INDEX IF NOT EXISTS event_meetings_pair_slot_uniq
  ON public.event_meetings (tenant_id, event_id, pair_low, pair_high, starts_at)
  WHERE status IN ('invited', 'accepted');

DROP TRIGGER IF EXISTS event_meetings_touch_updated_at ON public.event_meetings;
CREATE TRIGGER event_meetings_touch_updated_at
  BEFORE UPDATE ON public.event_meetings
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ANON NIE DOSTAJE GRANTU. Spotkanie biznesowe wiaze dwa nazwiska; nie ma
-- sciezki, na ktorej ta informacja mialaby wyjsc do niezalogowanego swiata.
GRANT SELECT ON public.event_meetings TO authenticated;
GRANT ALL ON public.event_meetings TO service_role;

ALTER TABLE public.event_meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_meetings_staff_read" ON public.event_meetings;
CREATE POLICY "event_meetings_staff_read"
  ON public.event_meetings FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- STRONA SPOTKANIA widzi swoj wiersz. JEDEN podzapytanie obejmuje obie role
-- (`r.id IN (requester, invitee)`), a nie dwa OR-y z dwoma osobnymi EXISTS-ami:
-- warunek jest wtedy jeden i nie da sie go rozjechac przy zmianie lancucha
-- kartoteki. Warunek tenanta obowiazkowy - patrz komentarz przy
-- availability_self_read.
DROP POLICY IF EXISTS "event_meetings_party_read" ON public.event_meetings;
CREATE POLICY "event_meetings_party_read"
  ON public.event_meetings FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND EXISTS (
      SELECT 1
      FROM public.event_registrations r
      JOIN public.event_people p
        ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      WHERE r.tenant_id = event_meetings.tenant_id
        AND r.id IN (
          event_meetings.requester_registration_id,
          event_meetings.invitee_registration_id
        )
        AND p.user_id = (SELECT auth.uid())
    )
  );
-- Zapis: BRAK polityki klienckiej (RPC modulu).

-- ----------------------------------------------------------------------------
-- 5b) Wylacznosc miejsca przy stoliku
--
-- Klucz ograniczenia to (najemca, stolik, MIEJSCE, przedzial). Dla stolika
-- o pojemnosci 1 degeneruje sie dokladnie do "jeden stolik, jedno spotkanie
-- w danym czasie". Dla stolika o pojemnosci 6 wpuszcza szesc spotkan naraz
-- i ani jednego wiecej, bo numery miejsc sa skonczone (walidacja
-- `table_seat <= capacity` w triggerze `event_meetings_validate`).
--
-- Warunek czesciowy obejmuje TRZY stany: `accepted` (termin zajety),
-- `held` i `no_show` (termin BYL zajety). Trzeci jest tu swiadomie: gdyby
-- oznaczenie nieobecnosci zwalnialo miejsce, organizator odznaczajacy
-- nieobecnosc otwieralby luke w przeszlosci, w ktora da sie wpisac drugie
-- spotkanie o tej samej godzinie. Historia obciazenia stolikow przestalaby
-- sie zgadzac z raportem.
--
-- `gist_int4_ops` (dla `table_seat`) i `gist_uuid_ops` wnosi btree_gist -
-- oba wyszukane w katalogu, nie w search_path.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_uuid_ops text;
  v_int4_ops text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_meetings'::regclass
      AND conname = 'event_meetings_table_no_overlap'
  ) THEN
    RETURN;
  END IF;

  SELECT quote_ident(n.nspname) || '.gist_uuid_ops'
    INTO v_uuid_ops
  FROM pg_opclass oc
  JOIN pg_namespace n ON n.oid = oc.opcnamespace
  JOIN pg_am am ON am.oid = oc.opcmethod
  WHERE oc.opcname = 'gist_uuid_ops' AND am.amname = 'gist'
  LIMIT 1;

  SELECT quote_ident(n.nspname) || '.gist_int4_ops'
    INTO v_int4_ops
  FROM pg_opclass oc
  JOIN pg_namespace n ON n.oid = oc.opcnamespace
  JOIN pg_am am ON am.oid = oc.opcmethod
  WHERE oc.opcname = 'gist_int4_ops' AND am.amname = 'gist'
  LIMIT 1;

  IF v_uuid_ops IS NULL OR v_int4_ops IS NULL THEN
    RAISE EXCEPTION 'btree_gist_missing: klasy gist_uuid_ops/gist_int4_ops nie istnieja - wylacznosci stolika nie da sie wymusic';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.event_meetings ADD CONSTRAINT event_meetings_table_no_overlap '
    'EXCLUDE USING gist ('
    'tenant_id %1$s WITH =, table_id %1$s WITH =, table_seat %2$s WITH =, time_range WITH &&'
    ') WHERE (table_id IS NOT NULL AND status IN (''accepted'', ''held'', ''no_show''))',
    v_uuid_ops, v_int4_ops
  );
END
$$;

COMMENT ON CONSTRAINT event_meetings_table_no_overlap ON public.event_meetings IS
  'Jedno miejsce przy stoliku nie obsluguje dwoch zajetych spotkan w tym samym czasie. Obejmuje held i no_show, bo termin BYL zajety - inaczej oznaczenie nieobecnosci otwieralo by luke w przeszlosci.';

-- ----------------------------------------------------------------------------
-- 6) TABELA POCHODNA UCZESTNICTWA W SPOTKANIU
--
-- JEDEN UCZESTNIK NA WIERSZ. Uzasadnienie w punkcie B naglowka: uczestnik
-- wystepuje w spotkaniu w dwoch kolumnach, a EXCLUDE porownuje kolumne z ta
-- sama kolumna - wiec na `event_meetings` warunek "ten czlowiek nie ma juz
-- spotkania w tym czasie" jest NIEWYRAZALNY. Tu jest wyrazalny jednym wierszem
-- deklaracji.
--
-- STAN I PRZEDZIAL SA ZDUBLOWANE ZE SPOTKANIA - swiadomie i z koniecznosci:
-- warunek czesciowy ograniczenia EXCLUDE (`WHERE status IN (...)`) i sam klucz
-- (`time_range`) musza czytac kolumny TEJ tabeli. Klauzula WHERE indeksu nie
-- umie zajrzec do tabeli nadrzednej, a klucz obcy nie kopiuje kolumn.
-- Spojnosc utrzymuje trigger, nie aplikacja - patrz `tg_event_meetings_sync_attendees`.
--
-- TA TABELA NIE MA WLASNEJ SCIEZKI ZAPISU. Nie ma dla niej RPC, nie ma polityki
-- INSERT/UPDATE i nie powinno byc: jest projekcja spotkania, nie osobnym
-- faktem. Wpisanie do niej wiersza recznie byloby stworzeniem uczestnictwa
-- w spotkaniu, ktorego nie ma.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_meeting_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  meeting_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  side text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  time_range tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_meeting_attendees_side_values CHECK (side IN ('requester', 'invitee')),
  CONSTRAINT event_meeting_attendees_time_order CHECK (ends_at > starts_at),
  CONSTRAINT event_meeting_attendees_status_values CHECK (status IN (
    'invited', 'accepted', 'declined', 'cancelled', 'rescheduled', 'held', 'no_show'
  )),
  -- Dokladnie jeden wiersz na strone spotkania. Bez tego trigger mogl by przy
  -- powtornym przebiegu dolozyc trzeci wiersz zamiast nadpisac istniejacy,
  -- a wtedy ograniczenie EXCLUDE zaczelo by kolidowac ze soba samym.
  CONSTRAINT event_meeting_attendees_meeting_side_unique
    UNIQUE (tenant_id, meeting_id, side),
  CONSTRAINT event_meeting_attendees_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_meeting_attendees_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_meeting_attendees_meeting_fk
    FOREIGN KEY (tenant_id, event_id, meeting_id)
    REFERENCES public.event_meetings (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_meeting_attendees_registration_fk
    FOREIGN KEY (tenant_id, event_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_meeting_attendees IS
  'Projekcja spotkania na uczestnikow: JEDEN uczestnik na wiersz. Nosnik ograniczenia EXCLUDE "jeden czlowiek nie ma dwoch zajetych spotkan w tym samym czasie", ktorego na event_meetings nie da sie wyrazic. Utrzymywana triggerem, bez wlasnej sciezki zapisu.';
COMMENT ON COLUMN public.event_meeting_attendees.status IS
  'Kopia stanu spotkania. Zdublowana z koniecznosci: warunek czesciowy ograniczenia EXCLUDE musi czytac kolumne TEJ tabeli.';
COMMENT ON COLUMN public.event_meeting_attendees.time_range IS
  'Kopia przedzialu spotkania jako zakres polotwarty. Klucz ograniczenia EXCLUDE i indeks pytania "co ten czlowiek ma w tym czasie".';

CREATE INDEX IF NOT EXISTS event_meeting_attendees_registration_idx
  ON public.event_meeting_attendees (tenant_id, registration_id, starts_at);
CREATE INDEX IF NOT EXISTS event_meeting_attendees_event_status_idx
  ON public.event_meeting_attendees (tenant_id, event_id, status, starts_at);
CREATE INDEX IF NOT EXISTS event_meeting_attendees_meeting_idx
  ON public.event_meeting_attendees (tenant_id, meeting_id);

GRANT SELECT ON public.event_meeting_attendees TO authenticated;
GRANT ALL ON public.event_meeting_attendees TO service_role;

ALTER TABLE public.event_meeting_attendees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_meeting_attendees_staff_read" ON public.event_meeting_attendees;
CREATE POLICY "event_meeting_attendees_staff_read"
  ON public.event_meeting_attendees FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "event_meeting_attendees_self_read" ON public.event_meeting_attendees;
CREATE POLICY "event_meeting_attendees_self_read"
  ON public.event_meeting_attendees FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND EXISTS (
      SELECT 1
      FROM public.event_registrations r
      JOIN public.event_people p
        ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      WHERE r.id = event_meeting_attendees.registration_id
        AND r.tenant_id = event_meeting_attendees.tenant_id
        AND p.user_id = (SELECT auth.uid())
    )
  );
-- Zapis: BRAK polityki klienckiej i BRAK RPC. Wiersze pisze wylacznie trigger.

-- ----------------------------------------------------------------------------
-- 6b) Wylacznosc terminu uczestnika
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_uuid_ops text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_meeting_attendees'::regclass
      AND conname = 'event_meeting_attendees_no_overlap'
  ) THEN
    RETURN;
  END IF;

  SELECT quote_ident(n.nspname) || '.gist_uuid_ops'
    INTO v_uuid_ops
  FROM pg_opclass oc
  JOIN pg_namespace n ON n.oid = oc.opcnamespace
  JOIN pg_am am ON am.oid = oc.opcmethod
  WHERE oc.opcname = 'gist_uuid_ops' AND am.amname = 'gist'
  LIMIT 1;

  IF v_uuid_ops IS NULL THEN
    RAISE EXCEPTION 'btree_gist_missing: klasa gist_uuid_ops nie istnieje - wylacznosci terminu uczestnika nie da sie wymusic';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.event_meeting_attendees '
    'ADD CONSTRAINT event_meeting_attendees_no_overlap '
    'EXCLUDE USING gist (tenant_id %1$s WITH =, registration_id %1$s WITH =, time_range WITH &&) '
    'WHERE (status IN (''accepted'', ''held'', ''no_show''))',
    v_uuid_ops
  );
END
$$;

COMMENT ON CONSTRAINT event_meeting_attendees_no_overlap ON public.event_meeting_attendees IS
  'Jeden uczestnik nie ma dwoch ZAJETYCH spotkan w tym samym czasie - niezaleznie od tego, w ktorej roli wystepuje. Zaproszenia niepotwierdzone (invited) sie nie licza: konkurencyjne zaproszenia na ten sam termin sa normalne, wygrywa pierwsza akceptacja.';

-- ----------------------------------------------------------------------------
-- 7) POMOCNIK: GRUPY UCZESTNIKA
--
-- Uprawnienie uczestnika wynika z SUMY jego grup (20260823150000): grupy
-- PODSTAWOWEJ z zapisu (`event_registrations.group_id`, nadanej biletem)
-- i grup DODATKOWYCH z `event_group_members`. Uczestnik BEZ zadnej grupy
-- (import, zapis sprzed wprowadzenia grup) dziedziczy grupe DOMYSLNA wydarzenia
-- - bez tego zaimportowana lista uczestnikow byla by wykluczona z gieldy
-- z powodu, ktorego nikt nie widzi w panelu.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_meeting_groups(uuid, uuid, uuid);
CREATE FUNCTION public._event_meeting_groups(
  _tenant uuid,
  _event_id uuid,
  _registration_id uuid
)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH own AS (
    SELECT r.group_id
    FROM public.event_registrations r
    WHERE r.tenant_id = _tenant
      AND r.event_id = _event_id
      AND r.id = _registration_id
      AND r.group_id IS NOT NULL
    UNION
    SELECT m.group_id
    FROM public.event_group_members m
    JOIN public.event_registrations r
      ON r.tenant_id = m.tenant_id
     AND r.person_id = m.person_id
     AND r.event_id = m.event_id
    WHERE m.tenant_id = _tenant
      AND m.event_id = _event_id
      AND r.id = _registration_id
  )
  SELECT o.group_id FROM own o
  UNION
  SELECT g.id
  FROM public.event_groups g
  WHERE g.tenant_id = _tenant
    AND g.event_id = _event_id
    AND g.is_default
    AND NOT EXISTS (SELECT 1 FROM own);
$$;

REVOKE ALL ON FUNCTION public._event_meeting_groups(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_groups(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_meeting_groups(uuid, uuid, uuid) IS
  'Grupy uczestnika: podstawowa z zapisu plus dodatkowe z event_group_members. Zapis bez grup dziedziczy grupe domyslna wydarzenia. Pomocnik wewnetrzny.';

-- ----------------------------------------------------------------------------
-- 8) POMOCNIK: SIATKA SLOTOW
--
-- Odpowiada na jedno pytanie: czy przedzial [_starts, _ends) JEST slotem siatki
-- tego wydarzenia. Siatka nie jest tabela wierszy (punkt D naglowka), wiec
-- liczy sie `generate_series` od `day_start_time` krokiem
-- `slot_minutes + break_minutes`, a ostatni slot musi zmiescic sie CALY przed
-- `day_end_time`.
--
-- `(dd + day_start_time) AT TIME ZONE timezone` - nawiasy sa OBOWIAZKOWE.
-- `AT TIME ZONE` wiaze mocniej niz `+`, wiec bez nich wyrazenie znaczyloby
-- `dd + (day_start_time AT TIME ZONE tz)`, czyli date plus `time with time zone`
-- - typ, ktory daje inny wynik i nie zglasza bledu.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_meeting_slot_valid(uuid, uuid, timestamptz, timestamptz);
CREATE FUNCTION public._event_meeting_slot_valid(
  _tenant uuid,
  _event_id uuid,
  _starts timestamptz,
  _ends timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_meeting_settings s
    CROSS JOIN unnest(s.meeting_days) AS d(dd)
    CROSS JOIN generate_series(
      ((d.dd + s.day_start_time) AT TIME ZONE s.timezone),
      ((d.dd + s.day_end_time) AT TIME ZONE s.timezone) - make_interval(mins => s.slot_minutes),
      make_interval(mins => s.slot_minutes + s.break_minutes)
    ) AS g(slot_start)
    WHERE s.tenant_id = _tenant
      AND s.event_id = _event_id
      AND g.slot_start = _starts
      AND g.slot_start + make_interval(mins => s.slot_minutes) = _ends
  );
$$;

REVOKE ALL ON FUNCTION public._event_meeting_slot_valid(uuid, uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_slot_valid(uuid, uuid, timestamptz, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public._event_meeting_slot_valid(uuid, uuid, timestamptz, timestamptz) IS
  'Czy przedzial jest slotem siatki gieldy tego wydarzenia. Siatka liczona z konfiguracji, nie z tabeli wierszy. Pomocnik wewnetrzny.';

-- ----------------------------------------------------------------------------
-- 9) POMOCNIK: CZY TERMIN MIESCI SIE W OKNIE DOSTEPNOSCI
--
-- Operator `@>` na zakresach, nie para nierownosci: okno musi zawierac CALY
-- slot, a nie jego poczatek. Slot 16:50-17:10 przy oknie do 17:00 jest terminem
-- nieosiagalnym, mimo ze jego poczatek w oknie jest.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_meeting_available(uuid, uuid, uuid, timestamptz, timestamptz);
CREATE FUNCTION public._event_meeting_available(
  _tenant uuid,
  _event_id uuid,
  _registration_id uuid,
  _starts timestamptz,
  _ends timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_meeting_availability a
    WHERE a.tenant_id = _tenant
      AND a.event_id = _event_id
      AND a.registration_id = _registration_id
      AND a.is_open
      AND a.time_range @> tstzrange(_starts, _ends, '[)')
  );
$$;

REVOKE ALL ON FUNCTION public._event_meeting_available(uuid, uuid, uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_available(uuid, uuid, uuid, timestamptz, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public._event_meeting_available(uuid, uuid, uuid, timestamptz, timestamptz) IS
  'Czy uczestnik ma OTWARTE okno dostepnosci zawierajace CALY podany przedzial. Pomocnik wewnetrzny.';

-- ----------------------------------------------------------------------------
-- 10) POMOCNIK: CZY WOLNO ZAPROSIC
--
-- Zwraca NULL, gdy wolno, a KLUCZ BLEDU, gdy nie. Klucz, a nie zdanie: tekst
-- dla czlowieka mieszka w slowniku i18n (src/lib/i18n-admin-event-meetings.ts),
-- a funkcja bazodanowa nie ma jezyka wolajacego.
--
-- Cztery reguly widocznosci gieldy - uzasadnienie i semantyka w komentarzu nad
-- `event_meeting_settings`. Wspolny warunek wszystkich czterech: OBIE strony
-- musza byc zapisami UCZESTNICZACYMI (`approved` albo `attended`) i nalezec do
-- co najmniej jednej grupy z uprawnieniem `can_meet`. Zapis oczekujacy,
-- rezerwowy, odrzucony i odwolany nie ma miejsca na wydarzeniu, wiec nie ma
-- czego umawiac.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_meeting_can_invite(uuid, uuid, uuid, uuid);
CREATE FUNCTION public._event_meeting_can_invite(
  _tenant uuid,
  _event_id uuid,
  _from_registration_id uuid,
  _to_registration_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_visibility text;
  v_enabled boolean;
  v_from_can_meet boolean;
  v_to_can_meet boolean;
BEGIN
  IF _from_registration_id = _to_registration_id THEN
    RETURN 'self_invite';
  END IF;

  SELECT s.is_enabled, s.visibility INTO v_enabled, v_visibility
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = _tenant AND s.event_id = _event_id;

  IF v_visibility IS NULL OR NOT v_enabled THEN
    RETURN 'meetings_disabled';
  END IF;

  IF v_visibility = 'disabled' THEN
    RETURN 'exchange_rule_closed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations r
    WHERE r.tenant_id = _tenant AND r.event_id = _event_id
      AND r.id = _from_registration_id
      AND r.status IN ('approved', 'attended')
  ) THEN
    RETURN 'requester_not_participating';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations r
    WHERE r.tenant_id = _tenant AND r.event_id = _event_id
      AND r.id = _to_registration_id
      AND r.status IN ('approved', 'attended')
  ) THEN
    RETURN 'invitee_not_participating';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public._event_meeting_groups(_tenant, _event_id, _from_registration_id) AS mg(group_id)
    JOIN public.event_groups g ON g.id = mg.group_id AND g.tenant_id = _tenant
    WHERE g.can_meet
  ) INTO v_from_can_meet;

  IF NOT v_from_can_meet THEN
    RETURN 'requester_group_cannot_meet';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public._event_meeting_groups(_tenant, _event_id, _to_registration_id) AS mg(group_id)
    JOIN public.event_groups g ON g.id = mg.group_id AND g.tenant_id = _tenant
    WHERE g.can_meet
  ) INTO v_to_can_meet;

  IF NOT v_to_can_meet THEN
    RETURN 'invitee_group_cannot_meet';
  END IF;

  IF v_visibility = 'groups' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public._event_meeting_groups(_tenant, _event_id, _from_registration_id) AS mg(group_id)
      JOIN public.event_meeting_rule_groups rg
        ON rg.group_id = mg.group_id
       AND rg.tenant_id = _tenant
       AND rg.event_id = _event_id
       AND rg.side = 'requester'
    ) THEN
      RETURN 'requester_group_not_allowed';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public._event_meeting_groups(_tenant, _event_id, _to_registration_id) AS mg(group_id)
      JOIN public.event_meeting_rule_groups rg
        ON rg.group_id = mg.group_id
       AND rg.tenant_id = _tenant
       AND rg.event_id = _event_id
       AND rg.side = 'invitee'
    ) THEN
      RETURN 'invitee_group_not_allowed';
    END IF;
  END IF;

  IF v_visibility = 'sponsors_to_attendees' THEN
    -- "Sponsor" jest tu zdefiniowany DANYMI, a nie nazwa grupy:
    -- `event_groups.can_lead_retrieval` to jedyna kolumna, ktora mowi
    -- "przedstawiciel firmy partnerskiej na stoisku". Grupa nazwana
    -- "Partnerzy" bez tego uprawnienia nie jest strona sponsorska, a grupa
    -- nazwana inaczej z tym uprawnieniem - jest.
    IF NOT EXISTS (
      SELECT 1
      FROM public._event_meeting_groups(_tenant, _event_id, _from_registration_id) AS mg(group_id)
      JOIN public.event_groups g ON g.id = mg.group_id AND g.tenant_id = _tenant
      WHERE g.can_lead_retrieval
    ) THEN
      RETURN 'requester_not_sponsor';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._event_meeting_can_invite(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_can_invite(uuid, uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_meeting_can_invite(uuid, uuid, uuid, uuid) IS
  'NULL gdy wolno zaprosic, w przeciwnym razie KLUCZ bledu do slownika i18n. Egzekwuje cztery reguly widocznosci gieldy i uprawnienie can_meet obu stron. Pomocnik wewnetrzny.';

-- ----------------------------------------------------------------------------
-- 11) POMOCNIK: ZAPIS WOLAJACEGO NA TYM WYDARZENIU
--
-- Lancuch jest trzyczlonowy: konto -> kartoteka (`event_people.user_id`) ->
-- zapis. Uzytkownik moze miec na jednym wydarzeniu tylko jeden AKTYWNY zapis
-- (indeks `event_registrations_active_uniq`), ale zapisow historycznych
-- (odwolanych, odrzuconych) moze miec wiele - dlatego filtr po statusie
-- uczestniczacym i porzadek malejacy po dacie.
--
-- Funkcja NIE wola `public_tenant_id()` ani `has_role()`: tenant przychodzi
-- parametrem od wolajacego, ktory juz go ustalil na swojej plaszczyznie.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_meeting_caller_registration(uuid, uuid);
CREATE FUNCTION public._event_meeting_caller_registration(_tenant uuid, _event_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.id
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.tenant_id = _tenant
    AND r.event_id = _event_id
    AND p.user_id = auth.uid()
    AND r.status IN ('approved', 'attended')
  ORDER BY r.created_at DESC, r.id DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public._event_meeting_caller_registration(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_caller_registration(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_meeting_caller_registration(uuid, uuid) IS
  'Uczestniczacy zapis wolajacego na tym wydarzeniu (konto -> kartoteka -> zapis) albo NULL. Pomocnik wewnetrzny.';

-- ----------------------------------------------------------------------------
-- 12) POMOCNIK: WOLNE TERMINY DLA PARY UCZESTNIKOW
--
-- SERCE MODULU, i celowo JEDNO ZAPYTANIE, nie petla. Petla po dniach i slotach
-- z zapytaniem na kazdy slot to przy kongresie trzydniowym 216 zapytan na jedno
-- otwarcie karty uczestnika - a uczestnicy otwieraja te karte setki razy
-- dziennie. Jedno zapytanie z `generate_series` liczy to samo jednym planem.
--
-- Skladane sa SZESC warunkow, kazdy z realnego wymogu:
--   1. SIATKA        - slot pochodzi z `generate_series` po dniach gieldy;
--   2. DOSTEPNOSC    - OTWARTE okno KAZDEJ ze stron zawiera caly slot;
--   3. KOLIZJE OSOB  - zadna ze stron nie ma juz zajetego spotkania w tym
--                      czasie (czytane z tabeli pochodnej uczestnictwa, czyli
--                      z tego samego zrodla, ktorego pilnuje EXCLUDE);
--   4. PARA          - ta para nie ma juz aktywnego zaproszenia na ten termin;
--   5. STOLIK        - jest wolne miejsce przy aktywnym stoliku. Gdy wydarzenie
--                      NIE MA ani jednego aktywnego stolika (gielda online),
--                      warunek nie obowiazuje i termin wraca bez stolika;
--   6. LIMIT DZIENNY - zadna ze stron nie osiagnela `max_meetings_per_day`
--                      w dniu tego slotu.
--
-- Przydzial stolika jest LATERAL-em z `LIMIT 1` po `sort_order`: zwracamy
-- PIERWSZE wolne miejsce, a nie liste wszystkich. Uczestnik wybiera termin,
-- nie stolik - stolik jest konsekwencja terminu i decyzja organizatora
-- o kolejnosci (`sort_order`) jest tu jedyna, ktora ma znaczenie.
--
-- Zwracane miejsce jest PODPOWIEDZIA, nie rezerwacja. Miedzy odczytem listy
-- a akceptacja moze je zajac ktos inny - dlatego akceptacja przydziela stolik
-- OD NOWA, pod blokada wiersza, a ostatnia linia obrony to EXCLUDE.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_meeting_free_slots(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer
);
CREATE FUNCTION public._event_meeting_free_slots(
  _tenant uuid,
  _event_id uuid,
  _a_registration_id uuid,
  _b_registration_id uuid,
  _from timestamptz,
  _to timestamptz,
  _limit integer
)
RETURNS TABLE (
  starts_at timestamptz,
  ends_at timestamptz,
  table_id uuid,
  table_label text,
  table_zone text,
  table_seat integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH cfg AS (
    SELECT s.*
    FROM public.event_meeting_settings s
    WHERE s.tenant_id = _tenant AND s.event_id = _event_id AND s.is_enabled
  ),
  has_tables AS (
    SELECT EXISTS (
      SELECT 1 FROM public.event_meeting_tables t
      WHERE t.tenant_id = _tenant AND t.event_id = _event_id AND t.is_active
    ) AS present
  ),
  grid AS (
    SELECT
      g.slot_start AS slot_starts_at,
      g.slot_start + make_interval(mins => c.slot_minutes) AS slot_ends_at
    FROM cfg c
    CROSS JOIN unnest(c.meeting_days) AS d(dd)
    CROSS JOIN generate_series(
      ((d.dd + c.day_start_time) AT TIME ZONE c.timezone),
      ((d.dd + c.day_end_time) AT TIME ZONE c.timezone) - make_interval(mins => c.slot_minutes),
      make_interval(mins => c.slot_minutes + c.break_minutes)
    ) AS g(slot_start)
  ),
  daily AS (
    SELECT
      a.registration_id,
      (a.starts_at AT TIME ZONE c.timezone)::date AS grid_day,
      count(*)::integer AS taken
    FROM cfg c
    JOIN public.event_meeting_attendees a
      ON a.tenant_id = _tenant
     AND a.event_id = _event_id
     AND a.registration_id IN (_a_registration_id, _b_registration_id)
     AND a.status IN ('accepted', 'held', 'no_show')
    GROUP BY a.registration_id, (a.starts_at AT TIME ZONE c.timezone)::date
  )
  SELECT
    s.slot_starts_at,
    s.slot_ends_at,
    tb.id,
    tb.label,
    tb.zone,
    tb.seat_no
  FROM grid s
  CROSS JOIN cfg c
  CROSS JOIN has_tables ht
  LEFT JOIN LATERAL (
    SELECT t.id, t.label, t.zone, seat.n AS seat_no
    FROM public.event_meeting_tables t
    CROSS JOIN generate_series(1, t.capacity) AS seat(n)
    WHERE t.tenant_id = _tenant
      AND t.event_id = _event_id
      AND t.is_active
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_meetings m
        WHERE m.tenant_id = _tenant
          AND m.table_id = t.id
          AND m.table_seat = seat.n
          AND m.status IN ('accepted', 'held', 'no_show')
          AND m.time_range && tstzrange(s.slot_starts_at, s.slot_ends_at, '[)')
      )
    ORDER BY t.sort_order, t.label, seat.n
    LIMIT 1
  ) tb ON true
  WHERE s.slot_starts_at > now()
    AND (_from IS NULL OR s.slot_starts_at >= _from)
    AND (_to IS NULL OR s.slot_starts_at < _to)
    AND public._event_meeting_available(
          _tenant, _event_id, _a_registration_id, s.slot_starts_at, s.slot_ends_at)
    AND public._event_meeting_available(
          _tenant, _event_id, _b_registration_id, s.slot_starts_at, s.slot_ends_at)
    AND NOT EXISTS (
      SELECT 1
      FROM public.event_meeting_attendees a
      WHERE a.tenant_id = _tenant
        AND a.event_id = _event_id
        AND a.registration_id IN (_a_registration_id, _b_registration_id)
        AND a.status IN ('accepted', 'held', 'no_show')
        AND a.time_range && tstzrange(s.slot_starts_at, s.slot_ends_at, '[)')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.event_meetings m
      WHERE m.tenant_id = _tenant
        AND m.event_id = _event_id
        AND m.pair_low = LEAST(_a_registration_id, _b_registration_id)
        AND m.pair_high = GREATEST(_a_registration_id, _b_registration_id)
        AND m.status IN ('invited', 'accepted')
        AND m.starts_at = s.slot_starts_at
    )
    AND (NOT ht.present OR tb.id IS NOT NULL)
    AND (
      c.max_meetings_per_day IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM daily dd
        WHERE dd.grid_day = (s.slot_starts_at AT TIME ZONE c.timezone)::date
          AND dd.taken >= c.max_meetings_per_day
      )
    )
  ORDER BY s.slot_starts_at
  LIMIT LEAST(GREATEST(COALESCE(_limit, 100), 1), 500);
$$;

REVOKE ALL ON FUNCTION public._event_meeting_free_slots(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_free_slots(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer
) TO service_role;

COMMENT ON FUNCTION public._event_meeting_free_slots(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer
) IS
  'Wolne terminy dla pary uczestnikow: przeciecie okien dostepnosci, siatka slotow, wolne miejsca przy stolikach, limity dzienne i brak kolizji - JEDNYM zapytaniem. Zwracany stolik jest podpowiedzia, nie rezerwacja. Pomocnik wewnetrzny.';

-- ----------------------------------------------------------------------------
-- 13) POMOCNIK: PRZYDZIAL MIEJSCA PRZY STOLIKU POD BLOKADA
--
-- Serializacja przez `SELECT ... FOR UPDATE` na wierszach STOLIKOW, nie przez
-- odczyt licznika. Dwie akceptacje w tej samej sekundzie ustawiaja sie w kolejke
-- na tym samym wierszu stolika, wiec druga widzi juz zapis pierwszej i dostaje
-- nastepne wolne miejsce (albo `no_free_table`, gdy nie ma zadnego).
-- Ograniczenie EXCLUDE zostaje jako linia obrony przed sciezka, ktora tej
-- blokady nie wziela.
--
-- `_preferred_table_id` obsluguje przypadek, w ktorym organizator albo uczestnik
-- WSKAZUJE stolik (spotkanie przy stoisku sponsora ma sens tylko przy tym
-- stoisku). Wskazany stolik jest weryfikowany, nie przyjmowany na slowo.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_meeting_take_seat(
  uuid, uuid, timestamptz, timestamptz, uuid, uuid
);
CREATE FUNCTION public._event_meeting_take_seat(
  _tenant uuid,
  _event_id uuid,
  _starts timestamptz,
  _ends timestamptz,
  _preferred_table_id uuid,
  _exclude_meeting_id uuid
)
RETURNS TABLE (out_table_id uuid, out_table_seat integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_has_tables boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.event_meeting_tables t
    WHERE t.tenant_id = _tenant AND t.event_id = _event_id AND t.is_active
  ) INTO v_has_tables;

  -- Gielda bez stolikow (wydarzenie online) jest poprawna: spotkanie nie ma
  -- miejsca fizycznego, wiec nie ma czego przydzielac. Zwracamy pusty wiersz,
  -- a nie blad - inaczej kazde wydarzenie online musialoby zalozyc atrape
  -- stolika, zeby gielda dzialala.
  IF NOT v_has_tables THEN
    RETURN QUERY SELECT NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  -- Blokada obejmuje WSZYSTKIE stoliki wchodzace w gre, a nie tylko ten,
  -- ktory zaraz wybierzemy: gdyby blokowac dopiero wybrany, dwie transakcje
  -- wybralyby ten sam stolik ZANIM ktorakolwiek go zablokowala.
  PERFORM 1
  FROM public.event_meeting_tables t
  WHERE t.tenant_id = _tenant
    AND t.event_id = _event_id
    AND t.is_active
    AND (_preferred_table_id IS NULL OR t.id = _preferred_table_id)
  ORDER BY t.sort_order, t.label, t.id
  FOR UPDATE;

  RETURN QUERY
  SELECT t.id, seat.n
  FROM public.event_meeting_tables t
  CROSS JOIN generate_series(1, t.capacity) AS seat(n)
  WHERE t.tenant_id = _tenant
    AND t.event_id = _event_id
    AND t.is_active
    AND (_preferred_table_id IS NULL OR t.id = _preferred_table_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.event_meetings m
      WHERE m.tenant_id = _tenant
        AND m.table_id = t.id
        AND m.table_seat = seat.n
        AND m.status IN ('accepted', 'held', 'no_show')
        AND m.time_range && tstzrange(_starts, _ends, '[)')
        AND (_exclude_meeting_id IS NULL OR m.id <> _exclude_meeting_id)
    )
  ORDER BY t.sort_order, t.label, seat.n
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public._event_meeting_take_seat(
  uuid, uuid, timestamptz, timestamptz, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_take_seat(
  uuid, uuid, timestamptz, timestamptz, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION public._event_meeting_take_seat(
  uuid, uuid, timestamptz, timestamptz, uuid, uuid
) IS
  'Pierwsze wolne miejsce przy aktywnym stoliku w podanym przedziale, pod blokada FOR UPDATE na wierszach stolikow. Zero wierszy = brak wolnego miejsca; wiersz z NULL-ami = wydarzenie bez stolikow. Pomocnik wewnetrzny.';

-- ----------------------------------------------------------------------------
-- 14) TRIGGER: WALIDACJA SPOTKANIA
--
-- BEZ TRIGGERA te trzy warunki byly by tylko w RPC - a wtedy kazda nowa sciezka
-- zapisu (import, migracja danych, przyszly solver przydzialu) mogla by je
-- pominac, i to bez sladu.
--
-- WALIDACJA JEST WARUNKOWA I TO JEST ISTOTA PROJEKTU. Sprawdzamy TO, CO SIE
-- WLASNIE ZMIENILO:
--   * MIEJSCE (stolik, numer miejsca) - gdy zmienil sie stolik albo numer;
--   * CZAS (siatka, okna dostepnosci) - gdy zmienil sie przedzial.
-- Gdyby walidacja czasu odpalala sie przy KAZDEJ zmianie wiersza, akceptacja
-- zaproszenia (ktora zmienia stolik, nie czas) przewracalaby sie na siatce
-- zmienionej przez organizatora po wyslaniu zaproszenia. Uczestnik traci wtedy
-- spotkanie z powodu, ktory powstal po jego stronie zerowej wplywu - dokladnie
-- tak samo, jak przy liczonym (a nie zapisanym) `expires_at`.
--
-- Walidacja czasu obowiazuje wylacznie dla stanow AKTYWNYCH (`invited`,
-- `accepted`). Odwolanie i oznaczenie nieobecnosci na spotkaniu, ktore wypadlo
-- poza zmieniona siatke, musi byc mozliwe - inaczej zmiana siatki zamraza
-- historie w stanie, ktorego nie da sie domknac.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_event_meetings_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capacity integer;
  v_active boolean;
  v_time_changed boolean;
  v_place_changed boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Wydarzenie i strony spotkania sa NIEZMIENNE. Przepiecie spotkania na inne
    -- wydarzenie albo na innego czlowieka nie jest edycja, tylko zatarciem
    -- sladu: druga strona dostala zaproszenie od kogos innego, niz teraz stoi
    -- w wierszu.
    IF NEW.event_id IS DISTINCT FROM OLD.event_id
       OR NEW.requester_registration_id IS DISTINCT FROM OLD.requester_registration_id
       OR NEW.invitee_registration_id IS DISTINCT FROM OLD.invitee_registration_id THEN
      RAISE EXCEPTION 'meeting_identity_immutable: event and both parties are immutable';
    END IF;
  END IF;

  v_place_changed := TG_OP = 'INSERT'
    OR NEW.table_id IS DISTINCT FROM OLD.table_id
    OR NEW.table_seat IS DISTINCT FROM OLD.table_seat;

  v_time_changed := TG_OP = 'INSERT'
    OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
    OR NEW.ends_at IS DISTINCT FROM OLD.ends_at;

  IF v_place_changed AND NEW.table_id IS NOT NULL THEN
    SELECT t.capacity, t.is_active INTO v_capacity, v_active
    FROM public.event_meeting_tables t
    WHERE t.tenant_id = NEW.tenant_id
      AND t.event_id = NEW.event_id
      AND t.id = NEW.table_id;

    -- Klucz obcy potrojny juz to sprawdzil; ta galaz istnieje, zeby komunikat
    -- byl czytelny, a nie zeby zastapic klucz.
    IF v_capacity IS NULL THEN
      RAISE EXCEPTION 'table_not_found: the table does not belong to this event';
    END IF;

    IF NOT v_active AND NEW.status IN ('invited', 'accepted') THEN
      RAISE EXCEPTION 'table_inactive: the table is switched off for new meetings';
    END IF;

    IF NEW.table_seat > v_capacity THEN
      RAISE EXCEPTION 'table_seat_out_of_range: seat % exceeds table capacity %',
        NEW.table_seat, v_capacity;
    END IF;
  END IF;

  IF v_time_changed AND NEW.status IN ('invited', 'accepted') THEN
    IF NOT public._event_meeting_slot_valid(
      NEW.tenant_id, NEW.event_id, NEW.starts_at, NEW.ends_at
    ) THEN
      RAISE EXCEPTION 'slot_not_in_grid: the slot does not belong to the meeting grid';
    END IF;

    IF NOT public._event_meeting_available(
      NEW.tenant_id, NEW.event_id, NEW.requester_registration_id, NEW.starts_at, NEW.ends_at
    ) THEN
      RAISE EXCEPTION 'requester_unavailable: the requester has no open availability window for this slot';
    END IF;

    IF NOT public._event_meeting_available(
      NEW.tenant_id, NEW.event_id, NEW.invitee_registration_id, NEW.starts_at, NEW.ends_at
    ) THEN
      RAISE EXCEPTION 'invitee_unavailable: the invitee has no open availability window for this slot';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_event_meetings_validate() IS
  'Walidacja spotkania: numer miejsca w granicach pojemnosci stolika, slot w siatce, przedzial w oknach dostepnosci obu stron. Warunkowa - sprawdza to, co sie wlasnie zmienilo (uzasadnienie w komentarzu nad funkcja).';

DROP TRIGGER IF EXISTS event_meetings_validate ON public.event_meetings;
CREATE TRIGGER event_meetings_validate
  BEFORE INSERT OR UPDATE ON public.event_meetings
  FOR EACH ROW EXECUTE FUNCTION public.tg_event_meetings_validate();

-- ----------------------------------------------------------------------------
-- 15) TRIGGER: PROJEKCJA SPOTKANIA NA UCZESTNIKOW
--
-- Utrzymuje `event_meeting_attendees` - nosnik ograniczenia "jeden czlowiek nie
-- ma dwoch zajetych spotkan w tym samym czasie" (punkt B naglowka).
--
-- AFTER, nie BEFORE: wiersz spotkania musi juz istniec, bo klucz obcy projekcji
-- na niego wskazuje.
--
-- `ON CONFLICT ... DO UPDATE` zamiast DELETE + INSERT: przy aktualizacji
-- spotkania (akceptacja, odwolanie) projekcja ma sie ZMIENIC, a nie zniknac
-- i pojawic. Skasowanie i wstawienie odpalalo by ograniczenie EXCLUDE dwa razy
-- w jednej instrukcji i - przy dwoch wierszach na spotkanie - potrafilo by
-- zderzyc wiersz z jego wlasna nowa wersja.
--
-- USUNIECIE SPOTKANIA nie ma tu galezi: kaskada klucza obcego
-- `event_meeting_attendees_meeting_fk` usuwa projekcje sama. Trigger, ktory
-- robilby to drugi raz, roznil by sie od kaskady tylko tym, ze da sie go
-- wylaczyc.
--
-- Wyjatek NIE jest tu lapany. To rozni ten trigger od emiterow szyny zdarzen:
-- nieudana projekcja znaczy, ze ograniczenie kolizji terminu odrzucilo zapis -
-- czyli DOKLADNIE to, o co w niej chodzi. Zjedzenie tego wyjatku zamienilo by
-- gwarancje w sugestie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_event_meetings_sync_attendees()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.event_meeting_attendees (
    tenant_id, event_id, meeting_id, registration_id, side, starts_at, ends_at, status
  )
  VALUES
    (NEW.tenant_id, NEW.event_id, NEW.id, NEW.requester_registration_id,
     'requester', NEW.starts_at, NEW.ends_at, NEW.status),
    (NEW.tenant_id, NEW.event_id, NEW.id, NEW.invitee_registration_id,
     'invitee', NEW.starts_at, NEW.ends_at, NEW.status)
  ON CONFLICT (tenant_id, meeting_id, side) DO UPDATE
  SET registration_id = EXCLUDED.registration_id,
      starts_at = EXCLUDED.starts_at,
      ends_at = EXCLUDED.ends_at,
      status = EXCLUDED.status,
      updated_at = now();

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.tg_event_meetings_sync_attendees() IS
  'Utrzymuje projekcje event_meeting_attendees (dwa wiersze na spotkanie). Nie lapie wyjatku swiadomie: nieudana projekcja to odrzucenie kolizji terminu, czyli dzialanie ograniczenia, nie awaria.';

DROP TRIGGER IF EXISTS event_meetings_sync_attendees ON public.event_meetings;
CREATE TRIGGER event_meetings_sync_attendees
  AFTER INSERT OR UPDATE OF
    requester_registration_id, invitee_registration_id, starts_at, ends_at, status
  ON public.event_meetings
  FOR EACH ROW EXECUTE FUNCTION public.tg_event_meetings_sync_attendees();

-- ============================================================================
-- PLASZCZYZNA ADMINISTRACYJNA
--
-- Kazda funkcja ponizej zaczyna sie od `assert_editor_tenant()` (admin ALBO
-- editor w tenancie DOMOWYM) i skaluje dane po zwroconym tenancie. Zadna nie
-- wola `public_tenant_id()` - naglowek hosta jest falsyfikowalny, a te funkcje
-- czytaja i pisza dane osobowe uczestnikow.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 16) PANEL: LISTA STOLIKOW Z OBCIAZENIEM
--
-- Licznik obciazenia jedzie RAZEM z wierszem stolika, a nie osobnym zapytaniem
-- na zadanie: redaktor patrzacy na liste stolikow zadaje dokladnie jedno
-- pytanie ("czy mam dosc stolikow"), a odpowiedz na nie jest w tej kolumnie.
-- Bez niej lista stolikow jest lista nazw.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_meeting_tables_list(uuid);
CREATE FUNCTION public.admin_event_meeting_tables_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  label text,
  zone text,
  capacity integer,
  room_id uuid,
  room_name text,
  note text,
  is_active boolean,
  sort_order integer,
  meetings_count integer,
  minutes_taken integer,
  next_meeting_at timestamptz,
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
    t.id, t.label, t.zone, t.capacity, t.room_id, r.name, t.note,
    t.is_active, t.sort_order,
    COALESCE(u.cnt, 0)::integer,
    COALESCE(u.minutes, 0)::integer,
    u.next_at,
    t.created_at, t.updated_at
  FROM public.event_meeting_tables t
  LEFT JOIN public.event_rooms r
    ON r.id = t.room_id AND r.tenant_id = t.tenant_id
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS cnt,
      COALESCE(sum(EXTRACT(EPOCH FROM (m.ends_at - m.starts_at)) / 60), 0)::integer AS minutes,
      min(m.starts_at) FILTER (WHERE m.starts_at > now()) AS next_at
    FROM public.event_meetings m
    WHERE m.tenant_id = t.tenant_id
      AND m.table_id = t.id
      AND m.status IN ('accepted', 'held', 'no_show')
  ) u ON true
  WHERE t.tenant_id = v_tenant
    AND t.event_id = p_event_id
  ORDER BY t.sort_order, t.label, t.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_tables_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_tables_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_tables_list(uuid) IS
  'Stoliki wydarzenia z obciazeniem (liczba zajetych spotkan, minuty, najblizszy termin). Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 17) PANEL: DODANIE I EDYCJA STOLIKA
--
-- Kontrakt payloadu jak w `admin_event_session_save` (20260823140000): pole
-- NIEOBECNE w payloadzie zostaje bez zmiany, pole obecne i puste jest
-- czyszczone. Klient moze wiec odeslac caly wiersz albo jedno pole i oba
-- zachowania sa przewidywalne.
--
-- WYDARZENIE STOLIKA JEST NIEZMIENNE. Przepiecie stolika na inne wydarzenie
-- zabralo by stolik spotkaniom, ktore go uzywaja, i to bez sladu - stolik
-- zniknal by z jednego budynku i pojawil w drugim, a spotkania zostaly by
-- z etykieta miejsca, ktorego tam nie ma.
--
-- OBNIZENIE POJEMNOSCI PONIZEJ ZAJETYCH MIEJSC JEST ODRZUCANE. Bez tego
-- warunku stolik o pojemnosci obnizonej z 6 do 2 zostawia cztery spotkania na
-- miejscach 3-6, ktorych ograniczenie EXCLUDE dalej pilnuje, ale ktorych numer
-- przekracza deklarowana pojemnosc - czyli stan, w ktorym raport obciazenia
-- pokazuje 300 procent.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_meeting_table_save(jsonb);
CREATE FUNCTION public.admin_event_meeting_table_save(p_payload jsonb)
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
  v_row public.event_meeting_tables;
  v_label text;
  v_capacity integer;
  v_max_seat integer;
  v_sort integer;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_row
    FROM public.event_meeting_tables t
    WHERE t.id = v_id AND t.tenant_id = v_tenant;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'not_found: meeting table does not exist in this tenant';
    END IF;

    v_event_id := v_row.event_id;
  ELSE
    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'invalid_payload: event_id is required for a new table';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = v_event_id AND e.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'not_found: event does not exist in this tenant';
    END IF;
  END IF;

  v_label := COALESCE(
    NULLIF(btrim(COALESCE(p_payload->>'label', '')), ''),
    v_row.label
  );

  IF v_label IS NULL OR char_length(v_label) < 1 THEN
    RAISE EXCEPTION 'invalid_label: the table label is required';
  END IF;

  v_capacity := COALESCE(
    (NULLIF(p_payload->>'capacity', ''))::integer,
    v_row.capacity,
    1
  );

  IF v_capacity < 1 OR v_capacity > 50 THEN
    RAISE EXCEPTION 'invalid_capacity: capacity must be between 1 and 50';
  END IF;

  IF v_id IS NOT NULL AND v_capacity < v_row.capacity THEN
    SELECT max(m.table_seat) INTO v_max_seat
    FROM public.event_meetings m
    WHERE m.tenant_id = v_tenant
      AND m.table_id = v_id
      AND m.status IN ('accepted', 'held', 'no_show');

    IF v_max_seat IS NOT NULL AND v_max_seat > v_capacity THEN
      RAISE EXCEPTION 'table_capacity_in_use: seat % is taken, capacity cannot drop below it',
        v_max_seat;
    END IF;
  END IF;

  v_sort := COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, v_row.sort_order);
  IF v_sort IS NULL THEN
    -- Nowy stolik lezy na koncu listy, a nie w losowym miejscu srodka.
    SELECT COALESCE(max(t.sort_order), 0) + 10 INTO v_sort
    FROM public.event_meeting_tables t
    WHERE t.tenant_id = v_tenant AND t.event_id = v_event_id;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.event_meeting_tables (
      tenant_id, event_id, label, zone, capacity, room_id, note,
      is_active, sort_order, created_by
    ) VALUES (
      v_tenant, v_event_id, v_label,
      NULLIF(btrim(COALESCE(p_payload->>'zone', '')), ''),
      v_capacity,
      NULLIF(p_payload->>'room_id', '')::uuid,
      NULLIF(btrim(COALESCE(p_payload->>'note', '')), ''),
      COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true),
      v_sort,
      auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_meeting_tables SET
      label = v_label,
      zone = CASE
        WHEN p_payload ? 'zone' THEN NULLIF(btrim(COALESCE(p_payload->>'zone', '')), '')
        ELSE zone
      END,
      capacity = v_capacity,
      room_id = CASE
        WHEN p_payload ? 'room_id' THEN NULLIF(p_payload->>'room_id', '')::uuid
        ELSE room_id
      END,
      note = CASE
        WHEN p_payload ? 'note' THEN NULLIF(btrim(COALESCE(p_payload->>'note', '')), '')
        ELSE note
      END,
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, is_active),
      sort_order = v_sort
    WHERE id = v_id AND tenant_id = v_tenant;
  END IF;

  RETURN v_id;
EXCEPTION
  -- Jedyny indeks unikalny na tej tabeli to etykieta w obrebie wydarzenia,
  -- wiec przeklad jest jednoznaczny.
  WHEN unique_violation THEN
    RAISE EXCEPTION 'table_label_taken: a table with this label already exists in this event';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_table_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_table_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_table_save(jsonb) IS
  'Dodanie albo edycja stolika. Wydarzenie stolika jest niezmienne; obnizenie pojemnosci ponizej zajetego miejsca jest odrzucane. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 18) PANEL: USUNIECIE STOLIKA
--
-- Stolik uzywany przez JAKIEKOLWIEK spotkanie (takze odwolane albo odbyte) NIE
-- DA SIE usunac. Klucz obcy `event_meetings_table_fk` ma zachowanie NO ACTION,
-- wiec baza i tak by odmowila - ta funkcja robi to WCZESNIEJ i z powodem, ktory
-- da sie pokazac czlowiekowi. Sciezka wlasciwa dla stolika, ktorego nie ma juz
-- w budynku, to WYLACZENIE (`is_active = false`): znika z przydzialu, zostaje
-- w historii.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_meeting_table_delete(uuid);
CREATE FUNCTION public.admin_event_meeting_table_delete(_id uuid)
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
    SELECT 1 FROM public.event_meeting_tables t
    WHERE t.id = _id AND t.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: meeting table does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.event_meetings m
  WHERE m.tenant_id = v_tenant AND m.table_id = _id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'table_in_use: % meeting(s) still reference this table', v_used;
  END IF;

  DELETE FROM public.event_meeting_tables
  WHERE id = _id AND tenant_id = v_tenant;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_table_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_table_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_table_delete(uuid) IS
  'Usuwa stolik, ktorego nie uzywa zadne spotkanie. W przeciwnym razie blad table_in_use - sciezka wlasciwa to wylaczenie stolika. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 19) PANEL: ODCZYT KONFIGURACJI GIELDY
--
-- Zwraca jsonb, a nie wiersz: ekran konfiguracji czyta jednym wywolaniem
-- ustawienia, DWIE listy grup reguly, liczbe stolikow, liczbe miejsc i stan
-- deklaracji dostepnosci. Rozbicie na piec wywolan dawaloby piec stanow
-- wczytywania na jednym formularzu.
--
-- BRAK WIERSZA NIE JEST BLEDEM. Wydarzenie bez gieldy zwraca `configured:
-- false` i domysly, zeby formularz mial czym sie wypelnic - a nie pusty ekran
-- z komunikatem "nie znaleziono".
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_meeting_settings_get(uuid);
CREATE FUNCTION public.admin_event_meeting_settings_get(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_settings public.event_meeting_settings;
  v_event public.events;
  v_out jsonb;
BEGIN
  SELECT * INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  SELECT * INTO v_settings
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = p_event_id;

  v_out := jsonb_build_object(
    'configured', v_settings.id IS NOT NULL,
    'event_id', p_event_id,
    'event_timezone', v_event.timezone,
    'is_enabled', COALESCE(v_settings.is_enabled, false),
    'slot_minutes', COALESCE(v_settings.slot_minutes, 20),
    'break_minutes', COALESCE(v_settings.break_minutes, 5),
    'day_start_time', COALESCE(v_settings.day_start_time, '09:00'::time),
    'day_end_time', COALESCE(v_settings.day_end_time, '17:00'::time),
    'meeting_days', COALESCE(to_jsonb(v_settings.meeting_days), '[]'::jsonb),
    'timezone', COALESCE(v_settings.timezone, v_event.timezone, 'Europe/Warsaw'),
    'invites_open_at', v_settings.invites_open_at,
    'invites_close_at', v_settings.invites_close_at,
    'max_invites_per_person', v_settings.max_invites_per_person,
    'max_meetings_per_day', v_settings.max_meetings_per_day,
    'invite_expires_after_hours', COALESCE(v_settings.invite_expires_after_hours, 72),
    'visibility', COALESCE(v_settings.visibility, 'everyone'),
    'intro_pl', COALESCE(v_settings.intro_pl, ''),
    'intro_en', COALESCE(v_settings.intro_en, ''),
    'updated_at', v_settings.updated_at
  );

  -- Grupy reguly: dwie listy, kazda z nazwa - inaczej formularz musialby
  -- dociagac nazwy drugim wywolaniem po samych identyfikatorach.
  v_out := v_out || jsonb_build_object(
    'requester_groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'group_id', g.id, 'key', g.key, 'name_pl', g.name_pl, 'name_en', g.name_en,
        'can_meet', g.can_meet, 'can_lead_retrieval', g.can_lead_retrieval
      ) ORDER BY g.sort_order, g.key)
      FROM public.event_meeting_rule_groups rg
      JOIN public.event_groups g
        ON g.id = rg.group_id AND g.tenant_id = rg.tenant_id
      WHERE rg.tenant_id = v_tenant AND rg.event_id = p_event_id AND rg.side = 'requester'
    ), '[]'::jsonb),
    'invitee_groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'group_id', g.id, 'key', g.key, 'name_pl', g.name_pl, 'name_en', g.name_en,
        'can_meet', g.can_meet, 'can_lead_retrieval', g.can_lead_retrieval
      ) ORDER BY g.sort_order, g.key)
      FROM public.event_meeting_rule_groups rg
      JOIN public.event_groups g
        ON g.id = rg.group_id AND g.tenant_id = rg.tenant_id
      WHERE rg.tenant_id = v_tenant AND rg.event_id = p_event_id AND rg.side = 'invitee'
    ), '[]'::jsonb),
    'available_groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'group_id', g.id, 'key', g.key, 'name_pl', g.name_pl, 'name_en', g.name_en,
        'can_meet', g.can_meet, 'can_lead_retrieval', g.can_lead_retrieval
      ) ORDER BY g.sort_order, g.key)
      FROM public.event_groups g
      WHERE g.tenant_id = v_tenant AND g.event_id = p_event_id
    ), '[]'::jsonb)
  );

  -- Trzy liczby, ktore odpowiadaja na pytanie "czy ta gielda w ogole moze
  -- dzialac": ile jest miejsc przy stolikach, ilu uczestnikow zadeklarowalo
  -- dostepnosc, ilu jest w ogole. Bez nich redaktor wlacza gielde i czeka.
  v_out := v_out || (
    SELECT jsonb_build_object(
      'tables_count', (
        SELECT count(*)::integer FROM public.event_meeting_tables t
        WHERE t.tenant_id = v_tenant AND t.event_id = p_event_id AND t.is_active
      ),
      'seats_count', (
        SELECT COALESCE(sum(t.capacity), 0)::integer FROM public.event_meeting_tables t
        WHERE t.tenant_id = v_tenant AND t.event_id = p_event_id AND t.is_active
      ),
      'participants_count', (
        SELECT count(*)::integer FROM public.event_registrations r
        WHERE r.tenant_id = v_tenant AND r.event_id = p_event_id
          AND r.status IN ('approved', 'attended')
      ),
      'with_availability_count', (
        SELECT count(DISTINCT a.registration_id)::integer
        FROM public.event_meeting_availability a
        WHERE a.tenant_id = v_tenant AND a.event_id = p_event_id AND a.is_open
      )
    )
  );

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_settings_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_settings_get(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_settings_get(uuid) IS
  'Konfiguracja gieldy jednym wywolaniem: siatka, limity, regula z nazwami grup, katalog grup do wyboru i cztery liczby gotowosci. Brak wiersza zwraca configured=false i domysly. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 20) PANEL: ZAPIS KONFIGURACJI GIELDY
--
-- JEDNO WYWOLANIE ZAPISUJE SIATKE, LIMITY, REGULE I OBIE LISTY GRUP. Rozbicie
-- na trzy wywolania (ustawienia, grupy zapraszajace, grupy zaproszone) daje
-- stan czesciowo zapisany, gdy drugie wywolanie sie nie uda - a stan czesciowo
-- zapisany na regule widocznosci znaczy gielde otwarta dla kogos, kto mial byc
-- wykluczony.
--
-- STREFA CZASOWA JEST WERYFIKOWANA W KATALOGU (`pg_timezone_names`), a nie
-- CHECK-iem: lista stref zalezy od bazy danych tz systemu, wiec nie jest
-- funkcja niezmienna i w CHECK-u byc nie moze. Bledna strefa bez tej
-- weryfikacji przeszla by do wiersza i wysadzila siatke slotow przy pierwszym
-- odczycie, bledem `invalid_argument` z glebi funkcji, ktora o strefach nic nie
-- mowi.
--
-- REGULA `groups` BEZ GRUP JEST ODRZUCANA. Ustawienie "wylacznie wybrane grupy"
-- z pusta lista blokuje wszystkich, ale wyglada w panelu jak gielda dzialajaca.
-- To jest ten rodzaj stanu, ktory kosztuje dzien wsparcia technicznego.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_meeting_settings_save(jsonb);
CREATE FUNCTION public.admin_event_meeting_settings_save(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_row public.event_meeting_settings;
  v_timezone text;
  v_visibility text;
  v_days date[];
  v_requester uuid[];
  v_invitee uuid[];
  v_id uuid;
  v_bad uuid;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  SELECT * INTO v_row
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id;

  v_timezone := COALESCE(
    NULLIF(btrim(COALESCE(p_payload->>'timezone', '')), ''),
    v_row.timezone,
    (SELECT e.timezone FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant),
    'Europe/Warsaw'
  );

  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_timezone) THEN
    RAISE EXCEPTION 'invalid_timezone: % is not a known time zone', v_timezone;
  END IF;

  v_visibility := COALESCE(
    NULLIF(p_payload->>'visibility', ''),
    v_row.visibility,
    'everyone'
  );

  IF v_visibility NOT IN ('everyone', 'groups', 'sponsors_to_attendees', 'disabled') THEN
    RAISE EXCEPTION 'invalid_visibility: unknown exchange visibility rule';
  END IF;

  IF p_payload ? 'meeting_days' THEN
    IF jsonb_typeof(p_payload->'meeting_days') <> 'array' THEN
      RAISE EXCEPTION 'invalid_meeting_days: meeting_days must be a JSON array of dates';
    END IF;
    SELECT array_agg(DISTINCT (d.value #>> '{}')::date ORDER BY (d.value #>> '{}')::date)
      INTO v_days
    FROM jsonb_array_elements(p_payload->'meeting_days') AS d(value);
    v_days := COALESCE(v_days, '{}'::date[]);
  ELSE
    v_days := COALESCE(v_row.meeting_days, '{}'::date[]);
  END IF;

  IF v_visibility = 'groups' THEN
    IF p_payload ? 'requester_group_ids' THEN
      SELECT array_agg(DISTINCT (g.value #>> '{}')::uuid) INTO v_requester
      FROM jsonb_array_elements(COALESCE(p_payload->'requester_group_ids', '[]'::jsonb)) AS g(value);
    ELSE
      SELECT array_agg(rg.group_id) INTO v_requester
      FROM public.event_meeting_rule_groups rg
      WHERE rg.tenant_id = v_tenant AND rg.event_id = v_event_id AND rg.side = 'requester';
    END IF;

    IF p_payload ? 'invitee_group_ids' THEN
      SELECT array_agg(DISTINCT (g.value #>> '{}')::uuid) INTO v_invitee
      FROM jsonb_array_elements(COALESCE(p_payload->'invitee_group_ids', '[]'::jsonb)) AS g(value);
    ELSE
      SELECT array_agg(rg.group_id) INTO v_invitee
      FROM public.event_meeting_rule_groups rg
      WHERE rg.tenant_id = v_tenant AND rg.event_id = v_event_id AND rg.side = 'invitee';
    END IF;

    IF COALESCE(cardinality(v_requester), 0) = 0 OR COALESCE(cardinality(v_invitee), 0) = 0 THEN
      RAISE EXCEPTION 'rule_groups_required: rule `groups` needs at least one group on each side';
    END IF;
  ELSE
    -- Regula inna niz `groups` NIE KASUJE list grup. Redaktor probujacy
    -- "wszyscy do wszystkich" na jeden dzien i wracajacy do wyboru grup
    -- odzyskuje swoja liste, a nie puste pole. Listy sa nadpisywane tylko
    -- wtedy, gdy payload je podaje.
    IF p_payload ? 'requester_group_ids' THEN
      SELECT array_agg(DISTINCT (g.value #>> '{}')::uuid) INTO v_requester
      FROM jsonb_array_elements(COALESCE(p_payload->'requester_group_ids', '[]'::jsonb)) AS g(value);
      v_requester := COALESCE(v_requester, '{}'::uuid[]);
    END IF;
    IF p_payload ? 'invitee_group_ids' THEN
      SELECT array_agg(DISTINCT (g.value #>> '{}')::uuid) INTO v_invitee
      FROM jsonb_array_elements(COALESCE(p_payload->'invitee_group_ids', '[]'::jsonb)) AS g(value);
      v_invitee := COALESCE(v_invitee, '{}'::uuid[]);
    END IF;
  END IF;

  INSERT INTO public.event_meeting_settings AS s (
    tenant_id, event_id, is_enabled, slot_minutes, break_minutes,
    day_start_time, day_end_time, meeting_days, timezone,
    invites_open_at, invites_close_at,
    max_invites_per_person, max_meetings_per_day, invite_expires_after_hours,
    visibility, intro_pl, intro_en, updated_by
  ) VALUES (
    v_tenant, v_event_id,
    COALESCE((NULLIF(p_payload->>'is_enabled', ''))::boolean, false),
    COALESCE((NULLIF(p_payload->>'slot_minutes', ''))::integer, 20),
    COALESCE((NULLIF(p_payload->>'break_minutes', ''))::integer, 5),
    COALESCE((NULLIF(p_payload->>'day_start_time', ''))::time, '09:00'::time),
    COALESCE((NULLIF(p_payload->>'day_end_time', ''))::time, '17:00'::time),
    v_days,
    v_timezone,
    (NULLIF(p_payload->>'invites_open_at', ''))::timestamptz,
    (NULLIF(p_payload->>'invites_close_at', ''))::timestamptz,
    (NULLIF(p_payload->>'max_invites_per_person', ''))::integer,
    (NULLIF(p_payload->>'max_meetings_per_day', ''))::integer,
    COALESCE((NULLIF(p_payload->>'invite_expires_after_hours', ''))::integer, 72),
    v_visibility,
    COALESCE(btrim(p_payload->>'intro_pl'), ''),
    COALESCE(btrim(p_payload->>'intro_en'), ''),
    auth.uid()
  )
  ON CONFLICT (tenant_id, event_id) DO UPDATE
  SET is_enabled = COALESCE((NULLIF(p_payload->>'is_enabled', ''))::boolean, s.is_enabled),
      slot_minutes = COALESCE((NULLIF(p_payload->>'slot_minutes', ''))::integer, s.slot_minutes),
      break_minutes = COALESCE((NULLIF(p_payload->>'break_minutes', ''))::integer, s.break_minutes),
      day_start_time = COALESCE((NULLIF(p_payload->>'day_start_time', ''))::time, s.day_start_time),
      day_end_time = COALESCE((NULLIF(p_payload->>'day_end_time', ''))::time, s.day_end_time),
      meeting_days = v_days,
      timezone = v_timezone,
      invites_open_at = CASE
        WHEN p_payload ? 'invites_open_at'
          THEN (NULLIF(p_payload->>'invites_open_at', ''))::timestamptz
        ELSE s.invites_open_at
      END,
      invites_close_at = CASE
        WHEN p_payload ? 'invites_close_at'
          THEN (NULLIF(p_payload->>'invites_close_at', ''))::timestamptz
        ELSE s.invites_close_at
      END,
      max_invites_per_person = CASE
        WHEN p_payload ? 'max_invites_per_person'
          THEN (NULLIF(p_payload->>'max_invites_per_person', ''))::integer
        ELSE s.max_invites_per_person
      END,
      max_meetings_per_day = CASE
        WHEN p_payload ? 'max_meetings_per_day'
          THEN (NULLIF(p_payload->>'max_meetings_per_day', ''))::integer
        ELSE s.max_meetings_per_day
      END,
      invite_expires_after_hours = COALESCE(
        (NULLIF(p_payload->>'invite_expires_after_hours', ''))::integer,
        s.invite_expires_after_hours
      ),
      visibility = v_visibility,
      intro_pl = COALESCE(btrim(p_payload->>'intro_pl'), s.intro_pl),
      intro_en = COALESCE(btrim(p_payload->>'intro_en'), s.intro_en),
      updated_by = auth.uid()
  RETURNING s.id INTO v_id;

  -- Grupy reguly: nadpisujemy WYLACZNIE te strony, ktore payload podaje.
  IF v_requester IS NOT NULL THEN
    SELECT x.gid INTO v_bad
    FROM unnest(v_requester) AS x(gid)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.event_groups g
      WHERE g.id = x.gid AND g.tenant_id = v_tenant AND g.event_id = v_event_id
    )
    LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'group_not_found: group % does not belong to this event', v_bad;
    END IF;

    DELETE FROM public.event_meeting_rule_groups rg
    WHERE rg.tenant_id = v_tenant AND rg.event_id = v_event_id AND rg.side = 'requester'
      AND NOT (rg.group_id = ANY (v_requester));

    INSERT INTO public.event_meeting_rule_groups (tenant_id, event_id, group_id, side)
    SELECT v_tenant, v_event_id, x.gid, 'requester'
    FROM unnest(v_requester) AS x(gid)
    ON CONFLICT (tenant_id, event_id, group_id, side) DO NOTHING;
  END IF;

  IF v_invitee IS NOT NULL THEN
    SELECT x.gid INTO v_bad
    FROM unnest(v_invitee) AS x(gid)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.event_groups g
      WHERE g.id = x.gid AND g.tenant_id = v_tenant AND g.event_id = v_event_id
    )
    LIMIT 1;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'group_not_found: group % does not belong to this event', v_bad;
    END IF;

    DELETE FROM public.event_meeting_rule_groups rg
    WHERE rg.tenant_id = v_tenant AND rg.event_id = v_event_id AND rg.side = 'invitee'
      AND NOT (rg.group_id = ANY (v_invitee));

    INSERT INTO public.event_meeting_rule_groups (tenant_id, event_id, group_id, side)
    SELECT v_tenant, v_event_id, x.gid, 'invitee'
    FROM unnest(v_invitee) AS x(gid)
    ON CONFLICT (tenant_id, event_id, group_id, side) DO NOTHING;
  END IF;

  RETURN public.admin_event_meeting_settings_get(v_event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_settings_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_settings_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_settings_save(jsonb) IS
  'Zapis konfiguracji gieldy JEDNYM wywolaniem: siatka, okno otwarcia, limity, regula i obie listy grup. Zwraca stan po zapisie (ten sam ksztalt co admin_event_meeting_settings_get). Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 21) PANEL: OKNO DOSTEPNOSCI WPISANE PRZEZ ORGANIZATORA
--
-- ISTNIEJE, BO UCZESTNIK BEZ KONTA ISTNIEJE. Kartoteka wydarzenia
-- (20260823150000) dopuszcza `event_people.user_id IS NULL` - czlowiek wpisany
-- przez organizatora, zaimportowany z listy albo zeskanowany przy wejsciu. Taki
-- uczestnik NIE MA jak zadeklarowac wlasnej dostepnosci, a bez deklaracji nie
-- da sie go umowic. Bez tej funkcji gielda dzialalaby wylacznie dla uczestnikow
-- z kontem, czyli dla mniejszosci listy na typowym kongresie.
--
-- Jest to takze jedyna sciezka, ktora pozwala organizatorowi POPRAWIC oczywista
-- pomylke uczestnika (okno wpisane na zly dzien) bez proszenia go o zalogowanie
-- sie w trakcie wydarzenia.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_meeting_availability_set(jsonb);
CREATE FUNCTION public.admin_event_meeting_availability_set(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_registration_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_row public.event_meeting_availability;
  v_event_id uuid;
  v_starts timestamptz;
  v_ends timestamptz;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_row
    FROM public.event_meeting_availability a
    WHERE a.id = v_id AND a.tenant_id = v_tenant;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'not_found: availability window does not exist in this tenant';
    END IF;

    v_event_id := v_row.event_id;
    v_registration_id := v_row.registration_id;
  ELSE
    IF v_registration_id IS NULL THEN
      RAISE EXCEPTION 'invalid_payload: registration_id is required for a new window';
    END IF;

    SELECT r.event_id INTO v_event_id
    FROM public.event_registrations r
    WHERE r.id = v_registration_id
      AND r.tenant_id = v_tenant
      AND r.status IN ('approved', 'attended');

    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'not_found: participating registration does not exist in this tenant';
    END IF;
  END IF;

  v_starts := COALESCE((NULLIF(p_payload->>'starts_at', ''))::timestamptz, v_row.starts_at);
  v_ends := COALESCE((NULLIF(p_payload->>'ends_at', ''))::timestamptz, v_row.ends_at);

  IF v_starts IS NULL OR v_ends IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: starts_at and ends_at are required';
  END IF;

  IF v_ends <= v_starts THEN
    RAISE EXCEPTION 'invalid_window: the window must end after it starts';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.event_meeting_availability (
      tenant_id, event_id, registration_id, starts_at, ends_at, is_open, note, created_by
    ) VALUES (
      v_tenant, v_event_id, v_registration_id, v_starts, v_ends,
      COALESCE((NULLIF(p_payload->>'is_open', ''))::boolean, true),
      NULLIF(btrim(COALESCE(p_payload->>'note', '')), ''),
      auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_meeting_availability SET
      starts_at = v_starts,
      ends_at = v_ends,
      is_open = COALESCE((NULLIF(p_payload->>'is_open', ''))::boolean, is_open),
      note = CASE
        WHEN p_payload ? 'note' THEN NULLIF(btrim(COALESCE(p_payload->>'note', '')), '')
        ELSE note
      END
    WHERE id = v_id AND tenant_id = v_tenant;
  END IF;

  RETURN v_id;
EXCEPTION
  -- Jedyne ograniczenie EXCLUDE na tej tabeli to rozlacznosc okien jednego
  -- uczestnika, wiec przeklad jest jednoznaczny.
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'availability_overlap: this window overlaps another window of the same person';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_availability_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_availability_set(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_availability_set(jsonb) IS
  'Okno dostepnosci wpisane przez organizatora - jedyna sciezka dla uczestnika BEZ KONTA. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 22) PANEL: USUNIECIE OKNA DOSTEPNOSCI
--
-- Okno, w ktorym siedzi spotkanie AKTYWNE albo ODBYTE, nie da sie usunac.
-- Kasowanie go zostawialoby spotkanie poza deklarowana dostepnoscia - czyli
-- stan, ktorego trigger walidacyjny nie przyjalby przy zapisie, a raport
-- pokazywalby jako spotkanie "w czasie, w ktorym czlowieka nie ma".
-- Sciezka wlasciwa dla "nie przyjmuje juz zaproszen" to `is_open = false`.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_meeting_availability_delete(uuid);
CREATE FUNCTION public.admin_event_meeting_availability_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_row public.event_meeting_availability;
  v_blocking integer;
BEGIN
  SELECT * INTO v_row
  FROM public.event_meeting_availability a
  WHERE a.id = _id AND a.tenant_id = v_tenant;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: availability window does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_blocking
  FROM public.event_meeting_attendees a
  WHERE a.tenant_id = v_tenant
    AND a.registration_id = v_row.registration_id
    AND a.status IN ('invited', 'accepted', 'held', 'no_show')
    AND a.time_range && v_row.time_range;

  IF v_blocking > 0 THEN
    RAISE EXCEPTION 'availability_has_meetings: % meeting(s) sit inside this window', v_blocking;
  END IF;

  DELETE FROM public.event_meeting_availability
  WHERE id = _id AND tenant_id = v_tenant;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_availability_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_availability_delete(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_availability_delete(uuid) IS
  'Usuwa okno dostepnosci, w ktorym nie ma zadnego spotkania. W przeciwnym razie blad availability_has_meetings. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 23) PANEL: LISTA SPOTKAN Z FILTRAMI I PAGINACJA
--
-- `total_count` jedzie w KAZDYM wierszu jako funkcja okna - wzorzec
-- `admin_events_list` (20260823130000). Bez niej paginacja wymaga drugiego
-- zapytania z tym samym filtrem, a dwa zapytania rozjezdzaja sie przy kazdej
-- akceptacji miedzy nimi.
--
-- `is_expired` jest LICZONE, a nie odczytane z kolumny stanu (punkt E naglowka):
-- zaproszenie wygasle to `invited` po `expires_at`. Panel potrzebuje tej
-- informacji na kazdym wierszu, bo od niej zalezy, czy przycisk "przypomnij"
-- ma sens.
--
-- DANE KONTAKTOWE NIE WYCHODZA. Lista oddaje imie, nazwisko, stanowisko
-- i firme - to, co identyfikuje czlowieka w rozmowie o spotkaniu. Adres poczty
-- i telefon zostaja w kartotece (`admin_event_registrations_list`), bo tam maja
-- swoj kontekst: zgody i podstawe przetwarzania.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_meetings_list(jsonb);
CREATE FUNCTION public.admin_event_meetings_list(p_payload jsonb)
RETURNS TABLE (
  id uuid,
  status text,
  is_expired boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  expires_at timestamptz,
  requester_registration_id uuid,
  requester_first_name text,
  requester_last_name text,
  requester_job_title text,
  requester_company text,
  requester_group_name_pl text,
  requester_group_name_en text,
  invitee_registration_id uuid,
  invitee_first_name text,
  invitee_last_name text,
  invitee_job_title text,
  invitee_company text,
  invitee_group_name_pl text,
  invitee_group_name_en text,
  table_id uuid,
  table_label text,
  table_zone text,
  table_seat integer,
  topic text,
  sponsor_id uuid,
  sponsor_name text,
  invitation_message text,
  decline_reason text,
  cancel_reason text,
  cancelled_side text,
  responded_at timestamptz,
  cancelled_at timestamptz,
  attendance_marked_at timestamptz,
  rescheduled_from_id uuid,
  created_at timestamptz,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_status text := NULLIF(p_payload->>'status', '');
  v_table_id uuid := NULLIF(p_payload->>'table_id', '')::uuid;
  v_group_id uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_sponsor_id uuid := NULLIF(p_payload->>'sponsor_id', '')::uuid;
  v_day date := (NULLIF(p_payload->>'day', ''))::date;
  v_from timestamptz := (NULLIF(p_payload->>'from', ''))::timestamptz;
  v_to timestamptz := (NULLIF(p_payload->>'to', ''))::timestamptz;
  v_q text := NULLIF(btrim(COALESCE(p_payload->>'q', '')), '');
  v_limit integer := LEAST(GREATEST(COALESCE((NULLIF(p_payload->>'limit', ''))::integer, 25), 1), 200);
  v_offset integer := GREATEST(COALESCE((NULLIF(p_payload->>'offset', ''))::integer, 0), 0);
  v_timezone text;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  -- Filtr "dzien" liczy sie w strefie GIELDY, nie w strefie serwera: kongres
  -- w Brukseli ma dzien drugi od 9:00 czasu brukselskiego, a nie od 2:00 UTC.
  SELECT COALESCE(s.timezone, e.timezone, 'Europe/Warsaw') INTO v_timezone
  FROM public.events e
  LEFT JOIN public.event_meeting_settings s
    ON s.tenant_id = e.tenant_id AND s.event_id = e.id
  WHERE e.id = v_event_id AND e.tenant_id = v_tenant;

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  RETURN QUERY
  SELECT
    m.id, m.status,
    (m.status = 'invited' AND m.expires_at < now()),
    m.starts_at, m.ends_at, m.expires_at,
    m.requester_registration_id,
    rp.first_name, rp.last_name, rp.job_title,
    COALESCE(rc.name, rp.company_text),
    rg.name_pl, rg.name_en,
    m.invitee_registration_id,
    ip.first_name, ip.last_name, ip.job_title,
    COALESCE(ic.name, ip.company_text),
    ig.name_pl, ig.name_en,
    m.table_id, t.label, t.zone, m.table_seat,
    m.topic, m.sponsor_id, sp.snapshot_name,
    m.invitation_message, m.decline_reason, m.cancel_reason, m.cancelled_side,
    m.responded_at, m.cancelled_at, m.attendance_marked_at, m.rescheduled_from_id,
    m.created_at,
    count(*) OVER ()::integer
  FROM public.event_meetings m
  JOIN public.event_registrations rr
    ON rr.id = m.requester_registration_id AND rr.tenant_id = m.tenant_id
  JOIN public.event_people rp
    ON rp.id = rr.person_id AND rp.tenant_id = rr.tenant_id
  LEFT JOIN public.crm_companies rc
    ON rc.id = rp.company_id AND rc.tenant_id = rp.tenant_id
  LEFT JOIN public.event_groups rg
    ON rg.id = rr.group_id AND rg.tenant_id = rr.tenant_id
  JOIN public.event_registrations ir
    ON ir.id = m.invitee_registration_id AND ir.tenant_id = m.tenant_id
  JOIN public.event_people ip
    ON ip.id = ir.person_id AND ip.tenant_id = ir.tenant_id
  LEFT JOIN public.crm_companies ic
    ON ic.id = ip.company_id AND ic.tenant_id = ip.tenant_id
  LEFT JOIN public.event_groups ig
    ON ig.id = ir.group_id AND ig.tenant_id = ir.tenant_id
  LEFT JOIN public.event_meeting_tables t
    ON t.id = m.table_id AND t.tenant_id = m.tenant_id
  LEFT JOIN public.event_sponsors sp
    ON sp.id = m.sponsor_id AND sp.tenant_id = m.tenant_id
  WHERE m.tenant_id = v_tenant
    AND m.event_id = v_event_id
    AND (
      v_status IS NULL
      OR v_status = 'all'
      OR (v_status = 'expired' AND m.status = 'invited' AND m.expires_at < now())
      OR (v_status = 'pending' AND m.status = 'invited' AND m.expires_at >= now())
      OR m.status = v_status
    )
    AND (v_table_id IS NULL OR m.table_id = v_table_id)
    AND (v_sponsor_id IS NULL OR m.sponsor_id = v_sponsor_id)
    AND (v_group_id IS NULL OR rr.group_id = v_group_id OR ir.group_id = v_group_id)
    AND (v_day IS NULL OR (m.starts_at AT TIME ZONE v_timezone)::date = v_day)
    AND (v_from IS NULL OR m.starts_at >= v_from)
    AND (v_to IS NULL OR m.starts_at < v_to)
    AND (
      v_q IS NULL
      OR rp.full_name_norm LIKE '%' || lower(v_q) || '%'
      OR ip.full_name_norm LIKE '%' || lower(v_q) || '%'
      OR rp.company_text ILIKE '%' || v_q || '%'
      OR ip.company_text ILIKE '%' || v_q || '%'
      OR rc.name ILIKE '%' || v_q || '%'
      OR ic.name ILIKE '%' || v_q || '%'
      OR m.topic ILIKE '%' || v_q || '%'
    )
  ORDER BY m.starts_at DESC, m.created_at DESC, m.id DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meetings_list(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meetings_list(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meetings_list(jsonb) IS
  'Lista spotkan wydarzenia z filtrami (stan, stolik, grupa, sponsor, dzien w strefie gieldy, fraza), licznikiem calosci i liczonym stanem wygasniecia. Bez danych kontaktowych. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 24) PANEL: STATYSTYKI GIELDY
--
-- KAZDA LICZBA TU MA ZA SOBA PROCES, KTORY JA ZAPISUJE. Nie ma tu ani jednej
-- metryki liczonej z niczego:
--   * liczniki stanow      <- event_meetings.status, pisany przez RPC modulu;
--   * wskaznik akceptacji  <- iloraz stanow, nie osobna kolumna;
--   * obciazenie stolikow  <- zajete miejsca kontra SIATKA razy pojemnosc,
--                             gdzie siatka liczy sie z konfiguracji gieldy;
--   * uczestnicy bez ani jednego spotkania <- roznica miedzy zapisami
--                             uczestniczacymi a uczestnikami wystepujacymi
--                             w projekcji uczestnictwa;
--   * uczestnicy bez deklaracji dostepnosci <- to samo po
--                             event_meeting_availability.
-- Ostatnie dwie liczby sa najwazniejsze operacyjnie: obie wskazuja LISTE OSOB,
-- do ktorych organizator ma napisac, a nie stan swiata do podziwiania. Dlatego
-- zwracamy takze te listy (do 50 osob), a nie tylko liczniki.
--
-- Wskaznik akceptacji liczy sie z ROZSTRZYGNIETYCH, nie z wyslanych: zaproszenia
-- jeszcze wiszace nie sa ani przyjete, ani odrzucone, a wliczanie ich do
-- mianownika zanizalo by wskaznik przez cale okno waznosci.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_meeting_stats(uuid);
CREATE FUNCTION public.admin_event_meeting_stats(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_timezone text;
  v_grid_slots integer;
  v_out jsonb;
BEGIN
  SELECT COALESCE(s.timezone, e.timezone, 'Europe/Warsaw') INTO v_timezone
  FROM public.events e
  LEFT JOIN public.event_meeting_settings s
    ON s.tenant_id = e.tenant_id AND s.event_id = e.id
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  -- Liczba slotow calej siatki. Mianownik obciazenia stolikow: miejsce przy
  -- stoliku moze byc zajete najwyzej raz na slot, wiec pojemnosc gieldy to
  -- (liczba slotow) x (suma pojemnosci aktywnych stolikow).
  SELECT count(*)::integer INTO v_grid_slots
  FROM public.event_meeting_settings s
  CROSS JOIN unnest(s.meeting_days) AS d(dd)
  CROSS JOIN generate_series(
    ((d.dd + s.day_start_time) AT TIME ZONE s.timezone),
    ((d.dd + s.day_end_time) AT TIME ZONE s.timezone) - make_interval(mins => s.slot_minutes),
    make_interval(mins => s.slot_minutes + s.break_minutes)
  ) AS g(slot_start)
  WHERE s.tenant_id = v_tenant AND s.event_id = p_event_id;

  SELECT jsonb_build_object(
    'total', count(*),
    'invited', count(*) FILTER (WHERE m.status = 'invited' AND m.expires_at >= now()),
    'expired', count(*) FILTER (WHERE m.status = 'invited' AND m.expires_at < now()),
    'accepted', count(*) FILTER (WHERE m.status = 'accepted'),
    'declined', count(*) FILTER (WHERE m.status = 'declined'),
    'cancelled', count(*) FILTER (WHERE m.status = 'cancelled'),
    'rescheduled', count(*) FILTER (WHERE m.status = 'rescheduled'),
    'held', count(*) FILTER (WHERE m.status = 'held'),
    'no_show', count(*) FILTER (WHERE m.status = 'no_show'),
    'confirmed', count(*) FILTER (WHERE m.status IN ('accepted', 'held', 'no_show')),
    'acceptance_rate', CASE
      WHEN count(*) FILTER (
        WHERE m.status IN ('accepted', 'held', 'no_show', 'declined')
      ) = 0 THEN NULL
      ELSE round(
        100.0 * count(*) FILTER (WHERE m.status IN ('accepted', 'held', 'no_show'))
        / count(*) FILTER (WHERE m.status IN ('accepted', 'held', 'no_show', 'declined'))
      )::integer
    END,
    'attendance_rate', CASE
      WHEN count(*) FILTER (WHERE m.status IN ('held', 'no_show')) = 0 THEN NULL
      ELSE round(
        100.0 * count(*) FILTER (WHERE m.status = 'held')
        / count(*) FILTER (WHERE m.status IN ('held', 'no_show'))
      )::integer
    END
  )
  INTO v_out
  FROM public.event_meetings m
  WHERE m.tenant_id = v_tenant AND m.event_id = p_event_id;

  v_out := COALESCE(v_out, '{}'::jsonb) || jsonb_build_object(
    'grid_slots', COALESCE(v_grid_slots, 0),
    'timezone', v_timezone,
    'seats_count', (
      SELECT COALESCE(sum(t.capacity), 0)::integer
      FROM public.event_meeting_tables t
      WHERE t.tenant_id = v_tenant AND t.event_id = p_event_id AND t.is_active
    ),
    'participants_count', (
      SELECT count(*)::integer FROM public.event_registrations r
      WHERE r.tenant_id = v_tenant AND r.event_id = p_event_id
        AND r.status IN ('approved', 'attended')
    ),
    'with_availability_count', (
      SELECT count(DISTINCT a.registration_id)::integer
      FROM public.event_meeting_availability a
      WHERE a.tenant_id = v_tenant AND a.event_id = p_event_id AND a.is_open
    ),
    'with_meeting_count', (
      SELECT count(DISTINCT a.registration_id)::integer
      FROM public.event_meeting_attendees a
      WHERE a.tenant_id = v_tenant AND a.event_id = p_event_id
        AND a.status IN ('accepted', 'held', 'no_show')
    )
  );

  v_out := v_out || jsonb_build_object(
    'without_meeting_count',
      GREATEST((v_out->>'participants_count')::integer - (v_out->>'with_meeting_count')::integer, 0),
    'without_availability_count',
      GREATEST(
        (v_out->>'participants_count')::integer - (v_out->>'with_availability_count')::integer,
        0
      )
  );

  -- Obciazenie per stolik. `utilisation_pct` moze byc NULL, gdy siatka jest
  -- pusta - i to jest poprawna odpowiedz, a nie zero: bez skonfigurowanych dni
  -- gieldy nie ma czego dzielic.
  v_out := v_out || jsonb_build_object('tables', COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'sort_order', x->>'label')
    FROM (
      SELECT jsonb_build_object(
        'table_id', t.id,
        'label', t.label,
        'zone', t.zone,
        'capacity', t.capacity,
        'sort_order', t.sort_order,
        'is_active', t.is_active,
        'slots_taken', COALESCE(u.cnt, 0),
        'slots_capacity', COALESCE(v_grid_slots, 0) * t.capacity,
        'utilisation_pct', CASE
          WHEN COALESCE(v_grid_slots, 0) = 0 THEN NULL
          ELSE round(100.0 * COALESCE(u.cnt, 0) / (v_grid_slots * t.capacity))::integer
        END
      ) AS x
      FROM public.event_meeting_tables t
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS cnt
        FROM public.event_meetings m
        WHERE m.tenant_id = t.tenant_id
          AND m.table_id = t.id
          AND m.status IN ('accepted', 'held', 'no_show')
      ) u ON true
      WHERE t.tenant_id = v_tenant AND t.event_id = p_event_id
    ) AS tables_agg
  ), '[]'::jsonb));

  -- Rozklad po dniach gieldy: gdzie sie tloczy, gdzie jest pusto.
  v_out := v_out || jsonb_build_object('by_day', COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'day')
    FROM (
      SELECT jsonb_build_object(
        'day', (m.starts_at AT TIME ZONE v_timezone)::date,
        'confirmed', count(*) FILTER (WHERE m.status IN ('accepted', 'held', 'no_show')),
        'invited', count(*) FILTER (WHERE m.status = 'invited'),
        'total', count(*)
      ) AS x
      FROM public.event_meetings m
      WHERE m.tenant_id = v_tenant AND m.event_id = p_event_id
      GROUP BY (m.starts_at AT TIME ZONE v_timezone)::date
    ) AS days_agg
  ), '[]'::jsonb));

  -- LISTA OSOB BEZ ANI JEDNEGO SPOTKANIA. To nie jest metryka, to zadanie do
  -- wykonania: do tych ludzi organizator pisze, zeby gielda mial sens. Limit
  -- 50 osob, bo dluzsza lista i tak idzie eksportem z listy zapisow.
  v_out := v_out || jsonb_build_object('without_meeting', COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'last_name', x->>'first_name')
    FROM (
      SELECT jsonb_build_object(
        'registration_id', r.id,
        'first_name', p.first_name,
        'last_name', p.last_name,
        'job_title', p.job_title,
        'company', COALESCE(c.name, p.company_text),
        'has_availability', EXISTS (
          SELECT 1 FROM public.event_meeting_availability a
          WHERE a.tenant_id = r.tenant_id AND a.registration_id = r.id AND a.is_open
        )
      ) AS x
      FROM public.event_registrations r
      JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      LEFT JOIN public.crm_companies c ON c.id = p.company_id AND c.tenant_id = p.tenant_id
      WHERE r.tenant_id = v_tenant
        AND r.event_id = p_event_id
        AND r.status IN ('approved', 'attended')
        AND NOT EXISTS (
          SELECT 1 FROM public.event_meeting_attendees a
          WHERE a.tenant_id = r.tenant_id
            AND a.registration_id = r.id
            AND a.status IN ('accepted', 'held', 'no_show')
        )
      ORDER BY p.last_name, p.first_name, r.id
      LIMIT 50
    ) AS lonely
  ), '[]'::jsonb));

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_stats(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_stats(uuid) IS
  'Statystyki gieldy: liczniki stanow, wskaznik akceptacji i frekwencji, obciazenie stolikow wzgledem siatki, rozklad po dniach oraz LISTA uczestnikow bez ani jednego spotkania. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 25) PANEL: FREKWENCJA I ODWOLANIE PRZEZ ORGANIZATORA
--
-- JEDNA FUNKCJA NA TRZY PRZEJSCIA, bo wszystkie trzy sa ta sama operacja
-- z punktu widzenia uprawnien i sladu: organizator rozstrzyga o spotkaniu, ktore
-- do niego nie nalezy. Trzy osobne funkcje powtarzalyby te sama bramke, ten sam
-- odczyt wiersza i ten sam emiter, roznic sie jedna linia UPDATE-u.
--
-- `held` i `no_show` sa STANAMI PO SPOTKANIU i wolno je nadac wylacznie
-- spotkaniu PRZYJETEMU (albo poprawic wczesniejsze oznaczenie). Oznaczenie
-- frekwencji na zaproszeniu, ktorego nikt nie przyjal, byloby zapisem faktu,
-- ktorego nie bylo - a te dwie liczby ida potem do raportu i do rozliczenia
-- z partnerem.
--
-- ODWOLANIE ZOSTAWIA STOLIK W WIERSZU. Warunek czesciowy ograniczenia
-- `event_meetings_table_no_overlap` nie obejmuje stanu `cancelled`, wiec miejsce
-- jest wolne natychmiast; kolumna zostaje jako slad, gdzie to spotkanie MIALO
-- sie odbyc. Wyczyszczenie jej odebralo by organizatorowi mozliwosc
-- odpowiedzenia na pytanie "co bylo zaplanowane przy stoliku 12".
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_meeting_set_status(jsonb);
CREATE FUNCTION public.admin_event_meeting_set_status(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_meeting_id uuid := NULLIF(p_payload->>'meeting_id', '')::uuid;
  v_status text := NULLIF(p_payload->>'status', '');
  v_reason text := NULLIF(btrim(COALESCE(p_payload->>'reason', '')), '');
  v_row public.event_meetings;
BEGIN
  IF v_meeting_id IS NULL OR v_status IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: meeting_id and status are required';
  END IF;

  IF v_status NOT IN ('held', 'no_show', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status: the organiser may set held, no_show or cancelled';
  END IF;

  SELECT * INTO v_row
  FROM public.event_meetings m
  WHERE m.id = v_meeting_id AND m.tenant_id = v_tenant
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: meeting does not exist in this tenant';
  END IF;

  IF v_status IN ('held', 'no_show') THEN
    IF v_row.status NOT IN ('accepted', 'held', 'no_show') THEN
      RAISE EXCEPTION 'attendance_needs_accepted: attendance can only be marked on an accepted meeting';
    END IF;

    UPDATE public.event_meetings
    SET status = v_status,
        attendance_marked_at = now(),
        attendance_marked_by = auth.uid()
    WHERE id = v_meeting_id AND tenant_id = v_tenant;
  ELSE
    IF v_row.status NOT IN ('invited', 'accepted') THEN
      RAISE EXCEPTION 'meeting_not_active: only an open invitation or an accepted meeting can be cancelled';
    END IF;

    UPDATE public.event_meetings
    SET status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancelled_side = 'organiser',
        cancel_reason = v_reason
    WHERE id = v_meeting_id AND tenant_id = v_tenant;
  END IF;

  -- Szyna zdarzen: zmiana narzucona z zewnatrz jest faktem, o ktorym musza
  -- dowiedziec sie powiadomienia obu stron. Emiter lapie wlasny wyjatek, wiec
  -- awaria szyny nie wywraca decyzji organizatora.
  PERFORM public.emit_domain_event(
    v_tenant,
    'event_meeting',
    v_meeting_id::text,
    'event_meeting.' || v_status || '.v1',
    jsonb_build_object(
      'event_id', v_row.event_id,
      'meeting_id', v_meeting_id,
      'by', 'organiser',
      'starts_at', v_row.starts_at
    ),
    auth.uid()
  );

  RETURN jsonb_build_object('meeting_id', v_meeting_id, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_set_status(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_set_status(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_set_status(jsonb) IS
  'Organizator oznacza frekwencje (held / no_show) albo odwoluje spotkanie (cancelled). Frekwencje wolno nadac wylacznie spotkaniu przyjetemu. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 26) PANEL: WOLNE TERMINY DLA WSKAZANEJ PARY
--
-- Ten sam rdzen co dla uczestnika (`_event_meeting_free_slots`), inna bramka
-- i inny podmiot: organizator pyta o DOWOLNA pare, uczestnik wylacznie o pare
-- z soba. Dwie funkcje nad jednym rdzeniem, a nie jedna z flaga "jestem
-- adminem" - flaga w ciele funkcji SECURITY DEFINER to wektor, ktory kiedys
-- ktos poda z klienta.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_meeting_free_slots(jsonb);
CREATE FUNCTION public.admin_event_meeting_free_slots(p_payload jsonb)
RETURNS TABLE (
  starts_at timestamptz,
  ends_at timestamptz,
  table_id uuid,
  table_label text,
  table_zone text,
  table_seat integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_a uuid := NULLIF(p_payload->>'a_registration_id', '')::uuid;
  v_b uuid := NULLIF(p_payload->>'b_registration_id', '')::uuid;
BEGIN
  IF v_event_id IS NULL OR v_a IS NULL OR v_b IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id, a_registration_id and b_registration_id are required';
  END IF;

  IF v_a = v_b THEN
    RAISE EXCEPTION 'self_invite: a person cannot meet themselves';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  RETURN QUERY
  SELECT f.starts_at, f.ends_at, f.table_id, f.table_label, f.table_zone, f.table_seat
  FROM public._event_meeting_free_slots(
    v_tenant, v_event_id, v_a, v_b,
    (NULLIF(p_payload->>'from', ''))::timestamptz,
    (NULLIF(p_payload->>'to', ''))::timestamptz,
    (NULLIF(p_payload->>'limit', ''))::integer
  ) f;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_free_slots(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_free_slots(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_free_slots(jsonb) IS
  'Wolne terminy dla wskazanej pary uczestnikow - widok organizatora nad tym samym rdzeniem co event_meeting_free_slots. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 27) PANEL: SPOTKANIE UMOWIONE PRZEZ ORGANIZATORA
--
-- ISTNIEJE, BO PAKIETY SPONSORSKIE TO OBIECUJA. Poziom sponsorski
-- (20260823160000) sprzedaje sie ze zdaniem "dziesiec umowionych spotkan
-- z decydentami" - i ktos musi je umowic. Bez tej funkcji organizator moglby
-- wylacznie poprosic dwie osoby, zeby zaprosily sie same, i liczyc, ze zdaza.
--
-- SPOTKANIE POWSTAJE OD RAZU PRZYJETE, ze stolikiem przydzielonym pod blokada.
-- Zaproszenie wymagajace akceptacji byloby tu falszem: organizator nie proponuje
-- spotkania, on je umawia - i tak samo brzmi obietnica w umowie sponsorskiej.
--
-- CZEGO ORGANIZATOR NIE OMIJA: obie strony musza byc zapisami
-- UCZESTNICZACYMI, termin musi lezec w siatce i w OTWARTYCH oknach dostepnosci
-- obu stron (trigger walidacyjny), zaden z uczestnikow nie moze miec w tym
-- czasie innego zajetego spotkania (EXCLUDE na projekcji), a limit dzienny
-- obowiazuje. To nie sa reguly grzecznosciowe - to warunki, przy ktorych
-- spotkanie ma szanse sie odbyc.
--
-- CO OMIJA: regule widocznosci gieldy i limit zaproszen na osobe. Oba sa
-- narzedziami porzadkujacymi SAMOOBSLUGE uczestnikow, a nie granicami wladzy
-- organizatora nad wlasnym wydarzeniem.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_meeting_arrange(jsonb);
CREATE FUNCTION public.admin_event_meeting_arrange(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_a uuid := NULLIF(p_payload->>'requester_registration_id', '')::uuid;
  v_b uuid := NULLIF(p_payload->>'invitee_registration_id', '')::uuid;
  v_starts timestamptz := (NULLIF(p_payload->>'starts_at', ''))::timestamptz;
  v_preferred_table uuid := NULLIF(p_payload->>'table_id', '')::uuid;
  v_settings public.event_meeting_settings;
  v_ends timestamptz;
  v_seat record;
  v_has_tables boolean;
  v_id uuid;
  v_day date;
  v_taken integer;
BEGIN
  IF v_event_id IS NULL OR v_a IS NULL OR v_b IS NULL OR v_starts IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id, both registrations and starts_at are required';
  END IF;

  IF v_a = v_b THEN
    RAISE EXCEPTION 'self_invite: a person cannot meet themselves';
  END IF;

  SELECT * INTO v_settings
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id;

  IF v_settings.id IS NULL OR NOT v_settings.is_enabled THEN
    RAISE EXCEPTION 'meetings_disabled: the meeting exchange is not enabled for this event';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant AND r.event_id = v_event_id AND r.id = v_a
      AND r.status IN ('approved', 'attended')
  ) THEN
    RAISE EXCEPTION 'requester_not_participating: the first person is not a participating registration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant AND r.event_id = v_event_id AND r.id = v_b
      AND r.status IN ('approved', 'attended')
  ) THEN
    RAISE EXCEPTION 'invitee_not_participating: the second person is not a participating registration';
  END IF;

  v_ends := v_starts + make_interval(mins => v_settings.slot_minutes);
  v_day := (v_starts AT TIME ZONE v_settings.timezone)::date;

  -- Limit dzienny obowiazuje TAKZE organizatora - uzasadnienie nad funkcja.
  IF v_settings.max_meetings_per_day IS NOT NULL THEN
    SELECT max(x.taken)::integer INTO v_taken
    FROM (
      SELECT count(*)::integer AS taken
      FROM public.event_meeting_attendees a
      WHERE a.tenant_id = v_tenant
        AND a.event_id = v_event_id
        AND a.registration_id IN (v_a, v_b)
        AND a.status IN ('accepted', 'held', 'no_show')
        AND (a.starts_at AT TIME ZONE v_settings.timezone)::date = v_day
      GROUP BY a.registration_id
    ) x;

    IF COALESCE(v_taken, 0) >= v_settings.max_meetings_per_day THEN
      RAISE EXCEPTION 'daily_limit_reached: one of the parties already has % meeting(s) that day',
        v_taken;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.event_meeting_tables t
    WHERE t.tenant_id = v_tenant AND t.event_id = v_event_id AND t.is_active
  ) INTO v_has_tables;

  SELECT s.out_table_id, s.out_table_seat INTO v_seat
  FROM public._event_meeting_take_seat(
    v_tenant, v_event_id, v_starts, v_ends, v_preferred_table, NULL
  ) s;

  IF v_has_tables AND v_seat.out_table_id IS NULL THEN
    RAISE EXCEPTION 'no_free_table: no free seat at any active table in this slot';
  END IF;

  INSERT INTO public.event_meetings (
    tenant_id, event_id, requester_registration_id, invitee_registration_id,
    starts_at, ends_at, table_id, table_seat, status,
    topic, sponsor_id, invitation_message,
    expires_at, invited_by, responded_at, responded_by
  ) VALUES (
    v_tenant, v_event_id, v_a, v_b,
    v_starts, v_ends, v_seat.out_table_id, v_seat.out_table_seat, 'accepted',
    NULLIF(btrim(COALESCE(p_payload->>'topic', '')), ''),
    NULLIF(p_payload->>'sponsor_id', '')::uuid,
    NULLIF(btrim(COALESCE(p_payload->>'message', '')), ''),
    -- Spotkanie umowione nie czeka na nikogo, wiec jego termin waznosci
    -- pokrywa sie z poczatkiem spotkania (CHECK expiry_before_start i tak
    -- nie pozwolil by na wiecej).
    v_starts,
    auth.uid(),
    now(),
    auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_meeting',
    v_id::text,
    'event_meeting.arranged.v1',
    jsonb_build_object(
      'event_id', v_event_id,
      'meeting_id', v_id,
      'requester_registration_id', v_a,
      'invitee_registration_id', v_b,
      'starts_at', v_starts
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'meeting_id', v_id,
    'status', 'accepted',
    'starts_at', v_starts,
    'ends_at', v_ends,
    'table_id', v_seat.out_table_id,
    'table_seat', v_seat.out_table_seat
  );
EXCEPTION
  -- Dwa ograniczenia EXCLUDE moga tu zaprotestowac, a komunikat musi wskazac
  -- WLASCIWY powod: zajete miejsce przy stoliku i zajety termin uczestnika sa
  -- dla organizatora dwiema roznymi decyzjami.
  WHEN exclusion_violation THEN
    DECLARE
      v_constraint text;
    BEGIN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'event_meeting_attendees_no_overlap' THEN
        RAISE EXCEPTION 'participant_busy: one of the parties already has a meeting in this slot';
      END IF;
      RAISE EXCEPTION 'table_busy: the seat at this table is already taken in this slot';
    END;
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_meeting: this pair already has an active meeting in this slot';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_meeting_arrange(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_meeting_arrange(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_meeting_arrange(jsonb) IS
  'Organizator umawia spotkanie od razu przyjete, ze stolikiem przydzielonym pod blokada. Nie omija siatki, okien dostepnosci, kolizji ani limitu dziennego; omija regule widocznosci i limit zaproszen. Bramka: assert_editor_tenant().';

-- ============================================================================
-- PLASZCZYZNA UCZESTNIKA
--
-- Kazda funkcja ponizej wiaze dane z tenantem NAGLOWKA HOSTA
-- (`public_tenant_id()`) - tak jak cala plaszczyzna tresci wydarzenia
-- (`event_agenda`, `event_register`, `event_page_header`). Zadna z nich NIE WOLA
-- `has_role()` ani `is_staff()`: naglowek hosta jest falsyfikowalny, wiec
-- polaczenie go z bramka roli pozwolilo by podszyc sie pod najemce (bramka
-- `check:sql-tenant-scope`, przyczyna zrodlowa w migracji 20260724091000).
--
-- Podmiotem jest ZAWSZE zapis wolajacego, ustalony lancuchem
-- konto -> kartoteka -> zapis (`_event_meeting_caller_registration`). Uczestnik
-- nie podaje wlasnego identyfikatora zapisu w payloadzie i nie moze go podac -
-- to jedyna rzecz, ktora chroni te funkcje przed dzialaniem w cudzym imieniu.
--
-- `anon` NIE DOSTAJE GRANTU na zadna z nich. Gielda spotkan wymaga tozsamosci
-- po obu stronach; niezalogowany nie ma czego tu robic ani czego zobaczyc.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 28) UCZESTNIK: STAN GIELDY
--
-- JEDNO WYWOLANIE NA CALY EKRAN. Uczestnik otwierajacy gielde musi wiedziec
-- naraz: czy gielda dziala, w jakich godzinach i dniach, ile zaproszen mu
-- zostalo, ile spotkan ma dziennie, czy jego grupa w ogole moze sie umawiac
-- i jakie okna dostepnosci juz zadeklarowal. Rozbicie tego na piec wywolan
-- daje piec stanow wczytywania na jednym ekranie, ktory bez wszystkich pieciu
-- nie ma sensu.
--
-- LICZNIK ZAPROSZEN JEST LICZONY, NIE PRZECHOWYWANY. Kolumna licznikowa na
-- zapisie rozjechalaby sie przy pierwszym odwolaniu, ktore jej nie zmniejszylo,
-- i nikt by tego nie zauwazyl - a to jest liczba, ktora uczestnik widzi na
-- ekranie i wedlug ktorej planuje.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_meeting_exchange(jsonb);
CREATE FUNCTION public.event_meeting_exchange(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug', '')), '');
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_settings public.event_meeting_settings;
  v_me uuid;
  v_can_meet boolean := false;
  v_invites_used integer := 0;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'published'
    AND ((v_event_id IS NOT NULL AND e.id = v_event_id) OR (v_slug IS NOT NULL AND e.slug = v_slug));

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  SELECT * INTO v_settings
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id;

  v_me := public._event_meeting_caller_registration(v_tenant, v_event_id);

  IF v_me IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public._event_meeting_groups(v_tenant, v_event_id, v_me) AS mg(group_id)
      JOIN public.event_groups g ON g.id = mg.group_id AND g.tenant_id = v_tenant
      WHERE g.can_meet
    ) INTO v_can_meet;

    SELECT count(*)::integer INTO v_invites_used
    FROM public.event_meetings m
    WHERE m.tenant_id = v_tenant
      AND m.event_id = v_event_id
      AND m.requester_registration_id = v_me
      AND m.status IN ('invited', 'accepted');
  END IF;

  v_out := jsonb_build_object(
    'event_id', v_event_id,
    'configured', v_settings.id IS NOT NULL,
    'is_enabled', COALESCE(v_settings.is_enabled, false),
    'visibility', COALESCE(v_settings.visibility, 'disabled'),
    'slot_minutes', v_settings.slot_minutes,
    'break_minutes', v_settings.break_minutes,
    'day_start_time', v_settings.day_start_time,
    'day_end_time', v_settings.day_end_time,
    'meeting_days', COALESCE(to_jsonb(v_settings.meeting_days), '[]'::jsonb),
    'timezone', v_settings.timezone,
    'invites_open_at', v_settings.invites_open_at,
    'invites_close_at', v_settings.invites_close_at,
    -- Jedna wartosc logiczna zamiast dwoch dat do porownania po stronie
    -- klienta: zegar przegladarki nie jest zegarem, wedlug ktorego baza
    -- odrzuca zaproszenie.
    'open_now', COALESCE(v_settings.is_enabled, false)
      AND COALESCE(v_settings.visibility, 'disabled') <> 'disabled'
      AND (v_settings.invites_open_at IS NULL OR v_settings.invites_open_at <= now())
      AND (v_settings.invites_close_at IS NULL OR v_settings.invites_close_at > now()),
    'intro_pl', COALESCE(v_settings.intro_pl, ''),
    'intro_en', COALESCE(v_settings.intro_en, ''),
    'invite_expires_after_hours', v_settings.invite_expires_after_hours,
    'max_invites_per_person', v_settings.max_invites_per_person,
    'max_meetings_per_day', v_settings.max_meetings_per_day,
    'my_registration_id', v_me,
    'can_meet', v_can_meet,
    'invites_used', v_invites_used,
    'invites_left', CASE
      WHEN v_settings.max_invites_per_person IS NULL THEN NULL
      ELSE GREATEST(v_settings.max_invites_per_person - v_invites_used, 0)
    END,
    'tables_count', (
      SELECT count(*)::integer FROM public.event_meeting_tables t
      WHERE t.tenant_id = v_tenant AND t.event_id = v_event_id AND t.is_active
    )
  );

  v_out := v_out || jsonb_build_object('my_availability', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', a.id,
      'starts_at', a.starts_at,
      'ends_at', a.ends_at,
      'is_open', a.is_open,
      'note', a.note
    ) ORDER BY a.starts_at)
    FROM public.event_meeting_availability a
    WHERE a.tenant_id = v_tenant
      AND a.event_id = v_event_id
      AND v_me IS NOT NULL
      AND a.registration_id = v_me
  ), '[]'::jsonb));

  v_out := v_out || jsonb_build_object('my_meetings_summary', (
    SELECT jsonb_build_object(
      'incoming_pending', count(*) FILTER (
        WHERE m.status = 'invited' AND m.expires_at >= now()
          AND m.invitee_registration_id = v_me
      ),
      'outgoing_pending', count(*) FILTER (
        WHERE m.status = 'invited' AND m.expires_at >= now()
          AND m.requester_registration_id = v_me
      ),
      'accepted', count(*) FILTER (WHERE m.status = 'accepted'),
      'held', count(*) FILTER (WHERE m.status = 'held')
    )
    FROM public.event_meetings m
    WHERE m.tenant_id = v_tenant
      AND m.event_id = v_event_id
      AND v_me IS NOT NULL
      AND v_me IN (m.requester_registration_id, m.invitee_registration_id)
  ));

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_exchange(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_exchange(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_exchange(jsonb) IS
  'Stan gieldy dla wolajacego uczestnika jednym wywolaniem: siatka, okno otwarcia, limity z licznikiem zuzycia, uprawnienie grupy, wlasne okna dostepnosci i podsumowanie wlasnych spotkan. Plaszczyzna tresci (public_tenant_id).';

-- ----------------------------------------------------------------------------
-- 29) UCZESTNIK: ZAPIS WLASNEGO OKNA DOSTEPNOSCI
--
-- Uczestnik NIE PODAJE swojego identyfikatora zapisu - funkcja ustala go
-- z konta. Payload z `registration_id` byl by tu dziura: kazdy zalogowany
-- moglby wpisac okno dostepnosci komus innemu i tym samym otworzyc go na
-- zaproszenia albo zamknac przed nimi.
--
-- Nakladanie sie okien odrzuca ograniczenie EXCLUDE; funkcja tlumaczy jego kod
-- na komunikat, ktory mowi, CO SIE STALO - bo surowy `23P01` z nazwa
-- ograniczenia nie mowi uczestnikowi niczego.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_meeting_availability_set(jsonb);
CREATE FUNCTION public.event_meeting_availability_set(p_payload jsonb)
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
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_me uuid;
  v_row public.event_meeting_availability;
  v_starts timestamptz := (NULLIF(p_payload->>'starts_at', ''))::timestamptz;
  v_ends timestamptz := (NULLIF(p_payload->>'ends_at', ''))::timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'published'
    AND ((v_event_id IS NOT NULL AND e.id = v_event_id) OR (v_slug IS NOT NULL AND e.slug = v_slug));

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  v_me := public._event_meeting_caller_registration(v_tenant, v_event_id);
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_registered: only a participant of this event can declare availability';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_meeting_settings s
    WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id AND s.is_enabled
  ) THEN
    RAISE EXCEPTION 'meetings_disabled: the meeting exchange is not enabled for this event';
  END IF;

  IF v_id IS NOT NULL THEN
    -- Wlasne okno, i tylko wlasne. Warunek `registration_id = v_me` jest tu
    -- calym mechanizmem autoryzacji tej sciezki.
    SELECT * INTO v_row
    FROM public.event_meeting_availability a
    WHERE a.id = v_id AND a.tenant_id = v_tenant AND a.registration_id = v_me;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'not_found: this availability window is not yours';
    END IF;
  END IF;

  v_starts := COALESCE(v_starts, v_row.starts_at);
  v_ends := COALESCE(v_ends, v_row.ends_at);

  IF v_starts IS NULL OR v_ends IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: starts_at and ends_at are required';
  END IF;

  IF v_ends <= v_starts THEN
    RAISE EXCEPTION 'invalid_window: the window must end after it starts';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.event_meeting_availability (
      tenant_id, event_id, registration_id, starts_at, ends_at, is_open, note, created_by
    ) VALUES (
      v_tenant, v_event_id, v_me, v_starts, v_ends,
      COALESCE((NULLIF(p_payload->>'is_open', ''))::boolean, true),
      NULLIF(btrim(COALESCE(p_payload->>'note', '')), ''),
      v_uid
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_meeting_availability SET
      starts_at = v_starts,
      ends_at = v_ends,
      is_open = COALESCE((NULLIF(p_payload->>'is_open', ''))::boolean, is_open),
      note = CASE
        WHEN p_payload ? 'note' THEN NULLIF(btrim(COALESCE(p_payload->>'note', '')), '')
        ELSE note
      END
    WHERE id = v_id AND tenant_id = v_tenant AND registration_id = v_me;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'starts_at', v_starts,
    'ends_at', v_ends
  );
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'availability_overlap: this window overlaps another window you already declared';
  WHEN check_violation THEN
    RAISE EXCEPTION 'invalid_window: the window must last between 15 minutes and 16 hours';
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_availability_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_availability_set(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_availability_set(jsonb) IS
  'Uczestnik deklaruje albo poprawia WLASNE okno dostepnosci. Identyfikator zapisu ustalany z konta, nie z payloadu. Plaszczyzna tresci (public_tenant_id).';

-- ----------------------------------------------------------------------------
-- 30) UCZESTNIK: USUNIECIE WLASNEGO OKNA DOSTEPNOSCI
--
-- Okno, w ktorym siedzi spotkanie (takze samo zaproszenie), nie da sie usunac.
-- Wyjscie z okna nie odwoluje spotkania - odwolanie jest osobna, jawna
-- decyzja, o ktorej druga strona musi sie dowiedziec. Usuniecie okna
-- kasowaloby te decyzje po cichu.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_meeting_availability_delete(jsonb);
CREATE FUNCTION public.event_meeting_availability_delete(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_row public.event_meeting_availability;
  v_me uuid;
  v_blocking integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL OR v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: id is required';
  END IF;

  SELECT * INTO v_row
  FROM public.event_meeting_availability a
  WHERE a.id = v_id AND a.tenant_id = v_tenant;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: availability window does not exist';
  END IF;

  v_me := public._event_meeting_caller_registration(v_tenant, v_row.event_id);

  IF v_me IS NULL OR v_me <> v_row.registration_id THEN
    RAISE EXCEPTION 'not_found: this availability window is not yours';
  END IF;

  SELECT count(*)::integer INTO v_blocking
  FROM public.event_meeting_attendees a
  WHERE a.tenant_id = v_tenant
    AND a.registration_id = v_me
    AND a.status IN ('invited', 'accepted', 'held', 'no_show')
    AND a.time_range && v_row.time_range;

  IF v_blocking > 0 THEN
    RAISE EXCEPTION 'availability_has_meetings: % meeting(s) sit inside this window', v_blocking;
  END IF;

  DELETE FROM public.event_meeting_availability
  WHERE id = v_id AND tenant_id = v_tenant AND registration_id = v_me;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_availability_delete(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_availability_delete(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_availability_delete(jsonb) IS
  'Uczestnik usuwa WLASNE okno dostepnosci, w ktorym nie ma zadnego spotkania. Plaszczyzna tresci (public_tenant_id).';

-- ----------------------------------------------------------------------------
-- 31) UCZESTNIK: WOLNE TERMINY Z DRUGA OSOBA
--
-- Bramka jest tu waska celowo: wolno pytac WYLACZNIE o pare z soba. Bez tego
-- warunku funkcja bylaby narzedziem do czytania terminarza dwoch obcych ludzi -
-- a terminarz uczestnika kongresu to informacja handlowa.
--
-- Dodatkowo sprawdzamy REGULE WIDOCZNOSCI zanim policzymy cokolwiek: pokazanie
-- wolnych terminow z osoba, ktorej i tak nie wolno zaprosic, to zaproszenie do
-- klikniecia w blad.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_meeting_free_slots(jsonb);
CREATE FUNCTION public.event_meeting_free_slots(p_payload jsonb)
RETURNS TABLE (
  starts_at timestamptz,
  ends_at timestamptz,
  table_id uuid,
  table_label text,
  table_zone text,
  table_seat integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug', '')), '');
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_other uuid := NULLIF(p_payload->>'counterpart_registration_id', '')::uuid;
  v_me uuid;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL OR v_other IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: counterpart_registration_id is required';
  END IF;

  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'published'
    AND ((v_event_id IS NOT NULL AND e.id = v_event_id) OR (v_slug IS NOT NULL AND e.slug = v_slug));

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  v_me := public._event_meeting_caller_registration(v_tenant, v_event_id);
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_registered: only a participant of this event can use the meeting exchange';
  END IF;

  v_reason := public._event_meeting_can_invite(v_tenant, v_event_id, v_me, v_other);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%: meeting between these two is not allowed', v_reason;
  END IF;

  RETURN QUERY
  SELECT f.starts_at, f.ends_at, f.table_id, f.table_label, f.table_zone, f.table_seat
  FROM public._event_meeting_free_slots(
    v_tenant, v_event_id, v_me, v_other,
    (NULLIF(p_payload->>'from', ''))::timestamptz,
    (NULLIF(p_payload->>'to', ''))::timestamptz,
    (NULLIF(p_payload->>'limit', ''))::integer
  ) f;
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_free_slots(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_free_slots(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_free_slots(jsonb) IS
  'Wolne terminy uczestnika z jedna wskazana osoba. Wolno pytac wylacznie o pare z soba, i tylko gdy regula widocznosci na to spotkanie pozwala. Plaszczyzna tresci (public_tenant_id).';

-- ----------------------------------------------------------------------------
-- 32) UCZESTNIK: WYSLANIE ZAPROSZENIA
--
-- SIEDEM WARUNKOW, KAZDY Z WLASNYM KLUCZEM BLEDU. Kolejnosc nie jest dowolna -
-- idzie od najtanszego do najdrozszego i od najogolniejszego do najbardziej
-- szczegolowego, zeby uczestnik dostal powod najblizszy temu, co zrobil:
--   1. tozsamosc i zapis         (`not_registered`)
--   2. gielda i okno otwarcia    (`meetings_disabled`, `exchange_closed`)
--   3. bramka czestotliwosci     (`rate_limited`)
--   4. regula widocznosci        (klucze z `_event_meeting_can_invite`)
--   5. limit zaproszen           (`invite_limit_reached`)
--   6. limit dzienny obu stron   (`daily_limit_reached`)
--   7. siatka, okna, kolizje     (trigger walidacyjny + ograniczenia)
--
-- BRAMKA CZESTOTLIWOSCI jest tu z tego samego powodu, co w `event_register`:
-- zaproszenie generuje powiadomienie do drugiego czlowieka, wiec bez limitu jest
-- narzedziem do zasypania cudzej skrzynki. Licznik jest ATOMOWY
-- (`rate_limit_hit`), nie odczytem.
--
-- STOLIKA NIE PRZYDZIELAMY - patrz komentarz nad tabela. Zaproszenie
-- niepotwierdzone nie blokuje zasobu.
--
-- OSTATNIA LINIA OBRONY TO OGRANICZENIA, NIE WARUNKI POWYZEJ. Miedzy odczytem
-- a zapisem moze wejsc rownolegla transakcja - dlatego blok EXCEPTION tlumaczy
-- kody `23P01` i `23505` na te same klucze, ktorych uzywaja sprawdzenia
-- wczesniejsze. Uczestnik nigdy nie widzi surowego komunikatu Postgresa.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_meeting_invite(jsonb);
CREATE FUNCTION public.event_meeting_invite(p_payload jsonb)
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
  v_other uuid := NULLIF(p_payload->>'counterpart_registration_id', '')::uuid;
  v_starts timestamptz := (NULLIF(p_payload->>'starts_at', ''))::timestamptz;
  v_settings public.event_meeting_settings;
  v_me uuid;
  v_reason text;
  v_ends timestamptz;
  v_used integer;
  v_day date;
  v_taken integer;
  v_expires timestamptz;
  v_id uuid;
  v_rate record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL OR v_other IS NULL OR v_starts IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: counterpart_registration_id and starts_at are required';
  END IF;

  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'published'
    AND ((v_event_id IS NOT NULL AND e.id = v_event_id) OR (v_slug IS NOT NULL AND e.slug = v_slug));

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  v_me := public._event_meeting_caller_registration(v_tenant, v_event_id);
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_registered: only a participant of this event can send invitations';
  END IF;

  SELECT * INTO v_settings
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id;

  IF v_settings.id IS NULL OR NOT v_settings.is_enabled THEN
    RAISE EXCEPTION 'meetings_disabled: the meeting exchange is not enabled for this event';
  END IF;

  IF (v_settings.invites_open_at IS NOT NULL AND v_settings.invites_open_at > now())
     OR (v_settings.invites_close_at IS NOT NULL AND v_settings.invites_close_at <= now()) THEN
    RAISE EXCEPTION 'exchange_closed: the meeting exchange is not open for invitations right now';
  END IF;

  SELECT * INTO v_rate
  FROM public.rate_limit_hit('event_meeting_invite', v_tenant::text || ':' || v_uid::text, 30, 10);
  IF NOT v_rate.allowed THEN
    RAISE EXCEPTION 'rate_limited: too many invitations sent, try again in a few minutes';
  END IF;

  v_reason := public._event_meeting_can_invite(v_tenant, v_event_id, v_me, v_other);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%: meeting between these two is not allowed', v_reason;
  END IF;

  IF v_settings.max_invites_per_person IS NOT NULL THEN
    SELECT count(*)::integer INTO v_used
    FROM public.event_meetings m
    WHERE m.tenant_id = v_tenant
      AND m.event_id = v_event_id
      AND m.requester_registration_id = v_me
      AND m.status IN ('invited', 'accepted');

    IF v_used >= v_settings.max_invites_per_person THEN
      RAISE EXCEPTION 'invite_limit_reached: you already have % active invitation(s)', v_used;
    END IF;
  END IF;

  v_ends := v_starts + make_interval(mins => v_settings.slot_minutes);
  v_day := (v_starts AT TIME ZONE v_settings.timezone)::date;

  IF v_settings.max_meetings_per_day IS NOT NULL THEN
    SELECT max(x.taken)::integer INTO v_taken
    FROM (
      SELECT count(*)::integer AS taken
      FROM public.event_meeting_attendees a
      WHERE a.tenant_id = v_tenant
        AND a.event_id = v_event_id
        AND a.registration_id IN (v_me, v_other)
        AND a.status IN ('accepted', 'held', 'no_show')
        AND (a.starts_at AT TIME ZONE v_settings.timezone)::date = v_day
      GROUP BY a.registration_id
    ) x;

    IF COALESCE(v_taken, 0) >= v_settings.max_meetings_per_day THEN
      RAISE EXCEPTION 'daily_limit_reached: one of you already has % meeting(s) that day', v_taken;
    END IF;
  END IF;

  -- Termin waznosci ZAPISANY, nigdy po starcie spotkania (punkt E naglowka).
  v_expires := LEAST(
    now() + make_interval(hours => v_settings.invite_expires_after_hours),
    v_starts
  );

  INSERT INTO public.event_meetings (
    tenant_id, event_id, requester_registration_id, invitee_registration_id,
    starts_at, ends_at, status, topic, sponsor_id, invitation_message,
    expires_at, invited_by
  ) VALUES (
    v_tenant, v_event_id, v_me, v_other,
    v_starts, v_ends, 'invited',
    NULLIF(btrim(COALESCE(p_payload->>'topic', '')), ''),
    NULLIF(p_payload->>'sponsor_id', '')::uuid,
    NULLIF(btrim(COALESCE(p_payload->>'message', '')), ''),
    v_expires, v_uid
  )
  RETURNING id INTO v_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_meeting',
    v_id::text,
    'event_meeting.invited.v1',
    jsonb_build_object(
      'event_id', v_event_id,
      'meeting_id', v_id,
      'requester_registration_id', v_me,
      'invitee_registration_id', v_other,
      'starts_at', v_starts,
      'expires_at', v_expires
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'meeting_id', v_id,
    'status', 'invited',
    'starts_at', v_starts,
    'ends_at', v_ends,
    'expires_at', v_expires
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_invitation: you already have an active invitation with this person in this slot';
  WHEN exclusion_violation THEN
    -- Zaproszenie nie zajmuje jeszcze stolika, wiec jedyne ograniczenie EXCLUDE,
    -- ktore moze tu zaprotestowac, dotyczy terminu uczestnika. Nazwe czytamy
    -- z diagnostyki, zeby przeklad nie byl domyslem.
    DECLARE
      v_constraint text;
    BEGIN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'event_meetings_table_no_overlap' THEN
        RAISE EXCEPTION 'table_busy: the seat at this table is already taken in this slot';
      END IF;
      RAISE EXCEPTION 'participant_busy: one of you already has a meeting in this slot';
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_invite(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_invite(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_invite(jsonb) IS
  'Uczestnik wysyla zaproszenie na spotkanie. Siedem warunkow, kazdy z wlasnym kluczem bledu; stolik NIE jest przydzielany przy zaproszeniu. Plaszczyzna tresci (public_tenant_id).';

-- ----------------------------------------------------------------------------
-- 33) UCZESTNIK: ODPOWIEDZ NA ZAPROSZENIE
--
-- ODPOWIADA WYLACZNIE ZAPROSZONY. Zapraszajacy nie moze przyjac wlasnego
-- zaproszenia - to nie jest zabezpieczenie przed nieuwaga, to definicja
-- zaproszenia. Jego sciezka nazywa sie odwolaniem.
--
-- PRZYJECIE PRZYDZIELA STOLIK POD BLOKADA, i to jest miejsce, w ktorym cala
-- wspolbieznosc modulu sie rozstrzyga. Dwoje uczestnikow przyjmuje w tej samej
-- sekundzie zaproszenia na ten sam termin:
--   * `_event_meeting_take_seat` bierze `FOR UPDATE` na wierszach stolikow,
--     wiec druga transakcja czeka i widzi zapis pierwszej;
--   * gdyby jednak sciezka blokade ominela, ograniczenie
--     `event_meetings_table_no_overlap` odrzuca zapis kodem `23P01`;
--   * gdyby kolizja dotyczyla nie stolika, a czlowieka (ktos przyjal juz inne
--     zaproszenie na te godzine), odrzuca ja `event_meeting_attendees_no_overlap`
--     - z tym samym kodem, ale INNA NAZWA ograniczenia.
-- Dlatego blok EXCEPTION czyta `CONSTRAINT_NAME` z diagnostyki i tlumaczy kazdy
-- przypadek na wlasny klucz slownika. Bez tego uczestnik dostaje jeden
-- komunikat na dwie zupelnie rozne sytuacje - i probuje tego samego jeszcze raz.
--
-- WYGASNIECIE JEST SPRAWDZANE, NIE ZAPISANE (punkt E naglowka). Zaproszenie po
-- terminie odrzucamy bledem `invitation_expired`, ale wiersz zostaje w stanie
-- `invited` - nie ma procesu, ktory by go przestemplowal, wiec nie ma stanu,
-- ktory by to udawal.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_meeting_respond(jsonb);
CREATE FUNCTION public.event_meeting_respond(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_meeting_id uuid := NULLIF(p_payload->>'meeting_id', '')::uuid;
  v_decision text := lower(NULLIF(btrim(COALESCE(p_payload->>'decision', '')), ''));
  v_reason text := NULLIF(btrim(COALESCE(p_payload->>'decline_reason', '')), '');
  v_preferred_table uuid := NULLIF(p_payload->>'table_id', '')::uuid;
  v_row public.event_meetings;
  v_settings public.event_meeting_settings;
  v_me uuid;
  v_seat record;
  v_has_tables boolean;
  v_day date;
  v_taken integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL OR v_meeting_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: meeting_id is required';
  END IF;

  IF v_decision NOT IN ('accept', 'decline') THEN
    RAISE EXCEPTION 'invalid_decision: decision must be accept or decline';
  END IF;

  -- Blokada wiersza spotkania: od tej chwili jego stan jest stabilny, wiec dwie
  -- rownolegle odpowiedzi na to samo zaproszenie ustawiaja sie w kolejke.
  SELECT * INTO v_row
  FROM public.event_meetings m
  WHERE m.id = v_meeting_id AND m.tenant_id = v_tenant
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: meeting does not exist';
  END IF;

  v_me := public._event_meeting_caller_registration(v_tenant, v_row.event_id);

  IF v_me IS NULL OR v_me <> v_row.invitee_registration_id THEN
    RAISE EXCEPTION 'not_invitee: only the invited person can answer this invitation';
  END IF;

  IF v_row.status <> 'invited' THEN
    RAISE EXCEPTION 'invitation_not_open: this invitation has already been answered';
  END IF;

  IF v_row.expires_at < now() THEN
    RAISE EXCEPTION 'invitation_expired: this invitation expired on %', v_row.expires_at;
  END IF;

  IF v_decision = 'decline' THEN
    IF v_reason IS NULL OR char_length(v_reason) < 3 THEN
      RAISE EXCEPTION 'decline_reason_required: a short reason is required when declining';
    END IF;

    UPDATE public.event_meetings
    SET status = 'declined',
        decline_reason = v_reason,
        responded_at = now(),
        responded_by = v_uid
    WHERE id = v_meeting_id AND tenant_id = v_tenant;

    PERFORM public.emit_domain_event(
      v_tenant,
      'event_meeting',
      v_meeting_id::text,
      'event_meeting.declined.v1',
      jsonb_build_object(
        'event_id', v_row.event_id,
        'meeting_id', v_meeting_id,
        'starts_at', v_row.starts_at
      ),
      v_uid
    );

    RETURN jsonb_build_object('meeting_id', v_meeting_id, 'status', 'declined');
  END IF;

  SELECT * INTO v_settings
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = v_row.event_id;

  IF v_settings.id IS NULL OR NOT v_settings.is_enabled THEN
    RAISE EXCEPTION 'meetings_disabled: the meeting exchange is not enabled for this event';
  END IF;

  -- LIMIT DZIENNY SPRAWDZAMY PONOWNIE. Miedzy wyslaniem zaproszenia
  -- a odpowiedzia obie strony mogly zapelnic sobie dzien innymi spotkaniami,
  -- a limit chroni ich WLASNIE od tego.
  IF v_settings.max_meetings_per_day IS NOT NULL THEN
    v_day := (v_row.starts_at AT TIME ZONE v_settings.timezone)::date;

    SELECT max(x.taken)::integer INTO v_taken
    FROM (
      SELECT count(*)::integer AS taken
      FROM public.event_meeting_attendees a
      WHERE a.tenant_id = v_tenant
        AND a.event_id = v_row.event_id
        AND a.registration_id IN (
          v_row.requester_registration_id, v_row.invitee_registration_id
        )
        AND a.status IN ('accepted', 'held', 'no_show')
        AND (a.starts_at AT TIME ZONE v_settings.timezone)::date = v_day
      GROUP BY a.registration_id
    ) x;

    IF COALESCE(v_taken, 0) >= v_settings.max_meetings_per_day THEN
      RAISE EXCEPTION 'daily_limit_reached: one of you already has % meeting(s) that day', v_taken;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.event_meeting_tables t
    WHERE t.tenant_id = v_tenant AND t.event_id = v_row.event_id AND t.is_active
  ) INTO v_has_tables;

  SELECT s.out_table_id, s.out_table_seat INTO v_seat
  FROM public._event_meeting_take_seat(
    v_tenant, v_row.event_id, v_row.starts_at, v_row.ends_at, v_preferred_table, v_meeting_id
  ) s;

  IF v_has_tables AND v_seat.out_table_id IS NULL THEN
    RAISE EXCEPTION 'no_free_table: every table is taken in this slot, pick another time';
  END IF;

  UPDATE public.event_meetings
  SET status = 'accepted',
      table_id = v_seat.out_table_id,
      table_seat = v_seat.out_table_seat,
      responded_at = now(),
      responded_by = v_uid
  WHERE id = v_meeting_id AND tenant_id = v_tenant;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_meeting',
    v_meeting_id::text,
    'event_meeting.accepted.v1',
    jsonb_build_object(
      'event_id', v_row.event_id,
      'meeting_id', v_meeting_id,
      'starts_at', v_row.starts_at,
      'table_id', v_seat.out_table_id,
      'table_seat', v_seat.out_table_seat
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'meeting_id', v_meeting_id,
    'status', 'accepted',
    'starts_at', v_row.starts_at,
    'ends_at', v_row.ends_at,
    'table_id', v_seat.out_table_id,
    'table_seat', v_seat.out_table_seat
  );
EXCEPTION
  WHEN exclusion_violation THEN
    DECLARE
      v_constraint text;
    BEGIN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'event_meeting_attendees_no_overlap' THEN
        RAISE EXCEPTION 'participant_busy: one of you already has a meeting in this slot';
      END IF;
      RAISE EXCEPTION 'table_busy: the seat at this table was taken a moment ago, pick another time';
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_respond(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_respond(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_respond(jsonb) IS
  'Zaproszony przyjmuje zaproszenie (ze przydzialem stolika pod blokada) albo odrzuca je z powodem. Tlumaczy oba ograniczenia EXCLUDE na osobne klucze bledu. Plaszczyzna tresci (public_tenant_id).';

-- ----------------------------------------------------------------------------
-- 34) UCZESTNIK: ODWOLANIE SPOTKANIA
--
-- ODWOLUJE KAZDA ZE STRON, i to jest symetryczne z zamyslem: zaproszenie
-- wysylane jednostronnie musi byc jednostronnie odwolywalne, a spotkanie
-- przyjete odwoluje ten, komu wypadlo. `cancelled_side` zapisuje, kto to byl -
-- bez tego rozmowa organizatora z uczestnikiem zaczyna sie od ustalania faktow.
--
-- ODWOLANIE ZOSTAWIA STOLIK W WIERSZU jako slad. Miejsce jest wolne
-- natychmiast, bo warunek czesciowy ograniczenia nie obejmuje stanu
-- `cancelled` - patrz komentarz przy `admin_event_meeting_set_status`.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_meeting_cancel(jsonb);
CREATE FUNCTION public.event_meeting_cancel(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_meeting_id uuid := NULLIF(p_payload->>'meeting_id', '')::uuid;
  v_reason text := NULLIF(btrim(COALESCE(p_payload->>'reason', '')), '');
  v_row public.event_meetings;
  v_me uuid;
  v_side text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL OR v_meeting_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: meeting_id is required';
  END IF;

  SELECT * INTO v_row
  FROM public.event_meetings m
  WHERE m.id = v_meeting_id AND m.tenant_id = v_tenant
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: meeting does not exist';
  END IF;

  v_me := public._event_meeting_caller_registration(v_tenant, v_row.event_id);

  v_side := CASE
    WHEN v_me = v_row.requester_registration_id THEN 'requester'
    WHEN v_me = v_row.invitee_registration_id THEN 'invitee'
  END;

  IF v_side IS NULL THEN
    RAISE EXCEPTION 'not_a_party: only a party of this meeting can cancel it';
  END IF;

  IF v_row.status NOT IN ('invited', 'accepted') THEN
    RAISE EXCEPTION 'meeting_not_active: only an open invitation or an accepted meeting can be cancelled';
  END IF;

  UPDATE public.event_meetings
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_uid,
      cancelled_side = v_side,
      cancel_reason = v_reason
  WHERE id = v_meeting_id AND tenant_id = v_tenant;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_meeting',
    v_meeting_id::text,
    'event_meeting.cancelled.v1',
    jsonb_build_object(
      'event_id', v_row.event_id,
      'meeting_id', v_meeting_id,
      'by', v_side,
      'starts_at', v_row.starts_at
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'meeting_id', v_meeting_id,
    'status', 'cancelled',
    'cancelled_side', v_side
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_cancel(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_cancel(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_cancel(jsonb) IS
  'Kazda ze stron odwoluje zaproszenie albo przyjete spotkanie; zapisuje, ktora strona to zrobila. Plaszczyzna tresci (public_tenant_id).';

-- ----------------------------------------------------------------------------
-- 35) UCZESTNIK: PRZELOZENIE SPOTKANIA
--
-- PRZELOZENIE NIE JEST ZMIANA GODZINY W ISTNIEJACYM WIERSZU. Gdyby bylo,
-- jedna strona przestawialaby drugiej kalendarz bez jej zgody - a to nie jest
-- przelozenie, to jednostronne zajecie cudzego czasu. Wiec:
--   * stare spotkanie dostaje stan `rescheduled` (i zwalnia stolik, bo warunek
--     czesciowy ograniczenia tego stanu nie obejmuje);
--   * powstaje NOWE zaproszenie na nowy termin, ktore druga strona musi przyjac;
--   * nowy wiersz wskazuje stary przez `rescheduled_from_id`, wiec historia
--     spotkania jest lancuchem, a nie nadpisana kolumna.
--
-- ROLE SIE ODWRACAJA, gdy przeklada zaproszony: kto proponuje nowy termin, ten
-- jest zapraszajacym. Inaczej zaproszony moglby przelozyc spotkanie na termin,
-- ktory sam sobie zaakceptuje.
--
-- Limit zaproszen NIE jest tu liczony od nowa: przelozenie zamyka jedno aktywne
-- zaproszenie i otwiera jedno nowe, wiec bilans sie nie zmienia. Liczenie go
-- karalo by uczestnika za probe uratowania spotkania, ktore i tak juz mial.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_meeting_reschedule(jsonb);
CREATE FUNCTION public.event_meeting_reschedule(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_meeting_id uuid := NULLIF(p_payload->>'meeting_id', '')::uuid;
  v_starts timestamptz := (NULLIF(p_payload->>'starts_at', ''))::timestamptz;
  v_row public.event_meetings;
  v_settings public.event_meeting_settings;
  v_me uuid;
  v_other uuid;
  v_reason text;
  v_ends timestamptz;
  v_expires timestamptz;
  v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL OR v_meeting_id IS NULL OR v_starts IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: meeting_id and starts_at are required';
  END IF;

  SELECT * INTO v_row
  FROM public.event_meetings m
  WHERE m.id = v_meeting_id AND m.tenant_id = v_tenant
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: meeting does not exist';
  END IF;

  v_me := public._event_meeting_caller_registration(v_tenant, v_row.event_id);

  v_other := CASE
    WHEN v_me = v_row.requester_registration_id THEN v_row.invitee_registration_id
    WHEN v_me = v_row.invitee_registration_id THEN v_row.requester_registration_id
  END;

  IF v_me IS NULL OR v_other IS NULL THEN
    RAISE EXCEPTION 'not_a_party: only a party of this meeting can reschedule it';
  END IF;

  IF v_row.status NOT IN ('invited', 'accepted') THEN
    RAISE EXCEPTION 'meeting_not_active: only an open invitation or an accepted meeting can be rescheduled';
  END IF;

  IF v_starts = v_row.starts_at THEN
    RAISE EXCEPTION 'same_slot: the new slot is the same as the current one';
  END IF;

  SELECT * INTO v_settings
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = v_tenant AND s.event_id = v_row.event_id;

  IF v_settings.id IS NULL OR NOT v_settings.is_enabled THEN
    RAISE EXCEPTION 'meetings_disabled: the meeting exchange is not enabled for this event';
  END IF;

  v_reason := public._event_meeting_can_invite(v_tenant, v_row.event_id, v_me, v_other);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%: meeting between these two is not allowed', v_reason;
  END IF;

  v_ends := v_starts + make_interval(mins => v_settings.slot_minutes);
  v_expires := LEAST(
    now() + make_interval(hours => v_settings.invite_expires_after_hours),
    v_starts
  );

  -- Kolejnosc jest istotna: NAJPIERW zamykamy stary wiersz, potem wstawiamy
  -- nowy. Odwrotna kolejnosc zderzylaby nowy wiersz ze starym na ograniczeniu
  -- terminu uczestnika, gdyby oba terminy sie nakladaly (przelozenie o pol
  -- slotu jest zupelnie normalne).
  UPDATE public.event_meetings
  SET status = 'rescheduled',
      responded_at = now(),
      responded_by = v_uid
  WHERE id = v_meeting_id AND tenant_id = v_tenant;

  INSERT INTO public.event_meetings (
    tenant_id, event_id, requester_registration_id, invitee_registration_id,
    starts_at, ends_at, status, topic, sponsor_id, invitation_message,
    expires_at, invited_by, rescheduled_from_id
  ) VALUES (
    v_tenant, v_row.event_id, v_me, v_other,
    v_starts, v_ends, 'invited',
    v_row.topic, v_row.sponsor_id,
    COALESCE(NULLIF(btrim(COALESCE(p_payload->>'message', '')), ''), v_row.invitation_message),
    v_expires, v_uid, v_meeting_id
  )
  RETURNING id INTO v_new_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_meeting',
    v_new_id::text,
    'event_meeting.rescheduled.v1',
    jsonb_build_object(
      'event_id', v_row.event_id,
      'meeting_id', v_new_id,
      'rescheduled_from_id', v_meeting_id,
      'previous_starts_at', v_row.starts_at,
      'starts_at', v_starts
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'meeting_id', v_new_id,
    'rescheduled_from_id', v_meeting_id,
    'status', 'invited',
    'starts_at', v_starts,
    'ends_at', v_ends,
    'expires_at', v_expires
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_invitation: you already have an active invitation with this person in this slot';
  WHEN exclusion_violation THEN
    DECLARE
      v_constraint text;
    BEGIN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'event_meetings_table_no_overlap' THEN
        RAISE EXCEPTION 'table_busy: the seat at this table is already taken in this slot';
      END IF;
      RAISE EXCEPTION 'participant_busy: one of you already has a meeting in this slot';
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.event_meeting_reschedule(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meeting_reschedule(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meeting_reschedule(jsonb) IS
  'Przelozenie spotkania: stary wiersz dostaje stan rescheduled, powstaje NOWE zaproszenie na nowy termin ze sladem rescheduled_from_id. Kto proponuje, ten jest zapraszajacym. Plaszczyzna tresci (public_tenant_id).';

-- ----------------------------------------------------------------------------
-- 36) UCZESTNIK: WLASNE SPOTKANIA
--
-- ODDAJE TO, CO IDENTYFIKUJE DRUGA STRONE W ROZMOWIE - imie, nazwisko,
-- stanowisko, firme - I NIC WIECEJ. Adres poczty i telefon zostaja
-- w kartotece: gielda spotkan nie jest sposobem na pobranie listy kontaktow
-- calego kongresu. Kto chce sie wymienic kontaktem, robi to na spotkaniu.
--
-- `side` mowi, po ktorej stronie stoi wolajacy - od tego zalezy caly zestaw
-- dostepnych przyciskow (zaproszony odpowiada, zapraszajacy tylko odwoluje).
-- Wyliczenie tego po stronie klienta wymagaloby oddania mu wlasnego
-- identyfikatora zapisu i porownania - czyli tej samej informacji, tylko
-- okrezniej.
--
-- `is_expired` liczone, jak w liscie panelu (punkt E naglowka).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_meetings_mine(jsonb);
CREATE FUNCTION public.event_meetings_mine(p_payload jsonb)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  side text,
  status text,
  is_expired boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  expires_at timestamptz,
  counterpart_registration_id uuid,
  counterpart_first_name text,
  counterpart_last_name text,
  counterpart_job_title text,
  counterpart_company text,
  table_label text,
  table_zone text,
  table_seat integer,
  topic text,
  sponsor_id uuid,
  sponsor_name text,
  invitation_message text,
  decline_reason text,
  cancel_reason text,
  cancelled_side text,
  responded_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug', '')), '');
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_status text := NULLIF(p_payload->>'status', '');
  v_me uuid;
  v_limit integer := LEAST(GREATEST(COALESCE((NULLIF(p_payload->>'limit', ''))::integer, 100), 1), 300);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'published'
    AND ((v_event_id IS NOT NULL AND e.id = v_event_id) OR (v_slug IS NOT NULL AND e.slug = v_slug));

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  v_me := public._event_meeting_caller_registration(v_tenant, v_event_id);
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_registered: only a participant of this event has meetings here';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.event_id,
    a.side,
    m.status,
    (m.status = 'invited' AND m.expires_at < now()),
    m.starts_at,
    m.ends_at,
    m.expires_at,
    other.id,
    op.first_name,
    op.last_name,
    op.job_title,
    COALESCE(oc.name, op.company_text),
    t.label,
    t.zone,
    m.table_seat,
    m.topic,
    m.sponsor_id,
    sp.snapshot_name,
    m.invitation_message,
    m.decline_reason,
    m.cancel_reason,
    m.cancelled_side,
    m.responded_at,
    m.created_at
  FROM public.event_meeting_attendees a
  JOIN public.event_meetings m
    ON m.id = a.meeting_id AND m.tenant_id = a.tenant_id
  JOIN public.event_registrations other
    ON other.tenant_id = m.tenant_id
   AND other.id = CASE
     WHEN a.side = 'requester' THEN m.invitee_registration_id
     ELSE m.requester_registration_id
   END
  JOIN public.event_people op
    ON op.id = other.person_id AND op.tenant_id = other.tenant_id
  LEFT JOIN public.crm_companies oc
    ON oc.id = op.company_id AND oc.tenant_id = op.tenant_id
  LEFT JOIN public.event_meeting_tables t
    ON t.id = m.table_id AND t.tenant_id = m.tenant_id
  LEFT JOIN public.event_sponsors sp
    ON sp.id = m.sponsor_id AND sp.tenant_id = m.tenant_id
  WHERE a.tenant_id = v_tenant
    AND a.event_id = v_event_id
    AND a.registration_id = v_me
    AND (
      v_status IS NULL
      OR v_status = 'all'
      OR (v_status = 'pending' AND m.status = 'invited' AND m.expires_at >= now())
      OR (v_status = 'expired' AND m.status = 'invited' AND m.expires_at < now())
      OR m.status = v_status
    )
  ORDER BY m.starts_at, m.created_at, m.id
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.event_meetings_mine(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_meetings_mine(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_meetings_mine(jsonb) IS
  'Spotkania wolajacego uczestnika z danymi drugiej strony (imie, nazwisko, stanowisko, firma - bez kontaktu), strona wolajacego i liczonym stanem wygasniecia. Plaszczyzna tresci (public_tenant_id).';
