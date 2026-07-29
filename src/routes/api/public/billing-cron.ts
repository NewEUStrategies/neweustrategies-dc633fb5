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

function secretMatches(provided: string | null): boolean {
  const expected = process.env.BILLING_CRON_SECRET || process.env.COMMUNITY_CRON_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/billing-cron")({
  server: {
    handlers: {
      POST: async () => {
        const req = getRequest();
        if (!limiter.check(clientIpFromHeaders(req.headers), Date.now())) {
          return new Response(null, { status: 429 });
        }
        if (!secretMatches(req.headers.get("x-billing-cron-secret"))) {
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
          return json({ ok: true, leadDays, ...result });
        } catch (err) {
          console.error("[billing-cron] failed", err);
          return json({ error: "cron_failed" }, 500);
        }
      },
    },
  },
});
