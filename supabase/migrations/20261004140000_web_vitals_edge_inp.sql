-- Stan cache dokumentu, colo i zgrubna atrybucja INP dla RUM (`web_vitals`).
--
-- PO CO. Plan PSI 85/95 (docs/performance/2026-10-03-pagespeed-85-95, pozycja
-- P0.6, ingest i migracja w P1.0b). TTFB, LCP i INP realnych czytelników
-- lądują dziś w jednym worku, a MISS w kolonii kosztuje sekundy TTFB, podczas
-- gdy HIT - ułamek sekundy. Bez podziału po stanie cache p75 TTFB mówi więcej
-- o udziale MISS niż o szybkości strony, a bez kolonii nie widać, KTÓRA jest
-- zimna. Fale 1-3 przenoszą przy tym pracę z bootu na pierwszą interakcję
-- (kolejka po interakcji, wyspy hydratacji), więc regres INP trzeba umieć
-- rozdzielić na „interakcja przed hydratacją", „przed `load`" i „pierwsza
-- interakcja dokumentu". Siedem kolumn niżej to dokładnie pola, które
-- reporter (`src/lib/webVitals.ts`) wysyła od P0.6, a ingest
-- (`src/routes/api/public/vitals.ts`) zapisuje od tej migracji:
--   * edge_cache, edge_layer, colo - z nagłówka `Server-Timing` dokumentu
--     (`nes-edge`, `nes-layer`, `colo`), wyłącznie na próbkach pierwszej
--     trasy dokumentu;
--   * inp_event, inp_pre_hydration, inp_since_load_ms, inp_first - wyłącznie
--     na próbce INP.
--
-- ZERO NOWYCH IDENTYFIKATORÓW - granica tej zmiany, jak w 20260920121000.
-- Kolonia to kod lotniska centrum danych (publiczny i tak w `cf-ray`) i opisuje
-- region obsługi dokumentu, nie osobę; reszta to zamknięte słowniki, flagi i
-- czas względem `load` jednej odsłony. Wiek wpisu cache (`nes-age`), koszt bazy
-- (`db`), selektor celu interakcji ani `interactionId` świadomie NIE trafiają do
-- tabeli. Zastrzeżenie z reportera: `BYPASS` bywa pośrednikiem stanu
-- zalogowania (ciasteczko sesji `sb-*` omija cache) - panel ma pokazywać
-- wyłącznie agregaty z progiem minimalnej liczności.
--
-- RLS BEZ ZMIAN. `web_vitals` ma RLS włączony i ZERO polityk (20260626210000),
-- a `check:sql-anon-insert` trzyma ją na liście PROTECTED_INTAKE - zapis idzie
-- wyłącznie klientem service_role przez `/api/public/vitals`. Ta migracja nie
-- tworzy ani nie zmienia żadnej polityki, żadnego GRANT-u ani funkcji.
--
-- ZAKRES NAJEMCY BEZ ZMIAN. Wiersze nadal skaluje `tenant_id` (20260708150000);
-- nowe kolumny są OPISOWE i nie wchodzą do żadnego predykatu izolacji.
--
-- WSZYSTKIE KOLUMNY NULLABLE, BEZ BACKFILLU. Strona zbuforowana przed P0.6
-- beaconuje próbkę bez tych pól (tygodniami - „dwa kształty ciała" w trasie
-- ingestu), dokument bez `Server-Timing` nie ma stanu cache, a próbki inne niż
-- INP nie mają atrybucji. Wiersze historyczne tego kontekstu NIE MAJĄ i nic nie
-- opisze ich uczciwiej niż NULL. Istniejące kolumny tabeli zostają bez zmian.
--
-- BEZ INDEKSU, ŚWIADOMIE. Tabela jest append-only (ingest RUM plus partie
-- retencji po `created_at`), a zapytania panelu prowadzi
-- `(tenant_id, metric, created_at DESC)` z 20260708150000. Nowe kolumny są
-- filtrem DOKŁADAJĄCYM się do tego predykatu (`GROUP BY edge_cache, colo`
-- w oknie dni), o selektywności bliskiej zeru (4, 3 albo 6 wartości, flagi),
-- więc indeks kosztowałby przy każdym zapisie i niczego nie przyspieszył.
-- Jeśli pomiar pokaże zapytania po samym kontekście, indeks dokłada OSOBNA
-- migracja, z planem zapytania w komentarzu.
--
-- SŁOWNIKI MAJĄ JEDNO ŹRÓDŁO: eksporty `src/lib/webVitals.ts`
-- (`EDGE_CACHE_STATUSES`, `EDGE_LAYERS`, `INP_EVENT_VALUES`,
-- `MAX_SINCE_LOAD_MS`). Ingest wiąże je typem i testem; SQL nie ma jak ich
-- zaimportować, więc CHECK-i niżej je powtarzają. Zmiana słownika w reporterze
-- = zmiana w trasie i NOWA migracja (DROP CONSTRAINT + ADD CONSTRAINT).
-- `edge_layer` jest BEZ `L3`: serwer (`NesCacheLayer`, src/lib/http/ssrTiming.ts)
-- emituje L1/L2/render i reporter wysyła tylko te trzy.

ALTER TABLE public.web_vitals
  ADD COLUMN IF NOT EXISTS edge_cache        text,
  ADD COLUMN IF NOT EXISTS edge_layer        text,
  ADD COLUMN IF NOT EXISTS colo              text,
  ADD COLUMN IF NOT EXISTS inp_event         text,
  ADD COLUMN IF NOT EXISTS inp_pre_hydration boolean,
  ADD COLUMN IF NOT EXISTS inp_since_load_ms integer,
  ADD COLUMN IF NOT EXISTS inp_first         boolean;

-- OGRANICZENIA SĄ DRUGĄ BRAMKĄ, NIE PIERWSZĄ. Pierwszą jest walidacja w
-- `src/routes/api/public/vitals.ts`, która wartość spoza kontraktu sprowadza do
-- NULL, nie do błędu (ingest oddaje 204 także na śmieciowy beacon). CHECK-i
-- pilnują tego samego kontraktu od strony bazy, żeby przyszły pisarz (import,
-- skrypt, ręczny INSERT z konsoli) nie wpisał do kolumny wartości spoza słownika.
--
-- `NOT VALID`, INACZEJ NIŻ W 20260920121000 - ŚWIADOMIE. Plik biegnie w jednej
-- transakcji, a `ADD COLUMN` bierze na `web_vitals` ACCESS EXCLUSIVE i trzyma ją
-- do COMMIT. Walidowany `ADD CONSTRAINT ... CHECK` czyta przy tym CAŁĄ tabelę -
-- osobno dla każdego z siedmiu ograniczeń, bo każde to osobne ALTER TABLE
-- w bloku DO - i przez ten czas stoją zarówno beacony ingestu, jak i odczyty
-- panelu (ACCESS EXCLUSIVE wstrzymuje także SELECT). Tabela trzyma do 200 dni
-- RUM (retencja z 20261003190000), więc to siedem pełnych skanów pod
-- najmocniejszą blokadą. Dowodzą one przy tym rzeczy pewnej z konstrukcji:
-- każdy istniejący wiersz ma w tych kolumnach NULL (dodaje je ta sama
-- transakcja), a każdy CHECK niżej przepuszcza NULL - takiż jest wiersz
-- spoza INP dla ograniczenia atrybucji. `NOT VALID` pomija wyłącznie ten
-- skan; KAŻDY nowy INSERT i UPDATE jest sprawdzany tak samo jak przy
-- ograniczeniu walidowanym. Precedens: 20260926153300 („istniejące wiersze
-- i tak go spełniają, a walidacja nie blokuje tabeli przy wdrożeniu").
-- Gdyby kiedyś `convalidated` było potrzebne, `ALTER TABLE ... VALIDATE
-- CONSTRAINT` poza tym plikiem bierze tylko SHARE UPDATE EXCLUSIVE i nie
-- wstrzymuje zapisów.
--
-- Postgres nie ma `ADD CONSTRAINT IF NOT EXISTS`, a migracje w tym repo muszą
-- dać się odtworzyć (`check:sql-migration-replay`) - stąd osłona przez
-- `pg_constraint`, tym samym wzorcem co 20260920121000.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'web_vitals_edge_cache_values'
       AND conrelid = 'public.web_vitals'::regclass
  ) THEN
    ALTER TABLE public.web_vitals
      ADD CONSTRAINT web_vitals_edge_cache_values
      CHECK (edge_cache IS NULL
             OR edge_cache IN ('HIT', 'STALE', 'MISS', 'BYPASS'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'web_vitals_edge_layer_values'
       AND conrelid = 'public.web_vitals'::regclass
  ) THEN
    ALTER TABLE public.web_vitals
      ADD CONSTRAINT web_vitals_edge_layer_values
      CHECK (edge_layer IS NULL OR edge_layer IN ('L1', 'L2', 'render'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'web_vitals_colo_format'
       AND conrelid = 'public.web_vitals'::regclass
  ) THEN
    -- Zakres `[A-Z]` w wyrażeniach regularnych Postgresa to przedział kodów
    -- znaków, nie porządek sortowania, więc małe litery nie przechodzą
    -- niezależnie od kolacji bazy - tak samo jak `COLO_RE` w trasie ingestu.
    ALTER TABLE public.web_vitals
      ADD CONSTRAINT web_vitals_colo_format
      CHECK (colo IS NULL OR colo ~ '^[A-Z]{3}$')
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'web_vitals_inp_event_values'
       AND conrelid = 'public.web_vitals'::regclass
  ) THEN
    ALTER TABLE public.web_vitals
      ADD CONSTRAINT web_vitals_inp_event_values
      CHECK (inp_event IS NULL
             OR inp_event IN ('pointerdown', 'pointerup', 'click', 'keydown', 'keyup', 'other'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'web_vitals_inp_since_load_ms_range'
       AND conrelid = 'public.web_vitals'::regclass
  ) THEN
    -- Doba w milisekundach w OBIE strony: wartość ujemna to interakcja przed
    -- `load` i jest legalna. Ta sama liczba stoi w MAX_SINCE_LOAD_MS reportera
    -- i trasy ingestu - jeśli kiedyś się rozjadą, wygra baza i zapis padnie
    -- głośno.
    ALTER TABLE public.web_vitals
      ADD CONSTRAINT web_vitals_inp_since_load_ms_range
      CHECK (inp_since_load_ms IS NULL
             OR (inp_since_load_ms >= -86400000 AND inp_since_load_ms <= 86400000))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'web_vitals_inp_first_true_only'
       AND conrelid = 'public.web_vitals'::regclass
  ) THEN
    -- Reporter wysyła `inpFirst` wyłącznie jako `true`; brak pola znaczy
    -- „późniejsza ALBO nieznana", więc FALSE udawałoby wiedzę, której nikt nie
    -- ma. Kolumna przyjmuje TRUE albo NULL.
    ALTER TABLE public.web_vitals
      ADD CONSTRAINT web_vitals_inp_first_true_only
      CHECK (inp_first IS NULL OR inp_first)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'web_vitals_inp_attribution_only_inp'
       AND conrelid = 'public.web_vitals'::regclass
  ) THEN
    -- Atrybucja opisuje interakcję wyznaczającą INP, więc na wierszu LCP albo
    -- CLS byłaby fałszywa, a `GROUP BY inp_event` bez filtra metryki liczyłby
    -- ją podwójnie. Ingest zeruje te pola poza próbką INP; to ograniczenie
    -- pilnuje tego samego od strony bazy.
    ALTER TABLE public.web_vitals
      ADD CONSTRAINT web_vitals_inp_attribution_only_inp
      CHECK (metric = 'INP'
             OR (inp_event IS NULL
                 AND inp_pre_hydration IS NULL
                 AND inp_since_load_ms IS NULL
                 AND inp_first IS NULL))
      NOT VALID;
  END IF;
END
$$;

COMMENT ON COLUMN public.web_vitals.edge_cache IS
  'Status NES Edge Cache dokumentu z Server-Timing nes-edge: HIT | STALE | MISS | BYPASS. Tylko probki PIERWSZEJ trasy dokumentu; NULL = brak naglowka, trasa miekka, dokument z lokalnego cache przegladarki albo klient sprzed P0.6. BYPASS bywa posrednikiem stanu zalogowania - wylacznie agregaty z progiem licznosci.';

COMMENT ON COLUMN public.web_vitals.edge_layer IS
  'Warstwa, ktora podala dokument, z Server-Timing nes-layer: L1 | L2 | render (NesCacheLayer w src/lib/http/ssrTiming.ts). Tylko probki pierwszej trasy dokumentu; NULL jak przy edge_cache.';

COMMENT ON COLUMN public.web_vitals.colo IS
  'Kod kolonii Cloudflare (trzy wielkie litery kodu lotniska, np. WAW) z Server-Timing colo. Region obslugi dokumentu, nie osoba. Tylko probki pierwszej trasy dokumentu; NULL jak przy edge_cache.';

COMMENT ON COLUMN public.web_vitals.inp_event IS
  'Tylko probka INP: pierwsze zdarzenie najwolniejszej klatki interakcji wyznaczajacej INP - pointerdown | pointerup | click | keydown | keyup | other. To nie handler, tylko typ wpisu Event Timing.';

COMMENT ON COLUMN public.web_vitals.inp_pre_hydration IS
  'Tylko probka INP: TRUE = interakcja zaczela sie na wyspie [data-island-state=pending] (przed hydratacja), FALSE = na wyspie hydrated. NULL = poza wyspa, start nieznany albo klient sprzed P0.6.';

COMMENT ON COLUMN public.web_vitals.inp_since_load_ms IS
  'Tylko probka INP: milisekundy od loadEventStart do poczatku interakcji wyznaczajacej INP; ujemne = przed load. Zakres +/- doba (MAX_SINCE_LOAD_MS).';

COMMENT ON COLUMN public.web_vitals.inp_first IS
  'Tylko probka INP: TRUE = interakcja wyznaczajaca INP byla PIERWSZA interakcja dokumentu (praca przeniesiona na pierwsza interakcje). NULL = pozniejsza albo nieznana; FALSE nie wystepuje (CHECK web_vitals_inp_first_true_only).';
