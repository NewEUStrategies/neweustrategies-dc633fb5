// Panel zdrowia harmonogramu zadań tła - warstwa serwerowa dla
// /admin/community/notifications.
//
// Jedno źródło prawdy o tym, czy doręczenia FAKTYCZNIE biegną: RPC
// job_scheduler_health() (stan runnera, rejestr pg_cron, log przebiegów,
// głębokość kolejki push w tenancie wołającego) plus flagi środowiska, których
// baza znać nie może (VAPID, Resend, sekret schedulera repo). Bez tej pary
// "brak wysyłek" jest nieodróżnialne od "brak powiadomień do wysłania".
//
// Zapis konfiguracji runnera ma JEDNEGO właściciela - updateJobRunnerSettings
// w newsletter-admin.functions (tabela job_runner_settings jest wspólna dla
// newslettera i kanałów społeczności), więc panel czyta tutaj, a pisze tam.
import { createServerFn } from "@tanstack/react-start";
// requireAdminEditor, nie requireStaff: RPC job_scheduler_health() przepuszcza
// admin/editor/super_admin, a `requireStaff` wpuszcza też AUTORÓW. Przy szerszej
// bramce serwerowej autor otwierał panel, dostawał 42501 z bazy i odpytywał
// zablokowane RPC co 30 s. Bramki muszą być te same po obu stronach.
import { requireAdminEditor } from "@/integrations/supabase/require-staff";
import type { JobsTickResult } from "@/lib/server/jobsTick.server";
import {
  normalizeArmOrigin,
  type SchedulerFreshness,
  type SchedulerSource,
} from "@/lib/jobs/scheduler";

/**
 * Telemetria puknięcia community-cron (`invoke_community_cron`, migracja
 * 20260731210000): siatka społeczności co 5 minut, osobna od minutowego
 * jobs-tick. Rozjazd tych dwóch statusów lokalizuje awarię konkretnej ścieżki
 * ("minutowy tick żyje, siatka społeczności nie").
 */
export interface SchedulerCommunityTickState {
  lastTickAt: string | null;
  lastTickStatus: string | null;
  lastTickError: string | null;
  tickCount: number;
}

export interface SchedulerRunnerState {
  enabled: boolean;
  baseUrl: string;
  resolvedBaseUrl: string;
  secretSet: boolean;
  autoArmedAt: string | null;
  lastInvokedAt: string | null;
  lastAppRunAt: string | null;
  lastAppOkAt: string | null;
  lastAppError: string | null;
  failureStreak: number;
  /**
   * Telemetria SAMEGO crona (`invoke_jobs_tick`): `dispatched` | `skipped` |
   * `error`. Razem z `lastTickError` odpowiada, DLACZEGO puknięcia nie było -
   * `disabled`, `no_secret`, `no_base_url`, `pg_net_unavailable`.
   */
  lastTickStatus: string | null;
  lastTickError: string | null;
  tickCount: number;
  communityCron: SchedulerCommunityTickState;
}

export interface SchedulerCronJob {
  name: string;
  schedule: string;
  active: boolean;
}

export interface SchedulerRun {
  id: number;
  source: SchedulerSource;
  job: string;
  ok: boolean;
  durationMs: number;
  error: string | null;
  createdAt: string;
}

export interface SchedulerSourceStat {
  source: SchedulerSource;
  lastAt: string | null;
  lastOkAt: string | null;
  runs24h: number;
  failures24h: number;
}

export interface SchedulerQueueState {
  pushPending: number;
  pushDueNow: number;
  pushSent24h: number;
  pushDead: number;
  pushOldestPendingSeconds: number;
  pushSubscriptionsActive: number;
  digestDueDaily: number;
  digestDueWeekly: number;
}

/** Czego baza nie wie: sekrety i klucze żyją w env procesu aplikacji. */
export interface SchedulerEnvState {
  vapidConfigured: boolean;
  emailGatewayConfigured: boolean;
  communityCronSecretSet: boolean;
  siteUrl: string;
  /** Origin bieżącego żądania - podpowiedź dla pola base_url w panelu. */
  suggestedBaseUrl: string;
}

/**
 * Silnik ścieżek komunikacji (S5) widziany z panelu harmonogramu (I9,
 * Z-S5-03). Runner jest GLOBALNY (krok `journeys` w `jobs-tick`), ale stan
 * silnika jest PER NAJEMCA - liczby dotyczą najemcy operatora; wyłącznik
 * awaryjny środowiska dotyczy wszystkich najemców.
 */
export interface SchedulerJourneysEngine {
  /** Przełącznik najemcy (`journey_settings.enabled`, panel ustawień silnika). */
  enabled: boolean;
  dueNow: number;
  inboxPending: number;
  lastStepAt: string | null;
  /** Nieudane zapisy, martwe kroki i błędy faz silnika z ostatniej doby. */
  failures24h: number;
}

export interface SchedulerJourneysState {
  /** `JOURNEYS_ENGINE_DISABLED=1` - awaryjny wyłącznik środowiska. */
  killSwitch: boolean;
  /**
   * `null` = baza bez silnika (okno wdrożenia) albo odczyt padł. Zdrowie
   * harmonogramu NIE może przez to zgasnąć - silnik to jedna z jego części.
   */
  engine: SchedulerJourneysEngine | null;
}

export interface SchedulerHealth {
  runner: SchedulerRunnerState;
  capabilities: { pgCron: boolean; pgNet: boolean };
  /** Cron puka, ale aplikacja nie raportuje (zły URL/sekret, leżący deploy). */
  appUnreachable: boolean;
  cronJobs: SchedulerCronJob[];
  recentRuns: SchedulerRun[];
  sources: SchedulerSourceStat[];
  queue: SchedulerQueueState;
  env: SchedulerEnvState;
  /** Świeżość liczona serwerowo (jeden zegar dla panelu i alertów). */
  freshness: SchedulerFreshness;
  /** Znacznik odpowiedzi - UI liczy z niego wiek bez dryfu zegara przeglądarki. */
  observedAt: string;
  /** Silnik ścieżek (krok `journeys` w ticku) - wyłącznik i stan najemcy. */
  journeys: SchedulerJourneysState;
}

/** Kształt jsonb z RPC job_scheduler_health() (autorstwo: 20260731110000). */
interface HealthPayload {
  runner?: {
    enabled?: boolean;
    base_url?: string;
    resolved_base_url?: string;
    secret_set?: boolean;
    auto_armed_at?: string | null;
    last_invoked_at?: string | null;
    last_app_run_at?: string | null;
    last_app_ok_at?: string | null;
    last_app_error?: string | null;
    failure_streak?: number;
    last_tick_status?: string | null;
    last_tick_error?: string | null;
    tick_count?: number;
    community_cron?: {
      last_tick_at?: string | null;
      last_tick_status?: string | null;
      last_tick_error?: string | null;
      tick_count?: number;
    };
  };
  capabilities?: { pg_cron?: boolean; pg_net?: boolean };
  app_unreachable?: boolean;
  cron_jobs?: { name?: string | null; schedule?: string | null; active?: boolean }[];
  recent_runs?: {
    id?: number;
    source?: string;
    job?: string;
    ok?: boolean;
    duration_ms?: number;
    error?: string | null;
    created_at?: string;
  }[];
  sources?: {
    source?: string;
    last_at?: string | null;
    last_ok_at?: string | null;
    runs_24h?: number;
    failures_24h?: number;
  }[];
  queue?: {
    push_pending?: number;
    push_due_now?: number;
    push_sent_24h?: number;
    push_dead?: number;
    push_oldest_pending_seconds?: number;
    push_subscriptions_active?: number;
    digest_due_daily?: number;
    digest_due_weekly?: number;
  };
}

const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

type RpcReader = {
  rpc: (fn: string) => PromiseLike<{ data: unknown; error: { message: string } | null } | null>;
};

/**
 * Stan silnika ścieżek dla panelu harmonogramu. Ten sam RPC i parser co
 * pasek zdrowia na liście ścieżek (`getJourneyEngineHealth`). Bramka RPC
 * (`_journey_staff_tenant`: admin/editor/super_admin) jest tą samą co
 * `requireAdminEditor` tej funkcji. Każdy błąd (baza bez silnika, odmowa,
 * zły kształt) daje `engine: null` - panel mówi „silnik niedostępny", ale
 * reszta zdrowia harmonogramu zostaje na ekranie.
 */
async function readJourneysState(context: { supabase: unknown }): Promise<SchedulerJourneysState> {
  // Ten sam predykat co runner (`runJourneysTick`) i `journeysKillSwitch`
  // panelu ścieżek - bez importu modułu funkcji serwerowych ścieżek tutaj.
  const killSwitch = process.env.JOURNEYS_ENGINE_DISABLED === "1";
  try {
    // Literał RPC (bramka generate:ts-sql-contract); klient sesji - najemca
    // z `current_tenant_id()`, nigdy z parametru.
    const res = await (context.supabase as RpcReader).rpc("admin_journey_engine_health");
    if (!res || res.error) return { killSwitch, engine: null };
    const { parseEngineHealth } = await import("@/lib/journeys/parse");
    const health = parseEngineHealth(res.data, killSwitch);
    const phaseErrors = Object.values(health.errors24h).reduce<number>(
      (sum, n) => sum + (n ?? 0),
      0,
    );
    return {
      killSwitch,
      engine: {
        enabled: health.enabled,
        dueNow: health.dueNow,
        inboxPending: health.inboxPending,
        lastStepAt: health.lastStepAt,
        failures24h: health.failed24h + health.deadSteps24h + phaseErrors,
      },
    };
  } catch {
    return { killSwitch, engine: null };
  }
}

export const getSchedulerHealth = createServerFn({ method: "GET" })
  .middleware([requireAdminEditor])
  .handler(async ({ context }): Promise<SchedulerHealth> => {
    const { schedulerFreshness, normalizeSchedulerSource } = await import("@/lib/jobs/scheduler");
    // RPC autoryzuje i skaluje dane tym samym tenantem (has_role +
    // current_tenant_id), więc jedzie user-scoped klientem, nie service role.
    const { data, error } = await context.supabase.rpc("job_scheduler_health");
    if (error) throw new Error(error.message);
    const payload = (data ?? {}) as HealthPayload;

    const runner: SchedulerRunnerState = {
      enabled: payload.runner?.enabled ?? false,
      baseUrl: payload.runner?.base_url ?? "",
      resolvedBaseUrl: payload.runner?.resolved_base_url ?? "",
      secretSet: payload.runner?.secret_set ?? false,
      autoArmedAt: payload.runner?.auto_armed_at ?? null,
      lastInvokedAt: payload.runner?.last_invoked_at ?? null,
      lastAppRunAt: payload.runner?.last_app_run_at ?? null,
      lastAppOkAt: payload.runner?.last_app_ok_at ?? null,
      lastAppError: payload.runner?.last_app_error ?? null,
      failureStreak: num(payload.runner?.failure_streak),
      lastTickStatus: payload.runner?.last_tick_status ?? null,
      lastTickError: payload.runner?.last_tick_error ?? null,
      tickCount: num(payload.runner?.tick_count),
      communityCron: {
        lastTickAt: payload.runner?.community_cron?.last_tick_at ?? null,
        lastTickStatus: payload.runner?.community_cron?.last_tick_status ?? null,
        lastTickError: payload.runner?.community_cron?.last_tick_error ?? null,
        tickCount: num(payload.runner?.community_cron?.tick_count),
      },
    };

    const { getOrigin } = await import("@/lib/seo/request");
    const origin = normalizeArmOrigin(getOrigin()) ?? "";
    const { emailProviderConfigured } = await import("@/lib/email/provider.server");
    const journeys = await readJourneysState(context);

    return {
      runner,
      capabilities: {
        pgCron: payload.capabilities?.pg_cron ?? false,
        pgNet: payload.capabilities?.pg_net ?? false,
      },
      appUnreachable: payload.app_unreachable ?? false,
      cronJobs: (payload.cron_jobs ?? []).map((job) => ({
        name: job.name ?? "-",
        schedule: job.schedule ?? "-",
        active: job.active ?? false,
      })),
      recentRuns: (payload.recent_runs ?? []).map((run) => ({
        id: num(run.id),
        source: normalizeSchedulerSource(run.source),
        job: run.job ?? "all",
        ok: run.ok ?? false,
        durationMs: num(run.duration_ms),
        error: run.error ?? null,
        createdAt: run.created_at ?? "",
      })),
      sources: (payload.sources ?? []).map((stat) => ({
        source: normalizeSchedulerSource(stat.source),
        lastAt: stat.last_at ?? null,
        lastOkAt: stat.last_ok_at ?? null,
        runs24h: num(stat.runs_24h),
        failures24h: num(stat.failures_24h),
      })),
      queue: {
        pushPending: num(payload.queue?.push_pending),
        pushDueNow: num(payload.queue?.push_due_now),
        pushSent24h: num(payload.queue?.push_sent_24h),
        pushDead: num(payload.queue?.push_dead),
        pushOldestPendingSeconds: num(payload.queue?.push_oldest_pending_seconds),
        pushSubscriptionsActive: num(payload.queue?.push_subscriptions_active),
        digestDueDaily: num(payload.queue?.digest_due_daily),
        digestDueWeekly: num(payload.queue?.digest_due_weekly),
      },
      env: {
        vapidConfigured: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
        // Pytamy DOSTAWCĘ, nie zmienne środowiskowe. Poprzednia wersja liczyła
        // to na miejscu jako `RESEND_API_KEY || LOVABLE_API_KEY` i rozjeżdżała
        // się z jedynym miejscem, które naprawdę decyduje o wysyłce:
        // `emailProviderConfigured()` to `(LOVABLE && RESEND) || LOVABLE`, czyli
        // sam RESEND_API_KEY NIE wystarcza. Panel zdrowia świecił więc zielono
        // przy konfiguracji, w której poczta nie wyszłaby ani razu. Import
        // `emailProviderConfigured` leżał w tym pliku bez użycia - ta linia jest
        // dokończeniem zaczętej poprawki, nie nową decyzją.
        emailGatewayConfigured: emailProviderConfigured(),
        communityCronSecretSet: Boolean(process.env.COMMUNITY_CRON_SECRET),
        siteUrl:
          process.env.PUBLIC_SITE_URL || process.env.SITE_URL || process.env.URL || origin || "",
        suggestedBaseUrl: origin,
      },
      freshness: schedulerFreshness(runner.lastAppOkAt),
      observedAt: new Date().toISOString(),
      journeys,
    };
  });

/**
 * Ręczny tick z panelu: ta sama funkcja co pg_cron i scheduler repo
 * (runJobsTick), więc przycisk nie jest osobną, gorszą ścieżką. Przebieg trafia
 * do logu ze źródłem 'admin' i śladem audytowym (tenant + operator).
 */
export const runSchedulerTickNow = createServerFn({ method: "POST" })
  .middleware([requireAdminEditor])
  .handler(async ({ context }): Promise<JobsTickResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runJobsTick } = await import("@/lib/server/jobsTick.server");
    const { ensureJobRunnerArmed } = await import("@/lib/server/jobScheduler.server");
    const { getOrigin } = await import("@/lib/seo/request");

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();

    // Ręczny tick uzbraja też ścieżkę podstawową - operator, który kliknął
    // „uruchom teraz", zwykle właśnie diagnozuje martwy harmonogram.
    await ensureJobRunnerArmed(getOrigin());

    return runJobsTick(supabaseAdmin, {
      source: "admin",
      tenantId: profile?.tenant_id ?? null,
      actorId: context.userId,
    });
  });
