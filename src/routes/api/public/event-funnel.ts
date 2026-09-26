// Ingest krokow lejka wydarzenia: POST /api/public/event-funnel.
//
// Klient (`src/lib/events/eventFunnelBeacon.ts`) wysyla `sendBeacon`em jeden
// krok: wizyte, rozpoczecie zapisu albo rozpoczecie platnosci. Endpoint jest
// publiczny, bez sesji i bez podpisu, wiec kazda sciezka konczy sie tym samym
// 204 `no-store`, a zapis idzie przez RPC `event_funnel_track` (WYLACZNIE
// service_role), ktore waliduje wszystko jeszcze raz.
//
// SCIANY (ta sama surowosc co `ad-event.ts`):
//   1. limiter po adresie (`clientIpFromHeaders`, 60 burst, 1/s);
//   2. limit dlugosci ciala (`EVENT_FUNNEL_MAX_BODY`);
//   3. automaty odfiltrowane po user-agencie;
//   4. walidacja ladunku (`parseEventFunnelBeacon`) - identyfikator klikniecia
//      tylko z `ad_consent: true`;
//   5. najemca z ZAUFANEGO hosta; nierozpoznany = odrzucenie (bez wpadania do
//      najemcy domyslnego); wydarzenie musi byc opublikowane W TYM najemcy
//      (sprawdza RPC).
// Do bazy nie trafia ani adres IP, ani user-agent - tylko kraj z naglowka
// warstwy brzegowej.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";

import { countryFromHeaders } from "@/lib/analytics/geoHeaders";
import {
  EVENT_FUNNEL_MAX_BODY,
  isBotUserAgent,
  parseEventFunnelBeacon,
} from "@/lib/events/eventFunnelWire";
import { clientIpFromHeaders, createRateLimiter } from "@/lib/http/rateLimit";
import { currentTenantHost } from "@/lib/http/requestHost";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";

// Strona wysyla najwyzej trzy kroki na wydarzenie i sesje; 60 zetonow z
// odnowa 1/s to duzo dla czlowieka i malo dla zalewu z jednego adresu.
const limiter = createRateLimiter({ capacity: 60, refillPerSec: 1 });

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

async function tenantOfRequest(): Promise<string | null> {
  try {
    return await resolveTenantIdForHost(await currentTenantHost());
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/event-funnel")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const req = getRequest();
          if (!limiter.check(clientIpFromHeaders(req.headers), Date.now())) return noContent();
          if (isBotUserAgent(req.headers.get("user-agent"))) return noContent();
          const raw = await req.text();
          if (raw === "" || raw.length > EVENT_FUNNEL_MAX_BODY) return noContent();
          const beacon = parseEventFunnelBeacon(JSON.parse(raw));
          if (beacon === null) return noContent();

          const tenantId = await tenantOfRequest();
          if (tenantId === null) return noContent();

          const country = countryFromHeaders(req.headers);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.rpc("event_funnel_track", {
            p_tenant: tenantId,
            p_payload: { ...beacon, ...(country === null ? {} : { country }) },
          });
        } catch {
          // Ingest jest best-effort - beacon nigdy nie dostaje bledu.
        }
        return noContent();
      },
    },
  },
});
