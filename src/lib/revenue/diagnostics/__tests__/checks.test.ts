// Reguły diagnostyki (S7, SPEC §5.7) - KAŻDA z 55 reguł na czterech stanach:
// `ok`, `warn` (problem uśpiony), `error` (skutek trwa) i `unknown` (brak
// obszaru albo brak pola). Fakty przechodzą przez `parseRevenueFacts`, więc
// fikstura w kształcie SQL/TS sprawdza też, że parser przenosi pole, z którego
// korzysta reguła - pole zgubione w parserze dałoby „nie wiadomo" i test by
// to złapał.
import { describe, expect, it } from "vitest";

import { BRIDGE_TOLERANCE } from "@/lib/revenue/finance/mrrMath";
import { SCHEDULER_FRESH_MS, SCHEDULER_LAGGING_MS } from "@/lib/jobs/scheduler";
import { REVENUE_LIMITS } from "@/lib/revenue/limits";
import { LEDGER_DRIFT_TOLERANCE } from "../checks/dataQuality";
import { CORE_JOURNEY_TEMPLATES, EXTENDED_CORE_JOURNEY_TEMPLATES } from "../checks/journeys";
import { NEWSLETTER_COLUMN_DEFAULTS } from "../checks/newsletter";
import { RETENTION_MAX_STEPS } from "../checks/retention";
import { parseRevenueFacts, type RevenueCheckState, type RevenueFacts } from "../facts";
import {
  REVENUE_CHECK_IDS,
  REVENUE_CHECKS,
  revenueCheck,
  runCheck,
  type RevenueCheckId,
} from "../registry";

const NOW = "2026-10-20T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW_MS - ms).toISOString();
const ID = (n: number) => `e7150000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Bag = Record<string, unknown>;

function plan(overrides: Bag = {}): Bag {
  return {
    id: ID(1),
    tierKey: "pro",
    tierFound: true,
    tierRank: 2,
    active: true,
    forSale: true,
    interval: "month",
    currency: "PLN",
    priceCents: 4900,
    catalogPair: true,
    ...overrides,
  };
}

function tier(overrides: Bag = {}): Bag {
  return {
    id: ID(10),
    key: "pro",
    rank: 2,
    active: true,
    pricingVisible: true,
    isDefault: false,
    ctaMode: "auto",
    plansForSale: 1,
    plansNotForSale: 0,
    featureKeys: [],
    capabilityKeys: [],
    ...overrides,
  };
}

const deadEnd = (count: number, withHits30d: number) => ({ count, withHits30d, refs: [`rule:${ID(20)}`] });
const gap = (offerable: boolean) => ({ tierKey: "pro", capability: "reports", offerable });
const overlap = { workflowId: ID(30), journeyId: ID(31) };
const recipe = (cancelledByPause30d: number) => ({
  id: ID(32),
  enabled: true,
  guarded: false,
  cancelledByPause30d,
});
const backlogWarn = Math.round((SCHEDULER_FRESH_MS + SCHEDULER_LAGGING_MS) / 2);

interface Case {
  ok: Bag;
  warn: Bag;
  error: Bag;
}

/** Fikstury obszaru (klucze camelCase jak w SQL / polach TS) per reguła. */
const CASES: Readonly<Record<RevenueCheckId, Case>> = {
  "catalog.plan_without_tier": {
    ok: { plans: [plan()] },
    warn: { plans: [plan({ tierFound: false, active: false })] },
    error: { plans: [plan({ tierFound: false })] },
  },
  "catalog.plan_without_catalog_pair": {
    ok: { plans: [plan()] },
    warn: { plans: [plan({ catalogPair: false, forSale: false })] },
    error: { plans: [plan({ catalogPair: false })] },
  },
  "catalog.enquiry_plan_buyable": {
    ok: { plans: [plan(), plan({ id: ID(2), tierKey: "decision_lab", forSale: false })] },
    warn: { plans: [plan({ tierKey: "decision_lab", active: false })] },
    error: { plans: [plan({ tierKey: "decision_lab" })] },
  },
  "catalog.promise_without_gate": {
    ok: { promiseGaps: { broken: [], decorative: [] } },
    warn: { promiseGaps: { broken: [gap(false)], decorative: [gap(true)] } },
    error: { promiseGaps: { broken: [gap(true)], decorative: [] } },
  },
  "catalog.provider_price_drift": {
    ok: { providerPriceDrift: { forSale: 0, notForSale: 0, refs: [] } },
    warn: { providerPriceDrift: { forSale: 0, notForSale: 1, refs: [ID(1)] } },
    error: { providerPriceDrift: { forSale: 1, notForSale: 0, refs: [ID(1)] } },
  },
  "catalog.annual_discount_out_of_range": {
    ok: { plans: [plan(), plan({ id: ID(2), interval: "year", priceCents: 49_000 })] },
    warn: { plans: [plan(), plan({ id: ID(2), interval: "year", priceCents: 4900 * 12 })] },
    error: { plans: [plan(), plan({ id: ID(2), interval: "year", priceCents: 4900 * 13 })] },
  },
  "catalog.subscription_unknown_price": {
    ok: { unknownPriceSubscriptions: { unknownPrice: 0, missingAmount: 0 } },
    warn: { unknownPriceSubscriptions: { unknownPrice: 0, missingAmount: 2 } },
    error: { unknownPriceSubscriptions: { unknownPrice: 1, missingAmount: 0 } },
  },
  "catalog.not_for_sale_still_visible": {
    ok: { tiers: [tier()] },
    warn: { tiers: [tier({ ctaMode: "enquiry", plansForSale: 0, plansNotForSale: 1 })] },
    error: { tiers: [tier({ plansForSale: 0 })] },
  },
  "catalog.price_change_without_notice": {
    ok: { priceMigrations90d: { applied: 3, pendingOver24h: 0, failed: 0 } },
    warn: { priceMigrations90d: { applied: 3, pendingOver24h: 1, failed: 0 } },
    error: { priceMigrations90d: { applied: 3, pendingOver24h: 0, failed: 1 } },
  },
  "catalog.team_seats_over_cap": {
    ok: { teamSeats: { over: 0, atCap: 0, refs: [] } },
    warn: { teamSeats: { over: 0, atCap: 1, refs: [ID(3)] } },
    error: { teamSeats: { over: 1, atCap: 0, refs: [ID(3)] } },
  },
  "paywall.paid_without_buyable_plan": {
    ok: { paidWithoutOffer: deadEnd(0, 0) },
    warn: { paidWithoutOffer: deadEnd(2, 0) },
    error: { paidWithoutOffer: deadEnd(2, 1) },
  },
  "paywall.rule_inactive_plan": {
    ok: { danglingRules: deadEnd(0, 0) },
    warn: { danglingRules: { ...deadEnd(1, 0), planIds: [ID(1)] } },
    error: { danglingRules: { ...deadEnd(1, 4), planIds: [ID(1)] } },
  },
  "paywall.members_rank_no_cta": {
    ok: { membersRankNoCta: deadEnd(0, 0) },
    warn: { membersRankNoCta: deadEnd(3, 0) },
    error: { membersRankNoCta: deadEnd(3, 2) },
  },
  "paywall.measurement_silent": {
    ok: { gatedRules: 4, firstGatedAt: ago(30 * DAY), lastHitAt: ago(DAY) },
    warn: { gatedRules: 4, firstGatedAt: ago(30 * DAY), lastHitAt: ago(10 * DAY) },
    error: { gatedRules: 4, firstGatedAt: ago(10 * DAY), lastHitAt: null },
  },
  "metering.settings_row_missing": {
    ok: { settingsRow: true, meteredRules: 2 },
    warn: { settingsRow: false, meteredRules: 0 },
    error: { settingsRow: false, meteredRules: 3 },
  },
  "metering.anon_zero_limit": {
    ok: { settingsRow: true, enabled: true, anonMonthlyLimit: 3, memberMonthlyLimit: 5 },
    warn: { settingsRow: true, enabled: true, anonMonthlyLimit: 0, memberMonthlyLimit: 5 },
    error: { settingsRow: true, enabled: true, anonMonthlyLimit: 0, memberMonthlyLimit: 0 },
  },
  "metering.rank_bypass": {
    ok: { rankGatePresent: true, meteredTierGated: 2 },
    warn: { rankGatePresent: false, meteredTierGated: 0 },
    error: { rankGatePresent: false, meteredTierGated: 2 },
  },
  "checkout.abandon_window_default": {
    ok: { settingsRow: true, abandonAfterMinutes: 60, abandonedJourneyActive: true },
    warn: { settingsRow: false, abandonedJourneyActive: false },
    error: {
      settingsRow: true,
      abandonAfterMinutes: REVENUE_LIMITS.checkoutAbandonMinutesDefault,
      abandonedJourneyActive: true,
    },
  },
  "checkout.display_currency_mismatch": {
    ok: {
      presentation: [
        { lang: "pl", displayCurrency: "PLN", chargeCurrencies: ["PLN"] },
        { lang: "en", displayCurrency: "EUR", chargeCurrencies: ["EUR"] },
      ],
    },
    warn: { presentation: [{ lang: "en", displayCurrency: "EUR", chargeCurrencies: ["PLN"] }] },
    error: { presentation: [{ lang: "pl", displayCurrency: "EUR", chargeCurrencies: ["PLN"] }] },
  },
  "coupons.campaign_sent_without_codes": {
    ok: { sentWithoutCodes: { active: 0, expired: 0, refs: [] } },
    warn: { sentWithoutCodes: { active: 0, expired: 1, refs: [ID(40)] } },
    error: { sentWithoutCodes: { active: 1, expired: 0, refs: [ID(40)] } },
  },
  "coupons.expiring_unused": {
    ok: { expiringUnused: { coupons: 0, campaigns: 0, refs: [] } },
    warn: { expiringUnused: { coupons: 4, campaigns: 0, refs: [ID(41)] } },
    error: { expiringUnused: { coupons: 4, campaigns: 1, refs: [ID(41)] } },
  },
  "coupons.grant_tier_broken": {
    ok: { grantTier: { coupons: 2, columnPresent: true } },
    warn: { grantTier: { coupons: 0, columnPresent: false } },
    error: { grantTier: { coupons: 2, columnPresent: false } },
  },
  "retention.not_configured": {
    ok: { settingsRow: true, enabled: true, cancellations30d: 4 },
    warn: { settingsRow: false, cancellations30d: 0 },
    error: { settingsRow: true, enabled: false, cancellations30d: 3 },
  },
  "retention.provider_cancel_bypasses_flow": {
    ok: { flowBypass: { withoutFeedback: 0, providerOnly: 0, refs: [] } },
    warn: { flowBypass: { withoutFeedback: 0, providerOnly: 2, refs: [ID(50)] } },
    error: { flowBypass: { withoutFeedback: 1, providerOnly: 0, refs: [ID(50)] } },
  },
  "retention.cancel_flow_too_long": {
    ok: { cancelPathSteps: RETENTION_MAX_STEPS - 1 },
    warn: {
      cancelPathSteps: RETENTION_MAX_STEPS,
      flows30d: { started: 10, canceled: 2, saved: 1, abandoned: 7 },
    },
    error: { cancelPathSteps: RETENTION_MAX_STEPS + 1 },
  },
  "retention.offer_once_discount": {
    ok: { settingsRow: true, enabled: true, discountPeriods: 3, acceptedWithoutDiscount30d: 0 },
    warn: { settingsRow: true, enabled: true, discountPeriods: 1, acceptedWithoutDiscount30d: 0 },
    error: { settingsRow: true, enabled: true, discountPeriods: 3, acceptedWithoutDiscount30d: 2 },
  },
  "dunning.b2b_past_due_unhandled": {
    ok: { openB2b: 2, withoutTask: 2, journeyActive: true, refs: [] },
    warn: { openB2b: 2, withoutTask: 0, journeyActive: false, refs: [ID(60)] },
    error: { openB2b: 2, withoutTask: 1, journeyActive: false, refs: [ID(60)] },
  },
  "funnel.signup_attribution_missing": {
    ok: { signups30d: 10, unknownSource30d: 2 },
    warn: { signups30d: 10, unknownSource30d: 6 },
    error: { signups30d: 10, unknownSource30d: 10 },
  },
  "funnel.signup_popup_for_members": {
    ok: { popupMembers7d: 0, popupMembers30d: 0 },
    warn: { popupMembers7d: 0, popupMembers30d: 2 },
    error: { popupMembers7d: 1, popupMembers30d: 2 },
  },
  "crm.auto_tasks_without_assignee": {
    ok: { autoTasksUnassigned: { open: 0, overdue: 0 } },
    warn: { autoTasksUnassigned: { open: 3, overdue: 0 } },
    error: { autoTasksUnassigned: { open: 3, overdue: 1 } },
  },
  "crm.qualified_without_owner": {
    ok: { qualifiedWithoutOwner: { mqlSql: 0, opportunity: 0, refs: [] } },
    warn: { qualifiedWithoutOwner: { mqlSql: 2, opportunity: 0, refs: [ID(70)] } },
    error: { qualifiedWithoutOwner: { mqlSql: 0, opportunity: 1, refs: [ID(70)] } },
  },
  "crm.leads_without_user_id": {
    ok: { withoutUserId: { registered: 0, customer: 0 } },
    warn: { withoutUserId: { registered: 2, customer: 0 } },
    error: { withoutUserId: { registered: 0, customer: 1 } },
  },
  "newsletter.doi_disabled": {
    ok: { settingsRow: true, doubleOptIn: true, popupEnabled: true },
    // Brak wiersza = DEFAULT kolumn (DOI wyłączone, popup wyłączony) - stan znany.
    warn: { settingsRow: false },
    error: { settingsRow: true, doubleOptIn: false, popupEnabled: true },
  },
  "newsletter.default_sender": {
    ok: { defaultSender: false, campaignsSent30d: 3 },
    warn: { defaultSender: true, campaignsSent30d: 0 },
    error: { defaultSender: true, campaignsSent30d: 2 },
  },
  "workflows.newsletter_confirmed_noop": {
    ok: { newsletterConfirmedNoop: { recent: 0, older: 0, refs: [] } },
    warn: { newsletterConfirmedNoop: { recent: 0, older: 2, refs: [ID(80)] } },
    error: { newsletterConfirmedNoop: { recent: 1, older: 0, refs: [ID(80)] } },
  },
  "workflows.cancel_recipe_fires_on_pause": {
    ok: { cancelRecipe: null },
    warn: { cancelRecipe: recipe(0) },
    error: { cancelRecipe: recipe(2) },
  },
  "workflows.overlaps_journey": {
    ok: { overlaps: { duplicates: [], sharedTrigger: [] } },
    warn: { overlaps: { duplicates: [], sharedTrigger: [overlap] } },
    error: { overlaps: { duplicates: [overlap], sharedTrigger: [] } },
  },
  "journeys.missing_core": {
    ok: { activeTemplates: [...CORE_JOURNEY_TEMPLATES, ...EXTENDED_CORE_JOURNEY_TEMPLATES] },
    warn: { activeTemplates: [...CORE_JOURNEY_TEMPLATES] },
    error: { activeTemplates: [] },
  },
  "journeys.engine_disabled_with_active": {
    ok: { engineEnabled: true, activeCount: 2, pendingInbox: 5 },
    warn: { engineEnabled: false, activeCount: 2, pendingInbox: 0 },
    error: { engineEnabled: false, activeCount: 2, pendingInbox: 5 },
  },
  "journeys.step_error_rate": {
    ok: { stepRuns24h: { finished: 10, failed: 0 } },
    warn: { stepRuns24h: { finished: 10, failed: 2 } },
    error: { stepRuns24h: { finished: 10, failed: 6 } },
  },
  "journeys.inbox_backlog": {
    ok: { pendingInbox: 3, oldestPendingAt: ago(60_000) },
    warn: { pendingInbox: 3, oldestPendingAt: ago(backlogWarn) },
    error: { pendingInbox: 3, oldestPendingAt: ago(SCHEDULER_LAGGING_MS + 60_000) },
  },
  "journeys.dead_steps": {
    ok: { deadSteps: [], deadJourneys: 0 },
    warn: { deadSteps: [{ journeyId: ID(90), unreached: 2, total: 5 }], deadJourneys: 0 },
    error: { deadSteps: [{ journeyId: ID(90), unreached: 5, total: 5 }], deadJourneys: 1 },
  },
  "journeys.trigger_cycle": {
    ok: { cycles: { bounded: 0, unbounded: 0, refs: [] } },
    warn: { cycles: { bounded: 1, unbounded: 0, refs: [ID(91)] } },
    error: { cycles: { bounded: 0, unbounded: 1, refs: [ID(91)] } },
  },
  "events.ticket_benefit_unused": {
    ok: { ticketClaims: { claimedPast: 10, unredeemed: 0 } },
    warn: { ticketClaims: { claimedPast: 10, unredeemed: 3 } },
    error: { ticketClaims: { claimedPast: 10, unredeemed: 6 } },
  },
  "events.upcoming_without_comms_journey": {
    ok: { upcoming30d: 2, upcoming7dWithRegistrations: 1, nurtureActive: true },
    warn: { upcoming30d: 2, upcoming7dWithRegistrations: 0, nurtureActive: false },
    error: { upcoming30d: 2, upcoming7dWithRegistrations: 1, nurtureActive: false },
  },
  "clubs.rank_without_tier": {
    ok: { rankWithoutTier: { impossible: 0, notOfferable: 0, refs: [] } },
    warn: { rankWithoutTier: { impossible: 0, notOfferable: 1, refs: [ID(100)] } },
    error: { rankWithoutTier: { impossible: 1, notOfferable: 0, refs: [ID(100)] } },
  },
  "clubs.pending_applications_over_7d": {
    ok: { pendingApplications: { over7d: 0, over30d: 0, oldestAt: null } },
    warn: { pendingApplications: { over7d: 2, over30d: 0, oldestAt: ago(9 * DAY) } },
    error: { pendingApplications: { over7d: 2, over30d: 1, oldestAt: ago(40 * DAY) } },
  },
  "sync.emitter_silent": {
    ok: { silentDaily: [], silentWeekly: [] },
    warn: { silentDaily: [], silentWeekly: ["crm_lead.created.v1"] },
    error: { silentDaily: ["paywall.hit.v1"], silentWeekly: [] },
  },
  "sync.dead_event_types": {
    ok: { deadTypes: [], unknownTypes: [] },
    warn: { deadTypes: ["club.archived.v1"], unknownTypes: [] },
    error: { deadTypes: [], unknownTypes: ["legacy.type.v0"] },
  },
  "sync.emit_errors": {
    ok: { emitErrors24h: 0, emitErrors7d: 0 },
    warn: { emitErrors24h: 0, emitErrors7d: 3 },
    error: { emitErrors24h: 1, emitErrors7d: 3 },
  },
  "data_quality.documents_env_unknown": {
    ok: { documentsEnvUnknown: { recent30d: 0, older: 0 } },
    warn: { documentsEnvUnknown: { recent30d: 0, older: 3 } },
    error: { documentsEnvUnknown: { recent30d: 1, older: 0 } },
  },
  "data_quality.mrr_catalog_basis": {
    ok: { mrrCatalogBasis: { day: "2026-10-19", share: 0 } },
    warn: { mrrCatalogBasis: { day: "2026-10-19", share: 0.3 } },
    error: { mrrCatalogBasis: { day: "2026-10-19", share: 1 } },
  },
  "data_quality.ledger_drift": {
    ok: { ledgerDrift: { day: "2026-10-19", maxRatio: 0, currencies: [] } },
    warn: {
      ledgerDrift: { day: "2026-10-19", maxRatio: 0.001, currencies: [{ currency: "PLN", ratio: 0.001 }] },
    },
    error: {
      ledgerDrift: { day: "2026-10-19", maxRatio: 0.02, currencies: [{ currency: "EUR", ratio: 0.02 }] },
    },
  },
  "data_quality.benchmark_stale": {
    ok: { benchmarkSources: { total: 10, stale: 0 } },
    warn: { benchmarkSources: { total: 10, stale: 3 } },
    error: { benchmarkSources: { total: 10, stale: 6 } },
  },
  "data_quality.sandbox_only": {
    ok: { live: { subscriptions: 5, lastAt: ago(DAY) }, sandbox: { subscriptions: 2, lastAt: ago(DAY) } },
    warn: { live: { subscriptions: 0, lastAt: null }, sandbox: { subscriptions: 2, lastAt: ago(30 * DAY) } },
    error: { live: { subscriptions: 0, lastAt: null }, sandbox: { subscriptions: 2, lastAt: ago(DAY) } },
  },
};

function factsFor(id: RevenueCheckId, area: Bag | null | undefined, computedAt: string | null = NOW) {
  const check = revenueCheck(id);
  if (!check) throw new Error(`brak reguły ${id}`);
  const areas: Bag = area === undefined ? {} : { [check.area]: area };
  return parseRevenueFacts({ v: 1, computedAt, areas });
}

function stateOf(id: RevenueCheckId, facts: RevenueFacts): RevenueCheckState {
  return runCheck(revenueCheck(id)!, facts).state;
}

describe("fikstury obejmują cały rejestr", () => {
  it("każda reguła ma przypadki ok/warn/error", () => {
    expect(Object.keys(CASES).sort()).toEqual([...REVENUE_CHECK_IDS].sort());
  });
});

describe.each(REVENUE_CHECK_IDS.map((id) => [id] as const))("%s", (id) => {
  const fixture = CASES[id];

  it.each(["ok", "warn", "error"] as const)("fakty %s → stan %s", (state) => {
    expect(stateOf(id, factsFor(id, fixture[state]))).toBe(state);
  });

  it("brak obszaru → unknown (nigdy cicha zieleń)", () => {
    expect(stateOf(id, factsFor(id, undefined))).toBe("unknown");
    expect(stateOf(id, factsFor(id, null))).toBe("unknown");
  });

  it("brak pola w obszarze → unknown", () => {
    expect(stateOf(id, factsFor(id, {}))).toBe("unknown");
  });

  it("problem (warn/error) niesie dowód ze znanym kluczem i liczby bez PII", () => {
    for (const state of ["warn", "error"] as const) {
      const result = runCheck(revenueCheck(id)!, factsFor(id, fixture[state]));
      expect(result.evidence?.length ?? 0).toBeGreaterThan(0);
      for (const item of result.evidence ?? []) {
        expect(item.key).toMatch(/^[a-z][A-Za-z0-9]+$/);
        for (const value of Object.values(item.params)) expect(String(value)).not.toContain("@");
      }
    }
  });
});

describe("przypadki brzegowe reguł", () => {
  it("roczny rabat: redaktor (kwoty null) → unknown, nie ok", () => {
    const facts = factsFor("catalog.annual_discount_out_of_range", {
      plans: [plan({ priceCents: null }), plan({ id: ID(2), interval: "year", priceCents: null })],
    });
    expect(stateOf("catalog.annual_discount_out_of_range", facts)).toBe("unknown");
  });

  it("roczny rabat: rok tańszy niż miesiąc to błąd wpisu (error)", () => {
    const facts = factsFor("catalog.annual_discount_out_of_range", {
      plans: [plan(), plan({ id: ID(2), interval: "year", priceCents: 4000 })],
    });
    expect(stateOf("catalog.annual_discount_out_of_range", facts)).toBe("error");
  });

  it("pomiar paywalla: bez `computedAt` nie da się ocenić ciszy", () => {
    const facts = factsFor("paywall.measurement_silent", CASES["paywall.measurement_silent"].error, null);
    expect(stateOf("paywall.measurement_silent", facts)).toBe("unknown");
  });

  it("pomiar paywalla: treść płatna od wczoraj bez uderzeń to jeszcze nie cisza", () => {
    const facts = factsFor("paywall.measurement_silent", {
      gatedRules: 2,
      firstGatedAt: ago(DAY),
      lastHitAt: null,
    });
    expect(stateOf("paywall.measurement_silent", facts)).toBe("ok");
  });

  it("licznik gości: licznik wyłączony nie ma limitu gości (ok)", () => {
    const facts = factsFor("metering.anon_zero_limit", {
      settingsRow: true,
      enabled: false,
      anonMonthlyLimit: 0,
      memberMonthlyLimit: 0,
    });
    expect(stateOf("metering.anon_zero_limit", facts)).toBe("ok");
  });

  it("sonda rangi `null` (funkcja nieznana) → unknown", () => {
    const facts = factsFor("metering.rank_bypass", { rankGatePresent: null, meteredTierGated: 3 });
    expect(stateOf("metering.rank_bypass", facts)).toBe("unknown");
  });

  it("kasa bez wiersza ustawień ocenia domyślne okno (24 h)", () => {
    const facts = factsFor("checkout.abandon_window_default", {
      settingsRow: false,
      abandonedJourneyActive: true,
    });
    expect(stateOf("checkout.abandon_window_default", facts)).toBe("error");
  });

  it("retencja na granicy dwóch kroków bez danych przepływu → unknown", () => {
    const facts = factsFor("retention.cancel_flow_too_long", { cancelPathSteps: RETENTION_MAX_STEPS });
    expect(stateOf("retention.cancel_flow_too_long", facts)).toBe("unknown");
  });

  it("retencja na granicy dwóch kroków, gdy większość kończy przepływ → ok", () => {
    const facts = factsFor("retention.cancel_flow_too_long", {
      cancelPathSteps: RETENTION_MAX_STEPS,
      flows30d: { started: 10, canceled: 4, saved: 3, abandoned: 3 },
    });
    expect(stateOf("retention.cancel_flow_too_long", facts)).toBe("ok");
  });

  it("newsletter bez wiersza używa DEFAULT kolumn (lustro migracji)", () => {
    expect(NEWSLETTER_COLUMN_DEFAULTS).toEqual({ enabled: true, doubleOptIn: false, popupEnabled: false });
  });

  it("przepis anulowania z bramką pauzy → ok", () => {
    const facts = factsFor("workflows.cancel_recipe_fires_on_pause", {
      cancelRecipe: { ...recipe(5), guarded: true },
    });
    expect(stateOf("workflows.cancel_recipe_fires_on_pause", facts)).toBe("ok");
  });

  it("zaległość skrzynki: świeża (≤ próg harmonogramu) → ok", () => {
    const facts = factsFor("journeys.inbox_backlog", {
      pendingInbox: 3,
      oldestPendingAt: ago(SCHEDULER_FRESH_MS),
    });
    expect(stateOf("journeys.inbox_backlog", facts)).toBe("ok");
  });

  it("tolerancja rozjazdu księgi = BRIDGE_TOLERANCE mostka MRR (lustro)", () => {
    expect(LEDGER_DRIFT_TOLERANCE).toBe(BRIDGE_TOLERANCE);
  });

  it("rozjazd księgi `null` (redaktor albo brak migawek) → unknown", () => {
    const facts = factsFor("data_quality.ledger_drift", { ledgerDrift: null });
    expect(stateOf("data_quality.ledger_drift", facts)).toBe("unknown");
  });

  it("wyjątek w regule = unknown, nie awaria listy", () => {
    const broken = { ...REVENUE_CHECKS[0], evaluate: () => { throw new Error("bug"); } };
    expect(runCheck(broken, factsFor("catalog.plan_without_tier", {})).state).toBe("unknown");
  });
});
