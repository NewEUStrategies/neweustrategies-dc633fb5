# Prove integracji P3.8 × P3.6b (`integ/w3-p38` @ `f2085e6c`)

- B = `wt3/integ-p38`, gałąź `integ/w3-p38`, HEAD **`f2085e6c`**. To scalenie `c7f0c12d` (P3.8 `c2697ba1` na
  `b8bf6c14`) plus test strażnika styku. Raport scalenia: `../MERGE.md`.
- A (kontrola) = `base-w3c` (tip PR `8052dfbb`, gotowy `.output`, bez przebudowy). `b8bf6c14` różni się od niego
  wyłącznie komentarzem w `vite.smoke.config.ts`.
- Wszystkie kroki ciężkie szły przez mutex (`heavy-bg.sh`), a lekkie przez `light.sh`. Repo główne, gałąź PR i
  worktree innych agentów są nietknięte. Moje serwery (porty 4331/4332/4181) zamknąłem i sprawdziłem, że żaden nie
  nasłuchuje. Kod w worktree się nie zmienił (`git status` czysty, HEAD bez zmian).

## 1. Werdykt

| Obszar                                                                                       | Wynik                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build `env BUNDLE_INVENTORY=1 bun run build:smoke`                                           | exit 0 (`build.log`)                                                                                                                                                                                                                                                                           |
| `check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity`            | **zielone** (§2.1)                                                                                                                                                                                                                                                                             |
| `check-document-weight`                                                                      | czerwona **tylko** `bootBurstGzipBytes`: 574 829 B przy progu 574 673 B, czyli **+156 B**. To oczekiwane i przyjęte do czasu wejścia P3.7a. Reszta metryk zielona (§2.2)                                                                                                                       |
| Nowy chunk w boocie (zwłaszcza `vendor-sonner`)                                              | **brak.** Domknięcie bootu ma 10 chunków. Seria ma 26 plików, tak jak w A. `vendor-sonner` nie ma ani w domknięciu, ani w serii (§2.3)                                                                                                                                                         |
| `test:e2e:artifact` (CI-like: `NES_ARTIFACT_FIXTURE=1` + placeholdery)                       | **18/18** zielone, w tym `backend-quiet.boot-home` (§3)                                                                                                                                                                                                                                        |
| `on-demand-overlays` + `popup-first-render` (`playwright.performance.config.ts`, artefakt B) | **1/1 + 2/2** zielone (§3)                                                                                                                                                                                                                                                                     |
| **Magazyn dokumentów** (`/`, `/en`, artykuł)                                                 | **bez regresji.** Każdy kompletny dokument ma przy 1. żądaniu MISS z `store:"stored"`, a przy 2. HIT `layer:"L1"`. Żadne `degradedBy` nie pochodzi z zasiewów P3.8. Zapisane dokumenty B niosą sygnał `["builder-popups-active"]` = `success` / `dataUpdatedAt: 0` oraz `site_font_scale` (§4) |
| Smoke z opóźnionym backendem (zestaw P3.6b)                                                  | B = A w każdym przypadku. B1 i B2 są zapisane z przebiegu czytelnika. Typ A **nie** jest zapisany (`degradedBy:["home.page"]`, `private, no-store`). Bramka wyczerpana daje `store:"degraded"` (§4.2)                                                                                          |
| **needs_fix**                                                                                | **nie**                                                                                                                                                                                                                                                                                        |

## 2. Bramki artefaktu

### 2.1 Bundle i graf

| Bramka                      | Wynik B                                                                                                                                                                                                                                                        | Log                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `check:bundle`              | OK. Overall 4757,4 / 4772 KB (zapas 14,6 KB), public JS 2807,4 / 2877 KB, największy chunk 262,4 / 286 KB, CSS 95,0 / 96 KB (public 81,2 / 83), **boot closure 488,0 KB gz / 1599,0 KB raw, 10 chunków** (≤ 579 KB). Liczby takie same jak w pomiarze scalenia | `check:bundle.log`              |
| `check:chunks`              | OK. 895 chunków, 6864 krawędzie, graf acykliczny                                                                                                                                                                                                               | `check:chunks.log`              |
| `check:entry-purity`        | OK. `index-DKE29euy.js` → 10 chunków statycznie osiągalnych. `sonner` jest na liście ciężkich modułów, których w boocie być nie może, i go tam nie ma                                                                                                          | `check:entry-purity.log`        |
| `check:server-entry-purity` | OK. 1816 plików, leniwe wyłącznie `stripe.mjs`, zamrożony dług `node-html-parser` (2), bez zmian                                                                                                                                                               | `check:server-entry-purity.log` |

### 2.2 Waga dokumentu (`GET /`, fixture, HIT, 5 próbek)

`document-weight.json`. Porównanie z tipem PR (`integ-b2/document-weight.json`, artefakt `base-w3c`) i z bazą
fali (`w3/base-b/document-weight.json`, artefakt `base-w3b`).

| Metryka                | baza fali (`base-w3b`) | tip PR (`base-w3c`) | **B (integracja)** | Δ B − tip PR |      Próg |               Zapas B |
| ---------------------- | ---------------------: | ------------------: | -----------------: | -----------: | --------: | --------------------: |
| `bootClosureRawBytes`  |              1 636 946 |           1 637 178 |      **1 637 356** |         +178 | 1 637 758 |                   402 |
| `bootClosureGzipBytes` |                496 041 |             496 071 |        **496 227** |         +156 |   496 679 |                   452 |
| `bootBurstGzipBytes`   |                574 062 |             574 113 |        **574 829** |         +716 |   574 673 | **−156 (ponad próg)** |
| `bootBurstCount`       |                     26 |                  26 |             **26** |            0 |        26 |                     0 |
| `dehydratedStateBytes` |                 60 357 |              60 357 |         **61 047** |         +690 |    66 486 |                 5 439 |
| `htmlRawBytes`         |                337 696 |             340 180 |        **340 873** |         +693 |   406 180 |                65 307 |
| `htmlGzipBytes`        |                 52 542 |              53 040 |         **53 064** |          +24 |    57 710 |                 4 646 |

- Jedyna czerwona metryka to `bootBurstGzipBytes`, **+156 B ponad próg**, tyle samo co w pomiarze scalenia.
  Przyczyna jest znana z Prove 3 P3.8: Rollup przenosi `i18n-sponsored` do `useInFeedAds-*`, a ten chunk jest w
  serii. Nadwyżka rośnie z +52 B (P3.8 sam) do +156 B przez bajty P3.6b, linków prawnych i toastów czatu w `index`.
  Zgodnie z zadaniem: bez naprawy i bez ruszania progów. P3.7a (ok. −1,28 KB gz bootu) ma wejść przed tą integracją.
- `dehydratedStateBytes` +690 B to dwa wpisy z P3.8: `site_font_scale` i sygnał `builder-popups-active`. To ten
  sam przyrost, który P3.8 miał samodzielnie.
- Pozostałe metryki (`inline*`, preloady, LCP, `preLcpTransferBytes` 178 239 B, CSS blokujący 80 443 B, wycieki
  modułów serwerowych): zielone.

### 2.3 Skład serii bootu B wobec tipu PR (`burst-diff.txt`)

Gzip per plik, nazwy bez hasha. Narzędzie: `P3.8/prove3/tools/burst-diff.cjs`.

| Plik                                                                                                  |         A (tip PR) |                  B |                               Δ gz |
| ----------------------------------------------------------------------------------------------------- | -----------------: | -----------------: | ---------------------------------: |
| `index.js`                                                                                            |            267 060 |            267 217 |                               +157 |
| `useInFeedAds.js`                                                                                     |              1 002 |              1 831 | +829 (wchłonięty `i18n-sponsored`) |
| `FooterSlideup.js`                                                                                    |                  — |              1 210 |                             +1 210 |
| `blog.index.js`                                                                                       |              1 541 |                  — |                             −1 541 |
| `headings.js`                                                                                         |                760 |                839 |                                +79 |
| `sliderVariants.js`                                                                                   |             11 389 |             11 368 |                                −21 |
| pozostałe 20 plików (w tym `vendor-react`, `vendor-tanstack`, `vendor-supabase`, `vendor-i18n`, `pl`) |                  — |                  — |                            0 do ±5 |
| **razem**                                                                                             | 26 plików, 574 113 | 26 plików, 574 829 |                           **+716** |

- Para `blog.index` → `FooterSlideup` to przeniesienie, nie nowa zależność. W A seria pobierała `blog.index`, bo
  siedział w nim kod `FooterSlideup`. Po P3.8 ten kod ma własny chunk. Prove 3 P3.8 opisał to tak samo (−1 541 /
  +1 212).
- `vendor-sonner-CcwRwiDC.js` istnieje w obu artefaktach (ten sam hash). **Nie ma go w serii ani w domknięciu
  bootu.** Toasty karuzeli idą przez leniwy most `notify` (runda 10 P3.8).

## 3. e2e

| Zestaw                                                                                                                                 | Wynik                                                                                                                                                                                                                                                                                                                       | Log                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `test:e2e:artifact` (`NES_ARTIFACT_FIXTURE=1`, `SUPABASE_URL`/`VITE_SUPABASE_URL=https://placeholder.supabase.co`, klucze placeholder) | **18/18 passed** (44,0 s). Zestaw: `boot-artifact` ×3, `boot-home` ×3, `backend-quiet.boot-home` („boot anonimowej `/` nie wysyła żądań Supabase; interakcja otwiera odroczone odczyty”), `boot-timing` ×3 (w tym „cache dokumentów oddaje drugie żądanie z HIT-a”), `legal-links.boot-home` ×5, `motion-gate.boot-home` ×3 | `e2e-artifact.log`                                                                            |
| linie `doc` serwera w tym przebiegu                                                                                                    | `/`: 1× MISS (`store:"stored"`) i 7× HIT. `/en`: 1× MISS i 9× HIT. `/cookies`: 2× MISS i 5× HIT. Bez `degraded:true`                                                                                                                                                                                                        | j.w.                                                                                          |
| `on-demand-overlays` (`playwright.performance.config.ts`, `NES_PERFORMANCE_ARTIFACT_ROOT=wt3/integ-p38`, `NES_PERFORMANCE_BASELINE=0`) | **1/1**                                                                                                                                                                                                                                                                                                                     | `e2e-item.log`, skrypt `e2e-item.sh` (kopia `P3.8/prove3/tools/e2e-item.sh` z innym worktree) |
| `popup-first-render` (1440 px, 390 px)                                                                                                 | **2/2**                                                                                                                                                                                                                                                                                                                     | j.w.                                                                                          |

W `popup-first-render` widać linie `[rate-limit] rpc failed … rpc/rate_limit_hit` i `[newsletter-popup-events]
insert failed`. To fixture odrzucający zapisy zdarzeń popupu, a nie błąd testu.

## 4. Smoke magazynu dokumentów (klucz tego Prove)

Narzędzia są w `smoke/tools/`:

- `replaySlow.mjs`: kopia haka z Prove P3.6b, fixture `homeFixture.ts` artefaktu z opóźnieniem ścieżek z `NES_SLOW`;
- `probe3.sh`: serwer artefaktu (`node --import … .output/server/index.mjs`, fixture backend, `HOST=127.0.0.1`,
  env jak w konfiguracji artefaktu). Każdą ścieżkę pobiera 2× z UA Chrome, `accept: text/html` i
  `nes_lang`/`accept-language` zgodnym z językiem ścieżki. Zbiera nagłówki, `degraded:!0/!1` z HTML-a i linie
  `kind:"doc"`;
- `run-all.sh`: B (port 4331) i A (port 4332);
- `replayLenient.mjs` + `run-article2.sh`: artykuł (§4.3);
- `seeds.py`: odczyt stanu zasiewów z odwodnionego stanu dokumentu.

Logi: `smoke/run-all.log`, `smoke/run-article*.log`, katalogi `smoke/<A|B>-<przypadek>/` (nagłówki, ciała,
`server.log`).

### 4.1 Czysty render: `/`, `/en`, `/blog`

| Ścieżka | Strona | Żądanie 1: `cache-control` / rozmiar                                                      | Linia `doc` żądania 1                                          | Żądanie 2                                                                   |
| ------- | ------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `/`     | **B**  | `public, max-age=60, s-maxage=900, stale-while-revalidate=86400` / 340 831 B, TTFB 0,40 s | `cache:"MISS", layer:"render", degraded:false, store:"stored"` | **HIT** (`layer:"L1"`, `x-nes-cache-age: 2`), ciało bajt w bajt = żądanie 1 |
| `/`     | A      | to samo / 340 138 B, TTFB 0,40 s                                                          | `degraded:false, store:"stored"`                               | HIT                                                                         |
| `/en`   | **B**  | to samo / 341 645 B                                                                       | `degraded:false, store:"stored"`                               | **HIT**                                                                     |
| `/en`   | A      | to samo / 340 952 B                                                                       | `degraded:false, store:"stored"`                               | HIT                                                                         |
| `/blog` | **B**  | to samo / 191 939 B                                                                       | `degraded:false, store:"stored"`                               | **HIT**                                                                     |
| `/blog` | A      | to samo / 191 178 B                                                                       | `degraded:false, store:"stored"`                               | HIT                                                                         |

Różnica rozmiaru B − A wynosi +693 B na `/` i `/en`. To dwa wpisy P3.8 w stanie odwodnionym.

**Zasiewy P3.8 w zapisanych dokumentach** (`smoke/seeds.txt`, odczyt odwodnionego stanu, `status/dataUpdatedAt`):

| Dokument                               | `builder-popups-active` | `site_font_scale` | `post-layout-settings`              | `newsletter-settings`       |
| -------------------------------------- | ----------------------- | ----------------- | ----------------------------------- | --------------------------- |
| B `/` (MISS, `stored`)                 | `success` / **0**       | `success` / > 0   | `success` / 0 (celowy zasiew P3.6b) | `success` / > 0             |
| B `/en`                                | `success` / **0**       | `success` / > 0   | `success` / 0                       | `success` / > 0             |
| B `/blog/fixture-2` (artykuł)          | `success` / **0**       | `success` / > 0   | `success` / > 0                     | brak (nie pobierany na SSR) |
| B `/` w B1, B2 i po odświeżeniu typu A | `success` / **0**       | `success` / > 0   | `success` / 0                       | `success` / > 0             |
| A `/`                                  | brak                    | brak              | `success` / 0                       | `success` / > 0             |

Wniosek: zapisane dokumenty B naprawdę niosą sygnał „brak aktywnych popupów” z `dataUpdatedAt: 0` (fixture
`builder_popups` jest pusty) i `site_font_scale`. Mimo to predykat P3.6b uznaje stronę główną za kompletną
(`store:"stored"`). Sygnał jest w `DECORATIVE_QUERY_ROOTS`, a `site_font_scale` ma `dataUpdatedAt > 0`. To
potwierdza §2 i §3.1 z `MERGE.md` na prawdziwym serwerze.

### 4.2 Opóźniony backend (zestaw z Prove P3.6b, tylko `/`, odstęp 4 s)

| Przypadek         | Opóźnienie                         | Strona | Żądanie 1: `cache-control` / rozmiar                  | Linia `doc` czytelnika                                                                                                                                                   | TTFB / total 1 | Żądanie 2 | Skąd wpis                                                                                  |
| ----------------- | ---------------------------------- | ------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | --------- | ------------------------------------------------------------------------------------------ |
| B1                | `rpc/get_entity_content` +700 ms   | **B**  | `public, max-age=0, s-maxage=30, swr=300` / 343 754 B | `degraded:false, store:"stored"`, bez linii `revalidation`                                                                                                               | 0,99 / 1,10 s  | **HIT**   | **czytelnik**                                                                              |
| B1                | j.w.                               | A      | to samo / 343 061 B                                   | `degraded:false, store:"stored"`                                                                                                                                         | 1,00 / 1,10 s  | HIT       | czytelnik                                                                                  |
| B2                | `/rest/v1/posts` +900 ms           | **B**  | `public, max-age=0, s-maxage=30, swr=300` / 343 754 B | `degraded:false, store:"stored"`, bez `revalidation`                                                                                                                     | 0,79 / 1,70 s  | **HIT**   | **czytelnik**                                                                              |
| B2                | j.w.                               | A      | to samo / 343 061 B                                   | `degraded:false, store:"stored"`                                                                                                                                         | 0,77 / 1,69 s  | HIT       | czytelnik                                                                                  |
| typ A             | `rpc/get_entity_content` +1 700 ms | **B**  | `private, no-store` / 183 957 B                       | `degraded:true, degradedAt:"loader", degradedBy:["home.page"]`, **bez `store`**                                                                                          | 1,34 / 1,34 s  | HIT       | odświeżenie w tle (`revalidation:true, degraded:false, store:"stored"`), **nie** czytelnik |
| typ A             | j.w.                               | A      | `private, no-store` / 183 264 B                       | `degradedBy:["home.page"]`, bez `store`                                                                                                                                  | 1,35 / 1,36 s  | HIT       | odświeżenie w tle                                                                          |
| bramka wyczerpana | `/rest/v1/posts` +3 500 ms         | **B**  | `public, max-age=0, s-maxage=30, swr=300` / 266 995 B | `degraded:true, degradedAt:"stream", degradedBy:["dropped:builder-post-list","dropped:builder-slider-posts","dropped:builder-slider-fallback-images"], store:"degraded"` | 0,77 / 2,72 s  | HIT       | odświeżenie w tle (`store:"stored"`), nie czytelnik                                        |
| bramka wyczerpana | j.w.                               | A      | to samo / 266 302 B                                   | identyczne `degradedBy`, `store:"degraded"`                                                                                                                              | 0,77 / 2,73 s  | HIT       | odświeżenie w tle                                                                          |

- Dokument z późnymi sekcjami (B1, B2) jest nadal zapisywany z przebiegu czytelnika. Dokument typu A nadal **nie**
  jest zapisywany.
- Żadne `degradedBy` w B nie wskazuje klucza P3.8 (`seed:builder-popups-active`, `seed:site_font_scale`,
  `error:newsletter-settings.*`, `dropped:` sygnału). Listy `degradedBy` w B i A są identyczne.
- Wyniki zgadzają się z tabelą §2.1 Prove P3.6b (różnice TTFB ≤ 0,02 s). Jedyna różnica B − A to +693 B w każdym
  dokumencie strony głównej.

### 4.3 Artykuł

Fixture `homeFixture.ts` nagrywa tylko stronę główną. Przy samym fixture `/fixture-2` daje w A i B identycznie
`200` + `private, no-store` + `degraded:true, degradedAt:"loader"` (zastępcza sekcja „Ta sekcja chwilowo nie ma
danych”). Przyczynę pokazał log braków (`smoke/B-article-strict/server.log`): `rpc/resolve_path` i
`rpc/get_related_posts_config` nie są nagrane. Z P3.8 nie ma to związku, bo w A jest tak samo. `/post/fixture-2`
to `302 → /blog` w obu.

Żeby sprawdzić prawdziwy artykuł, `replayLenient.mjs` (poza repo) stubuje `resolve_path`: ostatni segment ścieżki
będący slugiem wpisu z fixture daje trafienie `{page_id, post_id}`. Inne nienagrane odczyty (`post_authors`,
`page_breadcrumbs`, `get_related_posts_config`) dostają pusty wynik. Artefakt zostaje bez zmian.

| Ścieżka              | Strona | Żądanie 1                                                 | Linia `doc` żądania 1            | Żądanie 2      |
| -------------------- | ------ | --------------------------------------------------------- | -------------------------------- | -------------- |
| `/blog/fixture-2`    | **B**  | `public, max-age=60, s-maxage=900, swr=86400` / 230 611 B | `degraded:false, store:"stored"` | **HIT** (`L1`) |
| `/blog/fixture-2`    | A      | to samo / 229 922 B                                       | `degraded:false, store:"stored"` | HIT            |
| `/en/blog/fixture-2` | **B**  | to samo / 230 372 B                                       | `degraded:false, store:"stored"` | **HIT**        |
| `/en/blog/fixture-2` | A      | to samo / 229 683 B                                       | `degraded:false, store:"stored"` | HIT            |
| `/fixture-2`         | **B**  | to samo / 233 120 B                                       | `degraded:false, store:"stored"` | **HIT**        |
| `/fixture-2`         | A      | to samo / 232 431 B                                       | `degraded:false, store:"stored"` | HIT            |

Zapisany artykuł B niesie sygnał popupów (`success` / `dataUpdatedAt: 0`) i `site_font_scale`. Na trasach wpisu
predykatu nie ma, więc o zapisie decyduje tylko dyrektywa trasy, a P3.8 jej nie zmienia. Wynik: zapis jak w A.

Ten sam przebieg z hakiem pobłażliwym potwierdza też `/` i `/en`: MISS z `store:"stored"`, potem HIT, w obu stronach
(`smoke/run-article.log`).

## 5. Pliki

- `build.log`, `check:*.log`, `document-weight.{log,json}`, `burst-diff.txt`
- `e2e-artifact.log`, `e2e-item.log`, `e2e-item.sh`
- `smoke/tools/` (`probe3.sh`, `probe3-lenient.sh`, `replaySlow.mjs`, `replayLenient.mjs`, `run-all.sh`,
  `run-article.sh`, `run-article2.sh`, `seeds.py`), `smoke/run-all.log`, `smoke/run-article.log`,
  `smoke/run-article2.log`, `smoke/seeds.txt`, `smoke/{A,B}-{clean,B1,B2,typeA,gateExhausted,article,article-strict,article-lenient}/`
