import { describe, expect, it } from "vitest";

import { buildWidgetTypographyCss, resolveWidgetTypography } from "@/lib/builder/typographyCss";
import type { Themed, WidgetTypography } from "@/lib/builder/types";

const WIDGET_ID = "a777ce78-9978-4455-b322-23f82d4405e2";

describe("buildWidgetTypographyCss - ochrona przed nieczytelnym rozmiarem", () => {
  it("spłaszcza starszą typografię light/dark do wspólnej wartości light", () => {
    const stored: Themed<WidgetTypography> = {
      light: { fontSize: { desktop: "18px" }, lineHeight: "1.4" },
      dark: { fontSize: { desktop: "30px" }, lineHeight: "2" },
    };
    expect(resolveWidgetTypography(stored, "light")).toEqual(
      resolveWidgetTypography(stored, "dark"),
    );
    expect(resolveWidgetTypography(stored, "dark")).toEqual(stored.light);
  });
  it("ignoruje rozmiar poniżej 6px i schodzi do wartości desktopowej", () => {
    const css = buildWidgetTypographyCss(
      WIDGET_ID,
      { fontSize: { desktop: "16px", tablet: "16px", mobile: "1px" } },
      "mobile",
    );
    expect(css).toContain("font-size:16px");
    expect(css).not.toContain("font-size:1px");
  });

  it("respektuje poprawny rozmiar mobilny", () => {
    const css = buildWidgetTypographyCss(
      WIDGET_ID,
      { fontSize: { desktop: "24px", mobile: "12px" } },
      "mobile",
    );
    expect(css).toContain("font-size:12px");
  });

  it("nie emituje reguły, gdy wszystkie wartości są nieczytelne", () => {
    const css = buildWidgetTypographyCss(
      WIDGET_ID,
      { fontSize: { desktop: "0px", tablet: "1px", mobile: "2px" } },
      "mobile",
    );
    expect(css).not.toContain("font-size");
  });

  it("stosuje tę samą zasadę do rozmiaru opisu", () => {
    const css = buildWidgetTypographyCss(
      WIDGET_ID,
      { descriptionFontSize: { desktop: "14px", mobile: "1px" } },
      "mobile",
    );
    expect(css).toContain("font-size:14px");
  });
});
