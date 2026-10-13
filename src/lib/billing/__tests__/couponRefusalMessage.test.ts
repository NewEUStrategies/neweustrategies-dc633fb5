// Odmowa kodu na bilet -> zdanie dla kupującego, w obu językach (TIX-13a).
import { describe, expect, it } from "vitest";

import { readKey } from "@/lib/ci/i18nParity";
import { couponRefusalMessageKey } from "@/lib/billing/couponRefusalMessage";
import { eventRegistrationEn, eventRegistrationPl } from "@/lib/i18n-event-registration";

describe("couponRefusalMessageKey", () => {
  it("reguła kumulacji i minimum operatora mają własne zdania", () => {
    expect(couponRefusalMessageKey("coupon_not_combinable")).toBe(
      "eventRegistration.payment.promoNotCombinable",
    );
    expect(couponRefusalMessageKey("final_amount_too_low")).toBe(
      "eventRegistration.payment.promoTooLow",
    );
  });

  it("pozostałe odmowy i brak powodu mówią zdaniem ogólnym", () => {
    for (const error of ["not_found", "expired", "limit_reached", "", null, undefined]) {
      expect(couponRefusalMessageKey(error)).toBe("eventRegistration.payment.promoError");
    }
  });

  it("każde zdanie stoi w słowniku polskim i angielskim", () => {
    for (const error of ["coupon_not_combinable", "final_amount_too_low", "not_found"]) {
      const key = couponRefusalMessageKey(error);
      for (const bundle of [eventRegistrationPl, eventRegistrationEn]) {
        const text = readKey(bundle, key);
        expect(typeof text === "string" && text.trim() !== "", `${key}`).toBe(true);
      }
    }
  });
});
