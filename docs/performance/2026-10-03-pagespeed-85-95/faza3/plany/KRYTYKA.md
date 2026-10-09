# Krytyka krzyżowa planów fali 3, partie 3–5 (P3.2a, P3.2b, P3.9, P3.7, P3.1, P3.10, P3.11)

Data: 2026-10-08. Repo `claude/zen-ritchie-hzur21` @ `d22cf7d6` (partia 1 scalona). Tylko odczyt: bez buildów, bez
Lighthouse'a, bez testów. Liczby budżetów pochodzą z istniejących artefaktów `phase3/wave3/*/document-weight.json`,
`phase3/wave3/P3.3/check:bundle.log` i inwentarza `base-w3b/reports/chunk-inventory.json`.

Prośba użytkownika w tej turze: „jeden font - ma to byc red hat display”. Wszystkie siedem specyfikacji ją respektuje
(§5). Brakuje jednak bramki, która by ją utrwaliła, i jest furtka w CMS (§4, luka L3).

## 0. Werdykt w pięciu punktach

1. **Kolejność z PLAN-FALI-3 §3 nie przejdzie bramek budżetu bootu.** Wszystkie specyfikacje liczą tylko
   `bootClosureGzipBytes` i zakładają zapas 0,6 KB. Pomijają `bootClosureRawBytes`, który też jest bramkowany. Roboczy
   pomiar P3.3 (partia 2, na bazie partii 1) daje **155 B zapasu raw** (1 637 603 / 1 637 758), **347 B gzip**
   (496 332 / 496 679) i **323 B w `bootBurstGzipBytes`**. P3.8 dopiero dołoży swój kod w `__root.tsx`, który leży w
   wejściu. P3.2a i P3.1 dodają kod do modułów chunku wejściowego (sprawdzone w inwentarzu, §3), więc bez wcześniejszej
   ulgi nie zmieszczą się w progach, a progów nie wolno podnosić. Jedyną zmierzoną ulgą w planach jest S1 z P3.7:
   `TICKER_CSS` leży w `index-c_XR_U82.js`, a jego minifikacja daje −4 920 B raw i −1 281 B gz.
2. **Proponuję przestawić partie** (§6). Partia 3: **P3.7a** (S1 + S3 + metryka komentarzy), P3.2b, P3.9.
   Partia 4: P3.2a, **P3.7b** (T1, T2, X1, T4, T5, T6, metryki stanu), P3.1. Partia 5: P3.10. P3.11 przechodzi do fali 4.
3. **Kolizji plików jest 22** (§2). Wszystkie da się rozwiązać kolejnością scalania albo jednym właścicielem. Żadna nie
   wymaga przepisania specyfikacji. Kilka odsyłaczy jest nieaktualnych: P3.1 i P3.11 zakładają, że P3.9 zmienia
   `vite*.config.ts` albo `i18n.ts`, a P3.9 §4 tych plików nie rusza.
4. **Weryfikacja wyrywkowa** (§1, 27 twierdzeń) potwierdziła prawie wszystko. Jest jedna sprzeczność merytoryczna:
   P3.7 T4b kontra komentarz w kodzie `headerTickerQuery.ts:95-103`. Do tego jedna nieścisłość: cmap fontu P3.2b
   (U+0102). Obie mają małe skutki, ale trzeba je poprawić w specyfikacjach.
5. **P3.11: NO-GO w fali 3** (zgadzam się z planistą). Warunki GO dla fali 4 są w §7.

## 1. Weryfikacja wyrywkowa (kod na `d22cf7d6`)

| Pozycja | Twierdzenie                                                                  | Dowód sprawdzony                                                                                                                       | Wynik                                                                                 |
| ------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| P3.2a   | `RESPONSIVE_WIDTHS` 9 szerokości, `buildImageSrcSet` jedynym budowniczym `w` | `src/lib/cropSizes.ts:209`, `:216-227`; grep wywołań: 13 miejsc, wszystkie na liście §1.2                                              | OK                                                                                    |
| P3.2a   | mobilne `sizes` = `100vw`                                                    | `src/lib/builder/imageSlot.ts:35-47`                                                                                                   | OK                                                                                    |
| P3.2a   | margines kolumny 4 × 8 px                                                    | `src/styles.css:2838-2846` (`[data-col-id] padding: 8px !important`), `:2862-2865`, `sectionStyles.tsx:44`                             | OK; zastrzeżenie w L7                                                                 |
| P3.2a   | logo mobilne eager, desktop w `HydrationIsland hidden lg:block`              | `src/components/Header.tsx:301-307`, `:333-342`                                                                                        | OK                                                                                    |
| P3.2a   | awatar autora przez domyślną drabinę                                         | `src/components/blocks/PostContextViews.tsx:203-208`                                                                                   | OK. Inne zdjęcia osób z `responsive`: tylko `SpeakersWidget.tsx:647-653` (pytanie W2) |
| P3.2a   | React nie emituje auto-preloadu w `<picture>`                                | `node_modules/react-dom/cjs/react-dom-server.edge.production.js:2150-2160` (`pictureOrNoScriptTagInScope`)                             | OK                                                                                    |
| P3.2a   | `imgEagerNonCandidate` zwalnia `<header data-site-header>`                   | `scripts/performance/documentWeight.ts:460-473`, `Header.tsx:688`                                                                      | OK                                                                                    |
| P3.2b   | dwie twarze RHD, fallback bez deskryptora wagi                               | `src/styles.css:37-57`, `:87-94`                                                                                                       | OK                                                                                    |
| P3.2b   | `--td-pt-family`/`--td-pe-family` bez normalizacji                           | `src/lib/theme/themeDesign.ts:615`, `:622`                                                                                             | OK                                                                                    |
| P3.2b   | importy `?url` obu fontów i `ROOT_ASSETS`                                    | `src/routes/__root.tsx:36-37`, `:565-569`                                                                                              | OK                                                                                    |
| P3.2b   | generator Theme Design poza bootem                                           | inwentarz: `themeDesign.ts` → `themeDesignCss-CDh7ypcV.js`, nie `index-*`                                                              | OK                                                                                    |
| P3.2b   | podzbiór `ca7035ae…` 31 100 B, 18 liter PL, oś `wght`                        | `fontTools` na `p32b/out/a2.woff2`: brak 0 liter PL, `wght` 300/400/900, hhea 1018/−305/0, hash powtarzalny (`r1`, `r2`)               | OK; nieścisłość U+0102 (L8)                                                           |
| P3.9    | `WidgetView` importuje tylko `parseCustomFields`                             | `WidgetView.tsx:14`, `:277`, `:338`                                                                                                    | OK                                                                                    |
| P3.9    | 5 statycznych importów `FooterSlideup`                                       | `index.tsx:8`, `blog.index.tsx:11`, `search.tsx:35`, `$.tsx:172`, `ArchiveBody.tsx:5`                                                  | OK                                                                                    |
| P3.9    | `sideEffects` tylko CSS i i18n, `experimentalMinChunkSize: 2048`             | `package.json:4-8`; `vite.config.ts:342`, `vite.smoke.config.ts:148`                                                                   | OK                                                                                    |
| P3.7    | `TICKER_CSS` `:893-1214`, `SHARED_STYLES` `:444`                             | `TrendingTicker.tsx:893`, `:1214`; `sliderVariants.tsx:444`                                                                            | OK                                                                                    |
| P3.7    | `TICKER_CSS` w chunku wejściowym                                             | inwentarz: `TrendingTicker.tsx` → `index-c_XR_U82.js`                                                                                  | OK, to klucz do budżetu                                                               |
| P3.7    | reguły `[data-sidebar]` w moście marki, emitowane tylko w adminie            | `globalColors.ts:909-922`, `:982-983`; grep `data-sidebar=`: tylko `src/components/admin/*`                                            | OK                                                                                    |
| P3.7    | `denyPatterns` 4 wzorce na prefiks                                           | `src/lib/seo/speculationRules.ts:78-86`                                                                                                | OK                                                                                    |
| P3.7    | `currentLang()` per żądanie na serwerze                                      | `src/lib/i18n/localeRuntime.ts:112-123` (z URL i ciasteczka żądania)                                                                   | OK w kodzie, ale komentarz `headerTickerQuery.ts:95-103` twierdzi odwrotnie (L4)      |
| P3.1    | zapis `--sticky-header-h` przy montażu, `fonts.ready`                        | `Header.tsx:601`, `:664`, `apply()` przed RO                                                                                           | OK                                                                                    |
| P3.1    | `useConsent` subskrybuje `supabase.auth` w efekcie                           | `src/lib/ads/consent.ts:656`; `onSupabaseClientCreated` w `client.ts:29`, `sessionHint.ts:149`                                         | OK                                                                                    |
| P3.1    | domyślne `--sticky-header-h` tylko ≤ 1023 px                                 | `src/styles.css:6632-6636`                                                                                                             | OK                                                                                    |
| P3.10   | `ui/atoms/index.js` = `index.ts`                                             | `diff` bez różnic                                                                                                                      | OK                                                                                    |
| P3.10   | `ArticleListenButton` itd. bez importerów produkcyjnych                      | grep: 0 poza łańcuchem; atom `audio/atoms/MorphPlayPause` zostaje (AGENTS.md: sidebar i pasek audio na wspólnych atomach nienaruszone) | OK                                                                                    |
| P3.11   | `css: 96`, `publicCss: 83`, arkusz pierwszy w `<head>`                       | `scripts/check-bundle-size.ts:2208`, `:2250`; `rootHead.ts:58`                                                                         | OK                                                                                    |
| P3.11   | suma CSS ma zapas 1,0 KB                                                     | `P3.3/check:bundle.log`: „css total: zostało 1.0 KB z 96 KB”                                                                           | OK, i ma to wpływ na P3.2b i P3.7 (L2)                                                |

## 2. Pliki wspólne i rozstrzygnięcie własności

Partia 2 (P3.3, P3.6b, P3.8) jest scalona przed partią 3. Numery linii z partii 3–5 trzeba więc odświeżyć po każdym
scaleniu.

| Plik                                                                                                                                | Kto (partia)                                                                                                                                                                                 | Regiony                                                                                   | Rozstrzygnięcie                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/routes/__root.tsx`                                                                                                             | P3.6b, P3.8 (2); P3.2b (3); P3.7 krok 10 T3 (opcja); P3.11 (fala 4)                                                                                                                          | P3.2b: `:36-37`, `:565-569`, `:674`, `:723-731`; T3: `:774-777`, `:961-962`, `:1100-1106` | W fali 3 właścicielem jest P3.2b (regiony rozłączne z partią 2). **T3 wyjąć z P3.7** (osobna pozycja albo fala 4). P3.11 w fali 4                                  |
| `src/lib/seo/rootHead.ts`                                                                                                           | P3.2b (3); P3.11 (4)                                                                                                                                                                         | `RootAssets`, sygnatury bez `lang`                                                        | P3.2b. P3.11 w fali 4 dopisze `printCss` do nowej sygnatury                                                                                                        |
| `src/styles.css`                                                                                                                    | P3.5 (scalone); P3.2b (3, `:31-94`); P3.11 (4); K16 (bez właściciela)                                                                                                                        |                                                                                           | P3.2b tylko blok `@font-face`. Nic więcej w fali 3                                                                                                                 |
| `src/components/Header.tsx`                                                                                                         | P3.2a (4): `:303`, `:341`; P3.1 A (4): `:617-683`                                                                                                                                            | rozłączne                                                                                 | Ta sama partia. Scalać najpierw P3.2a, potem P3.1                                                                                                                  |
| `src/lib/builder/sliderVariants.tsx`                                                                                                | P3.5 (scalone); P3.7a (3): marker `:444`; P3.2a (4): `:384-386`                                                                                                                              | rozłączne                                                                                 | Najpierw P3.7a, potem P3.2a (rebase trywialny)                                                                                                                     |
| `src/lib/builder/heroImage.ts`                                                                                                      | P3.2a (4): `:88-90`; P3.7b (4): `:181`                                                                                                                                                       | rozłączne                                                                                 | Ta sama partia: P3.2a, potem P3.7b                                                                                                                                 |
| `src/routes/index.tsx`                                                                                                              | P3.6b (2); P3.9 (3): `:8`, `:452`; P3.7b (4): T5 `:261`, `:346`, T6 `:171`, `:255`, `:286`, `:389`                                                                                           | rozłączne                                                                                 | Kolejno: P3.6b → P3.9 → P3.7b. P3.7b sprawdza, że predykat kompletności P3.6b nie czyta `heroPreloads`                                                             |
| `src/routes/$.tsx`                                                                                                                  | P3.9 (3): `:172`, `:1796`, `:1816`, `:1881`; P3.7b (4): T6 `:691-706`, `:943-948`; P3.2a: „bez edycji”                                                                                       | rozłączne                                                                                 | Kolejno P3.9 → P3.7b. Zgoda orkiestratora na T6 w `$.tsx` (pytanie P3.7 nr 3): TAK. „Bez edycji” w P3.2a dotyczy tylko jej zakresu                                 |
| `src/router.tsx`                                                                                                                    | P3.8 (2): polityka odświeżania; P3.7b (4): wrappery `:180-214`, `:249-277`                                                                                                                   | rozłączne                                                                                 | P3.7b po P3.8. P3.1 nie edytuje                                                                                                                                    |
| `vite.config.ts`, `vite.smoke.config.ts`, `src/lib/ci/__tests__/viteChunkParity.test.ts`                                            | P3.7a (3): `staticCssPlugin`; P3.1 C (4): `routeEvalYieldPlugin`; P3.11 (4): `surfaceCssPlugin`; **P3.9: nie** (P3.9 §4)                                                                     | listy wtyczek                                                                             | P3.7a w partii 3 jest jedynym edytorem. P3.1 C w partii 4 rebase'uje się na wtyczkę P3.7a, bez równoległej edycji. Odsyłacze w P3.1 i P3.11 do P3.9 są nieaktualne |
| `scripts/performance/documentWeight.ts`                                                                                             | P3.7a (metryka `inlineCssCommentBytes`), P3.2a (SHOULD: 2 metryki), P3.7b (`streamedStateBytes`, `dehydratedQueryHashCount`), zalecenie dla P3.2b (`fontPreloadCount` w `GATED_METRICS`, L3) | addytywnie w `DocumentWeight`, `measure`, `GATED_METRICS` (`:629-660`)                    | Każda pozycja dopisuje swoje pole. Konflikty są tylko tekstowe na liście `GATED_METRICS`                                                                           |
| `scripts/performance/document-weight-budgets.json`                                                                                  | wszyscy (ratchet)                                                                                                                                                                            |                                                                                           | **Jeden właściciel: orkiestrator**, w commicie scalenia partii. Wykonawcy tylko raportują pomiar. Nowe metryki dostają `max` z pomiaru                             |
| `src/components/ContentAreaStyle.tsx`                                                                                               | P3.8 (2); P3.7a S1g (3, opcja)                                                                                                                                                               |                                                                                           | Po P3.8. Zgoda na S1g: TAK, jeśli diff jest ograniczony do markera i stałej `centerMeta`                                                                           |
| `src/components/interests/JoinUsForm.tsx`                                                                                           | P3.8 (2); P3.9 (3)                                                                                                                                                                           | importy, propsy, `cfList`                                                                 | Kolejno. P3.9 zakotwicza się na kodzie, nie na numerach linii                                                                                                      |
| `src/components/header/TrendingTicker.tsx`                                                                                          | P3.5 (scalone); P3.7a marker `:893` (3); P3.7b `lang` `:135-144` (4)                                                                                                                         |                                                                                           | Ta sama pozycja rozbita na dwie partie                                                                                                                             |
| `src/lib/builder/globalColors.ts`                                                                                                   | P3.7a (S1c + S3); P3.2b: jawnie poza zakresem (`:856`)                                                                                                                                       |                                                                                           | P3.7a                                                                                                                                                              |
| `src/components/builder/organisms/widget-view/SearchButtonWidget.tsx`                                                               | P3.7a (marker `:206`); P3.2b poza zakresem; przyszłe P7.5 (`:25`)                                                                                                                            |                                                                                           | P3.7a                                                                                                                                                              |
| `src/components/builder/organisms/widget-view/PostListView.tsx`                                                                     | P3.7b (`:140`, `:190`, `:456`); P3.2a zmienia stałe `POST_LIST_*` w `widgetImageSizes.ts` (konsumowane w `:44`, `:555`, `:591`)                                                              | sprzężenie semantyczne, nie tekstowe                                                      | P3.7b po P3.2a. Testy `sizes` post-listy uruchomić po obu                                                                                                          |
| `src/components/molecules/PostListCard.tsx`                                                                                         | P3.10 S5 (5); P3.9: cel scalenia chunku `FooterSlideupSlot`                                                                                                                                  |                                                                                           | P3.10 S0 musi powtórzyć `p39-graph-check.py` po S5, bo zmiana rozmiaru modułu może przesunąć scalenie                                                              |
| `src/assets/fonts/red-hat-display-latin-ext.woff2`                                                                                  | P3.2b: zostaje jako twarz bez preloadu; P3.10 S12: usuń, jeśli martwy                                                                                                                        |                                                                                           | Właściciel P3.2b. S12 w P3.10 będzie no-opem (odwołanie zostaje w `styles.css`), więc to tylko kontrola                                                            |
| `src/lib/ci/woff2Tables.ts` (nowy, P3.2b), `src/lib/css/minifyStaticCss.ts` (nowy, P3.7a), `pickI18n` w `customFieldDefs.ts` (P3.9) | P3.10 (knip, TEST-ONLY, martwe eksporty)                                                                                                                                                     |                                                                                           | P3.10 S0 ma je jawnie wykluczyć (moduły celowo tylko testowe lub skryptowe), inaczej knip je „wykryje”                                                             |
| `src/routes/library.tsx`                                                                                                            | P3.10 S7 (5); P3.11 `head().links` (fala 4)                                                                                                                                                  |                                                                                           | Kolejno                                                                                                                                                            |
| `src/lib/crm/profileSyncView.ts`                                                                                                    | P3.10 S7 pkt 8                                                                                                                                                                               | **moduł w chunku wejściowym** (inwentarz)                                                 | Wyjąć z S7 albo udowodnić Δ raw ≤ 0 (L11)                                                                                                                          |

## 3. Budżety: bilans i ryzyko

### 3.1 Stan (pomiar, nie szacunek)

| Metryka                      |      Próg | Baza partii 1 (P3.5-base) | Po P3.3 (worktree) | Zapas po P3.3 |
| ---------------------------- | --------: | ------------------------: | -----------------: | ------------: |
| `bootClosureRawBytes`        | 1 637 758 |                 1 634 852 |          1 637 603 |     **155 B** |
| `bootClosureGzipBytes`       |   496 679 |                   495 036 |            496 332 |     **347 B** |
| `bootBurstGzipBytes`         |   574 673 |                   572 652 |            574 350 |     **323 B** |
| `bootBurstCount`             |        26 |                        26 |                 26 |         **0** |
| `headRawBytes`               |    29 345 |                    28 985 |             28 758 |         587 B |
| `renderBlockingCssGzipBytes` |    81 399 |                    80 395 |             80 426 |         973 B |
| `check:bundle` css łącznie   |     96 KB |                         — |            95,0 KB |    **1,0 KB** |
| `check:bundle` public CSS    |     83 KB |                         — |            81,2 KB |        1,8 KB |
| `check:bundle` overall       |   4772 KB |                         — |          4754,7 KB |       17,3 KB |

Z P3.5 wynika, że baza partii 1 na scalonej głowie ma ok. 653 B zapasu gzip (to „0,6 KB” z zadania). P3.3 zjada z tego
około połowę, a P3.8 (bramki w `__root.tsx`, wejście) i P3.6b jeszcze nie są zmierzone. **Orkiestrator musi zmierzyć
głowę po partii 2, zanim ruszy partia 3.**

### 3.2 Gdzie leżą zmieniane moduły (inwentarz `base-w3b`)

W chunku wejściowym `index-c_XR_U82.js` leżą: `cropSizes.ts`, `OptimizedImage.tsx`, `imageSlot.ts`,
`widgetImageSizes.ts`, `mediaWidgets.tsx`, `Header.tsx`, `consent.ts`, `TrendingTicker.tsx`, `router.tsx`,
`interactionOrQuiet.ts`, `reducedMotion.ts`, `i18n/format.ts`, `profileSyncView.ts` i `designTokens.ts`.
Poza wejściem: `themeDesign.ts` (`themeDesignCss`), `globalColors.ts` (`designTokensCss`), `sliderVariants.tsx`,
`heroImage.ts` (`archive-layout-settings`), `PostListCard.tsx`, `FooterSlideup.tsx` (`blog.index`).

### 3.3 Bilans pozycji (gzip / raw w domknięciu bootu)

| Pozycja                             |              Δ gzip |                               Δ raw | Źródło                                        |
| ----------------------------------- | ------------------: | ----------------------------------: | --------------------------------------------- |
| P3.7a (S1: `TICKER_CSS`)            |        **−1 281 B** |                        **−4 920 B** | P3.7 §3.1 [Z]; moduł w wejściu potwierdzony   |
| P3.2b                               |                   0 |                                   0 | generator poza wejściem (potwierdzone)        |
| P3.9                                | 0 (awaryjnie +~300) |                                   0 | prognoza Rollupa, bramka `p39-graph-check.py` |
| P3.2a                               | ≤ +300 (limit spec) | **nie liczono** (szac. +0,6…1,0 KB) | 6 zmienianych modułów w wejściu               |
| P3.7b (T1 `expand*` w `router.tsx`) |            +250…350 |                   szac. +0,7…1,0 KB | P3.7 §0                                       |
| P3.1 A+B (+C)                       |      +120…320 (+~0) | **nie liczono** (szac. +0,4…1,0 KB) | P3.1 §7                                       |
| P3.10                               |         ≤ 0 (wymóg) |                         ≤ 0 (wymóg) | ryzyko w S7 pkt 8 (L11)                       |

Wniosek: bez P3.7a przed P3.2a i P3.1 suma przekracza zapas raw 155 B już przy pierwszej pozycji. Z P3.7a na początku
partii 3 zapas rośnie do ok. 5 KB raw i 1,6 KB gzip, co mieści P3.2a, P3.7b i P3.1. Każda specyfikacja musi dopisać
**limit Δ raw** obok limitu gzip (proponuję: P3.2a ≤ +1,2 KB raw, P3.1 ≤ +1,0 KB raw, P3.7b ≤ +1,0 KB raw) i
**pomiar po każdym scaleniu w kolejności z §6**.

### 3.4 CSS

- Suma `css` w `check:bundle` ma 1,0 KB zapasu. P3.2b dokłada +250 B gz do `styles.css`, a P3.7 S3 ok. +450 B gz do
  `admin-styles.css`. Razem zostaje ok. 0,3 KB. P3.7 pisze o „`public CSS` bez zmian”, ale pomija sumę. Trzeba to
  dopisać do dowodu P3.7a i rozważyć, czy S3 nie odda części bajtów przez S1 (reguły trafiają do arkusza po
  minifikacji lightningcss, więc są mniejsze niż szacunek z literału).
- `renderBlockingCssGzipBytes`: P3.2b +250 B przy zapasie 973 B. OK.

## 4. Luki (zgłoszenia do poprawy specyfikacji)

- **L1 [budżet, krytyczne]** `bootClosureRawBytes` pominięty we wszystkich specyfikacjach. Zapas po P3.3 to 155 B.
  Naprawa: kolejność z §6 i limity Δ raw z §3.3.
- **L2 [budżet]** Suma `css` (1,0 KB zapasu) pominięta w P3.7 (S3) i P3.2b. Naprawa: pomiar sumy w dowodzie obu pozycji.
- **L3 [decyzja właściciela: jeden font, brak bramki]** `fontPreloadCount` jest liczony (`documentWeight.ts:273`,
  `:595`), ale nie ma go w `GATED_METRICS` (`:629-660`) ani w progach. Do tego CMS ma ścieżkę na drugi krój na stronach
  publicznych: `customFonts.ts:58` → `designTokens.ts:228` (`@font-face` z `site_design_tokens.fonts.custom[]`) oraz
  `--brand-font-heading/body` (`designTokens.ts:224-225`), które nadpisują `--font-display` (`styles.css:258-264`). Dziś
  na produkcji są puste. Naprawa w P3.2b:
  - `fontPreloadCount` w `GATED_METRICS` z `max: 1`;
  - asercja e2e/LH „dokładnie jedno żądanie `woff2` na `/` PL i EN”, która już jest w §11.3, przeniesiona do testu
    `test:e2e:performance`, żeby nie zależała od jednorazowego pomiaru;
  - pytanie W7 do właściciela, czy blokować kroje z CMS.
- **L4 [P3.7 T4b, sprzeczność]** P3.7 opiera się na tym, że `currentLang()` jest per żądanie (prawda:
  `localeRuntime.ts:112-123`). Komentarz w `headerTickerQuery.ts:95-103` mówi, że rozgrzewka w korzeniu „musi złożyć
  klucz z językiem ŻĄDANIA, bo `currentLang()` po stronie serwera nie jest bezpiecznym źródłem”. Naprawa: P3.7b
  aktualizuje komentarz i dodaje test parytetu klucza SSR/klient dla strony bez prefiksu z ciasteczkiem `en`
  (`readLangCookieFromHeader` kontra `clientLocale`).
- **L5 [P3.7 X1, dowód]** Węzeł 22 nie ma `URLPattern`, więc test semantyczny jest `skipIf` i zostaje tylko pomocnik
  rozwijający grupy. Naprawa: macierz 4 × 17 (plus negatywy `/administrator`, `/en/adminx`) sprawdzona w Chromium
  (Playwright `page.evaluate(new URLPattern(...))`) w istniejącym e2e. Bez nowej zależności.
- **L6 [P3.2a, dowód]** Fixture nie ma ani jednego `srcset` (`fixture.invalid`), więc wybór 640w udowadnia tylko
  reimplementacja Blinka w teście. Naprawa: e2e na artefakcie z przechwyceniem `**/media/**` (Playwright `route`),
  412×823 @1,75: żądany dokładnie `width=640` i jedno żądanie okładki. Ewentualnie fixture z kanonicznym `/media/…`.
- **L7 [P3.2a, założenie]** Margines 32 px zmierzono na hero w sekcji 0 (`lcp-breakdown`). Sekcje wewnętrzne mają
  `INNER_SECTION_SAFE_AREA_PX = 12` i `COLUMN_SAFE_AREA_PX = 12` (`sectionStyles.tsx:45-46`), więc tam realny margines
  jest inny. `sizes` to tylko podpowiedź (jakość, nie układ), ale specyfikacja powinna to nazwać i ograniczyć test
  pochodzenia stałej do sekcji głównego renderera.
- **L8 [P3.2b, nieścisłość]** „Zestaw kodów = dokładnie cmap dzisiejszego latin + 18 polskich liter”: dzisiejszy
  `latin.woff2` ma U+0102 (Ă), a nowy plik go nie ma (sprawdzone `fontTools`). Skutek zerowy, bo `unicode-range`
  kieruje U+0102 do latin-ext dziś i po zmianie. Poprawić zdanie i dopisać przypadek do testu §9.2 pkt 2.
- **L9 [P3.2b, kontynuacja]** `--brand-font-*` (`designTokens.ts:224-225`) bez normalizacji fallbacku: gdy najemca
  ustawi RHD bez `"Red Hat Display Fallback"`, CLS wraca dla wszystkiego, co czyta `--font-display`. Zostawione
  świadomie (wejście, budżet). Potrzebna osobna pozycja po P3.7a (wtedy budżet pozwala).
- **L10 [odsyłacze]** P3.1 §6 i P3.11 §6.8 zakładają, że P3.9 edytuje `vite*.config.ts`, a P3.1 §4.2 przypisuje
  `i18n.ts` do P3.9. P3.9 §4 zostawia konfiguracje nietknięte i nie rusza `i18n.ts`. Poprawić zależności.
- **L11 [P3.10 S7, budżet]** `profileSyncView.ts` leży w chunku wejściowym, więc statyczny import nowego
  `formatBytes.ts` wciągnie kanon do wejścia z konstrukcji, a nie przez scalanie małych chunków. Naprawa: wyjąć pkt 8 z
  S7 albo wykazać Δ raw ≤ 0 (usunięta kopia kontra kanon + `formatNumber`, które już jest w wejściu).
- **L12 [P3.10, knip]** Nowe moduły celowo testowe lub skryptowe z partii 3–4 (`woff2Tables.ts`, `minifyStaticCss.ts`)
  oraz `pickI18n` przeniesiony przez P3.9 muszą być na liście wykluczeń S0 i S2, inaczej „TEST-ONLY” je usunie.
- **L13 [P3.1 A, dowód]** E2E kotwicy tylko 1350 px. Na mobile domyślna wartość CSS 123 px różni się od zmierzonej
  (fixture 107 px), więc pierwszy klik w kotwicę przed ciszą też ląduje z przesunięciem 16 px. Dodać przypadek
  412 px.
- **L14 [P3.7 S3, kaskada]** `admin-styles.css` przechodzi przez lightningcss (`minify`), który według samego P3.7 §3.1
  potrafi scalić deklaracje. Przeniesione reguły nie są już inline, tylko w arkuszu po transformacji. Sondę wizualną
  admina (5 stylów × 2 motywy) trzeba uzupełnić o porównanie `getComputedStyle` elementów `[data-sidebar]` przed i po.
- **L15 [zakres]** Pliki spoza list PLAN-FALI-3 wymagają zgody orkiestratora:
  - P3.2a: `Header.tsx`, `mediaWidgets.tsx`, `PostContextViews.tsx`, nowy `headerChromeContext.ts`;
  - P3.2b: `themeDesign.ts`, `__root.tsx`, `e2e-performance/font-swap-cls.spec.ts`;
  - P3.7: `$.tsx` (T6).

  Rekomenduję zgodę na wszystkie, bo każdy ma uzasadnienie `plik:linia` i rozłączny region.

- **L16 [bez właściciela]** K16/PB7 (mobile, 880 el., ok. 137 ms sym. na produkcji, `BuilderRenderer.tsx:357-405` +
  `styles.css:1858-2982`) i P7.5 (jawna mapa ikon chrome'u, domknięcie bootu −8…−11 KB gz) nie mają pozycji. P7.5 to
  jedyna duża, trwała ulga budżetu bootu w zasięgu.
- **L17 [P3.9, pewność]** Miejsce scalenia komponentu `/blog` to prognoza z marginesem ok. 3 KB. Bramka i plan awaryjny
  istnieją (`p39-graph-check.py`, kontrola negatywna 34 naruszenia). `bootBurstCount` 26/26 bez zapasu, więc wynik
  musi być ≤ 26 w pomiarze, a nie w prognozie. Bez zmian w specyfikacji, tylko twardy warunek scalenia.

## 5. Zgodność z decyzjami właściciela i AGENTS.md

| Decyzja                                                               | Status                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jeden font w ścieżce krytycznej: Red Hat Display (latin + PL, oś wag) | **Spełnione przez P3.2b**: jeden plik `latin-pl` (oś `wght` 300–900 zachowana, sprawdzone), latin-ext bez preloadu dla innych diakrytyków, fallback wyłącznie `local()` (bez pobrań). Żadna inna pozycja nie dodaje kroju: P3.7 zostawia napisy `"Red Hat Display"` w literałach dosłownie (test niezmienności napisów), P3.10 S12 tylko weryfikuje. Brak bramki: L3 |
| Awatary bez zmian                                                     | **Spełnione**. P3.2a przypina awatar autora (`PostContextViews.tsx:203-208`) do starej drabiny i absolutnego URL-a. Awatary przez `buildAvatarSrc`/`buildAvatarSrcSet` zostają. P3.7 T4a/T4b nie rusza `author_avatar_url` (`headerTickerQuery.ts:104-114`). Otwarte: `SpeakersWidget.tsx:647-653` (W2)                                                              |
| `~flock.js` zostaje                                                   | Spełnione (nikt go nie dotyka)                                                                                                                                                                                                                                                                                                                                       |
| Zero nowych zależności npm                                            | Spełnione. P3.2b: `fonttools` w venv poza repo. P3.10: `npx -y bun@1.2.23` poza `package.json`, wyłącznie usunięcia                                                                                                                                                                                                                                                  |
| Typografia i geometria wspólne dla light/dark                         | P3.2a: eager tylko jasne logo, geometria `<picture class="contents">` bez zmian. P3.2b: fallback niezależny od motywu. P3.11 ma test parzystości (fala 4)                                                                                                                                                                                                            |
| Kinetic Signal Notch, TOC z geometrii, audio na wspólnych atomach     | Nienaruszone. P3.10 usuwa `ArticleListenButton` (0 importerów), a atom `MorphPlayPause` zostaje. P3.10 S6 zmienia tylko encję apostrofu w `manualToc.ts:100`, a nie mechanizm aktywności TOC                                                                                                                                                                         |
| Progi tylko w dół                                                     | Wszystkie specyfikacje to deklarują. Ryzyko złamania jest realne (§3), stąd zmiana kolejności                                                                                                                                                                                                                                                                        |

## 6. Proponowana kolejność partii (maks. 3 pozycje równolegle, P3.10 ostatnia)

Warunek wejścia: partia 2 scalona i **zmierzona** (`check:document-weight` i `check:bundle` na głowie). Jeśli zapas
raw albo gzip jest ≤ 0, partia 3 zaczyna się od P3.7a scalonego samodzielnie.

| Partia | Pozycje (równolegle)                                                                                                             | Kolejność scalania                     | Uzasadnienie                                                                                                                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3**  | **P3.7a** (S1 z S1a–S1e i opcjonalnie S1g, S3, wtyczka i testy, metryka `inlineCssCommentBytes`), **P3.2b**, **P3.9**            | P3.7a → P3.2b → P3.9; pomiar po każdym | P3.7a daje ulgę bootu (−4,9 KB raw, −1,28 KB gz) i jest jedynym edytorem konfiguracji Vite w fali 3. P3.2b i P3.9 nie mają z nim wspólnych plików. P3.2b przed P3.9, bo nie zmienia wejścia. Ratchet: orkiestrator               |
| **4**  | **P3.2a**, **P3.7b** (T1, T2, X1, T4a/b, T5, T6, `streamedStateBytes`, `dehydratedQueryHashCount`), **P3.1** (A, B; C warunkowo) | P3.2a → P3.7b → P3.1; pomiar po każdym | `Header.tsx`: P3.2a przed P3.1. `heroImage.ts`: P3.2a przed P3.7b. `index.tsx`/`$.tsx`: P3.7b po P3.9 z partii 3. P3.1 C rebase'uje się na wtyczkę P3.7a, bez równoległej edycji. P3.1 korzysta z księgi partii 1–3 i z T1 (PB2) |
| **5**  | **P3.10** (sama; opcjonalnie nowa pozycja P7.5 równolegle, jeśli zatwierdzona i rozłączna plikowo)                               | S0 z wykluczeniami z L11 i L12         | Martwy kod ostatni, po rebase i ponownej weryfikacji `reverify.sh`                                                                                                                                                               |
| fala 4 | P3.11 (warunki §7), K16, T3 (menu publiczne), normalizacja `--brand-font-*` (L9)                                                 |                                        |                                                                                                                                                                                                                                  |

Wariant zachowawczy, jeśli orkiestrator chce trzymać P3.2a w partii 3: P3.7a jako czwarta, wcześniejsza mini-partia
(3a) scalona przed startem P3.2a. Bez P3.7a P3.2a w partii 3 nie spełni `bootClosureRawBytes`, chyba że P3.8 coś zwolni,
czego nikt nie zmierzył.

## 7. P3.11: rekomendacja

**NO-GO w fali 3.** Zysk to +0,3…+0,5 pkt mobile i ≈ 0 desktop, poniżej MDE. Nakład ok. 7 dni. Potrzebna jest zmiana
kontraktu sumy `css` (dziś 1,0 KB zapasu, podział dokłada +5…6 KB łącznie), fixture'y klubu i profilu, których nie ma,
oraz audyt `advanced.cssClass`. Do tego P3.11 koliduje z P3.10 (graf importów) i P3.2b (`rootHead.ts`, `@font-face`).
Samego arkusza druku też nie robić (`publicCss` wzrośnie o ok. 1 KB bez zmiany kontraktu).

**Fala 4: GO** po spełnieniu warunków z P3.11 §8:

1. P3.10 scalone;
2. właściciel zatwierdza zmianę kontraktu `check:bundle`: linia render-blocking z ratchetem w dół, suma `css` podniesiona
   o zmierzony narzut z kroniką;
3. audyt `advanced.cssClass` i `class=` z bazy;
4. fixture'y klubu i profilu;
5. HW-1 zaplanowane jako konsument zapasu `publicCss`.

## 8. Pytania wyłącznie do właściciela

- **W1 (P3.1 A).** Czy akceptujesz jednorazowe przeliczenie stylu dokumentu (ok. 40 ms obs. na hoście LH desktop) przy
  PIERWSZYM kliknięciu kotwicy albo Tab przed „ciszą”, w zamian za usunięcie tego kosztu z bootu każdej wizyty?
- **W2 (P3.2a, awatary).** Awatar autora w bloku kontekstu wpisu (`PostContextViews.tsx:203-208`) jest traktowany jako
  awatar, więc zostaje bez zmian: potwierdzasz? Zdjęcia prelegentów w kartach 4:3 (`SpeakersWidget.tsx:647-653`):
  awatar (przypiąć, bez zmian) czy obraz redakcyjny (nowa drabina)?
- **W3 (P3.2a).** Logo desktopowe eager: tylko wariant jasny (0 B więcej w jasnym motywie) czy oba (+6,6 KB na desktopie)?
- **W4 (P3.2a, HW-4).** Czy akceptujesz, że telefony DPR 3 dostaną 768w (gęstość ok. 2,3×) zamiast 1024w, a retina
  full-bleed skończy się na 1920w zamiast 2400w?
- **W5 (P3.2b).** Czy przyciąć oś wag do 400–900 (plik 24,3 KB zamiast 31,1 KB, −6,8 KB, szerokości identyczne)? To
  nadal ten sam krój Red Hat Display ze zmienną osią, ale bez wag 300–399, których dziś i tak nie używa żadna twarz.
- **W6 (P3.2b).** Czy jednorazowo poprawić w CMS stos `fontFamily` w `theme_design` (postTitle, postExcerpt) na stos z
  fallbackiem? Kod naprawia to niezależnie, poprawka danych porządkuje panel.
- **W7 („jeden font”).** Czy decyzja „jedynym fontem jest Red Hat Display” ma obowiązywać całą platformę na stałe, czyli
  czy zablokować kroje z CMS na stronach publicznych (`customFonts` → `@font-face` w `designTokens.ts:228`,
  `--brand-font-*`), czy tylko pilnować obecnej konfiguracji bramką `fontPreloadCount ≤ 1` i testem jednego żądania
  `woff2`?
- **W8 (P3.10).** `CopyrightBar.tsx` (linki prawne: zwroty, cookies, RODO; komentarz `:13-14` mówi o wymogu operatora
  płatności) nie jest dziś montowany, a na produkcji `/` brak tych linków. Podłączyć (osobne zadanie) czy usunąć?
- **W9 (P3.10).** Toasty nowych wiadomości czatu (`useIncomingChatToasts`) dziś nie działają, bo montował je tylko
  nieużywany `ChatBell`. Podłączyć w `WorkspaceDock` czy uznać za wycofane?
- **W10 (P3.10 S7).** Czy akceptujesz ujednolicony format rozmiaru plików w panelu, czacie, klubach, `/library` i
  profilu („kB”, przecinek w PL, maks. 1 miejsce po przecinku)?
- **W11 (P3.11).** Czy zatwierdzasz warunki fali 4, w tym zmianę kontraktu `check:bundle` (suma `css` +ok. 6 KB z
  kroniką, osobna linia render-blocking w dół) i jednorazowy audyt klas z CMS?
- **W12 (nowe pozycje).** Czy tworzymy osobne pozycje dla:
  - K16 (mobile, ok. 137 ms sym. na produkcji; ryzyko wizualne, sonda 390/820/1350 px);
  - P7.5 (domknięcie bootu −8…−11 KB gz, trwała ulga budżetu)?

  Proponowane terminy: P7.5 w partii 5, K16 w fali 4.

Decyzje orkiestratora (nie właściciela), które rekomenduję:

- TAK dla S1g po P3.8;
- T3 poza P3.7;
- TAK dla T6 w `$.tsx`;
- zgoda na rozszerzenia list plików z L15;
- jeden właściciel progów `document-weight-budgets.json`;
- pomiar głowy po partii 2 przed startem partii 3.
