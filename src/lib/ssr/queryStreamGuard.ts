// Watchdog for the SSR query stream created by the router <-> query
// integration (`setupCoreRouterSsrQueryIntegration`).
//
// PROBLEM: the integration puts a `ReadableStream` (`queryStream`) into the
// dehydrated payload and closes it ONLY from a
// `router.serverSsr.onRenderFinished(...)` listener registered inside
// `dehydrate()`. In router-core 1.171 `onRenderFinished` silently DROPS the
// listener when `cleanupStarted || streamFastPathReserved`, and it has no
// "already finished" fast path (unlike `onSerializationFinished`). When the
// listener is dropped, `queryStream` never closes, seroval keeps waiting on it,
// and the SSR response stalls mid-payload: HTTP 200 with truncated HTML - no
// `</html>`, no hydration script.
//
// SOLUTION (app-level, framework-version agnostic): we do NOT hand the
// integration's raw stream to the serializer. We wrap it in a stream WE own and
// close deterministically:
//   * source closes normally -> we close (happy path, zero behaviour change),
//   * every query has been idle for `idleMs` -> nothing more can be streamed,
//     so we close,
//   * `maxMs` hard cap -> we close no matter what.
// Either way the serializer always sees a terminated stream and the document
// always finishes. Anything not streamed in time simply refetches on the
// client - a degraded widget instead of a dead page.

import type { QueryClient, Query } from "@tanstack/react-query";

export interface QueryStreamGuardOptions {
  /** Close once no query has been fetching for this long. */
  idleMs?: number;
  /** Absolute upper bound on how long the stream may stay open. */
  maxMs?: number;
  /** Poll interval of the idle detector. */
  tickMs?: number;
  /** Etykieta diagnostyczna (zwykle pathname) - żeby odróżnić /en od /blog. */
  label?: string;
}

const DEFAULT_IDLE_MS = 750;
const DEFAULT_MAX_MS = 10_000;
const DEFAULT_TICK_MS = 150;

interface PendingQuerySnapshot {
  queryKey: string;
  status: string;
  fetchStatus: string;
  observers: number;
  hasData: boolean;
  dataUpdatedAt: number;
  errorMessage?: string;
  ageMs: number;
}

function safeKey(query: Query): string {
  try {
    return JSON.stringify(query.queryKey);
  } catch {
    return String(query.queryHash);
  }
}

/**
 * Zrzut zapytań, które w chwili zamknięcia strażnika nie są rozstrzygnięte -
 * to one trzymają serializację seroval otwartą.
 */
export function collectPendingQueries(queryClient: QueryClient): PendingQuerySnapshot[] {
  const now = Date.now();
  return queryClient
    .getQueryCache()
    .getAll()
    .filter((q) => q.state.status === "pending" || q.state.fetchStatus !== "idle")
    .map((q) => {
      const error = q.state.error;
      return {
        queryKey: safeKey(q),
        status: q.state.status,
        fetchStatus: q.state.fetchStatus,
        observers: q.getObserversCount(),
        hasData: q.state.data !== undefined,
        dataUpdatedAt: q.state.dataUpdatedAt,
        ageMs: q.state.dataUpdatedAt ? now - q.state.dataUpdatedAt : -1,
        ...(error instanceof Error ? { errorMessage: error.message } : {}),
      };
    });
}

/**
 * Returns a stream that mirrors `source` but is guaranteed to close.
 * Server-only.
 */
export function guardQueryStream<T>(
  source: ReadableStream<T>,
  queryClient: QueryClient,
  options: QueryStreamGuardOptions = {},
): ReadableStream<T> {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
  const label = options.label ?? "-";

  let controller: ReadableStreamDefaultController<T> | undefined;
  let closed = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<T> | undefined;
  const openedAt = Date.now();

  const dumpPending = (reason: string): void => {
    const pending = collectPendingQueries(queryClient);
    const cacheSize = queryClient.getQueryCache().getAll().length;
    console.warn(
      `[ssr-query-stream] pending dump route=${label} reason=${reason} ` +
        `elapsedMs=${Date.now() - openedAt} isFetching=${queryClient.isFetching()} ` +
        `cache=${cacheSize} pending=${pending.length}`,
    );
    if (pending.length === 0) {
      console.warn("[ssr-query-stream]   (brak nierozstrzygniętych zapytań w cache)");
      return;
    }
    for (const p of pending) {
      console.warn(
        `[ssr-query-stream]   key=${p.queryKey} status=${p.status} ` +
          `fetchStatus=${p.fetchStatus} observers=${p.observers} ` +
          `hasData=${p.hasData} ageMs=${p.ageMs}` +
          (p.errorMessage ? ` error=${p.errorMessage}` : ""),
      );
    }
  };

  const close = (reason: "source" | "idle" | "timeout") => {
    if (closed) return;
    closed = true;
    if (interval !== undefined) clearInterval(interval);
    if (hardTimer !== undefined) clearTimeout(hardTimer);
    if (reason !== "source") {
      console.warn(`[ssr-query-stream] closed by guard (${reason}) route=${label}`);
      dumpPending(reason);
      void reader?.cancel().catch(() => undefined);
    }
    try {
      controller?.close();
    } catch {
      /* already closed by the runtime */
    }
  };


  return new ReadableStream<T>({
    start(c) {
      controller = c;

      reader = source.getReader();
      const pump = (): void => {
        reader
          ?.read()
          .then(({ done, value }) => {
            if (closed) return;
            if (done) {
              close("source");
              return;
            }
            try {
              controller?.enqueue(value);
            } catch {
              /* consumer gone */
            }
            pump();
          })
          .catch(() => close("source"));
      };
      pump();

      let idleSince: number | null = null;
      interval = setInterval(() => {
        if (closed) return;
        const fetching = queryClient.isFetching();
        if (fetching > 0) {
          idleSince = null;
          return;
        }
        const now = Date.now();
        if (idleSince === null) {
          idleSince = now;
          return;
        }
        if (now - idleSince >= idleMs) close("idle");
      }, tickMs);

      hardTimer = setTimeout(() => close("timeout"), maxMs);
    },
    cancel() {
      close("source");
    },
  });
}
