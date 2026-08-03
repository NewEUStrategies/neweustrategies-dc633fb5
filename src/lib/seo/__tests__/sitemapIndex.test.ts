import { describe, expect, it } from "vitest";
import {
  SITEMAP_SECTIONS,
  SITEMAP_URLS_PER_SHARD,
  buildSitemapIndexXml,
  isSitemapSection,
  parseSitemapShard,
  shardCountFor,
  shardSlice,
  sitemapShardFile,
  sitemapShardPath,
} from "@/lib/seo/sitemapIndex";

describe("sitemap shard naming", () => {
  it("keeps the first shard unnumbered and numbers the rest from 2", () => {
    expect(sitemapShardFile("posts", 1)).toBe("posts.xml");
    expect(sitemapShardFile("posts", 2)).toBe("posts-2.xml");
    expect(sitemapShardPath("tracker", 1)).toBe("/sitemaps/tracker.xml");
    expect(sitemapShardPath("tracker", 3)).toBe("/sitemaps/tracker-3.xml");
  });

  it("round-trips every section through parse", () => {
    for (const section of SITEMAP_SECTIONS) {
      expect(parseSitemapShard(sitemapShardFile(section, 1))).toEqual({ section, shard: 1 });
      expect(parseSitemapShard(sitemapShardFile(section, 7))).toEqual({ section, shard: 7 });
    }
  });

  it("rejects unknown sections, missing extension and a redundant -1 suffix", () => {
    expect(parseSitemapShard("wpisy.xml")).toBeNull();
    expect(parseSitemapShard("posts")).toBeNull();
    expect(parseSitemapShard("posts.txt")).toBeNull();
    // Shard pierwszy mieszka pod "posts.xml" - drugi adres tej samej treści
    // byłby duplikatem w indeksie i w raporcie GSC.
    expect(parseSitemapShard("posts-1.xml")).toBeNull();
    expect(parseSitemapShard("posts-0.xml")).toBeNull();
    expect(parseSitemapShard("posts-x.xml")).toBeNull();
  });

  it("recognises exactly the declared sections", () => {
    expect(isSitemapSection("core")).toBe(true);
    expect(isSitemapSection("nope")).toBe(false);
  });
});

describe("sitemap sharding math", () => {
  it("stays under the 50 000 URL protocol limit per file", () => {
    expect(SITEMAP_URLS_PER_SHARD).toBeLessThanOrEqual(50_000);
  });

  it("counts shards from the URL count", () => {
    expect(shardCountFor(0)).toBe(0);
    expect(shardCountFor(1)).toBe(1);
    expect(shardCountFor(SITEMAP_URLS_PER_SHARD)).toBe(1);
    expect(shardCountFor(SITEMAP_URLS_PER_SHARD + 1)).toBe(2);
    expect(shardCountFor(SITEMAP_URLS_PER_SHARD * 3)).toBe(3);
  });

  it("slices shards without gaps or overlaps", () => {
    const urls = Array.from({ length: 25 }, (_, i) => i);
    const a = shardSlice(urls, 1, 10);
    const b = shardSlice(urls, 2, 10);
    const c = shardSlice(urls, 3, 10);
    expect(a).toHaveLength(10);
    expect(b).toHaveLength(10);
    expect(c).toHaveLength(5);
    expect([...a, ...b, ...c]).toEqual(urls);
    // Shard poza zakresem jest pusty - trasa odpowiada wtedy 404.
    expect(shardSlice(urls, 4, 10)).toEqual([]);
  });
});

describe("buildSitemapIndexXml", () => {
  it("emits a valid sitemapindex with optional lastmod", () => {
    const xml = buildSitemapIndexXml([
      { loc: "https://nes.example/sitemaps/core.xml" },
      { loc: "https://nes.example/sitemaps/posts.xml", lastmod: "2026-08-01" },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<loc>https://nes.example/sitemaps/core.xml</loc>");
    expect(xml).toContain("<lastmod>2026-08-01</lastmod>");
    // Wpis bez daty nie dostaje pustego <lastmod> (walidatory to odrzucają).
    expect(xml).not.toContain("<lastmod></lastmod>");
    expect(xml.trimEnd().endsWith("</sitemapindex>")).toBe(true);
  });

  it("escapes XML-significant characters in loc", () => {
    const xml = buildSitemapIndexXml([{ loc: "https://nes.example/a?b=1&c=2" }]);
    expect(xml).toContain("<loc>https://nes.example/a?b=1&amp;c=2</loc>");
  });
});
