// Core Web Vitals (RUM) ingest endpoint. The client beacons metrics here via
// navigator.sendBeacon (see src/lib/webVitals.ts) when no external observability
// endpoint is configured. Fire-and-forget: every path returns 204 and ingest
// errors are swallowed, so a missing table / cold service role never surfaces to
// the beacon. Stored server-side via the admin client (RLS denies other roles).
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createRateLimiter, clientIpFromHeaders } from "@/lib/http/rateLimit";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";
import { currentTenantHost } from "@/lib/http/requestHost";

const VALID_METRICS = new Set(["LCP", "CLS", "INP", "FCP", "TTFB", "FID"]);
// A page load emits ~6 vitals; SPA navigations add a few more. 60-token burst
// with 1/sec sustained refill is generous for any real client and throttles a
// flood from a single spoofing source.
const limiter = createRateLimiter({ capacity: 60, refillPerSec: 1 });
// Vitals payloads are tiny; anything larger is junk or an attack - drop it
// before parsing.
const MAX_BODY = 2_000;

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/public/vitals")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const req = getRequest();
          if (!limiter.check(clientIpFromHeaders(req.headers), Date.now())) return noContent();
          // sendBeacon sends a JSON string (content-type text/plain), so read raw.
          const raw = await req.text();
          if (!raw || raw.length > MAX_BODY) return noContent();
          const body = JSON.parse(raw) as Record<string, unknown>;

          const metric = String(body.name ?? "");
          const value = Number(body.value);
          if (!VALID_METRICS.has(metric) || !Number.isFinite(value)) return noContent();

          const rating = typeof body.rating === "string" ? body.rating.slice(0, 32) : null;
          const path = typeof body.url === "string" ? body.url.slice(0, 512) : null;

          // Attribute the sample to the browsed host's tenant so per-tenant RUM
          // stays isolated. The service-role client sends no x-tenant-host, so
          // the column default (public_tenant_id() -> default tenant) can't infer
          // it; resolve it here. Best-effort: on failure the row still lands under
          // the default tenant via the column default rather than being dropped.
          let tenantId: string | null = null;
          try {
            tenantId = await resolveTenantIdForHost(await currentTenantHost());
          } catch {
            // keep tenantId null -> column default applies
          }

          // `web_vitals` is created by a migration not yet reflected in the
          // generated Supabase types, so the table name/payload are cast here.
          await supabaseAdmin.from("web_vitals" as never).insert({
            metric,
            value,
            rating,
            path,
            ...(tenantId ? { tenant_id: tenantId } : {}),
          } as never);
        } catch {
          // Ingest is best-effort - never error the beacon.
        }
        return noContent();
      },
    },
  },
});
