import { describe, it, expect } from "vitest";
import {
  clampDuration,
  nextIndex,
  parseProgressCarouselItems,
  slugifySlideValue,
} from "../progressCarousel";

describe("progressCarousel", () => {
  it("slugifies titles and falls back to index", () => {
    expect(slugifySlideValue("Mountains View", 0)).toBe("mountains-view");
    expect(slugifySlideValue("Żółć ą", 1)).toBe("zolc-a");
    expect(slugifySlideValue("", 2)).toBe("slide-3");
  });

  it("parses items with PL/EN fallback", () => {
    const items = parseProgressCarouselItems(
      {
        items: [
          { img: "https://x/a.jpg", title_pl: "Most", title_en: "Bridge", desc_pl: "Opis" },
          { title_pl: "Góry" },
          "nope",
        ],
      },
      "en",
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ value: "bridge", title: "Bridge", desc: "Opis" });
    // brak EN -> fallback do PL
    expect(items[1].title).toBe("Góry");
  });

  it("keeps slide values unique", () => {
    const items = parseProgressCarouselItems(
      { items: [{ title_pl: "A" }, { title_pl: "A" }, { value: "a" }] },
      "pl",
    );
    expect(items.map((i) => i.value)).toEqual(["a", "a-2", "a-3"]);
  });

  it("returns empty list for missing content", () => {
    expect(parseProgressCarouselItems({}, "pl")).toEqual([]);
  });

  it("clamps duration", () => {
    expect(clampDuration(500)).toBe(1000);
    expect(clampDuration(99999)).toBe(30000);
    expect(clampDuration(Number.NaN)).toBe(5000);
  });

  it("cycles indexes", () => {
    expect(nextIndex(2, 3)).toBe(0);
    expect(nextIndex(0, 0)).toBe(0);
  });
});
