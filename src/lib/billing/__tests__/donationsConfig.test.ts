// Bramka kwoty darowizny (`checkDonationAmount`) - ostatnia linia przed
// operatorem płatności.
//
// Endpoint kasy odrzuca nieliczbę już w walidatorze (`invalid_amount`), ale
// `checkDonationAmount` jest wspólną, czystą bramką: wołający, który ominie
// walidator, nie może dostać „poprawnej" kwoty z NaN. `Math.round(NaN)` to
// NaN, a oba porównania zakresu z NaN dają `false` - bez jawnego strażnika
// nieliczba przeszłaby jako kwota mieszcząca się w zakresie.
import { describe, expect, it } from "vitest";

import { DONATIONS_DEFAULTS, checkDonationAmount } from "@/lib/billing/donationsConfig";

describe("checkDonationAmount - nieliczba nie jest kwotą", () => {
  it.each([
    ["NaN", Number.NaN],
    ["nieskończoność", Number.POSITIVE_INFINITY],
    ["minus nieskończoność", Number.NEGATIVE_INFINITY],
  ])("%s to odmowa zakresu, a nie kwota do obciążenia", (_label, amount) => {
    expect(checkDonationAmount(DONATIONS_DEFAULTS, amount)).toEqual({
      ok: false,
      error: "amount_out_of_range",
    });
  });
});
