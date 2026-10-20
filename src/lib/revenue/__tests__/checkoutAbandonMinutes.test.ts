// Okno porzucenia kasy - JEDEN predykat dla formularza panelu i serwera kasy
// (I9a). Granice = CHECK `checkout_settings.abandon_after_minutes` (parytet
// liczb z migracją pilnuje `revenueLimitsParity.test.ts`).
import { describe, expect, it } from "vitest";

import { abandonAfterMinutes } from "@/lib/billing/checkoutSettings.server";
import {
  REVENUE_LIMITS,
  isCheckoutAbandonMinutes,
  parseCheckoutAbandonMinutes,
} from "@/lib/revenue/limits";

describe("isCheckoutAbandonMinutes / parseCheckoutAbandonMinutes", () => {
  it("granice 30 i 1440 są poprawne, domyślne mieści się w zakresie", () => {
    expect(isCheckoutAbandonMinutes(REVENUE_LIMITS.checkoutAbandonMinutesMin)).toBe(true);
    expect(isCheckoutAbandonMinutes(REVENUE_LIMITS.checkoutAbandonMinutesMax)).toBe(true);
    expect(isCheckoutAbandonMinutes(REVENUE_LIMITS.checkoutAbandonMinutesDefault)).toBe(true);
  });

  it.each([29, 1441, 0, -30, 90.5, Number.NaN, "90", null, undefined])(
    "%j jest odrzucane",
    (raw) => {
      expect(isCheckoutAbandonMinutes(raw)).toBe(false);
    },
  );

  it.each([
    ["45", 45],
    [" 120 ", 120],
    ["30", 30],
    ["1440", 1440],
  ])("napis %j → %d", (text, minutes) => {
    expect(parseCheckoutAbandonMinutes(text)).toBe(minutes);
  });

  it.each(["", "20", "1441", "90.5", "1e3", "-30", "abc", "45min", "99999"])(
    "napis %j jest odrzucany, nie przycinany",
    (text) => {
      expect(parseCheckoutAbandonMinutes(text)).toBeNull();
    },
  );

  it("serwer kasy używa tego samego predykatu (spoza zakresu = okno domyślne operatora)", () => {
    for (const raw of [29, 30, 90, 1440, 1441, 90.5, "90", null]) {
      expect(abandonAfterMinutes(raw), String(raw)).toBe(
        isCheckoutAbandonMinutes(raw) ? raw : null,
      );
    }
  });
});
