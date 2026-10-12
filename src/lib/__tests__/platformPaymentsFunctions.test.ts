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
  resume: vi.fn(),
  offered: vi.fn(),
  seats: vi.fn(),
  sync: vi.fn(),
  paymentMethod: vi.fn(),
  portal: vi.fn(),
  portalLink: vi.fn(),
  tenant: vi.fn(),
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
  resumeProviderSubscription: h.resume,
  updateSubscriptionQuantity: h.seats,
}));
// Bramka celu (oferta najemcy) ma własne testy - tu sprawdzamy, ŻE adapter
// karty operatora przez nią przechodzi i z czym.
vi.mock("@/lib/billing/planSwitch.server", () => ({ resolveOfferedSwitchTarget: h.offered }));
vi.mock("@/lib/billing/selfSync.server", () => ({ syncUserSubscriptionsFromProvider: h.sync }));
vi.mock("@/lib/billing/paymentMethod.server", () => ({
  fetchPaymentMethodPreview: h.paymentMethod,
}));
vi.mock("@/lib/billing/returnUrl.server", () => ({ absoluteReturnUrl: h.returnUrl }));
// Sesja portalu ma JEDNĄ implementację (`createPortalLinkForUser`, testowaną
// we własnym pliku) - tu sprawdzamy, że adapter przekazuje do niej tożsamość
// i najemcę z sesji oraz ścieżkę powrotu.
vi.mock("@/lib/billing/portalLink.server", () => ({ createPortalLinkForUser: h.portalLink }));
vi.mock("@/lib/server/userTenant.server", () => ({ resolveUserTenantId: h.tenant }));
vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  // Rozstrzygnięcie środowiska jest PRAWDZIWE - produkcja zawsze na live.
  resolveEnvironment: (await importOriginal<typeof import("@/lib/stripe.server")>())
    .resolveEnvironment,
  getStripeClient: h.createClient,
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
  tenant_id: "tenant-own",
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
/** Funkcje czytające wiersz subskrypcji pod RLS wołającego (portal czyta przez bramkę portalu). */
const subscriptionReaders = protectedFns.filter((name) => name !== "createStripePortalSession");
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
  h.change.mockResolvedValue({ ok: true, direction: "upgrade", effect: "applied" });
  h.cancel.mockResolvedValue({ ok: true });
  h.resume.mockResolvedValue({ ok: true, mode: "cancellation_reverted" });
  h.offered.mockResolvedValue({
    ok: true,
    target: {
      planId: "plan-new",
      tenantId: "tenant-own",
      interval: "month",
      lookupKey: "new_plan",
    },
  });
  h.seats.mockResolvedValue({ ok: true, quantity: 5, effect: "applied" });
  h.sync.mockResolvedValue({ synced: 2 });
  h.paymentMethod.mockResolvedValue({ brand: "visa", last4: "4242" });
  h.portal.mockResolvedValue({ url: "https://billing.stripe.test/session" });
  h.portalLink.mockResolvedValue({
    ok: true,
    urls: {
      overviewUrl: "https://billing.stripe.test/session",
      updatePaymentMethodUrl: null,
      cancelUrl: null,
    },
  });
  h.tenant.mockResolvedValue("tenant-own");
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
  it.each(subscriptionReaders)(
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
  it.each(subscriptionReaders)(
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

describe("catalog resolution", () => {
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
  it("the anonymous coupon-to-provider-discount probe no longer ships", () => {
    // `resolveStripeDiscount` nie mial wywolan w UI, a jako publiczny server fn
    // walidowal kody najemcy DOMYSLNEGO kluczem serwisowym (bez kubelka pudel
    // w bazie) i przy trafieniu zakladal rabat u operatora. Kody planu
    // przechodza wylacznie przez kase (`validate_b2b_coupon_for_user`).
    expect(Object.keys(payments)).not.toContain("resolveStripeDiscount");
  });
});

describe("plan changes and seats", () => {
  it("does not contact the provider when the mirror already has the target price", async () => {
    h.catalog.mockReturnValue({ priceId: "old_plan" });
    expect(await invoke("changeStripePlan")).toEqual({ ok: true, direction: "same" });
    expect(h.change).not.toHaveBeenCalled();
    expect(h.offered).not.toHaveBeenCalled();
  });
  it("checks the target against the SESSION tenant's offer before touching the provider", async () => {
    await invoke("changeStripePlan", { ...input, userId: "victim", tenantId: "tenant-victim" });
    expect(h.offered).toHaveBeenCalledWith({
      userId: "caller-from-session",
      subscriptionTenantId: "tenant-own",
      currentLookupKey: "old_plan",
      target: { lookupKey: "new_plan" },
    });
    expect(h.offered.mock.invocationCallOrder[0]).toBeLessThan(
      h.change.mock.invocationCallOrder[0],
    );
  });
  it.each(["plan_not_found", "plan_not_switchable", "plan_kind_mismatch", "plan_not_recurring"])(
    "an out-of-offer target (%s) is refused and the provider is never called",
    async (error) => {
      // SUB-14: wcześniej wystarczał dowolny lookup_key z katalogu - plan
      // nieaktywny w najemcy, cudzy, `decision_lab_seat`.
      h.offered.mockResolvedValue({ ok: false, error });
      await expect(invoke("changeStripePlan")).rejects.toThrow(error);
      expect(h.change).not.toHaveBeenCalled();
      expect(h.createClient).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["upgrade", "applied"],
    ["downgrade", "scheduled"],
  ])("passes the provider's %s outcome (%s) through", async (direction, effect) => {
    h.change.mockResolvedValue({ ok: true, direction, effect, cancelAtPeriodEnd: false });
    expect(await invoke("changeStripePlan")).toEqual({ ok: true, direction, effect });
    // Kierunek i liczbę miejsc liczy operacja u dostawcy na ŻYWYM stanie -
    // adapter przekazuje wyłącznie zatwierdzony cel z oferty.
    expect(h.change).toHaveBeenCalledWith("sandbox", "sub_own", {
      newPriceExternalId: "new_plan",
    });
  });
  it("returns a declined proration charge with the invoice to pay, never as success", async () => {
    h.change.mockResolvedValue({
      ok: false,
      error: "payment_failed",
      hostedInvoiceUrl: "https://invoice.stripe.test/i/1",
    });
    expect(await invoke("changeStripePlan")).toEqual({
      error: "payment_failed",
      hostedInvoiceUrl: "https://invoice.stripe.test/i/1",
    });
  });
  it("returns any other provider error", async () => {
    h.change.mockResolvedValue({ ok: false, error: "declined" });
    expect(await invoke("changeStripePlan")).toEqual({ error: "declined", hostedInvoiceUrl: null });
  });
  it("production always operates on live, whatever the client asks for", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await invoke("changeStripePlan", { ...input, environment: "sandbox" });
    expect(db.lastChain("subscriptions")!.calls.filter((c) => c.method === "eq")).toContainEqual({
      method: "eq",
      args: ["environment", "live"],
    });
    expect(h.change.mock.calls[0]?.[0]).toBe("live");
    vi.unstubAllEnvs();
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
    { old: 3, next: 5, effect: "applied", immediate: true },
    { old: 3, next: 2, effect: "scheduled", immediate: false },
    // Lustro spóźnione (3), operator ma już 8 - o terminie decyduje OPERATOR.
    { old: 3, next: 5, effect: "scheduled", immediate: false },
    { old: null, next: 1, effect: "applied", immediate: true },
  ])(
    "seat transition $old → $next reports the provider's timing ($effect)",
    async ({ old, next, effect, immediate }) => {
      db.setResponse("subscriptions", ok({ ...sub, quantity: old }));
      h.seats.mockResolvedValue({ ok: true, quantity: next, effect });
      expect(await invoke("updateStripeSubscriptionSeats", { ...input, quantity: next })).toEqual({
        ok: true,
        quantity: next,
        immediate,
        effect,
      });
      expect(h.seats).toHaveBeenCalledWith("sandbox", "sub_own", {
        priceExternalId: "new_plan",
        quantity: next,
        previousQuantity: old ?? 1,
      });
    },
  );
  it("does not announce success when a seat update fails", async () => {
    h.seats.mockResolvedValue({ ok: false, error: "payment_failed", hostedInvoiceUrl: null });
    expect(await invoke("updateStripeSubscriptionSeats")).toEqual({
      error: "payment_failed",
      hostedInvoiceUrl: null,
    });
  });
});

describe("billing portal, cancellation and resumption", () => {
  it("delegates to the single portal implementation with the SESSION identity and tenant", async () => {
    expect(
      await invoke("createStripePortalSession", {
        environment: "live",
        returnPath: "/account",
        userId: "victim",
        tenantId: "tenant-victim",
      }),
    ).toEqual({
      url: "https://billing.stripe.test/session",
      overviewUrl: "https://billing.stripe.test/session",
      updatePaymentMethodUrl: null,
      cancelUrl: null,
    });
    expect(h.tenant).toHaveBeenCalledWith(context.supabase, "caller-from-session");
    // Ścieżka powrotu jedzie dalej - sanityzuje ją `absoluteReturnUrl`
    // wewnątrz `createPortalLinkForUser`, tą samą bramką co wcześniej.
    expect(h.portalLink).toHaveBeenCalledWith(
      "caller-from-session",
      "live",
      { tenantId: "tenant-own" },
      "/account",
    );
    // Żadnej drugiej, równoległej sesji portalu tworzonej w tym pliku.
    expect(h.portal).not.toHaveBeenCalled();
    expect(db.chains).toHaveLength(0);
  });
  it("without a return path the portal implementation applies its default", async () => {
    await invoke("createStripePortalSession", { environment: "sandbox" });
    expect(h.portalLink).toHaveBeenCalledWith(
      "caller-from-session",
      "sandbox",
      { tenantId: "tenant-own" },
      undefined,
    );
  });
  it.each(["no_customer", "portal_failed"])(
    "returns the %s refusal without a session URL",
    async (error) => {
      h.portalLink.mockResolvedValue({ ok: false, error });
      expect(await invoke("createStripePortalSession")).toEqual({ error });
    },
  );
  it("a caller without a tenant never reaches the portal", async () => {
    h.tenant.mockRejectedValue(new Error("No tenant for current user"));
    await expect(invoke("createStripePortalSession")).rejects.toThrow("No tenant for current user");
    expect(h.portalLink).not.toHaveBeenCalled();
  });
  it("production always opens the live portal", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await invoke("createStripePortalSession", { environment: "sandbox" });
    expect(h.portalLink.mock.calls[0]?.[1]).toBe("live");
    vi.unstubAllEnvs();
  });
  it.each([true, false])("cancel at period end returns provider outcome %s", async (success) => {
    h.cancel.mockResolvedValue(success ? { ok: true } : { ok: false, error: "declined" });
    expect(await invoke("cancelStripeSubscription")).toEqual(
      success ? { ok: true } : { error: "declined" },
    );
    expect(h.cancel).toHaveBeenCalledWith("sandbox", "sub_own");
  });
  it.each([
    { provider: "unpaused", mode: "unpaused" },
    { provider: "collection_resumed", mode: "unpaused" },
    { provider: "cancellation_reverted", mode: "cancellation_reverted" },
    { provider: "already_active", mode: "cancellation_reverted" },
  ] as const)(
    "the LIVE provider state decides the mechanism ($provider -> $mode), not the mirror status",
    async ({ provider, mode }) => {
      // Lustro mówi „active" - pauza poboru i status `paused` rozstrzyga operator.
      db.setResponse("subscriptions", ok({ ...sub, status: "active" }));
      h.resume.mockResolvedValue({ ok: true, mode: provider });
      expect(await invoke("resumeStripeSubscription")).toEqual({ ok: true, mode });
      expect(h.resume).toHaveBeenCalledWith("sandbox", "sub_own");
    },
  );
  it("a resume whose invoice was declined stays an error with the invoice to pay", async () => {
    h.resume.mockResolvedValue({
      ok: false,
      error: "payment_failed",
      hostedInvoiceUrl: "https://invoice.stripe.test/i/2",
    });
    expect(await invoke("resumeStripeSubscription")).toEqual({
      error: "payment_failed",
      hostedInvoiceUrl: "https://invoice.stripe.test/i/2",
    });
  });
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
  it("refuses to quote a target outside the tenant's offer", async () => {
    h.offered.mockResolvedValue({ ok: false, error: "plan_not_found" });
    await expect(invoke("previewStripePlanChange")).rejects.toThrow("plan_not_found");
    expect(h.preview).not.toHaveBeenCalled();
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
