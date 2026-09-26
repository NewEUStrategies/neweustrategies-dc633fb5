// Ingest ekspozycji sponsorów wydarzeń: POST /api/public/sponsor-event.
//
// Strona wydarzenia (`sponsorTracking.ts`) wysyła tu przez `sendBeacon` paczkę
// wyświetleń i kliknięć logotypów, materiałów i reklam - WYŁĄCZNIE po zgodzie
// marketingowej. Wzorzec 1:1 z `/api/public/ad-event`: odpowiedź to ZAWSZE
// 204 bez cache, wyjątki są połykane (beacon nie czyta odpowiedzi, a kod
// odpowiedzi zdradzałby, które identyfikatory istnieją).
//
// ŚCIANY (każda ma test w `-sponsor-event.test.ts`, patrzący na SKUTEK - czy
// zapis do bazy w ogóle się odbył i z czym):
//   1. limiter po IP (`clientIpFromHeaders` - jedyne dopuszczone źródło IP);
//   2. limit długości ciała;
//   3. filtr ruchu nieludzkiego (`botFilter.ts`: agent, prefetch, cudzy Origin);
//   4. kształt: slug, identyfikator sesji, biała lista miejsc i rodzajów,
//      uuid, maks. 40 pozycji, macierz miejsce x rodzaj (`isAcceptableExposure`);
//   5. najemca z ZAUFANEGO hosta - bez rozpoznanego najemcy nic nie zapisujemy
//      (zamiast wpadać do najemcy domyślnego);
//   6. przynależność sponsora, materiału i reklamy do TEGO opublikowanego
//      wydarzenia sprawdza baza (`event_sponsor_exposure_ingest`) w jednej
//      podróży - klient nie przypisze wyświetlenia cudzemu sponsorowi.
// Do bazy nie trafia IP, agent ani surowy identyfikator sesji.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";

import { createRateLimiter, clientIpFromHeaders } from "@/lib/http/rateLimit";
import { isLikelyBotRequest } from "@/lib/http/botFilter";
import { currentTenantHost } from "@/lib/http/requestHost";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";
import {
  SPONSOR_BATCH_MAX,
  SPONSOR_SESSION_PATTERN,
  UUID_PATTERN,
  exposureToWire,
  isAcceptableExposure,
  isSponsorExposureKind,
  isSponsorPlacement,
  type SponsorExposureItem,
} from "@/lib/events/sponsorExposure";

// Strona wysyła paczkę na bezczynność i przy każdym kliknięciu - 60 w zapasie
// z odnowieniem 1/s wystarcza każdemu człowiekowi, a dławi zalew z jednego IP.
const limiter = createRateLimiter({ capacity: 60, refillPerSec: 1 });
const MAX_BODY = 8_000;
const SLUG_PATTERN = /^[a-z0-9-]{3,120}$/;

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

/** Pozycja z ciała -> pozycja do zapisu albo `null`, gdy nie ma sensu jej słać. */
function parseItem(value: unknown): SponsorExposureItem | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!isSponsorPlacement(raw.placement) || !isSponsorExposureKind(raw.kind)) return null;
  const item: SponsorExposureItem = {
    sponsorId: uuidOrNull(raw.sponsor_id),
    placement: raw.placement,
    kind: raw.kind,
    materialId: uuidOrNull(raw.material_id),
    homeAdId: uuidOrNull(raw.home_ad_id),
  };
  return isAcceptableExposure(item) ? item : null;
}

export const Route = createFileRoute("/api/public/sponsor-event")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const req = getRequest();
          if (!limiter.check(clientIpFromHeaders(req.headers), Date.now())) return noContent();
          if (isLikelyBotRequest(req.headers, new URL(req.url).host)) return noContent();

          const raw = await req.text();
          if (!raw || raw.length > MAX_BODY) return noContent();
          const body = JSON.parse(raw) as Record<string, unknown>;

          const slug = typeof body.event_slug === "string" ? body.event_slug : "";
          const session = typeof body.session === "string" ? body.session : "";
          if (!SLUG_PATTERN.test(slug) || !SPONSOR_SESSION_PATTERN.test(session))
            return noContent();
          if (!Array.isArray(body.items)) return noContent();

          const items = body.items
            .slice(0, SPONSOR_BATCH_MAX)
            .map(parseItem)
            .filter((item): item is SponsorExposureItem => item !== null);
          if (items.length === 0) return noContent();

          // Najemca z ZAUFANEGO hosta (klient service role nie niesie
          // `x-tenant-host`). Bez niego nie wiadomo, czyje to wydarzenie.
          let tenantId: string | null = null;
          try {
            tenantId = await resolveTenantIdForHost(await currentTenantHost());
          } catch {
            tenantId = null;
          }
          if (!tenantId) return noContent();

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.rpc("event_sponsor_exposure_ingest", {
            p_tenant: tenantId,
            p_payload: { event_slug: slug, session, items: items.map(exposureToWire) },
          });
        } catch {
          // Ingest jest best-effort - beacon nigdy nie dostaje błędu.
        }
        return noContent();
      },
    },
  },
});
