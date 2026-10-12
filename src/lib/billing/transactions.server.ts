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
    return { invoiceId, subscriptionId: subscriptionOfInvoice(invoice) };
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
    const metadata = session.metadata ?? {};
    const orderId = metadata.orderId ?? metadata.order_id;
    return {
      sessionId: session.id,
      orderId: typeof orderId === "string" && orderId.trim() ? orderId.trim() : null,
    };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}
