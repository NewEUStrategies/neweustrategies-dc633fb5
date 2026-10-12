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
  environment: "sandbox",
  metadata: { event_id: "44444444-4444-4444-4444-444444444444" },
};

const updates: Array<Record<string, unknown>> = [];
const rsvps: Array<Record<string, unknown>> = [];
const inserts: Array<Record<string, unknown>> = [];
const grants: Array<unknown> = [];
const ticketOutcomes: Array<Record<string, unknown>> = [];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      ticketOutcomes.push({ fn, ...args });
      // Miejsce zakupu bez zgłoszenia rozstrzyga baza pod blokadą (TIX-08).
      if (fn === "_event_rsvp_claim_paid_seat") {
        return {
          data: seatsFull
            ? { ok: false, reason: "event_full" }
            : { ok: true, seated: true, already: false },
          error: null,
        };
      }
      // Zakup bez zgłoszenia z formularza - ścieżka RSVP.
      return { data: { applied: false, reason: "registration_not_found" }, error: null };
    },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: order, error: null }) }) }),
      update: (patch: Record<string, unknown>) => {
        updates.push({ table, ...patch });
        const done = async () => ({ error: null });
        const eq = () => Object.assign(done(), { neq: done, eq });
        return { eq };
      },
      insert: async (row: Record<string, unknown>) => {
        inserts.push({ table, ...row });
        return { error: null };
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
vi.mock("@/lib/billing/refundProvider.server", () => ({
  refundTransactionFully: async (_env: string, txnId: string) => {
    refunds.push(txnId);
    return { ok: true as const, adjustmentId: "adj_1" };
  },
}));
vi.mock("@/lib/billing/transactions.server", () => ({
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
  inserts.length = 0;
  refunds.length = 0;
  ticketOutcomes.length = 0;
  seatsFull = false;
});

describe("fulfilOneTimeTransaction - bilet na wydarzenie", () => {
  it("nadaje uprawnienie, księguje zamówienie, potwierdza RSVP i wysyła mail", async () => {
    const { fulfilOneTimeTransaction } = await import("@/lib/billing/oneTimeFulfilment.server");
    const outcome = await fulfilOneTimeTransaction(
      {
        id: "txn_123",
        amountCents: 12000,
        currency: "pln",
        customerEmail: "kupujacy@example.com",
        customData: { kind: "order", order_id: order.id, event_id: order.metadata.event_id },
      },
      "sandbox",
    );

    expect(outcome).toBe("order");
    expect(grants).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      table: "payment_orders",
      status: "paid",
      provider: "stripe",
    });
    // Bilet imienny: płatność potwierdza zgłoszenie z formularza i wydaje QR.
    expect(ticketOutcomes).toContainEqual(
      expect.objectContaining({ fn: "payments_apply_event_ticket_outcome", p_outcome: "paid" }),
    );
    // RSVP „going" zapisuje baza pod blokadą wydarzenia - nie TS poza nią.
    expect(ticketOutcomes).toContainEqual({
      fn: "_event_rsvp_claim_paid_seat",
      p_order_id: order.id,
    });
    expect(rsvps).toHaveLength(0);
    expect(emails).toContain("event");
  });

  it("pomija transakcję bez rozpoznanych metadanych", async () => {
    const { fulfilOneTimeTransaction } = await import("@/lib/billing/oneTimeFulfilment.server");
    const outcome = await fulfilOneTimeTransaction(
      {
        id: "txn_456",
        amountCents: 1000,
        currency: "PLN",
        customerEmail: null,
        customData: {},
      },
      "sandbox",
    );
    expect(outcome).toBe("skipped");
    expect(grants).toHaveLength(0);
  });

  it("POMIJA zamówienie z innego środowiska (sandbox webhook vs live order)", async () => {
    // Zamówienie z mocka jest 'sandbox'; webhook przychodzi jako 'live'.
    // Izolacja P0: brak nadania uprawnienia, brak księgowania.
    const { fulfilOneTimeTransaction } = await import("@/lib/billing/oneTimeFulfilment.server");
    const outcome = await fulfilOneTimeTransaction(
      {
        id: "txn_env_mismatch",
        amountCents: 12000,
        currency: "PLN",
        customerEmail: "atakujacy@example.com",
        customData: { kind: "order", order_id: order.id },
      },
      "live",
    );

    expect(outcome).toBe("skipped");
    expect(grants).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(rsvps).toHaveLength(0);
  });

  it("zwraca płatność, gdy ostatnie miejsce zajęto przed webhookiem", async () => {
    seatsFull = true;
    const { fulfilOneTimeTransaction } = await import("@/lib/billing/oneTimeFulfilment.server");
    const outcome = await fulfilOneTimeTransaction(
      {
        id: "txn_789",
        amountCents: 12000,
        currency: "PLN",
        customerEmail: "kupujacy@example.com",
        customData: { kind: "order", order_id: order.id },
      },
      "sandbox",
    );

    expect(outcome).toBe("oversold_refunded");
    expect(refunds).toEqual(["txn_789"]);
    // Bez RSVP i bez maila o wydarzeniu - nikt nie dostaje wejścia, którego nie ma.
    expect(rsvps).toHaveLength(0);
    expect(emails).toContain("refund");
    expect(emails).not.toContain("event");
    // Najpierw księga (wpłata jest faktem), potem zamknięcie zwrotem.
    expect(updates.map((u) => u.status)).toEqual(["paid", "refunded"]);
  });
});
