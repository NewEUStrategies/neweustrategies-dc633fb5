// Ingest ekspozycji sponsorów wydarzeń: POST /api/public/sponsor-event.
//
// Strona wydarzenia (`sponsorTracking.ts`) wysyła tu paczkę wyświetleń
// i kliknięć logotypów, materiałów i reklam - WYŁĄCZNIE po zgodzie
// marketingowej. Wzorzec z `/api/public/ad-event`: wyjątki są połykane,
// a odpowiedź to 204 bez cache - z JEDNYM wyjątkiem: gdy baza wydała nową
// sesję (paczka bez sesji albo z sesją bez ważnego podpisu), odpowiedź to
// 200 `{ session }` bez cache. Beacon odpowiedzi nie czyta; czyta ją
// pierwsza wysyłka trackera (`fetch` z `keepalive`). Sesja nie zdradza, które
// identyfikatory sponsorów istnieją - dostaje ją każda paczka opublikowanego
// wydarzenia, niezależnie od pozycji.
//
// ŚCIANY (każda ma test w `-sponsor-event.test.ts`, patrzący na SKUTEK - czy
// zapis do bazy w ogóle się odbył i z czym):
//   1. limiter po IP w pamięci izolatu (`rateLimitIpSubject`) - tani pierwszy
//      sito; GLOBALNY limit po adresie i wydarzeniu trzyma baza (pkt 7);
//   2. limit długości ciała;
//   3. zaufany host strony (`currentTenantHost()` - host zwalidowany względem
//      `tenants.domain`, także zza pośrednika z `X-Forwarded-Host`); bez niego
//      nic nie zapisujemy - host spoza katalogu najemców nie jest stroną
//      żadnego wydarzenia, a sponsor płaci za wyświetlenia (wcześniej brak
//      hosta degradował w `resolveTenantIdForHost` do najemcy DOMYŚLNEGO);
//   4. filtr ruchu nieludzkiego (`botFilter.ts`: agent, prefetch, `Origin`
//      inny niż ZAUFANY host - nie host z `req.url`, który za pośrednikiem
//      jest wewnętrzny i odrzucał każdy prawdziwy beacon);
//   5. kształt: slug, sesja (opcjonalna - jej brak to prośba o sesję), biała
//      lista miejsc i rodzajów, uuid, maks. 40 pozycji, macierz miejsce
//      x rodzaj (`isAcceptableExposure`);
//   6. najemca z TEGO SAMEGO zaufanego hosta - bez rozpoznanego najemcy nic
//      nie zapisujemy;
//   7. baza (`event_sponsor_exposure_ingest`, migracja 20261013111400) w jednej
//      podróży: limit paczek na adres i wydarzenie (`rate_limit_hit`),
//      weryfikacja podpisu sesji, najwyżej 50 unikalnych z adresu na dzień
//      (49 sesji + kubełek adresu, do którego liczą się dalsze sesje i sesje
//      niepodpisane), anomalie dla panelu oraz przynależność sponsora,
//      materiału i reklamy do TEGO opublikowanego wydarzenia - klient nie
//      przypisze wyświetlenia cudzemu sponsorowi ani nie nabije unikalnych
//      rotacją identyfikatora.
// Do bazy nie trafia IP ani agent: adres idzie jako SOLONY skrót
// (`requestRateSubject` - ta sama sól i ta sama jedyna definicja „kto dzwoni",
// co wszystkie limity po IP w repo), a sesja jako skrót z dniem.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";

import { createRateLimiter, rateLimitIpSubject } from "@/lib/http/rateLimit";
import { isLikelyBotRequest } from "@/lib/http/botFilter";
import { currentTenantHost } from "@/lib/http/requestHost";
import { requestRateSubject } from "@/lib/server/rateSubject.server";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";
import {
  SPONSOR_BATCH_MAX,
  SPONSOR_SESSION_PATTERN,
  UUID_PATTERN,
  exposureToWire,
  isAcceptableExposure,
  isSponsorExposureKind,
  isSponsorPlacement,
  issuedSponsorSession,
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

/** Sesja wydana przez bazę - jedyna odpowiedź z treścią. */
function sessionIssued(session: string): Response {
  return new Response(JSON.stringify({ session }), {
    status: 200,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
  });
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

/**
 * Sesja z ciała: brak (klucz pominięty albo `null`) = prośba o sesję serwera;
 * napis w szerokim kształcie idzie do bazy (podpis sprawdza baza, a stary
 * klient ma trafić do kubełka i anomalii); cokolwiek innego - paczka odpada.
 */
function parseSession(value: unknown): { ok: true; session: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, session: null };
  if (typeof value === "string" && SPONSOR_SESSION_PATTERN.test(value)) {
    return { ok: true, session: value };
  }
  return { ok: false };
}

export const Route = createFileRoute("/api/public/sponsor-event")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const req = getRequest();
          if (!limiter.check(rateLimitIpSubject(req.headers), Date.now())) return noContent();
          // Klient service role nie niesie `x-tenant-host` - host strony bierzemy
          // raz, z zaufanego rozwiązania, i z nim porównujemy `Origin` oraz
          // z niego wyprowadzamy najemcę.
          const trustedHost = await currentTenantHost();
          if (trustedHost === null) return noContent();
          if (isLikelyBotRequest(req.headers, trustedHost)) return noContent();

          const raw = await req.text();
          if (!raw || raw.length > MAX_BODY) return noContent();
          const body = JSON.parse(raw) as Record<string, unknown>;

          const slug = typeof body.event_slug === "string" ? body.event_slug : "";
          const session = parseSession(body.session);
          if (!SLUG_PATTERN.test(slug) || !session.ok) return noContent();
          if (!Array.isArray(body.items)) return noContent();

          const items = body.items
            .slice(0, SPONSOR_BATCH_MAX)
            .map(parseItem)
            .filter((item): item is SponsorExposureItem => item !== null);
          if (items.length === 0) return noContent();

          // Najemca z ZAUFANEGO hosta. Bez niego nie wiadomo, czyje to wydarzenie.
          let tenantId: string | null = null;
          try {
            tenantId = await resolveTenantIdForHost(trustedHost);
          } catch {
            tenantId = null;
          }
          if (!tenantId) return noContent();

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("event_sponsor_exposure_ingest", {
            p_tenant: tenantId,
            p_source: requestRateSubject(req.headers),
            p_payload: {
              event_slug: slug,
              ...(session.session === null ? {} : { session: session.session }),
              items: items.map(exposureToWire),
            },
          });
          if (error) return noContent();
          const issued = issuedSponsorSession(data);
          if (issued !== null) return sessionIssued(issued);
        } catch {
          // Ingest jest best-effort - beacon nigdy nie dostaje błędu.
        }
        return noContent();
      },
    },
  },
});
