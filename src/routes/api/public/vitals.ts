// Core Web Vitals (RUM) ingest endpoint. The client beacons metrics here via
// navigator.sendBeacon (see src/lib/webVitals.ts) when no external observability
// endpoint is configured. Fire-and-forget: every path returns 204 and ingest
// errors are swallowed, so a missing table / cold service role never surfaces to
// the beacon. Stored server-side via the admin client (RLS denies other roles).
//
// TWO WIRE SHAPES, both permanent. The current client batches and posts
// `{metrics:[...]}`; a page cached before that change posts a single
// `{name,value,...}` object and may keep doing so for as long as it stays open.
// `incomingMetrics` normalizes both to a list, so neither is ever dropped.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { createRateLimiter, clientIpFromHeaders } from "@/lib/http/rateLimit";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";
import { currentTenantHost } from "@/lib/http/requestHost";
import { redactUrl } from "@/lib/observability/redact";

const VALID_METRICS = new Set(["LCP", "CLS", "INP", "FCP", "TTFB", "FID"]);
// The client batches (src/lib/webVitals.ts): one request carries FCP+TTFB at
// init, then one request per flush boundary carries LCP+CLS+INP - so a page
// load costs 1-2 requests, not the ~6 the pre-batch client sent, and a real
// client needs ~1-4 req/min rather than ~6 per load. Burst 20 absorbs a
// 20-route click-spree; 0.2/s sustained (12 req/min) times MAX_METRICS caps a
// single spoofing source at ~96 rows/min, the same order as the 60 rows/min
// the old 60/1 bucket allowed - the budget is denominated in ROWS, because a
// request that used to insert 1 row can now insert 8.
const limiter = createRateLimiter({ capacity: 20, refillPerSec: 0.2 });
// The client can only ever produce 5 distinct metrics per boundary pair
// (FCP, TTFB, LCP, CLS, INP); 8 leaves headroom without widening the flood
// ceiling. Must stay >= the client's own MAX_METRICS.
const MAX_METRICS = 8;
// Worst case per sample on the wire is ~640 chars: a 512-char `url` plus
// name (15) + value (28) + rating (28) + id (24) + ts (18) + braces/commas (7).
// Eight of those plus the {"metrics":[...]} wrapper is ~5 140 chars, so 8 000
// covers the batch with room to spare and still drops junk before parsing.
const MAX_BODY = 8_000;

interface IncomingVital {
  name?: unknown;
  value?: unknown;
  rating?: unknown;
  url?: unknown;
}

/**
 * Normalize both wire shapes to a list. BACKWARD COMPATIBILITY IS NOT
 * OPTIONAL: a page cached before the batching change - or one still open in a
 * background tab - beacons a single `{name,value,rating,id,url,ts}` object on
 * pagehide, possibly for days. That object is treated as a batch of one. The
 * current client sends `{metrics:[...]}`; a bare top-level array is accepted
 * too so a future transport change cannot silently drop data.
 */
function incomingMetrics(parsed: unknown): IncomingVital[] {
  if (Array.isArray(parsed)) return parsed as IncomingVital[];
  if (!parsed || typeof parsed !== "object") return [];
  const wrapped = (parsed as { metrics?: unknown }).metrics;
  if (Array.isArray(wrapped)) return wrapped as IncomingVital[];
  return [parsed as IncomingVital];
}

/**
 * Wartość metryki, albo `null` gdy próbka jest bezużyteczna.
 *
 * DLACZEGO NIE `Number(v)`. Tak było i tak przechodziło CISCHĄ ŚMIECIÓWKĘ:
 * `Number(null)`, `Number("")`, `Number(false)` i `Number([])` to ZERO, czyli
 * skończona liczba - więc beacon z `value: null` zapisywał LCP równe 0 ms z
 * oceną „good". Kilkanaście takich wierszy realnie POPRAWIA p75 na panelu, bo
 * percentyl liczony jest po surowych wierszach (`aggregate.ts`). Zero jest
 * przy tym LEGALNĄ wartością CLS (strona bez przesunięć), więc nie da się go
 * odsiać progiem - trzeba odróżnić „zmierzone zero" od „brak pomiaru", a to
 * robi się na TYPIE, nie na wartości.
 *
 * Napis jest przyjmowany świadomie: `JSON.stringify` klienta zawsze da liczbę,
 * ale zewnętrzny kolektor (`VITE_OBSERVABILITY_ENDPOINT` wskazujący tunel)
 * bywa źródłem liczb w cudzysłowie. Pusty i biały napis - nie.
 *
 * Wartość ujemna jest odrzucana: żadna z sześciu metryk nie może być mniejsza
 * od zera, a jedna ujemna próbka ciągnie p75 w dół.
 */
function metricValue(raw: unknown): number | null {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

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
          const parsed: unknown = JSON.parse(raw);
          const incoming = incomingMetrics(parsed).slice(0, MAX_METRICS);
          if (incoming.length === 0) return noContent();

          const rows: Record<string, unknown>[] = [];
          for (const sample of incoming) {
            const metric = String(sample?.name ?? "");
            const value = metricValue(sample?.value);
            // `continue`, not `return`: one malformed sample must not discard
            // the four good ones sharing its beacon. Validating per row is what
            // keeps batching from turning a partial payload into total loss.
            if (!VALID_METRICS.has(metric) || value === null) continue;
            rows.push({
              metric,
              value,
              rating: typeof sample.rating === "string" ? sample.rating.slice(0, 32) : null,
              // Strip query strings (may carry tokens/emails) before persisting.
              path: redactUrl(typeof sample.url === "string" ? sample.url.slice(0, 512) : null),
            });
          }
          // Validate BEFORE resolving the tenant: an all-junk batch must not
          // cost a directory lookup.
          if (rows.length === 0) return noContent();

          // Attribute the samples to the browsed host's tenant so per-tenant RUM
          // stays isolated. The service-role client sends no x-tenant-host, so
          // the column default (public_tenant_id() -> default tenant) can't infer
          // it; resolve it here - ONCE per batch, not once per sample.
          // Best-effort: on failure the rows still land under the default tenant
          // via the column default rather than being dropped.
          let resolved: string | null = null;
          try {
            resolved = await resolveTenantIdForHost(await currentTenantHost());
          } catch {
            // keep it null -> column default applies
          }
          const tenantId = resolved;
          const payload = tenantId ? rows.map((row) => ({ ...row, tenant_id: tenantId })) : rows;

          // `web_vitals` is created by a migration not yet reflected in the
          // generated Supabase types, so the table name/payload are cast here.
          // ONE multi-row insert for the whole batch (symmetric to
          // /api/public/track), replacing one round-trip per metric.
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.from("web_vitals").insert(payload as never);
        } catch {
          // Ingest is best-effort - never error the beacon.
        }
        return noContent();
      },
    },
  },
});
