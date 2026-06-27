// Client error telemetry ingest endpoint. The browser beacons uncaught errors,
// unhandled rejections, and React error-boundary catches here via
// navigator.sendBeacon (see src/lib/observability/report.ts) when no external
// observability endpoint is configured. Fire-and-forget: every path returns 204
// and ingest errors are swallowed, so a missing table / cold service role never
// surfaces to the beacon. Stored server-side via the admin client (RLS denies
// other roles), mirroring /api/public/vitals.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const VALID_SOURCES = new Set(["onerror", "unhandledrejection", "react_error_boundary"]);

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

function clip(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
}

export const Route = createFileRoute("/api/public/client-errors")({
  server: {
    handlers: {
      POST: async () => {
        try {
          // sendBeacon sends a JSON string (content-type text/plain), so read raw.
          const raw = await getRequest().text();
          if (!raw || raw.length > 16_000) return noContent();
          const body = JSON.parse(raw) as Record<string, unknown>;

          const message = clip(body.message, 2000);
          if (!message) return noContent(); // a message is the minimum useful signal

          const source = typeof body.source === "string" && VALID_SOURCES.has(body.source) ? body.source : null;
          const stack = clip(body.stack, 8000);
          const path = clip(body.url ?? body.path, 512);
          // `meta` is bounded structured context (boundary label, component stack).
          let meta: Record<string, unknown> | null = null;
          if (body.meta && typeof body.meta === "object" && !Array.isArray(body.meta)) {
            const json = JSON.stringify(body.meta);
            if (json.length <= 4000) meta = body.meta as Record<string, unknown>;
          }

          // `client_errors` is created by a migration not yet reflected in the
          // generated Supabase types, so the table name/payload are cast here.
          await supabaseAdmin
            .from("client_errors" as never)
            .insert({ message, stack, source, path, meta } as never);
        } catch {
          // Ingest is best-effort - never error the beacon.
        }
        return noContent();
      },
    },
  },
});
