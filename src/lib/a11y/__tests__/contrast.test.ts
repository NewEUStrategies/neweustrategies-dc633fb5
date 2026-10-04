import { expect, it } from "vitest";
import { contrastRatio, readableForeground, readableBrandText } from "../contrast";
import { bannerStyleVars, COOKIE_BANNER_COLOR_DEFAULTS } from "../../cookieBanner/config";

it("keeps accessible colors and corrects white labels on the orange brand fill", () => {
  expect(readableForeground("#fa9346", "#fff")).toBe("#000000");
  expect(readableForeground("#141414", "#fff")).toBe("#fff");
  expect(contrastRatio("#000", "#fa9346")).toBeGreaterThan(4.5);
  expect(readableForeground("var(--background)", "var(--foreground)")).toBe("var(--foreground)");
});

it("uses readable ink for brand text without replacing other editorial colors", () => {
  expect(readableBrandText("#FA9346")).toBe("var(--brand-ink)");
  expect(contrastRatio("#a94e0b", "#f8f6f4")).toBeGreaterThan(4.5);
  expect(readableBrandText("#FA9346")).toBe("var(--brand-ink)");
  expect(readableBrandText("var(--brand)")).toBe("var(--brand-ink)");
  expect(readableBrandText("#123456")).toBe("#123456");
});

it("corrects configured cookie buttons and text without requiring CMS changes", () => {
  const style = bannerStyleVars({
    ...COOKIE_BANNER_COLOR_DEFAULTS,
    accent: "#fa9346",
    accentForeground: "#ffffff",
    surface: "#fff",
    foreground: "#aaa",
  });
  expect(style).toMatchObject({
    "--cb-accent": "#fa9346",
    "--cb-accent-fg": "#000000",
    "--cb-fg": "#000000",
  });
});

it("uses the accessible brand pair when cookie colors are inherited", () => {
  expect(bannerStyleVars(COOKIE_BANNER_COLOR_DEFAULTS)).toMatchObject({
    "--cb-accent": "var(--brand)",
    "--cb-accent-fg": "var(--brand-foreground)",
  });
});
