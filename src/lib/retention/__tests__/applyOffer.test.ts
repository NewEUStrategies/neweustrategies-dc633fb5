// Oferta retencyjna u operatora (S2, P02): test z ATRAPĄ operatora -
// parametry kuponu, klucze idempotencji i zachowanie istniejących rabatów.
//
// Dlaczego to ważne: dawny kupon B2B był niewykonalny (kasa blokuje żywą
// subskrypcję). Rabat musi trafić NA subskrypcję (`discounts`), jako
// `repeating` na tyle miesięcy, ile faktur obiecał dialog, i nie może
// zdjąć rabatu, który klient już ma. Klucze idempotencji z id przepływu
// sprawiają, że dwuklik nie daje dwóch rabatów.
import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import {
  applyRetentionOffer,
  retentionDurationInMonths,
  retentionIdempotencyKeys,
  type RetentionStripeClient,
} from "@/lib/retention/applyOffer.server";

const FLOW_ID = "55555555-5555-4555-8555-555555555555";

function stripeSub(over: Partial<Record<string, unknown>> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    status: "active",
    discounts: ["di_existing"],
    items: { data: [{ price: { recurring: { interval: "month", interval_count: 1 } } }] },
    ...over,
  } as unknown as Stripe.Subscription;
}

function fakeStripe(sub: Stripe.Subscription = stripeSub()) {
  const client = {
    subscriptions: {
      retrieve: vi.fn(async () => sub),
      update: vi.fn(async () => sub),
    },
    coupons: {
      create: vi.fn(async () => ({ id: "coupon_ret_1" }) as Stripe.Coupon),
    },
  };
  return client as typeof client & RetentionStripeClient;
}

const INPUT = {
  providerSubscriptionId: "sub_1",
  feedbackId: FLOW_ID,
  terms: { discountPct: 30, discountPeriods: 3 },
};

describe("applyRetentionOffer - parametry i klucze idempotencji", () => {
  it("kupon `repeating` na 3 miesiące (plan miesięczny), 1 użycie, klucz z id przepływu", async () => {
    const stripe = fakeStripe();
    const res = await applyRetentionOffer(stripe, INPUT);

    expect(res).toEqual({ ok: true, couponId: "coupon_ret_1", durationInMonths: 3 });
    expect(stripe.coupons.create).toHaveBeenCalledWith(
      expect.objectContaining({
        percent_off: 30,
        duration: "repeating",
        duration_in_months: 3,
        max_redemptions: 1,
        metadata: expect.objectContaining({ source: "retention", feedback_id: FLOW_ID }),
      }),
      { idempotencyKey: `retention-coupon:${FLOW_ID}` },
    );
  });

  it("dopina kupon do subskrypcji, ZACHOWUJĄC istniejące rabaty, kluczem `retention:{id}`", async () => {
    const stripe = fakeStripe();
    await applyRetentionOffer(stripe, INPUT);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_1",
      { discounts: [{ discount: "di_existing" }, { coupon: "coupon_ret_1" }] },
      { idempotencyKey: `retention:${FLOW_ID}` },
    );
    expect(retentionIdempotencyKeys(FLOW_ID)).toEqual({
      coupon: `retention-coupon:${FLOW_ID}`,
      subscription: `retention:${FLOW_ID}`,
    });
  });

  it("rozwinięte obiekty rabatów też są zachowane", async () => {
    const stripe = fakeStripe(stripeSub({ discounts: [{ id: "di_a" }, "di_b"] }));
    await applyRetentionOffer(stripe, INPUT);
    expect(stripe.subscriptions.update.mock.calls[0]![1]).toEqual({
      discounts: [{ discount: "di_a" }, { discount: "di_b" }, { coupon: "coupon_ret_1" }],
    });
  });

  it("ponowienie z tym samym przepływem = te same klucze (operator odda zapamiętaną odpowiedź)", async () => {
    const stripe = fakeStripe();
    await applyRetentionOffer(stripe, INPUT);
    await applyRetentionOffer(stripe, INPUT);
    const keys = stripe.coupons.create.mock.calls.map((c) => (c as unknown[])[1]);
    expect(keys[0]).toEqual(keys[1]);
  });

  it("subskrypcja anulowana: bez kuponu i bez zmian", async () => {
    const stripe = fakeStripe(stripeSub({ status: "canceled" }));
    await expect(applyRetentionOffer(stripe, INPUT)).resolves.toEqual({
      ok: false,
      error: "subscription_not_active",
    });
    expect(stripe.coupons.create).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("odmowa operatora wraca jako wynik, nie wyjątek", async () => {
    const stripe = fakeStripe();
    stripe.subscriptions.update.mockRejectedValueOnce(new Error("No such coupon"));
    await expect(applyRetentionOffer(stripe, INPUT)).resolves.toMatchObject({
      ok: false,
      error: "provider_error",
      message: "No such coupon",
    });
  });
});

describe("retentionDurationInMonths - N faktur, nie N miesięcy", () => {
  it.each([
    [3, { interval: "month", intervalCount: 1 }, 3],
    [3, { interval: "month", intervalCount: 3 }, 9],
    [2, { interval: "year", intervalCount: 1 }, 24],
    [4, { interval: "week", intervalCount: 2 }, 2],
    [1, { interval: "week", intervalCount: 1 }, 1],
    [3, null, 3],
  ] as const)("%i okres(y) cyklu %j -> %i mies.", (periods, cycle, months) => {
    expect(retentionDurationInMonths(periods, cycle)).toBe(months);
  });

  it("plan roczny z 3 okresami dostaje 36 miesięcy (3 faktury roczne)", async () => {
    const stripe = fakeStripe(
      stripeSub({
        items: { data: [{ price: { recurring: { interval: "year", interval_count: 1 } } }] },
      }),
    );
    await applyRetentionOffer(stripe, INPUT);
    expect(stripe.coupons.create.mock.calls[0]![0]).toMatchObject({ duration_in_months: 36 });
  });
});
