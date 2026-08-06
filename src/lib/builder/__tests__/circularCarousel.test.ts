import { describe, it, expect } from "vitest";
import {
  parseCircularCarouselItems,
  clampInterval,
  clampVisibleCount,
  clampRadius,
  slugifyCardId,
} from "../circularCarousel";
import { getItemPosition } from "@/components/ui/circular-carousel";
import { WIDGET_MAP } from "../registry";
import { WIDGET_SCHEMAS } from "../schemas";

describe("circular-carousel model", () => {
  it("parses items with PL/EN fallback and unique ids", () => {
    const items = parseCircularCarouselItems(
      {
        items: [
          { title_pl: "Karta", desc_pl: "Opis", tag_pl: "Tag", href: "https://a.test" },
          { title_pl: "Karta", title_en: "Card", desc_en: "Desc" },
          "nope",
        ],
      },
      "pl",
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "karta",
      title: "Karta",
      description: "Opis",
      tag: "Tag",
    });
    expect(items[1].id).toBe("karta-2");
  });

  it("falls back to PL when EN is missing", () => {
    const [item] = parseCircularCarouselItems({ items: [{ title_pl: "Karta" }] }, "en");
    expect(item.title).toBe("Karta");
  });

  it("clamps numeric settings", () => {
    expect(clampInterval(10)).toBe(1000);
    expect(clampInterval(Number.NaN)).toBe(4000);
    expect(clampVisibleCount(6)).toBe(5);
    expect(clampVisibleCount(99)).toBe(7);
    expect(clampRadius(5, 220)).toBe(40);
    expect(slugifyCardId("", 2)).toBe("card-3");
  });
});

describe("getItemPosition", () => {
  it("centers the active card and hides out-of-window cards", () => {
    const active = getItemPosition(0, 0, 6, 5, 220, 100);
    expect(active?.x).toBeCloseTo(0);
    expect(active?.opacity).toBe(1);
    expect(getItemPosition(3, 0, 6, 5, 220, 100)).toBeNull();
  });

  it("wraps around the list boundary", () => {
    expect(getItemPosition(5, 0, 6, 5, 220, 100)?.adjustedOffset).toBe(-1);
  });
});

describe("builder registration", () => {
  it("registers defaults and appearance schema", () => {
    const defaults = WIDGET_MAP["circular-carousel"].defaults();
    expect(Array.isArray(defaults.items)).toBe(true);
    expect(defaults.accentColor).toBe("");
    expect(WIDGET_SCHEMAS["circular-carousel"]?.map((f) => f.key)).toEqual([
      "visibleCount",
      "radiusX",
      "radiusY",
      "accentColor",
    ]);
  });
});
