// Whitelist kolorów: musi przepuścić WSZYSTKO, co potrafi zapisać
// AdminColorPicker (hex z alfą, rgb/rgba, hsl/hsla, oklch, transparent,
// currentColor, token var()), i nie przepuścić niczego, co mogłoby wyjść poza
// deklarację CSS albo wprowadzić `url()` / `expression()`.
import { describe, expect, it } from "vitest";
import { safeWidgetColor } from "../cssColor";

describe("safeWidgetColor - zapisy akceptowane", () => {
  it.each([
    "#abc",
    "#abcd",
    "#a1b2c3",
    "#a1b2c3ff",
    "rgb(10, 20, 30)",
    "rgb(10 20 30 / 50%)",
    "rgba(10, 20, 30, 0.5)",
    "hsl(210, 50%, 40%)",
    "hsla(210, 50%, 40%, 0.25)",
    "hwb(210 20% 30%)",
    "oklch(0.62 0.19 258)",
    "oklab(0.62 0.1 -0.05)",
    "lab(52% 40 59)",
    "lch(52% 72 40)",
    "color(display-p3 1 0.5 0)",
    "transparent",
    "currentColor",
    "var(--brand)",
  ])("accepts %s", (value) => {
    expect(safeWidgetColor(value)).toBe(value);
  });

  it("trims surrounding whitespace", () => {
    expect(safeWidgetColor("  #123456  ")).toBe("#123456");
  });
});

describe("safeWidgetColor - zapisy odrzucane", () => {
  it.each([
    "czerwony",
    "red; background:url(javascript:alert(1))",
    "url(javascript:alert(1))",
    "expression(alert(1))",
    "rgb(0,0,0);}body{display:none",
    "var(--brand); background: url(x)",
    'rgb(0,0,0)"',
    "rgb(var(--x))",
    "#12",
    "#1234567",
    "",
    "   ",
  ])("rejects %s", (value) => {
    expect(safeWidgetColor(value)).toBe("");
  });

  it("rejects non-strings instead of guessing", () => {
    expect(safeWidgetColor(undefined)).toBe("");
    expect(safeWidgetColor(null)).toBe("");
    expect(safeWidgetColor(16711680)).toBe("");
    expect(safeWidgetColor({ hex: "#fff" })).toBe("");
  });
});
