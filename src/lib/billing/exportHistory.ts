// Eksport historii płatności po stronie przeglądarki.
//
// CSV powstaje lokalnie z danych, które użytkownik już widzi (żadnego
// dodatkowego ruchu do operatora). PDF generujemy przez okno wydruku zamiast
// biblioteki: standardowe fonty generatorów PDF nie mają polskich znaków
// (ł, ą, ę wychodzą jako puste kwadraty), a wydruk przeglądarki zachowuje
// pełny Unicode i pozwala zapisać plik jako PDF w jednym kroku.
import { historyFileName, type PaymentHistoryRow } from "./paymentHistory";
import { formatMoney } from "./types";

export function downloadTextFile(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Zwolnienie w następnej klatce - Safari przerywa pobieranie, gdy URL
  // znika synchronicznie po kliknięciu.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface HistoryPrintLabels {
  title: string;
  number: string;
  date: string;
  kind: string;
  amount: string;
  status: string;
  generatedAt: string;
  kindLabel: (kind: PaymentHistoryRow["kind"]) => string;
  statusLabel: (status: string) => string;
}

export function historyPrintHtml(
  rows: PaymentHistoryRow[],
  labels: HistoryPrintLabels,
  lang: string,
): string {
  const locale = lang === "en" ? "en-GB" : "pl-PL";
  const body = rows
    .map(
      (row) => `<tr>
      <td>${escapeHtml(row.number)}</td>
      <td>${escapeHtml(new Date(row.date).toLocaleDateString(locale))}</td>
      <td>${escapeHtml(labels.kindLabel(row.kind))}</td>
      <td class="num">${escapeHtml(formatMoney(row.amountCents, row.currency, lang))}</td>
      <td>${escapeHtml(labels.statusLabel(row.status))}</td>
    </tr>`,
    )
    .join("");

  return `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8">
<title>${escapeHtml(labels.title)}</title>
<style>
  body { font-family: "Red Hat Display", system-ui, sans-serif; color: #111; margin: 32px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.meta { font-size: 11px; color: #666; margin: 0 0 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border-bottom: 1px solid #ddd; padding: 6px 8px; text-align: left; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #555; }
  td.num, th.num { text-align: right; }
  @page { margin: 16mm; }
</style></head><body>
<h1>${escapeHtml(labels.title)}</h1>
<p class="meta">${escapeHtml(labels.generatedAt)}</p>
<table><thead><tr>
  <th>${escapeHtml(labels.number)}</th>
  <th>${escapeHtml(labels.date)}</th>
  <th>${escapeHtml(labels.kind)}</th>
  <th class="num">${escapeHtml(labels.amount)}</th>
  <th>${escapeHtml(labels.status)}</th>
</tr></thead><tbody>${body}</tbody></table>
</body></html>`;
}

/** Otwiera okno wydruku z gotowym zestawieniem (użytkownik zapisuje jako PDF). */
export function printHistoryPdf(html: string): boolean {
  const win = window.open("", "_blank", "noopener,noreferrer,width=980,height=720");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  // Drobna zwłoka - bez niej Chrome drukuje pustą stronę, zanim style
  // zdążą się zastosować.
  setTimeout(() => win.print(), 250);
  return true;
}

export { historyFileName };
