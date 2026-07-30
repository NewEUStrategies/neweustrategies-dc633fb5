// Bilet na wydarzenie: opłacona transakcja jednorazowa musi nadać uprawnienie,
// zaksięgowć zamówienie i potwierdzić RSVP - wszystko z webhooka operatora.
import { describe, expect, it, vi, beforeEach } from "vitest";

const order = {
  id: "11111111-1111-1111-1111-111111111111",
  user_id: "22222222-2222-2222-2222-222222222222",
  tenant_id: "33333333-3333-3333-3333-333333333333",
  plan_id: null,
  kind: "one_time",
  entity_type: null,
  entity_id: null,
  amount_cents: 12000,
  currency: "PLN",
  metadata: { event_id: "44444444-4444-4444-4444-444444444444" },
};

const updates: Array<Record<string, unknown>> = [];
const rsvps: Array<Record<string, unknown>> = [];
const grants: Array<unknown> = [];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: order, error: null }) }) }),
      update: (patch: Record<string, unknown>) => {
        updates.push({ table, ...patch });
        return { eq: () => ({ neq: async () => ({ error: null }) }) };
      },
      upsert: async (row: Record<string, unknown>) => {
        rsvps.push({ table, ...row });
        return { error: null };
      },
    }),
  },
}));

vi.mock("@/lib/billing/grant.server", () => ({
  grantEntitlement: async (o: unknown) => {
    grants.push(o);
  },
}));
let seatsFull = false;
vi.mock("@/lib/events/ticket.server", () => ({
  assertSeatAvailable: async () => {
    if (seatsFull) throw new Error("event_full");
  },
}));
const refunds: string[] = [];
vi.mock("@/lib/billing/paddleRefund.server", () => ({
  refundTransactionFully: async (_env: string, txnId: string) => {
    refunds.push(txnId);
    return { ok: true as const, adjustmentId: "adj_1" };
  },
}));
vi.mock("@/lib/billing/paddleTransaction.server", () => ({
  resolveEnvironment: () => "sandbox" as const,
}));
vi.mock("@/lib/billing/couponEffects.server", () => ({
  applyCouponEffectsForOrder: async () => undefined,
}));
const emails: string[] = [];
vi.mock("@/lib/billing/notifications.server", () => ({
  notifySubscriptionEmail: async () => {
    emails.push("subscription");
  },
  notifyEventRegistration: async () => {
    emails.push("event");
  },
  notifyRefundEmail: async () => {
    emails.push("refund");
  },
}));

beforeEach(() => {
  updates.length = 0;
  rsvps.length = 0;
  grants.length = 0;
  emails.length = 0;
  refunds.length = 0;
  seatsFull = false;
});

describe("fulfilOneTimeTransaction - bilet na wydarzenie", () => {
  it("nadaje uprawnienie, księguje zamówienie, potwierdza RSVP i wysyła mail", async () => {
    const { fulfilOneTimeTransaction } = await import("@/lib/billing/oneTimeFulfilment.server");
    const outcome = await fulfilOneTimeTransaction({
      id: "txn_123",
      amountCents: 12000,
      currency: "pln",
      customerEmail: "kupujacy@example.com",
      customData: { kind: "order", order_id: order.id, event_id: order.metadata.event_id },
    });

    expect(outcome).toBe("order");
    expect(grants).toHaveLength(1);
    expect(updates[0]).toMatchObject({ table: "payment_orders", status: "paid", provider: "paddle" });
    expect(rsvps[0]).toMatchObject({
      table: "event_rsvps",
      event_id: order.metadata.event_id,
      user_id: order.user_id,
      status: "going",
    });
    expect(emails).toContain("event");
  });

  it("pomija transakcję bez rozpoznanych metadanych", async () => {
    const { fulfilOneTimeTransaction } = await import("@/lib/billing/oneTimeFulfilment.server");
    const outcome = await fulfilOneTimeTransaction({
      id: "txn_456",
      amountCents: 1000,
      currency: "PLN",
      customerEmail: null,
      customData: {},
    });
    expect(outcome).toBe("skipped");
    expect(grants).toHaveLength(0);
  });



  it("zwraca płatność, gdy ostatnie miejsce zajęto przed webhookiem", async () => {
    seatsFull = true;
    const { fulfilOneTimeTransaction } = await import("@/lib/billing/oneTimeFulfilment.server");
    const outcome = await fulfilOneTimeTransaction({
      id: "txn_789",
      amountCents: 12000,
      currency: "PLN",
      customerEmail: "kupujacy@example.com",
      customData: { kind: "order", order_id: order.id },
    });

    expect(outcome).toBe("oversold_refunded");
    expect(refunds).toEqual(["txn_789"]);
    // Bez uprawnienia i bez RSVP - nikt nie dostaje wejścia, którego nie ma.
    expect(grants).toHaveLength(0);
    expect(rsvps).toHaveLength(0);
    expect(emails).toContain("refund");
    expect(updates[0]).toMatchObject({ table: "payment_orders", status: "refunded" });
  });
});
