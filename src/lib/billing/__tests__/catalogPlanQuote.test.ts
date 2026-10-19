// Wycena planu z katalogu (`catalog.ts`) - JEDNA reguła dla obu silników kasy
// i dla synchronizacji katalogu (audyt SUB-05).
//
// CZEGO PILNUJE: (1) pozycja katalogu WYŁĄCZNIE po parze (tier, cykl) - bez
// zapasowej ceny miesięcznej dla planu kwartalnego; (2) ilość tylko dla planu
// rozliczanego za miejsce; (3) próg wolumenowy w trybie `volume` (całe
// zamówienie po stawce progu); (4) cykl operatora to ten sam słownik, którym
// synchronizacja zakłada ceny.
import { describe, expect, it } from "vitest";

import {
  BILLING_CATALOG,
  catalogPlanQuote,
  catalogPriceForPlan,
  catalogRecurringFor,
} from "@/lib/billing/catalog";

describe("catalogPriceForPlan - bez zapasowego „pierwszego wpisu progu”", () => {
  it("dokładna para (tier, cykl) daje swoją pozycję", () => {
    expect(catalogPriceForPlan({ tier_key: "business", interval: "quarter" })?.priceId).toBe(
      "business_quarterly",
    );
    expect(catalogPriceForPlan({ tier_key: "pro", interval: "year" })?.priceId).toBe("pro_annual");
  });

  it("plan kwartalny bez pozycji w katalogu NIE dostaje ceny miesięcznej", () => {
    // Dawniej: `pro/quarter` -> `pro_monthly`, czyli subskrypcja miesięczna
    // po cenie miesięcznej przy zamówieniu „kwartalnym".
    expect(catalogPriceForPlan({ tier_key: "pro", interval: "quarter" })).toBeNull();
    // Student ma od v6.2 parę roczną (190 zł) - plan bez rocznej pozycji to dziś kadra.
    expect(catalogPriceForPlan({ tier_key: "educator", interval: "year" })).toBeNull();
  });

  it("brak cyklu w wierszu znaczy „miesięczny” - jak w bazie sprzed kolumny", () => {
    expect(catalogPriceForPlan({ tier_key: "member", interval: null })?.priceId).toBe(
      "plus_monthly",
    );
  });
});

describe("catalogPlanQuote - kwota zamówienia planu", () => {
  it("plan jednostkowy: zawsze jedna sztuka, niezależnie od żądania", () => {
    const quote = catalogPlanQuote({ tier_key: "member", interval: "month", price_cents: 4900 }, 5);

    expect(quote).toMatchObject({ quantity: 1, unitCents: 4900, amountCents: 4900 });
    expect(quote?.entry.priceId).toBe("plus_monthly");
  });

  it("plan za miejsce: liczba miejsc przycięta do 1..100", () => {
    const team = { tier_key: "team", interval: "month", price_cents: 9900 };

    expect(catalogPlanQuote(team, 7)).toMatchObject({ quantity: 7, amountCents: 7 * 9900 });
    expect(catalogPlanQuote(team, 0)?.quantity).toBe(1);
    expect(catalogPlanQuote(team, 250)?.quantity).toBe(100);
    expect(catalogPlanQuote(team, undefined)?.quantity).toBe(1);
  });

  it("próg wolumenowy przecenia WSZYSTKIE miejsca od progu (tryb `volume`)", () => {
    const team = {
      tier_key: "team",
      interval: "month",
      price_cents: 9900,
      volume_threshold_seats: 11,
      volume_price_cents: 7900,
    };

    expect(catalogPlanQuote(team, 10)).toMatchObject({ unitCents: 9900, amountCents: 99000 });
    expect(catalogPlanQuote(team, 11)).toMatchObject({ unitCents: 7900, amountCents: 86900 });
  });

  it("plan bez pozycji w katalogu nie ma wyceny", () => {
    expect(catalogPlanQuote({ tier_key: "pro", interval: "quarter", price_cents: 1 })).toBeNull();
    expect(catalogPlanQuote({ tier_key: null, interval: "month", price_cents: 1 })).toBeNull();
  });
});

describe("catalogRecurringFor - słownik cykli operatora", () => {
  it("mapuje interwały aplikacji na krotności Stripe, a jednorazowe na brak cyklu", () => {
    const byId = (id: string) => BILLING_CATALOG.find((e) => e.priceId === id)!;

    expect(catalogRecurringFor(byId("business_2w"))).toEqual({
      interval: "week",
      interval_count: 2,
    });
    expect(catalogRecurringFor(byId("business_quarterly"))).toEqual({
      interval: "month",
      interval_count: 3,
    });
    expect(catalogRecurringFor(byId("pro_annual"))).toEqual({
      interval: "year",
      interval_count: 1,
    });
    expect(catalogRecurringFor(byId("plus_monthly"))).toEqual({
      interval: "month",
      interval_count: 1,
    });
    expect(catalogRecurringFor(byId("decision_lab_seat"))).toBeNull();
  });
});
