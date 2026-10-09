# P3.2b (fala 3): dowód pomiarowy (Prove)

A = baza fali `base-w3d` (`d5bd11fb`, build orkiestratora, `exit 0`), B = worktree `wt3/P3.2b` (`46e09026`,
`BUNDLE_INVENTORY=1 bun run build:smoke`, `exit 0`). `$P` = `$SCRATCH/phase3/wave3/P3.2b`. Wszystkie logi w `$P`.

## 0. Werdykt w skrócie

- **Struktura: tak.** Jedno żądanie fontu w ścieżce LCP (PL 5/5 mobile i 5/5 desktop4x w LH; PL i EN w
  `e2e/single-font.boot-home.spec.ts` na buildzie), brak `latin-ext`, `fontPreloadCount` 1, `linkHeaderEntries`
  5→4, `preloadDuplicates` 3→2, `preLcpTransferBytes` −20 101 B, CLS 0,000 w 20/20 przebiegach, podmiana fontu
  ≤ 0,001 w 4/4 przypadkach `font-swap-cls` na prawdziwym buildzie, domknięcie bootu −297 B raw / −136 B gz.
- **LCP mobile w dół: tak, ponad szum:** pary Δ −0,130 s (σΔ 0,064, MDE(t) 0,106), mediana 2,14 → 1,98 s.
- **FCP ±0: tylko mobile** (pary +0,009 s). **Desktop4x: FCP +0,08 s (mediana), pary +0,076 s** — poniżej MDE(t)
  0,145 s, ALE z potwierdzonym mechanizmem: pierwsze zadanie Style/Layout rośnie w 10/10 przebiegach B
  (Layout ok. 22 → 47 ms obserwowane, „Style & Layout” +85 ms w Lantern), a ono leży w grafie FCP desktopu.
- **Przyczyna zidentyfikowana kontrolowanym eksperymentem (§6):** NIEZAŁADOWANA twarz `latin-ext` w rodzinie
  segmentowanej „Red Hat Display”. Na bazie obie twarze są preloadowane i załadowane; po P3.2b `latin-ext` nigdy
  się nie ładuje (tak ma być), a sama jej obecność podwaja koszt pierwszego Layout. Kandydat bez tej twarzy:
  9,9 ms (baza 11–12 ms, kandydat 24 ms). Krój zastępczy (6 twarzy), stos z CMS, bajty fontu i `unicode-range`
  twarzy głównej NIE mają wpływu.
- Bramki: wszystkie zielone. **needs_fix = tak** (jedna runda): regresja FCP desktop / Style&Layout jest
  spowodowana tą zmianą i ma sprawdzone lekarstwo (§7).

## 1. Bramki artefaktu (B)

| Bramka                                                           | Wynik         | Uwagi / log                                                  |
| ---------------------------------------------------------------- | ------------- | ------------------------------------------------------------ |
| build `BUNDLE_INVENTORY=1 bun run build:smoke`                   | zielony       | `build.log`                                                  |
| `check:bundle`                                                   | zielony       | `check:bundle.log`; baza `check-bundle-base.log` (tabela §2) |
| `check:chunks`                                                   | zielony       | 895 chunków, acykliczny                                      |
| `check:entry-purity`                                             | zielony       | `themeDesign` nadal na liście ciężkich modułów poza bootem   |
| `check:server-entry-purity`                                      | zielony       | 1814 plików                                                  |
| `test:e2e:artifact` (env CI)                                     | zielony 19/19 | w tym nowe `single-font` PL i EN; `e2e-artifact.log`         |
| `font-swap-cls.spec.ts` (konfiguracja performance) na buildzie B | zielony 4/4   | `swap-cls-cand.log` (§5)                                     |
| `check-document-weight` B                                        | zielony       | `document-weight.json`, `fontPreloadCount` 1 ≤ 1             |
| `check-document-weight` A                                        | zielony       | `document-weight-base.json`                                  |

## 2. `check:bundle` A vs B

| Pozycja                       | A (base-w3d)                | B (P3.2b)                   | Δ           | próg                |
| ----------------------------- | --------------------------- | --------------------------- | ----------- | ------------------- |
| overall JS                    | 4752,8 KB                   | 4753,3 KB                   | +0,5        | 4772                |
| public JS                     | 2802,4 KB                   | 2802,8 KB                   | +0,4        | 2877                |
| admin-only                    | 1950,3 KB                   | 1950,5 KB                   | +0,2        | —                   |
| largest chunk (entry `index`) | 260,9 KB                    | 260,7 KB                    | −0,2        | 286                 |
| CSS suma                      | 95,4 KB                     | **95,7 KB**                 | +0,3        | 96 (zostaje 0,3 KB) |
| public CSS                    | 81,2 KB                     | 81,5 KB                     | +0,3        | 83                  |
| Boot closure                  | 486,5 KB gz / 1594,0 KB raw | 486,4 KB gz / 1593,7 KB raw | −0,1 / −0,3 | 579                 |

Linia B: `Boot closure: 486.4 KB gzip / 1593.7 KB raw  (10 chunków statycznie osiągalnych ze SSR-owego <script>; budget ≤ 579 KB)`.
Ruchy względem baseline'u identyczne jak na bazie poza `index` (−47,1 → −47,3 KB): spreadsheet.worker +131,5 (NOWY),
index −47,3, lucide-shim.fa −24,1, club._clubSlug.index +16,5, admin.seo +7,5 (NOWY), i18n-club +3,0, category._slug −2,5,
icons-0/1/3 −2,5/−2,5/−2,4, profile.notifications −2,4, SeoPanel +2,4, znikł i18n-admin-seo-hub.
Ostrzeżenie: zapas sumy CSS spada z 0,6 KB do 0,3 KB (+260 B gz arkusza blokującego; KRYTYKA L2 — mieści się).

## 3. Waga dokumentu (`check-document-weight`, GET `/` fixture, 5 próbek, mediany)

| Metryka                                        | A                                | B                | Δ                                                 |
| ---------------------------------------------- | -------------------------------- | ---------------- | ------------------------------------------------- |
| htmlRawBytes                                   | 326 697                          | 326 571          | −126                                              |
| htmlGzipBytes                                  | 49 241                           | 49 240           | −1                                                |
| headRawBytes                                   | 25 792                           | 25 666           | −126                                              |
| fontPreloadCount (nowa semantyka: unikalne)    | (2 pliki; stara metryka 4 wpisy) | **1** (próg 1)   | −1 plik                                           |
| fontPreloadBytes                               | 44 732                           | 24 372           | −20 360                                           |
| linkHeaderEntries                              | 5                                | **4**            | −1                                                |
| preloadDuplicates                              | 3                                | **2**            | −1 (zostaje cover.jpg + jedyny font, head+header) |
| documentPreloadDuplicates / modulepreloadCount | 0 / 0                            | 0 / 0            | 0                                                 |
| inline style / script (B)                      | 25 / 71 234; 34 / 86 617         | bez zmian        | 0                                                 |
| inlineCssCommentBytes                          | 517                              | 517              | 0                                                 |
| imgFetchpriorityHigh / imagePreloadCount       | 1 / 3                            | 1 / 3            | 0                                                 |
| JS High przy starcie (High JS pool)            | 0                                | 0                | 0                                                 |
| bootClosureRawBytes                            | 1 632 254                        | 1 631 957        | −297                                              |
| bootClosureGzipBytes                           | 494 711                          | 494 575          | −136                                              |
| bootBurstCount / bootBurstGzipBytes            | 26 / 571 390                     | 26 / 571 269     | 0 / −121                                          |
| renderBlockingCssGzipBytes (raw)               | 80 443 (542 016)                 | 80 703 (543 829) | +260 (+1 813)                                     |
| preLcpTransferBytes                            | 174 416                          | 154 315          | −20 101                                           |

Zgodne z prognozą IMPL §6 pkt 1 (−20 360 B fontów, +256 B arkusza, `headRawBytes` −120 B, boot ≤ 0).
Ratchet `linkHeaderEntries` 5→4, `preloadDuplicates` 3→2, `preLcpTransferBytes` w dół — orkiestrator.

## 4. Lighthouse A/B (`--compare base-w3d wt3/P3.2b --runs 5 --forms mobile,desktop4x --client-backend fixture --third-party fake-gtag --save-artifacts --warm-ua bot`)

VALID: 5/5 na każdej stronie i formie, excluded 0, tryb FCP bez-js 5/5, pary mieszane 0/5; dokument
`s-maxage=900`, A 319 642 B / B 319 516 B. Księga = audyt TBT w 20/20.

### 4.1 Mediany i DELTA B−A

| Forma     | Strona | perf | FCP        | LCP        | TBT    | SI     | CLS   | req | transfer | highBeforeLcpImg | mainThread |
| --------- | ------ | ---- | ---------- | ---------- | ------ | ------ | ----- | --- | -------- | ---------------- | ---------- |
| mobile    | A      | 98   | 1,38 s     | 2,14 s     | 74 ms  | 1,61 s | 0,000 | 72  | 909,8 KB | 112,4 KB         | 2640 ms    |
| mobile    | B      | 98   | 1,37 s     | **1,98 s** | 71 ms  | 1,63 s | 0,000 | 69  | 889,2 KB | 92,7 KB          | 2739 ms    |
| mobile    | Δ      | ±0   | −0,00      | **−0,16**  | −3     | +0,02  | ±0    | −3  | −20,6 KB | −19,7 KB         | +99        |
| desktop4x | A      | 94   | 0,39 s     | 0,50 s     | 197 ms | 0,59 s | 0,000 | 73  | 914,3 KB | 112,4 KB         | 2965 ms    |
| desktop4x | B      | 91   | **0,47 s** | 0,48 s     | 252 ms | 0,63 s | 0,000 | 74  | 894,9 KB | 92,7 KB          | 3145 ms    |
| desktop4x | Δ      | −3   | **+0,08**  | −0,02      | +55    | +0,05  | ±0    | +1  | −19,4 KB | −19,8 KB         | +180       |

### 4.2 Pary (n = 5, t(df=4) = 3,72)

| Forma     | metryka | Δ            | σΔ    | MDE(t) | ocena                                              |
| --------- | ------- | ------------ | ----- | ------ | -------------------------------------------------- |
| mobile    | FCP     | +0,009 s     | 0,029 | 0,048  | ±0 (kryterium spełnione)                           |
| mobile    | LCP     | **−0,130 s** | 0,064 | 0,106  | **istotne, w dół**                                 |
| mobile    | TBT     | +12 ms       | 70    | 116    | szum                                               |
| mobile    | SI      | +0,038 s     | 0,082 | 0,136  | szum                                               |
| desktop4x | FCP     | **+0,076 s** | 0,087 | 0,145  | poniżej MDE, ale mechanizm potwierdzony (§4.4, §6) |
| desktop4x | LCP     | −0,008 s     | 0,044 | 0,072  | szum                                               |
| desktop4x | TBT     | +29 ms       | 57    | 95     | szum                                               |
| desktop4x | SI      | +0,030 s     | 0,065 | 0,108  | szum                                               |

### 4.3 Przebiegi (FCP / LCP / SI / TBT / CLS; żądania woff2 z `network-requests`, ms start–koniec)

| Przebieg        | FCP                                   | LCP                                   | SI                                    | TBT                         | CLS  | woff2                     |
| --------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- | --------------------------- | ---- | ------------------------- |
| A mobile 1–5    | 1,378 / 1,391 / 1,373 / 1,369 / 1,386 | 2,141 / 2,157 / 2,129 / 2,119 / 2,153 | 1,684 / 1,606 / 1,608 / 1,654 / 1,467 | 74 / 34 / 86 / 120 / 39     | 0 ×5 | latin + latin-ext (2) ×5  |
| B mobile 1–5    | 1,374 / 1,451 / 1,369 / 1,374 / 1,375 | 1,977 / 2,140 / 1,969 / 1,983 / 1,984 | 1,632 / 1,570 / 1,698 / 1,703 / 1,606 | 144 / 71 / 71 / 22 / 103    | 0 ×5 | **tylko latin-pl (1) ×5** |
| A desktop4x 1–5 | 0,359 / 0,461 / 0,497 / 0,354 / 0,393 | 0,510 / 0,490 / 0,497 / 0,528 / 0,499 | 0,521 / 0,579 / 0,720 / 0,588 / 0,586 | 175 / 182 / 326 / 225 / 197 | 0 ×5 | 2 ×5                      |
| B desktop4x 1–5 | 0,524 / 0,452 / 0,473 / 0,464 / 0,533 | 0,524 / 0,454 / 0,473 / 0,478 / 0,556 | 0,635 / 0,625 / 0,670 / 0,646 / 0,569 | 276 / 247 / 322 / 252 / 151 | 0 ×5 | **1 ×5**                  |

Pary FCP desktop4x (B−A): +0,165 / −0,009 / −0,024 / +0,110 / +0,140 s.

### 4.4 Księga Lantern: pierwsze zadanie Style (z Layout), obserwowane ms → symulowane

| Forma         | A obsDur (simDur)                          | B obsDur (simDur)                          |
| ------------- | ------------------------------------------ | ------------------------------------------ |
| mobile 1–5    | 53,2 / 55,4 / 54,8 / 50,6 / 56,3 (106–113) | 74,0 / 72,0 / 76,8 / 80,3 / 71,1 (142–161) |
| desktop4x 1–5 | 58,0 / 57,7 / 90,4 / 75,8 / 67,4 (115–181) | 91,1 / 95,0 / 92,7 / 94,6 / 95,0 (182–190) |

Rozkład w śladzie (`prove-tools/firststyle.cjs`): `UpdateLayoutTree` bez zmian (24–28 → 25–26 ms desktop,
22 → 22 ms mobile, ta sama liczba elementów), **`Layout` ok. 2×** (desktop 23,1/22,7 → 47,2/50,6 ms; mobile
20,1 → 42,5 ms) przy tej samej liczbie brudnych obiektów (699/587). Audyt `mainthread-work-breakdown`
„Style & Layout” (Lantern ×4): mobile A 372/380/412/363/396 → B 465/462/467/473/453 ms; desktop4x A
340/388/542/380/380 → B 543/473/457/506/506 ms. Zadanie leży przed obsFCP, więc na desktopie (FCP liczony z
CPU, tryb bez-js) przekłada się na +0,08 s FCP; na mobile FCP wyznacza sieć (1,37 s) i zadanie się mieści.
Brak zadań Google, TBT w szumie; P3.2b nie celował w żadną klasę zadań TBT.

### 4.5 Speedline (postęp wizualny, obserwowany)

| Przebieg      | pierwsza klatka z treścią  | 99%    | SI (speedline) |
| ------------- | -------------------------- | ------ | -------------- |
| A mobile 3    | 176 ms (35%), 271 ms (71%) | 296 ms | 250            |
| B mobile 3    | 279 ms (71%)               | 310 ms | 295            |
| A desktop4x 5 | 291 ms (71%)               | 348 ms | 312            |
| B desktop4x 4 | 364 ms (67%)               | 385 ms | 376            |

Obraz ten sam: pierwsze malowanie treści przesuwa się o czas dłuższego Layout. SI Lantern w szumie.

### 4.6 Audyty jednego przebiegu mobile (A-mobile-1 / B-mobile-1)

|                                 | A                                                                                 | B                              |
| ------------------------------- | --------------------------------------------------------------------------------- | ------------------------------ |
| żądania / transfer              | 70 / 909,2 KB                                                                     | 69 / 889,2 KB                  |
| fonty                           | latin 30 785 B (50–64 ms) + latin-ext 14 153 B (51–68 ms)                         | latin-pl 24 483 B (57–105 ms)  |
| arkusz                          | 70 162 B                                                                          | 70 407 B                       |
| LCP element                     | `img.eh-img` (cover.jpg), TTFB 20 / load delay 31 / load 10 / render delay 131 ms | to samo, 21 / 38 / 52 / 158 ms |
| highPriorityBytesBeforeLcpImage | 112,4 KB                                                                          | 92,7 KB                        |
| CLS                             | 0                                                                                 | 0                              |
| Main thread „Style & Layout”    | 372 ms                                                                            | 465 ms                         |

## 5. Podmiana fontu (`e2e-performance/font-swap-cls.spec.ts`, fonty wstrzymane do zwolnienia)

| Przypadek  | B (prawdziwy build)                         | A (kontrola negatywna)                    | IMPL emulacja B |
| ---------- | ------------------------------------------- | ----------------------------------------- | --------------- |
| desktop PL | 0,000285 ✓                                  | **0,002061 ✘**                            | 0,000285        |
| mobile PL  | 0,000617 ✓                                  | 0,000484 ✓                                | 0,000617        |
| desktop EN | 0,000325 ✓                                  | **0,021224 ✘** (linie tytułów/etykiet +1) | 0,000325        |
| mobile EN  | 0,000605 ✓ (1 nagłówek poniżej zgięcia 1→2) | 0,000286 ✓                                | 0,000605        |

Kontrola negatywna (A, ten sam spec, `swap-cls-base.log`): 2/4 czerwone, spec mierzy mechanizm. Build potwierdza emulację implementera co do bajtu. Lokalny Lighthouse ma CLS 0 także na bazie (fonty przed
pierwszym malowaniem), więc dowodem CLS po stronie produkcji jest ten spec + symulacja produkcji z IMPL §5.2.

## 6. Eksperyment przyczyny (Playwright, desktop 1350×940, bez dławienia, 7 przebiegów/wariant, mediana pierwszego Layout z > 300 brudnymi obiektami)

Skrypt: `$P/prove-tools/layout-exp/layout.exp.ts` (własna konfiguracja, serwer artefaktu jak `playwright.performance.config.ts`,
podmiany CSS/HTML/bajtów fontu przez `page.route`). Logi `layout-exp-*.log`.

| Wariant                                                            | pierwszy Layout | Layout łącznie |
| ------------------------------------------------------------------ | --------------- | -------------- |
| A0 baza                                                            | 10,6–12,1 ms    | 25–31 ms       |
| A1 baza + bajty nowego pliku pod URL-em latin                      | 11,3            | 24,8           |
| A3 baza + twarze RHD z B (główna bez preloadu)                     | 25,6            | 53,9           |
| A4 baza + 6 twarzy Fallback z B                                    | 11,2            | 25,8           |
| A12 baza, tylko URL twarzy głównej → plik bez preloadu (zakresy A) | 27,0            | 56,7           |
| A13 baza + zakresy B, główna pod preloadowanym URL-em              | **10,7**        | 25,0           |
| B0 kandydat                                                        | 23,6–24,3       | 44,6–50,4      |
| B1 kandydat, `local()` tylko Liberation                            | 23,0            | 48,2           |
| B2 kandydat, stos CMS bez „Fallback”                               | 24,3            | 48,7           |
| B3 kandydat, jedna twarz zastępcza jak A                           | 24,4            | 50,0           |
| B5 kandydat + bajty starego latin                                  | 28,6–45,9       | 52,0           |
| B8/B9 kandydat, litery PL jako osobna twarz tego samego pliku      | 26,7 / 27,2     | 53,7 / 55,6    |
| **B11 kandydat + preload `latin-ext` w HTML**                      | **11,0**        | 23,6           |
| **B12 kandydat BEZ twarzy `latin-ext` (jedna twarz RHD)**          | **9,9**         | 24,4           |

Wniosek: koszt pojawia się, gdy rodzina segmentowana „Red Hat Display” ma twarz, która w chwili pierwszego
Layout NIE jest załadowana (A3/A12: główna bez preloadu; B0: `latin-ext`, którego strona nigdy nie pobiera).
`document.fonts` w B0 przy DCL: `latin-ext` = `unloaded`, w B11/A0 obie twarze `loaded`. Nie zależy od kroju
zastępczego (A4, B1, B3), stosu z CMS (B2), bajtów fontu (A1, B5) ani zakresów `unicode-range` (A13).
Wariant B12 (jedyna twarz RHD) jest szybszy od bazy, B11 przywraca czas bazy kosztem drugiego żądania (sprzeczne z
decyzją „jeden font”).

## 7. Ocena wobec kryteriów i co poprawić

| Kryterium (PLAN-FALI-3 §2, P3.2b §11, notatki orkiestratora) | Wynik                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| jedno żądanie fontu w ścieżce LCP, PL i EN                   | **tak** (LH PL 10/10; e2e PL+EN; `fontPreloadCount` 1)                                 |
| brak `latin-ext`                                             | **tak**                                                                                |
| CLS = 0 w 5/5 mobile i desktop4x                             | **tak** (20/20); podmiana fontu ≤ 0,001 4/4                                            |
| FCP ±0                                                       | mobile **tak** (+0,009 s); desktop4x **nie** (+0,08 s mediana, mechanizm potwierdzony) |
| ΔLCP mobile w dół                                            | **tak**, −0,13 s (pary), istotne; większe od prognozy −0,03…−0,08 s                    |
| suma CSS w check:bundle (L2)                                 | zielona, 95,7/96 KB (+0,3 KB)                                                          |
| bootClosure bez wzrostu                                      | **tak**, −297 B raw / −136 B gz                                                        |

`effect_matches_plan = partly`: struktura i LCP mobile zgodne (z nadwyżką), CLS zgodny, ale desktopowe FCP rośnie
przez dłuższy pierwszy Layout. Poprawka (jedna runda dla implementera), w kolejności preferencji:

1. **Usunąć twarz `@font-face` `latin-ext` z `src/styles.css`** (i plik, jeśli nic go nie importuje) — dokładnie
   „jeden font Red Hat Display”; B12 daje pierwszy Layout 9,9 ms (lepiej niż baza). Koszt: znaki latin-ext spoza
   polskich liter (np. czeskie, rumuńskie diakrytyki w treści CMS) renderują się krojem zastępczym/systemowym —
   do decyzji orkiestratora/właściciela; testy `fontGlyphCoverage` (pkt 6: „dokładnie dwie twarze”) i L8 trzeba
   dostosować.
2. Jeśli twarz `latin-ext` ma zostać: znaleźć układ, w którym nie jest ona częścią tej samej rodziny używanej przez
   stos (np. osobna nazwa rodziny dołączona w stosie za RHD) i powtórzyć `layout.exp.ts` + A/B; preload `latin-ext`
   (B11) odpada, bo łamie zasadę jednego fontu.

Po poprawce powtórzyć: `font-swap-cls` (4/4), `single-font` (PL/EN), A/B desktop4x (FCP ±0, Style&Layout
pierwszego zadania ≈ baza).
