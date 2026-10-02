// Etykieta rabatu kuponu B2B - `formatDiscountLabel` (coupons.ts).
//
// RYZYKO. Etykieta stoi obok kodu w polu kuponu na /checkout i w panelu
// kuponów - to jest zdanie o pieniądzach, które kupujący czyta przed
// zapłatą. Nie może pokazać kwoty w złej walucie, nie może pokazać
// „-NaN" ani „-null%", gdy baza nie podała wartości rabatu, i nie może
// pomylić rabatu procentowego z kwotowym.
//
// Asercje kwot idą przez `moneyPattern` (cyfry z dowolnym separatorem), bo
// odstęp przed symbolem waluty zależy od wersji ICU - test dowodzi źródła
// kwoty i waluty, a nie odtwarza formatowania `Intl`.
import { describe, expect, it } from "vitest";

import { formatDiscountLabel } from "@/lib/billing/coupons";
import { moneyPattern } from "@/test/billing/fixtures";

describe("formatDiscountLabel - rabat kwotowy", () => {
  it("pokazuje kwotę rabatu w walucie kuponu ze znakiem minus", () => {
    const label = formatDiscountLabel("fixed", null, 5000, "PLN", "pl");

    expect(label.startsWith("-")).toBe(true);
    expect(label).toMatch(moneyPattern(5000));
    expect(label).toContain("zł");
  });

  it("waluta z bazy małymi literami jest normalizowana (eur -> EUR)", () => {
    const label = formatDiscountLabel("fixed", null, 1250, "eur", "en");

    expect(label).toMatch(moneyPattern(1250));
    expect(label).toContain("€");
  });

  it("kupon kwotowy bez waluty liczy się w PLN, walucie domyślnej serwisu", () => {
    const label = formatDiscountLabel("fixed", null, 2000, null, "pl");

    expect(label).toMatch(moneyPattern(2000));
    expect(label).toContain("zł");
  });

  it("kupon kwotowy bez kwoty nie udaje rabatu („-NaN”)", () => {
    expect(formatDiscountLabel("fixed", null, null, "PLN", "pl")).toBe("");
  });
});

describe("formatDiscountLabel - rabat procentowy i brak rodzaju", () => {
  it("rabat procentowy pokazuje sam procent, bez waluty", () => {
    expect(formatDiscountLabel("percent", 15, 4990, "PLN", "pl")).toBe("-15%");
  });

  it("procent bez wartości nie staje się etykietą „-null%” ani kwotą", () => {
    expect(formatDiscountLabel("percent", null, 4990, "PLN", "pl")).toBe("");
  });

  it("brak rodzaju rabatu (odmowa walidatora) daje pustą etykietę", () => {
    expect(formatDiscountLabel(null, 10, 1000, "PLN", "pl")).toBe("");
  });
});
