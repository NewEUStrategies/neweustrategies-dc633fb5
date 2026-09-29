import { describe, expect, it } from "vitest";
import { imageDimensionPx, imageWidgetSizes } from "../widgetImageSizes";

describe("image widget responsive sizes", () => {
  const slot = { desktop: { vw: 50, cap: 680 }, tablet: { vw: 100, cap: 900 } };

  it("uses the column instead of assuming every image is half the viewport", () => {
    expect(imageWidgetSizes({}, slot)).toBe(
      "(max-width: 767px) 100vw, (max-width: 1023px) min(100vw, 900px), min(50vw, 680px)",
    );
    expect(imageWidgetSizes({})).toBe("100vw");
  });

  it("honours editor width and max-width on every breakpoint", () => {
    expect(imageWidgetSizes({ width: "480px", maxWidthPx: 240 }, slot)).toBe(
      "(max-width: 767px) min(100vw, 240px), (max-width: 1023px) min(100vw, 240px), min(50vw, 240px)",
    );
    expect(imageWidgetSizes({ widthPx: 1200 }, slot)).toContain("min(50vw, 680px)");
  });

  it("does not confuse CSS percentages with pixel caps", () => {
    for (const value of ["50%", "auto", "-1px", NaN, Infinity, null]) {
      expect(imageDimensionPx(value)).toBe(0);
    }
    expect(imageDimensionPx(" 240.5px ")).toBe(240.5);
    expect(imageWidgetSizes({ width: "100%" }, slot)).toBe(imageWidgetSizes({}, slot));
  });
});
