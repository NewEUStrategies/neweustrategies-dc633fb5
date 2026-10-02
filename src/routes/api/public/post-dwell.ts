// Ingest czasu czytania wpisu: POST /api/public/post-dwell.
//
// Przeglądarka (`src/lib/views/postDwell.ts`) wysyła tu `sendBeacon`em czas
// AKTYWNEGO czytania odsłony, którą `useRecordPostView` już policzył pod zgodą
// analityczną. Zapis idzie przez RPC `record_post_dwell` (WYŁĄCZNIE
// service_role, migracja 20261002120000), które trafia najnowszą odsłonę
// (wpis, viewer_hash) najemcy z ostatnich 2 h, przyjmuje tylko wartość większą
// od zapisanej i przycina ją do czasu, jaki od tej odsłony upłynął. Z tych
// zapisów powstaje mediana `related_posts_dwell` - sygnał dwell rekomendacji.
//
// Odpowiedź to ZAWSZE 204 bez cache, wyjątki są połykane: beacon nie czyta
// odpowiedzi, a różny kod zdradzałby, które pary (wpis, viewer_hash) istnieją.
//
// ŚCIANY (każda ma test w `-post-dwell.test.ts`, patrzący na SKUTEK - czy RPC
// w ogóle poleciało i z czym), wzorem `sponsor-event.ts`:
//   1. limiter po adresie (`clientIpFromHeaders` - jedyne dopuszczone źródło IP);
//   2. zaufany host strony (`currentTenantHost()`); bez niego nic nie zapisujemy;
//   3. filtr ruchu nieludzkiego (`isLikelyBotRequest`: agent, prefetch i `Origin`
//      inny niż ZAUFANY host - obca strona nie zgłosi czasu przeglądarką gościa);
//   4. limit długości ciała i kształt: uuid wpisu, `viewer_hash` 16-64 znaki,
//      czas jako liczba całkowita 1 s - 30 min;
//   5. najemca z TEGO SAMEGO zaufanego hosta; nierozpoznany = odrzucenie.
// Do bazy nie trafia ani adres IP, ani user-agent.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";

import { isLikelyBotRequest } from "@/lib/http/botFilter";
import { clientIpFromHeaders, createRateLimiter } from "@/lib/http/rateLimit";
import { currentTenantHost } from "@/lib/http/requestHost";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";
import { POST_DWELL_MAX_BODY, parsePostDwellBeacon } from "@/lib/views/postDwellWire";

// Strona zgłasza czas przy schowaniu karty, `pagehide` i przejściu do innego
// wpisu - kilka beaconów na odsłonę. 60 w zapasie z odnową 1/s to dużo dla
// człowieka i mało dla zalewu z jednego adresu.
const limiter = createRateLimiter({ capacity: 60, refillPerSec: 1 });

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/public/post-dwell")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const req = getRequest();
          if (!limiter.check(clientIpFromHeaders(req.headers), Date.now())) return noContent();
          // Klient service role nie niesie `x-tenant-host` - host strony bierzemy
          // raz, z zaufanego rozwiązania, i z nim porównujemy `Origin` oraz
          // z niego wyprowadzamy najemcę.
          const trustedHost = await currentTenantHost();
          if (trustedHost === null) return noContent();
          if (isLikelyBotRequest(req.headers, trustedHost)) return noContent();

          const raw = await req.text();
          if (!raw || raw.length > POST_DWELL_MAX_BODY) return noContent();
          const beacon = parsePostDwellBeacon(JSON.parse(raw));
          if (beacon === null) return noContent();

          const tenantId = await resolveTenantIdForHost(trustedHost);
          if (!tenantId) return noContent();

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.rpc("record_post_dwell", {
            _tenant_id: tenantId,
            _post_id: beacon.postId,
            _viewer_hash: beacon.viewerHash,
            _dwell_ms: beacon.dwellMs,
          });
        } catch {
          // Ingest jest best-effort - beacon nigdy nie dostaje błędu.
        }
        return noContent();
      },
    },
  },
});
