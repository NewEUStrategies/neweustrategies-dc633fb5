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
