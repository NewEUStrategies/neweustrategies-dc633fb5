## Cel

Osobne, dedykowane strony archiwum dla kategorii i tagów z breadcrumbami, 6 uniwersalnymi layoutami do wyboru (globalne ustawienia, osobno per typ) i panelem admina do konfiguracji.

## Zakres

### 1. Tabela ustawień (Lovable Cloud)

Migracja `archive_layout_settings` (singleton per typ archiwum):

- `id` uuid PK
- `archive_type` enum: `category` | `tag` (unique)
- `layout_variant` smallint 1-6
- `columns` smallint 1-4 (grid)
- `list_style` text: `grid` | `list` | `masonry`
- `show_hero` bool, `show_description` bool, `show_follow` bool
- `show_sidebar` bool, `sidebar_position` (`left`|`right`)
- `sidebar_widgets` jsonb (kolejność: popular, related, ads, newsletter)
- `show_featured_top` bool, `show_related_taxonomies` bool, `show_podcasts` bool
- `hero_bg_style` text: `gradient` | `image` | `solid` | `pattern` | `mesh` | `minimal`
- `posts_per_page` smallint
- `created_at`/`updated_at`
- RLS: SELECT anon+authenticated; INSERT/UPDATE tylko admin (via `has_role`)
- Grants standardowe

### 2. Sześć layoutów (`src/components/archive/layouts/`)

Każdy komponent przyjmuje props: `{ taxonomy, posts, lang, settings, kind, canLoadMore, onLoadMore, isPending, podcasts }`. Współdzielą `<Breadcrumbs>`, `<ArchivePostList>`, `<FollowButton>`.

1. **`LayoutMinimal`** - białe tło, cienka linia pod hero, typografia serif, brak sidebara, gęsty grid
2. **`LayoutClassic`** - klasyczny nagłówek + sidebar prawy z widgetami, subtelne tło `bg-muted/20`
3. **`LayoutMagazine`** - featured post po lewej + siatka 2 kolumny po prawej, wyraźny nagłówek z tłem gradientowym
4. **`LayoutHero`** - pełnoekranowy hero z tłem-mesh/gradient, opis, statystyki (liczba wpisów), potem lista
5. **`LayoutDark`** - ciemna sekcja hero z pattern-em (SVG grid), jasne karty poniżej
6. **`LayoutBento`** - bento grid (różne rozmiary kart), sticky nagłówek po lewej

Każdy używa tokenów Theme Design; brak hardkodów kolorów.

### 3. Aktualizacja routingu

- `src/routes/category.$slug.tsx` i `src/routes/tag.$slug.tsx`: pobierają settings (via query options z SSR), dobierają layout wg `layout_variant`, przekazują wspólne dane
- Breadcrumbs: dla kategorii - Home > Kategorie > {name}; dla tagu - Home > Tagi > #{name}
- Zachować SEO head, follow, load-more, podcasty

### 4. Admin panel

Dwie strony:
- `src/routes/admin.appearance.category-archive.tsx`
- `src/routes/admin.appearance.tag-archive.tsx`

Każda strona:
- Formularz ustawień (radio grid z podglądem 6 layoutów - miniaturki SVG)
- Toggles: hero, sidebar, follow, description, featured, related-taxonomies, podcasts
- Selecty: columns, list_style, sidebar_position, hero_bg_style
- Drag-drop kolejności widgetów sidebara (dnd-kit już w projekcie)
- Live preview (iframe z `?preview=<layout>` w URL lub embed komponentu)
- Przycisk "Podgląd na żywo" -> otwiera `/category/<sample>` w nowej karcie
- i18n PL/EN dla wszystkich etykiet

Dodać wpisy w menu admina (`admin.appearance.tsx` sidebar) - "Archiwum kategorii", "Archiwum tagów".

### 5. Server functions

`src/lib/archive-layout.functions.ts`:
- `getArchiveLayoutSettings({ archiveType })` - public, cache w Query
- `updateArchiveLayoutSettings(...)` - z `requireSupabaseAuth` + sprawdzenie roli admin przez `context.supabase`

### 6. i18n

Dodać klucze do `src/lib/i18n/*` (PL/EN) dla: breadcrumbs (Kategorie/Categories, Tagi/Tags), admin labels, layout names, hero background labels.

### 7. Testy

- `src/components/archive/layouts/__tests__/layoutSelection.test.tsx` - właściwy wariant renderowany dla `layout_variant`
- `src/lib/__tests__/archiveLayoutSettings.test.ts` - fallback do domyślnych gdy brak wiersza
- Playwright: breadcrumbs widoczne dla `/category/europa` i `/tag/*`

## Uwagi techniczne

- SSR: loader kategorii/tagu robi `Promise.all([taxonomyArchive, archiveLayoutSettings])` przez `ensureQueryData`
- Podglądy layoutów w adminie: małe SVG wireframe'y (nie iframe) - lżej, bez extra requestów
- Fallback: jeśli brak rekordu w DB -> domyślny `LayoutClassic` z sensownymi defaults
- Rejestr layoutów w `src/components/archive/layouts/registry.ts` - mapowanie `1..6 -> Component + label + preview SVG`
- Reużyć `ArchivePostList`, `PodcastEpisodeStrip`, `FollowButton`, `Breadcrumbs`
- Widget sidebara: nowe małe komponenty `PopularPostsWidget`, `RelatedTaxonomiesWidget`, `NewsletterWidget`, `AdWidget` (opakowanie istniejącego `AdSlot`)
- Bez `any`; typy z `Database` dla wiersza settings

## Deliverables

- 1 migracja SQL (tabela + RLS + grants + seed 2 wierszy z defaults)
- 6 komponentów layoutów + registry + wspólne widgety sidebara
- 2 strony admina + wpisy w nawigacji appearance
- Zaktualizowane `category.$slug.tsx` i `tag.$slug.tsx`
- Server functions + query options
- Klucze i18n PL/EN
- Testy jednostkowe + smoke e2e breadcrumbs

Po akceptacji zaczynam od migracji, potem layouty, potem admin.