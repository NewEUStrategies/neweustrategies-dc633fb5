# Recenzja P3.6b (fala 3, partia 2): werdykt zapisu na końcu strumienia + budżet treści `/`

Worktree: `scratchpad/wt3/P3.6b`, commit `80ce4d2b` nad `claude/zen-ritchie-hzur21`. Recenzja adwersaryjna,
bez edycji plików.

**Werdykt: APPROVE** (0 blokujących, 0 poważnych, 6 drobnych). Drobne nie blokują scalenia. Punkty 1 i 4
trzeba sprawdzić w etapie Prove.

Uwaga o wątku użytkownika („jeden font - ma to być Red Hat Display”): ta pozycja nie dotyka fontów. Importy
`red-hat-display-*.woff2` i preloady w `__root.tsx` są nietknięte. Zasada „jeden font” należy do P3.2b
(decyzja W w PLAN-FALI-3 §3a). Brak konfliktu.

## 1. Zakres plików

Diff obejmuje 20 plików. Wszystkie źródła są na liście z notatek orkiestratora: `index.tsx`,
`documentCache.server.ts`, `responseHeaders.ts`, `chromeWarmup.tsx`, `resilientLoad.ts`, `homeSsrBudget.ts`,
`ssrTiming.ts` (tylko `degradedBy`), `server.ts` (tylko `logDocument`). Pozostałe pliki to testy. Zmiany w
`__root.tsx` to:

- import `markDeliberateSeed`;
- deklaracja przy zasiewie `post-layout-settings`;
- własność `warmLate` w obiekcie `registerChromeWarmup`.

Wszystkie są lokalne, więc nie ma konfliktu z obszarem P3.8 (`fontScale`, sygnał popupów, bramki nakładek).
W diffie nie ma zbędnych plików. Trailer commita jest zgodny, komentarze i commit są po polsku, prettier
przechodzi.

## 2. Mechanizm a plan (R2 a-c, R3a, R7c, e)

### (a) Predykat kompletności

Predykat działa per `Request` przez WeakMap, tak jak wzorzec `routeCacheDirectives`. Odrzuca dokument, gdy
zachodzi któryś z warunków:

- `error`;
- `success` z `dataUpdatedAt<=0` bez deklaracji celowego zasiewu;
- dane zgubione (`dropped`): pobierane po uzbrojeniu, a na końcu nieobecne albo bez danych.

Trzecia reguła wykrywa wyczerpaną bramkę `ServerSectionGate` bez flagi `exhausted`. To odstępstwo 1 z
uzasadnieniem: `sectionStreaming.tsx` jest poza listą plików, a warunek jest szerszy od flagi, czyli
bezpieczniejszy.

Sprawdziłem kolejność w `node_modules`:

1. `transformStreamWithRouter.makeMainStream`: `safeClose()`, potem synchronicznie `cleanup()`, potem
   `serverSsr.cleanup()`.
2. `router-ssr-query-core` `teardown`: `cancelQueries()`, potem `clear()`.

Kolektor zapisu czyta więc `done` po wyczyszczeniu cache'u. Zamrożenie werdyktu w podmienionym
`QueryCache.clear` tego żądania jest więc konieczne i działa poprawnie: `QueryClient.clear()` woła
`this.#queryCache.clear()`, a to trafia we własność instancji.

Ścieżki brzegowe:

- Przerwanie strumienia albo `lifetime` daje `body === null`, czyli `failed`, więc bez zapisu.
- Uzbrojenie na końcu loadera `/` jest uzasadnione. Zamiatanie (`postRenderSweep`) usuwa pobrania z fazy
  loaderów, a bramki renderu pobierają je ponownie po uzbrojeniu.

### (b) `applyDeferredDocumentStore`

Predykat jest liczony po `canStillStore()`. `false` uruchamia `markLateDegradation("stream")`, czyli to samo
odświeżenie w tle z tym samym limitem prób. Świeżość wpisu to `min(rekord, polityka dyrektywy końcowej)`, a
nagłówek wpisu to `narrowestCacheControl`. Zgodne z R2b.

### (c) Bramka chrome przy wygasłym terminie

`warmLate` z budżetem 1 200 ms od pierwszego odczytu bramki, oznaczenie `chrome`, a po budżecie bez danych
`failed`. Trasy bez `warmLate` (cały serwis poza `/`) zachowują się jak dotąd. Klient nie dostaje
`warmLate`, bo jest za `isServer && homeDeadline !== undefined`.

### (d) R3a

`HOME_CONTENT_BUDGET_MS = 1200` liczony na tym samym zegarze żądania. `home.page` i `home.mode` dostają
termin treści. Typ A to `degraded` → `private, no-store`, a predykat dodatkowo łapie `seed:public.home-page`.
To obrona w głąb, potwierdzona testem smoke z „zapomnianym” `no-store`.

### (e) `no-cache, must-revalidate, max-age=0`

Wyjaśnione trzema sondami produkcyjnymi (dopuszczalny limit) i zapisami z fazy 1. To nadpisanie nagłówka
przez hosting dla `text/html`, a nie ślad degradacji. Wniosek jest przekonujący, bo `robots.txt` i
`sitemap.xml` przechodzą z wartością aplikacji. Nie ma czego naprawiać.

### R7c `degradedBy`

Pole jest dopisywane tylko przy `degraded:true`. Alfabet jest zamknięty, sufit to 8 pozycji, a wpisy
rewalidacji mają izolowane etykiety.

### Odstępstwa 2-8

Wszystkie są nazwane i uzasadnione w IMPL §4:

- B2 dostaje krótką politykę 30 s / 300 s, bo w HTML nie ma preloadu LCP. To zgodne z „świeżością z
  dyrektywy końcowej”.
- Wyjątek dekoracyjny `ad_placements` jest zgodny z doktryną korzenia.

## 3. Bramki uruchomione w recenzji

| bramka                                                                                                               | wynik                                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `light.sh bunx eslint` (20 dotkniętych plików)                                                                       | 0 błędów, 4 ostrzeżenia `react-refresh/only-export-components` (eksporty jak na bazie) |
| `bunx prettier --check` (dotknięte)                                                                                  | OK                                                                                     |
| `light.sh bunx vitest run` (13 dotkniętych plików testów + `documentCache.server.test.ts` + `startPipeline.test.ts`) | 13 plików / 500 testów zielonych                                                       |
| `light.sh bun run verify:static`                                                                                     | 15 bramek OK w 312 s (`review/verify-static.log`)                                      |
| typecheck, build, check:bundle/chunks/entry-purity, document-weight, e2e, Lighthouse                                 | nieuruchamiane (zgodnie z zadaniem) - etap Prove                                       |

Testy sprawdzają mechanizm, a nie sam render. Smoke w procesie łączy:

- prawdziwy `requestHandler` (zasięg `getRequest()`);
- `handleDocumentRequest` + `applyDeferredDocumentStore`;
- prawdziwą `ServerSectionGate`;
- zamiatanie przed renderem i `cancelQueries()+clear()` po zamknięciu strumienia.

Przeanalizowałem wycofanie poszczególnych zmian:

| wycofana zmiana              | co padnie                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| odczyt predykatu w magazynie | oba testy negatywne smoke (typ A z przepuszczającym nagłówkiem, sekcja po budżecie) |
| zamrożenie werdyktu          | B2 i czysty render (`fetched` bez obecności daje `dropped`)                         |
| świeżość z dyrektywy         | test w `degradedRenderCachePipeline`                                                |

To zgadza się z kontrolą mutacyjną opisaną w IMPL. Kontrole negatywne wymagane przez notatki (B1/B2 oraz
każde odstępstwo daje brak zapisu) są obecne.

## 4. Graf chunków i bajty klienta

Nowe krawędzie: `resilientLoad` → `responseHeaders`, `chromeWarmup` → `responseHeaders` i `homeSsrBudget`,
`server.ts` → `responseHeaders`. Wszystkie te moduły już są w domknięciu wejścia klienta (import w
`__root.tsx`) albo w grafie serwera (`documentCache.server`). Nie ma nowego modułu w boot ani cyklu.

Kod tylko serwerowy jest za `isServer` (`router-core/isServer/client.js` = `const isServer = false`, Rollup
w Vite 7 to zwija), za `import.meta.env.SSR` albo w gałęzi `.server()` `createIsomorphicFn`.

Na kliencie zostaje nowy przepływ `readChromeWarmup`, ale tylko jeśli nie jest wycinany. `ChromeDataGate`
woła go wyłącznie pod `import.meta.env.SSR`, więc najpewniej jest tree-shaken. Dochodzą też `markFailed` i
ternary nagłówka w loaderze `/` (chunk trasy, nie boot).

## 5. Ustalenia

### m1 (minor) - bajty bootu niezmierzone przy 0,6 KB zapasu

- **Miejsce:** `src/lib/ssr/chromeWarmup.tsx:58-136`, `src/lib/ssr/resilientLoad.ts:50-60,216-305`,
  `src/routes/__root.tsx:1076-1101`.
- **Dowód:** `bootClosureGzipBytes` 484,4/485,0 KB i `bootBurstGzipBytes` mają po 0,6 KB zapasu. Pozycja
  dokłada kod do modułów domknięcia bootu: `registerChromeWarmup`/`markFailed`, nowe eksporty
  `resilientLoad` i `responseHeaders`. Większość powinna wylecieć jako kod tylko serwerowy, ale tego nie
  zmierzono.
- **Poprawka:** w Prove, `check:document-weight` i `check:bundle` z `BUNDLE_INVENTORY=1` A/B. Jeśli boot
  urośnie powyżej zapasu, przenieść `trackSsrQueryCompleteness`, `markDeliberateSeed` i `queryLabel` do
  modułu `*.server.ts` lub za `import.meta.env.SSR`.

### m2 (minor) - tryb „najnowsze wpisy”: archiwum zostaje przy 600 ms, więc R3a nie działa w tym trybie

- **Miejsce:** `src/routes/index.tsx:195-204`.
- **Dowód:** treść może przyjść w 600-1200 ms, a `home.archive` używa `deadlineAt` (600 ms). Gdy termin
  minął, `loadResilient` nawet nie startuje zapytania (`remaining <= 0`) i zasiewa pustą listę. Dokument
  ma pustą siatkę wpisów i `no-store`, zamiast „typu A”. Ten kształt istniał już wcześniej, gdy archiwum
  było wolne, ale teraz staje się regułą przy wolnej treści. Odstępstwo 8 jest nazwane, a produkcja jest
  dziś w trybie strony statycznej, jednak tryb przełącza się w CMS.
- **Poprawka:** dla `home.archive` użyć `contentDeadlineAt`, bo w tym trybie archiwum JEST treścią
  (ścieżka krytyczna), albo dać mu minimum `HOME_ABOVE_FOLD_BUDGET_MS` od końca treści, z sufitem
  `HOME_CONTENT_BUDGET_MS`. Do tego test w `homeRoute.test.tsx`.

### m3 (minor) - `warmLate` duplikuje listę `chromeWarm`

- **Miejsce:** `src/routes/__root.tsx:1083-1101` wobec `:1028-1050`.
- **Dowód:** ticker, menu, reklama i widgety nagłówka/stopki są wypisane drugi raz z innym budżetem. Nowy
  klucz dodany do `chromeQueryKeys`/`chromeWarm` bez dopisania do `warmLate` sprawi, że `ready()` po
  terminie nigdy nie będzie spełnione. Wtedy `failed` i `no-store` dla `/` na każdym wolnym MISS-ie.
- **Poprawka:** fabryki pracy chrome sparametryzowane budżetem (`(budgetMs) => Promise`), z których
  korzystają i `warm`, i `warmLate`. Alternatywnie test, który porównuje klucze grzane przez `warmLate` z
  `chromeQueryKeys`. W tej partii wystarczy notatka, refaktor może poczekać na scalenie z P3.8.

### m4 (minor) - `degradedBy` z loadera bez dowodu tożsamości end-to-end

- **Miejsce:** `src/server.ts:518-521`, `src/lib/http/__tests__/documentLogTelemetry.test.ts:198-270`.
- **Dowód:** testy telemetrii podają `request` jawnie (`noteDocumentDegradation(label, request)`). Nie
  dowodzą, że `getRequest()` w odpornym loaderze to ten sam obiekt co `request` w `logDocument` za
  `fetchWithFrameworkPreloads`. Ścieżka magazynu jest dowiedziona w smoke'u (`record.request` ===
  `getRequest()`). `fetchWithFrameworkPreloads` przekazuje ten sam obiekt, więc ryzyko jest niskie.
- **Poprawka:** w Prove, na artefakcie `slow-first-fold` albo wymuszonym typie A sprawdzić w logu serwera,
  że `degradedBy` się pojawia. Opcjonalnie test z prawdziwym `loadResilient` w `hoisted.render` w zasięgu
  `requestHandler`.

### m5 (minor) - `warmLate` czeka na reklamę

- **Miejsce:** `src/routes/__root.tsx:1092`.
- **Dowód:** `withBudget(Promise.allSettled([... headerAds ...]), budgetMs)`. Granica nagłówka czeka na całe
  `allSettled`, więc wolny endpoint emisji opóźnia nagłówek do 1,2 s, nawet gdy `ready()` jest już
  spełnione. Reklama jest dekoracją, poza listą gotowości i poza predykatem. W `warm` było tak samo, ale
  tam w granicach 600 ms.
- **Poprawka:** kończyć `lateWarm` na `ready()` (wyścig z pracą bez reklamy), a reklamę grzać
  równolegle bez czekania. Albo świadomie zostawić i dopisać to w komentarzu.

### m6 (minor) - komentarz `queryLabel` obiecuje więcej, niż funkcja robi

- **Miejsce:** `src/lib/ssr/resilientLoad.ts:226-243`.
- **Dowód:** „Identyfikatory i obiekty parametrów odpadają”. Odpadają obiekty i liczby, ale identyfikator
  tekstowy na drugiej pozycji klucza przechodzi, np. `["public-profile","<handle>"]` daje
  `public-profile.<handle>`. Dziś predykat jest tylko na `/`, a `loadResilient` bez `label` na innych
  trasach ma w kluczach głównie slugi z URL-a, które już są w `path` linii. PII w praktyce więc nie ma, ale
  kontrakt nie jest szczelny.
- **Poprawka:** brać tylko pierwszy element tekstowy plus drugi, jeśli pasuje do słownika stałych segmentów
  (np. nie wygląda jak UUID ani slug z myślnikami). Albo poprawić komentarz.

## 6. Hydratacja, SEO, a11y, CLS, Lantern

- **Hydratacja:** parytet SSR/klienta bez zmian. `loaderData.degraded` nie jest czytane przez komponenty
  (tylko loader), a granica Suspense nagłówka i jej fallback (`HeaderSkeleton`) są jak dotąd.
- **Boty i SEO:** dostają `allReady`, czyli pełny nagłówek. Linki i meta bez zmian. Dla B2 brak preloadu LCP
  był też wcześniej, a dokument jest teraz zapisany krótko, nie `no-store`.
- **CLS:** dla B1 nagłówek dostrumieniowuje się w ≤ 1,2 s przed hydratacją, zamiast doskoku tickera po
  hydratacji. `HeaderSkeleton` domyślnie rezerwuje pas tickera. Ryzyko jest więc mniejsze niż wcześniej,
  ale wymaga potwierdzenia RUM-em (diagnoza §2.3, [H]).
- **Lantern i laboratorium:** w laboratorium L1 zawsze daje HIT, więc oczekiwana zmiana to około 0. Zysk
  jest produkcyjny: typ A znika przy treści < 1,2 s, a B1/B2 trafiają do L1/L2. Koszt to TTFB zimnego
  MISS-a z wolną treścią (≤ +0,6 s), co plan akceptuje.
- **Zalogowani, edytorzy, `/en`:**
  - `/en` po rewricie to `/`, więc obejmuje go ta sama ścieżka;
  - dokumenty zalogowanych to BYPASS (predykat jest rejestrowany, ale nieczytany);
  - edytor i podgląd bez zmian.

## 7. Dla Prove (wymagane)

1. Pomiar A/B: `check:document-weight`, `check:bundle`, `check:chunks`, `check:entry-purity`,
   `check:server-entry-purity` (m1).
2. `probe.sh slow-first-fold` na B. Oczekiwane wyniki:
   - pierwsze żądanie: MISS z `s-maxage=30`, linia `doc` z `store:"stored"` bez `revalidation:true`;
   - drugie żądanie: HIT z wpisu czytelnika.
3. `probe.sh artifact-boot`: MISS z pełną polityką, potem HIT. Predykat nie może blokować czystego renderu,
   także po scaleniu z P3.8.
4. Log `degradedBy` na artefakcie (m4).
5. `test:e2e:artifact` (zwykły i CI-like) oraz Lighthouse bez regresji.
