# Pomiar pod PSI 85 / 95: harness, budżety, bramki (2026-10-03)

Strumień `measurement` fazy 1. Cel: każda kolejna zmiana ma być **udowodniona liczbą**,
zmierzoną tak, jak liczy PageSpeed Insights (Lighthouse 13, symulacja Lantern), a nie
tak, jak wygodnie mierzyć lokalnie. Pliki są nowe; żaden istniejący plik nie został zmieniony.

**Aktualizacja P0.1 (2026-10-04, fala 0 planu `faza1/PLAN.md`)**: formy `desktop4x`/`desktop5x`, żywy
backend klienta (`--client-backend fixture`), atrapa tagu Google (`--third-party fake-gtag`), ponowne
rozgrzanie dokumentu przed KAŻDYM przebiegiem z odrzucaniem przebiegów STALE/MISS/SSR (`n_valid`),
zapis artefaktów i księga Lantern per zadanie (`lanternTasks.ts`), prawdziwe A/A z σΔ i MDE oraz
kalibracja k fixture -> PSI - opis, wyniki i liczby w §7. Dawne `narzedzia/measure-*.sh` są stubami
`exit 1`.

## 1. Narzędzia

| Plik                                                                         | Co robi                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/performance/lighthouse-local.mjs`                                   | Lighthouse mobile + desktop N razy na artefakcie `build:smoke` z ustawieniami PSI; tryb pojedynczy (mediany + DELTA wobec baseline'u) i tryb A/B z przeplotem (`--compare A B`, linia `DELTA B-A`). Opcjonalnie buduje (`--build`). Zrzuca audyty diagnostyczne (`*.audits.txt`). Eksperymenty „co-jeśli" bez builda: `--html-transform[-b] plik.mjs` przekształca dokument w proxy. |
| `scripts/performance/artifactServer.ts`                                      | Serwer artefaktu jak `playwright.performance.config.ts` (fixture przez `replayFetch.mjs`, albo `.env` przy `NES_PERFORMANCE_FIXTURE=0`), front kompresujący brotli/gzip z flush strumienia, HTTPS + HTTP/2 na jednym originie `https://fixture.invalid` razem z obrazami fixture, rozgrzewka cache z UA przeglądarki.                                                                |
| `scripts/performance/lighthouseReport.ts`                                    | Czysta interpretacja LHR: metryki, mediany, DELTA, kontrola porównywalności (transport, ścieżka, element LCP, `benchmarkIndex`), zrzut audytów (żądania z priorytetami, długie zadania, bootup, nieużyty JS, rozbicie LCP, render-blocking), metryka `highPriorityBytesBeforeLcpImage`.                                                                                              |
| `scripts/performance/check-document-weight.ts` + `documentWeight.ts`         | Bramka wagi dokumentu `/` (HTML, inline style/script, stan dehydratacji, preloady i ich duplikaty, obrazy `fetchpriority=high`, domknięcie bootu raw/gzip, pula JS High przy starcie, CSS blokujący). Progi: `document-weight-budgets.json` (ratchet, tylko w dół). `--html plik [--headers plik]` analizuje zapisany dokument (np. produkcyjny).                                    |
| `scripts/performance/psi-sample.mjs`                                         | PSI API v5 (`PSI_API_KEY`) N razy na formę, te same mediany/DELTA co harness lokalny, dane polowe CrUX. `--from-file` analizuje zapisany LHR/odpowiedź offline.                                                                                                                                                                                                                      |
| `scripts/performance/whatif/*.mjs`                                           | Transformacje „co-jeśli" dla `--html-transform-b` z zapisanym wynikiem w nagłówku: `js-no-preload-low.mjs` (bez `modulepreload`, wejście `fetchpriority=low`) i `js-low-priority.mjs` (bez efektu w Chrome 141 - kontrola A/A).                                                                                                                                                      |
| `scripts/performance/document-weight.test.mjs`                               | Testy warstw czystych z kontrolą negatywną (`node --test scripts/performance/document-weight.test.mjs`, 7 testów).                                                                                                                                                                                                                                                                   |
| `scripts/performance/clientBackend.ts`                                       | (P0.1) Żywy PostgREST klienta na 127.0.0.1:4199 dla `--client-backend fixture`: te same wiersze co SSR (`homeFixture.fixtureResponse`), CORS jak brama Supabase (preflight 200, echo nagłówków, `Content-Range`), HTTP i HTTPS na jednym porcie, licznik żądań per przebieg.                                                                                                         |
| `scripts/performance/fakeGoogle.ts`                                          | (P0.1) Atrapa `gtag/js` (G + dociągany AW) i pingów dla `--third-party fake-gtag`: transfer jak produkcja, zadania produkcji (M3) x 3702,5 / benchmarkIndex hosta zmierzony w Chrome Lighthouse'a; front wstrzykuje `window.__NES_GA_ANY_HOST__=true` do `<head>` strumieniowo.                                                                                                      |
| `scripts/performance/lanternTasks.ts`                                        | (P0.1) Księga TBT per zadanie z artefaktów (`--save-artifacts` / `lighthouse -G`): blokowanie każdego symulowanego węzła CPU jak Lantern (suma = audyt ±1 ms), klasa zadania, Layout, URL, tryb FCP, `scriptBytesEndedBeforeObsLcp` (`--exclude-script`, domyślnie `/~flock.js`), `--diff A B`, `--diff-series <katalog>`.                                                           |
| `scripts/performance/harness-ext.test.mjs`                                   | (P0.1) Testy rozszerzeń (`node --test scripts/performance/harness-ext.test.mjs`): STALE/MISS/SSR -> `excluded`, rozgrzanie, powtórki, pary/MDE, k, formy, wstrzyknięcie do `<head>`, backend, atrapa, księga; (P0.1-FIX) wariant dokumentu i restart, tryb FCP, obciążenie, wynik serii, MDE(t), §1.1.                                                                               |
| `docs/performance/2026-10-03-pagespeed-85-95/lighthouse-local-baseline.json` | Zapisany baseline harnessu (fixture, h2, rozgrzewka przeglądarką) - plik porównania dla `lighthouse-local.mjs`, gdy `reports/lighthouse-local-baseline.json` (gitignorowany) nie istnieje.                                                                                                                                                                                           |

Uruchomienie (sandbox chmurowy; w CI `LIGHTHOUSE_CLI` można pominąć - wtedy `npx --yes lighthouse@13`):

```sh
export LIGHTHOUSE_CLI=$SCRATCH/tools/node_modules/lighthouse/cli/index.js
export CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
# baseline jednego artefaktu (mediany + DELTA wobec zapisanego baseline'u)
node scripts/performance/lighthouse-local.mjs --runs 3
# ocena zmiany: dwa worktree, przeplot A,B / B,A
node scripts/performance/lighthouse-local.mjs --compare ../wt-main ../wt-zmiana --runs 5 --forms mobile
# co-jeśli bez builda: B = ten sam artefakt z przekształconym dokumentem
node scripts/performance/lighthouse-local.mjs --compare . . --html-transform-b moja-transformacja.mjs
# bramka wagi dokumentu (artefakt musi istnieć)
node scripts/performance/check-document-weight.ts
node scripts/performance/check-document-weight.ts --html home-produkcja.html --headers naglowki.txt
```

Wyniki lądują w `reports/lighthouse-local/<label>/` (gitignorowane): pełne LHR, `*.audits.txt`,
`summary.json` (mediany, przebiegi, `loadavg` przy każdym przebiegu), HTML i nagłówki dokumentu.

### 1.1 Ważność przebiegu, wariant dokumentu i wynik serii (P0.1-FIX, 2026-10-04)

Poprawki po recenzji scalonego P0.1 (`faza2/raporty/P0.1-REVIEW-scalony.md`, raport
`faza2/raporty/P0.1-FIX.md`). Liczby A/A, k i baseline z flagami (§7) zapisuje osobny etap pomiarowy.

- **Wariant dokumentu.** Wzorcem serii jest wpis z rozgrzewki początkowej (pierwszy MISS na zimnym
  procesie = pełny render, `s-maxage=900`); odcisk = `cache-control` wpisu + długość body bez
  kompresji (tolerancja 64 B). Rewalidacja w tle daje na artefakcie wpis ze zdegradowanym chrome'em
  (`max-age=0, s-maxage=30, stale-while-revalidate=300`, o 191 B dłuższy), więc rozgrzewka przed
  przebiegiem, gdy wpis ma inny wariant, mniej niż `--min-fresh` s świeżości (liczonej od s-maxage
  TEGO wpisu, najwyżej 180 s) albo jest STALE, restartuje serwer artefaktu na tym samym porcie
  (pusty magazyn, log dopisywany) i rozgrzewa go od nowa. Przebieg z innym wariantem niż wzorzec
  jest `excluded` („wariant dokumentu (…; wzorzec …)"); linia `cache:` pokazuje wariant i liczbę
  restartów. Po restarcie rozgrzewka pobiera raz także zasoby dokumentu (skrypty, style, fonty
  originu: `zasoby N` w linii `cache:`), a linia VALID podaje liczbę ważnych przebiegów po
  restarcie (`po restarcie serwera: 1/5`) - etap pomiarowy sprawdza, czy nie skupiają się po jednej
  stronie A/A.
- **Wzorzec przy krótkiej świeżości.** Gdy pierwszy zimny render ma s-maxage < 180 s, jeden restart
  rozstrzyga: pełny wariant po restarcie = przegrany wyścig chrome'u, ten sam wariant = polityka
  trasy (`/live`: s-maxage=30) i to on jest wzorcem (linia `wzorzec: …`). Wzorzec o świeżości
  ≤ `--min-fresh` przerywa serię od razu z podpowiedzią (dla s-maxage=30: `--min-fresh 10`), bo
  żaden HIT nie miałby wymaganego zapasu.
- **`--max-load`** domyślnie 0,6 × CPU (2,4 na 4 CPU). loadavg jest mierzony po czekaniu i drugi
  raz po rozgrzewce (restart serwera też obciąża); przebieg, w którym większy z pomiarów przekracza
  próg, jest `excluded` („obciążenie (x > y)"); czekanie `--idle-wait` zostaje.
- **`--min-valid N`** domyślnie `--runs`, nie mniej niż min(3, runs); wartość nieliczbowa jest błędem
  wywołania. Forma (albo strona A/B) z `n_valid` poniżej progu drukuje `FAIL …`, kończy serię kodem
  1 i nie trafia do baseline'u (`--save-baseline` bez żadnej formy nie nadpisuje pliku). Wyjątek
  w trakcie przebiegów (np. serwer nie wstał po restarcie) kończy serię, ale summary.json i linie
  VALID/PAIRS/AA liczą się z przebiegów ukończonych; wynik: `FAIL seria przerwana: …`, kod 1, bez
  baseline'u.
- **Ścieżka bez cache.** Rozgrzewka początkowa z odpowiedzią spoza cache (3xx-5xx, bez
  `x-nes-cache`, BYPASS) przerywa serię komunikatem `PRZERWANE: …`. W środku serii dwie takie
  odpowiedzi kończą rozgrzewkę `ok=false`: przebieg jest `excluded` i powtarzany, seria idzie dalej.
  `--allow-uncached` mierzy taką ścieżkę świadomie: dokument nie musi być HIT, ważny przebieg =
  żadnego renderu SSR poza samą nawigacją Lighthouse'a. BYPASS w logu serwera jest renderem SSR.
- **`--client-backend none`** przerywa serię, gdy ktoś słucha na 127.0.0.1:4199.
- **Linie A/B.** `PAIRS … (n=5, t(df=4)=3.72): … MDE(t)=… MDE(z)=…` - MDE(t) = (t₀,₉₇₅ + t₀,₈)(df =
  n−1)·σΔ/√n jest progiem obowiązującym, MDE(z) = 2,8·σΔ/√n tylko do porównania. Z księgą
  (`--save-artifacts`): `PAIRS … tryb FCP: pełny 3, częściowy 1; pary mieszane 1/5`, linie PAIRS
  per tryb (≥ 2 pary) i AA per tryb (`AA mobile [trybFCP=pełny, nA=3, nB=4]`). Tryb FCP przebiegu =
  udział bajtów skryptów grafu FCP Lantern w bajtach skryptów startowych zakończonych przed
  obserwowanym LCP, oba wyłącznie z originu dokumentu (tag Google z `--third-party fake-gtag` nie
  przesuwa progu; `/~flock.js` jest w mianowniku): `pełny` ≥ 0,9, `częściowy` < 0,5, `pośredni`
  pomiędzy, `bez-js` bez skryptów.
  Obserwowane FCP/LCP księgi liczą się z głównej ramki nawigacji, od jej startu, z
  `largestContentfulPaint::Invalidate`.
- **Linia K** kalibruje wyłącznie z pełnymi flagami (`client-backend=fixture,third-party=fake-gtag`);
  bez nich ma dopisek `(bez flag, nie kalibruje)` albo `(niepełne flagi, nie kalibruje)`.
- **`summary.json` (schema 3):** `records[].variant` (`cacheControl`, `bytes`), `records[].fcpMode`,
  `records[].rewarm.{restores,assets,failure,uncached}`, `records[].{load,loadBefore,loadAfter}`
  (`load` = większy z dwóch, ten bramkuje), `records[].file|artifacts` względem katalogu
  wyników, `targets[].referenceVariant`, `targets[].root` (względny w repo, `poza-repo:<nazwa>` poza
  nim), `forms[*].validity.{variants,fcpModes,restored}`, `aborted`, `outcome`
  (`exitCode`, `failures`, `baselineForms`, `refusedBaselineForms`, `aborted`),
  `pairs[forma].{all,byMode,mixed,unknown,total}`, `calibration[forma].calibrates`, `minValid`,
  `maxLoad`, `allowUncached`, `lighthouse` (nazwa i wersja, nie ścieżka) i `lighthouseVersion` z LHR.
  **Baseline (schema 3):**
  `root` względem repo (`poza-repo:<nazwa>` poza nim), `referenceVariant`, `forms[*].{variants,fcpModes}`, `minValid`, `maxLoad`,
  `lighthouse`, `lighthouseVersion`.

## 2. Parytet z PSI - co harness robi inaczej niż dawne `measure-local.sh` i dlaczego

Wszystkie cztery punkty są ZMIERZONE na tym samym artefakcie (`fd94e61` = `origin/main` 6a4215db).

1. **HTTP/2 + TLS na jednym originie.** Produkcja: 99 ze 121 żądań `h2` z originu dokumentu,
   obraz LCP z `/media` tego samego originu. Dawny harness: `http/1.1` po HTTP, obrazy fixture na
   osobnym originie. Lantern modeluje to inaczej (`ConnectionPool.js`: h1 = 6 połączeń na origin,
   każde z własnym slow-startem; h2 = jedno połączenie z pełnym pasmem; TLS = dodatkowy RTT).
   A/B h1 → h2 (3 + 3 przebiegi, przeplot): mobile LCP **−0,30 s**, desktop FCP **−0,28 s**,
   LCP **−0,30 s**, desktop perf 95 → 98. Domyślny transport: `h2`; `--transport h1` tylko do
   porównań historycznych.
2. **Wariant dokumentu w cache.** Klucz cache dokumentu to `host::ścieżka`
   (`src/lib/http/documentCache.ts`, `planDocumentCache`) - bez rozróżnienia bot/przeglądarka.
   Pętla gotowości dawnego `measure-local.sh` (`curl -sf` bez `-A`, czyli UA bota dla `isbot`)
   była PIERWSZYM renderem `/` i zapisywała wariant buforowany (`allReady`): **382 468 B, 14
   skryptów**, który potem Lighthouse dostawał jako HIT. Przeglądarka po MISS przeglądarki dostaje
   wariant strumieniowy: **391 114 B, 22 skrypty**. Harness sprawdza gotowość na `/robots.txt` i
   rozgrzewa UA przeglądarki; `--warm-ua bot` mierzy świadomie wariant bota. Ta sama właściwość
   działa na produkcji: pierwszy MISS w danym colo (Googlebot, monitoring `curl`) wybiera wariant
   podawany potem wszystkim przez okno świeżości - do decyzji w strumieniu `server-cache`.
3. **Kompresja strumienia z flush.** Proxy brotli q5 / gzip 6 flushuje każdy kawałek HTML-a
   (Cloudflare też), żeby kompresor nie przetrzymywał powłoki SSR.
4. **Obciążenie maszyny.** TBT jest pracą CPU zmierzoną NA HOŚCIE i pomnożoną x4: na tym samym
   artefakcie mediana TBT mobile wynosiła 328 ms przy loadavg ~4 i **5 146 ms** przy loadavg ~8
   (4 CPU). FCP/LCP są odporniejsze (4,07-4,26 s), ale nie odporne (pkt 3 w §3). Harness czeka
   przed każdym przebiegiem, aż loadavg(1 min) < `--max-load` (od P0.1-FIX domyślnie 0,6 × CPU,
   do `--idle-wait` s; przebieg zaczęty powyżej progu jest `excluded`), zapisuje loadavg przy
   każdym przebiegu i ostrzega w DELTA, gdy `benchmarkIndex` różni się o > 25 %. Po błędzie wykonania (`NO_NAVSTART` pod obciążeniem)
   przebieg jest powtarzany raz.

## 3. Baseline (fixture, `fd94e61`, h2, rozgrzewka przeglądarką)

Patrz `lighthouse-local-baseline.json` i raport fazy 1 (`faza1/measurement.md`). Na tym hoście
(benchmarkIndex 1 670-2 050, loadavg 5-6 przez innych agentów) mediany 3 przebiegów:

| forma   | perf | FCP    | LCP    | TBT    | SI     | uwagi                                                                  |
| ------- | ---- | ------ | ------ | ------ | ------ | ---------------------------------------------------------------------- |
| mobile  | 68   | 4,06 s | 4,81 s | 249 ms | 4,06 s | LCP `img.eh-img` (hero), h2 100 %, 618 KB High przed końcem obrazu LCP |
| desktop | 97   | 0,81 s | 0,90 s | 71 ms  | 1,21 s | fixture lżejszy od produkcji (391 vs 569 KB HTML)                      |

Szum (przebieg A/A: ten sam artefakt po obu stronach, 3 + 3 z przeplotem): FCP/LCP mobile
±0,01 s, TBT mobile **+464 ms** (mediany 249 vs 713 ms), perf **−13** - całość z TBT. Zmianę
oceniamy więc osobno: FCP/LCP/SI/bajty z 3 przebiegów, TBT/perf z ≥ 5 przebiegów i tylko z A/B.

**FCP mobile jest dwumodalne** (2,88-2,99 s albo 4,07-4,26 s; na h1 także 5,0 s) przy tym samym
artefakcie. Mechanizm (`FirstContentfulPaint.js` w Lantern): skrypt z priorytetem High, który
skończył się pobierać przed obserwowanym FCP i którego ewaluacja zaczęła się przed obserwowanym FCP,
wchodzi do grafu FCP razem ze swoim pobraniem; na 1,6 Mb/s to ~1,1 s. Czy boot JS (~550 KB gzip z
`modulepreload`, wszystko High) zdąży się wykonać przed pierwszym malowaniem na NIEDŁAWIONYM hoście,
jest wyścigiem o kilkadziesiąt ms (CSS kończy się ~340 ms, chunki ~300-365 ms). Ten sam wyścig
zachodzi u PSI. Wniosek dla oceniania zmian: ≥ 5 przebiegów mobile i mediana, a zmiana, która
usuwa JS z puli High przed FCP, usuwa też TĘ zmienność.

### 3.1 Co-jeśli bez builda: JS startowy poza pulą High (zmierzone)

`node scripts/performance/lighthouse-local.mjs --compare . . --html-transform-b scripts/performance/whatif/js-no-preload-low.mjs --runs 3`
(B = ten sam artefakt, z dokumentu i nagłówka `Link` usunięte wszystkie `modulepreload`, wejście
`<script type=module fetchpriority=low>`):

| forma   | FCP A → B       | LCP A → B       | SI A → B        | TBT A → B        | perf A → B | bajty High przed końcem obrazu LCP |
| ------- | --------------- | --------------- | --------------- | ---------------- | ---------- | ---------------------------------- |
| mobile  | 4,07 → **1,52** | 4,82 → **3,32** | 4,07 → **2,16** | 273 → 649 (szum) | 67 → 75    | 618 → 112 KB                       |
| desktop | 0,77 → **0,37** | 0,95 → **0,69** | 0,96 → 0,80     | 15 → 65          | 98 → 99    | 618 → 112 KB                       |

Samo `fetchpriority="low"` na `<link rel=modulepreload>` NIE działa: Chrome 141 zostawia te
żądania na `High` (A/B z `whatif/js-low-priority.mjs`: delta FCP/LCP 0,00 s). LCP 3,3 s po
zmianie trzyma już nie pasmo, tylko bramkowanie obrazu hero przez JS (`style="opacity: 0"` do
hydratacji, EVIDENCE §6) - obraz kończy się ~110 ms (obserwowane), a malowanie czeka na boot.
To wynik transformacji w proxy, nie zmiany w kodzie: hipoteza dla strumieni boot-js/lcp-path,
do potwierdzenia A/B dwóch artefaktów.

## 4. Bramka wagi dokumentu

`node scripts/performance/check-document-weight.ts` (5 próbek HIT, mediana; dokument HIT jest
bajtowo deterministyczny w obrębie uruchomienia, między uruchomieniami różni się o długość portu
w URL-ach, +191 B). Pomiar 2026-10-03, progi = ratchet (bajty +2 %, liczniki dokładnie), cele z planu:

| metryka                                          | fixture (`/`)              | próg                | cel             | produkcja (`--html`, 2026-10-03) |
| ------------------------------------------------ | -------------------------- | ------------------- | --------------- | -------------------------------- |
| HTML raw / gzip                                  | 391 114 / 54 696 B         | 398 937 / 55 565    | 200 KB / 30 KB  | 569 347 / 78 455 B               |
| `<head>`                                         | 24 118 B                   | 24 601              | 12 KB           | 37 592 B                         |
| inline `<style>` bloki / B                       | 50 / 132 888               | 50 / 135 546        | 5 / 20 KB       | 51 / 133 223                     |
| inline `<script>` B                              | 94 232                     | 96 117              | 40 KB           | 135 425                          |
| `$tsr-stream-barrier` B                          | 65 182                     | 66 486              | 30 KB           | 107 041                          |
| `modulepreload` (unikalne)                       | 25                         | 25                  | 12              | 27                               |
| wpisy nagłówka `Link`                            | 31                         | 31                  | 16              | 33                               |
| duplikaty preloadów (w tym w dokumencie)         | 22 (1)                     | 22 (1)              | 0 (0)           | 27 (4; obraz LCP 6x)             |
| preloady obrazów / `<img fetchpriority=high>`    | 4 / 9                      | 4 / 9               | 2 / 1           | 7 / 7                            |
| domknięcie bootu raw / gzip                      | 1 605 645 / 485 279 B      | 1 637 758 / 494 985 | 1,1 MB / 350 KB | (pliki niedostępne lokalnie)     |
| pula JS High przy starcie (boot ∪ modulepreload) | 25 plików / 561 750 B gzip | 25 / 572 985        | 12 / 150 KB     | -                                |
| CSS blokujący gzip                               | 79 802 B                   | 81 399              | 30 KB           | 79 802 B                         |

Uzasadnienie liczb i reguła ratchetu: `_comment` w `scripts/performance/document-weight-budgets.json`.

## 5. CI - projekt (bez zmian w workflow w tym kroku)

### 5.1 Bramka wagi dokumentu i A/B Lighthouse w `first-visit.yml`

`first-visit.yml` już buduje DWA artefakty z fixture (`VITE_SUPABASE_URL=http://127.0.0.1:4199`,
baseline = baza PR, candidate = PR) na jednym runnerze - to naturalne miejsce:

```yaml
- name: Document weight gate (candidate)
  if: ${{ !cancelled() }}
  working-directory: harness
  run: node scripts/performance/check-document-weight.ts --root ../candidate --json reports/document-weight.json
- name: Document weight of the baseline (report only)
  if: ${{ !cancelled() }}
  working-directory: harness
  run: node scripts/performance/check-document-weight.ts --root ../baseline --json reports/document-weight-baseline.json || true
- name: Lighthouse A/B mobile (report; bytes gate)
  if: ${{ !cancelled() }}
  working-directory: harness
  run: node scripts/performance/lighthouse-local.mjs --compare ../baseline ../candidate --runs 3 --forms mobile --label ci --out reports/lighthouse-local/ci
  env:
    CHROME_PATH: ... # ścieżka Chromium Playwrighta jak w lighthouse.yml („Resolve pinned Chromium path")
```

Plus `node --test scripts/performance/document-weight.test.mjs` obok
`first-visit-harness.test.mjs`, upload `harness/reports/lighthouse-local/ci` i
`harness/reports/document-weight*.json`, `timeout-minutes` 20 → 35 (6 przebiegów mobile ≈ 6-9 min
na runnerze). Blokować wolno tylko metryki bajtowe (deterministyczne): waga dokumentu (progi) i
z A/B `scriptTransferBytes`/`highPriorityBytesBeforeLcpImage` (B ≤ A + 1 %). Czasy z A/B są
raportem - na 2/4-rdzeniowym runnerze TBT ma rozrzut rzędu ±50 %. Skrypt `check:document-weight`
w package.json dołożony w implementacji MUSI być wpięty w workflow, bo pilnuje tego
`check:gate-coverage`.

### 5.2 Tryb A (`vars.LHCI_URL`) - mobile na wdrożonym URL-u

1. Człowiek ustawia zmienną repo `LHCI_URL=https://neweuropeanstrategies.com` (Settings → Secrets
   and variables → Actions → Variables); opcjonalnie `LHCI_EXTRA_PATHS` z prawdziwymi slugami.
2. Przed pierwszym przebiegiem (zmiana workflow, osobny PR): krok rozgrzewki URL-i z UA
   przeglądarki (nie gołym `curl` - pkt 2 w §2), żeby runner nie zapisał w colo wariantu bota i
   nie mierzył MISS-a (świeżość 3 min per colo); `x-nes-cache` i `server-timing` z rozgrzewki do logu.
3. Pierwszy przebieg JEST pomiarem podłogi. Oczekiwanie z danych: mobile perf 45-60 (PSI 53, lokalnie
   vs produkcja 63), desktop 70-92. `lighthouserc.deployed.mobile.json` ma
   `categories:performance >= 0,8` na `error` - pierwszy przebieg będzie czerwony. Rekomendacja
   (zgodna z regułą w `_comment` tego pliku, decyzja człowieka): na czas fal naprawczych
   `categories:performance` mobile = `error` z `minScore` = (zmierzona mediana − 0,05), zapis wartości,
   daty i numeru przebiegu w `_comment`; podnosić po każdej fali (ratchet w górę dla wyniku = w dół
   dla czasów). Metryki mobile zostają `warn` z liczbami mobilnymi zamiast desktopowych: LCP 2500,
   TBT 200, FCP 1800, SI 3400 (granice „good" krzywych mobilnych Lighthouse'a), bo dzisiejsze
   wartości desktopowe (1500/200/1100/1600) są dla mobile etykietami, nie progami.
4. Runner GitHuba ≠ host PSI (inny `benchmarkIndex`, inne colo). Tryb A łapie regresje wdrożenia;
   liczbę „PSI" mierzy pkt 5.3.

### 5.3 PSI API z kluczem

`PSI_API_KEY` jako sekret, nocny workflow (cron) albo `workflow_dispatch`:
`node scripts/performance/psi-sample.mjs --runs 5 --strategy mobile,desktop --baseline docs/.../psi-baseline.json`.
Każdy przebieg dostaje `utm_source=nes-psi-<znacznik>` (PSI nie zwraca własnego cache, a cache
dokumentu zdejmuje `utm_*` z klucza). Limit z kluczem: 25 000 zapytań/dzień, 400/100 s - 10 zapytań
na noc to nic. Wynik: mediany PSI + dane polowe CrUX (p75 LCP/INP/CLS/FCP/TTFB) w logu i artefakcie.
To jest JEDYNY instrument, który mierzy dokładnie liczbę ze zlecenia (53/70).

## 6. Obserwowalność produkcji (projekt)

1. **Próbkowanie z wielu regionów** (bez infrastruktury): Globalping (jsDelivr, darmowe API HTTP
   z sond na świecie):
   ```sh
   curl -s https://api.globalping.io/v1/measurements -H 'content-type: application/json' -d '{
     "type":"http","target":"neweuropeanstrategies.com","limit":12,
     "locations":[{"magic":"Warsaw"},{"magic":"Frankfurt"},{"magic":"London"},{"magic":"Virginia"},{"magic":"Iowa"},{"magic":"Singapore"}],
     "measurementOptions":{"protocol":"HTTPS","request":{"method":"GET","path":"/",
       "headers":{"User-Agent":"Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36","Accept-Language":"pl-PL,pl;q=0.9"}}}}'
   # potem GET https://api.globalping.io/v1/measurements/<id> -> nagłówki x-nes-cache, x-nes-cache-age, server-timing, cf-ray (colo)
   ```
   Trzy serie co 60 s (HIT ratio i wiek wpisu per colo), osobno z UA bota (`curl/8`), żeby zobaczyć,
   który wariant siedzi w cache. Lokalizacje `Iowa`/`Virginia`/`Oregon` ≈ centra danych, z których
   biega PSI.
2. **Lighthouse z regionu**: `psi-sample.mjs` (hosty Google) + tryb A z rozgrzewką.
3. **RUM (najlepsze, trwałe)**: `src/lib/webVitals.ts` już wysyła TTFB/FCP/LCP. Dołożyć do ładunku
   stan cache dokumentu z `PerformanceNavigationTiming.serverTiming` (wpis `nes-edge`, `desc`
   HIT/MISS/STALE) i colo (nowy wpis `server-timing` `colo;desc="WAW"` z `request.cf.colo`
   w `src/server.ts`). Daje p75 TTFB/LCP rozbite na HIT/MISS per colo dla PRAWDZIWYCH czytelników -
   to rozstrzyga, czy krótkie okno świeżości (3 min per colo) jest problemem dla ludzi, czy tylko dla PSI.

## 7. Baza fali 1 (2026-10-04, `cc1a3767`)

Drzewo bazy: `origin/main` z falą 0, PR #469 i późniejszymi commitami z `main` (gałąź `claude/zen-johnson-wpzoxv`),
`BUNDLE_INVENTORY=1 bun run build:smoke` (2 min 40 s), zależności z lockfile (`xlsx` 0.20.3 bez podmiany, więc liczby
`check:bundle` są porównywalne z CI). Komenda:

```sh
node scripts/performance/lighthouse-local.mjs --root . --runs 5 --forms mobile,desktop4x \
  --client-backend fixture --third-party fake-gtag --save-artifacts \
  --save-baseline --baseline-out docs/performance/2026-10-03-pagespeed-85-95/lighthouse-local-baseline-w1.json --label base-w1
```

Fałszywy gtag w skali x2,29 (benchmarkIndex Chrome 1616,5), load 1,3-2,2 w trakcie serii, wszystkie przebiegi ważne,
księga Lantern zgodna z audytem w 10/10 przebiegach.

| forma     | n ważnych | perf | FCP    | LCP    | TBT (mediana, zakres)   | SI     | CLS   | TTI     | żądania | JS        | High przed obrazem LCP |
| --------- | --------- | ---- | ------ | ------ | ----------------------- | ------ | ----- | ------- | ------- | --------- | ---------------------- |
| mobile    | 5/5       | 54   | 4,00 s | 4,84 s | **832 ms** (763-1301)   | 4,00 s | 0,000 | 10,55 s | 113     | 1083,7 KB | 619,5 KB               |
| desktop4x | 5/5       | 65   | 1,02 s | 1,09 s | **1769 ms** (1195-1949) | 1,51 s | 0,003 | 4,80 s  | 117     | 1083,7 KB | 619,5 KB               |

- Księga per przebieg (TBT = suma blokowania): mobile 763,0 / 901,5 / 832,0 / 1300,7 / 808,0 ms; desktop4x 1887,9 /
  1769,0 / 1949,3 / 1194,5 / 1472,6 ms. Zadania Google (atrapa gtag) w każdym przebiegu: 3 zadania, 243-345 ms obs.
- Tryb FCP: mobile pełny x4, częściowy x1 (przebieg 4: FCP 1,70 s, TBT 1301 ms) - bimodalność FCP znana z P0.5.
- `K` (TBT fixture → PSI 2026-10-03): mobile k = 0,72, desktop4x k = 0,42. Oba |k − 1| > 0,2, więc cele fixture z
  planu (mobile 356 → 218-258 ms, desktop4x 444 → 393-411 ms) przeliczamy względnie od tej bazy, nie bezwzględnie:
  plan liczył bazę z flagami ok. 356 ms, ten host z pełnymi flagami daje 832 ms (inny benchmarkIndex i koszt atrapy
  gtag). Decyduje różnica B−A w A/B z przeplotem i księga per zadanie.
- Bramki artefaktu bazy: `check:chunks`, `check:entry-purity`, `check:server-entry-purity` zielone.
  `check:bundle` CZERWONY już na bazie: overall 4783,7 KB > 4772 KB (public 2730,3 KB, największy chunk 254,3 KB,
  CSS 95,8 KB, boot 476,9 KB gzip / 1569,0 KB raw). `check:document-weight` CZERWONY już na bazie w czterech
  metrykach preloadów modułów (26 > 25 modulepreload, 32 > 31 wpisów Link, 23 > 22 duplikatów, 26 > 25 JS
  z preloadem): manifest trasy `/` wymienia chunk `spreadsheetWorker-*.js` (wspólny chunk z komponentem błędu
  trasy). Zasada fali 1: żadna z tych liczb nie rośnie.

A/A (`--compare . . --runs 4 --forms mobile,desktop4x --client-backend fixture --third-party fake-gtag`, przeplot,
load 2,1-2,2 na starcie, wszystkie 16 przebiegów ważnych):

| forma     | mediana A / B TBT | ΔTBT B−A | σΔ TBT | MDE(t) TBT, n = 4 | MDE(t) TBT, n = 5 (przeliczone) | AA \|ΔFCP\| / \|ΔLCP\| | σΔ FCP / LCP    |
| --------- | ----------------- | -------- | ------ | ----------------- | ------------------------------- | ---------------------- | --------------- |
| mobile    | 1007 / 1032 ms    | +25 ms   | 101 ms | 210 ms            | ok. 125 ms                      | 0,013 / 0,017 s (OK)   | 0,054 / 0,104 s |
| desktop4x | 1705 / 1430 ms    | −274 ms  | 361 ms | 752 ms            | ok. 448 ms                      | 0,017 / 0,005 s (OK)   | 0,136 / 0,151 s |

Wnioski dla dowodów pozycji fali 1: mediana ΔTBT mobile mniejsza niż ok. −125 ms (n = 5) jest rozróżnialna od szumu;
na desktop4x szum jest ok. 3,5 raza większy, więc tam rozstrzyga księga per zadanie (znika zadanie-cel albo dzieli się
poniżej 50 ms sym. we wszystkich przebiegach ważnych B), a mediana ma tylko kierunek. Ta sama seria A/A na mobile dała
medianę 1007-1032 ms wobec 832 ms w serii bazy (przeplot dwóch serwerów na jednej maszynie podnosi koszt głównego
wątku), dlatego pozycje porównuje się wyłącznie w A/B z przeplotem, nigdy z liczbą bazy bezwzględnie.

## 8. Bramka fali 1 (2026-10-05, W0 `ff719b9a6` → W1 `45eb5747c`)

Werdykty bramki i przekazanie do fali 2: `faza2/STAN-FALI-1.md`; liczby per przebieg i statystyki par:
`faza2/raporty/W1-wyniki.json`. Tutaj: komendy, tabele surowe i uwagi o ważności.

Drzewa: A = W0 = `main` @ `ff719b9a6` (produkcja bez fali 1, worktree `$SCRATCH/base-w1gate`, build 2 min 42 s),
B = W1 = gałąź PR @ `45eb5747c` (wszystkie pozycje fali 1, worktree `$SCRATCH/gate-w1`, build 3 min 1 s). Oba z
`BUNDLE_INVENTORY=1 bun run build:smoke`; kopie `lighthouse-local.mjs` po obu stronach bajt w bajt te same. Kroki
ciężkie szły przez mutex maszyny, lekkie (księgi, analiza śladów) przez `light.sh`. `$G` = `$SCRATCH/phase2/wave1/gate`.

```sh
export LIGHTHOUSE_CLI=$SCRATCH/tools/node_modules/lighthouse/cli/index.js   # Lighthouse 13.5.0
export CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
# seria A/B z przeplotem (lh-ab), start 09:39:13 UTC, ok. 22 min
node scripts/performance/lighthouse-local.mjs --compare $SCRATCH/base-w1gate $SCRATCH/gate-w1 \
  --runs 5 --forms mobile,desktop4x --client-backend fixture --third-party fake-gtag \
  --save-artifacts --label w1-gate --out $G/lh-ab
# sprzężenie C3 na obu drzewach (lh-c3), start 09:53:10 UTC; --html-transform działa po obu stronach
node scripts/performance/lighthouse-local.mjs --compare $SCRATCH/base-w1gate $SCRATCH/gate-w1 \
  --runs 5 --forms mobile,desktop4x --client-backend fixture --third-party fake-gtag --save-artifacts \
  --html-transform scripts/performance/whatif/c3-lcpobs.mjs --label w1-gate-c3 --out $G/lh-c3
# księga per zadanie i różnice serii
node scripts/performance/lanternTasks.ts --diff-series $G/lh-ab --form mobile     # i --form desktop4x
node scripts/performance/lanternTasks.ts --min 0 --json $G/lh-ab/<przebieg>.artifacts
# what-if deterministyczny C3 na artefaktach lh-ab (narzędzia P0.5 skopiowane do $G/whatif)
python3 $G/whatif/run_c3wi.py      # whatif.py dropscripts-before-lcp + audit.mjs (klasy audytów Lighthouse 13.5)
# waga dokumentu skryptem W1 na artefakcie W1 i (dla metryk P1.4) na artefakcie W0; 5 próbek HIT
node scripts/performance/check-document-weight.ts --root <drzewo> --json <plik.json>
```

### 8.1 Seria A/B (`lh-ab`)

| forma     | strona | perf | FCP    | LCP    | TBT (mediana, zakres)       | SI     | CLS   | TTI     | oSI    | żądania | JS        | High przed obrazem LCP |
| --------- | ------ | ---- | ------ | ------ | --------------------------- | ------ | ----- | ------- | ------ | ------- | --------- | ---------------------- |
| mobile    | A (W0) | 50   | 4,20 s | 4,90 s | **1203 ms** (966,6–1403,5)  | 4,20 s | 0,000 | 10,73 s | 709 ms | 113     | 1084,7 KB | 620,1 KB               |
| mobile    | B (W1) | 65   | 4,17 s | 4,85 s | **374 ms** (284,6–547,0)    | 4,17 s | 0,000 | 6,25 s  | 497 ms | 99      | 705,6 KB  | 620,5 KB               |
| desktop4x | A (W0) | 65   | 0,98 s | 1,03 s | **1979 ms** (1480,8–2499,0) | 1,45 s | 0,006 | 4,66 s  | 594 ms | 113     | 1084,7 KB | 620,1 KB               |
| desktop4x | B (W1) | 69   | 0,95 s | 0,97 s | **1037 ms** (725,5–1356,0)  | 1,27 s | 0,011 | 3,41 s  | 569 ms | 99      | 705,6 KB  | 620,5 KB               |

TBT per przebieg (księga = audyt, ms): mobile A 966,6 / 1054,0 / 1403,5 / 1363,5 / 1203,0, B 284,6 / 374,0 / 471,5 /
340,0 / 547,0; desktop4x A 2212,0 / 1607,5 / 1480,8 / 2499,0 / 1978,9, B 987,2 / 1095,0 / 1356,0 / 1037,0 / 725,5.

| forma / metryka | Δ mediany | pary: Δ̄   | σΔ    | MDE(t) | MDE(z) | t (df 4) | uwagi                                           |
| --------------- | --------- | --------- | ----- | ------ | ------ | -------- | ----------------------------------------------- |
| mobile TBT      | −829 ms   | −794,7 ms | 170,5 | 283    | 213    | −10,42   | p 0,0005; 5/5 par ujemnych, próbki rozdzielone  |
| mobile oSI      | −212 ms   | −202,8 ms | 76,3  | 127    | 96     | −5,94    | p 0,004; 95 % CI −297,6…−108,0 ms               |
| mobile FCP      | −28 ms    | −23,8 ms  | 82,6  | 137    | –      | −0,64    | w szumie                                        |
| mobile LCP      | −44 ms    | −253,9 ms | 567,2 | 943    | –      | −1,00    | para 3 mieszana co do LCP (4,95 / 3,74 s)       |
| desktop4x TBT   | −942 ms   | −915,5 ms | 569,2 | 946    | 713    | −3,60    | p 0,023; 5/5 par ujemnych; Mann–Whitney p 0,008 |
| desktop4x FCP   | −31 ms    | +34,8 ms  | 226,0 | 376    | –      | +0,34    | para 5 mieszana (A „częściowy”, FCP 0,63 s)     |
| desktop4x LCP   | −61 ms    | −48,1 ms  | 100,0 | 166    | –      | −1,08    | w szumie                                        |

Pary trybu FCP „pełny” (n = 4): mobile TBT −760 ms (σΔ 176, MDE(t) 366), desktop4x −831 ms (σΔ 620, MDE(t) 1290).
Obserwowane FCP: mobile 392 → 432 ms (t 0,67), desktop4x 425 → 496 ms (t 1,35); po połączeniu par obu serii (n = 10)
desktop4x +71,9 ms (σΔ 99,8, t 2,28, 95 % CI +1…+143 ms), czyli granicznie istotne pogorszenie obserwowanego FCP
przy niezmienionym FCP Lantern.

### 8.2 Seria C3 (`lh-c3`) i what-if deterministyczny

| forma     | strona    | perf | FCP    | LCP    | TBT (mediana, zakres)   | SI     | CLS   | TTI     |
| --------- | --------- | ---- | ------ | ------ | ----------------------- | ------ | ----- | ------- |
| mobile    | A (W0+C3) | 70   | 1,57 s | 2,34 s | **1846 ms** (1794–2210) | 2,22 s | 0,000 | 10,07 s |
| mobile    | B (W1+C3) | 73   | 1,55 s | 2,32 s | **1288 ms** (789–1462)  | 1,89 s | 0,000 | 6,02 s  |
| desktop4x | A (W0+C3) | 68   | 0,50 s | 0,63 s | **2335 ms** (1880–2370) | 1,57 s | 0,006 | 5,05 s  |
| desktop4x | B (W1+C3) | 71   | 0,50 s | 0,66 s | **1113 ms** (945–1377)  | 1,11 s | 0,006 | 3,37 s  |

- Pary: TBT mobile −748,1 ms (σΔ 300,1, MDE(t) 499), desktop4x −1061,7 ms (σΔ 328,5, MDE(t) 546); SI mobile
  −290,0 ms (σΔ 253,2, MDE(t) 421, p 0,063); LCP mobile −23,9 ms (σΔ 13,8, p 0,018).
- What-if deterministyczny `dropscripts-before-lcp` (usunięte 26 skryptów na W0, 25 na W1, 24 w B-mobile-3; audyty
  zamiennika `audit.mjs` równe LHR w 20/20, suma księgi what-if = audyt w 20/20): TBT mobile 2056 → 1062 ms (pary
  −989, σΔ 236, MDE(t) 393), desktop4x 2109 → 1179 ms (pary −911, σΔ 645, MDE(t) 1072).
- Sprzężenie (W + C3) − W, tabela w `faza2/STAN-FALI-1.md` §5.1: W1 mobile +914 ms żywo (różnica median dwóch serii,
  tylko kierunek) / +647 ms deterministycznie (mediana par, 507–733); W0 mobile +643 / +824 ms (652–1087).

### 8.3 Uwagi o ważności

- `lh-ab`: 20/20 przebiegów ważnych, `excluded` 0, load 0,33–2,31 (próg 2,4), dokument HIT 20/20, wariant stały po
  każdej stronie (A `s-maxage=900`, 393 695 B; B `s-maxage=900`, 400 753 B), księga = audyt TBT w 20/20. Jeden błąd
  wykonania `NO_NAVSTART` (A-desktop4x-4) harness powtórzył; powtórka jest ważna. Restart serwera po rozgrzewce: A/B
  mobile 1/5, A/B desktop4x 2/5. Tryb FCP: A mobile pełny ×4 + pośredni ×1, A desktop4x pełny ×4 + częściowy ×1,
  B pełny 10/10, czyli jedna para mieszana na formę.
- `lh-c3`: 20/20 ważnych, load 0,2–2,2, HIT 20/20, te same warianty. Tryb FCP: `bez-js` w 18/20, B-desktop4x-2 i -3
  `pełny` (42,4 i 146,5 KB skryptów przed obs. LCP), więc 2/5 par desktop mieszanych. Wszystkie żądania JS assetów
  inicjowane skryptem (A 85/85, B 80/80) w 20/20 przebiegów.
- **Atrapa gtag** w skali ×2,85 w `lh-ab` (benchmarkIndex 1298) i ×2,54 w `lh-c3` (1458), wobec ×2,29 w serii bazy z
  §7. Dotyczy tylko strony A (na W1 nie ma zadań Google), więc różnice między seriami W0 są tylko kierunkowe.
- **Linie `K` w trybie A/B** liczą k z mediany strony A (`lh-ab`: 0,50 / 0,37; `lh-c3`: 0,33 / 0,32). To nie jest
  kalibracja; prognozy używają k z §7 (0,72 / 0,42).
- **MDE z §7 – korekta definicji.** Kolumna „MDE(t) TBT, n = 5 (przeliczone)” w §7 (ok. 125 / ok. 448 ms) to
  2,776·σΔ/√5, czyli próg istotności dla α = 0,05 (w przybliżeniu MDE(z) planu). MDE(t) w definicji harnessu,
  (t₀,₉₇₅ + t₀,₈)·σΔ/√n, wynosi dla n = 5 **168 ms** (mobile) i **600 ms** (desktop4x). Werdyktów fali 1 to nie
  zmienia.
- **Reżim refetchu postów klienta.** W części przebiegów klient wysyła w oknie Lighthouse 8 dodatkowych
  `GET /rest/v1/posts` (do tego `newsletter_settings` i drugie `ad_placements`) w 1,6–2,4 s obs.: `lh-ab` A-desktop4x-4,
  B-mobile-5, B-desktop4x-3, B-desktop4x-4 (A 1/10, B 3/10); `lh-c3` 3/10 i 3/10. W 5 z 10 takich przebiegów TBT jest
  maksimum grupy. Harness tego nie wykrywa ani nie balansuje; w `lh-ab` nierównowaga działa przeciw B.
- **Transformacja C3** to rekonstrukcja z repo (`7b3a4c7dd`), bo plik z planu nie przetrwał. `load` (112–207 ms) jest
  przed pierwszym malowaniem (225–382 ms) w 20/20 przebiegów, więc zapas `load` + `setTimeout(0)` jest uzbrojony przed
  LCP; timer bootu zainstalowano przed kandydatem LCP w 8/20 przebiegów (3/5 B mobile). P2.1 planuje `load` + 500 ms.
- **Licznik gtag harnessu** w B-desktop4x-4 pokazuje 1 skrypt i 6 pingów, ale w śladzie i devtoolsLog nie ma żadnego
  żądania Google: padły poza oknem nagrania, księga ma 0 zadań Google.
- **Przesunięcia powłoki zgód** (B-mobile-1 i -2) mają w śladzie `had_recent_input = true`. To artefakt emulacji:
  Lighthouse liczy takie zdarzenia do 500 ms po zdarzeniu `viewport` (`cumulative-layout-shift.js`), a u użytkownika
  bez emulacji flaga ma wartość `false`.
- **Uwaga do §1 (stan po bramce).** Scalenie `main` do gałęzi fali (`61b6e7f43`, PR #475) usunęło z repo testy
  uprzęży pomiarowej: `document-weight.test.mjs`, `harness-ext.test.mjs`, `psi-sample.test.mjs`, `cms-harness.test.mjs`
  i skrypt `test:measurement-harness`. Wiersze tabeli §1 o tych testach opisują stan sprzed scalenia; bramka fali 1
  mierzyła `45eb5747c`, w którym jeszcze istnieją.
- **Incydent `/dev/null`** (od 10:36 UTC, po obu seriach): `/dev/null` jest dowiązaniem do `$G/lh-c3/summary.json`,
  który przez to przepadł (każdy start powłoki go nadpisuje). LHR, artefakty, księgi i `c3.log` są nienaruszone,
  a `lanternTasks --diff-series $G/lh-c3` nie zadziała bez odtworzenia `summary.json`. Kolejne pomiary dopiero po
  odtworzeniu urządzenia (`rm /dev/null && mknod -m 666 /dev/null c 1 3`, jako root, decyzja człowieka).

## 9. Bramka fali 2 (2026-10-06, W1 `78356a7a` → W2 `ca34249c`)

Werdykty bramki, Definition of Done, prognoza PSI i lista fali 3 są w `faza2/STAN-FALI-2.md` §6. Liczby per przebieg,
statystyki par, księgi i rozstrzygnięcia arbitra: `faza2/raporty/W2-wyniki.json`. Tutaj są komendy, tabele surowe i
uwagi o ważności.

**Drzewa.** Oba zbudowano wcześniej `build:smoke` (`vite.smoke.config.ts`) i w bramce ich nie przebudowywano.
`git status --short` był pusty przed seriami i po nich.

| strona | drzewo                                                            | commit     | `.output/server/index.mjs`  |
| ------ | ----------------------------------------------------------------- | ---------- | --------------------------- |
| A = W1 | `main` na starcie fali 2, worktree `$SCRATCH/base-w2`             | `78356a7a` | 203 452 B, 2026-10-05 13:48 |
| B = W2 | gałąź PR `claude/zen-ritchie-hzur21`, worktree `$SCRATCH/gate-w2` | `ca34249c` | 204 370 B, 2026-10-06 06:47 |

`scripts/performance/lighthouse-local.mjs` jest po obu stronach bajt w bajt ten sam (sha256 `c4500159…6a7`); serie
uruchomiono kopią B. Środowisko: Lighthouse 13.5.0, Chromium 1194, 4 CPU.

Kroki ciężkie szły przez mutex maszyny (`heavy-bg.sh`), lekkie przez `light.sh`. `$G` = `$SCRATCH/phase2/wave2/gate`.

```sh
export LIGHTHOUSE_CLI=$SCRATCH/tools/node_modules/lighthouse/cli/index.js   # Lighthouse 13.5.0
export CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
# ramię przeglądarkowe: 07:35:40–07:47:21 UTC, kod 0 (start po pełnym vitescie; load 1-min 2,51 o 07:35:35)
cd $SCRATCH/gate-w2 && node scripts/performance/lighthouse-local.mjs --compare $SCRATCH/base-w2 $SCRATCH/gate-w2 \
  --runs 5 --forms mobile,desktop4x,desktop5x --client-backend fixture --third-party fake-gtag --save-artifacts \
  --warm-ua browser --label w2-gate-browser --out $G/lh-browser
# ramię bota: 07:47:36–07:59:22 UTC, kod 0
cd $SCRATCH/gate-w2 && node scripts/performance/lighthouse-local.mjs --compare $SCRATCH/base-w2 $SCRATCH/gate-w2 \
  --runs 5 --forms mobile,desktop4x,desktop5x --client-backend fixture --third-party fake-gtag --save-artifacts \
  --warm-ua bot --label w2-gate-bot --out $G/lh-bot
# waga dokumentu, 5 próbek HIT, w każdym drzewie jego skryptem i progami
cd $SCRATCH/base-w2 && node scripts/performance/check-document-weight.ts --json $G/document-weight-A.json
cd $SCRATCH/gate-w2 && node scripts/performance/check-document-weight.ts --json $G/document-weight-B.json
# księga per zadanie (60 przebiegów) i różnice serii (z drzewa B)
node scripts/performance/lanternTasks.ts --min 0 --json $G/analiza/ledger-json/lh-browser.json $G/lh-browser/[AB]-*.artifacts
node scripts/performance/lanternTasks.ts --diff-series $G/lh-browser --form mobile   # i desktop4x, desktop5x, lh-bot
# wrażliwość na szybkość hosta: Lantern od nowa z m' = m × benchmarkIndex przebiegu / mediana LHR serii kalibracji k
CAL_BENCH=1538.5 node $G/analiza/cpu-whatif.mjs $G/arbiter/whatif-browser-mobile-1538.json $G/lh-browser/[AB]-mobile-*.artifacts
CAL_BENCH=1575   node $G/analiza/cpu-whatif.mjs $G/arbiter/whatif-browser-d4-1575.json $G/lh-browser/[AB]-desktop4x-*.artifacts
CAL_BENCH=1538.5 node $G/arbiter/cpu-ledger-cal.mjs $G/arbiter/cpu-ledger-browser-mobile-1538.json $G/lh-browser/[AB]-mobile-*.artifacts
# (to samo dla lh-bot); kontrola metody: A tej serii przeliczone do hosta bramki W1 (mediany B lh-ab: 1356,5 / 1398)
CAL_BENCH=1398 node $G/analiza/cpu-whatif.mjs $G/arbiter/whatif-w1host-browser-d4-1398.json $G/lh-browser/A-desktop4x-*.artifacts
# projekcja PSI: narzedzia/score.py (sha256 3e57f3e9…dbba), k z §7
python3 $G/arbiter/proj.py
```

### 9.1 Serie A/B (`lh-browser`, `lh-bot`)

Mediany z linii `MEDIAN` harnessu i z LHR. TBT = mediana i zakres pięciu przebiegów; księga = audyt w każdym
przebiegu. Pozostałe kolumny:

- CLS i TTI: mediany Lantern;
- oSI: `observedSpeedIndex`;
- główny wątek i bootup: `mainthread-work-breakdown` i `bootup-time`;
- benchmarkIndex: mediana `environment.benchmarkIndex` z LHR.

**Ramię browser** (`--warm-ua browser`)

| forma     | strona | perf | FCP     | LCP     | TBT (mediana, zakres)      | SI      | CLS   | TTI    | oSI    | główny wątek | bootup  | żądania | transfer  | JS       | High przed obrazem LCP | benchmarkIndex |
| --------- | ------ | ---- | ------- | ------- | -------------------------- | ------- | ----- | ------ | ------ | ------------ | ------- | ------- | --------- | -------- | ---------------------- | -------------- |
| mobile    | A (W1) | 72   | 4,104 s | 4,812 s | **114,5 ms** (99,5–206,0)  | 4,104 s | 0,000 | 5,78 s | 275 ms | 4601 ms      | 2494 ms | 99      | 1010,7 KB | 705,9 KB | 620,8 KB               | 2460,0         |
| mobile    | B (W2) | 98   | 1,554 s | 2,332 s | **40,8 ms** (28,0–55,5)    | 1,554 s | 0,000 | 5,46 s | 192 ms | 2575 ms      | 1129 ms | 73      | 916,2 KB  | 638,5 KB | 112,6 KB               | 2617,0         |
| desktop4x | A (W1) | 95   | 0,851 s | 0,931 s | **156,6 ms** (132,3–351,5) | 0,851 s | 0,000 | 1,75 s | 368 ms | 4338 ms      | 2170 ms | 103     | 1011,9 KB | 705,9 KB | 620,8 KB               | 2426,0         |
| desktop4x | B (W2) | 93   | 0,396 s | 0,548 s | **216,0 ms** (174,5–249,5) | 0,564 s | 0,000 | 1,25 s | 223 ms | 3063 ms      | 1406 ms | 77      | 922,2 KB  | 644,6 KB | 112,6 KB               | 2406,5         |
| desktop5x | A (W1) | 74   | 0,906 s | 0,971 s | **606,0 ms** (442,2–679,0) | 0,940 s | 0,002 | 2,35 s | 366 ms | 5795 ms      | 3012 ms | 103     | 1011,8 KB | 705,9 KB | 620,8 KB               | 2335,5         |
| desktop5x | B (W2) | 82   | 0,440 s | 0,549 s | **407,0 ms** (292,5–692,5) | 0,725 s | 0,000 | 1,56 s | 261 ms | 3982 ms      | 1919 ms | 77      | 922,2 KB  | 644,6 KB | 112,6 KB               | 2349,0         |

TBT per przebieg (księga = audyt, ms):

- mobile: A 99,5 / 114,5 / 135,5 / 206,0 / 108,0; B 35,5 / 28,0 / 40,8 / 55,5 / 55,0
- desktop4x: A 132,3 / 351,5 / 160,0 / 149,5 / 156,6; B 216,0 / 249,5 / 174,5 / 203,5 / 222,5
- desktop5x: A 654,3 / 442,2 / 606,0 / 679,0 / 448,0; B 692,5 / 407,0 / 338,5 / 292,5 / 481,5

**Ramię bot** (`--warm-ua bot`)

| forma     | strona | perf | FCP     | LCP     | TBT (mediana, zakres)      | SI      | CLS   | TTI    | oSI    | główny wątek | bootup  | żądania | transfer  | JS       | High przed obrazem LCP | benchmarkIndex |
| --------- | ------ | ---- | ------- | ------- | -------------------------- | ------- | ----- | ------ | ------ | ------------ | ------- | ------- | --------- | -------- | ---------------------- | -------------- |
| mobile    | A (W1) | 69   | 4,124 s | 4,885 s | **176,5 ms** (116,0–273,1) | 4,124 s | 0,000 | 5,88 s | 361 ms | 5286 ms      | 2847 ms | 99      | 1008,9 KB | 705,9 KB | 620,8 KB               | 2232,5         |
| mobile    | B (W2) | 97   | 1,542 s | 2,307 s | **83,0 ms** (58,0–108,4)   | 1,629 s | 0,000 | 5,49 s | 209 ms | 2743 ms      | 1233 ms | 71      | 914,8 KB  | 638,5 KB | 112,6 KB               | 2367,0         |
| desktop4x | A (W1) | 88   | 0,853 s | 0,934 s | **262,5 ms** (242,8–305,2) | 0,853 s | 0,000 | 1,87 s | 406 ms | 4564 ms      | 2407 ms | 103     | 1010,2 KB | 705,9 KB | 620,8 KB               | 2371,0         |
| desktop4x | B (W2) | 89   | 0,489 s | 0,560 s | **268,0 ms** (185,5–301,5) | 0,663 s | 0,000 | 1,31 s | 270 ms | 2986 ms      | 1411 ms | 77      | 921,4 KB  | 644,6 KB | 112,6 KB               | 2266,0         |
| desktop5x | A (W1) | 76   | 0,882 s | 0,969 s | **496,0 ms** (429,3–728,5) | 0,916 s | 0,000 | 2,31 s | 370 ms | 5621 ms      | 2852 ms | 99      | 1008,9 KB | 705,9 KB | 620,8 KB               | 2689,5         |
| desktop5x | B (W2) | 84   | 0,397 s | 0,552 s | **358,1 ms** (282,4–461,8) | 0,625 s | 0,000 | 1,39 s | 233 ms | 3764 ms      | 1884 ms | 77      | 921,4 KB  | 644,6 KB | 112,6 KB               | 2394,0         |

TBT per przebieg (księga = audyt, ms):

- mobile: A 159,1 / 191,2 / 116,0 / 273,1 / 176,5; B 69,5 / 83,0 / 108,4 / 58,0 / 88,0
- desktop4x: A 261,0 / 305,2 / 300,5 / 242,8 / 262,5; B 185,5 / 272,0 / 301,5 / 268,0 / 250,5
- desktop5x: A 728,5 / 496,0 / 448,4 / 429,3 / 592,0; B 282,4 / 431,5 / 358,1 / 332,0 / 461,8

### 9.2 Pary A-n/B-n

Δ = B − A; MDE(t) = (t₀,₉₇₅ + t₀,₈)·σΔ/√5 = 3,717·σΔ/√5, MDE(z) = 2,8016·σΔ/√5. Harness w liniach `PAIRS` używa
2,80, co różni się o ≤ 0,1 %. Liczby `W2-wyniki.json` `series.*.forms.*.pairs` są zgodne z liniami `PAIRS`. W każdej
formie i ramieniu pary są mieszane co do trybu FCP w 5/5 (A pełny albo częściowy, B `bez-js`), więc warstwowanie par
po trybie jest puste.

| ramię   | forma     | metryka      | Δ median | pary Δ̄ |    σΔ | MDE(t) | MDE(z) | t (df 4) |
| ------- | --------- | ------------ | -------: | -----: | ----: | -----: | -----: | -------: |
| browser | mobile    | TBT [ms]     |    −73,7 |  −89,7 |  37,9 |   63,0 |   47,5 |    −5,30 |
| browser | mobile    | FCP [s]      |   −2,550 | −2,099 | 1,023 |  1,701 |  1,282 |    −4,59 |
| browser | mobile    | LCP [s]      |   −2,480 | −2,527 | 0,130 |  0,216 |  0,163 |   −43,44 |
| browser | mobile    | SI [s]       |   −2,550 | −2,099 | 1,023 |  1,701 |  1,282 |    −4,59 |
| browser | mobile    | TTI [s]      |   −0,319 | −0,374 | 0,168 |  0,279 |  0,210 |    −4,98 |
| browser | mobile    | obs. SI [ms] |      −83 |   −121 |    50 |     84 |     63 |    −5,34 |
| browser | desktop4x | TBT [ms]     |    +59,4 |  +23,2 |  74,5 |  123,8 |   93,3 |    +0,70 |
| browser | desktop4x | FCP [s]      |   −0,455 | −0,461 | 0,106 |  0,177 |  0,133 |    −9,71 |
| browser | desktop4x | LCP [s]      |   −0,383 | −0,404 | 0,046 |  0,077 |  0,058 |   −19,53 |
| browser | desktop4x | SI [s]       |   −0,287 | −0,322 | 0,079 |  0,131 |  0,099 |    −9,13 |
| browser | desktop4x | TTI [s]      |   −0,499 | −0,470 | 0,224 |  0,373 |  0,281 |    −4,69 |
| browser | desktop4x | obs. SI [ms] |     −145 |   −150 |    91 |    152 |    114 |    −3,66 |
| browser | desktop5x | TBT [ms]     |   −199,0 | −123,5 | 192,7 |  320,3 |  241,4 |    −1,43 |
| browser | desktop5x | FCP [s]      |   −0,466 | −0,476 | 0,095 |  0,157 |  0,118 |   −11,25 |
| browser | desktop5x | LCP [s]      |   −0,422 | −0,448 | 0,083 |  0,137 |  0,104 |   −12,10 |
| browser | desktop5x | SI [s]       |   −0,215 | −0,228 | 0,111 |  0,184 |  0,139 |    −4,59 |
| browser | desktop5x | TTI [s]      |   −0,787 | −0,792 | 0,276 |  0,459 |  0,346 |    −6,41 |
| browser | desktop5x | obs. SI [ms] |     −105 |   −112 |    32 |     52 |     40 |    −7,97 |
| bot     | mobile    | TBT [ms]     |    −93,5 | −101,8 |  74,3 |  123,5 |   93,1 |    −3,06 |
| bot     | mobile    | FCP [s]      |   −2,582 | −2,551 | 0,056 |  0,093 |  0,070 |  −101,40 |
| bot     | mobile    | LCP [s]      |   −2,578 | −2,541 | 0,069 |  0,114 |  0,086 |   −82,53 |
| bot     | mobile    | SI [s]       |   −2,495 | −2,419 | 0,141 |  0,235 |  0,177 |   −38,24 |
| bot     | mobile    | TTI [s]      |   −0,394 | −0,346 | 0,230 |  0,383 |  0,288 |    −3,36 |
| bot     | mobile    | obs. SI [ms] |     −152 |   −157 |    32 |     54 |     40 |   −10,88 |
| bot     | desktop4x | TBT [ms]     |     +5,5 |  −18,9 |  38,1 |   63,3 |   47,7 |    −1,11 |
| bot     | desktop4x | FCP [s]      |   −0,364 | −0,377 | 0,051 |  0,086 |  0,065 |   −16,39 |
| bot     | desktop4x | LCP [s]      |   −0,374 | −0,383 | 0,015 |  0,025 |  0,018 |   −58,10 |
| bot     | desktop4x | SI [s]       |   −0,190 | −0,219 | 0,076 |  0,127 |  0,096 |    −6,43 |
| bot     | desktop4x | TTI [s]      |   −0,565 | −0,583 | 0,127 |  0,211 |  0,159 |   −10,25 |
| bot     | desktop4x | obs. SI [ms] |     −136 |   −137 |    64 |    106 |     80 |    −4,81 |
| bot     | desktop5x | TBT [ms]     |   −137,9 | −165,7 | 158,5 |  263,5 |  198,6 |    −2,34 |
| bot     | desktop5x | FCP [s]      |   −0,485 | −0,462 | 0,114 |  0,190 |  0,143 |    −9,06 |
| bot     | desktop5x | LCP [s]      |   −0,417 | −0,398 | 0,051 |  0,085 |  0,064 |   −17,50 |
| bot     | desktop5x | SI [s]       |   −0,291 | −0,270 | 0,099 |  0,165 |  0,124 |    −6,10 |
| bot     | desktop5x | TTI [s]      |   −0,922 | −0,845 | 0,174 |  0,289 |  0,218 |   −10,87 |
| bot     | desktop5x | obs. SI [ms] |     −137 |   −136 |    33 |     55 |     41 |    −9,25 |

### 9.3 Wrażliwość na szybkość hosta (przeliczenie Lantern, bez nowego pomiaru)

**Metoda.** m' = m × benchmarkIndex przebiegu / mediana LHR `environment.benchmarkIndex` serii kalibracji k (§7):

- mianowniki: mobile 1538,5, desktop4x 1575 (`lighthouse-local-baseline-w1.json` `forms.*.median.benchmarkIndex`);
- silnik: Lighthouse 13.5.0, ten sam co audyt (LoadSimulator + `LanternTotalBlockingTime`/`FirstContentfulPaint`/
  `LargestContentfulPaint`/`Interactive`);
- kontrola: przy m' = m TBT jest równe audytowi.

Pierwsza wersja analizy dzieliła przez 1616,5, czyli benchmark atrapy gtag sprzed serii kalibracji. Licznik pochodził
wtedy z LHR, a mianownik z innego pomiaru, więc ta wersja jest zastąpiona. Przeliczenie arbitra jest identyczne bajt w
bajt z weryfikacją statystyki.

| ramię   | forma     | benchmarkIndex B (przebiegi)           | m' B                              | TBT A: zmierzone → m' (mediana) [ms] | TBT B przy m': przebiegi; mediana (zmierzone) [ms]   | pary B−A przy m': Δ̄ / σΔ / MDE(t) / t |
| ------- | --------- | -------------------------------------- | --------------------------------- | ------------------------------------ | ---------------------------------------------------- | ------------------------------------- |
| browser | mobile    | 2778,5, 2637,0, 2553,0, 2445,5, 2617,0 | 7,224, 6,856, 6,638, 6,358, 6,804 | 114,5 → **374,5**                    | 503,2, 396,5, 483,3, 468,0, 381,5; **468,0** (40,8)  | −43,6 / 242,25 / 402,7 / −0,40        |
| browser | desktop4x | 2406,5, 2689,0, 2352,0, 2423,0, 2367,5 | 6,112, 6,829, 5,973, 6,154, 6,013 | 156,6 → **672,0**                    | 499,5, 743,0, 432,7, 565,0, 540,4; **540,4** (216,0) | −145,7 / 51,9 / 86,3 / −6,28          |
| bot     | mobile    | 2371,5, 2367,0, 2377,5, 2307,5, 2364,0 | 6,166, 6,154, 6,181, 5,999, 6,146 | 176,5 → **364,2**                    | 477,5, 506,2, 530,5, 182,5, 434,0; **477,5** (83,0)  | +38,3 / 227,1 / 377,6 / +0,38         |
| bot     | desktop4x | 2464,0, 2454,0, 2202,5, 2000,0, 2266,0 | 6,258, 6,232, 5,594, 5,079, 5,755 | 262,5 → **857,2**                    | 491,5, 609,5, 642,0, 443,5, 512,0; **512,0** (268,0) | −305,5 / 113,9 / 189,3 / −6,00        |

**Kontrola metody.** Stronę A tej serii (drzewo W1) przeliczyłem do szybkości hosta bramki W1, przyjmując mediany B
`lh-ab` (mobile 1356,5, desktop4x 1398), i porównałem z TBT zmierzonym w bramce W1:

| forma     | przeliczone | zmierzone w bramce W1 | błąd  |
| --------- | ----------- | --------------------- | ----- |
| mobile    | 515,5 ms    | 374 ms                | +38 % |
| desktop4x | 885 ms      | 1037 ms               | −15 % |

Metoda m' ma więc niepewność rzędu −15…+38 % TBT. Drzewo A ma też późniejsze scalenia `main` niż W1 z bramki W1.

**FCP i LCP przy m'.** Mobile B, przebiegi:

- browser: FCP 1525 / 1537 / 1639 / 1554 / 1570 ms, LCP bez zmian;
- bot: FCP 1532 / 1555 / 1542 / 1670 / 1521 ms, LCP bez zmian.

### 9.4 Uwagi o ważności

- **Przebiegi:**
  - 60/60 ważnych (5/5 na stronę, formę i ramię), `excludedAttempts` 0, `outcome.exitCode` 0, `failures` [];
    dobierania nie było.
  - Dokument Lighthouse'a HIT w każdym przebiegu. Wariant stały po każdej stronie: browser A `s-maxage=900`,
    400 880 B, B 337 912 B; bot A 392 234 B, B 330 857 B.
  - Księga = audyt TBT (±1 ms) w 60/60. Dwie niezależne regeneracje ksiąg weryfikatorów dały to samo.
- **Load:** browser 1,00–1,98, bot 0,74–1,77 (próg 2,4).
- **Restarty i powtórki:**
  - Dwa `NO_NAVSTART` (browser A-mobile-1, bot B-desktop4x-4) harness powtórzył; powtórki są ważne.
  - Restart serwera po rozgrzewce w 6 przebiegach na ramię (lista w `MEASURE.md` §3), gdy rozgrzewka zastała wpis
    STALE.
- **Tryb FCP:** A pełny (browser A-mobile-4 częściowy: FCP 1,83 s), B `bez-js` w 30/30.
- **Szybkość hosta:**
  - benchmarkIndex przebiegów 1759–2779; mediany B mobile 2617 / 2367, desktop4x 2406,5 / 2266.
  - Dla porównania: seria kalibracji k (§7) 1538,5 / 1575, bramka W1 (§8, `lh-ab`) B 1356,5 / 1398.
  - Atrapa gtag w skali ×1,65 (benchmark Chrome 2240) i ×1,74 (2126) wobec ×2,29 w §7 i ×2,85 / ×2,54 w §8.
  - TBT bezwzględne nie jest porównywalne z §7 i §8 bez normalizacji (§9.3).
- **Linie `K`** w trybie A/B (5,24 / 4,73 / 1,22 browser; 3,40 / 2,82 / 1,49 bot) liczą k z mediany strony A tej
  serii. To nie jest kalibracja; prognozy używają k z §7 (0,72 / 0,42). Proporcjonalne mapowanie przez k przy TBT
  40–80 ms nie ma podstawy empirycznej, bo k skalibrowano przy 832 ms.
- **Reżim refetchu postów klienta.** W części przebiegów klient wysyła po boocie dodatkowe `GET /rest/v1/posts`. W
  oknie Lighthouse (devtoolsLog) jest ich 8 na desktopie i 5 na mobile. Przebiegi z refetchem:

  | ramię   | strona | w oknie Lighthouse                                                         | licznik backendu fixture                     |
  | ------- | ------ | -------------------------------------------------------------------------- | -------------------------------------------- |
  | browser | A      | 2/15 (A-desktop4x-2, A-desktop5x-1)                                        | 3/15 (dochodzi A-mobile-3: 4 GET poza oknem) |
  | browser | B      | 5/15 (B-mobile-3, B-mobile-4, B-desktop4x-3, B-desktop4x-4, B-desktop5x-3) | 5/15                                         |
  | bot     | A      | 1/15 (A-desktop4x-2)                                                       | 1/15                                         |
  | bot     | B      | 4/15 (B-mobile-4, B-desktop4x-3, B-desktop5x-1, B-desktop5x-2)             | 5/15 (dochodzi B-mobile-3: 4 GET poza oknem) |

  Harness tego nie wykrywa ani nie balansuje; nierównowaga działa przeciw B. Oba przekroczenia kryterium (a) wypadają
  w przebiegach z refetchem w oknie (2/3 wobec 0/7, Fisher p ≈ 0,067). Refetch nie jest jednak przyczyną: GET-y ruszają
  766 / 751 ms obs., po obs. LCP, a przyczyną jest wyścig arkusza z parserem nagłówka (`STAN-FALI-2.md` §6.1).

- **CLS:**
  - B: 0 we wszystkich 30 przebiegach (audyt i zdarzenia `LayoutShift` w śladzie).
  - A: browser A-mobile-5 0,4014 (`had_recent_input = true`; Lighthouse liczy takie zdarzenia do 500 ms po
    `viewport`, §8.3), A-desktop4x-3 0,0061, A-desktop5x-2 0,0113, A-desktop5x-3 0,0061, A-desktop5x-5 0,0016; bot
    A-mobile-4 0,0006.
- **Waga dokumentu:** oba drzewa mieszczą się w swoich progach. Mediany W1 → W2:
  - `htmlRawBytes` 391,5 → 330,0 KB, `htmlGzipBytes` 55,5 → 51,4 KB, `headRawBytes` 25,3 → 28,3 KB;
  - `modulepreloadCount` 25 → 0, `preLcpTransferBytes` 727,9 → 173,9 KB, `bootClosureGzipBytes` 474,0 → 484,5 KB;
  - zestaw bootu W2: 26 URL-i, seria 26 plików / 574 001 B gzip; JS z priorytetem High przy starcie: W1 25 plików
    (563 491 B gzip), W2 0.
- **Klasy K** (heurystyka `kclass()` w `analiza/analyze.py`) nie zmieniają sum księgi.
  - Korekta arbitra: dwa zadania `Timer:(dokument)` w bot B-desktop5x-1 i -3 to callback timera `boot()` loadera P2.1.
    Należą do K4i, a nie do „Kmod”.
  - Klatki Style z `$RV` (dominujący URL skryptu = dokument, udział skryptu ≤ 26 %) nie są liczone jako skrypt inline.
- **`/dev/null` nie był dotykany;** serie i analizy zapisywały wyłącznie do `$G`.
