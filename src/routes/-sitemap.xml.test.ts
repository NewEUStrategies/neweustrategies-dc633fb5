import { describe, it, expect } from "vitest";
import { xmlEscape, alternateLinks } from "./sitemap[.]xml";
import { SUPPORTED_LANGS } from "@/lib/seo/meta";

describe("sitemap xmlEscape", () => {
  it("escapes the XML-significant characters", () => {
    expect(xmlEscape(`a & b < c > d "e"`)).toBe("a &amp; b &lt; c &gt; d &quot;e&quot;");
  });

  it("leaves a plain URL untouched", () => {
    expect(xmlEscape("https://example.com/blog/post")).toBe("https://example.com/blog/post");
  });
});

describe("sitemap alternateLinks", () => {
  it("emits x-default plus one alternate per supported language", () => {
    const links = alternateLinks("https://example.com/post");
    expect(links).toHaveLength(SUPPORTED_LANGS.length + 1);
    expect(links[0]).toContain('hreflang="x-default"');
    for (const lang of SUPPORTED_LANGS) {
      expect(links.some((l) => l.includes(`hreflang="${lang}"`) && l.includes(`?lang=${lang}`))).toBe(true);
    }
  });

  it("XML-escapes the loc in every alternate", () => {
    const links = alternateLinks("https://example.com/a?x=1&y=2");
    expect(links.every((l) => l.includes("&amp;"))).toBe(true);
    expect(links.some((l) => l.includes("&y=2"))).toBe(false);
  });
});
