// Odczyt archiwów .docx/.pptx w przeglądarce: zastępca `jszip` w podglądzie
// dokumentów (`officeParse.ts#parsePptx` importuje go wprost, a mammoth dostaje
// go zamiast `require("jszip")` w `lib/zipfile.js` - przekierowanie robi
// `scripts/lib/officeParserTrim.ts`, tam jest pełne uzasadnienie i bramka).
//
// DLACZEGO. Do przeglądarki jechał cały `jszip/dist/jszip.min.js` (UMD, ~28 KB
// gzip): zapis archiwów, strumienie, własna kopia pako z kompresją DEFLATE,
// odczyt z Bloba/napisu/strumienia Node. Podgląd potrzebuje czterech rzeczy:
// `loadAsync(ArrayBuffer)`, mapy `files`, `file(nazwa)` i `async("string" |
// "uint8array" | "blob")` (mammoth: `lib/zipfile.js`, podgląd: `parsePptx`).
// Rozpakowanie DEFLATE robi `inflateSync` z `fflate` (sama dekompresja,
// ~3 KB gzip, bez zależności). Natywny `DecompressionStream("deflate-raw")`
// odpada: nie ma go w Safari < 16.4 ani we Firefoksie < 113, a te są w celu
// buildu (`scripts/lib/browserBaseline.ts`).
//
// TA SAMA SEMANTYKA CO `JSZip.loadAsync` 3.10 z domyślnymi opcjami - każda
// decyzja poniżej to port `zipEntries.js`/`zipEntry.js`/`load.js`/`object.js`
// (`src/lib/files/__tests__/officeZip.test.ts` porównuje z prawdziwym jszip
// obraz archiwów z generatorów, archiwów brzegowych złożonych bajt po bajcie
// i archiwów obciętych w każdym miejscu):
// - koniec katalogu centralnego (EOCD) szukany od końca CAŁYCH danych;
//   ZIP64 (lokalizator, rekord, pola dodatkowe 0x0001), wielotomowe - błąd;
// - bajty doklejone PRZED archiwum przesuwają „zero" czytnika o różnicę
//   między położeniem EOCD a końcem katalogu; brakujące bajty - błąd;
// - rozmiary, metoda, flagi i atrybuty z katalogu centralnego, NAZWA z nagłówka
//   lokalnego (jszip celowo: część generatorów pisze w katalogu `\`);
//   szyfrowanie i metoda inna niż STORE/DEFLATE - błąd już przy wczytaniu;
// - nazwa: UTF-8 (z flagą 11 albo bez), pole Info-ZIP 0x7075 tylko z wersją 1
//   i zgodnym CRC-32 nazwy; potem `utils.resolve` (bez `.`, `..`, pustych
//   członów) i `/` na końcu katalogu (atrybut DOS 0x10, uniksowy S_IFDIR albo
//   `/` na końcu nazwy); duplikat nadpisuje wcześniejszy wpis w `files`;
// - `file(nazwa)` - dokładnie ten klucz, `null` dla katalogu i braku;
// - wpis o rozmiarze 0 (i katalog) jest pusty bez rozpakowywania; inaczej
//   długość po rozpakowaniu musi równać się rozmiarowi z katalogu; CRC-32
//   treści NIE jest sprawdzane (domyślne `checkCRC32: false`);
// - "string" dekoduje UTF-8 bez zdejmowania BOM, "blob" ma pusty typ MIME.
// Różnice: inny tekst komunikatów błędów (interfejs ich nie pokazuje),
// a niepoprawne sekwencje UTF-8 zastępuje dekoder WHATWG, nie ręczna pętla
// jszip (OOXML wymaga poprawnego UTF-8; nazwy części są ASCII). Dwa archiwa,
// które jszip odrzuca, a czytnik czyta (jednorazowy fuzzing przy wdrożeniu -
// ~9500 uszkodzonych wariantów - nie znalazł innych; test przypina oba):
// blok DEFLATE „stored" z zepsutym polem NLEN (pako sprawdza dopełnienie
// długości, `fflate` czyta po LEN) i katalog oznaczony samym uniksowym
// S_IFDIR bez `/` w nazwie (jszip dokleja `/`, po czym szuka wpisu pod starą
// nazwą i pada na `null`).
//
// ZAPIS NIE ISTNIEJE: `file(nazwa, dane)` rzuca - jedyną ścieżką zapisu
// w mammoth jest `embedStyleMap`, wycięte z bundla przeglądarki razem
// z zapisem XML (`mammothXmlWriter.ts`).
//
// i18n: brak treści dla użytkownika - komunikaty dla programisty.
import { inflateSync } from "fflate";

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_END = 0x06064b50;
const MAX16 = 0xffff;
const MAX32 = 0xffffffff;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });

/** Czytnik jak `DataReader` jszip: indeks względny wobec `zero`, kontrola zakresu. */
class Reader {
  index = 0;
  zero = 0;
  constructor(private readonly data: Uint8Array) {}

  setIndex(index: number): void {
    if (this.data.length < this.zero + index || index < 0) {
      throw new Error(
        `officeZip: koniec danych (długość ${this.data.length}, indeks ${index}) - uszkodzony zip?`,
      );
    }
    this.index = index;
  }

  skip(count: number): void {
    this.setIndex(this.index + count);
  }

  bytes(count: number): Uint8Array {
    const start = this.zero + this.index;
    this.skip(count);
    return this.data.subarray(start, start + count);
  }

  /** Liczba little-endian bez znaku (8 bajtów: dokładna do 2^53). */
  int(count: number): number {
    const bytes = this.bytes(count);
    let value = 0;
    for (let i = count - 1; i >= 0; i--) value = value * 256 + bytes[i];
    return value;
  }

  /** Ostatnie wystąpienie sygnatury w CAŁYCH danych albo -1. */
  lastIndexOf(signature: number): number {
    const data = this.data;
    for (let i = data.length - 4; i >= 0; i--) {
      if (
        (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)) >>> 0 ===
        signature
      ) {
        return i - this.zero;
      }
    }
    return -1;
  }

  isSignatureAt(index: number, signature: number): boolean {
    const saved = this.index;
    this.setIndex(index);
    const found = this.int(4) === signature;
    this.setIndex(saved);
    return found;
  }

  expect(signature: number): void {
    if (this.int(4) !== signature)
      throw new Error("officeZip: nieoczekiwana sygnatura - uszkodzony zip?");
  }
}

/** CRC-32 (IEEE) - tylko do sprawdzenia pól Info-ZIP z nazwą i komentarzem. */
function crc32(bytes: Uint8Array): number {
  let crc = MAX32;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ MAX32) >>> 0;
}

/** Pole Info-ZIP 0x7075 (ścieżka) / 0x6375 (komentarz): wersja 1 i zgodne CRC oryginału. */
function unicodeField(field: Uint8Array | undefined, original: Uint8Array): string | null {
  if (field === undefined) return null;
  const reader = new Reader(field);
  if (reader.int(1) !== 1 || crc32(original) !== reader.int(4)) return null;
  return utf8.decode(reader.bytes(field.length - 5));
}

/** `utils.resolve` jszip: bez `.`, `..` i pustych członów (poza pierwszym i ostatnim). */
function resolvePath(path: string): string {
  const parts = path.split("/");
  const result: string[] = [];
  parts.forEach((part, index) => {
    if (part === "." || (part === "" && index !== 0 && index !== parts.length - 1)) return;
    if (part === "..") result.pop();
    else result.push(part);
  });
  return result.join("/");
}

export type ZipOutput = { string: string; uint8array: Uint8Array; blob: Blob };

export class ZipObject {
  constructor(
    readonly name: string,
    readonly dir: boolean,
    private readonly raw: Uint8Array | null,
    private readonly method: number,
    private readonly size: number,
  ) {}

  /** Treść wpisu: bajty po rozpakowaniu (świeży bufor), sprawdzone z rozmiarem z katalogu. */
  private content(): Uint8Array<ArrayBuffer> {
    if (this.raw === null) return new Uint8Array(0);
    const bytes = this.method === METHOD_STORE ? this.raw.slice() : inflateSync(this.raw);
    if (bytes.length !== this.size) {
      throw new Error(`officeZip: rozmiar po rozpakowaniu się nie zgadza (${this.name})`);
    }
    return bytes;
  }

  async<T extends keyof ZipOutput>(type: T): Promise<ZipOutput[T]> {
    return new Promise<ZipOutput[T]>((resolve) => {
      const bytes = this.content();
      if (type === "uint8array") resolve(bytes as ZipOutput[T]);
      else if (type === "string") resolve(utf8.decode(bytes) as ZipOutput[T]);
      else if (type === "blob") resolve(new Blob([bytes]) as ZipOutput[T]);
      else throw new Error(`officeZip: nieobsługiwany typ wyniku "${String(type)}"`);
    });
  }
}

export interface ZipArchive {
  /** Wpisy po znormalizowanej nazwie, w kolejności katalogu (jak `JSZip#files`). */
  readonly files: Readonly<Record<string, ZipObject>>;
  /** Plik (nie katalog) o dokładnie tej nazwie albo `null`. */
  file(name: string): ZipObject | null;
}

interface CentralEntry {
  readonly madeBy: number;
  readonly flags: number;
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly external: number;
  readonly offset: number;
  readonly extra: Map<number, Uint8Array>;
  readonly comment: Uint8Array;
}

function readArchive(data: Uint8Array): Record<string, ZipObject> {
  const reader = new Reader(data);

  // Koniec katalogu centralnego (`readEndOfCentral`).
  const end = reader.lastIndexOf(SIG_END);
  if (end < 0) {
    throw new Error("officeZip: brak końca katalogu centralnego - to nie jest plik zip?");
  }
  reader.setIndex(end);
  reader.expect(SIG_END);
  let disk = reader.int(2);
  let diskWithDirectory = reader.int(2);
  let recordsOnDisk = reader.int(2);
  let records = reader.int(2);
  let directorySize = reader.int(4);
  let directoryOffset = reader.int(4);
  reader.bytes(reader.int(2)); // komentarz archiwum
  let expectedEnd = directoryOffset + directorySize;
  if (
    disk === MAX16 ||
    diskWithDirectory === MAX16 ||
    recordsOnDisk === MAX16 ||
    records === MAX16 ||
    directorySize === MAX32 ||
    directoryOffset === MAX32
  ) {
    const locator = reader.lastIndexOf(SIG_ZIP64_LOCATOR);
    if (locator < 0) throw new Error("officeZip: brak lokalizatora ZIP64");
    reader.setIndex(locator);
    reader.expect(SIG_ZIP64_LOCATOR);
    reader.skip(4);
    let zip64End = reader.int(8);
    if (reader.int(4) > 1) throw new Error("officeZip: archiwa wielotomowe nie są obsługiwane");
    if (!reader.isSignatureAt(zip64End, SIG_ZIP64_END)) {
      zip64End = reader.lastIndexOf(SIG_ZIP64_END);
      if (zip64End < 0) throw new Error("officeZip: brak rekordu końca katalogu ZIP64");
    }
    reader.setIndex(zip64End);
    reader.expect(SIG_ZIP64_END);
    const recordSize = reader.int(8);
    reader.skip(4);
    disk = reader.int(4);
    diskWithDirectory = reader.int(4);
    recordsOnDisk = reader.int(8);
    records = reader.int(8);
    directorySize = reader.int(8);
    directoryOffset = reader.int(8);
    // jszip czyta tu „rozszerzalne dane" pętlą, która nie przesuwa licznika -
    // każdy rekord dłuższy niż 44 bajty kończy się błędem końca danych.
    if (recordSize > 44) throw new Error("officeZip: nieobsługiwany rekord końca katalogu ZIP64");
    expectedEnd = directoryOffset + directorySize + 20 + 12 + recordSize;
  }
  const extraBytes = end - expectedEnd;
  if (extraBytes > 0) reader.zero = extraBytes;
  else if (extraBytes < 0) throw new Error(`officeZip: brakuje ${-extraBytes} bajtów`);

  // Katalog centralny (`readCentralDir` + `readCentralPart`).
  const entries: CentralEntry[] = [];
  reader.setIndex(directoryOffset);
  while (reader.int(4) === SIG_CENTRAL) {
    const madeBy = reader.int(2);
    reader.skip(2);
    const flags = reader.int(2);
    const method = reader.int(2);
    reader.skip(8); // data, czas, CRC-32
    let compressedSize = reader.int(4);
    let size = reader.int(4);
    const nameLength = reader.int(2);
    const extraLength = reader.int(2);
    const commentLength = reader.int(2);
    reader.skip(4); // numer dysku, atrybuty wewnętrzne
    const external = reader.int(4);
    let offset = reader.int(4);
    if (flags & 1) throw new Error("officeZip: zaszyfrowane archiwa nie są obsługiwane");
    reader.skip(nameLength);
    const extra = new Map<number, Uint8Array>();
    const extraEnd = reader.index + extraLength;
    while (reader.index + 4 < extraEnd) {
      const id = reader.int(2);
      extra.set(id, reader.bytes(reader.int(2)));
    }
    reader.setIndex(extraEnd);
    const zip64 = extra.get(1);
    if (zip64 !== undefined) {
      const fields = new Reader(zip64);
      if (size === MAX32) size = fields.int(8);
      if (compressedSize === MAX32) compressedSize = fields.int(8);
      if (offset === MAX32) offset = fields.int(8);
    }
    const comment = reader.bytes(commentLength);
    entries.push({ madeBy, flags, method, compressedSize, size, external, offset, extra, comment });
  }
  if (records !== entries.length && records !== 0 && entries.length === 0) {
    throw new Error(`officeZip: katalog zapowiada ${records} wpisów, a nie ma żadnego`);
  }

  // Nagłówki lokalne i dodanie plików (`readLocalFiles` + `load.js#addFiles`).
  const files: Record<string, ZipObject> = Object.create(null);
  for (const entry of entries) {
    reader.setIndex(entry.offset);
    reader.expect(SIG_LOCAL);
    reader.skip(22);
    const nameLength = reader.int(2);
    const extraLength = reader.int(2);
    const rawName = reader.bytes(nameLength);
    reader.skip(extraLength);
    if (entry.compressedSize === MAX32 || entry.size === MAX32) {
      throw new Error("officeZip: brak rozmiarów wpisu w katalogu centralnym");
    }
    if (entry.method !== METHOD_STORE && entry.method !== METHOD_DEFLATE) {
      throw new Error(`officeZip: nieobsługiwana metoda kompresji ${entry.method}`);
    }
    const raw = reader.bytes(entry.compressedSize);
    let name: string;
    if (entry.flags & 0x0800) {
      name = utf8.decode(rawName);
    } else {
      name = unicodeField(entry.extra.get(0x7075), rawName) ?? utf8.decode(rawName);
      unicodeField(entry.extra.get(0x6375), entry.comment); // jak jszip: uszkodzone pole = błąd
    }
    const host = entry.madeBy >> 8;
    const unixDirectory = host === 3 && ((entry.external >> 16) & 0x4000) !== 0;
    const dir = (entry.external & 0x10) !== 0 || unixDirectory || name.endsWith("/");
    name = resolvePath(name);
    if (dir && !name.endsWith("/")) name += "/";
    const empty = dir || entry.size === 0;
    files[name] = new ZipObject(name, dir, empty ? null : raw, entry.method, entry.size);
  }
  return files;
}

/** `JSZip.loadAsync` dla `ArrayBuffer`/`Uint8Array` - błąd formatu odrzuca obietnicę. */
export function loadAsync(data: ArrayBuffer | Uint8Array): Promise<ZipArchive> {
  return new Promise<ZipArchive>((resolve) => {
    if (!(data instanceof ArrayBuffer || data instanceof Uint8Array)) {
      throw new Error("officeZip: oczekiwano ArrayBuffer albo Uint8Array");
    }
    const files = readArchive(data instanceof Uint8Array ? data : new Uint8Array(data));
    resolve({
      files,
      file(name: string, ...write: unknown[]): ZipObject | null {
        if (write.length > 0) {
          throw new Error("officeZip: zapis archiwum jest wycięty z bundla przeglądarki");
        }
        const found = files[name];
        return found !== undefined && !found.dir ? found : null;
      },
    });
  });
}
