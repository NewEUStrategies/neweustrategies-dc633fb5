-- Kontekst nawigacji dla RUM (`web_vitals`).
--
-- PO CO. Audyt „Zimne otwarcie" (docs/AUDYT_CWV_ZIMNE_OTWARCIE_2026-09-20.md,
-- wada F40, wiersz 0.3 „Fali 0") nazwał lukę pomiarową: p75 liczone po
-- surowych wierszach `web_vitals` MIESZA dwie populacje, których nic w tej
-- tabeli nie rozdziela. Zimne pierwsze wejście (pusty cache HTTP, zimny izolat
-- Workera, telefon na 3G) i czwarta miękka nawigacja tego samego czytelnika
-- zostawiają nieodróżnialne wiersze, więc mediana „poprawia się" wraz z
-- długością sesji, a ogon rozkładu - ten, dla którego p75 w ogóle się liczy -
-- znika w uśrednieniu. Pięć kolumn niżej pozwala rozciąć tę populację
-- w zapytaniu (`WHERE cold_start` / `GROUP BY effective_type`), zamiast
-- zgadywać ją z `path`.
--
-- ZERO NOWYCH IDENTYFIKATORÓW - to jest granica tej zmiany, nie jej styl.
-- Żadna z tych kolumn nie wyróżnia osoby ani urządzenia: `navigation_type` ma
-- cztery wartości, `device_memory` cztery progi, `effective_type` cztery klasy
-- łącza, `cold_start` dwie, a `since_nav_ms` jest czasem WZGLĘDEM startu tej
-- jednej nawigacji, więc nie sklei dwóch odsłon. Tabela nadal nie ma kolumny
-- zdolnej powiązać wiersze jednego czytelnika - ingest nawet nie zapisuje `id`
-- metryki (patrz src/routes/api/public/vitals.ts). Rozszerzenie ładunku o
-- cokolwiek stabilnego wymagałoby OSOBNEJ decyzji o podstawie prawnej; ta
-- migracja świadomie tego nie otwiera.
--
-- RLS BEZ ZMIAN. `web_vitals` ma RLS włączony i ZERO polityk (20260626210000),
-- a `check:sql-anon-insert` trzyma ją na liście PROTECTED_INTAKE - zapis idzie
-- wyłącznie klientem service_role przez `/api/public/vitals`. Ta migracja nie
-- tworzy ani nie zmienia żadnej polityki, żadnego GRANT-u i żadnej funkcji
-- SECURITY DEFINER, więc nie dotyka ani inwariantu `check:sql-anon-insert`,
-- ani `check:sql-tenant-scope`.
--
-- ZAKRES NAJEMCY BEZ ZMIAN. Wiersze nadal skaluje `tenant_id` z 20260708150000
-- (NOT NULL, default `public.public_tenant_id()`), a agregacja
-- `web_vitals_daily_p75(timestamptz, uuid)` nadal wymaga najemcy w argumencie.
-- Nowe kolumny są OPISOWE i nie wchodzą do żadnego predykatu izolacji.
--
-- WSZYSTKIE KOLUMNY NULLABLE - i to jest wymóg, nie wygoda. Strona
-- zbuforowana przed tym wdrożeniem beaconuje próbkę bez kontekstu (może to
-- robić tygodniami, patrz „dwa kształty ciała" w trasie ingestu), a
-- przeglądarka bez Network Information API nie poda `effective_type` nigdy.
-- NOT NULL z wartością domyślną zamieniłby oba te przypadki w pomiar, którego
-- nie było. Brak backfillu jest z tego samego powodu: wiersze historyczne NIE
-- MAJĄ tego kontekstu i żadna wartość nie opisze ich uczciwiej niż NULL.
--
-- BEZ NOWEGO INDEKSU, ŚWIADOMIE. Zapytania panelu prowadzą
-- `(tenant_id, metric, created_at DESC)` - indeks z 20260708150000 - a nowe
-- kolumny są filtrem DOKŁADAJĄCYM się do tego predykatu, nie zastępującym go.
-- Indeks po `cold_start` (dwie wartości) albo `effective_type` (cztery) ma
-- selektywność bliską zeru i kosztowałby przy każdym zapisie, a ta tabela jest
-- zapisowa z definicji. Jeśli pierwszy pomiar pokaże zapytania po samym
-- kontekście, indeks dokłada OSOBNA migracja, z planem zapytania w komentarzu.

ALTER TABLE public.web_vitals
  ADD COLUMN IF NOT EXISTS since_nav_ms   integer,
  ADD COLUMN IF NOT EXISTS navigation_type text,
  ADD COLUMN IF NOT EXISTS device_memory  smallint,
  ADD COLUMN IF NOT EXISTS effective_type text,
  ADD COLUMN IF NOT EXISTS cold_start     boolean;

-- OGRANICZENIA SĄ DRUGĄ BRAMKĄ, NIE PIERWSZĄ. Pierwszą jest walidacja w
-- `src/routes/api/public/vitals.ts` (listy dozwolonych + zakres), która
-- sprowadza wartość spoza kontraktu do NULL, nie do błędu - ingest musi oddać
-- 204 także na śmieciowy beacon. Ograniczenia niżej pilnują tego samego
-- kontraktu OD STRONY BAZY, żeby przyszły pisarz (skrypt migracyjny, import,
-- ręczny INSERT z konsoli) nie wpisał do kolumny na cztery wartości piątej.
-- `NOT VALID` byłoby tu bez sensu: tabela nie ma jeszcze ani jednego wiersza
-- z tymi kolumnami, więc walidacja nie kosztuje nic.
--
-- Postgres nie ma `ADD CONSTRAINT IF NOT EXISTS`, a migracje w tym repo muszą
-- dać się odtworzyć (`check:sql-migration-replay`) - stąd osłona przez
-- `pg_constraint`, tym samym wzorcem co 20260827191229 i 20260831160000.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'web_vitals_navigation_type_values'
       AND conrelid = 'public.web_vitals'::regclass
  ) THEN
    ALTER TABLE public.web_vitals
      ADD CONSTRAINT web_vitals_navigation_type_values
      CHECK (navigation_type IS NULL
             OR navigation_type IN ('navigate', 'reload', 'back_forward', 'prerender'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'web_vitals_effective_type_values'
       AND conrelid = 'public.web_vitals'::regclass
  ) THEN
    ALTER TABLE public.web_vitals
      ADD CONSTRAINT web_vitals_effective_type_values
      CHECK (effective_type IS NULL
             OR effective_type IN ('slow-2g', '2g', '3g', '4g'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'web_vitals_device_memory_buckets'
       AND conrelid = 'public.web_vitals'::regclass
  ) THEN
    ALTER TABLE public.web_vitals
      ADD CONSTRAINT web_vitals_device_memory_buckets
      CHECK (device_memory IS NULL OR device_memory IN (1, 2, 4, 8));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'web_vitals_since_nav_ms_range'
       AND conrelid = 'public.web_vitals'::regclass
  ) THEN
    -- Górna granica to DOBA w milisekundach (86 400 000). Karta zostawiona na
    -- noc potrafi legalnie zgłosić kilkanaście godzin od startu nawigacji;
    -- wartość spoza doby pochodzi z podrobionego beacona albo z zegara, któremu
    -- i tak nie można ufać. Ta sama liczba stoi w MAX_SINCE_NAV_MS w trasie
    -- ingestu - jeśli kiedyś się rozjadą, wygra baza i zapis padnie głośno.
    ALTER TABLE public.web_vitals
      ADD CONSTRAINT web_vitals_since_nav_ms_range
      CHECK (since_nav_ms IS NULL OR (since_nav_ms >= 0 AND since_nav_ms <= 86400000));
  END IF;
END
$$;

COMMENT ON COLUMN public.web_vitals.since_nav_ms IS
  'Milisekundy od startu nawigacji do chwili ZGLOSZENIA probki (performance.now()). Odroznia pomiar z pierwszego malowania od tego samego pomiaru po miekkiej nawigacji w trzeciej minucie czytania. NULL = klient sprzed wdrozenia kontekstu nawigacji.';

COMMENT ON COLUMN public.web_vitals.navigation_type IS
  'Typ nawigacji z PerformanceNavigationTiming: navigate | reload | back_forward | prerender. Wartosc spoza listy odsiewa ingest (na NULL) i CHECK web_vitals_navigation_type_values.';

COMMENT ON COLUMN public.web_vitals.device_memory IS
  'Prog navigator.deviceMemory kubelkowany W DOL do 1/2/4/8 GB. Kubelkowanie jest celowe: probka ma odrozniac telefon od stacji roboczej, a nie opisywac egzemplarz urzadzenia. NULL = przegladarka nie podaje.';

COMMENT ON COLUMN public.web_vitals.effective_type IS
  'Klasa lacza z Network Information API: slow-2g | 2g | 3g | 4g. NULL = brak API (m.in. Safari i Firefox) albo klasa spoza specyfikacji.';

COMMENT ON COLUMN public.web_vitals.cold_start IS
  'TRUE = pierwsza nawigacja w tej karcie (brak znacznika sessionStorage). Populacja zimnego pierwszego wejscia z audytu F40. Znacznik stawiany dopiero po zgodzie analitycznej, wiec czytelnik zgadzajacy sie na trzeciej podstronie bywa liczony jako zimny - obciazenie znane i opisane w src/lib/webVitals.ts.';
