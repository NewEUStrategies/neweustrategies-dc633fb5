import { describe, expect, it } from "vitest";
import {
  overallStatus,
  parseGateReport,
  parseTestAccounting,
  parseE2eStatus,
  parsePullRequests,
  renderDeploymentReport,
  type DeploymentReportInput,
} from "../deploymentReport";

const base: DeploymentReportInput = {
  version: "v1.4.0",
  generatedAt: "2026-08-01T20:00:00.000Z",
  commit: "abcdef1234567890",
  branch: "main",
  previousRef: "v1.3.0",
  pullRequests: [{ number: 133, title: "CMS Gutenberg parity", sha: "a0c45172f0000000" }],
  unitTests: { files: 452, tests: 3968, passed: 3968, failed: 0, skipped: 0 },
  smoke: { status: "passed", tests: 24, failed: 0 },
  ciStatus: "passed",
  deploymentStatus: "passed",
  dbContract: { status: "passed", missing: 0 },
  migrationLedger: { status: "passed", missing: 0 },
  i18nParity: { status: "passed", missing: 0 },
  widgetFidelity: { status: "passed", unwaived: 0, waived: 11 },
};

describe("parsePullRequests", () => {
  it("czyta numery z merge commitów i bierze tytuł z treści", () => {
    const prs = parsePullRequests([
      {
        sha: "1111111111",
        subject: "Merge pull request #133 from NewEUStrategies/claude/cms",
        body: "\nCMS Gutenberg comparison\n",
      },
      { sha: "2222222222", subject: "Fix slider author size (#132)" },
      { sha: "3333333333", subject: "chore: bez PR" },
    ]);
    expect(prs.map((p) => p.number)).toEqual([133, 132]);
    expect(prs[0].title).toBe("CMS Gutenberg comparison");
    expect(prs[1].title).toBe("Fix slider author size");
  });

  it("deduplikuje ten sam PR", () => {
    const prs = parsePullRequests([
      { sha: "a", subject: "Merge pull request #10 from x/y" },
      { sha: "b", subject: "Merge pull request #10 from x/y" },
    ]);
    expect(prs).toHaveLength(1);
  });
});

describe("release evidence parsing", () => {
  it("does not turn transport failures or malformed counters into a successful gate", () => {
    expect(parseGateReport(null, ["missing"])).toBeNull();
    expect(parseGateReport({ status: "failed", error: "missing config" }, ["missing"])).toEqual({
      status: "failed",
      missing: 0,
    });
    expect(parseGateReport({}, ["missing"])).toBeNull();
    expect(parseGateReport({ missing: -1 }, ["missing"])).toBeNull();
    expect(parseGateReport({ missing: 0.5 }, ["missing"])).toBeNull();
    expect(parseGateReport({ missing: 0 }, ["missing"], "checked")).toBeNull();
    expect(parseGateReport({ missing: 0, checked: 0 }, ["missing"], "checked")).toBeNull();
    expect(parseGateReport({ missing: 0, checked: 1 }, ["missing"], "checked")).toEqual({
      status: "passed",
      missing: 0,
    });
    expect(
      parseGateReport({ missing: [], malformed: ["bad.sql"], staleReconciliations: [] }, [
        "missing",
        "malformed",
        "staleReconciliations",
      ]),
    ).toEqual({ status: "failed", missing: 1 });
    expect(
      parseGateReport({ missing: [], inconclusive: ["timeout"] }, ["missing", "inconclusive"]),
    ).toEqual({ status: "failed", missing: 1 });
  });
  it("requires complete test accounting tied to the released commit", () => {
    const report = {
      commit: "release",
      complete: true,
      modules: 2,
      collected: 5,
      reported: 5,
      unhandledErrors: 0,
      outcomes: { passed: 2, expectedFailed: 1, failed: 1, skipped: 1, pending: 0 },
    };
    expect(parseTestAccounting(report, "release")).toEqual({
      files: 2,
      tests: 5,
      passed: 3,
      failed: 1,
      skipped: 1,
    });
    expect(parseTestAccounting(report, "another-commit")).toBeNull();
    expect(parseTestAccounting({ ...report, reported: 4 }, "release")).toBeNull();
    expect(parseTestAccounting({ ...report, reported: 6, collected: 6 }, "release")).toBeNull();
    expect(parseTestAccounting({ ...report, complete: false }, "release")).toBeNull();
    expect(parseTestAccounting({ ...report, unhandledErrors: 1 }, "release")).toBeNull();
    expect(parseTestAccounting({}, "release")).toBeNull();
  });
  it("requires both E2E jobs for the exact commit and does not invent test counts", () => {
    const report = { commit: "release", checks: { e2e: "success", "e2e-seeded": "success" } };
    expect(parseE2eStatus(report, "release")).toEqual({
      status: "passed",
      tests: null,
      failed: null,
    });
    expect(parseE2eStatus(report, "other")).toBeNull();
    expect(parseE2eStatus({}, "release")).toBeNull();
    for (const result of ["failure", "cancelled", "timed_out", "skipped"]) {
      expect(
        parseE2eStatus({ ...report, checks: { e2e: "success", "e2e-seeded": result } }, "release")
          ?.status,
      ).toBe("failed");
    }
    expect(
      parseE2eStatus({ ...report, checks: { e2e: "success", "e2e-seeded": "unknown" } }, "release")
        ?.status,
    ).toBe("unknown");
    expect(renderDeploymentReport({ ...base, smoke: parseE2eStatus(report, "release") })).toContain(
      "status e2e + e2e-seeded dla tego commita",
    );
  });
});

describe("overallStatus", () => {
  it("zielony, gdy wszystkie bramki zielone", () => {
    expect(overallStatus(base)).toBe("passed");
  });

  it("czerwony, gdy którakolwiek bramka padła", () => {
    expect(overallStatus({ ...base, dbContract: { status: "failed", missing: 2 } })).toBe("failed");
    expect(
      overallStatus({ ...base, unitTests: { ...base.unitTests!, failed: 3, passed: 3965 } }),
    ).toBe("failed");
  });

  it("nieznany, gdy brakuje raportów", () => {
    expect(overallStatus({ ...base, deploymentStatus: "failed" })).toBe("failed");
    expect(overallStatus({ ...base, smoke: null })).toBe("unknown");
    expect(overallStatus({ ...base, unitTests: null })).toBe("unknown");
    expect(overallStatus({ ...base, unitTests: { ...base.unitTests!, tests: 0 } })).toBe("unknown");
    expect(overallStatus({ ...base, migrationLedger: null })).toBe("unknown");
    expect(overallStatus({ ...base, migrationLedger: { status: "failed", missing: 1 } })).toBe(
      "failed",
    );
  });
});

describe("renderDeploymentReport", () => {
  it("labels each missing measurement unknown instead of presenting a successful release", () => {
    const input = {
      ...base,
      previousRef: null,
      unitTests: null,
      smoke: null,
      dbContract: null,
      migrationLedger: null,
      i18nParity: null,
      widgetFidelity: null,
    };
    expect(overallStatus(input)).toBe("unknown");
    const report = renderDeploymentReport(input);
    expect(report).toContain("początek historii");
    expect(report.match(/unknown/g)?.length).toBeGreaterThanOrEqual(5);
  });
  it("shows a failed suite as failed even when the external checks passed", () => {
    const input = { ...base, unitTests: { files: 1, tests: 2, passed: 1, failed: 1, skipped: 0 } };
    expect(overallStatus(input)).toBe("failed");
    expect(renderDeploymentReport(input)).toContain("1/2 zielonych");
    expect(renderDeploymentReport(input)).toContain("failed");
  });
  it("zawiera PR-y, liczbę testów, status CI i wynik smoke", () => {
    const md = renderDeploymentReport(base);
    expect(md).toContain("Raport zgodności wdrożenia - v1.4.0");
    expect(md).toContain("**#133**");
    expect(md).toContain("3968/3968 zielonych w 452 plikach");
    expect(md).toContain("Smoke E2E");
    expect(md).toContain("Kontrakt bazy");
  });

  it("informuje o braku PR-ów w zakresie", () => {
    expect(renderDeploymentReport({ ...base, pullRequests: [] })).toContain("Brak merge commitów");
  });
});
