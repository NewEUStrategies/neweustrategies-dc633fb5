// @vitest-environment node
// Archiwum ZIP (STORE) paczki `.pkpass`.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. Zły CRC albo przesunięty offset
// w katalogu centralnym to paczka, której iOS nie otworzy („nie można
// odczytać przepustki"). Test czyta archiwum NIEZALEŻNYM czytnikiem (`jszip`,
// już w zależnościach) i sprawdza nagłówki bajt po bajcie.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { crc32, zipStore } from "../zip";

const enc = (text: string) => new TextEncoder().encode(text);

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}
function u32(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

describe("crc32", () => {
  it("wektory kontrolne IEEE (pusty wejście i „123456789”)", () => {
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(enc("123456789"))).toBe(0xcbf43926);
    expect(crc32(enc("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });
});

describe("zipStore", () => {
  it("niezależny czytnik odczytuje wszystkie wpisy z nazwami UTF-8 i treścią 1:1", async () => {
    const icon = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
    const archive = zipStore([
      { name: "pass.json", data: enc('{"a":1}') },
      { name: "icon.png", data: icon },
      { name: "pl.lproj/pass.strings", data: enc('"Wydarzenie" = "Wydarzenie";') },
      { name: "pusty.txt", data: new Uint8Array() },
    ]);
    const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
    expect(Object.keys(zip.files)).toEqual([
      "pass.json",
      "icon.png",
      "pl.lproj/pass.strings",
      "pusty.txt",
    ]);
    expect(await zip.file("pass.json")!.async("string")).toBe('{"a":1}');
    expect(await zip.file("icon.png")!.async("uint8array")).toEqual(icon);
    expect(await zip.file("pusty.txt")!.async("uint8array")).toEqual(new Uint8Array());
  });

  it("nagłówki: STORE, flaga UTF-8, CRC, rozmiary, offsety i koniec katalogu", () => {
    const first = enc("abc");
    const second = enc("zażółć");
    const archive = zipStore([
      { name: "a", data: first },
      { name: "ł.txt", data: second },
    ]);
    // Nagłówek lokalny pierwszego wpisu.
    expect(u32(archive, 0)).toBe(0x04034b50);
    expect(u16(archive, 6)).toBe(0x0800);
    expect(u16(archive, 8)).toBe(0);
    expect(u16(archive, 12)).toBe(0x21);
    expect(u32(archive, 14)).toBe(crc32(first));
    expect(u32(archive, 18)).toBe(3);
    expect(u32(archive, 22)).toBe(3);
    const secondLocal = 30 + 1 + 3;
    expect(u32(archive, secondLocal)).toBe(0x04034b50);
    expect(u16(archive, secondLocal + 26)).toBe(new TextEncoder().encode("ł.txt").length);

    // Koniec katalogu centralnego: 2 wpisy, katalog zaraz za danymi.
    const eocd = archive.length - 22;
    expect(u32(archive, eocd)).toBe(0x06054b50);
    expect(u16(archive, eocd + 8)).toBe(2);
    expect(u16(archive, eocd + 10)).toBe(2);
    const directoryOffset = u32(archive, eocd + 16);
    expect(u32(archive, directoryOffset)).toBe(0x02014b50);
    expect(u32(archive, directoryOffset + 42)).toBe(0);
    const secondCentral = directoryOffset + 46 + 1;
    expect(u32(archive, secondCentral + 42)).toBe(secondLocal);
    expect(u32(archive, eocd + 12)).toBe(eocd - directoryOffset);
  });

  it("puste archiwum ma sam koniec katalogu", () => {
    const archive = zipStore([]);
    expect(archive).toHaveLength(22);
    expect(u32(archive, 0)).toBe(0x06054b50);
  });

  it("jest deterministyczne i odrzuca pustą albo powtórzoną nazwę", () => {
    const entries = [{ name: "pass.json", data: enc("{}") }];
    expect(zipStore(entries)).toEqual(zipStore(entries));
    expect(() => zipStore([{ name: "", data: enc("x") }])).toThrow("empty or duplicate");
    expect(() =>
      zipStore([
        { name: "a", data: enc("1") },
        { name: "a", data: enc("2") },
      ]),
    ).toThrow("empty or duplicate");
  });
});
