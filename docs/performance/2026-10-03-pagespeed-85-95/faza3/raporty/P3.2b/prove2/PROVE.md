# P3.2b (fala 3): dowód pomiarowy, runda 2 (po poprawce 9)

A = baza fali `base-w3d` (`d5bd11fb`, build orkiestratora, `exit 0`, nieprzebudowywana). B = worktree `wt3/P3.2b`
(`162c01b2`, `BUNDLE_INVENTORY=1 bun run build:smoke`, `exit 0`). `$Q` = `$SCRATCH/phase3/wave3/P3.2b/prove2`;
wszystkie logi i JSON-y w `$Q`. Runda 1 (kandydat `46e09026`): `$SCRATCH/phase3/wave3/P3.2b/PROVE.md`.

## 0. Werdykt w skrócie

- **Regresja z rundy 1 usunięta.** Desktop4x FCP: pary Δ **−0,015 s** (σΔ 0,040, MDE(t) 0,066), mediana
  0,40 → 0,36 s (runda 1: +0,076 s). Pierwszy `Layout` w śladzie: mobile 20,0 → **17,9 ms**, desktop przy tej
  samej liczbie brudnych obiektów (699) 24,7/27,9 → 23,5/27,8/29,4 ms (runda 1: ok. 2×, 47–50 ms). Audyt
  „Style & Layout” wrócił do poziomu bazy: mobile 412 → 386 ms, desktop 382 → 372 ms (runda 1: 465/506 ms).
- **Struktura: tak.** Jedno żądanie woff2 (`red-hat-display-latin-pl`) w 10/10 przebiegach B, `latin-ext` nie
  pobierany; e2e `single-font` PL i EN zielone (z nowymi krokami 3–4: rodzina RHD ma jedną, załadowaną twarz;
  sonda `Babiš` dociąga latin-ext). `fontPreloadCount` 1 ≤ 1.
- **LCP mobile w dół:** mediana 2,17 → **2,00 s** (−0,16 s), pary Δ −0,132 s, σΔ 0,125, MDE(t) 0,208. W tej serii
  poniżej MDE (B bimodalne: 3/5 przy 1,97–2,00 s, 2/5 przy 2,14 s; A 2,13–2,29 s), kierunek i wielkość
  zgodne z rundą 1 (−0,130 s, σΔ 0,064, istotne). **LCP desktop4x −0,027 s istotne** (σΔ 0,012, MDE(t) 0,019).
- **CLS 0,000 w 20/20** przebiegach; `font-swap-cls` 4/4 zielone, wartości co do bajtu jak w rundzie 1.
- **FCP ±0:** mobile −0,032 s (szum), desktop4x −0,015 s (szum). Kryterium spełnione na obu formach.
- **Suma CSS w `check:bundle`:** 95,8/96 KB (dokładnie 98 050 B gzip w Bun, zostaje **254 B**); +330 B gzip
  wobec bazy (97 720 B). Zielona, ale zapas bardzo mały (KRYTYKA L2).
- **Domknięcie bootu bez wzrostu:** −297 B raw / −65 B gz (`check-document-weight`), `check:bundle` 486,5 KB gz
  bez zmian / 1593,7 KB raw (−0,3).
- Wszystkie bramki zielone. **needs_fix = nie.** `effect_matches_plan = yes`.

## 1. Bramki artefaktu (B)

| Bramka                                                                        | Wynik                          | Uwagi / log                                                      |
| ----------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| build `BUNDLE_INVENTORY=1 bun run build:smoke`                                | zielony                        | `build.log`                                                      |
| `check:bundle`                                                                | zielony                        | `check:bundle.log`; baza `check-bundle-base.log` (§2)            |
| `check:chunks`                                                                | zielony                        | 895 chunków, 6856 krawędzi, acykliczny                           |
| `check:entry-purity`                                                          | zielony                        | ścieżka bootu czysta, `themeDesign` poza bootem                  |
| `check:server-entry-purity`                                                   | zielony                        | 1814 plików                                                      |
| `test:e2e:artifact` (env CI)                                                  | zielony **19/19**              | w tym `single-font` PL i EN (nowe kroki 3–4); `e2e-artifact.log` |
| `font-swap-cls.spec.ts` (konfiguracja performance)                            | zielony **4/4**                | `swap-cls.log` (§5)                                              |
| `check-document-weight` B                                                     | zielony                        | `document-weight.json`                                           |
| `check-document-weight` A                                                     | zielony                        | `document-weight-base.json`                                      |
| vitest `fontGlyphCoverage`, `fontPreload`, `rootHead`, `themeDesignFontStack` | 50 zielonych + 1 expected fail | `vitest.log` (istniejący `it.fails`)                             |

Uwaga środowiskowa: pierwsze dwa uruchomienia `font-swap-cls` padły przed startem testu (`browserType.launch:
Executable doesn't exist ... chromium_headless_shell-1243`), bo `npx`/`node_modules/.bin/playwright` 1.63 szuka
przeglądarki, której w kontenerze nie ma. Powtórzone z `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
(mechanizm, który config już ma) i zielone. Logi nieudanych prób: `swap-cls-npx-envfail.log`, `swap-cls-envfail2.log`.
To nie jest skutek zmiany.

## 2. `check:bundle` A vs B

| Pozycja                                   | A (base-w3d)                | B (P3.2b)                   | Δ             | próg                     |
| ----------------------------------------- | --------------------------- | --------------------------- | ------------- | ------------------------ |
| overall JS                                | 4752,8 KB                   | 4752,3 KB                   | −0,5          | 4772                     |
| public JS                                 | 2802,4 KB                   | 2802,2 KB                   | −0,2          | 2877                     |
| największy chunk (entry `index`)          | 260,9 KB                    | 260,8 KB                    | −0,1          | 286                      |
| CSS suma (wydruk)                         | 95,4 KB                     | **95,8 KB**                 | +0,4          | 96                       |
| CSS suma (dokładnie, gzip Bun jak bramka) | 97 720 B                    | **98 050 B**                | **+330 B**    | 98 304 B (zostaje 254 B) |
| arkusz `styles-*.css` raw / gzip Bun      | 542 016 / 80 656 B          | 545 457 / 80 986 B          | +3 441 / +330 | —                        |
| public CSS                                | 81,2 KB                     | 81,5 KB                     | +0,3          | 83                       |
| Boot closure                              | 486,5 KB gz / 1594,0 KB raw | 486,5 KB gz / 1593,7 KB raw | 0 / −0,3      | 579                      |

Linia B: `Boot closure: 486.5 KB gzip / 1593.7 KB raw  (10 chunków statycznie osiągalnych ze SSR-owego <script>; budget ≤ 579 KB)`.
Ruchy względem baseline'u (b006c2e) identyczne jak na bazie: spreadsheet.worker +131,5 (NOWY), index −47,2,
lucide-shim.fa −24,1, club._clubSlug.index +16,5, admin.seo +7,5 (NOWY), i18n-club +3,0, category._slug −2,5,
icons-0/1/3 −2,5/−2,5/−2,4, profile.notifications −2,4, SeoPanel +2,4, znikł i18n-admin-seo-hub.
Ostrzeżenia bramki: overall zostaje 19,7 KB, **css total zostaje 0,2 KB (0,26 %)**, public css 1,5 KB. Wynik CSS
zgadza się co do bajtu z prognozą IMPL-fix9 §2.4 (98 050 B). Przyrost względem rundy 1 (`46e09026`): +69 B gz
(sześć twarzy latin-ext w rodzinie zastępczej).

## 3. Waga dokumentu (`check-document-weight`, GET `/` fixture, 5 próbek, mediany)

| Metryka                                        | A               | B               | Δ                                         | B runda 1    |
| ---------------------------------------------- | --------------- | --------------- | ----------------------------------------- | ------------ |
| htmlRawBytes                                   | 326 697         | 326 571         | −126                                      | 326 571      |
| htmlGzipBytes                                  | 49 247          | 49 233          | −14                                       | 49 240       |
| headRawBytes                                   | 25 792          | 25 666          | −126                                      | 25 666       |
| fontPreloadCount (unikalne pliki)              | (2 pliki)       | **1** (próg 1)  | −1                                        | 1            |
| linkHeaderEntries                              | 5               | **4**           | −1                                        | 4            |
| preloadDuplicates                              | 3               | **2**           | −1 (cover.jpg + jedyny font, head+header) | 2            |
| documentPreloadDuplicates / modulepreloadCount | 0 / 0           | 0 / 0           | 0                                         | 0 / 0        |
| inlineStyleCount / inlineStyleBytes            | 25 / 71 234     | 25 / 71 234     | 0                                         | bez zmian    |
| inlineScriptBytes / executable                 | 86 617 / 79 373 | 86 617 / 79 373 | 0                                         | bez zmian    |
| inlineCssCommentBytes                          | 517             | 517             | 0                                         | 517          |
| dehydratedStateBytes                           | 60 357          | 60 357          | 0                                         | 60 357       |
| imgFetchpriorityHigh / imagePreloadCount       | 1 / 3           | 1 / 3           | 0                                         | 1 / 3        |
| preloadedJsCount (High JS pool)                | 0               | 0               | 0                                         | 0            |
| bootClosureRawBytes                            | 1 632 254       | 1 631 957       | **−297**                                  | 1 631 957    |
| bootClosureGzipBytes                           | 494 711         | 494 646         | **−65**                                   | 494 575      |
| bootBurstCount / bootBurstGzipBytes            | 26 / 571 390    | 26 / 571 323    | 0 / −67                                   | 26 / 571 269 |
| renderBlockingCssGzipBytes (node)              | 80 443          | 80 765          | +322 (próg 81 399)                        | 80 703       |
| preLcpTransferBytes                            | 174 422         | 154 370         | **−20 052** (fonty 24 372 B)              | 154 315      |

Do ratchetu (orkiestrator / właściciel plików wagi): `linkHeaderEntries` 5→4, `preloadDuplicates` 3→2,
`preLcpTransferBytes` w dół. Nowy próg `fontPreloadCount` = 1 trzyma.

## 4. Lighthouse A/B (`--compare base-w3d wt3/P3.2b --runs 5 --forms mobile,desktop4x --client-backend fixture --third-party fake-gtag --save-artifacts --warm-ua bot`)

VALID: 5/5 na każdej stronie i formie, excluded 0 (2 powtórki odrzucone przez harness przy obciążeniu), tryb FCP
bez-js 5/5, pary mieszane 0/5. Dokument `s-maxage=900`, A 319 642 B / B 319 516 B. Księga = audyt TBT w 20/20,
zadania Google 0.

### 4.1 Mediany i DELTA B−A

| Forma     | Strona | perf | FCP        | LCP        | TBT    | SI     | CLS   | req | transfer | highBeforeLcpImg | mainThread |
| --------- | ------ | ---- | ---------- | ---------- | ------ | ------ | ----- | --- | -------- | ---------------- | ---------- |
| mobile    | A      | 98   | 1,40 s     | 2,17 s     | 84 ms  | 1,67 s | 0,000 | 70  | 909,3 KB | 112,4 KB         | 3128 ms    |
| mobile    | B      | 98   | 1,39 s     | **2,00 s** | 61 ms  | 1,58 s | 0,000 | 71  | 889,9 KB | 92,7 KB          | 2850 ms    |
| mobile    | Δ      | ±0   | −0,01      | **−0,16**  | −23    | −0,09  | ±0    | +1  | −19,3 KB | −19,7 KB         | −278       |
| desktop4x | A      | 92   | 0,40 s     | 0,50 s     | 228 ms | 0,59 s | 0,000 | 75  | 914,9 KB | 112,4 KB         | 3007 ms    |
| desktop4x | B      | 92   | **0,36 s** | **0,47 s** | 233 ms | 0,58 s | 0,000 | 74  | 894,9 KB | 92,7 KB          | 3112 ms    |
| desktop4x | Δ      | ±0   | −0,04      | −0,03      | +5     | −0,01  | ±0    | −1  | −19,9 KB | −19,7 KB         | +104       |

Liczba żądań waha się w przebiegach 69–89 przez zasoby po `load` (nie fonty); fonty: A 2, B 1 w każdym przebiegu.

### 4.2 Pary (n = 5, t(df=4) = 3,72)

| Forma     | metryka | Δ            | σΔ    | MDE(t) | ocena                                                   |
| --------- | ------- | ------------ | ----- | ------ | ------------------------------------------------------- |
| mobile    | FCP     | −0,032 s     | 0,087 | 0,144  | ±0 (kryterium spełnione)                                |
| mobile    | LCP     | **−0,132 s** | 0,125 | 0,208  | w dół, poniżej MDE tej serii; runda 1: −0,130 s istotne |
| mobile    | TBT     | −21 ms       | 109   | 182    | szum                                                    |
| mobile    | SI      | −0,114 s     | 0,204 | 0,339  | szum (kierunek w dół)                                   |
| desktop4x | FCP     | **−0,015 s** | 0,040 | 0,066  | ±0 (runda 1: +0,076 s; regresja usunięta)               |
| desktop4x | LCP     | **−0,027 s** | 0,012 | 0,019  | **istotne, w dół**                                      |
| desktop4x | TBT     | +2 ms        | 61    | 102    | szum                                                    |
| desktop4x | SI      | −0,005 s     | 0,059 | 0,098  | szum                                                    |

### 4.3 Przebiegi (FCP / LCP / SI / TBT w ms, CLS; „Style & Layout” z `mainthread-work-breakdown`; woff2 z `network-requests`)

| Przebieg        | FCP                              | LCP                              | SI                               | TBT                         | CLS  | Style & Layout              | woff2                     |
| --------------- | -------------------------------- | -------------------------------- | -------------------------------- | --------------------------- | ---- | --------------------------- | ------------------------- |
| A mobile 1–5    | 1400 / 1380 / 1589 / 1374 / 1465 | 2167 / 2138 / 2179 / 2132 / 2292 | 1877 / 1623 / 1599 / 1668 / 1703 | 181 / 52 / 68 / 188 / 84    | 0 ×5 | 411 / 412 / 449 / 412 / 434 | latin + latin-ext (2) ×5  |
| B mobile 1–5    | 1364 / 1391 / 1450 / 1462 / 1382 | 1968 / 2005 / 2137 / 2146 / 1991 | 1438 / 1582 / 1700 / 1507 / 1673 | 100 / 203 / 56 / 48 / 61    | 0 ×5 | 367 / 432 / 386 / 391 / 369 | **tylko latin-pl (1) ×5** |
| A desktop4x 1–5 | 470 / 399 / 337 / 474 / 346      | 480 / 510 / 480 / 526 / 499      | 594 / 626 / 537 / 630 / 547      | 178 / 250 / 228 / 288 / 213 | 0 ×5 | 359 / 412 / 365 / 442 / 382 | 2 ×5                      |
| B desktop4x 1–5 | 395 / 363 / 362 / 477 / 352      | 470 / 474 / 453 / 503 / 460      | 558 / 613 / 582 / 548 / 608      | 156 / 233 / 196 / 258 / 324 | 0 ×5 | 368 / 372 / 423 / 363 / 457 | **1 ×5**                  |

Mediany „Style & Layout”: mobile A 412 → B 386 ms; desktop4x A 382 → B 372 ms (runda 1: B 465 / 506 ms).

### 4.4 Pierwsze zadanie Style/Layout (klasa celowana przez poprawkę 9)

Ślad (`prove-tools/firststyle.cjs`), `UpdateLayoutTree` i pierwszy `Layout` (brudne obiekty) oraz księga Lantern
(obsDur → simDur):

| Przebieg    | A: ULT / Layout (dirty)          | A obs → sim             | B: ULT / Layout (dirty)              | B obs → sim                     |
| ----------- | -------------------------------- | ----------------------- | ------------------------------------ | ------------------------------- |
| mobile 1    | 22,0 / 21,2 (587)                | 59,2 → 118              | 20,4 / 17,9 (587)                    | 48,8 → 98                       |
| mobile 2    | 21,8 / 19,6 (587)                | 55,7 → 111              | 23,7 / 18,7 (587)                    | 56,3 → 113                      |
| mobile 3    | 32,3 / 18,6 (541)                | 63,3 → 127              | 21,2 / 17,8 (587)                    | 52,0 → 104                      |
| mobile 4    | 22,7 / 20,3 (587)                | 54,0 → 108              | 28,9 / 16,2 (541)                    | 57,3 → 115                      |
| mobile 5    | 21,4 / 20,0 (541)                | 57,9 → 116              | 24,0 / 19,1 (587)                    | 55,8 → 112                      |
| desktop4x 1 | 25,6 / 21,2 (657)                | 66,0 → 132              | 23,0 / 24,0 (652)                    | 62,2 → 124                      |
| desktop4x 2 | 31,2 / 20,6 (653)                | 65,7 → 131              | 25,5 / 23,5 (699)                    | 61,0 → 122                      |
| desktop4x 3 | 24,0 / 24,7 (699)                | 62,2 → 124              | 31,1 / 27,8 (699)                    | 69,4 → 139                      |
| desktop4x 4 | 27,1 / 16,0 (504)                | 58,6 → 117              | 23,7 / 21,8 (653)                    | 60,5 → 121                      |
| desktop4x 5 | 24,3 / 27,9 (699)                | 68,0 → 136              | 28,9 / 29,4 (699)                    | 71,3 → 143                      |
| **mediana** | mobile Layout 20,0; desktop 21,2 | mobile 116, desktop 131 | mobile Layout **17,9**; desktop 23,5 | mobile **112**, desktop **124** |

Porównanie przy tej samej liczbie brudnych obiektów (desktop): 699 → A 24,7 / 27,9 ms, B 23,5 / 27,8 / 29,4 ms;
652–657 → A 21,2 / 20,6, B 24,0 / 21,8 ms. Różnica 0–2 ms, w rozrzucie bazy. Runda 1 miała w tym samym miejscu
Layout 47,2 / 50,6 ms (desktop) i 42,5 ms (mobile). **Klasa zadania „Style z podwójnym Layout” zniknęła w 10/10
przebiegach B**; zadanie ma czas bazy (nie dzieli się poniżej 50 ms, bo i na bazie ma 54–68 ms obserwowane, tak
jak przed P3.2b). Zgodne z eksperymentem implementera (IMPL-fix9 §2.1: BF 11,4 ms wobec B12 11,0 ms, bez dławienia).

### 4.5 Speedline (postęp wizualny obserwowany, SI w ms, wszystkie przebiegi)

| Strona      | 1   | 2   | 3   | 4   | 5   | mediana       |
| ----------- | --- | --- | --- | --- | --- | ------------- |
| A mobile    | 333 | 284 | 331 | 286 | 318 | 318           |
| B mobile    | 263 | 302 | 277 | 265 | 280 | **277** (−41) |
| A desktop4x | 312 | 322 | 294 | 371 | 337 | 322           |
| B desktop4x | 308 | 291 | 303 | 341 | 301 | **303** (−19) |

Klatki (przebiegi medianowe SI Lantern): A-mobile-4 71 % przy 287 ms, 99 % przy 316 ms; B-mobile-2 71 % przy
320 ms, 99 % przy 365 ms; A-desktop4x-1 67 % przy 292 ms, 99 % przy 338 ms; B-desktop4x-3 98 % przy 314 ms.
W rundzie 1 B było obserwowane wolniejsze (295/376 wobec 250/312); teraz mediany są niższe od bazy. SI Lantern
w szumie (mobile −0,114 s, desktop −0,005 s).

### 4.6 Audyty jednego przebiegu mobile (A-mobile-1 / B-mobile-1)

|                                 | A                                                                                 | B                              |
| ------------------------------- | --------------------------------------------------------------------------------- | ------------------------------ |
| żądania / transfer              | 70 / 909,2 KB                                                                     | 69 / 889,3 KB                  |
| fonty                           | latin-BX 30 762 B (53–121 ms) + latin-ext 14 153 B (53–123 ms)                    | latin-pl 24 483 B (44–83 ms)   |
| arkusz                          | 70 185 B (52–138 ms)                                                              | 70 402 B (43–96 ms)            |
| LCP element                     | `img.eh-img` (cover.jpg); TTFB 25 / load delay 31 / load 32 / render delay 174 ms | to samo; 18 / 22 / 14 / 172 ms |
| highPriorityBytesBeforeLcpImage | 112,4 KB                                                                          | 92,7 KB                        |
| render-blocking                 | arkusz 68,5 KB, „wasted” 464 ms                                                   | arkusz 68,8 KB, 455 ms         |
| CLS                             | 0                                                                                 | 0                              |
| Style & Layout                  | 411 ms                                                                            | 367 ms                         |

## 5. Podmiana fontu (`e2e-performance/font-swap-cls.spec.ts`, fonty wstrzymane do zwolnienia, build B)

| Przypadek  | B runda 2 (`162c01b2`)                            | B runda 1 (`46e09026`) | A (kontrola negatywna z rundy 1) |
| ---------- | ------------------------------------------------- | ---------------------- | -------------------------------- |
| desktop PL | 0,000285 ✓                                        | 0,000285               | 0,002061 ✘                       |
| mobile PL  | 0,000617 ✓                                        | 0,000617               | 0,000484                         |
| desktop EN | 0,000325 ✓                                        | 0,000325               | 0,021224 ✘                       |
| mobile EN  | 0,000605 ✓ (1 nagłówek poniżej zgięcia 1→2 linie) | 0,000605               | 0,000286                         |

Wstrzymany font w każdym przypadku: tylko `red-hat-display-latin-pl-CkxMVW1W.woff2`. Twarze lokalne kroju
zastępczego bez zmian, więc wynik identyczny co do bajtu; twarze latin-ext rodziny zastępczej nie wpływają na
podmianę (zakres nie obejmuje znaków strony).

## 6. Pliki fontów i zakres zmiany

- `src/assets/fonts/red-hat-display-latin-pl.woff2` 24 372 B, sha256 `efaa4dc4…a75c7` (bez zmian od rundy 1; oś
  przycięta 400–900 zgodnie z decyzją właściciela, komendy w IMPL rundy 1).
- `red-hat-display-latin-ext.woff2` sha256 `500d3bfa…9ead`, bajt w bajt jak na bazie (`-Do32GAgg`).
- Poprawka 9 (`46e09026..162c01b2`) dotyka tylko `src/styles.css` (blok `@font-face`), `fontGlyphCoverage.test.ts`
  i `e2e/single-font.boot-home.spec.ts`. Zbudowany arkusz: rodzina „Red Hat Display” ma jedną twarz (`400 900`,
  swap, latin-pl); rodzina „Red Hat Display Fallback” ma 6 twarzy `local()` z metryką i po nich 6 twarzy latin-ext
  o identycznych deskryptorach wagi, `unicode-range` U+100-103, U+108-117, U+11A-130, … (cmap ext − cmap główny).

## 7. Ocena wobec kryteriów

| Kryterium (PLAN-FALI-3 §2, P3.2b, notatki orkiestratora) | Wynik                                                                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| jedno żądanie fontu w ścieżce LCP, PL i EN               | **tak** (LH PL 10/10; e2e `single-font` PL + EN; `fontPreloadCount` 1)                                                        |
| żaden inny krój nie dochodzi do preloadu                 | **tak** (1 preload, latin-ext bez preloadu i niepobierany na PL/EN)                                                           |
| CLS = 0 w 5/5 mobile i desktop4x                         | **tak** (20/20); podmiana fontu ≤ 0,001 w 4/4                                                                                 |
| FCP ±0                                                   | **tak**: mobile −0,032 s, desktop4x −0,015 s (oba w szumie; regresja rundy 1 usunięta)                                        |
| LCP mobile w dół                                         | **tak**: mediana −0,16 s, pary −0,132 s (poniżej MDE tej serii 0,208; runda 1 istotne −0,130 s); desktop LCP −0,027 s istotne |
| suma CSS w check:bundle (KRYTYKA L2)                     | zielona, 98 050 / 98 304 B (+330 B gz wobec bazy; zostaje 254 B)                                                              |
| bootClosure bez wzrostu                                  | **tak**: −297 B raw / −65 B gz; `check:bundle` 486,5 KB gz bez zmian                                                          |

`effect_matches_plan = yes`: struktura (jeden font, brak latin-ext w ścieżce, celowana klasa zadania Style/Layout
wróciła do bazy w 10/10 przebiegach) zgodna; LCP mobile w dół w tym samym rozmiarze co w rundzie 1 (w tej serii
poniżej MDE z powodu bimodalnego B, łącznie z rundą 1 spójne); FCP ±0 na obu formach; CLS 0.

Ryzyka do wiadomości orkiestratora (bez wpływu na werdykt):

1. Zapas sumy CSS 254 B: P3.3/P3.8 według zapowiedzi nie dokładają CSS, ale każda kolejna pozycja z CSS zapali
   bramkę `css total`.
2. Stosy bez `"Red Hat Display Fallback"` (wyszukiwarka, czat, bilet, picker admina; IMPL-fix9 §5) rysują znaki
   latin-ext krojem systemowym, nie RHD. Poza listą plików pozycji, do fali 4 (KRYTYKA L9).
3. Waga 300 dla znaków latin-ext: litery o stopień cieńsze (IMPL-fix9 §4.2); na stronach publicznych marginalne.
