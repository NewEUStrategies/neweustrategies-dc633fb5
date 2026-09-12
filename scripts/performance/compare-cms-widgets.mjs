import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const timingNoise = {
  ttfbMs: 50,
  fcpMs: 100,
  lcpMs: 100,
  hydrationReadyMs: 150,
  interactionMs: 150,
};
const sizes = ["jsBodyBytes", "jsTransferBytes", "htmlBytes"];
const median = (values) => [...values].sort((a, b) => a - b)[1];
export function compareSamples(baseline, candidate, expected) {
  for (const samples of [baseline, candidate]) {
    if (samples.length !== 3 || new Set(samples.map((row) => row.sample)).size !== 3)
      throw new Error("Three distinct samples required");
    for (const row of samples) {
      if (
        ![1, 2, 3].includes(row.sample) ||
        Object.entries(expected).some(([key, value]) => row[key] !== value) ||
        row.cache !== (expected.serverCache === "cold" ? "MISS" : "HIT") ||
        row.browserCache !== "cold-routing-disables-http-cache"
      )
        throw new Error("Incomparable CMS sample");
      if (expected.variant === "form" && typeof row.serverFormRetained !== "boolean")
        throw new Error("Missing form retention observation");
      if (
        !row.serverTitleRetained ||
        (samples === candidate && expected.variant === "form" && !row.serverFormRetained)
      )
        throw new Error("SSR content was replaced");
      for (const metric of [
        ...Object.keys(timingNoise),
        ...sizes,
        "jsRequests",
        "requestCount",
        "cls",
        "longTaskMs",
      ]) {
        if (
          typeof row[metric] !== "number" ||
          !Number.isFinite(row[metric]) ||
          row[metric] < 0 ||
          (!["cls", "longTaskMs"].includes(metric) && row[metric] === 0)
        )
          throw new Error(`Invalid ${metric}`);
      }
    }
  }
  return [
    ...Object.keys(timingNoise),
    ...sizes,
    "jsRequests",
    "requestCount",
    "cls",
    "longTaskMs",
  ].map((metric) => {
    const before = median(baseline.map((row) => row[metric]));
    const after = median(candidate.map((row) => row[metric]));
    // Same relative allowances as the existing first-visit comparison. Counts
    // and long tasks are diagnostics: splitting may add small useful requests.
    const limit = sizes.includes(metric)
      ? before * 1.05
      : metric in timingNoise
        ? before * 1.1 + timingNoise[metric]
        : metric === "cls"
          ? 0.1
          : null;
    return {
      ...expected,
      metric,
      baselineFormReplacements: baseline.filter(
        (sample) => expected.variant === "form" && !sample.serverFormRetained,
      ).length,
      before,
      after,
      delta: after - before,
      limit,
      pass: limit === null || (metric === "cls" ? after < limit : after <= limit),
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [engine, variant] = process.argv.slice(2);
  if (!["builder", "blocks"].includes(engine) || !["text", "form"].includes(variant))
    throw new Error("Expected engine and variant");
  const rows = [];
  for (const lang of ["pl", "en"])
    for (const device of ["desktop", "mobile"])
      for (const serverCache of ["cold", "warm"]) {
        const expected = { engine, variant, lang, device, serverCache };
        const read = (directory) =>
          [1, 2, 3].map((sample) =>
            JSON.parse(
              readFileSync(
                `${directory}/${engine}-${variant}-${lang}-${device}-${serverCache}-${sample}.json`,
                "utf8",
              ),
            ),
          );
        rows.push(
          ...compareSamples(
            read("reports/cms-widgets-baseline"),
            read("reports/cms-widgets"),
            expected,
          ),
        );
      }
  writeFileSync(
    `reports/cms-comparison-${engine}-${variant}.json`,
    JSON.stringify(rows, null, 2) + "\n",
  );
  for (const row of rows)
    console.log(
      `${row.pass ? "PASS" : "FAIL"} ${row.lang}/${row.device}/${row.serverCache} ${row.metric}: ${row.before.toFixed(2)} -> ${row.after.toFixed(2)}`,
    );
  if (rows.some((row) => !row.pass)) process.exitCode = 1;
}
