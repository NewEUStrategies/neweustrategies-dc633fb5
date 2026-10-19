// Cennik v6.2 po stronie katalogu i reguł zakupu (decyzje 1, 3, 5).
//
// CZEGO PILNUJE:
//   1. NOWA PARA STUDENCKA - `student_annual` (190 zł/rok) w `BILLING_CATALOG`
//      na tym samym produkcie, z rangą 11 (miesięczna -> roczna to upgrade).
//   2. PARTNER BIZNESOWY ZOSTAJE W KATALOGU - wpisy `business_*` są potrzebne
//      webhookowi do odnowień obecnych klientów; ich usunięcie odcięłoby dostęp.
//   3. ZAKUP ZAMKNIĘTY PO STRONIE SERWERA - Decision Lab (na zapytanie) i plan
//      wycofany ze sprzedaży odmawiają w `planPurchaseRefusal`, którą wołają
//      oba silniki kasy; bezpośredni URL `/checkout/<id>` nie omija karty.
//   4. ZMIANA PLANU NA PLAN WYCOFANY to nowy zakup - odmowa bez zdradzania powodu.
import { describe, expect, it } from "vitest";

import {
  BILLING_CATALOG,
  catalogEntryByPriceId,
  catalogPlanQuote,
  catalogRecurringFor,
  planChangeDirection,
} from "@/lib/billing/catalog";
import { planPurchaseRefusal } from "@/lib/billing/planPricing";
import { planSwitchRefusal, switchTargets } from "@/lib/billing/planSwitch";

describe("BILLING_CATALOG - v6.2", () => {
  it("student_annual: produkt plan_student, cykl roczny, ranga 11", () => {
    const entry = catalogEntryByPriceId("student_annual");
    expect(entry).toMatchObject({
      productId: "plan_student",
      tierKey: "student",
      interval: "year",
      rank: 11,
    });
    expect(entry && catalogRecurringFor(entry)).toEqual({ interval: "year", interval_count: 1 });
  });

  it("student miesięcznie -> rocznie to upgrade (z proratą), odwrotnie downgrade", () => {
    expect(planChangeDirection("student_monthly", "student_annual")).toBe("upgrade");
    expect(planChangeDirection("student_annual", "student_monthly")).toBe("downgrade");
  });

  it("identyfikatory cen i rangi są unikalne", () => {
    const priceIds = BILLING_CATALOG.map((e) => e.priceId);
    const ranks = BILLING_CATALOG.filter((e) => !e.oneTime).map((e) => e.rank);
    expect(new Set(priceIds).size).toBe(priceIds.length);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("wpisy Partnera Biznesowego zostają - webhook odwzorowuje po nich odnowienia", () => {
    for (const priceId of ["business_2w", "business_monthly", "business_quarterly"]) {
      expect(catalogEntryByPriceId(priceId)?.tierKey, priceId).toBe("business");
    }
  });

  it("Zespół 89 zł: 10 miejsc po 89, od 11 miejsc WSZYSTKIE po 79", () => {
    const team = {
      tier_key: "team",
      interval: "month",
      price_cents: 8900,
      volume_threshold_seats: 11,
      volume_price_cents: 7900,
    };
    expect(catalogPlanQuote(team, 10)).toMatchObject({ unitCents: 8900, amountCents: 89000 });
    expect(catalogPlanQuote(team, 11)).toMatchObject({ unitCents: 7900, amountCents: 86900 });
  });
});

describe("planPurchaseRefusal - jedna reguła zakupu dla obu silników kasy", () => {
  it("plan nieaktywny -> plan_not_found (bez zdradzania, że istnieje)", () => {
    expect(planPurchaseRefusal({ active: false, for_sale: true, tier_key: "member" })).toBe(
      "plan_not_found",
    );
    expect(planPurchaseRefusal({ active: null, tier_key: "member" })).toBe("plan_not_found");
  });

  it("Decision Lab -> plan_enquiry_only NAWET gdy ktoś przestawił for_sale na true", () => {
    expect(planPurchaseRefusal({ active: true, for_sale: true, tier_key: "decision_lab" })).toBe(
      "plan_enquiry_only",
    );
    expect(planPurchaseRefusal({ active: true, for_sale: false, tier_key: "decision_lab" })).toBe(
      "plan_enquiry_only",
    );
  });

  it("plan wycofany ze sprzedaży (Partner Biznesowy) -> plan_not_for_sale", () => {
    expect(planPurchaseRefusal({ active: true, for_sale: false, tier_key: "business" })).toBe(
      "plan_not_for_sale",
    );
  });

  it("zwykły plan w sprzedaży (także bez pola for_sale sprzed migracji) -> null", () => {
    expect(planPurchaseRefusal({ active: true, for_sale: true, tier_key: "pro" })).toBeNull();
    expect(planPurchaseRefusal({ active: true, tier_key: "member" })).toBeNull();
  });
});

describe("zmiana planu na plan wycofany ze sprzedaży", () => {
  const proMonthly = catalogEntryByPriceId("pro_monthly");
  const businessMonthly = catalogEntryByPriceId("business_monthly");

  it("cel z for_sale=false -> plan_not_found, także między cyklami Partnera Biznesowego", () => {
    const business2w = {
      active: true,
      for_sale: false,
      interval: "two_weeks",
      tier_key: "business",
    };
    expect(planSwitchRefusal(business2w, proMonthly)).toBe("plan_not_found");
    expect(planSwitchRefusal(business2w, businessMonthly)).toBe("plan_not_found");
  });

  it("obecny klient Partnera Biznesowego może przejść na Członka Pro (downgrade od okresu)", () => {
    const plans = [
      { id: "biz-2w", active: true, for_sale: false, interval: "two_weeks", tier_key: "business" },
      { id: "pro-m", active: true, for_sale: true, interval: "month", tier_key: "pro" },
    ];
    const targets = switchTargets(plans, businessMonthly);
    expect(targets.map((t) => t.plan.id)).toEqual(["pro-m"]);
    expect(targets[0].direction).toBe("downgrade");
  });
});
