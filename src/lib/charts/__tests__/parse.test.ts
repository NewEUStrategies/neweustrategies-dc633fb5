import { describe, expect, it } from "vitest";
import {
  CHART_HEIGHT_MAX,
  CHART_HEIGHT_MIN,
  parseChartConfig,
  parseDataMapConfig,
  parseMapValues,
} from "../parse";

describe("parseChartConfig", () => {
  it("parses a complete block payload", () => {
    const cfg = parseChartConfig({
      kind: "line",
      title: "Tytuł",
      categories: ["a", "b"],
      series: [{ name: "S1", values: [1, "2,5"], colorSlot: 3 }],
      stacked: true,
      unit: "%",
      height: 400,
      showValues: true,
      source: "Źródło: X",
    });
    expect(cfg.kind).toBe("line");
    expect(cfg.series[0].values).toEqual([1, 2.5]);
    expect(cfg.series[0].colorSlot).toBe(3);
    expect(cfg.height).toBe(400);
    expect(cfg.stacked).toBe(true);
  });

  it("falls back to bar for unknown kinds and clamps height", () => {
    expect(parseChartConfig({ kind: "sparkle" }).kind).toBe("bar");
    expect(parseChartConfig({ height: 20 }).height).toBe(CHART_HEIGHT_MIN);
    expect(parseChartConfig({ height: 5000 }).height).toBe(CHART_HEIGHT_MAX);
  });

  it("prefers the quick-switch `variant` over `kind`", () => {
    expect(parseChartConfig({ kind: "bar", variant: "donut" }).kind).toBe("donut");
  });

  it("pads short series and nulls invalid cells", () => {
    const cfg = parseChartConfig({
      categories: ["a", "b", "c"],
      series: [{ name: "S", values: [1, "x"] }],
    });
    expect(cfg.series[0].values).toEqual([1, null, null]);
  });

  it("caps series at the palette size (never cycles hues)", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `S${i}`, values: [1] }));
    expect(parseChartConfig({ categories: ["a"], series: many }).series).toHaveLength(8);
  });
});

describe("parseMapValues / parseDataMapConfig", () => {
  it("accepts only ISO-2 codes with finite values, deduplicated", () => {
    const values = parseMapValues([
      { id: "pl", value: 1 },
      { id: "PL", value: 2 },
      { id: "POL", value: 3 },
      { id: "DE", value: "4,5" },
      { id: "FR", value: "abc" },
    ]);
    expect(values).toEqual([
      { id: "PL", value: 1 },
      { id: "DE", value: 4.5 },
    ]);
  });

  it("defaults region to europe", () => {
    expect(parseDataMapConfig({}).region).toBe("europe");
    expect(parseDataMapConfig({ region: "world" }).region).toBe("world");
    expect(parseDataMapConfig({ region: "mars" }).region).toBe("europe");
  });
});
