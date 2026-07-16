/**
 * SSR error capture — single explicit API + globalThis fallback.
 *
 * h3 (TanStack Start's request runtime on workerd) internally catches throws
 * inside route handlers and turns them into an opaque `500` Response with
 * body `{"unhandled":true,"message":"HTTPError"}`. The original `Error` never
 * reaches our SSR wrapper, so we cache it out-of-band and correlate it with
 * the swallowed response in `src/server.ts`.
 *
 * Two overlapping sources feed the capture cache (newest wins):
 *   1. Explicit `recordCapturedError(err)` — called by request middleware
 *      before rethrowing / handling. This is the primary path on workerd,
 *      where framework-caught throws never fire `globalThis` error events.
 *   2. Global `error` / `unhandledrejection` listeners — safety net for Node
 *      and Bun. On workerd these rarely fire for framework-caught throws,
 *      but they still catch pre-dispatch module-init failures.
 *
 * Deliberately dropped from the previous model: the `console.error` monkey
 * patch. Any React dev warning or third-party `console.error` was recorded
 * as a "captured cause", polluting error correlation with unrelated noise.
 * The middleware now records the real error explicitly, which is exact.
 */

type Captured = { readonly error: unknown; readonly at: number };

const TTL_MS = 5_000;
let lastCapturedError: Captured | undefined;

/**
 * Store the original error long enough for the SSR wrapper to log its stack
 * when the HTTP runtime converts the throw into an opaque JSON 500 response.
 * The 5-second TTL is a hard cap so an old error can never correlate with an
 * unrelated request minutes later.
 */
export function recordCapturedError(error: unknown): void {
  lastCapturedError = { error, at: Date.now() };
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}

// Global listeners — safety net on runtimes where they fire (Node/Bun);
// silently ignored on workerd where framework-caught throws stay internal.
if (typeof globalThis.addEventListener === "function") {
  try {
    globalThis.addEventListener("error", (event) => {
      recordCapturedError((event as ErrorEvent).error ?? event);
    });
    globalThis.addEventListener("unhandledrejection", (event) => {
      recordCapturedError((event as PromiseRejectionEvent).reason);
    });
  } catch {
    /* listener API unavailable — explicit recordCapturedError path still works */
  }
}
