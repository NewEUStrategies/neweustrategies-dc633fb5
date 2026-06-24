import { describe, it, expect } from "vitest";
import { FooterChromeSchema, defaultFooterChrome, resolveCopyright } from "../footerSettings";

describe("footerSettings", () => {
  it("defaults parse cleanly", () => {
    const d = defaultFooterChrome();
    expect(d.layout).toBe("default");
    expect(d.back_to_top).toBe(true);
    expect(d.back_to_top_threshold_px).toBe(400);
  });

  it("rejects invalid layout", () => {
    const r = FooterChromeSchema.safeParse({ layout: "rainbow" });
    expect(r.success).toBe(false);
  });

  it("resolveCopyright substitutes {year}", () => {
    const c = { ...defaultFooterChrome(), copyright_pl: "© {year} Foo" };
    expect(resolveCopyright(c, "pl")).toBe(`© ${new Date().getFullYear()} Foo`);
  });

  it("resolveCopyright uses auto year when empty and show_year=true", () => {
    const c = defaultFooterChrome();
    expect(resolveCopyright(c, "en")).toBe(`© ${new Date().getFullYear()}`);
  });

  it("resolveCopyright returns empty when no template and show_year=false", () => {
    const c = { ...defaultFooterChrome(), show_year: false };
    expect(resolveCopyright(c, "pl")).toBe("");
  });
});
