// Walidacja wejścia darowizny: przedział kwoty, całkowitość, długość noty.
import { describe, it, expect } from "vitest";
import {
  donationInputSchema,
  DONATION_MIN_CENTS,
  DONATION_MAX_CENTS,
  DONATION_PRESETS_CENTS,
} from "@/lib/billing/donations.schema";

describe("donationInputSchema", () => {
  it("akceptuje poprawną darowiznę (preset i granice przedziału)", () => {
    for (const cents of [...DONATION_PRESETS_CENTS, DONATION_MIN_CENTS, DONATION_MAX_CENTS]) {
      const parsed = donationInputSchema.safeParse({ amount_cents: cents, lang: "pl" });
      expect(parsed.success).toBe(true);
    }
  });

  it("odrzuca kwoty poza przedziałem", () => {
    expect(
      donationInputSchema.safeParse({ amount_cents: DONATION_MIN_CENTS - 1, lang: "pl" }).success,
    ).toBe(false);
    expect(
      donationInputSchema.safeParse({ amount_cents: DONATION_MAX_CENTS + 1, lang: "en" }).success,
    ).toBe(false);
    expect(donationInputSchema.safeParse({ amount_cents: -100, lang: "pl" }).success).toBe(false);
  });

  it("odrzuca kwoty niecałkowite (grosze to integer)", () => {
    expect(donationInputSchema.safeParse({ amount_cents: 2000.5, lang: "pl" }).success).toBe(false);
  });

  it("przycina i limituje notę do 500 znaków", () => {
    const ok = donationInputSchema.safeParse({
      amount_cents: 2000,
      lang: "en",
      message: "  dziękuję  ",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.message).toBe("dziękuję");
    const tooLong = donationInputSchema.safeParse({
      amount_cents: 2000,
      lang: "en",
      message: "x".repeat(501),
    });
    expect(tooLong.success).toBe(false);
  });

  it("wymaga znanego języka", () => {
    expect(donationInputSchema.safeParse({ amount_cents: 2000, lang: "de" }).success).toBe(false);
  });

  it("presety mieszczą się w dozwolonym przedziale", () => {
    for (const cents of DONATION_PRESETS_CENTS) {
      expect(cents).toBeGreaterThanOrEqual(DONATION_MIN_CENTS);
      expect(cents).toBeLessThanOrEqual(DONATION_MAX_CENTS);
    }
  });
});
