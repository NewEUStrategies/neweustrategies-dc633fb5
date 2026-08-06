// Podgląd robots.txt w panelu musi pokazywać DOKŁADNIE to, co dostaje crawler.
//
// Sens tego testu: produkcyjne /robots.txt było miesiącami przesłonięte
// statycznym plikiem i nikt tego nie zauważył - między innymi dlatego, że
// nigdzie w panelu nie było widać, co ta powierzchnia publikuje. Podgląd ma
// wartość tylko wtedy, gdy nie jest własną, rozjeżdżającą się reprezentacją
// polityki, więc test porównuje go z tym samym builderem, którego używa trasa.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RobotsTxtPreview } from "@/components/admin/seo/RobotsTxtPreview";
import { buildRobotsTxt } from "@/lib/seo/robots";
import { aiCrawlerDirectives, DEFAULT_SEO_SETTINGS } from "@/lib/seo/settings";
import { CANONICAL_SITE_ORIGIN } from "@/lib/http/host";

function previewText(settings = DEFAULT_SEO_SETTINGS): string {
  const { container } = render(<RobotsTxtPreview settings={settings} />);
  return container.querySelector("pre")?.textContent ?? "";
}

describe("RobotsTxtPreview", () => {
  it("renders byte-for-byte what the builder produces for the publishing domain", () => {
    // happy-dom serwuje test z localhost (host podglądu), więc podgląd pokazuje
    // politykę domeny publikacji - inaczej redakcja widziałaby localhost.
    expect(previewText()).toBe(
      buildRobotsTxt({
        mode: "canonical",
        origin: CANONICAL_SITE_ORIGIN,
        sitemapPaths: ["/sitemap.xml", "/news-sitemap.xml"],
        agentGroups: [],
      }),
    );
  });

  it("drops the news sitemap when the editors disable it", () => {
    const text = previewText({ ...DEFAULT_SEO_SETTINGS, news_sitemap_enabled: false });
    expect(text).toContain("/sitemap.xml");
    expect(text).not.toContain("news-sitemap.xml");
  });

  it("shows the AI-crawler policy the editors just set, before saving", () => {
    const settings = { ...DEFAULT_SEO_SETTINGS, ai_training_crawlers_allowed: false };
    const text = previewText(settings);
    expect(text).toContain("User-agent: GPTBot");
    expect(aiCrawlerDirectives(settings)).toContain("User-agent: GPTBot");
    // Grupa globalna zostaje otwarta - blokada dotyczy tylko botów AI.
    expect(text).toContain("Allow: /");
  });

  it("links to the live file so a shadowed route is one click away", () => {
    render(<RobotsTxtPreview settings={DEFAULT_SEO_SETTINGS} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/robots.txt");
  });
});
