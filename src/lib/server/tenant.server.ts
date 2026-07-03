// Host -> tenant resolution for the public path (server-only).
//
// Every service-role public surface (sitemap.xml, rss.xml, news-sitemap.xml,
// llms.txt, the redirect middleware, the 404 monitor) MUST scope its reads by
// the tenant that owns the request host - the service role bypasses RLS, so
// without this filter a second tenant's content leaks across sites.
//
// Two resolution contracts, matching two very different failure costs:
//
//   * CONTENT plane (resolveTenantForHost): unknown host -> DEFAULT tenant.
//     Previews and not-yet-claimed domains must still render a site; the anon
//     database plane (public.public_tenant_id()) applies the same fallback,
//     so HTML and data always agree.
//
//   * CRAWLER plane (resolveCrawlerTenantForHost): FAIL-CLOSED. The fallback
//     is allowed only for local/platform preview hosts, or while no tenant
//     has claimed any custom domain yet (single-tenant bootstrap - there is
//     nothing to cross-leak). Any other unknown host resolves to null and the
//     surface answers 404 / "Disallow: /" - an unclaimed domain must never
//     advertise, serve or index a tenant's content to crawlers.
//
// The full tenant directory is tiny and changes rarely, so it is cached per
// isolate with a short TTL (same pattern as the redirect rules cache) and
// resolution never adds a per-request round-trip in steady state.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isPreviewHost, normalizeHost, wwwToggledHost } from "@/lib/http/host";

export { normalizeHost } from "@/lib/http/host";

export interface TenantDirectoryEntry {
  id: string;
  slug: string;
  domain: string | null;
  isDefault: boolean;
}

export interface TenantDirectory {
  byDomain: ReadonlyMap<string, TenantDirectoryEntry>;
  defaultTenant: TenantDirectoryEntry | null;
}

const CACHE_TTL_MS = 60_000;

interface DirectoryCache {
  at: number;
  directory: TenantDirectory;
}

let cache: DirectoryCache | null = null;
let inflight: Promise<TenantDirectory> | null = null;

const EMPTY_DIRECTORY: TenantDirectory = {
  byDomain: new Map<string, TenantDirectoryEntry>(),
  defaultTenant: null,
};

function buildDirectory(rows: readonly TenantDirectoryEntry[]): TenantDirectory {
  const byDomain = new Map<string, TenantDirectoryEntry>();
  let defaultTenant: TenantDirectoryEntry | null = null;
  for (const row of rows) {
    if (row.domain) byDomain.set(row.domain.toLowerCase(), row);
    if (row.isDefault) defaultTenant = row;
  }
  // A deployment without an explicit default still needs a deterministic
  // fallback - a single-tenant install behaves exactly as before.
  if (!defaultTenant && rows.length === 1) defaultTenant = rows[0];
  return { byDomain, defaultTenant };
}

async function loadDirectory(): Promise<TenantDirectory> {
  try {
    const { data, error } = await supabaseAdmin
      .from("tenants")
      .select("id, slug, domain, is_default")
      .limit(500);
    if (error) throw error;
    return buildDirectory(
      (data ?? []).map((t) => ({
        id: t.id,
        slug: t.slug,
        domain: t.domain,
        isDefault: t.is_default,
      })),
    );
  } catch (e) {
    console.warn("[tenant] directory load failed:", e);
    return cache?.directory ?? EMPTY_DIRECTORY;
  }
}

/** Cached tenant directory; concurrent cold requests share one round-trip. */
export async function getTenantDirectory(): Promise<TenantDirectory> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.directory;
  if (!inflight) {
    inflight = loadDirectory().then((directory) => {
      cache = { at: Date.now(), directory };
      inflight = null;
      return directory;
    });
  }
  return inflight;
}

/** Test hook: drop the per-isolate cache. */
export function invalidateTenantDirectoryCache(): void {
  cache = null;
  inflight = null;
}

/** Exact domain match, then the "www." alias of the apex (and vice versa). */
function matchDomain(directory: TenantDirectory, host: string | null): TenantDirectoryEntry | null {
  if (!host) return null;
  return directory.byDomain.get(host) ?? directory.byDomain.get(wwwToggledHost(host)) ?? null;
}

/**
 * CONTENT plane: resolve the tenant owning a request host. Unknown hosts fall
 * back to the default tenant (previews / unclaimed domains still render a
 * site); null only when the directory is empty/unavailable (callers then skip
 * tenant-scoped side effects rather than mixing tenants).
 */
export async function resolveTenantForHost(
  rawHost: string | null | undefined,
): Promise<TenantDirectoryEntry | null> {
  const directory = await getTenantDirectory();
  return matchDomain(directory, normalizeHost(rawHost)) ?? directory.defaultTenant;
}

/** Convenience: content-plane tenant id for a host (null when unresolvable). */
export async function resolveTenantIdForHost(
  rawHost: string | null | undefined,
): Promise<string | null> {
  const tenant = await resolveTenantForHost(rawHost);
  return tenant?.id ?? null;
}

/**
 * CRAWLER plane: fail-closed host -> tenant resolution for the surfaces
 * crawlers consume and cache (sitemap.xml, rss.xml, news-sitemap.xml,
 * llms.txt, robots.txt) and for the redirect/404 middleware.
 *
 * The default-tenant fallback applies ONLY when the ambiguity is harmless:
 *   * the host is a local/platform preview (admins test the default site), or
 *   * no tenant has claimed any custom domain yet (pre-multi-domain install -
 *     routing cannot distinguish tenants, so there is nothing to leak).
 * Every other unknown host returns null and the caller must answer 404 /
 * "Disallow: /" instead of exposing the default tenant's content on an
 * unclaimed domain.
 */
export async function resolveCrawlerTenantForHost(
  rawHost: string | null | undefined,
): Promise<TenantDirectoryEntry | null> {
  const directory = await getTenantDirectory();
  const host = normalizeHost(rawHost);
  const matched = matchDomain(directory, host);
  if (matched) return matched;
  const fallbackIsSafe = isPreviewHost(host) || directory.byDomain.size === 0;
  return fallbackIsSafe ? directory.defaultTenant : null;
}

/** Convenience: crawler-plane tenant id for a host (null = fail closed). */
export async function resolveCrawlerTenantIdForHost(
  rawHost: string | null | undefined,
): Promise<string | null> {
  const tenant = await resolveCrawlerTenantForHost(rawHost);
  return tenant?.id ?? null;
}
