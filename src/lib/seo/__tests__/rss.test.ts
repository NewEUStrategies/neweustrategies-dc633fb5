import { describe, expect, it } from "vitest";
import { buildRssXml, plainText, rfc822Date } from "@/lib/seo/rss";

describe("rfc822Date", () => {
  it("formats ISO dates as RFC 822 and rejects garbage", () => {
    expect(rfc822Date("2026-07-01T10:00:00Z")).toBe("Wed, 01 Jul 2026 10:00:00 GMT");
    expect(rfc822Date("not-a-date")).toBeNull();
    expect(rfc822Date(null)).toBeNull();
  });
});

describe("plainText", () => {
  it("strips tags, collapses whitespace and caps length", () => {
    expect(plainText("<p>Ala  ma<br> kota</p>")).toBe("Ala ma kota");
    expect(plainText("x".repeat(600), 10)).toHaveLength(10);
    expect(plainText(null)).toBe("");
  });
});

describe("buildRssXml", () => {
  const xml = buildRssXml({
    title: "NES",
    description: 'Analizy & "raporty"',
    siteUrl: "https://nes.example",
    feedUrl: "https://nes.example/rss.xml",
    language: "pl",
    copyright: "© 2026 NES",
    items: [
      {
        url: "https://nes.example/blog/wpis-a",
        title: "Wpis <A> & spółka",
        description: "<p>Zajawka</p>",
        publishedAt: "2026-07-01T10:00:00Z",
        categories: ["Geopolityka"],
        imageUrl: "https://nes.example/a.jpg",
        authorName: "Jan Kowalski",
      },
      {
        url: "https://nes.example/blog/wpis-b",
        title: "Wpis B",
        description: null,
        publishedAt: null,
      },
    ],
  });

  it("emits a valid RSS 2.0 skeleton with self link and language", () => {
    expect(xml).toContain(`<rss version="2.0"`);
    expect(xml).toContain(`<language>pl</language>`);
    expect(xml).toContain(
      `<atom:link href="https://nes.example/rss.xml" rel="self" type="application/rss+xml"/>`,
    );
    expect(xml).toContain(`<lastBuildDate>Wed, 01 Jul 2026 10:00:00 GMT</lastBuildDate>`);
    expect(xml).toContain(`<copyright>© 2026 NES</copyright>`);
  });
  it("escapes XML entities everywhere", () => {
    expect(xml).toContain("Wpis &lt;A&gt; &amp; spółka");
    expect(xml).toContain("Analizy &amp; &quot;raporty&quot;");
    expect(xml).not.toContain("<A>");
  });
  it("emits permalink guids, media and dc:creator", () => {
    expect(xml).toContain(`<guid isPermaLink="true">https://nes.example/blog/wpis-a</guid>`);
    expect(xml).toContain(`<media:content url="https://nes.example/a.jpg" medium="image"/>`);
    expect(xml).toContain(`<dc:creator>Jan Kowalski</dc:creator>`);
    expect(xml).toContain(`<category>Geopolityka</category>`);
  });
  it("omits optional fields cleanly", () => {
    const item = xml.slice(xml.indexOf("wpis-b"));
    expect(item).not.toContain("<pubDate>");
    expect(item).not.toContain("<description>");
  });
});
