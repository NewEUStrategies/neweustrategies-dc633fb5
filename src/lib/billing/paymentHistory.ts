// Ujednolicona historia płatności użytkownika.
//
// Dwa rejestry opisują tę samą kasę z różnych stron: `payment_orders` to
// zamówienia (co użytkownik kupił), `billing_documents` to faktury i paragony
// operatora (też z KAŻDEGO odnowienia). Pokazanie obu list obok siebie dubluje
// te same pieniądze, więc scalamy: dokument wygrywa (ma numer i PDF), a
// zamówienie trafia na listę tylko wtedy, gdy nie ma jeszcze swojego dokumentu.
import type { BillingDocument, PaymentOrder } from "./types";

export type PaymentHistoryKind = "invoice" | "receipt" | "credit_note" | "subscription" | "one_time";

export interface PaymentHistoryRow {
  id: string;
  /** Numer dokumentu lub identyfikator zamówienia - zawsze coś do zacytowania. */
  number: string;
  kind: PaymentHistoryKind;
  status: string;
  amountCents: number;
  currency: string;
  /** ISO 8601. */
  date: string;
  /** Strona szczegółów u operatora (hosted invoice/receipt), jeśli istnieje. */
  detailsUrl: string | null;
  pdfUrl: string | null;
  source: "document" | "order";
}

function orderLabel(order: PaymentOrder): PaymentHistoryKind {
  return order.kind === "subscription" ? "subscription" : "one_time";
}

/** Scala dokumenty i zamówienia w jedną listę posortowaną malejąco po dacie. */
export function mergePaymentHistory(
  orders: PaymentOrder[],
  documents: BillingDocument[],
): PaymentHistoryRow[] {
  const coveredOrderIds = new Set(
    documents.map((doc) => doc.order_id).filter((id): id is string => !!id),
  );

  const fromDocuments: PaymentHistoryRow[] = documents.map((doc) => ({
    id: `doc:${doc.id}`,
    number: doc.number ?? doc.provider_document_id,
    kind: doc.kind,
    status: doc.status,
    amountCents: doc.amount_cents,
    currency: doc.currency,
    date: doc.issued_at,
    detailsUrl: doc.hosted_url,
    pdfUrl: doc.pdf_url,
    source: "document",
  }));

  const fromOrders: PaymentHistoryRow[] = orders
    .filter((order) => !coveredOrderIds.has(order.id))
    .map((order) => ({
      id: `ord:${order.id}`,
      number: order.provider_session_id ?? order.id,
      kind: orderLabel(order),
      status: order.status,
      amountCents: order.amount_cents,
      currency: order.currency,
      date: order.created_at,
      detailsUrl: order.invoice_url,
      pdfUrl: order.invoice_url,
      source: "order",
    }));

  return [...fromDocuments, ...fromOrders].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

function csvCell(value: string): string {
  const needsQuotes = /[",;\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

export interface HistoryCsvLabels {
  number: string;
  date: string;
  kind: string;
  amount: string;
  currency: string;
  status: string;
  document: string;
}

/**
 * CSV z separatorem `;` i BOM - Excel w polskiej lokalizacji otwiera taki plik
 * bez kreatora importu, a kwoty zapisujemy z kropką dziesiętną (parsowalne
 * maszynowo, nie tylko wzrokowo).
 */
export function paymentHistoryToCsv(rows: PaymentHistoryRow[], labels: HistoryCsvLabels): string {
  const header = [
    labels.number,
    labels.date,
    labels.kind,
    labels.amount,
    labels.currency,
    labels.status,
    labels.document,
  ];
  const lines = rows.map((row) =>
    [
      row.number,
      row.date.slice(0, 10),
      row.kind,
      (row.amountCents / 100).toFixed(2),
      row.currency.toUpperCase(),
      row.status,
      row.pdfUrl ?? row.detailsUrl ?? "",
    ]
      .map(csvCell)
      .join(";"),
  );
  return `\uFEFF${[header.map(csvCell).join(";"), ...lines].join("\r\n")}\r\n`;
}

/** Nazwa pliku eksportu - stabilna, z datą wygenerowania. */
export function historyFileName(prefix: string, ext: "csv" | "pdf", now = new Date()): string {
  return `${prefix}-${now.toISOString().slice(0, 10)}.${ext}`;
}
