// @vitest-environment node
// Przeliczenie kwoty do waluty prezentacji - `convertToDisplayCurrency`.
//
// RYZYKO. Ta sama funkcja liczy kwotę na /pricing, w koszyku i na przycisku
// „Zapłać" w /checkout, więc błąd kierunku kursu albo przeliczenie waluty,
// której kurs NIE dotyczy, to kupujący widzący inną cenę niż ta, którą
// rozliczy operator. Pinujemy:
//   * kierunek EUR -> PLN (mnożenie przez kurs, nie dzielenie),
//   * tożsamość, gdy waluty się zgadzają - bez względu na wielkość liter,
//   * walutę spoza pary PLN/EUR: kurs EUR/PLN jej NIE dotyczy, więc kwota
//     zostaje w walucie źródłowej (pokazanie USD przeliczonego po kursie
//     EUR byłoby kwotą zmyśloną).
//
// Środowisko `node`: w przeglądarce `fxRate.ts` przy imporcie strzela do NBP,
// a test ma być bez sieci. Kurs pinujemy jawnie (1 EUR = 4 PLN).
import { beforeAll, describe, expect, it } from "vitest";

import { convertToDisplayCurrency, formatDisplayMoney } from "@/lib/billing/displayCurrency";
import { setEurPlnRateForTests } from "@/lib/billing/fxRate";
import { formatMoney } from "@/lib/billing/types";

beforeAll(() => setEurPlnRateForTests(4));

describe("convertToDisplayCurrency", () => {
  it("EUR -> PLN mnoży przez kurs NBP i zaokrągla do grosza", () => {
    expect(convertToDisplayCurrency(2475, "EUR", "PLN")).toEqual({ cents: 9900, currency: "PLN" });
    // 12,34 EUR * 4 = 49,36 PLN - bez dryfu zmiennoprzecinkowego.
    expect(convertToDisplayCurrency(1234, "EUR", "PLN")).toEqual({ cents: 4936, currency: "PLN" });
  });

  it("PLN -> EUR dzieli przez kurs (para odwrotna do EUR -> PLN)", () => {
    expect(convertToDisplayCurrency(9900, "PLN", "EUR")).toEqual({ cents: 2475, currency: "EUR" });
  });

  it("waluta z bazy małymi literami jest tą samą walutą, a nie walutą obcą", () => {
    expect(convertToDisplayCurrency(9900, "pln", "PLN")).toEqual({ cents: 9900, currency: "PLN" });
    expect(convertToDisplayCurrency(2475, "eur", "PLN")).toEqual({ cents: 9900, currency: "PLN" });
  });

  it.each(["PLN", "EUR"] as const)(
    "waluta spoza pary PLN/EUR nie jest przeliczana po kursie EUR/PLN (cel %s)",
    (target) => {
      expect(convertToDisplayCurrency(5000, "usd", target)).toEqual({
        cents: 5000,
        currency: "USD",
      });
    },
  );
});

describe("formatDisplayMoney", () => {
  it("po angielsku pokazuje plan w PLN jako kwotę w EUR", () => {
    expect(formatDisplayMoney(9900, "PLN", "en")).toBe(formatMoney(2475, "EUR", "en"));
  });

  it("po polsku pokazuje plan w EUR jako kwotę w PLN", () => {
    expect(formatDisplayMoney(2475, "EUR", "pl")).toBe(formatMoney(9900, "PLN", "pl"));
  });
});
