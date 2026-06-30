import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";

function sign(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const hmac = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

// ---------------------------------------------------------------------------
// Signature verification (pure) — exercised directly.
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
// Handler reconciliation — mock the service-role client and the entitlement
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
