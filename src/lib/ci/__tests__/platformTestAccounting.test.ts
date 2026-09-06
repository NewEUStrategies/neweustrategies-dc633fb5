// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ write: vi.fn(), mkdir: vi.fn() }));
vi.mock("node:fs", () => ({ writeFileSync: h.write, mkdirSync: h.mkdir }));
import Reporter from "../../../../scripts/vitest/testAccountingReporter";
function module(states: string[], pendingModule = false) {
  return {
    moduleId: "test-file",
    state: () => (pendingModule ? "pending" : "passed"),
    children: {
      allTests: () =>
        states.map((state) => ({
          result: () => ({ state: state === "expected" ? "passed" : state }),
          options: { fails: state === "expected" },
        })),
    },
  };
}
let exitCode: typeof process.exitCode;
beforeEach(() => {
  vi.clearAllMocks();
  exitCode = process.exitCode;
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  process.exitCode = exitCode;
  vi.restoreAllMocks();
});
function report() {
  return JSON.parse(h.write.mock.calls[0][1]);
}
describe("machine-readable test accounting", () => {
  it("distinguishes passing, expected-failing, failing and skipped tests without hiding failures", () => {
    new Reporter().onTestRunEnd([module(["passed", "expected", "failed", "skipped"])], []);
    expect(report()).toMatchObject({
      collected: 4,
      reported: 4,
      complete: true,
      outcomes: { passed: 1, expectedFailed: 1, failed: 1, skipped: 1, pending: 0 },
    });
  });
  it.each([module(["passed", "pending"]), module([], true)])(
    "fails a lost test or a worker that never returned a module result",
    (mod) => {
      new Reporter().onTestRunEnd([mod], []);
      expect(report().complete).toBe(false);
      expect(report().offenders).toHaveLength(1);
      expect(process.exitCode).toBe(1);
    },
  );
  it("fails unhandled process errors even if every test reported a result", () => {
    new Reporter().onTestRunEnd([module(["passed"])], [new Error("worker crashed")]);
    expect(report()).toMatchObject({ complete: false, unhandledErrors: 1 });
    expect(process.exitCode).toBe(1);
  });
  it("leaves an interrupted run without a success ledger", () => {
    new Reporter().onTestRunEnd([module(["pending"])], [], "interrupted");
    expect(h.write).not.toHaveBeenCalled();
  });
  it("stores the same execution ledger beside its coverage report", () => {
    const reporter = new Reporter();
    reporter.onInit({
      config: { coverage: { enabled: true, reportsDirectory: "coverage-platform" } },
    });
    reporter.onTestRunEnd([module(["passed"])], []);
    expect(h.write).toHaveBeenCalledWith(
      "coverage-platform/test-accounting.json",
      h.write.mock.calls[0][1],
    );
  });
  it("does not create a coverage ledger for a run without instrumentation", () => {
    const reporter = new Reporter();
    reporter.onInit({
      config: { coverage: { enabled: false, reportsDirectory: "coverage-platform" } },
    });
    reporter.onTestRunEnd([module(["passed"])], []);
    expect(h.write).toHaveBeenCalledTimes(1);
  });
});
