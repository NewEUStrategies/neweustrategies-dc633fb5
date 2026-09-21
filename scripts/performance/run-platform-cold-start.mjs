import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cli = require.resolve("@playwright/test/cli");
// TCP readiness in the config leaves SSR cold for each separate process.
for (const path of ["events", "experts", "programs", "podcasts", "live", "web-stories"]) {
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "test",
      "--config",
      "playwright.performance.config.ts",
      "e2e-performance/platform-cold-start.spec.ts",
      "--grep",
      `platform cold entry /${path}$`,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, NES_PERFORMANCE_CASE: `platform-${path}` },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
