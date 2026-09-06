import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import scope from "../governance/platform-coverage-scope.json";
import { platformCoverageFiles } from "./lib/platformCoverageScope";
import {
  evaluatePlatformCoverage,
  uncoveredLcov,
  PLATFORM_METRICS,
  type FileCoverageCounts,
} from "../src/lib/ci/platformCoverage";

const dir = process.argv[2] ?? "coverage";
const summaryPath = resolve(dir, "coverage-summary.json");
const lcovPath = resolve(dir, "lcov.info");
const accountingPath = resolve(dir, "test-accounting.json");
if (!existsSync(summaryPath) || !existsSync(lcovPath) || !existsSync(accountingPath)) {
  console.error(
    "Platform coverage: missing summary, LCOV or test accounting; run the complete coverage suite first.",
  );
  process.exit(1);
}
const accounting = JSON.parse(readFileSync(accountingPath, "utf8")) as {
  complete?: boolean;
  collected?: number;
  reported?: number;
};
if (
  accounting.complete !== true ||
  !accounting.collected ||
  accounting.collected !== accounting.reported
) {
  console.error("Platform coverage: incomplete test execution; percentages cannot pass the gate.");
  process.exit(1);
}
const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as Record<string, FileCoverageCounts>;
const normalized = Object.fromEntries(
  Object.entries(summary)
    .filter(([key]) => key !== "total")
    .map(([file, counts]) => [
      relative(process.cwd(), resolve(file)).replaceAll("\\", "/"),
      counts,
    ]),
);
const files = platformCoverageFiles();
const result = evaluatePlatformCoverage(files, normalized);
const uncovered = uncoveredLcov(readFileSync(lcovPath, "utf8"), new Set(files));
const report = {
  auditCommit: scope.auditCommit,
  testAccounting: accounting,
  frozenFiles: scope.files.length,
  measuredFiles: files.length,
  ...result,
  files: files.map((file) => ({
    file,
    metrics: normalized[file] ?? null,
    uncovered: uncovered[file] ?? null,
  })),
};
mkdirSync("reports", { recursive: true });
writeFileSync("reports/platform-coverage.json", JSON.stringify(report, null, 2) + "\n");
for (const key of PLATFORM_METRICS) {
  const m = result.metrics[key];
  console.log(
    `${key}: ${m.covered}/${m.total} = ${m.pct.toFixed(4)}% (minimum ${result.minimum}%)`,
  );
}
if (!result.passed) {
  console.error(
    `Platform coverage FAILED: below=${result.below.join(",")} missing=${result.missing.join(",")} invalid=${result.invalid.join(",")}`,
  );
  process.exitCode = 1;
} else
  console.log(`Platform coverage passed: all ${files.length} audited/new files accounted for.`);
