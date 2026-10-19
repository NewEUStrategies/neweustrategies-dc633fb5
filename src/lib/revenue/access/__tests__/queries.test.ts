// `queryOptions` inwentarza dostępu (S3, §5.4): klucz z fabryki I0
// (prefiks reguł szyny `rev("access")`), 30 s świeżości, wyłączenie bez najemcy.
import { describe, expect, it, vi } from "vitest";
import { revenueKeys } from "@/lib/revenue/keys";

const h = vi.hoisted(() => ({ getRevenueAccessInventory: vi.fn() }));

vi.mock("@/lib/revenue/access/access.functions", () => ({
  getRevenueAccessInventory: h.getRevenueAccessInventory,
}));

import {
  ACCESS_INVENTORY_STALE_MS,
  revenueAccessInventoryQueryOptions,
} from "@/lib/revenue/access/queries";

describe("revenueAccessInventoryQueryOptions", () => {
  it("klucz = revenueKeys.accessInventory(najemca) pod prefiksem domeny access", () => {
    const options = revenueAccessInventoryQueryOptions("t-1");
    expect(options.queryKey).toEqual(revenueKeys.accessInventory("t-1"));
    expect(options.queryKey.slice(0, 3)).toEqual(revenueKeys.domainTenant("access", "t-1"));
  });

  it("30 s świeżości, jedno ponowienie, bez najemcy wyłączone", async () => {
    expect(ACCESS_INVENTORY_STALE_MS).toBe(30_000);
    expect(revenueAccessInventoryQueryOptions("t-1").staleTime).toBe(30_000);
    expect(revenueAccessInventoryQueryOptions("t-1").retry).toBe(1);
    expect(revenueAccessInventoryQueryOptions(null).enabled).toBe(false);
    h.getRevenueAccessInventory.mockResolvedValue({ state: "forbidden" });
    await (revenueAccessInventoryQueryOptions("t-1").queryFn as () => Promise<unknown>)();
    expect(h.getRevenueAccessInventory).toHaveBeenCalledTimes(1);
  });
});
