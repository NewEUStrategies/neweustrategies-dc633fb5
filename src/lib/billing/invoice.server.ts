// Pobranie faktury/paragonu po numerze transakcji operatora płatności.
//
// Faktury nie są przechowywane u nas - Stripe (Merchant of Record) wystawia
// je i udostępnia pod własnym adresem. Tutaj zamieniamy numer transakcji
// (`in_...`, `cs_...`, `pi_...`, widoczny w mailu i w profilu) na taki adres,
// ale dopiero po potwierdzeniu, że transakcja należy do pytającego.
//
// Moduł jest server-only (klucze bramki + service role).
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { isTransactionId } from "@/lib/billing/transactionId";
import { retrieveTransactionOwners } from "@/lib/billing/transactions.server";

export type InvoiceError =
  "invalid_transaction" | "not_found" | "forbidden" | "invoice_unavailable";

export type InvoiceResult =
  { ok: true; url: string; transactionId: string } | { ok: false; error: InvoiceError };

interface TransactionOwners {
  customerId: string | null;
  subscriptionId: string | null;
  userId: string | null;
}

/**
 * Czy `userId` może zobaczyć fakturę tej transakcji?
 *
 * Trzy niezależne ścieżki - zamówienie w naszej bazie, `metadata` z
 * checkoutu i identyfikator klienta z subskrypcji - bo transakcje powstają
 * w różnych przepływach (subskrypcja, bilet, darowizna, odblokowanie treści).
 */
async function ownsTransaction(
  supabase: SupabaseClient,
  userId: string,
  transactionId: string,
  owners: TransactionOwners,
): Promise<boolean> {
  if (owners.userId && owners.userId === userId) return true;

  const { data: order } = await supabase
    .from("payment_orders")
    .select("id")
    .eq("provider_intent_id", transactionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (order) return true;

  if (owners.customerId) {
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("user_id", userId)
      .eq("provider_customer_id", owners.customerId)
      .limit(1)
      .maybeSingle();
    if (sub) return true;
  }
  return false;
}

function chargeReceiptUrl(charge: Stripe.Charge | string | null | undefined): string | null {
  if (!charge || typeof charge === "string") return null;
  return charge.receipt_url ?? null;
}

/** Wydobywa adres dokumentu z sesji Checkout - faktura albo paragon z płatności. */
async function invoiceUrlFromSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<string | null> {
  if (session.invoice) {
    const invoiceId = typeof session.invoice === "string" ? session.invoice : session.invoice.id;
    const invoice = await stripe.invoices.retrieve(invoiceId);
    return invoice.hosted_invoice_url ?? invoice.invoice_pdf ?? null;
  }
  if (session.payment_intent) {
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent.id;
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
    return chargeReceiptUrl(paymentIntent.latest_charge);
  }
  return null;
}

/** Adres dokumentu rozliczeniowego dla danej referencji Stripe. Nigdy nie rzuca poza `try` wywołującego. */
async function resolveInvoiceUrl(stripe: Stripe, transactionId: string): Promise<string | null> {
  if (transactionId.startsWith("in_")) {
    const invoice = await stripe.invoices.retrieve(transactionId);
    return invoice.hosted_invoice_url ?? invoice.invoice_pdf ?? null;
  }
  if (transactionId.startsWith("cs_")) {
    const session = await stripe.checkout.sessions.retrieve(transactionId);
    return invoiceUrlFromSession(stripe, session);
  }
  if (transactionId.startsWith("pi_")) {
    const paymentIntent = await stripe.paymentIntents.retrieve(transactionId, {
      expand: ["latest_charge"],
    });
    return chargeReceiptUrl(paymentIntent.latest_charge);
  }
  return null;
}

export interface InvoiceLookupInput {
  transactionId: string;
  environment: StripeEnv;
  /** `null` pomija kontrolę własności - wyłącznie dla panelu administratora. */
  userId: string | null;
}

/** Zamienia numer transakcji na adres faktury/paragonu. Nigdy nie rzuca. */
export async function invoiceUrlForTransaction(input: InvoiceLookupInput): Promise<InvoiceResult> {
  const transactionId = input.transactionId.trim();
  if (!isTransactionId(transactionId)) return { ok: false, error: "invalid_transaction" };

  try {
    const owners = await retrieveTransactionOwners(input.environment, transactionId);
    if (!owners) return { ok: false, error: "not_found" };

    if (input.userId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const supabase = supabaseAdmin as unknown as SupabaseClient;
      const allowed = await ownsTransaction(supabase, input.userId, transactionId, owners);
      if (!allowed) return { ok: false, error: "forbidden" };
    }

    const stripe = createStripeClient(input.environment);
    const url = await resolveInvoiceUrl(stripe, transactionId);
    if (!url) return { ok: false, error: "invoice_unavailable" };
    return { ok: true, url, transactionId };
  } catch (err) {
    console.error("[billing] invoice lookup threw", err);
    return { ok: false, error: "invoice_unavailable" };
  }
}
