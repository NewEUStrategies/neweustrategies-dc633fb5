// Ad impression/click beacon ingest. The AdSlot component beacons here via
// navigator.sendBeacon. Fire-and-forget: every path returns 204 and ingest
// errors are swallowed. Stored server-side via the admin client (RLS denies
// other roles). Mirrors /api/public/vitals.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { createRateLimiter, clientIpFromHeaders } from "@/lib/http/rateLimit";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";
import { currentTenantHost } from "@/lib/http/requestHost";
import { redactUrl } from "@/lib/observability/redact";

const VALID_KINDS = new Set(["impression", "click"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A page shows a handful of slots; 60-token burst with 1/sec refill is generous
// for any real client and throttles a flood from a single spoofing source.
const limiter = createRateLimiter({ capacity: 60, refillPerSec: 1 });
const MAX_BODY = 2_000;

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/public/ad-event")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const req = getRequest();
          if (!limiter.check(clientIpFromHeaders(req.headers), Date.now())) return noContent();
          // sendBeacon delivers a JSON string; read raw.
          const raw = await req.text();
          if (!raw || raw.length > MAX_BODY) return noContent();
          const body = JSON.parse(raw) as Record<string, unknown>;

          const kind = String(body.kind ?? "");
          const slotId = typeof body.slot_id === "string" ? body.slot_id : "";
          if (!VALID_KINDS.has(kind) || !UUID_RE.test(slotId)) return noContent();

          const placementId =
            typeof body.placement_id === "string" && UUID_RE.test(body.placement_id)
              ? body.placement_id
              : null;
          const path = redactUrl(typeof body.path === "string" ? body.path.slice(0, 512) : null);

          // Attribute to the browsed host's tenant (service-role client sends no
          // x-tenant-host). Bez rozwiazanego tenanta nie da sie bezpiecznie
          // przypisac zdarzenia - odrzucamy (zamiast wpadac do tenanta domyslnego).
          let tenantId: string | null = null;
          try {
            tenantId = await resolveTenantIdForHost(await currentTenantHost());
          } catch {
            tenantId = null;
          }
          if (!tenantId) return noContent();

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Weryfikacja wlasnosci: slot musi ISTNIEC i nalezec do tenanta hosta.
          // Bez tego dowolny klient POST-owalby falszywe impresje/kliki dla
          // dowolnego UUID slotu (zatruwanie metryk, takze cross-tenant).
          const { data: slot } = await supabaseAdmin
            .from("ad_slots")
            .select("id")
            .eq("id", slotId)
            .eq("tenant_id", tenantId)
            .maybeSingle();
          if (!slot) return noContent();

          // Placement (opcjonalny) musi wskazywac TEN slot w tym tenancie; w
          // przeciwnym razie zapisujemy zdarzenie bez placementu zamiast ufac
          // wartosci klienta.
          let verifiedPlacementId: string | null = null;
          if (placementId) {
            const { data: placement } = await supabaseAdmin
              .from("ad_placements")
              .select("id")
              .eq("id", placementId)
              .eq("slot_id", slotId)
              .eq("tenant_id", tenantId)
              .maybeSingle();
            if (placement) verifiedPlacementId = placementId;
          }

          // `ad_events` is not yet in the generated Supabase types (cast).
          await supabaseAdmin.from("ad_events" as never).insert({
            slot_id: slotId,
            placement_id: verifiedPlacementId,
            kind,
            path,
            tenant_id: tenantId,
          } as never);
        } catch {
          // Ingest is best-effort - never error the beacon.
        }
        return noContent();
      },
    },
  },
});
