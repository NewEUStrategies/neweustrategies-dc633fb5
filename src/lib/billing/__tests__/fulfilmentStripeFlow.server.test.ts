// REALIZACJA, DOKUMENTY I WINDYKACJA OD ZDARZENIA STRIPE - przepływ end-to-end
// (luki kryteriów przeglądu, soczewka 4): surowy ładunek ->
// `normalizeStripeEvent` -> `dispatchWebhookEvent` -> realizacja / domknięcie
// / dokument / windykacja -> wiersze w bazie.
//
// DLACZEGO PRZEPŁYW. Testy jednostkowe budowały transakcję ręcznie
// (`amountSubtotalCents` itd.) i atrapowały realizację w teście dokumentów,
// więc nie widziały ani kształtu prawdziwej sesji z podatkiem (S5), ani
// kontraktu „realizacja stempluje -> dokument znajduje zamówienie" (S7), ani
// realnych `event.created` w windykacji (PAY-13), ani faktury, która wyprzedza
// `customer.subscription.created`. Tutaj każde zdarzenie widzi zapis
// poprzedniego (`memoryTables`), a asercje czytają wiersze, które czytają
// raporty, historia płatności i dostęp.
//
// Atrapy wyłącznie na granicach: klient roli serwisowej, poczta (wysyłka),
// klient operatora, GA4 i odczyt pojemności sali. RODO: dane syntetyczne.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedWebhookEvent } from "@/lib/stripe.server";
import type { BillingDocument, PaymentOrder } from "@/lib/billing/types";
import { memoryTables, type MemoryTables, type Row } from "@/test/billing/memoryTables";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  db: null as MemoryTables | null,
  rpc: null as SupabaseRpcStub | null,
  /** Wysłane maile transakcyjne (typ szablonu). */
  mails: [] as string[],
  /** Status faktur u operatora (`invoices.retrieve`). */
  invoiceStatus: new Map<string, string>(),
  /** `checkout.sessions.list({ payment_intent })` - sesje znane operatorowi. */
  sessionsByIntent: new Map<string, Record<string, unknown>>(),
  /**
   * Pełna sala dla zakupu bez zgłoszenia - decyzja bazy pod blokadą
   * (`_event_rsvp_claim_paid_seat`, TIX-08).
   */
  seatsFull: false,
  /** Zlecenia zwrotu u operatora: parametry i opcje żądania (klucz idempotencji). */
  refundRequests: [] as Array<{ params: unknown; options: unknown }>,
  /** `billing_reason` faktur u operatora (`invoices.retrieve`). */
  invoiceReasons: new Map<string, string>(),
  /** Bieżący stan obciążenia intencji płatności (ostatnie dostarczone `charge.*`). */
  charges: new Map<string, Record<string, unknown>>(),
  /** Kody promocyjne operatora (`promotionCodes.retrieve`). */
  promotionCodes: new Map<string, Record<string, unknown>>(),
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
  return {
    ...actual,
    sendTxEmail: (message: { type: string }) => {
      h.mails.push(message.type);
      return Promise.resolve({ ok: true });
    },
  };
});

vi.mock("@/lib/analytics/ga4Mp.server", () => ({ sendGa4Purchase: async () => undefined }));

vi.mock("@/lib/events/ticket.server", () => ({
  assertSeatAvailable: async () => {
    if (h.seatsFull) throw new Error("event_full");
  },
}));

vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getStripeClient: async () => ({
    charges: { retrieve: async (id: string) => ({ id, payment_intent: null }) },
    // Płatność jednorazowa nie opłaca faktury subskrypcji.
    invoicePayments: { list: async () => ({ data: [] }) },
    invoices: {
      retrieve: async (id: string) => ({
        id,
        status: h.invoiceStatus.get(id) ?? "open",
        billing_reason: h.invoiceReasons.get(id) ?? null,
      }),
    },
    // Stan zwrotów u operatora (`refunds.server` czyta go zamiast ładunku):
    // obciążenie z ostatniego dostarczonego zdarzenia `charge.*` tej intencji.
    paymentIntents: {
      retrieve: async (id: string) => ({
        id,
        latest_charge: h.charges.get(id) ?? { id: "ch_brak", amount: 0, amount_refunded: 0 },
      }),
    },
    promotionCodes: {
      retrieve: async (id: string) => {
        const code = h.promotionCodes.get(id);
        if (!code) throw new Error(`test: nieznany kod promocyjny ${id}`);
        return { id, ...code };
      },
    },
    refunds: {
      create: async (params: unknown, options: unknown) => {
        h.refundRequests.push({ params, options });
        return { id: "re_system_1" };
      },
    },
    checkout: {
      sessions: {
        retrieve: async (id: string) => ({ id, payment_intent: INTENT }),
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
const { mergePaymentHistory } = await import("@/lib/billing/paymentHistory");

const TENANT = "tenant-alfa";
const USER = "user-kupujacy";
const ORDER = "33333333-cccc-4ccc-8ccc-333333333333";
const SESSION = "cs_live_kasa";
const INTENT = "pi_live_kasa";
const SUB = "sub_live_nowa";
const EVENT_ID = "44444444-dddd-4ddd-8ddd-444444444444";

function order(over: Row = {}): Row {
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
    created_at: "2026-10-01T10:00:00.000Z",
    invoice_url: null,
    provider_session_id: SESSION,
    provider_intent_id: null,
    provider_payment_intent_id: null,
    provider_subscription_id: null,
    ...over,
  };
}

function tables(
  rows: { orders?: Row[]; subscriptions?: Row[]; coupons?: Row[] } = {},
): Record<string, Row[]> {
  return {
    payment_orders: rows.orders ?? [order()],
    user_purchases: [],
    user_subscriptions: [],
    access_plans: [],
    subscriptions: rows.subscriptions ?? [],
    donations: [],
    notifications: [],
    event_rsvps: [],
    billing_documents: [],
    b2b_coupons: rows.coupons ?? [],
    user_roles: [{ user_id: "admin-1", tenant_id: TENANT, role: "admin" }],
    profiles: [
      { id: USER, tenant_id: TENANT, email: "kupujacy@example.com", prefs: {} },
      { id: "admin-1", tenant_id: TENANT, email: "admin@example.com", prefs: {} },
    ],
  };
}

async function deliver(
  type: string,
  object: Record<string, unknown>,
  createdS = 1_790_000_000,
  eventId = `evt_${type}_${createdS}`,
): Promise<string> {
  const event: VerifiedWebhookEvent = {
    id: eventId,
    type,
    created: createdS,
    data: { object },
  };
  const intent = object.payment_intent;
  if (object.object === "charge" && typeof intent === "string") h.charges.set(intent, object);
  const normalized = normalizeStripeEvent(event);
  if (!normalized) throw new Error(`test: normalizator odrzucił ${type}`);
  return dispatchWebhookEvent({
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

function theOrder(): Row | undefined {
  return db().find("payment_orders", (row) => row.id === ORDER);
}

function rpcNames(): string[] {
  return h.rpc?.calls.map((call) => call.name) ?? [];
}

/** Sesja Checkout zakupu jednorazowego (Basil+): kwoty z rozbiciem. */
function oneTimeSession(over: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...over,
  };
}

/** Pierwsza sesja Checkout subskrypcji. */
function subscriptionSession(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...oneTimeSession(),
    mode: "subscription",
    payment_intent: null,
    subscription: SUB,
    metadata: { orderId: ORDER, userId: USER },
    ...over,
  };
}

/** Faktura subskrypcji (kształt Basil: metadane w `parent.subscription_details`). */
function invoice(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    object: "invoice",
    customer: "cus_kupujacy",
    customer_email: "kupujacy@example.com",
    currency: "pln",
    amount_paid: 4_900,
    total: 4_900,
    number: `FV/${id}`,
    hosted_invoice_url: "https://invoice.example.test/hosted",
    invoice_pdf: "https://invoice.example.test/pdf",
    status_transitions: { paid_at: 1_790_000_000 },
    parent: { subscription_details: { subscription: SUB, metadata: { orderId: ORDER } } },
    lines: { data: [{ period: { end: 1_790_000_000 + 30 * 86_400 } }] },
    ...over,
  };
}

beforeEach(() => {
  h.mails.length = 0;
  h.invoiceStatus.clear();
  h.sessionsByIntent.clear();
  h.sessionsByIntent.set(INTENT, { id: SESSION, metadata: { orderId: ORDER } });
  h.seatsFull = false;
  h.refundRequests.length = 0;
  h.invoiceReasons.clear();
  h.charges.clear();
  h.promotionCodes.clear();
  const rpc = supabaseRpcStub();
  // Zakup bez zgłoszenia z formularza: baza odsyła `registration_not_found`,
  // a miejsce RSVP rozstrzyga `_event_rsvp_claim_paid_seat` (TIX-05, TIX-08).
  rpc.setData("payments_apply_event_ticket_outcome", {
    applied: false,
    reason: "registration_not_found",
  });
  rpc.setResponse("_event_rsvp_claim_paid_seat", () => ({
    data: h.seatsFull
      ? { ok: false, reason: "event_full" }
      : { ok: true, seated: true, already: false },
    error: null,
  }));
  rpc.setData("apply_b2b_coupon_effects", { applied: false, reason: "no_redemption" });
  rpc.setData("release_b2b_coupon_for_user", true);
  rpc.setData("enqueue_notification", "bell-1");
  h.rpc = rpc;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("S5 e2e: kwota z prawdziwej sesji z podatkiem (PAY-06)", () => {
  it("S5 e2e: podatek doliczony na wierzch -> księgi brutto bez flagi, pełny zwrot zeruje przychód netto", async () => {
    // Najemca na płaszczyźnie sprzedawcy (`automatic_tax`), bilet netto 80 zł,
    // Stripe dolicza 18,40 zł VAT i pobiera 98,40 zł. Dawniej `amount_cents`
    // = 8 000, a pełny zwrot zapisywał 9 840 - przychód -18,40 zł.
    h.db = memoryTables(tables({ orders: [order({ amount_cents: 8_000 })] }));

    await deliver(
      "checkout.session.completed",
      oneTimeSession({
        amount_subtotal: 8_000,
        amount_total: 9_840,
        total_details: { amount_discount: 0, amount_tax: 1_840, amount_shipping: 0 },
      }),
    );

    const paid = theOrder();
    expect(paid).toMatchObject({ status: "paid", amount_cents: 9_840, currency: "PLN" });
    expect((paid?.metadata as Row | undefined)?.review).toBeUndefined();
    expect(rpcNames()).not.toContain("enqueue_notification");

    await deliver("charge.refunded", {
      id: "ch_live_kasa",
      object: "charge",
      amount: 9_840,
      amount_refunded: 9_840,
      refunded: true,
      currency: "pln",
      payment_intent: INTENT,
      refunds: { object: "list", data: [{ id: "re_live_1", status: "succeeded", amount: 9_840 }] },
      livemode: true,
    });

    const refunded = theOrder();
    expect(refunded).toMatchObject({ status: "refunded", refunded_amount_cents: 9_840 });
    expect(Number(refunded?.amount_cents) - Number(refunded?.refunded_amount_cents)).toBe(0);
  });
});

describe("S7 e2e: dokument z prawdziwą realizacją (PAY-12)", () => {
  it("S7 e2e: zakup jednorazowy -> dokument przypięty do zamówienia, JEDEN wiersz historii płatności", async () => {
    h.db = memoryTables(tables());

    expect(await deliver("checkout.session.completed", oneTimeSession())).toBe("processed");

    const documents = db().rows("billing_documents");
    expect(documents).toEqual([
      expect.objectContaining({
        provider_document_id: SESSION,
        order_id: ORDER,
        user_id: USER,
        tenant_id: TENANT,
        status: "paid",
      }),
    ]);
    const history = mergePaymentHistory(
      db().rows("payment_orders") as unknown as PaymentOrder[],
      documents as unknown as BillingDocument[],
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ source: "document", amountCents: 4_900 });
  });

  it("S7 e2e: `invoice.paid` PRZED `customer.subscription.created` -> dokładnie jeden dokument z właścicielem", async () => {
    // Stripe wysyła zdarzenia równolegle; wiersza `subscriptions` jeszcze nie
    // ma. Dawniej: obie dostawy `processed`, zero dokumentów, bez ponowienia.
    h.db = memoryTables(
      tables({
        orders: [
          order({ kind: "subscription", plan_id: "plan-pro", entity_type: null, entity_id: null }),
        ],
      }),
    );

    h.invoiceReasons.set("in_live_pierwsza", "subscription_create");

    await deliver("invoice.paid", invoice("in_live_pierwsza"));
    await deliver("invoice.payment_succeeded", invoice("in_live_pierwsza"));

    expect(db().rows("billing_documents")).toEqual([
      expect.objectContaining({
        provider_document_id: "in_live_pierwsza",
        user_id: USER,
        tenant_id: TENANT,
        order_id: ORDER,
        amount_cents: 4_900,
      }),
    ]);
  });
});

describe("S4 e2e: sesja subskrypcji bez pobrania i porzucona kasa subskrypcji (PAY-09)", () => {
  it("S4 e2e: trial (`no_payment_required`) -> zamówienie NIE jest opłacone, kupon nie działa, identyfikatory są", async () => {
    h.db = memoryTables(
      tables({
        orders: [
          order({
            kind: "subscription",
            plan_id: "plan-pro",
            entity_type: null,
            entity_id: null,
            metadata: { coupon_id: "kupon-partner" },
          }),
        ],
      }),
    );

    await deliver(
      "checkout.session.completed",
      subscriptionSession({
        payment_status: "no_payment_required",
        amount_subtotal: 0,
        amount_total: 0,
      }),
    );

    const trial = theOrder();
    expect(trial).toMatchObject({
      status: "processing",
      amount_cents: 4_900,
      provider_subscription_id: SUB,
      provider_customer_id: "cus_kupujacy",
      provider_session_id: SESSION,
    });
    expect(trial?.paid_at ?? null).toBeNull();
    expect(rpcNames()).not.toContain("apply_b2b_coupon_effects");
    // Sesja subskrypcji nie zakłada fantomowego dokumentu `cs_...`.
    expect(db().rows("billing_documents")).toEqual([]);
  });

  it("PAY-09 e2e: wygaśnięcie sesji SUBSKRYPCJI zamyka zamówienie, a kupon wraca DOPIERO po zamknięciu", async () => {
    h.db = memoryTables(
      tables({
        orders: [
          order({
            kind: "subscription",
            plan_id: "plan-pro",
            entity_type: null,
            entity_id: null,
            metadata: { coupon_id: "kupon-lato" },
          }),
        ],
      }),
    );
    // Warunek bazy (20261007140200): użycie wraca WYŁĄCZNIE nieopłaconemu
    // zamówieniu (`pending` / `failed` / `canceled`) tego konta w tym najemcy.
    const statusAtRelease: unknown[] = [];
    h.rpc?.setResponse("release_b2b_coupon_for_user", (call) => {
      const row = theOrder();
      statusAtRelease.push(row?.status);
      const releasable =
        ["pending", "failed", "canceled"].includes(String(row?.status)) &&
        call.arg("_tenant_id") === row?.tenant_id &&
        call.arg("_user_id") === row?.user_id;
      return { data: releasable, error: null };
    });

    expect(
      await deliver(
        "checkout.session.expired",
        subscriptionSession({ status: "expired", payment_status: "unpaid", subscription: null }),
      ),
    ).toBe("processed");

    expect(theOrder()).toMatchObject({ status: "canceled" });
    expect(statusAtRelease).toEqual(["canceled"]);
  });
});

describe("S3 e2e: samoczynny zwrot przy pełnej sali, potem `charge.refunded` operatora", () => {
  it("S3 e2e: jeden mail o zwrocie i jeden dzwonek - korekta operatora jest powtórką", async () => {
    // Zakup biletu bez zgłoszenia (RSVP) w chwili, gdy ostatnie miejsce
    // zajęto. Realizacja zwraca pieniądze sama; sekundy później Stripe dosyła
    // `charge.refunded` TEGO zwrotu, a obsługa korekt znajduje zamówienie
    // przez intencję płatności.
    h.seatsFull = true;
    h.db = memoryTables(
      tables({
        orders: [order({ entity_type: null, entity_id: null, metadata: { event_id: EVENT_ID } })],
      }),
    );

    await deliver("checkout.session.completed", oneTimeSession());

    expect(theOrder()).toMatchObject({
      status: "refunded",
      refunded_amount_cents: 4_900,
      provider_payment_intent_id: INTENT,
    });
    const bellsAfterOversold = db().rows("notifications").length;
    expect(h.mails).toEqual(["payment_refunded"]);
    // PAY-14b: zwrot całej intencji płatności rozwiązanej z sesji, z kluczem
    // idempotencji ze zdarzenia - ponowiona dostawa nie odda pieniędzy drugi raz.
    expect(h.refundRequests).toEqual([
      {
        params: expect.objectContaining({ payment_intent: INTENT }),
        options: { idempotencyKey: `refund:full:${SESSION}:oversold` },
      },
    ]);

    await deliver("charge.refunded", {
      id: "ch_live_kasa",
      object: "charge",
      amount: 4_900,
      amount_refunded: 4_900,
      refunded: true,
      currency: "pln",
      payment_intent: INTENT,
      refunds: {
        object: "list",
        data: [{ id: "re_system_1", status: "succeeded", amount: 4_900 }],
      },
      livemode: true,
    });

    expect(h.mails).toEqual(["payment_refunded"]);
    expect(db().rows("notifications")).toHaveLength(bellsAfterOversold);
    expect(theOrder()).toMatchObject({ status: "refunded", refunded_amount_cents: 4_900 });
  });
});

describe("PAY-13 e2e: windykacja z prawdziwymi `event.created`", () => {
  const T0 = 1_790_000_000;

  function subscriptionRow(): Row {
    return {
      provider_subscription_id: SUB,
      environment: "live",
      user_id: USER,
      tenant_id: TENANT,
      price_id: "pro_monthly",
      current_period_end: "2026-11-01T00:00:00.000Z",
      payment_failure_count: 0,
      last_dunning_transaction_id: null,
      last_payment_at: null,
    };
  }

  const failedInvoice = (id: string) =>
    invoice(id, {
      amount_paid: 0,
      status_transitions: {},
      parent: { subscription_details: { subscription: SUB } },
    });

  it("PAY-13 e2e: porażka TEJ faktury dostarczona po jej opłaceniu -> bez maila; porażka innej, nieopłaconej -> mail", async () => {
    h.db = memoryTables(tables({ orders: [], subscriptions: [subscriptionRow()] }));
    h.invoiceStatus.set("in_live_1", "paid");
    h.invoiceStatus.set("in_live_2", "open");

    // Kolejność dostaw: `paid` (T0+3600), potem spóźniona pierwsza dostawa
    // porażki tej samej faktury (T0) - klucz deduplikacji jest pusty.
    await deliver(
      "invoice.paid",
      invoice("in_live_1", { parent: { subscription_details: { subscription: SUB } } }),
      T0 + 3_600,
    );
    await deliver("invoice.payment_failed", failedInvoice("in_live_1"), T0);

    const sub = () => db().find("subscriptions", (row) => row.provider_subscription_id === SUB);
    expect(h.mails).not.toContain("payment_failed");
    expect(sub()).toMatchObject({ payment_failure_count: 0 });

    // Starsze niż znacznik płatności, ale to INNA faktura i wciąż nieopłacona
    // (np. odnowienie, którego porażka utknęła w ponowieniach) - wezwanie musi wyjść.
    await deliver("invoice.payment_failed", failedInvoice("in_live_2"), T0 - 600);

    expect(h.mails.filter((type) => type === "payment_failed")).toHaveLength(1);
    expect(sub()).toMatchObject({
      payment_failure_count: 1,
      last_dunning_transaction_id: "in_live_2",
    });
  });
});

describe("R1 / R2 e2e: faktura subskrypcji a NASZE zamówienie (PAY-06, PAY-09, PAY-12)", () => {
  const T0 = 1_790_000_000;
  const subscriptionOrder = (over: Row = {}): Row =>
    order({
      kind: "subscription",
      plan_id: "plan-pro",
      entity_type: null,
      entity_id: null,
      ...over,
    });

  it("R1 e2e: `invoice.paid` PRZED sesją - przegląd kwoty i tak się odbywa, historia ma jeden wiersz", async () => {
    // Cena w katalogu podmieniona: zamówienie 49 zł, operator pobrał 99 zł.
    // Stripe wysyła fakturę i sesję równolegle; dawniej faktura domykała
    // zamówienie (kwota oczekiwana nadpisana pobraną) i spóźniona sesja nie
    // miała z czym porównać - bez flagi i bez alertu.
    h.db = memoryTables(tables({ orders: [subscriptionOrder()] }));
    h.invoiceReasons.set("in_live_pierwsza", "subscription_create");

    await deliver(
      "invoice.paid",
      invoice("in_live_pierwsza", { amount_paid: 9_900, total: 9_900 }),
      T0,
    );
    expect(theOrder()).toMatchObject({ status: "processing", amount_cents: 4_900 });

    await deliver(
      "checkout.session.completed",
      subscriptionSession({ amount_subtotal: 9_900, amount_total: 9_900 }),
      T0 + 1,
    );

    const paid = theOrder();
    expect(paid).toMatchObject({
      status: "paid",
      amount_cents: 9_900,
      provider_intent_id: SESSION,
      provider_subscription_id: SUB,
    });
    expect((paid?.metadata as Row | undefined)?.review).toMatchObject({
      reason: "amount_mismatch",
      expected_cents: 4_900,
      charged_cents: 9_900,
    });
    expect(h.rpc?.callsFor("enqueue_notification").map((call) => call.arg("p_href"))).toContain(
      `/admin/billing?order=${ORDER}&review=amount_mismatch`,
    );
    // Pierwsza faktura przykrywa zamówienie - zakup jest w historii raz.
    const history = mergePaymentHistory(
      db().rows("payment_orders") as unknown as PaymentOrder[],
      db().rows("billing_documents") as unknown as BillingDocument[],
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ source: "document", amountCents: 9_900 });
  });

  it("R2 e2e: odnowienie subskrypcji sprzed wdrożenia nie opłaca zamówienia i nie przejmuje jego kuponu", async () => {
    // Zamówienie z czerwca: kasa sprzed domknięcia zostawiła je w
    // `processing` bez stempla subskrypcji, a pierwsza faktura zapisała się
    // bez powiązania. Metadane subskrypcji niosą `orderId`, więc dawniej
    // pierwsze odnowienie po wdrożeniu „opłacało" zamówienie (kwota i data
    // odnowienia, efekty kuponu po czterech miesiącach) i przykrywało je
    // w historii - z kodem LATO na fakturze, która rabatu nie miała.
    h.db = memoryTables(
      tables({
        orders: [
          subscriptionOrder({
            amount_cents: 2_450,
            metadata: {
              coupon_id: "kupon-lato",
              coupon_code: "LATO",
              original_amount_cents: 4_900,
            },
            created_at: "2026-06-01T10:00:00.000Z",
          }),
        ],
        subscriptions: [
          {
            provider_subscription_id: SUB,
            environment: "live",
            user_id: USER,
            tenant_id: TENANT,
            price_id: "pro_monthly",
            current_period_end: null,
            payment_failure_count: 0,
            last_dunning_transaction_id: null,
            last_payment_at: "2026-09-01T10:00:00.000Z",
          },
        ],
      }),
    );
    db().rows("billing_documents").push({
      id: "doc-czerwiec",
      provider: "stripe",
      provider_document_id: "in_live_czerwiec",
      kind: "invoice",
      amount_cents: 2_450,
      currency: "PLN",
      status: "paid",
      issued_at: "2026-06-01T10:00:00.000Z",
      user_id: USER,
      tenant_id: TENANT,
      order_id: null,
    });
    h.invoiceReasons.set("in_live_pazdziernik", "subscription_cycle");

    await deliver("invoice.paid", invoice("in_live_pazdziernik"), 1_791_500_000);

    const legacy = theOrder();
    expect(legacy).toMatchObject({ status: "processing", amount_cents: 2_450 });
    expect(legacy?.provider_intent_id ?? null).toBeNull();
    expect(legacy?.paid_at ?? null).toBeNull();
    expect(rpcNames()).not.toContain("apply_b2b_coupon_effects");
    const renewal = db().find(
      "billing_documents",
      (row) => row.provider_document_id === "in_live_pazdziernik",
    );
    expect(renewal).toMatchObject({ user_id: USER, order_id: null, amount_cents: 4_900 });
    const history = mergePaymentHistory(
      db().rows("payment_orders") as unknown as PaymentOrder[],
      db().rows("billing_documents") as unknown as BillingDocument[],
    );
    expect(history.find((row) => row.id === `doc:${String(renewal?.id)}`)?.couponCode).toBeNull();
  });
});

describe("R3 e2e: kupon wyłączony PO zakupie, potem powtórka zdarzenia (S8)", () => {
  it("R3 e2e: powtórka nie wstrzymuje opłaconego i nadanego zamówienia ani nie alarmuje o wstrzymaniu", async () => {
    const COUPON = "55555555-eeee-4eee-8eee-555555555555";
    h.db = memoryTables(
      tables({
        orders: [order({ amount_cents: 2_450 })],
        coupons: [{ id: COUPON, tenant_id: TENANT, active: true, plan_ids: [], event_ids: [] }],
      }),
    );
    h.promotionCodes.set("promo_wlasny", { metadata: { tenant_id: TENANT, coupon_id: COUPON } });
    const session = oneTimeSession({
      amount_subtotal: 4_900,
      amount_total: 2_450,
      total_details: { amount_discount: 2_450, amount_tax: 0, amount_shipping: 0 },
      discounts: [{ promotion_code: "promo_wlasny" }],
    });

    expect(await deliver("checkout.session.completed", session)).toBe("processed");
    expect(theOrder()).toMatchObject({ status: "paid" });
    expect(db().rows("user_purchases")).toHaveLength(1);

    // Administrator wyłącza kupon; to samo zdarzenie wraca (panel, zamiatarka).
    const coupon = db().find("b2b_coupons", (row) => row.id === COUPON);
    if (coupon) coupon.active = false;
    expect(
      await deliver("checkout.session.completed", session, 1_790_000_000, "evt_ponowienie"),
    ).toBe("processed");

    expect(db().rows("user_purchases")).toHaveLength(1);
    expect((theOrder()?.metadata as Row | undefined)?.review).toBeUndefined();
    const hrefs = h.rpc?.callsFor("enqueue_notification").map((call) => call.arg("p_href")) ?? [];
    expect(hrefs.filter((href) => String(href).includes("review="))).toEqual([]);
  });
});

describe("R4 e2e: zwrot częściowy PRZED realizacją, podatek doliczony na wierzch (2.8 / 5.9)", () => {
  it("R4 e2e: przychód netto po realizacji zgadza się z operatorem (98,40 - 85,00 = 13,40 zł)", async () => {
    h.db = memoryTables(tables({ orders: [order({ amount_cents: 8_000 })] }));

    await deliver(
      "charge.refunded",
      {
        id: "ch_live_kasa",
        object: "charge",
        amount: 9_840,
        amount_refunded: 8_500,
        refunded: false,
        currency: "pln",
        payment_intent: INTENT,
        refunds: {
          object: "list",
          data: [{ id: "re_live_1", status: "succeeded", amount: 8_500 }],
        },
        livemode: true,
      },
      1_790_000_000,
    );
    // Zwrot częściowy: zamówienie dalej w toku, licznik w podstawie zamówienia.
    expect(theOrder()).toMatchObject({ status: "processing" });
    expect(Number(theOrder()?.refunded_amount_cents)).toBeGreaterThan(0);

    await deliver(
      "checkout.session.completed",
      oneTimeSession({
        amount_subtotal: 8_000,
        amount_total: 9_840,
        total_details: { amount_discount: 0, amount_tax: 1_840, amount_shipping: 0 },
      }),
      1_790_000_100,
    );

    const paid = theOrder();
    expect(paid).toMatchObject({
      status: "paid",
      amount_cents: 9_840,
      refunded_amount_cents: 8_500,
    });
    expect(Number(paid?.amount_cents) - Number(paid?.refunded_amount_cents)).toBe(1_340);
    expect(db().rows("user_purchases")).toHaveLength(1);
  });
});

describe("PAY-06 e2e: podatek WLICZONY w cenę (luka kryterium, soczewka 4)", () => {
  it("PAY-06 e2e: cena brutto z VAT w środku - bez flagi, księgi = suma sesji", async () => {
    // Najemca na płaszczyźnie platformy: cena 49 zł zawiera 9,16 zł VAT.
    // Stripe raportuje `amount_tax`, ale suma i `subtotal` są równe cenie.
    h.db = memoryTables(tables());

    await deliver(
      "checkout.session.completed",
      oneTimeSession({
        amount_subtotal: 4_900,
        amount_total: 4_900,
        total_details: { amount_discount: 0, amount_tax: 916, amount_shipping: 0 },
      }),
    );

    const paid = theOrder();
    expect(paid).toMatchObject({ status: "paid", amount_cents: 4_900 });
    expect((paid?.metadata as Row | undefined)?.review).toBeUndefined();
    expect(rpcNames()).not.toContain("enqueue_notification");
  });
});
