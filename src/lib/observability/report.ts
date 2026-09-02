// Pluggable observability transport. Beacons client errors (and other structured
// events) via navigator.sendBeacon, so reporting never blocks the page.
//
// Endpoint resolution: an external sink (VITE_OBSERVABILITY_ENDPOINT - e.g. a
// Sentry tunnel or logging gateway) wins when set; otherwise it falls back to
// the built-in ingest route (/api/public/client-errors), so error telemetry is
// captured BY DEFAULT - no external APM required and nothing dormant. Pure
// helpers are unit-tested.

import { isIgnorableClientErrorValue } from "./noise";

/** Built-in ingest route used when no external endpoint is configured. */
export const INTERNAL_ERROR_ENDPOINT = "/api/public/client-errors";
/** Built-in RUM ingest route - the vitals counterpart of the route above. */
export const INTERNAL_VITALS_ENDPOINT = "/api/public/vitals";

/**
 * Resolve the beacon target: the external sink wins when configured, otherwise
 * the caller's OWN built-in route.
 *
 * The fallback is a PARAMETER, not a constant, because the two internal ingest
 * routes are not interchangeable: `/api/public/client-errors` requires a
 * `message` and drops anything without one, `/api/public/vitals` requires a
 * known metric `name` and drops anything without one. Hard-coding the error
 * route here and calling it from the vitals reporter would send every RUM
 * sample into the error ingest, which answers 204 and inserts nothing - a
 * silent, total loss of vitals with no failing request to notice it by.
 */
export function observabilityEndpoint(fallback: string = INTERNAL_ERROR_ENDPOINT): string {
  try {
    const env = import.meta.env as unknown as Record<string, string | undefined>;
    const url = env.VITE_OBSERVABILITY_ENDPOINT;
    return url && url.length > 0 ? url : fallback;
  } catch {
    return fallback;
  }
}

/** Beacon target for Core Web Vitals: external sink, else the RUM ingest route. */
export function vitalsEndpoint(): string {
  return observabilityEndpoint(INTERNAL_VITALS_ENDPOINT);
}

export interface ClientErrorPayload {
  type: "error";
  message: string;
  stack?: string;
  source: "onerror" | "unhandledrejection" | "react_error_boundary";
  path: string;
  ts: number;
  /** Optional structured context (boundary label, component stack, …). */
  meta?: Record<string, unknown>;
}

export function buildErrorPayload(
  error: unknown,
  source: ClientErrorPayload["source"],
  path: string,
  ts: number,
  meta?: Record<string, unknown>,
): ClientErrorPayload {
  const err =
    error instanceof Error
      ? error
      : new Error(typeof error === "string" ? error : "Unknown client error");
  const payload: ClientErrorPayload = {
    type: "error",
    message: err.message,
    stack: err.stack,
    source,
    path,
    ts,
  };
  if (meta && Object.keys(meta).length > 0) payload.meta = meta;
  return payload;
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

/**
 * Report an uncaught client error to the resolved endpoint (external or internal).
 *
 * Znany szum (anulowane żądania, pętla ResizeObservera, pusty komunikat) jest
 * ODRZUCANY U ŹRÓDŁA - inaczej zalewa panel błędów i chowa realne awarie.
 */
export function reportClientError(error: unknown, source: ClientErrorPayload["source"]): boolean {
  if (isIgnorableClientErrorValue(error)) return false;
  const endpoint = observabilityEndpoint();
  const path = typeof location !== "undefined" ? location.pathname : "";
  return sendBeaconPayload(endpoint, buildErrorPayload(error, source, path, Date.now()));
}

/**
 * Report an error caught by a React error boundary, with structured context
 * (the boundary label and React component stack). Beacons to the configured
 * endpoint; no-op when unset. This gives per-widget/section render crashes a
 * real telemetry consumer independent of any hosting-platform integration.
 */
export function reportBoundaryError(error: unknown, meta: Record<string, unknown>): boolean {
  const endpoint = observabilityEndpoint();
  const path = typeof location !== "undefined" ? location.pathname : "";
  return sendBeaconPayload(
    endpoint,
    buildErrorPayload(error, "react_error_boundary", path, Date.now(), meta),
  );
}
