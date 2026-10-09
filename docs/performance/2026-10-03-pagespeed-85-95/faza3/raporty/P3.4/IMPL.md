# P3.4 (fala 3) - implementacja: K4i (loader bez wymuszonego układu) + seria bootu grupami

- Worktree: `scratchpad/wt3/P3.4`, gałąź `perf/w3-P3.4`, baza `c606bfa4` (= `7c924ae5` + dokumenty fali 3).
- Commit: `c3433c56` (jeden commit na bazie `c606bfa4`).
- Uwaga dla Prove: `.output/` w worktree to build SMOKE (`node-server`) z tej rundy - do `check:bundle`,
  `check:chunks` i Lighthouse potrzebny jest build produkcyjny (`cloudflare-module`).
- Pliki (wyłącznie z listy P3.4): `src/lib/boot/bootLoaderScript.ts`, `src/lib/boot/bootSet.server.ts`,
  `src/lib/boot/__tests__/bootLoaderScript.test.ts`, `src/lib/boot/__tests__/bootSet.server.test.ts`,
  `e2e/boot-home.spec.ts`.
- Dane robocze: `phase3/wave3/P3.4/` (`typecheck.log`, `verify-static.log`, `probe.log`, `probe.json`,
  `build-smoke.log`, `e2e-artifact.log`, `tools/` - sonda przeglądarkowa i model K4i).

## 0. Najważniejsze dla orkiestratora (przed Prove)

1. **(b) najpewniej NIE dzieli `ScriptCatchup`.** Ślad bazy (desktop4x-2) i sonda przeglądarkowa (15 przebiegów, §3)
   pokazują, że zadanie K7 to linkowanie statycznego domknięcia wejścia (10 modułów: `index`, `vendor-react`,
   `vendor-tanstack`, ... `vendor-tw-merge`), uruchamiane PO `v8.compileModule` wejścia, a nie dokończenie kompilacji
   po odpowiedzi `modulepreload` (te są już dziś osobnymi zadaniami 0,5-1,4 ms: `v8.compileModule` 569-627 ms obs.
   w desktop4x-2). Seria grupami działa zgodnie z planem (żądania w 3 zadaniach: 10 / 9 / 7), ale zadanie z 10
   `ScriptCatchup` zostaje jedno w 5/5 przebiegów każdego wariantu (A baza 66-101 ms obs. przy CPU x4, B grupy
   78-109, C sam K4i 64-112). Koszt (b): wejście wstawione 17-45 ms później (x4). Rekomendacja: jeśli księga Prove
   to potwierdzi, wycofać (b) w rundzie poprawek - wystarczy przestać emitować `g` w `composeBootSet`
   (`bootSet.server.ts`, 2 linie); loader bez `g` robi jedną grupę (test „zestaw bez `g`”), a kod `J` można
   zostawić albo usunąć (−~90 B w `<head>`).
2. **(a) K4i może NIE zmniejszyć TBT na desktop4x, tylko przenieść pracę.** Wymuszony Style+Layout w handlerze DCL
   (66-71 ms obs.) to praca, której pierwsza klatka i tak potrzebuje - w bazie klatka po DCL ma już czysty układ
   (Layout 0,1 ms). Bez odczytu w DCL ten sam Style+Layout (+ mikrozadania 9-17 ms, które w obu przypadkach idą
   tuż po pierwszym układzie) ląduje w zadaniu pierwszej klatki razem z Paint. Lantern mnoży zadania z Layout
   przez 0,5 × CPU, więc model na śladach bazy (`tools/k4i-model.py`): blokowanie desktop4x baza 122 / 130 / 146 ms
   → po K4i 138-187 ms (+8…+41 ms) zależnie od tego, gdzie trafią mikrozadania. Kryterium planu „`Script:(dokument)`
   z Style/Layout znika z okna” będzie spełnione, ale pojawi się dłuższe zadanie klatki (klasa Style/K5-K6, zakres
   P3.3). Na mobile klatka przychodzi przed DCL (Y 2,6 ms w mobile-1), więc tam zmiana jest obojętna. To jest
   prognoza z modelu, nie pomiar - rozstrzyga księga Prove.
3. `headRawBytes`: loader 2733 → 2615 B (−118 B), zestaw +12 B (`,"g":[10,19]` na stronie głównej fixture), netto
   ≈ −106 B. Progów `document-weight` nie ruszałem.

## 1. Co się zmieniło i dlaczego, plik po pliku

### `src/lib/boot/bootLoaderScript.ts`

- **K4i (obowiązkowe).** Handler DOMContentLoaded `Y` nie czyta geometrii: `Y(){R||Q();C();T(cap);F||!S||L(X)}`.
  Pole kandydata (reguła (ii)) liczy nowa funkcja `X` w zadaniu po pierwszej klatce od DCL (`L` = rAF, potem
  `setTimeout(0)`; w ukrytej karcie od razu `setTimeout(0)`), gdy układ jest czysty. W `X`: brak widocznego
  kandydata (także brak kandydata w ogóle - pusta lista, zero odczytów geometrii) → `nocand` (ten sam czas co
  dawniej: DCL → rAF → `setTimeout(0)`), inaczej ocena wpisu LCP sprzed pomiaru (`V`) jak dawniej w DCL. Po bootie
  (np. interakcja przed klatką) `X` nic nie mierzy. Reguła (i) (kandydat po elemencie/URL-u) nie zależy od pomiaru.
  Semantyka wyzwalaczy `now`/`lcp`/`input`/`nocand`/`load`/`cap` i „wejście po parsowaniu” bez zmian.
- **MutationObserver usunięty.** Obserwator `subtree` na `documentElement` był uzbrajany tylko, gdy węzeł zestawu
  przychodził PO loaderze. W dokumencie bazy W3 zestaw stoi na offsecie 11 727 B, loader na 23 290 B (spike P2.1:
  498-11 497 B w 36/36 dokumentach), a w 9 śladach bazy (mobile, desktop, desktop4x × 3) nie ma żadnego wywołania
  funkcji z dokumentu przed DCL - obserwator nie był ani razu uzbrojony, koszt w śladzie 0. Zestaw po loaderze czyta
  teraz handler DCL (wariant „odczyt przy DCL” dopuszczony w planie). `Q` nie zwraca już wartości (start: `Q();C()`).
- **Seria grupami (b).** `B(y)`: dla `y != "now"` granice z `S.g` (brak = jedna grupa); funkcja `J` wstawia grupę
  `modulepreload` i planuje następną przez `setTimeout(J)`; po ostatniej grupie wejście `H` od razu
  (`readyState != "loading"`) albo z DOMContentLoaded. Granice spoza zakresu, malejące albo śmieci nie wstawiają
  `undefined` ani dubli (warunek `i<j&&i<S.u.length`), najwyżej wydłużają serię o puste zadanie. `now` (tryb
  serwera, sesja, prerender, Safari) wstawia całą serię naraz.
- Bajty: stała nazwy zdarzenia `U="DOMContentLoaded"` (3 użycia), `L(f)` przyjmuje funkcję (wspólne dla `nocand`
  i pomiaru), `M` = boot `nocand`. Literał 2733 → 2615 B.
- Komentarze: nagłówek (KIEDY BOOT, nowe sekcje „POLE KANDYDATA BEZ WYMUSZONEGO UKŁADU” i „SERIA GRUPAMI”,
  „ZESTAW CZYTANY LENIWIE” z pomiarem offsetów, DOKTRYNA z budżetem `<head>`), legenda nazw.

### `src/lib/boot/bootSet.server.ts`

- `BootSet` dostaje opcjonalne `g?: readonly number[]` (granice grup = indeksy w `u`).
- `composeBootSet` liczy granice po deduplikacji: po domknięciu wejścia (wejście + `rootPreloads`) i po słowniku +
  chunkach tras; trzecia grupa to `modulepreload` z akumulatora `Link` (widgety). Puste grupy nie dają granicy
  (granica 0, równa poprzedniej albo równa długości `u` jest odrzucana). `g` tylko w trybie `lcp` i tylko gdy
  niepuste - `now` startuje serię naraz, a bajty `<head>` są policzone. `u` bez zmian (pełna lista w tej samej
  kolejności), więc `documentWeight.ts`, e2e i `on-demand-overlays` czytają zestaw jak dotąd.
- Nagłówek pliku: akapit „GRUPY SERII (P3.4)”.

### `src/lib/boot/__tests__/bootLoaderScript.test.ts`

- Harness: atrapa `getBoundingClientRect` z licznikiem (`rectReads`), `MutationObserver` przekazywany jako szpieg,
  stałe `GROUPED_SET` (`g: [2, 4]`) i `FRAME_MS` (rAF atrapy 16 ms + `setTimeout(0)`).
- Dostosowane: zestaw po skrypcie → odczyt przy DCL i zero konstrukcji `MutationObserver`; (ii) oceniane po
  pierwszej klatce; kandydat poza oknem → `nocand` po klatce bez odczytu w DCL.
- Nowe bloki:
  - **K4i**: handler DCL bez odczytu geometrii, odczyt dopiero w zadaniu po rAF (nie w samym rAF), jednorazowo;
    dokument bez kandydata → `nocand` bez żadnego odczytu; boot przed pomiarem → zero odczytów; reguła (i) nie
    czeka na pomiar;
  - **grupy**: kolejność grup i osobne zadania (`advanceTimersToNextTimer`), wejście w zadaniu ostatniej grupy
    i za wszystkimi `modulepreload` w DOM; wyzwalacz przed DCL → wszystkie grupy, wejście dopiero przy DCL; DCL
    w trakcie serii → wejście nie przed ostatnią grupą, bez dubli przy późniejszych zdarzeniach; `now` bez czekania
    (tryb serwera i zapisana sesja, także z `g`); zestaw bez `g` = jedna grupa; granice spoza zakresu, malejące,
    śmieci, liczba, `null` → każdy URL dokładnie raz, wejście na końcu.
- Dowód, że testy łapią regresję: na starym loaderze (`git show HEAD:…`) 7 przypadków czerwonych (zestaw po
  skrypcie, (ii) po klatce, kandydat poza oknem, K4i ×2, grupy ×2); na nowym 47/47 zielone.

### `src/lib/boot/__tests__/bootSet.server.test.ts`

- Skład: oczekiwany zestaw ma `g: [2, 4]` (vendor-react z trasy i słownik z `Link` zostają w pierwszej grupie,
  w której wystąpiły).
- Nowe: granice bez pustych grup (bez widgetów → `[2]`; bez słownika i trasy → `[2]`; sam rdzeń → brak klucza `g`;
  druga grupa w całości zdublowana → `[2]`); tryb `now` → brak `g`.
- Potok serwera (`src/server.ts`, render routera, HIT z cache): `#nes-boot-set` strony głównej niesie `g: [2, 4]`,
  HIT = MISS bajt w bajt; trasa `now` bez `g`.

### `e2e/boot-home.spec.ts`

- Zestaw `/` i `/en`: granice rosnące, wewnątrz serii, 1-2 granice, słownik poza pierwszą grupą.
- Po hydratacji: każdy moduł serii ma `link[rel=modulepreload]` w DOM PRZED skryptem wejścia (żaden moduł nie
  ewaluuje się przed zażądaniem całej serii - warunek CLS leniwych granic). `window.document` w `page.evaluate`,
  bo w tym teście `document` to odpowiedź żądania bez JS-a (błąd typów złapany przez `typecheck:e2e`).

## 2. Bramki

| bramka                                                                        | wynik                                                                                                                | log                                   |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `bunx prettier --write` (5 plików)                                            | zielona                                                                                                              | -                                     |
| `light.sh bunx eslint` (5 plików)                                             | zielona, 0 błędów, 0 ostrzeżeń                                                                                       | -                                     |
| `heavy-bg.sh bun run typecheck` (raz w rundzie)                               | `typecheck:tsc` i `typecheck:scripts` zielone; `typecheck:e2e` czerwone (2× TS2339 w nowym kodzie e2e)               | `typecheck.log`                       |
| poprawka e2e + `light.sh bunx tsgo --noEmit -p tsconfig.e2e.json`             | zielona (exit 0) - ponowiona tylko część e2e (lekka), bez drugiego pełnego typecheck                                 | -                                     |
| `light.sh bunx vitest run` boot (2 pliki)                                     | 60/60 zielone                                                                                                        | -                                     |
| `light.sh bunx vitest run` powiązane (7 plików: boot, router, rootRoute, ...) | 229/229 zielone                                                                                                      | -                                     |
| `light.sh bun run verify:static`                                              | zielona: 15 bramek OK (w tym `format:check`, `check:dangerous-html`, bramki SQL)                                     | `verify-static.log`                   |
| sonda przeglądarkowa (heavy, Chromium 1194, CPU x4, 3 warianty × 5)           | mechanizm (b) działa (3 zadania żądań), K7 niepodzielone (§3)                                                        | `probe.log`, `probe.json`             |
| `heavy-bg.sh bun run build:smoke` + `bun run test:e2e:artifact`               | zielone: build 2 min 8 s; e2e 9/9 (boot-home pl/en z nowymi asercjami grup, sesja `now`, boot-artifact, boot-timing) | `build-smoke.log`, `e2e-artifact.log` |

Literał loadera jest wyłącznie w bundlu serwera (`.output/server/_ssr/router-*.mjs`), w `.output/public/assets`
go nie ma (grep po `function J(){for`).

Nieuruchomione (etap Prove): build produkcyjny (`cloudflare-module`), `check:bundle`, `check:chunks`,
`check:entry-purity`, `check:document-weight`, Lighthouse `--compare` (mobile, desktop4x, desktop5x, n = 5).
Loader i zestaw są poza bundlem klienta (stała tylko w gałęzi `.server()`), więc `check:bundle` nie powinien się
ruszyć; `headRawBytes` ≈ −106 B.

## 3. Sonda przeglądarkowa (bez buildu worktree)

`tools/probe.mjs`: dokument strony głównej bazy W3 (`w3/base/lh/home.html`) + zasoby `base-w3/.output/public`
przez `page.route` na `https://fixture.invalid`, Chromium 1194, okno 1350×940, `Emulation.setCPUThrottlingRate`
x4, ślad z kategoriami Lighthouse (w tym `v8-source-rundown`). Warianty: A baza, B nowy loader + `g` = [10, 19],
C nowy loader bez `g`. 5 przebiegów na wariant, przeplatane.

| wariant | `__nesBootWhy` | zadania z żądaniami `modulepreload` serii   | zadanie z 10 `ScriptCatchup` (domknięcie wejścia) [ms obs.] | wejście za wszystkimi 26 preloadami |
| ------- | -------------- | ------------------------------------------- | ----------------------------------------------------------- | ----------------------------------- |
| A       | `lcp` 5/5      | 1 zadanie (26) 5/5                          | 99,4 / 66,5 / 101,0 / 73,1 / 85,6                           | 5/5                                 |
| B       | `lcp` 5/5      | 3 zadania (10 / 9 / 7) 5/5, odstęp 17-45 ms | 89,5 / 91,2 / 79,3 / 77,7 / 108,6                           | 5/5                                 |
| C       | `lcp` 5/5      | 1 zadanie (26) 5/5                          | 65,6 / 68,7 / 111,8 / 63,5 / 103,2                          | 5/5                                 |

- Zadanie z 16 `ScriptCatchup` (moduły dynamiczne tras, ~1,5 s) też jest jedno we wszystkich wariantach.
- W sondzie klatka przychodzi przed DCL we wszystkich wariantach (dostarczanie przez `page.route`), więc wymuszony
  układ K4i się nie odtwarza (A: Layout w zadaniu DCL 0,1 ms) - dowód K4i jest strukturalny (testy) i w księdze
  Prove; sonda potwierdza tylko, że nowy loader bootuje w prawdziwym Chromium (`lcp`, seria, wejście, linkowanie
  i ewaluacja modułów).

## 4. Odstępstwa od planu

1. **Pomiar pola w zadaniu po pierwszej klatce (rAF + `setTimeout(0)`), nie w callbacku `PerformanceObserver`.**
   Plan dopuszcza oba. Ten wariant jest deterministyczny, obsługuje też `nocand` dla kandydata poza oknem (wpis LCP
   kandydata wtedy nie przyjdzie) i ma ten sam czas co dawne `nocand` (DCL → rAF → `setTimeout(0)`).
2. **`MutationObserver` usunięty** (plan: „jeśli bezpieczne”). Uzasadnienie i pomiar w §1. Skutek w przypadku
   teoretycznym (zestaw po loaderze): seria `modulepreload` zalogowanego na stronie `lcp` startuje przy DCL zamiast
   przy pojawieniu się węzła; wejście i tak czeka na DCL, a dokument `now` ma serię w nagłówku `Link`.
3. **Grupy tylko w trybie `lcp`.** Plan: „tryb `now` bez czekania”. Serwer nie emituje `g` dla `now` (bajty), a loader
   ignoruje `g` dla wyzwalacza `now`.
4. **Grupy także dla wyzwalaczy `input`, `nocand`, `load`, `cap`** (wszystko poza `now`) - plan nie rozróżnia; koszt
   to dwa zadania pętli zdarzeń.
5. Spec e2e `boot-timing.spec.ts` bez zmian (nie dotyczy serii `lcp`; `/cookies` to dokument `now` bez `g`).

## 5. Ryzyka

- **Martwy boot** (wejście nigdy/za wcześnie): testy „wejście nigdy przed końcem parsowania” (6 wyzwalaczy) bez
  zmian i zielone; nowe testy grup (DCL przed/po/w trakcie serii); sonda w Chromium 5/5 `lcp` z wejściem za serią;
  e2e artefaktu (§2).
- **TBT z K4i** (§0 pkt 2): przeniesienie Style+Layout do klatki może podnieść blokowanie desktop4x o 8-41 ms
  (model). Jeśli księga to pokaże, decyzja orkiestratora: K4i jest obowiązkowe w notatce, ale nie daje spadku TBT.
- **(b) bez efektu** (§0 pkt 1) i z kosztem 17-45 ms opóźnienia wejścia przy CPU x4.
- **Stary HTML z cache po wdrożeniu**: dokument niesie loader i zestaw z tego samego builda (oba w tym samym
  dokumencie), więc niezgodności wersji nie ma; loader bez `g` i zestaw z `g` są zgodne w obie strony.
- `nocand` dla dokumentu bez kandydata przychodzi teraz zawsze przez `X` (po klatce) - ten sam czas co dawniej.

## 6. Na co patrzeć w recenzji i w Prove

1. `B`/`J`/`H` w `bootLoaderScript.ts`: warunek `i<j&&i<S.u.length`, `setTimeout(J)` (nazwane wyrażenie funkcyjne,
   ES5), rejestracja `H` dopiero po ostatniej grupie (DCL w trakcie serii → `H()` z `readyState != "loading"`).
2. `X`/`Y`: brak geometrii w `Y`, `X` jednorazowe (DCL raz), `A?…:M()`.
3. Prove: księga `--compare` mobile / desktop4x / desktop5x n = 5: (i) `Script:(dokument)` z Style/Layout znika;
   (ii) czy zadanie pierwszej klatki (Style/Layout) rośnie o przeniesioną pracę i jaki jest bilans TBT (model §0);
   (iii) `ScriptCatchup` - jedno zadanie czy kilka (sonda: jedno); (iv) FCP/LCP ±0,02 s, CLS ≤ 0,001;
   `check-document-weight` (`headRawBytes` ≈ −106 B); `test:e2e:artifact`.
4. Jeśli (b) bez podziału: wycofanie = usunięcie emisji `g` w `composeBootSet` (+ ewentualnie `J` z loadera).

## 7. Potrzeby spoza własności

- Brak dla wdrożenia tej pozycji.
- Informacyjnie: realną dźwignią na K7 (linkowanie domknięcia wejścia w jednym zadaniu) jest objętość domknięcia
  (P5.1/P5.2) albo linkowanie domknięcia kawałkami (osobne `<script type=module>` dla vendorów w kolejności DFS
  przed wejściem) - to drugie zmienia kolejność ewaluacji chunków (klasa incydentu 2026-07-20, `check:chunks`,
  `scripts/lib/bootVendorSplit.ts`), więc wymaga osobnej decyzji i pozycji.
