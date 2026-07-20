// Mapowanie lokalizacji -> typ strony reklamowej (baner nagłówka w SiteChrome).
import { describe, expect, it } from "vitest";
import { adPageTypeForLocation } from "../pageType";

describe("adPageTypeForLocation", () => {
  it("maps the homepage in both languages", () => {
    expect(adPageTypeForLocation("/", null)).toBe("home");
    expect(adPageTypeForLocation("/en", null)).toBe("home");
    expect(adPageTypeForLocation("/en/", null)).toBe("home");
  });

  it("maps blog and publications to the archive type", () => {
    expect(adPageTypeForLocation("/blog", null)).toBe("archive");
    expect(adPageTypeForLocation("/en/blog", null)).toBe("archive");
    expect(adPageTypeForLocation("/publications", null)).toBe("archive");
  });

  it("maps taxonomy archives and search", () => {
    expect(adPageTypeForLocation("/category/bezpieczenstwo", null)).toBe("category");
    expect(adPageTypeForLocation("/en/tag/energy", null)).toBe("tag");
    expect(adPageTypeForLocation("/search", null)).toBe("search");
  });

  it("uses the catch-all loader kind for posts and pages", () => {
    expect(adPageTypeForLocation("/analiza-baltyku", "post")).toBe("post");
    expect(adPageTypeForLocation("/o-nas", "page")).toBe("page");
  });

  it("falls back to all for unknown locations without content kind", () => {
    expect(adPageTypeForLocation("/podcasty", null)).toBe("all");
    expect(adPageTypeForLocation("/author/anna", null)).toBe("all");
  });

  it("does not confuse lookalike prefixes with language or section paths", () => {
    // /ente... nie jest ścieżką /en/..., a /blogosfera nie jest /blog.
    expect(adPageTypeForLocation("/ente", null)).toBe("all");
    expect(adPageTypeForLocation("/blogosfera", "page")).toBe("page");
  });
});
