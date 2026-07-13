## Cel

Analogicznie do `/admin/post-layouts` — pełny system layoutów dla publicznej strony eksperta (`/author/$slug`): 8 gotowych wariantów, admin panel do konfiguracji domyślnych ustawień per tenant, inline editor dostępny dla samego eksperta na jego stronie, wszystkie sekcje (bio, socials, kontakt, specjalizacje, programy, projekty, media, CV, materiały) sterowalne.

Migracja SQL została już wdrożona w poprzedniej turze (tabela `expert_layout_settings` + kolumny `layout_preset`, `layout_overrides`, `layout_section_order`, `brand_accent`, `brand_accent_dark` w `author_profiles`).

## Kroki

### 1. Definicje presetów i typy
- `src/lib/expertLayouts.ts` — 8 wariantów:
  1. `classic` - split hero (foto lewo, bio prawo), sekcje wertykalnie
  2. `centered` - wycentrowane hero, wąska kolumna
  3. `magazine` - duże cover na całą szerokość, hero na dole
  4. `sidebar-left` - sticky sidebar z kontaktem/socials po lewej, treść po prawej
  5. `sidebar-right` - odwrócony sidebar
  6. `minimal` - typograficzny, bez okładki, akcent linią
  7. `card-stack` - każda sekcja w kartach z cieniem
  8. `editorial` - okładka z overlay + subskrybowane cytaty
- Typy: `ExpertLayoutPreset`, `ExpertLayoutSettings`, `ExpertLayoutOverrides` (kolory, wycentrowanie, kolejność sekcji, widoczność).
- `mergeExpertLayout(tenant, expert)` - preset → tenant defaults → expert overrides.

### 2. Hooki i zapytania
- `src/hooks/useExpertLayoutSettings.ts` + `expertLayoutQueryOptions(tenantId)`.
- Rozszerzenie `src/lib/experts/queries.ts` o pola layoutu w `authorProfileQueryOptions`.

### 3. Renderer
- `src/components/experts/ExpertLayoutRenderer.tsx` - jeden komponent, `variant` decyduje o strukturze; sekcje jako children (bio, expertise, socials, contact, media, podcast, materiały, CV, programy, projekty).
- Refaktor `src/routes/author.$slug.tsx` — zamiast statycznego JSX używa renderera; wszystkie istniejące sekcje przeniesione bez utraty funkcjonalności.

### 4. Inline editor eksperta
- `src/components/experts/ExpertLayoutEditor.tsx` - `Sheet` widoczny, gdy `viewer.id === expert.user_id` lub staff.
- Pola: wybór presetu (8 kart z podglądem), toggle wycentrowania hero/details, widoczność sekcji, kolejność (drag), kolory akcentu (`AdminColorPicker`, light/dark), max-width.
- Server function `saveExpertLayoutOverrides` (`.middleware([requireSupabaseAuth])`) — RLS pozwala aktualizować własny `author_profiles`.
- Przycisk "Edytuj layout" widoczny w hero dla właściciela; staff widzi też link do admina.

### 5. Admin panel
- `src/routes/admin.expert-layouts.tsx` - mirror `admin.post-layouts.tsx`:
  - wybór domyślnego presetu tenanta
  - globalne kolory hero, max-width, wycentrowanie
  - widoczność sekcji (kanoniczna lista + kolejność)
  - lista ekspertów z nadpisaniami (link do inline editora na ich stronie)
- Rejestracja w sidebarze (`AdminShell.tsx`) pod "Layouty wpisów":
  `{ to: "/admin/expert-layouts", icon: Users, label: t("admin.nav.expertLayouts") }`.
- Tłumaczenia PL/EN dla `admin.nav.expertLayouts` + kluczy presetów.

### 6. Bezpieczeństwo i i18n
- Server functions używają `requireSupabaseAuth`/`requireStaff` (edycja własnego profilu vs tenant defaults).
- `tenant_id` wymuszany przez RLS (już w migracji).
- Klucze i18n dla wszystkich 8 wariantów + opisów sekcji (PL/EN).
- Zamiana em-dash na "-" w nowych stringach, brak `any`.

### 7. Testy
- `src/components/experts/__tests__/ExpertLayoutRenderer.test.tsx` - render każdego z 8 wariantów, widoczność sekcji, kolejność.
- `src/lib/__tests__/expertLayouts.test.ts` - merge presetów i overrides.
- A11y smoke test dla wariantu `classic`.

## Szczegóły techniczne

```text
Data flow:
tenant expert_layout_settings (globalne defaults)
        ↓ merge
author_profiles.layout_preset + layout_overrides (per ekspert)
        ↓ merge
ExpertLayoutRenderer → sekcje
```

Uprawnienia zapisu:
- Ekspert (sam) → tylko własne `author_profiles.layout_*`
- Admin/editor → `expert_layout_settings` + wszystkie `author_profiles`

Pliki do stworzenia (~8) i edycji (~5). Szacowany rozmiar: ~1500 LOC + testy.

## Uwaga o zakresie

To duże wdrożenie. Wykonam je w jednej turze końcowo (wszystkie pliki równolegle), ale najpierw proszę o akceptację planu — w szczególności listy 8 wariantów oraz zakresu inline editora (jakie pola ekspert ma sam zmieniać vs tylko admin).
