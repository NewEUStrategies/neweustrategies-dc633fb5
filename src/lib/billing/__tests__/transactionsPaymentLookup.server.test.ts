// Odczyt FAKTURY i SESJI dla płatności wskazanej przez zwrot albo spór
// (`resolvePaymentInvoice`, `findCheckoutSessionForPayment`).
//
// PO CO. Od API Basil obciążenie nie niesie `invoice`, a faktura -
// `payment_intent`. Zwrot faktury odnowienia przychodzi z `pi_...`, którego
// nasze zamówienia subskrypcyjne nie znają - bez łącznika `InvoicePayment`
// zwrot nie trafiał w nic i klient zostawał z pieniędzmi I z dostępem.
// Drugi łącznik (sesja Checkout po intencji) dopina zwrot, który wyprzedził
// realizację zamówienia.
//
// TRZY REGUŁY:
//   1. subskrypcja z `parent.subscription_details` (Basil), z fallbackiem na
//      `invoice.subscription` i pozycję faktury (starsze kształty);
//   2. faktura BEZ subskrypcji (np. faktura po płatności jednorazowej) to
//      `subscriptionId: null` - nie wolno jej pomylić z odnowieniem;
//   3. brak zasobu (404) to `null`, KAŻDA inna awaria rzuca - webhook ma
//      zostać ponowiony, zamiast cicho zostawić dostęp po zwrocie.
//
// GRANICA ATRAP: wyłącznie klient operatora (`getStripeClient`).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  envs: [] as string[],
  invoicePaymentParams: [] as unknown[],
  sessionParams: [] as unknown[],
  invoicePayments: [] as Array<Record<string, unknown>>,
  invoices: new Map<string, Record<string, unknown>>(),
  charges: new Map<string, Record<string, unknown>>(),
  sessions: [] as Array<Record<string, unknown>>,
  paymentIntents: new Map<string, Record<string, unknown>>(),
  paymentIntentParams: [] as unknown[],
  disputes: new Map<string, Record<string, unknown>>(),
  subscriptions: new Map<string, Record<string, unknown>>(),
  subscriptionParams: [] as unknown[],
  failure: null as (Error & { code?: string; statusCode?: number }) | null,
}));

vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getStripeClient: async (env: string) => {
    h.envs.push(env);
    const guard = () => {
      if (h.failure) throw h.failure;
    };
    return {
      charges: {
        retrieve: async (id: string) => {
          guard();
          return h.charges.get(id) ?? { id, payment_intent: null };
        },
      },
      invoicePayments: {
        list: async (params: unknown) => {
          guard();
          h.invoicePaymentParams.push(params);
          return { data: h.invoicePayments };
        },
      },
      invoices: {
        retrieve: async (id: string) => {
          guard();
          return h.invoices.get(id) ?? { id };
        },
      },
      checkout: {
        sessions: {
          list: async (params: unknown) => {
            guard();
            h.sessionParams.push(params);
            return { data: h.sessions };
          },
        },
      },
      paymentIntents: {
        retrieve: async (id: string, params: unknown) => {
          guard();
          h.paymentIntentParams.push(params);
          const intent = h.paymentIntents.get(id);
          if (!intent) throw stripeError("resource_missing", 404);
          return intent;
        },
      },
      disputes: {
        retrieve: async (id: string) => {
          guard();
          const dispute = h.disputes.get(id);
          if (!dispute) throw stripeError("resource_missing", 404);
          return dispute;
        },
      },
      subscriptions: {
        retrieve: async (id: string, params: unknown) => {
          guard();
          h.subscriptionParams.push(params);
          const subscription = h.subscriptions.get(id);
          if (!subscription) throw stripeError("resource_missing", 404);
          return subscription;
        },
      },
    };
  },
}));

const {
  resolvePaymentInvoice,
  findCheckoutSessionForPayment,
  retrievePaymentRefundState,
  retrieveDisputeState,
  retrieveSubscriptionState,
} = await import("@/lib/billing/transactions.server");

function stripeError(
  code: string,
  statusCode: number,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(`operator: ${code}`), { code, statusCode });
}

/** Faktura bez okresu, przyczyny i metadanych - pola dodatkowe `PaymentInvoiceRef`. */
const NO_INVOICE_CONTEXT = {
  periodStart: null,
  periodEnd: null,
  billingReason: null,
  purpose: null,
  orderId: null,
};

beforeEach(() => {
  h.envs.length = 0;
  h.invoicePaymentParams.length = 0;
  h.sessionParams.length = 0;
  h.invoicePayments = [];
  h.invoices.clear();
  h.charges.clear();
  h.sessions = [];
  h.paymentIntents.clear();
  h.paymentIntentParams.length = 0;
  h.disputes.clear();
  h.subscriptions.clear();
  h.subscriptionParams.length = 0;
  h.failure = null;
});

describe("resolvePaymentInvoice - płatność -> faktura -> subskrypcja", () => {
  it("PAY-04: płatność faktury odnowienia wskazuje subskrypcję z parent.subscription_details", async () => {
    h.invoicePayments = [
      {
        invoice: {
          id: "in_odnowienie",
          parent: { subscription_details: { subscription: "sub_odnowienie" } },
        },
      },
    ];

    const ref = await resolvePaymentInvoice("live", "pi_odnowienie");

    expect(ref).toEqual({
      invoiceId: "in_odnowienie",
      subscriptionId: "sub_odnowienie",
      ...NO_INVOICE_CONTEXT,
    });
    expect(h.envs).toEqual(["live"]);
    expect(h.invoicePaymentParams).toEqual([
      {
        payment: { type: "payment_intent", payment_intent: "pi_odnowienie" },
        limit: 1,
        expand: ["data.invoice"],
      },
    ]);
  });

  it("obciążenie `ch_` idzie przez swoją intencję płatności", async () => {
    h.charges.set("ch_1", { id: "ch_1", payment_intent: { id: "pi_z_obciazenia" } });
    h.invoicePayments = [{ invoice: { id: "in_1", subscription: { id: "sub_stary_ksztalt" } } }];

    const ref = await resolvePaymentInvoice("sandbox", "ch_1");

    expect(ref).toEqual({
      invoiceId: "in_1",
      subscriptionId: "sub_stary_ksztalt",
      ...NO_INVOICE_CONTEXT,
    });
    expect(h.invoicePaymentParams[0]).toMatchObject({
      payment: { payment_intent: "pi_z_obciazenia" },
    });
  });

  it("faktura niezrozwinięta jest doczytywana; subskrypcja z pozycji faktury jako ostatni fallback", async () => {
    h.invoicePayments = [{ invoice: "in_2" }];
    h.invoices.set("in_2", {
      id: "in_2",
      lines: {
        data: [{ parent: { subscription_item_details: { subscription: "sub_z_pozycji" } } }],
      },
    });

    expect(await resolvePaymentInvoice("live", "pi_2")).toEqual({
      invoiceId: "in_2",
      subscriptionId: "sub_z_pozycji",
      ...NO_INVOICE_CONTEXT,
    });
  });

  it("faktura bez subskrypcji (płatność jednorazowa z fakturą) to `subscriptionId: null`", async () => {
    h.invoicePayments = [{ invoice: { id: "in_jednorazowa", parent: null } }];

    expect(await resolvePaymentInvoice("live", "pi_jednorazowa")).toEqual({
      invoiceId: "in_jednorazowa",
      subscriptionId: null,
      ...NO_INVOICE_CONTEXT,
    });
  });

  it("S1: okres USŁUGI z pozycji faktury (najwcześniejszy początek, najpóźniejszy koniec), nie `invoice.period_*`", async () => {
    // Faktura odnowienia niesie w `period_start/period_end` POPRZEDNI cykl
    // (okres naliczania zużycia). O tym, czy korekta dotyczy okresu, który
    // jeszcze trwa, rozstrzyga okres pozycji - inaczej zwrot faktury
    // odnowienia wyglądałby na korektę zakończonego okresu i nie odbierał
    // dostępu.
    h.invoicePayments = [
      {
        invoice: {
          id: "in_proracja",
          period_start: 1_000,
          period_end: 2_000,
          billing_reason: "subscription_update",
          parent: {
            subscription_details: {
              subscription: "sub_1",
              metadata: { orderId: "order-1", purpose: "plan" },
            },
          },
          lines: {
            data: [
              { period: { start: 1_790_000_000, end: 1_792_000_000 } },
              { period: { start: 1_789_000_000, end: 1_793_000_000 } },
              { period: null },
            ],
          },
        },
      },
    ];

    expect(await resolvePaymentInvoice("live", "pi_proracja")).toEqual({
      invoiceId: "in_proracja",
      subscriptionId: "sub_1",
      periodStart: new Date(1_789_000_000 * 1000).toISOString(),
      periodEnd: new Date(1_793_000_000 * 1000).toISOString(),
      billingReason: "subscription_update",
      purpose: "plan",
      orderId: "order-1",
    });
  });

  it("5.3/2.6: metadane subskrypcji z faktury albo pozycji (historyczny `order_id`, darowizna)", async () => {
    h.invoicePayments = [
      {
        invoice: {
          id: "in_darowizna",
          billing_reason: "subscription_cycle",
          parent: { subscription_details: { subscription: "sub_d", metadata: {} } },
          lines: { data: [{ metadata: { purpose: "donation", order_id: " order-2 " } }] },
        },
      },
    ];

    expect(await resolvePaymentInvoice("live", "pi_d")).toMatchObject({
      subscriptionId: "sub_d",
      billingReason: "subscription_cycle",
      purpose: "donation",
      orderId: "order-2",
    });
  });

  it.each([
    ["płatność bez faktury", "pi_x", () => {}],
    [
      "faktura usunięta",
      "pi_x",
      () => {
        h.invoicePayments = [{ invoice: { id: "in_del", deleted: true } }];
      },
    ],
    [
      "obciążenie bez intencji płatności",
      "ch_bez_pi",
      () => {
        h.charges.set("ch_bez_pi", { id: "ch_bez_pi", payment_intent: null });
      },
    ],
  ])("%s -> null", async (_label, ref, arrange) => {
    arrange();

    expect(await resolvePaymentInvoice("live", ref)).toBeNull();
  });

  it("referencja innego kształtu nie pyta operatora o faktury", async () => {
    expect(await resolvePaymentInvoice("live", "in_1")).toBeNull();
    expect(h.invoicePaymentParams).toHaveLength(0);
  });

  it("brak zasobu u operatora (404) to `null`, nie pętla ponowień", async () => {
    h.failure = stripeError("resource_missing", 404);

    expect(await resolvePaymentInvoice("live", "pi_obcy")).toBeNull();
  });

  it("awaria operatora RZUCA - zwrot nie może przepaść po cichu", async () => {
    h.failure = stripeError("api_connection_error", 500);

    await expect(resolvePaymentInvoice("live", "pi_1")).rejects.toThrow(
      "operator: api_connection_error",
    );
  });
});

describe("findCheckoutSessionForPayment - płatność -> sesja Checkout -> zamówienie", () => {
  it("PAY-07: znajduje sesję po intencji i czyta `metadata.orderId`", async () => {
    h.sessions = [{ id: "cs_1", metadata: { orderId: " order-1 " } }];

    expect(await findCheckoutSessionForPayment("sandbox", "pi_1")).toEqual({
      sessionId: "cs_1",
      orderId: "order-1",
      purpose: null,
      donationId: null,
    });
    expect(h.sessionParams).toEqual([{ payment_intent: "pi_1", limit: 1 }]);
  });

  it("historyczny klucz `order_id` też wskazuje zamówienie; brak metadanych to `orderId: null`", async () => {
    h.sessions = [{ id: "cs_2", metadata: { order_id: "order-2" } }];
    expect(await findCheckoutSessionForPayment("live", "pi_2")).toEqual({
      sessionId: "cs_2",
      orderId: "order-2",
      purpose: null,
      donationId: null,
    });

    h.sessions = [{ id: "cs_3", metadata: null }];
    expect(await findCheckoutSessionForPayment("live", "pi_3")).toEqual({
      sessionId: "cs_3",
      orderId: null,
      purpose: null,
      donationId: null,
    });
  });

  it("2.6: sesja darowizny niesie `purpose` i `donationId` - zwrot i spór trafiają w wpłatę", async () => {
    // Wpłata jednorazowa z webhooka zapisuje w `provider_intent_id` SESJĘ,
    // a zwrot niesie intencję płatności - bez metadanych sesji darowizna
    // nie była znajdowana ani przez zwrot, ani przez alert o sporze.
    h.sessions = [
      {
        id: "cs_d",
        metadata: { purpose: "donation", donationId: "don-1", tenantId: "tenant-1" },
      },
    ];

    expect(await findCheckoutSessionForPayment("live", "pi_d")).toEqual({
      sessionId: "cs_d",
      orderId: null,
      purpose: "donation",
      donationId: "don-1",
    });
  });

  it("brak sesji, obcy kształt referencji i 404 to `null`; inna awaria rzuca", async () => {
    expect(await findCheckoutSessionForPayment("live", "pi_bez_sesji")).toBeNull();
    expect(await findCheckoutSessionForPayment("live", "ch_1")).toBeNull();
    expect(h.sessionParams).toHaveLength(1);

    h.failure = stripeError("resource_missing", 404);
    expect(await findCheckoutSessionForPayment("live", "pi_obcy")).toBeNull();

    h.failure = stripeError("rate_limit", 429);
    await expect(findCheckoutSessionForPayment("live", "pi_1")).rejects.toThrow(
      "operator: rate_limit",
    );
  });
});

describe("retrievePaymentRefundState - ile NAPRAWDĘ wróciło do klienta (S2, 2.11)", () => {
  it("S2: intencja płatności z rozwiniętym `latest_charge` - kwota, zwroty, spór", async () => {
    h.paymentIntents.set("pi_1", {
      id: "pi_1",
      latest_charge: {
        id: "ch_1",
        amount: 4900,
        amount_refunded: 1000,
        refunded: false,
        disputed: true,
        currency: "pln",
      },
    });

    expect(await retrievePaymentRefundState("live", "pi_1")).toEqual({
      chargeId: "ch_1",
      amountCents: 4900,
      refundedCents: 1000,
      fullyRefunded: false,
      disputed: true,
      currency: "PLN",
    });
    expect(h.paymentIntentParams).toEqual([{ expand: ["latest_charge"] }]);
    expect(h.envs).toEqual(["live"]);
  });

  it("obciążenie niezrozwinięte jest doczytywane; pełny zwrot to `fullyRefunded`", async () => {
    h.paymentIntents.set("pi_2", { id: "pi_2", latest_charge: "ch_2" });
    h.charges.set("ch_2", { id: "ch_2", amount: 4900, amount_refunded: 4900, refunded: true });

    expect(await retrievePaymentRefundState("sandbox", "pi_2")).toMatchObject({
      chargeId: "ch_2",
      refundedCents: 4900,
      fullyRefunded: true,
      disputed: false,
    });
  });

  it("obciążenie `ch_` czytane wprost; zwrot równy kwocie jest pełny także bez flagi `refunded`", async () => {
    h.charges.set("ch_3", { id: "ch_3", amount: 4900, amount_refunded: 4900 });

    expect(await retrievePaymentRefundState("live", "ch_3")).toMatchObject({
      fullyRefunded: true,
      currency: null,
    });
  });

  it("referencja spoza `pi_`/`ch_`, brak obciążenia i 404 to `null`; inna awaria rzuca", async () => {
    expect(await retrievePaymentRefundState("live", "cs_1")).toBeNull();
    h.paymentIntents.set("pi_bez", { id: "pi_bez", latest_charge: null });
    expect(await retrievePaymentRefundState("live", "pi_bez")).toBeNull();
    expect(await retrievePaymentRefundState("live", "pi_nieznana")).toBeNull();

    h.failure = stripeError("api_connection_error", 500);
    await expect(retrievePaymentRefundState("live", "pi_1")).rejects.toThrow(
      "operator: api_connection_error",
    );
  });
});

describe("retrieveDisputeState - spór w stanie BIEŻĄCYM (S2)", () => {
  it("czyta status, kwotę i płatność sporu", async () => {
    h.disputes.set("dp_1", {
      id: "dp_1",
      status: "won",
      amount: 4900,
      currency: "pln",
      payment_intent: { id: "pi_1" },
      charge: "ch_1",
    });

    expect(await retrieveDisputeState("live", "dp_1")).toEqual({
      id: "dp_1",
      status: "won",
      amountCents: 4900,
      currency: "PLN",
      paymentIntentId: "pi_1",
      chargeId: "ch_1",
    });
  });

  it("brak sporu (404) to `null`; awaria operatora RZUCA - skutek nie może iść ze stanu zdarzenia", async () => {
    expect(await retrieveDisputeState("live", "dp_brak")).toBeNull();

    h.failure = stripeError("rate_limit", 429);
    await expect(retrieveDisputeState("live", "dp_1")).rejects.toThrow("operator: rate_limit");
  });
});

describe("retrieveSubscriptionState - autorytatywny stan do przywrócenia (S1)", () => {
  it("subskrypcja z rozwiniętym produktem; usunięta albo nieznana to `null`", async () => {
    h.subscriptions.set("sub_1", { id: "sub_1", status: "active" });
    h.subscriptions.set("sub_usunieta", { id: "sub_usunieta", deleted: true });

    expect(await retrieveSubscriptionState("live", "sub_1")).toEqual({
      id: "sub_1",
      status: "active",
    });
    expect(h.subscriptionParams[0]).toEqual({ expand: ["items.data.price.product"] });
    expect(await retrieveSubscriptionState("live", "sub_usunieta")).toBeNull();
    expect(await retrieveSubscriptionState("live", "sub_brak")).toBeNull();
  });

  it("awaria operatora rzuca", async () => {
    h.failure = stripeError("api_error", 500);

    await expect(retrieveSubscriptionState("live", "sub_1")).rejects.toThrow("operator: api_error");
  });
});
