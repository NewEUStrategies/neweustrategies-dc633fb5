// Harmonogram zadań tła - WARSTWA SERWEROWA (service role).
//
// Odpowiada za dwie rzeczy, bez których "kod jest, ale nikt go nie woła" jest
// niewidzialne:
//
//   * HEARTBEAT - każdy przebieg dyspozytora (z crona bazy, z GitHub Actions
//     albo ręczny z panelu) trafia do public.job_runner_runs przez
//     record_job_run(). Panel admina i alerty czytają wyłącznie ten log, więc
//     "kolejka pusta" nigdy nie jest już mylone z "harmonogram martwy".
//
//   * SAMOZBROJENIE - job_runner_settings rodzi się z enabled=false i
//     base_url='', czyli pg_cron tyka w próżnię. Baza sama nie zna publicznego
//     adresu aplikacji (domena tenanta bywa pusta w instalacji jednodomenowej),
//     ale KAŻDE żądanie ticku go zna. Pierwszy tick z dowolnej ścieżki uzbraja
//     runner (arm_job_runner, tylko dziewiczy wiersz) i tym samym uruchamia
//     ścieżkę podstawową: pg_cron co minutę, bez zewnętrznych zależności.
//
// Wszystko jest best-effort: log ani zbrojenie nie mogą wywalić wysyłki, która
// właśnie się udała.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizeArmOrigin, type SchedulerJob, type SchedulerSource } from "@/lib/jobs/scheduler";

type DbClient = SupabaseClient<Database>;

async function adminClient(client?: DbClient): Promise<DbClient> {
  if (client) return client;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export interface JobRunReport {
  source: SchedulerSource;
  job: SchedulerJob | string;
  ok: boolean;
  durationMs: number;
  /** Wynik ticku (per job) - ląduje w logu jako jsonb, bez PII. */
  result?: unknown;
  error?: string | null;
  /** Tylko przebiegi ręczne: ślad audytowy kto/z jakiego tenanta wymusił tick. */
  tenantId?: string | null;
  actorId?: string | null;
}

/**
 * Zapisuje przebieg w logu i stempluje heartbeat. Nigdy nie rzuca - brak logu
 * jest mniejszym problemem niż 500 na endpoincie, który właśnie wysłał push.
 */
export async function recordJobRun(report: JobRunReport, client?: DbClient): Promise<void> {
  try {
    const db = await adminClient(client);
    // `as never`: RPC z migracji 20260731110000, jeszcze nie w wygenerowanych
    // typach Supabase (src/integrations/supabase/types.ts jest generowane).
    const { error } = await db.rpc(
      "record_job_run" as never,
      {
        p_source: report.source,
        p_job: report.job,
        p_ok: report.ok,
        p_duration_ms: Math.max(0, Math.round(report.durationMs)),
        p_result: report.result ?? null,
        p_error: report.error ?? null,
        p_tenant_id: report.tenantId ?? null,
        p_actor_id: report.actorId ?? null,
      } as never,
    );
    if (error) throw error;
  } catch (err) {
    console.error("[scheduler] record_job_run failed", err);
  }
}

export type ArmOutcome = "armed" | "already_configured" | "invalid_base_url" | "unavailable";

/**
 * Uzbraja runner bazy adresem, który zna aplikacja (origin żądania albo
 * PUBLIC_SITE_URL). Bezpieczne do wołania na każdym ticku: RPC rusza wyłącznie
 * dziewiczy wiersz konfiguracji, więc świadome wyłączenie runnera zostaje
 * wyłączone.
 */
export async function ensureJobRunnerArmed(
  origin: string | null | undefined,
  client?: DbClient,
): Promise<ArmOutcome> {
  const baseUrl = normalizeArmOrigin(origin) ?? normalizeArmOrigin(process.env.PUBLIC_SITE_URL);
  if (!baseUrl) return "invalid_base_url";
  try {
    const db = await adminClient(client);
    // `as never`: patrz komentarz w recordJobRun.
    const { data, error } = await db.rpc(
      "arm_job_runner" as never,
      {
        p_base_url: baseUrl,
      } as never,
    );
    if (error) throw error;
    const outcome = (data ?? null) as { armed?: boolean; reason?: string } | null;
    if (outcome?.armed) {
      console.info(`[scheduler] job runner uzbrojony automatycznie: ${baseUrl}`);
      return "armed";
    }
    return outcome?.reason === "invalid_base_url" ? "invalid_base_url" : "already_configured";
  } catch (err) {
    console.error("[scheduler] arm_job_runner failed", err);
    return "unavailable";
  }
}

export interface SchedulerHeartbeat {
  enabled: boolean;
  baseUrl: string;
  lastInvokedAt: string | null;
  lastAppRunAt: string | null;
  lastAppOkAt: string | null;
  lastAppError: string | null;
  failureStreak: number;
}

/**
 * Heartbeat jednym zapytaniem - dla sondy GET /api/public/community-cron
 * (monitoring zewnętrzny) i dla panelu admina jako uzupełnienie RPC zdrowia.
 */
export async function readSchedulerHeartbeat(
  client?: DbClient,
): Promise<SchedulerHeartbeat | null> {
  try {
    const db = await adminClient(client);
    const { data, error } = await db
      .from("job_runner_settings")
      .select(
        "enabled, base_url, last_invoked_at, last_app_run_at, last_app_ok_at, last_app_error, failure_streak",
      )
      .eq("id", 1)
      .maybeSingle();
    if (error) throw error;
    // `as` na wąski kształt: kolumny heartbeatu (20260731110000) nie są jeszcze
    // w wygenerowanych typach, a `select` zwraca dokładnie te pola.
    const row = (data ?? null) as {
      enabled?: boolean;
      base_url?: string;
      last_invoked_at?: string | null;
      last_app_run_at?: string | null;
      last_app_ok_at?: string | null;
      last_app_error?: string | null;
      failure_streak?: number;
    } | null;
    if (!row) return null;
    return {
      enabled: row.enabled ?? false,
      baseUrl: row.base_url ?? "",
      lastInvokedAt: row.last_invoked_at ?? null,
      lastAppRunAt: row.last_app_run_at ?? null,
      lastAppOkAt: row.last_app_ok_at ?? null,
      lastAppError: row.last_app_error ?? null,
      failureStreak: row.failure_streak ?? 0,
    };
  } catch (err) {
    console.error("[scheduler] heartbeat read failed", err);
    return null;
  }
}

/** Ile zadań czeka w kolejce push (globalnie) - sonda zdrowia bez tenanta. */
export async function countPendingPush(client?: DbClient): Promise<number | null> {
  try {
    const db = await adminClient(client);
    const { count, error } = await db
      .from("notification_push_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (error) throw error;
    return count ?? 0;
  } catch (err) {
    console.error("[scheduler] pending push count failed", err);
    return null;
  }
}
