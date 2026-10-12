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
    };
  },
}));

const { resolvePaymentInvoice, findCheckoutSessionForPayment } =
  await import("@/lib/billing/transactions.server");

function stripeError(
  code: string,
  statusCode: number,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(`operator: ${code}`), { code, statusCode });
}

beforeEach(() => {
  h.envs.length = 0;
  h.invoicePaymentParams.length = 0;
  h.sessionParams.length = 0;
  h.invoicePayments = [];
  h.invoices.clear();
  h.charges.clear();
  h.sessions = [];
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

    expect(ref).toEqual({ invoiceId: "in_odnowienie", subscriptionId: "sub_odnowienie" });
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

    expect(ref).toEqual({ invoiceId: "in_1", subscriptionId: "sub_stary_ksztalt" });
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
    });
  });

  it("faktura bez subskrypcji (płatność jednorazowa z fakturą) to `subscriptionId: null`", async () => {
    h.invoicePayments = [{ invoice: { id: "in_jednorazowa", parent: null } }];

    expect(await resolvePaymentInvoice("live", "pi_jednorazowa")).toEqual({
      invoiceId: "in_jednorazowa",
      subscriptionId: null,
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
    });
    expect(h.sessionParams).toEqual([{ payment_intent: "pi_1", limit: 1 }]);
  });

  it("historyczny klucz `order_id` też wskazuje zamówienie; brak metadanych to `orderId: null`", async () => {
    h.sessions = [{ id: "cs_2", metadata: { order_id: "order-2" } }];
    expect(await findCheckoutSessionForPayment("live", "pi_2")).toEqual({
      sessionId: "cs_2",
      orderId: "order-2",
    });

    h.sessions = [{ id: "cs_3", metadata: null }];
    expect(await findCheckoutSessionForPayment("live", "pi_3")).toEqual({
      sessionId: "cs_3",
      orderId: null,
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
