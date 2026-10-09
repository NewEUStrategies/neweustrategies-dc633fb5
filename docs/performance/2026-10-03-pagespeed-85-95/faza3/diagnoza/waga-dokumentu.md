# Dieta dokumentu `/`: skąd bierze się 500 KB i co da się zdjąć bez zmiany renderu

Diagnoza tylko do odczytu, 2026-10-08. Repozytorium jest na `7c924ae5` (= `origin/main`; fale 0–2 scalone, w tym P2.1, P2.4, P2.5 i P2.6). Analizowany dokument to `w3/prod/d2.html`: produkcja, HIT z cache brzegowego, 500 741 B raw, 73 603 B gzip-6. Narzędzia leżą w `w3/diag/tools/`:

- `html_breakdown.py`
- `seroval_parse.py` i `queries.py` (parser przesyłki seroval z zakresami bajtów)
- `simulate.py` (symulacja zmian na kopii `d2`)
- `minify.cjs` (lightningcss z repo)
- `parsehtml.py` (zdarzenia ParseHTML z trace'ów LH)

Oznaczenia:

- **[Z]** zmierzone na `d2.html` albo na trace'ach `w3/prod-lh/*.trace.json`.
- **[S]** szacunek.

Bajty zawsze są raw, chyba że napisano „gz”.

## 0. TL;DR

1. **[Z] Prawie połowa dokumentu to trzy rzeczy:**
   - przesyłka stanu: bariera `$tsr` 89,2 KB i strumień 9,8 KB;
   - inline CSS: 86,4 KB;
   - `<img>`: 104,9 KB, z czego 70,9 KB to same `srcSet`.
     Reszta to markup: atrybuty `class` 75 KB, `style` 44 KB, `data-*` 23 KB.
2. **[Z] Dane loaderów tras to tylko 20,3 KB bariery.** 67,1 KB to dehydratowany cache react-query (16 zapytań) w tej samej barierze. Przesłanka zadania „posty z `*_pl` i `*_en`” jest po P2.5 aktualna już tylko dla paska trendów (`header_ticker`). Aktualne pozostają:
   - menu z obiema etykietami i `ref_id` (odstępstwo przyjęte w P2.5);
   - zajawki: 16 wartości, 4 unikalne, ta sama zajawka 6 razy, **żadna nie jest renderowana na `/`**;
   - koperta stanu zapytań: 6,1 KB samego `queryHash` i stałych pól stanu.
3. **[Z] „Nieprzypisany” blok 15,3 KB to `TICKER_CSS` paska trendów** (`src/components/header/TrendingTicker.tsx:891-1212`). Jest sformatowany ładnie, a 4,6 KB z tego to komentarze i białe znaki. Na stronie jest też 10,1 KB samych komentarzy i białych znaków w statycznych literałach CSS. Tę część da się zdjąć bez żadnej zmiany kaskady.
4. **[Z] Symulacja na `d2` pakietu 13 zmian** (§4, pozycje oznaczone _sym_) daje **500 741 → 401 096 B raw (−99,6 KB, −19,9 %) i 73 603 → 63 407 B gz (−10,2 KB)**.
   - Zaplanowane P3.2 i P4.2 dają z tego −38,7 KB.
   - Nowe pozycje dają −60,9 KB.
   - Dalsze −28 KB [S] wymaga zmian z większym ryzykiem: kompaktowe parametry URL mediów i konsolidacja klas.
5. **[Z] Trace LH mobile pokazuje, że bajty dokumentu nie są największym długim zadaniem.**
   - ParseHTML dokumentu: ok. 47–50 ms obserwowane (≈190–200 ms sym. przy 4×), w plasterkach ok. 10 ms obs. (≈40–46 ms sym. każdy).
   - Pierwsza klatka to jedno zadanie 138–174 ms obs. (≈550–700 ms sym.):
     - Layout 69–106 ms na 660 obiektach;
     - UpdateLayoutTree 34–39 ms;
     - RunMicrotasks 12–21 ms.
       Dieta skraca parsowanie i przesuwa koniec tego zadania wcześniej (SI Lantern), ale samego zadania nie skraca. **Warunek uruchomienia P3.3 (`content-visibility`, zadanie pierwszej klatki ≥ 50 ms sym.) jest spełniony z dużym zapasem** (§7).

## 1. Skład `d2.html` [Z]

| Kategoria                |   Bajty | Uwagi                                                                                                                                                  |
| ------------------------ | ------: | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `<head>`                 |  31 799 | w tym hoistowany `nes-slider-shared-v1` (11 258) i 15,4 KB skryptów                                                                                    |
| inline `<script>` (17)   | 115 198 | `$tsr` 89 153 (treść 89 098), strumień rq 9 792, JSON-LD 4 437, loader bootu 2 767, speculationrules 2 375, zgody 2 024, sonda 972, zestaw bootu 1 050 |
| inline `<style>` (26)    |  86 376 | §3.2                                                                                                                                                   |
| `<img>` (83)             | 104 850 | `srcSet` 70 857 (72×), `src` 13 697                                                                                                                    |
| atrybuty `class` (1 144) |  75 380 | 224 unikalne, 57 418 B to powtórzenia                                                                                                                  |
| atrybuty `style` (542)   |  44 462 | 157 unikalnych, 27 218 B to powtórzenia                                                                                                                |
| `data-*` (741)           |  22 968 | `data-typography-exempt` 3 208, `data-col-id` 2 360, `data-widget-id` 2 279, `data-w-id` 2 039                                                         |
| `<svg>` (64)             |  22 389 | 13 KB to atrybuty korzenia; niewiele duplikatów                                                                                                        |
| tekst                    |   6 453 |                                                                                                                                                        |

UUID-y: 1 271 wystąpień, 45,7 KB. Prefiks mediów `https://neweuropeanstrategies.com/media/07167e87-…/` występuje 551 razy (77 B każdy). Same originy dają 19,5 KB, z tego 115 wystąpień w skryptach.

Regiony dokumentu [Z]:

| Region                            |   Bajty | Zawartość                                                                |
| --------------------------------- | ------: | ------------------------------------------------------------------------ |
| `<head>`                          | 31,8 KB |                                                                          |
| bloki stylów na początku `<body>` | 38,2 KB | marka 26,8 KB, motyw i content-area 10,6 KB                              |
| pasek trendów                     | 39,6 KB | CSS 16,7 KB, obrazy 8,8 KB, klasy 7,4 KB                                 |
| nagłówek                          | 33,7 KB | sekcje `0e20db30` i `9ddd363a` oraz wyspy konta i wyszukiwarki           |
| treść                             |  212 KB | sekcja `015cccb6` sama ma 86,7 KB (4 slidery multi-card, obrazy 46,2 KB) |
| stopka                            | 29,8 KB |                                                                          |
| powłoka zgód                      |  5,8 KB |                                                                          |
| ogon skryptów                     | 99,1 KB |                                                                          |

## 2. Gdzie leży przesyłka stanu i kto czyta pola [Z]

### 2.1 Bariera `$tsr-stream-barrier` (89 153 B)

Struktura: `$_TSR.router = {manifest, matches, lastMatchId, dehydratedData:{queryStream, dehydratedQueryClient}}`. Parser `seroval_parse.py` przypisuje bajty ścieżkom.

| Ścieżka                                      |  Bajty | Źródło                                                                         | Czytane na kliencie po hydratacji?                                                                                              |
| -------------------------------------------- | -----: | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `matches[0].l.ga4` (loader korzenia)         |    ~60 | `src/routes/__root.tsx:710`, zwrot `:1117`                                     | tak (`__root.tsx:605`)                                                                                                          |
| `matches[1].l` (loader `/`)                  | 20 257 | `src/routes/index.tsx:108-289`, zwrot `:281-288`                               | —                                                                                                                               |
| ↳ `homePage` (w tym `builder_data` 16 817)   | 17 385 | `homePageQueryOptions`                                                         | tak (render buildera). **Bez kosztu podwójnego:** zapytanie `["public","home-page"]` ma `data:$R[11]`, czyli referencję seroval |
| ↳ `heroPreloads` (w tym `imageSrcSet` 1 513) |  1 747 | `index.tsx:171,255`                                                            | **nie.** `usePreloadLcpImages` działa tylko w SSR (`src/lib/builder/aboveFold.tsx:214-217`)                                     |
| ↳ `seoSettings`                              |  1 044 | `index.tsx:261` (`parseSeoSettings`)                                           | tylko przez `head()` (JSON-LD, `:346-351`). **Duplikat** `site_settings_public.all.seo` (1 051 B)                               |
| `queryStream` (kod funkcji seroval)          |    619 | integracja                                                                     | —                                                                                                                               |
| `dehydratedQueryClient` (16 zapytań)         | 67 189 | `setupRouterSsrQueryIntegration` (`src/router.tsx:150`), opakowanie `:178-213` | tabela niżej                                                                                                                    |
| `$R[n]=` (724 przypisania)                   |  5 682 | seroval (tryb referencji)                                                      | nie da się tego zmienić bez upstreamu                                                                                           |

`dehydratedQueryClient`, 16 zapytań: `queries.py`, `overhead` = koperta, czyli wszystko poza `state.data`.

| Zapytanie                                                                                                                                      |         Razem |          Dane |       Koperta | Największe pola danych                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------: | ------------: | ------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `site_settings_public,all` (`src/lib/useSiteSetting.ts:21-39,105-113`)                                                                         |        25 448 |        25 089 |           359 | `footer.builder_data` 6 553, `header` 4 762, `theme_options` 4 124 (`logo`: 16 URL-i, 2 706), `theme_design` 2 197, `auth_branding` 1 322, `mobile_bottom_bar` 1 145, `seo` 1 051, `font_sizes` 906, `personalized_system` 814 |
| `menu-with-items,main` (`src/lib/menus/queries.ts:52`, `menu.functions.ts:96-170`)                                                             |        12 226 |        11 875 |           351 | 46 pozycji: `ref_id` 1 946, `id` 1 932, `parent_id` 1 911, `href` 1 257, `label_pl` 1 090, **`label_en` 1 048**, `item_type` 916, `mega_config` 693                                                                            |
| `builder-post-list` ranked ×5                                                                                                                  |         6 364 |         5 353 |         1 011 | `excerpt_pl` 1 386 (**nie renderowane**: wariant `ranked` nie ma zajawki, `PostListView.tsx:359-437`), `author_avatar_url` 825                                                                                                 |
| `header_ticker,trending,…` (`src/lib/views/headerTickerQuery.ts:77-110`)                                                                       |         5 473 |         5 068 |           405 | `author_avatar_url` 1 320, **`title_en` 806**, `href` 757, `title_pl` 755, **`slug` 709** (zapas na brak `href`, `TrendingTicker.tsx:437,598`)                                                                                 |
| `builder-slider-posts` ×5                                                                                                                      |         4 357 |         3 792 |           565 | `excerpt_pl` 1 390 (**nie renderowane**: slider ma `showExcerpt:!1`)                                                                                                                                                           |
| `site_global_colors`                                                                                                                           |         3 872 |         3 531 |           341 | wejście hashu `DesignTokensStyle` (HW-3e odrzucone)                                                                                                                                                                            |
| `builder-post-list` card ×1 (×2 zapytania)                                                                                                     | 2 075 + 2 305 | 1 067 + 1 298 | 1 008 + 1 007 | `excerpt_pl` 482 + 482 (**nie renderowane**: `showExcerpt:"0"`)                                                                                                                                                                |
| `post-layout-settings`                                                                                                                         |         1 444 |         1 111 |           333 |                                                                                                                                                                                                                                |
| `builder-slider-fallback-images`                                                                                                               |         1 013 |           644 |           369 |                                                                                                                                                                                                                                |
| 6 drobnych (`site_design_tokens`, `public/home-page` (ref), `home-mode`, `menu footer` (null), `ad_placements` ([]), `builder-slider-authors`) |        ~2 560 |          ~350 |        ~2 210 | prawie sama koperta                                                                                                                                                                                                            |

**Koperta zapytania (wszystkie zapytania):** `queryHash` duplikuje `queryKey` jako JSON. Do tego stały ogon stanu: `dataUpdateCount:1, error:null, errorUpdateCount:0, errorUpdatedAt:0, fetchFailureCount:0, fetchFailureReason:null, fetchMeta:null, isInvalidated:!1, status:"success", fetchStatus:"idle"`.

- Bariera: `queryHash` 1 914 B i ogon 3 268 B.
- Strumień: 830 B i 615 B.

Dla `builder-post-list` sam klucz z 17 parametrami ma ok. 314 B, a `queryHash` ok. 379 B.

### 2.2 Strumień react-query (osobny `<script>`, 9 792 B)

Trzy porcje `$R[249].next(...)` z wtyczki integracji (`node_modules/@tanstack/router-ssr-query-core/dist/esm/index.js`, subskrypcja cache):

| Porcja                                        | Bajty |
| --------------------------------------------- | ----: |
| `builder-post-list` minimal ×3                | 4 043 |
| `builder-post-list` list ×3                   | 4 037 |
| `newsletter-settings,inline` (projekcja P2.5) | 1 585 |

**Luka bramki:** `dehydratedStateBytes` w `scripts/performance/documentWeight.ts:580` liczy tylko `#$tsr-stream-barrier`. Tych 9,8 KB nie widzi żadna metryka.

### 2.3 Duplikaty w przesyłce

- 27 wierszy postów w 6 zapytaniach, 9 unikalnych.
- Tytuły: 55 wartości, 17 unikalnych, 2 271 B powtórzeń.
- Zajawki: 16 wartości, 4 unikalne, 3 500 B powtórzeń.

## 3. Style i obrazy: atrybucja [Z]

### 3.1 Bloki `<style>` (26 bloków, 85 073 B treści)

| Blok                                 |                                      Bajty | Emiter                                                                                                                                                                                            | Charakter                                           |                Komentarze / białe znaki | lightningcss |
| ------------------------------------ | -----------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------: | -----------: |
| `data-brand-tokens`                  |                                     26 732 | `src/components/DesignTokensStyle.tsx` → `src/components/theme/css/designTokensCss.ts:25-29` → `tokensToCss` + `globalColorsToCss` (`src/lib/builder/globalColors.ts:824-997`) + `fontScaleToCss` | zmienne (§3.2) + statyczny most                     |                        1 511 komentarzy |       −2 976 |
| `TICKER_CSS` (bez atrybutu)          |                                     15 252 | `TrendingTicker.tsx:891-1212`; `TickerStyles` `:1214` przez `StyleSink` (`:246`, `:356`). Ten sam literał jest w chunku wejściowym `index-*.js` (HW-1: 14,8 KB)                                   | statyczny                                           | 1 190 komentarzy + 2 904 białych znaków |       −5 735 |
| `nes-slider-shared-v1`               |                                     11 184 | `src/lib/builder/sliderVariants.tsx:442-642` (`SHARED_STYLES`); `<style href precedence="builder">` `:1165`, hoistowany przez React 19 do `<head>`. Także w chunku `sliderVariants-*.js`          | statyczny                                           |                        2 130 komentarzy |       −3 423 |
| 5× `data-wt-css`                     | 2 107–2 135 każdy, razem ~10,9 KB z tagami | `LegacyTypographyStyle` (`src/components/builder/organisms/ChromeWidgetView.tsx:213-268`) → `buildLegacyWidgetTypographyCss` (`src/lib/builder/typographyCss.ts:74-84`, reguły `:85+`)            | **2 078 B listy 17 selektorów na jedną deklarację** |                                       — |   −~30 każdy |
| `data-theme-font-sizes`              |                                      3 189 | `ThemeFontSizesStyle.tsx` / `themeFontSizesCss.ts`                                                                                                                                                | dane                                                |                                       0 |          −58 |
| `data-content-area`                  |                                      2 730 | `src/components/ContentAreaStyle.tsx:20-105`                                                                                                                                                      | szablon + dane                                      |                          517 komentarzy |         −772 |
| `data-search-sheet`                  |                                      2 496 | `SearchButtonWidget.tsx:206-286` (`SEARCH_WIDGET_CSS`)                                                                                                                                            | statyczny                                           |                             białe znaki |         −334 |
| `data-theme-options`                 |                                      2 277 | `ThemeOptionsStyle.tsx` / `themeOptionsCss.ts`                                                                                                                                                    | dane                                                |                                       0 |         −211 |
| `data-theme-design`                  |                                      2 127 | `ThemeDesignStyle.tsx` / `themeDesignCss.ts`                                                                                                                                                      | dane                                                |                                       0 |           ~0 |
| `.sbw-d0vimc` ×2 (**identyczne**)    |                              2 011 + 2 011 | `socialHover.ts:482` (uid z hashu konfiguracji)                                                                                                                                                   | per konfiguracja                                    |                                       — |   −160 każdy |
| `[data-jus-id]…×8`                   |                                      1 364 | `src/lib/interests/joinUsSizeCss.ts`                                                                                                                                                              | per instancja                                       |                                       — |            — |
| `[data-tt-vid]` + keyframes          |                                  938 + 492 | `TrendingTicker.tsx:837-866`, `:810-811`                                                                                                                                                          | dane                                                |                      130 białych znaków |         −490 |
| instancje slidera `.eh-i-…` (5)      |                                353 + 4×120 | `sliderVariants.tsx` (`instanceCss`)                                                                                                                                                              | per instancja                                       |                                       — |            — |
| `widgetCss` (2)                      |                                   374 + 90 | `ChromeWidgetView.tsx:530`                                                                                                                                                                        | per instancja                                       |                                       — |            — |
| `[data-sec-id] [data-col-id]{order}` |                                        405 | `BuilderRenderer.tsx:826`                                                                                                                                                                         | per sekcja                                          |                                       — |            — |

Razem: zdjęcie samych komentarzy i białych znaków (bez transformacji składni) daje **−10 279 B**, a lightningcss `minify` **−14 711 B**. Na gzip efekt jest nieproporcjonalnie duży, bo komentarze i białe znaki słabo się kompresują: −3,5 KB gz w symulacji S1.

### 3.2 `data-brand-tokens` (26,7 KB): czy może być statyczny, zdeduplikowany albo zredukowany do używanych zmiennych?

- **Zmienne instancji (7 666 B):**
  - `:root,.light{…}`: 4 039 B, 146 deklaracji;
  - `.dark{…}`: 3 627 B, 129 deklaracji.
    Wartości pochodzą z `site_global_colors` (te same dane jadą też w stanie: 3,9 KB). Są potrzebne przed pierwszym malowaniem w obu motywach.
    Z 146 nazw **26 (1,8 KB w obu blokach) nie ma odwołania** w produkcyjnym `styles-CQ2SRHxh.css` ani w HTML-u. Większość to `*-hover-hover` i `--sidebar-*`; mogą je czytać arkusze admina. Redukcja „do używanych” daje więc najwyżej 1,8 KB i wymaga sprawdzenia `admin-styles.css`. Niski priorytet.
- **Statyczny most widgetów (≈19 KB):** identyczny dla każdej strony i każdego tenanta (`globalColors.ts:871-989`, `.replace(/\s+/g," ")` zostawia komentarze). W tym:
  - **3 666 B reguł `[data-sidebar…]`** (16 bloków). `data-sidebar` emitują wyłącznie komponenty `src/components/admin/*`. Na stronach publicznych to martwy CSS;
  - 1 511 B komentarzy;
  - reguły przypisów, TOC, recenzji i live-bloga (`:where()` o specyficzności 0).
- **Wniosek:**
  - deduplikacji w bloku nie ma;
  - przeniesienie mostu do cache'owanego arkusza to HW-1. Werdykt HW-1 zostaje: netto +25–30 ms FCP/LCP w reżimie C3 i przekroczenie zamrożonego `publicCss` w `check:bundle`, więc tylko razem z podziałem rdzenia CSS w P4.1;
  - teraz: S1 (komentarze) i S3 (sidebar do `admin-styles.css`), czyli −5,1 KB bez dotykania kaskady publicznej.

### 3.3 `<img>` (83 tagi, 104 850 B)

| Rodzaj                            | Liczba |  Bajty | `srcSet`                                                                                                                    | Emiter                                                                                                               |
| --------------------------------- | -----: | -----: | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| okładki (karty, multi-card, hero) |     27 | 53 657 | 9 szerokości `RESPONSIVE_WIDTHS` (`src/lib/cropSizes.ts:209`), absolutne URL-e, `?width=…&amp;resize=contain&amp;quality=…` | `buildImageSrcSet` `cropSizes.ts:216-229` ← `OptimizedImage.tsx:53,70,120-121`, `sliderVariants.tsx:380` (FillImage) |
| awatary bylinu                    |     33 | 36 432 | 1x/2x/3x (32/48/72) + `src`=48                                                                                              | `AuthorByline.tsx:157-158` → `buildAvatarSrc` / `buildAvatarSrcSet` `cropSizes.ts:237-257`                           |
| awatary paska                     |      9 |  8 568 | 1x/2x/3x + `src`=40                                                                                                         | `TrendingTicker.tsx:546-547`                                                                                         |
| miniatury 128/256/384             |      3 |  2 604 | 3 szerokości                                                                                                                | `widgetImageSizes`                                                                                                   |
| bez `srcset` (logo SVG itd.)      |     11 |  3 589 | —                                                                                                                           |                                                                                                                      |

Wszystkie 42 awatary to **ten sam plik jednego autora**: ok. 1,1 KB na tag, razem 45 KB. Preload LCP w `<head>` (`imageSrcSet` 1 598 B) i nagłówek `Link` niosą te same 9 kandydatów (kontrakt P1.4: klucz preloadu = `<img>`).

Symulacja `simulate.py` na `d2`:

| Krok                                                                                                 |       Bajty raw |   gz |
| ---------------------------------------------------------------------------------------------------- | --------------: | ---: |
| P3.2 drabina [480, 640, 768, 1280, 1920]                                                             |         −19 860 | −746 |
| P3.2 awatary 1x/2x                                                                                   |          −8 568 | −169 |
| P4.2 względne URL-e w `src`/`srcset`/preloadzie (dodatkowo)                                          |         −10 296 | −490 |
| P4.2 sam, bez P3.2                                                                                   |         −15 081 |    — |
| **Nowe I3:** awatar `src` = 1x i `srcset` tylko „2x” (przeglądarka traktuje `src` jako kandydata 1x) |          −7 182 | −740 |
| Obrazy po wszystkim                                                                                  | 104,9 → 59,8 KB |      |

### 3.4 Atrybuty `class` i `style`: najczęstsze powtórzenia i emitery [Z]

Atrybuty `class`:

| Napis (skrót)                                                                                                     | Liczba × długość            | Bajty | Emiter                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------- | ----: | ---------------------------------------------------------------------- |
| `inline-flex min-w-0 items-center gap-1.5 font-medium transition-colors text-muted-foreground hover:text-primary` | 33 × 111                    | 3 960 | `AuthorByline.tsx:222`                                                 |
| `group inline-flex h-8 w-8 … focus-visible:outline-offset-2`                                                      | 23 × 152                    | 3 703 | nawigacja slidera `sliderVariants.tsx:759,1716`                        |
| `flex flex-col items-stretch … self-stretch justify-self-stretch my-0`                                            | 24 × 134, 12 × 148, 4 × 141 | 5 916 | tabela klas ramki P2.6 `BuilderWidgetNode.tsx:69-115`                  |
| `rounded-full w-2.5 h-2.5 transition-[transform,opacity] …`                                                       | 18 × 125                    | 2 412 | kropki `sliderVariants.tsx:726`                                        |
| `font-display text-[12px] font-black uppercase tracking-[0.08em] …`                                               | 11 × 190                    | 2 189 | tytuł kinetic `sectionLabelVariants.tsx:1212` (obszar reguł AGENTS.md) |
| `flex flex-col gap-2 min-w-0 max-w-full overflow-visible …`                                                       | 21 × 83                     | 1 932 | kolumna `BuilderRenderer.tsx:1106`                                     |
| `min-w-0 max-w-full overflow-hidden`                                                                              | 51 × 34                     | 2 193 | sekcje/kolumny `BuilderRenderer.tsx:813,882,925`                       |

Atrybuty `style`:

| Napis (skrót)                                                                                                              | Liczba × długość |  Bajty | Emiter                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------- | -----: | ----------------------------------------------------------------------------------------------------- |
| `width:20px;height:20px;min-width:20px;…;border-radius:6px;flex:0 0 auto`                                                  | 33 × 116         |  4 125 | `AuthorByline.tsx:134-149` (`avatarStyle`)                                                            |
| `font-size:12px;line-height:1.35`                                                                                          | 87 × 31          |  3 480 | `AuthorByline.tsx:128-133` (`textStyle`); także `sliderVariants.tsx:1115`, `ChromeWidgetView.tsx:890` |
| statyczna baza ramki `[data-w-id]` (`display:flex;flex-direction:column;align-items:…;…;box-sizing:border-box;overflow:…`) | 48 atrybutów     | 12 903 | `ChromeWidgetView.tsx:540-572` (`wrap()`)                                                             |
| `display:grid;…;grid-template-columns:repeat(12, minmax(0, 1fr));gap:20px;--builder-col-gap:20px`                          | 11 × 153         |  1 782 | `src/lib/builder/sectionStyles.tsx:135-143`                                                           |
| kontener sekcji `position:relative;z-index:1;…;padding-left:8px;…`                                                         | 11 × 126         |  1 485 | `sectionStyles.tsx:104-115`                                                                           |
| wrapper sekcji                                                                                                             | 12 × 98          |  1 284 | `sectionStyles.tsx:63-70`                                                                             |
| `--wt-*`                                                                                                                   | 174 deklaracji   |  2 727 | P2.4; 58 trójek d/t/m o równych wartościach                                                           |

`data-*`: pozycji do bezpiecznego zdjęcia prawie nie ma.

- `data-debug-type` czyta publiczny `styles.css:3014-3028,4692`.
- `data-widget-id` i `data-col-id` czyta CSS urządzeń (`styles.css:2486-2698`).
- `data-typography-exempt` wymaga AGENTS.md.

## 4. Propozycje: mechanizm, oszczędność, ryzyka, testy

Kolumna „rodzaj”: **D** oznacza czyste dane lub znaczniki (dostawa CSS bez zmian), **CSS** oznacza zmianę dostawy CSS. Oszczędności „sym” pochodzą z `simulate.py` na `d2` (kroki kumulatywne).

### Przesyłka stanu (bariera i strumień)

**T1. Kompaktowa koperta zapytań** · D · sym **−6 107 B / −440 gz**, na każdej stronie z chrome.

- Mechanizm:
  - Na serwerze, w opakowaniu `router.options.dehydrate` (`src/router.tsx:178-213`) i w `guardQueryStream` (`src/lib/ssr/queryStreamGuard.ts`), z każdego zapytania usuń `queryHash` oraz te pola `state`, których wartość równa się stałej domyślnej (lista z §2.1).
  - Na kliencie, w opakowaniu `router.options.hydrate` (blok `!isServer` w `router.tsx`) przed `hydrate()` integracji, odtwórz `queryHash = hashKey(queryKey)` i domyślne pola. Strumień obsłuż przez `pipeThrough(TransformStream)`.
  - `dehydratedAt`, `dataUpdatedAt`, `meta` i `queryType` zostają.
  - Na kliencie `hydrate()` szuka po `queryHash` (`node_modules/@tanstack/query-core/src/hydration.ts:227`), a `build` liczy hash z klucza, gdy go brak (`queryCache.ts:114-115`). W `src` nie ma `queryKeyHashFn`.
- Ryzyka:
  - aktualizacja query-core (5.101.2) może dodać pola stanu. Mitygacja: test round-trip „compact→expand = `dehydrate()`” na przypiętej wersji i strażnik grep na `queryKeyHashFn`;
  - `shouldDehydrateQuery` zostaje dosłowne (`router.tsx:93`, inwariant `ssrBudgets.ts:686`). Parytet SSR/hydratacji jest bez zmian, bo cache po `hydrate` jest identyczny.
- Testy:
  - nowy `routerDehydrateCompaction.test.ts`;
  - `src/lib/ssr/__tests__/queryStreamGuard.test.ts` (czyta `queryHash` porcji: kolejność kompaktowania po guardzie);
  - `router.test.tsx`, uprząż first-visit.

**T2. Zajawki tylko tam, gdzie widget je renderuje** · D · sym **−4 948 B / −861 gz** na `/`.

- Mechanizm: lustro P2.5, czyli projekcja w `queryFn` kluczowana kluczem.
  - Do `postListInput` (`src/lib/builder/postListQuery.ts:181-217`) dodaj `withExcerpt`, liczone predykatem zgodnym z widokiem:
    - `getStr(c,"showExcerpt") !== "0"` (`PostListView.tsx:139,286`);
    - wariant renderujący zajawkę (`ranked` jej nie ma, `:359-437`).
  - `localizePostListRows` (`:451-458`) zdejmuje `excerpt_*`, gdy `!withExcerpt`.
  - To samo w kluczu slidera (`src/lib/builder/sliderPostsQuery.ts:117,160-170`; `PostsSliderWidget.tsx:60,154-155`; `sliderVariants.tsx:1107`).
  - Prefetch (`src/lib/builder/prefetch.ts`) używa tej samej funkcji wejścia, więc klucz SSR = klucz klienta.
  - Wariant ostrożny: predykat tylko po `showExcerpt`, bez wariantu, daje ok. −3,5 KB [S].
- Ryzyka:
  - rozjazd predykatu z widokiem kończy się pustą zajawką. Mitygacja: jeden predykat eksportowany z widoku i test macierzy wariantów;
  - inny klucz rozdziela cache dwóch widgetów z różnym `showExcerpt` (zamierzone).
- Testy: `dehydratedPayload.test.ts` (zakaz `excerpt_*` w zapytaniach widgetów bez zajawki), `sectionPrefetch.test.ts` (kolumny), testy `postListQuery`.

**T3. Publiczny klucz menu z projekcją na język** · D · [S] **−3,0 KB** (`label_en` 1 048 + `ref_id` 1 946).

- Mechanizm: `["menu-public", key, lang]` dla `SiteMenu`/`MegaPanel`, z rzutowaniem w server fn z tego samego wpisu `edgeTtlCache(menuCacheKey(key))` (`menu.functions.ts:103`). `MenuManager` zostaje na `["menu-with-items", key]`, więc znika powód odstępstwa P2.5.
- Ryzyka:
  - miękka zmiana języka wymaga `placeholderData: keepPreviousData` (`SiteMenu.tsx:555-575`);
  - strażnik HMR w `__root.tsx:961-962,1100-1106`;
  - około 10 testów zna klucz.
- Fixture tego nie zobaczy (`homeFixture.ts` ignoruje osadzenie menu), więc dowód musi pochodzić z `--html` na HIT produkcji.

**T4. Pasek trendów z językiem w kluczu** · D · [S] **−1,5 KB** (`title_en` 808 + `slug` 709, gdy jest `href`).

- To przekazanie z P2.5. P2.1 już jest, więc język żądania w `__root.tsx` jest dostępny.
- Pliki: `headerTickerQuery.ts:77-110,143-150`, `TrendingTicker.tsx:427,437,593-598`.
- Ryzyko: zapadanie paska przy miękkiej zmianie języka (CLS). Mitygacja: `keepPreviousData` i e2e z P2.5.

**T5. `seoSettings` jako referencja** · D · sym **−1 039 B / −364 gz**.

- Loader zwraca surowe `settingsRes.data.seo`, czyli ten sam obiekt co w cache, więc seroval emituje `$R[n]`. `parseSeoSettings` przenosi się do `head()` (`index.tsx:261,282,346`).
- Ryzyko: JSON-LD musi zostać bajtowo równy. Bramka: `compare-head-meta.mjs` z P4.2.

**T6. `heroPreloads` poza przesyłką** · D · sym **−1 761 B / −221 gz** (po P3.2+P4.2 ok. −0,6 KB [S]).

- Loader zapisuje deskryptor w magazynie żądania kluczowanym `queryClient`, np. `WeakMap` w module serwerowym. Komponent czyta go przez `useQueryClient()` w SSR.
- Klient i tak go nie używa (`aboveFold.tsx:214-217`). Nagłówek `Link` (`index.tsx:275-277`) bez zmian.

### Style

**S1. Minifikacja statycznych literałów CSS przy buildzie** · D (dostawa bez zmian) · sym **−10 137 B / −3 529 gz** w HTML-u, plus te same bajty w JS.

- Ten sam efekt w JS: chunk wejściowy ok. −4,6 KB raw (`TICKER_CSS`), `sliderVariants-*.js` ok. −2,8 KB.
- Mechanizm:
  - `TICKER_CSS` (`TrendingTicker.tsx:891-1212`), `SHARED_STYLES` (`sliderVariants.tsx:442-642`) i `SEARCH_WIDGET_CSS` (`SearchButtonWidget.tsx:206`) przenieść do plików `.css` importowanych przez `?inline`, które Vite minifikuje w buildzie;
  - komentarze z szablonów `globalColorsToCss` (`globalColors.ts:871-989`) i `contentAreaCss` (`ContentAreaStyle.tsx:20-105`) przenieść do komentarzy JS poza literałem.
  - Wariant konserwatywny (komentarze i białe znaki) daje −10,3 KB; pełny lightningcss −14,7 KB.
- Ryzyka:
  - kaskada i specyficzność bez zmian;
  - testy porównujące tekst CSS: `TrendingTicker.motion.test.tsx`, `sliderVariantCatalogs.test.tsx` (reguły `@media` jako tekst, `:28-41`; liczba bloków `:555` bez zmian), `globalColors.test.ts:186-191` (nadal `:where(` i `@layer utilities`);
  - `StyleSink` porównuje napis, a na serwerze i kliencie napis jest ten sam, więc parytet hydratacji zostaje.

**S2. Szablon HW-2 (P2.4) także dla grupy „common”** · CSS · sym **−10 852 B HTML / −1 037 gz**.

- Zakres: `font-weight`, `text-align`, `line-height`, `letter-spacing`, czyli właściwości widziane w 5 blokach `data-wt-css`. Koszt: [S] +4–6 KB raw / +0,3–0,5 KB gz blokującego CSS.
- Mechanizm: tokeny `data-wt~="fw|ta|lh|ls"` i zmienne `--wt-*` jak w `src/styles.css:9256-9340`. Dziś 4 reguły szablonu ważą 2 117 B raw i 441 B gz. `buildLegacyWidgetTypographyCss` zostaje dla wartości spoza białej listy.
- Ryzyka:
  - kaskada musi być identyczna: 0,3,0 + `!important`, niewarstwowo, na końcu publicznego CSS;
  - koszt dopasowania: każdy szablon z prawym compoundem `:is(p,span,…)` jest sprawdzany dla każdego `span`. Przy 5 blokach zysk TBT jest niepewny i trzeba go zmierzyć A/B;
  - typografia ma być wspólna dla obu motywów (AGENTS.md), więc wartości nie zależą od motywu;
  - budżet `publicCss` w `check:bundle`.
- Testy: `legacyTypographyHydration.test.tsx`, `widgetFrameOwnership.test.tsx`, `typographyMapping.test.tsx`, `typographyMinFontSize.test.ts`, strażnik `check-entry-purity` i sonda `getComputedStyle` z P2.6 (390/820/1350, jasny i ciemny).

**S3. Reguły `[data-sidebar]` z bloku marki do `admin-styles.css`** · CSS (tylko admin) · sym **−3 625 B / −432 gz**.

- Dopisać je na końcu `admin-styles.css`. Werdykt HW-1 pkt 2: przy końcowym dopisaniu reguła mostu dalej wygrywa z `admin-styles.css:657`.
- Podglądy edytora (`GlobalColorsEditor.tsx:361`, `ThemeBackgroundsPane.tsx:203`) dostają reguły z arkusza admina.
- Ryzyko: wygląd sidebara admina. Test: `globalColors.test.ts`.

### Obrazy (P3.2 i P4.2 są zaplanowane, tu liczby i jedno rozszerzenie)

**I1 = P3.2 (HW-4)** · D · sym **−28 428 B / −915 gz**.

- Składowe: drabina [480, 640, 768, 1280, 1920] −19 860, awatary 1x/2x −8 568.
- Uwaga parytetu:
  - preload w `<head>` (`imageSrcSet`) i nagłówek `Link` muszą dostać tę samą drabinę co `<img>` (klucz P1.4, `imagePreloadNonCandidate` = 0);
  - testy: `heroCandidateSelection`, `cropSizes.test.ts`.

**I2 = P4.2 (HW-5)** · D · sym **−10 296 B / −490 gz** po I1 (sam: −15 081).

- Względne URL-e także w `imageSrcSet` preloadu i w `Link` (ten sam klucz zasobu).
- OG, JSON-LD, RSS i stan zostają absolutne (krytyka M13). Bramka: `compare-head-meta.mjs`.

**I3. Awatar: `src` = 1x, `srcset` = tylko kandydat 2x** · D · sym **−7 182 B / −740 gz**.

- Zmiana w `buildAvatarSrc` z `dpr=1` dla `src` i `buildAvatarSrcSet` bez 1x (`cropSizes.ts:237-257`).
- Wybór przeglądarki jest identyczny: `src` jest niejawnym kandydatem 1x.
- Rozszerza P3.2. Testy: `cropSizes.test.ts`, testy kontraktu bylinu i paska.

**I4. Kompaktowe parametry `/media`** · D, ale **zmienia URL-e** · [S] **−8,5 KB**.

- Przykłady: `?w=480&q=76` dla okładek i `?s=48` dla awatarów.
- Ryzyka: kontrakt trasy `/media/$`, zimny cache CDN i transformacji po wdrożeniu, aliasy muszą dawać bajtowo ten sam obraz. Tylko jako opcja po P4.2.

### Markup

**M1. Statyczna baza stylu ramki `[data-w-id]` i ramek sekcji jako klasy** (kontynuacja P2.6) · prawie D (klasy Tailwinda już istnieją) · sym **−7 785 B / −366 gz** dla ramki, [S] −3 KB dla sekcji.

- Zakres: `ChromeWidgetView.tsx:540-572` oraz `sectionStyles.tsx:63-70,104-115,135-143`. `baseStyle` autora zostaje inline.
- Ryzyko: deklaracja inline przechodzi do klasy, więc reguły arkusza na `[data-w-id]` (np. `styles.css:2486-2493`) mogą zacząć wygrywać.
- Testy: tabela klas jak w P2.6 i sonda `getComputedStyle`; `builderWidgetNodeFrame.test.tsx`.

**M2. Byline w kontrakcie domyślnym (20 px / 12 px) jako klasy z `!important`** · CSS (kilkaset bajtów) · sym **−7 485 B / −801 gz**.

- Komentarz w `AuthorByline.tsx:95-127` wymaga „domknięcia pudełka”. Klasa z `!important` daje ten sam efekt wobec reguł obrazów buildera, a reguły typografii widgetu i tak omijają `data-typography-exempt`.
- Testy: `AuthorByline.cascade.test.tsx`, `DisplayLivePreview.test.tsx`.

**M3. Konsolidacja 6 najczęstszych napisów klas w klasy komponentowe** · CSS · [S] **−13,2 KB raw, gz ≈ 0**.

- Bez tytułu kinetic, bo jego klasy reguluje AGENTS.md.
- Ryzyka: kolejność wewnątrz warstwy `utilities` przy kolidujących utility na tym samym elemencie. Zysk dotyczy wyłącznie tokenizacji.

### Inne

**X1. `speculationrules` z grupami URLPattern** · D · [Z na transformacji JSON] **−1 130 B** (2 334 → 1 204).

- Postać wzorca: `"{/en}?/admin{/*}?"` zamiast 4 wpisów. Plik: `src/lib/seo/speculationRules.ts:59-116`.
- Ryzyko: semantyka URLPattern. Test: `rootRoute.test.tsx` plus test dopasowań.

## 5. Ranking (bajty × bezpieczeństwo)

Bezpieczeństwo: 3 = wysokie, 2 = średnie, 1 = niskie. Bajty raw w KB.

| #   | Pozycja                                         | Rodzaj          |             Raw |             gz | Bezp. | Wynik | Status                            |
| --- | ----------------------------------------------- | --------------- | --------------: | -------------: | ----: | ----: | --------------------------------- |
| 1   | I1 P3.2 drabina + awatary 1x/2x                 | D               |            28,4 |            0,9 |   2,5 |    71 | zaplanowane (W3)                  |
| 2   | S1 minifikacja statycznych literałów CSS        | D               |  10,1 (+7,4 JS) |            3,5 |     3 |    30 | **nowe**                          |
| 3   | I2 P4.2 względne URL-e (po I1)                  | D               |            10,3 |            0,5 |   2,5 |    26 | zaplanowane (W4)                  |
| 4   | I3 awatar `src` 1x + `srcset` 2x                | D               |             7,2 |            0,7 |     3 |    22 | **nowe** (rozszerzenie P3.2)      |
| 5   | S2 szablon HW-2 dla „common”                    | **CSS**         | 10,9 (CSS +4–6) | 1,0 (CSS +0,4) |   1,5 |    16 | **nowe** (rozszerzenie P2.4)      |
| 6   | M1 baza ramki `[data-w-id]` i sekcji jako klasy | ~D              |    7,8 (+3 [S]) |            0,4 |     2 |    16 | **nowe** (kontynuacja P2.6)       |
| 7   | T1 kompaktowa koperta zapytań                   | D               |             6,1 |            0,4 |   2,5 |    15 | **nowe**, każda strona            |
| 8   | M2 byline jako klasy                            | ~CSS (mały)     |             7,5 |            0,8 |     2 |    15 | **nowe**                          |
| 9   | M3 konsolidacja klas                            | **CSS**         |        13,2 [S] |             ~0 |     1 |    13 | opcja                             |
| 10  | I4 kompaktowe parametry `/media`                | D (URL)         |         8,5 [S] |           ~0,5 |   1,5 |    13 | opcja po P4.2                     |
| 11  | T2 zajawki tylko renderowane                    | D               |             4,9 |            0,9 |     2 |    10 | **nowe** (lustro P2.5)            |
| 12  | S3 `[data-sidebar]` do arkusza admina           | **CSS** (admin) |             3,6 |            0,4 |   2,5 |     9 | **nowe**                          |
| 13  | T3 publiczny klucz menu                         | D               |         3,0 [S] |              — |     2 |     6 | **nowe** (zamyka odstępstwo P2.5) |
| 14  | T6 `heroPreloads` poza przesyłką                | D               |             1,8 |            0,2 |     3 |     5 | **nowe**                          |
| 15  | X1 speculationrules z URLPattern                | D               |             1,1 |              — |     3 |     3 | **nowe**                          |
| 16  | T5 `seoSettings` jako referencja                | D               |             1,0 |            0,4 |     3 |     3 | **nowe**                          |
| 17  | T4 pasek z językiem w kluczu                    | D               |         1,5 [S] |              — |     2 |     3 | przekazanie P2.5                  |

Proponowana kolejność wdrożenia:

1. **Pakiet czysto D w jednym PR:** S1, I3, T1, T5, T6, X1. Razem [Z] −27,4 KB raw / ≈ −5,3 KB gz, bez zmian dostawy CSS i kaskady. I3 mierzone po I1/I2; samodzielnie daje ok. −7,7 KB [S].
2. Potem T2 i T3/T4, czyli projekcje kluczowane jak w P2.5.
3. M1 i M2 z sondą `getComputedStyle`.
4. S2 i S3 jako jedyne zmiany dostawy CSS. S2 tylko z pomiarem A/B ParseHTML i UpdateLayoutTree.
5. I1 i I2 zostają w P3.2/P4.2. Tylko trzeba dopisać do nich preload i `Link` (klucz) oraz I3.

Stan po pakiecie z symulacji (wszystkie pozycje _sym_): **401 096 B raw / 63 407 B gz**. Z pozycjami [S] (T3, T4, X1, I4, M3) wychodzi ok. 373 KB raw [S]. Cel 200 KB z `document-weight-budgets.json` nadal jest nieosiągalny bez zmiany renderu: ukryty desktopowy nagłówek, slajdy poza ekranem (zob. html-weight §6 fazy 1).

## 6. Bramki i testy do aktualizacji

**`scripts/performance/document-weight-budgets.json`**, ratchet po każdej pozycji (progi wolno tylko obniżać):

- `htmlRawBytes`, `htmlGzipBytes`;
- `headRawBytes`: S1 zdejmuje 2,8 KB z hoistowanego bloku slidera, X1 1,1 KB;
- `inlineStyleBytes`, `inlineStyleCount`: S2 to −5 bloków na produkcji, na fixture zależnie od dokumentu;
- `dehydratedStateBytes`.

Uwaga: `measured` `inlineStyleCount` = 50 jest sprzed P2.4. Na produkcji jest 26 bloków.

**`scripts/performance/documentWeight.ts`**, nowe metryki:

1. `streamedStateBytes`: skrypty `$R["tsr"]`/`.next(` strumienia. Dziś 9,8 KB poza każdą metryką (luka §2.2).
2. `dehydratedQueryHashCount` = 0 (T1).
3. `inlineCssCommentBytes` = 0 (S1).
4. `legacyTypographyBlocks` (`style[data-wt-css]`), z progiem z pomiaru (S2).
5. `srcsetCandidatesMax` ≤ 5 oraz `avatarSrcsetCandidates` ≤ 1 (I1, I3).
6. `absoluteSameOriginMediaInMarkup` = 0 w `src`/`srcset`/`imagesrcset` (I2).

Do tego budżet ładunku per zapytanie (HW-7 → P6.1) z dekodowaniem `$tsr`. Parser `w3/diag/tools/seroval_parse.py` pokazuje, że da się to zrobić bez wykonywania JS.

**`src/lib/ci/__tests__/dehydratedPayload.test.ts`**, nowe zakazy:

- `excerpt_*` w zapytaniach widgetów bez zajawki (T2);
- `label_en` i `ref_id` w publicznym kluczu menu PL (T3);
- `title_en` w pasku PL (T4).

**Pozostałe testy i bramki:**

- T1: nowy test round-trip kompaktowania koperty; `queryStreamGuard.test.ts`; `check:ssr-budgets` bez zmian (`dehydrationWritesPerLoader` 11, dosłowne `shouldDehydrateQuery`).
- S2, M1, M2, M3: `check:bundle` `publicCss` (zamrożony budżet).
- S1: `check:bundle` spada (chunk wejściowy i `sliderVariants`).
- T5, I2: `compare-head-meta.mjs` (meta i JSON-LD bajt w bajt).
- S2, M1, M2, M3: sonda parytetu `getComputedStyle` z P2.6.

**Pułapki pomiaru:**

- Fixture (`e2e/fixtures/first-visit.json`, `homeFixture.ts`) nie ma menu nagłówka i ma inny dokument strony głównej. T2 i T3 mogą tam dać ≈0.
- Dowód produkcyjny: `check-document-weight.ts --html <HIT>`. Uwaga: ten tryb zapisuje `reports/document-weight.json`.
- `d1.html` (MISS, `degraded`, 185 KB, 5 sekcji) nie nadaje się do porównań.

## 7. Trace'y LH (prod, mobile, 4×): co bajty ruszają, a czego nie [Z obserwowane, ×4 = S]

Źródła: `mobile-2-0.trace.json` i `mobile-3-0.trace.json`. Dokumenty z przebiegów LH mają inną numerację linii niż `d2` (inny wariant cache), więc przypisanie bajtów do pozycji jest przybliżone.

- **ParseHTML:** cztery plasterki po ok. 10 ms obs. (≈40–46 ms sym.), razem ≈47–50 ms obs. (≈0,1 ms/KB obs.). Plasterki są tuż pod progiem 50 ms na tym hoście; na wolniejszym hoście PSI przekraczają go.
  - W najdłuższym plasterku największy skrypt inline (pozycja bariery `$tsr`) to `v8.compile` 4,4–5,7 ms + `EvaluateScript` 6,3–8,5 ms obs. To ≈70 % plastra.
  - Skutek diety [S]: −100 KB to ok. −10 ms obs. (≈−40 ms sym.) parsowania, czyli mniej plasterków, a nie krótsze plasterki. Koniec zadania pierwszej klatki, które dla Lantern SI jest zadaniem z Layout, przesuwa się wcześniej o ten sam rząd.
- **Pierwsza klatka:** jedno zadanie 174 ms (mobile-2) / 138 ms (mobile-3) obs., czyli ≈550–700 ms sym.:
  - Layout 106 / 69 ms przy `dirtyObjects` = `totalObjects` = 660;
  - UpdateLayoutTree 39 / 34 ms (649 elementów);
  - RunMicrotasks 12 / 21 ms;
  - ParseAuthorStyleSheet arkusza 541 KB to osobne 7,5 ms.
    To zadanie tylko w niewielkim stopniu zależy od bajtów HTML-a. Decydują o nim: rozmiar DOM (1 404 elementy), arkusz z 6 212 regułami i koszt layoutu.
  - **Kryterium P3.3 („zadanie pierwszej klatki ≥ 50 ms sym.”) jest spełnione kilkukrotnie**, więc P3.3 (`content-visibility` sekcji ≥2) i P4.1 (podział rdzenia CSS) są właściwymi lekami.
  - RunMicrotasks wewnątrz klatki warto przypisać osobno: kod, nie bajty.

## 8. Odrzucone lub nierekomendowane teraz

- **Projekcja `site_settings_public.all` (25,4 KB):** werdykt HW-3 (d). `theme_design`, `font_sizes` i `seo` są czytane w pierwszym renderze; `auth_branding` czytany jest bezpośrednio z cache; admin (`useSettings`) dzieli klucz, więc projekcja na wspólnym kluczu oznacza utratę danych przy zapisie. Bezpiecznie dałoby się zdjąć ok. 0,4 KB (`menu_primary`, `permalinks`, `media`).
- **Względne URL-e w danych stanu:** P4.2 celowo ogranicza zakres do renderu. Dane karmią OG i JSON-LD.
- **`builder_data` per język (HW-3f, ≈1,6 KB `*_en`) i zwijanie trójek urządzeń (35 trójek, 1,8 KB):** wymaga języka w kluczu `["public","home-page"]` albo zmiany modelu danych edytora; zysk za mały.
- **Internowanie identycznych wierszy postów (HW-3h):** po T2 zostaje ≈2–3 KB powtórzeń tytułów, a kształty wierszy różnią się między zapytaniami. Ewentualnie później.
- **Przeniesienie mostu marki, `TICKER_CSS` i `SHARED_STYLES` do `styles.css` (HW-1):** werdykt bez zmian. W reżimie C3 netto +25–30 ms FCP/LCP i przekroczony `publicCss`. Tylko po P4.1.
- **Deduplikacja `.sbw-*` (2 KB):** hoisting zmienia pozycję w kaskadzie (werdykt HW-1 pkt 3).
- **Zagnieżdżanie CSS albo `:is()` na zakresie w blokach `data-wt-css`:** zmienia specyficzność albo wsparcie przeglądarek.
- **Niepublikowanie slajdów poza ekranem i ukrytego nagłówka desktopowego:** to zmiana renderu (SEO, CLS, hydratacja).

## 9. Uwagi

- Uruchomienie `node scripts/performance/check-document-weight.ts --html d2.html` zapisało `reports/document-weight.json` w repo (ścieżka w `.gitignore`). Plik przeniesiony do `w3/diag/document-weight-d2.json`; repo jest czyste (`git status` pusty).
- Wynik gate'u na `d2`: `htmlRawBytes` 489,0 KiB, `htmlGzipBytes` 71,9 KiB, `dehydratedStateBytes` 87,0 KiB, `inlineStyleBytes` 83,1 KiB, `inlineScriptBytes` 111,9 KiB (progi fixture nie dotyczą produkcji).
- Nie uruchamiano buildów ani zestawów testów.
