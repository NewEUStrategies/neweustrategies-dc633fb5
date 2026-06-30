import { describe, it, expect } from "vitest";
import { trendsFromDailyP75, type DailyP75Row } from "@/lib/observability/aggregate";

describe("trendsFromDailyP75", () => {
  it("builds chronological per-day points, grouping metrics by day", () => {
    const rows: DailyP75Row[] = [
      { day: "2026-06-02", metric: "LCP", p75: 2100 },
      { day: "2026-06-01", metric: "LCP", p75: 1800 },
      { day: "2026-06-01", metric: "CLS", p75: 0.05 },
    ];
    const trends = trendsFromDailyP75(rows);
    // Sorted oldest -> newest.
    expect(trends.map((t) => t.day)).toEqual(["2026-06-01", "2026-06-02"]);
    // Same day groups multiple metrics into one point.
    expect(trends[0].p75).toEqual({ LCP: 1800, CLS: 0.05 });
    expect(trends[1].p75).toEqual({ LCP: 2100 });
  });

  it("rounds per metric: CLS to 3 decimals, time metrics to whole ms", () => {
    const rows: DailyP75Row[] = [
      { day: "2026-06-01", metric: "CLS", p75: 0.123456 },
      { day: "2026-06-01", metric: "LCP", p75: 2100.7 },
    ];
    const [point] = trendsFromDailyP75(rows);
    expect(point.p75.CLS).toBe(0.123);
    expect(point.p75.LCP).toBe(2101);
  });

  it("ignores unknown metric names", () => {
    const rows: DailyP75Row[] = [
      { day: "2026-06-01", metric: "NOT_A_VITAL", p75: 999 },
      { day: "2026-06-01", metric: "INP", p75: 180 },
    ];
    const [point] = trendsFromDailyP75(rows);
    expect(point.p75).toEqual({ INP: 180 });
  });

  it("ignores non-finite p75 values", () => {
    const rows: DailyP75Row[] = [
      { day: "2026-06-01", metric: "LCP", p75: Number.NaN },
      { day: "2026-06-01", metric: "FCP", p75: 1200 },
    ];
    const [point] = trendsFromDailyP75(rows);
    expect(point.p75).toEqual({ FCP: 1200 });
  });

  it("skips rows with a missing / non-string day", () => {
    const rows = [
      { day: 20260601 as unknown as string, metric: "LCP", p75: 1800 },
      { day: "2026-06-01", metric: "TTFB", p75: 400 },
    ] as DailyP75Row[];
    const trends = trendsFromDailyP75(rows);
    expect(trends).toHaveLength(1);
    expect(trends[0]).toEqual({ day: "2026-06-01", p75: { TTFB: 400 } });
  });

  it("normalizes a full timestamp day to its YYYY-MM-DD", () => {
    const rows: DailyP75Row[] = [{ day: "2026-06-01T12:34:56.000Z", metric: "LCP", p75: 1500 }];
    expect(trendsFromDailyP75(rows)[0].day).toBe("2026-06-01");
  });

  it("returns an empty array for no rows", () => {
    expect(trendsFromDailyP75([])).toEqual([]);
  });
});
