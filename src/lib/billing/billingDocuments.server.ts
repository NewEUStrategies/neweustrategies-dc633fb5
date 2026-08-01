// Dokumenty rozliczeniowe (faktury) dla płatności u operatora.
//
// Numer faktury nadaje operator - czasem dopiero PO `transaction.completed`,
// osobnym zdarzeniem `transaction.updated`. Dlatego zapis jest idempotentny i
// aktualizujący: pierwsze zdarzenie zakłada dokument, kolejne uzupełniają
// numer i kwotę. Adres pliku PDF pobieramy na żądanie (`invoice.server`), bo
// operator wystawia wyłącznie linki czasowe.
//
// Moduł server-only (klient service_role).
import type { PaddleEnv } from "@/lib/paddle.server";

type Raw = Record<string, unknown>;

const str = (row: Raw, key: string): string | null => {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export interface TransactionDocumentInput {
  transactionId: string;
  subscriptionId: string | null;
  amountCents: number | null;
  currency: string | null;
  invoiceNumber: string | null;
  status: string | null;
  issuedAt: string | null;
  environment: PaddleEnv;
}

/** Właściciel i tenant transakcji - z subskrypcji albo z zamówienia. */
async function ownerFor(
  input: TransactionDocumentInput,
): Promise<{ userId: string; tenantId: string } | null> {
  const supabase = await admin();

  if (input.subscriptionId) {
    const { data } = await supabase
      .from("subscriptions")
      .select("user_id, tenant_id")
      .eq("paddle_subscription_id", input.subscriptionId)
      .eq("environment", input.environment)
      .maybeSingle();
    if (data?.user_id) return { userId: data.user_id, tenantId: data.tenant_id };
  }

  const { data: order } = await supabase
    .from("payment_orders")
    .select("user_id, tenant_id")
    .eq("provider_intent_id", input.transactionId)
    .maybeSingle();
  if (order?.user_id) return { userId: order.user_id, tenantId: order.tenant_id };

  return null;
}

/**
 * Zapisuje lub uzupełnia dokument rozliczeniowy dla transakcji.
 * Bez właściciela (płatność gościa bez konta) po prostu nic nie zapisujemy -
 * potwierdzenie idzie wtedy mailem, a nie do panelu.
 */
export async function recordTransactionDocument(
  input: TransactionDocumentInput,
): Promise<"created" | "updated" | "skipped"> {
  if (!input.transactionId) return "skipped";
  const owner = await ownerFor(input);
  if (!owner) return "skipped";

  const supabase = await admin();
  const { data: existing, error: loadError } = await supabase
    .from("billing_documents")
    .select("id, number, amount_cents, status")
    .eq("provider_document_id", input.transactionId)
    .maybeSingle();
  if (loadError) {
    console.error(
      "[payments] billing document lookup failed",
      input.transactionId,
      loadError.message,
    );
    return "skipped";
  }

  const status = input.status === "completed" ? "paid" : (input.status ?? "pending");
  const amount = Number.isFinite(input.amountCents ?? NaN) ? (input.amountCents as number) : 0;

  if (existing) {
    const patch: {
      updated_at: string;
      number?: string;
      amount_cents?: number;
      status?: string;
    } = { updated_at: new Date().toISOString() };
    if (input.invoiceNumber && input.invoiceNumber !== existing.number) {
      patch.number = input.invoiceNumber;
    }
    if (amount > 0 && amount !== existing.amount_cents) patch.amount_cents = amount;
    if (status !== existing.status) patch.status = status;
    if (Object.keys(patch).length === 1) return "skipped";

    const { error } = await supabase.from("billing_documents").update(patch).eq("id", existing.id);
    if (error) {
      console.error(
        "[payments] billing document update failed",
        input.transactionId,
        error.message,
      );
      return "skipped";
    }
    return "updated";
  }

  const { error } = await supabase.from("billing_documents").insert({
    provider: "paddle",
    provider_document_id: input.transactionId,
    kind: "invoice",
    number: input.invoiceNumber,
    amount_cents: amount,
    currency: (input.currency ?? "EUR").toUpperCase(),
    status,
    issued_at: input.issuedAt ?? new Date().toISOString(),
    user_id: owner.userId,
    tenant_id: owner.tenantId,
  });
  if (error) {
    // Wyścig dwóch zdarzeń o tę samą transakcję - drugi zapis przegrywa na
    // unikalności i to jest poprawny wynik, nie błąd.
    console.warn("[payments] billing document insert skipped", input.transactionId, error.message);
    return "skipped";
  }
  return "created";
}

/** Odczyt pól dokumentu z ładunku transakcji operatora. */
export function documentInputFromTransaction(
  data: unknown,
  environment: PaddleEnv,
): TransactionDocumentInput | null {
  const row = (data ?? {}) as Raw;
  const id = str(row, "id");
  if (!id) return null;
  const totals = (row.details as Raw | undefined)?.totals as Raw | undefined;
  const grand =
    typeof totals?.grandTotal === "string" ? Number.parseInt(totals.grandTotal, 10) : NaN;
  return {
    transactionId: id,
    subscriptionId: str(row, "subscriptionId"),
    amountCents: Number.isFinite(grand) ? grand : null,
    currency: str(row, "currencyCode"),
    invoiceNumber: str(row, "invoiceNumber"),
    status: str(row, "status"),
    issuedAt: str(row, "billedAt") ?? str(row, "createdAt"),
    environment,
  };
}
