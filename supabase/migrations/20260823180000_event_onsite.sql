-- ============================================================================
-- Event Builder, etap 7: OBSLUGA NA MIEJSCU - PUNKTY ODPRAWY, WLASNY SKANER,
-- IDENTYFIKATORY, SKANY LEADOW
--
-- STAN PRZED. Modul Wydarzen umie zapisac czlowieka na wydarzenie
-- (`event_registrations`, migracja 20260823150000) i wydac mu token wejsciowy
-- (`event_registrations.qr_token_hash`, SHA-256, wartosc jawna wraca z RPC
-- dokladnie raz). Na tym sie konczy. Nie ma NICZEGO, co ten token czyta:
--   * zero punktow odprawy - nie da sie powiedziec, ze wejscie glowne to inna
--     bramka niz katering i inna niz sala B, wiec nie da sie zmierzyc, ile
--     osob weszlo GDZIE;
--   * zero poswiadczen dla skanera - wolontariusz przy bramce musialby dostac
--     konto redaktora w platformie, czyli dostep do listy wszystkich zapisow
--     razem z adresami poczty; alternatywa (wspolne konto na kartce) jest
--     jeszcze gorsza;
--   * zero rejestru odpraw - frekwencja liczy sie dzis z `event_rsvps`
--     (patrz docs/ANALIZA_BRAKUJACYCH_EKRANOW sekcja "Frekwencja faktyczna"), czyli
--     z DEKLARACJI, a nie z obecnosci. Raport "przyszlo 180 z 240" nie ma
--     zadnego zrodla danych;
--   * zero identyfikatorow - `src/lib/events/ticketCode.ts` potrafi zrobic kod
--     QR, ale nic nie wie o kartce, na ktorej ten kod ma byc wydrukowany, ani
--     o tym, czy ktos ta kartke odebral;
--   * zero skanow leadow - sponsor ma stoisko (`event_sponsors`, migracja
--     20260823160000), ale nie ma jak zapisac, z kim rozmawial.
--
-- STAN PO. Szesc tabel i dwadziescia trzy funkcje w dwoch ROZLACZNYCH
-- plaszczyznach dostepu:
--
--   PLASZCZYZNA PANELU (`admin_*`, bramka assert_editor_tenant() albo
--   assert_admin_tenant()): konfiguracja punktow odprawy, wydawanie i
--   uniewaznianie poswiadczen urzadzen, lista odpraw, statystyki, szablony
--   identyfikatora, rejestr wydrukow, przeglad leadow.
--
--   PLASZCZYZNA URZADZENIA (`event_*`, bramka = HASZ TOKENU URZADZENIA):
--   rozpoznanie kodu QR, zapis odprawy, zapis skanu leada, lista wlasnych
--   leadow sponsora. Wolontariusz przy bramce NIE MA konta w platformie -
--   uwierzytelnia go urzadzenie, nie czlowiek.
--
--   Te dwie plaszczyzny nie stykaja sie w zadnym ciele funkcji. Zadna funkcja
--   urzadzenia nie wola has_role() ani is_staff(), zadna funkcja panelu nie
--   przyjmuje tokenu urzadzenia. Dzieki temu przechwycony token urzadzenia nie
--   daje ani jednej operacji panelu, a konto redaktora nie daje niczego, czego
--   nie widzi w panelu.
--
-- DLACZEGO TENANT PRZYCHODZI Z POSWIADCZENIA, A NIE Z NAGLOWKA HOSTA.
-- `public_tenant_id()` czyta naglowek `x-tenant-host` ustawiany przez klienta
-- (src/integrations/supabase/tenant-host-fetch.ts) - jest falsyfikowalny curlem.
-- Skaner nie moze wiec podac "u kogo skanuje": tenant i wydarzenie sa WYNIKIEM
-- odszukania poswiadczenia po haszu tokenu, nie jego argumentem. Token jest
-- 24-bajtowym sekretem, wiec nie da sie go zgadnac, a skoro nie da sie go
-- podac dla obcego najemcy, to nie ma tu czego podszywac. Z tego samego powodu
-- `public_tenant_id()` NIE WYSTEPUJE w tym pliku ani razu - bramka
-- check:sql-tenant-scope nie ma czego zapalic.
--
-- MODEL ZAGROZEN SKANERA (pelny opis takze w COMMENT-ach przy funkcjach):
--   Z1. Kradziez tokenu urzadzenia = kradziez bramki. Mitygacje: token tylko
--       jako SHA-256 (zrzut tabeli nie daje wstepu), wartosc jawna wraca
--       DOKLADNIE RAZ przy wydaniu, uniewaznienie jest natychmiastowe i
--       nieodwracalne, wygasniecie jest obowiazkowe (`expires_at`), zakres
--       uprawnien jest waski (`scopes`), a granty kolumnowe ukrywaja hasz
--       nawet przed redaktorem czytajacym tabele.
--   Z2. Wyliczenie listy uczestnikow przez odpytywanie skanera. Mitygacja:
--       plaszczyzna urzadzenia NIE MA funkcji szukajacej po nazwisku ani
--       zwracajacej liste osob. Rozpoznanie przyjmuje TOKEN i zwraca DOKLADNIE
--       JEDNA osobe. Szukanie po nazwisku istnieje wylacznie w panelu, za
--       bramka assert_editor_tenant().
--   Z3. Zgadywanie tokenow wejsciowych ukradzionym tokenem urzadzenia.
--       Mitygacja: licznik nieudanych rozpoznan na wierszu urzadzenia
--       (`failed_scan_count`, widoczny w panelu) plus okno kroczace, ktore po
--       przekroczeniu progu BLOKUJE urzadzenie (`locked_until`) i emituje
--       zdarzenie domenowe. Blokade zdejmuje wylacznie administrator.
--   Z4. Zawieszony skaner piszacy tysiace wierszy na minute. Mitygacja:
--       okno idempotencji (patrz nizej) sprawia, ze powtorzone pikniecie nie
--       tworzy wiersza, tylko podnosi licznik na wierszu istniejacym.
--   Z5. Dane kontaktowe uczestnika u sponsora bez zgody. Mitygacja: tabela
--       skanow leadow NIE ZAWIERA ani jednej kolumny z danymi kontaktowymi -
--       trzyma wskazanie osoby. Jedyna droga do adresu i telefonu prowadzi
--       przez RPC, ktory ma warunek zgody W KLAUZULI WHERE. Zgoda wycofana po
--       skanie odcina dostep natychmiast, bo warunek czyta stan ZYWY, a nie
--       migawke z chwili skanu.
--
-- IDEMPOTENCJA ODPRAWY - DWA MECHANIZMY, DWA ROZNE ZADANIA. To nie jest
-- redundancja; to dwie rozne awarie:
--
--   (a) KLUCZ IDEMPOTENCJI OD SKANERA (`client_scan_uid`, unikalny w granicach
--       najemcy i wydarzenia). Skaner dziala offline (sala kongresowa bez
--       zasiegu) i kolejkuje skany w przegladarce. Przy powrocie sieci wysyla
--       kolejke - i moze ja wyslac DWA RAZY, bo pierwsza odpowiedz przepadla.
--       Powtorzone wyslanie tego samego FIZYCZNEGO skanu musi zwrocic TEN SAM
--       wiersz, nie blad i nie drugi wiersz. Okno czasowe tego nie zalatwi:
--       kolejka moze wrocic po trzech godzinach, dawno za kazdym oknem.
--
--   (b) OKNO CZASOWE (`dedupe_range` + ograniczenie EXCLUDE USING gist).
--       Podwojne pikniecie przy bramce to DWA fizyczne skany, kazdy z wlasnym
--       kluczem idempotencji - klucz (a) ich nie skleji, bo dla urzadzenia to
--       naprawde dwa zdarzenia. Skleja je serwer: dwie zgody dla tej samej
--       osoby, tego samego punktu i tego samego kierunku nie moga wspolistniec
--       w oknie punktu odprawy (domyslnie 60 sekund, konfigurowalne per punkt -
--       katering chce okna godzinowego, bramka sekundowego).
--
--   Rozstrzyga SERWER, nie urzadzenie: urzadzenie offline nie wie, co zrobil
--   sasiedni skaner. Ograniczenie EXCLUDE jest przy tym BRAMKA WYSCIGU, a nie
--   glownym mechanizmem - RPC najpierw szuka wiersza w oknie i podnosi na nim
--   licznik powtorzen, a ograniczenie lapie tylko przypadek, w ktorym dwa
--   rownolegle skany minely sie miedzy SELECT-em i INSERT-em.
--
-- DZIENNIK JEST DOPISYWANY, NIE NADPISYWANY. `event_checkins` nie ma sciezki
-- UPDATE-u poza podniesieniem licznika powtorzen i nie ma sciezki DELETE poza
-- kaskada usuniecia wydarzenia. Odmowa dostaje WLASNY wiersz z wlasnym powodem,
-- bo pierwsze pytanie po skardze uczestnika brzmi "dlaczego mnie nie wpuscili
-- o 9:12", a nie "ile osob weszlo".
--
-- IZOLACJA NAJEMCOW:
--   * kazda z szesciu tabel ma `tenant_id uuid NOT NULL REFERENCES tenants(id)
--     ON DELETE CASCADE`;
--   * kazde powiazanie z wydarzeniem, sesja, sponsorem, zapisem, punktem
--     odprawy, urzadzeniem i szablonem jest KLUCZEM OBCYM ZLOZONYM po
--     `(tenant_id, ...)`, wiec wiersz nie moze wskazac obiektu obcego najemcy
--     - baza odrzuca to na poziomie silnika, takze przy COPY i przy migracji
--     danych;
--   * kazda tabela ma wlaczone RLS i JEDNA polityke odczytu (staff w tenancie
--     domowym). Zapisu klienckiego NIE MA ZADNEGO - kazdy zapis idzie przez
--     SECURITY DEFINER, wiec "brak polityki" jest tu funkcja, nie luka;
--   * hasz tokenu urzadzenia jest odciety GRANTEM KOLUMNOWYM, wzorzec
--     `events.join_url` z 20260702200000;
--   * kazda funkcja SECURITY DEFINER ma `SET search_path`, a te uzywajace
--     pgcrypto dodatkowo `extensions` w sciezce.
--
-- FORWARD-ONLY I IDEMPOTENTNOSC. Tabele przez `CREATE TABLE IF NOT EXISTS`,
-- indeksy przez `IF NOT EXISTS`, polityki przez `DROP POLICY IF EXISTS` +
-- `CREATE POLICY`, funkcje przez `DROP FUNCTION IF EXISTS` z pelna sygnatura +
-- `CREATE OR REPLACE`. Powtorny przebieg na bazie czesciowo zmigrowanej nie
-- kasuje danych i nie zmienia decyzji redakcji.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) PUNKT ODPRAWY
--
-- Punkt odprawy to MIEJSCE, w ktorym kod uczestnika jest czytany. Osobna
-- tabela, a nie kolumna na wydarzeniu, bo wydarzenie ma ich wiele i kazdy
-- odpowiada na inne pytanie: wejscie glowne mowi "ile osob przyszlo", punkt
-- przy sali mowi "ile osob bylo na TEJ sesji", katering mowi "ile obiadow
-- wydano", szatnia mowi "ile osob jeszcze nie wyszlo".
--
-- SZESC RODZAJOW, bo szesc razy inna semantyka licznika:
--   event_entry   - wejscie glowne wydarzenia (frekwencja);
--   session       - punkt przy sali sesyjnej (frekwencja sesji, `session_id`);
--   room          - punkt przy pomieszczeniu bez wiazania z sesja (`room_id`);
--   zone          - strefa wydzielona (strefa VIP, strefa wystawowa);
--   catering      - wydanie posilku (jedno wejscie na osobe na okno);
--   cloakroom     - szatnia (kierunek "wyjscie" jest tu tak samo wazny jak
--                   "wejscie", bo mowi, kto opuscil budynek);
--   company_booth - stoisko sponsora (`sponsor_id`), zaczep skanow leadow.
--
-- (Siedem wartosci - `room` doszedl obok `session`, bo punkt przy pomieszczeniu
-- bez agendy jest realnym przypadkiem: wejscie na pietro, wejscie do hali.)
--
-- KIERUNEK JEST WLASCIWOSCIA PUNKTU, NIE SKANU. Bramka wejsciowa przyjmuje
-- tylko "wejscie" - operator nie ma tam czego wybierac, a mozliwosc wyboru
-- gwarantuje pomylke pod presja kolejki. Szatnia przyjmuje oba kierunki.
--
-- TRYB DOSTEPU ROZDZIELA MIERZENIE OD WPUSZCZANIA. `track` liczy i nic nie
-- blokuje (punkt statystyczny w przejsciu); `control` egzekwuje - odmowa
-- znaczy "nie wpuszczaj". Bez tej kolumny kazdy punkt statystyczny stawalby
-- sie bramka, a operator dostawalby czerwony ekran przy osobie, ktorej i tak
-- nie ma prawa zatrzymac.
--
-- LIMIT MIEJSC (`capacity`) jest egzekwowany WYLACZNIE w trybie `control` i
-- WYLACZNIE pod blokada wiersza punktu (patrz `_event_checkin_write`). Limit
-- w trybie `track` byloby metryka udajaca regule.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  kind text NOT NULL DEFAULT 'event_entry',
  session_id uuid,
  room_id uuid,
  sponsor_id uuid,
  direction_mode text NOT NULL DEFAULT 'in_only',
  access_mode text NOT NULL DEFAULT 'control',
  capacity integer,
  -- Okno idempotencji TEGO punktu, w sekundach. Bramka chce sekund (podwojne
  -- pikniecie), katering godzin (jeden obiad na osobe na przerwe). Wartosc
  -- utrwala sie w `dedupe_range` wiersza odprawy, wiec zmiana okna nie
  -- przepisuje historii - stare wiersze pamietaja regule, pod ktora powstaly.
  dedupe_window_seconds integer NOT NULL DEFAULT 60,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_checkpoints_name_pl_len CHECK (char_length(btrim(name_pl)) BETWEEN 2 AND 120),
  CONSTRAINT event_checkpoints_name_en_len CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 120),
  CONSTRAINT event_checkpoints_kind_values CHECK (kind IN (
    'event_entry', 'session', 'room', 'zone', 'catering', 'cloakroom', 'company_booth'
  )),
  CONSTRAINT event_checkpoints_direction_mode_values
    CHECK (direction_mode IN ('in_only', 'out_only', 'in_out')),
  CONSTRAINT event_checkpoints_access_mode_values
    CHECK (access_mode IN ('track', 'control')),
  CONSTRAINT event_checkpoints_capacity_positive CHECK (capacity IS NULL OR capacity > 0),
  -- Limit bez trybu kontroli to liczba, ktorej nikt nie egzekwuje - dokladnie
  -- ta sama decyzja co `event_sessions_capacity_needs_signup`.
  CONSTRAINT event_checkpoints_capacity_needs_control
    CHECK (capacity IS NULL OR access_mode = 'control'),
  -- Dolna granica pieciu sekund: krocej niz tyle nie jest oknem, tylko
  -- wylaczeniem sklejania. Gorna granica doby: punkt odprawy zyje jeden dzien.
  CONSTRAINT event_checkpoints_dedupe_window_range
    CHECK (dedupe_window_seconds BETWEEN 5 AND 86400),
  -- Wiazanie z sesja ma sens WYLACZNIE dla punktu sesyjnego. Punkt kateringowy
  -- wskazujacy sesje klamalby w kazdym raporcie frekwencji tej sesji.
  CONSTRAINT event_checkpoints_session_scoped
    CHECK (session_id IS NULL OR kind = 'session'),
  CONSTRAINT event_checkpoints_session_required
    CHECK (kind <> 'session' OR session_id IS NOT NULL),
  CONSTRAINT event_checkpoints_sponsor_scoped
    CHECK (sponsor_id IS NULL OR kind = 'company_booth'),
  CONSTRAINT event_checkpoints_sponsor_required
    CHECK (kind <> 'company_booth' OR sponsor_id IS NOT NULL),
  -- Tozsamosc punktu w granicach najemcy (urzadzenia, leady) i w granicach
  -- wydarzenia (odprawy - wiersz odprawy ma wskazywac punkt TEGO wydarzenia).
  CONSTRAINT event_checkpoints_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_checkpoints_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_checkpoints_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_checkpoints_session_fk FOREIGN KEY (tenant_id, event_id, session_id)
    REFERENCES public.event_sessions (tenant_id, event_id, id) ON DELETE SET NULL,
  CONSTRAINT event_checkpoints_room_fk FOREIGN KEY (tenant_id, event_id, room_id)
    REFERENCES public.event_rooms (tenant_id, event_id, id) ON DELETE SET NULL,
  CONSTRAINT event_checkpoints_sponsor_fk FOREIGN KEY (tenant_id, event_id, sponsor_id)
    REFERENCES public.event_sponsors (tenant_id, event_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE public.event_checkpoints IS
  'Punkt odprawy wydarzenia: miejsce, w ktorym czytany jest kod uczestnika. Siedem rodzajow, bo siedem razy inna semantyka licznika. Zapis wylacznie przez admin_event_checkpoint_save.';
COMMENT ON COLUMN public.event_checkpoints.kind IS
  'Rodzaj punktu: event_entry | session | room | zone | catering | cloakroom | company_booth. Wiazanie z sesja jest wymagane dla session, wiazanie ze sponsorem dla company_booth (CHECK-i _scoped/_required).';
COMMENT ON COLUMN public.event_checkpoints.direction_mode IS
  'Kierunki obslugiwane przez punkt: in_only | out_only | in_out. Kierunek jest wlasciwoscia PUNKTU, nie skanu - operator przy bramce nie ma czego wybierac, a mozliwosc wyboru pod presja kolejki gwarantuje pomylke.';
COMMENT ON COLUMN public.event_checkpoints.access_mode IS
  'track = licz i nie blokuj (punkt statystyczny); control = egzekwuj (odmowa znaczy "nie wpuszczaj"). Limit miejsc dziala tylko w trybie control.';
COMMENT ON COLUMN public.event_checkpoints.capacity IS
  'Limit rownoczesnej obecnosci w punkcie. Egzekwowany pod blokada wiersza punktu w _event_checkin_write - liczony z dziennika (kierunek ostatniego skanu osoby), nie z kolumny-licznika, ktora by dryfowala.';
COMMENT ON COLUMN public.event_checkpoints.dedupe_window_seconds IS
  'Okno idempotencji punktu w sekundach. Utrwala sie w event_checkins.dedupe_range, wiec zmiana okna nie przepisuje historii.';
COMMENT ON COLUMN public.event_checkpoints.is_active IS
  'Wylaczenie ODWRACALNE: punkt znika ze skanera, ale jego dziennik zostaje. Dlatego wylaczenie jest osobna operacja od usuniecia, a nie jego lagodniejsza wersja.';

-- Dwa punkty o tej samej nazwie w jednym wydarzeniu sa bledem redakcyjnym,
-- ktorego nie da sie odroznic na liscie w skanerze. Porownanie po
-- `lower(btrim(...))`, bo "Wejscie glowne" i "wejscie  glowne" to jedno.
CREATE UNIQUE INDEX IF NOT EXISTS event_checkpoints_event_name_unique
  ON public.event_checkpoints (tenant_id, event_id, lower(btrim(name_pl)));
CREATE INDEX IF NOT EXISTS event_checkpoints_event_order_idx
  ON public.event_checkpoints (tenant_id, event_id, sort_order, name_pl);
CREATE INDEX IF NOT EXISTS event_checkpoints_session_idx
  ON public.event_checkpoints (tenant_id, session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_checkpoints_sponsor_idx
  ON public.event_checkpoints (tenant_id, sponsor_id) WHERE sponsor_id IS NOT NULL;

GRANT SELECT ON public.event_checkpoints TO authenticated;
GRANT ALL ON public.event_checkpoints TO service_role;

ALTER TABLE public.event_checkpoints ENABLE ROW LEVEL SECURITY;

-- JEDYNA polityka: odczyt stafowy w tenancie DOMOWYM. Skaner NIE czyta tej
-- tabeli przez PostgREST - dostaje konfiguracje punktu z RPC, ktory zna jego
-- poswiadczenie. Brak polityki anonimowej jest tu funkcja, nie luka.
DROP POLICY IF EXISTS "event_checkpoints_staff_read" ON public.event_checkpoints;
CREATE POLICY "event_checkpoints_staff_read"
  ON public.event_checkpoints FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP TRIGGER IF EXISTS event_checkpoints_touch_updated_at ON public.event_checkpoints;
CREATE TRIGGER event_checkpoints_touch_updated_at
  BEFORE UPDATE ON public.event_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2) URZADZENIE SKANUJACE
--
-- POSWIADCZENIE NALEZY DO URZADZENIA, NIE DO CZLOWIEKA. Wolontariusz przy
-- bramce nie dostaje konta w platformie - dostaje telefon z otwarta strona
-- skanera. Gdyby poswiadczenie bylo kontem, obsada bramki (czesto ludzie z
-- agencji, wymieniani miedzy dniami wydarzenia) mialaby dostep do listy
-- wszystkich zapisow razem z adresami poczty i telefonami. Alternatywa
-- praktykowana bez tej tabeli - wspolne konto redaktora zapisane na kartce -
-- jest jeszcze gorsza, bo nie da sie jej uniewaznic bez odbierania dostepu
-- calej redakcji.
--
-- TOKEN TYLKO JAKO HASZ. Kolumna trzyma SHA-256; wartosc jawna wraca z
-- `admin_event_scanner_device_issue()` DOKLADNIE RAZ i nigdzie nie jest
-- zapisywana. Zrzut bazy, backup i podejrzany redaktor nie daja wstepu.
--
-- `token_prefix` to PIERWSZE OSIEM ZNAKOW wartosci jawnej i jest w tabeli
-- swiadomie. Uzasadnienie operacyjne: obsada trzyma token na wydrukowanej
-- kartce, a przy zgloszeniu "ten telefon nie skanuje" administrator musi
-- wiedziec, KTORY wiersz uniewaznic. Bez prefiksu jedyna droga to
-- uniewaznienie wszystkich urzadzen wydarzenia w trakcie rejestracji. Koszt:
-- token traci 6 z 24 bajtow entropii, zostaje 144 bity - poza zasiegiem
-- zgadywania. Zysk: uniewaznienie punktowe zamiast zbiorowego.
--
-- ZAKRESY UPRAWNIEN sa tablica tekstowa o zamknietym slowniku, nie kluczem
-- obcym: 'checkin' | 'lead' | 'badge_print'. Tablica jest tu bezpieczna, bo
-- jej elementy sa STALYMI slownika, a nie wskazaniami wierszy - nie ma czego
-- wskazac u obcego najemcy. (Tablica identyfikatorow grup lub biletow byloby
-- czym innym i dlatego jej tu NIE MA - patrz raport wdrozenia.)
--
-- TRZY ROZNE "WYLACZONE", bo trzy rozne decyzje:
--   `is_active = false`  - pauza ODWRACALNA (telefon lezy w szufladzie);
--   `revoked_at`         - uniewaznienie NIEODWRACALNE (telefon zgubiony);
--   `locked_until`       - blokada AUTOMATYCZNA po serii nieudanych rozpoznan
--                          (podejrzenie zgadywania tokenow), zdejmowana
--                          wylacznie przez administratora.
-- Zlanie ich w jedna kolumne kasuje roznice miedzy "wroci dzisiaj",
-- "nie wroci nigdy" i "wroci, gdy czlowiek to sprawdzi".
--
-- `expires_at` JEST OBOWIAZKOWE. Poswiadczenie bez terminu zyje w
-- localStorage telefonu wolontariusza do konca istnienia tego telefonu.
-- Wygasniecie jest jedyna mitygacja, ktora dziala BEZ czyjejkolwiek pamieci.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_scanner_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  -- NULL = urzadzenie obsluguje KAZDY punkt wydarzenia (skaner uniwersalny
  -- w rekach koordynatora). Wartosc = urzadzenie przypiete do jednego punktu,
  -- czyli operator nie ma czego wybrac i nie moze wybrac zle.
  checkpoint_id uuid,
  -- Sponsor, ktorego leady zbiera to urzadzenie. Wymagany dla zakresu 'lead' -
  -- bez niego skan leada nie mialby wlasciciela, a wlasciciel jest tu jedyna
  -- granica dostepu do listy leadow.
  sponsor_id uuid,
  label text NOT NULL,
  token_hash text NOT NULL,
  token_prefix text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['checkin']::text[],
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_seen_at timestamptz,
  -- Licznik UDANYCH rozpoznan. Odpowiada na pytanie "czy ten telefon w ogole
  -- pracowal", ktore przy szesciu bramkach i jednej martwej jest pierwszym
  -- pytaniem koordynatora.
  scan_count integer NOT NULL DEFAULT 0,
  -- Licznik NIEUDANYCH rozpoznan tokenu uczestnika (kod nieznany w tym
  -- wydarzeniu). Monotoniczny, do odczytu w panelu - to jedyny sygnal, ze ktos
  -- probuje zgadywac tokeny wejsciowe ukradzionym poswiadczeniem.
  failed_scan_count integer NOT NULL DEFAULT 0,
  last_failed_scan_at timestamptz,
  -- Okno kroczace do decyzji o blokadzie. Osobne od licznika monotonicznego,
  -- bo prog musi liczyc nieudane proby W CZASIE - urzadzenie z 40 pomylkami
  -- rozlozonymi na dwa dni pracuje normalnie, z 40 w dziesiec minut nie.
  fail_window_started_at timestamptz,
  fail_window_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_scanner_devices_label_len
    CHECK (char_length(btrim(label)) BETWEEN 2 AND 120),
  CONSTRAINT event_scanner_devices_token_shape CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT event_scanner_devices_prefix_shape CHECK (token_prefix ~ '^[A-Za-z0-9_-]{8}$'),
  CONSTRAINT event_scanner_devices_scopes_nonempty
    CHECK (array_length(scopes, 1) IS NOT NULL AND array_length(scopes, 1) BETWEEN 1 AND 3),
  CONSTRAINT event_scanner_devices_scopes_values
    CHECK (scopes <@ ARRAY['checkin', 'lead', 'badge_print']::text[]),
  -- Zakres 'lead' bez sponsora tworzylby leada bez wlasciciela, a wlasciciel
  -- jest tu jedyna granica dostepu. Odrzucamy to na poziomie danych.
  CONSTRAINT event_scanner_devices_lead_needs_sponsor
    CHECK (NOT ('lead' = ANY (scopes)) OR sponsor_id IS NOT NULL),
  CONSTRAINT event_scanner_devices_counters_nonneg
    CHECK (scan_count >= 0 AND failed_scan_count >= 0 AND fail_window_count >= 0),
  CONSTRAINT event_scanner_devices_revoked_inactive
    CHECK (revoked_at IS NULL OR is_active = false),
  CONSTRAINT event_scanner_devices_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_scanner_devices_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_scanner_devices_checkpoint_fk
    FOREIGN KEY (tenant_id, event_id, checkpoint_id)
    REFERENCES public.event_checkpoints (tenant_id, event_id, id) ON DELETE SET NULL,
  CONSTRAINT event_scanner_devices_sponsor_fk
    FOREIGN KEY (tenant_id, event_id, sponsor_id)
    REFERENCES public.event_sponsors (tenant_id, event_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE public.event_scanner_devices IS
  'Poswiadczenie URZADZENIA skanujacego (nie osoby). Trzyma SHA-256 tokenu, zakresy uprawnien, terminy i liczniki bezpieczenstwa. Token jawny wraca z admin_event_scanner_device_issue dokladnie raz. Model zagrozen w naglowku migracji.';
COMMENT ON COLUMN public.event_scanner_devices.token_hash IS
  'SHA-256 tokenu urzadzenia. Odciety GRANTEM KOLUMNOWYM od roli authenticated (wzorzec events.join_url) - redaktor czytajacy tabele go nie widzi.';
COMMENT ON COLUMN public.event_scanner_devices.token_prefix IS
  'Pierwsze osiem znakow wartosci jawnej. Sluzy IDENTYFIKACJI wiersza po wydrukowanej kartce, zeby uniewaznienie bylo punktowe, a nie zbiorowe. Koszt: 144 bity entropii zamiast 192.';
COMMENT ON COLUMN public.event_scanner_devices.scopes IS
  'Zamkniety slownik zakresow: checkin | lead | badge_print. Tablica jest bezpieczna, bo elementy sa stalymi, a nie wskazaniami wierszy obcego najemcy.';
COMMENT ON COLUMN public.event_scanner_devices.is_active IS
  'Pauza ODWRACALNA. Uniewaznienie (revoked_at) jest nieodwracalne, blokada (locked_until) automatyczna - trzy rozne stany, bo trzy rozne decyzje.';
COMMENT ON COLUMN public.event_scanner_devices.expires_at IS
  'Termin waznosci, OBOWIAZKOWY. Poswiadczenie bez terminu zyje w pamieci telefonu wolontariusza bez konca; wygasniecie jest jedyna mitygacja dzialajaca bez czyjejkolwiek pamieci.';
COMMENT ON COLUMN public.event_scanner_devices.failed_scan_count IS
  'Monotoniczny licznik nieudanych rozpoznan tokenu uczestnika. Czytany w panelu - jedyny sygnal proby zgadywania tokenow ukradzionym poswiadczeniem.';
COMMENT ON COLUMN public.event_scanner_devices.fail_window_count IS
  'Nieudane proby w oknie kroczacym (10 minut). Po przekroczeniu progu 20 urzadzenie jest blokowane na 30 minut i emitowane jest zdarzenie event_scanner_device.locked.v1.';
COMMENT ON COLUMN public.event_scanner_devices.locked_until IS
  'Blokada automatyczna po serii nieudanych rozpoznan. Zdejmuje ja WYLACZNIE administrator (admin_event_scanner_device_set_active z is_active = true).';

CREATE UNIQUE INDEX IF NOT EXISTS event_scanner_devices_token_uniq
  ON public.event_scanner_devices (token_hash);
CREATE INDEX IF NOT EXISTS event_scanner_devices_event_idx
  ON public.event_scanner_devices (tenant_id, event_id, label);
CREATE INDEX IF NOT EXISTS event_scanner_devices_checkpoint_idx
  ON public.event_scanner_devices (tenant_id, checkpoint_id) WHERE checkpoint_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_scanner_devices_sponsor_idx
  ON public.event_scanner_devices (tenant_id, sponsor_id) WHERE sponsor_id IS NOT NULL;

-- GRANT KOLUMNOWY: bez `token_hash`. Wzorzec `events.join_url` z 20260702200000
-- i `event_sessions.stream_url` z 20260823140000. Droga do wiersza dla panelu
-- prowadzi przez admin_event_scanner_devices_list(), ktore hasza nie oddaje.
REVOKE ALL ON public.event_scanner_devices FROM anon, authenticated;
GRANT SELECT (
  id, tenant_id, event_id, checkpoint_id, sponsor_id, label, token_prefix,
  scopes, is_active, expires_at, revoked_at, revoked_by, last_seen_at,
  scan_count, failed_scan_count, last_failed_scan_at,
  fail_window_started_at, fail_window_count, locked_until,
  created_by, created_at, updated_at
) ON public.event_scanner_devices TO authenticated;
GRANT ALL ON public.event_scanner_devices TO service_role;

ALTER TABLE public.event_scanner_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_scanner_devices_staff_read" ON public.event_scanner_devices;
CREATE POLICY "event_scanner_devices_staff_read"
  ON public.event_scanner_devices FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP TRIGGER IF EXISTS event_scanner_devices_touch_updated_at ON public.event_scanner_devices;
CREATE TRIGGER event_scanner_devices_touch_updated_at
  BEFORE UPDATE ON public.event_scanner_devices
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3) ODPRAWA - DZIENNIK SKANOW
--
-- Ta tabela odpowiada na pytanie, ktore w calej platformie nie ma dzis zadnego
-- zrodla: KTO NAPRAWDE PRZYSZEDL. Reputacja liczy `events_attended` z
-- `event_rsvps` (20260721152000), czyli z deklaracji - a deklaracja i obecnosc
-- rozjezdzaja sie o kilkadziesiat procent.
--
-- DZIENNIK, NIE STAN. Wiersze sa DOPISYWANE. Nie ma sciezki UPDATE poza
-- podniesieniem licznika powtorzen (`repeat_count`) i nie ma sciezki DELETE
-- poza kaskada usuniecia wydarzenia. Dlatego takze ODMOWA dostaje wlasny
-- wiersz z wlasnym powodem: pierwsze pytanie po skardze uczestnika brzmi
-- "dlaczego mnie nie wpuscili o 9:12", a wiersz, ktorego nie ma, na to nie
-- odpowie.
--
-- SZESC WYNIKOW, bo szesc roznych rozmow z uczestnikiem:
--   granted                     - wpuszczony;
--   denied_not_registered       - nie ma zapisu na to wydarzenie (kod z innego
--                                 wydarzenia albo osoba z ulicy);
--   denied_registration_status  - zapis istnieje, ale nie uprawnia (oczekuje
--                                 decyzji, odrzucony, anulowany, rezerwa);
--   denied_direction            - punkt nie obsluguje tego kierunku;
--   denied_capacity             - limit rownoczesnej obecnosci wyczerpany;
--   denied_checkpoint_inactive  - punkt zostal wylaczony, a skaner ma jeszcze
--                                 stara konfiguracje w pamieci (praca offline).
--
-- KOD NIEZNANY NIE MA TU WIERSZA i to jest decyzja, nie przeoczenie. Dziennik
-- jest prowadzony PER OSOBA (`person_id NOT NULL`); kod, ktory nie rozwiazuje
-- sie do zadnej osoby, nie ma czyjego wiersza wypelnic. Takie proby licza sie
-- na wierszu URZADZENIA (`failed_scan_count`) - tam, gdzie jest ich znaczenie:
-- to sygnal bezpieczenstwa, nie fakt o uczestniku. Gdyby szly do dziennika,
-- zawieszony skaner utopilby liste odpraw w wierszach bez osoby.
--
-- KTO SKANOWAL: DOKLADNIE JEDNO Z DWOCH. `num_nonnulls(operator_user_id,
-- device_id) = 1` - albo redaktor z panelu, albo urzadzenie z tokenem. Trzecia
-- mozliwosc ("system") nie istnieje, bo nie ma sciezki, ktora by ja tworzyla,
-- a kolumna dopuszczajaca oba NULL-e zamienia dziennik w zbior wierszy bez
-- autora.
--
-- CZAS: DWIE KOLUMNY, BO DWA ROZNE FAKTY. `scanned_at` to chwila, w ktorej
-- SERWER przyjal wiersz; `device_scanned_at` to chwila, w ktorej URZADZENIE
-- zobaczylo kod. Przy pracy offline roznia sie o godziny. Do histogramu i do
-- okna idempotencji liczy sie druga, bo mowi, kiedy czlowiek stal przy bramce -
-- dlatego istnieje `occurred_at` jako kolumna wyliczana z obu.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  checkpoint_id uuid NOT NULL,
  person_id uuid NOT NULL,
  -- Zapis, na podstawie ktorego zapadla decyzja. NULL = wejscie bez zapisu
  -- (rejestracja przy drzwiach albo odmowa z powodu braku zapisu). Bez
  -- kaskady i bez SET NULL: zapis, ktory ma odprawe, jest DOKUMENTEM - nie
  -- kasuje sie, tylko anuluje. Prosba o DELETE odbija sie od klucza obcego,
  -- i to jest zamierzone (ta sama decyzja co event_sponsors.company_id).
  registration_id uuid,
  direction text NOT NULL DEFAULT 'in',
  result text NOT NULL DEFAULT 'granted',
  source text NOT NULL DEFAULT 'qr_code',
  scanned_at timestamptz NOT NULL DEFAULT now(),
  device_scanned_at timestamptz,
  occurred_at timestamptz GENERATED ALWAYS AS
    (COALESCE(device_scanned_at, scanned_at)) STORED,
  -- Okno idempotencji tego wiersza. Ustawia je trigger z okna PUNKTU, a nie
  -- kolumna wyliczana: `timestamptz + interval` jest w Postgresie STABLE, nie
  -- IMMUTABLE (wynik zalezy od strefy sesji dla skladowych dniowych), wiec
  -- generowana kolumna odbila by sie o "generation expression is not
  -- immutable". Trigger nie ma tego ograniczenia, a jedyna droga zapisu do tej
  -- tabeli i tak prowadzi przez SECURITY DEFINER.
  dedupe_range tstzrange NOT NULL,
  operator_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  device_id uuid,
  -- Klucz idempotencji NADANY PRZEZ SKANER: jeden fizyczny skan = jedna
  -- wartosc. Chroni przed powtornym wyslaniem kolejki offline, ktorego okno
  -- czasowe nie zlapie (kolejka moze wrocic po trzech godzinach).
  client_scan_uid text,
  repeat_count integer NOT NULL DEFAULT 0,
  last_repeat_at timestamptz,
  note text,
  CONSTRAINT event_checkins_direction_values CHECK (direction IN ('in', 'out')),
  CONSTRAINT event_checkins_result_values CHECK (result IN (
    'granted',
    'denied_not_registered',
    'denied_registration_status',
    'denied_direction',
    'denied_capacity',
    'denied_checkpoint_inactive'
  )),
  CONSTRAINT event_checkins_source_values CHECK (source IN (
    'qr_code', 'manual_entry', 'name_search', 'self_service'
  )),
  CONSTRAINT event_checkins_actor_exactly_one
    CHECK (num_nonnulls(operator_user_id, device_id) = 1),
  CONSTRAINT event_checkins_client_uid_shape CHECK (
    client_scan_uid IS NULL
    OR client_scan_uid ~ '^[A-Za-z0-9_-]{8,64}$'
  ),
  CONSTRAINT event_checkins_repeat_nonneg CHECK (repeat_count >= 0),
  CONSTRAINT event_checkins_repeat_dated
    CHECK (repeat_count = 0 OR last_repeat_at IS NOT NULL),
  CONSTRAINT event_checkins_note_len CHECK (note IS NULL OR char_length(note) <= 500),
  -- Czas urzadzenia nie moze byc z przyszlosci wzgledem przyjecia wiersza
  -- (zegar telefonu przestawiony do przodu falszowalby histogram) ani starszy
  -- niz tydzien (to nie jest kolejka offline, to import z zeszlego wydarzenia).
  CONSTRAINT event_checkins_device_time_sane CHECK (
    device_scanned_at IS NULL
    OR (device_scanned_at <= scanned_at + interval '2 minutes'
        AND device_scanned_at >= scanned_at - interval '7 days')
  ),
  CONSTRAINT event_checkins_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_checkins_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_checkins_checkpoint_fk FOREIGN KEY (tenant_id, event_id, checkpoint_id)
    REFERENCES public.event_checkpoints (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_checkins_person_fk FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_checkins_registration_fk
    FOREIGN KEY (tenant_id, event_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id),
  CONSTRAINT event_checkins_device_fk FOREIGN KEY (tenant_id, device_id)
    REFERENCES public.event_scanner_devices (tenant_id, id)
);

COMMENT ON TABLE public.event_checkins IS
  'Dziennik odpraw wydarzenia: kto, gdzie, w ktorym kierunku, z jakim wynikiem i czym zeskanowany. Wiersze DOPISYWANE - jedyny UPDATE to licznik powtorzen. Zapis wylacznie przez _event_checkin_write (plaszczyzna urzadzenia i panelu).';
COMMENT ON COLUMN public.event_checkins.registration_id IS
  'Zapis, na podstawie ktorego zapadla decyzja. NULL = wejscie bez zapisu. Klucz obcy BEZ kaskady: zapis z odprawa jest dokumentem, wiec jego usuniecie jest odrzucane.';
COMMENT ON COLUMN public.event_checkins.result IS
  'granted | denied_not_registered | denied_registration_status | denied_direction | denied_capacity | denied_checkpoint_inactive. Odmowa MA wiersz - bez niego nie da sie odpowiedziec, dlaczego kogos nie wpuszczono.';
COMMENT ON COLUMN public.event_checkins.source IS
  'qr_code | manual_entry | name_search | self_service. Plaszczyzna urzadzenia moze zapisac wylacznie qr_code i self_service, plaszczyzna panelu wylacznie manual_entry i name_search - mapowanie jest wymuszone w RPC, nie w interfejsie.';
COMMENT ON COLUMN public.event_checkins.occurred_at IS
  'Chwila, w ktorej czlowiek stal przy bramce: czas urzadzenia, a gdy go nie ma - czas przyjecia przez serwer. Nosnik histogramu i okna idempotencji.';
COMMENT ON COLUMN public.event_checkins.dedupe_range IS
  'Okno idempotencji [occurred_at, occurred_at + okno punktu). Nosnik ograniczen EXCLUDE, ktore blokuja druga ZGODE dla tej samej osoby, punktu i kierunku w tym oknie.';
COMMENT ON COLUMN public.event_checkins.client_scan_uid IS
  'Klucz idempotencji nadany przez skaner (jeden fizyczny skan = jedna wartosc). Chroni przed powtornym wyslaniem kolejki offline, ktorego okno czasowe nie zlapie.';
COMMENT ON COLUMN public.event_checkins.repeat_count IS
  'Ile razy ten sam skan powtorzyl sie w oknie idempotencji. Podwojne pikniecie NIE tworzy wiersza - podnosi ten licznik, wiec zawieszony skaner nie utopi listy odpraw.';

-- Klucz idempotencji skanera: unikalny w granicach najemcy I wydarzenia.
-- Czesciowy, bo plaszczyzna panelu klucza nie podaje (redaktor klika raz).
CREATE UNIQUE INDEX IF NOT EXISTS event_checkins_client_uid_uniq
  ON public.event_checkins (tenant_id, event_id, client_scan_uid)
  WHERE client_scan_uid IS NOT NULL;
-- Lista panelu i histogram: najemca, wydarzenie, czas malejaco.
CREATE INDEX IF NOT EXISTS event_checkins_event_time_idx
  ON public.event_checkins (tenant_id, event_id, occurred_at DESC);
-- Obciazenie punktow i wyliczenie obecnosci (ostatni kierunek per osoba).
CREATE INDEX IF NOT EXISTS event_checkins_checkpoint_person_idx
  ON public.event_checkins (tenant_id, checkpoint_id, person_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS event_checkins_checkpoint_result_idx
  ON public.event_checkins (tenant_id, checkpoint_id, result, occurred_at DESC);
-- "Czy ta osoba juz byla" - pytanie zadawane przy kazdym skanie.
CREATE INDEX IF NOT EXISTS event_checkins_person_idx
  ON public.event_checkins (tenant_id, event_id, person_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS event_checkins_registration_idx
  ON public.event_checkins (tenant_id, registration_id) WHERE registration_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_checkins_device_idx
  ON public.event_checkins (tenant_id, device_id, occurred_at DESC) WHERE device_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3a) Trigger okna idempotencji
--
-- Okno bierzemy z PUNKTU ODPRAWY i utrwalamy w wierszu. Utrwalenie jest tu
-- istotne: gdyby ograniczenie EXCLUDE liczylo okno z biezacej konfiguracji
-- punktu, skrocenie okna uniewazniloby historyczne rozstrzygniecia, a
-- wydluzenie moglo by uniemozliwic wstawienie wiersza pasujacego do reguly
-- obowiazujacej w chwili skanu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_event_checkins_set_dedupe_range()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window integer;
  v_at timestamptz := COALESCE(NEW.device_scanned_at, NEW.scanned_at);
BEGIN
  SELECT cp.dedupe_window_seconds INTO v_window
  FROM public.event_checkpoints cp
  WHERE cp.tenant_id = NEW.tenant_id
    AND cp.event_id = NEW.event_id
    AND cp.id = NEW.checkpoint_id;

  -- Brak punktu jest niemozliwy (klucz obcy zlozony), ale wartosc zapasowa
  -- kosztuje jedna linie i chroni przed wierszem bez okna przy imporcie.
  NEW.dedupe_range := tstzrange(
    v_at,
    v_at + make_interval(secs => COALESCE(v_window, 60)),
    '[)'
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_event_checkins_set_dedupe_range() IS
  'Ustawia okno idempotencji wiersza odprawy z konfiguracji punktu. Trigger, a nie kolumna wyliczana, bo timestamptz + interval jest w Postgresie STABLE, nie IMMUTABLE.';

DROP TRIGGER IF EXISTS event_checkins_set_dedupe_range ON public.event_checkins;
CREATE TRIGGER event_checkins_set_dedupe_range
  BEFORE INSERT OR UPDATE OF scanned_at, device_scanned_at, checkpoint_id
  ON public.event_checkins
  FOR EACH ROW EXECUTE FUNCTION public.tg_event_checkins_set_dedupe_range();

-- ----------------------------------------------------------------------------
-- 3b) Ograniczenia kolizji okna idempotencji
--
-- DWA ograniczenia, po jednym na kierunek, zamiast jednego z `direction WITH =`.
-- Powod jest praktyczny: wariant z kolumna tekstowa wymaga klasy operatorow
-- `gist_text_ops`, czyli DRUGIEJ zaleznosci od btree_gist obok `gist_uuid_ops`.
-- Rozbicie na dwa ograniczenia czesciowe daje identyczna semantyke przy jednej
-- zaleznosci i przy okazji dwa wezsze indeksy.
--
-- Zakres `WHERE result = 'granted'` jest ISTOTNY. Okno chroni FAKT OBECNOSCI,
-- a nie kazda probe. Gdyby obejmowalo odmowy, powstalby blad nastepujacy:
-- uczestnik odbija sie o 9:12 (zapis oczekuje decyzji), organizator zatwierdza
-- go o 9:12:30, uczestnik odbija ponownie o 9:12:40 - i ograniczenie odrzucaloby
-- teraz ZASADNE wejscie, bo w oknie jest juz wiersz odmowy.
--
-- Klasa operatorow `gist_uuid_ops` przychodzi z btree_gist, ktore w hostowanym
-- Supabase mieszka w schemacie `extensions` - a ten nie musi byc w search_path
-- w chwili migracji. Dlatego nazwa jest skladana z katalogu, dokladnie jak w
-- 20260823140000 przy kolizji sal.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_opclass text;
  v_direction text;
  v_conname text;
BEGIN
  SELECT quote_ident(n.nspname) || '.gist_uuid_ops'
    INTO v_opclass
  FROM pg_opclass oc
  JOIN pg_namespace n ON n.oid = oc.opcnamespace
  JOIN pg_am am ON am.oid = oc.opcmethod
  WHERE oc.opcname = 'gist_uuid_ops' AND am.amname = 'gist'
  LIMIT 1;

  IF v_opclass IS NULL THEN
    RAISE EXCEPTION 'btree_gist_missing: klasa gist_uuid_ops nie istnieje - idempotencji odprawy nie da sie wymusic w silniku';
  END IF;

  FOREACH v_direction IN ARRAY ARRAY['in', 'out'] LOOP
    v_conname := 'event_checkins_no_double_' || v_direction;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.event_checkins'::regclass
        AND conname = v_conname
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.event_checkins ADD CONSTRAINT %2$I '
      'EXCLUDE USING gist (tenant_id %1$s WITH =, checkpoint_id %1$s WITH =, '
      'person_id %1$s WITH =, dedupe_range WITH &&) '
      'WHERE (result = ''granted'' AND direction = %3$L)',
      v_opclass, v_conname, v_direction
    );
  END LOOP;
END
$$;

COMMENT ON CONSTRAINT event_checkins_no_double_in ON public.event_checkins IS
  'Jedna osoba nie moze miec dwoch ZGOD na wejscie w tym samym punkcie w oknie idempotencji. Bramka wyscigu dla _event_checkin_write - glownym mechanizmem jest odczyt wiersza w oknie i podniesienie licznika powtorzen.';
COMMENT ON CONSTRAINT event_checkins_no_double_out ON public.event_checkins IS
  'Jak event_checkins_no_double_in, dla kierunku wyjscia. Dwa ograniczenia czesciowe zamiast jednego z gist_text_ops - jedna zaleznosc od btree_gist mniej.';

-- Dziennik jest czytany przez panel i przez RPC. Klient nie ma sciezki zapisu.
GRANT SELECT ON public.event_checkins TO authenticated;
GRANT ALL ON public.event_checkins TO service_role;

ALTER TABLE public.event_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_checkins_staff_read" ON public.event_checkins;
CREATE POLICY "event_checkins_staff_read"
  ON public.event_checkins FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- 4) SZABLON IDENTYFIKATORA
--
-- JEDNOSTKI SA FIZYCZNE (milimetry), nie piksele. Identyfikator musi wyjsc
-- identyczny z drukarki etykiet w recepcji i z biurowej A4 - a piksel nie ma
-- rozmiaru, dopoki nie zna DPI urzadzenia. Format nazwany (`a6`, `badge_90x54`)
-- jest skrotem do pary milimetrow; `custom` wymaga tej pary jawnie (CHECK).
--
-- UKLAD JEST LISTA BLOKOW, NIE PLOTNEM XY. `elements` to tablica jsonb blokow
-- ukladanych PIONOWO, kazdy z wlasna szerokoscia, wyrownaniem i odstepem.
-- Swobodne pozycjonowanie XY wyglada elastycznie i gwarantuje, ze kiedys
-- nazwisko "Wojciechowska-Kaczmarczyk" wyjdzie za krawedz kartki, o czym
-- redaktor dowie sie po wydrukowaniu trzystu sztuk. Lista blokow moze sie
-- najwyzej zawinac.
--
-- SLOWNIK BLOKOW JEST ZAMKNIETY i sprawdzany w RPC zapisu, nie CHECK-iem:
--   rodzaje: text | field | image | qr | sponsors | spacer
--   pola:    first_name | last_name | full_name | company | job_title |
--            ticket_name | group_name | event_title | event_dates
-- CHECK na kolumnie pilnuje KSZTALTU (tablica, gorna granica dlugosci), bo
-- walidacja per element wymaga petli i czytelnych komunikatow bledu - a to
-- nalezy do funkcji, ktora jest jedyna droga zapisu.
--
-- WERSJA ROSNIE PRZY ZMIANIE UKLADU. Rejestr wydrukow zapisuje wersje, wiec
-- pytanie "czy identyfikator tego czlowieka jest jeszcze aktualny" ma
-- odpowiedz: wydrukowana wersja mniejsza od biezacej znaczy "przedruk".
-- Wersji NIE podnosi zmiana samej nazwy szablonu - to nie zmienia kartki.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_badge_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  -- Nazwa JEDNOJEZYCZNA: to etykieta wewnetrzna dla redakcji ("Uczestnik A6",
  -- "Prelegent ze smycza"), nigdy nie pokazywana uczestnikowi. Ta sama decyzja
  -- co przy `event_rooms.name`.
  name text NOT NULL,
  paper_format text NOT NULL DEFAULT 'a6',
  width_mm numeric(6, 2),
  height_mm numeric(6, 2),
  orientation text NOT NULL DEFAULT 'portrait',
  -- Kartka zlozona na pol i noszona na smyczy - druga polowa jest odbiciem
  -- lustrzanym pierwszej, zeby napis byl czytelny z obu stron.
  double_fold boolean NOT NULL DEFAULT false,
  background_color text,
  background_image_url text,
  show_qr boolean NOT NULL DEFAULT true,
  qr_size_mm numeric(5, 2) NOT NULL DEFAULT 25.00,
  elements jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_badge_templates_name_len
    CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  CONSTRAINT event_badge_templates_paper_format_values CHECK (paper_format IN (
    'a4', 'a5', 'a6', 'a7', 'badge_90x54', 'badge_100x150', 'custom'
  )),
  CONSTRAINT event_badge_templates_orientation_values
    CHECK (orientation IN ('portrait', 'landscape')),
  -- Format wlasny bez wymiarow to kartka o nieznanym rozmiarze. Format nazwany
  -- z wymiarami to dwa zrodla prawdy o tym samym - odrzucamy oba przypadki.
  CONSTRAINT event_badge_templates_custom_dimensions CHECK (
    (paper_format = 'custom' AND width_mm IS NOT NULL AND height_mm IS NOT NULL)
    OR (paper_format <> 'custom' AND width_mm IS NULL AND height_mm IS NULL)
  ),
  -- Dolna granica 20 mm: mniejsza kartka nie zmiesci nazwiska. Gorna 420 mm:
  -- to dluzsza krawedz A3, powyzej tego nie jest to identyfikator.
  CONSTRAINT event_badge_templates_dimensions_range CHECK (
    (width_mm IS NULL OR width_mm BETWEEN 20 AND 420)
    AND (height_mm IS NULL OR height_mm BETWEEN 20 AND 420)
  ),
  CONSTRAINT event_badge_templates_qr_size_range
    CHECK (qr_size_mm BETWEEN 10 AND 100),
  -- Kolor jedzie do CSS jako zmienna, wiec musi byc literalem heksadecymalnym.
  CONSTRAINT event_badge_templates_background_hex
    CHECK (background_color IS NULL OR background_color ~ '^#[0-9a-fA-F]{6}$'),
  -- Tlo jedzie do atrybutu src. Sciezka wzgledna jest dopuszczona, bo grafika
  -- wgrana do naszego magazynu podawana jest jako `/storage/...`.
  CONSTRAINT event_badge_templates_background_url_shape CHECK (
    background_image_url IS NULL OR background_image_url ~ '^(https?://|/)'
  ),
  CONSTRAINT event_badge_templates_elements_array
    CHECK (jsonb_typeof(elements) = 'array' AND jsonb_array_length(elements) <= 40),
  CONSTRAINT event_badge_templates_version_positive CHECK (version >= 1),
  CONSTRAINT event_badge_templates_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_badge_templates_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_badge_templates_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_badge_templates IS
  'Szablon identyfikatora wydarzenia: format fizyczny w milimetrach, uklad blokow jako tablica jsonb, tlo, kod QR i WERSJA. Zapis wylacznie przez admin_event_badge_template_save.';
COMMENT ON COLUMN public.event_badge_templates.name IS
  'Etykieta wewnetrzna dla redakcji, jednojezyczna - uczestnik jej nie widzi (ta sama decyzja co event_rooms.name).';
COMMENT ON COLUMN public.event_badge_templates.paper_format IS
  'a4 | a5 | a6 | a7 | badge_90x54 | badge_100x150 | custom. Format nazwany jest skrotem do pary milimetrow; custom wymaga width_mm i height_mm jawnie (CHECK custom_dimensions).';
COMMENT ON COLUMN public.event_badge_templates.double_fold IS
  'Kartka zlozona na pol na smyczy - druga polowa jest odbiciem lustrzanym, zeby napis byl czytelny z obu stron.';
COMMENT ON COLUMN public.event_badge_templates.elements IS
  'Tablica blokow ukladanych PIONOWO. Rodzaje: text | field | image | qr | sponsors | spacer. Pola: first_name | last_name | full_name | company | job_title | ticket_name | group_name | event_title | event_dates. Walidacja per element w admin_event_badge_template_save - bez swobodnego XY, bo XY gwarantuje, ze dlugie nazwisko kiedys wyjdzie za krawedz.';
COMMENT ON COLUMN public.event_badge_templates.version IS
  'Wersja UKLADU. Rosnie, gdy zmienia sie cokolwiek widoczne na kartce; nie rosnie przy zmianie samej nazwy szablonu. Rejestr wydrukow zapisuje wersje, wiec przedruk da sie odroznic od pierwszego wydania.';

-- Dokladnie jeden szablon domyslny na wydarzenie. Dwa domyslne znaczylyby, ze
-- wybor jest losowy - dokladnie ta sama decyzja co event_groups_default_uniq.
CREATE UNIQUE INDEX IF NOT EXISTS event_badge_templates_default_uniq
  ON public.event_badge_templates (tenant_id, event_id) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS event_badge_templates_event_name_uniq
  ON public.event_badge_templates (tenant_id, event_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS event_badge_templates_event_idx
  ON public.event_badge_templates (tenant_id, event_id, name);

GRANT SELECT ON public.event_badge_templates TO authenticated;
GRANT ALL ON public.event_badge_templates TO service_role;

ALTER TABLE public.event_badge_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_badge_templates_staff_read" ON public.event_badge_templates;
CREATE POLICY "event_badge_templates_staff_read"
  ON public.event_badge_templates FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP TRIGGER IF EXISTS event_badge_templates_touch_updated_at ON public.event_badge_templates;
CREATE TRIGGER event_badge_templates_touch_updated_at
  BEFORE UPDATE ON public.event_badge_templates
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 5) REJESTR WYDRUKOW IDENTYFIKATORA
--
-- Bez tej tabeli nie da sie odpowiedziec na pytanie zadawane przy kazdej
-- recepcji: CZY TEN CZLOWIEK JUZ ODEBRAL IDENTYFIKATOR. Szablon mowi, jak
-- wyglada kartka; nie mowi, czy kartka istnieje. To dwie rozne rzeczy i
-- dlatego dwie tabele.
--
-- POWOD WYDRUKU JEST WYMAGANY, bo od niego zalezy rozliczenie: pierwsze
-- wydanie jest w cenie wejsciowki, przedruk zgubionego bywa platny, a
-- poprawka danych jest bledem organizatora. Jedna kolumna `is_reprint`
-- zlewalaby te trzy rozmowy w jedna.
--
-- WERSJA SZABLONU JEST KOPIOWANA, nie wskazywana przez klucz obcy do wersji:
-- szablon zyje dalej i bedzie edytowany, a wydruk ma pamietac, CO wyszlo
-- z drukarki. To ta sama doktryna co migawka prezentacji sponsora.
--
-- DZIENNIK, NIE STAN: wiersze dopisywane, bez UPDATE i bez DELETE.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_badge_prints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  person_id uuid NOT NULL,
  registration_id uuid,
  template_id uuid,
  -- Wersja szablonu W CHWILI WYDRUKU. Kopia, nie wskazanie - szablon bedzie
  -- edytowany, a kartka juz wyszla z drukarki.
  template_version integer NOT NULL,
  copies integer NOT NULL DEFAULT 1,
  reason text NOT NULL DEFAULT 'first_issue',
  printed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  device_id uuid,
  printed_at timestamptz NOT NULL DEFAULT now(),
  note text,
  CONSTRAINT event_badge_prints_reason_values CHECK (reason IN (
    'first_issue', 'reprint_lost', 'reprint_damaged', 'data_correction', 'bulk_preprint'
  )),
  -- Gorna granica dwudziestu kopii: wiecej to pomylka w polu, nie decyzja.
  CONSTRAINT event_badge_prints_copies_range CHECK (copies BETWEEN 1 AND 20),
  CONSTRAINT event_badge_prints_version_positive CHECK (template_version >= 1),
  CONSTRAINT event_badge_prints_note_len CHECK (note IS NULL OR char_length(note) <= 500),
  -- Kto wydrukowal: redaktor z panelu ALBO stanowisko samoobslugowe. Trzeciej
  -- mozliwosci nie ma, a wiersz bez autora nie jest dowodem wydania.
  CONSTRAINT event_badge_prints_actor_exactly_one
    CHECK (num_nonnulls(printed_by, device_id) = 1),
  CONSTRAINT event_badge_prints_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_badge_prints_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_badge_prints_person_fk FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_badge_prints_registration_fk
    FOREIGN KEY (tenant_id, event_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id),
  -- BEZ kaskady i BEZ SET NULL. Przy kluczu obcym ZLOZONYM klauzula SET NULL
  -- wyzerowalaby WSZYSTKIE kolumny klucza, w tym `tenant_id NOT NULL` - wiersz
  -- odbilby sie od NOT NULL w chwili usuwania szablonu. Zostaje wiec NO ACTION,
  -- co jest tu i tak wlasciwa decyzja: szablon, ktorym cokolwiek wydrukowano,
  -- nie kasuje sie, bo wydruk jest dowodem wydania. Blokade z czytelnym
  -- komunikatem stawia admin_event_badge_template_delete (template_in_use).
  CONSTRAINT event_badge_prints_template_fk
    FOREIGN KEY (tenant_id, event_id, template_id)
    REFERENCES public.event_badge_templates (tenant_id, event_id, id),
  CONSTRAINT event_badge_prints_device_fk FOREIGN KEY (tenant_id, device_id)
    REFERENCES public.event_scanner_devices (tenant_id, id)
);

COMMENT ON TABLE public.event_badge_prints IS
  'Rejestr wydrukow identyfikatora: kto, kiedy, ktora osoba, ktora WERSJA szablonu, ile kopii i z jakiego powodu. Bez tej tabeli nie da sie odpowiedziec, czy identyfikator zostal wydany. Dziennik - wiersze dopisywane.';
COMMENT ON COLUMN public.event_badge_prints.template_version IS
  'Wersja szablonu w chwili wydruku. Kopia, nie wskazanie: szablon bedzie edytowany, a kartka juz wyszla z drukarki.';
COMMENT ON COLUMN public.event_badge_prints.reason IS
  'first_issue | reprint_lost | reprint_damaged | data_correction | bulk_preprint. Powod decyduje o rozliczeniu - pierwsze wydanie jest w cenie, przedruk bywa platny, poprawka danych jest bledem organizatora.';

CREATE INDEX IF NOT EXISTS event_badge_prints_person_idx
  ON public.event_badge_prints (tenant_id, event_id, person_id, printed_at DESC);
CREATE INDEX IF NOT EXISTS event_badge_prints_event_time_idx
  ON public.event_badge_prints (tenant_id, event_id, printed_at DESC);
CREATE INDEX IF NOT EXISTS event_badge_prints_template_idx
  ON public.event_badge_prints (tenant_id, template_id) WHERE template_id IS NOT NULL;

GRANT SELECT ON public.event_badge_prints TO authenticated;
GRANT ALL ON public.event_badge_prints TO service_role;

ALTER TABLE public.event_badge_prints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_badge_prints_staff_read" ON public.event_badge_prints;
CREATE POLICY "event_badge_prints_staff_read"
  ON public.event_badge_prints FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- 6) SKAN LEADA PRZEZ SPONSORA
--
-- Sponsor na stoisku skanuje identyfikator uczestnika i dopisuje notatke.
-- To jest jedyna operacja tej tabeli.
--
-- ZGODA UCZESTNIKA JEST WARUNKIEM PRAWNYM I WYNIKA Z MODELU, NIE Z DOBREJ WOLI
-- INTERFEJSU. Realizacja jest strukturalna, a nie proceduralna:
--
--   (1) TA TABELA NIE ZAWIERA ANI JEDNEJ KOLUMNY Z DANYMI KONTAKTOWYMI.
--       Ani adresu, ani telefonu, ani nazwiska. Trzyma WSKAZANIE osoby
--       (`person_id`) plus wlasne dane sponsora (notatka, ocena). Nie ma wiec
--       czego wyciec zrzutem tej tabeli - dane kontaktowe pozostaja tam, gdzie
--       byly, czyli w `event_people`.
--
--   (2) JEDYNA DROGA DO DANYCH KONTAKTOWYCH prowadzi przez
--       `event_lead_scans_list()` (plaszczyzna urzadzenia) albo panel. Warunek
--       zgody siedzi w KLAUZULI WHERE tej funkcji, wiec nie da sie go pominac
--       ani wylaczyc przelacznikiem. Funkcja czyta stan ZYWY zgody, nie
--       migawke - wycofanie zgody po skanie odcina dostep natychmiast.
--
--   (3) `consent_snapshot_at` jest DOWODEM, nie warunkiem: mowi, na czym
--       oparlismy sie w chwili skanu. Dwie daty (nadanie i wycofanie) sa
--       potrzebne obie, dokladnie jak przy `event_people.consent_withdrawn_at`.
--
-- WLASCICIELEM LEADA JEST PRZYPIECIE SPONSORA (`sponsor_id`), a nie firma
-- z kartoteki. Powod: ta sama firma sponsoruje wiele wydarzen, a leady jednego
-- wydarzenia nie moga wyciec do obslugi stoiska na drugim. Przypiecie jest
-- wiazane potrojnie `(tenant_id, event_id, sponsor_id)`, wiec granica jest
-- w silniku.
--
-- JEDEN LEAD NA SPONSORA I OSOBE. Powtorny skan tej samej osoby przy tym samym
-- stoisku nie tworzy drugiego leada - podnosi licznik i aktualizuje notatke.
-- Dwa wiersze znaczylyby dwie osoby w eksporcie do CRM.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_lead_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  sponsor_id uuid NOT NULL,
  person_id uuid NOT NULL,
  registration_id uuid,
  checkpoint_id uuid,
  device_id uuid,
  scanned_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  first_scanned_at timestamptz NOT NULL DEFAULT now(),
  last_scanned_at timestamptz NOT NULL DEFAULT now(),
  scan_count integer NOT NULL DEFAULT 1,
  note text,
  -- Ocena zainteresowania w skali 1-5. Skala liczbowa, a nie slownik etykiet,
  -- bo jedyne, co sponsor z nia robi, to sortowanie listy przed telefonem.
  interest_rating smallint,
  -- DOWOD zgody z chwili skanu. NIE jest warunkiem dostepu - warunkiem jest
  -- stan zywy w event_people, czytany w klauzuli WHERE funkcji odczytu.
  consent_snapshot_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_lead_scans_note_len CHECK (note IS NULL OR char_length(note) <= 2000),
  CONSTRAINT event_lead_scans_rating_range
    CHECK (interest_rating IS NULL OR interest_rating BETWEEN 1 AND 5),
  CONSTRAINT event_lead_scans_count_positive CHECK (scan_count >= 1),
  CONSTRAINT event_lead_scans_time_order CHECK (last_scanned_at >= first_scanned_at),
  -- Kto skanowal: urzadzenie stoiska ALBO redaktor wpisujacy lead z panelu.
  CONSTRAINT event_lead_scans_actor_exactly_one
    CHECK (num_nonnulls(scanned_by_user_id, device_id) = 1),
  -- Jeden lead na sponsora i osobe. Powtorny skan podnosi licznik.
  CONSTRAINT event_lead_scans_sponsor_person_unique
    UNIQUE (tenant_id, sponsor_id, person_id),
  CONSTRAINT event_lead_scans_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_lead_scans_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_lead_scans_sponsor_fk FOREIGN KEY (tenant_id, event_id, sponsor_id)
    REFERENCES public.event_sponsors (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_lead_scans_person_fk FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_lead_scans_registration_fk
    FOREIGN KEY (tenant_id, event_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id),
  CONSTRAINT event_lead_scans_checkpoint_fk
    FOREIGN KEY (tenant_id, event_id, checkpoint_id)
    REFERENCES public.event_checkpoints (tenant_id, event_id, id) ON DELETE SET NULL,
  CONSTRAINT event_lead_scans_device_fk FOREIGN KEY (tenant_id, device_id)
    REFERENCES public.event_scanner_devices (tenant_id, id)
);

COMMENT ON TABLE public.event_lead_scans IS
  'Lead zebrany przez sponsora na stoisku. Tabela NIE ZAWIERA danych kontaktowych - trzyma wskazanie osoby i wlasne dane sponsora. Jedyna droga do kontaktu prowadzi przez event_lead_scans_list z warunkiem ZYWEJ zgody w klauzuli WHERE.';
COMMENT ON COLUMN public.event_lead_scans.sponsor_id IS
  'Przypiecie sponsora do TEGO wydarzenia, nie firma z kartoteki. Ta sama firma sponsoruje wiele wydarzen, a leady jednego nie moga wyciec do obslugi stoiska na drugim.';
COMMENT ON COLUMN public.event_lead_scans.consent_snapshot_at IS
  'DOWOD zgody z chwili skanu. Nie jest warunkiem dostepu - warunkiem jest stan ZYWY w event_people (nadanie bez wycofania), czytany w klauzuli WHERE funkcji odczytu.';
COMMENT ON COLUMN public.event_lead_scans.interest_rating IS
  'Ocena zainteresowania 1-5. Skala liczbowa, bo jej jedynym zastosowaniem jest kolejnosc telefonow po wydarzeniu.';
COMMENT ON COLUMN public.event_lead_scans.scan_count IS
  'Ile razy sponsor zeskanowal te osobe. Powtorny skan nie tworzy drugiego leada - dwa wiersze znaczylyby dwie osoby w eksporcie do CRM.';

CREATE INDEX IF NOT EXISTS event_lead_scans_sponsor_idx
  ON public.event_lead_scans (tenant_id, sponsor_id, last_scanned_at DESC);
CREATE INDEX IF NOT EXISTS event_lead_scans_event_idx
  ON public.event_lead_scans (tenant_id, event_id, last_scanned_at DESC);
CREATE INDEX IF NOT EXISTS event_lead_scans_person_idx
  ON public.event_lead_scans (tenant_id, person_id);

GRANT SELECT ON public.event_lead_scans TO authenticated;
GRANT ALL ON public.event_lead_scans TO service_role;

ALTER TABLE public.event_lead_scans ENABLE ROW LEVEL SECURITY;

-- JEDYNA polityka: odczyt stafowy w tenancie domowym. Sponsor NIE czyta tej
-- tabeli przez PostgREST - obsada stoiska nie ma konta w platformie, a jej
-- droga do wlasnych leadow prowadzi przez event_lead_scans_list() z bramka
-- tokenu urzadzenia. Gdyby polityka wpuszczala tu obsade stoiska, filtr
-- "tylko moje leady" musialby byc warunkiem polityki, a wspolna tabela
-- z filtrem po stronie interfejsu to wyciek jednym SELECT-em.
DROP POLICY IF EXISTS "event_lead_scans_staff_read" ON public.event_lead_scans;
CREATE POLICY "event_lead_scans_staff_read"
  ON public.event_lead_scans FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP TRIGGER IF EXISTS event_lead_scans_touch_updated_at ON public.event_lead_scans;
CREATE TRIGGER event_lead_scans_touch_updated_at
  BEFORE UPDATE ON public.event_lead_scans
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ============================================================================
-- FUNKCJE WEWNETRZNE
--
-- Wszystkie sa `REVOKE ALL FROM PUBLIC, anon, authenticated` - wolane wylacznie
-- z wnetrza innych funkcji SECURITY DEFINER (cialo takiej funkcji wykonuje sie
-- z prawami wlasciciela, wiec grant dla roli klienckiej jest zbedny). Wzorzec
-- z `_event_new_qr_token()` w 20260823150000.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- W1) Token urzadzenia - jawny raz, w bazie tylko hasz
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_new_scanner_token();
CREATE OR REPLACE FUNCTION public._event_new_scanner_token()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  -- base64url bez wypelnienia: token jedzie w adresie strony skanera i w kodzie
  -- QR do sparowania urzadzenia, wiec nie moze zawierac znakow wymagajacych
  -- kodowania procentowego. 24 bajty = 192 bity entropii.
  SELECT replace(replace(rtrim(encode(gen_random_bytes(24), 'base64'), '='), '+', '-'), '/', '_');
$$;

REVOKE ALL ON FUNCTION public._event_new_scanner_token() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_new_scanner_token() TO service_role;

COMMENT ON FUNCTION public._event_new_scanner_token() IS
  'Losowy token urzadzenia skanujacego (24 bajty, base64url). Do tabeli idzie wylacznie sha256 tej wartosci plus osiem pierwszych znakow jako prefiks identyfikacyjny.';

-- ----------------------------------------------------------------------------
-- W2) Uwierzytelnienie urzadzenia tokenem
--
-- TO JEST CALA BRAMKA PLASZCZYZNY URZADZENIA. Funkcja przyjmuje token jawny,
-- odszukuje wiersz po HASZU i zwraca go, o ile poswiadczenie zyje i ma zadany
-- zakres. Najemca i wydarzenie sa WYNIKIEM tego odszukania, nie argumentem -
-- dlatego nie ma tu naglowka hosta do podrobienia i nie ma roli do eskalacji.
--
-- Odszukanie idzie po indeksie unikalnym `event_scanner_devices_token_uniq`
-- BEZ warunku na tenanta i to jest nieodzowne: jedynym wejsciem jest sekret,
-- a tenant jest tym, co z niego wynika. Kazde nastepne zapytanie w funkcji
-- wolajacej jest juz skalowane po `tenant_id` ORAZ `event_id` z tego wiersza.
--
-- KOMUNIKATY BLEDU SA ROZNE dla roznych stanow poswiadczenia (uniewaznione,
-- wygasle, zablokowane, bez zakresu) i to jest decyzja: obsada bramki musi
-- wiedziec, czy dzwonic po nowy token, czy poczekac. Rozroznienie nie wycieka
-- nic napastnikowi - zeby je zobaczyc, trzeba juz miec wazny token.
--
-- CZEGO TU NIE MA: ograniczenia czestotliwosci dla NIEZNANEGO tokenu. Napastnik
-- zgadujacy token zmienia go przy kazdej probie, wiec licznik po kluczu tokenu
-- jest bezuzyteczny, a licznik globalny bylby narzedziem do wylaczenia
-- wszystkich bramek wydarzenia. Realna mitygacja zgadywania to entropia (192
-- bity), a realna mitygacja NADUZYCIA WAZNEGO tokenu to licznik nieudanych
-- rozpoznan na wierszu urzadzenia (W3) - i ona tu jest.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_scanner_device_auth(text, text);
CREATE OR REPLACE FUNCTION public._event_scanner_device_auth(_token text, _scope text)
RETURNS public.event_scanner_devices
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_clean text := btrim(COALESCE(_token, ''));
  v_device public.event_scanner_devices;
BEGIN
  IF v_clean !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'invalid_device_token: scanner token is missing or malformed';
  END IF;

  SELECT d.* INTO v_device
  FROM public.event_scanner_devices d
  WHERE d.token_hash = encode(digest(v_clean, 'sha256'), 'hex');

  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'invalid_device_token: scanner token is not known';
  END IF;

  IF v_device.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'device_revoked: this scanner credential was revoked';
  END IF;

  IF NOT v_device.is_active THEN
    RAISE EXCEPTION 'device_inactive: this scanner credential is paused';
  END IF;

  IF v_device.expires_at <= now() THEN
    RAISE EXCEPTION 'device_expired: this scanner credential has expired';
  END IF;

  IF v_device.locked_until IS NOT NULL AND v_device.locked_until > now() THEN
    RAISE EXCEPTION 'device_locked: this scanner credential is temporarily locked';
  END IF;

  IF _scope IS NOT NULL AND NOT (_scope = ANY (v_device.scopes)) THEN
    RAISE EXCEPTION 'device_scope_missing: this scanner credential has no % scope', _scope;
  END IF;

  -- Znacznik ostatniej aktywnosci. Przy okazji zdejmujemy wygasla blokade,
  -- zeby okno kroczace zaczynalo sie od zera po odczekaniu kary.
  UPDATE public.event_scanner_devices
  SET last_seen_at = now(),
      locked_until = CASE WHEN locked_until <= now() THEN NULL ELSE locked_until END,
      fail_window_count = CASE WHEN locked_until <= now() THEN 0 ELSE fail_window_count END
  WHERE id = v_device.id;

  RETURN v_device;
END;
$$;

REVOKE ALL ON FUNCTION public._event_scanner_device_auth(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_device_auth(text, text) TO service_role;

COMMENT ON FUNCTION public._event_scanner_device_auth(text, text) IS
  'Bramka plaszczyzny urzadzenia: token jawny -> wiersz poswiadczenia. Najemca i wydarzenie sa WYNIKIEM odszukania po haszu, nie argumentem - nie ma naglowka do podrobienia ani roli do eskalacji. Sprawdza uniewaznienie, pauze, termin, blokade i zakres.';

-- ----------------------------------------------------------------------------
-- W3) Licznik nieudanych rozpoznan i blokada automatyczna
--
-- Kod, ktory nie rozwiazuje sie do zadnej osoby, nie ma czyjego wiersza
-- dziennika wypelnic - ale JEST sygnalem bezpieczenstwa. Licznik monotoniczny
-- (`failed_scan_count`) jest tym, co panel pokazuje; okno kroczace jest tym,
-- co decyduje o blokadzie.
--
-- PROGI: 20 nieudanych rozpoznan w oknie 10 minut zamyka urzadzenie na 30
-- minut i emituje zdarzenie domenowe. Uzasadnienie liczb: przy rejestracji
-- realny operator myli sie kilka razy na godzine (zniszczony wydruk, kod
-- z zeszlego wydarzenia); dwadziescia razy w dziesiec minut nie jest juz
-- pomylka. Trzydziesci minut kary jest krotsze niz cierpliwosc napastnika
-- i dluzsze niz przerwa kawowa, po ktorej operator wraca do pracy.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_scanner_device_note_failure(uuid);
CREATE OR REPLACE FUNCTION public._event_scanner_device_note_failure(_device_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_minutes constant integer := 10;
  v_threshold constant integer := 20;
  v_lock_minutes constant integer := 30;
  v_row public.event_scanner_devices;
  v_locked boolean := false;
BEGIN
  IF _device_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.event_scanner_devices d
  SET failed_scan_count = d.failed_scan_count + 1,
      last_failed_scan_at = now(),
      fail_window_started_at = CASE
        WHEN d.fail_window_started_at IS NULL
          OR d.fail_window_started_at < now() - make_interval(mins => v_window_minutes)
        THEN now()
        ELSE d.fail_window_started_at
      END,
      fail_window_count = CASE
        WHEN d.fail_window_started_at IS NULL
          OR d.fail_window_started_at < now() - make_interval(mins => v_window_minutes)
        THEN 1
        ELSE d.fail_window_count + 1
      END
  WHERE d.id = _device_id
  RETURNING d.* INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN false;
  END IF;

  IF v_row.fail_window_count >= v_threshold
     AND (v_row.locked_until IS NULL OR v_row.locked_until <= now()) THEN
    UPDATE public.event_scanner_devices
    SET locked_until = now() + make_interval(mins => v_lock_minutes)
    WHERE id = _device_id;
    v_locked := true;

    PERFORM public.emit_domain_event(
      v_row.tenant_id,
      'event_scanner_device',
      v_row.id::text,
      'event_scanner_device.locked.v1',
      jsonb_build_object(
        'event_id', v_row.event_id,
        'device_id', v_row.id,
        'label', v_row.label,
        'token_prefix', v_row.token_prefix,
        'failures_in_window', v_row.fail_window_count,
        'locked_minutes', v_lock_minutes
      ),
      NULL::uuid
    );
  END IF;

  RETURN v_locked;
END;
$$;

REVOKE ALL ON FUNCTION public._event_scanner_device_note_failure(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_device_note_failure(uuid) TO service_role;

COMMENT ON FUNCTION public._event_scanner_device_note_failure(uuid) IS
  'Podnosi licznik nieudanych rozpoznan tokenu uczestnika i po 20 probach w oknie 10 minut blokuje urzadzenie na 30 minut, emitujac event_scanner_device.locked.v1. Zwraca true, gdy blokada wlasnie zapadla.';

-- ----------------------------------------------------------------------------
-- W4) Obecnosc w punkcie odprawy
--
-- Liczba osob, ktorych OSTATNI skan w tym punkcie byl wejsciem. Liczymy
-- z dziennika, a nie z kolumny-licznika: licznik na wierszu punktu dryfuje
-- przy kazdym wyjatku, a poprawna wartosc jest wyprowadzalna. Funkcja LICZY,
-- NIE REZERWUJE - wolajacy musi trzymac blokade wiersza punktu, dokladnie jak
-- przy `_event_seats_left()`.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_checkpoint_occupancy(uuid, uuid);
CREATE OR REPLACE FUNCTION public._event_checkpoint_occupancy(_tenant uuid, _checkpoint_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer
  FROM (
    SELECT DISTINCT ON (c.person_id) c.direction
    FROM public.event_checkins c
    WHERE c.tenant_id = _tenant
      AND c.checkpoint_id = _checkpoint_id
      AND c.result = 'granted'
    ORDER BY c.person_id, c.occurred_at DESC, c.id
  ) last_scan
  WHERE last_scan.direction = 'in';
$$;

REVOKE ALL ON FUNCTION public._event_checkpoint_occupancy(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkpoint_occupancy(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_checkpoint_occupancy(uuid, uuid) IS
  'Ile osob jest AKTUALNIE w punkcie (ostatni skan osoby = wejscie). Liczy z dziennika, nie z kolumny-licznika, ktora dryfuje. Liczy, nie rezerwuje - wolajacy trzyma blokade wiersza punktu.';

-- ----------------------------------------------------------------------------
-- W5) Karta uczestnika dla operatora - MINIMUM DANYCH
--
-- To jest cala odpowiedz, jaka operator przy bramce dostaje o czlowieku:
-- imie, nazwisko, firma, stanowisko, bilet, grupa, status zapisu, czy ma
-- identyfikator. NIE MA TU ADRESU POCZTY ANI TELEFONU i to jest decyzja, nie
-- przeoczenie: bramka nie potrzebuje danych kontaktowych do wpuszczenia
-- czlowieka, a poswiadczenie urzadzenia bywa przechwycone. Kazde pole, ktorego
-- tu nie ma, jest polem, ktore nie wycieknie przez skaner.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_onsite_person_card(uuid, uuid, uuid);
CREATE OR REPLACE FUNCTION public._event_onsite_person_card(
  _tenant uuid,
  _event_id uuid,
  _person_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'person_id', p.id,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'company', COALESCE(NULLIF(btrim(p.company_text), ''), co.name),
    'job_title', p.job_title,
    'registration_id', r.id,
    'registration_status', r.status,
    'ticket_name_pl', tt.name_pl,
    'ticket_name_en', tt.name_en,
    'group_name_pl', COALESCE(g.name_pl, dg.name_pl),
    'group_name_en', COALESCE(g.name_en, dg.name_en),
    'group_color', COALESCE(g.color, dg.color),
    'badge_printed', (bp.printed_at IS NOT NULL),
    'badge_printed_at', bp.printed_at,
    'badge_printed_version', bp.template_version
  )
  INTO v_out
  FROM public.event_people p
  LEFT JOIN public.crm_companies co
    ON co.tenant_id = p.tenant_id AND co.id = p.company_id
  LEFT JOIN public.event_registrations r
    ON r.tenant_id = p.tenant_id
   AND r.event_id = _event_id
   AND r.person_id = p.id
   AND r.status NOT IN ('cancelled', 'rejected')
  LEFT JOIN public.event_ticket_types tt
    ON tt.tenant_id = r.tenant_id AND tt.id = r.ticket_type_id
  LEFT JOIN public.event_groups g
    ON g.tenant_id = r.tenant_id AND g.id = r.group_id
  -- Grupa domyslna wydarzenia jako wartosc zapasowa: zapis bez biletu nie ma
  -- wskazanej grupy, a identyfikator i tak musi cos wydrukowac.
  LEFT JOIN public.event_groups dg
    ON dg.tenant_id = p.tenant_id AND dg.event_id = _event_id AND dg.is_default
  LEFT JOIN LATERAL (
    SELECT bpr.printed_at, bpr.template_version
    FROM public.event_badge_prints bpr
    WHERE bpr.tenant_id = p.tenant_id
      AND bpr.event_id = _event_id
      AND bpr.person_id = p.id
    ORDER BY bpr.printed_at DESC
    LIMIT 1
  ) bp ON true
  WHERE p.tenant_id = _tenant
    AND p.id = _person_id;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public._event_onsite_person_card(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_onsite_person_card(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_onsite_person_card(uuid, uuid, uuid) IS
  'Minimum danych operatora bramki: imie, nazwisko, firma, stanowisko, bilet, grupa, status zapisu, stan identyfikatora. BEZ adresu poczty i telefonu - bramka ich nie potrzebuje, a poswiadczenie urzadzenia bywa przechwycone.';

-- ----------------------------------------------------------------------------
-- W6a) OCENA - jedna definicja decyzji dla podgladu i dla zapisu
--
-- Rozpoznanie kodu (podglad, bez wiersza) i zapis odprawy MUSZA odpowiadac
-- identycznie, inaczej operator widzi zielony ekran i dostaje czerwony wynik
-- w dzienniku. Dlatego regula zyje w JEDNYM miejscu, a obie sciezki ja wolaja.
--
-- Funkcja LICZY, NIE REZERWUJE: w sciezce zapisu wolajacy trzyma blokade
-- wiersza punktu i tylko wtedy wynik "wolne miejsce jest" jest wiazacy.
-- W sciezce podgladu blokady nie ma i to jest poprawne - podglad nie obiecuje
-- miejsca, tylko pokazuje stan na teraz.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_checkin_evaluate(uuid, uuid, uuid, uuid, text);
CREATE OR REPLACE FUNCTION public._event_checkin_evaluate(
  _tenant uuid,
  _event_id uuid,
  _checkpoint_id uuid,
  _person_id uuid,
  _direction text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cp public.event_checkpoints;
  v_reg_id uuid;
  v_status text;
  v_result text;
  v_occupancy integer;
BEGIN
  SELECT cp.* INTO v_cp
  FROM public.event_checkpoints cp
  WHERE cp.tenant_id = _tenant
    AND cp.event_id = _event_id
    AND cp.id = _checkpoint_id;

  IF v_cp.id IS NULL THEN
    RAISE EXCEPTION 'checkpoint_not_found: checkpoint does not exist in this event';
  END IF;

  v_occupancy := public._event_checkpoint_occupancy(_tenant, _checkpoint_id);

  IF NOT v_cp.is_active THEN
    v_result := 'denied_checkpoint_inactive';
  ELSIF (_direction = 'in' AND v_cp.direction_mode = 'out_only')
     OR (_direction = 'out' AND v_cp.direction_mode = 'in_only') THEN
    v_result := 'denied_direction';
  ELSE
    -- Indeks czesciowy `event_registrations_active_uniq` gwarantuje NAJWYZEJ
    -- jeden wiersz spelniajacy ten warunek, wiec nie ma tu czego rozstrzygac.
    SELECT r.id, r.status INTO v_reg_id, v_status
    FROM public.event_registrations r
    WHERE r.tenant_id = _tenant
      AND r.event_id = _event_id
      AND r.person_id = _person_id
      AND r.status NOT IN ('cancelled', 'rejected');

    IF v_reg_id IS NULL THEN
      v_result := 'denied_not_registered';
    ELSIF v_status NOT IN ('approved', 'attended') THEN
      v_result := 'denied_registration_status';
    ELSIF _direction = 'in' AND v_cp.capacity IS NOT NULL AND v_occupancy >= v_cp.capacity THEN
      v_result := 'denied_capacity';
    ELSE
      v_result := 'granted';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'result', v_result,
    'registration_id', v_reg_id,
    'occupancy', v_occupancy,
    'capacity', v_cp.capacity,
    'access_mode', v_cp.access_mode
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_checkin_evaluate(uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkin_evaluate(uuid, uuid, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public._event_checkin_evaluate(uuid, uuid, uuid, uuid, text) IS
  'Jedna definicja decyzji odprawy dla podgladu (event_checkin_resolve) i dla zapisu (_event_checkin_write). Liczy, nie rezerwuje - wiazacy jest tylko wynik policzony pod blokada wiersza punktu.';

-- ----------------------------------------------------------------------------
-- W6) ZAPIS ODPRAWY - jedyna droga do dziennika
--
-- Jedna funkcja obsluguje OBIE plaszczyzny (urzadzenie i panel), bo decyzja
-- "wpuscic czy nie" musi byc identyczna niezaleznie od tego, kto skanuje. Dwie
-- kopie tej logiki rozjechalyby sie na pierwszej zmianie definicji odmowy,
-- a rozjazd byloby widac dopiero w raporcie frekwencji.
--
-- KOLEJNOSC KROKOW JEST CZESCIA KONTRAKTU:
--   1. klucz idempotencji skanera - zanim cokolwiek policzymy, bo powtorzone
--      wyslanie kolejki nie ma prawa niczego zmienic;
--   2. BLOKADA WIERSZA PUNKTU (`FOR UPDATE`) - dopiero pod nia liczymy
--      obecnosc i szukamy wiersza w oknie. Blokada najpierw, liczenie potem:
--      ta sama doktryna co przy limicie miejsc w `_event_waitlist_promote`;
--   3. wynik (kierunek, aktywnosc punktu, zapis, status zapisu);
--   4. limit obecnosci - tylko dla wejscia i tylko gdy punkt ma limit
--      (a limit ma wylacznie punkt w trybie `control`, patrz CHECK);
--   5. okno idempotencji - wiersz o TYM SAMYM wyniku w oknie podnosi licznik
--      powtorzen zamiast tworzyc drugi wiersz;
--   6. wstawienie, z ograniczeniem EXCLUDE jako bramka wyscigu.
--
-- DLACZEGO KROK 5 POROWNUJE WYNIK. Uczestnik odbija sie o 9:12 (zapis czeka na
-- decyzje), organizator zatwierdza go o 9:12:30, uczestnik odbija ponownie
-- o 9:12:40. Gdyby okno sklejalo wiersze bez patrzenia na wynik, drugie -
-- zasadne - wejscie zostaloby uznane za powtorzenie odmowy. Porownanie wyniku
-- zamienia to w dwa wiersze, ktore razem opowiadaja, co sie stalo.
--
-- STEMPEL OBECNOSCI NA ZAPISIE. Zgoda na WEJSCIE ustawia
-- `event_registrations.attended_at` i przestawia status `approved` -> `attended`.
-- To jedyna sciezka w calej platformie, ktora ten status naprawde nadaje: bez
-- niej stan `attended` z migracji 20260823150000 bylby wartoscia, ktorej nikt
-- nie zapisuje, a frekwencja dalej liczylaby sie z deklaracji.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_checkin_write(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text
);
CREATE OR REPLACE FUNCTION public._event_checkin_write(
  _tenant uuid,
  _event_id uuid,
  _checkpoint_id uuid,
  _person_id uuid,
  _direction text,
  _source text,
  _device_id uuid,
  _operator uuid,
  _client_uid text,
  _device_at timestamptz,
  _note text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dir text := lower(btrim(COALESCE(_direction, 'in')));
  v_cp public.event_checkpoints;
  v_eval jsonb;
  v_reg_id uuid;
  v_prev public.event_checkins;
  v_row public.event_checkins;
  v_result text;
  v_outcome text;
  v_at timestamptz;
  v_occupancy integer;
  v_admit boolean;
  v_prev_at timestamptz;
  v_done boolean := false;
BEGIN
  IF v_dir NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'invalid_direction: direction must be in or out';
  END IF;

  IF _source NOT IN ('qr_code', 'manual_entry', 'name_search', 'self_service') THEN
    RAISE EXCEPTION 'invalid_payload: unknown check-in source %', _source;
  END IF;

  -- 1) Klucz idempotencji skanera.
  IF _client_uid IS NOT NULL THEN
    SELECT c.* INTO v_row
    FROM public.event_checkins c
    WHERE c.tenant_id = _tenant
      AND c.event_id = _event_id
      AND c.client_scan_uid = _client_uid;

    IF v_row.id IS NOT NULL THEN
      v_outcome := 'replay';
      v_done := true;
    END IF;
  END IF;

  IF NOT v_done THEN
    -- 2) Blokada wiersza punktu. Serializuje limit obecnosci ORAZ odczyt okna
    --    idempotencji: dwa skany tej samej osoby na dwoch telefonach ustawiaja
    --    sie w kolejce, zamiast obaj widziec puste okno.
    SELECT cp.* INTO v_cp
    FROM public.event_checkpoints cp
    WHERE cp.tenant_id = _tenant
      AND cp.event_id = _event_id
      AND cp.id = _checkpoint_id
    FOR UPDATE;

    IF v_cp.id IS NULL THEN
      RAISE EXCEPTION 'checkpoint_not_found: checkpoint does not exist in this event';
    END IF;

    v_at := COALESCE(_device_at, now());
    -- Zegar telefonu przestawiony do przodu falszowalby histogram i okno.
    -- CHECK dopuszcza dwie minuty luzu na rozjazd zegarow; wyzej przycinamy.
    IF v_at > now() THEN
      v_at := now();
    END IF;

    -- 3) i 4) Wynik razem z limitem obecnosci - JEDNA definicja decyzji,
    --    wspolna z podgladem (`_event_checkin_evaluate`). Liczona POD blokada
    --    z punktu 2, wiec wynik "wolne miejsce jest" jest tu wiazacy.
    v_eval := public._event_checkin_evaluate(
      _tenant, _event_id, _checkpoint_id, _person_id, v_dir
    );
    v_result := v_eval->>'result';
    v_reg_id := NULLIF(v_eval->>'registration_id', '')::uuid;

    -- 5) Okno idempotencji: wiersz o TYM SAMYM wyniku podnosi licznik.
    SELECT c.* INTO v_prev
    FROM public.event_checkins c
    WHERE c.tenant_id = _tenant
      AND c.checkpoint_id = _checkpoint_id
      AND c.person_id = _person_id
      AND c.direction = v_dir
      AND c.dedupe_range @> v_at
    ORDER BY c.occurred_at DESC, c.id
    LIMIT 1;

    IF v_prev.id IS NOT NULL AND v_prev.result = v_result THEN
      UPDATE public.event_checkins
      SET repeat_count = repeat_count + 1,
          last_repeat_at = now()
      WHERE id = v_prev.id
      RETURNING * INTO v_row;

      v_outcome := 'repeat';
      v_done := true;
    END IF;

    IF NOT v_done THEN
      -- 6) Wstawienie. Ograniczenie EXCLUDE jest bramka WYSCIGU: dwa skany,
      --    ktore minely sie miedzy krokiem 5 i tym INSERT-em, nie utworza
      --    dwoch zgod. Wyjatek lapiemy i zwracamy wiersz, ktory wygral.
      BEGIN
        INSERT INTO public.event_checkins (
          tenant_id, event_id, checkpoint_id, person_id, registration_id,
          direction, result, source, scanned_at, device_scanned_at,
          operator_user_id, device_id, client_scan_uid, note
        ) VALUES (
          _tenant, _event_id, _checkpoint_id, _person_id, v_reg_id,
          v_dir, v_result, _source, now(), _device_at,
          _operator, _device_id, _client_uid, NULLIF(btrim(COALESCE(_note, '')), '')
        )
        RETURNING * INTO v_row;

        -- Stempel obecnosci na zapisie - jedyna sciezka nadajaca status
        -- `attended` w calej platformie.
        IF v_result = 'granted' AND v_dir = 'in' AND v_reg_id IS NOT NULL THEN
          UPDATE public.event_registrations
          SET status = CASE WHEN status = 'approved' THEN 'attended' ELSE status END,
              attended_at = COALESCE(attended_at, v_at)
          WHERE tenant_id = _tenant AND id = v_reg_id;
        END IF;

        v_outcome := CASE WHEN v_result = 'granted' THEN 'granted' ELSE v_result END;
      EXCEPTION
        WHEN unique_violation OR exclusion_violation THEN
          v_row := NULL;

          IF _client_uid IS NOT NULL THEN
            SELECT c.* INTO v_row
            FROM public.event_checkins c
            WHERE c.tenant_id = _tenant
              AND c.event_id = _event_id
              AND c.client_scan_uid = _client_uid;
          END IF;

          IF v_row.id IS NOT NULL THEN
            v_outcome := 'replay';
          ELSE
            SELECT c.* INTO v_row
            FROM public.event_checkins c
            WHERE c.tenant_id = _tenant
              AND c.checkpoint_id = _checkpoint_id
              AND c.person_id = _person_id
              AND c.direction = v_dir
              AND c.result = 'granted'
              AND c.dedupe_range @> v_at
            ORDER BY c.occurred_at DESC, c.id
            LIMIT 1;

            -- Kolizja, ktorej nie umiemy wyjasnic, nie jest powtorzeniem -
            -- oddajemy ja wolajacemu, zamiast udawac sukces.
            IF v_row.id IS NULL THEN
              RAISE;
            END IF;

            UPDATE public.event_checkins
            SET repeat_count = repeat_count + 1,
                last_repeat_at = now()
            WHERE id = v_row.id
            RETURNING * INTO v_row;

            v_outcome := 'repeat';
          END IF;
      END;
    END IF;
  END IF;

  -- Odpowiedz. Punkt czytamy z wiersza, nie z argumentu: sciezka powtornego
  -- wyslania kolejki moze oddac wiersz z innego punktu, gdy skaner pomylil
  -- klucze idempotencji, i operator ma o tym wiedziec.
  SELECT cp.* INTO v_cp
  FROM public.event_checkpoints cp
  WHERE cp.tenant_id = _tenant AND cp.id = v_row.checkpoint_id;

  v_occupancy := public._event_checkpoint_occupancy(_tenant, v_row.checkpoint_id);

  SELECT max(c.occurred_at) INTO v_prev_at
  FROM public.event_checkins c
  WHERE c.tenant_id = _tenant
    AND c.event_id = v_row.event_id
    AND c.person_id = v_row.person_id
    AND c.result = 'granted'
    AND c.id <> v_row.id;

  -- Punkt w trybie `track` wpuszcza osobe, ktorej NIE UMIE zidentyfikowac jako
  -- zapisanej - bo jego zadaniem jest mierzyc, nie zatrzymywac. NIE zamazuje
  -- natomiast zlego kierunku, pelnej sali ani wylaczonego punktu: to nie sa
  -- watpliwosci co do uprawnien, to sa fakty o punkcie.
  v_admit := v_row.result = 'granted'
    OR (
      v_cp.access_mode = 'track'
      AND v_row.result IN ('denied_not_registered', 'denied_registration_status')
    );

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'admit', v_admit,
    'result', v_row.result,
    'checkin_id', v_row.id,
    'direction', v_row.direction,
    'occurred_at', v_row.occurred_at,
    'repeat_count', v_row.repeat_count,
    'previous_checkin_at', v_prev_at,
    'checkpoint', jsonb_build_object(
      'id', v_cp.id,
      'name_pl', v_cp.name_pl,
      'name_en', v_cp.name_en,
      'kind', v_cp.kind,
      'direction_mode', v_cp.direction_mode,
      'access_mode', v_cp.access_mode,
      'capacity', v_cp.capacity,
      'occupancy', v_occupancy
    ),
    'person', public._event_onsite_person_card(_tenant, v_row.event_id, v_row.person_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_checkin_write(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkin_write(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text
) TO service_role;

COMMENT ON FUNCTION public._event_checkin_write(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text
) IS
  'Jedyna droga do dziennika odpraw, wspolna dla plaszczyzny urzadzenia i panelu. Blokada wiersza punktu, wynik, limit obecnosci, okno idempotencji, wstawienie z ograniczeniem EXCLUDE jako bramka wyscigu. Zgoda na wejscie stempluje event_registrations.attended_at.';

-- ============================================================================
-- PLASZCZYZNA URZADZENIA
--
-- Piec funkcji, kazda z bramka "hasz tokenu urzadzenia" i kazda z waskim
-- kontraktem. Grant idzie do `anon` ORAZ `authenticated`, bo obsada bramki nie
-- ma konta w platformie, a jednoczesnie skaner moze byc otwarty przez
-- zalogowanego koordynatora. Tokenem jest sekret, nie sesja - dlatego rola
-- wolajacego nie zmienia tu niczego i zadna z tych funkcji NIE WOLA has_role()
-- ani public_tenant_id().
--
-- CZEGO TU NIE MA I DLACZEGO: funkcji szukajacej osoby po nazwisku, po adresie
-- poczty ani po fragmencie czegokolwiek. Wejsciem jest zawsze TOKEN JEDNEJ
-- OSOBY, a wyjsciem jedna osoba. Skaner nie ma zadnej sciezki, ktora daje
-- LISTE uczestnikow - to jest wymog bezpieczenstwa, nie oszczednosc. Szukanie
-- po nazwisku istnieje wylacznie w panelu (admin_event_checkin_search) za
-- bramka assert_editor_tenant().
-- ============================================================================

-- ----------------------------------------------------------------------------
-- U1) Konfiguracja urzadzenia po sparowaniu
--
-- Skaner po pierwszym uruchomieniu musi wiedziec, gdzie pracuje: ktore
-- wydarzenie, ktory punkt (albo ktore punkty do wyboru), jakie ma uprawnienia
-- i do kiedy zyje token. Bez tej funkcji cala ta wiedza musialaby byc wpisana
-- recznie w telefon przy kazdej bramce.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_scanner_bootstrap(jsonb);
CREATE OR REPLACE FUNCTION public.event_scanner_bootstrap(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_event public.events;
  v_checkpoints jsonb;
BEGIN
  v_device := public._event_scanner_device_auth(p_payload->>'device_token', NULL);

  SELECT e.* INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_device.tenant_id AND e.id = v_device.event_id;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'sort_order', x->>'name_pl'), '[]'::jsonb)
  INTO v_checkpoints
  FROM (
    SELECT jsonb_build_object(
      'id', cp.id,
      'name_pl', cp.name_pl,
      'name_en', cp.name_en,
      'kind', cp.kind,
      'direction_mode', cp.direction_mode,
      'access_mode', cp.access_mode,
      'capacity', cp.capacity,
      'dedupe_window_seconds', cp.dedupe_window_seconds,
      'sort_order', cp.sort_order
    ) AS x
    FROM public.event_checkpoints cp
    WHERE cp.tenant_id = v_device.tenant_id
      AND cp.event_id = v_device.event_id
      AND cp.is_active
      -- Urzadzenie przypiete do punktu widzi TYLKO swoj punkt. Operator nie ma
      -- czego wybrac, wiec nie moze wybrac zle.
      AND (v_device.checkpoint_id IS NULL OR cp.id = v_device.checkpoint_id)
  ) src;

  RETURN jsonb_build_object(
    'device_id', v_device.id,
    'label', v_device.label,
    'scopes', to_jsonb(v_device.scopes),
    'expires_at', v_device.expires_at,
    'pinned_checkpoint_id', v_device.checkpoint_id,
    'sponsor_id', v_device.sponsor_id,
    'event', jsonb_build_object(
      'id', v_event.id,
      'slug', v_event.slug,
      'title_pl', v_event.title_pl,
      'title_en', v_event.title_en,
      'starts_at', v_event.starts_at,
      'ends_at', v_event.ends_at,
      'timezone', v_event.timezone
    ),
    'checkpoints', v_checkpoints
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_scanner_bootstrap(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_scanner_bootstrap(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_scanner_bootstrap(jsonb) IS
  'Konfiguracja skanera po sparowaniu: wydarzenie, dostepne punkty odprawy, zakresy uprawnien, termin waznosci tokenu. Payload: {device_token}. Bramka: hasz tokenu urzadzenia.';

-- ----------------------------------------------------------------------------
-- U2) Rozpoznanie kodu QR - PODGLAD, bez wiersza w dzienniku
--
-- Dwie osobne operacje (rozpoznanie i zapis) sa potrzebne, bo w trybie
-- `control` operator musi zobaczyc decyzje PRZED wpuszczeniem i moze
-- rozmowe przerwac ("to bilet na wczoraj"). W trybie `track` skaner wola
-- od razu `event_checkin_record` - jedno pikniecie, jeden wiersz.
--
-- KOD NIEZNANY podnosi licznik nieudanych rozpoznan urzadzenia (W3) i NIE
-- tworzy wiersza w dzienniku - dziennik jest prowadzony per osoba, a tu nie ma
-- osoby. Dwadziescia takich prob w dziesiec minut zamyka urzadzenie.
--
-- KOD Z INNEGO WYDARZENIA nie jest bledem bezpieczenstwa (to prawdziwy token
-- tego najemcy), wiec licznika nie podnosi. Oddajemy tytul tamtego wydarzenia,
-- bo to zamienia bezradne "kod nieprawidlowy" w zdanie, ktore konczy rozmowe
-- przy bramce. Tytul wydarzenia nie jest dana osobowa.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_checkin_resolve(jsonb);
CREATE OR REPLACE FUNCTION public.event_checkin_resolve(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_code text := btrim(COALESCE(p_payload->>'code', ''));
  v_checkpoint_id uuid;
  v_cp public.event_checkpoints;
  v_direction text;
  v_reg record;
  v_eval jsonb;
  v_locked boolean;
  v_prev_at timestamptz;
BEGIN
  v_device := public._event_scanner_device_auth(p_payload->>'device_token', 'checkin');

  IF v_code = '' THEN
    RAISE EXCEPTION 'invalid_payload: code is required';
  END IF;

  v_checkpoint_id := COALESCE(
    NULLIF(p_payload->>'checkpoint_id', '')::uuid,
    v_device.checkpoint_id
  );
  IF v_checkpoint_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: checkpoint_id is required for a device without a pinned checkpoint';
  END IF;
  IF v_device.checkpoint_id IS NOT NULL AND v_checkpoint_id <> v_device.checkpoint_id THEN
    RAISE EXCEPTION 'device_checkpoint_mismatch: this credential is pinned to another checkpoint';
  END IF;

  SELECT cp.* INTO v_cp
  FROM public.event_checkpoints cp
  WHERE cp.tenant_id = v_device.tenant_id
    AND cp.event_id = v_device.event_id
    AND cp.id = v_checkpoint_id;
  IF v_cp.id IS NULL THEN
    RAISE EXCEPTION 'checkpoint_not_found: checkpoint does not exist in this event';
  END IF;

  -- Kierunek domyslny wynika z punktu. Wybor jest mozliwy tylko tam, gdzie
  -- punkt naprawde obsluguje oba kierunki.
  v_direction := lower(btrim(COALESCE(
    p_payload->>'direction',
    CASE v_cp.direction_mode WHEN 'out_only' THEN 'out' ELSE 'in' END
  )));
  IF v_direction NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'invalid_direction: direction must be in or out';
  END IF;

  -- Odszukanie po HASZU tokenu wejsciowego, w granicach najemcy urzadzenia.
  SELECT r.id, r.event_id, r.person_id, r.status INTO v_reg
  FROM public.event_registrations r
  WHERE r.tenant_id = v_device.tenant_id
    AND r.qr_token_hash = encode(digest(v_code, 'sha256'), 'hex');

  IF v_reg.id IS NULL THEN
    v_locked := public._event_scanner_device_note_failure(v_device.id);
    RETURN jsonb_build_object(
      'outcome', 'unknown_code',
      'admit', false,
      'result', NULL,
      'device_locked', v_locked,
      'checkpoint', jsonb_build_object(
        'id', v_cp.id, 'name_pl', v_cp.name_pl, 'name_en', v_cp.name_en,
        'kind', v_cp.kind, 'direction_mode', v_cp.direction_mode,
        'access_mode', v_cp.access_mode
      ),
      'person', NULL
    );
  END IF;

  IF v_reg.event_id <> v_device.event_id THEN
    RETURN jsonb_build_object(
      'outcome', 'wrong_event',
      'admit', false,
      'result', NULL,
      'device_locked', false,
      'other_event', (
        SELECT jsonb_build_object('title_pl', e.title_pl, 'title_en', e.title_en)
        FROM public.events e
        WHERE e.tenant_id = v_device.tenant_id AND e.id = v_reg.event_id
      ),
      'checkpoint', jsonb_build_object(
        'id', v_cp.id, 'name_pl', v_cp.name_pl, 'name_en', v_cp.name_en,
        'kind', v_cp.kind, 'direction_mode', v_cp.direction_mode,
        'access_mode', v_cp.access_mode
      ),
      'person', NULL
    );
  END IF;

  v_eval := public._event_checkin_evaluate(
    v_device.tenant_id, v_device.event_id, v_checkpoint_id, v_reg.person_id, v_direction
  );

  SELECT max(c.occurred_at) INTO v_prev_at
  FROM public.event_checkins c
  WHERE c.tenant_id = v_device.tenant_id
    AND c.event_id = v_device.event_id
    AND c.person_id = v_reg.person_id
    AND c.result = 'granted';

  RETURN jsonb_build_object(
    'outcome', v_eval->>'result',
    'admit', (
      (v_eval->>'result') = 'granted'
      OR (
        (v_eval->>'access_mode') = 'track'
        AND (v_eval->>'result') IN ('denied_not_registered', 'denied_registration_status')
      )
    ),
    'result', v_eval->>'result',
    'direction', v_direction,
    'device_locked', false,
    'previous_checkin_at', v_prev_at,
    'checkpoint', jsonb_build_object(
      'id', v_cp.id, 'name_pl', v_cp.name_pl, 'name_en', v_cp.name_en,
      'kind', v_cp.kind, 'direction_mode', v_cp.direction_mode,
      'access_mode', v_cp.access_mode,
      'capacity', v_cp.capacity,
      'occupancy', (v_eval->>'occupancy')::integer
    ),
    'person', public._event_onsite_person_card(
      v_device.tenant_id, v_device.event_id, v_reg.person_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_checkin_resolve(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_checkin_resolve(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_checkin_resolve(jsonb) IS
  'Rozpoznanie kodu QR: token wejsciowy -> JEDNA osoba plus decyzja, BEZ wiersza w dzienniku. Payload: {device_token, code, checkpoint_id?, direction?}. Kod nieznany podnosi licznik nieudanych rozpoznan urzadzenia. Zwraca minimum danych operatora - bez adresu poczty i telefonu.';

-- ----------------------------------------------------------------------------
-- U3) Zapis odprawy z urzadzenia
--
-- Wejsciem jest TOKEN, nigdy identyfikator osoby. Gdyby funkcja przyjmowala
-- `person_id`, przechwycone poswiadczenie pozwalaloby odprawiac dowolna osobe,
-- ktorej identyfikator napastnik skadkolwiek zna - a token jest jedynym
-- dowodem, ze uczestnik faktycznie stanal przy bramce.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_checkin_record(jsonb);
CREATE OR REPLACE FUNCTION public.event_checkin_record(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_code text := btrim(COALESCE(p_payload->>'code', ''));
  v_checkpoint_id uuid;
  v_cp public.event_checkpoints;
  v_direction text;
  v_reg record;
  v_locked boolean;
  v_source text;
  v_client_uid text := NULLIF(btrim(COALESCE(p_payload->>'client_scan_uid', '')), '');
  v_device_at timestamptz := NULLIF(p_payload->>'device_scanned_at', '')::timestamptz;
BEGIN
  v_device := public._event_scanner_device_auth(p_payload->>'device_token', 'checkin');

  IF v_code = '' THEN
    RAISE EXCEPTION 'invalid_payload: code is required';
  END IF;

  v_checkpoint_id := COALESCE(
    NULLIF(p_payload->>'checkpoint_id', '')::uuid,
    v_device.checkpoint_id
  );
  IF v_checkpoint_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: checkpoint_id is required for a device without a pinned checkpoint';
  END IF;
  IF v_device.checkpoint_id IS NOT NULL AND v_checkpoint_id <> v_device.checkpoint_id THEN
    RAISE EXCEPTION 'device_checkpoint_mismatch: this credential is pinned to another checkpoint';
  END IF;

  SELECT cp.* INTO v_cp
  FROM public.event_checkpoints cp
  WHERE cp.tenant_id = v_device.tenant_id
    AND cp.event_id = v_device.event_id
    AND cp.id = v_checkpoint_id;
  IF v_cp.id IS NULL THEN
    RAISE EXCEPTION 'checkpoint_not_found: checkpoint does not exist in this event';
  END IF;

  v_direction := lower(btrim(COALESCE(
    p_payload->>'direction',
    CASE v_cp.direction_mode WHEN 'out_only' THEN 'out' ELSE 'in' END
  )));

  -- Plaszczyzna urzadzenia moze zapisac WYLACZNIE dwa zrodla: skan kodu przez
  -- operatora i stanowisko samoobslugowe. `manual_entry` i `name_search` naleza
  -- do panelu i tu sa nieosiagalne - mapowanie jest wymuszone tutaj, a nie
  -- w interfejsie.
  v_source := CASE
    WHEN lower(COALESCE(p_payload->>'self_service', '')) IN ('true', 't', '1')
      THEN 'self_service'
    ELSE 'qr_code'
  END;

  SELECT r.id, r.event_id, r.person_id INTO v_reg
  FROM public.event_registrations r
  WHERE r.tenant_id = v_device.tenant_id
    AND r.qr_token_hash = encode(digest(v_code, 'sha256'), 'hex');

  IF v_reg.id IS NULL THEN
    v_locked := public._event_scanner_device_note_failure(v_device.id);
    RETURN jsonb_build_object(
      'outcome', 'unknown_code',
      'admit', false,
      'result', NULL,
      'device_locked', v_locked,
      'person', NULL
    );
  END IF;

  IF v_reg.event_id <> v_device.event_id THEN
    RETURN jsonb_build_object(
      'outcome', 'wrong_event',
      'admit', false,
      'result', NULL,
      'device_locked', false,
      'other_event', (
        SELECT jsonb_build_object('title_pl', e.title_pl, 'title_en', e.title_en)
        FROM public.events e
        WHERE e.tenant_id = v_device.tenant_id AND e.id = v_reg.event_id
      ),
      'person', NULL
    );
  END IF;

  UPDATE public.event_scanner_devices
  SET scan_count = scan_count + 1
  WHERE id = v_device.id;

  RETURN public._event_checkin_write(
    v_device.tenant_id,
    v_device.event_id,
    v_checkpoint_id,
    v_reg.person_id,
    v_direction,
    v_source,
    v_device.id,
    NULL,
    v_client_uid,
    v_device_at,
    NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_checkin_record(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_checkin_record(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_checkin_record(jsonb) IS
  'Zapis odprawy z urzadzenia. Payload: {device_token, code, checkpoint_id?, direction?, client_scan_uid?, device_scanned_at?, self_service?}. Wejsciem jest TOKEN, nigdy person_id - token jest jedynym dowodem, ze uczestnik stanal przy bramce. Idempotencja: client_scan_uid plus okno punktu.';

-- ----------------------------------------------------------------------------
-- U4) Skan leada na stoisku sponsora
--
-- WLASCICIEL LEADA POCHODZI Z POSWIADCZENIA, NIE Z PAYLOADU. Urzadzenie ma
-- w wierszu `sponsor_id` (wymagany przy zakresie `lead`, patrz CHECK), wiec
-- obsada stoiska nie moze zapisac leada na konto innego sponsora - nawet gdyby
-- probowala, bo w kontrakcie tej funkcji nie ma pola, ktorym mozna to podac.
--
-- ODPOWIEDZ ZALEZY OD ZGODY. Bez zgody na przekazanie danych partnerowi
-- funkcja POTWIERDZA zapis skanu (sponsor ma prawo policzyc ruch na stoisku),
-- ale NIE ODDAJE tozsamosci uczestnika. Z zgoda oddaje imie, nazwisko, firme,
-- stanowisko i dane kontaktowe. To nie jest ozdoba interfejsu: rozroznienie
-- siedzi w tej funkcji, a tabela leadow nie ma zadnej kolumny, z ktorej mozna
-- by te dane odczytac obok niej.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_lead_scan_record(jsonb);
CREATE OR REPLACE FUNCTION public.event_lead_scan_record(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_code text := btrim(COALESCE(p_payload->>'code', ''));
  v_note text := NULLIF(btrim(COALESCE(p_payload->>'note', '')), '');
  v_rating smallint := NULLIF(p_payload->>'interest_rating', '')::smallint;
  v_reg record;
  v_person public.event_people;
  v_consent_at timestamptz;
  v_lead_id uuid;
  v_count integer;
  v_locked boolean;
BEGIN
  v_device := public._event_scanner_device_auth(p_payload->>'device_token', 'lead');

  IF v_code = '' THEN
    RAISE EXCEPTION 'invalid_payload: code is required';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'invalid_payload: note is longer than 2000 characters';
  END IF;
  IF v_rating IS NOT NULL AND v_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'invalid_payload: interest_rating must be between 1 and 5';
  END IF;

  SELECT r.id, r.event_id, r.person_id INTO v_reg
  FROM public.event_registrations r
  WHERE r.tenant_id = v_device.tenant_id
    AND r.qr_token_hash = encode(digest(v_code, 'sha256'), 'hex');

  IF v_reg.id IS NULL THEN
    v_locked := public._event_scanner_device_note_failure(v_device.id);
    RETURN jsonb_build_object(
      'outcome', 'unknown_code', 'device_locked', v_locked, 'person', NULL
    );
  END IF;

  IF v_reg.event_id <> v_device.event_id THEN
    RETURN jsonb_build_object(
      'outcome', 'wrong_event', 'device_locked', false, 'person', NULL
    );
  END IF;

  SELECT p.* INTO v_person
  FROM public.event_people p
  WHERE p.tenant_id = v_device.tenant_id AND p.id = v_reg.person_id;

  -- Stan ZYWY zgody. Wycofanie uniewaznia nadanie, bez wzgledu na kolejnosc dat
  -- - dokladnie tak, jak opisuje COMMENT przy event_people.consent_withdrawn_at.
  v_consent_at := CASE
    WHEN v_person.consent_partner_sharing_at IS NOT NULL
      AND v_person.consent_withdrawn_at IS NULL
    THEN v_person.consent_partner_sharing_at
    ELSE NULL
  END;

  INSERT INTO public.event_lead_scans (
    tenant_id, event_id, sponsor_id, person_id, registration_id,
    checkpoint_id, device_id, first_scanned_at, last_scanned_at, scan_count,
    note, interest_rating, consent_snapshot_at
  ) VALUES (
    v_device.tenant_id, v_device.event_id, v_device.sponsor_id, v_reg.person_id, v_reg.id,
    v_device.checkpoint_id, v_device.id, now(), now(), 1,
    v_note, v_rating, v_consent_at
  )
  ON CONFLICT (tenant_id, sponsor_id, person_id) DO UPDATE
  SET last_scanned_at = now(),
      scan_count = event_lead_scans.scan_count + 1,
      -- Notatka i ocena nadpisuja sie TYLKO gdy przyszly w tym skanie. Pusta
      -- notatka w powtornym skanie nie ma prawa wytrzec tego, co obsluga
      -- wpisala przy pierwszej rozmowie.
      note = COALESCE(EXCLUDED.note, event_lead_scans.note),
      interest_rating = COALESCE(EXCLUDED.interest_rating, event_lead_scans.interest_rating),
      consent_snapshot_at = EXCLUDED.consent_snapshot_at,
      registration_id = COALESCE(EXCLUDED.registration_id, event_lead_scans.registration_id)
  RETURNING id, scan_count INTO v_lead_id, v_count;

  RETURN jsonb_build_object(
    'outcome', 'saved',
    'lead_id', v_lead_id,
    'scan_count', v_count,
    'consent', (v_consent_at IS NOT NULL),
    'person', CASE
      WHEN v_consent_at IS NULL THEN NULL
      ELSE jsonb_build_object(
        'first_name', v_person.first_name,
        'last_name', v_person.last_name,
        'company', COALESCE(
          NULLIF(btrim(v_person.company_text), ''),
          (SELECT co.name FROM public.crm_companies co
            WHERE co.tenant_id = v_person.tenant_id AND co.id = v_person.company_id)
        ),
        'job_title', v_person.job_title,
        'email', v_person.email,
        'phone', v_person.phone
      )
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_lead_scan_record(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_lead_scan_record(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_lead_scan_record(jsonb) IS
  'Skan leada na stoisku. Payload: {device_token, code, note?, interest_rating?}. Wlasciciel leada pochodzi z POSWIADCZENIA (event_scanner_devices.sponsor_id) - nie ma pola, ktorym mozna wskazac innego sponsora. Bez zgody uczestnika potwierdza zapis, ale NIE oddaje tozsamosci.';

-- ----------------------------------------------------------------------------
-- U5) Lista wlasnych leadow sponsora
--
-- Ograniczenie "tylko MOJE leady" nie jest filtrem interfejsu ani warunkiem
-- payloadu - jest tozsamoscia poswiadczenia. Funkcja nie przyjmuje
-- `sponsor_id`, wiec nie ma czego podmienic.
--
-- WARUNEK ZGODY SIEDZI W KLAUZULI WHERE (a scislej w CASE nad kolumnami
-- tozsamosci), a nie w warstwie prezentacji. Lead bez zgody NADAL JEST
-- WIDOCZNY jako wiersz - sponsor ma prawo policzyc ruch na stoisku - ale bez
-- imienia, nazwiska, firmy i kontaktu. Ukrycie calego wiersza byloby gorsze:
-- sponsor zaczalby liczyc leady z notesu i przepisywac je z pamieci, czyli
-- poza jakakolwiek kontrola zgody.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_lead_scans_list(jsonb);
CREATE OR REPLACE FUNCTION public.event_lead_scans_list(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_limit integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'limit', '')::integer, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(NULLIF(p_payload->>'offset', '')::integer, 0), 0);
  v_rows jsonb;
  v_total integer;
  v_with_consent integer;
BEGIN
  -- STABLE, wiec bez `_event_scanner_device_auth` (ta funkcja stempluje
  -- last_seen_at, czyli pisze). Bramka jest tu powtorzona swiadomie i w
  -- wersji tylko do czytania - lista leadow nie jest aktywnoscia skanowania.
  SELECT d.* INTO v_device
  FROM public.event_scanner_devices d
  WHERE d.token_hash = encode(digest(btrim(COALESCE(p_payload->>'device_token', '')), 'sha256'), 'hex');

  IF v_device.id IS NULL
     OR v_device.revoked_at IS NOT NULL
     OR NOT v_device.is_active
     OR v_device.expires_at <= now()
     OR (v_device.locked_until IS NOT NULL AND v_device.locked_until > now())
     OR NOT ('lead' = ANY (v_device.scopes)) THEN
    RAISE EXCEPTION 'invalid_device_token: scanner credential is not valid for lead retrieval';
  END IF;

  SELECT count(*)::integer,
         count(*) FILTER (
           WHERE p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL
         )::integer
    INTO v_total, v_with_consent
  FROM public.event_lead_scans l
  JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
  WHERE l.tenant_id = v_device.tenant_id
    AND l.sponsor_id = v_device.sponsor_id;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'lead_id', l.id,
      'first_scanned_at', l.first_scanned_at,
      'last_scanned_at', l.last_scanned_at,
      'scan_count', l.scan_count,
      'note', l.note,
      'interest_rating', l.interest_rating,
      'consent', (p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL),
      'first_name', CASE WHEN p.consent_partner_sharing_at IS NOT NULL
                          AND p.consent_withdrawn_at IS NULL THEN p.first_name END,
      'last_name', CASE WHEN p.consent_partner_sharing_at IS NOT NULL
                         AND p.consent_withdrawn_at IS NULL THEN p.last_name END,
      'company', CASE WHEN p.consent_partner_sharing_at IS NOT NULL
                       AND p.consent_withdrawn_at IS NULL
                  THEN COALESCE(NULLIF(btrim(p.company_text), ''), co.name) END,
      'job_title', CASE WHEN p.consent_partner_sharing_at IS NOT NULL
                         AND p.consent_withdrawn_at IS NULL THEN p.job_title END,
      'email', CASE WHEN p.consent_partner_sharing_at IS NOT NULL
                     AND p.consent_withdrawn_at IS NULL THEN p.email END,
      'phone', CASE WHEN p.consent_partner_sharing_at IS NOT NULL
                     AND p.consent_withdrawn_at IS NULL THEN p.phone END
    ) AS x
    FROM public.event_lead_scans l
    JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
    LEFT JOIN public.crm_companies co
      ON co.tenant_id = p.tenant_id AND co.id = p.company_id
    WHERE l.tenant_id = v_device.tenant_id
      AND l.sponsor_id = v_device.sponsor_id
    ORDER BY l.last_scanned_at DESC
    LIMIT v_limit OFFSET v_offset
  ) src;

  RETURN jsonb_build_object(
    'total_count', v_total,
    'with_consent_count', v_with_consent,
    'rows', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_lead_scans_list(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_lead_scans_list(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_lead_scans_list(jsonb) IS
  'Leady WLASNEGO sponsora urzadzenia. Payload: {device_token, limit?, offset?}. Nie przyjmuje sponsor_id - wlasciciel jest tozsamoscia poswiadczenia. Tozsamosc i kontakt uczestnika sa oddawane WYLACZNIE przy zywej zgodzie (nadanie bez wycofania); wiersz bez zgody zostaje policzony, ale bez danych.';

-- ============================================================================
-- PLASZCZYZNA PANELU
--
-- Bramka `assert_editor_tenant()` wszedzie, gdzie wystarcza rola redakcyjna
-- (konfiguracja punktow, listy, statystyki, szablony, wydruki, odprawa reczna),
-- oraz `assert_admin_tenant()` przy WYDAWANIU I UNIEWAZNIANIU POSWIADCZEN -
-- token urzadzenia jest kluczem do bramki, wiec jego wydanie jest decyzja
-- administratora, nie redaktora.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- P1) Punkty odprawy: lista z licznikami
--
-- Licznik jest ROZBITY na zgody, odmowy i obecnosc, bo redaktor patrzacy na
-- liste punktow zadaje trzy rozne pytania: czy ten punkt w ogole pracuje, czy
-- odbija sie od niego duzo ludzi i ile osob jest teraz w srodku. Jedna liczba
-- "skanow" nie odpowiada na zadne z nich.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_checkpoints_list(uuid);
CREATE OR REPLACE FUNCTION public.admin_event_checkpoints_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  name_pl text,
  name_en text,
  kind text,
  session_id uuid,
  session_title_pl text,
  session_title_en text,
  room_id uuid,
  room_name text,
  sponsor_id uuid,
  sponsor_name text,
  direction_mode text,
  access_mode text,
  capacity integer,
  dedupe_window_seconds integer,
  is_active boolean,
  sort_order integer,
  granted_count integer,
  denied_count integer,
  repeat_count integer,
  occupancy integer,
  device_count integer,
  last_checkin_at timestamptz,
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
    cp.id, cp.event_id, cp.name_pl, cp.name_en, cp.kind,
    cp.session_id, s.title_pl, s.title_en,
    cp.room_id, r.name,
    cp.sponsor_id, sp.snapshot_name,
    cp.direction_mode, cp.access_mode, cp.capacity, cp.dedupe_window_seconds,
    cp.is_active, cp.sort_order,
    COALESCE(agg.granted, 0)::integer,
    COALESCE(agg.denied, 0)::integer,
    COALESCE(agg.repeats, 0)::integer,
    public._event_checkpoint_occupancy(v_tenant, cp.id),
    COALESCE(dev.cnt, 0)::integer,
    agg.last_at,
    cp.created_at, cp.updated_at
  FROM public.event_checkpoints cp
  LEFT JOIN public.event_sessions s
    ON s.tenant_id = cp.tenant_id AND s.id = cp.session_id
  LEFT JOIN public.event_rooms r
    ON r.tenant_id = cp.tenant_id AND r.id = cp.room_id
  LEFT JOIN public.event_sponsors sp
    ON sp.tenant_id = cp.tenant_id AND sp.id = cp.sponsor_id
  -- LATERAL per wiersz, nie GROUP BY po calym dzienniku: wydarzenie ma
  -- kilkanascie punktow i dziesiatki tysiecy skanow, wiec agregat globalny
  -- czytalby caly dziennik po to, zeby oddac kilkanascie liczb.
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE c.result = 'granted')::integer AS granted,
      count(*) FILTER (WHERE c.result <> 'granted')::integer AS denied,
      COALESCE(sum(c.repeat_count), 0)::integer AS repeats,
      max(c.occurred_at) AS last_at
    FROM public.event_checkins c
    WHERE c.tenant_id = cp.tenant_id AND c.checkpoint_id = cp.id
  ) agg ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_scanner_devices d
    WHERE d.tenant_id = cp.tenant_id
      AND d.checkpoint_id = cp.id
      AND d.revoked_at IS NULL
  ) dev ON true
  WHERE cp.tenant_id = v_tenant
    AND cp.event_id = p_event_id
  ORDER BY cp.sort_order, cp.name_pl;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkpoints_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkpoints_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkpoints_list(uuid) IS
  'Punkty odprawy wydarzenia z licznikami zgod, odmow, powtorzen i aktualna obecnoscia. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- P2) Punkty odprawy: dodanie i edycja
--
-- Payload jsonb, nie czternascie argumentow pozycyjnych - uzasadnienie
-- w konwencji modulu (Postgres przeciaza po sygnaturze, wiec kazde nowe pole
-- w wariancie pozycyjnym tworzy DRUGA funkcje w bazie).
--
-- SESJA I SPONSOR SA WERYFIKOWANI W TYM SAMYM WYDARZENIU. Klucz obcy zlozony
-- juz tego pilnuje, ale komunikat z klucza obcego jest nieczytelny dla
-- redaktora, a rozroznienie "nie ma takiej sesji" od "sesja jest z innego
-- wydarzenia" ma znaczenie przy klonowaniu konfiguracji miedzy edycjami.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_checkpoint_save(jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_checkpoint_save(p_payload jsonb)
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
  v_name_pl text := btrim(COALESCE(p_payload->>'name_pl', ''));
  v_name_en text := btrim(COALESCE(p_payload->>'name_en', ''));
  v_kind text := lower(btrim(COALESCE(p_payload->>'kind', 'event_entry')));
  v_session_id uuid := NULLIF(p_payload->>'session_id', '')::uuid;
  v_room_id uuid := NULLIF(p_payload->>'room_id', '')::uuid;
  v_sponsor_id uuid := NULLIF(p_payload->>'sponsor_id', '')::uuid;
  v_existing public.event_checkpoints;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT cp.* INTO v_existing
    FROM public.event_checkpoints cp
    WHERE cp.id = v_id AND cp.tenant_id = v_tenant;

    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION 'not_found: checkpoint does not exist in this organisation';
    END IF;
    v_event_id := v_existing.event_id;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  IF v_name_pl = '' OR v_name_en = '' THEN
    RAISE EXCEPTION 'invalid_names: the name is required in both languages';
  END IF;

  IF v_kind NOT IN (
    'event_entry', 'session', 'room', 'zone', 'catering', 'cloakroom', 'company_booth'
  ) THEN
    RAISE EXCEPTION 'invalid_kind: unknown checkpoint kind %', v_kind;
  END IF;

  -- Wiazania spoza rodzaju punktu sa CZYSZCZONE, nie odrzucane: redaktor moze
  -- odeslac caly wiersz po przelaczeniu rodzaju, a formularz nie musi wiedziec,
  -- ktore pola przestaly miec znaczenie.
  IF v_kind <> 'session' THEN v_session_id := NULL; END IF;
  IF v_kind <> 'company_booth' THEN v_sponsor_id := NULL; END IF;

  IF v_kind = 'session' AND v_session_id IS NULL THEN
    RAISE EXCEPTION 'session_required: a session checkpoint must point at a session';
  END IF;
  IF v_kind = 'company_booth' AND v_sponsor_id IS NULL THEN
    RAISE EXCEPTION 'sponsor_required: a booth checkpoint must point at a sponsor';
  END IF;

  IF v_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_sessions s
    WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id AND s.id = v_session_id
  ) THEN
    RAISE EXCEPTION 'session_not_in_event: the session belongs to another event';
  END IF;

  IF v_room_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_rooms r
    WHERE r.tenant_id = v_tenant AND r.event_id = v_event_id AND r.id = v_room_id
  ) THEN
    RAISE EXCEPTION 'room_not_in_event: the room belongs to another event';
  END IF;

  IF v_sponsor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_sponsors sp
    WHERE sp.tenant_id = v_tenant AND sp.event_id = v_event_id AND sp.id = v_sponsor_id
  ) THEN
    RAISE EXCEPTION 'sponsor_not_in_event: the sponsor belongs to another event';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.event_checkpoints (
      tenant_id, event_id, name_pl, name_en, kind, session_id, room_id, sponsor_id,
      direction_mode, access_mode, capacity, dedupe_window_seconds,
      is_active, sort_order, created_by
    ) VALUES (
      v_tenant, v_event_id, v_name_pl, v_name_en, v_kind, v_session_id, v_room_id, v_sponsor_id,
      COALESCE(NULLIF(p_payload->>'direction_mode', ''), 'in_only'),
      COALESCE(NULLIF(p_payload->>'access_mode', ''), 'control'),
      NULLIF(p_payload->>'capacity', '')::integer,
      COALESCE(NULLIF(p_payload->>'dedupe_window_seconds', '')::integer, 60),
      COALESCE(NULLIF(p_payload->>'is_active', '')::boolean, true),
      COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, 100),
      auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_checkpoints SET
      name_pl = v_name_pl,
      name_en = v_name_en,
      kind = v_kind,
      session_id = v_session_id,
      room_id = v_room_id,
      sponsor_id = v_sponsor_id,
      direction_mode = COALESCE(NULLIF(p_payload->>'direction_mode', ''), direction_mode),
      access_mode = COALESCE(NULLIF(p_payload->>'access_mode', ''), access_mode),
      capacity = CASE
        WHEN p_payload ? 'capacity' THEN NULLIF(p_payload->>'capacity', '')::integer
        ELSE capacity
      END,
      dedupe_window_seconds = COALESCE(
        NULLIF(p_payload->>'dedupe_window_seconds', '')::integer, dedupe_window_seconds
      ),
      is_active = COALESCE(NULLIF(p_payload->>'is_active', '')::boolean, is_active),
      sort_order = COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, sort_order)
    WHERE id = v_id AND tenant_id = v_tenant;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkpoint_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkpoint_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkpoint_save(jsonb) IS
  'Dodanie albo edycja punktu odprawy. Payload jsonb (id, event_id, name_pl, name_en, kind, session_id, room_id, sponsor_id, direction_mode, access_mode, capacity, dedupe_window_seconds, is_active, sort_order). Wiazania spoza rodzaju sa czyszczone, nie odrzucane. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- P3) Punkty odprawy: usuniecie
--
-- Punkt Z DZIENNIKIEM nie kasuje sie NIGDY - usuniecie zabraloby ze soba
-- kilkaset wierszy frekwencji (klucz obcy ma kaskade, bo punkt bez wydarzenia
-- nie ma sensu, ale kaskada jest tu ostatnia linia obrony, nie sciezka
-- redakcyjna). Zamiast usuwac, punkt sie WYLACZA - i dlatego wylaczenie jest
-- osobna operacja, a nie lagodniejsza wersja usuniecia.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_checkpoint_delete(uuid);
CREATE OR REPLACE FUNCTION public.admin_event_checkpoint_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_used integer;
  v_devices integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_checkpoints cp
    WHERE cp.id = _id AND cp.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: checkpoint does not exist in this organisation';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.event_checkins c
  WHERE c.tenant_id = v_tenant AND c.checkpoint_id = _id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'checkpoint_in_use: % check-in(s) recorded at this checkpoint - deactivate it instead', v_used;
  END IF;

  SELECT count(*)::integer INTO v_devices
  FROM public.event_scanner_devices d
  WHERE d.tenant_id = v_tenant AND d.checkpoint_id = _id AND d.revoked_at IS NULL;

  IF v_devices > 0 THEN
    RAISE EXCEPTION 'checkpoint_has_devices: % scanner credential(s) still point at this checkpoint', v_devices;
  END IF;

  DELETE FROM public.event_checkpoints WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkpoint_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkpoint_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkpoint_delete(uuid) IS
  'Usuniecie punktu odprawy. Odrzucane, gdy punkt ma choc jedna odprawe w dzienniku albo zyjace poswiadczenie urzadzenia - w obu razach wlasciwa operacja jest wylaczenie. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- P4) Urzadzenia: lista z licznikami i stanem
--
-- HASZA NIE ODDAJEMY. Zamiast niego jedzie `token_prefix` - tyle, ile trzeba,
-- zeby dopasowac wiersz do wydrukowanej kartki, i ani znaku wiecej. To ta sama
-- doktryna, ktora w `admin_event_registrations_list` zamienia `qr_token_hash`
-- na flage `has_qr`.
--
-- `state` jest LICZONY, nie przechowywany: "uniewaznione" / "zablokowane" /
-- "wygasle" / "wstrzymane" / "czynne" wynikaja z czterech kolumn i daty. Piata
-- kolumna ze stanem rozjechalaby sie z nimi w pierwszej minucie po wygasnieciu,
-- bo nikt jej wtedy nie aktualizuje (ta sama decyzja co przy statusie
-- sprzedazy biletu w 20260823150000).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_scanner_devices_list(uuid);
CREATE OR REPLACE FUNCTION public.admin_event_scanner_devices_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  label text,
  token_prefix text,
  scopes text[],
  checkpoint_id uuid,
  checkpoint_name_pl text,
  checkpoint_name_en text,
  sponsor_id uuid,
  sponsor_name text,
  state text,
  is_active boolean,
  expires_at timestamptz,
  revoked_at timestamptz,
  locked_until timestamptz,
  last_seen_at timestamptz,
  scan_count integer,
  failed_scan_count integer,
  last_failed_scan_at timestamptz,
  fail_window_count integer,
  checkins_count integer,
  lead_scans_count integer,
  created_at timestamptz
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
    d.id, d.event_id, d.label, d.token_prefix, d.scopes,
    d.checkpoint_id, cp.name_pl, cp.name_en,
    d.sponsor_id, sp.snapshot_name,
    CASE
      WHEN d.revoked_at IS NOT NULL THEN 'revoked'
      WHEN d.locked_until IS NOT NULL AND d.locked_until > now() THEN 'locked'
      WHEN d.expires_at <= now() THEN 'expired'
      WHEN NOT d.is_active THEN 'paused'
      ELSE 'active'
    END,
    d.is_active, d.expires_at, d.revoked_at, d.locked_until, d.last_seen_at,
    d.scan_count, d.failed_scan_count, d.last_failed_scan_at, d.fail_window_count,
    COALESCE(ci.cnt, 0)::integer,
    COALESCE(ls.cnt, 0)::integer,
    d.created_at
  FROM public.event_scanner_devices d
  LEFT JOIN public.event_checkpoints cp
    ON cp.tenant_id = d.tenant_id AND cp.id = d.checkpoint_id
  LEFT JOIN public.event_sponsors sp
    ON sp.tenant_id = d.tenant_id AND sp.id = d.sponsor_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_checkins c
    WHERE c.tenant_id = d.tenant_id AND c.device_id = d.id
  ) ci ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_lead_scans l
    WHERE l.tenant_id = d.tenant_id AND l.device_id = d.id
  ) ls ON true
  WHERE d.tenant_id = v_tenant
    AND d.event_id = p_event_id
  ORDER BY d.revoked_at NULLS FIRST, d.label;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_devices_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_devices_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_devices_list(uuid) IS
  'Poswiadczenia urzadzen wydarzenia: stan liczony z czterech kolumn i daty, liczniki skanow i NIEUDANYCH rozpoznan, prefiks tokenu. HASZA NIE ODDAJE. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- P5) Urzadzenia: wydanie poswiadczenia (TOKEN WRACA RAZ)
--
-- BRAMKA ADMINISTRATORA, nie redaktora. Token urzadzenia jest kluczem do
-- bramki wydarzenia; kto go wydaje, ten rozdaje wstep. Redaktor moze
-- konfigurowac punkty i czytac dziennik, ale nie moze wyprodukowac klucza.
--
-- WARTOSC JAWNA WRACA W ODPOWIEDZI DOKLADNIE RAZ i nie jest nigdzie
-- zapisywana. Nie ma funkcji "pokaz token jeszcze raz" i to nie jest
-- brakujaca funkcja - to jest cala wartosc tego rozwiazania. Zgubiony token
-- uniewaznia sie i wydaje nowy, co zajmuje jedno klikniecie i zostawia slad.
--
-- TERMIN WAZNOSCI jest liczony domyslnie do konca wydarzenia plus doba (albo
-- 48 godzin od teraz, gdy wydarzenie nie ma daty konca) - bo poswiadczenie
-- wydane "na zawsze" jest dokladnie tym, czego kolumna `expires_at` ma nie
-- dopuszczac. Redaktor moze podac wlasny termin, ale nie moze go pominac.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_scanner_device_issue(jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_scanner_device_issue(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_label text := btrim(COALESCE(p_payload->>'label', ''));
  v_checkpoint_id uuid := NULLIF(p_payload->>'checkpoint_id', '')::uuid;
  v_sponsor_id uuid := NULLIF(p_payload->>'sponsor_id', '')::uuid;
  v_scopes text[];
  v_expires timestamptz := NULLIF(p_payload->>'expires_at', '')::timestamptz;
  v_event public.events;
  v_token text;
  v_id uuid;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  SELECT e.* INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.id = v_event_id;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  IF char_length(v_label) < 2 THEN
    RAISE EXCEPTION 'invalid_label: the label must have at least 2 characters';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT lower(btrim(s))), ARRAY['checkin']::text[])
  INTO v_scopes
  FROM jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(p_payload->'scopes') = 'array' THEN p_payload->'scopes'
      ELSE '["checkin"]'::jsonb
    END
  ) AS t(s)
  WHERE lower(btrim(s)) IN ('checkin', 'lead', 'badge_print');

  IF array_length(v_scopes, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_scopes: at least one known scope is required';
  END IF;

  IF v_checkpoint_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_checkpoints cp
    WHERE cp.tenant_id = v_tenant AND cp.event_id = v_event_id AND cp.id = v_checkpoint_id
  ) THEN
    RAISE EXCEPTION 'checkpoint_not_in_event: the checkpoint belongs to another event';
  END IF;

  IF 'lead' = ANY (v_scopes) THEN
    IF v_sponsor_id IS NULL THEN
      RAISE EXCEPTION 'sponsor_required: a lead-retrieval credential must name its sponsor';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.event_sponsors sp
      WHERE sp.tenant_id = v_tenant AND sp.event_id = v_event_id AND sp.id = v_sponsor_id
    ) THEN
      RAISE EXCEPTION 'sponsor_not_in_event: the sponsor belongs to another event';
    END IF;
  ELSE
    v_sponsor_id := NULL;
  END IF;

  -- Domyslny termin: doba po zakonczeniu wydarzenia (na sprzatanie i wyjscia
  -- z szatni), a przy wydarzeniu bez daty konca - 48 godzin od teraz.
  IF v_expires IS NULL THEN
    v_expires := COALESCE(v_event.ends_at, v_event.starts_at, now()) + interval '24 hours';
    IF v_expires <= now() THEN
      v_expires := now() + interval '48 hours';
    END IF;
  END IF;

  IF v_expires <= now() THEN
    RAISE EXCEPTION 'invalid_expiry: the credential must expire in the future';
  END IF;

  v_token := public._event_new_scanner_token();

  INSERT INTO public.event_scanner_devices (
    tenant_id, event_id, checkpoint_id, sponsor_id, label,
    token_hash, token_prefix, scopes, is_active, expires_at, created_by
  ) VALUES (
    v_tenant, v_event_id, v_checkpoint_id, v_sponsor_id, v_label,
    encode(digest(v_token, 'sha256'), 'hex'), left(v_token, 8), v_scopes,
    true, v_expires, auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_scanner_device',
    v_id::text,
    'event_scanner_device.issued.v1',
    jsonb_build_object(
      'event_id', v_event_id,
      'device_id', v_id,
      'label', v_label,
      'token_prefix', left(v_token, 8),
      'scopes', to_jsonb(v_scopes),
      'expires_at', v_expires
    ),
    auth.uid()
  );

  -- Token jawny wraca TUTAJ i tylko tutaj.
  RETURN jsonb_build_object(
    'device_id', v_id,
    'label', v_label,
    'token', v_token,
    'token_prefix', left(v_token, 8),
    'scopes', to_jsonb(v_scopes),
    'expires_at', v_expires,
    'checkpoint_id', v_checkpoint_id,
    'sponsor_id', v_sponsor_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_device_issue(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_device_issue(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_device_issue(jsonb) IS
  'Wydanie poswiadczenia urzadzenia skanujacego. Payload: {event_id, label, scopes[], checkpoint_id?, sponsor_id?, expires_at?}. TOKEN JAWNY WRACA DOKLADNIE RAZ - nie ma funkcji pokazujacej go ponownie i to jest cala wartosc rozwiazania. Bramka: assert_admin_tenant().';

-- ----------------------------------------------------------------------------
-- P6) Urzadzenia: uniewaznienie
--
-- NIEODWRACALNE i natychmiastowe. Hasz zostaje w wierszu (bez niego dziennik
-- stracilby wiazanie z urzadzeniem, ktore go zapisalo), ale `revoked_at`
-- zamyka bramke w `_event_scanner_device_auth` przy PIERWSZYM nastepnym
-- zapytaniu - nie po wygasnieciu jakiegos bufora, bo bufora tu nie ma.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_scanner_device_revoke(jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_scanner_device_revoke(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'device_id', '')::uuid;
  v_row public.event_scanner_devices;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: device_id is required';
  END IF;

  UPDATE public.event_scanner_devices
  SET revoked_at = COALESCE(revoked_at, now()),
      revoked_by = COALESCE(revoked_by, auth.uid()),
      is_active = false
  WHERE id = v_id AND tenant_id = v_tenant
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: scanner credential does not exist in this organisation';
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_scanner_device',
    v_row.id::text,
    'event_scanner_device.revoked.v1',
    jsonb_build_object(
      'event_id', v_row.event_id,
      'device_id', v_row.id,
      'label', v_row.label,
      'token_prefix', v_row.token_prefix
    ),
    auth.uid()
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_device_revoke(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_device_revoke(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_device_revoke(jsonb) IS
  'Uniewaznienie poswiadczenia urzadzenia - nieodwracalne i natychmiastowe (brak jakiegokolwiek bufora po stronie bazy). Payload: {device_id}. Bramka: assert_admin_tenant().';

-- ----------------------------------------------------------------------------
-- P7) Urzadzenia: pauza, wznowienie i ZDJECIE BLOKADY
--
-- Wznowienie CZYSCI blokade automatyczna i okno nieudanych prob. Uzasadnienie:
-- blokada jest podejrzeniem, a nie wyrokiem - administrator, ktory sprawdzil,
-- ze operator po prostu skanowal wydruki z zeszlego wydarzenia, musi miec
-- jedna czynnosc do wykonania, nie dwie. Licznik MONOTONICZNY
-- (`failed_scan_count`) NIE jest czyszczony: to zapis historii, nie stan.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_scanner_device_set_active(jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_scanner_device_set_active(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'device_id', '')::uuid;
  v_active boolean := COALESCE(NULLIF(p_payload->>'is_active', '')::boolean, true);
  v_row public.event_scanner_devices;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: device_id is required';
  END IF;

  SELECT d.* INTO v_row
  FROM public.event_scanner_devices d
  WHERE d.id = v_id AND d.tenant_id = v_tenant;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: scanner credential does not exist in this organisation';
  END IF;

  -- Uniewaznienie jest nieodwracalne, wiec wznowienie go nie dotyczy. Bez tego
  -- warunku "wlacz" byloby cichym cofnieciem uniewaznienia.
  IF v_row.revoked_at IS NOT NULL AND v_active THEN
    RAISE EXCEPTION 'device_revoked: a revoked credential cannot be reactivated - issue a new one';
  END IF;

  UPDATE public.event_scanner_devices
  SET is_active = v_active,
      locked_until = CASE WHEN v_active THEN NULL ELSE locked_until END,
      fail_window_count = CASE WHEN v_active THEN 0 ELSE fail_window_count END,
      fail_window_started_at = CASE WHEN v_active THEN NULL ELSE fail_window_started_at END
  WHERE id = v_id AND tenant_id = v_tenant;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_device_set_active(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_device_set_active(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_device_set_active(jsonb) IS
  'Pauza albo wznowienie poswiadczenia. Wznowienie ZDEJMUJE blokade automatyczna i czysci okno nieudanych prob (licznik monotoniczny zostaje - to historia, nie stan). Uniewaznionego poswiadczenia nie da sie wznowic. Payload: {device_id, is_active}. Bramka: assert_admin_tenant().';

-- ----------------------------------------------------------------------------
-- P8) Dziennik odpraw: lista panelu
--
-- `total_count` jedzie w KAZDYM wierszu jako funkcja okna - bez tego paginacja
-- wymaga drugiego zapytania z tym samym filtrem, a dwa zapytania rozjezdzaja
-- sie przy kazdym skanie miedzy nimi (lista mowi "1-25 z 400", gdy w dzienniku
-- jest juz 407 wierszy). Uzasadnienie przejete z `admin_events_list`.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_checkins_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer
);
CREATE OR REPLACE FUNCTION public.admin_event_checkins_list(
  p_event_id uuid,
  p_checkpoint_id uuid DEFAULT NULL,
  p_direction text DEFAULT NULL,
  p_result text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  occurred_at timestamptz,
  scanned_at timestamptz,
  device_scanned_at timestamptz,
  direction text,
  result text,
  source text,
  repeat_count integer,
  note text,
  checkpoint_id uuid,
  checkpoint_name_pl text,
  checkpoint_name_en text,
  checkpoint_kind text,
  person_id uuid,
  first_name text,
  last_name text,
  company text,
  job_title text,
  registration_id uuid,
  registration_status text,
  ticket_name_pl text,
  ticket_name_en text,
  group_name_pl text,
  group_name_en text,
  device_id uuid,
  device_label text,
  operator_user_id uuid,
  operator_name text,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  RETURN QUERY
  SELECT
    c.id, c.occurred_at, c.scanned_at, c.device_scanned_at,
    c.direction, c.result, c.source, c.repeat_count, c.note,
    c.checkpoint_id, cp.name_pl, cp.name_en, cp.kind,
    c.person_id, p.first_name, p.last_name,
    COALESCE(NULLIF(btrim(p.company_text), ''), co.name),
    p.job_title,
    c.registration_id, r.status, tt.name_pl, tt.name_en, g.name_pl, g.name_en,
    c.device_id, d.label,
    c.operator_user_id,
    COALESCE(
      NULLIF(btrim(pr.display_name), ''),
      NULLIF(btrim(COALESCE(pr.first_name, '') || ' ' || COALESCE(pr.last_name, '')), '')
    ),
    count(*) OVER ()::integer
  FROM public.event_checkins c
  JOIN public.event_checkpoints cp
    ON cp.tenant_id = c.tenant_id AND cp.id = c.checkpoint_id
  JOIN public.event_people p
    ON p.tenant_id = c.tenant_id AND p.id = c.person_id
  LEFT JOIN public.crm_companies co
    ON co.tenant_id = p.tenant_id AND co.id = p.company_id
  LEFT JOIN public.event_registrations r
    ON r.tenant_id = c.tenant_id AND r.id = c.registration_id
  LEFT JOIN public.event_ticket_types tt
    ON tt.tenant_id = r.tenant_id AND tt.id = r.ticket_type_id
  LEFT JOIN public.event_groups g
    ON g.tenant_id = r.tenant_id AND g.id = r.group_id
  LEFT JOIN public.event_scanner_devices d
    ON d.tenant_id = c.tenant_id AND d.id = c.device_id
  LEFT JOIN public.profiles pr
    ON pr.id = c.operator_user_id AND pr.tenant_id = c.tenant_id
  WHERE c.tenant_id = v_tenant
    AND c.event_id = p_event_id
    AND (p_checkpoint_id IS NULL OR c.checkpoint_id = p_checkpoint_id)
    AND (p_direction IS NULL OR c.direction = p_direction)
    AND (p_result IS NULL OR c.result = p_result)
    AND (p_source IS NULL OR c.source = p_source)
    AND (p_from IS NULL OR c.occurred_at >= p_from)
    AND (p_to IS NULL OR c.occurred_at <= p_to)
    AND (
      v_q IS NULL
      OR p.full_name_norm LIKE '%' || lower(v_q) || '%'
      OR lower(COALESCE(p.company_text, '')) LIKE '%' || lower(v_q) || '%'
    )
  ORDER BY c.occurred_at DESC, c.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkins_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkins_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer
) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkins_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer
) IS
  'Dziennik odpraw dla panelu: filtry (punkt, kierunek, wynik, zrodlo, fraza, zakres czasu), paginacja i licznik calosci w funkcji okna. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- P9) Poszukiwanie uczestnika po nazwisku - WYLACZNIE W PANELU
--
-- Ta funkcja jest jedynym miejscem w calym module, ktore oddaje LISTE osob na
-- podstawie fragmentu tekstu. Dlatego siedzi za bramka `assert_editor_tenant()`
-- i NIE MA odpowiednika na plaszczyznie urzadzenia: gdyby skaner mial taka
-- funkcje, przechwycone poswiadczenie pozwalaloby wyliczyc cala liste
-- uczestnikow wpisujac kolejne litery alfabetu. Wolontariusz, ktory musi
-- odprawic czlowieka bez kodu, wola koordynatora z panelem - i to jest
-- SWIADOMY koszt tej decyzji, opisany w raporcie wdrozenia.
--
-- WYMOG DWOCH ZNAKOW i limit 25 trafien nie sa optymalizacja: przy jednym
-- znaku funkcja oddawalaby polowe kartoteki, czyli robilaby dokladnie to,
-- czego zabraniamy skanerowi.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_checkin_search(jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_checkin_search(p_payload jsonb)
RETURNS TABLE (
  person_id uuid,
  first_name text,
  last_name text,
  company text,
  job_title text,
  registration_id uuid,
  registration_status text,
  ticket_name_pl text,
  ticket_name_en text,
  group_name_pl text,
  group_name_en text,
  badge_printed boolean,
  last_checkin_at timestamptz,
  last_checkin_direction text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_q text := lower(btrim(COALESCE(p_payload->>'q', '')));
  v_limit integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'limit', '')::integer, 25), 1), 25);
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  IF char_length(v_q) < 2 THEN
    RAISE EXCEPTION 'query_too_short: at least 2 characters are required';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.first_name, p.last_name,
    COALESCE(NULLIF(btrim(p.company_text), ''), co.name),
    p.job_title,
    r.id, r.status, tt.name_pl, tt.name_en, g.name_pl, g.name_en,
    (bp.printed_at IS NOT NULL),
    lc.occurred_at, lc.direction
  FROM public.event_people p
  LEFT JOIN public.crm_companies co
    ON co.tenant_id = p.tenant_id AND co.id = p.company_id
  -- INNER na zapisie byloby bledem: odprawa reczna sluzy takze osobie, ktora
  -- zapisu nie ma (gosc organizatora), a operator musi ja w tej liscie znalezc.
  LEFT JOIN public.event_registrations r
    ON r.tenant_id = p.tenant_id
   AND r.event_id = v_event_id
   AND r.person_id = p.id
   AND r.status NOT IN ('cancelled', 'rejected')
  LEFT JOIN public.event_ticket_types tt
    ON tt.tenant_id = r.tenant_id AND tt.id = r.ticket_type_id
  LEFT JOIN public.event_groups g
    ON g.tenant_id = r.tenant_id AND g.id = r.group_id
  LEFT JOIN LATERAL (
    SELECT bpr.printed_at
    FROM public.event_badge_prints bpr
    WHERE bpr.tenant_id = p.tenant_id AND bpr.event_id = v_event_id AND bpr.person_id = p.id
    ORDER BY bpr.printed_at DESC
    LIMIT 1
  ) bp ON true
  LEFT JOIN LATERAL (
    SELECT c.occurred_at, c.direction
    FROM public.event_checkins c
    WHERE c.tenant_id = p.tenant_id
      AND c.event_id = v_event_id
      AND c.person_id = p.id
      AND c.result = 'granted'
    ORDER BY c.occurred_at DESC
    LIMIT 1
  ) lc ON true
  WHERE p.tenant_id = v_tenant
    AND (
      p.full_name_norm LIKE '%' || v_q || '%'
      OR p.email_norm LIKE v_q || '%'
      OR lower(COALESCE(p.company_text, '')) LIKE '%' || v_q || '%'
    )
    -- Kartoteka jest wspolna dla wszystkich wydarzen najemcy, wiec bez tego
    -- warunku recepcja jednego wydarzenia przegladalaby uczestnikow wszystkich.
    -- Osoba bez zadnego sladu na TYM wydarzeniu nie jest tu potrzebna.
    AND (
      r.id IS NOT NULL
      OR lc.occurred_at IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM public.event_registrations r2
        WHERE r2.tenant_id = p.tenant_id AND r2.event_id = v_event_id AND r2.person_id = p.id
      )
    )
  ORDER BY p.last_name, p.first_name
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkin_search(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkin_search(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkin_search(jsonb) IS
  'Poszukiwanie uczestnika po nazwisku, adresie albo firmie przed odprawa reczna. JEDYNE miejsce w module oddajace liste osob z fragmentu tekstu - dlatego wylacznie w panelu i wylacznie w granicach jednego wydarzenia. Payload: {event_id, q, limit?}. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- P10) Odprawa reczna z panelu
--
-- Ta sama funkcja zapisu co przy skanie (`_event_checkin_write`), wiec decyzja,
-- idempotencja i limit obecnosci dzialaja identycznie. Rozni sie WYLACZNIE
-- zrodlem (`manual_entry` albo `name_search`) i autorem (redaktor, nie
-- urzadzenie) - a to jest dokladnie ta roznica, ktora audyt musi widziec.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_checkin_manual(jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_checkin_manual(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_checkpoint_id uuid := NULLIF(p_payload->>'checkpoint_id', '')::uuid;
  v_person_id uuid := NULLIF(p_payload->>'person_id', '')::uuid;
  v_direction text := lower(btrim(COALESCE(p_payload->>'direction', 'in')));
  v_source text := lower(btrim(COALESCE(p_payload->>'source', 'manual_entry')));
BEGIN
  IF v_event_id IS NULL OR v_checkpoint_id IS NULL OR v_person_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id, checkpoint_id and person_id are required';
  END IF;

  -- Plaszczyzna panelu moze zapisac WYLACZNIE dwa zrodla. `qr_code`
  -- i `self_service` naleza do urzadzenia i tu sa nieosiagalne - inaczej
  -- redaktor moglby wpisac odprawe udajaca skan przy bramce.
  IF v_source NOT IN ('manual_entry', 'name_search') THEN
    RAISE EXCEPTION 'invalid_source: the panel can only record manual_entry or name_search';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_people p
    WHERE p.tenant_id = v_tenant AND p.id = v_person_id
  ) THEN
    RAISE EXCEPTION 'person_not_found: person does not exist in this organisation';
  END IF;

  RETURN public._event_checkin_write(
    v_tenant,
    v_event_id,
    v_checkpoint_id,
    v_person_id,
    v_direction,
    v_source,
    NULL,
    auth.uid(),
    NULLIF(btrim(COALESCE(p_payload->>'client_scan_uid', '')), ''),
    NULL,
    NULLIF(btrim(COALESCE(p_payload->>'note', '')), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkin_manual(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkin_manual(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkin_manual(jsonb) IS
  'Odprawa reczna z panelu, przez ta sama funkcje zapisu co skan. Payload: {event_id, checkpoint_id, person_id, direction?, source?, note?, client_scan_uid?}. Zrodlo ograniczone do manual_entry / name_search - redaktor nie moze zapisac odprawy udajacej skan. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- P11) Statystyki na miejscu
--
-- KAZDA LICZBA W TEJ ODPOWIEDZI MA ZA SOBA WIERSZ, KTORY JA WYPRODUKOWAL.
-- Nie ma tu ani jednej metryki wyprowadzonej z deklaracji ani z szacunku:
--   * `registered_total`   - zapisy w stanach zajmujacych miejsce;
--   * `arrived_total`      - osoby z choc jedna ZGODA na wejscie (distinct);
--   * `arrived_registered` - z nich te, ktore maja zapis;
--   * `walk_in_total`      - zgody bez zapisu (osoby wpuszczone w trybie
--                            `track`, czyli realne wejscia bez rejestracji);
--   * `no_show_total`      - zapisani, ktorzy nie maja zadnej zgody
--                            (roznica dwoch policzalnych zbiorow, nie szacunek);
--   * `denied_total`       - wiersze odmowy, rozbite po powodach;
--   * `repeat_total`       - suma licznikow powtorzen (podwojne pikniecia);
--   * `failed_resolve_total` - suma nieudanych rozpoznan na urzadzeniach;
--   * `badges_printed_*`   - z rejestru wydrukow;
--   * `lead_scans_total`   - z tabeli leadow, z rozbiciem na zgody.
--
-- HISTOGRAM jest liczony w koszykach po `p_bucket_minutes` (domyslnie 15) na
-- kolumnie `occurred_at`, czyli na czasie URZADZENIA tam, gdzie go znamy. Bez
-- tego rozroznienia caly ruch z kolejki offline wpadalby do jednego koszyka -
-- tego, w ktorym wrocila siec.
--
-- Zwracamy jsonb, nie tabele: to jest ZESTAW metryk o roznych ksztaltach
-- (skalary, rozbicie po powodach, histogram, tabela punktow), a nie jedna
-- relacja. Wymuszanie tego w RETURNS TABLE dalby kolumny z tablicami jsonb
-- w kazdym wierszu, czyli ten sam jsonb, tylko trudniejszy do czytania.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_onsite_stats(uuid, integer);
CREATE OR REPLACE FUNCTION public.admin_event_onsite_stats(
  p_event_id uuid,
  p_bucket_minutes integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_bucket integer := LEAST(GREATEST(COALESCE(p_bucket_minutes, 15), 5), 240);
  v_registered integer;
  v_arrived integer;
  v_arrived_reg integer;
  v_walk_in integer;
  v_denied integer;
  v_repeats integer;
  v_failed integer;
  v_badge_people integer;
  v_badge_copies integer;
  v_leads integer;
  v_leads_consent integer;
  v_denied_breakdown jsonb;
  v_histogram jsonb;
  v_checkpoints jsonb;
  v_devices jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = p_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  SELECT count(*)::integer INTO v_registered
  FROM public.event_registrations r
  WHERE r.tenant_id = v_tenant
    AND r.event_id = p_event_id
    AND r.status IN ('approved', 'attended', 'no_show');

  SELECT
    count(DISTINCT c.person_id)::integer,
    count(DISTINCT c.person_id) FILTER (WHERE c.registration_id IS NOT NULL)::integer,
    count(DISTINCT c.person_id) FILTER (WHERE c.registration_id IS NULL)::integer
  INTO v_arrived, v_arrived_reg, v_walk_in
  FROM public.event_checkins c
  WHERE c.tenant_id = v_tenant
    AND c.event_id = p_event_id
    AND c.result = 'granted'
    AND c.direction = 'in';

  -- Odmowy licza sie po wierszach, powtorzenia po WSZYSTKICH wierszach: podwojne
  -- pikniecie zdarza sie i przy zgodzie, i przy odmowie, wiec ograniczenie sumy
  -- do odmow zanizaloby ja o wieksza czesc.
  SELECT
    count(*) FILTER (WHERE c.result <> 'granted')::integer,
    COALESCE(sum(c.repeat_count), 0)::integer
  INTO v_denied, v_repeats
  FROM public.event_checkins c
  WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id;

  SELECT COALESCE(jsonb_object_agg(x.result, x.cnt), '{}'::jsonb) INTO v_denied_breakdown
  FROM (
    SELECT c.result, count(*)::integer AS cnt
    FROM public.event_checkins c
    WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id AND c.result <> 'granted'
    GROUP BY c.result
  ) x;

  SELECT COALESCE(sum(d.failed_scan_count), 0)::integer INTO v_failed
  FROM public.event_scanner_devices d
  WHERE d.tenant_id = v_tenant AND d.event_id = p_event_id;

  SELECT count(DISTINCT bp.person_id)::integer, COALESCE(sum(bp.copies), 0)::integer
  INTO v_badge_people, v_badge_copies
  FROM public.event_badge_prints bp
  WHERE bp.tenant_id = v_tenant AND bp.event_id = p_event_id;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL
    )::integer
  INTO v_leads, v_leads_consent
  FROM public.event_lead_scans l
  JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
  WHERE l.tenant_id = v_tenant AND l.event_id = p_event_id;

  -- Histogram: koszyki rowne, liczone od poczatku godziny, zeby dwa odswiezenia
  -- pulpitu w tej samej minucie dawaly te same slupki.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'bucket_at', b.bucket_at,
    'granted_in', b.granted_in,
    'granted_out', b.granted_out,
    'denied', b.denied
  ) ORDER BY b.bucket_at), '[]'::jsonb) INTO v_histogram
  FROM (
    SELECT
      to_timestamp(
        floor(extract(epoch FROM c.occurred_at) / (v_bucket * 60)) * (v_bucket * 60)
      ) AS bucket_at,
      count(*) FILTER (WHERE c.result = 'granted' AND c.direction = 'in')::integer AS granted_in,
      count(*) FILTER (WHERE c.result = 'granted' AND c.direction = 'out')::integer AS granted_out,
      count(*) FILTER (WHERE c.result <> 'granted')::integer AS denied
    FROM public.event_checkins c
    WHERE c.tenant_id = v_tenant AND c.event_id = p_event_id
    GROUP BY 1
  ) b;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'checkpoint_id', s.id,
    'name_pl', s.name_pl,
    'name_en', s.name_en,
    'kind', s.kind,
    'access_mode', s.access_mode,
    'capacity', s.capacity,
    'occupancy', s.occupancy,
    'granted', s.granted,
    'denied', s.denied,
    'unique_people', s.unique_people,
    'last_checkin_at', s.last_at
  ) ORDER BY s.sort_order, s.name_pl), '[]'::jsonb) INTO v_checkpoints
  FROM (
    SELECT
      cp.id, cp.name_pl, cp.name_en, cp.kind, cp.access_mode, cp.capacity, cp.sort_order,
      public._event_checkpoint_occupancy(v_tenant, cp.id) AS occupancy,
      COALESCE(a.granted, 0)::integer AS granted,
      COALESCE(a.denied, 0)::integer AS denied,
      COALESCE(a.people, 0)::integer AS unique_people,
      a.last_at
    FROM public.event_checkpoints cp
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE c.result = 'granted')::integer AS granted,
        count(*) FILTER (WHERE c.result <> 'granted')::integer AS denied,
        count(DISTINCT c.person_id) FILTER (WHERE c.result = 'granted')::integer AS people,
        max(c.occurred_at) AS last_at
      FROM public.event_checkins c
      WHERE c.tenant_id = cp.tenant_id AND c.checkpoint_id = cp.id
    ) a ON true
    WHERE cp.tenant_id = v_tenant AND cp.event_id = p_event_id
  ) s;

  SELECT jsonb_build_object(
    'total', count(*)::integer,
    'active', count(*) FILTER (
      WHERE d.revoked_at IS NULL AND d.is_active AND d.expires_at > now()
        AND (d.locked_until IS NULL OR d.locked_until <= now())
    )::integer,
    'locked', count(*) FILTER (WHERE d.locked_until IS NOT NULL AND d.locked_until > now())::integer,
    'revoked', count(*) FILTER (WHERE d.revoked_at IS NOT NULL)::integer,
    'expired', count(*) FILTER (WHERE d.revoked_at IS NULL AND d.expires_at <= now())::integer
  ) INTO v_devices
  FROM public.event_scanner_devices d
  WHERE d.tenant_id = v_tenant AND d.event_id = p_event_id;

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'bucket_minutes', v_bucket,
    'registered_total', v_registered,
    'arrived_total', v_arrived,
    'arrived_registered', v_arrived_reg,
    'walk_in_total', v_walk_in,
    -- Frekwencja liczona z DWOCH policzalnych zbiorow. NULL przy zerze
    -- zapisanych, bo "0 procent frekwencji" na wydarzeniu bez zapisow jest
    -- zdaniem falszywym, a nie zerem.
    'attendance_rate', CASE
      WHEN v_registered > 0
      THEN round((v_arrived_reg::numeric / v_registered::numeric) * 100, 1)
      ELSE NULL
    END,
    'no_show_total', GREATEST(v_registered - v_arrived_reg, 0),
    'denied_total', v_denied,
    'denied_by_reason', v_denied_breakdown,
    'repeat_total', v_repeats,
    'failed_resolve_total', v_failed,
    'badges_printed_people', v_badge_people,
    'badges_printed_copies', v_badge_copies,
    'lead_scans_total', v_leads,
    'lead_scans_with_consent', v_leads_consent,
    'histogram', v_histogram,
    'checkpoints', v_checkpoints,
    'devices', v_devices
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_onsite_stats(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_onsite_stats(uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_onsite_stats(uuid, integer) IS
  'Statystyki na miejscu: frekwencja z DZIENNIKA (nie z deklaracji), rozklad w czasie w koszykach, obciazenie punktow, stan urzadzen, wydruki i leady. Kazda liczba ma za soba wiersz, ktory ja wyprodukowal. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- P12) Szablony identyfikatora: lista
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_badge_templates_list(uuid);
CREATE OR REPLACE FUNCTION public.admin_event_badge_templates_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  name text,
  paper_format text,
  width_mm numeric,
  height_mm numeric,
  orientation text,
  double_fold boolean,
  background_color text,
  background_image_url text,
  show_qr boolean,
  qr_size_mm numeric,
  elements jsonb,
  version integer,
  is_default boolean,
  prints_count integer,
  printed_people_count integer,
  last_printed_at timestamptz,
  stale_prints_count integer,
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
    t.id, t.event_id, t.name, t.paper_format, t.width_mm, t.height_mm,
    t.orientation, t.double_fold, t.background_color, t.background_image_url,
    t.show_qr, t.qr_size_mm, t.elements, t.version, t.is_default,
    COALESCE(pr.cnt, 0)::integer,
    COALESCE(pr.people, 0)::integer,
    pr.last_at,
    -- Wydruki zrobione ze STARSZEJ wersji ukladu. To jedyna odpowiedz na
    -- pytanie "kogo trzeba przedrukowac po zmianie szablonu" - bez niej zmiana
    -- ukladu jest decyzja bez konsekwencji, ktorych nikt nie widzi.
    COALESCE(pr.stale, 0)::integer,
    t.created_at, t.updated_at
  FROM public.event_badge_templates t
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS cnt,
      count(DISTINCT bp.person_id)::integer AS people,
      count(*) FILTER (WHERE bp.template_version < t.version)::integer AS stale,
      max(bp.printed_at) AS last_at
    FROM public.event_badge_prints bp
    WHERE bp.tenant_id = t.tenant_id AND bp.template_id = t.id
  ) pr ON true
  WHERE t.tenant_id = v_tenant
    AND t.event_id = p_event_id
  ORDER BY t.is_default DESC, t.name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_badge_templates_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_badge_templates_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_badge_templates_list(uuid) IS
  'Szablony identyfikatora wydarzenia z licznikiem wydrukow i licznikiem wydrukow ze STARSZEJ wersji ukladu (kogo trzeba przedrukowac). Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- P13) Szablony identyfikatora: dodanie i edycja
--
-- WALIDACJA UKLADU JEST TUTAJ, NIE W CHECK-U. CHECK na kolumnie pilnuje
-- ksztaltu (tablica, najwyzej 40 blokow); slownik rodzajow blokow i pol wymaga
-- petli oraz komunikatu, ktory mowi REDAKTOROWI, ktory blok jest zly - a tego
-- CHECK nie umie. Skoro ta funkcja jest jedyna droga zapisu, walidacja w niej
-- jest rownie skuteczna, a nieporownanie bardziej uzyteczna.
--
-- WERSJA ROSNIE PRZY ZMIANIE CZEGOKOLWIEK WIDOCZNEGO na kartce i NIE ROSNIE
-- przy zmianie samej nazwy szablonu. Bez tego rozroznienia licznik wydrukow
-- nieaktualnych rosnie po kazdej literowce w nazwie, czyli przestaje cokolwiek
-- znaczyc.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_badge_template_save(jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_badge_template_save(p_payload jsonb)
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
  v_format text := lower(btrim(COALESCE(p_payload->>'paper_format', 'a6')));
  v_orientation text := lower(btrim(COALESCE(p_payload->>'orientation', 'portrait')));
  v_width numeric := NULLIF(p_payload->>'width_mm', '')::numeric;
  v_height numeric := NULLIF(p_payload->>'height_mm', '')::numeric;
  v_bg text := NULLIF(btrim(COALESCE(p_payload->>'background_color', '')), '');
  v_bg_url text := NULLIF(btrim(COALESCE(p_payload->>'background_image_url', '')), '');
  v_show_qr boolean := COALESCE(NULLIF(p_payload->>'show_qr', '')::boolean, true);
  v_qr_size numeric := COALESCE(NULLIF(p_payload->>'qr_size_mm', '')::numeric, 25.00);
  v_fold boolean := COALESCE(NULLIF(p_payload->>'double_fold', '')::boolean, false);
  v_default boolean := COALESCE(NULLIF(p_payload->>'is_default', '')::boolean, false);
  v_elements jsonb := CASE
    WHEN jsonb_typeof(p_payload->'elements') = 'array' THEN p_payload->'elements'
    ELSE '[]'::jsonb
  END;
  v_element jsonb;
  v_kind text;
  v_existing public.event_badge_templates;
  v_layout_changed boolean := true;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT t.* INTO v_existing
    FROM public.event_badge_templates t
    WHERE t.id = v_id AND t.tenant_id = v_tenant;

    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION 'not_found: badge template does not exist in this organisation';
    END IF;
    v_event_id := v_existing.event_id;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  IF char_length(v_name) < 2 THEN
    RAISE EXCEPTION 'invalid_name: the template name must have at least 2 characters';
  END IF;

  IF v_format NOT IN ('a4', 'a5', 'a6', 'a7', 'badge_90x54', 'badge_100x150', 'custom') THEN
    RAISE EXCEPTION 'invalid_paper_format: unknown paper format %', v_format;
  END IF;

  IF v_orientation NOT IN ('portrait', 'landscape') THEN
    RAISE EXCEPTION 'invalid_orientation: orientation must be portrait or landscape';
  END IF;

  IF v_format = 'custom' THEN
    IF v_width IS NULL OR v_height IS NULL THEN
      RAISE EXCEPTION 'custom_dimensions_required: a custom format needs width_mm and height_mm';
    END IF;
    IF v_width NOT BETWEEN 20 AND 420 OR v_height NOT BETWEEN 20 AND 420 THEN
      RAISE EXCEPTION 'invalid_dimensions: each side must be between 20 and 420 mm';
    END IF;
  ELSE
    -- Format nazwany NIESIE swoje wymiary, wiec para milimetrow jest tu
    -- czyszczona, nie odrzucana - formularz moze odeslac caly wiersz.
    v_width := NULL;
    v_height := NULL;
  END IF;

  IF v_qr_size NOT BETWEEN 10 AND 100 THEN
    RAISE EXCEPTION 'invalid_qr_size: the QR side must be between 10 and 100 mm';
  END IF;

  IF v_bg IS NOT NULL AND v_bg !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION 'invalid_background_color: the colour must be written as #rrggbb';
  END IF;

  IF v_bg_url IS NOT NULL AND v_bg_url !~ '^(https?://|/)' THEN
    RAISE EXCEPTION 'invalid_background_url: the address must be absolute or start with /';
  END IF;

  IF jsonb_array_length(v_elements) > 40 THEN
    RAISE EXCEPTION 'too_many_elements: a template can hold at most 40 blocks';
  END IF;

  -- Slownik blokow. Petla, a nie CHECK, bo redaktor musi wiedziec, KTORY blok
  -- jest zly - komunikat z CHECK-a mowilby tylko, ze cala tablica jest zla.
  FOR v_element IN SELECT * FROM jsonb_array_elements(v_elements) LOOP
    IF jsonb_typeof(v_element) <> 'object' THEN
      RAISE EXCEPTION 'invalid_element: every layout block must be an object';
    END IF;

    v_kind := lower(btrim(COALESCE(v_element->>'kind', '')));
    IF v_kind NOT IN ('text', 'field', 'image', 'qr', 'sponsors', 'spacer') THEN
      RAISE EXCEPTION 'invalid_element_kind: unknown block kind %', v_kind;
    END IF;

    IF v_kind = 'field' AND lower(btrim(COALESCE(v_element->>'field', ''))) NOT IN (
      'first_name', 'last_name', 'full_name', 'company', 'job_title',
      'ticket_name', 'group_name', 'event_title', 'event_dates'
    ) THEN
      RAISE EXCEPTION 'invalid_element_field: unknown participant field %', v_element->>'field';
    END IF;

    IF v_kind = 'text' AND btrim(COALESCE(v_element->>'text', '')) = '' THEN
      RAISE EXCEPTION 'invalid_element_text: a text block cannot be empty';
    END IF;

    IF v_kind = 'image' AND COALESCE(v_element->>'url', '') !~ '^(https?://|/)' THEN
      RAISE EXCEPTION 'invalid_element_url: an image block needs an absolute address or one starting with /';
    END IF;

    IF v_element ? 'font_size_pt'
       AND (v_element->>'font_size_pt')::numeric NOT BETWEEN 5 AND 96 THEN
      RAISE EXCEPTION 'invalid_element_font_size: the font size must be between 5 and 96 pt';
    END IF;

    IF v_element ? 'width_percent'
       AND (v_element->>'width_percent')::numeric NOT BETWEEN 5 AND 100 THEN
      RAISE EXCEPTION 'invalid_element_width: the block width must be between 5 and 100 percent';
    END IF;

    IF v_element ? 'align'
       AND lower(COALESCE(v_element->>'align', '')) NOT IN ('left', 'center', 'right') THEN
      RAISE EXCEPTION 'invalid_element_align: alignment must be left, center or right';
    END IF;
  END LOOP;

  IF v_id IS NULL THEN
    INSERT INTO public.event_badge_templates (
      tenant_id, event_id, name, paper_format, width_mm, height_mm, orientation,
      double_fold, background_color, background_image_url, show_qr, qr_size_mm,
      elements, version, is_default, created_by
    ) VALUES (
      v_tenant, v_event_id, v_name, v_format, v_width, v_height, v_orientation,
      v_fold, v_bg, v_bg_url, v_show_qr, v_qr_size,
      v_elements, 1, false, auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    -- Czy zmienilo sie cokolwiek WIDOCZNEGO na kartce.
    v_layout_changed := (
      v_existing.paper_format IS DISTINCT FROM v_format
      OR v_existing.width_mm IS DISTINCT FROM v_width
      OR v_existing.height_mm IS DISTINCT FROM v_height
      OR v_existing.orientation IS DISTINCT FROM v_orientation
      OR v_existing.double_fold IS DISTINCT FROM v_fold
      OR v_existing.background_color IS DISTINCT FROM v_bg
      OR v_existing.background_image_url IS DISTINCT FROM v_bg_url
      OR v_existing.show_qr IS DISTINCT FROM v_show_qr
      OR v_existing.qr_size_mm IS DISTINCT FROM v_qr_size
      OR v_existing.elements IS DISTINCT FROM v_elements
    );

    UPDATE public.event_badge_templates SET
      name = v_name,
      paper_format = v_format,
      width_mm = v_width,
      height_mm = v_height,
      orientation = v_orientation,
      double_fold = v_fold,
      background_color = v_bg,
      background_image_url = v_bg_url,
      show_qr = v_show_qr,
      qr_size_mm = v_qr_size,
      elements = v_elements,
      version = version + CASE WHEN v_layout_changed THEN 1 ELSE 0 END
    WHERE id = v_id AND tenant_id = v_tenant;
  END IF;

  -- Wskazanie domyslnego szablonu jest operacja NA WYDARZENIU, nie na wierszu:
  -- indeks czesciowy dopuszcza dokladnie jeden, wiec poprzedni trzeba zdjac
  -- w tej samej transakcji.
  IF v_default THEN
    UPDATE public.event_badge_templates
    SET is_default = false
    WHERE tenant_id = v_tenant AND event_id = v_event_id AND id <> v_id AND is_default;

    UPDATE public.event_badge_templates
    SET is_default = true
    WHERE tenant_id = v_tenant AND id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_badge_template_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_badge_template_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_badge_template_save(jsonb) IS
  'Dodanie albo edycja szablonu identyfikatora, razem z walidacja slownika blokow ukladu. Wersja rosnie tylko przy zmianie czegokolwiek WIDOCZNEGO na kartce. Payload jsonb. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- P14) Szablony identyfikatora: usuniecie
--
-- Szablon, ktorym cokolwiek wydrukowano, NIE KASUJE SIE - wydruk jest dowodem
-- wydania, a klucz obcy `event_badge_prints_template_fk` nie ma kaskady wlasnie
-- po to. Komunikat mowi ile wydrukow blokuje operacje, bo bez liczby redaktor
-- nie wie, czy to jeden test, czy trzysta identyfikatorow.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_badge_template_delete(uuid);
CREATE OR REPLACE FUNCTION public.admin_event_badge_template_delete(_id uuid)
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
    SELECT 1 FROM public.event_badge_templates t
    WHERE t.id = _id AND t.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: badge template does not exist in this organisation';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.event_badge_prints bp
  WHERE bp.tenant_id = v_tenant AND bp.template_id = _id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'template_in_use: % badge print(s) were made from this template', v_used;
  END IF;

  DELETE FROM public.event_badge_templates WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_badge_template_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_badge_template_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_badge_template_delete(uuid) IS
  'Usuniecie szablonu identyfikatora. Odrzucane, gdy z szablonu cokolwiek wydrukowano - wydruk jest dowodem wydania. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- W7) Zapis wydruku - wspolny dla panelu i stanowiska samoobslugowego
--
-- Szablon domyslny wydarzenia jest wartoscia zapasowa, ale JAWNA: wiersz
-- zapisuje `template_id` i `template_version`, wiec pytanie "z czego wyszla ta
-- kartka" ma odpowiedz takze wtedy, gdy nikt szablonu nie wybieral.
--
-- POWOD PIERWSZEGO WYDANIA JEST WYLICZANY, nie zgadywany: gdy osoba ma juz
-- wydruk, a wolajacy nie podal powodu, wiersz dostaje `reprint_lost` - bo
-- druga kartka dla tej samej osoby nie jest pierwszym wydaniem, a milczenie
-- interfejsu nie moze zamieniac przedruku w wydanie w cenie wejsciowki.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_badge_print_write(
  uuid, uuid, uuid, uuid, integer, text, uuid, uuid, text
);
CREATE OR REPLACE FUNCTION public._event_badge_print_write(
  _tenant uuid,
  _event_id uuid,
  _person_id uuid,
  _template_id uuid,
  _copies integer,
  _reason text,
  _printed_by uuid,
  _device_id uuid,
  _note text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_template public.event_badge_templates;
  v_reg_id uuid;
  v_prints integer;
  v_reason text;
  v_copies integer := LEAST(GREATEST(COALESCE(_copies, 1), 1), 20);
  v_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_people p
    WHERE p.tenant_id = _tenant AND p.id = _person_id
  ) THEN
    RAISE EXCEPTION 'person_not_found: person does not exist in this organisation';
  END IF;

  IF _template_id IS NOT NULL THEN
    SELECT t.* INTO v_template
    FROM public.event_badge_templates t
    WHERE t.tenant_id = _tenant AND t.event_id = _event_id AND t.id = _template_id;

    IF v_template.id IS NULL THEN
      RAISE EXCEPTION 'template_not_in_event: the badge template belongs to another event';
    END IF;
  ELSE
    SELECT t.* INTO v_template
    FROM public.event_badge_templates t
    WHERE t.tenant_id = _tenant AND t.event_id = _event_id AND t.is_default;

    IF v_template.id IS NULL THEN
      RAISE EXCEPTION 'template_missing: this event has no default badge template';
    END IF;
  END IF;

  SELECT r.id INTO v_reg_id
  FROM public.event_registrations r
  WHERE r.tenant_id = _tenant
    AND r.event_id = _event_id
    AND r.person_id = _person_id
    AND r.status NOT IN ('cancelled', 'rejected');

  SELECT count(*)::integer INTO v_prints
  FROM public.event_badge_prints bp
  WHERE bp.tenant_id = _tenant AND bp.event_id = _event_id AND bp.person_id = _person_id;

  v_reason := lower(btrim(COALESCE(_reason, '')));
  IF v_reason NOT IN (
    'first_issue', 'reprint_lost', 'reprint_damaged', 'data_correction', 'bulk_preprint'
  ) THEN
    v_reason := CASE WHEN v_prints > 0 THEN 'reprint_lost' ELSE 'first_issue' END;
  END IF;

  INSERT INTO public.event_badge_prints (
    tenant_id, event_id, person_id, registration_id, template_id, template_version,
    copies, reason, printed_by, device_id, note
  ) VALUES (
    _tenant, _event_id, _person_id, v_reg_id, v_template.id, v_template.version,
    v_copies, v_reason, _printed_by, _device_id,
    NULLIF(btrim(COALESCE(_note, '')), '')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'print_id', v_id,
    'template_id', v_template.id,
    'template_name', v_template.name,
    'template_version', v_template.version,
    'copies', v_copies,
    'reason', v_reason,
    'previous_prints', v_prints,
    'person', public._event_onsite_person_card(_tenant, _event_id, _person_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_badge_print_write(
  uuid, uuid, uuid, uuid, integer, text, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_badge_print_write(
  uuid, uuid, uuid, uuid, integer, text, uuid, uuid, text
) TO service_role;

COMMENT ON FUNCTION public._event_badge_print_write(
  uuid, uuid, uuid, uuid, integer, text, uuid, uuid, text
) IS
  'Jedyna droga do rejestru wydrukow, wspolna dla panelu i stanowiska samoobslugowego. Szablon domyslny jako wartosc zapasowa, ale zapisany JAWNIE razem z wersja. Brak powodu przy istniejacym wydruku daje reprint_lost, nie first_issue.';

-- ----------------------------------------------------------------------------
-- P15) Zapis wydruku z panelu
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_badge_print_record(jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_badge_print_record(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_person_id uuid := NULLIF(p_payload->>'person_id', '')::uuid;
BEGIN
  IF v_event_id IS NULL OR v_person_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id and person_id are required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  RETURN public._event_badge_print_write(
    v_tenant,
    v_event_id,
    v_person_id,
    NULLIF(p_payload->>'template_id', '')::uuid,
    NULLIF(p_payload->>'copies', '')::integer,
    p_payload->>'reason',
    auth.uid(),
    NULL,
    p_payload->>'note'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_badge_print_record(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_badge_print_record(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_badge_print_record(jsonb) IS
  'Zapis wydruku identyfikatora z panelu. Payload: {event_id, person_id, template_id?, copies?, reason?, note?}. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- U6) Zapis wydruku ze stanowiska samoobslugowego
--
-- Wejsciem jest TOKEN uczestnika, nie jego identyfikator - tak samo jak przy
-- odprawie. Stanowisko w trybie kiosku nie moze wydrukowac identyfikatora
-- osobie, ktora nie przylozyla wlasnego kodu.
--
-- Zakres `badge_print` musi byc nadany JAWNIE przy wydawaniu poswiadczenia,
-- bo drukarka etykiet stoi w recepcji, a nie przy kazdej bramce.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_badge_print_record(jsonb);
CREATE OR REPLACE FUNCTION public.event_badge_print_record(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_device public.event_scanner_devices;
  v_code text := btrim(COALESCE(p_payload->>'code', ''));
  v_reg record;
  v_locked boolean;
BEGIN
  v_device := public._event_scanner_device_auth(p_payload->>'device_token', 'badge_print');

  IF v_code = '' THEN
    RAISE EXCEPTION 'invalid_payload: code is required';
  END IF;

  SELECT r.id, r.event_id, r.person_id INTO v_reg
  FROM public.event_registrations r
  WHERE r.tenant_id = v_device.tenant_id
    AND r.qr_token_hash = encode(digest(v_code, 'sha256'), 'hex');

  IF v_reg.id IS NULL THEN
    v_locked := public._event_scanner_device_note_failure(v_device.id);
    RETURN jsonb_build_object('outcome', 'unknown_code', 'device_locked', v_locked);
  END IF;

  IF v_reg.event_id <> v_device.event_id THEN
    RETURN jsonb_build_object('outcome', 'wrong_event', 'device_locked', false);
  END IF;

  RETURN jsonb_build_object('outcome', 'printed') || public._event_badge_print_write(
    v_device.tenant_id,
    v_device.event_id,
    v_reg.person_id,
    NULLIF(p_payload->>'template_id', '')::uuid,
    NULLIF(p_payload->>'copies', '')::integer,
    p_payload->>'reason',
    NULL,
    v_device.id,
    NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_badge_print_record(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_badge_print_record(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_badge_print_record(jsonb) IS
  'Zapis wydruku identyfikatora ze stanowiska samoobslugowego. Payload: {device_token, code, template_id?, copies?, reason?}. Wymaga zakresu badge_print. Wejsciem jest TOKEN uczestnika, nie person_id.';

-- ----------------------------------------------------------------------------
-- P16) Rejestr wydrukow: lista
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_badge_prints_list(uuid, uuid, integer, integer);
CREATE OR REPLACE FUNCTION public.admin_event_badge_prints_list(
  p_event_id uuid,
  p_person_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  printed_at timestamptz,
  person_id uuid,
  first_name text,
  last_name text,
  company text,
  registration_id uuid,
  registration_status text,
  template_id uuid,
  template_name text,
  template_version integer,
  template_current_version integer,
  copies integer,
  reason text,
  note text,
  printed_by uuid,
  printed_by_name text,
  device_id uuid,
  device_label text,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  RETURN QUERY
  SELECT
    bp.id, bp.printed_at, bp.person_id, p.first_name, p.last_name,
    COALESCE(NULLIF(btrim(p.company_text), ''), co.name),
    bp.registration_id, r.status,
    bp.template_id, t.name, bp.template_version, t.version,
    bp.copies, bp.reason, bp.note,
    bp.printed_by,
    COALESCE(
      NULLIF(btrim(pr.display_name), ''),
      NULLIF(btrim(COALESCE(pr.first_name, '') || ' ' || COALESCE(pr.last_name, '')), '')
    ),
    bp.device_id, d.label,
    count(*) OVER ()::integer
  FROM public.event_badge_prints bp
  JOIN public.event_people p ON p.tenant_id = bp.tenant_id AND p.id = bp.person_id
  LEFT JOIN public.crm_companies co ON co.tenant_id = p.tenant_id AND co.id = p.company_id
  LEFT JOIN public.event_registrations r ON r.tenant_id = bp.tenant_id AND r.id = bp.registration_id
  LEFT JOIN public.event_badge_templates t ON t.tenant_id = bp.tenant_id AND t.id = bp.template_id
  LEFT JOIN public.profiles pr ON pr.id = bp.printed_by AND pr.tenant_id = bp.tenant_id
  LEFT JOIN public.event_scanner_devices d ON d.tenant_id = bp.tenant_id AND d.id = bp.device_id
  WHERE bp.tenant_id = v_tenant
    AND bp.event_id = p_event_id
    AND (p_person_id IS NULL OR bp.person_id = p_person_id)
  ORDER BY bp.printed_at DESC, bp.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_badge_prints_list(uuid, uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_badge_prints_list(uuid, uuid, integer, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_badge_prints_list(uuid, uuid, integer, integer) IS
  'Rejestr wydrukow identyfikatora z wersja szablonu W CHWILI WYDRUKU obok wersji BIEZACEJ - roznica mowi, kogo trzeba przedrukowac. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- P17) Leady sponsorow: przeglad organizatora
--
-- Organizator widzi WSZYSTKIE leady wydarzenia razem z flaga zgody, bo to on
-- odpowiada za rozliczenie ze sponsorem i za zgodnosc przekazania danych.
-- Widzi tez, ILE leadow sponsora jest bez zgody - i to jest liczba, ktora
-- prowadzi rozmowe ze sponsorem ("z 84 skanow przekazemy 61").
--
-- DANE KONTAKTOWE UCZESTNIKA NIE JADA W TEJ ODPOWIEDZI. Organizator ma je
-- w liscie zapisow, wiec powtarzanie ich tutaj tylko zwiekszaloby liczbe
-- miejsc, z ktorych moga wyciec. Tu jest odpowiedz na pytanie o SKANY, nie
-- o osoby.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_lead_scans_list(uuid, uuid, integer, integer);
CREATE OR REPLACE FUNCTION public.admin_event_lead_scans_list(
  p_event_id uuid,
  p_sponsor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  sponsor_id uuid,
  sponsor_name text,
  person_id uuid,
  first_name text,
  last_name text,
  company text,
  first_scanned_at timestamptz,
  last_scanned_at timestamptz,
  scan_count integer,
  interest_rating smallint,
  note text,
  consent boolean,
  consent_snapshot_at timestamptz,
  device_id uuid,
  device_label text,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  RETURN QUERY
  SELECT
    l.id, l.sponsor_id, sp.snapshot_name,
    l.person_id, p.first_name, p.last_name,
    COALESCE(NULLIF(btrim(p.company_text), ''), co.name),
    l.first_scanned_at, l.last_scanned_at, l.scan_count,
    l.interest_rating, l.note,
    (p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL),
    l.consent_snapshot_at,
    l.device_id, d.label,
    count(*) OVER ()::integer
  FROM public.event_lead_scans l
  JOIN public.event_sponsors sp ON sp.tenant_id = l.tenant_id AND sp.id = l.sponsor_id
  JOIN public.event_people p ON p.tenant_id = l.tenant_id AND p.id = l.person_id
  LEFT JOIN public.crm_companies co ON co.tenant_id = p.tenant_id AND co.id = p.company_id
  LEFT JOIN public.event_scanner_devices d ON d.tenant_id = l.tenant_id AND d.id = l.device_id
  WHERE l.tenant_id = v_tenant
    AND l.event_id = p_event_id
    AND (p_sponsor_id IS NULL OR l.sponsor_id = p_sponsor_id)
  ORDER BY l.last_scanned_at DESC, l.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_lead_scans_list(uuid, uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_lead_scans_list(uuid, uuid, integer, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_lead_scans_list(uuid, uuid, integer, integer) IS
  'Przeglad skanow leadow wydarzenia dla organizatora, z flaga ZYWEJ zgody i data dowodu. BEZ danych kontaktowych uczestnika - tu jest odpowiedz o skany, nie o osoby. Bramka: assert_editor_tenant().';
