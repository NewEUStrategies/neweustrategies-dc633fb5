// Generator PDF faktury/rachunku - czysty TypeScript, bez zależności.
//
// PRZYCZYNA. Panel musi wystawić plik PDF także wtedy, gdy operator płatności
// nie udostępnił własnego dokumentu (paragon zamiast faktury, dokument jeszcze
// nie gotowy, link czasowy wygasł). Środowisko serwerowe to Worker - nie ma
// tam przeglądarki ani natywnych bibliotek (puppeteer/sharp), więc plik składamy
// bajt po bajcie.
//
// POLSKIE ZNAKI. Bazowe fonty PDF (Helvetica) używają kodowania WinAnsi, w
// którym nie ma ą/ć/ę/ł/ń/ś/ź/ż. Podmieniamy więc nieużywane kody 0x80-0x9F na
// właściwe nazwy glifów przez tablicę /Differences - to standardowy zapis PDF,
// czytany przez każdą przeglądarkę i program księgowy.

export interface InvoiceParty {
  name: string;
  taxId?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  email?: string | null;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  /** Kwota brutto pozycji w groszach/centach. */
  amountCents: number;
}

export interface InvoiceData {
  number: string;
  issuedAt: string;
  currency: string;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  lines: InvoiceLine[];
  /** Etykiety w języku odbiorcy - moduł nie zna i18n aplikacji. */
  labels: InvoiceLabels;
  /** Nota pod tabelą (np. informacja o rozliczeniu podatku przez operatora). */
  note?: string | null;
}

export interface InvoiceLabels {
  title: string;
  number: string;
  issuedAt: string;
  seller: string;
  buyer: string;
  taxId: string;
  description: string;
  quantity: string;
  amount: string;
  total: string;
  paid: string;
}

/** Kody 0x80-0x9F przypisane polskim glifom (patrz nota na górze pliku). */
const DIFFERENCES: Array<[number, string, string]> = [
  [0x80, "aogonek", "ą"],
  [0x81, "cacute", "ć"],
  [0x82, "eogonek", "ę"],
  [0x83, "lslash", "ł"],
  [0x84, "nacute", "ń"],
  [0x85, "sacute", "ś"],
  [0x86, "zacute", "ź"],
  [0x87, "zdotaccent", "ż"],
  [0x88, "Aogonek", "Ą"],
  [0x89, "Cacute", "Ć"],
  [0x8a, "Eogonek", "Ę"],
  [0x8b, "Lslash", "Ł"],
  [0x8c, "Nacute", "Ń"],
  [0x8d, "Sacute", "Ś"],
  [0x8e, "Zacute", "Ź"],
  [0x8f, "Zdotaccent", "Ż"],
];

const CHAR_TO_CODE = new Map<string, number>(DIFFERENCES.map(([code, , ch]) => [ch, code]));
const WINANSI: Record<string, number> = { ó: 0xf3, Ó: 0xd3, "€": 0x80 };

/** Zamiana napisu na literał PDF w naszym kodowaniu (z ucieczkami). */
export function encodePdfText(value: string): string {
  let out = "";
  for (const ch of value) {
    const mapped = CHAR_TO_CODE.get(ch) ?? WINANSI[ch];
    if (mapped !== undefined) {
      out += `\\${mapped.toString(8).padStart(3, "0")}`;
      continue;
    }
    const code = ch.codePointAt(0) ?? 63;
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (code < 32 || code > 126) out += "?";
    else out += ch;
  }
  return out;
}

/** Kwota w groszach -> tekst „1 234,56 EUR" (spacja niełamliwa jest zbędna w PDF). */
export function formatInvoiceMoney(cents: number, currency: string): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}${whole},${frac} ${currency.toUpperCase()}`;
}

export function invoiceTotalCents(lines: InvoiceLine[]): number {
  return lines.reduce((sum, line) => sum + Math.round(line.amountCents), 0);
}

interface Cursor {
  y: number;
  ops: string[];
}

const LEFT = 56;
const RIGHT = 539;
const FONT_REGULAR = "F1";
const FONT_BOLD = "F2";

function text(cursor: Cursor, x: number, value: string, size: number, bold = false): void {
  cursor.ops.push(
    `BT /${bold ? FONT_BOLD : FONT_REGULAR} ${size} Tf 1 0 0 1 ${x} ${cursor.y} Tm (${encodePdfText(value)}) Tj ET`,
  );
}

function textRight(cursor: Cursor, x: number, value: string, size: number, bold = false): void {
  // Szerokość Helvetiki liczymy przybliżeniem 0.5em - wystarcza do wyrównania
  // kolumny kwot do prawej krawędzi tabeli, a nie wymaga metryk fontu.
  const width = value.length * size * 0.5;
  text(cursor, x - width, value, size, bold);
}

function line(cursor: Cursor): void {
  cursor.ops.push(`0.85 0.85 0.85 RG 0.7 w ${LEFT} ${cursor.y} m ${RIGHT} ${cursor.y} l S`);
}

function partyBlock(cursor: Cursor, x: number, title: string, party: InvoiceParty, labels: InvoiceLabels): void {
  const startY = cursor.y;
  text(cursor, x, title, 9, true);
  cursor.y -= 14;
  text(cursor, x, party.name, 10, true);
  const rows = [
    party.addressLine1,
    party.addressLine2,
    [party.postalCode, party.city].filter(Boolean).join(" "),
    party.country,
    party.taxId ? `${labels.taxId}: ${party.taxId}` : null,
    party.email,
  ].filter((row): row is string => !!row && row.trim().length > 0);
  for (const row of rows) {
    cursor.y -= 12;
    text(cursor, x, row, 9);
  }
  cursor.y = Math.min(cursor.y, startY);
}

/** Składa jednostronicowy dokument PDF (A4) i zwraca jego bajty. */
export function renderInvoicePdf(data: InvoiceData): Uint8Array {
  const cursor: Cursor = { y: 786, ops: [] };
  const labels = data.labels;

  text(cursor, LEFT, data.seller.name, 13, true);
  cursor.y -= 18;
  text(cursor, LEFT, labels.title, 18, true);
  textRight(cursor, RIGHT, `${labels.number}: ${data.number}`, 10, true);
  cursor.y -= 14;
  textRight(cursor, RIGHT, `${labels.issuedAt}: ${data.issuedAt}`, 9);
  cursor.y -= 18;
  line(cursor);
  cursor.y -= 24;

  const partiesTop = cursor.y;
  partyBlock(cursor, LEFT, labels.seller, data.seller, labels);
  const sellerBottom = cursor.y;
  cursor.y = partiesTop;
  partyBlock(cursor, 320, labels.buyer, data.buyer, labels);
  cursor.y = Math.min(sellerBottom, cursor.y) - 28;

  line(cursor);
  cursor.y -= 14;
  text(cursor, LEFT, labels.description, 9, true);
  textRight(cursor, 400, labels.quantity, 9, true);
  textRight(cursor, RIGHT, labels.amount, 9, true);
  cursor.y -= 8;
  line(cursor);

  for (const item of data.lines) {
    cursor.y -= 18;
    text(cursor, LEFT, item.description.slice(0, 58), 9);
    textRight(cursor, 400, String(item.quantity), 9);
    textRight(cursor, RIGHT, formatInvoiceMoney(item.amountCents, data.currency), 9);
  }

  cursor.y -= 12;
  line(cursor);
  cursor.y -= 18;
  text(cursor, 320, labels.total, 11, true);
  textRight(cursor, RIGHT, formatInvoiceMoney(invoiceTotalCents(data.lines), data.currency), 11, true);
  cursor.y -= 20;
  textRight(cursor, RIGHT, labels.paid, 9);

  if (data.note) {
    cursor.y -= 30;
    text(cursor, LEFT, data.note.slice(0, 110), 8);
  }

  return assemblePdf(cursor.ops.join("\n"));
}

function assemblePdf(content: string): Uint8Array {
  const differences = DIFFERENCES.map(([code, glyph]) => `${code} /${glyph}`).join(" ");
  const encoding = `<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [ ${differences} ] >>`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding ${encoding} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding ${encoding} >>`,
  ];

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

/** Bajty PDF -> base64 (transport przez server function). */
export function pdfToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}
