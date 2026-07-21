## Cel

Rozbudowa `/admin/coupons` do pełnowymiarowej strony zarządzania kuponami B2B z 4 zakładkami, ujednoliconymi kalendarzami (shadcn Popover + Calendar) i drop-listami (Select) zgodnie z layoutem, oraz integracjami: CRM (leady/organizacje), Newsletter (kampanie z unikalnymi kodami), Subskrypcja (auto-grant membership).

## Zakres UI/UX

**Layout**: `AdminShell` z `Tabs` (shadcn) - te same tokeny `--td-*`, floating-input, 6px rounding, checkbox premium. Wszystkie date pickery → `Popover` + `Calendar` (`pointer-events-auto`, PL/EN locale via `date-fns`). Wszystkie `<select>` → shadcn `Select` z tokenami `--input-border`.

## Zakładki

1. **Kupony** (`/admin/coupons` - default)
   - Rozbudowany CRUD (obecny + kolumny: `redemption_count`, `revenue_generated`, `assigned_org_id`, `grants_plan_id`, `grants_duration_days`)
   - Filtry: status, plan, wygaśnięcie, tenant, organizacja
   - Bulk actions (aktywuj/dezaktywuj/eksport)

2. **Kampanie** (`/admin/coupons/campaigns`)
   - Bulk generator: N kodów, prefix, długość, plan, wartość, wygaśnięcie, przypisanie do segmentu newslettera
   - Podgląd + eksport CSV
   - Integracja: tworzy `newsletter_campaigns` z merge tagiem `{{coupon_code}}` per subskrybent

3. **Realizacje** (`/admin/coupons/redemptions`)
   - Timeline z `b2b_coupon_redemptions` + join do `crm_leads`, `crm_companies`, `profiles`, `payment_orders`
   - Filtry: data, kupon, organizacja, status membership
   - Eksport CSV

4. **Analityka** (`/admin/coupons/analytics`)
   - Metryki: total redemptions, konwersja (issued→used), MRR z kuponów, top 10 kuponów, top organizacje
   - Wykresy (`recharts`): linie czasowe + słupki
   - Filtry per data/tenant/plan

## Migracje DB

```sql
-- Rozszerzenie b2b_coupons
ALTER TABLE b2b_coupons
  ADD COLUMN campaign_id UUID,
  ADD COLUMN assigned_org_id UUID REFERENCES crm_companies(id),
  ADD COLUMN assigned_lead_id UUID REFERENCES crm_leads(id),
  ADD COLUMN grants_plan_id UUID REFERENCES membership_tiers(id),
  ADD COLUMN grants_duration_days INTEGER,
  ADD COLUMN newsletter_segment TEXT,
  ADD COLUMN prefix TEXT;

-- Nowa tabela coupon_campaigns (bulk generation)
CREATE TABLE b2b_coupon_campaigns (
  id UUID PK, tenant_id, name, prefix, code_count, plan_id,
  discount_type, discount_value, expires_at, newsletter_campaign_id,
  segment_query JSONB, status, created_by, created_at, updated_at
);

-- RPC: bulk_generate_coupons(campaign_id, count) -> zwraca kody
-- RPC: redeem_coupon_with_side_effects(code, user_id)
--   → 1) redeem, 2) INSERT crm_leads note, 3) IF grants_plan_id
--     → INSERT membership_grants (plan, expiry)
-- Trigger: on b2b_coupon_redemptions INSERT → update crm_leads.score += bonus
```

Grants + RLS (admin/staff write, tenant scope na read).

## Integracje

- **CRM**: Redemption tworzy notatkę w `crm_lead_notes`, event w `crm_leads.last_activity_at`, +N do lead score
- **Newsletter**: Formularz "Wyślij kampanię" tworzy `newsletter_campaigns` z listą subskrybentów z segmentu, każdy dostaje unikalny kod z puli
- **Membership**: RPC `redeem_coupon_with_side_effects` przy sukcesie inseruje `membership_grants` z `plan_id`, `granted_at=now()`, `expires_at=now()+grants_duration_days`

## Struktura plików

```text
src/routes/admin.coupons.tsx              (layout + zakładka Kupony)
src/routes/admin.coupons.campaigns.tsx    (zakładka Kampanie)
src/routes/admin.coupons.redemptions.tsx  (zakładka Realizacje)
src/routes/admin.coupons.analytics.tsx    (zakładka Analityka)
src/components/admin/coupons/
  CouponFormDialog.tsx        (rozbudowany, z Popover+Calendar, Select)
  CouponCampaignForm.tsx      (bulk generator)
  RedemptionsTable.tsx
  CouponAnalyticsCharts.tsx
  DateRangePicker.tsx         (współdzielony, dopasowany do layoutu)
src/lib/coupons.functions.ts  (createServerFn: bulk generate, send newsletter, analytics)
```

## i18n

Klucze `admin.coupons.*` w PL/EN (list, form, campaigns, redemptions, analytics, validation).

## Testy

- RPC `redeem_coupon_with_side_effects`: happy path + expired + limit exceeded + membership grant assertion
- Bulk generator: unique codes, no collisions
- RLS: tenant isolation na wszystkich nowych tabelach

## Kolejność wdrożenia

1. Migracja DB (nowe kolumny, tabela campaigns, RPC, triggery, GRANT, RLS)
2. `coupons.functions.ts` (server functions)
3. Wspólne komponenty (DateRangePicker, formy z shadcn)
4. Route Kupony (upgrade istniejącej)
5. Route Kampanie
6. Route Realizacje
7. Route Analityka
8. i18n + link w sidebarze AdminShell
9. Weryfikacja (build + preview)
