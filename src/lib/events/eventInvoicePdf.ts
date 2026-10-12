// PDF FAKTURY WYDARZENIA (faktura VAT, proforma, korekta) - renderer czysty,
// bez zaleznosci, dzialajacy w przegladarce i w Workerze.
//
// DLACZEGO NIE `renderInvoicePdf` z modulu rozliczen. Tamten renderer drukuje
// KOPIE dokumentu operatora platnosci: jedna strona, jedna kolumna kwoty
// brutto, opis przyciety do 58 znakow. Faktura organizatora potrzebuje
// kolumn stawki i wartosci brutto, podsumowania stawek (netto, VAT, brutto),
// naglowka korekty, rachunku do przelewu, podstawy zwolnienia i - dla
// faktury zbiorczej z kilkudziesiecioma pozycjami - WIELU STRON z
// powtorzonym naglowkiem tabeli. Wspolne sa tylko niskopoziomowe klocki:
// kodowanie glifow spoza Latin-1 z fontami dokumentu (`pdfText`, INV-19b)
// i zapis kwoty (`formatInvoiceMoney`).
//
// JEZYK DOKUMENTU = jezyk faktury (`doc.locale`), nie jezyk panelu. Etykiety
// podaje wolajacy (`eventInvoicePdfLabels.ts`, `i18n.getFixedT(locale)`), wiec
// modul nie zna i18n i jest w pelni testowalny.
//
// METODA BRUTTO (art. 106e ust. 7 i 8 ustawy o VAT, INV-16). Ceny biletow sa
// cenami brutto, wiec podatek liczy sie od SUMY wartosci brutto w stawce, nie
// od pozycji. Tabela pozycji drukuje cene jednostkowa i wartosc BRUTTO (bez
// netto i VAT z pozycji - suma takich kwot rozjezdzala sie z podatkiem
// faktury o grosze), a netto, VAT i brutto pokazuje podsumowanie stawek
// ZAMROZONE na dokumencie (`doc.vatSummary`, liczone przez baze przy
// wystawieniu). Szkic bez zamrozonego podsumowania liczy je lustrem bazy
// (`vatSummary`, korekta - od stanu przed nia: `doc.rateGrossBefore`).
//
// ADNOTACJE PODATKOWE. Faktura w walucie obcej drukuje kurs sredni NBP (tabela,
// dzien) i VAT w PLN (art. 106e ust. 11, INV-06); dokument z odwrotnym
// obciazeniem - adnotacje "odwrotne obciazenie", a pozycje "np" - podstawe
// prawna (INV-12); korekta - numer KSeF faktury korygowanej (INV-17).
import { formatInvoiceMoney } from "@/lib/billing/invoicePdf";
import { PDF_FONT_COUNT, pdfFontObjects, pdfFontResources, pdfTextOp } from "@/lib/billing/pdfText";
import type {
  EventInvoiceDocument,
  EventInvoiceDocumentVatRow,
} from "@/lib/events/eventInvoiceDocument";
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
    unitGross: string;
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
  /** Korekta z ujemna suma: kwota do zwrotu nabywcy (drukowana bez minusa). */
  toRefund: string;
  /** Korekta z ujemna suma, zwrot juz wykonany. */
  refunded: string;
  /** Wiersz naglowka korekty, np. "Korekta do faktury FV/2026/09/0001 z 2026-09-26". */
  correctsLine: string;
  correctionReason: string;
  /** Numer KSeF faktury korygowanej (korekta, INV-17). */
  correctsKsefNumber: string;
  exemptBasis: string;
  /** Podstawa prawna pozycji "np" (INV-12). */
  npBasis: string;
  /** Adnotacja ustawowa "odwrotne obciazenie" (art. 106e ust. 1 pkt 18). */
  reverseCharge: string;
  /** Naglowek kolumny VAT w PLN w podsumowaniu stawek (waluta obca). */
  vatPln: string;
  /** Wiersz kursu NBP gotowy do druku albo pusty (dokument w PLN, szkic). */
  fxLine: string;
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
const DESCRIPTION_CHARS = 58;
// Kolumny stron transakcji maja ok. 250 pt (sprzedawca od 40 do 300, nabywca
// od 310 do 555). Helvetica: pogrubiona 10 pt ~5,5 pt na znak, zwykla 9 pt
// ~4,5 pt - nazwe i adres (do 200 znakow w bazie) ZAWIJAMY, inaczej dluga
// nazwa sprzedawcy wchodzila na kolumne nabywcy, a adres nabywcy wychodzil
// poza strone.
const PARTY_NAME_CHARS = 44;
const PARTY_ROW_CHARS = 52;

/** Kolumny tabeli pozycji: x = lewa krawedz (tekst) albo prawa (kwoty). */
const COL = {
  lp: LEFT,
  name: LEFT + 20,
  unit: 350,
  quantity: 410,
  unitGross: 472,
  rate: 482,
  gross: RIGHT,
} as const;

/** Kolumny podsumowania stawek (prawe krawedzie kwot). */
const SUM = {
  label: 250,
  net: 380,
  vat: 440,
  vatPln: 500,
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
    this.ops.push(pdfTextOp(x, this.y, value, size, bold));
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
  ]
    .filter((row) => row.trim() !== "")
    .flatMap((row) => wrapText(row, PARTY_ROW_CHARS));
}

/** Nazwa i adres strony w jej kolumnie (zawiniete). */
function drawParty(canvas: Canvas, x: number, name: string, rows: readonly string[]): void {
  for (const row of wrapText(name, PARTY_NAME_CHARS)) {
    canvas.text(x, row, 10, true);
    canvas.y -= 11;
  }
  canvas.y += 11;
  for (const row of rows) {
    canvas.y -= 11;
    canvas.text(x, row, 9);
  }
}

/**
 * Wiersz kwoty dokumentu. Korekta z UJEMNA suma to zwrot dla nabywcy - "Do
 * zaplaty: -2 300,00" myli; drukujemy "Do zwrotu"/"Zwrocono" i kwote bez minusa.
 */
function amountDueLine(doc: EventInvoiceDocument, labels: EventInvoicePdfLabels): string {
  if (doc.grossCents < 0) {
    const label = doc.paidAt === null ? labels.toRefund : labels.refunded;
    return `${label}: ${formatInvoiceMoney(-doc.grossCents, doc.currency)}`;
  }
  const label = doc.paidAt === null ? labels.toPay : labels.paid;
  return `${label}: ${formatInvoiceMoney(doc.grossCents, doc.currency)}`;
}

function tableHeader(canvas: Canvas, labels: EventInvoicePdfLabels): void {
  const c = labels.columns;
  canvas.text(COL.lp, c.lp, 7, true);
  canvas.text(COL.name, c.name, 7, true);
  canvas.text(COL.unit, c.unit, 7, true);
  canvas.textRight(COL.quantity, c.quantity, 7, true);
  canvas.textRight(COL.unitGross, c.unitGross, 7, true);
  canvas.text(COL.rate, c.rate, 7, true);
  canvas.textRight(COL.gross, c.gross, 7, true);
  canvas.y -= 5;
  canvas.rule();
  canvas.y -= 11;
}

/**
 * Podsumowanie stawek do druku: zamrozone na dokumencie albo (szkic) lustro
 * bazy z pozycji - korekta liczy roznice od stanu przed nia.
 */
export function pdfVatRows(doc: EventInvoiceDocument): EventInvoiceDocumentVatRow[] {
  if (doc.vatSummary.length > 0) return doc.vatSummary;
  return vatSummary(doc.lines, doc.kind === "correction" ? doc.rateGrossBefore : {}).map((row) => ({
    ...row,
    vatPlnCents: null,
  }));
}

/** Nazwa pliku: rdzen + numer dokumentu (ukosniki na myslniki) albo "szkic". */
export function eventInvoicePdfFileName(
  doc: EventInvoiceDocument,
  labels: EventInvoicePdfLabels,
): string {
  const tail =
    doc.number === null ? `draft-${doc.id.slice(0, 8)}` : doc.number.replace(/[^A-Za-z0-9]+/g, "-");
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
    if (doc.corrects?.ksefNumber) {
      canvas.text(LEFT, `${labels.correctsKsefNumber}: ${doc.corrects.ksefNumber}`, 9);
      canvas.y -= 11;
    }
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
  drawParty(canvas, LEFT, doc.seller.name, partyRows(doc.seller, labels.taxId));
  const sellerBottom = canvas.y;
  canvas.y = partiesTop;
  const buyerX = 310;
  canvas.text(buyerX, labels.buyer, 9, true);
  canvas.y -= 13;
  drawParty(canvas, buyerX, doc.buyer.name, partyRows(doc.buyer, labels.taxId));
  if (doc.buyer.recipientName !== "") {
    canvas.y -= 15;
    canvas.text(buyerX, labels.recipient, 9, true);
    canvas.y -= 11;
    for (const row of wrapText(doc.buyer.recipientName, PARTY_ROW_CHARS)) {
      canvas.text(buyerX, row, 9);
      canvas.y -= 11;
    }
    canvas.y += 11;
    for (const row of wrapText(doc.buyer.recipientAddress, PARTY_ROW_CHARS).filter(
      (part) => part !== "",
    )) {
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
    canvas.textRight(COL.unitGross, amount(line.unitGrossCents), 8);
    canvas.text(COL.rate, labels.rates[line.vatRate], 8);
    canvas.textRight(COL.gross, amount(line.grossCents), 8);
    for (const row of rows) {
      canvas.text(COL.name, row, 8);
      canvas.y -= 10;
    }
    canvas.y -= 3;
  }
  inTable = false;

  // PODSUMOWANIE STAWEK I SUMY (metoda brutto: podatek od sumy w stawce).
  const summary = pdfVatRows(doc);
  const fx = doc.fx;
  canvas.ensure(summary.length * 11 + 90);
  canvas.rule();
  canvas.y -= 13;
  canvas.text(SUM.label, labels.vatSummary, 8, true);
  canvas.textRight(SUM.net, labels.columns.net, 7, true);
  canvas.textRight(SUM.vat, labels.columns.vat, 7, true);
  if (fx !== null) canvas.textRight(SUM.vatPln, labels.vatPln, 7, true);
  canvas.textRight(SUM.gross, labels.columns.gross, 7, true);
  canvas.y -= 11;
  for (const row of summary) {
    canvas.text(SUM.label, labels.rates[row.vatRate], 8);
    canvas.textRight(SUM.net, amount(row.netCents), 8);
    canvas.textRight(SUM.vat, amount(row.vatCents), 8);
    if (fx !== null && row.vatPlnCents !== null) {
      canvas.textRight(SUM.vatPln, amount(row.vatPlnCents), 8);
    }
    canvas.textRight(SUM.gross, amount(row.grossCents), 8);
    canvas.y -= 11;
  }
  canvas.text(SUM.label, labels.total, 8, true);
  canvas.textRight(SUM.net, amount(doc.netCents), 8, true);
  canvas.textRight(SUM.vat, amount(doc.vatCents), 8, true);
  if (fx !== null) canvas.textRight(SUM.vatPln, amount(fx.vatPlnCents), 8, true);
  canvas.textRight(SUM.gross, amount(doc.grossCents), 8, true);
  canvas.y -= 20;
  if (doc.reverseChargeEffective) {
    canvas.text(LEFT, labels.reverseCharge, 11, true);
  }
  canvas.textRight(RIGHT, amountDueLine(doc, labels), 11, true);
  canvas.y -= 18;

  // KURS NBP, PLATNOSC, PODSTAWY, KSeF, UWAGI.
  const footer: string[] = [];
  if (fx !== null && labels.fxLine !== "") footer.push(labels.fxLine);
  if (doc.seller.bankAccount !== "" && doc.paymentMethod === "transfer" && doc.paidAt === null) {
    footer.push(`${labels.bankAccount}: ${doc.seller.bankAccount}`);
    if (doc.seller.bankSwift !== "") footer.push(`${labels.swift}: ${doc.seller.bankSwift}`);
  }
  if (doc.vatExemptBasis !== "") footer.push(`${labels.exemptBasis}: ${doc.vatExemptBasis}`);
  if (doc.npBasisEffective !== "" && doc.lines.some((line) => line.vatRate === "np")) {
    footer.push(`${labels.npBasis}: ${doc.npBasisEffective}`);
  }
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
    page.ops.push(pdfTextOp(LEFT, 40, labels.page(index + 1, total), 7));
  });
  return assemble(canvas.pages.map((page) => page.ops.join("\n")));
}

/** Obiekty 1-2: katalog i drzewo stron; od 3: fonty `pdfText`; dalej pary strona + tresc. */
const FIRST_FONT_OBJECT = 3;

/** Sklada wielostronicowy PDF (A4) z tym samym kodowaniem glifow co modul rozliczen (`pdfText`). */
function assemble(contents: string[]): Uint8Array<ArrayBuffer> {
  const fonts = pdfFontResources(FIRST_FONT_OBJECT);
  const firstPage = FIRST_FONT_OBJECT + PDF_FONT_COUNT;
  const kids = contents.map((_content, index) => `${firstPage + index * 2} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${contents.length} >>`,
    ...pdfFontObjects(),
  ];
  contents.forEach((content, index) => {
    const pageId = firstPage + index * 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font ${fonts} >> /Contents ${pageId + 1} 0 R >>`,
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
