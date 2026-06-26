type CacheEntry<T> = { at: number; data: T };

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Tiny per-isolate SSR/edge TTL cache for anonymous public data. TanStack
 * QueryClient is intentionally request-scoped, so this keeps slow, shared
 * reads warm across page requests without leaking user state.
 */
export async function edgeTtlCache<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  if (typeof window !== "undefined") return fetcher();
  const now = Date.now();
  const cached = store.get(key) as CacheEntry<T> | undefined;
  if (cached && now - cached.at < ttlMs) return cached.data;
  const data = await fetcher();
  store.set(key, { at: now, data });
  return data;
}
