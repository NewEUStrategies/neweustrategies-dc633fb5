# P3.8 (fala 3) — dowód (Prove), runda 2: commit `d66fc7fd` (poprawki B1–B3 z rundy 9)

Data: 2026-10-08.

- **A** = baza partii 2 `base-w3b` @ `63a05a32` (zbudowana wcześniej, bez przebudowy).
- **B** = worktree `wt3/P3.8` @ `d66fc7fd` (gałąź `perf/w3-P3.8`).
- Build B: `env BUNDLE_INVENTORY=1 bun run build:smoke`, exit 0 (vite 1 min 56 s).
- Logi i surowe wyniki: `$SCRATCH/phase3/wave3/P3.8/prove2/`:
  - `build.log`, `check:*.log`;
  - `document-weight*.json` / `.log`;
  - `e2e-artifact.log`, `e2e-item.log`;
  - `ab.log`, `lh/`, `rest-timeline.txt`, `*-m1-req-full.txt`;
  - narzędzia w `tools/`.

## 0. Werdykt

| Kryterium (PLAN-FALI-3 §2 P3.8 + nota orkiestratora)                                      | Wynik                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 żądań REST w **oknie bootu** na `/` (ślad LH / devtoolslog) we wszystkich przebiegach B | **TAK, 10/10.** W A jest 10–25 żądań w każdym przebiegu (5–6 GET + 5–6 preflight, a w A desktop4x-2 także `posts` ×8). Poprawka B1 działa: trzy przebiegi B z dokumentem w wieku 113–135 s mają `posts` ×8 dopiero PO śladzie, przy zatrzasku.                                                                            |
| Linia `backend:` harnessu = 0 (dosłownie)                                                 | **NIE**, ale z tego samego powodu co w rundzie 1. Licznik obejmuje cały przebieg LH aż do zamknięcia karty. Zatrzask (cisza ≥ 5 s po `load`) otwiera się po śladzie, więc odroczone odczyty wpadają do licznika: B 5–15 zapytań, A 7–17. `site_design_tokens` (#1) i `builder_popups` (#4a) znikają z B także w liczniku. |
| Lighthouse `--compare`, mobile + desktop4x, n = 5: bez regresji (ΔTBT ≤ 0, ΔCLS ≤ 0,001)  | **TAK w medianach.** ΔTBT mediany: mobile −5 ms, desktop4x −29 ms. ΔCLS = 0. **Pary mobile: Δ̄TBT +42 ms**, w całości z pary 3 (B mobile-3: zakłócenie maszyny, zob. §4). Mieści się w szumie (σΔ 111, MDE 184). Bez tej pary Δ̄ = −4 ms.                                                                                   |
| e2e popupów i degradacji                                                                  | **CZERWONE: `on-demand-overlays` 0/1** (`vendor-sonner` ładowany przed `readyAt`). Zielone: `popup-first-render` 2/2, `ssr-degradation` 26/26, `test:e2e:artifact` 13/13 (w tym `backend-quiet.boot-home`).                                                                                                               |
| `check:document-weight` (boot ma 0,6 KB zapasu)                                           | **CZERWONY:** `bootClosureGzipBytes` 494,5 > 485,0 KB, `bootClosureRawBytes` 1633,5 > 1599,4 KB, `bootBurstCount` 27 > 26, `bootBurstGzipBytes` 571,2 > 561,2 KB                                                                                                                                                          |
| `check:entry-purity`                                                                      | **CZERWONY:** `sonner` / `vendor-sonner` na ścieżce bootu                                                                                                                                                                                                                                                                 |
| `check:bundle` nie gorszy niż baza                                                        | zielony (w budżetach), ale **boot closure +10,1 KB gz / +34,9 KB raw** (10 → 11 chunków), overall +1,0 KB, public +1,2 KB, entry +0,2 KB                                                                                                                                                                                  |

**`effect_matches_plan = partly`.**

Strukturalnie efekt jest pełny:

- okno bootu bez żądań Supabase w 10/10 przebiegów B;
- pięć chunków nakładek poza oknem LH;
- `Script:vendor-react` w księdze spada o połowę;
- TTI spada istotnie: −0,63 s mobile i −0,19 s desktop4x, obie zmiany powyżej MDE(t);
- mainThread spada o 314 / 390 ms.

Rozmiar efektu w TBT/SI jest nierozstrzygnięty, bo mieści się w szumie. Trzy bramki są jednak czerwone z jednej przyczyny, którą wprowadził ten commit.

**`needs_fix = true`.** Jedna przyczyna daje trzy czerwone bramki: `sonner` trafia do statycznego domknięcia bootu przez
przetasowanie małych chunków (§1.1).

## 1. Bramki artefaktu

| Bramka                                                                | A (baza)                                 | B (P3.8 @ `d66fc7fd`)                                                                                | Wynik                                      |
| --------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `build:smoke` (BUNDLE_INVENTORY=1)                                    | —                                        | exit 0                                                                                               | zielony                                    |
| `check:bundle` overall                                                | 4754,4 / 4772 KB                         | 4755,4 KB (+1,0)                                                                                     | zielony, gorzej                            |
| public JS                                                             | 2804,0 / 2877 KB                         | 2805,2 KB (+1,2)                                                                                     | zielony, gorzej                            |
| admin-only                                                            | 1950,4 KB                                | 1950,2 KB                                                                                            | —                                          |
| largest chunk (`index`, wejście)                                      | 262,2 / 286 KB                           | 262,4 KB (+0,2)                                                                                      | zielony, gorzej                            |
| CSS all / public                                                      | 95,0 / 81,2 KB                           | 95,0 / 81,2 KB                                                                                       | zielony                                    |
| **Boot closure**                                                      | 487,8 KB gz / 1598,6 KB raw (10 chunków) | **497,9 KB gz / 1633,5 KB raw (11 chunków)**                                                         | zielony wobec budżetu 579, **+10,1 KB gz** |
| `check:chunks`                                                        | —                                        | 893 chunki, 6854 krawędzi, acykliczny                                                                | zielony                                    |
| `check:entry-purity`                                                  | zielony                                  | **✗ `sonner` / `vendor-sonner-BA-3S3ka.js` w chunku startowym**                                      | **CZERWONY**                               |
| `check:server-entry-purity`                                           | —                                        | 1815 plików, czysty (leniwe: stripe; dług: node-html-parser ×2)                                      | zielony                                    |
| `test:e2e:artifact` (env CI: `NES_ARTIFACT_FIXTURE=1` + placeholdery) | 12/12                                    | 13/13 (w tym `backend-quiet.boot-home`)                                                              | zielony                                    |
| `on-demand-overlays` (`playwright.performance.config.ts`, artefakt B) | —                                        | **0/1**: `expect([...]).toEqual([])` dostaje `["/assets/vendor-sonner-BA-3S3ka.js"]` przed `readyAt` | **CZERWONY**                               |
| `popup-first-render` (`playwright.performance.config.ts`)             | —                                        | 2/2                                                                                                  | zielony                                    |
| `ssr-degradation` (`playwright.config.ts`, dev-server, CI=1)          | —                                        | 26/26                                                                                                | zielony                                    |
| `check:document-weight`                                               | zielony                                  | **✗ 4 metryki** (§2)                                                                                 | **CZERWONY**                               |

Linia `Boot closure` (B): `Boot closure: 497.9 KB gzip / 1633.5 KB raw  (11 chunków statycznie osiągalnych ze
SSR-owego <script>; budget ≤ 579 KB)`.

Ruchy względem baseline'u `b006c2e` są w A i B prawie identyczne. Jedyna różnica to `club._clubSlug.index`: +16,5 KB w A, +16,6 KB w B (szum zaokrąglenia). Ruchy B:

- spreadsheet.worker +131,5 (NOWY);
- index −45,6;
- lucide-shim.fa −24,1;
- club._clubSlug.index +16,6;
- admin.seo +7,5 (NOWY);
- i18n-club +3,0;
- category._slug −2,5;
- icons-0/1/3 −2,5/−2,5/−2,4;
- profile.notifications −2,4;
- SeoPanel +2,4;
- znikł i18n-admin-seo-hub.

`vendor-sonner` nie pojawia się w liście ruchów, bo jego rozmiar się nie zmienił. Zmieniło się tylko to, że jest
osiągalny statycznie.

### 1.1. Przyczyna: przetasowanie małych chunków (`experimentalMinChunkSize: 2048`) wciąga `carouselDefaults.ts` do wejścia

Narzędzie: `tools/closure.cjs`, statyczne domknięcie importów z `index-*.js`.

| Chunk w domknięciu                                                                                  | A                          | B                                                          |
| --------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------- |
| index                                                                                               | 260,0 KB gz / 843,3 KB raw | 260,2 / 843,6                                              |
| vendor-sonner                                                                                       | —                          | **9,8 KB gz / 34,6 KB raw** (import `{t as Ud}` w wejściu) |
| pozostałe 9 (react, tanstack, supabase, i18n, zod, lucide-boot, radix-boot, tw-merge, dynamic-icon) | identyczne                 | identyczne                                                 |

Skład modułów chunku wejściowego według `reports/chunk-inventory.json`: 832 moduły po obu stronach.

- **+ `src/lib/theme/carouselDefaults.ts`** (1958 B). Ma `import { toast } from "sonner"` w `useSaveCarouselDefaults`
  (`toast.success("Zapisano domyślne ustawienia karuzeli")`). W A ten moduł siedział we współdzielonym chunku
  `eventBrandingDraft-*` razem z `eventBrandingDraft.ts`.
- **− `src/lib/auth/registrationFields.ts`** (2026 B). W B przeszedł do `cacheBusting-*`.
- Ten sam commit dodał nowe małe moduły: `newsletterSettingsData.ts` (wklejony do `newsletter.confirm-*`)
  i `sinceNavigationStart.ts` (wklejony do `tag._slug-*` razem z `overlayCoordinator`). To zmieniło rozkład scaleń
  Rollupa. W B `eventBrandingDraft-*` łączy się teraz z `Logo.tsx`, a `carouselDefaults` ląduje w wejściu. Jego
  statyczny import `sonner` wciąga `vendor-sonner` do bootu.

Na `/` A też pobiera `vendor-sonner`, ale później i dynamicznie. W A mobile-1 `eventBrandingDraft` i `vendor-sonner`
idą w ~840–900 ms przez `sliderVariants` → `carouselDefaults`. W B mobile-1 `vendor-sonner` idzie w 262 ms, razem
z wejściem. Ten sam plik jest więc w B ładowany wcześniej i parsowany w boocie. Na stronach bez slidera dochodzi na
stałe +10 KB gz.

Koszt w księdze Lanterna: nowa klasa `Script:vendor-sonner` w 3/5 przebiegów B mobile (11 / 4 / 3 ms blokowania).

**Netto bez przetasowania.** Domknięcie bootu bez `vendor-sonner` (10 092 B gz / 35 470 B raw) wynosi:

|                                        |   Δ gz |  Δ raw |
| -------------------------------------- | -----: | -----: |
| Domknięcie bootu (bez `vendor-sonner`) | +214 B | +295 B |
| Chunk wejściowy                        | +197 B | +257 B |

Zamiana `carouselDefaults` ↔ `registrationFields` to netto −68 B renderowanych. Kod P3.8 w wejściu daje więc ok.
+0,2 KB gz, a IMPL szacował ok. 0. Po usunięciu `sonner` z bootu `bootClosureGzipBytes` wyniósłby ok. 484,6 / 485,0 KB
(zapas ok. 0,4 KB), a `bootClosureRawBytes` ok. 1598,9 / 1599,4 KB. To szacunek. Rozkład scaleń po poprawce może być
znowu inny, więc trzeba to zmierzyć.

**Poprawka (rekomendacja; plik spoza listy P3.8, wymaga zgody orkiestratora na rozszerzenie zakresu):**

- W `src/lib/theme/carouselDefaults.ts` zamienić `import { toast } from "sonner"` na `notifySuccess` / `notifyError`
  z `@/lib/notify`, czyli leniwy most, który wskazuje komunikat `check:entry-purity`.
- To trzy linie bez zmiany zachowania. Uodparnia bramkę na dowolne przyszłe scalenia chunków, bo moduł bez `sonner`
  może bezpiecznie trafić do wejścia.
- Alternatywa: przypięcie `carouselDefaults` w `manualChunks` obu presetów. Jest bardziej kruche i dotyka
  `vite.config.ts`.
- Po poprawce trzeba ponownie zmierzyć `check:entry-purity`, `check:document-weight`, `on-demand-overlays`
  i `check:bundle`.

## 2. Waga dokumentu (`check-document-weight`, GET `/`, fixture, HIT, 5 próbek)

| Metryka                                  |                     A |                     B |                                          Δ |          Próg | B     |
| ---------------------------------------- | --------------------: | --------------------: | -----------------------------------------: | ------------: | ----- |
| htmlRawBytes                             |               337 696 |               338 425 |                                       +729 |      396,7 KB | ✓     |
| htmlGzipBytes                            |                52 536 |                52 746 |                                       +210 |       56,4 KB | ✓     |
| headRawBytes                             |                28 758 |                28 797 | +39 (URL `vendor-sonner` w zestawie bootu) |       28,7 KB | ✓     |
| inlineStyleCount / Bytes                 |           25 / 84 717 |           25 / 84 717 |                                          0 | 50 / 132,4 KB | ✓     |
| inlineScriptBytes                        |                86 617 |                87 346 |                                       +729 |       95,8 KB | ✓     |
| inlineExecutableScriptBytes              |                79 373 |                80 063 |                                       +690 |       89,6 KB | ✓     |
| dehydratedStateBytes                     |                60 357 |                61 047 |                                   **+690** |       64,9 KB | ✓     |
| modulepreloadCount                       |                     0 |                     0 |                                          0 |             0 | ✓     |
| linkHeaderEntries                        |                     5 |                     5 |                                          0 |             5 | ✓     |
| preloadDuplicates / w dokumencie         |                 3 / 0 |                 3 / 0 |                                          0 |         3 / 0 | ✓     |
| imagePreloadCount                        |                     3 |                     3 |                                          0 |             3 | ✓     |
| imgFetchpriorityHigh                     |                     1 |                     1 |                                          0 |             2 | ✓     |
| **bootClosureRawBytes**                  | 1 636 946 (1598,6 KB) | 1 672 711 (1633,5 KB) |                                **+35 765** |     1599,4 KB | **✗** |
| **bootClosureGzipBytes**                 |    496 041 (484,4 KB) |    506 347 (494,5 KB) |                                **+10 306** |      485,0 KB | **✗** |
| preloadedJsCount / GzipBytes (pula High) |                 0 / 0 |                 0 / 0 |                                          0 |             0 | ✓     |
| renderBlockingCssGzipBytes               |                80 426 |                80 426 |                                          0 |       79,5 KB | ✓     |
| lcpCandidateCount / Missing              |                 1 / 0 |                 1 / 0 |                                          0 |             — | ✓     |
| preLcpTransferBytes                      |               177 694 |               177 904 |                                       +210 |     177,3 KB* | ✓     |
| **bootBurstCount**                       |                    26 |                    27 |                                     **+1** |            26 | **✗** |
| **bootBurstGzipBytes**                   |    574 062 (560,6 KB) |    584 943 (571,2 KB) |                                **+10 881** |      561,2 KB | **✗** |

\* Gate liczy `preLcpTransferBytes` według własnej mediany. B ma 173,7 KB w tabeli bramki, więc zielono.

Interpretacja:

- Cztery czerwone metryki to w całości `vendor-sonner` (§1.1).
- **`dehydratedStateBytes` +690 B**, tak jak w rundzie 1. IMPL-fix9 zakładał spadek po usunięciu zasiewu
  `site_font_scale`, ale go nie widać. Na `/` w stanie SSR nadal są dwa nowe wpisy: `site_font_scale` (prawdziwe dane
  rozgrzewki #1) i `builder-popups-active: []` (#4a). W gzip to ok. +60 B, w zapasie progu 64,9 KB.
- Progi bez zmian. Ratchet wolno robić tylko w dół i tylko właścicielowi plików document-weight, a tu nic nie spadło.

## 3. Żądania backendu: okno bootu (ślad) kontra linia `backend:` (cały przebieg LH)

Okno bootu policzono jako żądania `rest/v1` w `devtoolslog.json` danego przebiegu (`tools/rest-timeline.cjs` z rundy 1,
wynik w `rest-timeline.txt`). Wiek dokumentu to `LH HIT age=` z `ab.log`.

| Przebieg          | Wiek dok. | `backend:` (cały przebieg) | REST w oknie bootu (GET + preflight) | Koniec śladu |
| ----------------- | --------: | -------------------------- | -----------------------------------: | -----------: |
| A mobile-1        |      11 s | 7 + 7                      |                                   10 |      3654 ms |
| A mobile-2        |      73 s | 9 + 9                      |                                   12 |      3649 ms |
| A mobile-3        |      94 s | 9 + 9                      |                                   12 |      3519 ms |
| A mobile-4        |       4 s | 7 + 7                      |                                   10 |      3633 ms |
| A mobile-5        |      25 s | 7 + 7                      |                                   10 |      3559 ms |
| A desktop4x-1     |      71 s | 9 + 9                      |                                   12 |      3570 ms |
| A desktop4x-2     |     133 s | 17 + 14 (z `posts` ×8)     |                               **25** |      3633 ms |
| A desktop4x-3     |       4 s | 7 + 7                      |                                   10 |      3573 ms |
| A desktop4x-4     |      72 s | 9 + 9                      |                                   12 |      3902 ms |
| A desktop4x-5     |      94 s | 9 + 9                      |                                   12 |      3690 ms |
| **B mobile-1**    |      30 s | 5 + 5                      |                                **0** |      3156 ms |
| **B mobile-2**    |      50 s | 7 + 6                      |                                **0** |      3140 ms |
| **B mobile-3**    |     113 s | 15 + 14 (z `posts` ×8)     |                                **0** |      4425 ms |
| **B mobile-4**    |     135 s | 15 + 14 (z `posts` ×8)     |                                **0** |      3078 ms |
| **B mobile-5**    |       4 s | 5 + 5                      |                                **0** |      3156 ms |
| **B desktop4x-1** |      45 s | 5 + 5                      |                                **0** |      3167 ms |
| **B desktop4x-2** |      66 s | 6 + 6                      |                                **0** |      3168 ms |
| **B desktop4x-3** |     135 s | 14 + 14 (z `posts` ×8)     |                                **0** |      3455 ms |
| **B desktop4x-4** |       4 s | 5 + 5                      |                                **0** |      3183 ms |
| **B desktop4x-5** |      68 s | 6 + 6                      |                                **0** |      3476 ms |

Wnioski:

- **B1 naprawione.**
  - W rundzie 1 trzy przebiegi B z dokumentem starszym niż 120 s miały `posts` ×5–8 w oknie bootu.
  - Teraz trzy przebiegi B z dokumentem w wieku 113–135 s mają w oknie 0 żądań. `posts` ×8 pada dopiero po śladzie,
    czyli przy zatrzasku `onInteractionOrQuiet`.
  - A desktop4x-2 (133 s) pokazuje stan bazy: `posts` ×8 w oknie bootu.
- `site_design_tokens` (#1) i `builder_popups` (#4a) nie występują w B wcale, także w liczniku całego przebiegu.
- `post_layout_settings`, `ad_placements`, `newsletter_settings`, `categories` i `tags` (#2, #3, #4b, #5, #6) padają
  w B wyłącznie po śladzie, przy zatrzasku, zgodnie z projektem.
- Literalnego „`backend:` = 0” nie da się uzyskać bez blokowania zatrzasku do końca LH, co nie jest celem pozycji.
  Kryterium należy czytać jako okno bootu. Tak też sprawdza je e2e `backend-quiet.boot-home` (zielony).

## 4. Lighthouse A/B (`--compare`, n = 5, mobile + desktop4x, fixture, fake-gtag, rozgrzewka bot, przeplot)

Ważność:

- VALID 5/5 w każdej z czterech grup, excluded 0;
- HIT wszędzie, wariant wzorcowy s-maxage=900;
- tryb FCP `bez-js` 5/5, pary mieszane 0/5;
- po restarcie serwera 1/5 w każdej grupie.

### Mediany

| Forma     | Strona | perf |    FCP |    LCP |    TBT |     SI |   CLS |    TTI | mainThread |  bootup | long tasks | req | transfer |       JS |
| --------- | ------ | ---: | -----: | -----: | -----: | -----: | ----: | -----: | ---------: | ------: | ---------: | --: | -------: | -------: |
| mobile    | A      |   97 | 1,53 s | 2,29 s |  96 ms | 1,79 s | 0,000 | 5,33 s |    2892 ms | 1300 ms |          8 |  70 | 914,6 KB | 638,7 KB |
| mobile    | B      |   97 | 1,53 s | 2,28 s |  91 ms | 1,63 s | 0,000 | 4,71 s |    2578 ms | 1164 ms |          7 |  51 | 886,7 KB | 617,2 KB |
| desktop4x | A      |   93 | 0,39 s | 0,54 s | 214 ms | 0,58 s | 0,000 | 1,24 s |    2952 ms | 1396 ms |          8 |  75 | 920,2 KB | 643,8 KB |
| desktop4x | B      |   95 | 0,45 s | 0,54 s | 186 ms | 0,58 s | 0,000 | 1,03 s |    2562 ms | 1185 ms |          7 |  53 | 891,6 KB | 622,0 KB |

### Rozrzut per przebieg (TBT ms / perf / obsSI ze speedline, ms)

| Para          | A mobile       | B mobile            | A desktop4x    | B desktop4x    |
| ------------- | -------------- | ------------------- | -------------- | -------------- |
| 1             | 130 / 97 / 313 | 127 / 97 / 284      | 213 / 93 / 297 | 188 / 95 / 260 |
| 2             | 105 / 96 / 317 | 50 / 98 / 341       | 214 / 93 / 312 | 186 / 95 / 327 |
| 3             | 63 / 98 / 315  | **293 / 91 / 1065** | 199 / 94 / 317 | 174 / 96 / 313 |
| 4             | 96 / 97 / 330  | 91 / 97 / 331       | 229 / 92 / 332 | 186 / 95 / 312 |
| 5             | 43 / 98 / 284  | 89 / 97 / 297       | 265 / 90 / 310 | 166 / 96 / 321 |
| mediana obsSI | 315            | 331                 | 312            | 313            |

**B mobile-3 to zakłócenie maszyny, nie efekt zmiany:**

- `load` w 420 ms (inne przebiegi 77–99 ms);
- koniec śladu 4425 ms (inne ~3,1 s);
- obsSI 1065 ms (inne 284–341);
- w księdze jedno zadanie klasy `Other` o 130 ms blokowania, czyli bez atrybucji skryptu.

Harness uznał przebieg za ważny, bo obciążenie przy starcie było poniżej 2,4.

### DELTA B−A (mediany) i pary (n = 5, t(df = 4) = 3,72)

| Forma     | Metryka |  Δ mediany |        Δ̄ par |    σΔ | MDE(t) | Ocena                                      |
| --------- | ------- | ---------: | -----------: | ----: | -----: | ------------------------------------------ |
| mobile    | score   |         ±0 |         −1,2 |   3,4 |    5,7 | szum                                       |
| mobile    | FCP     |    −0,01 s |     −0,022 s | 0,041 |  0,069 | szum                                       |
| mobile    | LCP     |    −0,02 s |     −0,047 s | 0,075 |  0,125 | szum                                       |
| mobile    | **TBT** |  **−5 ms** |   **+42 ms** |   111 |    184 | szum; Δ̄ z pary 3 (+230 ms); bez niej −4 ms |
| mobile    | SI      |    −0,16 s |     −0,081 s | 0,111 |  0,185 | szum                                       |
| mobile    | **TTI** |    −0,62 s | **−0,634 s** | 0,084 |  0,139 | **istotne**                                |
| mobile    | CLS     |     ±0,000 |            — |     — |      — | ✓                                          |
| desktop4x | score   |         +2 |     **+3,0** |   1,7 |    2,9 | na granicy MDE(t), istotne                 |
| desktop4x | FCP     |    +0,06 s |     +0,037 s | 0,082 |  0,137 | szum                                       |
| desktop4x | LCP     |    ±0,00 s |     +0,004 s | 0,005 |  0,008 | szum                                       |
| desktop4x | **TBT** | **−29 ms** |   **−44 ms** |    31 |     52 | < MDE(t), > MDE(z) 39 ms                   |
| desktop4x | SI      |    ±0,00 s |     −0,012 s | 0,024 |  0,039 | szum                                       |
| desktop4x | **TTI** |    −0,21 s | **−0,185 s** | 0,041 |  0,068 | **istotne**                                |
| desktop4x | CLS     |     ±0,000 |            — |     — |      — | ✓                                          |

Pozostałe Δ mediany:

- mobile: mainThread −314 ms, bootup −136 ms, transfer −27,9 KB, skrypty −21,5 KB, żądania −19;
- desktop4x: mainThread −390 ms, bootup −211 ms, transfer −28,7 KB, skrypty −21,7 KB, żądania −22;
- highPriorityBytesBeforeLcpImage bez zmian (112,4 KB).

Brak regresji w medianach: ΔTBT ≤ 0 w obu formach, ΔCLS = 0, a FCP/LCP/SI mieszczą się w MDE. Średnia par mobile TBT
(+42 ms) jest dodatnia wyłącznie przez parę 3, więc w szumie. Spadek TTI i mainThread jest istotny, co zgadza się
z przeniesieniem renderów po odpowiedziach REST i montażu nakładek za zatrzask.

### Księga Lantern per zadanie (`tools/ledger-agg.cjs` z rundy 1)

Średnie blokowanie per klasa na przebieg (ms):

| Forma     | Strona | zadań / przebieg | ScriptCatchup | Style | **Script:vendor-react** | Timer:index | Script:vendor-sonner |                                                inne |
| --------- | ------ | ---------------: | ------------: | ----: | ----------------------: | ----------: | -------------------: | --------------------------------------------------: |
| mobile    | A      |              7,4 |            17 |    44 |                  **14** |           5 |                    — |                                         ParseHTML 7 |
| mobile    | B      |              7,6 |            28 |    47 |                   **9** |           — |                **4** | Other 26 (B-3), Script:index 16 (B-5, [Style 97 %]) |
| desktop4x | A      |              8,0 |            96 |    93 |                  **20** |           7 |                    — |                             ParseHTML 4, ParseCSS 3 |
| desktop4x | B      |              7,2 |            85 |    78 |                  **10** |           2 |                    — |                                ParseHTML 4, Other 1 |

- Klasa docelowa (render Reacta po odpowiedziach zapytań i montaż nakładek) maleje o ok. połowę w obu formach:
  −5 ms mobile, −10 ms desktop4x. W desktop4x znika też `Timer:index`.
- Zadania nie znikają całkowicie, bo zostaje pierwsza klatka hydratacji. Struktura zgadza się z planem.
- Nowa klasa w B to `Script:vendor-sonner`: ewaluacja `sonner` w boocie, 3–11 ms blokowania w 3/5 przebiegów mobile.
  To bezpośredni koszt przetasowania z §1.1.

### Speedline (obsSI z filmstripu)

Mediany obsSI:

- mobile: A 315 ms, B 331 ms (B bez przebiegu 3: 284–341);
- desktop4x: A 312 ms, B 313 ms.

Bez zmian. Lokalnie nic wizualnego nie zależało od tych żądań, więc P3.8 nie może tu ruszyć obsSI. Spodziewany zysk SI
dotyczy produkcji, gdzie REST konkuruje o sieć i wątek w oknie LCP.

### Audyty jednego przebiegu (mobile-1 A vs B)

|                                                       | A mobile-1                                 | B mobile-1            |
| ----------------------------------------------------- | ------------------------------------------ | --------------------- |
| Żądania / transfer                                    | 70 / 914,6 KB                              | 51 / 886,7 KB         |
| Element LCP                                           | `img.eh-img` (`cover.jpg`, preload, eager) | ten sam               |
| LCP: TTFB / load delay / load duration / render delay | 27 / 28 / 27 / 173 ms                      | 20 / 21 / 15 / 138 ms |
| CLS                                                   | 0                                          | 0                     |
| TBT                                                   | 130 ms                                     | 127 ms                |

Zbiór żądań B = A minus 19 (`A-m1-req-full.txt` / `B-m1-req-full.txt` z audytu `network-requests`):

- 5 × Fetch i 5 × Preflight `/rest/v1/` (`site_design_tokens`, `post_layout_settings`, `ad_placements`,
  `newsletter_settings`, `builder_popups`);
- 5 chunków nakładek: `NewsletterPopup`, `PopupHost`, `PopupImage`, `popups`, `parseCsv`;
- przetasowanie chunków: znikają `Breadcrumbs`, `SponsoredBadge`, `blog.index`, `eventBrandingDraft`,
  `events._slug_.cfp-submit` i drugi `pl`; dochodzą `FooterSlideup` (w A siedział w `blog.index`) i `tag._slug`
  (`overlayCoordinator` + `sinceNavigationStart`).

`vendor-sonner` jest po obu stronach, ale w A idzie w 842–903 ms, dynamicznie przez slider, a w B w 256–286 ms,
statycznie z wejściem. Ogon żądań A po 900 ms znika w B całkowicie: `eventBrandingDraft`, `vendor-sonner`,
`NewsletterPopup`, `PopupImage`, `parseCsv`, `PopupHost` i `popups`.

## 5. Ocena względem kryteriów i co do poprawki

- **Struktura: TAK.**
  - 0 REST w oknie bootu w 10/10 przebiegów B, także przy dokumencie starszym niż 120 s (B1 zamknięte).
  - #1 i #4a zdejmują żądania z całego przebiegu.
  - #2, #3, #4b, #5 i #6 przenoszą odczyty za zatrzask.
  - Pięć chunków nakładek wypada z okna LH.
  - `Script:vendor-react` w księdze spada o połowę.
  - TTI i mainThread spadają istotnie.
- **Rozmiar w TBT/SI: nierozstrzygnięty.**
  - Mediany: mobile −5 ms, desktop −29 ms.
  - Pary: desktop −44 ms (< MDE(t) 52), mobile +42 ms (wyłącznie para zakłócona).
  - SI w szumie.
  - Kierunek jest zgodny z planem.
- **B2 (kotwica `activationStart`):** wdrożona. Testy jednostkowe są w IMPL, a e2e popupów są zielone: `popup-first-render` 2/2.
  `sinceNavigationStart` nie trafił do bootu, tylko do `tag._slug-*` razem z `overlayCoordinator`.
- **B3 (bajty bootu): NIE.** Kod P3.8 netto daje ok. +0,2 KB gz w zamknięciu bootu (szacunek IMPL: ok. 0). Do tego
  przetasowanie chunków wciąga `vendor-sonner` (+10,1 KB gz), a to zapala trzy bramki:
  - `check:entry-purity`;
  - `check:document-weight` (4 metryki);
  - e2e `on-demand-overlays`.
- **Bez regresji dla zalogowanych, admina i edytora:** testy jednostkowe implementera (bez zmian w tym etapie)
  i `ssr-degradation` 26/26.
- **Uwaga do `newsletterSettingsData`:** moduł leniwy został wklejony przez Rollup do chunku `newsletter.confirm-*`
  (4,8 KB raw, komponent trasy potwierdzenia). Pierwsze pobranie ustawień newslettera w przeglądarce dociąga więc ten
  chunk. To nieszkodliwe (poza bootem, mały), ale warto wiedzieć.

**Do poprawki (jedna runda):** usunąć statyczny import `sonner` z `src/lib/theme/carouselDefaults.ts` (→ `@/lib/notify`,
wymaga zgody orkiestratora na plik spoza listy). Albo inaczej sprawić, żeby `vendor-sonner` nie był osiągalny
statycznie z wejścia. Potem przebudować i powtórzyć:

- `check:entry-purity`;
- `check:document-weight` (oczekiwane `bootClosureGzipBytes` ok. 484,6 / 485,0 KB, zapas ok. 0,4 KB);
- `check:bundle`;
- `on-demand-overlays`.

Lighthouse wystarczy powtórzyć tylko wtedy, gdy rozkład chunków zmieni się istotnie poza `sonner`.

Zmiany zachowania (z IMPL, nadal w mocy):

- popup `immediate` pokazuje się nie wcześniej niż ok. 400 ms po otwarciu zatrzasku;
- pasek dolny pokazuje się po max(zatrzask, `delay_ms`), a opóźnienie liczy się od `activationStart`;
- `ContentAreaStyle`: inwalidacja i brak wpisu przed zatrzaskiem czekają na zatrzask;
- sekcje z danymi z SSR odświeżają się dopiero przy zatrzasku.
