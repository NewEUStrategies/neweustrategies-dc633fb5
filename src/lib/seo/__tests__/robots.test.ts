import { describe, expect, it } from "vitest";
import { ROBOTS_DEFAULT_DISALLOW, buildRobotsTxt } from "@/lib/seo/robots";

const ORIGIN = "https://neweuropeanstrategies.com";

describe("robots.txt contract - canonical host", () => {
  const body = buildRobotsTxt({
    mode: "canonical",
    origin: ORIGIN,
    sitemapPaths: ["/sitemap.xml", "/news-sitemap.xml"],
  });

  it("allows indexing and closes the private surfaces", () => {
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    for (const path of ROBOTS_DEFAULT_DISALLOW) {
      expect(body).toContain(`Disallow: ${path}`);
    }
  });

  it("advertises EVERY sitemap it was given as an absolute URL", () => {
    // REGRESJA, której pilnuje ten test: trasa deklarowała tylko /sitemap.xml,
    // więc /news-sitemap.xml nie był odkrywalny żadnym kanałem.
    expect(body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(body).toContain(`Sitemap: ${ORIGIN}/news-sitemap.xml`);
  });

  it("never emits a relative Sitemap directive", () => {
    for (const line of body.split("\n").filter((l) => l.startsWith("Sitemap:"))) {
      expect(line).toMatch(/^Sitemap: https:\/\//);
    }
  });

  it("deduplicates repeated sitemap paths", () => {
    const dupes = buildRobotsTxt({
      mode: "canonical",
      origin: ORIGIN,
      sitemapPaths: ["/sitemap.xml", "/sitemap.xml"],
    });
    expect(dupes.split("Sitemap:").length - 1).toBe(1);
  });

  it("tolerates a trailing slash on the origin without doubling it", () => {
    const body2 = buildRobotsTxt({
      mode: "canonical",
      origin: `${ORIGIN}/`,
      sitemapPaths: ["/sitemap.xml"],
    });
    expect(body2).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(body2).not.toContain("//sitemap.xml");
  });
});

describe("robots.txt contract - non-canonical hosts", () => {
  it("fully disallows a legacy/preview host and explains why", () => {
    const body = buildRobotsTxt({ mode: "legacy", origin: ORIGIN });
    expect(body).toContain("Disallow: /");
    expect(body).not.toContain("Allow: /");
    expect(body).not.toContain("Sitemap:");
    expect(body).toContain("# Legacy / preview host");
  });

  it("fully disallows an unknown host (fail-closed default)", () => {
    const body = buildRobotsTxt({ mode: "unknown", origin: ORIGIN });
    expect(body).toContain("Disallow: /");
    expect(body).not.toContain("Sitemap:");
  });

  it("never leaks a sitemap declaration off the canonical host", () => {
    for (const mode of ["legacy", "unknown"] as const) {
      const body = buildRobotsTxt({
        mode,
        origin: ORIGIN,
        // Nawet gdy wywołujący poda listę - tryb nie-kanoniczny ją ignoruje.
        sitemapPaths: ["/sitemap.xml"],
      });
      expect(body).not.toContain("Sitemap:");
    }
  });
});
