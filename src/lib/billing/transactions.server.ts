// Odczyt transakcji dostawcy płatności (PaymentIntent / Checkout Session /
// Invoice) - jedyna pozostała odpowiedzialność tego modułu po migracji na
// Stripe. Tworzenie transakcji (dawny kod Paddle) przeniosło się do
// `adhocCheckout.server.ts` (Stripe Embedded Checkout).
import type Stripe from "stripe";
import { getStripeClient, resolveEnvironment, type StripeEnv } from "@/lib/stripe.server";

export { resolveEnvironment };
export type { StripeEnv };

/** Właściciel transakcji, wyprowadzony z obiektu Stripe. */
export interface TransactionOwners {
  customerId: string | null;
  subscriptionId: string | null;
  /** `metadata.userId` ustawiane przy tworzeniu sesji/subskrypcji. */
  userId: string | null;
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Odczytuje właściciela transakcji po jej referencji u Stripe. Referencją
 * może być identyfikator faktury (`in_...`), sesji Checkout (`cs_...`) albo
 * PaymentIntentu (`pi_...`) - dokładnie te trzy kształty zapisujemy jako
 * `provider_intent_id` / numer transakcji udostępniany klientowi.
 */
export async function retrieveTransactionOwners(
  env: StripeEnv,
  transactionId: string,
): Promise<TransactionOwners | null> {
  const stripe = await getStripeClient(env);
  try {
    if (transactionId.startsWith("in_")) {
      const invoice = await stripe.invoices.retrieve(transactionId);
      return {
        customerId: idOf(invoice.customer),
        subscriptionId: idOf(
          (invoice as unknown as { subscription?: Stripe.Subscription | string | null })
            .subscription,
        ),
        userId: typeof invoice.metadata?.userId === "string" ? invoice.metadata.userId : null,
      };
    }
    if (transactionId.startsWith("cs_")) {
      const session = await stripe.checkout.sessions.retrieve(transactionId);
      return {
        customerId: idOf(session.customer),
        subscriptionId: idOf(session.subscription),
        userId: typeof session.metadata?.userId === "string" ? session.metadata.userId : null,
      };
    }
    if (transactionId.startsWith("pi_")) {
      const paymentIntent = await stripe.paymentIntents.retrieve(transactionId);
      return {
        customerId: idOf(paymentIntent.customer),
        subscriptionId: null,
        userId:
          typeof paymentIntent.metadata?.userId === "string" ? paymentIntent.metadata.userId : null,
      };
    }
    return null;
  } catch (e) {
    console.error("[payments] transaction lookup failed", transactionId, e);
    return null;
  }
}

/**
 * Zasób, którego operator nie zna W TYM środowisku (404 / `resource_missing`).
 * To odpowiedź ostateczna - ponowienie webhooka niczego tu nie zmieni, więc
 * zamieniamy ją na „brak dopasowania", a nie na wyjątek z pętlą ponowień.
 */
function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; statusCode?: unknown; raw?: { code?: unknown } };
  return (
    e.code === "resource_missing" || e.raw?.code === "resource_missing" || e.statusCode === 404
  );
}

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null;
}

function refOf(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (isRecord(value) && typeof value.id === "string" && value.id) return value.id;
  return null;
}

/**
 * Subskrypcja, która wystawiła fakturę. Basil przeniósł powiązanie do
 * `parent.subscription_details`; starsze kształty niosły je w
 * `invoice.subscription` albo na pozycji faktury - ta sama kaskada co
 * w normalizatorze (`stripeEvents.server`).
 */
function isoFromUnix(seconds: unknown): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Pozycje faktury (pierwsza strona listy - tyle niesie obiekt faktury). */
function invoiceLines(invoice: Raw): Raw[] {
  const lines =
    isRecord(invoice.lines) && Array.isArray(invoice.lines.data) ? invoice.lines.data : [];
  return lines.filter(isRecord);
}

/**
 * Okres usługi opłacony fakturą: najwcześniejszy początek i NAJPÓŹNIEJSZY
 * koniec okresów pozycji. Faktura proracyjna (zmiana planu w trakcie cyklu)
 * niesie pozycje kończące się z bieżącym okresem - koniec jest tu tym, co
 * rozstrzyga, czy korekta dotyczy okresu, który jeszcze trwa.
 */
function invoiceServicePeriod(invoice: Raw): { start: string | null; end: string | null } {
  let start: number | null = null;
  let end: number | null = null;
  for (const line of invoiceLines(invoice)) {
    const period = isRecord(line.period) ? line.period : null;
    const lineStart = typeof period?.start === "number" ? period.start : null;
    const lineEnd = typeof period?.end === "number" ? period.end : null;
    if (lineStart !== null && (start === null || lineStart < start)) start = lineStart;
    if (lineEnd !== null && (end === null || lineEnd > end)) end = lineEnd;
  }
  return { start: isoFromUnix(start), end: isoFromUnix(end) };
}

/**
 * Metadane subskrypcji, która wystawiła fakturę - ta sama kaskada co
 * w normalizatorze: `parent.subscription_details.metadata` (Basil), potem
 * metadane faktury i pierwszej pozycji.
 */
function invoiceSubscriptionMetadata(invoice: Raw): Raw | null {
  const parent = isRecord(invoice.parent) ? invoice.parent : null;
  const details = isRecord(parent?.subscription_details) ? parent.subscription_details : null;
  const candidates = [details?.metadata, invoice.metadata, invoiceLines(invoice)[0]?.metadata];
  for (const candidate of candidates) {
    if (isRecord(candidate) && Object.keys(candidate).length > 0) return candidate;
  }
  return null;
}

function subscriptionOfInvoice(invoice: Raw): string | null {
  const parent = isRecord(invoice.parent) ? invoice.parent : null;
  const details = isRecord(parent?.subscription_details) ? parent.subscription_details : null;
  const lines =
    isRecord(invoice.lines) && Array.isArray(invoice.lines.data) ? invoice.lines.data : [];
  const firstLine = isRecord(lines[0]) ? lines[0] : null;
  const lineParent = isRecord(firstLine?.parent) ? firstLine.parent : null;
  const lineDetails = isRecord(lineParent?.subscription_item_details)
    ? lineParent.subscription_item_details
    : null;
  return (
    refOf(details?.subscription) ?? refOf(invoice.subscription) ?? refOf(lineDetails?.subscription)
  );
}

/** Faktura opłacona daną płatnością i subskrypcja, która ją wystawiła. */
export interface PaymentInvoiceRef {
  invoiceId: string;
  /** `null` = faktura bez subskrypcji (np. faktura po płatności jednorazowej). */
  subscriptionId: string | null;
  /**
   * Okres USŁUGI opłacony fakturą - z pozycji faktury (`lines.data[].period`),
   * nie z `invoice.period_*`. Pola faktury opisują okres naliczania zużycia,
   * czyli przy odnowieniu POPRZEDNI cykl; pozycja subskrypcji niesie okres,
   * za który klient płaci. `null` = faktura bez pozycji z okresem.
   */
  periodStart: string | null;
  periodEnd: string | null;
  /** `billing_reason` faktury (`subscription_create`, `subscription_cycle`...). */
  billingReason: string | null;
  /** `metadata.purpose` subskrypcji (np. `donation`) - kim jest płatnik. */
  purpose: string | null;
  /** `metadata.orderId` subskrypcji - nasze zamówienie z pierwszej kasy. */
  orderId: string | null;
}

/**
 * Do jakiej faktury (i subskrypcji) należy płatność wskazana przez zwrot albo
 * spór - `pi_...` (PaymentIntent) albo `ch_...` (obciążenie).
 *
 * DLACZEGO PRZEZ OPERATORA. Od API Basil obciążenie nie ma pola `invoice`,
 * a faktura - `payment_intent`; jedynym łącznikiem jest `InvoicePayment`.
 * Nasze zamówienia subskrypcyjne nie znają intencji płatności odnowień, więc
 * bez tego odczytu zwrot faktury odnowienia nie trafiał w nic i dostęp
 * zostawał u klienta, który dostał pieniądze z powrotem.
 *
 * Kontrakt błędów: brak zasobu u operatora -> `null` (nic do dopasowania);
 * każda inna awaria RZUCA - webhook kończy się 500 i operator ponawia, zamiast
 * po cichu zostawić dostęp po zwrocie.
 */
export async function resolvePaymentInvoice(
  env: StripeEnv,
  paymentRef: string,
): Promise<PaymentInvoiceRef | null> {
  const stripe = await getStripeClient(env);
  try {
    let paymentIntentId: string | null = paymentRef.startsWith("pi_") ? paymentRef : null;
    if (!paymentIntentId && paymentRef.startsWith("ch_")) {
      const charge = await stripe.charges.retrieve(paymentRef);
      paymentIntentId = refOf(charge.payment_intent);
    }
    if (!paymentIntentId) return null;

    const payments = await stripe.invoicePayments.list({
      payment: { type: "payment_intent", payment_intent: paymentIntentId },
      limit: 1,
      expand: ["data.invoice"],
    });
    const payment = payments.data[0];
    if (!payment) return null;

    let invoice: unknown = payment.invoice;
    if (typeof invoice === "string") invoice = await stripe.invoices.retrieve(invoice);
    if (!isRecord(invoice) || invoice.deleted === true) return null;
    const invoiceId = refOf(invoice.id);
    if (!invoiceId) return null;
    const period = invoiceServicePeriod(invoice);
    const metadata = invoiceSubscriptionMetadata(invoice);
    return {
      invoiceId,
      subscriptionId: subscriptionOfInvoice(invoice),
      periodStart: period.start,
      periodEnd: period.end,
      billingReason: textOf(invoice.billing_reason),
      purpose: textOf(metadata?.purpose),
      orderId: textOf(metadata?.orderId) ?? textOf(metadata?.order_id),
    };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/** Sesja Checkout, w której pobrano daną płatność, i zamówienie z jej metadanych. */
export interface PaymentCheckoutSession {
  sessionId: string;
  /** `metadata.orderId` sesji - stempel serwera z chwili tworzenia sesji. */
  orderId: string | null;
  /** `metadata.purpose` sesji (`donation` dla wpłaty z własnego formularza). */
  purpose: string | null;
  /** `metadata.donationId` - wiersz `donations` założony przy tworzeniu sesji. */
  donationId: string | null;
}

/**
 * Sesja Checkout, która pobrała PaymentIntent. Zwrot (albo spór) potrafi
 * przyjść ZANIM webhook realizacji zapisze intencję na zamówieniu - wtedy
 * zamówienie zna wyłącznie identyfikator sesji, a zwrot niesie `pi_...`.
 * Kontrakt błędów jak w `resolvePaymentInvoice`.
 */
export async function findCheckoutSessionForPayment(
  env: StripeEnv,
  paymentIntentId: string,
): Promise<PaymentCheckoutSession | null> {
  if (!paymentIntentId.startsWith("pi_")) return null;
  const stripe = await getStripeClient(env);
  try {
    const sessions = await stripe.checkout.sessions.list({
      payment_intent: paymentIntentId,
      limit: 1,
    });
    const session = sessions.data[0];
    if (!session?.id) return null;
    const metadata: Raw = session.metadata ?? {};
    return {
      sessionId: session.id,
      orderId: textOf(metadata.orderId) ?? textOf(metadata.order_id),
      purpose: textOf(metadata.purpose),
      donationId: textOf(metadata.donationId),
    };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/**
 * Stan zwrotów obciążenia u operatora - JEDYNE źródło prawdy o tym, ile
 * pieniędzy naprawdę wróciło do klienta.
 *
 * DLACZEGO NIE NASZ LICZNIK. `payment_orders.refunded_amount_cents` miesza dwa
 * źródła: zwroty i spór (otwarcie sporu zapisuje kwotę, którą wycofuje bank).
 * Wygrany spór nie mówi, czy w międzyczasie nie było PRAWDZIWEGO zwrotu
 * (zapytanie banku zamknięte zwrotem, zwrot przed sporem), a nieudany zwrot
 * (`refund.failed`) cofa licznik operatora w dół - nasz licznik rośnie tylko
 * w górę. Przywrócenie dostępu i przeliczenie po nieudanym zwrocie czytają
 * więc obciążenie: `amount`, `amount_refunded`, `refunded`, `disputed`.
 */
export interface PaymentRefundState {
  chargeId: string | null;
  /** Kwota obciążenia (waluta obciążenia). */
  amountCents: number;
  /** Suma zwrotów, które doszły do skutku (narastająco). */
  refundedCents: number;
  /** Obciążenie zwrócone w całości - dostęp nie ma prawa wrócić. */
  fullyRefunded: boolean;
  /** Obciążenie objęte sporem - o dostępie decyduje ścieżka sporu. */
  disputed: boolean;
  currency: string | null;
}

function refundStateOf(charge: Raw): PaymentRefundState {
  const amount = typeof charge.amount === "number" ? charge.amount : 0;
  const refunded = typeof charge.amount_refunded === "number" ? charge.amount_refunded : 0;
  return {
    chargeId: refOf(charge.id),
    amountCents: amount,
    refundedCents: refunded,
    fullyRefunded: charge.refunded === true || (amount > 0 && refunded >= amount),
    disputed: charge.disputed === true,
    currency: textOf(charge.currency)?.toUpperCase() ?? null,
  };
}

/**
 * Stan zwrotów płatności `pi_...` (PaymentIntent z rozwiniętym
 * `latest_charge`) albo obciążenia `ch_...`.
 *
 * Kontrakt błędów jak w `resolvePaymentInvoice`: brak zasobu -> `null`
 * (wołający nie może potwierdzić stanu i NIE przywraca dostępu), każda inna
 * awaria rzuca - webhook dostaje 500 i operator ponawia.
 */
export async function retrievePaymentRefundState(
  env: StripeEnv,
  paymentRef: string,
): Promise<PaymentRefundState | null> {
  if (!paymentRef.startsWith("pi_") && !paymentRef.startsWith("ch_")) return null;
  const stripe = await getStripeClient(env);
  try {
    let charge: unknown;
    if (paymentRef.startsWith("pi_")) {
      const intent: unknown = await stripe.paymentIntents.retrieve(paymentRef, {
        expand: ["latest_charge"],
      });
      charge = isRecord(intent) ? intent.latest_charge : null;
      if (typeof charge === "string") charge = await stripe.charges.retrieve(charge);
    } else {
      charge = await stripe.charges.retrieve(paymentRef);
    }
    return isRecord(charge) ? refundStateOf(charge) : null;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/** Bieżący stan sporu u operatora. */
export interface DisputeState {
  id: string;
  /** Surowy status Stripe (`needs_response`, `won`, `lost`, `prevented`...). */
  status: string | null;
  amountCents: number | null;
  currency: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
}

/**
 * Spór w stanie BIEŻĄCYM, a nie w stanie z chwili wysłania zdarzenia.
 *
 * Zdarzenia sporu nie mają strażnika kolejności: `charge.dispute.created`
 * ponowione (redelivery operatora, przegląd zaległych zdarzeń) PO
 * `charge.dispute.closed(won)` zawieszało dostęp klientowi, który spór już
 * wygrał - i nic go potem nie przywracało. Skutek liczymy więc ze stanu
 * sporu u operatora, jak autorytatywny odczyt subskrypcji przy remisie.
 *
 * Kontrakt błędów: brak zasobu -> `null`, każda inna awaria rzuca.
 */
export async function retrieveDisputeState(
  env: StripeEnv,
  disputeId: string,
): Promise<DisputeState | null> {
  const stripe = await getStripeClient(env);
  try {
    const dispute: unknown = await stripe.disputes.retrieve(disputeId);
    if (!isRecord(dispute)) return null;
    return {
      id: refOf(dispute.id) ?? disputeId,
      status: textOf(dispute.status),
      amountCents: typeof dispute.amount === "number" ? dispute.amount : null,
      currency: textOf(dispute.currency)?.toUpperCase() ?? null,
      paymentIntentId: refOf(dispute.payment_intent),
      chargeId: refOf(dispute.charge),
    };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/**
 * Subskrypcja w stanie BIEŻĄCYM (z produktem - mapowanie zna wtedy czytelny
 * identyfikator ceny). Przywrócenie dostępu po wygranym sporze i po nieudanym
 * zwrocie nadpisuje uprawnienie `refunded` (`force`), więc stan musi
 * pochodzić od operatora, a nie z wiersza `subscriptions`, który mógł się
 * zestarzeć. Kontrakt błędów jak wyżej.
 */
export async function retrieveSubscriptionState(
  env: StripeEnv,
  subscriptionId: string,
): Promise<Raw | null> {
  const stripe = await getStripeClient(env);
  try {
    const subscription: unknown = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price.product"],
    });
    return isRecord(subscription) && subscription.deleted !== true ? subscription : null;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}
