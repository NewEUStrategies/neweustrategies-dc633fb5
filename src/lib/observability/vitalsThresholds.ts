// Canonical Core Web Vitals thresholds + rating, shared by the client reporter
// (src/lib/webVitals.ts) and the server-side aggregator (./aggregate.ts) so the
// "good / needs-improvement / poor" boundaries never drift between ingest and
// analytics. Thresholds follow Google's published Web Vitals guidance: a value
// at or below the first number is "good", at or below the second is
// "needs-improvement", above is "poor".

export type VitalName = "LCP" | "CLS" | "INP" | "FCP" | "TTFB" | "FID";
export type VitalRating = "good" | "needs-improvement" | "poor";

export const VITAL_THRESHOLDS: Record<VitalName, readonly [number, number]> = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
  FID: [100, 300],
};

// Display order: the three Core Web Vitals first (LCP, INP, CLS), then the
// diagnostic metrics. Used to order the analytics dashboard deterministically.
export const VITAL_ORDER: readonly VitalName[] = ["LCP", "INP", "CLS", "FCP", "TTFB", "FID"];

/** True when a raw metric string is one of the known Web Vitals names. */
export function isVitalName(s: string): s is VitalName {
  return Object.prototype.hasOwnProperty.call(VITAL_THRESHOLDS, s);
}

/** Rate a single metric value against its Web Vitals thresholds. */
export function rateVital(name: VitalName, value: number): VitalRating {
  const [good, poor] = VITAL_THRESHOLDS[name];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

/** Display unit for a metric ("ms" for time metrics, "" for the unitless CLS). */
export function vitalUnit(name: VitalName): "ms" | "" {
  return name === "CLS" ? "" : "ms";
}
