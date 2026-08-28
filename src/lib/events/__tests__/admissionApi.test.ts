// Wycena wstepu: odczyt odpowiedzi bazy, ktora ma DWA ksztalty (zgoda z cena
// i odmowa z powodem). Test pilnuje, ze odmowa nie udaje zgody z zerowa cena -
// to bylaby najgorsza z mozliwych pomylek tego ekranu.
import { describe, expect, it } from "vitest";

import {
  ADMISSION_QUOTE_REASONS,
  admissionQuoteMessageKey,
  parseAdmissionQuote,
} from "@/lib/events/admissionApi";

describe("parseAdmissionQuote", () => {
  it("reads a priced package quote", () => {
    const quote = parseAdmissionQuote({
      ok: true,
      kind: "package",
      event_id: "11111111-1111-1111-1111-111111111111",
      audience: "academic",
      seats: 10,
      currency: "PLN",
      price_cents: 250000,
      discount_cents: 25000,
      total_cents: 225000,
      coupon_code: "PARTNER2026",
      seats_left: 3,
    });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.kind).toBe("package");
    expect(quote.seats).toBe(10);
    expect(quote.totalCents).toBe(225000);
    expect(quote.couponCode).toBe("PARTNER2026");
    expect(quote.seatsLeft).toBe(3);
  });

  it("treats a missing seat limit as no limit, not as zero", () => {
    const quote = parseAdmissionQuote({ ok: true, kind: "ticket", seats_left: null });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.seatsLeft).toBeNull();
    expect(quote.currency).toBe("PLN");
  });

  it("keeps a refusal a refusal and carries its numbers", () => {
    const quote = parseAdmissionQuote({
      ok: false,
      reason: "per_person_limit",
      max_per_person: 2,
      owned: 2,
    });
    expect(quote.ok).toBe(false);
    if (quote.ok) return;
    expect(quote.reason).toBe("per_person_limit");
    expect(quote.detail.max_per_person).toBe(2);
  });

  it("falls back to an unknown reason instead of inventing one", () => {
    const quote = parseAdmissionQuote({ ok: false, reason: "moon_phase" });
    expect(quote.ok).toBe(false);
    if (quote.ok) return;
    expect(quote.reason).toBe("unknown");
  });

  it("treats a null response as a refusal", () => {
    expect(parseAdmissionQuote(null).ok).toBe(false);
  });
});

describe("admissionQuoteMessageKey", () => {
  it("keeps every known reason inside one namespace", () => {
    for (const reason of ADMISSION_QUOTE_REASONS) {
      expect(admissionQuoteMessageKey(reason)).toBe(`eventPackages.quoteReasons.${reason}`);
    }
    expect(admissionQuoteMessageKey("unknown")).toBe("eventPackages.quoteReasons.unknown");
  });
});
