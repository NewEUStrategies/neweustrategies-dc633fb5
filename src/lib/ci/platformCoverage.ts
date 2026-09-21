export const PLATFORM_METRICS = ["lines", "branches", "functions", "statements"] as const;
export type PlatformMetric = (typeof PLATFORM_METRICS)[number];
export type CoverageCounts = { total: number; covered: number };
export type FileCoverageCounts = Record<PlatformMetric, CoverageCounts>;

/** Recompute percentages from integer counters. A rounded reporter percentage
 * of 95.00 is insufficient when the actual fraction is below the gate.
 */
export function evaluatePlatformCoverage(
  files: readonly string[],
  summary: Record<string, FileCoverageCounts>,
  minimum = 95,
) {
  const missing = files.filter((file) => !summary[file]);
  const invalid: string[] = [];
  const metrics = Object.fromEntries(
    PLATFORM_METRICS.map((key) => [key, { total: 0, covered: 0, pct: 100 }]),
  ) as Record<PlatformMetric, CoverageCounts & { pct: number }>;
  for (const file of files) {
    const coverage = summary[file];
    if (!coverage) continue;
    for (const key of PLATFORM_METRICS) {
      const counts = coverage[key];
      if (
        !counts ||
        !Number.isInteger(counts.total) ||
        !Number.isInteger(counts.covered) ||
        counts.covered < 0 ||
        counts.total < counts.covered
      ) {
        invalid.push(`${file}:${key}`);
        continue;
      }
      metrics[key].total += counts.total;
      metrics[key].covered += counts.covered;
    }
  }
  for (const key of PLATFORM_METRICS) {
    const metric = metrics[key];
    metric.pct = metric.total ? (metric.covered / metric.total) * 100 : 100;
  }
  const below = PLATFORM_METRICS.filter((key) => metrics[key].pct < minimum);
  return {
    minimum,
    metrics,
    missing,
    invalid,
    below,
    passed: files.length > 0 && !missing.length && !invalid.length && !below.length,
  };
}

/** LCOV keeps exact source lines/branch ordinals and function names while
 * avoiding a second in-memory copy of the complete V8 JSON report.
 */
export function uncoveredLcov(lcov: string, files: ReadonlySet<string>) {
  const result: Record<string, { lines: number[]; branches: string[]; functions: string[] }> = {};
  let current: (typeof result)[string] | undefined;
  for (const line of lcov.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      const file = line.slice(3);
      current = files.has(file)
        ? (result[file] = { lines: [], branches: [], functions: [] })
        : undefined;
    } else if (current && line.startsWith("DA:")) {
      const [number, hits] = line.slice(3).split(",");
      if (Number(hits) === 0) current.lines.push(Number(number));
    } else if (current && line.startsWith("BRDA:")) {
      const [number, block, branch, hits] = line.slice(5).split(",");
      if (hits === "-" || Number(hits) === 0) current.branches.push(`${number}:${block}:${branch}`);
    } else if (current && line.startsWith("FNDA:")) {
      const comma = line.indexOf(",");
      if (Number(line.slice(5, comma)) === 0) current.functions.push(line.slice(comma + 1));
    } else if (line === "end_of_record") current = undefined;
  }
  return result;
}

/** Validate raw LCOV before trusting a summary. Negative V8 execution counts
 * are a corrupt measurement, not uncovered code and not a percentage to floor.
 */
export function invalidLcovCounters(lcov: string): string[] {
  const invalid: string[] = [];
  let file = "<unknown>";
  for (const line of lcov.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      file = line.slice(3);
      continue;
    }
    let hits: string | undefined;
    if (line.startsWith("DA:")) hits = line.slice(3).split(",")[1];
    else if (line.startsWith("BRDA:")) {
      hits = line.slice(5).split(",")[3];
      if (hits === "-") continue;
    } else if (line.startsWith("FNDA:")) hits = line.slice(5).split(",")[0];
    else continue;
    const value = Number(hits);
    if (hits === undefined || hits.trim() === "" || !Number.isSafeInteger(value) || value < 0)
      invalid.push(`${file}:${line}`);
  }
  return invalid;
}
