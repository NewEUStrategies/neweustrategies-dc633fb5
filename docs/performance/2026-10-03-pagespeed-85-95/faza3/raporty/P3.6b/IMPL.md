# P3.6b (fala 3): werdykt zapisu dokumentu na końcu strumienia i własny budżet treści strony głównej

Worktree: `scratchpad/wt3/P3.6b`, gałąź `perf/w3-P3.6b`, commit `80ce4d2b` (nad `d22cf7d6`).
Zakres: PLAN-FALI-3 §2 P3.6b, `faza3/diagnoza/cache-dokumentu.md` R2 (a)-(c), R3a, R7c (`degradedBy`
z out_of_ownership P3.6a) oraz pytanie (e) o `cache-control` na HIT `/` w produkcji.

Przekazany przez harness wątek użytkownika („jeden font - ma to być Red Hat Display") to pozycja P3.2b
(partia 3, decyzja zapisana w planie w `d22cf7d6`). Ta pozycja fontów nie dotyka.

## 0. Werdykt w skrócie

| punkt                                                                                   | stan                                                                                 |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| (a) predykat kompletności rejestrowany przez loader                                     | zrobione; wykrywanie wyczerpanej bramki sekcji przez śledzenie pobrań (odstępstwo 1) |
| (b) decyzja zapisu na końcu strumienia, świeżość z dyrektywy końcowej                   | zrobione                                                                             |
| (c) chrome przy wygasłym terminie czeka 1,2 s i oznacza `chrome`                        | zrobione (także „`warm()` skończyło się bez danych")                                 |
| (d) R3a: `home.page` + `home.mode` z własnym budżetem 1 200 ms; typ A zawsze `no-store` | zrobione                                                                             |
| (e) `no-cache, must-revalidate, max-age=0` na HIT `/` w produkcji                       | wyjaśnione: nadpisanie przez hosting dla HTML, nie błąd (§3)                         |
| R7c `degradedBy` w linii `kind:"doc"`                                                   | zrobione                                                                             |
| dowód: testy negatywne i pozytywne B1/B2, smoke w procesie                              | zrobione (§4); smoke na artefakcie - etap Prove (§6)                                 |

Najważniejsze odkrycie przy implementacji: integracja router<->query (`@tanstack/router-ssr-query-core`,
`teardown` w `serverSsr.cleanup()`) wywołuje `queryClient.cancelQueries()` i `queryClient.clear()` ZARAZ po
`controller.close()` strumienia routera (`transformStreamWithRouter.js:264-266`), czyli zanim kolektor zapisu
NES Edge Cache przeczyta `done`. W chwili decyzji o zapisie cache zapytań jest więc pusty. Predykat liczony
„na końcu strumienia" wprost na `QueryClient` widziałby pustkę. Dlatego werdykt jest zamrażany tuż przed
`QueryCache.clear()` tego żądania (§1, `resilientLoad.ts`). Kontrola mutacyjna to potwierdza: bez zamrożenia
padają oba pozytywne scenariusze smoke'a w procesie.

## 1. Zmiany plik po pliku

### `src/lib/ssr/homeSsrBudget.ts`

- `HOME_CONTENT_BUDGET_MS = 1_200` - własny termin ścieżki krytycznej treści (R3a).
- `HOME_CHROME_LATE_BUDGET_MS = 1_200` - budżet bramki chrome'u po wygaśnięciu terminu (R2c).
- `homeContentDeadline(qc)` = `homeSsrDeadline(qc) - HOME_SSR_BUDGET_MS + HOME_CONTENT_BUDGET_MS`: ten sam
  start zegara żądania (korzeń albo trasa, kto pierwszy), więc korzeń, który zużył 400 ms, nie daje treści
  świeżych 1 200 ms.
- Bramka `check:ssr-budgets` nie istnieje od PR #475, więc stałe są tylko literałami z komentarzem.

### `src/lib/http/responseHeaders.ts` (rejestry per żądanie)

Wzorzec `routeCacheDirectives` (WeakMap po `Request`, `createIsomorphicFn`, klucz `getRequest()` albo jawny
`Request` dla czytających spoza zasięgu żądania):

- `registerDocumentCompletenessCheck(check, request?)`, `readDocumentCompleteness(request?)` - predykaty
  składane koniunkcją; brak predykatu = kompletny (inne trasy bez zmian); predykat, który rzuca =
  `check-failed`, czyli brak zapisu.
- `noteDocumentDegradation(label, request?)`, `readDocumentDegradations(request?)` - etykiety R7c, kolejność
  pierwszego zgłoszenia, bez duplikatów, sufit 16.
- Klient: wszystkie cztery to no-op; brak wywołań w zasięgu modułu (stała `COMPLETE` to literał).

### `src/lib/ssr/resilientLoad.ts`

- `loadResilient` po zasiewie fallbacku na serwerze (`import.meta.env.SSR`) odnotowuje etykietę
  (`label` albo `queryLabel(klucz)`).
- `queryLabel(key)` - najwyżej dwa wiodące elementy tekstowe klucza (`["public","home-page"]` ->
  `public.home-page`), bez obiektów parametrów.
- `markDeliberateSeed(qc, key)` - jawna, per żądanie lista celowych zasiewów (`updatedAt: 0` dla parytetu
  SSR/klienta, nie fallback awarii).
- `DECORATIVE_QUERY_ROOTS = {"ad_placements"}` - dekoracje: ich brak albo błąd nie czyni dokumentu
  niekompletnym (doktryna korzenia przy `headerAds`: „brak sprzedanej emisji kosztowałby cache CAŁEGO
  serwisu").
- `trackSsrQueryCompleteness(qc)` - zwraca predykat:
  - subskrybuje `QueryCache` i zapisuje zapytania, dla których po uzbrojeniu przyszła akcja `fetch`;
  - werdykt: `error:<klucz>` (status `error`), `seed:<klucz>` (`success` z `dataUpdatedAt <= 0`, a nie
    zadeklarowany celowy zasiew), `dropped:<klucz>` (pobierane po uzbrojeniu albo wciąż w locie, a na końcu
    bez danych lub nieobecne w cache'u); pozostałe `pending` to obserwatory renderu, które na serwerze
    z założenia nie pobierają (na czystym renderze fixture jest ich 10, zamiatarka i tak je usuwa);
  - zamrożenie: instancyjna podmiana `cache.clear` żądania liczy werdykt i wypisuje subskrypcję tuż przed
    właściwym `clear()`; bez sprzątania (testy, przerwany potok) werdykt liczy się na żywo.
- Uzbrajanie na KOŃCU loadera trasy (opis w komentarzu modułu): pobrania z fazy loaderów i tak nie
  przeżywają dehydratacji (zamiatarka anuluje wszystko w locie), a bramki renderu pobierają ponownie to,
  czego potrzebują. Wcześniejsze uzbrojenie robiłoby z rozgrzewki widgetu niewidocznego na tym urządzeniu
  (bramka go nie ponawia) „zgubione dane" i blokowało zapis kompletnego dokumentu.

### `src/lib/http/documentCache.server.ts`

- `applyDeferredDocumentStore`, po zebraniu kopii i po `canStillStore()`:
  - `readDocumentCompleteness(record.request)`: `false` -> etykiety odstępstw do rejestru R7c,
    `markLateDegradation(record, "stream")` (to samo odświeżenie w tle z limitem prób co dotąd),
    `decide("degraded", "stream")`, brak zapisu;
  - `true` -> zapis ze ŚWIEŻOŚCIĄ Z DYREKTYWY KOŃCOWEJ: `cacheControl = narrowestCacheControl(record.cacheControl,
readRouteCacheDirective(record.request))`, `freshMs`/`swrMs` = minimum z rekordu i polityki tej dyrektywy.
    Dotąd wpis brał świeżość z chwili rejestracji w middleware, więc dyrektywa zawężona w trakcie
    strumieniowania (chrome po flushu: 30 s) żyła w magazynie 3 min i dobę STALE.
- Komentarze: nagłówek modułu (MISS) i `degradedAt` w pierścieniu.

### `src/lib/ssr/chromeWarmup.tsx` (R2c)

- `ChromeWarmup.warmLate?(budgetMs)` - dogrzanie z własnym budżetem; podaje je wyłącznie strona główna.
- `readChromeWarmup`:
  - bez `warmLate` - zachowanie bez zmian (wyczerpany termin = `failed` od ręki, inne trasy jak dotąd);
  - z `warmLate`: `markDegraded("chrome")`, potem `warm()` (gdy termin jeszcze trwa) i dogrzanie do
    `HOME_CHROME_LATE_BUDGET_MS` od pierwszego odczytu bramki, jeśli dane nadal nie są gotowe; po budżecie
    bez danych - `failed` (`no-store`); awaria dogrzania - `failed`.
- `markFailed` = `markDegraded("failed")` + etykieta `chrome` (R7c, tylko serwer).

### `src/routes/__root.tsx` (tylko gałąź chrome po terminie i lista celowych zasiewów)

- Rejestracja chrome'u dostaje `warmLate` (tylko `isServer && homeDeadline !== undefined`, więc klient go nie
  niesie): menu, ticker, reklama nagłówka (jak w `warm`, bo `HeaderSkeleton` rezerwuje jej wysokość z tego
  wpisu) i widgety nagłówka/stopki przez `prefetchCachedRouteQueries` z budżetem bramki - wszystko pod
  `withBudget(..., budgetMs)` bez terminu dokumentu. Lista pracy jest osobna, bo domknięcia `chromeWarm` są
  związane `chromeBudget` z chwili loadera (po wygaśnięciu terminu to no-op).
- Przy zasiewie `post-layout-settings`: `if (isServer) markDeliberateSeed(...)` + import. Nic poza tym.
- Konflikty z P3.8: P3.8 zmienia falę 1 (`fontScale`), sygnał „brak aktywnych popupów" i bramki nakładek.
  Moje dwie zmiany leżą w obiekcie `registerChromeWarmup` (nowa własność między `markDegraded` a `warm`)
  i w bloku zasiewu `postLayoutKey`, plus jedna linia importu `resilientLoad`.

### `src/routes/index.tsx`

- `home.page` i `home.mode` z `deadlineAt: contentDeadlineAt` (`homeContentDeadline`); `home.settings`,
  `home.archive`, nad zgięciem i chrome zostają przy wspólnych 600 ms (zakres planu).
- Spóźnione dane nad zgięciem: `aboveFoldLate` zamiast `degraded ||=`. Nagłówek:
  `degraded` -> `private, no-store` (w tym ZAWSZE typ A), `aboveFoldLate` -> `chromeDegradedCacheControl()`
  (30 s / 300 s), inaczej `resilientCacheControl(false)` (odstępstwo 4).
- Na końcu loadera (serwer): `registerDocumentCompletenessCheck(trackSsrQueryCompleteness(queryClient))`.
- `degraded` w `loaderData` znaczy teraz tylko „treść/ustawienia/archiwum na fallbacku". Sonda zewnętrzna
  `degraded:![01]` z diagnozy §1.1 dla B2 pokaże `!1` (dokument zapisany krótko).

### `src/lib/http/ssrTiming.ts` (tylko pole `degradedBy`)

- `DocumentLogLine.degradedBy?: string[]`, `DocumentLogInput.degradedBy?`; do linii tylko przy
  `degraded: true`, filtr `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`, bez duplikatów, najwyżej 8.

### `src/server.ts` (tylko `logDocument`)

- `degradedBy: degraded ? readDocumentDegradations(request) : undefined` + import. Ścieżka czytelnika
  i rewalidacji w tle mają własne `Request`, więc etykiety się nie mieszają (test izolacji).

### Testy

- NOWY `src/lib/ssr/__tests__/documentCompleteness.test.ts` (22): negatywne (zasiew typu A, błąd, pobranie
  w renderze anulowane i usunięte jak w `ServerSectionGate`, to samo z odtworzonym obserwatorem, dane
  w locie, zasiew bez deklaracji, deklaracja per `QueryClient`), pozytywne (B2 po terminie loadera, celowy
  zasiew, dekoracja z błędem i w locie, obserwator bez pobrania, rozgrzewka loadera zamieciona i nieponowiona,
  rozgrzewka zamieciona i ponowiona z sukcesem), zamrożenie (kompletny i niekompletny werdykt przeżywa
  `clear()`, zdarzenia po zamrożeniu go nie zmieniają), `queryLabel`.
- NOWY `src/lib/http/__tests__/documentCompletenessPipeline.test.tsx` (5) - SMOKE W PROCESIE: prawdziwy
  `requestHandler`, `handleDocumentRequest` + `applyDeferredDocumentStore`, render strumieniowy Reacta
  z PRAWDZIWĄ `ServerSectionGate` (budżet 2 s), zamiatanie przed renderem i sprzątanie integracji
  (`cancelQueries()` + `clear()`) po zamknięciu strumienia; atrapą jest tylko „backend" widgetu
  (`@/lib/builder/prefetch`). Dowodzi: B2 zapisany, drugie żądanie HIT, świeżość ≤ 30 s; czysty render -
  pełna świeżość; typ A nie zapisany i drugie żądanie MISS; typ A z „zapomnianym" `no-store` i tak odrzucony
  na etapie `stream`; sekcja po budżecie bramki nie zapisana.
- `degradedRenderCachePipeline.test.ts`: dyrektywa zawężona W TRAKCIE strumieniowania skraca świeżość
  zapisanego wpisu (czytelnik widzi politykę z flushu, wpis - 30 s).
- `documentLogTelemetry.test.ts` (przez prawdziwy `src/server.ts`): `degradedBy` na etapie `loader`
  i `stream` (z `store: "degraded"`, drugi przebieg MISS), predykat kompletny = zapis bez przyczyn i HIT,
  izolacja etykiet między żądaniami.
- `ssrTiming.server.test.ts`: `degradedBy` tylko przy `degraded: true`, alfabet, duplikaty, sufit 8, `null`.
- `platformChromeWarmup.test.tsx`: wygasły termin + `warmLate` = `chrome` i czekanie z budżetem
  ≤ `HOME_CHROME_LATE_BUDGET_MS`; brak danych po budżecie = `failed`; `warm()` bez danych -> dogrzanie;
  awaria dogrzania = `failed`; trasy bez `warmLate` bez zmian.
- `homeSsrBudget.test.ts`: termin treści na wspólnym zegarze, sufity ≤ 1,5 s, izolacja żądań.
- `resilientLoad.test.ts`: etykieta degradacji w rejestrze żądania (z etykietą, bez etykiety, czysty
  odczyt nic nie odnotowuje).
- `homeRoute.test.tsx`: zwis treści kończy się na TERMINIE TREŚCI (1 200 ms; po 600 ms loader nadal
  czeka); treść po 900 ms nie jest typem A (pełna polityka); typ A zawsze `no-store`; spóźnione dane nad
  zgięciem = krótka polityka i zarejestrowany predykat (dawny test „no-store" przepisany na nowy kontrakt);
  SSR rejestruje predykat, nawigacja SPA nie. Atrapa `responseHeaders` zna nowe funkcje.
- `rootRoute.test.tsx`: wygasły termin strony głównej - bramka czeka budżet bramki (`chrome`), potem
  fallbacki i `no-store` (dawny test „nie opóźnia powłoki" przepisany na nowy kontrakt R2c).
- `archiveLoaderResilience.test.ts`: atrapa `responseHeaders` zna `noteDocumentDegradation` (środowisko
  `node` ma `import.meta.env.SSR = true`, więc odporny loader ją woła).

## 2. Bramki i wyniki

| bramka                                                                                                                                             | wynik                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bunx prettier --write` / `--check` na dotkniętych plikach                                                                                         | OK                                                                                                                                                                                                       |
| `light.sh bunx eslint <dotknięte>`                                                                                                                 | 0 błędów; 4 ostrzeżenia `react-refresh/only-export-components` w `chromeWarmup.tsx` i `__root.tsx` (te same eksporty co na bazie)                                                                        |
| typecheck (`heavy-bg.sh` + `typecheck-noinc.sh`: tsgo, `tsconfig.scripts.json`, `tsconfig.e2e.json`)                                               | zielony (`typecheck.log`, exit 0)                                                                                                                                                                        |
| vitest: wszystkie testy importujące dotknięte moduły + `src/lib/ssr/__tests__` + `src/lib/http/__tests__`                                          | 111 plików, 2671 testów zielonych (`vitest-related.log`)                                                                                                                                                 |
| vitest: `src/lib/ci/__tests__` + `src/__tests__` (skany źródeł, potok startu)                                                                      | 54 pliki zielone, 2 pominięte (`vitest-ci.log`)                                                                                                                                                          |
| `light.sh bun run verify:static`                                                                                                                   | 15 bramek OK w 289 s (`verify-static.log`)                                                                                                                                                               |
| `check:ssr-budgets`, `check:loader-policy`                                                                                                         | nie istnieją od PR #475 - pominięte                                                                                                                                                                      |
| kontrola mutacyjna (pliki przywrócone z kopii)                                                                                                     | wyłączony predykat w magazynie: padają 2 negatywne testy smoke'a; wyłączone zamrożenie: padają 2 pozytywne testy smoke'a i 3 testy zamrożenia; świeżość z rekordu zamiast dyrektywy: pada test świeżości |
| build, `check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity`, `check:document-weight`, `test:e2e:artifact`, Lighthouse | nieuruchamiane - etap Prove (§6)                                                                                                                                                                         |

## 3. (e) `cache-control: no-cache, must-revalidate, max-age=0` na HIT `/` w produkcji

Sondy produkcyjne 2026-10-08 (3 żądania, odstęp 4 s, `prod-probe/`):

| ścieżka        | typ        | `x-nes-cache` / `Server-Timing`                                                     | `cache-control` w odpowiedzi                                                                       |
| -------------- | ---------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/`            | HTML       | MISS, `ssr;dur=600.0`, `degraded:!0` w HTML (aplikacja wysłała `private, no-store`) | `no-cache, must-revalidate, max-age=0`                                                             |
| `/robots.txt`  | text/plain | BYPASS                                                                              | `public, max-age=0, s-maxage=300, stale-while-revalidate=1800` (wartość aplikacji)                 |
| `/sitemap.xml` | XML        | BYPASS                                                                              | `public, max-age=0, s-maxage=60, stale-while-revalidate=1800, must-revalidate` (wartość aplikacji) |

Do tego zapisy z fazy 1 (`faza1/server-cache/hb-1.txt`, `h-bypass-1.txt`, `lighthouse/home-production-headers.txt`):
HIT `/` (aplikacja odtwarza z wpisu `public, max-age=60, s-maxage=900, …` - wpis z `no-store` w ogóle nie
powstaje, `documentStorePolicy`) i BYPASS HTML mają tę samą wartość `no-cache, must-revalidate, max-age=0`.

Wniosek: to polityka nagłówka hostingu dla odpowiedzi `text/html` (nadpisuje każdą wartość aplikacji: `public`
z HIT-u i `private, no-store` z degradacji), a nie ślad degradacji. Nie-HTML przechodzi bez zmian. W repo nie
ma czego naprawiać: NES Edge Cache decyduje po dyrektywie wewnętrznej (`readRouteCacheDirective`), nie po
nagłówku wychodzącym. Hipoteza z `zapytania-po-boocie.md` §6 („ścieżka degradacji strony głównej") jest
obalona. Lokalnie (bez hostingu) nagłówek jest wartością aplikacji.

Sondy bazy (artefakt `base-w3b`, fixture, `base-probe/`):

- `artifact-boot`: MISS (pełna polityka) -> HIT. W stanie odwodnionym 19 zapytań `success`, zero `error`,
  jedyny `dataUpdatedAt:0` to `post-layout-settings`. Na końcu renderu 10 obserwatorów `pending` bez pobrania
  (zamiatarka je usuwa). Predykat P3.6b uzna taki render za kompletny.
- `slow-first-fold` (posty +900 ms, pierwsze zgięcie po terminie loadera = B2): czytelnik dostał
  `private, no-store` (`degraded:true, degradedAt:"loader"`, 3 segmenty `S:` dostrumieniowane), a HIT
  drugiego żądania pochodzi z odświeżenia w tle (`revalidation:true, store:"stored"`), nie z dokumentu
  czytelnika. To jest strona A pomiaru Prove.

## 4. Odstępstwa od planu (i dlaczego)

1. **Wyczerpana bramka sekcji bez flagi `exhausted`.** `sectionStreaming.tsx` jest poza listą plików. Predykat
   wykrywa skutek: zapytanie pobierane po uzbrojeniu, a na końcu nieobecne albo bez danych (`dropped`). To
   szerszy warunek niż flaga (łapie każdą zgubioną daną renderu). Opcjonalny eksport flagi - w
   out_of_ownership.
2. **Zamrożenie werdyktu przed `QueryCache.clear()`.** Wymuszone kolejnością `transformStreamWithRouter`
   -> `serverSsr.cleanup()` -> integracja `clear()` przed odczytem `done` przez kolektor. Podmiana metody na
   instancji cache'u jednego żądania (serwer), komentarz w module. Gdyby przyszła wersja integracji
   przestała czyścić cache, werdykt liczy się na żywo (nadal poprawnie).
3. **Wyjątek dla dekoracji (`ad_placements`).** Plan wymienia tylko celowe zasiewy. Doktryna korzenia mówi
   wprost, że brak reklamy nie może kosztować cache'u całego serwisu, a reklama nie wchodzi do listy
   gotowości chrome'u. Bez wyjątku błąd albo wolna emisja reklamy blokowałyby zapis strony głównej.
4. **B2 z krótką polityką wspólną (30 s / 300 s), nie pełną.** Dokument jest kompletny, ale nie kanoniczny:
   hero dostrumieniował się po flushu (szkielet sekcji w powłoce i podmiana skryptem), a preload obrazu LCP
   i nagłówek `Link` liczone w loaderze go nie znają (`builderHeroPreloads` potrzebuje danych). Ta sama
   klasa co chrome po flushu. Pierwszy czytelnik zasiewa L1/L2, a pierwsze STALE uruchamia odświeżenie,
   które daje render czysty z pełną polityką. Pełna świeżość utrwalałaby dokument bez preloadu na 3 min
   i dobę STALE.
5. **„Lista celowych zasiewów" jako jawna deklaracja w miejscu zasiewu** (`markDeliberateSeed`), nie tablica:
   wyjątek obejmuje tylko to, co naprawdę zasiano w tym żądaniu.
6. **(c) obejmuje też `warm()` zakończone z resztką terminu bez danych** (tylko strona główna): wspólny budżet
   bramki 1,2 s od pierwszego odczytu. Dotąd taki nagłówek renderował się na fallbackach, a dokument szedł
   do magazynu z polityką 30 s - niekompletny.
7. **`degradedBy` tylko przy `degraded: true`.** Degradacja motywu korzenia na stronie głównej (pętla
   anulowania fali 1) nie ma etykiety - te linie korzenia są poza listą pliku.
8. **`home.archive` (tryb „najnowsze wpisy") zostaje przy 600 ms** (zakres planu: strona + tryb). Produkcja
   jest w trybie strony statycznej.

## 5. Ryzyka

- **Konserwatywny predykat.** Każde systematyczne `error` na niedekoracyjnym zapytaniu pobieranym przy `/`
  wyłącza zapis strony głównej (każdy czytelnik płaci MISS, ratuje go tylko odświeżenie w tle z limitem
  2 prób / 10 min). Fixture: zero błędów na czystym renderze. Po wdrożeniu: Workers Logs
  `kind=doc path=/ store=degraded degradedAt=stream` + `degradedBy` pokażą klucz od razu.
- **Złączenie z P3.8.** Jeśli P3.8 grzeje w fali chrome'u zapytanie dekoracyjne (np. obecność popupów) albo
  zasiewa coś celowo z `updatedAt: 0`, trzeba je dopisać do `DECORATIVE_QUERY_ROOTS` albo
  `markDeliberateSeed`. Po scaleniu partii 2: sonda `base-probe/probe.sh artifact-boot` na artefakcie musi
  dać MISS -> HIT (harness Lighthouse i tak przerwie się przy braku HIT-u).
- **TTFB MISS:** treść czeka do 1,2 s (tylko gdy jest wolna); granica nagłówka do 1,2 s od pierwszego odczytu
  bramki (treść trasy jest rodzeństwem i flushuje się bez czekania). Boty (`allReady`) zapłacą to w TTFB
  takiego MISS-a. Plan to akceptuje.
- **Bajty klienta:** nowe ścieżki są za `isServer` / `import.meta.env.SSR` albo w implementacjach
  serwerowych `createIsomorphicFn`. Na kliencie zostaje ~kilkadziesiąt bajtów (ternary nagłówka w loaderze
  `/`, `markFailed`). Zapas zamknięcia bootu: 0,6 KB gz - do zmierzenia w Prove.
- **Semantyka sondy `degraded:![01]`** zmieniła się dla B2 (teraz `!1`).

## 6. Dla etapu Prove

1. Build worktree (`env BUNDLE_INVENTORY=1 bun run build:smoke` pod mutexem), bramki artefaktu,
   `check:document-weight`, `test:e2e:artifact` (zwykły i CI-like z `NES_ARTIFACT_FIXTURE=1`), Lighthouse
   A/B bez regresji (lokalnie L1 zawsze HIT, więc oczekiwana zmiana wyniku ~0).
2. Smoke na artefakcie (nie wymaga zmian w skryptach), `scratchpad/phase3/wave3/P3.6b/base-probe/probe.sh`:
   - `ARTIFACT_ROOT=<wt3/P3.6b> probe.sh slow-first-fold 4393 B-slow` - oczekiwane: żądanie 1 MISS
     z `cache-control: public, max-age=0, s-maxage=30, stale-while-revalidate=300`, linia `doc`
     `degraded:false, store:"stored"` BEZ linii `revalidation:true`; żądanie 2 HIT z wpisu czytelnika.
     Baza (A, już zmierzona): `private, no-store`, `degradedAt:"loader"`, HIT dopiero z odświeżenia w tle.
   - `ARTIFACT_ROOT=<wt3/P3.6b> probe.sh artifact-boot 4394 B-clean` - MISS z pełną polityką -> HIT
     (predykat nie blokuje czystego renderu).
   - Typ A na artefakcie wymaga przypadku fixture z opóźnieniem strony ≥ 1,5 s (out_of_ownership,
     `scripts/performance/replayFetch.mjs`); do tego czasu typ A dowodzi smoke w procesie i testy trasy.
3. Weryfikacja produkcyjna po wdrożeniu: seria curl `/` z kolonii IAD (jak w diagnozie §1) - odsetek
   `degraded:!0` na zimnych MISS-ach ma spaść (typ A znika przy treści < 1,2 s), a Workers Logs pokażą
   `store:"stored"` na MISS-ach B2/B1 i `degradedBy` na pozostałych.

## 7. Na co patrzeć w recenzji

- Reguły predykatu i punkt uzbrojenia (`trackSsrQueryCompleteness`, koniec loadera `/`) - czy nie ma
  w renderze strony głównej pobrań typu „wystrzel i zapomnij", które kończyłyby w `dropped`.
- Podmiana `cache.clear` (kolejność `cleanup()` w `router-core/ssr/transformStreamWithRouter.js:264-266`
  i `router-ssr-query-core/dist/esm/index.js:13-31`).
- `readChromeWarmup`: przepływ obietnicy (`first` -> `lateWarm` -> `ready()`), brak `failed` dla tras bez
  `warmLate`.
- Lista pracy `warmLate` w korzeniu wobec `warm` (menu, ticker, reklama, widgety nagłówka/stopki).
- Decyzja o krótkiej polityce dla B2 (odstępstwo 4) i wyjątek dekoracji (odstępstwo 3).

Logi: `scratchpad/phase3/wave3/P3.6b/` (`typecheck.log`, `verify-static.log`, `vitest-related.log`,
`vitest-ci.log`, `prod-probe/`, `base-probe/`, `commit-msg.txt`).

## 8. Stan po wznowieniu sesji (2026-10-08, po limicie użycia)

Harness wznowił etap implementacji po przerwie. Worktree `wt3/P3.6b` już istniał, więc go nie odtwarzałem.
Najpierw sprawdziłem jego stan.

- Gałąź `perf/w3-P3.6b`, HEAD **`1d452919`** (runda 9) nad `80ce4d2b` (ten raport) i `d22cf7d6`. Drzewo jest
  czyste: brak niezacommitowanych zmian, historia bez przepisywania.
- Po `80ce4d2b` odbyły się już kolejne etapy:
  - recenzja: `REVIEW.md`, APPROVE, 0 blokujących;
  - Prove: `PROVE.md`. Smoke na artefakcie spełnił dowód (B1/B2 zapisane, typ A i wyczerpana bramka nie),
    e2e przeszło 12/12, Lighthouse bez regresji. Jedyne ustalenie needs_fix: +298 B raw / +51 B gz domknięcia
    bootu;
  - runda 9 (`IMPL-fix9.md`): domknięcie `warmLate` i `markDeliberateSeed` w `__root.tsx` przeszły za bramkę
    `import.meta.env.SSR` zamiast `isServer`, więc kod tylko serwerowy wypada z chunku wejściowego klienta.
    Doszedł też test zachowania z mutacją.
- Bramki rundy 9 uruchomiłem na treści `1d452919`. Pliki zmieniono o 18:21–18:22, a bramki ruszyły później:
  - typecheck (`typecheck-noinc.sh` pod mutexem): exit 0;
  - vitest: 12 plików / 430 testów;
  - `verify:static`: 15 bramek OK, w tym `format:check`.
- Po wznowieniu powtórzyłem lekką kontrolę: vitest `rootRoute`, `documentCompleteness` i
  `documentCompletenessPipeline` dał 3/3 pliki, 101/101 testów (`vitest-resume.log`).
- Nowy commit planu na gałęzi PR (`56da8d23`, specyfikacje partii 3–5) nie dodaje wymagań dla P3.6b. Wynika
  z niego tylko jeden warunek dla P3.7b: predykat kompletności P3.6b nie może czytać `heroPreloads`. Ten
  warunek jest spełniony, bo `trackSsrQueryCompleteness` patrzy wyłącznie na cache zapytań `QueryClient`.
- Do potwierdzenia na buildzie `1d452919` (etap Prove): `bootClosureRawBytes`/`GzipBytes` w
  `check:document-weight` i linia `Boot closure` w `check:bundle` mają wrócić do bazy. `.output` w worktree
  pochodzi z `80ce4d2b`.
