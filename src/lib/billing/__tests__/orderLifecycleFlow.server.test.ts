// CYKL ŻYCIA ZAMÓWIENIA OD ZDARZENIA STRIPE - przepływ end-to-end:
// surowy ładunek -> `normalizeStripeEvent` -> `dispatchWebhookEvent` ->
// realizacja / zwrot / wygaśnięcie -> wiersze zamówienia, uprawnień i kuponu.
//
// DLACZEGO PRZEPŁYW, A NIE POJEDYNCZE FUNKCJE. Oba defekty PAY-07 to
// KOLEJNOŚĆ zdarzeń, a nie błąd jednej funkcji:
//   * zwrot PRZED realizacją: zamówienie zna wtedy tylko sesję (`cs_`), zwrot
//     niesie intencję (`pi_`) - zwrot nie trafiał w nic, a spóźniona
//     realizacja nadawała dostęp klientowi, który odzyskał pieniądze;
//   * realizacja -> zwrot -> POWTÓRKA realizacji (operator, panel,
//     uzgadnianie): grant i `.neq("status","paid")` wskrzeszały dostęp
//     i przestawiały zwrócone zamówienie z powrotem na opłacone.
// Do tego PAY-09: porzucona kasa nie zamykała zamówienia i trzymała
// rezerwację kuponu na zawsze.
//
// Baza jest STANOWA (`memoryTables`) - kolejne zdarzenie widzi zapis
// poprzedniego, a asercje czytają wiersze, które czyta `has_content_access()`.
// Atrapy wyłącznie na granicach: klient roli serwisowej, poczta, klient
// operatora, wysyłka GA4 (zewnętrzne HTTP). RODO: dane syntetyczne.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedWebhookEvent } from "@/lib/stripe.server";
import { memoryTables, type MemoryTables, type Row } from "@/test/billing/memoryTables";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  db: null as MemoryTables | null,
  rpc: null as SupabaseRpcStub | null,
  /** `checkout.sessions.list({ payment_intent })` - sesje znane operatorowi. */
  sessionsByIntent: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: baza nieustawiona");
      return h.db.stub.from(table);
    },
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (!h.rpc) throw new Error("test: RPC nieustawione");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("@/lib/email/transactional.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/transactional.server")>(
    "@/lib/email/transactional.server",
  );
  return { ...actual, sendTxEmail: () => Promise.resolve({ ok: true }) };
});

vi.mock("@/lib/analytics/ga4Mp.server", () => ({ sendGa4Purchase: async () => undefined }));

vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getStripeClient: async () => ({
    charges: { retrieve: async (id: string) => ({ id, payment_intent: null }) },
    // Płatność jednorazowa nie opłaca faktury subskrypcji.
    invoicePayments: { list: async () => ({ data: [] }) },
    invoices: { retrieve: async (id: string) => ({ id }) },
    checkout: {
      sessions: {
        list: async (params: { payment_intent?: string }) => {
          const session = h.sessionsByIntent.get(params.payment_intent ?? "");
          return { data: session ? [session] : [] };
        },
      },
    },
  }),
}));

const { normalizeStripeEvent } = await import("@/lib/billing/stripeEvents.server");
const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");

const TENANT = "tenant-alfa";
const USER = "user-kupujacy";
const ORDER = "22222222-bbbb-4bbb-8bbb-222222222222";
const SESSION = "cs_live_zamowienie";
const INTENT = "pi_live_zamowienie";

/** Zamówienie w toku: kasa zapisała SESJĘ, intencji płatności jeszcze nie zna. */
function orderInCheckout(over: Row = {}): Row {
  return {
    id: ORDER,
    user_id: USER,
    tenant_id: TENANT,
    plan_id: null,
    kind: "one_time",
    entity_type: "post",
    entity_id: "post-premium",
    amount_cents: 4_900,
    refunded_amount_cents: 0,
    currency: "PLN",
    status: "processing",
    environment: "live",
    metadata: {},
    provider_session_id: SESSION,
    provider_intent_id: null,
    provider_payment_intent_id: null,
    ...over,
  };
}

function tables(order: Row): Record<string, Row[]> {
  return {
    payment_orders: [order],
    user_purchases: [],
    user_subscriptions: [],
    access_plans: [{ id: "plan-lifetime", tenant_id: TENANT, interval: "one_time" }],
    subscriptions: [],
    donations: [],
    notifications: [],
    event_rsvps: [],
    billing_documents: [],
    profiles: [{ id: USER, tenant_id: TENANT, email: "kupujacy@example.com", prefs: {} }],
  };
}

function stripeEvent(type: string, object: Record<string, unknown>): VerifiedWebhookEvent {
  return { id: `evt_${type}`, type, created: 1_790_000_000, data: { object } };
}

/** Sesja Checkout opłacona (Basil+): kwoty z rozbiciem, metadane z kasy. */
function paidSession(): Record<string, unknown> {
  return {
    id: SESSION,
    object: "checkout.session",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    payment_intent: INTENT,
    customer: "cus_kupujacy",
    currency: "pln",
    amount_subtotal: 4_900,
    amount_total: 4_900,
    total_details: { amount_discount: 0, amount_tax: 0, amount_shipping: 0 },
    customer_details: { email: "kupujacy@example.com" },
    metadata: { orderId: ORDER, purpose: "order" },
    livemode: true,
  };
}

function fullRefund(): Record<string, unknown> {
  return {
    id: "ch_live_zamowienie",
    object: "charge",
    amount: 4_900,
    amount_refunded: 4_900,
    refunded: true,
    currency: "pln",
    payment_intent: INTENT,
    refunds: { object: "list", data: [{ id: "re_live_1", status: "succeeded", amount: 4_900 }] },
    livemode: true,
  };
}

async function deliver(type: string, object: Record<string, unknown>): Promise<void> {
  const event = stripeEvent(type, object);
  const normalized = normalizeStripeEvent(event);
  if (!normalized) throw new Error(`test: normalizator odrzucił ${type}`);
  await dispatchWebhookEvent({
    eventId: event.id,
    eventType: normalized.eventType,
    data: normalized.data,
    environment: "live",
    occurredAt: new Date(event.created * 1000).toISOString(),
  });
}

function db(): MemoryTables {
  if (!h.db) throw new Error("test: baza nieustawiona");
  return h.db;
}

function order(): Row | undefined {
  return db().find("payment_orders", (row) => row.id === ORDER);
}

/** Aktywne uprawnienia kupującego - to, co czyta `has_content_access()`. */
function activeAccess(): Row[] {
  return [...db().rows("user_purchases"), ...db().rows("user_subscriptions")].filter(
    (row) => row.user_id === USER && row.status === "active",
  );
}

beforeEach(() => {
  h.sessionsByIntent.clear();
  h.sessionsByIntent.set(INTENT, { id: SESSION, metadata: { orderId: ORDER } });
  const rpc = supabaseRpcStub();
  rpc.setData("payments_apply_event_ticket_outcome", null);
  rpc.setData("apply_b2b_coupon_effects", { applied: false, reason: "no_redemption" });
  rpc.setData("release_b2b_coupon_for_user", true);
  h.rpc = rpc;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const VARIANTS = [
  ["zakup wpisu (`user_purchases`)", {}],
  // Plan dożywotni: realizacja nadaje go pod kluczem SESJI, a zwrot odbierał
  // wyłącznie klucz zamówienia - plan zostawał aktywny po zwrocie.
  [
    "plan dożywotni (`user_subscriptions`)",
    { plan_id: "plan-lifetime", entity_type: null, entity_id: null },
  ],
] as const;

describe("PAY-07 e2e: zwrot i realizacja w dowolnej kolejności kończą się bez dostępu", () => {
  it.each(VARIANTS)(
    "PAY-07 e2e: zwrot -> (spóźniona) realizacja kończy się bez dostępu - %s",
    async (_label, over) => {
      h.db = memoryTables(tables(orderInCheckout(over)));

      // Zwrot wyprzedził webhook realizacji: zamówienie zna tylko sesję.
      // Dopasowanie idzie przez operatora (sesja po intencji płatności).
      await deliver("charge.refunded", fullRefund());
      expect(order()).toMatchObject({
        status: "refunded",
        refunded_amount_cents: 4_900,
        provider_payment_intent_id: INTENT,
      });

      await deliver("checkout.session.completed", paidSession());

      expect(activeAccess()).toEqual([]);
      expect(order()).toMatchObject({ status: "refunded" });
    },
  );

  it.each(VARIANTS)(
    "PAY-07 e2e: realizacja -> zwrot -> powtórka realizacji kończy się bez dostępu - %s",
    async (_label, over) => {
      h.db = memoryTables(tables(orderInCheckout(over)));

      await deliver("checkout.session.completed", paidSession());
      expect(order()).toMatchObject({ status: "paid", provider_payment_intent_id: INTENT });
      expect(activeAccess()).toHaveLength(1);

      await deliver("charge.refunded", fullRefund());
      expect(activeAccess()).toEqual([]);

      // Powtórka tej samej dostawy realizacji (operator / panel / uzgadnianie).
      await deliver("checkout.session.completed", paidSession());

      expect(activeAccess()).toEqual([]);
      expect(order()).toMatchObject({ status: "refunded" });
    },
  );
});

describe("PAY-09 e2e: porzucona kasa", () => {
  it("PAY-09 e2e: checkout.session.expired -> kupon zwolniony, zamówienie canceled", async () => {
    h.db = memoryTables(
      tables(orderInCheckout({ metadata: { coupon_id: "kupon-lato", coupon_code: "LATO" } })),
    );

    await deliver("checkout.session.expired", {
      ...paidSession(),
      status: "expired",
      payment_status: "unpaid",
      payment_intent: null,
    });

    expect(order()).toMatchObject({ status: "canceled" });
    expect(h.rpc?.callsFor("release_b2b_coupon_for_user").map((call) => call.args)).toEqual([
      { _tenant_id: TENANT, _user_id: USER, _coupon_id: "kupon-lato", _order_id: ORDER },
    ]);
    expect(activeAccess()).toEqual([]);
  });
});
