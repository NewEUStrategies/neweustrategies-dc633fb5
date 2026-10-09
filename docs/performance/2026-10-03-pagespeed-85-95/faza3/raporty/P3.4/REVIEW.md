# P3.4 (fala 3) - recenzja adwersaryjna

- Worktree: `scratchpad/wt3/P3.4`, commit `c3433c56` na `claude/zen-ritchie-hzur21` (`c606bfa4`).
- Diff: 5 plików, wszystkie z listy P3.4 (`src/lib/boot/bootLoaderScript.ts`, `src/lib/boot/bootSet.server.ts`,
  `src/lib/boot/__tests__/*` ×2, `e2e/boot-home.spec.ts` = istniejąca specyfikacja e2e bootu). Brak plików spoza
  listy, brak nowych zależności, brak zbędnych plików. Commit po polsku, stopka dokładnie jak wymagana.
- **Werdykt: APPROVE** (brak blokujących). Dwie uwagi `major` dotyczą realizmu Lantern i decyzji w Prove/rundzie
  poprawek, nie błędu w kodzie.

## Bramki uruchomione w recenzji

| bramka                                                                          | wynik                                              |
| ------------------------------------------------------------------------------- | -------------------------------------------------- |
| `light.sh bunx eslint` (5 plików)                                               | zielona (exit 0)                                   |
| `light.sh bunx vitest run` `bootLoaderScript.test.ts`, `bootSet.server.test.ts` | 60/60 zielone                                      |
| `light.sh bun run verify:static`                                                | zielona, 15 bramek OK (`review-verify-static.log`) |
| długość `BOOT_LOADER_SCRIPT`                                                    | 2615 B (zgodnie z raportem; baza 2733 B)           |
| `e2e-artifact.log` implementatora                                               | 9/9, `.exit` = 0                                   |

Uwaga dla przejrzystości: do pomiaru długości literału utworzyłem w worktree tymczasowy plik testu
(`src/lib/boot/__tests__/zz-len-review.test.ts`) i od razu go usunąłem; `git status` czysty.

Sprawdzone offsety w dokumencie bazy W3 (`w3/base/lh/home.html`): `#nes-boot-set` 11 727 B, `data-nes-boot`
23 290 B, `</head>` 28 960 B - zgodne z raportem.

## Co sprawdziłem i co się broni

1. **K4i.** `Y(){R||Q();C();T(cap);F||!S||L(X)}` - zero geometrii w handlerze DCL. `X` po rAF + `setTimeout(0)`:
   rAF biegnie PRZED stylem/układem klatki, a zadanie z `setTimeout` zaplanowane w rAF - po aktualizacji
   renderingu, więc odczyt trafia w czysty układ. Ścieżka bez kandydata: pusta lista `I()`, zero `Z()`, `M()` -
   ta sama liczba skoków co dawniej (DCL → rAF → timeout → boot). Reguła (ii): wpisy między DCL a `X` czekają w `V`;
   wpisy LCP są ściśle rosnące, więc ocena tylko ostatniego jest równoważna. Reguła (i) nie zależy od `A`.
   Wyścig `lcp` vs `nocand` (kandydat z wpisem LCP, ale zerowym polem widocznym) - jak w bazie, `B` idempotentne.
2. **MutationObserver.** Przy zestawie przed loaderem stary kod nie konstruował obserwatora (`Q()` → 1), więc
   koszt w śladzie był 0, a usunięcie oszczędza tylko bajty. Zestaw po loaderze: odczyt przy DCL; dla `lcp`
   obserwator LCP z `buffered: true` nie gubi wpisów, dla `now` seria i tak jest w nagłówku `Link`. Bezpieczne.
3. **Seria grupami.** `g=y=="now"?[]:S.g||[]`, warunek `i<j&&i<S.u.length`: śmieci, granice malejące, spoza zakresu,
   napisy (`"3"` porównuje się liczbowo) nie wstawiają `undefined` ani dubli. NFE `J` z `setTimeout(J)` - poprawny
   ES5. Wejście `H` dopiero po ostatniej grupie i po DCL (`readyState`), także gdy DCL przychodzi w trakcie serii.
   Zmienne `i/k/g` w domknięciu `B`, które biegnie raz (`F`).
4. **Serwer.** Granice po deduplikacji `Set`, filtr porównuje z SUROWĄ poprzednią granicą (`bounds[i-1]`) - poprawnie
   odrzuca puste grupy; `g` tylko dla `lcp`; `u` bez zmian, więc `documentWeight.ts` (czyta tylko `m/e/u`), e2e
   `boot-timing` i inni konsumenci są zgodni wstecz. Loader bez `g` = jedna grupa.
5. **SSR/hydratacja, cache.** Loader i zestaw zawsze z tego samego builda w jednym dokumencie (także wpisy cache
   sprzed wdrożenia) - brak niezgodności wersji. Węzeł zestawu nadal usuwany przed wejściem. Brak nowych krawędzi
   importu w domknięciu bootu (stała tylko w gałęzi `.server()`).
6. **Zalogowani/edytor/admin, `/en`.** Sesja zapisana i `prerendering` → `now` → cała seria naraz (test „`now` bez
   czekania” także z `g`). `/en` ma te same asercje e2e co `/`.
7. **Testy.** Asertują mechanizm: licznik `getBoundingClientRect` (0 w DCL i w samym rAF, 1 po klatce), szpieg
   `MutationObserver` (0 konstrukcji), osobne zadania grup (`advanceTimersToNextTimer`), wejście za wszystkimi
   preloadami, DCL przed/w trakcie/po serii, `now` naraz, śmieci w `g`. Mentalny revert: stary loader czerwieni
   K4i, grupy i „zestaw po skrypcie” (implementator raportuje 7 czerwonych). e2e `lateModules` łapie wejście
   wstawione przed ostatnią grupą.
8. **Bajty `<head>`:** loader −118 B, zestaw +12 B (`,"g":[10,19]`) → netto ≈ −106 B; progów nie ruszono.

## Uwagi

### MAJOR-1 (Prove / runda poprawek): (b) najpewniej nie dzieli `ScriptCatchup`; wycofanie musi być pełne, ale decyzja po sprawdzeniu też zadania timera `boot()`

- `bootLoaderScript.ts:122-126` (`J`), `bootSet.server.ts:146-165` (`bounds`, `g`).
- Dowód: sonda implementatora (IMPL §3, 15 przebiegów) - zadanie z 10 `ScriptCatchup` (linkowanie domknięcia
  wejścia po `v8.compileModule` wejścia) jedno w 5/5 każdego wariantu; grupowanie wstawiania `<link>` nie zmienia
  chwili dotarcia odpowiedzi ani linkowania, a w Lantern węzeł `ScriptCatchup` zależy od tych samych żądań. Mechanizm
  (b) strukturalnie nie może podzielić K7. Komentarz w loaderze („żeby dokończenia kompilacji serii nie lądowały
  w jednym długim zadaniu”, `bootLoaderScript.ts:39-40`) opisuje przesłankę, którą własna sonda obaliła.
- Jedyna realna wartość (b), pominięta w IMPL §0: STAN-FALI-2 §6.9 A-1 zalicza do K4i także callback timera
  `boot()` (bot desktop5x: 10,1 / 14,5 ms obs. = 51 / 72 ms sym.). Grupy dzielą właśnie to zadanie (26 `appendChild`
  → 10/9/7).
- Poprawka: Prove w księdze `--compare` raportuje osobno (i) `ScriptCatchup` (liczba zadań i maks. sym.) oraz
  (ii) `Timer:(dokument)` z `B`/`J` w desktop4x/desktop5x. Jeśli (i) nie dzieli się, a (ii) nie spada poniżej 50 ms sym.
  dzięki grupom - wycofać (b) w CAŁOŚCI: emisję `g` w `composeBootSet`, funkcję `J` (z powrotem pojedyncza pętla;
  nie zostawiać martwego kodu w `<head>` każdego dokumentu - właściciel prosi o usuwanie martwego kodu), pole `g`
  w `BootSet`, akapity „SERIA GRUPAMI”/„GRUPY SERII” i asercje `g` w `bootSet.server.test.ts` i
  `e2e/boot-home.spec.ts:66-75` (inaczej e2e oblewa na `bounds.length >= 1`). Jeśli (ii) spada - zostawić (b)
  i poprawić komentarz na prawdziwy powód (podział zadania timera bootu, nie `ScriptCatchup`).

### MAJOR-2 (realizm Lantern): K4i przenosi Style+Layout do zadania pierwszej klatki; kryterium „znika z okna” da się spełnić bez spadku TBT

- `bootLoaderScript.ts:162` (`Y`), `:148-149` (`X`).
- Dowód (ślad bazy `w3/base/lh/desktop4x-2.artifacts/trace.json`, zadanie 97,9 ms): `EventDispatch DOMContentLoaded`
  92,5 → `FunctionCall Y` 72,7 (= `UpdateLayoutTree` 37,0 + `Layout` 34,3) + `RunMicrotasks` 17,4. Bez odczytu
  w DCL ten sam Style+Layout (71 ms obs.) robi zadanie klatki (dziś `Layerize-UpdateLayer` 14,1 ms). Lantern mnoży
  zadania z Layout przez 0,5 × CPU: klatka ~85 ms obs. → ~170 ms sym. → ~120 ms blokowania; reszta zadania DCL
  (~25 ms obs.) traci flagę Layout i dostaje pełne ×4 → ~100 ms sym. → ~50 ms blokowania. Suma ≈ 170 ms wobec
  146 + 6 = 152 ms w bazie (zgodnie z modelem implementatora +8…+41 ms). Jeśli mikrozadania są skutkiem układu
  (np. obietnice fontów), trafią do klatki, a zadanie DCL zniknie - bilans podobny. layoutSI: zadanie z Layout kończy
  się w tym samym miejscu, efekt ~0. Na mobile klatka przychodzi przed DCL (Y 2,6 ms) - obojętne.
- Poprawka (nie w kodzie tej pozycji): Prove porównuje SUMĘ blokowania zadania DCL + pierwszej klatki po DCL
  (klasy `Script:(dokument)`, `Layerize-UpdateLayer`, `Style`) A vs B, nie tylko zniknięcie `Script:(dokument)`.
  Gdy ΔTBT ≥ 0, orkiestrator rozstrzyga utrzymanie K4i (notatka mówi „obowiązkowo”); realne zmniejszenie tej pracy
  należy do P3.3 (`content-visibility`). Zmiana jest bezpieczna funkcjonalnie, więc może zostać jako neutralna.

### MINOR-1: brak strażnika kolejności `#nes-boot-set` przed loaderem

- `src/lib/boot/__tests__/bootSet.server.test.ts` (potok serwera). Po usunięciu `MutationObserver` kolejność węzła
  zestawu względem loadera jest jedyną gwarancją uzbrojenia obserwatora LCP i serii `now` w chwili wykonania
  loadera (inaczej dopiero przy DCL). Dziś potwierdzają ją tylko pomiary (36/36, offset 11 727 vs 23 290 B).
- Poprawka: w teście potoku (`it.each` dokumentu `/`) dodać
  `expect(html.indexOf('id="nes-boot-set"')).toBeLessThan(html.indexOf("data-nes-boot"))` - jeśli test renderuje
  `__root.tsx` z loaderem; w przeciwnym razie ta sama asercja w `e2e/boot-home.spec.ts` na surowym HTML-u.

### MINOR-2: grupy także dla wyzwalacza `input` i w ukrytej karcie

- `bootLoaderScript.ts:121` (`g=y=="now"?[]:S.g||[]`). Boot po pierwszej interakcji dostaje dwa dodatkowe zadania
  timera przed wejściem (sonda: 17-45 ms przy CPU ×4) - to akurat ścieżka, w której użytkownik czeka na
  hydratację. W ukrytej karcie (otwarcie w tle) Chrome wyrównuje timery do 1 s, więc boot `nocand`/`load`/`cap`
  może się wydłużyć o ~2 s (po przełączeniu karty timery dochodzą od razu, więc skutek dla użytkownika mały).
- Poprawka (jeśli (b) zostaje po MAJOR-1): `g=y=="now"||y=="input"||d.hidden?[]:S.g||[]` (kilka bajtów, mieści się
  w odzyskanych 118 B). Bezprzedmiotowe po wycofaniu (b).

### MINOR-3: e2e porównuje `pathname` z URL-em serii

- `e2e/boot-home.spec.ts:118-121`: `new URL(candidate.href).pathname === url` fałszywie oblewa dla bezwzględnych
  URL-i, które `BOOT_URL_RE` (`bootSet.server.ts:110`) dopuszcza (`https?://`). Dziś seria to same ścieżki.
- Poprawka: `candidate.href === new URL(url, window.location.href).href`.

### MINOR-4: ocena reguły (ii) i ramki bez rAF

- `bootLoaderScript.ts:148-149, 162`. Wpis spełniający (ii) sprzed DCL jest teraz przyjmowany jedną klatkę + zadanie
  później (~16-20 ms). W dokumencie, w którym rAF nie biegnie (niewidoczna/ dławiona ramka obca bez sesji), przypadek
  „kandydat widoczny + wpis (ii) sprzed DCL” spada z DCL na `load` + 500 ms albo limit 3 s (dawniej rozstrzygany przy
  DCL). Skutek marginalny; bez zmiany kodu - tylko odnotować w raporcie Prove.

## Zgodność z notatkami orkiestratora

- (a) K4i: zrobione (wariant `setTimeout` po rAF - dopuszczony w planie, uzasadniony w IMPL §4.1); `nocand` bez
  geometrii; reguła (ii) zachowana; `MutationObserver` usunięty z pomiarem kosztu (0 - nieuzbrajany).
- (b) grupy wyznaczane przez serwer, osobne zadania, wejście po ostatniej grupie i po DCL, format zgodny wstecz: zrobione;
  raport „przeglądarka scala” dostarczony (sonda). Wycofanie zgodnie z notatką należy do rundy poprawek po Prove (MAJOR-1).
- `headRawBytes` netto −106 B, progi nietknięte. `test:e2e:artifact` zielone (log implementatora).
- Księga `--compare` (mobile/desktop4x/desktop5x n = 5) nie była zakresem implementacji - należy do Prove.
