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
 *   reports/test-accounting.json - complete merged suite, tied to commit
 *   reports/e2e-status.json       - e2e + e2e-seeded jobs, tied to commit
 *   reports/migration-ledger.json - applied migration requirements
 *   reports/db-contract.json   - scripts/check-db-contract.ts
 *   reports/i18n-parity.json   - test-bramka parytetu PL/EN
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  overallStatus,
  parseGateReport,
  parseTestAccounting,
  parseE2eStatus,
  parsePullRequests,
  renderDeploymentReport,
  type CheckStatus,
  type DeploymentReportInput,
} from "../src/lib/ci/deploymentReport";

const REPORTS = "reports";

function git(args: string[]): string {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Bramka wierności ustawień widgetów. Raport pisze
 * `settingsFidelity.gate.test.tsx`; `unwaived` niepuste = defekt bez
 * uzasadnienia, czyli czerwona bramka.
 */
function widgetFidelityStatus(): {
  status: CheckStatus;
  unwaived: number;
  waived: number;
} | null {
  const json = readJson(`${REPORTS}/widget-fidelity.json`);
  if (json === null) return null;
  const gate = parseGateReport(json, ["unwaived"], "widgets");
  if (!gate) return null;
  return { status: gate.status, unwaived: gate.missing, waived: num(json["waived"]) };
}

function parseCiStatus(value: string | undefined): CheckStatus {
  const raw = (value ?? "").toLowerCase();
  if (raw === "success" || raw === "passed") return "passed";
  if (raw === "failure" || raw === "failed") return "failed";
  if (raw === "skipped" || raw === "cancelled") return "skipped";
  return "unknown";
}

function main(): void {
  const versionArg = process.argv.find((a) => a.startsWith("--version="))?.split("=")[1];
  const commit = git(["rev-parse", "HEAD"]) || "unknown";
  const branch =
    process.env["GITHUB_REF_NAME"] || git(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown";
  const previousRef = git(["describe", "--tags", "--abbrev=0", "HEAD^"]) || null;
  const range = previousRef ? `${previousRef}..HEAD` : "HEAD";

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
    unitTests: parseTestAccounting(readJson(`${REPORTS}/test-accounting.json`), commit),
    smoke: parseE2eStatus(readJson(`${REPORTS}/e2e-status.json`), commit),
    ciStatus: parseCiStatus(process.env["CI_STATUS"]),
    deploymentStatus: parseCiStatus(process.env["DEPLOYMENT_STATUS"]),
    dbContract: parseGateReport(
      readJson(`${REPORTS}/db-contract.json`),
      ["missing", "inconclusive"],
      "checked",
    ),
    migrationLedger: parseGateReport(
      readJson(`${REPORTS}/migration-ledger.json`),
      ["missing", "malformed", "staleReconciliations"],
      "required",
    ),
    i18nParity: parseGateReport(readJson(`${REPORTS}/i18n-parity.json`), ["missing"]),
    widgetFidelity: widgetFidelityStatus(),
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
