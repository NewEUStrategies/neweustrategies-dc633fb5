// TEKST W PDF: kodowanie glifów standardowej Helvetiki - wspólne dla obu
// generatorów (kopia dokumentu operatora `invoicePdf.ts` i faktura wydarzenia
// `eventInvoicePdf.ts`).
//
// PRZYCZYNA. Font bazowy PDF ma kodowanie jednobajtowe - najwyżej 256 kodów na
// font. WinAnsi daje ASCII, Latin-1 i typografię, ale nie ma ą/ł/ś, ő/ű
// (Węgry), č/ř/ů (Czechy), ų/ė/ū (Litwa), ș/ț (Rumunia) ani ğ/ı (Turcja).
// Wcześniej generator podmieniał 16 kodów WinAnsi na polskie glify, a każdy
// inny znak drukował jako `?` - „Dvořák s.r.o." stawało się na dokumencie
// „Dvo?ák s.r.o.". Przy okazji podmiana zabierała kod 0x80 znakowi €.
//
// DLACZEGO NIE OSADZONY FONT TRUETYPE. Generatory działają w Workerze (i w
// przeglądarce) pod bramkami rozmiaru pakietu. Osadzenie wymaga pliku fontu
// (podzbiór Liberation/DejaVu z cyrylicą to 20-60 KB w pakiecie, licencja
// OFL/Bitstream do odnotowania), parsera glyf/loca do cięcia podzbioru,
// fontu CIDFontType2 z mapą ToUnicode i własnych metryk szerokości. Zysk ponad
// to, co niżej, to cyrylica i greka - a tych dane rozliczeniowe członków UE
// praktycznie nie niosą. Standardowa Helvetica w metrykach Adobe Core14 (AFM
// 4.1) ma 315 glifów, w tym CAŁY zestaw środkowoeuropejski, bałtycki,
// rumuński i turecki. Czytnik ma ją zawsze (font nieosadzony, glif wybierany
// po NAZWIE z Adobe Glyph List), więc wystarczy te glify zaadresować - zero
// bajtów fontu, zero licencji.
//
// JAK. Jedno kodowanie mieści 256 kodów, więc definiujemy kilka. Każde to PEŁNE
// WinAnsi (ASCII, Latin-1, typografia, €) plus /Differences na kodach, których
// WinAnsi nie używa: 0x01-0x1F, 0x7F, 0x81, 0x8D, 0x8F, 0x90, 0x9D (37 miejsc).
// 98 glifów Helvetiki spoza WinAnsi rozkładamy kolejno, polskie pierwsze -
// polski dokument nie przełącza fontu ani razu, a ASCII i Latin-1 są w każdym
// kodowaniu, więc nie przełączają go nigdy. Kodowanie `i` to para fontów
// F(2i+1) zwykły / F(2i+2) pogrubiony: F1/F2, F3/F4, F5/F6. Napis dzielimy na
// odcinki per kodowanie i w jednym BT...ET emitujemy `Tf` + `Tj` dla każdego
// odcinka - `Tj` przesuwa pióro o szerokość tekstu, więc odcinki składają się
// w jeden wiersz.
//
// ZNAK SPOZA WSZYSTKICH KODOWAŃ. Najpierw NFC (litera ze znakiem łączącym, np.
// z wklejki z macOS, staje się jednym znakiem), potem rozkład NFD i zrzucanie
// znaków diakrytycznych od końca (ǘ -> ü, ậ -> a), a `?` dopiero wtedy, gdy
// nie ma litery bazowej (cyrylica, emoji, znaki sterujące). Znak sterujący
// NIGDY nie trafia do pliku surowym bajtem: kody 0x01-0x1F niosą tu glify,
// więc `\n` z pola adresu wydrukowałby literę.

/** Para (nazwa glifu Helvetiki, znaki Unicode rysowane tym glifem). */
type ExtraGlyph = readonly [glyph: string, chars: string];

/**
 * Glify standardowej Helvetiki (Adobe Core14, AFM 4.1) spoza WinAnsi - nazwy
 * z Adobe Glyph List. Kolejność = kolejność przydziału kodów.
 */
const EXTRA_GLYPHS: readonly ExtraGlyph[] = [
  // Polski - pierwszy, żeby polski dokument nie przełączał fontu.
  ["aogonek", "ą"],
  ["cacute", "ć"],
  ["eogonek", "ę"],
  ["lslash", "ł"],
  ["nacute", "ń"],
  ["sacute", "ś"],
  ["zacute", "ź"],
  ["zdotaccent", "ż"],
  ["Aogonek", "Ą"],
  ["Cacute", "Ć"],
  ["Eogonek", "Ę"],
  ["Lslash", "Ł"],
  ["Nacute", "Ń"],
  ["Sacute", "Ś"],
  ["Zacute", "Ź"],
  ["Zdotaccent", "Ż"],
  // Czeski i słowacki (š/ž/Š/Ž są w WinAnsi).
  ["Ccaron", "Č"],
  ["ccaron", "č"],
  ["Dcaron", "Ď"],
  ["dcaron", "ď"],
  ["Ecaron", "Ě"],
  ["ecaron", "ě"],
  ["Ncaron", "Ň"],
  ["ncaron", "ň"],
  ["Rcaron", "Ř"],
  ["rcaron", "ř"],
  ["Tcaron", "Ť"],
  ["tcaron", "ť"],
  ["Uring", "Ů"],
  ["uring", "ů"],
  ["Lacute", "Ĺ"],
  ["lacute", "ĺ"],
  ["Lcaron", "Ľ"],
  ["lcaron", "ľ"],
  ["Racute", "Ŕ"],
  ["racute", "ŕ"],
  // Węgierski.
  ["Ohungarumlaut", "Ő"],
  ["ohungarumlaut", "ő"],
  ["Uhungarumlaut", "Ű"],
  ["uhungarumlaut", "ű"],
  // Litewski.
  ["Edotaccent", "Ė"],
  ["edotaccent", "ė"],
  ["Iogonek", "Į"],
  ["iogonek", "į"],
  ["Uogonek", "Ų"],
  ["uogonek", "ų"],
  ["Umacron", "Ū"],
  ["umacron", "ū"],
  // Łotewski.
  ["Amacron", "Ā"],
  ["amacron", "ā"],
  ["Emacron", "Ē"],
  ["emacron", "ē"],
  ["Imacron", "Ī"],
  ["imacron", "ī"],
  ["Gcommaaccent", "Ģ"],
  ["gcommaaccent", "ģ"],
  ["Kcommaaccent", "Ķ"],
  ["kcommaaccent", "ķ"],
  ["Lcommaaccent", "Ļ"],
  ["lcommaaccent", "ļ"],
  ["Ncommaaccent", "Ņ"],
  ["ncommaaccent", "ņ"],
  ["Omacron", "Ō"],
  ["omacron", "ō"],
  ["Rcommaaccent", "Ŗ"],
  ["rcommaaccent", "ŗ"],
  // Rumuński. Ț/ț (przecinek, U+021A/B) i Ţ/ţ (cedylla, U+0162/3) to w Adobe
  // Glyph List ten sam glif `Tcommaaccent` - rumuńskie dane bywają w obu
  // zapisach, więc oba muszą się drukować.
  ["Abreve", "Ă"],
  ["abreve", "ă"],
  ["Scommaaccent", "Ș"],
  ["scommaaccent", "ș"],
  ["Tcommaaccent", "ȚŢ"],
  ["tcommaaccent", "țţ"],
  // Turecki (i starszy zapis rumuński: Ş/ş z cedyllą).
  ["Scedilla", "Ş"],
  ["scedilla", "ş"],
  ["Gbreve", "Ğ"],
  ["gbreve", "ğ"],
  ["Idotaccent", "İ"],
  ["dotlessi", "ı"],
  // Chorwacki, serbski (łaciński), bośniacki.
  ["Dcroat", "Đ"],
  ["dcroat", "đ"],
  // Symbole i akcenty samodzielne z tego samego zestawu Core14.
  ["minus", "−"],
  ["lessequal", "≤"],
  ["greaterequal", "≥"],
  ["notequal", "≠"],
  ["Delta", "∆"],
  ["partialdiff", "∂"],
  ["summation", "∑"],
  ["radical", "√"],
  ["lozenge", "◊"],
  ["fraction", "⁄"],
  ["fi", "ﬁ"],
  ["fl", "ﬂ"],
  ["breve", "˘"],
  ["dotaccent", "˙"],
  ["ring", "˚"],
  ["hungarumlaut", "˝"],
  ["ogonek", "˛"],
  ["caron", "ˇ"],
];

/** Kody, których WinAnsi nie używa - jedyne, które /Differences może przejąć bez strat. */
const FREE_CODES: readonly number[] = [
  ...Array.from({ length: 0x1f }, (_unused, index) => index + 1),
  0x7f,
  0x81,
  0x8d,
  0x8f,
  0x90,
  0x9d,
];

/** Znaki WinAnsi z zakresu 0x80-0x9F (typografia). Reszta WinAnsi = ASCII i Latin-1. */
const WIN_ANSI_HIGH: ReadonlyArray<readonly [code: number, char: string]> = [
  [0x80, "€"],
  [0x82, "‚"],
  [0x83, "ƒ"],
  [0x84, "„"],
  [0x85, "…"],
  [0x86, "†"],
  [0x87, "‡"],
  [0x88, "ˆ"],
  [0x89, "‰"],
  [0x8a, "Š"],
  [0x8b, "‹"],
  [0x8c, "Œ"],
  [0x8e, "Ž"],
  [0x91, "‘"],
  [0x92, "’"],
  [0x93, "“"],
  [0x94, "”"],
  [0x95, "•"],
  [0x96, "–"],
  [0x97, "—"],
  [0x98, "˜"],
  [0x99, "™"],
  [0x9a, "š"],
  [0x9b, "›"],
  [0x9c, "œ"],
  [0x9e, "ž"],
  [0x9f, "Ÿ"],
];

/** Znak -> kod w samym WinAnsi: ASCII drukowalne, typografia 0x80-0x9F, Latin-1. */
function winAnsiCodes(): Map<string, number> {
  const codes = new Map<string, number>();
  for (let code = 0x20; code <= 0x7e; code += 1) codes.set(String.fromCharCode(code), code);
  for (const [code, char] of WIN_ANSI_HIGH) codes.set(char, code);
  for (let code = 0xa0; code <= 0xff; code += 1) codes.set(String.fromCharCode(code), code);
  return codes;
}

interface PdfEncoding {
  /** Znak -> kod bajtu w tym kodowaniu. */
  readonly codes: ReadonlyMap<string, number>;
  /** Treść tablicy /Differences (kody zgrupowane w ciągłe przebiegi). */
  readonly differences: string;
}

/** Zapis /Differences: `1 /a /b 127 /c` - po kodzie startowym kolejne nazwy dostają kolejne kody. */
function differencesOf(assigned: ReadonlyArray<readonly [code: number, glyph: string]>): string {
  const parts: string[] = [];
  let previous = Number.NaN;
  for (const [code, glyph] of assigned) {
    if (code !== previous + 1) parts.push(String(code));
    parts.push(`/${glyph}`);
    previous = code;
  }
  return parts.join(" ");
}

function buildEncodings(): readonly PdfEncoding[] {
  const encodings: PdfEncoding[] = [];
  for (let start = 0; start < EXTRA_GLYPHS.length; start += FREE_CODES.length) {
    const codes = winAnsiCodes();
    const assigned = EXTRA_GLYPHS.slice(start, start + FREE_CODES.length).map(
      ([glyph, chars], index) => {
        const code = FREE_CODES[index];
        for (const char of chars) codes.set(char, code);
        return [code, glyph] as const;
      },
    );
    encodings.push({ codes, differences: differencesOf(assigned) });
  }
  return encodings;
}

const ENCODINGS = buildEncodings();

/** Liczba fontów w każdym dokumencie: para (zwykły, pogrubiony) na kodowanie. */
export const PDF_FONT_COUNT = ENCODINGS.length * 2;

const inAnyEncoding = (char: string): boolean => ENCODINGS.some((enc) => enc.codes.has(char));

const COMBINING_MARK = /^\p{M}$/u;

/**
 * Znak, który da się wydrukować (`printable(char)` należy do `has`): sam znak,
 * ta sama litera z mniejszą liczbą znaków diakrytycznych, `""` dla
 * osieroconego znaku łączącego (jego litera już się wydrukowała) albo `?`.
 */
function printable(char: string, has: (candidate: string) => boolean): string {
  if (has(char)) return char;
  if (COMBINING_MARK.test(char)) return "";
  const [base = "", ...marks] = [...char.normalize("NFD")];
  for (let keep = marks.length - 1; keep >= 0; keep -= 1) {
    const candidate = (base + marks.slice(0, keep).join("")).normalize("NFC");
    if (has(candidate)) return candidate;
  }
  return "?";
}

const octal = (code: number): string => `\\${code.toString(8).padStart(3, "0")}`;

/** Kod `?` - ostatnia deska ratunku, ASCII, więc obecny w każdym kodowaniu. */
const QUESTION_MARK = 0x3f;

/**
 * Literał PDF (bez nawiasów) znaków przepuszczonych przez `printable`. Znak
 * spoza kodowania nie może tu dojść, a gdyby doszedł - wychodzi `?`, nigdy
 * młodszy bajt kodu Unicode (`ĩ` & 0xff to `)`, który domknąłby literał).
 */
function literalOf(chars: readonly string[], encoding: PdfEncoding): string {
  let out = "";
  for (const char of chars) {
    // Zapis idzie z KODU, nie ze znaku: dla ASCII to ten sam bajt, a dla
    // zastępczego `?` nie przepuszczamy oryginału.
    const code = encoding.codes.get(char) ?? QUESTION_MARK;
    const ascii = String.fromCharCode(code);
    if (ascii === "(" || ascii === ")" || ascii === "\\") out += `\\${ascii}`;
    else if (code >= 0x20 && code <= 0x7e) out += ascii;
    else out += octal(code);
  }
  return out;
}

/**
 * Napis jako literał PDF (z ucieczkami, bez nawiasów) w kodowaniu PODSTAWOWYM
 * (F1/F2: WinAnsi + litery polskie, czeskie i słowackie). Znak spoza niego degraduje się
 * jak w nocie na górze pliku. Renderery używają `pdfTextOp`, który dzieli napis
 * między kodowania; ta funkcja zostaje dla treści, o których wiadomo, że
 * mieszczą się w podstawowym (testy, etykiety).
 */
export function encodePdfText(value: string): string {
  const [encoding] = ENCODINGS;
  const has = (char: string): boolean => encoding.codes.has(char);
  const chars = [...value.normalize("NFC")].flatMap((char) => [...printable(char, has)]);
  return literalOf(chars, encoding);
}

/** Odcinek napisu w jednym kodowaniu: indeks kodowania i gotowy literał. */
export interface PdfTextRun {
  readonly encoding: number;
  readonly literal: string;
}

/**
 * Podział napisu na odcinki per kodowanie. Gdy JEDNO kodowanie mieści cały
 * napis (prawie zawsze - polski, czeski, ASCII), wychodzi jeden odcinek;
 * inaczej zachłannie: odcinek trwa, dopóki jego kodowanie zna kolejny znak.
 */
export function pdfTextRuns(value: string): PdfTextRun[] {
  const chars = [...value.normalize("NFC")].flatMap((char) => [...printable(char, inAnyEncoding)]);
  const whole = ENCODINGS.findIndex((enc) => chars.every((char) => enc.codes.has(char)));
  if (whole !== -1) return [{ encoding: whole, literal: literalOf(chars, ENCODINGS[whole]) }];

  const runs: PdfTextRun[] = [];
  let current = -1;
  let pending: string[] = [];
  const flush = (): void => {
    if (pending.length > 0) {
      runs.push({ encoding: current, literal: literalOf(pending, ENCODINGS[current]) });
    }
    pending = [];
  };
  for (const char of chars) {
    if (current === -1 || !ENCODINGS[current].codes.has(char)) {
      flush();
      current = ENCODINGS.findIndex((enc) => enc.codes.has(char));
    }
    pending.push(char);
  }
  flush();
  return runs;
}

/** Nazwa zasobu fontu: kodowanie `i` -> F(2i+1) zwykły, F(2i+2) pogrubiony. */
function fontName(encoding: number, bold: boolean): string {
  return `F${encoding * 2 + (bold ? 2 : 1)}`;
}

/**
 * Operacja tekstowa `BT ... ET`: napis w punkcie (x, y). Pierwszy odcinek
 * ustawia font przed macierzą (`BT /F1 9 Tf 1 0 0 1 x y Tm (...) Tj`), każdy
 * kolejny przełącza font i rysuje dalej od miejsca, w którym skończył poprzedni.
 */
export function pdfTextOp(x: number, y: number, value: string, size: number, bold = false): string {
  const [first, ...rest] = pdfTextRuns(value);
  let op = `BT /${fontName(first.encoding, bold)} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${first.literal}) Tj`;
  for (const run of rest) {
    op += ` /${fontName(run.encoding, bold)} ${size} Tf (${run.literal}) Tj`;
  }
  return `${op} ET`;
}

/** Słowniki fontów F1..Fn w kolejności nazw - treść obiektów PDF. */
export function pdfFontObjects(): string[] {
  return ENCODINGS.flatMap((enc) => {
    const encoding = `<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [ ${enc.differences} ] >>`;
    return ["Helvetica", "Helvetica-Bold"].map(
      (base) => `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding ${encoding} >>`,
    );
  });
}

/** Słownik zasobu `/Font` dla fontów zapisanych od obiektu `firstObjectId` w kolejności `pdfFontObjects`. */
export function pdfFontResources(firstObjectId: number): string {
  const entries = Array.from(
    { length: PDF_FONT_COUNT },
    (_unused, index) => `/F${index + 1} ${firstObjectId + index} 0 R`,
  );
  return `<< ${entries.join(" ")} >>`;
}
