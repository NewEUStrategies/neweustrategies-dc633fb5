# P3.5 (fala 3) — dowód: bramka ruchu (autoplay, tickery i pętle treści po interakcji albo ciszy)

Data: 2026-10-08. A = baza fali 3 `7c924ae5` (`$SCRATCH/base-w3`, `.output` z bazy, bez przebudowy).
B = `perf/w3-P3.5` @ `5d667d7e` (`$SCRATCH/wt3/P3.5`), zbudowane w tym etapie: `BUNDLE_INVENTORY=1 bun run build:smoke`
przez mutex, kod 0 (`build.log`). Wszystkie pliki w `$SCRATCH/phase3/wave3/P3.5/`.

## 0. Werdykt

- **Bramki: wszystkie zielone** (check:bundle, check:chunks, check:entry-purity, check:server-entry-purity,
  test:e2e:artifact 12/12 z nowym specem, check:document-weight 28/28 po obu stronach).
- **Struktura: tak.** E2E na artefakcie B: bez interakcji hero i ticker stoją 12 s, pętle `paused`, cisza otwiera
  bramkę i hero przeskakuje pełny interwał później, `wheel` otwiera od razu. Ten sam spec na artefakcie bazy (kontrola
  negatywna, powtórzona w tym etapie): **3/3 czerwone** — na bazie hero przeskoczył `0 → 1 → 2` w 12 s bez interakcji.
- **Rozmiar efektu SI: nierozstrzygalny lokalnie** (zgodnie z planem §1: ślad harnessu kończy się ~3,5–4,1 s po
  nawigacji, a ostatnia klatka filmstripu jest w ~0,85–0,95 s; przeskok hero na bazie przypada na montaż + 4,5 s, poza
  śladem). Zysk SI (~+0,8 s obsSI na produkcji wg diagnozy) da się potwierdzić tylko sondą produkcyjną po wdrożeniu.
- **Lighthouse n = 5: bez regresji w kryteriach planu** (CLS 0 = 0, LCP Δ −0,006/−0,008 s, TBT Δ < 0 na obu formach).
  Mobile SI B−A = +0,088 s (σΔ 0,056, MDE(t) 0,093 — poniżej MDE) **wyjaśnione artefaktem Lantern** (§4.3): wczesna
  klatka przed JS (~210–240 ms obs.) jest w B tańsza (mediana 12,2 → 9,5 ms) i w 3/5 przebiegów spada poniżej progu
  10 ms grafu Lantern, wypada ze średniej layoutSI i podnosi SI. Po zrównaniu (bez tej klatki po obu stronach) SI
  mobile: mediana A 1825 ms / B 1826 ms, średnia różnic par +8 ms. Desktop4x SI −0,052 s.
- **Uwaga budżetowa (reguła orkiestratora „nie gorzej niż baza”):** overall +2,3 KB, public +1,9 KB, entry `index`
  +0,8 KB gz, boot +0,9 KB gz. To koszt nowego prymitywu w ścieżce bootu (ticker nagłówka jest w bocie) plus kod
  wideo/YouTube w `SimpleWidgets` (moduł siedzi w chunku wejściowym). Szczegóły i opcje w §2.1.

## 1. Bramki

| Bramka                                                                                            | Wynik                         | Uwagi                                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `build:smoke` (BUNDLE_INVENTORY=1, mutex)                                                         | zielone                       | `build.log`, kod 0                                                                                                                         |
| `check:bundle`                                                                                    | zielone                       | `check-bundle.log`; porównanie z bazą w §2                                                                                                 |
| `check:chunks`                                                                                    | zielone                       | 893 chunki, 6845 krawędzi, acykliczny; ścieżka bootu 10 chunków (jak baza)                                                                 |
| `check:entry-purity`                                                                              | zielone                       | `check-entry-purity.log`                                                                                                                   |
| `check:server-entry-purity`                                                                       | zielone                       | 1813 plików, leniwe tylko `stripe.mjs`                                                                                                     |
| `test:e2e:artifact` (mutex)                                                                       | **12/12**                     | boot-artifact ×5, boot-home pl/en + sesja, boot-timing ×3, `motion-gate.boot-home` ×3 (13,8 s / 25,9 s / 7,1 s) — `e2e-artifact.log`       |
| Kontrola negatywna: `motion-gate.boot-home.spec.ts` na artefakcie A (`NES_ARTIFACT_ROOT=base-w3`) | **3/3 czerwone (oczekiwane)** | sc.1: indeksy hero `[0]` → `[0,1,2]` w 12 s; sc.2/3: brak `data-motion="on"`, sonda `running` zamiast `paused` — `e2e-motion-base-neg.log` |
| `check-document-weight.ts` B                                                                      | 28/28 zielone                 | `document-weight.json`, `docweight-B.log`                                                                                                  |
| `check-document-weight.ts` A                                                                      | 28/28 zielone                 | `document-weight-base.json`, `docweight-A.log`                                                                                             |
| Lighthouse `--compare` n = 5 mobile + desktop4x                                                   | 20/20 ważnych                 | `ab.log`, `lh/`                                                                                                                            |

Nazwa speca: `e2e/motion-gate.boot-home.spec.ts` zamiast `e2e/motion-gate.spec.ts` — `playwright.artifact.config.ts`
bierze tylko `testMatch: /boot-(artifact|timing|home)\.spec\.ts$/` (odstępstwo 1 z IMPL.md; sprawdzone — spec jedzie w
`test:e2e:artifact`). Spec woła `page.goto("/")`; przeglądarka Playwrighta (en-US) ląduje na `/en` (log serwera) —
ta sama strona główna z tym samym hero z fixture.

## 2. Bundle (check:bundle; artefakt smoke po obu stronach, jak pomiar bazy orkiestratora)

| Metryka                          | A (baza)       | B (P3.5)       | Δ                         | Budżet                          |
| -------------------------------- | -------------- | -------------- | ------------------------- | ------------------------------- |
| Client JS overall (KB gz)        | 4752,0         | 4754,3         | **+2,3**                  | 4772 (zapas 17,7 KB, było 20,0) |
| public                           | 2801,7         | 2803,6         | **+1,9**                  | 2877                            |
| admin-only                       | 1950,2         | 1950,6         | +0,4                      | —                               |
| Największy chunk = entry `index` | 261,2          | 262,0          | **+0,8**                  | 286                             |
| CSS (wszystkie)                  | 95,0           | 95,0           | 0 (+33 B gz `styles.css`) | 96                              |
| public CSS                       | 81,2           | 81,2           | 0                         | 83                              |
| Boot closure (gz / raw)          | 486,8 / 1596,5 | 487,7 / 1598,4 | **+0,9 / +1,9**           | 579                             |

Linia B: `Boot closure: 487.7 KB gzip / 1598.4 KB raw  (10 chunków statycznie osiągalnych ze SSR-owego <script>; budget ≤ 579 KB)`.
Lista ruchów względem baseline'u `b006c2e` — identyczna jak na bazie poza `index` (−46,8 → −46,0 KB):
`+131.5 spreadsheet.worker (NOWY)`, `-46.0 index (354.6 -> 308.6)`, `-24.1 lucide-shim.fa`, `+16.5 club._clubSlug.index`,
`+7.5 admin.seo (NOWY)`, `+3.0 i18n-club`, `-2.5 category._slug`, `-2.5 icons-0`, `-2.5 icons-1`, `-2.4 profile.notifications`,
`-2.4 icons-3`, `+2.4 SeoPanel`, `znikł i18n-admin-seo-hub`.

Różnica per chunk (gzip -9 z `.output/public/assets`, `chunkdiff.txt`): 22 chunki, razem +3231 B raw / +1490 B gz;
największe: `index` +827 B gz, `RichTextView` +118, `animatedHeadingVariants` +115, `InteractiveCircleWidget` +62,
`WorldMapWidget` +45, `sectionLabelVariants` +41, `sliderVariants` +39, `NewsTickerView` +37, `styles.css` +33.

### 2.1 Skład wzrostu chunku wejściowego (`reports/chunk-inventory.json`, `index-moddiff.txt`; bajty raw po minifikacji)

| Moduł                                                                      | A      | B      | Δ raw                    |
| -------------------------------------------------------------------------- | ------ | ------ | ------------------------ |
| `widget-view/SimpleWidgets.tsx` (LoopingIcon, AutoplayVideo, YouTubeEmbed) | 60 573 | 62 257 | **+1684**                |
| `lib/performance/interactionOrQuiet.ts` (nowy)                             | 0      | 1488   | +1488                    |
| `lib/performance/motionGate.ts` (nowy)                                     | 0      | 729    | +729                     |
| `header/TrendingTicker.tsx` (bez `useDecorativeMotion`)                    | 41 515 | 41 216 | −299                     |
| `organisms/BuilderRenderer.tsx` (wideo tła)                                | 25 626 | 25 768 | +142                     |
| `ui/text-rotate.tsx`                                                       | 4040   | 4101   | +61                      |
| pozostałe (`hydrationIsland`, `firstInteraction`, URL-e CSS)               |        |        | +40                      |
| **Razem**                                                                  |        |        | **+3845** (≈ +0,8 KB gz) |

Ocena: wszystkie budżety zielone, ale reguła „nie gorzej niż baza” dla overall/public/entry/boot formalnie nie jest
spełniona. Minimum nieuniknione przez plan to prymityw + bramka w bocie (ticker nagłówka jest w ścieżce bootu): ok.
+1,9 KB raw netto (po zdjęciu `useDecorativeMotion`). Opcjonalne cięcie: kod wideo/YouTube/ikony w pętli w
`SimpleWidgets` (+1,7 KB raw, ~połowa wzrostu entry) trafia do bootu każdej strony, choć `/` go nie używa — można go
wynieść do osobnego, leniwego modułu (np. obok `lazyWidgets.tsx`). Decyzja dla orkiestratora; nie blokuje bramek.

## 3. Waga dokumentu (check-document-weight, fixture, po obu stronach)

| Metryka                                     | A         | B         | Δ         | Próg                                     |
| ------------------------------------------- | --------- | --------- | --------- | ---------------------------------------- |
| htmlRawBytes                                | 337 923   | 337 923   | 0         | 396,7 KB                                 |
| htmlGzipBytes                               | 52 608    | 52 608    | 0         | 56,4 KB                                  |
| headRawBytes                                | 28 985    | 28 985    | 0         | 28,7 KB (KiB: 28,3)                      |
| inlineStyleBytes                            | 84 717    | 84 717    | 0         | 132,4 KB                                 |
| inlineScriptBytes                           | 86 844    | 86 844    | 0         | 95,8 KB                                  |
| dehydratedStateBytes                        | 60 357    | 60 357    | 0         | 64,9 KB                                  |
| modulepreloadCount                          | 0         | 0         | 0         | 0                                        |
| preloadDuplicates                           | 3         | 3         | 0         | 3                                        |
| JS High przy starcie (preloadedJsGzipBytes) | 0         | 0         | 0         | 0                                        |
| imgFetchpriorityHigh                        | 1         | 1         | 0         | 2                                        |
| bootClosureRawBytes                         | 1 634 852 | 1 636 742 | +1890     | 1599,4 KiB                               |
| bootClosureGzipBytes                        | 495 036   | 495 907   | **+871**  | 485,0 KiB (B 484,3 KiB → zapas ~0,7 KiB) |
| bootBurstCount                              | 26        | 26        | 0         | 26                                       |
| bootBurstGzipBytes                          | 572 652   | 573 741   | **+1089** | 561,2 KiB (B 560,3 KiB → zapas ~0,9 KiB) |
| renderBlockingCssGzipBytes                  | 80 395    | 80 426    | +31       | 79,5 KiB                                 |
| preLcpTransferBytes                         | 177 735   | 177 766   | +31       | 177,3 KiB                                |

HTML `/` z fixture jest identyczny poza hashami zasobów (`lh/home-A.html` vs `home-B.html`; ta sama długość
330 868 B w harnessie, gzip 49 932 → 49 951 B). Na `/` w fixture **nie ma żadnego `data-motion-loop`** — pętle CSS w HTML
z SSR tej strony nie występują; hero jest bramkowany timerem JS. Do kolejnych pozycji fali: zapas
`bootClosureGzipBytes` ~0,7 KiB i `bootBurstGzipBytes` ~0,9 KiB.

## 4. Lighthouse A/B (fixture, fake-gtag, rozgrzewka bot, przeplot, n = 5)

Komenda: `lighthouse-local.mjs --compare base-w3 wt3/P3.5 --runs 5 --forms mobile,desktop4x --label w3-P3.5
--client-backend fixture --third-party fake-gtag --save-artifacts --warm-ua bot` (`ab.log`). Fałszywy gtag ×1,85
(benchmarkIndex 1997). VALID 5/5 na każdej stronie i formie, 0 wykluczonych, wariant dokumentu `s-maxage=900, 330868 B`
×5, tryb FCP `bez-js` ×5, par mieszanych 0/5. Księga Lantern = audyt TBT we wszystkich 20 przebiegach (OK).

### 4.1 Mediany i różnice

| Forma     | Strona | perf | FCP    | LCP    | TBT    | SI     | CLS   | TTI    | mainThread | bootup  | longTasks | req | transfer |
| --------- | ------ | ---- | ------ | ------ | ------ | ------ | ----- | ------ | ---------- | ------- | --------- | --- | -------- |
| mobile    | A      | 92   | 1,54 s | 2,29 s | 269 ms | 1,67 s | 0,000 | 5,45 s | 3402 ms    | 1589 ms | 9         | 70  | 913,5 KB |
| mobile    | B      | 93   | 1,53 s | 2,29 s | 252 ms | 1,72 s | 0,000 | 5,44 s | 3274 ms    | 1487 ms | 8         | 70  | 914,2 KB |
| mobile    | B−A    | +1   | −0,00  | −0,00  | −17    | +0,05  | ±0    |        | −128       | −102    |           | ±0  | +0,7 KB  |
| desktop4x | A      | 87   | 0,47 s | 0,56 s | 309 ms | 0,70 s | 0,000 | 1,43 s | 3653 ms    | 1701 ms | 10        | 75  | 919,2 KB |
| desktop4x | B      | 89   | 0,47 s | 0,56 s | 278 ms | 0,65 s | 0,000 | 1,33 s | 3409 ms    | 1611 ms | 9         | 75  | 919,8 KB |
| desktop4x | B−A    | +2   | +0,00  | +0,00  | −31    | −0,05  | ±0    |        | −244       | −90     |           | ±0  | +0,6 KB  |

PAIRS (n = 5, t(df=4) = 3,72):

| Forma     | Metryka | Δ        | σΔ    | MDE(t) |
| --------- | ------- | -------- | ----- | ------ |
| mobile    | score   | +1,2     | 1,6   | 2,7    |
| mobile    | FCP     | −0,006 s | 0,010 | 0,016  |
| mobile    | LCP     | −0,008 s | 0,016 | 0,026  |
| mobile    | TBT     | −48 ms   | 68    | 113    |
| mobile    | SI      | +0,088 s | 0,056 | 0,093  |
| mobile    | TTI     | +0,026 s | 0,101 | 0,169  |
| desktop4x | score   | +2,8     | 4,7   | 7,7    |
| desktop4x | FCP     | 0,000 s  | 0,053 | 0,089  |
| desktop4x | LCP     | −0,006 s | 0,033 | 0,056  |
| desktop4x | TBT     | −49 ms   | 81    | 135    |
| desktop4x | SI      | −0,052 s | 0,039 | 0,064  |
| desktop4x | TTI     | −0,077 s | 0,201 | 0,334  |

Przebiegi (A / B):

| #   | mobile perf | mobile LCP  | mobile TBT | mobile SI   | d4x perf | d4x LCP     | d4x TBT   | d4x SI      |
| --- | ----------- | ----------- | ---------- | ----------- | -------- | ----------- | --------- | ----------- |
| 1   | 90 / 93     | 2,31 / 2,28 | 349 / 252  | 1,58 / 1,70 | 91 / 90  | 0,57 / 0,56 | 250 / 257 | 0,76 / 0,65 |
| 2   | 92 / 91     | 2,31 / 2,29 | 269 / 320  | 1,63 / 1,77 | 87 / 89  | 0,56 / 0,53 | 309 / 278 | 0,72 / 0,69 |
| 3   | 93 / 95     | 2,29 / 2,30 | 262 / 173  | 1,71 / 1,83 | 83 / 92  | 0,54 / 0,57 | 385 / 225 | 0,70 / 0,69 |
| 4   | 92 / 92     | 2,29 / 2,30 | 274 / 270  | 1,67 / 1,69 | 83 / 89  | 0,54 / 0,56 | 381 / 279 | 0,69 / 0,64 |
| 5   | 95 / 97     | 2,29 / 2,29 | 192 / 93   | 1,68 / 1,72 | 91 / 89  | 0,58 / 0,53 | 244 / 282 | 0,62 / 0,56 |

Kryteria planu: CLS ≤ 0,001 — **tak** (0 we wszystkich 20 przebiegach); LCP ±0,02 s — **tak** (mediany równe, Δ par
−0,008 / −0,006 s); kierunek TBT ≤ 0 — **tak** (mediany −17 / −31 ms, pary −48 / −49 ms; w szumie, MDE 113 / 135 ms).

### 4.2 Księga Lantern per zadanie (blokowanie per klasa, 5 przebiegów)

| Klasa                                                          | A mobile          | B mobile         | A desktop4x        | B desktop4x       |
| -------------------------------------------------------------- | ----------------- | ---------------- | ------------------ | ----------------- |
| ScriptCatchup                                                  | 169 101 108 89 88 | 92 141 62 143 11 | 49 106 177 177 121 | 99 95 95 116 105  |
| Style                                                          | 51 91 53 122 46   | 87 65 77 62 40   | 93 4 132 128 65    | 114 117 94 101 26 |
| Script:vendor-react                                            | 38 73 101 30 45   | 44 81 22 49 20   | 36 22 49 58 32     | 37 44 16 46 41    |
| Timer:index                                                    | 9 3 14 13         | 20 24 9 22       | 3 6 13 5 12        | 8 18 11 24        |
| Script:(dokument)                                              | —                 | —                | 143 2              | 86                |
| inne (Other, Script, Timer, ParseHTML, ParseCSS, Script:pl, …) | pojedyncze 1–47   | pojedyncze 3–12  | pojedyncze 1–49    | pojedyncze 1–16   |

Brak nowej klasy zadań w B; brak zadań timera autoplay w obu stronach (timery hero startują po montażu + 4,5 s, poza
oknem śladu). Klasy docelowe P3.5 nie występują w oknie TBT harnessu — pozycja nie celuje w TBT.

### 4.3 Speed Index: speedline i rozkład Lantern

Speedline (`speedline-core`, jak Lighthouse) — wszystkie 20 śladów: ostatnia klatka filmstripu 0,82–0,97 s (mobile),
0,84–0,94 s (desktop4x); ślad kończy się 3,5–4,1 s. **B: zero zmian klatek po ustaleniu się widoku** (progres 100% od
~0,9 s do końca śladu). A w harnessie też nie ma późnych klatek (przeskok hero na bazie wypada ~5 s+, poza śladem) —
różnicy „autoplay w filmstripie” lokalnie nie da się pokazać; pokazuje ją e2e (B stoi 12 s, A przeskakuje 2×).
Przykład B-mobile-1: `331 ms 61% → 378 ms 99% → 533 ms 99% → 946 ms 100%` (A-mobile-1: `345 → 383 → 542 → 945 ms`).

Rozkład Lantern (`si/lantern-si.mjs` na zapisanych artefaktach, `si/lantern-si-all.txt`; SI = 1,4·obsSI + 0,4·layoutSI,
oba ≥ FCP pes.):

| Przebieg   | SI   | obsSI | layoutSI | węzły z Layout | wczesna klatka ~200–250 ms (obs.) | layoutSI / SI bez wczesnej klatki |
| ---------- | ---- | ----- | -------- | -------------- | --------------------------------- | --------------------------------- |
| A-mobile-1 | 1583 | 284   | 2964     | 6              | 11,1 ms (w grafie)                | 3200 / 1677                       |
| A-mobile-2 | 1630 | 252   | 3194     | 6              | 12,3 ms (w grafie)                | 3523 / 1762                       |
| A-mobile-3 | 1710 | 269   | 3335     | 5              | 12,2 ms (w grafie)                | 3728 / 1867                       |
| A-mobile-4 | 1668 | 240   | 3329     | 5              | 11,0 ms (w grafie)                | 3720 / 1825                       |
| A-mobile-5 | 1681 | 258   | 3299     | 5              | 12,6 ms (w grafie)                | 3701 / 1842                       |
| B-mobile-1 | 1705 | 261   | 3349     | 5              | 10,5 ms (w grafie)                | 3722 / 1854                       |
| B-mobile-2 | 1774 | 232   | 3622     | 4              | 9,5 ms (**odcięta**)              | 3622 / 1774                       |
| B-mobile-3 | 1826 | 255   | 3673     | 4              | 8,9 ms (**odcięta**)              | 3673 / 1826                       |
| B-mobile-4 | 1687 | 265   | 3289     | 5              | 14,3 ms (w grafie)                | 3678 / 1843                       |
| B-mobile-5 | 1718 | 231   | 3484     | 5              | 8,9 ms (**odcięta**)              | 3484 / 1718                       |

Mechanizm: `PageDependencyGraph` Lantern (trace_engine, `SIGNIFICANT_DUR_THRESHOLD_MS = 10`) przycina zadania CPU
< 10 ms (poza pierwszym Layout/Paint/ParseHTML). Wczesna klatka (UpdateLayoutTree + Layout + Paint, PRZED wykonaniem JS)
kończy się w symulacji ~1,4–1,6 s i ciągnie średnią layoutSI w dół. W B jest krótsza (mobile mediana 12,2 → 9,5 ms;
desktop4x 15,5–25,2 → 8,2–11,9 ms; mniej elementów w przeliczeniu stylu, np. 193 → 35), więc w 3/5 przebiegów mobile
wypada z grafu, a średnia layoutSI rośnie o ~0,3–0,4 s → SI +0,1–0,15 s w tych parach. Po wyłączeniu tej klatki po obu
stronach: SI mobile mediana A 1825 / B 1826 ms, średnia różnic par +8 ms. obsSI (prawdziwy filmstrip) w B jest niższe
(mediana 255 vs 258 ms; perceptualSI speedline B 330–370 vs A 345–378 ms). Ta klatka powstaje przed JS, a HTML jest
identyczny — przyczyną skrócenia nie jest runtime bramki (który rusza po boocie); to szum harmonogramu klatek względem
parsowania strumienia HTML/CSS. Wniosek: +0,088 s mobile SI to artefakt progu Lantern, nie regres pracy ani klatek.
Desktop4x (tam klatka zwykle zostaje w grafie, 4/5 B ≥ 10 ms): SI −0,052 s.

### 4.4 Audyty jednego przebiegu mobile (A-mobile-1 vs B-mobile-1)

|                                                             | A                          | B                          |
| ----------------------------------------------------------- | -------------------------- | -------------------------- |
| Żądania / transfer                                          | 70 / 913,5 KB              | 70 / 914,2 KB              |
| High / VeryHigh / Low                                       | 67 (800,7 KB) / 2 / 1      | 67 (801,4 KB) / 2 / 1      |
| highPriorityBytesBeforeLcpImage                             | 112,3 KB                   | 112,4 KB                   |
| Element LCP                                                 | `img.eh-img` (`cover.jpg`) | `img.eh-img` (`cover.jpg`) |
| LCP: TTFB / opóźnienie ładowania / ładowanie / render delay | 31 / 28 / 24 / 180 ms      | 21 / 28 / 9 / 177 ms       |
| CLS                                                         | 0,000                      | 0,000                      |
| Main thread (total / Script Eval / Style&Layout)            | 3675 / 1757 / 491 ms       | 3491 / 1608 / 567 ms       |
| Bootup total                                                | 1748 ms                    | 1633 ms                    |
| Render-blocking CSS                                         | 68,5 KB, wasted 463 ms     | 68,5 KB, wasted 456 ms     |

## 5. Ocena wobec kryteriów dowodu (PLAN-FALI-3 §2 P3.5)

| Kryterium                                                                                                      | Wynik                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Testy jednostkowe (fake timers, prerender/serwer, reduced motion)                                              | wykonane przez implementera (153 pliki, 4416 passed, mutacje 22/22) i recenzenta (23 + 11 plików zielone); nie powtarzane tutaj |
| E2E: `/` fixture first-visit, 12 s bez interakcji → hero i ticker bez zmian, `getAnimations()` treści `paused` | **tak** (B zielone; A czerwone 3/3)                                                                                             |
| E2E: po `wheel` slajd zmienia się po interwale                                                                 | **tak**                                                                                                                         |
| LH n = 5: CLS ≤ 0,001, LCP ±0,02 s, kierunek TBT ≤ 0                                                           | **tak** (mobile i desktop4x)                                                                                                    |
| Speedline B: brak zmian klatek po ustaleniu się widoku z powodu autoplay                                       | **tak** (ale w oknie śladu harnessu baza też ich nie ma — plan §1)                                                              |
| check:bundle, document-weight zielone                                                                          | **tak**; wzrost względem bazy: boot +0,9 KB gz, overall +2,3 KB (§2.1)                                                          |

**effect_matches_plan = yes** (struktura potwierdzona e2e z kontrolą negatywną; brak regresji w kryteriach LH), z
zastrzeżeniem: rozmiar zysku SI jest **nierozstrzygalny lokalnie** (harness nie odtwarza kary za autoplay) — do
potwierdzenia sondą produkcyjną po wdrożeniu (filmstrip PSI/LH live: brak przeskoku hero w 4,5–8 s).
**needs_fix = false** — żadna bramka nie jest czerwona. Do decyzji orkiestratora: wzrost bundla względem bazy
(nieunikniony prymityw w bocie + opcjonalnie do wyniesienia kod wideo/YouTube z `SimpleWidgets`, ~+1,7 KB raw w entry).

## 6. Pliki

`build.log`, `check-bundle.log`, `check-chunks.log`, `check-entry-purity.log`, `check-server-entry-purity.log`,
`chunkdiff.mjs`/`chunkdiff.txt`, `index-moddiff.txt`, `e2e-artifact.log`, `e2e-motion-base-neg.log`,
`document-weight.json`, `document-weight-base.json`, `docweight-A.log`, `docweight-B.log`, `docweight-diff.txt`,
`ab.log`, `lh/` (20 przebiegów z artefaktami, księgami i audytami), `speedline-summary.txt`, `si/lantern-si.mjs`,
`si/lantern-si-all.txt`, `si/task-at.cjs`, `layouttasks.cjs`, `tracespan.cjs`.
