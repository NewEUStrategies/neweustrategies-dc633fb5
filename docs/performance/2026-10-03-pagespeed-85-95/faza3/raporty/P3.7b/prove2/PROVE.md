# P3.7b (fala 3, partia 4a): PROVE po rundzie poprawek 9

Data: 2026-10-09.

- **A** = `base-w3g` (64dddffe, `.output` bazy bez przebudowy).
- **B** = worktree `wt3/P3.7b` (gałąź `perf/w3-P3.7b`, commit `1ceb4bef` = IMPL `aaf54740` + runda 9). Zbudowany tu
  przez `BUNDLE_INVENTORY=1 bun run build:smoke` pod mutexem (exit 0).
- `$P` = `$SCRATCH/phase3/wave3/P3.7b`, `$SCRATCH` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad`.
  Wszystkie logi i surowe pliki tej rundy leżą w `$P/prove2`. Pierwsza runda PROVE (na `aaf54740`) jest w `$P/PROVE.md`.

## 0. Werdykt

- **Blokujący wynik pierwszego PROVE jest usunięty.** Domknięcie bootu wynosi teraz **+823 B raw / +569 B gz**
  (`check:document-weight`; wcześniej +2 018 / +753). Mieści się w limicie KRYTYKI dla P3.7b (≤ +1,0 KB raw) i
  zgadza się z szacunkiem IMPL-fix9 (ok. +0,9 KB raw, ok. +0,5 KB gz).
  - Ścinanie zajawek, projekcja paska i `excerptFrameBool` zeszły z chunku wejściowego (§2.3).
  - Zostaje rdzeń T1, czyli rozwijanie koperty: 1 251 B renderowanego modułu.
- **Bajty dokumentu bez zmian wobec pierwszej rundy.** HTML B jest identyczny jak dla `aaf54740` po normalizacji hashy
  zasobów, originu i znaczników czasu (`/` i `/en`).
  - `htmlRawBytes` **−12 883 B** (328 326 → 315 443), czyli powyżej progu pozycji ≥ −11,5 KB.
  - `dehydratedQueryHashCount` **0** (A: 21), `streamedStateBytes` **6 878 B** (A: 10 351).
  - `imagePreloadNonCandidate` 0, `documentPreloadDuplicates` 0.
  - `<body>` A i B są bajtowo równe (bez `<script>`/`<style>`).
- **Bramki: wszystkie zielone.**
  - `check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity`.
  - `check:document-weight` na A i na B.
  - `test:e2e:artifact` 31/31 w env jak w CI.
  - Sonda e2e pozycji 8/8: zero żądań danych po hydratacji i zero błędów hydratacji. Miękka zmiana języka: pasek
    bez zapadania, CLS bez wejścia 0.
  - vitest kontrolny 7 plików / 173 testy.
- **Reguła „nie gorzej niż baza” w `check:bundle` nadal nie jest spełniona dosłownie.**
  - Różnice: boot +0,6 KB gz / +0,8 KB raw, wejście +0,5 KB, public +1,0 KB, overall +1,3 KB.
  - Z tego ok. 0,65 KB gz w overall to wyłącznie przesunięcie hashy importów w 636 chunkach o niezmienionym raw
    (§2.2). Realny kod to +858 B raw.
  - Resztę stanowi rdzeń T1, który plan zakładał (+0,7…1,0 KB raw), a IMPL §7.5 zostawił do jawnej akceptacji
    orkiestratora. Zdjąć go można tylko razem z T1, który daje `queryHash` 0 i −8,3 KB bariery.
- **Lighthouse (n = 5 par na formę, VALID 5/5, 0 wykluczeń, 20/20 HIT):**
  - CLS 0 w 20/20 przebiegach.
  - TBT bez regresji: mobile Δ̄ −26 ms (σΔ 64, MDE 106), desktop4x −75 ms (σΔ 91, MDE 152).
  - Desktop4x: FCP/LCP bez zmian (+0,006 / −0,014 s).
  - Mobile: mediany FCP/LCP +0,07 / +0,14 s, ale pary Δ̄ +0,029 / +0,063 s leżą w szumie (MDE 0,148 / 0,242).
    Mechanizm w §5.3: Lantern FCP liczy tylko trzy zadania CPU, w tym zadanie z pierwszą porcją ParseHTML. To
    zadanie jest dwumodalne (ok. 2–4 ms albo 17–25 ms) po obu stronach, a B wylosował tryb długi 3/5 razy, A 1/5.
    Dokument B jest ten sam co w rundzie 1, gdzie mobile FCP B wynosił 1,37–1,40 s, lepiej niż A.
  - Porcje ParseHTML i PB2: **bez mierzalnej zmiany** (wszystko w szumie). Klasa ParseHTML nie znika z księgi.
- `effect_matches_plan` = **partly**:
  - struktura i bajty dokumentu: **yes**;
  - koszt JS: zgodny z planem i limitem KRYTYKI;
  - ParseHTML: **inconclusive**;
  - PB2: **no**, jak w rundzie 1;
  - FCP/LCP ±0,02 s: w szumie (mobile mediany poza ±0,02, pary w MDE).
- `needs_fix` = **nie**. Do decyzji orkiestratora (§7):
  1. akceptacja rdzenia T1 (+823 B raw boot) wobec reguły „nie gorzej niż baza”;
  2. zmiana kryterium PB2 zgodnie z IMPL §3.

## 1. Bramki artefaktu

| Bramka                                                                                                                                                                     | Wynik                              | Uwagi (log w `prove2/`)                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `build:smoke` (BUNDLE_INVENTORY=1)                                                                                                                                         | zielona                            | `build.log` (2 m 9 s)                                                                                                                                                                                                                      |
| `check:bundle`                                                                                                                                                             | zielona (B nieco gorzej niż A, §2) | `check:bundle.log`; baza `$P/check-bundle-base.log` (artefakt A bez zmian)                                                                                                                                                                 |
| `check:chunks`                                                                                                                                                             | zielona                            | 894 chunki, 6 861 krawędzi, acykliczny                                                                                                                                                                                                     |
| `check:entry-purity`                                                                                                                                                       | zielona                            | `index-CJ_6fe90.js` → 10 chunków domknięcia, ścieżka czysta                                                                                                                                                                                |
| `check:server-entry-purity`                                                                                                                                                | zielona                            | 1 822 pliki, zamrożony dług bez zmian (`node-html-parser` ×2)                                                                                                                                                                              |
| `check:document-weight` B                                                                                                                                                  | zielona                            | `document-weight.json`, 5 próbek `x-nes-cache: HIT`                                                                                                                                                                                        |
| `check:document-weight` A                                                                                                                                                  | zielona                            | `document-weight-base.json`. Nowe metryki A z `base-dw-new-metrics.json` (kod metryk B na artefakcie A, runda 1)                                                                                                                           |
| `test:e2e:artifact` (env CI, `NES_ARTIFACT_FIXTURE=1`)                                                                                                                     | **31/31** (1,6 min)                | `e2e-artifact.log`. Jedyny `[hydration-mismatch]` pochodzi z kontroli negatywnej (test „detektor niezgodności ŁAPIE…”). Zielone m.in. `backend-quiet`, `boot-home` pl/en, `boot-timing` („cache dokumentów oddaje drugie żądanie z HIT-a”) |
| sonda e2e P3.7b (`$P/e2e-prove/`, poza repo), B                                                                                                                            | **8/8**                            | `e2e-prove-B.log`. Strona A: przebiegi z rundy 1 (`$P/e2e-prove-final-A.log` + `-m3-A.log`), bo artefakt A i spec się nie zmieniły                                                                                                         |
| vitest kontrolny (`dehydratedPayload`, `homeRoute`, `documentCompletenessPipeline`, `dehydratedQueryEnvelope`, `router`, `TrendingTicker.langSwitch`, `postListQueryData`) | **7 plików / 173 testy**           | `vitest-prove.log`                                                                                                                                                                                                                         |
| typecheck, verify:static                                                                                                                                                   | nie powtarzane                     | zielone w IMPL-fix9 (`fix9/typecheck.log.exit` = 0, `fix9/verify-static.log`)                                                                                                                                                              |

- Bramek procesowych usuniętych w PR #475 nie uruchamiałem. Pozycja nie dodała ani nie zmieniła specyfikacji e2e
  w repo.
- **KRYTYKA (predykat P3.6b):** pliku `src/lib/ssr/documentCompleteness*` nie ma. Predykat to
  `trackSsrQueryCompleteness` (`src/lib/ssr/resilientLoad.ts:272`).
  - `resilientLoad.ts` jest nietknięty w diffie 64dddffe..1ceb4bef.
  - Funkcja nie czyta `heroPreloads`, `withExcerpt`, `header_ticker` ani języka klucza (grep).
  - `homeRoute.test.tsx` i `documentCompletenessPipeline.test.tsx` są zielone.
  - `/` dalej trafia do cache dokumentu:
    - 5/5 próbek HIT w `check:document-weight`;
    - 20/20 przebiegów LH z `LH HIT`;
    - zielony test `boot-timing` z drugim żądaniem HIT.

## 2. Koszt JS

### 2.1 `check:bundle` A → B (runda 1 dla porównania)

| Pozycja                 |                     A (baza) | B runda 1 (`aaf54740`) |   **B runda 9 (`1ceb4bef`)** |            Δ B − A |                  Budżet |
| ----------------------- | ---------------------------: | ---------------------: | ---------------------------: | -----------------: | ----------------------: |
| Client JS overall (gz)  |                   4 752,9 KB |                4 754,4 |                  **4 754,2** |            +1,3 KB | ≤ 4 772 (zapas 17,8 KB) |
| public JS               |                   2 803,1 KB |                2 804,3 |                  **2 804,1** |            +1,0 KB |                 ≤ 2 877 |
| admin-only JS           |                   1 949,8 KB |                1 950,0 |                      1 950,2 |            +0,4 KB |             (w overall) |
| Largest chunk (wejście) |  261,2 KB (`index-C0hznT0T`) |                  261,9 | **261,7** (`index-CJ_6fe90`) |            +0,5 KB |                   ≤ 286 |
| Client CSS / public CSS |               95,8 / 81,5 KB |            95,8 / 81,5 |                  95,8 / 81,5 |                  0 |             ≤ 96 / ≤ 83 |
| **Boot closure**        | 486,8 KB gz / 1 594,3 KB raw |        487,6 / 1 596,3 |          **487,4 / 1 595,1** | **+0,6 / +0,8 KB** |                   ≤ 579 |

- Linia B: `Boot closure: 487.4 KB gzip / 1595.1 KB raw  (10 chunków statycznie osiągalnych ze SSR-owego <script>; budget ≤ 579 KB)`.
- Ruchy względem baseline'u b006c2e są takie same jak w A, z jedną różnicą: `index` **−46,3 KB** (354,6 → 308,3).
  W A było −46,8 KB, w rundzie 1 −46,1 KB.
- Pozostałe ruchy bez zmian:
  - `spreadsheet.worker` +131,5;
  - `lucide-shim.fa` −24,1;
  - `club._clubSlug.index` +16,5;
  - `admin.seo` +7,5;
  - `i18n-club` +3,0;
  - `category._slug`, `icons-0/1/3` i `profile.notifications` po ok. −2,5;
  - `SeoPanel` +2,4;
  - `i18n-admin-seo-hub` znikł.
- Ostrzeżenia o zapasie poniżej 2%:
  - overall 17,8 KB (0,37%);
  - CSS total 0,2 KB (0,26%);
  - public CSS 1,5 KB (1,75%).
- CSS jest bajtowo bez zmian.

### 2.2 Skąd +1,3 KB overall (wszystkie chunki klienta, `chunk-diff.txt`)

- Realna zmiana kodu wynosi **+858 B raw**:
  - `index-*` (5 plików) +792, w tym wejście +823;
  - `headings` +67;
  - `PostListView` +9;
  - `TravelRouteCardView` +5;
  - `PostsSliderWidget` −7, `DynamicTagWidgets` −5, `_` −3.
- Gzip (poziom 9) wszystkich chunków rośnie o +1 139 B. Z tego **+654 B przypada na 636 chunków o niezmienionym raw**,
  czyli na samą zmianę hashy importów (szum kompresji ±1–4 B na chunk).
- Overall i public w `check:bundle` są więc gorsze o ok. 0,5 KB z powodu kodu, a resztę stanowi churn hashy.
  Wejście i boot są gorsze wyłącznie z powodu kodu.

### 2.3 Domknięcie bootu: moduły wejścia (`entry-diff.txt`, `prove-tools/entry-diff.py`)

Z 10 chunków domknięcia zmienia się tylko wejście: 859 185 → 860 008 B raw (**+823**), gz9 +460.

| Moduł (bajty renderowane)                                                                                                                   | Runda 1 | **Runda 9** | Uwagi                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------: | ----------: | ------------------------------------------------------------ |
| `src/lib/ssr/dehydratedQueryEnvelope.ts` (nowy, T1)                                                                                         |  +1 941 |  **+1 251** | sama ścieżka `expand*`/`mapQueryStream` (`compact*` wycięte) |
| `src/lib/builder/postListExcerpt.ts` (nowy, T2)                                                                                             |    +973 |    **+338** | bez `excerptFrameBool` i bez `withoutExcerpts`               |
| `src/lib/builder/sliderPostsQuery.ts`                                                                                                       |    +376 |        +238 | ścinanie za `import.meta.env.SSR` wycięte                    |
| `src/lib/builder/postListQuery.ts`                                                                                                          |    +357 |        +197 | jw.                                                          |
| `src/lib/views/headerTickerQuery.ts`                                                                                                        |    +539 |     **+86** | projekcja paska tylko na serwerze                            |
| `SimpleWidgets.tsx`, `ChromeWidgetView.tsx`, `mediaWidgets.tsx`, `prefetch.ts`, `TrendingTicker.tsx`, `router.tsx`, `frame.ts`, `*.css?url` |    +210 |        +426 | wywołania predykatu, `widget.type`                           |
| `src/routes/$.tsx`, `src/routes/index.tsx`, `speculationRules.ts`                                                                           |    −181 |        −181 | T5/T6/X1                                                     |
| **Suma (renderowane)**                                                                                                                      |  +4 215 |  **+2 355** | po minifikacji: +823 B raw wejścia                           |

Kontrola tekstu chunku wejściowego, A → B:

| Wzorzec                     |       A |                                                                        B |
| --------------------------- | ------: | -----------------------------------------------------------------------: |
| `==="true"\|\|`             |       2 | 2 (jedno `getBool` + walidator `reply`; kopii `excerptFrameBool` nie ma) |
| `author_display_name`       |       8 |          6 (projekcja paska `projectHeaderTickerPosts` zeszła z klienta) |
| `excerpt_pl` / `excerpt_en` | 31 / 29 |                          31 / 29 (gałąź ścinania nie trafiła do klienta) |
| `Object.freeze`             |      57 |                                                                       57 |
| `withExcerpt`               |       0 |                                      4 (klucz zapytań, zgodnie z planem) |

### 2.4 Ocena

- Limit KRYTYKI P3.7b (≤ +1,0 KB raw domknięcia) jest spełniony: **+823 B**.
- Zapas progów `check:document-weight` po P3.7b:

  | Próg                   | Zapas A → B         |
  | ---------------------- | ------------------- |
  | `bootClosureRawBytes`  | 5 213 → **4 390 B** |
  | `bootClosureGzipBytes` | 1 702 → **1 133 B** |
  | `bootBurstGzipBytes`   | 2 476 → **1 856 B** |

- Na P3.2a (≤ +1,2 KB raw) i P3.1 (≤ +1,0 KB raw) zostaje ok. 2,2 KB raw rezerwy. Gzip jest ciaśniejszy, ale
  1,1 KB wystarcza na dwie pozycje rzędu +0,5 KB gz.
- Reguła orkiestratora „nie gorzej niż baza” (overall/public/entry/boot) nie jest spełniona dosłownie (§2.1–2.2).
  Ta reszta to rdzeń T1, którego IMPL nie zdejmuje bez utraty efektu. Decyzja należy do orkiestratora (§7).

## 3. `check:document-weight` A → B (fixture `/`, 5 próbek HIT, bajtowo stałe)

| Metryka                                                                                      |                   A |                 B |           Δ |   Próg (max) |     Zapas A → B | ceil(B × 1,02) |
| -------------------------------------------------------------------------------------------- | ------------------: | ----------------: | ----------: | -----------: | --------------: | -------------: |
| **htmlRawBytes**                                                                             |             328 326 |       **315 443** | **−12 883** |      406 180 | 77 854 → 90 737 |        321 752 |
| htmlGzipBytes                                                                                |              49 837 |            48 763 |      −1 074 |       57 710 |   7 873 → 8 947 |         49 739 |
| headRawBytes                                                                                 |              25 669 |            24 539 |      −1 130 |       29 345 |   3 676 → 4 806 |         25 030 |
| inlineStyleCount / Bytes                                                                     |         26 / 71 363 |       26 / 71 363 |           0 | 50 / 135 546 |               - |              - |
| inlineCssCommentBytes                                                                        |                 517 |               517 |           0 |          517 |               0 |              - |
| fontPreloadCount                                                                             |                   1 |                 1 |           0 |            1 |               0 |              - |
| inlineScriptBytes                                                                            |              87 551 |            74 668 |     −12 883 |       98 103 | 10 552 → 23 435 |         76 162 |
| inlineExecutableScriptBytes                                                                  |              80 304 |            68 551 |     −11 753 |       91 725 | 11 421 → 23 174 |         69 923 |
| **dehydratedStateBytes** (bariera `$tsr`)                                                    |              61 047 |        **52 767** |  **−8 280** |       66 486 |  5 439 → 13 719 |         53 823 |
| **streamedStateBytes** (nowa)                                                                | 10 351 (kod B na A) |         **6 878** |  **−3 473** |       10 559 |     208 → 3 681 |          7 016 |
| **dehydratedQueryHashCount** (nowa)                                                          |     21 (kod B na A) |             **0** |         −21 |            0 |               - |              0 |
| modulepreloadCount                                                                           |                   0 |                 0 |           0 |            0 |               - |              - |
| linkHeaderEntries                                                                            |                   4 |                 4 |           0 |            5 |               - |              - |
| preloadDuplicates / **documentPreloadDuplicates**                                            |               2 / 0 |         2 / **0** |           0 |        3 / 0 |               - |              - |
| imagePreloadCount / **imagePreloadNonCandidate**                                             |               3 / 0 |         3 / **0** |           0 |        3 / 0 |               - |              - |
| imgFetchpriorityHigh                                                                         |                   1 |                 1 |           0 |            2 |               - |              - |
| JS z priorytetem High przy starcie (`preloadedJsCount` / `GzipBytes`)                        |               0 / 0 |             0 / 0 |           0 |        0 / 0 |               - |              - |
| **bootClosureRawBytes**                                                                      |           1 632 545 |     **1 633 368** |    **+823** |    1 637 758 |   5 213 → 4 390 |  (nie obniżać) |
| **bootClosureGzipBytes**                                                                     |             494 977 |       **495 546** |    **+569** |      496 679 |   1 702 → 1 133 |  (nie obniżać) |
| bootBurstGzipBytes                                                                           |             572 197 |           572 817 |        +620 |      574 673 |   2 476 → 1 856 |  (nie obniżać) |
| bootBurstCount                                                                               |                  26 |                26 |           0 |           26 |               0 |              - |
| renderBlockingCssGzipBytes                                                                   |              80 765 |            80 765 |           0 |       81 399 |             634 |              - |
| preLcpTransferBytes                                                                          |             154 974 |           153 900 |      −1 074 |      181 594 | 26 620 → 27 694 |        156 978 |
| lcpCandidateCount / Missing / imgEagerNonCandidate / linkHeaderDisallowed / bootEntryMissing |   1 / 0 / 0 / 0 / 0 | 1 / 0 / 0 / 0 / 0 |           0 |            - |               - |              - |

- Pełna tabela: `dw-compare.md`.
- Inline `<style>` się nie zmienia. Inline `<script>` w B ma −12 883 B (bariera −8 280, porcje strumienia −3 473,
  speculation rules w `<head>` −1 130).
- Liczba modulepreload pozostaje 0, duplikatów w dokumencie nie ma.
- Domknięcie bootu: §2. Pula High JS przy starcie: 0. `imgFetchpriorityHigh` 1 = 1.

Dokument (`html/B-{home,_en}.html`) po normalizacji hashy zasobów, originu i znaczników czasu `dehydratedAt`/`u:` jest
**identyczny** z dokumentem rundy 1 (`$P/html/B-*.html`). Tabela struktury stanu z rundy 1 (`$P/PROVE.md` §3) obowiązuje
bez zmian:

- `queryHash` 21 → 0;
- stały ogon stanu 21 → 0;
- `mutations` 5 → 0;
- `excerpt_*` 23 → 0;
- `header_ticker` 2 → 1;
- `heroPreloads` 1 → 0;
- speculation rules 2 334 → 1 204 B.

`<body>` bez `<script>`/`<style>`: A = B na `/` i `/en`.

### 3.1 Propozycja ratchetu (dla orkiestratora; istniejących progów NIE zmieniałem)

- Nowe klucze pozycji:
  - `streamedStateBytes`: max **7 016** (= ceil(6 878 × 1,02), zamiast tymczasowego 10 559), `measured` 6 878;
  - `dehydratedQueryHashCount`: max 0, `measured` **0** (w pliku stoi 21, czyli wartość bazy).
- Ratchet w dół, ceil(B × 1,02), wszystkie próbki identyczne:

  | Klucz                         | Proponowany max |
  | ----------------------------- | --------------: |
  | `htmlRawBytes`                |         321 752 |
  | `htmlGzipBytes`               |          49 739 |
  | `headRawBytes`                |          25 030 |
  | `inlineScriptBytes`           |          76 162 |
  | `inlineExecutableScriptBytes` |          69 923 |
  | `dehydratedStateBytes`        |          53 823 |
  | `preLcpTransferBytes`         |         156 978 |

  P3.2a zmienia `<head>` i preloady równolegle, więc ratchet `htmlRawBytes`/`headRawBytes`/`preLcpTransferBytes` liczyć
  z tipu po scaleniu obu pozycji.

- `bootClosure*` i `bootBurstGzipBytes` zostają bez zmian. Pozycja zużywa zapas, nie oddaje go.

## 4. e2e: zero refetchów i miękka zmiana języka

- Sonda: `$P/e2e-prove/prove-p37b.spec.ts` z konfiguracją `playwright.config.ts`. Artefakt z `replayFetch`, backend
  klienta `fixtureResponse`, locale `pl-PL`, desktop 1350 × 940 i telefon 412 × 823. Spec jest bez zmian wobec rundy 1.
- Uruchomienie: `NES_ARTIFACT_ROOT=wt3/P3.7b PROVE_SIDE=B playwright test` przez `heavy-bg.sh`. Wynik: **8 passed (44,5 s)**.
- Jedyne błędy konsoli to 28× `net::ERR_TUNNEL_CONNECTION_FAILED`: obrazy z `fixture.invalid` przez proxy sesji, czyli
  środowisko. W A było ich 29×.

### 4.1 Zero żądań danych po hydratacji (do 3 s po `__nesAppReady`; PostgREST, `/_serverFn`, `/functions`, `/api`)

| Strona        | Projekt | A (runda 1): żądania / błędy hydratacji | **B (1ceb4bef)** | CLS bez wejścia B |
| ------------- | ------- | --------------------------------------- | ---------------- | ----------------: |
| `/` (lang=pl) | desktop | 0 / 0                                   | **0 / 0**        |                 0 |
| `/en`         | desktop | 0 / 0                                   | **0 / 0**        |                 0 |
| `/`           | telefon | 0 / 0                                   | **0 / 0**        |                 0 |
| `/en`         | telefon | 0 / 0                                   | **0 / 0**        |                 0 |

Kod klienta rozwijania strumienia (`pull` jako łańcuch `then`) i pasek z pełnym wierszem po stronie klienta dają te
same klucze i hashe co SSR. Żadne zapytanie nie jest pobierane ponownie.

### 4.2 Miękka zmiana języka (próbkowanie rAF ok. 3 s po kliknięciu)

| Przejście  | Projekt | wys. przed / po / min    | klatki bez paska | CLS bez wejścia | `/_serverFn` paska po kliknięciu | teksty w trakcie                          |
| ---------- | ------- | ------------------------ | ---------------: | --------------: | -------------------------------: | ----------------------------------------- |
| `/` → en   | desktop | 39,31 / 39,31 / 39,31 px |          0 / 135 |      **0,0000** |                                1 | „Analiza 1” → „Analysis 1” → „Analysis 2” |
| `/en` → pl | desktop | 39,31 / 39,31 / 39,31 px |          0 / 143 |      **0,0000** |                                1 | „Analysis 1” → „Analiza 1” → „Analiza 2”  |
| `/` → en   | telefon | 41,00 / 41,00 / 41,00 px |          0 / 172 |      **0,0000** |                                1 | jw.                                       |
| `/en` → pl | telefon | 41,00 / 41,00 / 41,00 px |          0 / 170 |      **0,0000** |                                1 | jw.                                       |

- Zachowanie jest takie jak w rundzie 1 i w A: wysokość stoi, nie ma pustej klatki, a `keepPreviousData` trzyma
  poprzedni wpis do odpowiedzi.
- Jedno wywołanie server fn paska po zmianie języka jest oczekiwane, bo język siedzi w kluczu.
- CLS z wejściem (`hadRecentInput`) wynosi 0,036/0,042 (desktop) i 0,274 (telefon), tak samo jak w A. To przeładowanie
  list postów po zmianie języka, którego CLS nie liczy, i nie zależy od pozycji.

## 5. Lighthouse `--compare` (fixture, fake-gtag, `--warm-ua bot`, n = 5 na formę)

- Log: `ab.log`, wyniki w `lh/`.
- VALID: A mobile 5/5, B mobile 5/5, A desktop4x 5/5, B desktop4x 5/5. Wykluczeń 0.
- Jedna powtórka z błędu wykonania LH: A-desktop4x-4 `NO_NAVSTART`.
- Load 0,8–2,2 (limit 2,4). 20/20 przebiegów `LH HIT`. Tryb FCP bez JS we wszystkich parach (pary mieszane 0/5).
- Dokument (wariant bota): A 321 271 B, B 308 388 B (Δ −12 883 B). Gzip 46 962 → 45 893 B.

### 5.1 Mediany, delty i pary

| Forma     | Strona        |       perf |     FCP |     LCP |     TBT (zakres) |      SI | CLS |     TTI | mainThread |   bootup | req | transfer |       JS |
| --------- | ------------- | ---------: | ------: | ------: | ---------------: | ------: | --: | ------: | ---------: | -------: | --: | -------: | -------: |
| mobile    | A             | 98 (97–98) |  1,39 s |  1,99 s |  118 ms (51–139) |  1,39 s |   0 |  4,28 s |   2 525 ms | 1 194 ms |  41 | 792,3 KB | 545,6 KB |
| mobile    | B             | 98 (97–99) |  1,46 s |  2,14 s |   97 ms (33–119) |  1,46 s |   0 |  4,29 s |   2 561 ms | 1 265 ms |  41 | 792,3 KB | 546,4 KB |
| mobile    | **DELTA med** |         ±0 | +0,07 s | +0,14 s |           −21 ms | +0,07 s |  ±0 | +0,01 s |     +36 ms |   +71 ms |   0 |  −0,0 KB |  +0,8 KB |
| desktop4x | A             | 93 (84–96) |  0,41 s |  0,49 s | 215 ms (172–368) |  0,61 s |   0 |  1,26 s |   3 049 ms | 1 412 ms |  43 | 797,2 KB | 550,4 KB |
| desktop4x | B             | 95 (93–98) |  0,41 s |  0,49 s | 186 ms (127–218) |  0,57 s |   0 |  1,10 s |   2 766 ms | 1 309 ms |  43 | 797,2 KB | 551,2 KB |
| desktop4x | **DELTA med** |         +2 | −0,00 s | +0,00 s |           −30 ms | −0,04 s |  ±0 | −0,16 s |    −283 ms |  −103 ms |   0 |  −0,1 KB |  +0,8 KB |

| PAIRS (n = 5, t(4) = 3,72) |        Δ̄ |      σΔ |  MDE(t) | B < A | ocena                                |
| -------------------------- | -------: | ------: | ------: | ----: | ------------------------------------ |
| mobile score               |     +0,2 |     1,1 |     1,8 |     - | szum                                 |
| mobile FCP                 | +0,029 s | 0,089 s | 0,148 s |   1/5 | szum, mechanizm w §5.3               |
| mobile LCP                 | +0,063 s | 0,145 s | 0,242 s |   1/5 | szum (LCP = FCP + stały ogon obrazu) |
| mobile TBT                 |   −26 ms |   64 ms |  106 ms |   4/5 | szum, brak regresji                  |
| mobile SI                  | +0,029 s | 0,089 s | 0,148 s |   1/5 | szum (SI = FCP w tym trybie)         |
| desktop4x score            |     +4,4 |     5,3 |     8,8 |     - | szum                                 |
| desktop4x FCP              | +0,006 s | 0,068 s | 0,113 s |   2/5 | bez zmian                            |
| desktop4x LCP              | −0,014 s | 0,038 s | 0,063 s |   3/5 | bez zmian                            |
| desktop4x TBT              |   −75 ms |   91 ms |  152 ms |   3/5 | szum, brak regresji                  |
| desktop4x SI               | −0,029 s | 0,052 s | 0,086 s |   4/5 | szum                                 |

Przebiegi pojedynczo (perf, FCP s, LCP s, TBT ms, SI s; pary wg indeksu):

| #   | A mobile                  | B mobile                  | A desktop4x               | B desktop4x               |
| --- | ------------------------- | ------------------------- | ------------------------- | ------------------------- |
| 1   | 97, 1,39, 1,99, 139, 1,39 | 99, 1,40, 2,00, 46, 1,40  | 84, 0,32, 0,46, 368, 0,69 | 96, 0,39, 0,46, 161, 0,57 |
| 2   | 98, 1,56, 2,21, 51, 1,56  | 98, 1,44, 2,04, 119, 1,44 | 93, 0,52, 0,56, 215, 0,63 | 93, 0,43, 0,50, 218, 0,62 |
| 3   | 98, 1,38, 1,98, 120, 1,38 | 97, 1,46, 2,14, 110, 1,46 | 94, 0,35, 0,49, 192, 0,57 | 98, 0,41, 0,49, 127, 0,55 |
| 4   | 98, 1,38, 1,98, 108, 1,38 | 98, 1,49, 2,16, 33, 1,49  | 87, 0,41, 0,47, 313, 0,61 | 94, 0,45, 0,50, 193, 0,59 |
| 5   | 98, 1,40, 2,00, 118, 1,40 | 98, 1,47, 2,15, 97, 1,47  | 96, 0,42, 0,50, 172, 0,54 | 95, 0,37, 0,46, 186, 0,57 |

Kryteria planu:

- FCP/LCP ±0,02 s: desktop tak. Mobile: mediany +0,07 / +0,14 s, ale pary w MDE i bez mechanizmu po stronie dokumentu
  (§5.3).
- CLS ≤ 0,001: 0,000 w 20/20.
- TBT bez regresji: tak na obu formach.

### 5.2 Porcje ParseHTML, skrypty inline dokumentu i PB2 (ślad LH, główny wątek; `trace-p37b.txt`, `lhrun.txt`)

Ślad LH nie jest dławiony (Lantern symuluje), więc wartości to obserwacje na maszynie.

| Forma     | Miara                                                       |           A med |           B med |       Δ̄ par |         σΔ |      MDE(t) |    B < A |
| --------- | ----------------------------------------------------------- | --------------: | --------------: | ----------: | ---------: | ----------: | -------: |
| mobile    | ParseHTML, suma porcji dokumentu                            |         41,5 ms |         42,4 ms |        +0,0 |        8,2 |        13,6 |      3/5 |
| mobile    | ParseHTML, najdłuższa porcja                                |         11,4 ms |         16,8 ms |        +1,9 |        9,3 |        15,5 |      1/5 |
| mobile    | EvaluateScript inline dokumentu (18 skryptów, w tym `$tsr`) |         18,7 ms |         19,2 ms |        +0,8 |        2,6 |         4,3 |      3/5 |
| mobile    | **PB2** (pierwszy plaster `_t@vendor-react`)                |         15,6 ms |         16,0 ms |        +0,4 |        2,0 |         3,4 |      2/5 |
| mobile    | LH `bootup-time` dokumentu: script / parse                  | 136,6 / 26,6 ms | 127,0 / 32,9 ms | −1,1 / +5,7 | 16,4 / 6,1 | 27,3 / 10,1 | 3/5, 1/5 |
| mobile    | LH grupa „Parse HTML & CSS”                                 |        133,7 ms |        117,9 ms |       −15,1 |       24,4 |        40,5 |      4/5 |
| desktop4x | ParseHTML, suma                                             |         40,2 ms |         39,8 ms |        −1,5 |        2,5 |         4,2 |      4/5 |
| desktop4x | ParseHTML, najdłuższa porcja                                |         14,8 ms |         14,3 ms |        −0,1 |        6,0 |        10,0 |      3/5 |
| desktop4x | EvaluateScript inline dokumentu                             |         18,3 ms |         19,2 ms |        +1,5 |        1,4 |         2,4 |      0/5 |
| desktop4x | **PB2**                                                     |         13,6 ms |         13,5 ms |        −2,0 |        4,1 |         6,9 |      3/5 |
| desktop4x | LH `bootup-time` dokumentu: script                          |        158,6 ms |        152,2 ms |       −19,7 |       25,2 |        42,0 |      4/5 |
| desktop4x | LH grupa „Parse HTML & CSS”                                 |        134,6 ms |        119,6 ms |       −15,8 |       20,5 |        34,1 |      4/5 |

PB2 w księdze Lanterna (`Script:vendor-react`, sim ≥ 50 ms):

| Forma     | A: obecne / sim / blokowanie                     | B: obecne / sim / blokowanie                     |
| --------- | ------------------------------------------------ | ------------------------------------------------ |
| mobile    | 5/5; sim 54, 64, 58, 68, 62; blok. 2, 7, 4, 9, 6 | 5/5; sim 64, 53, 66, 67, 64; blok. 7, 2, 8, 9, 7 |
| desktop4x | 4/5; sim 80, 51, 73, 54; blok. 15, 1, 12, 2      | 3/5; sim 60, 54, 56; blok. 5, 2, 3               |

Ocena:

- Żadna z miar ParseHTML, inline ani PB2 nie przekracza MDE.
- Znaki są niestabilne między rundami. W rundzie 1, na tym samym dokumencie B, mobile ParseHTML wynosił −11 ms
  (5/5), a inline ES −4 ms (5/5). Teraz jest +0,0 ms i +0,8 ms.
- Oczekiwany efekt −13 KB z ok. 320 KB dokumentu (ok. 4%) to ok. 1,5–2 ms ParseHTML i ok. 1–2 ms ewaluacji `$tsr`.
  Przy σΔ 2–9 ms tego nie widać.
- Grupa LH „Parse HTML & CSS” spada w 4/5 par na obu formach (−15 ms), ale poniżej MDE.
- **PB2 nie jest krótsze**, zgodnie z diagnozą z rundy 1 (`$P/PROVE.md` §5.4 i IMPL-fix9 §3): odtworzenie
  `hashKey` po stronie klienta przenosi pracę do tego zadania. Runda 9 nie zmienia tego bilansu.

### 5.3 Księga Lanterna i mechanizm mobile FCP (`ledger-agg.md`, `fcpnodes.txt`, `prefcp.txt`)

| Forma     | Klasa                                   | A: blok. med (przebiegi z zadaniem) |        B | A: zadań ≥ 50 ms sim |   B |
| --------- | --------------------------------------- | ----------------------------------: | -------: | -------------------: | --: |
| mobile    | ParseHTML                               |                             0 (1/5) |  0 (3/5) |                    1 |   3 |
| mobile    | Navigation (pierwsze zadanie dokumentu) |                             0 (5/5) |  0 (4/5) |                    5 |   4 |
| mobile    | Style                                   |                             0 (5/5) |  0 (3/5) |                    5 |   3 |
| mobile    | Timer:(dokument)                        |                             0 (1/5) |  0 (0/5) |                    1 |   0 |
| mobile    | Script:vendor-react (PB2, PB4)          |                            16 (5/5) | 20 (5/5) |                   11 |  11 |
| mobile    | ScriptCatchup                           |                            91 (5/5) |  6 (5/5) |                    5 |   5 |
| mobile    | Timer:index                             |                             5 (4/5) | 14 (4/5) |                    4 |   4 |
| desktop4x | ParseHTML                               |                            10 (4/5) |  5 (5/5) |                    5 |   5 |
| desktop4x | Style                                   |                            69 (5/5) | 52 (5/5) |                   14 |  12 |
| desktop4x | Script:vendor-react                     |                            17 (5/5) | 21 (5/5) |                   11 |  10 |
| desktop4x | ScriptCatchup                           |                           108 (5/5) | 96 (5/5) |                    5 |   5 |
| desktop4x | Timer:(dokument)                        |                             0 (2/5) |  0 (0/5) |                    2 |   0 |

- TBT księgi = audyt we wszystkich 20 przebiegach:

  | Forma     | A                               | B                               |
  | --------- | ------------------------------- | ------------------------------- |
  | mobile    | 139 / 50,5 / 119,5 / 108 / 118  | 45,5 / 119 / 110 / 33 / 97      |
  | desktop4x | 368 / 215 / 191,5 / 312,5 / 172 | 161 / 218 / 126,5 / 193 / 185,5 |

- **Docelowa klasa ParseHTML nie znika.** Na mobile pojawia się nawet częściej (1 → 3 zadania ≥ 50 ms sim), na desktopie
  blokowanie spada 10 → 5 ms. W rundzie 1 kierunek był odwrotny (3 → 1 i 4 → 2), więc to rozrzut przebiegów.
- Spadek `ScriptCatchup` na mobile (91 → 6 ms) nie wynika z pozycji, bo kompilacja wejścia się nie zmienia. W rundzie 1
  był 81 → 40 ms.
- **Skąd mobile FCP +0,07 s (mediana).** Lantern FCP w trybie bez JS bierze z CPU wyłącznie trzy zadania:
  - zadanie z pierwszym ParseHTML;
  - zadanie z pierwszym Layout;
  - zadanie z pierwszym Paint.

  Ich czas obs. jest mnożony ×4 (`FirstContentfulPaint.getRenderBlockingNodeData`, trace_engine/lantern).

- Pierwsza porcja ParseHTML jest **dwumodalna** po obu stronach: 2–4 ms albo 17–25 ms, zależnie od tego, ile bajtów
  dokumentu dotarło przed startem parsera.

  | Strona | Tryb długi | Pierwsza porcja (ms)                       | FCP sim (s)                                  |
  | ------ | ---------- | ------------------------------------------ | -------------------------------------------- |
  | A      | 1/5 (A-2)  | 4,1 / **24,5** / 3,9 / 2,0 / 1,8           | 1,39 / **1,56** / 1,38 / 1,38 / 1,40         |
  | B      | 3/5        | 3,4 / 2,4 / **18,1** / **21,2** / **17,0** | 1,40 / 1,44 / **1,46** / **1,49** / **1,47** |

- Całkowity CPU przed obs. FCP jest w B **mniejszy**: mobile 140,0 → 137,8 ms, Δ̄ −12 ms. Obs. FCP jest równy:
  190 → 192 ms, Δ̄ +5 ms (σΔ 20).
- Ten sam dokument B w rundzie 1 dał mobile FCP 1,37–1,40 s (A 1,39–1,50 s). Losowanie trybu pierwszej porcji nie
  zależy od pozycji.
- Speedline (obsSI, `speedline.txt`): mobile A med 285 ms (280–307), B 311 ms (299–331), Δ̄ +25 ms (σΔ 22).
  - W B pierwsza klatka pojawia się ok. 20 ms później, w A ok. 260 ms (61%). Wszystkie przebiegi dochodzą do 100%.
  - Desktop4x: A 377, B 353 ms (Δ̄ −8, σΔ 61).
  - W rundzie 1 na tym samym dokumencie B mobile miał 287 wobec 317 ms dla A, czyli kierunek przeciwny. Łącznie
    z obu rund (n = 10 na stronę): A med 296, B med 308 ms, a zakresy całkowicie się nakładają. Szum.

### 5.4 Audyty jednego przebiegu mobile na stronę (`lh/{A,B}-mobile-1.audits.txt`)

|                                                            | A-mobile-1                                                              | B-mobile-1                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------- |
| benchmarkIndex                                             | 1 992                                                                   | 1 695                        |
| perf / FCP / LCP / TBT / SI                                | 97 / 1,39 / 1,99 / 139 / 1,39                                           | 99 / 1,40 / 2,00 / 46 / 1,40 |
| żądania / transfer                                         | 41 / 792,3 KB                                                           | 41 / 792,3 KB                |
| dokument (transfer)                                        | 41 919 B                                                                | **41 032 B** (−887)          |
| wejście `index-*` (transfer)                               | 235 961 B                                                               | 236 705 B (+744)             |
| priorytet High / VeryHigh                                  | 682,3 / 109,7 KB                                                        | 683,1 / 108,8 KB             |
| High przed obrazem LCP                                     | 92,7 KB                                                                 | 92,7 KB                      |
| element LCP                                                | `img.eh-img` (`fixture.invalid/cover.jpg`), wykrywalny, `fetchpriority` | ten sam                      |
| LCP obs.: TTFB / opóźnienie ładowania / ładowanie / render | 22 / 33 / 30 / 101 ms                                                   | 25 / 34 / 14 / 144 ms        |
| render-blocking                                            | `styles-*.css` 68,8 KB, wasted 450 ms                                   | ten sam                      |
| main thread / Parse HTML & CSS                             | 2 607 / 136 ms                                                          | 2 600 / 124 ms               |
| bootup dokumentu `/` (total / script / parse)              | 626 / 130 / 25 ms                                                       | 628 / 155 / 33 ms            |
| CLS                                                        | 0,000                                                                   | 0,000                        |

- Opóźnienie renderu LCP (+43 ms obs.) mieści się w zmienności przebiegów. Na tej maszynie B-mobile-1 miał
  benchmarkIndex o 15% niższy.
- Główny wątek ma ten sam rozkład.

## 6. Ocena wobec kryteriów dowodu (notatka orkiestratora)

| Kryterium                                                                                            | Wynik                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `htmlRawBytes` w dół, P3.7b ≥ −11,5 KB                                                               | ✔ **−12 883 B**. P3.7a + P3.7b łącznie −26 366 B wobec celu −25 KB                                                                                                                    |
| `dehydratedQueryHashCount` = 0                                                                       | ✔ 0 (A: 21)                                                                                                                                                                           |
| `streamedStateBytes` policzone                                                                       | ✔ 6 878 B (A: 10 351 B, −3 473)                                                                                                                                                       |
| `imagePreloadNonCandidate` 0                                                                         | ✔ 0                                                                                                                                                                                   |
| `documentPreloadDuplicates` 0                                                                        | ✔ 0                                                                                                                                                                                   |
| propozycja ratchetu (bez zmiany istniejących progów)                                                 | ✔ §3.1                                                                                                                                                                                |
| e2e artefaktu: zero refetchów na `/` po hydratacji, zero błędów hydratacji                           | ✔ `test:e2e:artifact` 31/31 + sonda §4.1 (`/` i `/en`, telefon i desktop: 0 / 0)                                                                                                      |
| e2e P2.5 miękkiej zmiany języka (pasek bez zapadania, CLS 0)                                         | ✔ 4/4 przejść B: min. wys. = wys. przed, 0 klatek bez paska, CLS bez wejścia 0                                                                                                        |
| Lighthouse: porcje ParseHTML krótsze                                                                 | ✘/~ bez mierzalnej zmiany: Δ̄ +0,0 / −1,5 ms przy MDE 13,6 / 4,2. Klasa w księdze nie znika. Grupa LH „Parse HTML & CSS” −15 ms w 4/5 par na obu formach, poniżej MDE                  |
| Lighthouse: PB2 (StartClient z deserializacją `$_TSR`) krótsze                                       | ✘ +0,4 / −2,0 ms, σΔ 2–4 ms. Koszt `hashKey` na kliencie, jak w rundzie 1                                                                                                             |
| FCP/LCP ±0,02 s                                                                                      | ~ desktop ✔ (+0,006 / −0,014 s). Mobile: mediany +0,07 / +0,14 s, pary +0,029 / +0,063 s w MDE 0,148 / 0,242. Mechanizm to losowy tryb pierwszej porcji ParseHTML, nie pozycja (§5.3) |
| CLS ≤ 0,001                                                                                          | ✔ 0,000 w 20/20 przebiegach LH i w e2e (bez wejścia)                                                                                                                                  |
| TBT bez regresji                                                                                     | ✔ mobile −26 ms, desktop4x −75 ms (oba w szumie)                                                                                                                                      |
| `check:bundle`: nie gorzej niż baza (overall/public/entry/boot)                                      | ✘ dosłownie: overall +1,3, public +1,0, wejście +0,5, boot +0,6 KB gz / +0,8 KB raw. Z overall ok. 0,65 KB to churn hashy (§2.2). Bramka zielona                                      |
| KRYTYKA: limit P3.7b ≤ +1,0 KB raw domknięcia bootu                                                  | ✔ **+823 B raw** (+569 B gz). W rundzie 1 było +2 018 B                                                                                                                               |
| KRYTYKA: predykat P3.6b nie czyta `heroPreloads` ani zmienionych kluczy; `/` nadal w cache dokumentu | ✔ (§1)                                                                                                                                                                                |

## 7. Decyzje i ryzyka dla orkiestratora

1. **Akceptacja rdzenia T1.** Do bootu dochodzi +823 B raw / +569 B gz, czyli moduł `dehydratedQueryEnvelope` w
   ścieżce `expand*`. Mieści się w limicie KRYTYKI, ale łamie regułę „nie gorzej niż baza”.
   - Alternatywa: zrzucić T1 i oddać `dehydratedQueryHashCount` 0 oraz ok. −8 KB bariery. Pozostałe kroki (T2, T4, T5,
     T6, X1) nie kosztują już JS w wejściu.
   - Kolejna runda poprawek nie ma czego zdjąć bez utraty efektu.
2. **Kryterium PB2.** Pomiar dwóch rund pokazuje, że PB2 się nie skraca. Propozycja IMPL §3 i recenzji m3: zastąpić je
   kryterium „PB2 + makrozadanie `router-hydrate` nie rośnie”. To jest spełnione (PB2 Δ̄ +0,4 / −2,0 ms, TBT bez
   regresji).
3. **Mobile FCP w tym przebiegu.** Mediana +0,07 s wynika z dwumodalności pierwszej porcji ParseHTML, a nie z pozycji.
   Ten sam dokument B wypadł w rundzie 1 lepiej niż A. Przy bramce fali warto patrzeć na pary i na `fcpnodes.py`, a nie
   na samą medianę.
4. **Scalanie z P3.2a:**
   - `heroImage.ts` ma jedną instrukcję w `postListPreload`;
   - `documentWeight.ts` i budżety: P3.7b tylko dodaje dwa klucze;
   - ratchet `htmlRawBytes`/`headRawBytes` liczyć z tipu po obu pozycjach.

## 8. Pliki (`$P/prove2/`)

- **Logi bramek:** `build.log`, `check:bundle.log`, `check:chunks.log`, `check:entry-purity.log`,
  `check:server-entry-purity.log`, `document-weight{,-base}.{json,log}`, `dw-compare.md`, `base-dw-new-metrics.json`
  (kopia z rundy 1), `e2e-artifact.log`, `e2e-prove-B.log` (+ `e2e-prove-results-B/`), `vitest-prove.log`.
- **Analizy JS:** `entry-diff.txt`, `chunk-diff.txt`.
- **Dokument:** `html/B-{home,_en}.html`.
- **Lighthouse:** `ab.log`, `lh/` (JSON, księgi, ślady, audyty), `trace-p37b.txt`, `lhrun.txt`, `prefcp.txt`,
  `fcpnodes.txt`, `ledger-agg.md`, `speedline.txt`.
- **Narzędzia:**
  - rundy 2: `tools/lhrun.py`, `tools/prefcp.py`, `tools/fcpnodes.py`;
  - z rundy 1: `$P/prove-tools/`.
