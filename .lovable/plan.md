## Cel
Dashboard `/admin/crm` (osoby/kontakty) w stylu HubSpot - identyczna DX co świeżo zbudowana `/admin/companies` - oraz strona szczegółowa pojedynczej osoby `/admin/crm/$id`.

## Co powstanie

### 1. `src/lib/crm/leadViews.ts`
Analogicznie do `companyViews.ts`:
- `LeadFilter` (Zod): `stage`, `scoreBand`, `source`, `company`, `country`, `createdRange`, `activityRange`, `hasNotes`
- `LEAD_COLUMNS`: `name`, `email`, `phone`, `position`, `company`, `stage`, `scoreBand`, `score`, `source`, `country`, `tags`, `lastActivity`, `created`, `owner`
- `LeadSort`, `LeadViewConfig`, defaults, `applyLeadFilters` (client-side), CSV export helper
- `resolveLeadView` (built-in views: `all`, `mine`, `hot`, `new`, `follow_up`, `won`)

### 2. Rozszerzenie danych
- `crm.functions.ts` -> nowa funkcja `getCrmLead` już istnieje; dodam `getCrmLeadCompany` (link do `crm_companies`) i użyję istniejącego `getCrmLeadTimeline` do aktywności.
- Reuse tabeli `saved_views` z entity `lead` (już wspierane w `crm-saved-views.functions.ts`).

### 3. Refaktor `src/routes/admin.crm.tsx`
Zachowuję działający sheet-drawer, ale przód dashboardu przebudowuję na wzór `admin.companies.tsx`:
- 3 karty statystyk (Wszystkie / Hot / Nowe 7d)
- Pasek: search + filter chips (`CompanyFilterChips` -> analogiczny `LeadFilterChips`)
- Zakładki zapisanych widoków (built-in + user + shared) - reuse SavedViewsTabs
- Column manager (popover) - analogiczny `LeadColumnManager`
- Tabela: awatar/inicjały, badge stage, `LeadScoreBadge`, sortable headers, CSV export
- Drawer podglądu (Sheet) - istniejący, uporządkowany

### 4. Nowa strona `src/routes/admin.crm.$id.tsx`
Trójkolumnowy widok:
- **Left rail**: awatar + imię/nazwisko, stage badge, score, quick actions (edit inline: telefon, email, pozycja, źródło, tagi, notatka szybka)
- **Main tabs**: 
  - `Overview` - dane, ostatnia aktywność, powiązana firma
  - `Activity` - timeline (audit + notatki) z filtrami i kompozerem notatki
  - `Analytics` - punkty scoringu (breakdown), stage funnel
- **Right sidebar cards**: powiązana Firma (link do `admin.companies.$id`), Zadania (`LeadTasksPanel`), Follow-ups (`FollowUpsPanel`), Integracje (Merydian push)

## Zakres poza planem (nie ruszam)
- Logika scoring/reguły, integracje Merydian - już działają, tylko konsumuję.
- Existing edit inline UX z panelu wpp - portuję do left rail bez zmian logiki.
- Publiczne końcówki, RLS - bez zmian.

## Efekt
- `/admin/crm` = HubSpot-style lista osób z tabami/kolumnami/CSV.
- `/admin/crm/:id` = pełny widok osoby z powiązaniami do firmy (klikalne z listy i drawera).
- i18n PL/EN, dark/light, 6px rounding, spójne z resztą platformy.
