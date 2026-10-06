# Bramka fali 2 – pomiar (W2-GATE, 2026-10-06)

Zakres: tylko pomiar i ważność, bez interpretacji progów bramki. `$S` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad`,
`$G` = `$S/phase2/wave2/gate`. Każda liczba poniżej pochodzi z plików w `$G` (źródło podane przy sekcji).

## 1. Drzewa i harness

| strona                                        | drzewo       | commit (`git log --oneline -1`)                                                                              | `.output/server/index.mjs`         | `git status --short` przed i po |
| --------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------- |
| A = W1 (baza fali 2)                          | `$S/base-w2` | `78356a7a Merge pull request #472 from NewEUStrategies/claude/zen-johnson-wpzoxv`                            | jest (203 452 B, 2026-10-05 13:48) | czysto / czysto                 |
| B = W2 (gałąź PR `claude/zen-ritchie-hzur21`) | `$S/gate-w2` | `ca34249c Formatowanie prettier sześciu plików z main (commity Lovable), żeby format:check w CI był zielony` | jest (204 370 B, 2026-10-06 06:47) | czysto / czysto                 |

- `scripts/performance/lighthouse-local.mjs` w A i B: `cmp` bez różnic (sha256 `c4500159f74cf4b12ac812a15979bf2eaec25d157f96e3db6903761f829c56a7` po obu stronach). Seria uruchomiona kopią B z katalogu B (tak jak w poleceniu).
- Drzew nie przebudowywano; po obu seriach `git status --short` w A, B i w repo głównym pusty.
- Lighthouse 13.5.0 (`$S/tools/node_modules/lighthouse`), Chrome `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, 4 CPU, `--max-load` 2,4 (domyślne 0,6 × CPU), `min-valid` 5, powtórki excluded 2.
- Przed pomiarem: czekanie na `$G/vitest-full.exit` (pełny vitest orkiestratora). Plik pojawił się o 07:34 UTC (zawartość `1`); load o 07:35:35 UTC: 2,51 / 4,42 / 4,52. Pierwszy Lighthouse wystartował po zakończeniu vitesta.

## 2. Komendy i czasy

Oba ramiona przez mutex (`heavy-bg.sh`, w tle), jedno po drugim.

```sh
# ramię przeglądarkowe: start 2026-10-06T07:35:40Z, koniec 07:47:21Z (mtime lh-browser.log.exit; summary.json savedAt 07:47:20.722Z), kod 0
cd $S/gate-w2 && $S/heavy-bg.sh $G/lh-browser.log env LIGHTHOUSE_CLI=$S/tools/node_modules/lighthouse/cli/index.js \
  CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scripts/performance/lighthouse-local.mjs \
  --compare $S/base-w2 $S/gate-w2 --runs 5 --forms mobile,desktop4x,desktop5x --client-backend fixture \
  --third-party fake-gtag --save-artifacts --warm-ua browser --label w2-gate-browser --out $G/lh-browser
# ramię bota: start 2026-10-06T07:47:36Z, koniec 07:59:22Z (mtime lh-bot.log.exit; savedAt 07:59:20.908Z), kod 0
cd $S/gate-w2 && $S/heavy-bg.sh $G/lh-bot.log env LIGHTHOUSE_CLI=$S/tools/node_modules/lighthouse/cli/index.js \
  CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scripts/performance/lighthouse-local.mjs \
  --compare $S/base-w2 $S/gate-w2 --runs 5 --forms mobile,desktop4x,desktop5x --client-backend fixture \
  --third-party fake-gtag --save-artifacts --warm-ua bot --label w2-gate-bot --out $G/lh-bot
# waga dokumentu (light.sh), 07:59:36–07:59:48Z, oba kod 0
cd $S/base-w2 && $S/light.sh node scripts/performance/check-document-weight.ts --json $G/document-weight-A.json > $G/document-weight-A.log 2>&1
cd $S/gate-w2 && $S/light.sh node scripts/performance/check-document-weight.ts --json $G/document-weight-B.json > $G/document-weight-B.log 2>&1
# tabele per przebieg (light.sh): summary.json + LHR + *.ledger.txt -> tables.md, runs.json
$S/light.sh python3 $G/extract.py
```

Uwaga: ramię przeglądarkowe trwało ok. 12 min, ramię bota ok. 12 min (zamiast zakładanych 30–60 min): żaden przebieg nie był `excluded`, nie było czekania na load.

## 3. Ważność

Źródło: linie `VALID` w `lh-*.log`, `summary.json` (`forms.*.validity`, `outcome`, `records[].attempt/valid/load`).

| ramię   | forma     | A: ważne / excluded / restart serwera / trybFCP   | B: ważne / excluded / restart serwera / trybFCP |
| ------- | --------- | ------------------------------------------------- | ----------------------------------------------- |
| browser | mobile    | 5/5, 0, 1/5, pełny ×4 + częściowy ×1 (A-mobile-4) | 5/5, 0, 1/5, bez-js ×5                          |
| browser | desktop4x | 5/5, 0, 1/5, pełny ×5                             | 5/5, 0, 1/5, bez-js ×5                          |
| browser | desktop5x | 5/5, 0, 1/5, pełny ×5                             | 5/5, 0, 1/5, bez-js ×5                          |
| bot     | mobile    | 5/5, 0, 1/5, pełny ×5                             | 5/5, 0, 1/5, bez-js ×5                          |
| bot     | desktop4x | 5/5, 0, 1/5, pełny ×5                             | 5/5, 0, 0/5, bez-js ×5                          |
| bot     | desktop5x | 5/5, 0, 2/5, pełny ×5                             | 5/5, 0, 1/5, bez-js ×5                          |

- Razem 60/60 przebiegów ważnych (30 browser, 30 bot), `excludedAttempts` 0 w każdej grupie, `outcome.exitCode` 0, `failures` [], `refusedBaselineForms` [] w obu `summary.json`. **Dobierania przebiegów (krok 4) nie było potrzeby i nie wykonano.**
- Dokument Lighthouse'a HIT w każdym przebiegu, „SSR w trakcie: 0”; wariant stały po każdej stronie: browser A `s-maxage=900, 400880 B` ×15, B `s-maxage=900, 337912 B` ×15; bot A `s-maxage=900, 392234 B` ×15, B `s-maxage=900, 330857 B` ×15.
- Księga = audyt TBT (`LEDGER … OK`) w 30/30 przebiegów każdego ramienia; `google=0 zadań/0 ms` w 60/60.
- Load przy przebiegach (`records[].load`): browser 1,00–1,98, bot 0,74–1,77 (próg 2,4). benchmarkIndex przebiegów: browser 2086,5–2778,5, bot 1759–2728,5 (`metrics.benchmarkIndex`).
- Błędy wykonania `NO_NAVSTART` (harness powtórzył przebieg, powtórka ważna): browser A-mobile-1, bot B-desktop4x-4. W `records` mają `attempt` 0 (błąd wykonania nie liczy się jako `excluded`).
- Restart serwera po rozgrzewce (`rewarm.restores` = 1): browser A-mobile-4, B-mobile-5, A-desktop4x-3, B-desktop4x-5, A-desktop5x-2, B-desktop5x-4; bot A-mobile-4, B-mobile-5, A-desktop4x-3, A-desktop5x-1, A-desktop5x-4, B-desktop5x-3. Przyczyna w logu: rozgrzewka zastała wpis STALE albo o za małej świeżości (np. `rozgrzewka STALE age=212s` w browser B-mobile-5).
- Pary w trybie A/B: każda forma ma „pary mieszane 5/5” (A tryb pełny/częściowy, B bez-js), więc warstwowanie par po trybie FCP jest puste (`PAIRS … tryb FCP: -`).

## 4. Nagłówki serii (dosłownie z logów)

```

# lh-browser
backend klienta: PostgREST fixture na 127.0.0.1:4199
fałszywy gtag: port 45127, skala x1.65 (benchmarkIndex Chrome 2240 z [2299, 2240, 2209.5])
A: /tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad/base-w2 @ 78356a7a upstream :46131 front https://fixture.invalid (h2, fixture, rozgrzewka browser) HTML 200 raw 400880 B gzip 56844 B x-nes-cache=HIT wariant wzorcowy: s-maxage=900, 400880 B
B: /tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad/gate-w2 @ ca34249c upstream :39903 front https://fixture.invalid (h2, fixture, rozgrzewka browser) HTML 200 raw 337912 B gzip 52595 B x-nes-cache=HIT wariant wzorcowy: s-maxage=900, 337912 B
flagi: client-backend=fixture,third-party=fake-gtag; przebiegi: 5 x mobile,desktop4x,desktop5x; powtórki excluded: 2; min-valid: 5; max-load: 2.4

# lh-bot
backend klienta: PostgREST fixture na 127.0.0.1:4199
fałszywy gtag: port 33485, skala x1.74 (benchmarkIndex Chrome 2126 z [2201.5, 2025.5, 2126])
A: /tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad/base-w2 @ 78356a7a upstream :32907 front https://fixture.invalid (h2, fixture, rozgrzewka bot) HTML 200 raw 392234 B gzip 53387 B x-nes-cache=HIT wariant wzorcowy: s-maxage=900, 392234 B
B: /tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad/gate-w2 @ ca34249c upstream :37535 front https://fixture.invalid (h2, fixture, rozgrzewka bot) HTML 200 raw 330857 B gzip 49926 B x-nes-cache=HIT wariant wzorcowy: s-maxage=900, 330857 B
flagi: client-backend=fixture,third-party=fake-gtag; przebiegi: 5 x mobile,desktop4x,desktop5x; powtórki excluded: 2; min-valid: 5; max-load: 2.4

```

## 5. Linie VALID / MEDIAN / K / DELTA / PAIRS (dosłownie)

Źródło: `lh-browser.log`, `lh-bot.log`.

### Ramię browser (`--warm-ua browser`)

```
VALID w2-gate-browser A mobile: n_valid=5/5 excluded=0 wariant: s-maxage=900, 400880 B x5 trybFCP: pełny x4, częściowy x1 po restarcie serwera: 1/5
MEDIAN w2-gate-browser A mobile: perf=72 FCP=4.10s LCP=4.81s TBT=115ms SI=4.10s CLS=0.000 TTFB=8ms TTI=5.78s mainThread=4601ms bootup=2494ms longTasks=13 req=99 transfer=1010.7KB js=705.9KB highBeforeLcpImg=620.8KB bench=2460 (n=5, TBT 100ms-206ms, perf 52-77)
VALID w2-gate-browser A desktop4x: n_valid=5/5 excluded=0 wariant: s-maxage=900, 400880 B x5 trybFCP: pełny x5 po restarcie serwera: 1/5
MEDIAN w2-gate-browser A desktop4x: perf=95 FCP=0.85s LCP=0.93s TBT=157ms SI=0.85s CLS=0.000 TTFB=8ms TTI=1.75s mainThread=4338ms bootup=2170ms longTasks=12 req=103 transfer=1011.9KB js=705.9KB highBeforeLcpImg=620.8KB bench=2426 (n=5, TBT 132ms-352ms, perf 83-96)
VALID w2-gate-browser A desktop5x: n_valid=5/5 excluded=0 wariant: s-maxage=900, 400880 B x5 trybFCP: pełny x5 po restarcie serwera: 1/5
MEDIAN w2-gate-browser A desktop5x: perf=74 FCP=0.91s LCP=0.97s TBT=606ms SI=0.94s CLS=0.002 TTFB=7ms TTI=2.35s mainThread=5795ms bootup=3012ms longTasks=20 req=103 transfer=1011.8KB js=705.9KB highBeforeLcpImg=620.8KB bench=2336 (n=5, TBT 442ms-679ms, perf 70-78)
VALID w2-gate-browser B mobile: n_valid=5/5 excluded=0 wariant: s-maxage=900, 337912 B x5 trybFCP: bez-js x5 po restarcie serwera: 1/5
MEDIAN w2-gate-browser B mobile: perf=98 FCP=1.55s LCP=2.33s TBT=41ms SI=1.55s CLS=0.000 TTFB=7ms TTI=5.46s mainThread=2575ms bootup=1129ms longTasks=8 req=73 transfer=916.2KB js=638.5KB highBeforeLcpImg=112.6KB bench=2617 (n=5, TBT 28ms-56ms, perf 97-98)
VALID w2-gate-browser B desktop4x: n_valid=5/5 excluded=0 wariant: s-maxage=900, 337912 B x5 trybFCP: bez-js x5 po restarcie serwera: 1/5
MEDIAN w2-gate-browser B desktop4x: perf=93 FCP=0.40s LCP=0.55s TBT=216ms SI=0.56s CLS=0.000 TTFB=6ms TTI=1.25s mainThread=3063ms bootup=1406ms longTasks=8 req=77 transfer=922.2KB js=644.6KB highBeforeLcpImg=112.6KB bench=2407 (n=5, TBT 175ms-250ms, perf 91-96)
VALID w2-gate-browser B desktop5x: n_valid=5/5 excluded=0 wariant: s-maxage=900, 337912 B x5 trybFCP: bez-js x5 po restarcie serwera: 1/5
MEDIAN w2-gate-browser B desktop5x: perf=82 FCP=0.44s LCP=0.55s TBT=407ms SI=0.73s CLS=0.000 TTFB=8ms TTI=1.56s mainThread=3982ms bootup=1919ms longTasks=16 req=77 transfer=922.2KB js=644.6KB highBeforeLcpImg=112.6KB bench=2349 (n=5, TBT 293ms-693ms, perf 74-88)
K mobile: TBT fixture=115ms PSI(mobile)=600ms k=5.24 (|k-1| > 0,2: przelicz cele fixture) [PSI 2026-10-03 18:58 CEST (hl=pl)] {client-backend=fixture,third-party=fake-gtag}
K desktop4x: TBT fixture=157ms PSI(desktop)=740ms k=4.73 (|k-1| > 0,2: przelicz cele fixture) [PSI 2026-10-03 18:58 CEST (hl=pl)] {client-backend=fixture,third-party=fake-gtag}
K desktop5x: TBT fixture=606ms PSI(desktop)=740ms k=1.22 (|k-1| > 0,2: przelicz cele fixture) [PSI 2026-10-03 18:58 CEST (hl=pl)] {client-backend=fixture,third-party=fake-gtag}
DELTA w2-gate-browser B-A mobile: score=+26 fcp=-2.55s lcp=-2.48s tbt=-74ms si=-2.55s cls=±0.000 ttfb=-1ms mainThreadMs=-2025ms bootupMs=-1364ms transferBytes=-94.5KB scriptTransferBytes=-67.3KB highPriorityBytesBeforeLcpImage=-508.1KB requests=-26
PAIRS w2-gate-browser mobile (n=5, t(df=4)=3.72): score: Δ=29.0 σΔ=9.7 MDE(t)=16.2 MDE(z)=12.2 | fcp: Δ=-2.099s σΔ=1.023s MDE(t)=1.701s MDE(z)=1.281s | lcp: Δ=-2.527s σΔ=0.130s MDE(t)=0.216s MDE(z)=0.163s | tbt: Δ=-90ms σΔ=38ms MDE(t)=63ms MDE(z)=47ms | si: Δ=-2.099s σΔ=1.023s MDE(t)=1.701s MDE(z)=1.281s | tti: Δ=-0.374s σΔ=0.168s MDE(t)=0.279s MDE(z)=0.210s
PAIRS w2-gate-browser mobile tryb FCP: -; pary mieszane 5/5
DELTA w2-gate-browser B-A desktop4x: score=-2 fcp=-0.45s lcp=-0.38s tbt=+59ms si=-0.29s cls=±0.000 ttfb=-2ms mainThreadMs=-1275ms bootupMs=-764ms transferBytes=-89.6KB scriptTransferBytes=-61.3KB highPriorityBytesBeforeLcpImage=-508.1KB requests=-26
PAIRS w2-gate-browser desktop4x (n=5, t(df=4)=3.72): score: Δ=1.0 σΔ=4.5 MDE(t)=7.5 MDE(z)=5.7 | fcp: Δ=-0.461s σΔ=0.106s MDE(t)=0.177s MDE(z)=0.133s | lcp: Δ=-0.404s σΔ=0.046s MDE(t)=0.077s MDE(z)=0.058s | tbt: Δ=23ms σΔ=74ms MDE(t)=124ms MDE(z)=93ms | si: Δ=-0.322s σΔ=0.079s MDE(t)=0.131s MDE(z)=0.099s | tti: Δ=-0.470s σΔ=0.224s MDE(t)=0.373s MDE(z)=0.281s
PAIRS w2-gate-browser desktop4x tryb FCP: -; pary mieszane 5/5
DELTA w2-gate-browser B-A desktop5x: score=+8 fcp=-0.47s lcp=-0.42s tbt=-199ms si=-0.21s cls=-0.002 ttfb=+1ms mainThreadMs=-1813ms bootupMs=-1093ms transferBytes=-89.6KB scriptTransferBytes=-61.3KB highPriorityBytesBeforeLcpImage=-508.1KB requests=-26
PAIRS w2-gate-browser desktop5x (n=5, t(df=4)=3.72): score: Δ=7.2 σΔ=7.5 MDE(t)=12.5 MDE(z)=9.4 | fcp: Δ=-0.476s σΔ=0.095s MDE(t)=0.157s MDE(z)=0.118s | lcp: Δ=-0.448s σΔ=0.083s MDE(t)=0.137s MDE(z)=0.104s | tbt: Δ=-124ms σΔ=193ms MDE(t)=320ms MDE(z)=241ms | si: Δ=-0.228s σΔ=0.111s MDE(t)=0.185s MDE(z)=0.139s | tti: Δ=-0.792s σΔ=0.276s MDE(t)=0.459s MDE(z)=0.346s
PAIRS w2-gate-browser desktop5x tryb FCP: -; pary mieszane 5/5
```

### Ramię bot (`--warm-ua bot`)

```
VALID w2-gate-bot A mobile: n_valid=5/5 excluded=0 wariant: s-maxage=900, 392234 B x5 trybFCP: pełny x5 po restarcie serwera: 1/5
MEDIAN w2-gate-bot A mobile: perf=69 FCP=4.12s LCP=4.88s TBT=177ms SI=4.12s CLS=0.000 TTFB=13ms TTI=5.88s mainThread=5286ms bootup=2847ms longTasks=15 req=99 transfer=1008.9KB js=705.9KB highBeforeLcpImg=620.8KB bench=2233 (n=5, TBT 116ms-273ms, perf 67-72)
VALID w2-gate-bot A desktop4x: n_valid=5/5 excluded=0 wariant: s-maxage=900, 392234 B x5 trybFCP: pełny x5 po restarcie serwera: 1/5
MEDIAN w2-gate-bot A desktop4x: perf=88 FCP=0.85s LCP=0.93s TBT=263ms SI=0.85s CLS=0.000 TTFB=8ms TTI=1.87s mainThread=4564ms bootup=2407ms longTasks=14 req=103 transfer=1010.2KB js=705.9KB highBeforeLcpImg=620.8KB bench=2371 (n=5, TBT 243ms-305ms, perf 85-89)
VALID w2-gate-bot A desktop5x: n_valid=5/5 excluded=0 wariant: s-maxage=900, 392234 B x5 trybFCP: pełny x5 po restarcie serwera: 2/5
MEDIAN w2-gate-bot A desktop5x: perf=76 FCP=0.88s LCP=0.97s TBT=496ms SI=0.92s CLS=0.000 TTFB=8ms TTI=2.32s mainThread=5621ms bootup=2852ms longTasks=20 req=99 transfer=1008.9KB js=705.9KB highBeforeLcpImg=620.8KB bench=2690 (n=5, TBT 429ms-729ms, perf 72-79)
VALID w2-gate-bot B mobile: n_valid=5/5 excluded=0 wariant: s-maxage=900, 330857 B x5 trybFCP: bez-js x5 po restarcie serwera: 1/5
MEDIAN w2-gate-bot B mobile: perf=97 FCP=1.54s LCP=2.31s TBT=83ms SI=1.63s CLS=0.000 TTFB=8ms TTI=5.49s mainThread=2743ms bootup=1233ms longTasks=9 req=71 transfer=914.8KB js=638.5KB highBeforeLcpImg=112.6KB bench=2367 (n=5, TBT 58ms-108ms, perf 97-97)
VALID w2-gate-bot B desktop4x: n_valid=5/5 excluded=0 wariant: s-maxage=900, 330857 B x5 trybFCP: bez-js x5 po restarcie serwera: 0/5
MEDIAN w2-gate-bot B desktop4x: perf=89 FCP=0.49s LCP=0.56s TBT=268ms SI=0.66s CLS=0.000 TTFB=7ms TTI=1.31s mainThread=2986ms bootup=1411ms longTasks=9 req=77 transfer=921.4KB js=644.6KB highBeforeLcpImg=112.6KB bench=2266 (n=5, TBT 186ms-301ms, perf 87-95)
VALID w2-gate-bot B desktop5x: n_valid=5/5 excluded=0 wariant: s-maxage=900, 330857 B x5 trybFCP: bez-js x5 po restarcie serwera: 1/5
MEDIAN w2-gate-bot B desktop5x: perf=84 FCP=0.40s LCP=0.55s TBT=358ms SI=0.63s CLS=0.000 TTFB=8ms TTI=1.39s mainThread=3764ms bootup=1884ms longTasks=13 req=77 transfer=921.4KB js=644.6KB highBeforeLcpImg=112.6KB bench=2394 (n=5, TBT 282ms-462ms, perf 80-89)
K mobile: TBT fixture=177ms PSI(mobile)=600ms k=3.40 (|k-1| > 0,2: przelicz cele fixture) [PSI 2026-10-03 18:58 CEST (hl=pl)] {client-backend=fixture,third-party=fake-gtag}
K desktop4x: TBT fixture=263ms PSI(desktop)=740ms k=2.82 (|k-1| > 0,2: przelicz cele fixture) [PSI 2026-10-03 18:58 CEST (hl=pl)] {client-backend=fixture,third-party=fake-gtag}
K desktop5x: TBT fixture=496ms PSI(desktop)=740ms k=1.49 (|k-1| > 0,2: przelicz cele fixture) [PSI 2026-10-03 18:58 CEST (hl=pl)] {client-backend=fixture,third-party=fake-gtag}
DELTA w2-gate-bot B-A mobile: score=+28 fcp=-2.58s lcp=-2.58s tbt=-94ms si=-2.49s cls=±0.000 ttfb=-5ms mainThreadMs=-2544ms bootupMs=-1614ms transferBytes=-94.2KB scriptTransferBytes=-67.3KB highPriorityBytesBeforeLcpImage=-508.1KB requests=-28
PAIRS w2-gate-bot mobile (n=5, t(df=4)=3.72): score: Δ=27.6 σΔ=1.8 MDE(t)=3.0 MDE(z)=2.3 | fcp: Δ=-2.551s σΔ=0.056s MDE(t)=0.093s MDE(z)=0.070s | lcp: Δ=-2.541s σΔ=0.069s MDE(t)=0.114s MDE(z)=0.086s | tbt: Δ=-102ms σΔ=74ms MDE(t)=124ms MDE(z)=93ms | si: Δ=-2.419s σΔ=0.141s MDE(t)=0.235s MDE(z)=0.177s | tti: Δ=-0.346s σΔ=0.230s MDE(t)=0.383s MDE(z)=0.288s
PAIRS w2-gate-bot mobile tryb FCP: -; pary mieszane 5/5
DELTA w2-gate-bot B-A desktop4x: score=+1 fcp=-0.36s lcp=-0.37s tbt=+6ms si=-0.19s cls=±0.000 ttfb=-1ms mainThreadMs=-1577ms bootupMs=-996ms transferBytes=-88.8KB scriptTransferBytes=-61.3KB highPriorityBytesBeforeLcpImage=-508.1KB requests=-26
PAIRS w2-gate-bot desktop4x (n=5, t(df=4)=3.72): score: Δ=3.0 σΔ=2.7 MDE(t)=4.6 MDE(z)=3.4 | fcp: Δ=-0.377s σΔ=0.051s MDE(t)=0.086s MDE(z)=0.064s | lcp: Δ=-0.383s σΔ=0.015s MDE(t)=0.025s MDE(z)=0.018s | tbt: Δ=-19ms σΔ=38ms MDE(t)=63ms MDE(z)=48ms | si: Δ=-0.219s σΔ=0.076s MDE(t)=0.127s MDE(z)=0.095s | tti: Δ=-0.583s σΔ=0.127s MDE(t)=0.211s MDE(z)=0.159s
PAIRS w2-gate-bot desktop4x tryb FCP: -; pary mieszane 5/5
DELTA w2-gate-bot B-A desktop5x: score=+8 fcp=-0.48s lcp=-0.42s tbt=-138ms si=-0.29s cls=±0.000 ttfb=±0ms mainThreadMs=-1857ms bootupMs=-968ms transferBytes=-87.6KB scriptTransferBytes=-61.3KB highPriorityBytesBeforeLcpImage=-508.1KB requests=-22
PAIRS w2-gate-bot desktop5x (n=5, t(df=4)=3.72): score: Δ=8.2 σΔ=5.1 MDE(t)=8.4 MDE(z)=6.3 | fcp: Δ=-0.462s σΔ=0.114s MDE(t)=0.190s MDE(z)=0.143s | lcp: Δ=-0.398s σΔ=0.051s MDE(t)=0.084s MDE(z)=0.064s | tbt: Δ=-166ms σΔ=159ms MDE(t)=263ms MDE(z)=198ms | si: Δ=-0.270s σΔ=0.099s MDE(t)=0.165s MDE(z)=0.124s | tti: Δ=-0.845s σΔ=0.174s MDE(t)=0.289s MDE(z)=0.218s
PAIRS w2-gate-bot desktop5x tryb FCP: -; pary mieszane 5/5
```

## 6. Tabele per przebieg

Źródło: `extract.py` → `tables.md` / `runs.json`. Kolumny: metryki LHR z `summary.json` (`records[].metrics`: perf, FCP, LCP, TBT, SI, CLS, TTI – wartości Lantern), `księga` = `records[].ledger.ledgerSum`, maks. pojedyncze przesunięcie i liczba przesunięć z audytu `layout-shifts` w LHR, obs. FCP / obs. LCP = `observedFirstContentfulPaint` / `observedLargestContentfulPaint` z audytu `metrics` w LHR, `scriptBytesEndedBeforeObsLcp` z `records[].ledger` (bajty, liczba skryptów, bajty wykluczone), restart = `rewarm.restores`, GET posts = liczba `GET /rest/v1/posts` w backendzie fixture, gtag = skrypty/pingi atrapy. Wiersze w kolejności `records` (numer przebiegu); przebiegi szły z przeplotem A,B / B,A.

### Ramię lh-browser (label `w2-gate-browser`, warm-ua `browser`)

#### browser A mobile: nValid 5/5, excludedAttempts 0, restored 1, warianty {'s-maxage=900, 400880 B': 5}, trybFCP {'pełny': 4, 'częściowy': 1}

| przebieg   | ważny | load | perf | FCP s | LCP s | TBT ms | księga ms | SI s | CLS    | maks. pojedyncze przes. (n) | TTI s | obs. FCP ms | obs. LCP ms | trybFCP   | scriptBytesEndedBeforeObsLcp B (n; wykl. B) | restart | GET posts | gtag skr./pingi | ParseHTML/Script:(dokument) ≥ 50 ms sym. w oknie FCP–TTI |
| ---------- | ----- | ---- | ---- | ----- | ----- | ------ | --------- | ---- | ------ | --------------------------- | ----- | ----------- | ----------- | --------- | ------------------------------------------- | ------- | --------- | --------------- | -------------------------------------------------------- |
| A-mobile-1 | tak   | 1.92 | 72   | 4.15  | 4.76  | 99.5   | 99.5      | 4.15 | 0.0000 | 0.0000 (0)                  | 5.71  | 329         | 329         | pełny     | 520692 (25; 0)                              | 0       | 0         | 0/1             | 0                                                        |
| A-mobile-2 | tak   | 1.53 | 72   | 4.01  | 4.78  | 114.5  | 114.5     | 4.01 | 0.0000 | 0.0000 (0)                  | 5.86  | 247         | 247         | pełny     | 520692 (25; 0)                              | 0       | 0         | 0/1             | 0                                                        |
| A-mobile-3 | tak   | 1.67 | 71   | 4.19  | 4.81  | 135.5  | 135.5     | 4.19 | 0.0000 | 0.0000 (0)                  | 5.78  | 324         | 324         | pełny     | 520692 (25; 0)                              | 0       | 4         | 0/1             | 0                                                        |
| A-mobile-4 | tak   | 1.74 | 77   | 1.83  | 5.00  | 206.0  | 206.0     | 1.83 | 0.0000 | 0.0000 (0)                  | 5.71  | 167         | 255         | częściowy | 520692 (25; 0)                              | 1       | 0         | 0/1             | ParseHTML sym 2278+105 blok 55                           |
| A-mobile-5 | tak   | 1.52 | 52   | 4.10  | 5.02  | 108.0  | 108.0     | 4.10 | 0.4014 | 0.4014 (1)                  | 5.80  | 218         | 262         | pełny     | 520692 (25; 0)                              | 0       | 0         | 0/1             | 0                                                        |

#### browser B mobile: nValid 5/5, excludedAttempts 0, restored 1, warianty {'s-maxage=900, 337912 B': 5}, trybFCP {'bez-js': 5}

| przebieg   | ważny | load | perf | FCP s | LCP s | TBT ms | księga ms | SI s | CLS    | maks. pojedyncze przes. (n) | TTI s | obs. FCP ms | obs. LCP ms | trybFCP | scriptBytesEndedBeforeObsLcp B (n; wykl. B) | restart | GET posts | gtag skr./pingi | ParseHTML/Script:(dokument) ≥ 50 ms sym. w oknie FCP–TTI |
| ---------- | ----- | ---- | ---- | ----- | ----- | ------ | --------- | ---- | ------ | --------------------------- | ----- | ----------- | ----------- | ------- | ------------------------------------------- | ------- | --------- | --------------- | -------------------------------------------------------- |
| B-mobile-1 | tak   | 1.98 | 98   | 1.53  | 2.28  | 35.5   | 35.5      | 1.53 | 0.0000 | 0.0000 (0)                  | 5.46  | 220         | 220         | bez-js  | 0 (0; 0)                                    | 0       | 0         | 1/6             | 0                                                        |
| B-mobile-2 | tak   | 1.85 | 98   | 1.54  | 2.30  | 28.0   | 28.0      | 1.54 | 0.0000 | 0.0000 (0)                  | 5.52  | 169         | 169         | bez-js  | 0 (0; 0)                                    | 0       | 0         | 1/6             | 0                                                        |
| B-mobile-3 | tak   | 1.71 | 97   | 1.60  | 2.45  | 40.8   | 40.8      | 1.60 | 0.0000 | 0.0000 (0)                  | 5.51  | 187         | 187         | bez-js  | 0 (0; 0)                                    | 0       | 8         | 0/1             | ParseHTML sym 2452+62 blok 12                            |
| B-mobile-4 | tak   | 1.44 | 98   | 1.55  | 2.33  | 55.5   | 55.5      | 1.55 | 0.0000 | 0.0000 (0)                  | 5.37  | 118         | 213         | bez-js  | 0 (0; 0)                                    | 0       | 8         | 1/5             | 0                                                        |
| B-mobile-5 | tak   | 1.37 | 98   | 1.57  | 2.36  | 55.0   | 55.0      | 1.57 | 0.0000 | 0.0000 (0)                  | 5.14  | 185         | 185         | bez-js  | 0 (0; 0)                                    | 1       | 0         | 0/1             | 0                                                        |

#### browser A desktop4x: nValid 5/5, excludedAttempts 0, restored 1, warianty {'s-maxage=900, 400880 B': 5}, trybFCP {'pełny': 5}

| przebieg      | ważny | load | perf | FCP s | LCP s | TBT ms | księga ms | SI s | CLS    | maks. pojedyncze przes. (n) | TTI s | obs. FCP ms | obs. LCP ms | trybFCP | scriptBytesEndedBeforeObsLcp B (n; wykl. B) | restart | GET posts | gtag skr./pingi | ParseHTML/Script:(dokument) ≥ 50 ms sym. w oknie FCP–TTI |
| ------------- | ----- | ---- | ---- | ----- | ----- | ------ | --------- | ---- | ------ | --------------------------- | ----- | ----------- | ----------- | ------- | ------------------------------------------- | ------- | --------- | --------------- | -------------------------------------------------------- |
| A-desktop4x-1 | tak   | 1.22 | 96   | 0.83  | 0.92  | 132.3  | 132.3     | 0.83 | 0.0000 | 0.0000 (0)                  | 1.75  | 333         | 333         | pełny   | 520692 (25; 0)                              | 0       | 0         | 0/1             | 0                                                        |
| A-desktop4x-2 | tak   | 1.66 | 83   | 0.81  | 0.92  | 351.5  | 351.5     | 0.84 | 0.0000 | 0.0000 (0)                  | 2.06  | 395         | 395         | pełny   | 520692 (25; 0)                              | 0       | 8         | 0/1             | 0                                                        |
| A-desktop4x-3 | tak   | 1.57 | 93   | 1.02  | 1.02  | 160.0  | 160.0     | 1.02 | 0.0061 | 0.0061 (1)                  | 1.74  | 298         | 298         | pełny   | 520692 (25; 0)                              | 1       | 0         | 0/1             | 0                                                        |
| A-desktop4x-4 | tak   | 1.07 | 95   | 0.87  | 0.97  | 149.5  | 149.5     | 0.87 | 0.0000 | 0.0000 (0)                  | 1.85  | 450         | 450         | pełny   | 520692 (25; 0)                              | 0       | 0         | 0/1             | 0                                                        |
| A-desktop4x-5 | tak   | 1.19 | 95   | 0.85  | 0.93  | 156.6  | 156.6     | 0.85 | 0.0000 | 0.0000 (0)                  | 1.53  | 260         | 260         | pełny   | 520692 (25; 0)                              | 0       | 0         | 0/1             | ParseHTML sym 839+81 blok 20                             |

#### browser B desktop4x: nValid 5/5, excludedAttempts 0, restored 1, warianty {'s-maxage=900, 337912 B': 5}, trybFCP {'bez-js': 5}

| przebieg      | ważny | load | perf | FCP s | LCP s | TBT ms | księga ms | SI s | CLS    | maks. pojedyncze przes. (n) | TTI s | obs. FCP ms | obs. LCP ms | trybFCP | scriptBytesEndedBeforeObsLcp B (n; wykl. B) | restart | GET posts | gtag skr./pingi | ParseHTML/Script:(dokument) ≥ 50 ms sym. w oknie FCP–TTI           |
| ------------- | ----- | ---- | ---- | ----- | ----- | ------ | --------- | ---- | ------ | --------------------------- | ----- | ----------- | ----------- | ------- | ------------------------------------------- | ------- | --------- | --------------- | ------------------------------------------------------------------ |
| B-desktop4x-1 | tak   | 1.16 | 93   | 0.49  | 0.55  | 216.0  | 216.0     | 0.57 | 0.0000 | 0.0000 (0)                  | 1.18  | 290         | 290         | bez-js  | 0 (0; 0)                                    | 0       | 0         | 0/1             | ParseHTML sym 640+67 blok 17; Script:(dokument) sym 383+120 blok 0 |
| B-desktop4x-2 | tak   | 1.64 | 91   | 0.40  | 0.55  | 249.5  | 249.5     | 0.55 | 0.0000 | 0.0000 (0)                  | 1.25  | 241         | 241         | bez-js  | 0 (0; 0)                                    | 0       | 0         | 0/1             | Script:(dokument) sym 543+69 blok 19                               |
| B-desktop4x-3 | tak   | 1.42 | 96   | 0.40  | 0.55  | 174.5  | 174.5     | 0.56 | 0.0000 | 0.0000 (0)                  | 1.32  | 135         | 262         | bez-js  | 0 (0; 0)                                    | 0       | 8         | 0/1             | Script:(dokument) sym 511+87 blok 37                               |
| B-desktop4x-4 | tak   | 1.2  | 94   | 0.40  | 0.55  | 203.5  | 203.5     | 0.56 | 0.0000 | 0.0000 (0)                  | 1.60  | 131         | 261         | bez-js  | 0 (0; 0)                                    | 0       | 8         | 1/6             | Script:(dokument) sym 545+62 blok 12                               |
| B-desktop4x-5 | tak   | 1.27 | 93   | 0.39  | 0.54  | 222.5  | 222.5     | 0.57 | 0.0000 | 0.0000 (0)                  | 1.22  | 140         | 283         | bez-js  | 0 (0; 0)                                    | 1       | 0         | 0/1             | Script:(dokument) sym 579+78 blok 28                               |

#### browser A desktop5x: nValid 5/5, excludedAttempts 0, restored 1, warianty {'s-maxage=900, 400880 B': 5}, trybFCP {'pełny': 5}

| przebieg      | ważny | load | perf | FCP s | LCP s | TBT ms | księga ms | SI s | CLS    | maks. pojedyncze przes. (n) | TTI s | obs. FCP ms | obs. LCP ms | trybFCP | scriptBytesEndedBeforeObsLcp B (n; wykl. B) | restart | GET posts | gtag skr./pingi | ParseHTML/Script:(dokument) ≥ 50 ms sym. w oknie FCP–TTI    |
| ------------- | ----- | ---- | ---- | ----- | ----- | ------ | --------- | ---- | ------ | --------------------------- | ----- | ----------- | ----------- | ------- | ------------------------------------------- | ------- | --------- | --------------- | ----------------------------------------------------------- |
| A-desktop5x-1 | tak   | 1.13 | 73   | 0.88  | 0.97  | 654.3  | 654.3     | 0.94 | 0.0000 | 0.0000 (0)                  | 2.54  | 328         | 328         | pełny   | 520692 (25; 0)                              | 0       | 8         | 0/0             | 0                                                           |
| A-desktop5x-2 | tak   | 1.77 | 78   | 0.94  | 0.96  | 442.2  | 442.2     | 0.94 | 0.0113 | 0.0113 (1)                  | 2.24  | 323         | 323         | pełny   | 520692 (25; 0)                              | 1       | 0         | 0/1             | ParseHTML sym 773+226 blok 10; ParseHTML sym 1168+53 blok 3 |
| A-desktop5x-3 | tak   | 1.39 | 74   | 0.81  | 0.94  | 606.0  | 606.0     | 0.85 | 0.0061 | 0.0061 (1)                  | 2.35  | 338         | 338         | pełny   | 520692 (25; 0)                              | 0       | 0         | 0/1             | ParseHTML sym 776+56 blok 0                                 |
| A-desktop5x-4 | tak   | 1.41 | 70   | 1.08  | 1.14  | 679.0  | 679.0     | 1.08 | 0.0000 | 0.0000 (0)                  | 2.68  | 394         | 394         | pełny   | 520692 (25; 0)                              | 0       | 0         | 0/1             | ParseHTML sym 1068+78 blok 21                               |
| A-desktop5x-5 | tak   | 1.43 | 78   | 0.91  | 1.00  | 448.0  | 448.0     | 0.91 | 0.0016 | 0.0016 (1)                  | 2.24  | 311         | 311         | pełny   | 520692 (25; 0)                              | 0       | 0         | 0/0             | ParseHTML sym 1002+51 blok 1                                |

#### browser B desktop5x: nValid 5/5, excludedAttempts 0, restored 1, warianty {'s-maxage=900, 337912 B': 5}, trybFCP {'bez-js': 5}

| przebieg      | ważny | load | perf | FCP s | LCP s | TBT ms | księga ms | SI s | CLS    | maks. pojedyncze przes. (n) | TTI s | obs. FCP ms | obs. LCP ms | trybFCP | scriptBytesEndedBeforeObsLcp B (n; wykl. B) | restart | GET posts | gtag skr./pingi | ParseHTML/Script:(dokument) ≥ 50 ms sym. w oknie FCP–TTI                                                                     |
| ------------- | ----- | ---- | ---- | ----- | ----- | ------ | --------- | ---- | ------ | --------------------------- | ----- | ----------- | ----------- | ------- | ------------------------------------------- | ------- | --------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| B-desktop5x-1 | tak   | 1    | 74   | 0.42  | 0.53  | 692.5  | 692.5     | 0.76 | 0.0000 | 0.0000 (0)                  | 1.96  | 238         | 238         | bez-js  | 0 (0; 0)                                    | 0       | 0         | 0/0             | ParseHTML sym 446+109 blok 59; ParseHTML sym 555+82 blok 32; ParseHTML sym 739+50 blok 0                                     |
| B-desktop5x-2 | tak   | 1.84 | 82   | 0.49  | 0.58  | 407.0  | 407.0     | 0.73 | 0.0000 | 0.0000 (0)                  | 1.51  | 251         | 251         | bez-js  | 0 (0; 0)                                    | 0       | 0         | 1/5             | ParseHTML sym 543+86 blok 36; ParseHTML sym 629+68 blok 18; ParseHTML sym 842+52 blok 2                                      |
| B-desktop5x-3 | tak   | 1.96 | 86   | 0.44  | 0.55  | 338.5  | 338.5     | 0.69 | 0.0000 | 0.0000 (0)                  | 1.56  | 213         | 213         | bez-js  | 0 (0; 0)                                    | 0       | 8         | 1/6             | ParseHTML sym 511+60 blok 10; ParseHTML sym 571+51 blok 1; ParseHTML sym 724+51 blok 1                                       |
| B-desktop5x-4 | tak   | 1.6  | 88   | 0.45  | 0.55  | 292.5  | 292.5     | 0.65 | 0.0000 | 0.0000 (0)                  | 1.42  | 247         | 247         | bez-js  | 0 (0; 0)                                    | 1       | 0         | 0/0             | ParseHTML sym 517+54 blok 4; ParseHTML sym 571+66 blok 16; ParseHTML sym 739+60 blok 10                                      |
| B-desktop5x-5 | tak   | 1.23 | 79   | 0.42  | 0.57  | 481.5  | 481.5     | 0.75 | 0.0000 | 0.0000 (0)                  | 1.64  | 302         | 302         | bez-js  | 0 (0; 0)                                    | 0       | 0         | 0/1             | ParseHTML sym 553+53 blok 3; ParseHTML sym 613+54 blok 4; ParseHTML sym 667+52 blok 2; Script:(dokument) sym 719+116 blok 66 |

### Ramię lh-bot (label `w2-gate-bot`, warm-ua `bot`)

#### bot A mobile: nValid 5/5, excludedAttempts 0, restored 1, warianty {'s-maxage=900, 392234 B': 5}, trybFCP {'pełny': 5}

| przebieg   | ważny | load | perf | FCP s | LCP s | TBT ms | księga ms | SI s | CLS    | maks. pojedyncze przes. (n) | TTI s | obs. FCP ms | obs. LCP ms | trybFCP | scriptBytesEndedBeforeObsLcp B (n; wykl. B) | restart | GET posts | gtag skr./pingi | ParseHTML/Script:(dokument) ≥ 50 ms sym. w oknie FCP–TTI |
| ---------- | ----- | ---- | ---- | ----- | ----- | ------ | --------- | ---- | ------ | --------------------------- | ----- | ----------- | ----------- | ------- | ------------------------------------------- | ------- | --------- | --------------- | -------------------------------------------------------- |
| A-mobile-1 | tak   | 0.74 | 70   | 4.11  | 4.86  | 159.1  | 159.1     | 4.11 | 0.0000 | 0.0000 (0)                  | 5.66  | 351         | 351         | pełny   | 520692 (25; 0)                              | 0       | 0         | 0/1             | 0                                                        |
| A-mobile-2 | tak   | 1.29 | 69   | 4.13  | 4.90  | 191.2  | 191.2     | 4.13 | 0.0000 | 0.0000 (0)                  | 5.93  | 264         | 264         | pełny   | 520692 (25; 0)                              | 0       | 0         | 0/1             | 0                                                        |
| A-mobile-3 | tak   | 1.29 | 72   | 4.03  | 4.80  | 116.0  | 116.0     | 4.03 | 0.0000 | 0.0000 (0)                  | 5.90  | 316         | 316         | pełny   | 520692 (25; 0)                              | 0       | 0         | 0/1             | 0                                                        |
| A-mobile-4 | tak   | 1.55 | 67   | 4.12  | 4.88  | 273.1  | 273.1     | 4.12 | 0.0006 | 0.0006 (1)                  | 5.69  | 284         | 284         | pełny   | 520692 (25; 0)                              | 1       | 0         | 0/1             | 0                                                        |
| A-mobile-5 | tak   | 1.36 | 69   | 4.14  | 4.90  | 176.5  | 176.5     | 4.14 | 0.0000 | 0.0000 (0)                  | 5.88  | 350         | 350         | pełny   | 520692 (25; 0)                              | 0       | 0         | 0/0             | 0                                                        |

#### bot B mobile: nValid 5/5, excludedAttempts 0, restored 1, warianty {'s-maxage=900, 330857 B': 5}, trybFCP {'bez-js': 5}

| przebieg   | ważny | load | perf | FCP s | LCP s | TBT ms | księga ms | SI s | CLS    | maks. pojedyncze przes. (n) | TTI s | obs. FCP ms | obs. LCP ms | trybFCP | scriptBytesEndedBeforeObsLcp B (n; wykl. B) | restart | GET posts | gtag skr./pingi | ParseHTML/Script:(dokument) ≥ 50 ms sym. w oknie FCP–TTI |
| ---------- | ----- | ---- | ---- | ----- | ----- | ------ | --------- | ---- | ------ | --------------------------- | ----- | ----------- | ----------- | ------- | ------------------------------------------- | ------- | --------- | --------------- | -------------------------------------------------------- |
| B-mobile-1 | tak   | 1.37 | 97   | 1.53  | 2.29  | 69.5   | 69.5      | 1.57 | 0.0000 | 0.0000 (0)                  | 5.49  | 229         | 229         | bez-js  | 0 (0; 0)                                    | 0       | 0         | 1/5             | 0                                                        |
| B-mobile-2 | tak   | 1.18 | 97   | 1.56  | 2.33  | 83.0   | 83.0      | 1.61 | 0.0000 | 0.0000 (0)                  | 5.28  | 220         | 220         | bez-js  | 0 (0; 0)                                    | 0       | 0         | 0/1             | 0                                                        |
| B-mobile-3 | tak   | 1.41 | 97   | 1.54  | 2.31  | 108.4  | 108.4     | 1.79 | 0.0000 | 0.0000 (0)                  | 5.45  | 190         | 190         | bez-js  | 0 (0; 0)                                    | 0       | 4         | 0/1             | 0                                                        |
| B-mobile-4 | tak   | 1.77 | 97   | 1.62  | 2.44  | 58.0   | 58.0      | 1.82 | 0.0000 | 0.0000 (0)                  | 5.62  | 207         | 207         | bez-js  | 0 (0; 0)                                    | 0       | 8         | 1/6             | ParseHTML sym 2436+94 blok 44                            |
| B-mobile-5 | tak   | 1.02 | 97   | 1.52  | 2.28  | 88.0   | 88.0      | 1.63 | 0.0000 | 0.0000 (0)                  | 5.49  | 198         | 198         | bez-js  | 0 (0; 0)                                    | 1       | 0         | 0/1             | 0                                                        |

#### bot A desktop4x: nValid 5/5, excludedAttempts 0, restored 1, warianty {'s-maxage=900, 392234 B': 5}, trybFCP {'pełny': 5}

| przebieg      | ważny | load | perf | FCP s | LCP s | TBT ms | księga ms | SI s | CLS    | maks. pojedyncze przes. (n) | TTI s | obs. FCP ms | obs. LCP ms | trybFCP | scriptBytesEndedBeforeObsLcp B (n; wykl. B) | restart | GET posts | gtag skr./pingi | ParseHTML/Script:(dokument) ≥ 50 ms sym. w oknie FCP–TTI |
| ------------- | ----- | ---- | ---- | ----- | ----- | ------ | --------- | ---- | ------ | --------------------------- | ----- | ----------- | ----------- | ------- | ------------------------------------------- | ------- | --------- | --------------- | -------------------------------------------------------- |
| A-desktop4x-1 | tak   | 0.82 | 88   | 0.85  | 0.93  | 261.0  | 261.0     | 0.85 | 0.0000 | 0.0000 (0)                  | 1.84  | 454         | 454         | pełny   | 520692 (25; 0)                              | 0       | 0         | 0/1             | 0                                                        |
| A-desktop4x-2 | tak   | 1.11 | 85   | 0.98  | 0.99  | 305.2  | 305.2     | 0.98 | 0.0000 | 0.0000 (0)                  | 2.06  | 369         | 369         | pełny   | 520692 (25; 0)                              | 0       | 8         | 0/1             | 0                                                        |
| A-desktop4x-3 | tak   | 1    | 86   | 0.81  | 0.92  | 300.5  | 300.5     | 0.81 | 0.0000 | 0.0000 (0)                  | 1.82  | 311         | 311         | pełny   | 520692 (25; 0)                              | 1       | 0         | 0/0             | ParseHTML sym 840+56 blok 6                              |
| A-desktop4x-4 | tak   | 0.77 | 89   | 0.85  | 0.95  | 242.8  | 242.8     | 0.85 | 0.0000 | 0.0000 (0)                  | 1.88  | 369         | 369         | pełny   | 520692 (25; 0)                              | 0       | 0         | 0/1             | 0                                                        |
| A-desktop4x-5 | tak   | 1.29 | 88   | 0.89  | 0.93  | 262.5  | 262.5     | 0.89 | 0.0000 | 0.0000 (0)                  | 1.87  | 319         | 319         | pełny   | 520692 (25; 0)                              | 0       | 0         | 0/1             | 0                                                        |

#### bot B desktop4x: nValid 5/5, excludedAttempts 0, restored 0, warianty {'s-maxage=900, 330857 B': 5}, trybFCP {'bez-js': 5}

| przebieg      | ważny | load | perf | FCP s | LCP s | TBT ms | księga ms | SI s | CLS    | maks. pojedyncze przes. (n) | TTI s | obs. FCP ms | obs. LCP ms | trybFCP | scriptBytesEndedBeforeObsLcp B (n; wykl. B) | restart | GET posts | gtag skr./pingi | ParseHTML/Script:(dokument) ≥ 50 ms sym. w oknie FCP–TTI                               |
| ------------- | ----- | ---- | ---- | ----- | ----- | ------ | --------- | ---- | ------ | --------------------------- | ----- | ----------- | ----------- | ------- | ------------------------------------------- | ------- | --------- | --------------- | -------------------------------------------------------------------------------------- |
| B-desktop4x-1 | tak   | 1.17 | 95   | 0.44  | 0.56  | 185.5  | 185.5     | 0.63 | 0.0000 | 0.0000 (0)                  | 1.28  | 233         | 233         | bez-js  | 0 (0; 0)                                    | 0       | 0         | 0/1             | 0                                                                                      |
| B-desktop4x-2 | tak   | 1.12 | 89   | 0.57  | 0.59  | 272.0  | 272.0     | 0.66 | 0.0000 | 0.0000 (0)                  | 1.31  | 250         | 250         | bez-js  | 0 (0; 0)                                    | 0       | 0         | 1/6             | ParseHTML sym 511+82 blok 0                                                            |
| B-desktop4x-3 | tak   | 0.94 | 87   | 0.45  | 0.53  | 301.5  | 301.5     | 0.66 | 0.0000 | 0.0000 (0)                  | 1.40  | 238         | 238         | bez-js  | 0 (0; 0)                                    | 0       | 8         | 0/1             | ParseHTML sym 449+61 blok 6; ParseHTML sym 510+56 blok 6; ParseHTML sym 684+72 blok 22 |
| B-desktop4x-4 | tak   | 0.78 | 89   | 0.55  | 0.58  | 268.0  | 268.0     | 0.70 | 0.0000 | 0.0000 (0)                  | 1.36  | 283         | 283         | bez-js  | 0 (0; 0)                                    | 0       | 0         | 0/1             | ParseHTML sym 544+95 blok 37; ParseHTML sym 818+55 blok 5                              |
| B-desktop4x-5 | tak   | 1.13 | 91   | 0.49  | 0.56  | 250.5  | 250.5     | 0.63 | 0.0000 | 0.0000 (0)                  | 1.21  | 233         | 233         | bez-js  | 0 (0; 0)                                    | 0       | 0         | 1/6             | 0                                                                                      |

#### bot A desktop5x: nValid 5/5, excludedAttempts 0, restored 2, warianty {'s-maxage=900, 392234 B': 5}, trybFCP {'pełny': 5}

| przebieg      | ważny | load | perf | FCP s | LCP s | TBT ms | księga ms | SI s | CLS    | maks. pojedyncze przes. (n) | TTI s | obs. FCP ms | obs. LCP ms | trybFCP | scriptBytesEndedBeforeObsLcp B (n; wykl. B) | restart | GET posts | gtag skr./pingi | ParseHTML/Script:(dokument) ≥ 50 ms sym. w oknie FCP–TTI  |
| ------------- | ----- | ---- | ---- | ----- | ----- | ------ | --------- | ---- | ------ | --------------------------- | ----- | ----------- | ----------- | ------- | ------------------------------------------- | ------- | --------- | --------------- | --------------------------------------------------------- |
| A-desktop5x-1 | tak   | 1.28 | 72   | 0.86  | 0.97  | 728.5  | 728.5     | 0.92 | 0.0000 | 0.0000 (0)                  | 2.41  | 361         | 361         | pełny   | 520692 (25; 0)                              | 1       | 0         | 0/1             | ParseHTML sym 807+72 blok 0; ParseHTML sym 879+79 blok 29 |
| A-desktop5x-2 | tak   | 1.37 | 76   | 0.99  | 0.99  | 496.0  | 496.0     | 0.99 | 0.0000 | 0.0000 (0)                  | 2.32  | 324         | 324         | pełny   | 520692 (25; 0)                              | 0       | 0         | 1/6             | ParseHTML sym 967+69 blok 0                               |
| A-desktop5x-3 | tak   | 1.25 | 79   | 0.78  | 0.89  | 448.4  | 448.4     | 0.78 | 0.0000 | 0.0000 (0)                  | 2.00  | 332         | 332         | pełny   | 520692 (25; 0)                              | 0       | 0         | 1/6             | ParseHTML sym 889+52 blok 2                               |
| A-desktop5x-4 | tak   | 1.31 | 78   | 0.97  | 1.00  | 429.3  | 429.3     | 0.97 | 0.0000 | 0.0000 (0)                  | 2.18  | 262         | 334         | pełny   | 520692 (25; 0)                              | 1       | 0         | 0/1             | 0                                                         |
| A-desktop5x-5 | tak   | 1.51 | 74   | 0.88  | 0.92  | 592.0  | 592.0     | 0.88 | 0.0000 | 0.0000 (0)                  | 2.34  | 352         | 352         | pełny   | 520692 (25; 0)                              | 0       | 0         | 0/1             | ParseHTML sym 823+64 blok 0; ParseHTML sym 887+79 blok 29 |

#### bot B desktop5x: nValid 5/5, excludedAttempts 0, restored 1, warianty {'s-maxage=900, 330857 B': 5}, trybFCP {'bez-js': 5}

| przebieg      | ważny | load | perf | FCP s | LCP s | TBT ms | księga ms | SI s | CLS    | maks. pojedyncze przes. (n) | TTI s | obs. FCP ms | obs. LCP ms | trybFCP | scriptBytesEndedBeforeObsLcp B (n; wykl. B) | restart | GET posts | gtag skr./pingi | ParseHTML/Script:(dokument) ≥ 50 ms sym. w oknie FCP–TTI                                          |
| ------------- | ----- | ---- | ---- | ----- | ----- | ------ | --------- | ---- | ------ | --------------------------- | ----- | ----------- | ----------- | ------- | ------------------------------------------- | ------- | --------- | --------------- | ------------------------------------------------------------------------------------------------- |
| B-desktop5x-1 | tak   | 1.17 | 89   | 0.39  | 0.55  | 282.4  | 282.4     | 0.59 | 0.0000 | 0.0000 (0)                  | 1.34  | 140         | 247         | bez-js  | 0 (0; 0)                                    | 0       | 8         | 1/6             | ParseHTML sym 447+51 blok 1; ParseHTML sym 515+68 blok 18; Script:(dokument) sym 583+126 blok 76  |
| B-desktop5x-2 | tak   | 0.98 | 81   | 0.50  | 0.56  | 431.5  | 431.5     | 0.68 | 0.0000 | 0.0000 (0)                  | 1.54  | 232         | 232         | bez-js  | 0 (0; 0)                                    | 0       | 8         | 0/1             | ParseHTML sym 481+68 blok 0; ParseHTML sym 549+51 blok 1                                          |
| B-desktop5x-3 | tak   | 1.23 | 84   | 0.51  | 0.57  | 358.1  | 358.1     | 0.68 | 0.0000 | 0.0000 (0)                  | 1.39  | 248         | 248         | bez-js  | 0 (0; 0)                                    | 1       | 0         | 0/1             | ParseHTML sym 476+51 blok 0; ParseHTML sym 527+51 blok 1; ParseHTML sym 748+63 blok 13            |
| B-desktop5x-4 | tak   | 1.26 | 86   | 0.40  | 0.55  | 332.0  | 332.0     | 0.62 | 0.0000 | 0.0000 (0)                  | 1.31  | 131         | 249         | bez-js  | 0 (0; 0)                                    | 0       | 0         | 0/1             | ParseHTML sym 491+51 blok 1; ParseHTML sym 557+73 blok 23; Script:(dokument) sym 630+138 blok 88  |
| B-desktop5x-5 | tak   | 1.35 | 80   | 0.38  | 0.54  | 461.8  | 461.8     | 0.63 | 0.0000 | 0.0000 (0)                  | 1.44  | 266         | 266         | bez-js  | 0 (0; 0)                                    | 0       | 0         | 0/1             | ParseHTML sym 450+51 blok 1; ParseHTML sym 506+75 blok 25; Script:(dokument) sym 581+153 blok 103 |

## 7. Rzeczy nietypowe (bez interpretacji)

Źródła: `runs.json` (z `summary.json`, LHR i ksiąg), `lh-*.log`.

1. **Obciążenie i szybkość hosta.** Pomiar ruszył zaraz po pełnym vitescie (loadavg 1/5/15 min o 07:35:35 UTC: 2,51 / 4,42 / 4,52); load w przebiegach browser 1,00–1,98, bot 0,74–1,77. benchmarkIndex atrapy gtag: browser 2240 (próbki 2299 / 2240 / 2209,5, skala ×1,65), bot 2126 (2201,5 / 2025,5 / 2126, skala ×1,74). Dla porównania bramka fali 1 miała benchmarkIndex 1298 i 1458 (skale ×2,85 i ×2,54, POMIAR §8.3), czyli wyższy benchmarkIndex hosta niż w bramce fali 1; strony A i B szły z przeplotem w tych samych warunkach.
2. **`NO_NAVSTART`** ×2 (browser A-mobile-1, bot B-desktop4x-4), powtórzone przez harness.
3. **Restarty serwera** po rozgrzewce: 6 przebiegów na ramię (lista w §3).
4. **Reżim refetchu postów klienta** (`backend.byPath["GET /rest/v1/posts"]` w `summary.json`): browser A-mobile-3 (4), A-desktop4x-2 (8), A-desktop5x-1 (8), B-mobile-3 (8), B-mobile-4 (8), B-desktop4x-3 (8), B-desktop4x-4 (8), B-desktop5x-3 (8), czyli A 3/15, B 5/15; bot A-desktop4x-2 (8), B-mobile-3 (4), B-mobile-4 (8), B-desktop4x-3 (8), B-desktop5x-1 (8), B-desktop5x-2 (8), czyli A 1/15, B 5/15. Harness tego nie balansuje.
5. **CLS ≠ 0** (wartość = jedyne przesunięcie z audytu `layout-shifts`): browser A-mobile-5 **0,4014** (jedno przesunięcie, węzeł `div[data-column-slot] … data-col-id="…001b"` w `main > … > section`, obs. LCP 262 ms), A-desktop4x-3 0,0061, A-desktop5x-2 0,0113, A-desktop5x-3 0,0061, A-desktop5x-5 0,0016; bot A-mobile-4 0,0006. Po stronie B CLS = 0,000 i 0 przesunięć w 30/30 przebiegów (oba ramiona).
6. **Tryb FCP A-mobile-4 (browser)** „częściowy” (5 skr. / 47,7 KB): FCP Lantern 1,83 s wobec 4,01–4,19 s w pozostałych przebiegach A mobile tego ramienia; LCP 5,00 s.
7. **scriptBytesEndedBeforeObsLcp** (`records[].ledger.scriptBytesEndedBeforeObsLcp`): B = 0 B (0 skryptów, wykluczone 0 B) w 30/30 przebiegów obu ramion; A = 520 692 B (25 skryptów, wykluczone 0) w 30/30. Linie `LEDGER` drukują to jako `skrypty<obsLCP=0.0 KB` / `508.5 KB`. Żaden przebieg nie miał wykluczeń (`excludedUrls` puste), więc `/~flock.js` nie wystąpił jako skrypt przed obs. LCP.
8. **Kolumna „ParseHTML/Script:(dokument) ≥ 50 ms sym. w oknie FCP–TTI”** to surowa ekstrakcja z `*.ledger.txt` (nie werdykt): wiersze klasy `ParseHTML` (klasa dominująca w księdze) lub `Script:(dokument)` (skrypt o URL-u dokumentu, czyli inline; `shortScriptName` w `lanternTasks.ts`) z `simDur` ≥ 50 ms, których przedział [simStart, simStart+simDur] (symulacja pesymistyczna, `lanternTasks.ts` bierze `p ?? o`) zachodzi na [min(FCPsim opt, pes), max(TTIsim opt, pes)] z nagłówka księgi; „blok” = blocking avg z księgi. Księga drukuje każde zadanie z blokowaniem ≥ 1 ms lub `simDur` ≥ 50 ms (`formatLedger`), więc lista jest pełna dla tego progu. Wystąpienia: browser A 6 przebiegów z 15 (blok do 55 ms), B 11 z 15 (blok do 66 ms, w tym `Script:(dokument)` w B-desktop4x-1…5 i B-desktop5x-5); bot A 5 z 15 (blok do 29 ms), B 9 z 15 (blok do 103 ms, w tym `Script:(dokument)` w B-desktop5x-1, -4, -5). Dla B mobile: browser B-mobile-3 (ParseHTML sym 2452+62, blok 12), bot B-mobile-4 (ParseHTML sym 2436+94, blok 44).
9. **gtag** (`records[].gtag`, skrypty/pingi atrapy): browser A 0 skryptów i 0–1 ping, browser B 0–1 skrypt i 0–6 pingów; bot A 0–1 skrypt i 0–6 pingów, bot B 0–1 skrypt i 1–6 pingów. Księga ma `google=0` zadań w 60/60 przebiegów (podobnie jak w W1, POMIAR §8.3: żądania atrapy poza oknem nagrania albo bez kosztu CPU w śladzie).
10. **Linie `K`** w trybie A/B liczą k z mediany strony A (W1); to nie jest kalibracja (prognozy według POMIAR §7: k mobile 0,72, desktop4x 0,42).
11. **Waga dokumentu** – oba drzewa w swoich progach (`✓ Waga dokumentu w progach`), szczegóły w §8.

## 8. Waga dokumentu (`document-weight-{A,B}.{json,log}`, 5 próbek HIT)

| metryka (mediana)                                      | A (`78356a7a`) | B (`ca34249c`)    | próg A / B (z logu każdego drzewa) |
| ------------------------------------------------------ | -------------- | ----------------- | ---------------------------------- |
| htmlRawBytes                                           | 391,5 KB       | 330,0 KB          | 396,7 / 396,7 KB                   |
| htmlGzipBytes                                          | 55,5 KB        | 51,4 KB           | 56,4 / 56,4 KB                     |
| headRawBytes                                           | 25,3 KB        | 28,3 KB           | 26,0 / 28,7 KB                     |
| inlineStyleCount                                       | 50             | 25                | 50 / 50                            |
| inlineStyleBytes                                       | 129,9 KB       | 82,7 KB           | 132,4 / 132,4 KB                   |
| inlineScriptBytes                                      | 94,0 KB        | 84,8 KB           | 95,8 / 95,8 KB                     |
| inlineExecutableScriptBytes                            | 87,9 KB        | 77,7 KB           | 89,6 / 89,6 KB                     |
| dehydratedStateBytes                                   | 63,7 KB        | 58,9 KB           | 64,9 / 64,9 KB                     |
| modulepreloadCount                                     | 25             | 0                 | 25 / 0                             |
| linkHeaderEntries                                      | 31             | 5                 | 31 / 5                             |
| preloadDuplicates                                      | 21             | 3                 | 22 / 3                             |
| bootClosureRawBytes                                    | 1570,7 KB      | 1597,2 KB         | 1599,4 / 1599,4 KB                 |
| bootClosureGzipBytes                                   | 474,0 KB       | 484,5 KB          | 483,4 / 485,0 KB                   |
| preloadedJsCount / GzipBytes                           | 25 / 550,3 KB  | 0 / 0,0 KB        | 25 / 559,6; 0 / 0,0 KB             |
| renderBlockingCssGzipBytes                             | 78,4 KB        | 78,8 KB           | 79,5 / 79,5 KB                     |
| preLcpTransferBytes                                    | 727,9 KB       | 173,9 KB          | 738,5 / 177,3 KB                   |
| bootEntryMissing / bootBurstCount / bootBurstGzipBytes | –              | 0 / 26 / 560,5 KB | – / 0, 26, 561,2 KB                |

Surowo z logów: A „HTML 400880 B raw / 56847 B gzip; <head> 25860 B”, B „HTML 337912 B raw / 52604 B gzip; <head> 28974 B”; B „zestaw bootu (P2.1): tryb lcp, wejście /assets/index-fO-Yix7R.js, 26 URL-i; seria bootu 26 plików / 574001 B gzip”, „JS z priorytetem High przy starcie: 0 plików”; A „JS z priorytetem High przy starcie: 25 plików, 1840728 B raw / 563491 B gzip”. Oba: „✓ Waga dokumentu w progach”.

## 9. Pliki

- `$G/lh-browser/`, `$G/lh-bot/`: `summary.json`, LHR `{A,B}-<forma>-<n>.json`, artefakty `*.artifacts` (ślad + devtoolsLog), księgi `*.ledger.txt`, audyty pierwszego przebiegu `*-1.audits.txt`, `home-{A,B}.html/.headers.txt`, `server-{A,B}.log`.
- `$G/lh-browser.log`, `$G/lh-bot.log` (+ `.exit`, `.start`), linie podsumowania `$G/lh-*.summary-lines.txt`.
- `$G/document-weight-{A,B}.{json,log}`.
- `$G/tables.md` (tabele per przebieg, te same co §6), `$G/runs.json` (dane maszynowe per przebieg), `$G/extract.py` (ekstraktor).
