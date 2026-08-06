import { describe, expect, it } from "vitest";

import { buildWidgetTypographyCss } from "@/lib/builder/typographyCss";

const WIDGET_ID = "a777ce78-9978-4455-b322-23f82d4405e2";

describe("buildWidgetTypographyCss - ochrona przed nieczytelnym rozmiarem", () => {
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
