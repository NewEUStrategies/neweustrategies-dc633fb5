// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const requestErrors = new WeakMap<Request, { error: unknown; at: number }>();
const TTL_MS = 5_000;

/**
 * Keep the original error long enough for the outer server entry to log its
 * stack if the HTTP runtime converts it into an opaque JSON 500 response.
 *
 * Global error events only cover truly unhandled failures. Request middleware
 * must call this explicitly before rethrowing a legitimate HTTPError, because
 * errors caught by the HTTP dispatcher never reach those global events.
 */
export function recordCapturedError(error: unknown, request?: Request) {
  const entry = { error, at: Date.now() };
  if (request) {
    requestErrors.set(request, entry);
  }
  // Still keep the global fallback for out-of-band errors (global listeners)
  lastCapturedError = entry;
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) =>
    recordCapturedError((event as ErrorEvent).error ?? event),
  );
  globalThis.addEventListener("unhandledrejection", (event) =>
    recordCapturedError((event as PromiseRejectionEvent).reason),
  );
}

export function consumeLastCapturedError(request?: Request): unknown {
  // 1. Try request-specific storage first (concurrency safe)
  if (request) {
    const cap = requestErrors.get(request);
    if (cap) {
      requestErrors.delete(request);
      if (Date.now() - cap.at <= TTL_MS) {
        return cap.error;
      }
    }
  }

  // 2. Fall back to global storage (prone to races, but covers out-of-band errors)
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
