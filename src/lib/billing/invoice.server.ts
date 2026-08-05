// Pobranie faktury po numerze transakcji operatora płatności.
//
// Faktury nie są przechowywane u nas - operator (Merchant of Record) wystawia
// je i udostępnia pod krótkotrwałym, podpisanym adresem. Tutaj zamieniamy
// numer transakcji (`txn_...`, widoczny w mailu i w profilu) na taki adres,
// ale dopiero po potwierdzeniu, że transakcja należy do pytającego.
//
// Moduł jest server-only (klucze bramki + service role).
import type { SupabaseClient } from "@supabase/supabase-js";

import { gatewayFetch, type StripeEnv } from "@/lib/paddle.server";
import { isTransactionId } from "@/lib/billing/transactionId";

export type InvoiceError =
  | "invalid_transaction"
  | "not_found"
  | "forbidden"
  | "invoice_unavailable";

export type InvoiceResult =
  | { ok: true; url: string; transactionId: string }
  | { ok: false; error: InvoiceError };

interface TransactionOwners {
  customerId: string | null;
  subscriptionId: string | null;
  userId: string | null;
}

async function loadTransactionOwners(
  environment: StripeEnv,
  transactionId: string,
): Promise<TransactionOwners | null> {
  const res = await gatewayFetch(environment, `/transactions/${encodeURIComponent(transactionId)}`);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: {
      customer_id?: string | null;
      subscription_id?: string | null;
      custom_data?: Record<string, unknown> | null;
    };
  };
  const d = json.data;
  if (!d) return null;
  const rawUser = d.custom_data?.userId;
  return {
    customerId: d.customer_id ?? null,
    subscriptionId: d.subscription_id ?? null,
    userId: typeof rawUser === "string" ? rawUser : null,
  };
}

/**
 * Czy `userId` może zobaczyć fakturę tej transakcji?
 *
 * Trzy niezależne ścieżki - zamówienie w naszej bazie, `custom_data` z
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

export interface InvoiceLookupInput {
  transactionId: string;
  environment: StripeEnv;
  /** `null` pomija kontrolę własności - wyłącznie dla panelu administratora. */
  userId: string | null;
}

/** Zamienia numer transakcji na krótkotrwały adres faktury PDF. Nigdy nie rzuca. */
export async function invoiceUrlForTransaction(input: InvoiceLookupInput): Promise<InvoiceResult> {
  const transactionId = input.transactionId.trim();
  if (!isTransactionId(transactionId)) return { ok: false, error: "invalid_transaction" };

  try {
    const owners = await loadTransactionOwners(input.environment, transactionId);
    if (!owners) return { ok: false, error: "not_found" };

    if (input.userId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const supabase = supabaseAdmin as unknown as SupabaseClient;
      const allowed = await ownsTransaction(supabase, input.userId, transactionId, owners);
      if (!allowed) return { ok: false, error: "forbidden" };
    }

    const res = await gatewayFetch(
      input.environment,
      `/transactions/${encodeURIComponent(transactionId)}/invoice?disposition=attachment`,
    );
    if (!res.ok) {
      console.error("[billing] invoice lookup failed", transactionId, res.status);
      return { ok: false, error: "invoice_unavailable" };
    }
    const json = (await res.json()) as { data?: { url?: string | null } };
    const url = json.data?.url;
    if (!url) return { ok: false, error: "invoice_unavailable" };
    return { ok: true, url, transactionId };
  } catch (err) {
    console.error("[billing] invoice lookup threw", err);
    return { ok: false, error: "invoice_unavailable" };
  }
}
