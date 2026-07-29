// Harmonogram rozliczeń: automatyczne przypomnienia mailowe o zbliżającym się
// odnowieniu subskrypcji oraz o kończącym się dostępie po anulowaniu.
//
// Wywoływany przez zewnętrzny scheduler raz na dobę z sekretem w nagłówku.
// Idempotencja żyje w warstwie wysyłki (klucz = subskrypcja + data graniczna),
// więc powtórne wywołania są bezpieczne.
//
//   curl -X POST https://neweuropeanstrategies.com/api/public/billing-cron \
//     -H "x-billing-cron-secret: $BILLING_CRON_SECRET" \
//     -H "content-type: application/json" -d '{"leadDays":3}'
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { timingSafeEqual } from "node:crypto";
import { createRateLimiter, clientIpFromHeaders } from "@/lib/http/rateLimit";

const limiter = createRateLimiter({ capacity: 10, refillPerSec: 0.2 });

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

function envSecretMatches(provided: string | null): boolean {
  const expected = process.env.BILLING_CRON_SECRET || process.env.COMMUNITY_CRON_SECRET;
  if (!expected || !provided) return false;
  return constantEquals(provided, expected);
}

/**
 * Fallback dla harmonogramu w bazie (pg_cron -> net.http_post): kiedy sekret nie
 * jest wstrzyknięty do środowiska, akceptujemy współdzielony sekret runnera
 * zadań przechowywany w `job_runner_settings` (odczyt wyłącznie service-role).
 */
async function dbSecretMatches(provided: string | null): Promise<boolean> {
  if (!provided) return false;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("job_runner_settings")
      .select("enabled, secret")
      .eq("id", 1)
      .maybeSingle();
    const cfg = (data ?? null) as { enabled: boolean; secret: string } | null;
    if (!cfg?.enabled || !cfg.secret) return false;
    return constantEquals(provided, cfg.secret);
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/billing-cron")({
  server: {
    handlers: {
      POST: async () => {
        const req = getRequest();
        if (!limiter.check(clientIpFromHeaders(req.headers), Date.now())) {
          return new Response(null, { status: 429 });
        }
        const provided = req.headers.get("x-billing-cron-secret");
        if (!envSecretMatches(provided) && !(await dbSecretMatches(provided))) {
          return json({ error: "unauthorized" }, 401);
        }

        let leadDays = 3;
        try {
          const body = (await req.json()) as { leadDays?: number };
          if (typeof body?.leadDays === "number" && body.leadDays >= 1 && body.leadDays <= 30) {
            leadDays = Math.round(body.leadDays);
          }
        } catch {
          // brak body = domyślne 3 dni
        }

        try {
          const { runBillingReminders } = await import("@/lib/billing/reminders.server");
          const result = await runBillingReminders(leadDays);
          // Ta sama doba: domykamy karencje miejsc zespołowych, którym minął
          // termin - dostęp gaśnie dopiero tutaj, wraz z mailem końcowym.
          const { expireSeatGrace } = await import("@/lib/organizations/teamSeats.server");
          const seats = await expireSeatGrace().catch(() => ({ expired: 0, notified: 0 }));
          return json({ ok: true, leadDays, ...result, seatGrace: seats });
        } catch (err) {
          console.error("[billing-cron] failed", err);
          return json({ error: "cron_failed" }, 500);
        }

      },
    },
  },
});
