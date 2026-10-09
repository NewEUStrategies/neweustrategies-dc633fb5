# P3.8 (fala 3) — dowód (Prove): zero żądań Supabase z bootu anonimowej strony

Data: 2026-10-08. A = baza partii 2 `base-w3b` @ `63a05a32` (zbudowana wcześniej, bez przebudowy), B = worktree
`wt3/P3.8` @ `97ae43c1` (gałąź `perf/w3-P3.8`), build `env BUNDLE_INVENTORY=1 bun run build:smoke` (zielony, 3 min 1 s).
Logi i surowe wyniki: `$SCRATCH/phase3/wave3/P3.8/` (`build.log`, `check:*.log`, `document-weight*.json`,
`e2e-artifact.log`, `e2e-item.log`, `ab.log`, `lh/`, `ledger-diff-*.txt`, `tools/`).

Prośba użytkownika przekazana przez harness („jeden font — ma to być Red Hat Display”) tej pozycji nie dotyczy. To P3.2b
(decyzja właściciela w `PLAN-FALI-3.md`), a P3.8 nie zmienia `@font-face` ani preloadu fontów (oba pliki
`red-hat-display-latin*` są w A i B bez zmian). Z tą pozycją nie ma konfliktu.

## 0. Werdykt

| Kryterium (PLAN-FALI-3 §2 P3.8 + nota orkiestratora)                                    | Wynik                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Linia `backend:` harnessu na `/` = 0 we wszystkich przebiegach B                        | **NIE** (dosłownie): 5–15 zapytań w każdym przebiegu B. Licznik obejmuje cały przebieg LH, także czas po śladzie (zob. §3).                                                                                                                      |
| 0 żądań REST w **oknie bootu** (ślad LH / devtoolslog)                                  | **7/10 przebiegów B: 0** (A: 5–6 GET + 5–6 preflight w KAŻDYM przebiegu). **3/10 B: 5–8 × `posts`** (dokument starszy niż 120 s), bo `useSectionPreload` robi `prefetchQuery` sekcji nieświeżych i omija politykę #5. To ta sama ścieżka co w A. |
| Lighthouse `--compare` mobile + desktop4x, n = 5, bez regresji (ΔTBT ≤ 0, ΔCLS ≤ 0,001) | **TAK**: ΔTBT pary −40 ms / −42 ms, CLS 0 → 0, pozostałe metryki w szumie                                                                                                                                                                        |
| e2e popupów i degradacji                                                                | **TAK**: `on-demand-overlays` 1/1, `popup-first-render` 2/2, `ssr-degradation` 26/26, `test:e2e:artifact` 13/13 (z nowym `backend-quiet.boot-home`)                                                                                              |
| `check:document-weight` (zapas boot 0,6 KB)                                             | **zielony, ale boot ROŚNIE** zamiast maleć: `bootClosureGzipBytes` +297 B (484,4 → 484,7 / 485,0 KB, zostaje **0,3 KB** zapasu); `bootBurstGzipBytes` +327 B (560,6 → 560,9 / 561,2)                                                             |
| `check:bundle`: nie gorzej niż baza                                                     | overall −0,7 KB, public −0,3 KB; **entry +0,2 KB gz**, **boot closure +0,3 KB gz / +0,7 KB raw**                                                                                                                                                 |

`effect_matches_plan = partly`. Strukturalnie efekt jest zgodny z planem:

- z okna bootu znikają `site_design_tokens`, `post_layout_settings`, `ad_placements`, `newsletter_settings`
  i `builder_popups` (z preflightami) oraz 5 chunków nakładek;
- Script:vendor-react w księdze spada o ponad połowę.

Rozmiar efektu jest nierozstrzygnięty: wszystkie Δ metryk mieszczą się w MDE. Kryterium „0 we wszystkich przebiegach”
nie jest spełnione z powodu ścieżki `useSectionPreload` (plik poza listą P3.8).

`needs_fix = true` (jedna runda):

1. **`useSectionPreload`.** Sekcja z danymi z SSR (`dataUpdatedAt > 0`) przy zamkniętym zatrzasku nie powinna robić
   `prefetchQuery` tylko z powodu wieku. Wystarczy odłożyć `run()` przez `onInteractionOrQuiet`, z tymi samymi wyjątkami
   co #5: `updatedAt: 0` i unieważnione od razu, brak danych od razu. Plik `src/lib/builder/useSectionPreload.ts` jest
   POZA listą P3.8, więc rozszerzenie zakresu wymaga zgody orkiestratora. Na produkcji dokumenty często są STALE
   (> 180 s), więc bez tej poprawki `posts` × 5–8 z preflightami zostają w oknie LCP/SI.
2. **Odzyskać ~0,3 KB gz z zamknięcia bootu.** Nota oczekiwała odchudzenia, a jest przyrost. Bramka jest zielona, ale
   kolejna pozycja nie ma już zapasu.
3. (Opcjonalnie, z recenzji) M1, czyli kotwica `activationStart` dla prerenderu, nie została wprowadzona
   (`grep activationStart` = 0 w trzech plikach).

## 1. Bramki artefaktu

| Bramka                                                              | A (baza)                    | B (P3.8)                                                        | Wynik                        |
| ------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------- | ---------------------------- |
| `build:smoke` (BUNDLE_INVENTORY=1)                                  | —                           | exit 0                                                          | zielony                      |
| `check:bundle` overall                                              | 4754,4 / 4772 KB            | 4753,7 KB (−0,7)                                                | zielony                      |
| public JS                                                           | 2804,0 / 2877 KB            | 2803,7 KB (−0,3)                                                | zielony                      |
| admin-only                                                          | 1950,4 KB                   | 1950,0 KB                                                       | —                            |
| largest chunk (`index`, wejście)                                    | 262,2 / 286 KB              | 262,4 KB (**+0,2**)                                             | zielony, gorzej              |
| CSS all / public                                                    | 95,0 / 81,2 KB              | 95,0 / 81,2 KB                                                  | zielony                      |
| **Boot closure**                                                    | 487,8 KB gz / 1598,6 KB raw | **488,1 KB gz / 1599,3 KB raw** (+0,3 / +0,7)                   | zielony (budżet 579), gorzej |
| `check:chunks`                                                      | —                           | 893 chunki, 6845 krawędzi, acykliczny                           | zielony                      |
| `check:entry-purity`                                                | —                           | „Sciezka bootowania czysta”                                     | zielony                      |
| `check:server-entry-purity`                                         | —                           | 1813 plików, czysty (leniwe: stripe; dług: node-html-parser ×2) | zielony                      |
| `test:e2e:artifact` (env CI: NES_ARTIFACT_FIXTURE=1 + placeholdery) | 12/12 (stan bazy)           | **13/13** (w tym nowy `backend-quiet.boot-home`)                | zielony                      |
| `on-demand-overlays` (playwright.performance, artefakt B)           | —                           | 1/1                                                             | zielony                      |
| `popup-first-render` (playwright.performance)                       | —                           | 2/2 (1440 px, 390 px)                                           | zielony                      |
| `ssr-degradation` (playwright.config, dev-server, CI=1)             | —                           | 26/26                                                           | zielony                      |
| `check:document-weight`                                             | zielony                     | zielony                                                         | zielony (ciasno)             |

Linia `Boot closure` (B): `Boot closure: 488.1 KB gzip / 1599.3 KB raw  (10 chunków statycznie osiągalnych ze
SSR-owego <script>; budget ≤ 579 KB)`.

Ruchy względem baseline'u `b006c2e` są w A i B identyczne. Ta zmiana nie dodaje żadnego ruchu:

- spreadsheet.worker +131,5 (NOWY);
- index −45,6;
- lucide-shim.fa −24,1;
- club._clubSlug.index +16,5;
- admin.seo +7,5 (NOWY);
- i18n-club +3,0;
- category._slug −2,5;
- icons-0/1/3 −2,5/−2,5/−2,4;
- profile.notifications −2,4;
- SeoPanel +2,4;
- znikł i18n-admin-seo-hub.

## 2. Waga dokumentu (`check-document-weight`, GET `/`, fixture, HIT, 5 próbek)

| Metryka                                  |                  A |                  B |        Δ |          Próg |
| ---------------------------------------- | -----------------: | -----------------: | -------: | ------------: |
| htmlRawBytes                             | 337 696 (329,8 KB) | 338 386 (330,5 KB) |     +690 |      396,7 KB |
| htmlGzipBytes                            |             52 544 |             52 602 |      +58 |       56,4 KB |
| headRawBytes                             |             28 758 |             28 758 |        0 |       28,7 KB |
| inlineStyleCount / Bytes                 |        25 / 84 717 |        25 / 84 717 |        0 | 50 / 132,4 KB |
| inlineScriptBytes                        |             86 617 |             87 307 |     +690 |       95,8 KB |
| inlineExecutableScriptBytes              |             79 373 |             80 063 |     +690 |       89,6 KB |
| dehydratedStateBytes                     |   60 357 (58,9 KB) |   61 047 (59,6 KB) | **+690** |       64,9 KB |
| modulepreloadCount                       |                  0 |                  0 |        0 |             0 |
| linkHeaderEntries                        |                  5 |                  5 |        0 |             5 |
| preloadDuplicates / w dokumencie         |              3 / 0 |              3 / 0 |        0 |         3 / 0 |
| imagePreloadCount                        |                  3 |                  3 |        0 |             3 |
| imgFetchpriorityHigh                     |                  1 |                  1 |        0 |             2 |
| bootClosureRawBytes                      |          1 636 946 |          1 637 720 |     +774 |     1599,4 KB |
| **bootClosureGzipBytes**                 | 496 041 (484,4 KB) | 496 338 (484,7 KB) | **+297** |      485,0 KB |
| preloadedJsCount / GzipBytes (pula High) |              0 / 0 |              0 / 0 |        0 |             0 |
| renderBlockingCssGzipBytes               |             80 426 |             80 426 |        0 |       79,5 KB |
| lcpCandidateCount / Missing              |              1 / 0 |              1 / 0 |        0 |             — |
| preLcpTransferBytes                      |            177 702 |            177 760 |      +58 |      177,3 KB |
| bootBurstCount                           |                 26 |                 26 |        0 |            26 |
| **bootBurstGzipBytes**                   | 574 062 (560,6 KB) | 574 389 (560,9 KB) | **+327** |      561,2 KB |

Interpretacja:

- **+690 B stanu SSR.** Dochodzą dwa nowe wpisy: `site_font_scale` (`{}`) i `builder-popups-active` (`[]`). Każdy wpis
  TanStack ma ~300 B narzutu (`queryHash`, `state`), więc IMPL zaniżał ten koszt („kilkadziesiąt bajtów”). Gzip: +58 B.
- **Boot.** Moduły dotknięte w chunku wejściowym (`router.tsx`, `__root.tsx`, `ContentAreaStyle`, `lib/ads/queries`,
  `useNewsletterSettings`) dają +297 B gz. Zapas `bootClosureGzipBytes` spada z 0,6 do 0,3 KB, a
  `bootBurstGzipBytes` z 0,6 do 0,3 KB.
- Progi nie zmienione (ratchet tylko w dół i tylko przez właściciela plików document-weight; tu nic nie spadło).

## 3. Żądania backendu: linia harnessu kontra okno bootu

Linia `backend:` liczy żądania do PostgREST fixture przez **cały przebieg Lighthouse'a**, aż do zamknięcia karty. Ślad
(okno bootu) kończy się po 3,2–4,0 s od nawigacji. Punkt ciszy zatrzasku (≥ 5 s po `load`) zapada już po śladzie,
a jeszcze przed zamknięciem karty. Dlatego obie miary są podane osobno: okno bootu to żądania REST
w `devtoolslog.json` / `network-requests` danego przebiegu.

| Przebieg          | Wiek dokumentu przy LH | `backend:` (cały przebieg) | REST w oknie bootu (GET + preflight) | Tabele w oknie bootu                                                                         | Koniec śladu |
| ----------------- | ---------------------: | -------------------------- | -----------------------------------: | -------------------------------------------------------------------------------------------- | -----------: |
| A mobile-1        |                    7 s | 7 + 7                      |                                5 + 5 | site_design_tokens, post_layout_settings, ad_placements, newsletter_settings, builder_popups |      3448 ms |
| A mobile-2        |                   88 s | 9 + 9                      |                                6 + 6 | j.w., ad_placements ×2                                                                       |      3385 ms |
| A mobile-3        |                  110 s | 13 + 12                    |                                6 + 6 | j.w., ad_placements ×2                                                                       |      3596 ms |
| A mobile-4        |                    4 s | 7 + 7                      |                                5 + 5 | j.w.                                                                                         |      3556 ms |
| A mobile-5        |                   25 s | 7 + 7                      |                                5 + 5 | j.w.                                                                                         |      3712 ms |
| A desktop4x-1     |                   73 s | 9 + 9                      |                                6 + 6 | j.w., ad_placements ×2                                                                       |      4012 ms |
| A desktop4x-2     |                  138 s | 17 + 15                    |                              14 + 12 | j.w. + **posts ×8**                                                                          |      3750 ms |
| A desktop4x-3     |                    4 s | 7 + 7                      |                                5 + 5 | j.w.                                                                                         |      3647 ms |
| A desktop4x-4     |                   75 s | 9 + 9                      |                                6 + 6 | j.w., ad_placements ×2                                                                       |      3953 ms |
| A desktop4x-5     |                   97 s | 9 + 9                      |                                6 + 6 | j.w., ad_placements ×2                                                                       |      3681 ms |
| **B mobile-1**    |                   26 s | 5 + 5                      |                                **0** | —                                                                                            |      3258 ms |
| **B mobile-2**    |                   65 s | 7 + 6                      |                                **0** | —                                                                                            |      3251 ms |
| B mobile-3        |                  128 s | 15 + 14                    |                                5 + 5 | **posts ×5**                                                                                 |      3384 ms |
| B mobile-4        |                  149 s | 15 + 14                    |                                5 + 5 | **posts ×5**                                                                                 |      3381 ms |
| **B mobile-5**    |                    4 s | 5 + 5                      |                                **0** | —                                                                                            |      3192 ms |
| **B desktop4x-1** |                   47 s | 6 + 6                      |                                **0** | —                                                                                            |      3571 ms |
| **B desktop4x-2** |                   69 s | 6 + 6                      |                                **0** | —                                                                                            |      3566 ms |
| B desktop4x-3     |                  138 s | 14 + 12                    |                                8 + 6 | **posts ×8**                                                                                 |      3658 ms |
| **B desktop4x-4** |                    4 s | 5 + 5                      |                                **0** | —                                                                                            |      3551 ms |
| **B desktop4x-5** |                   70 s | 6 + 6                      |                                **0** | —                                                                                            |      3708 ms |

Wnioski:

- **#1 (`site_design_tokens`) i #4a (`builder_popups`)** znikają z CAŁEGO przebiegu B, także z licznika. W A są
  w każdym przebiegu.
- **#2, #3, #4b, #5 i #6** (`post_layout_settings`, `ad_placements`, `newsletter_settings`, `categories`, `tags`):
  w B nie ma ich w oknie bootu w żadnym przebiegu. Pojawiają się w liczniku po śladzie, czyli przy zatrzasku, zgodnie
  z projektem. `categories`/`tags` także w A padały dopiero po śladzie. Dlatego „7 + 7” z diagnozy obejmowało 2 żądania
  spoza okna, a w oknie bootu A miało 5–6 GET + 5–6 preflight.
- **Reszta: `posts` ×5–8 o ~950 ms** w przebiegach z dokumentem starszym niż 120 s (B: 128, 138 i 149 s; A: 138 s).
  Źródło to `src/lib/builder/useSectionPreload.ts` `run()`:
  - `isSectionFresh` porównuje `Date.now() - dataUpdatedAt` ze `staleTime` sekcji (120 s:
    `postListQuery`, `sliderPostsQuery`, `sliderFallbackQuery`, `newsTickerQuery`);
  - dla wpisu nieświeżego robi `prefetchQuery` po `whenIdle`, czyli pobiera niezależnie od `refetchOnMount`.

  Polityka #5 (`bootRefetchOnMount` w `router.tsx`) tej ścieżki nie obejmuje, mimo że IMPL wymienia `posts` w #5.
  Fixture HIT trzyma dokumenty młode (4–149 s). Na produkcji dokument STALE ma > 180 s, więc ta ścieżka będzie tam
  regułą, nie wyjątkiem.

## 4. Lighthouse A/B (`--compare`, n = 5, mobile + desktop4x, fixture, fake-gtag, rozgrzewka bot, przeplot)

Ważność:

- VALID: A mobile 5/5, A desktop4x 5/5, B mobile 5/5, B desktop4x 5/5 (excluded 0, HIT we wszystkich, tryb FCP
  `bez-js` 5/5, pary mieszane 0/5).
- Jedna powtórka B mobile-2 przez błąd wykonania LH (`NO_NAVSTART`) nie jest wykluczeniem.
- Obciążenie przy starcie przebiegów 1,1–2,2, poniżej progu 2,4.

### Mediany

| Forma     | Strona | perf |    FCP |    LCP |    TBT |     SI |   CLS |    TTI | mainThread |  bootup | long tasks | req | transfer |       JS |
| --------- | ------ | ---: | -----: | -----: | -----: | -----: | ----: | -----: | ---------: | ------: | ---------: | --: | -------: | -------: |
| mobile    | A      |   94 | 1,54 s | 2,31 s | 213 ms | 1,72 s | 0,000 | 5,43 s |    3096 ms | 1411 ms |         11 |  70 | 914,6 KB | 638,7 KB |
| mobile    | B      |   96 | 1,52 s | 2,27 s | 164 ms | 1,53 s | 0,000 | 4,69 s |    3001 ms | 1233 ms |          9 |  55 | 897,7 KB | 628,2 KB |
| desktop4x | A      |   90 | 0,45 s | 0,54 s | 260 ms | 0,66 s | 0,000 | 1,32 s |    3242 ms | 1587 ms |         10 |  75 | 920,3 KB | 643,8 KB |
| desktop4x | B      |   92 | 0,46 s | 0,54 s | 225 ms | 0,62 s | 0,000 | 1,26 s |    2929 ms | 1352 ms |          9 |  58 | 902,8 KB | 633,2 KB |

Rozrzut:

- mobile A: TBT 80–315 ms, perf 91–97;
- mobile B: TBT 86–251 ms, perf 93–98;
- desktop4x A: TBT 196–363 ms, perf 84–94;
- desktop4x B: TBT 189–267 ms, perf 90–95.

### DELTA B−A (mediany) i pary (n = 5, t(df = 4) = 3,72)

| Forma     | Metryka | Δ mediany |      Δ̄ par |    σΔ | MDE(t) | W szumie?            |
| --------- | ------- | --------: | ---------: | ----: | -----: | -------------------- |
| mobile    | score   |        +2 |       +1,6 |   2,3 |    3,8 | tak                  |
| mobile    | FCP     |   −0,02 s |   −0,027 s | 0,035 |  0,058 | tak                  |
| mobile    | LCP     |   −0,04 s |   −0,047 s | 0,065 |  0,107 | tak                  |
| mobile    | **TBT** |    −49 ms | **−40 ms** |    90 |    149 | tak (kierunek ≤ 0 ✓) |
| mobile    | SI      |   −0,19 s |   −0,084 s | 0,193 |  0,320 | tak                  |
| mobile    | TTI     |         — |   −0,476 s | 0,387 |  0,643 | tak                  |
| mobile    | CLS     |    ±0,000 |          — |     — |      — | ✓ (≤ 0,001)          |
| desktop4x | score   |        +2 |       +2,6 |   3,1 |    5,2 | tak                  |
| desktop4x | FCP     |   +0,01 s |   +0,006 s | 0,075 |  0,125 | tak                  |
| desktop4x | LCP     |   +0,00 s |   +0,009 s | 0,031 |  0,052 | tak                  |
| desktop4x | **TBT** |    −35 ms | **−42 ms** |    55 |     91 | tak (kierunek ≤ 0 ✓) |
| desktop4x | SI      |   −0,04 s |   −0,012 s | 0,027 |  0,045 | tak                  |
| desktop4x | TTI     |         — |   −0,122 s | 0,209 |  0,348 | tak                  |
| desktop4x | CLS     |    ±0,000 |          — |     — |      — | ✓                    |

Pozostałe Δ mediany:

- mobile: mainThread −95 ms, bootup −179 ms, transfer −16,9 KB, skrypty −10,5 KB, żądania −15;
- desktop4x: mainThread −313 ms, bootup −235 ms, transfer −17,5 KB, skrypty −10,5 KB, żądania −17;
- highPriorityBytesBeforeLcpImage bez zmian (112,4 KB).

Brak regresji: ΔTBT ≤ 0 w obu formach, ΔCLS = 0, a FCP/LCP/SI mieszczą się w MDE. Rozmiar efektu jest
nierozstrzygnięty: żadna Δ nie przekracza MDE(t). Ślad lokalny kończy się po ~3,5 s, a fixture odpowiada w ~50 ms,
więc żądania REST nie konkurowały tu o sieć ani o wątek tak jak na produkcji.

### Księga Lantern per zadanie (suma księgi = audyt w 20/20)

Średnie blokowanie per klasa na przebieg (ms):

| Forma     | Strona | zadań ≥ 10 ms / przebieg | ScriptCatchup | Style | **Script:vendor-react** | Timer* | inne |
| --------- | ------ | -----------------------: | ------------: | ----: | ----------------------: | -----: | ---: |
| mobile    | A      |                     10,8 |            63 |    61 |                  **43** |     21 |   13 |
| mobile    | B      |                      8,6 |            71 |    57 |                  **20** |     10 |    2 |
| desktop4x | A      |                     10,0 |           103 |   101 |                  **54** |      5 |    9 |
| desktop4x | B      |                      9,2 |           104 |    90 |                  **20** |      5 |   12 |

Zadanie-cel (render Reacta po odpowiedziach zapytań, `Script:vendor-react` 600–1050 ms obs) maleje o ponad połowę
w obu formach (−23 ms / −34 ms na przebieg), a liczba zadań ≥ 10 ms spada o 2,2 / 0,8 na przebieg. Nie znika
całkowicie: pierwsza klatka hydratacji zostaje.

W B mobile-3 ScriptCatchup trwa 106 ms (A 17 + 0). Ta sama klasa w innych parach waha się o ±25 ms, a ΔTBT pary
(+55 ms) mieści się w σΔ, więc to szum, nie zadanie nowe dla P3.8. Szczegóły par: `ledger-diff-mobile.txt`,
`ledger-diff-desktop4x.txt`.

### Speedline (obsSI z prawdziwego filmstripu, mobile)

|           |   1 |   2 |   3 |   4 |   5 | mediana |
| --------- | --: | --: | --: | --: | --: | ------: |
| A SI (ms) | 313 | 305 | 264 | 248 | 348 |     305 |
| B SI (ms) | 336 | 278 | 289 | 354 | 265 |     289 |

Bez zmian (szum ±50 ms). Lokalnie P3.8 nie może ruszyć obsSI, bo nic wizualnego nie zależało od tych żądań.

### Audyty jednego przebiegu (mobile-1 A vs B)

|                                                       | A mobile-1                                 | B mobile-1            |
| ----------------------------------------------------- | ------------------------------------------ | --------------------- |
| Żądania / transfer                                    | 70 / 914,6 KB                              | 55 / 897,7 KB         |
| Element LCP                                           | `img.eh-img` (`cover.jpg`, preload, eager) | ten sam               |
| LCP: TTFB / load delay / load duration / render delay | 23 / 31 / 37 / 139 ms                      | 21 / 28 / 14 / 194 ms |
| CLS                                                   | 0                                          | 0                     |
| mainthread / bootup                                   | 3302 / 1542 ms                             | 3026 / 1233 ms        |
| long tasks                                            | 11                                         | 9                     |

Zbiór żądań B = A minus 15:

- 5 × Fetch i 5 × Preflight `/rest/v1/` (`site_design_tokens`, `post_layout_settings`, `ad_placements`,
  `newsletter_settings`, `builder_popups`);
- 5 chunków: `NewsletterPopup`, `PopupHost`, `PopupImage`, `popups`, `parseCsv`.

Nowych żądań w B nie ma. Render delay LCP 194 ms wobec 139 ms to pojedyncza para; mediana LCP w B jest niższa o 40 ms.

## 5. Ocena względem kryteriów i co do poprawki

- **Struktura (tak, z wyjątkiem):**
  - #1 i #4a działają w pełni (zero żądań w całym przebiegu);
  - #2, #3, #4b, #5 i #6 zdejmują żądania z okna bootu i przenoszą je za zatrzask;
  - #4b zdejmuje 5 chunków nakładek z okna LH;
  - SSR niesie sygnał `builder-popups-active: []`, bo bramka `useNoActivePopupsFromSsr` ożywa i `PopupHost` z chunkami
    nie jest pobierany.
- **Wyjątek (do poprawki):** stary dokument (> 120 s) i sekcje z listami wpisów, czyli `useSectionPreload`
  `prefetchQuery`, który omija #5. Kryterium „0 we wszystkich przebiegach B” nie jest więc spełnione w 3/10 przebiegów
  w oknie bootu. Na linii `backend:` całego przebiegu nie jest spełnione w żadnym, bo licznik obejmuje czas po
  zatrzasku. Tego licznika nie da się sprowadzić do 0 bez blokowania zatrzasku do końca LH, co nie jest celem pozycji.
  Kryterium powinno być czytane jako okno bootu (ślad).
- **Rozmiar (nierozstrzygnięty):** TBT −40 / −42 ms (pary), poniżej MDE(t) 149 / 91 ms. Kierunek jest zgodny
  z planem, a księga potwierdza mechanizm (vendor-react −53 % / −63 %).
- **Bajty bootu (do poprawki):** +297 B gz w zamknięciu bootu przy zapasie 0,6 KB. Bramka zielona, ale zostaje
  0,3 KB, a nota oczekiwała raczej odchudzenia.
- **Bez regresji:** zalogowani, admin i edytor są pokryci testami jednostkowymi implementera (bez zmian w tym etapie).
  e2e degradacji 26/26, nakładek 1/1 i popupów 2/2.

Zmiany zachowania z IMPL §4 zostają w mocy:

- popup `immediate` pokazuje się ~400 ms po otwarciu zatrzasku;
- pasek dolny pokazuje się po max(zatrzask, `delay_ms`);
- nowo aktywowany popup buildera anonim widzi z opóźnieniem świeżości dokumentu.

Otwarte z recenzji: M1 (prerender i `activationStart`).
