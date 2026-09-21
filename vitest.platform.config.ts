import { defineConfig } from "vitest/config";
import base from "./vitest.config";
import { platformCoverageFiles } from "./scripts/lib/platformCoverageScope";

/** A repeatable module measurement with a fixed audit denominator.
 * The complete suite still runs independently with every existing threshold.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    // Run the entire suite: indirect consumers also cover platform code.
    include: base.test?.include,
    maxWorkers: 3,
    coverage: {
      ...base.test?.coverage,
      include: platformCoverageFiles(),
      reportsDirectory: "coverage-platform",
      reporter: ["text-summary", "json-summary", "json", "lcov", "html"],
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
