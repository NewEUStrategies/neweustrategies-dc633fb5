import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { firstVisitCacheStates, firstVisitPages, firstVisitSamples } from "./firstVisitPlan.ts";

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const timingNoiseMs = {
  ttfbMs: 50,
  fcpMs: 100,
  lcpMs: 100,
  readyMs: 150,
  interactionCompleteMs: 150,
};
const sizes = ["jsBytes", "htmlBytes", "inlineCssBytes"];

// Exact one-sided paired permutation test of the mean timing difference.
// Under the no-change null, each pair's artifact labels are exchangeable.
// Enumerate all 2^7 sign assignments, including the observed assignment;
// no random seed, normal approximation, retry or choice of a better run.
// https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.permutation_test.html
export function pairedTimingPValue(before, after) {
  const differences = before.map((value, index) => after[index] - value);
  const observed = differences.reduce((sum, value) => sum + value, 0);
  const tolerance = Math.max(1, Math.abs(observed)) * 1e-12;
  const permutations = 2 ** differences.length;
  let atLeastAsSlow = 0;
  for (let mask = 0; mask < permutations; mask++) {
    const permuted = differences.reduce(
      (sum, value, index) => sum + (mask & (1 << index) ? value : -value),
      0,
    );
    if (permuted >= observed - tolerance) atLeastAsSlow++;
  }
  return atLeastAsSlow / permutations;
}

export function compareFirstVisitSamples(baseline, candidate, { path, lang, state }) {
  for (const samples of [baseline, candidate]) {
    if (
      samples.length !== firstVisitSamples.length ||
      new Set(samples.map((row) => row.sample)).size !== firstVisitSamples.length
    ) {
      throw new Error(`${firstVisitSamples.length} distinct samples required for ${lang}/${state}`);
    }
    for (const row of samples) {
      if (
        !firstVisitSamples.includes(row.sample) ||
        row.path !== path ||
        row.cacheState !== state ||
        row.cache !== (state === "cold" ? "MISS" : "HIT") ||
        row.browserCache !== "cold-routing-disables-http-cache"
      ) {
        throw new Error(`Incomparable sample in ${lang}/${state}`);
      }
      for (const metric of [...Object.keys(timingNoiseMs), ...sizes]) {
        if (typeof row[metric] !== "number" || !Number.isFinite(row[metric]) || row[metric] <= 0) {
          throw new Error(`Missing or invalid ${metric} in ${lang}/${state}`);
        }
      }
    }
  }
  return [...Object.keys(timingNoiseMs), ...sizes].map((metric) => {
    // Pair by ID even if a caller supplied the rows in a different order.
    const values = (samples) =>
      firstVisitSamples.map((id) => samples.find((sample) => sample.sample === id)[metric]);
    const baselineSamples = values(baseline);
    const candidateSamples = values(candidate);
    const before = median(baselineSamples);
    const after = median(candidateSamples);
    // Preserve the existing budgets. Better sampling must not hide regressions.
    const limit = sizes.includes(metric) ? before * 1.05 : before * 1.1 + timingNoiseMs[metric];
    const pValue = sizes.includes(metric)
      ? null
      : pairedTimingPValue(baselineSamples, candidateSamples);
    const verdict =
      after <= limit
        ? "within-limit"
        : pValue !== null && pValue > 0.05
          ? "unconfirmed-timing-change"
          : "regression";
    return {
      lang,
      state,
      metric,
      before,
      after,
      limit,
      pass: verdict !== "regression",
      verdict,
      pValue,
      baselineSamples,
      candidateSamples,
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  rmSync("reports/first-visit-comparison.json", { force: true });
  const rows = [];
  for (const { path, lang } of firstVisitPages) {
    for (const state of firstVisitCacheStates) {
      const read = (directory) =>
        firstVisitSamples.map((sample) =>
          JSON.parse(readFileSync(`${directory}/${lang}-${state}-${sample}.json`, "utf8")),
        );
      rows.push(
        ...compareFirstVisitSamples(
          read("reports/first-visit-baseline"),
          read("reports/first-visit"),
          {
            path,
            lang,
            state,
          },
        ),
      );
    }
  }
  writeFileSync("reports/first-visit-comparison.json", JSON.stringify(rows, null, 2) + "\n");
  for (const row of rows) {
    console.log(
      `${row.verdict === "unconfirmed-timing-change" ? "WARN" : row.pass ? "PASS" : "FAIL"} ${row.lang}/${row.state} ${row.metric}: ${row.before.toFixed(1)} -> ${row.after.toFixed(1)} (limit ${row.limit.toFixed(1)}${row.pValue === null ? "" : `; paired p=${row.pValue.toFixed(4)}`}; baseline [${row.baselineSamples.join(", ")}], candidate [${row.candidateSamples.join(", ")}])`,
    );
  }
  if (rows.some((row) => !row.pass)) process.exitCode = 1;
}
