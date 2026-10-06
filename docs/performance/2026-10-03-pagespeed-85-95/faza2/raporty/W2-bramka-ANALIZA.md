# Bramka fali 2 – analiza kryteriów (W2-GATE, 2026-10-06)

Bramka fali 2 programu PSI 85/95 według `faza2/PLAN-FALE-1-2.md` §3.3 pkt 5 (kryteria) i akapitu „Definition of Done
fali 2”, z poprawkami §6. A = **W1** = `$S/base-w2` @ `78356a7a` (`main` na starcie fali: fale 0 i 1, bez fali 2);
B = **W2** = `$S/gate-w2` @ `ca34249c` (gałąź PR `claude/zen-ritchie-hzur21`: P2.1–P2.6, scalenie `main` `e129ca33`,
naprawa regresji bootu `57681ad3`/`7d865b47`/`3841521a`, favicon `3a40c23c`, prettier `ca34249c`). Drzew nie
przebudowywano, nic nie mierzono ponownie w Lighthouse; wszystko poniżej to analiza zapisanych serii
`lh-browser/` i `lh-bot/` (`MEASURE.md`) oraz lekkie przeliczenia Lantern na tych samych artefaktach.

`$S` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad`,
`$G` = `$S/phase2/wave2/gate`, `$A` = `$G/analiza`. Każda liczba ma źródło w pliku (podane przy sekcji).
Liczby maszynowo: `$G/W2-wyniki.json`.

## 0. Werdykt w skrócie

| Kryterium (PLAN-FALE-1-2 §3.3 pkt 5)                                               | browser (`--warm-ua browser`)                                                                | bot (`--warm-ua bot`)                                                   | Kluczowe liczby                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) mobile FCP ≤ 1,6 s, LCP ≤ 2,4 s                                                | **częściowo**: mediany tak, 1/5 przebiegów ponad progiem                                     | **częściowo**: mediany tak, 1/5 przebiegów ponad progiem                | mediany FCP 1,554 / 1,542 s, LCP 2,332 / 2,307 s; ponad progiem: browser B-mobile-3 (LCP 2,452 s), bot B-mobile-4 (FCP 1,624 s i LCP 2,436 s)                                                                                                                                                     |
| (b) `scriptBytesEndedBeforeObsLcp` = 0 (bez `/~flock.js`), seria bootu po obs. LCP | **zaliczone** 15/15                                                                          | **zaliczone** 15/15                                                     | 0 B w 30/30 przebiegach B (harness i niezależnie z devtoolsLog); seria bootu +52…+84 ms po obs. LCP; A: 25 skryptów / 520 692 B w 30/30                                                                                                                                                           |
| (c) TBT mobile ≤ 200 ms (mediana, n ≥ 5) i księga ≤ 200 ms, ALBO `score.py` ≥ 87   | **zaliczone** (oba warianty)                                                                 | **zaliczone** (oba warianty)                                            | TBT = księga 40,8 / 83,0 ms (maks. 55,5 / 108,4); projekcja z FCP/LCP/SI serii 97,75 / 97,75, z wartościami PSI-podobnymi 93,00 / 93,00. **Kruche wobec szybkości hosta** (§5): przy mnożniku CPU znormalizowanym do hosta kalibracji k TBT 416,3 / 431,5 ms, projekcja PSI-podobna 86,70 / 86,10 |
| (d) desktop4x TBT ≤ 150 ms; desktop5x raport                                       | **niezaliczone**                                                                             | **niezaliczone**                                                        | desktop4x 216,0 / 268,0 ms, 0/5 przebiegów ≤ 150 ms w każdym ramieniu; desktop5x 407,0 / 358,1 ms                                                                                                                                                                                                 |
| (e) brak ParseHTML ani inline EvaluateScript ≥ 50 ms sym. w [FCP, TTI]             | **niezaliczone**                                                                             | **niezaliczone**                                                        | B: browser 11/15 przebiegów (mobile 1, d4 5, d5 5), bot 9/15 (1, 3, 5); maks. 120 / 153 ms sym., blokowanie do 66 / 103 ms                                                                                                                                                                        |
| (f) CLS ≤ 0,001, żadne przesunięcie > 0,0005 (≥ 5 przebiegów)                      | **zaliczone** 15/15                                                                          | **zaliczone** 15/15                                                     | B: CLS 0, 0 przesunięć w audycie i 0 zdarzeń `LayoutShift` w śladzie w 30/30 przebiegach                                                                                                                                                                                                          |
| (g) wariant bota spełnia te same progi                                             | –                                                                                            | **niezaliczone**                                                        | bot oblewa (d) i (e), (a) tylko na medianach – tak jak browser                                                                                                                                                                                                                                    |
| **Bramka fali 2 łącznie**                                                          | **niezaliczona**                                                                             | **niezaliczona**                                                        | (d) i (e) w obu ramionach; (a) dosłownie („we wszystkich przebiegach”) w obu ramionach                                                                                                                                                                                                            |
| Definition of Done fali 2                                                          | **częściowo**                                                                                | **częściowo**                                                           | TBT i prognoza PSI w paśmie albo lepiej; FCP (1,554 / 1,542 s) i LCP (2,332 / 2,307 s) tuż ponad pasmem 1,37–1,52 / 2,12–2,27 s (§6)                                                                                                                                                              |
| Prognoza PSI (`score.py`, k z POMIAR §7)                                           | mobile **86,70** (host znormalizowany; dosłownie 93,00), desktop **91,05** (dosłownie 97,65) | mobile **86,10** (dosłownie 93,00), desktop **91,65** (dosłownie 96,75) | rozrzut po przebiegach (F1h): mobile 85,20–92,10, desktop 85,95–93,75; założenia §7                                                                                                                                                                                                               |

**Konsekwencja według planu (§3.3 pkt 5):** bramka niezaliczona ⇒ **P2.1 zostaje w gałęzi PR (bez wdrożenia),
P3.1, P3.3 i P3.4 są obowiązkowe, wdrożenie dopiero po zielonej bramce W3**. Dane wskazują w fali 3 kolejno: P3.4
(K7 `ScriptCatchup` – największa klasa desktopu i, przy hoście znormalizowanym, także mobile), P3.3 (pierwsza pełna
klatka Style+Layout dokumentu, K5/K6 i jej odpowiednik K4i w loaderze bootu), P3.1 (ściśle według definicji:
ewaluacja i kompilacja modułów bootu w oknie – K9/K9a/K7b; do decyzji orkiestratora jako uzupełnienie zakresu:
wymuszony Style+Layout w handlerze DCL loadera P2.1, ParseHTML dokumentu na desktopie, K16, nierozbity K12) oraz
P3.2 jako margines LCP (łańcuch CSS → font → `cover.jpg` 110 KB). Szczegóły §8.

## 1. Dane, ważność i metoda

**Serie.** Ramię browser: start 07:35:40Z, koniec 07:47:21Z; ramię bot: 07:47:36Z–07:59:22Z; obie `--compare A B
--runs 5 --forms mobile,desktop4x,desktop5x --client-backend fixture --third-party fake-gtag --save-artifacts`, kod 0
(`MEASURE.md` §2). Ważność (`MEASURE.md` §3): **60/60 przebiegów ważnych** (po 5/5 na stronę, formę i ramię),
excluded 0, dokument HIT w każdym przebiegu, wariant stały po każdej stronie (browser A 400 880 B, B 337 912 B; bot
A 392 234 B, B 330 857 B), księga = audyt TBT w 60/60, `google=0` w 60/60. Dwa `NO_NAVSTART` powtórzone przez
harness (browser A-mobile-1, bot B-desktop4x-4), powtórki ważne. Load 0,74–1,98 (próg 2,4).

**Tryb FCP.** A: pełny (browser A-mobile-4 częściowy), B: `bez-js` w 30/30. Każda para jest mieszana co do trybu FCP
(`PAIRS … pary mieszane 5/5`), więc warstwowanie par po trybie jest puste – pary porównują dwa reżimy (A bootuje przed
LCP, B po LCP), co jest celem fali.

**Szybkość hosta – najważniejsze zastrzeżenie.** benchmarkIndex przebiegów 1759–2779 (`MEASURE.md` §3), mediany
atrapy gtag 2240 (browser) i 2126 (bot), wobec 1616,5 przy kalibracji k (POMIAR §7) i 1298 / 1458 w bramce W1
(POMIAR §8.3). Host był więc ×1,4–1,7 szybszy niż przy kalibracji. TBT jest progowe (blokowanie = czas − 50 ms), więc
na szybszym hoście spada nieproporcjonalnie; §5 to kwantyfikuje (przeliczenie Lantern z mnożnikiem CPU
znormalizowanym do benchmarkIndex kalibracji). Werdykty bramki (§0, §2) liczę na zmierzonej serii, jak każe plan;
prognozę PSI (§7) podaję w obu wariantach.

**Narzędzia analizy (wszystko lekkie, `light.sh`, na zapisanych artefaktach):**

- `$A/scan.py` → `$A/scan.json`: per przebieg LHR (metryki Lantern, `observed*`, `layout-shifts`, element LCP z
  `lcp-breakdown-insight`), ślad (wszystkie zdarzenia `LayoutShift` z flagami; dzieci każdego zadania księgi:
  `UpdateLayoutTree.elementCount`, `Layout.dirtyObjects`, `FunctionCall`/`EvaluateScript` z URL, linią i nazwą
  funkcji, zakresy linii `ParseHTML`), devtoolsLog (żądania skryptów: start, koniec, bajty → niezależne
  `scriptBytesEndedBeforeObsLcp` i start serii bootu względem `observedLargestContentfulPaintTs`).
- `$A/ledger-json/lh-{browser,bot}.json`: `lanternTasks.ts --min 0 --json` dla 60 przebiegów (suma księgi = audyt
  `OK (±1 ms)` w 30/30 na ramię, `ledger-json/*.txt`); `$A/diff-series/*.txt`: `lanternTasks.ts --diff-series` per
  ramię i formę.
- `$A/analyze.py` → `$A/results.json` (kryteria, pary, klasy K, prognoza), `$A/gen_tables.py` → tabele tego raportu.
- `$A/lcp-graph.mjs` (kopia narzędzia z dowodu P2.1) → `$A/lcp-graph-B-mobile.txt`: ostatnie węzły symulacji LCP.
- `$A/cpu-whatif.mjs`, `$A/cpu-ledger.mjs` → `$A/cpu-whatif-*.json`, `$A/cpu-ledger-*.json`: Lantern od nowa z
  innym `cpuSlowdownMultiplier` (§5); te same funkcje `lanternWindows`/`ledgerRows` co `lanternTasks.ts`.
- `$A/score.py` = kopia bajt w bajt `narzedzia/score.py` (sha256 `3e57f3e9…dbba` po obu stronach); odtwarza
  referencję PSI 2026-10-03: 53,10 mobile i 69,80 desktop.

**Definicje.** Okno TBT w księdze: `simStart` w `lanternTasks.ts` to symulacja pesymistyczna (`p ?? o`), więc
„zadanie w [FCP, TTI]” = przedział [simStart, simStart + simDur] nachodzi na okno pesymistyczne [FCP_opt, TTI_pes]
(Lantern bierze przeciwne oszacowanie FCP). „≥ 50 ms sym. w oknie” = `simDur` ≥ 50 ms i nachodzenie; obok podaję, czy
zadanie daje blokowanie > 0 (część w oknie > 50 ms). Blokowanie = 0,5·opt + 0,5·pes. Pary: A-n z B-n jak w harnessie;
MDE(t) = (t₀,₉₇₅ + t₀,₈)·σΔ/√n = 3,717·σΔ/√5, MDE(z) = 2,802·σΔ/√5 (moje wartości zgadzają się z liniami `PAIRS`).

**Klasy K** (heurystyka `kclass()` w `analyze.py`, nazwy jak w P0.5 §1.4 / STAN-FALI-1; sumy księgi od klasyfikacji
nie zależą): K1 nawigacja; K2 ParseCSS; K4 ParseHTML dokumentu; **K4i** skrypt inline dokumentu (`Script:(dokument)`;
w W2 to prawie zawsze handler DCL loadera bootu P2.1, funkcja `Y`, §2.5); K5/K6 klatki Style+Layout dokumentu przed
hydratacją (z `$RV`; w W2 K5 i K6 to to samo zadanie, które zależnie od momentu obs. FCP wypada przed albo po nim, więc
je łączę); K6b klatka Style+Layout po starcie bootu; K7 `ScriptCatchup`; K7b `v8.compileModule`; K9 `Script:index`,
K9a ewaluacja modułów wejścia; K11/K10 `Timer:index`; K12 commit hydratacji (`vendor-react` z Layout); K14 plastry
Reacta (`vendor-react` bez Layout); K15 ParseHTML w commicie (`vendor-react` z udziałem ParseHTML ≥ 20 %); K13 styl
wymuszony z `index` po commicie (802–927 el.); K16 restyle po przełączeniu urządzenia (≥ 500 el., bez skryptu, bez
Layout); Kmod inne chunki; GC; K- kompozytor/inne.

## 2. Kryteria per przebieg

### 2.1 (a) mobile FCP ≤ 1,6 s, LCP ≤ 2,4 s

Źródło: LHR `audits.first-contentful-paint/largest-contentful-paint.numericValue` (`$A/results.json`
`criteria.*.a`).

| ramię   | FCP mediana (przebiegi)                         | > 1,6 s        | LCP mediana (przebiegi)                         | > 2,4 s        | werdykt na medianie | werdykt „każdy przebieg” |
| ------- | ----------------------------------------------- | -------------- | ----------------------------------------------- | -------------- | ------------------- | ------------------------ |
| browser | **1,554 s** (1,525, 1,537, 1,598, 1,554, 1,570) | 0/5            | **2,332 s** (2,282, 2,302, 2,452, 2,332, 2,360) | 1/5 B-mobile-3 | zaliczone           | niezaliczone             |
| bot     | **1,542 s** (1,532, 1,555, 1,542, 1,624, 1,521) | 1/5 B-mobile-4 | **2,307 s** (2,290, 2,327, 2,307, 2,436, 2,281) | 1/5 B-mobile-4 | zaliczone           | niezaliczone             |

Przebiegi B mobile (wszystkie kolumny z `$A/scan.json`; TBT = audyt, księga = `lanternTasks`):

| ramię   | przebieg   |       FCP [ms] |       LCP [ms] | TBT = księga [ms] | SI [ms] | CLS / maks. przes. / zdarzeń w śladzie | skrypty zak. przed obsLCP: harness / devtoolsLog [B] | start serii bootu − obsLCP [ms] | obsFCP / obsLCP [ms] | element LCP                            |
| ------- | ---------- | -------------: | -------------: | ----------------: | ------: | -------------------------------------- | ---------------------------------------------------- | ------------------------------: | -------------------- | -------------------------------------- |
| browser | B-mobile-1 |           1525 |           2282 |       35,5 = 35,5 |    1525 | 0,0000 / 0,0000 / 0                    | 0 / 0                                                |                             +59 | 220 / 220            | `img[data-lcp-candidate]` (/cover.jpg) |
| browser | B-mobile-2 |           1537 |           2302 |       28,0 = 28,0 |    1537 | 0,0000 / 0,0000 / 0                    | 0 / 0                                                |                             +65 | 169 / 169            | `img[data-lcp-candidate]` (/cover.jpg) |
| browser | B-mobile-3 |           1598 | 2452 **>2400** |       40,8 = 40,8 |    1598 | 0,0000 / 0,0000 / 0                    | 0 / 0                                                |                             +61 | 187 / 187            | `img[data-lcp-candidate]` (/cover.jpg) |
| browser | B-mobile-4 |           1554 |           2332 |       55,5 = 55,5 |    1554 | 0,0000 / 0,0000 / 0                    | 0 / 0                                                |                             +62 | 118 / 213            | `img[data-lcp-candidate]` (/cover.jpg) |
| browser | B-mobile-5 |           1570 |           2360 |       55,0 = 55,0 |    1570 | 0,0000 / 0,0000 / 0                    | 0 / 0                                                |                             +56 | 185 / 185            | `img[data-lcp-candidate]` (/cover.jpg) |
| bot     | B-mobile-1 |           1532 |           2290 |       69,5 = 69,5 |    1573 | 0,0000 / 0,0000 / 0                    | 0 / 0                                                |                             +55 | 229 / 229            | `img[data-lcp-candidate]` (/cover.jpg) |
| bot     | B-mobile-2 |           1555 |           2327 |       83,0 = 83,0 |    1612 | 0,0000 / 0,0000 / 0                    | 0 / 0                                                |                             +64 | 220 / 220            | `img[data-lcp-candidate]` (/cover.jpg) |
| bot     | B-mobile-3 |           1542 |           2307 |     108,4 = 108,4 |    1795 | 0,0000 / 0,0000 / 0                    | 0 / 0                                                |                             +71 | 190 / 190            | `img[data-lcp-candidate]` (/cover.jpg) |
| bot     | B-mobile-4 | 1624 **>1600** | 2436 **>2400** |       58,0 = 58,0 |    1822 | 0,0000 / 0,0000 / 0                    | 0 / 0                                                |                             +61 | 207 / 207            | `img[data-lcp-candidate]` (/cover.jpg) |
| bot     | B-mobile-5 |           1521 |           2281 |       88,0 = 88,0 |    1629 | 0,0000 / 0,0000 / 0                    | 0 / 0                                                |                             +57 | 198 / 198            | `img[data-lcp-candidate]` (/cover.jpg) |

- **Mediany spełniają progi w obu ramionach; dosłownie „we wszystkich przebiegach” – nie**: browser B-mobile-3 LCP
  2452 ms; bot B-mobile-4 FCP 1624 ms i LCP 2436 ms.
- **Przyczyna obu przekroczeń jest jedna i ta sama** (`$A/lcp-graph-B-mobile.txt`, `$A/scan.json`). Łańcuch LCP w
  symulacji optymistycznej to w 10/10 przebiegach B: arkusz `styles-*.css` 68,8 KB (np. B-mobile-1 1071–1525 ms) →
  font `red-hat-display-latin` 30,0 KB (1525–1677, 152 ms) → `cover.jpg` 110,3 KB (1677–2282, 605 ms). W obu
  przebiegach górnego trybu zadanie parsowania nagłówka dokumentu (ParseHTML linii 0–200 z `ParseAuthorStyleSheet`,
  obs. 87,8 ms / 15,5 ms w browser B-mobile-3 i 82,9 / 23,4 ms w bot B-mobile-4) ląduje w symulacji za arkuszem
  (1536–1598 i 1530–1624 ms): wyznacza FCP (1598 / 1624 ms) i opóźnia pobranie fontu, które trwa wtedy 305 / 302 ms
  zamiast 152–153 ms, więc obraz kończy się w 2452 / 2436 ms. To samo zadanie jest jedynym zadaniem z kryterium (e) na
  mobile (§2.5). Dźwignia: font odkrywany z preloadu w `<head>` zamiast z parsowania CSS (P3.2) oraz mniejszy obraz
  kandydata (P3.2, hero 640w).
- Element LCP = `img[data-lcp-candidate]` (`/cover.jpg`) w 60/60 przebiegach (A i B, `lcp-breakdown-insight`).

### 2.2 (b) `scriptBytesEndedBeforeObsLcp` = 0 (bez `/~flock.js`) i seria bootu po obs. LCP

Źródło: `records[].ledger.scriptBytesEndedBeforeObsLcp` w `summary.json` (harness) oraz niezależnie devtoolsLog:
żądania o typie `Script`, `loadingFinished.timestamp` < `observedLargestContentfulPaintTs` z LHR (ten sam zegar
monotoniczny), bajty = `encodedDataLength`; start serii = pierwsze `requestWillBeSent` na `/assets/*.js` (`$A/scan.py`
`net_info`).

| ramię   | forma     | B: skrypty zak. przed obsLCP (harness / devtoolsLog) | `/~flock.js` przed obsLCP | start serii bootu − obsLCP [ms] (5 przebiegów) | pierwszy skrypt = wejście `/assets/index-*` | A (W1): skrypty przed obsLCP; start serii − obsLCP |
| ------- | --------- | ---------------------------------------------------- | ------------------------- | ---------------------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| browser | mobile    | 5/5 = 0 B / 5/5 = 0 B                                | 0/5                       | +59, +65, +61, +62, +56                        | 5/5                                         | 25 skr. / 520692 B w 5/5; −274…−191                |
| browser | desktop4x | 5/5 = 0 B / 5/5 = 0 B                                | 0/5                       | +59, +66, +54, +57, +52                        | 5/5                                         | 25 skr. / 520692 B w 5/5; −387…−220                |
| browser | desktop5x | 5/5 = 0 B / 5/5 = 0 B                                | 0/5                       | +56, +63, +59, +53, +54                        | 5/5                                         | 25 skr. / 520692 B w 5/5; −338…−249                |
| bot     | mobile    | 5/5 = 0 B / 5/5 = 0 B                                | 0/5                       | +55, +64, +71, +61, +57                        | 5/5                                         | 25 skr. / 520692 B w 5/5; −288…−200                |
| bot     | desktop4x | 5/5 = 0 B / 5/5 = 0 B                                | 0/5                       | +55, +58, +84, +53, +55                        | 5/5                                         | 25 skr. / 520692 B w 5/5; −378…−258                |
| bot     | desktop5x | 5/5 = 0 B / 5/5 = 0 B                                | 0/5                       | +54, +58, +56, +55, +55                        | 5/5                                         | 25 skr. / 520692 B w 5/5; −302…−270                |

- **Zaliczone w 30/30 przebiegach B** (15/15 na ramię): 0 B i 0 skryptów zakończonych przed obs. LCP w obu
  źródłach; `/~flock.js` nie wystąpił w żadnym przebiegu przed obs. LCP (wykluczenia puste). Pierwszym skryptem strony
  jest zawsze wejście `/assets/index-fO-Yix7R.js`, a seria bootu rusza +52…+66 ms (browser) i +53…+84 ms (bot) po obs.
  LCP; inicjator wszystkich skryptów `/assets/` to `script` (0 skryptów inicjowanych parserem).
- A (W1) dla porównania: 25 skryptów / 520 692 B przed obs. LCP w 30/30, seria rusza 191–387 ms przed obs. LCP.

### 2.3 (c) TBT mobile ≤ 200 ms i księga ≤ 200 ms, ALBO `score.py` ≥ 87

Źródło: LHR `total-blocking-time`, księga `lanternTasks` (`$A/ledger-json`), projekcja `$A/score.py` z TBT × 0,72
(POMIAR §7). Wartości „PSI-podobne” to metryki PSI po W2 założone w `faza1/PLAN.md` §1.5 (projekcja: FCP 1,8 s, LCP
2,85 s, SI 3,7 s, CLS 0).

| ramię   | TBT B mobile: przebiegi [ms]  | mediana (n)  | księga = audyt | maks. księgi | ≤ 200 ms | projekcja `score.py` (TBT × 0,72), FCP/LCP/SI z serii: przebiegi; mediana | projekcja, FCP/LCP/SI PSI-podobne 1,8 / 2,85 / 3,7 s: przebiegi; mediana |
| ------- | ----------------------------- | ------------ | -------------- | ------------ | -------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| browser | 35,5, 28,0, 40,8, 55,5, 55,0  | **40,8** (5) | 5/5            | 55,5         | tak      | 97,75, 97,75, 96,90, 97,75, 97,50; **97,75**                              | 93,00, 93,00, 93,00, 93,00, 93,00; **93,00**                             |
| bot     | 69,5, 83,0, 108,4, 58,0, 88,0 | **83,0** (5) | 5/5            | 108,4        | tak      | 97,75, 97,75, 97,45, 97,15, 97,75; **97,75**                              | 93,00, 93,00, 92,70, 93,00, 93,00; **93,00**                             |

- **Wariant główny zaliczony w obu ramionach:** mediana 40,8 / 83,0 ms przy n = 5 ważnych, księga = audyt w 5/5 i
  ≤ 200 ms w każdym przebiegu (maks. 55,5 / 108,4 ms). **Alternatywa też zaliczona** w obu ujęciach (97,75 z
  FCP/LCP/SI serii, 93,00 z wartościami PSI-podobnymi).
- **Zastrzeżenie (§5):** na hoście o szybkości z kalibracji k ten sam ślad daje TBT mobile B 416,3 / 431,5 ms
  (mediany; 348,5–450,5 i 161,0–470,0 ms), czyli wariant główny byłby niezaliczony, a alternatywa dawałaby 91,45 /
  90,85 z FCP/LCP/SI serii (zaliczone) i 86,70 / 86,10 z wartościami PSI-podobnymi (niezaliczone, 0,3–0,9 pkt pod
  progiem). Zielony wynik (c) zależy więc od szybkości hosta bramki.

### 2.4 (d) desktop4x TBT ≤ 150 ms; desktop5x raportowane

| ramię   | forma     | A (W1): przebiegi [ms]; mediana          | B (W2): przebiegi [ms]; mediana              | przebiegi B ≤ 150 ms | próg                       |
| ------- | --------- | ---------------------------------------- | -------------------------------------------- | -------------------- | -------------------------- |
| browser | desktop4x | 132,3, 351,5, 160,0, 149,5, 156,6; 156,6 | 216,0, 249,5, 174,5, 203,5, 222,5; **216,0** | 0/5                  | ≤ 150 ms: **niezaliczone** |
| browser | desktop5x | 654,3, 442,2, 606,0, 679,0, 448,0; 606,0 | 692,5, 407,0, 338,5, 292,5, 481,5; **407,0** | 0/5                  | raport                     |
| bot     | desktop4x | 261,0, 305,2, 300,5, 242,8, 262,5; 262,5 | 185,5, 272,0, 301,5, 268,0, 250,5; **268,0** | 0/5                  | ≤ 150 ms: **niezaliczone** |
| bot     | desktop5x | 728,5, 496,0, 448,4, 429,3, 592,0; 496,0 | 282,4, 431,5, 358,1, 332,0, 461,8; **358,1** | 0/5                  | raport                     |

- **Niezaliczone w obu ramionach:** mediana desktop4x 216,0 / 268,0 ms, żaden z 10 przebiegów B nie schodzi do
  150 ms (najniższy 174,5 / 185,5 ms). Na desktop4x W2 nie poprawia TBT względem W1 (pary +23,2 / −18,9 ms przy
  MDE(t) 123,8 / 63,3 ms, §3): FCP przesunięte o ok. 0,4 s wcześniej wciąga do okna zadania, które na W1 leżały przed
  FCP (K7, K5/K6, K4i, K4), a zdjęte K14/K12/K13 tylko to równoważą (§4).
- desktop5x (raport): 407,0 / 358,1 ms, pary −123,5 / −165,7 ms (σΔ 192,7 / 158,5, MDE(t) 320,3 / 263,5) – w szumie.

### 2.5 (e) ParseHTML i inline EvaluateScript ≥ 50 ms sym. w [FCP, TTI]

Źródło: `$A/ledger-json` (klasy `ParseHTML` i `Script:(dokument)` z `lanternTasks`), dzieci zadań ze śladu
(`$A/scan.json`). Lista jest identyczna z surową ekstrakcją `MEASURE.md` §7 pkt 8 (sprawdzone przebieg po
przebiegu).

| ramię   | forma     | przebiegi B z zadaniem (nakładanie na okno)                                         | przebiegi B z blokowaniem > 0 | maks. czas sym. / blokowanie [ms] | A (W1): przebiegi z zadaniem |
| ------- | --------- | ----------------------------------------------------------------------------------- | ----------------------------- | --------------------------------- | ---------------------------- |
| browser | mobile    | **1/5** (B-mobile-3)                                                                | 1/5                           | 62 / 12,0                         | 1/5                          |
| browser | desktop4x | **5/5** (B-desktop4x-1, B-desktop4x-2, B-desktop4x-3, B-desktop4x-4, B-desktop4x-5) | 5/5                           | 120 / 37,0                        | 1/5                          |
| browser | desktop5x | **5/5** (B-desktop5x-1, B-desktop5x-2, B-desktop5x-3, B-desktop5x-4, B-desktop5x-5) | 5/5                           | 116 / 66,0                        | 4/5                          |
| bot     | mobile    | **1/5** (B-mobile-4)                                                                | 1/5                           | 94 / 44,0                         | 0/5                          |
| bot     | desktop4x | **3/5** (B-desktop4x-2, B-desktop4x-3, B-desktop4x-4)                               | 2/5                           | 95 / 37,0                         | 1/5                          |
| bot     | desktop5x | **5/5** (B-desktop5x-1, B-desktop5x-2, B-desktop5x-3, B-desktop5x-4, B-desktop5x-5) | 5/5                           | 153 / 103,0                       | 4/5                          |

Zadania (B, wszystkie):

| ramię   | przebieg      | klasa (heurystyka K)                                            | obs start / czas [ms] | sym. start + czas [ms] | blokowanie opt / pes / śr. [ms] | funkcje / zakres linii parsera | elementy / obiekty Layout |
| ------- | ------------- | --------------------------------------------------------------- | --------------------- | ---------------------- | ------------------------------- | ------------------------------ | ------------------------- |
| browser | B-mobile-3    | K4 ParseHTML dokumentu                                          | 87,8 / 15,5           | 2452 + **62**          | 12 / 12 / **12,0**              | linie 0–200                    | – / –                     |
| browser | B-desktop4x-1 | K4 ParseHTML dokumentu                                          | 97,2 / 16,9           | 640 + **67**           | 17 / 17 / **17,0**              | linie 0–200                    | – / –                     |
| browser | B-desktop4x-1 | K4i skrypt inline: loader bootu przy DCL (wymusza Style+Layout) | 129,4 / 59,9          | 383 + **120**          | 0 / 0 / **0,0**                 | Y,z linie 675–676; 676–676     | 512 / 482                 |
| browser | B-desktop4x-2 | K4i skrypt inline: loader bootu przy DCL (wymusza Style+Layout) | 128,9 / 34,4          | 543 + **69**           | 19 / 19 / **19,0**              | Y,z linie 676–676; 676–676     | 510 / 482                 |
| browser | B-desktop4x-3 | K4i skrypt inline: loader bootu przy DCL (wymusza Style+Layout) | 122,4 / 43,6          | 511 + **87**           | 37 / 37 / **37,0**              | Y,z linie 676–676; 676–676     | 481 / 461                 |
| browser | B-desktop4x-4 | K4i skrypt inline: loader bootu przy DCL (wymusza Style+Layout) | 140,6 / 30,8          | 545 + **62**           | 12 / 12 / **12,0**              | Y,z linie 676–676; 676–676     | 483 / 461                 |
| browser | B-desktop4x-5 | K4i skrypt inline: loader bootu przy DCL (wymusza Style+Layout) | 143,5 / 39,0          | 579 + **78**           | 28 / 28 / **28,0**              | Y,z linie 676–676; 676–676     | 483 / 461                 |
| browser | B-desktop5x-1 | K4 ParseHTML dokumentu                                          | 96,5 / 21,9           | 446 + **109**          | 59 / 59 / **59,0**              | linie 200–200                  | – / –                     |
| browser | B-desktop5x-1 | K4 ParseHTML dokumentu                                          | 118,5 / 16,4          | 555 + **82**           | 32 / 32 / **32,0**              | linie 200–675                  | – / –                     |
| browser | B-desktop5x-1 | K4 ParseHTML dokumentu                                          | 176,0 / 10,0          | 739 + **50**           | 0 / 0 / **0,0**                 | linie 675–676                  | – / –                     |
| browser | B-desktop5x-2 | K4 ParseHTML dokumentu                                          | 99,2 / 17,1           | 543 + **86**           | 36 / 36 / **36,0**              | linie 200–200                  | – / –                     |
| browser | B-desktop5x-2 | K4 ParseHTML dokumentu                                          | 116,5 / 13,6          | 629 + **68**           | 18 / 18 / **18,0**              | linie 200–675                  | – / –                     |
| browser | B-desktop5x-2 | K4 ParseHTML dokumentu                                          | 188,5 / 10,4          | 842 + **52**           | 2 / 2 / **2,0**                 | linie 675–676                  | – / –                     |
| browser | B-desktop5x-3 | K4 ParseHTML dokumentu                                          | 88,3 / 11,9           | 511 + **60**           | 10 / 10 / **10,0**              | linie 200–200                  | – / –                     |
| browser | B-desktop5x-3 | K4 ParseHTML dokumentu                                          | 100,4 / 10,2          | 571 + **51**           | 1 / 1 / **1,0**                 | linie 200–675                  | – / –                     |
| browser | B-desktop5x-3 | K4 ParseHTML dokumentu                                          | 151,6 / 10,2          | 724 + **51**           | 1 / 1 / **1,0**                 | linie 675–676                  | – / –                     |
| browser | B-desktop5x-4 | K4 ParseHTML dokumentu                                          | 116,5 / 10,8          | 517 + **54**           | 4 / 4 / **4,0**                 | linie 200–200                  | – / –                     |
| browser | B-desktop5x-4 | K4 ParseHTML dokumentu                                          | 127,4 / 13,2          | 571 + **66**           | 16 / 16 / **16,0**              | linie 200–675                  | – / –                     |
| browser | B-desktop5x-4 | K4 ParseHTML dokumentu                                          | 182,4 / 11,9          | 739 + **60**           | 10 / 10 / **10,0**              | linie 675–676                  | – / –                     |
| browser | B-desktop5x-5 | K4 ParseHTML dokumentu                                          | 121,6 / 10,6          | 553 + **53**           | 3 / 3 / **3,0**                 | linie 200–200                  | – / –                     |
| browser | B-desktop5x-5 | K4 ParseHTML dokumentu                                          | 134,9 / 10,8          | 613 + **54**           | 4 / 4 / **4,0**                 | linie 200–675                  | – / –                     |
| browser | B-desktop5x-5 | K4 ParseHTML dokumentu                                          | 146,2 / 10,3          | 667 + **52**           | 2 / 2 / **2,0**                 | linie 675–676                  | – / –                     |
| browser | B-desktop5x-5 | K4i skrypt inline: loader bootu przy DCL (wymusza Style+Layout) | 162,3 / 46,4          | 719 + **116**          | 66 / 66 / **66,0**              | Y,z linie 676–676; 676–676     | 510 / 482                 |
| bot     | B-mobile-4    | K4 ParseHTML dokumentu                                          | 82,9 / 23,4           | 2436 + **94**          | 44 / 44 / **44,0**              | linie 0–200                    | – / –                     |
| bot     | B-desktop4x-2 | K4 ParseHTML dokumentu                                          | 93,5 / 20,5           | 511 + **82**           | 0 / 0 / **0,0**                 | linie 0–200                    | – / –                     |
| bot     | B-desktop4x-3 | K4 ParseHTML dokumentu                                          | 110,6 / 15,4          | 449 + **61**           | 6 / 6 / **6,0**                 | linie 200–200                  | – / –                     |
| bot     | B-desktop4x-3 | K4 ParseHTML dokumentu                                          | 126,0 / 14,0          | 510 + **56**           | 6 / 6 / **6,0**                 | linie 200–675                  | – / –                     |
| bot     | B-desktop4x-3 | K4 ParseHTML dokumentu                                          | 198,9 / 17,9          | 684 + **72**           | 22 / 22 / **22,0**              | linie 675–675                  | – / –                     |
| bot     | B-desktop4x-4 | K4 ParseHTML dokumentu                                          | 112,3 / 23,7          | 544 + **95**           | 37 / 37 / **37,0**              | linie 0–200                    | – / –                     |
| bot     | B-desktop4x-4 | K4 ParseHTML dokumentu                                          | 221,1 / 13,8          | 818 + **55**           | 5 / 5 / **5,0**                 | linie 675–675                  | – / –                     |
| bot     | B-desktop5x-1 | K4 ParseHTML dokumentu                                          | 104,2 / 10,1          | 447 + **51**           | 1 / 1 / **1,0**                 | linie 200–594                  | – / –                     |
| bot     | B-desktop5x-1 | K4 ParseHTML dokumentu                                          | 121,4 / 13,7          | 515 + **68**           | 18 / 18 / **18,0**              | linie 594–675                  | – / –                     |
| bot     | B-desktop5x-1 | K4i skrypt inline: loader bootu przy DCL (wymusza Style+Layout) | 136,4 / 50,2          | 583 + **126**          | 76 / 76 / **76,0**              | Y,z linie 675–675; 675–675     | 640 / 678                 |
| bot     | B-desktop5x-2 | K4 ParseHTML dokumentu                                          | 89,2 / 13,6           | 481 + **68**           | 0 / 0 / **0,0**                 | linie 200–200                  | – / –                     |
| bot     | B-desktop5x-2 | K4 ParseHTML dokumentu                                          | 103,0 / 10,3          | 549 + **51**           | 1 / 1 / **1,0**                 | linie 200–675                  | – / –                     |
| bot     | B-desktop5x-3 | K4 ParseHTML dokumentu                                          | 106,1 / 10,3          | 476 + **51**           | 0 / 0 / **0,0**                 | linie 200–200                  | – / –                     |
| bot     | B-desktop5x-3 | K4 ParseHTML dokumentu                                          | 116,5 / 10,1          | 527 + **51**           | 1 / 1 / **1,0**                 | linie 200–675                  | – / –                     |
| bot     | B-desktop5x-3 | K4 ParseHTML dokumentu                                          | 195,0 / 12,5          | 748 + **63**           | 13 / 13 / **13,0**              | linie 675–675                  | – / –                     |
| bot     | B-desktop5x-4 | K4 ParseHTML dokumentu                                          | 98,5 / 10,2           | 491 + **51**           | 1 / 1 / **1,0**                 | linie 200–594                  | – / –                     |
| bot     | B-desktop5x-4 | K4 ParseHTML dokumentu                                          | 114,9 / 14,6          | 557 + **73**           | 23 / 23 / **23,0**              | linie 594–675                  | – / –                     |
| bot     | B-desktop5x-4 | K4i skrypt inline: loader bootu przy DCL (wymusza Style+Layout) | 130,8 / 55,3          | 630 + **138**          | 88 / 88 / **88,0**              | Y,z linie 675–675; 675–675     | 642 / 678                 |
| bot     | B-desktop5x-5 | K4 ParseHTML dokumentu                                          | 116,3 / 10,1          | 450 + **51**           | 1 / 1 / **1,0**                 | linie 200–249                  | – / –                     |
| bot     | B-desktop5x-5 | K4 ParseHTML dokumentu                                          | 128,7 / 14,9          | 506 + **75**           | 25 / 25 / **25,0**              | linie 249–675                  | – / –                     |
| bot     | B-desktop5x-5 | K4i skrypt inline: loader bootu przy DCL (wymusza Style+Layout) | 145,2 / 61,3          | 581 + **153**          | 103 / 103 / **103,0**           | Y,z linie 675–675; 675–675     | 669 / 699                 |

- **Niezaliczone w obu ramionach i w każdej formie:** browser 11/15 przebiegów B (mobile 1, desktop4x 5, desktop5x 5),
  bot 9/15 (1, 3, 5); z blokowaniem > 0: 11/15 i 8/15. Szerszy odczyt (zadania innych klas z ParseHTML ≥ 20 %)
  nie dodaje nic.
- **Inline EvaluateScript (`Script:(dokument)`) to w 9/9 przypadkach w oknie handler `DOMContentLoaded` loadera bootu
  P2.1** (`<script data-nes-boot>` w `<head>`, funkcja `Y`, która dla każdego kandydata woła `Z()` – pomiar pola
  kandydata; razem z nią handler `z` sondy `data-nes-probe`). Handler jest osobnym zadaniem w 9/15 przebiegach B
  browser i 8/15 bot; w 15 z tych 17 wymusza pierwszy pełny Style+Layout dokumentu (390–669 elementów stylu,
  371–699 obiektów Layout, Style 12,2–34,0 ms i Layout 7,0–25,1 ms obs., 50–153 ms sym.), w 2 (bot B-desktop4x-2,
  B-mobile-3) układ był już policzony (53–82 el., 43 ms sym.). Na mobile leży przed FCP_sim (0 blokowania), na
  desktopie w oknie: browser desktop4x 5/5 (blokowanie 0–37 ms), desktop5x 1/5 (66 ms), bot desktop5x
  3/5 (76–103 ms). Gdy `Y` nie wymusza układu, ta sama praca trafia do pierwszej klatki (K5/K6) – patrz §4.
- **ParseHTML dokumentu** w oknie to porcje strumienia: linie 0–200 (nagłówek z arkuszem; mobile – §2.1), 200–675 /
  200–594 / 594–675 (treść) i 675–676 (ogon z `$tsr`/`$RV`), 50–109 ms sym. na desktopie. FCP Lantern na desktopie
  spada z 0,78–1,08 s (A) do 0,38–0,57 s (B), więc porcje wchodzą do okna – to zapowiedziane sprzężenie C3, którego
  pakiet dokumentu P2.4–P2.6 nie spłacił w całości. Kryterium oblałaby też strona A: desktop5x 4/5 przebiegów w obu
  ramionach (późniejsze porcje ParseHTML, `MEASURE.md` §6), desktop4x 1/5, mobile 1/5 / 0/5; na W2 rośnie liczba
  przebiegów desktop4x (1/5 → 5/5 browser, 1/5 → 3/5 bot) i dochodzi skrypt inline loadera.

### 2.6 (f) CLS ≤ 0,001 i brak przesunięcia > 0,0005

Źródło: LHR `cumulative-layout-shift`, `layout-shifts` (wszystkie pozycje) i zdarzenia `LayoutShift` w śladzie
(`$A/scan.json`, `traceShifts`, z flagą `had_recent_input`).

| ramię   | forma     | A (W1): CLS per przebieg                   | A: maks. przes. | B (W2): CLS per przebieg                   | B: maks. przes. | B: zdarzenia LayoutShift w śladzie |
| ------- | --------- | ------------------------------------------ | --------------- | ------------------------------------------ | --------------- | ---------------------------------- |
| browser | mobile    | 0,0000 / 0,0000 / 0,0000 / 0,0000 / 0,4014 | 0,4014          | 0,0000 / 0,0000 / 0,0000 / 0,0000 / 0,0000 | 0,0000          | 0                                  |
| browser | desktop4x | 0,0000 / 0,0000 / 0,0061 / 0,0000 / 0,0000 | 0,0061          | 0,0000 / 0,0000 / 0,0000 / 0,0000 / 0,0000 | 0,0000          | 0                                  |
| browser | desktop5x | 0,0000 / 0,0113 / 0,0061 / 0,0000 / 0,0016 | 0,0113          | 0,0000 / 0,0000 / 0,0000 / 0,0000 / 0,0000 | 0,0000          | 0                                  |
| bot     | mobile    | 0,0000 / 0,0000 / 0,0000 / 0,0006 / 0,0000 | 0,0006          | 0,0000 / 0,0000 / 0,0000 / 0,0000 / 0,0000 | 0,0000          | 0                                  |
| bot     | desktop4x | 0,0000 / 0,0000 / 0,0000 / 0,0000 / 0,0000 | 0,0000          | 0,0000 / 0,0000 / 0,0000 / 0,0000 / 0,0000 | 0,0000          | 0                                  |
| bot     | desktop5x | 0,0000 / 0,0000 / 0,0000 / 0,0000 / 0,0000 | 0,0000          | 0,0000 / 0,0000 / 0,0000 / 0,0000 / 0,0000 | 0,0000          | 0                                  |

- **Zaliczone w 30/30 przebiegach B** (oba ramiona, wszystkie formy): CLS 0, 0 pozycji w audycie, 0 zdarzeń
  `LayoutShift` w śladzie.
- A (W1): browser A-mobile-5 0,4014 (jedno przesunięcie `div[data-column-slot]` kolumny `…001b`, w śladzie
  `had_recent_input = true` w 232,7 ms, czyli emulacyjne 500 ms po `viewport`, liczone przez Lighthouse),
  A-desktop4x-3 0,0061, A-desktop5x-2 0,0113, A-desktop5x-3 0,0061, A-desktop5x-5 0,0016; bot A-mobile-4 0,0006
  (`had_recent_input = true`). Przesunięcia desktopowe strony A to sekcja `section[data-sec-id="…0029"]` (A-desktop4x-3,
  A-desktop5x-3, A-desktop5x-5; A-desktop5x-2 bez węzła w audycie) – znane z W1 (STAN-FALI-1 §7 pkt 9, przypisane
  P2.3); w W2 nie wystąpiły w żadnym przebiegu. Przesunięcie kolumny `…001b` w W2 też nie wystąpiło (STAN-FALI-1 §7
  pkt 5: nieobecność nie dowodzi naprawy).

### 2.7 (g) wariant bota

Ramię bot (dokument wariantu bota, który PSI dostaje na MISS; zestaw bootu `#nes-boot-set` także w nim) zachowuje
się jak ramię przeglądarkowe: (b), (c), (f) zaliczone, (d) i (e) niezaliczone, (a) tylko na medianach. TBT bota jest
wyższe (mobile 83,0 wobec 40,8 ms, desktop4x 268,0 wobec 216,0 ms), a wymuszony układ w handlerze loadera jest w nim
większy (640–669 el. wobec 481–512 el. na desktopie). **(g) niezaliczone.**

## 3. Delty W1 → W2 (pary A-n/B-n)

Źródło: `$A/results.json` (`arms.*.forms.*.pairs`); dla TBT, FCP, LCP, SI i TTI liczby są identyczne z liniami
`PAIRS` harnessu (`MEASURE.md` §5). Δ = B − A, ujemne = lepiej (poza perf).

| ramię   | forma     | metryka       | mediana A (W1) | mediana B (W2) | Δ median | pary: Δ̄ |     σΔ | MDE(t) | MDE(z) | t (df 4) | znak par      |
| ------- | --------- | ------------- | -------------: | -------------: | -------: | ------: | -----: | -----: | -----: | -------: | ------------- |
| browser | mobile    | perf          |             72 |             98 |      +26 |   +29,0 |    9,7 |   16,2 |   12,2 |    +6,65 | 5/5 dodatnich |
| browser | mobile    | FCP [ms]      |           4104 |           1554 |    −2550 | −2099,1 | 1023,2 | 1700,8 | 1282,0 |    −4,59 | 5/5 ujemnych  |
| browser | mobile    | LCP [ms]      |           4812 |           2332 |    −2480 | −2527,2 |  130,1 |  216,3 |  163,0 |   −43,44 | 5/5 ujemnych  |
| browser | mobile    | TBT [ms]      |          114,5 |           40,8 |    −73,7 |   −89,7 |   37,9 |   63,0 |   47,5 |    −5,30 | 5/5 ujemnych  |
| browser | mobile    | SI [ms]       |           4104 |           1554 |    −2550 | −2099,1 | 1023,2 | 1700,8 | 1282,0 |    −4,59 | 5/5 ujemnych  |
| browser | mobile    | TTI [ms]      |           5783 |           5464 |     −319 |  −374,2 |  167,9 |  279,2 |  210,4 |    −4,98 | 5/5 ujemnych  |
| browser | mobile    | obs. FCP [ms] |            247 |            185 |      −62 |   −81,2 |   42,6 |   70,8 |   53,4 |    −4,26 | 5/5 ujemnych  |
| browser | mobile    | obs. LCP [ms] |            262 |            187 |      −75 |   −88,6 |   36,0 |   59,8 |   45,1 |    −5,51 | 5/5 ujemnych  |
| browser | mobile    | obs. SI [ms]  |            275 |            192 |      −83 |  −120,6 |   50,5 |   83,9 |   63,2 |    −5,34 | 5/5 ujemnych  |
| browser | desktop4x | perf          |             95 |             93 |       −2 |    +1,0 |    4,5 |    7,5 |    5,7 |    +0,49 | mieszane      |
| browser | desktop4x | FCP [ms]      |            851 |            396 |     −454 |  −461,3 |  106,2 |  176,6 |  133,1 |    −9,71 | 5/5 ujemnych  |
| browser | desktop4x | LCP [ms]      |            931 |            548 |     −383 |  −404,2 |   46,3 |   76,9 |   58,0 |   −19,53 | 5/5 ujemnych  |
| browser | desktop4x | TBT [ms]      |          156,6 |          216,0 |    +59,4 |   +23,2 |   74,5 |  123,8 |   93,3 |    +0,70 | mieszane      |
| browser | desktop4x | SI [ms]       |            851 |            564 |     −287 |  −322,3 |   78,9 |  131,2 |   98,9 |    −9,13 | 5/5 ujemnych  |
| browser | desktop4x | TTI [ms]      |           1747 |           1248 |     −499 |  −470,5 |  224,2 |  372,6 |  280,9 |    −4,69 | 5/5 ujemnych  |
| browser | desktop4x | obs. FCP [ms] |            333 |            140 |     −193 |  −159,8 |  100,8 |  167,5 |  126,2 |    −3,55 | 5/5 ujemnych  |
| browser | desktop4x | obs. LCP [ms] |            333 |            262 |      −71 |   −79,8 |   88,4 |  147,0 |  110,8 |    −2,02 | mieszane      |
| browser | desktop4x | obs. SI [ms]  |            368 |            223 |     −145 |  −149,6 |   91,3 |  151,8 |  114,4 |    −3,66 | 5/5 ujemnych  |
| browser | desktop5x | perf          |             74 |             82 |       +8 |    +7,2 |    7,5 |   12,5 |    9,4 |    +2,14 | 5/5 dodatnich |
| browser | desktop5x | FCP [ms]      |            906 |            440 |     −466 |  −475,8 |   94,5 |  157,1 |  118,4 |   −11,25 | 5/5 ujemnych  |
| browser | desktop5x | LCP [ms]      |            971 |            549 |     −423 |  −447,6 |   82,7 |  137,4 |  103,6 |   −12,10 | 5/5 ujemnych  |
| browser | desktop5x | TBT [ms]      |          606,0 |          407,0 |   −199,0 |  −123,5 |  192,7 |  320,3 |  241,4 |    −1,43 | mieszane      |
| browser | desktop5x | SI [ms]       |            940 |            725 |     −214 |  −228,0 |  111,0 |  184,5 |  139,1 |    −4,59 | 5/5 ujemnych  |
| browser | desktop5x | TTI [ms]      |           2352 |           1565 |     −788 |  −792,0 |  276,2 |  459,2 |  346,1 |    −6,41 | 5/5 ujemnych  |
| browser | desktop5x | obs. FCP [ms] |            328 |            247 |      −81 |   −88,6 |   53,3 |   88,5 |   66,7 |    −3,72 | 5/5 ujemnych  |
| browser | desktop5x | obs. LCP [ms] |            328 |            247 |      −81 |   −88,6 |   53,3 |   88,5 |   66,7 |    −3,72 | 5/5 ujemnych  |
| browser | desktop5x | obs. SI [ms]  |            366 |            261 |     −105 |  −112,4 |   31,5 |   52,4 |   39,5 |    −7,97 | 5/5 ujemnych  |
| bot     | mobile    | perf          |             69 |             97 |      +28 |   +27,6 |    1,8 |    3,0 |    2,3 |   +33,97 | 5/5 dodatnich |
| bot     | mobile    | FCP [ms]      |           4124 |           1542 |    −2583 | −2550,5 |   56,2 |   93,5 |   70,5 |  −101,40 | 5/5 ujemnych  |
| bot     | mobile    | LCP [ms]      |           4885 |           2307 |    −2578 | −2540,7 |   68,8 |  114,4 |   86,2 |   −82,53 | 5/5 ujemnych  |
| bot     | mobile    | TBT [ms]      |          176,5 |           83,0 |    −93,5 |  −101,8 |   74,3 |  123,5 |   93,1 |    −3,06 | 5/5 ujemnych  |
| bot     | mobile    | SI [ms]       |           4124 |           1629 |    −2495 | −2419,1 |  141,5 |  235,1 |  177,2 |   −38,24 | 5/5 ujemnych  |
| bot     | mobile    | TTI [ms]      |           5883 |           5489 |     −394 |  −345,6 |  230,2 |  382,6 |  288,4 |    −3,36 | 5/5 ujemnych  |
| bot     | mobile    | obs. FCP [ms] |            316 |            207 |     −109 |  −104,2 |   43,1 |   71,7 |   54,0 |    −5,40 | 5/5 ujemnych  |
| bot     | mobile    | obs. LCP [ms] |            316 |            207 |     −109 |  −104,2 |   43,1 |   71,7 |   54,0 |    −5,40 | 5/5 ujemnych  |
| bot     | mobile    | obs. SI [ms]  |            361 |            209 |     −152 |  −156,8 |   32,2 |   53,6 |   40,4 |   −10,88 | 5/5 ujemnych  |
| bot     | desktop4x | perf          |             88 |             89 |       +1 |    +3,0 |    2,7 |    4,6 |    3,4 |    +2,45 | mieszane      |
| bot     | desktop4x | FCP [ms]      |            853 |            489 |     −364 |  −377,0 |   51,4 |   85,5 |   64,5 |   −16,39 | 5/5 ujemnych  |
| bot     | desktop4x | LCP [ms]      |            934 |            560 |     −374 |  −383,0 |   14,7 |   24,5 |   18,5 |   −58,10 | 5/5 ujemnych  |
| bot     | desktop4x | TBT [ms]      |          262,5 |          268,0 |     +5,5 |   −18,9 |   38,1 |   63,3 |   47,7 |    −1,11 | mieszane      |
| bot     | desktop4x | SI [ms]       |            853 |            663 |     −190 |  −219,2 |   76,2 |  126,7 |   95,5 |    −6,43 | 5/5 ujemnych  |
| bot     | desktop4x | TTI [ms]      |           1874 |           1309 |     −565 |  −582,9 |  127,1 |  211,3 |  159,3 |   −10,25 | 5/5 ujemnych  |
| bot     | desktop4x | obs. FCP [ms] |            369 |            238 |     −131 |  −117,0 |   60,6 |  100,7 |   75,9 |    −4,32 | 5/5 ujemnych  |
| bot     | desktop4x | obs. LCP [ms] |            369 |            238 |     −131 |  −117,0 |   60,6 |  100,7 |   75,9 |    −4,32 | 5/5 ujemnych  |
| bot     | desktop4x | obs. SI [ms]  |            406 |            270 |     −136 |  −137,0 |   63,6 |  105,8 |   79,7 |    −4,81 | 5/5 ujemnych  |
| bot     | desktop5x | perf          |             76 |             84 |       +8 |    +8,2 |    5,1 |    8,4 |    6,4 |    +3,62 | 5/5 dodatnich |
| bot     | desktop5x | FCP [ms]      |            882 |            397 |     −485 |  −461,8 |  114,0 |  189,5 |  142,9 |    −9,06 | 5/5 ujemnych  |
| bot     | desktop5x | LCP [ms]      |            969 |            552 |     −417 |  −397,7 |   50,8 |   84,5 |   63,7 |   −17,50 | 5/5 ujemnych  |
| bot     | desktop5x | TBT [ms]      |          496,0 |          358,1 |   −137,9 |  −165,7 |  158,5 |  263,5 |  198,6 |    −2,34 | 5/5 ujemnych  |
| bot     | desktop5x | SI [ms]       |            916 |            625 |     −291 |  −270,4 |   99,1 |  164,7 |  124,1 |    −6,10 | 5/5 ujemnych  |
| bot     | desktop5x | TTI [ms]      |           2315 |           1393 |     −922 |  −845,4 |  173,9 |  289,1 |  217,9 |   −10,87 | 5/5 ujemnych  |
| bot     | desktop5x | obs. FCP [ms] |            332 |            232 |     −100 |  −122,8 |   58,1 |   96,6 |   72,8 |    −4,72 | 5/5 ujemnych  |
| bot     | desktop5x | obs. LCP [ms] |            334 |            248 |      −86 |   −92,2 |   12,6 |   20,9 |   15,8 |   −16,39 | 5/5 ujemnych  |
| bot     | desktop5x | obs. SI [ms]  |            370 |            233 |     −137 |  −136,0 |   32,9 |   54,7 |   41,2 |    −9,25 | 5/5 ujemnych  |

Linie `DELTA` harnessu (mediany, `MEASURE.md` §5): mobile browser / bot – główny wątek −2025 / −2544 ms, bootup
−1364 / −1614 ms, transfer −94,5 / −94,2 KB, JS −67,3 KB, bajty High przed obrazem LCP −508,1 KB, żądania −26 / −28;
desktop4x – główny wątek −1275 / −1577 ms, bootup −764 / −996 ms, żądania −26.

- **Mobile:** wszystkie metryki czasu lepsze w 5/5 parach w obu ramionach; |Δ̄| > MDE(t) wszędzie poza TBT i TTI
  bota (TBT −101,8 ms przy MDE(t) 123,5 / MDE(z) 93,1; TTI −345,6 ms przy 382,6 / 288,4 – powyżej MDE(z)): LCP
  −2,53 / −2,54 s (σΔ 0,13 / 0,07 s), TBT −89,7 / −101,8 ms, obs. SI −120,6 / −156,8 ms, perf +29,0 / +27,6 pkt. FCP browser ma σΔ 1023 ms przez parę 4 (A-mobile-4 w trybie
  częściowym, FCP 1,83 s).
- **desktop4x:** FCP −0,46 / −0,38 s, LCP −0,40 / −0,38 s, TTI −0,47 / −0,58 s (wszystkie 5/5), ale TBT bez zmiany
  (+23,2 / −18,9 ms, w szumie) i perf bez zmiany (+1,0 / +3,0 pkt).
- **desktop5x:** FCP/LCP jak wyżej, TBT −123,5 / −165,7 ms (w szumie), perf +7,2 / +8,2.
- Uwaga do równowagi serii: reżim refetchu postów klienta (8 lub 4 × `GET /rest/v1/posts`) trafił A 3/15 i B 5/15
  (browser), A 1/15 i B 5/15 (bot) (`MEASURE.md` §7 pkt 4) – nierównowaga działa przeciw B.

Waga dokumentu (`MEASURE.md` §8, 5 próbek HIT, oba drzewa w swoich progach): `htmlRawBytes` 391,5 → 330,0 KB,
`htmlGzipBytes` 55,5 → 51,4 KB, `headRawBytes` 25,3 → 28,3 KB (loader i zestaw bootu P2.1), `inlineStyleCount`
50 → 25, `modulepreloadCount` 25 → 0, `preLcpTransferBytes` 727,9 → 173,9 KB, `bootClosureGzipBytes` 474,0 → 484,5 KB.

## 4. Księga Lantern per klasa zadania: W2 wobec W1

Źródło: `$A/results.json` (`arms.*.kLedger`), z `lanternTasks --min 0 --json`; blokowanie klasy w przebiegu = suma jej
zadań (0, gdy brak), mediana z 5 przebiegów; w nawiasie: przebiegi z blokowaniem > 0 / przebiegi z zadaniem
≥ 50 ms sym. w oknie. Pominięte klasy z zerową medianą po obu stronach i ≤ 1 wystąpieniem. Sumy klas = TBT.

### 4.1 mobile i desktop4x (zmierzone)

| ramię   | forma     | klasa K                                                         | A (W1): mediana blok. [ms] (przebiegi z blok. / ≥ 50 ms sym. w oknie) | B (W2): mediana blok. [ms] (jw.) | B: blokowanie per przebieg [ms] |
| ------- | --------- | --------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------- | ------------------------------- |
| browser | mobile    | K15 ParseHTML w commicie (innerHTML)                            | 70,0 (5/5; 5/5)                                                       | **0,0** (0/5; 0/5)               | 0,0, 0,0, 0,0, 0,0, 0,0         |
| browser | mobile    | K12 commit hydratacji (vendor-react z Layout)                   | 13,0 (5/5; 5/5)                                                       | **3,0** (5/5; 5/5)               | 2,5, 3,0, 3,0, 12,0, 4,0        |
| browser | mobile    | K14 plastry Reacta                                              | 12,5 (5/5; 5/5)                                                       | **0,0** (2/5; 2/5)               | 0,0, 0,0, 10,0, 6,5, 0,0        |
| browser | mobile    | K16 restyle po przełączeniu urządzenia                          | 0,0 (1/5; 1/5)                                                        | **7,8** (3/5; 3/5)               | 26,0, 0,0, 7,8, 25,0, 0,0       |
| browser | mobile    | K13 styl wymuszony z index po commicie                          | 5,0 (3/5; 3/5)                                                        | **0,0** (2/5; 2/5)               | 0,0, 7,0, 8,0, 0,0, 0,0         |
| browser | mobile    | K7 ScriptCatchup (kompilacja zestawu bootu)                     | 0,0 (0/5; 1/5)                                                        | **0,0** (0/5; 3/5)               | 0,0, 0,0, 0,0, 0,0, 0,0         |
| browser | mobile    | K11/K10 Timer:index (timer startu, createRouter)                | 0,0 (1/5; 1/5)                                                        | **0,0** (2/5; 2/5)               | 0,0, 0,0, 0,0, 12,0, 2,0        |
| browser | mobile    | K4 ParseHTML dokumentu                                          | 0,0 (1/5; 1/5)                                                        | **0,0** (1/5; 1/5)               | 0,0, 0,0, 12,0, 0,0, 0,0        |
| browser | mobile    | K9 przebieg korzenia (Script:index)                             | 0,0 (0/5; 0/5)                                                        | **0,0** (2/5; 2/5)               | 0,0, 18,0, 0,0, 0,0, 49,0       |
| browser | desktop4x | K7 ScriptCatchup (kompilacja zestawu bootu)                     | 78,0 (4/5; 5/5)                                                       | **96,0** (5/5; 5/5)              | 138,0, 96,0, 83,0, 88,0, 98,0   |
| browser | desktop4x | K14 plastry Reacta                                              | 44,9 (5/5; 5/5)                                                       | **0,0** (2/5; 2/5)               | 0,0, 7,0, 0,0, 25,0, 0,0        |
| browser | desktop4x | K5/K6 klatki Style+Layout dokumentu przed hydratacją ($RV)      | 36,5 (3/5; 3/5)                                                       | **43,0** (5/5; 5/5)              | 44,0, 27,0, 34,0, 47,0, 43,0    |
| browser | desktop4x | K12 commit hydratacji (vendor-react z Layout)                   | 31,0 (5/5; 5/5)                                                       | **11,5** (5/5; 5/5)              | 17,0, 11,5, 9,5, 12,5, 9,5      |
| browser | desktop4x | K4i skrypt inline: loader bootu przy DCL (wymusza Style+Layout) | 0,0 (0/5; 0/5)                                                        | **19,0** (4/5; 5/5)              | 0,0, 19,0, 37,0, 12,0, 28,0     |
| browser | desktop4x | K13 styl wymuszony z index po commicie                          | 9,0 (4/5; 4/5)                                                        | **0,0** (2/5; 2/5)               | 0,0, 0,0, 0,0, 8,0, 18,0        |
| browser | desktop4x | K11/K10 Timer:index (timer startu, createRouter)                | 3,0 (3/5; 3/5)                                                        | **4,0** (3/5; 3/5)               | 0,0, 4,0, 0,0, 11,0, 16,0       |
| browser | desktop4x | K1 nawigacja                                                    | 0,0 (0/5; 0/5)                                                        | **0,0** (0/5; 2/5)               | 0,0, 0,0, 0,0, 0,0, 0,0         |
| browser | desktop4x | K4 ParseHTML dokumentu                                          | 0,0 (1/5; 1/5)                                                        | **0,0** (1/5; 1/5)               | 17,0, 0,0, 0,0, 0,0, 0,0        |
| bot     | mobile    | K15 ParseHTML w commicie (innerHTML)                            | 70,0 (5/5; 5/5)                                                       | **0,0** (0/5; 0/5)               | 0,0, 0,0, 0,0, 0,0, 0,0         |
| bot     | mobile    | K14 plastry Reacta                                              | 41,5 (5/5; 5/5)                                                       | **8,0** (4/5; 4/5)               | 8,0, 9,5, 16,0, 6,0, 0,0        |
| bot     | mobile    | K16 restyle po przełączeniu urządzenia                          | 0,0 (0/5; 0/5)                                                        | **35,0** (4/5; 4/5)              | 22,0, 61,0, 35,0, 0,0, 50,0     |
| bot     | mobile    | K13 styl wymuszony z index po commicie                          | 25,0 (5/5; 5/5)                                                       | **2,0** (3/5; 3/5)               | 3,0, 0,0, 2,0, 0,0, 6,0         |
| bot     | mobile    | K11/K10 Timer:index (timer startu, createRouter)                | 18,0 (4/5; 5/5)                                                       | **8,0** (4/5; 4/5)               | 18,0, 8,0, 7,0, 0,0, 22,0       |
| bot     | mobile    | K12 commit hydratacji (vendor-react z Layout)                   | 14,0 (5/5; 5/5)                                                       | **10,0** (5/5; 5/5)              | 10,5, 4,5, 10,5, 8,0, 10,0      |
| bot     | mobile    | K7 ScriptCatchup (kompilacja zestawu bootu)                     | 0,0 (0/5; 0/5)                                                        | **0,0** (1/5; 4/5)               | 0,0, 0,0, 11,9, 0,0, 0,0        |
| bot     | mobile    | K2 ParseCSS                                                     | 0,0 (0/5; 0/5)                                                        | **0,0** (1/5; 2/5)               | 0,0, 0,0, 23,0, 0,0, 0,0        |
| bot     | mobile    | K9a ewaluacja modułów wejścia                                   | 0,0 (0/5; 0/5)                                                        | **0,0** (2/5; 2/5)               | 8,0, 0,0, 3,0, 0,0, 0,0         |
| bot     | mobile    | Kmod inne chunki (leniwe moduły, timery)                        | 0,0 (2/5; 2/5)                                                        | **0,0** (0/5; 0/5)               | 0,0, 0,0, 0,0, 0,0, 0,0         |
| bot     | desktop4x | K7 ScriptCatchup (kompilacja zestawu bootu)                     | 97,0 (5/5; 5/5)                                                       | **123,0** (5/5; 5/5)             | 83,0, 123,0, 149,0, 91,0, 126,0 |
| bot     | desktop4x | K5/K6 klatki Style+Layout dokumentu przed hydratacją ($RV)      | 0,0 (2/5; 5/5)                                                        | **89,0** (5/5; 5/5)              | 66,0, 106,0, 79,0, 89,0, 95,0   |
| bot     | desktop4x | K14 plastry Reacta                                              | 69,5 (5/5; 5/5)                                                       | **5,0** (4/5; 5/5)               | 0,0, 3,0, 6,5, 7,5, 5,0         |
| bot     | desktop4x | K12 commit hydratacji (vendor-react z Layout)                   | 52,0 (5/5; 5/5)                                                       | **21,5** (5/5; 5/5)              | 21,5, 28,0, 17,0, 35,0, 17,5    |
| bot     | desktop4x | K13 styl wymuszony z index po commicie                          | 28,0 (5/5; 5/5)                                                       | **6,0** (5/5; 5/5)               | 6,0, 12,0, 9,0, 3,5, 6,0        |
| bot     | desktop4x | K11/K10 Timer:index (timer startu, createRouter)                | 11,0 (5/5; 5/5)                                                       | **0,0** (1/5; 1/5)               | 0,0, 0,0, 7,0, 0,0, 0,0         |
| bot     | desktop4x | K4 ParseHTML dokumentu                                          | 0,0 (1/5; 1/5)                                                        | **0,0** (2/5; 3/5)               | 0,0, 0,0, 34,0, 42,0, 0,0       |
| bot     | desktop4x | K9a ewaluacja modułów wejścia                                   | 0,0 (1/5; 1/5)                                                        | **0,0** (0/5; 2/5)               | 0,0, 0,0, 0,0, 0,0, 0,0         |
| bot     | desktop4x | Kmod inne chunki (leniwe moduły, timery)                        | 0,0 (1/5; 1/5)                                                        | **0,0** (2/5; 2/5)               | 9,0, 0,0, 0,0, 0,0, 1,0         |

### 4.2 desktop5x (zmierzone)

| ramię   | forma     | klasa K                                                         | A (W1): mediana blok. [ms] (przebiegi z blok. / ≥ 50 ms sym. w oknie) | B (W2): mediana blok. [ms] (jw.) | B: blokowanie per przebieg [ms]   |
| ------- | --------- | --------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------- | --------------------------------- |
| browser | desktop5x | K7 ScriptCatchup (kompilacja zestawu bootu)                     | 159,0 (5/5; 5/5)                                                      | **136,0** (5/5; 5/5)             | 183,0, 121,0, 136,0, 121,0, 184,5 |
| browser | desktop5x | K14 plastry Reacta                                              | 146,5 (5/5; 5/5)                                                      | **23,0** (5/5; 5/5)              | 168,0, 19,5, 58,5, 23,0, 16,0     |
| browser | desktop5x | K5/K6 klatki Style+Layout dokumentu przed hydratacją ($RV)      | 92,8 (5/5; 5/5)                                                       | **87,0** (5/5; 5/5)              | 113,0, 142,0, 87,0, 65,0, 60,0    |
| browser | desktop5x | K12 commit hydratacji (vendor-react z Layout)                   | 67,0 (5/5; 5/5)                                                       | **29,0** (5/5; 5/5)              | 73,0, 27,0, 21,0, 29,0, 29,5      |
| browser | desktop5x | K4 ParseHTML dokumentu                                          | 1,0 (3/5; 4/5)                                                        | **30,0** (5/5; 5/5)              | 91,0, 56,0, 12,0, 30,0, 9,0       |
| browser | desktop5x | K13 styl wymuszony z index po commicie                          | 29,0 (5/5; 5/5)                                                       | **18,5** (5/5; 5/5)              | 18,5, 20,0, 7,0, 19,0, 7,0        |
| browser | desktop5x | K11/K10 Timer:index (timer startu, createRouter)                | 25,0 (5/5; 5/5)                                                       | **4,5** (4/5; 5/5)               | 36,0, 0,0, 4,0, 4,5, 22,5         |
| browser | desktop5x | K6b klatka Style+Layout po starcie bootu                        | 23,5 (4/5; 4/5)                                                       | **0,0** (0/5; 0/5)               | 0,0, 0,0, 0,0, 0,0, 0,0           |
| browser | desktop5x | K9a ewaluacja modułów wejścia                                   | 0,0 (1/5; 1/5)                                                        | **8,0** (3/5; 3/5)               | 10,0, 19,5, 0,0, 0,0, 8,0         |
| browser | desktop5x | K- kompozytor (Layerize/Paint)                                  | 0,0 (2/5; 2/5)                                                        | **0,0** (1/5; 1/5)               | 0,0, 0,0, 0,0, 0,0, 11,0          |
| browser | desktop5x | K1 nawigacja                                                    | 0,0 (0/5; 0/5)                                                        | **0,0** (0/5; 3/5)               | 0,0, 0,0, 0,0, 0,0, 0,0           |
| browser | desktop5x | K- inne                                                         | 0,0 (1/5; 1/5)                                                        | **0,0** (1/5; 1/5)               | 0,0, 0,0, 0,0, 0,0, 1,0           |
| browser | desktop5x | K2 ParseCSS                                                     | 0,0 (0/5; 0/5)                                                        | **0,0** (2/5; 2/5)               | 0,0, 2,0, 13,0, 0,0, 0,0          |
| browser | desktop5x | Kmod inne chunki (leniwe moduły, timery)                        | 0,0 (1/5; 1/5)                                                        | **0,0** (1/5; 1/5)               | 0,0, 0,0, 0,0, 1,0, 0,0           |
| bot     | desktop5x | K7 ScriptCatchup (kompilacja zestawu bootu)                     | 156,0 (5/5; 5/5)                                                      | **143,0** (5/5; 5/5)             | 108,0, 180,0, 126,0, 143,0, 181,0 |
| bot     | desktop5x | K14 plastry Reacta                                              | 111,0 (5/5; 5/5)                                                      | **21,0** (5/5; 5/5)              | 51,9, 21,0, 15,5, 3,5, 29,5       |
| bot     | desktop5x | K5/K6 klatki Style+Layout dokumentu przed hydratacją ($RV)      | 109,0 (5/5; 5/5)                                                      | **0,0** (2/5; 2/5)               | 0,0, 121,0, 120,0, 0,0, 0,0       |
| bot     | desktop5x | K4i skrypt inline: loader bootu przy DCL (wymusza Style+Layout) | 0,0 (0/5; 0/5)                                                        | **76,0** (3/5; 3/5)              | 76,0, 0,0, 0,0, 88,0, 103,0       |
| bot     | desktop5x | K12 commit hydratacji (vendor-react z Layout)                   | 65,0 (5/5; 5/5)                                                       | **36,0** (5/5; 5/5)              | 16,5, 57,0, 36,0, 23,5, 37,5      |
| bot     | desktop5x | K13 styl wymuszony z index po commicie                          | 35,0 (5/5; 5/5)                                                       | **13,5** (5/5; 5/5)              | 3,0, 13,5, 15,6, 6,5, 14,5        |
| bot     | desktop5x | K11/K10 Timer:index (timer startu, createRouter)                | 27,0 (5/5; 5/5)                                                       | **17,0** (5/5; 5/5)              | 7,0, 38,0, 6,0, 17,0, 56,0        |
| bot     | desktop5x | K4 ParseHTML dokumentu                                          | 2,0 (3/5; 4/5)                                                        | **19,0** (5/5; 5/5)              | 19,0, 1,0, 14,0, 24,0, 26,0       |
| bot     | desktop5x | K1 nawigacja                                                    | 0,0 (0/5; 0/5)                                                        | **0,0** (1/5; 3/5)               | 0,0, 0,0, 0,0, 0,0, 2,3           |
| bot     | desktop5x | Kmod inne chunki (leniwe moduły, timery)                        | 0,0 (1/5; 1/5)                                                        | **0,0** (2/5; 2/5)               | 1,0, 0,0, 22,0, 0,0, 0,0          |
| bot     | desktop5x | K7b kompilacja modułu (v8.compileModule)                        | 0,0 (0/5; 0/5)                                                        | **0,0** (2/5; 2/5)               | 0,0, 0,0, 3,0, 12,0, 0,0          |
| bot     | desktop5x | K9a ewaluacja modułów wejścia                                   | 0,0 (0/5; 0/5)                                                        | **0,0** (1/5; 2/5)               | 0,0, 0,0, 0,0, 0,0, 12,0          |

**Co z tego wynika:**

- **Spłacone przez falę 2:** K15 (ParseHTML w commicie przełączenia urządzenia, `innerHTML` arkuszy) – mobile A 5/5
  → B 0/5 w obu ramionach, blokowanie 70,0 → 0 ms (P2.4); K14 (plastry Reacta) – mobile 12,5 / 41,5 → 0,0 / 8,0 ms, desktop4x 44,9 / 69,5 → 0,0 / 5,0,
  desktop5x 146,5 / 111,0 → 23,0 / 21,0 ms (P2.2); K12 – blokowanie zmniejszone (desktop4x 31,0 / 52,0 → 11,5 / 21,5
  ms), ale **nadal jedno zadanie ≥ 50 ms sym. w oknie w 5/5 przebiegach każdej formy i ramienia** (nierozbite,
  przekazanie P2.2); K13 – mniejsze (desktop4x 9,0 / 28,0 → 0,0 / 6,0 ms).
- **Wciągnięte do okna przez boot po LCP (sprzężenie C3):** **K7 `ScriptCatchup`** – desktop4x 96,0 / 123,0 ms (5/5),
  desktop5x 136,0 / 143,0 ms (5/5), mobile ≥ 50 ms sym. w oknie w 3/5 / 4/5, ale z blokowaniem ≈ 0 (zadanie
  przecina FCP_sim); **K5/K6** pierwsza klatka Style+Layout z `$RV` – desktop4x 43,0 / 89,0 ms (5/5); **K4i** loader
  bootu – desktop4x browser 19,0 ms (4/5), desktop5x bot 76,0 ms (3/5, komplementarnie z K5/K6 2/5: razem pierwsza
  klatka dokumentu w oknie w 5/5); **K4** ParseHTML dokumentu – desktop5x 30,0 / 19,0 ms (5/5); **K16** restyle po
  przełączeniu urządzenia (693–694 el.) – mobile 7,8 / 35,0 ms (3/5 / 4/5), na W1 przed FCP. Na mobile klasy te są
  dziś małe, bo okno W2 zaczyna się przy FCP_sim ≈ 1,5 s, a zadania bootu trwają w symulacji krótko na tym hoście (§5).
- Lista różnic per zadanie (para po parze): `$A/diff-series/lh-{browser,bot}-{mobile,desktop4x,desktop5x}.txt`.

## 5. Wrażliwość na szybkość hosta (przeliczenie Lantern, bez nowego pomiaru)

Metoda (`$A/cpu-whatif.mjs`, `$A/cpu-ledger.mjs`): na tych samych artefaktach Lantern (LoadSimulator + LanternTBT/FCP/
LCP/TTI z Lighthouse 13.5.0, jak audyt) z `cpuSlowdownMultiplier` m' = m × benchmarkIndex przebiegu / 1616,5, czyli
mnożnikiem, który ten ślad miałby na hoście o szybkości z serii kalibracji k (POMIAR §7). Przy m' = m (kontrola)
TBT i suma księgi są identyczne z audytem w 20/20 przebiegach na ramię (mobile i desktop4x). Ta sama technika co
what-if d4/d5 w P0.5 (`whatif.py` na artefaktach x1). Kontrola trafności: A (drzewo W1) przeliczone do benchmarkIndex
1357 (mediana strony B mobile w bramce W1, 1356,5 w `W1-wyniki.json`) daje TBT mobile 515,5 ms i desktop4x 950,5 ms (`$A/cpu-whatif-w1host-browser.json`)
wobec 374 / 1037 ms zmierzonych na W1 w bramce W1 – ten sam rząd wielkości (mobile o ok. 140 ms wyżej; drzewo A ma
późniejsze scalenia `main`).

| ramię   | forma     | benchmarkIndex B (przebiegi) | m' B                         | TBT A: zmierzone → m' (mediana) | TBT B: zmierzone → m' (przebiegi; mediana)           | pary B−A przy m': Δ̄ / σΔ / MDE(t) / t |
| ------- | --------- | ---------------------------- | ---------------------------- | ------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| browser | mobile    | 2778, 2637, 2553, 2446, 2617 | 6,88, 6,53, 6,32, 6,05, 6,48 | 114,5 → **337,0**               | 450,5, 348,5, 416,3, 426,5, 352,5; 40,8 → **416,3**  | −41,1 / 202,7 / 337,0 / −0,45         |
| browser | desktop4x | 2406, 2689, 2352, 2423, 2368 | 5,96, 6,65, 5,82, 6,00, 5,86 | 156,6 → **638,5**               | 478,0, 707,5, 416,8, 542,5, 511,4; 216,0 → **511,4** | −129,4 / 46,1 / 76,7 / −6,27          |
| bot     | mobile    | 2372, 2367, 2378, 2308, 2364 | 5,87, 5,86, 5,88, 5,71, 5,85 | 176,5 → **332,0**               | 431,5, 439,7, 470,0, 161,0, 376,5; 83,0 → **431,5**  | +26,5 / 205,0 / 340,8 / +0,29         |
| bot     | desktop4x | 2464, 2454, 2202, 2000, 2266 | 6,10, 6,07, 5,45, 4,95, 5,61 | 262,5 → **820,5**               | 467,0, 581,0, 610,5, 419,5, 492,1; 268,0 → **492,1** | −285,4 / 106,0 / 176,2 / −6,02        |

Księga per klasa przy m' (`$A/results.json`, `hostNorm.arms.*.kLedger`):

| ramię   | forma     | klasa K                                                         | A (W1): mediana blok. [ms] (przebiegi z blok. / ≥ 50 ms sym. w oknie) | B (W2): mediana blok. [ms] (jw.) | B: blokowanie per przebieg [ms]   |
| ------- | --------- | --------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------- | --------------------------------- |
| browser | mobile    | K7 ScriptCatchup (kompilacja zestawu bootu)                     | 0,0 (1/5; 1/5)                                                        | **161,0** (5/5; 5/5)             | 173,0, 161,0, 121,8, 199,0, 158,0 |
| browser | mobile    | K15 ParseHTML w commicie (innerHTML)                            | 119,0 (5/5; 5/5)                                                      | **0,0** (0/5; 0/5)               | 0,0, 0,0, 0,0, 0,0, 0,0           |
| browser | mobile    | K14 plastry Reacta                                              | 116,5 (5/5; 5/5)                                                      | **29,0** (4/5; 4/5)              | 0,0, 29,0, 73,0, 54,5, 10,0       |
| browser | mobile    | K16 restyle po przełączeniu urządzenia                          | 0,0 (1/5; 1/5)                                                        | **55,0** (3/5; 3/5)              | 81,0, 0,0, 55,0, 63,0, 0,0        |
| browser | mobile    | K13 styl wymuszony z index po commicie                          | 35,0 (5/5; 5/5)                                                       | **22,0** (5/5; 5/5)              | 22,0, 43,0, 42,0, 19,0, 18,0      |
| browser | mobile    | K12 commit hydratacji (vendor-react z Layout)                   | 32,5 (5/5; 5/5)                                                       | **22,5** (5/5; 5/5)              | 22,5, 20,5, 19,5, 31,0, 22,5      |
| browser | mobile    | K11/K10 Timer:index (timer startu, createRouter)                | 22,0 (5/5; 5/5)                                                       | **27,0** (4/5; 4/5)              | 27,0, 0,0, 26,0, 44,0, 34,0       |
| browser | mobile    | K5/K6 klatki Style+Layout dokumentu przed hydratacją ($RV)      | 0,0 (1/5; 1/5)                                                        | **0,0** (2/5; 4/5)               | 77,0, 35,0, 0,0, 0,0, 0,0         |
| browser | mobile    | Kmod inne chunki (leniwe moduły, timery)                        | 0,0 (2/5; 2/5)                                                        | **0,0** (0/5; 0/5)               | 0,0, 0,0, 0,0, 0,0, 0,0           |
| browser | mobile    | K6b klatka Style+Layout po starcie bootu                        | 0,0 (1/5; 1/5)                                                        | **0,0** (1/5; 1/5)               | 0,0, 0,0, 31,0, 0,0, 0,0          |
| browser | mobile    | K4 ParseHTML dokumentu                                          | 0,0 (1/5; 1/5)                                                        | **0,0** (1/5; 1/5)               | 0,0, 0,0, 48,0, 0,0, 0,0          |
| browser | mobile    | K9 przebieg korzenia (Script:index)                             | 0,0 (0/5; 0/5)                                                        | **0,0** (2/5; 2/5)               | 0,0, 60,0, 0,0, 0,0, 110,0        |
| browser | desktop4x | K14 plastry Reacta                                              | 187,0 (5/5; 5/5)                                                      | **11,0** (5/5; 5/5)              | 11,0, 45,0, 9,0, 116,0, 10,0      |
| browser | desktop4x | K7 ScriptCatchup (kompilacja zestawu bootu)                     | 163,0 (5/5; 5/5)                                                      | **166,0** (5/5; 5/5)             | 230,0, 193,0, 144,0, 156,0, 166,0 |
| browser | desktop4x | K5/K6 klatki Style+Layout dokumentu przed hydratacją ($RV)      | 130,4 (5/5; 5/5)                                                      | **86,0** (5/5; 5/5)              | 90,0, 78,0, 72,0, 96,0, 86,0      |
| browser | desktop4x | K12 commit hydratacji (vendor-react z Layout)                   | 75,0 (5/5; 5/5)                                                       | **35,5** (5/5; 5/5)              | 37,5, 35,5, 25,0, 39,0, 25,5      |
| browser | desktop4x | K4i skrypt inline: loader bootu przy DCL (wymusza Style+Layout) | 0,0 (0/5; 0/5)                                                        | **64,0** (4/5; 5/5)              | 0,0, 65,0, 77,0, 42,0, 64,0       |
| browser | desktop4x | K4 ParseHTML dokumentu                                          | 45,0 (3/5; 3/5)                                                       | **34,0** (5/5; 5/5)              | 50,0, 53,0, 24,0, 34,0, 33,0      |
| browser | desktop4x | K13 styl wymuszony z index po commicie                          | 42,0 (5/5; 5/5)                                                       | **14,5** (5/5; 5/5)              | 10,0, 14,5, 10,5, 18,5, 25,0      |
| browser | desktop4x | K11/K10 Timer:index (timer startu, createRouter)                | 25,0 (5/5; 5/5)                                                       | **38,0** (5/5; 5/5)              | 7,5, 39,0, 19,0, 41,0, 38,0       |
| browser | desktop4x | K1 nawigacja                                                    | 0,0 (0/5; 0/5)                                                        | **0,7** (3/5; 4/5)               | 0,0, 8,0, 0,7, 0,0, 33,9          |
| browser | desktop4x | K- kompozytor (Layerize/Paint)                                  | 0,0 (0/5; 0/5)                                                        | **0,0** (2/5; 2/5)               | 15,0, 174,0, 0,0, 0,0, 0,0        |
| browser | desktop4x | Kmod inne chunki (leniwe moduły, timery)                        | 0,0 (1/5; 1/5)                                                        | **0,0** (2/5; 2/5)               | 10,0, 2,5, 0,0, 0,0, 0,0          |
| browser | desktop4x | K9a ewaluacja modułów wejścia                                   | 0,0 (2/5; 2/5)                                                        | **0,0** (1/5; 1/5)               | 17,0, 0,0, 0,0, 0,0, 0,0          |
| browser | desktop4x | K2 ParseCSS                                                     | 0,0 (0/5; 1/5)                                                        | **0,0** (1/5; 1/5)               | 0,0, 0,0, 0,0, 0,0, 11,0          |
| bot     | mobile    | K7 ScriptCatchup (kompilacja zestawu bootu)                     | 0,0 (0/5; 0/5)                                                        | **152,0** (4/5; 4/5)             | 167,0, 163,0, 152,0, 0,0, 137,0   |
| bot     | mobile    | K14 plastry Reacta                                              | 111,0 (5/5; 5/5)                                                      | **35,0** (5/5; 5/5)              | 35,0, 47,5, 58,0, 30,0, 17,0      |
| bot     | mobile    | K15 ParseHTML w commicie (innerHTML)                            | 83,5 (5/5; 5/5)                                                       | **0,0** (0/5; 0/5)               | 0,0, 0,0, 0,0, 0,0, 0,0           |
| bot     | mobile    | K16 restyle po przełączeniu urządzenia                          | 0,0 (0/5; 0/5)                                                        | **74,0** (4/5; 4/5)              | 55,0, 112,0, 74,0, 0,0, 96,0      |
| bot     | mobile    | K13 styl wymuszony z index po commicie                          | 52,0 (5/5; 5/5)                                                       | **26,0** (5/5; 5/5)              | 28,0, 14,0, 26,0, 11,0, 32,0      |
| bot     | mobile    | K11/K10 Timer:index (timer startu, createRouter)                | 37,0 (5/5; 5/5)                                                       | **35,0** (5/5; 5/5)              | 49,0, 35,0, 34,0, 14,0, 55,0      |
| bot     | mobile    | K12 commit hydratacji (vendor-react z Layout)                   | 28,0 (5/5; 5/5)                                                       | **26,5** (5/5; 5/5)              | 26,5, 18,0, 27,0, 22,0, 26,5      |
| bot     | mobile    | K9a ewaluacja modułów wejścia                                   | 0,0 (0/5; 0/5)                                                        | **18,0** (3/5; 3/5)              | 35,0, 18,0, 28,0, 0,0, 0,0        |
| bot     | mobile    | Kmod inne chunki (leniwe moduły, timery)                        | 0,0 (2/5; 2/5)                                                        | **0,0** (2/5; 3/5)               | 13,0, 19,2, 0,0, 0,0, 0,0         |
| bot     | mobile    | K4i skrypt inline: loader bootu przy DCL (wymusza Style+Layout) | 0,0 (0/5; 0/5)                                                        | **0,0** (2/5; 2/5)               | 0,0, 0,0, 14,0, 0,0, 13,0         |
| bot     | mobile    | K4 ParseHTML dokumentu                                          | 0,0 (0/5; 0/5)                                                        | **0,0** (1/5; 2/5)               | 0,0, 0,0, 0,0, 84,0, 0,0          |
| bot     | mobile    | K2 ParseCSS                                                     | 0,0 (0/5; 0/5)                                                        | **0,0** (2/5; 2/5)               | 23,0, 0,0, 57,0, 0,0, 0,0         |
| bot     | desktop4x | K14 plastry Reacta                                              | 218,5 (5/5; 5/5)                                                      | **35,5** (5/5; 5/5)              | 36,0, 34,0, 35,5, 21,5, 45,6      |
| bot     | desktop4x | K7 ScriptCatchup (kompilacja zestawu bootu)                     | 165,0 (5/5; 5/5)                                                      | **197,0** (5/5; 5/5)             | 152,0, 221,5, 221,0, 124,0, 197,0 |
| bot     | desktop4x | K5/K6 klatki Style+Layout dokumentu przed hydratacją ($RV)      | 172,0 (5/5; 5/5)                                                      | **143,0** (5/5; 5/5)             | 126,0, 186,0, 143,0, 122,0, 153,0 |
| bot     | desktop4x | K12 commit hydratacji (vendor-react z Layout)                   | 98,0 (5/5; 5/5)                                                       | **45,5** (5/5; 5/5)              | 45,5, 55,5, 32,0, 49,0, 35,0      |
| bot     | desktop4x | K13 styl wymuszony z index po commicie                          | 62,0 (5/5; 5/5)                                                       | **21,5** (5/5; 5/5)              | 22,5, 31,0, 21,5, 10,5, 18,5      |
| bot     | desktop4x | K11/K10 Timer:index (timer startu, createRouter)                | 40,0 (5/5; 5/5)                                                       | **14,0** (5/5; 5/5)              | 19,0, 11,0, 27,0, 5,0, 14,0       |
| bot     | desktop4x | K4 ParseHTML dokumentu                                          | 34,0 (3/5; 3/5)                                                       | **26,0** (5/5; 5/5)              | 26,0, 11,0, 108,0, 75,0, 8,0      |
| bot     | desktop4x | K9a ewaluacja modułów wejścia                                   | 0,0 (2/5; 2/5)                                                        | **11,0** (3/5; 3/5)              | 0,0, 16,0, 18,0, 11,0, 0,0        |
| bot     | desktop4x | Kmod inne chunki (leniwe moduły, timery)                        | 5,0 (3/5; 3/5)                                                        | **4,5** (4/5; 4/5)               | 40,0, 0,0, 4,5, 1,5, 21,0         |
| bot     | desktop4x | K2 ParseCSS                                                     | 0,0 (0/5; 0/5)                                                        | **0,0** (0/5; 2/5)               | 0,0, 0,0, 0,0, 0,0, 0,0           |

- Przy m' **TBT mobile W2 nie jest już niższe niż W1** (pary −41,1 / +26,5 ms przy MDE(t) 337 / 341 ms), a wartość
  bezwzględna (416,3 / 431,5 ms) leży ponad progiem 200 ms bramki. Na desktop4x W2 jest wyraźnie lepsze od W1
  (−129,4 / −285,4 ms, t −6,27 / −6,02), ale 511,4 / 492,1 ms to ponad trzykrotność progu 150 ms.
- **Największa klasa przy m' na mobile to K7 `ScriptCatchup`** (161,0 / 152,0 ms, ≥ 50 ms sym. w oknie w 5/5 / 4/5),
  dalej K16 (55,0 / 74,0), K14 (29,0 / 35,0), K11/K10 (27,0 / 35,0), K12 (22,5 / 26,5), K13 (22,0 / 26,0). Na
  desktop4x: K7 (166,0 / 197,0), K5/K6 (86,0 / 143,0), K4i (64,0 browser), K12 (35,5 / 45,5), K4 (34,0 / 26,0).
- Wniosek: werdykt (d) i (e) nie zależy od hosta (gorzej przy m'), werdykt (c) – tak. Prognozę PSI (§7) liczę w obu
  wariantach i za punkt przyjmuję wariant znormalizowany, bo k (POMIAR §7) skalibrowano przy benchmarkIndex 1616,5.

## 6. Definition of Done fali 2

| Warunek DoD (PLAN-FALE-1-2 §3.3; §6)                                                         | Zmierzone (browser / bot)                                                                                                            | Werdykt                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| fixture mobile x4 TBT 234–457 ms w kombinacji (C3 sam: 885)                                  | 40,8 / 83,0 ms (lepiej niż pasmo); przy m' (§5) 416,3 / 431,5 ms – w paśmie, blisko górnej granicy                                   | **spełnione**                      |
| §6 (P0.5): fixture po W2 z C3 ×0,5 / pełne – mobile 201 / 87, d4 244 / 130, d5 450 / 229 ms  | mobile 40,8 / 83,0 (lepiej niż „pełne”); d4 216,0 / 268,0 (browser między ×0,5 a pełnymi, bot ponad ×0,5); d5 407,0 / 358,1 (między) | mobile tak, desktop częściowo      |
| FCP 1,37–1,52 s                                                                              | mediany 1,554 / 1,542 s (+0,034 / +0,022 s ponad pasmem); w paśmie 0/5 przebiegów w obu ramionach (min. 1,525 / 1,521 s)             | **niespełnione** (o 0,02–0,03 s)   |
| LCP 2,12–2,27 s                                                                              | mediany 2,332 / 2,307 s (+0,062 / +0,037 s); w paśmie 0/5 (min. 2,282 / 2,281 s)                                                     | **niespełnione** (o 0,04–0,06 s)   |
| prognoza PSI mobile 81–87 (centralnie 84)                                                    | 86,70 / 86,10 (F1h, §7); dosłownie 93,00 / 93,00                                                                                     | **spełnione** (górna połowa pasma) |
| prognoza PSI desktop 82–85                                                                   | 91,05 / 91,65 (F1h); dosłownie 97,65 / 96,75                                                                                         | **spełnione z nadwyżką**           |
| jeśli bramka zielona: wdrożenie i potwierdzenie PSI (`hl=pl`, `psi-sample.mjs`, mediana z 5) | bramka niezielona                                                                                                                    | nie dotyczy                        |
| **DoD łącznie**                                                                              |                                                                                                                                      | **częściowo**                      |

FCP i LCP mieszczą się w progach bramki (1,6 / 2,4 s na medianach), ale nie w węższym paśmie DoD; brakujące
0,02–0,06 s to dokładnie łańcuch CSS → font → `cover.jpg` z §2.1 (zakres P3.2).

## 7. Prognoza PSI (`score.py`)

Referencja: PSI 2026-10-03 18:58 CEST (`hl=pl`) mobile FCP 3,1 s, LCP 6,6 s, TBT 600 ms, SI 4,9 s, CLS 0 → 53;
desktop FCP 0,6, LCP 1,1, TBT 740 ms, SI 1,5 → 70 (`W1-wyniki.json` `psiForecast.reference`; `score.py` odtwarza
53,10 i 69,80). Nowszego PSI w repo nie ma.

Założenia:

1. TBT PSI = k × TBT fixture B, k z POMIAR §7: mobile 0,72, desktop4x 0,42 (linie `K` harnessu, 5,24 / 3,40 i 4,73
   / 2,82, liczą k z mediany strony A tej serii – to nie jest kalibracja).
2. FCP/LCP/SI PSI-podobne z projekcji `faza1/PLAN.md` §1.5 dla W2: mobile 1,8 / 2,85 / 3,7 s, desktop 0,45 / 0,85 /
   1,3 s; CLS 0 (B ma 0 w 30/30). Fixture nie odtwarza dokumentu PSI (569 KB wobec 330–338 KB tutaj) ani obrazów
   produkcji, więc LCP PSI jest główną niewiadomą – stąd siatka niżej.
3. **F1** = k × TBT zmierzone na hoście bramki; **F1h** = k × TBT przeliczone do benchmarkIndex kalibracji (§5), za
   punkt przyjmuję F1h. F1h × 0,81 = korekta przeplotu z STAN-FALI-1 §5.3 (seria kalibracji była bez przeplotu,
   bramka z przeplotem).
4. Wariant bota jest właściwy dla PSI na MISS; na HIT PSI dostaje wariant z pamięci podręcznej.

Mobile:

| ramię   | wariant                                          | TBT fixture B (mediana) [ms] | TBT PSI = k × TBT [ms] | mobile: punkt (FCP 1,8 / LCP 2,85 / SI 3,7 s) | mobile: rozrzut po przebiegach | mobile z FCP/LCP/SI serii (przebiegi) |
| ------- | ------------------------------------------------ | ---------------------------- | ---------------------- | --------------------------------------------- | ------------------------------ | ------------------------------------- |
| browser | F1 dosłownie (host bramki)                       | 40,8                         | 29,4                   | **93,00**                                     | 93,00–93,00                    | 96,90–97,75                           |
| browser | F1h host znormalizowany (m')                     | 416,3                        | 299,7                  | **86,70**                                     | 85,80–88,20                    | 90,55–92,95                           |
| browser | F1h × 0,81 (korekta przeplotu, STAN-FALI-1 §5.3) | –                            | 242,8                  | 88,50                                         | –                              | –                                     |
| bot     | F1 dosłownie (host bramki)                       | 83,0                         | 59,8                   | **93,00**                                     | 92,70–93,00                    | 97,15–97,75                           |
| bot     | F1h host znormalizowany (m')                     | 431,5                        | 310,7                  | **86,10**                                     | 85,20–92,10                    | 89,95–96,25                           |
| bot     | F1h × 0,81 (korekta przeplotu, STAN-FALI-1 §5.3) | –                            | 251,7                  | 88,20                                         | –                              | –                                     |

Desktop (desktop4x × 0,42; dla porównania desktop5x × 0,42):

| ramię   | wariant                      | TBT desktop4x B (mediana) [ms] | TBT PSI = 0,42 × TBT [ms] | desktop: punkt (FCP 0,45 / LCP 0,85 / SI 1,3 s) | rozrzut po przebiegach | z FCP/LCP/SI serii (przebiegi) |
| ------- | ---------------------------- | ------------------------------ | ------------------------- | ----------------------------------------------- | ---------------------- | ------------------------------ |
| browser | F1 dosłownie                 | 216,0                          | 90,7                      | **97,65**                                       | 97,05–97,95            | 98,80–99,70                    |
| browser | F1 z desktop5x zamiast 4x    | 407,0                          | 170,9                     | 94,05                                           | 86,55–96,45            | –                              |
| browser | F1h host znormalizowany (m') | 511,4                          | 214,8                     | **91,05**                                       | 85,95–93,75            | 87,70–95,50                    |
| browser | F1h × 0,81                   | –                              | 174,0                     | 93,75                                           | –                      | –                              |
| bot     | F1 dosłownie                 | 268,0                          | 112,6                     | **96,75**                                       | 96,15–97,95            | 97,90–99,70                    |
| bot     | F1 z desktop5x zamiast 4x    | 358,1                          | 150,4                     | 94,95                                           | 92,55–96,75            | –                              |
| bot     | F1h host znormalizowany (m') | 492,1                          | 206,7                     | **91,65**                                       | 88,65–93,75            | 90,40–95,40                    |
| bot     | F1h × 0,81                   | –                              | 167,4                     | 94,05                                           | –                      | –                              |

Siatka mobile (TBT PSI z F1h; dla porównania wiersze F1 dosłownie):

| FCP / SI [s] | ramię (TBT PSI F1h)          | LCP 2,4 | 2,7  | 2,85 | 3,0  | 3,14 | 3,3  | 3,6  | 4,0  |
| ------------ | ---------------------------- | ------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| 1,6 / 3,4    | browser (300 ms)             | 89,8    | 88,2 | 87,5 | 86,5 | 85,5 | 84,5 | 82,2 | 79,5 |
| 1,6 / 3,4    | bot (311 ms)                 | 89,2    | 87,7 | 86,9 | 85,9 | 84,9 | 83,9 | 81,7 | 78,9 |
| 1,8 / 3,7    | browser (300 ms)             | 89,0    | 87,5 | 86,7 | 85,7 | 84,7 | 83,7 | 81,5 | 78,7 |
| 1,8 / 3,7    | bot (311 ms)                 | 88,3    | 86,8 | 86,1 | 85,1 | 84,1 | 83,1 | 80,8 | 78,1 |
| 2,0 / 4,2    | browser (300 ms)             | 87,5    | 86,0 | 85,3 | 84,3 | 83,3 | 82,3 | 80,0 | 77,3 |
| 2,0 / 4,2    | bot (311 ms)                 | 87,0    | 85,5 | 84,7 | 83,7 | 82,7 | 81,7 | 79,5 | 76,7 |
| 2,2 / 4,2    | browser (300 ms)             | 87,0    | 85,5 | 84,7 | 83,7 | 82,7 | 81,7 | 79,5 | 76,7 |
| 2,2 / 4,2    | bot (311 ms)                 | 86,3    | 84,8 | 84,1 | 83,1 | 82,1 | 81,1 | 78,8 | 76,1 |
| 1,8 / 3,7    | browser F1 dosłownie (29 ms) | 95,2    | 93,8 | 93,0 | 92,0 | 91,0 | 90,0 | 87,8 | 85,0 |
| 1,8 / 3,7    | bot F1 dosłownie (60 ms)     | 95,2    | 93,8 | 93,0 | 92,0 | 91,0 | 90,0 | 87,8 | 85,0 |

- **Punkt:** mobile **86,70 (browser) / 86,10 (bot)**, rozrzut po przebiegach 85,80–88,20 / 85,20–92,10; desktop
  **91,05 / 91,65**, rozrzut 85,95–93,75 / 88,65–93,75. Dosłownie (F1): mobile 93,00, desktop 97,65 / 96,75 – górna
  granica, bo host był szybszy niż przy kalibracji.
- Próg 87 przy F1h i FCP 1,8 / SI 3,7 s wymaga LCP PSI ≤ 2,78 s (browser) / ≤ 2,69 s (bot); 85 – LCP ≤ 3,09 / 3,01 s
  (`hostNorm.arms.*.forecast.lcpLimit*`). Przy FCP 2,0 / SI 4,2 s: 87 ⇐ LCP ≤ 2,55 / 2,40 s, 85 ⇐ LCP ≤ 2,90 /
  2,78 s. Przy F1 (dosłownie) 87 wytrzymuje LCP do 3,72 s.
- LCP PSI ok. 3,14–3,18 s (mediana LCP fixture W2 2,307–2,332 s × stosunek PSI/fixture z W0, 6,6 / 4,84 s z POMIAR
  §7) daje przy 3,14 s 84,7 / 84,1; przesunięcie o +1,7 s
  (różnica PSI − fixture z W0) dałoby ok. 4,0 s i 78,7 / 78,1. Obie skrajności to założenia, nie pomiar.
- Plan (§1 i DoD PLAN-FALE-1-2) zakładał po W2 mobile 81–87 (centralnie 84), desktop 82–85 (korekta §6: M-b mobile
  89 / 93, desktop x4 86 / 95, x5 81 / 93 dla ×0,5 / pełnych); F1h
  mieści się w paśmie mobile, desktop jest powyżej pasma, bo TBT PSI desktop z k 0,42 (≈ 207–215 ms) jest niższe niż
  zakładało mapowanie M-b planu.

## 8. Konsekwencja według planu i wskazania dla fali 3

**Konsekwencja (PLAN-FALE-1-2 §3.3 pkt 5, `faza1/PLAN.md` W2 „Bramka fali”):** bramka niezaliczona ⇒ P2.1 zostaje w
gałęzi PR (bez wdrożenia), **P3.1, P3.3 i P3.4 obowiązkowe**, wdrożenie dopiero po zielonej bramce W3 (bramka W3 =
bramka W2 + ΔLCP mobile ≤ −0,1 s z P3.2 + brak `ScriptCatchup` ≥ 50 ms sym. w oknie, gdy P3.4 uruchomione; desktop4x i
desktop5x zmierzone). Potwierdzenie PSI `hl=pl` po wdrożeniu przesuwa się za bramkę W3.

Warunki pozycji fali 3 sprawdzone na księdze drzewa W2 (§4, §5):

| Pozycja                                      | Warunek z planu                                                                                      | Na W2 (zmierzone; przy m')                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Wskazanie                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **P3.4** stopniowany burst bootu             | `ScriptCatchup` ≥ 50 ms sym. w oknie po W2                                                           | desktop4x 5/5 + 5/5 (blokowanie 96,0 / 123,0 ms), desktop5x 5/5 + 5/5 (136,0 / 143,0); mobile 3/5 + 4/5 bez blokowania; przy m' mobile 161,0 / 152,0 ms (5/5, 4/5), desktop4x 166,0 / 197,0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **spełniony – MUST**; największa pojedyncza klasa W2 na desktopie i (przy m') na mobile    |
| **P3.3** `content-visibility` sekcji ≥ 2     | zadanie stylu/layoutu dokumentu ≥ 50 ms sym. w oknie po W2                                           | K5/K6 desktop4x 5/5 + 5/5 (43,0 / 89,0 ms); desktop5x K5/K6 5/5 browser, bot K5/K6 2/5 + K4i 3/5 (= 5/5); zadania K5/K6 206–671 el., K4i 390–669 el. i 371–699 obiektów Layout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **spełniony – MUST** (desktop); na mobile przy m' K5/K6 w oknie 4/5 browser                |
| **P3.1** zadania wciągnięte do okna przez C3 | zadania ≥ 50 ms sym. w oknie na W2, których nie było w oknie na W1 i które nie mają właściciela w W2 | **Ściśle według definicji** (klasy z zadaniem w oknie A 0/5 → B > 0): K9 `Script:index` (browser mobile 0/5 → 2/5, przy m' do 110 ms), K9a ewaluacja modułów wejścia (bot mobile 0/5 → 2/5, bot d5 0/5 → 2/5; przy m' bot mobile 18,0 ms), K7b `v8.compileModule` `vendor-react` (d5 0/5 → 1/5 i 2/5, do 67 ms blokowania); K2 ParseCSS i K1 nawigacja (platforma) pojedynczo. **Nowe w oknie, ale z właścicielem w W2 – do decyzji orkiestratora (uzupełnienie zakresu P3.1 albo powrót do właściciela):** (1) **K4i** handler DCL loadera P2.1 (`Y` → `Z()`) wymusza pierwszy Style+Layout (50–153 ms sym.; w oknie: browser d4 0/5 → 5/5, d5 1/5, bot d5 3/5) – pomiar pola kandydata bez synchronicznego układu albo po pierwszej klatce; (2) **K16** restyle po przełączeniu urządzenia (693–694 el.; bot mobile 0/5 → 4/5, przy m' 55,0 / 74,0 ms; P2.4+P2.2). **W oknie już na W1, niespłacone:** K4 ParseHTML dokumentu na desktopie (d5 5/5 + 5/5, do 109 ms sym.; P2.5/P2.6), K12 commit nierozbity (5/5 we wszystkich formach; P2.2), K13 styl wymuszony z `index` (802–927 el.; bez właściciela W2), K11/K10 `Timer:index` (P5.2) | **MUST** (P3.1 obowiązkowe z konsekwencji bramki); lista do zatwierdzenia przed startem W3 |
| **P3.2** bajty zbioru LCP (MUST-margines)    | ΔLCP mobile ≤ −0,1 s                                                                                 | łańcuch LCP: CSS 68,8 KB → font 30 KB (152 ms; 302–305 ms w trybie górnym) → `cover.jpg` 110,3 KB (≈ 605 ms); tryb górny LCP 2,436–2,452 s w 2/10 przebiegów B = oba przekroczenia (a)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | preload jednego fontu i hero 640w zdejmują tryb górny i dają zapas do pasma DoD LCP        |

Kolejność według danych: P3.4 (K7, a przy okazji K7b/K9a – ta sama seria bootu) → P3.3 (K5/K6 + K4i) → P3.1
(ściśle K9/K9a/K7b; z decyzją orkiestratora K4i, K16, desktop ParseHTML, K12) → P3.2. K4i dotyka pliku P2.1
(`src/lib/boot/bootLoaderScript.ts`), który zmienia też P3.4 (stopniowany burst), więc właściciela trzeba przypisać
przed startem W3.

## 9. Zastrzeżenia

1. **Szybkość hosta** (§1, §5): benchmarkIndex ×1,4–1,7 wyższy niż przy kalibracji k. Liczby bezwzględne TBT tej serii
   nie są porównywalne z bramką W1 ani z POMIAR §7 bez normalizacji; werdykt (c) zależy od tego.
2. **Normalizacja m'** zakłada, że czas zadań CPU skaluje się odwrotnie do benchmarkIndex; nie modeluje zmiany
   kolejności zdarzeń w śladzie ani sieci. Kontrola na drzewie W1 trafia w rząd wielkości, nie co do ms.
3. **Klasy K** to heurystyka po dzieciach zadań ze śladu (bez śladu inwalidacji i bez profilu Reacta): K13 i K16
   rozróżniam po źródle (skrypt `index`) i liczbie elementów, K5 i K6 łączę. Sumy księgi od klasyfikacji nie zależą.
4. **Przeplot i refetch**: seria z przeplotem (A/A z POMIAR §7: 1007–1032 ms wobec 832 ms serii pojedynczej, ×1,21–1,24); reżim refetchu postów
   nierówny (B 5/15 wobec A 3/15 i 1/15).
5. **Fixture ≠ PSI**: dokument PSI 569 KB wobec 330–338 KB, fixture bez menu nagłówka (STAN-FALI-2 §4a pkt 5), obrazy
   fixture; LCP PSI po W2 nieznane – prognoza mobile zależy od niego najmocniej (siatka §7).
6. **Para mieszana co do trybu FCP** w 15/15 parach na ramię: delty FCP/LCP/SI porównują dwa reżimy, nie ten sam tryb.
7. Pełny vitest orkiestratora (`$G/vitest-full.exit` = 1, 07:34 UTC) nie jest przedmiotem tej analizy.

## 10. Pliki

- `$G/ANALIZA.md` (ten raport), `$G/W2-wyniki.json` (liczby maszynowo).
- Analiza: `$A/scan.py`, `$A/scan.json`, `$A/analyze.py`, `$A/results.json`, `$A/gen_tables.py`, `$A/tables-gen.md`,
  `$A/build_report.py`, `$A/build_json.py`, `$A/ledger-json/`, `$A/diff-series/`, `$A/lcp-graph.mjs`, `$A/lcp-graph-B-mobile.txt`,
  `$A/cpu-whatif.mjs`, `$A/cpu-whatif-{browser,bot,w1host-browser}.json`, `$A/cpu-ledger.mjs`,
  `$A/cpu-ledger-{browser,bot}.json`, `$A/score.py`, `$A/run-ledgers.sh`, `$A/run-diff.sh`.
- Pomiar (bez zmian): `$G/MEASURE.md`, `$G/tables.md`, `$G/runs.json`, `$G/lh-browser/`, `$G/lh-bot/`,
  `$G/lh-*.log`, `$G/document-weight-{A,B}.{json,log}`.
