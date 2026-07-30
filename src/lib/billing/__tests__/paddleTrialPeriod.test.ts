// Okres próbny planu musi trafić na cenę u operatora - inaczej checkout
// obciąża kartę od razu, mimo `trial_days` w `access_plans`.
import { describe, expect, it, vi, beforeEach } from "vitest";

const gatewayFetch = vi.fn();
vi.mock("@/lib/paddle.server", () => ({ gatewayFetch }));

const planRows = [
  {
    tier_key: "member",
    interval: "month",
    price_cents: 4900,
    currency: "PLN",
    name_pl: "Plus",
    name_en: "Plus",
    description_pl: null,
    trial_days: 14,
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

interface Call {
  path: string;
  init?: RequestInit;
}

function collect(handler: (c: Call) => Response | null): Call[] {
  const calls: Call[] = [];
  gatewayFetch.mockImplementation((...args: unknown[]) => {
    const path = (args.find((a) => typeof a === "string" && a.startsWith("/")) ?? "") as string;
    const init = args.find((a) => typeof a === "object" && a !== null) as RequestInit | undefined;
    calls.push({ path, init });
    return Promise.resolve(handler({ path, init }) ?? ok({ data: [] }));
  });
  return calls;
}

const bodyOf = (call: Call | undefined): Record<string, unknown> =>
  call?.init?.body ? (JSON.parse(String(call.init.body)) as Record<string, unknown>) : {};

describe("okres próbny w katalogu operatora", () => {
  beforeEach(() => gatewayFetch.mockReset());

  it("ustawia trial_period przy tworzeniu ceny", async () => {
    const calls = collect(({ path, init }) => {
      if (path === "/products" && init?.method === "POST") return ok({ data: { id: "pro_1" } });
      if (path === "/prices" && init?.method === "POST") return ok({ data: { id: "pri_1" } });
      return null;
    });

    const { syncPaddleCatalog } = await import("../paddleCatalogSync.server");
    await syncPaddleCatalog("sandbox");

    const create = calls.find((c) => c.path === "/prices" && c.init?.method === "POST");
    expect(bodyOf(create).trial_period).toEqual({ interval: "day", frequency: 14 });
  });

  it("koryguje cenę, gdy u operatora brakuje okresu próbnego", async () => {
    const calls = collect(({ path }) => {
      if (path.startsWith("/products?")) return ok({ data: [{ id: "pro_1" }] });
      if (path.startsWith("/prices?"))
        return ok({
          data: [
            {
              id: "pri_1",
              unit_price: { amount: "4900", currency_code: "PLN" },
              trial_period: null,
            },
          ],
        });
      return null;
    });

    const { syncPaddleCatalog } = await import("../paddleCatalogSync.server");
    const report = await syncPaddleCatalog("sandbox");

    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(bodyOf(patch).trial_period).toEqual({ interval: "day", frequency: 14 });
    expect(report.items.find((i) => i.priceId === "plus_monthly")?.price).toBe("updated");
  });

  it("nie rusza ceny, gdy kwota i trial są zgodne", async () => {
    const calls = collect(({ path }) => {
      if (path.startsWith("/products?")) return ok({ data: [{ id: "pro_1" }] });
      if (path.startsWith("/prices?"))
        return ok({
          data: [
            {
              id: "pri_1",
              unit_price: { amount: "4900", currency_code: "PLN" },
              trial_period: { interval: "day", frequency: 14 },
            },
          ],
        });
      return null;
    });

    const { syncPaddleCatalog } = await import("../paddleCatalogSync.server");
    const report = await syncPaddleCatalog("sandbox");

    expect(calls.some((c) => c.init?.method === "PATCH")).toBe(false);
    expect(report.items.find((i) => i.priceId === "plus_monthly")?.price).toBe("ok");
  });
});
