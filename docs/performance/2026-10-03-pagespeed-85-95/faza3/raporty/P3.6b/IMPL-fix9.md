# P3.6b, runda poprawek 9 (fala 3, partia 2)

- Worktree: `wt3/P3.6b`, gałąź `perf/w3-P3.6b`.
- Nowy commit: `1d452919` na `80ce4d2b`. Historia nie jest przepisana.
- Stan na starcie: worktree czysty, przerwana próba nie zostawiła niezacommitowanych zmian.

## 1. Ustalenie i odpowiedź

### Blokujące (Prove): domknięcie bootu +298 B raw / +51 B gz

Cały wzrost siedział w chunku wejściowym `index-*.js`. Przyczyną było domknięcie `warmLate` w
`registerChromeWarmup` (`src/routes/__root.tsx`) za bramką `isServer` z `@tanstack/router-core/isServer`. W
buildzie klienta ta wartość nie jest stałą, więc Rollup nie wycinał gałęzi serwerowej. Poprawka jest dokładnie
taka, jaką zaproponował PROVE.md §3.

**`src/routes/__root.tsx`.** Zmiany są tylko w regionach dozwolonych dla P3.6b: gałąź chrome po terminie i
lista celowych zasiewów.

- `warmLate: import.meta.env.SSR && homeDeadline !== undefined ? ... : undefined` zamiast `isServer && ...`.
  Vite podstawia `false` w kliencie, więc minifikator zwija wyrażenie do `undefined`. Całe domknięcie (menu,
  ticker, reklama, `prefetchCachedRouteQueries`) znika z bootu. Na serwerze `import.meta.env.SSR === true`,
  a `homeDeadline` liczy się dalej z `isServer && isHome` (kod bazy), więc zachowanie SSR się nie zmienia.
- `if (import.meta.env.SSR) markDeliberateSeed(context.queryClient, postLayoutKey);` zamiast `if (isServer)`.
  Wywołanie wypada z klienta, a z nim nieużywany tam eksport `markDeliberateSeed`.
- Krótkie komentarze przy obu miejscach mówią, dlaczego bramką jest `import.meta.env.SSR`, a nie `isServer`.
  Minifikacja je usuwa.

Pozostałych użyć `isServer` w korzeniu (`homeDeadline` :716, `chromeOnly` :834, :962, :1115) nie ruszałem. To
kod bazy spoza mojego regionu, a P3.8 może zmieniać sąsiednie funkcje.

`src/routes/index.tsx:313` (`if (isServer) registerDocumentCompletenessCheck(...)`) też zostaje bez zmian. W
buildzie klienta B nie ma `trackSsrQueryCompleteness`: w `.output/public/assets` nie występuje
`action.type==="fetch"` ani `dropped:`. Prove nie wykazał też zmian poza chunkiem wejściowym.

**`src/routes/__tests__/rootRoute.test.tsx`.**

- Test „an expired home shell waits only the chrome late budget…” podstawia `vi.stubEnv("SSR", true)` tylko
  na czas `runLoader`, bo decyzja o `warmLate` zapada w loaderze. Potem jest `vi.unstubAllEnvs()`, powtórzone
  w `finally`. Pod vitestem `import.meta.env.SSR` jest fałszem, a bez atrapy `warmLate` nie powstaje.
  Szerszej atrapy nie da się użyć, bo mock `@/lib/http/responseHeaders` w tym pliku nie ma
  `noteDocumentDegradation`, którego `markFailed` używa pod SSR.
- Nowy test „zasiew układu treści jest CELOWY dla predykatu kompletności tylko w SSR”:
  - pod `SSR=true` loader korzenia deklaruje zasiew, a `trackSsrQueryCompleteness(qc)().reasons` nie zawiera
    `seed:post-layout-settings`;
  - kontrola negatywna: bez SSR, na świeżym `QueryClient`, ten sam zasiew jest raportowany jako
    `seed:post-layout-settings`.

  Test sprawdza zachowanie, a nie tekst źródła.

- Mutacja: obie bramki podmienione na `false`. Oba testy padają (2 failed / 72 passed). Po przywróceniu
  wynik wraca do 74/74.

### Nieblokujące: `public, s-maxage=30` przy wyczerpanej bramce sekcji

Odrzucam, bez zmian w kodzie. Uzasadnienie:

- Nagłówek wychodzi z loadera, przed pierwszym bajtem strumienia. Werdykt o wyczerpanym budżecie
  `ServerSectionGate` zapada dopiero na końcu strumienia, gdy nagłówki dawno wyszły.
- „Naprawa” wymagałaby wstrzymania nagłówków do końca strumienia, czyli rezygnacji ze streamingu.
- O zapisie decyduje dyrektywa wewnętrzna. Predykat poprawnie odrzuca zapis (`store:"degraded"`, etykiety
  `dropped:*`) i uruchamia odświeżenie w tle. Smoke Prove: drugie żądanie to HIT z czystego odświeżenia.
- Na produkcji hosting nadpisuje `cache-control` HTML na `no-cache, must-revalidate, max-age=0` (IMPL §3 (e)),
  więc przeglądarka i tak tego nie przechowa.
- Ten sam kompromis baza już akceptuje dla chrome dostrumieniowanego po flushu (F02: krótka świeżość wspólna
  zamiast `no-store`).

### Koszt TTFB zimnego MISS-a

Plan go akceptuje, a Prove tylko go odnotował, bez zadania dla tej rundy. W tej rundzie nic tu nie zmieniałem.

## 2. Bramki (worktree `wt3/P3.6b`)

| bramka                                                                                                                                                                                                                                                                       | wynik                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `bunx prettier --write` (2 pliki)                                                                                                                                                                                                                                            | bez zmian formatowania                                                                                               |
| `light.sh bunx eslint` (2 pliki)                                                                                                                                                                                                                                             | 0 błędów; 2 ostrzeżenia `react-refresh/only-export-components` (:481, :1368), takie same jak na bazie                |
| typecheck (`heavy-bg.sh` + `typecheck-noinc.sh`: tsgo app + scripts + e2e)                                                                                                                                                                                                   | exit 0, pusty log (`typecheck-fix9.log`)                                                                             |
| vitest, 12 plików pozycji (rootRoute, homeRoute, platformChromeWarmup, documentCompleteness, documentCompletenessPipeline, resilientLoad, homeSsrBudget, documentLogTelemetry, ssrTiming.server, degradedRenderCachePipeline, archiveLoaderResilience, documentCache.server) | 12/12 plików, 430/430 testów (`vitest-fix9.log`)                                                                     |
| `light.sh bun run verify:static`                                                                                                                                                                                                                                             | 15 bramek OK, w tym `format:check` (`verify-static-fix9.log`)                                                        |
| bramki artefaktu (`check:bundle`, `check:document-weight`, …), build, e2e                                                                                                                                                                                                    | nie uruchamiane w tym etapie. Należą do Prove, który ma potwierdzić powrót `bootClosureRawBytes`/`GzipBytes` do bazy |
| `check:ssr-budgets`, `check:loader-policy`                                                                                                                                                                                                                                   | nie istnieją od PR #475, pominięte                                                                                   |

## 3. Odstępstwa od planu

Brak nowych. Odstępstwa z IMPL.md (krótka polityka 30 s / 300 s dla spóźnionych danych nad zgięciem itd.)
obowiązują bez zmian.

## 4. Ryzyka

- **Wynik bajtowy jest wnioskowany, nie zmierzony.** `import.meta.env.SSR` to stała podmieniana przez Vite.
  Tego samego wzorca używa już m.in. `chromeWarmup.tsx`, `sectionStreaming.tsx` i `sanitize.ts`. Oczekuję
  powrotu do bazy ±kilka B, ale potwierdzi to dopiero build w Prove. `.output` w worktree pochodzi z
  poprzedniego commitu.
- **Dwie bramki dają tę samą prawdę na serwerze.** `import.meta.env.SSR` i `isServer` są tam zgodne. W kliencie
  `homeDeadline` i tak jest `undefined`, więc zmiana bramki nie zmienia zachowania w żadnym środowisku. Zmienia
  tylko to, co zostaje w bundlu klienta.
- **Rozjazd w testach.** Testy podstawiające `isServer` przez `vi.mock`, które sprawdzają `warmLate` albo
  celowy zasiew, muszą od teraz podstawiać także `SSR`. Oba przypadki w rootRoute.test.tsx są już
  dostosowane. `platformChromeWarmup.test.tsx` podstawiał `SSR` już wcześniej.

## 5. Na co ma spojrzeć recenzent

- `src/routes/__root.tsx`, dwa miejsca: :917 i :1088. Diff obejmuje tylko te regiony.
- Atrapa `SSR` ograniczona do `runLoader` w teście wygasłego terminu (`rootRoute.test.tsx`), z odtworzeniem
  w `finally`.
- Prove: `bootClosureRawBytes`/`bootClosureGzipBytes`/`bootBurstGzipBytes` w `check:document-weight` i linia
  `Boot closure` w `check:bundle` mają wrócić do bazy (1 636 946 B raw / 496 041 B gz na pomiarze A).

## 6. Wątek użytkownika („jeden font - ma to być Red Hat Display”)

Ta pozycja nie dotyka fontów. Ani ta runda, ani wcześniejsze commity P3.6b nie dodają ani nie zmieniają żadnego
kroju ani preloadu. Prove potwierdza, że w ścieżce krytycznej obu stron pomiaru jedynymi fontami są
`red-hat-display-latin*.woff2`. Zasadę „jeden font” jako zmianę w kodzie realizuje P3.2b (partia 3, decyzja
właściciela w `d22cf7d6`). Jej pliki leżą poza listą tej pozycji.
