import { describe, expect, it } from "vitest";
import {
  aiCrawlerGroups,
  AI_SEARCH_CRAWLERS,
  AI_TRAINING_CRAWLERS,
  DEFAULT_SEO_SETTINGS,
  effectiveNewsPublicationName,
  effectiveTitleSuffix,
  parseSeoSettings,
} from "@/lib/seo/settings";
import { buildRobotsTxt } from "@/lib/seo/robots";
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

describe("aiCrawlerGroups", () => {
  it("emits nothing when everything is allowed (GEO default)", () => {
    expect(aiCrawlerGroups(DEFAULT_SEO_SETTINGS)).toEqual([]);
  });
  it("blocks training crawlers independently of search crawlers", () => {
    const groups = aiCrawlerGroups({
      ...DEFAULT_SEO_SETTINGS,
      ai_training_crawlers_allowed: false,
    });
    expect(groups).toEqual([{ agents: AI_TRAINING_CRAWLERS, disallow: ["/"] }]);
    expect(groups.flatMap((g) => g.agents)).not.toContain("PerplexityBot");
  });
  it("blocks search crawlers when disabled", () => {
    const groups = aiCrawlerGroups({
      ...DEFAULT_SEO_SETTINGS,
      ai_search_crawlers_allowed: false,
    });
    expect(groups).toEqual([{ agents: AI_SEARCH_CRAWLERS, disallow: ["/"] }]);
  });
  it("blocks both families when the editors opt out of AI entirely", () => {
    const groups = aiCrawlerGroups({
      ...DEFAULT_SEO_SETTINGS,
      ai_search_crawlers_allowed: false,
      ai_training_crawlers_allowed: false,
    });
    expect(groups).toHaveLength(2);
  });

  // REGRESJA (audyt 2026-08-06): te przełączniki NIE MIAŁY ŻADNEGO WOŁAJĄCEGO -
  // redakcja mogła zabronić crawlerom AI w panelu, a robots.txt nigdy o tym nie
  // wspominał. Test wiąże ustawienie z gotowym plikiem, nie tylko z funkcją.
  it("reaches the rendered robots.txt as a separate per-agent group", () => {
    const body = buildRobotsTxt({
      mode: "canonical",
      origin: "https://neweuropeanstrategies.com",
      sitemapPaths: ["/sitemap.xml"],
      groups: aiCrawlerGroups({
        ...DEFAULT_SEO_SETTINGS,
        ai_training_crawlers_allowed: false,
      }),
    });
    expect(body).toContain("User-agent: GPTBot");
    // Grupa `*` nadal zaprasza wyszukiwarki - blokada dotyczy tylko botów AI.
    expect(body).toContain("Allow: /");
    expect(body.indexOf("User-agent: GPTBot")).toBeGreaterThan(body.indexOf("Allow: /"));
    expect(body).not.toContain("PerplexityBot");
  });
});
