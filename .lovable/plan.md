# Builder layoutu strony eksperta

Rozszerzamy istniejący builder (`builder_templates` + `PageRenderer`) o nowy target `expert_profile`, dedykowane widgety huba eksperta oraz mechanizm per-ekspert override. Publiczna trasa `/author/$slug` przestaje być hardkodowanym JSX-em - renderuje layout z buildera, karmiony `ExpertHubData`.

## Zakres

### 1. Warstwa danych (migracja)

```text
builder_templates.target enum: dodaj 'expert_profile'
author_profiles: nowe kolumny
  ├─ layout_template_id   uuid  → builder_templates(id) NULLABLE
  ├─ layout_overrides     jsonb NULLABLE  (patch nadpisujący sloty globalnego szablonu)
  └─ counterpart_user_id  uuid  → profiles(id) NULLABLE  (odpowiednik PL↔EN, dwukierunkowy sync przez trigger)
site_settings: klucz 'expert_profile_default_template_id'
```

- RLS: publiczny odczyt `builder_templates` gdzie `target='expert_profile' AND is_published`; zapis staff-only (jak istniejące polityki).
- GRANT-y wg reguł projektu (authenticated CRUD, service_role ALL, anon SELECT na opublikowane).
- Trigger dwukierunkowy: ustawienie `counterpart_user_id` na jednym profilu synchronizuje drugą stronę.

### 2. Widgety eksperta (`src/components/blocks/widgets/expert/`)

Rejestrujemy w `widgetRegistry` z prefiksem `expert.*`, wszystkie dostają `ExpertHubData` przez kontekst `ExpertRenderContext` (React context wokół `PageRenderer` w route'cie autora):

```text
expert.hero            → nagłówek CSIS (portret + imię + role + social)
expert.expertise-bar   → pasek obszarów ekspertyzy
expert.bio             → długa biografia (PL/EN switch po i18n)
expert.programs        → karty programów/projektów/departamentów
expert.materials       → ExpertMaterialsExplorer z filtrami
expert.in-the-news     → media mentions
expert.podcast-strip   → PodcastEpisodeStrip
expert.cv              → sekcje CV (awards/education/experience/skills)
expert.contact         → kontakt bezpośredni + media contact
expert.language-switch → link do odpowiednika PL/EN (counterpart)
```

Każdy widget: schema (props: nagłówek, warianty, widoczność pól), preview w builderze (dane demo z faker), production render (dane realne z kontekstu).

### 3. Admin - edytor globalnego szablonu

- Nowa trasa `/admin/appearance/expert-layout` (dodana do `AdminShell` w sekcji „Wygląd").
- Wykorzystuje istniejący `BuilderCanvas` / `WidgetPalette` z filtrem `target='expert_profile'`.
- CRUD szablonów + zaznaczenie „domyślny" (zapis w `site_settings`).
- Podgląd na żywo z wybranym ekspertem (dropdown eksperta jako źródło danych).

### 4. Admin - per-ekspert override

- W `/admin/authors/$id/edit` (edytor profilu autora, zakładka „Layout"):
  - Wybór szablonu z listy `expert_profile` (domyślnie globalny).
  - Przycisk „Nadpisz sloty" → otwiera BuilderCanvas w trybie override (patch merge).
  - Wyczyść override → wraca do szablonu bazowego.
- Mapowanie PL/EN: pole `counterpart_user_id` z searchable combo (profile z rolą expert), symetryczna aktualizacja.

### 5. Publiczna trasa `/author/$slug`

`src/routes/author.$slug.tsx`:

- Loader ładuje `ExpertHubData` + rozwiązany layout (`author_profiles.layout_template_id ?? site_settings.default`), merge z `layout_overrides`.
- Zamiast hardkodowanego JSX renderuje `<ExpertRenderContext.Provider value={hub}><BuilderRenderer template={resolved} /></ExpertRenderContext.Provider>`.
- Fallback: jeśli brak szablonu i brak domyślnego → renderuje built-in default template (seed w migracji z aktualnym layoutem CSIS).
- Link do odpowiednika PL/EN w headerze route'a + hreflang w `head()`.

### 6. i18n, tenant, testy

- Wszystkie widgety: `useTranslation`, teksty w `src/lib/i18n-experts` (klucze `expert.widget.*`).
- Zapytania scope'owane przez `public_tenant_id()` / `useRequiredTenant()`.
- Testy:
  - `expert_layout_test.sql` - RLS na `builder_templates(target='expert_profile')` i `author_profiles.layout_*`.
  - `src/components/blocks/widgets/expert/__tests__/*.test.tsx` - render widgetów z mock hubem.
  - `e2e/expert-layout.spec.ts` - admin tworzy szablon, ustawia domyślny, override per-ekspert, sprawdza render publiczny + przełączenie PL/EN.

## Szczegóły techniczne

- Merge overrides: JSON Patch (RFC 6902) na drzewie slot'ów szablonu; utils `mergeLayoutOverride(base, patch)` z testami jednostkowymi.
- ExpertRenderContext eksponuje `hub`, `lang`, `t` - widgety NIE robią własnych zapytań, tylko konsumują kontekst (jedno źródło prawdy).
- Widgety spoza `expert.*` nadal działają w tym szablonie (możliwość dodania `text`, `image`, `cta` itd.).
- Zero `as any`; wszystkie typy z `src/lib/experts/types.ts` + rozszerzenie o `ExpertLayoutTemplate` w `src/lib/experts/layout.ts`.

## Deliverables

1. Migracja SQL (enum + kolumny + trigger + seed default template + GRANTs + RLS + `nes_pl_light_stem` reprise jako sanity check).
2. `src/lib/experts/layout.ts` (typy, query options, merge utils).
3. 10 widgetów `expert.*` + rejestracja.
4. `src/routes/admin.appearance.expert-layout.tsx` + wpis w `AdminShell`.
5. Zakładka „Layout" + „Odpowiednik PL/EN" w edytorze autora.
6. Refactor `src/routes/author.$slug.tsx` na `BuilderRenderer`.
7. Testy SQL/unit/e2e + wpisy i18n PL/EN.

Po Twoim OK zaczynam od migracji (wymaga akceptacji), potem warstwa app.