import { describe, expect, it } from "vitest";
import { linearScale, niceScale, niceStep, seriesExtent, stackSeries } from "../scale";
import type { ChartSeries } from "../types";

const s = (values: (number | null)[], slot = 1): ChartSeries => ({
  name: `s${slot}`,
  values,
  colorSlot: slot,
});

describe("niceStep", () => {
  it("snaps to the 1-2-5 progression", () => {
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.7)).toBe(2);
    expect(niceStep(3.2)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.03)).toBe(0.05);
    expect(niceStep(230)).toBe(500);
  });

  it("survives zero and non-finite input", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });
});

describe("niceScale", () => {
  it("expands the domain to nice bounds and returns even ticks", () => {
    const sc = niceScale(3, 97, 5);
    expect(sc.min).toBeLessThanOrEqual(3);
    expect(sc.max).toBeGreaterThanOrEqual(97);
    expect(sc.ticks[0]).toBe(sc.min);
    expect(sc.ticks[sc.ticks.length - 1]).toBe(sc.max);
    const step = sc.ticks[1] - sc.ticks[0];
    for (let i = 1; i < sc.ticks.length; i++) {
      expect(sc.ticks[i] - sc.ticks[i - 1]).toBeCloseTo(step, 8);
    }
  });

  it("handles a flat series without collapsing", () => {
    const sc = niceScale(50, 50);
    expect(sc.max).toBeGreaterThan(sc.min);
  });

  it("handles negative domains", () => {
    const sc = niceScale(-80, -20);
    expect(sc.min).toBeLessThanOrEqual(-80);
    expect(sc.max).toBeGreaterThanOrEqual(-20);
  });
});

describe("linearScale", () => {
  it("maps domain to range linearly (and inverted ranges)", () => {
    const y = linearScale(0, 100, 200, 0);
    expect(y(0)).toBe(200);
    expect(y(100)).toBe(0);
    expect(y(50)).toBe(100);
  });
});

describe("seriesExtent", () => {
  it("computes min/max across series, skipping nulls", () => {
    const e = seriesExtent([s([1, null, 9]), s([-3, 4, null], 2)], 3, {
      stacked: false,
      includeZero: false,
    });
    expect(e).toEqual({ min: -3, max: 9 });
  });

  it("includes zero when requested (bars must grow from zero)", () => {
    const e = seriesExtent([s([5, 9])], 2, { stacked: false, includeZero: true });
    expect(e.min).toBe(0);
  });

  it("uses per-category sums when stacked", () => {
    const e = seriesExtent([s([5, 5]), s([7, 1], 2)], 2, { stacked: true, includeZero: true });
    expect(e.max).toBe(12);
  });
});

describe("stackSeries", () => {
  it("accumulates positive values upward per category", () => {
    const stacks = stackSeries([s([2, 3]), s([5, 1], 2)], 2);
    expect(stacks[0][0]).toEqual({ from: 0, to: 2, value: 2 });
    expect(stacks[1][0]).toEqual({ from: 2, to: 7, value: 5 });
    expect(stacks[1][1]).toEqual({ from: 3, to: 4, value: 1 });
  });

  it("stacks negatives downward independently", () => {
    const stacks = stackSeries([s([-2]), s([-3], 2), s([4], 3)], 1);
    expect(stacks[0][0]).toEqual({ from: 0, to: -2, value: -2 });
    expect(stacks[1][0]).toEqual({ from: -2, to: -5, value: -3 });
    expect(stacks[2][0]).toEqual({ from: 0, to: 4, value: 4 });
  });

  it("treats nulls as gaps that do not move the cursor", () => {
    const stacks = stackSeries([s([null, 2]), s([3, 3], 2)], 2);
    expect(stacks[0][0].value).toBeNull();
    expect(stacks[1][0]).toEqual({ from: 0, to: 3, value: 3 });
  });
});
