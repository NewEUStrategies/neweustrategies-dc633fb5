// DOKUMENT DO DRUKU IDENTYFIKATORÓW.
//
// OSOBNE OKNO, NIE `window.print()` NA APLIKACJI. Repo ma globalny arkusz
// `@media print`, który chowa nagłówki, rozpycha `main` i wymusza kolory
// artykułu - identyfikator wydrukowany przez ten arkusz wychodzi w złym
// rozmiarze i bez tła grupy. Dokument budowany tutaj jest samowystarczalny:
// własny `@page`, własna siatka, żadnych klas aplikacji.
//
// FUNKCJA JEST CZYSTA. Zwraca HTML jako tekst, więc test sprawdza treść karty
// bez otwierania okna przeglądarki; jedyny efekt uboczny (`window.open`) żyje
// w komponencie.
import type { BadgeCard } from "@/lib/events/badgeSheet";

export interface BadgePrintCard {
  card: BadgeCard;
  /** `data:image/png;base64,...` albo `null`, gdy osoba nie ma zapisu. */
  qrDataUrl: string | null;
  ticketLabel: string | null;
  groupLabel: string | null;
}

export interface BadgePrintOptions {
  widthMm: number;
  heightMm: number;
  showQr: boolean;
  qrSizeMm: number;
  backgroundColor: string | null;
  eventTitle: string;
  documentTitle: string;
  /** Napis na karcie osoby bez zapisu - bramka wpuszcza ją ręcznie. */
  noCodeLabel: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeColor(value: string | null, fallback: string): string {
  return value !== null && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
}

function cardHtml(item: BadgePrintCard, options: BadgePrintOptions): string {
  const name = `${item.card.firstName} ${item.card.lastName}`.replace(/\s+/g, " ").trim();
  const accent = safeColor(item.card.groupColor, "#d1d5db");
  const qr =
    options.showQr === false
      ? ""
      : item.qrDataUrl === null
        ? `<p class="badge-nocode">${escapeHtml(options.noCodeLabel)}</p>`
        : `<img class="badge-qr" src="${item.qrDataUrl}" alt="" />`;

  return `<article class="badge" style="border-top-color:${accent}">
  <p class="badge-event">${escapeHtml(options.eventTitle)}</p>
  <p class="badge-name">${escapeHtml(name)}</p>
  ${item.card.jobTitle === null ? "" : `<p class="badge-role">${escapeHtml(item.card.jobTitle)}</p>`}
  ${item.card.company === null ? "" : `<p class="badge-company">${escapeHtml(item.card.company)}</p>`}
  <div class="badge-foot">
    <div class="badge-tags">
      ${item.groupLabel === null ? "" : `<span class="badge-tag" style="background:${accent}">${escapeHtml(item.groupLabel)}</span>`}
      ${item.ticketLabel === null ? "" : `<span class="badge-ticket">${escapeHtml(item.ticketLabel)}</span>`}
    </div>
    ${qr}
  </div>
</article>`;
}

/** Kompletny dokument HTML gotowy do wpisania w nowe okno druku. */
export function buildBadgePrintDocument(
  cards: readonly BadgePrintCard[],
  options: BadgePrintOptions,
): string {
  const background = safeColor(options.backgroundColor, "#ffffff");
  const qrSide = Math.max(10, Math.min(options.qrSizeMm, Math.min(options.widthMm, options.heightMm) - 6));

  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(options.documentTitle)}</title>
<style>
  @page { size: auto; margin: 6mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Red Hat Display", system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #fff;
    color: #111;
    display: flex;
    flex-wrap: wrap;
    gap: 4mm;
  }
  .badge {
    width: ${options.widthMm}mm;
    height: ${options.heightMm}mm;
    padding: 5mm;
    border: 0.3mm solid #d1d5db;
    border-top-width: 3mm;
    border-radius: 2mm;
    background: ${background};
    display: flex;
    flex-direction: column;
    gap: 1.5mm;
    page-break-inside: avoid;
    break-inside: avoid;
    overflow: hidden;
  }
  .badge-event { margin: 0; font-size: 8pt; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280; }
  .badge-name { margin: 0; font-size: 17pt; font-weight: 700; line-height: 1.1; }
  .badge-role { margin: 0; font-size: 10pt; color: #374151; }
  .badge-company { margin: 0; font-size: 10pt; font-weight: 600; color: #111; }
  .badge-foot { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 3mm; }
  .badge-tags { display: flex; flex-direction: column; gap: 1.5mm; min-width: 0; }
  .badge-tag { display: inline-block; padding: 1mm 2mm; border-radius: 1.5mm; font-size: 8pt; font-weight: 700; color: #111; }
  .badge-ticket { font-size: 8pt; color: #4b5563; }
  .badge-qr { width: ${qrSide}mm; height: ${qrSide}mm; }
  .badge-nocode { margin: 0; font-size: 7.5pt; color: #b45309; max-width: 30mm; text-align: right; }
  @media screen { body { padding: 8mm; background: #f3f4f6; } }
</style>
</head>
<body>
${cards.map((item) => cardHtml(item, options)).join("\n")}
</body>
</html>`;
}
