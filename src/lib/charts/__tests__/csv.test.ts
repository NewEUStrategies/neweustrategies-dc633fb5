import { describe, expect, it } from "vitest";
import { parseChartData, parseMapData } from "../csv";

describe("parseChartData", () => {
  it("parses the documented widget format", () => {
    const { categories, series } = parseChartData(
      "; Eksport; Import\n2021; 120; 80\n2022; 150,5; 95",
    );
    expect(categories).toEqual(["2021", "2022"]);
    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({ name: "Eksport", values: [120, 150.5], colorSlot: 1 });
    expect(series[1]).toMatchObject({ name: "Import", values: [80, 95], colorSlot: 2 });
  });

  it("treats blank/invalid cells as gaps and skips empty lines", () => {
    const { series } = parseChartData("; A\n\nx; \ny; abc\nz; 3");
    expect(series[0].values).toEqual([null, null, 3]);
  });

  it("returns empty structures for empty input", () => {
    expect(parseChartData("")).toEqual({ categories: [], series: [] });
  });

  it("is stable when re-parsing its own documented format", () => {
    const text = "; A; B\nQ1; 1; 2\nQ2; ; 4";
    expect(parseChartData(text)).toEqual(parseChartData(text));
  });
});

describe("parseMapData", () => {
  it("parses country rows with decimal commas", () => {
    expect(parseMapData("PL; 12,5\nde; 33\nXX")).toEqual([
      { id: "PL", value: 12.5 },
      { id: "DE", value: 33 },
    ]);
  });

  it("deduplicates repeated country codes keeping the first value", () => {
    expect(parseMapData("PL; 1\nPL; 2")).toEqual([{ id: "PL", value: 1 }]);
  });
});
