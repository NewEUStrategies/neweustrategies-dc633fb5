// Pobranie faktury/paragonu po numerze transakcji operatora płatności.
//
// Faktury nie są przechowywane u nas - Stripe (Merchant of Record) wystawia
// je i udostępnia pod własnym adresem. Tutaj zamieniamy numer transakcji
// (`in_...`, `cs_...`, `pi_...`, widoczny w mailu i w profilu) na taki adres,
// ale dopiero po potwierdzeniu, że transakcja należy do pytającego.
//
// DWA ZAKRESY, ŻADNEGO „BEZ KONTROLI". Pytający to albo właściciel (`userId`
// z sesji - profil), albo obsługa najemcy (`tenantId` z profilu
// administratora - panel). Do 12.10.2026 panel podawał `userId: null`, co
// wyłączało kontrolę w ogóle: edytor dowolnego najemcy pobierał hostowaną
// fakturę (NIP, adres nabywcy) KAŻDEJ transakcji na wspólnym koncie operatora.
// Wejście bez żadnego z dwóch zakresów jest odmową, nie domyślnym „wszystko".
//
// Moduł jest server-only (klucze bramki + service role).
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { getStripeClient, type StripeEnv } from "@/lib/stripe.server";
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

/**
 * Czy transakcja należy do najemcy `tenantId` w środowisku `environment`?
 * Ścieżka obsługi zgłoszeń (panel administratora).
 *
 * Każda z czterech ścieżek dowodu jest zawężona do najemcy I środowiska -
 * klucz serwisowy omija RLS, więc te filtry SĄ granicą:
 *   1. zamówienie w naszej bazie z tym numerem,
 *   2. subskrypcja operatora z obiektu transakcji,
 *   3. `metadata.userId` z checkoutu - konto, którego profil jest w najemcy,
 *   4. klient operatora - tylko gdy WSZYSTKIE jego subskrypcje w tym
 *      środowisku są w tym najemcy. Ten sam klient bywa współdzielony między
 *      najemcami (jedno konto operatora), a wtedy sam identyfikator klienta nie
 *      rozstrzyga, czyja jest ta konkretna płatność - rozstrzygają ścieżki 1-3.
 * Błąd odczytu to odmowa (brak wiersza), nie zgoda.
 */
async function tenantOwnsTransaction(
  supabase: SupabaseClient,
  tenantId: string,
  environment: StripeEnv,
  transactionId: string,
  owners: TransactionOwners,
): Promise<boolean> {
  const { data: order } = await supabase
    .from("payment_orders")
    .select("id")
    .eq("provider_intent_id", transactionId)
    .eq("tenant_id", tenantId)
    .eq("environment", environment)
    .limit(1)
    .maybeSingle();
  if (order) return true;

  if (owners.subscriptionId) {
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("provider_subscription_id", owners.subscriptionId)
      .eq("tenant_id", tenantId)
      .eq("environment", environment)
      .limit(1)
      .maybeSingle();
    if (sub) return true;
  }

  if (owners.userId) {
    const { data: member } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", owners.userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (member) return true;
  }

  if (owners.customerId) {
    const { data: rows, error } = await supabase
      .from("subscriptions")
      .select("tenant_id")
      .eq("provider_customer_id", owners.customerId)
      .eq("environment", environment);
    if (error || !Array.isArray(rows) || rows.length === 0) return false;
    return rows.every((row: { tenant_id: string | null }) => row.tenant_id === tenantId);
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

/** Kto pyta: właściciel transakcji ALBO obsługa najemcy - nigdy nikt. */
export type InvoiceLookupScope =
  | {
      /** Właściciel z sesji - kontrola własności (`ownsTransaction`). */
      userId: string;
      tenantId?: undefined;
    }
  | {
      /** Najemca administratora z sesji - kontrola przynależności (`tenantOwnsTransaction`). */
      tenantId: string;
      userId?: undefined;
    };

export type InvoiceLookupInput = {
  transactionId: string;
  environment: StripeEnv;
} & InvoiceLookupScope;

/** Zamienia numer transakcji na adres faktury/paragonu. Nigdy nie rzuca. */
export async function invoiceUrlForTransaction(input: InvoiceLookupInput): Promise<InvoiceResult> {
  const transactionId = input.transactionId.trim();
  if (!isTransactionId(transactionId)) return { ok: false, error: "invalid_transaction" };
  // Fail-closed PRZED pytaniem operatora: wejście bez zakresu (stary kontrakt
  // `userId: null`, pusty napis z błędnej sesji) nie ma prawa niczego pobrać.
  const userId = typeof input.userId === "string" && input.userId ? input.userId : null;
  const tenantId = typeof input.tenantId === "string" && input.tenantId ? input.tenantId : null;
  if (!userId && !tenantId) return { ok: false, error: "forbidden" };

  try {
    const owners = await retrieveTransactionOwners(input.environment, transactionId);
    if (!owners) return { ok: false, error: "not_found" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = supabaseAdmin as unknown as SupabaseClient;
    if (userId) {
      const allowed = await ownsTransaction(supabase, userId, transactionId, owners);
      if (!allowed) return { ok: false, error: "forbidden" };
    } else if (tenantId) {
      const allowed = await tenantOwnsTransaction(
        supabase,
        tenantId,
        input.environment,
        transactionId,
        owners,
      );
      // `not_found`, nie `forbidden`: konto operatora jest wspólne dla wielu
      // najemców, więc „istnieje, ale nie twoja" byłoby wyrocznią cudzych
      // transakcji. Dla obsługi najemcy obca transakcja po prostu nie istnieje.
      if (!allowed) return { ok: false, error: "not_found" };
    }

    const stripe = await getStripeClient(input.environment);
    const url = await resolveInvoiceUrl(stripe, transactionId);
    if (!url) return { ok: false, error: "invoice_unavailable" };
    return { ok: true, url, transactionId };
  } catch (err) {
    console.error("[billing] invoice lookup threw", err);
    return { ok: false, error: "invoice_unavailable" };
  }
}
