// Archiwum ZIP bez kompresji (metoda STORE) - paczka `.pkpass`.
//
// DLACZEGO WŁASNY ZAPIS, A NIE `jszip`. Przepustka to kilka plików po kilka
// kilobajtów; Wallet przyjmuje wpisy nieskompresowane. Zapis STORE to trzy
// nagłówki i CRC-32 - kilkadziesiąt linii bez zależności, deterministyczny
// bajt w bajt (stała data modyfikacji), więc test porównuje całe archiwum,
// a nie „cokolwiek, co da się rozpakować".
//
// Nazwy w UTF-8 (bit 11 flag). Brak ZIP64: paczka przepustki jest o rzędy
// wielkości mniejsza od limitów formatu, a za duże wejście jest błędem
// wołającego, nie przypadkiem do obsłużenia.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero sieci. Liść.
import { concatBytes } from "./der";

export interface ZipEntry {
  /** Ścieżka w archiwum, np. `pl.lproj/pass.strings`. */
  readonly name: string;
  readonly data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3, jak w ZIP i PNG). */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

class ByteWriter {
  private readonly bytes: number[] = [];
  u16(value: number): this {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff);
    return this;
  }
  u32(value: number): this {
    this.bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
    return this;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

const VERSION = 20;
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
/** 1980-01-01 00:00:00 w zapisie DOS - stała, żeby archiwum było deterministyczne. */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

/** Archiwum ZIP (STORE) z wpisów w podanej kolejności. */
export function zipStore(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (entry.name === "" || seen.has(entry.name)) {
      throw new Error(`zip: empty or duplicate entry name "${entry.name}"`);
    }
    seen.add(entry.name);
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new ByteWriter()
      .u32(0x04034b50)
      .u16(VERSION)
      .u16(FLAG_UTF8)
      .u16(METHOD_STORE)
      .u16(DOS_TIME)
      .u16(DOS_DATE)
      .u32(crc)
      .u32(size)
      .u32(size)
      .u16(name.length)
      .u16(0)
      .done();
    locals.push(local, name, entry.data);

    const central = new ByteWriter()
      .u32(0x02014b50)
      .u16(VERSION)
      .u16(VERSION)
      .u16(FLAG_UTF8)
      .u16(METHOD_STORE)
      .u16(DOS_TIME)
      .u16(DOS_DATE)
      .u32(crc)
      .u32(size)
      .u32(size)
      .u16(name.length)
      .u16(0)
      .u16(0)
      .u16(0)
      .u16(0)
      .u32(0)
      .u32(offset)
      .done();
    centrals.push(central, name);

    offset += local.length + name.length + size;
  }

  const directory = concatBytes(...centrals);
  const end = new ByteWriter()
    .u32(0x06054b50)
    .u16(0)
    .u16(0)
    .u16(entries.length)
    .u16(entries.length)
    .u32(directory.length)
    .u32(offset)
    .u16(0)
    .done();

  return concatBytes(...locals, directory, end);
}
