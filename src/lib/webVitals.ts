/**
 * Core Web Vitals reporter.
 *
 * Uses the native PerformanceObserver API (no extra dependencies) to capture:
 *   - LCP  (Largest Contentful Paint)   - loading performance
 *   - CLS  (Cumulative Layout Shift)    - visual stability
 *   - INP  (Interaction to Next Paint)  - responsiveness (when supported)
 *   - FCP  (First Contentful Paint)     - first paint
 *   - TTFB (Time To First Byte)         - server/network
 *
 * Values are logged to the console in dev and forwarded via `navigator.sendBeacon`
 * to `/api/public/vitals` in production (no-op if endpoint is absent).
 */

export interface VitalMetric {
  name: "LCP" | "CLS" | "INP" | "FCP" | "TTFB";
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  id: string;
}

const thresholds: Record<VitalMetric["name"], [number, number]> = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

function rate(name: VitalMetric["name"], v: number): VitalMetric["rating"] {
  const [good, poor] = thresholds[name];
  if (v <= good) return "good";
  if (v <= poor) return "needs-improvement";
  return "poor";
}

function uid(): string {
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function report(metric: VitalMetric): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[web-vitals]", metric);
    return;
  }
  try {
    const body = JSON.stringify({
      ...metric,
      url: location.pathname,
      ts: Date.now(),
    });
    // Route to a configurable APM/RUM sink when set (VITE_OBSERVABILITY_ENDPOINT),
    // else the built-in vitals collector endpoint.
    const endpoint =
      (import.meta.env as unknown as Record<string, string | undefined>).VITE_OBSERVABILITY_ENDPOINT ||
      "/api/public/vitals";
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(endpoint, body);
    }
  } catch {
    /* swallow - reporting must never break the page */
  }
}

interface LayoutShiftEntry extends PerformanceEntry {
  hadRecentInput: boolean;
  value: number;
}

interface EventTimingEntry extends PerformanceEntry {
  interactionId?: number;
}

export function initWebVitals(): void {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;
  if ((window as Window & { __vitalsInit?: boolean }).__vitalsInit) return;
  (window as Window & { __vitalsInit?: boolean }).__vitalsInit = true;

  // LCP - keep last entry before page hide
  try {
    let lcpValue = 0;
    const lcpObs = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) lcpValue = last.startTime;
    });
    lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
    addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden" && lcpValue > 0) {
          report({ name: "LCP", value: lcpValue, rating: rate("LCP", lcpValue), id: uid() });
          lcpObs.disconnect();
        }
      },
      { once: true },
    );
  } catch {
    /* unsupported */
  }

  // CLS - sum session windows of layout shifts without recent input
  try {
    let cls = 0;
    const clsObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as LayoutShiftEntry[]) {
        if (!e.hadRecentInput) cls += e.value;
      }
    });
    clsObs.observe({ type: "layout-shift", buffered: true });
    addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden") {
          report({ name: "CLS", value: cls, rating: rate("CLS", cls), id: uid() });
          clsObs.disconnect();
        }
      },
      { once: true },
    );
  } catch {
    /* unsupported */
  }

  // INP - take worst interaction duration as proxy
  try {
    let maxDur = 0;
    const inpObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as EventTimingEntry[]) {
        if (e.interactionId && e.duration > maxDur) maxDur = e.duration;
      }
    });
    inpObs.observe({ type: "event", buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
    addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden" && maxDur > 0) {
          report({ name: "INP", value: maxDur, rating: rate("INP", maxDur), id: uid() });
          inpObs.disconnect();
        }
      },
      { once: true },
    );
  } catch {
    /* unsupported */
  }

  // FCP + TTFB from Paint / Navigation Timing
  try {
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    if (fcp) report({ name: "FCP", value: fcp.startTime, rating: rate("FCP", fcp.startTime), id: uid() });
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav) {
      const ttfb = nav.responseStart;
      report({ name: "TTFB", value: ttfb, rating: rate("TTFB", ttfb), id: uid() });
    }
  } catch {
    /* unsupported */
  }
}
