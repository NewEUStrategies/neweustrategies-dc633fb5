import { describe, expect, it, vi, beforeEach } from "vitest";

const gatewayFetch = vi.fn();

vi.mock("@/lib/stripe.server", () => ({ gatewayFetch }));

const planRows = [
  {
    tier_key: "member",
    interval: "month",
    price_cents: 4900,
    currency: "PLN",
    name_pl: "Plus",
    name_en: "Plus",
    description_pl: null,
    active: true,
  },
  {
    tier_key: "business",
    interval: "two_weeks",
    price_cents: 59000,
    currency: "PLN",
    name_pl: "Partner Biznesowy",
    name_en: "Business Partner",
    description_pl: null,
    active: true,
  },
  {
    tier_key: "business",
    interval: "quarter",
    price_cents: 249000,
    currency: "PLN",
    name_pl: "Partner Biznesowy",
    name_en: "Business Partner",
    description_pl: null,
    active: true,
  },
];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({ select: () => Promise.resolve({ data: planRows, error: null }) }),
  },
}));

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => "" }) as Response;

describe("syncPaddleCatalog", () => {
  beforeEach(() => gatewayFetch.mockReset());

  it("tworzy brakujący produkt i cenę dla planu z bazy", async () => {
    gatewayFetch.mockImplementation((...args: unknown[]) => {
      const path = (args.find((a) => typeof a === "string" && a.startsWith("/")) ?? "") as string;
      const init = args.find((a) => typeof a === "object" && a !== null) as RequestInit | undefined;
      if (path.startsWith("/products?")) return Promise.resolve(ok({ data: [] }));
      if (path.startsWith("/prices?")) return Promise.resolve(ok({ data: [] }));
      if (path === "/products" && init?.method === "POST")
        return Promise.resolve(ok({ data: { id: "pro_1" } }));
      if (path === "/prices" && init?.method === "POST")
        return Promise.resolve(ok({ data: { id: "pri_1" } }));
      return Promise.resolve(ok({ data: [] }));
    });

    const { syncPaddleCatalog } = await import("../paddleCatalogSync.server");
    const report = await syncPaddleCatalog("sandbox");

    const plus = report.items.find((i) => i.priceId === "plus_monthly");
    expect(plus?.product).toBe("created");
    expect(plus?.price).toBe("created");
    // Plany bez odpowiednika w access_plans są pomijane, nie zgadujemy kwoty.
    expect(report.items.find((i) => i.priceId === "pro_monthly")?.price).toBe("skipped");
  });

  it("mapuje interwały aplikacji na cykle operatora (two_weeks -> week x2, quarter -> month x3)", async () => {
    const priceBodies: Array<Record<string, unknown>> = [];
    gatewayFetch.mockImplementation((...args: unknown[]) => {
      const path = (args.find((a) => typeof a === "string" && a.startsWith("/")) ?? "") as string;
      const init = args.find((a) => typeof a === "object" && a !== null) as RequestInit | undefined;
      if (path.startsWith("/products?")) return Promise.resolve(ok({ data: [] }));
      if (path.startsWith("/prices?")) return Promise.resolve(ok({ data: [] }));
      if (path === "/products" && init?.method === "POST")
        return Promise.resolve(ok({ data: { id: "pro_1" } }));
      if (path === "/prices" && init?.method === "POST") {
        priceBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return Promise.resolve(ok({ data: { id: "pri_1" } }));
      }
      return Promise.resolve(ok({ data: [] }));
    });

    const { syncPaddleCatalog } = await import("../paddleCatalogSync.server");
    await syncPaddleCatalog("sandbox");

    const byExternalId = (id: string) =>
      priceBodies.find(
        (b) => (b.custom_data as Record<string, unknown> | undefined)?.external_id === id,
      );
    expect(byExternalId("business_2w")?.billing_cycle).toEqual({
      interval: "week",
      frequency: 2,
    });
    expect(byExternalId("business_quarterly")?.billing_cycle).toEqual({
      interval: "month",
      frequency: 3,
    });
    expect(byExternalId("plus_monthly")?.billing_cycle).toEqual({
      interval: "month",
      frequency: 1,
    });
  });

  it("koryguje rozjechaną kwotę istniejącej ceny", async () => {
    gatewayFetch.mockImplementation((...args: unknown[]) => {
      const path = (args.find((a) => typeof a === "string" && a.startsWith("/")) ?? "") as string;
      const init = args.find((a) => typeof a === "object" && a !== null) as RequestInit | undefined;
      if (path.startsWith("/products?")) return Promise.resolve(ok({ data: [{ id: "pro_1" }] }));
      if (path.startsWith("/prices?"))
        return Promise.resolve(
          ok({ data: [{ id: "pri_1", unit_price: { amount: "1900", currency_code: "PLN" } }] }),
        );
      if (path === "/prices/pri_1" && init?.method === "PATCH") return Promise.resolve(ok({}));
      return Promise.resolve(ok({ data: [] }));
    });

    const { syncPaddleCatalog } = await import("../paddleCatalogSync.server");
    const report = await syncPaddleCatalog("sandbox");
    expect(report.items.find((i) => i.priceId === "plus_monthly")?.price).toBe("updated");
  });
});
