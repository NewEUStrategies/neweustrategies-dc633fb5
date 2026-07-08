## Cel

Dodać w panelu **Admin → Post Layouts** grupę pól „Typografia overlay" ze sterowaniem rozmiarem tytułu i podtytułu (excerpt) per breakpoint (base / md / lg). Ustawienia trzymane w `post_layout_settings` (globalne, tenant-scoped) i konsumowane w:

1. Publiczny renderer wpisu (`PostLayoutRenderer.tsx`)
2. Podgląd CMS (`LayoutScaffold.tsx` - Header + OverlayCover + SideBySide)

Zmiana w panelu → jedno źródło prawdy → obydwa widoki zmieniają się natychmiast (react-query invalidate).

## Zakres pól (globalne, w px)

Overlay title:
- `overlay_title_size_base` (mobile), default 24
- `overlay_title_size_md` (tablet), default 30
- `overlay_title_size_lg` (desktop), default 36

Overlay excerpt (podtytuł):
- `overlay_excerpt_size_base`, default 12
- `overlay_excerpt_size_md`, default 14
- `overlay_excerpt_size_lg`, default 16

Nagłówek bez cover (layout-9 i fallback):
- `header_title_size_base` / `_md` / `_lg`, default 30 / 36 / 48
- `header_excerpt_size_base` / `_md` / `_lg`, default 16 / 18 / 18

Wszystkie: `smallint`, `NOT NULL` z defaultami, zakres 10-96 (walidacja UI slider).

## Kroki wdrożenia

### 1. Migracja (schema)

`ALTER TABLE public.post_layout_settings ADD COLUMN ... DEFAULT ... NOT NULL` × 12 kolumn. Bez zmiany polityk RLS ani GRANT (tabela już skonfigurowana).

### 2. Warstwa TS - `src/lib/postLayouts.ts`

- Dodać 12 pól do interfejsu `PostLayoutSettings`.
- Dodać defaulty w `defaultPostLayoutSettings()`.
- Nowy helper `overlayTypographyStyles(settings)` → zwraca dwa obiekty CSS z custom properties `--overlay-title-*` i `--overlay-excerpt-*` (base + `@media` przez CSS vars i klasy responsywne w globalnym CSS).

### 3. Globalne CSS - `src/styles.css`

Dodać reguły korzystające z CSS variables ustawianych inline na wrapperze cover:

```css
.overlay-typography { font-size: var(--overlay-title-base); }
@media (min-width: 768px) { .overlay-typography { font-size: var(--overlay-title-md); } }
@media (min-width: 1024px) { .overlay-typography { font-size: var(--overlay-title-lg); } }
/* analogicznie .overlay-excerpt-typography, .header-title-typography, .header-excerpt-typography */
```

Dzięki temu tytuł/subtytuł konsumuje inline-style zmienne, a responsywność załatwia CSS - bez `@source inline` i bez dynamicznych klas Tailwind.

### 4. Renderer publiczny - `src/components/PostLayoutRenderer.tsx`

- Pobrać `settings` (już w propsach).
- Na `<h1>` overlay: usunąć `text-2xl md:text-3xl lg:text-4xl`, dodać `overlay-title-typography` + `style={{"--overlay-title-base": ..., "--overlay-title-md": ..., "--overlay-title-lg": ...}}`.
- Analogicznie dla `<p>` excerpt: klasa `overlay-excerpt-typography` + CSS vars.
- To samo dla klasycznego nagłówka bez cover (`.header-title-typography`, `.header-excerpt-typography`).

### 5. Podgląd CMS - `src/components/admin/blocks/LayoutScaffold.tsx`

- Propsy scaffolda już dostają `settings`. Zaaplikować te same klasy + CSS vars w `Header`, `OverlayCover`, `SideBySide` - żeby preview 1:1 pokazywał efekt sliderów zanim użytkownik zapisze.
- Preview czyta lokalny `local` state z routa (już przez propsy → route przekazuje `local`).

### 6. Panel - `src/routes/admin.post-layouts.tsx`

Nowa sekcja „Typografia overlay" pod „Featured Ratio":

```
Tytuł overlay:   [base 24] [md 30] [lg 36]
Podtytuł overlay:[base 12] [md 14] [lg 16]
Tytuł (bez cover):    [base 30] [md 36] [lg 48]
Podtytuł (bez cover): [base 16] [md 18] [lg 18]
```

Kontrolka: `<input type="range" min=10 max=96>` + liczbowe pole obok (double-input jak w istniejących `featured_ratio_*`). Live-preview korzysta z `local` state → efekt widoczny natychmiast w `LayoutPreview` bez zapisu.

### 7. Synchronizacja publiczny ↔ admin

Nic dodatkowego nie trzeba - `usePostLayoutSettings()` używa react-query, po `save.mutateAsync()` `invalidateQueries(["post-layout-settings"])` odświeży też renderer publiczny.

### 8. Testy

- Rozszerzyć `src/components/PostLayoutRenderer.test.tsx` o assert obecności CSS var `--overlay-title-lg` po podaniu settings.
- `src/lib/__tests__/postLayouts.test.ts`: `defaultPostLayoutSettings()` zawiera nowe pola.

### 9. i18n

Etykiety pól panelu: `t("admin.postLayouts.overlayTypography.*", { defaultValue: "Tytuł overlay (mobile)" })` itd. - PL fallback zgodnie z memory.

## Pliki dotknięte

- migration (nowa)
- `src/lib/postLayouts.ts` (+ nowe pola + helper)
- `src/styles.css` (+ 4 klasy responsywne)
- `src/components/PostLayoutRenderer.tsx` (klasy + CSS vars)
- `src/components/admin/blocks/LayoutScaffold.tsx` (klasy + CSS vars w Header/OverlayCover/SideBySide)
- `src/routes/admin.post-layouts.tsx` (nowa sekcja UI)
- `src/components/PostLayoutRenderer.test.tsx` / `src/lib/__tests__/postLayouts.test.ts` (aktualizacje)

## Ryzyko / uwagi

- Nie używam dynamicznych klas Tailwind ani `@source inline` - unikamy problemów z tree-shakingiem.
- CSS vars są settowane inline tylko na wrapperze cover/header, więc żaden inny widget nie dziedziczy.
- Zakres 10-96 zabezpiecza przed groteskowymi wartościami; można ograniczyć per pole (np. tytuł min 16).
