# P3.7b (fala 3, partia 4a) - IMPL: dieta stanu dokumentu

- Worktree: `$SCRATCH/wt3/P3.7b`, gałąź `perf/w3-P3.7b`, baza `64dddffe` (integ/w3-tip3).
- Commit: `aaf54740` „Wydajność PSI 85/95, fala 3: P3.7b dieta stanu dokumentu - kompaktowa koperta zapytań, zajawki tylko renderowane, pasek z językiem w kluczu, krótsze speculation rules”.
- Zakres (notatka orkiestratora): T1, T2, X1, T4a/T4b, T5, T6, metryki `streamedStateBytes` i `dehydratedQueryHashCount`. Bez T3 (fala 4), bez S1/S3/S1g (P3.7a, scalone), bez konfiguracji Vite.
- `$SCRATCH` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad`.

## 1. Co się zmieniło i dlaczego (plik po pliku)

### T1 - kompaktowa koperta zapytań

- **`src/lib/ssr/dehydratedQueryEnvelope.ts` (nowy, czysty).**
  - `DEFAULT_SUCCESS_STATE` (zamrożony ogon stanu sukcesu query-core 5.101.2).
  - `compactDehydratedState`: nowe obiekty zapytań (wejście NIE jest mutowane - integracja trzyma hashe oryginałów w `sentQueries`); `queryHash` znika tylko, gdy `=== hashKey(queryKey)`; ze `state` znikają tylko pola `Object.is`-równe stałej; `data` zostaje tą samą referencją (seroval dalej emituje `$R[n]` dla danych współdzielonych z loaderem); pusta lista `mutations` też znika (`hydrate` czyta `mutations || []`). Wartość innego kształtu wraca bez zmian.
  - `expandDehydratedState`: `queryHash ?? hashKey(queryKey)`, `state = {...DEFAULT_SUCCESS_STATE, ...state}`, `mutations ?? []`. Pełna koperta (dokument sprzed zmiany) przechodzi bez zmian treści.
  - `mapQueryStream`: strumień na `pull` z czytnikiem źródła (koniec, błąd i `cancel` przechodzą dalej). Bez `TransformStream` - konstruktor z transformerem JS w Workers zależy od daty zgodności, a `pull` działa identycznie w Workers, przeglądarce i Node.
  - `expandRouterDehydrated`: nowy ładunek z rozwiniętą barierą i strumieniem rozwijającym każdą porcję; wejście bez tych pól wraca tą samą referencją.
- **`src/router.tsx`** (tylko wrappery (de)hydratacji; polityka `refetchOnMount` P3.8, `shouldDehydrateQuery` i literał `setTimeout(0)` nietknięte):
  - serwer: `queryStream = mapQueryStream(guardQueryStream(...), compactDehydratedState)` - kompaktowanie ZA strażnikiem (strażnik dostaje surowy strumień integracji, test), `dehydratedQueryClient = compactDehydratedState(...)`;
  - klient: `integrationHydrate?.(expandRouterDehydrated(dehydrated))` wewnątrz `withHydrateBudget`.
  - Gałąź serwerowa jest wycinana z bundla klienta (`isServer` stałe) - sprawdzone na bazie: `guardQueryStream` nie występuje w żadnym chunku klienta; do klienta trafia tylko ścieżka `expand*`.

### T2 - zajawki tylko tam, gdzie widget je renderuje

- **`src/lib/builder/postListExcerpt.ts` (nowy, czysty):** `postListExcerptToggle` (semantyka widoku `getStr(c,"showExcerpt") !== "0"`), `postListRendersExcerpt(c, surface)`, `excerptFrameBool` (kopia 1:1 `frame.getBool`, test równoważności).
- **`src/lib/builder/postListQuery.ts`:** `PostListInput.withExcerpt` (ostatnie pole), `postListInput(c, lang, surface = "list")`, `postListQueryOptions(c, lang, surface)` z WYMAGANYM `surface`; cache brzegowy (`edgeTtlCache`) i `fetchPostListRows` dostają wejście BEZ `withExcerpt`; `localizePostListRows(rows, lang, withExcerpt = true)` przy `false` zdejmuje oba klucze `excerpt_*`.
- **`src/lib/builder/sliderPostsQuery.ts`:** `sliderShowsExcerpt(c)` (= `asBool(c.showExcerpt, true)` widoku), `SliderPostsInput.withExcerpt`, klucz cache brzegowego bez niego, `localizeSliderPostRows(rows, lang, withExcerpt = true)`. Sygnatura `sliderPostsQueryOptions(c, lang)` bez zmian (prefetch slidera i `heroImage.ts:113` bez edycji).
- **`PostListView.tsx`:** `showExcerptGlobal = postListExcerptToggle(c)`, zapytanie z `carousel ? "carousel" : "list"`, `numbered` przez `postListRendersExcerpt(c, "list")` (równoważne `getBool` w tej gałęzi).
- **`PostsSliderWidget.tsx`:** `showExcerpt = sliderShowsExcerpt(c)`.
- **`prefetch.ts`** (`widgetQueryOptionsList`, `widgetCacheTargets`) i **`heroImage.ts`** (`postListPreload`, jedna instrukcja): `widget.type === "carousel" ? "carousel" : "list"`.

### X1 - speculation rules

- **`src/lib/seo/speculationRules.ts`:** `denyPatterns()` = jeden wzorzec na prefiks `/{en/}?<prefiks>{/*}?` (zaczyna się od `/`). JSON 2 334 -> 1 204 B.
- Semantyka (KRYTYKA L5) sprawdzona poza vitest (Node 22 nie ma `URLPattern`): macierz 17 prefiksów x 32 warianty ścieżki (551 ścieżek, 170 trafień) - dawne 68 wzorców vs nowe 17 dają **0 różnic** w Chromium 141 (Playwright, przez mutex) i w Bun. Narzędzia: `$SCRATCH/phase3/wave3/P3.7b/tools/urlpattern-{matrix,bun,chromium}.mjs`, wynik `urlpattern-chromium.log`.

### T4a/T4b - pasek trendów

- **`src/lib/views/headerTickerQuery.ts`:**
  - `headerTickerQueryOptions(cfg, lang = currentLang())`; klucz `["header_ticker", źródło, lang, dni, limit, przypinka, wybór, dopełnienie]` - język PO źródle, żeby etykieta zapytania w linii logu dokumentu (`queryLabel`, dwa wiodące napisy) została `header_ticker.<źródło>`;
  - `projectHeaderTickerPosts(rows, lang)`: tytuł języka klucza z łańcuchem `itemTitle` (`<lang> || <drugi> || ""`), pole drugiego języka zdjęte, `slug` tylko przy wierszu bez `href` (T4a);
  - `placeholderData: keepPreviousData` (miękka zmiana języka nie zapada paska);
  - KRYTYKA L4: komentarz sprostowany - `currentLang()` na serwerze jest per żądanie (`localeRuntime.ts`), więc rozgrzewka w `__root.tsx` i `peekHeaderTickerPosts` wołają bez `lang` i trafiają w ten sam klucz co `TrendingTicker` (klon i18n żądania ma język `currentLang()`). `__root.tsx` bez edycji.
- **`src/components/header/TrendingTicker.tsx`:** `headerTickerQueryOptions({...}, lang)` jawnie; `TickerItemProps.post.title_pl/title_en` opcjonalne (typ wiersza z jednym tytułem). Marker `@nes-static-css` i bramka ruchu nietknięte.

### T5 - `seoSettings` jako ta sama referencja

- **`src/routes/index.tsx`** i **`src/routes/$.tsx`:** loader zwraca surowe `settings.seo` (typ `unknown`, ten sam obiekt co w danych zapytania `site_settings_public`), `head()` robi `parseSeoSettings(loaderData.seoSettings ?? null)` - wynik bajtowo ten sam (test JSON-LD). W `$.tsx` też (opcja planu): dotyczy każdego artykułu.

### T6 - `heroPreloads` poza ładunkiem routera

- **`src/lib/builder/heroPreloadStore.ts` (nowy):** `WeakMap<QueryClient, readonly LcpImagePreload[]>` (wzorzec `routeSsrDeadline.ts`/`chromeWarmup.tsx`), `rememberHeroPreloads`, `heroPreloadsFor` (odczyt bez hooka), `useHeroPreloads()` (`useQueryClient()`, na kliencie zawsze `undefined`).
- **`index.tsx`, `$.tsx`:** loader pod `isServerRender()` zapisuje listę w magazynie (i jak dotąd emituje `Link`), nie zwraca jej; komponent: `usePreloadLcpImages(useHeroPreloads())`. Typy `DegradedDocument`/`ResolvedDocument` w `$.tsx` bez `heroPreloads` (zgoda orkiestratora na `$.tsx`: TAK).
- **KRYTYKA (predykat P3.6b):** `trackSsrQueryCompleteness` czyta wyłącznie cache zapytań (`getAll()`, stan, `fetched`), nie dane loadera i nie klucze po nazwie (etykieta z dwóch wiodących napisów). Ani `heroPreloads`, ani zmienione klucze (`withExcerpt`, język paska) go nie dotyczą. Test w `homeRoute.test.tsx`: strona główna z kandydatem LCP na serwerze -> predykat `{complete: true, reasons: []}`, czyli nadal trafia do cache dokumentu.

### Metryki (krok 9, część T)

- **`scripts/performance/documentWeight.ts`:** `streamedStateBytes` (inline `<script>` wykonywalne poza barierą, z `$R["tsr"]`), `dehydratedQueryHashCount` (`queryHash:` w barierze i strumieniu); obie w `DocumentWeight`, `analyzeDocument` i `GATED_METRICS`. `check-document-weight.ts` (poza listą) bez zmian - nowe metryki są w tabeli bramek.
- **`scripts/performance/document-weight-budgets.json`:** TYLKO nowe klucze + akapit `_comment`. Pomiar bazy `64dddffe` (`base-w3g`, 3 próbki HIT, kod metryk z tego worktree, `base-dw-new-metrics.json`): `streamedStateBytes` 10 351 B, `dehydratedQueryHashCount` 21. Progi: `streamedStateBytes` max 10 559 (= ceil(baza x 1,02), tymczasowo - nie gorzej niż baza), `dehydratedQueryHashCount` max 0. Istniejące progi bez zmian.

## 2. Testy (nowe i zmienione)

- Nowe: `src/lib/ssr/__tests__/dehydratedQueryEnvelope.test.ts` (round-trip na prawdziwym `dehydrate()`: sukces, `dataUpdateCount` 2, `meta`, zapytanie nieskończone, błąd po danych, klucz z obiektem; identyczny cache po `hydrate`; porcja po zamontowaniu obserwatora + KONTROLA NEGATYWNA bez rozwinięcia gubi dane; własny `queryKeyHashFn`; referencja `data`; idempotencja i brak mutacji; strumień i prawdziwa integracja router<->query), `src/lib/builder/__tests__/postListExcerpt.test.ts` (tabela 12 wariantów x 14 wartości x 2 powierzchnie, równoważność z `frame.getBool`, klucze), `src/components/header/__tests__/TrendingTicker.langSwitch.test.tsx` (miękka zmiana PL->EN z zawieszoną odpowiedzią EN: brak rezerwy, poprzednie wpisy stoją; mutacja „bez `keepPreviousData`” czerwieni test - sprawdzone), `src/lib/ci/__tests__/documentWeightState.test.ts`.
- Zmienione: `router.test.tsx` (kompaktowanie bariery i strumienia ZA strażnikiem; rozwinięcie przed hydratacją integracji), `localizedPostRowsParity.test.tsx` (kontrakt bezpieczeństwa T2: 10 wariantów x 6 wartości x {lista, karuzela} - znacznik z wierszy zrzutowanych = z pełnych, a przy predykacie fałszywym pełny wiersz też nie daje `.cms-post-excerpt`; slider z wyłączoną zajawką), `dehydratedPayload.test.ts` (zakaz `excerpt_*` w zapytaniach widgetów bez zajawki - na fixture wszystkie 7; pasek PL/EN z jednym tytułem, bez `slug`), `headerTickerQuery.test.ts` (klucz z językiem, projekcja PL/EN, T4a, `keepPreviousData`, parytet klucza SSR/klient dla strony bez prefiksu z ciasteczkiem `en` - KRYTYKA L4), `speculationRules.test.ts` (`expandUrlPatternGroups` = dawne 4 x 17; test URLPattern `skipIf`), `homeRoute.test.tsx` (T5 tożsamość referencji + JSON-LD bajtowo równy, T6 magazyn + predykat kompletności), `publicCatchAllRoute.test.tsx` (T6 przez `heroPreloadsFor`, T5 tożsamość + `twitter:site` z surowego `seo`), `sectionPrefetch.test.ts` (klucz rejestru = klucz widoku dla `post-list` i `carousel`), `sliderPostsLangKey.test.ts` (`withExcerpt`); mechanicznie trzeci argument `surface` w `heroImage.test.ts`, `postListQueryData.test.ts`, `postListOrdering.test.ts`, `uniqueOnPageDedup.test.ts`, `widgetTaxonomyRequestLine.test.ts`, `localizedQueryKeys.gate.test.ts`.

## 3. Bramki

| Bramka                                                                              | Wynik                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bunx prettier --write` (dotknięte pliki)                                           | OK                                                                                                                                                                                                                                                                    |
| `light.sh bunx eslint` (dotknięte `.ts/.tsx`)                                       | 0 błędów, 8 ostrzeżeń `react-refresh` sprzed zmiany                                                                                                                                                                                                                   |
| typecheck (`typecheck-noinc.sh`: tsgo + tsc scripts + tsgo e2e, przez mutex)        | runda 1: 5 błędów typów w nowych testach; po poprawce runda 2 **zielona** (`typecheck2.log.exit` = 0)                                                                                                                                                                 |
| `light.sh bunx vitest run` (celowane)                                               | końcowy przebieg: **43 pliki, 1 315 testów zielonych** (+5 expected fail, 1 skip URLPattern), `vitest-final.log`; wcześniej zielone także ok. 30 plików pokrewnych (widoki widgetów, nagłówek, panel paska, `rootRoute`, `documentCompleteness*`, `queryStreamGuard`) |
| `light.sh bun run verify:static`                                                    | **zielony** (15 bramek, 286,7 s), `verify-static.log`                                                                                                                                                                                                                 |
| URLPattern w Chromium 141 (Playwright, mutex)                                       | 0 różnic na 551 ścieżkach                                                                                                                                                                                                                                             |
| build, `check:bundle`, `check:document-weight` artefaktu, e2e artefaktu, Lighthouse | NIE uruchamiane w tym etapie (zostawione dla Prove)                                                                                                                                                                                                                   |

## 4. Oczekiwany efekt (do potwierdzenia w Prove)

Symulacja kroków planu (`p37-tools/measure2.py`, kopia w `tools/`) na dokumencie bazy partii 4 (wariant LH, `phase3/wave3/P3.2b/lh/home-B.html`, 319 516 B):

| Krok                                     |         raw |       gz |
| ---------------------------------------- | ----------: | -------: |
| T1 koperta                               |      -6 184 |     -408 |
| T2 zajawki (z `withExcerpt:!1` w kluczu) |      -3 552 |     -127 |
| X1 speculation rules                     |      -1 130 |     -139 |
| T4a + T4b pasek                          |        -843 |      -74 |
| T5 `seoSettings`                         |        -477 |     -166 |
| T6 `heroPreloads`                        |        -159 |      -60 |
| **Razem P3.7b**                          | **-12 345** | **-974** |

Do tego pusta lista `mutations` w barierze i każdej porcji (kilkadziesiąt B). Cel P3.7b (>= -11,5 KB `htmlRawBytes`) spełniony w symulacji z zapasem ok. 0,8 KB. `dehydratedQueryHashCount` = 0 z konstrukcji; `streamedStateBytes` szac. ok. 6,9 KB (z 10,35 KB).

Koszt w chunku wejściowym (szacunek: `bun build --minify` samego modułu rozwijania): ok. 1,06 KB raw / 0,58 KB gz osobno, w bundlu mniej (gzip wspólny); do tego `keepPreviousData` i projekcja paska (dziesiątki B). Oczekiwany przyrost `bootClosure*` ok. +1,0-1,2 KB raw / +0,3-0,45 KB gz przy zapasie bazy 5,2 KB raw / 1,7 KB gz. KRYTYKA proponowała limit P3.7b <= +1,0 KB raw - na granicy; pomiar w Prove (razem z P3.2a, które też dokłada do wejścia).

## 5. Odchylenia od planu

1. **T1 - pusta lista `mutations` też znika** (nie było w planie): bezpieczne, bo `hydrate` czyta `mutations || []`, a `expand` ją przywraca (round-trip `toEqual`).
2. **T1 - `mapQueryStream` na `pull`, nie `pipeThrough(TransformStream)`:** konstruktor `TransformStream` z transformerem JS w Cloudflare Workers zależy od flagi zgodności; `pull` nie zależy od niczego.
3. **T2 - wykluczenie `numbered` tylko na powierzchni `list`:** wzór planu (`!(numbered && !getBool)` bez powierzchni) jest błędny dla karuzeli - karuzela rysuje `numbered` przez `PostCard` z zajawką niezależnie od `getBool` (np. `showExcerpt: false` jako boolean). Test tabeli i kontrakt znacznika to pokrywają.
4. **T2 - `postListInput(c, lang, surface = "list")` z wartością domyślną** (wymagany jest `postListQueryOptions`, jedyne źródło kluczy): ogranicza zmiany w testach pól niezwiązanych z zajawką. Wymagany parametr wymusił 4 miejsca produkcyjne (widok, 2 x prefetch, `heroImage.ts`) i 6 plików testów.
5. **T4b - język PO źródle w kluczu** (plan: `["header_ticker", lang, source, ...]`): ta sama liczba bajtów, a etykieta zapytania w logu dokumentu (`queryLabel`, predykat kompletności) zostaje `header_ticker.<źródło>`.
6. **T4b - typ `TickerItemProps.post` (tytuły opcjonalne) w `TrendingTicker.tsx`** - poza regionem `:135-144` z planu, ale konieczny dla wiersza z jednym tytułem (`HeaderTickerPost` ma teraz `title_pl?`/`title_en?`/`slug?`/`href?`).
7. **T5 również w `$.tsx`** (opcja planu, w zakresie T5).
8. **Metryki - próg `streamedStateBytes` z pomiaru bazy** (tymczasowy, nie gorzej niż baza), bo artefakt P3.7b powstaje dopiero w Prove; zaciśnięcie do pomiaru B robi orkiestrator ratchetem. `dehydratedQueryHashCount.measured` = 21 to wartość bazy (próg 0).
9. **KRYTYKA L5 (URLPattern w Chromium)** sprawdzona skryptem doraźnym przez mutex, nie w e2e repo - pliki `e2e/` są poza listą plików pozycji.
10. **`check-document-weight.ts`** (linia podsumowania) bez zmian - poza listą; nowe metryki widać w tabeli bramek i JSON.

## 6. Ryzyka

- **T1:** kontrakt `hydrate` w przyszłym query-core (mitygacja: usuwamy tylko pola równe stałej, `queryHash` zostaje przy innym hashu, round-trip na prawdziwym `dehydrate()`, kontrola negatywna). Dokumenty z cache L2 są związane z buildem (P3.6a), więc stary klient nie czyta nowej przesyłki; nowy klient czyta starą (pełna koperta przechodzi przez `expand`).
- **T1 - kolejność porcji strumienia na kliencie:** `pull` dokłada mikrozadania na porcję; porcje już dostarczone dochodzą przed ustąpieniem makrozadania po hydratacji integracji (test z prawdziwą integracją). Potwierdza e2e artefaktu (zero refetchów, zero błędów hydratacji) w Prove.
- **T2:** pominięte miejsce wywołania = inny klucz (refetch) albo brak zajawki; wymagany parametr + testy rejestru i kontrakt znacznika.
- **T4b:** miękka zmiana języka pokazuje przez chwilę tytuły poprzedniego języka (zejście `itemTitle`), zamiast natychmiast przełączyć z wpisu z obydwoma tytułami; dochodzi jedno wywołanie server fn paska po zmianie języka. Pasek się nie zapada (`keepPreviousData`, test). E2E miękkiej zmiany języka na artefakcie - w Prove (spec doraźny jak w P2.5: próbkowanie wysokości `[data-testid="trending-ticker"]` w rAF ok. 3 s po kliknięciu przełącznika, `/` -> `en` i `/en` -> `pl`, oczekiwane: brak zapadnięcia, CLS 0).
- **T6:** magazyn kluczowany `QueryClient`em żądania; na kliencie pusty z konstrukcji (hook i tak działa tylko w SSR).
- **Scalanie:** `heroImage.ts` - jedna instrukcja w `postListPreload` (P3.2a zmienia drabinę w innym miejscu pliku). `heroImage.test.ts` - 11 wywołań dostaje trzeci argument; P3.2a dopisuje tam przypadek, więc możliwy konflikt tekstowy w sąsiednich liniach (mechaniczny). `documentWeight.ts` + budżety: wyłącznie dopisane pola/klucze.

## 7. Co sprawdzić w recenzji

1. `router.tsx`: kompaktowanie ZA `guardQueryStream` i brak mutacji oryginałów (integracja zapisała `sentQueries`); klient rozwija przed `hydrate`.
2. `dehydratedQueryEnvelope.ts`: `Object.is` na stałej, warunek `queryHash === hashKey(queryKey)`, zachowanie `data`, `mapQueryStream` (błąd, `cancel`).
3. `postListRendersExcerpt` wobec WSZYSTKICH gałęzi `PostListView` (lista i karuzela) - tabela w teście i kontrakt znacznika.
4. Pasek: klucz SSR (`__root.tsx`, `currentLang()`) = klucz `TrendingTicker` (`i18n.language` klona żądania); `peekHeaderTickerPosts` w `HeaderSkeleton` (domyślny język).
5. `head()` w `index.tsx`/`$.tsx`: `parseSeoSettings` surowego `seo` (zasiew awaryjny: `undefined` -> domyślne).
6. Prove: `check:document-weight` na artefakcie (htmlRawBytes, `dehydratedQueryHashCount = 0`, `streamedStateBytes`, `imagePreloadNonCandidate = 0`, `documentPreloadDuplicates = 0`, `bootClosure*`), `test:e2e:artifact` (CI-like env), e2e miękkiej zmiany języka, Lighthouse `--compare` mobile + desktop4x (porcje ParseHTML, zadanie PB2 `StartClient` z deserializacją `$_TSR`, FCP/LCP +-0,02 s, CLS <= 0,001, TBT bez regresji).

## 8. Propozycja ratchetu (dla orkiestratora, po pomiarze artefaktu P3.7b)

- Nowe: `streamedStateBytes` max = ceil(pomiar B x 1,02) (szac. ok. 7,0 KB); `dehydratedQueryHashCount` zostaje 0 (`measured` = pomiar B).
- W dół (reguła pliku, bez podnoszenia): `htmlRawBytes`, `htmlGzipBytes`, `headRawBytes` (X1 -1,1 KB), `inlineScriptBytes`, `inlineExecutableScriptBytes`, `dehydratedStateBytes` (T1 bariera, T5, T6, T4), `preLcpTransferBytes`; `bootClosure*`/`bootBurstGzipBytes` raczej W GÓRĘ o kod rozwijania - nie ratchetować w dół, tylko sprawdzić zapas.
