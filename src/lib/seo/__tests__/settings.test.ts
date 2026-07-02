import { describe, expect, it } from "vitest";
import {
  aiCrawlerDirectives,
  DEFAULT_SEO_SETTINGS,
  effectiveNewsPublicationName,
  effectiveTitleSuffix,
  parseSeoSettings,
} from "@/lib/seo/settings";
import { SITE_NAME } from "@/lib/seo/meta";

describe("parseSeoSettings", () => {
  it("merges partial blobs over defaults", () => {
    const s = parseSeoSettings({ rss_item_count: 12, twitter_site: "@nes" });
    expect(s.rss_item_count).toBe(12);
    expect(s.twitter_site).toBe("@nes");
    expect(s.rss_enabled).toBe(true);
  });
  it("falls back to defaults on corrupted values", () => {
    expect(parseSeoSettings({ rss_item_count: "sto" })).toEqual(DEFAULT_SEO_SETTINGS);
    expect(parseSeoSettings(null)).toEqual(DEFAULT_SEO_SETTINGS);
    expect(parseSeoSettings("string")).toEqual(DEFAULT_SEO_SETTINGS);
  });
});

describe("effective values", () => {
  it("title suffix honours the toggle and custom text", () => {
    expect(effectiveTitleSuffix(DEFAULT_SEO_SETTINGS)).toBe(SITE_NAME);
    expect(effectiveTitleSuffix({ ...DEFAULT_SEO_SETTINGS, title_suffix: "NES" })).toBe("NES");
    expect(
      effectiveTitleSuffix({ ...DEFAULT_SEO_SETTINGS, title_suffix_enabled: false }),
    ).toBeNull();
  });
  it("news publication name falls back to the site name", () => {
    expect(effectiveNewsPublicationName(DEFAULT_SEO_SETTINGS)).toBe(SITE_NAME);
    expect(
      effectiveNewsPublicationName({ ...DEFAULT_SEO_SETTINGS, news_publication_name: "NES News" }),
    ).toBe("NES News");
  });
});

describe("aiCrawlerDirectives", () => {
  it("emits nothing when everything is allowed (GEO default)", () => {
    expect(aiCrawlerDirectives(DEFAULT_SEO_SETTINGS)).toEqual([]);
  });
  it("blocks training crawlers independently of search crawlers", () => {
    const lines = aiCrawlerDirectives({
      ...DEFAULT_SEO_SETTINGS,
      ai_training_crawlers_allowed: false,
    });
    expect(lines).toContain("User-agent: GPTBot");
    expect(lines).toContain("Disallow: /");
    expect(lines.join("\n")).not.toContain("PerplexityBot");
  });
  it("blocks search crawlers when disabled", () => {
    const lines = aiCrawlerDirectives({
      ...DEFAULT_SEO_SETTINGS,
      ai_search_crawlers_allowed: false,
    });
    expect(lines.join("\n")).toContain("User-agent: PerplexityBot");
  });
});
