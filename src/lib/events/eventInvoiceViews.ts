// Czyste widoki list ekranu faktur studia (bez Reacta, bez i18n):
// grupowanie zamowien po NIP-ie i przydzial dokumentow do zakladek.
// Osobny modul, bo pliki komponentow eksportuja wylacznie komponenty
// (szybkie odswiezanie), a te reguly maja wlasne testy.
import type { EventInvoiceCandidateRow, EventInvoiceListRow } from "@/lib/events/eventInvoicesApi";

export interface CandidateGroup {
  key: string;
  taxKey: string | null;
  buyerName: string;
  rows: EventInvoiceCandidateRow[];
}

/** Grupy po NIP-ie w kolejnosci bazy (NIP rosnaco, potem zamowienia bez NIP-u). */
export function groupCandidates(rows: readonly EventInvoiceCandidateRow[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>();
  for (const row of rows) {
    const key = row.tax_key === null ? "none" : `tax:${row.tax_key}`;
    const group = groups.get(key) ?? {
      key,
      taxKey: row.tax_key,
      buyerName: row.buyer_name ?? "",
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Czy zaznaczone zamowienia niosa OCZEKUJACE prosby o fakture ROZNYCH
 * nabywcow (inny NIP albo prosba bez NIP-u) - baza odmowi wtedy dokumentu
 * (`buyer_mismatch`), bo jeden nabywca zostalby bez faktury. Ekran mowi to
 * od razu i nie proponuje faktury zbiorczej. Zamowienia bez prosby mozna
 * dolaczac do dowolnego nabywcy.
 */
export function hasBuyerMismatch(rows: readonly EventInvoiceCandidateRow[]): boolean {
  const buyers = new Set<string>();
  for (const row of rows) {
    if (row.request_status !== "pending") continue;
    buyers.add(row.tax_key === null ? `request:${row.request_id}` : `tax:${row.tax_key}`);
  }
  return buyers.size > 1;
}

export type EventInvoiceDocumentsTab = "issued" | "drafts" | "corrections";

/** Ktore dokumenty naleza do zakladki. */
export function documentsForTab(
  rows: readonly EventInvoiceListRow[],
  tab: EventInvoiceDocumentsTab,
): EventInvoiceListRow[] {
  return rows.filter((row) => {
    if (tab === "corrections") return row.kind === "correction";
    if (tab === "issued") return row.kind === "invoice" && row.status !== "draft";
    return row.kind !== "correction" && (row.status === "draft" || row.kind === "proforma");
  });
}
