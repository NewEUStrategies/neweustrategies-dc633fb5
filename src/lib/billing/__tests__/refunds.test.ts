import { describe, expect, it } from "vitest";
import {
  isDisputeReversed,
  isRevokingAdjustment,
  type RefundEvent,
} from "@/lib/billing/refunds.server";

const base: RefundEvent = {
  adjustmentId: "adj_1",
  transactionId: "txn_1",
  subscriptionId: null,
  action: "refund",
  status: "approved",
  amountCents: 24900,
  currency: "PLN",
  environment: "sandbox",
};

describe("isRevokingAdjustment", () => {
  it("odbiera dostęp dla zatwierdzonego zwrotu", () => {
    expect(isRevokingAdjustment(base)).toBe(true);
  });

  it("odbiera dostęp dla obciążenia zwrotnego", () => {
    expect(isRevokingAdjustment({ ...base, action: "chargeback" })).toBe(true);
  });

  it("czeka z odebraniem dostępu na zatwierdzenie zwrotu", () => {
    expect(isRevokingAdjustment({ ...base, status: "pending_approval" })).toBe(false);
  });

  it("ignoruje odrzucone i cofnięte korekty", () => {
    expect(isRevokingAdjustment({ ...base, status: "rejected" })).toBe(false);
    expect(isRevokingAdjustment({ ...base, status: "reversed" })).toBe(false);
  });

  it("odbiera dostęp od chwili otwarcia sporu, ale nie przy kredycie", () => {
    // Otwarty spór = bank już wycofał środki, dostęp musi zniknąć od razu.
    expect(isRevokingAdjustment({ ...base, action: "chargeback_warning" })).toBe(true);
    expect(
      isRevokingAdjustment({ ...base, action: "chargeback_warning", status: "pending_approval" }),
    ).toBe(true);
    expect(isRevokingAdjustment({ ...base, action: "credit" })).toBe(false);
  });

  it("nie odbiera dostępu przy sporze cofniętym lub odrzuconym", () => {
    expect(
      isRevokingAdjustment({ ...base, action: "chargeback_warning", status: "reversed" }),
    ).toBe(false);
    expect(
      isRevokingAdjustment({ ...base, action: "chargeback_warning", status: "rejected" }),
    ).toBe(false);
  });
});

describe("isDisputeReversed", () => {
  const base: RefundEvent = {
    adjustmentId: "adj_1",
    transactionId: "txn_1",
    subscriptionId: null,
    action: "chargeback",
    status: "reversed",
    amountCents: 1000,
    currency: "PLN",
    environment: "sandbox",
  };

  it("rozpoznaje wygrany spór", () => {
    expect(isDisputeReversed(base)).toBe(true);
    expect(isDisputeReversed({ ...base, action: "chargeback_warning" })).toBe(true);
  });

  it("nie myli zwrotu ze sporem", () => {
    expect(isDisputeReversed({ ...base, action: "refund" })).toBe(false);
    expect(isDisputeReversed({ ...base, status: "approved" })).toBe(false);
  });
});
