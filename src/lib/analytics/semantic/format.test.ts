// Formatowanie wartości metryk. Najważniejszy inwariant: brak wartości NIGDY
// nie renderuje się jako „0” - w raporcie zarządczym „0 %” znaczy „nikt nie
// kliknął”, a nie „nie ma podstawy do wyliczenia”.
import { describe, expect, it } from "vitest";
import {
  chartLangOf,
  formatDeltaPct,
  formatMetricValue,
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
