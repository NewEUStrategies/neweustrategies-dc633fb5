# Recenzja P3.6a: działająca warstwa L2 dokumentu (nazwany cache, samotest, build w kluczu, stały UA odświeżenia)

Worktree: `scratchpad/wt3/P3.6a`, gałąź `perf/w3-P3.6a`, commit `01670c0a` (jeden commit nad `claude/zen-ritchie-hzur21`).
Podstawa: PLAN-FALI-3 §2 P3.6a, `faza3/diagnoza/cache-dokumentu.md` §4, §8 R1/R6/R7, notatki orkiestratora, `IMPL.md`.

## Werdykt: APPROVE (bez blokad), z dwoma ustaleniami MAJOR do decyzji orkiestratora PRZED WDROŻENIEM

Zmiana robi to, co mówi plan, i nie wychodzi poza listę plików. Testy sprawdzają mechanizm, a nie sam render.
Dwa ustalenia MAJOR nie są wadami tego diffu. To skutki ożywienia L2 w kodzie spoza listy plików. Zanim fala
pójdzie na produkcję, trzeba je zamknąć albo świadomie przyjąć.

## 1. Zakres i pliki

| plik                                     | na liście?             | uwagi                                                                                                                                          |
| ---------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/http/documentCacheL2.server.ts` | tak                    | fasada, samotest, build w kluczu, `l2Stats`, `l2SelfTestLabel`                                                                                 |
| `src/server.ts`                          | tak (tylko R6)         | wyłącznie `REVALIDATION_USER_AGENT` w `revalidationHeaders()`; ścieżka czytelnika nietknięta                                                   |
| `src/lib/http/documentCache.server.ts`   | tak (tylko telemetria) | `nes-l2` w Server-Timing, pola migawki, `degradedAt` w pierścieniu, `markLateDegradation()` (ta sama kolejność `scheduleDegradedRevalidation`) |
| 4 nowe testy w `src/lib/http/__tests__/` | tak                    | —                                                                                                                                              |

`bootManifest.ts` jest tylko importowany (dynamicznie, za `import.meta.env.SSR`), bez edycji. Diff nie dodaje
zależności ani zbędnych plików. Komentarze i commit są po polsku. Trailer ma dokładnie wymagane dwie linie
(`Co-Authored-By: Claude Opus 5.5`, `Claude-Session: …session_018pV9XfFuDnwMxKGJSFfcDg`). Worktree jest czysty.

Odstępstwa opisane w IMPL §4 mają uzasadnienie i je akceptuję:

- R7(b, c) nie są w linii `kind:"doc"`, bo tę linię buduje `ssrTiming.ts`, który jest poza listą.
- `degradedBy` z etykietami loaderów wymaga plików P3.6b.
- Import mapy bootu jest dynamiczny, żeby nie było statycznej krawędzi do manifestu Start w grafie wejścia Workera.
- R7(a) jest pominięte, bo plan zostawia je jako opcjonalne.

Wymagania z notatek orkiestratora są spełnione:

- Build w kluczu pochodzi z `BOOT_MANIFEST.entry`. Fallback `dev` to stały napis, bez `Date.now()`.
- Samotest jest raz na izolat, pod `runAfterResponse`.
- `enabled` i `verified` biorą się z samotestu.
- L1 działa bez zmian.
- Purge, wersje, migawki i media idą przez jedną fasadę. Sprawdziłem grepem: w `src` nie ma innego użycia `caches.*`
  poza fasadą.
- Świeżość, SWR i reguły zapisu są nietknięte.

## 2. Bramki uruchomione przez recenzenta (worktree)

| bramka                                                                                                                                                                 | wynik                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `light.sh bunx eslint` (7 dotkniętych plików)                                                                                                                          | 0 błędów                                           |
| `bunx prettier --check` (7 plików)                                                                                                                                     | OK                                                 |
| `light.sh bunx vitest run src/lib/http/__tests__ src/lib/__tests__/ssrCacheL2.server.test.ts src/lib/__tests__/ssrCacheL2.test.ts src/__tests__/startPipeline.test.ts` | 32 pliki / 702 testy zielone (`review-vitest.log`) |
| `light.sh bun run verify:static`                                                                                                                                       | 15/15 bramek OK (`review-verify-static.log`)       |

Typechecku, buildu ani Lighthouse'a nie uruchamiałem, zgodnie z poleceniem. `check:bundle`, `check:server-entry-purity`,
`test:e2e:artifact` i `--compare` należą do etapu Prove. `check:server-entry-purity` pilnuje `stripe` i
`node-html-parser` (`src/lib/ci/serverEntryPurity.ts:261-295`), więc nowy dynamiczny import modułu mapy bootu go nie
dotyczy. Klient nie zmienia się wcale, bo moduł jest server-only.

## 3. Weryfikacja mechanizmu (próby obalenia)

- **Fasada / `openStore`.** Memoizowany jest wynik, a nie obietnica, więc żadne żądanie nie czeka na I/O z kontekstu
  innego żądania. Równoległy cold start może zawołać `open` kilka razy, ale wygrywa pierwszy wynik (`state.opened`
  ustawiane tylko z `undefined`). `open` jest wołane jako metoda `state.source`, więc `this` jest poprawne. Obiekt
  `Cache` z `caches.open` nie jest związany z żądaniem, a to samo założenie przyjmowało dotąd `caches.default`.
- **Samotest.** Losowy nonce, porównanie treści (fałszywie dodatni wynik jest niemożliwy), jedno ponowienie po 100 ms,
  nigdy nie rzuca. Wynik `false` wyłącza L2 w izolacie, czyli daje stan dzisiejszy. Wynik `null` (w toku) oznacza tryb
  optymistyczny. Uwaga: `runSelfTest()` startuje od razu przy pierwszym `getColoCache()`, nie po odpowiedzi.
  `runAfterResponse` tylko trzyma izolat przy życiu, a nie opóźnia startu. Koszt to jeden `put`/`match` małego wpisu
  równolegle z pierwszym żądaniem izolatu, więc jest pomijalny i nie zgłaszam go jako ustalenia.
- **`getColoCache()` poza kontekstem żądania.** Wszystkie wywołania są w ciałach funkcji (`bootstrapCache`,
  `ssrCacheL2`, `mediaCache`, L2 dokumentów). Nie ma wywołania w zasięgu modułu, więc losowanie i `setTimeout`
  w samoteście są dozwolone.
- **Build w kluczu.** Wtyczka `nes:boot-after-lcp` przerywa build, gdy nie podmieni deklaracji
  (`scripts/lib/bootAfterLcpPlugin.ts:242-262`), więc w PROD `entry` istnieje. Gałąź „PROD bez mapy → L2 dokumentów
  wyłączone” jest bezpieczna. `l2Delete` i `bumpL2Version` liczą adres pod bieżącym buildem, więc purge trafia we wpisy
  tego deployu.
- **R6.** `isbot` (wersja z `node_modules`, której używa router) dla `REVALIDATION_USER_AGENT` zwraca `false`
  (sprawdzone ręcznie). W `src` nie ma renderu SSR zależnego od UA poza decyzją `isbot` routera, a `shortcuts.ts` i
  `TicketWalletButtons` czytają `navigator`, czyli działają tylko po stronie klienta. Wspólny wpis dla wszystkich UA
  nie tworzy więc rozjazdu hydratacji. Ciasteczka sesji i `authorization` nadal są wykluczone.
- **Server-Timing.** `nes-l2` pojawia się tylko wtedy, gdy runtime ma `caches.open`. Lokalnie (Node, e2e, harness)
  nagłówek jest bajt w bajt jak dotąd. Parsery (`ssrTiming.buildDocumentLogLine`, `webVitals.ts`) szukają metryk po
  nazwie, więc kolejność ich nie łamie.
- **SSR, hydratacja, SEO, a11y, CLS, i18n, zgody.** Zmiana jest czysto serwerowa i nie dotyka HTML-a ani klienta.
  Zalogowani (BYPASS po `sb-*`) i `/en` (osobny klucz ścieżki) zachowują się bez zmian.
- **Lantern / SI.** Lokalnie L2 jest no-opem, więc harness może dowieść tylko braku regresji. Efekt na TTFB (obsSI)
  pojawi się dopiero w produkcji, przy HIT/STALE z L2 na zimnych izolatach. Zmiana nie tworzy żadnej nowej, późnej
  zmiany wizualnej.
- **Testy (mentalny revert).** Gdyby fasadę cofnąć do `caches.default`, padnie test HIT z L2, bo default jest atrapą
  niczego nieprzechowującą. Gdyby usunąć build z klucza, padną `documentCacheL2BuildId` i asercja `/__nes/doc/dev/`.
  Kopia UA wyzwalacza wywraca pierwszy test `revalidationUserAgent` (implementer sprawdził to mutacyjnie). Gdyby
  zabrać `markLateDegradation`, padną przypadki `handler` i `stream`. Negatywne kontrole są obecne: `open` odrzuca,
  rzuca synchronicznie albo zwraca nie-cache, `caches` nie istnieje, runtime nie ma `open`.

## 4. Ustalenia

### MAJOR-1: migawki danych L2 (`edgeTtlCache`) nie mają buildu w kluczu, a ta zmiana je ożywia

- **Gdzie:** `src/lib/ssrCacheL2.server.ts:133-138` (`snapshotKey` → `edge:v<g>.<h>:<scope>::<key>`), poza listą
  P3.6a. Przyczyną jest `src/lib/http/documentCacheL2.server.ts:351-363`: fasada działa teraz także dla migawek.
- **Dowód:** okno serve-stale publicznych kluczy chrome to 24 h (`src/lib/ssrCache.ts:41-44`, `maxAgeFor`), a
  nieświeża migawka jest podawana natychmiast (`ssrCache.ts:365-367`). Do tej pory L2 w produkcji było martwe
  (diagnoza §0.1), więc rozjazd kształtu między deployami nigdy nie występował. Po tej zmianie nowy kod może dostać
  wartość (`site_settings_public`, menu, tokeny, `public:home-*`, `public:resolved:*`) w kształcie starego kodu.
  Render z niej trafia do L1 i L2 już pod NOWYM buildem i jest tam przez okno świeżości.
- **Poprawka:** jedna linia w `snapshotKey`: segment buildu (ten sam `documentBuildId()` wyeksportowany z
  `documentCacheL2.server.ts` albo stała wersja schematu migawek) przed wersjami. Robi to orkiestrator przy scalaniu
  albo pozycja z `ssrCacheL2.server.ts` na liście, PRZED wdrożeniem fali. Migawki tenantów i przekierowań
  (`bootstrapCache`) mają stały kształt, więc wystarczy objąć `edgeTtlCache`. Implementer sam to zgłosił
  (IMPL §5, `out_of_ownership_needs`). Potwierdzam, że to warunek bezpiecznego wdrożenia.

### MAJOR-2: działające L2 wydłuża życie STALE dla zdjętych i przekierowanych treści w koloniach bez purge

- **Gdzie:** `src/server.ts:296-299`. Po rewalidacji bez rejestracji zapisu (404, redirect, `no-store`) „wpis zostaje
  STALE”. W połączeniu z `DOCUMENT_CACHE_MAX_SWR_MS = 24 h` (`src/lib/http/documentCache.ts:57`) i purge per
  kolonia (`documentCacheL2.server.ts:50-58`) oznacza to, że w kolonii, która nie obsłużyła publikacji, każde trafienie
  podaje STALE i odpala kolejną rewalidację, która znowu kończy się 404. Wpis nie jest ani zastąpiony, ani usunięty.
- **Skutek:** zdjęty albo cofnięty z publikacji artykuł, albo ścieżka z nowym przekierowaniem, jest podawany
  anonimowym czytelnikom innych kolonii do ~24 h (fresh + swr TTL wpisu L2). Wcześniej ten sam mechanizm dotyczył
  tylko pojedynczego izolatu, który żyje krótko. Komentarz modułu (`documentCacheL2.server.ts:52-58`: „odświeży wpis
  najpóźniej po oknie świeżości”) i komentarz w `documentCache.ts:50-55` są prawdziwe tylko dla AKTUALIZACJI treści,
  a nie dla zdjęć i przekierowań. Decyzja właściciela D2 („bez zmian świeżości”) tego przypadku nie obejmuje.
- **Poprawka (zasady zapisu, czyli P3.6b albo decyzja orkiestratora przed wdrożeniem):** gdy rewalidacja
  STALE-wpisu da ostateczny, niezdegradowany wynik nienadający się do zapisu (404/410/3xx), usuń wpis z L1 i wywołaj
  `l2Delete(host, key)` w tej kolonii. Do tego czasu trzeba poprawić oba komentarze i dopisać do procedury PROVE
  kontrolę „zdjęcie wpisu → inna kolonia”.

### MINOR-1: `null` buildu zapamiętany po nieudanym imporcie

- **Gdzie:** `src/lib/http/documentCacheL2.server.ts:398-412`.
- **Dowód:** `catch` przy `import("@/lib/boot/bootManifest")` daje `entry = undefined`, w PROD `resolved = null`, a
  potem `buildId = null` zostaje zapamiętane na całe życie izolatu. Przejściowy błąd importu (np. zimny izolat z padniętym
  importem chunku handlera) wyłącza wtedy L2 dokumentów w izolacie na stałe i nie zostawia śladu poza `l2Stats().build`.
- **Poprawka:** zapamiętuj wynik tylko po udanym imporcie. W `catch` zwróć `null` bez przypisywania do `buildId`.

### MINOR-2: identyfikator buildu obejmuje tylko klienta

- **Gdzie:** `src/lib/http/documentCacheL2.server.ts:61-65` i `buildIdFromEntry`.
- **Dowód:** deploy, który zmienia wyłącznie serwer (markup SSR, meta, sanitizacja), zostawia ten sam segment. Wpisy
  poprzedniego deployu są dalej osiągalne: jako HIT do 3 min, potem jeden STALE z rewalidacją na ścieżkę i kolonię.
  Nie grozi to rozjazdem chunków, ale poprawka SSR (np. bezpieczeństwa) nie unieważnia wpisów od ręki. IMPL §5 to
  opisuje.
- **Poprawka (później, poza listą):** dołożyć do segmentu stałą serwerową z `define` Vite (hash lub czas buildu),
  np. `<entry>-<serverBuild>`.

### MINOR-3: R7(b, c) tylko częściowo (odstępstwo opisane)

- **Gdzie:** `src/lib/http/documentCache.server.ts:469-472` (`nes-l2` w Server-Timing) i `:235` (`degradedAt`).
  Linia `kind:"doc"` (`src/lib/http/ssrTiming.ts:555-596`) nie niesie ani `l2`, ani `degradedBy`.
- **Dowód:** linia `kind:"l2"` jest jedna na izolat i nie da się jej skorelować z liniami `doc` innych wywołań tego
  samego izolatu (linia `doc` ma `isoReq`, ale nie ma identyfikatora izolatu).
- **Poprawka:** w P3.6b albo w osobnej pozycji z `ssrTiming.ts` na liście: `parseServerTiming` mapuje `nes-l2` na
  `line.l2`, a `degradedBy` dochodzi z rejestru etykiet `loadResilient` i chrome.

### MINOR-4: test R6 nie przypina UA do harnessu ani do `isbot`

- **Gdzie:** `src/lib/http/__tests__/revalidationUserAgent.test.ts:93-95` i `src/server.ts:164-165`.
- **Dowód:** test sprawdza `isBotUserAgent` z `botFilter` (lista beaconów), a nie `isbot`, którego używa router.
  Napis UA jest skopiowany z `scripts/performance/artifactServer.ts:95` bez testu równości, więc zmiana w jednym
  miejscu cicho rozjedzie wariant zapisu z wariantem mierzonym przez harness.
- **Poprawka:** w teście `expect(userAgent).toBe(WARM_USER_AGENT)` (import ze `scripts/performance/artifactServer.ts`,
  jeśli konfiguracja vitest go obejmuje). Alternatywnie zostawić komentarz, a `isbot` sprawdzać pośrednio.

## 5. Obserwacje poza zakresem (dla orkiestratora; nie wchodzą do werdyktu)

1. **`REVALIDATE_NONCE` przewidywalny w produkcji** (`src/lib/http/documentCache.server.ts:266-272`). Moduł jest
   statycznie w grafie wejścia (`src/server.ts:33-37`), więc IIFE liczy się w zasięgu globalnym workerd. Tam
   `crypto.randomUUID()` jest zabronione, a `Date.now()` = 0, więc fallback daje `nes-0`. Pośredni dowód z IMPL §6:
   `/api/public/version` zwraca `rt-0`. Każdy z zewnątrz może wysłać `x-nes-revalidate: nes-0` i ominąć L1/L2 (render
   wymuszony, nacisk na bazę), a do tego zafałszować `revalidation: true` w logach. Ta zmiana tego nie naprawia ani nie
   pogarsza. Zalecam osobne zadanie: nonce losowany leniwie, przy pierwszym użyciu w kontekście żądania, a do tego
   zdejmowanie nagłówka `x-nes-revalidate` z żądań przychodzących.
2. **`ssrCacheL2.readVersion` memoizuje OBIETNICĘ `cache.match`** współdzieloną między żądaniami
   (`src/lib/ssrCacheL2.server.ts:104-120`). To dokładnie ten wzorzec, którego fasada słusznie unika. Po ożywieniu
   L2 może się zdarzyć, że żądanie B czeka na I/O z kontekstu A. Szkodę ogranicza termin 150 ms
   (`EDGE_TTL_L2_READ_TIMEOUT_MS`), ale warto memoizować wartość, a nie obietnicę (poza listą).
3. Procedura produkcyjna z IMPL §7 (≤ 20 żądań co ≥ 3 s, `nes-l2`, `nes-layer;desc="L2"`, `edge-routing` ≈ 0,
   linie `kind:"l2"`) jest właściwa i powinna trafić do PROVE.md. Proponuję dopisać kontrolę z MAJOR-2 i pierwszy
   MISS po deployu (nowy segment buildu).

## 6. Podsumowanie dla orkiestratora

- Scalenie do gałęzi PR: TAK.
- Przed wdrożeniem fali: MAJOR-1 (segment buildu w `snapshotKey`) i decyzja w sprawie MAJOR-2 (zasada usuwania
  STALE po ostatecznym 404 lub przekierowaniu, w P3.6b), albo świadome przyjęcie ryzyka przez właściciela.
- MINOR-1 można poprawić w etapie Prove jednym wierszem w pliku z listy. MINOR-2 do MINOR-4 można odłożyć.
