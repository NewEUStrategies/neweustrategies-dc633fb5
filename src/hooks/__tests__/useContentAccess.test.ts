// useContentAccess: kontrakty typów warstwy dostępu + formatMoney panelu
// admina paywalla (admin.paywall.tsx renderuje nim ceny planów i zamówień).
// W odróżnieniu od locale-aware formatMoney z lib/billing/types ten formatter
// jest ŚWIADOMIE przypięty do pl-PL - panel admina prezentuje pieniądze
// jednolicie niezależnie od języka interfejsu. Publiczny paywall przeszedł na
// wariant locale-aware; ta suita pilnuje, żeby wariant administracyjny nie
// zgubił groszy, waluty ani awaryjnej ścieżki dla nieznanego kodu.
import { describe, expect, it } from "vitest";
import { formatMoney } from "@/hooks/useContentAccess";

describe("formatMoney (panel admina paywalla)", () => {
  it("formatuje grosze jako kwotę pl-PL z symbolem waluty", () => {
    // \s w trybie unicode łapie twardą spację Intl - asercja nie zależy od
    // tego, którym wariantem spacji Node grupuje i odsuwa symbol.
    expect(formatMoney(1900, "PLN")).toMatch(/^19,00\szł$/u);
    expect(formatMoney(4900, "EUR")).toMatch(/^49,00\s€$/u);
  });

  it("grupuje tysiące i zachowuje grosze (kwoty zamówień, nie tylko ceny)", () => {
    expect(formatMoney(123456789, "PLN")).toMatch(/^1\s234\s567,89\szł$/u);
    expect(formatMoney(1, "PLN")).toMatch(/^0,01\szł$/u);
    expect(formatMoney(0, "PLN")).toMatch(/^0,00\szł$/u);
  });

  it("nieznany kod waluty degraduje się do czytelnego zapisu, nie wyjątku", () => {
    // Dane historyczne/testowe potrafią nieść niestandardowy kod - panel ma
    // pokazać kwotę, a nie wywrócić listę zamówień błędem RangeError z Intl.
    expect(formatMoney(1900, "not-a-code")).toBe("19.00 not-a-code");
  });
});
