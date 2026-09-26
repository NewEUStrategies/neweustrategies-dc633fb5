// PDF FAKTURY WYDARZENIA (faktura VAT, proforma, korekta) - renderer czysty,
// bez zaleznosci, dzialajacy w przegladarce i w Workerze.
//
// DLACZEGO NIE `renderInvoicePdf` z modulu rozliczen. Tamten renderer drukuje
// KOPIE dokumentu operatora platnosci: jedna strona, jedna kolumna kwoty
// brutto, opis przyciety do 58 znakow. Faktura organizatora potrzebuje
// kolumn VAT (netto, stawka, kwota VAT, brutto), podsumowania stawek,
// naglowka korekty, rachunku do przelewu, podstawy zwolnienia i - dla
// faktury zbiorczej z kilkudziesiecioma pozycjami - WIELU STRON z
// powtorzonym naglowkiem tabeli. Wspolne sa tylko niskopoziomowe klocki:
// kodowanie polskich glifow (`encodePdfText`) i zapis kwoty
// (`formatInvoiceMoney`) - uzywamy ich, nie zmieniajac tamtego modulu.
//
// JEZYK DOKUMENTU = jezyk faktury (`doc.locale`), nie jezyk panelu. Etykiety
// podaje wolajacy (`eventInvoicePdfLabels.ts`, `i18n.getFixedT(locale)`), wiec
// modul nie zna i18n i jest w pelni testowalny.
//
// KWOTY DRUKUJEMY Z DOKUMENTU, a podsumowanie stawek liczy lustro bazy
// (`vatSummary`) z tych samych pozycji - te same grosze co w SQL-u.
import { encodePdfText, formatInvoiceMoney } from "@/lib/billing/invoicePdf";
import type { EventInvoiceDocument } from "@/lib/events/eventInvoiceDocument";
import { vatSummary, type EventInvoiceVatRate } from "@/lib/events/eventInvoiceMath";

export interface EventInvoicePdfLabels {
  /** Tytul dokumentu dla jego rodzaju (np. "Faktura VAT", "Faktura korygujaca"). */
  title: string;
  /** Tytul szkicu (dokument bez numeru, np. "Szkic dokumentu"). */
  draftTitle: string;
  number: string;
  issueDate: string;
  saleDate: string;
  dueDate: string;
  paymentMethod: string;
  /** Sposob platnosci juz przetlumaczony dla tego dokumentu. */
  paymentMethodValue: string;
  seller: string;
  buyer: string;
  recipient: string;
  taxId: string;
  bankAccount: string;
  swift: string;
  event: string;
  poNumber: string;
  columns: {
    lp: string;
    name: string;
    unit: string;
    quantity: string;
    unitNet: string;
    net: string;
    rate: string;
    vat: string;
    gross: string;
  };
  rates: Record<EventInvoiceVatRate, string>;
  vatSummary: string;
  total: string;
  toPay: string;
  paid: string;
  /** Wiersz naglowka korekty, np. "Korekta do faktury FV/2026/09/0001 z 2026-09-26". */
  correctsLine: string;
  correctionReason: string;
  exemptBasis: string;
  ksefNumber: string;
  cancelled: string;
  proformaNote: string;
  page: (page: number, pages: number) => string;
  /** Rdzen nazwy pliku ("faktura", "invoice"). */
  fileStem: string;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 40;
const RIGHT = 555;
const TOP = 800;
const BOTTOM = 70;
const DESCRIPTION_CHARS = 46;
const FONT_REGULAR = "F1";
const FONT_BOLD = "F2";

/** Kolumny tabeli pozycji: x = lewa krawedz (tekst) albo prawa (kwoty). */
const COL = {
  lp: LEFT,
  name: LEFT + 20,
  unit: 262,
  quantity: 318,
  unitNet: 378,
  net: 438,
  rate: 446,
  vat: 505,
  gross: RIGHT,
} as const;

interface Page {
  ops: string[];
}

class Canvas {
  pages: Page[] = [{ ops: [] }];
  y = TOP;
  private readonly onNewPage: (canvas: Canvas) => void;

  constructor(onNewPage: (canvas: Canvas) => void) {
    this.onNewPage = onNewPage;
  }

  private get ops(): string[] {
    return this.pages[this.pages.length - 1].ops;
  }

  text(x: number, value: string, size: number, bold = false): void {
    this.ops.push(
      `BT /${bold ? FONT_BOLD : FONT_REGULAR} ${size} Tf 1 0 0 1 ${x} ${this.y} Tm (${encodePdfText(value)}) Tj ET`,
    );
  }

  textRight(x: number, value: string, size: number, bold = false): void {
    // Szerokosc Helvetiki przyblizona 0.5em - wystarcza do wyrownania kwot.
    this.text(x - value.length * size * 0.5, value, size, bold);
  }

  rule(): void {
    this.ops.push(`0.8 0.8 0.8 RG 0.6 w ${LEFT} ${this.y} m ${RIGHT} ${this.y} l S`);
  }

  /** Miejsce na `height` punktow; brak miejsca = nowa strona. */
  ensure(height: number): void {
    if (this.y - height >= BOTTOM) return;
    this.pages.push({ ops: [] });
    this.y = TOP;
    this.onNewPage(this);
  }
}

/** Zawijanie opisu po slowach (twarde ciecie slow dluzszych niz wiersz). */
export function wrapText(value: string, width: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of value.split(/\s+/).filter((part) => part !== "")) {
    let rest = word;
    while (rest.length > width) {
      if (current !== "") {
        out.push(current);
        current = "";
      }
      out.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    if (current === "") current = rest;
    else if (current.length + 1 + rest.length <= width) current = `${current} ${rest}`;
    else {
      out.push(current);
      current = rest;
    }
  }
  if (current !== "") out.push(current);
  return out.length === 0 ? [""] : out;
}

function amount(cents: number): string {
  return formatInvoiceMoney(cents, "").trimEnd();
}

function partyRows(
  party: { taxId: string; address: string; postalCode: string; city: string; country: string },
  taxLabel: string,
): string[] {
  return [
    party.address,
    [party.postalCode, party.city].filter((part) => part !== "").join(" "),
    party.country,
    party.taxId === "" ? "" : `${taxLabel}: ${party.taxId}`,
  ].filter((row) => row.trim() !== "");
}

function tableHeader(canvas: Canvas, labels: EventInvoicePdfLabels): void {
  const c = labels.columns;
  canvas.text(COL.lp, c.lp, 7, true);
  canvas.text(COL.name, c.name, 7, true);
  canvas.text(COL.unit, c.unit, 7, true);
  canvas.textRight(COL.quantity, c.quantity, 7, true);
  canvas.textRight(COL.unitNet, c.unitNet, 7, true);
  canvas.textRight(COL.net, c.net, 7, true);
  canvas.text(COL.rate, c.rate, 7, true);
  canvas.textRight(COL.vat, c.vat, 7, true);
  canvas.textRight(COL.gross, c.gross, 7, true);
  canvas.y -= 5;
  canvas.rule();
  canvas.y -= 11;
}

/** Nazwa pliku: rdzen + numer dokumentu (ukosniki na myslniki) albo "szkic". */
export function eventInvoicePdfFileName(doc: EventInvoiceDocument, labels: EventInvoicePdfLabels): string {
  const tail = doc.number === null ? `draft-${doc.id.slice(0, 8)}` : doc.number.replace(/[^A-Za-z0-9]+/g, "-");
  return `${labels.fileStem}-${tail}.pdf`;
}

export function renderEventInvoicePdf(
  doc: EventInvoiceDocument,
  labels: EventInvoicePdfLabels,
): Uint8Array<ArrayBuffer> {
  let inTable = false;
  const canvas = new Canvas((next) => {
    if (inTable) tableHeader(next, labels);
  });

  // NAGLOWEK: rodzaj i numer po lewej, daty i sposob platnosci po prawej.
  canvas.text(LEFT, doc.number === null ? labels.draftTitle : labels.title, 16, true);
  canvas.y -= 18;
  if (doc.number !== null) canvas.text(LEFT, `${labels.number} ${doc.number}`, 11, true);
  const meta = [
    [labels.issueDate, doc.issueDate],
    [labels.saleDate, doc.saleDate],
    [labels.dueDate, doc.dueDate],
    [labels.paymentMethod, labels.paymentMethodValue],
  ].filter((row): row is [string, string] => row[1] !== null && row[1] !== "");
  let metaY = TOP;
  for (const [label, value] of meta) {
    const saved = canvas.y;
    canvas.y = metaY;
    canvas.textRight(RIGHT, `${label}: ${value}`, 9);
    canvas.y = saved;
    metaY -= 12;
  }
  canvas.y = Math.min(canvas.y, metaY) - 10;
  if (doc.status === "cancelled") {
    canvas.text(LEFT, labels.cancelled, 12, true);
    canvas.y -= 16;
  }
  if (doc.kind === "correction") {
    canvas.text(LEFT, labels.correctsLine, 10, true);
    canvas.y -= 12;
    for (const row of wrapText(`${labels.correctionReason}: ${doc.correctionReason}`, 100)) {
      canvas.text(LEFT, row, 9);
      canvas.y -= 11;
    }
    canvas.y -= 4;
  }

  // STRONY TRANSAKCJI.
  const partiesTop = canvas.y;
  canvas.text(LEFT, labels.seller, 9, true);
  canvas.y -= 13;
  canvas.text(LEFT, doc.seller.name, 10, true);
  for (const row of partyRows(doc.seller, labels.taxId)) {
    canvas.y -= 11;
    canvas.text(LEFT, row, 9);
  }
  const sellerBottom = canvas.y;
  canvas.y = partiesTop;
  const buyerX = 310;
  canvas.text(buyerX, labels.buyer, 9, true);
  canvas.y -= 13;
  for (const row of wrapText(doc.buyer.name, 48)) {
    canvas.text(buyerX, row, 10, true);
    canvas.y -= 11;
  }
  canvas.y += 11;
  for (const row of partyRows(doc.buyer, labels.taxId)) {
    canvas.y -= 11;
    canvas.text(buyerX, row, 9);
  }
  if (doc.buyer.recipientName !== "") {
    canvas.y -= 15;
    canvas.text(buyerX, labels.recipient, 9, true);
    canvas.y -= 11;
    canvas.text(buyerX, doc.buyer.recipientName, 9);
    for (const row of wrapText(doc.buyer.recipientAddress, 52).filter((part) => part !== "")) {
      canvas.y -= 11;
      canvas.text(buyerX, row, 9);
    }
  }
  canvas.y = Math.min(canvas.y, sellerBottom) - 18;
  const eventTitle = doc.locale === "en" ? doc.eventTitleEn : doc.eventTitlePl;
  if (eventTitle !== "") {
    canvas.text(LEFT, `${labels.event}: ${eventTitle}`, 9);
    canvas.y -= 12;
  }
  if (doc.buyer.poNumber !== "") {
    canvas.text(LEFT, `${labels.poNumber}: ${doc.buyer.poNumber}`, 9);
    canvas.y -= 12;
  }
  canvas.y -= 6;

  // POZYCJE (z powtorzonym naglowkiem na kazdej stronie).
  canvas.rule();
  canvas.y -= 11;
  tableHeader(canvas, labels);
  inTable = true;
  for (const line of doc.lines) {
    const rows = wrapText(line.description, DESCRIPTION_CHARS);
    canvas.ensure(rows.length * 10 + 4);
    canvas.text(COL.lp, String(line.position), 8);
    canvas.text(COL.unit, line.unit, 8);
    canvas.textRight(COL.quantity, String(line.quantity), 8);
    canvas.textRight(COL.unitNet, amount(line.unitNetCents), 8);
    canvas.textRight(COL.net, amount(line.netCents), 8);
    canvas.text(COL.rate, labels.rates[line.vatRate], 8);
    canvas.textRight(COL.vat, amount(line.vatCents), 8);
    canvas.textRight(COL.gross, amount(line.grossCents), 8);
    for (const row of rows) {
      canvas.text(COL.name, row, 8);
      canvas.y -= 10;
    }
    canvas.y -= 3;
  }
  inTable = false;

  // PODSUMOWANIE STAWEK I SUMY.
  const summary = vatSummary(doc.lines);
  canvas.ensure(summary.length * 11 + 60);
  canvas.rule();
  canvas.y -= 13;
  canvas.text(COL.unitNet - 60, labels.vatSummary, 8, true);
  canvas.y -= 11;
  for (const row of summary) {
    canvas.text(COL.unitNet - 60, labels.rates[row.vatRate], 8);
    canvas.textRight(COL.net, amount(row.netCents), 8);
    canvas.textRight(COL.vat, amount(row.vatCents), 8);
    canvas.textRight(COL.gross, amount(row.grossCents), 8);
    canvas.y -= 11;
  }
  canvas.text(COL.unitNet - 60, labels.total, 8, true);
  canvas.textRight(COL.net, amount(doc.netCents), 8, true);
  canvas.textRight(COL.vat, amount(doc.vatCents), 8, true);
  canvas.textRight(COL.gross, amount(doc.grossCents), 8, true);
  canvas.y -= 20;
  canvas.textRight(
    RIGHT,
    `${doc.paidAt === null ? labels.toPay : labels.paid}: ${formatInvoiceMoney(doc.grossCents, doc.currency)}`,
    11,
    true,
  );
  canvas.y -= 18;

  // PLATNOSC, ZWOLNIENIE, KSeF, UWAGI.
  const footer: string[] = [];
  if (doc.seller.bankAccount !== "" && doc.paymentMethod === "transfer" && doc.paidAt === null) {
    footer.push(`${labels.bankAccount}: ${doc.seller.bankAccount}`);
    if (doc.seller.bankSwift !== "") footer.push(`${labels.swift}: ${doc.seller.bankSwift}`);
  }
  if (doc.vatExemptBasis !== "") footer.push(`${labels.exemptBasis}: ${doc.vatExemptBasis}`);
  if (doc.ksefNumber !== null) footer.push(`${labels.ksefNumber}: ${doc.ksefNumber}`);
  if (doc.kind === "proforma") footer.push(labels.proformaNote);
  for (const block of [...footer, doc.note, doc.footerNote].filter((part) => part.trim() !== "")) {
    for (const row of wrapText(block, 110)) {
      canvas.ensure(11);
      canvas.text(LEFT, row, 8);
      canvas.y -= 11;
    }
    canvas.y -= 3;
  }

  // NUMERY STRON.
  const total = canvas.pages.length;
  canvas.pages.forEach((page, index) => {
    page.ops.push(
      `BT /${FONT_REGULAR} 7 Tf 1 0 0 1 ${LEFT} 40 Tm (${encodePdfText(labels.page(index + 1, total))}) Tj ET`,
    );
  });
  return assemble(canvas.pages.map((page) => page.ops.join("\n")));
}

const DIFFERENCES =
  "128 /aogonek 129 /cacute 130 /eogonek 131 /lslash 132 /nacute 133 /sacute 134 /zacute " +
  "135 /zdotaccent 136 /Aogonek 137 /Cacute 138 /Eogonek 139 /Lslash 140 /Nacute 141 /Sacute " +
  "142 /Zacute 143 /Zdotaccent";

/** Sklada wielostronicowy PDF (A4) z tym samym kodowaniem glifow co modul rozliczen. */
function assemble(contents: string[]): Uint8Array<ArrayBuffer> {
  const encoding = `<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [ ${DIFFERENCES} ] >>`;
  const firstPage = 5;
  const kids = contents.map((_content, index) => `${firstPage + index * 2} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${contents.length} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding ${encoding} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding ${encoding} >>`,
  ];
  contents.forEach((content, index) => {
    const pageId = firstPage + index * 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  });
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
