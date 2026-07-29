// Server-side guard for the SSR dehydrate/stream pipeline.
//
// PROBLEM: `setupRouterSsrQueryIntegration` streams render-phase queries into
// the dehydrated payload. The serializer keeps the HTTP response open until
// every in-flight query settles. A single query whose `queryFn` never resolves
// (hung upstream fetch, a promise nobody rejects, a request the runtime silently
// drops) therefore freezes the stream mid-payload: the browser/crawler receives
// HTTP 200 with truncated HTML - no `</html>`, no hydration script - and either
// times out or reports a 500.
//
// SOLUTION: bound every server-side query fetch. When a query is still fetching
// after `SSR_QUERY_TIMEOUT_MS`, we cancel it with `revert: true`. Cancellation
// settles the query, the dehydrate stream closes, and the page ships complete
// HTML. The affected widget renders its normal empty/pending fallback and the
// client refetches after hydration - a degraded section instead of a dead page.
//
// The same hook doubles as the diagnostic: every timed-out key is logged with
// its full query key, so a hanging query is identifiable from server logs.

import type { QueryClient, Query } from "@tanstack/react-query";

import { isUnresolvableQuery } from "./pruneUnresolvedQueries";

/** How long a single server-side query may run before we cut it loose. */
export const SSR_QUERY_TIMEOUT_MS = 5_000;

/**
 * How long after render start we dump anything still in flight. Purely
 * observational - it never cancels, it only reports.
 */
export const SSR_PENDING_REPORT_MS = 8_000;

function keyOf(query: Query): string {
  try {
    return JSON.stringify(query.queryKey);
  } catch {
    return String(query.queryKey);
  }
}

/**
 * Installs the SSR fetch watchdog on a per-request QueryClient. Server only -
 * calling it on the client would cancel legitimate long-lived fetches.
 *
 * Returns a disposer that clears every outstanding timer.
 */
export function installSsrQueryTimeout(
  queryClient: QueryClient,
  options: { timeoutMs?: number; reportMs?: number } = {},
): () => void {
  const timeoutMs = options.timeoutMs ?? SSR_QUERY_TIMEOUT_MS;
  const reportMs = options.reportMs ?? SSR_PENDING_REPORT_MS;

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const cache = queryClient.getQueryCache();

  const clearTimer = (hash: string) => {
    const timer = timers.get(hash);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(hash);
    }
  };

  const unsubscribe = cache.subscribe((event) => {
    const query = event.query;
    if (!query) return;
    const hash = query.queryHash;

    if (query.state.fetchStatus === "idle") {
      clearTimer(hash);
      return;
    }

    if (timers.has(hash)) return;

    timers.set(
      hash,
      setTimeout(() => {
        timers.delete(hash);
        if (query.state.fetchStatus === "idle") return;
        console.error(
          `[ssr-query-timeout] query exceeded ${timeoutMs}ms during SSR and was cancelled: ${keyOf(query)}`,
        );
        // `revert: true` restores the pre-fetch state, so dehydration emits the
        // last known-good data (or an empty state) instead of hanging.
        void query.cancel({ revert: true, silent: true }).finally(() => {
          // `revert: true` on a first-ever fetch leaves the query as
          // pending/idle with an unresolved internal promise - exactly what
          // stalls seroval during dehydration. Evict it instead.
          if (isUnresolvableQuery(query)) cache.remove(query);
        });
      }, timeoutMs),
    );
  });

  // One-shot census of whatever is still in flight well past the point a
  // healthy render should have settled. This is the signal that identifies a
  // chronically hanging query without needing a local repro.
  const reportTimer = setTimeout(() => {
    const pending = cache
      .getAll()
      .filter((query) => query.state.fetchStatus !== "idle")
      .map((query) => keyOf(query));
    if (pending.length > 0) {
      console.error(
        `[ssr-query-pending] still fetching after ${reportMs}ms: ${pending.join(", ")}`,
      );
    }
  }, reportMs);

  return () => {
    unsubscribe();
    clearTimeout(reportTimer);
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}
