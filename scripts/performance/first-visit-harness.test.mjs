import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { compareFirstVisitSamples } from "./compare-first-visit.mjs";
import { firstVisitCases, firstVisitComparisonPlan, firstVisitSamples } from "./firstVisitPlan.ts";

const expected = { path: "/en", lang: "en", state: "warm" };
const samples = () =>
  firstVisitSamples.map((sample) => ({
    path: "/en",
    sample,
    cacheState: "warm",
    cache: "HIT",
    browserCache: "cold-routing-disables-http-cache",
    ttfbMs: 18,
    fcpMs: 176,
    lcpMs: 408,
    readyMs: 773,
    interactionCompleteMs: 1665,
    jsBytes: 3000000,
    htmlBytes: 380000,
    inlineCssBytes: 132000,
  }));

test("every comparison pairs the same case and alternates order without skipping samples", () => {
  const plan = firstVisitComparisonPlan("/baseline", "/candidate");
  assert.equal(plan.length, 2 * 2 * 2 * 7);
  const firstByCase = new Map();
  let baselineFirst = 0;
  for (let index = 0; index < plan.length; index += 2) {
    const [first, second] = plan.slice(index, index + 2);
    assert.deepEqual(
      [first.path, first.lang, first.cacheState, first.sample],
      [second.path, second.lang, second.cacheState, second.sample],
    );
    assert.notEqual(first.baseline, second.baseline);
    for (const row of [first, second]) {
      assert.equal(row.artifactRoot, row.baseline ? "/baseline" : "/candidate");
    }
    baselineFirst += Number(first.baseline);
    const key = `${first.lang}/${first.cacheState}`;
    if (firstByCase.has(key)) assert.notEqual(firstByCase.get(key), first.baseline);
    firstByCase.set(key, first.baseline);
  }
  assert.equal(baselineFirst, plan.length / 4);
  for (const baseline of [true, false]) {
    const cases = plan.filter((row) => row.baseline === baseline);
    assert.equal(
      new Set(cases.map((row) => `${row.lang}/${row.cacheState}/${row.sample}`)).size,
      28,
    );
  }
});

test("partial, duplicate and incompatible samples cannot pass", () => {
  assert.throws(
    () => compareFirstVisitSamples(samples(), samples().slice(1), expected),
    /7 distinct/,
  );
  const duplicate = samples();
  duplicate[1] = duplicate[0];
  assert.throws(() => compareFirstVisitSamples(duplicate, samples(), expected), /7 distinct/);
  for (const change of [
    { sample: 8 },
    { path: "/" },
    { cacheState: "cold" },
    { cache: "MISS" },
    { browserCache: "warm" },
    { browserCache: undefined },
  ]) {
    for (const side of [0, 1]) {
      const pair = [samples(), samples()];
      Object.assign(pair[side][3], change);
      assert.throws(() => compareFirstVisitSamples(...pair, expected), /Incomparable/);
    }
  }
});

test("every timing and size metric rejects missing or invalid observations", () => {
  for (const metric of [
    "ttfbMs",
    "fcpMs",
    "lcpMs",
    "readyMs",
    "interactionCompleteMs",
    "jsBytes",
    "htmlBytes",
    "inlineCssBytes",
  ]) {
    for (const value of [null, undefined, NaN, Infinity, 0, -1, "100"]) {
      const candidate = samples();
      candidate[6][metric] = value;
      assert.throws(() => compareFirstVisitSamples(samples(), candidate, expected), /invalid/);
    }
  }
});

test("the reported 176 -> 312 ms FCP regression still fails with the original limit", () => {
  const candidate = samples().map((row) => ({ ...row, fcpMs: 312, lcpMs: 320, jsBytes: 2700000 }));
  const rows = compareFirstVisitSamples(samples(), candidate, expected);
  const fcp = rows.find((row) => row.metric === "fcpMs");
  assert.equal(fcp.limit, 293.6);
  assert.equal(fcp.pass, false);
  assert.deepEqual(fcp.baselineSamples, Array(7).fill(176));
  assert.deepEqual(fcp.candidateSamples, Array(7).fill(312));
  assert.ok(rows.filter((row) => row.metric !== "fcpMs").every((row) => row.pass));
});

test("unchanged budgets tolerate isolated outliers but reject a consistent regression", () => {
  const limits = {
    ttfbMs: 69.8,
    fcpMs: 293.6,
    lcpMs: 548.8,
    readyMs: 1000.3,
    interactionCompleteMs: 1981.5,
    jsBytes: 3150000,
    htmlBytes: 399000,
    inlineCssBytes: 138600,
  };
  const original = samples();
  for (const [metric, limit] of Object.entries(limits)) {
    const candidate = samples();
    for (let index = 0; index < 3; index++) candidate[index][metric] = limit * 10;
    let row = compareFirstVisitSamples(original, candidate, expected).find(
      (row) => row.metric === metric,
    );
    assert.ok(Math.abs(row.limit - limit) < 0.00001);
    assert.equal(row.pass, true);
    candidate[3][metric] = limit + 1;
    row = compareFirstVisitSamples(original, candidate, expected).find(
      (row) => row.metric === metric,
    );
    assert.equal(row.pass, false);
  }
});

test("the CLI writes all 32 comparisons and exits nonzero for a regression or missing file", () => {
  const directory = mkdtempSync(join(tmpdir(), "first-visit-gate-"));
  const cli = fileURLToPath(new URL("./compare-first-visit.mjs", import.meta.url));
  const run = () => spawnSync(process.execPath, [cli], { cwd: directory, encoding: "utf8" });
  try {
    for (const side of ["first-visit", "first-visit-baseline"]) {
      mkdirSync(join(directory, "reports", side), { recursive: true });
      for (const measurement of firstVisitCases()) {
        const row = {
          ...samples()[0],
          ...measurement,
          cache: measurement.cacheState === "cold" ? "MISS" : "HIT",
        };
        writeFileSync(
          join(directory, "reports", side, `${row.lang}-${row.cacheState}-${row.sample}.json`),
          JSON.stringify(row),
        );
      }
    }
    const passed = run();
    assert.equal(passed.status, 0, passed.stderr);
    const report = join(directory, "reports/first-visit-comparison.json");
    assert.equal(JSON.parse(readFileSync(report, "utf8")).length, 32);
    for (const sample of firstVisitSamples) {
      const path = join(directory, `reports/first-visit/en-warm-${sample}.json`);
      const row = JSON.parse(readFileSync(path, "utf8"));
      row.fcpMs = 312;
      writeFileSync(path, JSON.stringify(row));
    }
    const failed = run();
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /FAIL en\/warm fcpMs/);
    rmSync(join(directory, "reports/first-visit/en-warm-7.json"));
    assert.equal(run().status, 1);
    assert.equal(existsSync(report), false, "a failed run must not leave a stale comparison");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
