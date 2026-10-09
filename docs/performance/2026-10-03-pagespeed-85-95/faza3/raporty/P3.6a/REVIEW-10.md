# Recenzja P3.6a, runda 10: build id ze stałej Vite, build w kluczu migawek, usuwanie zdjętych wpisów, nonce rewalidacji, R7 w linii `doc`

- Worktree: `scratchpad/wt3/P3.6a`, gałąź `perf/w3-P3.6a`, HEAD `fbbce0d2`.
- Diff: `claude/zen-ritchie-hzur21...HEAD`, czyli trzy commity: r1 `01670c0a`, fix9 `af98a5a8`, fix10 `fbbce0d2`.
- Podstawa oceny:
  - PLAN-FALI-3 §2 P3.6a;
  - `faza3/diagnoza/cache-dokumentu.md` R1/R6/R7;
  - notatki orkiestratora rundy 10 (rozszerzona lista plików, punkty 1-5);
  - `r1/REVIEW.md` (MAJOR-1, MAJOR-2, obserwacja nonce'a);
  - `IMPL-fix10.md`.

## Werdykt: APPROVE, bez ustaleń blokujących i bez MAJOR

Wszystkie pięć obowiązkowych punktów notatek jest zrobionych. Każdy ma test, który sprawdza mechanizm, a nie sam
render. Diff mieści się w rozszerzonej liście plików, a bramki uruchomione przez recenzenta są zielone.
Do etapu Prove zostają warunki z notatek (build i bramki artefaktu, smoke dwóch izolatów) oraz jedna dodatkowa
kontrola: że stała `define` dotarła do bundla serwera (MINOR-2).

## 1. Zakres i pliki

| plik                                                                                                                                                                                                                                 | na liście rundy? | uwagi                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------- |
| `src/lib/http/documentCacheL2.server.ts`                                                                                                                                                                                             | tak              | `l2BuildId()` ze stałej, brak importu `bootManifest`, `l2SelfTestVerified()`      |
| `src/lib/http/documentCache.server.ts`                                                                                                                                                                                               | tak              | leniwy nonce, `isFinalGoneResponse`/`evictGoneDocument`, etap degradacji          |
| `src/lib/http/documentCache.ts`                                                                                                                                                                                                      | tak (komentarz)  | komentarze `NES_REVALIDATE_HEADER` i `DOCUMENT_CACHE_MAX_SWR_MS`                  |
| `src/server.ts`                                                                                                                                                                                                                      | tak              | druga zapora nonce'a, `isRevalidationRequest` w logu, `degradedAt`, `l2Verified`  |
| `src/lib/ssrCacheL2.server.ts`                                                                                                                                                                                                       | tak              | `edge:<build>:v<g>.<h>:...`, warstwa wyłączona bez build id                       |
| `src/lib/http/ssrTiming.ts`                                                                                                                                                                                                          | tak              | `DegradationStage`, `degradedAt?`, `l2Verified?` w linii `doc`                    |
| `vite.config.ts`, `vite.smoke.config.ts`                                                                                                                                                                                             | tak              | identyczny blok `NES_BUILD_ID` + `define`                                         |
| testy (`src/lib/http/__tests__/*`, `src/lib/__tests__/ssrCacheL2.server.test.ts`, `src/lib/ci/__tests__/viteChunkParity.test.ts`, `src/__tests__/serverEntryRequestOptions.test.ts`, `src/__tests__/platformServerFailures.test.ts`) | tak („testy")    | dwa ostatnie to dopasowania do nowego typu `revalidationHeader()` i atrapy modułu |

Sprawdzone ręcznie:

- Skryptów bramek ani `package.json` diff nie dotyka (`git diff -- scripts package.json` jest pusty). Łatki
  `fix9-gates-scan-ssr.patch` nie zastosowano.
- `src/lib/boot/*` i pliki P3.5 są nietknięte. Nowego pliku d.ts nie ma: deklaracja jest w module, co lista
  dopuszczała.
- Nie ma importu `bootManifest` ani nowych `import()` w trzech modułach L2. Dwa dynamiczne importy
  `ssrTiming.server` w `documentCache.server.ts` są z bazy.
- `src/server.ts` importuje teraz statycznie `documentCacheL2.server`. Ten moduł był już w grafie wejścia przez
  `documentCache.server`, więc nie dochodzi żadna nowa krawędź.
- `ssrTiming.ts` trafia do klienta (`webVitals.ts`), ale tylko jako `import type`. Chunk klienta bazy
  `webVitals-*.js` nie zawiera kodu tego modułu, więc nowy `Set` nie zmienia hashy klienta.
- Z bieżącą głową PR (P3.4 i scheduler) nie ma wspólnych plików. `git merge-tree` scala czysto.
- Commit jest po polsku, a trailer ma dokładnie dwie wymagane linie. Worktree jest czysty, bez nowych zależności
  i bez zbędnych plików.

## 2. Bramki uruchomione przez recenzenta (worktree, logi w `review10/`)

| bramka                                                                                                                                                                                                                                                                                                                                                                                                                          | wynik                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `light.sh bunx eslint` (21 dotkniętych plików)                                                                                                                                                                                                                                                                                                                                                                                  | 0 problemów                      |
| `bunx prettier --check` (21 plików)                                                                                                                                                                                                                                                                                                                                                                                             | OK                               |
| `light.sh bunx vitest run src/lib/http/__tests__ src/lib/__tests__/ssrCacheL2.server.test.ts src/lib/__tests__/ssrCacheL2.test.ts src/lib/ci/__tests__/viteChunkParity.test.ts src/__tests__/serverEntryRequestOptions.test.ts src/__tests__/platformServerFailures.test.ts src/__tests__/startPipeline.test.ts src/lib/__tests__/edgeCacheFunctions.test.ts src/components/admin/performance/__tests__/edgeCacheCard.test.tsx` | 41 plików / 813 testów zielonych |
| `light.sh bun run verify:static`                                                                                                                                                                                                                                                                                                                                                                                                | 15/15 bramek OK (303 s)          |

Typechecku, buildu, e2e ani Lighthouse'a nie uruchamiałem, zgodnie z poleceniem. Implementer zgłasza zielony
typecheck w wariancie nieinkrementalnym (`fix10/typecheck.log`).

## 3. Weryfikacja mechanizmu (próby obalenia)

### 3.1 Build id ze stałej `define` (punkt 1)

- **Scalanie konfiguracji.** `@lovable.dev/vite-tanstack-config` składa `define: envDefine` i na końcu robi
  `mergeConfig(config, options.vite)` (`dist/index.js:1838-1867`). `define` z `vite:` scala się więc głęboko, a
  `VITE_*` zostają. `validateConfig` w sandboksie sprawdza tylko `server.*`, więc `define` nie jest odrzucane.
- **Środowiska.** W Vite 7.3.6 `getDefaultEnvironmentOptions` przenosi top-level `define` do każdego środowiska
  (`config.js:35418`). `vite:define` w buildzie działa też dla konsumenta `server` (`config.js:26502-26580`): gałąź
  `consumer === "client" && !isBuild` pomija tylko klienta w dev.
- **Brak rozjazdu w obrębie builda.** Stała jest liczona raz przy wczytaniu pliku konfiguracji. Oba moduły, które
  ją czytają (`documentCacheL2.server`, pośrednio `ssrCacheL2.server`), są w tym samym środowisku SSR, więc w
  jednym bundlu serwera nie mogą powstać dwie różne wartości.
- **Klient.** Klient stałej nie czyta, a moduł nie jest w grafie klienta. Odczyt i tak stoi za
  `import.meta.env.SSR`.
- **Odstępstwo od notatek.** Notatki mówią: „fallback 'dev', gdy stała nie istnieje". Implementacja daje `dev`
  tylko poza PROD, a w PROD zwraca `null`, co wyłącza L2 dokumentów i migawek. Odstępstwo jest jawne i uzasadnione
  (IMPL §1 i §5): bezpieczniej nie mieć L2 niż podawać HTML poprzedniego deployu. Akceptuję je, ale patrz MINOR-2.
- **Mentalny revert.** Usunięcie segmentu z klucza wywraca `documentCacheL2BuildId` i 4 testy
  `ssrCacheL2.server` (implementer sprawdził to mutacyjnie, `fix10/mutation.log`). Utrata `define` w jednym presecie
  wywraca `viteChunkParity`.

### 3.2 MAJOR-1: build w kluczu migawek (punkt 2)

- `snapshotKey` zwraca `edge:${build}:v${g}.${h}:${scope}::${key}`. Przy `null` daje no-op w `read` i `write`, a
  `enabled()` wymaga build id.
- Wersje (`readVersion`) są niezależne od buildu i tak ma być: to liczniki purge'a.
- Migawki `bootstrapCache` (tenanci, przekierowania) są bez buildu. Mają stały kształt, co opisano w nagłówku.
- Test: migawka poprzedniego deployu jest nieosiągalna, a ten sam build po rotacji izolatu ją widzi.

### 3.3 MAJOR-2: usuwanie zdjętych i przeniesionych wpisów (punkt 3)

- **Gdzie zapada decyzja.** Usuwa `decorateMissAndDeferStore(..., refreshesEntry)` w middleware, bo tylko tam są
  host, klucz planu i odpowiedź routera. Wywołanie jest na trzech ścieżkach:
  - żądanie z nonce'em (odświeżenie w tle);
  - synchroniczny render po STALE z L1, gdy nie ma drivera;
  - to samo po STALE z L2.

  Zwykły MISS nie usuwa niczego. Test pokazuje, że 404 ze skanera nie woła `delete`.

- **Inwariant „ostateczne, niezdegradowane”.** Opiera się na tym, że trasy dają 404 tylko z czystego odczytu.
  Sprawdziłem publiczne trasy z `notFound()`:
  - `$.tsx:377-437`: `status !== "success"` oznacza degradację (200), a 404 lub przekierowanie pada tylko po
    `success` + `null`;
  - `events.$slug.tsx:188`, `series.$slug.tsx:56`, `tracker.$slug.tsx:99-107`, `organization.$slug.tsx:117-123`
    oraz `author.$slug.tsx`: 404 tylko z czystego odczytu, degradacja wraca inną gałęzią;
  - `post.$slug.tsx`: zawsze przekierowuje, więc nigdy nie ma wpisu 200 do usunięcia.

  Przekierowania zależne od nagłówków (język, reguły, `?lang=`) są w middleware przed cache'em
  (`src/start.ts:546-565`), a `__root.tsx` nie ma `redirect`. Gdyby inwariant kiedyś pękł, skutkiem byłaby utrata
  trafienia, a nie podanie złej treści.

- **Negatywne kontrole w teście.** 200 `no-store`, 503, 304 i render, który rzuca, zostawiają wpis STALE bez
  `delete`. Mutacja `evicted = false && ...` wywraca 5 testów.
- **`l2Delete` pod `runAfterResponse`.** Biegnie w kontekście asynchronicznym żądania czytelnika (`cloudflare:workers`
  `waitUntil`), więc nie jest ucinane.
- **Komentarze.** Komentarz `documentCache.ts:53-67` jest poprawiony i rozróżnia aktualizację od zdjęcia.
  Nagłówki obu modułów są spójne.

### 3.4 Nonce rewalidacji (punkt 4, bezpieczeństwo)

- W zasięgu modułu nie ma już żadnego losowania. `revalidationNonce()` losuje leniwie (`randomUUID`, potem
  `getRandomValues`) i zapamiętuje wyłącznie udane losowanie. Przewidywalnego fallbacku nie ma.
- `isRevalidationRequest` porównuje tylko z już wylosowanym nonce'em i sam niczego nie losuje. Izolat, który nie
  wystawił żadnego odświeżenia, uznaje więc każdy znacznik za obcy.
- Losowanie odbywa się w `scheduleRevalidation`, czyli w zakresie żądania czytelnika. W `revalidateDocument` jest
  druga zapora: `null` oznacza brak renderu.
- **Wyciek nonce'a.** Sprawdziłem, czy nonce może opuścić izolat. W `src` nie ma kodu, który przekazuje wszystkie
  nagłówki żądania dalej (`getRequestHeaders()`, `headers: request.headers`) ani echa nagłówka w odpowiedzi.
  Syntetyczne żądanie idzie w procesie, przez `handler.fetch`.
- **Testy.** `nes-0`, `""`, `"0"`, `"1"`, obcy UUID, nonce wielkimi literami i nonce bez pierwszego znaku dają HIT
  bez renderu. Import w atrapie zakresu globalnego workerd (losowanie rzuca, `Date.now()` = 0) nie woła
  `randomUUID` ani `getRandomValues`. Bez losowości driver nie jest wołany. Dawne IIFE oblewa pierwszy test.
- **Opis ryzyka w IMPL §2.** Zgadza się z kodem `handleDocumentRequest`. Żądanie z nonce'em:
  - pomija odczyt L1 i L2;
  - wymusza render i zapisuje go do L1/L2;
  - pomija `misses` i planowanie po degradacji;
  - fałszuje `revalidation: true`.

  Nie omija planu (BYPASS sesji, deny-lista), walidacji hosta ani middleware przed cache'em.

### 3.5 R7(b, c) w linii `kind:"doc"` (punkt 5)

- `l2Verified` czyta tylko stan samotestu i niczego nie otwiera ani nie planuje.
- `degradedAt` (`loader`/`handler`/`stream`) ma tę samą definicję w pierścieniu i w linii. Pole trafia do linii
  tylko przy `degraded: true` i tylko ze słownika.
- Etap przechodzi z `onOutcome` na obu ścieżkach: czytelnika i odświeżenia w tle.
- „Który loader" (`degradedBy`) jest świadomie odłożony do P3.6b, bo wymaga `resilientLoad.ts` i
  `chromeWarmup.tsx`, które są poza listą. Odstępstwo jest opisane, a notatki dopuszczają „etap/przyczynę”.

### 3.6 SSR, klient, SEO, a11y, CLS, i18n, Lantern

- Zmiana jest czysto serwerowa: HTML dokumentu i chunki klienta są bez zmian, więc nie ma ryzyka hydratacji,
  CLS ani nowej późnej zmiany wizualnej.
- Zalogowani (BYPASS po `sb-*`) i `/en` (osobny klucz ścieżki, negocjacja przed cache'em) zachowują się bez zmian.
- Zysk SI/TTFB pojawi się dopiero w produkcji, przy HIT/STALE z L2 na zimnych izolatach. Lokalnie L2 jest no-opem,
  więc Lighthouse może pokazać tylko brak regresji.

## 4. Ustalenia

### MINOR-1: `goneEvictions` i `evicted` liczone także dla odświeżenia po zdegradowanym MISS-ie (bez wpisu)

- **Gdzie:** `src/lib/http/documentCache.server.ts:1176-1188` (`refreshesEntry = revalidation`) i `:559-567`
  (`evictGoneDocument`).
- **Dowód:** `scheduleDegradedRevalidation` (`:457-487`) wystawia odświeżenie z nonce'em także po zdegradowanym
  MISS-ie, kiedy wpisu nie było. Jeśli to odświeżenie da czyste 404, bo treść zdjęto w trakcie czkawki bazy, to:
  - `goneEvictions` rośnie, choć niczego nie usunięto;
  - pierścień dostaje `evicted: true`;
  - leci jedna zbędna operacja `delete` na Cache API.

  Szkoda dotyczy tylko telemetrii, a komentarz „Zwykły MISS niczego nie usuwa” jest tu nieścisły.

- **Poprawka:** licz `goneEvictions` i ustawiaj `evicted` tylko wtedy, gdy L1 miało wpis albo `l2Delete` zwróciło
  `true` (licznik w `.then`). Alternatywnie przekaż do `decorateMissAndDeferStore` informację, że odświeżenie
  dotyczy istniejącego wpisu, przez rejestr kluczy w `scheduleRevalidation`.

### MINOR-2: `define`, które nie dotrze do bundla serwera, wyłączy całe P3.6a po cichu

- **Gdzie:** `src/lib/http/documentCacheL2.server.ts:405-418` (`l2BuildId()`: PROD bez stałej daje `null`) oraz
  linia `kind:"l2"` (`:353-356`), w której nie ma `build`.
- **Dowód:** odstępstwo od „fallback 'dev'” jest świadome i bezpieczne, bo nie poda starego HTML-a. Gdyby jednak
  preset hostingu (np. `LOVABLE_NITRO_PRESET=lovable-fetch-bundle`) zbudował serwer bez podstawienia, L2 dokumentów
  i migawek byłoby wyłączone bez żadnego sygnału:
  - samotest dalej melduje `verified: true`;
  - Server-Timing `nes-l2` mówi `named`;
  - brak `nes-layer;desc="L2"` wyglądałby jak brak wpisów.

  Hipoteza zostaje niewykluczona do czasu Prove.

- **Poprawka:**
  - (a) Prove, obowiązkowo: `grep -r "__NES_BUILD_ID__" .output/server` daje pusto, a literał buildu jest w chunku
    z `nes-edge-cache.internal` (IMPL §6 pkt 2).
  - (b) Tani dopisek w kodzie: `build: l2BuildId()` w linii `kind:"l2"`, ewentualnie `nes-l2;desc="off-build"`,
    gdy build id jest `null`. Weryfikacja produkcyjna po wdrożeniu rozstrzygnie wtedy przypadek jednym `curl` albo
    jedną linią logu.

### MINOR-3: (informacyjnie) memo OBIETNICY w `ssrCacheL2.readVersion` dalej otwarte

- **Gdzie:** `src/lib/ssrCacheL2.server.ts:117-135`.
- **Dowód:** to obserwacja 2 z `r1/REVIEW.md`, poza punktami 1-5 tej rundy. Implementer świadomie zostawił ją do
  decyzji orkiestratora (IMPL §4). Szkodę ogranicza termin 150 ms odczytu L2.
- **Poprawka:** osobna pozycja albo P3.6b. Memoizować wartość, a lot współdzielić tylko w obrębie jednego żądania.

## 5. Warunki dla etapu Prove (z notatek, bez zmian)

1. Build, `check:bundle` (boot closure ~486.8 KB gz), `check:chunks`, `check:entry-purity`,
   `check:server-entry-purity`, `test:e2e:artifact` i document-weight: wszystkie zielone.
   - Layout `.output/server` ma być jak na bazie: manifest Start na najwyższym poziomie, brak
     `_ssr/bootManifest-*.mjs`.
2. Grep artefaktu z MINOR-2 (a). Hashe zasobów klienta mają być takie jak dla kodu bez zmian w kliencie.
3. Smoke dwóch izolatów z atrapą Cache API:
   - HIT z L2 pod `/__nes/doc/<build>/...`;
   - brak HIT po zmianie build id;
   - `x-nes-revalidate: nes-0` na świeżym wpisie daje HIT, nie MISS;
   - opcjonalnie: zdjęcie → `delete` → MISS na drugim izolacie.
