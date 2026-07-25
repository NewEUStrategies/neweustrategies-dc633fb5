# Wdrożenie optymalizacji SSR - 2026-07-24

**Zakres:** komplet rekomendacji z `docs/OCENA_SSR_2026-07-24.md` (Fazy 1-3).
**Weryfikacja na tej sesji:** `tsc --noEmit` czysty · pełny vitest **2593 passed / 0 failed**
(1 pre-istniejący błąd środowiskowy unhandled ECONNREFUSED:3000 w
`SearchButtonWidget.test`, identyczny na czystym HEAD) · pełny `vite build` zielony ·
bramki `check:bundle` / `check:chunks` uruchomione na finalnym artefakcie.

---

## Faza 1 - quick wins (samo TS)

### 1. [P0-A] Domyślny `Cache-Control` publicznych dokumentów

- **Nowa polityka:** `src/lib/http/defaultCacheControl.ts` (czysta funkcja, pełna macierz
  decyzji pokryta testami `__tests__/defaultCacheControl.test.ts`).
- **Wpięcie:** `defaultCacheControlMiddleware` w `src/start.ts` - INNERMOST, tuż nad
  routerem, poniżej `documentCacheMiddleware`, więc NES Edge Cache widzi już wzbogaconą
  odpowiedź i może ją zapisać.
- **Kontrakt:** wyłącznie GET + 200 + `text/html` + ścieżka poza współdzieloną deny-listą
  (`PUBLIC_DOCUMENT_DENY_PREFIXES`) + żądanie bez sesji; **nagłówek ustawiony przez trasę
  zawsze wygrywa** (degradacja home -> `no-store`, preview, personalized bez zmian).
- **Wyjątek `/live`:** `liveCacheControl()` - `s-maxage=30, swr=300` (spójne z
  `staleTime: 30 s` zapytania live blogów) zamiast pełnej polityki treści.
- **Efekt:** ~20 tras publicznych (kategorie, tagi, blog, autorzy, podcasty, programy,
  eksperci, tracker, web-stories, pricing...) wchodzi do NES Edge Cache i dostaje
  politykę przeglądarkową - wcześniej pełny SSR + komplet zapytań na każde żądanie.

### 2. [P1-C] Root loader: jeden wiersz `site_design_tokens` + TTL

- `fetchSiteDesignTokensRow()` (`lib/builder/designTokens.ts`) - JEDEN select
  `colors, fonts, scale, global_colors` współdzielony przez `designTokensQueryOptions`
  i `globalColorsQueryOptions` (dotąd dwa osobne round-tripy do tego samego wiersza na
  każdej trasie); `edgeTtlCache` 60 s per tenant + dedupe in-flight dla klienta.
- `postLayoutSettingsQueryOptions` za `edgeTtlCache` 60 s (`hooks/usePostLayoutSettings.ts`).
- **Efekt:** koszt stały root loadera przy ciepłym izolacie: 4 zapytania -> 0.

### 3. [P1-B/P0-C cz.1/P1-A cz.1/P1-E/P1-F] Loadery treści

- **Wpis/strona:** `resolvedContentQueryOptions` za `edgeTtlCache` 60 s
  (`lib/queries/public.ts`; rdzeń wydzielony do `resolveContentForSegments`). Każdy MISS
  dokumentu przestaje płacić ~10 round-tripów, gdy izolat ma ciepły wpis.
- **Archiwa:** `taxonomyArchiveQueryOptions` przepisane (`lib/queries/archives.ts`):
  pivot + sekcja featured RÓWNOLEGLE (dotąd sekwencyjnie), całość za `edgeTtlCache`
  60 s z kluczem `kind:slug:page:pageSize:sort`.
- **Home:** `fetchReadingSettings()` czyta `site_settings["reading"]` z bulk mapy
  rozgrzanej przez root loader (0 RT na serwerze) zamiast dwóch dedykowanych selectów
  tego samego wiersza; przeglądarka zostaje przy tanim selekcie pojedynczego wiersza.
- **Redirect legacy `/post/$slug`:** rezolucja za `edgeTtlCache` 300 s
  (`routes/post.$slug.tsx`) - ruch botów po starych linkach przestaje młócić bazę.
- **Listy:** `blogListQueryOptions` (60 s), `publicPagesTreeQueryOptions`,
  `publicCategoriesQueryOptions` (po 5 min) za `edgeTtlCache`.

### 4. [P2-C] `Server-Timing: ssr;dur` + koszt bazy

- Czysta budowa nagłówka: `lib/http/ssrTiming.ts`; licznik per żądanie
  (WeakMap po obiekcie Request z ALS TanStack): `lib/http/ssrTiming.server.ts`.
- Zasilanie: `fetchWithTenantHost` mierzy każdy round-trip planu anon (dynamiczny import
  za bramką SSR - zero bajtów w bundlu przeglądarki).
- Emisja: `documentCacheMiddleware` dokleja do odpowiedzi
  `server-timing: nes-edge;desc="MISS", ssr;dur=…, db;dur=…;desc="n=…"` na ścieżkach
  MISS/rewalidacji. Przeglądarka wystawia to w `PerformanceResourceTiming` - istniejący
  RUM koreluje TTFB z kosztem renderu i bazy bez nowej infrastruktury.
- **Uwaga architektoniczna:** moduł server-only jest ładowany dynamicznie, bo
  `documentCache.server.ts` jest osiągalny w grafie klienta przez `start.ts` - statyczny
  import `@tanstack/react-start/server` zatrzymuje build na import-protection (wzorzec
  identyczny z `lib/http/requestHost.ts`).

## Faza 2 - cache per-colo + SQL

### 5. [P0-B] Dwupoziomowy NES Edge Cache + [P2-D] `waitUntil`

- **L2:** `lib/http/documentCacheL2.server.ts` - Cloudflare Cache API
  (`caches.default`, dostępne bez bindingów), wpisy per-colo współdzielone między
  izolatami kolonii. Poza Workers degraduje do no-op; testy wstrzykują magazyn przez
  `setColoCacheForTests`.
- **Klucz wersjonowany:** adres wpisu zawiera segment wersji globalnej i per-host;
  purge (publikacja) bumpuje wersję - wszystkie wpisy hosta stają się nieosiągalne w
  całej kolonii natychmiast, bez iterowania kluczy (Cache API nie ma listowania).
  Memo wersji w pamięci 2 s ogranicza podwójny `match()` na żądanie.
- **Integracja L1+L2** (`lib/http/documentCache.server.ts`): HIT L1 bez zmian
  (mikrosekundy); L1 miss próbuje L2 i trafienie ZASIEWA L1 (świeży izolat grzeje się
  jednym odczytem z kolonii zamiast pełnym renderem); STALE z L2 działa w tym samym
  single-flight co L1; MISS tee-uje strumień do obu warstw.
- **`ctx.waitUntil`:** `lib/http/waitUntil.server.ts` - oficjalny eksport
  `cloudflare:workers` (dynamiczny import, defensywny fallback fire-and-forget poza
  Workers). Objęte: zbieranie strumienia do cache, zapis L2, bump wersji, log 404
  (`start.ts`) - praca "za odpowiedzią" nie jest już ucinana przez domknięcie żądania.
- **Spójność:** świeżość bez zmian (fresh <= 3 min, jak dotąd); kolonia bez bumpa
  dogania w oknie świeżości - dokładnie tak, jak wcześniej doganiały izolaty. Zmiana
  ściśle nie-gorsza, hit-rate rośnie z per-isolate do per-colo.
- **Obserwowalność:** snapshot `DocumentCacheSnapshot.l2` (enabled/hits/stale/stores/
  bumps) + nowa sekcja L2 na karcie `/admin/performance?tab=cache`
  (`components/admin/performance/EdgeCacheCard.tsx`, i18n PL/EN w
  `lib/i18n-admin-edge-cache.ts`).
- **Testy:** `__tests__/documentCacheL2.test.ts` - zapis/odczyt, bump per-host i
  globalny, degradacja bez Cache API, HIT z L2 po "rotacji izolatu", STALE z L2 przy
  wywalonym renderze, emisja `ssr;dur`. Stare testy L1 przechodzą bez modyfikacji.

### 6. [P0-C cz.2] RPC `get_expert_hub`

- **Migracja** `supabase/migrations/20260724150500_get_expert_hub.sql`: cały ładunek
  `/author/$slug` jednym jsonb - profil + nakładka + odznaki + programy + obszary +
  wzmianki + materiały z pivotami + **taksonomie faset zawężone w SQL** (koniec z
  pobieraniem 4 pełnych tabel katalogu) + **layout tenanta profilu w tym samym
  wywołaniu**. SECURITY INVOKER + STABLE - pełny RLS anon, tenant scoping bez zmian;
  kolumny odwzorowują 1:1 selecty z TS.
- **TS:** `lib/experts/rpcHub.ts` (RPC-first) + wspólna asemblacja
  `assembleMaterials`/`map*Rows` w `lib/experts/normalize.ts` używana przez OBIE
  ścieżki (RPC i legacy) - logika dedupe/pivotów/sortu w jednym miejscu, pokryta
  testami. Ścieżka legacy zostaje fallbackiem na okno wdrożeniowe migracji (wzorzec
  `search_autosuggest`); jej pierwsza fala poszerzona o 3 niezależne zapytania
  (primaryPosts/podcasty/hostEvents nie czekają już na listy id, których nie używają).
- **Loader** (`routes/author.$slug.tsx`): layout z RPC zasiewa cache
  (`setQueryData`) zamiast doklejać sekwencyjne zapytanie; hub za `edgeTtlCache` 60 s.
- **Efekt:** najcięższa publiczna trasa: ~22 round-tripy w 4-5 falach -> **1 round-trip**
  (RPC) przy zimnym izolacie, **0** przy ciepłym.

### 7. [P1-A cz.2] Batch `page_full_paths(uuid[])`

- **Migracja** `20260724150000_page_full_paths_batch.sql`: jedno rekurencyjne CTE dla
  całego zbioru id (semantyka identyczna z `page_full_path`, invoker, GRANT anon).
- **TS:** `fetchParentPaths` w `lib/queries/archives.ts` - batch RPC z fallbackiem
  per-id. Konsumenci: archiwa kategoria/tag i wyszukiwarka (`hydrateHref`).
- **Efekt:** N+1 (do ~60 RPC na stronę wyników) -> 1 round-trip.

### 8. [P1-D] Referencje wpisów slidera jednym round-tripem

- Embedding PostgREST jest niemożliwy (`posts.author_id` -> `auth.users`, nie
  `profiles`), więc join robi **migracja** `20260724151000_get_post_refs.sql`
  (wpis + publiczny profil autora przez definer-owski widok `profiles_public`).
- **TS:** `fetchPostRefBundle` (`lib/builder/contentRefs.ts`) - RPC-first z fallbackiem
  dwuetapowym; fallback przełączony z tabeli `profiles` na widok `profiles_public`
  (lżejsza, spójna projekcja); całość za `edgeTtlCache` per id, wspólnym dla PL/EN
  (wariant językowy mapowany po odczycie).
- **Efekt:** 2 sekwencyjne RT na slajd -> 1 RT na wpis (0 przy ciepłym izolacie).

## Faza 3 - bundle i cold start

### 9. [P2-A] Minifikacja bundla workera

- Chunki serwera składa **Nitro własnym rollupem** - vite-owe `build.minify` ich nie
  dotyczy; właściwa dźwignia to `nitro: { minify: true }` (`vite.config.ts`,
  zsynchronizowany `vite.smoke.config.ts`). Dodatkowo top-level vite `minify: false`
  (historyczny obejście OOM) zastąpione `minify: "esbuild"` - esbuild minifikuje w
  procesie Go, poza heapem V8, więc historyczny OOM nie wraca (zweryfikowane pełnym
  `build` na tej sesji).
- **Zmierzone:** `.output/server` **21 MB -> 13 MB raw**, gzip całości
  **4,02 MB -> 2,97 MB (-26 %)**; chunk routera (eager na cold starcie) zminifikowany.
- **echarts / MCP SDK:** zweryfikowane, że już są poza ścieżką eager SSR - echarts
  wyłącznie za `React.lazy` (`EChartClient`), MCP SDK importowany dynamicznie w
  handlerze `/mcp`; pozostają wagą artefaktu, nie kosztem żądań.

### 10. [P2-B] Budżety klienta - audyt

- Bundel klienta jest w tej zmianie funkcjonalnie nietknięty (dodatki `edgeTtlCache`
  w queryFn to pojedyncze bajty). Budżety `check:bundle` pozostają na poziomach
  z HEAD - patrz tabela niżej; realne odchudzenie entry (~-30 KB gzip do zielonego
  floora 350 KB) wymaga zmian grafu chunków i zgodnie z regułami repo (incydenty
  2026-07-20) musi iść osobnym PR-em z gate'ami `check:chunks` + smoke boot-testem.
  Zalecana kolejność ataku (z atrybucji `vite.measure`): eager-owy zestaw widgetów
  chrome, lucide-icon-nodes w entry, dosplitowanie `@tanstack` router-core.

### 11. [P2-E] Prefetch chrome bez round-tripów

- `edgeTtlCache` w queryFn wszystkich data-bound widgetów chrome/buildera:
  `postListQueryOptions` (poza wariantem `random` - zamrożenie kolejności zmieniłoby
  zachowanie), `sliderPostsQueryOptions` (lang w kluczu - sortowanie po tytule),
  `newsTickerQueryOptions`, `sliderFallbackImagesQueryOptions`, `postRefQueryOptions`;
  do tego `archiveLayoutQueryOptions` i `expertLayoutSettingsQueryOptions`.
  Menu i ticker były już cache'owane w server functions.
- **Efekt:** podwójny warm-up chrome (header+footer) w root loaderze w stanie
  ustalonym = **0 round-tripów**.

## Poboczne naprawy (przy okazji, zgodnie z zakresem zlecenia)

- `FriendlyErrorPage`: pre-istniejący błąd typów `<Link to="/support" search={{}}>`
  (wymagany kształt `{ status }`) - naprawiony.
- 162 wywołania przestarzałego `createServerFn().inputValidator()` w ~30 plikach
  `*.functions.ts` zamienione na `validator()` (API z tej samej wersji; czyści
  deprecation warnings builda).
- `.env.example`: udokumentowany kill-switch `NES_EDGE_CACHE=off`.
- Karta NES Edge Cache w adminie: sekcja L2 (PL/EN).

## Wyniki bramek na finalnym artefakcie

| Bramka              | Wynik                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`      | czysty                                                                                                                                                                  |
| `vitest` (pełny)    | 2593 passed / 0 failed (+~30 nowych testów cache/normalize)                                                                                                             |
| `vite build` (prod) | zielony                                                                                                                                                                 |
| `.output/server`    | 13 MB raw / 2,96 MB gzip (z 21 MB / 4,02 MB)                                                                                                                            |
| `check:bundle`      | public 1541,5 KB / overall 2607,9 KB / chunk 378,0 KB gzip - vs HEAD 1540,9/2607,0/377,0 (+<1 KB z dodatków TTL); floory jak na HEAD przekroczone, plan zejścia: pkt 10 |
| `check:chunks`      | bez cykli (graf chunków klienta niezmieniony)                                                                                                                           |
| `eslint`            | 0 błędów w plikach zmienionych; globalnie 308 problemów vs 319 na HEAD (pre-istniejący dryf formatu prettiera)                                                          |

## Oczekiwane efekty w produkcji (miary z OCENA_SSR)

- **TTFB tras archiwalnych:** HIT/STALE z pamięci zamiast pełnego renderu na każde
  żądanie; wejście w cel < 100 ms na HIT mierzalne od razu przez `x-nes-cache` + RUM.
- **Hit-rate `x-nes-cache`:** wzrost dwuskładnikowy - pokrycie tras (3 -> ~23) oraz
  zasięg magazynu (per-isolate -> per-colo z zasiewem L1 z L2). Cel > 80 % po
  ustabilizowaniu ruchu.
- **`ssr;dur` (nowy):** MISS wpisu z ciepłym `edgeTtlCache` spada do kosztu renderu
  React (bez fal DB); zimny wpis: 3 fale jak dotąd, autor: 1 RPC zamiast 4-5 fal.
- **Cold start izolatu:** -38 % bajtów parse'owanego kodu workera.

## Ryzyka i decyzje świadome

- **L2 bump jest per-colo** - kolonia bez publikacji dogania w <= 3 min (fresh cap),
  czyli nie gorzej niż dotychczasowe izolaty. Świadomie bez zewnętrznego brokera.
- **RPC z fallbackami:** do czasu wdrożenia migracji 20260724150000/150500/151000
  kod działa na ścieżkach legacy (koszt jak przed zmianą, plus jeden tani nieudany
  RPC amortyzowany przez `edgeTtlCache`); wygenerowane typy Supabase nie znają nowych
  funkcji - wywołania przez wąskie, skomentowane rzutowania strukturalne (wzorzec
  `popular_post_ids`), do zniknięcia przy regeneracji typów.
- **`minify` dla workera:** gdyby na CI Lovable wrócił OOM, pierwszy krok: wyłączyć
  `nitro.minify`, NIE vite-owe minify klienta (komentarz w `vite.config.ts`).
- **Budżety klienta** zostają czerwone jak na HEAD - zejście do floorów to osobna,
  gate'owana praca (pkt 10); floory świadomie NIE zostały podniesione.

_Wszystkie ścieżki odnoszą się do brancha `claude/ssr-system-assessment-7fmsp4`;
raport źródłowy oceny: `docs/OCENA_SSR_2026-07-24.md`._
