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
