// Removes queries that can never settle from a per-request SSR QueryClient.
//
// PROBLEM: a query that was created (via `ensureQueryData` / `prefetchQuery` /
// a render-phase `useQuery`) but whose fetch was cancelled with
// `revert: true` - or that was created and never fetched at all - ends up in
// the cache as `status: "pending"`, `fetchStatus: "idle"`, `observers: 0`,
// `data: undefined`. Its internal promise is never resolved nor rejected.
// `dehydrate()` still emits such a query, and seroval then waits on that dead
// promise until its hard serialization limit - the SSR document stalls and the
// HTML is truncated.
//
// SOLUTION: right before dehydration (and right after an SSR cancellation),
// drop those entries from the cache. Nothing is lost: they carry no data, no
// component is observing them, and the client refetches them after hydration.

import type { Query, QueryClient } from "@tanstack/react-query";

/** True when the query can no longer settle on the server. */
export function isUnresolvableQuery(query: Query): boolean {
  return (
    query.state.status === "pending" &&
    query.state.fetchStatus === "idle" &&
    query.state.data === undefined
  );
}

function keyOf(query: Query): string {
  try {
    return JSON.stringify(query.queryKey);
  } catch {
    return query.queryHash;
  }
}

/**
 * Drops every never-settling query from the cache. Returns the removed keys
 * so callers can log them. Server-only.
 */
export function pruneUnresolvedQueries(queryClient: QueryClient): string[] {
  const cache = queryClient.getQueryCache();
  const removed: string[] = [];

  for (const query of cache.getAll()) {
    if (!isUnresolvableQuery(query)) continue;
    removed.push(keyOf(query));
    cache.remove(query);
  }

  return removed;
}
