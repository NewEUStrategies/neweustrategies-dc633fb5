// Migawka ceny i rabatu w webhooku (S2, D-05): podstawa `provider` księgi MRR.
//
// Czego pilnuje:
//   1. kwota jednej sztuki i waluta idą z pozycji subskrypcji operatora
//      (cena schodkowa - brak kwoty, księga liczy wtedy z katalogu);
//   2. rabat nieznany (zdarzenie bez rozwiniętych rabatów) NIE nadpisuje
//      kolumn - ostatnia znana wartość zostaje;
//   3. rabat `once` nie obniża MRR, `percent_off` liczy się od ceny × ilość,
//      `forever` nie ma końca;
//   4. KAŻDA kolumna migawki istnieje w `types.ts` (`subscriptions`) -
//      PostgREST odrzuca zapis z nieznaną kolumną i webhook padałby w pętli.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { mapStripeSubscription, mapSubscriptionDiscount } from "@/lib/billing/stripeEvents.server";
import {
  subscriptionPriceSnapshot,
  type SubscriptionData,
} from "@/lib/billing/webhookDispatch.server";

function data(over: Partial<SubscriptionData> = {}): SubscriptionData {
  return {
    id: "sub_1",
    customerId: "cus_1",
    status: "active",
    items: [{ quantity: 2, price: { id: "price_1", unitAmount: 4900, currency: "pln" } }],
    ...over,
  };
}

const BASE = { unitAmount: 4900, quantity: 2, currency: "PLN" };

describe("subscriptionPriceSnapshot", () => {
  it("kwota sztuki i waluta (wielkie litery) z pierwszej pozycji", () => {
    expect(subscriptionPriceSnapshot(data())).toEqual({ unit_amount_minor: 4900, currency: "PLN" });
  });

  it("cena schodkowa (bez kwoty): null - księga policzy z katalogu", () => {
    const snap = subscriptionPriceSnapshot(
      data({ items: [{ quantity: 1, price: { id: "price_t" } }] }),
    );
    expect(snap).toEqual({ unit_amount_minor: null, currency: null });
  });

  it("rabat nieznany nie dokłada kolumn rabatu; znany - dokłada", () => {
    expect(Object.keys(subscriptionPriceSnapshot(data()))).not.toContain(
      "discount_minor_per_period",
    );
    expect(
      subscriptionPriceSnapshot(
        data({ discount: { minorPerPeriod: 2940, endsAt: "2026-12-01T00:00:00.000Z" } }),
      ),
    ).toMatchObject({
      discount_minor_per_period: 2940,
      discount_ends_at: "2026-12-01T00:00:00.000Z",
    });
    expect(subscriptionPriceSnapshot(data({ discount: null }))).toMatchObject({
      discount_minor_per_period: 0,
      discount_ends_at: null,
    });
  });

  it("każda kolumna migawki istnieje w types.ts (subscriptions.Row)", () => {
    const types = readFileSync(join(process.cwd(), "src/integrations/supabase/types.ts"), "utf8");
    const block = /\n {6}subscriptions: \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/.exec(types);
    expect(block).not.toBeNull();
    const columns = new Set([...block![1].matchAll(/^\s+(\w+):/gm)].map((m) => m[1]));
    const keys = Object.keys(
      subscriptionPriceSnapshot(data({ discount: { minorPerPeriod: 1, endsAt: null } })),
    );
    expect(keys.length).toBe(4);
    for (const key of keys) expect(columns.has(key), key).toBe(true);
  });
});

describe("mapSubscriptionDiscount", () => {
  const coupon = (c: Record<string, unknown>, end: number | null = null) => ({
    id: "di_1",
    end,
    coupon: c,
  });

  it("same identyfikatory (zdarzenie bez rozwinięcia) = nieznany", () => {
    expect(mapSubscriptionDiscount({ discounts: ["di_1"] }, BASE)).toBeUndefined();
  });

  it("pusta lista rabatów = brak rabatu (null, nie nieznany)", () => {
    expect(mapSubscriptionDiscount({ discounts: [] }, BASE)).toBeNull();
  });

  it("percent_off od ceny × ilość; repeating niesie koniec", () => {
    const end = Date.parse("2026-12-01T00:00:00Z") / 1000;
    expect(
      mapSubscriptionDiscount(
        { discounts: [coupon({ percent_off: 30, duration: "repeating" }, end)] },
        BASE,
      ),
    ).toEqual({ minorPerPeriod: 2940, endsAt: "2026-12-01T00:00:00.000Z" });
  });

  it("rabat `once` nie obniża MRR; `forever` bez końca; amount_off w innej walucie = nieznany", () => {
    expect(
      mapSubscriptionDiscount({ discounts: [coupon({ percent_off: 50, duration: "once" })] }, BASE),
    ).toBeNull();
    expect(
      mapSubscriptionDiscount(
        { discounts: [coupon({ amount_off: 500, currency: "pln", duration: "forever" })] },
        BASE,
      ),
    ).toEqual({ minorPerPeriod: 500, endsAt: null });
    expect(
      mapSubscriptionDiscount(
        { discounts: [coupon({ amount_off: 500, currency: "eur", duration: "forever" })] },
        BASE,
      ),
    ).toBeUndefined();
  });

  it("rabat nie przekracza kwoty okresu; kupon w `source.coupon` (nowsze API) też", () => {
    expect(
      mapSubscriptionDiscount(
        {
          discounts: [
            {
              id: "di_2",
              end: null,
              source: { coupon: { amount_off: 99_999, currency: "pln", duration: "forever" } },
            },
          ],
        },
        BASE,
      ),
    ).toEqual({ minorPerPeriod: 9800, endsAt: null });
  });

  it("mapStripeSubscription niesie rabat z rozwiniętego odczytu", () => {
    const sub = mapStripeSubscription({
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      discounts: [coupon({ percent_off: 10, duration: "forever" })],
      items: {
        data: [
          {
            quantity: 1,
            price: {
              id: "price_1",
              unit_amount: 4900,
              currency: "pln",
              recurring: { interval: "month" },
            },
          },
        ],
      },
    });
    expect(sub.discount).toEqual({ minorPerPeriod: 490, endsAt: null });
  });
});
