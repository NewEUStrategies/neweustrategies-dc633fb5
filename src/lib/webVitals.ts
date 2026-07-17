/**
 * Core Web Vitals reporter (SPA-aware).
 *
 * Uses the native PerformanceObserver API (no extra dependencies) to capture:
 *   - LCP  (Largest Contentful Paint)   - loading performance
 *   - CLS  (Cumulative Layout Shift)    - visual stability
 *   - INP  (Interaction to Next Paint)  - responsiveness (when supported)
 *   - FCP  (First Contentful Paint)     - first paint
 *   - TTFB (Time To First Byte)         - server/network
 *
 * The reporter attributes samples to the pathname the user was on when the
 * metric accumulated - not the pathname at flush time. On soft navigations
 * (SPA route changes) the accumulated LCP/CLS/INP are flushed for the
 * previous path and observers reset, so subpages (kategorie, wpisy, strony
 * statyczne) collect their own samples instead of everything landing on `/`.
 *
 * Values are logged to the console in dev and forwarded via
 * `navigator.sendBeacon` to `/api/public/vitals` in production.
 */

import { rateVital, type VitalName, type VitalRating } from "@/lib/observability/vitalsThresholds";

interface VitalMetric {
  name: Extract<VitalName, "LCP" | "CLS" | "INP" | "FCP" | "TTFB">;
  value: number;
  rating: VitalRating;
  id: string;
}

function rate(name: VitalMetric["name"], v: number): VitalMetric["rating"] {
  return rateVital(name, v);
}

function uid(): string {
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function report(metric: VitalMetric, pathname: string): void {
  if (import.meta.env.DEV) {
    console.debug("[web-vitals]", pathname, metric);
    return;
  }
  try {
    const body = JSON.stringify({
      ...metric,
      url: pathname,
      ts: Date.now(),
    });
    const endpoint =
      (import.meta.env as unknown as Record<string, string | undefined>)
        .VITE_OBSERVABILITY_ENDPOINT || "/api/public/vitals";
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

// Per-page accumulators. Reset on soft navigation via `markWebVitalsPage`.
let currentPath = "/";
let lcpValue = 0;
let clsValue = 0;
let inpMax = 0;
let flushed = false;

function flushCurrent(pathname: string): void {
  if (flushed) return;
  flushed = true;
  if (lcpValue > 0) {
    report({ name: "LCP", value: lcpValue, rating: rate("LCP", lcpValue), id: uid() }, pathname);
  }
  // Only report CLS if any shift was observed or LCP fired (avoid flooding 0s).
  if (clsValue > 0 || lcpValue > 0) {
    report({ name: "CLS", value: clsValue, rating: rate("CLS", clsValue), id: uid() }, pathname);
  }
  if (inpMax > 0) {
    report({ name: "INP", value: inpMax, rating: rate("INP", inpMax), id: uid() }, pathname);
  }
}

function resetAccumulators(): void {
  lcpValue = 0;
  clsValue = 0;
  inpMax = 0;
  flushed = false;
}

/**
 * Notify the reporter that the user navigated (soft nav). Flushes the metrics
 * accumulated for the previous path, then resets counters for the new path.
 * Safe to call with the same path twice.
 */
export function markWebVitalsPage(pathname: string): void {
  if (typeof window === "undefined") return;
  if (pathname === currentPath) return;
  flushCurrent(currentPath);
  currentPath = pathname;
  resetAccumulators();
}

export function initWebVitals(): void {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;
  if ((window as Window & { __vitalsInit?: boolean }).__vitalsInit) return;
  (window as Window & { __vitalsInit?: boolean }).__vitalsInit = true;

  currentPath = location.pathname;

  // LCP - keep last entry per page.
  try {
    const lcpObs = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) lcpValue = last.startTime;
    });
    lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    /* unsupported */
  }

  // CLS - sum layout shifts without recent input.
  try {
    const clsObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as LayoutShiftEntry[]) {
        if (!e.hadRecentInput) clsValue += e.value;
      }
    });
    clsObs.observe({ type: "layout-shift", buffered: true });
  } catch {
    /* unsupported */
  }

  // INP - worst interaction duration.
  try {
    const inpObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as EventTimingEntry[]) {
        if (e.interactionId && e.duration > inpMax) inpMax = e.duration;
      }
    });
    inpObs.observe({
      type: "event",
      buffered: true,
      durationThreshold: 40,
    } as PerformanceObserverInit);
  } catch {
    /* unsupported */
  }

  // Flush accumulators on tab hide / page unload. `pagehide` covers bfcache
  // navigations that skip `visibilitychange`.
  const onHide = () => {
    if (document.visibilityState === "hidden" || document.visibilityState === undefined) {
      flushCurrent(currentPath);
    }
  };
  addEventListener("visibilitychange", onHide);
  addEventListener("pagehide", () => flushCurrent(currentPath));

  // FCP + TTFB from Paint / Navigation Timing - only meaningful on the initial
  // hard load. Attribute to whatever the initial pathname is.
  try {
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    if (fcp) {
      report(
        { name: "FCP", value: fcp.startTime, rating: rate("FCP", fcp.startTime), id: uid() },
        currentPath,
      );
    }
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (nav) {
      const ttfb = nav.responseStart;
      report({ name: "TTFB", value: ttfb, rating: rate("TTFB", ttfb), id: uid() }, currentPath);
    }
  } catch {
    /* unsupported */
  }
}
