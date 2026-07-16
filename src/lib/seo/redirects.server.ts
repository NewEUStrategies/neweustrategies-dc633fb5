// Server-only glue for the redirect manager + 404 monitor. This module is what
// wires the pure matcher in `@/lib/seo/redirects` into the actual SSR request
// path (via `src/start.ts`). Without it the admin UI (/admin/redirects) and
// its rules table are dead metadata: users can add rules, but requests never
// see them and post-WP migration 404s stay 404 - which was the reported bug.
//
// Design constraints (per the security-headers middleware note in start.ts):
//
//   * Middleware MUST NOT crash the SSR chain. Every DB touch is wrapped so a
//     transient Supabase failure degrades to "no redirect / no logging",
//     never a 500 on a document request.
//
//   * DB lookups are cached per isolate (short TTL, per tenant) so a hot page
//     never adds a round-trip. Cache is invalidated by version bump; the
//     admin functions do NOT need to poke the middleware.
//
//   * Redirect rules and 404 hits are scoped by request-host tenant (service
//     role bypasses RLS, so this filter is what stops cross-tenant leakage).
//
//   * Only text/html 404s from the router feed the monitor - asset / API /
//     sitemap 404s are noise. `.` in the last segment is treated as a static
//     asset (favicon.ico, robots.txt, sitemap.xml). `?` query is preserved
//     on the stored path so WP shortlinks (`/?p=123`) show up individually.
import { resolveTenantForHost } from "@/lib/server/tenant.server";
import {
  buildRedirectIndex,
  isProtectedPath,
  matchRedirect,
  type RedirectIndex,
  type RedirectRule,
} from "@/lib/seo/redirects";

// ---------------------------------------------------------------------------
// Per-tenant redirect index cache
// ---------------------------------------------------------------------------

interface CachedIndex {
  at: number;
  index: RedirectIndex;
  count: number;
}

const REDIRECT_CACHE_TTL_MS = 30_000;
const cache = new Map<string, CachedIndex>();
const inflight = new Map<string, Promise<RedirectIndex>>();

/** Test hook - drop every cached tenant index. */
export function invalidateRedirectCache(): void {
  cache.clear();
  inflight.clear();
}

async function loadIndexForTenant(tenantId: string): Promise<RedirectIndex> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("redirects")
      .select("id, source_path, target_path, status_code")
      .eq("tenant_id", tenantId)
      .eq("is_enabled", true)
      .limit(5000);
    if (error) throw error;
    const rules: RedirectRule[] = (data ?? []).map((row) => ({
      id: row.id as string,
      source_path: row.source_path as string,
      target_path: row.target_path as string,
      status_code: row.status_code as number,
    }));
    return buildRedirectIndex(rules);
  } catch (e) {
    console.warn("[redirects] index load failed:", e);
    // Stale cache is preferable to hard-failing every request while Supabase
    // is degraded; empty when nothing is cached yet.
    return cache.get(tenantId)?.index ?? buildRedirectIndex([]);
  }
}

async function getIndexForTenant(tenantId: string): Promise<RedirectIndex> {
  const now = Date.now();
  const cached = cache.get(tenantId);
  if (cached && now - cached.at < REDIRECT_CACHE_TTL_MS) return cached.index;
  const pending = inflight.get(tenantId);
  if (pending) return pending;
  const p = loadIndexForTenant(tenantId).then((index) => {
    cache.set(tenantId, { at: Date.now(), index, count: index.exact.size + index.wildcards.length });
    inflight.delete(tenantId);
    return index;
  });
  inflight.set(tenantId, p);
  return p;
}

// ---------------------------------------------------------------------------
// Request-time helpers
// ---------------------------------------------------------------------------

/** Match a raw GET/HEAD request against the tenant's redirect rules. */
export async function resolveRedirectForRequest(request: Request): Promise<{
  target: string;
  status: number;
} | null> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  const url = new URL(request.url);
  if (isProtectedPath(url.pathname)) return null;
  const tenant = await resolveTenantForHost(url.hostname);
  if (!tenant) return null;
  const index = await getIndexForTenant(tenant.id);
  if (index.exact.size === 0 && index.wildcards.length === 0) return null;
  const hit = matchRedirect(index, url.pathname, url.search);
  if (!hit) return null;
  if (hit.gone) return { target: "", status: 410 };
  // Relative targets stay path-only; absolute (allow-listed) URLs are already
  // full URLs coming out of matchRedirect / normalizeTargetPath.
  return { target: hit.target, status: hit.statusCode };
}

// ---------------------------------------------------------------------------
// 404 monitor
// ---------------------------------------------------------------------------

const STATIC_ASSET_RE = /\.[a-z0-9]{1,8}(?:$|\?)/i;

function shouldLog404(pathname: string, contentType: string | null): boolean {
  if (!contentType || !contentType.includes("text/html")) return false;
  if (isProtectedPath(pathname)) return false;
  // Trailing-file paths (favicon.ico, /robots.txt, /some.pdf) are asset noise
  // even when a route accidentally rendered HTML.
  if (STATIC_ASSET_RE.test(pathname)) return false;
  if (pathname.length > 2048) return false;
  return true;
}

async function recordSeo404Hit(
  tenantId: string,
  path: string,
  referer: string | null,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Read-then-write is one extra hop, but seo_404_hits has no server-side
    // increment RPC and RLS is enforced by tenant_id anyway. The volume is
    // dominated by unique paths, not repeat hits, so this stays cheap.
    const { data: existing } = await supabaseAdmin
      .from("seo_404_hits")
      .select("hits")
      .eq("tenant_id", tenantId)
      .eq("path", path)
      .maybeSingle();
    const now = new Date().toISOString();
    const trimmedReferer = referer ? referer.slice(0, 2048) : null;
    if (existing) {
      await supabaseAdmin
        .from("seo_404_hits")
        .update({
          hits: (existing.hits as number) + 1,
          last_seen: now,
          last_referrer: trimmedReferer,
        })
        .eq("tenant_id", tenantId)
        .eq("path", path);
    } else {
      await supabaseAdmin.from("seo_404_hits").upsert(
        {
          tenant_id: tenantId,
          path,
          hits: 1,
          first_seen: now,
          last_seen: now,
          last_referrer: trimmedReferer,
        },
        { onConflict: "tenant_id,path" },
      );
    }
  } catch (e) {
    console.warn("[seo-404] log failed:", e);
  }
}

/** Fire-and-forget 404 logger; safe to `void` from middleware. */
export async function maybeLog404(request: Request, response: Response): Promise<void> {
  if (response.status !== 404) return;
  const url = new URL(request.url);
  const contentType = response.headers.get("content-type");
  if (!shouldLog404(url.pathname, contentType)) return;
  const tenant = await resolveTenantForHost(url.hostname);
  if (!tenant) return;
  const path = `${url.pathname}${url.search}`.slice(0, 2048);
  const referer = request.headers.get("referer") ?? request.headers.get("referrer");
  await recordSeo404Hit(tenant.id, path, referer);
}
