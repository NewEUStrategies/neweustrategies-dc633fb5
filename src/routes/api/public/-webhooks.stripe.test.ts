import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";

function sign(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const hmac = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

// ---------------------------------------------------------------------------
// Signature verification (pure) - exercised directly.
// ---------------------------------------------------------------------------
import { __verifySignatureForTests as verify } from "./webhooks.stripe";

describe("stripe webhook signature", () => {
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

  it("accepts valid signature", () => {
    expect(verify(payload, sign(payload, secret), secret)).toBe(true);
  });

  it("rejects tampered payload", () => {
    const sig = sign(payload, secret);
    expect(verify(payload + "x", sig, secret)).toBe(false);
  });

  it("rejects wrong secret", () => {
    expect(verify(payload, sign(payload, secret), "other")).toBe(false);
  });

  it("rejects stale timestamp", () => {
    const old = Math.floor(Date.now() / 1000) - 60 * 60;
    expect(verify(payload, sign(payload, secret, old), secret)).toBe(false);
  });

  it("rejects malformed header", () => {
    expect(verify(payload, "garbage", secret)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Handler reconciliation - mock the service-role client and the entitlement
// grant so we assert the DB writes + grant decisions a real Stripe event drives,
// without a live Supabase/Stripe. This is the money path: a paid order becomes
// access, replays don't double-provision, and failures flip the order status.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  // One chainable query-builder stub shared per handle() call. Every builder
  // method records its (method, args) and returns the same object; the object
  // is awaitable (thenable) for `.eq(...)`-terminated writes, and exposes
  // maybeSingle()/single() resolving to a configurable result for the
  // `.select().maybeSingle()` order lookup.
  const state: {
    result: { data: unknown; error: unknown };
    calls: { method: string; args: unknown[] }[];
  } = {
    result: { data: null, error: null },
    calls: [],
  };
  const chain: any = {};
  for (const m of ["from", "update", "insert", "upsert", "select", "eq", "neq", "in"]) {
    chain[m] = (...args: unknown[]) => {
      state.calls.push({ method: m, args });
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(state.result);
  chain.single = () => Promise.resolve(state.result);
  chain.then = (onF: any, onR: any) => Promise.resolve({ data: null, error: null }).then(onF, onR);
  const grant = vi.fn(async (..._args: unknown[]) => {});
  return { state, chain, grant };
});

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: h.chain }));
vi.mock("@/lib/billing/grant.server", () => ({
  grantEntitlement: (...args: unknown[]) => h.grant(...args),
}));

// Dynamiczny import w handlerze (fetchStripeInvoiceUrl) trafia w ten mock -
// pozwala testowac galaz "invoice_url" bez sieci i bez realnego klucza.
const invoiceMock = vi.hoisted(() => ({
  fn: vi.fn(async (_invoiceId: string, _secret: string) => ({
    ok: true as boolean,
    url: "https://stripe.example/inv_1.pdf" as string | null,
    error: undefined as string | undefined,
  })),
}));
vi.mock("@/lib/billing/stripe.server", () => ({
  fetchStripeInvoiceUrl: (invoiceId: string, secret: string) => invoiceMock.fn(invoiceId, secret),
}));

import { __handleForTests as handle } from "./webhooks.stripe";

const SECRET = "whsec_test_secret";

function req(payload: string, sig: string | null = sign(payload, SECRET)): Request {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === "stripe-signature" ? sig : null) },
    text: async () => payload,
  } as unknown as Request;
}

function call(method: string) {
  return h.state.calls.find((c) => c.method === method);
}

describe("stripe webhook handler", () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    h.state.calls = [];
    h.state.result = { data: null, error: null };
    h.grant.mockClear();
  });
  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it("returns 503 when the webhook secret is not configured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await handle(req("{}"));
    expect(res.status).toBe(503);
  });

  it("returns 400 when the signature header is missing", async () => {
    const res = await handle(req("{}", null));
    expect(res.status).toBe(400);
  });

  it("returns 401 on an invalid signature", async () => {
    const payload = JSON.stringify({ id: "evt", type: "checkout.session.completed" });
    const res = await handle(req(payload, sign(payload, "wrong_secret")));
    expect(res.status).toBe(401);
  });

  it("returns 400 on a valid signature over non-JSON", async () => {
    const payload = "not-json";
    const res = await handle(req(payload, sign(payload, SECRET)));
    expect(res.status).toBe(400);
  });

  it("checkout.session.completed marks the order paid and grants the entitlement", async () => {
    const order = {
      id: "ord_1",
      user_id: "user_1",
      tenant_id: "ten_1",
      plan_id: "plan_1",
      kind: "subscription",
      entity_type: null,
      entity_id: null,
      amount_cents: 4900,
      currency: "PLN",
    };
    h.state.result = { data: order, error: null };

    const payload = JSON.stringify({
      id: "evt_paid",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_1",
          client_reference_id: "ord_1",
          subscription: "sub_123",
          payment_intent: "pi_1",
          amount_total: 4900,
          currency: "pln",
          customer_email: "buyer@example.com",
        },
      },
    });

    const res = await handle(req(payload));
    expect(res.status).toBe(200);

    // Order was updated to paid, idempotently (.neq("status","paid")) and by id.
    const update = call("update");
    expect((update?.args[0] as { status?: string }).status).toBe("paid");
    expect(call("neq")?.args).toEqual(["status", "paid"]);
    expect(call("eq")?.args).toEqual(["id", "ord_1"]);

    // The grant ran exactly once, keyed by the Stripe subscription id.
    expect(h.grant).toHaveBeenCalledTimes(1);
    expect(h.grant).toHaveBeenCalledWith(order, "sub_123");
  });

  it("checkout.session.completed z metadata.kind=donation zapisuje darowiznę i NIE nadaje uprawnień", async () => {
    const payload = JSON.stringify({
      id: "evt_don",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_don_1",
          payment_intent: "pi_don_1",
          amount_total: 5000,
          currency: "pln",
          customer_email: "donor@example.com",
          metadata: {
            kind: "donation",
            tenant_id: "6f9619ff-8b86-4d01-b42d-00c04fc964ff",
            message: "keep going",
          },
        },
      },
    });

    const res = await handle(req(payload));
    expect(res.status).toBe(200);

    // Zapis do donations, idempotentnie po provider_session_id.
    expect(call("from")?.args).toEqual(["donations"]);
    const upsert = call("upsert");
    const row = upsert?.args[0] as Record<string, unknown>;
    expect(row.provider_session_id).toBe("cs_don_1");
    expect(row.amount_cents).toBe(5000);
    expect(row.currency).toBe("PLN");
    expect(row.donor_email).toBe("donor@example.com");
    expect(row.message).toBe("keep going");
    expect(upsert?.args[1]).toEqual({
      onConflict: "provider_session_id",
      ignoreDuplicates: true,
    });

    // Darowizna to wsparcie, nie zakup: zero grantów, zero update'ów zamówień.
    expect(h.grant).not.toHaveBeenCalled();
    expect(call("update")).toBeUndefined();
  });

  it("darowizna bez kwoty (amount_total null) jest ignorowana bez zapisu", async () => {
    const payload = JSON.stringify({
      id: "evt_don_bad",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_don_2",
          amount_total: null,
          metadata: { kind: "donation" },
        },
      },
    });
    const res = await handle(req(payload));
    expect(res.status).toBe(200);
    expect(call("upsert")).toBeUndefined();
    expect(h.grant).not.toHaveBeenCalled();
  });

  it("charge.refunded oznacza darowiznę jako zwróconą po payment_intent", async () => {
    const payload = JSON.stringify({
      id: "evt_don_refund",
      type: "charge.refunded",
      data: { object: { payment_intent: "pi_don_1" } },
    });
    const res = await handle(req(payload));
    expect(res.status).toBe(200);
    // Pierwsza para (from, update) dotyczy donations - przed lookupem zamówienia.
    expect(call("from")?.args).toEqual(["donations"]);
    expect((call("update")?.args[0] as { status?: string }).status).toBe("refunded");
    expect(call("eq")?.args).toEqual(["provider_intent_id", "pi_don_1"]);
  });

  it("checkout.session.completed dokleja invoice_url z API Stripe, gdy sesja niesie fakturę", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_1";
    h.state.result = {
      data: { id: "ord_inv", user_id: "u1", kind: "subscription", entity_type: null },
      error: null,
    };
    const payload = JSON.stringify({
      id: "evt_inv",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_inv_1",
          client_reference_id: "ord_inv",
          subscription: "sub_inv",
          invoice: "in_123",
          amount_total: 4900,
          currency: "pln",
        },
      },
    });
    const res = await handle(req(payload));
    delete process.env.STRIPE_SECRET_KEY;
    expect(res.status).toBe(200);
    expect(invoiceMock.fn).toHaveBeenCalledWith("in_123", "sk_test_1");
    const update = call("update");
    expect((update?.args[0] as { invoice_url?: string }).invoice_url).toBe(
      "https://stripe.example/inv_1.pdf",
    );
  });

  it("nieudane pobranie faktury nie blokuje ksiegowania (best-effort, bez invoice_url)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_1";
    invoiceMock.fn.mockResolvedValueOnce({ ok: false, url: null, error: "boom" });
    h.state.result = {
      data: { id: "ord_inv2", user_id: "u1", kind: "subscription", entity_type: null },
      error: null,
    };
    const payload = JSON.stringify({
      id: "evt_inv2",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_inv_2",
          client_reference_id: "ord_inv2",
          subscription: "sub_inv2",
          invoice: "in_456",
          amount_total: 100,
          currency: "eur",
        },
      },
    });
    const res = await handle(req(payload));
    delete process.env.STRIPE_SECRET_KEY;
    expect(res.status).toBe(200);
    const update = call("update");
    expect(Object.prototype.hasOwnProperty.call(update?.args[0] as object, "invoice_url")).toBe(
      false,
    );
  });

  it("customer.subscription.updated lustrzy period_end i czysci oczekujace anulowanie", async () => {
    const payload = JSON.stringify({
      id: "evt_su_active",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_9",
          status: "active",
          cancel_at_period_end: false,
          current_period_end: 1893456000,
        },
      },
    });
    const res = await handle(req(payload));
    expect(res.status).toBe(200);
    expect(call("from")?.args).toEqual(["user_subscriptions"]);
    const update = call("update")?.args[0] as {
      status: string;
      canceled_at?: string | null;
      current_period_end?: string;
    };
    expect(update.status).toBe("active");
    expect(update.canceled_at).toBeNull();
    expect(update.current_period_end).toBe(new Date(1893456000 * 1000).toISOString());
    expect(call("eq")?.args).toEqual(["external_ref", "sub_9"]);
  });

  it("customer.subscription.updated z cancel_at_period_end stempluje canceled_at (nadal active)", async () => {
    const payload = JSON.stringify({
      id: "evt_su_pending",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_10", status: "active", cancel_at_period_end: true } },
    });
    const res = await handle(req(payload));
    expect(res.status).toBe(200);
    const update = call("update")?.args[0] as { status: string; canceled_at?: string | null };
    expect(update.status).toBe("active");
    expect(typeof update.canceled_at).toBe("string");
  });

  it("customer.subscription.updated mapuje canceled/incomplete_expired na lokalny cancel", async () => {
    const payload = JSON.stringify({
      id: "evt_su_cancel",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_11", status: "incomplete_expired" } },
    });
    const res = await handle(req(payload));
    expect(res.status).toBe(200);
    const update = call("update")?.args[0] as { status: string; canceled_at?: string | null };
    expect(update.status).toBe("canceled");
    expect(typeof update.canceled_at).toBe("string");
  });

  it("customer.subscription.updated bez id jest no-opem", async () => {
    const payload = JSON.stringify({
      id: "evt_su_noid",
      type: "customer.subscription.updated",
      data: { object: { status: "active" } },
    });
    const res = await handle(req(payload));
    expect(res.status).toBe(200);
    expect(call("update")).toBeUndefined();
  });

  it("charge.refunded cofa jednorazowy zakup encji dokladnie po (user, entity)", async () => {
    h.state.result = {
      data: {
        id: "ord_ref1",
        user_id: "u_ref",
        kind: "one_time",
        entity_type: "post",
        entity_id: "post_1",
        provider_session_id: "cs_ref1",
        provider_subscription_id: null,
      },
      error: null,
    };
    const payload = JSON.stringify({
      id: "evt_ref1",
      type: "charge.refunded",
      data: { object: { payment_intent: "pi_ref1" } },
    });
    const res = await handle(req(payload));
    expect(res.status).toBe(200);
    const froms = h.state.calls.filter((c) => c.method === "from").map((c) => c.args[0]);
    expect(froms).toEqual(
      expect.arrayContaining(["donations", "payment_orders", "user_purchases"]),
    );
    const eqPairs = h.state.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqPairs).toEqual(
      expect.arrayContaining([
        ["user_id", "u_ref"],
        ["entity_type", "post"],
        ["entity_id", "post_1"],
      ]),
    );
  });

  it("charge.refunded gasi WYLACZNIE subskrypcje oplacona tym zamowieniem (external_ref)", async () => {
    h.state.result = {
      data: {
        id: "ord_ref2",
        user_id: "u_sub",
        kind: "subscription",
        entity_type: null,
        entity_id: null,
        provider_session_id: "cs_ref2",
        provider_subscription_id: "sub_ref2",
      },
      error: null,
    };
    const payload = JSON.stringify({
      id: "evt_ref2",
      type: "charge.refunded",
      data: { object: { payment_intent: "pi_ref2" } },
    });
    const res = await handle(req(payload));
    expect(res.status).toBe(200);
    const froms = h.state.calls.filter((c) => c.method === "from").map((c) => c.args[0]);
    expect(froms).toEqual(expect.arrayContaining(["user_subscriptions"]));
    const eqPairs = h.state.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqPairs).toEqual(
      expect.arrayContaining([
        ["external_ref", "sub_ref2"],
        ["status", "active"],
        ["user_id", "u_sub"],
      ]),
    );
  });

  it("is idempotent: a replay of an already-paid order grants nothing", async () => {
    // `.neq("status","paid")` updates zero rows on replay -> order is null.
    h.state.result = { data: null, error: null };
    const payload = JSON.stringify({
      id: "evt_replay",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_1", client_reference_id: "ord_1" } },
    });
    const res = await handle(req(payload));
    expect(res.status).toBe(200);
    expect(h.grant).not.toHaveBeenCalled();
  });

  it("checkout.session.expired flips the order to canceled and grants nothing", async () => {
    const payload = JSON.stringify({
      id: "evt_exp",
      type: "checkout.session.expired",
      data: { object: { id: "cs_x", metadata: { order_id: "ord_9" } } },
    });
    const res = await handle(req(payload));
    expect(res.status).toBe(200);
    expect((call("update")?.args[0] as { status?: string }).status).toBe("canceled");
    expect(call("eq")?.args).toEqual(["id", "ord_9"]);
    expect(h.grant).not.toHaveBeenCalled();
  });

  it("payment_intent.payment_failed flips the order to failed", async () => {
    const payload = JSON.stringify({
      id: "evt_fail",
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_2", metadata: { order_id: "ord_5" } } },
    });
    const res = await handle(req(payload));
    expect(res.status).toBe(200);
    expect((call("update")?.args[0] as { status?: string }).status).toBe("failed");
    expect(call("eq")?.args).toEqual(["id", "ord_5"]);
  });

  it("invoice.payment_succeeded renews the subscription period", async () => {
    const periodEnd = 1893456000; // 2030-01-01 UTC
    const payload = JSON.stringify({
      id: "evt_inv",
      type: "invoice.payment_succeeded",
      data: { object: { subscription: "sub_123", period_end: periodEnd } },
    });
    const res = await handle(req(payload));
    expect(res.status).toBe(200);
    expect(call("from")?.args).toEqual(["user_subscriptions"]);
    const update = call("update")?.args[0] as { status?: string; current_period_end?: string };
    expect(update.status).toBe("active");
    expect(update.current_period_end).toBe(new Date(periodEnd * 1000).toISOString());
    expect(call("eq")?.args).toEqual(["external_ref", "sub_123"]);
  });

  it("customer.subscription.deleted cancels the subscription", async () => {
    const payload = JSON.stringify({
      id: "evt_del",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_123" } },
    });
    const res = await handle(req(payload));
    expect(res.status).toBe(200);
    expect(call("from")?.args).toEqual(["user_subscriptions"]);
    expect((call("update")?.args[0] as { status?: string }).status).toBe("canceled");
    expect(call("eq")?.args).toEqual(["external_ref", "sub_123"]);
  });

  it("acknowledges (200) an unhandled event type without touching the DB", async () => {
    const payload = JSON.stringify({
      id: "evt_other",
      type: "customer.created",
      data: { object: {} },
    });
    const res = await handle(req(payload));
    expect(res.status).toBe(200);
    expect(h.state.calls).toHaveLength(0);
    expect(h.grant).not.toHaveBeenCalled();
  });
});
