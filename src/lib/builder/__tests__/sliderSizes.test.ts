import { describe, expect, it } from "vitest";
import {
  SLIDER_FULL_BLEED_SIZES,
  SLIDER_SPLIT_SIZES,
  sliderImageSizes,
  sliderMultiCardSizes,
} from "@/lib/builder/sliderSizes";

describe("sliderSizes (parytet preload <-> render)", () => {
  it("warianty jednoslajdowe malują na pełnej szerokości widgetu (100vw)", () => {
    for (const variant of ["editorial-hero", "cinematic-overlay", "minimal-strip"]) {
      expect(sliderImageSizes(variant, 3)).toBe(SLIDER_FULL_BLEED_SIZES);
    }
  });

  it("split-feature: obraz zajmuje połowę od breakpointu md", () => {
    expect(sliderImageSizes("split-feature", 3)).toBe(SLIDER_SPLIT_SIZES);
    expect(SLIDER_SPLIT_SIZES).toBe("(max-width: 767px) 100vw, 50vw");
  });

  it("multi-card: sizes = 100/kolumny vw (koniec pobierania ~3x za szerokich wariantów)", () => {
    expect(sliderMultiCardSizes(3)).toBe("33vw");
    expect(sliderMultiCardSizes(4)).toBe("25vw");
    expect(sliderMultiCardSizes(2)).toBe("50vw");
    expect(sliderImageSizes("multi-card", 3)).toBe("33vw");
  });

  it("multi-card z jedną kolumną degraduje do pełnej szerokości", () => {
    expect(sliderMultiCardSizes(1)).toBe(SLIDER_FULL_BLEED_SIZES);
  });

  it("kolumny poza zakresem są przycinane do 1-4 (ten sam kontrakt co renderer)", () => {
    expect(sliderMultiCardSizes(0)).toBe(SLIDER_FULL_BLEED_SIZES);
    expect(sliderMultiCardSizes(9)).toBe("25vw");
  });
});
