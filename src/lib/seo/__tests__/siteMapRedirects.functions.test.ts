// `getSiteMapRedirects` - reguły przekierowań dla linków tras mapy HTML.
//
// CO DOWODZI: najemca pochodzi z HOSTA żądania (nie z ładunku), dopasowanie to
// samo co w middleware 301 (`matchRedirectForPath`, z prefiksem `/en`), a 410
// i cele na innej domenie nie usuwają linku trasy. Walidator przepuszcza tylko
// ścieżki względne o rozsądnym rozmiarze.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callServerFn, validateServerFnInput } from "@/test/serverFnHarness";
import { buildRedirectIndex, type RedirectRule } from "@/lib/seo/redirects";

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

const h = vi.hoisted(() => ({
  url: "https://neweuropeanstrategies.com/sitemap",
  tenants: { "neweuropeanstrategies.com": "tenant-nes" } as Record<string, string>,
  rules: {} as Record<string, RedirectRule[]>,
  hosts: [] as string[],
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request(h.url),
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantForHost: async (host: string) => {
    h.hosts.push(host);
    const id = h.tenants[host];
    return id ? { id } : null;
  },
}));
vi.mock("@/lib/seo/redirects.server", async () => {
  const { buildRedirectIndex: build } = await import("@/lib/seo/redirects");
  return { getRedirectIndexForTenant: async (id: string) => build(h.rules[id] ?? []) };
});

const { getSiteMapRedirects } = await import("../siteMapRedirects.functions");

const rule = (source_path: string, target_path: string, status_code = 301): RedirectRule => ({
  id: `${source_path}->${target_path}`,
  source_path,
  target_path,
  status_code,
});

function call(paths: string[]) {
  return callServerFn<Record<string, string>>(getSiteMapRedirects, {
    data: { paths },
    context: { supabase: {} as never, userId: "" },
  });
}

beforeEach(() => {
  h.url = "https://neweuropeanstrategies.com/sitemap";
  h.hosts = [];
  h.rules = {
    "tenant-nes": [
      rule("/events", "/wydarzenia"),
      rule("/statut", "/o-nas"),
      rule("/stary-hub", "/", 410),
      rule("/partner", "https://partner.example/strona"),
    ],
  };
});

describe("getSiteMapRedirects", () => {
  it("oddaje cele reguł najemcy z HOSTA żądania", async () => {
    await expect(call(["/events", "/statut", "/blog"])).resolves.toEqual({
      "/events": "/wydarzenia",
      "/statut": "/o-nas",
    });
    expect(h.hosts).toEqual(["neweuropeanstrategies.com"]);
  });

  it("410 i cel na innej domenie nie są „tym samym adresem w drzewie”", async () => {
    await expect(call(["/stary-hub", "/partner"])).resolves.toEqual({});
  });

  it("host bez najemcy (podgląd, obca domena) nie dostaje żadnych reguł", async () => {
    h.url = "https://obca.example/sitemap";
    await expect(call(["/events"])).resolves.toEqual({});
  });

  it("inny najemca na tym samym wdrożeniu ma SWOJE reguły (tu: żadnych)", async () => {
    h.tenants["b.example.org"] = "tenant-b";
    h.url = "https://b.example.org/sitemap";
    await expect(call(["/events", "/statut"])).resolves.toEqual({});
  });

  it("to samo dopasowanie co middleware: reguła z adresu kanonicznego działa pod `/en`", async () => {
    await expect(call(["/en/events"])).resolves.toEqual({ "/en/events": "/en/wydarzenia" });
  });

  it("walidator przyjmuje tylko ścieżki względne bez zapytania, w rozsądnej liczbie", () => {
    expect(() => validateServerFnInput(getSiteMapRedirects, { paths: ["/events"] })).not.toThrow();
    for (const bad of ["events", "https://evil.example/", "/a?b=1", "/a b", "/".repeat(201)]) {
      expect(() => validateServerFnInput(getSiteMapRedirects, { paths: [bad] }), bad).toThrow();
    }
    const many = Array.from({ length: 65 }, (_, i) => `/p${i}`);
    expect(() => validateServerFnInput(getSiteMapRedirects, { paths: many })).toThrow();
  });
});

// Sanity: indeks z prawdziwego budowniczego (atrapa nie omija normalizacji).
it("indeks reguł budowany prawdziwym `buildRedirectIndex`", () => {
  expect(buildRedirectIndex([rule("/events", "/wydarzenia")]).exact.has("/events")).toBe(true);
});
