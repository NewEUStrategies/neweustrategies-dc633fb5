# Wdrożenie: wolne pierwsze wejście bez cookies - diagnoza i cięcie (2026-08-18)

## Diagnoza (nagranie ekranu 2026-08-18 17:50, użytkownik bez cookies)

Analiza tablic próbek nagrania (`stts`/`stsz` - rejestrator macOS nie zapisuje
klatek bez zmiany obrazu) dała jednoznaczną sygnaturę:

| okno           | obraz                   | interpretacja                              |
| -------------- | ----------------------- | ------------------------------------------ |
| 0,0-1,25 s     | Enter, zmiana kadru     | nawigacja                                  |
| **1,25-6,5 s** | **~zero bajtów klatek** | **~5,2 s białego ekranu = TTFB dokumentu** |
| 6,5-9,4 s      | ciągła zmiana kadru     | malowanie + hydratacja + przebudowy        |

To ta sama sygnatura co w `WDROZENIE_TTFB_2026-08-14.md` (wtedy ~3,5 s), tylko
gorsza - mimo warmera i SWR. Zmierzone przyczyny, w kolejności wagi:

1. **NES Edge Cache odrzucał dokument > 1 MiB PO CICHU.** `collectStream`
   (documentCache.server.ts) po przekroczeniu `DOCUMENT_CACHE_MAX_ENTRY_BYTES`
   zwracał `null` bez logu i bez licznika. Strona główna niesie w HTML-u
   dehydratowane dane WSZYSTKICH sekcji + pełną mapę `site_settings`
   (builder_data chrome'u), więc potrafi przekroczyć 1 MiB - a wtedy
   NAJWAŻNIEJSZA trasa serwisu wypada z cache'a na stałe i **każdy czytelnik
   płaci pełny render SSR** (5-6 sekwencyjnych barier await + zapytania do
   bazy), a warmer grzeje w próżnię. Diagnozy nie dało się postawić z liczników
   (rosły tylko MISS-y) ani z nagłówków (hosting zdejmuje `x-nes-cache`).
2. **~800 KB gz / ~2,3 MB surowego JS blokującego hydratację** przy pustym
   cache przeglądarki: domknięcie statyczne chunku wejściowego 654 KB gz
   (2 179 kB raw), w tym 182 kB źródeł słowników i18n (w większości ADMINOWYCH),
   dompurify, sonner, 21 wariantów etykiety sekcji, pełne treści dokumentów
   prawnych, warstwa danych klubów i dwie niesplitowane strony admina.
3. Brak cookie `nes_lang` → 302 na `/en` (nie-cache'owalny round-trip),
   brak zgody analytics → **zero RUM od dokładnie tej grupy użytkowników**
   (dlatego problem widać tylko na nagraniach).

## Zmiany

### 1. NES Edge Cache: odrzut rozmiarowy widoczny + limit 2 MiB

- `DOCUMENT_CACHE_MAX_ENTRY_BYTES` 1 MiB → **2 MiB** (`documentCache.ts`) -
  uzasadnienie przy stałej; budżet magazynu (24 MiB, approx-LRU) pozostaje
  nadrzędny.
- `collectStream` rozróżnia odrzut rozmiarowy od błędu strumienia; zapis
  MISS-a zlicza `stats.oversize` i loguje ścieżkę (`console.warn`).
- `oversize` w snapshotcie + kafelek „Odrzuty rozmiarowe" na karcie
  `/admin/performance` (PL/EN w `i18n-admin-edge-cache`). **Rosnące oversize
  przy zerowych stores danej trasy = trasa wypada z cache'a na stałe.**
- Testy: `documentCache.server.test.ts` - odrzut liczony/logowany/nie zapisuje
  wpisu; dokument w limicie wchodzi bez odrzutu.

### 2. Chunk wejściowy: 373,9 → 253,2 KB gz (-32%)

Domknięcie statyczne bootu: **654 → ~554 KB gz / 2 179 → ~1 876 kB raw**.
Największym plikiem przestał być entry (jest nim EChartClient - admin, lazy).

| co                                                                         | mechanizm wycieku                                                                                     | naprawa                                                                                                                                                                               |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 21 plików tras z `import "@/lib/i18n-…"` (~150 kB źródeł, gros adminowych) | side-effect import zostaje w shellu trasy; shelle wszystkich tras są eager                            | wzorzec `ensureI18n()` wołany W KOMPONENCIE (jak i18n-club); 16 słownikom dopisany no-op `ensureI18n`                                                                                 |
| `admin.library` (25,6 kB) i `admin.comments` (11,7 kB) w entry             | `export function` na komponencie trasy blokuje route splitter                                         | zdjęty `export`; testy sięgają po komponent przez `Route.options.component` / wydzielony `ExpertRequestList` w components/chat                                                        |
| dompurify (82 kB źródeł)                                                   | `hardenStyleCss`/`safeUrl` importowane z `lib/sanitize`, który na poziomie modułu importuje DOMPurify | czyste helpery w **`lib/sanitizePure.ts`** (re-eksport w sanitize.ts - API bez zmian); jedyny eager konsument `sanitizeHtml` (akordeon) wydzielony do lazyWidgets (`AccordionWidget`) |
| sonner (63 kB źródeł)                                                      | `toast` w callbackach mutacji modułów rozgrzewanych loaderem roota + `<Toaster/>` w __root            | leniwy most **`lib/notify.ts`** (kolejka FIFO, no-op w SSR) + `Toaster` przez React.lazy (doktryna lazy-overlay)                                                                      |
| `sectionLabelVariants` (39 kB, 21 wariantów)                               | statyczny import w SimpleWidgets                                                                      | `SectionLabelWidgetView` w lazyWidgets + dogrzanie w `warmWidgetChunks`                                                                                                               |
| pełne treści prawne (37 kB: privacy+terms+refunds)                         | stała współdzielona przez `head()` i komponent ląduje w module `?tsr-shared` (eager)                  | **`lib/legal/meta.ts`** (tytuł+lead) czytane przez head(); treści spreadują meta - jedno źródło prawdy                                                                                |
| `lib/clubs/api.ts` (22 kB, ~40 RPC)                                        | loader huba (eager) importował barrel współdzielony przez dziesiątki chunków klubowych                | **`lib/clubs/publicClub.ts`** z samym `fetchClubBySlug`; api.ts re-eksportuje                                                                                                         |
| SearchOverlay (20 kB)                                                      | statyczny import w Header (chrome)                                                                    | React.lazy, montowany bezwarunkowo (stan przeżywa zamknięcie), renderuje null aż do otwarcia                                                                                          |
| zod (132 kB) + tailwind-merge (97 kB)                                      | realnie potrzebne na boocie (schematy ustawień w loaderze roota; `cn()`)                              | ZOSTAJĄ, ale we własnych chunkach vendorowych (`vendor-zod`, `vendor-tw-merge`) - trwały cache między deployami; identycznie `vendor-dompurify`/`vendor-sonner` (lazy)                |

### 3. Bramki, żeby to nie wróciło

- `check-entry-purity`: +3 słowniki (post-panes, network, popup-signup) i nowa
  klasa `HEAVY_MODULES` (dompurify, sonner, sectionLabelVariants, treści
  prawne) - markery-wartości odporne na minifikację. Bramka złapała w trakcie
  prac realny przeciek (`sliderFallbackQuery` → sanitize → dompurify).
- `check-bundle-size`: floory za śladem - chunk 385→**280** (ratchet w dół),
  public 2570→**2545** (ratchet w dół), overall 3835→**3870** (+35: koszt ~30
  nowych granic chunków; pełny bilans we wpisie kroniki 2026-08-18).
- manualChunks identyczne w `vite.config.ts` i `vite.smoke.config.ts`
  (bramka parytetu przechodzi).

## Czego TU nie zmieniono (i dlaczego)

- **Middleware przekierowań przed cache'em, streaming home, bundle serwera
  (19 MB, echarts/xlsx/prettier w grafie SSR)** - świadomie osobna praca,
  powody w `WDROZENIE_TTFB_2026-08-14.md` (klasa incydentu ~61 s).
- **Budżet hydratacji 1500 ms w router.tsx** (przekroczenie = przebudowa
  drzewa) - mniejszy bundle skraca okno wyścigu; zmiana budżetu bez pomiarów
  RUM byłaby strzałem w ciemno.
- **RUM bez zgody analytics** - beacon anonimowych Core Web Vitals bez
  identyfikatorów to decyzja prawna (RODO), nie techniczna; do rozstrzygnięcia
  z operatorem. Do tego czasu jedyną telemetrią pierwszych wejść pozostaje
  karta NES Edge Cache (teraz z licznikiem oversize).
- **Lighthouse CI na dev-serwerze** - tryb blokujący wymaga ustawienia
  zmiennej repo `vars.LHCI_URL` na wdrożony URL (mode A w lighthouse.yml);
  bez niej produkcji nie mierzy nikt. To konfiguracja repo, nie kod.

## Weryfikacja po deployu

1. `/admin/performance` → karta NES Edge Cache: kafelek „Odrzuty rozmiarowe".
   Jeśli rośnie - dokument nadal przekracza 2 MiB i trzeba ciąć dehydratowany
   payload (nie podnosić limitu w nieskończoność).
2. Drugie wejście na `/` w ciągu dnia: rejestr decyzji na karcie powinien
   pokazywać HIT/STALE (nagłówków nie widać - hosting je zdejmuje).
3. Twarde odświeżenie bez cache: łączny JS blokujący hydratację ~554 KB gz
   (DevTools → Network, filtr JS, do zdarzenia hydracji).
4. Sekcje z etykietami (section-label) i akordeonem: brak pustych kadrów przy
   nawigacji SPA (dogrzane w warmWidgetChunks; SSR wypełnia granice).
