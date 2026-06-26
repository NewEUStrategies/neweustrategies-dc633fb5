// Pure server-side aggregation of Real User Monitoring samples (the `web_vitals`
// table) into a per-metric report. Kept dependency-free and side-effect-free so
// the percentile/rating math is unit-tested in isolation; the server function
// (./vitals.functions.ts) only fetches rows and hands them here.
import {
  VITAL_ORDER,
  isVitalName,
  rateVital,
  type VitalName,
  type VitalRating,
} from "./vitalsThresholds";

/** One raw row as stored by the ingest route (/api/public/vitals). */
export interface VitalSample {
  metric: string;
  value: number;
  rating?: string | null;
  path?: string | null;
}

export interface VitalMetricSummary {
  metric: VitalName;
  /** Number of samples for this metric in the window. */
  count: number;
  /** 75th percentile - the value Web Vitals reports as the field score. */
  p75: number;
  /** Median (50th percentile). */
  p50: number;
  min: number;
  max: number;
  /** Sample counts by rating bucket (good / needs-improvement / poor). */
  good: number;
  needsImprovement: number;
  poor: number;
  /** Overall rating of the p75 against Web Vitals thresholds. */
  rating: VitalRating;
}

export interface VitalsReport {
  /** Size of the look-back window in days. */
  windowDays: number;
  /** Total samples across all metrics. */
  total: number;
  /** Per-metric summaries, ordered by VITAL_ORDER, metrics with 0 samples omitted. */
  metrics: VitalMetricSummary[];
}

export interface AggregateOptions {
  windowDays: number;
}

/**
 * Nearest-rank percentile over an ascending-sorted array.
 * `p` is a fraction in [0, 1]. Returns 0 for an empty array.
 * Rank = ceil(p * n), clamped into [1, n]; the value is at index rank-1.
 */
export function percentile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (p <= 0) return sortedAsc[0];
  if (p >= 1) return sortedAsc[n - 1];
  const rank = Math.ceil(p * n);
  const idx = Math.min(Math.max(rank, 1), n) - 1;
  return sortedAsc[idx];
}

/** Round a metric value for display: CLS to 3 decimals, time metrics to whole ms. */
function roundFor(metric: VitalName, v: number): number {
  if (metric === "CLS") return Math.round(v * 1000) / 1000;
  return Math.round(v);
}

const RATING_KEYS = new Set<VitalRating>(["good", "needs-improvement", "poor"]);

/**
 * Aggregate raw RUM samples into a per-metric report. Unknown metric names and
 * non-finite values are ignored. Rating buckets prefer the rating stored with
 * the sample (what the user's browser computed) and fall back to recomputing it
 * from the value when absent/invalid.
 */
export function aggregateVitals(samples: VitalSample[], opts: AggregateOptions): VitalsReport {
  const byMetric = new Map<VitalName, { values: number[]; good: number; ni: number; poor: number }>();

  for (const s of samples) {
    const name = s.metric;
    if (!isVitalName(name)) continue;
    const value = Number(s.value);
    if (!Number.isFinite(value)) continue;

    let bucket = byMetric.get(name);
    if (!bucket) {
      bucket = { values: [], good: 0, ni: 0, poor: 0 };
      byMetric.set(name, bucket);
    }
    bucket.values.push(value);

    const rating: VitalRating =
      typeof s.rating === "string" && RATING_KEYS.has(s.rating as VitalRating)
        ? (s.rating as VitalRating)
        : rateVital(name, value);
    if (rating === "good") bucket.good++;
    else if (rating === "needs-improvement") bucket.ni++;
    else bucket.poor++;
  }

  const metrics: VitalMetricSummary[] = [];
  let total = 0;

  for (const name of VITAL_ORDER) {
    const bucket = byMetric.get(name);
    if (!bucket || bucket.values.length === 0) continue;
    const values = bucket.values.slice().sort((a, b) => a - b);
    const count = values.length;
    total += count;
    const p75raw = percentile(values, 0.75);
    metrics.push({
      metric: name,
      count,
      p75: roundFor(name, p75raw),
      p50: roundFor(name, percentile(values, 0.5)),
      min: roundFor(name, values[0]),
      max: roundFor(name, values[count - 1]),
      good: bucket.good,
      needsImprovement: bucket.ni,
      poor: bucket.poor,
      rating: rateVital(name, p75raw),
    });
  }

  return { windowDays: opts.windowDays, total, metrics };
}
