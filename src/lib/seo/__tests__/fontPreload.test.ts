import { describe, it, expect } from "vitest";
import { fontPreloadLinks } from "@/lib/seo/fontPreload";

const URLS = { latin: "/assets/latin.abc.woff2", latinExt: "/assets/latin-ext.def.woff2" };

describe("fontPreloadLinks", () => {
  it("preloads only the Latin subset for English", () => {
    const links = fontPreloadLinks("en", URLS);
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      rel: "preload",
      as: "font",
      type: "font/woff2",
      href: URLS.latin,
      crossOrigin: "anonymous",
    });
  });

  it("preloads Latin + Latin-ext for Polish (diacritics live in Latin-ext)", () => {
    const links = fontPreloadLinks("pl", URLS);
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.href)).toEqual([URLS.latin, URLS.latinExt]);
  });

  it("always marks font preloads crossOrigin (else they are double-fetched)", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const link of fontPreloadLinks(lang, URLS)) {
        expect(link.crossOrigin).toBe("anonymous");
        expect(link.as).toBe("font");
      }
    }
  });
});
