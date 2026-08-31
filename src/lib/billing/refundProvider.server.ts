// Zwroty transakcji jednorazowych zlecane przez system (nie przez operatora
// w panelu Stripe) - jedyny obecny przypadek to bilet opłacony w chwili, gdy
// ostatnie miejsce zajął ktoś inny (patrz `oneTimeFulfilment.server.ts`).
//
// Zastępuje dawny `paddleRefund.server.ts`. Zwrot Paddle -> `stripe.refunds.create`
// z `payment_intent` (Stripe nie zwraca po samym identyfikatorze transakcji,
// więc identyfikator wejściowy - id sesji Checkout albo PaymentIntent -
// rozwiązujemy do PaymentIntentu przed wywołaniem).
//
// KAŻDE zlecenie niesie KLUCZ IDEMPOTENCJI wyprowadzony ze zdarzenia
// (`refundIdempotencyKey`) - bez niego ponowione dostarczenie webhooka oddaje
// pieniądze DRUGI RAZ.
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

/** Limit klucza idempotencji u operatora. */
const IDEMPOTENCY_KEY_MAX = 255;

/**
 * Klucz idempotencji zlecenia zwrotu - WYPROWADZONY ZE ZDARZENIA, nigdy losowy.
 *
 * Droga podwójnego zwrotu jest konkretna: `oneTimeFulfilment.refundIfOversold`
 * najpierw oddaje pieniądze, a potem przestawia status zamówienia; wyjątek
 * z tego drugiego kroku zamienia się w HTTP 500, operator ponawia dostarczenie
 * zdarzenia i zwrot rusza DRUGI RAZ na tej samej transakcji. Klucz sprawia, że
 * operator oddaje wtedy TĘ SAMĄ korektę zamiast utworzyć nową. Losowy klucz nie
 * chroniłby przed niczym - stąd składanie go ze stałych danych zdarzenia.
 *
 * Domyślnie kluczem jest sama transakcja + powód (+ kwota przy zwrocie
 * częściowym). Wywołujący, który ma węższy uchwyt zdarzenia (identyfikator
 * zamówienia, korekty, zgłoszenia), przekazuje go jako `idempotencySeed` -
 * dwa RÓŻNE zwroty częściowe o tej samej kwocie i powodzie muszą się bowiem
 * kluczami różnić, inaczej drugi z nich odda korektę pierwszego.
 */
function refundIdempotencyKey(parts: readonly (string | number)[]): string {
  return parts.join(":").slice(0, IDEMPOTENCY_KEY_MAX);
}

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
  idempotencySeed?: string | null,
): Promise<RefundResult> {
  try {
    const stripe = createStripeClient(env);
    const paymentIntentId = await resolvePaymentIntentId(stripe, transactionId);
    if (!paymentIntentId) return { ok: false, error: "payment_intent_not_found" };

    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        reason: STRIPE_REFUND_REASON[reason],
        metadata: { reason_detail: REASON_TEXT[reason] },
      },
      {
        idempotencyKey: refundIdempotencyKey([
          "refund",
          "full",
          idempotencySeed ?? transactionId,
          reason,
        ]),
      },
    );
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
  idempotencySeed?: string | null,
): Promise<RefundResult> {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, error: "invalid_amount" };
  }
  try {
    const stripe = createStripeClient(env);
    const paymentIntentId = await resolvePaymentIntentId(stripe, transactionId);
    if (!paymentIntentId) return { ok: false, error: "payment_intent_not_found" };

    const amount = Math.round(amountCents);
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount,
        reason: STRIPE_REFUND_REASON[reason],
        metadata: { reason_detail: REASON_TEXT[reason] },
      },
      {
        // Kwota jest częścią klucza: dwie RÓŻNE korekty ceny na tej samej
        // transakcji muszą dojść obie, a ponowienie tej samej - tylko raz.
        idempotencyKey: refundIdempotencyKey([
          "refund",
          "partial",
          idempotencySeed ?? transactionId,
          reason,
          amount,
        ]),
      },
    );
    return { ok: true, adjustmentId: refund.id };
  } catch (e) {
    console.error("[payments] partial refund failed", transactionId, e);
    return { ok: false, error: getStripeErrorMessage(e) };
  }
}
