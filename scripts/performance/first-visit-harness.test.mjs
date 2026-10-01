import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { installFirstVisitLcpObserver } from "./firstVisitLcp.ts";
import { compareFirstVisitSamples, pairedTimingPValue } from "./compare-first-visit.mjs";
import {
  firstVisitCases,
  firstVisitComparisonPlan,
  firstVisitEnvironment,
  firstVisitSamples,
} from "./firstVisitPlan.ts";
import { fixtureResponse } from "./homeFixture.ts";
import { popupFixtureSettings } from "./popupFixture.ts";

test("isolated reports preserve the scenario identifier used by the SSR popup fixture", async () => {
  const saved = new Map(
    Object.keys(
      firstVisitEnvironment({ artifactRoot: "/candidate", baseline: false }, "manual"),
    ).map((key) => [key, process.env[key]]),
  );
  const outputs = new Set();
  try {
    for (const baseline of [true, false]) {
      for (const name of ["en-warm-1", "popup-first-render"]) {
        const side = baseline ? "baseline" : "candidate";
        Object.assign(
          process.env,
          firstVisitEnvironment({ artifactRoot: `/${side}`, baseline }, name),
        );
        const { default: config } = await import(
          `../../playwright.performance.config.ts?${side}-${name}`
        );
        assert.equal(config.outputDir, `test-results-performance/${side}-${name}`);
        assert.equal(
          config.reporter[1][1].outputFile,
          `reports/first-visit-playwright/${side}-${name}.json`,
        );
        outputs.add(config.outputDir);
        const reply = await fixtureResponse(
          new Request("http://127.0.0.1:4199/rest/v1/newsletter_settings"),
        );
        assert.deepEqual(
          await reply.json(),
          name === "popup-first-render" ? [popupFixtureSettings] : [],
        );
      }
    }
    assert.equal(outputs.size, 4);
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

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

function lcpHarness() {
  let observer;
  class FakeObserver {
    queued = [];
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }
    observe(options) {
      assert.equal(options.type, "largest-contentful-paint");
      assert.equal(options.buffered, true);
    }
    takeRecords() {
      return this.queued.splice(0);
    }
    deliver(entries) {
      this.callback({ getEntries: () => entries });
    }
  }
  const window = {};
  // Exercise the same closure-free serialization as page.addInitScript.
  runInNewContext(`(${installFirstVisitLcpObserver.toString()})()`, {
    window,
    performance: { now: () => 900 },
    PerformanceObserver: FakeObserver,
  });
  return { observer, read: () => structuredClone(window.__firstVisitLcp.read()) };
}

test("LCP retains image and text attribution without retaining live DOM elements", () => {
  const { observer, read } = lcpHarness();
  const element = {
    tagName: "IMG",
    id: "cover",
    getAttribute: () => "cover-image",
    closest: () => ({ getAttribute: () => "hero-widget" }),
  };
  const image = {
    startTime: 272,
    renderTime: 272,
    loadTime: 180,
    size: 250000,
    url: "https://fixture.invalid/image.svg",
    element,
  };
  observer.deliver([image]);
  const first = read();
  assert.equal(first.lcpMs, 272, "observer delivery time must not replace paint time");
  assert.deepEqual(first.lcpEntries[0], {
    startTime: 272,
    renderTime: 272,
    loadTime: 180,
    observedAt: 900,
    size: 250000,
    url: "https://fixture.invalid/image.svg",
    element: { tagName: "IMG", id: "cover", className: "cover-image", widgetId: "hero-widget" },
  });
  image.element = null;
  element.id = "changed-after-paint";
  observer.deliver([
    { ...image, startTime: 552, renderTime: 552, loadTime: 0, url: "", element: null },
  ]);
  const final = read();
  assert.equal(final.lcpMs, 552);
  assert.equal(final.lcpEntries.length, 2);
  assert.deepEqual(final.lcpEntries[0], first.lcpEntries[0]);
  assert.equal(final.lcpEntries[1].element, null);
  assert.equal(final.lcpEntries[1].url, "");
  assert.equal(first.lcpEntries.length, 1, "earlier snapshots must remain unchanged");
});

test("LCP reads pending records before callback delivery and drains each record only once", () => {
  const { observer, read } = lcpHarness();
  assert.deepEqual(read(), { lcpMs: 0, lcpEntries: [] });
  const entry = { startTime: 272, renderTime: 272, loadTime: 0, size: 400, url: "", element: null };
  observer.deliver([entry]);
  observer.queued.push({ ...entry, startTime: 552, renderTime: 552, size: 800 });
  const final = read();
  assert.equal(final.lcpMs, 552);
  assert.deepEqual(
    final.lcpEntries.map((candidate) => candidate.startTime),
    [272, 552],
  );
  assert.deepEqual(read(), final, "takeRecords must not duplicate delivered candidates");
});

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
  assert.equal(fcp.pValue, 1 / 128);
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
    // A timing regression must be repeatable, not just a split in a noisy
    // distribution. Byte budgets remain unconditional at the original +5%.
    if (metric.endsWith("Ms")) {
      for (const sample of candidate) sample[metric] = limit + 1;
    } else candidate[3][metric] = limit + 1;
    row = compareFirstVisitSamples(original, candidate, expected).find(
      (row) => row.metric === metric,
    );
    assert.equal(row.pass, false);
  }
});

test("paired evidence distinguishes unchanged, faster and consistently slower timings", () => {
  const before = [100, 200, 300, 400, 500, 600, 700];
  assert.equal(pairedTimingPValue(before, before), 1);
  assert.equal(
    pairedTimingPValue(
      before,
      before.map((value) => value - 50),
    ),
    1,
  );
  assert.equal(
    pairedTimingPValue(
      before,
      before.map((value) => value + 50),
    ),
    1 / 128,
  );
  // Only one of seven observations slowed down: not evidence of a consistent change.
  assert.equal(pairedTimingPValue(before, [1000, ...before.slice(1)]), 0.5);
});

test("the identical-artifact LCP split remains visible as a warning, with all observations", () => {
  // Job 109552266025: application JS/HTML/CSS were identical on both sides.
  const before = [840, 876, 856, 856, 1256, 856, 880];
  const after = [1160, 924, 1236, 1228, 860, 1160, 852];
  const baseline = samples().map((row, index) => ({ ...row, lcpMs: before[index] }));
  const candidate = samples().map((row, index) => ({ ...row, lcpMs: after[index] }));
  const rows = compareFirstVisitSamples(baseline, candidate, expected);
  const lcp = rows.find((row) => row.metric === "lcpMs");
  assert.equal(lcp.before, 856);
  assert.equal(lcp.after, 1160);
  assert.equal(lcp.limit, 1041.6);
  assert.equal(lcp.pValue, 19 / 128);
  assert.equal(lcp.verdict, "unconfirmed-timing-change");
  assert.equal(lcp.pass, true);
  assert.deepEqual(lcp.baselineSamples, before);
  assert.deepEqual(lcp.candidateSamples, after);
  assert.deepEqual(compareFirstVisitSamples(baseline, [...candidate].reverse(), expected), rows);
});

test("the reported PR 429 warm LCP regression still fails without relaxing its budget", () => {
  const before = [596, 284, 264, 268, 272, 260, 276];
  const after = [552, 564, 552, 336, 596, 552, 272];
  const baseline = samples().map((row, index) => ({ ...row, lcpMs: before[index] }));
  const candidate = samples().map((row, index) => ({ ...row, lcpMs: after[index] }));
  const lcp = compareFirstVisitSamples(baseline, candidate, expected).find(
    (row) => row.metric === "lcpMs",
  );
  assert.equal(lcp.before, 272);
  assert.equal(lcp.after, 552);
  assert.ok(Math.abs(lcp.limit - 399.2) < 0.00001);
  assert.equal(lcp.pValue, 4 / 128);
  assert.equal(lcp.verdict, "regression");
  assert.equal(lcp.pass, false);
});

test("LCP comparison preserves attribution in sample order, including unavailable elements", () => {
  const baseline = samples().map((row) => ({
    ...row,
    lcpEntries: [{ startTime: row.lcpMs, element: null, url: "" }],
  }));
  const candidate = samples().map((row) => ({
    ...row,
    lcpEntries: [{ startTime: row.lcpMs, element: { widgetId: `widget-${row.sample}` } }],
  }));
  const lcp = compareFirstVisitSamples(
    [...baseline].reverse(),
    [...candidate].reverse(),
    expected,
  ).find((row) => row.metric === "lcpMs");
  for (const [side, rows] of [
    ["baseline", baseline],
    ["candidate", candidate],
  ]) {
    assert.deepEqual(
      lcp.attribution[side],
      rows.map((row) => ({
        sample: row.sample,
        entries: row.lcpEntries,
      })),
    );
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
    for (const sample of firstVisitSamples) {
      const path = join(directory, `reports/first-visit/en-warm-${sample}.json`);
      const row = JSON.parse(readFileSync(path, "utf8"));
      row.lcpMs = 900;
      row.lcpEntries = [{ startTime: 900, element: { widgetId: "late-cover" } }];
      writeFileSync(path, JSON.stringify(row));
    }
    const lcpFailed = run();
    assert.equal(lcpFailed.status, 1);
    assert.match(lcpFailed.stdout, /FAIL en\/warm lcpMs/);
    assert.match(lcpFailed.stdout, /LCP_ATTRIBUTION en\/warm .*late-cover/);
    rmSync(join(directory, "reports/first-visit/en-warm-7.json"));
    assert.equal(run().status, 1);
    assert.equal(existsSync(report), false, "a failed run must not leave a stale comparison");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
