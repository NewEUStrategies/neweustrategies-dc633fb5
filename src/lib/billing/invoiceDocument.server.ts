// Złożenie faktury PDF dla konkretnego dokumentu rozliczeniowego.
//
// Operator (Stripe jako Merchant of Record) wystawia własny dokument, ale nie
// zawsze: paragon zamiast faktury, dokument gotowy dopiero po chwili, link
// czasowy po wygaśnięciu. Panel faktur musi mimo to wydać plik - dlatego
// składamy własny PDF z danych, które i tak mamy w bazie: dokumentu
// rozliczeniowego, danych nabywcy (billing_profiles / CRM) i danych wystawcy.
//
// Moduł jest server-only (klient service_role).
import {
  pdfToBase64,
  renderInvoicePdf,
  type InvoiceData,
  type InvoiceLabels,
  type InvoiceParty,
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
    title: "Faktura / dokument sprzedaży",
    number: "Numer",
    issuedAt: "Data wystawienia",
    seller: "Sprzedawca",
    buyer: "Nabywca",
    taxId: "NIP / VAT ID",
    description: "Opis",
    quantity: "Ilość",
    amount: "Kwota brutto",
    total: "Razem do zapłaty",
    paid: "Zapłacono - dokument nie wymaga podpisu.",
  },
  en: {
    title: "Invoice / sales document",
    number: "Number",
    issuedAt: "Issue date",
    seller: "Seller",
    buyer: "Buyer",
    taxId: "Tax ID / VAT ID",
    description: "Description",
    quantity: "Qty",
    amount: "Gross amount",
    total: "Total due",
    paid: "Paid - this document needs no signature.",
  },
};

const NOTE: Record<InvoiceLocale, string> = {
  pl: "Podatek rozlicza operator płatności (Merchant of Record). Kopia dokumentu z panelu członka.",
  en: "Tax is settled by the payment provider (Merchant of Record). Member panel copy of the document.",
};

const DEFAULT_SELLER: InvoiceParty = {
  name: "New European Strategies",
  addressLine1: null,
  postalCode: null,
  city: null,
  country: null,
  taxId: null,
  email: null,
};

const DESCRIPTION: Record<InvoiceLocale, Record<string, string>> = {
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

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** Dane wystawcy: site_settings.invoice_issuer nadpisuje wartości domyślne. */
async function loadSeller(tenantId: string): Promise<InvoiceParty> {
  const supabase = await admin();
  const { data } = await supabase
    .from("site_settings")
    .select("value")
    .eq("tenant_id", tenantId)
    .eq("key", "invoice_issuer")
    .maybeSingle();
  const raw = (data?.value ?? {}) as Record<string, unknown>;
  return {
    name: str(raw.name) ?? DEFAULT_SELLER.name,
    taxId: str(raw.tax_id),
    addressLine1: str(raw.address_line1),
    addressLine2: str(raw.address_line2),
    postalCode: str(raw.postal_code),
    city: str(raw.city),
    country: str(raw.country),
    email: str(raw.email),
  };
}

function buyerFromProfile(
  row: Record<string, unknown> | null,
  fallbackEmail: string | null,
): InvoiceParty {
  if (!row) return { name: fallbackEmail ?? "-", email: fallbackEmail };
  const company = str(row.company);
  const person = str(row.full_name);
  return {
    name: (row.is_company ? company : person) ?? company ?? person ?? fallbackEmail ?? "-",
    taxId: str(row.tax_id),
    addressLine1: str(row.address_line1),
    addressLine2: str(row.address_line2),
    postalCode: str(row.postal_code),
    city: str(row.city),
    country: str(row.country_code),
    email: str(row.email) ?? fallbackEmail,
  };
}

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
  const { data: doc } = await supabase
    .from("billing_documents")
    .select(
      "id, user_id, tenant_id, number, kind, amount_cents, currency, issued_at, pdf_url, hosted_url, provider_document_id",
    )
    .eq("id", input.documentId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "not_found" };
  if (doc.user_id !== input.userId) return { ok: false, error: "forbidden" };

  const [{ data: billing }, { data: profile }, seller] = await Promise.all([
    supabase
      .from("billing_profiles")
      .select(
        "full_name, company, tax_id, email, address_line1, address_line2, city, postal_code, country_code, is_company",
      )
      .eq("user_id", input.userId)
      .eq("tenant_id", doc.tenant_id)
      .maybeSingle(),
    supabase.from("profiles").select("email").eq("id", input.userId).maybeSingle(),
    loadSeller(doc.tenant_id),
  ]);

  const { data: order } = await supabase
    .from("payment_orders")
    .select("kind")
    .eq("provider_intent_id", doc.provider_document_id)
    .eq("tenant_id", doc.tenant_id)
    .maybeSingle();

  const descriptions = DESCRIPTION[input.locale];
  const description = descriptions[order?.kind ?? ""] ?? descriptions.default ?? "";
  const number = doc.number ?? doc.provider_document_id;

  const data: InvoiceData = {
    number,
    issuedAt: isoDate(doc.issued_at),
    currency: doc.currency,
    seller,
    buyer: buyerFromProfile(billing as Record<string, unknown> | null, str(profile?.email)),
    lines: [{ description, quantity: 1, amountCents: doc.amount_cents }],
    labels: LABELS[input.locale],
    note: NOTE[input.locale],
  };

  return {
    ok: true,
    result: {
      fileName: `${input.locale === "pl" ? "faktura" : "invoice"}-${number.replace(/[^a-zA-Z0-9_-]+/g, "-")}.pdf`,
      base64: pdfToBase64(renderInvoicePdf(data)),
      number,
      providerUrl: doc.pdf_url ?? doc.hosted_url ?? null,
    },
  };
}
