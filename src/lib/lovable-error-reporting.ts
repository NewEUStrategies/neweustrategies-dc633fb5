import { reportBoundaryError } from "@/lib/observability/report";

type LovableErrorOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type LovableEvents = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: LovableErrorOptions,
  ) => void;
};

declare global {
  interface Window {
    __lovableEvents?: LovableEvents;
  }
}

function isDev(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

/**
 * Report a render-boundary error to EVERY available consumer, so a crash is
 * never swallowed silently:
 *   1. the host (Lovable) capture global, when present;
 *   2. the app's own observability beacon (VITE_OBSERVABILITY_ENDPOINT), which
 *      works with or without Lovable - this is the durable consumer;
 *   3. the dev console, so it is visible while developing.
 * All three are independent and failure-isolated.
 */
export function reportLovableError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;

  try {
    window.__lovableEvents?.captureException?.(
      error,
      {
        source: "react_error_boundary",
        route: window.location.pathname,
        ...context,
      },
      {
        mechanism: "react_error_boundary",
        handled: false,
        severity: "error",
      },
    );
  } catch {
    /* never let a reporting transport throw into the boundary */
  }

  try {
    reportBoundaryError(error, context);
  } catch {
    /* beacon failures are non-fatal */
  }

  if (isDev()) {
    const label = typeof context.label === "string" ? context.label : "render";
    // eslint-disable-next-line no-console
    console.error(`[render-boundary:${label}]`, error);
  }
}
