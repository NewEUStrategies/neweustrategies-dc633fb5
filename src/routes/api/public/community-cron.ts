// Endpoint harmonogramu kanałów społeczności (push, digesty, przypomnienia).
//
// To ścieżka NIEZALEŻNA OD BAZY: woła ją scheduler repo
// (.github/workflows/scheduler.yml co 5 minut, minutowa pętla w środku) oraz
// dowolny zewnętrzny cron. Ścieżką podstawową jest pg_cron -> /jobs-tick (co
// minutę), ale ta uruchamia się sama z sekretu w repo i - co ważniejsze -
// UZBRAJA ścieżkę podstawową: pierwszy tick przekazuje bazie publiczny origin
// aplikacji (arm_job_runner), więc pg_cron przestaje tykać w próżnię.
//
// Cała idempotencja i okna czasowe żyją w Postgresie (claim SKIP LOCKED), więc
// równoległe wywołania obu ścieżek niczego nie dublują. Każdy przebieg trafia
// do public.job_runner_runs - panel /admin/community/notifications czyta tylko
// ten log, więc "harmonogram stoi" jest widoczne, a nie domyślane.
//
//   # tick (job z query albo z body; brak = all)
//   curl -X POST "https://twoja-domena/api/public/community-cron?job=all" \
//     -H "x-community-cron-secret: $COMMUNITY_CRON_SECRET"
//
//   # sonda zdrowia dla monitoringu (bez efektów ubocznych)
//   curl "https://twoja-domena/api/public/community-cron" \
//     -H "x-community-cron-secret: $COMMUNITY_CRON_SECRET"
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { timingSafeEqual } from "node:crypto";
import { createRateLimiter, clientIpFromHeaders } from "@/lib/http/rateLimit";
import {
  isSchedulerAlarming,
  normalizeSchedulerSource,
  parseSchedulerJob,
  schedulerFreshness,
  type SchedulerJob,
  type SchedulerSource,
} from "@/lib/jobs/scheduler";

// Pętla minutowa schedulera repo wysyła do 5 ticków na przebieg, a sonda GET
// dochodzi osobno - pojemność 30 przy 0.5/s zostawia zapas na ręczne wywołania.
const limiter = createRateLimiter({ capacity: 30, refillPerSec: 0.5 });

const SECRET_HEADER = "x-community-cron-secret";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function constantEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Sekret z env - podstawowa autoryzacja zewnętrznego schedulera. */
function envSecretMatches(provided: string): boolean {
  const expected = process.env.COMMUNITY_CRON_SECRET;
  if (!expected) return false;
  return constantEquals(provided, expected);
}

/**
 * Fallback: współdzielony sekret runnera z `job_runner_settings` (tabela
 * service-role-only, ten sam mechanizm co w billing-cron.ts). Dzięki temu
 * operator ma JEDEN sekret dla obu ścieżek i nie musi wstrzykiwać env tylko po
 * to, żeby uruchomić scheduler w repo.
 */
async function runnerSecretMatches(provided: string): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("job_runner_settings")
      .select("secret")
      .eq("id", 1)
      .maybeSingle();
    const secret = ((data ?? null) as { secret?: string } | null)?.secret;
    if (!secret) return false;
    return constantEquals(provided, secret);
  } catch {
    return false;
  }
}

function providedSecret(req: Request): string {
  const header = req.headers.get(SECRET_HEADER);
  if (header) return header;
  const bearer = req.headers.get("authorization") ?? "";
  return bearer.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : "";
}

async function authorize(req: Request): Promise<boolean> {
  const provided = providedSecret(req);
  if (!provided) return false;
  return envSecretMatches(provided) || (await runnerSecretMatches(provided));
}

function originFromRequest(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return host ? `${proto}://${host.split(",")[0].trim()}` : "";
}

function sourceFromRequest(req: Request, url: URL): SchedulerSource {
  return normalizeSchedulerSource(
    url.searchParams.get("source") ?? req.headers.get("x-cron-source"),
  );
}

/** Job z query (udokumentowane `?job=`) ma pierwszeństwo nad body. */
async function jobFromRequest(req: Request, url: URL): Promise<SchedulerJob | null> {
  const fromQuery = url.searchParams.get("job");
  if (fromQuery !== null) return parseSchedulerJob(fromQuery);
  try {
    const body = (await req.json()) as { job?: unknown };
    if (typeof body?.job === "string") return parseSchedulerJob(body.job);
  } catch {
    // brak/niepoprawne body = 'all'
  }
  return "all";
}

type JobOutcome = Record<string, unknown>;

/**
 * Budżet czasu jednego wywołania (ten sam kontrakt co JOBS_TICK_DEADLINE_MS w
 * jobsTick.server): po jego wyczerpaniu KOLEJNE kanały są pomijane zamiast
 * ryzykować timeout workera w połowie partii. Pominięcie nie jest awarią -
 * praca jest watermarkowa/claimowana, więc wraca w następnym ticku (a ten leci
 * co minutę ze ścieżki podstawowej i co 60 s w pętli schedulera repo).
 */
const COMMUNITY_CRON_DEADLINE_MS = 25_000;

/**
 * Każdy krok osobno: awaria jednego kanału (np. brak klucza Resend) nie może
 * zabrać pozostałych. Błędy lądują w odpowiedzi ORAZ w logu przebiegów, więc
 * scheduler repo świeci czerwono z konkretną przyczyną.
 */
async function runJobs(job: SchedulerJob): Promise<{ result: JobOutcome; errors: string[] }> {
  const { processPushJobs, processDigests, runEventReminders, runCrmTaskReminders } =
    await import("@/lib/notifications/dispatch.server");

  const startedAt = Date.now();
  const result: JobOutcome = {};
  const errors: string[] = [];
  const step = async (key: string, fn: () => Promise<unknown>): Promise<void> => {
    if (Date.now() - startedAt > COMMUNITY_CRON_DEADLINE_MS) {
      result[key] = { error: "skipped_time_budget" };
      return;
    }
    try {
      result[key] = await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result[key] = { error: message };
      errors.push(`${key}: ${message}`);
    }
  };

  if (job === "all" || job === "push") await step("push", () => processPushJobs(100));
  if (job === "all" || job === "digest-daily") {
    await step("digestDaily", () => processDigests("daily", 50));
  }
  if (job === "all" || job === "digest-weekly") {
    await step("digestWeekly", () => processDigests("weekly", 50));
  }
  if (job === "all" || job === "event-reminders") {
    await step("eventReminders", () => runEventReminders());
  }
  if (job === "all" || job === "crm-task-reminders") {
    await step("crmTaskReminders", () => runCrmTaskReminders());
  }
  if (job === "all" || job === "career-cv-retention") {
    // Dane osobowe kandydatów: plik CV ląduje w buckecie przy WYBORZE, przed
    // wysyłką formularza, więc bez tego kroku porzucony kreator zostawiał CV na
    // zawsze. Krok jest tani (skan + jedna partia), więc jedzie w "all".
    await step("careerCvRetention", async () => {
      const { runCareerCvRetention } = await import("@/lib/server/careerCvRetention.server");
      return runCareerCvRetention();
    });
  }
  if (job === "all") {
    await step("reputationBadges", async () => {
      const { reconcileReputationBadges } = await import("@/lib/community/reputationBadges.server");
      return reconcileReputationBadges(250);
    });
  }
  return { result, errors };
}

export const Route = createFileRoute("/api/public/community-cron")({
  server: {
    handlers: {
      // Sonda zdrowia dla monitoringu zewnętrznego (uptime robot potrafi tylko
      // GET): zero efektów ubocznych, ale pełna diagnoza zastoju.
      GET: async () => {
        const req = getRequest();
        if (!limiter.check(clientIpFromHeaders(req.headers), Date.now())) {
          return new Response(null, { status: 429 });
        }
        if (!(await authorize(req))) return json({ error: "unauthorized" }, 401);

        const { readSchedulerHeartbeat, countPendingPush } =
          await import("@/lib/server/jobScheduler.server");
        const [heartbeat, pending] = await Promise.all([
          readSchedulerHeartbeat(),
          countPendingPush(),
        ]);
        const freshness = schedulerFreshness(heartbeat?.lastAppOkAt ?? null);
        const alarming = isSchedulerAlarming(freshness);
        return json(
          {
            ok: !alarming,
            freshness,
            runnerEnabled: heartbeat?.enabled ?? false,
            lastOkAt: heartbeat?.lastAppOkAt ?? null,
            lastRunAt: heartbeat?.lastAppRunAt ?? null,
            lastCronInvokeAt: heartbeat?.lastInvokedAt ?? null,
            lastError: heartbeat?.lastAppError ?? null,
            failureStreak: heartbeat?.failureStreak ?? 0,
            pushPending: pending,
          },
          // 503 przy zastoju: monitoring zewnętrzny alarmuje bez parsowania JSON-a.
          alarming ? 503 : 200,
        );
      },

      POST: async () => {
        const req = getRequest();
        if (!limiter.check(clientIpFromHeaders(req.headers), Date.now())) {
          return new Response(null, { status: 429 });
        }
        if (!(await authorize(req))) return json({ error: "unauthorized" }, 401);

        const url = new URL(req.url);
        const job = await jobFromRequest(req, url);
        if (job === null) return json({ error: "unknown_job" }, 400);
        const source = sourceFromRequest(req, url);

        const { ensureJobRunnerArmed, recordJobRun } =
          await import("@/lib/server/jobScheduler.server");
        // Uzbrojenie ścieżki podstawowej: baza dostaje publiczny origin, którego
        // sama nie zna. Rusza tylko dziewiczy wiersz konfiguracji.
        const armed = await ensureJobRunnerArmed(originFromRequest(req));

        const startedAt = Date.now();
        const { result, errors } = await runJobs(job);
        const durationMs = Date.now() - startedAt;
        const ok = errors.length === 0;

        await recordJobRun({
          source,
          job,
          ok,
          durationMs,
          result,
          error: ok ? null : errors.join("; "),
        });

        if (!ok) console.error("[community-cron] job failed", job, errors);

        return json(
          {
            ok,
            job,
            source,
            durationMs,
            runnerArmed: armed,
            ...result,
            errors: errors.length ? errors : undefined,
          },
          ok ? 200 : 500,
        );
      },
    },
  },
});
