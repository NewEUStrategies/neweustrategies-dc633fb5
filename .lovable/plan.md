
## Cel
Zbliżyć `/admin/companies` i `/admin/companies/:id` do UX HubSpot ze screenshotów: taby zapisanych widoków, konfigurowalne kolumny, chip‑filtry + „Filtry zaawansowane", oraz pełny layout karty firmy (Przegląd/Działania/Analityka + lewa kolumna „Informacje o firmie" + prawy sidebar z powiązaniami).

## Zakres

### 1. Dashboard `/admin/companies`
- **Taby zapisanych widoków** (Moje firmy / Wszystkie firmy / +): stan trzymany w `saved_views` (nowa tabela, per‑user tenant‑scoped) + zakładka aktywna w URL `?view=…`. „+" otwiera dialog nazwania widoku i zapisuje bieżące filtry/sort/kolumny.
- **Pasek narzędzi** wg screena: lewa strona `Szukaj`, prawa: `Widok tabeli` (menu), `Edytuj kolumny`, `Filtr (n)`, `Sortuj`, `Wskaźniki`, `Eksport`, `Zapisz`.
- **Chip‑filtry pod paskiem**: Właściciel firmy · Data utworzenia · Data ostatniej aktywności · Stan leada · `+` (dodaj kolejny) · `Filtry zaawansowane` · `Wyczyść wszystko`. Każdy chip otwiera popover z odpowiednim inputem (multi‑select / DateRange / LeadStage). Filtry serializowane do URL (`f.owner=…`, `f.created=…`).
- **Edytor kolumn** (Drawer po prawej): drag‑and‑drop kolejności, checkboxy widoczności; zbiór dostępnych kolumn: Firma, Domena, Branża, Właściciel, Kraj, Miasto, Telefon, E‑mail, Kontakty, Leady, Score, Data utworzenia, Ostatnia aktywność, Stan leada, LinkedIn, Tagi. Ustawienia zapisywane w bieżącym widoku.
- **Wskaźniki** (`Metrics`): pop‑over pokazujący sumy dla widocznego widoku (suma leadów, kontaktów, hot/warm/cool z lead score).
- **Eksport CSV** (front‑side, aktywny widok + filtry).
- Tabela zostaje gęsta, ale renderuje wyłącznie kolumny wybrane w widoku (dynamiczne `<th>/<td>`).

### 2. Server: filtrowanie + widoki
- Rozszerzyć `listCrmCompanies` o `filters: { owner?, createdFrom?, createdTo?, activityFrom?, activityTo?, leadStage?, country?, branch? }` (Zod) — filtrowanie na serwerze; front nadal może dofiltrować lokalnie.
- Migracja `saved_views` (`id`, `tenant_id`, `user_id`, `entity` = `'company' | 'lead' | 'contact'`, `name`, `config jsonb`, `is_shared`, `sort_order`, timestamps + RLS + GRANTs). Server‑fn `listSavedViews`, `upsertSavedView`, `deleteSavedView` (staff‑guard, tenant‑scoped).

### 3. Widok firmy `/admin/companies/:id`
Zamiast obecnego jednokolumnowego, HubSpot‑layout 3‑kolumnowy:

```text
┌──────────────┬────────────────────────────────────┬──────────────┐
│  Left rail   │  Main (tabs)                       │  Right rail  │
│  logo/name   │  [Przegląd] [Działania] [Analityka]│  Kontakty    │
│  Actions:    │  ─ Wyróżnione dane                 │  Transakcje  │
│   Notatka    │  ─ Ostatnie działania (filtry)     │  Wyceny      │
│   E‑mail     │  ─ Kontakty                        │  Zgłoszenia  │
│   Zadanie    │  ─ Firmy powiązane                 │  Firmy pow.  │
│   Więcej ▾   │  ─ Transakcje / Notatki            │              │
│  ─ Info      │                                    │              │
│  domena/     │                                    │              │
│  tel/adres/  │                                    │              │
│  linkedin/   │                                    │              │
│  branża/opis │                                    │              │
└──────────────┴────────────────────────────────────┴──────────────┘
```

- Nawigacja tabs: shadcn `Tabs` (`Przegląd`, `Działania`, `Analityka`, `Dostosuj`).
- „Wyróżnione dane": Data utworzenia · Etap cyklu życia · Data ostatniej aktywności (edytowalne inline).
- „Ostatnie działania": używa istniejącego `getCrmCompanyActivity`, filtry (`Aktywność`, `Cały czas / 7d / 30d / 90d`), grupowanie po miesiącu.
- Prawy sidebar: Kontakty (kafle z awatarem, mail, tel), Transakcje/Wyceny/Zgłoszenia/Firmy powiązane — puste stany 1:1 jak w HubSpot.
- Reużywam `getCrmCompany`, `updateCrmCompany`, `getCrmCompanyActivity`, `addCrmCompanyNote`, `AddContactDialog`.
- Analityka: mini‑wykresy (`ChartFrame`): liczba leadów/kontaktów w czasie + rozkład stanu leadów.
- Zachowuję dotychczasowy Drawer na liście — link „Otwórz pełną kartę" prowadzi do `/admin/companies/:id`.

### 4. Sprzątanie i i18n
- Wszystkie napisy PL/EN via `t()` (istniejący pattern lokalny w tym pliku), zero literałów w środku widoku.
- Zamiana „—" na „-" zgodnie z konwencją projektu.
- Brak `any` / `as any` — typy dla filtrów i widoków w `src/lib/crm/views.ts`.
- Testy vitest: `crm/views.test.ts` (serializer filtrów), `admin.companies.filter.test.tsx` (renderowanie chipów).

## Poza zakresem
- Real HubSpot sync (tylko UX, dane z `crm_companies`).
- „Podsumowanie AI", „Asystent" z prawego górnego rogu HubSpot.
- Współdzielenie widoków między użytkownikami (tabela już to wspiera, ale UI dodam w kolejnym kroku).

## Techniczne szczegóły
- Nowe pliki: `src/lib/crm/views.ts` (typy filtrów + serializer URL), `src/lib/crm-saved-views.functions.ts`, `src/components/admin/crm/CompanyViewsTabs.tsx`, `CompanyColumnEditor.tsx`, `CompanyFilterChips.tsx`, `CompanyMetricsPopover.tsx`, `CompanyOverviewSection.tsx`, `CompanyRightSidebar.tsx`, `CompanyLeftRail.tsx`.
- Migracja: `create table public.saved_views` + GRANT authenticated/service_role + RLS (`user_id = auth.uid()` + `tenant_id = public_tenant_id()`).
- `admin.companies.tsx` przechodzi na dynamiczne kolumny i URL‑search state (TanStack `validateSearch` z `zodValidator` + `fallback`).
- `admin.companies.$id.tsx` przepisane pod nowy layout, ale reuse tych samych server‑fn.

## Ryzyka
- Wydajność listy przy ~15 tys. rekordów: mimo że nasz zbiór jest mniejszy, i tak dodam paginację server‑side (limit/offset) w `listCrmCompanies` w tej samej PR, żeby uniknąć regresu po dodaniu kolumn.
- Zapisane widoki: pilnujemy RLS, żeby userzy nie widzieli widoków innych tenantów; testy SQL w `supabase/tests/saved_views_test.sql`.
