import { describe, expect, it } from "vitest";
import {
  canResumeStripeSubscription,
  isStripeSubscriptionActive,
  type StripeSubscriptionRow,
} from "../subscriptionQueries";

const base: StripeSubscriptionRow = {
  id: "1",
  provider_subscription_id: "sub_1",
  provider_customer_id: "ctm_1",
  product_id: "plan_pro",
  price_id: "pro_monthly",
  status: "active",
  quantity: 1,
  current_period_start: new Date(Date.now() - 86_400_000).toISOString(),
  current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
  cancel_at_period_end: false,
  environment: "sandbox",
  created_at: new Date().toISOString(),
};

const past = new Date(Date.now() - 86_400_000).toISOString();

describe("stripeSubscription", () => {
  it("traktuje aktywną subskrypcję w okresie jako dającą dostęp", () => {
    expect(isStripeSubscriptionActive(base)).toBe(true);
  });

  it("utrzymuje dostęp po anulowaniu do końca opłaconego okresu", () => {
    expect(isStripeSubscriptionActive({ ...base, status: "canceled" })).toBe(true);
    expect(
      isStripeSubscriptionActive({ ...base, status: "canceled", current_period_end: past }),
    ).toBe(false);
  });

  it("nie odbiera dostępu przy zaległej płatności (dunning)", () => {
    expect(isStripeSubscriptionActive({ ...base, status: "past_due" })).toBe(true);
  });

  it("pozwala wznowić tylko zaplanowane anulowanie w trwającym okresie", () => {
    expect(canResumeStripeSubscription({ ...base, cancel_at_period_end: true })).toBe(true);
    expect(canResumeStripeSubscription(base)).toBe(false);
    expect(
      canResumeStripeSubscription({
        ...base,
        cancel_at_period_end: true,
        current_period_end: past,
      }),
    ).toBe(false);
  });

  it("zwraca brak dostępu dla pustego wiersza", () => {
    expect(isStripeSubscriptionActive(null)).toBe(false);
  });
});
