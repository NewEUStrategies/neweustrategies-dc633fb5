## Cel

Zbudować w panelu admina dedykowaną stronę "Post Sidebar Builder" w stylu Elementora, w której administrator komponuje sidebar wpisu z bloków/widgetów. Aktualny panel reading-rail (Spis treści + postęp + Zapisz / PDF / Drukuj / ikony social) zostaje opakowany w pojedynczy widget CMS "Reading Panel". Jedyne ustawienia tego widgetu to wybór platform social, na które można udostępnić wpis (X, Facebook, LinkedIn, Mail, Copy link, WhatsApp, Telegram, Reddit). Wszystko z i18n (PL/EN), tenant_id, RLS, testami, atomic design, semantycznymi tokenami, 5px radius.

## Architektura danych (Lovable Cloud)

Nowa tabela `post_sidebar_layouts` (per tenant, jeden "default" + opcjonalne nazwane warianty):

```text
post_sidebar_layouts
  id uuid pk
  tenant_id uuid not null (RLS)
  name text not null            -- "default", "longform", ...
  is_default boolean default false
  widgets jsonb not null        -- [{ id, type, settings, hidden }]
  created_at / updated_at / created_by
```

- GRANT + RLS: SELECT dla `anon` i `authenticated` (publiczny render), INSERT/UPDATE/DELETE tylko dla roli `admin`/`editor` przez `has_role(auth.uid(), 'admin', tenant_id)`.
- Index: `(tenant_id, is_default)` i `(tenant_id, name)` unique.
- Unique constraint zapewniający dokładnie jeden `is_default = true` per tenant.

Override per-wpis: nowa kolumna `posts.sidebar_layout_id uuid null` (FK -> post_sidebar_layouts). Brak = używamy default tenantu.

## Rejestr widgetów sidebar

`src/lib/sidebarBuilder/registry.ts` - rejestr typów widgetów, każdy z `type`, `label PL/EN`, `icon`, `defaultSettings`, `Editor`, `Viewer`, `schema (zod)`.

Wersja MVP - 6 widgetów:

1. `reading-panel` - obecny FloatingShareBar w wariancie sidebar. Settings: `{ social: { x, facebook, linkedin, mail, copy, whatsapp, telegram, reddit }: boolean, showToc, showProgress, showSaveLater, showPrint, showPdf }`. UI ustawień - wyłącznie toggle dla 8 platform + 5 sekcji.
2. `tags` - chmura tagów wpisu.
3. `author-card` - karta autora.
4. `related-posts` - lista powiązanych (reuse `RelatedPosts`).
5. `newsletter` - formularz newslettera (reuse `NewsletterForm`).
6. `ad-slot` - slot reklamowy (reuse `AdZone position="sidebar"`).

Każdy widget renderuje się w sticky kontenerze sidebar. `reading-panel` ma własny sticky.

## Renderer publiczny

`src/components/post/PostSidebarRenderer.tsx`:

- pobiera layout (override lub default tenantu) przez query (cache 5 min, SWR)
- mapuje `widgets[]` -> komponent `Viewer` z rejestru
- przekazuje kontekst `{ post, articleRef, lang, tenantId, tags }`
- pomija widget gdy `hidden = true`

`src/routes/$.tsx` w slocie `sidebar={...}` przestaje hardkodować `<FloatingShareBar variant="sidebar" />` i renderuje `<PostSidebarRenderer postId={post.id} layoutId={post.sidebar_layout_id} ... />`.

## Edytor admina (Elementor-style)

Trasa: `src/routes/admin.appearance.post-sidebar.tsx` (pod istniejącym layoutem `_authenticated/admin`).

Layout 3-kolumnowy:

```text
+-------------------+--------------------------------+------------------------+
| Library           | Canvas (live preview)          | Inspector (settings)   |
| (lista widgetów   | sticky kolumna 320-360 px,     | edytor wybranego       |
|  do przeciagniecia| renderuje aktualny layout      | widgetu + delete /     |
|  na canvas)       | z dummy artykulem obok         | hide / duplicate       |
+-------------------+--------------------------------+------------------------+
```

- Drag & drop: `@dnd-kit/core` + `@dnd-kit/sortable` (juz w projekcie).
- Lewy panel: lista kart widgetow z ikona i opisem PL/EN, klik = dodaj na koniec, drag = wstaw na pozycji.
- Canvas: pionowa lista widgetow w sticky kontenerze, kazdy z handle (grab), przycisk hide, delete, klik = wybor do inspector.
- Inspector: dynamicznie renderuje `widget.Editor` (np. dla `reading-panel` tylko 8 togglow social + 5 sekcji toggle).
- Top bar: select layoutu (default / nazwane warianty), New, Rename, Duplicate, Delete, Save (mutacja), "Set as default", przelacznik podgladu Desktop / Mobile.
- Po stronie obok canvasu krotki dummy artykul z naglowkami h2/h3 zeby `reading-panel` mial Spis tresci do pokazania.
- Wszystkie napisy przez `useT()` z istniejacego `src/lib/i18n`.

Per-post override: na stronie edycji wpisu (`/admin/posts/$slug`) w sekcji "Post Layout" dodatkowy `Select` "Sidebar layout" (Default tenantu / nazwane warianty / Brak sidebara).

## Server functions

`src/lib/sidebarBuilder/sidebarLayouts.functions.ts` (createServerFn, requireSupabaseAuth):

- `listSidebarLayouts()` - lista layoutow tenantu
- `getSidebarLayout({ id | name })` - jeden layout
- `getDefaultSidebarLayout()` - default tenantu
- `upsertSidebarLayout({ id?, name, widgets, is_default })` - tylko admin/editor
- `deleteSidebarLayout({ id })` - tylko admin/editor

Publiczny odczyt na froncie idzie przez publishable client (RLS select dla anon) zeby uniknac uwierzytelnienia w SSR loaderze.

## Bezpieczenstwo

- RLS: SELECT public (anon + authenticated), pisarstwo tylko przez `has_role(auth.uid(), 'admin', tenant_id)` lub `'editor'`.
- Zod walidacja `widgets[]` (typ jest w rejestrze, settings per typ).
- Sanitizacja: `widgets` zawiera wylacznie wartosci primitive + znane klucze; brak dowolnego HTML.

## i18n

Nowy plik `src/lib/i18n/locales/sidebarBuilder.ts` (PL/EN) z kluczami:
- nazwy widgetow i opisy
- etykiety platform social (X, Facebook, LinkedIn, E-mail, Kopiuj link, WhatsApp, Telegram, Reddit)
- UI builderu (Library, Canvas, Inspector, Add widget, Hide, Show, Duplicate, Delete, Save, Set as default, New layout, ...)

## Testy

- Unit: rejestr widgetow (`getWidgetDef`, defaultSettings), zod schema, sanitizacja.
- Component: `PostSidebarRenderer` mapuje widgets -> komponenty i pomija hidden.
- Component: edytor - dodawanie / usuwanie / reorder (dnd-kit testing utils), zapis wywoluje server fn z poprawnym payloadem.
- Reading panel social toggles: kazdy wylaczony przycisk znika z DOM.
- Integration: posty z `sidebar_layout_id` renderuja override, bez - default tenantu.

## Migracja istniejacych wpisow

Seed: dla kazdego tenantu utworz `default` layout zawierajacy pojedynczy widget `reading-panel` ze wszystkimi platformami social wlaczonymi + `related-posts` na dole. Dzieki temu zachowanie publiczne nie zmienia sie po wdrozeniu.

## Wdrozenie krok po kroku

1. Migracja SQL: tabela `post_sidebar_layouts` + RLS + GRANT + index + kolumna `posts.sidebar_layout_id` + seed default per tenant.
2. Rejestr widgetow + Viewery (reading-panel w nowej formie + 5 reuse).
3. `PostSidebarRenderer` + podmiana w `src/routes/$.tsx`.
4. Server functions + cache query.
5. Trasa admina `admin.appearance.post-sidebar.tsx` (Library + Canvas + Inspector + dnd-kit).
6. Override Select na stronie edycji wpisu.
7. i18n PL/EN.
8. Testy (unit + component + integration).
9. Smoke test E2E (Playwright headless) - publiczny render + builder.

## Out of scope (na pozniej)

- Conditional display rules (per kategoria, per autor).
- Wlasne CSS per widget.
- Wiecej widgetow (TOC standalone, share-only standalone, table of contents typu numbered) - latwo dodac przez rejestr.
- Wariant dla stron (`pages`) - obecnie tylko `posts`.
