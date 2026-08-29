import { describe, expect, it } from "vitest";
import { buildCitations, formatChicago, type CitationSource } from "../format";

const base: CitationSource = {
  authors: [{ firstName: "Ewa", lastName: "Nowak", displayName: null }],
  title: "<script>alert(1)</script>",
  siteName: "<b>Evil</b>",
  publishedAt: "2026-07-20T08:30:00.000Z",
  url: "https://example.com/?x=<iframe>",
  lang: "pl",
};

describe("formatChicago XSS prevention", () => {
  it("escapes author segment, title, siteName and URL in HTML output", () => {
    const html = formatChicago(base);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;Evil&lt;/b&gt;");
    expect(html).toContain("https://example.com/?x=&lt;iframe&gt;");
  });

  it("keeps plain-text version unescaped (literal tags are not executed)", () => {
    const plain = buildCitations(base).chicagoPlain;
    expect(plain).toContain("<script>alert(1)</script>");
    expect(plain).not.toContain("&lt;script&gt;");
  });
});
