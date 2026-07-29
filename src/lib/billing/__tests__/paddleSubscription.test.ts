import { describe, expect, it } from "vitest";
import {
  canResumePaddleSubscription,
  isPaddleSubscriptionActive,
  type PaddleSubscriptionRow,
} from "../paddleSubscription";

const base: PaddleSubscriptionRow = {
  id: "1",
  paddle_subscription_id: "sub_1",
  paddle_customer_id: "ctm_1",
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

describe("paddleSubscription", () => {
  it("traktuje aktywną subskrypcję w okresie jako dającą dostęp", () => {
    expect(isPaddleSubscriptionActive(base)).toBe(true);
  });

  it("utrzymuje dostęp po anulowaniu do końca opłaconego okresu", () => {
    expect(isPaddleSubscriptionActive({ ...base, status: "canceled" })).toBe(true);
    expect(
      isPaddleSubscriptionActive({ ...base, status: "canceled", current_period_end: past }),
    ).toBe(false);
  });

  it("nie odbiera dostępu przy zaległej płatności (dunning)", () => {
    expect(isPaddleSubscriptionActive({ ...base, status: "past_due" })).toBe(true);
  });

  it("pozwala wznowić tylko zaplanowane anulowanie w trwającym okresie", () => {
    expect(canResumePaddleSubscription({ ...base, cancel_at_period_end: true })).toBe(true);
    expect(canResumePaddleSubscription(base)).toBe(false);
    expect(
      canResumePaddleSubscription({
        ...base,
        cancel_at_period_end: true,
        current_period_end: past,
      }),
    ).toBe(false);
  });

  it("zwraca brak dostępu dla pustego wiersza", () => {
    expect(isPaddleSubscriptionActive(null)).toBe(false);
  });
});
