import { beforeEach, describe, expect, it, vi } from "vitest";

const syncDonationSubscription = vi.fn(async () => undefined);
const linkDonationSubscription = vi.fn(async () => undefined);
const recordRecurringDonationPayment = vi.fn(async () => "renewed" as const);

vi.mock("@/lib/billing/donations.server", () => ({
  syncDonationSubscription,
  linkDonationSubscription,
  recordRecurringDonationPayment,
}));
// Dokument rozliczeniowy to osobny rejestr - poza zakresem tego pliku.
vi.mock("@/lib/billing/billingDocuments.server", () => ({
  documentInputFromTransaction: () => null,
  recordTransactionDocument: async () => "skipped",
}));

// Rejestr dokumentow nie jest przedmiotem tego testu: od audytu INV-04
// nieudany zapis dokumentu konczy zdarzenie bledem (ponowienie Stripe), a ta
// atrapa bazy go nie planuje.
vi.mock("@/lib/billing/billingDocuments.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/billingDocuments.server")>()),
  recordTransactionDocument: async () => "created" as const,
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
    linkDonationSubscription.mockClear();
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
    // Środowisko zdarzenia wiąże zapis (audyt SUB-10) - stąd czwarte pole.
    expect(syncDonationSubscription).toHaveBeenCalledWith({
      subscriptionId: "sub_donation",
      donationId: "don-1",
      status: "canceled",
      environment: "sandbox",
    });
  });

  it("sesja checkout w trybie subskrypcji WIĄŻE subskrypcję, ale NIE księguje raty (SUB-09)", async () => {
    // Tę samą pierwszą wpłatę opisze `invoice.paid`; księgowanie z obu
    // zdarzeń dawało dwa wiersze jednej wpłaty (klucze `cs_` i `in_`).
    const normalized = normalizeStripeEvent(
      event("checkout.session.completed", {
        id: "cs_test_donation",
        mode: "subscription",
        payment_status: "paid",
        subscription: "sub_donation",
        amount_total: 2500,
        currency: "eur",
        metadata: { purpose: "donation", donationId: "don-1" },
      }),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: normalized!.eventType,
      data: normalized!.data,
      environment: "live",
      occurredAt: new Date().toISOString(),
    });

    expect(outcome).toBe("processed");
    expect(recordRecurringDonationPayment).not.toHaveBeenCalled();
    expect(linkDonationSubscription).toHaveBeenCalledWith({
      donationId: "don-1",
      subscriptionId: "sub_donation",
      environment: "live",
    });
  });

  it("faktura księguje ratę w ŚRODOWISKU zdarzenia, z datą zapłaty operatora", async () => {
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

    await dispatchWebhookEvent({
      eventType: normalized!.eventType,
      data: normalized!.data,
      environment: "live",
      occurredAt: new Date().toISOString(),
    });

    expect(recordRecurringDonationPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "live",
        invoiceId: "in_123",
        paidAt: new Date(1790000000 * 1000).toISOString(),
      }),
    );
  });
});
