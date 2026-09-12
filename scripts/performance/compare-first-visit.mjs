import { readFileSync, writeFileSync } from "node:fs";

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const timingNoiseMs = {
  ttfbMs: 50,
  fcpMs: 100,
  lcpMs: 100,
  readyMs: 150,
  interactionCompleteMs: 150,
};
const sizes = ["jsBytes", "htmlBytes", "inlineCssBytes"];
const rows = [];
for (const lang of ["pl", "en"]) {
  for (const state of ["cold", "warm"]) {
    const read = (directory) =>
      [1, 2, 3].map((sample) => {
        const value = JSON.parse(
          readFileSync(`${directory}/${lang}-${state}-${sample}.json`, "utf8"),
        );
        if (value.cache !== (state === "cold" ? "MISS" : "HIT") || value.cacheState !== state) {
          throw new Error(`Incomparable cache state: ${directory}/${lang}-${state}-${sample}`);
        }
        return value;
      });
    const baseline = read("reports/first-visit-baseline");
    const candidate = read("reports/first-visit");
    for (const metric of [...Object.keys(timingNoiseMs), ...sizes]) {
      const values = [...baseline, ...candidate].map((sample) => sample[metric]);
      if (
        !values.every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
      ) {
        throw new Error(`Missing or invalid ${metric} in ${lang}/${state}`);
      }
      const before = median(baseline.map((sample) => sample[metric]));
      const after = median(candidate.map((sample) => sample[metric]));
      const limit = sizes.includes(metric) ? before * 1.05 : before * 1.1 + timingNoiseMs[metric];
      rows.push({ lang, state, metric, before, after, limit, pass: after <= limit });
    }
  }
}
writeFileSync("reports/first-visit-comparison.json", JSON.stringify(rows, null, 2) + "\n");
for (const row of rows)
  console.log(
    `${row.pass ? "PASS" : "FAIL"} ${row.lang}/${row.state} ${row.metric}: ${row.before.toFixed(1)} -> ${row.after.toFixed(1)} (limit ${row.limit.toFixed(1)})`,
  );
if (rows.some((row) => !row.pass)) process.exitCode = 1;
