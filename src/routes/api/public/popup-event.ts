// Popup view/conversion beacon ingest. PopupHost beacons here via
// navigator.sendBeacon. Fire-and-forget: every path returns 204 and ingest
// errors are swallowed. Stored server-side via the admin client (RLS denies
// other roles). Mirrors /api/public/vitals.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { createRateLimiter, clientIpFromHeaders } from "@/lib/http/rateLimit";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";
import { currentTenantHost } from "@/lib/http/requestHost";

const VALID_KINDS = new Set(["view", "conversion"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const limiter = createRateLimiter({ capacity: 30, refillPerSec: 0.5 });
const MAX_BODY = 1_000;

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/public/popup-event")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const req = getRequest();
          if (!limiter.check(clientIpFromHeaders(req.headers), Date.now())) return noContent();
          const raw = await req.text();
          if (!raw || raw.length > MAX_BODY) return noContent();
          const body = JSON.parse(raw) as Record<string, unknown>;

          const kind = String(body.kind ?? "");
          const popupId = typeof body.popup_id === "string" ? body.popup_id : "";
          if (!VALID_KINDS.has(kind) || !UUID_RE.test(popupId)) return noContent();

          let tenantId: string | null = null;
          try {
            tenantId = await resolveTenantIdForHost(await currentTenantHost());
          } catch {
            // keep tenantId null -> column default applies
          }

          // `popup_events` is not yet in the generated Supabase types (cast).
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.from("popup_events" as never).insert({
            popup_id: popupId,
            kind,
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
