import { describe, expect, it } from "vitest";
import {
  evaluatePlatformCoverage,
  uncoveredLcov,
  PLATFORM_METRICS,
  type FileCoverageCounts,
} from "../platformCoverage";
function counts(covered = 95, total = 100): FileCoverageCounts {
  return Object.fromEntries(
    PLATFORM_METRICS.map((key) => [key, { covered, total }]),
  ) as FileCoverageCounts;
}
describe("platform coverage gate", () => {
  it("aggregates integer counters, rather than averaging file percentages", () => {
    const result = evaluatePlatformCoverage(["small", "large"], {
      small: counts(0, 1),
      large: counts(99, 99),
    });
    expect(result.passed).toBe(true);
    expect(result.metrics.lines).toEqual({ total: 100, covered: 99, pct: 99 });
  });
  it.each(PLATFORM_METRICS)("fails when only %s is under 95 percent", (key) => {
    const c = counts();
    c[key] = { covered: 94999, total: 100000 };
    const result = evaluatePlatformCoverage(["f"], { f: c });
    expect(result.passed).toBe(false);
    expect(result.below).toEqual([key]);
  });
  it("fails a missing audited file or an empty scope", () => {
    expect(evaluatePlatformCoverage(["old", "new"], { old: counts() }).missing).toEqual(["new"]);
    expect(evaluatePlatformCoverage(["missing"], {}).passed).toBe(false);
    expect(evaluatePlatformCoverage([], {}).passed).toBe(false);
  });
  it.each([
    { total: 1.5, covered: 1 },
    { total: 2, covered: 0.5 },
    { total: 2, covered: -1 },
    { total: 2, covered: 3 },
    undefined,
  ])("fails invalid counters: %j", (value) => {
    const c = counts();
    Object.assign(c, { functions: value });
    const result = evaluatePlatformCoverage(["f"], { f: c });
    expect(result.invalid).toEqual(["f:functions"]);
    expect(result.passed).toBe(false);
  });
  it("accepts a zero executable denominator and an explicit stricter floor", () => {
    expect(evaluatePlatformCoverage(["empty"], { empty: counts(0, 0) }).passed).toBe(true);
    expect(evaluatePlatformCoverage(["f"], { f: counts(99) }, 100).passed).toBe(false);
  });
  it("exports exact uncovered lines, branch positions and function names for the selected scope", () => {
    const lcov = [
      "TN:",
      "SF:other",
      "DA:99,0",
      "end_of_record",
      "SF:src/file.ts",
      "FN:1,a",
      "FNDA:0,a,b",
      "FNDA:2,covered",
      "DA:2,0",
      "DA:3,4",
      "BRDA:2,0,0,-",
      "BRDA:2,0,1,0",
      "BRDA:3,1,0,5",
      "end_of_record",
      "DA:44,0",
    ].join("\r\n");
    expect(uncoveredLcov(lcov, new Set(["src/file.ts"]))).toEqual({
      "src/file.ts": { lines: [2], branches: ["2:0:0", "2:0:1"], functions: ["a,b"] },
    });
  });
});
