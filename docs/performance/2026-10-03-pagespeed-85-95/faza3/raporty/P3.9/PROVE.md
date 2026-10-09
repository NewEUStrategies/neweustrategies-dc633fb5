# P3.9 (fala 3, partia 3c): dowód (Prove). Dyspozytor widgetów bez modułu pól formularza na `/`

Data: 2026-10-09. A = baza partii 3c `base-w3e` @ `5adde441` (zbudowana przez orkiestratora, bez przebudowy).
B = worktree `wt3/P3.9` @ `cf1076b8` (gałąź `perf/w3-P3.9`, drzewo czyste), build `env BUNDLE_INVENTORY=1 bun run
build:smoke` przez mutex, exit 0.

Logi i surowe wyniki są w `$SCRATCH/phase3/wave3/P3.9/`:

- `build.log`, `check:*.log` (B) i `check:bundle-base.log` (A);
- `document-weight.json` (B) i `document-weight-base.json` (A);
- `e2e-artifact.log`, `e2e-item.log` (nakładki, popupy, degradacja SSR) i `ab.log`;
- `lh/` (20 przebiegów z artefaktami i księgą);
- `graph-check-prove-{A,B}.txt`, `si-layout-summary.txt` i `tools/`.

Wcześniejsze pliki implementera z tego katalogu zostały pod nazwami `*-impl.*`.

Zakres zmiany: wyłącznie część A planu. Powstał czysty `customFieldDefs.ts`, a `WidgetView` przekazuje surowe
`customFields` do leniwego `JoinUsForm`, który sam je parsuje. Część B (`FooterSlideupSlot`) nie weszła, bo na
`5adde441` łańcuch `/blog` na `/` już nie istnieje (IMPL §3, potwierdzone niżej w §2).

## 0. Werdykt

| Kryterium (nota orkiestratora + plan P3.9 §6)                                               | Wynik                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inwentarz żądań `/` (fixture) bez `formFieldConfig`, `vendor-radix-select`, `LayoutPreview` | **TAK, 10/10 przebiegów B**. Odpada 9 chunków: `formFieldConfig`, `euCountries`, `AdminSelect`, `vendor-radix-select`, `vendor-radix`, `MessageComposerField`, `LayoutPreview`, `useMentionAutocomplete` i `vendor-lucide` (nie-boot). W A wszystkie 9 jest w 10/10 przebiegów. |
| Bez chunku `/blog` z `FooterSlideup` na `/`                                                 | **TAK** w A i B. `blog.index`, `cfp-submit` i `Breadcrumbs` są nieobecne w `network-requests` wszystkich 20 przebiegów, a `FooterSlideup` ma własny chunk (`FooterSlideup-*.js`, 2 moduły). Przesłanka części B była spełniona już na bazie.                                    |
| Bajty JS `/` w dół                                                                          | **TAK**, deterministycznie. Żądania −9 (mobile 51 → 42, desktop4x 53 → 44), transfer JS **−71 430 B** (−69,8 KB) w każdym przebiegu. Prognoza IMPL: −9 żądań i ~−71 KB. „Unused JavaScript” spada o 28,6 KB (223,1 → 194,5 KB).                                                 |
| `check:chunks`, `check:entry-purity`, `check:server-entry-purity`, `check:bundle`           | **zielone**. Overall −0,5 KB, public −0,6 KB, largest −0,1 KB. Boot closure 486,7 KB gz bez zmian, raw −0,2 KB.                                                                                                                                                                 |
| `bootClosureRaw/GzipBytes` bez wzrostu                                                      | **TAK**: −141 B raw, −34 B gz. `bootBurstGzipBytes` −32 B, `bootBurstCount` 26 = 26.                                                                                                                                                                                            |
| e2e artefaktu oraz popupów i stopki                                                         | **zielone**: `test:e2e:artifact` 18/18, `on-demand-overlays` 1/1, `popup-first-render` 2/2, `ssr-degradation` 26/26                                                                                                                                                             |
| Bramka planu `p39-graph-check.py`                                                           | B: **OK, 0 naruszeń** (exit 0). A: 12 naruszeń (exit 1), wszystkie w domknięciu `WidgetView`.                                                                                                                                                                                   |
| Lighthouse: FCP/LCP ±0,02 s, CLS bez zmian, kierunek ΔTBT ≤ 0                               | FCP/LCP: mediany +0,02 s (mobile) i +0,02 / −0,00 s (desktop4x), czyli na granicy, a pary w MDE. CLS 0 → 0. **ΔTBT dodatnie, ale w szumie** (§4). Mobile SI +0,09 s w parach, przyczyna poza zmianą (§5).                                                                       |

**`effect_matches_plan = yes` dla struktury, `inconclusive` dla rozmiaru metryk czasowych.**

- Struktura: wszystkie 9 zaplanowanych chunków znika z `/` w każdym przebiegu, bajty i żądania spadają zgodnie
  z prognozą co do bajtu, a bramki są zielone.
- Metryki czasowe (TBT, SI, FCP, LCP) zostają w szumie i w MDE.
- Plan nie przewidywał zysku TBT. Według planu żaden z usuwanych skryptów nie przekracza progu `bootup-time` w księdze
  bazy. W śladach A ich kompilacja i ewaluacja na wątku głównym zajmuje 0,4–4,2 ms obs. (§4.3), więc oczekiwany
  wpływ na TBT to ≈ 0.
- Żadna klasa zadań księgi nie była celem tej pozycji, bo usuwane chunki nie tworzą zadań ≥ 50 ms sym. ani w A,
  ani w B.

`needs_fix = false`. Nie ma bramki czerwonej z powodu tej zmiany.

## 1. Bramki artefaktu

| Bramka                                                                       | A (`base-w3e`)              | B (P3.9)                                                       | Wynik                |
| ---------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------- | -------------------- |
| `build:smoke` (BUNDLE_INVENTORY=1)                                           | —                           | exit 0                                                         | zielony              |
| `check:bundle` overall                                                       | 4753,7 / 4772 KB            | **4753,2 KB (−0,5)**                                           | zielony              |
| public JS                                                                    | 2803,7 / 2877 KB            | **2803,1 KB (−0,6)**                                           | zielony              |
| admin-only                                                                   | 1950,0 KB                   | 1950,1 KB (+0,1)                                               | —                    |
| largest chunk (`index`, wejście)                                             | 261,1 / 286 KB              | 261,0 KB (−0,1)                                                | zielony              |
| CSS all / public                                                             | 95,4 / 81,2 KB              | 95,4 / 81,2 KB                                                 | zielony              |
| **Boot closure**                                                             | 486,7 KB gz / 1594,2 KB raw | **486,7 KB gz / 1594,0 KB raw**                                | zielony, bez wzrostu |
| liczba plików JS klienta                                                     | 897                         | 896                                                            | —                    |
| `check:chunks`                                                               | 895 chunków                 | 894 chunki, 6860 krawędzi, acykliczny                          | zielony              |
| `check:entry-purity`                                                         | zielony                     | „Sciezka bootowania czysta” (10 z 894 chunków)                 | zielony              |
| `check:server-entry-purity`                                                  | zielony                     | 1822 pliki, czysty (leniwe: stripe; dług: node-html-parser ×2) | zielony              |
| `test:e2e:artifact` (env CI: `NES_ARTIFACT_FIXTURE=1` + atrapy `SUPABASE_*`) | —                           | **18/18**                                                      | zielony              |
| `on-demand-overlays` (playwright.performance, artefakt B)                    | —                           | 1/1                                                            | zielony              |
| `popup-first-render` (playwright.performance, 1440 i 390 px)                 | —                           | 2/2                                                            | zielony              |
| `ssr-degradation` (playwright.config, dev-server, CI=1)                      | —                           | 26/26                                                          | zielony              |
| `check:document-weight`                                                      | zielony                     | zielony                                                        | zielony              |
| `p39-graph-check.py` (bramka planu)                                          | 12 naruszeń, exit 1         | **OK, exit 0**                                                 | zielony              |

`test:e2e:artifact` obejmuje:

- `boot-artifact` ×3, w tym kontrolę negatywną niezgodności;
- `boot-home` pl/en i zapisaną sesję;
- `backend-quiet.boot-home`, `boot-timing` ×3, `legal-links.boot-home` ×5 i `motion-gate.boot-home` ×3.

Strona główna fixture ma widget `join-us`, więc przebieg przechodzi przez nową ścieżkę `customFieldsSource`. Bramki
usunięte w PR #475 nie są odtwarzane. Typecheck i vitest zrobił implementer (IMPL §2.3). Ta pozycja Prove ich
nie powtarza, bo commit się nie zmienił.

Linia `Boot closure` (B): `Boot closure: 486.7 KB gzip / 1594.0 KB raw  (10 chunków statycznie osiągalnych ze
SSR-owego <script>; budget ≤ 579 KB)`.

Ruchy względem baseline'u `b006c2e` są w A i B te same. Jedyna różnica to zaokrąglenie
`club._clubSlug.index` (+16,5 w A, +16,6 w B):

- spreadsheet.worker +131,5 (NOWY);
- index −46,9;
- lucide-shim.fa −24,1;
- club._clubSlug.index +16,6;
- admin.seo +7,5 (NOWY);
- i18n-club +3,0;
- category._slug −2,5;
- icons-0/1/3 −2,5/−2,5/−2,4;
- profile.notifications −2,4;
- SeoPanel +2,4;
- znikł i18n-admin-seo-hub.

Zmiana nie wnosi nowego ruchu.

## 2. Graf chunków (`p39-graph-check.py` na inwentarzach z buildu)

|                           | A (`base-w3e`)                                                                                                                                                                                          | B (P3.9)                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| domknięcie komponentu `/` | 22 chunki, 3 908 995 B                                                                                                                                                                                  | 22 chunki, 3 908 995 B (bez zmian)                                          |
| domknięcie `WidgetView`   | 20 chunków, 4 332 276 B                                                                                                                                                                                 | **11 chunków, 3 795 239 B** (−536 KB renderedLength)                        |
| naruszenia                | 12 (AdminSelect, LayoutPreview, ComposerShell, MessageComposerField, euCountries ×2, formFieldConfig, useMentionAutocomplete, vendor-lucide, vendor-radix, vendor-radix-select, @radix-ui/react-select) | **0**                                                                       |
| `FooterSlideup.tsx`       | `FooterSlideup-*.js`, 2 moduły, 8 importerów statycznych                                                                                                                                                | to samo                                                                     |
| `customFieldDefs.ts`      | —                                                                                                                                                                                                       | `JoinUsForm-*.js` (dyn., 1 importer statyczny)                              |
| `formFieldConfig.tsx`     | `formFieldConfig-*.js` (1 moduł, 2 importerów statycznych)                                                                                                                                              | `JoinUsForm-*.js`, ten sam chunk co `customFieldDefs.ts` (wymóg planu §6.3) |

Komponentu `/blog`, `FriendlyErrorPage`, `Breadcrumbs` i locale `date-fns` nie ma w domknięciu `/` ani w A, ani w B.
Decyzja implementera o pominięciu części B jest więc zgodna z planem awaryjnym §7: na tej bazie nie ma czego usuwać.

## 3. Waga dokumentu (`check-document-weight`, GET `/`, fixture, 5 próbek, min = max = mediana)

| Metryka                                  |               A |               B |                                  Δ |
| ---------------------------------------- | --------------: | --------------: | ---------------------------------: |
| htmlRawBytes                             |         327 390 |         327 390 |                                  0 |
| htmlGzipBytes                            |          49 536 |          49 519 | −17 (hasze nazw w `#nes-boot-set`) |
| headRawBytes                             |          25 795 |          25 795 |                                  0 |
| inlineStyleCount / Bytes                 |     25 / 71 234 |     25 / 71 234 |                                  0 |
| inlineCssCommentBytes                    |             517 |             517 |                                  0 |
| inlineScriptBytes / Executable           | 87 310 / 80 063 | 87 310 / 80 063 |                                  0 |
| dehydratedStateBytes                     |          61 047 |          61 047 |                                  0 |
| modulepreloadCount                       |               0 |               0 |                                  0 |
| linkHeaderEntries                        |               5 |               5 |                                  0 |
| preloadDuplicates / w dokumencie         |           3 / 0 |           3 / 0 |                                  0 |
| imagePreloadCount / fontPreloadCount     |           3 / 4 |           3 / 4 |                                  0 |
| imgFetchpriorityHigh                     |               1 |               1 |                                  0 |
| **bootClosureRawBytes**                  |       1 632 431 |       1 632 290 |                           **−141** |
| **bootClosureGzipBytes**                 |         494 925 |         494 891 |                            **−34** |
| preloadedJsCount / GzipBytes (pula High) |           0 / 0 |           0 / 0 |                                  0 |
| renderBlockingCssGzipBytes               |          80 443 |          80 443 |                                  0 |
| lcpCandidateCount / Missing              |           1 / 0 |           1 / 0 |                                  0 |
| preLcpTransferBytes                      |         174 711 |         174 694 |                                −17 |
| bootBurstCount                           |              26 |              26 |                         0 (= próg) |
| **bootBurstGzipBytes**                   |         572 156 |         572 124 |                            **−32** |

- Pozostałe metryki są identyczne.
- Spadek domknięcia bootu bierze się z krótszej mapy `__vite__mapDeps` w wejściu, bo `WidgetView` ma mniej
  zależności. Kod wejścia jest ten sam.
- A zmierzone teraz daje `htmlGzipBytes` 49 536, a stan orkiestratora podaje 49 528. Różnica 8 B to inne hasze
  w tej samej bazie, czyli szum gzipa.
- Progów nie ruszałem. Spadki są za małe na ratchet, a o progach decyduje orkiestrator.

## 4. Lighthouse A/B (`--compare`, fixture, `--third-party fake-gtag`, `--warm-ua bot`, n = 5 na formę)

Wszystkie przebiegi są ważne: `VALID` 5/5 dla każdej strony i formy, 0 wykluczonych, load 0,7–2,1. Tryb FCP
„bez-js” w 20/20, 0 par mieszanych. Wariant dokumentu: `s-maxage=900`, 320 335 B w każdym przebiegu.

### 4.1 Mediany i delty

| Forma     | Strona    | perf |    FCP |    LCP |    TBT |     SI | CLS |    TTI | mainThread |  bootup |    req |     transfer |           JS |
| --------- | --------- | ---: | -----: | -----: | -----: | -----: | --: | -----: | ---------: | ------: | -----: | -----------: | -----------: |
| mobile    | A         |   98 | 1,37 s | 2,12 s |  51 ms | 1,39 s |   0 | 4,39 s |    2408 ms | 1103 ms |     51 |     881,7 KB |     615,4 KB |
| mobile    | B         |   98 | 1,39 s | 2,14 s |  83 ms | 1,51 s |   0 | 4,35 s |    2432 ms | 1121 ms | **42** | **811,9 KB** | **545,6 KB** |
| mobile    | DELTA B−A |   ±0 |  +0,02 |  +0,02 |    +32 |  +0,12 |  ±0 |      — |        +24 |     +17 | **−9** | **−69,8 KB** | **−69,8 KB** |
| desktop4x | A         |   95 | 0,40 s | 0,50 s | 177 ms | 0,53 s |   0 | 0,99 s |    2607 ms | 1164 ms |     53 |     886,5 KB |     620,2 KB |
| desktop4x | B         |   94 | 0,42 s | 0,49 s | 194 ms | 0,54 s |   0 | 1,12 s |    2602 ms | 1198 ms | **44** | **816,8 KB** | **550,4 KB** |
| desktop4x | DELTA B−A |   −1 |  +0,02 |  −0,00 |    +17 |  +0,01 |  ±0 |      — |         −5 |     +34 | **−9** | **−69,8 KB** | **−69,8 KB** |

`highPriorityBytesBeforeLcpImage` 112,4 KB po obu stronach. Element LCP jest ten sam (`img.eh-img`, `cover.jpg`).

### 4.2 Pary (PAIRS, t(df=4) = 3,72)

| Forma     | metryka |    Δ par |    σΔ | MDE(t) | MDE(z) | ocena                                                      |
| --------- | ------- | -------: | ----: | -----: | -----: | ---------------------------------------------------------- |
| mobile    | score   |     −0,2 |   0,8 |    1,4 |    1,0 | szum                                                       |
| mobile    | FCP     | +0,016 s | 0,059 |  0,098 |  0,074 | szum                                                       |
| mobile    | LCP     | +0,015 s | 0,112 |  0,186 |  0,140 | szum                                                       |
| mobile    | TBT     |   +30 ms |    27 |     45 |     34 | w MDE(t). Ta sesja była cicha (σΔ 27 przy σΔ bazy ~110).   |
| mobile    | SI      | +0,092 s | 0,075 |  0,124 |  0,094 | w MDE(t). Przyczyna to zadania przed JS, poza zmianą (§5). |
| mobile    | TTI     | +0,003 s | 0,148 |  0,247 |  0,186 | szum                                                       |
| desktop4x | score   |     −4,0 |   5,1 |    8,6 |    6,4 | szum (jedna para z B-1 = 82)                               |
| desktop4x | FCP     | −0,005 s | 0,046 |  0,076 |  0,058 | szum                                                       |
| desktop4x | LCP     | −0,000 s | 0,013 |  0,021 |  0,016 | szum                                                       |
| desktop4x | TBT     |   +67 ms |    93 |    154 |    116 | szum. Bez odstającego B-1 (420 ms) Δ mediany to +17 ms.    |
| desktop4x | SI      | +0,008 s | 0,029 |  0,049 |  0,037 | szum                                                       |
| desktop4x | TTI     | +0,129 s | 0,139 |  0,231 |  0,174 | szum                                                       |

Rozrzut przebiegów (TBT):

- mobile A 28–76 ms, B 46–114 ms; perf 98–99 po obu stronach;
- desktop4x A 165–201 ms, B 190–248 ms oraz B-1 420 ms (perf 82).

### 4.3 Księga Lantern (blokowanie per klasa, ms sym., przebiegi 1–5)

Mobile:

| klasa                                                                             | A                  | med A | B                  | med B |
| --------------------------------------------------------------------------------- | ------------------ | ----: | ------------------ | ----: |
| Style + Script:index [Style 96%] (to samo zadanie rAF `index`, różnie przypisane) | 29, 25, 23, 27, 30 |    27 | 37, 38, 35, 34, 58 |    37 |
| Script:vendor-react                                                               | 5, 2, 2, 3, 9      |     3 | 12, 33, 5, 12, 15  |    12 |
| ScriptCatchup                                                                     | 6, 0, 45, 0, 0     |     0 | 0, 0, 5, 0, 41     |     0 |
| Timer:index                                                                       | 13, 1, 6, 0, 0     |     1 | 9, 12, 13, 0, 0    |     9 |
| ParseHTML / Script:pl                                                             | 0 / 0,0,0,0,12     |     0 | 27 (B-3) / 0       |     0 |

Desktop4x:

| klasa                          | A                  | med A | B                    | med B |
| ------------------------------ | ------------------ | ----: | -------------------- | ----: |
| ScriptCatchup                  | 77, 80, 73, 93, 81 |    80 | 110, 82, 91, 121, 96 |    96 |
| Style                          | 53, 78, 86, 75, 78 |    78 | 166, 91, 93, 67, 62  |    91 |
| Script:vendor-react            | 8, 8, 10, 7, 19    |     8 | 139, 16, 6, 19, 11   |    16 |
| Other                          | 47, 0, 0, 22, 0    |     0 | 0 ×5                 |     0 |
| ParseHTML / Timer:index / inne | ≤ 8                |     0 | ≤ 18                 |   ≤ 5 |

Interpretacja:

- **Usuwane skrypty nie mają w księdze żadnej klasy**, ani w A, ani w B: `grep` po radix, lucide, formField, Composer,
  Mention, LayoutPreview, AdminSelect i euCountries we wszystkich 20 plikach `*.ledger.txt` nic nie znajduje.
  `bootup-time` (próg 50 ms) też ich nie wymienia.
- W śladach A (`tools/url-cost.py`) kompilacja i ewaluacja tych 9 URL-i na wątku głównym zajmują łącznie
  0,4–4,2 ms obs. Po pomnożeniu ×4 to ≤ 17 ms sym., rozłożone na 9 zadań < 50 ms. Kompilacja idzie z cache kodu
  (rozgrzewka `bot`) albo poza wątkiem. **Zmiana nie ma więc zadania, które mogłoby zniknąć z księgi**, a oczekiwany
  zysk TBT na fixture to ≈ 0, zgodnie z §9 planu („Zysk TBT trzeba potwierdzić pomiarem”).
- Wzrosty w B (Style rAF `index` +10 ms, `vendor-react` +9 ms na mobile; `ScriptCatchup` +16 ms na desktop4x)
  dotyczą zadań, które w obu stronach startują PRZED żądaniem `WidgetView`:
  - `ScriptCatchup` przy 460–510 ms obs. to kompilacja zestawu bootu;
  - `vendor-react` `_t` przy ~520 ms obs. to wycinek hydratacji ze schedulera React;
  - `WidgetView` startuje dopiero przy 671–830 ms obs. po obu stronach.

  Kod wykonywany do tego momentu jest w A i B ten sam (wejście różni się tylko mapą `__vite__mapDeps`, −141 B).
  Pary są przeplatane (A, B, B, A, A, B…), więc dryf maszyny się znosi. Zostaje szum losowy w granicach σΔ bazy
  (~110 ms mobile, ~130 ms desktop4x).

- B desktop4x-1 (TBT 420 ms) to pojedynczy odstający przebieg. `Style` 166 ms i `vendor-react` 139 ms przy 877 ms
  obs. leżą po `vendor-sonner`, w tej samej sekwencji co w A, a symulowane TTI jest dłuższe (1213 ms wobec
  838–1085 w pozostałych). Wodospad sieci po `WidgetView` (`TailoredMustReadsView`, `live`, `vendor-sonner` przy
  ~838–885 ms) jest w A i B taki sam.

### 4.4 Audyty jednego przebiegu (mobile-1)

|                                                       | A mobile-1                                    | B mobile-1                                   |
| ----------------------------------------------------- | --------------------------------------------- | -------------------------------------------- |
| żądania / transfer                                    | 51 / 881,7 KB                                 | 42 / 812,0 KB                                |
| High / VeryHigh / Low                                 | 48 / 2 / 1                                    | 39 / 2 / 1                                   |
| LCP: element                                          | `img.eh-img` (`cover.jpg`)                    | to samo                                      |
| LCP: TTFB / load delay / load duration / render delay | 24 / 30 / 11 / 194 ms                         | 17 / 28 / 21 / 134 ms                        |
| render-blocking                                       | `styles-*.css` 68,5 KB (savings 0 ms)         | to samo                                      |
| Unused JavaScript                                     | 223,1 KB (w tym `vendor-radix` 28,7 KB)       | **194,5 KB** (`vendor-radix` znika)          |
| main thread                                           | 2662 ms                                       | 2386 ms                                      |
| CLS                                                   | 0                                             | 0                                            |
| `WidgetView` żądany przy                              | 799 ms (+ 9 zależności równolegle, do 812 ms) | 712 ms (bez zależności poza vendorami bootu) |
| `FooterSlideup` żądany przy                           | 320 ms (zestaw bootu, jak dotąd)              | 264 ms (to samo)                             |

Wszystkie przebiegi (`reqs.py`):

| Przebieg        | żądań (wszystkie) | JS n / transfer        | 9 docelowych chunków  |
| --------------- | ----------------: | ---------------------- | --------------------- |
| A mobile-1…5    |                51 | 44 / 630 109–630 132 B | 9 / 71 430 B w każdym |
| B mobile-1…5    |                42 | 35 / 558 693 B         | **0** w każdym        |
| A desktop4x-1…5 |                53 | 46 / 635 077 B         | 9 / 71 430 B w każdym |
| B desktop4x-1…5 |                44 | 37 / 563 612–563 635 B | **0** w każdym        |

## 5. Speed Index na mobile (+0,09 s w parach): przyczyna poza zmianą

Lantern liczy `SI = max(FCP, 1,4·obsSI + 0,4·layoutSI)`. `layoutSI` to średnia końców (czas sym.) węzłów CPU
z `Layout`, ważona `log2(czasu trwania)`. Rozkład z `LanternSpeedIndex` (narzędzie `tools/si-layout.mjs`, wynik
w `si-layout-summary.txt`):

| Przebieg   |           SI | obsSI (opt.) | layoutSI (pes.) | węzły Layout | w tym wczesne (obs < 300 ms, przed pierwszym skryptem) | późne końce sym. (rAF `index` / `vendor-react`) |
| ---------- | -----------: | -----------: | --------------: | -----------: | -----------------------------------------------------: | ----------------------------------------------- |
| A mobile-1 | 1391 (= FCP) |          246 |            2595 |            6 |                                                  **4** | 3609 / 4750                                     |
| A mobile-2 | 1371 (= FCP) |          211 |            2591 |            6 |                                                  **4** | 3569 / 4725                                     |
| A mobile-3 |         1485 |          238 |            2879 |            4 |                                                      2 | 3417 / 4569                                     |
| A mobile-4 |         1500 |          224 |            2964 |            4 |                                                      2 | 3594 / 4714                                     |
| A mobile-5 | 1370 (= FCP) |          244 |            2557 |            6 |                                                  **4** | 3631 / 4887                                     |
| B mobile-1 |         1503 |          220 |            2987 |            4 |                                                      2 | 3492 / 4604                                     |
| B mobile-2 |         1414 |          190 |            2871 |            5 |                                                      3 | 3464 / 4620                                     |
| B mobile-3 |         1575 |          239 |            3100 |            4 |                                                      2 | 3760 / 4903                                     |
| B mobile-4 |         1511 |          213 |            3031 |            4 |                                                      1 | 3472 / 4575                                     |
| B mobile-5 |         1576 |          215 |            3185 |            4 |                                                      1 | 3663 / 4753                                     |

- Późne węzły Layout, czyli te, na które zmiana mogłaby wpłynąć, kończą się w A i B w tym samym przedziale.
  rAF `index`: A 3417–3631, B 3464–3760. `vendor-react`: A 4569–4887, B 4575–4903.
- Różnicę SI w całości tłumaczy liczba **wczesnych** węzłów Layout. To drobne zadania 1–16 ms obs. przy 64–221 ms
  obs. (`RunTask`, `EventDispatch`, `FireAnimationFrame` pierwszej klatki), które Chrome wykonuje, zanim padnie
  pierwsze żądanie skryptu (~314 ms).
  - Przebiegi z 4 wczesnymi węzłami mają `layoutSI` ≈ 2,56–2,60 s i SI = FCP. Z 1–3 węzłami SI wynosi 1,41–1,58 s.
  - A trafiło 4 wczesne węzły w 3/5 przebiegów, B w 0/5.
- Ten podział pierwszej klatki zależy od strumienia dokumentu i arkusza, a te są w A i B identyczne (`htmlRawBytes`
  i CSS bez zmian). P3.9 zmienia tylko chunki ładowane po hydratacji.
- Kontrola na innych przebiegach tego samego dnia i tego samego harnessu: P3.2b (A i B) oraz P3.7a (A i B), razem
  20 przebiegów mobile. Wczesnych węzłów było 2–3 w 20/20, 4 w 0/20, a SI wynosił 1,47–1,73 s.
- **Wniosek:** to A miało w tej sesji nietypowo korzystne SI, a nie B regres. B (1,41–1,58 s) leży w zwykłym
  rozkładzie bazy. Na desktop4x SI Δ = +0,008 s (MDE 0,049).

## 6. Ocena wobec kryteriów dowodu

| Kryterium                                                                           | Plan / nota                                        | Pomiar                                                                                  | Ocena                                                                                                                                          |
| ----------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| liczba żądań JS na `/`                                                              | −11…−12 (A+B planu). Dla samej części A: −9 (IMPL) | **−9** w 10/10 par                                                                      | zgodne z częścią A. Część B nie miała czego usunąć (§2).                                                                                       |
| transfer JS                                                                         | −~80 KB (A+B). Dla części A: ~−71 KB               | **−71 430 B** w każdym przebiegu                                                        | zgodne                                                                                                                                         |
| `formFieldConfig`/`vendor-radix(-select)`/`LayoutPreview`/`vendor-lucide` nieobecne | wymagane                                           | nieobecne 10/10                                                                         | zgodne                                                                                                                                         |
| `blog.index`/`cfp-submit` nieobecne                                                 | wymagane                                           | nieobecne w A i B                                                                       | spełnione już przez bazę                                                                                                                       |
| boot bez wzrostu, `bootBurstCount` ≤ 26                                             | wymagane                                           | −141 B raw, −34 B gz, 26                                                                | zgodne                                                                                                                                         |
| FCP/LCP ±0,02 s, CLS bez zmian                                                      | wymagane                                           | FCP/LCP w parach +0,016/+0,015 s (mobile) i −0,005/−0,000 s (desktop4x), CLS 0          | zgodne (szum)                                                                                                                                  |
| kierunek ΔTBT ≤ 0                                                                   | oczekiwany                                         | +30 ms (mobile, σΔ 27) i +67 ms (desktop4x, σΔ 93, jedna para odstająca). Oba w MDE(t). | **nierozstrzygnięte**: żadne zadanie usuniętych skryptów nie było w księdze (≤ 4 ms obs.), a różnice dotyczą zadań sprzed żądania `WidgetView` |
| e2e artefaktu, popupów i stopki                                                     | wymagane                                           | 18/18, 1/1, 2/2, 26/26                                                                  | zgodne                                                                                                                                         |

## 7. Uwagi dla orkiestratora

- Zmiana jest gotowa do scalenia: bramki zielone, bajty i żądania `/` spadają deterministycznie.
- Do bramki fali: przy następnym A/B mobile warto patrzeć na `layoutSI` z rozbiciem na wczesne węzły
  (`tools/si-layout.mjs`). Tutaj losowa liczba węzłów pierwszej klatki przesuwa SI o ~0,1–0,2 s, czyli więcej niż
  zmiana, którą mierzymy.
- Zapas progów document-weight: `bootClosureGzipBytes` ma 1 788 B (494 891 / 496 679),
  `bootClosureRawBytes` 5 468 B. P3.3 doda później +550 raw / +247 gz / +237 burst. `bootBurstCount` zostaje 26 = próg.
- Na produkcji według diagnozy (`martwy-kod.md` §5) oszczędność jest podobna: ~64 KB + `vendor-lucide` 19,5 KB
  transferu oraz 9 żądań po hydratacji. Nie dotyczy to LCP. Potwierdzenie przyjdzie po wdrożeniu Lighthouse'em
  z kontenera.
