// Captures the original Error out-of-band so `src/server.ts` can recover the
// stack when h3 has already swallowed the throw into a generic 500 Response.
//
// Three complementary sources feed the capture cache (newest wins):
//   1. `recordCapturedError(err)` - called explicitly by request-middleware
//      before rethrowing an HTTPError.
//   2. Global `error` / `unhandledrejection` listeners - only fire for TRULY
//      unhandled failures. On workerd (Cloudflare preview), most SSR crashes
//      never reach these listeners because h3 catches the throw internally.
//   3. `console.error` monkey-patch - captures the first Error-shaped
//      argument that anything (TanStack Start, h3, React, our own middleware)
//      passes through `console.error(...)`. This is our safety net when the
//      framework logs a real error just before returning the opaque
//      `{ unhandled:true, message:"HTTPError" }` body. Delegates untouched to
//      the original console.error so log output is unchanged.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function isErrorLike(value: unknown): value is Error {
  if (value instanceof Error) return true;
  if (value == null || typeof value !== "object") return false;
  const candidate = value as { message?: unknown; stack?: unknown; name?: unknown };
  return typeof candidate.message === "string" && typeof candidate.stack === "string";
}

/**
 * Keep the original error long enough for the outer server entry to log its
 * stack if the HTTP runtime converts it into an opaque JSON 500 response.
 *
 * Request middleware calls this explicitly before rethrowing a legitimate
 * HTTPError, because errors caught by the HTTP dispatcher never reach the
 * global `error` / `unhandledrejection` events on workerd.
 */
export function recordCapturedError(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

// Global listeners - work in Node/Bun but rarely fire on workerd for
// framework-caught throws. Kept as one of three overlapping sources.
if (typeof globalThis.addEventListener === "function") {
  try {
    globalThis.addEventListener("error", (event) => {
      recordCapturedError((event as ErrorEvent).error ?? event);
    });
    globalThis.addEventListener("unhandledrejection", (event) => {
      recordCapturedError((event as PromiseRejectionEvent).reason);
    });
  } catch {
    /* runtime without listener support - fall back to console.error patch */
  }
}

// console.error safety net. TanStack Start / h3 log the underlying Error to
// console.error immediately before returning the swallowed 500 body; without
// this patch that stack is dropped on workerd (where `globalThis.error`
// listeners don't fire for framework-caught throws) and our fallback logs a
// synthetic "h3 swallowed" message with no cause. Idempotent: guard prevents
// double-patching under HMR and test module resets.
declare global {
  // eslint-disable-next-line no-var
  var __lovableErrorCapturePatched: boolean | undefined;
}

if (typeof console !== "undefined" && !globalThis.__lovableErrorCapturePatched) {
  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    // Find the first Error-shaped argument. React / h3 sometimes call
    // `console.error("Uncaught error:", err)` so we can't assume position 0.
    for (const arg of args) {
      if (isErrorLike(arg)) {
        recordCapturedError(arg);
        break;
      }
    }
    originalError(...args);
  };
  globalThis.__lovableErrorCapturePatched = true;
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
