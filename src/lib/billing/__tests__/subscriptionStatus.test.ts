import { describe, expect, it } from "vitest";

import { deriveSubscriptionStatus } from "../subscriptionStatus";
import type { StripeSubscriptionRow } from "../subscriptionQueries";
import type { UserSubscriptionRow } from "../types";

const NOW = Date.parse("2026-03-01T00:00:00.000Z");
const FUTURE = "2026-04-01T00:00:00.000Z";
const PAST = "2026-02-01T00:00:00.000Z";

function provider(patch: Partial<StripeSubscriptionRow>): StripeSubscriptionRow {
  return {
    id: "row-1",
    provider_subscription_id: "sub_1",
    provider_customer_id: "cus_1",
    product_id: "prod_1",
    price_id: "price_1",
    status: "active",
    quantity: 1,
    current_period_start: PAST,
    current_period_end: FUTURE,
    cancel_at_period_end: false,
    environment: "sandbox",
    created_at: PAST,
    ...patch,
  };
}

function local(patch: Partial<UserSubscriptionRow> = {}): UserSubscriptionRow {
  return {
    id: "local-1",
    user_id: "user-1",
    plan_id: "plan-1",
    status: "active",
    started_at: PAST,
    current_period_end: FUTURE,
    canceled_at: null,
    ...patch,
  };
}

describe("deriveSubscriptionStatus", () => {
  it("marks an active subscription with the next renewal date", () => {
    const view = deriveSubscriptionStatus({ local: local(), provider: provider({}), now: NOW });
    expect(view.key).toBe("active");
    expect(view.renewsAt).toBe(FUTURE);
    expect(view.endsAt).toBeNull();
    expect(view.hasAccess).toBe(true);
  });

  it("shows a scheduled cancellation as an end date, not a renewal", () => {
    const view = deriveSubscriptionStatus({
      local: local(),
      provider: provider({ cancel_at_period_end: true }),
      now: NOW,
    });
    expect(view.key).toBe("cancelScheduled");
    expect(view.renewsAt).toBeNull();
    expect(view.endsAt).toBe(FUTURE);
    expect(view.hasAccess).toBe(true);
  });

  it("keeps trials and overdue payments distinct from plain active", () => {
    expect(
      deriveSubscriptionStatus({ local: null, provider: provider({ status: "trialing" }), now: NOW })
        .key,
    ).toBe("trialing");
    expect(
      deriveSubscriptionStatus({ local: null, provider: provider({ status: "past_due" }), now: NOW })
        .key,
    ).toBe("pastDue");
    expect(
      deriveSubscriptionStatus({ local: null, provider: provider({ status: "paused" }), now: NOW })
        .key,
    ).toBe("paused");
  });

  it("reports canceled subscriptions and revokes access after the period ends", () => {
    const view = deriveSubscriptionStatus({
      local: local({ status: "canceled" }),
      provider: provider({ status: "canceled", current_period_end: PAST }),
      now: NOW,
    });
    expect(view.key).toBe("canceled");
    expect(view.hasAccess).toBe(false);
  });

  it("falls back to the local row when the provider row is missing", () => {
    expect(deriveSubscriptionStatus({ local: null, provider: null, now: NOW }).key).toBe("none");
    expect(deriveSubscriptionStatus({ local: local(), provider: null, now: NOW }).key).toBe(
      "active",
    );
    expect(
      deriveSubscriptionStatus({ local: local({ canceled_at: PAST }), provider: null, now: NOW })
        .key,
    ).toBe("cancelScheduled");
  });
});
