// Core Web Vitals (RUM) ingest endpoint. The client beacons metrics here via
// navigator.sendBeacon (see src/lib/webVitals.ts) when no external observability
// endpoint is configured. Fire-and-forget: every path returns 204 and ingest
// errors are swallowed, so a missing table / cold service role never surfaces to
// the beacon. Stored server-side via the admin client (RLS denies other roles).
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const VALID_METRICS = new Set(["LCP", "CLS", "INP", "FCP", "TTFB", "FID"]);

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/public/vitals")({
  server: {
    handlers: {
      POST: async () => {
        try {
          // sendBeacon sends a JSON string (content-type text/plain), so read raw.
          const raw = await getRequest().text();
          if (!raw) return noContent();
          const body = JSON.parse(raw) as Record<string, unknown>;

          const metric = String(body.name ?? "");
          const value = Number(body.value);
          if (!VALID_METRICS.has(metric) || !Number.isFinite(value)) return noContent();

          const rating = typeof body.rating === "string" ? body.rating.slice(0, 32) : null;
          const path = typeof body.url === "string" ? body.url.slice(0, 512) : null;

          // `web_vitals` is created by a migration not yet reflected in the
          // generated Supabase types, so the table name/payload are cast here.
          await supabaseAdmin
            .from("web_vitals" as never)
            .insert({ metric, value, rating, path } as never);
        } catch {
          // Ingest is best-effort - never error the beacon.
        }
        return noContent();
      },
    },
  },
});
