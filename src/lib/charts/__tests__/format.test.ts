import { describe, expect, it } from "vitest";
import { formatAxisTick, formatChartValue, formatPercent, formatPercentPoints } from "../format";

describe("formatChartValue", () => {
  it("formats per locale with the unit appended", () => {
    expect(formatChartValue(1234.5, "en", " bn")).toBe("1,234.5 bn");
    // pl-PL: przecinek dziesiętny (grupowanie tysięcy zależy od wersji ICU).
    expect(formatChartValue(1234.5, "pl", "%")).toMatch(/^1[\s\u00a0\u202f]?234,5%$/);
  });

  it("gives small values more precision", () => {
    expect(formatChartValue(3.456, "en")).toBe("3.46");
    expect(formatChartValue(345.6, "en")).toBe("345.6");
  });
});

describe("formatAxisTick", () => {
  it("compacts large magnitudes per locale", () => {
    expect(formatAxisTick(12_500_000, "en")).toBe("12.5M");
    expect(formatAxisTick(12_500_000, "pl")).toMatch(/12,5/);
    expect(formatAxisTick(9_999, "en")).toBe("9,999");
  });
});

describe("formatPercent", () => {
  it("formats shares with sensible precision", () => {
    expect(formatPercent(0.42, "en")).toBe("42%");
    expect(formatPercent(0.056, "en")).toBe("5.6%");
    expect(formatPercent(0.42, "pl")).toBe("42%");
  });
});

describe("formatPercentPoints", () => {
  it("trzyma JEDNO miejsce po przecinku - także przy liczbach całych", () => {
    // Suma kontrolna udziałów pokazuje dokładnie tę rozbieżność, którą
    // wykryła, więc nie może jej zaokrąglić do zera miejsc: `formatPercent`
    // zwracał dla 0,999 napis "100%", czyli komunikat "udziały sumują się do
    // 100%, a nie do 100%".
    expect(formatPercentPoints(99.9, "en")).toBe("99.9%");
    expect(formatPercentPoints(99.9, "pl")).toBe("99,9%");
    expect(formatPercentPoints(90, "pl")).toBe("90,0%");
    expect(formatPercentPoints(104, "en")).toBe("104.0%");
  });
});

describe("osłona przed NaN i nieskończonością", () => {
  // PO CO. `Intl.NumberFormat` na NaN zwraca literalny napis "NaN", a na
  // nieskończoności "∞" - oba wyciekają do treści strony przez tooltip,
  // tabelę danych i etykiety bezpośrednie. Bramka
  // `src/components/blocks/__tests__/blockMatrix.test.tsx` sprawdza
  // `textContent` każdego bloku na obecność napisu "NaN", więc taki wyciek
  // jest awarią CI, nie kosmetyką.
  //
  // Dopóki wykres liczył wyłącznie sumy i różnice, NaN nie miał skąd się wziąć.
  // Rodzaje statystyczne to zmieniają: indeks przy wartości bazowej zero,
  // współczynnik determinacji przy zerowej wariancji, gęstość przy przedziale
  // zerowej szerokości. Każde z nich jest dzieleniem, a każdy mianownik może
  // w arkuszu autora wyjść zerem.
  it("każda funkcja formatująca zwraca kreskę, nie napis NaN", () => {
    for (const zly of [NaN, Infinity, -Infinity]) {
      expect(formatChartValue(zly, "pl")).toBe("-");
      expect(formatChartValue(zly, "en", " mld")).toBe("-");
      expect(formatAxisTick(zly, "pl")).toBe("-");
      expect(formatPercent(zly, "en")).toBe("-");
      expect(formatPercentPoints(zly, "pl")).toBe("-");
    }
  });

  it("BEZ JEDNOSTKI przy wartości, której nie ma", () => {
    // "- mld EUR" sugerowałoby, że wiemy, w czym mierzymy coś, czego nie znamy.
    expect(formatChartValue(NaN, "pl", " mld EUR")).toBe("-");
    expect(formatChartValue(NaN, "pl", "%")).toBe("-");
  });

  it("dowód, że osłona jest potrzebna: Intl sam zwraca napis NaN", () => {
    // Test kontrolny na platformie, nie na naszym kodzie. Gdyby kiedyś Intl
    // zmienił zachowanie, ten test powie, że osłona przestała być konieczna -
    // i wtedy będzie to decyzja, a nie przypadek.
    expect(NaN.toLocaleString("pl-PL")).toBe("NaN");
    expect(Number.POSITIVE_INFINITY.toLocaleString("pl-PL", { style: "percent" })).toContain("∞");
  });

  it("zero i wartości ujemne NIE są traktowane jak brak", () => {
    // Osłona pyta o skończoność, nie o prawdziwość - `!value` odrzucałoby zero,
    // a zero jest legalną wartością danych i musi się pokazać jako "0".
    expect(formatChartValue(0, "pl")).toBe("0");
    expect(formatChartValue(-0, "pl")).toBe("-0");
    expect(formatChartValue(-12.5, "pl", " mld")).toBe("-12,5 mld");
    expect(formatPercent(0, "pl")).toBe("0%");
    expect(formatPercentPoints(0, "pl")).toBe("0,0%");
  });
});
