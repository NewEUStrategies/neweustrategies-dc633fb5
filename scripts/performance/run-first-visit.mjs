import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cli = require.resolve("@playwright/test/cli");
// Every measured navigation owns a new artifact server and browser context.
// Dock interactions run afterwards, in a separate process, so cannot warm it.
for (const lang of ["pl", "en"]) {
  for (const cache of ["cold", "warm"]) {
    for (const sample of [1, 2, 3]) {
      const result = spawnSync(
        process.execPath,
        [
          cli,
          "test",
          "--config",
          "playwright.performance.config.ts",
          "e2e-performance/first-visit.spec.ts",
          "--grep",
          `first visit ${lang}, ${cache}, sample ${sample}`,
        ],
        {
          stdio: "inherit",
          env: { ...process.env, NES_PERFORMANCE_CASE: `${lang}-${cache}-${sample}` },
        },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) process.exit(result.status ?? 1);
    }
  }
}
const suites = ["dock-panels"];
// The base artifact intentionally predates the first-use loading contract.
if (process.env.NES_PERFORMANCE_BASELINE !== "1") suites.push("on-demand-overlays");
for (const suite of suites) {
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "test",
      "--config",
      "playwright.performance.config.ts",
      `e2e-performance/${suite}.spec.ts`,
    ],
    { stdio: "inherit", env: { ...process.env, NES_PERFORMANCE_CASE: suite } },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
