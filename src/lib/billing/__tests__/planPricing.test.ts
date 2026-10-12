// Wycena planu z katalogu - JEDNA reguła dla obu silników kasy (audyt PAY-01).
//
// Do 12.10.2026 drugi silnik (`stripeCheckout.functions.ts`) brał cenę
// i ilość z żądania, a pierwszy (`checkout.functions.ts`) liczył je sam.
// Ten moduł jest teraz jedynym miejscem, w którym plan zamienia się w cenę
// katalogową, ilość, kwotę i tryb sesji - więc to tu dowodzimy reguł, od
// których zależy kwota zamówienia: miejsca tylko dla planów `perSeat`,
// próg wolumenowy na WSZYSTKIE miejsca, plan jednorazowy jako `payment`.
//
// Moduł jest czysty - bez atrap. `catalogPriceForPlan` jedzie prawdziwy, bo
// to jego wybór wpisu jest częścią kontraktu.
import { describe, expect, it } from "vitest";

import { BILLING_CATALOG } from "@/lib/billing/catalog";
import {
  MAX_PLAN_SEATS,
  planCheckoutPricing,
  type PlanPricingRow,
} from "@/lib/billing/planPricing";

function plan(over: Partial<PlanPricingRow> = {}): PlanPricingRow {
  return {
    tier_key: "member",
    interval: "month",
    price_cents: 4900,
    volume_threshold_seats: null,
    volume_price_cents: null,
    ...over,
  };
}

const team = (over: Partial<PlanPricingRow> = {}) =>
  plan({ tier_key: "team", price_cents: 9900, ...over });

describe("planCheckoutPricing - wybór ceny katalogowej", () => {
  it("plan cykliczny dostaje wpis katalogu, jedną sztukę, kwotę planu i tryb subskrypcji", () => {
    const pricing = planCheckoutPricing(plan());

    expect(pricing).toMatchObject({
      quantity: 1,
      amountCents: 4900,
      kind: "subscription",
      mode: "subscription",
    });
    expect(pricing?.entry.priceId).toBe("plus_monthly");
  });

  it("cykl planu wybiera cenę: roczny Pro to `pro_annual`, nie miesięczna", () => {
    expect(planCheckoutPricing(plan({ tier_key: "pro", interval: "year" }))?.entry.priceId).toBe(
      "pro_annual",
    );
  });

  it("plan bez `tier_key` albo spoza katalogu nie ma ceny (`null`)", () => {
    expect(planCheckoutPricing(plan({ tier_key: null }))).toBeNull();
    expect(planCheckoutPricing(plan({ tier_key: "warstwa-spoza-katalogu" }))).toBeNull();
  });
});

describe("planCheckoutPricing - plan jednorazowy", () => {
  it("Decision Lab: rodzaj `one_time`, tryb `payment`, cena jednorazowa", () => {
    const pricing = planCheckoutPricing(
      plan({ tier_key: "decision_lab", interval: "one_time", price_cents: 150000 }),
    );

    expect(pricing).toMatchObject({
      quantity: 1,
      amountCents: 150000,
      kind: "one_time",
      mode: "payment",
    });
    expect(pricing?.entry.priceId).toBe("decision_lab_seat");
  });

  it("plan JEDNORAZOWY warstwy bez ceny jednorazowej nie schodzi na subskrypcję", () => {
    // `catalogPriceForPlan` bez pary (warstwa, cykl) bierze pierwszy wpis
    // warstwy - tu `pro_monthly`. Sesja pobrałaby wtedy subskrypcję za plan,
    // który obiecuje zakup jednorazowy.
    expect(planCheckoutPricing(plan({ tier_key: "pro", interval: "one_time" }))).toBeNull();
  });

  it("plan CYKLICZNY warstwy z samą ceną jednorazową też nie ma ceny", () => {
    expect(planCheckoutPricing(plan({ tier_key: "decision_lab", interval: "month" }))).toBeNull();
  });

  it("każdy wpis katalogu wycenia się w trybie zgodnym ze swoim typem ceny", () => {
    // Parytet z `catalogSync.server.ts`: cena jednorazowa nie ma cyklu, każda
    // inna jest cykliczna - więc tryb sesji musi z tego wynikać.
    for (const entry of BILLING_CATALOG) {
      const pricing = planCheckoutPricing(
        plan({ tier_key: entry.tierKey, interval: entry.interval }),
      );
      expect(pricing?.entry.priceId, entry.priceId).toBe(entry.priceId);
      expect(pricing?.mode, entry.priceId).toBe(entry.oneTime ? "payment" : "subscription");
    }
  });
});

describe("planCheckoutPricing - miejsca i próg wolumenowy", () => {
  it("plan ZA MIEJSCE mnoży cenę przez liczbę miejsc", () => {
    expect(planCheckoutPricing(team(), 4)).toMatchObject({ quantity: 4, amountCents: 39600 });
  });

  it("plan ZA MIEJSCE bez liczby miejsc liczy jedno miejsce", () => {
    expect(planCheckoutPricing(team())).toMatchObject({ quantity: 1, amountCents: 9900 });
  });

  it("liczba miejsc jest docinana do 1..100", () => {
    expect(MAX_PLAN_SEATS).toBe(100);
    expect(planCheckoutPricing(team({ price_cents: 100 }), 250)).toMatchObject({
      quantity: 100,
      amountCents: 10000,
    });
    expect(planCheckoutPricing(team(), 0)).toMatchObject({ quantity: 1, amountCents: 9900 });
    expect(planCheckoutPricing(team(), -5)).toMatchObject({ quantity: 1 });
  });

  it("nieliczbowa liczba miejsc nie przechodzi jako NaN - schodzi na jedno miejsce", () => {
    expect(planCheckoutPricing(team(), Number.NaN)).toMatchObject({
      quantity: 1,
      amountCents: 9900,
    });
  });

  it("plan NIE rozliczany za miejsce ignoruje liczbę miejsc z żądania", () => {
    expect(planCheckoutPricing(plan(), 50)).toMatchObject({ quantity: 1, amountCents: 4900 });
  });

  it("próg wolumenowy przecenia WSZYSTKIE miejsca, nie tylko nadwyżkę", () => {
    const tiered = team({ volume_threshold_seats: 11, volume_price_cents: 7900 });

    expect(planCheckoutPricing(tiered, 11)?.amountCents).toBe(86900);
    expect(planCheckoutPricing(tiered, 10)?.amountCents).toBe(99000);
  });

  it("próg mniejszy niż dwa miejsca jest ignorowany - to konfiguracja bez sensu", () => {
    const nonsense = team({ volume_threshold_seats: 1, volume_price_cents: 100 });

    expect(planCheckoutPricing(nonsense, 5)?.amountCents).toBe(49500);
  });

  it("próg na planie NIE za miejsce nie zmienia kwoty", () => {
    const flat = plan({ volume_threshold_seats: 2, volume_price_cents: 100 });

    expect(planCheckoutPricing(flat, 5)?.amountCents).toBe(4900);
  });
});
