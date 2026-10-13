// Dokumenty rozliczeniowe (faktury) dla płatności u operatora.
//
// Numer faktury nadaje operator - czasem dopiero PO `transaction.completed`,
// osobnym zdarzeniem `transaction.updated`. Dlatego zapis jest idempotentny i
// aktualizujący: pierwsze zdarzenie zakłada dokument, kolejne uzupełniają
// numer i kwotę. Adres pliku PDF pobieramy na żądanie (`invoice.server`), bo
// operator wystawia wyłącznie linki czasowe.
//
// POWIĄZANIE Z ZAMÓWIENIEM (S7, 4.3 / 5.4). Historia płatności klienta
// (`mergePaymentHistory`) chowa zamówienie, które przykrywa jego dokument -
// po `billing_documents.order_id`. Dokument bez tego pola stał w historii
// OBOK opłaconego zamówienia: każdy zakup jednorazowy dwa razy, a pierwsza
// płatność subskrypcji wyglądała jak podwójne obciążenie. Zamówienie bierzemy
// wyłącznie z NASZEJ bazy: po identyfikatorze transakcji, który stempluje
// realizacja, albo po `orderId` z metadanych sprawdzonym z naszym wierszem
// (środowisko, rodzaj, subskrypcja, właściciel). Ładunek operatora jest tu
// tylko kluczem wyszukiwania - właściciel i najemca zawsze z naszego wiersza.
//
// WŁAŚCICIEL PIERWSZEJ FAKTURY (4.4 / 5.5 / 6.9). `invoice.paid` potrafi
// przyjść przed `customer.subscription.created` (Stripe wysyła je równolegle);
// bez wiersza `subscriptions` faktura nie miała właściciela i przepadała bez
// śladu i bez ponowienia. Zapasem jest zamówienie z metadanych subskrypcji.
//
// Moduł server-only (klient service_role).
import type { StripeEnv } from "@/lib/stripe.server";
import type { BillingDocumentStatus } from "@/lib/billing/types";

type Raw = Record<string, unknown>;

const str = (row: Raw | null | undefined, key: string): string | null => {
  const value = row?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export interface TransactionDocumentInput {
  transactionId: string;
  subscriptionId: string | null;
  /**
   * NASZE zamówienie z metadanych transakcji (`orderId`, ustawia kasa). Tylko
   * klucz wyszukiwania - wiązanie i właściciela rozstrzyga nasz wiersz.
   */
  orderId?: string | null;
  amountCents: number | null;
  currency: string | null;
  invoiceNumber: string | null;
  /** Link do faktury hostowanej przez Stripe (`hosted_invoice_url`). */
  hostedUrl: string | null;
  /** Link do PDF faktury (`invoice_pdf`) - czasem gotowy dopiero po chwili. */
  pdfUrl: string | null;
  status: string | null;
  issuedAt: string | null;
  environment: StripeEnv;
}

/** Właściciel dokumentu i zamówienie, które dokument przykrywa w historii. */
interface DocumentOwner {
  userId: string;
  tenantId: string;
  /** Zamówienie, do którego dokument wolno przypiąć (`null` = żadne). */
  orderId: string | null;
}

/** Zamówienie w kształcie potrzebnym do ustalenia właściciela i powiązania. */
interface OwnerOrder {
  id: string;
  user_id: string | null;
  tenant_id: string;
  kind: string;
  provider_intent_id: string | null;
  provider_subscription_id: string | null;
}

const ORDER_COLUMNS = "id, user_id, tenant_id, kind, provider_intent_id, provider_subscription_id";

/** Błąd odczytu właściciela: ślad w logu, dokument pominięty (nie wywraca webhooka). */
class OwnerLookupError extends Error {}

/**
 * Zamówienie subskrypcji z metadanych faktury - wyłącznie wtedy, gdy nasz
 * wiersz potwierdza powiązanie: to samo środowisko, rodzaj `subscription`
 * i ta sama subskrypcja operatora (albo jeszcze żadna - domknięcie
 * zamówienia mogło nie zdążyć zapisać identyfikatora).
 */
async function subscriptionOrderFor(input: TransactionDocumentInput): Promise<OwnerOrder | null> {
  if (!input.orderId || !input.subscriptionId) return null;
  const supabase = await admin();
  const { data, error } = await supabase
    .from("payment_orders")
    .select(ORDER_COLUMNS)
    .eq("id", input.orderId)
    .eq("environment", input.environment)
    .maybeSingle();
  if (error) throw new OwnerLookupError(`subscription order lookup failed: ${error.message}`);
  const order = data as OwnerOrder | null;
  if (!order || order.kind !== "subscription") return null;
  if (order.provider_subscription_id && order.provider_subscription_id !== input.subscriptionId) {
    return null;
  }
  return order;
}

/**
 * Czy dokument tej transakcji ma przykryć zamówienie subskrypcji. Faktura,
 * która je opłaciła (`provider_intent_id` - trial), albo pierwszy dokument
 * zamówienia. Odnowienia niosą to samo `orderId` w metadanych subskrypcji,
 * ale NIE są zakupem z zamówienia - przypięte dostałyby z historii rabat
 * kuponu, którego nie miały.
 */
async function coversSubscriptionOrder(
  order: OwnerOrder,
  input: TransactionDocumentInput,
): Promise<boolean> {
  if (order.provider_intent_id === input.transactionId) return true;
  const supabase = await admin();
  const { data, error } = await supabase
    .from("billing_documents")
    .select("id")
    .eq("order_id", order.id)
    .neq("provider_document_id", input.transactionId)
    .limit(1)
    .maybeSingle();
  if (error) throw new OwnerLookupError(`order document lookup failed: ${error.message}`);
  return !data;
}

/** Właściciel i tenant transakcji - z subskrypcji albo z zamówienia. */
async function ownerFor(input: TransactionDocumentInput): Promise<DocumentOwner | null> {
  const supabase = await admin();

  if (input.subscriptionId) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("user_id, tenant_id")
      .eq("provider_subscription_id", input.subscriptionId)
      .eq("environment", input.environment)
      .maybeSingle();
    if (error) throw new OwnerLookupError(`subscription lookup failed: ${error.message}`);
    const order = await subscriptionOrderFor(input);
    if (data?.user_id) {
      // Zamówienie innego konta albo najemcy niż subskrypcja nie jest tym
      // zakupem - dokument zostaje bez powiązania.
      const linked =
        order && order.user_id === data.user_id && order.tenant_id === data.tenant_id
          ? (await coversSubscriptionOrder(order, input))
            ? order.id
            : null
          : null;
      return { userId: data.user_id, tenantId: data.tenant_id, orderId: linked };
    }
    // Pierwsza faktura przed `customer.subscription.created`: właściciel
    // z NASZEGO zamówienia subskrypcji.
    if (order?.user_id) {
      return {
        userId: order.user_id,
        tenantId: order.tenant_id,
        orderId: (await coversSubscriptionOrder(order, input)) ? order.id : null,
      };
    }
  }

  // Zawężenie do środowiska jest TU tak samo obowiązkowe jak w gałęzi
  // subskrypcyjnej wyżej: identyfikator transakcji z piaskownicy i z produkcji
  // może się powtórzyć, a ustalony tu właściciel trafia wprost do dokumentu
  // księgowego (`user_id`, `tenant_id`) - pomyłka to cudza faktura w cudzym
  // panelu. Historyczne zamówienia sprzed kolumny mają z migracji
  // `20260731220000_payment_orders_environment_isolation` wartość 'live', więc
  // filtr nie odcina im dokumentów dla ruchu produkcyjnego. Zamówienie
  // znalezione po identyfikatorze, który stempluje realizacja, JEST zakupem
  // tej transakcji - dokument je przykrywa.
  const { data: order, error } = await supabase
    .from("payment_orders")
    .select("id, user_id, tenant_id")
    .eq("provider_intent_id", input.transactionId)
    .eq("environment", input.environment)
    .maybeSingle();
  if (error) throw new OwnerLookupError(`order lookup failed: ${error.message}`);
  if (order?.user_id) {
    return { userId: order.user_id, tenantId: order.tenant_id, orderId: order.id };
  }

  return null;
}

/**
 * Status dokumentu w słowniku tabeli (`CHECK (status IN ('paid', 'open',
 * 'void', 'refunded'))`). Status spoza słownika (`pending`, `past_due`,
 * `draft`) przegrywał z ograniczeniem bazy, a zapis kończył się cichym
 * „pominięto" - dokument nie powstawał wcale. Wszystko, co nie jest
 * zapłatą, unieważnieniem ani zwrotem, to dokument otwarty.
 */
function documentStatus(status: string | null): BillingDocumentStatus {
  switch (status) {
    case "completed":
    case "paid":
      return "paid";
    case "void":
    case "refunded":
      return status;
    default:
      return "open";
  }
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
  let owner: DocumentOwner | null;
  try {
    owner = await ownerFor(input);
  } catch (err) {
    if (!(err instanceof OwnerLookupError)) throw err;
    console.error(
      "[payments] billing document owner lookup failed",
      input.transactionId,
      err.message,
    );
    return "skipped";
  }
  if (!owner) return "skipped";

  const supabase = await admin();
  const { data: existing, error: loadError } = await supabase
    .from("billing_documents")
    .select("id, number, amount_cents, status, order_id")
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

  const status = documentStatus(input.status);
  const amount = Number.isFinite(input.amountCents ?? NaN) ? (input.amountCents as number) : 0;

  if (existing) {
    const patch: {
      updated_at: string;
      number?: string;
      amount_cents?: number;
      status?: string;
      hosted_url?: string;
      pdf_url?: string;
      order_id?: string;
    } = { updated_at: new Date().toISOString() };
    if (input.invoiceNumber && input.invoiceNumber !== existing.number) {
      patch.number = input.invoiceNumber;
    }
    if (amount > 0 && amount !== existing.amount_cents) patch.amount_cents = amount;
    if (status !== existing.status) patch.status = status;
    if (input.hostedUrl) patch.hosted_url = input.hostedUrl;
    if (input.pdfUrl) patch.pdf_url = input.pdfUrl;
    // Dokument zapisany przed powiązaniem (stara wersja, wyścig z realizacją)
    // dostaje zamówienie przy kolejnej dostawie; raz zapisanego nie zmieniamy.
    if (owner.orderId && !existing.order_id) patch.order_id = owner.orderId;
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
    provider: "stripe",
    provider_document_id: input.transactionId,
    kind: "invoice",
    number: input.invoiceNumber,
    hosted_url: input.hostedUrl,
    pdf_url: input.pdfUrl,
    amount_cents: amount,
    currency: (input.currency ?? "EUR").toUpperCase(),
    status,
    issued_at: input.issuedAt ?? new Date().toISOString(),
    user_id: owner.userId,
    tenant_id: owner.tenantId,
    order_id: owner.orderId,
  });
  if (error) {
    // Wyścig dwóch zdarzeń o tę samą transakcję - drugi zapis przegrywa na
    // unikalności i to jest poprawny wynik, nie błąd.
    console.warn("[payments] billing document insert skipped", input.transactionId, error.message);
    return "skipped";
  }
  return "created";
}

/**
 * Odczyt pól dokumentu ze znormalizowanej transakcji Stripe (faktura albo
 * sesja Checkout - `stripeEvents.server` dokłada `invoiceNumber`,
 * `hostedInvoiceUrl` i `invoicePdf` przy mapowaniu zdarzeń `invoice.*`).
 *
 * `fallbackStatus` obowiązuje, gdy ładunek nie niesie statusu: sesja Checkout
 * go nie ma, a jej `transaction.completed` znaczy „opłacone" - bez zapasu
 * dokument zakupu jednorazowego zapisywał się jako `pending`.
 */
export function documentInputFromTransaction(
  data: unknown,
  environment: StripeEnv,
  fallbackStatus: string | null = null,
): TransactionDocumentInput | null {
  const row = (data ?? {}) as Raw;
  const id = str(row, "id");
  if (!id) return null;
  const totals = (row.details as Raw | undefined)?.totals as Raw | undefined;
  const grand =
    typeof totals?.grandTotal === "string" ? Number.parseInt(totals.grandTotal, 10) : NaN;
  const customData =
    row.customData !== null && typeof row.customData === "object" && !Array.isArray(row.customData)
      ? (row.customData as Raw)
      : null;
  return {
    transactionId: id,
    subscriptionId: str(row, "subscriptionId"),
    orderId: str(customData, "orderId") ?? str(customData, "order_id"),
    amountCents: Number.isFinite(grand) ? grand : null,
    currency: str(row, "currencyCode"),
    invoiceNumber: str(row, "invoiceNumber"),
    hostedUrl: str(row, "hostedInvoiceUrl"),
    pdfUrl: str(row, "invoicePdf"),
    status: str(row, "status") ?? fallbackStatus,
    issuedAt: str(row, "billedAt") ?? str(row, "createdAt"),
    environment,
  };
}
