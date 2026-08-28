// Normalizacja zdarzeń Stripe -> słownik zdarzeń domenowych.
//
// Ten moduł jest JEDYNYM tłumaczem między kształtem operatora a modelem
// domenowym (`SubscriptionData` / `TransactionData`), więc testujemy go jak
// kontrakt: co wchodzi z bramki, co wychodzi do `dispatchWebhookEvent`.
// Moduł jest czysty (importuje wyłącznie typy) - nie ma czego mockować.
import { describe, expect, it } from "vitest";
import { mapStripeSubscription, normalizeStripeEvent } from "@/lib/billing/stripeEvents.server";
import type { NormalizedStripeEvent } from "@/lib/billing/stripeEvents.server";
import type { SubscriptionData, TransactionData } from "@/lib/billing/webhookDispatch.server";
import type { VerifiedWebhookEvent } from "@/lib/stripe.server";

function event(type: string, object: Record<string, unknown>): VerifiedWebhookEvent {
  return { id: `evt_${type}`, type, created: 1_700_000_000, data: { object } };
}

/** Znormalizowane zdarzenie musi istnieć - inaczej test nie ma czego sprawdzać. */
function normalized(e: VerifiedWebhookEvent): NormalizedStripeEvent {
  const result = normalizeStripeEvent(e);
  expect(result).not.toBeNull();
  return result!;
}

const subscriptionOf = (e: VerifiedWebhookEvent): SubscriptionData =>
  normalized(e).data as SubscriptionData;
const transactionOf = (e: VerifiedWebhookEvent): TransactionData & Record<string, unknown> =>
  normalized(e).data as TransactionData & Record<string, unknown>;
const adjustmentOf = (e: VerifiedWebhookEvent): Record<string, unknown> =>
  normalized(e).data as Record<string, unknown>;

/** Subskrypcja w kształcie API Basil: okres rozliczeniowy żyje na pozycji. */
function stripeSubscription(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    metadata: { userId: "user-1" },
    items: {
      data: [
        {
          quantity: 2,
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_000_000,
          price: {
            id: "price_1",
            lookup_key: "pro_monthly",
            product: { id: "prod_1", metadata: { lovable_external_id: "plan_pro" } },
          },
        },
      ],
    },
    ...over,
  };
}

describe("mapStripeSubscription", () => {
  it("mapuje pełną subskrypcję na model domenowy", () => {
    const data = mapStripeSubscription(stripeSubscription());

    expect(data).toEqual({
      id: "sub_1",
      customerId: "cus_1",
      status: "active",
      customData: { userId: "user-1", purpose: undefined, donationId: undefined },
      currentBillingPeriod: {
        startsAt: "2023-11-14T22:13:20.000Z",
        endsAt: "2023-12-08T01:46:40.000Z",
      },
      scheduledChange: null,
      items: [
        {
          quantity: 2,
          trialDates: { endsAt: null },
          price: { id: "price_1", externalId: "pro_monthly", trialPeriod: null },
          product: { id: "prod_1", externalId: "plan_pro" },
        },
      ],
    });
  });

  it("czyta okres rozliczeniowy z pozycji (Basil), nie z subskrypcji", () => {
    const data = mapStripeSubscription(
      stripeSubscription({
        // Stare pola na subskrypcji celowo wskazują inny okres - wygrać ma pozycja.
        current_period_start: 1_710_000_000,
        current_period_end: 1_720_000_000,
      }),
    );

    expect(data.currentBillingPeriod).toEqual({
      startsAt: "2023-11-14T22:13:20.000Z",
      endsAt: "2023-12-08T01:46:40.000Z",
    });
  });

  it("spada na pola subskrypcji, gdy pozycja nie niesie okresu", () => {
    const data = mapStripeSubscription(
      stripeSubscription({
        current_period_start: 1_710_000_000,
        current_period_end: 1_720_000_000,
        items: { data: [{ price: { id: "price_1", lookup_key: "pro_monthly" } }] },
      }),
    );

    expect(data.currentBillingPeriod).toEqual({
      startsAt: "2024-03-09T16:00:00.000Z",
      endsAt: "2024-07-03T09:46:40.000Z",
    });
  });

  it("pomija okres, gdy żadna ze stron nie poda liczbowego znacznika czasu", () => {
    const data = mapStripeSubscription(
      stripeSubscription({ items: { data: [{ price: { id: "price_1" } }] } }),
    );

    expect(data.currentBillingPeriod).toEqual({ startsAt: undefined, endsAt: undefined });
  });

  it("preferuje lookup_key nad metadata przy czytelnym identyfikatorze ceny", () => {
    const data = mapStripeSubscription(
      stripeSubscription({
        items: {
          data: [
            {
              price: {
                id: "price_1",
                lookup_key: "pro_monthly",
                metadata: { lovable_external_id: "ignorowane" },
              },
            },
          ],
        },
      }),
    );

    expect(data.items[0].price.externalId).toBe("pro_monthly");
  });

  it("używa metadata.lovable_external_id, gdy cena nie ma lookup_key", () => {
    const data = mapStripeSubscription(
      stripeSubscription({
        items: {
          data: [{ price: { id: "price_1", metadata: { lovable_external_id: "pro_yearly" } } }],
        },
      }),
    );

    expect(data.items[0].price.externalId).toBe("pro_yearly");
  });

  it("zwraca null jako externalId, gdy nie ma czytelnego identyfikatora (dyspozytor odrzuci)", () => {
    const data = mapStripeSubscription(
      stripeSubscription({
        items: { data: [{ price: { id: "price_xxx", product: { id: "prod_xxx" } } }] },
      }),
    );

    // Techniczne `price_xxx`/`prod_xxx` NIE mogą przeciec jako identyfikator katalogowy.
    expect(data.items[0].price.externalId).toBeNull();
    expect(data.items[0].product?.externalId).toBeNull();
    expect(data.items[0].price.id).toBe("price_xxx");
  });

  it("czyta identyfikatory zarówno ze stringów, jak i z rozwiniętych obiektów", () => {
    const expanded = mapStripeSubscription(
      stripeSubscription({ id: { id: "sub_exp" }, customer: { id: "cus_exp" } }),
    );
    expect(expanded.id).toBe("sub_exp");
    expect(expanded.customerId).toBe("cus_exp");

    const collapsed = mapStripeSubscription(
      stripeSubscription({
        items: { data: [{ price: "price_str", quantity: 1 }] },
      }),
    );
    // Cena podana jako goły identyfikator nie ma skąd wziąć czytelnego klucza.
    expect(collapsed.items[0].price.id).toBe("price_str");
    expect(collapsed.items[0].price.externalId).toBeNull();
    expect(collapsed.items[0].product).toEqual({ id: "", externalId: null });
  });

  it("przypisuje koniec okresu próbnego wyłącznie pierwszej pozycji", () => {
    const data = mapStripeSubscription(
      stripeSubscription({
        trial_end: 1_790_000_000,
        items: {
          data: [
            { price: { id: "price_1", lookup_key: "pro_monthly" } },
            { price: { id: "price_2", lookup_key: "addon" } },
          ],
        },
      }),
    );

    expect(data.items[0].trialDates).toEqual({ endsAt: "2026-09-21T14:13:20.000Z" });
    expect(data.items[1].trialDates).toBeNull();
  });

  it("ustawia domyślną liczebność 1 dla pozycji bez quantity", () => {
    const data = mapStripeSubscription(
      stripeSubscription({ items: { data: [{ price: { id: "price_1" } }] } }),
    );

    expect(data.items[0].quantity).toBe(1);
  });

  it("przenosi metadane userId/purpose/donationId z subskrypcji", () => {
    const data = mapStripeSubscription(
      stripeSubscription({
        metadata: { userId: "user-9", purpose: "donation", donationId: "don-7" },
      }),
    );

    expect(data.customData).toEqual({
      userId: "user-9",
      purpose: "donation",
      donationId: "don-7",
    });
  });

  it("traktuje puste i białe metadane jak brak wartości", () => {
    const data = mapStripeSubscription(
      stripeSubscription({
        status: "  active  ",
        metadata: { userId: "  user-1  ", purpose: "", donationId: "   " },
      }),
    );

    expect(data.status).toBe("active");
    expect(data.customData).toEqual({
      userId: "user-1",
      purpose: undefined,
      donationId: undefined,
    });
  });

  it("rozpoznaje zaplanowaną rezygnację tylko przy literalnym true", () => {
    expect(
      mapStripeSubscription(stripeSubscription({ cancel_at_period_end: true })).scheduledChange,
    ).toEqual({ action: "cancel" });
    expect(
      mapStripeSubscription(stripeSubscription({ cancel_at_period_end: false })).scheduledChange,
    ).toBeNull();
    expect(
      mapStripeSubscription(stripeSubscription({ cancel_at_period_end: "true" })).scheduledChange,
    ).toBeNull();
    expect(mapStripeSubscription(stripeSubscription({})).scheduledChange).toBeNull();
  });

  it("nie wywraca się na pustym ładunku ani na subskrypcji bez pozycji", () => {
    expect(mapStripeSubscription({})).toEqual({
      id: "",
      customerId: "",
      status: "",
      customData: { userId: undefined, purpose: undefined, donationId: undefined },
      currentBillingPeriod: { startsAt: undefined, endsAt: undefined },
      scheduledChange: null,
      items: [],
    });

    expect(mapStripeSubscription(stripeSubscription({ items: { data: [] } })).items).toEqual([]);
    expect(mapStripeSubscription(stripeSubscription({ items: null })).items).toEqual([]);
  });

  it("nie mutuje ładunku operatora (dziennik webhooków musi zostać nietknięty)", () => {
    const raw = stripeSubscription();
    const snapshot = structuredClone(raw);

    mapStripeSubscription(raw);

    expect(raw).toEqual(snapshot);
  });
});

describe("normalizeStripeEvent - zdarzenia subskrypcji", () => {
  it("mapuje utworzenie, usunięcie i wznowienie na zdarzenia domenowe", () => {
    expect(normalized(event("customer.subscription.created", stripeSubscription())).eventType).toBe(
      "subscription.created",
    );
    expect(normalized(event("customer.subscription.deleted", stripeSubscription())).eventType).toBe(
      "subscription.canceled",
    );
    expect(normalized(event("customer.subscription.resumed", stripeSubscription())).eventType).toBe(
      "subscription.resumed",
    );
  });

  it("rozgałęzia customer.subscription.updated po statusie operatora", () => {
    const cases: Array<[unknown, string]> = [
      ["trialing", "subscription.trialing"],
      ["past_due", "subscription.past_due"],
      ["paused", "subscription.paused"],
      ["active", "subscription.updated"],
      ["canceled", "subscription.updated"],
      ["incomplete_expired", "subscription.updated"],
      [undefined, "subscription.updated"],
      [42, "subscription.updated"],
    ];

    for (const [status, expected] of cases) {
      const e = event("customer.subscription.updated", stripeSubscription({ status }));
      expect(normalized(e).eventType, `status=${String(status)}`).toBe(expected);
    }
  });

  it("dokłada do każdego zdarzenia subskrypcji pełny model domenowy", () => {
    const data = subscriptionOf(event("customer.subscription.created", stripeSubscription()));

    expect(data.id).toBe("sub_1");
    expect(data.customData?.userId).toBe("user-1");
    expect(data.items[0].price.externalId).toBe("pro_monthly");
    expect(data.items[0].product?.externalId).toBe("plan_pro");
  });
});

describe("normalizeStripeEvent - sesje checkout", () => {
  const session = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: "cs_1",
    payment_status: "paid",
    amount_total: 12000,
    currency: "pln",
    customer: "cus_1",
    subscription: null,
    metadata: { orderId: "ord_1", purpose: "event_ticket" },
    customer_details: { email: "kupujacy@example.com" },
    ...over,
  });

  it("mapuje opłaconą sesję na transaction.completed", () => {
    const data = transactionOf(event("checkout.session.completed", session()));

    expect(data).toEqual({
      id: "cs_1",
      subscriptionId: null,
      customerId: "cus_1",
      paymentIntentId: null,
      currencyCode: "PLN",
      customData: { orderId: "ord_1", purpose: "event_ticket" },
      customer: { email: "kupujacy@example.com" },
      details: { totals: { grandTotal: "12000" } },
      billingPeriod: null,
    });
  });

  it("ODRZUCA sesję nieopłaconą - pieniędzy jeszcze nie ma na koncie", () => {
    expect(
      normalizeStripeEvent(
        event("checkout.session.completed", session({ payment_status: "unpaid" })),
      ),
    ).toBeNull();
  });

  it("przepuszcza sesję bez pola payment_status oraz z no_payment_required", () => {
    expect(
      normalized(event("checkout.session.completed", session({ payment_status: undefined })))
        .eventType,
    ).toBe("transaction.completed");
    expect(
      normalized(
        event("checkout.session.completed", session({ payment_status: "no_payment_required" })),
      ).eventType,
    ).toBe("transaction.completed");
  });

  it("realizuje płatność asynchroniczną i odnotowuje jej porażkę", () => {
    expect(normalized(event("checkout.session.async_payment_succeeded", session())).eventType).toBe(
      "transaction.completed",
    );
    expect(
      normalized(
        event("checkout.session.async_payment_failed", session({ payment_status: "unpaid" })),
      ).eventType,
    ).toBe("transaction.payment_failed");
  });

  it("bierze e-mail z customer_details, a w razie braku z customer_email", () => {
    const withDetails = transactionOf(event("checkout.session.completed", session()));
    expect(withDetails.customer?.email).toBe("kupujacy@example.com");

    const fallback = transactionOf(
      event(
        "checkout.session.completed",
        session({ customer_details: { email: "   " }, customer_email: "zapasowy@example.com" }),
      ),
    );
    expect(fallback.customer?.email).toBe("zapasowy@example.com");

    const none = transactionOf(
      event("checkout.session.completed", session({ customer_details: null })),
    );
    expect(none.customer?.email).toBeNull();
  });

  it("rozwija subskrypcję z sesji podanej stringiem lub obiektem", () => {
    expect(
      transactionOf(event("checkout.session.completed", session({ subscription: "sub_9" })))
        .subscriptionId,
    ).toBe("sub_9");
    expect(
      transactionOf(
        event("checkout.session.completed", session({ subscription: { id: "sub_exp" } })),
      ).subscriptionId,
    ).toBe("sub_exp");
  });

  it("zostawia puste kwoty i identyfikatory zamiast zgadywać", () => {
    const data = transactionOf(
      event(
        "checkout.session.completed",
        session({ id: undefined, amount_total: undefined, currency: undefined, customer: null }),
      ),
    );

    expect(data.id).toBe("");
    expect(data.details?.totals?.grandTotal).toBeNull();
    expect(data.currencyCode).toBeNull();
    expect(data.customerId).toBeNull();
  });

  it("zachowuje kwotę zerową jako '0' (sesja w pełni pokryta kuponem)", () => {
    const data = transactionOf(event("checkout.session.completed", session({ amount_total: 0 })));
    expect(data.details?.totals?.grandTotal).toBe("0");
  });
});

describe("normalizeStripeEvent - faktury", () => {
  const invoice = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: "in_1",
    currency: "eur",
    amount_paid: 2500,
    total: 2500,
    customer: "cus_1",
    customer_email: "platnik@example.com",
    number: "FV/2026/07/1",
    hosted_invoice_url: "https://invoice.stripe.com/i/1",
    invoice_pdf: "https://invoice.stripe.com/i/1.pdf",
    metadata: { orderId: "ord_1" },
    lines: { data: [{ period: { end: 1_800_000_000 } }] },
    status_transitions: { paid_at: 1_790_000_000 },
    ...over,
  });

  it("mapuje opłaconą fakturę na transakcję z polami dokumentu rozliczeniowego", () => {
    const data = transactionOf(event("invoice.paid", invoice()));

    expect(data).toMatchObject({
      id: "in_1",
      customerId: "cus_1",
      currencyCode: "EUR",
      customData: { orderId: "ord_1" },
      customer: { email: "platnik@example.com" },
      details: { totals: { grandTotal: "2500" } },
      billingPeriod: { endsAt: "2027-01-15T08:00:00.000Z" },
      status: "completed",
      invoiceNumber: "FV/2026/07/1",
      hostedInvoiceUrl: "https://invoice.stripe.com/i/1",
      invoicePdf: "https://invoice.stripe.com/i/1.pdf",
      billedAt: "2026-09-21T14:13:20.000Z",
    });
  });

  it("traktuje invoice.paid i invoice.payment_succeeded identycznie", () => {
    const paid = normalized(event("invoice.paid", invoice()));
    const succeeded = normalized(event("invoice.payment_succeeded", invoice()));

    expect(paid.eventType).toBe("transaction.completed");
    expect(succeeded).toEqual(paid);
  });

  it("datuje dokument znacznikiem created, gdy operator nie poda paid_at", () => {
    const data = transactionOf(
      event("invoice.paid", invoice({ status_transitions: {}, created: 1_710_000_000 })),
    );

    expect(data.billedAt).toBe("2024-03-09T16:00:00.000Z");
  });

  it("znajduje subskrypcję w parent.subscription_details (kształt Basil)", () => {
    const data = transactionOf(
      event(
        "invoice.paid",
        invoice({
          subscription: undefined,
          parent: { subscription_details: { subscription: "sub_basil" } },
        }),
      ),
    );

    expect(data.subscriptionId).toBe("sub_basil");
  });

  it("schodzi na subskrypcję z pozycji faktury, gdy nagłówek jej nie ma", () => {
    const data = transactionOf(
      event(
        "invoice.paid",
        invoice({
          subscription: undefined,
          parent: {},
          lines: {
            data: [
              {
                period: { end: 1_800_000_000 },
                parent: { subscription_item_details: { subscription: "sub_line" } },
              },
            ],
          },
        }),
      ),
    );

    expect(data.subscriptionId).toBe("sub_line");
  });

  it("kaskaduje metadane: faktura -> subskrypcja -> pozycja", () => {
    const fromSubscription = transactionOf(
      event(
        "invoice.paid",
        invoice({
          metadata: {},
          parent: {
            subscription_details: {
              subscription: "sub_donation",
              metadata: { purpose: "donation", donationId: "don-1" },
            },
          },
        }),
      ),
    );
    expect(fromSubscription.customData).toEqual({ purpose: "donation", donationId: "don-1" });

    const fromLine = transactionOf(
      event(
        "invoice.paid",
        invoice({
          metadata: {},
          parent: { subscription_details: { metadata: {} } },
          lines: { data: [{ period: { end: 1_800_000_000 }, metadata: { orderId: "ord_line" } }] },
        }),
      ),
    );
    expect(fromLine.customData).toEqual({ orderId: "ord_line" });

    const nothing = transactionOf(event("invoice.paid", invoice({ metadata: {} })));
    expect(nothing.customData).toBeNull();
  });

  it("nie pozwala pustym metadanym faktury przykryć metadanych subskrypcji", () => {
    const data = transactionOf(
      event(
        "invoice.paid",
        invoice({
          metadata: {},
          parent: { subscription_details: { metadata: { purpose: "donation" } } },
        }),
      ),
    );

    expect(data.customData).toEqual({ purpose: "donation" });
  });

  it("mapuje nieudane obciążenie faktury na transaction.payment_failed", () => {
    expect(normalized(event("invoice.payment_failed", invoice({ amount_paid: 0 }))).eventType).toBe(
      "transaction.payment_failed",
    );
  });

  it("bierze kwotę z total, gdy faktura nie niesie amount_paid", () => {
    const data = transactionOf(
      event("invoice.paid", invoice({ amount_paid: undefined, total: 9900 })),
    );

    expect(data.details?.totals?.grandTotal).toBe("9900");
  });

  it("nieudana faktura raportuje kwotę NALEŻNĄ, nie zapłacone zero", () => {
    // `amount_paid: 0` nie jest nullish, więc `amount_paid ?? total` wygrywało
    // z kwotą należną i windykacja dostawała amountCents = 0. Zero dodatkowo
    // blokowało fallback na cenę planu (`ctx.amountCents ?? plan?.priceCents`),
    // więc klient dostawał wezwanie do zapłaty na 0,00.
    const data = transactionOf(
      event("invoice.payment_failed", invoice({ amount_paid: 0, total: 9900 })),
    );

    expect(data.details?.totals?.grandTotal).toBe("9900");
  });

  it("faktura opłacona częściowo raportuje kwotę faktycznie zapłaconą", () => {
    const data = transactionOf(event("invoice.paid", invoice({ amount_paid: 4500, total: 9900 })));

    expect(data.details?.totals?.grandTotal).toBe("4500");
  });

  it("stempluje nieudaną fakturę statusem 'completed'", () => {
    // UWAGA: dokumentuje obecne zachowanie, patrz raport.
    const data = transactionOf(event("invoice.payment_failed", invoice({ amount_paid: 0 })));
    expect(data.status).toBe("completed");
  });

  it("nie wywraca się na fakturze bez pozycji i bez pól dokumentu", () => {
    const data = transactionOf(event("invoice.paid", { id: "in_pusta" }));

    expect(data).toMatchObject({
      id: "in_pusta",
      subscriptionId: null,
      customerId: null,
      currencyCode: null,
      customData: null,
      details: { totals: { grandTotal: null } },
      billingPeriod: { endsAt: null },
      invoiceNumber: null,
      hostedInvoiceUrl: null,
      invoicePdf: null,
      billedAt: null,
    });
  });
});

describe("normalizeStripeEvent - korekty rozliczeniowe", () => {
  it("mapuje zwrot z pozycji refunds.data", () => {
    const data = adjustmentOf(
      event("charge.refunded", {
        id: "ch_1",
        payment_intent: "pi_1",
        currency: "pln",
        amount_refunded: 4900,
        refunded: true,
        refunds: { data: [{ id: "re_1", status: "succeeded" }] },
      }),
    );

    expect(data).toEqual({
      id: "re_1",
      transactionId: "pi_1",
      subscriptionId: null,
      action: "refund",
      status: "succeeded",
      totals: { total: "4900", currencyCode: "PLN" },
    });
  });

  it("syntetyzuje identyfikator zwrotu i status, gdy operator nie dołączy refunds", () => {
    const data = adjustmentOf(
      event("charge.refunded", {
        id: "ch_2",
        currency: "pln",
        amount_refunded: 100,
        refunded: true,
      }),
    );

    expect(data.id).toBe("refund_ch_2");
    // Bez payment_intent kotwicą korekty zostaje samo obciążenie.
    expect(data.transactionId).toBe("ch_2");
    expect(data.status).toBe("succeeded");
  });

  it("zostawia status zwrotu pusty, gdy obciążenie nie jest oznaczone jako zwrócone", () => {
    const data = adjustmentOf(event("charge.refunded", { id: "ch_3", amount_refunded: 0 }));

    expect(data.status).toBeNull();
    expect(data.totals).toEqual({ total: "0", captured: "0", currencyCode: null });
  });

  it("mapuje obciążenie zwrotne (dispute)", () => {
    const data = adjustmentOf(
      event("charge.dispute.created", {
        id: "dp_1",
        charge: "ch_9",
        currency: "eur",
        amount: 2500,
        status: "needs_response",
      }),
    );

    expect(data).toEqual({
      id: "dp_1",
      transactionId: "ch_9",
      subscriptionId: null,
      action: "chargeback",
      status: "needs_response",
      totals: { total: "2500", currencyCode: "EUR" },
    });
  });

  it("mapuje notę kredytową na korektę powiązaną z fakturą", () => {
    const data = adjustmentOf(
      event("credit_note.created", {
        id: "cn_1",
        invoice: "in_1",
        currency: "pln",
        amount: 1200,
        status: "issued",
      }),
    );

    expect(data).toEqual({
      id: "cn_1",
      transactionId: "in_1",
      subscriptionId: null,
      action: "credit",
      status: "issued",
      totals: { total: "1200", currencyCode: "PLN" },
    });
  });

  it("każda korekta jedzie tym samym typem zdarzenia domenowego", () => {
    for (const type of ["charge.refunded", "charge.dispute.created", "credit_note.created"]) {
      expect(normalized(event(type, { id: "x" })).eventType).toBe("adjustment.created");
    }
  });

  it("zeruje kwotę korekty, gdy operator poda ją w nieliczbowej postaci", () => {
    const data = adjustmentOf(
      event("credit_note.created", { id: "cn_2", invoice: "in_2", amount: "1200" }),
    );

    expect(data.totals).toEqual({ total: "0", captured: "0", currencyCode: null });
  });
});

describe("normalizeStripeEvent - zakres integracji", () => {
  it("przekazuje customer.updated bez tłumaczenia (profil rozliczeniowy)", () => {
    const object = { id: "cus_1", email: "nowy@example.com" };
    const result = normalized(event("customer.updated", object));

    expect(result.eventType).toBe("customer.updated");
    expect(result.data).toBe(object);
  });

  it("zwraca null dla zdarzeń spoza zakresu integracji", () => {
    const outOfScope = [
      "payment_intent.succeeded",
      "invoice.created",
      "invoice.finalized",
      "customer.created",
      "charge.succeeded",
      "customer.subscription.trial_will_end",
      "checkout.session.expired",
      "",
    ];

    for (const type of outOfScope) {
      expect(normalizeStripeEvent(event(type, { id: "obj_1" })), type).toBeNull();
    }
  });

  it("nie wywraca się na zdarzeniu bez ładunku", () => {
    const bare = { id: "evt_1", type: "customer.subscription.created", created: 0 };
    const result = normalizeStripeEvent(bare as unknown as VerifiedWebhookEvent);

    expect(result?.eventType).toBe("subscription.created");
    expect((result?.data as SubscriptionData).id).toBe("");
  });

  it("jest czysta: ta sama dostawa daje ten sam wynik (bezpieczna ponowna obsługa)", () => {
    const e = event("invoice.paid", {
      id: "in_1",
      amount_paid: 2500,
      currency: "pln",
      metadata: { orderId: "ord_1" },
      lines: { data: [{ period: { end: 1_800_000_000 } }] },
      status_transitions: { paid_at: 1_790_000_000 },
    });
    const snapshot = structuredClone(e);

    expect(normalizeStripeEvent(e)).toEqual(normalizeStripeEvent(e));
    expect(e).toEqual(snapshot);
  });
});
