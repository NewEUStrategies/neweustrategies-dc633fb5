// Złożenie potwierdzenia płatności (PDF) dla konkretnego dokumentu rozliczeniowego.
//
// Operator (Stripe jako Merchant of Record) wystawia własny dokument, ale nie
// zawsze: paragon zamiast faktury, dokument gotowy dopiero po chwili, link
// czasowy po wygaśnięciu. Panel faktur musi mimo to wydać plik - dlatego
// składamy własny PDF z danych, które i tak mamy w bazie.
//
// CO TO JEST, A CZYM NIE JEST (audyt INV-07). Plik to KOPIA z panelu członka -
// potwierdzenie płatności, nie faktura VAT organizatora (te wystawia moduł
// faktur wydarzeń). Dlatego:
//  * tytuł brzmi „Potwierdzenie płatności", a wiersz stanu bierze się ze
//    stanu DOKUMENTU (`billing_documents.status`) - zwrot to „Płatność
//    zwrócona", nie „Zapłacono";
//  * nabywca, sprzedawca i płaszczyzna rozliczeń pochodzą z MIGAWKI dokumentu
//    (`billingDocumentSnapshot.server`), nie z dzisiejszego profilu - zmiana
//    danych w profilu albo „Pobierz z CRM" nie przepisuje starych plików;
//  * nota o podatku zależy od płaszczyzny: adnotacja o operatorze (MoR) tylko
//    tam, gdzie podatek faktycznie rozlicza operator.
// Wszystko, co trafia na stronę, pochodzi z wiersza dokumentu i jego migawki,
// więc ten sam dokument daje zawsze te same bajty.
//
// Moduł jest server-only (klient service_role).
import {
  freezeBillingDocumentSnapshot,
  snapshotFromRow,
} from "@/lib/billing/billingDocumentSnapshot.server";
import { isBillingDocumentStatus } from "@/lib/billing/billingDocumentStatus";
import type { CheckoutBillingPlane } from "@/lib/billing/checkoutSettings";
import {
  pdfToBase64,
  renderInvoicePdf,
  type InvoiceData,
  type InvoiceLabels,
} from "@/lib/billing/invoicePdf";

export type InvoicePdfError = "not_found" | "forbidden";

export interface InvoicePdfResult {
  fileName: string;
  base64: string;
  number: string;
  /** Link do dokumentu operatora, jeśli istnieje - UI pokazuje go obok kopii. */
  providerUrl: string | null;
}

export type InvoiceLocale = "pl" | "en";

const LABELS: Record<InvoiceLocale, InvoiceLabels> = {
  pl: {
    title: "Potwierdzenie płatności",
    number: "Numer",
    issuedAt: "Data wystawienia",
    seller: "Sprzedawca",
    buyer: "Nabywca",
    taxId: "NIP / VAT ID",
    description: "Opis",
    quantity: "Ilość",
    amount: "Kwota brutto",
    total: "Razem",
    status: {
      paid: "Zapłacono - dokument nie wymaga podpisu.",
      open: "Oczekuje na płatność - dokument nie potwierdza zapłaty.",
      void: "Dokument unieważniony - płatność nie została pobrana.",
      refunded: "Płatność zwrócona.",
    },
  },
  en: {
    title: "Payment confirmation",
    number: "Number",
    issuedAt: "Issue date",
    seller: "Seller",
    buyer: "Buyer",
    taxId: "Tax ID / VAT ID",
    description: "Description",
    quantity: "Qty",
    amount: "Gross amount",
    total: "Total",
    status: {
      paid: "Paid - this document needs no signature.",
      open: "Awaiting payment - this document does not confirm payment.",
      void: "Document voided - no payment was collected.",
      refunded: "Payment refunded.",
    },
  },
};

/**
 * Nota pod tabelą: kto rozlicza podatek w płaszczyźnie z migawki dokumentu
 * (`checkoutBillingPlane`). W `merchant` podatek liczy sprzedawca i on
 * wystawia fakturę - adnotacja o operatorze byłaby tam nieprawdą. Obie wersje
 * mieszczą się w jednym wierszu generatora (110 znaków).
 */
const NOTE: Record<InvoiceLocale, Record<CheckoutBillingPlane, string>> = {
  pl: {
    managed:
      "Podatek rozlicza operator płatności (Merchant of Record). Potwierdzenie z panelu członka, nie faktura VAT.",
    merchant:
      "Podatek rozlicza sprzedawca, który wystawia fakturę. Potwierdzenie z panelu członka, nie faktura VAT.",
  },
  en: {
    managed:
      "Tax is settled by the payment provider (Merchant of Record). Member panel confirmation, not a VAT invoice.",
    merchant:
      "Tax is settled by the seller, who issues the invoice. Member panel confirmation, not a VAT invoice.",
  },
};

const FILE_STEM: Record<InvoiceLocale, string> = {
  pl: "potwierdzenie-platnosci",
  en: "payment-confirmation",
};

type DescriptionKey = "subscription" | "ticket" | "donation" | "content" | "default";

const DESCRIPTION: Record<InvoiceLocale, Record<DescriptionKey, string>> = {
  pl: {
    subscription: "Członkostwo - opłata za okres rozliczeniowy",
    ticket: "Bilet na wydarzenie",
    donation: "Darowizna",
    content: "Dostęp do treści",
    default: "Usługa cyfrowa New European Strategies",
  },
  en: {
    subscription: "Membership - billing period fee",
    ticket: "Event ticket",
    donation: "Donation",
    content: "Content access",
    default: "New European Strategies digital service",
  },
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Błąd odczytu przerywa składanie pliku. Kopia bez NIP-u wystawcy czy firmy
 * nabywcy wygląda na poprawną, a jest niekompletnym dokumentem księgowym -
 * lepiej, żeby panel pokazał błąd i członek ponowił pobranie.
 */
function failOnReadError(table: string, error: { message: string } | null): void {
  if (error) throw new Error(`invoice pdf: ${table} read failed: ${error.message}`);
}

/**
 * Opis pozycji z zamówienia. `payment_orders.kind` zna tylko 'subscription'
 * i 'one_time' - bilet, dostęp do treści i darowiznę rozróżnia dopiero
 * `metadata.purpose` zapisany przy zakładaniu zamówienia jednorazowego.
 */
function descriptionKey(order: { kind: string; metadata: unknown } | null): DescriptionKey {
  if (order?.kind === "subscription") return "subscription";
  const metadata = order?.metadata;
  const purpose =
    typeof metadata === "object" && metadata !== null && "purpose" in metadata
      ? metadata.purpose
      : null;
  switch (purpose) {
    case "event_ticket":
      return "ticket";
    case "content_unlock":
      return "content";
    case "donation":
      return "donation";
    default:
      return "default";
  }
}

/** Data kalendarzowa ze znacznika z bazy (parsowanie, nie zegar - wynik stały). */
function isoDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10);
}

/**
 * Buduje PDF dla dokumentu należącego do `userId`.
 * Cudzy dokument to `forbidden` - nie „nie znaleziono", bo właściciela
 * sprawdzamy jawnie, a nie przez widoczność wiersza.
 */
export async function buildInvoicePdf(input: {
  userId: string;
  documentId: string;
  locale: InvoiceLocale;
}): Promise<{ ok: true; result: InvoicePdfResult } | { ok: false; error: InvoicePdfError }> {
  const supabase = await admin();
  const { data: doc, error: docError } = await supabase
    .from("billing_documents")
    .select(
      "id, user_id, tenant_id, number, kind, status, amount_cents, currency, issued_at, pdf_url, hosted_url, provider_document_id, buyer_snapshot, seller_snapshot, billing_plane",
    )
    .eq("id", input.documentId)
    .maybeSingle();
  // Błąd odczytu to nie „nie znaleziono" - dokument może istnieć.
  failOnReadError("billing_documents", docError);
  if (!doc) return { ok: false, error: "not_found" };
  if (doc.user_id !== input.userId) return { ok: false, error: "forbidden" };
  // CHECK kolumny dopuszcza wyłącznie znane stany - inny to uszkodzony wiersz,
  // a nie powód, by wydrukować na nim cokolwiek o płatności.
  if (!isBillingDocumentStatus(doc.status)) {
    throw new Error(`invoice pdf: unknown document status "${doc.status}"`);
  }

  // Dokument bez migawki (sprzed migracji albo zapisany przy awarii odczytu)
  // dostaje ją TERAZ i na zawsze - od tej chwili drukuje się tak samo.
  const snapshot = snapshotFromRow(doc) ?? (await freezeBillingDocumentSnapshot(doc));

  // Błąd odczytu zamówienia ŚWIADOMIE nie przerywa: zamówienie dobiera tylko
  // opis pozycji, a `provider_intent_id` nie jest unikalny - wyjątek zrobiłby
  // z niejednoznacznego wiersza fakturę na zawsze niemożliwą do pobrania.
  // Opis ogólny jest wtedy mniej szczegółowy, ale prawdziwy.
  const { data: order } = await supabase
    .from("payment_orders")
    .select("kind, metadata")
    .eq("provider_intent_id", doc.provider_document_id)
    .eq("tenant_id", doc.tenant_id)
    .maybeSingle();

  const description = DESCRIPTION[input.locale][descriptionKey(order)];
  const number = doc.number ?? doc.provider_document_id;

  const data: InvoiceData = {
    number,
    issuedAt: isoDate(doc.issued_at),
    currency: doc.currency,
    seller: snapshot.seller,
    buyer: snapshot.buyer,
    lines: [{ description, quantity: 1, amountCents: doc.amount_cents }],
    status: doc.status,
    labels: LABELS[input.locale],
    note: NOTE[input.locale][snapshot.plane],
  };

  return {
    ok: true,
    result: {
      fileName: `${FILE_STEM[input.locale]}-${number.replace(/[^a-zA-Z0-9_-]+/g, "-")}.pdf`,
      base64: pdfToBase64(renderInvoicePdf(data)),
      number,
      providerUrl: doc.pdf_url ?? doc.hosted_url ?? null,
    },
  };
}
