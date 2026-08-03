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
    /** Wynik awaitowanego zapisu (`insert`/`update`/`upsert`). */
    writeResult: { data: unknown; error: unknown };
    calls: { method: string; args: unknown[] }[];
  } = { maybeSingleQueue: [], writeResult: { data: null, error: null }, calls: [] };
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
  chain.then = (onF: any, onR: any) => Promise.resolve(state.writeResult).then(onF, onR);
  return { state, chain };
});

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: h.chain }));

import {
  grantEntitlement,
  revokeOrderEntitlement,
  revokeSubscriptionEntitlement,
  type GrantableOrder,
  type RevocableOrder,
} from "@/lib/billing/grant.server";

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
    h.state.writeResult = { data: null, error: null };
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

  it("brakujacy wiersz planu degraduje do domyslnego interwalu (plan?.interval ?? null)", async () => {
    // 1st maybeSingle: lookup planu zwraca pusto (plan usuniety/rozjazd id) -
    // grant nie moze sie wywrocic; periodEndFor(null) daje bezpieczny default.
    h.state.maybeSingleQueue = [
      { data: null, error: null },
      { data: null, error: null },
    ];

    await grantEntitlement(subOrder, "sub_defaults");

    const insert = find("insert");
    expect(insert).toBeTruthy();
    const row = insert!.args[0] as Record<string, unknown>;
    expect(row.status).toBe("active");
    // Domyslny okres jest skonczonym, przyszlym terminem (nie lifetime-null).
    expect(typeof row.current_period_end).toBe("string");
    expect(new Date(row.current_period_end as string).getTime()).toBeGreaterThan(Date.now());
  });

  it("plan lifetime (one_time + plan_id, bez encji) pomija lookup interwalu i zapisuje bez wygasania", async () => {
    // Galaz `!entitlement.lifetime` == false: zero zapytan o access_plans,
    // current_period_end zostaje NULL (has_content_access: nigdy nie wygasa).
    const lifetimeOrder: GrantableOrder = {
      ...subOrder,
      id: "ord_life",
      kind: "one_time",
      plan_id: "plan_life",
      entity_type: null,
      entity_id: null,
    };
    // Jedyny maybeSingle to sprawdzenie istniejacej subskrypcji.
    h.state.maybeSingleQueue = [{ data: null, error: null }];

    await grantEntitlement(lifetimeOrder, "cs_lifetime_1");

    expect(tables()).not.toContain("access_plans");
    const insert = find("insert");
    expect(insert).toBeTruthy();
    const row = insert!.args[0] as Record<string, unknown>;
    expect(row.status).toBe("active");
    expect(row.current_period_end).toBeNull();
    expect(row.external_ref).toBe("cs_lifetime_1");
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

  // Zamówienie po anonimizacji (konto usunięte, dowód księgowy został -
  // migracja 20260803090000). Nie ma komu nadać dostępu, a webhook operatora
  // MUSI dostać 200: rzucenie skazałoby go na wieczne ponowienia na wierszu,
  // który nigdy już nie odzyska właściciela.
  it("pomija grant dla zanonimizowanego zamówienia (user_id NULL) bez rzucania", async () => {
    await grantEntitlement({ ...subOrder, user_id: null }, "sub_anon");
    expect(h.state.calls).toHaveLength(0);
  });

  it("pomija grant zakupu jednorazowego, gdy zamówienie stracilo właściciela", async () => {
    await grantEntitlement({ ...oneTimeOrder, user_id: null }, "ord_anon");
    expect(h.state.calls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Kontrakt: KAŻDA porażka bazy musi rzucić. Webhook Stripe opiera na tym
  // zabezpieczenie "grant-before-flip" - wyjątek staje się odpowiedzią 500,
  // po której Stripe ponawia dostawę. Gdyby grant tylko zgubił `error`,
  // handler zaksięgowałby zamówienie jako `paid` i odpowiedział 200: klient
  // obciążony, bez uprawnienia i bez ponowienia.
  // -------------------------------------------------------------------------
  describe("propagacja błędów bazy", () => {
    const dbErr = { message: "rls_denied" };

    it("rzuca, gdy lookup planu ZAWIÓDŁ (w odróżnieniu od braku wiersza)", async () => {
      h.state.maybeSingleQueue = [{ data: null, error: dbErr }];
      await expect(grantEntitlement(subOrder, "sub_e1")).rejects.toThrow(/access_plans/);
      // Nic nie zostało zapisane - brak zgadywania okresu rozliczeniowego.
      expect(find("insert")).toBeFalsy();
      expect(find("update")).toBeFalsy();
    });

    it("rzuca, gdy sprawdzenie istniejącej subskrypcji ZAWIODŁO", async () => {
      // Gdyby to przemilczeć, `existing` byłoby null i kod poszedłby w INSERT,
      // który przy unikalnym `external_ref` też by padł - grant przepadłby cały.
      h.state.maybeSingleQueue = [
        { data: { interval: "month" }, error: null },
        { data: null, error: dbErr },
      ];
      await expect(grantEntitlement(subOrder, "sub_e2")).rejects.toThrow(/user_subscriptions/);
      expect(find("insert")).toBeFalsy();
    });

    it("rzuca, gdy odświeżenie istniejącej subskrypcji padło", async () => {
      h.state.maybeSingleQueue = [
        { data: { interval: "month" }, error: null },
        { data: { id: "sub_row_9" }, error: null },
      ];
      h.state.writeResult = { data: null, error: dbErr };
      await expect(grantEntitlement(subOrder, "sub_e3")).rejects.toThrow(/refresh failed/);
    });

    it("rzuca, gdy INSERT subskrypcji padł", async () => {
      h.state.maybeSingleQueue = [
        { data: { interval: "month" }, error: null },
        { data: null, error: null },
      ];
      h.state.writeResult = { data: null, error: dbErr };
      await expect(grantEntitlement(subOrder, "sub_e4")).rejects.toThrow(/insert failed/);
    });

    it("rzuca, gdy UPSERT zakupu jednorazowego padł", async () => {
      h.state.writeResult = { data: null, error: dbErr };
      await expect(grantEntitlement(oneTimeOrder, "ord_e5")).rejects.toThrow(/user_purchases/);
    });

    it("komunikat błędu niesie identyfikator, po którym da się odtworzyć grant", async () => {
      h.state.maybeSingleQueue = [
        { data: { interval: "month" }, error: null },
        { data: null, error: null },
      ];
      h.state.writeResult = { data: null, error: dbErr };
      await expect(grantEntitlement(subOrder, "sub_traceable")).rejects.toThrow(
        /sub_traceable.*rls_denied/,
      );
    });
  });
});

// Lustro grantów: zwrot/chargeback musi trafić dokładnie w rekord, który nadał
// dostęp (ten sam external_ref / klucz user+encja) i ustawić `refunded` - nie
// `canceled` - żeby raporty odróżniały rezygnację od zwrotu pieniędzy.
describe("revokeSubscriptionEntitlement", () => {
  beforeEach(() => {
    h.state.calls = [];
    h.state.maybeSingleQueue = [];
    h.state.writeResult = { data: null, error: null };
  });

  it("ustawia refunded po external_ref i zwraca true, gdy trafiła jakikolwiek wiersz", async () => {
    h.state.writeResult = { data: [{ id: "sub_row_1" }], error: null };

    const revoked = await revokeSubscriptionEntitlement("sub_999", "2026-08-01T00:00:00.000Z");

    expect(revoked).toBe(true);
    expect(tables()).toEqual(["user_subscriptions"]);
    const patch = find("update")!.args[0] as Record<string, unknown>;
    expect(patch.status).toBe("refunded");
    expect(patch.current_period_end).toBe("2026-08-01T00:00:00.000Z");
    expect(patch.canceled_at).toBe("2026-08-01T00:00:00.000Z");
    expect(find("eq")?.args).toEqual(["external_ref", "sub_999"]);
    // Idempotencja: już zrefundowane wiersze zostają nietknięte.
    expect(find("neq")?.args).toEqual(["status", "refunded"]);
  });

  it("zwraca false, gdy nic nie odebrano (brak wiersza pod external_ref)", async () => {
    h.state.writeResult = { data: [], error: null };
    await expect(revokeSubscriptionEntitlement("sub_missing")).resolves.toBe(false);
  });

  it("toleruje null w data (zero wierszy) i domyślny znacznik czasu", async () => {
    h.state.writeResult = { data: null, error: null };
    await expect(revokeSubscriptionEntitlement("sub_null")).resolves.toBe(false);
    const patch = find("update")!.args[0] as Record<string, unknown>;
    // Domyślny revokedAt = teraz (ISO); wystarczy poprawny, świeży timestamp.
    expect(typeof patch.current_period_end).toBe("string");
    expect(
      Math.abs(new Date(patch.current_period_end as string).getTime() - Date.now()),
    ).toBeLessThan(60_000);
  });

  it("rzuca z identyfikatorem, gdy UPDATE padł (webhook musi dostać 500 i ponowić)", async () => {
    h.state.writeResult = { data: null, error: { message: "rls_denied" } };
    await expect(revokeSubscriptionEntitlement("sub_e1")).rejects.toThrow(/sub_e1.*rls_denied/);
  });
});

describe("revokeOrderEntitlement", () => {
  beforeEach(() => {
    h.state.calls = [];
    h.state.maybeSingleQueue = [];
    h.state.writeResult = { data: null, error: null };
  });

  const subRevocable: RevocableOrder = {
    id: "ord_sub",
    user_id: "user_1",
    kind: "subscription",
    plan_id: "plan_1",
    entity_type: null,
    entity_id: null,
  };

  const purchaseRevocable: RevocableOrder = {
    id: "ord_buy",
    user_id: "user_2",
    kind: "one_time",
    plan_id: null,
    entity_type: "post",
    entity_id: "post_1",
  };

  it("zamówienie planu cofa wiersz user_subscriptions po external_ref = id zamówienia", async () => {
    await revokeOrderEntitlement(subRevocable, "2026-08-01T00:00:00.000Z");

    expect(tables()).toEqual(["user_subscriptions"]);
    const patch = find("update")!.args[0] as Record<string, unknown>;
    expect(patch.status).toBe("refunded");
    expect(patch.current_period_end).toBe("2026-08-01T00:00:00.000Z");
    expect(find("eq")?.args).toEqual(["external_ref", "ord_sub"]);
    expect(find("neq")?.args).toEqual(["status", "refunded"]);
  });

  it("jednorazowy zakup planu (lifetime) też cofa się po ścieżce subskrypcyjnej", async () => {
    await revokeOrderEntitlement({ ...subRevocable, id: "ord_life", kind: "one_time" });
    expect(tables()).toEqual(["user_subscriptions"]);
    expect(find("eq")?.args).toEqual(["external_ref", "ord_life"]);
  });

  it("zakup jednorazowy cofa wiersz user_purchases po kluczu user+encja", async () => {
    await revokeOrderEntitlement(purchaseRevocable);

    expect(tables()).toEqual(["user_purchases"]);
    const patch = find("update")!.args[0] as Record<string, unknown>;
    expect(patch).toEqual({ status: "refunded" });
    const eqs = h.state.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual([
      ["user_id", "user_2"],
      ["entity_type", "post"],
      ["entity_id", "post_1"],
    ]);
    expect(find("neq")?.args).toEqual(["status", "refunded"]);
  });

  it("niekompletne zamówienie (bez planu i encji) nie dotyka bazy", async () => {
    await revokeOrderEntitlement({ ...subRevocable, id: "ord_x", plan_id: null });
    expect(h.state.calls).toHaveLength(0);
  });

  // Po usunięciu konta `user_purchases` znika kaskadą, a zamówienie zostaje
  // jako dowód księgowy z `user_id = NULL`. Zwrot musi przestawić status
  // zamówienia (robi to refunds.server), ale nie ma czego odbierać.
  it("zanonimizowany zakup jednorazowy nie próbuje cofać user_purchases", async () => {
    await revokeOrderEntitlement({ ...purchaseRevocable, user_id: null });
    expect(h.state.calls).toHaveLength(0);
  });

  it("zanonimizowane zamówienie planu wciąż cofa się po external_ref (klucz nie zależy od usera)", async () => {
    await revokeOrderEntitlement({ ...subRevocable, user_id: null });
    expect(tables()).toEqual(["user_subscriptions"]);
    expect(find("eq")?.args).toEqual(["external_ref", "ord_sub"]);
  });

  it("rzuca, gdy cofnięcie subskrypcji padło", async () => {
    h.state.writeResult = { data: null, error: { message: "rls_denied" } };
    await expect(revokeOrderEntitlement(subRevocable)).rejects.toThrow(
      /user_subscriptions.*ord_sub.*rls_denied/,
    );
  });

  it("rzuca, gdy cofnięcie zakupu padło", async () => {
    h.state.writeResult = { data: null, error: { message: "rls_denied" } };
    await expect(revokeOrderEntitlement(purchaseRevocable)).rejects.toThrow(
      /user_purchases.*ord_buy.*rls_denied/,
    );
  });
});
