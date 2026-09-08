import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
  asServerFn,
} from "@/test/serverFnHarness";
import { supabaseFromStub, ok, fail } from "@/test/supabase";

const h = vi.hoisted(() => ({
  catalog: vi.fn(),
  direction: vi.fn(),
  syncCatalog: vi.fn(),
  resolvePrice: vi.fn(),
  change: vi.fn(),
  cancel: vi.fn(),
  unpause: vi.fn(),
  revertCancellation: vi.fn(),
  seats: vi.fn(),
  discount: vi.fn(),
  sync: vi.fn(),
  paymentMethod: vi.fn(),
  portal: vi.fn(),
  retrieve: vi.fn(),
  preview: vi.fn(),
  createClient: vi.fn(),
  returnUrl: vi.fn(),
}));
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/lib/billing/catalog", () => ({
  catalogEntryByPriceId: h.catalog,
  planChangeDirection: h.direction,
}));
vi.mock("@/lib/billing/catalogAutoSync.server", () => ({ ensureCatalogSynced: h.syncCatalog }));
vi.mock("@/lib/billing/subscriptionProvider.server", () => ({
  resolveProviderPriceId: h.resolvePrice,
  changeSubscriptionPrice: h.change,
  cancelSubscriptionAtPeriodEnd: h.cancel,
  resumePausedSubscription: h.unpause,
  resumeScheduledCancellation: h.revertCancellation,
  updateSubscriptionQuantity: h.seats,
}));
vi.mock("@/lib/billing/discounts.server", () => ({ resolveDiscountForCoupon: h.discount }));
vi.mock("@/lib/billing/selfSync.server", () => ({ syncUserSubscriptionsFromProvider: h.sync }));
vi.mock("@/lib/billing/paymentMethod.server", () => ({
  fetchPaymentMethodPreview: h.paymentMethod,
}));
vi.mock("@/lib/billing/returnUrl.server", () => ({ absoluteReturnUrl: h.returnUrl }));
vi.mock("@/lib/stripe.server", () => ({
  createStripeClient: h.createClient,
  getStripeErrorMessage: () => "provider unavailable",
}));
import * as payments from "@/utils/payments.functions";

const db = supabaseFromStub();
const context = { supabase: { from: db.from }, userId: "caller-from-session" };
const sub = {
  provider_subscription_id: "sub_own",
  provider_customer_id: "cus_own",
  price_id: "old_plan",
  status: "active",
  quantity: 3,
};
const input = { environment: "sandbox", targetPriceId: "new_plan", quantity: 5 };
const protectedFns = [
  "changeStripePlan",
  "createStripePortalSession",
  "cancelStripeSubscription",
  "resumeStripeSubscription",
  "previewStripePlanChange",
  "updateStripeSubscriptionSeats",
  "syncMyBillingFromProvider",
  "getMyPaymentMethod",
] as const;
const invoke = (name: keyof typeof payments, data: unknown = input) =>
  callServerFn(payments[name], { data, context });
beforeEach(() => {
  vi.resetAllMocks();
  db.reset();
  db.setResponse("subscriptions", ok(sub));
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.catalog.mockReturnValue({ priceId: "new_plan", perSeat: true });
  h.direction.mockReturnValue("upgrade");
  h.syncCatalog.mockResolvedValue(undefined);
  h.resolvePrice.mockResolvedValue("price_resolved");
  for (const fn of [h.change, h.cancel, h.unpause, h.revertCancellation])
    fn.mockResolvedValue({ ok: true });
  h.seats.mockResolvedValue({ ok: true, quantity: 5 });
  h.sync.mockResolvedValue({ synced: 2 });
  h.paymentMethod.mockResolvedValue({ brand: "visa", last4: "4242" });
  h.discount.mockResolvedValue({ discountId: "promo_valid" });
  h.portal.mockResolvedValue({ url: "https://billing.stripe.test/session" });
  h.returnUrl.mockReturnValue("https://example.test/account");
  h.retrieve.mockResolvedValue({ items: { data: [{ id: "si_own" }] } });
  h.preview.mockResolvedValue({
    amount_due: 2300,
    currency: "pln",
    next_payment_attempt: 1_800_000_000,
  });
  h.createClient.mockReturnValue({
    billingPortal: { sessions: { create: h.portal } },
    subscriptions: { retrieve: h.retrieve },
    invoices: { createPreview: h.preview },
  });
});
afterEach(() => vi.restoreAllMocks());

describe("payment server function boundaries", () => {
  it.each(protectedFns)(
    "%s declares session authentication, validates environment and strips forged ownership",
    async (name) => {
      expect(serverFnMiddlewareNames(payments[name])).toEqual(["requireSupabaseAuth"]);
      expect(asServerFn(payments[name]).method).toBe("POST");
      expect(
        validateServerFnInput(payments[name], {
          ...input,
          userId: "victim",
          provider_subscription_id: "sub_victim",
        }),
      ).not.toHaveProperty("userId");
      await expect(invoke(name, { ...input, environment: "production" })).rejects.toThrow();
      expect(db.chains).toHaveLength(0);
    },
  );
  it.each(protectedFns)(
    "%s scopes reads to the session user and selected environment",
    async (name) => {
      if (name === "syncMyBillingFromProvider" || name === "getMyPaymentMethod")
        db.setResponse("subscriptions", ok([sub]));
      await invoke(name, { ...input, userId: "victim", environment: "live" });
      const chain = db.lastChain("subscriptions")!;
      expect(chain.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
        ["user_id", "caller-from-session"],
        ["environment", "live"],
      ]);
      expect(chain.argsOf("order")).toEqual(["created_at", { ascending: false }]);
      expect(chain.argsOf("limit")).toEqual([name === "syncMyBillingFromProvider" ? 10 : 1]);
    },
  );
  it.each(protectedFns)(
    "%s propagates database failure before reaching the provider",
    async (name) => {
      db.setResponse("subscriptions", fail("RLS read failed"));
      await expect(invoke(name)).rejects.toThrow("RLS read failed");
      expect(h.createClient).not.toHaveBeenCalled();
      expect(h.change).not.toHaveBeenCalled();
      expect(h.sync).not.toHaveBeenCalled();
    },
  );
  it.each([
    "changeStripePlan",
    "cancelStripeSubscription",
    "resumeStripeSubscription",
    "previewStripePlanChange",
    "updateStripeSubscriptionSeats",
  ] as const)("%s refuses a missing subscription", async (name) => {
    for (const missing of [null, { ...sub, provider_subscription_id: null }]) {
      db.setResponse("subscriptions", ok(missing));
      await expect(invoke(name)).rejects.toThrow("no_active_subscription");
    }
  });
  it.each(["changeStripePlan", "previewStripePlanChange"] as const)(
    "%s refuses an unknown target before reading subscriptions",
    async (name) => {
      h.catalog.mockReturnValue(undefined);
      await expect(invoke(name)).rejects.toThrow("unknown_price");
      expect(db.chains).toHaveLength(0);
    },
  );
  it.each([0, -1, 501, 1.5, "5"])(
    "rejects invalid seat quantity %s before database access",
    async (quantity) => {
      await expect(
        invoke("updateStripeSubscriptionSeats", { ...input, quantity }),
      ).rejects.toThrow();
      expect(db.chains).toHaveLength(0);
    },
  );
});

describe("catalog and discount resolution", () => {
  it("allows anonymous price lookup, synchronizes first and returns the resolved provider id", async () => {
    expect(serverFnMiddlewareNames(payments.resolveStripePrice)).toEqual([]);
    expect(asServerFn(payments.resolveStripePrice).method).toBe("GET");
    expect(await invoke("resolveStripePrice", { priceId: "lookup_key", environment: "live" })).toBe(
      "price_resolved",
    );
    expect(h.syncCatalog).toHaveBeenCalledWith("live");
    expect(h.resolvePrice).toHaveBeenCalledWith("live", "lookup_key");
    expect(h.syncCatalog.mock.invocationCallOrder[0]).toBeLessThan(
      h.resolvePrice.mock.invocationCallOrder[0],
    );
  });
  it("attempts resolution after a logged catalog sync failure, and rejects a missing price", async () => {
    h.syncCatalog.mockRejectedValue(new Error("sync offline"));
    h.resolvePrice.mockResolvedValue(null);
    await expect(
      invoke("resolveStripePrice", { priceId: "missing", environment: "sandbox" }),
    ).rejects.toThrow("price_not_found");
    expect(console.error).toHaveBeenCalledWith(
      "[payments] auto-sync check failed",
      expect.any(Error),
    );
  });
  it.each(["", "a".repeat(65)])("rejects an invalid price lookup key", async (priceId) => {
    await expect(
      invoke("resolveStripePrice", { priceId, environment: "sandbox" }),
    ).rejects.toThrow();
    expect(h.syncCatalog).not.toHaveBeenCalled();
  });
  it("normalizes a coupon without accepting caller-supplied ownership or provider ids", async () => {
    const coupon = {
      code: " SUMMER ",
      planId: "00000000-0000-4000-8000-000000000001",
      amountCents: 1000,
      currency: " pln ",
      environment: "sandbox",
    };
    expect(await invoke("resolveStripeDiscount", { ...coupon, userId: "victim" })).toEqual({
      discountId: "promo_valid",
    });
    expect(h.discount).toHaveBeenCalledWith({ ...coupon, code: "SUMMER", currency: "PLN" });
    expect(serverFnMiddlewareNames(payments.resolveStripeDiscount)).toEqual([]);
    await expect(invoke("resolveStripeDiscount", { ...coupon, amountCents: 0 })).rejects.toThrow();
  });
});

describe("plan changes and seats", () => {
  it("does not contact the provider when the plan is unchanged", async () => {
    h.direction.mockReturnValue("same");
    expect(await invoke("changeStripePlan")).toEqual({ ok: true, direction: "same" });
    expect(h.change).not.toHaveBeenCalled();
  });
  it.each(["upgrade", "downgrade"])(
    "passes the %s direction and preserves purchased quantity",
    async (direction) => {
      h.direction.mockReturnValue(direction);
      expect(await invoke("changeStripePlan")).toEqual({ ok: true, direction });
      expect(h.change).toHaveBeenCalledWith("sandbox", "sub_own", {
        newPriceExternalId: "new_plan",
        quantity: 3,
        direction,
      });
    },
  );
  it("uses one seat for a legacy null quantity and returns the provider error", async () => {
    db.setResponse("subscriptions", ok({ ...sub, quantity: null }));
    h.change.mockResolvedValue({ ok: false, error: "declined" });
    expect(await invoke("changeStripePlan")).toEqual({ error: "declined" });
    expect(h.change.mock.calls[0][2].quantity).toBe(1);
  });
  it.each([undefined, { priceId: "flat", perSeat: false }])(
    "refuses a non-seat plan",
    async (entry) => {
      h.catalog.mockReturnValue(entry);
      await expect(invoke("updateStripeSubscriptionSeats")).rejects.toThrow("not_per_seat_plan");
      expect(h.seats).not.toHaveBeenCalled();
    },
  );
  it.each([
    { old: 3, next: 5, immediate: true },
    { old: 3, next: 2, immediate: false },
    { old: null, next: 1, immediate: false },
  ])("seat transition $old → $next reports timing correctly", async ({ old, next, immediate }) => {
    db.setResponse("subscriptions", ok({ ...sub, quantity: old }));
    h.seats.mockResolvedValue({ ok: true, quantity: next });
    expect(await invoke("updateStripeSubscriptionSeats", { ...input, quantity: next })).toEqual({
      ok: true,
      quantity: next,
      immediate,
    });
    expect(h.seats).toHaveBeenCalledWith("sandbox", "sub_own", {
      priceExternalId: "new_plan",
      quantity: next,
      previousQuantity: old ?? 1,
    });
  });
  it("does not announce success when a seat update fails", async () => {
    h.seats.mockResolvedValue({ ok: false, error: "declined" });
    expect(await invoke("updateStripeSubscriptionSeats")).toEqual({ error: "declined" });
  });
});

describe("billing portal, cancellation and resumption", () => {
  it.each([null, { provider_customer_id: null }])(
    "returns no_customer without a provider request",
    async (row) => {
      db.setResponse("subscriptions", ok(row));
      expect(await invoke("createStripePortalSession")).toEqual({ error: "no_customer" });
      expect(h.createClient).not.toHaveBeenCalled();
    },
  );
  it("uses the sanitized return URL and the authenticated customer's general portal", async () => {
    expect(
      await invoke("createStripePortalSession", { environment: "live", returnPath: "/account" }),
    ).toEqual({
      url: "https://billing.stripe.test/session",
      overviewUrl: "https://billing.stripe.test/session",
      updatePaymentMethodUrl: null,
      cancelUrl: null,
    });
    expect(h.returnUrl).toHaveBeenCalledWith("/account");
    expect(h.portal).toHaveBeenCalledWith({
      customer: "cus_own",
      return_url: "https://example.test/account",
    });
    expect(h.createClient).toHaveBeenCalledWith("live");
  });
  it("maps a portal provider failure to an actionable error", async () => {
    h.portal.mockRejectedValue(new Error("secret provider detail"));
    expect(await invoke("createStripePortalSession")).toEqual({ error: "provider unavailable" });
  });
  it.each([true, false])("cancel at period end returns provider outcome %s", async (success) => {
    h.cancel.mockResolvedValue(success ? { ok: true } : { ok: false, error: "declined" });
    expect(await invoke("cancelStripeSubscription")).toEqual(
      success ? { ok: true } : { error: "declined" },
    );
    expect(h.cancel).toHaveBeenCalledWith("sandbox", "sub_own");
  });
  it.each([
    { status: "paused", mode: "unpaused", method: "unpause" },
    { status: "active", mode: "cancellation_reverted", method: "revertCancellation" },
  ] as const)(
    "resumes $status using the correct provider operation",
    async ({ status, mode, method }) => {
      db.setResponse("subscriptions", ok({ ...sub, status }));
      expect(await invoke("resumeStripeSubscription")).toEqual({ ok: true, mode });
      expect(h[method]).toHaveBeenCalledWith("sandbox", "sub_own");
      h[method].mockResolvedValue({ ok: false, error: "declined" });
      expect(await invoke("resumeStripeSubscription")).toEqual({ error: "declined" });
    },
  );
});

describe("invoice preview never mutates the subscription", () => {
  it("short-circuits unchanged plans and missing provider prices", async () => {
    h.direction.mockReturnValue("same");
    expect(await invoke("previewStripePlanChange")).toEqual({
      ok: true,
      direction: "same",
      amountCents: null,
      currency: null,
      nextBilledAt: null,
    });
    expect(h.resolvePrice).not.toHaveBeenCalled();
    h.direction.mockReturnValue("upgrade");
    h.resolvePrice.mockResolvedValue(null);
    expect(await invoke("previewStripePlanChange")).toEqual({
      ok: false,
      direction: "upgrade",
      amountCents: null,
      currency: null,
      nextBilledAt: null,
    });
    expect(h.createClient).not.toHaveBeenCalled();
  });
  it.each([
    { direction: "upgrade", quantity: 3, proration: "always_invoice" },
    { direction: "downgrade", quantity: null, proration: "none" },
    { direction: "upgrade", quantity: 0, proration: "always_invoice" },
  ])(
    "previews $direction with quantity $quantity and correct proration",
    async ({ direction, quantity, proration }) => {
      h.direction.mockReturnValue(direction);
      db.setResponse("subscriptions", ok({ ...sub, quantity }));
      expect(await invoke("previewStripePlanChange")).toEqual({
        ok: true,
        direction,
        amountCents: 2300,
        currency: "PLN",
        nextBilledAt: "2027-01-15T08:00:00.000Z",
      });
      expect(h.preview).toHaveBeenCalledWith({
        subscription: "sub_own",
        subscription_details: {
          items: [{ id: "si_own", price: "price_resolved", quantity: Math.max(1, quantity ?? 1) }],
          proration_behavior: proration,
        },
      });
      expect(h.change).not.toHaveBeenCalled();
    },
  );
  it("handles an empty provider item list and absent invoice totals without fabricating zeros", async () => {
    h.retrieve.mockResolvedValue({ items: { data: [] } });
    h.preview.mockResolvedValue({});
    expect(await invoke("previewStripePlanChange")).toEqual({
      ok: true,
      direction: "upgrade",
      amountCents: null,
      currency: null,
      nextBilledAt: null,
    });
    expect(h.preview.mock.calls[0][0].subscription_details.items).toBeUndefined();
  });
  it("returns unavailable preview on provider failure, without attempting a change", async () => {
    h.preview.mockRejectedValue(new Error("offline"));
    expect(await invoke("previewStripePlanChange")).toMatchObject({ ok: false, amountCents: null });
    expect(h.change).not.toHaveBeenCalled();
  });
});

describe("self service sync and payment method", () => {
  it.each([
    null,
    [
      { provider_subscription_id: null },
      { provider_subscription_id: "" },
      { provider_subscription_id: 12 },
      { provider_subscription_id: "sub_own" },
    ],
  ])("syncs only nonempty string ids read under the caller's RLS", async (rows) => {
    db.setResponse("subscriptions", ok(rows));
    expect(await invoke("syncMyBillingFromProvider")).toEqual({ ok: true, synced: 2 });
    expect(h.sync).toHaveBeenCalledWith("sandbox", "caller-from-session", rows ? ["sub_own"] : []);
  });
  it("reports a sync failure without claiming success", async () => {
    db.setResponse("subscriptions", ok([]));
    h.sync.mockRejectedValue(new Error("offline"));
    expect(await invoke("syncMyBillingFromProvider")).toEqual({ error: "provider unavailable" });
  });
  it.each([null, [], [{ provider_customer_id: null }]])(
    "does not request a payment method without an owned customer",
    async (rows) => {
      db.setResponse("subscriptions", ok(rows));
      expect(await invoke("getMyPaymentMethod")).toEqual({ method: null });
      expect(h.paymentMethod).not.toHaveBeenCalled();
    },
  );
  it.each(["sub_own", null])(
    "fetches the authenticated customer's preview, subscription %s",
    async (subscriptionId) => {
      db.setResponse("subscriptions", ok([{ ...sub, provider_subscription_id: subscriptionId }]));
      expect(await invoke("getMyPaymentMethod")).toEqual({
        method: { brand: "visa", last4: "4242" },
      });
      expect(h.paymentMethod).toHaveBeenCalledWith({
        customerId: "cus_own",
        subscriptionId,
        environment: "sandbox",
      });
    },
  );
  it("maps preview failure without exposing provider details", async () => {
    db.setResponse("subscriptions", ok([sub]));
    h.paymentMethod.mockRejectedValue(new Error("secret detail"));
    expect(await invoke("getMyPaymentMethod")).toEqual({ error: "provider unavailable" });
  });
});
