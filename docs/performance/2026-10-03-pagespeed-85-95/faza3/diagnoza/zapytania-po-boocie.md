# Diagnoza: żądania Supabase REST po boocie anonimowej `/` (W3, client-refetch)

Badanie tylko do odczytu na `7c924ae5` (bez buildów i testów). Dowody pochodzą z kodu (plik:linia) oraz z artefaktów
w `scratchpad/w3`: `prod-lh/*-0.devtoolslog.json` (Lighthouse 13 na produkcji, 3×mobile i 3×desktop),
`base/lh/*.artifacts/devtoolslog.json` (uprząż lokalna, fixture) i dokumentów SSR `prod/d2.html` oraz
`base/lh/home.html` (zdekodowane `queryHash` i `dataUpdatedAt`).

## 0. Najkrócej

| Żądanie (tabela)                         | Kto i kiedy (anonim, `/`)                                                                                                                                                                | Dlaczego idzie mimo SSR                                                                                                                                                                                                                  | Potrzebne przy boocie?                                                                                                    | Poprawka (ranga)                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `site_design_tokens`                     | `useFontScale()` w `DesignTokensStyle` (korzeń, poza wyspami), efekt hydratacji                                                                                                          | klucz `["site_font_scale"]` **nie jest grzany** w loaderze korzenia, więc nie ma go w stanie SSR (tokeny i kolory są)                                                                                                                    | nie: CSS już jest w `<style data-brand-tokens>`; dziś zbędny round-trip, a przy niepustym `font_scale` późna zmiana stylu | **#1** dołożyć `fontScaleQueryOptions` do fali 1 korzenia (0 dodatkowych podżądań, wspólny wiersz)            |
| `post_layout_settings`                   | `usePostLayoutSettings()` w `ContentAreaStyle` (korzeń), efekt hydratacji                                                                                                                | zasiew korzenia z `updatedAt: 0`, czyli celowo przeterminowany, więc przy montażu idzie refetch                                                                                                                                          | **nie na `/`**: na stronie głównej nie ma ani jednego elementu, w który celuje ten CSS                                    | **#3** nie odświeżać zasiewu przy montażu, tylko w punkcie ciszy; opcjonalnie grzać tam, gdzie jest konsument |
| `ad_placements` `footer_slideup`         | `FooterSlideup` w treści trasy `/` (`routes/index.tsx:452`), efekt hydratacji                                                                                                            | nikt tej pozycji nie grzeje w SSR                                                                                                                                                                                                        | nie: pasek pokazuje się po `delay_ms` (domyślnie 3 s) i po przydziale slotu nakładek                                      | **#2** pobranie po pierwszej interakcji albo w punkcie ciszy, opóźnienie liczone od startu nawigacji          |
| `ad_placements` `header_banner` (czasem) | `AdZone` w `Header` (chrome), efekt hydratacji                                                                                                                                           | jest w SSR, ale `staleTime` wynosi 60 s; dokument z brzegu starszy niż 60 s jest już nieświeży (prod mobile-3: HIT, wiek 74 s). Prod desktop-1 (MISS): najpewniej rozgrzewka nie zmieściła się w budżecie chrome strony głównej (500 ms) | nie: SSR ma dane i zarezerwowane piksele                                                                                  | **#5** odroczyć odświeżenie „z wieku" do punktu ciszy                                                         |
| `newsletter_settings`                    | `NewsletterPopup` przy `overlaysReady` (`afterPageLoad` + bezczynność, limit 3 s), czyli po `load`, w śladzie LH                                                                         | pełny klucz `["newsletter-settings"]` celowo nie jest w SSR (P2.5: w SSR jest tylko projekcja `inline`)                                                                                                                                  | nie przy boocie: popup ma własny wyzwalacz (opóźnienie, przewinięcie, exit-intent) i bramkę częstotliwości                | **#4b** montaż w punkcie ciszy lub po interakcji, opóźnienie liczone od startu nawigacji                      |
| `builder_popups`                         | `PopupHost` przy `overlaysReady` (jak wyżej)                                                                                                                                             | klucz `["builder-popups-active"]` nigdy nie jest grzany, więc bramka `useNoActivePopupsFromSsr` jest martwa i host montuje się zawsze                                                                                                    | nie: na produkcji odpowiedź ma ~1,3 KB z nagłówkami, prawie na pewno `[]`                                                 | **#4a** grzać w SSR sygnał „brak aktywnych popupów" (host się wtedy nie montuje); **#4b** jak wyżej           |
| `categories` + `tags`                    | `useInterestCatalog` przez `useInterestGroups` w `JoinUsForm` i `NewsletterForm`, przy **otwarciu wyspy sekcji** (widoczność, pierwsza interakcja, w tym przewinięcie, albo punkt ciszy) | klucz `["interests-catalog", lang]` nie jest w SSR, a hook woła się bezwarunkowo                                                                                                                                                         | nie: tylko dla listy zainteresowań, a ta i tak renderuje się dopiero po danych                                            | **#6** pobierać przy intencji otwarcia listy (lub przy `chips`)                                               |

**„DWA RAZY" na produkcji to przede wszystkim preflight.** W `network-requests` LHR każda z pięciu tabel ma dwa
wpisy: jeden `resourceType: "Preflight"` (OPTIONS) i jeden `"Fetch"` (GET) pod tym samym URL-em
(`prod-lh/mobile-1.json`). Prawdziwych duplikatów GET jest mniej:

- `ad_placements` to dwie **różne** pozycje (`header_banner` i `footer_slideup`);
- odświeżenie zależne od wieku dokumentu: przy HIT w wieku 74 s na `prod-lh/mobile-3` poszły `header_banner` i
  `profiles_public`, oba z `staleTime` 60 s.

Preflight jest nieunikniony dla każdego **innego** URL-a: supabase-js wysyła nagłówki
`apikey, authorization, x-client-info, x-tenant-host, accept-profile`, a `Access-Control-Max-Age` wynosi 3600.
Lighthouse startuje z czystym profilem, więc płaci preflight za każde żądanie. URL `ad_placements` zawiera znacznik
czasu w milisekundach (`queries.ts:96`), więc jego preflightu nie da się zbuforować nigdy.

Ranking (żądania usunięte z bootu × bezpieczeństwo), szczegóły w §4:

1. #1 rozgrzewka `fontScale`;
2. #2 `FooterSlideup` po punkcie ciszy;
3. #3 bez refetchu zasiewu `post_layout_settings`;
4. #4a bramka popupów z SSR;
5. #4b nakładki w punkcie ciszy;
6. #5 polityka odświeżania „z wieku";
7. #6 katalog zainteresowań na żądanie;
8. #7 kwantyzacja czasu w URL-u reklam.

Po #1 do #4 w oknie Lighthouse'a nie zostaje żaden z dziesięciu wpisów (5 GET + 5 OPTIONS). #1 do #3 to łatki lokalne
o niskim ryzyku.

---

## 1. Dowody z pomiarów

### 1.1 Produkcja (Lighthouse, `prod-lh/*-0.devtoolslog.json`), tylko GET-y REST

| Przebieg  | Dokument (`x-nes-cache`, wiek) | GET-y (ms od startu)                                                                                                                                 |
| --------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| mobile-1  | MISS                           | `site_design_tokens` 11157, `post_layout_settings` 11158, `ad_placements[footer_slideup]` 11422, `newsletter_settings` 13927, `builder_popups` 13934 |
| mobile-2  | STALE, 38 s                    | ten sam zestaw (2840 … 4193)                                                                                                                         |
| mobile-3  | HIT, **74 s**                  | jak wyżej **+ `ad_placements[header_banner]` 2707 + `profiles_public` 2785**                                                                         |
| desktop-1 | MISS                           | jak wyżej **+ `ad_placements[header_banner]` 3435**                                                                                                  |
| desktop-2 | MISS                           | zestaw podstawowy                                                                                                                                    |
| desktop-3 | MISS                           | zestaw podstawowy                                                                                                                                    |

- Dwie fale: (a) efekty hydratacji, czyli tokeny, układ treści i `footer_slideup`; (b) około 1–2,5 s później
  `newsletter_settings` i `builder_popups`. Fala (b) startuje po chunkach `NewsletterPopup-*.js` i `PopupHost-*.js`
  (mobile-1: chunki w 11944/11956 ms, żądania w 13927/13934 ms), czyli przy `overlaysReady`.
- Stos inicjatora wszystkich GET-ów to `index-*.js` (Da < Ma < Zx), potem `vendor-supabase`. To cache zapytań, nie
  pobrania spoza React Query.
- Chunk generatora `designTokensCss-*` nie ładuje się w żadnym przebiegu. Odpowiedź `site_design_tokens` daje więc ten
  sam skrót wejścia co SSR: `font_scale` na produkcji jest pusty, a żądanie to czysta strata (§3.1).
- Rozmiary odpowiedzi z nagłówkami: `builder_popups` 1336 B, `ad_placements` około 1675 B. Przy około 1,2–1,3 KB
  nagłówków PostgREST to prawie na pewno puste tablice. `newsletter_settings` ma 4695 B (pełny wiersz).

### 1.2 Uprząż lokalna (`base/lh/*`, fixture)

- Ten sam zestaw: `site_design_tokens`, `post_layout_settings`, `ad_placements[footer_slideup]` (około +100 ms), potem
  `newsletter_settings` i `builder_popups` (około +300–600 ms).
- Na desktop-1 (HIT, 82 s) i desktop-2 (HIT, 133 s) dochodzi drugi `ad_placements`. Na desktop-2 dodatkowo 8× `posts`,
  czyli zapytania z krótkim `staleTime`.
- `categories` i `tags` nie pojawiły się w tych dziewięciu przebiegach. Mechanizm opisuje §3.7: pojawiają się dopiero
  przy otwarciu wyspy sekcji z `join-us` (fixture: `home-body[0].builder_data.sections[6]`). Wyspy mają domyślnie
  zapas `quiescent: true` (`lib/performance/hydrationIsland.tsx:86,885`), więc w dłuższym oknie obserwacji przychodzą
  po punkcie ciszy, a u czytelnika po pierwszym przewinięciu.

### 1.3 Stan odwodniony `/` (produkcja `prod/d2.html`, fixture `base/lh/home.html`)

19 wpisów: `site_settings_public`, `site_design_tokens`, `site_global_colors`, `public×2`, `menu-with-items×2`,
`post-layout-settings`, `header_ticker`, `ad_placements["header_banner","home",null]`, `builder-post-list×5`,
`builder-slider-posts`, `builder-slider-fallback-images`, `builder-slider-authors`, `newsletter-settings["inline"]`.

- **Brak:** `site_font_scale`, `ad_placements[footer_slideup]`, `newsletter-settings` (pełny), `builder-popups-active`,
  `interests-catalog`.
- `post-layout-settings` ma `dataUpdatedAt: 0`: to zasiew, nie dane.
- Bajty CSS: `<style data-brand-tokens>` ma 26 732 B i **nie zawiera żadnej zmiennej `--fs-*`** (SSR renderuje
  `EMPTY_FONT_SCALE`).

---

## 2. Mechanizm ogólny: kiedy wpis z SSR i tak idzie do sieci

- `src/router.tsx:71`: domyślny `staleTime` 5 min. `router.tsx:92`: dehydratowane są wyłącznie zapytania w stanie
  `success`.
- `refetchOnMount` jest domyślny (`true`). Zapytanie odwodnione, które jest nieświeże w chwili montażu obserwatora,
  idzie do sieci przy hydratacji.
- Nieświeżość ma trzy źródła:
  1. **Brak wpisu w SSR.** Zapytanie użyte w renderze serwera bez suspense i bez rozgrzewki zostaje w stanie
     `pending`/`idle`, filtr go nie przepuszcza, a klient pobiera je przy montażu. Dotyczy `site_font_scale`,
     `footer_slideup`, `interests-catalog`, a także popupów (montowanych dopiero na kliencie).
  2. **Zasiew z `updatedAt: 0`.** To doktryna „leczenia" po degradacji (`__root.tsx:870-911`, test
     `rootRoute.test.tsx:459-464`). Dotyczy `post-layout-settings`, który jest zasiewany **zawsze**, nie tylko po
     degradacji.
  3. **Wiek dokumentu z brzegu.** `dataUpdatedAt` to czas renderu SSR. NES Edge Cache trzyma dokument świeżym do
     180 s, a potem serwuje go STALE do 24 h z rewalidacją w tle (`lib/http/documentCache.ts`,
     `DOCUMENT_CACHE_MAX_FRESH_MS = 180_000`, `DOCUMENT_CACHE_MAX_SWR_MS = 24 h`; nagłówek w uprzęży:
     `s-maxage=900, stale-while-revalidate=86400`). Każde zapytanie z `staleTime` krótszym niż wiek dokumentu
     refetchuje przy hydratacji. Przy 60 s są to:
     - `ad_placements` (`lib/ads/queries.ts:61,185`);
     - `builder-slider-authors` (`lib/builder/sliderAuthorsQuery.ts:64-66`);
     - `newsletter-settings` w obu wariantach (`hooks/useNewsletterSettings.ts:223,340`);
     - `interests-catalog`.

     Przy dokumencie STALE starszym niż 5 min refetchuje praktycznie każdy zamontowany wpis z §1.3: menu, listy
     wpisów, pasek, ustawienia, tokeny. To niewidoczne w Lighthouse (dokument rzadko ma tam ponad 180 s), ale
     prawdziwe dla czytelników serwisu o małym ruchu.

---

## 3. Żądanie po żądaniu

### 3.1 `site_design_tokens` (`select=colors,fonts,scale,global_colors,font_scale`)

**Kto i kiedy.** `DesignTokensStyle` jest zamontowany w korzeniu (`routes/__root.tsx:1482`), poza wyspami i poza
`SiteChrome`. Woła trzy hooki: `useDesignTokens()`, `useGlobalColors()` i `useFontScale()`
(`components/DesignTokensStyle.tsx:45-48`). Wszystkie trzy `queryFn` czytają ten sam wiersz przez
`fetchSiteDesignTokensRow()` (`lib/builder/designTokens.ts:81-105`), z dedupem w locie tylko w przeglądarce i z
`edgeTtlCache("site_design_tokens:row", 60 s)` na serwerze (single-flight: `lib/ssrCache.ts:352-356`).

**Klucze i opcje.**

| Klucz                    | Plik                             | `staleTime` |
| ------------------------ | -------------------------------- | ----------- |
| `["site_design_tokens"]` | `designTokens.ts:52,107-128`     | 5 min       |
| `["site_global_colors"]` | `hooks/useGlobalColors.ts:13-29` | 5 min       |
| `["site_font_scale"]`    | `hooks/useFontScale.ts:16-28`    | 5 min       |

**SSR.** Fala 1 korzenia grzeje wyłącznie `siteSettings`, `designTokens` i `globalColors`
(`__root.tsx:843-850`). Lista anulowania strony głównej (`:855-859`) i zasiewy (`:888-897`) też nie znają
`fontScale`. Render serwera woła `useFontScale()` bez danych (useQuery bez suspense nie pobiera w SSR), więc CSS
powstaje z `EMPTY_FONT_SCALE` (zero `--fs-*` w HTML). Wpis `site_font_scale` jest `pending` i filtr
`shouldDehydrateQuery` go nie przepuszcza.

**Dlaczego refetch.** Brak wpisu, więc fetch przy montażu `useFontScale` na kliencie. Tokeny i kolory są świeże i nie
pobierają się, więc dedup w locie nic tu nie scala: idzie jeden pełny GET wiersza tylko po `font_scale`. Przy
dokumencie starszym niż 5 min dołączają tokeny i kolory, ale dedup zbija je do tego samego jednego GET-u.

**Czy potrzebne.** Nie. `useDeferredStyleCss` w przeglądarce czyta blok z DOM-u
(`components/theme/useDeferredStyleCss.ts:46-49`) i przelicza go tylko przy różnicy skrótu (`:51-69`).

- Produkcja: `font_scale` pusty, skrót bez zmian, więc żądanie, preflight, parsowanie JSON i re-render korzenia idą na
  marne.
- Tenant z niepustym `font_scale`: po hydratacji ładuje się 44 kB generatora (`designTokensCss` →
  `globalColors.ts`), przepisuje się 26,7 KB `:root`, a rozmiary czcionek zmieniają się na oczach czytelnika. To
  późna zmiana wizualna (SI) i potencjalnie CLS. Dziś jest to błąd utajony.

**Poprawka #1 (zalecana).** W `__root.tsx` dołożyć `context.queryClient.ensureQueryData(fontScaleQueryOptions)` do
`Promise.allSettled` fali 1 (`:843-850`), klucz do pętli anulowania (`:855-859`) i zasiew
`EMPTY_FONT_SCALE, { updatedAt: 0 }` obok `:888-897`.

- **Koszt serwera: zero podżądań.** Ten sam `fetchSiteDesignTokensRow` jest single-flight w `edgeTtlCache`, czyli
  trzy zapytania i jeden lot. Dokładnie to samo uzasadnienie stoi przy `globalColors` w `__root.tsx:815-825`.
- **Ładunek:** znormalizowana mapa liczb, na produkcji `{}`.
- **Efekt:** −1 GET i −1 OPTIONS na **każdej** trasie, u każdego odwiedzającego. SSR ma od razu prawdziwe `--fs-*`.
- **Wariant B (większy):** jeden klucz wiersza `["site_design_tokens","row"]` i trzy hooki przez `select`. Usuwa
  podwójne dane w stanie odwodnionym i zbędną dedupę, ale dotyka trzech mutacji admina (`setQueryData` na trzech
  kluczach: `designTokens.ts:154`, `useGlobalColors.ts:46`, `useFontScale.ts:46`). Nie jest potrzebny do usunięcia
  żądania.

**Ryzyko: niskie.**

- Admin: zapis nadal robi `setQueryData` na kluczu `site_font_scale`. `SiteSettingsLiveSync` i tak nie inwaliduje
  kluczy tokenów, więc bez zmiany.
- EN: klucz bez języka.
- Zalogowani: ten sam anonimowy dokument.
- Purge: wiek danych taki sam jak tokenów (do wieku dokumentu).
- Degradacja: zasiew z `updatedAt: 0` leczy się refetchem, jak tokeny.

**Testy.**

- `routes/__tests__/rootRoute.test.tsx`: atrapa `fontScaleQueryOptions` obok `:168-175`; asercja zasiewu w teście
  `:432-440`; rozgrzewka i anulowanie dla strony głównej.
- `hooks/__tests__/useFontScale.test.tsx` i `lib/builder/__tests__/designTokens.test.tsx`: trzy zapytania dają jeden
  fetch.
- `lib/ci/__tests__/dehydratedPayload.test.ts`: `homeState` ma `["site_font_scale"]`.
- Nowy test kliencki: `DesignTokensStyle` po hydratacji ze stanem zawierającym `site_font_scale` nie woła
  `supabase.from`.
- `check:document-weight`: kilkadziesiąt bajtów.

### 3.2 `post_layout_settings` (`select=*`)

**Kto i kiedy.** `ContentAreaStyle` jest zamontowany w korzeniu (`__root.tsx:1483`) i woła `usePostLayoutSettings()`
(`components/ContentAreaStyle.tsx:116`). Pobranie startuje w efekcie hydratacji.

**Klucz i opcje.** `["post-layout-settings"]`, `staleTime` 5 min, `edgeTtlCache` 60 s
(`hooks/usePostLayoutSettings.ts:7-27`).

**SSR.** Fala 1 świadomie **nie grzeje** tego klucza siecią (`__root.tsx:785-812`); grzeje go tylko `$.tsx:372`.
Korzeń zasiewa `defaultPostLayoutSettings()` z `updatedAt: 0` (`__root.tsx:906-911`; test
`rootRoute.test.tsx:459-464` wymaga zera).

**Dlaczego refetch.** Wpis jest w stanie odwodnionym (prod: `dataUpdatedAt:0`), ale nieświeży z konstrukcji, więc
refetch przy montażu, zawsze i na każdej trasie bez własnej rozgrzewki: `/`, archiwa, wyszukiwarka, blog.

**Czy potrzebne na `/`. Nie.** Kontrola znacznika produkcyjnego `/` po zdjęciu `<style>` i `<script>`:

| Selektor z `ContentAreaStyle`                                                   | Liczba elementów na `/` |
| ------------------------------------------------------------------------------- | ----------------------- |
| `.post-content`, `.single-post-content`, `.blocks-content`, `[data-block-type]` | 0                       |
| `figcaption`                                                                    | 0                       |
| `[data-builder-renderer]`                                                       | 3                       |
| `.cms-rich-content`                                                             | 2                       |

- `[data-builder-renderer]` dostaje tylko zmienną `--cms-paragraph-spacing`, którą czytają wyłącznie reguły
  `[data-block-type=…]`. Na `/` nie ma żadnego takiego elementu.
- Reguła dla `.cms-rich-content` jest statyczna (nie zależy od wiersza).

Wiersz najemcy nie ma więc na stronie głównej żadnego efektu wizualnego.

**Poprawka #3.**

- **(a)** W `ContentAreaStyle` przekazać
  `refetchOnMount: (q) => q.state.dataUpdatedAt === 0 ? false : true`. Wtedy:
  - zasiew nie odświeża się w hydratacji;
  - odświeżenie przechodzi na wspólny „zapas": `enqueue(…, {priority:"overlays"})` (pierwsza interakcja) plus
    `onQuiescent(…, {priority:"overlays"})`, wołające `queryClient.prefetchQuery(postLayoutSettingsQueryOptions())`.
    To ten sam wzorzec co `useDecorativeMotion` w `components/header/TrendingTicker.tsx:102-114`.
- **(b, opcjonalnie)** Grzać klucz w rejestrze prefetchu widgetów (`lib/builder/prefetch.ts`) tylko dla typów, które
  renderują `.single-post-content` lub `[data-block-type]`:
  - `RichTextView` (`BlocksRenderer`);
  - `TeamMember*Widget`;
  - trasy z `ContentRenderer`: `support.tsx`, `checkout.success.tsx`, `EventModulePage`.

  SSR ma wtedy wartości najemcy dokładnie tam, gdzie mają konsumenta, a reszta serwisu nie płaci nic.

- Nawigacja SPA na wpis nie zmienia się: loader `$.tsx` woła `prefetchQuery`, a zasiew z zerem jest nieświeży, więc
  pobiera.

**Efekt:** −1 GET i −1 OPTIONS z bootu na każdej trasie bez własnej rozgrzewki.

**Ryzyko.**

- Na `/`: zerowe.
- Na trasach z treścią bez rozgrzewki (support, checkout.success, moduły wydarzeń, builderowe `RichText` z blokami):
  typografia treści zmieni się z domyślnej na wartość najemcy w punkcie ciszy lub przy interakcji zamiast zaraz po
  hydratacji (późniejsza zmiana, jeśli wartości się różnią). Wariant (b) to zamyka.
- Admin (`useSavePostLayoutSettings` → `invalidateQueries`): bez zmian, bo inwalidacja pobiera niezależnie od
  `refetchOnMount`.
- Komentarz w `__root.tsx:789-812` („klient dociągnie wiersz natychmiast po hydratacji") trzeba przepisać.

**Testy.**

- `rootRoute.test.tsx:441-472` zostaje: zasiew nadal ma `updatedAt: 0`.
- Nowy test `ContentAreaStyle`: brak fetchu przy montażu z zasiewem, fetch po atrapie `onQuiescent` i po pierwszej
  interakcji.
- `hooks/__tests__/usePostLayoutSettings.test.tsx`.
- Dla (b): `lib/builder/__tests__/sectionPrefetch.test.ts` i `dehydratedPayload.test.ts`.

### 3.3 `ad_placements` / `footer_slideup`

**Kto i kiedy.** `<FooterSlideup pageType="home" />` stoi w komponencie trasy `/` (`routes/index.tsx:452`), poza
wyspami, i woła `useAdPlacements("footer_slideup","home")` (`components/ads/FooterSlideup.tsx:21`). Pobranie startuje w
efekcie hydratacji. Ten sam komponent jest na `$.tsx:1796,1816,1881`, `blog.index.tsx:257`, `search.tsx:875` i w
`ArchiveBody.tsx:138`.

**Klucz i opcje.** `["ad_placements","footer_slideup","home",null]`, `staleTime` 60 s (`lib/ads/queries.ts:165-188`).

**SSR.** Korzeń grzeje wyłącznie `header_banner` (`__root.tsx:964-993,1032`). Komentarz przy `:964-967` mówi wprost,
że `footer_slideup` należy do treści trasy, a loader `/` tej pozycji nie grzeje. Wpisu brak.

**Czy potrzebne przy boocie. Nie.**

- Pasek jest `fixed` (nie przesuwa układu).
- Pojawia się po `delay_ms` (domyślnie 3000 ms od pobrania danych, `FooterSlideup.tsx:41`) i dopiero po przydziale
  slotu przez `overlayCoordinator` (`:46-53`), z najniższym priorytetem.

**Poprawka #2.**

- `FooterSlideup` uzbraja zapytanie (`enabled`) dopiero po pierwszej interakcji lub w punkcie ciszy (wzorzec
  `TrendingTicker.tsx:102-114`; wspólny hook, np. `useAfterInteractionOrQuiet()`).
- Opóźnienie liczy od startu nawigacji: `setTimeout(…, Math.max(0, delay - performance.now()))` przy pierwszym
  montażu w dokumencie. Widoczny moment pojawienia się nie przesuwa się więc istotnie: dziś to hydratacja + fetch +
  3 s, co na mobile LH daje ~14 s; po zmianie max(cisza, 3 s).
- Alternatywa „0 żądań klienta": grzać `footer_slideup` razem z banerem w korzeniu jednym `in.(…)`
  (`prefetchAdPlacementQueries`, `queries.ts:227-283`). **Odradzam:** kreacja (html/script) trafiłaby do dokumentu,
  a 60-sekundowy `staleTime` i tak wywoła refetch przy dokumencie starszym niż minuta.

**Efekt:** −1 GET i −1 OPTIONS na `/` (i na pozostałych trasach z paskiem).

**Ryzyko: niskie.** Pasek nie pokaże się, zanim strona się nie uspokoi albo czytelnik czegoś nie dotknie. Dla zgód nic
się nie zmienia (ta sama bramka koordynatora).

**Testy:** `components/ads/__tests__/footerSlideup.test.tsx` (bramka `enabled`, opóźnienie od startu nawigacji).

### 3.4 `ad_placements` / `header_banner` (tylko część przebiegów)

**Kto i kiedy.** `<AdZone position="header_banner">` w `Header` (`components/Header.tsx:268`), czyli chrome, nie wyspa.
Efekt hydratacji.

**SSR.** `chromeWarm.push(() => ensureQueryData(headerAds))` (`__root.tsx:988-993,1032`) w budżecie chrome strony
głównej, czyli `remainingHomeBudget(…, CHROME_WARM_BUDGET_MS = 500)` (`__root.tsx:144,950`). W `prod/d2.html` wpis jest
obecny.

**Dlaczego refetch.**

- (a) `staleTime` 60 s a dokument z brzegu starszy niż minuta. Dowód: mobile-3 (HIT 74 s) refetchuje dokładnie oba
  60-sekundowe klucze, `header_banner` i `builder-slider-authors` (→ `profiles_public`), a żadnego 5-minutowego.
- (b) MISS z zimnym izolatem (desktop-1: `db;dur=1323 ms`): rozgrzewka prawdopodobnie przekroczyła 500 ms budżetu
  chrome, wpis nie wszedł do stanu, więc fetch klienta.

**Czy potrzebne.** Nie przy boocie: SSR ma kreację i zarezerwowane 90 px.

**Poprawka #5** (zob. §3.8). Dla reklam punktowo: `refetchOnMount: false`, gdy wpis pochodzi z SSR, i odświeżenie w
punkcie ciszy. Okno emisji jest sprawdzane w `queryFn` (`isWithinEmissionWindow`, `queries.ts:121-145`), więc kampania
zakończona w tych sekundach może wisieć do punktu ciszy (kilka sekund). Do tego **#7**: kwantyzacja `nowIso` w
`fetchPlacementRows` (`queries.ts:96`), np. do pełnej minuty. URL staje się stabilny, preflight (`max-age=3600`) i
cache HTTP mogą być ponownie użyte przy nawigacji SPA i powrotach. Projekcja kliencka i tak doprecyzowuje okno.

**Testy:**

- `lib/ads/__tests__/queries.test.ts` i `queriesServeStale.test.ts` (filtry `or=(starts_at…)`, `updatedAt`);
- `components/ads/__tests__/adAtoms.test.tsx`.

### 3.5 `newsletter_settings` (`select=*`)

**Kto i kiedy.** `DeferredRootOverlays` → `{overlaysReady ? <NewsletterPopup/> : null}` (`__root.tsx:1289`).

- `overlaysReady` = `afterPageLoad(…, 3000)` (`__root.tsx:272-280`, `OVERLAY_IDLE_TIMEOUT_MS = 3000` w `:233`), czyli
  `load` → rAF → `whenIdle` z limitem 3 s (`lib/performance/afterPageLoad.ts:8-37`).
- `NewsletterPopup` woła `useNewsletterSettings()` bezwarunkowo w pierwszej linii (`components/NewsletterPopup.tsx:64`).
  Bramki (`popup_enabled`, ścieżka, `shownThisSession`, `shouldShow(frequency)`) biegną dopiero na danych
  (`:108-120`).

**Klucz i opcje.** `["newsletter-settings"]`, `staleTime` 60 s (`hooks/useNewsletterSettings.ts:219-225`).

**SSR.** Celowo brak: P2.5 przełączył formularze inline na `["newsletter-settings","inline"]`
(`useNewsletterSettings.ts:335-346`, `prefetch.ts`), a popup ma pobierać pełny klucz po `overlaysReady`. To decyzja
orkiestratora nr 3 w `STAN-FALI-2.md:115` („dodatkowe żądanie … poza ścieżką LCP – przyjęte").

**Problem.** „Poza ścieżką LCP" nie znaczy „poza śladem". `afterPageLoad` strzela około 1–2,5 s po `load`, więc żądanie,
preflight i chunk `NewsletterPopup` są w oknie, w którym Lighthouse czeka na ciszę sieci i CPU.

**Czy potrzebne przy boocie. Nie.**

- Wyzwalacz popupu to opóźnienie, przewinięcie albo exit-intent (`:179-247`).
- Przy zapisanej odmowie w `localStorage` i tak nic się nie pokaże.

**Poprawka #4b.**

- Montaż `NewsletterPopup` (i `PopupHost`) po `enqueue(…,{priority:"overlays"})` (pierwsza interakcja) albo
  `onQuiescent(…,{priority:"overlays"})`, zamiast `afterPageLoad(…, 3000)`. Zmiana dotyczy jednego miejsca:
  `useOverlayGates`.
- Opóźnienia wyzwalaczy liczone od startu nawigacji: `timer = setTimeout(trigger, Math.max(400, delay*1000 - performance.now()))`
  przy pierwszym uzbrojeniu w dokumencie (NewsletterPopup `:231`, PopupHost `:110-112`). Popup z opóźnieniem 15 s
  pokaże się tak jak dziś albo trochę wcześniej.
- Tanie odcięcie powracających: przy `markDismissed` zapisywać też `popup_frequency_days`. Wtedy przed `useQuery`
  można sprawdzić `shownThisSession` i świeżą odmowę, a zapytanie przejść w `enabled: false` (zero żądań u
  powracających w oknie częstotliwości).
- Duplikat w obrębie tabeli: gdy otworzy się wyspa z formularzem inline, a wpis `inline` jest starszy niż 60 s, idą
  **dwa identyczne** GET-y `newsletter_settings?select=*` (pełny i projekcja). Zalecam:
  - dedup w locie w `fetchNewsletterSettings` (jak `fetchSiteDesignTokensRow`);
  - zasiew `inline` z pełnego (`setQueryData(["newsletter-settings","inline"], projectNewsletterInlineSettings(full))`
    po pobraniu pełnego).

**Efekt:** −1 GET i −1 OPTIONS i −1 chunk JS z okna LH; u powracających 0 żądań.

**Ryzyko: średnie, marketingowe.**

- Popup `immediate` (PopupHost, 400 ms) pokaże się dopiero przy interakcji lub ciszy, nie zaraz po `load`.
- Zdarzenie `impression` (`NewsletterPopup.tsx:125-130`) liczy się później. Odwiedzający, który wyjdzie przed ciszą,
  nie da wyświetlenia, ale popupu i tak by nie zobaczył.
- Kontrakt w komentarzu `__root.tsx:256-271` („Czas montażu nakładek jest celowo BEZ ZMIAN … późniejszy montaż byłby
  widocznie późniejszym popupem") trzeba świadomie zmienić. Kotwica w starcie nawigacji jest odpowiedzią na ten
  argument.

**Testy:**

- `rootRoute.test.tsx` (bramki nakładek);
- `components/__tests__/newsletterPopup.test.tsx` i `NewsletterPopup.test.ts`;
- `components/popups/__tests__/PopupHost.test.tsx`;
- e2e: `e2e-performance/on-demand-overlays.spec.ts:150-167` (asercja „po `__nesAppReadyAt`" nadal spełniona;
  dopisać „po ciszy lub interakcji") i `e2e/popup-registration.spec.ts` (czas pojawienia się popupu).

### 3.6 `builder_popups` (`status=eq.active&order=created_at.desc&limit=20`)

**Kto i kiedy.** `{overlaysReady && !noActivePopups ? <PopupHost/> : null}` (`__root.tsx:1290`). `PopupHost` włącza
`useActivePopups(mounted && !onAdminSurface)` (`components/popups/PopupHost.tsx:54-57`). Pobranie startuje w tym samym
momencie co `newsletter_settings`.

**Klucz i opcje.** `["builder-popups-active"]`, `staleTime` 5 min, `queryFn` to bezpośrednie `supabase.from`
(`lib/builder/popups.ts:201-216`).

**SSR. Nikt nie grzeje tego klucza**: jedyne odwołania to `popups.ts:203,241,367`. `useNoActivePopupsFromSsr`
(`__root.tsx:481-488`) czyta więc zawsze `undefined` i zwraca `false`. Komentarz `:469-479` przyznaje wprost: „dziś
żaden loader tego klucza nie grzeje, więc host montuje się jak dotąd; bramka zadziała sama, gdy wpis pojawi się w stanie
SSR". Powodem było `check:ssr-budgets`, a tej bramki od PR #475 już nie ma.

**Czy potrzebne.** Na produkcji odpowiedź jest prawie na pewno `[]` (1336 B z nagłówkami). Chunk `PopupHost`, żądanie i
preflight nie dają nic.

**Poprawka #4a.** Rozgrzać w korzeniu (fala chrome, poza `chromeQueryKeys`, bo popup to dekoracja jak reklama:
`__root.tsx:1024-1031`) projekcję obecności:

- `edgeTtlCache("builder_popups:active", ≥60 s)` z zapytaniem `select=id&status=eq.active&limit=1`;
- zapis `setQueryData(["builder-popups-active"], [])` **tylko** przy pustym wyniku. Przy niepustym nic nie zapisywać,
  bo `PopupHost` musi dostać pełne wiersze z `builder_data`, a nie projekcję. Albo osobny klucz
  `["builder-popups-active","presence"]`, który czyta `useNoActivePopupsFromSsr`.
- Wariant bez podżądania: flaga `has_active_popups` w `site_settings` (wyzwalacz DB na `builder_popups`). Wymaga
  migracji.

**Efekt** dla tenanta bez popupów: −1 GET, −1 OPTIONS i −1 chunk na zawsze.

**Ryzyko.**

- Jedno podżądanie na izolat na TTL, poza ścieżką krytyczną (budżet chrome, `.catch`).
- Bramka jest zamrożona na wizytę: popup aktywowany w trakcie sesji nie pojawi się do następnego wejścia. Kompromis
  zapisany już w komentarzu `:475-478`.
- Dokument z brzegu niesie stan sprzed ≤180 s (lub dłużej w oknie STALE). Nowo aktywowany popup ruszy z opóźnieniem
  równym wiekowi dokumentu, bo zapis panelu robi purge L2 (`documentCache.ts`).

Razem z #4b daje to −2 GET, −2 OPTIONS i −2 chunki z okna LH.

**Testy:**

- `rootRoute.test.tsx:1290-1305` (`useNoActivePopupsFromSsr`: zamiast ręcznego `setQueryData` loader ma dowieźć wpis);
- `lib/builder/__tests__/popupsHooks.test.tsx`;
- `dehydratedPayload.test.ts` (wpis `[]` na fixture, bo `builder_popups` należy do `emptyTables` w
  `scripts/performance/homeFixture.ts:43-71`);
- `PopupHost.test.tsx`.

### 3.7 `categories` + `tags`

**Kto i kiedy.** `useInterestCatalog(lang)` pobiera **obie** tabele w jednym `queryFn` (`Promise.all`,
`hooks/useInterests.ts:62-77`; klucz `["interests-catalog", lang]`, `staleTime` 60 s). Woła go
`useInterestGroups(lang, …)` (`components/interests/TopicsDroplist.tsx:34-35`), **bezwarunkowo**:

- w `JoinUsForm` (`components/interests/JoinUsForm.tsx:230`, niezależnie od `showInterests`);
- w `NewsletterForm` (`components/NewsletterForm.tsx:130`).

Na `/` fixture'a `join-us` stoi w sekcji 6 (`home-body[0].builder_data.sections[6]`). Sekcje od indeksu 1 to wyspy
(`BuilderRenderer.tsx:581-597`, `SECTION_ISLAND_TRIGGER` w `lib/builder/sectionStreaming.tsx:285-290`). Wyspa otwiera
się w trzech przypadkach:

- przy widoczności z marginesem 100% wysokości w dół;
- przy pierwszej interakcji gdziekolwiek, łącznie z przewinięciem dokumentu;
- w punkcie ciszy (`quiescent` domyślnie `true`).

Wtedy montuje się `JoinUsForm` i idą dwa GET-y (każdy z preflightem).

**SSR.** Klucza brak. `JoinUsForm` renderuje listę zainteresowań dopiero przy `allItems.length > 0` (`:862`), więc w
HTML jej nie ma, a po pobraniu blok rośnie wewnątrz wyspy. To skok układu poniżej zgięcia, liczony w CLS, gdy wyspa jest
w widoku.

**Czy potrzebne przy boocie. Nie.**

- Tryb `droplist` (domyślny, `JoinUsForm.tsx:161`) potrzebuje katalogu dopiero po otwarciu listy.
- Walidacja `requireInterests` (`:348`) potrzebuje go przy wysyłce.

**Poprawka #6.**

- W trybie `droplist`: `useInterestCatalog(lang, { enabled: showInterests && (interestsDisplay === "chips" || armed) })`,
  gdzie `armed` ustawia się przy intencji (`pointerenter`, `focusin`) na przycisku listy.
- Przycisk listy renderować w SSR zawsze przy `showInterests` (stała rezerwa, brak skoku).
- Przed walidacją `requireInterests` przy wysyłce: `ensureQueryData`.
- `NewsletterForm`: analogicznie.

**Efekt:** −2 GET i −2 OPTIONS przy otwarciu wyspy (u każdego czytelnika, który przewinie). W Lighthouse zwykle poza
śladem, bo wyspa otwiera się dopiero w punkcie ciszy. Usuwa też późne pojawienie się bloku zainteresowań.

**Ryzyko: średnie.** Zachowanie formularza:

- etykiety pustej listy, gdy katalog jest pusty;
- wysyłka z `requireInterests`.

Dane zalogowanych (`useMyInterests`) bez zmian.

**Testy:**

- `components/interests/__tests__/topicsDroplist.test.tsx`;
- `joinUsForm.test.tsx` i `NewsletterForm.test.tsx` (atrapy katalogu);
- `hooks/__tests__/useInterests.test.tsx`.

### 3.8 Przekrojowo: polityka odświeżania „z wieku" (poprawka #5)

**Problem (§2, punkt 3).** Dokument z brzegu w wieku T sprawia, że przy hydratacji refetchuje każdy zamontowany wpis
odwodniony z `staleTime < T`. Na produkcji LH (T ≤ 180 s) dotyczy to kluczy 60-sekundowych (`header_banner`, autorzy
slidera, newsletter inline po otwarciu wyspy). U czytelnika dokumentu STALE (T do 24 h) dotyczy prawie wszystkich 19
wpisów, czyli fali kilkunastu GET-ów i preflightów w oknie bootu.

**Poprawka.** Jedna polityka w `router.tsx`, tylko po stronie klienta:

```ts
refetchOnMount: (q) => (q.state.dataUpdatedAt === 0 || bootSettled ? true : false);
```

- `bootSettled` przełącza się na pierwszej interakcji (`enqueue`, `overlays`) albo w `onQuiescent`.
- W tym momencie jedno `queryClient.refetchQueries({ type: "active", stale: true })`.
- Zasiewy z `updatedAt: 0` nadal leczą się natychmiast (doktryna `ssr-degradation`). Wyjątek: `post-layout-settings`
  dostaje punktowe `refetchOnMount: false` (§3.2).

**Ryzyko: średnie.**

- Treść z bardzo starego dokumentu (już namalowana) odświeży się kilka sekund później niż dziś. Dziś odświeżenie po
  hydratacji też jest widoczną podmianą treści, tylko w oknie LCP i SI.
- Inwalidacje (zapisy admina, `SiteSettingsLiveSync` dla staffu, `widgetCacheInvalidation`) pobierają niezależnie od
  `refetchOnMount`, więc bez zmian.
- Zalogowani: ich prywatne zapytania nie są odwodnione (dokument jest anonimowy), więc ich to nie dotyczy. Zapytania
  montowane po `bootSettled` działają domyślnie.
- Zgodność z `useSectionPreload.isSectionFresh` (`lib/builder/useSectionPreload.ts:72`): nadal liczy wiek z
  `dataUpdatedAt`, bez zmian.

**Testy:**

- `src/__tests__/router.test.tsx` (polityka i harmonogram);
- `e2e/ssr-degradation.spec.ts` (leczenie zasiewów musi zostać natychmiastowe);
- pomiar w uprzęży z dokumentem HIT w wieku powyżej 60 s i powyżej 300 s (dziś desktop-2 w uprzęży: 8× `posts`).

---

## 4. Ranking (żądania usunięte z bootu anonimowego × bezpieczeństwo)

| #   | Poprawka                                                                                                                     | Żądania z okna bootu (prod LH)                                           | Bezpieczeństwo                                              | Pliki                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | `fontScale` w fali 1 korzenia (+ anulowanie i zasiew)                                                                        | −1 GET −1 OPTIONS, każda trasa; usuwa utajoną zmianę stylu po hydratacji | wysokie (0 podżądań serwera, kilka bajtów)                  | `routes/__root.tsx`                                                                          |
| 2   | `FooterSlideup` uzbrajany po interakcji lub ciszy, opóźnienie od startu nawigacji                                            | −1/−1 na `/` (i `$`, archiwa, blog, wyszukiwarka)                        | wysokie                                                     | `components/ads/FooterSlideup.tsx`, nowy wspólny hook (wzorzec `TrendingTicker.tsx:102-114`) |
| 3   | `ContentAreaStyle`: bez refetchu zasiewu w hydratacji, odświeżenie w ciszy (+ opcj. rozgrzewka u konsumentów)                | −1/−1, każda trasa bez własnej rozgrzewki                                | wysokie na `/`, średnie na trasach z treścią bez rozgrzewki | `components/ContentAreaStyle.tsx`, opcj. `lib/builder/prefetch.ts`                           |
| 4a  | sygnał „brak aktywnych popupów" w SSR (bramka już istnieje)                                                                  | −1/−1 i −1 chunk (tenant bez popupów)                                    | średnio-wysokie (+1 podżądanie na izolat na TTL)            | `routes/__root.tsx`, `lib/builder/popups.ts`                                                 |
| 4b  | nakładki (`NewsletterPopup`, `PopupHost`) po interakcji lub ciszy, opóźnienia od startu nawigacji, zapamiętana częstotliwość | −2/−2 i −2 chunki z okna LH; u powracających 0                           | średnie (czas popupów `immediate`)                          | `routes/__root.tsx` (`useOverlayGates`), `NewsletterPopup.tsx`, `PopupHost.tsx`              |
| 5   | polityka `refetchOnMount` w oknie bootu + jedno odświeżenie w ciszy                                                          | prod LH: −1–2/−1–2 (wiek > 60 s); STALE > 5 min: kilkanaście             | średnie                                                     | `src/router.tsx`                                                                             |
| 6   | katalog zainteresowań na żądanie                                                                                             | −2/−2 przy otwarciu wyspy (zwykle poza LH)                               | średnie                                                     | `hooks/useInterests.ts`, `JoinUsForm.tsx`, `NewsletterForm.tsx`, `TopicsDroplist.tsx`        |
| 7   | kwantyzacja `nowIso` w URL-u reklam; dedup w locie `fetchNewsletterSettings` i zasiew `inline` z pełnego                     | 0 w LH (zimny profil); mniej preflightów i duplikatów w SPA i powrotach  | wysokie                                                     | `lib/ads/queries.ts:96`, `hooks/useNewsletterSettings.ts:189-225`                            |

Suma #1–#4b: z 10 wpisów sieciowych (5 GET + 5 OPTIONS) i 2 chunków nakładek po `load` w oknie LH nie zostaje nic.

- #1–#3 usuwają lub przesuwają 3 GET-y z hydratacji, przy niskim ryzyku.
- #4a/#4b zdejmują drugą falę (po `load`), która dziś przedłuża ślad Lighthouse'a.

Wspólny prymityw dla #2, #3, #4b, #5 i #6: „pierwsza interakcja albo punkt ciszy". Jest już używany w
`TrendingTicker.tsx:102-114`; warto go wydzielić jako jeden hook w `src/lib/performance/` zamiast pięciu kopii.

---

## 5. Weryfikacja po wdrożeniu (bez zmian w uprzęży)

1. Lighthouse lokalny na fixture (`base/lh`, 3×mobile, 3×desktop, desktop4x): GET-y `/rest/v1/` od startu nawigacji
   do końca śladu. Oczekiwane po #1–#4: **0**. Dziś: 5 (+1–2 przy HIT powyżej 60 s).
2. Ten sam pomiar z dokumentem HIT w wieku powyżej 60 s i powyżej 300 s (#5): dziś desktop-2 (133 s) ma dodatkowy
   `ad_placements` i 8× `posts`.
3. `on-demand-overlays.spec.ts`: chunki `NewsletterPopup-` i `PopupHost-` po punkcie ciszy lub interakcji (asercja
   rozszerzona).
4. `dehydratedPayload.test.ts`: dochodzą `["site_font_scale"]` i (dla #4a) `["builder-popups-active"]` = `[]`.
5. Produkcja (`prod-lh`): w `network-requests` brak par Preflight/Fetch dla pięciu tabel w śladzie. Sprawdzić też, że
   `observedLastVisualChange` i SI nie zawierają przepisania `:root` ani pojawienia się paska lub popupu.

## 6. Uwagi poboczne (poza zakresem, ale wyszły przy okazji)

- Dokumenty produkcyjne `/` we wszystkich 6 przebiegach (także HIT i STALE) mają
  `cache-control: no-cache, must-revalidate, max-age=0`. Uprząż lokalna ma `public, max-age=60, s-maxage=900, …`. To
  wygląda na ścieżkę „degradacji" strony głównej (`resilientCacheControl(true)` przy minięciu `homeDeadline`,
  `__root.tsx:860-862`; `db;dur` 1,2–2,4 s przy MISS). Warto sprawdzić osobno, bo to też powód brakującego
  `header_banner` w stanie SSR przy zimnym izolacie (desktop-1).
- `profiles_public` (mobile-3) to `builder-slider-authors` (`sliderAuthorsQuery.ts:64-66`, 60 s). Jest odwodniony i
  refetchuje wyłącznie z wieku dokumentu; obejmuje go #5.
- Preflighty: każdy nowy URL REST to dodatkowy RTT na mobile. Tańsza architektura dla danych „całej strony" (tokeny,
  układ treści, obecność popupów, ustawienia popupu newslettera) to jeden odczyt, np. RPC lub widok
  `public_site_bundle` pobierany raz. Dziś wszystkie te dane już są (albo po #1 i #4a będą) w stanie SSR, więc to
  optymalizacja nawigacji SPA, nie bootu.
