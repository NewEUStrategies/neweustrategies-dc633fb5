// Publiczny odczyt aktualnego kursu EUR/PLN z NBP (tabela A). Klient korzysta
// z tego endpointu do rozgrzania własnego cache modułu `fxRate.ts` - i tak
// jednocześnie NBP fetchuje serwer w server functions billingu, więc mamy
// jedno wspólne źródło prawdy i mniejsze ryzyko rate-limitów NBP przy
// równoległych klientach. Cache-Control 6 h, tyle samo co TTL w module.
//
// Rate limit: 30 req/min per IP dla GET (żeby botom nie opłacało się bić po
// NBP przez nasz endpoint) i 6/min per admin dla POST (ręczne odświeżenie).
// GET fail-open: przy blipie DB wolimy oddać kurs niż zablokować checkout.
// POST fail-closed: tu odmowa jest pożądana - nie chcemy pozwolić na spam
// forced-refresh nawet w awarii licznika.
import { createFileRoute } from "@tanstack/react-router";
import { ensureFxRateLoaded, forceRefreshFxRate, getFxState } from "@/lib/billing/fxRate";
import { rateLimit, guardRateLimit } from "@/lib/server/rate-limit.server";
import { RateLimitError } from "@/lib/errors/serverErrors";

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? "unknown";
}

function buildPayload(status: "ok" | "stale" | "fallback") {
  const s = getFxState();
  return {
    status,
    eurPln: s.eurPln,
    effectiveDate: s.effectiveDate,
    source: s.source,
    fetchedAt: s.fetchedAt ? new Date(s.fetchedAt).toISOString() : null,
    lastSuccessAt: s.lastSuccessAt ? new Date(s.lastSuccessAt).toISOString() : null,
    lastError: s.lastError,
    lastAttempts: s.lastAttempts,
    stale: s.stale,
  };
}

function jsonResponse(body: object, status: number, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export const Route = createFileRoute("/api/public/fx-rate")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ip = clientIp(request);
        const allowed = await rateLimit({
          scope: "fx-rate:get",
          subjectId: ip,
          max: 30,
          windowMinutes: 1,
          failClosed: false,
        });
        if (!allowed) {
          return jsonResponse(
            { status: "rate_limited", message: "Too many requests. Try again in a minute." },
            429,
            { "Retry-After": "60", "Cache-Control": "no-store" },
          );
        }
        await ensureFxRateLoaded();
        const s = getFxState();
        const status = s.source === "nbp" ? (s.stale ? "stale" : "ok") : "fallback";
        // Klient/CDN: krótszy okres publicznego cache niż w module, żeby świeży
        // fetch NBP po awarii mógł się propagować w rozsądnym czasie.
        const cacheControl =
          status === "ok"
            ? "public, max-age=1800, s-maxage=21600"
            : "public, max-age=60, s-maxage=60";
        return jsonResponse(buildPayload(status), 200, { "Cache-Control": cacheControl });
      },
      POST: async ({ request }) => {
        // Ręczne odświeżenie - admin only. Weryfikacja bearer tokenu przez
        // authenticated supabase client, potem sprawdzenie roli 'admin' przez
        // security-definer `has_role`, dokładnie tak jak w server-fn adminowych.
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.toLowerCase().startsWith("bearer ")
          ? auth.slice("bearer ".length).trim()
          : "";
        if (!token) {
          return jsonResponse({ status: "unauthorized", message: "Missing bearer token." }, 401);
        }
        const { createClient } = await import("@supabase/supabase-js");
        const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          },
        );
        const { data: userData, error: userErr } = await supabase.auth.getUser(token);
        if (userErr || !userData.user) {
          return jsonResponse({ status: "unauthorized", message: "Invalid session." }, 401);
        }
        const userId = userData.user.id;
        const { data: isAdmin } = await supabase.rpc("has_role", {
          _user_id: userId,
          _role: "admin",
        });
        if (isAdmin !== true) {
          return jsonResponse({ status: "forbidden", message: "Admin role required." }, 403);
        }
        try {
          await guardRateLimit(
            { scope: "fx-rate:force", subjectId: userId, max: 6, windowMinutes: 1, failClosed: true },
            60,
          );
        } catch (err) {
          if (err instanceof RateLimitError) {
            return jsonResponse(
              { status: "rate_limited", message: "Refresh limit reached; wait a minute." },
              429,
              { "Retry-After": "60", "Cache-Control": "no-store" },
            );
          }
          throw err;
        }
        await forceRefreshFxRate();
        const s = getFxState();
        const status = s.source === "nbp" && !s.lastError ? "ok" : "fallback";
        return jsonResponse(buildPayload(status), 200, { "Cache-Control": "no-store" });
      },
    },
  },
});
