import { currentTenantHost } from "@/lib/http/requestHost";

type CacheEntry<T> = { at: number; data: T };

const store = new Map<string, CacheEntry<unknown>>();

// Hard cap on distinct cache entries per isolate. The store is keyed by
// host::key, so multi-tenant hosts x per-slug/per-variant keys make the key
// space effectively unbounded; expired entries are only overwritten when their
// exact key is re-fetched, never evicted otherwise. Without a cap the Map grows
// for the whole isolate lifetime -> memory climbs until workerd OOM-kills the
// isolate, taking every route down (the same "one fault, whole site" failure
// class this file's SSR sits behind). Map preserves insertion order, so evicting
// `keys().next().value` drops the oldest entry (approx-LRU, good enough for a
// warm-read cache).
const MAX_ENTRIES = 500;

/**
 * Tiny per-isolate SSR/edge TTL cache for anonymous public data. TanStack
 * QueryClient is intentionally request-scoped, so this keeps slow, shared
 * reads warm across page requests without leaking user state.
 *
 * TENANT SCOPE: every entry is transparently keyed by the request host, so a
 * cache warmed while rendering tenant A's domain can never be served on
 * tenant B's domain. Callers keep passing plain keys - the scoping cannot be
 * forgotten at a call site because it happens here, by construction. Requests
 * without a resolvable host (background work) share the "no-host" scope,
 * which matches the database's default-tenant fallback.
 */
export async function edgeTtlCache<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  if (typeof window !== "undefined") return fetcher();
  const scope = (await currentTenantHost()) ?? "no-host";
  const scopedKey = `${scope}::${key}`;
  const now = Date.now();
  const cached = store.get(scopedKey) as CacheEntry<T> | undefined;
  if (cached && now - cached.at < ttlMs) return cached.data;
  const data = await fetcher();
  // Refresh insertion order (so a re-fetched hot key is treated as recent) and
  // enforce the cap by evicting the oldest entries.
  store.delete(scopedKey);
  store.set(scopedKey, { at: now, data });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
  return data;
}

/** Test hook: drop every cached entry (all host scopes). */
export function clearEdgeTtlCache(): void {
  store.clear();
}
