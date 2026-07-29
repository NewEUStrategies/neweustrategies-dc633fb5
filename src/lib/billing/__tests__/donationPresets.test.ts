import { describe, expect, it } from "vitest";
import {
  DONATION_PRESET_LIMIT,
  defaultDonationPresets,
  parseCustomAmountCents,
  parseDonationPresets,
} from "@/lib/billing/donationPresets";

describe("parseDonationPresets", () => {
  it("zamienia zapis redaktora na grosze", () => {
    expect(parseDonationPresets("20, 50, 100, 250", "PLN")).toEqual([2000, 5000, 10000, 25000]);
    expect(parseDonationPresets("10;25 50", "EUR")).toEqual([1000, 2500, 5000]);
    // Przecinek jest separatorem listy - część dziesiętna zapisywana kropką.
    expect(parseDonationPresets("12.50", "PLN")).toEqual([1250]);
  });

  it("odrzuca kwoty spoza zakresu, duplikaty i nadmiar", () => {
    expect(parseDonationPresets("1, 20, 20, 99999999", "PLN")).toEqual([2000]);
    expect(parseDonationPresets("10,20,30,40,50,60,70,80", "PLN")).toHaveLength(
      DONATION_PRESET_LIMIT,
    );
  });

  it("wraca do domyślnych kwot dla pustego lub błędnego wpisu", () => {
    expect(parseDonationPresets("", "PLN")).toEqual(defaultDonationPresets("PLN"));
    expect(parseDonationPresets("abc", "EUR")).toEqual(defaultDonationPresets("EUR"));
    expect(parseDonationPresets(undefined, "PLN")).toEqual(defaultDonationPresets("PLN"));
  });
});

describe("parseCustomAmountCents", () => {
  it("przyjmuje kwoty w zakresie i przecinek dziesiętny", () => {
    expect(parseCustomAmountCents("75")).toBe(7500);
    expect(parseCustomAmountCents("12,50")).toBe(1250);
  });

  it("odrzuca puste, za małe i za duże kwoty", () => {
    expect(parseCustomAmountCents("")).toBeNull();
    expect(parseCustomAmountCents("1")).toBeNull();
    expect(parseCustomAmountCents("99999999")).toBeNull();
    expect(parseCustomAmountCents("abc")).toBeNull();
  });
});
