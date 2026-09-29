import { describe, expect, it } from "vitest";
import { effectiveSliderColumns } from "../sliderVariants";

describe("effectiveSliderColumns", () => {
  it("keeps configured columns before measurement and on desktop", () => {
    expect(effectiveSliderColumns(3, null)).toBe(3);
    expect(effectiveSliderColumns(4, 1280)).toBe(4);
  });
  it("uses 2 on tablet and 1 on phone", () => {
    expect(effectiveSliderColumns(3, 800)).toBe(2);
    expect(effectiveSliderColumns(1, 800)).toBe(1);
    expect(effectiveSliderColumns(3, 360)).toBe(1);
  });
});
