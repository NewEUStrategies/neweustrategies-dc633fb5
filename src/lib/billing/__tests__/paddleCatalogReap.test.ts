import { describe, expect, it, vi, beforeEach } from "vitest";

const gatewayFetch = vi.fn();
vi.mock("@/lib/paddle.server", () => ({ gatewayFetch }));

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => "" }) as Response;

const row = (id: string, externalId: string | null) => ({
  id,
  status: "active",
  custom_data: externalId ? { external_id: externalId } : null,
});

describe("reapOrphanCatalogEntries", () => {
  beforeEach(() => gatewayFetch.mockReset());

  const wire = (prices: unknown[], products: unknown[]) => {
    const patched: string[] = [];
    gatewayFetch.mockImplementation((...args: unknown[]) => {
      const path = (args.find((a) => typeof a === "string" && a.startsWith("/")) ?? "") as string;
      const init = args.find((a) => typeof a === "object" && a !== null) as RequestInit | undefined;
      if (init?.method === "PATCH") {
        patched.push(path);
        return Promise.resolve(ok({ data: {} }));
      }
      if (path.startsWith("/prices?")) return Promise.resolve(ok({ data: prices }));
      if (path.startsWith("/products?")) return Promise.resolve(ok({ data: products }));
      return Promise.resolve(ok({ data: [] }));
    });
    return patched;
  };

  it("archiwizuje naszą cenę i produkt, których nie ma już w źródle", async () => {
    const patched = wire(
      [row("pri_live", "plus_monthly"), row("pri_dead", "donation_once")],
      [row("pro_live", "plan_plus"), row("pro_dead", "plan_donation")],
    );

    const { reapOrphanCatalogEntries } = await import("../paddleCatalogReap.server");
    const reaped = await reapOrphanCatalogEntries({
      env: "sandbox",
      expectedPriceIds: new Set(["plus_monthly"]),
      expectedProductIds: new Set(["plan_plus"]),
    });

    expect(patched).toEqual(["/prices/pri_dead", "/products/pro_dead"]);
    expect(reaped.map((r) => r.externalId)).toEqual(["donation_once", "plan_donation"]);
    expect(reaped[0].reason).toBe("not_in_catalog");
  });

  it("nie rusza pozycji bez naszego znacznika ani spójnego katalogu", async () => {
    const patched = wire(
      [row("pri_manual", null), row("pri_live", "plus_monthly")],
      [row("pro_manual", null), row("pro_live", "plan_plus")],
    );

    const { reapOrphanCatalogEntries } = await import("../paddleCatalogReap.server");
    const reaped = await reapOrphanCatalogEntries({
      env: "sandbox",
      expectedPriceIds: new Set(["plus_monthly"]),
      expectedProductIds: new Set(["plan_plus"]),
    });

    expect(patched).toEqual([]);
    expect(reaped).toEqual([]);
  });

  it("oznacza powód `plan_inactive`, gdy plan jest wyłączony w bazie", async () => {
    wire([row("pri_off", "pro_yearly")], []);

    const { reapOrphanCatalogEntries } = await import("../paddleCatalogReap.server");
    const reaped = await reapOrphanCatalogEntries({
      env: "sandbox",
      expectedPriceIds: new Set<string>(),
      expectedProductIds: new Set<string>(),
      inactivePriceIds: new Set(["pro_yearly"]),
    });

    expect(reaped[0]).toMatchObject({ kind: "price", reason: "plan_inactive" });
  });
});
