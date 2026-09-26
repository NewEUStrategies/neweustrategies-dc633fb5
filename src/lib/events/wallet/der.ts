// Minimalny koder i czytnik DER (ASN.1) - tylko to, czego potrzebuje podpis
// przepustki Apple Wallet (CMS SignedData) i odczyt certyfikatu X.509.
//
// DLACZEGO WŁASNY, A NIE BIBLIOTEKA. Środowisko uruchomieniowe to Cloudflare
// Workers, a `node:crypto` nie umie PKCS#7/CMS. Biblioteki, które umieją
// (`pkijs` + `asn1js`, `node-forge`), to setki kilobajtów i nowe zależności
// w grafie serwera. Podpis przepustki potrzebuje kilkunastu typów ASN.1, więc
// mały, czysty i w całości przetestowany koder jest tańszy niż zależność.
//
// ZAKRES ŚWIADOMIE WĄSKI: długości do 2^32-1, znaczniki jednobajtowe (klasy
// uniwersalna i kontekstowa - innych CMS nie używa), OID z łukami mieszczącymi
// się w `number`. Czytnik odrzuca wszystko, czego nie rozumie, zamiast zgadywać.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero sieci. Liść.

/** Znaczniki uniwersalne używane przez CMS i X.509. */
export const DER_TAG = {
  integer: 0x02,
  octetString: 0x04,
  null: 0x05,
  oid: 0x06,
  utf8String: 0x0c,
  utcTime: 0x17,
  generalizedTime: 0x18,
  sequence: 0x30,
  set: 0x31,
} as const;

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Długość w formie krótkiej (< 128) albo długiej (0x81..0x84 + bajty). */
export function derLength(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0 || length > 0xffffffff) {
    throw new RangeError(`der: unsupported length ${length}`);
  }
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  let rest = length;
  while (rest > 0) {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

/** Pełny TLV: znacznik + długość + treść. */
export function derTlv(tag: number, content: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(tag), derLength(content.length), content);
}

export function derSequence(...children: readonly Uint8Array[]): Uint8Array {
  return derTlv(DER_TAG.sequence, concatBytes(...children));
}

/**
 * Porządek DER dla `SET OF`: elementy rosnąco wg ich kodowania, porównanie
 * leksykograficzne bajt po bajcie, krótszy prefiks pierwszy (X.690 §11.6).
 */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const common = Math.min(a.length, b.length);
  for (let i = 0; i < common; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/** Treść `SET OF` w kanonicznym porządku DER (bez znacznika). */
export function derSortedSetContent(children: readonly Uint8Array[]): Uint8Array {
  return concatBytes(...[...children].sort(compareBytes));
}

/** `SET OF` w kanonicznym porządku DER. */
export function derSet(children: readonly Uint8Array[]): Uint8Array {
  return derTlv(DER_TAG.set, derSortedSetContent(children));
}

/** Nieujemna liczba całkowita (wersje struktur CMS). */
export function derSmallInteger(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) {
    throw new RangeError(`der: unsupported integer ${value}`);
  }
  const bytes: number[] = [];
  let rest = value;
  do {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  } while (rest > 0);
  // Najstarszy bit ustawiony = liczba ujemna w U2, więc dokładamy zero.
  if (bytes[0] >= 0x80) bytes.unshift(0);
  return derTlv(DER_TAG.integer, Uint8Array.from(bytes));
}

export function derNull(): Uint8Array {
  return Uint8Array.of(DER_TAG.null, 0);
}

export function derOctetString(content: Uint8Array): Uint8Array {
  return derTlv(DER_TAG.octetString, content);
}

function base128(value: number): number[] {
  const out = [value & 0x7f];
  let rest = Math.floor(value / 128);
  while (rest > 0) {
    out.unshift(0x80 | (rest & 0x7f));
    rest = Math.floor(rest / 128);
  }
  return out;
}

/** OBJECT IDENTIFIER z zapisu kropkowego, np. `1.2.840.113549.1.7.2`. */
export function derOid(dotted: string): Uint8Array {
  const arcs = dotted.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (arcs.length < 2 || arcs.some((arc) => !Number.isSafeInteger(arc))) {
    throw new RangeError(`der: invalid oid ${dotted}`);
  }
  const [first, second, ...rest] = arcs;
  if (first > 2 || (first < 2 && second > 39)) throw new RangeError(`der: invalid oid ${dotted}`);
  const bytes = [...base128(first * 40 + second), ...rest.flatMap(base128)];
  return derTlv(DER_TAG.oid, Uint8Array.from(bytes));
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Czas w formie wymaganej przez RFC 5280/5652: `UTCTime` dla lat 1950-2049,
 * `GeneralizedTime` poza tym przedziałem. Zawsze UTC, bez ułamków sekund.
 */
export function derTime(date: Date): Uint8Array {
  const year = date.getUTCFullYear();
  const rest =
    twoDigits(date.getUTCMonth() + 1) +
    twoDigits(date.getUTCDate()) +
    twoDigits(date.getUTCHours()) +
    twoDigits(date.getUTCMinutes()) +
    twoDigits(date.getUTCSeconds()) +
    "Z";
  const encoder = new TextEncoder();
  if (year >= 1950 && year <= 2049) {
    return derTlv(DER_TAG.utcTime, encoder.encode(twoDigits(year % 100) + rest));
  }
  return derTlv(DER_TAG.generalizedTime, encoder.encode(String(year).padStart(4, "0") + rest));
}

/**
 * Konstruowany znacznik kontekstowy `[n]`. Dla `[n] EXPLICIT` treścią jest
 * pełny TLV typu opakowanego, dla `[n] IMPLICIT SET OF` - sama treść zbioru
 * (znacznik SET zastąpiony znacznikiem kontekstowym).
 */
export function derContext(tagNumber: number, content: Uint8Array): Uint8Array {
  return derTlv(0xa0 | tagNumber, content);
}

// ── Czytnik ────────────────────────────────────────────────────────────────

/** Jeden element DER: położenie w buforze źródłowym. */
export interface DerNode {
  readonly tag: number;
  /** Indeks pierwszego bajtu znacznika. */
  readonly start: number;
  /** Indeks pierwszego bajtu treści. */
  readonly contentStart: number;
  /** Indeks za ostatnim bajtem treści. */
  readonly end: number;
}

/** Czyta element DER zaczynający się pod `offset`; rzuca na każdą nieprawidłowość. */
export function readDer(bytes: Uint8Array, offset = 0): DerNode {
  if (offset + 2 > bytes.length) throw new RangeError("der: truncated header");
  const tag = bytes[offset];
  if ((tag & 0x1f) === 0x1f) throw new RangeError("der: multi-byte tags are not supported");
  const first = bytes[offset + 1];
  let length: number;
  let contentStart: number;
  if (first < 0x80) {
    length = first;
    contentStart = offset + 2;
  } else {
    const count = first & 0x7f;
    if (count === 0 || count > 4) throw new RangeError("der: unsupported length form");
    if (offset + 2 + count > bytes.length) throw new RangeError("der: truncated length");
    length = 0;
    for (let i = 0; i < count; i += 1) length = length * 256 + bytes[offset + 2 + i];
    contentStart = offset + 2 + count;
  }
  const end = contentStart + length;
  if (end > bytes.length) throw new RangeError("der: truncated content");
  return { tag, start: offset, contentStart, end };
}

/** Bezpośrednie dzieci elementu konstruowanego. */
export function derChildren(bytes: Uint8Array, node: DerNode): DerNode[] {
  const out: DerNode[] = [];
  let offset = node.contentStart;
  while (offset < node.end) {
    const child = readDer(bytes, offset);
    if (child.end > node.end) throw new RangeError("der: child overflows parent");
    out.push(child);
    offset = child.end;
  }
  return out;
}

/** Pełne bajty elementu (znacznik + długość + treść). */
export function derSlice(bytes: Uint8Array, node: DerNode): Uint8Array {
  return bytes.slice(node.start, node.end);
}
