// Normalizacja zdarzeń Stripe do istniejącego słownika zdarzeń domenowych.
//
// Warstwa domenowa (`webhookDispatch.server`, efekty, uprawnienia) pozostaje
// niezmieniona - ten moduł jest jedynym miejscem, w którym kształt Stripe
// zamienia się na `SubscriptionData` / `TransactionData` i typy zdarzeń, jakich
// oczekuje dyspozytor. Dzięki temu migracja z Paddle na Stripe nie dotyka
// logiki biznesowej.
//
// Czytelne identyfikatory cen/produktów: Stripe `lookup_key` (dla cen) albo
// `metadata.lovable_external_id` (fallback dla cen, jedyna droga dla
// produktów) - NIGDY `price_xxx`/`prod_xxx`. Brak czytelnego identyfikatora
// oznacza brak dopasowania do `BILLING_CATALOG` - dyspozytor i tak odrzuci
// takie zdarzenie (patrz `readIds` w `webhookDispatch.server.ts`).
import type { VerifiedWebhookEvent } from "@/lib/stripe.server";
import type { SubscriptionData, TransactionData } from "@/lib/billing/webhookDispatch.server";

/** Znormalizowane zdarzenie - gotowe do przekazania do `dispatchWebhookEvent`. */
export interface NormalizedStripeEvent {
  eventType: string;
  data: unknown;
}

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null;
}

/** Identyfikator z pola, które Stripe zwraca albo jako string, albo jako obiekt z `id`. */
function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.id === "string") return value.id;
  return null;
}

function strOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isoFromUnix(seconds: unknown): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/** Czytelny identyfikator ceny: `lookup_key`, fallback `metadata.lovable_external_id`. */
function readablePriceId(price: unknown): string | null {
  if (!isRecord(price)) return null;
  const lookupKey = strOf(price.lookup_key);
  if (lookupKey) return lookupKey;
  const metadata = isRecord(price.metadata) ? price.metadata : null;
  return strOf(metadata?.lovable_external_id);
}

/** Produkty nie mają `lookup_key` - jedynym źródłem jest metadata. */
function readableProductId(product: unknown): string | null {
  if (!isRecord(product)) return null;
  const metadata = isRecord(product.metadata) ? product.metadata : null;
  return strOf(metadata?.lovable_external_id);
}

function mapSubscriptionItems(sub: Raw): SubscriptionData["items"] {
  const itemsRaw = isRecord(sub.items) && Array.isArray(sub.items.data) ? sub.items.data : [];
  const trialEndsAt = isoFromUnix(sub.trial_end);

  return itemsRaw.map((rawItem, index) => {
    const item = isRecord(rawItem) ? rawItem : {};
    const price = item.price;
    const product = isRecord(price) ? price.product : undefined;
    const priceId = idOf(price) ?? "";
    const productId = idOf(product) ?? "";

    return {
      quantity: typeof item.quantity === "number" ? item.quantity : 1,
      // Stripe niesie okres próbny na poziomie subskrypcji, nie pozycji -
      // przypisujemy go do pierwszej pozycji, zgodnie z kontraktem dyspozytora.
      trialDates: index === 0 ? { endsAt: trialEndsAt } : null,
      price: {
        id: priceId,
        externalId: readablePriceId(price),
        trialPeriod: null,
      },
      product: {
        id: productId,
        externalId: readableProductId(product),
      },
    };
  });
}

/** Mapuje obiekt subskrypcji Stripe (API Basil) na `SubscriptionData`. */
export function mapStripeSubscription(sub: Raw): SubscriptionData {
  const items = mapSubscriptionItems(sub);
  const firstItem = isRecord(sub.items) && Array.isArray(sub.items.data) ? sub.items.data[0] : null;
  const item = isRecord(firstItem) ? firstItem : {};

  // Basil: okres rozliczeniowy żyje na pozycji, nie na subskrypcji - z
  // zachowaniem fallbacku na starsze pola subskrypcji dla bezpieczeństwa.
  const periodStart = item.current_period_start ?? sub.current_period_start;
  const periodEnd = item.current_period_end ?? sub.current_period_end;

  const metadata = isRecord(sub.metadata) ? sub.metadata : null;

  return {
    id: idOf(sub.id) ?? "",
    customerId: idOf(sub.customer) ?? "",
    status: strOf(sub.status) ?? "",
    customData: {
      userId: strOf(metadata?.userId) ?? undefined,
      purpose: strOf(metadata?.purpose) ?? undefined,
      donationId: strOf(metadata?.donationId) ?? undefined,
    },
    currentBillingPeriod: {
      startsAt: isoFromUnix(periodStart) ?? undefined,
      endsAt: isoFromUnix(periodEnd) ?? undefined,
    },
    scheduledChange: sub.cancel_at_period_end === true ? { action: "cancel" } : null,
    items,
  };
}

/** Zdarzenia stanu subskrypcji dzielą jeden kształt - różni je tylko `eventType`. */
function subscriptionEventType(status: string | null): string {
  switch (status) {
    case "trialing":
      return "subscription.trialing";
    case "past_due":
      return "subscription.past_due";
    case "paused":
      return "subscription.paused";
    default:
      return "subscription.updated";
  }
}

/** Mapuje `checkout.session.*` na `TransactionData` (transakcja jednorazowa lub pierwsza faktura). */
function mapTransactionFromCheckoutSession(session: Raw): TransactionData {
  const amountTotal = typeof session.amount_total === "number" ? session.amount_total : null;
  const customerDetails = isRecord(session.customer_details) ? session.customer_details : null;

  return {
    id: idOf(session.id) ?? "",
    subscriptionId: idOf(session.subscription),
    customerId: idOf(session.customer),
    // Sesja checkout i intencja płatności to DWA różne identyfikatory. Zwroty
    // przychodzą z identyfikatorem intencji, więc bez zapisania go przy
    // realizacji żaden zwrot nie trafiłby we właściwe zamówienie.
    paymentIntentId: idOf(session.payment_intent),
    currencyCode: strOf(session.currency)?.toUpperCase() ?? null,
    customData: isRecord(session.metadata) ? session.metadata : null,
    customer: { email: strOf(customerDetails?.email) ?? strOf(session.customer_email) },
    details: { totals: { grandTotal: amountTotal !== null ? String(amountTotal) : null } },
    billingPeriod: null,
  };
}

/** Mapuje `invoice.*` na `TransactionData` - dokłada pola potrzebne do dokumentu rozliczeniowego. */
function mapTransactionFromInvoice(invoice: Raw): TransactionData & Raw {
  const amountPaid = typeof invoice.amount_paid === "number" ? invoice.amount_paid : null;
  const amountDue = typeof invoice.total === "number" ? invoice.total : null;
  // `amount_paid` jest ZEROWE na nieudanej płatności - i zero nie jest nullish,
  // więc `amountPaid ?? amountDue` wygrywało z kwotą należną. Dunning czytał
  // stąd 0, co dodatkowo blokowało fallback na cenę planu
  // (`dunning.server.ts` -> `ctx.amountCents ?? plan?.priceCents`), i klient
  // dostawał wezwanie do zapłaty na 0,00. Zero traktujemy jako "nic nie
  // zapłacono", nie jako "tyle wynosi faktura".
  const grandTotal = amountPaid !== null && amountPaid > 0 ? amountPaid : (amountDue ?? amountPaid);
  const lines =
    isRecord(invoice.lines) && Array.isArray(invoice.lines.data) ? invoice.lines.data : [];
  const firstLine = isRecord(lines[0]) ? lines[0] : null;
  const period = isRecord(firstLine?.period) ? firstLine?.period : null;
  const transitions = isRecord(invoice.status_transitions) ? invoice.status_transitions : null;
  const paidAt = isoFromUnix(transitions?.paid_at) ?? isoFromUnix(invoice.created);

  // Basil przeniósł powiązanie z subskrypcją do `parent.subscription_details`,
  // a metadane odnowienia żyją tam albo na pozycji faktury - na samej fakturze
  // zwykle są puste. Bez tego fallbacku odnowienia darowizn byłyby nierozpoznane.
  const parent = isRecord(invoice.parent) ? invoice.parent : null;
  const subDetails = isRecord(parent?.subscription_details) ? parent?.subscription_details : null;
  const lineParent = isRecord(firstLine?.parent) ? firstLine?.parent : null;
  const lineSubDetails = isRecord(lineParent?.subscription_item_details)
    ? lineParent?.subscription_item_details
    : null;
  const subscriptionId =
    idOf(invoice.subscription) ??
    idOf(subDetails?.subscription) ??
    idOf(lineSubDetails?.subscription);
  const metadata =
    isRecord(invoice.metadata) && Object.keys(invoice.metadata).length > 0
      ? invoice.metadata
      : isRecord(subDetails?.metadata) && Object.keys(subDetails.metadata as Raw).length > 0
        ? (subDetails.metadata as Raw)
        : isRecord(firstLine?.metadata) && Object.keys(firstLine?.metadata as Raw).length > 0
          ? (firstLine?.metadata as Raw)
          : null;

  return {
    id: idOf(invoice.id) ?? "",
    subscriptionId,
    customerId: idOf(invoice.customer),
    currencyCode: strOf(invoice.currency)?.toUpperCase() ?? null,
    customData: metadata,
    customer: { email: strOf(invoice.customer_email) },
    details: { totals: { grandTotal: grandTotal !== null ? String(grandTotal) : null } },
    billingPeriod: { endsAt: isoFromUnix(period?.end) },
    // Pola dokumentu rozliczeniowego - odczytywane przez `billingDocuments.server`.
    status: "completed",
    invoiceNumber: strOf(invoice.number),
    hostedInvoiceUrl: strOf(invoice.hosted_invoice_url),
    invoicePdf: strOf(invoice.invoice_pdf),
    billedAt: paidAt,
  };
}

/** Korekty rozliczeniowe: zwrot, obciążenie zwrotne, nota kredytowa. */
function mapAdjustment(
  object: Raw,
  action: "refund" | "chargeback" | "credit",
): Record<string, unknown> {
  if (action === "refund") {
    // `charge.refunded` - obiekt to Charge, ewentualny zwrot jest w `refunds.data[0]`.
    const refunds =
      isRecord(object.refunds) && Array.isArray(object.refunds.data) ? object.refunds.data : [];
    const refund = isRecord(refunds[0]) ? refunds[0] : null;
    return {
      id: idOf(refund?.id) ?? `refund_${idOf(object.id) ?? ""}`,
      transactionId: idOf(object.payment_intent) ?? idOf(object.id),
      subscriptionId: null,
      action: "refund",
      status: strOf(refund?.status) ?? (object.refunded === true ? "succeeded" : null),
      totals: {
        total: String(typeof object.amount_refunded === "number" ? object.amount_refunded : 0),
        currencyCode: strOf(object.currency)?.toUpperCase() ?? null,
      },
    };
  }

  if (action === "chargeback") {
    // `charge.dispute.created` - obiekt to Dispute.
    return {
      id: idOf(object.id) ?? "",
      transactionId: idOf(object.payment_intent) ?? idOf(object.charge),
      subscriptionId: null,
      action: "chargeback",
      status: strOf(object.status),
      totals: {
        total: String(typeof object.amount === "number" ? object.amount : 0),
        currencyCode: strOf(object.currency)?.toUpperCase() ?? null,
      },
    };
  }

  // `credit_note.created` - obiekt to CreditNote.
  return {
    id: idOf(object.id) ?? "",
    transactionId: idOf(object.invoice),
    subscriptionId: null,
    action: "credit",
    status: strOf(object.status),
    totals: {
      total: String(typeof object.amount === "number" ? object.amount : 0),
      currencyCode: strOf(object.currency)?.toUpperCase() ?? null,
    },
  };
}

/**
 * Mapuje zweryfikowane zdarzenie Stripe na kształt oczekiwany przez
 * `dispatchWebhookEvent`. Zwraca `null` dla zdarzeń spoza zakresu integracji
 * (np. `checkout.session.completed` z `payment_status: "unpaid"`).
 */
export function normalizeStripeEvent(event: VerifiedWebhookEvent): NormalizedStripeEvent | null {
  const object = (event.data?.object ?? {}) as Raw;

  switch (event.type) {
    case "customer.subscription.created":
      return { eventType: "subscription.created", data: mapStripeSubscription(object) };

    case "customer.subscription.updated": {
      const status = strOf(object.status);
      return { eventType: subscriptionEventType(status), data: mapStripeSubscription(object) };
    }

    case "customer.subscription.deleted":
      return { eventType: "subscription.canceled", data: mapStripeSubscription(object) };

    case "customer.subscription.resumed":
      return { eventType: "subscription.resumed", data: mapStripeSubscription(object) };

    case "checkout.session.completed": {
      // Sesja "unpaid" (np. przelew w toku) nie ma jeszcze pieniędzy na koncie -
      // realizacja przyjdzie dopiero z `checkout.session.async_payment_succeeded`.
      if (strOf(object.payment_status) === "unpaid") return null;
      return {
        eventType: "transaction.completed",
        data: mapTransactionFromCheckoutSession(object),
      };
    }

    case "checkout.session.async_payment_succeeded":
      return {
        eventType: "transaction.completed",
        data: mapTransactionFromCheckoutSession(object),
      };

    case "checkout.session.async_payment_failed":
      return {
        eventType: "transaction.payment_failed",
        data: mapTransactionFromCheckoutSession(object),
      };

    case "invoice.paid":
    case "invoice.payment_succeeded":
      return { eventType: "transaction.completed", data: mapTransactionFromInvoice(object) };

    case "invoice.payment_failed":
      return { eventType: "transaction.payment_failed", data: mapTransactionFromInvoice(object) };

    case "charge.refunded":
      return { eventType: "adjustment.created", data: mapAdjustment(object, "refund") };

    case "charge.dispute.created":
      return { eventType: "adjustment.created", data: mapAdjustment(object, "chargeback") };

    case "credit_note.created":
      return { eventType: "adjustment.created", data: mapAdjustment(object, "credit") };

    case "customer.updated":
      return { eventType: "customer.updated", data: object };

    default:
      return null;
  }
}
