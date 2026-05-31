# Architektura: strony, wpisy i breadcrumbs

## Zasada przewodnia

- **Strony** tworzą hierarchię (drzewo). Każda strona może mieć rodzica → ścieżka URL i breadcrumbs wynikają wprost z drzewa.
- **Wpisy** zawsze należą do jakiejś strony („wpisy tworzą część strony"). Wpis bez strony nadrzędnej nie istnieje.
- **Szablony** są wspólnym magazynem blueprintów. Mogą mieć zasięg `section` (jak dziś), `page` lub `post` — czyli pełny `BuilderDocument`, nie tylko jedna sekcja.
- Szablon przy zastosowaniu jest **klonowany** do `builder_data` strony/wpisu (jak dziś dla sekcji). Bez „live link" — modyfikacja szablonu nie zmienia istniejących stron.

## Model danych (migracje)

### `pages`
- `parent_id uuid` — FK → `pages(id)` ON DELETE RESTRICT (zakaz kasowania rodzica z dziećmi)
- `template_id uuid` — FK → `builder_templates(id)` ON DELETE SET NULL (informacja, z którego szablonu wystartowała)
- `menu_order int default 0` — kolejność w obrębie rodzica (do nav/breadcrumbs)
- Indeks: `(parent_id, menu_order)`, unikalność `(parent_id, slug)` (slug unikalny w obrębie rodzica)
- Walidacja w triggerze: zakaz cyklu (strona nie może być potomkiem samej siebie)

### `posts`
- `parent_page_id uuid NOT NULL` — FK → `pages(id)` ON DELETE RESTRICT. Wpis MUSI należeć do strony.
- `template_id uuid` — FK → `builder_templates(id)` ON DELETE SET NULL
- Unikalność: `(parent_page_id, slug)`
- Backfill: istniejące wpisy dostaną auto-utworzoną stronę „Blog" jako rodzica (jednorazowo)

### `builder_templates`
- Rozszerzenie `scope`: dziś tylko `"section"`. Dodajemy obsługę `"page"` i `"post"` (kolumna jest już TEXT, więc bez zmiany schematu — tylko logika UI).
- `data` dla `scope='page'/'post'` przechowuje cały `BuilderDocument` (tablica sekcji), a nie pojedynczy `SectionNode`.

## URL i routing

| Treść | URL |
|---|---|
| Strona główna | `/` |
| Strona top-level | `/<slug>` |
| Strona zagnieżdżona | `/<parent-slug>/<child-slug>/...` |
| Wpis | `/<page-path>/<post-slug>` (gdzie `page-path` = pełna ścieżka strony nadrzędnej) |

Implementacja:
- Usunięcie/zmiana `src/routes/post.$slug.tsx` → wpisy nie żyją już pod `/post/...`.
- Splat route `src/routes/$.tsx` (`createFileRoute("/$")`) który po stronie loadera:
  1. Rozbija ścieżkę po `/`.
  2. Spróbuje dopasować jako stronę po pełnej hierarchii (`parent_id` chain).
  3. Jeśli ostatni segment nie jest stroną-dzieckiem, traktuje go jako slug wpisu w obrębie znalezionej strony nadrzędnej.
  4. W innym wypadku → `notFound()`.
- `/blog` zostaje jako lista wszystkich wpisów (przekrojowa), ale każdy wpis linkuje na swój `parent-page-path/slug`.
- Dodanie kolumny obliczanej (DB function) `page_full_path(page_id) returns text` — wykorzystywana przez loader i sitemap.

## Breadcrumbs

### Komponent `<Breadcrumbs items={...} />`
- Lokalizacja: `src/components/Breadcrumbs.tsx`.
- Renderuje listę `<ol>` z separatorami, semantyka `aria-label="breadcrumb"`, JSON-LD `BreadcrumbList` w `<script type="application/ld+json">`.
- Stylowanie przez design tokens (text-muted-foreground, hover:text-foreground).

### Źródło danych
- Helper `getBreadcrumbsForPage(pageId)` w `src/lib/breadcrumbs.ts` — pojedyncze rekurencyjne zapytanie (CTE `WITH RECURSIVE`) zwraca tablicę `{slug, title_pl, title_en}` od korzenia do strony bieżącej.
- Dla wpisu: breadcrumbs strony nadrzędnej + sam wpis jako ostatni crumb (bez linku).
- Hook `useBreadcrumbs(entity)` zwracający gotowe items na podstawie aktualnego języka.

### Gdzie się pojawiają
- Render automatyczny na publicznych routach: `$.tsx` (strony + wpisy), tuż nad `<main>`.
- Strona główna `/` — bez breadcrumbs.
- Admin: opcjonalnie w nagłówku edytora strony/wpisu, żeby pokazać kontekst (nice-to-have, niżej priorytetowo).

## Edytor admin

### Edycja strony
- Nowy widget w `admin.pages.$id.tsx`: pole „Rodzic" (select z drzewa stron, z wykluczeniem samej siebie i potomków).
- Pole „Szablon startowy" (tylko przy tworzeniu — `admin.pages.new.tsx`): pre-wypełnia `builder_data` sklonowanym dokumentem.
- Akcja „Zapisz jako szablon strony" (analogicznie do istniejącego „Zapisz jako szablon sekcji") — zapisuje cały `BuilderDocument` z `scope='page'`.

### Edycja wpisu
- Pole „Strona nadrzędna" — wymagane, select z drzewa stron.
- Pole „Szablon startowy wpisu" przy tworzeniu — z `scope='post'`.
- Akcja „Zapisz jako szablon wpisu" → `scope='post'`.

### Builder
- W `WidgetLibrary` sekcja „Szablony" rozszerzona: zakładki Section / Page / Post (`scope`).
- Wstawianie szablonu page/post zastępuje cały dokument (z konfirmacją), section — dodaje sekcję (jak dziś).

## Pliki do zmiany / utworzenia

**Migracje (jedna):**
- `pages.parent_id`, `pages.template_id`, `pages.menu_order`, indeksy, trigger anty-cykl, unikalność `(parent_id, slug)`.
- `posts.parent_page_id` (NOT NULL po backfill), `posts.template_id`, unikalność `(parent_page_id, slug)`.
- Funkcja `page_full_path(uuid) returns text`.
- Backfill: utworzenie strony „Blog" (slug `blog`) i przypięcie wszystkich istniejących wpisów.

**Nowe pliki:**
- `src/lib/breadcrumbs.ts` — fetchery + JSON-LD helper.
- `src/lib/pageTree.ts` — `getPageTree()`, `resolvePath(segments) → {page, post?}`.
- `src/components/Breadcrumbs.tsx`.
- `src/routes/$.tsx` — uniwersalny resolver stron i wpisów.
- `src/components/admin/PageParentSelect.tsx` — select drzewa.

**Zmiany:**
- `src/routes/$slug.tsx` → usunięcie (zastąpione przez `$.tsx`).
- `src/routes/post.$slug.tsx` → usunięcie (lub przekierowanie na nowy URL).
- `src/routes/blog.index.tsx` → linki wpisów używają nowej pełnej ścieżki.
- `src/routes/admin.pages.$id.tsx`, `admin.pages.new.tsx` — pola Rodzic + Szablon.
- `src/routes/admin.posts.$id.tsx`, `admin.posts.new.tsx` — pole Strona nadrzędna (wymagane) + Szablon.
- `src/components/admin/builder/WidgetLibrary.tsx` — zakładki scope w sekcji szablonów.
- `src/lib/builder/templates.ts` — `useTemplates(scope)` zamiast `useSectionTemplates()`.

## Kolejność wdrożenia

1. **Migracja DB** (pojedynczy commit): kolumny, FK, indeksy, trigger, funkcja `page_full_path`, backfill strony „Blog".
2. **Resolver i routing**: `pageTree.ts`, nowy `$.tsx`, usunięcie starych routów stron/wpisów, aktualizacja linków w `blog.index.tsx`.
3. **Breadcrumbs**: helper + komponent + wpięcie do `$.tsx` (publiczne strony i wpisy).
4. **Admin — strony**: select rodzica + szablon startowy + „zapisz jako szablon strony".
5. **Admin — wpisy**: wymagana strona nadrzędna + szablon + „zapisz jako szablon wpisu".
6. **Builder library**: zakładki Section/Page/Post w panelu szablonów.

## Szczegóły techniczne

- **Anty-cykl**: trigger `BEFORE INSERT OR UPDATE` na `pages` — funkcja `check_page_parent_no_cycle()` wspina się po `parent_id` i sprawdza, czy nie napotka samego siebie. RAISE EXCEPTION przy cyklu.
- **`page_full_path`**: SQL function z `WITH RECURSIVE`, zwraca slug-join `/` od korzenia.
- **Loader splat route**: pojedyncze RPC `resolve_path(text[])` po stronie DB (zwraca page + opcjonalny post) — żeby uniknąć N+1 i round-tripów.
- **RLS**: dla nowych kolumn zachować dotychczasowe polityki (read public dla published, write tylko dla autora/tenanta — bez zmian w semantyce).
- **Breadcrumbs SEO**: każdy crumb to link, ostatni element bez linku, JSON-LD na każdej publicznej stronie.
- **Migracja URL-i**: stare URL-e `/post/<slug>` można obsłużyć stałym route'em `/post/$slug` zwracającym `Navigate` na nowy URL (301-friendly redirect), żeby nie psuć linków zewnętrznych — robimy w kroku 2.

## Czego nie robimy w tej iteracji

- Live-link template (zmiana szablonu nie modyfikuje już istniejących stron).
- Wielopoziomowych szablonów (template kompozyt z innych).
- UI do zarządzania drzewem stron przez drag&drop — w v1 tylko select rodzica.
- Wersjonowania `template_id` na poziomie strony (samo template_revisions istnieje, ale nie wpinamy go w UI strony).
