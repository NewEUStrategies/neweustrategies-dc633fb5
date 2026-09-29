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
    const baselineSamples = baseline.map((sample) => sample[metric]);
    const candidateSamples = candidate.map((sample) => sample[metric]);
    const before = median(baselineSamples);
    const after = median(candidateSamples);
    // Preserve the existing budgets. Better sampling must not hide regressions.
    const limit = sizes.includes(metric) ? before * 1.05 : before * 1.1 + timingNoiseMs[metric];
    return {
      lang,
      state,
      metric,
      before,
      after,
      limit,
      pass: after <= limit,
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
      `${row.pass ? "PASS" : "FAIL"} ${row.lang}/${row.state} ${row.metric}: ${row.before.toFixed(1)} -> ${row.after.toFixed(1)} (limit ${row.limit.toFixed(1)}; baseline [${row.baselineSamples.join(", ")}], candidate [${row.candidateSamples.join(", ")}])`,
    );
  }
  if (rows.some((row) => !row.pass)) process.exitCode = 1;
}
