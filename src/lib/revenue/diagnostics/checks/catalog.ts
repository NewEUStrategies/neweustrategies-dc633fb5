// Reguły obszaru „Katalog planów" (SPEC §5.7) - plan ↔ warstwa ↔ para
// katalogowa ↔ cena u operatora ↔ cennik.
//
// STAN `error` = skutek TRWA (ktoś może dziś kupić coś, czego nie dostanie,
// albo płaci inną kwotę niż w cenniku); `warn` = ten sam błąd uśpiony
// (plan wycofany, warstwa schowana) - wróci przy pierwszym włączeniu.
import { isEnquiryOnlyPlan } from "@/lib/billing/enquiryPlans";
import { TEAM_TIER_MAX_SEATS } from "@/lib/organizations/teamSeats";
import { areaFacts, ev, finding, OK, UNKNOWN, type CatalogPlanFact } from "../facts";
import type { RevenueCheck } from "../registry";

/** Rok to 12 okresów miesięcznych - granica „rabatu" rocznego, nie benchmark. */
const MONTHS_PER_YEAR = 12;

const PAYWALL_PLANS = { to: "/admin/paywall", search: { tab: "plans" } } as const;

function selling(plan: CatalogPlanFact): boolean {
  return plan.active && plan.forSale;
}

/** Plany sprzedawane pierwsze - `refs` prowadzą najpierw do tych, które bolą. */
function refsOf(plans: readonly CatalogPlanFact[]): string[] {
  return [...plans].sort((a, b) => Number(selling(b)) - Number(selling(a))).map((p) => p.id);
}

/** Pary miesiąc/rok tej samej warstwy i waluty, z kwotami (admin). */
function annualPairs(plans: readonly CatalogPlanFact[]) {
  const pairs: { tierKey: string; monthly: number | null; yearly: number | null }[] = [];
  const active = plans.filter((p) => p.active && p.tierKey !== null);
  for (const yearly of active.filter((p) => p.interval === "year")) {
    const monthly = active.find(
      (p) =>
        p.interval === "month" && p.tierKey === yearly.tierKey && p.currency === yearly.currency,
    );
    if (monthly) {
      pairs.push({
        tierKey: yearly.tierKey as string,
        monthly: monthly.priceCents,
        yearly: yearly.priceCents,
      });
    }
  }
  return pairs;
}

export const CATALOG_CHECKS = [
  {
    id: "catalog.plan_without_tier",
    area: "catalog",
    severity: "critical",
    evaluate(facts) {
      const plans = areaFacts(facts, "catalog")?.plans;
      if (!plans) return UNKNOWN;
      const broken = plans.filter((p) => !p.tierFound);
      if (broken.length === 0) return OK;
      const sold = broken.filter(selling).length;
      return finding(sold > 0 ? "error" : "warn", {
        count: broken.length,
        refs: refsOf(broken),
        evidence: ev("planWithoutTier", { count: broken.length, selling: sold }),
      });
    },
    fix: { kind: "dialog", dialog: "plan_tier" },
    owner: { to: "/admin/membership" },
    snoozable: true,
  },
  {
    id: "catalog.plan_without_catalog_pair",
    area: "catalog",
    severity: "critical",
    evaluate(facts) {
      const plans = areaFacts(facts, "catalog")?.plans;
      if (!plans) return UNKNOWN;
      const broken = plans.filter((p) => !p.catalogPair);
      if (broken.length === 0) return OK;
      const sold = broken.filter(selling).length;
      return finding(sold > 0 ? "error" : "warn", {
        count: broken.length,
        refs: refsOf(broken),
        evidence: ev("planWithoutCatalogPair", { count: broken.length, selling: sold }),
      });
    },
    fix: { kind: "dialog", dialog: "plan_deactivate" },
    owner: PAYWALL_PLANS,
    snoozable: true,
  },
  {
    id: "catalog.enquiry_plan_buyable",
    area: "catalog",
    severity: "warning",
    evaluate(facts) {
      const plans = areaFacts(facts, "catalog")?.plans;
      if (!plans) return UNKNOWN;
      const buyable = plans.filter((p) => p.forSale && isEnquiryOnlyPlan({ tier_key: p.tierKey }));
      if (buyable.length === 0) return OK;
      const live = buyable.filter((p) => p.active).length;
      return finding(live > 0 ? "error" : "warn", {
        count: buyable.length,
        refs: refsOf(buyable),
        evidence: ev("enquiryPlanBuyable", { count: buyable.length, active: live }),
      });
    },
    fix: { kind: "dialog", dialog: "plan_not_for_sale" },
    owner: PAYWALL_PLANS,
    snoozable: true,
  },
  {
    id: "catalog.promise_without_gate",
    area: "catalog",
    severity: "warning",
    evaluate(facts) {
      const gaps = areaFacts(facts, "catalog")?.promiseGaps;
      if (!gaps) return UNKNOWN;
      if (gaps.broken.length === 0 && gaps.decorative.length === 0) return OK;
      const brokenSold = gaps.broken.filter((g) => g.offerable);
      const all = [...gaps.broken, ...gaps.decorative];
      return finding(brokenSold.length > 0 ? "error" : "warn", {
        count: all.length,
        refs: [...new Set(all.map((g) => g.tierKey))],
        evidence: [
          ...(gaps.broken.length > 0
            ? [ev("promiseBroken", { count: gaps.broken.length, selling: brokenSold.length })]
            : []),
          ...(gaps.decorative.length > 0
            ? [ev("promiseDecorative", { count: gaps.decorative.length })]
            : []),
        ],
      });
    },
    fix: { kind: "link", to: "/admin/revenue/offer" },
    owner: { to: "/admin/pricing", search: { tab: "tiers" } },
    snoozable: true,
  },
  {
    id: "catalog.provider_price_drift",
    area: "catalog",
    severity: "warning",
    evaluate(facts) {
      const drift = areaFacts(facts, "catalog")?.providerPriceDrift;
      if (drift?.forSale === undefined || drift.notForSale === undefined) return UNKNOWN;
      const total = drift.forSale + drift.notForSale;
      if (total === 0) return OK;
      return finding(drift.forSale > 0 ? "error" : "warn", {
        count: total,
        refs: drift.refs,
        evidence: ev("providerPriceDrift", {
          forSale: drift.forSale,
          notForSale: drift.notForSale,
        }),
      });
    },
    fix: { kind: "link", to: "/admin/billing", search: { tab: "subscriptions" } },
    owner: PAYWALL_PLANS,
    snoozable: true,
  },
  {
    id: "catalog.annual_discount_out_of_range",
    area: "catalog",
    severity: "info",
    evaluate(facts) {
      const plans = areaFacts(facts, "catalog")?.plans;
      if (!plans) return UNKNOWN;
      const pairs = annualPairs(plans);
      if (pairs.length === 0) return OK;
      // Kwoty widzi tylko administrator - redaktor dostaje `null` (SPEC §2.5).
      if (pairs.some((p) => p.monthly === null || p.yearly === null)) return UNKNOWN;
      const priced = pairs as { tierKey: string; monthly: number; yearly: number }[];
      // Rok droższy niż 12 miesięcy albo tańszy niż jeden miesiąc to błąd
      // wpisu, nie polityka cenowa; rok równy 12 miesiącom - plan roczny bez
      // żadnej zachęty. Granice logiczne, bez wymyślonego „dobrego" rabatu.
      const above = priced.filter((p) => p.yearly > p.monthly * MONTHS_PER_YEAR);
      const below = priced.filter((p) => p.yearly <= p.monthly);
      const flat = priced.filter((p) => p.yearly === p.monthly * MONTHS_PER_YEAR);
      if (above.length + below.length > 0) {
        const bad = [...above, ...below];
        return finding("error", {
          count: bad.length,
          refs: bad.map((p) => p.tierKey),
          evidence: [
            ...(above.length > 0 ? [ev("annualAboveMonthly", { count: above.length })] : []),
            ...(below.length > 0 ? [ev("annualBelowMonthly", { count: below.length })] : []),
          ],
        });
      }
      if (flat.length > 0) {
        return finding("warn", {
          count: flat.length,
          refs: flat.map((p) => p.tierKey),
          evidence: ev("annualNoDiscount", { count: flat.length }),
        });
      }
      return OK;
    },
    fix: { kind: "link", to: "/admin/paywall", search: { tab: "plans" } },
    owner: PAYWALL_PLANS,
    snoozable: true,
  },
  {
    id: "catalog.subscription_unknown_price",
    area: "catalog",
    severity: "warning",
    evaluate(facts) {
      const subs = areaFacts(facts, "catalog")?.unknownPriceSubscriptions;
      if (subs?.unknownPrice === undefined || subs.missingAmount === undefined) return UNKNOWN;
      if (subs.unknownPrice + subs.missingAmount === 0) return OK;
      return finding(subs.unknownPrice > 0 ? "error" : "warn", {
        count: subs.unknownPrice + subs.missingAmount,
        evidence: [
          ...(subs.unknownPrice > 0 ? [ev("unknownPrice", { count: subs.unknownPrice })] : []),
          ...(subs.missingAmount > 0 ? [ev("missingAmount", { count: subs.missingAmount })] : []),
        ],
      });
    },
    fix: { kind: "code", issueRef: "catalog.subscription_unknown_price" },
    owner: { to: "/admin/billing", search: { tab: "subscriptions" } },
    snoozable: true,
  },
  {
    id: "catalog.not_for_sale_still_visible",
    area: "catalog",
    severity: "info",
    evaluate(facts) {
      const tiers = areaFacts(facts, "catalog")?.tiers;
      if (!tiers) return UNKNOWN;
      const shown = tiers.filter(
        (t) => t.active && t.pricingVisible && !t.isDefault && t.plansForSale === 0,
      );
      // Przycisk zakupu prowadzący donikąd (`cta_mode = auto` bez planu) -
      // skutek trwa; warstwa „na zapytanie" z wycofanym planem - porządki.
      const deadButton = shown.filter((t) => t.ctaMode === "auto");
      const withdrawn = shown.filter((t) => t.ctaMode !== "auto" && t.plansNotForSale > 0);
      if (deadButton.length > 0) {
        return finding("error", {
          count: deadButton.length,
          refs: deadButton.map((t) => t.key),
          evidence: ev("tierBuyButtonWithoutPlan", { count: deadButton.length }),
        });
      }
      if (withdrawn.length > 0) {
        return finding("warn", {
          count: withdrawn.length,
          refs: withdrawn.map((t) => t.key),
          evidence: ev("tierShownPlanWithdrawn", { count: withdrawn.length }),
        });
      }
      return OK;
    },
    fix: { kind: "dialog", dialog: "tier_hide" },
    owner: { to: "/admin/pricing", search: { tab: "tiers" } },
    snoozable: true,
  },
  {
    id: "catalog.price_change_without_notice",
    area: "catalog",
    severity: "warning",
    evaluate(facts) {
      const migr = areaFacts(facts, "catalog")?.priceMigrations90d;
      if (migr?.failed === undefined || migr.pendingOver24h === undefined) return UNKNOWN;
      if (migr.failed + migr.pendingOver24h === 0) return OK;
      return finding(migr.failed > 0 ? "error" : "warn", {
        count: migr.failed + migr.pendingOver24h,
        evidence: [
          ...(migr.failed > 0 ? [ev("priceNoticeFailed", { count: migr.failed })] : []),
          ...(migr.pendingOver24h > 0
            ? [ev("priceNoticePending", { count: migr.pendingOver24h })]
            : []),
        ],
      });
    },
    fix: { kind: "link", to: "/admin/newsletter/campaigns" },
    owner: { to: "/admin/billing", search: { tab: "subscriptions" } },
    snoozable: true,
  },
  {
    id: "catalog.team_seats_over_cap",
    area: "catalog",
    severity: "warning",
    evaluate(facts) {
      const seats = areaFacts(facts, "catalog")?.teamSeats;
      if (seats?.over === undefined || seats.atCap === undefined) return UNKNOWN;
      if (seats.over + seats.atCap === 0) return OK;
      return finding(seats.over > 0 ? "error" : "warn", {
        count: seats.over + seats.atCap,
        refs: seats.refs,
        evidence: [
          ...(seats.over > 0
            ? [ev("teamSeatsOver", { count: seats.over, max: TEAM_TIER_MAX_SEATS })]
            : []),
          ...(seats.atCap > 0
            ? [ev("teamSeatsAtCap", { count: seats.atCap, max: TEAM_TIER_MAX_SEATS })]
            : []),
        ],
      });
    },
    fix: { kind: "link", to: "/admin/organizations" },
    owner: { to: "/admin/organizations" },
    snoozable: true,
  },
] as const satisfies readonly RevenueCheck[];
