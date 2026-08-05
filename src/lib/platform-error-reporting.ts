import { reportBoundaryError } from "@/lib/observability/report";

type PlatformErrorOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type PlatformCaptureBridge = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: PlatformErrorOptions,
  ) => void;
};

declare global {
  interface Window {
    // Globalna nazwa jest kontraktem RUNTIME platformy hostingowej (jej
    // skrypt ją wstrzykuje), więc nie podlega zmianie nazwy po naszej stronie.
    __lovableEvents?: PlatformCaptureBridge;
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
 *   1. the hosting platform's capture global, when present;
 *   2. the app's own observability beacon (VITE_OBSERVABILITY_ENDPOINT), which
 *      works with or without the platform bridge - this is the durable consumer;
 *   3. the dev console, so it is visible while developing.
 * All three are independent and failure-isolated.
 */
export function reportPlatformError(error: unknown, context: Record<string, unknown> = {}) {
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

    console.error(`[render-boundary:${label}]`, error);
  }
}
