import { describe, expect, it } from "vitest";
import { shardSlice } from "@/lib/seo/sitemapIndex";
import {
  buildUrlsetXml,
  expandSitemapUrls,
  newestLastmod,
  type SitemapEntry,
} from "@/lib/seo/sitemapXml";

const ORIGIN = "https://nes.example";

function entries(...locs: string[]): SitemapEntry[] {
  return locs.map((loc) => ({ loc: `${ORIGIN}${loc}`, changefreq: "weekly", priority: "0.6" }));
}

describe("expandSitemapUrls", () => {
  it("emits one URL per language with a mutual hreflang cluster", () => {
    const [pl, en] = expandSitemapUrls(ORIGIN, entries("/blog/analiza"), null, []);
    expect(pl.loc).toBe(`${ORIGIN}/blog/analiza`);
    expect(en.loc).toBe(`${ORIGIN}/en/blog/analiza`);
    // Klaster jest ten sam w obu wpisach (self-referencing + x-default).
    expect(pl.alternates).toEqual(en.alternates);
    expect(pl.alternates.map((a) => a.hreflang)).toEqual(["x-default", "pl", "en"]);
  });

  it("is deterministic and sorted, so shard boundaries never move", () => {
    // To jest warunek POPRAWNOŚCI shardowania, nie kosmetyka: zapytania do bazy
    // nie mają ORDER BY, więc bez sortowania granica shardu wędrowałaby między
    // żądaniami i część adresów wypadałaby z mapy.
    const a = expandSitemapUrls(ORIGIN, entries("/c", "/a", "/b"), null, []);
    const b = expandSitemapUrls(ORIGIN, entries("/b", "/c", "/a"), null, []);
    expect(a.map((u) => u.loc)).toEqual(b.map((u) => u.loc));
    expect(a.map((u) => u.loc)).toEqual([...a.map((u) => u.loc)].sort());
  });

  it("splits into shards without gaps or duplicates", () => {
    const urls = expandSitemapUrls(
      ORIGIN,
      entries(...Array.from({ length: 6 }, (_, i) => `/p${i}`)),
      null,
      [],
    );
    expect(urls).toHaveLength(12); // 6 dokumentów × 2 języki
    const shard1 = shardSlice(urls, 1, 5);
    const shard2 = shardSlice(urls, 2, 5);
    const shard3 = shardSlice(urls, 3, 5);
    const all = [...shard1, ...shard2, ...shard3].map((u) => u.loc);
    expect(all).toEqual(urls.map((u) => u.loc));
    expect(new Set(all).size).toBe(all.length);
  });

  it("deduplicates documents that resolve to the same URL", () => {
    const urls = expandSitemapUrls(ORIGIN, entries("/a", "/a"), null, []);
    expect(urls.map((u) => u.loc)).toEqual([`${ORIGIN}/a`, `${ORIGIN}/en/a`]);
  });

  it("carries lastmod, changefreq and priority onto every language variant", () => {
    const urls = expandSitemapUrls(
      ORIGIN,
      [{ loc: `${ORIGIN}/a`, lastmod: "2026-08-01", changefreq: "monthly", priority: "0.7" }],
      null,
      [],
    );
    for (const url of urls) {
      expect(url.lastmod).toBe("2026-08-01");
      expect(url.changefreq).toBe("monthly");
      expect(url.priority).toBe("0.7");
    }
  });
});

describe("newestLastmod", () => {
  it("returns the newest date present", () => {
    expect(
      newestLastmod([
        { loc: "a", alternates: [], lastmod: "2026-01-01" },
        { loc: "b", alternates: [], lastmod: "2026-08-01" },
        { loc: "c", alternates: [] },
      ]),
    ).toBe("2026-08-01");
  });

  it("returns null when nothing carries a date", () => {
    expect(newestLastmod([{ loc: "a", alternates: [] }])).toBeNull();
  });
});

describe("buildUrlsetXml", () => {
  const xml = buildUrlsetXml(expandSitemapUrls(ORIGIN, entries("/a"), null, []));

  it("declares both the sitemap and the xhtml namespace", () => {
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  });

  it("emits loc + hreflang links per url block", () => {
    expect(xml).toContain(`<loc>${ORIGIN}/a</loc>`);
    expect(xml).toContain(`<xhtml:link rel="alternate" hreflang="en" href="${ORIGIN}/en/a"/>`);
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("escapes XML-significant characters in loc", () => {
    const escaped = buildUrlsetXml([{ loc: `${ORIGIN}/a?b=1&c=2`, alternates: [] }]);
    expect(escaped).toContain(`<loc>${ORIGIN}/a?b=1&amp;c=2</loc>`);
  });
});
