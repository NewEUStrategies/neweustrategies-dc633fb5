# Wdrożenie: optymalizacja SSR + LCP (2026-08-13)

Cel: skrócić czas do pierwszego malowania obrazu (LCP) na całej powierzchni
publicznej i domknąć procesy wspierające potoku SSR. Punkt wyjścia: wpisy
($.tsx) miały pełny kontrakt preloadu okładki, ale strona główna, strony
buildera, archiwa i trasy szczegółowe nie emitowały ŻADNEGO hintu - a nagłówki
odpowiedzi nie niosły preloadów wcale (i ginęłyby na HIT/STALE NES Edge Cache).

## 1. Zasada nadrzędna: parytet preload <-> render

Preload innego kandydata niż malowany to podwójny transfer zamiast
przyspieszenia. Dlatego KAŻDA para `srcSet`/`sizes` żyje teraz w jednym,
współdzielonym module, z którego czytają i renderery, i budowniczowie
preloadu:

| Moduł                                    | Konsumenci                                                 |
| ---------------------------------------- | ---------------------------------------------------------- |
| `lib/builder/sliderSizes.ts`             | `sliderVariants` (render) + `heroImage` (preload)          |
| `lib/builder/widgetImageSizes.ts`        | `PostListView`, `mediaWidgets`, `WidgetView` + `heroImage` |
| `lib/cardImageSizes.ts`                  | `PostListCard` + `archivePreload` (trasy archiwów)         |
| `lib/postLayouts.ts` (`coverImageSizes`) | bez zmian - wzorzec, z którego wyszła reszta               |

## 2. Preload obrazu LCP per klasa tras

- **Strona główna (`index.tsx`)** - oba tryby:
  - builder: nowy `lib/builder/heroImage.ts` wyprowadza deskryptor pierwszego
    malowanego obrazu sekcji nad zgięciem (slider posts/manual -> okładka
    pierwszego slajdu lub obraz zapasowy; widget `image` jednoźródłowy
    nie-logo; `dark-featured-card`; lead post-listy w wariantach
    card/minimal/overlay/boxed-grid/classic/flex-grid). Zasada ostrożności:
    sekcje A/B, para light/dark, logo, miniaturowe warianty list => null
    (lepiej zero preloadu niż zły).
  - najnowsze wpisy: okładka pierwszej karty (`CARD_IMAGE_SIZES`).
- **Strony buildera (`$.tsx`, kind=page)** - dotąd jawnie wykluczone; teraz ten
  sam `builderHeroPreload` co strona główna. Wpisy bez zmian (buildCoverPreload).
- **Archiwa (kategoria/tag/blog)** - `lib/seo/archivePreload.ts`: okładka
  karty wyróżnionej (`FEATURED_CARD_IMAGE_SIZES`) albo pierwszej karty siatki
  (`CARD_IMAGE_SIZES`).
- **Trasy szczegółowe** - programs.$slug (hero, dodano też `priority`),
  web-stories.$slug, podcasts.$show, podcast.$slug (dodatkowo: migracja
  ręcznego head() na `buildContentHead` - odzyskane canonical/hreflang/
  twitter:card/og:url).

## 3. Nagłówek HTTP `Link` + utrwalenie w NES Edge Cache

- `imagePreloadLinkHeaderValue()` (`lib/seo/meta.ts`) - czysty formatter
  RFC 8288 z twardą sanityzacją (CR/LF/`<>`/cudzysłowy nie rozrywają nagłówka).
- `appendLinkHeader()` (`lib/http/responseHeaders.ts`) - akumulator per
  ŻĄDANIE (WeakMap po obiekcie Request): loadery root i trasy biegną
  równolegle, więc naiwny odczyt-scal-zapis gubiłby wpisy; każde wywołanie
  ustawia pełną złączoną wartość, wynik niezależny od kolejności.
- Root loader emituje przez `Link` preload CSS (`as=style`) i fontów
  per-język (`fontPreloadLinkHeaderValues`); trasy dokładają obraz LCP.
- **Schemat wpisu cache rozszerzony o `link`** (L1 `DocumentCacheEntry`,
  odroczony zapis, replay; L2 `x-nes-l2-link`). Bez tego hinty znikałyby
  dokładnie na ścieżce HIT/STALE - tej, którą dostaje większość czytelników
  i jedynej, z której Cloudflare może zbudować 103 Early Hints.
- `Server-Timing` na HIT/STALE niesie teraz wiek wpisu (`nes-age;dur=<ms>`)
  - korelacja RUM: świeże trafienie vs dokument z końca okna SWR.

## 4. Priorytety obrazów w rendererach

- **Kontekst `AboveFoldProvider`** (`lib/builder/aboveFold.tsx`) w
  `BuilderRenderer`: sekcje o indeksie < `ABOVE_FOLD_SECTION_COUNT` oznaczają
  widgety; te dają `priority` (eager + fetchpriority=high) wyłącznie swojemu
  PIERWSZEMU obrazowi. Wartość jest czystą pochodną dokumentu - identyczna
  w SSR i pierwszym renderze klienta (zero ryzyka rozjazdu hydratacji).
  Konsumenci: `PostListView` (lead karty/classic/flex-grid/karuzela),
  widget `image` (tylko jednoźródłowy - para light/dark podwajałaby transfer),
  `dark-featured-card`.
- **Slider**: `sizes` przestało być zaszytym "100vw" - wariant przekazuje
  wartość z `sliderSizes` (multi-card: `100/kolumny vw` - koniec pobierania
  ~3x za szerokich wariantów; split-feature: 50vw od md). Multi-card dostał
  brakujące `priority` pierwszej karty (jedyny wariant bez eager).
- **Archiwa**: karta wyróżniona = `priority` + `FEATURED_CARD_IMAGE_SIZES`
  (dotąd dziedziczyła 360 px i renderowała ROZMYTĄ, upscalowaną okładkę);
  bez karty wyróżnionej `priority` dostaje pierwsza karta siatki
  (`firstCardPriority` w `ArchivePosts`).
- **Treść bez okładki**: `enhanceContentImages` przyjmuje `eagerFirstImage` -
  pierwszy obraz artykułu przy układzie bez okładki (cover:none / wpis bez
  okładki) przestaje być lazy (to on bywa elementem LCP). Włączane z `$.tsx`
  dokładnie tą samą regułą co `buildCoverPreload`.

## 5. SSR - kompletność hero

- **Autorzy slidera**: inline'owe zapytanie `builder-slider-authors`
  wyekstrahowane do `lib/builder/sliderAuthorsQuery.ts` i rozgrzewane w SSR
  łańcuchem w `prefetchWidgets` (po rozstrzygnięciu wpisów slidera ->
  identyczna lista id co widget). Koniec "doskoku" byline wewnątrz obszaru
  LCP po hydratacji. Rekord zamiast Map - bezpieczna serializacja payloadu.

## 6. Poprawki potoku obrazów

- `RESPONSIVE_WIDTHS`: 2560 -> 2400. Transformacje Supabase przycinają width
  do 2500 px, więc kandydat "2560w" kłamał przeglądarce o swojej szerokości.

## 7. Procesy wspierające

- Lighthouse CI audytuje teraz także `/` i `/blog` (klasy tras z obrazem LCP),
  nie tylko `/en`.
- Testy: 105 asercji w 8 plikach obejmuje formatter nagłówka Link (w tym
  odporność na header injection), utrwalenie `link` przez L1+L2+replay,
  `nes-age` w Server-Timing, parytet sizes slidera, `builderHeroPreload`
  (12 przypadków, w tym A/B, hideOn, tabs, zepsuty dokument), preload
  archiwów, eager pierwszego obrazu treści.

## 8. Weryfikacja produkcyjna (checklist po deployu)

1. `curl -sI https://neweuropeanstrategies.com/ | grep -i link` - nagłówek
   `Link` z preloadem CSS + fontów + hero (na HIT też).
2. Devtools -> Network: hero strony głównej startuje z priorytetem "High"
   przed parsowaniem body; brak PODWÓJNEGO pobrania tego samego obrazu
   w dwóch wariantach (to by oznaczał rozjazd parytetu sizes).
3. Włączyć Early Hints w panelu Cloudflare (Speed -> Optimization) - nagłówki
   są już gotowe.
4. RUM: `nes-age` w Server-Timing pozwala segmentować LCP po wieku dokumentu.

## 9. Świadomie odłożone

- Kwantyzacja jakości transformacji per kontekst (hero 80 vs karty 88):
  repo świadomie podniosło 75 -> 88 po incydencie miękkich okładek z tekstem;
  nie ruszamy bez pomiaru wizualnego.
- AVIF: transformacje Supabase nie emitują AVIF; wymagałoby frontującego
  image-CDN (np. Cloudflare Image Resizing na istniejącym workerze).
- Prerender w Speculation Rules: bez zmian (AppLink przechwytuje nawigacje,
  prerenderowany dokument nie byłby konsumowany).
