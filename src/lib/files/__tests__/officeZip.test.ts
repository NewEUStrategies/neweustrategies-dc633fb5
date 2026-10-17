// @vitest-environment node
//
// Czytnik archiwów podglądu dokumentów (`vendor/officeZip.ts`) kontra jszip.
//
// PO CO. W bundlu przeglądarki czytnik zastępuje jszip w DWÓCH miejscach:
// pod `require("jszip")` mammoth (podgląd .docx, przekierowanie
// `scripts/lib/officeParserTrim.ts`) i w `officeParse.ts#parsePptx`. Obie
// ścieżki widzą tylko `loadAsync`, `files`, `file(nazwa)` i `async("string" |
// "uint8array" | "blob")`, więc dowód to: dla każdego archiwum - poprawnego,
// brzegowego i uszkodzonego - te cztery rzeczy dają to samo co prawdziwy
// jszip. Porównanie idzie po CAŁYM obrazie archiwum (lista nazw w kolejności,
// flaga katalogu, wynik `file()`, bajty, tekst, Blob), a błąd to błąd -
// treści komunikatów się różnią i nikt ich nie pokazuje.
//
// Archiwa brzegowe składa `rawZip` niżej bajt po bajcie (ZIP64, prefiks
// samorozpakowującego się archiwum, pola Info-ZIP, atrybuty katalogów,
// duplikaty, uszkodzone rekordy) - generatory archiwów takich plików nie
// piszą, a przeglądarka czytelnika może je dostać.
//
// ZNANE RÓŻNICE - dwie, obie na archiwach, które jszip odrzuca, a czytnik
// czyta (jednorazowy fuzzing przy wdrożeniu, poza CI: 1734 warianty plików
// mammoth z losowymi bajtami, obcięciami i prefiksami plus 7720 uszkodzeń
// samych danych DEFLATE - innych rozbieżności nie było). Testy w bloku
// „API i świadome różnice" przypinają oba zachowania:
// 1. Blok DEFLATE „stored" z zepsutym polem NLEN (dopełnienie długości). pako
//    w jszip odrzuca taki blok, `fflate` czyta go po LEN i oddaje treść.
// 2. Katalog oznaczony wyłącznie uniksowym S_IFDIR (bez `/` na końcu nazwy
//    i bez atrybutu DOS). jszip sam uznaje go za katalog, dokleja `/`, a potem
//    szuka wpisu pod starą nazwą i pada na `null` (TypeError w `load.js`).
//    Czytnik oddaje zwykły wpis katalogu.
//
// i18n: brak treści dla użytkownika - test.
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { deflateSync, zipSync } from "fflate";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadAsync } from "../vendor/officeZip";

const require = createRequire(import.meta.url);

/** jsdom bez typów (`@types/jsdom` nie jest zależnością) - test bierze z okna tylko `DOMParser`. */
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string) => { window: { DOMParser: typeof DOMParser } };
};

type Loader = (data: Uint8Array) => Promise<{
  files: Record<string, { name: string; dir: boolean }>;
  file(name: string): { async(type: "uint8array" | "string" | "blob"): Promise<unknown> } | null;
}>;

const viaJszip: Loader = (data) => JSZip.loadAsync(data.slice());
const viaOfficeZip: Loader = (data) => loadAsync(data.slice().buffer);

async function settle<T>(promise: Promise<T>): Promise<T | "ERROR"> {
  try {
    return await promise;
  } catch {
    return "ERROR";
  }
}

/** Pełny obraz archiwum widziany przez API, którego używa podgląd. */
async function snapshot(load: Loader, data: Uint8Array) {
  const zip = await settle(load(data));
  if (zip === "ERROR") return "ERROR";
  const entries = [];
  for (const [key, entry] of Object.entries(zip.files)) {
    const file = zip.file(key);
    const bytes = file && (await settle(file.async("uint8array")));
    const text = file && (await settle(file.async("string")));
    const blob = file && (await settle(file.async("blob")));
    entries.push({
      key,
      name: entry.name,
      dir: entry.dir,
      file: file !== null,
      bytes: bytes instanceof Uint8Array ? Array.from(bytes) : bytes,
      text,
      blob:
        blob instanceof Blob
          ? { type: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }
          : blob,
    });
  }
  const probes = ["", "missing.txt", "dir", "dir/", "Word/document.xml"].map(
    (name) => zip.file(name) !== null,
  );
  return { entries, probes };
}

async function expectSameAsJszip(data: Uint8Array, label = "") {
  const expected = await snapshot(viaJszip, data);
  expect(await snapshot(viaOfficeZip, data), label).toEqual(expected);
  return expected;
}

// ── Surowy zapis ZIP (tylko do testu) ─────────────────────────────────────────

const utf8 = (text: string) => new TextEncoder().encode(text);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

class Bytes {
  private readonly parts: number[] = [];
  get length() {
    return this.parts.length;
  }
  u8(value: number) {
    this.parts.push(value & 0xff);
    return this;
  }
  u16(value: number) {
    return this.u8(value).u8(value >>> 8);
  }
  u32(value: number) {
    return this.u16(value & 0xffff).u16(Math.floor(value / 0x10000));
  }
  u64(value: number) {
    return this.u32(value % 0x100000000).u32(Math.floor(value / 0x100000000));
  }
  raw(bytes: Uint8Array | readonly number[]) {
    for (const byte of bytes) this.parts.push(byte);
    return this;
  }
  done() {
    return Uint8Array.from(this.parts);
  }
}

function field(id: number, body: Uint8Array): Uint8Array {
  return new Bytes().u16(id).u16(body.length).raw(body).done();
}

/** Pole Info-ZIP 0x7075 / 0x6375: wersja, CRC-32 oryginału, tekst UTF-8. */
function unicodeExtra(id: number, original: Uint8Array, text: string, version = 1, crc?: number) {
  return field(
    id,
    new Bytes()
      .u8(version)
      .u32(crc ?? crc32(original))
      .raw(utf8(text))
      .done(),
  );
}

interface RawEntry {
  readonly name: string | Uint8Array;
  /** Nazwa w katalogu centralnym, jeśli inna niż w nagłówku lokalnym. */
  readonly centralName?: string | Uint8Array;
  readonly content?: Uint8Array;
  /** Gotowe dane (już skompresowane), zamiast kompresji `content`. */
  readonly data?: Uint8Array;
  readonly method?: number;
  readonly flags?: number;
  readonly madeBy?: number;
  readonly external?: number;
  readonly extra?: Uint8Array;
  readonly comment?: Uint8Array;
  /** Rozmiar po rozpakowaniu w katalogu (domyślnie prawdziwy). */
  readonly size?: number;
  /** Rozmiary i przesunięcie jako 0xFFFFFFFF + pole ZIP64 0x0001. */
  readonly zip64?: boolean;
}

interface RawOptions {
  readonly prefix?: number;
  readonly comment?: string;
  readonly records?: number;
  readonly zip64End?: "ok" | "misplaced-locator" | "no-locator" | "multi-disk" | "long-record";
  readonly centralOffset?: number;
}

const bytesOf = (value: string | Uint8Array) => (typeof value === "string" ? utf8(value) : value);

function rawZip(entries: readonly RawEntry[], options: RawOptions = {}): Uint8Array {
  const out = new Bytes().raw(new Array<number>(options.prefix ?? 0).fill(0x5a));
  const base = out.length;
  const central = new Bytes();
  for (const entry of entries) {
    const content = entry.content ?? new Uint8Array(0);
    const method = entry.method ?? 8;
    const data = entry.data ?? (method === 8 ? deflateSync(content) : content);
    const name = bytesOf(entry.name);
    const offset = out.length - base;
    const crc = crc32(content);
    const size = entry.size ?? content.length;
    const big = entry.zip64 === true;
    const zip64Extra = big
      ? field(1, new Bytes().u64(size).u64(data.length).u64(offset).done())
      : new Uint8Array(0);
    out
      .u32(0x04034b50)
      .u16(20)
      .u16(entry.flags ?? 0)
      .u16(method)
      .u32(0)
      .u32(crc)
      .u32(big ? 0xffffffff : data.length)
      .u32(big ? 0xffffffff : size)
      .u16(name.length)
      .u16(0)
      .raw(name)
      .raw(data);
    const centralName = bytesOf(entry.centralName ?? entry.name);
    const extra = new Bytes()
      .raw(zip64Extra)
      .raw(entry.extra ?? [])
      .done();
    const comment = entry.comment ?? new Uint8Array(0);
    central
      .u32(0x02014b50)
      .u16(entry.madeBy ?? 0x0314)
      .u16(20)
      .u16(entry.flags ?? 0)
      .u16(method)
      .u32(0)
      .u32(crc)
      .u32(big ? 0xffffffff : data.length)
      .u32(big ? 0xffffffff : size)
      .u16(centralName.length)
      .u16(extra.length)
      .u16(comment.length)
      .u16(0)
      .u16(0)
      .u32(entry.external ?? 0)
      .u32(big ? 0xffffffff : offset)
      .raw(centralName)
      .raw(extra)
      .raw(comment);
  }
  const centralOffset = options.centralOffset ?? out.length - base;
  const centralBytes = central.done();
  out.raw(centralBytes);
  const records = options.records ?? entries.length;
  const zip64 = options.zip64End;
  if (zip64 !== undefined) {
    const recordOffset = out.length - base;
    const extensible = zip64 === "long-record" ? 8 : 0;
    out
      .u32(0x06064b50)
      .u64(44 + extensible)
      .u16(45)
      .u16(45)
      .u32(0)
      .u32(0)
      .u64(records)
      .u64(records)
      .u64(centralBytes.length)
      .u64(centralOffset)
      .raw(new Array<number>(extensible).fill(0));
    if (zip64 !== "no-locator") {
      out
        .u32(0x07064b50)
        .u32(0)
        .u64(zip64 === "misplaced-locator" ? recordOffset + 3 : recordOffset)
        .u32(zip64 === "multi-disk" ? 2 : 1);
    }
  }
  const comment = utf8(options.comment ?? "");
  out
    .u32(0x06054b50)
    .u16(0)
    .u16(0)
    .u16(zip64 ? 0xffff : records)
    .u16(zip64 ? 0xffff : records)
    .u32(zip64 ? 0xffffffff : centralBytes.length)
    .u32(zip64 ? 0xffffffff : centralOffset)
    .u16(comment.length)
    .raw(comment);
  return out.done();
}

const text = (value: string) => utf8(value);
const DIR_DOS = 0x10;
const DIR_UNIX = 0o040755 * 0x10000;
const FILE_UNIX = 0o100644 * 0x10000;

// ── Archiwa z generatorów ────────────────────────────────────────────────────

async function jszipArchive(
  options: Omit<NonNullable<Parameters<JSZip["generateAsync"]>[0]>, "type">,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types/>');
  zip.file("word/document.xml", "<w:document>Zażółć gęślą jaźń 🙂 مرحبا</w:document>");
  zip.file("word/media/image1.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]));
  zip.file("empty.txt", "");
  zip.folder("dir")?.file("nested.txt", "w katalogu");
  zip.file("łódź/żółw.xml", "<a/>");
  zip.file("bom.xml", "\ufeff<a/>");
  return zip.generateAsync({ type: "uint8array", ...options });
}

describe("officeZip - archiwa z generatorów: ten sam obraz co jszip", () => {
  it.each([
    ["jszip DEFLATE", { compression: "DEFLATE" as const }],
    ["jszip STORE", { compression: "STORE" as const }],
    ["jszip z deskryptorami danych (streamFiles)", { streamFiles: true }],
    ["jszip z komentarzem archiwum", { comment: "komentarz ąę" }],
    ["jszip UNIX", { platform: "UNIX" as const }],
  ])("%s", async (_label, options) => {
    const snap = await expectSameAsJszip(await jszipArchive(options));
    expect(snap).not.toBe("ERROR");
  });

  it("fflate zipSync: poziomy kompresji, katalogi, nazwy spoza ASCII", async () => {
    for (const level of [0, 6, 9] as const) {
      const archive = zipSync(
        {
          "ppt/slides/slide1.xml": text("<p:sld>Slajd</p:sld>"),
          "ppt/media/": {},
          "ppt/media/obraz ż.png": new Uint8Array([1, 2, 3]),
          "pusty.txt": new Uint8Array(0),
        },
        { level },
      );
      const snap = await expectSameAsJszip(archive, `level ${level}`);
      expect(snap).not.toBe("ERROR");
    }
  });

  it("wszystkie pliki .docx z testów mammoth", async () => {
    const dir = join(require.resolve("mammoth/package.json"), "../test/test-data");
    const files = readdirSync(dir).filter((name) => name.endsWith(".docx"));
    expect(files.length).toBeGreaterThanOrEqual(15);
    for (const name of files) {
      const snap = await expectSameAsJszip(new Uint8Array(readFileSync(join(dir, name))), name);
      expect(snap, name).not.toBe("ERROR");
    }
  });

  it("Uint8Array będący WIDOKIEM większego bufora (przesunięcie bajtowe)", async () => {
    const archive = await jszipArchive({ compression: "DEFLATE" });
    const host = new Uint8Array(archive.length + 64);
    host.set(archive, 32);
    const view = host.subarray(32, 32 + archive.length);
    const expected = await snapshot(viaJszip, view);
    expect(await snapshot((data) => loadAsync(data), view)).toEqual(expected);
  });
});

describe("officeZip - archiwa brzegowe złożone bajt po bajcie", () => {
  const plain = (name: string, content = name, extra: Partial<RawEntry> = {}): RawEntry => ({
    name,
    content: text(content),
    ...extra,
  });

  it.each<[string, readonly RawEntry[], RawOptions?]>([
    ["STORE i DEFLATE obok siebie", [plain("a.txt"), plain("b.txt", "bbb", { method: 0 })]],
    ["prefiks 100 bajtów (archiwum samorozpakowujące)", [plain("a.txt")], { prefix: 100 }],
    ["komentarz archiwum", [plain("a.txt")], { comment: "uwaga" }],
    [
      "nazwy do normalizacji: ./, ../, //, / na początku",
      [plain("./a.txt"), plain("x/../b.txt"), plain("c//d.txt"), plain("/abs.txt")],
    ],
    [
      "katalogi: ukośnik, atrybut DOS, S_IFDIR uniksowy, S_IFDIR przy twórcy DOS",
      [
        plain("dir/", ""),
        plain("dos", "", { external: DIR_DOS }),
        plain("unix-dos", "", { external: DIR_UNIX | DIR_DOS, madeBy: 0x0314 }),
        plain("unix-slash/", "", { external: DIR_UNIX, madeBy: 0x0314 }),
        plain("not-dir", "treść", { external: DIR_UNIX, madeBy: 0x0014 }),
        plain("plik", "treść", { external: FILE_UNIX }),
        plain("dir-with-data/", "dane katalogu"),
        plain("dos-with-data", "dane", { external: DIR_DOS }),
      ],
    ],
    [
      "duplikat nazwy - późniejszy wpis wygrywa",
      [plain("dup.txt", "1"), plain("x"), plain("dup.txt", "2")],
    ],
    ["kolejność kluczy liczbowych", [plain("10"), plain("2"), plain("a"), plain("1")]],
    [
      "nazwa z nagłówka lokalnego, nie z katalogu",
      [plain("local.txt", "x", { centralName: "central.txt" })],
    ],
    [
      "UTF-8 z flagą 11 i bez flagi",
      [plain("zażółć.txt", "a", { flags: 0x0800 }), plain("gęślą.txt", "b")],
    ],
    [
      "pole Info-ZIP 0x7075: poprawne, złe CRC, wersja 2",
      [
        plain("a?.txt", "1", { extra: unicodeExtra(0x7075, text("a?.txt"), "aż.txt") }),
        plain("b?.txt", "2", { extra: unicodeExtra(0x7075, text("b?.txt"), "bż.txt", 1, 7) }),
        plain("c?.txt", "3", { extra: unicodeExtra(0x7075, text("c?.txt"), "cż.txt", 2) }),
        plain("d?.txt", "4", {
          flags: 0x0800,
          extra: unicodeExtra(0x7075, text("d?.txt"), "dż.txt"),
        }),
      ],
    ],
    [
      "pole Info-ZIP 0x6375 (komentarz) poprawne",
      [plain("k.txt", "k", { comment: text("c"), extra: unicodeExtra(0x6375, text("c"), "ć") })],
    ],
    [
      "pole dodatkowe nieznane i obcięte",
      [plain("e.txt", "e", { extra: Uint8Array.of(0x99, 0x99, 2) })],
    ],
    ["plik pusty z metodą DEFLATE", [plain("empty.txt", "")]],
    [
      "plik pusty z danymi (rozmiar 0 w katalogu)",
      [plain("zero.txt", "", { data: deflateSync(text("ignorowane")), size: 0 })],
    ],
    ["rozmiar w katalogu większy niż dane", [plain("big.txt", "abc", { size: 10 })]],
    ["rozmiar w katalogu mniejszy niż dane", [plain("small.txt", "abcdef", { size: 2 })]],
    [
      "dane DEFLATE uszkodzone",
      [plain("bad.txt", "abc", { data: Uint8Array.of(0xff, 0xff, 0xff) })],
    ],
    [
      "ZIP64: wpisy i koniec katalogu",
      [plain("a.txt", "a", { zip64: true }), plain("b.txt")],
      { zip64End: "ok" },
    ],
    [
      "ZIP64: lokalizator wskazuje obok rekordu",
      [plain("a.txt")],
      { zip64End: "misplaced-locator" },
    ],
    ["ZIP64: brak lokalizatora", [plain("a.txt")], { zip64End: "no-locator" }],
    ["ZIP64: archiwum wielotomowe", [plain("a.txt")], { zip64End: "multi-disk" }],
    ["ZIP64: rekord z danymi rozszerzalnymi", [plain("a.txt")], { zip64End: "long-record" }],
    ["rozmiar 0xFFFFFFFF bez pola ZIP64", [plain("a.txt", "a", { size: 0xffffffff })]],
    ["szyfrowanie", [plain("secret.txt", "s", { flags: 1 })]],
    ["metoda kompresji 12 (bzip2)", [plain("b.bz2", "x", { method: 12, data: text("BZh") })]],
    ["katalog zapowiada więcej wpisów niż ma", [plain("a.txt"), plain("b.txt")], { records: 5 }],
    ["katalog zapowiada wpisy, a nie ma żadnego", [], { records: 3 }],
    ["pusty katalog", []],
    ["przesunięcie katalogu poza dane", [plain("a.txt")], { centralOffset: 9999 }],
  ])("%s", async (_label, entries, options) => {
    await expectSameAsJszip(rawZip(entries, options));
  });

  it("nie-archiwa: pusty bufor, tekst, PDF, śmieci", async () => {
    const garbage = Uint8Array.from({ length: 2048 }, (_, i) => (i * 7919) % 251);
    for (const data of [
      new Uint8Array(0),
      text("to nie jest zip"),
      text("%PDF-1.7\n1 0 obj\n"),
      garbage,
      Uint8Array.of(0x50, 0x4b, 0x05, 0x06),
    ]) {
      expect(await snapshot(viaOfficeZip, data)).toBe("ERROR");
      expect(await snapshot(viaJszip, data)).toBe("ERROR");
    }
  });

  it("archiwum obcięte w każdym miejscu albo z obciętym początkiem", async () => {
    const archive = rawZip([
      { name: "word/document.xml", content: text("<w:document>treść</w:document>".repeat(20)) },
      { name: "word/styles.xml", content: text("<w:styles/>"), method: 0 },
    ]);
    for (let cut = 0; cut < archive.length; cut += 3) {
      await expectSameAsJszip(archive.slice(0, cut), `obcięte do ${cut}`);
      await expectSameAsJszip(archive.slice(cut), `bez pierwszych ${cut}`);
    }
  });
});

describe("officeZip - API i świadome różnice", () => {
  it("ZNANA RÓŻNICA: blok „stored” z zepsutym NLEN - jszip odrzuca, officeZip czyta po LEN", async () => {
    const content = text("treść bloku stored");
    // BFINAL=1, BTYPE=00, LEN, NLEN (powinno być ~LEN), dane.
    const block = new Bytes().u8(1).u16(content.length).u16(0x1234).raw(content).done();
    const archive = rawZip([{ name: "a.txt", content, data: block }]);
    const jszip = await snapshot(viaJszip, archive);
    const office = await snapshot(viaOfficeZip, archive);
    expect(jszip).not.toBe("ERROR");
    expect(office).not.toBe("ERROR");
    if (jszip === "ERROR" || office === "ERROR") return;
    expect(jszip.entries[0]?.bytes).toBe("ERROR");
    expect(office.entries[0]?.text).toBe("treść bloku stored");
    // Poprawne NLEN: oba czytają to samo.
    const valid = new Bytes()
      .u8(1)
      .u16(content.length)
      .u16(~content.length & 0xffff)
      .raw(content)
      .done();
    await expectSameAsJszip(rawZip([{ name: "a.txt", content, data: valid }]));
  });

  it("ZNANA RÓŻNICA: katalog tylko z uniksowym S_IFDIR - jszip pada na własnym `null`, czytnik oddaje katalog", async () => {
    const archive = rawZip([
      { name: "unix", content: new Uint8Array(0), external: DIR_UNIX, madeBy: 0x0314 },
      { name: "a.txt", content: text("a") },
    ]);
    await expect(JSZip.loadAsync(archive)).rejects.toThrow(TypeError);
    const office = await snapshot(viaOfficeZip, archive);
    expect(office).not.toBe("ERROR");
    if (office === "ERROR") return;
    expect(office.entries.map(({ key, dir, file }) => ({ key, dir, file }))).toEqual([
      { key: "unix/", dir: true, file: false },
      { key: "a.txt", dir: false, file: true },
    ]);
  });

  it("zapis i nieużywane typy wyniku rzucają zamiast udawać jszip", async () => {
    const zip = await loadAsync(rawZip([{ name: "a.txt", content: text("a") }]));
    expect(() => (zip.file as (name: string, data: string) => unknown)("b.txt", "b")).toThrow(
      /zapis archiwum jest wycięty/,
    );
    const file = zip.file("a.txt");
    await expect(
      (file?.async as (type: string) => Promise<unknown>)("arraybuffer"),
    ).rejects.toThrow(/nieobsługiwany typ wyniku/);
    await expect(loadAsync("PK" as unknown as ArrayBuffer)).rejects.toThrow(/ArrayBuffer/);
  });

  it("tekst zostawia BOM, Blob ma pusty typ MIME - jak jszip", async () => {
    const archive = rawZip([{ name: "bom.xml", content: text("\ufeff<a/>") }]);
    const zip = await loadAsync(archive);
    expect(await zip.file("bom.xml")?.async("string")).toBe("\ufeff<a/>");
    expect((await zip.file("bom.xml")?.async("blob"))?.type).toBe("");
  });
});

// ── parsePptx na prawdziwym archiwum: officeZip kontra jszip ─────────────────

describe("parsePptx na prawdziwym .pptx - ten sam wynik z officeZip i z jszip", () => {
  afterEach(() => {
    vi.doUnmock("../vendor/officeZip");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const slide = (body: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<p:sld ${A} ${P} ${R}><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
  const para = (...runs: string[]) =>
    `<a:p>${runs.map((run) => `<a:r><a:t xml:space="preserve">${run}</a:t></a:r>`).join("")}</a:p>`;

  async function pptx(compression: "DEFLATE" | "STORE"): Promise<ArrayBuffer> {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types/>');
    zip.file(
      "ppt/slides/slide1.xml",
      slide(
        para("Zażółć ", "gęślą jaźń") +
          para("Punkt   z\todstępami") +
          para("&lt;tag&gt; &amp; 🙂 مرحبا") +
          '<a:blip r:embed="rId2"/><a:blip r:embed="rId9"/>',
      ),
    );
    zip.file("ppt/slides/slide2.xml", slide(para("Drugi")));
    zip.file("ppt/slides/slide10.xml", slide(para("Dziesiąty") + '<a:blip r:embed="rId1"/>'));
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId2" Target="../media/image1.png"/>' +
        '<Relationship Id="rId9" Target="../media/brak.png"/></Relationships>',
    );
    zip.file(
      "ppt/slides/_rels/slide10.xml.rels",
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Target="ppt/media/image2.jpeg"/></Relationships>',
    );
    zip.file("ppt/media/image1.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]));
    zip.file("ppt/media/image2.jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]));
    zip.file(
      "ppt/notesSlides/notesSlide1.xml",
      `<?xml version="1.0"?><p:notes ${A} ${P}><a:t>Notatka</a:t><a:t> prelegenta ż</a:t></p:notes>`,
    );
    zip.folder("ppt/slides/empty");
    return zip.generateAsync({ type: "arraybuffer", compression });
  }

  /** `parsePptx` z danym czytnikiem; obrazy jako bajty zamiast losowych adresów blob:. */
  async function run(buffer: ArrayBuffer, reader: "officeZip" | "jszip") {
    vi.stubGlobal("DOMParser", new JSDOM("").window.DOMParser);
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      (blob) => `blob:test/${blobs.push(blob as Blob) - 1}`,
    );
    vi.resetModules();
    if (reader === "jszip") {
      vi.doMock("../vendor/officeZip", () => ({
        loadAsync: (data: ArrayBuffer) => JSZip.loadAsync(data),
      }));
    } else {
      vi.doUnmock("../vendor/officeZip");
    }
    const { parsePptx } = await import("../officeParse");
    const slides = await parsePptx(buffer);
    const images = await Promise.all(
      blobs.map(async (blob) => ({
        type: blob.type,
        bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
      })),
    );
    return { slides, images };
  }

  it.each(["DEFLATE", "STORE"] as const)("%s", async (compression) => {
    const buffer = await pptx(compression);
    const expected = await run(buffer, "jszip");
    const actual = await run(buffer, "officeZip");
    expect(actual).toEqual(expected);
    // Treść naprawdę przeszła przez parser (a nie: dwa razy pusto).
    expect(actual.slides.map((s) => s.index)).toEqual([1, 2, 10]);
    expect(actual.slides[0]).toMatchObject({
      title: "Zażółć gęślą jaźń",
      paragraphs: ["Punkt z odstępami", "<tag> & 🙂 مرحبا"],
      notes: "Notatka prelegenta ż",
      images: ["blob:test/0"],
    });
    expect(actual.images).toEqual([
      { type: "", bytes: [0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10] },
      { type: "", bytes: [0xff, 0xd8, 0xff, 0xe0, 0, 16] },
    ]);
  });

  it("uszkodzone archiwum: obie wersje odrzucają", async () => {
    const buffer = (await pptx("DEFLATE")).slice(0, 200);
    await expect(run(buffer, "jszip")).rejects.toThrow();
    await expect(run(buffer, "officeZip")).rejects.toThrow();
  });
});
