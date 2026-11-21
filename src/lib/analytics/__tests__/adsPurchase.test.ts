import { beforeEach, describe, expect, it, vi } from "vitest";

const consent = vi.hoisted(() => ({ marketing: true }));
const sent = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown>]> }));
vi.mock("@/lib/ads/consent", () => ({
  hasCategoryConsent: (cat: string) => (cat === "marketing" ? consent.marketing : true),
}));
vi.mock("../conversions", () => ({
  adsConversion: (label: string, params: Record<string, unknown>) => {
    sent.calls.push([label, params]);
  },
}));

import { ADS_PURCHASE_LABEL, trackAdsPurchase } from "../adsPurchase";

describe("trackAdsPurchase", () => {
  beforeEach(() => {
    consent.marketing = true;
    sent.calls = [];
  });

  it("reports the confirmed amount, currency and transaction to the purchase action", () => {
    expect(trackAdsPurchase({ transactionId: "purchase_order-1", value: 80, currency: "pln" })).toBe(true);
    expect(sent.calls).toEqual([
      [ADS_PURCHASE_LABEL, { value: 80, currency: "PLN", transaction_id: "purchase_order-1" }],
    ]);
  });

  it("targets the account's purchase label", () => {
    expect(ADS_PURCHASE_LABEL).toBe("n02PCIG0wLwdEMD6kM5B");
  });

  it("sends nothing without marketing consent", () => {
    consent.marketing = false;
    expect(trackAdsPurchase({ transactionId: "t1", value: 10, currency: "PLN" })).toBe(false);
    expect(sent.calls).toHaveLength(0);
  });

  it("sends nothing for zero-value payments such as free trials", () => {
    expect(trackAdsPurchase({ transactionId: "t1", value: 0, currency: "PLN" })).toBe(false);
    expect(sent.calls).toHaveLength(0);
  });
});
