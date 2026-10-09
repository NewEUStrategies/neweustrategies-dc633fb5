# P3.6a, runda poprawek 10 (orkiestratora): build id ze stałej Vite, build w kluczu migawek, usuwanie zdjętych wpisów, nonce rewalidacji, R7 w linii `doc`

Worktree: `scratchpad/wt3/P3.6a`, gałąź `perf/w3-P3.6a`, nowy commit `fbbce0d2` (nad `af98a5a8`, bez przepisywania
historii). Na starcie rundy worktree był czysty, bez niezatwierdzonych zmian. Wejście: ustalenia orkiestratora
(`r1/PROVE.md`, `r1/REVIEW.md`), rozszerzona lista plików tej rundy.

## 0. Werdykt w skrócie

Zamknięte wszystkie ustalenia: cztery blokujące i jedno major.

| #   | ustalenie                                                   | stan                                                                                                    |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | (blokujące) `check:bundle` / `check:entry-purity` czerwone  | dynamiczny import `bootManifest` usunięty; build id ze stałej `define` Vite, oba presety identycznie    |
| 2   | (blokujące) MAJOR-1: migawki L2 bez buildu w kluczu         | `snapshotKey` = `edge:<build>:v<g>.<h>:<host>::<klucz>`; build PROD bez id wyłącza warstwę              |
| 3   | (blokujące) MAJOR-2: zdjęty/przeniesiony wpis STALE do 24 h | ostateczne 404/410/3xx odświeżenia usuwa wpis z L1 i L2 (`l2Delete`); komentarze poprawione             |
| 4   | (blokujące) nonce `nes-0` (bezpieczeństwo, produkcja)       | nonce losowany leniwie w zakresie żądania, bez przewidywalnego fallbacku; bez losowości rewalidacja off |
| 5   | (major) R7 b, c w linii `kind:"doc"`                        | `l2Verified` i `degradedAt` (loader/handler/stream)                                                     |

Skrypty bramek są bez zmian. Łatki `fix9-gates-scan-ssr.patch` nie zastosowałem. Build, bramki artefaktu, e2e
artefaktu i smoke dwóch izolatów zostawiam etapowi Prove (§6).

## 1. Zmiany plik po pliku

### `vite.config.ts`, `vite.smoke.config.ts` (identyczny blok)

- Stała `NES_BUILD_ID` jest liczona RAZ przy ładowaniu konfiguracji:
  `(process.env.LOVABLE_BUILD_ID || \`t${Date.now().toString(36)}\`)`, przycięta do `[A-Za-z0-9_-]`i do 64 znaków.
Wartość jest wspólna dla klienta i serwera jednego`vite build`, a inna w każdym buildzie.
- W `vite:` dochodzi `define: { __NES_BUILD_ID__: JSON.stringify(NES_BUILD_ID) }`.
  - `mergeConfig` z `@lovable.dev/vite-tanstack-config` scala `define` głęboko, więc `envDefine` (VITE_*) zostaje.
  - Vite 7.3.6 przenosi top-level `define` do każdego środowiska (`getDefaultEnvironmentOptions` + `mergeConfig`,
    `vite/dist/node/chunks/config.js:35418-35586`), także do środowiska `nitro`, które ma własne
    `define: { "process.env.NODE_ENV" }` (`nitro/dist/_build/vite.env.mjs:31`).
  - `vite:define` działa dla konsumenta `server` w dev i w buildzie (`config.js:26571`).
  - Pośredni dowód na buildzie bazy: w `.output/server` nie ma ani jednego `import.meta.env`, czyli ten sam plugin
    podmienia tam stałe.
- W `vite.config.ts` blok stoi za `Object.assign(process.env, loadEnv(...))`, więc widzi też `.env`. Smoke nie
  ładuje `.env`. Różnica jest więc tylko wtedy, gdy `LOVABLE_BUILD_ID` jest w `.env`, a nie w środowisku procesu.
  Dziś jej nie ma.
- Klient stałej nie czyta. Moduł L2 nie jest w grafie klienta (na buildzie bazy `.output/public` nie zawiera
  `nes-edge-cache.internal`), a odczyt i tak stoi za `import.meta.env.SSR`. Hashe chunków klienta się nie zmieniają.

### `src/lib/http/documentCacheL2.server.ts`

- Usunięte: dynamiczny import `@/lib/boot/bootManifest`, `documentBuildId()`, `buildIdFromEntry()`, stan `buildId`
  i jego reset. Chunk manifestu Start wraca na najwyższy poziom `.output/server`, jak na bazie (§6 kontrola 1).
- Nowe `export function l2BuildId(): string | null`. Jest synchroniczne i bez memo, bo po buildzie to literał.
  - Czyta `__NES_BUILD_ID__` tylko za `import.meta.env.SSR` i przez `typeof`, więc vitest nie zna stałej.
  - Przycina wartość jak konfiguracja.
  - Bez stałej zwraca `dev`, a w PROD `null`, co wyłącza L2 dokumentów i migawek.
  - Odczyt `import.meta.env` jest w `try`. W buildzie to literały, ale w vitest bez globalnego `process`
    (`documentCache.server.test.ts`, „workerd bez nodejs_compat") sam odczyt rzucał `ReferenceError`.
- Deklaracja typu jest w module: `declare const __NES_BUILD_ID__: string | undefined;`. Uzasadnienie w §4.
- `l2Stats().build` = `l2BuildId()`.
- Nowe `l2SelfTestVerified(): boolean | null` dla linii logu. Mapuje `l2SelfTestLabel()` (true/false po
  rozstrzygnięciu, null w toku albo gdy nie dotyczy) i niczego nie otwiera.
- Nagłówek modułu:
  - opis buildu w kluczu dotyczy teraz stałej, dokumentów i migawek;
  - „Zakres spójności" opisuje usuwanie zdjętych wpisów (MAJOR-2) w miejsce dawnego „należy do P3.6b".

### `src/lib/ssrCacheL2.server.ts` (MAJOR-1)

- `snapshotKey()` zwraca `edge:${build}:v${g}.${h}:${scope}::${key}` albo `null`, gdy `l2BuildId()` jest null.
- `enabled()` wymaga też `l2BuildId() !== null`. `read`/`write` przy `null` adresie są no-opem.
- Nagłówek opisuje nazwany cache (było `caches.default`) i build w kluczu: dlaczego (okno serve-stale chrome to doba)
  i czego to nie dotyczy (`bootstrapCache` ma stały kształt).

### `src/lib/http/documentCache.server.ts`

**Nonce (bezpieczeństwo, §2)**

- `REVALIDATE_NONCE` (IIFE w zasięgu modułu) zastępuje leniwe `revalidationNonce()`:
  - losuje przez `crypto.randomUUID()`, a gdy go nie ma, 16 bajtów z `getRandomValues`;
  - zapamiętuje tylko udane losowanie;
  - nie ma przewidywalnego fallbacku.
- `isRevalidationRequest()` jest teraz eksportowane. Porównuje wyłącznie z JUŻ wylosowanym nonce'em, więc dopóki
  izolat nic nie wylosował, każdy znacznik jest obcy (także `nes-0` i pusty). Sam odczyt niczego nie losuje.
- `revalidationHeader()` zwraca `[string, string] | null`. Null oznacza brak losowości, czyli rewalidacja wyłączona.
- `scheduleRevalidation()` nie planuje odświeżenia bez nonce'a. Losowanie zachodzi tu, w zakresie żądania
  czytelnika. Wpis zostaje wtedy STALE do końca okna swr, czyli zachowanie jak przy porażce odświeżenia.

**MAJOR-2**

- `isFinalGoneResponse()`: 404, 410 albo 3xx z `Location` (bez 304).
- `evictGoneDocument(host, key)`: usuwa wpis z L1 od ręki i z L2 przez `runAfterResponse(l2Delete(...))`, podbija
  licznik `goneEvictions`.
- `decorateMissAndDeferStore(..., refreshesEntry)` usuwa wpis tylko przy renderze, który odświeża ISTNIEJĄCY wpis:
  - żądanie z nonce'em izolatu (odświeżenie w tle);
  - synchroniczny render po STALE bez drivera (L1 i L2).

  Zwykły MISS (np. 404 skanera) nie dotyka Cache API.

- Pierścień decyzji dostaje `evicted: true`. Migawka dostaje `goneEvictions` (opcjonalne w typie, jak
  `degradedRevalidations`).
- Dlaczego decyzja zapada w middleware, a nie w `src/server.ts`: tylko tu są `host`, klucz planu i odpowiedź routera.
  Przekierowania z middleware PRZED cache'em (reguły przekierowań, negocjacja języka strony głównej, `?lang=`) tu nie
  docierają. To dobrze, bo dla nich czytelnik i tak nie dostaje wpisu: odpowiada im middleware wyżej. Szczegóły
  w komentarzu funkcji.
- „Niezdegradowane": 404 z tras powstaje WYŁĄCZNIE z czystego odczytu (`routes/$.tsx:377-394`, `notFoundIfClean.ts`,
  audyt F07/W8), a degradacja daje 200 z `private, no-store`, które wpisu nie usuwa. Dyrektywa trasy `no-store` NIE
  jest sygnałem degradacji dla 404/3xx. Trasy celowo ustawiają `NO_STORE` przy `notFound()` i przekierowaniu
  (`$.tsx:345-349`, `:419-428`), więc taki warunek wyłączyłby całą poprawkę.

**R7c**

- `applyDeferredDocumentStore(..., onOutcome)` przekazuje przy `degraded` drugi argument: etap `handler` albo
  `stream` (typ `LateDegradationStage`).
- Typ `degradedAt` w pierścieniu = `DegradationStage` z `ssrTiming.ts`.

Nagłówek „Spójność publikacji" opisuje usuwanie zdjętych wpisów.

### `src/lib/http/documentCache.ts`

- Komentarz `DOCUMENT_CACHE_MAX_SWR_MS` (dawne :50-55) opisywał serwowanie STALE jako „bezpieczne z konstrukcji".
  Teraz rozróżnia dwa przypadki w koloniach bez purge'a:
  - aktualizacja: odświeżenie nadpisuje wpis;
  - zdjęcie albo przekierowanie: ostateczne 404/410/3xx usuwa wpis z L1 i L2.

  Zdjęty dokument żyje więc w kolonii najwyżej przez czas jednego odświeżenia, plus po jednym trafieniu STALE na
  każdy izolat, który trzymał go we własnym L1.

- Komentarz `NES_REVALIDATE_HEADER` mówi o leniwym losowaniu i braku fallbacku.

### `src/server.ts`

- `revalidateDocument()` pobiera `revalidationHeader()` i przy `null` zwraca `false` bez renderu (druga zapora).
  `revalidationHeaders(request, marker)` dostaje znacznik parametrem.
- Komentarz przy `if (!pending) return false` (dawne :296-299) opisuje, że 404/410/3xx usunął middleware, a STALE
  zostaje tylko przy `no-store`/5xx.
- `logDocument()`:
  - `revalidation: isRevalidationRequest(request)`: porównanie bez losowania (dawniej `revalidationHeader()`, które
    teraz losuje);
  - `degradedAt`: `degradationStage(degraded, timing)` daje `handler`/`stream` z decyzji magazynu, a degradacja
    widoczna tylko w nagłówkach to `loader`, czyli ta sama definicja co pierścień;
  - `l2Verified: l2SelfTestVerified()`.
- `TrackedStore.lateDegradation` i `logOnce(storeOutcome, lateDegradation)` niosą etap z `onOutcome` na obu
  ścieżkach: czytelnika i odświeżenia w tle.

### `src/lib/http/ssrTiming.ts`

- Typy `DegradationStage` (`loader` | `handler` | `stream`) i `LateDegradationStage`, zamknięty słownik
  `DEGRADATION_STAGES`.
- `DocumentLogLine`: `degradedAt?` (tylko przy `degraded: true` i tylko ze słownika) oraz `l2Verified?` (tylko
  boolean; brak klucza, gdy samotest trwa albo nie dotyczy).
- `DocumentLogInput`: odpowiednie pola wejściowe.

### Testy

- `documentCacheL2BuildId.test.ts` (przepisany). Stała jest podstawiana przez `vi.stubGlobal("__NES_BUILD_ID__")`
  (w vitest wolny identyfikator czyta się z `globalThis`). Sprawdza:
  - klucz z build id;
  - nowy deploy nie widzi HTML-a starego, a ten sam build po rotacji izolatu widzi;
  - przycinanie znaków i długości;
  - PROD bez stałej daje L2 dokumentów off;
  - pusta stała w PROD daje null;
  - poza SSR stała jest ignorowana;
  - `dev` nie zależy od zegara.

  Test „nieudany odczyt mapy nie jest zapamiętywany" usunąłem, bo nie ma już importu.

- `ssrCacheL2.server.test.ts`:
  - oczekiwane klucze `edge:dev:v0.0:...`;
  - nowy blok „build w kluczu migawki": segment przed wersjami; migawka poprzedniego deployu jest nieosiągalna, a ten
    sam build po rotacji ją widzi; PROD bez stałej wyłącza warstwę.
- `revalidationNonce.test.ts` (nowy, świeży moduł w każdym teście). Sprawdza:
  - import w atrapie zakresu globalnego workerd (`randomUUID`/`getRandomValues` rzucają, `Date.now()` = 0) niczego
    nie losuje, a `nes-0` nie jest znacznikiem;
  - nonce powstaje dopiero w zakresie żądania, ma kształt UUID i jest stały w izolacie;
  - sprawdzenie znacznika nie losuje;
  - `nes-0`, `""`, `"0"`, `"1"`, obcy UUID, nonce wielkimi literami i nonce bez pierwszego znaku dają HIT bez
    renderu, a tylko prawdziwy nonce wymusza render;
  - bez losowości: `revalidationHeader()` = null, driver nie jest wołany, STALE dla braku, `nes-0` i pustego
    znacznika, `revalidations` = 0.
- `revalidationNonceDriver.test.ts` (nowy, osobny plik dla świeżego modułu z przechwyconym driverem). Driver
  z `src/server.ts` bez losowości zwraca `false` i nie woła entry. Z losowością wystawia żądanie z nonce'em, który
  `isRevalidationRequest` uznaje, a `nes-0` nadal nie przechodzi.
- `documentCacheGoneEviction.test.ts` (nowy). Prawdziwy potok `src/server.ts` (driver, odroczony zapis) nad
  funkcjonalnym nazwanym cache'em:
  - 404, 410, 301 i 307 z odświeżenia w tle: czytelnik dostaje jeszcze STALE; potem wpis znika z L1 i L2
    (`delete` 1x, brak kluczy `/__nes/doc/`), `goneEvictions` = 1, `evicted` w pierścieniu; kolejny czytelnik i inny
    izolat dostają MISS;
  - negatywne: 200 `no-store`, 503, 304 i render, który rzuca, zostawiają wpis STALE bez `delete`; zwykły MISS 404
    nie woła `delete`;
  - bez drivera synchroniczny render 404 też usuwa wpis.
- `documentLogTelemetry.test.ts` (nowy, przez `src/server.ts`):
  - czysty MISS nie ma etapu;
  - `loader`;
  - `handler` (dyrektywa zawężona za middleware: `store: degraded`);
  - HIT bez `degraded` i bez etapu;
  - `l2Verified`: brak bez Cache API, `true` po samoteście nazwanego cache'u, `false` dla magazynu, który nic nie
    oddaje.
- `ssrTiming.server.test.ts`: jednostkowo `l2Verified` (true/false/null/brak) i `degradedAt` (tylko przy `degraded:
true`, tylko ze słownika).
- `documentCacheDegradationStage.test.ts`: `onOutcome` dostaje `("degraded","handler")`, `("degraded","stream")`
  i `("stored")` bez etapu.
- `serverEntryRequestOptions.test.ts`:
  - dokładna linia dostaje `degradedAt: "loader"`;
  - linie ze strumieniowym zawężeniem dostają `degradedAt: "stream"`, także linia odświeżenia w tle;
  - `revalidationHeader()!`.
- `viteChunkParity.test.ts`: identyczny blok `NES_BUILD_ID` i identyczne `define` w obu presetach.
- Dopasowania typu do `revalidationHeader()` (`!`):
  - `documentCache.server.test.ts`;
  - `platformDeferredCache.test.ts`;
  - `platformServerFailures.test.ts`, gdzie atrapa modułu dostała `isRevalidationRequest`.

Kontrola mutacyjna (pliki przywrócone z kopii, drzewo czyste):

- `evicted = false && ...` w `decorateMissAndDeferStore`;
- `snapshotKey` bez segmentu buildu.

Pada 9 testów: 5 w `documentCacheGoneEviction`, 4 w `ssrCacheL2.server` (`fix10/mutation.log`). Dawny kod nonce'a
(IIFE z fallbackiem) oblewa pierwszy test `revalidationNonce`: `randomUUID` jest wołane przy imporcie, a `nes-0`
jest znacznikiem.

## 2. Bezpieczeństwo: co omijało żądanie z poprawnym nonce'em i jakie ryzyko znika

Mechanizm na produkcji:

- `documentCache.server.ts` jest w bundlu serwera (`_ssr/index.mjs`), a IIFE nonce'a jest w zasięgu modułu. Na
  buildzie bazy widać to dosłownie: `be=(()=>{try{return globalThis.crypto.randomUUID()}catch{return`nes-${Date.now().toString(36)}`}})()`.
- workerd wykonuje kod w zasięgu modułu poza kontekstem żądania. Tam `randomUUID` rzuca („Disallowed operation called
  within global scope"), a zegar stoi na 0.
- Ten sam wzorzec w `routes/api/public/version.ts` daje na produkcji `rt-0`. Nonce = `nes-0`.

Produkcji nie sondowałem: hosting zdejmuje `x-nes-cache`, a sonda byłaby wykorzystaniem podatności.

Co dawało żądanie z zewnątrz z `x-nes-revalidate: nes-0` (ścieżka `handleDocumentRequest`):

1. **Pomijało odczyt L1 i L2** (`entry = revalidation ? undefined : ...`, `l2Match` pominięte) i **wymuszało pełny
   render SSR**: loadery, chrome, zapytania do Supabase, CPU izolatu. Każde takie żądanie to MISS na życzenie, więc
   cache dokumentów przestawał chronić bazę. Wystarczała pętla `curl`.
2. **Zapisywało wynik** do L1, a z działającym L2 (P3.6a) także do L2 kolonii. Zapis szedł przez
   `decorateMissAndDeferStore` + `applyDeferredDocumentStore` na ścieżce tego żądania. Render powstawał z nagłówkami
   atakującego, np. UA bota, a router oddaje botom wariant buforowany. Wariant atakującego nadpisywał więc wpis dla
   wszystkich czytelników kolonii na całe okno świeżości. To dokładnie problem R6, ale wywołany z zewnątrz.
3. **Pomijało planowanie odświeżenia po degradacji i licznik prób** (`scheduleDegradedRevalidation` zwraca
   `undefined` dla rewalidacji).
4. **Fałszowało telemetrię**: nie liczyło się do `misses`, a linia `doc` miała `revalidation: true`. Ruch ataku
   wyglądał jak wewnętrzne odświeżenia i wypadał z rozkładów TTFB/MISS.
5. Po MAJOR-2 podrobione odświeżenie mogłoby też uruchamiać usuwanie wpisu przy 404/3xx. Odpowiedź routera jest
   jednak ta sama dla czytelnika, więc realnie bez szkody. Mimo to poprawka nonce'a zamyka i to.

Czego NIE omijało: `planDocumentCache` (BYPASS sesji, deny-lista ścieżek, nieznane query), walidacja hosta
(`trustedPublicHost`), middleware przed cache'em. Przestrzeń kluczy atakującego była więc ta sama co czytelnika.

Po poprawce:

- nonce jest losowy (UUID) i istnieje dopiero po pierwszym zaplanowanym odświeżeniu w izolacie;
- porównanie nie losuje;
- przewidywalnego fallbacku nie ma.

Gdyby runtime nie dał losowości także w zakresie żądania, rewalidacja w tle jest wyłączona i nagłówek ignorowany.
Na koszt świeżości: wpis zostaje STALE do końca okna swr, jak przy porażce odświeżenia. Zdejmowania nagłówka
z żądań przychodzących nie dodawałem: przy niezgadywalnym nonce'u nie jest potrzebne.

## 3. Bramki tej rundy

| bramka                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | wynik                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `bunx prettier --write` / `--check` (21 plików)                                                                                                                                                                                                                                                                                                                                                                                                                               | zielone                                                          |
| `light.sh bunx eslint` (21 plików)                                                                                                                                                                                                                                                                                                                                                                                                                                            | 0 problemów (`fix10/eslint.log`)                                 |
| `light.sh bunx vitest run src/lib/http/__tests__ src/lib/__tests__/ssrCacheL2.server.test.ts src/lib/__tests__/ssrCacheL2.test.ts src/lib/ci/__tests__/viteChunkParity.test.ts src/lib/__tests__/edgeCacheFunctions.test.ts src/components/admin/performance/__tests__/edgeCacheCard.test.tsx src/__tests__/serverEntryRequestOptions.test.ts src/__tests__/platformServerFailures.test.ts src/__tests__/startPipeline.test.ts src/lib/boot/__tests__/bootSet.server.test.ts` | 42 pliki / 824 testy zielone (`fix10/vitest.log`)                |
| kontrola mutacyjna (eviction, build w kluczu migawki)                                                                                                                                                                                                                                                                                                                                                                                                                         | 9 testów pada na mutacji (`fix10/mutation.log`), kod przywrócony |
| `light.sh bun run verify:static`                                                                                                                                                                                                                                                                                                                                                                                                                                              | 15 bramek OK (`fix10/verify-static.log`)                         |
| typecheck (mutex, `heavy-bg.sh` + `tools/typecheck-noinc.sh`: tsgo bez inkrementacji, `typecheck:scripts`, `typecheck:e2e`, czyli także oba presety Vite)                                                                                                                                                                                                                                                                                                                     | zielony (`fix10/typecheck.log`)                                  |
| build, `check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity`, `test:e2e:artifact`, document-weight, smoke dwóch izolatów                                                                                                                                                                                                                                                                                                                          | nie uruchamiane (etap Prove, §6)                                 |

Logi: `scratchpad/phase3/wave3/P3.6a/fix10/`.

## 4. Odstępstwa i decyzje

- **Deklaracja typu stałej w module, nie w `src/types/buildId.d.ts`.** Lista dopuszczała oba warianty.
  - `declare const __NES_BUILD_ID__` w `documentCacheL2.server.ts` nie zaśmieca globalnej przestrzeni typów.
  - Działa w każdym programie TS, który zaimportuje moduł, także w `tsconfig.scripts.json`, który nie obejmuje
    `src/types`.
  - Po transformacji TS identyfikator jest wolny, więc `define` (esbuild) go podmienia.
- **R7c: „przyczyna" = etap.** Linia niesie `degradedAt` (loader/handler/stream). KTÓRY loader się zdegradował
  (`degradedBy` z etykiet `loadResilient`/chrome) wymaga rejestru w `src/lib/ssr/resilientLoad.ts`
  i `src/lib/ssr/chromeWarmup.tsx`, które są poza listą (P3.6b). Do tego czasu korelacja idzie przez linię
  `[ssr-resilient] ... for <etykieta>` z tego samego wywołania. To jest w `out_of_ownership_needs`.
- **R7b: tylko `l2Verified`.** Magazyn (`named`/`default`) jest w linii `kind:"l2"` raz na izolat i w Server-Timing
  `nes-l2`. Nie dublowałem go w każdej linii `doc`.
- **Usuwanie po 404/410/3xx zapada w middleware, nie w `src/server.ts`.** Wskazanie z ustalenia (`server.ts:296-299`)
  to miejsce, gdzie powstaje decyzja „nie zapisuję". Usunięcie wymaga jednak klucza planu, hosta i odpowiedzi
  routera, które są w middleware. Komentarz w `server.ts` opisuje nowy podział. Obejmuje to też synchroniczny render
  po STALE bez drivera (ta sama sytuacja).
- **Kryterium „niezdegradowane" bez dyrektywy trasy.** Uzasadnienie w §1 (trasy celowo dają `NO_STORE` przy 404
  i przekierowaniu). Opieram się na inwariancie „404 tylko z czystego odczytu" (F07/W8).
- **Nie zmieniałem memo OBIETNICY wersji w `ssrCacheL2.readVersion`** (obserwacja 2 recenzji r1, spoza listy
  ustaleń tej rundy).
  - Ryzyko: żądanie B czeka na `cache.match` rozpoczęte w kontekście A, a workerd potrafi anulować kontynuację, gdy A
    się skończy.
  - Skutek ogranicza termin odczytu L2 150 ms (`EDGE_TTL_L2_READ_TIMEOUT_MS`): migawka z bazy zamiast z L2, bez
    błędu.
  - Zmiana na memo wartości zmienia model kosztu, który przypina test („równoległe odczyty dzielą dwa match()
    wersji"). Wymaga też per-żądaniowego współdzielenia lotu (`getRequest()`), czyli szerszej zmiany niż ta runda.

  Do decyzji orkiestratora.

- **`stats.startedAt` w zasięgu modułu** (`new Date()` w workerd daje 1970-01-01). To telemetria karty, bez wpływu na
  działanie. Zostawiłem.
- **Brak d.ts i brak zmian w skryptach bramek**, zgodnie z poleceniem rundy.

## 5. Ryzyka

- **`define` nie dotrze do kodu serwera** (np. inny preset Nitro). Wtedy `typeof` daje `undefined`, a w PROD
  `l2BuildId()` = null i L2 dokumentów oraz migawek jest wyłączone. To stan sprzed P3.6a, nie stary HTML. Prove ma to
  wykluczyć grepem artefaktu (§6, kontrola 2).
- **Build id = czas buildu.** Dwa buildy tego samego commita mają różne klucze, więc każdy deploy (także
  ponowiony) zaczyna z pustym L2 kolonii. To świadome: obejmuje też deploye zmieniające wyłącznie serwer (MINOR-2
  recenzji r1 zamknięty). `LOVABLE_BUILD_ID`, jeśli hosting go poda przy buildzie, ma pierwszeństwo.
- **Usuwanie wpisu po 3xx:**
  - przekierowanie trasy zależne od nagłówków odświeżenia (np. ciasteczko języka) usunęłoby wpis, który dla innych
    czytelników jest poprawny;
  - w kodzie takich przekierowań tras nie znalazłem: język i reguły są w middleware przed cache'em;
  - skutek byłby i tak tylko utratą trafienia: następny czytelnik płaci MISS i zasiewa wpis, a niepoprawna treść nie
    jest podawana.
- **404 z trasy, która łamie inwariant „404 tylko z czystego odczytu"** usunęłaby poprawny wpis przy czkawce bazy.
  Ta sama trasa podałaby jednak takie 404 każdemu czytelnikowi na MISS, więc błąd leżałby w trasie, nie tutaj.
- **Kolejność odczytu nonce'a w logu.** Linia `doc` dla żądania, które przyszło przed pierwszym losowaniem, ma
  `revalidation: false`. To poprawne: izolat nie wystawił jeszcze żadnej rewalidacji.

## 6. Na co ma spojrzeć recenzent / co ma zrobić Prove

1. Build (`bun run build`) i bramki ze skryptami BEZ zmian: `check:bundle`, `check:entry-purity`, `check:chunks`,
   `check:server-entry-purity`, document-weight, `test:e2e:artifact`. Oczekiwane:
   - chunk manifestu na najwyższym poziomie (`.output/server/_tanstack-start-manifest_v-*.mjs`), brak
     `_ssr/bootManifest-*.mjs`;
   - boot closure jak na bazie (~486.8 KB gz).
2. Grep artefaktu:
   - `grep -r "__NES_BUILD_ID__" .output/server` nic nie zwraca;
   - literał build id (`t<base36>` albo `LOVABLE_BUILD_ID`) jest w chunku z `nes-edge-cache.internal`;
   - `grep -r "__NES_BUILD_ID__\|nes-edge-cache.internal" .output/public` nic nie zwraca;
   - hashe zasobów klienta takie jak przy tym samym commicie bez zmian w kodzie klienta (porównanie
     `cmp-assets` z r1).
3. Smoke dwóch izolatów z atrapą Cache API, jak `r1/prove2`:
   - HIT z L2 pod kluczem `/__nes/doc/<build>/...`;
   - po zmianie build id brak HIT. Dwa buildy z `LOVABLE_BUILD_ID=a` i `=b` albo jeden build z podmianą literału
     w chunku serwera;
   - test nonce'a: żądanie z `x-nes-revalidate: nes-0` na świeżym wpisie daje HIT, nie MISS;
   - (opcjonalnie) zdjęcie: wpis STALE, render 404, potem `delete` w atrapie i MISS na drugim izolacie.
4. Procedura produkcyjna po wdrożeniu (r1 IMPL §7) z dopiskiem MAJOR-2: zdjęcie wpisu, potem inna kolonia, potem po
   pierwszym STALE kolejne żądanie bez starej treści. Do tego linie `doc` z `l2Verified`/`degradedAt`.
5. Lighthouse tylko jako kontrola regresji. Zmiana jest serwerowa; dokument i chunki klienta się nie zmieniają.
