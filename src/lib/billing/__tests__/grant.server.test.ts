import { describe, it, expect, vi, beforeEach } from "vitest";

// grant.server turns a paid order into the row has_content_access() reads:
//   subscription -> user_subscriptions (insert, or refresh an existing external_ref)
//   one_time     -> user_purchases     (upsert on user_id+entity_type+entity_id)
//   incomplete   -> nothing
// We mock the service-role client and assert exactly those writes. The period
// maths itself is unit-tested in entitlement.test.ts; here we assert the grant
// wiring (which table, which columns, idempotency key).
const h = vi.hoisted(() => {
  const state: {
    maybeSingleQueue: { data: unknown; error: unknown }[];
    calls: { method: string; args: unknown[] }[];
  } = { maybeSingleQueue: [], calls: [] };
  const chain: any = {};
  for (const m of ["from", "update", "insert", "upsert", "select", "eq", "neq", "in"]) {
    chain[m] = (...args: unknown[]) => {
      state.calls.push({ method: m, args });
      return chain;
    };
  }
  chain.maybeSingle = () =>
    Promise.resolve(
      state.maybeSingleQueue.length ? state.maybeSingleQueue.shift()! : { data: null, error: null },
    );
  chain.single = chain.maybeSingle;
  chain.then = (onF: any, onR: any) => Promise.resolve({ data: null, error: null }).then(onF, onR);
  return { state, chain };
});

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: h.chain }));

import { grantEntitlement, type GrantableOrder } from "@/lib/billing/grant.server";

const find = (method: string) => h.state.calls.find((c) => c.method === method);
const findLast = (method: string) => h.state.calls.filter((c) => c.method === method).at(-1);
const tables = () => h.state.calls.filter((c) => c.method === "from").map((c) => c.args[0]);

const subOrder: GrantableOrder = {
  id: "ord_1",
  user_id: "user_1",
  tenant_id: "ten_1",
  kind: "subscription",
  plan_id: "plan_1",
  entity_type: null,
  entity_id: null,
  amount_cents: 4900,
  currency: "PLN",
};

const oneTimeOrder: GrantableOrder = {
  id: "ord_2",
  user_id: "user_2",
  tenant_id: "ten_2",
  kind: "one_time",
  plan_id: null,
  entity_type: "post",
  entity_id: "post_1",
  amount_cents: 1500,
  currency: "PLN",
};

describe("grantEntitlement", () => {
  beforeEach(() => {
    h.state.calls = [];
    h.state.maybeSingleQueue = [];
  });

  it("inserts an active subscription when none exists for the external ref", async () => {
    // 1st maybeSingle = plan interval lookup; 2nd = existing-subscription check.
    h.state.maybeSingleQueue = [
      { data: { interval: "year" }, error: null },
      { data: null, error: null },
    ];

    await grantEntitlement(subOrder, "sub_999");

    expect(tables()).toContain("access_plans");
    expect(tables()).toContain("user_subscriptions");
    const insert = find("insert");
    expect(insert).toBeTruthy();
    const row = insert!.args[0] as Record<string, unknown>;
    expect(row.user_id).toBe("user_1");
    expect(row.tenant_id).toBe("ten_1");
    expect(row.plan_id).toBe("plan_1");
    expect(row.status).toBe("active");
    expect(row.external_ref).toBe("sub_999");
    expect(typeof row.current_period_end).toBe("string");
    // A yearly plan grants ~365 days of access.
    const days = (new Date(row.current_period_end as string).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(360);
    // Insert path, not update.
    expect(find("update")).toBeFalsy();
  });

  it("refreshes an existing subscription instead of duplicating it (Stripe replay)", async () => {
    h.state.maybeSingleQueue = [
      { data: { interval: "month" }, error: null },
      { data: { id: "sub_row_1" }, error: null },
    ];

    await grantEntitlement(subOrder, "sub_999");

    const update = find("update");
    expect(update).toBeTruthy();
    const patch = update!.args[0] as Record<string, unknown>;
    expect(patch.status).toBe("active");
    expect(patch.canceled_at).toBeNull();
    expect(typeof patch.current_period_end).toBe("string");
    // The update targets the existing row by id (the last .eq in the chain;
    // earlier .eq calls are the plan lookup and the external_ref existence check).
    expect(findLast("eq")?.args).toEqual(["id", "sub_row_1"]);
    // Refresh path, not insert.
    expect(find("insert")).toBeFalsy();
  });

  it("falls back to the order id as external ref when none is provided", async () => {
    h.state.maybeSingleQueue = [
      { data: { interval: "month" }, error: null },
      { data: null, error: null },
    ];
    await grantEntitlement(subOrder, null);
    const row = find("insert")!.args[0] as Record<string, unknown>;
    expect(row.external_ref).toBe("ord_1");
  });

  it("upserts a one-time purchase keyed on user+entity", async () => {
    await grantEntitlement(oneTimeOrder, "ord_2");

    expect(tables()).toEqual(["user_purchases"]);
    const upsert = find("upsert");
    expect(upsert).toBeTruthy();
    const row = upsert!.args[0] as Record<string, unknown>;
    expect(row.user_id).toBe("user_2");
    expect(row.tenant_id).toBe("ten_2");
    expect(row.entity_type).toBe("post");
    expect(row.entity_id).toBe("post_1");
    expect(row.amount_cents).toBe(1500);
    expect(row.status).toBe("active");
    expect(upsert!.args[1]).toEqual({ onConflict: "user_id,entity_type,entity_id" });
  });

  it("defaults to a one-month window when the plan row is missing", async () => {
    // plan lookup returns no row -> periodEndFor(null) -> one month from now.
    h.state.maybeSingleQueue = [
      { data: null, error: null },
      { data: null, error: null },
    ];
    await grantEntitlement(subOrder, "sub_777");
    const row = find("insert")!.args[0] as Record<string, unknown>;
    const days = (new Date(row.current_period_end as string).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(33);
  });

  it("falls back to amount 0 / PLN when the purchase order carries no amount", async () => {
    await grantEntitlement({ ...oneTimeOrder, amount_cents: null, currency: null }, "ord_3");
    const row = find("upsert")!.args[0] as Record<string, unknown>;
    expect(row.amount_cents).toBe(0);
    expect(row.currency).toBe("PLN");
  });

  it("grants nothing for an incomplete order (no plan and no entity)", async () => {
    const incomplete: GrantableOrder = { ...subOrder, plan_id: null };
    await grantEntitlement(incomplete, "x");
    expect(h.state.calls).toHaveLength(0);
  });
});
