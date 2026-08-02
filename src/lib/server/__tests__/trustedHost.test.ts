// Kontrakt zaufanego hosta (audyt: "x-tenant-host wciąż spoofowalny - brak
// trusted-proxy"): mechanizmem zaufania jest walidacja vs tenants.domain na
// krawędzi. Zarejestrowany `Host` (autorytatywny - routuje żądanie) wygrywa
// ze spoofowalnym `X-Forwarded-Host`; XFH jest honorowany wyłącznie w realnym
// łańcuchu proxy (Host originu nie jest domeną tenanta, XFH nią jest);
// nieznany host przy zasiedlonym katalogu = brak wskazówki tenanta (null).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTenantDirectory,
  invalidateTenantDirectoryCache,
  pickTrustedHost,
  resolveTrustedRequestHost,
  type TenantDirectory,
  type TenantDirectoryEntry,
} from "@/lib/server/tenant.server";

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

const NES = { id: "t-nes", slug: "nes", domain: "nes.example", is_default: true };
const TENANT_B = { id: "t-b", slug: "tenant-b", domain: "b.example", is_default: false };

function directoryOf(...domains: string[]): TenantDirectory {
  const byDomain = new Map<string, TenantDirectoryEntry>();
  domains.forEach((domain, i) => {
    byDomain.set(domain, { id: `t-${i}`, slug: `t-${i}`, domain, isDefault: i === 0 });
  });
  return { byDomain, defaultTenant: byDomain.values().next().value ?? null };
}

const POPULATED = directoryOf("nes.example", "b.example");
const EMPTY: TenantDirectory = { byDomain: new Map(), defaultTenant: null };

beforeEach(() => {
  invalidateTenantDirectoryCache();
  state.rows = [NES, TENANT_B];
  state.error = null;
});

describe("pickTrustedHost - trust order", () => {
  it("registered Host wins over a spoofed X-Forwarded-Host (unknown value)", () => {
    expect(pickTrustedHost(POPULATED, "nes.example", "evil.example")).toBe("nes.example");
  });

  it("registered Host wins over an XFH pointing at ANOTHER registered tenant", () => {
    // Scenariusz ataku: przeglądarka na nes.example dokleja XFH b.example -
    // render, cache scope i atrybucja muszą zostać przy nes.example.
    expect(pickTrustedHost(POPULATED, "nes.example", "b.example")).toBe("nes.example");
  });

  it("honors a registered XFH behind a real proxy chain (internal origin Host)", () => {
    expect(pickTrustedHost(POPULATED, "origin.internal", "b.example")).toBe("b.example");
  });

  it("registered XFH beats a preview-suffix origin Host (fronted deployment)", () => {
    expect(pickTrustedHost(POPULATED, "app.workers.dev", "b.example")).toBe("b.example");
  });

  it("returns null for unknown hosts once the directory has claimed domains", () => {
    expect(pickTrustedHost(POPULATED, "unclaimed.example", "also-evil.example")).toBeNull();
    expect(pickTrustedHost(POPULATED, null, null)).toBeNull();
  });

  it("matches the www./apex alias and normalizes case + port", () => {
    expect(pickTrustedHost(POPULATED, "WWW.B.EXAMPLE:8443", null)).toBe("www.b.example");
    expect(pickTrustedHost(POPULATED, null, "NES.EXAMPLE:443")).toBe("nes.example");
  });

  it("allows preview hosts (default-tenant surfaces) when nothing is registered on them", () => {
    expect(pickTrustedHost(POPULATED, "localhost:5173", "evil.example")).toBe("localhost");
    expect(pickTrustedHost(POPULATED, null, "my-branch.pages.dev")).toBe("my-branch.pages.dev");
  });

  it("keeps the legacy XFH ?? Host order while NO domain is claimed (bootstrap)", () => {
    expect(pickTrustedHost(EMPTY, "single.example", null)).toBe("single.example");
    expect(pickTrustedHost(EMPTY, "origin.internal", "single.example")).toBe("single.example");
  });

  it("scans a comma-separated XFH list and picks the first registered entry", () => {
    expect(pickTrustedHost(POPULATED, "origin.internal", "evil.example, b.example")).toBe(
      "b.example",
    );
  });

  it("caps the XFH list so an attacker cannot force unbounded scanning", () => {
    const flood = `${Array.from({ length: 40 }, (_, i) => `h${i}.evil`).join(",")},b.example`;
    // Wpis zarejestrowany za limitem kandydatów NIE jest honorowany.
    expect(pickTrustedHost(POPULATED, "origin.internal", flood)).toBeNull();
  });
});

describe("resolveTrustedRequestHost - request level", () => {
  it("validates the forwarded host against tenants.domain from the directory", async () => {
    // undici wycina zakazany nagłówek `host` z konstruktora Request, więc na
    // poziomie Request testujemy gałąź XFH; priorytet Host pokrywa czysta
    // funkcja pickTrustedHost powyżej.
    await expect(
      resolveTrustedRequestHost(
        new Request("https://b.example/x", { headers: { "x-forwarded-host": "b.example" } }),
      ),
    ).resolves.toBe("b.example");
    await expect(
      resolveTrustedRequestHost(
        new Request("https://b.example/x", { headers: { "x-forwarded-host": "evil.example" } }),
      ),
    ).resolves.toBeNull();
  });

  it("falls back to the legacy order when the directory has no claimed domains", async () => {
    state.rows = [{ ...NES, domain: null }];
    await expect(
      resolveTrustedRequestHost(
        new Request("https://x/", { headers: { "x-forwarded-host": "whatever.example" } }),
      ),
    ).resolves.toBe("whatever.example");
  });

  it("shares the cached tenant directory with the resolvers (no extra round-trips)", async () => {
    await getTenantDirectory();
    state.rows = [];
    // Katalog per-izolat (TTL) - druga odpowiedź nadal z cache, mimo zmiany źródła.
    await expect(
      resolveTrustedRequestHost(
        new Request("https://x/", { headers: { "x-forwarded-host": "b.example" } }),
      ),
    ).resolves.toBe("b.example");
  });
});
