// Host -> tenant resolution for the public path (server-only).
//
// Every service-role public surface (sitemap.xml, rss.xml, news-sitemap.xml,
// llms.txt, the redirect middleware, the 404 monitor) MUST scope its reads by
// the tenant that owns the request host - the service role bypasses RLS, so
// without this filter a second tenant's content leaks across sites.
//
// Resolution order:
//   1. exact match on tenants.domain (lowercased, port stripped),
//   2. the tenant marked is_default (the fallback for previews / localhost).
//
// The full tenant directory is tiny and changes rarely, so it is cached per
// isolate with a short TTL (same pattern as the redirect rules cache) and
// resolution never adds a per-request round-trip in steady state.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

/** Normalize a Host header / URL host: lowercase, strip port and brackets. */
export function normalizeHost(rawHost: string | null | undefined): string | null {
  if (!rawHost) return null;
  const host = rawHost.trim().toLowerCase();
  if (!host) return null;
  // IPv6 literals ("[::1]:8080") - keep the bracket content only.
  const bracketMatch = host.match(/^\[([^\]]+)\]/);
  if (bracketMatch) return bracketMatch[1];
  return host.split(":")[0] || null;
}

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

/**
 * Resolve the tenant owning a request host. Unknown hosts fall back to the
 * default tenant; null only when the directory is empty/unavailable (callers
 * then skip tenant-scoped side effects rather than mixing tenants).
 */
export async function resolveTenantForHost(
  rawHost: string | null | undefined,
): Promise<TenantDirectoryEntry | null> {
  const directory = await getTenantDirectory();
  const host = normalizeHost(rawHost);
  if (host) {
    const exact = directory.byDomain.get(host);
    if (exact) return exact;
    // "www." is treated as an alias of the apex domain (and vice versa).
    const aliased = host.startsWith("www.")
      ? directory.byDomain.get(host.slice(4))
      : directory.byDomain.get(`www.${host}`);
    if (aliased) return aliased;
  }
  return directory.defaultTenant;
}

/** Convenience: tenant id for a host (null when unresolvable). */
export async function resolveTenantIdForHost(
  rawHost: string | null | undefined,
): Promise<string | null> {
  const tenant = await resolveTenantForHost(rawHost);
  return tenant?.id ?? null;
}
