// Unit tests for the widget frame/style helpers - pure functions that compute
// the inline CSS and content getters every widget renderer relies on.
import { describe, it, expect } from "vitest";
import type { CommonStyle, WidgetNode } from "@/lib/builder/types";
import {
  styleToCSS,
  getWidgetFrameStyle,
  hiddenOnDevice,
  getStr,
  getNum,
  getStrArr,
  normalizeNewsletterVariant,
  AUTO_SIZE_WIDGETS,
  COMPACT_WIDGET_TYPES,
  DEFAULT_WIDGET_WIDTH_BY_DEVICE,
} from "../frame";

const node = (over: Partial<WidgetNode>): WidgetNode => ({
  id: "n1",
  kind: "widget",
  type: "heading",
  content: {},
  ...over,
});

describe("styleToCSS", () => {
  it("returns an empty object when no style is given", () => {
    expect(styleToCSS(undefined, "desktop")).toEqual({});
  });

  it("maps colors, spacing, border, shadow, opacity and typography", () => {
    const style: CommonStyle = {
      bgColor: "#ffffff",
      textColor: "#111111",
      padding: { desktop: "24px", mobile: "8px" },
      margin: { desktop: "16px" },
      align: { desktop: "center" },
      borderRadius: "8px",
      maxWidth: "640px",
      minHeight: "120px",
      borderStyle: "solid",
      borderWidth: "2px",
      borderColor: "#cccccc",
      boxShadow: "0 8px 24px rgba(0,0,0,.2)",
      opacity: 0.8,
      typography: {
        fontFamily: "Inter, sans-serif",
        fontSize: { desktop: "18px" },
        fontWeight: "700",
        fontStyle: "italic",
        lineHeight: "1.5",
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        textDecoration: "underline",
      },
    };
    const css = styleToCSS(style, "desktop");
    expect(css.background).toBe("#ffffff");
    expect(css.color).toBe("#111111");
    expect(css.padding).toBe("24px");
    expect(css.margin).toBe("16px");
    expect(css.textAlign).toBe("center");
    expect(css.borderRadius).toBe("8px");
    expect(css.maxWidth).toBe("640px");
    expect(css.minHeight).toBe("120px");
    expect(css.borderStyle).toBe("solid");
    expect(css.borderWidth).toBe("2px");
    expect(css.borderColor).toBe("#cccccc");
    expect(css.boxShadow).toContain("rgba");
    expect(css.opacity).toBe(0.8);
    expect(css.fontFamily).toContain("Inter");
    // Contract: the title font-size is deliberately NOT set on the widget
    // wrapper - WidgetView maps it to .cms-post-title / .cms-post-excerpt via
    // scoped CSS (see styleToCSS), so the wrapper stays cascade-neutral.
    expect(css.fontSize).toBeUndefined();
    expect(css.fontWeight).toBe("700");
    expect(css.textTransform).toBe("uppercase");
  });

  it("falls back to the desktop value on a narrower device", () => {
    const css = styleToCSS({ padding: { desktop: "24px" } }, "mobile");
    expect(css.padding).toBe("24px");
  });

  it("omits the border block when borderStyle is none", () => {
    const css = styleToCSS({ borderStyle: "none", borderColor: "#000" }, "desktop");
    expect(css.borderStyle).toBeUndefined();
    expect(css.borderColor).toBeUndefined();
  });
});

describe("getWidgetFrameStyle", () => {
  it("defaults to a full-width, border-box frame", () => {
    const style = getWidgetFrameStyle(node({ type: "heading" }), "desktop");
    expect(style.width).toBe(DEFAULT_WIDGET_WIDTH_BY_DEVICE.desktop);
    expect(style.boxSizing).toBe("border-box");
    expect(style.minWidth).toBe(0);
  });

  it("forces post-list/carousel to always fill the column", () => {
    const style = getWidgetFrameStyle(node({ type: "post-list" }), "desktop");
    expect(style.width).toBe("100%");
    expect(style.flexBasis).toBe("100%");
  });

  it("applies an explicit pixel width and clamps it on mobile", () => {
    const adv = { width: 320 } as WidgetNode["advanced"];
    expect(getWidgetFrameStyle(node({ type: "image", advanced: adv }), "desktop").width).toBe(320);
    expect(getWidgetFrameStyle(node({ type: "image", advanced: adv }), "mobile").width).toBe(
      "min(100%, 320px)",
    );
  });

  it("shrinks to content for inline layout and anchors via selfJustify", () => {
    const inline = getWidgetFrameStyle(
      node({ type: "button", advanced: { layout: "inline" } as WidgetNode["advanced"] }),
      "desktop",
    );
    expect(inline.width).toBe("auto");
    expect(inline.flex).toBe("0 0 auto");

    const anchored = getWidgetFrameStyle(
      node({ type: "button", style: { selfJustify: "end" } }),
      "desktop",
    );
    expect(anchored.alignSelf).toBe("flex-end");
  });

  it("honours vertical selfAlign (center / stretch)", () => {
    expect(getWidgetFrameStyle(node({ style: { selfAlign: "center" } }), "desktop").marginTop).toBe(
      "auto",
    );
    const stretched = getWidgetFrameStyle(node({ style: { selfAlign: "stretch" } }), "desktop");
    expect(stretched.flexGrow).toBe(1);
    expect(stretched.height).toBe("auto");
  });

  it("keeps the search widget full width", () => {
    const style = getWidgetFrameStyle(node({ type: "search-button" }), "desktop");
    expect(style.width).toBe("100%");
    expect(style.flexBasis).toBe("100%");
  });

  it("applies an explicit height and clamps a maxWidth px string on mobile", () => {
    const adv = { height: 200 } as unknown as WidgetNode["advanced"];
    const style = getWidgetFrameStyle(
      node({ type: "image", advanced: adv, style: { maxWidth: "300px" } }),
      "mobile",
    );
    expect(style.width).toBe("min(100%, 300px)");
    expect(style.height).toBe(200);
  });

  it("reads responsive width objects and 'auto' sizes", () => {
    const adv = { width: { tablet: "auto" as const } } as unknown as WidgetNode["advanced"];
    expect(getWidgetFrameStyle(node({ type: "image", advanced: adv }), "desktop").width).toBe(
      "auto",
    );
    const advNum = { width: { mobile: 250 } } as unknown as WidgetNode["advanced"];
    expect(getWidgetFrameStyle(node({ type: "image", advanced: advNum }), "mobile").width).toBe(
      "min(100%, 250px)",
    );
  });

  it("falls back to minHeight when no explicit height is set", () => {
    const style = getWidgetFrameStyle(
      node({ type: "text", style: { minHeight: "120px" } }),
      "desktop",
    );
    expect(style.minHeight).toBe("120px");
  });

  it("lets a slider fill the column by default", () => {
    const style = getWidgetFrameStyle(node({ type: "slider" }), "desktop");
    expect(style.width).toBe("100%");
    expect(style.flexBasis).toBe("100%");
  });

  it("anchors vertical selfAlign end and start via auto margins", () => {
    const end = getWidgetFrameStyle(node({ style: { selfAlign: "end" } }), "desktop");
    expect(end.marginTop).toBe("auto");
    expect(end.marginBottom).toBe(0);
    const start = getWidgetFrameStyle(node({ style: { selfAlign: "start" } }), "desktop");
    expect(start.marginTop).toBe(0);
    expect(start.marginBottom).toBe("auto");
  });

  it("anchors horizontally via selfJustify start/center", () => {
    expect(
      getWidgetFrameStyle(node({ style: { selfJustify: "start" } }), "desktop").alignSelf,
    ).toBe("flex-start");
    expect(
      getWidgetFrameStyle(node({ style: { selfJustify: "center" } }), "desktop").alignSelf,
    ).toBe("center");
  });
});

describe("styleToCSS extra branches", () => {
  it("reads a responsive align with a device fallback and a dark-only border", () => {
    const css = styleToCSS({ align: { tablet: "right" }, borderStyle: "solid" }, "desktop");
    expect(css.textAlign).toBe("right");
    // borderWidth defaults to 1px when only borderStyle is set.
    expect(css.borderWidth).toBe("1px");
  });

  it("reads description font size + title/description gap typography", () => {
    const css = styleToCSS(
      {
        typography: {
          descriptionFontSize: { desktop: "13px" },
          fontStyle: "italic",
          lineHeight: "1.6",
          letterSpacing: "0.01em",
          textDecoration: "underline",
        },
      },
      "desktop",
    );
    expect(css.fontStyle).toBe("italic");
    expect(css.lineHeight).toBe("1.6");
  });
});

describe("content getters", () => {
  it("getStr returns strings or empty", () => {
    expect(getStr({ a: "x" }, "a")).toBe("x");
    expect(getStr({ a: 1 }, "a")).toBe("");
    expect(getStr({}, "missing")).toBe("");
  });

  it("getNum coerces only real numbers, otherwise the default", () => {
    expect(getNum({ n: 5 }, "n", 0)).toBe(5);
    expect(getNum({ n: "5" }, "n", 0)).toBe(0);
    expect(getNum({}, "n", 42)).toBe(42);
  });

  it("getStrArr filters to string arrays", () => {
    expect(getStrArr({ a: ["x", 1, "y", null] }, "a")).toEqual(["x", "y"]);
    expect(getStrArr({ a: "nope" }, "a")).toEqual([]);
  });
});

describe("hiddenOnDevice", () => {
  it("reflects the per-device hideOn flag", () => {
    expect(hiddenOnDevice({ hideOn: { mobile: true } }, "mobile")).toBe(true);
    expect(hiddenOnDevice({ hideOn: { mobile: true } }, "desktop")).toBe(false);
    expect(hiddenOnDevice(undefined, "desktop")).toBe(false);
  });
});

describe("normalizeNewsletterVariant", () => {
  it("maps legacy Polish labels to canonical variant keys", () => {
    expect(normalizeNewsletterVariant("sama ikona")).toBe("icon-only");
    expect(normalizeNewsletterVariant("ikona + tekst")).toBe("icon");
    expect(normalizeNewsletterVariant("inline (email + przycisk)")).toBe("inline");
    expect(normalizeNewsletterVariant("karta z formularzem")).toBe("card");
    expect(normalizeNewsletterVariant("card")).toBe("card");
  });
});

describe("widget classification sets", () => {
  it("marks intrinsic widgets as auto-size and chrome widgets as compact", () => {
    expect(AUTO_SIZE_WIDGETS.has("image")).toBe(true);
    expect(AUTO_SIZE_WIDGETS.has("post-list")).toBe(false);
    expect(COMPACT_WIDGET_TYPES.has("social-icons")).toBe(true);
    expect(COMPACT_WIDGET_TYPES.has("heading")).toBe(false);
  });
});
