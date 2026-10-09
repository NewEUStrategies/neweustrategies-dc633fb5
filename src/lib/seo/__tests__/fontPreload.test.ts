import { describe, it, expect } from "vitest";
import { fontPreloadLinkHeaderValues, fontPreloadLinks } from "@/lib/seo/fontPreload";

// Jedyny font ścieżki krytycznej (P3.2b): jeden plik latin + polskie litery,
// ten sam dla PL i EN - API nie przyjmuje już języka.
const FONT = "/assets/red-hat-display-latin-pl-abc123.woff2";

describe("fontPreloadLinks", () => {
  it("zwraca dokładnie jeden preload: jedyny font ścieżki krytycznej", () => {
    expect(fontPreloadLinks(FONT)).toEqual([
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: FONT,
        crossOrigin: "anonymous",
      },
    ]);
  });

  it("preload fontu zawsze ma crossOrigin (inaczej przeglądarka pobiera font dwa razy)", () => {
    const [link] = fontPreloadLinks(FONT);
    expect(link.crossOrigin).toBe("anonymous");
    expect(link.as).toBe("font");
  });
});

describe("fontPreloadLinkHeaderValues", () => {
  it("jeden wpis nagłówka Link z tym samym plikiem co <link>", () => {
    const values = fontPreloadLinkHeaderValues(FONT);
    expect(values).toHaveLength(1);
    expect(values[0].slice(1, values[0].indexOf(">"))).toBe(fontPreloadLinks(FONT)[0].href);
  });

  it("wpis niesie as=font, type i crossorigin (inaczej podwójny fetch)", () => {
    const [value] = fontPreloadLinkHeaderValues(FONT);
    expect(value).toContain('rel="preload"');
    expect(value).toContain('as="font"');
    expect(value).toContain('type="font/woff2"');
    expect(value).toContain("crossorigin");
    expect(value.startsWith("<")).toBe(true);
  });
});
