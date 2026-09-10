import { describe, expect, it } from "vitest";
import {
  formatAxisTick,
  formatChartValue,
  formatPercent,
  formatPercentPoints,
} from "../format";

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
