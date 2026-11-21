// Ekosystem SEO zarządza się sam: lista plików wynika z rejestru i przełączników.
import { describe, expect, it } from "vitest";
import { MACHINE_SURFACES } from "@/lib/seo/machineSurfaces";
import { DEFAULT_SEO_SETTINGS } from "@/lib/seo/settings";
import { robotsSitemapPaths, seoEcosystemEntries } from "@/lib/seo/seoEcosystem";

const paths = (entries: Array<{ href: string }>) => entries.map((e) => e.href);

describe("seoEcosystemEntries", () => {
  it("lists every registered surface, with a separate /en row for localized feeds", () => {
    const { active, disabled } = seoEcosystemEntries(DEFAULT_SEO_SETTINGS);
    expect(disabled).toHaveLength(0);
    const expected = MACHINE_SURFACES.reduce((n, s) => n + (s.localized ? 2 : 1), 0);
    expect(active).toHaveLength(expected);
    expect(paths(active)).toEqual(
      expect.arrayContaining([
        "/rss.xml",
        "/en/rss.xml",
        "/podcast/rss.xml",
        "/en/podcast/rss.xml",
      ]),
    );
  });

  it("withdraws all RSS feeds in both languages when RSS is switched off", () => {
    const { active, disabled } = seoEcosystemEntries({
      ...DEFAULT_SEO_SETTINGS,
      rss_enabled: false,
    });
    expect(paths(active).some((p) => p.endsWith("rss.xml"))).toBe(false);
    expect(paths(disabled)).toEqual(
      expect.arrayContaining(["/rss.xml", "/en/rss.xml", "/live/rss.xml", "/en/live/rss.xml"]),
    );
  });

  it("withdraws the Google News sitemap from the list and from robots.txt together", () => {
    const settings = { ...DEFAULT_SEO_SETTINGS, news_sitemap_enabled: false };
    expect(paths(seoEcosystemEntries(settings).active)).not.toContain("/news-sitemap.xml");
    expect(robotsSitemapPaths(settings)).toEqual(["/sitemap.xml"]);
  });

  it("withdraws llms.txt when it is switched off, keeps robots.txt always on", () => {
    const { active, disabled } = seoEcosystemEntries({
      ...DEFAULT_SEO_SETTINGS,
      llms_txt_enabled: false,
    });
    expect(paths(disabled)).toContain("/llms.txt");
    expect(paths(active)).toContain("/robots.txt");
  });

  it("brings a surface back as soon as its switch is turned on again", () => {
    const off = seoEcosystemEntries({ ...DEFAULT_SEO_SETTINGS, news_sitemap_enabled: false });
    const on = seoEcosystemEntries({ ...DEFAULT_SEO_SETTINGS, news_sitemap_enabled: true });
    expect(paths(off.active)).not.toContain("/news-sitemap.xml");
    expect(paths(on.active)).toContain("/news-sitemap.xml");
  });

  it("marks exactly the sitemaps that robots.txt announces", () => {
    const announced = seoEcosystemEntries(DEFAULT_SEO_SETTINGS).active.filter((e) => e.inRobots);
    expect(paths(announced).sort()).toEqual(["/news-sitemap.xml", "/sitemap.xml"]);
  });
});
