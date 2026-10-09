# P3.6b, runda poprawek 2 po recenzji `REVIEW-1.md` (fala 3, partia 2)

- Worktree: `wt3/P3.6b`, gałąź `perf/w3-P3.6b`.
- Nowy commit `8fdfdf05` na `37220be7`. Historii nie przepisywałem.
- Stan na starcie: `git status --short` był pusty. Przerwana próba nie zostawiła niezacommitowanych zmian.
- Odpowiedź na `REVIEW-1.md` (FIX_REQUIRED: 0 blokujących, 1 poważne, 4 drobne):
  - M1 naprawione wariantem preferowanym recenzenta, czyli cofnięciem samej części m4;
  - m-d naprawione razem z M1;
  - m-a, m-b i m-c bez zmian w kodzie, zgodnie z poprawką recenzenta. Uzasadnienie niżej.

## 1. Zmiany, plik po pliku

### `src/lib/ssr/chromeWarmup.tsx` (M1, m-d)

`lateWarm(record, deadline)` wraca do postaci z rundy 9 i zwraca `record.warmLate(remaining)`:

- nie ma już wyścigu `Promise.race([work, ready])`;
- nie ma subskrypcji `QueryCache`;
- nie ma parametru `client`.

Granica nagłówka strony głównej po terminie czeka więc na całą pracę dogrzania. Obejmuje to baner
`header_banner`, czyli dekorację spoza `ready()`. Czas czekania ogranicza wołający:
`withBudget(…, budgetMs)` w korzeniu, najwyżej `HOME_CHROME_LATE_BUDGET_MS` = 1 200 ms od pierwszego odczytu
bramki.

Komentarz `lateWarm` opisuje teraz prawdziwy mechanizm (m-d):

- czekanie na całą pracę działa tak samo jak `warm()` na zwykłej ścieżce, gdy danych nie ma przy pierwszym
  odczycie;
- dogrzanie startuje z bramki, czyli po `dehydrate()`, więc zamiatanie przed renderem go nie anuluje;
- baner puszczony w tle dostrumieniowałby się po HTML-u nagłówka. Skutkiem byłaby niezgodność hydratacji i
  skok ~90 px (F26) w dokumencie, który predykat wpuszcza do NES Edge Cache.

Diff wobec rundy 9 (`1d452919`) dotyczy w tym pliku wyłącznie komentarza.

### `src/routes/__root.tsx` (tylko komentarz `warmLate` w gałęzi chrome po terminie)

Wraca zdanie „reklama jak w `warm`, bo `HeaderSkeleton` rezerwuje jej wysokość z tego wpisu”. Dochodzi
informacja, że granica czeka na całą tę pracę (najwyżej budżet bramki), bo baner dostrumieniowany po nagłówku
rozjechałby hydratację.

Kod się nie zmienia. Wspólne fabryki z m3 (`chromeWarm: Array<(budgetMs) => Promise<unknown>>`, `warmLate` =
`withBudget(Promise.allSettled(chromeWarm.map((work) => work(budgetMs))), budgetMs)`) zostają.

### `src/lib/ssr/__tests__/platformChromeWarmup.test.tsx`

Test „gotowe dane powłoki zwalniają granicę od razu…” zastąpiłem dwoma testami o odwrotnej asercji.

1. **„granica czeka na całą pracę dogrzania: reklama z budżetu jest w cache'u, gdy nagłówek puszcza”.**
   `warmLate` grzeje menu i reklamę (prawdziwe `ensureQueryData` na kluczu
   `["ad_placements","header_banner","home",null]`).
   - Po dojściu menu i 20 ms (powiadomienia `QueryCache` idą przez `setTimeout(0)`) granica NIE puszcza.
   - Po dojściu reklamy granica puszcza. Stan reklamy odczytany w chwili zwolnienia to `status: "success"`,
     `fetchStatus: "idle"`, dane obecne.
   - Rodzaj degradacji to `["chrome"]`.
2. **„wisząca reklama nie trzyma granicy dłużej niż `HOME_CHROME_LATE_BUDGET_MS`”.**
   - `warmLate` ogranicza pracę prawdziwym `withBudget(…, budgetMs)`, tak jak korzeń. Reklama wisi.
   - Test używa fałszywego zegara. Po `HOME_CHROME_LATE_BUDGET_MS - 1` ms granica jeszcze trzyma, po 1 ms
     więcej puszcza.
   - `warmLate` dostaje dokładnie `HOME_CHROME_LATE_BUDGET_MS`. Rodzaj degradacji to `["chrome"]`: powłoka
     gotowa, bez `failed`.

### `src/routes/__tests__/rootRoute.test.tsx`

Atrapa ma nowe pole `h.adsGate`: reklama czeka na obietnicę sterowaną przez test, czyli na emisję wolniejszą
od menu i tickera. Pole jest resetowane w `beforeEach`. Wspólne przygotowanie wydzieliłem do pomocników
`loadExpiredHomeWithChromeDocs()` i `suspendChromeGate()`. Robią dokładnie to, co poprzedni test: `/`, zegar
żądania wygasły przed falą chrome, nagłówek i stopka z sekcjami, `import.meta.env.SSR` na czas loadera.

Test „…releases on ready data” zastąpiłem dwoma testami.

1. **„…late-warms the shared chrome work list and holds the header for a banner within budget”.**
   - `warm` niczego nie grzeje.
   - Po dojściu tickera i prefetchu nagłówka i stopki oraz 50 ms granica NIE puszcza.
   - Po zwolnieniu banera puszcza, a baner ma w tej chwili `status: "success"`.
   - `h.ads` = `["header_banner:home"]`.
   - Budżety prefetchu mieszczą się w (0, `HOME_CHROME_LATE_BUDGET_MS`].
   - Jedynym nagłówkiem jest `chromeDegradedCacheControl()`.
2. **„a hanging banner holds the expired home header no longer than the chrome late budget”.**
   - Baner wisi. Granica puszcza po co najmniej `HOME_CHROME_LATE_BUDGET_MS - 50` ms od odczytu (zegar ścienny,
     luz na zaokrąglenia). To dowód, że nie puściła przy gotowym menu i tickerze.
   - Granica puszcza też w limicie `waitFor` (budżet + 2 s), czyli ogranicza ją `withBudget` korzenia.
   - Ticker jest rozgrzany, baner `pending`, polityka tylko `chrome` (bez `no-store`).

**Kontrola mutacyjna** (logi w `fix2/`):

| mutacja                                              | wynik                                                |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `chromeWarmup.tsx` z `37220be7` (wyścig z `ready()`) | 4/4 nowe testy padają (`vitest-mut-m4.log`)          |
| `warmLate` w korzeniu bez `withBudget`               | test wiszącego banera pada (`vitest-mut-budget.log`) |
| po przywróceniu                                      | wszystko zielone                                     |

## 2. Ustalenia bez zmian w kodzie

### m-a: hunk `__root.tsx` poza gałęzią `expired()`

Recenzent potwierdził, że zachowanie `warm` jest identyczne, a `merge-tree` jest czysty. Ta runda tego hunku
nie rusza: zmienia tylko komentarz `warmLate` wewnątrz gałęzi po terminie.

`git merge-tree --write-tree HEAD` po commicie `8fdfdf05` przechodzi bez konfliktów:

- z `perf/w3-P3.8` (`d66fc7fd`);
- z `perf/w3-P3.3` (`cf0cf8a5`).

Orkiestrator potwierdza przy scaleniu. Gdyby cofał ten hunk, musi dopisać `warmNoActivePopupsOnServer` także do
`warmLate`.

### m-b: archiwum na terminie treści

To nazwane odstępstwo do raportu partii. W trybie „najnowsze wpisy” `home.archive` czeka do
`contentDeadlineAt` (1 200 ms), a nie do wspólnych 600 ms. W tym trybie archiwum jest treścią strony, a bez
tego R3a nie działałoby w tym trybie. Koszt: zimny MISS w tym trybie może mieć TTFB dłuższy o ≤ 0,6 s, ale
tylko przy spóźnionej liście. Produkcja jest dziś w trybie strony statycznej.

### m-c: bajty bootu

W tym etapie nie wolno uruchamiać builda, więc pomiar należy do re-Prove. Ta runda usuwa wyłącznie kod tylko
serwerowy: `lateWarm` woła jedynie `readChromeWarmup`, a tę woła jedynie `ChromeDataGate` pod
`import.meta.env.SSR`. W `__root.tsx` zmienił się tylko komentarz. Klient tej rundy jest więc bajt w bajt
równy rundzie poprawek 1.

Do sprawdzenia w re-Prove, za recenzentem:

- `check:document-weight`: `bootClosureGzipBytes` i `bootBurstGzipBytes`, zapas około 0,6 KB;
- linia `Boot closure` w `check:bundle`: baza 1 636 946 B raw / 496 041 B gz, ± kilkadziesiąt B;
- liczba wystąpień `ad_placements` w chunku wejściowym ma być równa bazie.

## 3. Bramki (worktree `wt3/P3.6b`)

| bramka                                                                                     | wynik                                                                                                      |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `bunx prettier --write` (4 pliki)                                                          | bez zmian formatowania                                                                                     |
| `light.sh bunx eslint` (4 pliki)                                                           | 0 błędów, 4 ostrzeżenia `react-refresh/only-export-components`, takie same jak w bazie (`eslint-fix2.log`) |
| typecheck (`heavy-bg.sh` + `typecheck-noinc.sh`: tsgo app + `tsconfig.scripts.json` + e2e) | exit 0, pusty log (`typecheck-fix2.log`)                                                                   |
| `light.sh bunx vitest run`, 2 zmienione pliki testów                                       | 2/2 pliki, 94/94 testy (`fix2/vitest-a.log`)                                                               |
| `light.sh bunx vitest run`, pełny zestaw pozycji (13 plików, ten sam co w rundzie 1)       | 13/13 plików, 467/467 testów (`vitest-fix2.log`)                                                           |
| `light.sh bun run verify:static`                                                           | 15 bramek OK w 206,3 s, w tym `format:check` (`verify-static-fix2.log`)                                    |
| `git merge-tree` z P3.8 `d66fc7fd` i P3.3 `cf0cf8a5`                                       | bez konfliktów                                                                                             |
| bramki artefaktu, build, e2e, Lighthouse                                                   | nieuruchamiane w tym etapie, należą do re-Prove                                                            |
| `check:ssr-budgets`, `check:loader-policy`                                                 | nie istnieją od PR #475, pominięte                                                                         |

Dyrektywa `:has()`: CSS bez zmian.

## 4. Odstępstwa od planu

Nowych odstępstw nie ma. Do raportu partii przechodzą dwa nazwane odstępstwa:

- **m-a:** hunk `__root.tsx` o trzy linie poza gałęzią `expired()`;
- **m-b:** archiwum w trybie „najnowsze wpisy” na terminie treści.

Wariant alternatywny z recenzji (anulowanie reklamy po wygraniu wyścigu przez `ready()`) odrzuciłem z dwóch
powodów:

- wymagałby przekazania klucza reklamy przez `ChromeWarmup`;
- zostawiłby skok banera po boocie jak w bazie.

Wariant preferowany przywraca stan z rundy 9, który recenzent zaakceptował.

## 5. Ryzyka

- **Baner wiszący dłużej niż budżet bramki (1,2 s).** Granica puszcza na końcu budżetu i nagłówek renderuje
  się bez banera. Zapytanie reklamy leci dalej, a gdy dojdzie przed końcem strumienia, integracja
  router-query może je dostrumieniować po HTML-u nagłówka. Wtedy niezgodność zostaje, a dokument trafia do
  magazynu.
  - Rundy 9 i bazy dotyczy to tak samo. Zwykła ścieżka z danymi niegotowymi przy pierwszym odczycie: `warm()`
    z bramki też startuje po `dehydrate()`, a reklama jest ograniczona tylko `CHROME_WARM_BUDGET_MS`.
  - Okno jest wąskie: reklama siedzi za tym samym `edgeTtlCache` co ticker. Musiałaby się spóźnić o ponad
    1,2 s i mimo to zdążyć przed końcem strumienia.
  - Domknięciem dla obu ścieżek byłoby anulowanie zapytania reklamy po upływie budżetu (`cancelQueries` z
    `revert` i `silent`). To zmiana w `warm` poza zakresem P3.6b. Proponuję ją jako osobną pozycję, jeśli
    orkiestrator uzna okno za istotne.
- **Dłuższe trzymanie granicy niż w rundzie poprawek 1.** Przy wolnej emisji nagłówek strony głównej po
  terminie dostrumieniowuje się później, najwyżej po 1,2 s od odczytu bramki. Treść trasy jest rodzeństwem
  granicy i flushuje się bez czekania, więc LCP i SI na `/` się nie zmieniają. Dotyczy to wyłącznie renderów
  po wygasłym terminie (zimny lub wolny backend, odświeżenie w tle).
- **Testy z zegarem ściennym.** Test wiszącego banera w `rootRoute.test.tsx` trwa ok. 1,2 s i ma dolną granicę
  z luzem 50 ms. Górną granicę daje tylko limit `waitFor` (budżet + 2 s), więc test jest odporny na
  obciążenie CI. Ten sam wzorzec ma istniejący test „waits only the chrome late budget”.

## 6. Na co ma spojrzeć recenzent

1. `chromeWarmup.tsx:72-91`: `lateWarm` w postaci z rundy 9 i nowy komentarz (m-d).
2. `__root.tsx:1082-1093`: przywrócone zdanie o reklamie i `HeaderSkeleton`.
3. `platformChromeWarmup.test.tsx`, dwa nowe testy w bloku „strona główna po terminie”: asercja „nie puszcza
   przy gotowym menu” i stan reklamy w chwili zwolnienia.
4. `rootRoute.test.tsx`, pomocnicy i dwa testy po `pending chrome before the shell flushes`, oraz atrapa
   `h.adsGate`.
5. Re-Prove: m-c (bajty bootu, `ad_placements` w chunku wejściowym), smoke B1/B2 i typ A na artefakcie. Po
   scaleniu partii 2: sondy `base-probe/probe.sh artifact-boot` i `slow-first-fold`.
