// Unit tests for the widget enter-animation presets. Each MOTION_INITIAL entry
// is a pure factory returning the "before" CSS for one preset; exercising them
// all guards the animation contract WidgetView applies on first paint.
import { describe, it, expect } from "vitest";
import { MOTION_INITIAL, MOTION_FINAL, EASING_MAP } from "../motion";

describe("MOTION_INITIAL", () => {
  it("every preset returns an animatable, hidden initial style", () => {
    const distance = 24;
    const presets = Object.keys(MOTION_INITIAL);
    expect(presets.length).toBeGreaterThan(15);
    for (const name of presets) {
      const style = MOTION_INITIAL[name](distance);
      expect(style).toBeTypeOf("object");
      // Each preset starts fully transparent and reveals to MOTION_FINAL.
      expect(style.opacity).toBe(0);
    }
  });

  it("distance-driven presets embed the supplied offset", () => {
    expect(MOTION_INITIAL["slide-up"](40).transform).toContain("40px");
    expect(MOTION_INITIAL["slide-down"](40).transform).toContain("-40px");
    expect(MOTION_INITIAL["slide-left"](12).transform).toContain("translateX(12px)");
    expect(MOTION_INITIAL["reveal-up"](40).transform).toContain("20px");
    expect(MOTION_INITIAL.blur(0).filter).toContain("blur");
  });
});

describe("MOTION_FINAL", () => {
  it("resets opacity, transform, filter and clip-path", () => {
    expect(MOTION_FINAL.opacity).toBe(1);
    expect(MOTION_FINAL.transform).toContain("scale(1)");
    expect(MOTION_FINAL.filter).toContain("blur(0)");
    expect(MOTION_FINAL.clipPath).toContain("inset(0 0 0 0)");
  });
});

describe("EASING_MAP", () => {
  it("maps named easings, including custom spring/bounce curves", () => {
    expect(EASING_MAP.ease).toBe("ease");
    expect(EASING_MAP.spring).toContain("cubic-bezier");
    expect(EASING_MAP.bounce).toContain("cubic-bezier");
  });
});
