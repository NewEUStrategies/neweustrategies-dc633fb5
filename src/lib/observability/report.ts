// Pluggable observability transport. Beacons client errors (and other structured
// events) to a configurable endpoint (VITE_OBSERVABILITY_ENDPOINT - e.g. a
// Supabase edge function, a logging gateway, or a Sentry tunnel) via
// navigator.sendBeacon, so reporting never blocks the page. When unconfigured
// everything is a safe no-op: the site ships without an APM dependency and
// lights up the moment an endpoint is set. Pure helpers are unit-tested.

export function observabilityEndpoint(): string | null {
  try {
    const env = import.meta.env as unknown as Record<string, string | undefined>;
    const url = env.VITE_OBSERVABILITY_ENDPOINT;
    return url && url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

export interface ClientErrorPayload {
  type: "error";
  message: string;
  stack?: string;
  source: "onerror" | "unhandledrejection";
  path: string;
  ts: number;
}

export function buildErrorPayload(
  error: unknown,
  source: ClientErrorPayload["source"],
  path: string,
  ts: number,
): ClientErrorPayload {
  const err =
    error instanceof Error
      ? error
      : new Error(typeof error === "string" ? error : "Unknown client error");
  return { type: "error", message: err.message, stack: err.stack, source, path, ts };
}

/** Beacon a JSON payload. Returns false (never throws) when unsupported. */
export function sendBeaconPayload(endpoint: string, payload: unknown): boolean {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return false;
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    return navigator.sendBeacon(endpoint, blob);
  } catch {
    return false;
  }
}

/** Report an uncaught client error to the configured endpoint (no-op if unset). */
export function reportClientError(error: unknown, source: ClientErrorPayload["source"]): boolean {
  const endpoint = observabilityEndpoint();
  if (!endpoint) return false;
  const path = typeof location !== "undefined" ? location.pathname : "";
  return sendBeaconPayload(endpoint, buildErrorPayload(error, source, path, Date.now()));
}
