// Potwierdzenie biletu jako samodzielny plik do pobrania.
//
// Dokument jest jednym plikiem HTML z osadzonym kodem QR (data URL) - otwiera
// się bez internetu i drukuje do PDF, a przy tym nie wymaga ciężkiej
// biblioteki PDF w bundlu przeglądarki.
import type { MyEventTicket } from "@/lib/events/ticket.server";

export interface TicketDocumentInput {
  ticket: MyEventTicket;
  lang: "pl" | "en";
  title: string;
  dateLabel: string | null;
  qrDataUrl: string | null;
}

const COPY = {
  pl: {
    doc: "Potwierdzenie biletu",
    brand: "New European Strategies",
    code: "Numer biletu",
    date: "Termin",
    place: "Miejsce",
    holder: "Uczestnik",
    transaction: "Numer transakcji",
    note: "Okaż ten kod przy wejściu. Potwierdzenie jest imienne i nieprzenoszalne.",
  },
  en: {
    doc: "Ticket confirmation",
    brand: "New European Strategies",
    code: "Ticket number",
    date: "Date",
    place: "Location",
    holder: "Attendee",
    transaction: "Transaction number",
    note: "Show this code at the entrance. The confirmation is personal and non-transferable.",
  },
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Buduje treść pliku potwierdzenia (HTML gotowy do druku/PDF). */
export function buildTicketDocument({
  ticket,
  lang,
  title,
  dateLabel,
  qrDataUrl,
}: TicketDocumentInput): string {
  const c = COPY[lang];
  const rows: Array<[string, string | null]> = [
    [c.code, ticket.code],
    [c.date, dateLabel],
    [c.place, ticket.location],
    [c.holder, ticket.holderName ?? ticket.holderEmail],
    [c.transaction, ticket.transactionId],
  ];

  const body = rows
    .filter((row): row is [string, string] => !!row[1])
    .map(
      ([label, value]) =>
        `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(`${c.doc} - ${title}`)}</title>
<style>
  body { font-family: "Red Hat Display", system-ui, -apple-system, "Segoe UI", sans-serif;
         color:#141313; background:#F8F6F4; margin:0; padding:32px; }
  .card { max-width:640px; margin:0 auto; background:#fff; border-radius:12px; padding:32px;
          box-shadow:0 6px 24px rgba(20,19,19,.08); }
  .brand { font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:#FA9346; }
  h1 { font-size:22px; margin:8px 0 24px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-weight:500; color:#6b6b6b; font-size:13px; padding:8px 12px 8px 0;
       white-space:nowrap; vertical-align:top; }
  td { font-size:14px; padding:8px 0; }
  .qr { text-align:center; margin:24px 0; }
  .qr img { width:200px; height:200px; }
  .note { font-size:12px; color:#6b6b6b; margin-top:20px; }
</style></head>
<body><div class="card">
  <p class="brand">${escapeHtml(c.brand)}</p>
  <h1>${escapeHtml(title)}</h1>
  <div class="qr">${qrDataUrl ? `<img src="${qrDataUrl}" alt="${escapeHtml(ticket.code)}" />` : ""}</div>
  <table><tbody>${body}</tbody></table>
  <p class="note">${escapeHtml(c.note)}</p>
</div></body></html>`;
}

/** Zapisuje dokument na dysk użytkownika (bez żądania sieciowego). */
export function downloadTicketDocument(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
