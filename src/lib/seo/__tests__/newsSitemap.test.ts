import { describe, expect, it } from "vitest";
import {
  buildNewsSitemapXml,
  freshNewsEntries,
  NEWS_SITEMAP_WINDOW_MS,
  type NewsSitemapEntry,
} from "@/lib/seo/newsSitemap";

const NOW = Date.parse("2026-07-02T12:00:00Z");

const entry = (hoursAgo: number, over: Partial<NewsSitemapEntry> = {}): NewsSitemapEntry => ({
  url: `https://nes.example/blog/wpis-${hoursAgo}`,
  title: `Wpis ${hoursAgo}h`,
  publishedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  language: "pl",
  ...over,
});

describe("freshNewsEntries", () => {
  it("keeps only the 48h window, newest first", () => {
    const fresh = freshNewsEntries([entry(50), entry(1), entry(47), entry(0)], NOW);
    expect(fresh.map((e) => e.title)).toEqual(["Wpis 0h", "Wpis 1h", "Wpis 47h"]);
    expect(NEWS_SITEMAP_WINDOW_MS).toBe(48 * 3_600_000);
  });
  it("drops future and invalid dates", () => {
    const future = entry(0, { publishedAt: new Date(NOW + 3_600_000).toISOString() });
    const invalid = entry(0, { publishedAt: "nope" });
    expect(freshNewsEntries([future, invalid], NOW)).toEqual([]);
  });
});

describe("buildNewsSitemapXml", () => {
  it("emits news:news nodes with publication, language and title", () => {
    const xml = buildNewsSitemapXml({
      publicationName: "New European Strategies",
      entries: [
        entry(2),
        entry(3, { language: "en", url: "https://nes.example/en/blog/x", title: "EN & co" }),
      ],
      now: NOW,
    });
    expect(xml).toContain(`xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"`);
    expect(xml).toContain("<news:name>New European Strategies</news:name>");
    expect(xml).toContain("<news:language>en</news:language>");
    expect(xml).toContain("EN &amp; co");
    expect(xml).toContain("<loc>https://nes.example/en/blog/x</loc>");
  });
  it("produces a valid empty urlset on a quiet news day", () => {
    const xml = buildNewsSitemapXml({ publicationName: "NES", entries: [entry(100)], now: NOW });
    expect(xml).toContain("<urlset");
    expect(xml).not.toContain("<url>");
  });
});
