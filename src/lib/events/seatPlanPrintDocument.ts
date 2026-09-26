// DOKUMENT DO DRUKU: LISTA PRZY DRZWIACH PLANU SALI.
//
// OSOBNE OKNO, NIE `window.print()` NA APLIKACJI - ten sam powod, co przy
// identyfikatorach (`badgePrintDocument.ts`): globalny arkusz `@media print`
// aplikacji chowa naglowki i rozpycha `main`. Dokument jest samowystarczalny:
// wlasny `@page`, wlasna tabela, zadnych klas aplikacji.
//
// FUNKCJA JEST CZYSTA I ESCAPUJE WSZYSTKO. Nazwiska, firmy i notatki sa
// wpisywane recznie - bez escapowania `<script>` w nazwie firmy wykonalby sie
// w oknie druku z uprawnieniami panelu. Etykiety (naglowki kolumn, tytul)
// przychodza przetlumaczone w opcjach, wiec modul nie zna i18next.

export interface SeatPrintRow {
  seat: string;
  name: string;
  company: string;
  ticket: string;
  note: string;
}

export interface SeatPrintOptions {
  lang: "pl" | "en";
  documentTitle: string;
  eventTitle: string;
  mapName: string;
  columns: { seat: string; name: string; company: string; ticket: string; note: string };
  /** Zdanie, gdy nikt jeszcze nie siedzi. */
  emptyLabel: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cell(value: string): string {
  return `<td>${escapeHtml(value)}</td>`;
}

export function seatPlanPrintHtml(rows: readonly SeatPrintRow[], options: SeatPrintOptions): string {
  const head = [
    options.columns.name,
    options.columns.seat,
    options.columns.company,
    options.columns.ticket,
    options.columns.note,
  ]
    .map((label) => `<th scope="col">${escapeHtml(label)}</th>`)
    .join("");
  const body =
    rows.length === 0
      ? `<tr><td colspan="5" class="empty">${escapeHtml(options.emptyLabel)}</td></tr>`
      : rows
          .map(
            (row) =>
              `<tr>${cell(row.name)}${cell(row.seat)}${cell(row.company)}${cell(row.ticket)}${cell(row.note)}</tr>`,
          )
          .join("");
  return [
    "<!doctype html>",
    `<html lang="${options.lang === "en" ? "en" : "pl"}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(options.documentTitle)}</title>`,
    "<style>",
    "@page { size: A4 portrait; margin: 12mm; }",
    "body { font-family: system-ui, sans-serif; color: #111; margin: 0; }",
    "h1 { font-size: 16pt; margin: 0 0 2mm; }",
    "p.map { font-size: 11pt; margin: 0 0 6mm; color: #444; }",
    "table { width: 100%; border-collapse: collapse; font-size: 10pt; }",
    "th, td { border-bottom: 1px solid #ccc; padding: 2mm 1.5mm; text-align: left; vertical-align: top; }",
    "th { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; color: #555; }",
    "tr { break-inside: avoid; }",
    "td.empty { text-align: center; color: #666; padding: 8mm; }",
    "</style>",
    "</head>",
    "<body>",
    `<h1>${escapeHtml(options.eventTitle)}</h1>`,
    `<p class="map">${escapeHtml(options.mapName)}</p>`,
    `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
    "</body>",
    "</html>",
  ].join("\n");
}
