import { describe, expect, it } from "vitest";
import {
  ROBOTS_DEFAULT_DISALLOW,
  buildRobotsTxt,
  robotsModeFor,
  type RobotsHostFacts,
} from "@/lib/seo/robots";
import {
  AI_SEARCH_CRAWLERS,
  AI_TRAINING_CRAWLERS,
  DEFAULT_SEO_SETTINGS,
  aiCrawlerDirectives,
} from "@/lib/seo/settings";

const ORIGIN = "https://neweuropeanstrategies.com";

const NO_FACTS: RobotsHostFacts = {
  brandCanonical: false,
  aliasOrPreview: false,
  tenantClaimed: false,
  directoryDegraded: false,
};

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
        agentGroups: aiCrawlerDirectives({
          ...DEFAULT_SEO_SETTINGS,
          ai_training_crawlers_allowed: false,
        }),
      });
      expect(body).not.toContain("Sitemap:");
      // Grupy per-agent też są zbędne tam, gdzie wszystko jest już zakazane.
      expect(body).not.toContain("GPTBot");
    }
  });
});

// REGRESJA 2026-08-06: polityka crawlerów AI istniała w ustawieniach i w panelu,
// ale robots.txt jej NIE emitował - przełączniki nie zmieniały ani jednego bajtu
// odpowiedzi. Ten blok pilnuje, że deklaracja redakcji trafia do pliku.
describe("robots.txt contract - polityka crawlerów AI", () => {
  const withPolicy = (overrides: Partial<typeof DEFAULT_SEO_SETTINGS>) =>
    buildRobotsTxt({
      mode: "canonical",
      origin: ORIGIN,
      sitemapPaths: ["/sitemap.xml"],
      agentGroups: aiCrawlerDirectives({ ...DEFAULT_SEO_SETTINGS, ...overrides }),
    });

  it("keeps every AI crawler in when the editorial policy allows them", () => {
    const body = withPolicy({});
    for (const agent of [...AI_SEARCH_CRAWLERS, ...AI_TRAINING_CRAWLERS]) {
      expect(body, agent).not.toContain(agent);
    }
  });

  it("blocks training crawlers only, leaving the citation crawlers in", () => {
    const body = withPolicy({ ai_training_crawlers_allowed: false });
    for (const agent of AI_TRAINING_CRAWLERS) expect(body, agent).toContain(`User-agent: ${agent}`);
    for (const agent of AI_SEARCH_CRAWLERS) expect(body, agent).not.toContain(agent);
  });

  it("blocks the citation crawlers when the editors opt out of AI answers", () => {
    const body = withPolicy({ ai_search_crawlers_allowed: false });
    for (const agent of AI_SEARCH_CRAWLERS) expect(body, agent).toContain(`User-agent: ${agent}`);
  });

  it("puts the per-agent groups AFTER the global group and BEFORE the sitemaps", () => {
    // Kolejność ma znaczenie: crawler stosuje najbardziej szczegółową grupę,
    // a rekord `Sitemap` musi zostać poza grupami (jest bezgrupowy).
    const body = withPolicy({ ai_training_crawlers_allowed: false });
    const globalGroup = body.indexOf("User-agent: *");
    const aiGroup = body.indexOf("User-agent: GPTBot");
    const sitemap = body.indexOf("Sitemap:");
    expect(globalGroup).toBeLessThan(aiGroup);
    expect(aiGroup).toBeLessThan(sitemap);
  });

  it("separates the global group from the first per-agent group with a blank line", () => {
    const lines = withPolicy({ ai_training_crawlers_allowed: false }).split("\n");
    const firstAgentLine = lines.findIndex((line) => line === "User-agent: GPTBot");
    expect(lines[firstAgentLine - 1]).toBe("");
  });
});

// Który host wolno w ogóle zaprosić do indeksu. Decyzja jest czysta, więc da się
// ją sprawdzić bez bazy - a to ONA decyduje o (de)indeksacji całych domen.
describe("robotsModeFor", () => {
  it("always invites the brand host, even when the tenant directory is down", () => {
    expect(robotsModeFor({ ...NO_FACTS, brandCanonical: true })).toBe("canonical");
    expect(robotsModeFor({ ...NO_FACTS, brandCanonical: true, directoryDegraded: true })).toBe(
      "canonical",
    );
  });

  it("closes hosting aliases and previews - even if one is registered as a domain", () => {
    expect(robotsModeFor({ ...NO_FACTS, aliasOrPreview: true })).toBe("legacy");
    expect(robotsModeFor({ ...NO_FACTS, aliasOrPreview: true, tenantClaimed: true })).toBe(
      "legacy",
    );
  });

  it("treats a tenant's own domain as canonical (its sitemap answers 200 there)", () => {
    // REGRESJA: druga domena dostawała `Disallow: /`, mimo że serwis na niej
    // działa i NIE jest kanonizowany 301 na markę - robots.txt kasował z indeksu
    // cały serwis tenanta.
    expect(robotsModeFor({ ...NO_FACTS, tenantClaimed: true })).toBe("canonical");
  });

  it("does not deindex a live site when the tenant directory is unavailable", () => {
    // Podany na żywo `Disallow: /` jest respektowany natychmiast, więc awaria
    // katalogu domen nie może być powodem do zamknięcia serwisu dla crawlerów.
    expect(robotsModeFor({ ...NO_FACTS, directoryDegraded: true })).toBe("canonical");
  });

  it("fails closed for a host nobody claimed while the directory is populated", () => {
    expect(robotsModeFor(NO_FACTS)).toBe("unknown");
  });
});
