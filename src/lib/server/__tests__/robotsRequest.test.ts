// Kontrakt /robots.txt na poziomie ŻĄDANIA - warstwa, w której audyt 2026-08-06
// znalazł trzy niezależne dziury tej samej powierzchni:
//   1. trasa była nieosiągalna (statyczny `public/robots.txt` wygrywał z
//      workerem) - pilnują tego bramka `check:public-assets` i e2e;
//   2. redakcyjna polityka crawlerów AI nie docierała do pliku w ogóle;
//   3. domena tenanta (`tenants.domain`) była klasyfikowana jako host nieznany,
//      więc robots.txt zakazywał indeksowania całego serwisu tenanta.
//
// Zaślepione są WYŁĄCZNIE dwie granice I/O (klient service-role i odczyt
// ustawień). Klasyfikacja hosta, katalog tenantów, fail-closed i builder treści
// wykonują się realnie - test sprawdza zachowanie, nie własne atrapy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateTenantDirectoryCache } from "@/lib/server/tenant.server";
import { planRobotsTxt } from "@/lib/server/robotsRequest.server";
import { DEFAULT_SEO_SETTINGS } from "@/lib/seo/settings";
import { NEWS_SITEMAP_READ_BUDGET_MS } from "@/lib/server/newsSitemapEntries.server";

const state = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; slug: string; domain: string | null; is_default: boolean }>,
  seoSettings: null as unknown,
  settingsThrows: false,
  /**
   * Opublikowane wpisy najemcy - materiał decyzji o news-sitemapie
   * (`loadNewsSitemapEntries` -> `planNewsSitemap`). Domyślnie jeden artykuł,
   * bo bez niego plik odpowiada 404 i robots.txt go nie ogłasza.
   */
  posts: [] as Array<Record<string, unknown>>,
  /** Sposób awarii odczytu wpisów: odrzucenie albo zawieszone połączenie. */
  postsFailure: null as "throw" | "hang" | null,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ limit: () => Promise.resolve({ data: state.rows, error: null }) }),
    }),
  },
}));

vi.mock("@/lib/server/publishedContent.server", () => ({
  fetchSeoSettingsValue: async () => {
    if (state.settingsThrows) throw new Error("db down");
    return state.seoSettings;
  },
  fetchPublishedPosts: () => {
    // Prawdziwy czytnik jest `resilient`: awaria bazy wraca jako `[]`, nie jako
    // wyjątek (przegląd 2026-10) - atrapa odwzorowuje to wiernie.
    if (state.postsFailure === "throw") return Promise.resolve([]);
    if (state.postsFailure === "hang") return new Promise<never>(() => undefined);
    return Promise.resolve(state.posts);
  },
}));

/** Opublikowany artykuł w kształcie wiersza `fetchPublishedPosts`. */
function publishedPost(publishedAt = "2026-01-10T08:00:00Z"): Record<string, unknown> {
  return {
    id: "post-1",
    slug: "analiza",
    path: "/analizy/analiza",
    title_pl: "Analiza",
    title_en: "Analysis",
    published_at: publishedAt,
    updated_at: null,
  };
}

const NES = { id: "t-nes", slug: "nes", domain: "neweuropeanstrategies.com", is_default: true };
const TENANT_B = { id: "t-b", slug: "tenant-b", domain: "tenant-b.eu", is_default: false };

/** Żądanie o robots.txt z danego hosta (x-forwarded-host - nie jest zabroniony). */
function requestFrom(host: string): Request {
  return new Request("https://edge.invalid/robots.txt", {
    headers: { "x-forwarded-host": host, "x-forwarded-proto": "https" },
  });
}

beforeEach(() => {
  invalidateTenantDirectoryCache();
  state.rows = [NES, TENANT_B];
  state.seoSettings = null;
  state.settingsThrows = false;
  state.posts = [publishedPost()];
  state.postsFailure = null;
});

describe("brand host", () => {
  it("invites indexing and advertises the sitemap index", async () => {
    const plan = await planRobotsTxt(requestFrom("neweuropeanstrategies.com"));
    expect(plan.hostClass).toBe("brand");
    expect(plan.indexable).toBe(true);
    expect(plan.volatile).toBe(false);
    expect(plan.body).toContain("Allow: /");
    expect(plan.body).toContain("Disallow: /admin/");
    expect(plan.body).toContain("Sitemap: https://neweuropeanstrategies.com/sitemap.xml");
  });

  it("advertises the news sitemap only when the editors enabled it", async () => {
    // Domyślnie włączona: to była główna zdobycz wydania 03.08, którą statyczny
    // plik unieważniał.
    state.seoSettings = { ...DEFAULT_SEO_SETTINGS };
    let plan = await planRobotsTxt(requestFrom("neweuropeanstrategies.com"));
    expect(plan.body).toContain("Sitemap: https://neweuropeanstrategies.com/news-sitemap.xml");

    state.seoSettings = { ...DEFAULT_SEO_SETTINGS, news_sitemap_enabled: false };
    plan = await planRobotsTxt(requestFrom("neweuropeanstrategies.com"));
    // Trasa news sitemapy odpowiada wtedy 404 - ogłoszenie jej byłoby gotowym
    // błędem w Search Console.
    expect(plan.body).not.toContain("news-sitemap.xml");
    expect(plan.body).toContain("Sitemap: https://neweuropeanstrategies.com/sitemap.xml");
  });

  // 2026-10 audyt powierzchni maszynowych: robots.txt ogłaszał news-sitemapę na
  // samą flagę, choć indeks sitemapy (od 2026-10-10) i trasa pliku sprawdzają,
  // czy plik ma co pokazać. Tenant bez artykułu dostawał w robots.txt adres,
  // który odpowiada 404 „No news articles" - błąd pliku w Search Console.
  describe("news-sitemapa - ta sama decyzja co indeks sitemapy", () => {
    beforeEach(() => {
      state.seoSettings = { ...DEFAULT_SEO_SETTINGS };
    });

    it("nie ogłasza news-sitemapy, gdy najemca nie ma żadnego artykułu (plik = 404)", async () => {
      state.posts = [];
      const plan = await planRobotsTxt(requestFrom("neweuropeanstrategies.com"));
      expect(plan.body).not.toContain("news-sitemap.xml");
      expect(plan.body).toContain("Sitemap: https://neweuropeanstrategies.com/sitemap.xml");
      // Pusty odczyt jest nie do odróżnienia od awarii (`resilient` oddaje `[]`),
      // więc odpowiedź NIE trafia do cache brzegu - koszt: robots.txt bez cache.
      expect(plan.volatile).toBe(true);
    });

    it("ogłasza ją także w dzień bez publikacji - plik niesie wtedy kotwicę (plan `anchor`)", async () => {
      state.posts = [publishedPost("2025-03-01T08:00:00Z")];
      const plan = await planRobotsTxt(requestFrom("neweuropeanstrategies.com"));
      expect(plan.body).toContain("Sitemap: https://neweuropeanstrategies.com/news-sitemap.xml");
    });

    it("wpis zaplanowany na przyszłość nie jest artykułem - plik byłby pusty", async () => {
      state.posts = [publishedPost("2999-01-01T08:00:00Z")];
      const plan = await planRobotsTxt(requestFrom("neweuropeanstrategies.com"));
      expect(plan.body).not.toContain("news-sitemap.xml");
    });

    it("awaria odczytu wpisów: bez news-sitemapy i bez cache (volatile)", async () => {
      state.postsFailure = "throw";
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const plan = await planRobotsTxt(requestFrom("neweuropeanstrategies.com"));
      expect(plan.indexable).toBe(true);
      expect(plan.body).not.toContain("news-sitemap.xml");
      expect(plan.body).toContain("Sitemap: https://neweuropeanstrategies.com/sitemap.xml");
      expect(plan.volatile).toBe(true);
      warn.mockRestore();
    });

    it("zawieszony odczyt wpisów kończy się po budżecie, a nie wisi z całym robots.txt", async () => {
      vi.useFakeTimers();
      try {
        state.postsFailure = "hang";
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const pending = planRobotsTxt(requestFrom("neweuropeanstrategies.com"));
        await vi.advanceTimersByTimeAsync(NEWS_SITEMAP_READ_BUDGET_MS);
        const plan = await pending;
        expect(plan.body).not.toContain("news-sitemap.xml");
        expect(plan.volatile).toBe(true);
        warn.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("carries the editorial AI-crawler policy into the file", async () => {
    state.seoSettings = {
      ...DEFAULT_SEO_SETTINGS,
      ai_training_crawlers_allowed: false,
      ai_search_crawlers_allowed: false,
    };
    const plan = await planRobotsTxt(requestFrom("www.neweuropeanstrategies.com"));
    expect(plan.body).toContain("User-agent: GPTBot");
    expect(plan.body).toContain("User-agent: PerplexityBot");
    // Grupa `*` pozostaje otwarta - blokada dotyczy tylko botów AI.
    expect(plan.body).toContain("Allow: /");
  });

  it("degrades to the sitemap index when the settings read fails", async () => {
    state.settingsThrows = true;
    const plan = await planRobotsTxt(requestFrom("neweuropeanstrategies.com"));
    expect(plan.indexable).toBe(true);
    expect(plan.body).toContain("Sitemap: https://neweuropeanstrategies.com/sitemap.xml");
    expect(plan.body).not.toContain("news-sitemap.xml");
  });

  it("stays indexable without the tenant directory (brand needs no lookup)", async () => {
    state.rows = [];
    const plan = await planRobotsTxt(requestFrom("neweuropeanstrategies.com"));
    expect(plan.hostClass).toBe("brand");
    expect(plan.indexable).toBe(true);
    expect(plan.volatile).toBe(false);
  });
});

describe("tenant domain", () => {
  it("is canonical for its own site and publishes its own origin", async () => {
    const plan = await planRobotsTxt(requestFrom("tenant-b.eu"));
    expect(plan.hostClass).toBe("tenant");
    expect(plan.indexable).toBe(true);
    expect(plan.body).toContain("# robots.txt for tenant-b.eu");
    expect(plan.body).toContain("Sitemap: https://tenant-b.eu/sitemap.xml");
    expect(plan.body).not.toContain("neweuropeanstrategies.com");
  });

  it("matches through the www/apex alias", async () => {
    const plan = await planRobotsTxt(requestFrom("www.tenant-b.eu"));
    expect(plan.hostClass).toBe("tenant");
    expect(plan.body).toContain("Sitemap: https://www.tenant-b.eu/sitemap.xml");
  });

  it("uses the tenant's own settings, not the brand tenant's", async () => {
    state.seoSettings = { ...DEFAULT_SEO_SETTINGS, ai_training_crawlers_allowed: false };
    const plan = await planRobotsTxt(requestFrom("tenant-b.eu"));
    expect(plan.body).toContain("User-agent: GPTBot");
  });
});

describe("non-canonical hosts", () => {
  it("blocks a hosting alias completely", async () => {
    const plan = await planRobotsTxt(requestFrom("nes.pages.dev"));
    expect(plan.hostClass).toBe("alias");
    expect(plan.indexable).toBe(false);
    expect(plan.body).toContain("Disallow: /");
    expect(plan.body).not.toContain("Allow: /");
    expect(plan.body).not.toContain("Sitemap:");
  });

  it("blocks local dev and editor previews", async () => {
    for (const host of ["localhost", "id-preview--abc.example"]) {
      const plan = await planRobotsTxt(requestFrom(host));
      expect(plan.hostClass, host).toBe("editor");
      expect(plan.body, host).toContain("Disallow: /");
      expect(plan.body, host).not.toContain("Sitemap:");
    }
  });

  it("fails closed on a host no tenant claimed", async () => {
    const plan = await planRobotsTxt(requestFrom("squatter.example"));
    expect(plan.hostClass).toBe("unknown");
    expect(plan.indexable).toBe(false);
    expect(plan.volatile).toBe(false);
    expect(plan.body).toContain("Disallow: /");
  });

  it("marks the answer volatile when the directory could not be read", async () => {
    // Pusty/nieosiągalny katalog to "nie wiem", nie "obcy host" - odpowiedź
    // nie może wylądować w cache CDN na pół godziny.
    state.rows = [];
    const plan = await planRobotsTxt(requestFrom("staging.example"));
    expect(plan.hostClass).toBe("unknown");
    expect(plan.volatile).toBe(true);
  });

  it("has no host to classify when the header pair is empty", async () => {
    const plan = await planRobotsTxt(new Request("https://edge.invalid/robots.txt"));
    expect(plan.indexable).toBe(false);
    expect(plan.body).toContain("Disallow: /");
  });
});
