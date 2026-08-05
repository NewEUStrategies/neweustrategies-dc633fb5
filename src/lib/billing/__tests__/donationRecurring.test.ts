import { beforeEach, describe, expect, it, vi } from "vitest";

const syncDonationSubscription = vi.fn(async () => undefined);
const recordRecurringDonationPayment = vi.fn(async () => "renewed" as const);

vi.mock("@/lib/billing/donations.server", () => ({
  syncDonationSubscription,
  recordRecurringDonationPayment,
}));

import { normalizeStripeEvent } from "@/lib/billing/stripeEvents.server";
import { dispatchWebhookEvent } from "@/lib/billing/webhookDispatch.server";
import type { VerifiedWebhookEvent } from "@/lib/stripe.server";

function event(type: string, object: Record<string, unknown>): VerifiedWebhookEvent {
  return { id: `evt_${type}`, type, data: { object } } as unknown as VerifiedWebhookEvent;
}

describe("darowizny cykliczne w webhooku Stripe", () => {
  beforeEach(() => {
    syncDonationSubscription.mockClear();
    recordRecurringDonationPayment.mockClear();
  });

  it("przenosi metadane darowizny z subskrypcji na fakturę odnowienia", () => {
    const normalized = normalizeStripeEvent(
      event("invoice.paid", {
        id: "in_123",
        currency: "eur",
        amount_paid: 2500,
        metadata: {},
        parent: {
          subscription_details: {
            subscription: "sub_donation",
            metadata: { purpose: "donation", donationId: "don-1" },
          },
        },
        lines: { data: [{ period: { end: 1800000000 } }] },
        status_transitions: { paid_at: 1790000000 },
      }),
    );

    expect(normalized).not.toBeNull();
    const data = normalized?.data as {
      subscriptionId: string | null;
      customData: Record<string, unknown> | null;
    };
    expect(data.subscriptionId).toBe("sub_donation");
    expect(data.customData).toMatchObject({ purpose: "donation", donationId: "don-1" });
  });

  it("księguje odnowienie darowizny zamiast logiki planu", async () => {
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.completed",
      environment: "sandbox",
      occurredAt: new Date().toISOString(),
      data: {
        id: "in_123",
        subscriptionId: "sub_donation",
        currencyCode: "EUR",
        customData: { purpose: "donation", donationId: "don-1" },
        customer: { email: "donor@example.com" },
        details: { totals: { grandTotal: "2500" } },
      },
    });

    expect(outcome).toBe("processed");
    expect(recordRecurringDonationPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        donationId: "don-1",
        subscriptionId: "sub_donation",
        invoiceId: "in_123",
        amountCents: 2500,
        currency: "EUR",
      }),
    );
  });

  it("nie traktuje subskrypcji darowizny jak planu dostępu", async () => {
    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.canceled",
      environment: "sandbox",
      occurredAt: new Date().toISOString(),
      data: {
        id: "sub_donation",
        customerId: "cus_1",
        status: "canceled",
        customData: { purpose: "donation", donationId: "don-1" },
        items: [],
      },
    });

    expect(outcome).toBe("processed");
    expect(syncDonationSubscription).toHaveBeenCalledWith({
      subscriptionId: "sub_donation",
      donationId: "don-1",
      status: "canceled",
    });
  });
});
