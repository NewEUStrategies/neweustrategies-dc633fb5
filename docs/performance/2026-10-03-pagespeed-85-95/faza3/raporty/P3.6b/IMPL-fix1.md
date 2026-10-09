# P3.6b, runda poprawek 1 po recenzji rundy 9 (fala 3, partia 2)

- Worktree: `wt3/P3.6b`, gałąź `perf/w3-P3.6b`.
- Nowy commit `37220be7` na `1d452919`. Historii nie przepisywałem.
- Stan na starcie: `git status --short` był pusty. Przerwana próba nie zostawiła niezacommitowanych zmian.
- Odpowiedź na `REVIEW.md` (FIX_REQUIRED: 1 blokujące, 6 drobnych):
  - B1 naprawione;
  - m2, m3, m4, m5 naprawione w kodzie albo w komentarzu;
  - m1 i m6 bez zmian w kodzie, uzasadnienie niżej.

## 1. Zmiany, plik po pliku

### `src/lib/ssr/resilientLoad.ts`

**B1 (blokujące).** `DECORATIVE_QUERY_ROOTS` zawiera teraz dwa klucze: `"ad_placements"` i
`WIDGET_QUERY_ROOTS.popupsActive` (`"builder-popups-active"`, import z `@/lib/builder/queryKeys`).

Dlaczego:

- P3.8 grzeje w fali chrome korzenia, na każdej trasie z chrome, także `/`, sygnał „brak aktywnych popupów”:
  `setQueryData(["builder-popups-active"], [], { updatedAt: 0 })`.
- Predykat liczył ten wpis jako zasiew awaryjny `seed:builder-popups-active`. U najemcy bez popupów każdy
  render `/` (czytelnik i odświeżenie w tle) kończyłby się `store:"degraded"`.
- Popupy to nakładka spoza HTML-a SSR, czyli ta sama doktryna co reklama. Komentarz przy zbiorze mówi to
  wprost i nazywa skutek braku wyjątku.

**Koszt w bootcie: 0 B.**

- `queryKeys.ts` nie ma importów i już siedzi w chunku wejściowym, razem z `resilientLoad.ts` (sprawdzone na
  `base-w3b/.output`, plik `index-c_XR_U82.js`).
- Zbiór jest używany tylko przez `trackSsrQueryCompleteness`, którego klient nie zawiera. W buildzie B
  (`80ce4d2b`) liczba wystąpień `ad_placements` w chunku wejściowym jest taka sama jak w bazie (5 = 5).

**m5.** Komentarz `queryLabel` opisuje teraz faktyczne zachowanie:

- przechodzą najwyżej dwa wiodące elementy tekstowe;
- odpada wszystko od pierwszego elementu nietekstowego oraz wszystko po drugim elemencie;
- tekstowy drugi element przechodzi, także slug z adresu (`["public-profile","<handle>"]` daje
  `public-profile.<handle>`). Taki slug ta sama linia logu i tak niesie w `path`;
- klucz z identyfikatorem spoza adresu wymaga jawnego `label`.

Kodu nie zmieniałem. Słownik stałych drugich segmentów dla ponad 30 wywołań `loadResilient` bez etykiety
byłby kruchy, a dzisiejsze dane to publiczne slugi z URL-a.

### `src/lib/ssr/chromeWarmup.tsx`

**m4.** `lateWarm(client, record, deadline)` ściga się z `ready()`, a nie czeka na całą pracę
`warmLate`.

- Gotowość wykrywa subskrypcja `QueryCache` żądania. Po subskrypcji jest jeszcze jedno sprawdzenie, gdyby
  dane doszły synchronicznie w trakcie startu `warmLate`.
- Mechanizm: `Promise.race([work, ready]).finally(stop)`.
- Skutek: wolna emisja reklamy (dekoracja spoza `ready()`) nie trzyma granicy nagłówka do końca budżetu
  1,2 s, gdy menu i ticker już są. Tak samo działa zwykła ścieżka: bramka z gotowymi danymi w ogóle nie
  czeka na reklamę.
- Praca biegnie dalej w tle i ogranicza ją `withBudget` po stronie korzenia.
- Gdy `ready()` nie nastąpi, zachowanie jest jak dotąd: koniec budżetu, potem `failed`.

Koszt w kliencie: 0 B. `readChromeWarmup`/`lateWarm` woła wyłącznie `ChromeDataGate` pod
`import.meta.env.SSR`.

### `src/routes/__root.tsx` (tylko region chrome po terminie)

**m3.** Praca fali chrome to teraz fabryki z budżetem w ms, wspólne dla obu dróg:

- `chromeWarm: Array<(budgetMs: number) => Promise<unknown>>`;
- `warm` woła `work(chromeBudget)`, a `warmLate` woła `work(budgetMs)`;
- `warmLate` nie ma już drugiej, ręcznie przepisanej listy (menu, ticker, reklama, prefetch nagłówka i
  stopki).

Żeby fabryki działały także po terminie, zdjąłem dwa martwe dla `warm` warunki `chromeBudget > 0`: w
`tickerWarm` i przy `push` prefetchu. `warm` i tak wraca od razu przy `chromeBudget <= 0`, a `chromeWarm`
nie ma innych użytkowników. Na trasach innych niż `/` `chromeBudget` to zawsze `CHROME_WARM_BUDGET_MS`.
Zachowanie `warm` jest więc identyczne.

Skutek dla scalenia: sygnał popupów, który P3.8 dopisuje przez `chromeWarm.push(...)`, grzeje się
automatycznie także w `warmLate`.

**Region a scalenie z P3.8.**

- Hunki nie sąsiadują z miejscem wstawki P3.8 (po bloku `if (headerAds)`). Od zmienionej deklaracji
  `chromeWarm` dzieli je 9 niezmienionych linii.
- `git merge-tree --write-tree HEAD d66fc7fd` (HEAD P3.8 po jego rundzie 9) przechodzi bez konfliktów, wynik
  `40b4f03c`. Tak samo z P3.3 `cf0cf8a5`.
- W drzewie scalonym `chromeWarm.push(() => warmNoActivePopupsOnServer(...))` z P3.8 typuje się poprawnie,
  bo funkcja bez parametru jest przypisywalna do fabryki z budżetem.

Komentarz przy `warmLate` mówi, że granica czeka tylko do `ready()`.

### `src/routes/index.tsx`

**m2.** W trybie „najnowsze wpisy” `home.archive` dostaje `deadlineAt: contentDeadlineAt` (1 200 ms od startu
zegara żądania) zamiast wspólnych 600 ms. W tym trybie archiwum jest treścią strony. Wcześniej lista
spóźniona o 600-1 200 ms dawała pustą siatkę i `no-store`, więc R3a działało tylko w trybie strony
statycznej. Komentarze przy `contentDeadlineAt` i przy wywołaniu mówią to wprost.

### Testy (zachowanie, nie tekst źródła)

**`src/lib/ssr/__tests__/documentCompleteness.test.ts`:**

- pozytywny: zapis identyczny z `warmNoActivePopups` daje `complete:true`. Test sprawdza też przesłankę:
  wpis ma `status:"success"`, `dataUpdatedAt:0`, `fetchStatus:"idle"`;
- negatywny: ta sama pusta lista z `updatedAt:0` pod kluczem treści (`global-widgets`) daje
  `seed:global-widgets`, a wyjątek dotyczy tylko korzenia popupów;
- `queryLabel`: nowy przypadek `["public-profile","jan-kowalski"]` daje `public-profile.jan-kowalski`
  (zachowanie z komentarza).

**`src/lib/ssr/__tests__/platformChromeWarmup.test.tsx`:** granica puszcza po `ready()`, gdy menu doszło, a
„reklama” w `warmLate` wciąż wisi. Rodzaje degradacji: tylko `chrome`, bez `failed`.

**`src/routes/__tests__/rootRoute.test.tsx`:** loader korzenia na `/` z terminem wygasłym przed falą chrome.

- `warm` niczego nie grzeje.
- `warmLate` grzeje tę samą listę: ticker, baner `header_banner:home` (wisi), prefetch nagłówka i stopki, z
  budżetem w (0, `HOME_CHROME_LATE_BUDGET_MS`].
- Granica puszcza w czasie poniżej 500 ms mimo wiszącego banera.
- Po odczycie bramki jedynym nagłówkiem jest `chromeDegradedCacheControl()`.

**`src/routes/__tests__/homeRoute.test.tsx`** (nowa atrapa `archiveDelayMs`):

- lista po 900 ms jest prawdziwa: `degraded:false`, `dataUpdatedAt>0`, `s-maxage=900`;
- kontrola: lista po 5 s. Po wspólnym terminie loader dalej czeka, a w terminie treści zasiewa pustą siatkę
  (`dataUpdatedAt:0`) dokładnie w `homeContentDeadline` i daje `private, no-store`.

**Kontrola mutacyjna.**

- Cofnąłem trzy poprawki naraz: B1 (klucz popupów poza zbiorem), m4 (`lateWarm` czeka na całą pracę) i m2
  (archiwum na `deadlineAt`). Wszystkie 6 nowych testów padło, 168 pozostałych przeszło
  (`mut-fix1/vitest-mut.log`).
- Po przywróceniu: 174/174.

**Dowód na scalonym drzewie P3.6b + P3.8.**

- `git archive 40b4f03c` rozpakowałem do scratchpada, bez dotykania repo ani worktree.
- Przeszło 7 plików / 229 testów. Wśród nich `popupsHooks.test.tsx` z P3.8 i scratchowy test, który łączy
  prawdziwe `warmNoActivePopups` z P3.8 z prawdziwym predykatem: wynik `complete:true`.
- Ten sam scratchowy test bez poprawki B1 pada z `seed:builder-popups-active`, co potwierdza diagnozę
  recenzenta.
- Logi: `vitest-merge38.log`, `vitest-merge38-mut.log`. Katalog scalenia usunąłem.

## 2. Ustalenia odrzucone albo przeniesione (bez zmian w kodzie)

### m1: `public, max-age=0, s-maxage=30, stale-while-revalidate=300` przy dokumencie odrzuconym przez magazyn

To świadomy kompromis streamingu, zgodnie z poprawką recenzenta („No code change”). Do raportu partii
proponuję taki zapis:

> Nagłówek wychodzi z loadera przed pierwszym bajtem strumienia. Werdykt o wyczerpanej bramce sekcji (a na
> `/` po terminie: `failed` po budżecie bramki chrome) zapada na końcu strumienia, gdy nagłówki dawno wyszły.
> Zapisem do NES Edge Cache rządzi dyrektywa wewnętrzna i predykat: `store:"degraded"` plus odświeżenie w
> tle. Hosting nadpisuje dziś `cache-control` HTML-a na `no-cache, must-revalidate, max-age=0`. **Warunek
> dla każdej przyszłej warstwy CDN przed hostingiem: nie może honorować `s-maxage` HTML-a aplikacji.**

### m6: bajty bootu po rundzie 9 i po tej rundzie

Builda w tym etapie nie wolno uruchomić, więc pomiar należy do re-Prove. Oczekiwania:

- `resilientLoad.ts` i `chromeWarmup.tsx`: 0 B w kliencie (kod tylko serwerowy, uzasadnienie wyżej).
- `__root.tsx` w kliencie: znika `chromeBudget>0&&` w `tickerWarm` i `if(chromeBudget>0)` przy prefetchu.
  Dochodzi parametr fabryki i argument `work(chromeBudget)`. `warmLate` jest wycinane (`import.meta.env.SSR`).
  Netto spodziewam się kilkunastu bajtów raw mniej w chunku wejściowym.
- `index.tsx`: `deadlineAt:contentDeadlineAt` zamiast skrótu `deadlineAt`, czyli kilka bajtów raw.
  `contentDeadlineAt` jest już zmienną klienta.

Re-Prove ma potwierdzić, że `bootClosureRawBytes`/`bootClosureGzipBytes`/`bootBurstGzipBytes` w
`check:document-weight` i linia `Boot closure` w `check:bundle` wracają do bazy (1 636 946 B raw /
496 041 B gz) w granicach kilkudziesięciu bajtów.

## 3. Bramki (worktree `wt3/P3.6b`)

| bramka                                                                                                                                                                         | wynik                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `bunx prettier --write` (8 plików)                                                                                                                                             | bez zmian formatowania                                                                                     |
| `light.sh bunx eslint` (8 plików)                                                                                                                                              | 0 błędów, 4 ostrzeżenia `react-refresh/only-export-components`, takie same jak w bazie (`eslint-fix1.log`) |
| typecheck (`heavy-bg.sh` + `typecheck-noinc.sh`: tsgo app + `tsconfig.scripts.json` + e2e)                                                                                     | exit 0, pusty log (`typecheck-fix1.log`)                                                                   |
| `light.sh bunx vitest run`, 4 pliki zmienione                                                                                                                                  | 4/4 pliki, 174/174 testy (`vitest-fix1-a.log`)                                                             |
| `light.sh bunx vitest run`, pełny zestaw pozycji (13 plików, w tym `queryKeys.test.ts`, `documentCompletenessPipeline`, `degradedRenderCachePipeline`, `documentCache.server`) | 13/13 plików, 465/465 testów (`vitest-fix1.log`)                                                           |
| `light.sh bun run verify:static`                                                                                                                                               | 15 bramek OK w 331,5 s, w tym `format:check` (`verify-static-fix1.log`)                                    |
| `git merge-tree` z P3.8 `d66fc7fd` i P3.3 `cf0cf8a5`                                                                                                                           | bez konfliktów                                                                                             |
| vitest na drzewie scalonym P3.6b+P3.8                                                                                                                                          | 7/7 plików, 229/229 testów                                                                                 |
| bramki artefaktu, build, e2e, Lighthouse                                                                                                                                       | nie uruchamiane w tym etapie (należą do re-Prove, zob. m6)                                                 |
| `check:ssr-budgets`, `check:loader-policy`                                                                                                                                     | nie istnieją od PR #475, pominięte                                                                         |

Dyrektywa `:has()`: bez zmian w CSS.

## 4. Odstępstwa od planu

Nowych odstępstw od mechanizmu planu nie ma. Dwie uwagi:

- **Region `__root.tsx` (m3).** Edycja wykracza o trzy linie poza samą gałąź `expired()`: deklaracja
  `chromeWarm`, warunek w `tickerWarm` i `push` prefetchu. Tego wymagała poprawka zaproponowana przez
  recenzenta (wspólne fabryki), a jej celem jest wyłącznie ścieżka chrome po terminie. Zachowanie `warm` się
  nie zmienia, a scalenie z P3.8 przechodzi bez konfliktu (sekcja 1). Jeśli orkiestrator woli trzymać ten
  region nietknięty, commit da się cofnąć w tym jednym hunku. Wtedy przy scalaniu trzeba dopisać
  `warmNoActivePopupsOnServer` także do `warmLate`.
- **Odstępstwo 8 z IMPL.md** (archiwum w trybie „najnowsze wpisy” na 600 ms) jest zamknięte przez m2.

## 5. Ryzyka

- **Zakres wyjątku dekoracyjnego.** Obejmuje każdy stan klucza `builder-popups-active`: zasiew, błąd, brak.
  Tak ma być: wpis jest sygnałem bramki montażu hosta, a nie treścią dokumentu. Brak wpisu oznacza, że host
  montuje się jak dotąd.
- **Subskrypcja w `lateWarm`** zwalnia się w `finally` wyścigu. Praca `warmLate` jest ograniczona
  `withBudget`, więc wyścig zawsze się rozstrzyga. Wyjątkiem byłoby `warmLate` bez budżetu, którego korzeń nie
  podaje.
- **Wcześniejsze zwolnienie granicy.** Nagłówek może się dostrumieniować, zanim baner dojedzie. Tak było już
  na zwykłej ścieżce `/`, gdzie bramka z gotowymi danymi nie czeka na reklamę. `HeaderSkeleton` i
  `AdZone` czytają ten sam wpis. Gdy wpis nie zdąży, baner zachowuje się jak przy wolnej emisji w bazie.
  Nowego przesunięcia po hydratacji to nie wprowadza.
- **Archiwum na terminie treści.** Zimny MISS w trybie „najnowsze wpisy” może czekać do +600 ms dłużej na
  TTFB, ale tylko gdy lista się spóźnia. Plan to akceptuje (R3a), a produkcja jest dziś w trybie strony
  statycznej.

## 6. Na co ma spojrzeć recenzent

1. `resilientLoad.ts:198-216`: zbiór dekoracji i jego uzasadnienie. Recenzent może też rozważyć, czy woli
   deklarację `markDeliberateSeed` w `warmNoActivePopups` przy scalaniu. Obie drogi dają ten sam wynik, a
   droga w P3.6b nie zależy od kolejności scalania.
2. `chromeWarmup.tsx:83-97`: wyścig z `ready()` i ponowne sprawdzenie po subskrypcji.
3. `__root.tsx:1035`, `:1064`, `:1092-1103`: wspólne fabryki. Recenzent może porównać z drzewem scalonym
   `40b4f03c`.
4. `index.tsx:206`: archiwum na `contentDeadlineAt`.
5. Po scaleniu partii 2 (z recenzji, punkt 6.3): sonda `base-probe/probe.sh artifact-boot` na artefakcie, MISS
   z pełną polityką, potem HIT z przebiegu czytelnika. Do tego `slow-first-fold` (B2 zapisany).
