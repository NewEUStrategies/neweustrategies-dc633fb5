// Arytmetyka MRR po stronie TS (S2): złożenia `monthlyEquivalent`,
// `catalogPlanQuote` i `catalogRecurringFor` - bez własnej normalizacji.
// Parytet z SQL: src/lib/billing/__tests__/billingCatalogSqlParity.test.ts.
import { describe, expect, it } from "vitest";

import { catalogEntryByPriceId, ledgerCatalogEntryByPriceId } from "@/lib/billing/catalog";
import {
  BRIDGE_TOLERANCE,
  bridgeReconciles,
  bridgeResidualMinor,
  catalogMrrMinor,
  cycleOfCatalogEntry,
  mrrMinorFromAmount,
  netNewMrrMinor,
  providerMrrMinor,
  type BridgeParts,
} from "@/lib/revenue/finance/mrrMath";

const entry = (priceId: string) => {
  const e = catalogEntryByPriceId(priceId) ?? ledgerCatalogEntryByPriceId(priceId);
  if (!e) throw new Error(`brak pozycji ${priceId}`);
  return e;
};

describe("cykl pozycji katalogu", () => {
  it("miesiąc, rok, legacy rok; jednorazowa pozycja nie ma cyklu (brak MRR, nie zero)", () => {
    expect(cycleOfCatalogEntry(entry("plus_monthly"))).toEqual({
      interval: "month",
      intervalCount: 1,
    });
    expect(cycleOfCatalogEntry(entry("pro_yearly"))).toEqual({
      interval: "year",
      intervalCount: 1,
    });
    expect(cycleOfCatalogEntry(entry("decision_lab_seat"))).toBeNull();
    expect(cycleOfCatalogEntry(entry("business_2w"))).toEqual({
      interval: "week",
      intervalCount: 2,
    });
    expect(cycleOfCatalogEntry(entry("business_quarterly"))).toEqual({
      interval: "month",
      intervalCount: 3,
    });
  });

  it("rok dzieli się przez 12, tydzień mnoży przez 52/12", () => {
    expect(mrrMinorFromAmount(12_000, { interval: "year", intervalCount: 1 })).toBe(1_000);
    expect(mrrMinorFromAmount(1_200, { interval: "week", intervalCount: 1 })).toBe(5_200);
  });
});

describe("MRR z katalogu (D-05: podstawa `catalog`)", () => {
  it("plan bez miejsc ignoruje liczbę miejsc", () => {
    const plan = { tier_key: "member", interval: "month", price_cents: 4_900 };
    expect(catalogMrrMinor(plan, 5)).toBe(catalogMrrMinor(plan, 1));
  });

  it("rabat nie schodzi poniżej zera", () => {
    const plan = { tier_key: "member", interval: "month", price_cents: 4_900 };
    expect(catalogMrrMinor(plan, 1, 10_000)).toBe(0);
  });

  it("brak pary w katalogu = null", () => {
    expect(
      catalogMrrMinor({ tier_key: "nope", interval: "month", price_cents: 100 }, 1),
    ).toBeNull();
  });
});

describe("MRR z migawki operatora (podstawa `provider`)", () => {
  const at = new Date("2026-10-01T00:00:00Z");

  it("cena × ilość − rabat, dopóki rabat trwa", () => {
    const snap = {
      unitAmountMinor: 8_900,
      quantity: 3,
      discountMinorPerPeriod: 900,
      discountEndsAt: null,
    };
    expect(providerMrrMinor(snap, entry("plus_monthly"), at)).toBe(25_800);
    const ended = { ...snap, discountEndsAt: "2026-09-01T00:00:00Z" };
    expect(providerMrrMinor(ended, entry("plus_monthly"), at)).toBe(26_700);
  });

  it("ilość 0 albo brak liczy się jako 1 (jak SQL)", () => {
    const snap = {
      unitAmountMinor: 4_900,
      quantity: 0,
      discountMinorPerPeriod: 0,
      discountEndsAt: null,
    };
    expect(providerMrrMinor(snap, entry("plus_monthly"), at)).toBe(4_900);
  });
});

describe("most MRR", () => {
  const parts: BridgeParts = {
    startMinor: 100_000,
    openingMinor: 0,
    newMinor: 10_000,
    expansionMinor: 2_000,
    reactivationMinor: 1_000,
    contractionMinor: -3_000,
    churnMinor: -5_000,
    endMinor: 105_000,
  };

  it("start + Σ = koniec -> rozjazd 0, netto bez salda otwarcia", () => {
    expect(bridgeResidualMinor(parts)).toBe(0);
    expect(bridgeReconciles(parts)).toBe(true);
    expect(netNewMrrMinor({ ...parts, openingMinor: 50_000 })).toBe(5_000);
  });

  it("tolerancja 0,5 % względem większego końca", () => {
    expect(BRIDGE_TOLERANCE).toBe(0.005);
    expect(bridgeReconciles({ ...parts, endMinor: 105_525 })).toBe(true);
    expect(bridgeReconciles({ ...parts, endMinor: 105_600 })).toBe(false);
  });

  it("oba końce zerowe: dopuszczalne wyłącznie zero", () => {
    const zero: BridgeParts = {
      startMinor: 0,
      openingMinor: 0,
      newMinor: 0,
      expansionMinor: 0,
      reactivationMinor: 0,
      contractionMinor: 0,
      churnMinor: 0,
      endMinor: 0,
    };
    expect(bridgeReconciles(zero)).toBe(true);
    expect(bridgeReconciles({ ...zero, newMinor: 1 })).toBe(false);
  });
});
