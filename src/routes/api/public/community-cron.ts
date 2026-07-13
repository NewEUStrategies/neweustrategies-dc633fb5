// Endpoint harmonogramu kanałów społeczności (push, digesty, przypomnienia).
// Wywoływany przez zewnętrzny scheduler (cron hostingu / GitHub Action / pg_net)
// co ~5-60 min z sekretem w nagłówku; cała idempotencja i okna czasowe żyją
// w Postgresie (claim SKIP LOCKED), więc podwójne wywołania są bezpieczne.
//
//   curl -X POST https://twoja-domena/api/public/community-cron \
//     -H "x-community-cron-secret: $COMMUNITY_CRON_SECRET" \
//     -H "content-type: application/json" -d '{"job":"all"}'
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { timingSafeEqual } from "node:crypto";
import { createRateLimiter, clientIpFromHeaders } from "@/lib/http/rateLimit";

const limiter = createRateLimiter({ capacity: 30, refillPerSec: 0.5 });

const JOBS = new Set(["all", "push", "digest-daily", "digest-weekly", "event-reminders"]);

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function secretMatches(provided: string | null): boolean {
  const expected = process.env.COMMUNITY_CRON_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/community-cron")({
  server: {
    handlers: {
      POST: async () => {
        const req = getRequest();
        if (!limiter.check(clientIpFromHeaders(req.headers), Date.now())) {
          return new Response(null, { status: 429 });
        }
        if (!secretMatches(req.headers.get("x-community-cron-secret"))) {
          return unauthorized();
        }

        let job = "all";
        try {
          const body = (await req.json()) as { job?: string };
          if (body?.job) job = body.job;
        } catch {
          // brak/niepoprawne body = 'all'
        }
        if (!JOBS.has(job)) {
          return new Response(JSON.stringify({ error: "unknown_job" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { processPushJobs, processDigests, runEventReminders } = await import(
          "@/lib/notifications/dispatch.server"
        );

        const result: Record<string, unknown> = {};
        try {
          if (job === "all" || job === "push") {
            result.push = await processPushJobs(100);
          }
          if (job === "all" || job === "digest-daily") {
            result.digestDaily = await processDigests("daily", 50);
          }
          if (job === "all" || job === "digest-weekly") {
            result.digestWeekly = await processDigests("weekly", 50);
          }
          if (job === "all" || job === "event-reminders") {
            result.eventReminders = await runEventReminders();
          }
        } catch (err) {
          console.error("[community-cron] job failed", job, err);
          return new Response(JSON.stringify({ error: "job_failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        }

        return new Response(JSON.stringify({ ok: true, ...result }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
