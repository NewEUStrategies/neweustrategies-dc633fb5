// Kotwica cenowa: równowartość miesięczna planu rocznego jako czysta,
// przybliżona (w dół) kwota bez ułamka - „≈49 zł" zamiast „49,17 zł".
import { describe, it, expect } from "vitest";
import { formatApproxDisplayMoney } from "@/lib/billing/displayCurrency";
import { formatMoneyWhole } from "@/lib/billing/types";

describe("formatApproxDisplayMoney (kotwica równowartości miesięcznej)", () => {
  it("PL: równowartość Plus (59000/12 = 49,17 zł) schodzi w dół do 49 zł, bez ułamka", () => {
    const out = formatApproxDisplayMoney(4917, "PLN", "pl");
    expect(out).toContain("49");
    expect(out).not.toContain("50");
    // Bez części groszowej (żadnego separatora dziesiętnego).
    expect(out).not.toMatch(/[.,]\d/);
  });

  it("PL: równowartość Pro (129000/12 = 107,50 zł) schodzi w dół do 107 zł", () => {
    const out = formatApproxDisplayMoney(10750, "PLN", "pl");
    expect(out).toContain("107");
    expect(out).not.toMatch(/[.,]\d/);
  });

  it("EN: konwersja do EUR (parytet 1 EUR = 2 PLN) i zaokrąglenie w dół", () => {
    // 4917 PLN/mies -> 2459 EUR gr -> floor 2400 -> €24, bez ułamka.
    const out = formatApproxDisplayMoney(4917, "PLN", "en");
    expect(out).toContain("24");
    expect(out).not.toMatch(/[.,]\d/);
  });

  it("nigdy nie zawyża: kwota z groszami zawsze schodzi w dół do pełnej jednostki", () => {
    // 4999 gr (49,99) -> 49, nie 50.
    const out = formatApproxDisplayMoney(4999, "PLN", "pl");
    expect(out).toContain("49");
    expect(out).not.toContain("50");
  });
});

describe("formatMoneyWhole", () => {
  it("formatuje bez części ułamkowej", () => {
    expect(formatMoneyWhole(4900, "PLN", "pl")).not.toMatch(/[.,]\d/);
    expect(formatMoneyWhole(4900, "PLN", "pl")).toContain("49");
  });
});
