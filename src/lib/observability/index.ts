// Client observability bootstrap. ONE entry point that consolidates:
//   - Core Web Vitals (RUM) via the existing PerformanceObserver reporter, and
//   - global error capture (uncaught errors + unhandled promise rejections),
// beaconed to the configurable observability endpoint. Idempotent and SSR-safe -
// call once on the client (wired from the root component's mount effect).
import { initWebVitals } from "@/lib/webVitals";
import { reportClientError } from "./report";

export {
  observabilityEndpoint,
  buildErrorPayload,
  sendBeaconPayload,
  reportClientError,
} from "./report";
export type { ClientErrorPayload } from "./report";

let started = false;

export function initObservability(): () => void {
  if (started || typeof window === "undefined") return () => {};
  started = true;

  // Core Web Vitals (LCP/CLS/INP/FCP/TTFB) - already guards its own re-init.
  initWebVitals();

  // Global error capture: uncaught errors and rejected promises that React's
  // error boundaries never see. Beaconed to the observability endpoint (no-op
  // when unconfigured), independent of Lovable's own capture.
  const onError = (event: ErrorEvent) => {
    reportClientError(event.error ?? event.message, "onerror");
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    reportClientError(event.reason, "unhandledrejection");
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    started = false;
  };
}
