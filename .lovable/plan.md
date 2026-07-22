
## Cel

W `/admin/crm` (osoby/leady) i `/admin/companies` (firmy) dodać:
1. **Zaznaczanie wierszy** (checkboxy + zaznacz wszystko + licznik zaznaczonych).
2. **Edycję zbiorczą** – akcje na wielu rekordach naraz.
3. **Edycję inline** pojedynczego wiersza bez wchodzenia w kartę (etap, właściciel, tagi).
4. **Rozszerzone filtry** (dodatkowe kolumny + kombinacje) spójne z HubSpot‑style layoutem.

Wszystko z i18n (PL/EN), 6px rounding, kompaktowe kontrolki, poszanowanie `tenant_id` i RLS (super_admin cross‑tenant przez istniejący scope toggle).

## Zakres UI

### Tabela leadów (`admin.crm.index.tsx`)
- Nowa kolumna `checkbox` (shadcn `Checkbox`) na początku, header = „zaznacz wszystkie widoczne".
- Sticky pasek akcji nad tabelą pojawiający się, gdy `selected.size > 0`:
  - **Etap** (Select: new/contacted/qualified/proposal/won/lost/archived)
  - **Właściciel** (Select z listy staffu tenanta + „usuń")
  - **Tagi** (dodaj / usuń – input z popoverem)
  - **Newsletter opt‑in** (subskrybuj/wypisz – tylko UI, mapuje na `marketing_consent`)
  - **Eksport CSV zaznaczonych**
  - **Usuń** (z Confirm dialog – tylko super_admin/admin)
  - Przycisk „Wyczyść zaznaczenie".
- **Inline edit** w kolumnie `Etap` – kliknięcie chipa `StageBadge` otwiera mały Popover ze Select; stopPropagation dla nawigacji do karty.
- **Inline edit** w nowej kolumnie `Właściciel` (avatar staff + Select w Popoverze).
- **Inline tagi** – chipy w kolumnie „Tagi" z „+", Popover z listą i input.

### Tabela firm (`admin.companies.index.tsx`)
- Analogiczny checkbox + pasek akcji: **Właściciel**, **Kraj**, **Status/etap** (jeśli w schemacie), **Tagi**, **Eksport CSV**, **Usuń**.
- Inline edit właściciela i tagów w wierszu.

### Filtry (oba widoki)
- Rozszerzenie panelu filtrów o:
  - Zakres dat `last_activity_at` (Od–Do) – `DatePickerField`
  - Zakres dat `created_at`
  - Właściciel (multi‑select)
  - Tag(i) – multi‑select
  - Score range slider (0–100) dla leadów
  - Kraj (dla firm i leadów)
  - Newsletter status (subscribed/unsubscribed/pending) – tylko leady
- Persist w URL search params przez `zodValidator` + `fallback()` (spójne z resztą admin CRM); saved views już to obsługują – dołączamy nowe pola do `saved_views` schema.

## Zakres backend (server functions)

W `src/lib/crm.functions.ts` dodać:

```ts
export const bulkUpdateCrmLeads = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator(z.object({
    ids: z.array(z.string().uuid()).min(1).max(500),
    patch: z.object({
      stage: STAGE_ENUM.optional(),
      owner_id: z.string().uuid().nullable().optional(),
      add_tags: z.array(z.string().max(40)).max(20).optional(),
      remove_tags: z.array(z.string().max(40)).max(20).optional(),
      marketing_consent: z.boolean().optional(),
    }),
  }).parse)
  .handler(async ({ data, context }) => { /* update WHERE id IN (...) AND tenant_id */ });

export const bulkDeleteCrmLeads = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator(...)
  .handler(async ({ data, context }) => {
    // wymaga has_role(admin) – dodatkowe sprawdzenie
  });

export const listStaffUsers = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }) => { /* profile z user_roles staff/admin per tenant */ });
```

Analogiczne dla firm w `src/lib/crm/companies.functions.ts`:
- `bulkUpdateCrmCompanies`
- `bulkDeleteCrmCompanies`

Filtry: rozszerzyć `ListInput` w `listCrmLeads` o `owner_ids?`, `tags?`, `score_min?`, `score_max?`, `country?`, `date_from?`, `date_to?`, `created_from?`, `created_to?`. Filtruje przez PostgREST na widoku `crm_leads` (RLS scopes).

**Wydajność query builderów** – reasign builder ze zmiennym select stringiem: użyć `.select(sel("*"))` z helperem `const sel = (s: string): string => s` i `.returns<LeadRow[]>()` żeby nie mnożyć typów supabase‑js.

## Zakres schema (migracja)

Aktualne `crm_leads` mają wystarczające kolumny. Nowe:
- Indeksy pomocnicze (jeśli brak): `crm_leads(owner_id)`, `crm_leads(tenant_id, last_activity_at DESC)`, GIN na `tags`.
- Rozszerzenie schematu `saved_views.filter_schema` – bez zmiany DDL (JSONB).

Uprawnienia bulk delete: policy update/delete już scoped przez tenant + staff. Sprawdzenie roli admin dla delete robimy w handlerze przez `has_role`.

## Zakres realizacji (kroki)

1. **Migracja** – indeksy na `crm_leads` i `crm_companies` (owner_id, tenant+activity, GIN(tags)).
2. **Server fns** – `bulkUpdateCrmLeads`, `bulkDeleteCrmLeads`, `listStaffUsers` + analogiczne dla firm. Rozszerzenie `ListInput`.
3. **UI leadów** – checkbox column, sticky action bar, inline edit stage/owner/tags, rozszerzone filtry, integracja z `saved_views`.
4. **UI firm** – to samo.
5. **i18n** – nowe klucze w `PL/EN` (już w plikach obu route’ów jako lokalne mapki L).
6. **Testy** – Vitest jednostkowe dla `bulkUpdateCrmLeads` (add/remove tags, owner reset) + smoke test route’u (RTL) na renderowaniu paska akcji po zaznaczeniu.

## Techniczne detale

- Zaznaczenie: `useState<Set<string>>` + `useMemo` widocznych ID; „zaznacz wszystko" toggluje na aktualnej stronie.
- Sticky bar: `sticky top-[56px] z-20 bg-background/95 backdrop-blur border rounded-md px-3 py-2 flex flex-wrap gap-2 items-center`, animacja `data-[state=open]`.
- Inline popovery: shadcn `Popover` + `Command` (staff picker); stopPropagation na wszystkich klikach żeby nie odpalać nawigacji do karty.
- Bulk mutate: `useMutation` → `queryClient.invalidateQueries(["crm-leads"])`, toast z liczbą zaktualizowanych rekordów.
- Optymistyczna aktualizacja przy inline edit (setQueryData).
- Autoryzacja delete: w handlerze `has_role(userId, 'admin')` przez `context.supabase.rpc(...)`; UI ukrywa przycisk gdy `useAuth().isAdmin === false`.
- Brak `any`/`as any`; typy `LeadRow`/`CompanyRow` już istnieją.
- Atomic Design: nowy `BulkActionBar` w `src/components/molecules/BulkActionBar.tsx` (reużywalny między CRM osób i firm).

## Poza zakresem (osobne PR)

- Zmiana modelu tagów na słownikowy (obecnie `text[]`).
- Historia zmian bulk (audit log) – już logujemy update per rekord; bulk zostanie zaagregowany w kolejnym kroku, jeśli będzie potrzeba.
