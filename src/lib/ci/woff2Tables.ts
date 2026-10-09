// Czysty czytnik tabel WOFF2 dla testów fontu (P3.2b) - bez zależności poza
// `node:zlib` (Brotli). Nie trafia do bundla klienta: importują go wyłącznie
// testy w `src/lib/ci/__tests__/` (bramka pokrycia glifów i metryk pliku
// `src/assets/fonts/red-hat-display-latin-pl.woff2`).
//
// ZAKRES. Czytamy tylko tabele, których WOFF2 nie przekształca (`head`, `hhea`,
// `OS/2`, `cmap`, `fvar`, `name`); `glyf`/`loca`/`hmtx` mogą mieć transformację
// i nie są tu potrzebne, więc zwracamy wyłącznie tabele w postaci oryginalnej.
// Format: https://www.w3.org/TR/WOFF2/ (§4 nagłówek, §5 katalog tabel).
import { brotliDecompressSync } from "node:zlib";

/** Znane tagi WOFF2 (§5.1, indeks = 6 niższych bitów bajtu flag). */
const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf",
  "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT",
  "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT",
  "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar",
  "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd",
  "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
] as const; // prettier-ignore

const WOFF2_SIGNATURE = 0x774f4632; // "wOF2"
const TTC_FLAVOR = 0x74746366; // "ttcf"
const HEADER_SIZE = 48;

function tagAt(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** UIntBase128 (§4.1): do 5 bajtów, 7 bitów na bajt, bez zer wiodących. */
function readBase128(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = bytes[offset + i];
    if (byte === undefined) throw new Error("WOFF2: ucięty UIntBase128");
    if (i === 0 && byte === 0x80) throw new Error("WOFF2: UIntBase128 z zerem wiodącym");
    if (value & 0xfe000000) throw new Error("WOFF2: przepełnienie UIntBase128");
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, next: offset + i + 1 };
  }
  throw new Error("WOFF2: UIntBase128 dłuższy niż 5 bajtów");
}

/**
 * Tabele WOFF2 w postaci oryginalnej (bez transformacji), kluczowane tagiem.
 * Rzuca na nie-WOFF2, kolekcji (`ttcf`) i niespójnej długości strumienia.
 */
export function readWoff2Tables(buf: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength < HEADER_SIZE || view.getUint32(0) !== WOFF2_SIGNATURE) {
    throw new Error("WOFF2: brak sygnatury wOF2");
  }
  if (view.getUint32(4) === TTC_FLAVOR) throw new Error("WOFF2: kolekcje nie są obsługiwane");
  const numTables = view.getUint16(12);
  const totalCompressedSize = view.getUint32(20);

  const entries: Array<{ tag: string; length: number; transformed: boolean }> = [];
  let offset = HEADER_SIZE;
  for (let i = 0; i < numTables; i++) {
    const flags = buf[offset++];
    const index = flags & 0x3f;
    const version = flags >> 6;
    let tag: string;
    if (index === 0x3f) {
      tag = tagAt(view, offset);
      offset += 4;
    } else {
      tag = KNOWN_TAGS[index];
    }
    const orig = readBase128(buf, offset);
    offset = orig.next;
    // `glyf`/`loca`: wersja 0 = transformacja; pozostałe: wersja 0 = brak.
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    let length = orig.value;
    if (transformed) {
      const t = readBase128(buf, offset);
      offset = t.next;
      length = t.value;
    }
    entries.push({ tag, length, transformed });
  }

  const stream = brotliDecompressSync(buf.subarray(offset, offset + totalCompressedSize));
  const tables = new Map<string, Uint8Array>();
  let at = 0;
  for (const entry of entries) {
    if (at + entry.length > stream.byteLength) throw new Error("WOFF2: strumień tabel za krótki");
    if (!entry.transformed) tables.set(entry.tag, stream.subarray(at, at + entry.length));
    at += entry.length;
  }
  if (at !== stream.byteLength) throw new Error("WOFF2: niespójna długość strumienia tabel");
  return tables;
}

function viewOf(table: Uint8Array | undefined, tag: string): DataView {
  if (!table) throw new Error(`WOFF2: brak tabeli ${tag}`);
  return new DataView(table.buffer, table.byteOffset, table.byteLength);
}

/** `head.unitsPerEm`. */
export function readHead(tables: Map<string, Uint8Array>): { unitsPerEm: number } {
  return { unitsPerEm: viewOf(tables.get("head"), "head").getUint16(18) };
}

/** `hhea`: metryki pionowe używane przez Chrome przy `USE_TYPO_METRICS` = typo. */
export function readHhea(tables: Map<string, Uint8Array>): {
  ascender: number;
  descender: number;
  lineGap: number;
} {
  const v = viewOf(tables.get("hhea"), "hhea");
  return { ascender: v.getInt16(4), descender: v.getInt16(6), lineGap: v.getInt16(8) };
}

export interface Os2Metrics {
  readonly fsSelection: number;
  readonly typoAscender: number;
  readonly typoDescender: number;
  readonly typoLineGap: number;
  readonly winAscent: number;
  readonly winDescent: number;
  readonly xHeight: number | null;
  readonly capHeight: number | null;
}

/** `OS/2`: metryki typo/win, `fsSelection`, `sxHeight`/`sCapHeight` (wersja >= 2). */
export function readOs2(tables: Map<string, Uint8Array>): Os2Metrics {
  const v = viewOf(tables.get("OS/2"), "OS/2");
  const version = v.getUint16(0);
  return {
    fsSelection: v.getUint16(62),
    typoAscender: v.getInt16(68),
    typoDescender: v.getInt16(70),
    typoLineGap: v.getInt16(72),
    winAscent: v.getUint16(74),
    winDescent: v.getUint16(76),
    xHeight: version >= 2 ? v.getInt16(86) : null,
    capHeight: version >= 2 ? v.getInt16(88) : null,
  };
}

/** Kody znaków zmapowane na glif inny niż `.notdef` (`cmap` format 4 albo 12). */
export function readCmap(tables: Map<string, Uint8Array>): Set<number> {
  const v = viewOf(tables.get("cmap"), "cmap");
  const records: Array<{ platform: number; encoding: number; offset: number }> = [];
  for (let i = 0, n = v.getUint16(2); i < n; i++) {
    const at = 4 + i * 8;
    records.push({
      platform: v.getUint16(at),
      encoding: v.getUint16(at + 2),
      offset: v.getUint32(at + 4),
    });
  }
  const preference: Array<[number, number]> = [
    [3, 10],
    [0, 4],
    [3, 1],
    [0, 3],
  ];
  const record = preference
    .map(([p, e]) => records.find((r) => r.platform === p && r.encoding === e))
    .find((r) => r !== undefined);
  if (!record) throw new Error("WOFF2: cmap bez podtabeli Unicode");

  const base = record.offset;
  const format = v.getUint16(base);
  const codes = new Set<number>();
  if (format === 12) {
    const groups = v.getUint32(base + 12);
    for (let g = 0; g < groups; g++) {
      const at = base + 16 + g * 12;
      const start = v.getUint32(at);
      const end = v.getUint32(at + 4);
      const glyph = v.getUint32(at + 8);
      for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) codes.add(c);
    }
    return codes;
  }
  if (format !== 4) throw new Error(`WOFF2: nieobsługiwany format cmap ${format}`);
  const segX2 = v.getUint16(base + 6);
  const ends = base + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;
  for (let s = 0; s < segX2 / 2; s++) {
    const end = v.getUint16(ends + s * 2);
    const start = v.getUint16(starts + s * 2);
    const delta = v.getUint16(deltas + s * 2);
    const rangeOffset = v.getUint16(rangeOffsets + s * 2);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (c + delta) & 0xffff;
      } else {
        const raw = v.getUint16(rangeOffsets + s * 2 + rangeOffset + (c - start) * 2);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) codes.add(c);
    }
  }
  return codes;
}

export interface FvarAxis {
  readonly tag: string;
  readonly min: number;
  readonly default: number;
  readonly max: number;
}

/** Osie zmiennego fontu (`fvar`); pusta lista dla fontu statycznego. */
export function readFvarAxes(tables: Map<string, Uint8Array>): FvarAxis[] {
  const table = tables.get("fvar");
  if (!table) return [];
  const v = viewOf(table, "fvar");
  const axesOffset = v.getUint16(4);
  const count = v.getUint16(8);
  const size = v.getUint16(10);
  const fixed = (at: number) => v.getInt32(at) / 65536;
  return Array.from({ length: count }, (_, i) => {
    const at = axesOffset + i * size;
    return { tag: tagAt(v, at), min: fixed(at + 4), default: fixed(at + 8), max: fixed(at + 12) };
  });
}

/** `name` id 5 (wersja), np. „Version 1.030”; Windows UTF-16BE albo Mac Roman. */
export function readNameVersion(tables: Map<string, Uint8Array>): string | null {
  const v = viewOf(tables.get("name"), "name");
  const count = v.getUint16(2);
  const strings = v.getUint16(4);
  let mac: string | null = null;
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    if (v.getUint16(at + 6) !== 5) continue;
    const platform = v.getUint16(at);
    const length = v.getUint16(at + 8);
    const start = strings + v.getUint16(at + 10);
    if (platform === 3) {
      let out = "";
      for (let k = 0; k < length; k += 2) out += String.fromCharCode(v.getUint16(start + k));
      return out;
    }
    if (platform === 1 && mac === null) {
      mac = String.fromCharCode(...Array.from({ length }, (_, k) => v.getUint8(start + k)));
    }
  }
  return mac;
}

/** Tagi cech OpenType z `FeatureList` tabeli `GSUB` albo `GPOS` (posortowane, bez powtórzeń). */
export function readLayoutFeatures(
  tables: Map<string, Uint8Array>,
  tag: "GSUB" | "GPOS",
): string[] {
  const table = tables.get(tag);
  if (!table) return [];
  const v = viewOf(table, tag);
  const list = v.getUint16(6);
  const count = v.getUint16(list);
  const tags = new Set<string>();
  for (let i = 0; i < count; i++) tags.add(tagAt(v, list + 2 + i * 6));
  return [...tags].sort();
}
