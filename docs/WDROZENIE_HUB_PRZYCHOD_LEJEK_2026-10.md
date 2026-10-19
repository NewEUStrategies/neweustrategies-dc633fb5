# Hub „Przychód i lejek” (`/admin/revenue`) - wdrożenie wycinków, od I0 (2026-10-19)

Specyfikacja wiążąca: `docs/SPEC_MODUL_PRZYCHOD_LEJEK_2026-10-18.md` (dalej:
SPEC). Ten dokument jest dziennikiem wdrożenia całego huba (SPEC §8.5 pkt 6).
Każdy wycinek dopisuje swoją sekcję i wiersz w dzienniku (§10). Sekcje 1-9
opisują wycinek **I0 - fundament i kontrakt** (Integrator, otwarcie).

Gałąź `hub/i0`, baza `baec9c64` (`main` + cennik v6.2 + poprawki), worktree
bez commitów - commit robi orkiestrator.

## 1. Zakres I0

Cel I0: zamrozić wszystko, co w falach A-B byłoby plikiem współdzielonym,
i dostarczyć addytywny DDL (M0). Kod I0 nie czyta ani nie pisze nowych tabel.
Robią to dopiero wycinki S1-S5. Trasy huba są zaślepkami bez wpisu
w nawigacji (nawigację dokłada I9).

| Tor                    | Pliki tworzone                                                                                                                                                                                                                                                                                                                                                                                                                          | Pliki zmieniane                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A - SQL, typy, bramka  | `supabase/migrations/20261020090000…090500_hub_*.sql` (6), bliźniaki `drizzle/migrations/0317…0322_hub_*.sql` (bajt w bajt), `supabase/tests/hub_schema_rls_test.sql` (58 asercji), `supabase/tests/hub_shared_helpers_test.sql` (27, w tym strażnik `hub_grants`), `src/lib/ci/hubDelivery.ts`, `src/lib/ci/__tests__/hubDelivery.gate.test.ts`                                                                                        | `drizzle/migrations/meta/_journal.json` (idx 317-322), `src/integrations/supabase/types.ts` (22 tabele, kolumny 7 tabel, `tier_rank_of`, `metering_defaults`), `src/lib/admin/retentionStats.ts` + `src/lib/admin/__tests__/pricingRules.test.ts`, `src/routes/admin.monetization.tsx` (`reason_label: string \| null`, liczby tylko z wierszy z powodem) |
| B - fabryki i kontrakt | `src/lib/revenue/{keys,search,window,segments,limits,money,rpcCallable}.ts`, `src/lib/journeys/{keys,limits,editorSearch}.ts`, `src/lib/crm/{keys,lifecycle}.ts`, `src/lib/newsletter/keys.ts`, `src/lib/access/{keys,meteringDefaults}.ts`, `src/lib/retention/keys.ts`, `src/lib/admin/{workflowKeys,couponKeys}.ts`, `src/lib/analytics/semantic/benchmarks/types.ts` + testy (`hubKeyFactories`, `queryKeyLiterals.gate`, parytety) | `src/lib/billing/keys.ts`; sieroty długu literałów: `components/admin/members/{MemberBillingDetails,MemberTierDialog,MembersDirectoryPanel}.tsx`, `components/admin/monetization/organisms/AdminMonetizationLedger.tsx`, `routes/profile.organization.tsx`                                                                                                |
| C - szyna zdarzeń      | `src/lib/realtime/eventInvalidationMap.admin.ts`, `src/lib/revenue/syncManifest.ts`, testy `realtime/__tests__/{hubEventCatalog,revenueInvalidation,slowInvalidation,invalidationExtension}.test.ts`, `revenue/__tests__/syncManifest.test.ts`                                                                                                                                                                                          | `src/lib/realtime/{domainEvents,eventInvalidationMap,useModuleRealtime}.ts`, `realtime/__tests__/eventInvalidationMap.test.ts`, `realtime/__tests__/useModuleRealtime.test.tsx` (Integrator), `src/routes/admin.tsx`                                                                                                                                      |
| D - trasy i zaślepki   | `src/routes/admin.revenue{,.index,.$tab}.tsx`, `src/routes/admin.revenue_.journeys.$journeyId.tsx`, `components/admin/revenue/{organisms/RevenueHubLayout,atoms/RevenueTabPending,tabs/RevenueTabOutlet}.tsx`, 11 zakładek `tabs/Revenue*Tab.tsx`, `components/admin/journeys/editor/JourneyEditorRoute.tsx`, `src/lib/i18n-admin-revenue.ts`, `src/routes/__tests__/adminRevenueHubRoutes.test.tsx`                                    | `src/routeTree.gen.ts` (4 trasy), `src/lib/admin/adminNav.ts` (`isCompactSidebarRoute`), `src/routes/__tests__/adminRouteAuthority.gate.test.ts`, `src/__tests__/i18nParity.gate.test.ts`, `reports/i18n-parity.json` (raport bramki)                                                                                                                     |
| E - proces             | `scripts/hub-slice-guard.ts`, ten dokument                                                                                                                                                                                                                                                                                                                                                                                              | `src/lib/ci/hubDelivery.ts` (Integrator: manifest I0 += `useModuleRealtime.test.tsx`)                                                                                                                                                                                                                                                                     |

Pełna lista: `git status --short --untracked-files=all` (98 ścieżek; manifest
I0 w `HUB_SLICE_MANIFESTS.I0` pokrywa każdą - `hub-slice-guard I0` zielony,
§7).

## 2. Decyzje właściciela

### 2.1 D-01..D-12 (SPEC §9.3) - przyjęte wartości domyślne

| ID   | Decyzja                                  | Wartość przyjęta w I0                                                                              | Termin ostateczny    |
| ---- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------- |
| D-01 | Lista etapów `lifecycle_stage`           | 9 etapów z §4.3 (`subscriber` … `other`), kolejność SQL = `LIFECYCLE_STAGES`                       | I0 - zamknięte       |
| D-02 | Aktywacja i TTV                          | „brak definicji” w UI, bez `MetricId`                                                              | S7                   |
| D-03 | Limit maili marketingowych i cisza nocna | 3 / 7 dni (`journey_settings.marketing_cap_per_7d DEFAULT 3`), 21:00-08:00 Europe/Warsaw           | S5                   |
| D-04 | Kategoria maili porzuconej kasy          | marketing (ze zgodą)                                                                               | S5                   |
| D-05 | Backfill kwot subskrypcji przez API      | nie; `basis='catalog'` jawnie                                                                      | S2                   |
| D-06 | Kto wprowadza plan MRR i koszty          | admin (`revenue_manual_inputs` czyta tylko admin); bez danych = „brak danych”                      | S2/S7                |
| D-07 | Polityka oferty retencyjnej              | istniejące `retention_settings`                                                                    | S2                   |
| D-08 | Ratchet budżetu bundla                   | **wariant B**: leniwe karty i zakładki, bez ratchetu; `check-bundle-size.ts` i baseline nietknięte | I0 zakres, I9 liczby |
| D-09 | Przekierowanie `/admin/monetization`     | 14 dni bez rozjazdu `reconcileAll`                                                                 | I9                   |
| D-10 | Domyślna osoba dla zadań bez właściciela | brak (reguła diagnostyki)                                                                          | S4                   |
| D-11 | Recenzent EN benchmarków i szablonów     | agent redakcyjny + akceptacja właściciela                                                          | S6, S5               |
| D-12 | Kolejność względem cennika v6.2          | spełnione: cennik scalony (`47ed79c7`, `baec9c64`); wdrożenie cennika przed M0                     | I0 - zamknięte       |

### 2.2 Nowe zgłoszenia do właściciela (powstały w I0)

| ID   | Zgłoszenie                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Stan w I0 (bezpieczna wartość)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Termin             |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Z-01 | **Segmenty przychodu dla partnerów.** Kontrakt SPEC liczy jako `other` warstwy `partner`, `partner_general`, `presidents_circle`, `ngo`, `vip`, `reader`, `supporter` i jednorazowy `decision_lab`. Partnerzy instytucjonalni nie trafiają więc do `b2b_institution`, a `ngo` nie trafia do `b2c_reduced`.                                                                                                                                                                                                                                                                              | Mapa SPEC bez zmian (`revenue_segment_of_tier` w `090500` = `REVENUE_SEGMENT_BY_TIER`). Zmiana = 1 linia SQL + 1 linia TS, pilnowana testem `segmentsParity`. Wymaga decyzji przed S2, bo wtedy segment zapisuje się w `mrr_movements` historycznie.                                                                                                                                                                                                                                                                                                                                                                      | przed S2           |
| Z-02 | **Rozszerzona sygnatura `_log_emit_error`.** W PL/pgSQL `SQLSTATE`/`SQLERRM` istnieją tylko w handlerze TEJ SAMEJ funkcji, więc trójargumentowy helper z SPEC nie mógłby zapisać błędu. Sygnatura: `_log_emit_error(p_tenant uuid, p_source text, p_event_type text, p_sqlstate text DEFAULT NULL, p_error text DEFAULT NULL)`. Wywołanie trójargumentowe z SPEC nadal działa. Emitery S1-S5 przekazują `SQLSTATE, SQLERRM`. Bez komunikatu zapisuje się `'unknown'`. Komunikat > 2000 znaków nie jest przycinany - zapisuje się znacznik `'message_too_long'` z zachowanym `sqlstate`. | Wdrożone w `090500`, przypięte pgTAP (`hub_shared_helpers_test`). Kontrakt dla emiterów S1-S5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | informacyjne       |
| Z-03 | **Odczyt `domain_event_emit_errors` bez `is_nes_staff()`.** Gałąź `is_nes_staff() OR (…)` z SPEC nie wiąże najemcy (prawda dla redaktora dowolnego najemcy), więc dawałaby odczyt awarii wszystkich najemców.                                                                                                                                                                                                                                                                                                                                                                           | Polityka: wyłącznie admin najemcy z sesji, własne wiersze. Wiersze bez najemcy czyta tylko `service_role` (server fn z bramką sztabu - S7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | przed S7           |
| Z-04 | **Próg budżetu `overall`.** Po I0 zostało 12,0 KB zapasu (4867,0/4879). Cele fali A (S1-S6) z §8.6 to łącznie ok. +36 KB, a cały plan huba ok. +106 KB. Wariant B (leniwe karty) nie zmniejsza `overall`, bo bramka liczy wszystkie chunki.                                                                                                                                                                                                                                                                                                                                             | Bez ratchetu (D-08 B). **Fala A nie zmieści się w progu** bez decyzji o ratchecie `overall` albo cięć poza hubem.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | przed falą A       |
| Z-05 | **Cele I0 dla `entry` i `public` przekroczone** (§8): entry +2,0 KB (cel ≤ +0,6), public +3,0 KB (cel ≤ +0,3). Progi twarde zielone, zapas entry 34 KB, public 121 KB.                                                                                                                                                                                                                                                                                                                                                                                                                  | Bez przenoszenia reguł rdzenia do rozszerzenia panelu (zmiana kontraktu `invalidationExtension`) - decyzja orkiestratora.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | przed scaleniem I0 |
| Z-06 | **Kolumny huba w `crm_leads` i `crm_tasks` zapisywalne przez personel.** `authenticated` ma tabelowe INSERT/UPDATE na obu tabelach (20260630053403, 20260721120000), a polityki personelu przepuszczają admina, redaktora i autora. Bez strażnika redaktor zmienia przez PostgREST `user_id` (`admin_journey_enroll_test` z S5 ufa `crm_leads.user_id = auth.uid()`), `lifecycle_stage` z pominięciem pierwszeństwa AD-11 (billing jedynym pisarzem `customer`/`former_customer`) oraz `source`/`origin_ref` zadania (zajęty `origin_ref` = cichy brak zadania kroku automatyzacji).    | I0 bez zmian: addytywny DDL §4.3, a topologię pisarzy (S-D: `updateCrmLead` → historia) i pierwszeństwo projektuje S4 - strażnik w I0 zablokowałby ją z góry. **Wymóg dla S4 (`130000`):** strażnik BEFORE INSERT OR UPDATE albo wyłącznie RPC - zmiana tych kolumn tylko z SECURITY DEFINER/`service_role`, `customer`/`former_customer` tylko ze źródła billing; pgTAP: admin i redaktor nie zmieniają ich przez UPDATE/INSERT (42501).                                                                                                                                                                                 | przed S4           |
| Z-07 | **Księga MRR a usunięcie konta.** `auth.users` → `subscriptions` → `subscription_state_history` → `mrr_movements` (`history_id ON DELETE CASCADE`) i `dunning_cycles` kaskadują, a ruchy z backfillu (`history_id NULL`) i migawki zostają - z surowym `user_id`. Usunięcie konta zmienia wstecz zamknięte miesiące (fantomowe MRR, utracone cykle windykacji) i łamie niezmienniki S2 (§4.7: `start + Σ = end`, dryf 0).                                                                                                                                                               | I0 bez zmian (DDL = §4.3): to decyzja RODO (zachować ruchy z anonimizacją czy kasować), a sama zmiana FK nie domyka głównej ścieżki - `deleteMyAccount` kasuje subskrypcję przed webhookiem anulowania, więc ruch `churn` nie powstaje wcale. **Rekomendacja dla S2** (pierwszy pisarz, zmiana w jego bloku nie migruje danych): `history_id ON DELETE SET NULL`, `user_id` NULL-owalne z anonimizacją przy usunięciu konta (wzorzec 20260805090100), ruch `churn` przy DELETE subskrypcji z MRR > 0, backfill rozróżniany kolumną `backfilled`; pgTAP: usunięcie konta nie zmienia Σ `delta_minor` zamkniętych miesięcy. | przed S2           |
| Z-08 | **Lista „ostatnie odpowiedzi” w `/admin/pricing?tab=retention`.** Po S2 wiersze bez powodu (`started`, `abandoned`) trafiają do `RetentionFeedbackList` jako puste wiersze z datą i zajmują miejsca w próbce `limit(100)`.                                                                                                                                                                                                                                                                                                                                                              | I0 poprawił liczby (`retentionStats`, karta w `/admin/monetization`: tylko wiersze z powodem; test w `pricingRules.test.ts`). **Do integracji → S1** (właściciel `RetentionTab` i `retentionFeedbackQueryOptions`): filtr `reason_label` NOT NULL w zapytaniu (limit nie zjada odpowiedzi) i na liście.                                                                                                                                                                                                                                                                                                                   | przed S2           |
| Z-09 | **„Anuluj mimo to” przed wyborem powodu.** Karta S2 każe pokazywać ten przycisk zawsze, a CHECK I0 (zgodnie z §4.7) wymaga powodu dla `canceled`.                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Do decyzji S2:** przycisk zapisuje `canceled` z jawnym powodem z katalogu (np. „nie podano”) albo prosi o powód; zmiana CHECK tylko przez zgłoszenie do Integratora. `abandoned` bez powodu jest dozwolone od I0.                                                                                                                                                                                                                                                                                                                                                                                                       | przed S2           |

## 3. Odchylenia od SPEC (fakty repozytorium wygrywają, kontrakt bez zmian)

| Miejsce SPEC                                    | Stan po I0                                                                                                                                                                                                                                                                                                                                                                | Uzasadnienie                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §8.5 pkt 1, §4.8 próg „> 20261018120400”        | Cennik v6.2 ma wersje `20261018160000…160400` i bliźniaki drizzle `0312…0316`. Bramka `hubDelivery` skanuje wyłącznie blok huba `[20261020090000, 20261020170000)`.                                                                                                                                                                                                       | Próg ze SPEC łapałby 7 funkcji spoza huba (cennik v6.2 + `release_coupon_order_lock`).                                                                                                                                                                                                                                                                                                    |
| §8.5 pkt 2 „bliźniaki drizzle od bota”          | Bliźniaki `0317…0322` są w I0, wpisy `_journal.json` idx 317-322, `when` = 1792349760560 + n·60 000.                                                                                                                                                                                                                                                                      | `check:migration-lanes` wymaga kopii w dzienniku drizzle dla każdego pliku pasa supabase od `20260911160000`. Cennik zrobił to samo.                                                                                                                                                                                                                                                      |
| §4.3 CHECK `reason_label`                       | `CHECK (COALESCE(outcome IN ('started','abandoned'), false) OR (reason_label IS NOT NULL AND btrim(reason_label) <> ''))`, dodany `NOT VALID` + `VALIDATE`.                                                                                                                                                                                                               | (1) Kod do S2 wstawia wiersze BEZ `outcome`. W kształcie SPEC `NULL OR false = NULL` przepuszczałoby pusty powód - pgTAP przypina „`outcome` NULL + pusty powód = 23514”. (2) §4.3 wymagał powodu także przy `abandoned`, a §4.7 każe skanerowi S2 domykać porzucone przepływy (bez powodu) - jeden UPDATE padałby w całości na 23514. pgTAP przypina `started` → `abandoned` bez powodu. |
| §4.3 polityka `domain_event_emit_errors`        | Bez gałęzi `is_nes_staff()` (Z-03).                                                                                                                                                                                                                                                                                                                                       | Odczyt między najemcami.                                                                                                                                                                                                                                                                                                                                                                  |
| §4.8 rejestr `CIALO-Z`                          | `crm_upsert_lead_from_profile` = `20260722093022`, `log_metering_event` = `20260721070203`.                                                                                                                                                                                                                                                                               | Wersje z SPEC (`20261007140500`, `20261013090400`) zmieniają tylko granty. Rejestr wskazuje ostatnią DEFINICJĘ ciała - test `verifyCialoZRegistry` na pełnym zestawie migracji.                                                                                                                                                                                                           |
| §4.8 bramka: „`REVOKE … FROM PUBLIC, anon`”     | Funkcje serwisowe, wewnętrzne i wyzwalacze: `REVOKE … FROM PUBLIC, anon, authenticated` (dowolna kolejność ról); panel i czytelnik: `PUBLIC, anon` + jawny `GRANT EXECUTE … TO authenticated`. Definicja bez `public.` = naruszenie `funkcja-poza-public`; GRANT na listę funkcji i `ON ALL FUNCTIONS IN SCHEMA` widoczne. Strażnik pgTAP `hub_grants` czyta ACL w bazie. | Domyślne ACL platformy nadają `authenticated` EXECUTE jawnie (`stub.sql`, 20261007120500) - litera §4.8 przepuszczała helper z `p_tenant` otwarty dla każdego zalogowanego. Wzmocnienie = §4.1 i §4.4.                                                                                                                                                                                    |
| §8.1 „41 plików długu literałów”                | Lista zamrożona: 41 plików (S1 19, S2 3, S4 19).                                                                                                                                                                                                                                                                                                                          | Plan liczył 42. Skaner bramki wygenerował 41 - lista pochodzi ze skanera, nie z ręki.                                                                                                                                                                                                                                                                                                     |
| §8.3 I0 „autor dostaje `RoleGateNotice`”        | `RevenueHubLayout` renderuje minimalne powiadomienie (`role="status"`, `data-testid="revenue-role-gate"`, klucz `adminRevenue.common.roleGate`).                                                                                                                                                                                                                          | `RoleGateNotice` tworzy S6 (zestaw UI). S6 podmienia zaślepkę w pliku, który i tak przejmuje.                                                                                                                                                                                                                                                                                             |
| §3.3 „istniejące testy hooka bez zmian”         | `useModuleRealtime.test.tsx`: zaktualizowana jedna asercja przypinająca dokładną listę kluczy `crm_lead.created.v1` (+ `["crm-funnel"]`, `["crm-funnel-stats"]`). Plik dopisany do manifestu I0.                                                                                                                                                                          | Poszerzenie D8 (§2.3 planu) dokłada lejek CRM do reguły. Wolny pas jest wstecznie zgodny - pozostałe testy hooka bez zmian.                                                                                                                                                                                                                                                               |
| §8.3 I0 `adminRouteAuthority` (pgTAP-autorytet) | Literały `has_role(…, 'admin')` i `is_admin_or_editor()` test szuka w migracjach bloku I0 (tam stoją polityki), a w `hub_schema_rls_test.sql` - nazwanych gwarancji (editor bez kwot, autor bez niczego, izolacja najemców, zapis odrzucony).                                                                                                                             | Plik pgTAP testuje zachowanie (rola, najemca), więc nie zawiera tych literałów - plan zakładał ich obecność w pgTAP.                                                                                                                                                                                                                                                                      |
| §8.6 cele bundla I0                             | Przekroczone dla entry/public/overall (§8).                                                                                                                                                                                                                                                                                                                               | Z-04, Z-05.                                                                                                                                                                                                                                                                                                                                                                               |

## 4. Procedura M0 - wdrożenie DDL I0

M0 następuje zaraz po scaleniu I0 do `main` (od scalenia do wdrożenia
`post-deploy` jest czerwony - oczekiwane, R11). Warunek wstępny: migracje
cennika v6.2 (`20261018160000…160400`) są wdrożone, a `post-deploy` po nich
był zielony.

### 4.1 Zapytania przed wdrożeniem (SQL editor, tylko odczyt)

```sql
-- 1) Liczności i rozmiary gorących tabel: czas skanu CHECK (crm_leads,
--    subscriptions, billing_documents, crm_tasks) i budowy indeksu
--    częściowego na email_send_log - w tej samej transakcji co ADD COLUMN,
--    więc pod ACCESS EXCLUSIVE: na czas budowy stoi także ODCZYT dziennika.
SELECT c.relname, c.reltuples::bigint AS wiersze_szac,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS rozmiar
  FROM pg_class c
 WHERE c.oid IN ('public.crm_leads'::regclass, 'public.email_send_log'::regclass,
                 'public.subscriptions'::regclass, 'public.crm_tasks'::regclass,
                 'public.billing_documents'::regclass, 'public.retention_feedback'::regclass);
SELECT count(*) AS crm_leads FROM public.crm_leads;
SELECT count(*) AS email_send_log FROM public.email_send_log;

-- 2) Pusty powód odejścia: oczekiwane 0 (stary CHECK ich nie wpuszczał).
--    Wynik > 0 = VALIDATE w 090100 przerwie migrację - najpierw wyjaśnić.
SELECT count(*) AS pusty_powod
  FROM public.retention_feedback
 WHERE reason_label IS NULL OR btrim(reason_label) = '';

-- 3) Stary CHECK pod nazwą domyślną: jedyny wiersz z `btrim(reason_label)`
--    ma nazwę `retention_feedback_reason_label_check`. Inna nazwa = strażnik
--    w 090100 przerwie migrację z tą nazwą (zdejmij ręcznie).
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'public.retention_feedback'::regclass AND contype = 'c';

-- 4) Kolumny, na których powstają indeksy unikalne, jeszcze nie istnieją:
--    oczekiwane 0 wierszy. Wtedy crm_leads_tenant_user_uidx
--    i crm_tasks_origin_uidx powstają na samych NULL-ach (bez konfliktów).
SELECT table_name, column_name
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (table_name, column_name) IN (('crm_leads','user_id'), ('crm_leads','lifecycle_stage'),
                                     ('crm_tasks','source'), ('crm_tasks','origin_ref'),
                                     ('email_send_log','provider_message_id'),
                                     ('checkout_settings','abandon_after_minutes'));

-- 5) Kolizje nazw: oczekiwane same NULL-e.
SELECT to_regclass('public.mrr_movements') AS mrr, to_regclass('public.journey_definitions') AS jd,
       to_regclass('public.domain_event_emit_errors') AS emit,
       to_regprocedure('public.tier_rank_of(text)') AS tier_rank_of;

-- 6) Długie transakcje (lock_timeout 5 s je przegra): oczekiwane 0 wierszy.
SELECT pid, now() - xact_start AS trwa, state, left(query, 80)
  FROM pg_stat_activity
 WHERE xact_start < now() - interval '1 minute' AND pid <> pg_backend_pid();
```

### 4.2 Wdrożenie

1. Okno poza szczytem, **nocą** (ALTER gorących tabel). Wyłącz ręczne
   operacje w panelu na czas okna.
2. Panel Lovable → SQL / migracje: 6 plików **w kolejności wersji**:
   `20261020090000_hub_schema_revenue_ledger` → `090100_hub_schema_funnel_ops`
   → `090200_hub_schema_crm_lifecycle` → `090300_hub_schema_journeys_core` →
   `090400_hub_schema_journeys_messaging` → `090500_hub_shared_sql_helpers`.
   `090300` musi poprzedzać `090400`: FK `journey_messages` → `journey_enrollments`
   i `journey_email_contents` → `journey_definitions`/`journey_versions`.
   `090500` jest niezależna, ale zamyka blok, więc idzie ostatnia.
3. Każdy `ALTER TABLE` na gorących tabelach (`subscriptions`,
   `billing_documents`, `retention_feedback`, `checkout_settings`,
   `crm_leads`, `crm_tasks`, `email_send_log`) i klucz obcy
   `journey_enrollments` → `crm_leads` w `090300` stoją za
   `SET lock_timeout = '5s'`. Zajęta tabela = błąd `55P03` zamiast kolejki
   blokującej ruch. Migracja jest idempotentna (`IF NOT EXISTS`, `DROP POLICY
IF EXISTS` + `CREATE POLICY`, `CREATE OR REPLACE`, `VALIDATE` na
   zwalidowanym = no-op), więc ponawiasz ten sam plik po chwili. Dowód: drugie
   zaaplikowanie 6 plików na bazie pgTAP przeszło bez błędu (§9).
4. Czego się spodziewać pod blokadą. Każdy plik wykonuje się w JEDNEJ
   transakcji (panel, Supabase CLI i migrator drizzle - stąd ponawianie
   całego pliku w pkt 3), a `ALTER TABLE` trzyma ACCESS EXCLUSIVE do jej
   końca. Wszystko, co w tym samym pliku idzie po `ALTER` na tej samej
   tabeli, działa więc pod ACCESS EXCLUSIVE - stoi zapis I ODCZYT.
   `lock_timeout` ogranicza CZEKANIE na blokadę, nie czas jej trzymania -
   dlatego okno nocne i zapytanie 6 z §4.1 (długie transakcje) są
   obowiązkowe. Gdzie i jak długo:
   - skan CHECK na `crm_leads`, `subscriptions`, `billing_documents`,
     `crm_tasks` (czas ∝ liczność z §4.1);
   - `090400`: `ADD COLUMN provider_message_id` i budowa indeksu
     częściowego `email_send_log_provider_message_id_idx` - do końca budowy
     stoją panele dziennika i dren kolejki maili (czas ∝ rozmiar
     `email_send_log`);
   - `090100`: `VALIDATE` na `retention_feedback` idzie po `ADD COLUMN`
     i `ADD CONSTRAINT … NOT VALID` w tej samej transakcji, więc skanuje pod
     ACCESS EXCLUSIVE, nie pod SHARE UPDATE EXCLUSIVE (podział NOT VALID +
     VALIDATE nie skraca tu blokady; tabela jest mała);
   - `090300`: klucz obcy `journey_enrollments` → `crm_leads` bierze SHARE
     ROW EXCLUSIVE na `crm_leads` (odczyt działa, zapis leadów czeka).
5. Bliźniaki drizzle `0317…0322` są kopiami bajt w bajt. Jeśli migrator
   drizzle wykona je po panelu, wszystkie instrukcje są no-op.
6. `workflow_dispatch` CI na `main` → job `post-deploy`:
   `check:db-contract` (nowe tabele, kolumny i funkcje z migracji I0) i
   `check:migration-ledger` (6 wersji w `supabase_migrations.schema_migrations`)
   mają być zielone. Wynik wpisz do dziennika (§10).

### 4.3 Po wdrożeniu (kontrola)

```sql
-- 22 tabele z RLS: oczekiwane 22.
SELECT count(*) FROM pg_class
 WHERE relnamespace = 'public'::regnamespace AND relrowsecurity
   AND relname IN ('subscription_state_history','mrr_movements','dunning_cycles','mrr_daily_snapshots',
                   'revenue_event_marks','paywall_hits','revenue_manual_inputs','revenue_diagnostic_snoozes',
                   'crm_lead_stage_history','journey_definitions','journey_versions','journey_event_routes',
                   'journey_event_inbox','journey_enrollments','journey_step_runs','journey_settings',
                   'journey_engine_errors','journey_messages','journey_message_events',
                   'journey_email_contents','journey_node_daily_stats','domain_event_emit_errors');
-- Domyślne: oczekiwane 'subscriber', 'manual', 1440.
SELECT column_default FROM information_schema.columns
 WHERE table_schema = 'public' AND (table_name, column_name) IN
       (('crm_leads','lifecycle_stage'), ('crm_tasks','source'), ('checkout_settings','abandon_after_minutes'));
-- Nowy CHECK zwalidowany: oczekiwane convalidated = true.
SELECT conname, convalidated FROM pg_constraint
 WHERE conname = 'retention_feedback_reason_label_required';
```

### 4.4 Numery bliźniaków i renumeracja przy scaleniu

Numery `0317…0322` są zarezerwowane na gałęzi huba. `main` dostaje wpisy
dziennika także od Lovable i innych prac. Jeśli przed scaleniem I0 `main`
zajmie `0317` lub dalsze:

1. Zmień nazwy plików I0 na kolejne wolne numery (`git mv`), bez zmiany treści.
2. W `_journal.json` przenieś 6 wpisów I0 na koniec: `idx` od ostatniego +1,
   `tag` = nowa nazwa bez `.sql`, `when` = ostatni `when` z `main` + n·60 000
   (ściśle rosnący - inaczej migrator pominie wpis po cichu).
3. `bun run check:migration-lanes` i `bun run scripts/hub-slice-guard.ts I0
--base origin/main` muszą być zielone. Manifest I0 trzyma bliźniaki pod
   jawną listą numerów - przy renumeracji zaktualizuj glob
   `drizzle/migrations/{0317,…}_hub_*.sql` w `hubDelivery.ts`.

## 5. Wycofanie

DDL I0 jest wyłącznie addytywny: nowe tabele, kolumny NULL-owalne albo ze
stałą domyślną, indeksy, polityki odczytu, funkcje bez wywołań w kodzie.
Kod I0 nie czyta ani nie pisze nowych tabel - robią to dopiero S1-S5. Jedyną
zmianą semantyki istniejącego obiektu jest `retention_feedback`:
`reason_label` jest NULL-owalne, ale nowy CHECK utrzymuje dawną gwarancję dla
każdego wiersza poza `outcome` ∈ {`started`, `abandoned`}, a takich nikt
jeszcze nie pisze.

- **Wycofanie kodu** (revert commita I0): baza zostaje, nic jej nie używa. `post-deploy` pozostaje zielony, bo
  `check:migration-ledger` sprawdza tylko wersje obecne w repo.
- **Bez `DROP`.** Usunięcie tabel albo kolumn po wdrożeniu S1-S5 niszczyłoby
  dane księgi. Przed S1 nie daje niczego, czego nie da revert kodu. Ewentualne
  sprzątanie = osobna migracja z wersją spoza bloku huba, decyzją właściciela.
- **Częściowe wdrożenie** (np. `55P03` na `090200`): wdrożone pliki zostają,
  ponawiasz od pierwszego niewdrożonego. Kolejność wersji gwarantuje spójność
  FK.

## 6. Pas drizzle dla S1-S7

`drizzle/migrations/meta/_journal.json` jest plikiem współdzielonym
(`HUB_SHARED_FILES`) - wycinek S nie dotyka ani dziennika, ani
`drizzle/migrations/*.sql` (strażnik czerwieni na `[plik-wspoldzielony]`
i `[poza-manifestem]`).

1. Wycinek dostarcza wyłącznie `supabase/migrations/<blok>????_*.sql` w swoim
   bloku wersji (`HUB_VERSION_BLOCKS`: S1 `2026102010`, S2 `11`, S3 `12`,
   S4 `13`, S5 `14`, S7 `15`; S6 i S8 bez SQL) + pgTAP.
2. `check:migration-lanes` na gałęzi wycinka jest czerwony na braku
   bliźniaków. Na `hub/integration` jest to oczekiwane, na `main` blokujące.
3. Integrator w **PR-A fali** (migracje S1-S5, potem S7 - SPEC §8.5) dodaje
   bliźniaki wszystkich migracji fali i ich wpisy dziennika **w kolejności
   wersji** (nie kolejności scalania wycinków), z numerami od pierwszego
   wolnego na `main` w chwili scalenia i `when` ściśle rosnącym.
4. Po scaleniu PR-A: wdrożenie w kolejności wersji z panelu Lovable → `post-deploy`
   zielony → dopiero PR-B (kod).

## 7. `scripts/hub-slice-guard.ts` - procedura

```bash
bun run scripts/hub-slice-guard.ts <I0|S1..S8|I9> [--base <ref>]
```

- **Kiedy:** przed każdym pushem gałęzi wycinka (SPEC §8.1) i w PR do
  `hub/integration`.
- **Co liczy:** `git diff --name-only --no-renames --diff-filter=ACMRD
<merge-base(base, HEAD)>..HEAD` + `git status --porcelain -uall`
  (niezatwierdzone też). Zmiana nazwy liczy obie ścieżki.
- **Baza domyślna:** pierwsza istniejąca z `hub/integration`,
  `origin/hub/integration`, `origin/main`, `main`. Fallback na `main` jest
  bezpieczny w złą stronę: bez I0 w bazie pliki I0 wypadają poza manifest,
  więc wynik jest czerwony, a nie fałszywie zielony.
- **Reguły** (`src/lib/ci/hubDelivery.ts`):
  - `[poza-manifestem]` - plik spoza globów karty wycinka;
  - `[plik-wspoldzielony]` - plik z `HUB_SHARED_FILES` zmieniony w S1-S8 (poza przydziałem imiennym S5);
  - `[migracja-poza-blokiem]` - migracja supabase z wersją spoza bloku wycinka;
  - analiza dostawy zmienionych migracji (właściciel funkcji, blok, `CIALO-Z`, nagłówek PL, ≤ 45 KiB, jawny schemat `public.`, `REVOKE … FROM PUBLIC, anon, authenticated` dla funkcji serwisowych, wewnętrznych i wyzwalaczy, `PUBLIC, anon` + jawny `GRANT … TO authenticated` dla panelu i czytelnika, brak `GRANT … TO authenticated` dla serwisowych - także w GRANT na listę funkcji i `ON ALL FUNCTIONS`, `-- pg-harness: exclude`) na tle całego katalogu migracji.
- **Kod wyjścia:** 0 zielono, 1 naruszenie, 2 błędne wywołanie / git.
- **Czerwień = zgłoszenie „Do integracji”** w opisie PR (SPEC §8.1), nie
  edycja pliku współdzielonego.

Dowody (2026-10-19):

| Przypadek                                                                                   | Wynik                                                                                                                       |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `I0 --base baec9c64` w worktree I0                                                          | ✓ 98 plików w manifeście, 6 migracji w bloku, 5 definicji funkcji, exit 0                                                   |
| S1 + zmiana `src/routeTree.gen.ts` + plik S1 (klon tymczasowy)                              | ✗ `[plik-wspoldzielony] src/routeTree.gen.ts`, exit 1                                                                       |
| S1 + migracja `20261020100500` z funkcją bez właściciela i bez REVOKE + migracja `…110000…` | ✗ `[poza-manifestem]`, `[migracja-poza-blokiem]`, `[bez-wlasciciela]`, `[brak-revoke]`, `[funkcja-w-dwoch-blokach]`, exit 1 |
| S1 + zatwierdzone `git mv src/lib/admin/adminNav.ts …/paywall/…`                            | ✗ `[plik-wspoldzielony] src/lib/admin/adminNav.ts`, exit 1                                                                  |
| S1 bez zmian                                                                                | ✓ exit 0                                                                                                                    |
| brak wycinka / `S9` / `--base nope`                                                         | exit 2 z komunikatem użycia                                                                                                 |

## 8. Pomiar bundla (SPEC §8.6, D-08 wariant B)

`flock -o /tmp/hub-build.lock env BUNDLE_INVENTORY=1 bun run build` + `check:bundle`.
Baza zmierzona TYM SAMYM narzędziem na klonie `baec9c64` (te same
`node_modules`). Pomiar orkiestratora podano dla porównania.

| Budżet (gzip KB)         | Próg (`FROZEN_BUDGET_KB`) | Baza orkiestratora | Baza lokalnie `baec9c64` | Po I0  | Δ I0     | Cel I0 | Wynik                             |
| ------------------------ | ------------------------- | ------------------ | ------------------------ | ------ | -------- | ------ | --------------------------------- |
| największy chunk (entry) | 286                       | 250                | 250,0                    | 252,0  | **+2,0** | ≤ +0,6 | próg ✓, cel ✗ (Z-05)              |
| `public`                 | 2881                      | 2755,9             | 2756,6                   | 2759,6 | **+3,0** | ≤ +0,3 | próg ✓, cel ✗ (Z-05)              |
| `overall`                | 4879                      | 4856,6             | 4858,0                   | 4867,0 | **+9,0** | ≤ +3   | próg ✓ (zapas 12,0), cel ✗ (Z-04) |
| `css`                    | 100                       | 99,4               | 99,4                     | 99,4   | +0,0     | +0,0   | ✓                                 |
| `publicCss`              | 85                        | 83,7               | 83,7                     | 83,7   | +0,0     | +0,0   | ✓                                 |
| `boot`                   | 579                       | -                  | 463,8                    | 465,7  | +1,9     | -      | ✓                                 |
| liczba chunków           | -                         | -                  | 1398                     | 1414   | +16      | -      | `check:chunks` ✓ (acykliczny)     |

Przypisanie przyrostów (inwentarz `reports/chunk-inventory.json`, gzip -9 per
chunk, bajty modułów przed minifikacją):

| Chunk                                                                                                           | Δ gzip                 | Przyczyna                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app-initial` (entry, public, boot)                                                                             | +2,3                   | Powłoki 4 tras jadą w entry z założenia (TanStack: `validateSearch`, `head`, `beforeLoad` nie są dzielone - V14). Raw: `revenue/search.ts` 2,7 KB (parser URL), `admin.revenue.$tab.tsx` 1,9 KB (`HEADS` - 10 sekcyjnych tytułów i opisów, AGENTS), `journeys/editorSearch.ts` 1,1 KB, pozostałe 3 powłoki 1,5 KB, `routeTree.gen.ts` +0,8 KB, `billing/keys.ts` +0,7 KB. |
| `eventInvalidationMap` (nowy, public) / `useModuleRealtime` (public)                                            | +3,6 / −2,0 = **+1,6** | Mapa wydzieliła się do własnego chunku, bo `routes/admin.tsx` importuje `registerInvalidationExtension` (moduł wspólny dla grafu `CohesionLiveSync` i panelu). Netto: 34 nowe reguły rdzenia (+5,1 KB raw) i liście fabryk `crm/newsletter/access/retention/workflow/coupon` (3,4 KB raw).                                                                                |
| `domainEvents` (public)                                                                                         | +0,2                   | 34 typy i 19 agregatów w katalogu.                                                                                                                                                                                                                                                                                                                                        |
| `admin` (admin-only)                                                                                            | +1,1                   | `eventInvalidationMap.admin.ts` 4,5 KB raw, `journeys/keys.ts` 1,6 KB, `revenue/keys.ts` 1,0 KB - rozszerzenie panelu, poza `public` zgodnie z AD-06.                                                                                                                                                                                                                     |
| `RevenueTabPending` (admin-only)                                                                                | +1,3                   | Słownik `i18n-admin-revenue.ts` (2,7 KB raw) ładowany z pierwszą zakładką.                                                                                                                                                                                                                                                                                                |
| `admin.revenue`, `admin.revenue._tab`, `admin.revenue.index`, `admin.revenue_.journeys._journeyId` (admin-only) | +1,8                   | Leniwe komponenty tras: układ, `RevenueTabOutlet`, kokpit, edytor (zaślepki).                                                                                                                                                                                                                                                                                             |
| 10 × `Revenue*Tab` (admin-only)                                                                                 | +2,3                   | Narzut per chunk (ok. 0,23 KB) jednolinijkowych zaślepek. Z założenia (D-08 B: każda zakładka leniwa) - S7 podmienia treść, narzut się amortyzuje.                                                                                                                                                                                                                        |

Wnioski dla orkiestratora:

- **Entry i `public`** - cele z §8.6 skalibrowano na stanie 284,7/286
  i 2879,1/2881, którego już nie ma (V3: zapas 36/125 KB). Przekroczenie
  wynika z konstrukcji routera (powłoki w entry) i z rdzenia mapy. Plan
  wyklucza przeniesienie reguł do rozszerzenia (kontrakt testu
  `invalidationExtension`). Rekomendacja: przyjąć (Z-05).
- **`overall`** - realnie ciasny (12,0 KB zapasu po I0). Z +9,0 KB tylko ok.
  2,5 KB to `public`, reszta to leniwe chunki panelu. Decyzja D-08
  (ratchet `overall`) jest potrzebna PRZED falą A (Z-04).
- **Po poprawkach przeglądu (§9.1)**: `overall` 4867,5, `public` 2760,2,
  entry 252,0, CSS bez zmian. Inwentarz chunków przed i po: surowe bajty
  −31 B, wyłącznie chunki panelu (`admin.monetization`, `admin.pricing`,
  `admin.revenue`, edytor ścieżki); +0,5 KB gzip to entropia nowych hashy
  w nazwach importów, nie kod.
- **CSS +0,0** - żaden plik I0 nie dodał reguły do arkusza wspólnego ani
  panelu (zaślepki używają klas już obecnych w arkuszach).

## 9. Weryfikacja końcowa I0 (SPEC §8.3, PLAN §5) - 2026-10-19

| Polecenie                                                                                                                                                                                                                        | Wynik                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run format:check`                                                                                                                                                                                                           | ✓ „All matched files use Prettier code style!”                                                                                                        |
| `bun run verify:static`                                                                                                                                                                                                          | ✓ 18 bramek OK (m.in. `check:ts-sql-contract`, `check:types-freshness` 381 tabel, `check:sql-tenant-scope` 1667 funkcji)                              |
| `bun run typecheck` (tsgo + `tsconfig.scripts.json` + e2e)                                                                                                                                                                       | ✓ 0 błędów                                                                                                                                            |
| `bun run lint`                                                                                                                                                                                                                   | ✓ 0 błędów (274 ostrzeżenia - wszystkie sprzed I0)                                                                                                    |
| `bunx vitest run src/lib/realtime src/lib/revenue src/lib/journeys src/lib/crm src/lib/access src/lib/ci src/routes/__tests__ src/lib/__tests__ src/lib/billing`                                                                 | ✓ 628 plików, 18 959 testów (+ 96 oczekiwanych porażek `it.fails`)                                                                                    |
| `bun run test` (cała suita)                                                                                                                                                                                                      | ✓ 3462 pliki (2 pominięte), 87 284 testy (+ 297 oczekiwanych porażek, 51 pominiętych) - po poprawkach przeglądu (§9.1)                                |
| pgTAP `run.sh all` (`PGTAP_DIR=/tmp/pgtap-hub-I0`, port 5450, `flock`)                                                                                                                                                           | 1251 migracji (1 błąd znany), 204 pliki OK, 3 z błędem znanym; `hub_schema_rls_test` 58/58, `hub_shared_helpers_test` 27/27 (po poprawkach przeglądu) |
| ponowne zaaplikowanie 6 migracji I0 na tej bazie + `run.sh test hub_`                                                                                                                                                            | ✓ 6 × rc=0 (idempotencja), 3 pliki OK                                                                                                                 |
| `bun run generate:ts-sql-contract` + `run.sh test ts_sql_contract`                                                                                                                                                               | ✓ 914 wywołań RPC, 1492 operacji na tabelach; plik bez zmian; 9/9                                                                                     |
| `split-migration.ts --dry-run` dla `2026102009*`                                                                                                                                                                                 | ✓ każdy plik 1 część (6,6-19,4 KB < 45 KiB)                                                                                                           |
| bliźniaki `cmp supabase ⇄ drizzle 0317…0322`                                                                                                                                                                                     | ✓ bajt w bajt                                                                                                                                         |
| `check:migration-lanes`, `check:types-freshness`, `check:on-conflict-arbiters`, `check:sql-{tenant-scope,app-role,anon-insert,definer-views,migration-replay,owner-tenant-scope,policy-tenant-regression}`, `check:rpc-contract` | ✓ wszystkie zielone                                                                                                                                   |
| `build` + `check:bundle` + `check:chunks` + `check:entry-purity` + `check:server-entry-purity`                                                                                                                                   | ✓ wszystkie zielone (§8)                                                                                                                              |
| `bun run scripts/hub-slice-guard.ts I0 --base baec9c64`                                                                                                                                                                          | ✓ exit 0 (§7)                                                                                                                                         |

Znane błędy środowiska (nie naprawiane, nie są regresją I0):

- 3 asercje `pg_net`: `community_cron_schedule_test` 11-12, `job_scheduler_heartbeat_test` 23;
- `public_definer_views_read_only_test` asercja 3 (domyślne uprawnienia `public` w lokalnym klastrze);
- migracja `20260825230232` (brak `supabase_migrations.schema_migrations` w lokalnym klastrze);
- `check:pg-harness` lokalnie (brak pgvector) - nieuruchamiany.

Jednorazowo `run.sh test hub_` zgłosił „serwer padł” na `expert_hub_test.sql`
podczas równoległego startu pełnej suity vitest. Serwer odpowiadał, plik
uruchomiony osobno przeszedł, a powtórka `test hub_` dała 3/3. To przejściowe
zjawisko środowiska, nie wynik testu.

### 9.1 Poprawki po przeglądzie I0 (2026-10-19)

| Ustalenie                                                                                                | Decyzja                                    | Zmiana i dowód                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bramka `brak-revoke` bez `authenticated`; definicja bez `public.`; GRANT na listę funkcji; kolejność ról | naprawione                                 | `hubDelivery.ts`: zbiór ról w dowolnej kolejności (`PUBLIC, anon, authenticated` dla serwisowych, wewnętrznych i wyzwalaczy; `PUBLIC, anon` + jawny GRANT dla panelu i czytelnika - `brak-grantu`), schemat opcjonalny i w cudzysłowach (`funkcja-poza-public`), skaner listy celów GRANT/REVOKE i `ON ALL FUNCTIONS`. Fikstury w `hubDelivery.gate.test.ts`; strażnik pgTAP `hub_grants` w `hub_shared_helpers_test` (ACL po `pg_proc`, lista = rejestr - test parytetu). Mutacja `GRANT … _tier_rank_of … TO authenticated` zaczerwienia strażnika. |
| CHECK `reason_label` blokuje `abandoned` bez powodu (dwa ustalenia)                                      | naprawione                                 | `090100` + bliźniak `0318`: `COALESCE(outcome IN ('started','abandoned'), false) OR (…)`; komentarz kolumny i nagłówek. pgTAP: `started` → `abandoned` bez powodu przechodzi, `canceled` z pustym powodem - 23514. `canceled` przed wyborem powodu - Z-09.                                                                                                                                                                                                                                                                                            |
| Izolacja najemców w pgTAP tylko dla 4 z 16 tabel                                                         | naprawione                                 | Fixture: wiersz w KAŻDEJ z 16 tabel w obu najemcach + asercja kompletności; per tabela: admin A i B tylko swoje, editor 0 finansowych i każda operacyjna tylko swoja, autor 0. Mutacja (`USING (true)` na `journey_messages`, druga polityka na `revenue_manual_inputs`) - 5 czerwonych asercji.                                                                                                                                                                                                                                                      |
| Opis blokad M0, brak `lock_timeout` w `090300`                                                           | naprawione                                 | §4.1, §4.2 pkt 3-4 (ACCESS EXCLUSIVE w jednej transakcji, także odczyt); `090300` + bliźniak `0320`: `SET lock_timeout = '5s'` wokół FK do `crm_leads`.                                                                                                                                                                                                                                                                                                                                                                                               |
| Bramka roli UI szersza niż SQL (`super_admin`)                                                           | naprawione (wariant B)                     | `RevenueHubLayout`, `JourneyEditorRoute`: `roles.includes("admin") \|\| roles.includes("editor")`; testy tras (`super_admin` sam - powiadomienie, z wierszem `admin` - zakładka), `adminRouteAuthority` (zakaz `isAdmin` w kodzie bramek), pgTAP: sam `super_admin` nie czyta żadnej tabeli huba. Wariant A łamałby K-01.                                                                                                                                                                                                                             |
| `total` retencji liczy wiersze bez powodu                                                                | naprawione w plikach I0, lista → S1        | `retentionStats` i karta `/admin/monetization`: wszystkie liczby tylko z wierszy z powodem; test w `pricingRules.test.ts` (plik dopisany do manifestu I0). `RetentionFeedbackList` i zapytanie `RetentionTab` - Z-08.                                                                                                                                                                                                                                                                                                                                 |
| Kolumny `crm_leads`/`crm_tasks` zapisywalne przez personel                                               | przekazane do S4 (Z-06)                    | Bez zmiany DDL I0 (addytywny kontrakt §4.3; topologia pisarzy S-D i pierwszeństwo AD-11 należą do S4).                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Kaskady księgi MRR przy usunięciu konta                                                                  | przekazane do S2 i właściciela SPEC (Z-07) | Bez zmiany DDL I0: decyzja RODO, a sama zmiana FK nie domyka ścieżki `deleteMyAccount`; S2 jako pierwszy pisarz zmienia FK bez migracji danych.                                                                                                                                                                                                                                                                                                                                                                                                       |

### Kryteria akceptacji I0 (SPEC §8.3)

- [x] 6 migracji ≤ 45 KiB, idempotentne, nagłówki PL; pgTAP `hub_schema_rls_test`, `hub_shared_helpers_test` zielone; `check:sql-*`, `check:types-freshness`, `check:on-conflict-arbiters` zielone.
- [x] `hubKeyFactories.test.ts` (kształt fabryki = dawny literał); `queryKeyLiterals.gate.test.ts` zielony z listą długu (41).
- [x] `hubEventCatalog`, `revenueInvalidation`, `slowInvalidation`, `invalidationExtension` zielone.
- [x] Trasy renderują zaślepki; nieznana zakładka i `overview` jako `$tab` = 404; heads sekcyjne; `adminRouteAuthority` zielony; autor dostaje powiadomienie roli (zaślepka `RoleGateNotice` do S6 - §3).
- [x] `search.test.ts`, `window.test.ts` (UTC i Europe/Warsaw, `custom` włącznie, `ltm`, CEST→CET bez przesunięcia doby); parytety limitów, segmentów, cyklu życia, `METERING_DEFAULTS`.
- [x] `hubDelivery.gate.test.ts` zielony na migracjach I0 i czerwony na fiksturach (funkcja bez właściciela, zły blok, brak REVOKE, REVOKE bez `authenticated` dla funkcji wewnętrznej/serwisowej/wyzwalacza, panel bez jawnego GRANT, definicja bez `public.`, GRANT na listę funkcji i `ON ALL FUNCTIONS`, GRANT dla serwisowej, zły CIALO-Z); lista strażnika pgTAP `hub_grants` = rejestr.
- [ ] Pomiar bundla: entry ≤ +0,6 i `public` ≤ +0,3 - **niespełnione** (+2,0 / +3,0), progi twarde zielone, wynik w §8 - decyzja orkiestratora (Z-05).
- [ ] Po scaleniu: M0 (§4) i `post-deploy` zielony - do wykonania po scaleniu.

## 10. Dziennik wdrożeń

| Data       | Wycinek / fala | Wersje migracji             | Bliźniaki drizzle | `post-deploy`                       | Odchylenia / uwagi                   |
| ---------- | -------------- | --------------------------- | ----------------- | ----------------------------------- | ------------------------------------ |
| 2026-10-19 | I0 (gałąź)     | `20261020090000…090500` (6) | `0317…0322`       | - (przed scaleniem; czerwony do M0) | weryfikacja §9; Z-01…Z-09 do decyzji |
|            | M0             | `20261020090000…090500`     |                   |                                     |                                      |
