// Dokumenty rozliczeniowe (faktury, potwierdzenia płatności) dla płatności u operatora.
//
// Numer faktury nadaje operator - czasem dopiero PO `transaction.completed`,
// osobnym zdarzeniem `transaction.updated`. Dlatego zapis jest idempotentny i
// aktualizujący: pierwsze zdarzenie zakłada dokument, kolejne uzupełniają
// numer i kwotę. Adres pliku PDF pobieramy na żądanie (`invoice.server`), bo
// operator wystawia wyłącznie linki czasowe.
//
// STAN DOKUMENTU tłumaczy `billingDocumentStatus` - jedyne miejsce, które zna
// zbiór z CHECK-a tabeli. Przepisywanie stanu operatora dosłownie (z domyślnym
// `pending`) rozbijało na CHECK-u każdy zakup jednorazowy (audyt INV-04).
//
// AWARIA ZAPISU TO ALARM, NIE CISZA. Jedynym poprawnym powodem odrzucenia
// wstawienia jest unikalność (23505 - wyścig dwóch zdarzeń o tę samą
// transakcję). Każdy inny błąd oznacza dokument, którego członek nie zobaczy,
// więc idzie do logu jako błąd, do administratorów najemcy jako dzwonek
// (`notifyTenantAdmins`, ten sam kanał co spory płatnicze) i wraca jako
// `failed` - odróżnialny od świadomego `skipped`.
//
// Moduł server-only (klient service_role).
import {
  loadBillingDocumentSnapshot,
  snapshotColumns,
  type BillingDocumentSnapshot,
} from "@/lib/billing/billingDocumentSnapshot.server";
import {
  billingDocumentStatus,
  billingDocumentStatusTransition,
} from "@/lib/billing/billingDocumentStatus";
import type { BillingDocumentKind } from "@/lib/billing/types";
import type { StripeEnv } from "@/lib/stripe.server";

type Raw = Record<string, unknown>;

/** Postgres `unique_violation` - jedyny błąd wstawienia, który jest wynikiem poprawnym. */
const UNIQUE_VIOLATION = "23505";

export type RecordDocumentOutcome = "created" | "updated" | "skipped" | "failed";

const str = (row: Raw, key: string): string | null => {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export interface TransactionDocumentInput {
  transactionId: string;
  subscriptionId: string | null;
  amountCents: number | null;
  currency: string | null;
  invoiceNumber: string | null;
  /** Link do faktury hostowanej przez Stripe (`hosted_invoice_url`). */
  hostedUrl: string | null;
  /** Link do PDF faktury (`invoice_pdf`) - czasem gotowy dopiero po chwili. */
  pdfUrl: string | null;
  /** Stan u operatora, surowy - na stan rejestru tłumaczy go `billingDocumentStatus`. */
  status: string | null;
  /** Faktura operatora albo potwierdzenie płatności jednorazowej (sesja Checkout). */
  kind: Extract<BillingDocumentKind, "invoice" | "receipt">;
  issuedAt: string | null;
  environment: StripeEnv;
}

interface DocumentOwner {
  userId: string;
  tenantId: string;
  /** Zamówienie transakcji - `null`, gdy właściciela dała subskrypcja. */
  orderId: string | null;
}

/**
 * Właściciel i tenant transakcji - z subskrypcji albo z zamówienia. `null` =
 * transakcja bez właściciela (gość). Błąd odczytu RZUCA: „nie wiem, czyja to
 * transakcja" to nie to samo co „gość", a pomylenie ich chowało awarię bazy
 * pod cichym pominięciem dokumentu.
 */
async function ownerFor(input: TransactionDocumentInput): Promise<DocumentOwner | null> {
  const supabase = await admin();

  if (input.subscriptionId) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("user_id, tenant_id")
      .eq("provider_subscription_id", input.subscriptionId)
      .eq("environment", input.environment)
      .maybeSingle();
    if (error) throw new Error(`subscriptions lookup failed: ${error.message}`);
    if (data?.user_id) return { userId: data.user_id, tenantId: data.tenant_id, orderId: null };
  }

  // Zawężenie do środowiska jest TU tak samo obowiązkowe jak w gałęzi
  // subskrypcyjnej wyżej: identyfikator transakcji z piaskownicy i z produkcji
  // może się powtórzyć, a ustalony tu właściciel trafia wprost do dokumentu
  // księgowego (`user_id`, `tenant_id`) - pomyłka to cudza faktura w cudzym
  // panelu. Historyczne zamówienia sprzed kolumny mają z migracji
  // `20260731220000_payment_orders_environment_isolation` wartość 'live', więc
  // filtr nie odcina im dokumentów dla ruchu produkcyjnego.
  const { data: order, error } = await supabase
    .from("payment_orders")
    .select("id, user_id, tenant_id")
    .eq("provider_intent_id", input.transactionId)
    .eq("environment", input.environment)
    .maybeSingle();
  if (error) throw new Error(`payment_orders lookup failed: ${error.message}`);
  if (order?.user_id)
    return { userId: order.user_id, tenantId: order.tenant_id, orderId: order.id };

  return null;
}

/**
 * Odczyt albo zapis rejestru nie udał się z powodu innego niż wyścig: log
 * BŁĘDU, dzwonek dla administratorów najemcy dokumentu i wynik `failed`. Treść
 * alarmu niesie wyłącznie identyfikatory (transakcja, kod błędu) - żadnych
 * danych nabywcy.
 */
async function documentNotRecorded(
  owner: DocumentOwner,
  input: TransactionDocumentInput,
  operation: "lookup" | "insert" | "update",
  error: { message: string; code?: string },
): Promise<"failed"> {
  const code = error.code || "unknown";
  console.error(`[payments] billing document ${operation} failed`, input.transactionId, {
    code,
    message: error.message,
  });
  const { notifyTenantAdmins } = await import("@/lib/events/tenantAdminAlert.server");
  await notifyTenantAdmins({
    tenantId: owner.tenantId,
    kind: "billing",
    titlePl: "Nie zapisano dokumentu rozliczeniowego",
    titleEn: "Billing document not recorded",
    bodyPl: `Płatność ${input.transactionId} nie trafiła do rejestru dokumentów członka (błąd bazy ${code}). Sprawdź dziennik webhooków.`,
    bodyEn: `Payment ${input.transactionId} is missing from the member's document register (database error ${code}). Check the webhook log.`,
    href: "/admin/billing",
    icon: "credit-card",
  });
  return "failed";
}

/**
 * Zapisuje lub uzupełnia dokument rozliczeniowy dla transakcji.
 * Bez właściciela (płatność gościa bez konta) po prostu nic nie zapisujemy -
 * potwierdzenie idzie wtedy mailem, a nie do panelu.
 */
export async function recordTransactionDocument(
  input: TransactionDocumentInput,
): Promise<RecordDocumentOutcome> {
  if (!input.transactionId) return "skipped";
  let owner: DocumentOwner | null;
  try {
    owner = await ownerFor(input);
  } catch (e) {
    // Bez właściciela nie ma najemcy, któremu można wysłać dzwonek - zostaje
    // log błędu i dziennik webhooków (jak przy sporze bez najemcy).
    console.error("[payments] billing document owner lookup failed", input.transactionId, {
      message: errorMessage(e),
    });
    return "failed";
  }
  if (!owner) return "skipped";

  // Filtr najemcy także tu: dokument innego najemcy o tym samym
  // identyfikatorze nie może przyjąć danych tej transakcji.
  const supabase = await admin();
  const { data: existing, error: loadError } = await supabase
    .from("billing_documents")
    .select("id, number, amount_cents, status")
    .eq("provider_document_id", input.transactionId)
    .eq("tenant_id", owner.tenantId)
    .maybeSingle();
  if (loadError) return documentNotRecorded(owner, input, "lookup", loadError);

  // `null` = stan nieznany. Nowy dokument dostaje wtedy `open` (nie wolno
  // twierdzić, że zapłacono), a istniejący zostaje przy swoim - nieznany stan
  // nie może cofnąć opłaconej faktury.
  const status = billingDocumentStatus(input.status);
  const amount = Number.isFinite(input.amountCents ?? NaN) ? (input.amountCents as number) : 0;

  if (existing) {
    const patch: {
      updated_at: string;
      number?: string;
      amount_cents?: number;
      status?: string;
      hosted_url?: string;
      pdf_url?: string;
    } = { updated_at: new Date().toISOString() };
    if (input.invoiceNumber && input.invoiceNumber !== existing.number) {
      patch.number = input.invoiceNumber;
    }
    if (amount > 0 && amount !== existing.amount_cents) patch.amount_cents = amount;
    // Tylko do przodu: spóźnione albo ponowione zdarzenie nie cofa stanu
    // (np. `refunded` -> `paid`, `paid` -> `open`).
    const nextStatus = billingDocumentStatusTransition(existing.status, status);
    if (nextStatus !== null) patch.status = nextStatus;
    if (input.hostedUrl) patch.hosted_url = input.hostedUrl;
    if (input.pdfUrl) patch.pdf_url = input.pdfUrl;
    if (Object.keys(patch).length === 1) return "skipped";

    const { error } = await supabase
      .from("billing_documents")
      .update(patch)
      .eq("id", existing.id)
      .eq("tenant_id", owner.tenantId);
    if (error) return documentNotRecorded(owner, input, "update", error);
    return "updated";
  }

  // Migawka stron i płaszczyzny rozliczeń z CHWILI ZAKUPU (audyt INV-07).
  // Jej brak nie blokuje dokumentu - członek ma zobaczyć zakup od razu -
  // a migawkę zamrozi pierwsze pobranie PDF (`freezeBillingDocumentSnapshot`).
  const snapshot = await loadBillingDocumentSnapshot(owner).catch(
    (e: unknown): BillingDocumentSnapshot | null => {
      console.error("[payments] billing document snapshot unavailable", input.transactionId, {
        message: errorMessage(e),
      });
      return null;
    },
  );

  const { error } = await supabase.from("billing_documents").insert({
    provider: "stripe",
    provider_document_id: input.transactionId,
    kind: input.kind,
    number: input.invoiceNumber,
    hosted_url: input.hostedUrl,
    pdf_url: input.pdfUrl,
    amount_cents: amount,
    currency: (input.currency ?? "EUR").toUpperCase(),
    status: status ?? "open",
    issued_at: input.issuedAt ?? new Date().toISOString(),
    user_id: owner.userId,
    tenant_id: owner.tenantId,
    // Powiązanie z zamówieniem scala historię płatności (`mergePaymentHistory`):
    // bez niego zakup jednorazowy pokazałby się dwa razy - jako dokument i jako
    // zamówienie bez dokumentu.
    order_id: owner.orderId,
    ...(snapshot ? snapshotColumns(snapshot) : {}),
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // Wyścig dwóch zdarzeń o tę samą transakcję - drugi zapis przegrywa na
      // unikalności i to jest poprawny wynik, nie błąd.
      console.warn("[payments] billing document insert lost race", input.transactionId);
      return "skipped";
    }
    return documentNotRecorded(owner, input, "insert", error);
  }
  return "created";
}

/**
 * Odczyt pól dokumentu ze znormalizowanej transakcji Stripe (faktura albo
 * sesja Checkout - `stripeEvents.server` dokłada `status`, `documentKind`,
 * `invoiceNumber`, `hostedInvoiceUrl` i `invoicePdf`). `null` = transakcja nie
 * ma własnego dokumentu: brak identyfikatora albo `documentKind: null` (sesja
 * subskrypcji - dokumentem jest jej pierwsza faktura). Brak pola
 * `documentKind` (ładunek `transaction.updated`) znaczy fakturę.
 */
export function documentInputFromTransaction(
  data: unknown,
  environment: StripeEnv,
  fallbackStatus: string | null = null,
): TransactionDocumentInput | null {
  const row = (data ?? {}) as Raw;
  const id = str(row, "id");
  if (!id) return null;
  const kind = row.documentKind === undefined ? "invoice" : row.documentKind;
  if (kind !== "invoice" && kind !== "receipt") return null;
  const totals = (row.details as Raw | undefined)?.totals as Raw | undefined;
  const grand =
    typeof totals?.grandTotal === "string" ? Number.parseInt(totals.grandTotal, 10) : NaN;
  return {
    transactionId: id,
    subscriptionId: str(row, "subscriptionId"),
    amountCents: Number.isFinite(grand) ? grand : null,
    currency: str(row, "currencyCode"),
    invoiceNumber: str(row, "invoiceNumber"),
    hostedUrl: str(row, "hostedInvoiceUrl"),
    pdfUrl: str(row, "invoicePdf"),
    status: str(row, "status"),
    kind,
    issuedAt: str(row, "billedAt") ?? str(row, "createdAt"),
    environment,
  };
}
