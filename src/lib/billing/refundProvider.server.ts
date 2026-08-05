// Zwroty transakcji jednorazowych zlecane przez system (nie przez operatora
// w panelu Stripe) - jedyny obecny przypadek to bilet opłacony w chwili, gdy
// ostatnie miejsce zajął ktoś inny (patrz `oneTimeFulfilment.server.ts`).
//
// Zastępuje dawny `paddleRefund.server.ts`. Zwrot Paddle -> `stripe.refunds.create`
// z `payment_intent` (Stripe nie zwraca po samym identyfikatorze transakcji,
// więc identyfikator wejściowy - id sesji Checkout albo PaymentIntent -
// rozwiązujemy do PaymentIntentu przed wywołaniem).
//
// Moduł jest server-only (klucze bramki) - importuj wyłącznie z handlerów.
import type Stripe from "stripe";
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from "@/lib/stripe.server";

export type RefundResult = { ok: true; adjustmentId: string | null } | { ok: false; error: string };

/** Dozwolone przez nas powody korekty - trafiają do `metadata`, bo enum Stripe jest węższy. */
export type RefundReason = "oversold" | "duplicate" | "error";

const REASON_TEXT: Record<RefundReason, string> = {
  oversold: "Event sold out before payment was fulfilled",
  duplicate: "Duplicate payment",
  error: "Fulfilment error",
};

/** Enum akceptowany przez `stripe.refunds.create` - węższy niż nasze powody domenowe. */
const STRIPE_REFUND_REASON: Record<RefundReason, Stripe.RefundCreateParams.Reason> = {
  oversold: "requested_by_customer",
  duplicate: "duplicate",
  error: "requested_by_customer",
};

/**
 * Zamienia referencję transakcji (id sesji Checkout albo PaymentIntent) na
 * identyfikator PaymentIntentu - jedyne, co przyjmuje `stripe.refunds.create`.
 */
async function resolvePaymentIntentId(
  stripe: Stripe,
  transactionId: string,
): Promise<string | null> {
  if (transactionId.startsWith("pi_")) return transactionId;
  if (transactionId.startsWith("cs_")) {
    const session = await stripe.checkout.sessions.retrieve(transactionId);
    const pi = session.payment_intent;
    if (!pi) return null;
    return typeof pi === "string" ? pi : pi.id;
  }
  return null;
}

/**
 * Pełny zwrot transakcji. Zwraca `ok: false` zamiast rzucać - wywołujący
 * decyduje, czy zablokować realizację, czy tylko zalogować problem.
 */
export async function refundTransactionFully(
  env: StripeEnv,
  transactionId: string,
  reason: RefundReason,
): Promise<RefundResult> {
  try {
    const stripe = createStripeClient(env);
    const paymentIntentId = await resolvePaymentIntentId(stripe, transactionId);
    if (!paymentIntentId) return { ok: false, error: "payment_intent_not_found" };

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: STRIPE_REFUND_REASON[reason],
      metadata: { reason_detail: REASON_TEXT[reason] },
    });
    return { ok: true, adjustmentId: refund.id };
  } catch (e) {
    console.error("[payments] full refund failed", transactionId, e);
    return { ok: false, error: getStripeErrorMessage(e) };
  }
}

/**
 * Zwrot częściowy - np. korekta ceny po reklamacji. `amountCents` musi być
 * dodatnią kwotą mniejszą niż oryginalne obciążenie (Stripe sam to waliduje).
 */
export async function refundTransactionPartially(
  env: StripeEnv,
  transactionId: string,
  amountCents: number,
  reason: RefundReason,
): Promise<RefundResult> {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, error: "invalid_amount" };
  }
  try {
    const stripe = createStripeClient(env);
    const paymentIntentId = await resolvePaymentIntentId(stripe, transactionId);
    if (!paymentIntentId) return { ok: false, error: "payment_intent_not_found" };

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: Math.round(amountCents),
      reason: STRIPE_REFUND_REASON[reason],
      metadata: { reason_detail: REASON_TEXT[reason] },
    });
    return { ok: true, adjustmentId: refund.id };
  } catch (e) {
    console.error("[payments] partial refund failed", transactionId, e);
    return { ok: false, error: getStripeErrorMessage(e) };
  }
}
