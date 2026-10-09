# P3.2a (fala 3, partia 4a): dowód po rundzie poprawek 9 (Prove 2)

Data: 2026-10-09. A = baza partii 4a `base-w3g` @ `64dddffe` (zbudowana przez orkiestratora, bez przebudowy).
B = worktree `wt3/P3.2a` @ `34612379` (gałąź `perf/w3-P3.2a`, drzewo czyste; runda 9 wyjęła część D / LP-6).
Build B: `env BUNDLE_INVENTORY=1 bun run build:smoke` przez mutex, exit 0 (`built in 2m 27s`).

Wszystkie logi i surowe dane: `$SCRATCH/phase3/wave3/P3.2a/prove2/`:
`build.log`, `check:*.log`, `document-weight.json` (B) / `document-weight-base.json` (A), `e2e-artifact.log`,
`ab.log` + `lh/` (A/B 5 × mobile i 5 × desktop4x, z artefaktami), `html/` (dokument `/` z fixture),
`chunkdiff.py`, `cover-timing.py`.

## 0. Werdykt

| Kryterium (nota orkiestratora, plan P3.2a §5, PROVE rundy 1 §8)                                                              | Wynik                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bramki artefaktu: `check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity`, `check-document-weight` | **wszystkie zielone** (B i A)                                                                                                                                                                                                                                                                                         |
| `test:e2e:artifact` (env CI) z testami pozycji                                                                               | **35/35 zielone** (było 37 z 2 testami logo D; teraz 4 testy `hero-srcset.boot-home.spec.ts`)                                                                                                                                                                                                                         |
| `bootClosureGzipBytes` Δ ≤ +300 B (plan §5.1)                                                                                | **+170 B** (było +331 w rundzie 1). Spełnione, zapas progu bramki 1 532 B                                                                                                                                                                                                                                             |
| Brak żądania `data:` na telefonie, `req` 41 jak w A                                                                          | **TAK**: 0 żądań `data:image` w `devtoolsLog` w 20/20 przebiegach, `req` 41 / 41 (mobile), 43 / 43 (desktop)                                                                                                                                                                                                          |
| Lantern mobile LCP sym. − FCP sym. = 600 ms jak w A                                                                          | **TAK w 3/5 B** (600 ms, opt = pes). 2/5 B (643 / 650 ms) to znany dwumodalny wariant grafu, który ma też baza (A 5/10 w serii `lh2` rundy 1, ta sama sygnatura), a nie skutek P3.2a (§5)                                                                                                                             |
| Preload = kandydat LCP, `imagePreloadNonCandidate` 0, `imgEagerNonCandidate` 0                                               | **TAK** (0 / 0, `imagePreloadCount` 3 / 3, `headRawBytes` Δ 0, nagłówek `Link` bajt w bajt)                                                                                                                                                                                                                           |
| Bajty `srcset` w dół                                                                                                         | fixture: brak `srcset` (0 → 0, nowe metryki 0 / 0). Dokument `/` B: atrybuty `sizes` 13 → 2 (748 → 38 B), HTML −708 B raw. d2 (symulacja planu, produkcja) bez zmian względem rundy 1: `srcset` 70 785 → 46 879 B                                                                                                     |
| Żądanie hero 640w na telefonie (KRYTYKA L6, strona testowa z prawdziwym `srcset`)                                            | **TAK** w Chromium 1194: 412 × 823 @ 1,75 → jedno żądanie 640w; dawne `100vw` → 768w; desktop 1350 @ 1 → 768w bez zmian; artefakt `/` hero 32 px marginesu                                                                                                                                                            |
| ΔLCP mobile ≤ −0,1 s albo raport                                                                                             | **raport**: na fixture nie da się zmierzyć (obraz LCP bez `srcset`). Mediana ΔLCP −0,02 s, pary +0,041 s (σΔ 0,076, MDE 0,127) - w szumie. Oczekiwany zysk produkcyjny (−60…−80 ms) do potwierdzenia po wdrożeniu (§5.4 planu)                                                                                        |
| CLS 0                                                                                                                        | desktop 0 w 10/10. Mobile: B-mobile-5 CLS 0,358 na kolumnie post-listy `…01b` - ta sama wada bazy co w rundzie 1 (A miała 0,126 na tym samym węźle). Nie jest skutkiem P3.2a (§6)                                                                                                                                     |
| `check:bundle` nie gorszy od bazy                                                                                            | **liczbowo +1,0 KB overall / +0,6 public / +0,1 wejście / +0,2 boot** - ale po normalizacji nazw-hashy chunków realny przyrost kodu to **+208 B gz** w całym JS (+227 B raw w 4 chunkach); pozostałe +768 B to entropia nowych hashy w 651 chunkach o identycznej długości raw (§1.1). Nieblokujące, w budżecie planu |

**`effect_matches_plan = yes`** (struktura) z **rozmiarem nierozstrzygalnym na fixture** (inconclusive): oba
naruszenia z rundy 1 (Lantern +75 ms z `data:` i boot +331 B gz) zniknęły, struktura A+B+C jest zgodna z planem, a
zmiany Lighthouse mieszczą się w MDE w obu formach. Zysku 640w na LCP nie da się pokazać na fixture (KRYTYKA L6), więc
dowód wielkości przechodzi do pomiaru produkcyjnego po wdrożeniu.

**`needs_fix = false`.** Żadna bramka nie jest czerwona, a kryteria planu są spełnione.

## 1. Bramki artefaktu

| Bramka                                 | A (`base-w3g`)              | B (P3.2a rnd 9)                                                | Δ           | Wynik                               |
| -------------------------------------- | --------------------------- | -------------------------------------------------------------- | ----------- | ----------------------------------- |
| `build:smoke` (BUNDLE_INVENTORY=1)     | —                           | exit 0                                                         | —           | zielony                             |
| `check:bundle` overall                 | 4752,9 / 4772 KB            | 4753,9 KB                                                      | +1,0        | zielony (zapas 18,1 KB)             |
| public JS                              | 2803,1 / 2877 KB            | 2803,7 KB                                                      | +0,6        | zielony                             |
| admin-only                             | 1949,8 KB                   | 1950,2 KB                                                      | +0,4        | —                                   |
| largest chunk (`index`, wejście)       | 261,2 / 286 KB              | 261,3 KB                                                       | +0,1        | zielony                             |
| CSS all / public                       | 95,8 / 81,5 KB              | 95,8 / 81,5 KB                                                 | 0           | zielony (zapas 0,2 KB nienaruszony) |
| **Boot closure**                       | 486,8 KB gz / 1594,3 KB raw | **487,0 KB gz / 1594,4 KB raw**                                | +0,2 / +0,1 | zielony                             |
| `check:chunks`                         | —                           | 894 chunki, 6860 krawędzi, acykliczny                          | —           | zielony                             |
| `check:entry-purity`                   | —                           | `index-CXpW_lJ-.js` → 10 chunków, „Sciezka bootowania czysta”  | —           | zielony                             |
| `check:server-entry-purity`            | —                           | 1822 pliki, czysty (leniwe: stripe; dług: node-html-parser ×2) | —           | zielony                             |
| `test:e2e:artifact` (env CI)           | —                           | **35/35** w 1,7 min                                            | —           | zielony                             |
| `check-document-weight` (5 próbek HIT) | zielony                     | zielony                                                        | —           | zielony (§2)                        |

Linia `Boot closure` (B):
`Boot closure: 487.0 KB gzip / 1594.4 KB raw  (10 chunków statycznie osiągalnych ze SSR-owego <script>; budget ≤ 579 KB)`

Lista ruchów `check:bundle` (B) względem baseline'u b006c2e - te same pozycje co na bazie, P3.2a nie dodaje nowej:

```
+  131.5 KB  spreadsheet.worker (NOWY)  (0.0 -> 131.5)
  -46.7 KB  index  (354.6 -> 307.9)
  -24.1 KB  lucide-shim.fa  (42.0 -> 17.9)
+   16.5 KB  club._clubSlug.index  (23.1 -> 39.6)
+    7.5 KB  admin.seo (NOWY)  (0.0 -> 7.5)
+    3.0 KB  i18n-club  (38.3 -> 41.3)
   -2.5 KB  category._slug / icons-0 / icons-1; -2.4 KB profile.notifications / icons-3; +2.4 KB SeoPanel; znikł i18n-admin-seo-hub
```

### 1.1 Skąd +1,0 KB overall (`chunkdiff.py`, gzip -9 per plik)

| składnik                                                                                       | chunki |    Δ raw |   Δ gzip |
| ---------------------------------------------------------------------------------------------- | -----: | -------: | -------: |
| zmieniony kod (`index` wejście +152, `SpeakersWidget` +29, `expand` +29, `sliderVariants` +17) |      4 | **+227** |     +199 |
| tylko inne nazwy-hashe importów (długość raw identyczna)                                       |    651 |        0 |     +777 |
| **razem**                                                                                      |    655 |     +227 |     +976 |
| razem po zastąpieniu hashy `-XXXXXXXX.js` stałym ciągiem                                       |      — |        — | **+208** |

Przyrost kodu jest więc ok. +0,2 KB gz w całym JS; reszta to entropia nowych hashy (zmiana hashu wejścia zmienia
ciągi importów w setkach chunków). Pozycja z natury dodaje kod (drabina, `renderedMediaUrl`, margines kolumny,
strażnik awatarów), a plan §5.1 dopuszcza do +300 B gz w domknięciu bootu. Nieblokujące.

## 2. Waga dokumentu (`check-document-weight`, mediany 5 próbek HIT, fixture `/`)

| metryka                                       |           A |           B |        Δ |        próg | uwagi                                                                                |
| --------------------------------------------- | ----------: | ----------: | -------: | ----------: | ------------------------------------------------------------------------------------ |
| htmlRawBytes                                  |     328 326 |     327 618 | **−708** |     406 180 | IMPL szacował −730. §2.2.3: `sizes` bez `srcset` znika (13 → 2 atrybuty, 748 → 38 B) |
| htmlGzipBytes                                 |      49 848 |      49 677 |     −171 |           — |                                                                                      |
| headRawBytes                                  |      25 669 |      25 669 |    **0** |           — | zgodnie z planem                                                                     |
| inlineStyleCount / Bytes                      | 26 / 71 363 | 26 / 71 363 |        0 |      50 / — |                                                                                      |
| inlineCssCommentBytes                         |         517 |         517 |        0 | 517 (= cap) |                                                                                      |
| inlineScriptBytes                             |      87 551 |      87 564 |      +13 |           — |                                                                                      |
| inlineExecutableScriptBytes                   |      80 304 |      80 317 |      +13 |           — |                                                                                      |
| dehydratedStateBytes                          |      61 047 |      61 060 |      +13 |           — | `heroPreloads[].imageSizes` z marginesem kolumny (część C)                           |
| modulepreloadCount                            |           0 |           0 |        0 |           0 |                                                                                      |
| linkHeaderEntries                             |           4 |           4 |        0 |           5 | nagłówek `Link` bajt w bajt                                                          |
| preloadDuplicates / documentPreloadDuplicates |       2 / 0 |       2 / 0 |        0 |       3 / 0 | `cover.jpg` i font w `<head>` + `Link` (jak w bazie)                                 |
| imagePreloadCount                             |           3 |           3 |    **0** |           3 | logo leniwe, bez auto-preloadu React (jak w bazie)                                   |
| imgFetchpriorityHigh                          |           1 |           1 |        0 |           2 |                                                                                      |
| fontPreloadCount                              |           1 |           1 |        0 |   1 (= cap) |                                                                                      |
| bootClosureRawBytes                           |   1 632 545 |   1 632 697 |     +152 |   1 637 758 |                                                                                      |
| **bootClosureGzipBytes**                      |     494 977 |     495 147 | **+170** |     496 679 | plan ≤ +300 - **spełnione** (rnd 1: +331)                                            |
| preloadedJsCount / GzipBytes (pula High JS)   |       0 / 0 |       0 / 0 |        0 |       0 / — |                                                                                      |
| renderBlockingCssGzipBytes                    |      80 765 |      80 765 |        0 |           — |                                                                                      |
| lcpCandidateCount / Missing                   |       1 / 0 |       1 / 0 |        0 |       2 / 0 |                                                                                      |
| imgEagerNonCandidate                          |           0 |           0 |    **0** |           0 |                                                                                      |
| imagePreloadNonCandidate                      |           0 |           0 |    **0** |           0 |                                                                                      |
| linkHeaderDisallowed                          |           0 |           0 |        0 |           0 |                                                                                      |
| preLcpTransferBytes                           |     154 985 |     154 814 |     −171 |    177,3 KB |                                                                                      |
| srcsetCandidatesMax (nowa)                    |           — |           0 |        — |           5 | fixture nie ma `srcset`                                                              |
| absoluteCanonicalMediaInRenderedSrcset (nowa) |           — |           0 |        — |           0 |                                                                                      |
| bootEntryMissing                              |           0 |           0 |        0 |           0 |                                                                                      |
| bootBurstCount                                |          26 |          26 |        0 |  26 (= cap) |                                                                                      |
| bootBurstGzipBytes                            |     572 197 |     572 388 |     +191 |     574 673 |                                                                                      |

Plik wejściowy domknięcia: `index-*.js` 859 185 → 859 337 B raw (+152), gzip 265 964 → 266 135 (+171). Pozostałe 9
plików domknięcia bez zmian. Mediany A zgadzają się ze stanem bazy orkiestratora (`document-weight-2.json`; jedynie
`htmlGzipBytes` 49 848 vs 49 837, rozrzut kompresji). Progów nie ruszałem (żaden ratchet; nowe klucze P3.2a już były).

Dokument `/` (fixture, `html/A.html` i `html/B.html`):

- logo `site-logo-img` nagłówka desktopowego: w B `<img loading="lazy" fetchPriority="auto">` **bez** `<picture>`,
  `<source>` i `data:` - tak jak w bazie, różni się tylko brakiem atrybutu `sizes` (SVG bez `srcset`, §2.2.3);
- `<picture>` 0 / 0, `data:image/gif` 0 / 0;
- `<img data-lcp-candidate>` hero i `<link rel=preload as=image>` bez zmian; nagłówek `Link` identyczny.

d2 (produkcja, symulacja planu z rundy 1, kod A/B/C się nie zmienił): HTML 500 741 → 475 076 B raw (−25 665), gz
73 603 → 72 927, `<head>` 31 792 → 30 934, `Link` 2 138 → 1 279 B, `srcSet` 70 785 → 46 879 B. Bez części D d2 jest
mniejsze jeszcze o ok. 162 B (`<picture>` logo).

## 3. e2e artefaktu (env CI: `NES_ARTIFACT_FIXTURE=1` + atrapy `SUPABASE_*`)

35 passed (1,7 min). Testy pozycji (`e2e/hero-srcset.boot-home.spec.ts`, 4/4):

| test                                                                                         | wynik |
| -------------------------------------------------------------------------------------------- | ----- |
| telefon PSI 412 × 823 @ 1,75: `sizes` z marginesem kolumny → jedno żądanie, wariant **640w** | ✓     |
| REGRESJA UDOKUMENTOWANA: dawne `100vw` na telefonie → 768w                                   | ✓     |
| desktop PSI 1350 × 940 @ 1: kolumna 6/12 (`50vw`) → 768w bez zmian                           | ✓     |
| artefakt `/` 412 × 823: margines kolumny hero = 32 px (`MOBILE_COLUMN_GUTTER_PX`)            | ✓     |

Pozostałe: `boot-artifact`, `boot-home`, `backend-quiet`, `boot-timing`, `content-visibility` (z testami kotwic P3.3),
`legal-links`, `motion-gate`, `single-font` - zielone. Testy logo D (2) zostały usunięte razem z D.

## 4. Lighthouse A/B (5 × mobile, 5 × desktop4x, przeplot, fixture, h2, fake-gtag, rozgrzewka bot)

`VALID`: A i B po 5/5 w obu formach, excluded 0, tryb FCP „bez-js” 5/5, restart serwera 1/5 na stronę.
Wariant dokumentu: A `s-maxage=900, 321271 B`, B `320563 B` (×5, HIT). Obciążenie < 2,4 przy każdym przebiegu.

### 4.1 Mediany i DELTA B−A

| forma     | strona | perf |    FCP |       LCP |    TBT |     SI |   CLS |    TTI | mainThread | bootup |    req | transfer |       js |
| --------- | ------ | ---: | -----: | --------: | -----: | -----: | ----: | -----: | ---------: | -----: | -----: | -------: | -------: |
| mobile    | A      |   98 | 1,41 s |    2,01 s |  95 ms | 1,41 s | 0,000 | 4,30 s |       2685 |   1287 |     41 | 792,3 KB | 545,6 KB |
| mobile    | B      |   97 | 1,39 s |    1,99 s | 120 ms | 1,48 s | 0,000 | 4,28 s |       2837 |   1350 | **41** | 792,4 KB | 545,8 KB |
| mobile    | Δ      |   −1 |  −0,02 | **−0,02** |    +26 |  +0,07 |    ±0 |  −0,02 |       +152 |    +63 |  **0** |  +0,1 KB |  +0,2 KB |
| desktop4x | A      |   93 | 0,48 s |    0,54 s | 223 ms | 0,60 s | 0,000 | 1,19 s |       2947 |   1351 |     43 | 797,2 KB | 550,4 KB |
| desktop4x | B      |   88 | 0,42 s |    0,51 s | 287 ms | 0,65 s | 0,000 | 1,27 s |       3101 |   1531 |     43 | 797,3 KB | 550,6 KB |
| desktop4x | Δ      |   −5 |  −0,06 |     −0,03 |    +64 |  +0,04 |    ±0 |  +0,08 |       +154 |   +180 |      0 |  +0,1 KB |  +0,2 KB |

`highPriorityBytesBeforeLcpImage` 92,7 KB → 92,7 KB w obu formach.

### 4.2 Pary (n = 5, t(df 4) = 3,72)

| forma     | metryka |    Δ̄ par |    σΔ | MDE(t) | ocena                                            |
| --------- | ------- | -------: | ----: | -----: | ------------------------------------------------ |
| mobile    | perf    |     −4,4 |   7,7 |   12,8 | w MDE (B-mobile-5 CLS 0,358 → perf 81, §6)       |
| mobile    | FCP     | +0,023 s | 0,051 |  0,084 | w MDE                                            |
| mobile    | LCP     | +0,041 s | 0,076 |  0,127 | w MDE (2 przebiegi B w wariancie 650 ms, §5)     |
| mobile    | TBT     |   +37 ms |    68 |    113 | w MDE (A/A σΔ ~110 ms)                           |
| mobile    | SI      | +0,044 s | 0,051 |  0,084 | w MDE; obserwowany SI (speedline) B lepszy, §4.4 |
| mobile    | TTI     | −0,043 s | 0,060 |  0,100 | w MDE                                            |
| desktop4x | perf    |     −3,4 |   7,5 |   12,5 | w MDE (TBT)                                      |
| desktop4x | FCP     | −0,054 s | 0,076 |  0,126 | w MDE                                            |
| desktop4x | LCP     | −0,020 s | 0,039 |  0,065 | w MDE                                            |
| desktop4x | TBT     |   +55 ms |   121 |    202 | w MDE (A/A σΔ ~130 ms)                           |
| desktop4x | SI      | −0,007 s | 0,124 |  0,206 | w MDE                                            |
| desktop4x | TTI     | +0,021 s | 0,317 |  0,527 | w MDE                                            |

### 4.3 Przebiegi

| przebieg    | A: perf / FCP / LCP / TBT / SI / CLS | B: perf / FCP / LCP / TBT / SI / CLS          |
| ----------- | ------------------------------------ | --------------------------------------------- |
| mobile-1    | 97 / 1,41 / 2,01 / 159 / 1,41 / 0    | 97 / 1,39 / 1,99 / 153 / 1,50 / 0             |
| mobile-2    | 99 / 1,40 / 2,00 / 61 / 1,40 / 0     | 98 / 1,39 / 1,99 / 113 / 1,39 / 0             |
| mobile-3    | 98 / 1,41 / 2,01 / 102 / 1,41 / 0    | 95 / 1,48 / 2,12 / 217 / 1,48 / 0             |
| mobile-4    | 98 / 1,41 / 2,01 / 95 / 1,41 / 0     | 98 / 1,50 / 2,15 / 39 / 1,50 / 0              |
| mobile-5    | 99 / 1,39 / 1,99 / 42 / 1,39 / 0     | **81** / 1,38 / 1,98 / 120 / 1,38 / **0,358** |
| desktop4x-1 | 92 / 0,41 / 0,49 / 231 / 0,60 / 0    | 91 / 0,47 / 0,52 / 249 / 0,65 / 0             |
| desktop4x-2 | 93 / 0,43 / 0,51 / 219 / 0,64 / 0    | 86 / 0,37 / 0,51 / 332 / 0,57 / 0             |
| desktop4x-3 | 93 / 0,51 / 0,56 / 223 / 0,60 / 0    | 88 / 0,44 / 0,52 / 287 / 0,63 / 0             |
| desktop4x-4 | 94 / 0,49 / 0,54 / 200 / 0,55 / 0    | 82 / 0,35 / 0,50 / 404 / 0,69 / 0             |
| desktop4x-5 | 84 / 0,48 / 0,56 / 360 / 0,84 / 0    | 92 / 0,42 / 0,50 / 236 / 0,65 / 0             |

### 4.4 Speed Index obserwowany (speedline, jak Lighthouse)

|                       | run 1 | run 2 | run 3 | run 4 | run 5 | mediana |
| --------------------- | ----: | ----: | ----: | ----: | ----: | ------: |
| A mobile SI obs. (ms) |   330 |   288 |   350 |   358 |   254 |     330 |
| B mobile SI obs. (ms) |   356 |   309 |   298 |   303 |   295 | **303** |

Obserwowany postęp wizualny B nie jest gorszy (mediana −27 ms). Lantern SI 1,50 s w B-mobile-1 wynika z kształtu
krzywej (pierwsza klatka 14 % w 268 ms, potem 71 % w 355 ms); ten sam kształt ma A-mobile-3 (SI 1,41). Δ par SI
+0,044 s jest w MDE.

### 4.5 Księga Lantern (blokowanie per klasa, ms per przebieg)

| seria       | TBT med | ScriptCatchup           | Script:vendor-react | Timer:index      | Style               | inne                                                   |
| ----------- | ------: | ----------------------- | ------------------- | ---------------- | ------------------- | ------------------------------------------------------ |
| A mobile    |      94 | 104, 51, 80, 73, 0      | 40, 10, 16, 10, 17  | 12, 0, 1, 12, 23 | —                   | Script 5 (1×), ParseCSS 2 (1×)                         |
| B mobile    |     120 | 88, 0, 99, 0, 84        | 22, 80, 34, 21, 22  | 36, 22, 15, 2, 4 | —                   | Other 48 (1×), ParseHTML 21/16 (2×), Script:pl 11 (1×) |
| A desktop4x |     224 | 144, 76, 112, 125, 77   | 16, 24, 23, 54, 40  | 0, 9, 4, 0, 6    | 61, 92, 85, 18, 114 | Other 91 (1×), ParseCSS 6/19                           |
| B desktop4x |     288 | 110, 243, 149, 118, 110 | 28, 26, 35, 34, 32  | 1, 10, 10, 35, 0 | 71, 39, 69, 73, 93  | Script:pl 8/83, ParseHTML 32/42                        |

- Pozycja nie celuje w klasę zadań (dotyczy bajtów obrazów i adresów), więc nie ma klasy, która miałaby zniknąć.
  Żadna nowa klasa nie pojawia się systematycznie (pojedyncze `Other`/`ParseHTML`/`Script:pl` występują też w A).
- `ScriptCatchup` mobile B: mediana 84 vs A 73, w 2/5 B 0 ms (zadanie przed FCP sym.) - zależność od położenia
  zadania wobec FCP, jak w rundzie 1. Desktop B-2 ScriptCatchup 243 ms to pojedynczy przebieg; Δ par TBT desktop
  +55 ms przy σΔ 121 / MDE 202 jest szumem (A/A σΔ ~130 ms).

## 5. Mobile LCP w grafie Lantern: kara `data:` zniknęła

Graf LCP Lantern (`prove-tools/lcpgraph.mjs` na artefaktach `lh/`):

| przebieg   | FCP sym. | LCP opt / pes | LCP − FCP | `data:` w `devtoolsLog` |
| ---------- | -------: | ------------: | --------: | ----------------------: |
| A-mobile-1 |     1409 |   2009 / 2009 |       600 |                       0 |
| A-mobile-2 |     1402 |   2002 / 2002 |       600 |                       0 |
| A-mobile-3 |     1412 |   2012 / 2012 |       600 |                       0 |
| A-mobile-4 |     1412 |   2012 / 2012 |       600 |                       0 |
| A-mobile-5 |     1385 |   1985 / 1985 |       600 |                       0 |
| B-mobile-1 |     1389 |   1989 / 1989 |   **600** |                       0 |
| B-mobile-2 |     1389 |   1989 / 1989 |   **600** |                       0 |
| B-mobile-3 |     1481 |   2124 / 2124 |       643 |                       0 |
| B-mobile-4 |     1499 |   2149 / 2149 |       650 |                       0 |
| B-mobile-5 |     1377 |   1977 / 1977 |   **600** |                       0 |

- We wszystkich przebiegach B **opt = pes**: w grafie pesymistycznym nie ma już dodatkowego węzła, który w rundzie 1
  przesuwał `cover.jpg` o 1 RTT (rnd 1: pes − opt = 150 ms w 13/15). Żądań `data:image` w B: 0 w 20/20 przebiegach
  (rnd 1: 1 na przebieg mobile).
- B-mobile-3 i B-mobile-4 to znany dwumodalny wariant grafu: węzeł CPU `ParseHTML+EvaluateScript+ParseAuthorStyleSheet`
  (obs. ~27 ms) wisi za arkuszem CSS, FCP sym. rośnie o ~90 ms, a `cover.jpg` trwa 600 zamiast 450 ms - w obu
  estymacjach. **Ta sama sygnatura występuje w bazie**: seria kontrolna rundy 1 (`lh2`, 10 × A) miała ją w 5/10
  przebiegów A (A-mobile-4, 5, 7, 8, 10: FCP 1466-1520, LCP − FCP 649-673, ten sam węzeł CPU). W tej serii trafiła
  2/5 B i 0/5 A - losowanie, nie zmiana. TTFB `cover.jpg` (1,6-15,5 ms) i ponowne użycie połączenia h2 są takie same
  w A i B (`cover-timing.py`).
- Lista żądań B-mobile-1 vs A-mobile-1 (`*.audits.txt`): te same 41 żądań i te same pliki; dokument 41 920 → 41 823 B
  transferu. Element LCP `img.eh-img` (`cover.jpg`), priorytet High, `priorityHinted`, `eagerlyLoaded`.

## 6. CLS 0,358 w B-mobile-5: wada bazy, nie P3.2a

Jedno przesunięcie (0,358) węzła `div[data-col-id=…001b]` - kolumny post-listy (w DOM przed kolumną hero, `order` na
telefonie). FP = FCP obs. 204 ms. To ten sam węzeł i ten sam mechanizm co w rundzie 1 (B 0,358; A 0,126 w serii
`lh2`): pierwsza klatka w przerwie parsera pokazuje post-listę w miejscu hero. Desktop 0 w 10/10, mobile A 0/5, B 1/5;
łącznie z rundą 1 A 1/15 vs B 2/20. P3.2a nie dotyka kolejności DOM ani rezerwacji wysokości kolumn. Rekomendacja
(jak w rundzie 1): osobna pozycja - kolumna hero przed post-listą w DOM albo rezerwacja wysokości.

## 7. Ocena wobec planu

| oczekiwanie planu / rundy 9                                 | wynik                                        |
| ----------------------------------------------------------- | -------------------------------------------- |
| boot gz ≈ +150 B (szacunek IMPL fix9), ≤ +300               | +170 B                                       |
| htmlRawBytes ≈ A −730 B                                     | −708 B                                       |
| headRawBytes Δ 0, `imagePreloadCount` 3, nowe metryki 0 / 0 | spełnione                                    |
| mobile `req` 41, brak `data:`, LCP − FCP = 600              | spełnione (600 w 3/5; 2/5 to wariant bazowy) |
| mobile neutralnie ±0,02 s (fixture bez `srcset`)            | mediany FCP −0,02 s, LCP −0,02 s; pary w MDE |
| CLS ≤ 0,001 w 5/5                                           | desktop 5/5; mobile 4/5 przez wadę bazy (§6) |
| bez wzrostu `ScriptCatchup`/hydratacji nagłówka             | brak systematycznego wzrostu (§4.5)          |
| wybór 640w w Chromium (strona testowa)                      | spełnione (e2e)                              |

Werdykt: struktura **zgodna z planem** (`yes`), wielkość efektu LCP **nierozstrzygalna na fixture** (inconclusive;
obraz LCP fixture nie ma `srcset`). Dowód produkcyjny (§5.4 planu) zostaje po wdrożeniu: żądanie hero
`…?width=640` w PSI mobile, brak `?width=768` tej okładki, `Link` z `</media/…>` i 5 kandydatami, `compare-head-meta`
d2 ↔ HIT równe, raport ΔLCP mobile (szacunek −60…−80 ms).

## 8. Uwagi dla orkiestratora (nieblokujące)

1. `check:bundle` liczbowo +1,0 KB overall, ale realny kod to +0,2 KB gz (§1.1); przy scalaniu P3.7b i P3.1 te liczby
   i tak się przesuną przez nowe hashe. Zapas overall 18,1 KB.
2. Zapas progu `bootClosureGzipBytes` dla P3.7b i P3.1: 496 679 − 495 147 = **1 532 B**.
3. LP-6 (logo eager desktop) jest poza pozycją - potrzebna osobna pozycja z mechanizmem bez wpisu w logu sieci na
   telefonie (IMPL fix9 §6).
4. CLS mobile z kolejności DOM post-lista/hero - osobna pozycja (§6).
