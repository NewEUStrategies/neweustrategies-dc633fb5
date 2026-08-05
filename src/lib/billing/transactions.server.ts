// Odczyt transakcji dostawcy płatności (PaymentIntent / Checkout Session /
// Invoice) - jedyna pozostała odpowiedzialność tego modułu po migracji na
// Stripe. Tworzenie transakcji (dawny kod Paddle) przeniosło się do
// `adhocCheckout.server.ts` (Stripe Embedded Checkout).
import type Stripe from "stripe";
import { createStripeClient, resolveEnvironment, type StripeEnv } from "@/lib/stripe.server";

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
  const stripe = createStripeClient(env);
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
          typeof paymentIntent.metadata?.userId === "string"
            ? paymentIntent.metadata.userId
            : null,
      };
    }
    return null;
  } catch (e) {
    console.error("[payments] transaction lookup failed", transactionId, e);
    return null;
  }
}
