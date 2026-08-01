/**
 * Raport zgodności wdrożenia - generowany po każdej wersji.
 *
 * Zbiera w jednym pliku: numery PR wchodzące w wydanie, liczbę testów
 * jednostkowych, status CI, wynik smoke'ów E2E oraz wyniki bramek kontraktu
 * bazy i parytetu PL/EN. Wynik ląduje w reports/ (artefakt CI) i w GitHub Step
 * Summary.
 *
 * Usage:
 *   bun run report:deployment [--version=v1.2.3]
 * Wejścia opcjonalne (jeśli istnieją):
 *   reports/vitest.json        - `vitest run --reporter=json --outputFile=`
 *   reports/playwright.json    - `playwright test --reporter=json`
 *   reports/db-contract.json   - scripts/check-db-contract.ts
 *   reports/i18n-parity.json   - test-bramka parytetu PL/EN
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  overallStatus,
  parsePullRequests,
  renderDeploymentReport,
  type CheckStatus,
  type DeploymentReportInput,
  type TestTotals,
} from "../src/lib/ci/deploymentReport";

const REPORTS = "reports";

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function vitestTotals(): TestTotals | null {
  const json = readJson(`${REPORTS}/vitest.json`);
  if (json === null) return null;
  const results = Array.isArray(json["testResults"]) ? json["testResults"] : [];
  return {
    files: results.length || num(json["numTotalTestSuites"]),
    tests: num(json["numTotalTests"]),
    passed: num(json["numPassedTests"]),
    failed: num(json["numFailedTests"]),
    skipped: num(json["numPendingTests"]),
  };
}

function smokeTotals(): { status: CheckStatus; tests: number; failed: number } | null {
  const json = readJson(`${REPORTS}/playwright.json`);
  if (json === null) return null;
  const stats = (json["stats"] ?? {}) as Record<string, unknown>;
  const failed = num(stats["unexpected"]) + num(stats["flaky"]);
  const tests = num(stats["expected"]) + failed + num(stats["skipped"]);
  return { status: failed > 0 ? "failed" : "passed", tests, failed };
}

function gateStatus(path: string, missingKey: string): { status: CheckStatus; missing: number } | null {
  const json = readJson(path);
  if (json === null) return null;
  const raw = json[missingKey];
  const missing = Array.isArray(raw) ? raw.length : num(raw);
  return { status: missing > 0 ? "failed" : "passed", missing };
}

function parseCiStatus(): CheckStatus {
  const raw = (process.env["CI_STATUS"] ?? "").toLowerCase();
  if (raw === "success" || raw === "passed") return "passed";
  if (raw === "failure" || raw === "failed") return "failed";
  if (raw === "skipped" || raw === "cancelled") return "skipped";
  return "unknown";
}

function main(): void {
  const versionArg = process.argv.find((a) => a.startsWith("--version="))?.split("=")[1];
  const commit = git(["rev-parse", "HEAD"]) || "unknown";
  const branch = process.env["GITHUB_REF_NAME"] || git(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown";
  const previousRef = git(["describe", "--tags", "--abbrev=0", "HEAD^"]) || null;
  const range = previousRef ? `${previousRef}..HEAD` : "HEAD~50..HEAD";

  const log = git(["log", range, "--pretty=format:%H%x1f%s%x1f%b%x1e"]);
  const commits = log
    .split("\u001e")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const [sha, subject, body] = entry.split("\u001f");
      return { sha: sha ?? "", subject: subject ?? "", body: body ?? "" };
    });

  const input: DeploymentReportInput = {
    version: versionArg || git(["describe", "--tags", "--always"]) || commit.slice(0, 8),
    generatedAt: new Date().toISOString(),
    commit,
    branch,
    previousRef,
    pullRequests: parsePullRequests(commits),
    unitTests: vitestTotals(),
    smoke: smokeTotals(),
    ciStatus: parseCiStatus(),
    dbContract: gateStatus(`${REPORTS}/db-contract.json`, "missing"),
    i18nParity: gateStatus(`${REPORTS}/i18n-parity.json`, "missing"),
  };

  const markdown = renderDeploymentReport(input);
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(`${REPORTS}/deployment-report.md`, markdown);
  writeFileSync(
    `${REPORTS}/deployment-report.json`,
    `${JSON.stringify({ ...input, overall: overallStatus(input) }, null, 2)}\n`,
  );

  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) writeFileSync(summary, `${markdown}\n`, { flag: "a" });
  console.log(markdown);
}

main();
