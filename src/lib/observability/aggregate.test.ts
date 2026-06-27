import { describe, it, expect } from "vitest";
import { aggregateVitals, percentile, type VitalSample } from "./aggregate";

describe("percentile (nearest-rank)", () => {
  it("returns 0 for an empty array", () => {
    expect(percentile([], 0.75)).toBe(0);
  });

  it("returns the only element for a singleton", () => {
    expect(percentile([42], 0.75)).toBe(42);
  });

  it("computes p75 by nearest rank", () => {
    // n=10, rank = ceil(0.75*10)=8 -> index 7 -> value 8
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.75)).toBe(8);
  });

  it("computes the median (p50)", () => {
    // n=4, rank = ceil(0.5*4)=2 -> index 1 -> value 20
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
  });

  it("clamps to the first/last element at the extremes", () => {
    expect(percentile([5, 6, 7], 0)).toBe(5);
    expect(percentile([5, 6, 7], 1)).toBe(7);
  });
});

function samples(metric: string, values: number[], rating?: string | null): VitalSample[] {
  return values.map((value) => ({ metric, value, rating: rating ?? null }));
}

describe("aggregateVitals", () => {
  it("returns an empty report for no samples", () => {
    const r = aggregateVitals([], { windowDays: 7 });
    expect(r).toEqual({ windowDays: 7, total: 0, metrics: [], paths: [], trends: [] });
  });

  it("ignores unknown metric names and non-finite values", () => {
    const r = aggregateVitals(
      [
        { metric: "BOGUS", value: 100 },
        { metric: "LCP", value: Number.NaN },
        { metric: "LCP", value: 2000 },
      ],
      { windowDays: 7 },
    );
    expect(r.total).toBe(1);
    expect(r.metrics).toHaveLength(1);
    expect(r.metrics[0].metric).toBe("LCP");
    expect(r.metrics[0].count).toBe(1);
  });

  it("computes p75/p50/min/max and total per metric", () => {
    const r = aggregateVitals(samples("LCP", [1000, 2000, 3000, 4000]), { windowDays: 7 });
    const lcp = r.metrics[0];
    expect(lcp.metric).toBe("LCP");
    expect(lcp.count).toBe(4);
    expect(lcp.min).toBe(1000);
    expect(lcp.max).toBe(4000);
    // n=4, p75 rank=3 -> index 2 -> 3000; p50 rank=2 -> index 1 -> 2000
    expect(lcp.p75).toBe(3000);
    expect(lcp.p50).toBe(2000);
    expect(r.total).toBe(4);
  });

  it("rates a metric by its p75 against Web Vitals thresholds", () => {
    // LCP p75 = 3000 -> needs-improvement (good<=2500, poor<=4000)
    const ni = aggregateVitals(samples("LCP", [1000, 2000, 3000, 4000]), { windowDays: 7 });
    expect(ni.metrics[0].rating).toBe("needs-improvement");

    // All fast -> good
    const good = aggregateVitals(samples("LCP", [1000, 1200, 1500, 1800]), { windowDays: 7 });
    expect(good.metrics[0].rating).toBe("good");

    // All slow -> poor
    const poor = aggregateVitals(samples("LCP", [5000, 6000, 7000, 8000]), { windowDays: 7 });
    expect(poor.metrics[0].rating).toBe("poor");
  });

  it("buckets ratings, preferring the stored rating when valid", () => {
    const r = aggregateVitals(
      [
        { metric: "CLS", value: 0.05, rating: "good" },
        { metric: "CLS", value: 0.05, rating: "poor" }, // stored rating wins over value
        { metric: "CLS", value: 0.2, rating: "needs-improvement" },
      ],
      { windowDays: 7 },
    );
    const cls = r.metrics[0];
    expect(cls.good).toBe(1);
    expect(cls.needsImprovement).toBe(1);
    expect(cls.poor).toBe(1);
  });

  it("recomputes the rating bucket when the stored rating is missing/invalid", () => {
    const r = aggregateVitals(
      [
        { metric: "LCP", value: 1000, rating: null }, // -> good
        { metric: "LCP", value: 3000, rating: "garbage" }, // -> needs-improvement
        { metric: "LCP", value: 9000 }, // -> poor
      ],
      { windowDays: 7 },
    );
    const lcp = r.metrics[0];
    expect(lcp.good).toBe(1);
    expect(lcp.needsImprovement).toBe(1);
    expect(lcp.poor).toBe(1);
  });

  it("rounds CLS to 3 decimals and time metrics to whole ms", () => {
    const cls = aggregateVitals(samples("CLS", [0.123456, 0.123456]), { windowDays: 7 });
    expect(cls.metrics[0].p75).toBe(0.123);

    const lcp = aggregateVitals(samples("LCP", [2000.7, 2000.7]), { windowDays: 7 });
    expect(lcp.metrics[0].p75).toBe(2001);
  });

  it("orders metrics by VITAL_ORDER (LCP, INP, CLS, FCP, TTFB, FID)", () => {
    const all: VitalSample[] = [
      ...samples("TTFB", [100]),
      ...samples("CLS", [0.05]),
      ...samples("LCP", [2000]),
      ...samples("FCP", [1000]),
      ...samples("INP", [150]),
      ...samples("FID", [50]),
    ];
    const r = aggregateVitals(all, { windowDays: 28 });
    expect(r.metrics.map((m) => m.metric)).toEqual(["LCP", "INP", "CLS", "FCP", "TTFB", "FID"]);
    expect(r.windowDays).toBe(28);
  });

  it("omits metrics with zero samples", () => {
    const r = aggregateVitals(samples("INP", [150, 250]), { windowDays: 7 });
    expect(r.metrics).toHaveLength(1);
    expect(r.metrics[0].metric).toBe("INP");
  });
});

describe("aggregateVitals - per-path breakdown", () => {
  const rows: VitalSample[] = [
    { metric: "LCP", value: 2000, path: "/" },
    { metric: "LCP", value: 4000, path: "/" },
    { metric: "CLS", value: 0.05, path: "/" },
    { metric: "LCP", value: 9000, path: "/blog/post" },
    { metric: "LCP", value: 1000, path: null }, // → "(unknown)"
  ];

  it("groups samples by path and sorts by sample count desc", () => {
    const r = aggregateVitals(rows, { windowDays: 7 });
    // "/" has the most samples (3) so it is unambiguously first; the other two
    // tie at 1 (order among ties is incidental), so compare the set.
    expect(r.paths[0].path).toBe("/");
    expect(r.paths[0].total).toBe(3); // 2 LCP + 1 CLS on "/"
    expect(r.paths.map((p) => p.path).sort()).toEqual(["(unknown)", "/", "/blog/post"]);
  });

  it("computes per-metric p75 + rating within a path", () => {
    const r = aggregateVitals(rows, { windowDays: 7 });
    const home = r.paths.find((p) => p.path === "/")!;
    const lcp = home.metrics.find((m) => m.metric === "LCP")!;
    expect(lcp.count).toBe(2);
    // n=2, p75 rank=ceil(1.5)=2 → 4000 → needs-improvement
    expect(lcp.p75).toBe(4000);
    expect(lcp.rating).toBe("needs-improvement");
  });

  it("buckets path-less samples under (unknown)", () => {
    const r = aggregateVitals(rows, { windowDays: 7 });
    expect(r.paths.find((p) => p.path === "(unknown)")).toBeTruthy();
  });

  it("limits to topPaths by sample count", () => {
    const many: VitalSample[] = [];
    for (let i = 0; i < 10; i++) many.push({ metric: "LCP", value: 1000 + i, path: `/p${i}` });
    const r = aggregateVitals(many, { windowDays: 7, topPaths: 3 });
    expect(r.paths).toHaveLength(3);
  });
});

describe("aggregateVitals - per-day trends", () => {
  it("buckets p75 per metric per UTC day, chronologically", () => {
    const rows: VitalSample[] = [
      { metric: "LCP", value: 2000, created_at: "2026-06-01T10:00:00Z" },
      { metric: "LCP", value: 4000, created_at: "2026-06-01T20:00:00Z" },
      { metric: "LCP", value: 3000, created_at: "2026-06-02T08:00:00Z" },
    ];
    const r = aggregateVitals(rows, { windowDays: 7 });
    expect(r.trends.map((t) => t.day)).toEqual(["2026-06-01", "2026-06-02"]);
    // Day 1: n=2 p75 rank=2 → 4000
    expect(r.trends[0].p75.LCP).toBe(4000);
    expect(r.trends[1].p75.LCP).toBe(3000);
  });

  it("excludes samples without a timestamp from trends but keeps them in metrics", () => {
    const rows: VitalSample[] = [
      { metric: "LCP", value: 2000 }, // no created_at
      { metric: "LCP", value: 2500, created_at: "2026-06-01T10:00:00Z" },
    ];
    const r = aggregateVitals(rows, { windowDays: 7 });
    expect(r.metrics[0].count).toBe(2); // both counted in metrics
    expect(r.trends).toHaveLength(1); // only the timestamped one in trends
    expect(r.trends[0].day).toBe("2026-06-01");
  });

  it("ignores unparseable timestamps", () => {
    const r = aggregateVitals(
      [{ metric: "LCP", value: 2000, created_at: "not-a-date" }],
      { windowDays: 7 },
    );
    expect(r.trends).toHaveLength(0);
  });
});
