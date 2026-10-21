# Pakiet I9-1 - zadania cykliczne i silnik ścieżek w `jobs-tick` (Z-S5-03)

Stan: gałąź PR #530 (`4b1aa96d3`). Tylko odczyt. Źródła: PROMPT_KONTYNUACJI §9.1 (kryterium 1),
SPEC `docs/SPEC_MODUL_PRZYCHOD_LEJEK_2026-10-18.md` §4.6 (l. 599-611), dziennik §20.4-20.5 (S5),
§16.4 (S2), §21.21 (retencja I9c-X2), rejestr RODO l. 26-45, 145.

## 0. Kryterium (PROMPT §9.1, SPEC §4.6)

```
jobsTick: krok `journeys` (runJourneysTick(admin, { deadlineAt, ingestLimit: 200, claimLimit: 50 }))
przed drenem poczty z terminem 3 s; skanery S2 co 5 min; journey_rollup_daily co godzinę,
journey_purge('30 days') raz na dobę (karta retencji przestaje pokazywać „Harmonogram
w przygotowaniu"); SCHEDULER_JOBS, scheduler.yml, scheduler-tick.mjs, SchedulerHealthPanel
ze stanem silnika i JOURNEYS_ENGINE_DISABLED; testy jobsTickRun.test.ts, scheduler.test.ts,
-jobs-tick.test.ts zielone. (Z-S5-03)
```

SPEC §4.6 (tabela kroków, l. 603-609):

| Krok | Kiedy | Pozycja | Termin | Wywołanie |
|---|---|---|---|---|
| `journeys` | co tick | po zadaniach uczestnika, PRZED `drainEmailQueues` | `JOURNEYS_DEADLINE_MS = 3_000` | `runJourneysTick(admin, { deadlineAt, ingestLimit: 200, claimLimit: 50 })` |
| `revenueLifecycle` | `everyNthMinute(5)` | po drenie | budżet ticku | `admin.rpc("run_revenue_lifecycle_scanner")` (literał) |
| `retentionFlow` | `everyNthMinute(5)` | po drenie | budżet ticku | `admin.rpc("run_retention_flow_scanner")` |
| `journeysRollup` | `everyNthMinute(60)` | po drenie | budżet ticku | `admin.rpc("journey_rollup_daily")` |
| `journeysPurge` | raz na dobę (03:xx) | po drenie | budżet ticku | `admin.rpc("journey_purge", { p_older_than: "30 days" })` |

SPEC l. 611: `JobsTickResult += journeys, revenueLifecycle, retentionFlow`; `SCHEDULER_JOBS += "journeys", "revenue-lifecycle"`;
`scheduler.yml`, `scheduler-tick.mjs`, `SchedulerHealthPanel.tsx`; testy `jobsTickRun`, `jobsTickDutyCycle`, `scheduler`.
SPEC K-06/N20 (l. 24, 76): skanery = czyste SQL wołane LITERAŁEM z `jobsTick` (bez nowych plików TS service-role).
SPEC l. 360: brak nowych zadań `pg_cron`.

## 1. Mapa plików (stan obecny)

| Plik | Linie | Rola |
|---|---|---|
| `src/routes/api/public/jobs-tick.ts` | 1-54 | POST; limiter 10/0,5 s (l. 13); `x-jobs-secret` vs `job_runner_settings.secret` (`enabled`, id=1) przez `secretsEqual`; `runJobsTick(supabaseAdmin, { source: normalizeSchedulerSource(x-cron-source ?? "pg_cron") })`; 200 JSON `no-store`. Importy server-only WYŁĄCZNIE dynamiczne (l. 22, 30). |
| `src/lib/server/jobsTick.server.ts` | 557 | dyspozytor `runJobsTick` (l. 285-520), `JobsTickResult` (l. 36-156), `JobsTickMeta` (l. 159-164), `everyNthMinute` (l. 269), `isDataRetentionWindow` (l. 281), `secretsEqual` (l. 552). **Plik współdzielony** (HUB_SHARED_FILES). Brak pliku `jobsTickRun*.ts` - test nazywa się tak, kod jest w `jobsTick.server.ts`. |
| `src/lib/server/journeysRunner.server.ts` | 452 | runner S5 `runJourneysTick` - NIEPODPIĘTY (Z-S5-03). W manifeście I9 (hubDelivery l. 949). |
| `src/lib/server/jobScheduler.server.ts` | 186 | `recordJobRun` (RPC `record_job_run`, best-effort), `ensureJobRunnerArmed`, `readSchedulerHeartbeat`, `countPendingPush`. |
| `src/lib/jobs/scheduler.ts` | 146 | moduł CZYSTY: `SCHEDULER_JOBS` (l. 22-44), `SCHEDULER_SOURCES` (l. 49), `schedulerFreshness` (l. 67), `parseSchedulerJob` (l. 88), `normalizeSchedulerSource` (l. 100), `countTickFailures` + `SKIPPED_ERRORS` (l. 136-146). **Współdzielony.** |
| `src/routes/api/public/community-cron.ts` | 339 | siatka: `runJobs(job)` (l. 146-251) - jedyny konsument `SCHEDULER_JOBS`; GET sonda (l. 258-288); POST (l. 290-336). Wołany przez pg_cron (`invoke_community_cron`, co 5 min, minuty 2,7,12…, `?job=all` - biała lista w SQL `20260731210000` l. 240-245) i GitHub Actions. **NIE w manifeście I9.** |
| `.github/workflows/scheduler.yml` | 234 | cron `*/5` (4 ticki × 60 s do community-cron) i `25 5 * * *` (billing-cron); `workflow_dispatch.inputs.job.options` l. 56-76. **Współdzielony.** |
| `scripts/scheduler-tick.mjs` | 262 | sterownik HTTP (Node, bez zależności); lista jobów w nagłówku l. 25-29; `summarize(payload)` l. 134-201 (linie per job). **Współdzielony.** |
| `src/components/admin/community/SchedulerHealthPanel.tsx` | 531 | panel na `/admin/community/notifications` (`src/routes/admin.community.notifications.tsx` l. 16, 53). **Współdzielony.** |
| `src/lib/admin/scheduler.functions.ts` | 304 | `getSchedulerHealth` (l. 181-274, `requireAdminEditor`, RPC `job_scheduler_health` klientem sesji), `runSchedulerTickNow` (l. 281-304). **NIE w manifeście I9.** |
| `src/lib/i18n-admin-scheduler.ts` | 281 | słownik `adminScheduler.*` PL/EN (osobny bundel, `ensureI18n`). **NIE w manifeście I9.** |
| `src/lib/tracker-admin.functions.ts` | l. 6-43 | drugi ręczny tick (`runTrackerTickNow`, `requireStaff`) - też zwraca `JobsTickResult`. |
| `src/lib/privacy/dataRetention.ts` | l. 184-194, 231-237 | `DATA_RETENTION_EXISTING`: `journey_inbox` ma `schedule: "pending"` - źródło etykiety „Harmonogram w przygotowaniu". |

## 2. Dyspozytor `runJobsTick` - kolejność, budżety, bramki

Stałe (`jobsTick.server.ts`): `JOBS_TICK_DEADLINE_MS = 25_000` (l. 171), `EMAIL_DRAIN_DEADLINE_MS = 10_000` (l. 179),
`PARTICIPANT_JOBS_DEADLINE_MS = 6_000` (l. 186, eksport), `EMAIL_DRAIN_MIN_WINDOW_MS = 4_000` (l. 194),
`TICKET_CODES_DEADLINE_MS = 18_000` (l. 203), `TICKET_REVOCATIONS_DEADLINE_MS = 20_000` (l. 210),
`WEBHOOK_SWEEP_WINDOW_MS = 8_000` (l. 220), `WEBHOOK_SWEEP_TAIL_RESERVE_MS = 2_000` (l. 238), `WALLET_REVOCATIONS_DEADLINE_MS = 22_000` (l. 246).

Mechanizmy do reużycia:
```ts
async function runJobStep<T>(overBudget: () => boolean, fn: () => Promise<T>): Promise<T | { error: string }>  // l. 250
// over budget -> { error: "skipped_time_budget" }; throw -> { error: message }
const skipped = { error: "skipped_duty_cycle" } as const;            // l. 292
export function everyNthMinute(n: number, now = new Date()): boolean  // l. 269: getUTCMinutes() % n === 0
export function isDataRetentionWindow(now = new Date()): boolean      // l. 281: UTC 2:07..2:57 co 10 min
const tickTime = new Date(startedAt);  // l. 290 - JEDEN zegar ticku dla bramek (regresja D1 w teście)
```

Kolejność dziś (l. 297-469) i bramka:
1. `newsletter` (co tick) → 2-4. `eventParticipantReminders`, `eventTicketLifecycle`, `eventFollowUp` (`await import`, `deadlineAt: startedAt + 6_000`) →
5. **`emailQueue`** l. 319-327: `drainEmailQueues(admin, { maxMessages: 60, deadlineAt: Math.max(startedAt + EMAIL_DRAIN_DEADLINE_MS, Date.now() + EMAIL_DRAIN_MIN_WINDOW_MS) })` →
6. `push` (100) → 7-8. `digestDaily/Weekly` (5 min) → 9. `eventReminders` → 10. `crmTaskReminders` → 11. `eventTicketCodes` (20, 18 s) →
12. `eventTicketRevocations` (20, 20 s) → 13. `webhookSweep` (5 min) → 14. `walletPassRevocations` (22 s) → 15. `linkCheck` (15 min) →
16. `integrations` → 17. `semanticIndex` (5 min) → 18. `profileIndex` (15 min, prune 60) → 19. `clubThreadIndex` (15, prune 60) →
20. `clubScheduler` (5 min, `admin.rpc("club_scheduler_tick")`) → 21. **`dataRetention`** (okno nocne, OSTATNI).
Potem `countTickFailures(result)` + `recordJobRun({ source, job: "all", ok, durationMs, result, error, tenantId, actorId }, admin)` w `try` (l. 500-517).

**Wzór podpięcia zadania SQL z I9c (`dataRetention`, l. 449-469) - do skopiowania dla skanerów/rollupu/purge:**
```ts
const dataRetention = isDataRetentionWindow(tickTime)
  ? await runJobStep(overBudget, async () => {
      const { data, error } = await admin.rpc("data_retention_run", { p_limit: DATA_RETENTION_RULES.batchDefault });
      if (error) {
        const { isMigrationPending } = await import("@/lib/supabase/migrationPending");
        if (isMigrationPending(error)) return { tenants: 0, more: false, skipped: "migration_pending" as const };
        throw error;
      }
      const row = (data ?? {}) as Record<string, unknown>;
      return { tenants: typeof row.tenants === "number" ? row.tenants : Number(row.tenants ?? 0), more: row.more === true };
    })
  : skipped;
```
`isMigrationPending` (`src/lib/supabase/migrationPending.ts` l. 14-20): kody `PGRST202`, `42883`. Typ pola: `dataRetention: { tenants: number; more: boolean; skipped?: "migration_pending" } | { error: string }` (l. 154-155).

## 3. Runner ścieżek `runJourneysTick` (`src/lib/server/journeysRunner.server.ts`)

```ts
export const JOURNEYS_DEADLINE_MS = 3_000;                 // l. 55
export const JOURNEYS_BACKLOG_DEFER_MINUTES = 5;           // l. 57
export const JOURNEYS_CAP_DEFER_MINUTES = 1;               // l. 59
export const JOURNEYS_REPUTATION_DEFER_MINUTES = 60;       // l. 61
export const JOURNEYS_MAX_STEPS = 25;                      // l. 63
export interface JourneysTickOptions { deadlineAt?: number; ingestLimit?: number; claimLimit?: number }  // l. 65-69
export interface JourneysTickCounts { ingested; enrolled; advanced; emailsQueued; deferred; failed; journeysTouched }  // l. 71-79 (number)
export type JourneysTickResult = JourneysTickCounts | { error: string };  // l. 81
export async function runJourneysTick(supabaseAdmin: DbClient, opts: JourneysTickOptions = {}): Promise<JourneysTickResult>  // l. 161
```
- l. 165: `if (process.env.JOURNEYS_ENGINE_DISABLED === "1") return { error: "disabled" };` - BEZ dostępu do bazy.
- l. 168: `deadlineAt = opts.deadlineAt ?? Date.now() + JOURNEYS_DEADLINE_MS`; termin blokuje START nowej pracy (claim, kolejne zapisy, maile), RPC w toku może go przekroczyć.
- Kolejność RPC (wszystkie service_role, najemca z wiersza): `journey_ingest_inbox(p_limit = ingestLimit ?? 200)` (l. 186) → `journey_claim_due(p_limit = claimLimit ?? 50, p_lease_seconds = 120)` (l. 203) → per zapis `journey_advance(p_enrollment_id, p_lock_token, p_max_steps=25)` → `email_queue_depth` (zaległość `transactional_emails > 120` ⇒ odłóż 5 min) → `evaluateSendGate` raz na najemcę → `journey_can_send` → `journey_contact_for_send` → `enqueueRawEmail` (klucz `journey:{zapis}:{węzeł}`) → `journey_complete_email_step` / `journey_fail_step` → `journey_tick_emit_stats(p_journey_ids, p_counts)`.
- Limity `src/lib/journeys/limits.ts` l. 57-62: `JOURNEY_ENGINE_LIMITS = { emailsPerTick: 20, queueBacklogMax: 120, enrollmentsPerTenantPerTick: 20, claimLeaseSeconds: 120 }`.
- Błędy RPC NIE rzucają: tylko `counts.failed += 1` + `console.error` (l. 187-189, 207-210). Rzut możliwy z `renderJourneyEmail` (nie-`JourneyRenderError`, l. 393) i z `enqueueRawEmail` → łapie `runJobStep`.
- `journey_claim_due` = `FOR UPDATE SKIP LOCKED` + dzierżawa 120 s (`20261020140100` l. 163-209) → równoległe wywołania (jobs-tick + community-cron) bezpieczne.
- Górne importy runnera: `messageId`, `reputationGate.server`, `transactional.server`, `http/host`, `journeys/limits`, `journeys/render.server`, `journeys/variables` → w `jobsTick` tylko `await import(...)` (wzorzec zadań uczestnika, pilnuje `-jobs-tick.test.ts` l. 931-958).
- Przełącznik najemcy `journey_settings.enabled` (domyślnie false) działa w SQL; zapisy testowe (`is_test`) wykonują się mimo wyłączonego silnika (M3, dziennik §20.9 pkt 7) - po podpięciu „Test na sobie" zacznie realnie wysyłać.
- Test: `src/lib/server/__tests__/journeysRunner.server.test.ts` (497 l.; m.in. „awaryjny wyłącznik: bez dostępu do bazy" l. 152, „termin ticku" l. 476).

## 4. Funkcje SQL do podpięcia (najnowsze definicje, granty)

| Funkcja | Najnowsza definicja (do `-- CIALO-Z`) | Sygnatura / wynik | Granty |
|---|---|---|---|
| `run_revenue_lifecycle_scanner()` | `20261020110500_revenue_lifecycle_scanner.sql` l. 52-222 | `RETURNS jsonb` `{trial_ending, expired, dunning_lost, snapshots}`; VOLATILE SECURITY DEFINER; partie LIMIT 500/rodzaj; znaczniki `revenue_event_marks` (idempotencja) | REVOKE PUBLIC, anon, authenticated; EXECUTE `service_role` |
| `run_retention_flow_scanner()` | `20261020110600_retention_flow_events.sql` l. 114-147, granty l. 234-235 | `RETURNS jsonb` `{abandoned}`; `retention_feedback.outcome` `started` > 24 h → `abandoned` (LIMIT 1000) + `revenue_event_marks` | jw. |
| `journey_rollup_daily()` | **`20261020161000_data_retention_core.sql` l. 528-542** (`-- CIALO-Z: 20261020140500`); pierwotna `20261020140500` l. 612-689 | `RETURNS integer` (wiersze upsertu); woła `_journey_rollup_days(NULL, today-7, today)`, dni zapieczętowane retencją pomijane | REVOKE PUBLIC, anon, authenticated; `service_role` |
| `journey_purge(p_older_than interval DEFAULT interval '30 days')` | `20261020140100_journeys_engine.sql` l. 681-704 | `RETURNS jsonb` `{inbox, errors}`; okno min. 7 dni; `journey_event_inbox` przetworzone < now()-okno, `journey_engine_errors` < now()-max(okno, 90 dni) | REVOKE PUBLIC, anon, authenticated; `service_role` |
| `data_retention_run(p_limit)` | `20261020161100_data_retention_executor.sql` | `{tenants, more, batch_limit}` | `service_role` |
| `admin_journey_engine_health()` | `20261020140400_journeys_admin_tools.sql` l. 378-435 | jsonb: `enabled, journeys_active, inbox_pending, inbox_oldest_at, last_ingest_at, due_now, active, waiting, locked, last_step_at, failed_24h, dead_steps_24h, messages_24h, errors_24h{phase:n}, last_errors[]`; STABLE; bramka `_journey_staff_tenant(false)` = admin/editor/super_admin, najemca `current_tenant_id()` | EXECUTE `authenticated, service_role` |

Typy (`src/integrations/supabase/types.ts`): `run_revenue_lifecycle_scanner: { Args: never; Returns: Json }` (l. 35527), `run_retention_flow_scanner` (l. 35526),
`journey_rollup_daily: { Args: never; Returns: number }` (l. 34389), `journey_purge: { Args: { p_older_than?: unknown }; Returns: Json }` (l. 34367), `data_retention_run` (l. 32673).
Wszystkie istnieją → **I9-1 nie wymaga migracji SQL.**

Bramka `generate:ts-sql-contract` (`src/lib/ci/tsSqlContract.ts`): nazwa RPC i klucze argumentów muszą być LITERAŁAMI (`.rpc("journey_purge", { p_older_than: "30 days" })`); odbiorca `admin` (parametr) ma rolę `unknown` (tylko `supabaseAdmin`/aliasy = `service_role`, l. 277, 350-363) - tak jak dziś `club_scheduler_tick`/`data_retention_run`.

## 5. Retencja (I9c-X2) i karta „Harmonogram w przygotowaniu"

- Dziennik §21.21 pkt 3 (l. ~3815-3830): wybór `jobs-tick`, krok `dataRetention` OSTATNI, okno 02:07-02:57 UTC co 10 min (6 szans/dobę), istniejące czyszczenia `pg_cron` 03:20-03:53 UTC (nie przenosić). §21.21 l. ~3879-3883: „Skrzynka ścieżek (`journey_purge`, 30 dni) i rollup ścieżek - funkcje są, harmonogram podpina I9; karta pokazuje „Harmonogram w przygotowaniu". Pieczęć retencji woła ten sam `_journey_rollup_days`, więc nie czeka na I9."
- `src/lib/privacy/dataRetention.ts` l. 184-194 (komentarz + typ) i l. 231-237:
```ts
readonly schedule: "pg_cron" | "pending" | "none";   // l. 193
{ key: "journey_inbox", mechanism: "journey_purge", source: "20261020140100",
  periodLiteral: "interval '30 days'", schedule: "pending" },   // l. 232-238
```
- Render: `src/components/admin/settings/dataRetention/DataRetentionCard.tsx` l. 370-372 `t(\`adminDataRetention.existing.schedule.${item.schedule}\`)` (Badge).
- i18n `src/lib/i18n-admin-data-retention.ts`: PL l. 187-191 `schedule: { pg_cron: "Zadanie bazy (pg_cron)", pending: "Harmonogram w przygotowaniu", none: "Bez usuwania" }`; EN l. 443-447 (`"Database job (pg_cron)"`, `"Schedule being prepared"`, `"No deletion"`). Prefiks `adminDataRetention` jest BRAMKOWANY w `src/__tests__/i18nParity.gate.test.ts` l. 49 (parytet PL/EN).
- `adminDataRetention.schedule.window` (PL l. 44-48, EN l. 310-314) już opisuje okno nocne i „panel zdrowia harmonogramu".
- Test parytetu `src/lib/privacy/__tests__/dataRetentionParity.test.ts` l. 126-139: dla każdej pozycji `DATA_RETENTION_EXISTING` sprawdza `periodLiteral` i `FUNCTION public.<mechanism>(` w migracji `source` - zmiana samego `schedule` go nie rusza. Żaden test nie asertuje dziś napisu „Harmonogram w przygotowaniu" (grep pusty).
- Co ją zmienia: wartość `schedule` pozycji `journey_inbox`. Po podpięciu purge → nowa wartość (np. `"jobs_tick"`) + klucz i18n PL/EN + rozszerzenie unii; `"pending"` zostaje bez użytkownika (usunąć z unii i słownika albo zostawić - decyzja; usunięcie wymaga parytetu w obu językach).
- Rejestr RODO `docs/RODO_REJESTR_CZYNNOSCI_HUB_2026-10.md` l. 145: „skrzynka ścieżek - 30 dni … (`journey_purge`, minimum 7; harmonogram podpina I9)" → zaktualizować.

## 6. `SCHEDULER_JOBS`, community-cron, workflow, sterownik

- `SCHEDULER_JOBS` (l. 22-44): `all, push, digest-daily, digest-weekly, event-reminders, crm-task-reminders, career-cv-retention, event-ticket-codes, event-participant-reminders, event-ticket-lifecycle, event-follow-up, event-wallet-passes`. Komentarz l. 21: „Joby przyjmowane przez /api/public/community-cron" → **każdy nowy job wymaga gałęzi w `community-cron.ts` `runJobs`** (inaczej `?job=journeys` da 200 bez pracy).
- `runJobs` (community-cron l. 146-251): `step(key, fn)` z budżetem `COMMUNITY_CRON_DEADLINE_MS = 25_000` (l. 131), `PARTICIPANT_JOBS_DEADLINE_MS = 10_000` (l. 139); klient przez `await import("@/integrations/supabase/client.server")`. Ta ścieżka NIE drenuje poczty (maile ścieżek z community-cron czekają na dren `jobs-tick`).
- `invoke_community_cron` (pg_cron, `20260731210000` l. 240-245) woła `?job=all` co 5 min → wszystko, co wejdzie do `all`, biegnie DODATKOWO co 5 min z bazy.
- `scheduler.yml` l. 56-76: `options` (`- <job>` w osobnej linii; test regexem `\n\s+- ${job}\n`); cron `*/5` → community-cron `job=all`, 4 ticki; `25 5 * * *` → billing-cron.
- `scripts/scheduler-tick.mjs`: dokumentacja `SCHEDULER_JOB` l. 25-29; `summarize()` l. 134-201 - linie tylko dla znanych pól (push, digesty, eventReminders, crmTaskReminders, eventTicketCodes, eventTicketRevocations, walletPassRevocations, eventPlanSeatRelease); nowe pola bez linii = „brak pracy w kolejce".
- Kontrakt źródeł: `SCHEDULER_SOURCES` = CHECK `job_runner_runs.source` (`20260731110000` l. 86-87); kolumna `job text NOT NULL DEFAULT 'all'` BEZ CHECK (nowe nazwy jobów nie wymagają migracji); `result jsonb` bez PII (liczniki), rotacja 14 dni.

## 7. Panel zdrowia (`SchedulerHealthPanel`)

- Trasa `/admin/community/notifications`; widoczność `isAdmin || roles.includes("editor")` (l. 92); `useQuery(["admin","scheduler-health"], getSchedulerHealth, refetch 30 s, retry false)` (l. 94-103); przycisk „Uruchom tick teraz" → `runSchedulerTickNow` → toast z `countTickFailures(result)` (l. 105-120).
- Warstwy: świeżość + alerty (`appUnreachable`, `stale`, VAPID, poczta, runner nieuzbrojony, backlog > 25), kafelki kolejki push/digestów (`AdminMetricTile`), karta runnera (`adminScheduler.runner.*`: enabled, secret, pg_cron/pg_net, base_url, ostatnie puknięcie, siatka community-cron, failureStreak, lastError, env), karta `adminScheduler.cron.*` (zadania pg_cron + źródła 24 h z `HeartbeatDot`), tabela `adminScheduler.runs.*` (ostatnie przebiegi: kiedy, źródło, job, czas, wynik/błąd). Wyników per job z `job_runner_runs.result` panel NIE pokazuje (RPC `recent_runs` nie zwraca `result`).
- `SchedulerHealth` (scheduler.functions l. 106-120): `runner, capabilities, appUnreachable, cronJobs, recentRuns, sources, queue, env, freshness, observedAt` - brak pola silnika ścieżek.
- Stan silnika dziś: wyłącznie `getJourneyEngineHealth` (`src/lib/journeys/journeys.functions.ts` l. 184-191, `requireCrmStaff`, RPC `admin_journey_engine_health` + `journeysKillSwitch()` l. 56-58 = `process.env.JOURNEYS_ENGINE_DISABLED === "1"`), DTO `JourneyEngineHealthDto` (`src/lib/journeys/dto.ts` l. 113-133, pole `killSwitch`), parser `parseEngineHealth(raw, killSwitch)` (`src/lib/journeys/parse.ts` l. 269), `journeyEngineHealthQueryOptions` (`queries.ts` l. 98-105), błędy „brak funkcji" → stan `unavailable` (`MISSING_SOURCE` l. 53). Słownik `adminJourneys.*.killSwitch` (`i18n-admin-journeys.ts` l. 245 PL, 561 EN). Żaden komponent w tej gałęzi jeszcze go nie renderuje (S8 w toku).
- S8 (gałąź `hub/s8-sciezki-panel-c`, worktree `/home/user/wt/S8`; łatka `docs/kontynuacja/s8/0001-…patch`): `src/lib/admin/journeys/summaries.ts` `engineHealthNotice()` zwraca `"scheduler_pending"` gdy `enabled && dueNow > 0 && lastStepAt === null` (komentarz „Z-S5-03 … kroki ruszą po podpięciu harmonogramu (I9)"), klucz `adminJourneys.engineStrip.notice.scheduler_pending` w `src/lib/i18n-admin-journeys-list.ts`, testy `JourneyEngineHealthStrip.test.tsx`, `summaries.test.ts`. Po podpięciu runnera ten stan i tekst „(I9)" stają się nieaktualne. S7/S8 nie dotykają plików harmonogramu (sprawdzone `git diff HEAD...<gałąź>`).

## 8. Testy - wzorce i co przypinają

**`src/lib/server/__tests__/jobsTickRun.test.ts`** (1379 l.; dyspozytor PRAWDZIWY, granice atrapowane):
- `vi.hoisted` `fixtures` (l. 104-143) i rejestr `jobs` (`run(step, args, value)`, `note`, `steps()`, `argsOf`, `failures`, `beforeStep`) (l. 154-188); `vi.mock` per moduł granicy (l. 202-293), dla dynamicznych importów też (`vi.mock` działa na `await import`). Atrapa `recordJobRun` = instrument (`scheduler.runs`, `scheduler.clients`).
- Stałe przypięć: `FULL_ORDER` (l. 335-360, 20 kroków bez `dataRetention`), `CRITICAL_SENDS` (l. 362), `NETWORK_COSTLY` (l. 378), `FIVE_MINUTE_JOBS` (l. 389), `FIFTEEN_MINUTE_JOBS` (l. 397), `EVERY_MINUTE_JOBS` (l. 399); `at(minute)` = 2026-09-04 **10**:mm UTC; `tickAt(minute, meta?)`; `slowJob(step, ms)` przez `advanceClock` (`@/test/time`).
- `beforeEach` (l. 488-506): `supabaseRpcStub()` z odpowiedzią TYLKO dla `club_scheduler_tick` (`jobs.note("clubScheduler", …)`); stub dla niezaplanowanej nazwy zwraca BŁĄD (`src/test/supabase/rpc.ts` l. 108-110: „test: brak zaplanowanej odpowiedzi dla RPC") → każde nowe RPC w minucie 0 bez `setResponse` = `{ error }` = `ok:false` w wielu testach.
- Testy, które pękną po dodaniu kroków: „pełny tick (minuta 0) wykonuje siedemnaście jobów…" (l. 516), „newsletter, zadania uczestnika i dren poczty są PIERWSZE" (l. 536, `slice(0, 6)`), „wynik każdego joba ląduje w SWOIM polu wyniku" (l. 559, pełny `toEqual`), „dyspozytor NIE dotyka tabel wprost - cała jego baza to jeden RPC" (l. 629: `expect(rpc.names()).toEqual(["club_scheduler_tick"])`), „minuta 3: biegną TYLKO joby co-minutowe" (l. 660), budżetowe z liczbą pominiętych („pomija szesnaście pozostałych", l. 771), „awaria zadania uczestnika…" (l. 972, `FULL_ORDER`).
- Sekcja retencji (l. 1326-1379) = gotowy wzór testów okna: `nightAt(minute)`, „poza oknem: RPC nie jest wołane…", „w oknie: … OSTATNIE w ticku" (`rpc.names().at(-1)`), „baza bez migracji (PGRST202): `migration_pending`", „inny błąd bazy: `{ error }` i przebieg zgłoszony jako awaria".
- Testy drenu (l. 915-1003): deadline drenu `startedAt + 10_000`, `slowJob("eventFollowUp", 8_000)` ⇒ `8_000 + 4_000` - krok `journeys` między follow-up a drenem nie może przesuwać zegara w atrapie (inaczej oczekiwania się zmienią).

**`src/lib/server/__tests__/jobsTickDutyCycle.test.ts`** (34 l.): `everyNthMinute` - miejsce na test nowej czystej bramki (np. okno purge).

**`src/lib/jobs/__tests__/scheduler.test.ts`** (191 l.): `parseSchedulerJob` - „przyjmuje każdy job z kontraktu" (l. 70), wzór joba z workflow i sterownikiem: „zna job przepustek Google Wallet (OPS-14) i workflow pozwala go uruchomić ręcznie" (l. 101-108: `SCHEDULER_JOBS` + regex w `scheduler.yml` + `scripts/scheduler-tick.mjs` `toContain`); `countTickFailures` (l. 156-191: pominięcia nie są awarią).

**`src/routes/api/public/-jobs-tick.test.ts`** (959 l.): atrapa `runJobsTick`; `tickResult(): JobsTickResult` (l. 245-287) - PEŁNY obiekt typu (nowe wymagane pola ⇒ błąd typów, nie testu - ten sam błąd złapał I9c: „pole dataRetention w ładunku -jobs-tick.test.ts"); `zPorazkami` (l. 825); granica server-only (l. 860-895, `importyGorne`); „dyspozytor: zadania uczestnika wchodzą leniwie, przed drenem poczty" (l. 931-958: `await import("<moduł>")` + kolejność pozycji w źródle przed `drainEmailQueues(admin`) - wzór na asercję runnera ścieżek.

Pozostałe dotknięte: `src/routes/api/public/-community-cron.test.ts` („`?job=all` uruchamia WSZYSTKIE kanały … w ustalonej kolejności" l. 956-998 - lista kroków i kluczy ładunku); `src/lib/admin/__tests__/schedulerFunctions.test.ts` (363 l.; „PEŁNY ładunek…" l. 171 - pełne mapowanie `SchedulerHealth`, atrapa `context.supabase.rpc`); `src/components/admin/community/__tests__/SchedulerHealthPanel.test.tsx` (303 l.; atrapa `@/lib/admin/scheduler.functions` l. 27); `src/lib/__tests__/i18nAdminScheduler.test.ts` (parytet kluczy PL/EN, brak pustych, ZAKAZ „—"); `src/lib/server/__tests__/journeysRunner.server.test.ts`; `src/routes/__tests__/adminCommunityNotificationsRoute.test.tsx`.

## 9. Dostawa huba (`src/lib/ci/hubDelivery.ts`) i dokumenty

- Blok wersji I9 = `2026102016` (l. 63); `HUB_SHARED_FILES` (l. 394-425) zawiera `scheduler.yml`, `scheduler-tick.mjs`, `SchedulerHealthPanel.tsx`, `jobs/scheduler.ts`, `jobsTick.server.ts`, `i18nParity.gate.test.ts`, `reports/i18n-parity.json`.
- Manifest I9 (l. 818-951) ma m.in. `jobsTickRun.test.ts`, `scheduler.test.ts`, `-jobs-tick.test.ts` (l. 822-824), `src/lib/privacy/**`, `dataRetention/**`, `i18n-admin-data-retention.ts`, `journeys/{render.server,dto,parse,journeys.functions}.ts`, `journeysRunner.server.ts` + test (l. 941-950), `docs/{RUNBOOK_HUB_PRZYCHOD_LEJEK,WDROZENIE_…}.md`.
- **Poza manifestem I9 (strażnik `bun run scripts/hub-slice-guard.ts I9 --base <sha>` zgłosi „plik spoza manifestu")**: `src/routes/api/public/community-cron.ts`, `-community-cron.test.ts`, `src/lib/admin/scheduler.functions.ts`, `src/lib/admin/__tests__/schedulerFunctions.test.ts`, `src/lib/i18n-admin-scheduler.ts`, `src/lib/__tests__/i18nAdminScheduler.test.ts`, `src/components/admin/community/__tests__/SchedulerHealthPanel.test.tsx`, `src/lib/server/__tests__/jobsTickDutyCycle.test.ts`, `docs/RODO_REJESTR_CZYNNOSCI_HUB_2026-10.md`, `docs/RUNBOOK_COMMUNITY.md`, `docs/KONTYNUACJA_…`, `.env.example`. Dopisać do manifestu I9 z komentarzem „(I9, 2026-10-xx) …" (wzór wpisów I9c l. 932-950).
- `docs/RUNBOOK_HUB_PRZYCHOD_LEJEK.md` NIE istnieje (tworzy I9; kryterium §9.1 ostatnie). `docs/RUNBOOK_COMMUNITY.md` l. 30-50 opisuje trzy wejścia harmonogramu i zakres `jobs-tick` - dopisać kroki huba.
- `JOURNEYS_ENGINE_DISABLED` nie ma w `.env.example` (jest tylko w dokumentach).
- Dziennik: podsekcja „I9 – integracja i wydanie" (Z-S5-03 → „Zamknięte (I9, §…)" w §20.5 l. ~2335; §21.21 l. ~3879 „karta pokazuje Harmonogram w przygotowaniu"); KONTYNUACJA l. 34, 61, 101-105.

## 10. Pułapki

1. **`{ error: "disabled" }` = awaria w logu.** `countTickFailures` pomija tylko `skipped_time_budget|skipped_duty_cycle` (`scheduler.ts` l. 136). Wyłącznik awaryjny dawałby `ok:false` co minutę, `failure_streak` i czerwony toast „Uruchom tick". Trzeba świadomie: dodać `"disabled"` do `SKIPPED_ERRORS` (z testem w `scheduler.test.ts`) albo mapować w kroku na `{ ...zera, skipped: "kill_switch" }`, a stan pokazać w panelu.
2. **Brak migracji S5 na produkcji** → RPC runnera zwracają PGRST202, runner NIE rzuca, liczy `failed` i loguje `console.error` co minutę; tick `ok:true`. Rozważyć `skipped: "migration_pending"` (np. sprawdzenie `isMigrationPending(ingest.error)` w runnerze - plik w manifeście I9) dla parytetu z `dataRetention`.
3. **Termin 3 s a dren poczty.** Krok `journeys` między zadaniami uczestnika (do 6 s) a drenem (`Math.max(startedAt+10 s, now+4 s)`) przesuwa dren w czasie; absolutne terminy biletów (18 s), odwołań (20 s), portfela (22 s) zostają. Ustalić formę `deadlineAt` (względna `Date.now() + 3_000` jak domyślna runnera vs przycięta do `startedAt + 6_000 + 3_000`) i przypiąć testem.
4. **Import stałej `JOURNEYS_DEADLINE_MS`** z runnera górnym importem łamie zasadę leniwego ładowania; brać ją z `await import(...)` (wtedy `vi.mock("@/lib/server/journeysRunner.server")` w `jobsTickRun.test.ts` musi eksportować też stałą) albo zdefiniować termin w dyspozytorze.
5. **Minuta 0 jest zatłoczona** (`everyNthMinute(60)` = minuta 0, gdy otwarte są wszystkie bramki 5/15/60). Dziennik §20.4: rollup „co godzinę (wolny pas)". Bramka na minucie, która nie jest wielokrotnością 5 (np. czysta funkcja `isJourneyRollupMinute`), omija tłok i nie zmienia przypięć testów minuty 0 (poza `rpc.names()` tylko jeśli rollup trafi w 0).
6. **Purge „raz na dobę (03:xx)"** (SPEC) - `pg_cron` czyści 03:20-03:53 UTC (inne tabele), retencja 02:07-02:57. Pojedyncza minuta (np. 03:07) = przy pominięciu ticku następna szansa za dobę (bezpieczne: okno 30 dni, minimum 7 w SQL); wzorzec 6 szans jak `isDataRetentionWindow` = 6 wywołań/dobę (idempotentne DELETE) - sprzeczne z „raz na dobę". Wybrać i opisać w komentarzu (DLACZEGO).
7. **community-cron `all`** jest wołany także przez pg_cron co 5 min. Dodanie `journeys`/skanerów do `all` = drugie źródło wywołań (bezpieczne dzięki SKIP LOCKED/znacznikom, ale bez drenu poczty i ze wspólnym budżetem 25 s; zmienia przypięcie `?job=all` w `-community-cron.test.ts`). Biała lista `invoke_community_cron` w SQL nie zna nowych nazw (pg_cron i tak woła `all`).
8. **Test `rpc.names()`** (jobsTickRun l. 629) i stub RPC zwracający błąd dla niezaplanowanych nazw - nowe RPC w `beforeEach` przez `rpc.setResponse(name, (call) => { jobs.note("<krok>", [call.name]); return ok(...) })`, inaczej kolejność kroków SQL jest niemierzalna, a `ok` spada.
9. **`JobsTickResult` jest interfejsem bez indeksu**: nowe pola wymagane ⇒ poprawić `tickResult()` w `-jobs-tick.test.ts` i oczekiwany obiekt w jobsTickRun l. 559; `tracker-admin.functions.ts` i `scheduler.functions.ts` zwracają ten typ (bez zmian kodu).
10. **Panel a bramki ról:** `getSchedulerHealth` = `requireAdminEditor`, `admin_journey_engine_health` = admin/editor/super_admin (`_journey_staff_tenant(false)`), `getJourneyEngineHealth` = `requireCrmStaff`. Odczyt silnika w `getSchedulerHealth` musi być odporny: błąd (42883/PGRST202/42501) nie może wywrócić całego zdrowia harmonogramu (dziś `if (error) throw` dla `job_scheduler_health`, l. 187-188). Stan silnika jest PER NAJEMCA, runner globalny.
11. **Budżet bundla (D-08)**: `public`/`chunk`/`boot` zamrożone. Import `@/lib/journeys/queries`/`journeys.functions` (zod, schematy) do `SchedulerHealthPanel` powiększy chunk panelu; tańsze: dociągnąć stan silnika serwerowo w `getSchedulerHealth` (dynamiczny import w handlerze) i rozszerzyć `SchedulerHealth` o pole `journeys`.
12. **i18n:** `adminScheduler` - osobny bundel z testem parytetu i zakazem „—"; `adminDataRetention` - prefiks bramkowany (raport `reports/i18n-parity.json` może się przepisać). Komentarze w kodzie po polsku, wyjaśniające DLACZEGO.
13. Rejestr przebiegów `job_runner_runs.result` trafia jako jsonb - wynik kroków ma być bez PII (same liczniki; `journeys` OK).
14. `everyNthMinute(n, tickTime)` - zawsze z `tickTime` (zegar startu), nie `new Date()` (regresja D1, testy l. 1267-1300).

## Rekomendacja wdrożenia

**Migracje:** brak (wszystkie RPC istnieją z grantem `service_role`). Najwyższa wersja dziś: `supabase/migrations/20261020161400_data_retention_panel.sql`, bliźniak `drizzle/migrations/0372_data_retention_panel.sql`; gałąź S7 doda `20261020150000…150100` (bez bliźniaków na dziś), I9d (krok 3) zajmie kolejne `2026102016…`/`0373+` - gdyby jednak I9-1 potrzebował SQL: wersja po najwyższej `ls supabase/migrations | grep ^2026102016 | tail -1`, bliźniak = następny wolny numer po `ls drizzle/migrations | tail`, `cp` bajt w bajt, wpis na końcu `_journal.json`, `bun run check:migration-lanes`.

**Kolejność zmian (jeden commit „hub(I9): …" lub dwa):**
1. `src/lib/server/jobsTick.server.ts`:
   - `JobsTickResult` += `journeys: JourneysTickResult` (lub z `skipped`), `revenueLifecycle: { trialEnding; expired; dunningLost; snapshots; skipped?: "migration_pending" } | { error }`, `retentionFlow: { abandoned; skipped? } | { error }`, `journeysRollup: { rows; skipped? } | { error }`, `journeysPurge: { inbox; errors; skipped? } | { error }` (komentarze JSDoc jak przy innych polach).
   - Krok `journeys` po `eventFollowUp`, przed `emailQueue`: `await runJobStep(overBudget, async () => { const { runJourneysTick, JOURNEYS_DEADLINE_MS } = await import("@/lib/server/journeysRunner.server"); return runJourneysTick(admin, { deadlineAt: Date.now() + JOURNEYS_DEADLINE_MS, ingestLimit: 200, claimLimit: 50 }); })`.
   - Skanery S2 (`everyNthMinute(5, tickTime)`, literały RPC, normalizacja liczników jak `clubScheduler`, `isMigrationPending` jak `dataRetention`) - po wysyłkach 1:1 (np. zaraz po `webhookSweep`, przed `walletPassRevocations`: DB-only, tanie, nie powinny być pierwszymi ofiarami budżetu) albo zgodnie z SPEC „po drenie" na końcu przed retencją - decyzja z uzasadnieniem.
   - `journeysRollup` (czysta bramka godzinowa, wolna minuta) i `journeysPurge` (czysta bramka dobowa, eksport jak `isDataRetentionWindow`) przed `dataRetention` (ta zostaje OSTATNIA).
   - Komentarz nagłówka l. 294-296 i wynik l. 471-493.
2. `src/lib/jobs/scheduler.ts`: `SCHEDULER_JOBS += "journeys", "revenue-lifecycle"` (SPEC) z komentarzem; ewentualnie `SKIPPED_ERRORS += "disabled"` (pułapka 1).
3. `src/routes/api/public/community-cron.ts` (dopisać do manifestu I9): gałęzie `journeys` (runner, `await import`) i `revenue-lifecycle` (oba skanery `supabaseAdmin.rpc(...)` literałem) - rekomendacja: tylko jawny job, NIE w `all` (pułapka 7); jeśli w `all`, zaktualizować test l. 956-998.
4. `.github/workflows/scheduler.yml` (opcje `- journeys`, `- revenue-lifecycle` z komentarzem) i `scripts/scheduler-tick.mjs` (lista l. 25-29 + linie `summarize` dla `journeys`, `revenueLifecycle`, `retentionFlow`).
5. Panel: `src/lib/admin/scheduler.functions.ts` - `SchedulerHealth.journeys: { state: "ready"; killSwitch; enabled; dueNow; inboxPending; lastStepAt; lastIngestAt; failed24h; deadSteps24h; errors24hTotal } | { state: "unavailable" | "forbidden" }` z `context.supabase.rpc("admin_journey_engine_health")` w `try`, `killSwitch` z `journeysKillSwitch()` (dynamiczny import `@/lib/journeys/journeys.functions` lub lokalne `process.env.JOURNEYS_ENGINE_DISABLED === "1"`), parsowanie `parseEngineHealth` (`@/lib/journeys/parse`); `SchedulerHealthPanel.tsx` - karta „Silnik ścieżek" (stan włączony/wyłączony, alert wyłącznika `JOURNEYS_ENGINE_DISABLED`, do wykonania, skrzynka, ostatni krok, błędy 24 h; kolor nigdy sam: ikona + słowo); `src/lib/i18n-admin-scheduler.ts` - `adminScheduler.journeys.*` PL/EN (bez „—").
6. Retencja: `src/lib/privacy/dataRetention.ts` (`journey_inbox.schedule` → nowa wartość, unia, komentarz l. 184-187), `src/lib/i18n-admin-data-retention.ts` (PL l. 187-191, EN l. 443-447), test karty/parytetu z asercją nowej etykiety.
7. S8 po scaleniu: `engineHealthNotice` `scheduler_pending` (summaries.ts + `i18n-admin-journeys-list.ts` + testy) - usunąć/przemianować tekst „(I9)" (koordynacja z krokiem 1 promptu; plik w manifeście S8 → zmiana integratora I9 z opisem).
8. `src/lib/ci/hubDelivery.ts` - manifest I9 += pliki z §9; dokumenty: dziennik (sekcja I9, Z-S5-03 zamknięte), `docs/RUNBOOK_HUB_PRZYCHOD_LEJEK.md` (przełączniki: `journey_settings.enabled`, `JOURNEYS_ENGINE_DISABLED`, harmonogram kroków z minutami UTC, zapytania diagnostyczne `job_runner_runs.result->'journeys'`), `RUNBOOK_COMMUNITY.md` l. 37, rejestr RODO l. 145, KONTYNUACJA.

**Testy (celowane, lokalnie):**
- `jobsTickRun.test.ts`: `vi.mock("@/lib/server/journeysRunner.server", () => ({ JOURNEYS_DEADLINE_MS: 3_000, runJourneysTick: (admin, opts) => jobs.run("journeys", [admin, opts], fixtures.journeys) }))`; odpowiedzi RPC skanerów/rollupu/purge w `beforeEach` z `jobs.note`; aktualizacja `FULL_ORDER`, `CRITICAL_SENDS` (+`journeys`), `EVERY_MINUTE_JOBS` (+`journeys`), `FIVE_MINUTE_JOBS` (+skanery), pełnego wyniku i `rpc.names()`; nowe `describe`: „krok ścieżek: przed drenem, klient service role, termin 3 s, limity 200/50", „`disabled` z wyłącznika nie jest awarią" (jeśli tak postanowiono), „skanery S2 co 5 min: minuta 3 nie rusza bazy, `migration_pending`, błąd = awaria", „rollup co godzinę w wolnej minucie", „purge raz na dobę z `p_older_than: '30 days'`" (wzór l. 1326-1379).
- `jobsTickDutyCycle.test.ts`: czyste bramki rollupu/purge.
- `scheduler.test.ts`: nowe joby w `SCHEDULER_JOBS`, w `scheduler.yml` (regex) i `scheduler-tick.mjs` (`toContain`) - wzór l. 101-108; `countTickFailures` dla `disabled`.
- `-jobs-tick.test.ts`: `tickResult()` += nowe pola; `describe` leniwego importu runnera i pozycji w źródle (`await import("@/lib/server/journeysRunner.server")` przed `drainEmailQueues(admin`), wzór l. 931-958.
- `-community-cron.test.ts` (nowe joby, ewentualnie `all`), `schedulerFunctions.test.ts` (pole `journeys`, odporność na błąd RPC silnika), `SchedulerHealthPanel.test.tsx` (karta, wyłącznik, axe jeśli używane), `i18nAdminScheduler.test.ts`, test karty retencji/parytetu.
- Bramki: zawężony `tsgo` jak w CI (PROMPT §4.1), `lint`, `format:check`, `bun run scripts/hub-slice-guard.ts I9 --base <sha>`, `bunx vitest run src/lib/ci/__tests__/hubDelivery.gate.test.ts`, `generate:authz-snapshot --check`; build + `check:bundle` (panel). Uruchomienie: `bunx vitest run src/lib/server/__tests__/jobsTickRun.test.ts src/lib/server/__tests__/jobsTickDutyCycle.test.ts src/lib/jobs/__tests__/scheduler.test.ts src/routes/api/public/-jobs-tick.test.ts src/routes/api/public/-community-cron.test.ts src/lib/admin/__tests__/schedulerFunctions.test.ts src/components/admin/community/__tests__/SchedulerHealthPanel.test.tsx src/lib/__tests__/i18nAdminScheduler.test.ts src/lib/privacy src/components/admin/settings/dataRetention` (pod `flock -x /tmp/hub-heavy.lock`).

## Otwarte pytania / ryzyka

1. `JOURNEYS_ENGINE_DISABLED=1`: awaria (alarm) czy zaplanowane pominięcie w logu przebiegów? Rekomendacja: pominięcie + jaskrawy stan w panelu.
2. Forma `deadlineAt` kroku ścieżek (względna 3 s od startu kroku vs przycięta do `startedAt + 9 s`) - wpływ na dren poczty i joby z terminami absolutnymi.
3. Nowe joby w community-cron: tylko jawne czy także w `all` (pg_cron co 5 min + GitHub co 5 min, bez drenu poczty)?
4. Pozycja skanerów S2: SPEC „po drenie" - zaraz po wysyłkach 1:1 czy na końcu (ryzyko chronicznego pomijania przy wyczerpaniu budżetu w minutach z jobami sieciowymi)?
5. Minuta rollupu (minuta 0 z `everyNthMinute(60)` vs „wolny pas") i okno purge (pojedyncza minuta 03:07 UTC vs kilka szans) - obie bez testu SQL czasu wykonania; `journey_rollup_daily` liczy 7 dni z podzapytaniami EXISTS - czas w 25 s budżecie i statement_timeout PostgREST nieznany (ryzyko `57014` raz na godzinę).
6. Po podpięciu zapisy testowe (`is_test`) wykonują się mimo `journey_settings.enabled = false` - realne maile „Test na sobie" od pierwszego ticku (zgodne z M3, ale warto napisać w runbooku/dzienniku).
7. Stan silnika w panelu harmonogramu jest per najemca operatora, runner globalny - opisać w dymku/komentarzu; wymaga decyzji, czy pokazywać tylko wyłącznik + bieżącego najemcę.
8. Brak migracji S2/S5 na produkcji w oknie wdrożenia: runner bez `migration_pending` (pułapka 2) zaśmieca logi co minutę.
9. Etykieta `"pending"` w karcie retencji: usunąć z unii i słownika czy zostawić na przyszłość (parytet PL/EN bramkowany).
