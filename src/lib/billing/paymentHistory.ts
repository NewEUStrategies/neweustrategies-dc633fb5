// Ujednolicona historia płatności użytkownika.
//
// Dwa rejestry opisują tę samą kasę z różnych stron: `payment_orders` to
// zamówienia (co użytkownik kupił), `billing_documents` to faktury i paragony
// operatora (też z KAŻDEGO odnowienia). Pokazanie obu list obok siebie dubluje
// te same pieniądze, więc scalamy: dokument wygrywa (ma numer i PDF), a
// zamówienie trafia na listę tylko wtedy, gdy nie ma jeszcze swojego dokumentu.
import { neutralizeCsvFormula } from "@/lib/csv/formatCsv";

import type { BillingDocument, PaymentOrder } from "./types";

export type PaymentHistoryKind =
  "invoice" | "receipt" | "credit_note" | "subscription" | "one_time" | "grant";

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
  source: "document" | "order" | "grant";
  /** Kwota rabatu w groszach - gdy zakup objęty był kodem promocyjnym. */
  discountCents: number | null;
  /** Kod promocyjny użyty przy zakupie. */
  couponCode: string | null;
  /** Cena przed rabatem (grosze), jeżeli znana. */
  originalAmountCents: number | null;
  /** Dostęp otrzymany bez płatności (nadanie / prezent). */
  gift: boolean;
  /** Źródło nadania (`expert`, `manual`, `donation`, ...). */
  giftSource: string | null;
}

function orderLabel(order: PaymentOrder): PaymentHistoryKind {
  return order.kind === "subscription" ? "subscription" : "one_time";
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Wyciąga informacje o rabacie z metadanych zamówienia (zapisuje je checkout). */
function discountFromOrder(order: PaymentOrder): {
  discountCents: number | null;
  couponCode: string | null;
  originalAmountCents: number | null;
} {
  const meta = (order.metadata ?? {}) as Record<string, unknown>;
  const discountCents = readNumber(meta["coupon_discount_cents"] ?? meta["discount_cents"]);
  return {
    discountCents: discountCents && discountCents > 0 ? discountCents : null,
    couponCode: readString(meta["coupon_code"]),
    originalAmountCents: readNumber(meta["original_amount_cents"]),
  };
}

/** Nadanie dostępu (membership_grants) jako pozycja historii - „prezent". */
export interface AccessGrantHistoryInput {
  id: string;
  tierKey: string;
  source: string;
  note: string | null;
  startsAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export function grantsToHistory(grants: AccessGrantHistoryInput[]): PaymentHistoryRow[] {
  return grants
    .filter((grant) => !grant.revokedAt)
    .map((grant) => ({
      id: `grant:${grant.id}`,
      number: grant.tierKey.toUpperCase(),
      kind: "grant" as const,
      status: "granted",
      amountCents: 0,
      currency: "PLN",
      date: grant.startsAt,
      detailsUrl: null,
      pdfUrl: null,
      source: "grant" as const,
      discountCents: null,
      couponCode: null,
      originalAmountCents: null,
      gift: true,
      giftSource: grant.source,
    }));
}

/** Scala dokumenty i zamówienia w jedną listę posortowaną malejąco po dacie. */
export function mergePaymentHistory(
  orders: PaymentOrder[],
  documents: BillingDocument[],
  grants: AccessGrantHistoryInput[] = [],
): PaymentHistoryRow[] {
  const coveredOrderIds = new Set(
    documents.map((doc) => doc.order_id).filter((id): id is string => !!id),
  );

  // Rabat opisuje zamówienie, nie dokument - przenosimy go na dokument, który
  // to zamówienie „przykrywa", żeby zniżka nie znikła z listy.
  const discountByOrderId = new Map(orders.map((order) => [order.id, discountFromOrder(order)]));

  const fromDocuments: PaymentHistoryRow[] = documents.map((doc) => {
    const discount = doc.order_id ? discountByOrderId.get(doc.order_id) : undefined;
    return {
      id: `doc:${doc.id}`,
      number: doc.number ?? doc.provider_document_id,
      kind: doc.kind,
      status: doc.status,
      amountCents: doc.amount_cents,
      currency: doc.currency,
      date: doc.issued_at,
      detailsUrl: doc.hosted_url,
      pdfUrl: doc.pdf_url,
      source: "document" as const,
      discountCents: discount?.discountCents ?? null,
      couponCode: discount?.couponCode ?? null,
      originalAmountCents: discount?.originalAmountCents ?? null,
      gift: doc.amount_cents === 0,
      giftSource: null,
    };
  });

  const fromOrders: PaymentHistoryRow[] = orders
    .filter((order) => !coveredOrderIds.has(order.id))
    .map((order) => {
      const discount = discountFromOrder(order);
      return {
        id: `ord:${order.id}`,
        number: order.provider_session_id ?? order.id,
        kind: orderLabel(order),
        status: order.status,
        amountCents: order.amount_cents,
        currency: order.currency,
        date: order.created_at,
        detailsUrl: order.invoice_url,
        pdfUrl: order.invoice_url,
        source: "order" as const,
        discountCents: discount.discountCents,
        couponCode: discount.couponCode,
        originalAmountCents: discount.originalAmountCents,
        gift: order.amount_cents === 0,
        giftSource: null,
      };
    });

  return [...fromDocuments, ...fromOrders, ...grantsToHistory(grants)].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

/**
 * Jedna komórka tego pliku: neutralizacja ze WSPÓLNEGO modułu, cytowanie
 * własne.
 *
 * NEUTRALIZACJA jest wspólna z resztą repo (`lib/csv/formatCsv`) z rozmysłu -
 * to reguła BEZPIECZEŃSTWA, a trzy kopie jednej reguły bezpieczeństwa dają
 * trzy różne poziomy ochrony w jednym systemie. Wektor jest tu realny tak samo
 * jak w eksporcie subskrybentów: `number` faktury i `couponCode` przychodzą od
 * OPERATORA PŁATNOŚCI, a nie z naszej bazy, i trafiają do pliku, który
 * użytkownik otwiera lokalnie w arkuszu.
 *
 * CYTOWANIE zostaje osobne, bo ten eksport ma separator `;` (patrz
 * `paymentHistoryToCsv`) - średnik MUSI wymuszać cytowanie tutaj i NIE MOŻE go
 * wymuszać w plikach przecinkowych, gdzie jest zwykłym znakiem treści.
 */
function csvCell(value: string): string {
  const guarded = neutralizeCsvFormula(value);
  const needsQuotes = /[",;\n\r]/.test(guarded);
  return needsQuotes ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export interface HistoryCsvLabels {
  number: string;
  date: string;
  kind: string;
  amount: string;
  currency: string;
  status: string;
  document: string;
  discount: string;
  coupon: string;
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
    labels.discount,
    labels.coupon,
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
      row.discountCents ? (row.discountCents / 100).toFixed(2) : "",
      row.couponCode ?? (row.gift ? (row.giftSource ?? "gift") : ""),
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
