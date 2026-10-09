# P3.7b (fala 3, partia 4a): PROVE

Data: 2026-10-09. A = `base-w3g` (64dddffe, `.output` bazy bez przebudowy). B = worktree `wt3/P3.7b` (gałąź
`perf/w3-P3.7b`, commit `aaf54740`), zbudowany tu przez `BUNDLE_INVENTORY=1 bun run build:smoke` pod mutexem (exit 0).
`$P` = `$SCRATCH/phase3/wave3/P3.7b`, `$SCRATCH` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad`.
Wszystkie logi i surowe pliki leżą w `$P`.

## 0. Werdykt

- **Bajty dokumentu: cel spełniony.** `htmlRawBytes` −12 883 B (328 326 → 315 443; próg pozycji ≥ −11,5 KB, zapas
  ok. 1,1 KB). `/en` −13 064 B. Wariant LH (bot) −12 883 B (321 271 → 308 388). Rozbicie jest dokładne:
  bariera `$tsr` −8 280 + porcje strumienia −3 473 + `<head>` (speculation rules) −1 130 = −12 883 B.
  `htmlGzipBytes` −1 083 B, transfer dokumentu w LH −932 B.
- **Metryki stanu:** `dehydratedQueryHashCount` = **0** (A: 21). `streamedStateBytes` = **6 878 B** (A: 10 351).
  `imagePreloadNonCandidate` = 0, `documentPreloadDuplicates` = 0.
- **Parytet: zielony.** Znaczniki `<body>` A i B (bez `<script>`/`<style>`, hashe zasobów znormalizowane) są
  **bajtowo identyczne** na `/` i `/en`. `<head>` różni się wyłącznie blokiem speculation rules (2 375 → 1 245 B), a
  3 bloki JSON-LD są równe (T5). `test:e2e:artifact` 31/31. Sonda e2e: zero żądań danych po hydratacji na `/` i
  `/en` (telefon i desktop, A i B), zero błędów hydratacji. Miękka zmiana języka: pasek się nie zapada, a CLS bez
  wejścia wynosi 0 we wszystkich 8 przejściach.
- **Koszt JS: gorzej niż baza i ponad limit pozycji.** Domknięcie bootu **+2 018 B raw / +753 B gz**
  (`check:document-weight`). KRYTYKA §3.3 dawała P3.7b limit ≤ +1,0 KB raw. `check:bundle`: overall +1,5 KB,
  public +1,2 KB, wejście +0,7 KB, boot +0,8 KB gz. Bramki są zielone, ale nota orkiestratora wymaga „nie gorzej niż
  baza” dla overall/public/entry/boot. Zapas progów spada: `bootClosureRawBytes` 5 213 → **3 195 B**,
  `bootClosureGzipBytes` 1 702 → **949 B**, `bootBurstGzipBytes` 2 476 → 1 668 B. Szczegóły w §2.
- **Lighthouse (n = 5 par na formę, VALID 5/5, 0 wykluczeń):** CLS 0 we wszystkich 20 przebiegach. FCP i LCP w
  szumie: mobile −0,05 / −0,07 s, desktop4x −0,01 / 0,00 s. TBT bez regresji: mobile −73 ms (σΔ 61, MDE 102),
  desktop4x +7 ms (σΔ 68, MDE 113).
  - Porcje ParseHTML: na mobile suma w dół w 5/5 par (mediana 47,2 → 32,9 ms), ale Δ̄ −11 ms leży poniżej MDE 17,7.
    Na desktopie bez zmian.
  - Ewaluacja skryptów inline dokumentu (`$tsr`): mobile −4,0 ms (5/5, MDE 4,5).
  - LH `bootup-time` dokumentu: desktop **−33 ms (5/5, istotne)**, mobile −30 ms (4/5, szum).
  - **Zadanie PB2 nie jest krótsze** (mobile 17,0 → 16,7 ms, desktop 15,0 → 14,1 ms, w szumie). Klient płaci za
    rozwinięcie koperty ok. 5 ms przy 4× dławieniu CPU (sonda CDP, §5.4), więc oszczędność na parsowaniu przenosi
    się częściowo do hydratacji.
- `effect_matches_plan` = **partly**:
  - bajty i struktura dokumentu: **yes**;
  - ParseHTML: kierunek tak na mobile, wielkość w szumie (**inconclusive**);
  - PB2: **no**;
  - koszt JS: 2× ponad plan.
- `needs_fix` = **tak**, wyłącznie z powodu budżetu domknięcia bootu (§2.3, M1/m1 z recenzji). Wszystkie bramki są
  zielone.

## 1. Bramki artefaktu

| Bramka                                                                                                                            | Wynik                        | Uwagi                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build:smoke` (BUNDLE_INVENTORY=1)                                                                                                | zielona                      | `build.log`                                                                                                                                                                                                                                    |
| `check:bundle`                                                                                                                    | zielona (B gorzej niż A, §2) | `check:bundle.log`, baza `check-bundle-base.log`                                                                                                                                                                                               |
| `check:chunks`                                                                                                                    | zielona                      | 894 chunki, 6 861 krawędzi, graf acykliczny                                                                                                                                                                                                    |
| `check:entry-purity`                                                                                                              | zielona                      | 10 chunków w domknięciu bootu, ścieżka czysta                                                                                                                                                                                                  |
| `check:server-entry-purity`                                                                                                       | zielona                      | 1 822 pliki, zamrożony dług bez zmian (`node-html-parser` ×2)                                                                                                                                                                                  |
| `check:document-weight` B                                                                                                         | zielona                      | `document-weight.json`. Nowe metryki: `streamedStateBytes` 6 878/10 559, `dehydratedQueryHashCount` 0/0                                                                                                                                        |
| `check:document-weight` A (baza)                                                                                                  | zielona                      | `document-weight-base.json`. Skrypt bazy nie zna nowych metryk, więc wartości A wziąłem z `base-dw-new-metrics.json` (kod metryk B na artefakcie A)                                                                                            |
| `test:e2e:artifact` (env CI, `NES_ARTIFACT_FIXTURE=1`)                                                                            | **31/31**                    | `e2e-artifact.log`. Jedyny `[hydration-mismatch]` w logu pochodzi z kontroli negatywnej (test 4, oczekiwany). Między innymi `backend-quiet` (zero PostgREST w oknie bootu), `boot-home` pl/en i `boot-timing` (drugie żądanie dokumentu = HIT) |
| sonda e2e P3.7b (doraźna, §4), A i B                                                                                              | **8/8 na stronę**            | `e2e-prove-final-{A,B}.log` + `e2e-prove-m3-{A,B}.log` (telefon `/ → en`)                                                                                                                                                                      |
| vitest kontrolny (5 plików: `homeRoute`, `dehydratedQueryEnvelope`, `router`, `documentWeightState`, `TrendingTicker.langSwitch`) | **112/112**                  | `vitest-prove.log`                                                                                                                                                                                                                             |
| typecheck, verify:static                                                                                                          | nie powtarzane               | zielone w IMPL (`typecheck2.log.exit` = 0) i w recenzji                                                                                                                                                                                        |

Bramek procesowych usuniętych w PR #475 nie uruchamiałem (nie ma ich w `package.json`). Pozycja nie dodała ani nie
zmieniła specyfikacji e2e w repo.

KRYTYKA (predykat P3.6b): `src/lib/ssr/documentCompleteness*` nie istnieje. Predykat to
`trackSsrQueryCompleteness` (`src/lib/ssr/resilientLoad.ts:272`). Nie czyta `heroPreloads`, `withExcerpt` ani
`header_ticker` (grep). Test `homeRoute.test.tsx` (predykat `{complete: true}` z kandydatem LCP) jest zielony. Na
artefakcie `/` dalej trafia do cache dokumentu: 5/5 próbek `x-nes-cache: HIT` w `check:document-weight`, HIT we
wszystkich 20 przebiegach LH i zielony test `boot-timing` „cache dokumentów oddaje drugie żądanie z HIT-a”.

## 2. Koszt JS: `check:bundle` i domknięcie bootu

### 2.1 `check:bundle` A → B

| Pozycja                 |                     A (baza) |                        B (P3.7b) |                  Δ |                         Budżet |
| ----------------------- | ---------------------------: | -------------------------------: | -----------------: | -----------------------------: |
| Client JS overall (gz)  |                   4 752,9 KB |                   **4 754,4 KB** |        **+1,5 KB** | ≤ 4 772 (zapas 19,1 → 17,6 KB) |
| public JS               |                   2 803,1 KB |                       2 804,3 KB |            +1,2 KB |                        ≤ 2 877 |
| admin-only JS           |                   1 949,8 KB |                       1 950,0 KB |            +0,2 KB |                    (w overall) |
| Largest chunk (wejście) |  261,2 KB (`index-C0hznT0T`) |      261,9 KB (`index-I6S3cDfS`) |            +0,7 KB |                          ≤ 286 |
| Client CSS (suma)       |                      95,8 KB |                          95,8 KB |                  0 |            ≤ 96 (zapas 0,2 KB) |
| public CSS              |                      81,5 KB |                          81,5 KB |                  0 |                           ≤ 83 |
| **Boot closure**        | 486,8 KB gz / 1 594,3 KB raw | **487,6 KB gz / 1 596,3 KB raw** | **+0,8 / +2,0 KB** |                          ≤ 579 |

Linia w B: `Boot closure: 487.6 KB gzip / 1596.3 KB raw  (10 chunków statycznie osiągalnych ze SSR-owego <script>; budget ≤ 579 KB)`.

Lista ruchów względem baseline'u b006c2e jest w B taka sama jak w A, z jedną różnicą: `index` −46,8 KB (A) →
−46,1 KB (B), czyli wejście jest o 0,7 KB większe. P3.7b nie dodaje innych ruchów. Ostrzeżenia o zapasie poniżej 2%:
overall 17,6 KB (0,37%), css total 0,2 KB (0,26%), public css 1,5 KB (1,75%). CSS jest bajtowo bez zmian.

### 2.2 Skąd przyrost (inwentarz chunków, `prove-tools/entry-diff.py`)

Z 10 chunków domknięcia zmienia się tylko wejście `index-*`: 859 185 → 861 203 B raw (+2 018), gzip −9
264 097 → 264 792 B (+695). Moduły wejścia (bajty renderowane przed minifikacją, suma +4 215):

| Moduł                                                               | Δ (renderowane) | Uwagi                                                                                                           |
| ------------------------------------------------------------------- | --------------: | --------------------------------------------------------------------------------------------------------------- |
| `src/lib/ssr/dehydratedQueryEnvelope.ts` (nowy)                     |          +1 941 | T1. Do klienta trafia tylko ścieżka `expand*` i `mapQueryStream`; `compact*` jest wycięte (sprawdzone w chunku) |
| `src/lib/builder/postListExcerpt.ts` (nowy)                         |            +973 | T2, w tym duplikat `excerptFrameBool` (m1 z recenzji)                                                           |
| `src/lib/views/headerTickerQuery.ts`                                |            +539 | T4a/T4b (projekcja, `keepPreviousData`)                                                                         |
| `src/lib/builder/sliderPostsQuery.ts`                               |            +376 | T2                                                                                                              |
| `src/lib/builder/postListQuery.ts`                                  |            +357 | T2                                                                                                              |
| `src/lib/builder/prefetch.ts`                                       |            +136 | T2 (powierzchnia)                                                                                               |
| `TrendingTicker.tsx`, `router.tsx`, `themeGeometry.ts`, `*.css?url` |             +74 |                                                                                                                 |
| `src/routes/$.tsx`, `src/routes/index.tsx`, `speculationRules.ts`   |            −181 | T5/T6/X1                                                                                                        |

### 2.3 Ocena wobec limitu

- Plan i KRYTYKA zakładały +0,7…1,0 KB raw (T1) oraz limit P3.7b ≤ +1,0 KB raw. IMPL szacował +1,0…1,2 KB raw /
  +0,3…0,45 KB gz. Recenzja (M1) przewidziała +1,8…2,2 KB raw.
- **Pomiar: +2 018 B raw / +753 B gz**, czyli 2× ponad limit.
- Po P3.7b zostaje 3 195 B raw zapasu. P3.2a (limit +1,2 KB) i P3.1 (limit +1,0 KB) razem mieszczą się jeszcze z ok.
  1 KB rezerwy. Zapas gzip 949 B jest jednak ciasny, a reguła orkiestratora „nie gorzej niż baza” nie jest spełniona.
- **Runda poprawek (wąska, zgodna z M1/m1 recenzji):**
  1. Usunąć duplikat `excerptFrameBool` (import `getBool` z `widget-view/frame.ts`, który i tak leży w wejściu).
     Szacunek recenzji: ok. −250 B raw.
  2. Sprawdzić, czy projekcja paska (`projectHeaderTickerPosts`) i ścinanie zajawek (`localize*Rows(..., withExcerpt)`)
     mogą biec tylko na serwerze, w module spoza wejścia. Uwaga: klucze `withExcerpt` i `lang` muszą zostać po stronie
     klienta.
  3. Resztę (rdzeń T1 `expand*`, ok. 0,9 KB raw) orkiestrator musi jawnie zaakceptować albo zrównoważyć zdjęciem kodu
     z wejścia.

## 3. `check:document-weight` A → B (fixture `/`, 5 próbek HIT, bajtowo stałe)

| Metryka                                            |                   A |             B |           Δ |   Próg (max) |       Zapas A → B | ceil(B × 1,02) |
| -------------------------------------------------- | ------------------: | ------------: | ----------: | -----------: | ----------------: | -------------: |
| **htmlRawBytes**                                   |             328 326 |   **315 443** | **−12 883** |      406 180 |   77 854 → 90 737 |        321 752 |
| htmlGzipBytes                                      |              49 835 |        48 752 |      −1 083 |       57 710 |     7 875 → 8 958 |         49 728 |
| headRawBytes                                       |              25 669 |        24 539 |      −1 130 |       29 345 |     3 676 → 4 806 |         25 030 |
| inlineStyleCount / Bytes                           |         26 / 71 363 |   26 / 71 363 |           0 | 50 / 135 546 |                 - |              - |
| inlineCssCommentBytes                              |                 517 |           517 |           0 |          517 |                 0 |              - |
| fontPreloadCount                                   |                   1 |             1 |           0 |            1 |                 0 |              - |
| inlineScriptBytes                                  |              87 551 |        74 668 |     −12 883 |       98 103 |   10 552 → 23 435 |         76 162 |
| inlineExecutableScriptBytes                        |              80 304 |        68 551 |     −11 753 |       91 725 |   11 421 → 23 174 |         69 923 |
| **dehydratedStateBytes** (bariera)                 |              61 047 |    **52 767** |  **−8 280** |       66 486 |    5 439 → 13 719 |         53 823 |
| **streamedStateBytes** (nowa)                      | 10 351 (kod B na A) |     **6 878** |  **−3 473** |       10 559 |       208 → 3 681 |          7 016 |
| **dehydratedQueryHashCount** (nowa)                |     21 (kod B na A) |         **0** |         −21 |            0 |                 - |              0 |
| modulepreloadCount                                 |                   0 |             0 |           0 |            0 |                 - |              - |
| linkHeaderEntries                                  |                   4 |             4 |           0 |            5 |                 - |              - |
| preloadDuplicates / documentPreloadDuplicates      |               2 / 0 |     2 / **0** |           0 |        3 / 0 |                 - |              - |
| imagePreloadCount / imagePreloadNonCandidate       |               3 / 0 |     3 / **0** |           0 |        3 / 0 |                 - |              - |
| imgFetchpriorityHigh                               |                   1 |             1 |           0 |            2 |                 - |              - |
| JS z priorytetem High przy starcie (preloadedJs)   |             0 / 0 B |       0 / 0 B |           0 |            0 |                 - |              - |
| **bootClosureRawBytes**                            |           1 632 545 | **1 634 563** |  **+2 018** |    1 637 758 | 5 213 → **3 195** |  (nie obniżać) |
| **bootClosureGzipBytes**                           |             494 977 |   **495 730** |    **+753** |      496 679 |   1 702 → **949** |  (nie obniżać) |
| bootBurstGzipBytes                                 |             572 197 |       573 005 |        +808 |      574 673 |     2 476 → 1 668 |  (nie obniżać) |
| bootBurstCount                                     |                  26 |            26 |           0 |           26 |                 0 |              - |
| renderBlockingCssGzipBytes                         |              80 765 |        80 765 |           0 |       81 399 |                 - |              - |
| preLcpTransferBytes                                |             154 972 |       153 889 |      −1 083 |      181 594 |   26 622 → 27 705 |        156 967 |
| lcpCandidateCount / Missing / imgEagerNonCandidate |           1 / 0 / 0 |     1 / 0 / 0 |           0 |            - |                 - |              - |

Pełna tabela: `dw-compare.md`.

Struktura stanu w HTML-u (`html/{A,B}-{home,_en}.html`, zrzut z artefaktów):

| Wzorzec w dokumencie `/`                                  |            A |         B | Krok                                     |
| --------------------------------------------------------- | -----------: | --------: | ---------------------------------------- |
| `queryHash`                                               |           21 |         0 | T1                                       |
| `dataUpdateCount` / `fetchFailureCount` / `isInvalidated` | 21 / 21 / 21 | 0 / 0 / 0 | T1 (stały ogon stanu)                    |
| `mutations`                                               |            5 |         0 | T1 (pusta lista)                         |
| `excerpt_pl` (`/`) / `excerpt_en` (`/en`)                 |      23 / 23 |     0 / 0 | T2 (`withExcerpt:!1` w 7 kluczach)       |
| `header_ticker`                                           |            2 |         1 | T4b (klucz z językiem; etykieta i klucz) |
| `title_en` na `/` / `title_pl` na `/en`                   |      34 / 34 |   25 / 25 | T4a (pasek z jednym tytułem)             |
| `heroPreloads`                                            |            1 |         0 | T6                                       |
| speculation rules (JSON)                                  |      2 334 B |   1 204 B | X1                                       |

Treść widoczna jest nietknięta. Zajawki nadal się renderują (fixture: 18 wystąpień `cms-post-excerpt` po obu stronach).
Znaczniki `<body>` A = B bajtowo, a JSON-LD A = B (T5).

### 3.1 Propozycja ratchetu (dla orkiestratora; istniejących progów NIE zmieniałem)

- Nowe klucze tej pozycji:
  - `streamedStateBytes` max = ceil(6 878 × 1,02) = **7 016** (zamiast tymczasowego 10 559), `measured` 6 878;
  - `dehydratedQueryHashCount` max 0, `measured` = **0** (dziś w pliku stoi 21 = wartość bazy).
- Ratchet w dół, ceil(B × 1,02), wszystkie próbki identyczne:

  | Klucz                         | Proponowany max |
  | ----------------------------- | --------------: |
  | `htmlRawBytes`                |         321 752 |
  | `htmlGzipBytes`               |          49 728 |
  | `headRawBytes`                |          25 030 |
  | `inlineScriptBytes`           |          76 162 |
  | `inlineExecutableScriptBytes` |          69 923 |
  | `dehydratedStateBytes`        |          53 823 |
  | `preLcpTransferBytes`         |         156 967 |

  P3.2a zmienia `<head>`/preloady równolegle, więc ratchet po scaleniu obu pozycji, z pomiaru tipu.

- `bootClosure*` i `bootBurstGzipBytes` zostają bez zmian. Pozycja zużywa zapas, nie oddaje go.

## 4. e2e: zero refetchów i miękka zmiana języka (sonda doraźna, `e2e-prove/`)

Spec `e2e-prove/prove-p37b.spec.ts` z konfiguracją `e2e-prove/playwright.config.ts` biegnie poza repo, na artefakcie
z `replayFetch`. Projekty: desktop 1350 × 940 i telefon 412 × 823, locale `pl-PL`. Backend klienta odpowiada przez
`fixtureResponse`, a maska aktywacji jest taka jak w `backend-quiet`. Uruchomienie przez mutex, osobno na A i na B.

Pierwsze przebiegi (`e2e-prove-{A,B}.log`, `-mobile*`, `-desktop*`) miały błędy samej sondy, a nie aplikacji, i
dotyczyły obu stron jednakowo:

- przy domyślnym `en-US` serwer przekierowuje `/` na `/en` (ciasteczko `nes_lang=en`), więc test `/` mierzył `/en`;
- telefon ma kompaktowy przełącznik „Język: PL EN” / „Language: EN PL”;
- baner zgody przechwytuje kliknięcie.

Wyniki poniżej pochodzą z przebiegów po poprawce sondy (`e2e-prove-final-*.log`, `e2e-prove-m3-*.log`).
Diagnostyka przekierowania: `e2e-diag-{A,B}.log`.

### 4.1 Zero żądań danych po hydratacji (od nawigacji do 3 s po gotowości, PostgREST + `/_serverFn` + `/functions` + `/api`)

| Strona                            | Projekt | A: żądania / błędy hydratacji | B: żądania / błędy hydratacji |
| --------------------------------- | ------- | ----------------------------- | ----------------------------- |
| `/` (lang=pl, bez przekierowania) | desktop | 0 / 0                         | **0 / 0**                     |
| `/en`                             | desktop | 0 / 0                         | **0 / 0**                     |
| `/`                               | telefon | 0 / 0                         | **0 / 0**                     |
| `/en`                             | telefon | 0 / 0                         | **0 / 0**                     |

Jedyne błędy konsoli to `net::ERR_TUNNEL_CONNECTION_FAILED` (2–4 na przebieg, obie strony). To obrazy z
`fixture.invalid` przez proxy sesji, czyli środowisko. CLS (bez wejścia) w oknie bootu wynosi 0.

Wniosek: kompaktowa koperta rozwija się przed `hydrate`. Żadne zapytanie nie jest pobierane ponownie: klucze klienta
(`withExcerpt`, język paska) = klucze SSR, a hashe po `hashKey` = hashe serwera.

### 4.2 Miękka zmiana języka (rAF ok. 3 s po kliknięciu)

| Przejście  | Projekt | Strona | wys. przed / po / min    | brak elementu | CLS bez wejścia | `/_serverFn` paska po kliknięciu | tytuły po |
| ---------- | ------- | ------ | ------------------------ | ------------: | --------------: | -------------------------------: | --------- |
| `/` → en   | desktop | A      | 39,31 / 39,31 / 39,31 px |             0 |          0,0000 |                                0 | EN        |
| `/` → en   | desktop | **B**  | 39,31 / 39,31 / 39,31 px |             0 |      **0,0000** |                            **1** | EN        |
| `/en` → pl | desktop | A      | 39,31 / 39,31 / 39,31 px |             0 |          0,0000 |                                0 | PL        |
| `/en` → pl | desktop | **B**  | 39,31 / 39,31 / 39,31 px |             0 |      **0,0000** |                            **1** | PL        |
| `/` → en   | telefon | A      | 41,00 / 41,00 / 41,00 px |             0 |          0,0000 |                                0 | EN        |
| `/` → en   | telefon | **B**  | 41,00 / 41,00 / 41,00 px |             0 |      **0,0000** |                            **1** | EN        |
| `/en` → pl | telefon | A      | 41,00 / 41,00 / 41,00 px |             0 |          0,0000 |                                0 | PL        |
| `/en` → pl | telefon | **B**  | 41,00 / 41,00 / 41,00 px |             0 |      **0,0000** |                            **1** | PL        |

- B zachowuje się tak, jak przewiduje IMPL §6:
  - po zmianie języka idzie jedno wywołanie server fn paska (nowy klucz z językiem);
  - `keepPreviousData` trzyma poprzednie wpisy, więc tytuły przechodzą PL → EN bez pustej klatki, a wysokość stoi;
  - sekwencja tekstów w trakcie jest identyczna jak w A, np. „Analiza 1” → „Analysis 1” → „Analysis 2” (przewinięcie
    paska).
- CLS z wejściem (`hadRecentInput`) wynosi 0,036/0,042 na desktopie i 0,274 na telefonie, po obu stronach identycznie.
  To przeładowanie list postów po zmianie języka, którego CLS nie liczy (okno 500 ms po kliknięciu). Nie zależy od
  pozycji.

## 5. Lighthouse `--compare` (fixture, fake-gtag, `--warm-ua bot`, n = 5 na formę)

Log: `ab.log`, wyniki w `lh/`.

- VALID: A mobile 5/5, B mobile 5/5, A desktop4x 5/5, B desktop4x 5/5. Wykluczeń 0.
- Load w trakcie przebiegów 0,8–2,3 (limit 2,4). Wszystkie przebiegi HIT, tryb FCP bez JS (pary mieszane 0/5).
- Dokument (wariant bota): A 321 271 B, B 308 388 B (Δ −12 883 B, jak w `check:document-weight`).

### 5.1 Mediany i pary

| Forma     | Strona    |       perf |     FCP |     LCP |              TBT |      SI | CLS |     TTI | mainThread |   bootup | req |                  transfer |
| --------- | --------- | ---------: | ------: | ------: | ---------------: | ------: | --: | ------: | ---------: | -------: | --: | ------------------------: |
| mobile    | A         | 97 (95–99) |  1,41 s |  2,01 s |  149 ms (14–218) |  1,47 s |   0 |  4,36 s |   2 765 ms | 1 259 ms |  41 |                  792,4 KB |
| mobile    | B         | 99 (97–99) |  1,38 s |  1,98 s |   54 ms (22–164) |  1,44 s |   0 |  4,31 s |   2 558 ms | 1 145 ms |  41 |                  792,3 KB |
| mobile    | **Δ med** |         +2 | −0,03 s | −0,03 s |           −95 ms | −0,03 s |  ±0 | −0,05 s |    −207 ms |  −114 ms |   0 | −0,0 KB (skrypty +0,8 KB) |
| desktop4x | A         | 95 (91–97) |  0,37 s |  0,48 s | 191 ms (154–249) |  0,56 s |   0 |  1,06 s |   2 828 ms | 1 322 ms |  43 |                  797,2 KB |
| desktop4x | B         | 93 (90–99) |  0,36 s |  0,48 s | 223 ms (118–270) |  0,54 s |   0 |  1,14 s |   2 855 ms | 1 285 ms |  43 |                  797,1 KB |
| desktop4x | **Δ med** |         −2 | −0,01 s | ±0,00 s |           +32 ms | −0,02 s |  ±0 | +0,08 s |     +27 ms |   −38 ms |   0 | −0,0 KB (skrypty +0,8 KB) |

| Pary (n = 5, t(4) = 3,72) |        Δ̄ |      σΔ |  MDE(t) | ocena                                              |
| ------------------------- | -------: | ------: | ------: | -------------------------------------------------- |
| mobile FCP                | −0,051 s | 0,046 s | 0,077 s | szum. Kierunek dobry: B 1,37–1,40 s, A 1,39–1,50 s |
| mobile LCP                | −0,073 s | 0,076 s | 0,127 s | szum                                               |
| mobile TBT                |   −73 ms |   61 ms |  102 ms | szum, brak regresji                                |
| mobile SI                 | −0,038 s | 0,053 s | 0,089 s | szum                                               |
| mobile score              |     +1,8 |     1,5 |     2,5 | szum                                               |
| desktop4x FCP             | −0,007 s | 0,066 s | 0,109 s | szum                                               |
| desktop4x LCP             | −0,000 s | 0,025 s | 0,041 s | bez zmian                                          |
| desktop4x TBT             |    +7 ms |   68 ms |  113 ms | szum, brak regresji                                |
| desktop4x SI              | +0,004 s | 0,058 s | 0,097 s | szum                                               |
| desktop4x score           |     −0,4 |     4,0 |     6,6 | szum                                               |

Kryterium planu „FCP/LCP ±0,02 s” spełnione w granicach szumu (MDE 0,04–0,13 s), bez regresji. Inaczej niż w P3.7a
nie ma tu skoku progowego TCP: dokument fixture ma ok. 41 KB transferu po obu stronach (A 41 974 B, B 41 042 B), czyli
już poniżej progu 2 rund (43 800 B). CLS = 0,000 w 20/20 przebiegach.

Przebiegi pojedynczo (perf, FCP, LCP, TBT, SI):

| #   | A mobile                  | B mobile                  | A desktop4x               | B desktop4x               |
| --- | ------------------------- | ------------------------- | ------------------------- | ------------------------- |
| 1   | 95, 1,41, 2,01, 216, 1,41 | 99, 1,38, 1,98, 54, 1,38  | 91, 0,35, 0,48, 249, 0,56 | 96, 0,43, 0,49, 165, 0,54 |
| 2   | 98, 1,47, 2,12, 109, 1,47 | 99, 1,37, 1,97, 23, 1,37  | 95, 0,37, 0,49, 191, 0,48 | 90, 0,35, 0,47, 270, 0,59 |
| 3   | 97, 1,50, 2,16, 149, 1,51 | 99, 1,40, 2,00, 78, 1,46  | 97, 0,38, 0,47, 154, 0,55 | 99, 0,36, 0,48, 118, 0,52 |
| 4   | 95, 1,40, 2,00, 218, 1,40 | 97, 1,38, 1,98, 164, 1,44 | 93, 0,45, 0,50, 224, 0,61 | 92, 0,36, 0,48, 234, 0,61 |
| 5   | 99, 1,39, 1,99, 14, 1,50  | 99, 1,38, 1,98, 22, 1,44  | 96, 0,35, 0,47, 158, 0,57 | 93, 0,38, 0,50, 223, 0,53 |

### 5.2 Porcje ParseHTML, skrypty inline dokumentu i PB2 (ślad, główny wątek; `prove-tools/p37b-trace.py`, `trace-p37b.txt`)

Ślad LH nie jest dławiony (symulacja Lantern), więc wartości są obserwowane na maszynie.

| Forma     | Miara                                                       |    A med |        B med |        Δ̄ par |   σΔ | MDE(t) |             B < A |
| --------- | ----------------------------------------------------------- | -------: | -----------: | -----------: | ---: | -----: | ----------------: |
| mobile    | ParseHTML suma                                              |  47,2 ms |  **32,9 ms** |     −11,0 ms | 10,6 |   17,7 |           **5/5** |
| mobile    | ParseHTML najdłuższa porcja                                 |  13,2 ms |      10,1 ms |      −5,5 ms |  5,6 |    9,3 |               4/5 |
| mobile    | EvaluateScript inline dokumentu (18 skryptów, w tym `$tsr`) |  20,5 ms |  **16,7 ms** |      −4,0 ms |  2,7 |    4,5 |           **5/5** |
| mobile    | **PB2** (pierwszy plaster `_t@vendor-react`)                |  17,0 ms |      16,7 ms |      −0,6 ms |  2,9 |    4,9 |               4/5 |
| mobile    | LH `bootup-time` dokumentu (script)                         | 154,6 ms |     124,7 ms |     −30,5 ms | 26,0 |   43,3 |               4/5 |
| mobile    | LH grupa „Parse HTML & CSS”                                 | 130,3 ms |     108,1 ms |     −19,6 ms | 33,2 |   55,2 |               4/5 |
| desktop4x | ParseHTML suma                                              |  37,8 ms |      37,8 ms |      −0,5 ms |  5,7 |    9,5 |               3/5 |
| desktop4x | ParseHTML najdłuższa porcja                                 |  12,5 ms |      11,1 ms |      +0,1 ms |  5,0 |    8,3 |               3/5 |
| desktop4x | EvaluateScript inline dokumentu                             |  16,8 ms |      15,7 ms |      −2,2 ms |  3,5 |    5,8 |               3/5 |
| desktop4x | **PB2**                                                     |  15,0 ms |      14,1 ms |      −1,3 ms |  2,7 |    4,6 |               4/5 |
| desktop4x | LH `bootup-time` dokumentu (script)                         | 166,0 ms | **129,1 ms** | **−33,2 ms** |  9,5 |   15,8 | **5/5** (istotne) |
| desktop4x | LH grupa „Parse HTML & CSS”                                 | 120,1 ms |     110,8 ms |      +9,9 ms | 42,2 |   70,4 |               3/5 |

PB2 w księdze Lanterna (`Script:vendor-react`, sim ≥ 50 ms):

| Forma     | A: obecne / sim / blokowanie                                     | B: obecne / sim / blokowanie                                     |
| --------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| mobile    | 5/5; sim 71, 56, 75, 68, 59 ms; blok. 21, 3, 22, 9, 5 ms (med 9) | 5/5; sim 51, 70, 74, 67, 57 ms; blok. 1, 10, 12, 9, 7 ms (med 9) |
| desktop4x | 4/5; sim 58, 60, 68, 61 ms; blok. 4, 5, 9, 6 ms                  | 3/5; sim 57, 61, 57 ms; blok. 4, 6, 4 ms                         |

Ocena:

- Porcje ParseHTML na mobile są krótsze w każdej parze, ale wielkość leży w rozrzucie przebiegów (A 36,8–60,9 ms,
  B 31,9–46,5 ms). Na desktopie zmiany nie ma.
- Ewaluacja skryptów inline dokumentu spada konsekwentnie na mobile (5/5, na granicy MDE).
- `bootup-time` dokumentu (skrypt: inline + parse) spada o ok. 30 ms. Na desktopie to jedyna istotna zmiana czasowa.
- **PB2 nie jest krótsze:** mediany różnią się o 0,3–0,9 ms przy σΔ 2,7–2,9 ms, a zadanie zostaje w księdze z tym
  samym blokowaniem. Przyczyna w §5.4.

### 5.3 Księga Lanterna (klasy, `ledger-agg.md`)

| Forma     | Klasa                          |  A: blok. med (przebiegi z zadaniem) |              B | A: zadań ≥ 50 ms sim |     B |
| --------- | ------------------------------ | -----------------------------------: | -------------: | -------------------: | ----: |
| mobile    | ParseHTML                      | 0 (3/5; w sumie 45 ms w 1 przebiegu) |  0 (1/5; 0 ms) |                    3 | **1** |
| mobile    | Timer:(dokument)               |         0 (3/5; 39 ms w 1 przebiegu) |        0 (0/5) |                    3 | **0** |
| mobile    | ParseCSS                       |                              0 (1/5) |        0 (0/5) |                    1 |     0 |
| mobile    | Script:vendor-react (PB2, PB4) |                             21 (5/5) |       19 (5/5) |                   12 |    11 |
| mobile    | ScriptCatchup                  |                             81 (5/5) |       40 (5/5) |                    5 |     5 |
| desktop4x | ParseHTML                      |               0 (3/5; 17 ms łącznie) | 0 (2/5; 12 ms) |                    4 | **2** |
| desktop4x | Style                          |                             56 (5/5) |       40 (5/5) |                   14 |    10 |
| desktop4x | Script:vendor-react            |                             21 (5/5) |       16 (5/5) |                   10 |     8 |
| desktop4x | ScriptCatchup                  |                             97 (5/5) |       96 (5/5) |                    5 |     5 |

- TBT księgi:

  | Forma     | A                                     | B                                     |
  | --------- | ------------------------------------- | ------------------------------------- |
  | mobile    | 215,5 / 108,5 / 148,5 / 218,0 / 13,5  | 53,5 / 22,5 / 78,0 / 163,5 / 21,5     |
  | desktop4x | 248,5 / 191,0 / 153,5 / 223,5 / 157,5 | 165,5 / 270,0 / 118,0 / 234,5 / 223,0 |

- Zadania klasy ParseHTML ≥ 50 ms sim są w B rzadsze: mobile 3 → 1, desktop 4 → 2. Docelowa klasa nie znika jednak
  we wszystkich przebiegach.
- Spadek TBT na mobile (`ScriptCatchup` 81 → 40 ms) nie wynika z pozycji, bo kompilacja wejścia jest bez zmian. To
  zmienność przebiegów.

Speedline (obsSI, `speedline.txt`): mobile A med 317 ms (288–371), B 287 ms (262–312); desktop4x A 313 ms (301–350),
B 306 ms (286–347). Wszystkie przebiegi dochodzą do 100% bez późnych zmian. Różnica mieści się w szumie.

### 5.4 Gdzie poszedł czas PB2: sonda CPU (CDP Profiler, 4× dławienie, telefon 412 px, n = 7 + 9 na stronę)

Sonda: `prove-tools/cpu-probe.mjs`, wyniki w `cpu-probe{,2}-{A,B}.json`. Czas inkluzywny ramek:

| Ramka                                                                       |  A med (przebieg 1 / 2) |           B med (przebieg 1 / 2) |
| --------------------------------------------------------------------------- | ----------------------: | -------------------------------: |
| `hydrate` query-core (`vendor-tanstack`, funkcja z `dehydratedAt:`)         |           9,5 / 14,6 ms |                    9,8 / 11,8 ms |
| `expandRouterDehydrated` (rozwinięcie bariery, `hashKey` każdego zapytania) |                       - | **6,2 / 5,3 ms** (zakres 1,3–13) |
| `expandQuery` (bariera + porcje strumienia)                                 |                       - |          2,8 ms (zakres 0,6–6,6) |
| skrypty inline dokumentu                                                    | 111 ms (rozrzut 33–202) |          106 ms (rozrzut 59–122) |

- Klient B wykonuje ok. **5–6 ms (4× CPU) ≈ 1,3–1,5 ms bez dławienia** pracy, której A nie miał: odtwarza
  `queryHash = hashKey(queryKey)` dla każdego zapytania (klucz post-listy ma 17 parametrów) i rozkłada stały ogon
  stanu.
- Praca ląduje w zadaniu hydratacji routera (PB2/PB3), czyli tam, gdzie plan oczekiwał skrócenia.
- `hydrate` query-core zostaje bez zmian (dostaje ten sam kształt).
- Zysk T1 widać po stronie parsowania i ewaluacji skryptów inline (−4 ms obs. na mobile, §5.2). Bilans jest dodatni,
  ale mały, a w PB2 się znosi.
- Pomiar skryptów inline w sondzie CPU jest zbyt zaszumiony, żeby go rozstrzygać. Wiarygodniejsze są zdarzenia
  `EvaluateScript` ze śladów LH w §5.2.

### 5.5 Audyty jednego przebiegu mobile na stronę (`lh/{A,B}-mobile-1.audits.txt`)

|                                                              | A-mobile-1                                   | B-mobile-1            |
| ------------------------------------------------------------ | -------------------------------------------- | --------------------- |
| żądania / transfer                                           | 41 / 792,4 KB                                | 41 / 792,3 KB         |
| dokument (transfer)                                          | 41 974 B                                     | **41 042 B**          |
| wejście `index-*` (transfer)                                 | 235 938 B                                    | 236 725 B (+787 B)    |
| element LCP                                                  | `img.eh-img` (`fixture.invalid/cover.jpg`)   | ten sam               |
| LCP: TTFB / opóźnienie ładowania / ładowanie / render (obs.) | 23 / 36 / 17 / 138 ms                        | 19 / 30 / 18 / 173 ms |
| render-blocking                                              | `styles-B1UDMYdv.css` 68,8 KB, wasted 450 ms | ten sam               |
| High przed obrazem LCP                                       | 92,7 KB                                      | 92,7 KB               |
| Main thread / Parse HTML & CSS                               | 2 765 / 160 ms                               | 2 567 / 105 ms        |
| bootup dokumentu `/` (script / total)                        | 155 / 713 ms                                 | 136 / 664 ms          |
| CLS                                                          | 0,000                                        | 0,000                 |

## 6. Ocena wobec kryteriów dowodu (notatka orkiestratora)

| Kryterium                                                                                            | Wynik                                                                                                                             |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `htmlRawBytes` w dół, P3.7b ≥ −11,5 KB                                                               | ✔ **−12 883 B** (P3.7a + P3.7b łącznie −26 366 B wobec celu −25 KB)                                                               |
| `dehydratedQueryHashCount` = 0                                                                       | ✔ 0 (A: 21)                                                                                                                       |
| `streamedStateBytes` policzone                                                                       | ✔ 6 878 B (A: 10 351 B, −3 473)                                                                                                   |
| `imagePreloadNonCandidate` 0                                                                         | ✔ 0                                                                                                                               |
| `documentPreloadDuplicates` 0                                                                        | ✔ 0                                                                                                                               |
| propozycja ratchetu progów (bez zmiany istniejących)                                                 | ✔ §3.1                                                                                                                            |
| e2e artefaktu: zero refetchów na `/` po hydratacji, zero błędów hydratacji                           | ✔ `test:e2e:artifact` 31/31 + sonda §4.1 (`/` i `/en`, telefon i desktop: 0 żądań, 0 błędów hydratacji)                           |
| e2e P2.5 miękkiej zmiany języka (pasek bez zapadania, CLS 0)                                         | ✔ 8/8 przejść B (PL→EN i EN→PL, telefon i desktop): min. wys. = wys. przed, 0 klatek bez paska, CLS bez wejścia 0                 |
| Lighthouse: porcje ParseHTML krótsze                                                                 | ~ mobile kierunek 5/5 (−11 ms sumy, w szumie, MDE 17,7), desktop bez zmian; zadania klasy ParseHTML ≥ 50 ms sim: 3 → 1 i 4 → 2    |
| Lighthouse: zadanie PB2 (StartClient z deserializacją `$_TSR`) krótsze                               | ✘ bez zmian (−0,6 / −1,3 ms, σΔ ok. 2,8). Rozwinięcie koperty (`hashKey`) dokłada ok. 5 ms przy 4× CPU w tym samym zadaniu (§5.4) |
| FCP/LCP ±0,02 s                                                                                      | ✔ w szumie (mobile −0,05 / −0,07 s przy MDE 0,08 / 0,13; desktop −0,01 / 0,00)                                                    |
| CLS ≤ 0,001                                                                                          | ✔ 0,000 w 20/20 przebiegach LH i w e2e (bez wejścia)                                                                              |
| TBT bez regresji                                                                                     | ✔ mobile −73 ms (σΔ 61), desktop4x +7 ms (σΔ 68, MDE 113)                                                                         |
| `check:bundle`: nie gorzej niż baza (overall/public/entry/boot)                                      | ✘ overall +1,5, public +1,2, wejście +0,7, boot +0,8 KB gz (+2,0 KB raw). Bramka zielona                                          |
| KRYTYKA: limit P3.7b ≤ +1,0 KB raw domknięcia bootu                                                  | ✘ **+2 018 B raw** (+753 B gz)                                                                                                    |
| KRYTYKA: predykat P3.6b nie czyta `heroPreloads` ani zmienionych kluczy; `/` nadal w cache dokumentu | ✔ (§1)                                                                                                                            |

## 7. Ryzyka i uwagi dla orkiestratora

1. **Budżet bootu.** Po P3.7b zapas `bootClosureGzipBytes` wynosi 949 B, a `bootClosureRawBytes` 3 195 B. P3.2a
   (≤ +1,2 KB raw) i P3.1 (≤ +1,0 KB raw) zmieszczą się w raw z ok. 1 KB rezerwy, ale gzip może zabraknąć. Runda
   poprawek wg §2.3 albo jawna akceptacja przed P3.1.
2. **T1 przenosi koszt z parsera do hydratacji.** Netto zysk na fixture to kilka ms. Na produkcji (więcej zapytań i
   dłuższe klucze) obie strony bilansu rosną. Jeśli PB2 ma realnie spaść, potrzebne jest coś innego niż
   kompaktowanie, np. mniej zapytań w stanie.
3. **Scalanie z P3.2a:** `heroImage.ts` (jedna instrukcja w `postListPreload`) i `heroImage.test.ts` (trzeci argument
   w 11 wywołaniach). Konflikt jest możliwy tylko tekstowy. Ratchet `htmlRawBytes`/`headRawBytes` liczyć z tipu po
   obu pozycjach.
4. Sonda e2e (`e2e-prove/`) musi biec z `locale: "pl-PL"`. Przy `en-US` serwer przekierowuje `/` na `/en`
   (ciasteczko `nes_lang=en`) po obu stronach. Każdy spec repo, który zakłada „`/` = PL” bez locale, mierzy w
   Playwrighcie `/en`. `backend-quiet.boot-home.spec.ts` ustawia tylko nagłówek `accept-language` (do sprawdzenia
   osobno, poza tą pozycją).

## 8. Pliki

- Logi:
  - `build.log`, `check:bundle.log`, `check-bundle-base.log`, `check:chunks.log`, `check:entry-purity.log`,
    `check:server-entry-purity.log`;
  - `document-weight{,-base}.{json,log}`, `dw-compare.md`;
  - `e2e-artifact.log`, `e2e-prove-*.log`, `e2e-diag-*.log`;
  - `vitest-prove.log`, `ab.log`, `trace-p37b.txt`, `ledger-agg.md`, `speedline.txt`, `cpu-probe{,2}-{A,B}.{json,log}`.
- Dane: `html/{A,B}-{home,_en}.html`, `lh/` (ślady, księgi, audyty).
- Narzędzia PROVE (`prove-tools/`): `entry-diff.py`, `dw-compare.py`, `p37b-trace.py`, `tasks.py`, `ledger-agg.py`,
  `cpu-probe.mjs`, `e2e-sum.py`, `dump-html.ts`.
- Sonda e2e: `e2e-prove/` (`prove-p37b.spec.ts`, `prove-diag.spec.ts`, `playwright.config.ts`).
