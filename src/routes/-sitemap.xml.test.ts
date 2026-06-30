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
  it("emits x-default plus one path-prefixed alternate per supported language", () => {
    const links = alternateLinks("https://example.com/post");
    expect(links).toHaveLength(SUPPORTED_LANGS.length + 1);
    // x-default + PL (default) resolve to the bare, unprefixed URL.
    expect(links[0]).toContain('hreflang="x-default"');
    expect(links[0]).toContain('href="https://example.com/post"');
    expect(
      links.some(
        (l) => l.includes('hreflang="pl"') && l.includes('href="https://example.com/post"'),
      ),
    ).toBe(true);
    // EN is addressed under the "/en" path prefix.
    expect(
      links.some(
        (l) => l.includes('hreflang="en"') && l.includes('href="https://example.com/en/post"'),
      ),
    ).toBe(true);
  });

  it("XML-escapes the loc in every alternate", () => {
    const links = alternateLinks("https://example.com/a&b");
    expect(links.every((l) => l.includes("&amp;"))).toBe(true);
    expect(links.some((l) => l.includes('/a&b"'))).toBe(false);
  });
});
