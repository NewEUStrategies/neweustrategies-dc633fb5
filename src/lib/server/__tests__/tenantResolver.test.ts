// Host -> tenant resolution contracts (re-audit N5): the CONTENT plane keeps
// the default-tenant fallback, the CRAWLER plane fails closed for unknown
// hosts unless they are previews or no custom domain exists at all.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTenantDirectory,
  invalidateTenantDirectoryCache,
  resolveCrawlerTenantForHost,
  resolveCrawlerTenantIdForHost,
  resolveTenantForHost,
  resolveTenantIdForHost,
} from "@/lib/server/tenant.server";

interface TenantRow {
  id: string;
  slug: string;
  domain: string | null;
  is_default: boolean;
}

const state = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; slug: string; domain: string | null; is_default: boolean }>,
  error: null as { message: string } | null,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        limit: () => Promise.resolve({ data: state.rows, error: state.error }),
      }),
    }),
  },
}));

const NES: TenantRow = { id: "t-nes", slug: "nes", domain: "nes.example", is_default: true };
const TENANT_B: TenantRow = { id: "t-b", slug: "tenant-b", domain: "b.example", is_default: false };

beforeEach(() => {
  invalidateTenantDirectoryCache();
  state.rows = [NES, TENANT_B];
  state.error = null;
});

describe("directory", () => {
  it("indexes domains and finds the default tenant", async () => {
    const dir = await getTenantDirectory();
    expect(dir.byDomain.get("b.example")?.id).toBe("t-b");
    expect(dir.defaultTenant?.id).toBe("t-nes");
  });

  it("single-tenant install without is_default still gets a deterministic fallback", async () => {
    state.rows = [{ ...NES, is_default: false, domain: null }];
    const dir = await getTenantDirectory();
    expect(dir.defaultTenant?.id).toBe("t-nes");
  });
});

describe("content plane (resolveTenantForHost)", () => {
  it("matches an exact domain", async () => {
    await expect(resolveTenantIdForHost("b.example")).resolves.toBe("t-b");
  });

  it("matches the www./apex alias both ways and ignores case + port", async () => {
    await expect(resolveTenantIdForHost("WWW.B.EXAMPLE:8443")).resolves.toBe("t-b");
    state.rows = [NES, { ...TENANT_B, domain: "www.c.example" }];
    invalidateTenantDirectoryCache();
    await expect(resolveTenantIdForHost("c.example")).resolves.toBe("t-b");
  });

  it("falls back to the default tenant for unknown hosts (previews must render)", async () => {
    await expect(resolveTenantIdForHost("unclaimed.example")).resolves.toBe("t-nes");
    await expect(resolveTenantIdForHost(null)).resolves.toBe("t-nes");
  });

  it("returns null when the directory is empty/unavailable", async () => {
    state.rows = [];
    await expect(resolveTenantForHost("b.example")).resolves.toBeNull();
  });
});

describe("crawler plane (resolveCrawlerTenantForHost) - fail closed", () => {
  it("resolves claimed domains exactly like the content plane", async () => {
    await expect(resolveCrawlerTenantIdForHost("b.example")).resolves.toBe("t-b");
    await expect(resolveCrawlerTenantIdForHost("www.nes.example")).resolves.toBe("t-nes");
  });

  it("returns null for an unknown host once any custom domain exists", async () => {
    await expect(resolveCrawlerTenantIdForHost("unclaimed.example")).resolves.toBeNull();
    await expect(resolveCrawlerTenantIdForHost(null)).resolves.toBeNull();
  });

  it("allows the default tenant on preview hosts", async () => {
    await expect(resolveCrawlerTenantIdForHost("localhost:5173")).resolves.toBe("t-nes");
    await expect(resolveCrawlerTenantIdForHost("my-branch.pages.dev")).resolves.toBe("t-nes");
  });

  it("allows the fallback while NO tenant has claimed any domain (bootstrap)", async () => {
    state.rows = [
      { ...NES, domain: null },
      { ...TENANT_B, domain: null },
    ];
    await expect(resolveCrawlerTenantIdForHost("whatever.example")).resolves.toBe("t-nes");
  });

  it("fails closed when the directory is unavailable", async () => {
    state.rows = [];
    await expect(resolveCrawlerTenantForHost("b.example")).resolves.toBeNull();
  });
});

describe("getTenantDirectory - stale-while-revalidate", () => {
  it("po TTL serwuje nieświeży katalog NATYCHMIAST, a odświeżenie biegnie w tle", async () => {
    vi.useFakeTimers();
    try {
      state.rows = [NES];
      const fresh = await getTenantDirectory();
      expect(fresh.byDomain.get("nes.example")?.id).toBe("t-nes");

      // Nowy tenant w bazie + wyjście poza TTL (60 s).
      state.rows = [NES, TENANT_B];
      vi.advanceTimersByTime(61_000);

      // SWR: odpowiedź od ręki ze STAREGO snapshotu - katalog stoi na ścieżce
      // każdego dokumentu przed NES Edge Cache i nie wolno mu blokować TTFB.
      const stale = await getTenantDirectory();
      expect(stale.byDomain.has("b.example")).toBe(false);

      // Odświeżenie w tle domyka się w mikrotaskach zamockowanej bazy -
      // kolejny odczyt widzi już nowy katalog bez dodatkowego round-tripu.
      await vi.advanceTimersByTimeAsync(0);
      const refreshed = await getTenantDirectory();
      expect(refreshed.byDomain.get("b.example")?.id).toBe("t-b");
    } finally {
      vi.useRealTimers();
    }
  });

  it("zimny izolat (brak wpisu) nadal blokuje jednorazowo na pełnym odczycie", async () => {
    state.rows = [NES, TENANT_B];
    const directory = await getTenantDirectory();
    expect(directory.byDomain.get("b.example")?.id).toBe("t-b");
  });
});
