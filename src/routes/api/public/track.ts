// Ingest zdarzeń analitycznych. Klient (src/lib/analytics/track.ts)
// wysyła batch `sendBeacon`em; ten route waliduje, ogranicza rate limit
// i zapisuje do public.analytics_events przez klienta service_role.
// Odpowiedź zawsze 204 - beacony nie mogą blokować/psuć nawigacji.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { createRateLimiter, clientIpFromHeaders } from "@/lib/http/rateLimit";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";
import { currentTenantHost } from "@/lib/http/requestHost";
import { redactUrl } from "@/lib/observability/redact";

const MAX_BODY = 32_000;
const MAX_EVENTS = 40;
const MAX_STRING = 512;
const MAX_META_BYTES = 4_000;

const ALLOWED_TYPES = new Set([
  "page_view",
  "cta_click",
  "view",
  "search",
  "interaction",
  "impression",
]);
const ALLOWED_ENTITIES = new Set([
  "post",
  "page",
  "author",
  "expert",
  "tag",
  "category",
  "tier",
  "plan",
  "banner",
  "widget",
  "search_query",
  "cta",
  "menu",
]);

const limiter = createRateLimiter({ capacity: 120, refillPerSec: 2 });

interface IncomingEvent {
  type?: unknown;
  name?: unknown;
  entity_type?: unknown;
  entity_id?: unknown;
  meta?: unknown;
  path?: unknown;
  referrer?: unknown;
  session_id?: unknown;
  anon_id?: unknown;
  lang?: unknown;
  ts?: unknown;
}

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

function truncate(v: unknown, n = MAX_STRING): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, n) : null;
}

function safeMeta(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  try {
    const json = JSON.stringify(v);
    if (json.length > MAX_META_BYTES) return {};
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const Route = createFileRoute("/api/public/track")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const req = getRequest();
          if (!limiter.check(clientIpFromHeaders(req.headers), Date.now())) return noContent();
          const raw = await req.text();
          if (!raw || raw.length > MAX_BODY) return noContent();
          const parsed = JSON.parse(raw) as { events?: IncomingEvent[] };
          const events = Array.isArray(parsed.events) ? parsed.events.slice(0, MAX_EVENTS) : [];
          if (events.length === 0) return noContent();

          let tenantId: string | null = null;
          try {
            tenantId = await resolveTenantIdForHost(await currentTenantHost());
          } catch {
            // fallback to column default
          }

          const ua = truncate(req.headers.get("user-agent"), 300);
          const rows: Record<string, unknown>[] = [];
          for (const e of events) {
            const name = truncate(e.name, 120);
            if (!name) continue;
            const type = truncate(e.type, 40) ?? "interaction";
            if (!ALLOWED_TYPES.has(type)) continue;
            const entityTypeRaw = truncate(e.entity_type, 40);
            const entityType =
              entityTypeRaw && ALLOWED_ENTITIES.has(entityTypeRaw) ? entityTypeRaw : null;
            rows.push({
              event_type: type,
              event_name: name,
              entity_type: entityType,
              entity_id: truncate(e.entity_id, 120),
              path: redactUrl(truncate(e.path, 512)),
              referrer: redactUrl(truncate(e.referrer, 512)),
              session_id: truncate(e.session_id, 80),
              anon_id: truncate(e.anon_id, 80),
              lang: truncate(e.lang, 8),
              meta: safeMeta(e.meta),
              ua,
              ...(tenantId ? { tenant_id: tenantId } : {}),
            });
          }
          if (rows.length === 0) return noContent();

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.from("analytics_events" as never).insert(rows as never);
        } catch {
          // Ingest jest best-effort - nigdy nie zwracamy błędu.
        }
        return noContent();
      },
    },
  },
});
