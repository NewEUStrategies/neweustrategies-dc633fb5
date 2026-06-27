// Pure server-side aggregation of Real User Monitoring samples (the `web_vitals`
// table) into a per-metric report, a per-path breakdown, and a per-day trend.
// Kept dependency-free and side-effect-free so the percentile/rating math is
// unit-tested in isolation; the server function (./vitals.functions.ts) only
// fetches rows and hands them here.
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
  /** ISO timestamp - used only for the per-day trend; samples without it still
   *  count toward metric/path aggregates. */
  created_at?: string | null;
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

/** Compact per-metric stat used inside the per-path breakdown. */
export interface VitalPathMetric {
  metric: VitalName;
  count: number;
  p75: number;
  rating: VitalRating;
}

export interface VitalPathRow {
  /** Request path the samples were collected on ("(unknown)" when absent). */
  path: string;
  /** Total samples across all metrics for this path. */
  total: number;
  metrics: VitalPathMetric[];
}

/** One day's p75 per metric (chronological), for sparkline-style trends. */
export interface VitalTrendPoint {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
  /** p75 per metric present that day. */
  p75: Partial<Record<VitalName, number>>;
}

export interface VitalsReport {
  /** Size of the look-back window in days. */
  windowDays: number;
  /** Total samples across all metrics in the aggregated set. */
  total: number;
  /** Per-metric summaries, ordered by VITAL_ORDER, metrics with 0 samples omitted. */
  metrics: VitalMetricSummary[];
  /** Top paths by sample count, each with a compact per-metric breakdown. */
  paths: VitalPathRow[];
  /** Per-day p75 per metric, chronological (oldest → newest). */
  trends: VitalTrendPoint[];
}

export interface AggregateOptions {
  windowDays: number;
  /** How many top paths (by sample count) to include. Default 8. */
  topPaths?: number;
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

/** Resolve a sample's rating: prefer the stored one, else recompute from value. */
function resolveRating(metric: VitalName, value: number, stored: string | null | undefined): VitalRating {
  return typeof stored === "string" && RATING_KEYS.has(stored as VitalRating)
    ? (stored as VitalRating)
    : rateVital(metric, value);
}

/** UTC calendar day (YYYY-MM-DD) of an ISO timestamp, or null when unparseable. */
function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Aggregate raw RUM samples into a report. Unknown metric names and non-finite
 * values are ignored. Rating buckets prefer the rating stored with the sample
 * (what the user's browser computed) and fall back to recomputing it.
 */
export function aggregateVitals(samples: VitalSample[], opts: AggregateOptions): VitalsReport {
  const topPaths = opts.topPaths ?? 8;

  const byMetric = new Map<VitalName, { values: number[]; good: number; ni: number; poor: number }>();
  const byPath = new Map<string, Map<VitalName, number[]>>();
  const byDay = new Map<string, Map<VitalName, number[]>>();

  for (const s of samples) {
    const name = s.metric;
    if (!isVitalName(name)) continue;
    const value = Number(s.value);
    if (!Number.isFinite(value)) continue;

    // --- overall per-metric ---
    let bucket = byMetric.get(name);
    if (!bucket) {
      bucket = { values: [], good: 0, ni: 0, poor: 0 };
      byMetric.set(name, bucket);
    }
    bucket.values.push(value);
    const rating = resolveRating(name, value, s.rating);
    if (rating === "good") bucket.good++;
    else if (rating === "needs-improvement") bucket.ni++;
    else bucket.poor++;

    // --- per-path ---
    const pathKey = s.path && s.path.trim() ? s.path : "(unknown)";
    let pathMetrics = byPath.get(pathKey);
    if (!pathMetrics) {
      pathMetrics = new Map();
      byPath.set(pathKey, pathMetrics);
    }
    const pv = pathMetrics.get(name) ?? [];
    pv.push(value);
    pathMetrics.set(name, pv);

    // --- per-day (only when a timestamp is present) ---
    const day = dayKey(s.created_at);
    if (day) {
      let dayMetrics = byDay.get(day);
      if (!dayMetrics) {
        dayMetrics = new Map();
        byDay.set(day, dayMetrics);
      }
      const dv = dayMetrics.get(name) ?? [];
      dv.push(value);
      dayMetrics.set(name, dv);
    }
  }

  // Per-metric summaries (ordered, non-empty only).
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

  // Per-path breakdown: top paths by sample count.
  const paths: VitalPathRow[] = [];
  for (const [path, metricMap] of byPath) {
    let pathTotal = 0;
    const rows: VitalPathMetric[] = [];
    for (const name of VITAL_ORDER) {
      const vals = metricMap.get(name);
      if (!vals || vals.length === 0) continue;
      pathTotal += vals.length;
      const sorted = vals.slice().sort((a, b) => a - b);
      const p75raw = percentile(sorted, 0.75);
      rows.push({ metric: name, count: sorted.length, p75: roundFor(name, p75raw), rating: rateVital(name, p75raw) });
    }
    paths.push({ path, total: pathTotal, metrics: rows });
  }
  paths.sort((a, b) => b.total - a.total || a.path.localeCompare(b.path));

  // Per-day trends, chronological.
  const trends: VitalTrendPoint[] = [];
  for (const day of Array.from(byDay.keys()).sort()) {
    const metricMap = byDay.get(day)!;
    const p75: Partial<Record<VitalName, number>> = {};
    for (const name of VITAL_ORDER) {
      const vals = metricMap.get(name);
      if (!vals || vals.length === 0) continue;
      const sorted = vals.slice().sort((a, b) => a - b);
      p75[name] = roundFor(name, percentile(sorted, 0.75));
    }
    trends.push({ day, p75 });
  }

  return { windowDays: opts.windowDays, total, metrics, paths: paths.slice(0, topPaths), trends };
}
