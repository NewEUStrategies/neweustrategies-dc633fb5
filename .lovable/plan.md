## Cel

Doprowadzić builder do poziomu „world class" stosując atomic design (atomy → molekuły → organizmy → szablony) i dodać cztery brakujące obszary: multi-tenant szablony, globalne style marki, hover, dodatkowe widgety.

## Warstwa atomic design (refaktor wspólny dla wszystkich punktów)

Stworzymy spójną strukturę w `src/components/admin/builder/ui/`:

- **atoms/** — `PropField`, `ColorSwatch`, `NumberStepper`, `ResponsiveInput`, `Switch`, `Segmented`, `TokenPicker`
- **molecules/** — `TypographyControl`, `SpacingControl`, `BorderControl`, `BackgroundControl`, `MotionControl`, `HoverToggle`
- **organisms/** — `WidgetPropertiesPanel`, `SectionPropertiesPanel`, `ColumnPropertiesPanel`, `WidgetLibraryPanel`
- **templates/** — `BuilderLayout` (lewy panel / canvas / toolbar)

Każdy widget z biblioteki rozbity będzie na ten sam wzorzec: `WidgetRegistry → WidgetView` (renderer) + `WidgetSchema` (definicja pól zaawan. wpinanych w `WidgetPropertiesPanel`). Dziś każdy widget ma ręczny `switch` w `WidgetProperties.tsx` — to wymienimy na deklaratywne schematy.

## 1) Multi-tenant dla szablonów

Migracja `builder_templates`:
- dodaje `tenant_id uuid not null default current_tenant_id()`
- backfill istniejących rekordów do tenanta autora (lub usunięcie, bo to dane testowe)
- RLS: SELECT/INSERT/DELETE tylko gdy `tenant_id = current_tenant_id()`
- indeks `(tenant_id, created_at desc)`
- `scope` rozszerzony o `'page'` i `'widget'` (na kolejne iteracje)

Klient: `useSectionTemplates` zostaje, ale używa RLS — żadnych zmian w kodzie wywołującym.

## 2) Globalne style marki (tokeny)

Nowa tabela `site_design_tokens` per tenant (lub klucz w `site_settings`):
- `colors: { brand, accent, neutralFg, neutralBg, ... }`
- `fonts: { heading, body, mono }`
- `radii`, `shadows`

UI: nowa karta w `Ustawienia → Marka i design` (edycja JSON-podobna z preview). Tokeny eksportowane do CSS variables w runtime przez `<DesignTokensStyle/>` montowany w `__root.tsx`.

`TokenPicker` (atom) w `TypographyControl` / kolor / `BackgroundControl` pokazuje tokeny obok pól wolnego tekstu — wybór tokena zapisuje `var(--brand)` zamiast hexa.

## 3) Style hover

Typ `CommonStyle` zyskuje opcjonalny `hover?: Partial<CommonStyle & { transition?: string }>`. `WidgetView` montuje `<style>` ze skopowaną regułą `[data-w-id="..."]:hover { ... }` zamiast inline (inline nie obsługuje `:hover`).

W panelu właściwości widgetu nowa molekuła `HoverToggle` przełącza widok Style ↔ Style (hover) — ten sam zestaw kontrolek edytuje warstwę hover.

## 4) Nowe widgety (accordion, tabs, testimonial, pricing, FAQ, stats, team)

Dodawane jeden po drugim według wzorca:
- `registry.tsx` — typ + ikona + kategoria + `makeWidget` z domyślną treścią dwujęzyczną
- `WidgetView.tsx` — renderer dostępny semantycznie (a11y: `role="tablist"`, `aria-expanded`, etc.)
- `schema` — pola edytora (przejście z `switch` na deklaratywny schemat)

Zakres pierwszej iteracji nowych widgetów: **Accordion**, **Tabs**, **Testimonial**, **Pricing Table**.

## Kolejność wdrożenia (osobne tury)

1. **Refaktor atomic design** — atomy/molekuły, migracja istniejących pól (`WidgetProperties`, `SectionProperties`, `ColumnProperties`) na molekuły. Bez zmian funkcjonalnych dla użytkownika, ale baza pod resztę.
2. **Multi-tenant szablonów** — migracja + RLS.
3. **Tokeny marki** — tabela + edytor + `TokenPicker` w pickerach.
4. **Hover** — typ + renderer + `HoverToggle`.
5. **Deklaratywne schematy widgetów** — migracja istniejących na schemat (bez nowych pól).
6. **Nowe widgety** — Accordion → Tabs → Testimonial → Pricing.

Po każdym kroku oddzielne podsumowanie + sanity check w preview.

## Sekcja techniczna

- Brak zmian w `client.ts`, `client.server.ts`, `types.ts` (auto).
- Typy buildera (`src/lib/builder/types.ts`) zyskają `hover`, ewentualne nowe pola w schematach.
- Wszystkie nowe pliki — TypeScript strict; `lucide-shim` poszerzony jeśli zabraknie ikon.
- Migracje: `builder_templates` (alter) + `site_design_tokens` (create + GRANT + RLS).
- Bez SSR/edge zmian; cała praca w stronie klienta + RLS.

## Co NIE wchodzi w ten plan

- Bezpośrednia edycja inline w canvasie (kliknij heading → wpisz tekst).
- Historia rewizji per szablon.
- Marketplace szablonów między tenantami.
- Eksport/import dokumentu jako JSON do pliku.

Można dodać w osobnych iteracjach po zakończeniu powyższych sześciu kroków.