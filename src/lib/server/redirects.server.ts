// Server-side redirect engine: caches the enabled redirect rules per isolate
// (30s TTL, resilient to DB errors), matches incoming requests via the pure
// core in @/lib/seo/redirects, and records hits / 404s fire-and-forget so the
// hot path never waits on Supabase. Consumed by the request middleware in
// src/start.ts.
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

let cache: RulesCache | null = null;
let inflight: Promise<RedirectIndex> | null = null;

const EMPTY_INDEX = buildRedirectIndex([]);

async function loadIndex(): Promise<RedirectIndex> {
  try {
    const { data, error } = await supabaseAdmin
      .from("redirects")
      .select("id, source_path, target_path, status_code")
      .eq("is_enabled", true)
      .limit(10_000);
    if (error) throw error;
    return buildRedirectIndex(data ?? []);
  } catch (e) {
    console.warn("[redirects] rules load failed:", e);
    // Keep serving the previous snapshot on transient failures.
    return cache?.index ?? EMPTY_INDEX;
  }
}

/** Cached redirect index; concurrent cold requests share one DB round-trip. */
export async function getRedirectIndex(): Promise<RedirectIndex> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.index;
  if (!inflight) {
    inflight = loadIndex().then((index) => {
      cache = { at: Date.now(), index };
      inflight = null;
      return index;
    });
  }
  return inflight;
}

/** Test/admin hook: drop the per-isolate cache after mutations. */
export function invalidateRedirectCache(): void {
  cache = null;
  inflight = null;
}

/** Match a request path against the cached rules. */
export async function resolveRedirect(
  pathname: string,
  search: string,
): Promise<RedirectMatch | null> {
  const index = await getRedirectIndex();
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

/** Fire-and-forget 404 recording for the admin "recent 404s" monitor. */
export function recordSeo404(pathname: string, search: string, referrer: string | null): void {
  if (!shouldLog404(pathname)) return;
  if (!log404Limiter.check("global", Date.now())) return;
  const path = `${pathname}${search}`.slice(0, 500);
  void supabaseAdmin
    .rpc("record_seo_404", { _path: path, _referrer: referrer ?? undefined })
    .then(({ error }) => {
      if (error) console.warn("[redirects] 404 record failed:", error.message);
    });
}
