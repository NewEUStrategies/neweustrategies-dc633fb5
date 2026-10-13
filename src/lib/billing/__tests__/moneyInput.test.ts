// Kwota w polu panelu w ZŁOTYCH (TIX-14a): „899,00" to 89 900 groszy, a nie
// 899 groszy. Ten plik dowodzi konwersji w obie strony, odmowy zapisów
// niejednoznacznych i braku błędów zaokrąglenia zmiennoprzecinkowego.
import { describe, expect, it } from "vitest";

import { centsToMoneyInput, parseMoneyInput } from "@/lib/billing/moneyInput";

describe("parseMoneyInput - złote z pola -> grosze", () => {
  it("„899,00” i „899” to 899 zł, nie 8,99 zł", () => {
    expect(parseMoneyInput("899,00")).toBe(89900);
    expect(parseMoneyInput("899")).toBe(89900);
    expect(parseMoneyInput("899.00")).toBe(89900);
  });

  it("jedno miejsce po separatorze to dziesiątki groszy", () => {
    expect(parseMoneyInput("12,5")).toBe(1250);
    expect(parseMoneyInput("0.5")).toBe(50);
    expect(parseMoneyInput("0,05")).toBe(5);
  });

  it("bez błędu zmiennoprzecinkowego (0,29 × 100 ≠ 28,999…)", () => {
    expect(parseMoneyInput("0,29")).toBe(29);
    expect(parseMoneyInput("1,15")).toBe(115);
    expect(parseMoneyInput("4,35")).toBe(435);
  });

  it("spacje (także twarde) grupują tysiące", () => {
    expect(parseMoneyInput("1 299,00")).toBe(129900);
    expect(parseMoneyInput("1\u00a0299,00")).toBe(129900);
    expect(parseMoneyInput("1\u202f299")).toBe(129900);
    expect(parseMoneyInput("  25  ")).toBe(2500);
  });

  it("grupowanie kropką lub przecinkiem tylko z drugim separatorem dziesiętnym", () => {
    expect(parseMoneyInput("1.299,00")).toBe(129900);
    expect(parseMoneyInput("1,299.00")).toBe(129900);
    expect(parseMoneyInput("12.345.678,90")).toBe(1234567890);
  });

  it("zapis niejednoznaczny albo błędny to odmowa, nie zgadywanie", () => {
    for (const value of [
      "",
      "   ",
      "1,299",
      "1.299",
      "8,999",
      "-5",
      "12zł",
      "abc",
      "1,2,3",
      ",50",
    ]) {
      expect(parseMoneyInput(value), JSON.stringify(value)).toBeNull();
    }
  });
});

describe("centsToMoneyInput - grosze z bazy -> pole w złotych", () => {
  it("89 900 groszy to „899,00”", () => {
    expect(centsToMoneyInput(89900)).toBe("899,00");
    expect(centsToMoneyInput(5)).toBe("0,05");
    expect(centsToMoneyInput(0)).toBe("0,00");
  });

  it("separator kropki na życzenie", () => {
    expect(centsToMoneyInput(129950, ".")).toBe("1299.50");
  });

  it("brak kwoty to puste pole", () => {
    expect(centsToMoneyInput(null)).toBe("");
    expect(centsToMoneyInput(undefined)).toBe("");
    expect(centsToMoneyInput(Number.NaN)).toBe("");
  });

  it("w obie strony bez straty: pole -> grosze -> pole", () => {
    for (const cents of [0, 1, 50, 99, 100, 89900, 129950, 1234567890]) {
      expect(parseMoneyInput(centsToMoneyInput(cents))).toBe(cents);
    }
  });
});
