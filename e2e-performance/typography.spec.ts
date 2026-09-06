import { expect, test } from "@playwright/test";
import { buildWidgetTypographyCss } from "../src/lib/builder/typographyCss";

// Browser-computed cascade, including !important and :is() specificity.
// These contracts protect authored widget design while compressing its CSS.
for (const device of ["desktop", "tablet", "mobile"] as const) {
  test(`widget typography preserves the cascade on ${device}`, async ({ page }) => {
    const sizes = { desktop: "34px", tablet: "28px", mobile: "24px" };
    const css = buildWidgetTypographyCss(
      "test",
      {
        fontFamily: "serif",
        fontWeight: "700",
        lineHeight: "1.5",
        letterSpacing: "2px",
        textAlign: "center",
        fontSize: sizes,
        descriptionFontSize: { desktop: "16px", tablet: "14px", mobile: "12px" },
        titleDescriptionGapPx: 10,
      },
      device,
    );
    await page.setContent(`<style>
      [data-w-id] h2 { font-size:11px !important; }
      [data-w-id] p { font-size:10px !important; }
      .post-list-numbered-index, .rl-num, [data-typography-exempt] { font-size:9px; font-weight:400; }
      ${css}
    </style><div data-w-id="test">
      <h2 id="heading">Heading</h2><h3 class="cms-post-title">Title</h3>
      <p class="cms-post-excerpt">Excerpt</p><p id="description">Description</p>
      <span id="text">Text</span><span class="post-list-numbered-index">01</span>
      <span class="rl-num">02</span><span data-typography-exempt>Microcopy</span>
    </div><h2 id="outside">Outside widget</h2>`);
    await expect(page.locator("#heading")).toHaveCSS("font-size", sizes[device]);
    await expect(page.locator(".cms-post-title")).toHaveCSS("font-size", sizes[device]);
    await expect(page.locator("#description")).toHaveCSS(
      "font-size",
      { desktop: "16px", tablet: "14px", mobile: "12px" }[device],
    );
    await expect(page.locator(".cms-post-excerpt")).toHaveCSS("margin-top", "10px");
    await expect(page.locator("#text")).toHaveCSS("font-weight", "700");
    await expect(page.locator("#heading")).toHaveCSS("text-align", "center");
    for (const selector of [".post-list-numbered-index", ".rl-num", "[data-typography-exempt]"]) {
      await expect(page.locator(selector)).toHaveCSS("font-size", "9px");
      await expect(page.locator(selector)).toHaveCSS("font-weight", "400");
    }
    await expect(page.locator("#outside")).not.toHaveCSS("letter-spacing", "2px");
  });
}
