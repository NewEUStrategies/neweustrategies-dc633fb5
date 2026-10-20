# Hub „Przychód i lejek” (`/admin/revenue`) - wdrożenie wycinków, od I0 (2026-10-19)

Specyfikacja wiążąca: `docs/SPEC_MODUL_PRZYCHOD_LEJEK_2026-10-18.md` (dalej:
SPEC). Ten dokument jest dziennikiem wdrożenia całego huba (SPEC §8.5 pkt 6).
Każdy wycinek dopisuje swoją sekcję i wiersz w dzienniku (§10). Sekcje 1-9
opisują wycinek **I0 - fundament i kontrakt** (Integrator, otwarcie), sekcja
11 - wycinek **S6 - BI, rejestr wskaźników i zestaw UI huba**, sekcja 12 -
wycinek **S1 - moduły źródłowe**, sekcja 13 - stan po scaleniu PR #520
(`cb7a18df`, 2026-10-19) i kolejne kroki, sekcja 14 - uspójnienie benchmarków
S6 z pakietem Insidera, sekcja 15 - wycinek **S4 - CRM, automatyzacje
i społeczność (dane)**, sekcja 16 - wycinek **S2 - przychód i retencja**,
sekcja 17 - przekazanie na koniec sesji 2026-10-19, sekcja 18 - wycinek
**S3 - lejek i paywall czytelnika**, sekcja 19 - krok **I9a - nawigacja
i widoczność huba w panelu** (decyzja właściciela 2026-10-20), sekcja 20 -
wycinek **S5 - silnik ścieżek (backend)**, sekcja 21 - krok **I9b -
decyzje właściciela, część A: SQL i katalog** (segmenty przychodu, cennik
v6.2, RODO księgi MRR).

Gałąź `hub/i0`, baza `baec9c64` (`main` + cennik v6.2 + poprawki), worktree
bez commitów - commit robi orkiestrator.

## 1. Zakres I0

Cel I0: zamrozić wszystko, co w falach A-B byłoby plikiem współdzielonym,
i dostarczyć addytywny DDL (M0). Kod I0 nie czyta ani nie pisze nowych tabel.
Robią to dopiero wycinki S1-S5. Trasy huba są zaślepkami bez wpisu
w nawigacji (nawigację dokłada I9).

| Tor                    | Pliki tworzone                                                                                                                                                                                                                                                                                                                                                                                                                          | Pliki zmieniane                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A - SQL, typy, bramka  | `supabase/migrations/20261020090000…090500_hub_*.sql` (6), bliźniaki `drizzle/migrations/0318…0323_hub_*.sql` (bajt w bajt), `supabase/tests/hub_schema_rls_test.sql` (58 asercji), `supabase/tests/hub_shared_helpers_test.sql` (27, w tym strażnik `hub_grants`), `src/lib/ci/hubDelivery.ts`, `src/lib/ci/__tests__/hubDelivery.gate.test.ts`                                                                                        | `drizzle/migrations/meta/_journal.json` (idx 318-323 po renumeracji `4549a6f1`, pierwotnie 317-322), `src/integrations/supabase/types.ts` (22 tabele, kolumny 7 tabel, `tier_rank_of`, `metering_defaults`), `src/lib/admin/retentionStats.ts` + `src/lib/admin/__tests__/pricingRules.test.ts`, `src/routes/admin.monetization.tsx` (`reason_label: string \| null`, liczby tylko z wierszy z powodem) |
| B - fabryki i kontrakt | `src/lib/revenue/{keys,search,window,segments,limits,money,rpcCallable}.ts`, `src/lib/journeys/{keys,limits,editorSearch}.ts`, `src/lib/crm/{keys,lifecycle}.ts`, `src/lib/newsletter/keys.ts`, `src/lib/access/{keys,meteringDefaults}.ts`, `src/lib/retention/keys.ts`, `src/lib/admin/{workflowKeys,couponKeys}.ts`, `src/lib/analytics/semantic/benchmarks/types.ts` + testy (`hubKeyFactories`, `queryKeyLiterals.gate`, parytety) | `src/lib/billing/keys.ts`; sieroty długu literałów: `components/admin/members/{MemberBillingDetails,MemberTierDialog,MembersDirectoryPanel}.tsx`, `components/admin/monetization/organisms/AdminMonetizationLedger.tsx`, `routes/profile.organization.tsx`                                                                                                                                              |
| C - szyna zdarzeń      | `src/lib/realtime/eventInvalidationMap.admin.ts`, `src/lib/revenue/syncManifest.ts`, testy `realtime/__tests__/{hubEventCatalog,revenueInvalidation,slowInvalidation,invalidationExtension}.test.ts`, `revenue/__tests__/syncManifest.test.ts`                                                                                                                                                                                          | `src/lib/realtime/{domainEvents,eventInvalidationMap,useModuleRealtime}.ts`, `realtime/__tests__/eventInvalidationMap.test.ts`, `realtime/__tests__/useModuleRealtime.test.tsx` (Integrator), `src/routes/admin.tsx`                                                                                                                                                                                    |
| D - trasy i zaślepki   | `src/routes/admin.revenue{,.index,.$tab}.tsx`, `src/routes/admin.revenue_.journeys.$journeyId.tsx`, `components/admin/revenue/{organisms/RevenueHubLayout,atoms/RevenueTabPending,tabs/RevenueTabOutlet}.tsx`, 11 zakładek `tabs/Revenue*Tab.tsx`, `components/admin/journeys/editor/JourneyEditorRoute.tsx`, `src/lib/i18n-admin-revenue.ts`, `src/routes/__tests__/adminRevenueHubRoutes.test.tsx`                                    | `src/routeTree.gen.ts` (4 trasy), `src/lib/admin/adminNav.ts` (`isCompactSidebarRoute`), `src/routes/__tests__/adminRouteAuthority.gate.test.ts`, `src/__tests__/i18nParity.gate.test.ts`, `reports/i18n-parity.json` (raport bramki)                                                                                                                                                                   |
| E - proces             | `scripts/hub-slice-guard.ts`, ten dokument                                                                                                                                                                                                                                                                                                                                                                                              | `src/lib/ci/hubDelivery.ts` (Integrator: manifest I0 += `useModuleRealtime.test.tsx`)                                                                                                                                                                                                                                                                                                                   |

Pełna lista: `git status --short --untracked-files=all` (98 ścieżek; manifest
I0 w `HUB_SLICE_MANIFESTS.I0` pokrywa każdą - `hub-slice-guard I0` zielony,
§7).

## 2. Decyzje właściciela

### 2.1 D-01..D-12 (SPEC §9.3) - przyjęte wartości domyślne

| ID   | Decyzja                                  | Wartość przyjęta w I0                                                                              | Termin ostateczny                                                                                                     |
| ---- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| D-01 | Lista etapów `lifecycle_stage`           | 9 etapów z §4.3 (`subscriber` … `other`), kolejność SQL = `LIFECYCLE_STAGES`                       | I0 - zamknięte                                                                                                        |
| D-02 | Aktywacja i TTV                          | „brak definicji” w UI, bez `MetricId`                                                              | S7                                                                                                                    |
| D-03 | Limit maili marketingowych i cisza nocna | 3 / 7 dni (`journey_settings.marketing_cap_per_7d DEFAULT 3`), 21:00-08:00 Europe/Warsaw           | S5                                                                                                                    |
| D-04 | Kategoria maili porzuconej kasy          | marketing (ze zgodą)                                                                               | S5                                                                                                                    |
| D-05 | Backfill kwot subskrypcji przez API      | nie; `basis='catalog'` jawnie                                                                      | S2                                                                                                                    |
| D-06 | Kto wprowadza plan MRR i koszty          | admin (`revenue_manual_inputs` czyta tylko admin); bez danych = „brak danych”                      | S2/S7                                                                                                                 |
| D-07 | Polityka oferty retencyjnej              | istniejące `retention_settings`                                                                    | S2                                                                                                                    |
| D-08 | Ratchet budżetu bundla                   | **wariant B**: leniwe karty i zakładki, bez ratchetu; `check-bundle-size.ts` i baseline nietknięte | I0 zakres, I9 liczby; **rozstrzygnięta 2026-10-19** (§11.2): ratchet `overall` 4879 → 4959 (`35c22b7b`, I0 + S6 + S1) |
| D-09 | Przekierowanie `/admin/monetization`     | 14 dni bez rozjazdu `reconcileAll`                                                                 | I9                                                                                                                    |
| D-10 | Domyślna osoba dla zadań bez właściciela | brak (reguła diagnostyki)                                                                          | S4                                                                                                                    |
| D-11 | Recenzent EN benchmarków i szablonów     | agent redakcyjny + akceptacja właściciela                                                          | S6, S5                                                                                                                |
| D-12 | Kolejność względem cennika v6.2          | spełnione: cennik scalony (`47ed79c7`, `baec9c64`); wdrożenie cennika przed M0                     | I0 - zamknięte                                                                                                        |

### 2.2 Nowe zgłoszenia do właściciela (powstały w I0)

| ID   | Zgłoszenie                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Stan w I0 (bezpieczna wartość)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Termin                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Z-01 | **Segmenty przychodu dla partnerów.** Kontrakt SPEC liczy jako `other` warstwy `partner`, `partner_general`, `presidents_circle`, `ngo`, `vip`, `reader`, `supporter` i jednorazowy `decision_lab`. Partnerzy instytucjonalni nie trafiają więc do `b2b_institution`, a `ngo` nie trafia do `b2c_reduced`.                                                                                                                                                                                                                                                                              | Mapa SPEC bez zmian (`revenue_segment_of_tier` w `090500` = `REVENUE_SEGMENT_BY_TIER`). Zmiana = 1 linia SQL + 1 linia TS, pilnowana testem `segmentsParity`. Wymaga decyzji przed S2, bo wtedy segment zapisuje się w `mrr_movements` historycznie.                                                                                                                                                                                                                                                                                                                                                                      | przed S2 - **zamknięte w I9b** (§21.2: mapa z typu klienta, historia przeliczona)     |
| Z-02 | **Rozszerzona sygnatura `_log_emit_error`.** W PL/pgSQL `SQLSTATE`/`SQLERRM` istnieją tylko w handlerze TEJ SAMEJ funkcji, więc trójargumentowy helper z SPEC nie mógłby zapisać błędu. Sygnatura: `_log_emit_error(p_tenant uuid, p_source text, p_event_type text, p_sqlstate text DEFAULT NULL, p_error text DEFAULT NULL)`. Wywołanie trójargumentowe z SPEC nadal działa. Emitery S1-S5 przekazują `SQLSTATE, SQLERRM`. Bez komunikatu zapisuje się `'unknown'`. Komunikat > 2000 znaków nie jest przycinany - zapisuje się znacznik `'message_too_long'` z zachowanym `sqlstate`. | Wdrożone w `090500`, przypięte pgTAP (`hub_shared_helpers_test`). Kontrakt dla emiterów S1-S5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | informacyjne                                                                          |
| Z-03 | **Odczyt `domain_event_emit_errors` bez `is_nes_staff()`.** Gałąź `is_nes_staff() OR (…)` z SPEC nie wiąże najemcy (prawda dla redaktora dowolnego najemcy), więc dawałaby odczyt awarii wszystkich najemców.                                                                                                                                                                                                                                                                                                                                                                           | Polityka: wyłącznie admin najemcy z sesji, własne wiersze. Wiersze bez najemcy czyta tylko `service_role` (server fn z bramką sztabu - S7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | przed S7                                                                              |
| Z-04 | **Próg budżetu `overall`.** Po I0 zostało 12,0 KB zapasu (4867,0/4879). Cele fali A (S1-S6) z §8.6 to łącznie ok. +36 KB, a cały plan huba ok. +106 KB. Wariant B (leniwe karty) nie zmniejsza `overall`, bo bramka liczy wszystkie chunki.                                                                                                                                                                                                                                                                                                                                             | Bez ratchetu (D-08 B). **Fala A nie zmieści się w progu** bez decyzji o ratchecie `overall` albo cięć poza hubem.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | przed falą A - **zamknięte**: D-08, ratchet `overall` 4879 → 4959 (`35c22b7b`, §12.7) |
| Z-05 | **Cele I0 dla `entry` i `public` przekroczone** (§8): entry +2,0 KB (cel ≤ +0,6), public +3,0 KB (cel ≤ +0,3). Progi twarde zielone, zapas entry 34 KB, public 121 KB.                                                                                                                                                                                                                                                                                                                                                                                                                  | Bez przenoszenia reguł rdzenia do rozszerzenia panelu (zmiana kontraktu `invalidationExtension`) - decyzja orkiestratora.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | przed scaleniem I0                                                                    |
| Z-06 | **Kolumny huba w `crm_leads` i `crm_tasks` zapisywalne przez personel.** `authenticated` ma tabelowe INSERT/UPDATE na obu tabelach (20260630053403, 20260721120000), a polityki personelu przepuszczają admina, redaktora i autora. Bez strażnika redaktor zmienia przez PostgREST `user_id` (`admin_journey_enroll_test` z S5 ufa `crm_leads.user_id = auth.uid()`), `lifecycle_stage` z pominięciem pierwszeństwa AD-11 (billing jedynym pisarzem `customer`/`former_customer`) oraz `source`/`origin_ref` zadania (zajęty `origin_ref` = cichy brak zadania kroku automatyzacji).    | I0 bez zmian: addytywny DDL §4.3, a topologię pisarzy (S-D: `updateCrmLead` → historia) i pierwszeństwo projektuje S4 - strażnik w I0 zablokowałby ją z góry. **Wymóg dla S4 (`130000`):** strażnik BEFORE INSERT OR UPDATE albo wyłącznie RPC - zmiana tych kolumn tylko z SECURITY DEFINER/`service_role`, `customer`/`former_customer` tylko ze źródła billing; pgTAP: admin i redaktor nie zmieniają ich przez UPDATE/INSERT (42501).                                                                                                                                                                                 | przed S4                                                                              |
| Z-07 | **Księga MRR a usunięcie konta.** `auth.users` → `subscriptions` → `subscription_state_history` → `mrr_movements` (`history_id ON DELETE CASCADE`) i `dunning_cycles` kaskadują, a ruchy z backfillu (`history_id NULL`) i migawki zostają - z surowym `user_id`. Usunięcie konta zmienia wstecz zamknięte miesiące (fantomowe MRR, utracone cykle windykacji) i łamie niezmienniki S2 (§4.7: `start + Σ = end`, dryf 0).                                                                                                                                                               | I0 bez zmian (DDL = §4.3): to decyzja RODO (zachować ruchy z anonimizacją czy kasować), a sama zmiana FK nie domyka głównej ścieżki - `deleteMyAccount` kasuje subskrypcję przed webhookiem anulowania, więc ruch `churn` nie powstaje wcale. **Rekomendacja dla S2** (pierwszy pisarz, zmiana w jego bloku nie migruje danych): `history_id ON DELETE SET NULL`, `user_id` NULL-owalne z anonimizacją przy usunięciu konta (wzorzec 20260805090100), ruch `churn` przy DELETE subskrypcji z MRR > 0, backfill rozróżniany kolumną `backfilled`; pgTAP: usunięcie konta nie zmienia Σ `delta_minor` zamkniętych miesięcy. | przed S2 - S2 (§16.2), **domknięte w I9b** (§21.2: pełna anonimizacja, akceptacja)    |
| Z-08 | **Lista „ostatnie odpowiedzi” w `/admin/pricing?tab=retention`.** Po S2 wiersze bez powodu (`started`, `abandoned`) trafiają do `RetentionFeedbackList` jako puste wiersze z datą i zajmują miejsca w próbce `limit(100)`.                                                                                                                                                                                                                                                                                                                                                              | I0 poprawił liczby (`retentionStats`, karta w `/admin/monetization`: tylko wiersze z powodem; test w `pricingRules.test.ts`). **Do integracji → S1** (właściciel `RetentionTab` i `retentionFeedbackQueryOptions`): filtr `reason_label` NOT NULL w zapytaniu (limit nie zjada odpowiedzi) i na liście.                                                                                                                                                                                                                                                                                                                   | przed S2 - **zamknięte w S1** (§12.4)                                                 |
| Z-09 | **„Anuluj mimo to” przed wyborem powodu.** Karta S2 każe pokazywać ten przycisk zawsze, a CHECK I0 (zgodnie z §4.7) wymaga powodu dla `canceled`.                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Do decyzji S2:** przycisk zapisuje `canceled` z jawnym powodem z katalogu (np. „nie podano”) albo prosi o powód; zmiana CHECK tylko przez zgłoszenie do Integratora. `abandoned` bez powodu jest dozwolone od I0.                                                                                                                                                                                                                                                                                                                                                                                                       | przed S2                                                                              |

**Nowe materiały od właściciela (2026-10-19).** Właściciel dostarczył plik
„Insider marketingowy” (wcześniej pusty). To nowe źródło wiedzy dla huba.
Pakuje je równoległy agent do `docs/benchmarki/insider-2026-10-19/`
i `docs/WIEDZA_INSIDER_MARKETINGOWY_2026-10-19.md`. Tu tylko odnotowanie,
bez zgłoszenia `Z-` - użycie wiedzy w kodzie wejdzie z kolejnymi wycinkami.

## 3. Odchylenia od SPEC (fakty repozytorium wygrywają, kontrakt bez zmian)

| Miejsce SPEC                                    | Stan po I0                                                                                                                                                                                                                                                                                                                                                                | Uzasadnienie                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §8.5 pkt 1, §4.8 próg „> 20261018120400”        | Cennik v6.2 ma wersje `20261018160000…160400` i bliźniaki drizzle `0313…0317`. Bramka `hubDelivery` skanuje wyłącznie blok huba `[20261020090000, 20261020170000)`.                                                                                                                                                                                                       | Próg ze SPEC łapałby 7 funkcji spoza huba (cennik v6.2 + `release_coupon_order_lock`).                                                                                                                                                                                                                                                                                                    |
| §8.5 pkt 2 „bliźniaki drizzle od bota”          | Bliźniaki `0318…0323` są w I0, wpisy `_journal.json` idx 318-323, `when` = 1792419170669 + n·60 000 (po renumeracji `4549a6f1`; na gałęzi I0 były `0317…0322`, idx 317-322, `when` = 1792349760560 + n·60 000).                                                                                                                                                           | `check:migration-lanes` wymaga kopii w dzienniku drizzle dla każdego pliku pasa supabase od `20260911160000`. Cennik zrobił to samo.                                                                                                                                                                                                                                                      |
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
5. Bliźniaki drizzle `0318…0323` są kopiami bajt w bajt. Jeśli migrator
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

Numer bliźniaka nie jest rezerwacją. `main` dostaje wpisy dziennika także od
Lovable i innych prac. Tak stało się przed scaleniem PR #520: `main` dołożył
`0312_builder_experiment_events_tenant_id` (`97d936f4`). Scalenie `main`
(`a303246e`) zgubiło wpisy dziennika cennika v6.2, I0 i S1 - CI był czerwony
na `Migration lanes` i `supabaseLaneCoverage.test.ts`. Commit `4549a6f1`
przesunął bliźniaki o jeden numer bez zmiany treści: cennik `0313…0317`, I0
`0318…0323` (idx 318-323), S1 `0324…0328` (idx 324-328). Wpisy trafiły na
koniec dziennika z rosnącym `when`. Procedura przy każdym scaleniu, gdy
`main` zajął numer bliźniaka huba:

1. Zmień nazwy plików wycinka na kolejne wolne numery (`git mv`), bez zmiany treści.
2. W `_journal.json` przenieś wpisy wycinka na koniec: `idx` od ostatniego +1,
   `tag` = nowa nazwa bez `.sql`, `when` = ostatni `when` z `main` + n·60 000
   (ściśle rosnący - inaczej migrator pominie wpis po cichu).
3. `bun run check:migration-lanes` i `bun run scripts/hub-slice-guard.ts I0
--base origin/main` muszą być zielone. Manifest I0 trzyma bliźniaki pod
   jawną listą numerów - przy renumeracji zaktualizuj glob
   `drizzle/migrations/{0317,…}_hub_*.sql` w `hubDelivery.ts` (to samo dla
   globu S1). W `4549a6f1` tego nie zrobiono - Z-S1-02 (§12.5).

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

**Stan na 2026-10-19, po scaleniu PR #520 (`cb7a18df`).** Ostatni bliźniak to
`0328_membership_grants_single_path` (idx 328, `when` = 1792419770669).
Bliźniaki huba: I0 `0318…0323`, S1 `0324…0328`. **Następny wolny numer:
`0330`** (idx 330; `0329_pr520_deployment_completion` dołożył Lovable w
`e6620f60`, `when` = 1792426305539). Ten numer nie jest rezerwacją dla
żadnego wycinka. `main` dokłada własne migracje (np. `0312` z `97d936f4`),
więc numer nadaje Integrator przy scaleniu wycinka - pierwszy wolny na `main`
w tej chwili, w kolejności wersji.

**Po scaleniu S4 (2026-10-19, gałąź `claude/elegant-fermat-xwfca1`).**
Bliźniaki S4 `0330…0337` (idx 330-337, `when` = 1792426365539 +
n·60 000, §15.6). **Następny wolny numer: `0338`** (idx 338) - na
`origin/main` w chwili scalenia ostatni był `0329`.

**Po scaleniu S2 (2026-10-19, ta sama gałąź).** Bliźniaki S2 `0338…0345`
(idx 338-345, `when` = 1792426845539 + n·60 000, §16.6) - numerami za S4,
choć wersje S2 (`2026102011*`) są niższe niż S4 (`2026102013*`); oba
wycinki nie dzielą obiektów. **Następny wolny numer: `0346`** (idx 346).

**Po scaleniu S3 (2026-10-20, gałąź PR odtworzona od `main` po #527).**
`0346_pr527_deployment_completion` dołożył Lovable na `main` (potwierdzenie
wdrożenia #527, `when` = 1792476373912). Bliźniaki S3 `0347…0351` (idx
347-351, `when` = 1792476373912 + n·60 000, §18.6). **Następny wolny numer:
`0352`** (idx 352).

**Po scaleniu S5 (2026-10-20, ta sama gałąź).** Bliźniaki S5 `0352…0357`
(idx 352-357, `when` = 1792476673912 + n·60 000, §20.6); `main` bez nowych
migracji drizzle (ostatni `0346`). **Następny wolny numer: `0358`** (idx 358).

Praktyka PR #520 (odchylenie od pkt 3-4): S6 i S1 poszły prosto do PR #520,
bez `hub/integration`. Integrator S1 dodał bliźniaki i wpisy dziennika
w commicie wycinka (D-S1-01, §12.6). Tak samo dla wycinków w nowym PR
(§13): Integrator dokłada bliźniaki przy scaleniu wycinka do gałęzi PR. Po
każdym `git merge origin/main` sprawdza `_journal.json`, bo merge potrafi
zgubić wpisy (`4549a6f1`), i uruchamia `bun run check:migration-lanes`.
Przy renumeracji aktualizuje globy bliźniaków w `hubDelivery.ts` (§4.4
pkt 3, Z-S1-02).

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
| bliźniaki `cmp supabase ⇄ drizzle 0318…0323`                                                                                                                                                                                     | ✓ bajt w bajt                                                                                                                                         |
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

**Po scaleniu (2026-10-19, `cb7a18df`).** Pełny lokalny pgTAP
(`run.sh all`, uruchomił orkiestrator) potwierdził I0 na stanie `main`:
`hub_schema_rls_test` 58/58, `hub_shared_helpers_test` 27/27. Wynik całego
przebiegu i błędy środowiska - §13.2.

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

| Data       | Wycinek / fala                                        | Wersje migracji             | Bliźniaki drizzle | `post-deploy`                                                                                                                                                                                                        | Odchylenia / uwagi                                                                                                                                                                                      |
| ---------- | ----------------------------------------------------- | --------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-19 | I0 (gałąź)                                            | `20261020090000…090500` (6) | `0318…0323`       | - (przed scaleniem; czerwony do M0)                                                                                                                                                                                  | weryfikacja §9; Z-01…Z-09 do decyzji                                                                                                                                                                    |
|            | M0                                                    | `20261020090000…090500`     | `0318…0323`       | wdrożone 2026-10-19 przez Lovable migratorem Drizzle razem z cennikiem v6.2 i S1 (0313…0328; potwierdzenie `0329_pr520_deployment_completion`, commit `e6620f60`)                                                    | `post-deploy` na `e6620f60` ✓ (kroki kontraktu pominięte bez sekretów - do potwierdzenia `workflow_dispatch`)                                                                                           |
| 2026-10-19 | S6 (gałąź `hub/s6` → PR #520)                         | brak (S6 bez SQL)           | brak              | - (bez migracji)                                                                                                                                                                                                     | §11: wpięcia RPC odłożone (Z-S6-16, Z-S6-17); `overall` +53,9 → ratchet D-08; `public` +0,9 uzasadnione (Z-S6-18)                                                                                       |
| 2026-10-19 | S1 (prosto do PR #520 → `main` `cb7a18df`)            | `20261020100000…100400` (5) | `0324…0328`       | do wdrożenia przez właściciela - po M0, przed publikacją frontu (§12.9)                                                                                                                                              | §12: kod i migracje w jednym PR (odchylenie od §8.5 pkt 3); Z-S1-01…Z-S1-12                                                                                                                             |
| 2026-10-19 | S4 (gałąź PR `claude/elegant-fermat-xwfca1`)          | `20261020130000…130700` (8) | `0330…0337`       | do wdrożenia przez właściciela - po M0 i S1, nocą, razem z publikacją frontu (§15.9)                                                                                                                                 | §15: kod i migracje w jednym PR; `overall` +9,9 → ratchet D-08 4982; otwarte Z-S4-02, -07, -09…-14                                                                                                      |
| 2026-10-19 | S2 (gałąź PR `claude/elegant-fermat-xwfca1`)          | `20261020110000…110700` (8) | `0338…0345`       | do wdrożenia przez właściciela - po M0, nocą (ALTER księgi, wyzwalacze na `subscriptions`/`billing_documents`), razem z publikacją frontu (§16.9)                                                                    | §16: kod i migracje w jednym PR; `overall` +9,0 → ratchet D-08 4991; Z-S2-01 (weryfikacja ręczna w trybie testowym) otwarte; pełny vitest - CI PR #527                                                  |
| 2026-10-20 | S3 (gałąź PR `claude/elegant-fermat-xwfca1` po #527)  | `20261020120000…120400` (5) | `0347…0351`       | do wdrożenia przez właściciela - po M0, S1, S2 i S4, nocą (wyzwalacze na `profiles` i `payment_orders`), razem z publikacją frontu (§18.9)                                                                           | §18: kod i migracje w jednym PR; `overall` +5,8 → ratchet D-08 4997; `public` +5,4 przy celu +1,2 (Z-S3-01); otwarte Z-S3-01…07; pełny vitest i e2e - CI nowego PR                                      |
| 2026-10-20 | I9a (gałąź PR, fast-forward z `hub/i9a-nawigacja`)    | brak (bez SQL)              | brak              | - (bez migracji; publikacja frontu wystarcza - kolumna okna porzucenia jest z M0)                                                                                                                                    | §19: nawigacja huba przed I9 (decyzja właściciela), stany „w przygotowaniu”, okno porzucenia kasy w panelu; `overall` +6,2 → ratchet D-08 5003; `public` −0,7                                           |
| 2026-10-20 | S5 (gałąź PR, fast-forward z `hub/s5-silnik-sciezek`) | `20261020140000…140500` (6) | `0352…0357`       | do wdrożenia przez właściciela - po M0 i S1-S4, nocą (wyzwalacz na `domain_events`), razem z publikacją frontu; silnik wyłączony; M3 po I9 (§20.9)                                                                   | §20: silnik bez UI (S8), runner do `jobs-tick` w I9; bez ratchetu (`overall` −1,8 - szum hashy); otwarte Z-S5-01…08                                                                                     |
| 2026-10-20 | I9b część A (gałąź `hub/i9b-decyzje`)                 | `20261020160000…160400` (5) | krok C            | do wdrożenia przez właściciela - po S2 (segmenty i RODO działają też bez S2 jako no-op), nocą (wyzwalacze na `subscriptions`, `auth.users`, `member_organizations`, `organization_seats`; UPDATE `membership_tiers`) | §21: decyzje właściciela 2026-10-20 (zgoda delegowana) - segmenty z typu klienta, cennik v6.2 (Zespół, NGO, 3-20 miejsc), RODO księgi MRR                                                               |
| 2026-10-20 | I9b część B (gałąź `hub/i9b-decyzje` po A2)           | `20261020160800` (1)        | krok C (`0366`)   | do wdrożenia przez właściciela - po S4 i S5 i po bliźniaku z kroku C; same redefinicje funkcji (bez blokad gorących tabel), razem z publikacją frontu (§22.6)                                                        | §22: limit tagu 64 (Z-S5-02), linia okna kasy przy biletach (Z-S3-07), wpis `engagement_rate` (Z-14-03), akceptacje Z-S3-01, Z-S3-06, D-11/Z-S6-14, Z-14-01/02; Z-S2-01 zawężone do 3 kroków wizualnych |

## 11. Wycinek S6 - BI, rejestr wskaźników i zestaw UI huba (2026-10-19)

Gałąź `hub/s6`, baza `a90e66c4` (`main` + cennik v6.2 + I0), worktree bez
commitów - commit robi orkiestrator. Decyzja orkiestratora 2026-10-19: S6
trafia bezpośrednio do PR #520, PRZED migracjami S1-S4, a Integrator S6
wykonuje zgłoszenia „Do integracji” tego wycinka (§11.4). S6 nie ma SQL.

### 11.1 Zakres

| Obszar                    | Co dostarcza S6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rejestr wskaźników        | `metrics.ts`: 88 metryk (18 + 70 z SPEC §5.5), każda z jednym bindingiem `authoritative`, definicją PL/EN i guardem; `METRIC_GROUP`, `HUB_METRIC_IDS`. `streams.ts`: `STREAMS` (6, zakres `analytics_semantic_snapshot`) + `HUB_STREAMS` (`billing`, `lifecycle`, `community`) = `ALL_STREAMS` (9). `format.ts`: kwoty, miesiące, dni, godziny i krotność przez `Intl`. CTOR: etykieta `email_ctr` + nowa `email_ctr_delivered`.                                                                   |
| Migawka przychodu         | `revenueRaw.ts` (kontrakt jsonb `*_KEYS`, parsery tolerancyjne, `null` ≠ 0) i `revenueSnapshot.functions.ts` (`getRevenueSnapshot`: rola z sesji, editor bez RPC finansowego, kwoty per waluta, uzgodnienie księga ⇄ zamówienia). Wpięcia pięciu RPC odłożone do właścicieli (§11.3, Z-S6-16).                                                                                                                                                                                                     |
| Benchmarki                | Importer `scripts/benchmarks/import-benchmarks.ts`; dane `docs/benchmarki/2026-10-18/*.json` (kopie `*_fixed.json`) + nakładki `*.overlay.json` (EN, dźwignie PL/EN, metadane kontekstów, mapa metryk). Wygenerowane `groups/*.server.ts`, `sources.ts`, `index.ts`: 76 wpisów, 191 kontekstów, 958 pasm, 172 źródła kanoniczne, 185 aliasów i 3 odrzucone (= 188 wpisów źródłowych). `evaluate.ts`, `consistency.ts`, `adapter.ts`, `metricHelp.ts`, `getBenchmarkGroup` (treść tylko z serwera). |
| Objaśnienia i skala       | Atomy `MetricHelpButton`, `BenchmarkTierBadge`, `BenchmarkContextSelect`, `SourceCitation`; molekuły `MetricExplainer` (popover ≥ 640 px / arkusz < 640 px), `BenchmarkScale`, `MetricDefinitionPopover`; hook `useBenchmark`; organizm `MetricDictionary` (filtr grup, ocena, pewność, stan na, wpisy bez `MetricId` z powodem).                                                                                                                                                                  |
| BI i komponenty analityki | `KpiTile` (`metricId`, `benchmark`, `money`, `drillHref`, `lockedReason`; D9/D10), `biChart` (metryka, pasmo, źródła, pochodzenie), `FunnelBars` + `AdsFunnelBars` (nakładka), sekcja `RevenueInsightSection` na `/admin/analytics/bi` (leniwa, tylko admin i editor, `?metric=`), `adminPageHead` sekcyjny (D14).                                                                                                                                                                                 |
| Powłoka huba              | `RevenueHubLayout` (zamiast zaślepki I0), `hubTabs.ts` (`REVENUE_AREAS`, `REVENUE_SEVERITIES`, zakładki), 4 atomy i 7 molekuł `components/admin/revenue/`, `i18n-admin-revenue-shell.ts`, `DashboardPeriodTabs` z propem `periods`.                                                                                                                                                                                                                                                                |
| Naprawy brief 04          | D1 (`waterfall.ts` pole `level` + konsumenci - §11.4), D9/D10 (`KpiTile`), D13 (`TimeRangeFilter` + `resolveCalendarWindow`), D14 (BI).                                                                                                                                                                                                                                                                                                                                                            |

### 11.2 Decyzje

- **D-08 rozstrzygnięta 2026-10-19** (zastępuje wariant B z §2.1): limity
  `overall` i `css` orkiestrator podnosi przy scaleniu o przyrost zmierzony
  w §11.6. `public`, `publicCss`, `chunk` i `boot` zostają zamrożone.
- **D-11:** druga lektura EN benchmarków zrobiona w torach T2 i T3.
  Akceptacja właściciela - Z-S6-14. **Zamknięte 2026-10-20 (I9b, §22.2 B6):
  akceptacja EN benchmarków, 76 zestawów dźwigni i szablonów S5 (zgoda
  delegowana).**
- **Wpięcia RPC (Integrator S6):** odłożone do wycinków-właścicieli (§11.3).
  Oba sprawdzenia kontraktu TS ⇄ SQL i pgTAP `ts_sql_contract` są zielone
  przed migracjami S1-S4.

### 11.3 Odchylenia od SPEC (kontrakt bez zmian, fakty repozytorium wygrywają)

| Miejsce SPEC / karta S6                                 | Stan po S6                                                                                                                                                                                                                                                                                                                                                                                                       | Uzasadnienie                                                                                                                                                                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §5.2 „`getRevenueSnapshot` woła 5 RPC”                  | Scalanie, role, parsery i obsługa błędów są w S6. Pięć wywołań stoi w `REVENUE_DOMAIN_READS` jako `null`, więc każda domena ma stan `not_configured`. Kafle pokazują wtedy kreskę, a sekcja BI informuje, że źródło nie jest jeszcze podłączone. Docelowe wpięcia (literał nazwy, klucze argumentów) przypina `WPIECIA_DOCELOWE` w `snapshot.functions.test.ts`. Na nich biegnie test scalania i rejestru żądań. | Literał wywołania funkcji, której nie tworzy żadna migracja, czerwieni `check:rpc-contract` i pgTAP `ts_sql_contract` całego PR #520. W przeglądarce dawałby PGRST202. Wpięcie trafia do commitu, w którym migracja właściciela tworzy funkcję (Z-S6-16). |
| §5.5 „188 źródeł z unikalnym URL https”                 | Rejestr kanoniczny po znormalizowanym URL: 172 źródła, 185 aliasów `<grupa>:<id>` i 3 źródła odrzucone z powodem.                                                                                                                                                                                                                                                                                                | W danych badaczy ten sam URL występuje pod różnymi id, a lokalne `S<n>` kolidują między grupami (PLAN S6 V3).                                                                                                                                             |
| §6.1 `BenchmarkScale` „5 równych segmentów”             | N segmentów równej szerokości (3-7, tyle ile pasm w kontekście) i 5 kropek oceny.                                                                                                                                                                                                                                                                                                                                | 10 kontekstów `target_range` ma 3, 4, 6 albo 7 pasm (V5, AD-20: pasma porządkowe o równej szerokości).                                                                                                                                                    |
| §5.5 „9 strumieni”                                      | `STREAMS` zostaje 6, nowe `HUB_STREAMS` (3) i `ALL_STREAMS` (9); `streamById` szuka w `ALL_STREAMS`.                                                                                                                                                                                                                                                                                                             | `StreamHealthGrid` i `getSemanticSnapshot` iterują `STREAMS` - 9 dałoby fałszywe „odczyt nie powiódł się” dla strumieni huba (V11, Z-S6-07).                                                                                                              |
| `SEM/benchmarks/types.ts`                               | `BenchmarkEvaluation` w `evaluate.ts` (`band` = `EvaluatedBand`); `displayUnit` jako `GeneratedContext` w `adapter.ts`.                                                                                                                                                                                                                                                                                          | `types.ts` należy do I0 (V2, Z-S6-04).                                                                                                                                                                                                                    |
| `CH/status.ts` „funkcje oceny 5-stopniowej”             | Ocena w `src/lib/charts/benchmarkTier.ts` (Integrator S6), `status.ts` bez zmian względem bazy.                                                                                                                                                                                                                                                                                                                  | `status.ts` jedzie we wspólnym chunku wykresów publicznych, a eksport użyty przez admina zostaje w nim - kod ocen trafiał do `public` (§11.6). Test granicy: żaden moduł `components/charts` i `lib/charts` nie importuje ocen.                           |
| D1 „`down ? from : to`”                                 | Pole `level` w modelu (+ `waterfallLevel`), dymek i tabela czytają `level`.                                                                                                                                                                                                                                                                                                                                      | `to` jest geometrią (łączniki) - zmiana jego znaczenia zerwałaby rysunek (V13).                                                                                                                                                                           |
| D9/D10 `KpiTile`                                        | Nowa delta (`Intl`, baza 0 = „-”) dla kafli z `metricId`; kafle bez `metricId` bez zmian.                                                                                                                                                                                                                                                                                                                        | `kpiTile.test.tsx` (poza manifestem) przypina stary format w 5 asercjach, a kafle bez `lang` w 7 dashboardach i plikach S1 dostałyby polski format w EN (Z-S6-01).                                                                                        |
| D13 `getSemanticSnapshot` „przyjmuje `fromDate/toDate`” | Kontrakt server fn bez zmian: konsument zamienia dni na okno `resolveCalendarWindow` i wysyła granice na północy UTC. Test w `snapshot.functions.test.ts` dowodzi braku przesunięcia dnia.                                                                                                                                                                                                                       | `snapshot.functions.ts` jest poza manifestem S6. Łatka wejścia `fromDate/toDate` czeka jako opcja (Z-S6-15).                                                                                                                                              |
| §6.5 `MetricTooltip` „zmienia”                          | Bez zmian.                                                                                                                                                                                                                                                                                                                                                                                                       | Komponent wykresów publicznych - delta `public` (V16, Z-S6-10).                                                                                                                                                                                           |
| §6.1 nagłówek huba „`WindowProvenance`”                 | Zakres huba formatowany z LOKALNYCH dat (`ProvenanceNote`, layout).                                                                                                                                                                                                                                                                                                                                              | `WindowProvenance` tnie `iso.slice(0, 10)` - dla okien huba na lokalnej północy pokazałby dzień wcześniej (V22, Z-S6-07).                                                                                                                                 |
| §6.1 liczniki zakładek                                  | Slot `badges` w nawigacji, w S6 pusty.                                                                                                                                                                                                                                                                                                                                                                           | Dane z S7 i S5 jeszcze nie istnieją (V24, Z-S6-08).                                                                                                                                                                                                       |
| `docs/benchmarki/2026-10-18/*.json`                     | Te same dane przeformatowane Prettierem (treść identyczna po `JSON.parse`).                                                                                                                                                                                                                                                                                                                                      | `prettier --check .` obejmuje `docs/**/*.json` (V27).                                                                                                                                                                                                     |

### 11.4 Zgłoszenia „Do integracji” wykonane przez Integratora S6

Jedyne naruszenie strażnika wycinka to plik współdzielony
`src/lib/ci/hubDelivery.ts` (rozszerzenie manifestu S6) oraz ten dokument
(plik I0/I9) - oba są zmianami integratorskimi.

| ID              | Zmiana                                                                                                                                                                                                                                  | Pliki                                                                                                              | Dowód                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Z-S6-06         | Kontrakt TS ⇄ SQL zielony przed migracjami S1-S4: wpięcia RPC odłożone (`REVENUE_DOMAIN_READS`, `revenueSnapshotHandler(ctx, reads)`), stan produkcyjny i każde przyszłe wpięcie pod testem (wpięcie produkcyjne = wywołanie docelowe). | `revenueSnapshot.functions.ts`, `snapshot.functions.test.ts`                                                       | `check:rpc-contract` ✓ (796 nazw), `check:ts-sql-contract` ✓ (918 wywołań RPC), pgTAP `ts_sql_contract` 9/9              |
| -               | Sekcja BI mówi wprost, że źródło nie jest jeszcze podłączone (`adminAnalytics.bi.revenue.sourcesPending`, PL/EN), zamiast samych kresek.                                                                                                | `RevenueInsightSection.tsx`, `i18n-admin-analytics.ts`, test sekcji                                                | 2 nowe testy zachowania                                                                                                  |
| Z-S6-02         | D1 dociera do ekranu: dymek mostka (`CartesianChart.tsx`) i tabela danych (`Chart.tsx`) czytają `level` (poziom PO kroku), nie krawędź `to`.                                                                                            | `src/components/charts/{CartesianChart,Chart}.tsx`, nowy `src/components/charts/__tests__/waterfallLevel.test.tsx` | spadek −5 z poziomu 120: dymek i tabela „115” (wcześniej „120”); `src/components/charts` + `src/lib/charts` 2684 testy ✓ |
| `public`        | Ocena 5-stopniowa poza `status.ts` (chunk wspólny z wykresami publicznymi).                                                                                                                                                             | nowy `src/lib/charts/benchmarkTier.ts` + `__tests__/benchmarkTier.test.ts`; `status.ts` i `status.test.ts` = baza  | §11.6: 0 nowych modułów w chunkach publicznych                                                                           |
| Z-S6-01 (część) | Manifest `HUB_SLICE_MANIFESTS.S6` += `src/components/charts/{CartesianChart,Chart}.tsx`, `src/components/charts/__tests__/waterfallLevel.test.tsx`, `benchmarkTier` w globach `src/lib/charts/`.                                        | `src/lib/ci/hubDelivery.ts` (plik współdzielony)                                                                   | `hubDelivery.gate.test.ts` 49/49; strażnik: wyłącznie `[plik-wspoldzielony] src/lib/ci/hubDelivery.ts`                   |
| Z-S6-09         | `reports/i18n-parity.json` po przebiegu bramki parytetu - bez zmian (nowe klucze mają parytet).                                                                                                                                         | -                                                                                                                  | `git status` czysty dla `reports/`                                                                                       |
| Z-S6-03         | `@source not` dla treści benchmarków w `styles.css` - **niepotrzebne dziś**: arkusz publiczny bajt w bajt jak w bazie (560 809 B).                                                                                                      | -                                                                                                                  | `cmp` arkuszy `styles-*.css` baza ⇄ S6                                                                                   |
| Z-S6-13         | Ta sekcja i wiersz dziennika (§10).                                                                                                                                                                                                     | `docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md`                                                                     | -                                                                                                                        |

### 11.5 Zgłoszenia otwarte

| ID      | Zgłoszenie                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Właściciel / termin                                                                                                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Z-S6-16 | **Wpięcia RPC migawki** w `REVENUE_DOMAIN_READS` (`src/lib/analytics/semantic/revenueSnapshot.functions.ts`) w commicie migracji właściciela: `email` - S1 (`admin_revenue_email_health`), `snapshot` - S2 (`admin_revenue_semantic_snapshot`), `funnel` - S3 (`admin_revenue_funnel`, `p_track: "all"`), `events` i `clubs` - S4 (`admin_revenue_{events,clubs}_summary`). Treść wpięcia = `WPIECIA_DOCELOWE` z `snapshot.functions.test.ts`, np. `email: (c, w) => c.rpc("admin_revenue_email_health", { p_since: w.sinceIso, p_until: w.untilIso })`. Test „każde wpięcie produkcyjne woła SWOJĄ funkcję” pilnuje zgodności. Plik jest w manifeście S6, więc wpięcie robi Integrator przy scaleniu wycinka-właściciela.                                                                                                                               | Integrator przy scaleniu S1, S4, S2, S3. **Część S1 (`email`) niewykonana w PR #520** - Z-S1-01 (§12.5); część S4 (`events`, `clubs`) wykonana - §15.4; część S3 (`funnel`) wykonana - §18.4 |
| Z-S6-17 | **Kształt `admin_revenue_email_health` z S1 ≠ `REVENUE_EMAIL_KEYS` z S6.** S1 (`src/lib/revenue/email/parse.ts`, `EMAIL_HEALTH_KEYS`) oddaje `{since, until, campaigns{sent, delivered, unique_opens, unique_clicks, hard_bounces, soft_bounces, complaints, unsubscribes}, list{start, end, new, unsubscribed, net_growth}, doi{started, confirmed_7d}}`, a parser S6 czyta płaskie `delivered…`, `list_base`, `list_net_growth`, `doi_started`, `doi_confirmed`. Parser S6 jest tolerancyjny, więc wpięcie bez adaptera dałoby ciche „brak danych”. Przy Z-S6-16: wpięcie `email` spłaszcza kształt S1 (`campaigns.*` → pola płaskie, `list.start` → `list_base`, `list.net_growth` → `list_net_growth`, `doi.started`/`confirmed_7d` → `doi_started`/`doi_confirmed`) albo `parseRevenueEmailHealth` czyta kształt S1. Mianownik odbić: S1 ma `sent`. | Integrator przy scaleniu S1 → **otwarte**, razem z Z-S1-01                                                                                                                                   |
| Z-S6-18 | **Grupa chunków rdzenia wykresów.** Nowe leniwe wejścia panelu (`RevenueInsightSection`, `MetricExplainer`, `MetricDictionary`) sięgają `KpiTile` i ocen bez `ChartFrame`/`parse.ts`. Rolldown dzieli więc istniejące moduły publiczne na nowe chunki wspólne `i18n-charts`, `status` (+`smooth.ts`) i `roles`. Listy `__vite__mapDeps` w `app-initial` i chunkach wykresów dostają ich nazwy - to jest całe `public` +0,9 KB (§11.6). Grupa leniwej rodziny (`scripts/lib/clientChunkGroups.ts`, wzór `post-card`) dla `lib/charts/{parse,status,roles,smooth,seriesStyle}.ts` i `hooks/useRevealOnScroll.ts` oraz osobno `i18n-charts.ts` z `ChartFrame` przywróciłaby układ bazy. To zmiana globalnej konfiguracji podziału, poza zakresem wycinka.                                                                                                   | I9 / orkiestrator                                                                                                                                                                            |
| Z-S6-01 | D9 (koniec `+∞`, `Intl` z `lang`) jako zachowanie domyślne wszystkich kafli: przełączenie gałęzi `formatDeltaLegacy`, 5 asercji `kpiTile.test.tsx`, `lang` z i18n tam, gdzie dashboardy go nie podają; manifest: `kpiTile.test.tsx`, `timeRangeFilter.test.tsx`, `reconcile.test.ts`, `semanticInsights.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | I9                                                                                                                                                                                           |
| Z-S6-04 | `BenchContext.displayUnit?: "minutes" \| "days" \| "score"` w `benchmarks/types.ts` (dziś `GeneratedContext` w `adapter.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | I9                                                                                                                                                                                           |
| Z-S6-05 | Kontrakt jsonb `*_KEYS` z `revenueRaw.ts` i parametry RPC (`p_since`, `p_until`; lejek `p_segment`, `p_track`) dla S2, S3 i S4. Ułamki 0-1, kwoty `MoneyByCurrency[]` z `amount_minor`, `null` ≠ 0. Rozjazd = „brak danych”, nie błąd.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | S2, S3, S4 / Integrator przy scaleniu                                                                                                                                                        |
| Z-S6-07 | `StreamHealthGrid` (iteruje `STREAMS`) i `WindowProvenance` (`iso.slice(0, 10)`) - strumienie huba w BI i lokalne daty okien huba.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | I9                                                                                                                                                                                           |
| Z-S6-08 | Liczniki paska huba: slot `badges` w `RevenueHubLayout`, podpięcie `revenueFactsQueryOptions` (S7) i listy ścieżek (S5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | I9                                                                                                                                                                                           |
| Z-S6-10 | `MetricTooltip` (publiczny) bez przycisku „Więcej” - tylko za decyzją o `public`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | właściciel                                                                                                                                                                                   |
| Z-S6-11 | `HUB_SYNC_MANIFEST[*].metrics` z `HUB_METRIC_IDS` i `METRIC_GROUP`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | I9                                                                                                                                                                                           |
| Z-S6-12 | Kopie kafli (`admin.paywall.tsx`, `membership/atoms/KpiTile.tsx`, `AdminBiStrip.tsx`) na `KpiTile` z `metricId`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | S1 / I9. S1 tego nie zrobił (`PaywallKpiStrip` i `AdminMembershipWorkspace` nadal na `membership/atoms/KpiTile`) → I9                                                                        |
| Z-S6-14 | D-11: akceptacja EN benchmarków i 76 zestawów dźwigni przez właściciela. **Zamknięte w I9b (§22.2 B6): akceptacja właściciela 2026-10-20 (zgoda delegowana).**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | właściciel                                                                                                                                                                                   |
| Z-S6-15 | Opcjonalna łatka `getSemanticSnapshot({ fromDate, toDate })` (D13 na wejściu server fn).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | I9 (opcja)                                                                                                                                                                                   |

### 11.6 Pomiar bundla (D-08 rozstrzygnięta)

`flock -o /tmp/hub-build.lock env BUNDLE_INVENTORY=1 bun run build` +
`check:bundle`. Baza zmierzona tym samym narzędziem na `git archive a90e66c4`
(te same `node_modules`). Wynik nie zależy od ścieżki katalogu: chunki
vendorów mają w obu buildach ten sam hash i rozmiar.

| Budżet (gzip KB)         | Próg | Baza `a90e66c4` | Po S6  | Δ S6      | Cel S6 (§8.6) | Wynik                                                                                |
| ------------------------ | ---- | --------------- | ------ | --------- | ------------- | ------------------------------------------------------------------------------------ |
| największy chunk (entry) | 286  | 252,0           | 252,2  | +0,2      | 0             | próg ✓; przyrost = listy preloadu (niżej)                                            |
| `public`                 | 2881 | 2760,9          | 2761,8 | **+0,9**  | 0             | próg ✓; 0 nowych modułów w chunkach publicznych - uzasadnienie niżej                 |
| `overall`                | 4879 | 4868,9          | 4922,8 | **+53,9** | ≤ +18         | **próg ✗** (4922,8 > 4879) - wyłącznie kod panelu; D-08: ratchet +53,9               |
| `css`                    | 100  | 99,4            | 99,6   | +0,2      | ≤ +0,8        | ✓ (arkusz panelu `admin-styles` +0,17); D-08: ratchet +0,2                           |
| `publicCss`              | 85   | 83,7            | 83,7   | 0,0       | 0             | ✓ - arkusz publiczny bajt w bajt (560 809 B)                                         |
| `boot`                   | 579  | 465,8           | 466,0  | +0,2      | -             | ✓; to samo źródło co entry                                                           |
| liczba plików JS         | -    | 1417            | 1433   | +16       | -             | `check:chunks` ✓ (acykliczny), `check:entry-purity` ✓, `check:server-entry-purity` ✓ |

`check:bundle` jest czerwony WYŁĄCZNIE na `overall` - zgodnie z D-08 do
podniesienia przez orkiestratora o zmierzony przyrost, bez cięcia funkcji.

Przypisanie przyrostów (gzip -9 per chunk, `reports/chunk-inventory.json`,
bajty modułów przed minifikacją):

| Chunk (klasa)                                                                                                            | Δ gzip KB                                        | Przyczyna                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metricHelp` (admin, nowy)                                                                                               | +23,9                                            | `metrics.ts` 17,2 → 91,2 KB raw: 70 nowych metryk z definicjami PL/EN (co liczy, mianownik, okno, kiedy `null`) i guardami; `evaluate.ts` + `adapter.ts` 6,5 KB raw.                                                                          |
| `MetricExplainer` (admin, nowy)                                                                                          | +17,1                                            | `MetricExplainer.tsx` 18,6 KB raw, lekki indeks benchmarków 8,4 KB raw, `BenchmarkScale`, `SourceCitation`, `useBenchmark`; `i18n-admin-semantic` i `streams` przeszły tu z `SemanticReconciliationPanel` (−7,6) i `WindowProvenance` (−6,1). |
| `i18n-admin-revenue-shell` (admin, nowy)                                                                                 | +6,7                                             | Słownik powłoki huba (22 KB raw, PL/EN).                                                                                                                                                                                                      |
| `admin.revenue` (admin)                                                                                                  | +4,0                                             | `RevenueHubLayout` 1,2 → 17,7 KB raw (zaślepka I0 → powłoka), `hubTabs.ts`.                                                                                                                                                                   |
| `scheduler` (admin, nowy) / `admin.community.notifications`                                                              | +3,9 / −3,35                                     | `HeartbeatDot` używa też hub, więc słownik planisty wydzielił się z trasy powiadomień (netto +0,5).                                                                                                                                           |
| `MetricDictionary`, `RevenueInsightSection`, `DashboardPeriodTabs`, `VerdictBadge` (admin)                               | +3,5 / +3,3 / +1,2 / +0,55                       | Nowe organizmy i wydzielone wspólne moduły panelu.                                                                                                                                                                                            |
| `KpiTile`, `window`, `BenchmarkTierBadge`, `biChart`, `i18n-admin-analytics`, `ads-funnel`, `admin.analytics.bi` (admin) | +1,4 / +1,05 / +1,0 / +0,55 / +0,5 / +0,4 / +0,4 | Rozszerzenia z karty S6.                                                                                                                                                                                                                      |
| `i18n-charts` (public, nowy) / `ChartFrame` (public)                                                                     | +25,54 / −25,44 = **+0,10**                      | Słownik wykresów wydzielony z `ChartFrame` (nowe wejścia panelu sięgają `KpiTile` bez `ChartFrame`) - narzut osobnego pliku.                                                                                                                  |
| `status` (public, nowy: `status.ts` + `smooth.ts`) / `useRevealOnScroll`                                                 | +1,17 / −1,08 = **+0,09**                        | Ten sam mechanizm; `status.ts` = baza (ocena poza nim).                                                                                                                                                                                       |
| `roles` (public, `lib/charts/roles.ts`)                                                                                  | +0,24                                            | Ten sam mechanizm (oceny w panelu importują tokeny ról).                                                                                                                                                                                      |
| `app-initial`, `BlocksRenderer`, `Chart` (public)                                                                        | +0,09 / +0,09 / +0,04                            | Listy preloadu `__vite__mapDeps` z nazwami trzech nowych chunków (diff `app-initial` po normalizacji hashy) i D1 (`waterfall.ts` +49 B raw).                                                                                                  |
| pozostałe chunki publiczne (każdy < 0,03)                                                                                | +0,34                                            | Hashe w nazwach importów i przemianowania minifikatora.                                                                                                                                                                                       |

Uzasadnienie `public` +0,9 KB: inwentarz nie ma ŻADNEGO nowego modułu
w chunkach publicznych. Jedyną zmianą kodu publicznego jest naprawa D1 (P0,
`level` +49 B raw, `Chart.tsx` −33 B raw). Reszta to narzut podziału
chunków (Z-S6-18). Klient benchmarków (indeks + ewaluator + adapter,
eksporty używane przez panel) waży 3,19 KiB gzip, czyli mieści się w limicie
4 KB (pełne moduły: 4,27 KiB). Treść grup nie trafia do klienta:

| Literał (`rg -l -F … .output/public`)                                            | `.output/public` | `.output/server` |
| -------------------------------------------------------------------------------- | ---------------- | ---------------- |
| `Do aktualizacji po pobraniu raportu Mather Q1 2026` (PL, `retention.server.ts`) | 0                | 2                |
| `the level of 'leaky' newsletter categories (sport 7.76%, AI 13.33%)` (EN)       | 0                | 2                |
| `Digital news/media B2C subscriptions (paid monthly plans, web sales, no trial)` | 0                | 2                |
| `recurly_churn_benchmarks_2026` (rejestr źródeł)                                 | 0                | 4                |

### 11.7 Weryfikacja końcowa S6 (2026-10-19)

| Polecenie                                                                                                                                                                                                                                                                                                                                            | Wynik                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run format:check`                                                                                                                                                                                                                                                                                                                               | ✓                                                                                                                                                    |
| `bun run verify:static`                                                                                                                                                                                                                                                                                                                              | ✓ 18 bramek (m.in. `check:rpc-contract` 796 nazw, `check:ts-sql-contract` 918 wywołań RPC, `check:types-freshness`)                                  |
| `bun run typecheck` (tsgo + `tsconfig.scripts.json` + e2e)                                                                                                                                                                                                                                                                                           | ✓ 0 błędów                                                                                                                                           |
| `bun run lint`                                                                                                                                                                                                                                                                                                                                       | ✓ 0 błędów (278 ostrzeżeń, w tym 2 `react-refresh` w `RevenueInsightSection.tsx` - eksport stałych kafli dla testu)                                  |
| `bunx vitest run src/lib/analytics src/lib/charts src/components/charts src/components/admin/analytics src/components/admin/revenue src/lib/admin/revenue src/components/admin/dashboard src/components/admin/events/molecules src/routes/__tests__/{adminRevenueHubRoutes,adminAnalyticsBiRoute,adminAnalyticsRoute}.test.tsx src/lib/ci/__tests__` | ✓ 265 plików, 6640 testów (+ 2 oczekiwane porażki)                                                                                                   |
| `bun run test` (cała suita)                                                                                                                                                                                                                                                                                                                          | brak zapisanego wyniku - przed commitem S6 w tym wierszu został znacznik roboczy. Pełna suita: CI PR #520 i `main` (§13.3)                           |
| `bun run scripts/hub-slice-guard.ts S6 --base a90e66c4`                                                                                                                                                                                                                                                                                              | jedyne naruszenie: `[plik-wspoldzielony] src/lib/ci/hubDelivery.ts` (zmiana integratorska §11.4); ten dokument też jest zmianą integratora (Z-S6-13) |
| `bun run scripts/benchmarks/import-benchmarks.ts docs/benchmarki/2026-10-18 --check`                                                                                                                                                                                                                                                                 | ✓ 8 plików zgodnych (76 wpisów, 191 kontekstów, 958 pasm, 172 źródła, 185 aliasów, 3 odrzucone)                                                      |
| `flock -o /tmp/hub-build.lock env BUNDLE_INVENTORY=1 bun run build` + `check:chunks`, `check:entry-purity`, `check:server-entry-purity`                                                                                                                                                                                                              | ✓                                                                                                                                                    |
| `bun run check:bundle`                                                                                                                                                                                                                                                                                                                               | ✗ wyłącznie `overall` 4922,8 > 4879 (D-08, §11.6)                                                                                                    |
| `rg` treści benchmarków po `.output/public`                                                                                                                                                                                                                                                                                                          | ✓ 0 trafień (§11.6)                                                                                                                                  |
| `generate:ts-sql-contract` + pgTAP `run.sh all ts_sql_contract` (`PGTAP_DIR=/tmp/pgtap-hub-S6`, port 5456, `flock`)                                                                                                                                                                                                                                  | ✓ 1251 migracji (1 błąd znany: `20260825230232`), `ts_sql_contract_test.sql` 9/9; powtórka `run.sh test` po ostatniej zmianie kodu 9/9               |
| po scaleniu: pgTAP `run.sh all` na `cb7a18df` (orkiestrator, 2026-10-19)                                                                                                                                                                                                                                                                             | ✓ `ts_sql_contract_test` w puli 209 zielonych plików; 4 pliki z błędem środowiska, żaden S6 ani huba (§13.2)                                         |

### 11.8 Kryteria akceptacji S6 (SPEC §8.3)

- [x] `registry.test.ts`: 9 strumieni (`ALL_STREAMS`, świadomie; `STREAMS` 6), każda nowa metryka z jednym bindingiem `authoritative`, definicjami > 20 znaków, ≥ 1 guardem; `assertSameStreamRatio` bez wyjątków.
- [x] Rejestr benchmarków: 77 → 76 wpisów (scalone `arpu`); unikalne `key`/`abbr` (także wobec etykiet metryk); 188 wpisów źródłowych rozwiązanych (172 kanoniczne URL `https` + aliasy + 3 odrzucone, V3); pasma posortowane, ciągłe, etykiety ∈ Tier, monotoniczność per kontekst, `basis:"E"` ⇔ heurystyka; ≤ 12 źródeł na kontekst; pełny parytet PL/EN pól `Bi` z dźwigniami (76/76); `tierOf` na granicach; `annualizeChurn` M ↔ R; CCR + CAR = 100.
- [x] Treść grup poza klientem (`rg` - 0 trafień, `clientBoundary.test.ts`); klient indeks + ewaluator + adapter 3,19 KiB gzip (≤ 4 KB).
- [x] `waterfall.test.ts` (D1) + `waterfallLevel.test.tsx` (D1 w dymku i tabeli); `KpiTile.benchmark.test.tsx` (baza 0 → „-”, EN, etykieta-węzeł z `MetricExplainer`); `TimeRangeFilter.localDates.test.tsx` (`TZ=Europe/Warsaw`, D13); `chartKinds`, `chartDictionaryKeys`, `Chart.a11y`, `chartCardA11y` zielone bez zmian; testy pulpitu (`DashboardPeriodTabs`, `MarketingPanel`) bez zmian oczekiwań.
- [x] `MetricExplainer`, `BenchmarkScale`, `BenchmarkTierBadge` - RTL + axe (kierunek `lower`, `range`, `none`, `no_data`, `small_sample`, Escape, `aria-labelledby`).
- [x] `RevenueHubLayout`: `aria-current`, okresy z `periods`, wybór sekcji < 768 px, zakładki editora, `useHydrated`; `SourceHeader` linkuje do istniejącej trasy właściciela.
- [x] `getRevenueSnapshot` scala pięć odczytów czterech domen; editor nie wywołuje RPC finansowego (rejestr żądań atrapy) - na docelowych wpięciach z testu. Wpięcia produkcyjne czekają na migracje właścicieli (Z-S6-16).
- [ ] Delta bundla w PR; `public` 0 - **`public` +0,9 KB** (0 nowych modułów, narzut podziału chunków - Z-S6-18); `overall` +53,9 KB do ratchetu D-08 (§11.6).

## 12. Wycinek S1 - moduły źródłowe: synchronizacja, newsletter, kupony, nadania (2026-10-19)

Commit wycinka `8538b8c9` (2026-10-19, 15:30 UTC) na `f59d58a9` (S6),
gałąź PR #520 `claude/great-dirac-gzks9w`. Decyzja orkiestratora: S1, tak jak
S6, trafia prosto do PR #520, bez `hub/integration`. Integrator S1 wykonuje
zgłoszenia „Do integracji” potrzebne do kryteriów karty (§12.4). Dalsze
commity S1 w PR #520:

- `35c22b7b` - ratchet `overall` (D-08);
- `d12859f7` i `a303246e` - scalenia `main`;
- `d24607a1` - formatowanie plików audio z `main`;
- `8c8d3050` - poprawki po recenzji Codex;
- `4549a6f1` - renumeracja bliźniaków drizzle.

PR #520 scalono do `main` jako `cb7a18df`.

Dziennik S1 nie powstał razem z wycinkiem. Tę sekcję odtworzono z historii
git i kodu. Identyfikatory `D-S1-*`, `Z-S1-P1`, „def. N”, „PLAN S1 …” i „N19”
pochodzą z planu wycinka orkiestratora (poza repo). Cytują je komentarze
w kodzie. Zgłoszenia otwarte `Z-S1-01…12` (§12.5) nadaje ten dziennik.
W kodzie stoją jako „Do integracji” albo „I9”.

### 12.1 Zakres

174 pliki, +24 268 / −3708 linii.

| Obszar                        | Co dostarcza S1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL (5 migracji, 15 funkcji)  | `100000_settings_change_events`: emitery AFTER dla `metering_settings`, `checkout_settings`, `retention_settings` (payload `{op, keys}`, czyli nazwy zmienionych kolumn bez wartości; UPDATE bez zmiany nie emituje), `content_access` i `retention_reasons`. `100100_newsletter_settings_patch`: RPC `admin_newsletter_settings_patch(p_group, p_patch, p_expected_updated_at)` (biała lista kolumn grupy, CAS → `40001`, zapis tylko zmienionych kolumn), `tg_newsletter_settings_emit`, redefinicja `tg_newsletter_subscribers_emit_events` (`CIALO-Z` 20260711220607) + `newsletter_subscriber.resubscribed.v1`. `100200_coupon_events`: emitery `coupon.changed.v1` (bez kodu kuponu), `coupon_campaign.changed.v1`, `coupon.redeemed.v1`, RPC `admin_coupon_campaign_set_status`, granty kolumnowe na `b2b_coupon_campaigns`. `100300_email_health_aggregate`: `admin_revenue_email_health(p_since, p_until)`: unikalne otwarcia i kliknięcia, `null` ≠ 0, okno ≤ 400 dni. `100400_membership_grants_single_path`: `admin_membership_grant_set` i `admin_membership_grant_revoke` (wyłącznie admin, najemca z sesji, `audit_log`, wygaszanie tylko `source='manual'`, blokada doradcza), REVOKE `admin_grant_membership` od `authenticated`. Właściciele 15 funkcji (10 wyzwalaczy i 5 RPC panelu) są w rejestrze `hubDelivery.ts`. pgTAP: 5 plików, 162 asercje. |
| Plany i warstwy               | `billing/planQueries.ts`: jeden odczyt `billingKeys.admin.plansAll()` zamiast literału `["admin-access-plans"]`, patch wyłącznie kolumn właściciela (paywall albo członkostwo: `tier_key`), CAS na `updated_at`, usuwanie tylko bez subskrypcji. `billing/tierMutations.ts` z `tierCoreDraft.ts` i `tierMarketingDraft.ts`: rdzeń warstwy w członkostwie, marketing i benefity w cenniku (def. 11). `membershipQueries.ts`. `capability_key` w elemencie `benefits` (P20).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Paywall                       | `admin.paywall.tsx` skrócony z 1149 do 123 linii. Wyniesione organizmy z testami charakteryzującymi: `AccessPlanEditorDialog`, `PaywallPlansSection`, `MeteringSettingsCard`, `MeteringOverridesCard`, `CheckoutSettingsCard`, `CheckoutPlanePreview`, `PaywallKpiStrip`. Przełącznik „W sprzedaży” (`for_sale`), odznaka planu bez pary w `BILLING_CATALOG`. `access/meteringQueries.ts`: bez wiersza widać stan serwera „wyłączony” (def. 14). `access/contentAccessQueries.ts`: jedna reguła i jeden pisarz dla `AccessSettingsPane` i `PostGeneralOverview` (def. 3). `useCheckoutSettings` z tokenem.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Retencja                      | `retention/mutations.ts`: najemca z sesji, token `updated_at`. `retention/queries.ts`: jedno `queryOptions` dla zakładki i `/admin/monetization`, okno i filtr „tylko z powodem” w zapytaniu (def. 13, Z-08). `RetentionTab`: stan serwera „wyłączona - brak konfiguracji”.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Newsletter i popupy           | `newsletter/settingsQueries.ts`: grupy `NEWSLETTER_SETTINGS_GROUPS` = blok SQL (test parytetu), `usePatchNewsletterSettings`, scalanie po konflikcie (D-S1-03), szew zgodności (D-S1-04). Grupa `overview` pisze `OverviewPanel`, grupa `popup` - `SignupPopupContentSection`. `/admin/popups`: patch jednej kolumny. `SubscribersPanel` i `ImportCsvDialog`: subskrybent i lead CRM to ta sama osoba (def. 17). `renderCampaign.server.ts`: render wyniesiony bez zmiany ciała.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Kampanie i kupony             | `newsletter-campaigns.functions.ts`: `requireAdminEditor` na zapisie, wysyłce, ticku z panelu i tworzeniu kampanii kuponowej, bramka roli w handlerze (def. 10). Kampania kuponowa: `{{coupon_code}}` per odbiorca, filtr `segment` fail-closed, `sent` wyłącznie z serwera (D-S1-06). `couponQueries.ts`: analityka (D-S1-08), status przez RPC. `CampaignsPage`, `CampaignCreateDialog`, `NewsletterCouponPanel` (liczba odbiorców przed wysyłką, R-25), `CouponsListPage`, `/admin/coupons/{analytics,redemptions}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Nadania                       | `membership-admin.ts`: `findTenantMemberByEmail` (D-S1-09). `GrantsSection`: jedna ścieżka, opcjonalny powód odwołania, odwołane nadania zostają na liście. `membersDirectory.functions.ts`: `setMemberTier` i `revokeMemberTier` wołają te same RPC (def. 6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Zdrowie e-mail (dla huba)     | `src/lib/revenue/email/{dto,parse,emailHealth.functions,queries}.ts`: `getRevenueEmailHealth` za `requireCrmStaff`, `EMAIL_HEALTH_KEYS` przypięte znacznikiem `-- rpc-shape` do treści migracji. `i18n-admin-revenue-email.ts`. Wpięcia w migawkę S6 brak - Z-S1-01.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Zakładki, nagłówki i słowniki | `admin/{paywallTabs,pricingTabs,billingTabs}.ts`: liście bez importów danych, `validateSearch`. Sekcyjny `adminPageHead` na `/admin/{paywall,pricing,billing,membership,popups,coupons}` i `/admin/newsletter/{overview,campaigns,campaigns/$id}`. `i18n-admin-paywall-sync.ts`: nowy prefiks i jeden opis konfliktu `40001` dla wszystkich ekranów. Rozszerzone słowniki `i18n-admin-{pricing,membership,coupons}.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### 12.2 Decyzje

- **S1 prosto do PR #520** (orkiestrator, 2026-10-19), po S6 i przed S4, S2,
  S3. Odchylenie od podziału PR-A/PR-B - §12.3.
- **D-08:** ratchet `overall` 4879 → 4959 obejmuje I0, S6 i S1 łącznie
  (`35c22b7b`, §12.7).

| ID      | Decyzja                                                                                                                                                                                                                                                                                                                                                                                 | Gdzie / dowód                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| D-S1-01 | Bliźniaki drizzle migracji S1 (bajt w bajt) i ich wpisy w dzienniku dostarcza commit wycinka, a nie PR-A fali. S1 idzie prosto na `main`, gdzie `check:migration-lanes` blokuje.                                                                                                                                                                                                        | manifest S1 w `hubDelivery.ts`; §12.6                                                                |
| D-S1-02 | Jeden kontrakt konfliktu zapisu: SQLSTATE `40001`. Zwracają go RPC S1 i mutatory TS przy 0 wierszach z `.eq("updated_at", token)`. Token to surowy napis `updated_at` z PostgREST, nigdy przepuszczony przez `Date` (`Date` gubi mikrosekundy).                                                                                                                                         | `planQueries.ts` (`STALE_WRITE_CODE`, `isStaleWriteError`), `planQueries.lostUpdate.test.ts`         |
| D-S1-03 | Ustawienia newslettera: CAS na `updated_at` wiersza. Po `40001` klient pobiera świeży wiersz i scala go po kolumnach swojego patchu, więc zapis przechodzi mimo cudzej zmiany innych kolumn.                                                                                                                                                                                            | RPC w `100100`, `settingsQueries.ts`, `OverviewPanel.twoTabs.test.tsx`                               |
| D-S1-04 | Szew zgodności `useSaveNewsletterSettings(patch)` dla pisarzy spoza manifestu (`RegistrationFieldsSection`, `NewsletterBuilder`): patch liczony względem wiersza w cache, rozkład na grupy, RPC per grupa.                                                                                                                                                                              | `saveNewsletterSettingsByGroups`; ryzyko szczątkowe - Z-S1-07                                        |
| D-S1-05 | Plan można usunąć wyłącznie bez subskrypcji. Licznik jest sprawdzany ponownie tuż przed DELETE, bo FK `user_subscriptions.plan_id … ON DELETE CASCADE` kasuje historię klientów. Plan nigdy nie dostaje `active = false` (webhook mapuje cenę tylko na plan aktywny). Zamiast tego jest akcja „Wycofaj ze sprzedaży” (`for_sale = false`). Redaktor widzi przycisk wyłączony z powodem. | `deleteAccessPlan`, `PaywallPlansSection`, `platformPaywallRoute.test.tsx` („plan deletion”)         |
| D-S1-06 | Status `sent` kampanii kuponowej ustawia wyłącznie serwer po zakończonej wysyłce. `authenticated` traci tabelowe UPDATE na `b2b_coupon_campaigns`. Zostaje UPDATE na jawnej liście kolumn, bez `status` i `newsletter_campaign_id`.                                                                                                                                                     | `100200` pkt E; `coupon_events_test` (test kompletności grantów)                                     |
| D-S1-07 | Kupon kampanii emituje `coupon.changed.v1` najwyżej raz na transakcję i kampanię: zdarzenie zbiorcze z `campaign_id`, znacznik transakcyjny `hub.coupon_emit_campaigns`. Generacja do 10 000 kodów nie zalewa realtime.                                                                                                                                                                 | `100200` pkt A; `coupon_events_test` (50 kodów = 1 zdarzenie)                                        |
| D-S1-08 | Analityka kuponów: konwersja liczona z realizacji opłaconych (`live`, nie `mock`), kwoty wyłącznie per waluta, rezerwacje osobno (P10).                                                                                                                                                                                                                                                 | `couponAnalyticsSummaryQueryOptions`, `couponQueries.test.ts`, `adminCouponsAnalyticsRoute.test.tsx` |
| D-S1-09 | Nadanie po e-mailu wyłącznie w obrębie najemcy. Adres jest rozwiązywany w katalogu członków (`findTenantMemberByEmail`, dopasowanie dokładne bez wielkości liter), a RPC przyjmuje `user_id`. Konto spoza najemcy to komunikat dla admina, a nie wyjątek SQL.                                                                                                                           | `membership-admin.ts`, `membershipAdmin.test.ts`, `GrantsSection.test.tsx`                           |

### 12.3 Odchylenia od SPEC (kontrakt bez zmian, fakty repozytorium wygrywają)

| Miejsce SPEC / karta S1                                  | Stan po S1                                                                                                                                                                                                                                                                                     | Uzasadnienie                                                                                                                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §8.5 pkt 3 (PR-A migracje → wdrożenie → PR-B kod)        | PR #520 scalił migracje `2026102010*` i kod S1 razem (`cb7a18df`).                                                                                                                                                                                                                             | Decyzja orkiestratora. Skutek: przed wdrożeniem migracji nowe ekrany wołają nieistniejące RPC, a po wdrożeniu stary front traci dwie ścieżki zapisu. Procedura - §12.9.                 |
| §6 pkt 1-3, §8.5 pkt 2 (bliźniaki od Integratora w PR-A) | Bliźniaki `0323…0327` i wpisy dziennika w commicie wycinka (D-S1-01). Po scaleniu `main` przenumerowane na `0324…0328` (`4549a6f1`).                                                                                                                                                           | `check:migration-lanes` na `main` jest blokujący. Numer nadaje Integrator przy scaleniu (§6).                                                                                           |
| §4.5 `coupon.changed.v1` per wiersz                      | Kupon kampanii: jedno zdarzenie na transakcję i kampanię, z dodatkowym `campaign_id` (D-S1-07). Kupon bez kampanii: zdarzenie per wiersz.                                                                                                                                                      | `bulk_generate_coupons_for_campaign` wstawia do 10 000 kodów pętlą. Każdy dawałby osobne zdarzenie w realtime każdej otwartej karty.                                                    |
| Karta S1: lost update → „0 wierszy i `toastError`”       | Konflikt `40001` pokazuje `showSaveError` (`components/admin/pricing/saveErrorToast.ts`) z akcją „Wczytaj aktualne”, a szkic przeżywa.                                                                                                                                                         | `toastError` nie zna `40001`, a zmiana tego modułu wykracza poza wycinek (Z-S1-05).                                                                                                     |
| Karta S1: `?tab=` w billing                              | `billingTabs.ts` + `validateSearch` są w S1. Sterowanie zakładką z adresu w `AdminBillingPanel` doszło dopiero w `8c8d3050`, w pliku z manifestu S2. Filtr `status` czeka na S2.                                                                                                               | Recenzja Codex wykazała, że deep link z huba lądował na zakładce domyślnej. Panel rozliczeń należy do S2 (PLAN S1 §3.3) - Z-S1-03.                                                      |
| Karta S1: „`author` nie wywoła `sendCampaign`”           | Dwie warstwy. Pierwsza: middleware `requireAdminEditor` na zapisie, wysyłce, ticku i tworzeniu kampanii kuponowej. Druga: bramka w handlerze - odczyt kampanii klientem użytkownika (RLS `campaigns_staff_select`), zanim klient serwisowy cokolwiek zrobi.                                    | Testy obudowy `newsletterCampaign{Crud,Send}.test.ts` przypinały `requireStaff`, więc Integrator dopisał je do manifestu (Z-S1-P1). Bramka w handlerze zostaje jako druga linia obrony. |
| Karta S1: „Nadania: jedna ścieżka”                       | `admin_grant_membership` zostaje w bazie bez EXECUTE dla `authenticated` (forward-only). Panel i katalog członków wołają `admin_membership_grant_set` i `admin_membership_grant_revoke`.                                                                                                       | Brak DROP, bo mogą istnieć wywołania serwisowe. Sprzątanie w I9 (Z-S1-09).                                                                                                              |
| Karta S1: kampania kuponowa „`sent` po sukcesie”         | `sent` tylko po wysyłce bez nieudanych odbiorców. Częściowa porażka daje `failed`, kampanię podejmuje potem `claimCampaign`, a nieudany odbiorca dostaje przy ponowieniu ten sam kod. Wersja językowa z treścią bez `{{coupon_code}}` kończy się `COUPON_TAG_MISSING` przed przydziałem kodów. | Recenzja Codex (`8c8d3050`): `sent` przy częściowej porażce zamykał ponowienie i kody przepadały.                                                                                       |
| Z-S6-16 / Z-S6-17 (wpięcie `email` przy scaleniu S1)     | Niewykonane. `REVENUE_DOMAIN_READS.email = null`, a sekcja BI mówi „źródło niepodłączone”.                                                                                                                                                                                                     | Kształt S1 różni się od `REVENUE_EMAIL_KEYS` i wymaga adaptera. Funkcja istnieje na produkcji dopiero po wdrożeniu `100300` (Z-S1-01).                                                  |
| §4.2 rozmiary planowane (12/14/10/9/12 KB)               | 13,0 / 18,5 / 14,4 / 11,3 / 9,1 KiB.                                                                                                                                                                                                                                                           | Nagłówki PL z defektem, zmianą i dowodem. Wszystkie pliki < 45 KiB (R-08).                                                                                                              |

### 12.4 Zgłoszenia „Do integracji” wykonane przez Integratora S1

Strażnik wycinka (`checkSliceDiff("S1", …)` na plikach `8538b8c9`) zgłasza
wyłącznie pliki współdzielone `drizzle/migrations/meta/_journal.json`
i `src/lib/ci/hubDelivery.ts`. Obie zmiany są integratorskie. Poprawki Codex
(`8c8d3050`) dotknęły pliku S2 - Z-S1-03.

| ID                | Zmiana                                                                                                                                                                                                                                                     | Pliki                                                                                                                                             | Dowód                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Z-08 (I0 → S1)    | Odpowiedzi retencji: okno i filtr `reason_label IS NOT NULL` w zapytaniu, jedno `queryOptions` dla zakładki i `/admin/monetization`, komunikat o przyciętej próbce (def. 13).                                                                              | `retention/queries.ts`, `RetentionTab.tsx`, `pricing/retentionFeedbackWindow.ts`, `admin/retentionStats.ts`                                       | `RetentionTab.test.tsx` („okno statystyk w zapytaniu (Z-08)”), `retention/__tests__/queries.test.ts`    |
| Z-S1-P1 (def. 10) | `upsertCampaign` i `sendCampaign` za `requireAdminEditor`. Testy obudowy dopisane do manifestu S1.                                                                                                                                                         | `src/lib/__tests__/newsletterCampaign{Crud,Send}.test.ts`, `newsletter-campaigns.functions.ts`                                                    | asercje middleware w obu testach; `newsletter-campaigns.roles.test.ts`                                  |
| Z-S1-P1 (P20)     | `capability_key` w elemencie `benefits`: odczyt i zapis w `tiers.ts`. Bez tego edytor cennika kasowałby pole przy zapisie.                                                                                                                                 | `src/lib/billing/tiers.ts`, `__tests__/tiers.test.ts`                                                                                             | `tiers.test.ts`, `TierBenefitsEditorCapability.test.tsx`                                                |
| D-S1-04           | `NewsletterBuilder` i `RegistrationFieldsSection` zapisują szwem grup z modułu panelu (`settingsQueries.ts`), a nie z chunku wejściowego (`useNewsletterSettings.ts`) - budżet `public`. `/admin/popups`: sekcyjny `adminPageHead` i patch jednej kolumny. | `NewsletterBuilder.tsx`, `RegistrationFieldsSection.tsx` (+ testy), `src/routes/__tests__/adminAudienceRoutes.test.tsx`                           | testy przepięte z UPDATE pełnym wierszem na RPC `admin_newsletter_settings_patch`                       |
| -                 | Test fabryk I0 importował usuniętą stałą `ADMIN_COUPONS_KEY`. Jedyna definicja jest teraz w `couponKeys.ts`.                                                                                                                                               | `src/lib/__tests__/hubKeyFactories.test.ts`                                                                                                       | test zielony                                                                                            |
| D-S1-01           | 5 bliźniaków drizzle i 5 wpisów `_journal.json` (plik współdzielony). Po scaleniu `main` - `0324…0328` (`4549a6f1`).                                                                                                                                       | `drizzle/migrations/032{4…8}_*.sql`, `meta/_journal.json`                                                                                         | §12.6                                                                                                   |
| -                 | Manifest `HUB_SLICE_MANIFESTS.S1` += pliki z wierszy wyżej.                                                                                                                                                                                                | `src/lib/ci/hubDelivery.ts` (plik współdzielony)                                                                                                  | `hubDelivery.gate.test.ts` 49/49 na `cb7a18df`                                                          |
| D-08              | Ratchet `overall` 4879 → 4959 (I0 + S6 + S1).                                                                                                                                                                                                              | `scripts/check-bundle-size.ts` (plik współdzielony), `35c22b7b`                                                                                   | §12.7                                                                                                   |
| recenzja Codex    | Kampania kuponowa z częściowo nieudaną wysyłką kończy jako `failed`. `COUPON_TAG_MISSING` z komunikatem PL/EN. `/admin/billing`: zakładka w adresie (`tab`, `onTabChange`).                                                                                | `newsletter-campaigns.functions.ts`, `coupons/couponSendErrors.ts`, `i18n-admin-coupons.ts`, `admin.billing.tsx`, `billing/AdminBillingPanel.tsx` | `newsletter-campaigns.coupons.test.ts` („część wysyłek nieudana”, „wersja językowa bez znacznika kodu”) |

### 12.5 Zgłoszenia otwarte

| ID      | Zgłoszenie                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Właściciel / termin                          |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Z-S1-01 | **Wpięcie `email` w migawkę huba** (część S1 z Z-S6-16, razem z Z-S6-17). W `REVENUE_DOMAIN_READS.email` trzeba wpiąć `getRevenueEmailHealth` albo literał `admin_revenue_email_health` (`p_since`, `p_until`) z adapterem kształtu. S1 oddaje `campaigns.*`, `list.{start,end,new,unsubscribed,net_growth}`, `doi.{started,confirmed_7d}`, a S6 czyta pola płaskie: `delivered…`, `list_base`, `list_net_growth`, `doi_started`, `doi_confirmed`. Bez adaptera wynik byłby cichym „brak danych”.           | Integrator w nowym PR, po wdrożeniu `100300` |
| Z-S1-02 | **Globy bliźniaków w manifestach `hubDelivery.ts` po renumeracji.** Dziś I0 ma `{0317…0322}_hub_*`, a S1 `{0323…0327}_*`. Według `slicesOfPath` `0323_hub_shared_sql_helpers` należy do S1 i I9, a `0328_membership_grants_single_path` tylko do I9. Poprawnie powinno być: I0 `{0318…0323}`, S1 `{0324…0328}`. Test `checkSliceDiff` w `hubDelivery.gate.test.ts` używa `0318`, więc przejdzie przy obu globach.                                                                                           | Integrator (plik współdzielony), w nowym PR  |
| Z-S1-03 | **`AdminBillingPanel` (manifest S2) ma kontrakt z S1:** propsy `tab` i `onTabChange` z `admin.billing.tsx` (`8c8d3050`). S2 przejmuje plik bez zrywania tego kontraktu i dokłada filtr `status` z adresu (PLAN S1 §3.3).                                                                                                                                                                                                                                                                                    | S2                                           |
| Z-S1-04 | **Domy tymczasowe.** Narzędzia zapisu (`STALE_WRITE_CODE`, `isStaleWriteError`, `staleWriteError`, `assertPatchColumns`, `invalidateKeys`, `revenueDomainKeys`) trzeba przenieść z `billing/planQueries.ts` do neutralnego `src/lib/admin/staleWrite.ts` (reszta Z-S1-P1). `components/admin/membership/membershipQueries.ts` trzeba przenieść obok `billing/tierMutations.ts`.                                                                                                                             | I9                                           |
| Z-S1-05 | **`toastError` nie rozpoznaje konfliktu `40001`** (PLAN S1 §3.2 pkt 11). Dziś jedynym tłumaczem jest `pricing/saveErrorToast.ts`. Docelowo rozpoznanie powinno trafić do `toastError`, żeby ekrany spoza S1 (hub S7) mówiły o konflikcie tymi samymi słowami.                                                                                                                                                                                                                                               | I9                                           |
| Z-S1-06 | **Szyna i bramka literałów.** Cztery klucze bez fabryki-liścia stoją literałem: `["public","resolved"]`, `["unlocked-body"]` (licznik, dostęp do treści), `["authz","permission-matrix","tiers"]` i `["admin-membership-tiers"]` (`VerificationDomainsCard`). Reguła `coupon_campaign.changed.v1` nie unieważnia `newsletterKeys.campaignsAll()` - dziś robi to sam mutator. 19 plików długu S1 jest już bez literałów (bramka z 2026-10-19), więc można je zdjąć z `QUERY_KEY_LITERAL_DEBT` (tryb ścisły). | I9 (pliki współdzielone)                     |
| Z-S1-07 | **Ryzyko szczątkowe szwu D-S1-04.** Edytor ze szkicem starszym niż cache może odesłać starą wartość kolumny zmienionej w innej karcie. Rozwiązanie: przepiąć `RegistrationFieldsSection` i `NewsletterBuilder` na `usePatchNewsletterSettings` z własną bazą szkicu.                                                                                                                                                                                                                                        | I9                                           |
| Z-S1-08 | **Sygnatury 5 RPC S1 w `types.ts`** (N19). Dziś wywołania idą przez `RpcCallable` z literałem nazwy. Sygnatury dopisać po wdrożeniu (R-07).                                                                                                                                                                                                                                                                                                                                                                 | I9                                           |
| Z-S1-09 | **Stara ścieżka nadań.** `admin_grant_membership` zostaje w bazie. Macierz uprawnień nadal wskazuje stare gniazdo: `src/lib/authz/permissionRows.ts` (`membership_grant` → `fn:admin_grant_membership/4`) i `authzSnapshot.generated.ts`. Do zrobienia: przepięcie na `admin_membership_grant_set/4`, regeneracja snapshotu, DROP starej funkcji osobną migracją po potwierdzeniu braku wywołań serwisowych.                                                                                                | I9                                           |
| Z-S1-10 | **PII w payloadach** `newsletter_subscriber.{subscribed,confirmed,unsubscribed}.v1`. Przepisano je 1:1 z `CIALO-Z`, bo czytają je przepisy automatyzacji i router integracji. Tabela SPEC §4.5 („Payload (bez PII)”) obejmuje tylko nowe typy, więc trzech starych nie ruszano.                                                                                                                                                                                                                             | I9 / właściciel (decyzja)                    |
| Z-S1-11 | **Słowniki.** Stare klucze `admin.paywall.*` w `i18n-admin-core.ts` i `i18n-admin-extras.ts` do usunięcia (nikt ich już nie czyta). `newsletterCampaign.roleRequired` (dziś w `i18n-admin-coupons.ts`) do przeniesienia do `adminNewsletter.*`.                                                                                                                                                                                                                                                             | I9                                           |
| Z-S1-12 | **`HUB_SYNC_MANIFEST` dla `access_plan`** zna tylko część kolumn paywalla. Test `planQueries.test.ts` sprawdza tylko, że to podzbiór. Pełną listę uzupełnić razem z Z-S6-11. Z-S6-12 (kopie kafli) S1 nie wykonał - §11.5.                                                                                                                                                                                                                                                                                  | I9                                           |

### 12.6 Bliźniaki drizzle

| Wersja supabase                                | Bliźniak dziś                        | W commicie S1 (`8538b8c9`) | idx | `when`        |
| ---------------------------------------------- | ------------------------------------ | -------------------------- | --- | ------------- |
| `20261020100000_settings_change_events`        | `0324_settings_change_events`        | `0323`                     | 324 | 1792419530669 |
| `20261020100100_newsletter_settings_patch`     | `0325_newsletter_settings_patch`     | `0324`                     | 325 | 1792419590669 |
| `20261020100200_coupon_events`                 | `0326_coupon_events`                 | `0325`                     | 326 | 1792419650669 |
| `20261020100300_email_health_aggregate`        | `0327_email_health_aggregate`        | `0326`                     | 327 | 1792419710669 |
| `20261020100400_membership_grants_single_path` | `0328_membership_grants_single_path` | `0327`                     | 328 | 1792419770669 |

`cmp` supabase ⇄ drizzle dla `0324…0328` (i I0 `0318…0323`) na `cb7a18df`
zwraca: bajt w bajt. Po scaleniu `main` (`a303246e`) dziennik zgubił wpisy
cennika, I0 i S1. Commit `4549a6f1` przeniósł je na koniec z rosnącym `when`.
Następny wolny numer to `0330` (§6; `0329` zajął Lovable w `e6620f60`).

### 12.7 Pomiar bundla

Osobnego pomiaru S1 (baza `f59d58a9` ⇄ S1) nie zapisano. Zestawienie
dostępnych liczb:

| Budżet (gzip KB)         | Próg przed / po ratchecie | Po S6 (§11.6, lokalnie) | I0 + S6 + S1 (host, `35c22b7b`) | Δ S1        | Cel S1 (§8.6) | Wynik                                                                    |
| ------------------------ | ------------------------- | ----------------------- | ------------------------------- | ----------- | ------------- | ------------------------------------------------------------------------ |
| `overall`                | 4879 / **4959**           | 4922,8                  | 4957,3                          | **≤ +34,5** | ≤ +6          | cel ✗; próg 4879 ✗ → ratchet D-08 (4957,3 → 4958 → +1)                   |
| `public`                 | 2881 / 2881               | 2761,8                  | brak zapisu                     | brak zapisu | 0             | próg zamrożony przy ratchecie; potwierdzenie - `check:bundle` CI (§13.3) |
| największy chunk (entry) | 286 / 286                 | 252,2                   | brak zapisu                     | brak zapisu | 0             | jw.                                                                      |
| `css`                    | 100 / 100                 | 99,6                    | brak zapisu                     | brak zapisu | ≤ +0,3        | próg bez zmian (zapas po S6: 0,4)                                        |
| `publicCss`, `boot`      | 85, 579 / bez zmian       | 83,7 / 466,0            | brak zapisu                     | brak zapisu | - / -         | zamrożone przy ratchecie                                                 |

Δ S1 to górne oszacowanie. Pomiar hosta przy ratchecie objął także zmiany
`main` scalone w `d12859f7` (pasek audio, popover udostępniania), a baza jest
inna niż lokalny pomiar S6. Przyrost to kod panelu ładowany leniwie, czyli
wyniesione organizmy paywalla, cennika, członkostwa, newslettera i kuponów
oraz słowniki per wycinek.

Środki S1 pod budżet `public`:

- szew zapisu newslettera wyniesiony z chunku wejściowego
  (`useNewsletterSettings.ts`) do `settingsQueries.ts`;
- liście zakładek bez importów danych (`*Tabs.ts`);
- `emailHealth.functions.ts` bez importu `window.ts`;
- napisy słowników dobrane pod skaner arkusza publicznego.

**Do uzupełnienia (orkiestrator):** delta `public`, entry i `css` S1 z CI
na `main` albo z pomiaru w nowym PR.

### 12.8 Weryfikacja końcowa S1

| Polecenie                                                                                                               | Wynik                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pgTAP `run.sh all` na `cb7a18df` (orkiestrator, 2026-10-19)                                                             | 213 plików: 209 OK, 4 z błędem środowiska (§13.2). Pliki S1 zielone: `hub_settings_events_test` 32/32, `newsletter_settings_patch_test` 38/38, `coupon_events_test` 37/37, `email_health_aggregate_test` 24/24, `membership_grants_single_path_test` 31/31 (162 asercje). |
| `bunx vitest run src/lib/ci/__tests__/hubDelivery.gate.test.ts` (na `cb7a18df`, przy spisie dziennika)                  | ✓ 49/49. Obejmuje „migracje bloku huba przechodzą bramkę” (właściciele 15 funkcji S1, `CIALO-Z` `tg_newsletter_subscribers_emit_events`, REVOKE/GRANT, nagłówek, rozmiar).                                                                                                |
| `bunx vitest run src/lib/__tests__/queryKeyLiterals.gate.test.ts` (jw.)                                                 | ✓ 5/5. Wszystkie 19 plików długu S1 są bez literałów - do zdjęcia z listy w I9 (Z-S1-06).                                                                                                                                                                                 |
| `checkSliceDiff("S1", …)` na plikach `8538b8c9` / `8c8d3050`                                                            | wyłącznie `[plik-wspoldzielony]` `_journal.json` i `hubDelivery.ts` (§12.4) / `[poza-manifestem] src/components/admin/billing/AdminBillingPanel.tsx` (Z-S1-03)                                                                                                            |
| `cmp` supabase ⇄ drizzle `0324…0328`                                                                                    | ✓ bajt w bajt                                                                                                                                                                                                                                                             |
| rozmiary `supabase/migrations/2026102010*.sql`                                                                          | ✓ 9,1-18,5 KiB (< 45 KiB)                                                                                                                                                                                                                                                 |
| `check:migration-lanes`                                                                                                 | ✗ na `a303246e` (CI: `Migration lanes` i `supabaseLaneCoverage.test.ts`, 2 testy - zgubione wpisy dziennika); ✓ po `4549a6f1` (komunikat commitu)                                                                                                                         |
| `format:check`, `verify:static`, `typecheck`, `lint`, `bun run test`, `build` + `check:bundle`, `hub-slice-guard.ts S1` | brak zapisanego wyniku z worktree S1. CI PR #520 na `4549a6f1` i CI `main` na `cb7a18df` były w kolejce w chwili spisu (16:19 UTC) - wynik §13.3                                                                                                                          |

### 12.9 Wdrożenie S1 na produkcji (właściciel)

Kod S1 jest na `main` od `cb7a18df`, razem z migracjami. Zależności działają
w obie strony:

- nowy front przed migracjami woła nieistniejące RPC (PGRST202): zapis
  ustawień newslettera, archiwizacja kampanii kuponowej, nadania i zdrowie
  e-mail;
- stary front po `100200` traci bezpośredni UPDATE `status`
  i `newsletter_campaign_id` kampanii kuponowej (granty kolumnowe), a po
  `100400` dostaje 42501 na `admin_grant_membership`.

Dlatego migracje S1 i publikacja frontu z `cb7a18df` idą w jednym oknie.

1. **Warunek:** M0 (§4) wdrożone i `post-deploy` po nim zielony. Emitery S1
   wołają `_log_emit_error` (`090500`), a typy zdarzeń są w katalogu I0.
2. Okno nocne, razem z M0 albo zaraz po nim. Panel Lovable → 5 plików
   **w kolejności wersji**:
   1. `20261020100000_settings_change_events`
   2. `100100_newsletter_settings_patch`
   3. `100200_coupon_events`
   4. `100300_email_health_aggregate`
   5. `100400_membership_grants_single_path`

   Pliki są idempotentne: `CREATE OR REPLACE FUNCTION`,
   `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`, bezstanowe REVOKE/GRANT, zero
   DDL kolumn i tabel. Wyzwalacze i granty na tabelach ruchu stoją za
   `SET lock_timeout = '5s'`. Błąd `55P03` oznacza: ponów cały plik.

3. Zaraz potem opublikuj front z `cb7a18df` albo nowszego `main`.
4. Bliźniaki `0324…0328` są kopiami bajt w bajt, więc po panelu wykonują
   się jako no-op.
5. `workflow_dispatch` CI na `main` → `post-deploy`: `check:db-contract`
   i `check:migration-ledger` (5 wersji) mają być zielone. Wynik wpisz do §10.
6. Kontrola po wdrożeniu (SQL editor, tylko odczyt):

```sql
-- 5 RPC panelu S1: oczekiwane 5 niepustych kolumn.
SELECT to_regprocedure('public.admin_newsletter_settings_patch(text,jsonb,timestamptz)') AS patch,
       to_regprocedure('public.admin_coupon_campaign_set_status(uuid,text,timestamptz)') AS coupon_status,
       to_regprocedure('public.admin_revenue_email_health(timestamptz,timestamptz)') AS email_health,
       to_regprocedure('public.admin_membership_grant_set(uuid,text,timestamptz,text)') AS grant_set,
       to_regprocedure('public.admin_membership_grant_revoke(uuid,text)') AS grant_revoke;
-- 9 nowych wyzwalaczy-emiterów: oczekiwane 9.
SELECT count(*) FROM pg_trigger
 WHERE NOT tgisinternal
   AND tgname IN ('trg_metering_settings_emit','trg_checkout_settings_emit','trg_retention_settings_emit',
                  'trg_content_access_emit','trg_retention_reasons_emit','trg_newsletter_settings_emit',
                  'trg_b2b_coupons_emit','trg_b2b_coupon_campaigns_emit','trg_b2b_coupon_redemptions_emit');
-- Stara ścieżka nadań zamknięta dla sesji: oczekiwane false.
SELECT has_function_privilege('authenticated',
       'public.admin_grant_membership(text,text,integer,text)', 'EXECUTE');
```

Wycofanie: migracje S1 nie mają DDL kolumn ani tabel. Revert kodu przywraca
stary panel, ale wymaga przywrócenia grantów tabelowych na
`b2b_coupon_campaigns` i EXECUTE `admin_grant_membership` osobną migracją
spoza bloku huba, decyzją właściciela. Bez tego stary panel nie zmieni
statusu kampanii ani nie nada członkostwa.

### 12.10 Kryteria akceptacji S1 (SPEC §8.3)

- [x] `/admin/paywall` bez `["admin-access-plans"]` i bez zapisu pełnego wiersza (`adminPlansAllQueryOptions`, `useSaveAccessPlanPatch(owner)` z `assertPatchColumns`). Lost update `tier_key` jest w `planQueries.lostUpdate.test.ts`: druga mutacja z tym samym `updated_at` dostaje 0 wierszy i `40001`, a komunikat podaje `showSaveError` zamiast `toastError` (§12.3). Usunięcie planu w `platformPaywallRoute.test.tsx`: editor `disabled` z powodem, admin z liczbą subskrypcji, przy liczbie > 0 blokada.
- [x] `?tab=` w paywall, pricing i billing z `validateSearch` (`paywallTabs`, `pricingTabs`, `billingTabs` - liście bez importów danych, testy `*Tabs.test.ts`, `paywallTabs.hubLinks.test.ts`). Billing ląduje na właściwej zakładce od `8c8d3050`. Filtr `status` należy do S2 (Z-S1-03).
- [x] `benefits` edytowane tylko w `/admin/pricing` (`TierBenefitsEditor`). Członkostwo pokazuje je tylko do odczytu z `LinkedSourceHeader` (`TierEditorCard`, def. 11). `capability_key` jest opcjonalny w elemencie `benefits` (`tiers.ts`, `TierBenefitsEditorCapability.test.tsx`).
- [x] UI licznika bez wiersza pokazuje stan serwera („wyłączony”), a nie „włączony 5” (`meteringServerState`, `MeteringSettingsCard`, `meteringQueries.test.ts`). To samo robi kontroferta retencji.
- [x] Trzy edytory newslettera piszą tylko swoją grupę kolumn: RPC z białą listą per grupa, test „dwie karty, dwie grupy” (`OverviewPanel.twoTabs.test.tsx`, `settingsQueries.test.ts`) i pgTAP `newsletter_settings_patch_test` 38/38. Pisarze spoza manifestu idą szwem D-S1-04 (Z-S1-07).
- [x] Kampania kuponowa: `{{coupon_code}}` per odbiorca, filtr `segment` (fail-closed), `sent` dopiero po udanej wysyłce. Test na 3 subskrybentach (2 w segmencie) daje dokładnie 2 maile z różnymi kodami (`newsletter-campaigns.coupons.test.ts`). Liczba odbiorców z `countCampaignAudience` jest w `NewsletterCouponPanel` przed wysyłką (R-25, `newsletter-campaigns.audience.test.ts`).
- [x] `renderCampaign.server.ts`: HTML bajt w bajt przed i po wyniesieniu. 48 skrótów SHA-256 policzonych na implementacji z `a90e66c4` i 2 pełne przypadki (`renderCampaign.server.test.ts`).
- [x] `author` nie wywoła `sendCampaign`: middleware `requireAdminEditor` (`newsletterCampaignSend.test.ts`) i bramka w handlerze (`newsletter-campaigns.roles.test.ts`).
- [x] Nadania: jedna ścieżka (`admin_membership_grant_set` i `admin_membership_grant_revoke` z panelu i katalogu członków), wpis w `audit_log`, wygaszanie tylko `source='manual'` (pgTAP `membership_grants_single_path_test` 31/31). Stara funkcja bez EXECUTE dla `authenticated` (Z-S1-09).
- [x] Organizmy wyniesione z `admin.paywall.tsx` (1149 → 123 linie) mają testy charakteryzujące: `paywallOrganisms.readOnly.test.tsx`, `AccessPlanEditorDialog.helpers.test.ts` i rozszerzony `platformPaywallRoute.test.tsx`.
- [x] pgTAP 5 plików zielony na `cb7a18df` (162 asercje). Literały kluczy usunięte ze wszystkich 19 plików S1 (bramka 2026-10-19). Ekrany S1 mają sekcyjny `adminPageHead`.
- [ ] Delta bundla (`overall`, `css`) w opisie PR; `public` 0 - **niespełnione w części**. `overall` jest w ratchecie łącznym I0 + S6 + S1 (≤ +34,5 dla S1, §12.7). Osobnych liczb S1 dla `public`, entry i `css` nie zapisano - do uzupełnienia przez orkiestratora.

## 13. Po scaleniu PR #520 (2026-10-19)

### 13.1 Scalenie i dalsze wycinki

- PR #520 (`claude/great-dirac-gzks9w`) scalono do `main` 2026-10-19
  o 16:01:58 UTC jako merge commit `cb7a18df`. Zawartość: cennik v6.2, I0,
  S6, S1, poprawki po recenzji Codex, ratchet D-08 i renumeracja bliźniaków.
- Dalsze wycinki - S4, S2, S3, S5, S7, S8 i I9, w kolejności z §8.2 - idą
  w **nowym PR** z gałęzi `claude/elegant-fermat-xwfca1` (świeży
  `origin/main` po scaleniu). Bliźniaki drizzle numeruje Integrator od
  `0330` przy scaleniu każdego wycinka (§6).
- Produkcja: M0 (§4) i S1 (§12.9) wdrożone 2026-10-19 przez Lovable
  migratorem Drizzle (0313…0328 + potwierdzenie `0329`, commit `e6620f60`).
  Wiersze M0 i S1 w §10 uzupełnić po `post-deploy`.

### 13.2 pgTAP na `cb7a18df` (lokalnie, orkiestrator)

213 plików: **209 OK**, 4 z błędem środowiska. Żaden z nich nie jest plikiem
huba ani regresją PR #520.

| Plik                                  | Błąd                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `community_cron_schedule_test`        | 2 asercje `pg_net` (jak w §9)                                            |
| `job_scheduler_heartbeat_test`        | 1 asercja `pg_net` (jak w §9)                                            |
| `public_definer_views_read_only_test` | 1b/3 - domyślne uprawnienia `public` w lokalnym klastrze (jak w §9)      |
| `profile_intent_semantic_test`        | typ `extensions.vector` bez pgvector w lokalnym klastrze (nowe w spisie) |

Pliki huba są zielone. I0: `hub_schema_rls_test` 58, `hub_shared_helpers_test` 27. S1: `hub_settings_events_test` 32, `newsletter_settings_patch_test` 38,
`coupon_events_test` 37, `email_health_aggregate_test` 24,
`membership_grants_single_path_test` 31. S6 nie ma SQL -
`ts_sql_contract_test` jest w puli zielonych.

### 13.3 CI na `main`

- **Przed scaleniem** - `9f6173f2` (commit Lovable „Wdrożył brakującą
  migrację”, 14:11 UTC). Workflow `CI` ✗: job `verify`, kroki
  „Format (prettier)” i „Lint”, a w ślad za nimi `Required release checks`.
  Workflow `First visit on production artifacts` ✗: kroki
  „Gate document weight of the candidate (blocking)” i „… candidate post
  (blocking)”. Pozostałe joby ✓ (test-shards 1-4, build, pgtap, pg-harness,
  e2e, e2e-seeded, lighthouse, cms-widgets), `post-deploy` ✓.
  Przyczyna i naprawa: na `cb7a18df` `verify` (Format, Lint, Typecheck) jest
  już zielony - lokalnie `format:check` ✓ i `lint` 0 błędów (279 ostrzeżeń
  sprzed PR). `First visit…` (waga dokumentu kandydata) był czerwony na samym
  `main` przed scaleniem huba (`9f6173f2`) - nie jest skutkiem PR #520,
  zostaje zgłoszony właścicielowi (Z-13-01).
- **PR #520:** na `a303246e` ✗ `Migration lanes` i `supabaseLaneCoverage.test.ts`
  (zgubione wpisy dziennika, naprawione w `4549a6f1`). Na `4549a6f1` joby
  były w kolejce w chwili scalenia.
- **Po scaleniu** - `cb7a18df`: workflow `CI`, `E2E`, `Lighthouse CI`,
  `CMS widget performance` i `First visit…` w kolejce od 16:02 UTC.
  Wynik: `verify`, `test-shards` 1-4, `pgtap`, `pg-harness`, `post-deploy`
  ✓; `build` ✗ wyłącznie w kroku „Bundle size budget”: `overall` 4970,7 >
  4959 (lokalny pomiar tego samego commitu: public 2772,5 / 2881, chunk 257,5 /
  286, css 99,7 / 100, public CSS 83,8 / 85, boot 471,3 / 579). Przyrost +13,4
  KB to scalenie `main` w `a303246e` (PR #525 i commit Lovable); naprawa:
  ratchet `overall` 4959 → 4972 z wpisem w kronice (D-08, commit `8cbd4a53`
  w nowym PR). Ten sam wynik na `e6620f60` („Wdrożono PR #520”, Lovable:
  bliźniak `0329`, regeneracja `types.ts`, wpis pasa w
  `migrationLaneParity.ts`) - scalone do gałęzi `claude/elegant-fermat-xwfca1`
  w `732b8837`; następny wolny numer drizzle to **0330**.

### 13.4 Otwarte kwestie spoza PR (z rozmowy właściciela)

| Kwestia                                               | Stan      | Commit na `main`                                                                                                                                                                         |
| ----------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `builder_experiment_events.tenant_id` (zdarzenia A/B) | zamknięte | `97d936f4` (migracja `20261019090000` + bliźniak `0312`, `tenant_id` z eksperymentu); migracja wdrożona przez Lovable w `9f6173f2`, `post-deploy` ✓                                      |
| Transliteracja „ł” w slugach importu WP               | zamknięte | `b81bf827` (wspólne `wp-import/slug.ts`, stare slugi odnajdywane przez `legacySlugify`)                                                                                                  |
| Limity `duration`/`interval` licznika i karuzeli      | zamknięte | `96f05290` (`lib/blocks/animationRanges`, `ClampedNumberInput`)                                                                                                                          |
| Płaski kolor ramki widgetu przy `setMode`             | zamknięte | `403779f6` (edycja jasnego nie stempluje ciemnego) + `819f079c` (`setInvertibleMode` bez klucza obliczanego w literale)                                                                  |
| `hideOn` węzłów w kandydacie LCP                      | zamknięte | `f922f0fa` (sekcje, sekcje zagnieżdżone i kolumny schowane na urządzeniu nie dostają preloadu ani `fetchpriority=high`)                                                                  |
| Strefa grupowania dni w `CalendarView`                | zamknięte | `3bd710ae` (granice zapytania, dzień siatki i bieżący miesiąc w `SITE_TIME_ZONE`)                                                                                                        |
| `JoinUsForm` - surowe identyfikatory pól              | w toku    | decyzja właściciela 2026-10-19 „napraw”: osobny PR do `main` z gałęzi `claude/joinus-form-field-labels` (komunikaty ze wspólnego `subscribeFeedback`, etykiety pól zamiast kluczy)       |
| `First visit` - waga dokumentu kandydata (Z-13-01)    | w toku    | decyzja właściciela 2026-10-19 „napraw”: osobny PR do `main`; przyczyna `5c5f4d25` (PR #525: pełny `HOVER_ALLSIDES_CSS` w `<head>` strony głównej) oraz `bootBurstCount` wpisu 121 > 115 |

## 14. Uspójnienie benchmarków S6 z pakietem Insidera (2026-10-19)

Decyzja właściciela 2026-10-19 („uspójnij to”) dla 29 par różnic liczbowych z
`docs/WIEDZA_INSIDER_MARKETINGOWY_2026-10-19.md` §5.1.4. Gałąź
`hub/s6-uspojnienie` (baza `83b649e3`, commit `aa601f8f`), scalona
fast-forwardem do `claude/elegant-fermat-xwfca1`; własność S6 (dane i źródła
rejestru wskaźników).

### 14.1 Reguły

1. Ocena w hubie (5 stopni) pochodzi wyłącznie z kontekstów S6; Insider nie
   daje drugiego werdyktu dla tej samej pary (metryka, kontekst).
2. Inny kontekst istotny dla NES (kanał, segment, okres, mianownik) - nowy
   kontekst S6 z pasmami wyprowadzonymi metodyką S6 i źródłem.
3. Ten sam kontekst, różne liczby - wygrywa źródło wg kolejności: zgodność
   definicji i mianownika, wiarygodność (A > B > C), świeższy okres, próba,
   bliskość kontekstu NES.
4. Przegrany rekord Insidera zostaje „punktem odniesienia” (bez etykiety
   oceny); każdy rekord ma pole `hub` (`metricId`, `status`, `s6Context`,
   `reason`) w `ranges.json`/`refs.json` (schemat pakietu /2).
5. Bez mieszania okresów, ułamków i walut; przeliczenie tylko jawnym wzorem
   (churn roczny z miesięcznego: `1 − (1 − m)^12`).
6. Żadnych liczb spoza źródeł; heurystyki S6 oznaczone w `method`.

### 14.2 Wynik

| Wynik                                                                                                                            | Liczba               |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Pary z §5.1.4: wygrało S6 (Insider → odniesienie)                                                                                | 16                   |
| Pary z §5.1.4: Insider tylko odniesieniem (inny mianownik, zgodne punkty)                                                        | 13                   |
| Korekty pasm S6                                                                                                                  | 0                    |
| Nowe konteksty S6 (`signup_form_conversion_rate`: LinkedIn Lead Gen Forms - treść i demo; kwartyle Kiin Labs 2026, nie domyślne) | 2                    |
| Rekordy pakietu z polem `hub` (26 przedziałów, 58 punktów)                                                                       | 84                   |
| Rejestr S6 po zmianie: wpisy / konteksty / pasma / źródła                                                                        | 76 / 193 / 968 / 189 |

Tabela par z rozstrzygnięciem i powodem: kolumna „Rozstrzygnięcie” w
`docs/WIEDZA_INSIDER_MARKETINGOWY_2026-10-19.md` §5.1.4 (pary pominięte -
§5.1.4a); źródła nowych kontekstów: `docs/BENCHMARKI_WSKAZNIKOW_2026-10-18.md`
(„Uzupełnienie 2026-10-19”).

### 14.3 Zmiany integratorskie

- `src/lib/ci/hubDelivery.ts`: manifest S6 += `docs/BENCHMARKI_WSKAZNIKOW_2026-10-18.md`,
  `docs/WIEDZA_INSIDER_MARKETINGOWY_2026-10-19.md`,
  `docs/benchmarki/insider-2026-10-19/*.json` (dane i metodyka rejestru należą
  do S6). `hub-slice-guard S6 --base 83b649e3`: jedyne naruszenie to ta zmiana.

### 14.4 Weryfikacja

| Bramka                                                                                         | Wynik                                    |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `import-benchmarks.ts docs/benchmarki/2026-10-18` i `--check`                                  | 8 plików zgodnych, 0 ostrzeżeń           |
| `vitest` `src/lib/analytics/semantic src/components/admin/analytics src/lib/charts src/lib/ci` | 164 pliki, 4168 testów ✓ (+2 oczekiwane) |
| `hubDelivery.gate.test.ts`                                                                     | 49/49 ✓                                  |
| `typecheck`, `eslint` (zmienione `.ts`), `prettier --check` (12 plików)                        | ✓                                        |
| Weryfikator pakietu (poza repo - zawiera wzorzec znaczników prywatnych)                        | OK, 59 rekordów w 29 parach              |
| Pełne bramki przed pushem                                                                      | razem z najbliższym wycinkiem (S4)       |

### 14.5 Do potwierdzenia przez właściciela (nieblokujące)

| Nr      | Kwestia                                                                                                                                                                                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Z-14-01 | P25 kontekstów LinkedIn (4,6% i 1,0%) i liczby kont (173, 87) odczytane ze strony źródła Kiin Labs 2026-10-19 - pakiet Insidera miał tylko P50/P75/P90. Rekomendacja: zostawić. **Zamknięte w I9b (§22.2 B5): akceptacja „zostawić”.**                                 |
| Z-14-02 | Kontekst „demo” pod formularzem zapisu - lead B2B → oferta; dostępny do wyboru, nie domyślny. Rekomendacja: zostawić. **Zamknięte w I9b (§22.2 B5): akceptacja „zostawić”.**                                                                                           |
| Z-14-03 | `b-engr` (zaangażowanie GA4) wymagałby nowego wpisu rejestru (nowego klucza) - osobna decyzja S6. **Zamknięte w I9b (§22.2 B5): BI ma źródło (GA4 Data API, metryka `engagement_rate`) - nowy wpis rejestru `engagement_rate` z pasmami z `b-engr` i Siege Media.**    |
| Z-14-04 | Kontekst strony cennika self-serve stoi na źródle C (SaasDash); przy następnym przeglądzie poszukać pierwotnego benchmarku. **Zamknięte w I9b (§22.2 B5): przegląd 2026-10-20 - brak weryfikowalnego źródła A/B dla tej definicji; kontekst zostaje na SaasDash (C).** |

## 15. Wycinek S4 - CRM, automatyzacje i społeczność (dane) (2026-10-19)

Gałąź `hub/s4-crm-spolecznosc` (worktree `/home/user/wt/S4`), wykonawca na
bazie `e69234c1`, przebazowana przez Integratora na `e135b91a` (§14), potem
fast-forward do `claude/elegant-fermat-xwfca1`. Commity:

- `173620bc` - 8 migracji `2026102013*`, pgTAP, akcje v2 przepisów, przekroje huba;
- `400e0f23` - billing pisze cykl życia, filtry CRM, karta historii etapów, naprawy D7/D14/P13/P23/P24;
- `40c5ec73` - integracja: pliki współdzielone (§15.4);
- `b528e3ed` - `lock_timeout` w `130300` (Integrator, §15.3);
- `09e8b5ef`, `42ad5407` - dwa błędy `tsgo` w plikach wycinka (Integrator, §15.8);
- `2b022e0c` - pgTAP `hub_schema_rls_test` po wyzwalaczu historii etapów (Integrator, §15.8);
- `52cd0e68` - wpięcie `events` i `clubs` w migawkę huba (Z-S6-16, §15.4);
- `75c2ce1d`, `59a73242` - ratchet `overall` 4972 → 4981 → 4982 (D-08, §15.7);
- `52f59cae`, `bf9108ea` - dwie czerwienie pełnego vitest (test webhooka
  z martwym `?retention=1`, bramka `overlayReaders` dla `adminCrm`;
  Integrator, §15.8);
- ten wpis.

### 15.1 Zakres

Wykonawca: 73 pliki, +9807 / −264 linii (2 commity). Z integracją (bez tego
wpisu): 94 pliki, +12 867 / −297.

| Obszar                       | Co dostarcza S4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL (8 migracji, 17 funkcji) | `130000_crm_lifecycle_history`: wyzwalacze `trg_crm_leads_00_hub_guard` (Z-06: zmiana `user_id`, `lifecycle_stage`, `lifecycle_changed_at` tylko z zaufanego pisarza SECURITY DEFINER albo `service_role` - admin i redaktor przez PostgREST dostają 42501; `customer`/`former_customer` wyłącznie ze źródła `billing`) i `trg_crm_leads_stage_history` (`tg_crm_leads_stage_history`); `crm_set_lifecycle_stage(p_lead_id, p_stage, p_source, p_allow_backward)` dla `service_role` z pierwszeństwem billing > manual > journey = workflow > system; `admin_crm_set_lifecycle_stage(p_lead_id, p_stage)` dla panelu; `crm_tasks.source`/`origin_ref` poza grantem kolumnowym `authenticated`; widok `crm_leads_all` (+ `source_type`, `lifecycle_stage`, `lifecycle_changed_at`); historia etapów sprzedaży odtworzona z `audit_log`. `130100_crm_user_id_profile_writer`: `crm_upsert_lead_from_profile` ustawia `user_id`, segment i cykl życia `registered` (P16) + jednorazowy backfill bez zalewu zdarzeń. `130200_workflow_actions_v2`: akcje v2 w `run_workflow_step` (`set_lifecycle_stage`, `set_crm_stage`, `add_tag`/`remove_tag` z limitem 40 znaków odrzucanym, `assign_owner`, `newsletter_list_add`/`_remove`, `create_crm_task` z `assignee_id`, `source`, `origin_ref`, `due_hours` - P24), naprawy D1 i D9, `newsletter_subscriber_list_set`, `origin_ref` w szablonach retencyjnych. `130300_workflow_engine_fixes`: UNIQUE `(workflow_id, event_id)` po deduplikacji (D6), uczciwy `steps_completed` (D3), ślad awarii silnika w `_log_emit_error` (D5), bramka `install_workflow_template` = admin/redaktor (D4), `workflow_definition.changed.v1`. `130400_crm_dashboard_fixes`: pulpit bez anulowanych zadań (D11). `130500_club_application_events`: `club_application.{submitted,decided}.v1` (klub `secret` nie emituje), `club_application_crm_sync` bez obniżania segmentu. `130600_event_attended_revenue_net`: `event.registration.attended.v1`, `_event_revenue_net` jako jedno źródło przychodu, `admin_event_ads_funnel` bit w bit. `130700_revenue_community_aggregates`: `admin_revenue_events_summary`, `admin_revenue_clubs_summary` (`-- pg-harness: exclude`). pgTAP: 8 plików (160 asercji) + poprawiony `cohesion_layer_test.sql`. |
| Automatyzacje (TS)           | `WORKFLOW_ACTIONS` = `CASE` w `run_workflow_step` (test parsuje migrację, także `WHEN` z dwiema etykietami); typy zdarzeń wieloczłonowe w walidacji (D2); edytor przepisu z listami etapów, pickerem osoby zespołu i walidacją parametrów inline; `workflowQueries.ts` (`queryOptions`, mutacje z jedną inwalidacją, optymistyczny przełącznik).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Billing → CRM                | `purchaseEffects.server.ts` (P12, P13, P23): `customer`/`former_customer` przez `crm_set_lifecycle_stage(…, 'billing', p_allow_backward => true)`; pauza i `past_due` zostają klientem z tagiem; zakup podnosi `source_type` (lustro rangi z testem parytetu); zadania retencyjne zamykane po pauzie i wznowieniu (`origin_ref 'retention:*'`); martwy `?retention=1` usunięty (`href = /profile/plan`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CRM (panel)                  | Filtry cyklu życia, segmentu (`source_type` = `CRM_SOURCE_TYPES` = CHECK), tagów i właściciela (pasmo score było); migracja zapisanych widoków; `LeadStageHistoryCard` i zmiana cyklu życia na karcie leada; źródło zadania w `LeadTasksPanel`; zbiorcze przypisanie zadań bez osoby (`assignUnassignedCrmTasks`, P24); sekcyjny `adminPageHead` na `/admin/crm`, `/admin/crm/$id`, `/admin/crm/funnel`, `/admin/companies`, `/admin/companies/$id`, `/admin/workflows` (D14). Literały kluczy React Query usunięte z 19 plików długu S4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Społeczność (dane huba)      | `src/lib/revenue/community/{dto,parse,community.functions,queries}.ts`: parsery z `-- rpc-shape`, server fns ze stanami `forbidden`/`unavailable`, `queryOptions` przekrojów (`revenueKeys.query('events'                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 'clubs', najemca, okno)`) i zejścia do wydarzenia na kluczach studia (`registrationKeys.counts`, `adsFunnelKeys.report`). `ClubApplicationsInbox`(br. 04 D7): inwalidacja drzewa klubów i`pendingCounts`, filtry kontrolowane przez trasę. |
| Słowniki                     | `i18n-admin-crm-lifecycle.ts`, `i18n-admin-revenue-community.ts` (prefiks `adminRevenue.community`), rozszerzony `i18n-admin-workflows.ts`; testy parytetu PL/EN.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 15.2 Decyzje

- **S4 prosto do gałęzi PR `claude/elegant-fermat-xwfca1`** (orkiestrator,
  §13.1), jak S1 w PR #520: migracje, bliźniaki i kod w jednym PR.
- **D-10 (domyślna osoba zadań bez właściciela):** kolejność `assignee_id`
  z parametru (tylko zespół najemcy) → właściciel leada →
  `journey_settings.default_task_assignee_id`; pusta osoba jest dozwolona,
  bo działa naprawa zbiorcza P24.
- **Typy bazy (R-07):** sygnatur 6 RPC S4 i kolumn widoku `crm_leads_all`
  Integrator nie dopisał do `types.ts` - `check:types-freshness`
  i `typecheck` są zielone bez nich, wywołania idą przez `RpcCallable`
  i `looseTable`. Lovable regeneruje `types.ts` po wdrożeniu (tak weszły
  sygnatury S1 w `e6620f60`); rzutowania zdejmuje I9 (Z-S4-02).
- **D-08:** ratchet `overall` 4972 → 4982 (zmierzony przyrost +9,9 KB na drzewie końcowym, §15.7). `css` bez zmian (99,7 = baza).

### 15.3 Odchylenia od SPEC (kontrakt bez zmian, fakty repozytorium wygrywają)

| Miejsce SPEC / karta S4                                                  | Stan po S4                                                                                                                                                                       | Uzasadnienie                                                                                                                                                                      |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §8.5 pkt 3 (PR-A migracje → wdrożenie → PR-B kod)                        | Migracje `2026102013*`, bliźniaki `0330…0337` i kod S4 w jednym PR.                                                                                                              | Decyzja orkiestratora (§13.1). Procedura okna wdrożenia - §15.9.                                                                                                                  |
| §4.8 `CIALO-Z` `crm_upsert_lead_from_profile`                            | `20260722093022` (ostatnia definicja ciała), nie `20261007140500`.                                                                                                               | `20261007140500` zmienia tylko granty - jak w §3 (I0).                                                                                                                            |
| Karta: `club_application_crm_sync` (2 przeciążenia, `specialization_id`) | Jedno przeciążenie (`uuid`); payload zdarzenia niesie slug `specialization`.                                                                                                     | Stan bazy: jedno przeciążenie, tabela bez `specialization_id`.                                                                                                                    |
| Ranga segmentu w `club_application_crm_sync`                             | Lista rang ≥ 70 wpisana w ciało; zgodność z `_crm_source_type_rank` pilnuje asercja `club_application_events_test`.                                                              | Atrapa `check:pg-harness` nie ma `_crm_source_type_rank`.                                                                                                                         |
| Przekrój wydarzeń w oknie                                                | Kohorta = wydarzenia (bez szkiców) ze `starts_at` w oknie; przychód per wydarzenie całościowy (`_event_revenue_net` bez granic) = raport lejka studia w presecie „all”.          | Jedna liczba w hubie i w studiu wydarzenia.                                                                                                                                       |
| Historia etapów ze źródłem `bulk`/`import`                               | Zapisy przez PostgREST (także zbiorcze i import) trafiają jako `manual` z aktorem z sesji.                                                                                       | PostgREST nie ustawi GUC `app.change_source`; RPC i automaty ustawiają źródło jawnie.                                                                                             |
| Z-06 dla `crm_tasks` przez wyzwalacz                                     | `REVOKE INSERT, UPDATE` + kolumnowe `GRANT` dla `authenticated` bez `source`, `origin_ref`; test kompletności listy i 42501.                                                     | Rejestr `hubDelivery` nie ma wyzwalacza `crm_tasks`.                                                                                                                              |
| P13 `past_due` (stary test: brak skutku w CRM)                           | Tag `subscription:past_due`, etap `won`, cykl `customer`, bez dzwonka i maila.                                                                                                   | Litera SPEC P13; stary test zaktualizowany.                                                                                                                                       |
| P23 filtr źródła                                                         | Panel filtruje po `source_type`; heurystyczny `source` zostaje w API, zapisane widoki migrowane przy wczytaniu (Z-S4-12).                                                        | Kompatybilność API i `leadListParity` spoza manifestu.                                                                                                                            |
| `create_crm_task` - tytuł                                                | Niewymagany w edytorze (silnik nadaje `Follow-up`); `origin_ref` > 200 znaków odrzucany.                                                                                         | Zgodnie z silnikiem.                                                                                                                                                              |
| Akcje listy newslettera                                                  | Przy zdarzeniu agregatu `crm_lead` adres z leada; automat nadal nie zapisuje nikogo na newsletter (D9).                                                                          | Przepisy uruchamiane zmianą etapu.                                                                                                                                                |
| a11y: testy axe                                                          | Brak `vitest-axe`/`jest-axe` w repo - role, `aria-*` i zdania `sr-only` w RTL.                                                                                                   | Zero nowych zależności (§8.6).                                                                                                                                                    |
| `130300` bez `lock_timeout` (wykonawca)                                  | Integrator dodał `SET lock_timeout = '5s'` wokół deduplikacji i indeksu `workflow_runs` oraz `DROP/CREATE TRIGGER` na `domain_events` (`b528e3ed`, bliźniak `0333` bajt w bajt). | `domain_events` przyjmuje każde zdarzenie szyny - blokada bez limitu za długą transakcją wstrzymałaby emisję wszystkich modułów (zasada „`lock_timeout` przy gorących tabelach”). |
| Weryfikacja karty: `run.sh … 'a\|b\|c'`                                  | `run.sh` filtrował wzorzec w BRE i uruchamiał 0 plików z wynikiem zielonym; od `40c5ec73` - ERE (`grep -E`).                                                                     | Z-S4-08 (fałszywa zieleń w kartach wszystkich wycinków).                                                                                                                          |

### 15.4 Zgłoszenia „Do integracji” wykonane przez Integratora S4

Strażnik `hub-slice-guard.ts S4 --base e135b91a` po integracji (95 plików)
zgłasza wyłącznie zmiany Integratora: `[plik-wspoldzielony]`
`drizzle/migrations/meta/_journal.json`, `scripts/check-bundle-size.ts`,
`src/lib/__tests__/queryKeyLiterals.gate.test.ts`, `src/lib/ci/hubDelivery.ts`
oraz `[poza-manifestem]` ten dziennik. Pliki spoza manifestu, których
wymagały bramki, dopisano do manifestu S4 z komentarzem „Integrator S4”.

| ID / zgłoszenie     | Zmiana                                                                                                                                                                                                                                                                                                                                                      | Pliki                                                                                                                          | Dowód                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Z-S4-01             | 8 bliźniaków drizzle (bajt w bajt) i 8 wpisów `_journal.json` w kolejności wersji (§15.6).                                                                                                                                                                                                                                                                  | `drizzle/migrations/033{0…7}_*.sql`, `meta/_journal.json`                                                                      | `check:migration-lanes` ✓ (338 wpisów), `supabaseLaneCoverage.test.ts` ✓, `cmp` ✓                                                                          |
| Z-S1-02             | Globy bliźniaków w manifestach po renumeracji `4549a6f1`: I0 `{0318…0323}_hub_*`, S1 `{0324…0328}_*`; S4 `{0330…0337}_*`.                                                                                                                                                                                                                                   | `src/lib/ci/hubDelivery.ts`                                                                                                    | `hubDelivery.gate.test.ts` ✓                                                                                                                               |
| Z-S4-03             | `crmKeys.staffUsers()` (kształt `["crm-staff-users"]` bez zmian) zamiast `crmStaffUsersKey()`; wiersz w tabeli par fabryk.                                                                                                                                                                                                                                  | `src/lib/crm/keys.ts`, `src/lib/crm/leadMutations.ts`, `src/lib/__tests__/hubKeyFactories.test.ts`                             | `hubKeyFactories.test.ts` ✓ (test kompletności)                                                                                                            |
| Z-S4-04             | 19 plików S4 zdjętych z `QUERY_KEY_LITERAL_DEBT` (41 → 22) - literał w nich czerwieni teraz bramkę.                                                                                                                                                                                                                                                         | `src/lib/__tests__/queryKeyLiterals.gate.test.ts`                                                                              | `queryKeyLiterals.gate.test.ts` ✓                                                                                                                          |
| Z-S4-05 (br. 04 D7) | `/admin/community/clubs/applications`: `validateSearch` (`spec` < 80, `status` ze słownika, `q` < 200, pola opcjonalne) i skrzynka w trybie kontrolowanym; zmiana filtra zastępuje wpis historii. Walidator bez importu modułu skrzynki (chunk wejściowy) - lustro statusów pod testem.                                                                     | `src/routes/admin.community.clubs.applications.tsx`, `src/routes/__tests__/adminClubRoutes.test.tsx`                           | 4 nowe przypadki w `adminClubRoutes.test.tsx` (parytet `APPLICATION_STATUSES`, odcięcie śmieci, tryb kontrolowany, `replace`)                              |
| Z-S6-16 / Z-S4-06   | `REVENUE_DOMAIN_READS.events/clubs` wołają `admin_revenue_{events,clubs}_summary(p_since, p_until)` - dokładnie `WPIECIA_DOCELOWE`. Kształt S4 jest płaski jak `REVENUE_{EVENTS,CLUBS}_KEYS`, więc bez adaptera (inaczej niż `email`, Z-S1-01); przed wdrożeniem `130700` PGRST202 = `not_configured`.                                                      | `src/lib/analytics/semantic/revenueSnapshot.functions.ts`                                                                      | `snapshot.functions.test.ts` („każde wpięcie produkcyjne woła SWOJĄ funkcję”) ✓; `check:ts-sql-contract` 929 wywołań RPC (+2), pgTAP `ts_sql_contract` 9/9 |
| Z-S4-08             | `run.sh`: wzorzec w ERE (`grep -E`).                                                                                                                                                                                                                                                                                                                        | `scripts/pgtap-local/run.sh`                                                                                                   | `run.sh test 'crm_\|workflow_\|…'` uruchamia pliki karty                                                                                                   |
| pełny vitest        | `-webhook.test.ts` przypinał martwy `?retention=1` w dzwonku rezygnacji - asercja przypina `/profile/plan` (karta S4: parametr usunięty). Bramka `overlayReaders`: korzeń `adminCrm` nakładki `i18n-admin-crm-lifecycle` bez czytelnika - `crmLifecycleDict` przeniesiony do `components/admin/crm/crmLifecycleLabels.ts` i czyta gałąź z magazynu i18next. | `src/routes/api/public/payments/-webhook.test.ts`, `src/components/admin/crm/crmLifecycleLabels.ts` (+ 4 konsumenty, nakładka) | shard 2/4 i 3/4 ponowione na zielono (§15.8)                                                                                                               |
| `tsgo`              | TS2367 w `LeadFilterChips.tsx` (porównanie po zawężeniu) i TS2353 w scenie `purchaseEffects.server.test.ts` (`source_type`) - wykonawca nie miał pełnego typechecku po ostatnich zmianach.                                                                                                                                                                  | pliki wycinka                                                                                                                  | `bun run typecheck` ✓                                                                                                                                      |
| pgTAP               | `hub_schema_rls_test` 48 (I0): izolacja historii etapów po `DISTINCT tenant_id` - wyzwalacz S4 dopisuje wiersz historii przy INSERT leada w fixture'ze.                                                                                                                                                                                                     | `supabase/tests/hub_schema_rls_test.sql`                                                                                       | 58/58                                                                                                                                                      |
| `lock_timeout`      | `130300`: `SET lock_timeout = '5s'` wokół deduplikacji/indeksu `workflow_runs` i wyzwalacza na `domain_events` (§15.3).                                                                                                                                                                                                                                     | `supabase/migrations/20261020130300_*.sql`, `drizzle/migrations/0333_*.sql`                                                    | pgTAP `workflow_engine_fixes` 18/18, ponowne zastosowanie rc=0, `cmp` ✓                                                                                    |
| -                   | Manifest S4 += pliki integracyjne z wierszy wyżej (z komentarzem „Integrator S4”).                                                                                                                                                                                                                                                                          | `src/lib/ci/hubDelivery.ts`                                                                                                    | `hub-slice-guard.ts S4` - wyłącznie pliki współdzielone                                                                                                    |
| D-08                | Ratchet `overall` 4972 → 4982 (dwa kroki) z wpisem w kronice.                                                                                                                                                                                                                                                                                               | `scripts/check-bundle-size.ts` (plik współdzielony)                                                                            | §15.7, `check:bundle` ✓                                                                                                                                    |

Niewykonane (świadomie): sygnatury RPC w `types.ts` (§15.2, Z-S4-02) oraz
regeneracja `reports/i18n-parity.json` (plik raportu nadpisuje każdy pełny
przebieg vitest; przywrócony, Z-S4-09).

### 15.5 Zgłoszenia otwarte

| ID      | Zgłoszenie                                                                                                                                                                                                                                                                                                                                                                                                               | Właściciel / termin                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Z-S4-02 | **Sygnatury 6 RPC S4 i kolumny `crm_leads_all` w `types.ts`** (`admin_crm_set_lifecycle_stage`, `crm_set_lifecycle_stage`, `newsletter_subscriber_list_set`, `admin_revenue_{events,clubs}_summary`, `_event_revenue_net`; `source_type`, `lifecycle_stage`, `lifecycle_changed_at`). Po regeneracji Lovable zdjąć rzutowania `RpcCallable` w `crm.functions.ts`, `purchaseEffects.server.ts`, `community.functions.ts`. | I9 / Lovable po wdrożeniu (R-07)                |
| Z-S4-07 | UI zakładki „Społeczność” huba (S7) używa `revenueEventsSummaryQueryOptions` / `revenueClubsSummaryQueryOptions` i słownika `adminRevenue.community`; reguła diagnostyki P24 (S7) woła `assignUnassignedCrmTasks`.                                                                                                                                                                                                       | S7                                              |
| Z-S4-09 | Raport `i18n-parity`: `repoWide.untranslated` 559 → 570 (+11) - zapożyczenia (Lead, MQL, SQL, Newsletter, Billing, Import, System, Tag, Segment) w niebramkowanych prefiksach `adminCrm`/`adminWorkflows`. Bramkowany `adminRevenue` - 0. Raport w repo nieodświeżony.                                                                                                                                                   | I9 (decyzja: wyjątki słownika albo tłumaczenia) |
| Z-S4-10 | 3 ostrzeżenia `react-refresh/only-export-components`: helpery obok komponentów w `LeadStageHistoryCard.tsx` (`parseStageHistory`, `leadStageHistoryQueryOptions`) i `ClubApplicationsInbox.tsx` (`inboxDecisionInvalidations`) - do `lib`, gdy pliki klubów będą w zasięgu.                                                                                                                                              | I9                                              |
| Z-S4-11 | `src/lib/ci/__tests__/onConflictArbiters.test.ts` (wydajność, 15 tys. celów) przekracza próg pod obciążeniem CPU innych sesji; sam przechodzi.                                                                                                                                                                                                                                                                           | środowisko (informacyjne)                       |
| Z-S4-12 | Heurystyczny filtr `source='import'` (`leadListSpec`) nie trafia w nic (`source_count` domyślnie 1). Został dla kompatybilności API i `leadListParity`; panel go nie wysyła.                                                                                                                                                                                                                                             | I9                                              |
| Z-S4-13 | `crm_leads` po `130000`: zmiana `user_id`/`lifecycle_stage`/`lifecycle_changed_at` z sesji klienta = 42501. Stary front ich nie pisze, ale każdy przyszły pisarz musi iść przez RPC (`admin_crm_set_lifecycle_stage`) - wpis dla S5/S7.                                                                                                                                                                                  | S5, S7 (informacyjne)                           |
| Z-S4-14 | Lokalne środowisko: `tsgo` z nieaktualnym `node_modules/.cache/tsconfig.tsbuildinfo` (po przebazowaniu) przekraczał limit pamięci cgroup 14,3 GB (OOM, exit 137, także na bazie). Bez pliku buildinfo pełny `bun run typecheck` przechodzi. Dla kolejnych Integratorów: przy SIGKILL usunąć buildinfo przed typecheckiem.                                                                                                | informacyjne                                    |

### 15.6 Bliźniaki drizzle

| Wersja supabase                               | Bliźniak                            | idx | `when`        |
| --------------------------------------------- | ----------------------------------- | --- | ------------- |
| `20261020130000_crm_lifecycle_history`        | `0330_crm_lifecycle_history`        | 330 | 1792426365539 |
| `20261020130100_crm_user_id_profile_writer`   | `0331_crm_user_id_profile_writer`   | 331 | 1792426425539 |
| `20261020130200_workflow_actions_v2`          | `0332_workflow_actions_v2`          | 332 | 1792426485539 |
| `20261020130300_workflow_engine_fixes`        | `0333_workflow_engine_fixes`        | 333 | 1792426545539 |
| `20261020130400_crm_dashboard_fixes`          | `0334_crm_dashboard_fixes`          | 334 | 1792426605539 |
| `20261020130500_club_application_events`      | `0335_club_application_events`      | 335 | 1792426665539 |
| `20261020130600_event_attended_revenue_net`   | `0336_event_attended_revenue_net`   | 336 | 1792426725539 |
| `20261020130700_revenue_community_aggregates` | `0337_revenue_community_aggregates` | 337 | 1792426785539 |

Numery od pierwszego wolnego na `origin/main` (`e6620f60`, ostatni `0329`),
`when` = 1792426305539 (`0329`) + n·60 000. `cmp` supabase ⇄ drizzle: bajt
w bajt (także `0333` po poprawce `lock_timeout`). **Następny wolny numer:
`0338`** (idx 338) - nie jest rezerwacją (§6).

### 15.7 Pomiar bundla

`flock -o /tmp/hub-build.lock env BUNDLE_INVENTORY=1 bun run build` +
`check:bundle`, ten sam host i te same `node_modules`. Baza = `e135b91a`
(checkout głównego repo). Dwa pomiary S4: po integracji (`52cd0e68`,
z wpięciem migawki) i na drzewie końcowym (`bf9108ea`, po poprawkach pełnego
vitest - kod klienta po nim się nie zmienia). Przypisanie: gzip -9 per chunk
z `.output/public/assets` (nazwa bez hasha) i inwentarz modułów
`reports/chunk-inventory.json`.

| Budżet (gzip KB)         | Próg przed / po | Baza `e135b91a` | S4 `52cd0e68` | S4 końcowy | Δ S4 (końcowy) | Cel S4 (§8.6) | Wynik                                                                                |
| ------------------------ | --------------- | --------------- | ------------- | ---------- | -------------- | ------------- | ------------------------------------------------------------------------------------ |
| `overall`                | 4972 / **4982** | 4970,7          | 4979,4        | 4980,6     | **+9,9**       | ≤ +4          | cel ✗; próg 4972 ✗ → ratchet D-08 (4980,6 → 4981 → +1)                               |
| `admin-only`             | -               | 2198,1          | 2207,2        | 2207,6     | +9,5           | -             | leniwe chunki panelu (niżej)                                                         |
| `public`                 | 2881 (zamr.)    | 2772,5          | 2772,1        | 2773,0     | +0,5           | 0             | próg ✓; cel ✗ o entropię nazw (niżej), zero nowych modułów                           |
| największy chunk (entry) | 286 (zamr.)     | 257,5           | 257,9         | 257,9      | +0,4           | 0             | próg ✓; cel ✗ - powłoki tras i listy preloadu (niżej)                                |
| `css`                    | 100             | 99,7            | 99,7          | 99,7       | 0,0            | ≤ +0,1        | ✓ (bez ratchetu)                                                                     |
| `publicCss`              | 85 (zamr.)      | 83,8            | 83,8          | 83,8       | 0,0            | -             | ✓                                                                                    |
| `boot`                   | 579 (zamr.)     | 471,3           | 471,6         | 471,7      | +0,4           | -             | ✓ (to samo źródło co entry)                                                          |
| liczba chunków           | -               | 1454            | 1455          | 1455       | +1             | -             | `check:chunks` ✓ (acykliczny), `check:entry-purity` ✓, `check:server-entry-purity` ✓ |

Przypisanie przyrostu (baza → `52cd0e68`, +8,7 KB):

| Chunk (klasa)                        | Δ gzip KB    | Przyczyna                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin.workflows` (admin)            | +3,05        | Edytor przepisu: listy etapów, picker osoby zespołu, walidacja parametrów inline, `workflowQueries.ts`, rozszerzony słownik `i18n-admin-workflows`.                                                                                                                                                      |
| `leadMutations` (admin, nowy)        | +2,29        | Wspólny moduł mutacji leada (zmiana cyklu życia, lista zespołu) dla karty leada, listy CRM i edytora przepisów.                                                                                                                                                                                          |
| `admin.crm.$id` (admin)              | +1,47        | `LeadStageHistoryCard`, zmiana etapu cyklu życia, słownik `i18n-admin-crm-lifecycle`.                                                                                                                                                                                                                    |
| `admin.crm.index` (admin)            | +1,11        | Chipy filtrów cyklu życia, segmentu, tagów i właściciela.                                                                                                                                                                                                                                                |
| `LeadTasksPanel` (admin)             | +0,90        | Źródło zadania, zbiorcze przypisanie (P24).                                                                                                                                                                                                                                                              |
| `app-initial` (entry, public, boot)  | +0,31        | Surowo −225 B: `adminPageHead` zamiast list meta w 6 powłokach tras CRM/firm/workflows (−0,8 KB raw) i `validateSearch` skrzynki zgłoszeń (+0,5 KB raw, Z-S4-05). Przyrost gzip to listy preloadu z nazwą nowego chunku `leadMutations` i hashe (TanStack trzyma `head`/`validateSearch` w entry - V14). |
| `admin.community.clubs.applications` | +0,23        | Skrzynka sterowana adresem (Z-S4-05).                                                                                                                                                                                                                                                                    |
| pozostałe                            | +0,6 / −1,96 | `leadListSpec` (`source_type`/`lifecycle_stage` w specyfikacji listy), `domainEvents`, `EventStudioModuleSections`; reszta to hashe w nazwach importów (< 0,1 KB na chunk).                                                                                                                              |

`52cd0e68` → drzewo końcowe: +1,2 KB rozłożone po ~10 B na ponad sto chunków
(publicznych i panelu) - nowe hashe w nazwach importów po zmianie modułów
CRM - oraz `crmLifecycleLabels` w chunkach CRM. Żadnego nowego modułu
w chunkach publicznych; `public` +0,5 względem bazy to wyłącznie entropia
nazw.

Ratchet `overall` 4972 → 4981 (`75c2ce1d`, pomiar `52cd0e68`) i korekta
4981 → 4982 (`59a73242`, pomiar drzewa końcowego) w
`scripts/check-bundle-size.ts`, z wpisem w kronice. Progi `public`,
`publicCss`, `chunk`, `boot` bez zmian i w normie; `css` bez zmian.

### 15.8 Weryfikacja końcowa S4

Worktree `/home/user/wt/S4`, gałąź po przebazowaniu na `e135b91a`. Bramki
uruchomione raz, czerwone naprawione i powtórzone (tylko one i testy
dotknięte poprawką).

| Polecenie                                                                                                                                           | Wynik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run verify:static` (z `format:check`)                                                                                                          | ✓ 18 bramek w 431 s: `check:migration-lanes` 338 wpisów, `check:rpc-contract` 804 nazwy / 1631 funkcji, `check:ts-sql-contract` 927 wywołań RPC, `check:types-freshness` 381 tabel, `check:sql-tenant-scope` 1693 funkcje, `check:sql-migration-replay` 1265 plików, pozostałe `check:sql-*` ✓                                                                                                                                                                                                                                                                                                                                                                                   |
| `bun run typecheck` (tsgo + `tsconfig.scripts.json` + e2e)                                                                                          | ✗ → ✓: 2 błędy w plikach wycinka (TS2367 `LeadFilterChips.tsx`, TS2353 `purchaseEffects.server.test.ts`) naprawione; zielony na `bf9108ea` (po ostatniej zmianie kodu). Środowisko: przy nieaktualnym `tsbuildinfo` i innych sesjach `tsgo` ginął od OOM (Z-S4-14)                                                                                                                                                                                                                                                                                                                                                                                                               |
| `bun run lint`                                                                                                                                      | ✓ 0 błędów, 282 ostrzeżenia (+3 `react-refresh` z wycinka - Z-S4-10); pliki zmienione po przebiegu - `eslint` ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `TZ=UTC bunx vitest run` - cały pakiet w 4 kolejnych shardach (pierwszy przebieg jednym procesem zabił OOM innej sesji po 1018 plikach bez porażek) | shard 1: 927 plików / 21 970 testów ✓ (+35 oczekiwanych porażek); shard 2: 1 ✗ `-webhook.test.ts` (`retention=1`); shard 3: 1 ✗ `overlayReaders.test.ts` (`adminCrm`); shard 4: 926 plików / 23 303 testy ✓ (+52). Razem 3707 plików, 92 149 testów zielonych, 2 czerwone → poprawki `52f59cae`, `bf9108ea`. Po poprawkach shardy 2 i 3 ponowione: 925 plików (+2 pominięte) / 22 655 testów ✓ i 927 / 24 223 ✓; testy dotknięte `bf9108ea` (CRM, `overlayReaders`, `i18nOverlayIntegrity`, `i18nKeyDrift`, trasy CRM) i manifest (`hubDelivery.gate`) powtórzone osobno ✓. **Wynik: 3705 plików + 2 pominięte, 92 151 testów zielonych, 194 oczekiwane porażki, 0 czerwonych.** |
| pgTAP `run.sh all` (`PGTAP_DIR=/tmp/pgtap-int`, port 5470, `flock`)                                                                                 | 1265 migracji (1 błąd znany: `20260825230232`); 221 plików: 216 OK, 4 znane błędy środowiska (`community_cron_schedule` 2× `pg_net`, `job_scheduler_heartbeat` 1× `pg_net`, `public_definer_views_read_only` 1b/3, `profile_intent_semantic` - `vector`) + `hub_schema_rls_test` 57/58 → poprawka `2b022e0c` → 58/58                                                                                                                                                                                                                                                                                                                                                             |
| `run.sh test 'crm_\|workflow_\|cohesion_layer\|club_application\|event_attended\|revenue_community\|hub_'` (ERE)                                    | ✓ 18 plików, 0 błędów (8 plików S4: 160 asercji; `cohesion_layer` 17; I0 i S1 zielone)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ponowne zastosowanie 8 migracji S4 na tej bazie                                                                                                     | ✓ 8 × rc=0 (idempotencja, także `130300` z `lock_timeout`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `generate:ts-sql-contract` + `run.sh test ts_sql_contract`                                                                                          | ✓ 929 wywołań RPC (po wpięciu migawki), 1501 operacji na tabelach; 9/9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `check:rpc-contract`, `check:types-freshness`, `check:migration-lanes`, `check:sql-tenant-scope` (po wpięciu)                                       | ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `split-migration.ts --dry-run` dla `2026102013*`                                                                                                    | ✓ każdy plik 1 część (6,3-26,7 KiB < 45 KiB)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `flock -o /tmp/hub-harness.lock bun run check:pg-harness`                                                                                           | ✓ 504 asercje                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `flock -o /tmp/hub-harness.lock bun run check:events-harness`                                                                                       | ✓ 278 migracji, 4914 asercji                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `flock -o /tmp/hub-build.lock bun run build` + `check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity`                    | build ✓; `check:bundle` ✗ wyłącznie `overall` 4979,4 > 4972 → ratchet D-08 → ✓; `check:chunks` ✓ (1455, acykliczny), `check:entry-purity` ✓, `check:server-entry-purity` ✓. Drzewo końcowe (`bf9108ea`) przebudowane: `overall` 4980,6 → korekta progu 4982 → ✓; pozostałe trzy bramki ✓.                                                                                                                                                                                                                                                                                                                                                                                        |
| `bun run scripts/hub-slice-guard.ts S4 --base e135b91a`                                                                                             | exit 1 wyłącznie na zmianach Integratora (§15.4): `[plik-wspoldzielony]` `_journal.json`, `check-bundle-size.ts`, `queryKeyLiterals.gate.test.ts`, `hubDelivery.ts`, `[poza-manifestem]` dziennik; dostawa huba ✓ 8 plików, 17 definicji funkcji                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `cmp` supabase ⇄ drizzle `0330…0337`                                                                                                                | ✓ bajt w bajt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| e2e                                                                                                                                                 | nieuruchamiane - karta S4 nie wymaga                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### 15.9 Wdrożenie S4 na produkcji (właściciel)

Kod i migracje S4 idą w jednym PR. Zależności w obie strony:

- nowy front przed migracjami woła nieistniejące RPC (PGRST202 →
  `unavailable`/`not_configured`, bez wyjątku): `admin_crm_set_lifecycle_stage`
  (zmiana cyklu życia na karcie), `admin_revenue_{events,clubs}_summary`
  (przekroje huba); billing (`purchaseEffects`) dostaje błąd
  `crm_set_lifecycle_stage` i loguje go (`catch`, bez rzutu) - tagi i etap
  sprzedaży zapisane, cykl życia i zamknięcie zadań retencyjnych nie;
- stary front po `130000` traci INSERT/UPDATE kolumn `crm_tasks.source`
  i `origin_ref` (nie pisał ich) oraz zmianę `user_id`/`lifecycle_stage`
  w `crm_leads` z sesji klienta (42501 - nie pisał ich; zapisy
  `service_role`, np. znacznik `careers` w `contact.functions.ts`, przechodzą).

1. **Warunek:** M0 i S1 wdrożone (§10) - emitery S4 wołają `_log_emit_error`
   (`090500`), typy zdarzeń są w katalogu I0, historia etapów pisze do
   `crm_lead_stage_history` (`090200`).
2. **Okno nocne** (wyzwalacze na `crm_leads`, `domain_events`,
   `event_registrations`; backfill `user_id` w `crm_leads`). Panel Lovable →
   8 plików **w kolejności wersji**:
   1. `20261020130000_crm_lifecycle_history` (strażnik i historia, backfill etapów z `audit_log`; `lock_timeout` 5 s);
   2. `130100_crm_user_id_profile_writer` (backfill `user_id`/segmentu/cyklu; `lock_timeout` 5 s);
   3. `130200_workflow_actions_v2` (po `130000` - akcje wołają `crm_set_lifecycle_stage`);
   4. `130300_workflow_engine_fixes` (po `130200`; deduplikacja `workflow_runs` przed indeksem unikalnym; `lock_timeout` 5 s);
   5. `130400_crm_dashboard_fixes`;
   6. `130500_club_application_events`;
   7. `130600_event_attended_revenue_net` (`lock_timeout` 5 s na wyzwalaczu `event_registrations`);
   8. `130700_revenue_community_aggregates` (po `130600` - woła `_event_revenue_net`).

   Pliki są idempotentne (`CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS` +
   `CREATE TRIGGER`, `CREATE UNIQUE INDEX IF NOT EXISTS`, backfille
   zastosowane dwukrotnie bez zmiany wyniku, bezstanowe REVOKE/GRANT). `55P03`
   (limit blokady) = ponów cały plik.

3. Zaraz potem opublikuj front z tego PR.
4. Bliźniaki `0330…0337` są kopiami bajt w bajt - po panelu wykonują się
   jako no-op; migrator Drizzle wykona je sam, jeśli panel zostanie pominięty.
5. `workflow_dispatch` CI na `main` → `post-deploy`: `check:db-contract`
   i `check:migration-ledger` (8 wersji) zielone. Wynik do §10.
6. Kontrola po wdrożeniu (SQL editor, tylko odczyt):

```sql
-- 7 nowych/zmienionych RPC S4: oczekiwane 7 niepustych kolumn.
SELECT to_regprocedure('public.crm_set_lifecycle_stage(uuid,text,text,boolean)') AS set_stage,
       to_regprocedure('public.admin_crm_set_lifecycle_stage(uuid,text)') AS admin_set_stage,
       to_regprocedure('public.newsletter_subscriber_list_set(uuid,text,text)') AS list_set,
       to_regprocedure('public._event_revenue_net(uuid,uuid,timestamptz,timestamptz)') AS revenue_net,
       to_regprocedure('public.admin_event_ads_funnel(uuid,timestamptz,timestamptz)') AS ads_funnel,
       to_regprocedure('public.admin_revenue_events_summary(timestamptz,timestamptz)') AS events_summary,
       to_regprocedure('public.admin_revenue_clubs_summary(timestamptz,timestamptz)') AS clubs_summary;
-- 6 wyzwalaczy S4: oczekiwane 6.
SELECT count(*) FROM pg_trigger
 WHERE NOT tgisinternal
   AND tgname IN ('trg_crm_leads_00_hub_guard','trg_crm_leads_stage_history','trg_run_workflows_for_event',
                  'trg_workflow_definitions_emit','trg_club_applications_emit',
                  'trg_event_registrations_attended_emit');
-- Jeden przebieg na parę przepis × zdarzenie: oczekiwane 1 wiersz (indeks).
SELECT indexname FROM pg_indexes WHERE indexname = 'workflow_runs_workflow_event_uidx';
-- Funkcje serwisowe zamknięte dla sesji: oczekiwane false, false.
SELECT has_function_privilege('authenticated', 'public.crm_set_lifecycle_stage(uuid,text,text,boolean)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.newsletter_subscriber_list_set(uuid,text,text)', 'EXECUTE');
```

Wycofanie: DDL S4 to wyzwalacze, funkcje, granty kolumnowe `crm_tasks`
i indeks unikalny `workflow_runs` - bez nowych tabel i kolumn. Revert kodu
przywraca stary panel bez zmian danych (stary panel nie pisze kolumn
chronionych). Zdjęcie strażnika `trg_crm_leads_00_hub_guard` albo grantów
`crm_tasks` - osobną migracją spoza bloku huba, decyzją właściciela.
Backfille (`user_id`, segment, cykl życia, historia etapów z `audit_log`)
są addytywne i zostają.

### 15.10 Kryteria akceptacji S4 (SPEC §8.3)

- [x] pgTAP 8 plików + poprawiony `cohesion_layer_test.sql` zielone: `crm_lifecycle_history` 39, `crm_user_id_backfill` 14, `workflow_actions_v2` 29, `workflow_engine_fixes` 18, `crm_dashboard_fixes` 8, `club_application_events` 15, `event_attended_revenue_net` 14, `revenue_community_aggregates` 23 (160 asercji), `cohesion_layer` 17 (D1 dowiedziony przy wyłączonych `trg_newsletter_to_lead` i `subscriber_sync_crm_lead`); świeża baza `run.sh all` i wzorzec karty (ERE) 18/18. `check:pg-harness` ✓ 504 asercje (`130500` zastosowana, `130700` pominięta), `check:events-harness` ✓ 278 migracji / 4914 asercji (`130600` zastosowana, asercje `28_ads_funnel*` bez zmian). Ponowne zastosowanie 8 migracji na tej bazie - 8 × rc=0.
- [x] `workflows.test.ts`: `WORKFLOW_ACTIONS` = `CASE` w `run_workflow_step` (parser ciała `130200`, także `WHEN` z dwiema etykietami; każdy parametr formularza czytany przez silnik); `event.registration.created.v1` i cały `DOMAIN_EVENT_TYPES` przechodzą `isValidEventType` (= CHECK `domain_events`), zdeformowane (`post.published.v1.extra`, `post..v1`) odrzucone; typ spoza katalogu - ostrzeżenie w edytorze.
- [x] Billing: `customer`/`former_customer` przez `crm_set_lifecycle_stage(…, 'billing', p_allow_backward => true)` (`purchaseEffects.server.test.ts`; pgTAP `crm_lifecycle_history_test`: pierwszeństwo, `billing_owned` 42501); zakup podnosi `source_type` do `paid_subscriber` przy randze < 90 (parytet `CRM_SOURCE_TYPE_RANK` ⇄ `_crm_source_type_rank`); pauza = `customer` z tagiem `subscription:paused`, nie `churned`; martwy `?retention=1` usunięty (`/profile/plan`).
- [x] CRM: filtry cyklu życia, segmentu, tagów i właściciela + pasmo score (`leadListSpec`/`leadViews`, `LeadFilterChipsHub.test.tsx`); `LeadStageHistoryCard` (8 testów) i zmiana cyklu życia przez `admin_crm_set_lifecycle_stage`; sekcyjny `adminPageHead` (noindex) na trasach CRM, firm i `/admin/workflows` (D14, testy tras).
- [x] `admin_event_ads_funnel` bit w bit: nowe ciało = kopia słowo w słowo z `20260927001100` (`pg_temp.hub_s4_funnel_old`) na fiksturze z kampaniami, kosztami, krokami, grupą, pakietem, pulą planu i zwrotami - bez okna, w oknie i na pustym wydarzeniu; suma przekroju = Σ `_event_revenue_net` per wydarzenie; klub `secret` nie emituje i nie trafia do przekroju (po slugu i po id); `paid_subscriber` nie spada do `club_application`.
- [x] `queryOptions` społeczności = argumenty studia (`queries.test.ts`: `registrationKeys.counts({eventId, ticketTypeId: null, groupId: null, q: '', from: null, to: null})`, `staleTime` 15 s, `adsFunnelKeys.report({eventId, from: null, to: null})`); przekroje na `revenueKeys.query('events'|'clubs', najemca, okno)`.
- [ ] Delta bundla w celu S4 (§8.6: `overall` ≤ +4, `public` i entry 0) - **niespełnione**: `overall` +9,9 (ratchet D-08 → 4982), entry +0,4 (powłoki tras, listy preloadu), `public` +0,5 (entropia nazw, zero modułów); progi zamrożone zielone (§15.7).
- [x] Strażnik: `hub-slice-guard.ts S4 --base e135b91a` - wyłącznie pliki współdzielone zmienione przez Integratora (§15.4); dostawa huba: 8 plików, 17 definicji funkcji.

## 16. Wycinek S2 - przychód i retencja: księga MRR, windykacja, przychód zrealizowany, anulowanie (2026-10-19)

Gałąź `hub/s2-ksiega-mrr` (worktree `/home/user/wt/S2`), wykonawca na bazie
`e69234c1`, przebazowana przez Integratora na `6ac07c60` (S4, §15) bez
konfliktów, potem fast-forward do `claude/elegant-fermat-xwfca1`. Commity:

- `63cddf53` - 8 migracji `2026102011*`, 7 plików pgTAP (księga MRR, skanery, retencja, oferta, ekonomika);
- `be2c292d` - finanse huba w TS, przepływ anulowania ≤ 2 kroki, rabat retencyjny u operatora, migawka ceny w webhooku, maile P12, KPI `/admin/billing` z RPC huba;
- `2d15a93c` - integracja: pliki współdzielone (§16.4);
- `ad77a191` - siedem błędów `tsgo` w trzech plikach wycinka (Integrator, §16.8);
- `61bbdee9` - raport `i18n-parity` po bramce parytetu (§16.4);
- `5e52d63c` - ratchet `overall` 4982 → 4991 (D-08, §16.7);
- ten wpis.

Pełny pakiet vitest dla tej gałęzi uruchamia CI na PR #527 (decyzja
właściciela 2026-10-19: lokalnie tylko testy celowane, typecheck, lint,
build z budżetem i pgTAP - §16.8).

### 16.1 Zakres

Wykonawca: 63 pliki, +11 949 / −1182 linii (2 commity). Z integracją (bez
tego wpisu): 80 plików, +14 927 / −1213.

| Obszar                            | Co dostarcza S2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL (8 migracji, 23 funkcje)      | `110000` lustro katalogu (`billing_catalog_entry`, `billing_months_per_interval`, `subscription_mrr_minor` z `basis`); `110100` wyzwalacz historii `trg_subscriptions_revenue_history` - ruchy MRR po delcie (pauza, zmiana waluty, sandbox/mock, idempotencja, anonimizacja Z-07 przy DELETE) i `tg_billing_documents_renewed_emit`; `110200` backfill (`reason='backfill'`, `backfilled=true`, środowisko dokumentów porcjami); `110300` `_revenue_mrr_at`, `_revenue_movements`, `_revenue_realized`; `110400` RPC panelu: migawka, most (z `basis_mix`), seria, churn, kohorty, windykacja, przychód zrealizowany; `110500` skaner cyklu życia; `110600` zdarzenia retencji i skaner przepływu; `110700` macierz ofert, dane wejściowe i ekonomika. |
| Finanse (TS)                      | `src/lib/revenue/finance/{dto,parse,mrrMath,finance.functions,queries}.ts`: parsery z `*_KEYS` = listy `set_eq` pgTAP (`null` ≠ 0, most ±0,5 %, `MoneyByCurrency[]`), `mrrMath` reużywa `monthlyEquivalent` i `catalogPlanQuote`, 11 server fn z literałami RPC (42501, 42883/PGRST202, 40001, 22023 jako stany), `revenueKeys` i `staleTime` z §5.4; `billingCatalogSqlParity` ze wspólnym fixture'em vitest/pgTAP i `BILLING_CATALOG_LEGACY`.                                                                                                                                                                                                                                                                                                         |
| Anulowanie i retencja (P01, P02)  | `RetentionDialog` - co najwyżej 2 kroki, „Anuluj mimo to” na każdym kroku ankiety i oferty, przy wyłączonej retencji samo potwierdzenie; `SubscriptionCard` nie anuluje jednym kliknięciem; `startRetentionFlow` zapisuje `started`, `submitRetentionFeedback` aktualizuje ten sam wiersz (`not_given` bez powodu, Z-09); ankieta z portalu Stripe trafia do `retention_feedback`; `applyOffer.server` - kupon `repeating` u operatora (klucze `retention-coupon:`/`retention:{feedback_id}`), zachowuje istniejące rabaty, 1 oferta / 180 dni, tylko subskrypcje z lustrem operatora.                                                                                                                                                                  |
| Webhook i maile (P11, P12, P13)   | Migawka ceny i rabatu w `subscriptions` (odczyt autorytatywny rozwija rabaty); mail anulowania zależny od daty (CTA `/profile/plan` albo `/pricing`, bez `/cennik`); nadawcy `renewed` (wpięty) i `donation` (tylko nadawca); akcja wznowienia na `/profile/plan`; przypomnienia pomijają `unpaid` i `incomplete_expired`; snapshoty PL/EN i test ścieżek CTA w `routeTree`.                                                                                                                                                                                                                                                                                                                                                                            |
| `/admin/billing` (P10, br. 04 D8) | Aktywne subskrypcje, MRR i windykacja z tych samych `queryOptions` i klucza co hub; klucz listy z najemcą, panele na kluczach fabryk; filtr statusu zamówień (wpięty w trasę przy integracji).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Słowniki                          | `i18n-admin-revenue-finance.ts` (PL/EN, test pokrycia enumów DTO) i `profile.retentionFlow` w `i18n-profile.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### 16.2 Decyzje

- **S2 prosto do gałęzi PR `claude/elegant-fermat-xwfca1`** (orkiestrator,
  §13.1), jak S1 i S4: migracje, bliźniaki i kod w jednym PR.
- **D-05 (podstawa kwot):** `basis='catalog'` jawnie w RPC, DTO i UI -
  `subscription_mrr_minor` zwraca `basis`, most i migawka `basis_mix`
  (udziały 0-1 `provider`/`catalog`), panel pokazuje `ProvenanceNote`
  i `adminRevenue.finance.basis.*`.
- **Z-07 (RODO):** usunięcie konta nie kasuje kaskadą historii ani ruchów -
  `user_id` w `mrr_movements`, `subscription_state_history`
  i `dunning_cycles` staje się `NULL` (`110100`: `DROP NOT NULL`, bez FK
  historii i windykacji do `subscriptions`), a ruch `churn` zapisuje się
  z `user_id NULL`; dowód w `revenue_subscription_history_test` (38).
  Polityka retencji do potwierdzenia przez właściciela/IOD (Z-S2-03).
- **Z-09 (anulowanie przed wyborem powodu):** `reason_label='not_given'`
  zamiast zmiany CHECK-u I0; emiter niesie `reason_key='not_given'`,
  `admin_revenue_retention_offers` liczy `reason_not_given` osobno.
- **Typy bazy:** Integrator dopisał do `types.ts` nullable `user_id` trzech
  tabel księgi, zdjął dwie relacje FK i dodał sygnatury 14 RPC S2 (zwrot
  `Json`) - wywołania i tak idą przez `asRpc`, więc to dokumentacja
  kontraktu, nie zmiana zachowania. Regeneracja Lovable po wdrożeniu nadpisze
  plik tym samym kształtem.
- **D-08:** ratchet `overall` 4982 → 4991 (zmierzony przyrost +9,0 KB, w całości leniwe chunki panelu i profilu, §16.7). `css` bez zmian (99,7 = baza).

### 16.3 Odchylenia od SPEC (kontrakt bez zmian, fakty repozytorium wygrywają)

| Miejsce SPEC / karta S2                          | Stan po S2                                                                                                                                                                       | Uzasadnienie                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `duration_in_months = discount_periods`          | `discount_periods` × długość cyklu subskrypcji w miesiącach (roczny ×12, tydzień/dzień w górę do miesięcy); nieznany interwał Stripe = okresy jako miesiące (Integrator, §16.8). | Klient dostaje dokładnie N obniżonych faktur, jak obiecuje dialog; plany miesięczne bez zmian. |
| `acceptRetentionOffer` (stary kupon B2B w kasie) | Oferta tylko dla subskrypcji z lustrem operatora (`subscriptions`); lokalne dostają ankietę bez oferty (`no_provider`). `coupon.ts` nieużywany, zostaje (poza manifestem).       | Kupon musi trafić na subskrypcję u operatora, nie do kasy.                                     |
| „Anuluj mimo to” zawsze widoczne                 | Krok samego potwierdzenia (retencja wyłączona albo start przepływu padł) ma etykietę „Anuluj subskrypcję”; ankieta i oferta - „Anuluj mimo to”.                                  | Anulowanie zawsze jedno kliknięcie od otwartego dialogu.                                       |
| `submitRetentionFeedback` zapisuje decyzję       | „Zostaw subskrypcję” = `saved`; zamknięcie X/Escape zostawia `started`, skaner zamyka jako `abandoned` po 24 h; ankieta zapisuje się po udanym anulowaniu.                       | Nieudane anulowanie nie zostawia rekordu `canceled`.                                           |
| `basis_mix` (S6: liczności pozycji)              | Udziały 0-1 (`provider`, `catalog`).                                                                                                                                             | `ProvenanceNote` czyta oba kształty tak samo (catalog/total).                                  |
| KPI `/admin/billing` z RPC                       | „Nieudane płatności” = otwarte cykle windykacji z `admin_revenue_dunning`; „Zaplanowane anulowania” nadal z listy (`≥ N` przy limicie 500).                                      | Brak agregatu zaplanowanych anulowań w SQL.                                                    |
| Klucze z fabryk                                  | Seria, kohorty, ekonomika = rozwinięcie kluczy fabryki + zakres miesięcy/strefa (bez literałów).                                                                                 | `keys.ts` (poza manifestem) nie ma funkcji zakresu miesięcy; prefiksy szyny zdarzeń trafiają.  |
| P01 `cancellation_details`                       | Portal Stripe → `reason_label 'stripe:<feedback>'` (albo `stripe:other`), pełny komentarz, `outcome='canceled'`, deduplikacja 30 dni.                                            | Jedno źródło powodów rezygnacji.                                                               |
| P12 nadawca `donation_received`                  | Nadawca `notifyDonationEmail` gotowy i przetestowany; wywołania w `donations`/`oneTimeFulfilment` poza manifestem (Do integracji I9).                                            | Pliki S3/wspólne.                                                                              |
| Weryfikacja karty: `run.sh … 'a\|b'`             | Od `40c5ec73` (S4) wzorzec ERE - komenda z karty działa wprost.                                                                                                                  | Z-S4-08.                                                                                       |

### 16.4 Zgłoszenia „Do integracji” wykonane przez Integratora S2

Strażnik `hub-slice-guard.ts S2 --base 6ac07c60` po integracji zgłasza
wyłącznie zmiany Integratora: `[plik-wspoldzielony]`
`drizzle/migrations/meta/_journal.json`, `src/integrations/supabase/types.ts`,
`src/lib/__tests__/queryKeyLiterals.gate.test.ts`, `src/lib/ci/hubDelivery.ts`, `scripts/check-bundle-size.ts`
oraz `[poza-manifestem]` `reports/i18n-parity.json` i ten dziennik. Pliki spoza manifestu, których
wymagały bramki i zgłoszenia, dopisano do manifestu S2 z komentarzem
„Integrator S2”.

| Zgłoszenie                      | Zmiana                                                                                                                                                                                                        | Pliki                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Bliźniaki drizzle               | 8 bliźniaków (bajt w bajt) i 8 wpisów `_journal.json` w kolejności wersji (§16.6); `check:migration-lanes` i `supabaseLaneCoverage` zielone.                                                                  | `drizzle/migrations/0338…0345_*.sql`, `meta/_journal.json`, `hubDelivery.ts` (glob) |
| `types.ts`                      | `user_id: string \| null` (Row) i opcjonalny nullable (Insert/Update) w `subscription_state_history`, `mrr_movements`, `dunning_cycles`; bez `*_subscription_id_fkey` historii i windykacji; 14 sygnatur RPC. | `src/integrations/supabase/types.ts`                                                |
| Z-S6-16 (część finansowa)       | `REVENUE_DOMAIN_READS.snapshot` = `admin_revenue_semantic_snapshot(p_since, p_until)` - kształt z `WPIECIA_DOCELOWE`, test „każde wpięcie produkcyjne woła SWOJĄ funkcję” zielony.                            | `src/lib/analytics/semantic/revenueSnapshot.functions.ts`                           |
| Filtr statusu `/admin/billing`  | `statusFilter`/`onStatusFilterChange` z `search.status` (zapis `replace`, jak zakładka).                                                                                                                      | `src/routes/admin.billing.tsx`                                                      |
| P01 w teście fałszywego sukcesu | Atrapa `RetentionDialog` z przyciskiem potwierdzenia (wzór `SubscriptionCard.edges`); asercje bez zmian.                                                                                                      | `src/components/billing/__tests__/subscriptionFalseSuccess.test.tsx`                |
| Dług literałów kluczy           | Zdjęte 3 panele rozliczeń (`AdminBillingPanel`, `AdminPaymentOrdersPanel`, `AdminPaymentsDiagnosticsPanel`).                                                                                                  | `src/lib/__tests__/queryKeyLiterals.gate.test.ts`                                   |
| Raport parytetu i18n            | `reports/i18n-parity.json` przepisany przez bramkę `i18nParity` (`repoWide.untranslated` 561 → 570: zapożyczenia w niebramkowanych prefiksach, m.in. `adminWorkflows` z S4; bramkowany `adminRevenue` - 0).   | `reports/i18n-parity.json` (`[poza-manifestem]`)                                    |
| Budżet D-08                     | Ratchet `overall` 4982 → 4991 z wpisem w kronice (§16.7).                                                                                                                                                     | `scripts/check-bundle-size.ts`                                                      |

**Do integracji I9/S7 (nie wykonane przez Integratora S2):**

- **jobsTick / harmonogram (I9):** co 5 min z `service_role`:
  `supabaseAdmin.rpc("run_revenue_lifecycle_scanner")` i
  `supabaseAdmin.rpc("run_retention_flow_scanner")` (koniec okresu próbnego
  T-3 d, wygaśnięcie, windykacja przegrana po 30 d, dzienna migawka MRR,
  `started` → `abandoned` po 24 h). Do tego czasu skanery nie biegną.
- **`authzSnapshot.generated.ts` (I9):** regeneracja
  `bun run generate:authz-snapshot` (11 server fn `finance.functions`
  za `requireCrmStaff`, `startRetentionFlow` za `requireSupabaseAuth`);
  plik był nieaktualny już na bazie.
- **`billingDocuments.server.ts` (I9, Z-S2-07):** przy INSERT do
  `billing_documents` ustawić `environment: input.environment` oraz
  `subscription_id` = `user_subscriptions.id` dopasowane po `external_ref`
  dla faktur subskrypcji. Ścieżka webhooka płatności poza manifestem -
  wymaga testów atrapy klienta i nie mieściła się w oknie integracji.
- **Darowizny (I9, P12):** po zaksięgowaniu w `donations.server.ts`
  (`recordRecurringDonationPayment`) i `oneTimeFulfilment.server.ts`
  wywołać `notifyDonationEmail({ email, lang, name, amountCents, currency,
donorMessage, tenantId, idempotencySeed: invoiceId ?? donationId })`.
- **S7 / właściciel S1:** `RetentionFeedbackList` i statystyki retencji:
  `not_given` jako `t('adminRevenue.finance.retention.reasonNotGiven')`
  z podpowiedzią `reasonNotGivenHint`, `stripe:<code>` jako „Stripe portal:
  <code>”, `not_given` poza rankingiem powodów (Z-09); zakładki huba na
  `queryOptions` z `src/lib/revenue/finance/queries.ts` (Z-S2-12).

### 16.5 Zgłoszenia otwarte

| ID      | Zgłoszenie                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Z-S2-01 | **Ręczna weryfikacja właściciela w trybie testowym operatora (przed publikacją frontu)** - instrukcja niżej. Kryterium karty otwarte do jej wykonania. **Aktualizacja I9b (§22.2 B4): kroki 3-8 i 10 zautomatyzowane (mapa krok → test); dla właściciela zostają trzy kroki wizualne w trybie testowym Stripe (Z-I9b-13).**                                                                      |
| Z-S2-02 | (Z-01) Segment ruchu = segment `tier_key` w chwili ruchu; most filtrowany segmentem wybiera subskrypcje po segmencie na `until`, więc subskrypcja, która zmieniła segment w oknie, liczy się w całości w segmencie końcowym. Decyzja właściciela: akceptacja albo podział ruchów per segment (zmiana SQL). **Zamknięte w I9b (§21.2): akceptacja - atrybucja do segmentu na koniec okresu.**     |
| Z-S2-03 | (Z-07) Księga zachowuje zanonimizowane ruchy, historię i cykle windykacji (`user_id NULL`) i zapisuje `churn` przy usunięciu konta - do potwierdzenia przez właściciela/IOD, że kwoty bez identyfikatora spełniają politykę retencji RODO. **Zamknięte w I9b (§21.2): akceptacja pod warunkiem pełnej anonimizacji (20261020160400); IOD potwierdza wpis przy aktualizacji rejestru czynności.** |
| Z-S2-04 | (Z-09) `not_given` w `reason_label` - etykieta i wykluczenie z rankingu w `RetentionFeedbackList`/statystykach (S1/S7, §16.4).                                                                                                                                                                                                                                                                   |
| Z-S2-05 | Wskaźniki migawki (NRR, GRR, quick ratio, wzrost m/m) liczone w walucie wiodącej (największy MRR). Propozycja dla S6: `ratio_currency` w `REVENUE_SNAPSHOT_KEYS.meta`.                                                                                                                                                                                                                           |
| Z-S2-06 | `new_customers_plan` w `revenue_manual_inputs.amount_minor` to LICZBA klientów (z walutą, bo CHECK I0 jej wymaga). UI S7 musi opisać pole jako liczbę (`inputs.newCustomersHint`); docelowo osobna kolumna (zmiana schematu I0).                                                                                                                                                                 |
| Z-S2-07 | Do czasu zmiany w `billingDocuments.server.ts` (§16.4, I9) nowe dokumenty są `unknown_environment_documents` (poza przychodem zrealizowanym), a `subscription.renewed.v1` z wyzwalacza nie wychodzi. Mail odnowienia od tego nie zależy (idzie z webhooka).                                                                                                                                      |
| Z-S2-08 | Migawka rabatu: zwykłe zdarzenia Stripe niosą tylko identyfikatory `di_…`, więc kolumny nie są nadpisywane; rabat zdjęty zdarzeniem bez rozwinięcia zostaje w księdze do następnego odczytu autorytatywnego. Opcja: rozwijać rabaty przy każdym zdarzeniu aktualizacji (dodatkowe wywołanie Stripe).                                                                                             |
| Z-S2-09 | `average_discount` i `price_realization` w migawce tylko dla okien kończących się teraz (brak historii cen i rabatów); okna historyczne zwracają `null`.                                                                                                                                                                                                                                         |
| Z-S2-10 | Wyścig: dwa równoległe przepływy anulowania (dwie karty) mogą oba przejść regułę 180 dni i dopiąć dwa rabaty (idempotencja per `feedback_id`). Niskie ryzyko; domknięcie - RPC z blokadą doradczą per (najemca, użytkownik).                                                                                                                                                                     |
| Z-S2-11 | Ankieta z portalu Stripe wymaga włączenia powodów rezygnacji w konfiguracji portalu klienta (panel Stripe, właściciel).                                                                                                                                                                                                                                                                          |
| Z-S2-12 | Konsumenci S7: zakładki huba (MRR, churn, kohorty, windykacja, zrealizowany, retencja, oferta, dane wejściowe, ekonomika) na `queryOptions` z `src/lib/revenue/finance/queries.ts` i słowniku `i18n-admin-revenue-finance` - hub i `/admin/billing` dzielą klucz (most dla okresu `month`).                                                                                                      |
| Z-S2-13 | Raport `reports/i18n-parity.json` zregenerowany przez Integratora (`61bbdee9`) - `repoWide.untranslated` 570 (+9 względem stanu na bazie; wszystkie w niebramkowanych prefiksach, bramkowane `adminRevenue` 0). Przegląd zapożyczeń przy I9 (jak Z-S4-09).                                                                                                                                       |

**Z-S2-01 - instrukcja ręcznej weryfikacji (tryb testowy Stripe, baza
podglądu/sandbox, przed publikacją frontu na produkcji):**

1. Wdróż migracje `2026102011*` na bazę podglądu (kolejność §16.9);
   sprawdź `retention_settings`: `enabled=true`, `discount_pct=30`,
   `discount_periods=3`.
2. Zaloguj się kontem testowym i kup plan miesięczny kartą
   `4242 4242 4242 4242` (sandbox).
3. `subscriptions`: `unit_amount_minor` i `currency` wypełnione,
   `discount_minor_per_period=0`; `mrr_movements` ma jeden wiersz `new`.
4. Profil → Subskrypcja → „Anuluj subskrypcję”: krok 1 z ankietą i „Anuluj
   mimo to”; `retention_feedback` ma wiersz `outcome='started'`.
5. „Dalej” → „Zostaję z rabatem -30%”: w panelu Stripe subskrypcja ma kupon
   „Retencja -30%” (`repeating`, 3 miesiące, `max_redemptions` 1), wcześniejsze
   rabaty zostały. Stripe → Developers → Logs: kupon z
   `Idempotency-Key: retention-coupon:<feedback_id>`, aktualizacja subskrypcji
   z `retention:<feedback_id>`. Wiersz: `outcome='saved'`,
   `offer_accepted=true`, `coupon_code=<id kuponu>`. Po webhooku
   `mrr_movements` ma `contraction` z powodem `discount`.
6. Ponownie otwórz dialog i kliknij „Anuluj mimo to” na kroku 1:
   `cancel_at_period_end=true`, wiersz `outcome='canceled'`,
   `reason_label='not_given'`; mail `subscription_canceled` z CTA do
   `/profile/plan`.
7. `/profile/plan` → „Wznów subskrypcję”: `cancel_at_period_end=false`.
8. Powtórz ofertę w ciągu 180 dni: `already_redeemed`, drugiego kuponu brak.
9. Anuluj w portalu klienta Stripe z powodem: `retention_feedback` dostaje
   `stripe:<code>` (wymaga Z-S2-11).
10. `retention_settings.enabled=false`: dialog pokazuje samo potwierdzenie.

Wynik (✓/✗ per krok) do §10 i zamknięcie kryterium „weryfikacja ręczna” w §16.10.

### 16.6 Bliźniaki drizzle

| Wersja supabase                                 | Bliźniak                              | idx | `when`        |
| ----------------------------------------------- | ------------------------------------- | --- | ------------- |
| `20261020110000_revenue_catalog_mirror`         | `0338_revenue_catalog_mirror`         | 338 | 1792426845539 |
| `20261020110100_subscription_revenue_history`   | `0339_subscription_revenue_history`   | 339 | 1792426905539 |
| `20261020110200_revenue_backfill`               | `0340_revenue_backfill`               | 340 | 1792426965539 |
| `20261020110300_revenue_sql_helpers`            | `0341_revenue_sql_helpers`            | 341 | 1792427025539 |
| `20261020110400_revenue_aggregates`             | `0342_revenue_aggregates`             | 342 | 1792427085539 |
| `20261020110500_revenue_lifecycle_scanner`      | `0343_revenue_lifecycle_scanner`      | 343 | 1792427145539 |
| `20261020110600_retention_flow_events`          | `0344_retention_flow_events`          | 344 | 1792427205539 |
| `20261020110700_revenue_offer_inputs_economics` | `0345_revenue_offer_inputs_economics` | 345 | 1792427265539 |

Numery od pierwszego wolnego po S4 (`0337`), `when` = 1792426785539
(`0337`) + n·60 000. Wersje S2 (`2026102011*`) są niższe niż S4
(`2026102013*`), a bliźniaki wyższe - migrator Drizzle wykona je po S4;
to bezpieczne, bo S2 i S4 nie dzielą obiektów (S4 nie czyta księgi MRR,
S2 nie dotyka CRM). Na panelu Lovable kolejność wersji (§16.9). `cmp`
supabase ⇄ drizzle: bajt w bajt. **Następny wolny numer: `0346`** (idx 346),
bez rezerwacji (§6).

### 16.7 Pomiar bundla

`flock -o /tmp/hub-build.lock env BUNDLE_INVENTORY=1 bun run build` +
`check:bundle`, ten sam host i te same `node_modules`. Baza = drzewo końcowe
S4 (`bf9108ea`, kod = `6ac07c60`; pomiar §15.7, wynik w `/home/user/wt/S4/.output`).
Przypisanie: gzip -9 per chunk z `.output/public/assets` (nazwa bez hasha),
S4 ⇄ S2.

| Budżet (gzip KB)         | Próg przed / po | Baza `6ac07c60` | S2 (po integracji) | Δ S2     | Cel S2 (§8.6) | Wynik                                                                                |
| ------------------------ | --------------- | --------------- | ------------------ | -------- | ------------- | ------------------------------------------------------------------------------------ |
| `overall`                | 4982 / **4991** | 4980,6          | 4989,6             | **+9,0** | ≤ +4          | cel ✗; próg 4982 ✗ → ratchet D-08 (4989,6 → 4990 → +1)                               |
| `admin-only`             | -               | 2207,6          | 2215,6             | +8,0     | -             | leniwy chunk `/admin/billing` (niżej)                                                |
| `public`                 | 2881 (zamr.)    | 2773,0          | 2773,9             | +0,9     | 0             | próg ✓; cel ✗ - leniwe trasy i słownik profilu (dialog anulowania), niżej            |
| największy chunk (entry) | 286 (zamr.)     | 257,9           | 257,9              | 0,0      | 0             | ✓                                                                                    |
| `css`                    | 100             | 99,7            | 99,7               | 0,0      | 0             | ✓ (bez ratchetu)                                                                     |
| `publicCss`              | 85 (zamr.)      | 83,8            | 83,8               | 0,0      | -             | ✓                                                                                    |
| `boot`                   | 579 (zamr.)     | 471,7           | 471,6              | −0,1     | -             | ✓                                                                                    |
| liczba chunków           | -               | 1455            | 1459               | +4       | -             | `check:chunks` ✓ (acykliczny), `check:entry-purity` ✓, `check:server-entry-purity` ✓ |

Przypisanie przyrostu (+8,9 KB w sumie chunków JS):

| Chunk (klasa)                               | Δ gzip KB             | Przyczyna                                                                                                                                                      |
| ------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin.billing` (admin)                     | +7,93                 | KPI z RPC huba: `finance/queries`, zaślepki klienta 11 server fn `finance.functions` (walidatory zod), `ProvenanceNote`, słownik `i18n-admin-revenue-finance`. |
| `i18n-profile` (public, leniwy)             | +0,79                 | `profile.retentionFlow` - teksty dialogu anulowania (2 kroki, oferta, ankieta).                                                                                |
| `RoleGateNotice` (nowy, admin)              | +0,49                 | Rolldown wydzielił moduł huba do osobnego chunku - współdzieli go teraz także panel rozliczeń (wcześniej siedział w chunkach huba).                            |
| `profile.membership` (public, leniwy)       | +0,45                 | `SubscriptionCard` otwiera `RetentionDialog` zamiast anulować.                                                                                                 |
| `profile.plan` (public, leniwy)             | +0,37                 | Akcja wznowienia subskrypcji (P12).                                                                                                                            |
| `period` / `window` / `DashboardPeriodTabs` | +0,72 / −0,42 / −0,61 | Przetasowanie wspólnych modułów okresu - `resolveRevenueRange` importuje teraz także panel rozliczeń (suma −0,3).                                              |

Entry, `boot` i CSS bez zmian - S2 nie dotyka korzenia, `routeTree` ani
rdzenia i18n. Wszystkie przyrosty `public` są w chunkach tras profilu
ładowanych leniwie (bez nowego modułu w entry). Ratchet `overall`
4982 → 4991 w `scripts/check-bundle-size.ts` z wpisem w kronice
(`5e52d63c`). Progi `public`, `publicCss`, `chunk`, `boot` bez zmian
i w normie; `css` bez zmian.

### 16.8 Weryfikacja końcowa S2

Worktree `/home/user/wt/S2` po przebazowaniu na `6ac07c60`. Decyzja
właściciela (2026-10-19): lokalnie tylko testy celowane; **pełny pakiet
vitest uruchamia CI na PR #527**. Pamięć 16 GB: typecheck w wariancie
niskopamięciowym, vitest `--maxWorkers=3`, ciężkie kroki po kolei.

| Polecenie                                                                                                                                                                                                                                                                                                                                                                                                              | Wynik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run format:check`                                                                                                                                                                                                                                                                                                                                                                                                 | ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `bun run verify:static`                                                                                                                                                                                                                                                                                                                                                                                                | ✓ 18 bramek w 299 s (`check:migration-lanes` 346 wpisów, bliźniaki S2 rozpoznane; `check:types-freshness` 381 tabel)                                                                                                                                                                                                                                                                                                                                                                                                       |
| `bunx tsgo --noEmit --checkers 2 && bun run typecheck:scripts && bun run typecheck:e2e`                                                                                                                                                                                                                                                                                                                                | ✗ → ✓: 7 błędów w plikach wycinka (`ad77a191`): TS2345 ×4 `finance.functions.ts` (generyczne `T` w `windowSchema` gubi wymagalność `sinceIso`/`untilIso` - `refine` przez `windowLengthMs`, semantyka NaN bez zmian), TS2322 `applyOffer.server.ts` (`recurring.interval` w typach Stripe to też `OtherString` - nieznany interwał = brak cyklu), TS2493 ×2 `applyOffer.test.ts` (atrapy bez parametrów → `mock.calls: []`). Wykonawca widział zielony typecheck na bazie `e69234c1` przy innej pamięci podręcznej `tsgo`. |
| `bun run lint`                                                                                                                                                                                                                                                                                                                                                                                                         | ✓ 0 błędów, 282 ostrzeżenia (bez przyrostu względem bazy)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `TZ=UTC bunx vitest run --maxWorkers=3` - katalogi karty S2 (`src/lib/revenue/finance`, `src/lib/billing`, `src/lib/retention`, `src/components/billing`, `src/lib/email-templates`, `src/components/admin/billing`) + `src/lib/ci`, `src/lib/realtime`, `src/lib/analytics/semantic`, `queryKeyLiterals.gate`, `i18nParity.gate`, `i18nKeyDrift.gate`, testy tras rozliczeń i profilu oraz `adminRouteAuthority.gate` | ✓ 334 pliki, 8962 testy + 3 oczekiwane porażki (2,2 min); w tym 4 pliki dotknięte integracją (`subscriptionFalseSuccess`, `snapshot.functions`, `queryKeyLiterals.gate`, `adminBillingRoute`) i `supabaseLaneCoverage` (bliźniaki)                                                                                                                                                                                                                                                                                         |
| `TZ=UTC bunx vitest run --maxWorkers=3 src/routes/__tests__` (cały katalog tras, osobny przebieg)                                                                                                                                                                                                                                                                                                                      | ✓ 225 plików, 8056 testów + 79 oczekiwanych porażek (5 min)                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| pgTAP `run.sh all` (`PGTAP_DIR=/tmp/pgtap-int`, port 5470, `flock`)                                                                                                                                                                                                                                                                                                                                                    | 1273 migracje (1 błąd znany: `20260825230232`); 228 plików: 224 OK, 4 znane błędy środowiska (`community_cron_schedule` 2 i `job_scheduler_heartbeat` 1 - asercje `pg_net`; `public_definer_views_read_only` 1/35 - #3; `profile_intent_semantic` 20/36 - brak `vector`). 7 plików S2 zielone: 195 asercji; `hub_*` i `revenue_community_aggregates` (S4) zielone                                                                                                                                                          |
| `generate:ts-sql-contract` + `run.sh test ts_sql_contract`                                                                                                                                                                                                                                                                                                                                                             | ✓ 941 wywołań RPC (po wpięciu migawki - bez zmiany pliku, nazwa była już w kontrakcie), 1511 operacji na tabelach; 9/9                                                                                                                                                                                                                                                                                                                                                                                                     |
| `check:rpc-contract`                                                                                                                                                                                                                                                                                                                                                                                                   | ✓ 816 nazw, 1654 funkcje                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `check:types-freshness`, `check:migration-lanes`                                                                                                                                                                                                                                                                                                                                                                       | ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `check:sql-{tenant-scope,app-role,anon-insert,definer-views,owner-tenant-scope,policy-tenant-regression,migration-replay}`, `check:on-conflict-arbiters`                                                                                                                                                                                                                                                               | ✓ wszystkie rc=0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `split-migration.ts --dry-run` dla `2026102011*`                                                                                                                                                                                                                                                                                                                                                                       | ✓ każdy plik 1 część (największy `110400` = 44 486 B < 46 080 B)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `flock -o /tmp/hub-build.lock env BUNDLE_INVENTORY=1 bun run build` + `check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity`                                                                                                                                                                                                                                                                | build ✓ (1,7 min); `check:bundle` ✗ wyłącznie `overall` 4989,6 > 4982 → ratchet D-08 4991 → ✓; `check:chunks` ✓ (1457 chunków, acykliczny), `check:entry-purity` ✓, `check:server-entry-purity` ✓                                                                                                                                                                                                                                                                                                                          |
| `bun run scripts/hub-slice-guard.ts S2 --base 6ac07c60`                                                                                                                                                                                                                                                                                                                                                                | exit 1 wyłącznie na zmianach Integratora (§16.4); dostawa huba: 8 plików, 23 definicje funkcji                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `cmp` supabase ⇄ drizzle `0338…0345`                                                                                                                                                                                                                                                                                                                                                                                   | ✓ bajt w bajt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| e2e                                                                                                                                                                                                                                                                                                                                                                                                                    | nieuruchamiane - karta S2 nie wymaga                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### 16.9 Wdrożenie S2 na produkcji (właściciel)

Kod i migracje S2 idą w jednym PR. Zależności w obie strony:

- nowy front przed migracjami woła nieistniejące RPC (PGRST202 →
  `unavailable`/`not_configured`, bez wyjątku): zakładki finansów huba,
  KPI `/admin/billing` (kafle „brak danych”), migawka huba (`snapshot`
  `not_configured`); `startRetentionFlow` zapisuje `started` do
  `retention_feedback` (kolumny I0) - działa już po M0;
- webhook pisze migawkę ceny i rabatu w kolumnach `subscriptions` z I0
  (`090000`) - wymaga M0 (wdrożone, §10);
- stary front po migracjach S2 działa bez zmian (S2 nie zdejmuje kolumn
  ani grantów czytanych przez stary front).

1. **Warunek:** M0, S1 i S4 wdrożone albo wdrażane w tym samym oknie (§10) -
   emitery S2 wołają `_log_emit_error` (`090500`), typy zdarzeń są
   w katalogu I0, księga pisze do tabel `090000`.
2. **Okno nocne** - gorące tabele: `ALTER TABLE` na `subscription_state_history`,
   `mrr_movements`, `dunning_cycles` (`DROP CONSTRAINT`, `DROP NOT NULL`)
   i `CREATE TRIGGER` na `subscriptions`, `billing_documents`,
   `retention_feedback` - każdy pod `SET lock_timeout = '5s'`; backfill
   środowiska `billing_documents` porcjami po 1000 wierszy. Panel Lovable →
   8 plików **w kolejności wersji**:
   1. `20261020110000_revenue_catalog_mirror` (lustro katalogu; funkcje czyste);
   2. `110100_subscription_revenue_history` (ALTER księgi + wyzwalacze na `subscriptions` i `billing_documents`; `lock_timeout` 5 s);
   3. `110200_revenue_backfill` (po `110100` - środowisko dokumentów i saldo otwarcia MRR `reason='backfill'`, tylko `live`, tylko bez ruchów);
   4. `110300_revenue_sql_helpers` (po `110000`);
   5. `110400_revenue_aggregates` (po `110300`);
   6. `110500_revenue_lifecycle_scanner`;
   7. `110600_retention_flow_events` (wyzwalacz na `retention_feedback`; `lock_timeout` 5 s);
   8. `110700_revenue_offer_inputs_economics` (po `110400`).

   Pliki są idempotentne (`CREATE OR REPLACE`, `DROP … IF EXISTS` + `ADD`/
   `CREATE TRIGGER`, `CREATE INDEX IF NOT EXISTS`, backfill pomija wiersze
   już uzupełnione i subskrypcje z ruchami). `55P03` (limit blokady) = ponów
   cały plik.

3. Zaraz potem opublikuj front z tego PR, potem ręczna weryfikacja Z-S2-01
   w trybie testowym (jeśli nie wykonano jej na podglądzie przed scaleniem).
4. Bliźniaki `0338…0345` są kopiami bajt w bajt - po panelu wykonują się jako
   no-op; migrator Drizzle wykona je sam, jeśli panel zostanie pominięty.
5. `workflow_dispatch` CI na `main` → `post-deploy`: `check:db-contract`
   i `check:migration-ledger` (8 wersji) zielone. Wynik do §10.
6. Kontrola po wdrożeniu (SQL editor, tylko odczyt):

```sql
-- RPC panelu S2: oczekiwane 4 niepuste kolumny.
SELECT to_regprocedure('public.admin_revenue_semantic_snapshot(timestamptz,timestamptz)') AS snapshot,
       to_regprocedure('public.admin_revenue_mrr_bridge(timestamptz,timestamptz,text)') AS bridge,
       to_regprocedure('public.admin_revenue_realized(timestamptz,timestamptz)') AS realized,
       to_regprocedure('public.run_revenue_lifecycle_scanner()') AS lifecycle_scanner;
-- 3 wyzwalacze S2: oczekiwane 3.
SELECT count(*) FROM pg_trigger
 WHERE NOT tgisinternal
   AND tgname IN ('trg_subscriptions_revenue_history','trg_billing_documents_renewed_emit',
                  'trg_retention_feedback_emit');
-- Saldo otwarcia: liczba ruchów backfill = aktywne subskrypcje live z ceną katalogową.
SELECT count(*) FROM public.mrr_movements WHERE reason = 'backfill';
-- Skanery tylko dla serwera: oczekiwane false, false.
SELECT has_function_privilege('authenticated', 'public.run_revenue_lifecycle_scanner()', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.run_retention_flow_scanner()', 'EXECUTE');
```

Wycofanie: DDL S2 to funkcje, wyzwalacze, indeks i zdjęcie `NOT NULL`/FK
w tabelach księgi z I0 - bez nowych tabel. Revert kodu przywraca stary
przepływ anulowania (jednym kliknięciem) bez zmian danych. Zdjęcie
wyzwalaczy `trg_subscriptions_revenue_history`/`trg_billing_documents_renewed_emit`

- osobną migracją spoza bloku huba, decyzją właściciela. Backfill (saldo
  otwarcia, środowisko dokumentów) jest addytywny i zostaje.

### 16.10 Kryteria akceptacji S2 (SPEC §8.3)

- [x] `billingCatalogSqlParity.test.ts`: `billing_catalog_entry` = `[...BILLING_CATALOG, ...BILLING_CATALOG_LEGACY]` (z `student_annual`), `billing_months_per_interval` = `monthlyEquivalent` (wspólny fixture vitest/pgTAP), `subscription_mrr_minor` = `catalogPlanQuote` (33 testy; pgTAP `revenue_catalog_mirror` 33).
- [x] `mrrMath.ts` reużywa `monthlyEquivalent`, `catalogPlanQuote`, `catalogRecurringFor` (zero drugiej normalizacji; `mrrMath.test.ts` 10).
- [x] pgTAP 7 plików zielony: `revenue_catalog_mirror` 33, `revenue_subscription_history` 38, `revenue_backfill` 14, `revenue_aggregates` 48, `revenue_lifecycle_scanner` 16, `retention_flow` 20, `revenue_offer_inputs_economics` 26 (pułapka rangi, pauza, waluta, idempotencja, sandbox/mock, suma mostu = MRR końca, migawka = suma ruchów); w `run.sh all` po integracji - §16.8.
- [x] Parsery: `null` ≠ 0, most ±0,5 %, `MoneyByCurrency[]`; `*_KEYS` = listy `set_eq` pgTAP (`parse.test.ts` 211, komentarz `// rpc-shape:` przy każdej stałej; migawka = `REVENUE_SNAPSHOT_KEYS` S6).
- [x] Anulowanie: ≤ 2 kroki (RTL liczy `data-retention-step`), „Anuluj mimo to” na krokach ankiety i oferty, `enabled=false` = samo potwierdzenie (`RetentionDialog.test.tsx` 20 z axe); oferta = rabat `repeating` (atrapa operatora: parametry + klucze idempotencji, `applyOffer.test.ts` 13), 1 oferta / 180 d (`functions.test.ts`).
- [ ] Weryfikacja ręczna właściciela w trybie testowym operatora przed scaleniem - **otwarte** (Z-S2-01, instrukcja §16.5). **I9b (§22.2 B4):** kroki 3-8 i 10 pokryte testami na granicy SDK operatora; otwarte zostają trzy kroki wizualne (panel Stripe, logi, portal z powodami - Z-I9b-13).
- [x] `startRetentionFlow` → `started`; `submitRetentionFeedback` aktualizuje ten sam wiersz (filtr `id`/najemca/użytkownik + `outcome in (started, abandoned)`, zapas INSERT; Z-09 `not_given`).
- [x] Maile P12: snapshoty PL/EN (8: m/ż/neutralny + EN, w okresie i po końcu); każda ścieżka CTA w `tx-*` istnieje w `routeTree.gen.ts` (`notificationsCtaRoutes.test.ts` 12, bez `/cennik`).
- [x] `/admin/billing` pokazuje te same aktywne subskrypcje i MRR co hub - ten sam RPC i klucz (`revenueKeys.query('mrr', tenant, range, {segment})`; `AdminBillingPanel.test.tsx` 60).
- [x] Webhook zapisuje migawkę w kolumnach I0 (wdrożone w M0); PostgREST nie dostaje nieznanych kolumn (`webhookDispatchPriceSnapshot.test.ts` 10: każdy klucz migawki w `subscriptions.Row`).
- [ ] Budżet D-08 (§8.6): **niespełnione w celu** - `overall` +9,0 (ratchet D-08 → 4991), `public` +0,9 (leniwe trasy profilu); entry, `boot`, CSS 0,0; progi zamrożone zielone (§16.7).
- [x] Strażnik: `hub-slice-guard.ts S2 --base 6ac07c60` - wyłącznie pliki współdzielone zmienione przez Integratora (§16.4); dostawa huba: 8 plików, 23 definicje funkcji.

## 17. Stan na koniec sesji 2026-10-19 (przekazanie)

### 17.1 Na gałęzi `claude/elegant-fermat-xwfca1` (PR #527, CI zielone na każdym pushu)

| Element                                   | Commit (head) | Sekcja |
| ----------------------------------------- | ------------- | ------ |
| Krok 0 (dziennik S1/S6, Insider, ratchet) | `83b649e3`    | §11-13 |
| Uspójnienie benchmarków S6 ⇄ Insider      | `e135b91a`    | §14    |
| S4 - CRM, automatyzacje, społeczność      | `6ac07c60`    | §15    |
| S2 - księga MRR, windykacja, anulowanie   | `d71a4017`    | §16    |

Bliźniaki drizzle: S4 `0330…0337`, S2 `0338…0345`; **następny wolny `0346`**.
Budżet `overall` po S2: 4991 (D-08); `public` 2773,9 / 2881 (zamrożony).

### 17.2 S3 (lejek i paywall czytelnika) - scalony 2026-10-20 (§18)

**Aktualizacja 2026-10-20:** PR #527 scalony do `main` (`f149a004`), potem
`main` dostał #528 i potwierdzenie wdrożenia #527 (`0346`, `a39a10bf`); gałąź PR
odtworzona od `main`, S3 dokończony i zintegrowany na niej (§18), łatki
i inwentarz z `docs/kontynuacja` usunięte. Poniżej stan z 2026-10-19.

Stan pracy: 8 commitów na gałęzi lokalnej `hub/s3-lejek-paywall` (head
`3a8899dd`, przebazowana na `d71a4017`), **nie wypchnięta** - zachowana w repo
jako `docs/kontynuacja/s3-wip/0001…0008-*.patch` (`git am` na `d71a4017` albo
nowszej gałęzi PR). Inwentarz: `docs/kontynuacja/S3-stan-2026-10-19.md`.
Brakuje: `public` +5,6 KB przy celu ≤ +1,2 KB (naprawa w kodzie: leniwy
`paywallOffer`/`paywallLinks`), P22 `expires_at` (`adhocCheckout.server.ts`),
`meteringVisitor.functions.ts`, reguła P09 `checkout.display_currency_mismatch`,
integracja (bliźniaki od `0346`, 4 RPC w `types.ts`, wielkość liter globów
testów popupu w manifeście S3, sekcja dziennika), pgTAP i kontrakt TS⇄SQL S3.

### 17.3 Osobne PR do `main` (decyzja właściciela „napraw”)

- #528 `JoinUsForm` - etykiety pól w komunikatach; CI zielone.
- #529 `First visit` - waga dokumentu `/` i seria bootu wpisu; CI zielone
  (workflow First visit uruchamia się na `main` - potwierdzi się po scaleniu).
  Zawiera przeniesiony ratchet `overall` 4972 (no-op po scaleniu #527).

### 17.4 Kolejka i zasady dalszej pracy

Kolejka (aktualizacja 2026-10-20, po S3 - §18, I9a - §19 i S5 - §20):
**S8 → S7 → I9**. Nawigacja huba i skróty ⌘K zakładek są już z I9a;
od 2026-10-20 obowiązuje wymóg właściciela **„wszystko, co robimy, ma być
w panelu admina”** - każdy kolejny wycinek kończy się wejściem w panelu dla
właściwych ról (pozycja/zakładka/karta, ⌘K, sekcyjne `adminPageHead`, PL/EN,
stan pusty z następnym krokiem). Zasady
(decyzje właściciela 2026-10-19): praca **szeregowa** (jeden agent naraz);
lokalnie testy celowane + typecheck + lint + pgTAP + build z budżetem, **pełna
suita vitest w CI**; pamięć kontenera 16 GB - typecheck jako `bunx tsgo
--noEmit --checkers 2` (+ `typecheck:scripts`, `typecheck:e2e`; przy OOM
`GOMEMLIMIT=11GiB GOGC=50 bunx tsgo --noEmit --checkers 1` - Z-S3-05), vitest z
`--maxWorkers=3`, ciężkie kroki po kolei pod `flock -o /tmp/hub-build.lock`.
Gotowy prompt: `docs/KONTYNUACJA_HUB_PRZYCHOD_LEJEK_2026-10-19.md`.

## 18. Wycinek S3 - lejek i paywall czytelnika (2026-10-20)

Gałąź `hub/s3-lejek-paywall` (worktree `/home/user/wt/S3`). Wykonawca pracował
na bazie `e69234c1`, w sesji 2026-10-19 gałąź przebazowano na `d71a4017` (S2)
i zostawiono niescaloną (§17.2: łatki w `docs/kontynuacja/s3-wip`). Po
scaleniu PR #527 do `main` (`f149a004`) gałąź PR `claude/elegant-fermat-xwfca1`
odtworzono od `main`; S3 przebazowano na nią bez konfliktów, dokończono braki
karty i wykonano integrację. Przed wypchnięciem `main` przesunął się do
`a39a10bf` (#528 i `0346_pr527_deployment_completion` - potwierdzenie
wdrożenia #527 przez Lovable), więc S3 przebazowano jeszcze raz (konflikty
tylko w `_journal.json` i `types.ts`), bliźniaki przesunięto na `0347…0351`,
a bramki dotknięte zmianą bazy powtórzono (§18.8); potem fast-forward.
Commity:

- `74157988` - 5 migracji `2026102012*`, 5 plików pgTAP (rejestracja, uderzenia w paywall, P19, kasa, lejek i inwentarz);
- `da5c0818` - warstwa TS lejka i inwentarza dostępu, linki powrotu logowania;
- `0d4caf4f` - paywall czytelnika: oferta per persona, `preview`, powrót po logowaniu, pomiar;
- `4c7e8cca` - licznik, bramka klubu i popup rejestracji w lejku czytelnika;
- `43d00703` - powrót po logowaniu, pomiar lejka konta i kasy, P21, część P22 (`cancel_reason`);
- `09aa029b`, `78041e99` - testy bez nieużywanych pomocników; uderzenie liczone dopiero po ustaleniu sesji;
- `c6a66265` - P08 w popupie rejestracji (zgoda newslettera domyślnie odznaczona);
- `1a6c2795` - dokończenie karty: P22 `expires_at`, wspólny skrót gościa, budżet `public` (§18.2, §18.7);
- `6cecc813`, `5c41f3c6` - integracja: pliki współdzielone (§18.4);
- `a310387e`, `5243b3be` - ratchet `overall` 4991 → 4995 → 4997 (D-08, §18.7);
- ten wpis.

Pełny pakiet vitest uruchamia CI nowego PR (decyzja właściciela 2026-10-19:
lokalnie testy celowane, typecheck, lint, build z budżetem i pgTAP - §18.8).

### 18.1 Zakres

Wykonawca: 76 plików, +8807 / −202 linii (8 commitów). Z dokończeniem
i integracją (bez tego wpisu): 95 plików, +10 811 / −213.

| Obszar                               | Co dostarcza S3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL (5 migracji, 9 funkcji)          | `120000` `account.registered.v1` z wyzwalacza na `profiles` (źródło rejestracji z białej listy `SIGNUP_SOURCES`, P16; payload bez PII); `120100` `record_paywall_hit` (konto, `authenticated`) i `record_paywall_hit_visitor` (gość, wyłącznie `service_role`) do `paywall_hits`, `paywall.hit.v1` raz na konto i dobę; `120200` `_metered_view_consume` z progiem rangi (P19) i `metering.quota_exhausted.v1` raz na konto i miesiąc (`revenue_event_marks`, zero skanu dziennika), `log_metering_event` bez obcego `_visitor_id`; `120300` `checkout.started/completed/failed/abandoned.v1` z wyzwalacza na `payment_orders` (tylko `live`, bez atrapy; `abandoned` tylko z `cancel_reason = 'session_expired'`); `120400` `_funnel_counts`, `admin_revenue_funnel` (tor samoobsługowy + sprzedaż), `admin_revenue_access_inventory`. |
| Lejek i inwentarz (TS)               | `src/lib/revenue/funnel/{dto,parse,funnelStages,funnel.functions,queries}.ts`, `src/lib/revenue/access/{dto,parse,access.functions,queries}.ts` (parsery `null` ≠ 0, literały RPC, stany 42501/PGRST202/22023), słownik `i18n-admin-revenue-funnel.ts` (PL/EN).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Paywall czytelnika (P14, P09, AD-16) | `resolvePaywallOffer` (`paywallOffer.ts`) - macierz person × reguła lustrzana do `has_content_access`; ceny widzi też gość; zalogowany z rangą za niską dostaje „wymaga planu X” i upgrade; plan na zapytanie → `contact_sales`; członek organizacji → `contact_org`. `Paywall` += `preview` (symulator S7: bez `consume`, `record_paywall_hit` i `track`, linki `aria-disabled`); oferta dociąga się `import()` po pierwszym renderze (teaser i CTA w pierwszym renderze); EN pokazuje „Charged in {{currency}}” (P09).                                                                                                                                                                                                                                                                                                                |
| Powrót po logowaniu (P15)            | `paywallLinks.ts` (`safeNextPath` - odrzuca `//host`, `https://…`, `/\host`, `%2F%2F`, pętle logowania; `loginSearch`, `parseLoginSearch`, `postLoginTarget`, `signupRedirectPath`); `/login` przyjmuje `next`/`intent`/`plan` kształtem, sanitizuje `AuthPortal` (wygląd bez zmian); `/auth/callback` i sukces kasy wracają na `next`; CTA darmowej warstwy `mode=signup`.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Pomiar (P18)                         | `paywall_view`, `paywall_cta_click`, `checkout_view`, `checkout_submit`, `signup_completed`, `login_completed`, `pricing_audience_change` - wyłącznie przy zgodzie analitycznej (także kopia GA4, `ga4EventMap`); `record_paywall_hit` bez zgody i bez identyfikatora przeglądarki; stopka liczy zapis newslettera po sukcesie (`footerTracking`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Popup i zgody (P08, P17)             | Zgoda newslettera domyślnie odznaczona (`PopupSignupForm`, bramka klubu); popup rejestracji nie dla zalogowanych; odmowa zgody marketingowej nie wygasza zaproszenia do konta (`overlayCoordinator`, slot `invite`); bramka klubu z `useHydrated` (AGENTS).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Kasa (P21, P22)                      | `/plans/$planId` przy `cta_mode = contact` - formularz kontaktu zamiast kasy; `checkout.session.expired` zapisuje `cancel_reason = 'session_expired'` w tym samym zapisie co status; `expires_at` sesji Stripe z `checkout_settings.abandon_after_minutes` (§18.2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### 18.2 Decyzje

- **S3 prosto do gałęzi PR** (odtworzonej od `main` po #527), jak S1, S2 i S4:
  migracje, bliźniaki i kod w jednym PR.
- **P22 - `expires_at`** (dokończenie): okno = `abandon_after_minutes` + 60 s
  zapasu (opóźnienie i dryf zegara względem operatora), nie mniej niż minimum
  operatora 30 min; okno sięgające doby (domyślne 1440 min) zostawia parametr
  pusty - operator i tak zamyka sesję po 24 h, więc dla najemcy bez zmiany
  ustawień zachowanie jest bit w bit dotychczasowe. Dotyczy sesji planu
  i ad-hoc (treść, bilet). Wartość liczona raz przed `sessions.create`:
  ponowienia SDK wysyłają ten sam ładunek, a klucz idempotencji jest per
  zamówienie zakładane w tym samym żądaniu. Kolumnę czyta wyłącznie serwerowy
  `loadCheckoutSettings` (granice z `REVENUE_LIMITS`, poza CHECK = okno
  domyślne); `CHECKOUT_SETTINGS_COLUMNS` panelu i dokumentów bez zmian.
- **Skrót gościa** (dokończenie): `meteringVisitorDigest(purpose)`
  w `meteringVisitor.server.ts` - jedno miejsce odczytu podpisanego cookie
  i sekretu dla liczników gościa; handler `record_paywall_hit_visitor` nie
  powiela już wyboru sekretu ani HMAC (skrót bit w bit ten sam:
  `HMAC(secret, "paywall_hit:<uuid>")`). `meteringVisitor.functions.ts` bez
  zmian - moduł `.functions` zawiera wyłącznie deklaracje server fn
  (tss-serverfn-split), a dublowanie było po stronie serwera.
- **P09:** napis waluty obciążenia jest w S3; reguła
  `checkout.display_currency_mismatch` to diagnostyka S7 (SPEC §5.7: „warn,
  P09, kod - cennik”) - zostaje dla S7 (Z-S3-03).
- **Plan B karty** (oferta przez `import()` po pierwszym renderze) zachowany:
  wpis bez paywalla nie pobiera modułu oferty. Budżetu `public` nie obniża -
  bramka liczy każdy chunk osiągalny z publicznego adresu (Z-S3-01, §18.7).
- **D-08:** ratchet `overall` 4991 → 4995 (pomiar na `f149a004`: +4,4 KB,
  w całości `public`), po przebazowaniu na `a39a10bf` korekta 4995 → 4997
  (+5,8 KB: kod S3 ok. +4,7, reszta to entropia hashy w nazwach importów,
  §18.7). `css` bez zmian (99,7).

### 18.3 Odchylenia od SPEC (kontrakt bez zmian, fakty repozytorium wygrywają)

| Miejsce SPEC / karta S3                                | Stan po S3                                                                                                                                  | Uzasadnienie                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| §4.8 `CIALO-Z` `log_metering_event` = `20261013090400` | `-- CIALO-Z: 20260721070203` w `120200`; `HUB_CIALO_Z` (I0) ma tę samą wersję; po scaleniu S1/S2/S4 grep potwierdza brak nowszej definicji. | `20261013090400` zawiera dla tej funkcji wyłącznie `REVOKE`/`GRANT`; najnowsze `CREATE` to `20260721070203`. |
| P22 w `stripeCheckout.functions.ts`                    | `expires_at` w `adhocCheckout.server.ts` (obie sesje), odczyt okna w `checkoutSettings.server.ts`, pole opcjonalne w `CheckoutSettings`.    | Sesje Stripe powstają w `adhocCheckout.server.ts`; server fn tylko wołają tę warstwę.                        |
| Karta: `meteringVisitor.functions.ts` (zmienia)        | Wspólny pomocnik w `meteringVisitor.server.ts`; plik `.functions` bez zmian.                                                                | §18.2 - deklaracje server fn bez logiki.                                                                     |
| Karta: `public` ≤ +1,2 KB                              | +5,4 KB (2774,4 → 2779,8 na `a39a10bf`), próg 2881 zielony.                                                                                 | Z-S3-01 (§18.7).                                                                                             |
| P09 reguła `checkout.display_currency_mismatch`        | Wyłącznie napis waluty (`paywall.offer.chargedIn`).                                                                                         | Reguła diagnostyki = S7 (§5.7), Z-S3-03.                                                                     |
| §6.6 `loginHref(mode, next, intent, planId)`           | Jest; ścieżki w UI budują obiekt `search` routera (`loginSearch`), adres tekstowy - `signupRedirectPath` (`emailRedirectTo`).               | Link routera nie potrzebuje sklejonego adresu.                                                               |
| `/login` - sanitizacja `next` w trasie                 | Walidator trasy przepuszcza `next`/`intent`/`plan` wyłącznie kształtem (napis z limitem); sanitizuje `AuthPortal` (`parseLoginSearch`).     | Walidator jedzie w chunku wejściowym - bez modułu lejka w `app-initial` (test `loginReturn`).                |

### 18.4 Zgłoszenia „Do integracji” wykonane przez Integratora S3

Strażnik `hub-slice-guard.ts S3 --base a39a10bf` po integracji zgłasza
wyłącznie zmiany Integratora: `[plik-wspoldzielony]`
`drizzle/migrations/meta/_journal.json`, `scripts/check-bundle-size.ts`,
`src/integrations/supabase/types.ts`, `src/lib/authz/authzSnapshot.generated.ts`,
`src/lib/ci/hubDelivery.ts` oraz `[poza-manifestem]` ten dziennik,
`docs/KONTYNUACJA_HUB_PRZYCHOD_LEJEK_2026-10-19.md` i usunięte
`docs/kontynuacja/**`. Pliki spoza manifestu, których wymagały karta
i bramki, dopisano do manifestu S3 z komentarzem „Integrator S3”.

| Zgłoszenie                  | Zmiana                                                                                                                                                                                                                                 | Pliki                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Bliźniaki drizzle           | 5 bliźniaków (bajt w bajt) i 5 wpisów `_journal.json` w kolejności wersji (§18.6); `check:migration-lanes` zielone.                                                                                                                    | `drizzle/migrations/0347…0351_*.sql`, `meta/_journal.json`, `hubDelivery.ts` (glob) |
| `types.ts`                  | Sygnatury `record_paywall_hit`, `record_paywall_hit_visitor` (`Returns: undefined`), `admin_revenue_funnel`, `admin_revenue_access_inventory` (`Json`) - jak S2: dokumentacja kontraktu, wywołania przez `RpcCallable`.                | `src/integrations/supabase/types.ts`                                                |
| Manifest S3                 | Glob testów popupu małą literą (`popupSignupForm`, `newsletterPopup` - P08), pliki P22 z testami, `meteringVisitor.server.ts`, wpięcie migawki, test trasy cennika.                                                                    | `src/lib/ci/hubDelivery.ts`                                                         |
| Z-S6-16 (lejek)             | `REVENUE_DOMAIN_READS.funnel` = `admin_revenue_funnel(p_since, p_until, p_segment, p_track: "all")` - kształt z `WPIECIA_DOCELOWE`, klucze płaskie `REVENUE_FUNNEL_KEYS`; test „każde wpięcie produkcyjne woła SWOJĄ funkcję” zielony. | `src/lib/analytics/semantic/revenueSnapshot.functions.ts`                           |
| Snapshot bramek autoryzacji | `generate:authz-snapshot`: `admin_revenue_access_inventory` czyta flagę `premium_content` (inwentarz warstw dla admina/editora za `is_admin_or_editor`, nie bramka czytelnika) - wpis do przeglądu (Z-S3-06).                          | `src/lib/authz/authzSnapshot.generated.ts`                                          |
| P15 w teście cennika        | CTA darmowej warstwy → `/login?mode=signup&intent=pricing` (asercja świadomie zmieniona).                                                                                                                                              | `src/routes/__tests__/pricingRoute.test.tsx`                                        |
| Budżet D-08                 | Ratchet `overall` 4991 → 4995 → 4997 z wpisem w kronice (§18.7).                                                                                                                                                                       | `scripts/check-bundle-size.ts`                                                      |
| Przekazanie                 | Łatki `docs/kontynuacja/s3-wip/*.patch` i inwentarz `S3-stan-2026-10-19.md` usunięte - praca jest w historii, treść inwentarza w tej sekcji.                                                                                           | `docs/kontynuacja/**`                                                               |

**Do integracji S5/S7/I9 (nie wykonane przez Integratora S3):**

- **S5 (szablony ścieżek):** „porzucony koszyk” na `checkout.abandoned.v1`
  (P22 - okno z `abandon_after_minutes`), „powitanie konta” na
  `account.registered.v1`, „wyczerpany limit” na `metering.quota_exhausted.v1`.
- **S7 (zakładki i diagnostyka):** zakładka lejka i inwentarza dostępu na
  `queryOptions` z `src/lib/revenue/{funnel,access}/queries.ts` i słowniku
  `i18n-admin-revenue-funnel`; symulator czytelnika = `<Paywall preview>`;
  reguły `checkout.display_currency_mismatch` (P09), `paywall.members_rank_no_cta`
  (regresja P14), `funnel.signup_popup_for_members` (regresja P17),
  `checkout.abandon_window_default` (dialog okna porzucenia - pole
  `checkout_settings.abandon_after_minutes` nie miało UI; od I9a jest
  w karcie kasy, §19).
- **I9:** przegląd wpisu `premium_content` w snapshocie autoryzacji
  (Z-S3-06); e2e S3 w CI (Z-S3-04).

### 18.5 Zgłoszenia otwarte

| ID      | Zgłoszenie                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Z-S3-01 | **Budżet `public` ponad cel karty:** +5,4 KB (2774,4 → 2779,8 na `a39a10bf`; na `f149a004` +4,6: 2773,9 → 2778,5) przy celu ≤ +1,2 KB; próg zamrożony 2881 zielony (zapas 101,2 KB). Po dokończeniu zdjęto 1,4 KB (chunki-fasady). Reszta to kod funkcji, ok. +4,7 KB (rozbicie §18.7), i entropia hashy. Plan B karty nie obniża tej liczby: `public` liczy każdy chunk osiągalny z publicznego adresu (`check-bundle-size.ts`: „przeniesienie kodu z eager do lazy nie rusza tej liczby”). Decyzja właściciela: akceptacja odchylenia albo okrojenie funkcji (np. rezygnacja z oferty dla gościa). **Zamknięte w I9b (§22.2 B1): decyzja właściciela - bez okrajania funkcji; przegląd redukcji (słowniki, martwy kod, duplikaty, przeniesienie oferty na serwer) bez bezpiecznego zysku zbliżającego do celu; akceptacja odchylenia +4,2 KB ponad cel (+5,4 przy celu +1,2), próg 2881 bez zmian.** |
| Z-S3-02 | Uderzenia gości w paywall są dolną granicą: bez ważnego cookie licznika (`nes_mvid`, zakłada je dopiero konsumpcja limitu) uderzenie nie jest liczone, bo pomiar nie ma podstawy, by zakładać identyfikator przeglądarki. Wskaźniki PHR/PSCR liczą konta, nie gości.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Z-S3-03 | P09: reguła diagnostyki `checkout.display_currency_mismatch` - S7 (§5.7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Z-S3-04 | e2e S3 lokalnie częściowo: kontener bez sekretów Supabase w serwerze dev - testy z sesją podstawioną w magazynie (`login-return`, link aktywacyjny) czekają na nawigację portalu do limitu, a `checkout.spec.ts:66` nie widzi linku do logowania. Na czystym `main` w tym kontenerze padają tak samo `checkout.spec.ts:66` i `event-paid-registration.spec.ts:252`. Rozstrzyga job `e2e` CI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Z-S3-05 | `bunx tsgo --noEmit --checkers 2` ginie z OOM (137) przy 15 GB także na bazie; przechodzi `GOMEMLIMIT=11GiB GOGC=50 bunx tsgo --noEmit --checkers 1` (szczyt ok. 13,7 GB). Propozycja dla kolejnych wycinków: ten wariant jako lokalny typecheck.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Z-S3-06 | Snapshot autoryzacji zgłasza `admin_revenue_access_inventory` jako bramkę flagi `premium_content` (bez ról omijających). Funkcja jest za `is_admin_or_editor` i tylko raportuje warstwy z tą flagą - do potwierdzenia w przeglądzie (I9). **Zamknięte w I9b (§22.2 B2): potwierdzone - raport personelu, nie bramka czytelnika; generator bez mechanizmu adnotacji, wpis zostaje; pgTAP `hub_i9b_access_inventory_authz` dowodzi odmowy dla anon, czytelnika, roli `user`, autora i editora innego najemcy.**                                                                                                                                                                                                                                                                                                                                                                                          |
| Z-S3-07 | P22 obejmuje wszystkie sesje kasy (plan, treść, bilet): krótsze okno zwalnia rezerwację biletu szybciej (`expireCheckoutOrder`). Domyślne 1440 min nie zmienia zachowania; wartość okna ustawia właściciel (UI - S7). **Aktualizacja 2026-10-20:** pole z dymkiem o skutkach dla rezerwacji biletów jest w karcie kasy od I9a (§19); dialog naprawy - S7. **Zamknięte w I9b (§22.2 B3): akceptacja jednego okna; linia z bieżącym oknem i linkiem do karty kasy w nagłówku karty biletów wydarzenia (`EventTicketCheckoutWindowNote`).**                                                                                                                                                                                                                                                                                                                                                               |

### 18.6 Bliźniaki drizzle

| Wersja supabase                           | Bliźniak                        | idx | `when`        |
| ----------------------------------------- | ------------------------------- | --- | ------------- |
| `20261020120000_account_registered_event` | `0347_account_registered_event` | 347 | 1792476433912 |
| `20261020120100_paywall_hits_rpc`         | `0348_paywall_hits_rpc`         | 348 | 1792476493912 |
| `20261020120200_metering_quota_rank_gate` | `0349_metering_quota_rank_gate` | 349 | 1792476553912 |
| `20261020120300_checkout_events`          | `0350_checkout_events`          | 350 | 1792476613912 |
| `20261020120400_revenue_funnel_access`    | `0351_revenue_funnel_access`    | 351 | 1792476673912 |

Numery od pierwszego wolnego na `main` w chwili scalenia: `0346` zajął
`0346_pr527_deployment_completion` (Lovable, potwierdzenie wdrożenia #527,
`when` = 1792476373912), więc `when` = 1792476373912 + n·60 000. Pierwsza
integracja (na `f149a004`) dała `0346…0350` - przesunięte przy
przebazowaniu (§4.4 pkt 3; glob w `hubDelivery.ts` zaktualizowany). `cmp`
supabase ⇄ drizzle: bajt w bajt. **Następny wolny numer: `0352`** (idx 352),
bez rezerwacji (§6).

### 18.7 Pomiar bundla

`flock -o /tmp/hub-build.lock env BUNDLE_INVENTORY=1 bun run build` +
`check:bundle`, ten sam host i te same `node_modules`. Bazy zbudowane
w `/home/user/neweustrategies-dc633fb5`: `f149a004` (`main` po PR #527; kod =
drzewo końcowe S2) i `a39a10bf` (`main` po #528 - baza końcowa). Przypisanie:
gzip -9 per chunk z `.output/public/assets` (nazwa bez hasha) i inwentarz
modułów (`reports/chunk-inventory.json`), baza ⇄ S3.

| Budżet (gzip KB)         | Próg przed / po | Baza `f149a004` | S3 wykonawca (`f149a004`) | S3 po dokończeniu (`f149a004`) | Baza `a39a10bf` | S3 końcowy (`a39a10bf`) | Δ S3 (końcowa) | Cel S3 (§8.6) | Wynik                                                                                |
| ------------------------ | --------------- | --------------- | ------------------------- | ------------------------------ | --------------- | ----------------------- | -------------- | ------------- | ------------------------------------------------------------------------------------ |
| `overall`                | 4991 / **4997** | 4989,6          | 4995,3                    | 4994,0                         | 4989,8          | 4995,6                  | **+5,8**       | -             | próg 4991 ✗ → ratchet D-08 4995, po przebazowaniu korekta (4995,6 → 4996 → +1)       |
| `admin-only`             | -               | 2215,6          | 2215,8                    | 2215,5                         | 2215,4          | 2215,9                  | +0,5           | -             | entropia hashy; snapshot autoryzacji +0,05                                           |
| `public`                 | 2881 (zamr.)    | 2773,9          | 2779,5                    | 2778,5                         | 2774,4          | 2779,8                  | **+5,4**       | ≤ +1,2        | próg ✓; cel ✗ (Z-S3-01)                                                              |
| największy chunk (entry) | 286 (zamr.)     | 257,9           | 258,0                     | 258,1                          | 257,8           | 258,1                   | +0,3           | -             | ✓                                                                                    |
| `css`                    | 100             | 99,7            | 99,7                      | 99,7                           | 99,7            | 99,7                    | 0,0            | 0             | ✓ (bez ratchetu)                                                                     |
| `publicCss`              | 85 (zamr.)      | 83,8            | 83,8                      | 83,8                           | 83,8            | 83,8                    | 0,0            | -             | ✓                                                                                    |
| `boot`                   | 579 (zamr.)     | 471,6           | 471,8                     | 471,8                          | 471,6           | 471,8                   | +0,2           | -             | ✓                                                                                    |
| liczba chunków           | -               | 1457            | -                         | 1459                           | 1457            | 1459                    | +2             | -             | `check:chunks` ✓ (acykliczny), `check:entry-purity` ✓, `check:server-entry-purity` ✓ |

Dokończenie: `paywallOffer` importował katalog planów, warstwy, organizację,
klienta Supabase i server fn uderzenia przez `import()`. Moduły, które inne
chunki importują statycznie, Rolldown emitował wtedy jako chunki-fasady
z pełną listą eksportów (`tiers` +0,30, `queries` +0,20, `membership` +0,12,
osobna zaślepka `paywallHits.functions` +0,22). Moduł oferty sam jest leniwy,
więc importy w nim są teraz statyczne: −1,4 KB `public` przy tym samym
zachowaniu.

Przypisanie przyrostu `public` (gzip KB, S3 końcowy ⇄ baza `a39a10bf`; moduły
z inwentarza):

| Chunk (klasa)                  | Δ gzip KB | Przyczyna                                                                                                                                                        |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_` (trasa wpisu, leniwy)      | +1,61     | `Paywall.tsx` +5,6 KB surowo (oferta per persona, tytuł progu, CTA gościa z powrotem, `preview`, pomiar), `i18n-paywall` +1,2 KB (PL/EN), `MeterBanner` +0,4 KB. |
| `paywallOffer` (nowy, leniwy)  | +1,23     | `resolvePaywallOffer`, `loadPaywallOffer`, `recordPaywallHit` i zaślepka klienta `recordPaywallHitVisitor` (4,2 KB surowo).                                      |
| `paywallLinks` (nowy, wspólny) | +0,78     | Sanitizacja `next` i parametry `/login` (2,7 KB surowo) - wspólne dla paywalla, licznika, bramki klubu, portalu, `/auth/callback` i sukcesu kasy.                |
| `club._clubSlug.index`         | +0,40     | Bramka klubu: `useHydrated`, pomiar, powrót po logowaniu, kontekst planu (+1,3 KB surowo).                                                                       |
| `app-initial` (entry, boot)    | +0,20     | Walidator `/login` z `next`/`intent`/`plan` (+0,3 KB surowo), nazwy GA4 lejka; reszta - hashe importów.                                                          |
| `AuthPortal`                   | +0,18     | `next`/`intent`/`plan`, źródło rejestracji, zdarzenia konta.                                                                                                     |
| `checkout._planId`             | +0,12     | `checkout_view`, `checkout_submit`.                                                                                                                              |
| pozostałe moduły S3            | +0,23     | `SupporterStrip` (cennik: P15/P18) +0,07, `auth.callback` +0,06, `overlay` +0,05, `NewsletterPopup` +0,03, `login` +0,03.                                        |
| entropia hashy                 | ok. +0,7  | Nowe hashe w nazwach importów - po kilka bajtów w ~700 chunkach, bez zmiany modułów.                                                                             |

Ratchet `overall` 4991 → 4995 (`a310387e`) i korekta 4995 → 4997 po
przebazowaniu (`5243b3be`) w `scripts/check-bundle-size.ts` z wpisem
w kronice. Progi `public`, `publicCss`, `chunk`, `boot` bez zmian i w normie;
`css` bez zmian.

### 18.8 Weryfikacja końcowa S3

Worktree `/home/user/wt/S3`: pełny zestaw na `f149a004` po dokończeniu
i integracji, a po przebazowaniu na `a39a10bf` powtórzone bramki dotknięte
zmianą bazy (ostatni wiersz tabeli; `main` nie dodał migracji `supabase/`,
więc pgTAP z `f149a004` jest aktualny).
Decyzja właściciela (2026-10-19): lokalnie testy celowane; **pełny pakiet
vitest uruchamia CI nowego PR**. Pamięć 16 GB: ciężkie kroki po kolei.

| Polecenie                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Wynik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run format:check`                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `bun run verify:static`                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ✓ 18 bramek w 279 s (`check:migration-lanes` 351 wpisów, bliźniaki S3 rozpoznane; `check:types-freshness` 381 tabel; `check:ts-sql-contract` 945 wywołań RPC)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `bunx tsgo --noEmit --checkers 2`                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✗ OOM 137 (szczyt 14,8 GB) - środowisko (Z-S3-05)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GOMEMLIMIT=11GiB GOGC=50 bunx tsgo --noEmit --checkers 1 && bun run typecheck:scripts && bun run typecheck:e2e`                                                                                                                                                                                                                                                                                                                                                              | ✓ 0 błędów (szczyt 13,7 GB)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `bun run lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✓ 0 błędów, 282 ostrzeżenia (bez przyrostu względem bazy)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `TZ=UTC bunx vitest run --maxWorkers=3` - `src/lib/access`, `src/lib/revenue`, `src/components/{__tests__,clubs,auth,pricing,molecules}`, `src/routes/api/public`, `src/routes/__tests__`, `src/lib/{analytics,billing,ci,realtime,__tests__}`                                                                                                                                                                                                                                | ✗ → ✓: 844 pliki, 24 400 testów + 101 oczekiwanych porażek (10,7 min); jedna czerwień - `pricingRoute.test.tsx` przypinał goły `/login` (P15, §18.4), po poprawce zielony                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `TZ=UTC bunx vitest run --maxWorkers=3` - konsumenci zmienionych modułów spoza zestawu (panel paywalla, popupy, zgody, reklamy, `src/hooks`, `src/lib/{auth,authz,clubs,seo,consent,pricing,newsletter}`, inwariant schematu)                                                                                                                                                                                                                                                 | ✗ → ✓: 294 pliki, 7669 testów; jedna czerwień - `authzSnapshotParity` (nowy wpis `premium_content`, §18.4), po regeneracji 5/5 plików `src/lib/authz` zielone                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| pgTAP `run.sh all` (`PGTAP_DIR=/tmp/pgtap-int`, port 5470, `flock`)                                                                                                                                                                                                                                                                                                                                                                                                           | 1278 migracji (1 błąd znany: `20260825230232`); 233 pliki: 229 OK, 4 znane błędy środowiska (`community_cron_schedule` 2 i `job_scheduler_heartbeat` 1 - `pg_net`; `public_definer_views_read_only` 1/35; `profile_intent_semantic` 20/36 - `vector`). 5 plików S3 zielone: 100 asercji (`account_registered_event` 12, `paywall_hits` 23, `metering_quota_rank_gate` 24 - w tym 1000 wywołań `_metered_view_consume` bez skanu sekwencyjnego, `checkout_events` 14, `revenue_funnel_access` 27); `metering_concurrency` 9, `metering_paywall` 17, `metering_visitor_identity` 45 zielone bez edycji |
| `generate:ts-sql-contract` + `run.sh test ts_sql_contract`                                                                                                                                                                                                                                                                                                                                                                                                                    | ✓ 946 wywołań RPC (+1: wpięcie lejka w migawce), 1510 operacji na tabelach; 9/9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `check:rpc-contract`                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✓ 820 nazw, 1661 funkcji                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `check:types-freshness`, `check:migration-lanes`                                                                                                                                                                                                                                                                                                                                                                                                                              | ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `check:sql-{tenant-scope,app-role,anon-insert,definer-views,owner-tenant-scope,policy-tenant-regression,migration-replay}`, `check:on-conflict-arbiters`, `check:ts-sql-contract`                                                                                                                                                                                                                                                                                             | ✓ wszystkie rc=0 (po ostatnim commicie integracji)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `split-migration.ts --dry-run` dla `2026102012*`                                                                                                                                                                                                                                                                                                                                                                                                                              | ✓ każdy plik 1 część (największy `120400` = 28 532 B < 46 080 B)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `flock -o /tmp/hub-build.lock env BUNDLE_INVENTORY=1 bun run build` + `check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity`                                                                                                                                                                                                                                                                                                                       | build ✓; `check:bundle` ✗ wyłącznie `overall` 4994,0 > 4991 → ratchet D-08 4995 → ✓ (po przebazowaniu 4995,6 > 4995 → korekta 4997 → ✓); `check:chunks` ✓ (acykliczny), `check:entry-purity` ✓, `check:server-entry-purity` ✓                                                                                                                                                                                                                                                                                                                                                                        |
| `flock -o /tmp/hub-build.lock bun run test:e2e -- e2e/paywall.spec.ts e2e/login-return.spec.ts e2e/checkout.spec.ts`                                                                                                                                                                                                                                                                                                                                                          | częściowo (Z-S3-04): 2 ✓ (`pricing page boots…`, „rejestracja z paywalla otwiera formularz rejestracji i zachowuje powrót”), 3 ✗ środowiskowe (sesja podstawiona w magazynie; `checkout.spec.ts:66` pada tak samo na czystym `main`), 12 niewykonanych (tryb `serial` po pierwszej porażce) - rozstrzyga CI                                                                                                                                                                                                                                                                                          |
| `bun run scripts/hub-slice-guard.ts S3 --base a39a10bf`                                                                                                                                                                                                                                                                                                                                                                                                                       | exit 1 wyłącznie na zmianach Integratora (§18.4); dostawa huba: 5 plików, 9 definicji funkcji                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `cmp` supabase ⇄ drizzle `0347…0351`                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✓ bajt w bajt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Po przebazowaniu na `a39a10bf`: `check:{migration-lanes,types-freshness,rpc-contract,ts-sql-contract,on-conflict-arbiters,sql-tenant-scope}`; `GOMEMLIMIT=11GiB GOGC=50 bunx tsgo --noEmit --checkers 1` + `typecheck:scripts` + `typecheck:e2e`; `TZ=UTC bunx vitest run --maxWorkers=3` (`src/lib/{ci,access,revenue,newsletter,analytics,authz,__tests__}`, `src/components/{__tests__,interests,clubs,auth,pricing,molecules}`, `src/routes/api/public`); build + budżety | ✓ wszystkie rc=0 (`check:migration-lanes` 352 wpisy; `ts-sql-contract` 946 wywołań RPC); typecheck 0 błędów (szczyt 12,2 GB); vitest 466 plików, 11 944 testy + 23 oczekiwane porażki (4 min); build ✓, budżety po korekcie ✓, `check:chunks`/`entry-purity`/`server-entry-purity` ✓                                                                                                                                                                                                                                                                                                                 |

### 18.9 Wdrożenie S3 na produkcji (właściciel)

Kod i migracje S3 idą w jednym PR. Zależności w obie strony:

- nowy front przed migracjami: `record_paywall_hit` dostaje PGRST202, który
  paywall połyka (pomiar nigdy nie psuje ściany); lejek i inwentarz w hubie
  pokazują stan „źródło jeszcze niewdrożone”, migawka huba - `funnel`
  `not_configured`; `expires_at` i `cancel_reason` działają bez migracji
  (kolumna `abandon_after_minutes` jest z M0);
- stary front po migracjach S3 działa bez zmian (P19 ma kształt werdyktu
  „licznik nie dotyczy”, który klient już obsługuje).

1. **Warunek:** M0 wdrożone (`paywall_hits`, `revenue_event_marks`,
   `crm_lead_stage_history`, `_log_emit_error`, `revenue_segment_of_tier`),
   S1, S2 i S4 wdrożone albo w tym samym oknie (§10).
2. **Okno nocne** - gorące tabele: `CREATE TRIGGER` na `profiles` (`120000`)
   i `payment_orders` (`120300`) pod `SET lock_timeout = '5s'`. Panel Lovable →
   5 plików **w kolejności wersji**:
   1. `20261020120000_account_registered_event` (wyzwalacz na `profiles`);
   2. `120100_paywall_hits_rpc`;
   3. `120200_metering_quota_rank_gate` (redefinicja `_metered_view_consume` i `log_metering_event`, sygnatury bez zmian);
   4. `120300_checkout_events` (wyzwalacz na `payment_orders`);
   5. `120400_revenue_funnel_access` (po `120100`).

   Pliki są idempotentne (`CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`
   - `CREATE TRIGGER`, bezstanowe `REVOKE`/`GRANT`). `55P03` (limit blokady) =
     ponów cały plik.

3. Zaraz potem opublikuj front z tego PR.
4. Bliźniaki `0347…0351` są kopiami bajt w bajt - po panelu wykonują się jako
   no-op; migrator Drizzle wykona je sam, jeśli panel zostanie pominięty.
5. `workflow_dispatch` CI na `main` → `post-deploy`: `check:db-contract`
   i `check:migration-ledger` (5 wersji) zielone. Wynik do §10.
6. Kontrola po wdrożeniu (SQL editor, tylko odczyt):

```sql
-- RPC S3: oczekiwane 4 niepuste kolumny.
SELECT to_regprocedure('public.record_paywall_hit(text,uuid,text,text,text)') AS hit,
       to_regprocedure('public.record_paywall_hit_visitor(text,uuid,text,uuid,text,text,text)') AS visitor_hit,
       to_regprocedure('public.admin_revenue_funnel(timestamptz,timestamptz,text,text)') AS funnel,
       to_regprocedure('public.admin_revenue_access_inventory()') AS inventory;
-- 2 wyzwalacze S3: oczekiwane 2.
SELECT count(*) FROM pg_trigger
 WHERE NOT tgisinternal
   AND tgname IN ('trg_profiles_account_registered_emit', 'payment_orders_checkout_emit');
-- Licznik gościa tylko dla serwera: oczekiwane false, false.
SELECT has_function_privilege('anon', 'public.record_paywall_hit_visitor(text,uuid,text,uuid,text,text,text)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.record_paywall_hit_visitor(text,uuid,text,uuid,text,text,text)', 'EXECUTE');
```

Wycofanie: DDL S3 to funkcje i dwa wyzwalacze - bez nowych tabel i kolumn.
Revert kodu przywraca dawny paywall (plany tylko dla zalogowanych) bez zmian
danych. Zdjęcie wyzwalaczy `trg_profiles_account_registered_emit`
i `payment_orders_checkout_emit` - osobną migracją spoza bloku huba, decyzją
właściciela; redefinicja `_metered_view_consume` wraca przez ciało
z `20261013090400` (P19 znika).

### 18.10 Kryteria akceptacji S3 (SPEC §8.3)

- [x] Macierz person RTL (gość, zarejestrowany bez planu, ranga za niska, z planem, wyczerpany limit, hasło, członek organizacji bez miejsca, plan na zapytanie) - tekst i CTA; teaser bez `body` w DOM; `preview` nie woła `consume_metered_view`, `record_paywall_hit` ani `track` (`Paywall.reader.test.tsx`, `Paywall.test.tsx`).
- [x] `next`: tylko ścieżki względne (`//evil.com`, `https://…`, `/\evil`, `%2F%2F` odrzucone) - `paywallLinks.test.ts`, `loginReturn`, `authCallbackReturn`, `AuthPortal.return`; [ ] e2e bez bazy - napisane, w CI (Z-S3-04).
- [x] pgTAP 5 plików zielony (100 asercji); `metering_*` zielone bez edycji; 1000 wywołań `_metered_view_consume` bez skanu sekwencyjnego (§18.8).
- [x] Zdarzenia klienta tylko przy zgodzie analitycznej; `record_paywall_hit` niezależny od zgody; błąd RPC (i nieudany `import()` modułu pomiaru) nie psuje paywalla.
- [x] Popup rejestracji nie dla zalogowanych (`NewsletterPopup.session.test`); zgoda newslettera domyślnie odznaczona w obu formularzach (`popupSignupForm`, `ClubAccessGate.funnel`).
- [x] `expires_at` sesji kasy z `abandon_after_minutes` (`checkoutSessionFlags.server.test.ts`, `checkoutSettingsLoad.server.test.ts`); `session_expired` zapisuje `cancel_reason` (`oneTimeFulfilment.server.test.ts`); [ ] `e2e/checkout.spec.ts` - CI (Z-S3-04).
- [ ] **`public` ≤ +1,2 KB** - niespełnione: +5,4 KB na `a39a10bf` (+4,6 na `f149a004`; próg zamrożony zielony), odchylenie Z-S3-01 (§18.7). **Odchylenie zaakceptowane - decyzja właściciela 2026-10-20, zgoda delegowana (I9b, §22.2 B1).**

## 19. I9a - nawigacja i widoczność huba w panelu (2026-10-20)

**Decyzja właściciela 2026-10-20:** „wszystko, co robimy, ma być w panelu
admina”. Hub `/admin/revenue` (trasy z I0) był dostępny wyłącznie z adresu -
SPEC §2.4 przewidywał nawigację dopiero w I9. Część nawigacyjna karty I9
(§8.3: pozycje, `searchEntries` ⌘K, `adminNav.test.ts`) przesunięta na teraz
jako krok **I9a**; reszta karty I9 bez zmian. Praca szeregowa (jedyny aktywny
agent), gałąź `hub/i9a-nawigacja` (worktree `/home/user/wt/NAV`) od
`848cbf7e` (PR #530), fast-forward do `claude/elegant-fermat-xwfca1`.
Commity:

- `7cce99c7` - hub w nawigacji panelu i skróty ⌘K;
- `4a7d2925` - zakładki „w przygotowaniu” z etapem i odnośnikami, słownik S6 w Wskaźnikach;
- `c6516a8e` - okno porzucenia kasy w karcie ustawień kasy;
- `dca6f4e9` - manifest I9 i ratchet D-08 `overall` 4997 → 5003;
- ten wpis.

### 19.1 Zakres

| Obszar                               | Co dostarcza I9a                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pasek boczny (`adminNav.ts`)         | Monetyzacja: **pierwsza** pozycja „Przychód i lejek” → `/admin/revenue` (ikona `Route`, słowa kluczowe z SPEC §2.4). CRM: „Ścieżki komunikacji” → `/admin/revenue/journeys` (ikona `GitBranch`) zaraz po „Automatyzacjach”. Podświetlenie: zakładki → hub, lista i edytor ścieżki → Ścieżki (najdłuższe dopasowanie).                                                                                                                                                                                                                                                                                                                             |
| Role (SPEC §2.5)                     | `buildAdminNavGroups` dostaje **dokładne** role sesji (`roles` z `useAuth`) i liczy widoczność przez `hubTabsFor`/`canSeeTab` (S6) - ta sama reguła co pasek zakładek huba. Admin i redaktor widzą obie pozycje; autor i sam `super_admin` (bez wiersza `admin`) - żadnej (hub dałby im `RoleGateNotice`, bo polityki pytają `has_role(…, 'admin')`/`is_admin_or_editor()`).                                                                                                                                                                                                                                                                      |
| ⌘K (`searchEntries`)                 | Skróty do zakładek dostępnych dla roli: Kokpit, Przychód (MRR), Lejek, Retencja, Społeczność, Diagnostyka, Oferta, Dostęp, Ścieżki, Wskaźniki, Dane wejściowe (admin - 11; redaktor - 8, bez zakładek z kwotami). Dopasowanie po własnej nazwie i słowach kluczowych (np. „churn”, „kohorty” → Retencja; „mrr”, „arpu” → Przychód), nazwa huba jako etykieta trafienia, jeden wynik na cel (Ścieżki z huba i z CRM). Enter przenosi z `search`. Napisy `admin.nav.revenueHub`, `admin.nav.journeys`, `admin.nav.revenueTabs.*` (PL/EN, `i18n-admin-core.ts`).                                                                                     |
| Zakładki S7/S8 (zaślepki I0)         | Zamiast zdania „w przygotowaniu” - `RevenueTabPreparing`: nazwa zakładki, stan, **co pokaże** (SPEC §2.2), **kiedy** (etap S7; Ścieżki - S5 + S8; kolejka S5 → S7 → S8 → I9) i **gdzie te dane są dziś** - odnośniki do paywalla (plany, licznik, wyjątki, kasa), cennika (rezygnacje), członkostwa, kuponów, rozliczeń (subskrypcje), rejestru i pulpitu monetyzacji, CRM (kontakty, lejek), newslettera (popup, skrzynka nadawcza), automatyzacji, wydarzeń, klubów (zgłoszenia) i BI. Dane w `src/lib/admin/revenue/tabPreparing.ts` (cele i parametry z `AREA_OWNER_LINK`, SPEC §2.6), słownik przejściowy `i18n-admin-revenue-preparing.ts`. |
| Wskaźniki                            | Gotowy słownik S6 (`MetricDictionary`) podpięty **leniwie** pod stanem „słownik działa, wartości z oceną - S7” (`data-tab-state="partial"`). Benchmarki z server fn z bramką admin/redaktor - ta sama poprzeczka co hub.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Kasa (`/admin/paywall?tab=checkout`) | Pole **„Okno porzucenia kasy (minuty)”** w istniejącej karcie S1 (`CheckoutSettingsCard`): wartość z serwera (brak = 1440), podpowiedź z granicami, dymek PL/EN (porzucenie kasy → lejek i ścieżka porzuconej kasy; dotyczy planu, treści i biletu - krótsze okno szybciej zwalnia rezerwację biletu, Z-S3-07). Wartość spoza 30-1440, ułamek, `1e3` i puste pole → komunikat `role="alert"`, `aria-invalid`, zapis wyłączony (odrzucenie, nie przycięcie). Zapis istniejącym mutatorem S1 z tokenem `updated_at` (CAS).                                                                                                                          |

### 19.2 Decyzje

- **Widoczność = dostęp do trasy.** Pozycje liczą role tak samo jak układ
  huba (`hubTabsFor`), a nie z `isAdmin` (ten liczy też samego
  `super_admin`). Skróty ⌘K to dokładnie zakładki z paska huba dla roli -
  redaktor nie dostaje skrótu do ekranu „brak dostępu”.
- **Ikona Ścieżek `GitBranch`, nie `Workflow` (SPEC §2.4).** `Workflow` nosi
  już „Automatyzacje” piętro wyżej, a w zwiniętym pasku ikona jest jedyną
  etykietą. Obie ikony są w grafie modułów (bez nowych zależności i ikon spoza
  grafu, SPEC §8.6).
- **Nazwy zakładek w `admin.nav.revenueTabs.*`**, nie `adminRevenue.tab.*`:
  słownik huba ładuje dopiero hub, a wyszukiwarka działa na każdej trasie
  panelu. „Przychód (MRR)” zamiast „Przychód”, żeby skrót nie mylił się
  z pozycją huba.
- **„Nowa ścieżka” bez skrótu.** Parametr `?new=1` jest w kontrakcie adresu
  (I0), ale zakładka Ścieżek do S8 go nie obsługuje - skrót obiecywałby akcję,
  która nic nie robi. Test w `adminNav.test.ts` przypina brak (do zmiany
  w S8).
- **Skróty wskaźników ⌘K pominięte** - `metricSearchIndex.ts` (SPEC §2.4)
  to plik S7, którego jeszcze nie ma.
- **Okno porzucenia: jeden predykat, zero importu limitów w kasie
  czytelnika.** `isCheckoutAbandonMinutes`/`parseCheckoutAbandonMinutes`
  w `lib/revenue/limits.ts` czyta formularz i serwer kasy
  (`abandonAfterMinutes` deleguje); bazę pilnuje CHECK (parytet liczb -
  `revenueLimitsParity.test.ts`). `useCheckoutSettings` (moduł publicznej
  kasy - test „nie importuje modułów panelu”) tylko wybiera kolumnę w tym
  samym odczycie co token i przekazuje wartość do zapisu; wartość spoza
  zakresu odrzuca CHECK (`23514`), nigdy przycięcie. Osobne zapytanie o kolumnę
  odrzucone: dwie kopie wiersza z różnymi tokenami pozwoliłyby nadpisać cudzą
  zmianę okna.
- **Karta zapisuje widoczne okno** (także domyślne 1440, gdy najemca nie ma
  wiersza) - to, co admin widzi, jest tym, co zapisuje; asercja
  `platformPaywallRoute.test.tsx` świadomie zmieniona.
- **`adminPageHead`:** trasy huba (I0) i `/admin/paywall` (S1) mają już
  sekcyjne nagłówki - I9a nie dodaje ekranów.
- **D-08:** ratchet `overall` 4997 → 5003 (§19.4).

### 19.3 Zmiany integratorskie i pliki współdzielone

Strażnik `hub-slice-guard.ts I9 --base 848cbf7e`: diff mieści się
w manifeście I9. Pliki spoza listy karty, których wymagał krok, dopisano do
manifestu I9 z komentarzem „Integrator I9a”.

| Plik                                                                                                                                                                   | Właściciel         | Zmiana                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `src/lib/admin/adminNav.ts`, `__tests__/adminNav.test.ts`, `src/lib/i18n-admin-core.ts`                                                                                | współdzielone (I9) | pozycje huba i Ścieżek, `roles`, `searchEntries`, deduplikacja trafień, klucz pozycji z `search`; `admin.nav.*` PL/EN |
| `src/components/admin/AdminShell.tsx`, `__tests__/AdminShell.test.tsx`                                                                                                 | panel (poza hubem) | role sesji do nawigacji, `search` w odnośniku i w Enter; testy pozycji, ról, podświetlenia i ⌘K prawdziwym słownikiem |
| `src/lib/locale/__tests__/coreScopeSurfaces.test.tsx`                                                                                                                  | rdzeń i18n         | wywołanie z `roles`; etykiety skrótów ⌘K też muszą być napisami                                                       |
| `src/components/admin/revenue/tabs/Revenue{Overview,Mrr,Funnel,Retention,Community,Diagnostics,Offer,Access,Metrics,Inputs}Tab.tsx`                                    | S7                 | stan „w przygotowaniu” (Wskaźniki: + słownik S6); S7 podmienia treść i usuwa wpis z `TAB_PREPARING`                   |
| `src/components/admin/revenue/tabs/RevenueJourneysTab.tsx`                                                                                                             | S8                 | stan „w przygotowaniu” (etap S5 + S8)                                                                                 |
| `src/lib/admin/revenue/tabPreparing.ts` (+ test), `src/components/admin/revenue/molecules/RevenueTabPreparing.tsx` (+ test), `src/lib/i18n-admin-revenue-preparing.ts` | I9a (nowe)         | dane, molekuła i słownik stanu „w przygotowaniu” (prefiks `adminRevenue` już w `GATED_PREFIXES` - bez zmiany bramki)  |
| `src/components/admin/paywall/CheckoutSettingsCard.tsx` (+ test RTL), `src/hooks/useCheckoutSettings.ts` (+ test), `src/lib/i18n-admin-paywall-sync.ts`                | S1                 | pole okna porzucenia, odczyt i zapis kolumny, napisy PL/EN                                                            |
| `src/lib/revenue/limits.ts` (+ `checkoutAbandonMinutes.test.ts`)                                                                                                       | I0                 | wspólny predykat i parser okna                                                                                        |
| `src/lib/billing/checkoutSettings.server.ts`, `checkoutSettings.ts`                                                                                                    | S3 / S1            | serwer kasy na wspólnym predykacie; komentarze o czytelnikach kolumny                                                 |
| `src/routes/__tests__/platformPaywallRoute.test.tsx`                                                                                                                   | S1                 | asercja zapisu z `abandon_after_minutes: 1440` (zmiana zamierzona)                                                    |
| `src/lib/ci/hubDelivery.ts`, `scripts/check-bundle-size.ts`                                                                                                            | współdzielone (I9) | manifest I9; ratchet `overall` z kroniką                                                                              |

`generate:authz-snapshot --check` zielony bez regeneracji (I9a nie dotyka
migracji ani bramek SQL).

### 19.4 Pomiar bundla

`flock -o /tmp/hub-build.lock env BUNDLE_INVENTORY=1 bun run build` +
`check:bundle`; baza = build drzewa `848cbf7e` (worktree `/home/user/wt/S3`,
ten sam host i `node_modules`). Przypisanie: gzip -9 per chunk (nazwa bez
hasha) i inwentarz modułów.

| Budżet (gzip KB)            | Próg przed / po | Baza `848cbf7e` | I9a    | Δ        | Wynik                                                                                      |
| --------------------------- | --------------- | --------------- | ------ | -------- | ------------------------------------------------------------------------------------------ |
| `overall`                   | 4997 / **5003** | 4995,6          | 5001,8 | **+6,2** | próg 4997 ✗ → ratchet D-08 (5001,8 → 5002 → +1)                                            |
| `admin-only`                | -               | 2215,9          | 2222,7 | +6,8     | -                                                                                          |
| `public`                    | 2881 (zamr.)    | 2779,8          | 2779,1 | −0,7     | ✓ (nawigacja admina poza pakietem publicznym; `useCheckoutSettings` +0,08, reszta - hashe) |
| największy chunk (entry)    | 286 (zamr.)     | 258,1           | 258,0  | −0,1     | ✓                                                                                          |
| `css`                       | 100             | 99,7            | 99,7   | 0,0      | ✓ arkusze bit w bit te same (bez nowych klas)                                              |
| `publicCss`                 | 85 (zamr.)      | 83,8            | 83,8   | 0,0      | ✓                                                                                          |
| `boot`                      | 579 (zamr.)     | 471,8           | 471,8  | 0,0      | ✓                                                                                          |
| chunki JS (nazwy bez hasha) | -               | 1269            | 1272   | +3       | `check:chunks` ✓ (acykliczny), `check:entry-purity` ✓, `check:server-entry-purity` ✓       |

| Chunk                        | Δ gzip KB | Przyczyna                                                                                                                                                                                 |
| ---------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RevenueTabPreparing` (nowy) | +4,12     | słownik PL/EN opisu, etapu i odnośników 11 zakładek (6,2 KB surowo), dane `tabPreparing` (4,5 KB), molekuła (2,9 KB) - leniwie                                                            |
| `AdminShell`                 | +0,86     | pozycje huba, mapy etykiet i słów kluczowych skrótów, wyszukiwanie po skrótach                                                                                                            |
| `hubTabs` (nowy, wspólny)    | +0,80     | `hubTabs.ts` wspólny dla nawigacji i huba (z `admin.revenue` −0,39)                                                                                                                       |
| `saveErrorToast`             | +0,54     | pole okna porzucenia w karcie kasy i napisy `adminPaywall.checkout.abandonAfter*`                                                                                                         |
| `RevenueMetricsTab`          | +0,54     | leniwy słownik S6 i stan „słownik działa”                                                                                                                                                 |
| `limits` (nowy, wspólny)     | +0,43     | predykat okna współdzielony przez kartę kasy i rozliczenia                                                                                                                                |
| pozostałe                    | −0,7      | `admin.paywall` +0,31, `admin` +0,25 (`admin.nav.*`), `admin.revenue._tab` +0,23, `admin.billing` −0,18, `useCheckoutSettings` +0,08 (kolumna okna w odczycie kasy); entropia hashy −1,38 |

### 19.5 Weryfikacja końcowa I9a

Worktree `/home/user/wt/NAV`, ciężkie kroki po kolei (pamięć 16 GB); pełny
pakiet vitest - CI.

| Polecenie                                                                                                                                                                                                                                | Wynik                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run format:check`                                                                                                                                                                                                                   | ✓                                                                                                                                                                                                    |
| `bun run verify:static`                                                                                                                                                                                                                  | ✓ 18 bramek w 318 s (`check:ts-sql-contract` 946 wywołań RPC, 1510 operacji na tabelach; `check:types-freshness` 381 tabel)                                                                          |
| `GOMEMLIMIT=11GiB GOGC=50 bunx tsgo --noEmit --checkers 1 && bun run typecheck:scripts && bun run typecheck:e2e`                                                                                                                         | ✗ → ✓: jedno wywołanie `buildAdminNavGroups` bez `roles` (`coreScopeSurfaces.test.tsx`), po poprawce 0 błędów                                                                                        |
| `bun run lint`                                                                                                                                                                                                                           | ✓ 0 błędów, 282 ostrzeżenia (bez przyrostu)                                                                                                                                                          |
| `TZ=UTC bunx vitest run --maxWorkers=3` - `src/lib/admin`, `src/routes/__tests__`, `src/components/admin/{revenue,paywall,analytics,__tests__}`, `src/lib/{revenue,ci,__tests__,locale,billing}`, `src/__tests__`, `src/hooks/__tests__` | ✗ → ✓: 814 plików, 23 407 testów + 116 oczekiwanych porażek (10,9 min); jedna czerwień - `platformPaywallRoute` (zapis karty kasy z oknem, zmiana zamierzona), po poprawce 65 plików / 1446 testów ✓ |
| `TZ=UTC bunx vitest run --maxWorkers=3` - konsumenci (`EventInvoicesPanel`, `src/lib/{realtime,access,authz,analytics/semantic}`, `src/components/{checkout,__tests__}`, `src/components/admin/{pricing,membership}`)                    | ✓ 116 plików, 2281 testów + 7 oczekiwanych porażek                                                                                                                                                   |
| `flock -o /tmp/hub-build.lock env BUNDLE_INVENTORY=1 bun run build` + `check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity`                                                                                  | build ✓; `check:bundle` ✗ wyłącznie `overall` 5001,8 > 4997 → ratchet D-08 5003 → ✓; pozostałe ✓                                                                                                     |
| `bun run generate:authz-snapshot --check`                                                                                                                                                                                                | ✓ bez regeneracji                                                                                                                                                                                    |
| `bun run scripts/hub-slice-guard.ts I9 --base 848cbf7e`                                                                                                                                                                                  | ✓ diff mieści się w manifeście; dostawa huba: 0 plików SQL                                                                                                                                           |

Nowe testy: `adminNav.test.ts` (+16: pozycje i role, ikony, podświetlenie,
skróty admina i redaktora, trasy bez 404, deduplikacja, brak „Nowej
ścieżki”), `AdminShell.test.tsx` (+5, prawdziwy słownik PL),
`tabPreparing.test.ts` (78: etapy, odnośniki na stałe trasy z kontraktu,
pokrycie modułów, PL/EN), `RevenueTabPreparing.test.tsx` (5, z axe),
`CheckoutSettingsCard.abandon.test.tsx` (10, RTL: wartość, granice, dymek,
odrzucenie 5 wartości, CAS, PL/EN), `useCheckoutSettings.test.ts` (+4),
`checkoutAbandonMinutes.test.ts` (24).

### 19.6 Co zostaje

- **I9:** odnośniki moduły → hub (`RevenueSignalChip` w 13 modułach, SPEC
  §2.7), baner „przeniesione do huba” w `/admin/monetization` (D-09),
  `RelatedModulesBar` w cenniku, skróty wskaźników ⌘K z
  `metricSearchIndex.ts` (po S7), okruszki edytora ścieżki (S8), reszta karty
  I9 bez zmian (jobs-tick, authz/ownership, tryb ścisły, ratchet końcowy,
  runbook).
- **S7:** podmieniając zaślepkę zakładki, usuń jej wpis z `TAB_PREPARING`
  i gałąź `adminRevenue.preparing.what.*` (odnośniki mogą zostać jako
  „Powiązane moduły”); Wskaźniki - wartości z oceną i `?metric=&ctx=` obok
  słownika; dialog `checkout.abandon_window_default` może prowadzić do pola
  z I9a (`/admin/paywall?tab=checkout`) albo reużyć predykatu z `limits.ts`.
- **S8:** zakładka Ścieżek i obsługa `?new=1` → wtedy skrót ⌘K „Nowa
  ścieżka” w `adminNav.ts` (test przypina dziś jego brak).
- **Wszystkie kolejne wycinki (S5 → S7 → S8 → I9):** wymóg właściciela
  „wszystko w panelu admina” - każda nowa funkcja kończy się wejściem
  w panelu dla właściwych ról (pozycja/zakładka/karta, ⌘K, sekcyjne
  `adminPageHead`, PL/EN, stan pusty z następnym krokiem).

## 20. Wycinek S5 - silnik ścieżek (backend) (2026-10-20)

Gałąź `hub/s5-silnik-sciezek` (worktree `/home/user/wt/S5`), baza
`32e9039a` (gałąź PR `claude/elegant-fermat-xwfca1` po S3, I9a i scaleniu
`main` z #529). Jeden agent wykonał kartę S5 i integrację (praca szeregowa,
decyzja właściciela 2026-10-19); po zielonych bramkach fast-forward gałęzi PR.
Commity:

- `e0c41930` - 6 migracji `2026102014*` i 7 plików pgTAP (trasa i skrzynka, wykonanie, warunki i zgody, RPC panelu, narzędzia panelu, tracking i statystyki);
- `db5ced66` - warstwa TS `src/lib/journeys/**` (graf, warunki, wyzwalacze, 14 szablonów, server fn, `queryOptions`, render, tracking, etykiety), słownik `adminJourneys`, testy;
- `f1c42069` - runner, doręczanie przez istniejącą kolejkę (nadawca i Reply-To z panelu), tracking 1:1 w `nl-open`/`nl-click`/wypisie, wpis `SERVICE_ROLE_READERS`, testy;
- `9938b97f` - integracja: pliki współdzielone (§20.4);
- ten wpis (dziennik, prompt kontynuacji).

Pełny pakiet vitest uruchamia CI PR (decyzja właściciela 2026-10-19:
lokalnie testy celowane, typecheck, lint, pgTAP, build z budżetem - §20.8).

### 20.1 Zakres

84 pliki, +19 055 / −8 linii (bez tego wpisu), w tym 6 bliźniaków drizzle
(3 969 linii kopii) - kod, SQL, testy i pliki współdzielone: ok. +15 100.

| Obszar                           | Co dostarcza S5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trasa i skrzynka (`140000`)      | `trg_journey_route_event` na `domain_events` (warunek `WHEN` odsiewa agregaty ścieżek i diagnostyki, zapytanie po kluczu głównym `journey_event_routes`, ładunek bez imion i nazwisk, błąd trasy → `journey_engine_errors`, nigdy wycofanie zdarzenia szyny); `journey_resolve_lead` (lead → konto/członek → osoba wydarzeń, także z agregatu zgłoszenia przy rezygnacji → subskrybent → aktor spoza personelu; klub `secret` i zdarzenie anonimowe = brak kontaktu; brak leada przy znanym adresie = lead **bez zgody**); `journey_ingest_inbox` (zapis, cel, wyjście, pobudka czekania; zapis tylko przy włączonym silniku i opublikowanej wersji).                                              |
| Wykonanie (`140100`)             | `journey_claim_due` (dzierżawa 120 s, ≤ 20 zapisów na najemcę na tick, ścieżki wstrzymane i najemcy z wyłączonym silnikiem pominięci - poza testem na żywo), `journey_advance` (krok = jeden wiersz `journey_step_runs` na `(zapis, węzeł)`, powtórka po awarii jest no-opem; czekania, A/B z kubełkiem deterministycznym, warunki, akcje CRM), `_journey_exec_action` (etap cyklu przez `crm_set_lifecycle_stage` z pierwszeństwem pisarzy, etap sprzedaży tylko w przód, zadanie CRM z `origin_ref` `journey:{zapis}:{węzeł}`, tagi, lista newslettera, powiadomienie zespołu), `journey_fail_step` (ponowienia 1 min·4ⁿ do 12 h, martwy krok po 8), `journey_tick_emit_stats`, `journey_purge`. |
| Warunki i zgody (`140200`)       | `_journey_eval_predicate` (14 rodzajów, w tym `trigger_field` - §20.3), `journey_can_send` (blokady techniczne → zgoda → limit D-03 → cisza nocna D-03), `journey_contact_for_send` (adres, imię, język z fallbackiem, wariant, temat, dokument, nadawca, zmienne), `journey_validate_graph` (te same reguły co TS + kody parametrów), kolumny `journey_settings.sender_name`/`reply_to` (CHECK, odrzucenie zamiast przycięcia).                                                                                                                                                                                                                                                                   |
| Panel - RPC (`140300`, `140400`) | `admin_journey_{create,save_draft,publish,set_status,email_content_save,settings_get,settings_save,list,enrollments,lead_enrollments,enroll_test,enrollment_skip_wait,enrollment_exit,trigger_estimate,simulate,engine_health}` - najemca i rola z sesji (`_journey_staff_tenant`), publikacja/status/ustawienia/pominięcie czekania tylko admin, CAS po `updated_at` (40001), każda zmiana emituje `journey.changed.v1`.                                                                                                                                                                                                                                                                          |
| Tracking i statystyki (`140500`) | `_journey_message_id` (lustro `deterministicMessageId`), `journey_complete_email_step` (wynik maila: `queued`/`deferred`/`quiet`/`capped`/brak zgody/wypis/blokada/`delivery_not_ready`), `journey_record_message_event` (najemca z wiadomości, deduplikacja doby, otwarcie maszynowe: proxy albo próg `machine_open_seconds`), wypis (`_journey_unsubscribe`), `admin_journey_stats` (per krok, A/B z z-score od 100 zapisów na ramię, rollup > 400 dni albo > 50 tys. zapisów), `admin_journey_series`, `journey_rollup_daily`, redefinicja `email_apply_delivery_event` (najemca po `provider_message_id`).                                                                                     |
| TS (`src/lib/journeys/**`)       | `graph` (zod, `validateJourneyGraph`: DAG, gałęzie, osiągalność, ≤ 60 węzłów, zakaz maila przy `payment_failed`, ostrzeżenia `workflow_overlap`/`trigger_cycle`/`entry_filter_history`), `nodeTypes`, `predicates`, `triggers` (25 wyzwalaczy z kluczami ładunku emiterów S1-S4, `buildTriggerCondition`), `variables` (tryby html/text/url), `dto`, `parse` (rzuca, nie zeruje), `journeys.functions` i `stats.functions` (19 server fn), `queries`, `render.server`, `tracking.server`, `labels` (klucze etykiet z kodów unii), 14 szablonów `templates/**`.                                                                                                                                     |
| Runner i doręczanie              | `src/lib/server/journeysRunner.server.ts` (`runJourneysTick`) - kolejność, termin 3 s, sufit 20 maili, odkładanie, bramka reputacji raz na najemcę, idempotencja; mail przez istniejącą kolejkę (`enqueueRawEmail` → `queueDrain`) z kategorią z `suppressionPolicy` (`journey` = masowa, `journey_service`/`journey_test` = 1:1), nadawca i Reply-To z panelu. Runner **niepodpięty** do `jobs-tick` (I9, §20.4).                                                                                                                                                                                                                                                                                 |
| Trasy publiczne                  | `nl-open`/`nl-click` - gałąź `m=` (token wiadomości `jm:`, podpis linku z numerem, cel tylko podpisany, http(s)); wypis `/api/public/newsletter/unsubscribe` przyjmuje token ścieżki (`ju:`): GET bez mutacji, POST przez limiter, 500 przy awarii (bramka ponawia).                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Słownik                          | `src/lib/i18n-admin-journeys.ts` (`adminJourneys.*`, PL/EN): typy i rodziny węzłów, gałęzie, statusy, powody wyjścia, wyniki kroków, fazy, warunki, wyzwalacze, zmienne, werdykty, kody błędów TS i SQL, adnotacje symulacji, ustawienia, zdrowie, 14 szablonów.                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 20.2 Decyzje

- **S5 prosto do gałęzi PR**, jak S1-S4: migracje, bliźniaki i kod w jednym PR.
- **D-03** (właściciel): maks. **3 maile marketingowe / 7 dni na kontakt**
  liczone razem ze ścieżek (kategoria `marketing`, bez testów) i kampanii
  newslettera (`newsletter_campaign_recipients.status = 'sent'`); limit
  wyczerpany → krok przesuwany o dobę do 3 razy, potem pominięty z wynikiem
  `capped`. **Cisza nocna 21:00-08:00 Europe/Warsaw** (wartości domyślne
  `journey_settings` z I0): mail marketingowy w ciszy czeka do jej końca
  (08:00). Usługa (z podstawą prawną) i test na żywo podlegają wyłącznie
  blokadom technicznym (odbicie, skarga) - nie limitowi, ciszy ani zgodzie
  marketingowej.
- **D-04** (właściciel): porzucona kasa = **marketing**, wymaga zgody
  marketingowej; szablon `abandoned_checkout` tylko dla subskrypcji
  (`{"kind": "subscription"}`), celem jest `checkout.completed.v1`.
- **Silnik wyłączony domyślnie:** brak wiersza `journey_settings` =
  `enabled = false`; przy wyłączonym silniku skrzynka się zamyka bez zapisów,
  a `journey_claim_due` nie pobiera zapisów (poza testem na żywo - admin
  testuje ścieżkę przed włączeniem, M3). Awaryjny wyłącznik środowiska
  `JOURNEYS_ENGINE_DISABLED=1` zatrzymuje runner bez dostępu do bazy; jego
  stan pokazuje `admin_journey_engine_health` (`killSwitch`).
- **„Wszystko w panelu admina”** (wymóg właściciela): każdy przełącznik ma RPC
  i server fn dla UI S8 - włączenie silnika, limit D-03, cisza nocna, strefa,
  nadawca i Reply-To, opiekun zadań, próg otwarcia maszynowego
  (`saveJourneySettings`, odczyt `getJourneySettings`, także stan „brak
  wiersza”), pauza/wznowienie/archiwum ścieżki (`setJourneyStatus`), wyjście
  kontaktu (`exitJourneyEnrollment`), pominięcie czekania (`skipJourneyWait`),
  test na żywo (`enrollJourneyTest`), zdrowie silnika
  (`getJourneyEngineHealth`). Żadnego ustawienia tylko z SQL albo env (poza
  wyłącznikiem awaryjnym, który jest widoczny w panelu).
- **Tożsamość wiadomości:** `message_id = deterministicMessageId("journey:{zapis}:{węzeł}")`
  = `_journey_message_id` (parytet asercją pgTAP i testem TS na tej samej
  stałej). Klucz kolejki = ten sam napis, więc powtórka po awarii między
  kolejką a domknięciem kroku nie wysyła drugiego maila.
- **Tracking 1:1:** rozłączne domeny HMAC - `jm:` (piksel, kliknięcie, podpis
  linku z numerem) i `ju:` (wypis); wyciek piksela nie wypisze odbiorcy.
  Wypis: zgoda leada wycofana z wpisem `crm_consent_log` (`given = false`),
  subskrybent wypisany istniejącym `email_unsubscribe_by_token` (blokada
  `unsubscribe` w tej samej transakcji; bez subskrybenta - sama blokada),
  aktywne zapisy **marketingowe** kontaktu wychodzą z powodem `unsubscribed`;
  globalna trasa wyjścia `newsletter_subscriber.unsubscribed.v1` dla ścieżek
  marketingowych.
- **Wersje i A/B:** publikacja `drain` (zapisy w toku kończą starą wersję)
  albo `exit_all`; kubełek A/B = `hashtextextended(zapis:węzeł) % 100`
  (stały dla kontaktu); z-score tylko przy ≥ 100 zapisach na ramię.
- **Szablony:** 14 w kodzie (instalacja = szkic u najemcy + treść wariantu A),
  ton NES, bez obietnic liczbowych; odnośniki do wiedzy Insidera to wyłącznie
  identyfikatory z `docs/benchmarki/insider-2026-10-19` (test sprawdza ich
  istnienie). `pricing_enquiry_b2b` widoczny jako niedostępny do zdarzenia
  formularza kontaktu (SPEC P25 - po M3). Przypomnienia logistyczne wydarzeń
  zostają w module wydarzeń (szablon nurtowania ich nie dubluje).

### 20.3 Odchylenia od SPEC (kontrakt bez zmian, fakty repozytorium wygrywają)

| Miejsce SPEC / karta S5                      | Stan po S5                                                                                                                                                 | Uzasadnienie                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `winback_30d` z `reason <> 'paused'` (§5.6)  | Nowy rodzaj warunku `trigger_field` (`in`/`not_in` na polu ładunku zdarzenia wejścia) w filtrze wejścia.                                                   | `payload @> condition` nie wyraża zaprzeczenia; warunek żyje w tym samym interpreterze co pozostałe.                                       |
| Limit tagu `JOURNEY_LIMITS.tagMax` = 64 (I0) | Akcje i warunek tagu ≤ 40 znaków (`JOURNEY_TAG_MAX`, SQL `tag_length`).                                                                                    | Pisarz tagów CRM (`run_workflow_step`, panel CRM) przyjmuje 40 - dłuższy tag padłby przy wykonaniu. Z-S5-02.                               |
| §5.2 RPC panelu                              | + `admin_journey_settings_get` (odczyt ustawień, także „brak wiersza” z wartościami domyślnymi).                                                           | Wymóg właściciela: stan każdego przełącznika widoczny w panelu.                                                                            |
| `journey_settings` (I0)                      | + `sender_name` (1-120, bez `<>"` i nowych linii), `reply_to` (≤ 254, adres) w `140200`; `enqueueRawEmail` przyjmuje `fromName`/`replyTo`.                 | Nadawca z panelu, nie z env (domena nadawcza zostaje zweryfikowana - zmienia się tylko nazwa). `transactional.server.ts` poza listą karty. |
| `journey_claim_due(p_limit, p_backlog)`      | `journey_claim_due(p_limit, p_lease_seconds)`; zaległość kolejki sprawdza runner (`email_queue_depth`) i odkłada wyłącznie maile.                          | Kroki bazy (warunki, akcje CRM) nie czekają na kolejkę poczty.                                                                             |
| `journey_tick_emit_stats(p_journey_ids)`     | + `p_counts` (liczniki ticku per ścieżka w ładunku `journey.stats_changed.v1`).                                                                            | Panel nie musi przeliczać, co się zmieniło.                                                                                                |
| `journey_fail_step`                          | + `p_phase` (`advance`/`email`) w dzienniku błędów.                                                                                                        | Zdrowie silnika rozróżnia awarie bazy i poczty.                                                                                            |
| Wycofanie zgody przy wypisie                 | Logika `crm_leads_marketing_consent_withdraw` powtórzona w `_journey_unsubscribe` (zgoda + wpis księgi).                                                   | Istniejące RPC wymaga sesji personelu; wypis idzie z trasy publicznej. Z-S5-04.                                                            |
| Filtr wejścia                                | Niespełniony filtr nie zakłada zapisu (powód `entry_filter` z I0 nieużywany).                                                                              | Bez szumu w liście kontaktów; szacunek zasięgu liczy zdarzenia, nie zapisy.                                                                |
| Katalog wyzwalaczy (kontrakt emiterów)       | `club_application.*`: klucz `specialization` (nie `specialization_id`), decyzja tylko `accepted`/`rejected`; `event.registration.cancelled.v1` w katalogu. | Klucze z migracji emiterów (test `triggers.test.ts` czyta migracje); rezygnacja = wyjście nurtowania wydarzenia.                           |
| `admin_journey_stats` (§5.6)                 | Zbiór zapisów okna jako tablica identyfikatorów (`STABLE`), bez tabeli tymczasowej.                                                                        | Bramka `plpgsql_check_gate` nie widzi tabel tymczasowych; lista zwolnień może tylko maleć.                                                 |
| Test narzutu trasy (§4.7)                    | 1000 zdarzeń najemcy bez tras < 1,5 s (ok. 1 ms na zdarzenie z zapasem), plan zapytania trasy przez klucz główny (`enable_seqscan = off` w `EXPLAIN`).     | Na małej tabeli testowej planista wybiera skan sekwencyjny; asercja dotyczy dostępności indeksu.                                           |
| Pliki spoza karty                            | `tracking.server.ts`, `labels.ts`, testy server fn/zapytań/słownika/kształtów RPC, `trackingTokenJourney.test.ts`.                                         | §20.4 (manifest S5 z komentarzem „Integrator S5”).                                                                                         |

### 20.4 Zgłoszenia „Do integracji” wykonane przez Integratora S5

Strażnik `hub-slice-guard.ts S5 --base 32e9039a` po integracji zgłasza
wyłącznie zmiany Integratora: `[plik-wspoldzielony]`
`drizzle/migrations/meta/_journal.json`, `src/integrations/supabase/types.ts`,
`src/lib/ci/hubDelivery.ts`, `src/lib/realtime/eventInvalidationMap.admin.ts`,
`src/lib/authz/authzSnapshot.generated.ts` oraz `[poza-manifestem]` ten
dziennik i `docs/KONTYNUACJA_HUB_PRZYCHOD_LEJEK_2026-10-19.md`.
`serviceRoleTenantScope.gate.test.ts` to przydział imienny S5
(`HUB_SHARED_FILE_GRANTS`).

| Zgłoszenie                         | Zmiana                                                                                                                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bliźniaki drizzle                  | 6 bliźniaków (bajt w bajt) i 6 wpisów `_journal.json` w kolejności wersji (§20.6); `check:migration-lanes` zielone.                                                                                                                          |
| `types.ts`                         | `journey_settings.sender_name`/`reply_to`; sygnatury 30 RPC S5 (`admin_journey_*`, `journey_*`) - jak S2/S3: dokumentacja kontraktu, wywołania przez `RpcCallable` z literałem nazwy.                                                        |
| Rejestr dostawy (`hubDelivery.ts`) | `FUNCTION_TABLE` += 13 pomocniczych `_journey_*` (internal) i `admin_journey_settings_get` (panel); manifest S5 += `tracking.server.ts`, `labels.ts`, testy, `transactional.server.ts` z testem, bliźniaki `0352…0357`, dwa pliki testów I0. |
| `SERVICE_ROLE_READERS`             | Jeden wpis: `src/lib/server/journeysRunner.server.ts` (runner czyta wyłącznie przez RPC, najemca z wiersza).                                                                                                                                 |
| Inwalidacja szyny                  | `journey.changed.v1` z `op = 'settings'` (agregat = najemca) odświeża `journeyKeys.settings`, `engineHealth` i listę zamiast `detail(najemca)`; test w `revenueInvalidation.test.ts`.                                                        |
| Strażnik ACL `hub_grants`          | `hub_shared_helpers_test.sql` zna 13 pomocniczych `_journey_*` (bramka `hubDelivery.gate.test.ts`: lista pgTAP = rejestr).                                                                                                                   |
| Snapshot bramek autoryzacji        | `generate:authz-snapshot` - wyłącznie liczniki skanu (1278 → 1284 migracji, 1723 → 1770 funkcji); bramki RPC S5 są w `_journey_staff_tenant`, bez nowych literałów ról.                                                                      |
| `i18nParity`                       | Bez zmian - `adminJourneys` jest w `GATED_PREFIXES` od I0.                                                                                                                                                                                   |
| Budżet D-08                        | Bez ratchetu - `overall` w progu, przyrost S5 w szumie hashy (§20.7).                                                                                                                                                                        |

**Do integracji I9 (nie wykonane przez Integratora S5):**

- **Runner w `jobs-tick`** (SPEC §4.6): po zadaniach uczestnika, **przed**
  drenem kolejki maili - `runJourneysTick(admin, { deadlineAt, ingestLimit: 200, claimLimit: 50 })`
  (wynik do telemetrii ticku; `{ error: "disabled" }` przy
  `JOURNEYS_ENGINE_DISABLED=1`). Do tego czasu silnik nie wykonuje kroków
  nawet po włączeniu w panelu.
- **Harmonogram:** `journey_rollup_daily()` co godzinę (wolny pas),
  `journey_purge('30 days')` raz na dobę (skrzynka, przetworzone wpisy,
  dziennik błędów); wpisy w `scheduler.ts` i karcie zdrowia schedulera
  (`SchedulerHealthPanel`) - stan silnika ścieżek (włączony, zaległość
  skrzynki, ostatni tick, błędy 24 h z `admin_journey_engine_health`).
- **Runbook:** `JOURNEYS_ENGINE_DISABLED`, procedura M3 (§20.9 pkt 7).

**Dla S8 (UI) - gotowe API:** server fn `listJourneys`, `getJourneyEnrollments`,
`getLeadJourneys`, `getJourneySettings`/`saveJourneySettings`,
`getJourneyEngineHealth`, `estimateJourneyTrigger`, `simulateJourney`,
`createJourney`, `installJourneyTemplate`, `saveJourneyDraft`,
`saveJourneyEmailContent`, `publishJourney`, `setJourneyStatus`,
`enrollJourneyTest`, `skipJourneyWait`, `exitJourneyEnrollment`,
`getJourneyStats`, `getJourneySeries`; `queryOptions` w `queries.ts` (klucze
pod prefiksami inwalidacji szyny); walidacja kanwy `validateJourneyGraph`,
katalog wyzwalaczy z polami warunku (`JOURNEY_TRIGGERS`,
`buildTriggerCondition`), zmienne i próbki (`JOURNEY_VARIABLES`,
`JOURNEY_VARIABLE_SAMPLES`), szablony (`JOURNEY_TEMPLATES`), etykiety
`journeyLabelKey`/`journeyTriggerLabelKey`/`journeyTemplateLabelKeys`. Kody
błędów zapisów (`JourneyMutationErrorCode`) i kody walidatora SQL mają napisy
w słowniku.

### 20.5 Zgłoszenia otwarte

| ID      | Zgłoszenie                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Z-S5-01 | `pricing_enquiry_b2b` czeka na zdarzenie `contact_message.submitted.v1` (SPEC P25, po M3) - emiter formularza kontaktu poza S5; do tego czasu instalacja odmawia (`template_unavailable`).                                                                                                                                                                                                                                    |
| Z-S5-02 | Limit tagu: I0 `JOURNEY_LIMITS.tagMax` = 64, pisarz tagów CRM = 40; silnik egzekwuje 40. Do decyzji: wyrównać stałą I0 (i jej test parytetu) do 40 albo poszerzyć pisarza CRM. **Zamknięte w I9b (§22.2 B7): jeden limit 64 (`CRM_TAG_MAX`) - kolumna bez CHECK długości, wygrał kontrakt I0; pisarz i walidator SQL (20261020160800), zod i komunikaty PL/EN czytają tę samą wartość, test parytetu i wartości granicznej.** |
| Z-S5-03 | Runner niepodpięty do `jobs-tick` (I9, §20.4) - po włączeniu silnika w panelu zapisy powstają, ale kroki nie wykonują się do czasu I9; panel pokazuje to w zdrowiu silnika (rosnące `due_now`, brak `last_step_at`).                                                                                                                                                                                                          |
| Z-S5-04 | Wycofanie zgody przy wypisie powtarza logikę `crm_leads_marketing_consent_withdraw` (wymaga sesji personelu). Propozycja: wspólny pomocnik wewnętrzny dla obu ścieżek (CRM/I9).                                                                                                                                                                                                                                               |
| Z-S5-05 | Do sprawdzenia w teście na żywo (M3): czy bramka pocztowa platformy dokleja własną stopkę wypisu do maili ścieżek (kolejka transakcyjna wymaga `unsubscribe_token`) - wtedy mail marketingowy miałby dwie stopki; usługa i test nie mają stopki ścieżki.                                                                                                                                                                      |
| Z-S5-06 | Otwarcia Apple MPP nie mają rozpoznawalnego nagłówka - odsiewa je wyłącznie próg czasu (`machine_open_seconds`, domyślnie 2 s); `unique_human_opens` i CTOR są górną granicą.                                                                                                                                                                                                                                                 |
| Z-S5-07 | M3 - włączenie silnika u NES (decyzja właściciela) po teście na żywo `welcome_onboarding` i `abandoned_checkout` (§20.9 pkt 7) i po I9.                                                                                                                                                                                                                                                                                       |
| Z-S5-08 | Podgląd treści w edytorze S8: `substituteDocVariables` mieszka w `render.server.ts` (render z podpisami); podgląd w przeglądarce potrzebuje wersji klienckiej (przeniesienie do `variables.ts`) albo server fn podglądu - decyzja S8.                                                                                                                                                                                         |

### 20.6 Bliźniaki drizzle

| Wersja supabase                              | Bliźniak                           | idx | `when`        |
| -------------------------------------------- | ---------------------------------- | --- | ------------- |
| `20261020140000_journeys_routing`            | `0352_journeys_routing`            | 352 | 1792476733912 |
| `20261020140100_journeys_engine`             | `0353_journeys_engine`             | 353 | 1792476793912 |
| `20261020140200_journeys_predicates_consent` | `0354_journeys_predicates_consent` | 354 | 1792476853912 |
| `20261020140300_journeys_admin_rpc`          | `0355_journeys_admin_rpc`          | 355 | 1792476913912 |
| `20261020140400_journeys_admin_tools`        | `0356_journeys_admin_tools`        | 356 | 1792476973912 |
| `20261020140500_journeys_tracking_stats`     | `0357_journeys_tracking_stats`     | 357 | 1792477033912 |

`when` = 1792476673912 (`0351`) + n·60 000; `cmp` supabase ⇄ drizzle: bajt
w bajt. **Następny wolny numer: `0358`** (idx 358), bez rezerwacji (§6).

### 20.7 Pomiar bundla

`flock -o /tmp/hub-build.lock env BUNDLE_INVENTORY=1 bun run build` +
`check:bundle`; baza = build `32e9039a` w `/home/user/neweustrategies-dc633fb5`
(ten sam host i `node_modules`). Przypisanie: gzip -9 per chunk (nazwa bez
hasha), baza ⇄ S5.

| Budżet (gzip KB)            | Próg         | Baza `32e9039a` | S5     | Δ        | Wynik                                                                                |
| --------------------------- | ------------ | --------------- | ------ | -------- | ------------------------------------------------------------------------------------ |
| `overall`                   | 5003         | 5001,7          | 4999,9 | **−1,8** | ✓ bez ratchetu D-08 (zapas 3,1 KB)                                                   |
| `admin-only`                | -            | 2223,0          | 2222,2 | −0,8     | -                                                                                    |
| `public`                    | 2881 (zamr.) | 2778,7          | 2777,7 | −1,0     | ✓                                                                                    |
| największy chunk (entry)    | 286 (zamr.)  | 257,8           | 257,8  | 0,0      | ✓                                                                                    |
| `css`                       | 100          | 99,7            | 99,7   | 0,0      | ✓ arkusze bit w bit te same (słownik i szablony bez słów-klas narzędziowych)         |
| `publicCss`                 | 85 (zamr.)   | 83,8            | 83,8   | 0,0      | ✓                                                                                    |
| `boot`                      | 579 (zamr.)  | 471,6           | 471,6  | 0,0      | ✓                                                                                    |
| chunki JS (nazwy bez hasha) | -            | 1272            | 1272   | 0        | `check:chunks` ✓ (acykliczny), `check:entry-purity` ✓, `check:server-entry-purity` ✓ |

Jedyny chunk z ruchem > 0,05 KB: `admin` +0,07 (reguła inwalidacji
`op = 'settings'` w `eventInvalidationMap.admin.ts`). Silnik, szablony, server
fn i słownik nie trafiają do żadnego chunku klienta - UI (S8) jeszcze ich nie
importuje (stuby server fn powstaną dopiero z importem w komponencie). Reszta
różnicy to entropia hashy w nazwach importów (888 chunków po kilka bajtów).

### 20.8 Weryfikacja końcowa S5

Worktree `/home/user/wt/S5`, ciężkie kroki po kolei (pamięć 16 GB); pełny
pakiet vitest - CI.

| Polecenie                                                                                                                                                                                                                                                  | Wynik                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run format:check`                                                                                                                                                                                                                                     | ✓                                                                                                                                                                                                                                                                                                                                               |
| `bun run verify:static`                                                                                                                                                                                                                                    | ✓ 18 bramek (320 s)                                                                                                                                                                                                                                                                                                                             |
| `GOMEMLIMIT=11GiB GOGC=50 bunx tsgo --noEmit --checkers 1 && bun run typecheck:scripts && bun run typecheck:e2e`                                                                                                                                           | ✓                                                                                                                                                                                                                                                                                                                                               |
| `bun run lint`                                                                                                                                                                                                                                             | ✓ 0 błędów (282 ostrzeżenia zastane, żadne w plikach S5)                                                                                                                                                                                                                                                                                        |
| `TZ=UTC bunx vitest run --maxWorkers=3 --coverage.enabled --coverage.include='src/lib/journeys/**' src/lib/journeys`                                                                                                                                       | ✓ 12 plików, 212 testów; pokrycie linii **99,19 %** (615/620), gałęzi 97,75 %; nowe pliki 100 % linii (`keys.ts` z I0 - 72 %)                                                                                                                                                                                                                   |
| `TZ=UTC bunx vitest run --maxWorkers=3 src/lib/journeys src/lib/server/__tests__ src/routes/api/public src/routes/__tests__ src/lib/email src/lib/newsletter src/lib/realtime src/lib/ci src/lib/__tests__ src/__tests__`                                  | ✗ → ✓: `overlayReaders` - korzeń `adminJourneys` bez czytelnika w kodzie produkcyjnym (UI dopiero w S8) → `labels.ts` (typowane klucze etykiet dla S8). Po poprawce 583 pliki, 17 112 testów ✓                                                                                                                                                  |
| `TZ=UTC bunx vitest run --maxWorkers=3` - konsumenci zmienionych modułów spoza zestawu (45 plików: zdarzenia, powiadomienia, kluby, retencja, dostęp, kupony, szablony maili) + `src/lib/revenue`, `src/lib/admin/revenue`, `src/components/admin/revenue` | ✓ 88 plików, 3330 testów                                                                                                                                                                                                                                                                                                                        |
| pgTAP `run.sh all` (`PGTAP_DIR=/tmp/pgtap-int`, port 5470, `flock`)                                                                                                                                                                                        | 235 plików ✓, 5 z błędem: 4 znane środowiska (pg_net 2+1, `public_definer_views_read_only` 1/35, `profile_intent_semantic` - vector; migracja `20260825230232`) i **`plpgsql_check_gate` 1/4** - `admin_journey_stats` z tabelą tymczasową (13 błędów 42P01/55000) → przepisane na tablicę identyfikatorów (§20.3); ponowny przebieg `journeys_ | email_ | hub_shared_helpers | plpgsql_check_gate | ts_sql_contract` na tej bazie po wgraniu poprawionej migracji: 19 plików ✓ |
| `generate:ts-sql-contract` + `run.sh test ts_sql_contract`                                                                                                                                                                                                 | ✓ bez zmian pliku (wpisy S5 już w kontrakcie), 9 asercji                                                                                                                                                                                                                                                                                        |
| `check:rpc-contract`, `check:types-freshness`, `check:migration-lanes`                                                                                                                                                                                     | ✓ (847 nazw RPC; 7 znanych kolumn - baseline; 358 wpisów dziennika drizzle)                                                                                                                                                                                                                                                                     |
| `check:sql-{tenant-scope,app-role,anon-insert,definer-views,owner-tenant-scope,policy-tenant-regression,migration-replay}`, `check:on-conflict-arbiters`                                                                                                   | ✓                                                                                                                                                                                                                                                                                                                                               |
| `split-migration.ts --dry-run` dla `2026102014*`                                                                                                                                                                                                           | ✓ każdy plik 1 część (największy `140500` = 43 208 B < 46 080 B)                                                                                                                                                                                                                                                                                |
| `flock -o /tmp/hub-build.lock env BUNDLE_INVENTORY=1 bun run build` + `check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity`                                                                                                    | ✓ (§20.7)                                                                                                                                                                                                                                                                                                                                       |
| `bun run generate:authz-snapshot --check`                                                                                                                                                                                                                  | ✗ → ✓ po regeneracji (wyłącznie liczniki skanu, §20.4)                                                                                                                                                                                                                                                                                          |
| `bun run scripts/hub-slice-guard.ts S5 --base 32e9039a`                                                                                                                                                                                                    | exit 1 wyłącznie na zmianach Integratora (§20.4); dostawa huba: 6 plików, 48 definicji funkcji                                                                                                                                                                                                                                                  |
| `cmp` supabase ⇄ drizzle `0352…0357`                                                                                                                                                                                                                       | ✓ bajt w bajt                                                                                                                                                                                                                                                                                                                                   |

Nowe testy TS: `graph` (21), `nodeTypesParity` (8, czyta migracje S5),
`triggers` (7, czyta migracje emiterów), `templates` (79 przypadków
z `describe.each`), `render.server` (9), `parse` (11, kształty z prawdziwej
bazy), `journeys.functions` (17), `queries` (3), `tracking.server` (4),
`i18nJourneys` (20), `journeysRunner.server` (15), `trackingTokenJourney` (7),
`-nl-tracking` (+7 przypadków `m=`), `-api.public.newsletter.unsubscribe` (+5),
`queueDrain` (+2), `transactional.server` (+2), `suppressionPolicy` (+1),
`revenueInvalidation` (+1). pgTAP: 7 plików, 168 asercji.

### 20.9 Wdrożenie S5 na produkcji (właściciel)

Kod i migracje S5 idą w jednym PR. Zależności w obie strony:

- nowy front przed migracjami: server fn ścieżek dostają PGRST202/42883 →
  stan `unavailable` (UI S8 jeszcze nie ma); trasy `nl-open`/`nl-click`
  z `m=` zawsze oddają piksel i przekierowanie (zapis to telemetria
  best-effort), wypis tokenem ścieżki odpowiada 500 (bramka ponowi) - takich
  tokenów nikt jeszcze nie dostał, bo silnik jest wyłączony;
- stary front po migracjach: bez zmian - trasa zdarzeń nie robi nic bez
  opublikowanych ścieżek (zero wierszy skrzynki), `email_apply_delivery_event`
  zachowuje sygnaturę i dotychczasowe dopasowanie.

1. **Warunek:** M0 (tabele ścieżek, `journey_settings`,
   `email_send_log.provider_message_id`), S1, S2, S3 i S4 wdrożone albo
   w tym samym oknie (§10) - akcje v2 `run_workflow_step` (S4) i emitery
   wyzwalaczy (S1-S4).
2. **Okno nocne** - gorąca tabela: `CREATE TRIGGER trg_journey_route_event`
   na `domain_events` (`140000`) pod `SET lock_timeout = '5s'`. Panel Lovable →
   6 plików **w kolejności wersji**:
   1. `20261020140000_journeys_routing` (wyzwalacz na `domain_events`);
   2. `140100_journeys_engine`;
   3. `140200_journeys_predicates_consent` (`ALTER TABLE journey_settings` - mała tabela);
   4. `140300_journeys_admin_rpc`;
   5. `140400_journeys_admin_tools`;
   6. `140500_journeys_tracking_stats` (redefinicja `email_apply_delivery_event`, sygnatura bez zmian).

   Pliki są idempotentne (`CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS` -
   `CREATE TRIGGER`, `ADD COLUMN IF NOT EXISTS`, CHECK przez
   `DROP CONSTRAINT IF EXISTS`, bezstanowe `REVOKE`/`GRANT`). `55P03` (limit
   blokady) = ponów cały plik.

3. Zaraz potem opublikuj front z tego PR.
4. Bliźniaki `0352…0357` są kopiami bajt w bajt - po panelu wykonują się jako
   no-op; migrator Drizzle wykona je sam, jeśli panel zostanie pominięty.
5. `workflow_dispatch` CI na `main` → `post-deploy`: `check:db-contract`
   i `check:migration-ledger` (6 wersji) zielone. Wynik do §10.
6. Kontrola po wdrożeniu (SQL editor, tylko odczyt):

```sql
-- Wyzwalacz trasy: oczekiwane 1.
SELECT count(*) FROM pg_trigger
 WHERE NOT tgisinternal AND tgname = 'trg_journey_route_event';
-- Silnik wyłączony u każdego najemcy: oczekiwane 0.
SELECT count(*) FROM public.journey_settings WHERE enabled;
-- RPC panelu i runnera: oczekiwane 4 niepuste kolumny.
SELECT to_regprocedure('public.admin_journey_settings_get()') AS settings,
       to_regprocedure('public.admin_journey_engine_health()') AS health,
       to_regprocedure('public.journey_claim_due(integer,integer)') AS claim,
       to_regprocedure('public.journey_record_message_event(text,text,integer,text,boolean)') AS tracking;
-- Funkcje serwisowe tylko dla serwera: oczekiwane false, false.
SELECT has_function_privilege('anon', 'public.journey_ingest_inbox(integer)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.journey_advance(uuid,uuid,integer)', 'EXECUTE');
```

7. **M3 (po I9 - runner w `jobs-tick`), decyzja właściciela:** w panelu
   (UI S8; do tego czasu RPC) zainstaluj `welcome_onboarding`
   i `abandoned_checkout`, uzupełnij nadawcę i Reply-To, opublikuj, a potem
   **test na żywo** na własnym koncie (`admin_journey_enroll_test` działa
   przy wyłączonym silniku; „pomiń czekanie” prowadzi przez kolejne kroki).
   Sprawdź: oba maile dochodzą, linki przechodzą przez `nl-click` na właściwy
   cel, wypis jednym kliknięciem wyprowadza zapis z powodem `unsubscribed`,
   stopka występuje raz (Z-S5-05). Dopiero potem `enabled = true` w ustawieniach
   silnika i obserwacja 7 dni (SPEC §9.2) w zdrowiu silnika.

Wycofanie: wyłączenie silnika w panelu (`enabled = false`) zatrzymuje zapisy
i pobieranie; awaryjnie `JOURNEYS_ENGINE_DISABLED=1` zatrzymuje runner.
Zdjęcie wyzwalacza trasy - osobną migracją spoza bloku huba, decyzją
właściciela; `email_apply_delivery_event` wraca przez ciało
z `20260725123624` (bez dopasowania najemcy po `provider_message_id`).
Kolumny `sender_name`/`reply_to` są opcjonalne (NULL = nazwa serwisu, bez
Reply-To).

### 20.10 Kryteria akceptacji S5 (SPEC §8.3)

- [x] pgTAP 7 plików zielony - 168 asercji (trasa 24, narzut trasy 7, silnik 38, wersje i A/B 13, zgody 23, RPC panelu 37, tracking i statystyki 26), w tym narzut trasy na 1000 zdarzeń (< 1,5 s, indeks klucza głównego, warunek `WHEN`) i brak pętli (cykl odrzucony przy publikacji; krok raz na zapis i węzeł); pełny `run.sh all` - wyłącznie znane błędy środowiska (§20.8).
- [x] `graph.test.ts` (DAG, gałęzie, osiągalność, limit 60, zakaz maila przy `payment_failed`, ostrzeżenia), `nodeTypesParity.test.ts`, `triggers.test.ts` (każdy wyzwalacz ∈ `DOMAIN_EVENT_TYPES`, klucze ładunku z migracji emiterów, `conditionFields` budują `payload @>`), `templates.test.ts` (schemat publikacji, PL/EN, `service` z podstawą prawną, `winback_30d` z `reason` `not_in ['paused']`).
- [x] `journeysRunner.server.test.ts`: kolejność, termin 3 s, sufit 20 maili/tick, odkładanie przy zaległości > 120 (5 min) i blokadzie reputacji (60 min, bramka raz na najemcę), idempotencja `journey:{zapis}:{węzeł}` (duplikat domyka krok bez drugiego liczenia), `JOURNEYS_ENGINE_DISABLED`.
- [x] Tracking: podpis linku z numerem i odporność na otwarte przekierowanie (nowe przypadki `m=`: podmieniony cel, numer, brak podpisu, podpis kampanii, nie-http), token trackingu nie wypisuje; wypis wyprowadza aktywne zapisy marketingowe z powodem `unsubscribed` (pgTAP), usługowe zostają.
- [x] Silnik wyłączony domyślnie: brak wiersza ustawień = wyłączony; wyłączony najemca - zero zapisów (pgTAP trasy), pobierany wyłącznie test na żywo (pgTAP silnika); kontrola po wdrożeniu (§20.9 pkt 6).
- [x] Pokrycie `src/lib/journeys/**` ≥ 90 % linii - 99,19 %.
- [x] Wymóg właściciela „wszystko w panelu admina”: każdy przełącznik silnika ma RPC panelu i server fn (§20.2, lista dla S8 - §20.4); UI - S8.
- [ ] Runner w `jobs-tick` i M3 - poza kartą S5 (I9, Z-S5-03, Z-S5-07).

## 21. I9b - decyzje właściciela, część A: SQL i katalog (2026-10-20)

**Decyzja właściciela 2026-10-20, zgoda delegowana:** „wykonaj wszystkie
i aktualizuj - masz zgodę”; rozstrzygnięcia oddane orkiestratorowi. Każdy
wpis niżej jest decyzją właściciela z tą adnotacją. Praca szeregowa (jedyny
aktywny agent), gałąź `hub/i9b-decyzje` (worktree `/home/user/wt/I9B`) od
`74a49536`. Część A obejmuje segmenty przychodu (Z-01, Z-S2-02), obietnice
cennika v6.2 bez pokrycia (lista z PR #520, pozycje 1-6) i RODO księgi MRR
(Z-07, Z-S2-03). Bliźniaki drizzle i opis plików współdzielonych - krok C.

**Zasada nadrzędna decyzji cennikowych:** obietnica v6.2 to MINIMUM.
Migracja nigdy nie odbiera istniejącym klientom uprawnień (brak obniżek
w trakcie opłaconego okresu), brakujące uprawnienia DODAJE, nowy najemca
(seed) dostaje dokładnie v6.2, a karty i macierz mówią prawdę o bramce (nie
obiecują więcej niż bramka, mogą pokazać więcej niż v6.2).

### 21.1 Zakres

| Obszar                                 | Co dostarcza I9b (część A)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL (5 migracji, blok I9 `2026102016`) | `160000` mapa segmentów z typu klienta + `_revenue_segments_recompute()` (przeliczenie zapisanej historii) + strażnik migawek; `160100` katalog progów v6.2 z decyzjami (seed); `160200` benefity karty Zespołu + `_pricing_v62_owner_decisions(najemca)` (najemcy istniejący); `160300` limit 20 miejsc Zespołu (dwa wyzwalacze); `160400` pełna anonimizacja księgi MRR po usunięciu subskrypcji/konta + domknięcie wstecz.                                  |
| pgTAP (4 nowe pliki, 59 asercji)       | `hub_i9b_revenue_segments` (10), `hub_i9b_pricing_decisions` (19), `hub_i9b_team_seat_cap` (16), `hub_i9b_revenue_ledger_erasure` (14); zaktualizowane: `hub_shared_helpers` (mapa, lista `hub_grants`), `pricing_catalog_v62` (kolejność kart NGO), `revenue_subscription_history` (Z-07 po wymianie identyfikatora subskrypcji).                                                                                                                             |
| TS - segmenty                          | `REVENUE_SEGMENT_BY_TIER` z regułą typu klienta (komentarz zamiast „partnerzy do other”), `segmentsParity` czyta NAJNOWSZĄ definicję funkcji; chip `RevenueSegmentChip` (tylko do odczytu, dymek PL/EN) w edytorze warstwy (zakładka Podstawy, przy randze) i w kaflu katalogu `/admin/membership`.                                                                                                                                                            |
| TS - cennik                            | `TIER_RANKS.ngo` 40, `compareTierRank` (ranga, `sort_order`, klucz) w siatce warstw panelu, wymaganym progu ściany płatności, pickerach progów (dostęp do treści, biblioteka, kampanie newslettera, katalog członków); macierz: NGO z wartościami zakresu Partnera, kanał bezpośredni „Bez limitu, bezpośrednio”, komentarze; karty z najnowszego katalogu benefitów.                                                                                          |
| TS - Zespół 3-20                       | `TEAM_TIER_MAX_SEATS`/`TEAM_TIER_MIN_SEATS` i reguły (`teamSeatVerdict`, `teamSeatLimitRejected`, `teamSeatAddBlocked`, `isTeamSeatsMaxError`, `organizationTierOptions`) w `teamSeats.ts`; `setTeamSeatLimit` odrzuca > 20 przed operatorem; panel organizacji (lista, karta, nowa organizacja) - `TeamSeatCapNotice` (stan x/20, alert z sugestią Enterprise, ostrzeżenie < 3), blokada dodawania przy 20 aktywnych, Zespół do wyboru jako próg organizacji. |
| Bramka dostawy                         | `HUB_I9_REDEFINITIONS` - rezerwa I9 może redefiniować funkcję innego wycinka wyłącznie z rejestru, z `CIALO-Z` najnowszej definicji w hubie (fikstury w `hubDelivery.gate.test.ts`); 8 nowych funkcji I9 i 2 redefinicje sprzed huba w rejestrze.                                                                                                                                                                                                              |

### 21.2 Decyzje → wykonanie → dowód

**Z-01 / Z-S2-02 - segmenty przychodu (decyzja właściciela 2026-10-20,
zgoda delegowana).** Reguła: konto organizacyjne (flaga `corporate_seats`
albo umowa instytucjonalna/firmowa) → `b2b_institution`; płatna cykliczna
subskrypcja osoby po cenie katalogowej → `b2c_individual`; płatna cykliczna
osoby w stawce ulgowej → `b2c_reduced`; bezpłatne, grzecznościowe,
jednorazowe i bez planu → `other`. Uzasadnienie: segmenty służą do ocen
churnu i ARPA według typu klienta (benchmarki B2B i B2C różnią się
kilkukrotnie), więc organizacja w stawce ulgowej zachowuje się jak B2B.
Sprawdzone flagami i cenami katalogu v6.2 (`20261018160100`) oraz stanem
najemcy domyślnego (lokalna baza po wszystkich migracjach) - fakty potwierdzają
oczekiwany wynik:

| Klucz                                             | Segment           | Uzasadnienie (fakty)                                                                                                  |
| ------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `partner`, `partner_general`, `presidents_circle` | `b2b_institution` | `corporate_seats`, umowa roczna na organizację (cena „od”, bez planu)                                                 |
| `ngo`                                             | `b2b_institution` | `corporate_seats`, umowa roczna organizacji (-50% stawki Partnera) - organizacja w stawce ulgowej to nadal B2B        |
| `team`, `corporate`                               | `b2b_institution` | `corporate_seats`, faktura na organizację                                                                             |
| `business`                                        | `b2b_institution` | subskrypcja firmowa (plany `business_2w/monthly/quarterly`), bez `corporate_seats`, ale klient = firma                |
| `member`, `pro`                                   | `b2c_individual`  | plany osoby 39 / 119 zł miesięcznie (cena katalogowa)                                                                 |
| `student`, `educator`                             | `b2c_reduced`     | plany osoby 19 / 29 zł miesięcznie (stawka ulgowa)                                                                    |
| `supporter`                                       | `other`           | status po darowiźnie (`tg_donations_grant_supporter`), nie próg członkostwa ani subskrypcja progu (v6.2)              |
| `vip`                                             | `other`           | cena „od 6 000 zł” w umowie osoby, bez planu w katalogu operatora - ani subskrypcja katalogowa, ani konto organizacji |
| `reader`, `decision_lab`, klucze nieznane, `NULL` | `other`           | bezpłatne / jednorazowe                                                                                               |

Wykonanie: `revenue_segment_of_tier` (`CIALO-Z: 20261020090500`, rezerwa I9
w bramce), lustro `REVENUE_SEGMENT_BY_TIER`, przeliczenie
`mrr_movements.segment` (`churn` - warstwa przed ruchem, reszta - po, jak
pisarze S2). Pochodne: `mrr_daily_snapshots` nie niosą `tier_key` (obraz
tabeli `subscriptions` z doby), więc nie da się ich przeliczyć - mapa zmienia
wyłącznie progi bez ceny w katalogu operatora (`billing_catalog_entry`), więc
żadna migawka nie zawiera ich kwot; strażnik przerywa migrację, gdyby katalog
miał taki próg. `revenue_manual_inputs.segment` wybiera admin, lejek liczy
segment w zapytaniu, indeksów i widoków na funkcji nie ma. Bez S2 na produkcji
przeliczenie jest no-opem (`to_regclass`). **Z-S2-02: AKCEPTACJA** -
subskrypcja, która zmieniła segment w oknie, liczy się w segmencie końcowym
mostu (standardowa atrybucja do segmentu na koniec okresu, jak ARR na koniec
kwartału): ten sam zbiór subskrypcji na początku i końcu okna domyka most,
a podział ruchów dałby częściowe mosty bez sumy. Panel: chip „Segment
przychodu: …” z dymkiem PL/EN („Segment przychodu - do raportów MRR, churnu
i ARPA w hubie; wynika z typu klienta”) w `/admin/membership`. Dowód:
`hub_i9b_revenue_segments_test` (mapa każdego klucza, przeliczenie partnera
i NGO, niezmiennik zamkniętego miesiąca per segment, suma segmentów = most
bez filtra, druga runda 0 i ctid bez zmian), `segmentsParity.test.ts`,
`RevenueSegmentChip.test.tsx` (PL/EN, dymek, axe).

**Cennik v6.2, pozycje 1-6 (decyzja właściciela 2026-10-20, zgoda
delegowana):**

1. **Zespół „pełny zakres Pro” → DODANE.** `regulatory_monitoring` w seedzie
   (`pricing_catalog_v62_rows`, `CIALO-Z: 20261018160100`) i u istniejących
   najemców (`features || {"regulatory_monitoring": true}` po kluczu `team`).
   Opis karty PL/EN „Pełny zakres Członka Pro dla każdego miejsca, jedna
   faktura, wspólne wejście do klubów.” / „The full Member Pro scope for every
   seat, one invoice and joint entry to clubs.” i pierwsza pozycja benefitów -
   u istniejących WYŁĄCZNIE tam, gdzie tekst był równy katalogowi v6.2 (tekst
   zmieniony w panelu zostaje). Macierz: wiersz trackera z flagi pokazuje ✓.
   Dowód: `hub_i9b_pricing_decisions_test`, `comparisonMatrixV62.test.tsx`,
   `tierCardV62Catalog.test.tsx`.
2. **Zespół „3 zapytania na miejsce”.** Seed nowego najemcy = dokładnie v6.2:
   `expert_request_quota` 3, BEZ `chat_direct_gated`. U istniejących - bez
   zmian (kanał bezpośredni = brak obniżki), a pozycja karty o korespondencji
   mówi prawdę o bramce: „Korespondencja z ekspertami bez limitu dla każdego
   miejsca (kanał bezpośredni)” (tylko gdy tekst był katalogowy i próg ma
   `chat_direct_gated`). Macierz: „Bez limitu, bezpośrednio” / „Unlimited,
   direct” przy kanale, liczba przy puli. **Wyrównanie w panelu:**
   `/admin/membership` → kafel „Zespół” → zakładka „Bramki i limity”:
   wyłączyć `chat_direct_gated` (przełącznik uprawnień), wtedy
   `ExpertRequestQuotaEditor` („Zapytania do eksperta - pula miesięczna”)
   pokazuje pole liczby - wpisać 3 i zapisać (edytor działa dla każdego progu,
   także `team`; przy włączonym kanale pokazuje notę „bez limitu”).
3. **Zespół „3-20 miejsc” → EGZEKWOWANE.** Mechanizm miejsc istnieje
   (`member_organizations.seats_limit`, `organization_seats`, `org_add_seat`,
   `org_set_seats_limit`, `org_apply_subscription_seats`). Baza
   (`20261020160300`): organizacja na progu `team` nie dostaje limitu > 20
   (zakładanie, przejście na Zespół, podniesienie), 21. aktywne miejsce
   odrzucone - `23514 orgs: team seats max`, odrzucenie, nigdy przycięcie.
   Organizacje ponad limitem sprzed reguły: limit i miejsca zostają, obniżanie
   przechodzi, zmiana statusu (karencja) przechodzi, blokowane jest tylko
   dodawanie. Minimum 3 - warunek sprzedaży, nie przydziału: panel ostrzega,
   nie blokuje. Wspólna stała `TEAM_TIER_MAX_SEATS` (parytet z `c_team_max`
   w SQL), `setTeamSeatLimit` odrzuca > 20 przed operatorem płatności, panel
   organizacji pokazuje stan x/20, alert z sugestią Enterprise i blokuje
   dodawanie przy 20 aktywnych; Zespół jest do wyboru jako próg organizacji
   (`corporate_seats` albo ranga ≥ 30 - sama ranga pomijała Zespół). Webhook
   operatora z ilością > 20 dla Zespołu dostaje odmowę (log „seats sync
   failed”, limit bez zmian) - taka ilość to Enterprise. Dowód:
   `hub_i9b_team_seat_cap_test`, `teamSeatCap.test.ts`,
   `organizationsFunctions.test.ts`, `TeamSeatCapNotice.test.tsx`,
   `adminOrganizationsRoutes.test.tsx`.
4. **NGO → ranga 40 i zakres Partnera Instytucjonalnego.** Seed: ranga 40,
   features = flagi dawnego NGO ∪ flagi Partnera (`strategic_partner`,
   `regulatory_monitoring`, `chat_direct_gated` dochodzą; pula 3 zostaje),
   `sort_order` 85. Istniejący najemcy: ranga podniesiona do 40 (nigdy
   obniżona), suma z flagami progu `partner` TEGO najemcy (bez progu - z
   katalogu; prawda wygrywa, liczba - większa), `sort_order` 50 → 85 i opisy
   tylko bez zmian admina. Opis karty: „Zakres Partnera Instytucjonalnego
   w stawce -50% dla organizacji pozarządowych i think-tanków non-profit, po
   weryfikacji KRS lub statutu.” / „The Institutional Partner scope at 50% off
   for NGOs and non-profit think-tanks, after registry (KRS) or statute
   verification.”; nota ceny bez zmian. Lustra rang: `TIER_RANKS.ngo` 40,
   `tierCatalogParity` czyta redefinicję, komentarz `clubs/planTiers.ts`;
   macierz: wartości zakresu Partnera dla NGO. Skutki - §21.3.
5. **Pula 2/5 u istniejących najemców - BEZ ZMIAN** (brak obniżki
   w opłaconym okresie; v6.2 to minimum). Dawne flagi `chat_inmail_quota_2/5`
   dają Członkowi 2, Pro 5; nowi najemcy mają 1 i 3. Wyrównanie - w panelu:
   `/admin/membership` → warstwa → „Bramki i limity”: wyłączyć
   `chat_inmail_quota_2` (Członek) albo `chat_inmail_quota_5` (Pro) i ustawić
   pulę w „Zapytania do eksperta”.
6. **„Pytania do archiwum” - backlog poza hubem.** Funkcja nie istnieje;
   zostaje poza kartami i macierzą (bez kodu).

**Z-07 / Z-S2-03 - RODO księgi MRR (decyzja właściciela 2026-10-20, zgoda
delegowana): AKCEPTACJA** zachowania zanonimizowanych ruchów, historii
i cykli windykacji po usunięciu konta, pod warunkiem pełnej anonimizacji.
Przegląd kolumn po S2: zostawały identyfikator zdarzenia operatora
(`source_event_id` `evt_…`, także w `dedupe_key`), cena osadzona darowizny
(`price_data` = identyfikator jednej subskrypcji u operatora), identyfikator
subskrypcji (przez 90 dni retencji szyny w ładunkach
`billing_subscription.*.v1` obok `user_id`) i znaczniki `revenue_event_marks`
(`quota` z surowym uid, `trial_ending`/`expired` z id subskrypcji,
`retention_abandoned`). `retention_feedback` (wolny tekst, kupon u operatora)
i `subscription_price_migrations` kasują się kaskadą z kontem; migawka rabatu
żyje w wierszu `subscriptions` (kaskada). Wykonanie (`20261020160400`):
redakcja per subskrypcja po wyzwalaczu S2 - nowy losowy identyfikator wspólny
dla historii, ruchów i cykli, `user_id` NULL, `source_event_id` NULL,
`dedupe_key = redacted:<id>`, cena spoza katalogu NULL (katalogowa zostaje -
opis planu), znaczniki usunięte; przy usunięciu konta - znaczniki `quota`
i `retention_abandoned` konta; domknięcie wstecz. Zostają: kwoty, waluta,
daty, środowisko, status, ilość, `tier_key`, interwał, segment, rodzaj ruchu,
powód z katalogu. Awaria redakcji przerywa usunięcie (jak anonimizacja
dowodów księgowych). Dowód: `hub_i9b_revenue_ledger_erasure_test` (żaden
wiersz nie zawiera uid, e-maila, `sub_`/`cus_`/`evt_`, ceny osadzonej ani
starego id; Σ `delta_minor` zamkniętych miesięcy bez zmian; dane innej osoby
nietknięte; domknięcie wstecz i druga runda 0), `revenue_subscription_history_test`.

**Podstawa (wpis do rejestru czynności przetwarzania):** dane po anonimizacji
nie są danymi osobowymi (motyw 26 RODO); przed usunięciem konta
przetwarzanie w celu sprawozdawczości finansowej (art. 6 ust. 1 lit. f)
i obowiązków rachunkowych (art. 6 ust. 1 lit. c - dokumenty księgowe żyją
w module rozliczeń: `payment_orders`, `billing_documents`, nie w księdze MRR);
retencja zanonimizowanych agregatów bez terminu. **Zalecenie: IOD potwierdza
wpis przy najbliższej aktualizacji rejestru czynności.** W repozytorium nie ma
rejestru czynności przetwarzania (przegląd `docs/` po „rejestr czynności”
i „RODO”) - wpis żyje tutaj do przeniesienia przez IOD. Publiczna polityka
prywatności bez zmian.

### 21.3 Skutki rangi 40 dla NGO

- **Kluby, treści, wydarzenia:** wszystko z `min_tier_rank` ≤ 40 - jak
  Partner Instytucjonalny (kluby „partner”, treści i wydarzenia rang 25-40,
  dotąd zamknięte dla NGO). To zamierzony skutek „zakresu Partnera”.
- **Licznik artykułów (S3, P19):** licznik nie odblokowuje treści powyżej
  rangi czytelnika - ranga wyższa daje więcej, nie mniej; nic nie wypada.
- **Remis rangi z Partnerem:** indeks `(tenant_id, rank DESC)` jest
  nieunikalny, remisy istniały wcześniej (10, 20, 25). `current_membership_tier`
  przy dwóch uprawnieniach rangi 40 wybiera jedno z nich - flagi NGO ⊇ flagi
  Partnera (różnica tylko w puli zapytań, którą kanał bezpośredni i tak
  zastępuje), więc dostęp jest ten sam. Kolejność widoczna w UI ma teraz
  stabilny drugi klucz (`compareTierRank`: ranga, `sort_order`, klucz): siatka
  warstw `/admin/membership`, „wymagany próg” ściany płatności (dla treści
  rangi 31-40 nazywa Partnera, nie stawkę po weryfikacji - `sort_order` 80 <
  85), pickery progów w ustawieniach dostępu treści, bibliotece, kampaniach
  newslettera i katalogu członków. Strona cennika sortowała już po (ranga,
  `sort_order`, klucz).
- **Organizacje:** NGO (ranga 40, `corporate_seats`) jest do wyboru jako próg
  organizacji członkowskiej.
- **Segment:** `b2b_institution` (§21.2).

### 21.4 Zmiany integratorskie i pliki współdzielone

Strażnik `hub-slice-guard.ts I9 --base 74a49536`: diff mieści się
w manifeście I9 (pliki spoza listy karty dopisane do manifestu I9 z komentarzem
„Integrator I9b”).

| Plik                                                              | Właściciel         | Zmiana                                                                                                                                                     |
| ----------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ci/hubDelivery.ts`, `__tests__/hubDelivery.gate.test.ts` | współdzielony (I9) | wymagane przez bramkę: `HUB_I9_REDEFINITIONS` (rezerwa I9), 8 funkcji I9 + 2 redefinicje cennika w rejestrze (`HUB_CIALO_Z`), manifest I9; fikstury reguły |
| `supabase/tests/hub_shared_helpers_test.sql`                      | I0                 | mapa segmentów po redefinicji; lista `hub_grants` (wymagana przez `hubDelivery.gate.test.ts`)                                                              |
| `supabase/tests/revenue_subscription_history_test.sql`            | S2                 | Z-07 odnajduje wiersze po `id` (identyfikator subskrypcji wymieniony)                                                                                      |
| `supabase/tests/pricing_catalog_v62_test.sql`                     | cennik v6.2        | kolejność kart (NGO po Partnerze)                                                                                                                          |
| `src/lib/revenue/segments.ts`, `__tests__/segmentsParity.test.ts` | I0                 | mapa i reguła; parytet z najnowszą definicją                                                                                                               |
| `src/integrations/supabase/types.ts`                              | współdzielony      | **bez zmian** - do kroku C: `subscription_state_history.price_id_after` jest od `160400` NULL-owalne (Row `string \| null`)                                |

### 21.5 Weryfikacja (I9b, część A)

Worktree `/home/user/wt/I9B`, kroki ciężkie po kolei (pamięć 16 GB); pełny
pakiet vitest - CI.

| Polecenie                                                                                                                                                                                                                                                                                                                                                                     | Wynik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bunx prettier --write` (zmienione pliki)                                                                                                                                                                                                                                                                                                                                     | ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `bun run verify:static`                                                                                                                                                                                                                                                                                                                                                       | `format:check` ✓, `check:client-ip-source` ✓, `check:dangerous-html` ✓; `check:migration-lanes` ✗ wyłącznie przez brak bliźniaków drizzle pięciu migracji `2026102016*` (krok C, Z-I9b-01); pozostałe bramki zestawu uruchomione osobno - ✓: `module-singletons`, `on-conflict-arbiters`, `public-assets`, `rpc-contract` (847 nazw), `sql-anon-insert`, `sql-app-role`, `sql-definer-views`, `sql-migration-replay` (1289 plików), `sql-owner-tenant-scope`, `sql-policy-tenant-regression`, `sql-tenant-scope` (1778 funkcji), `structured-data-live`, `ts-sql-contract`, `types-freshness` (baseline 7) |
| `GOMEMLIMIT=11GiB GOGC=50 bunx tsgo --noEmit --checkers 1`                                                                                                                                                                                                                                                                                                                    | 3 błędy w testach S5 (`journeys.functions.test.ts`, `parse.test.ts`) - te same na bazie `74a49536` (osobny worktree), żadnego w plikach I9b (Z-I9b-07)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `bun run typecheck:scripts`, `bun run typecheck:e2e`                                                                                                                                                                                                                                                                                                                          | ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `bunx eslint` (zmienione pliki)                                                                                                                                                                                                                                                                                                                                               | ✓ 0 błędów, 0 ostrzeżeń                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `TZ=UTC bunx vitest run --maxWorkers=3` - `src/lib/{revenue,billing,organizations,ci,access,admin,clubs}`, `src/components/admin/{pricing,membership,organizations,members,__tests__,post-editor}`, `src/components/pricing`, `src/routes/__tests__`, bramki `src/__tests__` i konsumenci (`Paywall.reader`, `ClubAccessGate.funnel`, `adminLibraryReplace`, `-billing-cron`) | ✗ → ✓: 800 plików; 4 pliki czerwone po imporcie `compareTierRank` przez atrapowany moduł `billing/tiers` → import z liściowego `tierRanks`, po poprawce ✓; zostaje wyłącznie `supabaseLaneCoverage` (2 asercje: brak bliźniaków drizzle `2026102016*` - krok C)                                                                                                                                                                                                                                                                                                                                            |
| pgTAP `run.sh all 'revenue\|pricing\|tier\|segment\|mrr\|subscription\|dunning\|retention\|hub_\|account\|membership\|org\|seat\|security_definer\|metering\|paywall\|checkout\|donation'`                                                                                                                                                                                    | ✓ 50 plików (w tym 4 nowe: 59 asercji), migracje: wyłącznie znany błąd `20260825230232`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| pgTAP `run.sh test` - konsumenci rang i flag (`community_tracker`, `expert_request*`, `plan_ticket_allowance`, `payment_orders_for_sale`, kluby, wydarzenia, licznik)                                                                                                                                                                                                         | ✓ 67 plików                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `bun run generate:ts-sql-contract` + `run.sh test ts_sql_contract`                                                                                                                                                                                                                                                                                                            | ✓ bez zmiany pliku; 9 asercji                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `scripts/split-migration.ts --dry-run` (5 migracji)                                                                                                                                                                                                                                                                                                                           | ✓ każda w limicie (8,4 / 16,9 / 26,8 / 7,2 / 13,4 KB)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `scripts/hub-slice-guard.ts I9 --base 74a49536`                                                                                                                                                                                                                                                                                                                               | ✓ diff w manifeście I9; dostawa huba: 5 plików w bloku I9, 11 definicji funkcji                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `generate:authz-snapshot --check`                                                                                                                                                                                                                                                                                                                                             | ✗ tylko liczniki skanu (migracje 1284 → 1289, funkcje 1770 → 1778) - plik współdzielony, nie w CI; regeneracja w I9 (jak po S2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `flock -o /tmp/hub-build.lock env BUNDLE_INVENTORY=1 bun run build` + `check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity`                                                                                                                                                                                                                       | ✓ bez ratchetu: `overall` 5002,6 / 5003 (**zapas 0,4 KB** - części B/C muszą liczyć się z ratchetem D-08), `public` 2777,8 / 2881 (zamr.), największy chunk 257,8 / 286, `publicCss` 83,8 / 85, `boot` 471,6 / 579; kod panelu (chip, notka Zespołu, słowniki) w leniwych chunkach admina                                                                                                                                                                                                                                                                                                                  |

### 21.6 Wdrożenie (właściciel)

Kolejność: po S2 (`2026102011*`) i po bliźniakach drizzle z kroku C, nocą -
wyzwalacze na `subscriptions`, `auth.users`, `member_organizations`
i `organization_seats` oraz UPDATE `membership_tiers` (`lock_timeout` 5 s,
55P03 = ponów plik). Wszystkie pięć plików jest idempotentnych. Kontrola po
wdrożeniu (SQL editor, tylko odczyt):

```sql
-- Segmenty: partnerzy i NGO w instytucjach; oczekiwane 0 wierszy niezgodnych.
SELECT count(*) FROM public.mrr_movements m
 WHERE m.segment IS DISTINCT FROM public.revenue_segment_of_tier(
         CASE WHEN m.kind = 'churn' THEN m.tier_key_before ELSE m.tier_key_after END);
-- Cennik: Zespół z trackerem, NGO ranga 40 (każdy najemca).
SELECT t.slug, mt.key, mt.rank, mt.features ->> 'regulatory_monitoring' AS tracker,
       mt.features ->> 'chat_direct_gated' AS direct
  FROM public.membership_tiers mt JOIN public.tenants t ON t.id = mt.tenant_id
 WHERE mt.key IN ('team', 'ngo') ORDER BY 1, 2;
-- Zespół ponad 20 miejsc sprzed reguły (zostają, dodawanie zablokowane).
SELECT id, name, seats_limit FROM public.member_organizations
 WHERE tier_key = 'team' AND seats_limit > 20;
-- RODO: ślady operatora w księdze subskrypcji usuniętych - oczekiwane 0.
SELECT count(*) FROM public.subscription_state_history h
 WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.id = h.subscription_id)
   AND (h.source_event_id IS NOT NULL OR h.dedupe_key NOT LIKE 'redacted:%');
```

Wycofanie: segmenty - nowa migracja z mapą sprzed I9b i ponownym
`_revenue_segments_recompute()`; cennik - zmiany są addytywne (tracker, ranga,
flagi Partnera), cofnięcie wymaga decyzji właściciela (obniżka uprawnień);
limit miejsc - `DROP TRIGGER trg_member_organizations_team_seat_cap`
i `trg_organization_seats_team_seat_cap` osobną migracją; RODO - redakcja jest
nieodwracalna z założenia (zdjęcie wyzwalaczy zatrzymuje ją dla kolejnych
usunięć, czego RODO nie dopuszcza bez innej anonimizacji).

### 21.7 Zgłoszenia otwarte

| ID       | Zgłoszenie                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Z-I9b-01 | Bliźniaki drizzle pięciu migracji `2026102016*` i wpis w `drizzle/migrations/meta/_journal.json` - krok C (`check:migration-lanes`). **Zamknięte 2026-10-20 (§21.8).**                                                                                                                                                                                                                                                                                             |
| Z-I9b-02 | `types.ts`: `subscription_state_history.price_id_after` NULL-owalne od `20261020160400` - krok C / regeneracja Lovable (żaden kod TS nie czyta tej kolumny). **Zamknięte 2026-10-20 (§21.8).**                                                                                                                                                                                                                                                                     |
| Z-I9b-03 | `paywall_hits.user_id` (S3, I0 DDL) nie ma klucza obcego - po usunięciu konta zostaje surowy uid w wierszach lejka. Poza księgą MRR (decyzja RODO dotyczy księgi), wpływa na historię lejka: do decyzji właściciela/IOD (usunięcie wierszy konta albo pseudonim jak `visitor_hash`). **Zamknięte 2026-10-20 (§21.9, polecenie właściciela „zastosuj”): pseudonim zastępczy konta (losowy UUID v8, bez mapowania) - liczniki lejka zamkniętych okresów bez zmian.** |
| Z-I9b-04 | `domain_events` trzymają `user_id` i `subscription_id` w ładunkach przez 90 dni (`prune_domain_events`) - po redakcji księgi nie łączą się z nią, ale same są danymi osobowymi do 90 dni po usunięciu konta (szyna sprzed huba). **Zamknięte 2026-10-20 (§21.9): zdarzenia osoby i ich kopie redagowane przy usunięciu konta (nowy id, pseudonim, biała lista kluczy), nieprzetworzone pominięte; retencja 90 dni bez zmian.**                                     |
| Z-I9b-05 | IOD: potwierdzenie podstawy i retencji zanonimizowanej księgi (§21.2) przy aktualizacji rejestru czynności - w repozytorium brak rejestru. **Zamknięte 2026-10-20 (§21.9): administrator danych zatwierdził podstawę i retencję („zastosuj”); rejestr czynności huba - `docs/RODO_REJESTR_CZYNNOSCI_HUB_2026-10.md`, do wiadomości IOD.**                                                                                                                          |
| Z-I9b-06 | Webhook operatora z ilością miejsc > 20 dla Zespołu: odmowa i log zamiast synchronizacji - jeśli klient kupi > 20 miejsc u operatora, admin przenosi organizację na Enterprise (alert w panelu). Opcja: alert diagnostyki S7.                                                                                                                                                                                                                                      |
| Z-I9b-07 | `tsgo` na bazie `74a49536` ma 3 błędy w testach S5 (`journeys.functions.test.ts`, `parse.test.ts`) - poza I9b, do naprawy w S8/I9. **Zamknięte 2026-10-20 (§21.8).**                                                                                                                                                                                                                                                                                               |
| Z-I9b-08 | `authzSnapshot.generated.ts` - regeneracja (liczniki skanu po pięciu migracjach I9b); plik współdzielony poza CI - przy regeneracji I9 (jak po S2). **Zamknięte 2026-10-20 (§21.8).**                                                                                                                                                                                                                                                                              |
| Z-I9b-09 | Profil właściciela organizacji (`/profile/organization`, poza panelem admina): `setTeamSeatLimit` odrzuca > 20 miejsc Zespołu (`orgs: team seats max`), a profil pokazuje ogólny błąd zmiany - opcja: ten sam komunikat z sugestią Enterprise (słownik profilu, budżet `public`).                                                                                                                                                                                  |
| Z-I9b-10 | IOD: retencja danych żywych kont i kontaktów nieustalona w repozytorium (`paywall_hits`, `metering_event_log`, `crm_leads` bez źródła poza kontem, `email_send_log`, `journey_message_events`, `audit_log`) - propozycja okresów i zadań czyszczących w harmonogramie panelu (rejestr czynności, §21.9).                                                                                                                                                           |
| Z-I9b-11 | Kolumny autora w modułach, do których hub nie pisze: `club_applications.reviewed_by` (zmiana wymaga wycinka S4 - znacznik `pg-harness: exclude`) i `event_registrations.paid_amount_recorded_by` - zostaje uid usuniętego konta personelu (§21.9).                                                                                                                                                                                                                 |

### 21.8 Integracja części A do PR (orkiestrator, 2026-10-20)

**Polecenie właściciela:** „wypchnij do PR co wykonałeś”. Część A weszła na
gałąź PR przed częściami B i C. Część B pracuje dalej w worktree
`/home/user/wt/I9B`; przy integracji (C) commity A są już w gałęzi PR.

- **Scalenie:** `822cf9a9` (merge `--no-ff` commitu `2d97838a` na
  `0eeb59b1`). Baza ma już poprawkę typów testów S5 (`0eeb59b1`), więc
  Z-I9b-07 jest zamknięte.
- **Bliźniaki drizzle (Z-I9b-01):** `0358_revenue_segment_institutions`,
  `0359_pricing_v62_catalog_decisions`, `0360_pricing_v62_decisions_tenants`,
  `0361_team_seat_cap`, `0362_revenue_ledger_erasure` (bajt w bajt, `cmp`)
  i wpisy `meta/_journal.json` (idx 358-362, `when` co 60 000). Następny wolny
  numer: **0363**.
- **`types.ts` (Z-I9b-02):** `subscription_state_history.price_id_after` -
  `string | null` w Row, opcjonalne i NULL-owalne w Insert i Update.
- **`authzSnapshot.generated.ts` (Z-I9b-08):** regeneracja - zmieniają się
  tylko liczniki skanu (migracje 1284 → 1289, funkcje 1770 → 1778).

| Bramka (gałąź PR po scaleniu)                                                                                        | Wynik                               |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `bun run format:check`, `bun run verify:static` (w tym `check:migration-lanes`)                                      | ✓                                   |
| `check:types-freshness`, `generate:authz-snapshot --check`                                                           | ✓                                   |
| `tsgo --noEmit` z domyślnymi checkerami (jak CI), zawężony do 34 zmienionych plików TS części A i ich zależności     | ✓ 0 błędów                          |
| `vitest` (authz, `hubDelivery.gate`, `migrationLaneParity`, `supabaseLaneCoverage`, revenue, billing, organizations) | ✓ 217 plików, 6116 testów           |
| pgTAP, build i budżety                                                                                               | bez zmian względem części A (§21.5) |

### 21.9 RODO po usunięciu konta (polecenie właściciela, A2)

**Polecenie właściciela 2026-10-20:** „zastosuj” dla Z-I9b-03, Z-I9b-04
i Z-I9b-05. Wykonanie: worktree `/home/user/wt/I9B2`, gałąź `hub/i9b-rodo`
od `ad3bc9d1` (gałąź PR po integracji części A). Część B pracuje osobno
w `/home/user/wt/I9B` i przenumeruje swoją migrację na wersję po A2.

**R1 (Z-I9b-03) - lejek.** Lejek S3 liczy konta przez `count(DISTINCT
user_id)` (`_funnel_counts`: `paywall_hit_accounts`, `active_accounts`,
`paywall_reasons`; inwentarz `hits_30d`), nie przez złączenie z kontem, więc
NULL zgubiłby konto z zamkniętych okresów (i złamałby CHECK „dokładnie jeden
podmiot”). Decyzja: JEDEN pseudonim zastępczy na usuwane konto - losowy UUID
(`gen_random_uuid()`) z cyfrą wersji 8 (RFC 9562 „custom”), bez zapisu
mapowania. Wersja 8 odróżnia pseudonim od uid kont (GoTrue - wersja 4), więc
domknięcie wstecz go nie bierze i powtórka zwraca 0. `paywall_hits.user_id`
i `metering_event_log.user_id` -> pseudonim, `visitor_id` dziennika licznika
-> NULL; IP i UA tabele lejka nie trzymają. Kolejność wyzwalaczy: redakcja
huba jest AFTER DELETE (`on_auth_user_deleted_redact_hub`), więc odpala się
po akcjach kluczy obcych (`RI_ConstraintTrigger_…` są pierwsze alfabetycznie)

- kaskady (profil, subskrypcje, nadania) kończą się wcześniej, a zdarzenia
  emitowane przez kaskadę (np. zmiana statusu usuwanej subskrypcji z
  `user_id`) też są redagowane. Żadna tabela z przeglądu nie traci wierszy
  kaskadą przed redakcją. PSCR: mianownik zostaje, a konwersja usuniętego
  konta znika z licznika, bo moduł rozliczeń zeruje `payment_orders.user_id`
  (tak jak przed A2). Zachowanie jej wymagałoby pseudonimu na dowodzie
  księgowym, który identyfikuje nabywcę. Dowód: `hub_i9b_account_erasure_sweep_test`
  (liczniki lejka zamkniętego okresu - 2 konta z uderzeniem, 2 aktywne, powody -
  bez zmian; jeden pseudonim v8 w lejku, licznikach, szynie i audycie).

**R2 (Z-I9b-04) - szyna zdarzeń.** Zdarzenie osoby (aktor, agregat albo
uid/e-mail gdziekolwiek w ładunku) dostaje NOWY losowy `id` (odcina
odwołania z wierszy związanych z leadem: `trigger_event_id`,
`detail.event_id`, `crm_tasks.origin_ref 'wf:<id>'`), `aggregate_id` =
pseudonim, `actor_id` -> NULL, `correlation_id` -> NULL. Ładunek przechodzi
przez BIAŁĄ listę kluczy nieosobowych (`_hub_erasure_payload`), a
`user_id`/`member_user_id` osoby -> pseudonim (spójne liczenie z lejkiem
i szacunkiem wyzwalacza ścieżki). Znikają identyfikatory operatora
(subskrypcja, cena, klient), zamówienia, dokumentu, leada, osoby, zgłoszenia,
imiona, adresy i wolny tekst. Zostają typ, czas, najemca, kwoty i klucze
nieosobowe. Znacznik `_redacted: account_deleted`. Kopie (skrzynka ścieżek,
dostawy integracji) dostają ten sam nowy id i ten sam kształt. Konsumenci:
skrzynka ścieżek - nieprzetworzone `processed_at` + `error =
skipped:account_deleted` (ingest ich nie weźmie, więc nie rozpozna leada i nie
wyśle maila); router integracji - `queued|failed` -> `dead` z tym samym
powodem; workflowy działają synchronicznie przy INSERT, a unieważnianie
zapytań w przeglądarce słucha wyłącznie INSERT, więc UPDATE redakcji niczego
nie wyzwala. Zapis na ścieżkę w toku -> `exited` z nowym powodem
`account_deleted` (CHECK, lustro `JOURNEY_EXIT_REASONS`, etykiety PL/EN
„Konto usunięte (RODO)” / „Account deleted (GDPR)”, parytet
`journeyLimitsParity`), bo ścieżki `service` nie pytają o zgodę. Zapis
zostaje przy kontakcie CRM bez `user_id`, bez `trigger_event_id`, z migawką
bez identyfikatorów i bez pseudonimu (lead jest identyfikowalny). Odcięcie
leada od konta emituje `crm_lead.updated.v1` - trasa do skrzynki pomija je
(głębokość wyzwalaczy ≥ 3), a redakcja i tak oznacza je jako pominięte
i gasi dostawy. Retencja 90 dni (`prune_domain_events`) bez zmian. Dowód: ten
sam test (zdarzenia zostają z nowym id, nieprzetworzone pominięte, ingest po
usunięciu: 0 zapisów, liczba leadów bez zmian, dostawy `dead`).

**R3 - pełny przegląd.** Przegląd kolumn uuid/text/jsonb (`information_schema`
na bazie po wszystkich migracjach) tabel huba (I0-S5, I9) i modułów, do
których hub pisze (emitery, CRM, newsletter, licznik, kasa, retencja,
nadania, poczta ścieżek, integracje, audyt). „Bez FK” = kolumna bez klucza
obcego do `auth.users` (surowy uid po usunięciu konta).

| Tabela                                                                                                                                                            | Kolumny osobowe                                          | Przed A2                                                     | Po A2                                                                 | Dowód (sweep, nr asercji) |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------- |
| `subscription_state_history`, `mrr_movements`, `dunning_cycles`                                                                                                   | `user_id`, `subscription_id`, zdarzenia i ceny operatora | redakcja `160400`                                            | bez zmian                                                             | 4, 8; `ledger_erasure`    |
| `revenue_event_marks`                                                                                                                                             | `ref` (uid, subskrypcja, ankieta)                        | znaczniki konta usunięte `160400`                            | bez zmian                                                             | 4                         |
| `mrr_daily_snapshots`, `journey_email_contents`, `journey_event_routes`, `journey_node_daily_stats`                                                               | brak                                                     | -                                                            | -                                                                     | 4                         |
| `paywall_hits`                                                                                                                                                    | `user_id` (bez FK)                                       | **surowy uid**                                               | pseudonim v8                                                          | 4, 7, 9                   |
| `metering_event_log`                                                                                                                                              | `user_id` (bez FK), `visitor_id`                         | **surowy uid**                                               | pseudonim v8, `visitor_id` NULL                                       | 4, 9                      |
| `metered_views`                                                                                                                                                   | `user_id`                                                | CASCADE                                                      | bez zmian                                                             | 4                         |
| `domain_events`                                                                                                                                                   | `actor_id`, `aggregate_id`, ładunek, korelacja           | **surowy uid do 90 dni**                                     | nowy id, pseudonim, biała lista kluczy                                | 4, 10, 11                 |
| `journey_event_inbox`                                                                                                                                             | `actor_id`, `aggregate_id`, ładunek                      | **surowy uid; nieprzetworzone zapisywały na ścieżkę**        | ta sama redakcja; nieprzetworzone pominięte                           | 4, 12, 14-16              |
| `integration_deliveries`                                                                                                                                          | koperta zdarzenia                                        | **surowy uid; czekające wysyłane**                           | redakcja, czekające `dead`                                            | 4, 13                     |
| `journey_enrollments`                                                                                                                                             | `user_id` (bez FK), migawka, `trigger_event_id`          | **surowy uid; w toku wysyłały**                              | `exited/account_deleted`, `user_id` NULL, migawka bez identyfikatorów | 4, 17                     |
| `journey_step_runs`                                                                                                                                               | `detail`                                                 | brak uid w praktyce                                          | redakcja, gdy zawiera uid/e-mail                                      | 4                         |
| `journey_messages`, `journey_message_events`                                                                                                                      | `lead_id`, link kliknięcia (bez IP/UA)                   | przy kontakcie CRM                                           | bez zmian - historia kontaktu CRM (wyjątek)                           | 4                         |
| `journey_engine_errors`, `domain_event_emit_errors`, `workflow_runs`                                                                                              | tekst błędu                                              | ewentualny uid/e-mail w komunikacie                          | `[redacted]`                                                          | 4                         |
| `crm_leads`                                                                                                                                                       | `user_id` (bez FK); e-mail, imię, nazwisko               | **surowy uid**                                               | `user_id` NULL; kontakt zostaje (wyjątek)                             | 4-6                       |
| `crm_lead_stage_history`                                                                                                                                          | `actor_id` (bez FK)                                      | **surowy uid**                                               | NULL                                                                  | 4, 18                     |
| `crm_tasks`                                                                                                                                                       | `assignee_id`, `created_by`                              | SET NULL                                                     | bez zmian                                                             | 4                         |
| `crm_lead_notes`, `cross_references`                                                                                                                              | `author_id`, `created_by` (bez FK); krawędź do konta     | **surowy uid**                                               | NULL; krawędź do konta usunięta                                       | 21-23                     |
| `newsletter_subscribers`                                                                                                                                          | `user_id` (bez FK); e-mail                               | **surowy uid**                                               | `user_id` NULL; subskrypcja zostaje (wyjątek)                         | 4, 18                     |
| `journey_definitions`, `journey_versions`, `journey_settings`, `revenue_manual_inputs`                                                                            | autor, asygnata zadań (bez FK)                           | **surowy uid**                                               | NULL, konfiguracja zostaje                                            | 20, 23                    |
| `revenue_diagnostic_snoozes`                                                                                                                                      | `created_by` (NOT NULL, bez FK)                          | **surowy uid** (nie dało się wyzerować)                      | NULL-owalne, NULL                                                     | 20                        |
| `newsletter_settings`, `workflow_definitions`, `integration_endpoints`                                                                                            | autor (bez FK)                                           | **surowy uid**                                               | NULL                                                                  | 21, 23                    |
| `audit_log`                                                                                                                                                       | `actor_id`, `entity_id`, metadane, `ip` (bez FK)         | **surowy uid**                                               | pseudonim, IP własnych działań NULL, e-mail `[redacted]`              | 4, 9, 24-25               |
| `membership_grants`, `member_crm_sync_pending`, `retention_feedback`, `subscriptions` (migawka rabatu), `subscription_price_migrations`, `b2b_coupon_redemptions` | `user_id`, aktor                                         | CASCADE / SET NULL                                           | bez zmian                                                             | 4, 18                     |
| `email_send_log`                                                                                                                                                  | adres odbiorcy                                           | adres kontaktu CRM                                           | bez zmian (wyjątek)                                                   | 4 (brak wierszy w teście) |
| `payment_orders`, `user_purchases`, `billing_documents`                                                                                                           | uid, e-mail, dane nabywcy                                | anonimizacja `20260805090100` (dokumenty - świadomie bez FK) | bez zmian (wyjątek księgowy)                                          | `accounting_retention`    |

Kontrolnie test skanuje KAŻDĄ tabelę bazową `public` z `tenant_id` (nie tylko
przegląd) - dla konta czytelnika i konta admina ślady zostają wyłącznie
w kolumnach z listy wyjątków.

**Wyjątki z podstawą** (lista jawna w teście i w rejestrze czynności):
kontakt CRM (`crm_leads.email/email_norm`, imię, nazwisko) i jego historia
ścieżek - osobna czynność CRM (art. 6 ust. 1 lit. f / lit. a), może pochodzić
z formularza, wydarzenia lub newslettera, a kaskada zabrałaby notatki
i zadania personelu - usuwa go admin w `/admin/crm` na żądanie osoby;
subskrypcja newslettera (`newsletter_subscribers.email`) - zgoda niezależna
od konta; rejestr zgód (`crm_consent_log.email`) - art. 7 ust. 1; blokady
poczty (`email_suppressions`) - art. 21 ust. 3; dowody księgowe - art. 74
ust. 2 uor; dziennik audytu - wpis i pseudonim aktora (art. 5 ust. 2, art. 32).

**R4 (Z-I9b-05) - administrator danych i IOD.** Administrator danych
(właściciel) zatwierdził 2026-10-20 podstawę i retencję zanonimizowanej
księgi MRR („zastosuj”). Rejestr czynności przetwarzania huba (art. 30 RODO):
`docs/RODO_REJESTR_CZYNNOSCI_HUB_2026-10.md` - księga MRR (przed i po
anonimizacji), uderzenia w paywall i lejek, zdarzenia domenowe (90 dni),
ścieżki e-mail (zgody, D-03/D-04, śledzenie otwarć i kliknięć), CRM (etapy
i historia), ankiety retencji; dla każdego cel, podstawa z artykułem,
kategorie osób i danych, odbiorcy widoczni w repozytorium (Supabase, Stripe,
Resend przez bramkę Lovable, punkty integracji admina), okres przechowywania,
mechanizm z odnośnikiem do migracji i testu. Status: „zatwierdzone przez
administratora danych 2026-10-20; do wiadomości IOD”. Nowe zgłoszenia:
Z-I9b-10 (retencja danych żywych kont nieustalona w repozytorium), Z-I9b-11
(autor w modułach spoza zapisu huba).

**Migracje (blok I9) i bliźniaki drizzle.**

| Migracja                                       | Bliźniak                             | Zawartość                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `20261020160500_funnel_account_erasure`        | `0363_funnel_account_erasure`        | `_hub_erasure_surrogate`, `_funnel_erase_account` (R1)                                                                                                                               |
| `20261020160600_domain_events_account_erasure` | `0364_domain_events_account_erasure` | `_hub_erasure_payload`, `_hub_erasure_text`, `_domain_events_erase_account`, `_journeys_erase_account`, CHECK `exit_reason` += `account_deleted` (R2)                                |
| `20261020160700_hub_account_erasure_sweep`     | `0365_hub_account_erasure_sweep`     | `revenue_diagnostic_snoozes.created_by` NULL-owalne, `_hub_account_erase`, `tg_auth_users_hub_erasure` (AFTER DELETE ON `auth.users`), `_hub_account_erase_orphans` + wywołanie (R3) |

Bliźniaki bajt w bajt (`cmp`), wpisy `meta/_journal.json` idx 363-365,
`when` co 60 000. Następny wolny numer: **0366**. Część B bierze wersję
`20261020160800` i dalej. Pliki współdzielone (I9): `hubDelivery.ts`
(9 funkcji w rejestrze, manifest I9 „(I9b-A2, 2026-10-20)”), `types.ts`
(`revenue_diagnostic_snoozes.created_by` - `string | null`),
`authzSnapshot.generated.ts` (liczniki skanu), `_journal.json`; lista
`hub_grants` w `hub_shared_helpers_test`.

**Bramki A2** (worktree `/home/user/wt/I9B2`, po kolei, pamięć 16 GB):

| Polecenie                                                                                                                                                                                                                                                                                                                                     | Wynik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bunx prettier --write` (zmienione pliki), `bun run format:check`                                                                                                                                                                                                                                                                             | ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `bun run verify:static` (18 bramek: `migration-lanes`, `rpc-contract`, `on-conflict-arbiters`, `sql-anon-insert`, `sql-app-role`, `sql-definer-views`, `sql-migration-replay` 1292 pliki, `sql-owner-tenant-scope`, `sql-policy-tenant-regression`, `sql-tenant-scope` 1787 funkcji, `ts-sql-contract --check`, `types-freshness` baseline 7) | ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GOMEMLIMIT=11GiB GOGC=50 bunx tsgo --noEmit --checkers 1`, `typecheck:scripts`, `typecheck:e2e`                                                                                                                                                                                                                                              | ✓ 0 błędów                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `tsgo --noEmit` z domyślnymi checkerami, zawężony (`tsconfig.i9b.tmp.json`, 5 zmienionych plików TS + deklaracje)                                                                                                                                                                                                                             | ✓ 0 błędów                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `bunx eslint` (zmienione pliki)                                                                                                                                                                                                                                                                                                               | ✓ 0 błędów, 0 ostrzeżeń                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `vitest --maxWorkers=3`: `src/lib/{ci,authz,revenue,journeys}`, `src/integrations`, słowniki i18n                                                                                                                                                                                                                                             | ✓ 135 plików, 3046 testów                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `vitest`: `supabaseLaneCoverage`, `migrationLaneParity`, `hubDelivery.gate`, `i18nParity.gate`                                                                                                                                                                                                                                                | ✓ 4 pliki, 97 testów                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `scripts/split-migration.ts --dry-run` (3 migracje)                                                                                                                                                                                                                                                                                           | ✓ 6,0 / 18,7 / 18,1 KB                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `generate:authz-snapshot` i `--check`                                                                                                                                                                                                                                                                                                         | ✓ (liczniki: 1292 migracje, 1787 funkcji)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `scripts/hub-slice-guard.ts I9 --base ad3bc9d1`                                                                                                                                                                                                                                                                                               | ✓ diff w manifeście; 3 pliki w bloku I9, 9 definicji funkcji                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `flock … bun run build` + `check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity`                                                                                                                                                                                                                                   | ✓ `overall` 5002,5 / 5003, `public` 2777,6 / 2881 (zamr.), `publicCss` 83,8 / 85, chunk 257,8 / 286, `boot` 471,6 / 579 - bez zmian względem części A                                                                                                                                                                                                                                                                                                                                                                                                          |
| pgTAP `run.sh all` (pełny)                                                                                                                                                                                                                                                                                                                    | ✓ 241 plików OK; 4 czerwone - wyłącznie znane błędy środowiska: `community_cron_schedule` (2 asercje pg_net), `job_scheduler_heartbeat` (1 asercja pg_net), `profile_intent_semantic` (vector), `public_definer_views_read_only` (1/35); migracje: wyłącznie znany błąd `20260825230232`. Nowy `hub_i9b_account_erasure_sweep` 33/33; `accounting_retention`, `hub_i9b_revenue_ledger_erasure`, `revenue_subscription_history`, `subscription_price_migrations_lifecycle`, `user_subscriptions_user_fk_cascade` (testy usuwające konta) i `journeys_*` zielone |
| `generate:ts-sql-contract` + `run.sh test ts_sql_contract`                                                                                                                                                                                                                                                                                    | ✓ bez zmiany pliku; 9 asercji                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Wdrożenie (właściciel).** Kolejność: po `20261020160400` (wyzwalacz BEFORE
księgi MRR) i po S5, nocą - ALTER `revenue_diagnostic_snoozes`, CHECK na
`journey_enrollments` (NOT VALID + VALIDATE) i wyzwalacz na `auth.users`
przy `lock_timeout` 5 s (55P03 = ponów plik). Wszystkie trzy pliki są
idempotentne. Skutek dla danych produkcyjnych: domknięcie wstecz
(`_hub_account_erase_orphans`, raz na osierocone konto - uid w wersji 4
nieobecny w `auth.users` w kolumnach z przeglądu) zamienia ślady kont
usuniętych przed A2: uderzenia i dziennik licznika -> pseudonim (liczniki
zamkniętych okresów bez zmian), zdarzenia szyny i kopie -> redakcja,
nieprzetworzone - pominięte, zapisy na ścieżki w toku -> `account_deleted`,
`crm_leads.user_id`/newsletter -> NULL, autorzy konfiguracji -> NULL, audyt
-> pseudonim. Czas: jeden przebieg tabel z przeglądu na osierocone konto
(szyna ≤ 90 dni). Kontrola po wdrożeniu (SQL editor, tylko odczyt):

```sql
-- Lejek i licznik: surowe uid kont nieistniejących - oczekiwane 0.
SELECT (SELECT count(*) FROM public.paywall_hits ph
         WHERE substr(ph.user_id::text, 15, 1) = '4'
           AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = ph.user_id))
     + (SELECT count(*) FROM public.metering_event_log l
         WHERE substr(l.user_id::text, 15, 1) = '4'
           AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = l.user_id)) AS lejek;
-- Szyna: zdarzenia z uid konta nieistniejącego - oczekiwane 0.
SELECT count(*) FROM public.domain_events e
 WHERE e.payload ->> 'user_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4'
   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id::text = e.payload ->> 'user_id');
-- CRM i newsletter: powiązania z kontem nieistniejącym - oczekiwane 0.
SELECT (SELECT count(*) FROM public.crm_leads l
         WHERE l.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = l.user_id))
     + (SELECT count(*) FROM public.newsletter_subscribers s
         WHERE s.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = s.user_id)) AS powiazania;
```

Wycofanie: redakcja jest nieodwracalna z założenia; zdjęcie wyzwalacza
(`DROP TRIGGER on_auth_user_deleted_redact_hub` osobną migracją) zatrzymuje
ją dla kolejnych usunięć, czego RODO nie dopuszcza bez innej anonimizacji.
Powód `account_deleted` zostaje w słowniku (zapisy z nim nie znikają).

## 22. I9b - decyzje właściciela, część B: budżet, autoryzacja, kasa, retencja, benchmarki, limit tagu (2026-10-20)

**Decyzja właściciela 2026-10-20, zgoda delegowana:** „wykonaj wszystkie
i aktualizuj - masz zgodę”; rozstrzygnięcia oddane orkiestratorowi. Każdy
wpis niżej jest decyzją właściciela z tą adnotacją. Praca szeregowa (jedyny
aktywny agent), worktree `/home/user/wt/I9B`, gałąź `hub/i9b-decyzje`
przebazowana na gałąź PR po A2 (`d7efcba5`). Niezacommitowana praca
przerwanego podejścia do B7 została przejrzana i dokończona; jej migracja
dostała pierwszą wolną wersję po A2 (`160500` zajęła A2). Bliźniak drizzle
i integracja - krok C.

### 22.1 Zakres

| Obszar                               | Co dostarcza I9b (część B)                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL (1 migracja, blok I9)            | `20261020160800_crm_tag_limit_shared.sql` (28,9 KB): redefinicje `run_workflow_step` (CIALO-Z `20261020130200`, S4) i `journey_validate_graph` (CIALO-Z `20261020140200`, S5) - jedyna zmiana ciał to limit tagu 40 → 64 (diff ciał sprawdzony); ACL jak u właścicieli.                                        |
| pgTAP (3 nowe pliki, 28 asercji)     | `hub_i9b_crm_tag_limit` (12), `hub_i9b_access_inventory_authz` (8), `hub_i9b_retention_scenario` (8); zmieniony `workflow_actions_v2` (granica tagu 65 zamiast 41).                                                                                                                                            |
| TS - limit tagu (B7)                 | `CRM_TAG_MAX` (`src/lib/crm/lifecycle.ts`) czytają schematy zod leadów, filtrów, widoków, importu, przepisów i ścieżek, `JOURNEY_LIMITS.tagMax`, `JOURNEY_TAG_MAX`, `WORKFLOW_TAG_MAX`, licznik w filtrze tagów; komunikaty PL/EN; `tagLimitParity.test.ts`.                                                   |
| Panel - okno kasy przy biletach (B3) | `EventTicketCheckoutWindowNote` w nagłówku karty biletów wydarzenia: bieżące okno porzucenia kasy (PL/EN) i link do `/admin/paywall?tab=checkout`; wspólny `effectiveCheckoutAbandonMinutes` (`src/lib/revenue/limits.ts`) dla tej linii i karty kasy.                                                         |
| Testy scenariusza anulowania (B4)    | `functions.stripeBoundary.test.ts` (server fns z prawdziwym modułem rabatu, atrapa wyłącznie klienta Stripe), nazwa kuponu w `applyOffer.test.ts`, pgTAP księgi MRR po webhookach.                                                                                                                             |
| Rejestr benchmarków (B5)             | Wpis `engagement_rate` (ER (GA4), grupa Lejek): dane i nakładka w `docs/benchmarki/2026-10-18/lejek{,.overlay}.json`, wygenerowane moduły (`import-benchmarks.ts`), pole `hub` rekordu `b-engr` w pakiecie Insidera, uzupełnienie `docs/BENCHMARKI_WSKAZNIKOW_2026-10-18.md`; przegląd źródeł PPCR self-serve. |
| Bramka dostawy                       | `HUB_I9_REDEFINITIONS` += `run_workflow_step` (`20261020130200`), `journey_validate_graph` (`20261020140200`); redefinicja I9 funkcji sprzed huba sprawdza `CIALO-Z` względem najnowszej definicji w hubie, nie `HUB_CIALO_Z` (fikstura w `hubDelivery.gate.test.ts`); manifest I9 += pliki części B.          |

### 22.2 Decyzje → wykonanie → dowód

**B1. Z-S3-01 - budżet `public` S3 (+5,4 KB przy celu ≤ +1,2 KB).**
Decyzja właściciela 2026-10-20, zgoda delegowana: nie okrajamy funkcji
(oferta i ceny dla gościa zostają - rdzeń konwersji i przejrzystości cennika
v6.2), najpierw redukujemy kod klienta bez utraty funkcji, resztę
akceptujemy jako odchylenie od celu karty; próg zamrożony 2881 bez zmian.

Wykonanie - pomiar i przegląd każdej skutecznej klasy redukcji (przeniesienie
do `lazy` nie zmienia `public`):

Pomiar (`flock -o /tmp/hub-build.lock env BUNDLE_INVENTORY=1 bun run build`

- `check:bundle`, ten sam host i `node_modules`): baza `d7efcba5` (gałąź PR
  po A i A2, osobny worktree) `public` 2778,0 / `overall` 5003,0 / `publicCss`
  83,8; po części B `public` 2777,9 / `overall` 5003,2 / `publicCss` 83,8.
  Część B nie zmienia kodu S3, więc przyrost S3 to nadal +5,4 KB z §18.7
  (chunk wpisu `_` 41,3 KB gzip, w nim `Paywall.tsx` 25,2 KB i `i18n-paywall`
  6,9 KB po minifikacji; `paywallOffer` 1,23 KB, `paywallLinks` 0,78 KB).

| Klasa redukcji                        | Wynik przeglądu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Słowniki tylko z kluczami publicznymi | `i18n-paywall` (6,9 KB w chunku wpisu): każdy z kluczy (także 11 kluczy `offer.*` i 22 `meter.*` z S3) ma użycie w `Paywall.tsx`, `MeterBanner.tsx` albo `ClubAccessGate.tsx` - skrypt porównujący drzewo słownika z użyciami `t("paywall.…")` nie znalazł nieużywanego klucza. Kluczy panelu w słowniku publicznym nie ma.                                                                                                                                                                                                                                        |
| Martwy kod                            | Minifikowane chunki `paywallOffer` (2,3 KB surowo) i `paywallLinks` (1,5 KB) zawierają wyłącznie eksporty z importerami (sprawdzone w `.output/public/assets`); nieużywane eksporty (`paywallHitReason`, `isLoginIntent`, `LOGIN_INTENTS`, `loginHref` z `paywallLinks`) i niepodpięty mechanizm `newsletter_signup` (`footerTracking.ts`) usuwa tree-shaking - 0 B w bundlu.                                                                                                                                                                                      |
| Duplikaty                             | `paywallLinks` używa wspólnego `safeReturnPath`, oferta - wspólnych `fetchActivePlans`/`fetchMembershipTiers`/`fetchCurrentTier`/`fetchMyOrganization` i `isEnquiryOnlyPlan`, ceny - wspólnego `formatMoney`. Duplikaty importów (chunki-fasady `tiers`, `queries`, `membership`, osobna zaślepka `paywallHits.functions`) zdjęto już przy dokończeniu S3 (−1,4 KB, §18.7). Kopii do usunięcia nie ma.                                                                                                                                                             |
| Logika na serwer (oferta per persona) | Oszacowane na minifikacie: `resolvePaywallOffer` + `loadPaywallOffer` ≈ 1,5 KB surowo (ok. 0,7 KB gzip), zaślepka server fn ≈ 0,1-0,2 KB - zysk netto ok. 0,5-0,6 KB. Oferta zależy od warstwy i organizacji zalogowanego czytelnika, więc server fn wymaga sesji opcjonalnej (gość i konto w jednym wywołaniu); repo ma wyłącznie `requireSupabaseAuth` (generowany plik, odrzuca gościa), a podgląd S7 woła ofertę z personą. Nowa powierzchnia uwierzytelnienia za ok. 0,5 KB, przy której cel ≤ +1,2 KB i tak pozostaje nieosiągalny (+4,8 KB) - nie wykonano. |
| Formatowanie cen                      | Już wspólne (`formatMoney` - ten sam formatter co `/pricing` i kasa); przeniesienie na serwer nie usunęłoby go z `public` (używają go cennik i kasa).                                                                                                                                                                                                                                                                                                                                                                                                              |

Rozbicie przyrostu S3 bez zmian względem §18.7 (kod funkcji ok. +4,7 KB:
ściana wpisu +1,61, `paywallOffer` +1,23, `paywallLinks` +0,78, bramka klubu
+0,40, `app-initial` +0,20, `AuthPortal` +0,18, kasa +0,12, reszta +0,23;
entropia hashy ok. +0,7). **Akceptacja reszty: +5,4 KB `public` (cel karty
+1,2 KB, odchylenie +4,2 KB)**, próg zamrożony 2881 zielony. Testy S3 (P08,
P15, P17-P22, tryb `preview`) nietknięte - kod S3 bez zmian.

**B2. Z-S3-06 - snapshot autoryzacji: `admin_revenue_access_inventory` jako
„bramka” flagi `premium_content`.** Decyzja właściciela 2026-10-20, zgoda
delegowana: POTWIERDZONE - to raport inwentarza dla admina i redaktora (za
`is_admin_or_editor`), nie bramka czytelnika. Przegląd generatora
(`scripts/generate-authz-snapshot.ts`, `src/lib/ci/authzGates.ts`): mechanizmu
klasyfikacji ani adnotacji wpisów (raport, przegląd, wyjątek) nie ma - są
tylko listy aliasów rolowych (`ROLE_ALIAS_ANY`: `is_staff`, `is_super_admin`,
`can_publish_content`, `can_manage_profile_verification`; `ROLE_ALIAS_ALL`:
`assert_admin_tenant`). `is_admin_or_editor` aliasem nie jest, dlatego wpis
ma `bypassRoles: []`. Zgodnie z decyzją nowego mechanizmu nie budujemy: wpis
zostaje, przegląd odnotowany tutaj. Dowód odmowy: `hub_i9b_access_inventory_authz_test.sql`
(8 asercji) - anon bez EXECUTE (42501 przy wywołaniu), authenticated bez
sesji, czytelnik bez roli, konto z rolą `user`, autor i editor INNEGO
najemcy (profil w A, rola w B) dostają 42501; editor i admin najemcy - raport
z kompletem kluczy. `generate:authz-snapshot --check` ✓ (regeneracja tylko
licznika migracji 1292 → 1293).

**B3. Z-S3-07 - jedno okno porzucenia dla każdej kasy (plan, treść, bilet).**
Decyzja właściciela 2026-10-20, zgoda delegowana: AKCEPTACJA - jedna
definicja porzucenia w lejku i w ścieżce porzuconej kasy; szybsze zwolnienie
rezerwacji biletu przy krótszym oknie jest pożądane. Naturalne miejsce
istnieje: nagłówek karty biletów wydarzenia (`EventTicketsPanel`, Event
Builder → Bilety). `EventTicketCheckoutWindowNote` pokazuje pod opisem karty
jedną linię „Niezapłacona rezerwacja biletu wygasa po {{minutes}} min - to
wspólne okno porzucenia kasy dla planów, treści i biletów. Zmień w
ustawieniach kasy” (EN: „An unpaid ticket reservation expires after …”)
z linkiem do `/admin/paywall?tab=checkout`. Odczyt tym samym
`checkoutSettingsQueryOptions` (`checkoutKeys.settings()`) co karta kasy -
wspólny wpis cache, bez nowego zapytania o tę kolumnę; liczba ze wspólnego
`effectiveCheckoutAbandonMinutes` (wartość zapisana albo domyślne 1440), którego
używa też karta kasy. Linia jest informacyjna: w trakcie wczytywania i przy
błędzie odczytu jej nie ma. Dowód: `EventTicketCheckoutWindowNote.test.tsx`
(6: bieżące okno i link PL, domyślne 1440 bez wiersza, jedno zapytanie przy
wspólnym cache z kartą kasy, EN, błąd chowa linię, axe),
`EventTicketsPanel.test.tsx` (linia w nagłówku także przy pustej liście),
`CheckoutSettingsCard.abandon.test.tsx` (10, bez zmian zachowania).

**B4. Z-S2-01 - weryfikacja anulowania w trybie testowym Stripe.** W
kontenerze nie ma kluczy Stripe ani bazy podglądu - żywego testu nie
wykonano i nie jest raportowany jako wykonany. Scenariusz z instrukcji §16.5
zautomatyzowano testami na granicy SDK operatora (wzór: istniejące testy S2
przepływu retencji; dopisane wyłącznie brakujące asercje):

| Krok §16.5 | Pokrycie automatyczne (test → asercja)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3          | `webhookDispatchPriceSnapshot.test.ts` → „kwota sztuki i waluta (wielkie litery) z pierwszej pozycji”, „pusta lista rabatów = brak rabatu” (zapis `discount_minor_per_period` 0); **nowe** `hub_i9b_retention_scenario_test.sql` → „krok 3: kwota i waluta z migawki, rabat 0”, „krok 3: jeden ruch new (signup)”.                                                                                                                                                                                                                                                                                                                                                                                                                |
| 4          | `functions.test.ts` → „wstawia wiersz `started` bez powodu na tenancie SUBSKRYPCJI i zwraca ofertę”; `RetentionDialog.test.tsx` → „ankieta z ofertą: „Anuluj mimo to” jest na kroku 1 i anuluje jednym kliknięciem”; **nowe** `functions.stripeBoundary.test.ts` → „krok 4-5”.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5          | `applyOffer.test.ts` → kupon `percent_off` 30, `repeating`, `duration_in_months` 3, `max_redemptions` 1, **nowa** asercja nazwy „Retencja -30%”, klucz `retention-coupon:<flow>`, dopięcie z zachowaniem `di_existing` kluczem `retention:<flow>`; **nowe** `functions.stripeBoundary.test.ts` → „krok 4-5” (te same parametry przez `acceptRetentionOffer` z prawdziwym modułem rabatu, środowisko `sandbox` z wiersza, wiersz `saved`, `offer_accepted`, `coupon_code`), „krok 5: ponowienie … tymi samymi kluczami”; `webhookDispatchPriceSnapshot.test.ts` → „percent_off od ceny × ilość; repeating niesie koniec”; **nowe** pgTAP → „krok 5: rabat retencyjny = contraction z powodem discount”, „MRR po rabacie 27,30 zł”. |
| 6          | `checkoutSubscriptionOps.test.ts` → „anulowanie idzie NAJPIERW do operatora, z zachowaniem opłaconego okresu” (`cancel_at_period_end: true`, klucz idempotencji); `functions.test.ts` → „Z-09: brak powodu zapisuje `not_given` i BEZ id powodu”; `RetentionDialog.test.tsx` → „anulowanie bez powodu: canceled, feedbackId przepływu, powód null (Z-09)”; `notificationsPayload.server.test.ts` → „rezygnacja W TRAKCIE okresu: … CTA do planu” (`/profile/plan`); **nowe** `functions.stripeBoundary.test.ts` → „krok 6 i 8” (ponowne otwarcie po przyjęciu = nowy przepływ, `canceled` z `not_given`); **nowe** pgTAP → „krok 6: … NIE jest ruchem MRR”, „status_changed.v1 z cancel_at_period_end = true”.                    |
| 7          | `checkoutSubscriptionOps.test.ts` → „lokalne `canceled_at` wyzerowane, a operator wciąż ma zaplanowany koniec - wznowienie DZIAŁA” (`cancel_at_period_end: false`); **nowe** pgTAP → „krok 7: wznowienie - status_changed.v1 z cancel_at_period_end = false”, „krok 7: wznowienie bez ruchu MRR”.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 8          | `functions.test.ts` → „oferta przyjęta w ostatnich 180 dniach: brak oferty (already_redeemed)”, „DRUGA oferta w oknie 180 dni jest odrzucana”; `RetentionDialog.test.tsx` → „oferta wykorzystana w 180 dniach…”; **nowe** `functions.stripeBoundary.test.ts` → „krok 6 i 8” (drugiego kuponu brak: `coupons.create` 1 raz).                                                                                                                                                                                                                                                                                                                                                                                                       |
| 10         | `functions.test.ts` → „enabled=false: samo potwierdzenie”, „WYŁĄCZONA oferta nie dotyka operatora”; `RetentionDialog.test.tsx` → „retencja wyłączona: samo potwierdzenie - 1 kliknięcie anuluje”; **nowe** `functions.stripeBoundary.test.ts` → „krok 10” (operator nietknięty).                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Zostaje dla właściciela przy wdrożeniu (tryb testowy Stripe, baza podglądu):

1. Panel Stripe (test mode): subskrypcja ma kupon „Retencja -30%” obok
   wcześniejszych rabatów (krok 5, wizualnie).
2. Stripe → Developers → Logs: żądania z `Idempotency-Key`
   `retention-coupon:<feedback_id>` i `retention:<feedback_id>` (krok 5).
3. Portal klienta Stripe z powodami rezygnacji - wymaga Z-S2-11 (włączenie
   powodów w konfiguracji portalu); `retention_feedback` dostaje
   `stripe:<code>` (krok 9).

Kryterium „weryfikacja ręczna” (§16.10) zawęża się do tych trzech punktów.

**B5. Z-14-01 … Z-14-04 - benchmarki.**

- **Z-14-01, Z-14-02:** decyzja właściciela 2026-10-20, zgoda delegowana -
  AKCEPTACJA rekomendacji „zostawić” (P25 i liczby kont z Kiin Labs;
  kontekst „demo” dostępny do wyboru, nie domyślny). Zamknięte bez zmian.
- **Z-14-03 (`b-engr`, zaangażowanie GA4):** źródło danych jest - warstwa
  semantyczna BI liczy `engagement_rate` z GA4 Data API
  (`semantic/snapshot.functions.ts`, metryka GA4 `engagementRate`), więc
  zgodnie z decyzją dodano wpis rejestru `engagement_rate` (ER (GA4), grupa
  Lejek, `metricId: engagement_rate`, kontekst `engagement_rate.site_all` domyślny
  dla `all`): krytyczny < 25 · słaby 25–50 · normalny 50–55 · dobry 55–60 ·
  optymalny ≥ 60. Granice 50 i 55 - pakiet Insidera (`b-engr`, źródło 1352)
  i źródło pierwotne Siege Media (546 usług GA4, mediana 51%, odczyt ze strony
  2026-10-20); 25 i 60 - heurystyka oznaczona w nocie (połowa dolnej granicy
  normalnego; mediany kanałów wysokiej intencji 60,3-63,4% z tego samego
  badania). Teksty PL/EN, dźwignie, zastrzeżenia (branże, urządzenia, tryb
  zgody), pole `hub` rekordu `b-engr` (`kontekst_s6`) i liczności manifestu
  pakietu. Rejestr: 77 wpisów, 194 konteksty, 973 pasma, 174 źródła
  kanoniczne; `import-benchmarks.ts --check` ✓ (8 plików).
- **Z-14-04 (PPCR self-serve na źródle C):** przegląd 2026-10-20 - kontekst
  zostaje na SaasDash. Przejrzane: HockeyStack 2025-12-15 (80 firm B2B SaaS,
  31 mln odwiedzających; średnia 3,8%, jawna cena 2,8%, bez jawnej 4,6% -
  średnia bez kwartyli, licznik niezdefiniowany, liczy formularze, nie
  trial/zakup), ProductLed, ChartMogul 2026 i Lenny/OpenView/Pendo (inny
  wskaźnik: trial → płatny), Orbix, SaaSHero, Daydream, Kirro, shno.co
  (dostawcy i kompilacje bez metodologii). Szczegóły i adresy:
  `docs/BENCHMARKI_WSKAZNIKOW_2026-10-18.md`, „Uzupełnienie 2026-10-20”.

**B6. D-11 / Z-S6-14 - EN benchmarków i 76 zestawów dźwigni.** Decyzja
właściciela 2026-10-20, zgoda delegowana: AKCEPTACJA EN benchmarków i 76
zestawów dźwigni (stan z S6; nowy 77. wpis z B5 ma EN w tej samej
nakładce i przechodzi te same testy parytetu). Druga lektura EN szablonów
S5 była w S5 (14 szablonów PL/EN, słownik `adminJourneys` z testem parytetu);
akceptację obejmuje ta sama zgoda. Otwartych uwag redakcyjnych EN po S5
nie ma - w §20 ani w kodzie szablonów (`src/lib/journeys/templates/**`,
przegląd 2026-10-20: zero znaczników TODO/recenzji), więc szablonów nie
zmieniano.

**B7. Z-S5-02 - jeden limit tagu.** Decyzja właściciela 2026-10-20, zgoda
delegowana: JEDEN wspólny limit klient/serwer, odrzucanie za długich
wartości, nigdy przycinanie. `crm_leads.tags text[]` nie ma CHECK długości
elementu (sprawdzone na wszystkich migracjach), więc wygrywa kontrakt I0:
**64**. Wykonanie: migracja `20261020160800` (pisarz `run_workflow_step`
i walidator `journey_validate_graph` - `NOT BETWEEN 1 AND 64`, komunikat
„tag must have 1-64 characters”); w TS `CRM_TAG_MAX = 64` w
`src/lib/crm/lifecycle.ts` - czytają ją `JOURNEY_LIMITS.tagMax`,
`JOURNEY_TAG_MAX`, `WORKFLOW_TAG_MAX`, zod leadów (`UpdateInput`,
`BulkUpdateInput`), importu CRM, filtrów listy (`LeadListFilterSchema`,
`LeadFilterSchema`), warunku `has_tag`, akcji ścieżek i licznik w
`LeadFilterChips`; komunikaty PL/EN (`graphIssue.tag_length`, opis akcji
`add_tag`) podają 64. Testy S4 i S5 czytające SQL (`workflows.test.ts`,
`nodeTypesParity.test.ts`) wybierają teraz najnowszą definicję funkcji.
Dowód: `tagLimitParity.test.ts` (parytet z najnowszymi ciałami SQL, wartość
graniczna 64 ✓ / 65 ✗ w pięciu schematach, odstępy po `trim` jak `btrim`,
komunikaty PL/EN), `hub_i9b_crm_tag_limit_test.sql` (12: 64 zapisane, 65
odrzucone bez przycięcia, `btrim`, `remove_tag`, walidator 64 ✓ / 65 ✗ /
pusty ✗, ACL), `workflow_actions_v2_test.sql` (65 odrzucone),
`LeadFilterChipsHub.test.tsx`, `leadViews.test.ts`, `graph.test.ts`.

### 22.3 Zmiany integratorskie i pliki współdzielone

- `src/lib/ci/hubDelivery.ts` + `hubDelivery.gate.test.ts` (współdzielone,
  bramka dostawy): dwie redefinicje w `HUB_I9_REDEFINITIONS`; reguła - dla
  redefinicji w rezerwie I9 znacznik `CIALO-Z` porównuje się z najnowszą
  definicją w hubie (dla funkcji sprzed huba bez redefinicji w hubie -
  z najnowszą sprzed huba), a nie z `HUB_CIALO_Z` (opis pierwszej redefinicji
  w wycinku właściciela); fikstura „funkcja sprzed huba po redefinicji
  w wycinku”; manifest I9 += pliki części B z komentarzem „Integrator I9b,
  część B”.
- `src/lib/authz/authzSnapshot.generated.ts` (współdzielony): regeneracja -
  wyłącznie licznik migracji 1292 → 1293.
- Testy i moduły innych wycinków (w manifeście I9): `workflow_actions_v2_test.sql`,
  `workflows.test.ts`, `nodeTypesParity.test.ts`, `graph.test.ts` (S4/S5 -
  limit tagu), `EventTicketsPanel{,Studio}.test.tsx` (atrapa nowej linii),
  `CheckoutSettingsCard.tsx` i `src/lib/revenue/limits.ts` (wspólny helper
  okna), rejestr S6 (`docs/benchmarki/**`, wygenerowane moduły, testy
  liczności 76 → 77).
- NIE zmienione: bliźniaki drizzle i `_journal.json` (krok C),
  `src/integrations/supabase/types.ts` (brak zmian schematu),
  `supabase/migration-ledger.json`, migracje części A i A2.

### 22.4 Pomiar bundla

Baza `d7efcba5` zbudowana w osobnym worktree tym samym hostem i tymi samymi
`node_modules`; przypisanie: gzip -9 per chunk z `.output/public/assets`
(nazwa bez hasha) i inwentarz modułów (`reports/chunk-inventory.json`).

| Budżet (gzip KB)         | Próg         | Baza `d7efcba5` | Po części B | Δ    | Wynik                                                                   |
| ------------------------ | ------------ | --------------- | ----------- | ---- | ----------------------------------------------------------------------- |
| `overall`                | 5003         | 5003,0          | **5003,2**  | +0,2 | ✗ o 0,2 KB - baza stoi na progu (zapas 0,0); ratchet D-08 - Z-I9b-16    |
| `admin-only`             | -            | 2225,0          | 2225,3      | +0,3 | linia okna kasy przy biletach (rozbicie niżej)                          |
| `public`                 | 2881 (zamr.) | 2778,0          | 2777,9      | -0,1 | ✓ (entropia hashy)                                                      |
| największy chunk (entry) | 286 (zamr.)  | 257,8           | 257,9       | +0,1 | ✓                                                                       |
| `css`                    | 100          | 99,7            | 99,7        | 0,0  | ✓                                                                       |
| `publicCss`              | 85 (zamr.)   | 83,8            | 83,8        | 0,0  | ✓                                                                       |
| `boot`                   | 579 (zamr.)  | 471,6           | 471,6       | 0,0  | ✓                                                                       |
| liczba chunków           | -            | 1456            | 1456        | 0    | `check:chunks` ✓, `check:entry-purity` ✓, `check:server-entry-purity` ✓ |

Rozbicie przyrostu (+313 B gzip, w całości panel): `EventStudioModuleSections`
+190 B (`EventTicketCheckoutWindowNote` 0,85 KB surowo i montaż w
`EventTicketsPanel` +0,1 KB), `i18n-admin-event-registration` +149 B (dwa
napisy PL/EN), `limits` +13 B (`effectiveCheckoutAbandonMinutes`); wpis
`engagement_rate` w lekkim indeksie benchmarków i `CRM_TAG_MAX` - w granicach
entropii hashy (783 chunki o |Δ| ≤ 20 B, razem −79 B). Ratchet D-08 `overall`
nie jest wykonany w części B: próba podniesienia progu w
`scripts/check-bundle-size.ts` została odrzucona przez system uprawnień jako
obejście CI i wycofana - podniesienie należy do orkiestratora przy scaleniu
(D-08, §11.6), propozycja: 5003 → 5005 (konwencja kroniki: pomiar 5003,2 →
5004 → +1).

### 22.5 Weryfikacja (I9b, część B)

Worktree `/home/user/wt/I9B`, kroki ciężkie po kolei (pamięć 16 GB); pełny
pakiet vitest - CI.

| Polecenie                                                                                                                                                                                                                                | Wynik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bunx prettier --check` (zmienione pliki)                                                                                                                                                                                                | ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `bun run verify:static`                                                                                                                                                                                                                  | `format:check` ✓, `check:client-ip-source` ✓, `check:dangerous-html` ✓; `check:migration-lanes` ✗ wyłącznie `[brak-kopii-drizzle] 20261020160800_crm_tag_limit_shared.sql` (krok C, Z-I9b-12); pozostałe bramki zestawu uruchomione osobno - ✓: `module-singletons`, `on-conflict-arbiters`, `public-assets`, `rpc-contract`, `sql-anon-insert`, `sql-app-role`, `sql-definer-views`, `sql-migration-replay`, `sql-owner-tenant-scope`, `sql-policy-tenant-regression`, `sql-tenant-scope`, `structured-data-live`, `ts-sql-contract`, `types-freshness` |
| `GOMEMLIMIT=11GiB GOGC=50 bunx tsgo --noEmit --checkers 1`, `typecheck:scripts`, `typecheck:e2e`                                                                                                                                         | ✓ 0 błędów                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `tsgo --noEmit` z domyślnymi checkerami, zawężony (`tsconfig.i9b.tmp.json`: `src/**/*.d.ts`, `routeTree.gen.ts`, `vitest.setup.ts` z bazowego `include` i 37 zmienionych plików TS)                                                      | ✓ 0 błędów (bez `vitest.setup.ts` zawężenie gubiło typy `jest-dom` także w nietkniętych asercjach - artefakt konfiguracji, nie błąd)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `bunx eslint` (zmienione pliki)                                                                                                                                                                                                          | ✓ 0 błędów, 0 ostrzeżeń                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `TZ=UTC bunx vitest run --maxWorkers=3` - `src/lib/{crm,journeys,admin,revenue,retention,ci,authz}`, `src/components/admin/{crm,events,paywall}`, `src/hooks`, `src/__tests__`                                                           | ✓ 411 plików, 10 637 testów; wyłącznie `supabaseLaneCoverage` (2 asercje: brak bliźniaka `20261020160800` - krok C)                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `TZ=UTC bunx vitest run --maxWorkers=3` - `src/lib/analytics`, `src/components/admin/{analytics,workflows,journeys,revenue}`, `src/lib/charts`, 34 testy tras (paywall, wydarzenia, CRM, przepisy, ścieżki, monetyzacja, hub, analityka) | ✓ 187 plików, 4755 testów                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `import-benchmarks.ts docs/benchmarki/2026-10-18 --check`                                                                                                                                                                                | ✓ 8 plików zgodnych (77 wpisów, 194 konteksty, 973 pasma)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| pgTAP `run.sh all` (świeży schemat) + `run.sh test 'hub_i9b\|workflow_actions\|journeys_\|revenue_funnel\|retention_flow\|revenue_subscription\|cohesion_layer\|hub_shared\|ts_sql_contract'`                                            | ✓ 22 pliki (w tym 3 nowe: 28 asercji; `workflow_actions_v2` 29 z granicą 65); migracje - wyłącznie znany błąd `20260825230232`                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `scripts/split-migration.ts --dry-run`                                                                                                                                                                                                   | ✓ `20261020160800` w limicie (28,9 KB)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `scripts/hub-slice-guard.ts I9 --base origin/claude/elegant-fermat-xwfca1`                                                                                                                                                               | ✓ 48 plików w manifeście I9; dostawa huba: 1 plik w bloku I9, 2 definicje funkcji                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `generate:authz-snapshot --check`                                                                                                                                                                                                        | ✓ (po regeneracji licznika migracji)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `flock -o /tmp/hub-build.lock env BUNDLE_INVENTORY=1 bun run build` + `check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity`                                                                                  | build ✓; `check:bundle` ✗ wyłącznie `overall` 5003,2 > 5003 (baza 5003,0 - §22.4, Z-I9b-16); `public` 2777,9 / 2881, chunk 257,9 / 286, `css` 99,7 / 100, `publicCss` 83,8 / 85, `boot` 471,6 / 579 ✓; `check:chunks` ✓ (1456 chunków, acykliczny), `check:entry-purity` ✓, `check:server-entry-purity` ✓                                                                                                                                                                                                                                                |

### 22.6 Wdrożenie (właściciel)

Migracja `20261020160800` po S4 (`2026102013*`) i S5 (`2026102014*`) oraz po
bliźniaku z kroku C; same `CREATE OR REPLACE FUNCTION` (bez DDL tabel,
bez blokad gorących tabel), idempotentna. Kontrola po wdrożeniu (tylko
odczyt):

```sql
-- Jeden limit tagu: oba ciała mają 64, żadne 40.
SELECT p.proname,
       pg_get_functiondef(p.oid) LIKE '%NOT BETWEEN 1 AND 64%' AS has_64,
       pg_get_functiondef(p.oid) LIKE '%NOT BETWEEN 1 AND 40%' AS has_40
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('run_workflow_step', 'journey_validate_graph');
```

Wycofanie: nowa migracja z ciałami z `20261020130200` i `20261020140200`
(limit 40) razem z `CRM_TAG_MAX = 40` - tagi 41-64 zapisane w międzyczasie
zostają poprawne w bazie, ale przepisy i ścieżki nie zdejmą ich krokiem.
Front: linia okna przy biletach i wpis `engagement_rate` nie mają stanu
w bazie.

### 22.7 Zgłoszenia otwarte

| ID       | Zgłoszenie                                                                                                                                                                                                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Z-I9b-12 | Bliźniak drizzle `20261020160800_crm_tag_limit_shared` (następny wolny numer `0366`) i wpis `_journal.json` - krok C (`check:migration-lanes`, `supabaseLaneCoverage`).                                                                                                                                                                                 |
| Z-I9b-13 | Z-S2-01: trzy kroki wizualne w trybie testowym Stripe (panel, logi, portal z powodami - po Z-S2-11) przy wdrożeniu S2 (§22.2 B4).                                                                                                                                                                                                                       |
| Z-I9b-14 | Snapshot autoryzacji nie rozwija `is_admin_or_editor` (nie jest w `ROLE_ALIAS_ANY`), więc raporty personelu z odczytem flag warstw mają `bypassRoles: []` - opcjonalnie: alias w generatorze (zmienia snapshot wielu funkcji; decyzja poza I9b).                                                                                                        |
| Z-I9b-15 | Import CSV leadów: tag dłuższy niż 64 znaki odrzuca cały import walidatorem serwera (jak dotąd przy 40) - opcjonalnie: komunikat w dialogu importu przed wysłaniem.                                                                                                                                                                                     |
| Z-I9b-16 | Budżet `overall`: 5003,2 > 5003 po części B (+313 B, linia okna kasy przy biletach - Z-S3-07); baza `d7efcba5` stoi na progu (5003,0). Ratchet D-08 do wykonania przez orkiestratora przy scaleniu (propozycja 5003 → 5005, wpis kroniki w `scripts/check-bundle-size.ts` z rozbiciem §22.4) - podniesienie progu w części B odrzucił system uprawnień. |
