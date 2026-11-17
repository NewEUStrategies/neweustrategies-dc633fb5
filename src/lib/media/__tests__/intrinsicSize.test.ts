// Naturalny rozmiar pliku obrazu "WxH" (src/lib/media/intrinsicSize.ts).
//
// CO TU MA DOWÓD
//  1. JEDNA ścieżka walidacji: `formatIntrinsicSize` oddaje napis tylko wtedy,
//     gdy przyjmuje go `parseIntrinsicSize`. Wartość z tych funkcji trafia do
//     atrybutów `width`/`height` w HTML-u serwera, więc `width="0"`, ułamek
//     albo `NaN` nie mogą się tam znaleźć żadną drogą.
//  2. Wyszukiwanie po adresie jest DOKŁADNE (bez normalizacji) - wpis innego
//     pliku nie może zostać "pożyczony".
//  3. Uszkodzony zapis (zły typ listy, zła para, zły rozmiar) = brak rozmiaru,
//     czyli dzisiejszy znacznik bez atrybutów, a nie wyjątek w renderze.
import { describe, expect, it } from "vitest";
import {
  findIntrinsicSize,
  formatIntrinsicSize,
  parseIntrinsicSize,
  type IntrinsicSizeEntry,
} from "@/lib/media/intrinsicSize";

describe("parseIntrinsicSize", () => {
  it.each([
    ["350x150", { width: 350, height: 150 }],
    ["1x1", { width: 1, height: 1 }],
    ["1200x675", { width: 1200, height: 675 }],
    ["20000x20000", { width: 20000, height: 20000 }],
  ])("przyjmuje %s", (value, size) => {
    expect(parseIntrinsicSize(value)).toEqual(size);
  });

  it.each([
    ["zero szerokości", "0x150"],
    ["zero wysokości", "350x0"],
    ["ułamek", "350.5x150"],
    ["wartość ujemna", "-1x5"],
    ["spacja na końcu", "350x150 "],
    ["spacja na początku", " 350x150"],
    ["wielkie X", "350X150"],
    ["zero wiodące", "0350x150"],
    ["bok ponad limit", "20001x10"],
    ["drugi bok ponad limit", "10x20001"],
    ["sześć cyfr", "100000x10"],
    ["sama szerokość", "1200"],
    ["pusty napis", ""],
    ["jednostka", "350pxx150px"],
    ["liczba", 350],
    ["null", null],
    ["undefined", undefined],
    ["obiekt", { width: 350, height: 150 }],
    ["tablica", [350, 150]],
  ])("odrzuca: %s", (_label, value) => {
    expect(parseIntrinsicSize(value)).toBeUndefined();
  });
});

describe("formatIntrinsicSize", () => {
  it.each([
    [350, 150, "350x150"],
    [1, 1, "1x1"],
    [20000, 20000, "20000x20000"],
  ])("%d × %d -> napis, który wraca z parsera tą samą parą", (width, height, text) => {
    expect(formatIntrinsicSize(width, height)).toBe(text);
    expect(parseIntrinsicSize(formatIntrinsicSize(width, height))).toEqual({ width, height });
  });

  it.each([
    ["zero (obraz bez rozmiaru, np. SVG w Firefoksie)", 0, 0],
    ["zero jednego boku", 350, 0],
    ["NaN", Number.NaN, 150],
    ["nieskończoność", Number.POSITIVE_INFINITY, 150],
    ["ułamek", 350.5, 150],
    ["wartość ujemna", -350, 150],
    ["bok ponad limit", 20001, 150],
    ["notacja wykładnicza", 1e21, 150],
  ])('%s -> "" (nieznany)', (_label, width, height) => {
    expect(formatIntrinsicSize(width, height)).toBe("");
  });
});

describe("findIntrinsicSize", () => {
  const A = "https://neweuropeanstrategies.com/media/theme/logo/a.svg";
  const B = "https://neweuropeanstrategies.com/media/theme/logo/b.svg";
  const entries: IntrinsicSizeEntry[] = [
    [A, "350x150"],
    [B, "700x300"],
  ];

  it("zwraca rozmiar wyłącznie dla dokładnie tego samego adresu", () => {
    expect(findIntrinsicSize(entries, A)).toEqual({ width: 350, height: 150 });
    expect(findIntrinsicSize(entries, B)).toEqual({ width: 700, height: 300 });
    // Ten sam plik w innej formie adresu to INNY napis - bez pożyczania.
    expect(findIntrinsicSize(entries, "/media/theme/logo/a.svg")).toBeUndefined();
    expect(findIntrinsicSize(entries, `${A}?v=2`)).toBeUndefined();
    expect(findIntrinsicSize(entries, A.toUpperCase())).toBeUndefined();
  });

  it("przy powtórzonym adresie wygrywa pierwsza para - także gdy jest błędna", () => {
    expect(
      findIntrinsicSize(
        [
          [A, "350x150"],
          [A, "10x10"],
        ],
        A,
      ),
    ).toEqual({ width: 350, height: 150 });
    expect(
      findIntrinsicSize(
        [
          [A, "0x0"],
          [A, "350x150"],
        ],
        A,
      ),
    ).toBeUndefined();
  });

  it("pusty adres nie pasuje do niczego, nawet do pary z pustym adresem", () => {
    expect(findIntrinsicSize([["", "350x150"]], "")).toBeUndefined();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["napis", "350x150"],
    ["obiekt-mapa", { [A]: "350x150" }],
    ["liczba", 5],
  ])("lista innego kształtu (%s) -> undefined", (_label, corrupt) => {
    expect(findIntrinsicSize(corrupt, A)).toBeUndefined();
  });

  it("pary innego kształtu są pomijane, a poprawna dalej na liście działa", () => {
    const mixed: unknown[] = [null, "x", 7, { 0: A, 1: "350x150" }, [], [A, "350x150"]];
    expect(findIntrinsicSize(mixed, A)).toEqual({ width: 350, height: 150 });
  });

  it.each([
    ["zły napis", "350"],
    ["zera", "0x0"],
    ["liczba zamiast napisu", 350],
    ["brak drugiego elementu", undefined],
    ["obiekt", { width: 350, height: 150 }],
  ])("poprawny adres z błędnym rozmiarem (%s) -> undefined", (_label, size) => {
    expect(findIntrinsicSize([[A, size]], A)).toBeUndefined();
  });
});
