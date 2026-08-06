// Polityka robots.txt na granicy host -> tenant.
//
// Dwa findingi, których pilnuje ten plik:
//   1. (2026-08-06) własna domena tenanta dostawała `Disallow: /`, mimo że serwis
//      na niej działa i jej sitemapa odpowiada 200 - robots.txt sam kasował z
//      indeksu cały serwis drugiego tenanta;
//   2. polityka crawlerów AI z ustawień nie trafiała do odpowiedzi w ogóle.
// Plus kontrakt niezawodności: awaria warstwy danych NIE MOŻE zamienić się w
// zakaz crawlowania (Google respektuje podany `Disallow: /` natychmiast).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateTenantDirectoryCache } from "@/lib/server/tenant.server";
import { resolveRobotsPolicy } from "@/lib/server/robotsPolicy.server";
import { AI_TRAINING_CRAWLERS, DEFAULT_SEO_SETTINGS } from "@/lib/seo/settings";
import { CANONICAL_SITE_ORIGIN } from "@/lib/http/host";

interface TenantRow {
  id: string;
  slug: string;
  domain: string | null;
  is_default: boolean;
}

const state = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; slug: string; domain: string | null; is_default: boolean }>,
  directoryError: null as { message: string } | null,
  seoSettings: null as unknown,
  settingsThrows: false,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        limit: () => Promise.resolve({ data: state.rows, error: state.directoryError }),
      }),
    }),
  },
}));

vi.mock("@/lib/server/publishedContent.server", () => ({
  fetchSeoSettingsValue: () => {
    if (state.settingsThrows) throw new Error("settings unavailable");
    return Promise.resolve(state.seoSettings);
  },
}));

const NES: TenantRow = {
  id: "t-nes",
  slug: "nes",
  domain: "neweuropeanstrategies.com",
  is_default: true,
};
const TENANT_B: TenantRow = { id: "t-b", slug: "tenant-b", domain: "b.example", is_default: false };

beforeEach(() => {
  invalidateTenantDirectoryCache();
  state.rows = [NES, TENANT_B];
  state.directoryError = null;
  state.seoSettings = DEFAULT_SEO_SETTINGS;
  state.settingsThrows = false;
});

describe("host kanoniczny marki", () => {
  it("zaprasza do indeksu i ogłasza mapy na originie kanonicznym", async () => {
    const policy = await resolveRobotsPolicy("neweuropeanstrategies.com", "https");
    expect(policy.mode).toBe("canonical");
    expect(policy.origin).toBe(CANONICAL_SITE_ORIGIN);
    expect(policy.sitemapPaths).toEqual(["/sitemap.xml", "/news-sitemap.xml"]);
  });

  it("pomija news sitemap, gdy redakcja ją wyłączyła (inaczej robots wskazuje 404)", async () => {
    state.seoSettings = { ...DEFAULT_SEO_SETTINGS, news_sitemap_enabled: false };
    const policy = await resolveRobotsPolicy("www.neweuropeanstrategies.com", "https");
    expect(policy.sitemapPaths).toEqual(["/sitemap.xml"]);
  });

  it("emituje grupy crawlerów AI zgodnie z ustawieniami tenanta", async () => {
    state.seoSettings = { ...DEFAULT_SEO_SETTINGS, ai_training_crawlers_allowed: false };
    const policy = await resolveRobotsPolicy("neweuropeanstrategies.com", "https");
    for (const agent of AI_TRAINING_CRAWLERS) {
      expect(policy.agentGroups).toContain(`User-agent: ${agent}`);
    }
  });
});

describe("własna domena tenanta", () => {
  it("jest kanoniczna DLA TEGO TENANTA i ogłasza mapy na swoim originie", async () => {
    const policy = await resolveRobotsPolicy("b.example", "https");
    expect(policy.mode).toBe("canonical");
    expect(policy.origin).toBe("https://b.example");
    expect(policy.tenantId).toBe("t-b");
  });

  it("działa też przez alias www./apex", async () => {
    const policy = await resolveRobotsPolicy("www.b.example", "https");
    expect(policy.mode).toBe("canonical");
    expect(policy.origin).toBe("https://www.b.example");
  });
});

describe("hosty niekanoniczne", () => {
  it("zamyka alias hostingu, choćby wpisano go jako domenę tenanta", async () => {
    state.rows = [NES, { ...TENANT_B, domain: "nes.pages.dev" }];
    const policy = await resolveRobotsPolicy("nes.pages.dev", "https");
    expect(policy.mode).toBe("legacy");
    expect(policy.sitemapPaths).toEqual([]);
    expect(policy.agentGroups).toEqual([]);
  });

  it("zamyka hosta lokalnego/podglądowego bez pytania bazy", async () => {
    expect((await resolveRobotsPolicy("127.0.0.1", "http")).mode).toBe("legacy");
    expect((await resolveRobotsPolicy("localhost", "http")).mode).toBe("legacy");
  });

  it("fail-closed dla domeny, której nie zgłosił żaden tenant", async () => {
    const policy = await resolveRobotsPolicy("nieznana.example", "https");
    expect(policy.mode).toBe("unknown");
    expect(policy.sitemapPaths).toEqual([]);
  });

  it("nie zdradza żadnego tenanta na obcym hoście", async () => {
    expect((await resolveRobotsPolicy("nieznana.example", "https")).tenantId).toBeNull();
  });
});

describe("degradacja warstwy danych", () => {
  it("nie deindeksuje serwisu, gdy katalog domen jest nieosiągalny", async () => {
    state.directoryError = { message: "db down" };
    const policy = await resolveRobotsPolicy("nes.example", "https");
    expect(policy.mode).toBe("canonical");
    expect(policy.sitemapPaths).toContain("/sitemap.xml");
  });

  it("instalacja jednotenantowa (brak zajętych domen) indeksuje się normalnie", async () => {
    state.rows = [{ ...NES, domain: null }];
    expect((await resolveRobotsPolicy("nes.example", "https")).mode).toBe("canonical");
  });

  it("przy awarii ustawień zostaje sam indeks mapy i brak ograniczeń per-agent", async () => {
    state.settingsThrows = true;
    const policy = await resolveRobotsPolicy("b.example", "https");
    expect(policy.sitemapPaths).toEqual(["/sitemap.xml"]);
    expect(policy.agentGroups).toEqual([]);
  });

  it("nigdy nie rzuca - robots.txt musi odpowiedzieć zawsze", async () => {
    state.directoryError = { message: "db down" };
    state.settingsThrows = true;
    await expect(resolveRobotsPolicy("b.example", "https")).resolves.toBeTruthy();
  });
});
