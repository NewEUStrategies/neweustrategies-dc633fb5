import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  firstVisitCases,
  firstVisitComparisonPlan,
  firstVisitEnvironment,
  firstVisitReportDirectory,
} from "./firstVisitPlan.ts";

const require = createRequire(import.meta.url);
const cli = require.resolve("@playwright/test/cli");
const [mode, baselineRoot, candidateRoot, ...extra] = process.argv.slice(2);
if (mode && (mode !== "--compare" || !baselineRoot || !candidateRoot || extra.length)) {
  throw new Error("Usage: run-first-visit.mjs [--compare <baseline-root> <candidate-root>]");
}
const artifacts = mode
  ? [
      { artifactRoot: resolve(baselineRoot), baseline: true },
      { artifactRoot: resolve(candidateRoot), baseline: false },
    ]
  : [
      {
        artifactRoot: resolve(process.env.NES_PERFORMANCE_ARTIFACT_ROOT ?? process.cwd()),
        baseline: process.env.NES_PERFORMANCE_BASELINE === "1",
      },
    ];
rmSync("reports/first-visit-comparison.json", { force: true });
for (const artifact of artifacts) {
  // Never allow a previous/partial run to supply a missing sample.
  rmSync(firstVisitReportDirectory(artifact.baseline), { recursive: true, force: true });
}

function run(artifact, name, suite, grep) {
  console.log(`FIRST_VISIT_CASE ${artifact.baseline ? "baseline" : "candidate"}/${name}`);
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "test",
      "--config",
      "playwright.performance.config.ts",
      `e2e-performance/${suite}.spec.ts`,
      ...(grep ? ["--grep", grep] : []),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        ...firstVisitEnvironment(artifact, name),
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Every navigation still owns a new server, browser and context. Interleaving
// equivalent cases avoids measuring all of A before a CPU-heavy build of B.
const plan = mode
  ? firstVisitComparisonPlan(artifacts[0].artifactRoot, artifacts[1].artifactRoot)
  : firstVisitCases().map((measurement) => ({ ...measurement, ...artifacts[0] }));
for (const measurement of plan) {
  const { lang, cacheState, sample } = measurement;
  run(
    measurement,
    `${lang}-${cacheState}-${sample}`,
    "first-visit",
    `first visit ${lang}, ${cacheState}, sample ${sample}$`,
  );
}

// Interactions cannot warm any timed sample. Keep the baseline's existing
// correctness assertions and the candidate's first-use loading contracts.
for (const artifact of artifacts) {
  const suites = artifact.baseline
    ? ["dock-panels"]
    : ["dock-panels", "on-demand-overlays", "popup-first-render"];
  for (const suite of suites) run(artifact, suite, suite);
}
