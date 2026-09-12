import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const [engineFilter, variantFilter] = process.argv.slice(2);
if (engineFilter && !["builder", "blocks"].includes(engineFilter))
  throw new Error("Expected builder or blocks");
if (variantFilter && !["text", "form"].includes(variantFilter))
  throw new Error("Expected text or form");
for (const engine of engineFilter ? [engineFilter] : ["builder", "blocks"])
  for (const variant of variantFilter ? [variantFilter] : ["text", "form"])
    for (const lang of ["pl", "en"])
      for (const device of ["desktop", "mobile"])
        for (const cache of ["cold", "warm"])
          for (const sample of [1, 2, 3]) {
            const result = spawnSync(
              process.execPath,
              [
                cli,
                "test",
                "--config",
                "playwright.cms-performance.config.ts",
                "--project",
                device,
                "--grep",
                `cms ${engine} ${variant} ${lang} ${cache} ${sample}$`,
              ],
              {
                stdio: "inherit",
                env: {
                  ...process.env,
                  NES_CMS_PERFORMANCE_CASE: `${engine}-${variant}-${lang}-${device}-${cache}-${sample}`,
                },
              },
            );
            if (result.error) throw result.error;
            if (result.status !== 0) process.exit(result.status ?? 1);
          }
