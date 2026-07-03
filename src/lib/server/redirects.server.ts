// Server-side redirect engine: caches the enabled redirect rules PER TENANT
// per isolate (30s TTL, resilient to DB errors), matches incoming requests via
// the pure core in @/lib/seo/redirects, and records hits / 404s fire-and-forget
// so the hot path never waits on Supabase. Consumed by the request middleware
// in src/start.ts, which resolves the tenant from the request host first -
// rules of one tenant can never capture another tenant's traffic.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildRedirectIndex,
  matchRedirect,
  type RedirectIndex,
  type RedirectMatch,
} from "@/lib/seo/redirects";
import { createRateLimiter } from "@/lib/http/rateLimit";

const CACHE_TTL_MS = 30_000;

interface RulesCache {
  at: number;
  index: RedirectIndex;
}

const cacheByTenant = new Map<string, RulesCache>();
const inflightByTenant = new Map<string, Promise<RedirectIndex>>();

const EMPTY_INDEX = buildRedirectIndex([]);

async function loadIndex(tenantId: string): Promise<RedirectIndex> {
  try {
    const { data, error } = await supabaseAdmin
      .from("redirects")
      .select("id, source_path, target_path, status_code")
      .eq("tenant_id", tenantId)
      .eq("is_enabled", true)
      .limit(10_000);
    if (error) throw error;
    return buildRedirectIndex(data ?? []);
  } catch (e) {
    console.warn("[redirects] rules load failed:", e);
    // Keep serving the previous snapshot on transient failures.
    return cacheByTenant.get(tenantId)?.index ?? EMPTY_INDEX;
  }
}

/** Cached redirect index for a tenant; concurrent cold requests share one round-trip. */
export async function getRedirectIndex(tenantId: string): Promise<RedirectIndex> {
  const now = Date.now();
  const cached = cacheByTenant.get(tenantId);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.index;
  let inflight = inflightByTenant.get(tenantId);
  if (!inflight) {
    inflight = loadIndex(tenantId).then((index) => {
      cacheByTenant.set(tenantId, { at: Date.now(), index });
      inflightByTenant.delete(tenantId);
      return index;
    });
    inflightByTenant.set(tenantId, inflight);
  }
  return inflight;
}

/** Test/admin hook: drop the per-isolate cache after mutations. */
export function invalidateRedirectCache(): void {
  cacheByTenant.clear();
  inflightByTenant.clear();
}

/** Match a request path against the tenant's cached rules. */
export async function resolveRedirect(
  tenantId: string,
  pathname: string,
  search: string,
): Promise<RedirectMatch | null> {
  const index = await getRedirectIndex(tenantId);
  return matchRedirect(index, pathname, search);
}

/** Fire-and-forget hit counter - never blocks or fails the redirect. */
export function recordRedirectHit(id: string): void {
  void supabaseAdmin.rpc("record_redirect_hit", { _id: id }).then(({ error }) => {
    if (error) console.warn("[redirects] hit record failed:", error.message);
  });
}

// 404 logging: token bucket keeps a scanner flood from turning into a DB write
// flood (per isolate - a mitigation, not a hard quota, same trade as vitals).
const log404Limiter = createRateLimiter({ capacity: 30, refillPerSec: 0.5 });

/** Static-asset probes that would only add noise to the 404 monitor. */
const ASSET_EXT_RE =
  /\.(js|mjs|css|map|json|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|pdf|zip)$/i;

export function shouldLog404(pathname: string): boolean {
  if (pathname.length > 500) return false;
  if (ASSET_EXT_RE.test(pathname)) return false;
  if (pathname.startsWith("/.well-known/")) return false;
  return true;
}

/** Fire-and-forget, tenant-scoped 404 recording for the admin "recent 404s" monitor. */
export function recordSeo404(
  tenantId: string,
  pathname: string,
  search: string,
  referrer: string | null,
): void {
  if (!shouldLog404(pathname)) return;
  if (!log404Limiter.check("global", Date.now())) return;
  const path = `${pathname}${search}`.slice(0, 500);
  void supabaseAdmin
    .rpc("record_seo_404", { _tenant_id: tenantId, _path: path, _referrer: referrer ?? undefined })
    .then(({ error }) => {
      if (error) console.warn("[redirects] 404 record failed:", error.message);
    });
}
