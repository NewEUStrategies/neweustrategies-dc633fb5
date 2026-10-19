// Formatowanie wartości metryk. Najważniejszy inwariant: brak wartości NIGDY
// nie renderuje się jako „0” - w raporcie zarządczym „0 %” znaczy „nikt nie
// kliknął”, a nie „nie ma podstawy do wyliczenia”.
import { describe, expect, it } from "vitest";
import {
  chartLangOf,
  currencyExponent,
  formatDeltaPct,
  formatMetricValue,
  formatMoneyMinor,
  formatSignedPct,
  formatSpread,
  isoDateOnly,
} from "./format";

describe("formatMetricValue", () => {
  it("liczy metryki zliczające jako liczby całkowite", () => {
    expect(formatMetricValue(12_345, "count", "en")).toBe("12,345");
    expect(formatMetricValue(12_345.6, "count", "en")).toBe("12,346");
  });

  it("wskaźniki pokazuje w procentach", () => {
    expect(formatMetricValue(0.523, "ratio", "en")).toBe("52.3 %");
  });

  it("milisekundy zaokrągla i dodaje sufiks ms", () => {
    expect(formatMetricValue(2478.4, "milliseconds", "en")).toBe("2,478 ms");
  });

  it("CLS pokazuje jako bezwymiarowy wynik z trzema miejscami", () => {
    // Regresja: CLS bywał formatowany z sufiksem „ms”, mimo że jest bezwymiarowy.
    const out = formatMetricValue(0.08, "score", "en");
    expect(out).toBe("0.080");
    expect(out).not.toMatch(/ms/);
  });

  it("brak wartości daje myślnik, nie zero", () => {
    expect(formatMetricValue(null, "count", "pl")).toBe("-");
    expect(formatMetricValue(null, "ratio", "pl")).toBe("-");
    expect(formatMetricValue(Number.NaN, "count", "pl")).toBe("-");
  });

  it("respektuje własny tekst zastępczy", () => {
    expect(formatMetricValue(null, "ratio", "pl", "nieokreślone")).toBe("nieokreślone");
  });

  it("formatuje po polsku ze spacją nierozdzielającą tysięcy", () => {
    // pl-PL używa wąskiej spacji nierozdzielającej jako separatora tysięcy.
    expect(formatMetricValue(12_345, "count", "pl")).toMatch(/^12\s?345$/u);
  });

  it("polski wariant zachowuje jednostki i przecinek dziesiętny", () => {
    expect(formatMetricValue(0.523, "ratio", "pl")).toMatch(/^52,3\s%$/u);
    expect(formatMetricValue(2478.4, "milliseconds", "pl")).toMatch(/^2\s?478 ms$/u);
    expect(formatMetricValue(0.08, "score", "pl")).toBe("0,080");
  });
});

// Spacje w wyjściu ICU bywają nierozdzielające (U+00A0 / U+202F) - porównujemy
// po normalizacji, żeby test mówił o treści, nie o wersji ICU.
const sp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("formatMetricValue - jednostki huba", () => {
  it("kwota w groszach z walutą DTO, po polsku i po angielsku", () => {
    expect(sp(formatMetricValue(123_456, "money_minor", "pl", "-", { currency: "PLN" }))).toBe(
      "1234,56 zł",
    );
    expect(sp(formatMetricValue(123_456, "money_minor", "en", "-", { currency: "PLN" }))).toBe(
      "PLN 1,234.56",
    );
  });

  it("wykładnik waluty pochodzi z ISO 4217 - jen nie ma groszy", () => {
    // 1235 jenów w jednostkach drobnych to 1235 jenów, nie 12,35.
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("PLN")).toBe(2);
    expect(currencyExponent("BHD")).toBe(3);
    expect(sp(formatMoneyMinor(1235, "JPY", "en"))).toBe("JP¥1,235");
    expect(sp(formatMoneyMinor(1235, "JPY", "pl"))).toBe("1235 JPY");
  });

  it("kwota bez waluty to brak kwoty, nie złotówki z domysłu", () => {
    expect(formatMetricValue(5000, "money_minor", "pl")).toBe("-");
    expect(formatMetricValue(5000, "money_minor", "pl", "brak", { currency: "pln" })).toBe("brak");
    expect(formatMoneyMinor(Number.NaN, "PLN", "pl")).toBe("-");
    expect(formatMoneyMinor(100, "ZŁ", "pl")).toBe("-");
  });

  it("zero złotych to zmierzone zero, a `null` to brak - dwie różne informacje", () => {
    expect(sp(formatMetricValue(0, "money_minor", "pl", "-", { currency: "PLN" }))).toBe("0,00 zł");
    expect(formatMetricValue(null, "money_minor", "pl", "-", { currency: "PLN" })).toBe("-");
  });

  it("miesiące i dni odmieniają się przez ICU, bez słownika w kodzie", () => {
    expect(sp(formatMetricValue(5, "months", "pl"))).toBe("5 miesięcy");
    expect(sp(formatMetricValue(1, "months", "pl"))).toBe("1 miesiąc");
    expect(sp(formatMetricValue(5, "months", "en"))).toBe("5 months");
    expect(sp(formatMetricValue(12, "days", "pl"))).toBe("12 dni");
    expect(sp(formatMetricValue(1, "days", "en"))).toBe("1 day");
  });

  it("godziny poniżej jednej pokazują się w minutach, od pełnej godziny w godzinach", () => {
    expect(sp(formatMetricValue(0.75, "hours", "pl"))).toBe("45 minut");
    expect(sp(formatMetricValue(0.75, "hours", "en"))).toBe("45 minutes");
    expect(sp(formatMetricValue(5, "hours", "pl"))).toBe("5 godzin");
    expect(sp(formatMetricValue(2.5, "hours", "en"))).toBe("2.5 hours");
    // 0,999 h zaokrągla się do 60 minut - to już „1 godzina”, nie „60 minut”.
    expect(sp(formatMetricValue(0.999, "hours", "pl"))).toBe("1 godzina");
  });

  it("krotność to liczba ze znakiem ×, nie procent", () => {
    expect(formatMetricValue(3.2, "multiple", "pl")).toBe("3,2×");
    expect(formatMetricValue(3.2, "multiple", "en")).toBe("3.2×");
    expect(formatMetricValue(4.456, "multiple", "en")).toBe("4.46×");
  });

  it("brak wartości daje myślnik dla każdej nowej jednostki", () => {
    for (const unit of ["money_minor", "months", "multiple", "hours", "days"] as const) {
      expect(formatMetricValue(null, unit, "en", "-", { currency: "PLN" }), unit).toBe("-");
      expect(
        formatMetricValue(Number.POSITIVE_INFINITY, unit, "pl", "-", { currency: "PLN" }),
        unit,
      ).toBe("-");
    }
  });
});

describe("formatSpread / formatSignedPct / formatDeltaPct", () => {
  it("rozjazd podaje jako wartość bezwzględną w procentach", () => {
    expect(formatSpread(0.184, "en")).toBe("18.4 %");
    expect(formatSpread(-0.184, "en")).toBe("18.4 %");
  });

  it("odchylenie zachowuje znak", () => {
    expect(formatSignedPct(0.184, "en")).toBe("+18.4 %");
    expect(formatSignedPct(-0.031, "en")).toBe("-3.1 %");
    expect(formatSignedPct(0, "en")).toBe("0 %");
  });

  it("delta wobec okna poprzedniego przyjmuje punkty procentowe", () => {
    expect(formatDeltaPct(18.4, "en")).toBe("+18.4 %");
    expect(formatDeltaPct(null, "en")).toBe("-");
  });

  it("brak danych nie udaje zera", () => {
    expect(formatSpread(null, "en")).toBe("-");
    expect(formatSignedPct(null, "en")).toBe("-");
  });
});

describe("pomocnicze", () => {
  it("isoDateOnly przycina instant do daty UTC", () => {
    expect(isoDateOnly("2026-07-14T23:59:59.999Z")).toBe("2026-07-14");
  });

  it("chartLangOf rozpoznaje warianty angielskiego", () => {
    expect(chartLangOf("en")).toBe("en");
    expect(chartLangOf("en-GB")).toBe("en");
    expect(chartLangOf("pl-PL")).toBe("pl");
    expect(chartLangOf(undefined)).toBe("pl");
  });
});
