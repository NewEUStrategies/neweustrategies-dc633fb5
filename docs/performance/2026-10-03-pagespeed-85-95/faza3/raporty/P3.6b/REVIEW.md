# Recenzja P3.6b (fala 3, partia 2), stan po rundzie 9: `1d452919`

Worktree: `scratchpad/wt3/P3.6b` (gałąź `perf/w3-P3.6b`). Diff `claude/zen-ritchie-hzur21...HEAD` obejmuje dwa
commity: `80ce4d2b` i `1d452919`. Recenzja jest adwersaryjna i niczego nie edytuje. Poprzednia recenzja
(runda 1, APPROVE) leży w `REVIEW-runda1.md`.

**Werdykt: FIX_REQUIRED.** Ustalenia: 1 blokujące (na poziomie scalenia partii), 0 poważnych, 6 drobnych.

Sam kod P3.6b jest poprawny i mieści się w zakresie. Runda 9 rozwiązała needs_fix z Prove (+298 B bootu).
Blokuje go jedno: P3.8 z tej samej partii wprowadza celowy zasiew z `updatedAt: 0`, a predykat P3.6b uzna go
za zgubione dane. Bez poprawki po scaleniu `/` przestaje trafiać do NES Edge Cache. Poprawka jest tania i leży
w pliku P3.6b (B1).

## 1. Zakres plików i commit

- **Pliki.** Diff ma 20 plików, wszystkie z listy notatek. Źródła: `index.tsx`, `documentCache.server.ts`,
  `responseHeaders.ts`, `chromeWarmup.tsx`, `resilientLoad.ts`, `homeSsrBudget.ts`. Do tego:
  - `ssrTiming.ts`: tylko pole `degradedBy` i jego sanityzacja;
  - `server.ts`: tylko `logDocument` i jeden import;
  - `__root.tsx`: tylko import `markDeliberateSeed`, deklaracja przy zasiewie `post-layout-settings` (lista
    celowych zasiewów) i własność `warmLate` w `registerChromeWarmup` (gałąź chrome po terminie).

  Reszta to testy. Nie ma zbędnych plików ani nowych zależności (`package.json` i `bun.lock` bez zmian).

- **Scalenia z innymi pozycjami.** `git merge-tree` z HEAD P3.8 (`97ae43c1`) i P3.3 (`cf0cf8a5`) przechodzi bez
  konfliktów tekstowych. Konflikt semantyczny opisuje B1.
- **Commity.** Oba mają polskie opisy i dokładnie wymagany trailer (`Co-Authored-By: Claude Opus 5.5 …` oraz
  `Claude-Session: …`). Komentarze w kodzie są po polsku.

## 2. Mechanizm a plan (R2 a-c, R3a, R7c, e)

### (a) Predykat kompletności

Predykat żyje per `Request` w WeakMap, tak jak `routeCacheDirectives`. Odrzuca dokument, gdy zachodzi któryś
z warunków:

- `error`;
- `success` z `dataUpdatedAt<=0`, jeśli zasiew nie jest zadeklarowany jako celowy;
- `dropped`: zapytanie pobierane po uzbrojeniu, a na końcu nieobecne albo bez danych.

Wyczerpanej bramki `ServerSectionGate` predykat nie czyta z flagi. Wykrywa jej skutek (odstępstwo 1,
uzasadnione: `sectionStreaming.tsx` jest poza listą plików). Zamrożenie werdyktu w instancyjnym
`QueryCache.clear` jest konieczne. Integracja `router-ssr-query-core` woła `cancelQueries()` i `clear()` przed
odczytem `done` przez kolektor. Potwierdzają to kontrola mutacyjna i smoke Prove.

### (b) Decyzja na końcu strumienia

`applyDeferredDocumentStore` liczy predykat po `canStillStore()`:

- `false`: etykiety trafiają do rejestru R7c, wywołanie `markLateDegradation("stream")`, `decide("degraded")`;
- `true`: zapis ze świeżością `min(rekord, polityka dyrektywy końcowej)` i nagłówkiem `narrowestCacheControl`.

Sprawdziłem, że `narrowestCacheControl` nie poszerza polityki, a `canStillStore` odrzuca `private`/`no-store`
wcześniej. `finalPolicy` nie da więc `freshMs` dla polityki nieskładowalnej.

### (c) Chrome po wygasłym terminie

`warmLate` z budżetem 1 200 ms od pierwszego odczytu bramki oznacza `chrome`, a jeśli po tym czasie danych
wciąż brak, `failed`. Szczegóły:

- Trasy bez `warmLate` działają jak dotąd. Przepływ obietnic przeanalizowałem: dla nich `lateWarm` rozstrzyga
  się od razu.
- Lista pracy `warmLate` pokrywa się z `chromeWarm` w bazie: menu, ticker, reklama, widgety nagłówka i stopki.

### (d) R3a

- `home.page` i `home.mode` mają termin `homeContentDeadline` (1 200 ms) na tym samym zegarze żądania.
- Typ A to `degraded`, czyli zawsze `private, no-store`. Dodatkowo predykat zgłasza `seed:public.home-page`.

### (e) `no-cache, must-revalidate, max-age=0` na produkcji

Wyjaśnienie z IMPL §3 jest przekonujące. To nadpisanie przez hosting dla `text/html`: `robots.txt` i
`sitemap.xml` niosą wartość aplikacji, a HTML i HIT, i BYPASS dostaje tę samą wartość. W repo nie ma czego
naprawiać.

### R7c `degradedBy`

Zgodne z planem:

- etykiety dopisywane tylko przy `degraded:true`;
- zamknięty alfabet, sufit 8 w linii i 16 w rejestrze;
- izolacja żądań (test);
- end-to-end na artefakcie (Prove: `degradedBy:["home.page"]` i `dropped:*`).

### Runda 9

Gałęzie `warmLate` i `markDeliberateSeed` w korzeniu są teraz za `import.meta.env.SSR`. W `.output` worktree
(build `80ce4d2b`, sprzed rundy 9) nie ma w zasobach klienta `ad_placements`-Set ani `dropped:`. Kod predykatu
z `index.tsx` (`if (isServer)`) jest więc wycinany już teraz, a runda 9 dotyczy tylko domknięcia w korzeniu.
Bajtów po rundzie 9 nie zmierzono. Pomiar należy do re-Prove, zgodnie z IMPL-fix9 §4.

## 3. Bramki uruchomione w recenzji

| bramka                                                                                 | wynik                                                                                        |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `light.sh bunx eslint` (20 plików diffu)                                               | 0 błędów, 4 ostrzeżenia `react-refresh/only-export-components` (te same eksporty co w bazie) |
| `bunx prettier --check` (20 plików)                                                    | OK                                                                                           |
| `light.sh bunx vitest run` (11 plików testów z diffu + `documentCache.server.test.ts`) | 12/12 plików, 430/430 testów (`review2/vitest.log`)                                          |
| `light.sh bun run verify:static`                                                       | 15 bramek OK w 289,7 s (`review2/verify-static.log`)                                         |
| typecheck, build, bramki artefaktu, e2e, Lighthouse                                    | nieuruchamiane (zgodnie z zadaniem)                                                          |
| `check:ssr-budgets`, `check:loader-policy`                                             | nie istnieją od PR #475, pominięte                                                           |

**Testy sprawdzają mechanizm, nie sam render.**

- Smoke w procesie (`documentCompletenessPipeline.test.tsx`) łączy prawdziwy `requestHandler`,
  `applyDeferredDocumentStore`, prawdziwą `ServerSectionGate` i sprzątanie integracji.
- Asercje dotyczą `x-nes-cache` drugiego żądania, liczby wpisów, `degradedAt:"stream"` i świeżości ≤ 30 s.
- Kontrole negatywne B1/B2 i typu A są obecne. Jest też wariant typu A z przepuszczającym nagłówkiem.
- Nowy test rundy 9 w `rootRoute.test.tsx` ma kontrolę negatywną: bez `SSR` ten sam zasiew jest zgłaszany jako
  `seed:post-layout-settings`.
- Atrapa `SSR` jest ograniczona do `runLoader` i odtwarzana w `finally`.

## 4. Ustalenia

### B1 (blocking, scalenie partii 2): pusta lista popupów z P3.8 sprawi, że predykat nigdy nie przepuści `/`

- **Miejsce:** `src/lib/ssr/resilientLoad.ts:204` (`DECORATIVE_QUERY_ROOTS`) i `:269-271` (reguła `seed:`).
  Po drugiej stronie `wt3/P3.8`: `src/lib/builder/popups.ts:252` i `src/routes/__root.tsx` (`chromeWarm.push(()
=> warmNoActivePopupsOnServer(...))`).
- **Dowód:**
  - P3.8 grzeje w fali chrome korzenia, na każdej trasie z chrome, także `/`, sygnał „brak aktywnych popupów”:
    `queryClient.setQueryData(["builder-popups-active"], [], { updatedAt: 0 })`.
  - Sprawdziłem na `@tanstack/query-core` z repo, że taki wpis ma `status:"success"`, `dataUpdatedAt:0` i
    `fetchStatus:"idle"`.
  - `trackSsrQueryCompleteness.evaluate` liczy go jako `seed:builder-popups-active`. Klucz nie jest ani w
    `DECORATIVE_QUERY_ROOTS`, ani zadeklarowany przez `markDeliberateSeed`, a zamiatarka go nie usuwa (usuwa
    tylko zapytania w locie).
  - Skutek: u najemcy bez aktywnych popupów każdy render `/` (czytelnik i rewalidacja w tle) kończy się
    `store:"degraded", degradedAt:"stream"`. Odświeżenie w tle też nie przechodzi predykatu.
  - Strona główna przestaje więc trafiać do L1/L2: każdy czytelnik płaci MISS. To regres TTFB całej
    najczęstszej trasy na produkcji. Harness Lighthouse po scaleniu przerwie się na braku HIT-u.
  - IMPL §5 nazywa to ryzyko („jeśli P3.8 … zasiewa coś celowo z `updatedAt: 0`, trzeba je dopisać”), ale go
    nie domyka, a dziś jest już konkretne.
- **Poprawka (w pliku P3.6b, bez czekania na scalenie):**
  1. Dopisać `"builder-popups-active"` do `DECORATIVE_QUERY_ROOTS`. Można użyć `WIDGET_QUERY_ROOTS.popupsActive`
     z `@/lib/builder/queryKeys` (klucz istnieje w bazie). Popupy to nakładka spoza HTML-a SSR, czyli ta sama
     doktryna co reklama. Kod jest wycinany z klienta razem z `trackSsrQueryCompleteness`, więc koszt w bootcie
     wynosi 0 B.
  2. Dodać w `documentCompleteness.test.ts` test zachowania: `setQueryData(["builder-popups-active"], [],
{ updatedAt: 0 })` daje `complete:true`. Kontrola negatywna: ten sam zasiew pod innym kluczem daje `seed:`.

  Alternatywa należy do orkiestratora przy scalaniu: `markDeliberateSeed(queryClient, queryKey)` w
  `warmNoActivePopups` (plik P3.8).

  Po scaleniu partii 2 trzeba koniecznie puścić sondę `base-probe/probe.sh artifact-boot` na artefakcie: MISS z
  pełną polityką, potem HIT z przebiegu czytelnika.

  Uwaga poboczna: zasiew `fontScale` z P3.8 (`updatedAt: 0` tylko po porażce) jest prawdziwym fallbackiem i P3.8
  dokłada go do pętli anulowania motywu (`no-store`), więc zgłoszenie `seed:` jest tu poprawne.

### m1 (minor): nagłówek wychodzący `public, s-maxage=30` przy dokumencie odrzuconym przez magazyn

- **Miejsce:** `src/routes/index.tsx:301-307`, `src/lib/ssr/chromeWarmup.tsx:113-124`.
- **Dowód:** odnotowane w Prove §2 i odrzucone w IMPL-fix9. Dwa przypadki:
  - wyczerpana bramka sekcji: `aboveFoldLate` daje 30 s w nagłówku, a predykat odrzuca zapis;
  - na `/` po terminie: `markDegraded("chrome")` przed flushem, a potem `failed` po budżecie bramki.

  W obu przypadkach nagłówek wyszedł przed werdyktem. W bazie `/` po terminie wysyłało od razu `no-store`. Dziś
  ryzyka praktycznie nie ma, bo hosting nadpisuje HTML na `no-cache, must-revalidate, max-age=0`, a NES Edge
  Cache decyduje po dyrektywie wewnętrznej. To ta sama klasa co F02 w bazie dla innych tras.

- **Poprawka:** bez zmian w kodzie. Wpisać do raportu partii jako świadomy kompromis streamingu. Dla każdej
  przyszłej warstwy CDN przed hostingiem warunkiem jest to, że nie honoruje `s-maxage` HTML-a aplikacji.

### m2 (minor): tryb „najnowsze wpisy” zostaje przy 600 ms (R3a nie działa w tym trybie)

- **Miejsce:** `src/routes/index.tsx:197-204`.
- **Dowód:** treść, która przyjdzie w 600-1 200 ms, zostawia `home.archive` z wyczerpanym `deadlineAt`.
  `loadResilient` wtedy zasiewa pustą listę, a dokument idzie jako `no-store`. Odstępstwo 8 jest nazwane, a
  produkcja jest dziś w trybie strony statycznej. Bez zmian od rundy 1.
- **Poprawka:** dla `home.archive` użyć `contentDeadlineAt`, bo w tym trybie archiwum jest treścią, i dodać
  test w `homeRoute.test.tsx`. Można to zrobić w późniejszej pozycji.

### m3 (minor): `warmLate` powtarza listę `chromeWarm`

- **Miejsce:** `src/routes/__root.tsx:1088-1105` wobec `:1030-1062`.
- **Dowód:**
  - Po scaleniu z P3.8 `chromeWarm` dostaje `warmNoActivePopupsOnServer`, a `warmLate` nie. Dziś jest to
    nieszkodliwe: brak wpisu oznacza, że host montuje się jak dotąd.
  - To jednak pokazuje dryf. Klucz dodany do `chromeQueryKeys`/`chromeWarm` bez dopisania do `warmLate` sprawi,
    że po terminie `ready()` nie zostanie spełnione, więc `failed` i `no-store` na każdym wolnym MISS-ie `/`.
- **Poprawka:** fabryki pracy chrome sparametryzowane budżetem (`(budgetMs) => Promise`), używane przez `warm`
  i `warmLate`. Najlepiej przy scalaniu z P3.8, bo zmiana dotyka tego samego regionu.

### m4 (minor): `warmLate` czeka na reklamę (dekorację)

- **Miejsce:** `src/routes/__root.tsx:1096`.
- **Dowód:** `withBudget(Promise.allSettled([... headerAds ...]), budgetMs)`. Wolna emisja trzyma granicę
  nagłówka do 1,2 s, nawet gdy `ready()` jest już spełnione. Reklama nie wchodzi do listy gotowości ani do
  predykatu.
- **Poprawka:** kończyć dogrzanie na `ready()` (wyścig z pracą bez reklamy), a reklamę grzać bez czekania. Albo
  świadomie zostawić i dopisać uzasadnienie w komentarzu. W komentarzu już jest: „HeaderSkeleton rezerwuje jej
  wysokość”.

### m5 (minor): komentarz `queryLabel` obiecuje więcej, niż funkcja robi

- **Miejsce:** `src/lib/ssr/resilientLoad.ts:225-243`.
- **Dowód:** zgodnie z komentarzem identyfikatory mają odpadać. Odpadają jednak tylko obiekty i liczby, a
  tekstowy identyfikator na drugiej pozycji przechodzi: `["public-profile","<handle>"]` daje
  `public-profile.<handle>`. Predykat jest tylko na `/`, a etykiety innych tras to slugi z URL-a, więc PII w
  praktyce nie ma.
- **Poprawka:** poprawić komentarz albo przepuszczać drugi segment tylko ze słownika stałych.

### m6 (minor): bajty bootu po rundzie 9 niezmierzone

- **Miejsce:** `src/routes/__root.tsx:917`, `:1088`.
- **Dowód:** wzorzec `import.meta.env.SSR` jest w repo sprawdzony (`chromeWarmup.tsx`, `sectionStreaming.tsx`),
  ale `.output` w worktree pochodzi z `80ce4d2b`. Zapas `bootClosureGzipBytes` wynosi ok. 0,5 KB.
- **Poprawka:** w re-Prove sprawdzić, czy `check:document-weight` (`bootClosureRawBytes`/`GzipBytes`,
  `bootBurstGzipBytes`) i linia `Boot closure` w `check:bundle` wracają do bazy (1 636 946 B raw / 496 041 B gz).

## 5. Hydratacja, SEO, a11y, CLS, Lantern, użytkownicy

- **Hydratacja i parytet SSR/klienta:** bez zmian.
  - `loaderData.degraded` czyta wyłącznie loader, a komponent tylko `heroPreloads`.
  - Granica Suspense nagłówka i `HeaderSkeleton` działają jak dotąd. `warmLate` istnieje tylko na serwerze, a
    klient i tak nie woła `readChromeWarmup`.
- **SEO:** linki, meta i preloady się nie zmieniły. Boty dostają `allReady`. B1/B2 (brak preloadu LCP przy
  spóźnionym hero) jest objęty krótką polityką (odstępstwo 4).
- **CLS:** dla B1 nagłówek dostrumieniowuje się przed hydratacją, zamiast doskakiwać po niej. Nie powstaje nowa
  późna zmiana wizualna po stronie klienta.
- **Lantern i SI:** kod klienta jest bez zmian (cel serwerowy), więc w laboratorium L1 zawsze daje HIT. Prove
  potwierdził kształt filmstripu i delty w MDE. Zysk jest produkcyjny, a koszt to TTFB zimnego MISS-a przy
  wolnej treści (≤ +0,6 s, plan to akceptuje).
- **Zalogowani, redakcja, `/en`:**
  - `/en` po rewricie to `/`, więc obejmuje go ta sama ścieżka;
  - dokumenty zalogowanych idą jako BYPASS, więc predykat jest rejestrowany, ale nieczytany, a subskrypcja
    zwalnia się na `clear()`;
  - edytor bez zmian.
- **Prywatność:** etykiety `degradedBy` mają zamknięty alfabet i nie niosą wartości (zob. m5).

## 6. Przed scaleniem

1. B1: dopisać `builder-popups-active` do `DECORATIVE_QUERY_ROOTS` i dodać test zachowania (albo deklarację
   celowego zasiewu w P3.8 przy scalaniu).
2. Re-Prove po rundzie 9 i B1: `check:document-weight` i `check:bundle` (m6).
3. Po scaleniu partii 2: sonda `artifact-boot` MISS → HIT z przebiegu czytelnika i `slow-first-fold` (B2
   zapisany).
