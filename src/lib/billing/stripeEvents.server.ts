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

function numOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Kwoty sesji w walucie, w której powstało NASZE zamówienie. */
interface SessionAmounts {
  currency: string | null;
  total: number | null;
  subtotal: number | null;
  discount: number | null;
  tax: number | null;
}

/**
 * Kwoty sesji Checkout do porównania z zamówieniem: suma pozycji
 * (`amount_subtotal`), rabat i podatek (`total_details`).
 *
 * ADAPTIVE PRICING (sesje sprzed 2025-03-31): pola główne sesji są wtedy
 * w walucie KUPUJĄCEGO, a waluta zamówienia żyje w `currency_conversion`.
 * Porównanie z zamówieniem w PLN kwotą w EUR flagowałoby każdą taką wpłatę
 * jako rozjazd, a księgowanie zapisałoby obcą walutę - więc przechodzimy na
 * kwoty źródłowe. Operator podaje w źródłowej walucie tylko sumę pozycji
 * i sumę końcową; rabat wyprowadzamy z ich różnicy (dokładnie, gdy podatek
 * nie jest doliczany na wierzch), a podatek przeliczamy proporcją sum
 * pozycji - kurs zaokrąglony przez operatora nie wchodzi do rachunku.
 */
function sessionAmounts(session: Raw): SessionAmounts {
  const details = isRecord(session.total_details) ? session.total_details : null;
  const total = numOf(session.amount_total);
  const subtotal = numOf(session.amount_subtotal);
  const discount = numOf(details?.amount_discount);
  const tax = numOf(details?.amount_tax);
  const currency = strOf(session.currency)?.toUpperCase() ?? null;

  const conversion = isRecord(session.currency_conversion) ? session.currency_conversion : null;
  const sourceSubtotal = numOf(conversion?.amount_subtotal);
  const sourceTotal = numOf(conversion?.amount_total);
  const sourceCurrency = strOf(conversion?.source_currency)?.toUpperCase() ?? null;
  if (sourceSubtotal === null || sourceTotal === null || !sourceCurrency) {
    return { currency, total, subtotal, discount, tax };
  }

  const ratio = subtotal !== null && subtotal > 0 ? sourceSubtotal / subtotal : null;
  const toSource = (amount: number | null): number | null =>
    amount === null ? null : amount === 0 ? 0 : ratio === null ? null : Math.round(amount * ratio);
  // Podatek doliczony NA WIERZCH = suma końcowa minus (pozycje - rabat). Przy
  // podatku wliczonym w cenę ta różnica wynosi zero.
  const addedTax =
    total !== null && subtotal !== null ? Math.max(0, total - (subtotal - (discount ?? 0))) : null;
  const addedTaxSource = toSource(addedTax);
  return {
    currency: sourceCurrency,
    total: sourceTotal,
    subtotal: sourceSubtotal,
    discount:
      addedTaxSource === null
        ? toSource(discount)
        : Math.max(0, sourceSubtotal - (sourceTotal - addedTaxSource)),
    tax: toSource(tax),
  };
}

/**
 * Kody promocyjne operatora użyte w sesji. Pozycja `discounts` niesie albo
 * NASZ kupon (`coupon`, bez kodu), albo kod wpisany przez kupującego
 * (`promotion_code`) - id albo rozwinięty obiekt.
 */
function sessionPromotionCodeIds(session: Raw): string[] {
  const discounts = Array.isArray(session.discounts) ? session.discounts : [];
  const ids = discounts
    .map((discount) => (isRecord(discount) ? idOf(discount.promotion_code) : null))
    .filter((id): id is string => id !== null);
  return [...new Set(ids)];
}

/**
 * Stan płatności, który zdarzenie samo w sobie dowodzi - na wypadek ładunku
 * bez pola stanu. `invoice.paid` i opłacona sesja to zapłata z definicji;
 * zdarzenie porażki niczego takiego nie dowodzi.
 */
type ImpliedStatus = "paid" | null;

/**
 * Mapuje `checkout.session.*` na `TransactionData` (transakcja jednorazowa lub
 * pierwsza faktura) - z polami dokumentu rozliczeniowego dla `billingDocuments.server`.
 */
function mapTransactionFromCheckoutSession(
  session: Raw,
  impliedStatus: ImpliedStatus,
): TransactionData & Raw {
  const amounts = sessionAmounts(session);
  const customerDetails = isRecord(session.customer_details) ? session.customer_details : null;
  const subscriptionId = idOf(session.subscription);
  const subscriptionMode = strOf(session.mode) === "subscription" || subscriptionId !== null;

  return {
    id: idOf(session.id) ?? "",
    subscriptionId,
    customerId: idOf(session.customer),
    // Sesja checkout i intencja płatności to DWA różne identyfikatory. Zwroty
    // przychodzą z identyfikatorem intencji, więc bez zapisania go przy
    // realizacji żaden zwrot nie trafiłby we właściwe zamówienie.
    paymentIntentId: idOf(session.payment_intent),
    currencyCode: amounts.currency,
    customData: isRecord(session.metadata) ? session.metadata : null,
    customer: { email: strOf(customerDetails?.email) ?? strOf(session.customer_email) },
    details: {
      totals: { grandTotal: amounts.total !== null ? String(amounts.total) : null },
    },
    billingPeriod: null,
    source: "checkout_session",
    // Rozbicie kwoty: realizacja porównuje `subtotal - rabat` z kwotą
    // zamówienia (po NASZYM kuponie, przed podatkiem). Sama suma końcowa tego
    // nie rozstrzyga - kod promocyjny operatora i podatek doliczany na wierzch
    // zmieniają ją w przeciwne strony.
    amountSubtotalCents: amounts.subtotal,
    amountDiscountCents: amounts.discount,
    amountTaxCents: amounts.tax,
    promotionCodeIds: sessionPromotionCodeIds(session),
    // Pola dokumentu rozliczeniowego. Bez stanu zapis dostawał domyślne
    // `pending`, którego CHECK tabeli nie zna - bilet, darowizna i dostęp do
    // treści nie trafiały do rejestru członka WCALE (audyt INV-04).
    // Sesja SUBSKRYPCJI nie jest osobnym dokumentem: tę samą płatność opisuje
    // jej pierwsza faktura (`invoice.paid`, `in_...`), a drugi wiersz dla
    // `cs_...` dublowałby te same pieniądze w panelu członka.
    status: strOf(session.payment_status) ?? impliedStatus,
    documentKind: subscriptionMode ? null : "receipt",
  };
}

/** Mapuje `invoice.*` na `TransactionData` - dokłada pola potrzebne do dokumentu rozliczeniowego. */
function mapTransactionFromInvoice(
  invoice: Raw,
  impliedStatus: ImpliedStatus,
): TransactionData & Raw {
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
    // Bez rozbicia kwoty (`amountSubtotalCents` i reszta): `subtotal` faktury
    // ma już wliczone rabaty pozycji, więc `subtotal - rabat` liczyłby rabat
    // dwa razy. Porównanie z zamówieniem robi wyłącznie sesja Checkout.
    source: "invoice",
    // Pola dokumentu rozliczeniowego - odczytywane przez `billingDocuments.server`.
    // Stan to `invoice.status` operatora (draft/open/paid/void/uncollectible),
    // tłumaczony na stan rejestru w `billingDocumentStatus`. Wcześniej stało tu
    // stałe "completed" - także dla nieudanej płatności.
    status: strOf(invoice.status) ?? impliedStatus,
    documentKind: "invoice",
    invoiceNumber: strOf(invoice.number),
    hostedInvoiceUrl: strOf(invoice.hosted_invoice_url),
    invoicePdf: strOf(invoice.invoice_pdf),
    billedAt: paidAt,
  };
}

/** Spór otwarty u operatora: bank albo wydawca karty czeka na rozstrzygnięcie. */
const DISPUTE_OPEN_STATUSES: ReadonlySet<string> = new Set([
  "warning_needs_response",
  "warning_under_review",
  "needs_response",
  "under_review",
]);

/**
 * Spór zamknięty bez utraty pieniędzy - dostęp wraca.
 *
 * `won` - bank przyznał nam rację; `warning_closed` - zapytanie banku
 * (inquiry) zamknięte, środki nigdy nie zostały wycofane. Przywrócenie i tak
 * sprawdza u operatora, czy obciążenie nie zostało w międzyczasie zwrócone
 * (`refunds.server`): zapytanie zamknięte ZWROTEM też kończy się
 * `warning_closed`.
 */
const DISPUTE_WON_STATUSES: ReadonlySet<string> = new Set(["won", "warning_closed"]);

/**
 * Spór zakończony zwrotem pieniędzy klientowi.
 *
 * `lost` - bank rozstrzygnął na korzyść klienta; `prevented` - spór
 * zatrzymany przed formalnym obciążeniem zwrotnym przez zapobieganie sporom
 * (reguła Radar / RDR), które działa przez AUTOMATYCZNY ZWROT płatności.
 * Dawniej `prevented` był liczony jak wygrana - przywracał dostęp klientowi,
 * który miał już pieniądze z powrotem.
 */
const DISPUTE_LOST_STATUSES: ReadonlySet<string> = new Set(["lost", "prevented"]);

/** Skutek statusu sporu w słowniku domenowym `refunds.server`. */
export interface StripeDisputePhase {
  action: "chargeback" | "chargeback_warning";
  status: "open" | "reversed" | "approved";
}

/**
 * Status sporu Stripe -> słownik domenowy `refunds.server` (wcześniej
 * paddle'owy: `approved` / `reversed`). Bez tego tłumaczenia żaden status
 * Stripe nie przechodził przez bramki zwrotu: spór nie odbierał dostępu, nie
 * alarmował zespołu i - po wygranej - niczego nie przywracał.
 *
 *   otwarty (`needs_response`, `warning_*`...) -> `chargeback_warning`/`open`
 *     - dostęp znika od razu, rozstrzygnięcie trwa tygodniami;
 *   bez utraty środków (`won`, `warning_closed`) -> `reversed` - dostęp wraca;
 *   środki wróciły do klienta (`lost`, `prevented`) -> `chargeback`/`approved`
 *     - stan ostateczny.
 *
 * Status NIEZNANY traktujemy jak spór otwarty (bank już cofa środki), ale
 * GŁOŚNO - nowa wartość u operatora ma być widoczna w logu, a nie po cichu
 * odbierać dostęp.
 *
 * Eksport: `refunds.server` liczy skutek z BIEŻĄCEGO stanu sporu u operatora
 * (spóźnione `created` po `closed`) - tym samym słownikiem co normalizator.
 */
export function stripeDisputePhase(providerStatus: string | null): StripeDisputePhase {
  if (providerStatus && DISPUTE_WON_STATUSES.has(providerStatus)) {
    return { action: "chargeback", status: "reversed" };
  }
  if (providerStatus && DISPUTE_LOST_STATUSES.has(providerStatus)) {
    return { action: "chargeback", status: "approved" };
  }
  if (!providerStatus || !DISPUTE_OPEN_STATUSES.has(providerStatus)) {
    console.warn("[payments] unknown Stripe dispute status - treated as open", providerStatus);
  }
  return { action: "chargeback_warning", status: "open" };
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
        // Kwota pobrana pierwotnie - bez niej nie odróżnimy korekty ceny od
        // pełnej rezygnacji, bo `amount_refunded` sam w sobie tego nie mówi.
        captured: String(typeof object.amount === "number" ? object.amount : 0),
        currencyCode: strOf(object.currency)?.toUpperCase() ?? null,
      },
    };
  }

  if (action === "chargeback") {
    // `charge.dispute.created` / `charge.dispute.closed` - obiekt to Dispute.
    const providerStatus = strOf(object.status);
    const phase = stripeDisputePhase(providerStatus);
    return {
      id: idOf(object.id) ?? "",
      transactionId: idOf(object.payment_intent) ?? idOf(object.charge),
      subscriptionId: null,
      action: phase.action,
      status: phase.status,
      // Surowy status operatora - dla logów i alertu dla zespołu. Decyzję
      // o dostępie podejmuje WYŁĄCZNIE słownik domenowy wyżej.
      providerStatus,
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

/** Stany obiektu Refund, w których pieniądze NIE wrócą do kupującego. */
const UNSUCCESSFUL_REFUND_STATUSES = new Set(["failed", "canceled"]);

/**
 * Zwrot, którego operator nie wykonał: `refund.failed` albo `refund.updated`
 * (i starszy `charge.refund.updated`) ze stanem `failed`/`canceled`.
 *
 * DLACZEGO TYLKO PORAŻKA. Sukces zwrotu przychodzi jako `charge.refunded`
 * z kwotą NARASTAJĄCĄ (`amount_refunded`), na której stoi rachunek zwrotów
 * częściowych w `refunds.server`. Obiekt Refund niesie kwotę POJEDYNCZEGO
 * zwrotu - wpuszczony tą samą ścieżką cofnąłby licznik po drugim zwrocie
 * częściowym. Stąd `totals` celowo NIE ma: `refunds.server` przelicza stan
 * z obciążenia u operatora (inne zwroty tego obciążenia mogły się udać),
 * a zlecenie zwrotu zgłoszenia oddaje człowiekowi (`needs_review`).
 *
 * `null` = aktualizacja zwrotu bez porażki (np. `pending` -> `succeeded`).
 */
function mapRefundFailure(refund: Raw, eventType: string): Record<string, unknown> | null {
  // `refund.failed` jest porażką z definicji typu - nawet gdy ładunek
  // (np. odtworzony z dziennika) nie niesie pola `status`.
  const status = strOf(refund.status) ?? (eventType === "refund.failed" ? "failed" : null);
  if (!status || !UNSUCCESSFUL_REFUND_STATUSES.has(status)) return null;
  return {
    // Identyfikator ZWROTU (`re_…`/`pyr_…`) - ten sam, który zlecenie zwrotu
    // zapisało w `provider_refund_id` po `stripe.refunds.create`.
    id: idOf(refund.id) ?? "",
    transactionId: idOf(refund.payment_intent) ?? idOf(refund.charge),
    subscriptionId: null,
    action: "refund",
    status,
    // Kod operatora (`expired_or_canceled_card`, `lost_or_stolen_card`, …)
    // trafia do dziennika zwrotów i alarmu dla administratorów najemcy.
    failureReason: strOf(refund.failure_reason),
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
        data: mapTransactionFromCheckoutSession(object, "paid"),
      };
    }

    case "checkout.session.async_payment_succeeded":
      return {
        eventType: "transaction.completed",
        data: mapTransactionFromCheckoutSession(object, "paid"),
      };

    case "checkout.session.async_payment_failed":
      return {
        eventType: "transaction.payment_failed",
        data: mapTransactionFromCheckoutSession(object, null),
      };

    case "checkout.session.expired":
      return {
        eventType: "transaction.expired",
        data: mapTransactionFromCheckoutSession(object, null),
      };

    case "invoice.paid":
    case "invoice.payment_succeeded":
      return {
        eventType: "transaction.completed",
        data: mapTransactionFromInvoice(object, "paid"),
      };

    case "invoice.payment_failed":
      return {
        eventType: "transaction.payment_failed",
        data: mapTransactionFromInvoice(object, null),
      };

    case "charge.refunded":
      return { eventType: "adjustment.created", data: mapAdjustment(object, "refund") };

    case "refund.failed":
    case "refund.updated":
    case "charge.refund.updated": {
      const failure = mapRefundFailure(object, event.type);
      return failure ? { eventType: "adjustment.updated", data: failure } : null;
    }

    // Otwarcie i rozstrzygnięcie sporu jadą tym samym kształtem - o skutku
    // decyduje status sporu (`stripeDisputePhase`), nie typ zdarzenia.
    case "charge.dispute.created":
    case "charge.dispute.closed":
      return { eventType: "adjustment.created", data: mapAdjustment(object, "chargeback") };

    case "credit_note.created":
      return { eventType: "adjustment.created", data: mapAdjustment(object, "credit") };

    case "customer.updated":
      return { eventType: "customer.updated", data: object };

    default:
      return null;
  }
}
