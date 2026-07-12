// Endpoint ticku zadań tła. Woła go pg_cron przez pg_net co minutę
// (migracja 20260713170000) z sekretem z job_runner_settings - dzięki temu
// zaplanowane kampanie newslettera wysyłają się bez udziału człowieka,
// a przerwane porcje wysyłki są kontynuowane.
//
// Bezpieczeństwo: sekret porównywany w stałym czasie; brak/niezgodność ->
// 401 bez treści. Rate limit chroni przed kosztownym młóceniem endpointu
// (sama praca i tak jest idempotentna: dzierżawy + log per odbiorca).
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { createRateLimiter, clientIpFromHeaders } from "@/lib/http/rateLimit";
import { runJobsTick, secretsEqual } from "@/lib/server/jobsTick.server";

const limiter = createRateLimiter({ capacity: 10, refillPerSec: 0.5 });

export const Route = createFileRoute("/api/public/jobs-tick")({
  server: {
    handlers: {
      POST: async () => {
        const req = getRequest();
        if (!limiter.check(clientIpFromHeaders(req.headers), Date.now())) {
          return new Response(null, { status: 429 });
        }
        const provided = req.headers.get("x-jobs-secret") ?? "";
        if (!provided) return new Response(null, { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: cfg } = await supabaseAdmin
          .from("job_runner_settings" as never)
          .select("enabled, secret")
          .eq("id", 1)
          .maybeSingle();
        const settings = (cfg ?? null) as { enabled: boolean; secret: string } | null;
        if (!settings?.enabled || !(await secretsEqual(provided, settings.secret))) {
          return new Response(null, { status: 401 });
        }

        const result = await runJobsTick(supabaseAdmin);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
