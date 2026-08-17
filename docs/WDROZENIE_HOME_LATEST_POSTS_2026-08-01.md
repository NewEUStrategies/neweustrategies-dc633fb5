# Wdrożenie: strona główna w trybie „najnowsze wpisy" - domknięcie okablowania (2026-08-01)

Mandat: wiersz audytu „Strona główna | 8 | (...) | Tryb «najnowsze wpisy» z ustawień -
widmo (trasa nie honoruje) | Wyciąć martwy tryb albo okablować"
(docs/OCENA_FUNKCJI_TABELE_2026-07-30.md). Decyzja: **okablować do końca**, nie wycinać -
tryb ma parytet z WordPressowym „Your homepage displays: latest posts".

Bazowe podpięcie trybu weszło w serii PR #111-#124 (rendering listy na `/`). Ta rewizja
domyka trzy braki, przez które tryb wciąż nie był pełnoprawny.

## Braki i naprawy

### 1. SEO i zbędne round-tripy: ukryta strona statyczna przeciekała do trybu wpisów

`homePageQueryOptions` w trybie `latest_posts` nadal rezolwowało fallback `slug="home"`
(select strony + gated RPC `get_entity_content` - 2 zbędne round-tripy na krytycznej
ścieżce SSR), a `head()` trasy brał z tej niewyświetlanej strony title / description /
canonical / og:image / robots. `seo_noindex` ukrytej strony potrafił zdeindeksować stronę
główną w trybie wpisów. Loader odpalał też `prefetchCachedRouteQueries` dla dokumentu
buildera, który nigdy się nie renderował.

Naprawa: `homePageQueryOptions` zwraca `null` w trybie `latest_posts` **z konstrukcji**
(early return po odczycie ustawień czytania, przed jakąkolwiek rezolucją strony).
`head()` spada wtedy naturalnie na defaulty marki (`SITE_DEFAULT_TITLE/DESCRIPTION`),
a prefetch buildera w ogóle nie startuje. Tryb strony statycznej i historyczny fallback
`slug="home"` - bez zmian (test regresyjny).

### 2. Funkcjonalność: brak paginacji = treść poza pierwszą stroną nieosiągalna

Tryb pokazywał wyłącznie pierwsze `posts_per_page` wpisów (płaski
`blogListQueryOptions(limit)`), czyli dokładnie wadę klasy „brak paginacji", którą
PR #121 usunął na `/blog`. Naprawa: trasa `/` dostaje ten sam kontrakt URL-a co `/blog`:

- `?page=N` walidowane współdzielonym parserem (`src/lib/routing/pageSearch.ts`),
- loader SSR prefetchuje DOKŁADNIE żądaną stronę przez `blogArchiveQueryOptions({page,
pageSize})` - klucz zapytania 1:1 z komponentem (hydracja bez drugiego fetcha),
  degradacja seeduje pusty wynik z `updatedAt: 0` i wyklucza render ze współdzielonego
  cache (no-store), jak dotąd,
- `head()`: strony >1 są `noindex, follow`; canonical zawsze wskazuje czysty `/`
  (splitUrl odcina query), więc `?page` nie tworzy duplikatów także w trybie statycznym,
- paginacja renderuje realne `<a href>` (ArchivePagination + `router.buildLocation(...)
.publicHref` - z prefiksem języka `/en?page=2`), zmiana strony biegnie w
  `useTransition` (siatka zostaje na ekranie, kontrolki dostają `isPending`),
- rozmiar strony honoruje `posts_per_page` z ustawień czytania (widełki 1..100).

### 3. Architektura: duplikacja siatki i niespójny empty state

`LatestPostsHome` utrzymywał kopię siatki z `/blog` (grid + karty + wstawki in-feed +
pasek stron). Wydzielony organizm `src/components/archive/PaginatedPostGrid.tsx`
(atomic design: organizm składający molekuły `ArchivePostList` + `ArchivePagination` +
scroll-to-top) jest teraz JEDYNĄ definicją tej kompozycji - używają go `/` (tryb
wpisów) i `/blog`. Empty state obu tras przechodzi na kanoniczny wariant
`ArchivePostList` (ikona + ramka), spójny z archiwami i wyszukiwarką.
`ArchivePostList` dostał opcjonalne `firstCardPriority` (pierwsza karta jako kandydat
LCP - eager cover; listy poniżej fold zachowują lazy).

## Międzymodułowość (okablowanie end-to-end)

- **Admin -> publiczne cache:** `siteSettingsLiveSync.invalidate()` unieważnia teraz
  także `["public","home-mode"]`, `["public","home-page"]`, `["public","blog"]` -
  przełączenie „Strona główna pokazuje" jest widoczne w SPA bez twardego reloadu
  (dotąd do 10 min staleTime). Wąski, jawny zestaw prefiksów, nie cały korzeń
  `["public"]`.
- **Ustawienia czytania:** hint pod selektorem trybu (PL/EN:
  `admin.reading.latestPostsHint`) wyjaśnia, skąd tryb bierze rozmiar strony.
- **Reklamy:** tryb wpisów honoruje placementy `in_feed` typu „Strona główna"
  (`useInFeedAds("home")`), `/blog` - typu „Archiwa"; bez zmian.
- **Tenant:** wszystkie odczyty biegną przez RLS + `edgeTtlCache` skalowany per host
  tenanta (scoping w konstrukcji, nie w wywołaniach); zero nowego SQL.
- **i18n:** wszystkie nowe teksty w PL i EN (wzorzec `t(key, { defaultValue })` na
  trasach publicznych, słowniki `src/lib/locale/*` w adminie).

## Kontrakty pilnowane testami

- `src/lib/routing/__tests__/pageSearch.test.ts` - semantyka `?page` (defaulty
  niejawne, floor, odrzucanie śmieci).
- `src/lib/queries/__tests__/homepageMode.test.ts` - normalizacja trybu do zamkniętej
  unii (`HomepageMode`); w trybie wpisów `homePageQueryOptions` zwraca `null` bez
  ŻADNEGO selectu po `pages` i bez gated RPC; tryb statyczny + fallback `slug="home"`
  bez regresji.
- Istniejące: `blogArchive.test.ts` (normalizacja kluczy paginacji),
  `invalidate.test.ts` (prefiks `["public"]` pokrywa nowe klucze),
  `headContract.test.ts` (trasa `/` deklaruje własne `head()`).

## Weryfikacja

- `tsc --noEmit` - czysto; pełny vitest - 3677 testów / 421 plików zielone;
  `bun run build` - zielony; graf chunków acykliczny; checki SQL
  (tenant-scope / app-role / anon-insert) - zielone.
- ESLint na wszystkich zmienionych plikach - 0 błędów (1 wcześniejsze
  ostrzeżenie fast-refresh w siteSettingsLiveSync, sprzed tej zmiany).
- Dwie bramki CI są czerwone JUŻ NA BAZOWYM HEAD (zweryfikowane buildem i
  lintem czystego HEAD bez tej zmiany): (1) repo-wide prettier - lockfile
  pinuje prettier 3.8.3, a kod formatowano pod 3.7.x (ok. 1,3 tys. odchyleń
  formatera w nietkniętych plikach; masowy reformat celowo poza tym
  wdrożeniem), (2) budżet bundle - największy chunk 486,7 KB gzip > 350 KB
  na bazie; ta zmiana dodaje ~0,6 KB gzip łącznie.

## Poza zakresem (świadomie)

- JSON-LD `CollectionPage` na `/` w trybie wpisów: strona główna zostaje przy silnym,
  pojedynczym sygnale encji (Organization + WebSite + SearchAction) zgodnie z
  wytycznymi Google; semantyka archiwum należy do `/blog`.
- Osobny `pendingComponent` dla `/` - SSR settluje wszystkie zapytania przed
  dehydracją (model bez streamingu na tej trasie), a nawigacje paginacji biegną w
  transition; skeleton nie ma tu kiedy się pokazać.
