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
  reportBoundaryError,
} from "./report";
export type { ClientErrorPayload } from "./report";

let started = false;

export function initObservability(): () => void {
  if (started || typeof window === "undefined") return () => {};
  started = true;

  // Core Web Vitals (LCP/CLS/INP/FCP/TTFB) - zwraca teardown, ktory rozlacza
  // obserwery i listenery flush przy cofnieciu zgody (RODO).
  const teardownWebVitals = initWebVitals();

  // Global error capture: uncaught errors and rejected promises that React's
  // error boundaries never see. Beaconed to the observability endpoint (no-op
  // when unconfigured), independent of the hosting platform's own capture.
  const onError = (event: ErrorEvent) => {
    reportClientError(event.error ?? event.message, "onerror");
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    reportClientError(event.reason, "unhandledrejection");
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  // BŁĘDY BOOTU zbuforowane, ZANIM ten moduł w ogóle istniał.
  //
  // Sonda `BOOT_PROBE_SCRIPT` to klasyczny skrypt w `<head>`, pierwszy
  // w dokumencie - łapie rzut w chunku vendorowym, czyli awarię, której ten
  // moduł nie ma jak zobaczyć (instaluje się z efektu montowania Reacta, więc
  // PO zdarzeniu). Sonda tylko buforuje w pamięci strony; beaconowanie odbywa
  // się DOPIERO TUTAJ, czyli dopiero za bramką zgody analitycznej - i to jest
  // powód, dla którego samo przechwytywanie nie ma bramki zgody: bufor nigdy
  // nie opuścił strony.
  //
  // `splice(0)` opróżnia bufor, więc powtórna inicjalizacja (cofnięcie i ponowne
  // udzielenie zgody) nie wysyła tych samych błędów drugi raz.
  const bootBuffer = (window as unknown as { __nesBootErrors?: unknown[] }).__nesBootErrors;
  if (Array.isArray(bootBuffer) && bootBuffer.length > 0) {
    for (const entry of bootBuffer.splice(0)) reportClientError(entry, "onerror");
  }

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    teardownWebVitals();
    started = false;
  };
}
