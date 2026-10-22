# Pakiet I9d-1 – mechanizm retencji I9c-X2: jak dodać NOWE kategorie

Stan: gałąź PR #530 (`claude/loving-einstein-caze7r`, HEAD `75133fe20`), odczyt 2026-10-21.
Wspiera: `docs/PROMPT_KONTYNUACJI_HUB_2026-10-20.md` §8.1 pkt 1b–5 (nowe kategorie:
zgłoszenia do klubów, odczyty licznika `metered_views`, uczestnicy wydarzeń
`event_people`, nieaktywni subskrybenci newslettera) i §9 (I9: runbook – retencja,
karencja, pomiar otwarć, wygaszanie). Dziennik: `docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md`
§21.21 (l. 3753–3998), §20 S5 (l. 2172–2495). Rejestr: `docs/RODO_REJESTR_CZYNNOSCI_HUB_2026-10.md`
(sekcja „Retencja danych” l. 26–46, „Zgłoszenia do IOD” l. 198–236).

---

## 1. Mapa plików mechanizmu

| Warstwa | Plik | Rola |
| --- | --- | --- |
| SQL 1/5 | `supabase/migrations/20261020161000_data_retention_core.sql` (597 l.) | tabele, CHECK, agregaty, katalog, ustawienia efektywne, pieczęcie, seed karencji |
| SQL 2/5 | `…161100_data_retention_executor.sql` (837 l.) | funkcja per kategoria, `_data_retention_run_tenant`, `data_retention_run` |
| SQL 3/5 | `…161200_data_retention_reads.sql` (715 l.) | odczyt okien sprzed progu z agregatów (`_funnel_counts`, `monetization_dashboard`, `newsletter_campaign_engagement`, `admin_journey_stats`) |
| SQL 4/5 | `…161300_data_retention_open_tracking.sql` (362 l.) | przełącznik piksela `open_tracking_enabled` |
| SQL 5/5 | `…161400_data_retention_panel.sql` (438 l.) | RPC karty `admin_data_retention_*`, audyt, zdarzenie |
| Bliźniaki | `drizzle/migrations/0368…0372_data_retention_*.sql` | bajt w bajt (`cmp` OK), `meta/_journal.json` idx 368–372, `when` 1792477693912…1792477933912 (+60 000) |
| TS stałe | `src/lib/privacy/dataRetention.ts` (274 l.) | JEDNO źródło okresów/reguł (lustro SQL) |
| TS parser | `src/lib/privacy/dataRetentionParse.ts` (317 l.) | JSONB → DTO, rzuca przy rozjeździe |
| TS serwer | `src/lib/privacy/dataRetention.functions.ts` (209 l.) | `createServerFn` + `requireAdmin`, literały RPC |
| TS zapytania | `src/lib/privacy/dataRetentionQueries.ts` (142 l.) | `queryOptions`, mutatory, `useSaveOpenTracking` |
| TS klucze | `src/lib/privacy/keys.ts` (17 l.) | `dataRetentionKeys` (liść bez importów runtime) |
| UI | `src/components/admin/settings/dataRetention/{DataRetentionCard,RetentionCategoryRow,CrmDueList}.tsx` | karta (leniwy chunk), wiersz kategorii, lista „do anonimizacji” |
| Trasa | `src/routes/admin.settings.privacy.tsx` (85 l.) | `lazy()` + `Suspense` (l. 19–20, 73–81), `adminPageHead` (l. 32) |
| i18n | `src/lib/i18n-admin-data-retention.ts` (545 l.) | prefiks `adminDataRetention`, PL l. 15–279, EN l. 281–534, `ensureI18n()` l. 539 |
| Harmonogram | `src/lib/server/jobsTick.server.ts` l. 145–155 (typ), 281–283 (okno), 449–468 (krok) | RPC `data_retention_run` |
| Szyna | `src/lib/realtime/domainEvents.ts:262`, `eventInvalidationMap.admin.ts:39,186`, `eventInvalidationMap.ts:440` | `data_retention.changed.v1` → `dataRetentionKeys.tenant(tenant_id)` |
| Testy TS | `src/lib/privacy/__tests__/dataRetentionParity.test.ts` (185 l.), `dataRetentionParse.test.ts` (308 l.), `src/components/admin/settings/dataRetention/__tests__/DataRetentionCard.test.tsx` (384 l.), `src/lib/server/__tests__/jobsTickRun.test.ts:1326…`, `src/routes/api/public/-jobs-tick.test.ts:285` | |
| pgTAP | `supabase/tests/hub_i9c_data_retention_test.sql` (334 l., `plan(52)`), `hub_i9c_data_retention_aggregates_test.sql` (272 l., `plan(23)`), `hub_shared_helpers_test.sql` (lista `hub-grants` l. 79–131) | |
| Bramka | `src/lib/ci/hubDelivery.ts` (1566 l.) + `src/lib/ci/__tests__/hubDelivery.gate.test.ts` | rejestr funkcji, CIALO-Z, granty, manifest I9 |

---

## 2. Model danych (161000)

### 2.1 `public.data_retention_settings` (l. 72–100)
```sql
tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
category text NOT NULL,
period_months smallint,                 -- NULL dla ustawowej
enabled boolean NOT NULL DEFAULT true,
enforce_after timestamptz NOT NULL,     -- do tej chwili tylko PODGLĄD
updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
updated_at timestamptz NOT NULL DEFAULT now(),   -- token CAS panelu
created_at timestamptz NOT NULL DEFAULT now(),
PRIMARY KEY (tenant_id, category),
CONSTRAINT data_retention_settings_category_check CHECK (category IN (
  'paywall_metering','email_engagement','email_send_log','crm_inactive_contacts',
  'audit_log','journey_enrollments','cancellation_surveys','crm_customers','consent_log')),
CONSTRAINT data_retention_settings_period_check CHECK (CASE category
  WHEN 'paywall_metering' THEN period_months IS NOT NULL AND period_months BETWEEN 3 AND 25
  ...
  WHEN 'crm_customers' THEN period_months IS NULL AND enabled
  WHEN 'consent_log'   THEN period_months IS NULL AND enabled
  ELSE false END)
```
Zakresy obecne: paywall_metering 3–25 (dom. 13), email_engagement 3–25 (13),
email_send_log 6–25 (13), crm_inactive_contacts 12–36 (24), audit_log 12–60 (24),
journey_enrollments 6–25 (13), cancellation_surveys 12–36 (24); ustawowe crm_customers,
consent_log.

### 2.2 `public.data_retention_runs` (l. 102–119) – dziennik przebiegów (bez PII, bez aktora)
`id bigint IDENTITY PK`, `tenant_id` FK CASCADE, `category text NOT NULL CHECK (category IN (…9…))`
(**nienazwany** → `data_retention_runs_category_check`), `mode CHECK IN ('preview','execute')`,
`run_trigger CHECK IN ('schedule','manual')`, `cutoff`, `affected integer NOT NULL DEFAULT 0 CHECK >= 0`,
`backlog boolean NOT NULL DEFAULT false`, `error_code text CHECK (NULL OR char_length <= 64)`
(wyłącznie SQLSTATE), `started_at`, `finished_at`; indeks `(tenant_id, category, started_at DESC)`.
Czyszczony po 25 mies. w `data_retention_run`.

### 2.3 `public.data_retention_state` (l. 121–128) – pieczęcie
`(tenant_id, scope)` PK, `scope CHECK IN ('funnel','journey_stats')` (nienazwany →
`data_retention_state_scope_check`), `sealed_through date` (agregat policzony do dnia włącznie),
`purged_before date` (poniżej tego dnia surowe wiersze mogły zniknąć).

### 2.4 `public.data_retention_crm_extensions` (l. 134–147) – WZÓR tabeli wyjątków/przedłużeń
`(tenant_id, lead_id)` PK, `extended_until timestamptz NOT NULL`,
`reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500)`,
`created_by uuid FK auth.users ON DELETE SET NULL`, FK złożony
`(tenant_id, lead_id) → crm_leads(tenant_id, id) ON DELETE CASCADE` (wymaga `crm_leads_tenant_id_key UNIQUE (tenant_id, id)`).
Utworzona pod `SET lock_timeout = '5s'` (FK bierze SHARE ROW EXCLUSIVE na gorącej tabeli).
Uwaga: `newsletter_subscribers` NIE ma `UNIQUE (tenant_id, id)` (są tylko
`newsletter_subscribers_tenant_email_ci_uniq`, `…_confirmation_token_key`, `…_unsub_token_uidx`);
`event_people_tenant_id_key UNIQUE (tenant_id, id)` istnieje.

### 2.5 Agregaty anonimowe (l. 151–185)
- `funnel_paywall_daily (tenant_id, day)` PK: `active_accounts`, `paywall_hit_accounts`,
  `paywall_hit_visitors integer`, `paywall_hits bigint` (CHECK >= 0), `converted jsonb {segment: n}`,
  `reasons jsonb [{reason, accounts, visitors, hits}]`, `computed_at`.
- `metering_events_daily (tenant_id, day, outcome)` PK: `events integer NOT NULL CHECK >= 0`;
  `outcome text` bez CHECK.
- `newsletter_campaign_engagement_archive (campaign_id PK FK campaigns CASCADE)`: `tenant_id`,
  `opens`, `clicks`, `unique_openers`, `unique_clickers bigint`, `archived_before`, `updated_at`.

### 2.6 Kolumny modułów (l. 190–193, pod `lock_timeout`)
`crm_leads.anonymized_at timestamptz`, `retention_feedback.user_id DROP NOT NULL`,
`journey_settings.open_tracking_enabled boolean NOT NULL DEFAULT true`.

### 2.7 RLS/ACL (l. 205–216)
Wszystkie 7 tabel: `ENABLE ROW LEVEL SECURITY`, `REVOKE ALL … FROM PUBLIC, anon, authenticated`,
`GRANT SELECT, INSERT, UPDATE, DELETE … TO service_role` (bez polityk – dostęp tylko przez
SECURITY DEFINER). Komentarz: domyślne uprawnienia Supabase dają nowej tabeli komplet dla anon/
authenticated – REVOKE konieczny. Nowe tabele kategorii: ten sam blok.

### 2.8 Seed bezpiecznego startu (l. 593–597)
```sql
INSERT INTO public.data_retention_settings (tenant_id, category, period_months, enabled, enforce_after)
SELECT t.id, c.item ->> 'key', (c.item ->> 'default')::smallint, true, now() + interval '14 days'
  FROM public.tenants t
 CROSS JOIN jsonb_array_elements(public._data_retention_catalog() -> 'categories') AS c(item)
ON CONFLICT (tenant_id, category) DO NOTHING;
```
Ten sam INSERT w nowej migracji (po redefinicji katalogu) doda wiersze TYLKO nowym kategoriom.

---

## 3. Funkcje SQL – sygnatury, najnowsza definicja (do `-- CIALO-Z`), rodzaj/grant

Rodzaj wg `FUNCTION_TABLE` (`hubDelivery.ts` l. 278–312, wszystkie właściciel `I9`).
`internal` = `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` (bez GRANT);
`service` = REVOKE PUBLIC/anon/authenticated + `GRANT EXECUTE … TO service_role`;
`panel` = `REVOKE ALL … FROM PUBLIC, anon` + `GRANT EXECUTE … TO authenticated, service_role`.

| Funkcja (sygnatura) | Najnowsza def. | Rodzaj | Uwagi |
| --- | --- | --- | --- |
| `_data_retention_catalog() RETURNS jsonb` IMMUTABLE | 20261020161000 (l. 224) | internal | `{categories:[{key,default,min,max,editable}], rules:{audit_network_months 12, consent_proof_years 6, claims_limitation_years 6, grace_days 14, postpone_max_days 90, crm_extension_months 12, crm_notice_days 30, crm_extension_reason_min 3, crm_extension_reason_max 500, batch_default 5000, batch_max 50000}}`; kolejność = kolejność wierszy karty |
| `_data_retention_effective(p_tenant uuid) RETURNS TABLE(category, editable, period_months int, enabled, enforce_after, enforced, cutoff, updated_at, updated_by, stored)` STABLE DEFINER | 161000 (l. 255) | internal | brak wiersza = okres domyślny, włączona, `enforce_after = tenants.created_at + 14 dni`; `cutoff = now() - period` tylko dla editable |
| `_data_retention_funnel_cut(p_tenant uuid) RETURNS date` | 161000 (l. 304) | internal | `LEAST(sealed_through+1, GREATEST(purged_before, cutoff('paywall_metering')))`, NULL = brak pieczęci |
| `_data_retention_journey_sealed(p_tenant uuid) RETURNS date` | 161000 (l. 322) | internal | |
| `_data_retention_seal_funnel(p_tenant uuid, p_until date, p_max_days int DEFAULT 31) RETURNS jsonb` | 161000 (l. 345) | internal | advisory xact lock `data_retention_seal_funnel:<tenant>`; `{sealed_through, days, complete}` |
| `_journey_rollup_days(p_tenant uuid, p_from date, p_until date) RETURNS int` | 161000 (l. 446) | internal | pomija dni zapieczętowane |
| `journey_rollup_daily() RETURNS int` | 161000 (l. 531, CIALO-Z 20261020140500) | service (S5, `HUB_I9_REDEFINITIONS`) | |
| `_data_retention_seal_journeys(p_tenant uuid, p_until date, p_max_days int DEFAULT 62) RETURNS jsonb` | 161000 (l. 547) | internal | |
| `_data_retention_audit_is_financial(text, text) RETURNS boolean` IMMUTABLE | 161100 (l. 58) | internal | lustro `AUDIT_FINANCIAL_*` |
| `_data_retention_customer_until(p_last_tx timestamptz) RETURNS date` IMMUTABLE STRICT | 161100 (l. 73) | internal | `GREATEST(accounting_retention_until(tx), 31.12 roku tx + 6)` – reużyj dla `event_people` z płatnym zamówieniem |
| `_data_retention_bounded(p_count bigint, p_limit int) RETURNS int` | 161100 (l. 86) | internal | licznik podglądu do limitu |
| `_data_retention_paywall_metering(p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit int) RETURNS jsonb` | 161100 (l. 97) | internal | WZÓR „pieczęć → usuń do dnia zapieczętowanego → `purged_before`” |
| `_data_retention_fold_campaign_events(uuid, timestamptz, boolean, int) RETURNS int` | 161100 (l. 152) | internal | archiwum kampanii przed usunięciem |
| `_data_retention_email_engagement(uuid, timestamptz, boolean, int) RETURNS jsonb` | 161100 (l. 211) | internal | |
| `_data_retention_email_send_log(uuid, timestamptz, boolean, int) RETURNS jsonb` | 161100 (l. 251) | internal | WZÓR redakcji (`[redacted]`) |
| `_data_retention_crm_candidates(p_tenant uuid, p_cutoff timestamptz, p_limit int) RETURNS TABLE(lead_id, last_activity, last_tx)` STABLE | 161100 (l. 336) | internal | WZÓR „jedna funkcja kandydatów dla zadania i panelu” |
| `_data_retention_anonymize_lead(p_tenant uuid, p_lead uuid) RETURNS boolean` | 161100 (l. 403) | internal | WZÓR anonimizacji (wpis wygaśnięcia zgód, wyciszenie szyny `skipped:data_retention`) |
| `_data_retention_crm(uuid, timestamptz, boolean, int, p_customers boolean) RETURNS jsonb` | 161100 (l. 468) | internal | skan `p_limit*4` |
| `_data_retention_audit_log(uuid, timestamptz, boolean, int) RETURNS jsonb` | 161100 (l. 508) | internal | |
| `_data_retention_journey_enrollments(uuid, timestamptz, boolean, int) RETURNS jsonb` | 161100 (l. 571) | internal | |
| `_data_retention_cancellation_surveys(uuid, timestamptz, boolean, int) RETURNS jsonb` | 161100 (l. 606) | internal | WZÓR najprostszej anonimizacji |
| `_data_retention_consent_log(p_tenant uuid, p_execute boolean, p_limit int) RETURNS jsonb` | 161100 (l. 640) | internal | bez `p_cutoff` (reguła stała 6 lat); `{affected, marked, backlog, cutoff}` |
| `_data_retention_run_tenant(p_tenant uuid, p_trigger text, p_limit int DEFAULT 5000) RETURNS jsonb` | 161100 (l. 706) | internal | dyspozytor CASE (l. 742–752) |
| `data_retention_run(p_limit int DEFAULT 5000) RETURNS jsonb` | 161100 (l. 778) | service | zadanie dzienne |
| `_funnel_counts(uuid, timestamptz, timestamptz, text DEFAULT 'all') RETURNS jsonb` | 161200 (l. 44) | internal, **właściciel S3**, `HUB_I9_REDEFINITIONS` = 20261020120400 | |
| `monetization_dashboard(_from timestamptz, _to timestamptz, _plan_id uuid, _organization_id uuid) RETURNS jsonb` | 161200 (l. 350) | panel (I9, `HUB_CIALO_Z` = 20260724100000) | `metered_views` liczone z surowych (CTE `mv` l. 363–368) |
| `newsletter_campaign_engagement(p_campaign uuid)` | 161200 (l. 435) | panel (I9, `HUB_CIALO_Z` = 20260814215302) | |
| `admin_journey_stats(uuid, uuid, timestamptz, timestamptz)` | 161200 (l. 495) | panel, **właściciel S5**, `HUB_I9_REDEFINITIONS` = 20261020140500 | |
| `journey_record_message_event(text, text, int DEFAULT -1, text DEFAULT NULL, boolean DEFAULT false)` | 161300 (l. 40) | service, S5 (`HUB_I9_REDEFINITIONS` 20261020140500) | |
| `journey_contact_for_send(uuid, text)` | 161300 (l. 106) | service, S5 (20261020140200) | |
| `admin_journey_settings_get()` / `admin_journey_settings_save(jsonb, timestamptz)` | 161300 (l. 221 / 257) | panel, S5 (20261020140300) | |
| `_data_retention_admin_tenant() RETURNS uuid` | 161400 (l. 41) | internal | admin/super_admin z sesji, inaczej `42501 forbidden` |
| `_data_retention_emit(p_tenant uuid, p_op text, p_category text DEFAULT NULL) RETURNS void` | 161400 (l. 63) | internal | `emit_domain_event(tenant,'data_retention',tenant::text,'data_retention.changed.v1', {op, category}, auth.uid(), false)`; błąd szyny → `_log_emit_error`, nie wycofuje zapisu |
| `admin_data_retention_get() RETURNS jsonb` | 161400 (l. 85) | panel | |
| `admin_data_retention_save(p_category text, p_period_months int, p_enabled boolean, p_expected_updated_at timestamptz DEFAULT NULL)` | 161400 (l. 142) | panel | |
| `admin_data_retention_enforcement(p_action text, p_until date DEFAULT NULL)` | 161400 (l. 204) | panel | |
| `admin_data_retention_preview() RETURNS jsonb` | 161400 (l. 251) | panel | |
| `admin_data_retention_crm_due(p_limit int DEFAULT 50)` | 161400 (l. 328) | panel | |
| `admin_data_retention_crm_extend(p_lead_id uuid, p_reason text)` | 161400 (l. 368) | panel | |
| `admin_data_retention_run_now(p_confirm boolean)` | 161400 (l. 412) | panel | |
| `_hub_account_erase_modules(p_user_id uuid, p_surrogate uuid)` / `_hub_account_erase` | 20261020160900 (l. 131 / 536) | internal (I9) | punkt rozszerzenia RODO po usunięciu konta (zgłoszenia do klubów, §8.1 pkt 1a) |
| `accounting_retention_until(p_at timestamptz) RETURNS date` IMMUTABLE STRICT | 20261012121000 (l. 65) | (sprzed huba) | 31.12 roku (Europe/Warsaw) + 6 |

---

## 4. Kontrakt funkcji kategorii (jak pisać nową)

Sygnatura (zgodna z dyspozytorem):
`public._data_retention_<kategoria>(p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit integer) RETURNS jsonb`,
`LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`, rodzaj `internal`.

Zasady (wspólne dla 9 istniejących funkcji):
1. Wynik: `jsonb_build_object('affected', n, 'backlog', bool, 'cutoff', ts)` (opcjonalnie inne
   klucze, np. `marked` w `consent_log`). `_data_retention_run_tenant` zapisuje
   `affected`/`backlog`/`cutoff` do `data_retention_runs`.
2. `p_execute = false` (PODGLĄD) – tylko liczy: `SELECT public._data_retention_bounded(count(*), p_limit) FROM (SELECT 1 … LIMIT p_limit) x`.
   Żadnej zmiany danych osobowych (ani wysyłki maila!). Pieczęcie agregatów biegną w OBU trybach
   (agregat nie jest daną osobową).
3. `p_execute = true` – wsadowo, idempotentnie:
   ```sql
   WITH doomed AS (SELECT x.id FROM public.<t> x WHERE x.tenant_id = p_tenant AND <starsze niż próg>
                    AND <jeszcze nie zredagowane>
                    ORDER BY <data> LIMIT p_limit FOR UPDATE SKIP LOCKED)
   UPDATE/DELETE … USING doomed d WHERE x.id = d.id;
   GET DIAGNOSTICS v_n = ROW_COUNT;
   ```
   Predykat „jeszcze nie zredagowane” daje powtórkę = 0 (asercja idempotencji, pgTAP l. 327–331).
4. `backlog = v_n >= p_limit` (+ `NOT complete` pieczęci).
5. Jeśli surowe wiersze zasilają wskaźnik: NAJPIERW pieczęć do `v_day := (p_cutoff AT TIME ZONE 'UTC')::date`,
   potem `v_cut := LEAST(v_day, (v_seal ->> 'sealed_through')::date + 1)`, usuwaj tylko `< v_cut`,
   na końcu `UPDATE data_retention_state SET purged_before = GREATEST(COALESCE(purged_before, v_cut), v_cut)`.
   Wzór: `_data_retention_paywall_metering` (161100 l. 97–140):
   ```sql
   v_seal := public._data_retention_seal_funnel(p_tenant, v_day);
   v_cut := LEAST(v_day, (v_seal ->> 'sealed_through')::date + 1);
   ```
6. Wartości zastępcze: `'[redacted]'` (`DATA_RETENTION_REDACTED`), adres w kolumnie unikalnej
   `'[redacted]:' || id`, e-mail zastępczy `'anon-'||replace(gen_random_uuid()::text,'-','')||'@anonymized.invalid'`
   (`DATA_RETENTION_ANON_EMAIL_DOMAIN`). Kolumny NOT NULL – wartości neutralne.
7. Zmiana wiersza, który emituje zdarzenia szyny (wyzwalacz `*_emit`), → wycisz jak w
   `_data_retention_anonymize_lead` (161100 l. 450–462): `journey_event_inbox … error = 'skipped:data_retention'`,
   `integration_deliveries … status = 'dead'` dla zdarzeń z `created_at = now()`.
8. Tylko kody błędów: błąd w funkcji łapie `BEGIN … EXCEPTION WHEN OTHERS` dyspozytora i zapisuje
   `error_code = SQLSTATE` (161100 l. 758–764).

### 4.1 Dyspozytor `_data_retention_run_tenant` (161100 l. 706–773)
- `pg_try_advisory_xact_lock(hashtextextended('data_retention_run:' || p_tenant, 0))` → `{busy:true}`.
- `FOR v_set IN SELECT * FROM _data_retention_effective(p_tenant)`; `CONTINUE WHEN NOT v_set.enabled`;
  `v_cutoff := CASE category WHEN 'crm_customers' THEN v_crm_cut WHEN 'consent_log' THEN NULL ELSE v_set.cutoff END`.
- `v_res := CASE v_set.category WHEN 'paywall_metering' THEN … END` (l. 742–752) – **bez ELSE**; wiersz przebiegu l. 753–757, blok `EXCEPTION WHEN OTHERS` l. 758–764.
  Tryb = `v_set.enforced` (podgląd do `enforce_after`).
- Wynik: `{<kategoria>: {…, mode}}`.

### 4.2 Zadanie dzienne `data_retention_run` (161100 l. 778–832)
Najemcy bez przebiegu `schedule` w 20 h albo z `backlog` w 2 h; budżet `clock_timestamp() - start > 8 s`
→ `more: true`; dodatkowo: `email_send_log` bez najemcy (13 mies. stałe), czyszczenie
`data_retention_runs` > 25 mies. Zwraca `{tenants, more, orphan_send_log, runs_pruned, batch_limit}`.

### 4.3 Wywołanie z `jobs-tick` (`src/lib/server/jobsTick.server.ts`)
```ts
export function isDataRetentionWindow(now = new Date()): boolean {
  return now.getUTCHours() === 2 && now.getUTCMinutes() % 10 === 7;   // 02:07…02:57 UTC, 6 szans
}
// l. 451–468: krok OSTATNI, admin.rpc("data_retention_run", { p_limit: DATA_RETENTION_RULES.batchDefault })
// błąd PGRST202/42883 → { tenants: 0, more: false, skipped: "migration_pending" } (isMigrationPending)
```
Testy: `jobsTickRun.test.ts` describe „retencja danych: okno nocne 02:07-02:57 UTC co 10 minut” (l. 1326),
`-jobs-tick.test.ts:285` (`dataRetention: { error: "skipped_duty_cycle" }`).
**SQL nie podpisze tokenu HMAC** (sekret `SESSION_SECRET`/`SUPABASE_SERVICE_ROLE_KEY` w env,
`src/lib/newsletter/trackingToken.server.ts:27–28`) ani nie wyrenderuje maila PL/EN – kategoria
z wysyłką (wygaszanie newslettera) wymaga osobnego kroku TS w `jobs-tick` (SQL: kandydaci/
znacznik „mail wysłany”, TS: render + token + `enqueue_email`/`enqueueRawEmail`
z `src/lib/email/transactional.server.ts:473`). `enqueue_email(text, jsonb)` – tylko service_role
(`20261007140000`).

---

## 5. Karencja i podgląd (14 dni)

- `enforce_after` per (najemca, kategoria). Istniejący najemcy: seed `now() + 14 days` (§2.8);
  nowy najemca bez wierszy: `tenants.created_at + 14 days` (`_data_retention_effective`).
- `enforced = now() >= enforce_after` → tryb `execute`, inaczej `preview`.
- `admin_data_retention_enforcement('enable_now' | 'postpone', p_until)` (161400 l. 204–245):
  upsert `enforce_after` dla **wszystkich** kategorii z `_data_retention_effective` naraz;
  `postpone`: `p_until` w (dziś Warsaw, dziś + 90] → `p_until::timestamp AT TIME ZONE 'Europe/Warsaw'`,
  inaczej `22023 postpone_out_of_range`; `audit_log` `data_retention.enforcement_changed`; emit `op='enforcement'`.
- `admin_data_retention_get().grace` = `min(enforce_after)`, `max(enforce_after)`, `bool_and(enforced)`,
  `bool_or(NOT enforced)` po kategoriach włączonych (l. 118–121).
- Podgląd liczb: `admin_data_retention_preview()` (l. 251–322): `c_cap = 100000`, CASE per kategoria
  (**bez ELSE** – brak gałęzi = `count: null` = w UI „kategoria wyłączona”), `cutoff` per kategoria
  (`crm_customers` → próg CRM, `consent_log` → now()-6 lat). Kształt `{cap, categories:[{key, enabled, mode, cutoff, count, capped}]}`.

---

## 6. RPC panelu, audyt, zdarzenie (161400)

| RPC | Wejście → błędy | `audit_log.action` / `entity_type` | `_data_retention_emit` op |
| --- | --- | --- | --- |
| `admin_data_retention_get()` | – | – | – |
| `admin_data_retention_save(cat, months, enabled, expected_updated_at)` | `22023 category_invalid` / `category_read_only` / `period_out_of_range`; CAS `40001 conflict` (wiersz istnieje i token ≠ `updated_at`, albo brak wiersza i token ≠ NULL) | `data_retention.settings_changed` / `data_retention_settings`, `metadata {category, from:{period_months,enabled}, to:{…}}` | `settings`, kategoria |
| `admin_data_retention_enforcement(action, until)` | `postpone_out_of_range`, `action_invalid` | `data_retention.enforcement_changed` | `enforcement` |
| `admin_data_retention_crm_due(p_limit 1..200)` | – | – | – |
| `admin_data_retention_crm_extend(lead, reason)` | `22023 reason_length` (po `btrim`, 3–500), `P0002 lead_not_found` | `data_retention.crm_extended` / `crm_lead`, `entity_id = lead`, `metadata {extended_until, reason}` | `extension`, `crm_inactive_contacts` |
| `admin_data_retention_run_now(confirm)` | `22023 confirmation_required` | `data_retention.run_manual`, `metadata {result:{kat:{mode,affected,error}}, busy}` | `run` |

`audit_log.entity_id` jest `uuid` (nie tekst) – identyfikator wiersza, nigdy adres. Zapis wyłącznie
z najemcy sesji (`_data_retention_admin_tenant`); najemca nigdy z argumentu.

### 6.1 Lista „do anonimizacji” – wzór dla listy „do wygaszenia”
- SQL `admin_data_retention_crm_due` (l. 328–364): kandydaci ze wspólnej
  `_data_retention_crm_candidates(v_tenant, v_set.cutoff + make_interval(days => c_notice), v_limit*4)`
  (próg przesunięty o 30 dni wyprzedzenia), `due_at` = późniejsza z (ostatnia aktywność + okres,
  termin ustawowy klienta), filtr `due_at < now() + 30 dni`, wynik
  `{items:[{lead_id,email,first_name,last_name,company,last_activity,due_at,customer}], notice_days, enabled, enforced}`.
- Przedłużenie: tabela `data_retention_crm_extensions` + `admin_data_retention_crm_extend` (+12 mies.
  od późniejszej z now()/bieżącego terminu, upsert, audyt, emit).
- Kandydaci wykluczają przedłużonych: `NOT EXISTS (… x.extended_until > now())` (161100 l. 351–352).
- TS: `getDataRetentionCrmDue` (`DATA_RETENTION_CRM_DUE_LIMIT = 50`), `parseDataRetentionCrmDue`,
  `dataRetentionCrmDueQueryOptions`, `useExtendDataRetentionContact`, `ExtendContactSchema`
  (zod `.strict()`, `normalizeExtensionReason` – punkty kodowe jak `char_length`),
  UI `CrmDueList.tsx` (tabela + `Dialog` z `Textarea`, licznik `reasonCount`, `aria-invalid`,
  `extendAria` z nazwą kontaktu). Klucze i18n `adminDataRetention.crm.*` (PL l. 229–256).

---

## 7. Agregaty historyczne – budowa przed usunięciem i odczyt

| Agregat | Budowa | Odczyt okien sprzed progu |
| --- | --- | --- |
| `funnel_paywall_daily` | `_data_retention_seal_funnel` (161000 l. 345–432): dla każdego dnia d od pierwszego dnia danych (`min(paywall_hits.day)`, `min(metering_event_log.occurred_at)`) do `p_until-1`, maks. 31 dni/przebieg: `_funnel_counts(tenant, d, d+1, 'all')` + konwersje per segment (`b2c_individual`, `b2c_reduced`, `b2b_institution`), upsert; potem `data_retention_state(scope 'funnel').sealed_through = GREATEST(…)` | `_funnel_counts` (161200 l. 92–118, 280–294): dni `< _data_retention_funnel_cut` z agregatu, reszta surowa; konto liczone raz NA DZIEŃ (znana granica §21.21 pkt 4) |
| `metering_events_daily` | w tej samej pętli: `INSERT … SELECT p_tenant, v_day, ml.outcome, count(*) FROM metering_event_log … GROUP BY outcome ON CONFLICT DO UPDATE` | `monetization_dashboard` (161200 l. 358, 369–379): `ev_rows` = surowe od `GREATEST(_from, v_cut)` ∪ dzienne `day < v_cut` |
| `journey_node_daily_stats` | `_data_retention_seal_journeys` → `_journey_rollup_days` (dni zapieczętowane nietykalne) | `admin_journey_stats`: okno sięgające dnia ≤ `_data_retention_journey_sealed` → `source: 'rollup'` |
| `newsletter_campaign_engagement_archive` | `_data_retention_fold_campaign_events` (161100 l. 152–206): per kampania, zdarzenia `< p_cutoff` FOR UPDATE → sumy + zasięg unikalny (subskrybenci bez zdarzenia tego rodzaju po progu) → upsert przyrostowy → DELETE | `newsletter_campaign_engagement` = surowe + archiwum (Z-I9c-10: podwójne liczenie powrotów) |

**Luki agregatów dla nowych kategorii (metered_views):**
- `monetization_dashboard` CTE `mv` (161200 l. 363–368) liczy `total/members/anonymous` WPROST
  z `metered_views` w `[_from, _to]` – brak agregatu. Usunięcie po 3 mies. wyzeruje te liczby dla
  starszych okien → potrzebny agregat dzienny (np. kolumny `views_members`/`views_anonymous`
  w nowej tabeli albo rozszerzenie pieczęci) **i backfill dni już zapieczętowanych** (pieczęć X2
  ich nie liczyła; bez backfillu stare dni mają 0).
- `_funnel_counts` (161200 l. 133–136) liczy konta aktywne także z `metered_views.user_id` w części
  surowej. Granica lejka wynika z okresu `paywall_metering` (3–25, dom. 13). Usunięcie
  `metered_views` po 3 mies. bez przesunięcia granicy zaniży „konta aktywne” okien 3–13 mies.
  Rozwiązanie bez redefinicji `_funnel_counts`: kategoria `metered_views` pieczętuje lejek do
  własnego progu (`_data_retention_seal_funnel(p_tenant, v_day)`) i podnosi
  `data_retention_state('funnel').purged_before` – `_data_retention_funnel_cut` (I9, internal) bierze
  `GREATEST(purged_before, cutoff)` i odczyt przełączy się na agregat. Skutek: okna 3–13 mies.
  liczone z agregatu (konto raz na dzień) – opisać w dzienniku.
- Pozostali czytelnicy `metered_views` czytają tylko bieżący okres (`period_month = bieżący`):
  `_metered_view_consume`/`_metering_state` (20261020120200), `metering_impact_preview`
  (20260725090100), `get_user_monthly_metering_count` (20260724100000), `src/lib/crm.functions.ts:340–358`.
  Okres min. 2 mies. gwarantuje, że bieżący `period_month` nie jest usuwany.
  `metered_views_scrub_ip()` (20261013090400 l. 630, pg_cron `metered-views-scrub-ip` 03:47)
  już zeruje `ip_subject` poprzednich okresów – nie dublować. Wyzwalacz
  `metered_views_log_consume AFTER INSERT` loguje `consumed` do `metering_event_log`.

---

## 8. Przełącznik `open_tracking_enabled`

- Przechowywany: `public.journey_settings.open_tracking_enabled boolean NOT NULL DEFAULT true`
  (161000 l. 192–193; brak wiersza = włączony). Token współbieżności = `journey_settings.updated_at`.
- Czytają (SQL): `journey_record_message_event` (161300 l. 67–73: `open` przy `IS FALSE` →
  `{recorded:false, reason:'open_tracking_disabled'}`, kliknięcia/wypis bez zmian; próg maszynowy
  `machine_open_seconds` (domyślnie 2 s): `v_machine := p_machine OR (open AND now()-queued_at < threshold)`),
  `journey_contact_for_send` (l. 138, 201: pole `open_tracking`), `admin_journey_settings_get/save`
  (l. 246, 270, 289–290 `22023 open_tracking_enabled_invalid`, 341), `admin_data_retention_get`
  (161400: `open_tracking_enabled`, `journey_settings_updated_at`).
- Czytają (TS): `src/lib/server/journeysRunner.server.ts:386` (`openTracking: c.open_tracking !== false`),
  `src/lib/journeys/render.server.ts:50`, `src/lib/journeys/parse.ts:263`, `journeys.functions.ts:486`
  (zod `z.boolean()`), `src/lib/privacy/dataRetentionParse.ts:245`, `dataRetentionQueries.ts:123–140`
  (`useSaveOpenTracking` → `saveJourneySettings({patch:{open_tracking_enabled}, expectedUpdatedAt})`,
  inwalidacja `dataRetentionKeys.tenant` + `journeyKeys.settings`), karta l. 195–203, 325–345.
- **Kampanie newslettera go NIE czytają** (Z-I9c-09; własny tryb źródła zaangażowania,
  `i18n-newsletter-deliverability`). `newsletter_campaign_events` NIE ma kolumny `machine`
  (kolumny: `campaign_id, created_at, id, kind, subscriber_id, tenant_id, url`) – „otwarcie ludzkie”
  kampanii trzeba liczyć progiem czasu względem wysyłki; `journey_message_events.machine` istnieje.

---

## 9. Warstwa TS – co trzeba rozszerzyć przy nowej kategorii

`src/lib/privacy/dataRetention.ts`:
```ts
export const DATA_RETENTION_EDITABLE_CATEGORIES = ["paywall_metering", …, "cancellation_surveys"] as const; // l. 20
export const DATA_RETENTION_STATUTORY_CATEGORIES = ["crm_customers", "consent_log"] as const;              // l. 35
export const DATA_RETENTION_RUN_CATEGORIES = [...EDITABLE, ...STATUTORY] as const;                           // l. 39
export const DATA_RETENTION_PERIODS: Readonly<Record<DataRetentionEditableCategory, DataRetentionPeriodRule>> // l. 58
export const DATA_RETENTION_RULES = { auditNetworkMonths: 12, …, batchMax: 50000 } as const;                 // l. 88
export const DATA_RETENTION_EXISTING: readonly DataRetentionExistingItem[]                                   // l. 196 (okresy z innych modułów, parytet literału)
// + isEditableCategory, isRetentionPeriodAllowed, retentionPeriodOptions, normalizeExtensionReason
```
- Nowa kategoria edytowalna: dopisz do `DATA_RETENTION_EDITABLE_CATEGORIES` i `DATA_RETENTION_PERIODS`
  (`Record` wymusi wpis); nowe reguły stałe (np. 30 dni na reakcję, wyprzedzenie listy) – do
  `DATA_RETENTION_RULES` i do `rules` katalogu SQL (parytet porównuje cały literał reguł).
- Parser `category()` (`dataRetentionParse.ts:177–186`) **rzuca** na nieznany klucz w
  `admin_data_retention_get`/`preview` → karta pada („readError”). `parseDataRetentionRunResult`
  iteruje stałą TS (nieznane klucze pomija).
- `SaveCategorySchema` (`dataRetention.functions.ts:121–132`) – `z.enum(DATA_RETENTION_EDITABLE_CATEGORIES)` + `refine(isRetentionPeriodAllowed)` – działa automatycznie.
- Nowe RPC: literał w `context.supabase.rpc("…")` (bramka `generate:ts-sql-contract` wymaga grantu
  `authenticated`), `readState`/`mutation` + `mapDataRetentionError` (42501 forbidden, 40001 conflict,
  P0002 not_found, 22023/22P02/23514 invalid, 42883/PGRST202 unavailable).
- Klucze: nowe pod prefiksem najemcy, np. `newsletterDue: (t) => ["admin","data-retention",t,"newsletter-due"]`
  (test „klucze karty: wszystko pod prefiksem najemcy”, parity l. 174–184 – dopisać).
- i18n (`adminDataRetention.categories.<key>`): edytowalna i ustawowa – `name`, `what`, `after`, `basis`,
  `standard` (dymek `hintBody` używa trzech ostatnich dla KAŻDEJ kategorii, `RetentionCategoryRow.tsx:51–55`),
  ustawowa dodatkowo `rule` (l. 113). Prefiks `adminDataRetention` jest pod twardą bramką
  `src/__tests__/i18nParity.gate.test.ts:49` (PL=EN) i `i18nKeyDrift.gate.test.ts`; raport
  `reports/i18n-parity.json`. Uwaga z nagłówka słownika: angielskie słowo równe klasie Tailwinda
  dokłada regułę do PUBLICZNEGO CSS (`publicCss` 83,8/85 KB).
- Karta: `state.categories.map(RetentionCategoryRow)` – nowa kategoria pojawia się sama (kolejność =
  katalog SQL). Listy „do wygaszenia” itp. – nowa molekuła obok `CrmDueList` w `RetentionBody`
  (`DataRetentionCard.tsx:347`).

---

## 10. Testy – istniejące wzorce i miejsca do aktualizacji

### 10.1 `src/lib/privacy/__tests__/dataRetentionParity.test.ts`
Stałe ścieżek **na sztywno**: `CORE = …161000`, `EXECUTOR = …161100`, `PANEL = …161400` (l. 31–33).
Porównanie po `stripSqlComments` (`@/lib/ci/ownership`) i kanonizacji białych znaków (`kanon`, l. 35–39):
- l. 49–65: `WHEN '<cat>' THEN period_months IS NOT NULL AND period_months BETWEEN min AND max` dla
  każdej edytowalnej, `… IS NULL AND enabled` dla ustawowej, `CHECK (category IN (<RUN w kolejności TS>))`;
- l. 67–98: `jsonb_build_object('key', '<cat>', 'default', d, 'min', a, 'max', b, 'editable', true)`,
  pełny literał reguł, `t.created_at + make_interval(days => 14)`, `now() + interval '14 days'`, CHECK powodu;
- l. 100–116: stałe `c_network_months`, `c_years`, `+ 6` w `customer_until`, `c_postpone_max`, `c_notice`,
  `c_months`, `c_reason_min/max`;
- l. 126–139: `DATA_RETENTION_EXISTING` – literał okresu w migracji źródłowej.
**Po redefinicji CHECK/katalogu w nowej migracji test musi czytać NAJNOWSZĄ migrację definiującą dany
obiekt** (np. ostatni plik z `FUNCTION public._data_retention_catalog(` i ostatni z
`data_retention_settings_period_check`) – stary CORE nadal przejdzie, ale przestanie dowodzić stanu bazy.
Kolejność listy w CHECK = `[...EDITABLE, ...STATUTORY]` (nowe edytowalne przed ustawowymi).

### 10.2 `dataRetentionParse.test.ts` (17 testów)
Opisy: „kategoria edytowalna, ustawowa, karencja, agregaty i piksel”, „rozjazd kontraktu: nieznana
kategoria (`hologramy`), ujemny okres, zły tryb przebiegu”, „podgląd: liczba, sufit i kategoria
wyłączona (null)”, „lista do anonimizacji…”, „wynik przebiegu…”, „kody błędów RPC -> kod panelu”,
„walidator serwera (te same zakresy co CHECK bazy)”. Wzór dla parserów nowych list.

### 10.3 `DataRetentionCard.test.tsx` (11, RTL + axe)
`vi.mock("@/lib/privacy/dataRetention.functions", () => ({ getDataRetention, getDataRetentionPreview,
getDataRetentionCrmDue, saveDataRetentionCategory, setDataRetentionEnforcement, extendDataRetentionContact,
runDataRetentionNow }))` (l. 46–54) – **fabryka jawna: każda nowa funkcja serwerowa musi tu trafić**,
inaczej import `undefined`. Słownik prawdziwy (`realT` z `@/test/i18nReal`), stuby Radix
(`radixSelectStub`, `radixSwitchStub` z `@/test/reactStubs`), `axeViolations` z `@/test/axe`.
Fikstura `state()` l. 72–122 (2 kategorie). Opisy: „edytowalna: okres w zakresie katalogu, dymek z podstawą;
ustawowa: tylko do odczytu”, „zmiana okresu: wspólny mutator z tokenem CAS”, „wyłączenie wymaga
potwierdzenia…”, „konflikt zapisu (40001)…”, „przedłużenie kontaktu: powód poniżej 3 znaków blokuje zapis…”,
„baza bez migracji: stan „niewdrożone””, „brak naruszeń axe…”.

### 10.4 pgTAP
- `hub_i9c_data_retention_test.sql`: `plan(52)` (l. 21); fikstura: najemca A „po karencji” (created_at
  now()-30 dni, BEZ wierszy ustawień → `enforce_after = created_at+14`), B „w karencji” (now());
  helpery `pg_temp.ts(interval)`, `pg_temp.as_user(uid)` (`set_config('request.jwt.claims', …)`),
  tabela wyników `r(k, v jsonb)`; sekcje: 1. schemat/CHECK/ACL, 2. RPC panelu, 3. podgląd (B),
  4. wykonanie (A), 5. idempotencja. **Do zmiany przy nowej kategorii:**
  l. 198 `is(jsonb_array_length(v -> 'categories'), 9, 'panel: dziewięć kategorii katalogu')`,
  l. 323 `count(*) = 9 FROM data_retention_runs … error_code IS NULL` („wiersz na kategorię, bez błędów”),
  l. 327–331 idempotencja (suma `affected + marked` = 0 – nowa kategoria też musi dać 0 przy powtórce).
- `hub_i9c_data_retention_aggregates_test.sql`: `plan(23)`; wzór „odczyt PRZED → `_data_retention_run_tenant(…,'schedule',1000)` → odczyt PO = to samo” (sekcje 2–4, l. 194–270); fikstura: każde konto ma uderzenia w JEDNYM dniu. `monetization_dashboard` sprawdzany tylko `-> 'metering_events'` (l. 203, 255) – dla `metered_views` dodać `-> 'metered_views'`.
- `hub_shared_helpers_test.sql` l. 79–131 (`-- hub-grants:begin … -- hub-grants:end`): lista funkcji
  bez EXECUTE dla anon/authenticated = wszystkie `internal`/`service`/`trigger` z `FUNCTION_TABLE` poza
  `HUB_CIALO_Z`; zgodność przypina `hubDelivery.gate.test.ts` („strażnik pgTAP `hub_grants`…”, porównanie posortowane) – **każdą nową funkcję wewnętrzną/serwisową dopisać**.
- Uruchamianie: `PGTAP_DIR=… PGTAP_PORT=… bash scripts/pgtap-local/run.sh test <plik_bez_.sql>`.

---

## 11. Bramki i pliki współdzielone (I9)

- `hubDelivery.ts`:
  - `FUNCTION_TABLE` (l. 102…, blok retencji l. 273–312): każda nowa funkcja `["nazwa", "I9", rodzaj]`
    (prefiks `_` ⇒ `internal`, `admin_` ⇒ `panel`, `tg_` ⇒ `trigger` – test l. 199–207). Brak wpisu =
    `bez-wlasciciela`.
  - Granty sprawdzane per plik: brak REVOKE = `brak-revoke`; panel bez `GRANT … TO authenticated` =
    `brak-grantu`; internal/service z grantem dla authenticated = `grant-dla-klienta`.
  - Nagłówek migracji musi zawierać DEFEKT, ZMIANA, KOLEJNOŚĆ, IDEMPOTENTNA, DOWÓD (`HEADER_LABELS`);
    rozmiar ≤ 45 KiB (`HUB_MIGRATION_MAX_BYTES`, `scripts/split-migration.ts --dry-run`); funkcje
    z jawnym `public.`.
  - **CIALO-Z (`analyzeHubDelivery` l. 1420–1470):**
    - funkcje I9 powstałe w hubie (`_data_retention_*`, `admin_data_retention_*`, `data_retention_run`,
      `_hub_account_erase_modules`): bramka znacznika nie wymaga; konwencja repo (160900) – i tak
      `-- CIALO-Z: <wersja najnowszej definicji>` nad redefinicją (np. `_data_retention_run_tenant` → 20261020161100,
      `admin_data_retention_get` → 20261020161400, `_data_retention_catalog` → 20261020161000,
      `_hub_account_erase_modules` → 20261020160900);
    - funkcje I9 sprzed huba z `HUB_CIALO_Z` (`monetization_dashboard`, `newsletter_campaign_engagement`):
      bramka wymaga znacznika = WARTOŚĆ REJESTRU (`20260724100000` / `20260814215302`), mimo że
      najnowsze ciało jest w `20261020161200` – ciało przepisuj z 161200, a wersję 161200 opisz w komentarzu
      BEZ tokenu `CIALO-Z:` (liczy się ostatni znacznik przed definicją);
    - funkcje innych wycinków już raz redefiniowane w I9 (`_funnel_counts` S3, `admin_journey_stats`,
      `journey_record_message_event`, `journey_contact_for_send`, `admin_journey_settings_get/save`,
      `journey_rollup_daily` S5, `run_workflow_step`, `journey_validate_graph`, `revenue_segment_of_tier`):
      `HUB_I9_REDEFINITIONS` ma JEDNĄ wersję; druga redefinicja w I9 daje `zly-cialo-z` (rejestr ≠ najnowsza
      w hubie) i jednocześnie psuje pierwszą – **wymaga zmiany bramki**. Omijać (zmiany przez funkcje I9,
      np. `_data_retention_funnel_cut`, `data_retention_state`).
  - `CLUB_TOUCH` (`public.club_`/`public.admin_club_`) poza S4 → wymagany wiersz `-- pg-harness: exclude`
    (wzór nagłówka `20261020160900` l. 5–10); `careers-harness` wybiera pliki z `public.contact_messages`
    / `public.career_*` (znacznik `-- careers-harness: exclude`, l. 102–108 tamże); `events-harness` –
    `FUNCTION public.event_[a-z_]+\(` / `public.admin_event_` (funkcja `_data_retention_event_people` nie łapie).
  - Manifest I9 (l. 818–951): `supabase/migrations/2026102016????_*.sql`, `drizzle/migrations/*.sql`,
    `src/lib/privacy/**`, `src/components/admin/settings/dataRetention/**`, `src/lib/i18n-admin-data-retention.ts`,
    `supabase/tests/hub_i9b_*_test.sql`, `supabase/tests/hub_i9c_*_test.sql`, `docs/RODO_REJESTR_…`,
    `src/lib/email/{queueDrain.server,suppressionPolicy}.ts`, `src/lib/journeys/{render.server,dto,parse,journeys.functions}.ts`,
    `src/lib/server/journeysRunner.server.ts`. **Nowe pliki poza tymi globami (np. `supabase/tests/hub_i9d_*`,
    `src/lib/newsletter/**`, `src/lib/email/templates/**`) – dopisać do manifestu I9** (inaczej `hub-slice-guard`).
- `src/integrations/supabase/types.ts`: tabele (np. l. 5683–5840 `data_retention_*`), RPC (l. 27543–27561
  `admin_data_retention_*`, l. 32673 `data_retention_run`); `check:types-freshness`.
- `src/lib/authz/authzSnapshot.generated.ts` – `bun run generate:authz-snapshot` (+ `--check`).
- Zdarzenie: nowe `op` w ładunku `data_retention.changed.v1` nie wymagają zmian szyny (inwalidacja po
  prefiksie najemcy).
- Bundle: karta to leniwy chunk (+15,9 KB w X2); ratchet `overall` w `scripts/check-bundle-size.ts` z kroniką.

---

## 12. Checklista: dodanie kategorii `<k>` (edytowalnej)

1. TS `dataRetention.ts`: `<k>` w `DATA_RETENTION_EDITABLE_CATEGORIES` + `DATA_RETENTION_PERIODS[<k>]` (+ reguły).
2. Migracja „core” (nowa wersja I9): 
   ```sql
   ALTER TABLE public.data_retention_settings DROP CONSTRAINT IF EXISTS data_retention_settings_category_check;
   ALTER TABLE public.data_retention_settings ADD CONSTRAINT data_retention_settings_category_check CHECK (category IN (…));
   ALTER TABLE public.data_retention_settings DROP CONSTRAINT IF EXISTS data_retention_settings_period_check;
   ALTER TABLE public.data_retention_settings ADD CONSTRAINT data_retention_settings_period_check CHECK (CASE category … ELSE false END);
   ALTER TABLE public.data_retention_runs DROP CONSTRAINT IF EXISTS data_retention_runs_category_check;
   ALTER TABLE public.data_retention_runs ADD CONSTRAINT data_retention_runs_category_check CHECK (category IN (…));
   -- (opcjonalnie) data_retention_state_scope_check, jeśli nowa pieczęć
   -- CIALO-Z: 20261020161000
   CREATE OR REPLACE FUNCTION public._data_retention_catalog() …   -- + nowy jsonb_build_object, rules
   INSERT INTO public.data_retention_settings … now() + interval '14 days' … ON CONFLICT DO NOTHING;  -- seed karencji
   ```
   + nowe tabele (RLS, REVOKE, GRANT service_role), agregaty, backfill.
3. Migracja „executor”: `_data_retention_<k>(uuid, timestamptz, boolean, integer)` + redefinicja
   `_data_retention_run_tenant` (CIALO-Z 20261020161100) z nową gałęzią CASE (i ewentualnie wyjątkiem
   `v_cutoff`).
4. Migracja „panel”: redefinicja `admin_data_retention_preview` (CIALO-Z 20261020161400) z gałęzią
   licznika; nowe RPC listy/wyjątków (audyt + `_data_retention_emit`); ewentualnie poprawka `grace`
   w `admin_data_retention_get` (pkt 13.4).
5. `hubDelivery.ts` (`FUNCTION_TABLE`, manifest), `hub_shared_helpers_test.sql` (`hub-grants`),
   `types.ts`, authz snapshot, bliźniaki drizzle + `_journal.json`.
6. i18n PL/EN `categories.<k>.{name,what,after,basis,standard}` (+ nowe sekcje listy).
7. Testy: parity (najnowsza migracja), parse, karta (mock nowych funkcji), pgTAP (liczby 9 → N,
   `plan`, nowe asercje: podgląd nie zmienia, wykonanie tylko starsze niż okres, wyjątki, agregaty
   bez zmian, karencja, idempotencja).
8. Dziennik §21.x, rejestr czynności (sekcja „Retencja danych”, wpisy 2/5 + nowe), runbook.

---

## 13. Pułapki

1. **Bez seedu istniejący najemcy wchodzą od razu w WYKONANIE**: brak wiersza ⇒ `enforce_after =
   tenants.created_at + 14 dni` (przeszłość). Seed `now() + interval '14 days'` w tej samej migracji
   co katalog jest obowiązkowy (to jest „karencja 14 dni” dla nowej kategorii).
2. **CHECK `data_retention_runs_category_check` musi być rozszerzony razem z katalogiem.** INSERT
   wiersza przebiegu nieznanej kategorii rzuca 23514 w bloku głównym, a INSERT z bloku `EXCEPTION`
   (161100 l. 761–764) rzuca ponownie poza obsługą ⇒ pada cały `_data_retention_run_tenant`
   i `data_retention_run` (wszyscy najemcy).
3. CASE w `_data_retention_run_tenant` i `admin_data_retention_preview` nie mają ELSE: kategoria
   w katalogu bez gałęzi ⇒ `v_res = NULL` ⇒ wynik `{<k>: null}` (parser `parseDataRetentionRunResult`
   rzuci `oczekiwano obiektu`) i „kategoria wyłączona” w podglądzie.
4. `grace` w `admin_data_retention_get` = `min(enforce_after)` po wszystkich włączonych: po dodaniu
   kategorii z nowym terminem, gdy stare są już wykonywane, nagłówek pokaże „tryb podglądu do
   <data z przeszłości>”. Poprawka: `min(e.enforce_after) FILTER (WHERE NOT e.enforced)`.
   `enable_now`/`postpone` działa na WSZYSTKIE kategorie naraz (postpone cofnie stare do podglądu).
5. Parser TS rzuca na nieznaną kategorię ⇒ wdrożenie migracji przed frontem psuje kartę
   („Nie udało się wczytać…”). Front ze stałymi musi wejść razem z migracją albo przed nią.
6. Parity test czyta stare pliki na sztywno – bez zmiany pozostanie zielony, nie dowodząc nowego stanu.
7. Agregaty: pieczęć przed usunięciem; dni już zapieczętowane NIE są przeliczane (`ON CONFLICT` +
   `GREATEST(sealed_through)`), więc nowe kolumny/metryki agregatu wymagają backfillu przed pierwszym
   usunięciem (dopóki surowe istnieją).
8. **Okres zdarzeń maili (`email_engagement`, min. 3 mies.) może być krótszy niż okno zaangażowania
   wygaszania (6–24 mies.)** – po usunięciu zdarzeń subskrybent wygląda na nieaktywnego. Trzeba
   utrwalić „ostatnie zaangażowanie” per subskrybent (np. kolumna/tabela aktualizowana w
   `_data_retention_fold_campaign_events` przed DELETE i przy zapisie zdarzenia) albo wymusić
   zależność zakresów. Ta sama klasa ryzyka dotyczy dziś `_data_retention_crm_candidates`
   (aktywność z `journey_message_events`/`newsletter_campaign_events` przy `crm_inactive_contacts` 12–36
   vs `email_engagement` 3–25) – do weryfikacji, czy `crm_leads.last_activity_at` jest podbijane kliknięciem.
9. Interakcje kategorii: usunięcie subskrybenta odblokowuje anonimizację kontaktu CRM
   (`_data_retention_crm_candidates` l. 353–355 wyklucza subskrybentów `pending/subscribed/confirmed`)
   i powoduje wpis wygaśnięcia zgody (`_data_retention_consent_log` l. 660–672) – zgodnie z regułą
   „czas trwania zgody + 6 lat”; NIE dopisywać do listy wyłączeń. Anonimizacja `event_people` zmienia
   wejście aktywności CRM (`event_people.email_norm` w kandydatach l. 372–374 i `last_tx` l. 386–389).
10. Tryb podglądu nie może WYSŁAĆ maila (wysyłka to zmiana) – liczy tylko kandydatów.
11. `newsletter_subscribers` bez `UNIQUE (tenant_id, id)` – FK złożony jak w `data_retention_crm_extensions`
    wymagałby nowego ograniczenia na gorącej tabeli (`lock_timeout`); prościej FK po `id` + kolumna
    `tenant_id` sprawdzana w RPC.
12. `audit_log` też podlega retencji (24 mies.) i ma `entity_id uuid` – w metadanych tylko identyfikatory
    i powód, bez adresu e-mail (wyjątek CRM: `reason` to tekst admina).
13. `data_retention_run` ma budżet 8 s na wszystkich najemców; ciężka kategoria (pętle per wiersz jak
    `_data_retention_anonymize_lead`) powinna mieć własny, mniejszy limit lub `backlog`.
14. Zmiana CHECK na `data_retention_runs` skanuje tabelę pod ACCESS EXCLUSIVE (rośnie do 25 mies.
    przebiegów × kategorie × najemcy) – rozważ `NOT VALID` + `VALIDATE CONSTRAINT`.
15. Testy istniejące wywołują `_data_retention_run_tenant` na fiksturach z danymi 14–30 mies.
    (subskrybent L4, uczestnicy wydarzeń, zdarzenia) – nowe kategorie mogą je zmienić; uruchom oba pliki
    `hub_i9c_data_retention*` po dodaniu kategorii.

---

## Rekomendacja wdrożenia

**Wersje:** najwyższa migracja `20261020161400_data_retention_panel.sql`; najwyższy bliźniak
`0372_data_retention_panel.sql` (journal idx 372, `when` 1792477933912). S7 ma zarezerwowane
`20261020150000/150100` z bliźniakami `0373/0374` (prompt §7.2; na gałęzi PR jeszcze ich nie ma).
I9d: od `20261020161500`, bliźniaki od `0375` jeśli S7 zintegrowane wcześniej, inaczej od `0373`
(sprawdź `ls drizzle/migrations | tail` tuż przed nadaniem; `when` +60 000 od ostatniego).

**Kolejność (mechanizm wspólny dla wszystkich nowych kategorii, potem kategorie):**
1. `20261020161500_data_retention_categories_core.sql`:
   CHECK ×3 (+ ewentualnie `scope`), `_data_retention_catalog` (CIALO-Z 20261020161000) z nowymi
   kategoriami i regułami, seed karencji, nowe tabele (wyjątki/powiadomienia/stan wygaszania,
   agregat odczytów licznika), backfill agregatu dla dni zapieczętowanych.
2. `20261020161600_…_executor.sql`: funkcje kategorii + `_data_retention_run_tenant`
   (CIALO-Z 20261020161100); przy potrzebie `_data_retention_seal_funnel` (CIALO-Z 20261020161000),
   `_data_retention_fold_campaign_events` (CIALO-Z 20261020161100, utrwalenie ostatniego zaangażowania).
3. `20261020161700_…_reads.sql`: `monetization_dashboard` (znacznik `-- CIALO-Z: 20260724100000`
   wg bramki, ciało z 161200) – `metered_views` dni sprzed granicy z agregatu.
4. `20261020161800_…_panel.sql`: `admin_data_retention_preview`, `admin_data_retention_get`
   (CIALO-Z 20261020161400; poprawka `grace`), RPC list „do wygaszenia”/wyjątków z audytem i emitem.
5. Osobno (z `-- pg-harness: exclude`): `_hub_account_erase_modules` (CIALO-Z 20261020160900) dla
   zgłoszeń do klubów.
Każda ≤ 45 KiB; bliźniak bajt w bajt.

**Pliki TS do zmiany:** `src/lib/privacy/{dataRetention,dataRetentionParse,dataRetention.functions,dataRetentionQueries,keys}.ts`,
`src/components/admin/settings/dataRetention/{DataRetentionCard.tsx, nowa lista *DueList.tsx}`,
`src/lib/i18n-admin-data-retention.ts`, `src/lib/server/jobsTick.server.ts` (krok TS wysyłki
wygaszania, jeśli mail), `src/integrations/supabase/types.ts`, `src/lib/ci/hubDelivery.ts`,
`src/lib/authz/authzSnapshot.generated.ts`, `reports/i18n-parity.json`, `scripts/check-bundle-size.ts`.

**Testy:** `dataRetentionParity.test.ts` (najnowsza migracja, nowe kategorie/reguły/klucze),
`dataRetentionParse.test.ts` (nowe parsery), `DataRetentionCard.test.tsx` (mock nowych funkcji, lista,
axe), `jobsTickRun.test.ts`/`-jobs-tick.test.ts` (jeśli nowy krok), pgTAP: aktualizacja
`hub_i9c_data_retention_test.sql` (9 → N w l. 198 i 323, `plan`), `hub_i9c_data_retention_aggregates_test.sql`
(`metered_views` przed/po), nowy `supabase/tests/hub_i9c_*` lub `hub_i9d_*` (dopisać glob do manifestu I9),
`hub_shared_helpers_test.sql` (`hub-grants`). Bramki: pełna lista z promptu §5 pkt 4.

## Otwarte pytania / ryzyka

1. Karencja per kategoria vs globalna: `enable_now`/`postpone` przestawia wszystkie kategorie – czy nowe
   kategorie mają mieć własne 14 dni niezależnie od decyzji admina o starych (wtedy RPC karencji
   wymaga parametru kategorii)?
2. Druga redefinicja funkcji S3/S5 w I9 nie przejdzie bramki (`HUB_I9_REDEFINITIONS` jednowartościowy) –
   jeśli któraś kategoria naprawdę musi zmienić `_funnel_counts`/`admin_journey_stats`/`journey_*`,
   najpierw rozszerzyć bramkę (mapa wersji per plik) i opisać odchylenie w dzienniku.
3. `metered_views` po 3 mies.: przesunięcie granicy lejka na 3 mies. zmienia sposób liczenia okien
   3–13 mies. (agregat dobowy: konto raz na dzień) – wymaga akceptacji/opisu; alternatywa: osobna
   kolumna kont aktywnych tylko z `metered_views` w agregacie.
4. Wygaszanie newslettera: wysyłka i token muszą żyć w TS (sekret HMAC); nie ma kolumny `machine`
   w zdarzeniach kampanii; okno zaangażowania (6–24) dłuższe niż minimalna retencja zdarzeń (3) –
   potrzebne utrwalenie ostatniego zaangażowania (pułapka 8).
5. Kolizja numerów bliźniaków z S7 (0373/0374) i kolejność replay (`check:migration-lanes`,
   `sql-migration-replay`).
6. Pre-existing: kandydaci CRM liczą aktywność z surowych zdarzeń maili, które mogą zniknąć wcześniej
   niż okres CRM – do weryfikacji i ewentualnie nowe zgłoszenie Z-I9d-xx.
7. Rozmiar karty (leniwy chunk) rośnie z każdą listą i słownikiem – ratchet `overall` z kroniką.
