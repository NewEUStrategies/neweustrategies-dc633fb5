-- ============================================================================
-- RETENCJA TELEMETRII I SKROT FRAZY WYSZUKIWANIA W `analytics_events`.
--
-- MECHANIZM DEFEKTU (stan przed ta migracja).
--   1. Trzy tabele telemetrii - `analytics_events`, `web_vitals`,
--      `client_errors` - nie mialy ZADNEJ retencji: zero `DELETE` w migracjach,
--      zero zadania pg_cron. Polityka prywatnosci (src/lib/legal/content/
--      privacy.ts, PL i EN) obiecuje „zdarzenia techniczne - do 12 miesiecy",
--      a tabela zdarzen rosla bezterminowo. Obietnica w dokumencie prawnym bez
--      mechanizmu w bazie jest nieprawdziwa od pierwszego dnia trzynastego
--      miesiaca.
--   2. Fraza z wyszukiwarki wewnetrznej (`trackSearch`, src/lib/analytics/
--      track.ts) lezy w `entity_id` JAWNYM TEKSTEM obok `anon_id` -
--      identyfikatora przegladarki bez wygasania. Ingest redaguje wzorce PII
--      (`redactPii`: e-mail, telefon, tokeny), ale fraza „rozwod kowalski
--      adwokat" zadnego wzorca nie ma, a mowi o osobie wiecej niz adres e-mail.
--      Czyta to admin ORAZ redaktor (polityka `analytics_events_admin_read`,
--      20260730085737). Historyczne wiersze moga dodatkowo niesc `meta.q`
--      (kopie frazy w oryginalnej wielkosci liter, 200 znakow), ktora klient
--      wysylal do czasu naprawy w track.ts; sfalszowany klient moze ja wyslac
--      nadal, bo `redactMeta` nie zna klucza `q`.
--
-- DLACZEGO SKROT, A NIE USUNIECIE FRAZY. Nikt nie wyswietla frazy z tej
-- tabeli (raport „popularne frazy" stoi na osobnym dzienniku wyszukiwan, a
-- warstwa semantyczna liczy tylko `COUNT(*) FILTER (WHERE event_type =
-- 'search')`), ale ten sam skrot dla tej samej frazy zachowuje to, co w
-- kolumnie jest wartosciowe: grupowanie („ta fraza padla 40 razy") i indeks
-- `analytics_events_entity_idx`. HMAC z sekretem PER NAJEMCA, a nie golym
-- sha256: fraz jest malo i sa krotkie, wiec niesolony skrot odwraca sie
-- slownikiem w minuty. Pieprz per najemca dodatkowo sprawia, ze ta sama fraza
-- u dwoch najemcow daje dwa rozne skroty - zrzut jednego najemcy nie pozwala
-- korelowac wyszukiwan z drugim. Pieprz zamyka slownik OFFLINE; slownik online
-- przez publiczny ingest zostaje (RYZYKO PRZYJETE w BEZPIECZENSTWO nizej).
--
-- CO ROBI TA MIGRACJA.
--   * `analytics_search_peppers` - jeden 32-bajtowy sekret na najemce. RLS
--     wlaczony i ZERO polityk, REVOKE dla PUBLIC/anon/authenticated: tabeli
--     nie czyta nikt poza funkcjami SECURITY DEFINER nizej.
--   * `analytics_search_phrase_hash(tenant, fraza)` - normalizacja (lower,
--     zwiniecie bialych znakow, btrim) + 'sq1:' || hex(HMAC-SHA256). Pieprz
--     zakladany leniwie przy pierwszym uzyciu (wzorzec soli pseudonimow
--     klubowych, 20260808060751). Prefiks `sq1:` wersjonuje schemat skrotu:
--     zmiana normalizacji albo rotacja pieprzu dostanie `sq2:` i oba ksztalty
--     beda rozroznialne w danych.
--   * trigger BEFORE INSERT na `analytics_events` dla wierszy wyszukiwania
--     (`event_type = 'search'` LUB `entity_type = 'search_query'` - drugi czlon
--     lapie tez kombinacje sfalszowane przez klienta): `entity_id` := skrot,
--     `meta` traci klucz `q`. KAZDY blad skrotu daje `entity_id = NULL`
--     i wiersz zostaje - telemetria nie moze wywracac ingestu.
--   * `analytics_search_hash_backfill()` - jednorazowe przepisanie wierszy
--     historycznych (wywolane tu raz); filtr pomija wiersze juz przepisane,
--     wiec drugie wywolanie niczego nie zmienia.
--   * indeks `web_vitals (created_at)` - jedyna z trzech tabel bez indeksu
--     prowadzonego przez `created_at` (oba istniejace zaczynaja sie od
--     `metric` albo `tenant_id`), a bez niego kazda partia retencji to pelny
--     skan tabeli.
--   * `telemetry_retention_prune(p_limit)` + zadanie pg_cron
--     `telemetry-retention-prune` co godzine o :41.
--
-- OKNA RETENCJI.
--   * `analytics_events`: 12 miesiecy - wprost z polityki prywatnosci. Pulpit
--     admina wie o tym horyzoncie (`ANALYTICS_EVENTS_RETENTION_MONTHS`
--     w src/lib/admin/dashboard/period.ts) i nie pokazuje delt, ktorych okno
--     odniesienia siega za niego.
--   * `web_vitals`: 200 dni. RUM nie ma wartosci archiwalnej; 200 dni to pol
--     roku trendu (~183 dni) z zapasem na okno odniesienia. Uwaga: czytnik
--     (`vitals.functions.ts`) przyjmuje `days` do 365 - zakres dluzszy niz 200
--     dni pokaze od teraz tylko ostatnie 200.
--   * `client_errors`: 90 dni - tyle siega dashboard bledow
--     (`clientErrors.functions.ts`, `days` maks. 90); starszy stos nie pomaga
--     w diagnozie, a jest zredagowanym, ale wciaz osobowym sladem sesji.
--   Wszystkie trzy okna sa nie dluzsze niz 12 miesiecy z polityki.
--
-- BEZPIECZENSTWO.
--   * Funkcja skrotu NIE jest dostepna dla authenticated: admin i redaktor
--     czytaja skroty przez RLS, wiec z EXECUTE mieliby HURTOWA wyrocznie
--     slownikowa (tysiace fraz w jednym zapytaniu). EXECUTE ma tylko
--     service_role. Trigger nie potrzebuje EXECUTE wolajacego - funkcja
--     triggera jest SECURITY DEFINER.
--   * RYZYKO PRZYJETE: ta sama wyrocznia zostaje, tylko WOLNIEJSZA - przez
--     publiczny ingest. Skrot jest deterministyczny per najemca, POST
--     /api/public/track przyjmuje dowolna fraze klienta (do 40 zdarzen na
--     zadanie), a trigger skraca ja tym samym pieprzem. Admin albo redaktor
--     potwierdzi wiec zgadywana fraze („czy ktos szukal X?" = jeden beacon
--     + jeden SELECT, wynik obok `anon_id` szukajacego), a slownik zbuduje
--     w tempie limitera ingestu: ~80 fraz/s z jednego IP (120 zadan zrywu,
--     2 zadania/s, licznik per izolat - wiecej izolatow = wiecej). REVOKE
--     wyzej zamyka tylko droge najszybsza. Skrot chroni przed CZYTANIEM fraz
--     bez zgadywania, przed odwroceniem zrzutu tabeli bez pieprzu i przed
--     korelacja miedzy najemcami - NIE przed celowym sprawdzeniem frazy przez
--     role, ktora czyta skroty i moze pisac przez ingest. To nie regresja
--     (wczesniej fraza lezala jawnie). Utwardzenie poza ta migracja: rotacja
--     pieprzu w okresach (klucz per najemca per miesiac, wersja w prefiksie),
--     zeby slownik zbudowany dzis nie czytal historii, albo odciecie
--     `entity_id` wierszy wyszukiwania od odczytu admina i redaktora (zaden
--     czytnik go nie wyswietla).
--   * Najemca wiersza to `NEW.tenant_id` - wartosc juz rozstrzygnieta przez
--     ingest z hosta zadania; trigger nie wyprowadza najemcy sam i nie sprawdza
--     rol (bramka `check:sql-tenant-scope`).
--   * Ostrzezenie przy porazce skrotu loguje WYLACZNIE SQLSTATE - nigdy fraze
--     ani komunikat bledu, ktory moglby ja cytowac.
--   * pgcrypto mieszka na Supabase w schemacie `extensions`; funkcja wolajaca
--     `hmac`/`gen_random_bytes` ma go na przypietej sciezce (kontrakt
--     supabase/tests/extensions_search_path_contract_test.sql).
--
-- IDEMPOTENCJA. CREATE TABLE / INDEX IF NOT EXISTS, CREATE OR REPLACE
-- FUNCTION, CREATE OR REPLACE TRIGGER, bezstanowe ACL, backfill
-- z filtrem pomijajacym wiersze przepisane, zadanie cron wyrejestrowane
-- i rejestrowane od nowa.
--
-- BLOKADY PRZY WDROZENIU (koszt NIEZMIERZONY na danych produkcyjnych). Plik
-- biegnie w jednej transakcji, a CREATE OR REPLACE TRIGGER bierze na
-- `analytics_events` SHARE ROW EXCLUSIVE i trzyma ja do COMMIT. Od sekcji 3
-- do konca pliku KAZDY INSERT ingestu (/api/public/track czeka na wstawienie)
-- stoi w kolejce - przez caly backfill (pelny skan DISTINCT + UPDATE per
-- najemca, czas proporcjonalny do liczby wierszy), budowe indeksu
-- `web_vitals` i reszte pliku. Odczyty pulpitow nie czekaja. Gorna granica:
-- tabela istnieje od 2026-07-22 (ok. 2,5 miesiaca zdarzen), wiersze
-- wyszukiwania to ich ulamek. Kolejnosc trigger -> backfill jest celowa:
-- odwrotna zostawilaby jawny kazdy wiersz wstawiony po migawce backfillu,
-- a przed triggerem. Gdyby produkcyjna liczba wierszy czynila to wstrzymanie
-- nie do przyjecia, wywolanie backfillu mozna przeniesc do osobnej, pozniejszej
-- migracji albo kroku operatora: trigger kryje juz nowe wiersze, a backfill
-- jest idempotentny.
--
-- Dowod: supabase/tests/telemetry_retention_and_search_hash_test.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Sekret skrotu per najemca
-- ----------------------------------------------------------------------------
-- `bytea`, a nie hex w `text`: klucz HMAC to bajty, a tekstowa postac kusi do
-- logowania i porownan napisow. Brak DEFAULT celowo - jedynym miejscem, ktore
-- zaklada pieprz, jest funkcja skrotu nizej, wiec tabela nie ma drugiej drogi
-- zasiania wartoscia o innej entropii.
CREATE TABLE IF NOT EXISTS public.analytics_search_peppers (
  tenant_id  uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  pepper     bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.analytics_search_peppers IS
  'Sekret HMAC skrotu fraz wyszukiwania w analytics_events, jeden na najemce (32 bajty). RLS bez polityk i bez grantow dla rol klienckich - wyciek tej wartosci pozwala odwrocic skroty slownikiem. Zaklada go leniwie analytics_search_phrase_hash().';

ALTER TABLE public.analytics_search_peppers ENABLE ROW LEVEL SECURITY;
-- Domyslne uprawnienia Supabase nadaja nowej tabeli w `public` komplet dla anon
-- i authenticated - REVOKE jest tu konieczny, nie ozdobny. Grantu dla
-- service_role nie dokladamy: zadna sciezka aplikacji nie czyta pieprzu,
-- a funkcje, ktore go uzywaja, sa SECURITY DEFINER.
REVOKE ALL ON public.analytics_search_peppers FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2) Skrot frazy
-- ----------------------------------------------------------------------------
-- NORMALIZACJA jest kontraktem `sq1:` i zmienia sie tylko razem z prefiksem:
--   * `lower` - klient i tak wysyla fraze malymi literami (track.ts), ale
--     ingest nie wymusza tego na sfalszowanym kliencie;
--   * zwiniecie KAZDEGO bialego znaku (`\s+`, takze tabulacji i nowej linii)
--     do jednej spacji PRZED `btrim` - odwrotna kolejnosc zostawialaby
--     wiodaca spacje po tabulatorze, bo `btrim` tnie tylko spacje;
--   * pusta fraza po normalizacji to NULL, nie skrot pustego napisu - staly
--     skrot „niczego" bylby w raporcie najczestsza fraza.
--
-- LENIWY PIEPRZ: najpierw tani odczyt po kluczu glownym, dopiero przy braku
-- INSERT ... ON CONFLICT DO NOTHING i ponowny odczyt. Dwa rownolegle pierwsze
-- wyszukiwania nowego najemcy nie wygeneruja dwoch sekretow: drugi INSERT
-- czeka na pierwszy i nic nie wstawia, a ponowny SELECT (nowa migawka
-- w READ COMMITTED) widzi zwyciezce.
--
-- VOLATILE, bo moze pisac (pieprz), i zeby planista nie zwijal wywolan.
CREATE OR REPLACE FUNCTION public.analytics_search_phrase_hash(p_tenant uuid, p_phrase text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_norm text;
  v_pepper bytea;
BEGIN
  IF p_tenant IS NULL OR p_phrase IS NULL THEN
    RETURN NULL;
  END IF;

  v_norm := btrim(regexp_replace(lower(p_phrase), '\s+', ' ', 'g'));
  IF v_norm = '' THEN
    RETURN NULL;
  END IF;

  SELECT s.pepper INTO v_pepper
    FROM public.analytics_search_peppers s
   WHERE s.tenant_id = p_tenant;

  IF v_pepper IS NULL THEN
    INSERT INTO public.analytics_search_peppers (tenant_id, pepper)
    VALUES (p_tenant, gen_random_bytes(32))
    ON CONFLICT (tenant_id) DO NOTHING;

    SELECT s.pepper INTO v_pepper
      FROM public.analytics_search_peppers s
     WHERE s.tenant_id = p_tenant;
  END IF;

  RETURN 'sq1:' || encode(hmac(convert_to(v_norm, 'UTF8'), v_pepper, 'sha256'), 'hex');
END;
$fn$;

COMMENT ON FUNCTION public.analytics_search_phrase_hash(uuid, text) IS
  'Skrot frazy wyszukiwania: sq1: + hex(HMAC-SHA256(fraza po lower, zwinieciu bialych znakow i btrim; pieprz najemcy)). Pieprz zakladany leniwie. Pusta fraza albo NULL -> NULL. Tylko service_role: dla rol czytajacych skroty bylaby hurtowa wyrocznia slownikowa. Wolniejsza zostaje przez publiczny ingest (trigger skraca dowolna fraze klienta tym samym pieprzem) - ryzyko przyjete, opis w migracji 20261003190000.';

REVOKE ALL ON FUNCTION public.analytics_search_phrase_hash(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_search_phrase_hash(uuid, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 3) Trigger na ingest
-- ----------------------------------------------------------------------------
-- „JUZ SKROT" = DOKLADNIE ksztalt `sq1:` + 64 znaki hex, nie sam prefiks.
-- Sprawdzanie samego `sq1:` zrobiloby z prefiksu furtke: fraza wpisana jako
-- „sq1:jan kowalski" przeszlaby jawnym tekstem. Napis o pelnym ksztalcie skrotu
-- nie niesie zadnej tresci, wiec przepuszczenie go niczego nie ujawnia.
--
-- WYJATEK LAPANY W SRODKU, nie w ingescie: blad skrotu (brak pgcrypto, najemca
-- spoza `tenants` - kolumna `tenant_id` tej tabeli nie ma klucza obcego, wiec
-- zasianie pieprzu pada na FK) wycofuje tylko podtransakcje bloku. Fraza
-- znika (NULL), zdarzenie zostaje - jego liczenie jest wazniejsze niz grupa.
--
-- `meta - 'q'` tylko dla obiektu: operator na skalarze JSON rzuca wyjatkiem,
-- a ten nie moze wyjsc z triggera.
CREATE OR REPLACE FUNCTION public.analytics_events_search_hash()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF jsonb_typeof(NEW.meta) = 'object' THEN
    NEW.meta := NEW.meta - 'q';
  END IF;

  IF NEW.entity_id IS NOT NULL AND NEW.entity_id !~ '^sq1:[0-9a-f]{64}$' THEN
    BEGIN
      NEW.entity_id := public.analytics_search_phrase_hash(NEW.tenant_id, NEW.entity_id);
    EXCEPTION WHEN OTHERS THEN
      NEW.entity_id := NULL;
      RAISE WARNING 'analytics_events_search_hash: fraza odrzucona (SQLSTATE %)', SQLSTATE;
    END;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.analytics_events_search_hash() IS
  'BEFORE INSERT na analytics_events dla wierszy wyszukiwania: entity_id -> skrot sq1:, meta bez klucza q. Blad skrotu -> entity_id NULL, wiersz zostaje.';

REVOKE ALL ON FUNCTION public.analytics_events_search_hash() FROM PUBLIC, anon, authenticated;

-- WHEN na triggerze, nie IF w funkcji: odslony i klikniecia (zdecydowana
-- wiekszosc wierszy) w ogole nie wchodza do PL/pgSQL.
--
-- CREATE OR REPLACE TRIGGER (PG14+), nie DROP IF EXISTS + CREATE: DROP TRIGGER
-- bierze na tabeli ACCESS EXCLUSIVE (takze gdy triggera jeszcze nie ma)
-- i trzyma ja do COMMIT calej migracji, czyli przez caly backfill - a to
-- zatrzymaloby takze ODCZYTY pulpitow. SHARE ROW EXCLUSIVE z CREATE OR
-- REPLACE wstrzymuje tylko zapisy (ingest); SELECT-y ida dalej.
CREATE OR REPLACE TRIGGER analytics_events_search_hash_trg
  BEFORE INSERT ON public.analytics_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'search' OR NEW.entity_type = 'search_query')
  EXECUTE FUNCTION public.analytics_events_search_hash();

-- ----------------------------------------------------------------------------
-- 4) Backfill wierszy historycznych
-- ----------------------------------------------------------------------------
-- FUNKCJA, a nie anonimowy blok DO: ten sam kod wykonuje sie raz tutaj, a pgTAP
-- moze go wywolac drugi raz i dowiesc, ze powtorka niczego nie zmienia. Zostaje
-- tez narzedziem operatora, gdyby trigger byl kiedys wylaczony na czas importu.
--
-- PARTIA PER NAJEMCA. Realna porazka skrotu jest per najemca (brak wiersza
-- w `tenants` dla pieprzu), a jeden blad w UPDATE wycofuje cala instrukcje -
-- jedna instrukcja dla calej tabeli przez jednego osieroconego najemce
-- zostawilaby jawne frazy wszystkich. Najemca, ktorego partia padla, traci
-- frazy (NULL) - prywatnosc wygrywa z grupowaniem tak samo jak w triggerze.
--
-- BLOKADY. Wywolanie w TEJ migracji (nizej) biegnie pod SHARE ROW EXCLUSIVE
-- na `analytics_events` z CREATE OR REPLACE TRIGGER, trzymanym do COMMIT
-- calego pliku: ingest z tej tabeli czeka przez caly backfill, odczyty
-- pulpitu nie (patrz naglowek, BLOKADY PRZY WDROZENIU). Dopiero pozniejsze, samodzielne wywolanie operatora bierze tylko
-- ROW EXCLUSIVE i blokady przepisywanych wierszy wyszukiwania (do konca jego
-- transakcji, nie partii - podtransakcja ich nie zwalnia); wtedy INSERT
-- ingestu nie czeka, a retencja omija te wiersze przez SKIP LOCKED.
CREATE OR REPLACE FUNCTION public.analytics_search_hash_backfill()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tenant uuid;
  v_rows integer;
  v_total integer := 0;
BEGIN
  FOR v_tenant IN
    SELECT DISTINCT e.tenant_id
      FROM public.analytics_events e
     WHERE (e.event_type = 'search' OR e.entity_type = 'search_query')
       AND ((e.entity_id IS NOT NULL AND e.entity_id !~ '^sq1:[0-9a-f]{64}$')
            OR (jsonb_typeof(e.meta) = 'object' AND e.meta ? 'q'))
  LOOP
    BEGIN
      UPDATE public.analytics_events e
         SET entity_id = CASE
               WHEN e.entity_id IS NULL OR e.entity_id ~ '^sq1:[0-9a-f]{64}$' THEN e.entity_id
               ELSE public.analytics_search_phrase_hash(e.tenant_id, e.entity_id)
             END,
             meta = CASE WHEN jsonb_typeof(e.meta) = 'object' THEN e.meta - 'q' ELSE e.meta END
       WHERE e.tenant_id = v_tenant
         AND (e.event_type = 'search' OR e.entity_type = 'search_query')
         AND ((e.entity_id IS NOT NULL AND e.entity_id !~ '^sq1:[0-9a-f]{64}$')
              OR (jsonb_typeof(e.meta) = 'object' AND e.meta ? 'q'));
      GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.analytics_events e
         SET entity_id = CASE
               WHEN e.entity_id ~ '^sq1:[0-9a-f]{64}$' THEN e.entity_id
               ELSE NULL
             END,
             meta = CASE WHEN jsonb_typeof(e.meta) = 'object' THEN e.meta - 'q' ELSE e.meta END
       WHERE e.tenant_id = v_tenant
         AND (e.event_type = 'search' OR e.entity_type = 'search_query')
         AND ((e.entity_id IS NOT NULL AND e.entity_id !~ '^sq1:[0-9a-f]{64}$')
              OR (jsonb_typeof(e.meta) = 'object' AND e.meta ? 'q'));
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      RAISE WARNING 'analytics_search_hash_backfill: frazy najemcy % wyzerowane (SQLSTATE %)',
        v_tenant, SQLSTATE;
    END;
    v_total := v_total + v_rows;
  END LOOP;

  RETURN v_total;
END;
$fn$;

COMMENT ON FUNCTION public.analytics_search_hash_backfill() IS
  'Przepisuje historyczne wiersze wyszukiwania analytics_events na skrot sq1: i zdejmuje meta.q; partia per najemca, porazka skrotu -> entity_id NULL. Zwraca liczbe przepisanych wierszy; powtorka zwraca 0. Tylko service_role.';

REVOKE ALL ON FUNCTION public.analytics_search_hash_backfill() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_search_hash_backfill() TO service_role;

-- Jednorazowe przepisanie. Bez zewnetrznego EXCEPTION: porazki sa juz lapane
-- per najemca w funkcji, a blad poza nimi (np. brak tabeli) ma wywrocic
-- migracje, a nie zostawic jawnych fraz z zielonym wdrozeniem. Biegnie pod
-- blokada z sekcji 3 - ingest `analytics_events` czeka do COMMIT pliku.
SELECT public.analytics_search_hash_backfill();

-- ----------------------------------------------------------------------------
-- 5) Indeks pod retencje `web_vitals`
-- ----------------------------------------------------------------------------
-- `analytics_events_created_at_idx` i `client_errors_created_idx` juz istnieja
-- (malejace - Postgres skanuje je wstecz rownie tanio). Bez CONCURRENTLY, jak
-- reszta repo: migracja biegnie w transakcji. Budowa trzyma SHARE na
-- `web_vitals` (ingest RUM czeka do COMMIT) i wydluza wstrzymanie
-- `analytics_events` z sekcji 3 o swoj czas.
CREATE INDEX IF NOT EXISTS web_vitals_created_at_idx
  ON public.web_vitals (created_at);

COMMENT ON INDEX public.web_vitals_created_at_idx IS
  'Partie retencji telemetry_retention_prune(): najstarsze wiersze po created_at bez pelnego skanu. Istniejace indeksy web_vitals prowadza metric albo tenant_id.';

-- ----------------------------------------------------------------------------
-- 6) Retencja
-- ----------------------------------------------------------------------------
-- PARTIE, NIE JEDEN DELETE. Pierwsze uruchomienie zastaje zaleglosc (ingest
-- bez retencji od czerwca), a jeden DELETE na setkach tysiecy wierszy trzyma
-- blokady i generuje WAL w jednym kawalku. `FOR UPDATE SKIP LOCKED` sprawia,
-- ze dwa nakladajace sie przebiegi (reczny i z crona) nie czekaja na siebie,
-- tylko biora rozne wiersze. Najstarsze najpierw - przerwany przebieg zostawia
-- granice retencji ciagla.
--
-- ROZMIAR PARTII. Domyslnie (NULL albo <= 0) 10 000 wierszy na tabele, gorny
-- limit 100 000 dla recznego nadrabiania. Cron przekazuje 10 000 jawnie:
-- co godzine daje to 240 000 wierszy na dobe NA TABELE (~2,8 wiersza/s przez
-- cala dobe). W stanie ustalonym retencja kasuje tyle, ile wplynelo dobe
-- sprzed horyzontu, wiec nadaza, dopoki dobowy naplyw do tabeli jest ponizej
-- 240 000 wierszy - przy 1-3 zdarzeniach na odslone to 80-240 tys. odslon
-- dziennie. Ponizej tego progu zaleglosc po przestoju crona tez schodzi sama;
-- powyzej trzeba podniesc partie w poleceniu crona, a liczniki rowne
-- `batch_limit` w wyniku sa sygnalem, ze ten moment nadszedl. Partia tej
-- wielkosci to krotka praca po indeksie `created_at`, wiec blokady wierszy
-- trwaja krotko.
--
-- `now()` jest czasem transakcji - jeden przebieg ma jedna granice dla calej
-- partii. Granica scisla (`<`): wiersz dokladnie na horyzoncie zostaje.
CREATE OR REPLACE FUNCTION public.telemetry_retention_prune(p_limit integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_limit integer := CASE
    WHEN p_limit IS NULL OR p_limit <= 0 THEN 10000
    ELSE LEAST(p_limit, 100000)
  END;
  v_events integer;
  v_vitals integer;
  v_errors integer;
BEGIN
  DELETE FROM public.analytics_events
   WHERE id IN (
     SELECT e.id FROM public.analytics_events e
      WHERE e.created_at < now() - interval '12 months'
      ORDER BY e.created_at
      LIMIT v_limit
      FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  DELETE FROM public.web_vitals
   WHERE id IN (
     SELECT w.id FROM public.web_vitals w
      WHERE w.created_at < now() - interval '200 days'
      ORDER BY w.created_at
      LIMIT v_limit
      FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS v_vitals = ROW_COUNT;

  DELETE FROM public.client_errors
   WHERE id IN (
     SELECT c.id FROM public.client_errors c
      WHERE c.created_at < now() - interval '90 days'
      ORDER BY c.created_at
      LIMIT v_limit
      FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS v_errors = ROW_COUNT;

  -- `batch_limit` obok licznikow: licznik rowny limitowi znaczy „zostala
  -- zaleglosc", mniejszy - „tabela czysta do horyzontu".
  RETURN jsonb_build_object(
    'analytics_events', v_events,
    'web_vitals', v_vitals,
    'client_errors', v_errors,
    'batch_limit', v_limit
  );
END;
$fn$;

COMMENT ON FUNCTION public.telemetry_retention_prune(integer) IS
  'Retencja telemetrii partiami (najstarsze najpierw, SKIP LOCKED): analytics_events 12 miesiecy (polityka prywatnosci), web_vitals 200 dni, client_errors 90 dni. p_limit = wierszy na tabele (NULL/<=0 -> 10000, maks. 100000). Zwraca liczniki usunietych wierszy per tabela i batch_limit. Co godzine z pg_cron (telemetry-retention-prune, minuta 41, partia 10000), gdy rozszerzenie jest dostepne; inaczej na zadanie (service_role).';

REVOKE ALL ON FUNCTION public.telemetry_retention_prune(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telemetry_retention_prune(integer) TO service_role;

-- ----------------------------------------------------------------------------
-- 7) Harmonogram
-- ----------------------------------------------------------------------------
-- Minuta 41: wolna w harmonogramie repo, z dala od :00 i od innych zadan
-- godzinowych. Wyrejestrowanie przed rejestracja czyni blok powtarzalnym
-- (prawdziwe `cron.unschedule` rzuca wyjatkiem dla nieznanej nazwy, stad
-- wewnetrzny blok). Brak pg_cron albo blad rejestracji nie wywraca migracji -
-- retencja zostaje wtedy wywolaniem na zadanie, a ostrzezenie mowi to wprost.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron unavailable - telemetry retention runs only on demand';
    RETURN;
  END IF;
  BEGIN
    PERFORM cron.unschedule('telemetry-retention-prune');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM cron.schedule(
    'telemetry-retention-prune',
    '41 * * * *',
    $job$SELECT public.telemetry_retention_prune(10000)$job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'telemetry: scheduling retention job failed (%)', SQLERRM;
END $$;
