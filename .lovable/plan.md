
# WordPress Import Pro — plan wdrożenia

Rozbudowa istniejącego importu WP (`src/lib/wp-import.functions.ts` + `src/components/admin/WordPressImportDialog.tsx`) o cztery zamówione bloki funkcjonalności. Cały kod idzie w server functions pod `requireStaff`, RLS + tenant guard bez zmian. i18n PL/EN wszędzie. Bez `any`.

## 1) Podgląd konwersji + porównanie oryginał vs wynik

- Nowy server fn **`wpPreviewPage`** (`src/lib/wp-import.functions.ts`) — dla jednego wpId:
  - pobiera pełny obiekt strony z WP,
  - uruchamia pełny pipeline konwersji (Elementor mapper → Gutenberg → htmlToBlocks fallback),
  - zbiera listę **URLi mediów** znalezionych w treści (img/src, figure/img, elementor image widgets, video/embed),
  - buduje listę **ostrzeżeń** (co spadło do fallbacku, ile bloków „nierozpoznanych", ile mediów będzie ściągniętych, obecność `[shortcode]` niezmapowanych),
  - zwraca `{ original: { html, cleanedHtml, mediaUrls }, converted: BuilderDocument, warnings: string[], coverage: { elementorMapped, gutenbergMapped, fallback, total } }` — bez zapisu.
- **UI (`WordPressImportDialog`)** — dodać w liście przycisk „Podgląd" per wiersz + panel wynikowy pod listą albo w drugim dialogu (`WordPressPreviewDialog`) w trybie side-by-side:
  - lewa kolumna: sandboxowana `<iframe srcdoc>` z wyczyszczonym HTML-em WP (bez skryptów, `sandbox="allow-same-origin"`),
  - prawa kolumna: nasz **`BuilderRenderer`** karmiony `BuilderDocument` z podglądu (dokładnie taki sam renderer, co produkcja),
  - u góry pasek pokrycia: `zmapowane Elementor: X / Gutenberg: Y / fallback: Z (total N)` + lista ostrzeżeń,
  - toggle „widok mobilny/desktop" (szerokość kontenera),
  - CTA „Importuj tę stronę" i „Importuj wszystkie wybrane".
- Podgląd jest cachowany po stronie klienta w React Query pod kluczem `["wp-preview", domain, wpId]`, żeby nawigacja po liście była płynna.

## 2) Automatyczny mirror mediów WP → nasze media/storage

- Wspólny helper **`mirrorWpMedia(html, tenantId, userId, supabase)`** (nowy `src/lib/server/wp-media.server.ts`):
  1. wyciąga wszystkie URL-e mediów z HTML-a (img[src], srcset, source[src], a[href$=.pdf|.mp3|.mp4], video/audio src, style url()),
  2. deduplikuje po URL, filtruje po MIME allowliście używanej przez `media.functions.ts`,
  3. dla każdego zasobu:
     - `fetch()` przez gateway WP (dla `wp-content/uploads`) lub bezpośrednio dla obcych CDN-ów (opcja „mirror external" w dialogu),
     - sprawdza rozmiar (≤ ceiling z `media.functions.ts`),
     - liczy `sha256`; jeśli plik o tym hashu już istnieje w `media_library` dla tenanta → używa istniejącego rekordu (idempotencja przy re-imporcie/nadpisaniu),
     - w przeciwnym razie: `supabaseAdmin.storage.from("media").upload(path, bytes, { contentType })` do `tenantId/wp-import/{yyyy}/{sha256}.{ext}` i wstawia rekord do `media` (tenant_id, uploader_id=userId, storage_path, public_url, filename, mime, size, alt),
  4. zwraca mapę `{ [originalUrl]: { publicUrl, mediaId } }`.
- Po konwersji: **`rewriteMediaUrls(doc, map)`** przechodzi po BuilderDocumencie i podmienia URL-e w widgetach (`rich-text` — w HTML doc, `image` — w `src`, `hero`/`card` — w polach `image`).
- `wpImportPages` i `wpPreviewPage` używają tego samego pipeline'u; preview zwraca tylko listę do pobrania (nic nie zapisuje), a import realnie ściąga i zapisuje. `cover_image_url` w `pages` też jest przepisywany na URL z naszego bucketa.
- Rate-limit + guard: max 200 assetów per strona; niedostępne linki są logowane w `warnings`, ale nie przerywają importu.

## 3) Rozbudowany mapper Elementor → widgety

- Nowy moduł **`src/lib/blocks/elementor.ts`** — czysty, deterministyczny, testowany:
  - detekcja Elementora po klasach (`.elementor`, `.elementor-section`, `.elementor-widget-*`) lub obecności `data-elementor-type`,
  - parser oparty o lekki tree-walker HTML (bez DOM w SSR — regex + limited pushdown, tak samo jak `gutenberg.ts`),
  - mapowanie:
    | Elementor | Nasz widget |
    | --- | --- |
    | `elementor-section` / `elementor-container` | `section` (background z inline style + `data-settings`) |
    | `elementor-column` | `column` ze spanem z `data-col` (12/6/4/3/2 → nasza siatka) |
    | `elementor-widget-heading` | `heading` (poziom z `.elementor-heading-title` / tag) |
    | `elementor-widget-text-editor` / `-text-path` | `rich-text` |
    | `elementor-widget-button` | `button` (label + href + wariant z `.elementor-button--...`) |
    | `elementor-widget-image` / `-image-box` | `image` (+ caption + link) |
    | `elementor-widget-icon-box` / `-icon-list` | `card` / `list` (title + text + icon + href) |
    | `elementor-widget-divider` | `divider` |
    | `elementor-widget-spacer` | `spacer` (height z inline style) |
    | `elementor-widget-video` / `-html` iframe | `embed` (yt/vimeo detect) |
    | `elementor-widget-image-carousel` / `-gallery` | `gallery` (jeśli mamy widget; inaczej lista `image` w kolumnie) |
    | nierozpoznany `elementor-widget-...` | fallback: `rich-text` z surowym HTML (i wpis w `warnings`) |
  - **`convertHtmlToBuilder(html): { doc: BuilderDocument, coverage }`** — nowy główny entry używany zarówno w preview jak i imporcie; wewnątrz najpierw próbuje Elementora, potem Gutenberga, a resztę wrzuca w rich-text (dziś: wszystko idzie w jeden rich-text).
- Testy `src/lib/blocks/__tests__/elementor.test.ts`: 
  - fixture Elementor section z heading/button/image → oczekiwany BuilderDocument,
  - column span mapping,
  - icon-box → card,
  - unknown widget → rich-text fallback + warning.

## 4) Nadpisywanie stron + mapowanie PL / EN

- Rozszerzenie `wpImportPages` o pola per-wiersz:
  ```ts
  pageIds: Array<{
    plId?: number;              // wpId dla wersji PL
    enId?: number;              // wpId dla wersji EN (opcjonalnie)
    targetPageId?: string;      // UUID istniejącej strony do nadpisania
    slugOverride?: string;      // ręczny slug docelowy
  }>
  ```
  - Gdy `plId` + `enId` — pobieramy oba, konwertujemy każdy niezależnie, tworzymy jedną stronę z `title_pl`+`title_en`, `excerpt_pl`+`excerpt_en`, oraz **jednym** BuilderDocumentem, w którym każdy `rich-text` widget dostaje `{ doc: toJson({ pl, en }) }` (już wspierane); dla widgetów typu `heading`/`button`/`image` używamy PL jako źródła głównego, a EN dokładamy do pól `*_en` / `alt_en` (tam gdzie widget je ma) albo do dodatkowego `translations` bloku widgetu — dokładna mapa w `elementor.ts`.
  - Gdy `targetPageId` — UPDATE po `id` (RLS + tenant guard), z opcjonalnym auto-backupem: przed nadpisaniem wstawiamy snapshot do `content_revisions` (`note: "wp_import_pre_overwrite"`) — istniejąca infrastruktura rewizji.
- UI w dialogu:
  - obok każdej strony na liście: 2 dropdowny „język" (`PL` / `EN`) i „para z…" (autouzupełnianie po tytule z listy WP; podpowiedzi: te same slugi bez prefiksu lub heurystyka `title-EN` <=> `title-PL`),
  - dropdown **„Nadpisz istniejącą stronę"** — nowy server fn `listExistingPages` (staff, tenant-scoped) zwracający `{id, title_pl, title_en, slug}` do wyboru; wybór ustawia `targetPageId`,
  - pole **„Slug docelowy"** (opcjonalne) — nadpisuje domyślny slug PL,
  - podsumowanie przed importem: `X nowych · Y nadpisań · Z par PL/EN`.
- Zabezpieczenie: strona `main` dalej twardo pomijana w UI i na serwerze, także jako target nadpisania (walidacja Zod).

## Techniczne szczegóły

- Wszystkie nowe server fn: `createServerFn({ method: "POST" }).middleware([requireStaff]).inputValidator(zod)`.
- Zod dla `wpPreviewPage`, `listExistingPages` i rozszerzonego `wpImportPages` — brak `any`, wszystkie unions bezpieczne.
- `mirrorWpMedia` używa `supabaseAdmin` (service role) tylko do storage upload; wpis do `media` idzie userowym clientem (RLS + tenant).
- Rate-limit: `wp.preview` (60/min), `wp.import` (10/min), `wp.media.mirror` (300/min) — tabela `rate_limits` już istnieje.
- Audit: `wp.import.overwrite` z `{page_id, wp_pl_id, wp_en_id}` w metadata.
- SSR safety: parser Elementora jest pure JS bez `document`/`window`; podgląd HTML w kliencie robimy `<iframe srcdoc sandbox>`.
- Testy jednostkowe: `elementor.test.ts`, `wp-media.test.ts` (mock fetch), `wp-import.test.ts` (preview shape, PL/EN merge).
- **Bez zmian schemy** (nie potrzeba migracji) — używamy istniejących `pages`, `media`, `content_revisions`, `rate_limits`.

## Pliki

Zmiany:
- `src/lib/wp-import.functions.ts` — `wpPreviewPage`, `listExistingPages`, rozbudowany `wpImportPages` (overwrite + PL/EN).
- `src/lib/blocks/elementor.ts` — nowy mapper.
- `src/lib/server/wp-media.server.ts` — mirror + rewriter.
- `src/lib/blocks/convert.ts` — `convertHtmlToBuilder()` orkiestrator (Elementor → Gutenberg → fallback).
- `src/components/admin/WordPressImportDialog.tsx` — nowe kolumny (nadpisz / PL / EN), przycisk „Podgląd", integracja z podglądem, podsumowanie.
- `src/components/admin/WordPressPreviewDialog.tsx` — nowy dialog side-by-side.
- `src/lib/blocks/__tests__/elementor.test.ts`, `src/lib/server/__tests__/wp-media.test.ts` — testy.

Po akceptacji wdrażam całość jednym ciągiem, zachowując istniejący kontrakt `wpListPages` (kompatybilnie wstecznie).
