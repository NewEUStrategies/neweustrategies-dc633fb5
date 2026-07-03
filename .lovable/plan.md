
## Cel

1. W mobilnym drawerze (Header) na górę trafiają: **wyszukiwarka, przełącznik motywu, przełącznik języka**.
2. Usuwamy zaszytą sekcję „Menu / Nawigacja" (Strona główna / Aktualności / Cennik) — nawigacja ma być w pełni sterowana konfiguracją.
3. Powstaje nowa strona **`/admin/super/mobile-drawer`** (widoczna tylko dla `super_admin`), gdzie można poukładać kolejność bloków drawera oraz zdefiniować pozycje menu (label PL/EN, URL, ikona, aktywność).

## Zakres UI drawera po zmianach

Kolejność sekcji drawera (od góry):

```text
┌─ [X] MENU / [X]                        ← header drawera
├─ TOP TOOLS  ← search + theme + language (poziomo)
├─ MOJE KONTO ← Panel/Profil + Wyloguj (lub Zaloguj/Zarejestruj)
├─ NAWIGACJA  ← pozycje z konfiguracji (dynamiczne)
└─ BUILDER    ← reszta widgetów authored w header builder_data
```

Blok „TOP TOOLS", „MOJE KONTO", „NAWIGACJA", „BUILDER" jest przeciągalny w edytorze — kolejność zapisywana per tenant.

## Backend

Nowa tabela `mobile_drawer_configs` (per tenant, dokładnie 1 rekord):

- `tenant_id uuid` (unikalne, FK do `tenants`)
- `section_order text[]` — permutacja `['top_tools','account','nav','builder']`
- `nav_items jsonb` — tablica `{ id, label_pl, label_en, href, icon, enabled }`
- `top_tools jsonb` — `{ search: bool, theme: bool, language: bool }`
- standardowo: `created_at`, `updated_at`, `created_by`

RLS + GRANT:
- `SELECT` dla `anon` + `authenticated` (drawer ładuje anonimowo, filtr po `tenant_id = public_tenant_id()`).
- `INSERT/UPDATE/DELETE` tylko `is_super_admin(auth.uid())` w kontekście tego tenanta.
- `GRANT` zgodnie z regułą (`SELECT` anon+authenticated, pełne `service_role`).

Server function `getMobileDrawerConfig` (publiczny read, host-aware przez `public_tenant_id()`) + `upsertMobileDrawerConfig` (chroniony `requireSupabaseAuth` + guard `is_super_admin`).

## Frontend

1. **`Header.tsx`** — usunięcie hardkodowanej listy `navItems` z `MobileAccountNav`. Drawer składany dynamicznie z `section_order`.
2. **Nowe komponenty** (atomic):
   - `src/components/header/mobile/TopTools.tsx` (search input + `ThemeToggle` + `LanguageSwitcher` — reużywamy istniejące).
   - `src/components/header/mobile/AccountSection.tsx` (wydzielenie z obecnego kodu).
   - `src/components/header/mobile/NavSection.tsx` (renderuje `nav_items`).
3. **Nowa trasa** `src/routes/_authenticated/admin.super.mobile-drawer.tsx`:
   - Gate: `is_super_admin` (redirect do `/admin` przy braku uprawnień).
   - DnD kolejności sekcji (`@dnd-kit/core` — już w projekcie? sprawdzę; jeśli nie, użyję prostych strzałek ↑/↓, żeby nie dodawać zależności bez zgody).
   - Edytor `nav_items` (add/remove/reorder, PL/EN, wybór ikony z `lucide-react`).
   - Toggle `top_tools`.
   - Podgląd na żywo (render drawera w iframe/wrapperze mobile).
4. **i18n** — PL/EN dla nowej strony (klucze w `src/locales/*/admin.json`).
5. **Testy** — vitest dla server functions (guard super-admin, walidacja `section_order`), oraz smoke test komponentu DrawerRenderer.

## Bezpieczeństwo / multi-tenant

- Zapis zawsze scoped do `current_tenant_id()` — nawet super-admin nie może przypadkiem edytować obcego tenanta.
- Walidacja Zod po stronie server-fn (permutacja, dozwolone ikony, max 20 nav items, długości stringów).
- Wpis w `audit_log` przy każdym `upsert`.

## Kolejność wdrożenia (jedna migracja + osobne PR-y kodu)

1. Migracja SQL (tabela + policies + grants + trigger `updated_at`).
2. Server functions + query options + Zod.
3. Refactor `Header.tsx` → nowe komponenty + dynamiczny rendering (z fallbackiem do sensownych defaultów gdy brak rekordu).
4. Strona super-admin + i18n + testy.

## Pytanie do decyzji (jedno, wpływa na scope)

Czy w kroku 3 mam używać **`@dnd-kit`** (płynny drag&drop, +~15 KB gzip) czy prostych **przycisków ↑/↓** (0 zależności, mniej efektowne)? Domyślnie idę w `@dnd-kit`, bo to standard w projekcie super-admin.
