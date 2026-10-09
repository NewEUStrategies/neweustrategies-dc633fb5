# Recenzja P3.6b (fala 3, partia 2), stan po rundzie poprawek 2: `8fdfdf05`

Worktree: `scratchpad/wt3/P3.6b` (gałąź `perf/w3-P3.6b`). Diff `claude/zen-ritchie-hzur21...HEAD` ma cztery
commity: `80ce4d2b`, `1d452919`, `37220be7` i `8fdfdf05`. Recenzja jest adwersaryjna i niczego nie edytuje.
Poprzednie recenzje: `REVIEW-runda1.md` (APPROVE), `REVIEW.md` (FIX_REQUIRED) i `REVIEW-1.md` (FIX_REQUIRED,
M1 + m-a do m-d). Głównie sprawdzam commit `8fdfdf05`. Zakres plików, mechanizm i bramki sprawdziłem dla
całego diffu.

**Werdykt: APPROVE.** Ustalenia: 0 blokujących, 0 poważnych, 4 drobne.

- Trzy drobne to przeniesienia z poprzednich recenzji. Należą do re-Prove albo do raportu partii.
- Jedno drobne to ryzyko szczątkowe, które istniało już w bazie. Proponuję je jako osobną pozycję.
- M1 z `REVIEW-1.md` jest naprawione wariantem preferowanym.
- m-d jest naprawione razem z M1.

## 1. Zakres plików, commit, scalenia

- **Pliki.** Diff ma te same 20 plików co po rundzie poprawek 1. Wszystkie są z listy notatek.
  - Źródła: `index.tsx`, `documentCache.server.ts`, `responseHeaders.ts`, `chromeWarmup.tsx`,
    `resilientLoad.ts`, `homeSsrBudget.ts`, `ssrTiming.ts` (tylko `degradedBy`), `server.ts` (tylko
    `logDocument` i jego import), `__root.tsx`.
  - Reszta to testy.
  - Commit `8fdfdf05` dotyka 4 plików: `chromeWarmup.tsx`, `__root.tsx` (tylko komentarz w gałęzi `warmLate`)
    i dwóch plików testów.
  - `git status --short` jest pusty. Nie ma zbędnych plików ani nowych zależności.
- **Commity.** Opisy są po polsku. Każdy z czterech commitów kończy się dokładnie wymaganym trailerem:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` i
  `Claude-Session: https://claude.ai/code/session_018pV9XfFuDnwMxKGJSFfcDg`.
- **Scalenia** (`git merge-tree --write-tree`, bez konfliktów):
  - HEAD z `perf/w3-P3.8` (`d66fc7fd`) daje `aaf32fc6`;
  - HEAD z `perf/w3-P3.3` (`cf0cf8a5`) daje `41fdf479`;
  - baza `claude/zen-ritchie-hzur21` z HEAD też scala się czysto.

## 2. Weryfikacja poprawki M1 (`REVIEW-1.md`)

`src/lib/ssr/chromeWarmup.tsx:87-91`: `lateWarm(record, deadline)` znów zwraca `record.warmLate(remaining)`.
Nie ma już wyścigu z `ready()`, subskrypcji `QueryCache` ani parametru `client`. Diff tego pliku wobec rundy 9
(`1d452919`) to wyłącznie komentarz, co sprawdziłem przez `git diff 1d452919 HEAD`.

Łańcuch z M1 jest zamknięty:

1. Korzeń (`src/routes/__root.tsx:1093-1097`) ogranicza pracę przez `withBudget(allSettled(chromeWarm(budgetMs)),
budgetMs)`.
2. Granica czeka więc najwyżej `HOME_CHROME_LATE_BUDGET_MS` (1 200 ms) od pierwszego odczytu bramki.
3. Reklama, która zdąży w tym budżecie, jest w cache'u w chwili zwolnienia granicy i renderuje się w HTML-u
   nagłówka. Niezgodności hydratacji ani skoku F26 nie ma.

Komentarz `lateWarm` (m-d) opisuje teraz mechanizm prawdziwie. Mówi o czekaniu na całą pracę jak `warm()` przy
danych niegotowych na pierwszym odczycie i o starcie po `dehydrate()`, przez który zamiatanie tej pracy nie
anuluje. W `__root.tsx:1082-1092` wraca zdanie o `HeaderSkeleton`.

**Testy po poprawce.** Sprawdziłem, czy asertują mechanizm i czy złapałyby regres.

- `platformChromeWarmup.test.tsx`, „granica czeka na całą pracę dogrzania…”:
  - test używa prawdziwego `ensureQueryData` na kluczu reklamy;
  - przy gotowym menu granica NIE puszcza;
  - w chwili zwolnienia reklama ma `status: "success"` i `fetchStatus: "idle"`.

  Wyścig z `ready()` (stan `37220be7`) daje `released === true` przed `ad.resolve()`, więc test pada. Zgadza się
  to z kontrolą mutacyjną implementera (`fix2/vitest-mut-m4.log`).

- `platformChromeWarmup.test.tsx`, „wisząca reklama…”:
  - test działa na fałszywym zegarze i używa prawdziwego `withBudget`;
  - granica trzyma do `HOME_CHROME_LATE_BUDGET_MS - 1` ms, a po kolejnej 1 ms puszcza;
  - rodzaj degradacji to `["chrome"]`, a nie `failed`.

  Granica jest dokładna z obu stron.

- `rootRoute.test.tsx`: dwa testy na prawdziwym loaderze korzenia.
  - Atrapa reklamy czeka na `h.adsGate`.
  - Test sprawdza, że granica nie puszcza przy gotowym tickerze i prefetchu, i że baner ma `success` w chwili
    zwolnienia.
  - Wiszący baner trzyma granicę ≥ budżet − 50 ms. Górną granicę daje `withBudget`, bo bez niego test pada
    (`vitest-mut-budget.log`).
  - Sprzątanie jest w `finally`: `unstubAllEnvs`, `cancelQueries`, `clear`.

Testy są behawioralne. Nie sprawdzają listy klas ani tekstu źródła.

## 3. Bramki uruchomione w tej recenzji

Logi są w `phase3/wave3/P3.6b/review4/`.

| bramka                                                                                 | wynik                                                                                                                                                 |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `light.sh bunx eslint` (20 plików diffu)                                               | exit 0: 0 błędów, 4 ostrzeżenia `react-refresh/only-export-components` (`chromeWarmup.tsx:58,93`, `__root.tsx:481,1360`, te same eksporty co w bazie) |
| `light.sh bunx vitest run` (11 plików testów z diffu + `documentCache.server.test.ts`) | 12/12 plików, 439/439 testów, 22,2 s                                                                                                                  |
| `light.sh bun run verify:static`                                                       | 15 bramek OK w 203,0 s (w tym `format:check`), exit 0                                                                                                 |
| typecheck, build, bramki artefaktu, e2e, Lighthouse                                    | nieuruchamiane (zgodnie z zadaniem)                                                                                                                   |
| `check:ssr-budgets`, `check:loader-policy`                                             | nie istnieją od PR #475, pominięte                                                                                                                    |

## 4. Sprawdzenia adwersaryjne całego diffu (bez nowych ustaleń)

- **Tożsamość żądania.** Czytelnik i rewalidacja przechodzą przez tę samą `fetchWithFrameworkPreloads(handler.fetch,
req)` (`src/server.ts:252` i `:542`). `logDocument(synthetic, …)` w rewalidacji używa tego samego obiektu.
  Smoke Prove pokazał `degradedBy` z loadera i z etapu `stream`, więc klucz WeakMap trafia.
- **Kolejność w `applyDeferredDocumentStore`.** Kolejność to: `canStillStore()` (no-store wygrywa), potem
  predykat, potem świeżość z `narrowestCacheControl`. `Math.min` z polityką rekordu nie może wydłużyć wpisu.
  Etykiety idą do linii logu przez `record.request`.
- **Zamrożenie przed `QueryCache.clear()`.** `QueryClient.clear()` woła `#queryCache.clear()` na instancji,
  więc podmiana działa. Zamiatanie przed renderem (`postRenderSweep.ts`) robi `cancel` i `cache.remove`, a nie
  `clear`, więc werdykt nie zamarza za wcześnie.
- **Pobranie z korzenia po uzbrojeniu, a potem zamiecione.** Bramka chrome ponawia klucze z `chromeQueryKeys`
  (wszystkie sekcje nagłówka i stopki oraz ticker). Bramka sekcji ponawia swoje. Gdy ponowienie nie zdąży, to
  samo zapytanie oznacza też `failed` lub `dropped`. Predykat i polityka są więc spójne, a w kierunku „zapis
  niekompletnego” nie ma luki.
- **Zasiewy `updatedAt: 0` w korzeniu.** Motyw (ustawienia, tokeny, kolory) dostaje zasiew wyłącznie przy
  braku danych. Tę samą ścieżkę strona główna już oznacza `no-store` (`__root.tsx:860-866`). `queryFn` tokenów
  i kolorów nigdy nie zwraca wartości fałszywej, więc warunek `!getQueryData` nie strzela przy poprawnych
  danych. Fałszywego „seed:” blokującego zapis kompletnego dokumentu nie ma.
- **Bajty klienta.** W buildzie `80ce4d2b` (`wt3/P3.6b/.output`) w chunku wejściowym `index-DfEvSyUW.js`
  nie ma `registerDocumentCompletenessCheck` ani `action.type==="fetch"`. `isServer` w loaderze `/` zwija się
  do `void 0`. Liczba wystąpień `ad_placements` jest równa bazie (5 wobec 5), więc `Set` dekoracji został
  wycięty. Późniejsze rundy dodały po stronie klienta tylko import `WIDGET_QUERY_ROOTS` (zob. m-c).
- **Hydratacja, SEO, a11y, CLS.** Kod klienta jest bez zmian względem rundy poprawek 1.
  - Gałąź `warmLate` i predykat są tylko serwerowe.
  - Boty dostają `allReady`, więc linki i meta są nietknięte.
  - Zalogowani i redakcja: BYPASS. Predykat się uzbraja, ale nikt go nie czyta, a koszt to jedna subskrypcja
    na żądanie.
  - `/en` idzie tą samą ścieżką.
  - Jedyna późna zmiana wizualna to podmiana `HeaderSkeleton` na nagłówek w zimnym MISS po terminie. Wysokość
    jest zarezerwowana, a zachowanie jest takie samo jak na ścieżce `chrome` bazy.
- **Lantern i SI.** W laboratorium L1 zawsze trafia (HIT), więc ślad Lighthouse'a się nie zmienia. Zysk jest
  produkcyjny: MISS-y B1 i B2 zapisują się z przebiegu czytelnika. To zgadza się z planem.

## 5. Ustalenia

### m-1 (minor): baner wolniejszy niż budżet bramki nadal może się dostrumieniować po nagłówku zapisanego dokumentu

- **Miejsce:** `src/routes/__root.tsx:1093-1097` (`warmLate`) i `warm` (kod bazy).
- **Dowód:** implementer zgłasza to sam w IMPL-fix2 §5.
  - `withBudget` ogranicza czekanie, ale nie anuluje zapytania reklamy.
  - Gdy reklama dojdzie po 1,2 s, ale przed końcem strumienia (np. bramka sekcji do 2 s),
    `router-ssr-query-core` ją dostrumieniuje. Klient dostaje wtedy baner, którego HTML serwera nie ma.
  - Reklama jest dekoracją, więc predykat dokument zapisuje.
  - Ta sama klasa istnieje w bazie na zwykłej ścieżce `chrome` (`warm()` z bramki).
  - Okno jest wąskie: reklama siedzi za tym samym `edgeTtlCache` co ticker, a wolny ticker daje `failed`.
- **Poprawka (osobna pozycja, nie blokuje):** po upływie budżetu fali chrome anulować reklamę, która jeszcze
  leci: `client.cancelQueries({ queryKey: headerAds.queryKey }, { revert: true, silent: true })`. Dotyczy to
  obu dróg (`warm` i `warmLate`). Do tego test, że po zwolnieniu granicy reklama nie jest w stanie `fetching`.

### m-c (minor, przeniesione): bajty bootu po rundzie 9 nadal niezmierzone

- **Miejsce:** `src/lib/ssr/resilientLoad.ts:60` i `:213-216` (import `WIDGET_QUERY_ROOTS` w module chunku
  wejściowego) oraz typ parametru fabryki w `__root.tsx`.
- **Dowód:** zapas `bootClosureGzipBytes` i `bootBurstGzipBytes` wynosi ok. 0,6 KB. Ostatni build pozycji
  to `80ce4d2b`.
- **Poprawka:** w re-Prove sprawdzić:
  - `check:document-weight` i linię `Boot closure` w `check:bundle` (baza 1 636 946 B raw / 496 041 B gz,
    ± kilkadziesiąt B);
  - liczbę wystąpień `ad_placements` w chunku wejściowym (ma być równa bazie, czyli 5).

### m-a (minor, przeniesione): hunk `__root.tsx` o trzy linie poza gałęzią `expired()`

- **Miejsce:** `__root.tsx:1001`, `:1035`, `:1064-1066`.
- **Dowód:** zachowanie `warm` jest równoważne, a scalenie z P3.8 jest czyste (§1).
- **Poprawka:** bez zmian w kodzie. Wpisać jako nazwane odstępstwo do raportu partii. Orkiestrator potwierdza
  przy scaleniu.

### m-b (minor, przeniesione): archiwum w trybie „najnowsze wpisy” na terminie treści

- **Miejsce:** `src/routes/index.tsx:199-207`.
- **Dowód:** R3a wymienia tylko `home.page` i `home.mode`. Odstępstwo jest uzasadnione w komentarzu.
- **Poprawka:** bez zmian w kodzie. Wpisać jako nazwane odstępstwo do raportu partii.

### Uwaga spoza zakresu (bez wpływu na werdykt)

`designTokensQueryOptions` i `globalColorsQueryOptions` (`src/lib/builder/designTokens.ts:107`,
`src/hooks/useGlobalColors.ts:15`) zamieniają błąd backendu na `EMPTY_*` ze statusem `success` i świeżym
stemplem.

- Ani loader korzenia, ani predykat P3.6b tego nie widzą.
- Dokument z domyślnym motywem po chwilowej awarii tokenów zapisuje się z pełną świeżością.
- Tak samo jest w bazie, więc to nie jest regres P3.6b.
- Jeśli orkiestrator uzna to za istotne: osobna pozycja (np. zasiew `updatedAt: 0` zamiast świeżego stempla
  przy `null` z `fetchSiteDesignTokensRow`).

## 6. Przed scaleniem

1. Re-Prove na `8fdfdf05`:
   - `check:document-weight` i `check:bundle` (m-c);
   - `test:e2e:artifact` w środowisku CI-like;
   - smoke B1/B2, typ A i wyczerpana bramka na artefakcie (ten sam `replaySlow.mjs` co w PROVE.md).

   Ścieżka chrome po terminie zmieniła się od ostatniego builda.

2. Raport partii: dwa nazwane odstępstwa (m-a, m-b) i ryzyko szczątkowe m-1 jako kandydat na pozycję.
3. Po scaleniu partii 2: sondy `base-probe/probe.sh artifact-boot` i `slow-first-fold`.
