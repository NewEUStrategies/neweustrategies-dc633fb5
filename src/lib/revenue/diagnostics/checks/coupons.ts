// Reguły obszaru „Kupony" (SPEC §5.7; P03, P04).
import { areaFacts, ev, finding, OK, UNKNOWN } from "../facts";
import type { RevenueCheck } from "../registry";

/** Okno „wygasa wkrótce" - lustro `interval '14 days'` w `_revenue_facts_coupons`. */
export const COUPON_EXPIRING_DAYS = 14;

export const COUPONS_CHECKS = [
  {
    // Kampania oznaczona jako wysłana, a kodów zero - odbiorcy dostali mail
    // bez kodu (P04). `error`, dopóki kampania jest ważna.
    id: "coupons.campaign_sent_without_codes",
    area: "coupons",
    severity: "critical",
    evaluate(facts) {
      const sent = areaFacts(facts, "coupons")?.sentWithoutCodes;
      if (sent?.active === undefined || sent.expired === undefined) return UNKNOWN;
      if (sent.active + sent.expired === 0) return OK;
      return finding(sent.active > 0 ? "error" : "warn", {
        count: sent.active + sent.expired,
        refs: sent.refs,
        evidence: ev("campaignSentWithoutCodes", { active: sent.active, expired: sent.expired }),
      });
    },
    fix: { kind: "dialog", dialog: "campaign_status" },
    owner: { to: "/admin/coupons/campaigns" },
    snoozable: true,
  },
  {
    id: "coupons.expiring_unused",
    area: "coupons",
    severity: "info",
    evaluate(facts) {
      const expiring = areaFacts(facts, "coupons")?.expiringUnused;
      if (expiring?.coupons === undefined || expiring.campaigns === undefined) return UNKNOWN;
      if (expiring.coupons === 0 && expiring.campaigns === 0) return OK;
      // Cała kampania bez jednego użycia tuż przed końcem = kampania nie
      // zadziałała; pojedyncze kody bez użycia to zwykły odsiew.
      return finding(expiring.campaigns > 0 ? "error" : "warn", {
        count: expiring.coupons,
        refs: expiring.refs,
        evidence: [
          ...(expiring.campaigns > 0
            ? [ev("campaignExpiringUnused", { count: expiring.campaigns, days: COUPON_EXPIRING_DAYS })]
            : []),
          ...(expiring.coupons > 0
            ? [ev("couponsExpiringUnused", { count: expiring.coupons, days: COUPON_EXPIRING_DAYS })]
            : []),
        ],
      });
    },
    fix: { kind: "link", to: "/admin/coupons/campaigns" },
    owner: { to: "/admin/coupons" },
    snoozable: true,
  },
  {
    // P03: skutek kuponu z `grants_tier_key` zapisuje nadanie z kolumną
    // `membership_grants.source_coupon_id`; bez niej (migracja niewdrożona na
    // produkcji) kupon nie nadaje warstwy. Naprawa = wdrożenie migracji.
    id: "coupons.grant_tier_broken",
    area: "coupons",
    severity: "critical",
    evaluate(facts) {
      const grant = areaFacts(facts, "coupons")?.grantTier;
      if (grant?.columnPresent === undefined || grant.coupons === undefined) return UNKNOWN;
      if (grant.columnPresent) return OK;
      return finding(grant.coupons > 0 ? "error" : "warn", {
        count: grant.coupons,
        evidence: ev("grantTierColumnMissing", { count: grant.coupons }),
      });
    },
    fix: { kind: "code", issueRef: "coupons.grant_tier_broken" },
    owner: { to: "/admin/coupons" },
    snoozable: true,
  },
] as const satisfies readonly RevenueCheck[];
