# Rozpoznanie: silnik ścieżek komunikacji, e-mail, CRM, SQL/CI, BI, wydarzenia i kluby

**Data:** 2026-10-18 · **Zakres:** stan obecny (bez zmian w kodzie), materiał wejściowy do projektu modułu „Przychód i lejek” i silnika ścieżek w stylu HubSpot.

Każdy obszar badał niezależny agent, czytając kod, migracje, testy i tłumaczenia. Fakty mają dowody `ścieżka:linia`. Przy każdym obszarze są: elementy do reużycia, twarde ograniczenia (reguły i bramki CI) oraz braki.

## 1. Silnik automatyzacji (workflows)

#### Silnik automatyzacji (workflows): rozpoznanie pod ścieżki w stylu HubSpot

##### Werdykt

Silnik działa **synchronicznie i bez stanu**. Uruchamia go trigger `AFTER INSERT` na `domain_events`: wszystkie kroki definicji wykonują się od razu, w transakcji zapisu źródłowego, a wynik to jeden wiersz `workflow_runs` z polem `succeeded|failed`. Silnik nie ma czekania, rozgałęzień, stanu per kontakt, harmonogramu, ponowień ani logu per krok. Dlatego **nie da się go „rozciągnąć” na ścieżki bez przebudowy**. Rekomendacja: **osobne tabele `journey_*`**. Ścieżki powinny reużywać szynę `domain_events`, katalog akcji `run_workflow_step`, wzorzec kolejki `claim_*` (SKIP LOCKED) z outboxu integracji, harmonogram `runJobsTick` (pg_cron co minutę) oraz `enqueueRawEmail` do maili. Nowe akcje (etap CRM, newsletter, e-mail) trafiają do wspólnego katalogu, więc korzystają z nich i przepisy, i ścieżki.

---

##### 1. Mapa plików

| Warstwa                                       | Plik                                                                                                                                                                                                                       | Rola                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Migracja bazowa                               | `supabase/migrations/20260711204000_workflow_engine.sql`                                                                                                                                                                   | tabele, `run_workflow_step`, trigger silnika, `install_workflow_template`, katalog 4 szablonów, trigger na `tenants` |
| Duplikat Lovable                              | `supabase/migrations/20260711221058_9dbe5dcf-….sql:1-386`                                                                                                                                                                  | ta sama treść, bez komentarzy (idempotentna)                                                                         |
| Akcja `create_crm_task` i 2 szablony retencji | `supabase/migrations/20260723140000_subscription_retention_crm_bridge.sql:28-258`                                                                                                                                          |                                                                                                                      |
| Zaostrzenie RLS                               | `supabase/migrations/20260824074231_4a952090-….sql:141-155`                                                                                                                                                                | `is_staff()` zamienione na `is_admin_or_editor()`                                                                    |
| **Aktualne ciało** `run_workflow_step`        | `supabase/migrations/20261007140700_runtime_errors_seats_workflow_passwords.sql:62-240`                                                                                                                                    | poprawka `notify_followers` (`uuid = text`, linia 140), `search_path 'public','pg_temp'` (66)                        |
| ACL `enqueue_notification`                    | `supabase/migrations/20260803090000_harden_enqueue_notification_acl.sql:22-28`                                                                                                                                             | wywołanie tylko z SECURITY DEFINER lub service_role                                                                  |
| Szyna zdarzeń                                 | `supabase/migrations/20260711200000_domain_event_bus.sql`                                                                                                                                                                  | `domain_events`, `emit_domain_event`, `request_correlation_id`, `get_correlated_events`, emitery, prune              |
| Emiter (finalna sygnatura)                    | `supabase/migrations/20260808190000_discussion_clubs_a17_event_actor_order.sql:35-93`                                                                                                                                      | jedna funkcja, 7 argumentów                                                                                          |
| Redakcja PII z payloadu                       | `supabase/migrations/20260729123407_0b0c7e18-….sql:7-39`                                                                                                                                                                   | trigger BEFORE usuwa m.in. `email` (linia 15)                                                                        |
| Typ zdarzenia z wieloma członami              | `supabase/migrations/20260828205000_domain_events_multi_segment_type.sql:72-74`                                                                                                                                            |                                                                                                                      |
| Outbox integracji (wzorzec kolejki)           | `supabase/migrations/20260711203000_idempotency_and_integration_outbox.sql`                                                                                                                                                |                                                                                                                      |
| Route                                         | `src/routes/admin.workflows.tsx` (301 linii)                                                                                                                                                                               |                                                                                                                      |
| Komponenty                                    | `src/components/admin/workflows/{WorkflowDefinitionsPanel,WorkflowEditorDialog,WorkflowRunsPanel,WorkflowTemplatesPanel,CorrelationTracePanel,atoms}.tsx`, `useActionName.ts`, `lib/{editorDraft,panelRules,runStatus}.ts` |                                                                                                                      |
| Warstwa danych                                | `src/lib/admin/workflows.ts` (533 linie)                                                                                                                                                                                   |                                                                                                                      |
| i18n                                          | `src/lib/i18n-admin-workflows.ts` (389 linii)                                                                                                                                                                              |                                                                                                                      |
| Katalog zdarzeń TS                            | `src/lib/realtime/domainEvents.ts:10-…` (`DOMAIN_EVENT_TYPES`)                                                                                                                                                             |                                                                                                                      |

##### 2. Schemat tabel

| Tabela                 | Kolumny                                                                                                                            | Ograniczenia i indeksy                                                                                                                                                                                                    | Dowód                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `workflow_definitions` | `id, tenant_id, name, template_key, enabled, trigger_event_type, condition jsonb, steps jsonb, created_by, created_at, updated_at` | CHECK: nazwa niepusta, `steps` jako tablica, `condition` jako obiekt; `idx_workflow_definitions_trigger (tenant_id, trigger_event_type) WHERE enabled`; UNIQUE `(tenant_id, template_key) WHERE template_key IS NOT NULL` | `20260711204000:29-49`                 |
| `workflow_runs`        | `id, tenant_id, workflow_id, event_id, event_type, correlation_id, status, error, steps_completed, created_at`                     | `status IN ('succeeded','failed')` (58); brak UNIQUE `(workflow_id, event_id)`; indeksy `(workflow_id, created_at DESC)` i `correlation_id`                                                                               | `20260711204000:51-67`                 |
| `workflow_templates`   | `key PK, name_pl/en, description_pl/en, trigger_event_type, condition, steps, created_at`                                          | katalog globalny, bez `tenant_id`                                                                                                                                                                                         | `20260711204000:69-79`                 |
| `domain_events`        | `id, tenant_id, aggregate_type, aggregate_id text, event_type, payload, correlation_id, actor_id, created_at`                      | 4 indeksy; realtime; retencja 90 dni (cron `prune-domain-events` o 3:20)                                                                                                                                                  | `20260711200000:24-45, 64-68, 393-420` |

`updated_at` definicji ustawia klient (`src/lib/admin/workflows.ts:433,462`). W bazie nie ma do tego triggera.

##### 3. Jak definicja jest wyzwalana

- **Trigger** `trg_run_workflows_for_event`: `AFTER INSERT ON domain_events FOR EACH ROW`, funkcja `tg_run_workflows_for_event()` (SECURITY DEFINER), `20260711204000:252-309`.
  - Ogranicznik głębokości `pg_trigger_depth() > 8` (263).
  - Pętla po definicjach: ten sam tenant, `enabled`, równy `trigger_event_type`, kolejność `created_at ASC` (267-273).
  - Filtr: `NEW.payload @> v_def.condition`, czyli containment jsonb z rozróżnianiem typów (274).
  - Każda definicja działa w bloku `BEGIN…EXCEPTION` (savepoint). Po wyjątku silnik zapisuje `failed` z `left(SQLERRM,500)` i przechodzi do następnej definicji (278-297).
  - Zewnętrzne `EXCEPTION WHEN OTHERS THEN RETURN NEW` (301-302) połyka każdą awarię silnika bez śladu.
- **Nie ma crona ani kolejki dla workflowów.** Wszystko dzieje się w transakcji zapisu biznesowego, więc koszt kroków dolicza się do latencji zapisu.
- Zdarzenia produkuje wyłącznie `emit_domain_event(p_tenant_id, p_aggregate_type, p_aggregate_id, p_event_type, p_payload, p_actor_id, p_suppress_actor)` (`20260808190000:35-73`). Emiter połyka błędy (70-72). REVOKE od klientów, GRANT dla service_role (75-80).
- Payload jest **redagowany przed zapisem**: trigger `domain_events_redact_payload_trg` usuwa `email, phone, ip, token, address, body, note…` (`20260729123407:13-39`). Trigger silnika widzi już payload **bez e-maila**.
- Nazwa zdarzenia musi pasować do `^[a-z0-9_]+(\.[a-z0-9_]+)+\.v[0-9]+$` (`20260828205000:72-74`).

##### 4. `run_workflow_step(p_event domain_events, p_step jsonb)`: zamknięty CASE akcji

Ostatnie ciało: `20261007140700:62-240`. Nieznana akcja kończy się `RAISE EXCEPTION 'workflow: unknown action %'` (237). Wspólne podstawienia `{aggregate_id}` w `title_pl/en` i `href` oraz `{post_href}` dla agregatu `post` (84-97). Pomocnik `workflow_param_text(payload, params, fixed_key, from_key)`: najpierw stała wartość z parametru, potem klucz payloadu (`20260711204000:111-121`).

| Akcja                 | Parametry (lustro TS: `src/lib/admin/workflows.ts:66-100`)                   | Efekt                                                                                                                                                          | Dedup                                                   | Dowód                                            |
| --------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------ |
| `notify_user`         | `user_id` / `user_from`, `title_pl/en`, `href`, `icon`, `kind`               | `enqueue_notification`                                                                                                                                         | dedup samej funkcji: `(user, kind, href)` w oknie 5 min | `20261007140700:100-109`; `20260803090000:31-40` |
| `notify_staff`        | `roles` (domyślnie admin, editor) i powyższe                                 | pętla po `user_roles` JOIN `profiles` w tenancie                                                                                                               | jw.                                                     | `:111-129`                                       |
| `notify_followers`    | `author_from` (domyślnie `author_id`)                                        | `user_follows` z `target_type='author'`                                                                                                                        | jw.                                                     | `:131-149`                                       |
| `create_crm_lead`     | `email_from`, `first_name_from`, `last_name_from`, `newsletter`, `marketing` | `crm_upsert_lead(...)`, który przy pustym e-mailu **zwraca NULL bez błędu** (`20260630060254_…:43`)                                                            | merge po `email_norm`/telefonie                         | `:151-160`                                       |
| `create_crm_task`     | `title`, `note`, `due_days` (domyślnie 3), `user_from`, `email_from`         | ustala e-mail: payload, a gdy go brak, `profiles.email`/`contact_email` po `user_id`; potem `crm_upsert_lead`, potem `crm_tasks` (assignee = właściciel leada) | jedno OTWARTE zadanie o tym tytule per lead             | `:162-220`                                       |
| `add_cross_reference` | `target_id` / `target_id_from`, `target_type`, `relation`                    | `add_cross_reference(...)`                                                                                                                                     | po stronie funkcji grafu                                | `:222-234`                                       |

ACL: `REVOKE … FROM PUBLIC, anon, authenticated; GRANT … TO service_role` (`20260711204000:244-246`, `20260723140000:209-211`).

##### 5. Retry, idempotencja, korelacja

| Aspekt                 | Stan                                                                                                                                                                                                                                                                                                                                                                                                   | Dowód                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Retry                  | **brak**: `failed` jest stanem końcowym, nie ma RPC do ponownego przebiegu ani backoffu                                                                                                                                                                                                                                                                                                                | `20260711204000:290-297`                                       |
| Idempotencja przebiegu | brak UNIQUE `(workflow_id, event_id)`. Ochrona wynika tylko z tego, że trigger odpala raz na wiersz zdarzenia. Ten sam fakt biznesowy wyemitowany 2× (np. `subscription.updated.v1`) daje 2 przebiegi                                                                                                                                                                                                  | `:64-67`; komentarz `20260723140000:5-7,171-172`               |
| Idempotencja kroków    | dedup tylko ad hoc w akcjach (`create_crm_task` po tytule, notyfikacje po oknie 5 min)                                                                                                                                                                                                                                                                                                                 | jw.                                                            |
| Atomowość              | blok z savepointem cofa **efekty** kroków wykonanych przed błędem, ale `steps_completed` zapisuje ich liczbę, więc licznik wprowadza w błąd                                                                                                                                                                                                                                                            | `:277-297`                                                     |
| Pętle                  | komentarz mówi „bez akcji emitującej zdarzenia, zero ryzyka pętli” (10-11). W praktyce `create_crm_lead`/`create_crm_task` wstawiają do `crm_leads`/`crm_tasks`, a te emitują `crm_lead.created.v1`/`crm_task.created.v1`, co odpala zagnieżdżone workflowy. Hamulcem jest tylko głębokość 8                                                                                                           | `:10-11, 263`                                                  |
| Korelacja              | `workflow_runs.correlation_id = NEW.correlation_id`. Źródłem jest `request_correlation_id()`, który czyta wyłącznie nagłówek PostgREST `x-correlation-id` (`20260711200000:75-91`). Nagłówek dokleja tylko przeglądarka w `runWithCorrelation` (`src/integrations/supabase/correlation-fetch.ts:12-28`). Webhooki, cron i `supabaseAdmin` dają **NULL**, więc takie przebiegi są niewidoczne w śladzie |                                                                |
| Ślad                   | `get_correlated_events(uuid)` (SECURITY INVOKER, RLS) oraz `fetchCorrelationTrace`: zdarzenia, przebiegi, `integration_deliveries`                                                                                                                                                                                                                                                                     | `20260711200000:140-151`; `src/lib/admin/workflows.ts:500-533` |

##### 6. RLS i granty

| Obiekt                             | Polityka / grant                                                                                                                                            | Dowód                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `workflow_definitions`             | `FOR ALL TO authenticated USING/WITH CHECK (tenant_id = current_tenant_id() AND is_admin_or_editor())`; GRANT SELECT/INSERT/UPDATE/DELETE dla authenticated | `20260824074231:141-145`; `20260711204000:81` |
| `workflow_runs`                    | SELECT: tenant i admin/editor; zapisuje tylko silnik (definer)                                                                                              | `20260824074231:147-150`                      |
| `workflow_templates`               | SELECT: `is_admin_or_editor()` (bez tenanta, katalog globalny)                                                                                              | `20260824074231:152-155`                      |
| `install_workflow_template(p_key)` | SECURITY DEFINER; bramka `current_tenant_id() IS NOT NULL AND is_staff()`; GRANT dla authenticated                                                          | `20260711204000:314-346`                      |
| `domain_events`                    | SELECT: staff tenanta albo aktor zdarzenia; INSERT tylko przez definer                                                                                      | `20260711200000:47-60`                        |

**Rozjazd:** `is_staff()` obejmuje rolę `author` (`20260628230000_tenant_isolation_and_authz.sql:49-51`). RPC instalacji przepuszcza więc autora, choć RLS definicji już go odcina. Autor może przez RPC zainstalować szablon albo **ponownie włączyć** wyłączony przepis (`ON CONFLICT … DO UPDATE SET enabled = true`, `20260711204000:338-339`).

##### 7. Instalacja i katalog szablonów

`install_workflow_template` tworzy definicję w tenancie wołającego. Przy konflikcie `(tenant_id, template_key)` włącza ją ponownie, nie nadpisując kroków (`:332-340`). Backfill wszystkich tenantów (`:407-414`, `20260723140000:250-258`) i trigger `trg_tenants_install_workflow_templates` dla nowych tenantów (`:416-438`) instalują wszystkie szablony automatycznie.

| key                                      | wyzwalacz                            | warunek                     | kroki                              | dowód                    |
| ---------------------------------------- | ------------------------------------ | --------------------------- | ---------------------------------- | ------------------------ |
| `newsletter-confirmed-to-crm`            | `newsletter_subscriber.confirmed.v1` | `{}`                        | `create_crm_lead{newsletter:true}` | `20260711204000:355-364` |
| `post-published-notify-followers`        | `post.published.v1`                  | `{}`                        | `notify_followers`                 | `:365-374`               |
| `crm-lead-won-notify-staff`              | `crm_lead.stage_changed.v1`          | `{"new_stage":"won"}`       | `notify_staff`                     | `:375-384`               |
| `comment-pending-notify-staff`           | `comment.created.v1`                 | `{"status":"pending"}`      | `notify_staff`                     | `:385-394`               |
| `subscription-cancel-scheduled-crm-task` | `subscription.updated.v1`            | `{"cancel_scheduled":true}` | `create_crm_task` + `notify_staff` | `20260723140000:221-230` |
| `subscription-canceled-crm-task`         | `subscription.status_changed.v1`     | `{"new_status":"canceled"}` | `create_crm_task` (win-back)       | `:231-240`               |

##### 8. UI (`/admin/workflows`)

- Zakładki `definitions | templates | runs | trace` w search params: `tab`, `correlation` (uuid), `workflow` (uuid) (`src/routes/admin.workflows.tsx:40-71`). KPI liczone z okna 500 ostatnich przebiegów (`:50, 156-164`).
- Edytor (`WorkflowEditorDialog.tsx`) to formularz liniowy: wyzwalacz z `DOMAIN_EVENT_TYPES` albo „inny typ”, pary warunku (containment), lista kroków ze strzałkami góra/dół. Pola kroków generuje `WORKFLOW_ACTION_PARAMS` (`:297-414`). Nie ma grafu, rozgałęzień ani czekania.
- Czyste reguły wydzielone do testów: `lib/editorDraft.ts`, `lib/panelRules.ts`, `lib/runStatus.ts` (lustro CHECK-ów `workflow_runs` i `integration_deliveries`).
- Atomy: `RunStatusBadge`, `EventTypeChip`, `DateTimeText`, `StepChips` (`atoms.tsx`).
- Nawigacja: grupa CRM, `src/lib/admin/adminNav.ts:330`.
- Head trasy jest wpisany ręcznie (`admin.workflows.tsx:62-64`) zamiast przez `adminPageHead` (`src/lib/adminPageHead.ts`), czego wymaga AGENTS.md.

##### 9. Testy

| Plik                                                                           | Zakres                                                                                                                                        |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/tests/cohesion_layer_test.sql:144-182`                               | newsletter confirmed: lead w CRM i przebieg `succeeded`; lead `won`: notyfikacja admina                                                       |
| `supabase/tests/sql_runtime_errors_test.sql`                                   | nagłówek powołuje się na poprawkę `notify_followers`, ale **żadna asercja jej nie wykonuje** (sekcje 1-14: seats, CRM klubu, hasła, widownia) |
| `supabase/tests/plpgsql_check_gate_test.sql`                                   | statyczna bramka każdej funkcji plpgsql w `public` (także triggerowych)                                                                       |
| `src/lib/admin/__tests__/workflows.test.ts` (641)                              | parsowanie/serializacja kroków, warunki, walidacja, parytet i18n akcji i parametrów (`:262-300`)                                              |
| `src/lib/admin/__tests__/workflowsData.test.ts` (510)                          | warstwa PostgREST przez `@/test/supabaseChain` (pin `tenant_id`, `fetchCorrelationTrace`)                                                     |
| `src/components/admin/workflows/__tests__/*` (7 plików), `lib/__tests__/*` (3) | panele, edytor, reguły                                                                                                                        |
| `src/routes/__tests__/adminWorkflowsRoute.test.tsx` (514)                      | trasa                                                                                                                                         |

Brak testów pgTAP dla `create_crm_task`, szablonów retencji, `install_workflow_template` (bramka roli) i izolacji tenantów w tabelach `workflow_*`.

##### 10. Znalezione defekty i rozjazdy

1. **Szablon `newsletter-confirmed-to-crm` po cichu nic nie robi.** Redakcja usuwa `payload.email` (`20260729123407:15`). `crm_upsert_lead` dostaje NULL i zwraca NULL (`20260630060254:43`). Przebieg i tak zapisuje się jako `succeeded`. Test spójności przechodzi tylko dlatego, że lead zakłada niezależny trigger `trg_newsletter_to_lead` (`20260630053403:275-276`): **fałszywie zielony**.
2. **Wzorzec typu zdarzenia w TS jest dwuczłonowy** (`src/lib/admin/workflows.ts:266`), a baza dopuszcza wiele członów (`20260828205000:74`). Edytor oferuje w liście `event.registration.created.v1` (`src/lib/realtime/domainEvents.ts:112`) i inne, ale walidacja (`workflows.ts:315`) blokuje zapis.
3. W przebiegu `failed` `steps_completed` liczy kroki, których efekty savepoint już cofnął (`20260711204000:277-297`).
4. Bramka `install_workflow_template` (`is_staff`, z autorem) jest luźniejsza niż RLS (`is_admin_or_editor`).
5. Awaria całego silnika ginie bez śladu (`:301-302`), a przebiegi z serwera mają `correlation_id = NULL`.
6. W katalogu TS brakuje typów emitowanych w SQL: `crm_lead.pushed.v1`, `event_sponsor.unpublished.v1`. Wybrać je można tylko jako „inny typ”.

##### 11. Ocena: czy rozszerzać `workflow_definitions`, czy budować osobne `journeys`

| Wymóg ścieżki (HubSpot)      | Rozszerzenie obecnego silnika                                                                                                    | Osobne `journey_*` z reużyciem akcji                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Czekanie X                   | wymaga zatrzymania przebiegu w środku, a trigger jest synchroniczny; potrzebny byłby stan i harmonogram, czyli i tak nowa tabela | `journey_enrollments.next_run_at` plus claim SKIP LOCKED w `runJobsTick`                                                                                  |
| Split A/B, if/then           | `steps` to płaska tablica, UI i parser (`parseWorkflowSteps`) zakładają listę                                                    | graf węzłów w jsonb (`nodes`, `edges`, `branch`), wariant deterministycznie z hasha `enrollment_id`                                                       |
| Stan per kontakt             | brak klucza kontaktu; `workflow_runs` jest per zdarzenie                                                                         | `journey_enrollments (journey_id, contact_key/crm_lead_id, status, current_node, context, trigger_event snapshot, correlation_id)` z UNIQUE dla aktywnych |
| Cele i wyjście               | brak                                                                                                                             | pola `goal`/`exit` na definicji, dopasowywane tym samym triggerem na `domain_events`                                                                      |
| Log per krok, retry          | `status` ma CHECK na 2 wartości, mapowane w `runStatus.ts`                                                                       | `journey_step_runs` z idempotencją `(enrollment_id, node_id)`, backoffem i stanem `dead` na wzór `finish_integration_delivery` (`20260711203000:259-284`) |
| Wpływ na istniejące przepisy | ryzyko regresji 6 szablonów, testów i UI                                                                                         | zero; przepisy działają dalej                                                                                                                             |

**Rekomendacja: osobne tabele**, przy maksymalnym reużyciu:

- **Wyzwalacz:** drugi `AFTER INSERT` na `domain_events` (np. `tg_enroll_journeys_for_event`) w stylu `tg_run_workflows_for_event`, z `EXCEPTION`, ogranicznikiem głębokości i dopasowaniem `payload @> condition`. Robi tylko tani INSERT zapisu do ścieżki, bez wykonywania kroków.
- **Snapshot zdarzenia** w zapisie do ścieżki, bo `domain_events` ma retencję 90 dni. Akcje SQL można wołać istniejącym `run_workflow_step(jsonb_populate_record(NULL::public.domain_events, snapshot), step)` bez zmiany sygnatury i ACL.
- **Nowe akcje** dopisane do CASE `run_workflow_step` (pełna kopia ciała z `20261007140700:62-240`), żeby korzystały z nich też przepisy: `set_crm_stage` (enum `crm_stage`: new, contacted, qualified, proposal, won, lost, archived, `20260630053403:4`), `newsletter_subscribe`/`unsubscribe`. Tabel list lub segmentów newslettera **nie ma**.
- **Wykonawca:** SQL `claim_due_journey_enrollments(p_limit)` (SKIP LOCKED, jak `claim_integration_deliveries`, `20260711203000:239-257`) oraz krok TS w `runJobsTick` przed `emailQueue` (`src/lib/server/jobsTick.server.ts:295`), żeby mail zakolejkowany w ticku wyszedł w tym samym ticku.
- **E-mail:** `enqueueRawEmail({idempotencyKey: journey:{enrollment}:{node}, category, unsubscribeUrl})` (`src/lib/email/transactional.server.ts:459`). Daje bramkę wykluczeń, log dostarczalności i idempotencję.
- **Warunki „otworzył/kliknął”:** tracking istnieje tylko dla kampanii newslettera (`newsletter_campaign_events`, piksel `/api/public/nl-open` i `/api/public/nl-click`, `20260814150000:1-40`). Dla maili 1:1 trzeba go dobudować (token per `enrollment` i węzeł).
- **UI:** nowa zakładka w `/admin/workflows` albo osobna trasa z `adminPageHead`, reużywająca `atoms.tsx`, `runStatus.ts`, `CorrelationTracePanel`, edytora warunków (`conditionToPairs`/`pairsToCondition`) i `WORKFLOW_ACTION_PARAMS`. Do wizualizacji pionowej (jak w HubSpot) wystarczy CSS/SVG plus `@dnd-kit` (jest w `package.json:84-86`); biblioteki grafów nie ma.

### Do reużycia

- **domain_events + emit_domain_event (szyna)** (`supabase/migrations/20260808190000_discussion_clubs_a17_event_actor_order.sql:35-93`): Jedyny emiter. Nowe zdarzenia wyzwalające ścieżki (paywall_hit, checkout, rejestracja) i zdarzenia samych ścieżek (journey.enrolled.v1 itd.) emitować przez emit_domain_event(tenant, aggregate_type, aggregate_id, 'x.y.v1', payload, p_actor_id). Payload tylko z identyfikatorami, bo redakcja usuwa PII.
- **tg_run_workflows_for_event (wzorzec triggera)** (`supabase/migrations/20260711204000_workflow_engine.sql:252-309`): Wzorzec dla tg_enroll_journeys_for_event: AFTER INSERT na domain_events, ogranicznik pg_trigger_depth, dopasowanie payload @> condition, blok EXCEPTION per definicja, nigdy nie przerywa zapisu źródłowego.
- **run_workflow_step (katalog akcji)** (`supabase/migrations/20261007140700_runtime_errors_seats_workflow_passwords.sql:62-240`): Wykonywanie akcji SQL z węzłów ścieżki: run_workflow_step(jsonb_populate_record(NULL::public.domain_events, enrollment.trigger_event), node_step). Nowe akcje (set_crm_stage, newsletter_subscribe/unsubscribe) dopisać do CASE przez pełne CREATE OR REPLACE z tego (najnowszego) ciała.
- **workflow_param_text** (`supabase/migrations/20260711204000_workflow_engine.sql:111-121`): Ustalanie parametrów: stała wartość z params albo klucz payloadu (`*_from`), w węzłach ścieżki.
- **create_crm_task: ustalanie kontaktu** (`supabase/migrations/20261007140700_runtime_errors_seats_workflow_passwords.sql:166-198`): Logika e-mail z payloadu, potem profiles.email/contact_email po user_id, potem crm_upsert_lead i crm_leads.email_norm. Wyciągnąć ją do funkcji pomocniczej ustalającej crm_lead_id przy zapisie do ścieżki (klucz kontaktu).
- **crm_upsert_lead** (`supabase/migrations/20260630060254_f371acc7-e6e1-455e-b9df-6dd6653fc03a.sql:29-82`): Upsert kontaktu (merge po email_norm/telefonie), tylko dla service_role/definer (20260724090200). Zwraca NULL przy pustym e-mailu, więc wynik trzeba sprawdzać.
- **enqueue_notification** (`supabase/migrations/20260803090000_harden_enqueue_notification_acl.sql:22-40`): Powiadomienia in-app z węzłów (bramka preferencji, dedup 5 min); wołać tylko z definer.
- **workflow_templates + install_workflow_template + trigger na tenants** (`supabase/migrations/20260711204000_workflow_engine.sql:314-438`): Wzorzec katalogu szablonów ścieżek (journey_templates) z instalacją idempotentną po (tenant_id, template_key) i automatyczną instalacją w nowych tenantach. Bramkę zmienić na is_admin_or_editor().
- **claim_integration_deliveries / finish_integration_delivery** (`supabase/migrations/20260711203000_idempotency_and_integration_outbox.sql:239-284`): Wzorzec kolejki zapisów do ścieżki: UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT n), liczba prób, backoff wykładniczy z sufitem 12 h, stan 'dead' po 8 próbach. Reclaim zawieszonych 'delivering': 20260724090800_integration_delivering_reclaim.sql.
- **command_idempotency / claim_command** (`supabase/migrations/20260711203000_idempotency_and_integration_outbox.sql:24-130`): Idempotencja mutacji admina (np. ręczny zapis lub wypis kontaktu ze ścieżki, publikacja wersji).
- **runJobsTick / runJobStep (harmonogram co minutę)** (`src/lib/server/jobsTick.server.ts:240-300`): Dodać krok 'journeys' (claim zapisów z terminem, wykonanie węzłów) przez runJobStep(overBudget, …) PRZED drenem poczty (linia 295), z własnym limitem czasu; pg_cron 'jobs-tick' * * * * * (20260713170000:124).
- **enqueueRawEmail / sendTxEmail** (`src/lib/email/transactional.server.ts:430-470`): Wysyłka maili ścieżki: idempotencyKey 'journey:{enrollment_id}:{node_id}', category (marketing/bulk), unsubscribeUrl; bramka wykluczeń i email_send_log za darmo.
- **newsletter_campaign_events + tracking nl-open/nl-click** (`supabase/migrations/20260814150000_newsletter_campaign_events_daily_unique.sql:1-40`): Wzorzec tokenu HMAC i dziennego unikalnego zdarzenia otwarcia/kliknięcia. Rozszerzyć o maile ścieżek (lub osobna tabela journey_email_events) dla warunków 'otworzył/kliknął'; trg_score_on_campaign_event (20260719083815:490-491) jako wzorzec scoringu.
- **get_correlated_events + fetchCorrelationTrace + CorrelationTracePanel** (`src/lib/admin/workflows.ts:476-533`): Dołożyć zapisy do ścieżek i przebiegi kroków po correlation_id (kopiowanym ze zdarzenia wyzwalającego) do istniejącego śladu; panel src/components/admin/workflows/CorrelationTracePanel.tsx.
- **Atomy i reguły UI Automatyzacji** (`src/components/admin/workflows/atoms.tsx`): RunStatusBadge, EventTypeChip, DateTimeText, StepChips oraz lib/runStatus.ts (deskryptory statusów), lib/panelRules.ts (ALL_SENTINEL, traceSubmission), lib/editorDraft.ts (moveStep, replaceAt, applyTriggerSelection) w edytorze i liście ścieżek.
- **Kontrakt akcji i warunków w TS** (`src/lib/admin/workflows.ts:27-259`): WORKFLOW_ACTIONS i WORKFLOW_ACTION_PARAMS jako paleta akcji węzłów; parseConditionValue, conditionToPairs i pairsToCondition (bezstratna runda typów) do warunków if/then i wyzwalaczy.
- **DOMAIN_EVENT_TYPES** (`src/lib/realtime/domainEvents.ts:10-180`): Lista wyzwalaczy w edytorze ścieżek. Wymaga dopisania nowych zdarzeń i, dla każdego wpisu, mapy inwalidacji (test pilnuje).
- **adminPageHead** (`src/lib/adminPageHead.ts:1-15`): Head nowej trasy ścieżek (wymóg AGENTS.md).
- **Atrapy łańcucha Supabase w testach** (`src/lib/admin/__tests__/workflowsData.test.ts:23-50`): Wzorzec vi.hoisted + @/test/supabaseChain do testów warstwy danych journeys.
- **Lokalny runner pgTAP** (`scripts/pgtap-local/run.sh`): PostgreSQL 16 jest w sandboxie (/usr/lib/postgresql/16). `bun run test:pgtap-local` uruchamia pełne migracje i testy supabase/tests, w tym plpgsql_check_gate.

### Ograniczenia i bramki

- Payload domain_events jest redagowany triggerem BEFORE (email, phone, ip, token, address, body, note…, 20260729123407:13-39): ścieżka NIGDY nie ustala kontaktu z payload.email, tylko z aggregate_id, user_id lub subscriber_id przez profiles/newsletter_subscribers/crm_leads.
- emit_domain_event ma być DOKŁADNIE jedną funkcją (uuid, text, text, text, jsonb, uuid p_actor_id, boolean p_suppress_actor); 6. pozycja to aktor, tłumienie aktora tylko argumentem nazwanym; żadnych przeciążeń (20260808190000:1-31, 89-93).
- Nazwa zdarzenia: ^[a-z0-9_]+(\.[a-z0-9_]+)+\.v[0-9]+$ (20260828205000:74). Walidator TS (src/lib/admin/workflows.ts:266) trzeba zrównać z tym wzorcem.
- Trigger na domain_events nie może przerwać zapisu źródłowego: EXCEPTION WHEN OTHERS -> RETURN NEW, ale błąd musi zostawić ślad w tabeli (nie tylko połknięcie); ogranicznik pg_trigger_depth().
- Retencja domain_events to 90 dni (prune_domain_events, cron 'prune-domain-events'): zapis do ścieżki musi trzymać snapshot zdarzenia wyzwalającego, a nie FK do domain_events.
- Każda nowa funkcja w public dostaje domyślnie EXECUTE dla anon i authenticated (ALTER DEFAULT PRIVILEGES, 20261007120500:4-9): funkcje serwerowe REVOKE ALL FROM PUBLIC, anon, authenticated + GRANT service_role; potwierdzają to service_only_rpc_grants_test i kontrakt TS<->SQL.
- RPC dla admina: tenant wyłącznie z current_tenant_id() (sesja), nigdy z argumentu; bramka is_admin_or_editor() (spójnie z RLS 20260824074231:141-155, nie is_staff z autorem).
- RLS nowych tabel journey_*: tenant_id = current_tenant_id() AND is_admin_or_editor(); zapis stanu (zapisy do ścieżek, przebiegi) tylko przez SECURITY DEFINER/service_role.
- Bramka plpgsql_check (supabase/tests/plpgsql_check_gate_test.sql): każda funkcja plpgsql w public, także triggerowa, musi przejść statyczne sprawdzenie; lista zwolnień może tylko maleć.
- Bramka generate:ts-sql-contract: literalne nazwy RPC i tabel w kodzie TS (bez dynamicznych stringów), granty zgodne z wywołującym (klient albo service_role), prywatne kolumny poza publicznymi stałymi.
- Zmiana run_workflow_step to pełne CREATE OR REPLACE z NAJNOWSZEGO ciała (20261007140700:62-240, search_path 'public','pg_temp'); kopia ze starszej migracji przywróci błąd notify_followers (uuid = text). Lustro katalogu w TS: WORKFLOW_ACTIONS/WORKFLOW_ACTION_PARAMS.
- Test parytetu i18n (src/lib/admin/**tests**/workflows.test.ts:262-300): każda akcja i każdy parametr muszą mieć klucze PL i EN w src/lib/i18n-admin-workflows.ts.
- CHECK workflow_runs.status ('succeeded','failed') ma lustro w src/components/admin/workflows/lib/runStatus.ts: zmiana statusów wymaga zmiany obu miejsc i testu runStatus.test.ts.
- Konfiguracja trasy jest w EAGER grafie routera: bez side-effect importu i18n i bez importu warstwy danych w validateSearch (src/routes/admin.workflows.tsx:8-11, 52-55); head przez adminPageHead (AGENTS.md).
- Harmonogram: joby w runJobsTick biegną sekwencyjnie w budżecie 25 s (JOBS_TICK_DEADLINE_MS, jobsTick.server.ts:159) i muszą być idempotentne i watermarkowe; nowy job przez runJobStep z własnym limitem; nowy wynik dopisać do JobsTickResult, a przy ekspozycji w community-cron także do SCHEDULER_JOBS (src/lib/jobs/scheduler.ts:21-45).
- E-mail wyłącznie przez kolejkę (enqueueRawEmail/sendTxEmail -> enqueue_email -> pgmq transactional_emails -> drainEmailQueues), z deterministycznym idempotencyKey, kategorią wykluczeń i unsubscribeUrl dla marketingu; SQL nie wysyła maili.
- Zgoda marketingowa: od 20261012180900 formularz kontaktowy nie nadaje crm_leads.marketing_consent (zgodę daje double opt-in newslettera); maile marketingowe ścieżek muszą respektować marketing_consent/newsletter_status i listę wykluczeń.
- Migracje idempotentne (IF NOT EXISTS, CREATE OR REPLACE, DROP … IF EXISTS, ON CONFLICT); po zmianie schematu regeneracja src/integrations/supabase/types.ts.
- Nie dublować: przepisy (workflow_definitions) zostają; ścieżki reużywają szynę, katalog akcji, kolejkę i harmonogram, a nie budują drugiego emitera, drugiego crona ani drugiej kolejki maili.

### Braki

- Czekanie/opóźnienie (wait X): silnik jest synchroniczny w transakcji źródłowej, nie ma next_run_at ani harmonogramu dla workflowów.
- Rozgałęzienia (if/then, split A/B): steps to płaska tablica; nie ma węzłów, krawędzi ani przydziału wariantu.
- Stan per kontakt (zapis do ścieżki): workflow_runs jest per zdarzenie, bez klucza kontaktu, bez current_step i bez blokady ponownego zapisu.
- Cele i wypis (goal/unenrollment, wyjście z sekwencji).
- Retry i ponowienie przebiegu: 'failed' jest końcowe, nie ma backoffu ani RPC do ponownego uruchomienia.
- Log per krok (wejście, wyjście, czas, błąd); jest tylko agregat steps_completed, w dodatku mylący przy failed.
- Akcja wysyłki e-maila w katalogu silnika (send_email) i szablony treści maili ścieżek.
- Akcja 'ustaw etap CRM' (set_crm_stage na enum crm_stage) i akcje dodaj/usuń z listy newslettera; tabele list i segmentów newslettera w ogóle nie istnieją.
- Zdarzenia domenowe: rejestracja użytkownika (profile.created/user.signed_up), uderzenie w paywall, rozpoczęty/porzucony checkout, osobne payment_failed (dziś tylko subscription.status_changed.v1 z new_status past_due/unpaid), otwarcie/kliknięcie maila jako zdarzenie na szynie.
- Tracking otwarć i kliknięć dla maili 1:1 (tracking istnieje tylko dla kampanii: newsletter_campaign_events).
- correlation_id dla zapisów serwerowych (webhook Stripe, cron, supabaseAdmin): request_correlation_id czyta tylko nagłówek PostgREST, więc przebiegi z serwera są poza śladem.
- Wpisy w DOMAIN_EVENT_TYPES dla crm_lead.pushed.v1 i event_sponsor.unpublished.v1 (emitowane w SQL, nieobecne w katalogu TS).
- Poprawny walidator wielosegmentowych typów zdarzeń w edytorze (event.registration.* są w liście, ale nie da się ich zapisać).
- Działająca akcja szablonu newsletter-confirmed-to-crm (e-mail wycięty z payloadu; dziś no-op ze statusem succeeded, test jest fałszywie zielony).
- Spójna bramka roli w install_workflow_template (is_staff z autorem zamiast is_admin_or_editor).
- Testy pgTAP: create_crm_task, szablony retencyjne, wykonanie notify_followers, bramka install_workflow_template, izolacja tenantów tabel workflow_*.
- Biblioteka do wizualizacji grafu (brak reactflow/@xyflow); dostępny jest tylko @dnd-kit, więc widok w stylu HubSpot trzeba zbudować w CSS/SVG.
- Head trasy /admin/workflows przez adminPageHead (dziś meta wpisane ręcznie).

## 2. Potok e-mail

Rozpoznanie objęło potok e-mail: kolejkę, wysyłkę, szablony, personalizację, wersje językowe, wypisy i deliverability, śledzenie otwarć i kliknięć oraz kampanie. Nie zmieniałem żadnych plików.

#### 1. Architektura w skrócie

```
producent (TS, server)                         wyjście poczty (jedno)
 sendTxEmail / enqueueRawEmail ──► email_send_log 'pending'
   │  (brama: checkSendAllowed)    + RPC enqueue_email ──► pgmq 'transactional_emails'
 auth webhook ───────────────────► pgmq 'auth_emails'
                                         │
 pg_cron 'jobs-tick' (co 1 min) ─► POST /api/public/jobs-tick ─► runJobsTick
                                         ├─ tickNewsletterCampaigns ─► sendEmail (Resend, BEZ kolejki)
                                         └─ drainEmailQueues ──────► sendEmail (platform mailer / Resend)
 Resend webhook ─► /api/public/webhooks/resend ─► email_apply_delivery_event ─► email_delivery_events
                                                                             └► email_suppressions
 piksel/redirect ─► /api/public/nl-open|nl-click ─► newsletter_record_campaign_event ─► newsletter_campaign_events
```

#### 2. Kolejka (outbox) i statusy

| Obiekt                                                                                                                                                         | Co to jest                                                                          | Dowód                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pgmq` kolejki `auth_emails`, `transactional_emails` + `*_dlq`                                                                                                 | Kolejka poczty 1:1 (auth ma wyższy priorytet)                                       | supabase/migrations/20260728154925_email_infra.sql:17-22                                                                  |
| `public.email_send_log` (id, message_id, template_name, recipient_email, status, error_message, metadata, created_at)                                          | Dziennik wysyłek, do którego się tylko dopisuje (każda zmiana stanu to nowy wiersz) | 20260728154925_email_infra.sql:27-36                                                                                      |
| status CHECK: `pending, sent, suppressed, failed, bounced, complained, dlq`                                                                                    |                                                                                     | 20260728154925_email_infra.sql:32, :84-88                                                                                 |
| UNIQUE `message_id` WHERE status='sent'                                                                                                                        | Zabezpieczenie przed podwójną wysyłką                                               | 20260728154925_email_infra.sql:80-81                                                                                      |
| `email_send_log.tenant_id` + trigger uzupełniający tenanta                                                                                                     | Raport per tenant                                                                   | 20260913101000_email_log_tenant_scope.sql:32-33; 20260913140000_email_send_log_tenant_producers.sql:138-153               |
| UNIQUE pending z `metadata->>'idempotency_key'`                                                                                                                | Idempotencja trasy HTTP send                                                        | 20261002190200_email_send_log_idempotent_pending_uidx.sql                                                                 |
| `public.email_send_state` (singleton id=1: retry_after_until, batch_size=10, send_delay_ms=200, auth_email_ttl_minutes=15, transactional_email_ttl_minutes=60) | Limity i cooldown po 429                                                            | 20260728154925_email_infra.sql:91-101                                                                                     |
| RPC `enqueue_email(queue_name, payload)`, `read_email_batch`, `delete_email`, `move_to_dlq` (SECURITY DEFINER)                                                 | Wrappery pgmq                                                                       | 20260728154925_email_infra.sql:137-197                                                                                    |
| Uprawnienia tylko dla `service_role` (REVOKE anon/authenticated)                                                                                               |                                                                                     | 20261007140000_email_queue_service_only.sql:36-46                                                                         |
| `move_to_dlq` z redakcją ładunku + `email_dlq_prune`, cron `email-dlq-prune` `37 3 * * *`                                                                      | Retencja DLQ                                                                        | 20261012160100_email_dlq_redaction_retention.sql:44,63,114,228; 20261012182200_email_dlq_redact_unsubscribe_url.sql:37,56 |
| Cron `process-email-queue` (co 5 s)                                                                                                                            | Opisany tylko w komentarzu, w repo go nie ma; zastępuje go dren w jobs-tick         | 20260728154925_email_infra.sql:295-302; src/lib/email/queueDrain.server.ts:1-18                                           |

**Dren** `drainEmailQueues` (src/lib/email/queueDrain.server.ts:394):

- kolejność kolejek: auth, potem transactional (:46);
- `MAX_RETRIES = 5`, liczone z wierszy 'failed' w logu (:49, :345-366);
- VT 60 s (:62);
- TTL, czyli `queued_at` starsze niż okno, idzie do DLQ (:459-468);
- sprawdza listę wykluczeń ponownie w chwili wysyłki (:488-505);
- `sendEmail` z tagami `tenant/label/queue` (:507-527);
- 429 włącza globalny cooldown (:534-548), błąd trwały kieruje do DLQ (:549-557).
- **W logu 'sent' zapisuje NASZ `message_id`, a identyfikator dostawcy (`sendResult.messageId`) jest odrzucany** (:530-531).

**Harmonogram**:

- `runJobsTick` (src/lib/server/jobsTick.server.ts:261): kampanie (:273), zadania uczestnika (biegną PRZED drenem, żeby ich maile wyszły w tym samym ticku, :47-50), dren `maxMessages: 60` (:295-303), budżet ticku 25 s (:159), deadline drenu 10 s (:167), zapis przebiegu `recordJobRun` (:455).
- Endpoint `/api/public/jobs-tick` z nagłówkiem `x-jobs-secret` porównywanym z `job_runner_settings.secret` (src/routes/api/public/jobs-tick.ts:15-50).
- pg_cron `jobs-tick` `* * * * *` → `invoke_jobs_tick()` (20260731130000_job_scheduler_reconcile_runner_telemetry.sql:435; 20260731210000_community_cron_db_schedule.sql:121,184).
- Druga powierzchnia: POST `/platform/email/queue/process` (src/routes/platform/email/queue/process.ts:24-51).

#### 3. Wysyłka (dostawca)

| Fakt                                                                                                                                                                            | Dowód                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| JEDNO wyjście poczty: `sendEmail(input)`                                                                                                                                        | src/lib/email/provider.server.ts:1-18, :220           |
| Gdy jest `senderDomain`, wysyła **platform mailer** (`@lovable.dev/email-js`, `purpose: "transactional"`); nie zwraca messageId                                                 | provider.server.ts:229-231, :176-211 (:188, :196-198) |
| W przeciwnym razie **Resend** przez gateway `connector-gateway.lovable.dev/resend` (env `LOVABLE_API_KEY` + `RESEND_API_KEY`); zwraca `id`, przekazuje tagi i nagłówki RFC 8058 | provider.server.ts:21, :69-75, :109-154               |
| Domyślny nadawca Resend: `onboarding@resend.dev`                                                                                                                                | provider.server.ts:128                                |
| Fallback: 403 „domain is not verified” przełącza na platform mailer                                                                                                             | provider.server.ts:240-247                            |
| Poczta transakcyjna: From `noreply@notify.mail.neweuropeanstrategies.com`, `SENDER_DOMAIN`, kolejka `transactional_emails`                                                      | src/lib/email/transactional.server.ts:37-45, :397-398 |
| Edge functions: w repo ich nie ma; wszystko działa jako server routes / server fn (TanStack Start)                                                                              | brak `supabase/functions` (ls)                        |

#### 4. Producenci (jak zakolejkować pojedynczy mail)

| API                                                                                                           | Sygnatura / zachowanie                                                                                                                                                                                                                                                                                   | Dowód                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `sendTxEmail(input: TxSendInput)`                                                                             | `type: TxEmailType, to, lang, idempotencyKey, tenantId?, bodyVars?, details?, ctaPath?/ctaUrl?, intro?, extra?, metaName?, subjectName?` → brama wykluczeń → kontrola duplikatu → render React Email `TxEmail` → INSERT 'pending' → `rpc("enqueue_email", {queue_name:"transactional_emails", payload})` | transactional.server.ts:79-120, :297-430 (brama :202-236, duplikat :256-267, render :352-374, insert :378-384, enqueue :386-411) |
| `enqueueRawEmail(input: RawEmailInput)`                                                                       | Gotowy HTML: `to, subject, html, text?, label, idempotencyKey, category?, tenantId?, unsubscribeUrl?`; ta sama brama, log i kolejka; sam dokłada globalny `unsubscribe_token`                                                                                                                            | transactional.server.ts:432-451, :459-529                                                                                        |
| `deterministicMessageId(key)`                                                                                 | UUID z SHA-256 klucza idempotencji, stabilny między próbami                                                                                                                                                                                                                                              | src/lib/email/messageId.ts                                                                                                       |
| Ładunek kolejki                                                                                               | `message_id, to, from, sender_domain, subject, html, text, label, idempotency_key, unsubscribe_token, unsubscribe_url, tenant_id, queued_at`                                                                                                                                                             | queueDrain.server.ts:131-146; transactional.server.ts:386-411                                                                    |
| HTTP `/platform/email/transactional/send` (Bearer JWT)                                                        | Szablony z rejestru `TEMPLATES`, idempotencja z odciskiem SHA-256 `templateData`                                                                                                                                                                                                                         | src/routes/platform/email/transactional/send.ts:206, :291-298, :426-497                                                          |
| Auth webhook → `enqueue_email('auth_emails')`                                                                 |                                                                                                                                                                                                                                                                                                          | src/routes/platform/email/auth/webhook.ts:362-363                                                                                |
| Digesty → `enqueueRawEmail` z etykietą `digest_daily`/`digest_weekly`                                         |                                                                                                                                                                                                                                                                                                          | src/lib/notifications/dispatch.server.ts:454-523 (:493-511)                                                                      |
| Mail DOI newslettera wysyłany wprost przez `sendEmail` (Resend), **z pominięciem kolejki i `email_send_log`** |                                                                                                                                                                                                                                                                                                          | src/lib/newsletter.functions.ts:424-431                                                                                          |

**Z poziomu SQL** jedyna droga to `SELECT public.enqueue_email('transactional_emails', jsonb)` jako `service_role`, z pełnym ładunkiem: gotowy HTML, ręczny wiersz `email_send_log` 'pending', bez bramy wykluczeń. W migracjach nikt tego nie robi (jedyne `pgmq.send` dotyczą DLQ: 20261012160100:75,84,175). SQL nie wyrenderuje szablonów React Email ani EmailDoc. **Wniosek:** SQL powinien tylko zapisać „krok do wykonania”, a render i enqueue zrobi tick w TS.

**Opóźnionej wysyłki nie ma:** `enqueue_email` nie przyjmuje parametru delay (email_infra.sql:137-147), a TTL `transactional_emails` to 60 min (:97, dren :459-468). Kroki „odczekaj X” muszą więc żyć we własnej tabeli (next_run_at) i być realizowane przez tick przed drenem.

#### 5. Szablony

| Warstwa                                                                                                                                                    | Opis                                                                                 | Dowód                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TxEmailType` (około 50 typów: subskrypcje, płatności, wydarzenia, kluby, newsletter_confirmed, user_invitation…)                                          | Unia typów + słownik PL/EN `txCopy`/`txSubject`                                      | src/lib/email-templates/tx-copy.ts:9-91, :1732, :1797, :1801                                                                                                      |
| `TxEmail` (React Email) + layout NES                                                                                                                       |                                                                                      | src/lib/email-templates/transactional.tsx:25, :85; nes-layout.tsx:19                                                                                              |
| `txBody(type, lang, gender, vars)`                                                                                                                         | Akapity odmienione przez rodzaj gramatyczny                                          | src/lib/email-templates/tx-body.ts:15, :260                                                                                                                       |
| Rejestr `TEMPLATES` (12 wpisów, nazwy z myślnikami)                                                                                                        | Dla trasy HTTP send                                                                  | src/lib/email-templates/registry.ts:35-48                                                                                                                         |
| Szablony auth: signup, magic-link, recovery, invite, email-change, reauthentication                                                                        |                                                                                      | src/lib/email-templates/*.tsx                                                                                                                                     |
| Nadpisania treści z panelu: `site_settings.key='tx_email_overrides'`; tylko 3 typy (team_seat_*)                                                           |                                                                                      | src/lib/email/txOverrides.ts:21-28; txOverrides.server.ts                                                                                                         |
| **EmailDoc v1**: liniowe bloki heading/paragraph/image/button/divider/spacer/quote/post-list/footer-note, teksty `{pl,en}`                                 | Kreator treści kampanii; `parseEmailDoc` + `renderEmailHtml` (podgląd równy wysyłce) | src/lib/newsletter/emailDoc.ts:1-15, :24, :305; renderEmailHtml.ts:158                                                                                            |
| `newsletter-builder`                                                                                                                                       | To builder formularzy inline/popup (NlDoc), **nie** maili                            | src/lib/newsletter-builder/types.ts:1-12                                                                                                                          |
| Podglądy i raporty: `getTxEmailPreviews`, `getSystemEmailReport` (requireAdmin), `getEmailOutbox` (requireAdminEditor)                                     |                                                                                      | src/lib/tx-email-preview.functions.ts; src/lib/system-emails.functions.ts; src/lib/email/system-log.server.ts:189; src/lib/admin/emailOutbox.functions.ts:158-179 |
| Panel: /admin/newsletter/{overview, inline, popup, campaigns, subscribers, deliverability, outbox, system-emails, auth-logs, email-content, email-preview} |                                                                                      | src/components/admin/newsletter/NewsletterSubNav.tsx:24-84                                                                                                        |

#### 6. Personalizacja i języki

| Kanał         | Zmienne                                                                                             | Dowód                                               |
| ------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Kampanie      | `{{email}}`, `{{firstName}}`, `{{lastName}}` (HTML-escaped)                                         | src/lib/newsletter-campaigns.functions.ts:1054-1056 |
| Nadpisania tx | `{planName} {orgName} {accessUntil} {daysLeft} {subject} {firstName}` (pojedyncze klamry)           | src/lib/email/txOverrides.ts:86-111                 |
| TxEmail       | firstName, gender, vocativePl z `resolveRecipientName` (newsletter_subscribers + `name_dictionary`) | src/lib/email/recipient-name.server.ts:24           |

Składnie zmiennych są dwie i niespójne: `{{x}}` w kampaniach i `{x}` w nadpisaniach.

Języki:

- `EmailLang = "pl" | "en"` (nes-layout.tsx:19; emailDoc.ts:17).
- Język odbiorcy w billingu: `profiles.prefs.language/lang`, potem `newsletter_subscribers.language`, domyślnie 'pl' (src/lib/billing/notifications.server.ts:37-67).
- Kampania wybiera `subject_pl/en`, `html_pl/en` po `newsletter_subscribers.language`; brak treści w danym języku daje `skipped: missing_content_for_language` (newsletter-campaigns.functions.ts:905-913).

#### 7. Zgody, wypisy, deliverability

| Fakt                                                                                                                                                                                                                                          | Dowód                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Kanoniczna lista wykluczeń `public.email_suppressions`: tenant, email_norm, reason `hard_bounce/soft_bounce/complaint/manual/unsubscribe/invalid/blocked`, scope permanent/transient, expires_at, released_at; UNIQUE (tenant_id, email_norm) | 20260725123624_354063a8-….sql:6-36                                                                            |
| `suppressed_emails` to już tylko widok zgodności (unifikacja)                                                                                                                                                                                 | 20260731120000_email_suppression_unification.sql:1-30                                                         |
| RPC: `email_filter_suppressed`, `email_is_suppressed`, `email_record_suppression`, `email_suppression_add/release`, `email_deliverability_counts`                                                                                             | 20260725123624:181,264,278,395,432,460                                                                        |
| Brama `checkSendAllowed({email, category, tenantId})`: tenant z `email_resolve_tenant_for_address`, gdy go nie podano; fail-open przy błędzie odczytu                                                                                         | src/lib/email/suppression.server.ts:135, :205-228                                                             |
| Polityka POWÓD x KATEGORIA: `bulk` blokuje się przy każdej aktywnej blokadzie; `transactional` przechodzi przy `unsubscribe` i `soft_bounce`                                                                                                  | src/lib/email/suppressionPolicy.ts:44, :61-81                                                                 |
| Kategoria per TxEmailType (Record, więc brak wpisu nie skompiluje się); etykiety surowe; **nieznana etykieta to `bulk`**                                                                                                                      | suppressionPolicy.ts:120-216, :229-270                                                                        |
| Pominięcie zawsze zostawia w `email_send_log` wiersz 'suppressed' z `message_id`                                                                                                                                                              | transactional.server.ts:227-235                                                                               |
| Token globalny `email_unsubscribe_tokens` (1 na adres), `ensureUnsubscribeToken`                                                                                                                                                              | 20260728154925_email_infra.sql:246-252; src/lib/email/unsubscribeToken.server.ts:21                           |
| Token subskrybenta `newsletter_subscribers.unsubscribe_token`, URL `/api/public/newsletter/unsubscribe?token=`                                                                                                                                | src/lib/newsletter/unsubscribeUrl.ts                                                                          |
| Oba tokeny obsługuje jedna transakcja SQL `email_unsubscribe_by_token` (blokada 'unsubscribe' + wypis z newslettera + wycofanie zgód wydarzeń we wszystkich tenantach)                                                                        | suppression.server.ts:247-272; 20261012180900_marketing_consent_unsubscribe_contact_crm_staff.sql:28-35, :77+ |
| Trasy wypisu: `/email/unsubscribe` (GET waliduje, POST one-click) i `/api/public/newsletter/unsubscribe`                                                                                                                                      | src/routes/email/unsubscribe.ts:55-102; src/routes/api.public.newsletter.unsubscribe.ts                       |
| Blokada ustawia subskrybentowi `status='unsubscribed'` (trigger)                                                                                                                                                                              | 20260725123624:139-162                                                                                        |
| Zdarzenia domenowe `newsletter_subscriber.subscribed/confirmed/unsubscribed.v1`                                                                                                                                                               | 20260711200000_domain_event_bus.sql:342-373                                                                   |
| Ponowny DOI zdejmuje blokadę 'unsubscribe'                                                                                                                                                                                                    | suppression.server.ts:287-305                                                                                 |
| Bramka reputacji `evaluateSendGate` (okno 30 dni; spam target 0,1% / limit 0,3%; bounce target 2% / limit 5%; minimalna próba 500)                                                                                                            | src/lib/email/reputationGate.server.ts:25, :85-99; reputation.ts:19-34                                        |
| Zgoda marketingowa CRM: `crm_leads.marketing_consent`                                                                                                                                                                                         | 20260630053403_….sql:88                                                                                       |

#### 8. Śledzenie otwarć i kliknięć (pod warunek „otworzył/kliknął”)

| Fakt                                                                                                                                                                                                                                                                                      | Dowód                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Tabela `newsletter_campaign_events` (tenant_id, campaign_id NOT NULL, subscriber_id, kind 'open'/'click', url, created_at)                                                                                                                                                                | 20260712175237_….sql (CREATE TABLE)                                      |
| Deduplikacja: 1 wiersz na (kampania, subskrybent, rodzaj, doba UTC)                                                                                                                                                                                                                       | 20260814215302_….sql:36-43                                               |
| Jedyny zapis: RPC `newsletter_record_campaign_event(p_campaign, p_subscriber, p_kind, p_url, p_occurred_at)` (service_role); **subskrybent musi istnieć w tym tenancie**                                                                                                                  | 20260814215302:53-121                                                    |
| Agregat `newsletter_campaign_engagement(p_campaign)` (admin/editor)                                                                                                                                                                                                                       | 20260814215302:123-167                                                   |
| Trigger `trg_score_on_campaign_event` przelicza `compute_crm_lead_score`                                                                                                                                                                                                                  | 20260719083815_….sql:490-493                                             |
| Piksel `/api/public/nl-open?c=&s=` i redirect `/api/public/nl-click?c=&s=&u=&k=`                                                                                                                                                                                                          | src/routes/api/public/nl-open.ts; nl-click.ts                            |
| Token HMAC per (campaignId, subscriberId) oraz podpis per link (sekret `SESSION_SECRET` lub `SUPABASE_SERVICE_ROLE_KEY`)                                                                                                                                                                  | src/lib/newsletter/trackingToken.server.ts:47-91                         |
| Przepisywanie linków i piksel                                                                                                                                                                                                                                                             | src/lib/newsletter/tracking.ts:37-76                                     |
| Źródło prawdy `NEWSLETTER_ENGAGEMENT_SOURCE`: domyślnie `first_party`, alternatywnie `provider`                                                                                                                                                                                           | src/lib/newsletter/engagementSource.ts; trackingEvents.server.ts:128-163 |
| Webhook Resend `/api/public/webhooks/resend` (svix, `RESEND_WEBHOOK_SECRET`) zapisuje wszystkie zdarzenia do `email_delivery_events` (kind sent/delivered/delayed/bounced/complained/opened/clicked/failed); open/click przekazuje do `recordCampaignEvent` **tylko gdy jest campaignId** | src/routes/api/public/webhooks.resend.ts:37-145; 20260725123624:60-79    |
| `email_apply_delivery_event` koreluje WYŁĄCZNIE przez `newsletter_campaign_recipients.provider_message_id` lub tagi `tenant/campaign/subscriber`; bounce i complaint zapisuje do `email_suppressions`                                                                                     | 20260725123624:290-392 (:310, :319-323, :347, :374)                      |

**Skutek dla ścieżek:** dziś „otworzył/kliknął” da się policzyć tylko dla kampanii newslettera i tylko dla adresów z `newsletter_subscribers`. Maile z kolejki (tx, raw) nie mają piksela, nie mają ID dostawcy (platform mailer nie zwraca go, a dren je odrzuca), więc nie korelują się z żadnym zdarzeniem.

#### 9. Kampanie newslettera (wysyłka do segmentu)

| Fakt                                                                                                                                                                                                                 | Dowód                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `newsletter_campaigns` (subject/html pl+en, from_*, reply_to, audience_filter, status `draft/scheduled/sending/sent/failed/cancelled`, scheduled_at, liczniki) + później editor, content_doc, lease_until            | 20260711083456_….sql:2-26                                                                |
| `newsletter_campaign_recipients` UNIQUE (campaign_id, email), status pending/sent/failed/skipped/suppressed, provider_message_id, delivery_state                                                                     | 20260711083456:68-81; 20260725123624:98-133                                              |
| Segment = `AudienceFilter { languages, statuses, source, min_tier_rank }`, wyłącznie po `newsletter_subscribers` (bez segmentów CRM)                                                                                 | newsletter-campaigns.functions.ts:88-104, :755-773; RPC `newsletter_min_tier_emails` :70 |
| Server fn: `listCampaigns`, `getCampaign`, `upsertCampaign`, `countCampaignAudience`, `sendCampaignTest`, `sendCampaign`, `processDueCampaigns` (requireStaff)                                                       | :224, :239, :332, :400, :440, :502, :555                                                 |
| Tick `tickNewsletterCampaigns`: atomowy `claimCampaign` + dzierżawa 3 min; 3 kampanie na tick; 200 maili na wywołanie; paczki po 20 z przerwą 1,1 s                                                                  | :78-86, :570-660                                                                         |
| `runCampaignSend`: przy wznowieniu pomija 'sent'; filtr wykluczeń wsadowo; brak originu daje `missing_site_origin`; `sendEmail` przez Resend z tagami `{tenant, campaign, subscriber}`; zapisuje `providerMessageId` | :738-1030 (:794, :806, :884, :938, :945-964); `logRecipient` upsert :1133-1146           |
| Stopka z one-click wypisem dodawana po przepisaniu linków; piksel                                                                                                                                                    | :1037-1080                                                                               |

#### 10. Uprawnienia i bramki CI

- Kontrakt TS-SQL wyciąga z `src/**` każde `.rpc("…")` i `.from("…")`, a pgTAP sprawdza je na żywym schemacie: nazwy funkcji i tabel muszą być literałami, granty zgodne z rolą klienta (`supabaseAdmin` = service_role) (src/lib/ci/tsSqlContract.ts nagłówek; package.json:53-54; AGENTS.md).
- Testy pgTAP z obszaru e-mail: email_queue_grants_test, email_suppression_test, email_suppression_unification_test, email_log_tenant_scope_test, email_dlq_redaction_test, newsletter_campaign_events_dedup_test, newsletter_unsubscribe_suppression_test, email_account_tenant_for_address_test (supabase/tests/).

#### 11. Wzorce do powielenia przy silniku ścieżek

- **Dziennik doręczeń z rezerwacją**: `event_message_deliveries` (UNIQUE tenant+dedupe_key, status claimed/sent/skipped/failed, attempts) oraz `_event_delivery_claim`/`_event_delivery_confirm`. Gotowy wzorzec kroku „wyślij” w ścieżce (20260926153100_event_participant_foundation.sql:363-388; src/lib/events/participantDelivery.server.ts:1-14, :42-98).
- **Silnik workflow SQL** (`run_workflow_step`) ma kroki notify_user, notify_staff, notify_followers, create_crm_lead, create_crm_task, add_cross_reference. **Kroku e-mail w nim nie ma** (20261007140700_runtime_errors_seats_workflow_passwords.sql:100-222).
- **Dunning** wysyła `payment_failed` i `payment_recovered` przez `notifyPaymentEmail` (src/lib/billing/dunning.server.ts:309, :380, :419, :475). Ścieżka „nieudana płatność” musi się z tym nie dublować.

### Do reużycia

- **sendEmail (jedno wyjście poczty)** (`/home/user/neweustrategies-dc633fb5/src/lib/email/provider.server.ts`): Tylko przez to wysyłać maile ścieżek. Bez senderDomain idzie przez Resend i zwraca messageId (korelacja webhooków) oraz przekazuje tags i listUnsubscribeUrl. Z senderDomain idzie przez platform mailer bez messageId.
- **enqueueRawEmail** (`/home/user/neweustrategies-dc633fb5/src/lib/email/transactional.server.ts`): Zakolejkowanie gotowego HTML kroku ścieżki: label np. 'journey_<key>', idempotencyKey 'journey:{enrollment}:{step}', category 'bulk' dla marketingu, tenantId z enrollmentu, unsubscribeUrl. Daje bramę wykluczeń, log w email_send_log, kolejkę i dren bez nowego kodu. Brak messageId dostawcy, więc otwarcia trzeba mierzyć pikselem first-party.
- **sendTxEmail** (`/home/user/neweustrategies-dc633fb5/src/lib/email/transactional.server.ts`): Dla kroków, które wysyłają istniejący typ transakcyjny (TxEmailType), np. przypomnienie o płatności. Wymaga idempotencyKey i tenantId.
- **drainEmailQueues + runJobsTick** (`/home/user/neweustrategies-dc633fb5/src/lib/server/jobsTick.server.ts`): Dodać krok 'journeys' (przetwarzanie należnych kroków z deadlinem) PRZED drenem w runJobsTick (wzorzec zadań uczestnika, linie 47-50, 273-303), żeby maile wyszły w tym samym ticku. Pole wyniku w JobsTickResult, zapis w recordJobRun.
- **checkSendAllowed + suppressionPolicy** (`/home/user/neweustrategies-dc633fb5/src/lib/email/suppression.server.ts`): Brama przed każdą wysyłką kroku; kategoria z suppressionPolicy.ts. Nieznana etykieta to bulk, ale lepiej dopisać etykiety ścieżek do RAW_LABEL_CATEGORY. fetchSuppressedEmails działa wsadowo dla podglądu audiencji.
- **deterministicMessageId** (`/home/user/neweustrategies-dc633fb5/src/lib/email/messageId.ts`): Stabilny message_id z klucza enrollment+step: idempotencja, łączenie z email_send_log i (po rozszerzeniu) z trackingiem per wiadomość.
- **EmailDoc v1 + renderEmailHtml** (`/home/user/neweustrategies-dc633fb5/src/lib/newsletter/emailDoc.ts`): Format treści maila w kroku ścieżki (jsonb, teksty pl/en, bloki). Render przez renderEmailHtml(doc, lang, {postsByBlock}) z renderEmailHtml.ts:158; edytor CampaignContentBuilder.tsx w components/admin/newsletter.
- **renderCampaignHtml / rewriteTrackingLinks / trackingPixelImg** (`/home/user/neweustrategies-dc633fb5/src/lib/newsletter/tracking.ts`): Personalizacja {{firstName}}/{{lastName}}/{{email}}, przepisanie linków, piksel i stopka wypisu. renderCampaignHtml jest prywatny w newsletter-campaigns.functions.ts:1037, więc trzeba go wynieść do wspólnego modułu zamiast kopiować.
- **trackingToken.server (HMAC)** (`/home/user/neweustrategies-dc633fb5/src/lib/newsletter/trackingToken.server.ts`): Wzorzec podpisu tokenu i linku. Do rozszerzenia o wariant per message_id (enrollment/step), żeby śledzić maile ścieżek poza kampaniami.
- **nl-open / nl-click** (`/home/user/neweustrategies-dc633fb5/src/routes/api/public/nl-open.ts`): Rozszerzyć o parametr wiadomości (np. m=message_id) albo dodać bliźnicze trasy zapisujące do nowej tabeli zdarzeń per wiadomość, z tym samym rate-limitem i ochroną przed open redirect.
- **newsletter_campaign_events + newsletter_record_campaign_event** (`/home/user/neweustrategies-dc633fb5/supabase/migrations/20260814215302_cd43e60c-8048-4661-a720-8000e893aa66.sql`): Warunek 'otworzył/kliknął kampanię X' dla subskrybentów działa od ręki (zapytanie po campaign_id + subscriber_id + kind). Dedupe per doba i trigger scoringu CRM już są.
- **email_delivery_events + email_apply_delivery_event** (`/home/user/neweustrategies-dc633fb5/supabase/migrations/20260725123624_354063a8-8805-481f-bbe9-dd3bad6506cb.sql`): Maile ścieżek wysyłane przez Resend z tagiem tenant mają zdarzenia delivered/bounced/opened/clicked po provider_message_id. Wymaga zapisania messageId w logu kroku i ewentualnie obsługi dodatkowych tagów w uuidTag.
- **ensureUnsubscribeToken / newsletterUnsubscribeUrl / unsubscribeByToken** (`/home/user/neweustrategies-dc633fb5/src/lib/email/unsubscribeToken.server.ts`): Link wypisu w mailach ścieżek: token globalny (/email/unsubscribe) dla odbiorców spoza newslettera, token subskrybenta (/api/public/newsletter/unsubscribe) dla subskrybentów. Wypis zapisuje blokadę 'unsubscribe', która z kolei wyzwala wyjście ze ścieżki.
- **evaluateSendGate** (`/home/user/neweustrategies-dc633fb5/src/lib/email/reputationGate.server.ts`): Raz na tenanta na tick przed wysyłką bulk w ścieżkach (wzorzec tenantMaySend w tickNewsletterCampaigns:592-600).
- **event_message_deliveries + claimDelivery/confirmDelivery** (`/home/user/neweustrategies-dc633fb5/src/lib/events/participantDelivery.server.ts`): Wzorzec rezerwacji kroku: UNIQUE dedupe_key, claimed, potem sent/failed, przejęcie porzuconych po 15 min. Skopiować semantykę do tabeli kroków ścieżek.
- **Zdarzenia domenowe newslettera** (`/home/user/neweustrategies-dc633fb5/supabase/migrations/20260711200000_domain_event_bus.sql`): Wyzwalacze 'zapis na newsletter' (newsletter_subscriber.subscribed.v1 / confirmed.v1) i wyjście 'wypis' (unsubscribed.v1, emitowane także przez trigger blokady).
- **system-log / emailOutbox / NewsletterSubNav** (`/home/user/neweustrategies-dc633fb5/src/lib/email/system-log.server.ts`): Maile ścieżek z email_send_log (label journey_*) od razu pojawią się w /admin/newsletter/outbox i system-emails. Nowa zakładka 'Ścieżki' do dopisania w NewsletterSubNav.tsx:24-84 albo w module Przychód i lejek.

### Ograniczenia i bramki

- Jedno wyjście poczty: każda wysyłka ścieżki przez sendEmail (provider.server.ts:1-18), bez własnych wywołań gatewaya.
- Każda wysyłka 1:1 przechodzi przez checkSendAllowed z poprawną kategorią: marketing w ścieżkach = 'bulk' (blokuje go każda aktywna blokada, także unsubscribe). Pominięcie musi zostawić w email_send_log wiersz 'suppressed' z message_id (transactional.server.ts:202-236).
- Idempotencja: message_id = deterministicMessageId(stabilny klucz enrollment+krok). Przed wysyłką sprawdzić 'pending'/'sent' (alreadyHandled, transactional.server.ts:256-267). UNIQUE sent per message_id istnieje w bazie.
- Każdy wiersz email_send_log ma tenant_id (z enrollmentu/sesji, nigdy z payloadu klienta). Raporty filtrują równościowo po tenant_id.
- Wait nie może być realizowany przez pgmq: enqueue_email nie ma delay, a TTL transactional_emails = 60 min (DLQ). Opóźnienia przechowywać we własnej tabeli (next_run_at) i realizować w ticku.
- Krok ścieżek w runJobsTick ma własny deadline, biegnie przed drenem i nie może zjeść budżetu 25 s (JOBS_TICK_DEADLINE_MS). Zwracać { error } zamiast rzucać (runJobStep).
- Mail marketingowy musi mieć działający wypis: stopka + List-Unsubscribe (RFC 8058) z absolutnym originem. Bez originu kampania rzuca missing_site_origin (newsletter-campaigns.functions.ts:884).
- Wysyłka marketingowa tylko z podstawą zgody: subskrybent status 'subscribed' albo crm_leads.marketing_consent = true. Wypis i blokada kończą udział w ścieżce.
- Przed wysyłką bulk wywołać bramkę reputacji evaluateSendGate (raz na tenanta na tick).
- RPC kolejki (enqueue_email, read_email_batch, delete_email, move_to_dlq) tylko service_role. Nowe RPC: literalne nazwy w .rpc()/.from(), granty zgodne z rolą klienta (supabaseAdmin = service_role; server-only bez anon/authenticated), bo bramka generate:ts-sql-contract sprawdza je na żywym schemacie (AGENTS.md).
- Tracking: tokeny HMAC (SESSION_SECRET), podpis per link (brak open redirect), rate limit, best-effort (piksel i redirect zawsze odpowiadają). Respektować NEWSLETTER_ENGAGEMENT_SOURCE i deduplikację per doba UTC.
- Treści dwujęzyczne pl/en (EmailLang). Język odbiorcy wg kolejności: profiles.prefs.language/lang, newsletter_subscribers.language, 'pl'.
- Nie dublować istniejących maili transakcyjnych (dunning payment_failed/recovered, subscription_canceled itd. wysyłane z webhooków). Ścieżka 'nieudana płatność' dosyła follow-upy, nie powtarza maila systemowego.
- Limity: dren 60 wiadomości na tick, batch_size 10, send_delay_ms 200, cooldown po 429 globalny (email_send_state). Kampanie: paczki 20, przerwa 1,1 s, 200 na wywołanie. Wysyłka ścieżek nie może zagłodzić auth i transakcyjnych.
- Nowe tabele: RLS, tenant_id, odczyt staff w granicach current_tenant_id(), zapisy przez SECURITY DEFINER dla service_role, testy pgTAP w supabase/tests.

### Braki

- Brak śledzenia otwarć i kliknięć dla maili spoza kampanii: newsletter_campaign_events wymaga campaign_id NOT NULL i subscriber_id z newsletter_subscribers w tym tenancie (20260814215302:79-94). Warunek 'otworzył e-mail kroku ścieżki' wymaga nowej tabeli zdarzeń per wiadomość (message_id/enrollment/step) oraz wariantu tokenu i tras nl-open/nl-click, albo modelowania kroku jako ukrytej kampanii (działa tylko dla subskrybentów).
- Dren kolejki odrzuca identyfikator wiadomości dostawcy (queueDrain.server.ts:530-531), a platform mailer go nie zwraca (provider.server.ts:196-198). Maili z kolejki nie da się skorelować z email_delivery_events (delivered/bounced/opened).
- email_apply_delivery_event koreluje tylko przez newsletter_campaign_recipients.provider_message_id i tagi tenant/campaign/subscriber (20260725123624:310-323; webhooks.resend.ts:112-114). Brak hooków dla innych nośników (np. tag journey/enrollment).
- Brak kroku 'wyślij e-mail' w silniku workflow SQL (run_workflow_step: tylko notify_*, create_crm_lead, create_crm_task, add_cross_reference).
- Brak opóźnionego enqueue (enqueue_email bez delay) i brak tabeli zaplanowanych wysyłek per odbiorca; trzeba stworzyć enrollment/step-run z next_run_at.
- Brak biblioteki wielokrotnego użytku szablonów marketingowych: treść żyje w wierszu kampanii (html_pl/en lub content_doc). Ścieżki potrzebują własnego przechowywania EmailDoc per krok (lub tabeli szablonów).
- Brak tabeli list mailingowych: listy to tylko newsletter_subscribers.meta.mailing_lists (jsonb) z konfiguracją newsletter_settings.popup_mailing_lists (src/lib/newsletter/preferences.ts:13-14; 20260625084049:9). Krok 'dodaj/usuń z listy' musi edytować meta lub wprowadzić tabelę.
- Audiencja kampanii nie obsługuje segmentów CRM, etapów cyklu życia ani zapisanych widoków (AudienceFilter: languages/statuses/source/min_tier_rank).
- Brak zdarzeń domenowych e-mail (email.sent/opened/clicked/bounced) na szynie domain_events; są tylko newsletter_subscriber.subscribed/confirmed/unsubscribed.v1.
- renderCampaignHtml (personalizacja, tracking, stopka) jest prywatną funkcją w newsletter-campaigns.functions.ts:1037; trzeba ją wydzielić do wspólnego modułu.
- Dwie niespójne składnie zmiennych ({{firstName}} w kampaniach, {firstName} w nadpisaniach tx) i brak katalogu zmiennych (np. plan, kwota, link do checkoutu) dla maili ścieżek.
- Mail DOI newslettera omija email_send_log i kolejkę (newsletter.functions.ts:424-431), więc nie widać go w outbox ani raportach.
- Brak limitów wysyłki per tenant i per odbiorca (frequency cap) dla maili marketingowych; istnieje tylko globalny email_send_state i bramka reputacji.
- Domyślny nadawca Resend to onboarding@resend.dev (provider.server.ts:128). Ścieżki muszą brać nadawcę z newsletter_settings.sender_name/sender_email albo z konfiguracji kroku.
- Martwe rzutowania TENANT_COLUMN ('as never'): kolumna tenant_id jest już w wygenerowanych typach (types.ts, email_send_log.Row.tenant_id), więc bramka stale-never-casts może je zgłosić przy nowym kodzie.

## 3. CRM: cykl życia, zadania, łączenie kontaktów

### CRM pod kątem cyklu życia kontaktu: rozpoznanie (bez zmian w plikach)

#### 0. Najważniejsze w 10 punktach

1. **Kontakt = `public.crm_leads`**, klucz biznesowy `(tenant_id, email_norm)` (`supabase/migrations/20260630053403_8783ac8b-…sql:72-91`). Kolumny `user_id` ani `profile_id` nie ma (`src/integrations/supabase/types.ts:5214-5246`). Rekord łączymy z kontem i z subskrybentem newslettera **wyłącznie po e-mailu** (lower/trim).
2. **Etap to tylko lejek sprzedażowy**: ENUM `public.crm_stage` = `new, contacted, qualified, proposal, won, lost, archived` (`20260630053403…sql:4`). **Etapu cyklu życia w stylu HubSpot (subscriber→lead→MQL→SQL→customer) nie ma.** Cykl życia da się dziś tylko odczytać pośrednio: z `source_type` (segment z rangą), z tagów (`customer`, `churned`, `plan:*`), z `score_band` i z `newsletter_status`.
3. **Historii etapów nie ma.** `admin_dashboard_crm` pisze to wprost w komentarzu (`20260912110000_admin_dashboard_aggregates.sql:313-317`). Zmiana etapu zostaje tylko jako `crm_lead.stage_changed.v1` w `domain_events`, a te są czyszczone po 90 dniach (`prune_domain_events`, `20260711220607…sql:333-343`).
4. **Zadania `crm_tasks` są w pełni gotowe**: termin, przypisanie, przypomnienia z crona `crm-task-reminders` co 10 minut, zdarzenia `crm_task.*.v1` (`20260721120000_crm_tasks_followups.sql`).
5. **Silnik workflow ma już akcje CRM `create_crm_lead` i `create_crm_task`** (`20261007140700_runtime_errors_seats_workflow_passwords.sql:151-218`). To zamknięty katalog CASE z lustrem w TS (`src/lib/admin/workflows.ts:27-34`). Akcji zmiany etapu, tagów, właściciela, listy newslettera, wysyłki e-maila i opóźnienia **brak**.
6. **Scoring działa** (`compute_crm_lead_score`, pasma hot/warm/cool/cold). Zmiana pasma nie emituje jednak osobnego zdarzenia, a ładunek `crm_lead.updated.v1` ma tylko `email` i `stage`.
7. **Lejek `/admin/crm/funnel` pokazuje subskrybentów newslettera**: widok `crm_funnel_view` i 6 liczników z `crm_funnel_stats`. Nie liczy konwersji między etapami.
8. **Webhooki CRM**: `crm_webhook_endpoints` to profil nad `integration_endpoints` z filtrem `forward_stages` i mapowaniem zgód. Dostawy idą wspólnym outboxem `integration_deliveries`.
9. **Do CRM z newslettera piszą równolegle 4 ścieżki** (2 triggery DB, funkcja serwerowa i przepis workflow). Nowa ścieżka nie powinna dokładać piątej.
10. **Rejestracja konta zakłada lead z `source_type='manual'`.** Wartość `'registered'` nadał tylko jednorazowy backfill. `paid_subscriber` trafia wyłącznie do nowego leada; istniejącemu nikt go nie podnosi.

---

#### 1. Model kontaktu: `public.crm_leads`

| Kolumna                                                              | Typ / domyślna                                                   | Kto ustawia                                                               | Dowód                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `id`, `tenant_id`                                                    | uuid; `tenant_id` domyślnie `public_tenant_id()`                 | –                                                                         | `20260630053403…sql:73-74`                                           |
| `email_norm`, `email`                                                | text NOT NULL, `UNIQUE (tenant_id, email_norm)`                  | upserty                                                                   | `:75-76`, `:91`                                                      |
| `first_name`, `last_name`, `phone`, `company`                        | text                                                             | upserty, profil                                                           | `:77-80`                                                             |
| `phone_norm`                                                         | text (dedup po telefonie w `crm_upsert_lead`)                    | trigger `crm_leads_sync_phone_norm`                                       | `20260630060254…sql:3`, `:84-90`                                     |
| **`stage`**                                                          | `crm_stage` NOT NULL, domyślnie `'new'`                          | panel, `crm_sync_member`, `syncCrmSubscriptionState`                      | `20260630053403…sql:81`                                              |
| **`owner_id`**                                                       | uuid **bez FK**                                                  | panel (`updateCrmLead`, `bulkUpdateCrmLeads`)                             | `:82`                                                                |
| **`tags`**                                                           | text[] NOT NULL, domyślnie `'{}'`                                | panel, billing, newsletter, mosty wydarzeń i członkostwa                  | `:83`                                                                |
| `follow_up_at`                                                       | timestamptz; zdenormalizowane MIN(due_at) otwartych zadań        | trigger `tg_crm_tasks_sync_lead_follow_up`                                | `20260721120000…sql:129-158`                                         |
| `last_activity_at`, `source_count`                                   | timestamptz / int                                                | upserty                                                                   | `20260630053403…sql:85-86`                                           |
| `newsletter_status`                                                  | text (lustro `newsletter_subscribers.status`)                    | `newsletter_to_lead`, `crm_upsert_lead_from_subscriber`                   | `:87`; `20260708151417…sql:75-77`                                    |
| `marketing_consent`                                                  | bool, domyślnie false                                            | tylko zweryfikowane kanały (DOI newslettera, konto, księga zgód wydarzeń) | `:88`; `20261012180900…sql:36-42`                                    |
| `aliases`                                                            | jsonb (historia e-maili, telefonów, firm, `sources`, `custom.*`) | `crm_upsert_from_form`                                                    | `20260706201356…sql:3`; `20260706215313…sql:66-126`                  |
| `company_id`, `position`, `linkedin_url`, `country`                  | uuid FK `crm_companies` / text                                   | profil, formularze                                                        | `20260706201356…sql:4-7`, `:49-50`                                   |
| **`source_type`**                                                    | text NOT NULL, domyślnie `'manual'`, CHECK                       | mosty                                                                     | `20260722094744…sql:1-3`; ostatni CHECK `20260926090000…sql:206-210` |
| **`score`**, **`score_band`**, `score_breakdown`, `score_updated_at` | int / text CHECK hot\|warm\|cool\|cold / jsonb                   | `compute_crm_lead_score`                                                  | `20260718130000…sql:41-56`                                           |
| `club_applied_at`, `club_application_count`, `club_specializations`  | –                                                                | moduł klubów                                                              | `20260811111733…sql:1-4`                                             |

Pozostałe elementy modelu:

- **Klucz złożony** `crm_leads_tenant_id_key UNIQUE (tenant_id, id)` istnieje pod klucze obce bezpieczne względem najemcy (`20260823160000_event_sponsors_companies.sql:219-222`).
- **RLS**: odczyt, zapis i aktualizacja dla admin/editor w `current_tenant_id()` albo super_admin; usuwanie tylko admin (`20260630053403…sql:97-121`).
- **Widok** `crm_leads_all` (super admin, `security_invoker`) (`20260718130000…sql:43-50`).
- **Powiązane tabele**: `crm_lead_notes` (`20260630053403…sql:131-140`), `crm_consent_log` (`:33-49`), `crm_companies` (`types.ts:4979-5002`), `event_person_crm_links` (most wydarzeń, `20260926090000…sql:222-242`), `member_crm_sync_pending` (`20260912100000…sql:3-13`).

##### 1a. Etap (`crm_stage`) a cykl życia

| Wartość     | Etykieta PL w panelu | Kto ustawia automatycznie                                                                                                                   |
| ----------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `new`       | Nowy                 | każdy INSERT (domyślna)                                                                                                                     |
| `contacted` | Skontaktowano        | tylko ręcznie                                                                                                                               |
| `qualified` | Kwalifikowany        | `crm_sync_member` przy `manual_revoke`, gdy było `won` (`20260912100000…sql:102-105`)                                                       |
| `proposal`  | Oferta               | tylko ręcznie                                                                                                                               |
| `won`       | Wygrana              | `syncCrmSubscriptionState` dla customer/paused (`src/lib/billing/purchaseEffects.server.ts:307-311`), `crm_sync_member` przy `manual_grant` |
| `lost`      | Przegrana            | tylko ręcznie                                                                                                                               |
| `archived`  | Archiwum             | `syncCrmSubscriptionState` dla churned (`purchaseEffects.server.ts:310`)                                                                    |

Etykiety: `src/routes/admin.crm.index.tsx:232-238` (PL) i `:305-311` (EN).

Kolejność etapów jest kontraktem:

- w TS żyje w `LEAD_STAGE_ORDER` (`src/lib/crm/leadListSpec.ts:77-85`),
- test czyta `CREATE TYPE` z pierwszej migracji (`src/lib/crm/__tests__/leadListSpec.test.ts:482-485`),
- duplikat typu i tablicy jest w `admin.crm.index.tsx:156-157`.

Wywołania stanu subskrypcji: zakup → `customer` (`purchaseEffects.server.ts:785`), anulowanie → `churned` (`:981`, `:1011`), pauza → `paused` (`:1060`), wznowienie → `customer` (`:1088`), zwrot → `churned` (`src/lib/billing/refunds.server.ts:1200-1201`).

##### 1b. Segment pochodzenia (`source_type`), zmieniany tylko w górę

- **Wartości** (ostatni CHECK): `registered, paid_subscriber, event_participant, speaker, expert, contact_form, newsletter, manual, club_application, careers, event_cfp` (`20260926090000…sql:207-210`).
- **Ranga** `_crm_source_type_rank`: manual 10 < contact_form = newsletter 20 < registered 30 < event_participant 40 < event_cfp 50 < speaker 60 < club_application = careers = expert 70 < paid_subscriber 90 (`20260926090000…sql:293-313`). Funkcja tylko dla service_role (`:315-316`).
- **Filtr „źródło” na liście leadów nie używa `source_type`.** Działa heurystycznie: `form`/`newsletter`/`import` z `newsletter_status` i `source_count` (`src/lib/crm/leadListSpec.ts:94`, `:200-216`, `:244-251`).

##### 1c. Konwencje tagów (segmenty de facto)

| Tag                                                         | Źródło                                    | Dowód                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `customer`, `plan:<tier>`, `subscription:paused`, `churned` | billing                                   | `purchaseEffects.server.ts:345-355`                                                    |
| `plan:<tier>`, `membership:manual`                          | ręczne nadanie członkostwa                | `20260912100000…sql:96-101`                                                            |
| `temat:<t>`, `lista:<l>`                                    | preferencje newslettera (tylko dokładane) | `src/lib/newsletter/preferences.ts:119-124`; `src/lib/newsletter.functions.ts:478-505` |
| `event:<slug>`, `cfp:<status>`, `…:checkin`                 | mosty wydarzeń                            | `20260927000101_event_cfp_part2.sql:84-85`; `20260926150001…part2.sql:703-705`         |

##### 1d. Właściciel

- `owner_id` to uuid bez FK (`20260630053403…sql:82`).
- Picker właściciela `listStaffUsers` pokazuje role admin/editor/super_admin w tenancie wołającego (`src/lib/crm.functions.ts:1085-1125`).
- Brak automatycznego przydziału (round-robin, reguły).
- Przypomnienie o zadaniu trafia do pierwszego niepustego z: assignee → owner → created_by (`20260721120000…sql:294`).

##### 1e. Scoring

- **Ustawienia**: `crm_scoring_settings`, jedna pozycja na najemcę (enabled, half_life_days, horizon_days, progi hot 80 / warm 45 / cool 20, `weights` nadpisujące domyślne) (`20260718130000…sql:80-100`).
- **Wagi domyślne**: `crm_scoring_default_weights()`. Najnowsza wersja z `page_view` (`20260721113000…sql:22-45`). Lustro TS: `src/lib/crm/scoring.ts:23-62`.
- **Rdzeń**: `compute_crm_lead_score(uuid)`, najnowsza wersja `20260721113000…sql:52`. Konto szuka po `profiles(tenant_id, lower(email))` (`:92-96`). Funkcja tylko dla service_role.
- **RPC dla panelu**: `recompute_crm_lead_score` (`20260718130000…sql:468`) i `recompute_crm_lead_scores` z porcjami i kursorem (`:504`). Serwer: `recomputeLeadScore` / `recomputeAllLeadScores` (`crm.functions.ts:877`, `:895`).
- **Triggery sygnałów**: `trg_score_on_campaign_event`, `_subscriber`, `_contact_message`, `_event_rsvp`, `_resource_download`, `_purchase`, `_comment`, `_donation`, `_lead_change` (`20260718130000…sql:583-759`), `trg_score_on_post_view` (`20260721113000…sql:349`).
- **Wynik zmienia się tylko przez UPDATE**, który emituje `crm_lead.updated.v1` bez pola score/band (`20260711220607…sql:249-252`).

---

#### 2. Zadania: `public.crm_tasks`

| Pole                                       | Typ / reguła                                              | Dowód (`20260721120000_crm_tasks_followups.sql`) |
| ------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------ |
| `id`, `tenant_id`                          | domyślnie `current_tenant_id()` (poprawka 20260725182103) | `:23-26`; `20260725182103…sql:2`                 |
| `lead_id`                                  | FK `crm_leads` ON DELETE CASCADE                          | `:27`                                            |
| `title`                                    | text NOT NULL, niepusty                                   | `:28`                                            |
| `note`                                     | text                                                      | `:29`                                            |
| `due_at`                                   | timestamptz NOT NULL                                      | `:30`                                            |
| `status`                                   | `open` / `done` / `cancelled`                             | `:31`                                            |
| `assignee_id`                              | FK `auth.users` SET NULL                                  | `:32`                                            |
| `created_by`                               | domyślnie `auth.uid()`                                    | `:33`                                            |
| `reminded_at`                              | znacznik przypomnienia (raz na termin)                    | `:34`                                            |
| `completed_at`, `created_at`, `updated_at` | –                                                         | `:35-37`                                         |

Mechanika:

- **Brakuje** pól typu (call/email/todo), priorytetu, kolejki oraz źródła (workflow/ścieżka) (`types.ts:5374-5390`).
- **RLS**: odczyt i zmiana dla staffu w tenancie; INSERT wymaga `created_by = auth.uid()`; usuwa admin albo autor (`:56-86`).
- **Triggery**:
  - `trg_crm_tasks_normalize` ustawia `completed_at` i zeruje `reminded_at` przy przesunięciu terminu (`:93-126`),
  - `trg_crm_tasks_sync_lead_follow_up` (`:129-158`),
  - `trg_crm_tasks_emit_events` emituje `crm_task.created.v1` i `crm_task.completed.v1` (`:162-192`).
- **Przypomnienia**:
  - `run_crm_task_reminders()` (`:261-330`) pobiera zadania z `FOR UPDATE SKIP LOCKED`, woła `enqueue_notification(kind 'crm_task')` i emituje `crm_task.due.v1`,
  - pg_cron `crm-task-reminders` `*/10 * * * *` (`:331-342`),
  - dodatkowo `jobsTick` (`src/lib/server/jobsTick.server.ts:314-318`) i `invoke_community_cron('crm-task-reminders')` (`20260731210000…sql:240-243`).
- **Funkcje serwerowe** (`src/lib/crm-tasks.functions.ts`): `listCrmLeadTasks` :43, `listCrmDueTasks` :68, `createCrmTask` :92 (idempotencja `crm.add_task`), `updateCrmTask` :141, `deleteCrmTask` :153, `importCrmLeads` :211 (RPC `crm_import_leads`, `20260721120000…sql:346`).
- **UI**: `src/components/admin/crm/LeadTasksPanel.tsx`, `src/components/admin/crm/FollowUpsPanel.tsx`.
- **Pośredni link**: `user_todos.source_task_id → crm_tasks` (`20260907152903…sql:37`).

---

#### 3. Lead ↔ konto (`profiles`) ↔ `newsletter_subscribers`

| Relacja                  | Mechanizm                                                                                                                                                                   | Dowód                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| konto → lead             | trigger `profile_sync_crm_lead` AFTER INSERT/UPDATE (email, imię, telefon, firma…) → `crm_upsert_lead_from_profile(uuid)`; **nie ustawia `source_type`** (zostaje `manual`) | `20260722093022…sql:6-67`, `:74-77`                                                                 |
| subskrybent → lead (1)   | `trg_newsletter_to_lead` → `crm_upsert_lead` + `newsletter_status` + `crm_consent_log`                                                                                      | `20260630053403…sql:275`; najnowsze ciało `20260708151417…sql:61-120`                               |
| subskrybent → lead (2)   | `subscriber_sync_crm_lead` → `crm_upsert_lead_from_subscriber(uuid)`                                                                                                        | `20260722080948…sql:70-102`, `:170-174`                                                             |
| subskrybent → lead (3)   | serwer `syncToCrm` → RPC `crm_upsert_from_form` + `tagCrmLead`                                                                                                              | `src/lib/newsletter.functions.ts:442-505`                                                           |
| subskrybent → lead (4)   | przepis workflow `newsletter-confirmed-to-crm` (`create_crm_lead`)                                                                                                          | `20260711204000_workflow_engine.sql:355-363`                                                        |
| subskrybent ↔ konto      | `newsletter_subscribers.user_id` (nullable, bez FK), ustawia `join_us_link_and_backfill`                                                                                    | `20260716231319…sql:4-9`, `:15-40`                                                                  |
| konto ↔ lead w odczytach | po `profiles.email` / `contact_email` (ilike): `getCrmLead`, `getCrmLeadMembership`, scoring, `syncCrmSubscriptionState`, `crm_sync_member`                                 | `crm.functions.ts:155-170`, `:297`; `purchaseEffects.server.ts:325-341`; `20260912100000…sql:79-80` |
| lejek                    | `crm_funnel_view`: subskrybenci LEFT JOIN `profiles` i `crm_leads` po `lower(email)`                                                                                        | `20260722094744…sql:48-92`                                                                          |

**Uwaga**: `authenticated` nie ma SELECT na `profiles.email`, dlatego dopasowanie po e-mailu idzie przez service-role albo SECURITY DEFINER (`crm.functions.ts:1127-1135`).

---

#### 4. Funkcje SQL zapisujące CRM (wszystkie SECURITY DEFINER)

| Funkcja                                             | Sygnatura                                                            | Grant                          | Zachowanie                                                                                                                                         | Dowód                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `crm_upsert_lead`                                   | (uuid, text×5, bool newsletter, bool marketing) → uuid               | **tylko service_role**         | dedup po e-mailu albo `phone_norm`; COALESCE pól; `marketing_consent` OR                                                                           | `20260630060254…sql:29-79`; grant `20260724090200…sql:17-22`                       |
| `crm_upsert_from_form`                              | (uuid, text×9, jsonb `_custom`) → uuid; także wariant 10-argumentowy | **tylko service_role**         | dedup po e-mailu, potem imię+nazwisko(+firma); historia w `aliases`, `aliases.custom.*`; nowy lead z `stage 'new'` i `newsletter_status 'pending'` | `20260706215313…sql:4-139`; `20260708120000…sql:15-26`; `20261007120500…sql:39-42` |
| `crm_upsert_lead_from_profile` / `_from_subscriber` | (uuid)                                                               | service_role                   | ON CONFLICT po `(tenant_id, email_norm)`                                                                                                           | `20261007140500…sql:100-103`                                                       |
| `crm_sync_member`                                   | (user, tenant, tier, actor, reason) → jsonb                          | service_role                   | etap won/qualified, tagi `plan:*`; kolejka ponowień `member_crm_sync_pending`                                                                      | `20260912100000…sql:53-130`                                                        |
| `crm_leads_marketing_consent_withdraw`              | (uuid[])                                                             | staff CRM                      | `marketing_consent=false` + `crm_consent_log` given=false                                                                                          | `20261012180900…sql:345`                                                           |
| `crm_enqueue_lead_push`                             | (lead, endpoint?) → int                                              | authenticated (staff w środku) | `crm_lead.pushed.v1` do outboxu z pominięciem `forward_stages`                                                                                     | `20260802153008…sql:130-188`                                                       |
| `crm_import_leads`                                  | (jsonb, text) → jsonb                                                | staff                          | porcje ≤500, scalanie przez `crm_upsert_from_form`                                                                                                 | `20260721120000…sql:346`                                                           |

##### 4a. Akcje CRM w silniku workflow (`run_workflow_step`, najnowsza wersja)

- **`create_crm_lead`** (`20261007140700…sql:151-160`)
  - Woła `crm_upsert_lead(tenant, payload[email_from|email], first_name_from, last_name_from, NULL, NULL, newsletter, marketing)`.
  - **Parametr `marketing` może włączyć zgodę.** To ryzyko świadomie nazwane w `20261012180900…sql:58-59`.
- **`create_crm_task`** (`:162-218`)
  - E-mail bierze z payloadu albo z `profiles` przez `user_from`/`user_id`, zakłada lead przez `crm_upsert_lead`.
  - Dedup: jedno **otwarte** zadanie o danym tytule na lead.
  - `due_at = now() + due_days` (domyślnie 3, dokładność do dni), `assignee_id = owner_id` leada, `created_by = NULL`.
  - **Gdy lead nie ma właściciela, nikt nie dostaje przypomnienia** (`20260721120000…sql:294-296`).
- **Wykonanie**:
  - `tg_run_workflows_for_event` AFTER INSERT na `domain_events`, synchronicznie, warunek `payload @> condition`, limit głębokości `pg_trigger_depth() > 8`, wpis do `workflow_runs` succeeded/failed (`20260711221058…sql:210-266`).
  - **Brak opóźnień i harmonogramu kroków.**
- **Przepisy retencyjne CRM**: `subscription-cancel-scheduled-crm-task` i `subscription-canceled-crm-task` (`20260723140000…sql:216-250`).
- **Lustro TS**: `WORKFLOW_ACTIONS` i `WORKFLOW_ACTION_PARAMS` (`src/lib/admin/workflows.ts:27-101`).

---

#### 5. Zdarzenia domenowe CRM (szyna)

| Zdarzenie                                                    | Emiter                                               | Payload                                       | Dowód                                    |
| ------------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------- | ---------------------------------------- |
| `crm_lead.created.v1`                                        | `tg_crm_leads_emit_events`                           | email, stage, first_name, last_name, owner_id | `20260711220607…sql:224-264`             |
| `crm_lead.stage_changed.v1`                                  | jw.                                                  | email, old_stage, new_stage, owner_id         | `:240-247`                               |
| `crm_lead.updated.v1`                                        | jw., **każdy inny UPDATE** (także score i follow_up) | **tylko** email, stage                        | `:249-252`                               |
| `crm_lead.pushed.v1`                                         | `crm_enqueue_lead_push` (tylko outbox)               | email, stage, pushed_by                       | `20260802153008…sql:157-176`             |
| `crm_note.created.v1`                                        | `tg_crm_lead_notes_emit_events`                      | lead_id, author_id                            | `20260711220607…sql:266-285`             |
| `crm_task.created/completed/due.v1`                          | triggery i skaner                                    | lead_id, title, due_at, assignee_id, email    | `20260721120000…sql:162-192`, `:315-323` |
| `newsletter_subscriber.subscribed/confirmed/unsubscribed.v1` | `tg_newsletter_subscribers_emit_events`              | email, imię, język, status, source            | `20260711220607…sql:287-330`             |

- **Katalog w TS**: `src/lib/realtime/domainEvents.ts:10-60`.
- **Inwalidacja klucza React Query**: `src/lib/realtime/eventInvalidationMap.ts:43-84`.
- **Format nazwy** wymuszony CHECK: `^[a-z0-9_]+\.[a-z0-9_]+\.v[0-9]+$` (`20260711200000_domain_event_bus.sql:34`).
- **W katalogu brakuje zdarzeń**: rejestracja konta, uderzenie w paywall, porzucony checkout, nieudana płatność. Są tylko `subscription.*` i `billing_document.*` (`domainEvents.ts:46-59`).

---

#### 6. Lejek `/admin/crm/funnel`

- **Trasa**: `src/routes/admin.crm.funnel.index.tsx:57-71`, z ręcznym `head`, bez `adminPageHead`.
- **Funkcje serwerowe** (`src/lib/crm-funnel.functions.ts`):
  - `listFunnelSubscribers` :53 (filtry: status `subscribed|pending|unsubscribed|bounced|complained`, audience `all|registered|unregistered|contact|non_contact`, source, język, daty),
  - `getFunnelSubscriber` :98,
  - `funnelStats` :123,
  - `bulkUnsubscribeFunnel` :146,
  - `convertFunnelToContacts` :167 (zgoda z dowodu subskrybenta, `funnelMarketingConsent`),
  - `updateFunnelStatus` :246.
- **Metryki**: RPC `crm_funnel_stats()` (SECURITY INVOKER) zwraca `total, subscribed, pending, unsubscribed, registered, contacts` (`20260802153008…sql:1-29`). Kafelki: `admin.crm.funnel.index.tsx:362-367`.
- **Brakuje**: konwersji między etapami, okien czasowych, kohort i czasu w etapie.
- **Brak odświeżania na żywo**: klucze `["crm-funnel"]` i `["crm-funnel-stats"]` (`:266`, `:281`) nie występują w `eventInvalidationMap`.
- **Pulpit admina**: `admin_dashboard_crm(...)` liczy newLeads, won, lost, hot, consented, stan etapów **na teraz**, źródła, kraje, serie, zadania (`20260912110000…sql:267-372`). `tasksOpen` liczy też anulowane (`status <> 'done'`, `:361-362`). Widok: `src/components/admin/dashboard/CrmPanel.tsx` (ChartCard, biChart, LEAD_STAGE_ORDER).

---

#### 7. Webhooki CRM

- **Tabela `crm_webhook_endpoints`**: endpoint_id PK/FK do `integration_endpoints`, `auth_kind` hmac|bearer, `forward_stages crm_stage[]` (domyślnie `{new}`), `consent_mapping` jsonb, `workspace_id`; trigger przypinający tenanta; RLS dla staffu (`20260802153008…sql:39-96`).
- **Router `tg_route_domain_event_to_integrations`**: zdarzenia `crm_lead.created/updated/stage_changed` trafiają do partnera CRM tylko wtedy, gdy `new_stage`/`stage ∈ forward_stages` (`:98-128`).
- **Dispatcher** (`src/lib/integrations/dispatch.functions.ts:98`):
  - `runIntegrationDispatch` czyta świeży snapshot leada (`:53-95`),
  - wywoływany z `jobsTick` (`jobsTick.server.ts:372-373`) i z `pushLeadToPartners` (`crm.functions.ts:606-629`).
- **Formaty** (`src/lib/integrations/formats.ts`):
  - `CRM_PARTNER_EVENT_TYPES` :109-114,
  - HubSpot wysyła tylko email, firstname i lastname, **bez lifecyclestage** (:437-481).
- **UI**: `src/components/admin/crm/CrmPartnerEndpointsPanel.tsx`, zakładka „integrations” w `admin.crm.index.tsx:399-416`.
- **Legacy**: `crm_integrations` (Merydian), dane zmigrowane do nowego modelu (`20260802153008…sql:190-260`).

---

#### 8. Funkcje serwerowe CRM (warstwa TS)

Wszystkie stoją za `requireCrmStaff` (admin/editor/super_admin + MFA aal2, `src/integrations/supabase/require-staff.ts:31`, `:109-132`). Głębokie wyniki wracają jako string JSON.

| Funkcja                                              | Linia (`src/lib/crm.functions.ts`) | Uwaga                                                                                               |
| ---------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `listCrmLeads`                                       | 78                                 | paginacja i sortowanie w SQL przez `leadListSpec`                                                   |
| `getCrmLead`                                         | 99                                 | wiadomości, subskrypcje, zgody, notatki, avatar                                                     |
| `updateCrmLead`                                      | 198 (wejście 175)                  | stage/owner/tags/follow_up; **bez wpisu audit przy zmianie etapu**                                  |
| `getCrmLeadMembership`                               | 297                                | membership_tiers / user_subscriptions / grants / seats; dane dla warunku „ma plan”                  |
| `getCrmLeadTimeline` / `buildLeadTimeline`           | 761 / 637                          | contact_messages, newsletter, zgody, notatki, `audit_log`; **bez zadań, otwarć i kliknięć e-maili** |
| `bulkUpdateCrmLeads`                                 | 942 (wejście 920)                  | stage, owner, add/remove_tags, wycofanie zgody przez RPC                                            |
| `pushLeadToPartners`                                 | 606                                | –                                                                                                   |
| `upsertCrmScoringSettings` / `getCrmScoringSettings` | 834 / 823                          | –                                                                                                   |
| `listStaffUsers`                                     | 1085                               | picker właściciela                                                                                  |

Typy wpisów osi czasu: `submit|consent|note|stage_change|webhook|newsletter|event` (`src/lib/crm/leadTimeline.ts:18-19`).

---

#### 9. Duplikaty i niespójności istotne dla nowej ścieżki

1. **Cztery ścieżki newsletter → CRM** (§3). Ścieżka powinna konsumować zdarzenia szyny i nie dokładać kolejnego writera.
2. **Rejestracja nie podnosi `source_type` do `registered`.** `crm_upsert_lead_from_profile` go nie ustawia (`20260722093022…sql:35-45`), a backfill `20260722094744…sql:22-26` był jednorazowy.
3. **`syncCrmSubscriptionState` przy istniejącym leadzie** zmienia tylko stage, tags i last_activity, bez `paid_subscriber` (`purchaseEffects.server.ts:359-367`).
4. **`newsletter_to_lead` sprawdza `NEW.status = 'confirmed'`** (`20260708151417…sql:79`). Takiego statusu w użyciu nie ma (`crm-funnel.functions.ts:39`), więc gałąź jest martwa dla UPDATE.
5. **Martwy odnośnik**: komentarz w `purchaseEffects.server.ts:380-382` wskazuje nieistniejący test `leadSourceTypeContract.test.ts`. Kontrakt pilnują harnessy: `scripts/pg-harness/harness.sql:867`, `scripts/events-harness/harness.sql:1646`.
6. **Dwie wersje migracji `crm_webhook_endpoints`** (`20260802131000`, `20260802153008`) oraz **dwie wersje `crm_tasks` i scoringu** (Lovable `20260721065557`, `20260719083815`). Obowiązują najpóźniejsze.
7. **Trasy CRM nie używają `adminPageHead`**, wbrew AGENTS.md (`admin.crm.index.tsx:142-152`, `admin.crm.$id.tsx:160-174`, `admin.crm.funnel.index.tsx:57-71`).

#### 10. Wnioski dla silnika ścieżek (rozszerzyć, nie dublować)

| Element ścieżki                                | Co już jest                                                                                                                                               | Czego brakuje                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Wyzwalacz „zmiana etapu / nowy lead / zadanie” | `crm_lead.created/stage_changed`, `crm_task.*`, `newsletter_subscriber.*`                                                                                 | „wynik stał się hot” (brak zdarzenia i pola w payloadzie)                                |
| Krok „ustaw etap cyklu życia”                  | tylko `crm_stage` (pipeline)                                                                                                                              | kolumna i ENUM cyklu życia, historia etapów, akcja w `run_workflow_step`                 |
| Krok „utwórz zadanie CRM”                      | `create_crm_task` (dedup, due_days, owner)                                                                                                                | dokładność do godzin, przypisanie gdy brak właściciela, typ i priorytet, link do ścieżki |
| Warunek „segment / ma plan / otworzył e-mail”  | tagi, `source_type`, `score_band`, `newsletter_campaign_events(kind open\|click)` po `subscriber_id` (`20260712150000…sql:14-23`), `getCrmLeadMembership` | ewaluator warunków poza `@>` na payloadzie                                               |
| Krok „dodaj/usuń z listy newslettera”          | tag `lista:*` (tylko dokładany), `newsletter_subscribers.meta.mailing_lists`                                                                              | akcja usunięcia i spójny writer                                                          |
| Cele / wyjście z sekwencji                     | `crm_lead.stage_changed.v1`, wycofanie `marketing_consent`                                                                                                | model zapisów (enrollment), znacznik wyjścia                                             |
| Lejek ścieżki                                  | `CrmPanel` i biChart, `crm_funnel_stats`                                                                                                                  | metryki na krok, konwersje, trwała historia (domain_events trzymają 90 dni)              |

### Do reużycia

- **crm_leads (tabela kontaktu) + UNIQUE (tenant_id,email_norm) + crm_leads_tenant_id_key UNIQUE (tenant_id,id)** (`supabase/migrations/20260630053403_8783ac8b-8092-4a26-975b-be3447edc0c6.sql:72-91; supabase/migrations/20260823160000_event_sponsors_companies.sql:219-222`): Zapisy na ścieżkę (enrollment) kluczuj FK złożonym (tenant_id, lead_id) -> crm_leads (tenant_id, id), jak event_person_crm_links. Kontakt identyfikuj przez email_norm i nie twórz równoległej tabeli kontaktów.
- **crm_stage ENUM + LEAD_STAGE_ORDER / LeadStageSchema** (`src/lib/crm/leadListSpec.ts:77-92`): Jedyne źródło wartości etapu w TS dla kroku 'ustaw etap', warunków i wykresów lejka. Nie kopiuj tablicy (admin.crm.index.tsx:156-157 to już duplikat).
- **crm_upsert_lead (SQL, service_role)** (`supabase/migrations/20260630060254_f371acc7-e6e1-455e-b9df-6dd6653fc03a.sql:29-79`): Zapewnij lead dla e-maila z wyzwalacza, wołając z funkcji SECURITY DEFINER silnika ścieżek. Parametru _marketing nie ustawiaj na true (zgoda tylko z dowodu).
- **crm_upsert_from_form (11-arg z \_custom)** (`supabase/migrations/20260706215313_d95aee2a-cf4d-423c-b8d4-8279e965be39.sql:4-139`): Bogatszy upsert z historią aliases.sources. Użyj, gdy wyzwalacz niesie dane formularza (np. lead magnet), żeby źródło trafiło do aliases.sources.
- **\_crm_source_type_rank** (`supabase/migrations/20260926090000_event_organizer_foundation.sql:293-319`): Podnoszenie segmentu tylko w górę (np. rejestracja -> registered, płatność -> paid_subscriber). Ta sama reguła co most wydarzeń, bez nowego słownika.
- **run_workflow_step: akcje create_crm_lead / create_crm_task** (`supabase/migrations/20261007140700_runtime_errors_seats_workflow_passwords.sql:62-240`): Rozszerz zamknięty CASE o nowe akcje (set_crm_stage, add/remove_tag, assign_owner, newsletter_list_add/remove, send_email, wait) albo wołaj tę funkcję z executora kroków ścieżki. Logika create_crm_task (e-mail z payloadu lub profilu, dedup otwartego zadania po tytule) nadaje się wprost dla kroku 'utwórz zadanie CRM'.
- **tg_run_workflows_for_event + workflow_definitions/workflow_runs/workflow_templates** (`supabase/migrations/20260711221058_9dbe5dcf-e0b7-4760-a0a7-c40e80042a56.sql:210-266; supabase/migrations/20260711204000_workflow_engine.sql:28-60`): Wzorzec dopasowania wyzwalacza (trigger_event_type + payload @> condition), limitu głębokości i logu przebiegów. Zapis na ścieżkę może startować z tego samego triggera na domain_events, bez drugiej szyny.
- **WORKFLOW_ACTIONS / WORKFLOW_ACTION_PARAMS (lustro TS)** (`src/lib/admin/workflows.ts:27-101`): Dopisuj nowe akcje kroków równolegle do CASE w SQL; test parytetu pilnuje zgodności. Gotowy deskryptor parametrów (text/boolean/roles) napędza formularz kroku w edytorze.
- **crm_tasks + triggery + run_crm_task_reminders + cron crm-task-reminders** (`supabase/migrations/20260721120000_crm_tasks_followups.sql:23-342`): Krok 'utwórz zadanie CRM' wstawia wiersz crm_tasks; przypomnienia, follow_up_at, zdarzenia crm_task.* i odświeżanie panelu działają bez nowego kodu. Ustaw assignee_id jawnie, bo przy braku ownera nikt nie dostanie przypomnienia.
- **crm-tasks.functions.ts (createCrmTask, listCrmDueTasks, listCrmLeadTasks)** (`src/lib/crm-tasks.functions.ts:43-160`): Wzorzec serwera (requireCrmStaff, tenant z leada, idempotencja withCommandIdempotency). UI LeadTasksPanel / FollowUpsPanel pokaże zadania utworzone przez ścieżkę.
- **emit_domain_event + tg_crm_leads_emit_events** (`supabase/migrations/20260711220607_555aaf71-75e5-4153-a123-4d3b78715ffc.sql:64-100, 224-264`): Zdarzenia crm_lead.created/stage_changed.v1 jako wyzwalacze i cele ścieżki. Nowe zdarzenia (np. journey.enrolled.v1, crm_lead.lifecycle_changed.v1, crm_lead.score_band_changed.v1) emituj tą samą funkcją; połykanie błędów w triggerze to doktryna.
- **DOMAIN_EVENT_TYPES + eventInvalidationMap** (`src/lib/realtime/domainEvents.ts:10-60; src/lib/realtime/eventInvalidationMap.ts:43-84`): Synchronizacja panelu na żywo: każde nowe zdarzenie ścieżki musi dostać wpis w obu plikach (test pokrycia). Przy okazji dodaj brakujące klucze crm-funnel / crm-funnel-stats.
- **compute_crm_lead_score / score_band / crm_scoring_settings** (`supabase/migrations/20260721113000_crm_lead_scoring_page_views.sql:22-320; supabase/migrations/20260718130000_crm_lead_scoring.sql:80-100,468-560`): Warunek if/then 'pasmo = hot' lub próg score. Wyzwalacz 'stał się hot' wymaga emisji zdarzenia przy zmianie score_band w compute (dziś tylko crm_lead.updated.v1 bez band).
- **buildLeadFilterSpec / applyLeadFilterSpec / matchesLeadRow (LeadListFilterSchema)** (`src/lib/crm/leadListSpec.ts:94-235`): Opis segmentu (stage, band, tags, owner, score, consent, kraj, daty) w jednym schemacie Zod dla serwera i klienta. Użyj go jako definicji segmentu w warunku ścieżki i jako filtra zapisu masowego.
- **syncCrmSubscriptionState (mapowanie customer/paused/churned -> stage/tags)** (`src/lib/billing/purchaseEffects.server.ts:304-397`): Istniejąca reguła cyklu życia klienta. Mapowanie etapu cyklu życia (customer/churned) powinno ją rozszerzyć albo przenieść do SQL, a nie powielać w silniku ścieżek.
- **crm_sync_member + member_crm_sync_pending** (`supabase/migrations/20260912100000_member_crm_sync_recovery.sql:3-130`): Wzorzec synchronizacji odpornej na błędy (pending + ponowienia, advisory lock po e-mailu). Zastosuj do kroków ścieżki zapisujących CRM po stronie serwera.
- **crm_leads_marketing_consent_withdraw + crm_consent_log** (`supabase/migrations/20261012180900_marketing_consent_unsubscribe_contact_crm_staff.sql:345; supabase/migrations/20260630053403_8783ac8b-8092-4a26-975b-be3447edc0c6.sql:33-49`): Warunek wyjścia ze ścieżki marketingowej i bramka kroku 'wyślij e-mail': brak marketing_consent albo wpis given=false wyklucza z wysyłki.
- **crm_webhook_endpoints + tg_route_domain_event_to_integrations + integration_deliveries** (`supabase/migrations/20260802153008_a93ca8f9-eca2-4eea-b5a0-5831e3047023.sql:39-128`): Zmiany etapu wykonane przez ścieżkę trafią automatycznie do partnerów CRM (forward_stages) i HubSpot przez istniejący outbox, bez nowego kanału.
- **getCrmLeadMembership** (`src/lib/crm.functions.ts:297-410`): Gotowe złączenie lead -> profil -> membership_tiers/user_subscriptions/membership_grants/organization_seats. Dane dla warunku 'ma plan'; po przeniesieniu do SQL także w executorze.
- **buildLeadTimeline / LeadTimelineEventType** (`src/lib/crm.functions.ts:637-759; src/lib/crm/leadTimeline.ts:18-60`): Dodaj typ wpisu 'journey' (zapis, krok, wyjście), żeby karta leada pokazywała przebieg ścieżki obok formularzy i zgód.
- **crm_funnel_view / crm_funnel_stats / funnelStats** (`supabase/migrations/20260722094744_085703fb-8bf3-4d4b-91d7-cd8755bcf1e6.sql:48-95; supabase/migrations/20260802153008_a93ca8f9-eca2-4eea-b5a0-5831e3047023.sql:1-29; src/lib/crm-funnel.functions.ts:123-144`): Wzorzec agregacji COUNT(*) FILTER w SECURITY INVOKER. Rozszerz o metryki etapów i kroków ścieżki zamiast liczyć w JS.
- **CrmPanel + ChartCard + biChart + admin_dashboard_crm** (`src/components/admin/dashboard/CrmPanel.tsx:1-40; supabase/migrations/20260912110000_admin_dashboard_aggregates.sql:267-374`): Gotowe komponenty wizualizacji lejka w kolejności LEAD_STAGE_ORDER. Użyj ich w widoku statystyk ścieżki.
- **requireCrmStaff** (`src/integrations/supabase/require-staff.ts:31,132`): Bramka dla wszystkich funkcji serwerowych edytora ścieżek dotykających CRM (role admin/editor/super_admin + MFA aal2).
- **adminPageHead** (`src/lib/adminPageHead.ts:2-15`): Metadane nowego ekranu /admin/... ścieżek (AGENTS.md); przy okazji ujednolić trasy CRM.
- **tagCrmLead / crmTagsFromPreferences / mergeLists** (`src/lib/newsletter.functions.ts:478-505; src/lib/newsletter/preferences.ts:119-124`): Konwencja tagów lista:<l> / temat:<t>. Krok 'dodaj/usuń z listy newslettera' powinien aktualizować meta.mailing_lists subskrybenta i lustrzany tag tą samą funkcją normalizującą (dziś tylko dokładanie).

### Ograniczenia i bramki

- Funkcje zapisujące CRM (crm_upsert_lead, crm_upsert_from_form, crm_upsert_lead_from_profile/_subscriber, compute_crm_lead_score, crm_sync_member, run_workflow_step, run_crm_task_reminders, _crm_source_type_rank) mają GRANT wyłącznie dla service_role (20260724090200:17-22, 20261007120500:39-42, 20261007140500:100-103). Nowy kod woła je z funkcji SECURITY DEFINER lub z serwera spod service-role, nigdy z klienta.
- Tenant, firmę i użytkownika bierz z sesji (current_tenant_id(), auth.uid(), profil wołającego), nigdy z payloadu. W SQL używaj literalnych nazw RPC i tabel oraz zgodnych grantów: bramka CI generate:ts-sql-contract / check:ts-sql-contract (package.json:53-54, AGENTS.md).
- Kolejność crm_stage jest kontraktem: LEAD_STAGE_ORDER (leadListSpec.ts:77-85) i test czytający CREATE TYPE z 20260630053403 (leadListSpec.test.ts:482-485). Rozszerzenie ENUM wymaga ALTER TYPE ADD VALUE (nieużywalnego w tej samej transakcji), aktualizacji testu, mapy etykiet i harnessów. Etap cyklu życia lepiej zrobić osobną kolumną z CHECK niż mieszać z pipeline.
- crm_leads.source_type: nowy CHECK musi zawierać WSZYSTKIE dotychczasowe wartości, bo ostatni blok ADD CONSTRAINT w posortowanych migracjach jest źródłem prawdy (20260926090000:202-210). Lustra są w scripts/pg-harness/harness.sql:867 i scripts/events-harness/harness.sql:1646. Segment zmienia się tylko w górę przez _crm_source_type_rank.
- marketing_consent wolno włączyć wyłącznie ze zweryfikowanego kanału (DOI, konto, księga zgód wydarzeń), a wycofać przez crm_leads_marketing_consent_withdraw z wpisem crm_consent_log given=false (20261012180900:36-59). Krok ścieżki nie może ustawiać zgody, a kroki marketingowe e-mail muszą ją sprawdzać.
- run_workflow_step to zamknięty katalog CASE (nieznana akcja = RAISE). Każda nowa akcja wymaga pełnej podmiany funkcji (CREATE OR REPLACE z całym ciałem z ostatniej wersji 20261007140700), lustra w WORKFLOW_ACTIONS/WORKFLOW_ACTION_PARAMS (src/lib/admin/workflows.ts) i testu parytetu.
- Nowe zdarzenia: nazwa zgodna z CHECK ^[a-z0-9_]+\.[a-z0-9_]+\.v[0-9]+$ (20260711200000:34), wpis w DOMAIN_EVENT_TYPES i w eventInvalidationMap (test pokrycia), emisja przez emit_domain_event; triggery emitujące połykają błędy (EXCEPTION WHEN OTHERS -> RETURN NEW).
- Każdy UPDATE crm_leads emituje crm_lead.updated.v1 albo stage_changed.v1 i może trafić do outboxu partnerów (forward_stages). Zapisy masowe ścieżki generują zdarzenia i dostawy: zawężaj UPDATE do zmienionych wierszy (IS DISTINCT FROM). Kolumnowy trigger scoringu (trg_score_on_lead_change, 20260718130000:756-759) nie może wpaść w rekursję.
- Silnik workflow ma bezpiecznik pg_trigger_depth() > 8 i wykonuje się synchronicznie w transakcji INSERT domain_events (20260711221058:220-262). Kroki z opóźnieniem muszą iść do kolejki lub harmonogramu (jobs-tick / pg_cron), nie w triggerze.
- domain_events są czyszczone po 90 dniach (prune_domain_events, 20260711220607:333-343). Historia etapów i metryki lejka ścieżek nie mogą polegać na szynie i wymagają trwałej tabeli.
- Funkcje serwerowe CRM: middleware requireCrmStaff (admin/editor/super_admin + MFA aal2), głębokie wyniki jako string JSON w polu json (serializer TanStack Start, crm.functions.ts:1-3), tenant zadań i notatek bierz z leada (crm-tasks.functions.ts:96-103).
- crm_tasks: status CHECK open|done|cancelled; RLS INSERT dla staffu wymaga created_by = auth.uid() (20260721120000:62-69). Akcja z silnika (definer) zapisuje created_by NULL. Gdy assignee_id i owner_id są puste, przypomnienie nie trafia do nikogo (:294-296).
- Prywatne ekrany admina używają adminPageHead z metadanymi sekcji (AGENTS.md; src/lib/adminPageHead.ts). Atomy daty, czasu i selecta oraz tokeny rozmiarów są wspólne, z lokalnymi datami (AGENTS.md); dotyczy pól 'odczekaj X' i terminów zadań.
- Kontakt łączy się z kontem tylko po e-mailu, bo profiles.email nie ma SELECT dla authenticated (crm.functions.ts:1127-1135). Dopasowanie lead<->profil musi iść spod service-role lub SECURITY DEFINER z filtrem tenant_id na OBU zapytaniach.
- Nowe SQL: idempotentne migracje (IF NOT EXISTS, CREATE OR REPLACE, bezstanowe REVOKE/GRANT), testy pgTAP w supabase/tests (wzór: crm_tasks_followups_test.sql, crm_upsert_lead_authz_test.sql) i bramki check:sql-tenant-scope, check:sql-migration-replay, check:rpc-contract, check:types-freshness (types.ts regenerowane).

### Braki

- Brak etapu cyklu życia w stylu HubSpot (subscriber/lead/MQL/SQL/opportunity/customer/evangelist/other). Istnieje tylko pipeline crm_stage (20260630053403:4), a cykl życia trzeba wnioskować z source_type, tagów customer/churned i score_band.
- Brak trwałej historii zmian etapu (i przyszłego etapu cyklu życia). updateCrmLead nie pisze audit_log, a stage_changed żyje tylko w domain_events przez 90 dni (20260912110000:313-317). Bez tego nie da się liczyć konwersji ani czasu w etapie.
- Brak kolumny crm_leads.user_id / profile_id. Łączenie z kontem i subskrybentem idzie wyłącznie po e-mailu, w kilku miejscach osobnymi zapytaniami (email vs contact_email, ilike vs email_norm).
- Brak akcji silnika: set_crm_stage / set_lifecycle_stage, add_tag / remove_tag, assign_owner (z round-robin), newsletter_list_add / remove, send_email, wait/delay, if/then (warunek poza payload @>), split A/B, goal/unenroll (CASE w 20261007140700:62-240 zawiera tylko notify_*, create_crm_lead, create_crm_task, add_cross_reference).
- Brak modelu zapisów (enrollment): kto jest w której sekwencji, na którym kroku, next_run_at, wynik i powód wyjścia. Brak harmonogramu kroków z opóźnieniem, bo workflow wykonuje się synchronicznie w triggerze.
- Brak zdarzenia zmiany score_band, a crm_lead.updated.v1 niesie tylko email i stage (20260711220607:249-252). Wyzwalacze i warunki na score, tagach ani source_type nie są dziś możliwe przez payload @> condition.
- Brak zdarzeń domenowych dla rejestracji konta, uderzenia w paywall, porzuconego checkoutu i nieudanej płatności w DOMAIN_EVENT_TYPES (src/lib/realtime/domainEvents.ts:10-60). Są tylko subscription.* i billing_document.*.
- Rejestracja nie ustawia source_type='registered' (crm_upsert_lead_from_profile, 20260722093022:35-45); 'registered' dał tylko jednorazowy backfill (20260722094744:22-26). Istniejący lead płacącego klienta nie dostaje 'paid_subscriber' (purchaseEffects.server.ts:359-367).
- crm_tasks nie ma typu zadania (call/email/todo), priorytetu ani pola źródła (workflow_id / journey_id / step_id). Akcja create_crm_task ma termin tylko w dniach (due_days) i nie przypisuje nikogo, gdy lead nie ma właściciela.
- Lejek /admin/crm/funnel liczy tylko subskrybentów newslettera (6 liczników crm_funnel_stats). Brak konwersji między etapami, filtrów czasu, kohort i lejka na krok ścieżki; klucze crm-funnel / crm-funnel-stats nie są w eventInvalidationMap, więc brak odświeżania na żywo.
- Oś czasu leada nie pokazuje zadań, otwarć i kliknięć kampanii ani przebiegów workflow/ścieżek (buildLeadTimeline, crm.functions.ts:637-759).
- Formatter HubSpot nie przesyła lifecyclestage ani etapu, tylko email/firstname/lastname (src/lib/integrations/formats.ts:456-481).
- CRM nie wysyła e-maili do kontaktu (brak sendEmail / outboxu w src/lib/crm*). Krok 'wyślij e-mail' musi oprzeć się na module newslettera / e-mail, którego tu nie zbadano.
- Lista leadów filtruje 'źródło' heurystyką form/newsletter/import zamiast kolumną source_type (leadListSpec.ts:200-216). Segmentacja po pochodzeniu w warunkach ścieżki wymaga nowego predykatu.
- Cztery równoległe ścieżki zapisu newsletter -> CRM (trg_newsletter_to_lead, subscriber_sync_crm_lead, syncToCrm, przepis newsletter-confirmed-to-crm) oraz martwa gałąź status='confirmed' w newsletter_to_lead (20260708151417:79). Do uporządkowania przed dodaniem kroków listy newslettera.
- admin_dashboard_crm liczy tasksOpen i tasksOverdue z warunkiem status <> 'done', więc wlicza zadania anulowane (20260912110000:361-365).
- Trasy CRM (/admin/crm, /admin/crm/$id, /admin/crm/funnel) nie używają adminPageHead.
- Komentarz w purchaseEffects.server.ts:380-382 wskazuje nieistniejący test lib/crm/**tests**/leadSourceTypeContract.test.ts.

## 4. Zdarzenia domenowe i sygnały lejka

### Rozpoznanie: zdarzenia domenowe i sygnały lejka

#### 1. Szyna `public.domain_events` – stan faktyczny

| Element                        | Stan                                                                                                                                                                                                                                                                                                                                                                                 | Dowód                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Tabela                         | kolumny: `id, tenant_id, aggregate_type, aggregate_id (text), event_type, payload jsonb, correlation_id, actor_id, created_at`                                                                                                                                                                                                                                                       | supabase/migrations/20260711200000_domain_event_bus.sql:24-36                                                    |
| Indeksy                        | `(tenant_id, created_at)`, `(tenant_id, aggregate_type, aggregate_id, created_at)`, `(tenant_id, event_type, created_at)`, `(correlation_id)`                                                                                                                                                                                                                                        | 20260711200000:38-45                                                                                             |
| CHECK nazwy                    | `^[a-z0-9_]+(\.[a-z0-9_]+)+\.v[0-9]+$` (co najmniej 2 człony + `.vN`)                                                                                                                                                                                                                                                                                                                | 20260828205000_domain_events_multi_segment_type.sql:72-74                                                        |
| RLS                            | staff tenantu (`domain_events_staff_select`, `is_staff()`) + aktor czyta swoje (`domain_events_actor_select`)                                                                                                                                                                                                                                                                        | 20260711200000:52-60                                                                                             |
| Realtime                       | tabela jest w `supabase_realtime`; front słucha jednym kanałem                                                                                                                                                                                                                                                                                                                       | 20260711200000:64-68; src/lib/realtime/useDomainEventStream.ts:43                                                |
| Jedyny producent               | `emit_domain_event(p_tenant_id uuid, p_aggregate_type text, p_aggregate_id text, p_event_type text, p_payload jsonb='{}', p_actor_id uuid=NULL, p_suppress_actor boolean=false) RETURNS uuid`, SECURITY DEFINER, wykonać go może tylko `service_role`, połyka każdy błąd (`RETURN NULL`), aktor = `COALESCE(p_actor_id, auth.uid())`, `correlation_id` z nagłówka `x-correlation-id` | 20260808190000_discussion_clubs_a17_event_actor_order.sql:34-79; `request_correlation_id()` 20260711200000:75-91 |
| Usuwanie PII                   | trigger BEFORE INSERT/UPDATE `domain_events_redact_payload_trg` usuwa z payloadu klucze `email, phone, ip, user_agent, token, address, body, content, note(s)` i podobne                                                                                                                                                                                                             | 20260729123407_…sql:7-39                                                                                         |
| Retencja                       | `prune_domain_events('90 days')`, cron `prune-domain-events` (`20 3 * * *`)                                                                                                                                                                                                                                                                                                          | 20260711200000:393-414                                                                                           |
| Konsument 1: workflowy         | AFTER INSERT `trg_run_workflows_for_event`: **synchronicznie w tej samej transakcji**, warunek `workflow_definitions.trigger_event_type = event_type AND payload @> condition`, kroki `run_workflow_step`, log w `workflow_runs`, zabezpieczenie `pg_trigger_depth() > 8`                                                                                                            | 20260711221058_…sql:210-266                                                                                      |
| Konsument 2: outbox integracji | AFTER INSERT `trg_route_domain_event_to_integrations` → `integration_deliveries` według `integration_endpoints.event_types`; partner CRM przyjmuje tylko zdarzenia `crm_lead.*`                                                                                                                                                                                                      | 20260711203000:202-236; src/lib/integrations/formats.ts:109-114                                                  |
| Katalog TS                     | `DOMAIN_EVENT_TYPES` i `DOMAIN_AGGREGATE_TYPES`                                                                                                                                                                                                                                                                                                                                      | src/lib/realtime/domainEvents.ts:10-177, 194-231                                                                 |
| Bramki testowe                 | (a) każdy typ emitowany w migracjach musi być w katalogu; skan bierze **pierwszy literał** w wywołaniu `emit_domain_event`; (b) każdy typ z katalogu musi mieć regułę inwalidacji z co najmniej jednym kluczem                                                                                                                                                                       | src/lib/realtime/**tests**/domainEventCatalog.test.ts:16-46; eventInvalidationMap.test.ts:23-37                  |
| Emitery w TS                   | **brak** – `rg emit_domain_event src` znajduje tylko komentarze. Wszystkie zdarzenia emituje SQL (triggery, RPC, skanery cron).                                                                                                                                                                                                                                                      | –                                                                                                                |

#### 2. Pełna lista typów emitowanych w SQL (z payloadem)

| Typ (`.v1`)                                                                                                                                                                                     | Agregat                                | Emiter (plik:linia)                                                                                                                   | Payload                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| post.created / published / status_changed / deleted                                                                                                                                             | post                                   | `tg_posts_emit_events` 20260711200000:160-209                                                                                         | slug, status, title_pl, author_id, old/new_status                                   |
| comment.created / status_changed                                                                                                                                                                | comment                                | 20260711200000:213-245                                                                                                                | post_id, user_id, status, parent_id                                                 |
| message.sent                                                                                                                                                                                    | message                                | 20260711200000:249-271                                                                                                                | conversation_id, sender_id, kind                                                    |
| crm_lead.created / stage_changed / updated                                                                                                                                                      | crm_lead                               | `tg_crm_leads_emit_events` 20260711220607:224-264                                                                                     | ~~email~~ (usuwany), stage, first/last_name, owner_id, old/new_stage                |
| crm_note.created                                                                                                                                                                                | crm_note                               | 20260711220607:266-284                                                                                                                | lead_id, author_id                                                                  |
| crm_task.created / completed                                                                                                                                                                    | crm_task                               | `tg_crm_tasks_emit_events` 20260721120000:162-186                                                                                     | lead_id, title, due_at, assignee_id                                                 |
| crm_task.due                                                                                                                                                                                    | crm_task                               | skaner `run_crm_task_reminders` 20260721120000:261-340 (cron `crm-task-reminders` `*/10`, oraz src/lib/server/jobsTick.server.ts:317) | lead_id, title, due_at, assignee_id                                                 |
| newsletter_subscriber.subscribed / confirmed / unsubscribed                                                                                                                                     | newsletter_subscriber                  | `tg_newsletter_subscribers_emit_events` 20260711220607:287-331                                                                        | ~~email~~, first/last_name, language, status, source                                |
| mention.created                                                                                                                                                                                 | –                                      | 20260808240000:173                                                                                                                    | –                                                                                   |
| policy.updated                                                                                                                                                                                  | policy                                 | 20260714120000:151                                                                                                                    | –                                                                                   |
| profile_badge.granted / revoked                                                                                                                                                                 | profile_badge                          | 20260803113000:150                                                                                                                    | user_id, badge, grant_source                                                        |
| membership_tier / access_plan / pricing_audience / pricing_faq `.changed`                                                                                                                       | katalog cennika                        | 20260723120000:91, 119 i dalej                                                                                                        | op, key, rank…                                                                      |
| subscription.started                                                                                                                                                                            | subscription (`user_subscriptions.id`) | `tg_user_subscriptions_emit_events` 20260723151000:124-191 (INSERT)                                                                   | user_id, plan_id, tier_key, status, current_period_end; aktor = user_id             |
| subscription.status_changed                                                                                                                                                                     | subscription                           | jw. (zmiana statusu)                                                                                                                  | old_status, new_status (`purchase_status`: pending/active/refunded/canceled)        |
| subscription.updated                                                                                                                                                                            | subscription                           | jw. (zmiana `plan_id` **albo** `canceled_at` / `current_period_end`)                                                                  | plan_changed, old/new_plan_id, cancel_scheduled, current_period_end                 |
| membership_grant.granted (op granted/extended) / revoked                                                                                                                                        | membership_grant                       | 20260723120000:248-295                                                                                                                | user_id, tier_key, source, expires_at                                               |
| organization.updated / org_seat.changed                                                                                                                                                         | org                                    | 20260723120000:321-350                                                                                                                | op, org_id, role, claimed                                                           |
| donation.recorded / refunded                                                                                                                                                                    | donation                               | 20260723120000:355-388                                                                                                                | user_id, amount_cents, currency                                                     |
| billing_document.issued / updated                                                                                                                                                               | billing_document                       | 20260723151000:84-118                                                                                                                 | user_id, kind, number, amount_cents, currency (**brak subscription_id i order_id**) |
| club_thread.* , club_reply.*                                                                                                                                                                    | klub                                   | 20260808190000:220, 283                                                                                                               | wyłącznie identyfikatory                                                            |
| club_member.changed                                                                                                                                                                             | club_member                            | 20260808140000:394 (klub `secret` nie emituje: :385-389)                                                                              | club_id, member_user_id, status, role                                               |
| club_post_comment.created, club_thread.document_added / milestone_set                                                                                                                           | klub                                   | 20261007100100:170; 20260808310000:1835                                                                                               | identyfikatory                                                                      |
| event.published / cancelled                                                                                                                                                                     | event                                  | 20260824081304:248, 263                                                                                                               | –                                                                                   |
| event.registration.created                                                                                                                                                                      | event_registration                     | `_event_register` 20261012180500:752-765 (także pakiety 20261013900400, goście grupy)                                                 | event_id, **person_id**, status, ticket_type_id, source                             |
| event.registration.decided / cancelled / promoted / payment                                                                                                                                     | event_registration                     | 20261012181300:331; 20261012181000:165; 20261012181100:174, 291; 20261013900200:473 (aktor NULL)                                      | event_id, person_id, from/action/refund_effect, order_id, outcome                   |
| event.registration.updated / code_invalidated / refund_requested / refund_failed                                                                                                                | event_registration                     | 20261012180700:328; 20261013110900:237; 20261013900100:218; 20261013900000:506                                                        | identyfikatory                                                                      |
| event_meeting.* (nazwa dynamiczna)                                                                                                                                                              | event_meeting                          | 20260823190000:3195; 20261013111500:257                                                                                               | identyfikatory                                                                      |
| event_scanner_device._, event_sponsor.published / snapshot_refreshed, event_cfp\__, event_invoice._, event_seat_, event_sponsor_report_link.*, event.participant_settings.updated, event.cloned | moduł wydarzeń                         | m.in. 20261013110900:703; 20260824093916:120; 20260927000104:103; 20261012130201:333; 20260927001200:190; 20260927001300:663          | identyfikatory i event_id                                                           |

##### Rozjazdy katalogu (drift)

- **Emitowane, ale brak ich w `DOMAIN_EVENT_TYPES`:**
  - `event_session.published.v1` i `event_session.cancelled.v1`: nazwa sklejana dynamicznie `'event_session.' || v_status || '.v1'` (20260823140000:1859, 20260923120000:663), więc bramka ich nie widzi.
  - `event_sponsor.unpublished.v1`: drugi literał w CASE (20260823160000:1785, 20260824093916:223); bramka bierze tylko pierwszy (domainEventCatalog.test.ts:28-31).
- **W katalogu, ale bez emitera w migracjach:** `event.registration.offered / offer_closed / transfer_requested / transfer_cancelled / transferred`, `event.certificate.issued / revoked`, `event.survey.submitted / questions_changed` (domainEvents.ts:159-173).
- `crm_lead.pushed.v1` nie trafia na szynę. Jest tylko wpisem outboxu (20260802153008:161-164).
- `isValidEventType` w src/lib/admin/workflows.ts:265-270 nadal sprawdza regexem **dwuczłonowym**. Workflow z wyzwalaczem `event.registration.*` nie przejdzie walidacji szkicu (:315), choć baza przyjmuje takie nazwy.

#### 3. Sygnały lejka: co istnieje, gdzie, z jakim payloadem

| Sygnał                                 | Na szynie?                 | Gdzie dziś jest ślad                                                                                                                                                                                                                                                                                                                                                                                                                              | Uwagi / dowód                                                                                                                                                                          |
| -------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rejestracja konta                      | **NIE**                    | `on_auth_user_created` → `handle_new_user()` (INSERT profiles :113, user_roles :122); `profiles_notify_welcome_trg` → dzwonek powitalny                                                                                                                                                                                                                                                                                                           | 20260601055702:74-77; 20260805083149:1-126; 20260711120000:207-235; `signUp` w 4 miejscach: AuthPortal.tsx:143, LoginPopup.tsx:169, AuthFormBlocks.tsx:863, PopupSignupForm.tsx:306    |
| Potwierdzenie e-maila                  | **NIE**                    | brak triggera na `auth.users.email_confirmed_at`; `auth_email_events` loguje tylko wysłanie maila                                                                                                                                                                                                                                                                                                                                                 | src/routes/platform/email/auth/webhook.ts:116-127                                                                                                                                      |
| Zapis na newsletter                    | TAK, ale tylko przy INSERT | `newsletter_subscriber.subscribed.v1`                                                                                                                                                                                                                                                                                                                                                                                                             | upsert `onConflict tenant_id,email` (newsletter.functions.ts:366-377, 394-405; contact.functions.ts:499, 531). Ponowny zapis istniejącego wiersza to UPDATE, więc **zdarzenia nie ma** |
| DOI                                    | TAK                        | `newsletter_subscriber.confirmed.v1` (`confirmed_at` z NULL na wartość)                                                                                                                                                                                                                                                                                                                                                                           | 20260711220607:304-313                                                                                                                                                                 |
| Wypis                                  | TAK                        | `newsletter_subscriber.unsubscribed.v1`                                                                                                                                                                                                                                                                                                                                                                                                           | ścieżki: 20261012180900:143-154, crm-funnel.functions.ts:151, 254. **Ponowne zapisanie** (SubscribersPanel.tsx:82: `unsubscribed_at` → NULL) nie daje zdarzenia                        |
| Popup pokazany / wypełniony            | **NIE**                    | `popup_events(popup_id, kind view/conversion)` bez osoby i sesji (20260712150000:74-80; /api/public/popup-event.ts:44-48); `newsletter_popup_events(event impression/open/submit/success/error, session_id, variant, source)` (20260804061939:1-13; newsletter-popup-events.functions.ts:34, 56)                                                                                                                                                  | Jedyny sygnał przypisany do osoby: `subscribed.v1` z polem `source`                                                                                                                    |
| Paywall pokazany                       | **NIE**                    | brak logu wyświetlenia twardego paywalla ($.tsx:1435 `showPaywall`, Paywall.tsx); kliknięcia CTA tylko w `analytics_events` (wymaga zgody, anonimowe)                                                                                                                                                                                                                                                                                             | 20260722234931:2-18; track.ts:248, 302                                                                                                                                                 |
| Metering wyczerpany                    | **NIE** (tylko log)        | `metering_event_log(outcome consumed/denied/granted/exempt/requires_registration, reason, used_before, monthly_limit, user_id, visitor_id)` 20260721070203:60-92. Odmowy **gościa** loguje rdzeń `_metered_view_consume` (20261013090400:228-236, 274-279, 302-307); odmowy **konta** loguje klient przez `rpc log_metering_event` (src/lib/access/metering.ts:416-431, grant `authenticated` 20261013090400:622-625)                             | log klienta można podrobić dla własnego konta                                                                                                                                          |
| Checkout rozpoczęty                    | **NIE**                    | INSERT `payment_orders` ze statusem `pending` w 3 ścieżkach: checkout.functions.ts:471-478, stripeCheckout.functions.ts:186, adhocCheckoutOrder.server.ts:157 (enum `order_status` pending/processing/paid/failed/refunded/canceled 20260624172041:57-81)                                                                                                                                                                                         | `trackCta('pricing_checkout_click')` TierCard.tsx:251; beacon lejka wydarzeń `checkout_start` eventFunnelWire.ts:15                                                                    |
| Checkout porzucony                     | **NIE**                    | webhook `transaction.expired` → `expireCheckoutOrder` (status `canceled`, zwolnienie kuponu)                                                                                                                                                                                                                                                                                                                                                      | webhookDispatch.server.ts:2388-2406; oneTimeFulfilment.server.ts:933-957                                                                                                               |
| Checkout zakończony                    | pośrednio                  | status `paid` na `payment_orders` bez zdarzenia; pośrednio `subscription.started`, `billing_document.issued`, `event.registration.payment`, `membership_grant.*`. Zakup jednorazowy (`user_purchases`) **bez zdarzenia** (jest tylko scoring `trg_score_on_purchase` 20260718130000:694)                                                                                                                                                          | webhookDispatch.server.ts:2372-2386                                                                                                                                                    |
| Subskrypcja utworzona                  | TAK                        | `subscription.started.v1`                                                                                                                                                                                                                                                                                                                                                                                                                         | nie odróżnia triala od płatnej; `user_subscriptions.status` to `purchase_status` (20260601051732:15)                                                                                   |
| Odnowiona                              | pośrednio                  | `subscription.updated.v1` (zmiana `current_period_end`, **ten sam typ** co zaplanowane anulowanie) oraz `billing_document.issued.v1` bez subscription_id                                                                                                                                                                                                                                                                                          | 20260723151000:169-183                                                                                                                                                                 |
| Zmieniona (plan)                       | TAK                        | `subscription.updated.v1` z `plan_changed=true`                                                                                                                                                                                                                                                                                                                                                                                                   | 20260723151000:152-168                                                                                                                                                                 |
| Anulowana                              | TAK                        | zaplanowana: `updated` z `cancel_scheduled=true`; końcowa: `status_changed` z `new_status=canceled` (szablony retencji)                                                                                                                                                                                                                                                                                                                           | 20260723140000:216-252                                                                                                                                                                 |
| Wygasła                                | **NIE**                    | `mapProviderStatus` zostawia status `active` z datą końca, `has_content_access` wygasza dostęp w czasie bez żadnego zapisu                                                                                                                                                                                                                                                                                                                        | entitlementSync.server.ts:70-91                                                                                                                                                        |
| Nieudana płatność / dunning            | **NIE**                    | `transaction.payment_failed` i `transaction.past_due` → `dunning.applyPaymentFailedEffects` zapisuje w `public.subscriptions` (lustro operatora): `payment_failure_count`, `last_payment_failed_at`, `first_payment_failed_at`, `last_dunning_transaction_id`. Odzyskanie: `applyPaymentRecoveredEffects`. Tabela `subscriptions` **nie ma emitera**, a `user_subscriptions` mapuje past_due/unpaid na `active`, więc `status_changed` nie odpala | webhookDispatch.server.ts:2368-2371, 1946-1947; dunning.server.ts:237, 309, 419; 20260729080442:37-40; 20261013090500:47-50; 20260729072626:1-17                                       |
| Pauza / wznowienie                     | mylące                     | pauza mapuje się na `canceled`, więc `status_changed` z `new_status=canceled` wygląda jak anulowanie                                                                                                                                                                                                                                                                                                                                              | purchaseEffects.server.ts:1050-1112; entitlementSync.server.ts:84-85                                                                                                                   |
| Oferta retencyjna przyjęta / odrzucona | **NIE**                    | `retention_feedback(offer_shown, offer_accepted, coupon_code, reason_id, reason_label)` 20260722230000:468-481; `submitRetentionFeedback` retention/functions.ts:55-75, `acceptRetentionOffer` :77-170 (kupon w `b2b_coupons`)                                                                                                                                                                                                                    | brak triggera                                                                                                                                                                          |
| Rejestracja na wydarzenie              | TAK                        | `event.registration.created.v1` i dalszy cykl życia zgłoszenia                                                                                                                                                                                                                                                                                                                                                                                    | payload ma `person_id` (event_people), nie user_id ani e-mail                                                                                                                          |
| Zgłoszenie do klubu                    | **NIE** (tylko pośrednio)  | `club_apply_submit` 20260811151703:22-150 (INSERT :105, `club_application_crm_sync` :140) → UPDATE `crm_leads source_type='club_application'` (20261007140710:53-54), czyli nieodróżnialny `crm_lead.updated.v1`. Decyzja `admin_club_application_set_status` (20260811150000:492) bez zdarzenia                                                                                                                                                  | –                                                                                                                                                                                      |
| Zapytanie do eksperta                  | **NIE**                    | `expert_inmails(status pending/approved/declined/answered/cancelled)` 20260723090707:131-155; RPC `send_expert_request` 20260806185055:316-327 i wrapper `send_expert_inmail` :501-513; klient useExpertRequests.ts:138                                                                                                                                                                                                                           | –                                                                                                                                                                                      |
| Formularz kontaktowy                   | pośrednio                  | `trg_contact_messages_to_lead` tworzy lead, więc `crm_lead.created.v1`                                                                                                                                                                                                                                                                                                                                                                            | 20260630053403:259-260                                                                                                                                                                 |
| E-mail otwarty / kliknięty / odbity    | **NIE**                    | `newsletter_campaign_events(kind open/click, subscriber_id, campaign_id, url)` przez `newsletter_record_campaign_event` (20260712150000:14-22; 20260814215302:53); `email_delivery_events(kind sent/delivered/bounced/complained/opened/clicked…, provider_message_id, subscriber_id, campaign_id)` (20260725120000:382-404) przez webhooks.resend.ts:132                                                                                         | scoring `trg_score_on_campaign_event` 20260718130000:582-583                                                                                                                           |

#### 4. Brakujące zdarzenia i najlepsze miejsce emisji

| Proponowany typ                                                                            | Agregat / aggregate_id                                            | Konkretne miejsce emisji                                                                                                                                                                                                                                                                         | Payload (bez PII)                                                                                                 |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `account.registered.v1`                                                                    | account / user_id                                                 | nowy AFTER INSERT trigger na `public.profiles` (obok `profiles_notify_welcome_trg`, 20260711120000:233). Jeden punkt dla 4 ścieżek `signUp` i OAuth                                                                                                                                              | user_id, signup_type, language; `p_actor_id => NEW.id`                                                            |
| `account.email_confirmed.v1`                                                               | account / user_id                                                 | nowy trigger `AFTER UPDATE OF email_confirmed_at ON auth.users` (wzorzec 20260601055702:74-77); tenant z `profiles`                                                                                                                                                                              | user_id, flaga konta założonego przez admina (20261012180800)                                                     |
| `newsletter_subscriber.resubscribed.v1`                                                    | newsletter_subscriber                                             | rozszerzyć `tg_newsletter_subscribers_emit_events` (20260711220607:303-320): `OLD.unsubscribed_at IS NOT NULL AND NEW.unsubscribed_at IS NULL`                                                                                                                                                   | source, language, status                                                                                          |
| `paywall.shown.v1` (tylko konta)                                                           | paywall / `<entity_type>:<entity_id>`                             | nowe RPC SECURITY DEFINER `record_paywall_impression(_entity_type, _entity_id)` (tożsamość z `auth.uid()`, tenant z `public_tenant_id()`, deduplikacja: byt/osoba/doba) wołane z Paywall.tsx przy montażu. Gość: tylko analityka (brak kontaktu)                                                 | user_id, entity_type, entity_id, access mode, wariant paywalla                                                    |
| `metering.limit_reached.v1` i `metering.quota_exhausted.v1`                                | metering / user_id                                                | **w rdzeniu** `_metered_view_consume` (20261013090400): gałąź `v_used >= v_limit` (:272-283), dziś log tylko dla gościa, dopisać emisję dla `_uid IS NOT NULL`; „ostatni darmowy” po INSERT do metered_views (:320-330), gdy `v_used = v_limit`. **Nie** z `log_metering_event` (woła je klient) | user_id, used, monthly_limit, entity_id, okres                                                                    |
| `checkout.started` / `checkout.completed` / `checkout.abandoned` / `checkout.failed` `.v1` | payment_order / order.id                                          | **jeden** trigger `AFTER INSERT OR UPDATE OF status ON public.payment_orders` (wzorzec `payment_orders_zz_billing_document_refund` 20261012122000:46-48). Pokrywa 3 ścieżki insertu, `expireCheckoutOrder` (canceled) i realizację (paid). Pominąć `environment='sandbox'` i `provider='mock'`   | user_id (aktor), kind, plan_id, entity_type, entity_id, metadata.event_id, amount_cents, currency, old/new status |
| `subscription.payment_failed.v1` i `subscription.payment_recovered.v1`                     | subscription / `user_subscriptions.id` (lookup po `external_ref`) | trigger AFTER UPDATE na `public.subscriptions`, gdy rośnie `payment_failure_count` albo `first_payment_failed_at` wraca do NULL. Jedynym pisarzem jest `dunning.server.ts:237`, deduplikację ma już w TS                                                                                         | user_id, attempt, first_payment_failed_at, koniec karencji, status u operatora                                    |
| `subscription.provider_status_changed.v1` (trial, past_due, unpaid, paused, resumed)       | subscription                                                      | trigger `AFTER UPDATE OF status ON public.subscriptions`, bo `user_subscriptions` spłaszcza statusy                                                                                                                                                                                              | old/new status operatora, cancel_at_period_end                                                                    |
| `subscription.renewed.v1`                                                                  | subscription                                                      | w `tg_user_subscriptions_emit_events` (20260723151000:169-183) rozdzielić: `current_period_end` przesunięty do przodu przy niezmienionym `canceled_at` daje `renewed` (dla zgodności zostawić też `updated`)                                                                                     | user_id, plan_id, tier_key, period_end                                                                            |
| `subscription.expired.v1` (oraz `trial_ending` / `renewal_upcoming`)                       | subscription                                                      | skaner czasowy według wzorca `run_crm_task_reminders` (`FOR UPDATE SKIP LOCKED` + kolumna-znacznik) wołany z `runJobsTick` (jobsTick.server.ts:261, obok :317) albo z billing-cron (billing-cron.ts:136-154, okna liczy już reminders.server.ts)                                                 | user_id, plan_id, tier_key, current_period_end                                                                    |
| `retention_offer.accepted` / `declined` / `feedback_submitted` `.v1`                       | retention_feedback / id                                           | AFTER INSERT trigger na `public.retention_feedback`                                                                                                                                                                                                                                              | user_id, subscription_id, reason_id, offer_shown, offer_accepted (bez `comment`)                                  |
| `club_application.submitted` / `decided` `.v1`                                             | club_application / id                                             | AFTER INSERT OR UPDATE OF status na `club_applications` albo `PERFORM` w `club_apply_submit` (:105-140) i w `admin_club_application_set_status`                                                                                                                                                  | user_id, specialization_slug, club_id, status, tier_key                                                           |
| `expert_request.sent` / `status_changed` `.v1`                                             | expert_request / id                                               | AFTER INSERT OR UPDATE OF status na `expert_inmails` (jedyny pisarz to `send_expert_request`)                                                                                                                                                                                                    | sender_id (aktor), recipient_id, status                                                                           |
| `email_message.opened` / `clicked` / `bounced` `.v1` (opcjonalnie)                         | email_message / provider_message_id                               | w `email_apply_delivery_event` i `newsletter_record_campaign_event`. **Rekomendacja:** warunki if/then ścieżki czytają tabele `email_delivery_events` i `newsletter_campaign_events` po `provider_message_id`; zdarzenie jest potrzebne tylko jako wyzwalacz                                     | campaign_id, subscriber_id, kind, url                                                                             |

#### 5. Pułapki dla silnika ścieżek

1. **Payload nie ma e-maila.** Szablon `newsletter-confirmed-to-crm` (20260711221058:306-314) woła `create_crm_lead`, który czyta `payload->>'email'` (20261007140700:151-160). `crm_upsert_lead` zwraca NULL przy pustym e-mailu (20260630060254:43), więc szablon to **cichy no-op** (`workflow_runs` = succeeded). Zapis kontaktu do ścieżki musi rozwiązywać osobę po identyfikatorach.
2. **Tożsamość jest różna w różnych zdarzeniach:** `user_id` (subscription._, billing, membership_grant), `person_id` (event.registration._ → event_people), `aggregate_id` (crm_lead, newsletter_subscriber), `member_user_id` (club_member). Aktor bywa NULL (event.registration.payment, 20261013900200:476).
3. **Workflowy wykonują się synchronicznie** w transakcji emitera. Kroki „odczekaj X” wymagają kolejki i ticku: cron `jobs-tick` co minutę (20260731081100:322) → `runJobsTick`.
4. **Retencja 90 dni.** Stan ścieżek nie może opierać się na `domain_events`.
5. **`emit_domain_event` połyka błędy.** Test pgTAP musi sprawdzać, że wiersz faktycznie powstał (20260828205000:52-57).
6. **Piaskownica.** Zdarzenia sandbox nie nadają dostępu (webhookDispatch.server.ts:2320-2342). Emitery na `subscriptions` i `payment_orders` muszą filtrować `environment`.

### Do reużycia

- **emit_domain_event (7 arg, SECURITY DEFINER, service_role)** (`supabase/migrations/20260808190000_discussion_clubs_a17_event_actor_order.sql:34-79`): Jedyny producent zdarzeń: w każdym nowym triggerze lub RPC wołać PERFORM public.emit_domain_event(tenant, '<agregat>', id::text, '<typ>.v1', jsonb_build_object(...), p_actor_id => user_id). Aktor podawany jako 6. argument pozycyjnie, tłumienie aktora wyłącznie argumentem nazwanym p_suppress_actor.
- **public.domain_events + konsument AFTER INSERT (wzorzec tg_run_workflows_for_event)** (`supabase/migrations/20260711221058_9dbe5dcf-e0b7-4760-a0a7-c40e80042a56.sql:210-266`): Zapis kontaktów do ścieżek: drugi trigger AFTER INSERT na domain_events (jak trg_run_workflows_for_event), który tylko wstawia enrollment do kolejki (dopasowanie po trigger_event_type i payload @> condition), bez ciężkiej pracy w transakcji emitera.
- **workflow_definitions / workflow_runs / workflow_templates / run_workflow_step** (`supabase/migrations/20260723140000_subscription_retention_crm_bridge.sql:28-252`): Akcje create_crm_task, notify_staff i create_crm_lead oraz szablony retencyjne (cancel_scheduled, new_status=canceled) to gotowe kroki i wyzwalacze ścieżek; lustro TS w src/lib/admin/workflows.ts:27-34.
- **Katalog zdarzeń TS i mapa inwalidacji** (`src/lib/realtime/domainEvents.ts:10-231`): Źródło listy wyzwalaczy dla edytora ścieżek (WorkflowEditorDialog i editorDraft.ts już z niego korzystają); każdy nowy typ dopisać tutaj i w eventInvalidationMap.ts.
- **Skaner czasowy emitujący zdarzenia (run_crm_task_reminders)** (`supabase/migrations/20260721120000_crm_tasks_followups.sql:261-340`): Wzorzec dla subscription.expired, trial_ending i renewal_upcoming: SELECT ... FOR UPDATE SKIP LOCKED z kolumną-znacznikiem, emit_domain_event, cron albo wywołanie z runJobsTick (src/lib/server/jobsTick.server.ts:261, 317).
- **Tick zadań tła** (`src/lib/server/jobsTick.server.ts:261-341`): Miejsce na krok runJourneyTick (opóźnienia „odczekaj X”, wysyłka e-maili ścieżek); wywoływany co minutę przez cron jobs-tick (20260731081100:322) i /api/public/jobs-tick.
- **Outbox integracji (HubSpot / CRM partner)** (`supabase/migrations/20260711203000_idempotency_and_integration_outbox.sql:202-236`): Nowe zdarzenia automatycznie trafiają do integration_deliveries dla endpointów z pustym lub pasującym event_types; synchronizacja z zewnętrznym CRM bez dodatkowego kodu.
- **metering_event_log + rdzeń \_metered_view_consume** (`supabase/migrations/20261013090400_metering_signed_visitor_ip_limit.sql:104-330`): Punkt emisji metering.limit_reached i quota_exhausted (gałęzie :272-283 i :320-330); dane historyczne do warunków i raportów lejka paywalla.
- **payment_orders + istniejące triggery AFTER UPDATE OF status** (`supabase/migrations/20261012122000_billing_documents_follow_order_refund.sql:46-48`): Wzorzec jednego triggera na payment_orders dla checkout.started, completed, abandoned i failed; obejmuje wszystkie 3 ścieżki insertu i expireCheckoutOrder.
- **Dunning: zapis do public.subscriptions** (`src/lib/billing/dunning.server.ts:237-419`): updateSubscription (:237) jest jedynym pisarzem payment_failure_count i first_payment_failed_at; trigger na tych kolumnach daje subscription.payment_failed i payment_recovered z deduplikacją odziedziczoną z TS.
- **Tabele zaangażowania e-mail** (`supabase/migrations/20260725120000_analytics_semantic_layer.sql:382-404`): email_delivery_events (opened, clicked, bounced po provider_message_id) oraz newsletter_campaign_events (20260712150000:14-22) jako źródło warunków if/then „otworzył/kliknął” w krokach ścieżki.
- **retention_feedback / acceptRetentionOffer** (`src/lib/retention/functions.ts:55-170`): Istniejący przepływ kontroferty (kupon b2b_coupons); trigger AFTER INSERT na retention_feedback (20260722230000:468) daje zdarzenia retention_offer.accepted i declined.
- **get_correlated_events + correlation_id** (`supabase/migrations/20260711200000_domain_event_bus.sql:140-151`): Do wyjaśniania w UI ścieżki, co wyzwoliło enrollment (CorrelationTracePanel.tsx już tego używa).

### Ograniczenia i bramki

- Każdy nowy typ zdarzenia: literał (nie nazwa sklejana dynamicznie) jako PIERWSZY literał `<agg>.<verb>.vN` w wywołaniu emit_domain_event, dopisany do DOMAIN_EVENT_TYPES i DOMAIN_AGGREGATE_TYPES (src/lib/realtime/domainEvents.ts) oraz z regułą w eventInvalidationMap zwracającą co najmniej 1 niepusty klucz. Bramki: domainEventCatalog.test.ts:37-46 i eventInvalidationMap.test.ts:23-37.
- Nazwa musi spełniać CHECK `^[a-z0-9_]+(\.[a-z0-9_]+)+\.v[0-9]+$` (20260828205000:72-74); emit_domain_event połyka błąd, więc naruszenie ginie po cichu, a pgTAP musi sprawdzać realne wiersze.
- Emisja wyłącznie w SQL: trigger albo RPC SECURITY DEFINER; EXECUTE emit_domain_event ma tylko service_role. Nie emitować z RPC dostępnych dla klienta, którymi da się podrobić sygnał (np. log_metering_event ma grant authenticated).
- Payload bez PII: trigger domain_events_redact_payload usuwa email, phone, ip, user_agent, token, address, body, content i note (20260729123407:14-19). Ścieżki rozwiązują kontakt po identyfikatorach (user_id, lead_id, subscriber_id, person_id), nigdy z payloadu.
- Tenant, user i firma pochodzą z sesji lub z wiersza źródłowego, nigdy z payloadu klienta; literalne nazwy RPC i tabel z pasującymi grantami (server-only: service_role) pod bramkę generate:ts-sql-contract i check:ts-sql-contract (AGENTS.md; package.json:53-54).
- Konsumenci AFTER INSERT na domain_events działają w transakcji emitera (tg_run_workflows_for_event): enrollment ścieżki ma tylko kolejkować, a opóźnienia i wysyłka idą przez jobs-tick. Nie wolno wywrócić zapisu źródłowego (EXCEPTION WHEN OTHERS, RETURN NEW).
- domain_events ma retencję 90 dni (prune-domain-events), więc stan enrollmentów i historia ścieżek muszą żyć we własnych tabelach.
- Prywatność klubów: klub `secret` nie emituje zdarzeń, a w trybie anonimowym lub chatham zdarzenie jest bez aktora (20260808140000:385-389; domainEvents.ts:61-67). Ścieżki nie mogą tego obchodzić.
- Izolacja środowisk: zdarzenia sandbox nie nadają dostępu (webhookDispatch.server.ts:2320-2342). Emitery na public.subscriptions i payment_orders muszą pomijać environment='sandbox' (i provider='mock').
- Walidator wyzwalaczy w src/lib/admin/workflows.ts:265-270 sprawdza nazwy dwuczłonowe; musi przyjąć nazwy wieloczłonowe (zgodnie z CHECK), inaczej wyzwalacze event.registration.* nie przejdą walidacji.
- Rozszerzać istniejące mechanizmy (workflow_definitions, run_workflow_step, integration outbox, jobs-tick) zamiast budować drugą równoległą szynę.

### Braki

- account.registered.v1: brak zdarzenia rejestracji konta (handle_new_user i profiles nie emitują). Emitować w nowym triggerze AFTER INSERT ON public.profiles.
- account.email_confirmed.v1: brak triggera na auth.users.email_confirmed_at.
- newsletter_subscriber.resubscribed.v1: upsert i odpięcie unsubscribed_at na istniejącym wierszu nie daje żadnego zdarzenia (tg_newsletter_subscribers_emit_events 20260711220607:303-320).
- popup.shown i popup.converted: popup_events i newsletter_popup_events są anonimowe i poza szyną; konwersja jest identyfikowalna tylko przez newsletter_subscriber.subscribed.v1 z source.
- paywall.shown.v1: brak jakiegokolwiek serwerowego logu wyświetlenia twardego paywalla; potrzebne nowe RPC record_paywall_impression wołane z Paywall.tsx (tylko konta).
- metering.limit_reached.v1 i metering.quota_exhausted.v1: odmowy konta loguje dziś tylko klient (metering.ts:416-431); emitować w _metered_view_consume.
- checkout.started, completed, abandoned i failed `.v1`: payment_orders nie ma emitera; jeden trigger AFTER INSERT OR UPDATE OF status ON payment_orders.
- subscription.payment_failed i payment_recovered `.v1` (dunning): tabela public.subscriptions nie ma emitera, a user_subscriptions mapuje past_due na active.
- subscription.provider_status_changed.v1 (trial, past_due, paused, resumed): pauza wygląda dziś jak anulowanie (status_changed z new_status=canceled).
- subscription.renewed.v1: odnowienie to dziś nierozróżnialne subscription.updated.v1; billing_document.issued.v1 nie niesie subscription_id ani order_id.
- subscription.expired.v1 (oraz trial_ending i renewal_upcoming): wygaśnięcie nie zostawia żadnego zapisu, potrzebny skaner czasowy (wzorzec run_crm_task_reminders + jobs-tick).
- retention_offer.accepted, declined i feedback_submitted `.v1`: retention_feedback nie ma triggera.
- club_application.submitted i decided `.v1`: club_apply_submit i admin_club_application_set_status nie emitują; widoczny jest tylko pośredni crm_lead.updated.v1.
- expert_request.sent i status_changed `.v1`: expert_inmails i send_expert_request nie emitują.
- email_message.opened, clicked i bounced (opcjonalnie): zaangażowanie mailowe jest tylko w email_delivery_events i newsletter_campaign_events, poza szyną.
- Zakup jednorazowy treści (user_purchases): brak zdarzenia.
- Drift katalogu: event_session.published.v1, event_session.cancelled.v1 i event_sponsor.unpublished.v1 są emitowane, ale nie ma ich w DOMAIN_EVENT_TYPES. 9 typów F4/F5 (offered, transfer*, certificate*, survey*) jest w katalogu bez emitera.
- Defekt: szablon workflow newsletter-confirmed-to-crm (create_crm_lead z payload->>'email') jest cichym no-opem od czasu redakcji payloadu (20260729123407).
- Brak powiązania anonimowego visitor_id lub anon_id z kontem lub subskrybentem po rejestracji: anonimowych sygnałów (paywall, popup, CTA) nie da się później przypisać do ścieżki.

## 5. Konwencje i bramki SQL/CI

#### Rozpoznanie: konwencje i bramki SQL/CI dla nowych migracji i RPC (silnik ścieżek)

Niczego w repo nie zmieniłem. Artefakty `reports/*.json`, które wygenerowały uruchomione bramki, usunąłem. Wszystkie bramki statyczne przechodzą na HEAD `6a0b9d5`.

##### 1. Nazewnictwo i kolejność migracji

| Fakt                                                                                                                                             | Dowód                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Plik musi pasować do `^(\d{14})_(.+)\.sql$`. Wersja to 14-cyfrowy prefiks, czyli `schema_migrations.version`                                     | `src/lib/ci/migrationLedger.ts:65-75`                                                                   |
| Wersja musi być unikalna, bo duplikat to błąd PK `schema_migrations_pkey` i baza nie odtworzy się od zera                                        | `src/lib/ci/migrationReplay.ts:10-18`                                                                   |
| Konwencja w PR-ach: `YYYYMMDDHHMMSS_snake_case.sql`. Panel Lovable tworzy pliki `..._<uuid>.sql`, a podział większych plików daje `_part2`       | `ls supabase/migrations` (1237 plików, ostatni `20261017150000_club_lists_total_order.sql`)             |
| Lovable stosuje niezastosowane pliki w kolejności nazw, więc nowa wersja musi być większa niż `20261017150000`                                   | `docs/NAPRAWA_ZAPISY_WYDARZEN_REG_2026-10-12.md:188`                                                    |
| Limit rozmiaru Lovable to 45 KiB (46 080 B). Większe pliki tnie `scripts/split-migration.ts` (domyślnie `--max-kb 45`)                           | `src/lib/ci/migrationSize.ts:14`, `src/lib/ci/migrationSplit.ts:90`, `scripts/split-migration.ts:12-16` |
| Żaden skrypt ani CI nie egzekwuje dziś tego limitu: `SIZE_CONFIG` nie ma wywołującego                                                            | `grep migrationSize` daje tylko `readLogicalMigration` w testach                                        |
| Nagłówek migracji jest po polsku, z sekcjami DEFEKT / ZMIANA / KOLEJNOSC WDROZENIA / IDEMPOTENTNA / DOWOD (plik pgTAP)                           | `supabase/migrations/20261012131000_sms_send_log.sql:1-58`                                              |
| Migracje są idempotentne: `CREATE TABLE IF NOT EXISTS`, `DROP POLICY/TRIGGER IF EXISTS` + `CREATE`, `CREATE OR REPLACE`, bezstanowe REVOKE/GRANT | `20261012131000_sms_send_log.sql:52-54`                                                                 |

##### 2. `supabase/migration-ledger.json`: nowej migracji nie trzeba dopisywać

- `baseline` = `20260825230232`. Każda wersja powyżej jest automatycznie wymagana przez post-deployową bramkę `check:migration-ledger` (`supabase/migration-ledger.json:2-11`, `src/lib/ci/migrationLedger.ts:92-107`).
- `reconciled` dopisuje się tylko wtedy, gdy pipeline wykonał SQL pod inną wersją. Robi to operator po wdrożeniu (`docs/NAPRAWA_ZAPISY_WYDARZEN_REG_2026-10-12.md:198`). Baseline może tylko rosnąć.

##### 3. Drugi pas migracji (drizzle), bramka `check:migration-lanes`

- Bramka sprawdza tylko pliki `drizzle/migrations`. Plik, który jest kopią pliku supabase o tym samym SQL-u wykonywalnym, przechodzi bez wpisu jako zapis wdrożenia. Plik obecny wyłącznie w drizzle wymaga wpisu w `MIGRATION_LANES` (`src/lib/ci/migrationLaneParity.ts:1-60`, `:1259-1268`).
- Zapis w pasie drizzle robi Lovable (`docs/NAPRAWA_ZAPISY_WYDARZEN_REG_2026-10-12.md:198`), więc bliźniak drizzle jest opcjonalny.
- Jeśli go dodajemy, wzór daje commit `20ea922`: `drizzle/migrations/0300_*.sql` + `meta/0300_snapshot.json` (pusty szkielet) + wpis w `_journal.json` z ściśle rosnącym `when` (`migrationLaneParity.ts:1277`).

##### 4. Bramki: co sprawdzają, czy działają offline i wynik lokalny

| Bramka                                                                       | package.json | Co sprawdza (dowód)                                                                                                                                                   | Offline         | Wynik lokalny                                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check:sql-tenant-scope`                                                     | :42          | SECURITY DEFINER nie łączy `public_tenant_id()`/`request_public_host()` z `has_role()`/`is_staff()` poza allowlistą (`scripts/check-sql-tenant-scope.ts:13-18,34-51`) | tak             | OK: 1656 funkcji, 5 ścieżek publicznych, 0 s                                                                                                          |
| `check:sql-app-role`                                                         | :43          | literały `has_role(..., 'x')` należą do enuma `app_role` (`check-sql-app-role-literals.ts:18-21`)                                                                     | tak             | OK: 1054 literały; enum `admin, author, editor, super_admin, user`, 1 s                                                                               |
| `check:sql-anon-insert`                                                      | :44          | brak permisywnej polityki INSERT dla anon/public; 16 tabel intake bez INSERT od klienta (`check-sql-anon-insert.ts:15-25,51-82`)                                      | tak             | OK: 673 polityki, 1 s                                                                                                                                 |
| `check:sql-definer-views`                                                    | :45          | widok DEFINER w public: `REVOKE ALL ... FROM anon, authenticated` w tym samym pliku albo `security_invoker = on` (`src/lib/ci/definerViewGrants.ts:19-35`)            | tak             | OK: 1542 pliki z obu pasów, 0 s                                                                                                                       |
| `check:migration-lanes`                                                      | :46          | każdy wpis dziennika drizzle ma decyzję albo jest kopią                                                                                                               | tak             | OK: 305 wpisów (72 bliźniaki, 37 drizzleOnly, 196 zapisów wdrożenia, 31 sierot), 1 s                                                                  |
| `check:sql-migration-replay`                                                 | :51          | unikalność wersji, brak DML na `storage.objects` w wykonywanych blokach, zero nowych duplikatów treści (`migrationReplay.ts:10-48`)                                   | tak             | OK: 1237 plików, 55 znanych par, 0 s                                                                                                                  |
| `check:rpc-contract`                                                         | :52          | każde `.rpc("x")` z `src`/`scripts`/`e2e` ma funkcję w stanie końcowym i nie celuje w przemianowaną tabelę (`src/lib/ci/rpcContract.ts:20-27`)                        | tak             | OK: 796 nazw, 1594 funkcje, 3 s                                                                                                                       |
| `check:ts-sql-contract`                                                      | :54          | tylko zasięg ekstrakcji, bez bazy (`scripts/generate-ts-sql-contract.ts:106-113`)                                                                                     | tak             | OK: 915 RPC, 1482 operacje na tabelach, 157 literałów, 85 onConflict; **unresolved 13/13** (zapadka pełna), 5 s                                       |
| `check:on-conflict-arbiters`                                                 | :55          | `.upsert({onConflict})` ma UNIQUE dokładnie na tych kolumnach (`check-on-conflict-arbiters.ts:24-27`)                                                                 | tak             | OK: 87 celów, 343 tabele, 3 s                                                                                                                         |
| `check:sql-owner-tenant-scope`                                               | :56          | jeśli jedna klauzula właścicielska na tabeli wiąże tenant, wiąże każda (`check-sql-owner-tenant-scope.ts:87-93`)                                                      | tak             | OK: 180/673 polityk, 0 s                                                                                                                              |
| `check:sql-policy-tenant-regression`                                         | :57          | polityka nie traci raz nadanego wiązania z tenantem (`check-sql-policy-tenant-regression.ts:1-46`)                                                                    | tak             | OK, 1 s                                                                                                                                               |
| `check:types-freshness`                                                      | :62          | kolumny z `ALTER TABLE ADD/RENAME COLUMN` istniejących tabel są w `types.ts`. CREATE TABLE jest zwolnione (`src/lib/ci/generatedTypesFreshness.ts:26-31`)             | tak             | OK: 358 tabel, 7 znanych braków, 1 s                                                                                                                  |
| `check:db-contract`                                                          | :59          | tabele, widoki, RPC i kolumny z migracji istnieją na bazie (Data API)                                                                                                 | **nie**         | BŁĄD: „Brak SUPABASE_URL / klucza” (`check-db-contract.ts:52-55`)                                                                                     |
| `check:migration-ledger`                                                     | :61          | wersje plików są w `schema_migrations` (RPC `missing_migration_versions`)                                                                                             | **nie**         | wymaga `SUPABASE_URL` i klucza (`check-migration-ledger.ts:209-214`)                                                                                  |
| `check:pg-harness`                                                           | :65          | lokalny PG16, migracje modułu klubów + asercje runtime                                                                                                                | tak (PG16 jest) | OK: 504 asercje, około 10 s                                                                                                                           |
| `test:pgtap-local`                                                           | :69          | pełny replay migracji + pgTAP na lokalnym PG16                                                                                                                        | **nie**         | BŁĄD: `extension "pgtap" is not available` (`scripts/pgtap-local/stub.sql:26`)                                                                        |
| `db:test` (`supabase test db`)                                               | :33          | kanoniczny pgTAP                                                                                                                                                      | **nie**         | brak CLI `supabase`; klient docker jest, demon nie działa                                                                                             |
| `generate:authz-snapshot --check`                                            | :41          | zgodność `authzSnapshot.generated.ts` z migracjami                                                                                                                    | tak             | BŁĄD na HEAD (dryf proweniencji: migracje 1146 -> 1237). Nie jest w CI. Vitest `src/lib/authz/__tests__/authzSnapshotParity.test.ts` przechodzi 12/12 |
| vitest `src/lib/ci/__tests__`, `serviceRoleTenantScope.gate`, `src/lib/jobs` | —            | logika bramek i rejestry                                                                                                                                              | tak             | OK: 59 plików, 1284 testy, 36 s                                                                                                                       |

`bun run verify:static` uruchamia wszystkie skrypty `check:*` poza tymi wykluczonymi w `EXCLUDED` (`scripts/verify-static.ts:14-19,27-55`).

**Podpięcie w CI** (`.github/workflows/ci.yml`):

- Job `verify` (:37) uruchamia bramki SQL w :66-112, potem typecheck :130 i lint :134.
- Job `pgtap` (:244) robi kolejno: `generate:ts-sql-contract` :276, `supabase db start` :279, instalację pgtap :282, `supabase test db` :321. CLI jest przypięte do 2.111.0 (:263).
- Job `pg-harness` (:324).
- Job `post-deploy` (:370, tylko main) uruchamia `check:db-contract` i `check:migration-ledger`.
- `release-gate` (:418) wymaga jobów verify, test-shards, build, pgtap i pg-harness.

##### 5. `generate:ts-sql-contract`: co robi i czy wymaga żywej bazy

- Bez flag generuje `supabase/tests/ts_sql_contract_test.sql` z faktów szwu wyciągniętych z `src/**`. Plik jest w `.gitignore:112` i powstaje w CI tuż przed `supabase test db` (`scripts/generate-ts-sql-contract.ts:66-84,115-122`).
- `--check` (`check:ts-sql-contract`) działa bez bazy: liczy tylko zasięg ekstrakcji i zapadkę `MAX_UNRESOLVED_SITES = 13` (`src/lib/ci/tsSqlContract.ts:731-750`). Dziś wywołań nie do ustalenia statycznie jest dokładnie 13, więc **każde nowe `.from(zmienna)` / `.rpc(zmienna)` oblewa CI**.
- Pełna weryfikacja zachodzi dopiero na żywej bazie w jobie pgtap. Rola klienta wynika z odbiorcy wywołania: `supabaseAdmin` to `service_role`, a `context.supabase`/`ctx.supabase` lub `supabase` z `requireSupabaseAuth` to `authenticated` (`tsSqlContract.ts:349-375`). Dziewięć asercji (`tsSqlContract.ts`):

| #   | Asercja                                                                                                                                                                                                                                                                                               | Linia     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | nazwa RPC i klucze mają przeciążenie: wymagane parametry ⊆ klucze ⊆ parametry (`ts_rpc_match`)                                                                                                                                                                                                        | 957, 1039 |
| 2   | rola klienta ma EXECUTE                                                                                                                                                                                                                                                                               | 1053      |
| 3   | RPC wołane z TS **wyłącznie** przez `supabaseAdmin` nie ma EXECUTE dla anon/authenticated (`SERVER_ONLY_RPC_REVIEWED` jest puste, :775)                                                                                                                                                               | 1073      |
| 4   | tabela i wskazane kolumny istnieją                                                                                                                                                                                                                                                                    | 1096      |
| 5   | rola ma uprawnienie kolumnowe/tabelowe do operacji (42501)                                                                                                                                                                                                                                            | 1114      |
| 6   | literały zapisywane z TS przechodzą typ i CHECK kolumny                                                                                                                                                                                                                                               | 1146      |
| 7   | cel `onConflict` ma unikalny indeks                                                                                                                                                                                                                                                                   | 1156      |
| 8   | grant SELECT jest równy stałej `PUBLIC_COLUMN_CONTRACTS` (dziś tylko `ad_slots`, :127-134)                                                                                                                                                                                                            | 1176      |
| 9   | SECURITY DEFINER wykonywalny dla klienta nie czyta z jsonb kluczy tożsamości (`IDENTITY_KEYS`, :779-794: tenant_id, company_id, user_id, owner_id, created_by, ...), chyba że ciało woła bramkę `assert_*`, `has_role`, `is_*admin*`, `is_tenant_staff`, `club_capabilities` lub `club_thread_access` | 1197-1220 |

Tak w praktyce działa reguła z AGENTS.md: literalne nazwy, granty dopasowane do roli, `service_role` dla funkcji tylko serwerowych, tenant z sesji. Wzorcowe wywołanie przez `context.supabase.rpc("admin_consent_decisions", {...})` jest w `src/lib/admin/consentAudit.functions.ts:17-28`.

##### 6. Pułapka uprawnień domyślnych

- **Funkcje:** domyślne uprawnienia platformy nadają EXECUTE na każdą nową funkcję w `public` jawnie rolom anon i authenticated. Samo `REVOKE ... FROM PUBLIC` tego nie zdejmuje (`supabase/migrations/20261007120500_service_only_rpc_default_execute.sql:2-12`, `scripts/pgtap-local/stub.sql:165-173`). Trzeba pisać `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated`.
- **Tabele i widoki:** na produkcji `pg_default_acl` daje anon, authenticated i service_role `arwdDxtm` na każdą nową relację (`src/lib/ci/definerViewGrants.ts:4-7`). Baza w CI tego nie robi (`stub.sql:170-172`), więc pgTAP **nie wykryje** brakującego `REVOKE` na tabeli. `REVOKE ALL ... FROM PUBLIC, anon, authenticated` trzeba pisać zawsze.
- `CREATE POLICY` bez klauzuli `TO` dotyczy roli PUBLIC, a bramka anon-insert traktuje `public` jak anon (`check-sql-anon-insert.ts:108`).
- **search_path:** SECURITY DEFINER zawsze z `SET search_path = public, pg_temp` (`20260830120000_secdef_search_path_pg_temp_last.sql:1-20`; asercja w `supabase/tests/sms_send_log_test.sql:52-59`).

##### 7. Wzorcowa nowa tabela z tenant_id, RLS i grantami (do naśladowania)

**Tabela tylko serwerowa** (np. kolejka kroków lub zapisy w ścieżce, pisze ją silnik): `supabase/migrations/20261012131000_sms_send_log.sql`.

- Tabela: `tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE`, nazwane CHECK-i i UNIQUE (:61-82).
- Indeks (:85) i trigger `_tg_touch_updated_at` (:87-90).
- `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL ... FROM PUBLIC, anon, authenticated` + `GRANT ALL ... TO service_role` (:92-94), do tego `COMMENT ON` (:96-99).
- Funkcje claim/finish/prune jako SECURITY DEFINER z `search_path = public, pg_temp`, REVOKE od klientów i GRANT dla service_role (:103-237).
- Zadanie pg_cron (:239-252).

**Tabela czytana przez panel admina:** polityki z `supabase/migrations/20261012130600_event_consent_ledger.sql:401-434`.

```sql
CREATE POLICY "x_staff_read" ON public.x FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
         AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
              OR public.is_super_admin((SELECT auth.uid()))));
REVOKE ALL ON TABLE public.x FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.x TO authenticated;
GRANT SELECT, INSERT ON TABLE public.x TO service_role;
```

Polityka dla admina i redaktora: `tenant_id = public.current_tenant_id() AND public.is_admin_or_editor()` (`20260824074231_4a952090-...sql`, polityka `crm_webhook_endpoints_staff_all`).

**RPC admina z ładunkiem jsonb:** tenant z sesji przez `v_tenant uuid := public.assert_admin_tenant()` (`supabase/migrations/20260713190000_member_analytics.sql:25-45`, użycie w `admin_member_funnel` :60-67), albo `current_tenant_id()` z bramką roli, jak w `admin_club_upsert` (`20260811110124_c48c6ea0-...sql:1-19`). Ostatnie definicje helperów:

- `current_tenant_id()`: `20260626180412_470ca0e8-...sql:1`, czyta tenant z `profiles` po `auth.uid()`.
- `has_role(uuid, app_role)`: `20260625160054_98e418da-...sql:16-30`, zawężone do `current_tenant_id()`.
- `is_super_admin(uuid)`: `20260824074231_4a952090-...sql:41-58`.
- `is_staff()`: `20260628230000_tenant_isolation_and_authz.sql:42-55` (admin, editor, author).

##### 8. Rejestrowanie zadań cyklicznych

1. **pg_cron w migracji** dla zadań czysto SQL (46 migracji używa `cron.schedule`). Wzorzec: blok `DO` z guardem `IF to_regclass('cron.job') IS NULL THEN RAISE NOTICE ...; RETURN; END IF;`, potem `cron.unschedule` w `BEGIN/EXCEPTION`, potem `cron.schedule('nazwa', '53 3 * * *', $job$SELECT public.fn(50000)$job$)`, a całość w `EXCEPTION WHEN OTHERS THEN RAISE WARNING` (`20261012131000_sms_send_log.sql:239-252`, `20261007140800_rate_limits_retention.sql:62-70`). pgTAP przypina wpis przez `row_eq(... FROM cron.job WHERE jobname = ...)` (`sms_send_log_test.sql:178-181`).
2. **Tick co minutę w TypeScripcie** (dla e-maili i CRM). pg_cron `jobs-tick` (`* * * * *`, `SELECT public.invoke_jobs_tick()`, `20260731130000_job_scheduler_reconcile_runner_telemetry.sql:435`) woła przez pg_net `POST /api/public/jobs-tick` z nagłówkiem `x-jobs-secret` (`20260731210000_community_cron_db_schedule.sql:121-221`). Dalej idzie `src/routes/api/public/jobs-tick.ts:15-51`, a potem `runJobsTick` z budżetem czasu i krokami `runJobStep` (`src/lib/server/jobsTick.server.ts:238-261`, kolejne kroki od :273). Nowy krok silnika ścieżek dokłada się tutaj.
3. **Siatka bezpieczeństwa:** GitHub Actions `.github/workflows/scheduler.yml:47-80` i `scripts/scheduler-tick.mjs`. Kontrakt nazw jobów to `SCHEDULER_JOBS` (`src/lib/jobs/scheduler.ts:21`). Test parytetu z workflow i sterownikiem: `src/lib/jobs/__tests__/scheduler.test.ts:88-108`.

##### 9. Typy w `src/integrations/supabase/types.ts`

- Plik jest generowany z bazy **produkcyjnej**. Wszystkie widoczne zmiany robi `gpt-engineer-app[bot]` (Lovable) po wdrożeniu migracji. Regeneracja wymaga dostępu do projektu (`scripts/check-generated-types-freshness.ts:31-34`, `generatedTypesFreshness.ts:18-23`). Plik ma 34 055 linii; sekcje: `Tables` :16, `Views` :22571, `Functions` :23263, `Enums` :33774.
- Nowe tabele i RPC w PR-ze trzeba **dopisać ręcznie w formacie generatora**, inaczej `supabase.from("nowa")` / `.rpc("nowa")` nie skompiluje się w `tsgo`. Format:
  - tabela: `Row` / `Insert` / `Update` / `Relationships`, np. `sms_send_log` (:21096-21145);
  - funkcja: `Args` (klucze alfabetycznie) + `Returns`, np. `sms_send_claim` (:33611-33614);
  - zachować porządek alfabetyczny.
- Bramka `check:types-freshness` oblewa, gdy migracja doda kolumnę do **istniejącej** tabeli, a `types.ts` jej nie ma. Kolumny z `CREATE TABLE` są zwolnione.
- Unikać `as unknown as` (`generatedTypesFreshness.ts:4-11`).

##### 10. Testy pgTAP

- Konwencje (`supabase/tests/README.md:85-94`): plik `<temat>_test.sql`, struktura `BEGIN; SELECT plan(N); ... SELECT * FROM finish(); ROLLBACK;`.
- Seed: własne UUID tenantów, `ALTER TABLE auth.users DISABLE TRIGGER USER`, jawne `profiles.tenant_id` i `user_roles(user_id, role, tenant_id)` (`club_list_visibility_test.sql:42-80`).
- Podszywanie się pod użytkownika: `SET LOCAL ROLE authenticated|anon|service_role` + `set_config('request.jwt.claims','{"sub":"...","role":"authenticated"}', true)` i `RESET ROLE` (:151-258).
- Asercje ACL przez `has_function_privilege` / `has_table_privilege`, RLS przez `relrowsecurity`, pg_cron przez `cron.job` (`sms_send_log_test.sql:22-59,178-181`).
- Uruchamianie:
  - CI: `supabase test db`;
  - lokalnie bez Dockera: `bun run test:pgtap-local [all|migrate|test] [wzorzec]`, z osobnymi `PGTAP_DIR` i `PGTAP_PORT` przy równoległych przebiegach (`scripts/pgtap-local/README.md:1-111`, `run.sh:207-212`).
- Test, który czyta treść migracji, powinien używać `readLogicalMigration` (skleja części `_partN`, `src/lib/ci/migrationSize.ts:95`).
- Istniejące „inwentarze” do rozszerzania: `definer_client_exec_inventory_test.sql`, `service_only_rpc_grants_test.sql`, `security_definer_tenant_scope_test.sql`.

##### 11. Bramka TS dla zapytań service-role

Plik `src/lib/server/*.server.ts` albo `src/lib/*.server.ts`, który używa `supabaseAdmin`, musi:

- być wpisany do `SERVICE_ROLE_READERS`,
- mieć `.eq("tenant_id", …)` na każdym zapytaniu albo wpis w `EXEMPTIONS`.

Dowód: `src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts:83-112,138-152`. Kod silnika poza tym katalogiem (np. `src/lib/journeys/`) tej bramki nie uruchamia, ale reguła tenant-z-sesji i tak obowiązuje.

##### 12. Środowisko

| Narzędzie        | Stan                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| bun              | 1.4.2 (repo wymaga 1.4.3, `.bun-version`)                                                                                           |
| node             | 22.22 (repo wymaga 24.22.0)                                                                                                         |
| tsgo             | `node_modules/.bin/tsgo`                                                                                                            |
| docker           | klient 29.8.2 i `dockerd` są, ale demon nie działa (brak `/var/run/docker.sock`)                                                    |
| supabase CLI     | brak                                                                                                                                |
| PostgreSQL 16.15 | jest w `/usr/lib/postgresql/16/bin` (poza PATH, runnery go znajdują)                                                                |
| psql             | jest                                                                                                                                |
| pgtap            | **brak**. Pakiet `postgresql-16-pgtap` 1.3.2-2 i opcjonalnie `postgresql-16-pgvector` 0.6.0-1 są dostępne w apt po `apt-get update` |
| pg_prove         | brak                                                                                                                                |

##### 13. Istniejące obiekty, których nie dublować (do oceny w innych obszarach)

- `public.domain_events` + `emit_domain_event()` + triggery `tg_*_emit_events` (m.in. dla `newsletter_subscribers` i `crm_leads`): `supabase/migrations/20260711200000_domain_event_bus.sql:24,98,274,343`.
- Silnik `workflow_definitions` / `workflow_runs` / `workflow_templates` + `run_workflow_step()` + `tg_run_workflows_for_event()`: `20260711204000_workflow_engine.sql:29,51,69,127,252`; typy w `types.ts:22356,22406,22460`.
- Tabele `journey*` / `sequence*` / `enrollment*` **nie istnieją**.

### Do reużycia

- **assert_admin_tenant()** (`supabase/migrations/20260713190000_member_analytics.sql:25`): Pierwsza linia DECLARE w każdym admin RPC ścieżek: `v_tenant uuid := public.assert_admin_tenant();` - rzuca forbidden bez roli admin, zwraca tenant z profiles sesji; spełnia też regex bramki redakcji asercji 9 kontraktu TS<->SQL.
- **current_tenant_id() / has_role(uuid, app_role) / is_super_admin(uuid) / is_admin_or_editor()** (`supabase/migrations/20260626180412_470ca0e8-ad8a-4f4c-a731-d4768501ee5a.sql:1; 20260625160054_98e418da-fc65-4f0a-85bf-2bd90f31ef96.sql:16; 20260824074231_4a952090-86ab-46ed-a923-5cd9855c5d8c.sql:41`): Predykaty RLS: `tenant_id = (SELECT public.current_tenant_id()) AND (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.is_super_admin((SELECT auth.uid())))` albo `... AND public.is_admin_or_editor()`.
- **\_tg_touch_updated_at()** (`supabase/migrations/20260718215718_df61e0ac-a9af-4ff0-bbd0-2b693090f9ec.sql:2`): `DROP TRIGGER IF EXISTS x_touch_updated_at ON public.x; CREATE TRIGGER x_touch_updated_at BEFORE UPDATE ON public.x FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();`
- **Wzorzec tabeli service_role-only + claim/finish/prune + pg_cron** (`supabase/migrations/20261012131000_sms_send_log.sql`): Szablon kolejki kroków/zapisów ścieżki: tabela z tenant_id FK, CHECK-i nazwane, RLS bez polityk klienta, REVOKE ALL FROM PUBLIC, anon, authenticated + GRANT service_role; funkcje SECURITY DEFINER `SET search_path = public, pg_temp`; dzierżawa INSERT ... ON CONFLICT ... DO UPDATE WHERE; prune partiami FOR UPDATE SKIP LOCKED; blok DO z guardem to_regclass('cron.job').
- **Polityki staff_read / self_read z granicą tenanta** (`supabase/migrations/20261012130600_event_consent_ledger.sql:401-434`): Kopiować kształt polityk SELECT TO authenticated (admin najemcy + własny wiersz przez EXISTS z tenant_id rodzica) i bloku REVOKE/GRANT.
- **admin_club_upsert(p_payload jsonb)** (`supabase/migrations/20260811110124_c48c6ea0-10a7-4b36-85f3-861907b06c3e.sql:1`): Wzorzec RPC zapisu z ładunkiem jsonb: tenant i uid z sesji, walidacja pól, kody błędów 42501/22023/23505, nigdy tenant z payloadu.
- **Server function admina przez requireSupabaseAuth** (`src/lib/admin/consentAudit.functions.ts:17-28`): createServerFn + .middleware([requireSupabaseAuth]) + walidator zod + `context.supabase.rpc("literalna_nazwa", { p_... })` - kontrakt TS<->SQL rozpozna rolę authenticated i sprawdzi EXECUTE/klucze.
- **runJobsTick / runJobStep (tick co minutę)** (`src/lib/server/jobsTick.server.ts:238-261`): Dodać krok silnika ścieżek: `const journeys = await runJobStep(overBudget, async () => { const { runJourneysTick } = await import("@/lib/journeys/tick.server"); return runJourneysTick(admin, { deadlineAt }); });` przed drenem poczty (drainEmailQueues), żeby maile kroków wyszły w tym samym ticku.
- **SCHEDULER_JOBS + scheduler.yml + scheduler-tick.mjs** (`src/lib/jobs/scheduler.ts:21; .github/workflows/scheduler.yml:55-80; scripts/scheduler-tick.mjs`): Jeśli ścieżki mają mieć ręczny przebieg z panelu/Actions: dopisać nazwę joba w trzech miejscach naraz (test parytetu src/lib/jobs/**tests**/scheduler.test.ts:88-108).
- **Szablon testu pgTAP** (`supabase/tests/sms_send_log_test.sql; supabase/tests/club_list_visibility_test.sql:42-80`): ACL (has_function_privilege/has_table_privilege), relrowsecurity, search_path z pg_temp, row_eq na cron.job; seed tenantów/auth.users/profiles/user_roles i set_config('request.jwt.claims') do testów izolacji tenantów.
- **Lokalny runner pgTAP** (`scripts/pgtap-local/run.sh`): Po `apt-get install -y postgresql-16-pgtap postgresql-16-pgvector`: `PGTAP_DIR=/tmp/pgtap-journeys PGTAP_PORT=5450 bash scripts/pgtap-local/run.sh all journey` - pełny replay 1237 migracji + generacja kontraktu TS<->SQL + wybrane testy.
- **split-migration** (`scripts/split-migration.ts`): `bun run scripts/split-migration.ts supabase/migrations/<plik>.sql --dry-run` gdy plik > 45 KiB; tnie między instrukcjami najwyższego poziomu na `_partN` z kolejnymi wersjami.
- **verify:static** (`scripts/verify-static.ts`): `bun run verify:static` - wszystkie offline'owe bramki check:* w kolejności CI (sekundy) przed commitem; potem `bun run typecheck` i vitest.
- **readLogicalMigration** (`src/lib/ci/migrationSize.ts:95`): W testach vitest czytających treść migracji (np. parytet enumów/CHECK z TS) - skleja część 1 i części _partN.
- **domain_events / emit_domain_event / workflow_definitions / run_workflow_step** (`supabase/migrations/20260711200000_domain_event_bus.sql:24,98; supabase/migrations/20260711204000_workflow_engine.sql:29,127,252`): Istniejąca szyna zdarzeń i prosty silnik reguł - wyzwalacze ścieżek powinny je rozszerzać (ocena w obszarze automatyzacji), nie tworzyć równoległej szyny.

### Ograniczenia i bramki

- Nazwa pliku migracji: `^\d{14}_[a-z0-9_]+\.sql$` (src/lib/ci/migrationLedger.ts:65), wersja unikalna w całym katalogu (migrationReplay.ts:10-18) i większa niż 20261017150000 (Lovable stosuje niezastosowane pliki w kolejności nazw: docs/NAPRAWA_ZAPISY_WYDARZEN_REG_2026-10-12.md:188).
- Plik migracji ≤ 45 KiB (46 080 B), bo Lovable odrzuca większe (src/lib/ci/migrationSize.ts:14). CI tego nie pilnuje. Większe pliki tnie się `scripts/split-migration.ts`.
- Nie dopisywać `supabase/migration-ledger.json`. Wpis `reconciled` dodaje operator po wdrożeniu, tylko gdy pipeline zmienił wersję. Baseline może tylko rosnąć.
- Bliźniak drizzle jest opcjonalny (zapis robi Lovable). Jeśli powstaje, musi mieć identyczny SQL wykonywalny, `meta/NNNN_snapshot.json` i wpis w `_journal.json` ze ściśle rosnącym `when`. Plik tylko w drizzle wymaga wpisu w `MIGRATION_LANES`.
- Migracje idempotentne: CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY/TRIGGER IF EXISTS przed CREATE, CREATE OR REPLACE FUNCTION, cron.unschedule przed cron.schedule.
- Każda nowa tabela ma: `tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE`, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` oraz `REVOKE ALL ON TABLE ... FROM PUBLIC, anon, authenticated` z jawnymi GRANT. Na produkcji pg_default_acl daje klientom arwdDxtm, a CI tego nie wykryje.
- Polityki zawsze z `TO authenticated` (bez TO = PUBLIC = anon dla bramki anon-insert). Predykat: `tenant_id = (SELECT public.current_tenant_id())` plus bramka roli `has_role`/`is_super_admin`/`is_admin_or_editor`. Zero permisywnego INSERT dla anon.
- Jeśli jakakolwiek polityka właścicielska tabeli (auth.uid() = user_id) wiąże tenant, muszą go wiązać wszystkie klauzule USING/WITH CHECK na tej tabeli. Raz nadanego wiązania z tenantem nie wolno zdjąć w późniejszej migracji.
- Każda funkcja SECURITY DEFINER: `SET search_path = public, pg_temp` oraz `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated` (domyślne uprawnienia nadają EXECUTE jawnie anon i authenticated), potem `GRANT EXECUTE` tylko rolom, które ją wołają.
- RPC wołane z TS wyłącznie przez `supabaseAdmin` (claim kroków, tick silnika) nie mogą mieć EXECUTE dla anon/authenticated (asercja 3 kontraktu TS<->SQL). Wyjątek wymaga wpisu w `SERVER_ONLY_RPC_REVIEWED`.
- Tenant, firma i użytkownik w RPC biorą się z sesji: `public.assert_admin_tenant()` / `public.current_tenant_id()` / `auth.uid()`. Nigdy `p_payload->>'tenant_id'` ani innego klucza z `IDENTITY_KEYS` bez bramki assert_*/has_role w ciele (asercja 9).
- SECURITY DEFINER nie może łączyć `public_tenant_id()`/`request_public_host()` z `has_role()`/`is_staff()` (check:sql-tenant-scope). Uprzywilejowane operacje skaluje się po `current_tenant_id()`.
- Literały w `has_role(..., 'x')` (SQL, pgTAP, TS) wyłącznie z enuma app_role: admin, author, editor, super_admin, user.
- W TS nazwy RPC i tabel tylko jako literały: zapadka `MAX_UNRESOLVED_SITES = 13` jest pełna (13/13), więc każde `.rpc(zmienna)` / `.from(zmienna)` oblewa `check:ts-sql-contract`. Klucze obiektu argumentów muszą równać się nazwom parametrów SQL (wymagane bez DEFAULT ⊆ klucze ⊆ wszystkie).
- `context.supabase` (requireSupabaseAuth) to rola authenticated, więc funkcja lub kolumny potrzebują grantów dla authenticated. `supabaseAdmin` to service_role.
- `.upsert(..., { onConflict: "a,b" })` wymaga w migracjach UNIQUE/indeksu unikalnego dokładnie na (a,b).
- Literały tekstowe i enumowe zapisywane z TS do kolumn muszą przechodzić typ i CHECK kolumny (asercja 6), więc słowniki statusów i typów kroków w CHECK muszą być zsynchronizowane z TS.
- Nowa kolumna dodana `ALTER TABLE ... ADD COLUMN` do istniejącej tabeli musi trafić do `src/integrations/supabase/types.ts`, inaczej oblewa `check:types-freshness`. Nowe tabele i RPC trzeba dopisać ręcznie w formacie generatora (Row/Insert/Update/Relationships, Args/Returns, porządek alfabetyczny), żeby `tsgo --noEmit` przeszedł.
- Nowy plik `src/lib/server/*.server.ts` lub `src/lib/*.server.ts` z `supabaseAdmin` wymaga wpisu w `SERVICE_ROLE_READERS` i `.eq("tenant_id", …)` na każdym zapytaniu (src/lib/server/**tests**/serviceRoleTenantScope.gate.test.ts:103-112).
- Widok w public: `security_invoker = on` albo `REVOKE ALL ON <widok> FROM anon, authenticated` w tym samym pliku. Nigdy GRANT praw innych niż SELECT dla klientów na widok DEFINER.
- pg_cron rejestrować tylko w bloku DO z guardem `IF to_regclass('cron.job') IS NULL THEN RAISE NOTICE ...; RETURN; END IF;`, z `cron.unschedule` w BEGIN/EXCEPTION, `cron.schedule(nazwa, cron, $job$SELECT public.fn(...)$job$)` i `EXCEPTION WHEN OTHERS THEN RAISE WARNING`.
- Nowy job w kontrakcie schedulera (`SCHEDULER_JOBS`) wymaga równoczesnego dopisania do `.github/workflows/scheduler.yml` (opcje workflow_dispatch) i `scripts/scheduler-tick.mjs` (test parytetu).
- Żadnych wykonywanych DELETE/UPDATE na `storage.objects` w migracji bez sankcjonowanej furtki GUC (replay inwariant 2).
- Każdy nowy plik pgTAP: `BEGIN; SELECT plan(N); … SELECT * FROM finish(); ROLLBACK;`, własne UUID tenantów, asercje ACL (has_function_privilege/has_table_privilege), relrowsecurity, izolacja dwóch tenantów oraz cron.job dla nowych zadań.
- Jeśli nowa funkcja SQL czyta flagi `membership_tiers.features` (has_tier_feature / features ->>), trzeba przegenerować `src/lib/authz/authzSnapshot.generated.ts` i opisać flagę w rejestrze capabilities (vitest authzSnapshotParity.test.ts).

### Braki

- W repo nie ma tabel ani RPC ścieżek (journey/sequence/enrollment). Są tylko `workflow_definitions`/`workflow_runs`/`workflow_templates` (20260711204000_workflow_engine.sql:29,51,69) i `domain_events` (20260711200000_domain_event_bus.sql:24). Decyzja: rozszerzać czy obok, należy do obszaru automatyzacji.
- W środowisku brak rozszerzenia pgtap, więc `bun run test:pgtap-local` pada na `stub.sql:26`. Trzeba `apt-get install -y postgresql-16-pgtap` (1.3.2-2 dostępny) i opcjonalnie `postgresql-16-pgvector` (0.6.0-1). Bez tego żadnego testu pgTAP ani pełnego replayu migracji nie da się uruchomić lokalnie.
- Brak CLI `supabase` i działającego demona Docker, więc `bun run db:test` (`supabase test db`) jest niedostępne. Kanoniczny pgTAP i pełny kontrakt TS<->SQL zweryfikuje dopiero job `pgtap` w CI.
- `check:db-contract` i `check:migration-ledger` wymagają `SUPABASE_URL` i klucza (brak w env i brak `.env`). Biegną tylko po merge na main (job post-deploy).
- Regeneracja `src/integrations/supabase/types.ts` wymaga dostępu do projektu produkcyjnego (robi ją bot Lovable po wdrożeniu). Lokalnie wpisy dla nowych tabel i RPC trzeba dopisać ręcznie.
- Brak bramki CI na rozmiar migracji (logika `SIZE_CONFIG` w src/lib/ci/migrationSize.ts nie ma runnera). Limit 45 KiB trzeba pilnować ręcznie.
- `bun run generate:authz-snapshot --check` jest czerwone na HEAD (dryf proweniencji: migracje 1146 -> 1237). Nie jest w CI ani w verify:static. Vitest parytetu przechodzi.
- Zapadka `MAX_UNRESOLVED_SITES` jest wyczerpana (13/13), więc generyczny dyspozytor kroków wołający `.rpc(nazwaZmienna)` nie przejdzie CI. Kroki muszą być rozgałęzione na literały.
- Środowisko ma bun 1.4.2 i node 22.22, a repo wskazuje bun 1.4.3 (`.bun-version`) i node 24.22.0 (`.node-version`). Bramki przeszły mimo to, ale wersje nie są identyczne z CI.

## 6. Kanwa ścieżek: biblioteki, budżet bundla, a11y

### Rozpoznanie: KANWA ścieżek (journeys), wizualny edytor w stylu HubSpot

Zakres: biblioteki, istniejące kanwy i edytory, API komponentów `ui`, ikony, tokeny i tryb ciemny, bramki rozmiaru oraz rekomendacja rysowania drzewa. Niczego nie zmieniałem.

#### 0. Najważniejsze wnioski

1. **W repo nie ma żadnej biblioteki do grafów ani układu drzewa.** Brakuje `@xyflow/react`, `reactflow`, `dagre`, `elkjs`, `d3`, `framer-motion` i `recharts`. Jest `@dnd-kit` oraz Radix (`package.json:84-109`), a `framer-motion` celowo usunięto (`scripts/check-bundle-size.ts:2292,2511`; `src/components/admin/community/EventSpeakerCreateDialog.tsx:38-44`).
2. **Budżet bundla prawie się wyczerpał.** Według ostatniego wpisu kroniki:
   - OVERALL: 4877,8 przy progu 4879 KB gz, zostaje ok. 1,2 KB;
   - CSS: 98,3 przy progu 100, zostaje ok. 1,7 KB;
   - PUBLIC: 2879,1 przy progu 2881, zostaje ok. 1,9 KB.

   Źródło: `scripts/check-bundle-size.ts:2201-2202, 2254, 2329, 2384, 2499`. Każdy nowy moduł panelu wymaga zmierzonego wpisu do kroniki i podniesienia progu. Ciężka biblioteka grafu nie jest do obrony.

3. **Gotowy wzorzec kanwy już istnieje.** `SeatMapCanvas` (plan sali) łączy SVG, roving tabindex, jeden cel upuszczenia, instrukcje `sr-only` i alternatywny widok tabeli (`src/components/admin/events/molecules/SeatMapCanvas.tsx:1-17, 178-226`). Czysta geometria leży w `src/lib/events/seatingGeometry.ts` razem z testami.
4. **Obecny edytor automatyzacji jest liniowy.** To formularz w Dialogu: wyzwalacz, warunek (containment) i lista kroków przesuwanych strzałkami w górę i w dół (`src/components/admin/workflows/WorkflowEditorDialog.tsx:108-293`). Nie ma w nim rozgałęzień, opóźnień ani kanwy. Ścieżki powinny rozszerzyć ten moduł, a nie budować drugi.

#### 1. Biblioteki (package.json)

| Biblioteka                                                                   | Stan                  | Dowód                                                                           | Uwagi                                                                   |
| ---------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| @xyflow/react / reactflow                                                    | BRAK                  | `package.json:79-176` (brak wpisu), brak w `node_modules`                       | nie dodawać (patrz bramki)                                              |
| dagre / elkjs                                                                | BRAK                  | j.w.                                                                            | układ trzeba policzyć samemu, w czystym TS                              |
| d3 (dowolny moduł)                                                           | BRAK                  | j.w.                                                                            | wykresy to własny silnik SVG (`src/components/charts/*`)                |
| framer-motion                                                                | BRAK, celowo usunięty | `scripts/check-bundle-size.ts:2511-2526`, `src/components/ui/promo-card.tsx:10` | ruch przez `tw-animate-css` i `.pc-rise-y` (`src/styles.css:1928-1942`) |
| @dnd-kit/core, sortable, utilities                                           | JEST                  | `package.json:84-86`                                                            | 20 plików; sensory Pointer i Keyboard                                   |
| cmdk                                                                         | JEST                  | `package.json:136`                                                              | owinięty w `ui/command.tsx`                                             |
| Radix: tooltip, hover-card, popover, dialog, scroll-area, context-menu, tabs | JEST                  | `package.json:97-109`                                                           |                                                                         |
| tw-animate-css                                                               | JEST                  | `package.json:159`, `src/styles.css:16`                                         | animacje wejścia i wyjścia                                              |
| lucide-react 0.577                                                           | JEST                  | `package.json:144`                                                              | patrz rozdz. 4                                                          |

#### 2. Istniejące kanwy i edytory drag&drop

| Edytor                 | Plik                                                                                                                                                                | Technika                                                                                                                                                                                                                               | Co wziąć                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Plan sali (SVG)        | `src/components/admin/events/molecules/SeatMapCanvas.tsx:1-291`                                                                                                     | SVG z `viewBox`, jeden `useDroppable` (`:8-11, 124`), roving tabindex (`:166-201`), `role="group"` z `aria-describedby` (`:214-226`), równoległy widok tabeli (`:15-17`), klasy tokenów na SVG `fill-muted stroke-border` (`:241-260`) | **główny wzorzec** a11y i rysowania         |
| Czysta geometria planu | `src/lib/events/seatingGeometry.ts:182-320` (`boundsOf`, `planViewBox`, `nextSeatId`, `orderSeats`) z testami w `src/lib/events/__tests__/seatingGeometry*.test.ts` | czysta funkcja, testowalna w vitest                                                                                                                                                                                                    | wzór dla `layoutJourney()` i `nextNodeId()` |
| Atom miejsca           | `src/components/admin/events/atoms/SeatGlyph.tsx:10, 60-79`                                                                                                         | `role="button"`, `tabIndex` 0 albo -1, `aria-pressed`, pierścień `group-focus-visible`                                                                                                                                                 | wzór węzła z fokusem                        |
| Builder newslettera    | `src/components/admin/newsletter/builder/NewsletterBuilder.tsx:1-18, 201-204, 289-625`; `BuilderCanvas.tsx:108-140`                                                 | 3 panele (biblioteka, kanwa, właściwości), `DndContext` z `KeyboardSensor` i `sortableKeyboardCoordinates`, `DragOverlay`, `useHistory`, `useUnsavedChangesGuard`                                                                      | układ 3-panelowy, undo/redo                 |
| CMS Builder            | `src/components/admin/builder/Builder.tsx:1-17`                                                                                                                     | natywny HTML5 DnD (bez dnd-kit), operacje drzewa w `@/lib/builder/operations`, `useHistory`, skróty                                                                                                                                    | czyste operacje na drzewie oraz historia    |
| Edytor bloków          | `src/components/admin/blocks/BlockCanvas.tsx:245-247, 476-576`; `molecules/BlockListView.tsx:116-165`                                                               | sortable i **`role="tree"`/`treeitem`/`aria-level`**                                                                                                                                                                                   | wzorzec ARIA widoku konspektu               |
| Sidebar builder        | `src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx`                                                                                                        | lista sortowalna                                                                                                                                                                                                                       | –                                           |
| Agenda wydarzenia      | `src/components/admin/events/molecules/AgendaStructureDiagram.tsx:1-173`                                                                                            | diagram z flexboxa i kafli, legenda `<dl>`, przewijanie `overflow-x-auto`                                                                                                                                                              | legenda typów kroków                        |
| Kalendarz wpisów       | `src/routes/admin.posts.calendar.tsx:220, 316-365`                                                                                                                  | `PointerSensor` z dystansem 4                                                                                                                                                                                                          | –                                           |

**Brakuje:** algorytmu układu drzewa (tidy, Reingold), pomocnika pan/zoom kanwy oraz rysowania krawędzi grafu. Grep po `reingold|treeLayout|dagre|elk` nic nie zwraca. `cropGeometry` (`src/lib/media/cropGeometry.ts:68-91`, `ZOOM_MIN=1`) dotyczy kadrowania i się tu nie nadaje.

#### 3. Moduł „Automatyzacje" (punkt rozszerzenia UI)

| Fakt                                                                                    | Dowód                                                                                                                                           |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Trasa `/admin/workflows`, zakładki definitions, runs, templates i trace w search params | `src/routes/admin.workflows.tsx:1-11, 40-71`                                                                                                    |
| Trasa ustawia surowy tytuł zamiast `adminPageHead`                                      | `src/routes/admin.workflows.tsx:60-62` (wbrew regule z AGENTS.md; nowa trasa musi użyć `src/lib/adminPageHead.ts:2-14`)                         |
| Słownik i18n importowany w komponencie, nie w powłoce trasy (eager graf)                | `src/routes/admin.workflows.tsx:8-11`; `src/lib/i18n-admin-workflows.ts:1-6`; parytet pl/en testuje `src/lib/admin/__tests__/workflows.test.ts` |
| Katalog akcji jest kontraktem z SQL `run_workflow_step`                                 | `src/lib/admin/workflows.ts:12-36`                                                                                                              |
| Formularz parametrów generowany ze specyfikacji `WORKFLOW_ACTION_PARAMS`                | `src/lib/admin/workflows.ts:50-104`; `WorkflowEditorDialog.tsx:1-4, 381-400`                                                                    |
| Kroki to płaska lista `{action, params}` bez gałęzi i opóźnień                          | `src/lib/admin/workflows.ts:106-120`                                                                                                            |
| Edytor to Dialog `max-w-2xl` z listą kroków i strzałkami góra/dół                       | `WorkflowEditorDialog.tsx:110, 248-278, 297-355`                                                                                                |
| Atomy statusu z paletą tonów                                                            | `src/components/admin/workflows/atoms.tsx:14-44`                                                                                                |
| Wpis w nawigacji (grupa CRM, ikona `Workflow`)                                          | `src/lib/admin/adminNav.ts:56, 330`                                                                                                             |

#### 4. Komponenty `src/components/ui`: API i ograniczenia

| Komponent               | Eksporty i API                                                                                                                       | Ograniczenia ważne dla kanwy                                                                                                                                          | Dowód                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| tooltip                 | `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`; sam montuje Provider, gdy go brak                                  | `max-w-[260px] text-[11px] shadow-sm`                                                                                                                                 | `tooltip.tsx:17-59`                                     |
| hover-card              | `HoverCard`, `HoverCardTrigger`, `HoverCardContent` (align start, sideOffset 6)                                                      | `w-72 rounded-[8px] shadow-lg`; tylko mysz, **nie może być jedyną drogą do informacji**                                                                               | `hover-card.tsx:6-29`                                   |
| popover                 | `Popover`, `PopoverTrigger`, `PopoverAnchor`, `PopoverContent` (align center, sideOffset 4)                                          | `w-72 p-4 shadow-md`; `PopoverAnchor` pozwala zakotwiczyć popover przy przycisku „+" na krawędzi                                                                      | `popover.tsx:5-31`                                      |
| sheet                   | `Sheet`, `SheetContent` (side left/right/top/bottom), `SheetHeader`, `SheetTitle`, `SheetDescription`                                | **brak** `SheetTrigger`, `SheetClose`, `SheetFooter`; right ma `w-3/4 sm:max-w-sm` (trzeba nadpisać `className`); fokus wraca do otwierającego przez `useReturnFocus` | `sheet.tsx:27-44, 51-75, 107`; `src/lib/utils.ts:65-86` |
| dialog                  | `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`                       | `max-w-lg sm:rounded-lg shadow-lg`; `useReturnFocus`; 66 plików testów podmienia `ui/dialog` atrapą                                                                   | `dialog.tsx:28-54, 93-101`; `src/lib/utils.ts:59-61`    |
| command                 | `CommandDialog` (wymagany `label`), `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandSeparator` | **`Command` nie jest eksportowany**, więc cmdk w Popoverze wymaga dopisania eksportu; jedyny konsument to `src/components/search/CommandPalette.tsx:26`               | `command.tsx:9-22, 32-43, 130-138`                      |
| scroll-area             | `ScrollArea`                                                                                                                         | **tylko pionowy pasek**, wariant poziomy usunięto; kanwa szersza niż ekran potrzebuje natywnego `overflow-auto`                                                       | `scroll-area.tsx:24-33`                                 |
| button                  | warianty default, destructive, outline, secondary, ghost, link; rozmiary default h-8, sm h-7, lg h-9, icon 8x8                       | `pointer-coarse:min-h-11`, czyli 44 px na dotyku                                                                                                                      | `button.tsx:8-31`                                       |
| card                    | `rounded-xl border bg-card shadow`                                                                                                   | patrz pułapka admin-compact                                                                                                                                           | `card.tsx:9`                                            |
| badge                   | `rounded-[6px] border px-2.5 text-xs`                                                                                                | –                                                                                                                                                                     | `badge.tsx:7`                                           |
| SegmentedControl (atom) | `radiogroup` z `aria-checked`, rozmiary sm, md, lg                                                                                   | przełącznik „Kanwa / Lista"                                                                                                                                           | `src/components/atoms/SegmentedControl.tsx:1-60`        |

#### 5. Ikony: lucide-shim kontra lucide-react

| Reguła                                                                                                                                                                 | Dowód                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `@/lib/lucide-shim` przełącza paczkę lucide albo FontAwesome (`useIconPack`) i niesie wyłącznie ikony gorących ścieżek publicznych                                     | `src/lib/lucide-shim.tsx:1-9, 147-196`                                     |
| Brakującą w shimie ikonę kod panelu importuje wprost z `lucide-react` („furtka")                                                                                       | `src/components/admin/post-editor/organisms/PostDetailsNav.tsx:15-18`      |
| W praktyce `lucide-react` importuje 856 plików, shim 295; moduł workflows importuje z `lucide-react`                                                                   | `src/components/admin/workflows/atoms.tsx:5`, `WorkflowEditorDialog.tsx:8` |
| Brak reguły ESLint, która to wymusza                                                                                                                                   | `eslint.config.js:59-82`                                                   |
| **Każda ikona lucide spoza bootu trafia do wspólnego chunku `vendor-lucide`**, który pobierają też trasy publiczne, więc **nowa ikona panelu powiększa budżet PUBLIC** | `scripts/lib/clientChunkGroups.ts:191, 268-284`                            |

**Ikony już obecne w grafie (bez kosztu):** `Mail`, `MailOpen`, `MailCheck`, `MousePointerClick`, `Timer`, `Clock3`, `CalendarClock`, `GitBranch` (`src/components/clubs/atoms/ClubWorkspaceBadges.tsx:23`), `CircleDot`, `FlaskConical` (shim `:250`; dobra na split A/B), `ListChecks`, `UserCheck`, `UserMinus`, `UserPlus`, `Tag`, `Flag`, `LogOut`, `DoorOpen`, `Target`, `Zap`, `Workflow`, `Route`, `CreditCard`, `Lock`, `Ban`, `ZoomIn`, `ZoomOut`, `Maximize2`, `Plus`, `Trash2`, `Copy`, `GripVertical`, `ArrowDown`.

**Nieużywane nigdzie (nowy koszt):** `Hourglass`, `Split`, `GitFork`, `Shuffle`, `LocateFixed`, `CircleStop`, `Signpost`.

#### 6. Tokeny i tryb ciemny

| Token / zasada           | Wartość                                                                                                                                                                                                                               | Dowód                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wariant ciemny           | `@custom-variant dark (&:is(.dark *))`; klasę `.dark` stawia ThemeProvider na `<html>`, przełącznik siedzi w sidebarze panelu                                                                                                         | `src/styles.css:278`; `src/components/ThemeProvider.tsx:52, 172-187`; `src/components/admin/AdminShell.tsx:638-645`                                                                                     |
| Promień                  | `--radius: 6px`, czyli `rounded-sm` 2px, `rounded-md` 4px, `rounded-lg` 6px, `rounded-xl` 10px; panel konsekwentnie używa `rounded-[6px]`                                                                                             | `src/styles.css:388-391, 476`                                                                                                                                                                           |
| Powierzchnie             | `--card` #fff / #0f0f0f, `--popover`, `--muted`, `--border` oklch(0.9…) / oklch(1 0 0 / 8%), `--foreground` #ede9e7 w trybie ciemnym                                                                                                  | `src/styles.css:521-552, 1144-1194`                                                                                                                                                                     |
| Statusy (CSS vars)       | `--status-success` oklch(0.52 0.15 155) / (0.72 0.17 155); `--status-warning` oklch(0.58 0.15 65) / (0.78 0.16 75); `--destructive`                                                                                                   | `src/styles.css:542-545, 1189-1192`                                                                                                                                                                     |
| Statusy w panelu (klasy) | success `bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30`; danger `bg-destructive/10 text-destructive`; warning `bg-brand/10 text-brand-ink dark:text-brand`; neutral `bg-muted text-muted-foreground` | `src/components/admin/workflows/atoms.tsx:14-19`; `src/components/admin/atoms/StatusBadge.tsx:39-60` (sky = oczekuje, violet = zaplanowane); `src/components/admin/molecules/AdminMetricTile.tsx:18-30` |
| Marka                    | `--brand` #fa9346, `--brand-ink`                                                                                                                                                                                                      | `src/styles.css:547-551`                                                                                                                                                                                |
| Wykres (pozytyw/negatyw) | `--chart-positive` #1b6f8c / #6fb3c9, `--chart-negative` #ef5454                                                                                                                                                                      | `src/styles.css:744-745, 1348-1349`                                                                                                                                                                     |
| Cienie                   | tooltip `shadow-sm`, popover `shadow-md`, hover-card, dialog i sheet `shadow-lg`, card `shadow`                                                                                                                                       | pliki `ui` wyżej                                                                                                                                                                                        |
| Ruch                     | `motion-safe:` i `motion-reduce:` w panelu, hook `usePrefersReducedMotion`                                                                                                                                                            | `src/components/admin/atoms/HeartbeatDot.tsx:16`; `src/hooks/usePrefersReducedMotion.ts:15`                                                                                                             |
| Pulpit panelu            | po SSR renderuje się wyłącznie szkielet, panel montuje się za `useHydrated()`, więc kanwa nie potrzebuje parytetu SSR                                                                                                                 | `src/routes/admin.tsx:26-50, 76, 128-135`                                                                                                                                                               |

##### Pułapki arkusza panelu (`.admin-compact` na korzeniu powłoki: `src/components/admin/adminShellGeometry.ts:88`)

- **Każdy element z klasami zawierającymi `rounded-lg` i `border` dostaje wymuszone `padding: .75rem`** (`src/admin-styles.css:381-383`). Karta węzła kanwy z `rounded-lg border` straci geometrię, więc trzeba użyć `rounded-[6px]`.
- Wymuszone rozmiary z `!important`: `.text-xs` 11px, `.text-sm` 12px, `button` 12.5px, `p/li/label/span` 13px (`src/admin-styles.css:306-380`). Wysokości węzłów trzeba liczyć pod te wartości.
- `.admin-compact svg { color: inherit }` (`src/admin-styles.css:15-18`).
- Korzeń dokumentu ma `touch-action: pan-y pinch-zoom` i `overflow-x: clip` (`src/styles.css:282-300`). Przesuwanie kanwy w poziomie działa tylko wewnątrz lokalnego kontenera przewijanego albo z `touch-none` na tle kanwy (wzór: `src/components/admin/clubs/molecules/ClubTableGroupRow.tsx:40`).
- Utility Tailwinda używane **wyłącznie** pod `components/admin/**`, `routes/admin*` i `lib/admin/**` trafiają do `admin-styles.css` (`scripts/lib/adminCssPlugin.ts:5-36`; wykluczenia w `src/styles.css:2-5`). Plik kanwy położony poza tymi katalogami doda klasy do publicznego, render-blocking `styles.css` (budżet `publicCss` 85).

#### 7. Bramki rozmiaru

| Bramka                                        | Próg (zamrożony) | Ostatni pomiar z kroniki       | Zapas    | Dowód                               |
| --------------------------------------------- | ---------------- | ------------------------------ | -------- | ----------------------------------- |
| chunk (największy)                            | 286 KB gz        | –                              | –        | `scripts/check-bundle-size.ts:2254` |
| public                                        | 2881             | 2879,1                         | ~1,9     | `:2329, 2202`                       |
| **overall (tu liczy się kod panelu)**         | **4879**         | **4877,8** (admin-only 1998,7) | **~1,2** | `:2384, 2201-2202`                  |
| css (wszystkie arkusze, także `admin-styles`) | 100              | 98,3                           | ~1,7     | `:2499, 2201-2202`                  |
| publicCss                                     | 85               | –                              | –        | `:2544`                             |
| boot                                          | 579              | –                              | –        | `:2565`                             |

- W CI zmienne `MAX_*` są ignorowane. Próg zmienia się tylko commitem z wpisem do kroniki i przyczyną wzrostu (`scripts/check-bundle-size.ts:1150-1160, 2569-2595`). Gdy zapas spada poniżej 2%, skrypt wypisuje ostrzeżenie (`:2610`, koniec pliku).
- **Panel ma tylko budżet OVERALL, osobnego limitu admina nie ma.** Chunk liczy się jako admin-only z grafu: korzenie `admin.*` / `admin-` plus domknięcie importerów (`:2689-2763`, `ADMIN_ROOT` `:2758`). Nie należy nadawać nazwanego chunku kodowi aplikacji, bo kiedyś przyciągnął współdzielone moduły i trafił na trasy publiczne (`:2700-2706`).
- `check:chunks` (`scripts/check-chunk-graph.ts:1-115`) zabrania cykli statycznych importów między chunkami. Najczęstsza przyczyna to grupa w `scripts/lib/clientChunkGroups.ts`.
- Punkty odniesienia z `reports/bundle-baseline.json`: `admin.workflows` 13,7 KB, `admin.events_._eventId.registration.seating` 18,9, `seatingGeometry` 1,6, `vendor-lucide` 18,4, `CommandPalette` 8,2, `i18n-builder` 32,9 KB gz.
- Liczby w `docs/ARCHITECTURE.md:244-265` (PUBLIC ≤1000, OVERALL ≤1300) są **nieaktualne**. Źródłem prawdy jest `FROZEN_BUDGET_KB`.

**Wniosek kosztowy.** Własna kanwa (układ ~1,5 KB, kanwa ~4-6 KB, panel kroku ~5-8 KB, i18n ~4-6 KB) to szacunkowo 15-25 KB gz admin-only. Szacunek opiera się na analogii do `seating` i `admin.workflows`, nie na pomiarze. Wymaga to zmierzonego wpisu do kroniki dla `overall` (i dla `css`, jeśli przybędą klasy panelu). Biblioteka grafu (xyflow z zależnościami) to dodatkowo kilkadziesiąt KB gz. To również szacunek spoza repo i nie da się go obronić przy tej polityce.

#### 8. Rekomendacja: pionowy przepływ z gałęziami bez nowych zależności

##### 8.1 Architektura plików (cały kod pod ścieżkami admin, żeby CSS i JS trafiły do budżetu panelu)

- `src/lib/admin/journeys/layout.ts`: **czysty** układ drzewa, testowalny w vitest (happy-dom nie ma silnika layoutu, por. `src/test/axe.ts:4-8`).
- `src/lib/admin/journeys/nav.ts`: `nextNodeId(layout, id, key)` na wzór `nextSeatId` (`src/lib/events/seatingGeometry.ts:252-310`).
- `src/lib/admin/journeys/ops.ts`: operacje insert, remove, move i duplicate na drzewie, niemutujące (wzór `@/lib/builder/operations`, `Builder.tsx:10-12`).
- `src/components/admin/journeys/{JourneyCanvas,JourneyNodeCard,JourneyEdge,JourneyInsertButton,JourneyOutline,JourneyStepSheet}.tsx`.
- `src/lib/i18n-admin-journeys.ts` (eksport pl/en, test parytetu), importowany w komponencie, nie w powłoce trasy.

##### 8.2 Algorytm układu (tidy tree, O(n), bez pomiaru DOM)

- Węzeł ma stałą szerokość (np. 264 px) i stałą wysokość według rodzaju, bo typografia `.admin-compact` jest przypięta. W efekcie układ jest deterministyczny i nie ma przesunięć po pomiarze.
- Postorder: `subtreeW = max(NODE_W, Σ childW + GAP_X·(n−1))`. Preorder: `x` środka, `y += h + GAP_Y` (plus wiersz etykiety gałęzi: „Tak / Nie", „A 50% / B 50%").
- Wynik: `{nodes:[{id,x,y,w,h,depth,posInSet,setSize}], edges:[{from,to,d,label,insertAt}], width, height}`. Ścieżka `d` to łamana ortogonalna (pion, poziom, pion) z zaokrąglonymi narożnikami, rysowana jak w HubSpot.
- Scalenie gałęzi („przejdź do kroku X") renderować jako chip-odnośnik, nie jako krawędź. Nie będzie wtedy przecięć krawędzi ani potrzeby algorytmu DAG.

##### 8.3 Rendering

- Kontener ma `relative overflow-auto`, czyli natywne przewijanie w obu osiach (`ScrollArea` daje tylko pion). Wewnątrz scena o rozmiarze `bbox × zoom` z `transform: scale(z)` i `transform-origin: 0 0`.
- Pod spodem **jeden `<svg aria-hidden>`** na krawędzie, z klasami `stroke-border fill-none` (wzór `SeatMapCanvas.tsx:241-260`) i `vector-effect="non-scaling-stroke"`, żeby kreska przy zoomie zostawała linią włoskową.
- Węzły to **HTML pozycjonowany absolutnie**: prawdziwy tekst i i18n, `truncate`, fokus, kolor z tokenów `bg-card border-border`, `rounded-[6px]` (nie `rounded-lg`, patrz pułapka). Ikona rodzaju kroku i ton statusu jak w `workflows/atoms.tsx:14-19`.
- Przyciski „+" leżą na środku każdej krawędzi (`Button size="icon"`, `aria-label` „Dodaj krok po: X"). Otwierają `Popover` z `PopoverAnchor` i pogrupowaną listą typów kroku. Gdy potrzebna jest wyszukiwarka, trzeba dopisać eksport `Command` w `ui/command.tsx` albo użyć `CommandDialog`.
- Edycja kroku odbywa się w `Sheet side="right" className="sm:max-w-md"`. Formularz generuje specyfikacja parametrów, tak jak `WORKFLOW_ACTION_PARAMS` i `StepEditor` (`WorkflowEditorDialog.tsx:297-400`). Fokus po zamknięciu wraca do węzła (`useReturnFocus`).
- Statystyki węzła (wpisani, w toku, ukończeni, otwarcia, kliknięcia) pokazywać jako liczby na karcie. `HoverCard` może tylko uzupełniać (mysz). Opcjonalnie `Sparkline` (`src/components/charts/Sparkline.tsx:17-27`).
- Zoom realizują przyciski `ZoomIn`, `ZoomOut` i `Maximize2` (dopasuj do szerokości przez `useContainerWidth`) oraz Ctrl+kółko. Przesuwanie daje natywny scroll, a opcjonalnie przeciąganie tła (pointer events, `touch-none` tylko na tle). Bez animacji przy `prefers-reduced-motion`.
- Undo i redo przez `useHistory` (etykiety, `coalesceKey`); do tego `useUnsavedChangesGuard`, ewentualnie `useAutosave`.
- DnD w pierwszej wersji niepotrzebny (HubSpot przenosi kroki z menu). Jeśli reorder okaże się potrzebny, użyć dnd-kit z `KeyboardSensor` i `sortableKeyboardCoordinates` (`NewsletterBuilder.tsx:201-204`) oraz jednym droppable (`SeatMapCanvas.tsx:8-11`).

##### 8.4 Dostępność

- **Roving tabindex**: w tabulacji jest tylko jeden węzeł (`SeatGlyph.tsx:60-63`, `SeatMapCanvas.tsx:166-201`). Klawisze:
  - ↓ pierwszy potomek albo następny krok;
  - ↑ rodzic;
  - ←/→ sąsiednia gałąź na tym samym poziomie;
  - Home i End: wyzwalacz i ostatni krok;
  - Enter lub spacja otwiera edytor;
  - Delete pyta o potwierdzenie (`ConfirmDialog`).
- ARIA: `role="tree"` oraz `treeitem` z `aria-level`, `aria-setsize`, `aria-posinset` i `aria-expanded` na węzłach gałęzi (precedens `BlockListView.tsx:116-165`). Instrukcje klawiszy w `sr-only` przez `aria-describedby` (`SeatMapCanvas.tsx:214-226`), do tego region `aria-live="polite"` dla komunikatów „dodano krok", „usunięto".
- **Zawsze dostępny widok alternatywny „Lista"** (konspekt z wcięciami), jak tabela obok planu sali (`SeatMapCanvas.tsx:15-17`). Kanwa nie może być jedyną drogą do kroku.
- Testy przez `axeViolations` (`src/test/axe.ts:16-24`). Reguła `color-contrast` jest tam wyłączona, więc kontrast zapewniają wyłącznie tokeny.

##### 8.5 Responsywność

- Poniżej `md` domyślnie widok „Lista": te same karty, łączniki jako lewa krawędź `border-l`. Kanwa zostaje dostępna z poziomym przewijaniem kontenera. Na dotyku cele mają 44 px (`button.tsx:20-26`).
- Edytor jako osobna trasa (np. `/admin/journeys/$id`) dopisana do `isCompactSidebarRoute` (`src/lib/admin/adminNav.ts:496-498`). Daje to zwinięty sidebar i padding `p-2` (`adminShellGeometry.ts:150-170`). Szkielet SSR liczy z tej samej formuły, więc nie ma rozjazdu.
- Nagłówek trasy: `adminPageHead(...)` (AGENTS.md; `src/lib/adminPageHead.ts`). `validateSearch` musi być lekkie, bez importu warstwy danych (`admin.workflows.tsx:50-58`).

### Do reużycia

- **SeatMapCanvas (wzorzec kanwy SVG + a11y)** (`src/components/admin/events/molecules/SeatMapCanvas.tsx`): Skopiować wzorce zamiast komponentu: jeden useDroppable na całą kanwę (:8-11,124), roving tabindex z focusId i querySelector po data-id (:166-201), role=group + aria-describedby z instrukcją sr-only (:214-226), klasy tokenów na SVG (fill-muted/stroke-border), alternatywny widok tabeli obok kanwy.
- **seatingGeometry: boundsOf/planViewBox/nextSeatId/orderSeats** (`src/lib/events/seatingGeometry.ts`): Wzór czystego modułu geometrii z testami (src/lib/events/**tests**/seatingGeometry.test.ts): napisać analogiczny layoutJourney() i nextNodeId(layout,id,key) z typem kluczy nawigacji (SEAT_NAV_KEYS :252-265).
- **SeatGlyph (atom z roving tabindex)** (`src/components/admin/events/atoms/SeatGlyph.tsx`): Wzór węzła: role=button, tabIndex 0/-1, aria-label, aria-pressed, onKeyDown/onFocus delegowane do rodzica, pierścień fokusu group-focus-visible (:60-79).
- **BlockListView (role=tree/treeitem)** (`src/components/admin/blocks/molecules/BlockListView.tsx`): Wzorzec ARIA dla widoku 'Lista'/konspektu ścieżki i dla treeitem na kanwie: ul role=tree aria-label, li role=treeitem aria-level aria-selected, wcięcie depth*14 (:116-165).
- **useHistory (undo/redo z etykietami)** (`src/hooks/useHistory.ts`): Stan dokumentu ścieżki: set(next,{label,coalesceKey}), undo/redo, canUndo/canRedo, lastLabel do toastów 'Cofnięto: X'; reset() przy wczytaniu innej ścieżki.
- **useUnsavedChangesGuard** (`src/hooks/useUnsavedChangesGuard.ts`): useUnsavedChangesGuard(isDirty) w edytorze ścieżki - blokuje nawigację w aplikacji (dialog) i zamknięcie karty.
- **useAutosave** (`src/hooks/useAutosave.ts`): Opcjonalny autozapis szkicu ścieżki (serializowane zapisy, flush() odrzuca przy błędzie, resetKey = id ścieżki).
- **useContainerWidth** (`src/hooks/useContainerWidth.ts`): Szerokość viewportu kanwy (ResizeObserver, debounce 160 ms) do 'dopasuj do szerokości' = min(1, width / layout.width).
- **usePrefersReducedMotion** (`src/hooks/usePrefersReducedMotion.ts`): Wyłączenie płynnego zoomu/przewijania do węzła i animacji wstawienia; w klasach motion-safe:/motion-reduce:.
- **Sheet (panel edycji kroku)** (`src/components/ui/sheet.tsx`): <Sheet open onOpenChange><SheetContent side='right' className='sm:max-w-md'>; brak SheetFooter/Trigger/Close - stopkę zbudować w treści; fokus wraca do węzła przez useReturnFocus.
- **Popover + PopoverAnchor (picker typu kroku pod '+')** (`src/components/ui/popover.tsx`): PopoverAnchor przy przycisku '+' na krawędzi, PopoverContent z grupami typów kroków (Czekaj, E-mail, Split A/B, If/then, CRM, Lista, Wyjście) jako lista przycisków.
- **CommandDialog (szybkie dodawanie z wyszukiwarką)** (`src/components/ui/command.tsx`): CommandDialog label=... + CommandInput/List/Group/Item; uwaga: Command nie jest eksportowany (:130-138), do osadzenia w Popoverze trzeba dopisać eksport.
- **Tooltip (samonaprawiający się Provider)** (`src/components/ui/tooltip.tsx`): Podpisy przycisków ikonowych kanwy (zoom, +, usuń); nie wymaga TooltipProvider powyżej.
- **HoverCard** (`src/components/ui/hover-card.tsx`): Podgląd statystyk/treści maila po najechaniu na węzeł - tylko jako uzupełnienie (treść musi być też na karcie lub w Sheet).
- **ConfirmDialog** (`src/components/admin/ConfirmDialog.tsx`): Potwierdzenie usunięcia kroku/gałęzi: state {title, description, destructive, onConfirm}.
- **SegmentedControl** (`src/components/atoms/SegmentedControl.tsx`): Przełącznik widoku 'Kanwa | Lista' i ewentualnie trybu 'Edycja | Statystyki' (radiogroup, aria-checked).
- **AdminMetricTile** (`src/components/admin/molecules/AdminMetricTile.tsx`): KPI ścieżki nad kanwą (wpisani, aktywni, cele osiągnięte, wypisani) z tonami neutral/ok/warn/danger.
- **Atomy modułu Automatyzacje (RunStatusBadge, EventTypeChip, TONE_CLASS)** (`src/components/admin/workflows/atoms.tsx`): Paleta tonów statusu (:14-19) i chip typu zdarzenia dla węzła wyzwalacza; RunStatusBadge dla statusu przebiegu/zapisu.
- **Generowany formularz parametrów (WORKFLOW_ACTION_PARAMS + StepEditor)** (`src/components/admin/workflows/WorkflowEditorDialog.tsx`): Rozszerzyć spec parametrów o nowe typy kroków (delay, email, split, condition, lifecycle, list) i renderować pola w Sheet tak jak StepEditor (:297-400); katalog akcji w src/lib/admin/workflows.ts:27-104.
- **StatusBadge (tony statusów treści)** (`src/components/admin/atoms/StatusBadge.tsx`): Ton 'draft/scheduled/published/archived' dla statusu ścieżki (szkic/aktywna/wstrzymana/archiwum) - te same klasy emerald/brand/sky/violet.
- **Button (rozmiary z pointer-coarse 44px)** (`src/components/ui/button.tsx`): size='icon' dla '+', zoom, usuń - na dotyku automatycznie min 44px.
- **axeViolations (test a11y)** (`src/test/axe.ts`): expect(await axeViolations(container)).toEqual([]) w testach JourneyCanvas/JourneyOutline.
- **Sparkline** (`src/components/charts/Sparkline.tsx`): Opcjonalny mini-trend wpisów na węźle wyzwalacza / karcie e-maila (values, height).
- **adminPageHead** (`src/lib/adminPageHead.ts`): head: () => adminPageHead('Ścieżki', '...') na nowej trasie edytora (reguła AGENTS.md).
- **isCompactSidebarRoute** (`src/lib/admin/adminNav.ts`): Dopisać wzorzec trasy edytora ścieżki (:496-498), by dostać zwinięty sidebar i padding p-2 (pełna szerokość kanwy) spójnie z SSR-owym szkieletem.
- **AgendaStructureDiagram (legenda <dl>)** (`src/components/admin/events/molecules/AgendaStructureDiagram.tsx`): Wzór legendy typów kroków nad kanwą (DiagramLegend :148-173) i stanu pustego.
- **Animacja .pc-rise-y / tw-animate-css** (`src/styles.css`): Wejście nowo wstawionego węzła bez biblioteki (:1928-1942), wygasa przy prefers-reduced-motion; animate-in/fade-in dla popoverów.
- **Ikony już w grafie (lucide-react)** (`src/lib/lucide-shim.tsx`): Mail/MailOpen/MailCheck (e-mail, otwarcie), MousePointerClick (klik), Timer/Clock3/CalendarClock (czekaj), GitBranch (if/then), FlaskConical (split A/B, jest w shimie :250), UserCheck/Target (cel/lifecycle), ListChecks (zadanie CRM), UserPlus/UserMinus (lista), LogOut/DoorOpen/Flag (wyjście), Zap/Workflow/Route (wyzwalacz), ZoomIn/ZoomOut/Maximize2 (zoom) - bez kosztu dla vendor-lucide.

### Ograniczenia i bramki

- Zero nowych ciężkich zależności (xyflow/reactflow/dagre/elkjs/d3/framer-motion): OVERALL ma ~1,2 KB zapasu (4877,8/4879 KB gz), CSS ~1,7 KB (98,3/100), PUBLIC ~1,9 KB (2879,1/2881) - scripts/check-bundle-size.ts:2201-2202,2254,2329,2384,2499; framer-motion świadomie usunięty (:2511-2526).
- Każdy wzrost OVERALL/CSS wymaga zmierzonego pełnym buildem wpisu do kroniki w scripts/check-bundle-size.ts i podniesienia FROZEN_BUDGET_KB w tym samym commicie; zmienne MAX_* są w CI ignorowane (:1150-1160, :2569-2595).
- Cały kod kanwy w src/components/admin/**, src/lib/admin/** lub src/routes/admin* - tylko wtedy klasy Tailwinda trafiają do admin-styles.css (scripts/lib/adminCssPlugin.ts:5-36, src/styles.css:2-5), a chunki są admin-only z grafu (check-bundle-size.ts:2689-2763).
- Nie tworzyć nazwanej grupy chunków (codeSplitting) dla kodu kanwy - przyciąga współdzielone moduły na trasy publiczne (check-bundle-size.ts:2700-2706); graf chunków musi pozostać acykliczny (scripts/check-chunk-graph.ts).
- Słownik i18n kanwy importować/wywoływać w komponencie, nie w powłoce trasy (eager graf; src/routes/admin.workflows.tsx:8-11, scripts/check-entry-purity.ts HEAVY_DICTIONARIES :100-140); eksportować obiekty pl/en pod test parytetu.
- validateSearch nowej trasy bez importu warstwy danych (lokalna walidacja uuid jak src/routes/admin.workflows.tsx:50-58).
- Nowa trasa panelu musi mieć head: adminPageHead(sekcja, opis) (AGENTS.md; src/lib/adminPageHead.ts:2-14).
- Nowe ikony importować z lucide-react tylko gdy brak ich w shimie, ale każda NOWA ikona ląduje w współdzielonym vendor-lucide (budżet PUBLIC) - preferować ikony już obecne w grafie (scripts/lib/clientChunkGroups.ts:268-284).
- Karty węzłów NIE mogą mieć jednocześnie klas 'rounded-lg' i 'border' - .admin-compact wymusza im padding 0.75rem (src/admin-styles.css:381-383); używać rounded-[6px]. Wysokości węzłów liczyć pod wymuszone rozmiary .text-xs=11px/.text-sm=12px/button 12.5px (src/admin-styles.css:306-380).
- Kolory wyłącznie z tokenów (bg-card, border-border, text-muted-foreground, stroke-border, brand/brand-ink, destructive, emerald-*/dark:) z wariantem dark: - tryb ciemny przez .dark na <html> (src/styles.css:278); axe w testach ma wyłączony color-contrast (src/test/axe.ts:11-14), więc kontrast pilnują tylko tokeny.
- Kanwa nie może być jedyną drogą do kroku: obowiązkowy widok 'Lista' (konspekt, role=tree) jak tabela przy planie sali (SeatMapCanvas.tsx:15-17); HoverCard tylko jako uzupełnienie.
- Klawiatura: jeden tab stop na kanwie (roving tabindex), strzałki/Home/End/Enter/Delete, instrukcje sr-only przez aria-describedby, aria-level/setsize/posinset; komunikaty aria-live po wstawieniu/usunięciu.
- Przewijanie poziome tylko w lokalnym kontenerze overflow-auto (korzeń ma overflow-x: clip i touch-action: pan-y pinch-zoom - src/styles.css:282-300); ScrollArea nie ma poziomego paska (src/components/ui/scroll-area.tsx:24-33); przeciąganie tła z touch-none tylko na tle kanwy.
- Układ liczony czystą funkcją ze stałymi wymiarami węzłów (bez pomiaru DOM) i pokryty testami vitest - happy-dom nie ma layoutu (src/test/axe.ts:4-8).
- Respektować prefers-reduced-motion (motion-safe:/usePrefersReducedMotion) dla zoomu, przewijania do węzła i animacji wstawienia.
- Rozszerzać moduł Automatyzacje (WORKFLOW_ACTIONS/WORKFLOW_ACTION_PARAMS jako kontrakt z SQL run_workflow_step - src/lib/admin/workflows.ts:12-36) zamiast budować równoległy edytor; katalog typów kroków kanwy musi mieć test parytetu z SQL.

### Braki

- Brak jakiejkolwiek biblioteki grafu/układu (xyflow, reactflow, dagre, elkjs, d3) i brak własnego algorytmu układu drzewa (grep reingold/treeLayout/dagre/elk = 0) - trzeba napisać layoutJourney() od zera.
- Brak pomocnika pan/zoom kanwy; cropGeometry (src/lib/media/cropGeometry.ts:68-91) ma ZOOM_MIN=1 i dotyczy kadrowania - nie nadaje się.
- Brak komponentu/rysowania krawędzi grafu (łamane z etykietami, przycisk '+' na krawędzi).
- Model kroków workflow jest płaską listą {action, params} - brak gałęzi, opóźnień, split A/B, warunków per krok i wyjść (src/lib/admin/workflows.ts:106-120); edytor to Dialog ze strzałkami góra/dół (WorkflowEditorDialog.tsx:248-355).
- ui/command.tsx nie eksportuje komponentu Command (:130-138) - cmdk w Popoverze wymaga dopisania eksportu.
- ui/sheet.tsx nie ma SheetFooter/SheetTrigger/SheetClose (:107), a domyślna szerokość prawego arkusza to sm:max-w-sm (:37).
- ui/scroll-area.tsx nie obsługuje poziomego przewijania (:24-33).
- Brak trasy/nawigacji dla ścieżek (journeys) i brak wpisu w isCompactSidebarRoute (src/lib/admin/adminNav.ts:496-498).
- Trasa /admin/workflows nie używa adminPageHead (src/routes/admin.workflows.tsx:60-62) - niezgodność z regułą AGENTS.md.
- Brak e2e/axe dla tras panelu (katalog e2e nie zawiera specyfikacji admin) - a11y kanwy trzeba pokryć testami komponentów (src/test/axe.ts).
- docs/ARCHITECTURE.md:244-265 podaje nieaktualne budżety (1000/1300 KB) - źródłem prawdy jest FROZEN_BUDGET_KB w scripts/check-bundle-size.ts.
- Brak brakujących ikon dla A/B i klepsydry w grafie (Split, Shuffle, GitFork, Hourglass nie są nigdzie używane) - użyć FlaskConical/Timer lub zaakceptować koszt PUBLIC.

## 7. System wykresów

#### System wykresów: rozpoznanie pod moduł „Przychód i lejek”

Rozpoznanie było tylko do odczytu, żadnego pliku nie zmieniłem.

##### 1. Architektura i zasady ogólne

- Silnik jest własny i rysuje SVG renderowane po stronie serwera (SSR). ECharts usunięto, a w `package.json` nie ma żadnej biblioteki wykresów (`vite.config.ts:235`, `docs/SYSTEM_WYKRESOW_2026-10.md:5-18`). Kolory biorą się wyłącznie z tokenów `var(--chart-*)`, dostępnych przez `ROLE` w `src/lib/charts/roles.ts:28-63`; motyw przełącza się bez renderu Reacta (doc:16).
- Jedno wejście dla wszystkich rodzajów: `<Chart config lang className? onSelect? ariaLabel? footnoteNumbers? variant?: "panel"|"embedded">` (`src/components/charts/Chart.tsx:142-183`). Rozdzielniki są wyczerpujące: `DRAWING_BY_KIND` (`Chart.tsx:559`) i `TABLE_BY_KIND` (`Chart.tsx:584`), więc każdy rodzaj ma swoją tabelę danych jako alternatywę tekstową.
- `ChartConfig` jest zdefiniowany w `src/lib/charts/types.ts:156-301`. Pola: kind, categories, series[{name, values (number|null)[], colorSlot}], unit, height, stacked, showLegend/Grid/Values, smoothing, forecastFrom/forecastBandPct, sampleSize, sourceDate, notesShows/Surprising/Hidden, **metric**, palette (focus/categorical), accentSeries, band, target, direction, provenance, demo, sources, caption.
- Rodzaje są zdefiniowane w `CHART_KINDS` (`types.ts:27-92`): line, area, bar, bar-horizontal, pie, donut, **waterfall**, histogram, boxplot, beeswarm, scatter, **heatmap**, tornado, fan, index-base, percent-stacked, small-multiples. Możliwości każdego rodzaju (pasmo, cel, legenda, fakty w tooltipie, rodzina) opisuje `KIND_CAPS` (`src/lib/charts/kindCaps.ts:66-103`).
- Konfigurację buduje się w kodzie wyłącznie przez `defaultChartConfig()` (`src/lib/charts/parse.ts:286`), nigdy literałem (uzasadnienie: `src/components/admin/analytics/biChart.ts:14-17`).

##### 2. Standard w panelu admina: `biChart` + `ChartCard`

- `biChart(input: BiChartInput): ChartConfig` (`src/components/admin/analytics/biChart.ts:23-96`). Przyjmuje kind, categories, series (colorSlot domyślnie z `slotForSeries`, `src/lib/charts/palette.ts:1078`), unit, sampleSize, showLegend, showValues, showGrid, stacked, smoothing, forecastFrom, source i height. Tytuł i opis są puste, a `animate: false` (linie 73-76 i 91-94).
- `ChartCard` (`src/components/admin/analytics/ChartCard.tsx:39-62`) przyjmuje props: `title, subtitle?, badge?, config, height=300, csv?{filename,headers,rows}, pngName?, className?, footer?, onDataClick?(ChartSelection)=>ChartDrillDetail|null`.
  - Rysuje `<Chart variant="embedded" ariaLabel={…chartRegion}>` (`ChartCard.tsx:209-221`).
  - Ma eksport PNG, SVG i CSV oraz pełny ekran.
  - Wysokość nadpisuje przez konfigurację (`ChartCard.tsx:95-98`).
  - Drill-down przechodzi przez `ChartDrillDialog` (`src/components/admin/analytics/ChartDrillDialog.tsx`); kształt wskazania to `ChartSelection` (`src/lib/charts/selection.ts:15-41`).
- Przykłady użycia w adminie:
  - lejek CRM: `src/components/admin/dashboard/CrmPanel.tsx:59-70,135-145`;
  - pole subskrypcji: `MarketingPanel.tsx:108-124`;
  - wydarzenia: `src/components/admin/events/organisms/SponsorReportPanel.tsx:333` z konfiguracją `sponsorReportChartConfig` (`src/lib/events/sponsorReportModel.ts:232-253`);
  - GA4, GSC, Vitals, RelatedPosts, ClientErrors i AudienceSegments w `src/components/admin/analytics/*`;
  - goły `<Chart>`: `src/routes/admin.coupons.analytics.tsx:197`, `src/routes/admin.audience.tsx:285`, `SystemEmailsPanel.tsx:196`, `DeliverabilityPanel.tsx:220`.
- Kluby: `src/components/clubs/organisms/ClubInsights.tsx` ma własny helper `konfiguracja()` (linia 103), czyli kopię `biChart`, i własny `ChartPanel` z `<Chart ariaLabel>` (linia 158). Celowo nie używa `ChartCard`, bo ten importuje słownik `i18n-admin-analytics` do chunka trasy produktowej (linie 9-14). Dane bierze z `useClubActivitySeries` i `useClubWorkspaceStats` (linie 187-188).

##### 3. Jak wyrenderować poszczególne wykresy

- **Liniowy i słupkowy**: `biChart({kind:"line"|"area"|"bar"|"bar-horizontal", categories, series, unit, sampleSize})` w `ChartCard`.
  - Słupki poziome rysują się od góry w kolejności tablicy (`ClubInsights.tsx:215-218`).
  - Prognozę ustawia `forecastFrom` + `forecastBandPct` (pasmo: `CartesianChart.tsx:1287`). Brak pasma wykrywa `isForecastMissingBand` (`src/lib/charts/honesty.ts:60`).
- **Lejek: osobnego typu NIE MA.** Dokument wymienia „lejek” i „kohorty” w sekcji „Czego jeszcze nie ma” (`docs/SYSTEM_WYKRESOW_2026-10.md:124`).
  - Wzorzec w repo to `bar-horizontal` w kolejności etapów z `LEAD_STAGE_ORDER`, bez sortowania po wielkości (`CrmPanel.tsx:29-42`). Komentarz w `roles.ts:37` mówi, że kroki lejka rysuje się `ROLE.sMain`.
  - Tooltip pokazuje „Zmianę” względem poprzedniej kategorii tylko przy `direction !== null` albo na linii (`CartesianChart.tsx:771-780`). Z `direction:"higher"` daje to spadek między etapami, ale nie konwersję etap→etap.
- **Kaskada (most MRR): `kind:"waterfall"`.**
  - Model `waterfallModel(labels, values, {explicitEnd})` (`src/lib/charts/waterfall.ts:80-178`). Czyta tylko pierwszą serię: pierwsza kategoria to stan początkowy, ostatnia to stan końcowy, środek to składniki. Przykład: [MRR start, Nowe, Ekspansja, Kontrakcja(-), Churn(-), Reaktywacja, MRR koniec].
  - Suma kontrolna działa z tolerancją 0,5% zmiany (`CHECKSUM_TOLERANCE_RATIO`, linia 73). `checksumOk === false` dokłada w tabeli zdanie `waterfall.checksumFailed` (`Chart.tsx:1270-1277`).
  - Kolory kodują znak: `waterfallFill` (`CartesianChart.tsx:1621-1626`). Legenda „Poziom/Wzrost/Spadek/Bez zmiany” powstaje w `Chart.tsx:228-276`, etykiety mają znak „+”.
  - Paleta nie dotyczy tego rodzaju (`kindCaps.ts:74-82`).
- **Heatmapa kohort: `kind:"heatmap"`.**
  - Wiersze to `series[].name`, kolumny to `categories`, a komórka to `series[r].values[c]` (`src/lib/charts/kinds/heatmap.ts:874-886`). Luka to `null`, nie 0. Minimum 2x2 (linie 93-94), rada przy ponad 600 komórkach (linia 112), liczby w komórkach do 144 komórek (linia 135).
  - Skala sekwencyjna albo rozbieżna jest dobierana automatycznie. `onSelect` oddaje komórkę, czyli kategorię i serię (`HeatmapChart.tsx:404-428`).
  - Rodzina to „sensitivity”, więc teksty „Jak czytać” i zdanie o dominującej osi są pisane pod wrażliwość, nie pod kohorty (`readHelp.ts:254-259`).
- **Sparkline w KPI**:
  - `KpiTile` (`src/components/admin/analytics/KpiTile.tsx:29-58`) przyjmuje `label:string, value, current?, previous?, series?, higherIsBetter, icon?, deltaSuffix?, absoluteDelta?, band?, showScale?, unit?, lang?, bandSource?`. Iskrę dokłada przy `series.length>=2`.
  - Pod spodem: `Sparkline({values, band?, height=40})` (`src/components/charts/Sparkline.tsx:17-27`; ma `aria-hidden`) i `RangeScale` (`RangeScale.tsx`).
  - Przykłady: `GscBiDashboard.tsx:830-860`, `VitalsBiDashboard.tsx:552-570`.
  - Alternatywa bez iskry: `StatTile` z `delta` z `computeDelta` i `formatMoneyCents` (`src/components/admin/dashboard/StatTile.tsx:24-36`, `src/lib/admin/dashboard/compare.ts:55,113`).
- **Tooltip z objaśnieniem metryki**: wpisz `config.metric: ChartMetric {name, expansion, formula, measures, reading, levers, caution}` (`types.ts:319-332`).
  - `ChartFrame` rysuje wtedy `<MetricTooltip metric lang>` w nagłówku, także w wariancie embedded, bo `metric` włącza `showHead` (`ChartFrame.tsx:292-294,508-511`).
  - Komponent jest dostępny samodzielnie: `MetricTooltip({metric, lang})` (`src/components/charts/MetricTooltip.tsx:41-51`). Otwiera się na hover, focus i klik, zamyka Escape, renderuje się w portalu do `<body>` z `role="tooltip"`. Klucze słownika: `charts.metric.*` (`src/lib/i18n-charts.ts:953`).
  - Tooltip danych to osobny komponent `ChartTooltip` (`ChartTooltip.tsx:72-97`), który dostaje wiersze oceny z `valueFacts`/`sourceLine` (`src/components/charts/chartFacts.ts:345-396`).

##### 4. Dostępność

- `figure` z `aria-labelledby`. Rysunek ma `role="img"`, `tabIndex=0`, `aria-label` i `aria-describedby` z podpowiedzią klawiaturową, a strzałki przechodzą po kategoriach (`CartesianChart.tsx:686-690,817-827`).
- Przy pustym tytule trzeba podać `ariaLabel`, inaczej każdy wykres nazywa się „Wykres” (`Chart.tsx:156-160`, `ChartCard.tsx:212-216`).
- Tabela danych jest zawsze dostępna przyciskiem „Pokaż dane” (`ChartFrame.tsx:612-621`).
- Akcent zawsze ma drugi nośnik: kształt punktu, kreskowanie, obrys (doc:36,77). Czwarta i dalsze serie są przerywane, a przy większej liczbie serii dochodzi kreskowanie (`slotsNeedingPattern`).
- Resize: 160 ms i próg 4 px (`src/hooks/useContainerWidth.ts:4-6`). `prefers-reduced-motion` obsługuje `charts.css:917`.
- Bramka axe: `Chart.a11y.test.tsx`, `chartCardA11y.test.tsx`.

##### 5. Uczciwość wykresu

Silnik sam wypisuje defekty pod rysunkiem:

- ucięta oś linii: `isZeroBaselineBroken` (`honesty.ts:30-52`, render `ChartFrame.tsx:586`);
- prognoza bez pasma (`honesty.ts:60`);
- suma kontrolna mostka i udziałów tarczy (`Chart.tsx:375-385`);
- rady formy: `pieFormAdvice` (`honesty.ts:113`) i `chartFormAdvice` (`src/lib/charts/formAdvice.ts:402`).

Pasmo optimum rysuje się tylko ze źródłem z `sources` albo z flagą `demo` (`effectiveBand`, `src/lib/charts/status.ts:43-52`); bez tego pojawia się komunikat „brak benchmarku”. Podpis zawiera `n`, datę danych i literę pochodzenia D/W/B/E (`sources.ts:16`). Tarcza mieści najwyżej 5 wycinków (`PIE_MAX_SLICES`, `types.ts:141`). Dwie osie Y są zakazane (`chartKinds.test.ts`).

##### 6. Ryzyka i luki istotne dla modułu

- **Błąd w moście:** dla kroku ujemnego „Poziom” w tooltipie (`CartesianChart.tsx:752`) i kolumna „Suma zmian” w tabeli (`Chart.tsx:1264`) pokazują `step.to = max(from, cursor)` (`waterfall.ts:131-132`). Wychodzi stan przed spadkiem, a nie po nim, więc przy churnie/kontrakcji w moście MRR tabela poda złą liczbę.
- `biChart` nie przyjmuje `metric/band/target/direction/sources/provenance/demo` (`biChart.ts:23-43`); trzeba je doklejać spreadem albo rozszerzyć helper.
- `KpiTile.label` jest typu `string`, więc nie ma miejsca na `MetricTooltip`. Deltę formatuje na sztywno w pl-PL i przy zerze odniesienia pisze „+∞” (`KpiTile.tsx:60-75`).
- Duplikaty kafelków:
  - lokalny `KpiTile` w `src/routes/admin.paywall.tsx:531`;
  - `src/components/admin/membership/atoms/KpiTile.tsx:14`;
  - lokalny `KpiTile` w `AdminBiStrip.tsx:53`;
  - obok tego `StatTile` i `AdminMetricTile` (`src/components/admin/molecules/AdminMetricTile.tsx:42`).
- Nowy rodzaj (np. funnel, cohort) wymaga wpisu w 5 miejscach: types, variants, KIND_OPTIONS, schemat buildera, i18n. Pilnuje tego bramka `src/lib/charts/__tests__/chartKinds.test.ts`.
- Wykres nie formatuje walut, a `unit` to sam napis z separatorem (`format.ts:54-75`). Kwoty trzeba podawać w jednostkach, nie w groszach, i rysować osobny wykres na każdą walutę (zob. waluta wiodąca w `MarketingPanel.tsx:73-90`).
- Klucz zapytań pulpitu musi zawierać tenanta: `dashboardQueryKey(tenantId, domain, range)` (`src/lib/admin/dashboard/queryKeys.ts:30-45`).

### Do reużycia

- **Chart** (`/home/user/neweustrategies-dc633fb5/src/components/charts/Chart.tsx`): <Chart config={ChartConfig} lang={chartLangFrom(i18n.language)} ariaLabel={tytuł} variant="embedded"|"panel" onSelect?> - jedyne wejście silnika (props :142-173). Rysuje rysunek + tabelę danych + legendę + podpis uczciwościowy dla każdego z 17 rodzajów.
- **ChartCard** (`/home/user/neweustrategies-dc633fb5/src/components/admin/analytics/ChartCard.tsx`): Karta BI admina (props :39-62): title, subtitle, badge, config, height, csv{filename,headers,rows}, pngName, footer, onDataClick(ChartSelection)=>ChartDrillDetail|null. Eksport PNG/SVG/CSV, pełny ekran, drill-down. Standard dla dashboardu Przychód i lejek.
- **biChart** (`/home/user/neweustrategies-dc633fb5/src/components/admin/analytics/biChart.ts`): biChart({kind, categories, series, unit, sampleSize, showLegend, showValues, stacked, smoothing, forecastFrom, source, height}) -> ChartConfig (animate:false, tytuł pusty). Pola metric/band/direction/sources dokleić spreadem: {...biChart(...), metric, direction}.
- **defaultChartConfig / parseChartConfig** (`/home/user/neweustrategies-dc633fb5/src/lib/charts/parse.ts`): defaultChartConfig() (:286) jako baza każdej konfiguracji w kodzie; parseChartConfig (:98) dla Json z CMS (limity MAX_CATEGORIES=60, MAX_SERIES=10).
- **waterfallModel (most MRR)** (`/home/user/neweustrategies-dc633fb5/src/lib/charts/waterfall.ts`): kind:"waterfall" w biChart; categories=[start, składniki..., koniec], jedna seria. Model (:80) liczy kroki, sumę kontrolną (checksumOk/checksumGap) - można go użyć w module do walidacji mostu MRR po stronie danych.
- **HeatmapChart + heatmapModelFromConfig (kohorty)** (`/home/user/neweustrategies-dc633fb5/src/lib/charts/kinds/heatmap.ts`): kind:"heatmap": series = kohorty (name = etykieta kohorty, values = retencja per okres, null dla przyszłych okresów), categories = M0..Mn. heatmapModelFromConfig (:874) i heatmapFormAdvice (:942) do walidacji; onSelect oddaje komórkę.
- **KpiTile (sparkline + delta + RangeScale)** (`/home/user/neweustrategies-dc633fb5/src/components/admin/analytics/KpiTile.tsx`): <KpiTile label value current previous series higherIsBetter band bandSource showScale unit lang/> (props :29-58) - kafelek KPI z iskrą (MRR, ARPU, churn z higherIsBetter=false).
- **Sparkline** (`/home/user/neweustrategies-dc633fb5/src/components/charts/Sparkline.tsx`): <Sparkline values band? height?/> (:17-27) - glif aria-hidden, liczba musi stać obok w kafelku.
- **StatTile + compare.ts** (`/home/user/neweustrategies-dc633fb5/src/components/admin/dashboard/StatTile.tsx`): <StatTile label value delta={computeDelta(cur, prev)} hint to/> (:24-36); kwoty przez formatMoneyCents(cents, currency, lang) z src/lib/admin/dashboard/compare.ts:113; poprawna obsługa zera odniesienia (bez +∞).
- **MetricTooltip + ChartMetric** (`/home/user/neweustrategies-dc633fb5/src/components/charts/MetricTooltip.tsx`): Albo config.metric = {name, expansion, formula, measures, reading, levers, caution} (types.ts:319-332) - rama sama rysuje dymek, także w ChartCard (embedded); albo samodzielnie <MetricTooltip metric lang/> obok nagłówka KPI/sekcji (hover+focus+klik, Escape, portal).
- **ChartSelection + ChartDrillDialog** (`/home/user/neweustrategies-dc633fb5/src/lib/charts/selection.ts`): ChartSelection {kind, categoryIndex, category, seriesIndex, seriesName, value} (:15-38) -> mapowanie w onDataClick na ChartDrillDetail (title, subtitle, metrics, links) z src/components/admin/analytics/ChartDrillDialog.tsx - drill z etapu lejka do listy leadów CRM / wydarzenia / klubu.
- **format.ts** (`/home/user/neweustrategies-dc633fb5/src/lib/charts/format.ts`): chartLangFrom (:15), formatChartValue(value, lang, unit z wiodącą spacją dla walut, np. " zł") (:54), formatSignedValue (:124), formatSignedPercent (:131), formatPercent (:93).
- **status.ts / sources.ts (pasmo, kierunek, źródła)** (`/home/user/neweustrategies-dc633fb5/src/lib/charts/status.ts`): ChartBand{min,max,sourceId,demo}, MetricDirection higher|lower|range, effectiveBand (:43), rangeStatus (:61), changeTone/changeToneColor (:146,:155); ChartSource w src/lib/charts/sources.ts:31-50 (benchmark churn/konwersji z przypisem).
- **LEAD_STAGE_ORDER (kolejność lejka)** (`/home/user/neweustrategies-dc633fb5/src/components/admin/dashboard/CrmPanel.tsx`): Wzorzec lejka: LEAD_STAGE_ORDER z @/lib/crm/leadListSpec + etapy nieznane na końcu (:33-42), biChart kind bar-horizontal, showValues, sampleSize (:59-70).
- **sponsorReportChartConfig (wydarzenia)** (`/home/user/neweustrategies-dc633fb5/src/lib/events/sponsorReportModel.ts`): Gotowa konfiguracja dziennych metryk sponsora (:232-253) używana w admin SponsorReportPanel.tsx:333 i publicznym SponsorReportPublicView - przychód ze sponsoringu wydarzeń można pokazać tym samym kształtem.
- **dashboardQueryKey** (`/home/user/neweustrategies-dc633fb5/src/lib/admin/dashboard/queryKeys.ts`): dashboardQueryKey(tenantId, domain, range, extra?) (:30-45) - te same klucze dla sekcji CRM/marketing (przychód) w module, żeby cache i invalidacja działały w obie strony; domena DashboardDomain (:20) do rozszerzenia o 'revenue' zamiast nowego stanu.
- **AdminMetricTile** (`/home/user/neweustrategies-dc633fb5/src/components/admin/molecules/AdminMetricTile.tsx`): Kafelek bez delty/iskry (icon, label, value, hint, tone) - używany w module wydarzeń (SponsorReportPanel); do stanów (np. liczba aktywnych ścieżek) gdzie delta nie ma sensu.

### Punkty integracji

- [hub->moduł] Wykresy dashboardu Przychód i lejek (trend MRR, przychód per produkt/kanał) przez biChart + ChartCard - bez nowej biblioteki i bez własnego kształtu option: src/components/admin/analytics/biChart.ts:68; src/components/admin/analytics/ChartCard.tsx:71
- [hub->moduł] Most MRR (start, nowe, ekspansja, kontrakcja, churn, reaktywacja, koniec) jako kind waterfall; suma kontrolna i legenda znaku z silnika: src/lib/charts/waterfall.ts:80; src/components/charts/CartesianChart.tsx:284-316; src/components/charts/Chart.tsx:228-276,1230-1280
- [obie] Mapa lejka: bar-horizontal w kolejności etapów CRM (LEAD_STAGE_ORDER = enum crm_stage), ten sam raport CrmReport.stages co pulpit - zmiana etapu w CRM od razu widoczna w lejku: src/components/admin/dashboard/CrmPanel.tsx:29-70; src/lib/admin/dashboard/types.ts (CrmReport)
- [hub->moduł] Retencja/winback: heatmapa kohort (wiersze = kohorty, kolumny = okresy, null = przyszłość) + drill komórki do listy członków: src/components/charts/HeatmapChart.tsx:404-460; src/lib/charts/kinds/heatmap.ts:874
- [hub->moduł] Kafelki KPI z iskrą (MRR, ARPU, konwersja paywalla, churn z higherIsBetter=false) i skalą przedziału z benchmarkiem ze źródłem: src/components/admin/analytics/KpiTile.tsx:77; src/components/charts/Sparkline.tsx:27; src/components/charts/RangeScale.tsx
- [hub->moduł] Objaśnienia metryk (MRR, NRR, churn, LTV/CAC) przez config.metric -> MetricTooltip w nagłówku ramy; teksty autorskie w języku modułu, nazwy pól ze słownika charts.metric.*: src/lib/charts/types.ts:319-332; src/components/charts/ChartFrame.tsx:292-294,508-511; src/lib/i18n-charts.ts:953
- [obie] Drill-down z wykresu do CRM/wydarzeń/klubów: onDataClick zamienia ChartSelection na ChartDrillDetail z linkami (np. /admin/crm z filtrem etapu): src/components/admin/analytics/ChartCard.tsx:61,112-119; src/lib/charts/selection.ts:15-41; src/components/admin/analytics/ChartDrillDialog.tsx
- [moduł->hub] WYDARZENIA: metryki sponsorów (wyświetlenia, kliknięcia, leady, spotkania) rysowane ChartCard z sponsorReportChartConfig - moduł przychodu może reużyć ten model/zapytania zamiast liczyć je drugi raz: src/components/admin/events/organisms/SponsorReportPanel.tsx:333; src/lib/events/sponsorReportModel.ts:232
- [moduł->hub] KLUBY: aktywność klubu z RPC (useClubActivitySeries, useClubWorkspaceStats) i wykresy przez <Chart>; sygnały zaangażowania klubu jako wejście retencji/winback - z tymi samymi hookami/kluczami zapytań: src/components/clubs/organisms/ClubInsights.tsx:103-160,187-249
- [obie] Pulpit admina: sekcje CRM/marketing (przychód w walucie wiodącej, lejek) liczone tymi samymi zapytaniami z kluczem dashboardQueryKey (z tenantem) - moduł powinien współdzielić klucze, nie duplikować stanu: src/lib/admin/dashboard/queryKeys.ts:30-45; src/components/admin/dashboard/AdminDashboard.tsx:44-49; src/components/admin/dashboard/MarketingPanel.tsx:73-90

### Ograniczenia i bramki

- Żadnej zewnętrznej biblioteki wykresów (ECharts usunięty; vite.config.ts:235, docs/SYSTEM_WYKRESOW_2026-10.md:5-18) - wszystko przez <Chart>/ChartCard/Sparkline.
- ChartConfig budować wyłącznie przez defaultChartConfig()/biChart(), nigdy literałem (biChart.ts:14-17, parse.ts:275-288).
- W ChartCard tytuł/opis configu puste, nazwa dostępna przez ariaLabel z tytułu karty (ChartCard.tsx:95-96,212-216); przy gołym <Chart> z pustym tytułem obowiązkowy ariaLabel (Chart.tsx:156-160).
- Panel admina nie animuje (animate:false; biChart.ts:91-94).
- Kolory tylko z tokenów/ROLE (roles.ts:28-63), bez hexów; mostek, heatmapa i tornado kodują kolorem znak/wartość - palette ich nie dotyczy (kindCaps.ts:74-97).
- Lejek w kolejności etapów, nie sortowany po wielkości; nieznane etapy na końcu (CrmPanel.tsx:29-42).
- Mostek: tylko pierwsza seria; pierwsza kategoria = stan początkowy, ostatnia = stan końcowy (waterfall.ts:19-22,80-85); składniki muszą domykać różnicę stanów w tolerancji 0,5% (waterfall.ts:73).
- Heatmapa: luka = null, nie 0; min 2x2; ≤600 komórek (rada), liczby w komórkach do 144 komórek (heatmap.ts:93-135); parser tnie do 10 serii i 60 kategorii (types.ts:114, parse.ts:35) - biChart parsera nie przechodzi.
- Pasmo optimum/benchmark rysowane i oceniane tylko ze źródłem z sources albo demo:true (status.ts:43-52); KpiTile tego nie wymusza - zawsze podawać bandSource.
- Tarcza max 5 wycinków (types.ts:141), dwie osie Y zakazane (chartKinds.test.ts) - porównanie kwot i liczebności przez index-base albo small-multiples.
- Jednostka to napis z separatorem (' zł' ze spacją, '%' bez) - formatChartValue nie zna walut (format.ts:54-75); kwoty w jednostkach, nie groszach; osobny wykres per waluta.
- Prognoza (forecastFrom) wymaga pasma forecastBandPct, inaczej rama zgłasza defekt (honesty.ts:60).
- Nowy rodzaj wykresu (np. funnel/cohort) = wpis w 5 powierzchniach (types.ts, variants.ts, DataVizBlocks KIND_OPTIONS, schemat buildera, i18n-admin-blocks) + bramka src/lib/charts/**tests**/chartKinds.test.ts + KIND_CAPS, DRAWING_BY_KIND, TABLE_BY_KIND, FORM_ADVICE, READ_HELP_KEYS (Record wyczerpujące).
- Teksty silnika przez useTranslation keyPrefix 'charts' (bramka chartDictionaryKeys.test.ts) - bez kluczy sklejanych template literalem.
- Klucze zapytań pulpitu muszą zawierać tenanta (queryKeys.ts:1-16).
- Komponenty trasy produktowej (kluby) nie importują ChartCard (ciągnie i18n-admin-analytics; ClubInsights.tsx:9-14).
- AGENTS.md: prywatne ekrany admina z sekcyjnym adminPageHead; wspólne atomy daty/selecta i tokeny rozmiarów.

### Braki

- Brak rodzaju 'funnel' (docs/SYSTEM_WYKRESOW_2026-10.md:124): brak konwersji etap->etap i etap->start, brak adnotacji odpływu; jedyne obejście to bar-horizontal z direction:'higher', gdzie tooltip pokazuje 'Zmianę' wobec poprzedniego etapu (CartesianChart.tsx:771-780).
- Brak rodzaju 'kohorty' (docs:124): heatmapa działa, ale rodzina 'sensitivity' daje teksty 'Jak czytać' i zdanie o dominującej osi pod analizę wrażliwości (readHelp.ts:254-259, heatmap.ts:982-1033), nie pod retencję; brak trójkąta kohort jako formy.
- Błąd mostka dla kroków ujemnych: 'Poziom' w tooltipie (CartesianChart.tsx:752) i 'Suma zmian' w tabeli (Chart.tsx:1264) pokazują step.to = max(from, cursor) (waterfall.ts:131-132), czyli poziom PRZED spadkiem; przy churnie/kontrakcji w moście MRR liczba jest błędna (powinno być direction==='down' ? from : to).
- biChart nie przyjmuje metric, band, target, direction, sources, provenance, demo, notes*, caption (biChart.ts:23-43) - brak ścieżki do tooltipu objaśniającego i benchmarku w kartach BI bez ręcznego spreadu.
- KpiTile.label jest stringiem (KpiTile.tsx:30) - brak slotu na MetricTooltip; delta formatowana na sztywno pl-PL i '+∞' przy zerze odniesienia (KpiTile.tsx:60-75), w odróżnieniu od StatTile/compare.ts.
- Duplikaty kafelków KPI: lokalny KpiTile w src/routes/admin.paywall.tsx:531, src/components/admin/membership/atoms/KpiTile.tsx:14, lokalny KpiTile w src/components/admin/analytics/AdminBiStrip.tsx:53 obok wspólnych KpiTile/StatTile/AdminMetricTile.
- Duplikat helpera konfiguracji: konfiguracja() w ClubInsights.tsx:103 i sponsorReportChartConfig (sponsorReportModel.ts:232) powtarzają biChart - brak wspólnego, wolnego od słownika admina buildera configu.
- Brak formatowania walut w silniku (unit to tylko napis) i brak wykresu wielowalutowego.
- Brak sankey/diagramu przepływu w silniku (docs:124,127) - wizualizacja ścieżek komunikacji (journeys) musi być osobnym komponentem, nie rodzajem wykresu.
- Sparkline ma aria-hidden i nie niesie liczby (Sparkline.tsx:74) - każda iskra wymaga liczby w kafelku obok.

## 8. BI i warstwa semantyczna

#### BI i warstwa semantyczna: rozpoznanie (tylko odczyt, żadnych zmian w plikach)

##### 1. Architektura warstwy semantycznej

Kontrakt kodu jest w `src/lib/analytics/semantic/` (barrel `index.ts:16-74`). Opis: `docs/WARSTWA_SEMANTYCZNA_ANALITYKI.md` (237 linii, przeczytany w całości).

- **`streams.ts`**: zamknięta unia `StreamId` = `ga4 | first_party | web_vitals | ad_events | newsletter | content_views` (`streams.ts:98-99`). Każdy wpis `STREAM_LIST` (`:195-325`) opisuje `consentGate`, `identityGrain`, `timeBasis`, `dedupe`, `latencyHours`, `caps` i `caveats`. **Nie ma strumienia płatności/subskrypcji, wydarzeń (`event_registrations`, `event_funnel_events`), klubów (`club_members`) ani CRM.**
- **`metrics.ts`**: `MetricId` ma 18 metryk (`:31-49`): sessions, visitors, page_views, content_views, engagement_rate, cta_clicks, internal_searches, lcp/inp/cls_p75, ad_impressions, ad_clicks, ad_ctr, email_opens, email_clicks, email_ctr, related_clicks, reads.
  - Typy pomocnicze: `MetricUnit = count|ratio|milliseconds|score` (`:51`), bez jednostki pieniężnej. `MetricAggregation = sum|distinct_count|ratio|percentile_75` (`:53`), bez agregacji „stan na chwilę” (MRR, aktywne subskrypcje).
  - Zasady: dokładnie jedno powiązanie `authoritative` (`authoritativeBinding` `:574`), `comparabilityOf` (`:601`), `assertSameStreamRatio` (`:616`).
- **`window.ts`**: `resolveWindow({presetId, nowMs, includeOpenDay})` (`:129`).
  - Presety: `24h|7d|14d|28d|30d|90d` (`:29`).
  - Okno to pełne dni UTC. Dzień bieżący jest domyślnie pominięty (`excludes_open_day`), a GA4 dostaje daty z tych samych instantów (`ga4RangeFromInstants` `:106`).
  - Pozostałe funkcje: `resolveCustomWindow` (`:177`), `previousWindow` (rozłączne, ta sama długość, `:220`), `windowsOverlap` (`:256`), `legacyRpcWindow` (`:270`). Kody zastrzeżeń okna: `WindowNote` (`:42-52`).
- **`reconcile.ts`**: `reconcileMetric`/`reconcileAll` (`:131`, `:279`) dają werdykty `aligned|expected_drift|single_source|incomparable|divergent|order_inverted|unavailable`. Próg `MIN_SAMPLE_FOR_JUDGEMENT = 50` (`:89`). `safeRatio` (`:302`) zwraca `null`, gdy licznik i mianownik są z różnych **strumieni**, oraz przy zerowym mianowniku.
- **`format.ts`**: `formatMetricValue(value, unit, lang)` (`:17`) formatuje według jednostki, a `null` zawsze pokazuje jako "-". Do tego `formatDeltaPct` i `chartLangOf`.
- **`snapshot.functions.ts`**: `getSemanticSnapshot` to `createServerFn` POST z middleware `requireSupabaseAuth` (`:341-343`).
  - Bramka: `requireAnalyticsAdmin`, czyli `has_role(uid,'admin')` (`gateway.server.ts:128-135`).
  - Odczyt: RPC `analytics_semantic_snapshot(p_since,p_until)` dwa razy (okno bieżące i poprzednie, `:359-374`) oraz GA4 `runGa4DataApiReport` dwa razy (`:391-417`).
  - Obliczenia: `buildObservations` (`:207-308`), `DELTA_METRICS` (7 metryk, `:311-319`), wskaźniki `ad_ctr`/`email_ctr` przez `safeRatio` (`:449-464`), zdrowie strumieni (`:486-496`).
- **SQL**: najnowsza definicja RPC jest w `supabase/migrations/20261003180000_analytics_events_signed_in_sessions.sql:291-410`.
  - Tenant pochodzi z `assert_admin_tenant()`. Górna granica jest **domknięta** (`<= v_until`). Uprawnienia: `REVOKE ... FROM PUBLIC, anon` i `GRANT ... TO authenticated, service_role`.
  - Test pgTAP: `supabase/tests/analytics_semantic_layer_test.sql`.

**Warstwa UI** (`src/components/admin/analytics/semantic/`):

- Atomy: `VerdictBadge`, `StreamChip` (generyczny, czyta wszystko z rejestru), `ChipButton`.
- Molekuły: `MetricDefinitionPopover({metricId})` (definicja, wzór i strażniki dowolnej `MetricId`), `WindowProvenance({window, previous})`, `ReconciliationRow`, `StreamHealthGrid`.
- Organizmy: `SemanticReconciliationPanel` (klucz `["semantic-snapshot", tenantId, presetId]`, staleTime 60 s, `:75-78`), `MetricDictionary` (renderowany z `METRICS`).
- Generator wniosków: `semanticInsights.ts` (`buildSemanticInsights`, wpisy do `InsightSection`).
- Gdzie to wisi: zakładka „Uzgodnienie” (`value="semantic"`) w `src/routes/admin.analytics.index.tsx:692,724-728`.

##### 2. Nowa metryka lub wymiar krok po kroku (pliki i testy)

1. **Strumień** (gdy źródło jest nowe, np. `payments`, `events`, `clubs`):
   - Rozszerz unię `StreamId` (`streams.ts:98`) i dodaj wpis w `STREAM_LIST` z co najmniej jednym zastrzeżeniem (`caveats`).
   - Gdy pojawiają się nowe kody bramki zgody, ziarna tożsamości lub deduplikacji (np. ziarno „konto/user_id”), dodaj klucze `adminAnalytics.semantic.consentGate|identityGrain|dedupe.*` w PL i EN w `src/lib/i18n-admin-semantic.ts` (sprawdza je `src/lib/__tests__/i18nSemanticAnalytics.test.ts:137-157`).
   - Zaktualizuj liczby wpisane na sztywno w testach: `registry.test.ts:23-26` („dokładnie sześć strumieni”) i `snapshot.functions.test.ts:1020` (`toHaveLength(6)`).
   - Zdrowie strumienia (`snapshot.functions.ts:486-496`): dziś każdy strumień poza GA4 zależy od jednego odczytu RPC (`firstPartyRead`), więc nowe źródło z osobnego RPC potrzebuje własnej gałęzi.
2. **Metryka**:
   - Dodaj id do unii `MetricId` (`metrics.ts:31`) i wpis w `METRIC_LIST`: dokładnie jedno powiązanie `authoritative`, `definitionPl`/`definitionEn` dłuższe niż 20 znaków, co najmniej jeden `guard`, `driftTolerance: 0` przy jednym powiązaniu (pilnuje tego `registry.test.ts:69-111`).
   - Nowa jednostka (np. `money`) wymaga: gałęzi w `format.ts:24-39`, klucza `adminAnalytics.semantic.dictionary.unit.<unit>` w PL i EN (test `i18nSemanticAnalytics.test.ts:171-182`) i rozszerzenia `MetricUnit`.
3. **Obserwacje**:
   - Nowe pole w RPC: dopisz je do `RawSnapshot`/`Raw*` (`snapshot.functions.ts:97-143`), do `StreamValues`/`valuesFor` (`:181-188`, `:419-429`) i do `buildObservations`.
   - Opcjonalnie: `DELTA_METRICS` i nowy wskaźnik w `ratios` (wyłącznie przez `safeRatio`).
   - Strona SQL: `CREATE OR REPLACE FUNCTION public.analytics_semantic_snapshot` w nowej migracji (literalna nazwa RPC i GRANT zgodnie z AGENTS) plus asercje w `supabase/tests/analytics_semantic_layer_test.sql`.
4. **Testy do zaktualizowania**:
   - Lista 16 `entries` w kolejności słownika (`snapshot.functions.test.ts:597-621`) oraz `toHaveLength(16)` (`:858`, `:914`).
   - Lista 7 delt (`:941-954`).
   - Inwariant bramki zgody (`:702-714`).
   - Testy UI liczą `METRICS.length`/`STREAMS.length` dynamicznie (`semanticOrganisms.test.tsx:292,303,720`), więc nie wymagają zmian.
5. **Dokumentacja**: tabela w §1 oraz §5 w `docs/WARSTWA_SEMANTYCZNA_ANALITYKI.md`.

##### 3. Skąd dane

- **GA4 Data API**: `src/lib/analytics/ga4.server.ts` (`runGa4DataApiReport:270`, `ga4TotalsMap`, cache wyłącznie tokenów `:99-187`). Property pochodzi z `site_settings.key='analytics'` (`readStoredAnalyticsSettings`).
- **GSC**: `queryGscAnalytics`/`listGscSites`, klucze w `src/lib/analytics/queryKeys.ts:103-151`. `GscBiDashboard` liczy okno własnym `days`, a nie kanonicznym resolwerem.
- **First-party**: `analytics_events`, allowlista typów `page_view|cta_click|view|search|interaction|impression` w `src/routes/api/public/track.ts:72-79`. Kliknięcia w cenniku idą jako `cta_click` z `event_name` `pricing_signup_click|pricing_contact_click|pricing_checkout_click` (`src/components/pricing/organisms/TierCard.tsx:181,199,219,251`). Nie ma zdarzenia „wyświetlenie paywalla”.
- **Pulpit /admin**: RPC `admin_dashboard_traffic|crm|marketing|audience|content|realtime` (`supabase/migrations/20260912110000_admin_dashboard_aggregates.sql`, wywołania w `src/lib/admin/dashboard/dashboard.functions.ts:112-190`). Bramka `admin_dashboard_tenant()` wpuszcza **admina lub redaktora** (`:89-101`). Okno jest półotwarte (`< p_until`).
- **Wydarzenia**: `admin_event_ads_funnel` (`supabase/migrations/20260927001100_event_ads_funnel_review_fixes.sql`). Kroki pochodzą z tabeli `event_funnel_events` (`visit/registration_start/checkout_start`, `visitor_key`, UTM, `gad_campaign_id`), a przychód z `payment_orders` i `event_package_orders`. Ingest: `src/routes/api/public/event-funnel.ts`.

##### 4. Filtr czasu: trzy niezależne modele

1. **`TimeRangeFilter`** (`src/components/admin/analytics/TimeRangeFilter.tsx`):
   - Presety `24h|7d|30d|90d` (bez 28d). `buildPresetRange` daje okno **kroczące** (`Date.now() - hours`, `:49-59`).
   - Zakres własny: `buildCustomRange` liczy granice od **lokalnej** północy przeglądarki (`:61-94`).
   - Używają go `VitalsBiDashboard:100`, `ClientErrorsDashboard:52`, `RelatedPostsAnalytics:116`.
2. **Kanoniczne okno semantyczne** (`resolveWindow`): używa go `Ga4BiDashboard:179-180`, `SemanticReconciliationPanel:83` i lejek wydarzeń `src/lib/events/adsFunnel.ts:318-325` (z `includeOpenDay: true` i otwartym końcem).
3. **Okresy kalendarzowe pulpitu** (`src/lib/admin/dashboard/period.ts`): `realtime|today|week|month|prev-month|quarter|half-year|year`. Liczone w strefie admina z `offsetMinutes`. Okres poprzedni dostaje **tyle samo upłyniętego czasu** co bieżący.

##### 5. Drill-down, eksport, porównanie okresów, cache

- **Drill-down**: `ChartCard({onDataClick})` zamienia `ChartSelection` na `ChartDrillDetail` (pola `{title, subtitle, date, url, description, metrics[], links[]}`, `ChartDrillDialog.tsx:278-289`). Okno przywraca fokus (`onCloseAutoFocus`). Dziś używają tego Vitals, GA4, GSC i Related.
- **Eksport**: menu w `ChartCard` daje PNG, SVG i CSV (`exportChart.ts`).
  - `exportPng` i `exportSvg` biorą węzeł SVG silnika i doklejają klucz odczytany z DOM-u.
  - `exportCsv`/`buildCsv` piszą RFC 4180 z BOM i neutralizują formuły (`neutralizeFormula:66`, CWE-1236). CSV istnieje tylko wtedy, gdy podano prop `csv`.
  - Wydarzenia mają osobny `src/lib/events/adsFunnelCsv.ts`.
- **Porównanie okresów**:
  - Semantycznie: `previousWindow` daje okno rozłączne, `deltaPct` zwraca `null` przy zerowej bazie (`snapshot.functions.ts:321-324`).
  - `KpiTile` liczy deltę sam (`formatDelta`, `KpiTile.tsx:60-75`) i przy bazie 0 pokazuje `+∞`. Różnica absolutna jest zaszyta na `pl-PL`. Rozbiega się to z `null` w warstwie semantycznej i w `pctDelta` (`InsightSection.tsx:384-387`).
  - Pulpit: `computeDelta` (`src/lib/admin/dashboard/compare.ts:55`).
- **Cache**: wyłącznie React Query po stronie klienta (staleTime 60 s w dashboardach BI, 120 s w `AdminBiStrip`, 30 s dla statusu). Pulpit: 30 min dla okna zamkniętego, 60 s dla otwartego (`useDashboardData.ts:69`). Serwer nie cache'uje raportów.
  - Klucze są niespójne: część stoi pod `["admin-analytics", tenantId, …]` (`analyticsStatusKey`, `analyticsBiStripKey`, `analyticsCouponsKey`, GSC), część pod gołymi prefiksami (`["vitals-bi",…]`, `["ga4-bi",…]`, `["semantic-snapshot",…]`, `["gsc-bi",…]`, `["admin","client-errors",…]`, `["footer-analytics",…]`, `["related-insights",…]`). Unieważnienie korzeniem `analyticsRootKey()` (`admin.settings.analytics.tsx:294`) tych drugich nie obejmuje.
  - Pulpit używa `["admin-dashboard", domain, tenantId, …]` (`src/lib/admin/dashboard/queryKeys.ts:30-45`), wydarzenia `["event-ads-funnel", eventId, …]` (`useEventAdsFunnel.ts:38-46`), kluby `clubKeys.stats(clubId)` (`src/lib/clubs/queryKeys.ts:66`).
  - Wzorzec dwukierunkowości: mutacja kuponu unieważnia analitykę kuponów (`invalidateCouponQueries`, `src/lib/admin/couponQueries.ts:38-48`).

##### 6. Metryki monetyzacji i lejka: co już jest

- **Warstwa semantyczna**: tylko newsletter (`email_opens`, `email_clicks`, `email_ctr`) i reklamy. **Zero pieniędzy.**
- **Pulpit, `admin_dashboard_marketing`**: subscribed, unsubscribed, sent, opens, clicks, popupViews, popupConversions, adImpressions, adClicks, `orders` oraz `revenue[]` rozbite po walucie z `payment_orders` (netto po zwrotach, `paid_at`, `:432-452`), `donations[]`, leadForms.
- **Pulpit, `admin_dashboard_audience`**: signups, memberships (`membership_grants`), registrations (`event_registrations`), totals.subscriptions (`user_subscriptions.status='active'`), totals.clubMembers (`club_members.status='active'`) (`:604-676`).
- **Pulpit, `admin_dashboard_crm`**: newLeads, won, lost, hot, consented, stages, sources.
- **Kupony**: `b2b_coupons_analytics` (redemptions, revenue_cents netto, discount_cents_total; `src/routes/admin.coupons.analytics.tsx:42-49`).
- **Wydarzenia, per wydarzenie**: lejek visits → registration_starts → checkout_starts → registrations → paid, revenue, cost, CPA i ROAS (`adsFunnel.ts:35-41,252-298`). Do tego `admin_event_registrations_counts`, `admin_event_onsite_stats` i `admin_event_meeting_stats` (`EventAnalyticsPanel.tsx`).
- **Kluby, per klub**: `admin_club_stats` (member_count, active_members_30d, pending_members, leads_count…; `src/lib/clubs/adminClubStatsView.ts:44-59`, `api.ts:369-373`). Dostęp do klubu jest gatowany warstwą członkostwa (`clubs.min_tier_rank`).
- **Billing**: `AdminBillingPanel` liczy active, dunning i canceling **po stronie klienta** z tabeli `subscriptions` z `.limit(500)` (`AdminBillingPanel.tsx:114-127,222-228`). Klucz `["admin","stripe-subscriptions"]` nie zawiera tenanta.
- **Retencja**: `retentionStats` (pokazane i przyjęte kontroferty, top powody, 90 dni; `RetentionStatsCards.tsx`).

##### 7. Najważniejsze ryzyka dla nowego modułu

- „Aktywne subskrypcje” mają dziś **dwie definicje**: `user_subscriptions.status='active'` na pulpicie oraz `subscriptions.status in (active, trialing)` w billingu.
- „Przychód” ma **dwie definicje**:
  - pulpit: tylko `payment_orders`, `paid_at IS NOT NULL`, netto;
  - lejek wydarzeń: `payment_orders` plus `event_package_orders`, `status in (paid, refunded)`.
    Warstwa semantyczna powinna je uzgodnić tak samo, jak uzgadnia „odsłony”.
- `TimeRangeFilter` liczy zakres własny od **lokalnej** północy, a `resolveCustomWindow` przycina do doby UTC. W Polsce (UTC+1/+2) przekazanie zakresu z `TimeRangeFilter` do `getSemanticSnapshot` przesuwa początek okna o dzień. To łamie regułę AGENTS o zachowaniu dat lokalnych.

### Do reużycia

- **Rejestr strumieni i metryk (STREAMS, METRICS, metricById, authoritativeBinding, comparabilityOf, assertSameStreamRatio)** (`/home/user/neweustrategies-dc633fb5/src/lib/analytics/semantic/metrics.ts`): Dopisać metryki przychodu i lejka (np. mrr, active_subscriptions, paid_orders, revenue_net, checkout_starts, event_registrations_paid, club_joins) jako wpisy METRIC_LIST z jednym powiązaniem authoritative. KPI modułu pokazują wtedy MetricDefinitionPopover i trafiają do MetricDictionary automatycznie.
- **Resolwer okna kanonicznego (resolveWindow, resolveCustomWindow, previousWindow, windowsOverlap)** (`/home/user/neweustrategies-dc633fb5/src/lib/analytics/semantic/window.ts`): Jedno okno i rozłączne okno poprzednie dla wszystkich kafli modułu. Wzorzec z includeOpenDay:true do podglądu kampanii jest w src/lib/events/adsFunnel.ts:318-325.
- **safeRatio / reconcileAll / needsAttention** (`/home/user/neweustrategies-dc633fb5/src/lib/analytics/semantic/reconcile.ts`): Konwersje lejka liczyć wyłącznie przez safeRatio (licznik i mianownik z jednego strumienia). Uzgadniać przychód z pulpitu, z lejka wydarzeń i z billingu przez reconcileAll.
- **getSemanticSnapshot + SemanticSnapshotResult/SemanticDelta** (`/home/user/neweustrategies-dc633fb5/src/lib/analytics/semantic/snapshot.functions.ts`): Rozszerzyć buildObservations, DELTA_METRICS i ratios o metryki monetyzacji albo zbudować analogiczny revenueSnapshot.functions.ts z tym samym kontraktem DTO (window, previous, entries, deltas, ratios, streams).
- **formatMetricValue / formatDeltaPct / chartLangOf** (`/home/user/neweustrategies-dc633fb5/src/lib/analytics/semantic/format.ts`): Formatowanie według jednostki ze słownika; brak wartości to "-", nigdy 0. Dla pieniędzy dodać unit 'money' albo użyć formatMoneyCents z src/lib/admin/dashboard/compare.ts:113.
- **MetricDefinitionPopover, WindowProvenance, ReconciliationRow, StreamHealthGrid, StreamChip, VerdictBadge, MetricDictionary** (`/home/user/neweustrategies-dc633fb5/src/components/admin/analytics/semantic`): Osadzać obok KPI przychodu i lejka. Wszystkie czytają rejestr, więc nowe metryki i strumienie pojawią się bez zmian w komponentach.
- **KpiTile (wartość, delta ▲▼■, sparkline, pasmo i RangeScale)** (`/home/user/neweustrategies-dc633fb5/src/components/admin/analytics/KpiTile.tsx`): Kafle MRR, konwersji i churnu z higherIsBetter=false dla churnu. Uwaga: formatDelta zwraca +∞ przy bazie 0 i ma zaszyte pl-PL, lepiej podawać deltę z warstwy semantycznej.
- **ChartCard + biChart** (`/home/user/neweustrategies-dc633fb5/src/components/admin/analytics/ChartCard.tsx`): Wykresy trendu MRR, przychodu i kohort: biChart({kind,categories,series,unit,sampleSize}) przekazane do ChartCard({config, csv, onDataClick}) daje pełny ekran, eksport PNG/SVG/CSV i drill. Rodzaje silnika: line, area, bar, bar-horizontal, pie, donut, waterfall (mostek MRR), histogram, boxplot, beeswarm, scatter, heatmap (kohorty), tornado, fan, index-base, percent-stacked, small-multiples. Nie ma rodzaju 'funnel'.
- **ChartDrillDialog / ChartDrillDetail** (`/home/user/neweustrategies-dc633fb5/src/components/admin/analytics/ChartDrillDialog.tsx`): Drill z punktu lejka lub kohorty do listy z linkami (links[] z href względnym zostaje w panelu, np. /admin/events/<id>/ads-funnel, /admin/community/clubs/<id>, /admin/crm/...).
- **exportCsv / buildCsv / exportPng / exportSvg** (`/home/user/neweustrategies-dc633fb5/src/components/admin/analytics/exportChart.ts`): Eksport raportów modułu; CSV z neutralizacją formuł (np. dla danych UTM z publicznych beaconów).
- **InsightSection + pctDelta/classifyDelta** (`/home/user/neweustrategies-dc633fb5/src/components/admin/analytics/InsightSection.tsx`): Sekcja „Interpretacja i rekomendacje” dla przychodu i lejka; generator wzorować na src/components/admin/analytics/semantic/semanticInsights.ts. Nad InsightSection (h3) dać nagłówek h2, jak w admin.analytics.index.tsx:579.
- **AdminBiStrip** (`/home/user/neweustrategies-dc633fb5/src/components/admin/analytics/AdminBiStrip.tsx`): Wzorzec kompaktowego paska do osadzenia poza /admin/analytics: trzy stany kafla (Pomiar, Awaria odczytu, liczba), bramka roli równa bramce serwera, early return po hookach. Można skopiować pod pasek przychodu na /admin oraz w studiu wydarzenia i panelu klubu.
- **TimeRangeFilter (buildPresetRange, TimeRangeValue)** (`/home/user/neweustrategies-dc633fb5/src/components/admin/analytics/TimeRangeFilter.tsx`): Kontrolka okna. Do warstwy semantycznej mapować presety na WindowPresetId; zakresu własnego nie przekazywać bez korekty strefy (lokalna północ zamieniana na ISO przesuwa dzień w resolveCustomWindow).
- **Fabryka kluczy analityki (analyticsRootKey, analyticsTenantKey, analyticsCouponsPrefixKey)** (`/home/user/neweustrategies-dc633fb5/src/lib/analytics/queryKeys.ts`): Klucze modułu jako [...analyticsTenantKey(tenantId), 'revenue', …]; mutacje w cenniku, kuponach, wydarzeniach i klubach unieważniają prefiks najemcy, jak invalidateCouponQueries (src/lib/admin/couponQueries.ts:38-48). Test kluczy: src/lib/analytics/**tests**/queryKeys.test.ts.
- _*Agregaty pulpitu (getDashboardMarketing/Audience/Crm, parse*, period.ts, compare.ts)_* (`/home/user/neweustrategies-dc633fb5/src/lib/admin/dashboard/dashboard.functions.ts`): Te same odczyty i ten sam klucz dashboardQueryKey(tenantId, domain, range) dla przychodu po walucie, zamówień, darowizn, rejestracji, subskrypcji i członków klubów. Nie dublować SQL; MoneyByCurrency[] jest gotowym kształtem pieniędzy wielowalutowych.
- **Lejek wydarzeń (adsFunnel.ts: stepRate, costPerAcquisition, returnOnAdSpend, adsFunnelWindow; useEventAdsFunnel adsFunnelKeys)** (`/home/user/neweustrategies-dc633fb5/src/lib/events/adsFunnel.ts`): Gotowy model lejka (visits, registration_starts, checkout_starts, registrations, paid) z przychodem i ROAS; stepRate zwraca null przy zerze. Molekuła AdsFunnelBars (src/components/admin/events/molecules/AdsFunnelBars.tsx) to dostępna lista kroków do reuse w mapie lejka.
- **admin_club_stats + adminClubStatsView** (`/home/user/neweustrategies-dc633fb5/src/lib/clubs/adminClubStatsView.ts`): Metryki klubu (członkowie, aktywni w 30 dniach, oczekujący, leady) pod kluczem clubKeys.stats(clubId) do kafli klubowych w module.
- **adminPageHead** (`/home/user/neweustrategies-dc633fb5/src/lib/adminPageHead.ts`): head nowej trasy /admin/... modułu (wymóg AGENTS). Istniejące trasy analityki mają ręczne meta i tego nie stosują.

### Punkty integracji

- [moduł->hub] Nowa zakładka lub trasa modułu w grupie nawigacji „Analityka” (widoczna tylko dla admina): /home/user/neweustrategies-dc633fb5/src/lib/admin/adminNav.ts:411-422 (grupa id 'analytics'); układ /home/user/neweustrategies-dc633fb5/src/routes/admin.analytics.tsx (Outlet)
- [moduł->hub] Panel modułu jako leniwy dashboard na /admin/analytics/bi lub jako zakładka w przeglądzie: /home/user/neweustrategies-dc633fb5/src/routes/admin.analytics.bi.tsx:28-62,135-165 (lazy + Suspense z rezerwą DASHBOARD_RESERVE_PX); /home/user/neweustrategies-dc633fb5/src/routes/admin.analytics.index.tsx:672-733 (Tabs; stan zakładki w lokalnym useState, nie w URL)
- [obie] Rejestracja metryk monetyzacji i lejka w słowniku kanonicznym oraz uzgadnianiu: /home/user/neweustrategies-dc633fb5/src/lib/analytics/semantic/metrics.ts:31-49,98-560; /home/user/neweustrategies-dc633fb5/src/lib/analytics/semantic/streams.ts:98-99,195-325; /home/user/neweustrategies-dc633fb5/src/lib/analytics/semantic/snapshot.functions.ts:97-143,207-319,449-496
- [hub->moduł] Rozszerzenie RPC migawki o pola płatności, wydarzeń i klubów (literalna nazwa i GRANT authenticated/service_role, tenant z assert_admin_tenant): /home/user/neweustrategies-dc633fb5/supabase/migrations/20261003180000_analytics_events_signed_in_sessions.sql:291-410; test /home/user/neweustrategies-dc633fb5/supabase/tests/analytics_semantic_layer_test.sql
- [hub->moduł] Przychód po walucie, zamówienia, darowizny, rejestracje, subskrypcje i członkowie klubów: ten sam odczyt i ten sam klucz co pulpit: /home/user/neweustrategies-dc633fb5/src/lib/admin/dashboard/dashboard.functions.ts:131-151; /home/user/neweustrategies-dc633fb5/src/components/admin/dashboard/useDashboardData.ts:91-109; /home/user/neweustrategies-dc633fb5/src/lib/admin/dashboard/queryKeys.ts:30-45; SQL /home/user/neweustrategies-dc633fb5/supabase/migrations/20260912110000_admin_dashboard_aggregates.sql:382-682
- [obie] Lejek WYDARZEŃ (wizyta, start zapisu, start płatności, rejestracja, opłacone) plus przychód, koszt i ROAS per wydarzenie; klucz adsFunnelKeys.event(eventId) do unieważniania przy zmianach z modułu: /home/user/neweustrategies-dc633fb5/src/lib/events/adsFunnel.ts:35-41,310-325; /home/user/neweustrategies-dc633fb5/src/lib/events/useEventAdsFunnel.ts:38-86; RPC admin_event_ads_funnel w /home/user/neweustrategies-dc633fb5/supabase/migrations/20260927001100_event_ads_funnel_review_fixes.sql (tabela event_funnel_events)
- [moduł->hub] Analityka pojedynczego wydarzenia (link do modułu globalnego już istnieje, do przepięcia na moduł przychodu): /home/user/neweustrategies-dc633fb5/src/components/admin/events/organisms/EventAnalyticsPanel.tsx:234 (Link to /admin/analytics); trasa /home/user/neweustrategies-dc633fb5/src/routes/admin.events_.$eventId.analytics.tsx
- [obie] Metryki KLUBÓW (członkowie, aktywni, oczekujący, leady) i bramka tieru klubu (clubs.min_tier_rank) jako krok lejka i benefit: /home/user/neweustrategies-dc633fb5/src/lib/clubs/api.ts:369-373 (admin_club_stats); /home/user/neweustrategies-dc633fb5/src/lib/clubs/queryKeys.ts:66 (clubKeys.stats); /home/user/neweustrategies-dc633fb5/src/lib/clubs/adminClubStatsView.ts:44-59; totals.clubMembers w admin_dashboard_audience (migracja 20260912110000:673)
- [obie] Dwukierunkowe unieważnianie cache po mutacjach (cennik, kupony, subskrypcje, wydarzenia, kluby) obejmujące klucze modułu: /home/user/neweustrategies-dc633fb5/src/lib/admin/couponQueries.ts:38-48 (wzorzec); /home/user/neweustrategies-dc633fb5/src/lib/analytics/queryKeys.ts:39-95
- [moduł->hub] Pasek sygnału przychodu na pulpicie /admin i w panelu społeczności (obok AdminBiStrip): /home/user/neweustrategies-dc633fb5/src/routes/admin.index.tsx:113; /home/user/neweustrategies-dc633fb5/src/routes/admin.community.index.tsx:113; /home/user/neweustrategies-dc633fb5/src/components/admin/dashboard/AdminDashboard.tsx:83
- [hub->moduł] Zdarzenia konwersji z cennika (cta_click: pricing_signup_click, pricing_contact_click, pricing_checkout_click) jako górne kroki lejka first-party: /home/user/neweustrategies-dc633fb5/src/components/pricing/organisms/TierCard.tsx:181,199,219,251; allowlista /home/user/neweustrategies-dc633fb5/src/routes/api/public/track.ts:72-94
- [moduł->hub] Interpretacje i rekomendacje modułu w tym samym prymitywie i formacie co reszta BI: /home/user/neweustrategies-dc633fb5/src/components/admin/analytics/InsightSection.tsx:269; wzorzec generatora /home/user/neweustrategies-dc633fb5/src/components/admin/analytics/semantic/semanticInsights.ts
- [moduł->hub] i18n modułu: własny bundle (jak i18n-admin-semantic) z addResourceBundle i parytetem PL/EN; dynamiczne kody pokryte testem: /home/user/neweustrategies-dc633fb5/src/lib/i18n-admin-semantic.ts:397-398; /home/user/neweustrategies-dc633fb5/src/lib/i18n-admin-analytics.ts:1739-1745; test /home/user/neweustrategies-dc633fb5/src/lib/**tests**/i18nSemanticAnalytics.test.ts

### Ograniczenia i bramki

- Jedna metryka ma dokładnie jedno powiązanie 'authoritative'; przy jednym strumieniu driftTolerance musi wynosić 0, a strumień musi mieć co najmniej jedno zastrzeżenie (caveats). Wymuszają to src/lib/analytics/semantic/registry.test.ts:69-111 i :28-39.
- safeRatio liczy wskaźnik tylko wtedy, gdy licznik i mianownik pochodzą z TEGO SAMEGO strumienia (reconcile.ts:302-326). Konwersja 'kliknięcie w cenniku (first_party, zgoda analityczna) -> opłacone zamówienie (zapis serwerowy)' jest więc niedozwolona: lejek musi liczyć kroki wewnątrz jednego strumienia (np. event_funnel_events albo nowy strumień serwerowy).
- Brak to null, nigdy 0 (format.ts:9-11, snapshot.functions.ts:145-153, adsFunnel.ts:10-13); delta przy bazie 0 to null (snapshot.functions.ts:321-324). KpiTile.formatDelta zwraca wtedy '+∞' (KpiTile.tsx:71), więc deltę trzeba podawać z warstwy semantycznej.
- Pieniądze zawsze rozbite po walucie (MoneyByCurrency[], migracja 20260912110000:435-452; ROAS i CPA tylko przy jednej walucie, adsFunnel.ts:257-277). ReconciliationEntry.canonicalValue to jedna liczba, więc metryka pieniężna wymaga wiązania per waluta albo waluty wiodącej.
- Klucz zapytania MUSI zawierać tenantId, a zapytanie stoi na enabled: Boolean(tenantId) (src/lib/analytics/queryKeys.ts:4-21; wszystkie dashboardy BI). Serwer bierze tenanta z profilu (assert_admin_tenant / admin_dashboard_tenant / has_role), nigdy z ładunku (AGENTS).
- RPC: literalne nazwy, REVOKE FROM PUBLIC, anon; GRANT authenticated, service_role; SECURITY DEFINER z search_path; bramka 'generate:ts-sql-contract' / 'check:ts-sql-contract' w package.json. Migracje z odczytem public.club_ muszą rozważyć znacznik 'pg-harness: exclude' (migracja 20260912110000:1-30).
- Bramki ról się różnią: getSemanticSnapshot wpuszcza tylko admina (gateway.server.ts:128-135, assert_admin_tenant), a admin_dashboard_* także redaktora (migracja 20260912110000:89-99). Moduł przychodu z danymi finansowymi powinien przyjąć jawną bramkę (sugerowana: admin) i pasek UI z tym samym warunkiem co serwer (AdminBiStrip.tsx:73-83).
- Granice okna: RPC semantyczne ma górną granicę domkniętą (<= v_until, okno kończy się o 23:59:59.999Z), agregaty pulpitu i lejek wydarzeń półotwartą (< p_until). Nie mieszać granic między źródłami bez konwersji.
- TimeRangeFilter.buildCustomRange liczy od lokalnej północy przeglądarki (TimeRangeFilter.tsx:68-93), a resolveCustomWindow przycina do dób UTC (window.ts:190-201). Dla PL zakres własny przesuwa się o dzień; AGENTS wymaga zachowania dat lokalnych. Presety TimeRangeFilter (24h/7d/30d/90d) są kroczące i nie odpowiadają WindowPresetId 1:1 (brak 28d i 14d).
- Testy z liczbami na sztywno do aktualizacji przy nowych strumieniach i metrykach: registry.test.ts:23-26 (6 strumieni), snapshot.functions.test.ts:597-621 (lista 16 entries), :858, :914 (16), :941-954 (7 delt), :1020 (6 dostępnych).
- Nowe kody w uniach (jednostka, bramka zgody, ziarno, dedupe, werdykt, nota okna) muszą mieć klucze PL i EN w src/lib/i18n-admin-semantic.ts; brak klucza nie psuje builda, tylko wyświetla surowy kod (test i18nSemanticAnalytics.test.ts).
- Trasy admina: head przez adminPageHead (AGENTS; admin.analytics.bi.tsx:64-74 i admin.analytics.index.tsx:85-96 mają ręczne meta, a admin.coupons.analytics.tsx nie ma head wcale). Typecheck przez tsgo --noEmit (AGENTS, package.json typecheck:tsc).
- Dashboardy BI renderują pod Suspense z rezerwą wysokości (CLS, admin.analytics.bi.tsx:78-106); InsightSection renderuje h3, więc trasa musi dać h2 (admin.analytics.index.tsx:571-581).
- Panel nie animuje wykresów (biChart.ts: animate:false), kolory serii idą przez slotForSeries, nie przez literały hex (admin.coupons.analytics.tsx:1-12).
- Eksport CSV musi przechodzić przez buildCsv/neutralizeFormula (dane UTM i kampanii pochodzą z publicznych beaconów).

### Braki

- Brak strumienia płatności i subskrypcji w warstwie semantycznej (payment_orders, subscriptions, user_subscriptions, membership_grants, donations, event_package_orders); STREAM_LIST zawiera tylko ruch, RUM, reklamy, newsletter i treści (streams.ts:98-99).
- Brak jakiejkolwiek metryki pieniężnej w METRICS: MRR, ARR, ARPU, przychód netto, LTV, wartość kuponów, przychód z wydarzeń i z klubów. Brak MetricUnit 'money' i agregacji typu 'stan na chwilę' (MRR, aktywne subskrypcje) (metrics.ts:51-53).
- Brak metryk retencji i churnu: churn rate, net revenue retention, retencja kohortowa, winback rate, trial do płatnego. Jedyna retencja to retentionStats kontrofert (RetentionStatsCards.tsx). CRM 'churned' jest tylko tagiem (purchaseEffects.server.ts:305-354), nie metryką.
- Brak zdarzenia 'wyświetlenie paywalla / cennika' w analytics_events: allowlista typów (track.ts:72-79) i jedynie cta_click z TierCard. Nie da się policzyć konwersji paywall -> checkout -> opłacone w jednym strumieniu.
- Brak globalnego (przekrojowego) lejka i przychodu WYDARZEŃ: admin_event_ads_funnel jest per wydarzenie (p_event_id); pulpit liczy tylko count(event_registrations) bez przychodu i płatności.
- Brak globalnej analityki KLUBÓW i ich wkładu w lejek: admin_club_stats jest per klub, pulpit ma tylko totals.clubMembers; brak metryk 'dołączenie do klubu', 'konwersja tieru przez bramkę klubu (min_tier_rank)', 'lead z klubu -> CRM won'.
- Rozbieżne definicje do uzgodnienia: 'aktywne subskrypcje' = user_subscriptions.status='active' (pulpit, migracja 20260912110000:671) vs subscriptions.status in (active, trialing) (AdminBillingPanel.tsx:224). 'Przychód' = payment_orders z paid_at, netto (pulpit) vs payment_orders + event_package_orders ze status in (paid, refunded) (lejek wydarzeń).
- AdminBillingPanel liczy KPI subskrypcji klientem z .limit(500) (AdminBillingPanel.tsx:122), co zaniża liczby powyżej 500. Klucz billingKeys.admin.stripeSubscriptions() nie zawiera tenanta (src/lib/billing/keys.ts:83).
- Tabela subscriptions nie ma kwoty; MRR wymaga mapowania price_id/plan_id na cennik (access_plans.price_cents, enum plan_interval month/year/quarter/two_weeks/one_time) z normalizacją do miesiąca. Tego mapowania dziś nie ma.
- Brak metryk silnika ścieżek i eksperymentów A/B w BI (src/lib/builder/experiments.ts i /api/public/experiment-event istnieją, ale nie ma ich w rejestrze ani na dashboardach).
- Niespójne klucze cache analityki: części dashboardów nie obejmuje analyticsRootKey (['vitals-bi'], ['ga4-bi'], ['semantic-snapshot'], ['gsc-bi'], ['admin','client-errors'], ['footer-analytics'], ['related-insights']); pulpit ma inny kształt (['admin-dashboard', domain, tenantId,…]). Brak wspólnej fabryki dla modułu przychodu.
- Trzy różne modele czasu (TimeRangeFilter kroczący, resolveWindow UTC-dni, period.ts kalendarz w strefie admina) bez adaptera między nimi; zakładki /admin/analytics trzymają stan w useState zamiast w zwalidowanym search URL (admin.analytics.index.tsx:662).
- Trzy różne kafle KPI (analytics/KpiTile.tsx, dashboard/StatTile.tsx, prywatny KpiTile w AdminBiStrip.tsx:53) oraz membership/atoms/KpiTile.tsx i pricing/atoms/PricingKpi.tsx. Brak jednego atomu KPI pieniężnego z walutą.

## 9. Wydarzenia jako część lejka

#### Wydarzenia jako część lejka: co już jest, a czego brakuje

##### 1. Skąd są dane o rejestracjach, biletach i przychodzie

- **Zgłoszenia** są w tabeli `event_registrations`. Najważniejsze kolumny to `status`, `payment_status`, `payment_order_id`, `paid_at`, `paid_amount_cents`, `attended_at`, `source`, `ticket_type_id`, `group_lead_registration_id` i `quoted_price_cents`. Kolumny widać w wygenerowanych typach `src/integrations/supabase/types.ts`. Statusy (`draft, pending, approved, rejected, waitlist, cancelled, attended, no_show`) są w `src/lib/events/registrationsApi.ts:65-74`.
- **Osoba** jest w `event_people`, a **cennik** w `event_ticket_types`. Cennik czyta RPC `admin_event_tickets_list`, które zwraca m.in. `sold_count`, `pending_count`, `waitlist_count`, `seats_left`, `min_tier_rank` i `effective_price_cents` (wywołanie w `registrationsApi.ts:159-160`).
- **Pieniądze** są w `payment_orders`. Zamówienie biletu to `kind='one_time'` z `metadata->>event_id` (`src/lib/billing/ticketOrders.server.ts:128-141`). Pakiety grupowe mają osobną tabelę `event_package_orders` (`amount_cents`, `status`, `payment_order_id`). Faktury organizatora są w `event_invoices`.
- **Druga ścieżka zapisu (legacy):** tabela `event_rsvps` i RPC `rsvp_event()` działają równolegle do `event_registrations` (`src/lib/events/registrationSurface.ts:295-302`).
- **Zapis zgłoszenia:** `submitEventRegistration` (`eventRegistration.functions.ts:116`) woła `submitEventRegistrationForRequest` (`eventRegistration.server.ts:295`), a ta RPC `event_register_for_client`. Rdzeń zapisu to SQL-owa funkcja `_event_register` (najnowsza wersja w `20261012180500_event_register_owner_verified_address.sql`).
- **Płatność:** webhook przez `oneTimeFulfilment.server.ts:822` woła `payments_apply_event_ticket_outcome` (`20261013900200_reg_main_merge_ticket_outcome.sql:58`).
- **Atrybucja i lejek:** atrybucja kampanii jest w `event_registration_attributions` oraz `event_package_order_attributions`. Kroki lejka zapisuje `event_funnel_events`: `visit`, `registration_start` i `checkout_start` (`eventFunnelWire.ts:15`, endpoint `/api/public/event-funnel`).

##### 2. Zdarzenia domenowe (tabela `public.domain_events`)

Lista typów jest w `src/lib/realtime/domainEvents.ts:112-173`.

| Zdarzenie                                                                                      | Skąd pochodzi                             |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `event.registration.created.v1` (payload: event_id, person_id, status, ticket_type_id, source) | `_event_register` (`…180500…sql:752-764`) |
| `event.registration.payment.v1` (payload: event_id, order_id, outcome, refunded_cents)         | `…900200…sql:469-476`                     |
| `decided`, `cancelled`, `promoted`, `refund_requested`, `refund_failed`, `code_invalidated`    | emitowane w migracjach                    |
| `event_invoice.issued/cancelled`                                                               | emitowane                                 |
| `event_cfp_submission.*`                                                                       | emitowane                                 |
| `event.published`, `event.cancelled`, `event.cloned`                                           | emitowane                                 |

- **Tylko w kontrakcie:** `event.registration.offered/offer_closed/transfer_*`, `event.certificate.*` i `event.survey.*` są wpisane w typach i w mapie inwalidacji, ale żadna migracja ich nie emituje.
- **Check-in** nie ma zdarzenia na szynie. Trigger `tg_event_registrations_attended_crm` pisze wyłącznie do CRM (`20260926150001…sql:685-732`).

##### 3. CRM, newsletter i konto

- **CRM ma jedno wejście:** `_event_person_crm_sync(...)` (`20260926090000_event_organizer_foundation.sql:338`). Stan synchronizacji jest w `event_person_crm_links`, ponowienie robi `admin_event_person_crm_retry`.
  - Segment kontaktu zmienia się tylko w górę (`_crm_source_type_rank`): `event_participant`(40) < `event_cfp`(50) < `speaker`(60) < `paid_subscriber`(90).
  - Każdy zapis do `crm_leads` emituje `crm_lead.created|updated.v1`.
  - Wpisy na osi czasu CRM mają akcje `event.*` (`src/lib/crm/eventActivity.ts`).
- **Zwykły zapis NIE zakłada leada.** Lead powstaje (`p_create=true`) tylko w trzech sytuacjach:
  - Po atrybucji: `event_registration_attribution_attach` (`20261012160000…sql:184,315`). Wysyła się tylko wtedy, gdy przeglądarka ma zgodę analytics/marketing (`registrationAttribution.ts:13-18`, `eventRegistration.server.ts:393-396`).
  - Po potwierdzeniu zgody marketingowej linkiem DOI (`20261012133000…sql:284`).
  - Przez CFP, faktury i skan leada na stoisku.
- **Check-in** tylko aktualizuje istniejący kontakt (`p_create=>false`, tagi `attended:<slug>`).
- **Newsletter:** zapis NIE dopisuje do newslettera. Most zeruje `newsletter_status` nowego kontaktu (`…090000…sql:63-68`). W drugą stronę wypis z maila wycofuje zgodę marketingową uczestnika (`20261012133200…sql`).
- **Konto:** zapis NIE zakłada konta. Wiąże istniejące konto przez `event_people.user_id`, ale tylko przy potwierdzonym adresie (`…180500…sql:20-30`, `accountBindingsAdminApi.ts`).

##### 4. Jak plan subskrypcji wpływa na bilety

- **Klucze w `membership_tiers.features`:** `included_event_tickets`, `included_event_tickets_org` i `event_ticket_discount_pct` (`20260822091000_plan_ticket_allowance.sql:31-36`).
- **Rejestr wykorzystania puli:** tabela `plan_ticket_claims` (`:71`), liczona w roku członkowskim.
- **RPC:**
  - `my_ticket_allowance` (`:192`);
  - `claim_included_event_ticket` i `release_included_event_ticket` – ścieżka legacy (`:332`, `:471`);
  - `event_registration_claim_plan_seat` i `event_registration_redeem_plan_ticket` – nowa ścieżka.
- **TS:**
  - `ticketAmountCents` i `coversTicket` (`ticketAllowance.ts:83-104`): bilet z puli ma pierwszeństwo przed zniżką;
  - `priceEventTicket` (`eventTicketPricing.server.ts:157`) zwraca `planBenefit: 'included'|'discount'` tylko dla miejsca członka, goście płacą cenę z cennika;
  - `redeemPlanTicket` (`eventTicketPlanRedeem.server.ts:76`).
- **Bramki dostępu:** `events.min_tier_rank` i `event_ticket_types.min_tier_rank` (`ticketDraft.ts:79`). Stawki ulgowe obsługuje `event_audience_grants` (`audienceGrantsApi.ts`).
- **Brak:** nie ma żadnego widoku admina na zużycie puli `plan_ticket_claims`.

##### 5. Metryki, które już są liczone (do reużycia)

- **Liczniki zgłoszeń:** `useRegistrationCounts` → RPC `admin_event_registrations_counts` → `parseRegistrationCounts` (all, byStatus, capacity, seatsLeft). Do tego `occupancyPct`. Klucz: `['event-registrations', eventId, 'counts', q]`.
- **Obecność:** `useOnsiteStats` → `admin_event_onsite_stats` (arrivedTotal, noShowTotal, attendanceRate, walkIn, leadScans). Klucz: `['event-onsite', eventId, 'stats', bucket]`.
- **Spotkania:** `useMeetingStats` → `admin_event_meeting_stats`.
- **Lejek reklamowy i przychód netto per wydarzenie:**
  - hook `useAdsFunnelReport` → RPC `admin_event_ads_funnel`, klucz `['event-ads-funnel', eventId, 'report', from, to]`;
  - zwraca visits → registrationStarts → checkoutStarts → registrations → paid, revenue i cost;
  - funkcje `stepRate`, `costPerAcquisition`, `returnOnAdSpend`, `mappedCampaignsRoas` (`adsFunnel.ts:252-300`);
  - okno czasu liczy `adsFunnelWindow`, które korzysta z BI-owego `resolveWindow`.
  - Reguła przychodu jest w SQL (`20260927001100…sql:390-460`): `payment_orders` opłacone lub zwrócone minus `refunded_amount_cents`, plus pakiety. Bilet z puli planu nie jest liczony jako zakup.
- **Panel zbiorczy:** `EventAnalyticsPanel` składa wszystko powyżej (`EventAnalyticsPanel.tsx:74-86`).
- **Przychód w skali najemcy:**
  - `monetization_dashboard` sumuje WSZYSTKIE `payment_orders` brutto, bez rozbicia bilet/subskrypcja i bez zwrotów (`20260724100000…sql:65-71`);
  - `AdminTicketOrdersPanel` ma literalny klucz `['admin','ticket-orders','list']` i liczy statystyki w przeglądarce z ostatnich 200 zamówień.
- **Warstwa semantyczna BI** (`src/lib/analytics/semantic/metrics.ts`) nie ma żadnej metryki wydarzeń.

##### 6. Follow-up i oferty: obecny stan

- `runEventFollowUp` to zaślepka (`followUpJob.server.ts:17-22`), choć cron już ją woła (`jobsTick.server.ts:287`, `community-cron.ts:195`).
- Gniazda `EventMeFollowUpSlot`, `ManageFollowUpSlot` i `RegistrationCardFollowUpSlot` zwracają `null`.
- Nakładki `i18n-event-follow-up`, `i18n-admin-event-follow-up` i `i18n-admin-event-offers` mają tylko `title`.
- Nie ma tabel certyfikatów ani ankiet i nie ma sekcji „Po wydarzeniu” w `eventStudioNav.ts:50-92`.
- Gotowe są tylko:
  - ustawienia `certificate*`/`survey*` w `event_participant_settings` (`participantSettings.ts:70-82`);
  - rodzaje doręczeń `survey_invite` i `certificate_ready` (`participantDeliveryKinds.ts`).
- Panel komunikacji ma jedynie odsyłacz do `/admin/newsletter/campaigns` (`EventCommunicationsPanel.tsx:227-238`).

##### 7. Pułapki

- **Edytor automatyzacji odrzuca zdarzenia zgłoszeń.** Walidator `EVENT_TYPE_PATTERN` (`src/lib/admin/workflows.ts:266`) przyjmuje tylko dwa człony + wersję, więc nie da się w nim wybrać `event.registration.created.v1` jako wyzwalacza. Silnik SQL dopasowuje typ przez zwykłą równość (`20260711204000…sql:271`), więc po stronie bazy taki wyzwalacz by działał.
- **Segment klubu „event_rsvp” nie widzi nowych zgłoszeń.** `club_segment_candidate_ids` czyta tylko `event_rsvps` (`20260808290000…sql:59-65`), więc uczestnicy zapisani do `event_registrations` są niewidoczni dla kampanii klubowych.
- **Część ekranów nie odświeża się na żywo po płatności.** `event.registration.payment.v1` nie unieważnia kluczy `billingKeys.admin.monetization()`, `['admin','ticket-orders',…]` ani `['event-ads-funnel', eventId]`.

### Do reużycia

- **registrationKeys + useRegistrationCounts/useRegistrationsList/useEventTickets** (`src/lib/events/useEventRegistrations.ts:71-139`): Importować fabrykę kluczy w hubie zamiast literałów. Liczniki zgłoszeń: useRegistrationCounts({eventId,ticketTypeId:null,groupId:null,q:'',from,to}), tak jak EventAnalyticsPanel.tsx:74-81. Inwalidację gałęzi registrationKeys.event(eventId) robią już mutacje modułu i realtime.
- **parseRegistrationCounts / occupancyPct / emptyRegistrationCounts** (`src/lib/events/registrationCounts.ts:51-78`): Parser jsonb z admin_event_registrations_counts. Dla kafli KPI 'zgłoszenia, zatwierdzone, lista rezerwowa, wypełnienie sali' nie pisać nowego parsera.
- **REGISTRATION_STATUSES / REGISTRATION_ACTIONS** (`src/lib/events/registrationsApi.ts:65-89`): Słownik etapów zgłoszenia, odwzorowanie CHECK-a, do mapy lejka (pending, approved, attended, no_show) i jako warunki gałęzi if/then w ścieżkach.
- **adsFunnelKeys + useAdsFunnelReport + fetchAdsFunnel** (`src/lib/events/useEventAdsFunnel.ts:38-54; src/lib/events/adsFunnelApi.ts:226`): Jedyne miejsce, które liczy przychód netto, koszt i lejek wizyta→zapis→płatność per wydarzenie i per kampania. Hub może per wydarzenie wołać ten sam hook z tym samym kluczem ['event-ads-funnel', eventId, 'report', from, to], co daje wspólny cache ze studiem.
- **stepRate / costPerAcquisition / returnOnAdSpend / mappedCampaignsRoas / adsFunnelWindow / parseAdsFunnelReport** (`src/lib/events/adsFunnel.ts:167-330`): Czyste funkcje wskaźników, bezpieczne dla null i świadome walut (MoneyAmount[]/CostAmount[]). Do reużycia w dashboardzie huba dla konwersji, CPA i ROAS. adsFunnelWindow korzysta z resolveWindow warstwy semantycznej BI.
- **formatAmounts / formatCosts / formatRoas + AdsFunnelBars + AdminMetricTile** (`src/lib/events/adsFunnelFormat.ts; src/components/admin/events/molecules/AdsFunnelBars.tsx; src/components/admin/molecules/AdminMetricTile.tsx`): Formatowanie kwot w wielu walutach i paski lejka już używane w EventAdsFunnelPanel. Kafel KPI AdminMetricTile jest współdzielony w panelu admina.
- **EventAnalyticsPanel (wzorzec składania KPI z żywych RPC)** (`src/components/admin/events/organisms/EventAnalyticsPanel.tsx:61-269`): Wzorzec 'kreska zamiast zera', percent() i Metric. Hub powinien składać KPI wydarzeń tymi samymi hookami (useRegistrationCounts, useOnsiteStats(eventId,60,true,false), useMeetingStats), a nie liczyć ich po raz kolejny.
- **onsiteKeys + useOnsiteStats (no-show, frekwencja)** (`src/lib/events/useEventOnsite.ts:69-82,134; src/lib/events/onsiteApi.ts:335-336,406-433`): noShowTotal, attendanceRate (null = nikt nie odznaczył) i arrivedTotal z admin_event_onsite_stats. Do metryki no-show w hubie i do wyzwalacza winback 'nie przyszedł'.
- **meetingKeys.stats + admin_event_meeting_stats** (`src/lib/events/useMeetings.ts:47-52; src/lib/events/meetingsApi.ts:417`): Zaangażowanie uczestników (spotkania 1-1) jako sygnał w scoringu lub segmentacji.
- **listTicketOrders / getTicketOrderHistory (loadTicketOrders)** (`src/lib/billing/ticketOrders.functions.ts:14-28; src/lib/billing/ticketOrders.server.ts:128-298`): Lista zamówień biletowych tenanta z wydarzeniem i kupującym, czytana przez RLS admina. Do tabeli przychodów z biletów w hubie. Obecny klucz w AdminTicketOrdersPanel.tsx:108-113 to literał ['admin','ticket-orders','list']: trzeba go wynieść do fabryki i reużyć.
- **priceEventTicket / quoteEventTicketOrder / applyEventTicketCoupon** (`src/lib/billing/eventTicketPricing.server.ts:157,435,562`): Jedna wycena biletu dla kasy i podglądu (faza sprzedaży, benefit planu included/discount, kod rabatowy, liczba miejsc grupy). Polityka cenowa i paywall w hubie powinna ją pokazywać lub symulować, a nie liczyć osobno.
- **redeemPlanTicket + REDEEM_REFUSALS** (`src/lib/billing/eventTicketPlanRedeem.server.ts:50-105`): Odbiór biletu z puli planu. Mapa odmów przydaje się do opisów benefitów w macierzy benefitów.
- **ticketAllowance (parseTicketAllowance, coversTicket, ticketAmountCents, TicketOffer) + loadTicketAllowance/getMyTicketAllowance** (`src/lib/events/ticketAllowance.ts:60-120; src/lib/events/ticketAllowance.server.ts:24-44; src/lib/events/ticketAllowance.functions.ts:9`): Reguły benefitu 'bilet w planie / zniżka %' z membership_tiers.features. Do macierzy benefitów i oferty subskrypcji dla uczestników (przelicznik 'z planem zapłacisz X'). Klucz klienta: ['ticket-allowance', userId] (EventTicketPurchase.tsx:93).
- **\_event_person_crm_sync + event_person_crm_links + admin_event_person_crm_retry** (`supabase/migrations/20260926090000_event_organizer_foundation.sql:222,293-338,595`): Jedyne wejście modułu Wydarzeń do crm_leads (segment rośnie tylko w górę, tagi event:<slug>, wpis osi czasu event.*, zgoda tylko z dowodu). Krok ścieżki 'etap CRM' dla uczestnika wydarzenia powinien iść tym mostem (z SECURITY DEFINER), nie bezpośrednim INSERT/UPDATE.
- **eventActivity (oś czasu CRM typu event)** (`src/lib/crm/eventActivity.ts:1-30`): Prefiks akcji 'event.' i kontrakt metadanych {event_id, event_slug, summary_pl/en}. Hub może z niego czytać historię uczestnictwa kontaktu.
- **DOMAIN_EVENT_TYPES (event.registration.\*) + eventInvalidationMap + useDomainEventInvalidation** (`src/lib/realtime/domainEvents.ts:112-173; src/lib/realtime/eventInvalidationMap.ts:234-298,483-570; src/lib/realtime/useModuleRealtime.ts:121`): Wyzwalacze ścieżek (created, decided, payment, cancelled, promoted, refund_*) i automatyczne odświeżanie cache. Hub dostaje synchronizację w obie strony za darmo, jeśli używa tych samych kluczy. Nowe klucze huba trzeba dopisać do reguł tych zdarzeń.
- _*participantSettings (certificate*/survey_/reminders) + participantSettingsKeys** (`src/lib/events/participantSettings.ts:60-82; src/lib/events/useParticipantSettings.ts:30-75`): Konfiguracja per wydarzenie dla przypomnień, certyfikatu i ankiety oraz dziennik doręczeń (admin_event_message_delivery_stats). Ścieżka follow-up w hubie powinna czytać te flagi zamiast trzymać własne.
- **DELIVERY_KINDS / event_message_deliveries** (`src/lib/events/participantDeliveryKinds.ts`): Rodzaje i kanały doręczeń (survey_invite, certificate_ready, waitlist_offer...) ze statusami claimed/sent/skipped/failed. Wzorzec deduplikacji i dziennika dla kroków e-mail ścieżek wydarzeniowych.
- **adminEventKeys / eventDetailKeys / useAdminEventsList / useAdminEventDetail** (`src/lib/events/useAdminEvents.ts:32-48; src/lib/events/useAdminEventDetail.ts:29-56`): Lista i detal wydarzeń (admin_events_list z going_count, waitlist_count, seats_left, ticket_price_cents, min_tier_rank) do selektora wydarzeń i przeglądu portfela w hubie.
- **eventInvoiceKeys / packageKeys** (`src/lib/events/useEventInvoices.ts:52-60; src/lib/events/useEventPackages.ts:39-47`): Przychód B2B z faktur i pakietów grupowych (admin_event_invoices_list, admin_event_package_orders_list) jako dodatkowe źródła przychodu wydarzeń.
- **eventFunnelWire / sendEventFunnelStep** (`src/lib/events/eventFunnelWire.ts:13-19; src/lib/events/eventFunnelBeacon.ts:75`): Kroki lejka strony wydarzenia (visit, registration_start, checkout_start) zapisywane w event_funnel_events. Górna część mapy lejka w hubie dla wydarzeń.
- **runEventFollowUp (gniazdo crona) + ParticipantJobResult** (`src/lib/events/jobs/followUpJob.server.ts:17-22; src/lib/events/jobs/types.ts; src/lib/server/jobsTick.server.ts:287`): Zamrożona sygnatura (admin, opts) => Promise<ParticipantJobResult> jest już wołana przez cron. Silnik ścieżek follow-up po wydarzeniu może podpiąć się tu albo w równoległym ticku z tym samym budżetem deadlineAt.

### Punkty integracji

- [moduł->hub] Wyzwalacze ścieżek z zapisów i płatności (event.registration.created/decided/payment/cancelled/promoted/refund_requested/refund_failed.v1, event.cancelled.v1): public.domain_events; emitery: 20261012180500_event_register_owner_verified_address.sql:752-764, 20261013900200_reg_main_merge_ticket_outcome.sql:469-476; typy: src/lib/realtime/domainEvents.ts:112-121
- [moduł->hub] Walidator wyzwalaczy edytora automatyzacji odrzuca 3-członowe typy event.registration.*.v1 (regex ^[a-z0-9_]+\.[a-z0-9_]+\.v[0-9]+$). Do poprawienia lub zastąpienia listą DOMAIN_EVENT_TYPES: src/lib/admin/workflows.ts:266-270 (DB dopasowuje przez równość: supabase/migrations/20260711204000_workflow_engine.sql:271)
- [hub->moduł] Krok 'etap CRM' / 'zadanie' dla uczestnika: przez most _event_person_crm_sync (segment event_participant, tagi event:<slug>, oś czasu event.*), stan w event_person_crm_links: supabase/migrations/20260926090000_event_organizer_foundation.sql:338; 20260927001400_event_person_crm_intents.sql
- [obie] Lead z zapisu powstaje tylko przy atrybucji (zgoda analytics/marketing) albo potwierdzeniu zgody DOI; check-in tylko aktualizuje kontakt. Hub musi pokazywać lukę 'zgłoszenia bez kontaktu CRM' albo dodać intencję 'registration' bez atrybucji: src/lib/events/eventRegistration.server.ts:374-403,411-420; 20261012160000_event_manage_token_hygiene.sql:184,315; 20260926150001_event_scanner_offline_part2.sql:685-732; 20261012133000_event_consent_confirm_withdraw.sql:284
- [moduł->hub] Przychód netto i lejek per wydarzenie i kampania (wizyty→zapisy→płatności, revenue, cost, ROAS) do dashboardu huba: RPC admin_event_ads_funnel (20260927001100_event_ads_funnel_review_fixes.sql:390-460); src/lib/events/useEventAdsFunnel.ts:38-54
- [moduł->hub] Przychód z biletów na poziomie tenanta: lista zamówień biletowych i monetization_dashboard (dziś brutto, miesza bilety z subskrypcjami, bez zwrotów): src/lib/billing/ticketOrders.server.ts:128; src/components/admin/billing/AdminTicketOrdersPanel.tsx:108-113; supabase/migrations/20260724100000_fix_definer_header_tenant_scope.sql:42-71; src/routes/admin.monetization.tsx:99-103
- [moduł->hub] Odświeżanie na żywo: event.registration.payment.v1 nie unieważnia billingKeys.admin.monetization(), ['admin','ticket-orders',...] ani ['event-ads-funnel', eventId]. Hub musi dopisać swoje klucze do reguł mapy: src/lib/realtime/eventInvalidationMap.ts:234-239,483-500
- [obie] Polityka cenowa i macierz benefitów: benefit planu na biletach (included_event_tickets, included_event_tickets_org, event_ticket_discount_pct w membership_tiers.features), pula plan_ticket_claims, bramki min_tier_rank, stawki ulgowe event_audience_grants: supabase/migrations/20260822091000_plan_ticket_allowance.sql:31-36,71,192,332,471; src/lib/events/ticketAllowance.ts:60-104; src/lib/billing/eventTicketPricing.server.ts:157-430; src/lib/events/audienceGrantsApi.ts
- [hub->moduł] Oferta subskrypcji dla uczestników: TicketOffer (free/included/discounted/full) liczona z planu wołającego; hub może segmentować uczestników bez planu (event_registrations bez membership) jako cel upsellu: src/lib/events/ticketAllowance.ts:106-120; src/components/community/EventTicketPurchase.tsx:81-93
- [hub->moduł] Ścieżka follow-up po wydarzeniu: cron już woła runEventFollowUp (zaślepka); ustawienia certificate*/survey* w event_participant_settings; rodzaje doręczeń survey_invite/certificate_ready; gniazda uczestnika puste: src/lib/events/jobs/followUpJob.server.ts:17-22; src/lib/server/jobsTick.server.ts:287-288; src/routes/api/public/community-cron.ts:195-199; src/lib/events/participantSettings.ts:70-82; src/components/events/participant/slots/EventMeFollowUpSlot.tsx
- [hub->moduł] Odsyłacz ze studia wydarzenia (Komunikacja/Analityka) do huba zamiast /admin/newsletter/campaigns i /admin/analytics: src/components/admin/events/organisms/EventCommunicationsPanel.tsx:227-238; src/components/admin/events/organisms/EventAnalyticsPanel.tsx:203-239
- [obie] Newsletter: zapis nie dopisuje do newslettera (most zeruje newsletter_status), a wypis z maila wycofuje zgodę marketingową uczestnika i w CRM: supabase/migrations/20260926090000_event_organizer_foundation.sql:63-68; supabase/migrations/20261012133200_email_unsubscribe_withdraws_event_consent.sql
- [obie] Kluby: segment kampanii klubowej event_rsvp czyta tylko legacy event_rsvps (bez event_registrations); wydarzenie może mieć przypięty klub i grupę dyskusji (events.discussion_club_id/discussion_group_id): supabase/migrations/20260808290000_discussion_clubs_a27_segment_invitations.sql:59-65; supabase/migrations/20260826182500_event_attendees_and_discussions.sql:125-145; src/lib/clubs/types.ts:510-555
- [moduł->hub] Mapa lejka: górne kroki z event_funnel_events (visit/registration_start/checkout_start) i atrybucja z event_registration_attributions / event_package_order_attributions: src/lib/events/eventFunnelWire.ts:13-15; src/lib/events/registrationAttribution.ts
- [moduł->hub] Retencja/winback: no-show (status no_show, onsite noShowTotal), anulowania i zwroty (event.registration.cancelled/refund_*.v1, event_registration_refund_jobs) jako sygnały i wyzwalacze: src/lib/events/onsiteApi.ts:335-336,406-407; src/lib/realtime/domainEvents.ts:115-117,164-165

### Ograniczenia i bramki

- Nie dublować liczników: EventAnalyticsPanel celowo składa istniejące RPC (admin_event_registrations_counts, admin_event_onsite_stats, admin_event_meeting_stats); hub ma używać tych samych hooków i fabryk kluczy (registrationKeys, onsiteKeys, meetingKeys, adsFunnelKeys), a nie literałów ani nowych zapytań o to samo.
- Mapa inwalidacji realtime używa literałów kluczy, a nie fabryk (eventInvalidationMap.ts, komentarz przy funkcjach pomocniczych). Zgodność pilnuje **tests**/eventRealtimeKeys.test.ts. Każdy nowy klucz huba trzeba dopisać do reguł i do testu, a każdy wpis DOMAIN_EVENT_TYPES musi mieć regułę (test pokrycia).
- 'Nie wiem' to nie zero: null zamiast 0 dla braku limitu miejsc, frekwencji bez odprawy i ROAS przy wielu walutach (registrationCounts.ts:9-13, adsFunnel.ts:10-13). Kwoty są per waluta (MoneyAmount[]) i nie wolno sumować PLN z EUR.
- Reguła przychodu z biletów (SQL ads funnel): opłacone albo zwrócone payment_orders minus refunded_amount_cents, tylko dla payment_status paid/partially_refunded; bilet z puli planu (aktywny plan_ticket_claims bez zamówienia) NIE jest zakupem; goście z własnym zamówieniem doliczani do prowadzącego; pakiety z event_package_orders. Dashboard huba musi stosować tę samą regułę albo wołać to RPC.
- Do CRM pisze wyłącznie most _event_person_crm_sync (SECURITY DEFINER, segment tylko w górę, zgoda marketingowa tylko z dowodu, p_create decyduje o założeniu kontaktu, nie przekazujemy notatek recenzentów ani identyfikatorów kliknięć). Wycofanie zgody nie obniża crm_leads.marketing_consent poza ścieżkami wycofania.
- Tenant zawsze z sesji (assert_event_admin_tenant(), public_tenant_id()), nigdy z payloadu. Literalne nazwy RPC i tabel oraz granty (server-only = service_role) dla bramki CI generate:ts-sql-contract (AGENTS.md).
- Dwie ścieżki zapisu działają równolegle: legacy event_rsvps/rsvp_event (claim_included_event_ticket) i nowa event_registrations/_event_register (event_registration_redeem_plan_ticket). Metryki i segmenty huba muszą obejmować obie albo jawnie wybrać jedną.
- Benefit planu należy tylko do miejsca członka (holder_is_caller). Goście płacą cenę z cennika, bilet z puli ma pierwszeństwo przed zniżką, a awaria my_ticket_allowance degraduje się do pustej puli (fail-closed na korzyść pełnej ceny).
- Pliki toru C/B (followUpJob.server.ts, gniazda *FollowUpSlot, nakładki i18n-event-follow-up/i18n-admin-event-follow-up/i18n-admin-event-offers) mają zamrożone sygnatury i właścicieli; nakładka i18n musi zachować prefiks, parytet PL/EN i zdanie title (marker HEAVY_DICTIONARIES w scripts/check-entry-purity.ts).
- Atrybucja i lead z zapisu zależą od zgody w przeglądarce (registrationAttribution.ts:13-18). Wysyłka i ścieżki marketingowe do uczestników wymagają skutecznej zgody marketingowej (rejestr zgód A2, DOI), inaczej naruszenie RODO.
- Trasy studia są cienkie (wiersz wydarzenia z useAdminEventDetail, ten sam klucz cache); private admin screens wymagają adminPageHead lub sekcyjnych meta (AGENTS.md).

### Braki

- Brak metryk wydarzeń w warstwie semantycznej BI (src/lib/analytics/semantic/metrics.ts ma tylko ruch, reklamy i newsletter): nie ma zdefiniowanych metryk przychód z biletów, konwersja zapisu, no-show rate ani wypełnienie sali.
- Brak agregatu przychodu z wydarzeń w skali tenanta: monetization_dashboard sumuje wszystkie payment_orders brutto, bez rozbicia na bilety, pakiety i subskrypcje i bez zwrotów. AdminTicketOrdersPanel liczy statystyki w przeglądarce z ostatnich 200 zamówień. Nie ma RPC 'przychód per wydarzenie w okresie' poza admin_event_ads_funnel.
- Brak zdarzenia domenowego check-in na szynie (tylko audit_log event.checkin.attended w CRM i attended_at), więc ścieżka nie ma wyzwalacza 'uczestnik przyszedł'. Brak też zdarzenia 'no_show' poza decided.v1 z panelu.
- Edytor automatyzacji (workflows.ts:266) nie przyjmuje 3-członowych typów event.registration.*.v1, więc nie da się dziś zbudować wyzwalacza na zapis lub płatność.
- Zwykły zapis bez zgody analityczno-marketingowej nie tworzy ani nie aktualizuje kontaktu CRM (brak intencji 'registration' bez atrybucji), więc lejek CRM nie widzi części uczestników.
- Follow-up po wydarzeniu (tor C) nie istnieje: runEventFollowUp to zaślepka, brak tabel certyfikatów i ankiet, gniazda UI zwracają null, nakładki i18n mają tylko title, brak sekcji studia 'Po wydarzeniu'. Zdarzenia event.certificate.* / event.survey.* nie są emitowane.
- Oferty z listy rezerwowej i przekazania (tor B) są tylko w kontrakcie: event.registration.offered/transfer_*.v1 nie są emitowane, klucz 'admin-event-registration-money' nie ma żadnego hooka, a i18n-admin-event-offers ma tylko title.
- Brak widoku admina na wykorzystanie puli biletów z planu (plan_ticket_claims: ile wydano, per plan, per wydarzenie) potrzebnego do macierzy benefitów i kosztu benefitu.
- Brak przychodu ze sponsoringu w danych (event_sponsor_tiers i event_sponsors nie mają ceny ani kwoty). Przychód sponsorski widać tylko pośrednio w event_invoices.
- Realtime: event.registration.payment.v1 nie odświeża dashboardu monetyzacji, listy zamówień biletowych ani lejka reklamowego.
- Segment klubowy event_rsvp nie obejmuje event_registrations, więc uczestnicy z nowego formularza nie trafiają do kampanii klubowych. Brak też odwrotnego mostu 'uczestnik wydarzenia → zaproszenie do klubu' poza tym segmentem.
- Brak oferty subskrypcji dla uczestnika wydarzenia jako osobnego kroku po zakupie lub w follow-upie (TicketOffer pokazuje benefit tylko posiadaczom planu).

## 10. Kluby dyskusyjne jako część lejka

#### 1. Model danych i jedno źródło dostępu

- Tabele są wyłącznie RPC (RLS deny-all, granty tylko dla `service_role`): `clubs`, `club_groups`, `club_members` (`supabase/migrations/20260808090000_discussion_clubs_a1_structure.sql:65-112,135,194-232,238-252`). Moduł ma ok. 30 tabel `club_*`, m.in. `club_applications`, `club_invitations`, `club_invite_links`, `club_segment_rules`, `club_events`, `club_event_rsvps`, `club_documents`, `club_specializations`.
- `clubs` ma dwie niezależne osie: `visibility` (public/members/private/secret) i `join_policy` (open/request/invite). Do tego dochodzą `min_tier_rank` (:83) i zdenormalizowane `member_count`/`thread_count`/`last_activity_at` (:100-103). `club_members.invite_source` to kanał pozyskania (:215). Słownik po migracji 20261004090000:101 to `direct,email,link,segment,auto,self,proposal`.
- O dostępie decyduje tylko `public.club_capabilities(club, group, user)`, które zwraca kod `reason`: `tier_too_low`, `not_member`, `banned`, `auth_required` i inne (a1:399-605). Najnowsza wersja jest w `20261007100100_club_post_mentions_and_link_validation.sql:464`. Próg planu jest liczony kanonicznym `has_tier_rank()`, które łączy subskrypcje, granty i seaty organizacji (:596-601).
- **Obniżenie planu nie wyrzuca członka z klubu.** Bramka działa tylko dla `v_role='non_member'` (a1:520, 20261007100100:596). Członek, który zrezygnował z płatnego planu, zostaje aktywny w klubie. To istotne dla retencji i winbacku.

#### 2. Dostęp a plan. Nie ma produktów ani opłat klubowych

- Nie ma SKU ani opłaty za klub. „Products” z `20260809000000_discussion_clubs_a29_products_and_topic_sections.sql:34-48` to rodzaje DOKUMENTU (dorobek klubu, np. `policy_brief`, `decision_memo`), a nie produkt handlowy.
- Dostęp wynika z rangi planu. Progi zapisane w kodzie:
  - `CLUB_PLAN_TIER_RANK`: free 0 … presidents_circle 60, domyślnie `pro` (`src/lib/clubs/planTiers.ts:19-46`).
  - `CLUB_TIER_RANK=pro(20)` i `CLUB_OBSERVER_TIER_RANK=member(10)` w `src/lib/clubs/hubAccess.ts:16,31`.
  - `CLUB_MINISITE_TIER_RANK=partner_general(50)` w `src/lib/clubs/minisiteAccess.ts:33`. Komentarz nazywa ten próg „Partner Strategiczny”, a w `tierRanks.ts:11` Partner Strategiczny to 40, więc nazewnictwo jest niespójne.
  - `PRO_MIN_RANK=20` w `src/routes/club.apply.tsx:58` oraz literał `20` w `club_apply_submit`. Spójność tych trzech miejsc pilnuje `src/lib/clubs/__tests__/clubPlanTierParity.test.ts`.
  - `club_events.min_tier_rank` dla Decision Lab (`20260822096000_club_events_tier_gate.sql:29`).
- Benefity klubowe w cenniku to wolny tekst w `membership_tiers.benefits`:
  - „Pełne członkostwo w jednym klubie dyskusyjnym do wyboru” (`20260822095000_catalog_v61_benefits_copy.sql:55`).
  - „Onboarding zespołowy… przypisanie miejsc do klubów w 7 dni” (:111).
  - Żaden z nich nie jest wymuszany. Limit „1 klub” nie jest sprawdzany w `club_join` (`20260808110000_discussion_clubs_a8_hardening.sql:1174-1230`) ani w `club_apply_submit`. Nie ma też powiązania seatów organizacji z klubami.
- Paywall w UI:
  - `clubGateView()` w `src/lib/clubs/gateView.ts:80-128` sprzedaje co najmniej Pro. CTA prowadzi do `/pricing` bez parametru planu i bez kontekstu klubu (`src/components/clubs/organisms/ClubAccessGate.tsx:193,203,357`).
  - Hub ma panel upsell przy `access==='locked'` (`src/routes/club.index.tsx:135-140`).
  - Bramka i formularz zgłoszenia nie wysyłają żadnych zdarzeń analitycznych (`track`/`trackFormConversion` nie są wołane w `ClubAccessGate.tsx` ani w `club.apply.tsx`).

#### 3. Ścieżki wejścia do klubu (równoległe, każda z innym śladem)

1. **`club_join`** (a8:1174): przy `open` członkostwo jest od razu `active`. Przy `request` powstaje wiersz `club_members.status='pending'`, a takie prośby liczy `admin_club_pending_counts.join_requests` (`20260808095000_discussion_clubs_a5_moderation.sql:484-500`).
2. **Zgłoszenie PRO+** (`club_applications`, `20260811111733_…sql:6-46`):
   - Jest liczone per SPECJALIZACJA, a `club_id` jest opcjonalne.
   - Statusy: `pending|review|accepted|rejected|needs_info` (114031:24-27).
   - Bramki: `pro_required` i `club_tier_too_low` przez `club_capabilities`. Dozwolone jest jedno otwarte zgłoszenie na osobę i specjalizację (`duplicate_open`, indeks `club_applications_open_unique_idx`, 151703:6-9).
3. **Zaproszenia** (`20260808092000_discussion_clubs_a2_invitations.sql`):
   - A, bezpośrednie: `club_invitations`, przy akceptacji `invite_source='direct'`.
   - B, e-mail: `club_invite_by_email` zapisuje do platformowych `user_invitations` (source `club`, rola klubowa w `metadata.club_role`). Trigger `tg_user_invitations_enroll_club` zakłada członkostwo z `invite_source='email'` (:287-403).
   - C, link `/club/join/$token`: `club_redeem_invite_link` z `max_uses`, `expires_at`, `requires_approval`; dla `requires_approval` status to `pending` (:491-561, trasa `src/routes/club.join.$token.tsx:36-52`).
   - D, segment: `club_segment_candidate_ids`, typy reguł `badge|policy_follow|event_rsvp|other_club|specialization` (`20260808290000_discussion_clubs_a27_segment_invitations.sql:38-90`). Zaproszenie segmentowe po akceptacji dostaje `invite_source='direct'` (`20260808210000_…a19…sql`, `club_respond_invitation`), więc atrybucja kampanii ginie. `club_invitations` nie ma kolumny źródła.
4. **Propozycja klubu przez członka**: `club_propose` tworzy szkic i członkostwo `proposal` (`20260905193621_…sql:52-131`).

#### 4. Proces zgłoszenia: kto zatwierdza, skutki, e-maile

- Zatwierdza `admin_club_application_set_status` (a35 `20260811150000_…sql:492-611`), bramka `assert_admin_tenant()`. Przepuszcza ona tylko rolę `admin` (`20260713190000_member_analytics.sql:33`), a NIE `super_admin`. To niespójne z `is_club_admin` (admin LUB super_admin).
- Przy `accepted` (:548-583) dzieją się trzy rzeczy:
  - powstaje wpis w `club_members` (`role member`, `invite_source 'auto'`, :553), przy czym ban nie jest zdejmowany;
  - puste pola profilu są uzupełniane danymi ze zgłoszenia;
  - wychodzi powiadomienie w aplikacji `club_notify` (:593, :601). Przy `rejected` też, przy `needs_info` nie.
- E-mail wysyła serwerowa funkcja `notifyClubApplicationStatus` (`src/lib/clubs/applicationNotify.functions.ts:58-96`). Szablony tx to `club_application_accepted|rejected|more_info` (`src/lib/email-templates/tx-copy.ts:80-82`). Klucz idempotencji ma postać `club-application:{id}:{status}`, ślad zapisuje `admin_club_application_mark_notified`.
- Komentarze w migracji mówią o „ręcznym” uruchamianiu maila, ale inbox wysyła go AUTOMATYCZNIE po każdej zmianie statusu (`src/components/admin/clubs/organisms/ClubApplicationsInbox.tsx:88-109`).
- Nie ma maila „zgłoszenie przyjęte do rozpatrzenia” ani przypomnienia przy `needs_info`.
- Inbox: trasa `src/routes/admin.community.clubs.applications.tsx`, reguły w `src/lib/clubs/adminApplicationsInbox.ts`, klucze `applicationInboxKeys` (:59-64). Liczniki `admin_club_applications_counts` dają tylko `total`/`pending` per specjalizacja, bez osi czasu i bez podziału na accepted/rejected (`20260811111733_…sql:228-246`).

#### 5. CRM i newsletter

- `club_application_crm_sync` (najnowsza wersja: `20261007140710_club_application_crm_sync_overload.sql:21-81`) woła `crm_upsert_from_form(…, 'club_application', '{}')`, a potem robi UPDATE na `crm_leads`. Ustawia `club_applied_at`, `club_application_count+1` i `club_specializations` (kolumny z `20260811111733_…sql:1-4`). Stan synchronizacji trafia do `club_applications.crm_sync_status/crm_error`. Ponowienie robi `admin_club_application_crm_retry`.
- **Błąd segmentacji:** :54 ustawia `source_type='club_application'` bezwarunkowo. Wydarzenia podnoszą segment tylko w górę przez `_crm_source_type_rank` (`20260926090000_event_organizer_foundation.sql:295-313`: `club_application`=70, `paid_subscriber`=90). Zgłoszenie klubowe może więc obniżyć segment płacącego klienta.
- **UI CRM nie zna klubów:**
  - pól `club_*` leada nie czyta żaden plik `src/` (poza typami);
  - filtr źródła zna tylko `form|newsletter|import` (`src/lib/crm/leadListSpec.ts:94,244`);
  - oś czasu leada ma typ `event`, ale nie `club` (`src/lib/crm/leadTimeline.ts:18-19`). Wzorzec do skopiowania to `src/lib/crm/eventActivity.ts`, oparty na wierszach `audit_log` z prefiksem `event.`.
- **Newsletter:** brak spięcia. Zgoda z formularza idzie do rejestru zgód jako `marketing_email` z `source:'club_apply'` (`src/routes/club.apply.tsx:270-279`) i do `crm_leads.marketing_consent`, ale nie powstaje wiersz `newsletter_subscribers`. W `src/lib/newsletter*` i `src/lib/crm*` nie ma ani jednego odwołania do klubów. Klubowy `notify_level='digest'` jest zapisywany, ale nie znaleziono producenta digestu.

#### 6. Zdarzenia domenowe i synchronizacja kluczy

- Emitowane zdarzenia (katalog `src/lib/realtime/domainEvents.ts:68-82`):
  - `club_member.changed.v1`: przy INSERT i zmianie status/role, z payloadem `club_id, member_user_id, status, role` (`20260808140000_discussion_clubs_a12_seams.sql:377-410`);
  - `club_thread.created|status_changed.v1`, `club_reply.*`, `club_thread.document_added|milestone_set.v1`, `club_post_comment.created.v1`.
- Klub `secret` nie emituje niczego. W trybie chatham payload nie ma aktora.
- Brak zdarzeń dla zgłoszeń (a35:39-41 mówi to wprost), zaproszeń, linków i segmentów.
- Realtime zamienia zdarzenia na inwalidację kluczy (`src/lib/realtime/eventInvalidationMap.ts:168-203`). `club_member.changed.v1` czyści `clubKeys.all`, `club(id)` i `memberships()` (:198). Akceptacja zgłoszenia odświeża więc klub przez szynę, ale tylko gdy klub nie jest `secret`.
- Luki inwalidacji:
  - inbox po zmianie statusu czyści tylko `applicationInboxKeys.all` (`ClubApplicationsInbox.tsx:96`), bez `clubKeys`, `adminClubKeys` i `clubKeys.pendingCounts()`;
  - `subscriptionKeys()` i `membershipGrantKeys()` (`eventInvalidationMap.ts:402-421`) nie czyszczą `clubKeys`, więc zmiana planu pokazuje stare `tier_too_low` aż minie `CLUB_STALE_MS=30s` (`src/lib/clubs/clubInvalidations.ts:32`).
- Klucze:
  - drzewo `clubKeys` i `adminClubKeys` w `src/lib/clubs/queryKeys.ts:9-406` (np. `stats(id)`, `pendingCounts()`, `memberships()`, `myInvitations()`, `events(...)`, `activitySeries`, `workspaceStats`);
  - poza drzewem leżą `["club-applications","mine"]` (`club.apply.tsx:73`) i `["club-apply-prefill"]` (:141);
  - plan: `billingKeys.currentTier(uid)` (`src/lib/billing/keys.ts:21`).
- Silnik automatyzacji (`src/lib/admin/workflows.ts`) wyzwala się zdarzeniami z `domain_events`, więc dziś z klubów może reagować tylko na `club_member.changed.v1` i zdarzenia treści.

#### 7. Wydarzenia ↔ kluby

- `events.discussion_club_id` i `discussion_group_id` (`20260827065944_…sql:125-145`) zasilają RPC `event_discussions` (`src/lib/events/publicEventApi.ts:625`). W `src/` nie ma UI, które ustawia te kolumny.
- `club_events.anchor_event_id → events(id)` (`20260808300000_discussion_clubs_a28_workspace.sql:131`) jest w typach (`src/lib/clubs/workspaceTypes.ts:310`), ale żaden formularz go nie ustawia.
- Obecność na spotkaniach klubu (`club_event_rsvps`) to osobny byt od `event_rsvps` i `event_registrations`.
- Most w przeciwną stronę istnieje: reguła segmentu `event_rsvp` (status `going`/`interested` w `event_rsvps`) pozwala zaprosić uczestników wydarzenia do klubu. Krawędź `club_thread_milestones.event_id → 'scheduled_with'` trafia do grafu powiązań.

#### 8. Metryki: co jest, czego brak

- Per klub:
  - `admin_club_stats(club_id)`: członkowie, aktywni 30 dni (wg `last_read_at`), pending, bany, `unanswered_pct`, mediana czasu do pierwszej odpowiedzi, wątki i odpowiedzi z 30 dni (`20260808100000_discussion_clubs_a7_admin_coordination.sql:565-623`). Hook `useAdminClubStats`, klucz `clubKeys.stats`.
  - `club_workspace_stats` / `club_activity_series` (a28:1007-1180).
- Lista: `admin_club_list` z `member_count`, `pending_count`, `min_tier_rank` (`20260808091000_discussion_clubs_a1_admin_rpc.sql`).
- Przekrojowo:
  - pulpit liczy `admin_dashboard_audience.totals.clubMembers` (`20260912110000_admin_dashboard_aggregates.sql:673`), parsuje go `src/lib/admin/dashboard/parse.ts:243`, ale `AudiencePanel.tsx` go nie renderuje;
  - kluby nie występują w `get_engagement_overview`, `admin_community_stats`, `admin_member_funnel`/`retention` ani w słowniku metryk semantycznych (`src/lib/analytics/semantic/metrics.ts`).
- Badge w menu admina: `clubPending` = moderacja + `join_requests` (`src/components/admin/AdminShell.tsx:312-314`, `src/lib/admin/adminNav.ts:353`). Wpis „Zgłoszenia” nie ma licznika oczekujących zgłoszeń.

#### 9. Czego hub potrzebuje od klubów

- **Konwersja zgłoszeń:** lejek submitted → review/needs_info → accepted/rejected, czas do decyzji (`reviewed_at - created_at`), udział `crm_sync_status='error'` i `notify_error`. Do tego konwersja „członek klubu wg `invite_source` (auto/self/email/link/direct/proposal)” oraz akceptacja zaproszeń z `club_invitations.status`. Potrzebny jest nowy RPC agregujący z bramką tenantu z sesji. Dziś są tylko liczniki per specjalizacja.
- **Benefit klubu w macierzy:** liczony z `clubs.min_tier_rank`, `club_groups.min_tier_rank` i `club_events.min_tier_rank` w odniesieniu do `membership_tiers.rank` oraz stałych `planTiers`/`hubAccess`/`minisiteAccess`, a nie z tekstu `benefits`. Do tego flaga „obietnica bez bramki” (limit 1 klubu, onboarding seatów w 7 dni).
- **Paywall:** CTA z `ClubAccessGate` i hubu z kontekstem (`?tier=`, slug klubu) i zdarzeniem `track()`, żeby atrybuować upgrade do klubu.
- **Ścieżka onboardingowa członka klubu:** wyzwalacz `club_member.changed.v1` (status `active`, `invite_source`), potem akceptacja zasad (`club_accept_rules` / `rules_accepted_at`), pierwszy odczyt (`last_read_at`), pierwszy wpis. Dla zgłoszeń trzeba DODAĆ zdarzenia `club_application.submitted|decided.v1` (dziś nie istnieją).
- **Retencja i winback:** członkowie klubu z wygasłym planem (członkostwo zostaje), nieaktywni ponad 30 dni (`last_read_at`), `status='left'`.
- **CRM:** monotoniczny `source_type`, typ `club` na osi czasu leada i filtr źródła `club_application`.
- **Klucze współdzielone:** `clubKeys`, `adminClubKeys`, `applicationInboxKeys` i `billingKeys`, bez kopii.

### Do reużycia

- **club_capabilities (jedyne źródło dostępu, kody reason)** (`supabase/migrations/20261007100100_club_post_mentions_and_link_validation.sql:464`): Hub ani nowe RPC nie piszą bramki inline. Przy liczeniu „kto ma dostęp do klubu z planu X” trzeba wołać club_capabilities albo has_tier_rank (ten sam helper, co wydarzenia). Kod reason='tier_too_low' służy jako sygnał paywalla.
- **clubKeys / adminClubKeys** (`src/lib/clubs/queryKeys.ts:9`): Hub używa clubKeys.list(), clubKeys.stats(id), clubKeys.pendingCounts(), clubKeys.memberships() i adminClubKeys.list(filters) bez kopiowania literałów. Inwalidacja przez prefiks clubKeys.club(id) albo clubKeys.all.
- **applicationInboxKeys + reguły skrzynki** (`src/lib/clubs/adminApplicationsInbox.ts:59`): Widżet konwersji zgłoszeń w hubie czyta te same klucze (all/list/counts) i deskryptory (applicationStatusTone, crmChipView, totalPending), żeby zmiana w skrzynce i w hubie odświeżała się w obie strony.
- **applyApi (RPC zgłoszeń)** (`src/lib/clubs/applyApi.ts:187`): fetchAdminClubApplications, fetchAdminClubApplicationCounts, setClubApplicationStatus, retryClubApplicationCrmSync i typ ClubApplicationAdminRow (crm_sync_status, notified_*) to gotowe źródła dla kafla lejka zgłoszeń.
- **notifyClubApplicationStatus (e-mail decyzji)** (`src/lib/clubs/applicationNotify.functions.ts:58`): Wzorzec kroku „e-mail” w ścieżce: sendTxEmail z idempotencyKey i mark_notified. Typy tx club_application_accepted/rejected/more_info można użyć jako szablonów kroków journey.
- **clubInvalidations (nazwane skutki mutacji)** (`src/lib/clubs/clubInvalidations.ts:39`): clubCardKeys, clubSettingsKeys, clubMembershipKeys i invalidateKeys(qc, keys) wystarczą hubowi przy akcjach typu „dodaj do klubu” albo „zmień próg planu”. Nie trzeba wymyślać własnych list.
- **eventInvalidationMap (realtime → klucze)** (`src/lib/realtime/eventInvalidationMap.ts:198`): Nowe zdarzenia (np. club_application.decided.v1) trzeba dopisać tutaj i do katalogu src/lib/realtime/domainEvents.ts:68. Do subscriptionKeys()/membershipGrantKeys() trzeba dołożyć clubKeys.list()/bySlugAll(), żeby zmiana planu od razu zmieniała dostęp do klubów.
- **Słowniki progów planu** (`src/lib/clubs/planTiers.ts:19`): CLUB_PLAN_TIERS, CLUB_PLAN_TIER_RANK, planTierFromRank i rankFromPlanTier zasilają macierz benefitów (kolumna „kluby od rangi”). Pozostałe progi: hubAccess.ts:16,31 (CLUB_TIER_RANK, CLUB_OBSERVER_TIER_RANK), minisiteAccess.ts:33 i src/lib/billing/tierRanks.ts:16 (TIER_RANKS).
- **clubGateView (deskryptor paywalla klubu)** (`src/lib/clubs/gateView.ts:80`): Hub może pokazać podgląd paywalla per klub (sellTier, akcje upgrade/plans/request) tą samą funkcją, którą renderuje ClubAccessGate, bez drugiej definicji.
- **resolveClubHubAccess** (`src/lib/clubs/hubAccess.ts:56`): Segmentacja odbiorców w ścieżkach: member / invited / entitled / locked, liczona tak samo jak panel na /club.
- **admin_club_stats + useAdminClubStats + adminClubStatsView** (`supabase/migrations/20260808100000_discussion_clubs_a7_admin_coordination.sql:565`): Metryki zdrowia per klub (active_members_30d, unanswered_pct, median_first_reply_hours). Klient: src/lib/clubs/api.ts:370, src/lib/clubs/useClubAdmin.ts:97, deskryptory w src/lib/clubs/adminClubStatsView.ts.
- **club_activity_series / club_workspace_stats** (`src/lib/clubs/useClubWorkspace.ts:220`): Szereg dzienny (threads/replies/participants) już wypełniony zerami. Nadaje się do wykresu aktywności klubu w dashboardzie, klucze clubKeys.activitySeries(id, days) i workspaceStats(id, days).
- **useClubPendingCounts** (`src/lib/clubs/useClubModeration.ts:163`): Licznik próśb o dostęp (join_requests) i kolejki moderacji do kafla „do decyzji” w hubie, klucz clubKeys.pendingCounts().
- **Reguły segmentów klubowych (podgląd + wysyłka)** (`src/lib/clubs/adminSegment.ts:71`): clubSegmentRule, previewClubSegment i inviteClubSegment (src/lib/clubs/api.ts:281,300) można użyć jako akcji „zaproś do klubu” w silniku ścieżek. Typ event_rsvp łączy wydarzenia z klubem.
- **Wzorzec aktywności modułu na osi CRM** (`src/lib/crm/eventActivity.ts:39`): Skopiować dla klubów: akcje audit_log 'club.*' (zgłoszenie, decyzja, dołączenie) jako typ 'club' w LeadTimelineEventType (src/lib/crm/leadTimeline.ts:18).
- **\_crm_source_type_rank (monotoniczny segment CRM)** (`supabase/migrations/20260926090000_event_organizer_foundation.sql:295`): Poprawka club_application_crm_sync powinna podnosić source_type tylko w górę, tak jak most wydarzeń (20260927001400_event_person_crm_intents.sql:317).
- **emit_domain_event + tg_club_members_seams** (`supabase/migrations/20260808140000_discussion_clubs_a12_seams.sql:377`): Wzorzec emitera w triggerze: blok EXCEPTION, payload bez treści, klub secret pomijany. Według niego dodać club_application.submitted/decided.v1 jako wyzwalacze journeys.
- **Dashboard audience totals.clubMembers** (`src/lib/admin/dashboard/parse.ts:243`): Liczba jest już liczona i parsowana (dashboardQueryKey z tenantem w src/lib/admin/dashboard/queryKeys.ts:30). Wystarczy ją wyrenderować w AudiencePanel albo w hubie.

### Punkty integracji

- [obie] Akceptacja zgłoszenia tworzy członkostwo (invite_source='auto') i powiadomienie w aplikacji: supabase/migrations/20260811150000_discussion_clubs_a35_applications_fixes.sql:548-610 (admin_club_application_set_status)
- [moduł->hub] Zgłoszenie zapisuje lead w CRM (source_type, club_applied_at, club_application_count, club_specializations, marketing_consent): supabase/migrations/20261007140710_club_application_crm_sync_overload.sql:21-81 (club_application_crm_sync)
- [hub->moduł] E-mail decyzji (accepted/rejected/needs_info) przez potok transakcyjny: src/lib/clubs/applicationNotify.functions.ts:58-96 + src/components/admin/clubs/organisms/ClubApplicationsInbox.tsx:88-109
- [moduł->hub] Zdarzenie club_member.changed.v1 jako wyzwalacz ścieżek i realtime: supabase/migrations/20260808140000_discussion_clubs_a12_seams.sql:377-410; src/lib/realtime/eventInvalidationMap.ts:198
- [hub->moduł] Inwalidacja dostępu do klubów po zmianie planu (brak: subscriptionKeys/membershipGrantKeys nie czyszczą clubKeys): src/lib/realtime/eventInvalidationMap.ts:402-421
- [obie] Próg planu klubu/działu/spotkania jako źródło macierzy benefitów: clubs.min_tier_rank (a1:83), club_groups.min_tier_rank (a1:152), club_events.min_tier_rank (20260822096000_club_events_tier_gate.sql:29); zapis przez admin_club_upsert / ClubAccessTab
- [moduł->hub] Paywall klubu kierujący na /pricing (brak kontekstu klubu i analityki): src/components/clubs/organisms/ClubAccessGate.tsx:193,203,357; src/routes/club.index.tsx:135-140; src/routes/club.apply.tsx:403
- [moduł->hub] Zgoda marketingowa z formularza zgłoszenia do rejestru zgód (marketing_email, source club_apply); brak wiersza newsletter_subscribers: src/routes/club.apply.tsx:270-279
- [obie] Wydarzenie → dyskusje klubu (events.discussion_club_id/discussion_group_id, RPC event_discussions) - bez UI do ustawienia: supabase/migrations/20260827065944_fbf90e88-713b-4475-94f4-97a841a84b8d.sql:125-145; src/lib/events/publicEventApi.ts:625
- [obie] Spotkanie klubu → wydarzenie platformy (club_events.anchor_event_id) - bez UI: supabase/migrations/20260808300000_discussion_clubs_a28_workspace.sql:131; src/lib/clubs/workspaceTypes.ts:310
- [hub->moduł] Zaproszenie segmentowe uczestników wydarzenia do klubu (reguła event_rsvp): supabase/migrations/20260808290000_discussion_clubs_a27_segment_invitations.sql:58-65; src/lib/clubs/api.ts:281-320
- [moduł->hub] Badge kolejek klubów w menu admina (bez zgłoszeń): src/components/admin/AdminShell.tsx:312-314; src/lib/admin/adminNav.ts:350-358
- [moduł->hub] Licznik członków klubów na pulpicie (liczony, nierenderowany): supabase/migrations/20260912110000_admin_dashboard_aggregates.sql:673; src/lib/admin/dashboard/parse.ts:243
- [hub->moduł] Przełącznik modułu clubs_enabled (domyślnie wyłączony): src/lib/admin/community.ts:73; src/routes/club.tsx (useClubsModule); src/routes/admin.community.index.tsx:217-222

### Ograniczenia i bramki

- Tabele klubowe są RPC-only (REVOKE ALL dla anon/authenticated, GRANT dla service_role, a1:238-252). Hub nie może czytać ich supabase.from(); potrzebne są nowe RPC SECURITY DEFINER z literalną nazwą (bramka generate:ts-sql-contract / check:ts-sql-contract, package.json:53-54).
- Dostęp liczy wyłącznie club_capabilities(). Każda nowa bramka (np. limit „1 klub”) musi iść przez tę funkcję albo has_tier_rank, nigdy jako warunek inline (a1:1-37).
- Tenant zawsze z sesji: current_tenant_id() / assert_admin_tenant() / profil wołającego, nigdy z payloadu ani public_tenant_id(). Pilnuje tego check:sql-tenant-scope.
- assert_admin_tenant() przepuszcza tylko rolę 'admin' (20260713190000_member_analytics.sql:33), a is_club_admin to admin LUB super_admin (a1:42-51). RPC huba dla zgłoszeń muszą świadomie wybrać bramkę, inaczej super_admin bez 'admin' nie zobaczy danych.
- Każda migracja z tekstem 'public.club_' lub 'public.admin_club_' trafia do harnessu klubowego (scripts/pg-harness/run.sh:95-97). Migracja huba, która tylko CZYTA tabele klubów i dotyka innych modułów, musi mieć nagłówek '-- pg-harness: exclude' z uzasadnieniem, jak 20260912110000_admin_dashboard_aggregates.sql:1-30.
- emit_domain_event ma jedną sygnaturę (uuid,text,text,text,jsonb,uuid actor,boolean suppress) po A16/A17. Wołać z p_suppress_actor => … i w bloku EXCEPTION, żeby awaria szyny nie wywróciła transakcji. Klub 'secret' nie emituje niczego, payload bez tytułów i treści (domain_events czyta cały staff).
- Obniżenie planu nie odbiera członkostwa w klubie (bramka tylko dla non_member). Retencja i winback nie mogą zakładać, że utrata planu = utrata klubu.
- Spójność progu Pro w trzech warstwach pilnuje src/lib/clubs/**tests**/clubPlanTierParity.test.ts (SQL club_apply_submit, PRO_MIN_RANK w club.apply.tsx, CLUB_PLAN_TIER_RANK.pro). Zmiana progu wymaga ruchu we wszystkich trzech.
- Wysyłki e-mail do kandydatów idą przez sendTxEmail z idempotencyKey 'club-application:{id}:{status}'. Kroki ścieżek nie mogą dublować tej wysyłki dla tych samych statusów.
- Słownik panelu adminClubs.* wymaga ensureAdminClubsI18n() (bramka adminClubsI18nLoading.gate). Moduły czyste zwracają klucze i18n, nie teksty.
- AGENTS.md: karty klubów i hub klubów bramkować useHydrated (bez podmiany SSR gościa przed hydracją). Prywatne ekrany admina z sekcyjnym adminPageHead (src/lib/adminPageHead.ts:2), a obecne trasy klubów mają ogólne 'Clubs · Community · Admin' (admin.community.clubs.index.tsx:39, $clubId.tsx:66).
- club_application_crm_sync zwiększa club_application_count przy KAŻDYM wywołaniu, a admin_club_application_crm_retry nie sprawdza crm_sync_status (114031:87-120). Retry blokuje tylko UI (crmChipView.canRetry).
- Klucze cache z tenantem/uid tam, gdzie dane zależą od tożsamości: dashboardQueryKey(tenantId,…) i billingKeys.currentTier(uid). clubKeys.bySlugViewer(slug, viewerId) rozdziela anonima i zalogowanego.

### Braki

- Brak zdarzeń domenowych dla zgłoszeń (club_application.submitted/decided), zaproszeń, linków i kampanii segmentowych. Silnik ścieżek nie ma wyzwalacza „złożył zgłoszenie”, „zaakceptowano” ani „zaproszony”.
- Brak agregatu lejka zgłoszeń w czasie (submitted→review/needs_info→accepted/rejected, czas do decyzji, konwersja per specjalizacja/klub). admin_club_applications_counts daje tylko total/pending per specjalizacja.
- Brak przekrojowych metryk klubów w BI: get_engagement_overview, admin_community_stats, admin_member_funnel/retention i słownik metryk semantycznych nie znają klubów. totals.clubMembers jest liczony, ale nie renderowany w AudiencePanel.
- Brak licznika oczekujących zgłoszeń przy wpisie „Zgłoszenia” w menu admina (clubPending = moderacja + join_requests).
- Brak produktów i opłat klubowych oraz ustrukturyzowanego uprawnienia klubowego w planie. Benefity „1 klub do wyboru” i „onboarding seatów do klubów w 7 dni” to tekst w membership_tiers.benefits bez wymuszenia i bez powiązania seat→klub.
- Paywall klubu nie przekazuje kontekstu (klub, docelowy plan) do /pricing i nie wysyła zdarzeń analitycznych. Upgrade’u nie da się przypisać klubowi.
- club_application_crm_sync bezwarunkowo ustawia source_type='club_application' (20261007140710:54), co może obniżyć segment paid_subscriber (90→70), wbrew _crm_source_type_rank używanemu przez wydarzenia.
- UI CRM ignoruje kluby: pola club_applied_at/club_application_count/club_specializations nie są wyświetlane, filtr źródła zna tylko form/newsletter/import, oś czasu leada nie ma typu 'club'.
- Brak spięcia z newsletterem: zgłoszenie ze zgodą marketingową nie tworzy subskrybenta, nie ma segmentu newslettera „członkowie klubu X”, a klubowy notify_level='digest' nie ma producenta digestu.
- Brak UI do ustawienia events.discussion_club_id/discussion_group_id oraz club_events.anchor_event_id. Wydarzenia i kluby są spięte tylko w bazie.
- Atrybucja kanału członkostwa jest niepełna: akceptacja zaproszenia z kampanii segmentowej zapisuje invite_source='direct', a club_invitations nie ma kolumny źródła ani id kampanii (club_segment_rules).
- Inbox zgłoszeń po zmianie statusu nie inwaliduje clubKeys/adminClubKeys/clubKeys.pendingCounts(), a zmiana planu (subscription._/membership_grant._) nie inwaliduje clubKeys. Synchronizacja w obie strony działa tylko przez realtime club_member.changed.v1 (bez klubów secret) albo po staleTime.
- Brak maila „otrzymaliśmy zgłoszenie” i przypomnienia przy needs_info. W aplikacji needs_info nie wysyła powiadomienia.
- Brak wymuszenia limitu klubów per plan oraz reguły segmentu po planie/etapie CRM/subskrypcji newslettera (club_segment_candidate_ids zna tylko badge/policy_follow/event_rsvp/other_club/specialization).
- Dwie równoległe ścieżki „prośby o dostęp” (club_members.status='pending' z club_join przy join_policy='request' oraz club_applications per specjalizacja) bez wspólnej skrzynki i wspólnej metryki konwersji.

## 11. Ekrany admina wydarzeń i klubów

#### Rozpoznanie: ekrany admina wydarzeń i klubów pod hub „Przychód i lejek”

Rozpoznanie bez zmian w plikach.

##### 1. Studio wydarzenia: dashboardy i statystyki

Wszystkie trasy sekcji są cienkie. Wiersz wydarzenia czytają przez `useAdminEventDetail(eventId)` z kluczem `eventDetailKeys.one(id) = ["admin-event-detail", id]` (src/lib/events/useAdminEventDetail.ts:29-45). RPC to `admin_event_detail` (src/lib/events/eventDetailApi.ts:25). Mutacje unieważniają ten klucz, `adminEventKeys.all = ["admin-module-events"]` i stary `["admin-community-events"]` (useAdminEventDetail.ts:47-56).

- **overview** (`EventOverviewPanel`, src/components/admin/events/organisms/EventOverviewPanel.tsx)
  - Kafle: rejestracje, wolne miejsca, sesje, grupy, sponsorzy (:58-74, :102-119).
  - Lista kroków liczona ze stanu wydarzenia, linki przez `EVENT_STUDIO_ROUTES` (:76-90, :129-131).
  - Kafel to lokalny `Metric` (:175).
- **analytics** (`EventAnalyticsPanel`, …/EventAnalyticsPanel.tsx)
  - Składa żywe RPC: `useRegistrationCounts` (:74-81), `useEventSessions` (:82), `useMeetingStats` (:83) i `useOnsiteStats(eventId,60,true,false)` (:86).
  - Ma osobny lokalny `Metric` (:244), z kreską zamiast zera.
  - Ma wiersze-drogowskazy do `/ads-funnel` (:205-214), do `/sponsor-report` ukrywanego przełącznikiem `sponsors` (:71-72, :216-227) i do `/admin/analytics` (:229-239).
- **sponsor-report** (`SponsorReportPanel`, …/SponsorReportPanel.tsx)
  - Kafle `AdminMetricTile` (:270-320) i wykres `ChartCard` (:333).
  - Tabela sponsorów, rozbicie per miejsce, eksport CSV/XLSX.
  - Akcja „przenieś kontakty do CRM”: `usePushLeadScansToCrm` → `admin_event_lead_scans_push_to_crm` (:229-254, :568).
  - `?sponsor=<uuid>` jest walidowany w trasie (admin.events_.$eventId.sponsor-report.tsx:27, :37-42).
  - Klucze: `sponsorReportKeys` pod `sponsorKeys.event(id)` (src/lib/events/useSponsorReport.ts:45-57).
  - RPC: `admin_event_sponsor_report_summary`, `…_series` i `…_leads_series` (src/lib/events/sponsorReportApi.ts:56, :67, :83).
- **ads-funnel** (`EventAdsFunnelPanel`) to jedyny gotowy lejek z przychodem.
  - Kroki: visits → registrationStarts → checkoutStarts → registrations → paid, plus revenue i cost (src/lib/events/adsFunnel.ts:35-47).
  - RPC `admin_event_ads_funnel(p_event_id,p_from,p_to)` (src/lib/events/adsFunnelApi.ts:227).
  - Klucze `adsFunnelKeys = ["event-ads-funnel", id, "report", from, to]` (src/lib/events/useEventAdsFunnel.ts:38-46).
  - Lejek rysuje molekuła `AdsFunnelBars` (src/components/admin/events/molecules/AdsFunnelBars.tsx:26).
- **communications** (`EventCommunicationsPanel`)
  - Przypomnienia, eksport do kalendarza i dziennik doręczeń: `participantSettingsKeys.one/deliveries` (src/lib/events/useParticipantSettings.ts:30-33), RPC `admin_event_message_delivery_stats` (participantSettingsApi.ts:85).
  - Rodzaje doręczeń: event_reminder, session_reminder, waitlist__, transfer__, survey_invite, certificate_ready (src/lib/events/participantDeliveryKinds.ts:16-28).
  - Drogowskaz do `/admin/newsletter/campaigns` (EventCommunicationsPanel.tsx:228-239). To naturalne miejsce na wiersz „Ścieżki uruchamiane przez to wydarzenie”.
- **Wspólny cache z hubem.** Klucze liczb wydarzenia:
  - `registrationKeys.counts(query)` = `["event-registrations", id, "counts", query]` (src/lib/events/useEventRegistrations.ts:71-89); RPC `admin_event_registrations_counts` (registrationsApi.ts:465-467).
  - `meetingKeys.stats` (useMeetings.ts:47-55); RPC `admin_event_meeting_stats` (meetingsApi.ts:417).
  - `onsiteKeys.stats(id,bucket)` (useEventOnsite.ts:69-82); RPC `admin_event_onsite_stats` (onsiteApi.ts:428-435).
  - Overview i analytics wołają counts z IDENTYCZNYM obiektem `{eventId,ticketTypeId:null,groupId:null,q:"",from:null,to:null}`. Hub musi użyć tego samego obiektu, żeby trafić w ten sam wpis cache.
- **Lista międzywydarzeniowa.** `admin_events_list` zwraca już `going_count`, `seats_left`, `ticket_price_cents`, `ticket_currency` i `min_tier_rank` (src/integrations/supabase/types.ts:27818-27847). Klucz: `adminEventKeys.list(params, minute)` (src/lib/events/useAdminEvents.ts:32-35).

##### 2. Społeczność i kluby

- **/admin/community** (src/routes/admin.community.index.tsx)
  - `AdminBiStrip days=14` (:113), czyli te same funkcje serwera co /admin/analytics (klucz `analyticsBiStripKey`, src/lib/analytics/queryKeys.ts:67).
  - Kafle `["admin-community-stats"]` → `admin_community_stats` (:62-66) i przełączniki modułów `["admin-community-modules"]` w `site_settings` (:67-83).
  - Ręczne `runEventReminders` (:91-96).
  - Lokalny `StatCard` (:434).
- **/admin/community/engagement** (src/routes/admin.community.engagement.tsx)
  - Klucz `["admin-engagement-overview"]` → RPC `get_engagement_overview` (:45-49; src/lib/admin/community.ts:1111).
  - Karta „Subskrypcje i warstwy” (`subscriptions_active`, `tier_distribution`, :97-114) to DUPLIKAT KPI przyszłego hubu.
  - SQL liczy aktywność z messages, comments, event_rsvps, poll_votes, qa_questions i eu_policy_follows. Nie liczy klubów ani `event_registrations` (supabase/migrations/20260713099000_engagement_overview.sql:31-56, :71-90).
  - Lista „Najbliższe wydarzenia” prowadzi na PUBLICZNE `/events/$slug`, a nie do studia (:194-200).
  - Lokalne `Stat` (:231) i `TierBars` (:257).
- **/admin/community/notifications** (src/routes/admin.community.notifications.tsx)
  - `SchedulerHealthPanel` (:53; klucz `["admin","scheduler-health"]`, RPC `job_scheduler_health`).
  - Liczniki `["admin-notification-stats"]` liczone `count` z `push_subscriptions`, `notifications` i `notification_preferences.email_digest` (community.ts:1032-1065).
  - Akcja utrzymaniowa: purge nieudanych subskrypcji push.
  - Brak autoringu treści. To dyżurny ekran KANAŁÓW (push/digest), a nie miejsce komunikacji z członkami. NIE duplikuje journeys, ale dzieli z nimi kanały (preferencje digestu, `notifications`).
- **Kluby**
  - Lista: `useAdminClubs` → `admin_club_list` (src/lib/clubs/api.ts:189; zwraca member_count, pending_count, min_tier_rank). Klucz `adminClubKeys.list(filters)` (src/lib/clubs/queryKeys.ts:385-405). Filtry są w useState (admin.community.clubs.index.tsx:52-65).
  - Edytor `/admin/community/clubs/$clubId?tab=` (admin.community.clubs.$clubId.tsx:67-69). Zakładki: general, access, groups, threads, members, invitations, permissions, moderation, analytics (src/lib/clubs/clubEditorTabs.ts:14-24).
  - Zakładka analytics to `ClubStatsTab` → `useAdminClubStats` (klucz `clubKeys.stats(id)` = `["clubs","club",id,"stats"]`, queryKeys.ts:66; RPC `admin_club_stats`, api.ts:371). Kafle `ClubFormStatCard` z deskryptorami z `lib/clubs/adminClubStatsView.ts`.
  - Plakietka kolejek w `CommunitySubNav` z `useClubPendingCounts` (CommunitySubNav.tsx:97-99, :132-139).
  - Skrzynka zgłoszeń `/admin/community/clubs/applications`: filtry w useState (ClubApplicationsInbox.tsx:58-60), klucze `applicationInboxKeys` (src/lib/clubs/adminApplicationsInbox.ts:59-64).
  - RPC zgłoszeń: `club_apply_submit`, `admin_club_applications_list/counts/set_status/crm_retry` (src/lib/clubs/applyApi.ts:143, :193, :205, :219, :236).
  - E-maile transakcyjne zgłoszeń: `club_application_accepted/rejected/more_info` (src/lib/clubs/applicationNotify.functions.ts:16-26).

##### 3. Komponenty KPI i wykresów do ujednolicenia

- `AdminMetricTile` (src/components/admin/molecules/AdminMetricTile.tsx:42; ikona, etykieta, wartość, podpowiedź, ton) w SponsorReport, AdsFunnel, MeetingStats, OnsiteStats, Seating i SchedulerHealth.
- `KpiTile` BI (src/components/admin/analytics/KpiTile.tsx:77; delta ▲▼, iskra, pasmo benchmarku ze źródłem) w paywall, membership i dashboardach BI.
- `ChartCard` (src/components/admin/analytics/ChartCard.tsx:71) z `biChart` (biChart.ts:68).
- Duplikaty do zastąpienia:
  - lokalne `Metric` (EventAnalyticsPanel.tsx:244, EventOverviewPanel.tsx:175);
  - `Stat` (engagement :231, notifications :117) i `StatCard` (community index :434);
  - drugi, lokalny `KpiTile` wewnątrz `AdminBiStrip.tsx:53`, kolizja nazwy z BI KpiTile.
- Rekomendacja:
  - hub: `KpiTile` dla trendów i benchmarków, `AdminMetricTile` dla liczników operacyjnych, `ChartCard` dla serii;
  - lejek: uogólnić `AdsFunnelBars`.

##### 4. Głębokie linki z hubu (istniejące trasy i parametry)

- Wydarzenie: `/admin/events/$eventId/{overview|analytics|ads-funnel|registration/list|registration/tickets|registration/packages|registration/invoices|registration/policies|registration/audiences|registration/settings|communications|meetings/stats|onsite/stats|onsite/leads}` (mapa `EVENT_STUDIO_ROUTES`, src/lib/events/eventStudioNav.ts:104-146).
- `/admin/events/$eventId/sponsor-report?sponsor=<uuid>`.
- `/admin/events/list?tab=&q=&t=&f=&page=&size=` (src/lib/events/eventListSearch.ts:43-56).
- Klub: `/admin/community/clubs/$clubId?tab=analytics|members|invitations|access|moderation`.
- `/admin/community/clubs/applications` (bez parametrów).
- `/admin/community/engagement` i `/admin/community/notifications`.
- CRM: `/admin/crm?lead=&task=&view=` (admin.crm.index.tsx:127-144) i `/admin/companies/$id`.
- Ograniczenie: linki do sekcji ukrytych przełącznikiem trzeba bramkować przez `eventFeatureHidingSection` (src/lib/events/eventFeatures.ts:198, :248), jak robi to analytics.

##### 5. Gdzie postawić wskaźnik lub odnośnik z hubu w modułach

- Wydarzenia:
  - `EventCommunicationsPanel.tsx:228-239`: nowy wiersz „Ścieżki komunikacji” z listą journeys, których wyzwalacz to `event.registration.*` z tym `event_id`.
  - `EventAnalyticsPanel.tsx` obok wierszy-drogowskazów (:205-239): „Przychód i lejek wydarzenia”.
  - `EventOverviewPanel.tsx` w kafelkach (:102-119): „Aktywne ścieżki: N”.
  - `RegistrationsListPanel`: wiersz zgłoszenia może pokazać „uruchomiło ścieżkę X” (stan filtrów w useState, :182-186).
  - Pola progu planu: `EventRegistrationSettingsPanel.tsx:243-251` (`minTierRank` jako surowa liczba) i `EventTicketDialog.tsx:425` → link do macierzy benefitów.
- Kluby:
  - `ClubInvitationsTab.tsx:260` obok `ClubSegmentCampaign` (jednorazowa kampania zaproszeń; reguły `badge|specialization|other_club|policy_follow|event_rsvp`, src/lib/clubs/types.ts:510-516) → odnośnik „zautomatyzuj jako ścieżkę”.
  - `ClubAccessTab.tsx:107-108` (próg planu `CLUB_PLAN_TIERS`) → macierz benefitów.
  - `ClubApplicationsInbox` → wskaźnik ścieżki dla zgłoszeń.
  - `admin.community.engagement.tsx:97-114` → zastąpić kartę subskrypcji kafelkiem lub linkiem hubu.
  - Zdrowie runnera journeys w `SchedulerHealthPanel` przez nowy wpis w `SCHEDULER_JOBS` (src/lib/jobs/scheduler.ts:22-44).
- Nawigacja: grupa `community` (src/lib/admin/adminNav.ts:345-366) i grupa `events` (:393).

##### 6. Istniejąca komunikacja automatyczna, której journeys nie mogą dublować

- Joby harmonogramu: `event-reminders`, `event-participant-reminders`, `event-ticket-lifecycle`, `event-follow-up` (ankieta, certyfikat), `event-ticket-codes` i `crm-task-reminders` (scheduler.ts:22-44).
- Stary `run_event_reminders` jest już scalony z `event_registrations` i deduplikuje przez `event_message_deliveries` (supabase/migrations/20261003140000_event_participant_reminders.sql:149, :189).
- Rekomendacja: journeys traktują te jako wiadomości „systemowe” (tylko do odczytu w mapie) albo startują po nich, nie wysyłają ich drugi raz.

##### 7. Synchronizacja dwukierunkowa

- Szyna `domain_events` z zamkniętym katalogiem (src/lib/realtime/domainEvents.ts:48, :75, :112, :117) i mapą unieważnień (src/lib/realtime/eventInvalidationMap.ts:168-198 kluby, :234-239 zgłoszenia, :590-597 `eventKeysList`).
- Hub powinien:
  - wpinać swoje klucze tutaj;
  - czytać wyzwalacze z `event.registration.created|decided|payment.v1`, `event_cfp_submission.*`, `club_member.changed.v1`, `subscription.*`, `crm_lead.stage_changed.v1`.
- Zgłoszenia do klubów ŚWIADOMIE nie emitują zdarzenia domenowego (supabase/migrations/20260811150000_discussion_clubs_a35_applications_fixes.sql:38-44).
- Most CRM wydarzeń: `_event_person_crm_sync` z intencjami `event:<slug>:{cfp|speaker|checkin|invoice|registration|sponsor_lead}` (supabase/migrations/20260927001400_event_person_crm_intents.sql:9-14) i wpisami osi `event.*` (src/lib/crm/eventActivity.ts:1-28).
- Odwrotne linki CRM→studio już są: `CrmEventActivityLink` → `/overview` (src/components/admin/crm/CrmEventActivityLink.tsx:27-29) i `CompanySponsorshipsCard` → `/sponsor-report?sponsor=` (src/components/admin/crm/CompanySponsorshipsCard.tsx:84).

### Do reużycia

- **AdminMetricTile** (`src/components/admin/molecules/AdminMetricTile.tsx`): Kafel liczników operacyjnych w hubie (ikona, etykieta, wartość albo '-', hint, ton neutral/ok/warn/danger). Ten sam kształt co w studiu wydarzeń i SchedulerHealthPanel; zastąpić nim lokalne Metric, Stat i StatCard.
- **KpiTile (BI)** (`src/components/admin/analytics/KpiTile.tsx`): Główne KPI hubu z deltą wobec poprzedniego okresu, iskrą (series), higherIsBetter i pasmem benchmarku z bandSource. Już używany w admin.paywall.tsx i AdminMembershipWorkspace.
- **ChartCard + biChart** (`src/components/admin/analytics/ChartCard.tsx`): Rama wykresu BI (eksport PNG/CSV, pełny ekran, onDataClick→ChartDrillDialog); config budować przez biChart() z src/components/admin/analytics/biChart.ts:68, jak w SponsorReportPanel i AdminBiStrip.
- **AdsFunnelBars** (`src/components/admin/events/molecules/AdsFunnelBars.tsx`): Dostępny lejek jako lista kroków z paskami względem pierwszego kroku i udziałem w poprzednim (stepRate). Do uogólnienia na mapę lejka hubu: wynieść i18n z adminEventAdsFunnel i przyjmować steps:{key,label,value}[].
- **useRegistrationCounts / registrationKeys** (`src/lib/events/useEventRegistrations.ts`): Liczby zgłoszeń per wydarzenie (all, byStatus, capacity, seatsLeft). Hub wołać z TYM SAMYM obiektem co Overview/Analytics ({eventId,ticketTypeId:null,groupId:null,q:'',from:null,to:null}), żeby dzielić wpis cache.
- **useAdsFunnelReport / adsFunnelKeys** (`src/lib/events/useEventAdsFunnel.ts`): Lejek visits→registrationStarts→checkoutStarts→registrations→paid z przychodem i kosztem per kampania (RPC admin_event_ads_funnel). Źródło etapu lejka 'wydarzenie' i ROAS w hubie.
- **useMeetingStats / useOnsiteStats** (`src/lib/events/useMeetings.ts`): Statystyki giełdy spotkań i odprawy (useOnsiteStats w src/lib/events/useEventOnsite.ts:127, w hubie z poll=false jak w analytics) dla etapów 'uczestniczył/no-show' w lejku i retencji.
- **useSponsorReportSummary / usePushLeadScansToCrm** (`src/lib/events/useSponsorReport.ts`): Metryki sponsorów i przeniesienie leadów do CRM. Mutacje unieważniają sponsorKeys.event i sponsorReportKeys.companies; hub może pokazać przychód partnerski i link ?sponsor=.
- **useAdminEventDetail / eventDetailKeys** (`src/lib/events/useAdminEventDetail.ts`): Jeden klucz wiersza wydarzenia ['admin-event-detail', id]. Hub czyta features, min_tier_rank i status tym samym hookiem, a zapisy z hubu idą przez useSave* (unieważniają listę i readiness).
- **useAdminClubs / adminClubKeys** (`src/lib/clubs/useClubAdmin.ts`): Lista klubów z member_count, pending_count, min_tier_rank (admin_club_list). Dla przekroju klubów użyć useAdminClubs({limit:200}); ClubSegmentCampaign używa tego samego wywołania, więc oba trafią w jeden wpis cache.
- **useAdminClubStats / ClubFormStatCard / adminClubStatsView** (`src/components/admin/clubs/organisms/ClubStatsTab.tsx`): Zdrowie klubu (unanswered, firstReply, threads30d, replies30d, active30d, leads_count) przez clubKeys.stats(id). Deskryptory kafli z src/lib/clubs/adminClubStatsView.ts do retencji klubowej w hubie.
- **useClubPendingCounts + applicationInboxKeys** (`src/lib/clubs/adminApplicationsInbox.ts`): Liczniki kolejek (moderacja, prośby o dostęp, zgłoszenia) jako wskaźnik 'do obsługi' w hubie; wspólny klucz z plakietką CommunitySubNav.
- **useClubSegmentPreview / useInviteClubSegment** (`src/lib/clubs/useClubAdmin.ts`): Silnik segmentu (badge, specialization, other_club, policy_follow, event_rsvp) z obowiązkowym podglądem (admin_club_segment_preview). Kandydat na krok 'segment/audience' w journeys zamiast drugiej implementacji.
- **EVENT_STUDIO_ROUTES + eventFeatureHidingSection** (`src/lib/events/eventStudioNav.ts`): Typowana mapa sekcja→trasa do głębokich linków z hubu; bramkować przez eventFeatureHidingSection (src/lib/events/eventFeatures.ts:248), żeby nie linkować do wyłączonego modułu.
- **EventStudioRow / EventStudioPage** (`src/components/admin/events/studio/EventStudioSection.tsx`): Układ wiersza-drogowskazu w studiu (label, description, children). Tym wzorem dodać wiersz 'Ścieżki komunikacji' i 'Przychód i lejek' w Communications i Analytics.
- **eventInvalidationMap / DOMAIN_EVENT_TYPES** (`src/lib/realtime/eventInvalidationMap.ts`): Jedno miejsce mapujące zdarzenia domenowe na klucze React Query (test pilnuje kompletności). Dopisać klucze hubu do reguł event.registration._, club_member.changed.v1 i subscription._, żeby zmiany działały w obie strony.
- **AdminCatalogListState** (`src/components/admin/molecules/AdminCatalogListState.tsx`): Wspólne stany ładowania, błędu i pustki dla tabel hubu (jak tabela sponsorów w SponsorReportPanel).
- **adminPageHead** (`src/lib/adminPageHead.ts`): Wymagany przez AGENTS.md head dla nowych tras hubu (sekcja + opis, noindex).

### Punkty integracji

- [hub->moduł] Wiersz 'Ścieżki komunikacji' z listą journeys wyzwalanych przez zgłoszenia TEGO wydarzenia i linkiem do edytora ścieżki: src/components/admin/events/organisms/EventCommunicationsPanel.tsx:228-239 (obok drogowskazu do /admin/newsletter/campaigns)
- [hub->moduł] Drogowskaz 'Przychód i lejek wydarzenia' do dashboardu hubu z filtrem eventId: src/components/admin/events/organisms/EventAnalyticsPanel.tsx:205-239 (wzorzec wierszy ads-funnel, sponsor-report, siteTraffic)
- [hub->moduł] Kafel 'Aktywne ścieżki: N' i/lub 'Przychód' na pulpicie wydarzenia: src/components/admin/events/organisms/EventOverviewPanel.tsx:102-119
- [moduł->hub] Głębokie linki hubu do sekcji studia (overview, analytics, ads-funnel, registration/*, communications, meetings/stats, onsite/stats, onsite/leads) z bramką funkcji: src/lib/events/eventStudioNav.ts:104-146 + src/lib/events/eventFeatures.ts:248
- [moduł->hub] Link do raportu sponsora z filtrem sponsora: /admin/events/$eventId/sponsor-report?sponsor=<uuid> (src/routes/admin.events_.$eventId.sponsor-report.tsx:37-42)
- [moduł->hub] Lista wydarzeń z filtrem z hubu: /admin/events/list?tab=&q=&t=&f=&page=&size= (src/lib/events/eventListSearch.ts:43-56)
- [moduł->hub] Lejek wydarzenia (visits→starts→checkout→registrations→paid, revenue, cost) jako źródło mapy lejka i ROAS w hubie: src/lib/events/useEventAdsFunnel.ts:38-56, RPC admin_event_ads_funnel (src/lib/events/adsFunnelApi.ts:227)
- [obie] Liczniki zgłoszeń i miejsc per wydarzenie (wspólny wpis cache z Overview/Analytics): src/lib/events/useEventRegistrations.ts:71-89,129-139 (registrationKeys.counts)
- [moduł->hub] Przekrój wydarzeń z cenami, progiem planu i obłożeniem do macierzy benefitów i polityki cenowej: RPC admin_events_list (src/integrations/supabase/types.ts:27818-27847) przez adminEventKeys.list (src/lib/events/useAdminEvents.ts:32-35)
- [obie] Edycja progu planu wydarzenia i biletu z macierzy benefitów przez te same RPC, plus link zwrotny z pola: src/components/admin/events/organisms/EventRegistrationSettingsPanel.tsx:243-251 (registrationSettingsDraft.ts:453-454), src/components/admin/events/molecules/EventTicketDialog.tsx:425
- [obie] Próg planu klubu (min_tier_rank) w macierzy benefitów, edycja przez admin_club_upsert, link zwrotny z zakładki Dostęp: src/components/admin/clubs/organisms/ClubAccessTab.tsx:107-108, src/lib/clubs/api.ts:203
- [hub->moduł] Odnośnik 'zautomatyzuj jako ścieżkę' przy jednorazowej kampanii zaproszeń segmentowych: src/components/admin/clubs/organisms/ClubInvitationsTab.tsx:260 (ClubSegmentCampaign)
- [moduł->hub] Głęboki link do zakładki edytora klubu: /admin/community/clubs/$clubId?tab=analytics|members|invitations|access|moderation (src/routes/admin.community.clubs.$clubId.tsx:67-69, src/lib/clubs/clubEditorTabs.ts:14-24)
- [obie] Wskaźnik ścieżki dla zgłoszeń do klubu i link do skrzynki: src/components/admin/clubs/organisms/ClubApplicationsInbox.tsx (filtry w useState :58-60), /admin/community/clubs/applications
- [hub->moduł] Zastąpienie zdublowanej karty 'Subskrypcje i warstwy' linkiem albo kafelkiem z hubu; top wydarzeń kierować do studia, nie na publiczny /events/$slug: src/routes/admin.community.engagement.tsx:97-114 i :194-200
- [hub->moduł] Zdrowie runnera journeys (nowy job) w panelu harmonogramu: src/lib/jobs/scheduler.ts:22-44 (SCHEDULER_JOBS) + src/components/admin/community/SchedulerHealthPanel.tsx:96
- [obie] Wyzwalacze journeys z szyny zdarzeń domenowych i unieważnianie kluczy hubu: src/lib/realtime/domainEvents.ts:48,75,112,117,130 + src/lib/realtime/eventInvalidationMap.ts:168-198,234-239
- [obie] Etap CRM w journeys spójny z mostem wydarzeń (intencje event:<slug>:registration|checkin|cfp|invoice|sponsor_lead) i osią czasu event.*: supabase/migrations/20260927001400_event_person_crm_intents.sql:9-14, src/lib/crm/eventActivity.ts:1-28
- [moduł->hub] Istniejące linki CRM→studio (wzorzec dla linków hub→studio): src/components/admin/crm/CrmEventActivityLink.tsx:27-29, src/components/admin/crm/CompanySponsorshipsCard.tsx:84
- [hub->moduł] Pozycja hubu w nawigacji obok grup events i community: src/lib/admin/adminNav.ts:345-366, :393

### Ograniczenia i bramki

- Nie dublować stanu: hub woła te same hooki z IDENTYCZNYMI argumentami (np. registrationKeys.counts z pełnym obiektem nulli, onsite poll=false, useAdminClubs({limit:200})), bo inny kształt argumentu to inny wpis cache.
- Kreska, nie zero: wszystkie panele (EventAnalyticsPanel.tsx:10-18, AdminMetricTile '-', AdminBiStrip trzy stany) rozróżniają 'nie wiem' od 0; hub musi przyjąć tę samą regułę i nie pokazywać danych demonstracyjnych.
- Studio wydarzeń jest tylko dla admina (assert_event_admin_tenant), lista wydarzeń dla admin/editor (assert_editor_tenant), kluby wyłącznie dla admina (useAuth().isAdmin w admin.community.clubs.*). Hub musi bramkować sekcje tak samo, bez zgadywania z isStaff.
- AdminBiStrip widzi tylko rola 'admin' (nie super_admin), z tenantem w kluczu ['admin-analytics', tenantId, …] (src/lib/analytics/queryKeys.ts). Klucze BI hubu muszą zawierać tenant.
- Linki do sekcji studia bramkować eventFeatureHidingSection, np. sponsorReport znika z wyłączonym 'sponsors' (src/lib/events/eventFeatures.ts:198).
- validateSearch i head jadą w chunku wejściowym (komentarze w admin.events_.$eventId.sponsor-report.tsx:15-20 i clubEditorTabs.ts:4-9); parsery searcha hubu trzymać w lekkich liściach, pilnuje tego scripts/check-bundle-size.ts.
- Nowe trasy hubu: head przez adminPageHead (AGENTS.md); engagement i notifications tego dziś nie robią.
- ChartCard importuje i18n-admin-analytics jako efekt uboczny (ClubInsights.tsx:9-14): tylko w panelu admina, nie na trasach produktowych.
- Journeys nie mogą wysyłać drugi raz wiadomości systemowych wydarzeń (event_reminder, session_reminder, waitlist__, transfer__, survey_invite, certificate_ready - participantDeliveryKinds.ts:16-28) ani dublować e-maili zgłoszeń klubowych (applicationNotify.functions.ts:16-26); dedupe idzie przez event_message_deliveries.
- Kanały push i digest mają preferencje użytkownika (notification_preferences.email_digest, push_subscriptions); journeys muszą je respektować, a liczniki notifications liczyć z tych samych tabel.
- Zapisy z hubu wolno robić wyłącznie przez istniejące RPC (admin_event_* save, admin_club_upsert), żeby zadziałały istniejące unieważnienia (useDetailInvalidation, clubUpsertedKeys) i zdarzenia domenowe.
- Każdy nowy typ zdarzenia domenowego wymaga reguły w eventInvalidationMap (test kompletności) i literalnych nazw RPC/tabel z grantami pod bramkę generate:ts-sql-contract (AGENTS.md).

### Braki

- Brak zdarzenia domenowego dla zgłoszeń do klubów (świadomie, supabase/migrations/20260811150000_discussion_clubs_a35_applications_fixes.sql:38-44). Wyzwalacz 'zgłoszenie do klubu' w journeys wymaga emit_domain_event w club_apply_submit / admin_club_application_set_status albo odczytu z crm_leads.
- Brak przekrojowych RPC: przychód i lejek wszystkich wydarzeń (admin_event_ads_funnel działa per wydarzenie) oraz statystyki wszystkich klubów (admin_club_stats wymaga club_id). Hub musiałby agregować N zapytań albo dostać nowe RPC.
- Filtry list nie są w URL: lista zgłoszeń wydarzenia (RegistrationsListPanel.tsx:182-186), lista klubów (admin.community.clubs.index.tsx:52-65) i skrzynka zgłoszeń klubowych (ClubApplicationsInbox.tsx:58-60). Głębokie linki typu '?status=pending' wymagają validateSearch.
- get_engagement_overview nie liczy aktywności w klubach ani event_registrations, tylko stare event_rsvps (20260713099000_engagement_overview.sql:31-56), więc rozjedzie się z liczbami studia i hubu.
- Karta subskrypcji i warstw w /admin/community/engagement dubluje KPI hubu i nie ma delty ani benchmarku; lista top wydarzeń prowadzi na publiczną stronę zamiast do studia.
- Pięć lokalnych komponentów kafla (Metric x2, Stat x2, StatCard) i lokalny KpiTile w AdminBiStrip kolidujący nazwą z BI KpiTile, bez wspólnego wzorca.
- Próg planu wydarzenia i biletu edytowany jako surowa liczba rangi (EventRegistrationSettingsPanel.tsx:243-251, EventTicketDialog.tsx:425), a w klubach jako wybór planu (ClubAccessTab.tsx:107, planTiers.ts). Macierz benefitów wymaga jednego słownika rang i planów.
- Brak jakiegokolwiek modelu journeys (grep 'journey|automation' w events i clubs pusty); ClubSegmentCampaign to tylko jednorazowa wysyłka bez harmonogramu i kroków.
- Dziennik doręczeń istnieje tylko per wydarzenie (event_message_deliveries / admin_event_message_delivery_stats); brak wspólnego dziennika doręczeń dla kroków journeys i komunikacji klubowej.
