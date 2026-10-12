// Dekoder tekstu z PDF-ów generatorów (`invoicePdf`, `eventInvoicePdf`) -
// NIEZALEŻNA wyrocznia dla testów kodowania glifów (`pdfText.ts`).
//
// PO CO. Asercja „w literale nie ma `?`" dowodzi tylko, że nic nie zastąpiono;
// nie dowodzi, że czytnik narysuje TĘ literę. Ten dekoder czyta plik tak jak
// czytnik: font z operatora `Tf`, kodowanie z jego słownika (/Differences na
// bazie WinAnsi), bajty literału -> nazwa glifu -> znak. Nie importuje niczego
// z modułu pod testem: bazę WinAnsi (tabela cp1252 Microsoftu) i nazwy glifów
// (Adobe Glyph List) przepisano niżej ze źródeł, nie z `pdfText.ts`.
// `TextDecoder("windows-1252")` się nie nadaje: Node dekoduje tę etykietę jak
// ISO-8859-1, więc 0x8A dałoby U+008A zamiast Š.

/**
 * Adobe Glyph List (glyphlist.txt) dla glifów standardowej Helvetiki spoza
 * WinAnsi. Wpis `Tcommaaccent` ma w AGL wartość U+0162 (Ţ) - stąd `aglForm`.
 */
const AGL: Readonly<Record<string, string>> = {
  Aogonek: "Ą",
  aogonek: "ą",
  Cacute: "Ć",
  cacute: "ć",
  Eogonek: "Ę",
  eogonek: "ę",
  Lslash: "Ł",
  lslash: "ł",
  Nacute: "Ń",
  nacute: "ń",
  Sacute: "Ś",
  sacute: "ś",
  Zacute: "Ź",
  zacute: "ź",
  Zdotaccent: "Ż",
  zdotaccent: "ż",
  Ccaron: "Č",
  ccaron: "č",
  Dcaron: "Ď",
  dcaron: "ď",
  Ecaron: "Ě",
  ecaron: "ě",
  Ncaron: "Ň",
  ncaron: "ň",
  Rcaron: "Ř",
  rcaron: "ř",
  Tcaron: "Ť",
  tcaron: "ť",
  Uring: "Ů",
  uring: "ů",
  Lacute: "Ĺ",
  lacute: "ĺ",
  Lcaron: "Ľ",
  lcaron: "ľ",
  Racute: "Ŕ",
  racute: "ŕ",
  Ohungarumlaut: "Ő",
  ohungarumlaut: "ő",
  Uhungarumlaut: "Ű",
  uhungarumlaut: "ű",
  Edotaccent: "Ė",
  edotaccent: "ė",
  Iogonek: "Į",
  iogonek: "į",
  Uogonek: "Ų",
  uogonek: "ų",
  Umacron: "Ū",
  umacron: "ū",
  Amacron: "Ā",
  amacron: "ā",
  Emacron: "Ē",
  emacron: "ē",
  Imacron: "Ī",
  imacron: "ī",
  Gcommaaccent: "Ģ",
  gcommaaccent: "ģ",
  Kcommaaccent: "Ķ",
  kcommaaccent: "ķ",
  Lcommaaccent: "Ļ",
  lcommaaccent: "ļ",
  Ncommaaccent: "Ņ",
  ncommaaccent: "ņ",
  Omacron: "Ō",
  omacron: "ō",
  Rcommaaccent: "Ŗ",
  rcommaaccent: "ŗ",
  Abreve: "Ă",
  abreve: "ă",
  Scommaaccent: "Ș",
  scommaaccent: "ș",
  Tcommaaccent: "Ţ",
  tcommaaccent: "ţ",
  Scedilla: "Ş",
  scedilla: "ş",
  Gbreve: "Ğ",
  gbreve: "ğ",
  Idotaccent: "İ",
  dotlessi: "ı",
  Dcroat: "Đ",
  dcroat: "đ",
  minus: "\u2212",
  lessequal: "\u2264",
  greaterequal: "\u2265",
  notequal: "\u2260",
  Delta: "\u2206",
  partialdiff: "\u2202",
  summation: "\u2211",
  radical: "\u221a",
  lozenge: "\u25ca",
  fraction: "\u2044",
  fi: "\ufb01",
  fl: "\ufb02",
  breve: "\u02d8",
  dotaccent: "\u02d9",
  ring: "\u02da",
  hungarumlaut: "\u02dd",
  ogonek: "\u02db",
  caron: "\u02c7",
};

/**
 * Postać napisu po przejściu przez AGL: rumuńskie Ț/ț (przecinek) i Ţ/ţ
 * (cedylla) to w AGL ten sam glif, więc tekst wyciągnięty z PDF ma cedyllę.
 */
export function aglForm(value: string): string {
  return value.replace(/Ț/g, "Ţ").replace(/ț/g, "ţ");
}

/** cp1252 / WinAnsiEncoding 0x80-0x9F (pozostałe kody: ASCII i Latin-1 = kod Unicode). */
const WIN_ANSI_HIGH: Readonly<Record<number, string>> = {
  0x80: "\u20ac",
  0x82: "\u201a",
  0x83: "\u0192",
  0x84: "\u201e",
  0x85: "\u2026",
  0x86: "\u2020",
  0x87: "\u2021",
  0x88: "\u02c6",
  0x89: "\u2030",
  0x8a: "\u0160",
  0x8b: "\u2039",
  0x8c: "\u0152",
  0x8e: "\u017d",
  0x91: "\u2018",
  0x92: "\u2019",
  0x93: "\u201c",
  0x94: "\u201d",
  0x95: "\u2022",
  0x96: "\u2013",
  0x97: "\u2014",
  0x98: "\u02dc",
  0x99: "\u2122",
  0x9a: "\u0161",
  0x9b: "\u203a",
  0x9c: "\u0153",
  0x9e: "\u017e",
  0x9f: "\u0178",
};

function winAnsi(byte: number): string {
  if ((byte >= 0x20 && byte <= 0x7e) || byte >= 0xa0) return String.fromCharCode(byte);
  const char = WIN_ANSI_HIGH[byte];
  if (char === undefined) throw new Error(`test: kod 0x${byte.toString(16)} bez glifu w WinAnsi`);
  return char;
}

/** Bajty literału PDF `(...)` (bez nawiasów) po rozwinięciu ucieczek. */
function literalBytes(literal: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < literal.length; i += 1) {
    const char = literal[i];
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0));
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(literal.slice(i + 1))?.[0];
    if (octal) {
      bytes.push(Number.parseInt(octal, 8));
      i += octal.length;
    } else {
      bytes.push(literal.charCodeAt(i + 1));
      i += 1;
    }
  }
  return bytes;
}

/** Kod -> nazwa glifu z tablicy /Differences (`1 /a /b 127 /c`). */
function differencesMap(entries: string): Map<number, string> {
  const map = new Map<number, string>();
  let code = -1;
  for (const token of entries.trim().split(/\s+/)) {
    if (token.startsWith("/")) {
      map.set(code, token.slice(1));
      code += 1;
    } else code = Number(token);
  }
  return map;
}

/** Nazwa zasobu fontu (`F1`) -> mapa /Differences jego kodowania. */
function fontEncodings(pdf: string): Map<string, Map<number, string>> {
  const byObject = new Map<string, Map<number, string>>();
  for (const match of pdf.matchAll(
    /(\d+) 0 obj\n<< \/Type \/Font \/Subtype \/Type1 \/BaseFont \/Helvetica(?:-Bold)? \/Encoding << \/Type \/Encoding \/BaseEncoding \/WinAnsiEncoding \/Differences \[ ([^\]]*) \] >> >>/g,
  )) {
    byObject.set(match[1], differencesMap(match[2]));
  }
  const resources = /\/Font << ((?:\/F\d+ \d+ 0 R ?)+)>>/.exec(pdf)?.[1] ?? "";
  const byName = new Map<string, Map<number, string>>();
  for (const [, name, object] of resources.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
    const encoding = byObject.get(object);
    if (!encoding) throw new Error(`test: font ${name} (obiekt ${object}) bez kodowania`);
    byName.set(name, encoding);
  }
  return byName;
}

function decodeByte(byte: number, differences: Map<number, string>): string {
  const glyph = differences.get(byte);
  if (glyph === undefined) return winAnsi(byte);
  const char = AGL[glyph];
  if (char === undefined) throw new Error(`test: glif /${glyph} spoza wycinka AGL`);
  return char;
}

/** Każda operacja tekstowa `BT ... ET` pliku jako napis, który narysuje czytnik. */
export function decodePdfTexts(pdf: string): string[] {
  const fonts = fontEncodings(pdf);
  const out: string[] = [];
  for (const op of pdf.split("\n").filter((line) => line.startsWith("BT "))) {
    let current: Map<number, string> | undefined;
    let text = "";
    for (const token of op.matchAll(/\/(F\d+) [\d.]+ Tf|\(((?:\\[\s\S]|[^\\)])*)\) Tj/g)) {
      if (token[1] !== undefined) {
        current = fonts.get(token[1]);
        if (!current) throw new Error(`test: nieznany font ${token[1]}`);
        continue;
      }
      if (!current) throw new Error("test: tekst przed wyborem fontu");
      const differences = current;
      text += literalBytes(token[2])
        .map((byte) => decodeByte(byte, differences))
        .join("");
    }
    out.push(text);
  }
  return out;
}

/** Surowe literały `(...)` operacji tekstowych - do szukania zastępczego `?`. */
export function pdfTextLiterals(pdf: string): string[] {
  return pdf
    .split("\n")
    .filter((line) => line.startsWith("BT "))
    .flatMap((op) => [...op.matchAll(/\(((?:\\[\s\S]|[^\\)])*)\) Tj/g)].map((match) => match[1]));
}
