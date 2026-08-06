import { describe, expect, it } from "vitest";
import {
  ROBOTS_DEFAULT_DISALLOW,
  ROBOTS_SHARED_MAX_AGE,
  ROBOTS_STALE_WHILE_REVALIDATE,
  buildRobotsTxt,
  robotsHeaders,
  type RobotsGroup,
} from "@/lib/seo/robots";

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

  it("ignores per-agent groups off the canonical host (everything is closed anyway)", () => {
    const body = buildRobotsTxt({
      mode: "legacy",
      origin: ORIGIN,
      groups: [{ agents: ["GPTBot"], disallow: ["/"] }],
    });
    expect(body).not.toContain("GPTBot");
  });
});

describe("robots.txt contract - per-agent groups", () => {
  const withGroups = (groups: RobotsGroup[]) =>
    buildRobotsTxt({ mode: "canonical", origin: ORIGIN, sitemapPaths: ["/sitemap.xml"], groups });

  it("renders each group after the wildcard group, in the given order", () => {
    const body = withGroups([
      { agents: ["GPTBot", "CCBot"], disallow: ["/"] },
      { agents: ["PerplexityBot"], disallow: ["/"] },
    ]);
    const order = ["User-agent: *", "User-agent: GPTBot", "User-agent: PerplexityBot"].map((line) =>
      body.indexOf(line),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Agenci jednej grupy dzielą jej reguły - jeden `Disallow` na blok.
    expect(body).toContain("User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /");
  });

  it("emits Allow exceptions before Disallow inside a group", () => {
    const body = withGroups([{ agents: ["Bingbot"], allow: ["/press/"], disallow: ["/drafts/"] }]);
    expect(body).toContain("User-agent: Bingbot\nAllow: /press/\nDisallow: /drafts/");
  });

  it("skips groups that would emit a user-agent without any rule", () => {
    // `User-agent:` bez reguł bywa sklejany z następną grupą - taki blok
    // zmieniałby znaczenie pliku, więc nie może w nim wystąpić.
    const body = withGroups([
      { agents: ["EmptyBot"], disallow: [] },
      { agents: [], disallow: ["/"] },
    ]);
    expect(body).not.toContain("EmptyBot");
    expect(body.match(/^User-agent:/gm)).toHaveLength(1);
  });

  it("names the host it was generated for (a static file cannot)", () => {
    // Komentarz nagłówkowy jest dowodem per host: identyczny plik dla dwóch
    // różnych domen oznaczałby, że odpowiada asset, nie trasa.
    expect(withGroups([])).toContain("# robots.txt for neweuropeanstrategies.com");
    const tenant = buildRobotsTxt({
      mode: "canonical",
      origin: "https://tenant.example",
      sitemapPaths: ["/sitemap.xml"],
    });
    expect(tenant).toContain("# robots.txt for tenant.example");
    expect(tenant).toContain("Sitemap: https://tenant.example/sitemap.xml");
  });

  it("ends the file with exactly one newline and single blank separators", () => {
    const body = withGroups([{ agents: ["GPTBot"], disallow: ["/"] }]);
    expect(body.endsWith("\n")).toBe(true);
    expect(body.endsWith("\n\n")).toBe(false);
    expect(body).not.toMatch(/\n{3}/);
  });
});

describe("robots.txt response headers", () => {
  it("marks an indexable host as crawlable and cacheable at the edge", () => {
    const headers = robotsHeaders({ indexable: true });
    expect(headers["X-Robots-Tag"]).toBe("all");
    expect(headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(headers["Cache-Control"]).toContain(`s-maxage=${ROBOTS_SHARED_MAX_AGE}`);
    expect(headers["Cache-Control"]).toContain(
      `stale-while-revalidate=${ROBOTS_STALE_WHILE_REVALIDATE}`,
    );
    // Przeglądarka rewaliduje zawsze - polityka crawlowania nie może wisieć w
    // cache czytelnika po zmianie ustawień redakcji.
    expect(headers["Cache-Control"]).toContain("max-age=0");
  });

  it("marks a blocked host noindex", () => {
    expect(robotsHeaders({ indexable: false })["X-Robots-Tag"]).toBe("noindex, nofollow");
  });

  it("never caches a fail-closed answer produced without the tenant directory", () => {
    // Inaczej minutowa awaria bazy zamraża "Disallow: /" w CDN i w Google.
    const headers = robotsHeaders({ indexable: false, volatile: true });
    expect(headers["Cache-Control"]).toBe("private, no-store");
  });
});
