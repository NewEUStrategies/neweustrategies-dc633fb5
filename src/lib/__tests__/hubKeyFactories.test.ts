// FABRYKI KLUCZY HUBA - KSZTAŁT = DZISIEJSZY LITERAŁ (SPEC §5.3, AD-05).
//
// PO CO TABELA PAR. Fabryka zastępuje literały rozsiane po ekranach i po
// mapie szyny. Jeśli wywołanie zwróci tablicę choćby o jeden element inną niż
// literał, który zastępuje, cache przestaje trafiać: ekran pyta o nowy klucz,
// a reguła szyny unieważnia stary - lista „na żywo" zamiera bez błędu. Każdy
// wiersz niżej to para „wywołanie → literał z repo (plik:linia)"; ta sama
// tabela idzie do opisu PR jako dowód zero-migracji cache. Klucze nowe (bez
// literału) wskazują źródło kontraktu (SPEC/DANE).
//
// Wiersz musi istnieć dla KAŻDEJ funkcji każdej fabryki - test „kompletność"
// wylicza funkcje w runtime, więc nowa funkcja bez wiersza jest czerwona.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { accessKeys, checkoutKeys, meteringKeys } from "@/lib/access/keys";
import { couponKeys } from "@/lib/admin/couponKeys";
import { workflowKeys } from "@/lib/admin/workflowKeys";
import { billingKeys } from "@/lib/billing/keys";
import { bezKomentarzy } from "@/lib/ci/sourceScan";
import { crmKeys } from "@/lib/crm/keys";
import { journeyKeys } from "@/lib/journeys/keys";
import { newsletterKeys } from "@/lib/newsletter/keys";
import { retentionKeys } from "@/lib/retention/keys";
import { REVENUE_DOMAINS, revenueKeys } from "@/lib/revenue/keys";
import type { RevenueRange } from "@/lib/revenue/window";

// Dawna stała `couponQueries.ts:22` (`ADMIN_COUPONS_KEY`) - S1 ją usunął
// (jedna definicja w `couponKeys.ts`, PLAN S1 §4.6). Literał zostaje TU jako
// świadek kształtu sprzed fabryki: para „wywołanie = literał z repo".
const ADMIN_COUPONS_KEY = ["admin", "b2b-coupons"] as const;

const T = "tenant-1";
const ID = "00000000-0000-4000-8000-000000000001";
const LEAD = "00000000-0000-4000-8000-000000000002";
const RANGE: Pick<RevenueRange, "period" | "current"> = {
  period: "month",
  current: { sinceIso: "2026-10-01T00:00:00.000Z", untilIso: "2026-10-19T12:00:00.000Z" },
};

interface Para {
  /** Ścieżka funkcji w fabryce (`crmKeys.tasksDue`). */
  fn: string;
  actual: readonly unknown[];
  expected: readonly unknown[];
  /** Skąd literał: `plik:linia` na bazie `baec9c64` albo źródło kontraktu. */
  zrodlo: string;
}

const LEAD_PARAMS = { search: "", scope: "all", serverParams: {}, page: 1, pageSize: 50 };
const FUNNEL_PARAMS = { search: "", audience: "all", status: "all" };
const MEMBER_PARAMS = { search: null, tierKey: null, page: 1 };
const AUDIENCE = { tiers: ["member"] };

const PARY: readonly Para[] = [
  // ── CRM (`src/lib/crm/keys.ts`) ───────────────────────────────────────────
  {
    fn: "crmKeys.leadsAll",
    actual: crmKeys.leadsAll(),
    expected: ["crm-leads"],
    zrodlo: "src/components/admin/crm/ScoringSettingsDialog.tsx:122",
  },
  {
    fn: "crmKeys.leads",
    actual: crmKeys.leads(LEAD_PARAMS),
    expected: ["crm-leads", LEAD_PARAMS],
    zrodlo: "src/routes/admin.crm.index.tsx:563",
  },
  {
    fn: "crmKeys.lead",
    actual: crmKeys.lead(LEAD),
    expected: ["crm-lead", LEAD],
    zrodlo: "src/routes/admin.crm.$id.tsx:187",
  },
  {
    fn: "crmKeys.leadTimeline",
    actual: crmKeys.leadTimeline(LEAD),
    expected: ["crm-lead-timeline", LEAD],
    zrodlo: "src/routes/admin.crm.$id.tsx:194",
  },
  {
    fn: "crmKeys.leadMetering",
    actual: crmKeys.leadMetering(LEAD),
    expected: ["crm-lead-metering", LEAD],
    zrodlo: "src/components/admin/crm/MeteringUsageCard.tsx:23",
  },
  {
    fn: "crmKeys.leadMeteringAll",
    actual: crmKeys.leadMeteringAll(),
    expected: ["crm-lead-metering"],
    zrodlo: "nowy prefiks (SPEC §3.3: paywall.hit.v1, metering_settings.changed.v1)",
  },
  {
    fn: "crmKeys.leadStageHistory",
    actual: crmKeys.leadStageHistory(LEAD),
    expected: ["crm-lead-stage-history", LEAD],
    zrodlo: "nowy (SPEC §5.3)",
  },
  {
    fn: "crmKeys.tasksAll",
    actual: crmKeys.tasksAll(),
    expected: ["crm-tasks"],
    zrodlo: "src/components/admin/crm/FollowUpsPanel.tsx:53",
  },
  {
    fn: "crmKeys.tasksDue",
    actual: crmKeys.tasksDue(),
    expected: ["crm-tasks", "due"],
    zrodlo: "src/components/admin/crm/FollowUpsPanel.tsx:42",
  },
  {
    fn: "crmKeys.tasksForLead",
    actual: crmKeys.tasksForLead(LEAD),
    expected: ["crm-tasks", "lead", LEAD],
    zrodlo: "src/components/admin/crm/LeadTasksPanel.tsx:76",
  },
  {
    fn: "crmKeys.scoringSettings",
    actual: crmKeys.scoringSettings(),
    expected: ["crm-scoring-settings"],
    zrodlo: "src/components/admin/crm/ScoringSettingsDialog.tsx:87",
  },
  {
    fn: "crmKeys.funnelAll",
    actual: crmKeys.funnelAll(),
    expected: ["crm-funnel"],
    zrodlo: "src/routes/admin.crm.funnel.index.tsx:304",
  },
  {
    fn: "crmKeys.funnel",
    actual: crmKeys.funnel(FUNNEL_PARAMS),
    expected: ["crm-funnel", FUNNEL_PARAMS],
    zrodlo: "src/routes/admin.crm.funnel.index.tsx:266",
  },
  {
    fn: "crmKeys.funnelStats",
    actual: crmKeys.funnelStats(),
    expected: ["crm-funnel-stats"],
    zrodlo: "src/routes/admin.crm.funnel.index.tsx:281",
  },
  {
    fn: "crmKeys.companies",
    actual: crmKeys.companies(),
    expected: ["admin", "crm-companies"],
    zrodlo: "src/routes/admin.companies.index.tsx:305",
  },
  {
    fn: "crmKeys.companiesList",
    actual: crmKeys.companiesList("acme"),
    expected: ["admin", "crm-companies", "acme"],
    zrodlo: "src/routes/admin.companies.index.tsx:204",
  },
  {
    fn: "crmKeys.partnerEndpoints",
    actual: crmKeys.partnerEndpoints(),
    expected: ["admin", "crm-partner-endpoints"],
    zrodlo: "src/components/admin/crm/CrmPartnerEndpointsPanel.tsx:131",
  },
  {
    // Integrator S4: klucz zespołu CRM żył w S4 jako `crmStaffUsersKey()`
    // w `leadMutations.ts` (fabryka I0 nie miała wpisu) - ten sam kształt.
    fn: "crmKeys.staffUsers",
    actual: crmKeys.staffUsers(),
    expected: ["crm-staff-users"],
    zrodlo: "src/lib/crm/leadMutations.ts:148 (hub/s4-crm-spolecznosc przed integracją)",
  },

  // ── Newsletter (`src/lib/newsletter/keys.ts`) ─────────────────────────────
  {
    fn: "newsletterKeys.subscribersAll",
    actual: newsletterKeys.subscribersAll(),
    expected: ["newsletter-subscribers"],
    zrodlo: "src/components/admin/newsletter/SubscribersPanel.tsx:47",
  },
  {
    fn: "newsletterKeys.kpis",
    actual: newsletterKeys.kpis(),
    expected: ["newsletter-kpis"],
    zrodlo: "src/components/admin/newsletter/OverviewPanel.tsx:56",
  },
  {
    fn: "newsletterKeys.settings",
    actual: newsletterKeys.settings(),
    expected: ["newsletter-settings"],
    zrodlo: "src/hooks/useNewsletterSettings.ts:200",
  },
  {
    fn: "newsletterKeys.settingsInline",
    actual: newsletterKeys.settingsInline(),
    expected: ["newsletter-settings", "inline"],
    zrodlo: "src/hooks/useNewsletterSettings.ts:316",
  },
  {
    fn: "newsletterKeys.campaignsAll",
    actual: newsletterKeys.campaignsAll(),
    expected: ["admin", "newsletter-campaigns"],
    zrodlo: "src/routes/admin.newsletter.campaigns.index.tsx:119",
  },
  {
    fn: "newsletterKeys.campaign",
    actual: newsletterKeys.campaign(ID),
    expected: ["admin", "newsletter-campaigns", ID],
    zrodlo: "src/routes/admin.newsletter.campaigns.$id.tsx:106",
  },
  {
    fn: "newsletterKeys.campaignEngagement",
    actual: newsletterKeys.campaignEngagement(ID),
    expected: ["admin", "newsletter-campaigns", ID, "engagement"],
    zrodlo: "src/routes/admin.newsletter.campaigns.$id.tsx:146",
  },
  {
    fn: "newsletterKeys.campaignAudience",
    actual: newsletterKeys.campaignAudience(ID, AUDIENCE),
    expected: ["admin", "newsletter-campaigns", ID, "audience", AUDIENCE],
    zrodlo: "src/routes/admin.newsletter.campaigns.$id.tsx:140",
  },
  {
    fn: "newsletterKeys.popupEventsAll",
    actual: newsletterKeys.popupEventsAll(),
    expected: ["admin", "newsletter-popup-events"],
    zrodlo: "nowy prefiks (DANE §4.3)",
  },
  {
    fn: "newsletterKeys.popupEvents",
    actual: newsletterKeys.popupEvents(30),
    expected: ["admin", "newsletter-popup-events", 30],
    zrodlo: "src/components/admin/newsletter/PopupEventsPanel.tsx:40",
  },

  // ── Dostęp, metering, kasa (`src/lib/access/keys.ts`) ─────────────────────
  {
    fn: "accessKeys.ruleAll",
    actual: accessKeys.ruleAll(),
    expected: ["content_access"],
    zrodlo: "nowy prefiks (SPEC §3.3: content_access.changed.v1 bez pól encji)",
  },
  {
    fn: "accessKeys.rule",
    actual: accessKeys.rule("post", ID),
    expected: ["content_access", "post", ID],
    zrodlo: "src/components/admin/PostGeneralOverview.tsx:220, AccessSettingsPane.tsx:205",
  },
  {
    fn: "accessKeys.overrides",
    actual: accessKeys.overrides(),
    expected: ["metering-overrides"],
    zrodlo: "src/routes/admin.paywall.tsx:903",
  },
  {
    fn: "meteringKeys.settings",
    actual: meteringKeys.settings(),
    expected: ["metering-settings"],
    zrodlo: "src/lib/access/metering.ts:345, src/routes/admin.paywall.tsx:622",
  },
  {
    fn: "meteringKeys.impactPreviewAll",
    actual: meteringKeys.impactPreviewAll(),
    expected: ["metering-impact-preview"],
    zrodlo: "nowy prefiks (SPEC §3.3: metering_settings.changed.v1)",
  },
  {
    fn: "meteringKeys.impactPreview",
    actual: meteringKeys.impactPreview(7),
    expected: ["metering-impact-preview", 7],
    zrodlo: "src/routes/admin.paywall.tsx:741",
  },
  {
    fn: "checkoutKeys.settings",
    actual: checkoutKeys.settings(),
    expected: ["checkout-settings"],
    zrodlo: "src/hooks/useCheckoutSettings.ts:13",
  },

  // ── Retencja (`src/lib/retention/keys.ts`) ────────────────────────────────
  {
    fn: "retentionKeys.settingsPublic",
    actual: retentionKeys.settingsPublic(),
    expected: ["retention-settings"],
    zrodlo: "src/lib/retention/queries.ts:14",
  },
  {
    fn: "retentionKeys.reasonsPublic",
    actual: retentionKeys.reasonsPublic(),
    expected: ["retention-reasons"],
    zrodlo: "src/lib/retention/queries.ts:26",
  },
  {
    fn: "retentionKeys.admin.settings",
    actual: retentionKeys.admin.settings(),
    expected: ["admin", "retention-settings"],
    zrodlo: "src/components/admin/pricing/organisms/RetentionTab.tsx:41",
  },
  {
    fn: "retentionKeys.admin.reasons",
    actual: retentionKeys.admin.reasons(),
    expected: ["admin", "retention-reasons"],
    zrodlo: "src/components/admin/pricing/organisms/RetentionTab.tsx:49",
  },
  {
    fn: "retentionKeys.admin.feedback",
    actual: retentionKeys.admin.feedback(),
    expected: ["admin", "retention-feedback"],
    zrodlo:
      "src/components/admin/pricing/organisms/RetentionTab.tsx:60, admin.monetization.tsx:307",
  },

  // ── Automatyzacje (`src/lib/admin/workflowKeys.ts`) ───────────────────────
  {
    fn: "workflowKeys.definitions",
    actual: workflowKeys.definitions(),
    expected: ["admin", "workflow-definitions"],
    zrodlo: "src/routes/admin.workflows.tsx:90",
  },
  {
    fn: "workflowKeys.templates",
    actual: workflowKeys.templates(),
    expected: ["admin", "workflow-templates"],
    zrodlo: "src/routes/admin.workflows.tsx:100",
  },
  {
    fn: "workflowKeys.runsWindow",
    actual: workflowKeys.runsWindow(500),
    expected: ["admin", "workflow-runs-window", 500],
    zrodlo: "src/routes/admin.workflows.tsx:95",
  },
  {
    fn: "workflowKeys.runsAll",
    actual: workflowKeys.runsAll(),
    expected: ["admin", "workflow-runs"],
    zrodlo: "nowy prefiks (DANE §4.3)",
  },
  {
    fn: "workflowKeys.runs",
    actual: workflowKeys.runs(ID, null),
    expected: ["admin", "workflow-runs", ID, null],
    zrodlo: "src/components/admin/workflows/WorkflowRunsPanel.tsx:49",
  },
  {
    fn: "workflowKeys.trace",
    actual: workflowKeys.trace(ID),
    expected: ["admin", "correlation-trace", ID],
    zrodlo: "src/components/admin/workflows/CorrelationTracePanel.tsx:47",
  },

  // ── Kupony (`src/lib/admin/couponKeys.ts`) ────────────────────────────────
  {
    fn: "couponKeys.admin",
    actual: couponKeys.admin(),
    expected: ADMIN_COUPONS_KEY,
    zrodlo: "src/lib/admin/couponQueries.ts:22 (ADMIN_COUPONS_KEY)",
  },
  {
    fn: "couponKeys.plans",
    actual: couponKeys.plans(),
    expected: [...ADMIN_COUPONS_KEY, "plans"],
    zrodlo: "src/components/admin/coupons/organisms/CouponsListPage.tsx:75",
  },
  {
    fn: "couponKeys.tiers",
    actual: couponKeys.tiers(),
    expected: [...ADMIN_COUPONS_KEY, "tiers"],
    zrodlo: "src/components/admin/coupons/organisms/CampaignsPage.tsx:74",
  },
  {
    fn: "couponKeys.campaigns",
    actual: couponKeys.campaigns(),
    expected: ["admin", "b2b-coupon-campaigns"],
    zrodlo: "src/components/admin/coupons/organisms/CampaignsPage.tsx:59",
  },
  {
    fn: "couponKeys.redemptionsAll",
    actual: couponKeys.redemptionsAll(),
    expected: ["admin", "b2b-coupon-redemptions"],
    zrodlo: "nowy prefiks (SPEC §3.3: coupon.redeemed.v1)",
  },
  {
    fn: "couponKeys.redemptions",
    actual: couponKeys.redemptions("2026-09-19T00:00:00.000Z", null),
    expected: ["admin", "b2b-coupon-redemptions", "2026-09-19T00:00:00.000Z", null],
    zrodlo: "src/routes/admin.coupons.redemptions.tsx:58",
  },

  // ── Billing - pozycje dopisane w I0 (`src/lib/billing/keys.ts`) ───────────
  {
    fn: "billingKeys.admin.plansAll",
    actual: billingKeys.admin.plansAll(),
    expected: ["admin", "plans-all"],
    zrodlo: "nowy (SPEC §5.3) - zastąpi [admin-access-plans] z admin.paywall.tsx:72 w S1",
  },
  {
    fn: "billingKeys.admin.paymentOrders",
    actual: billingKeys.admin.paymentOrders(),
    expected: ["admin", "payment-orders"],
    zrodlo: "nowy prefiks (SPEC §3.3: checkout.*)",
  },
  {
    fn: "billingKeys.admin.paymentOrdersList",
    actual: billingKeys.admin.paymentOrdersList("all", "live"),
    expected: ["admin", "payment-orders", "all", "live"],
    zrodlo: "src/components/admin/billing/AdminPaymentOrdersPanel.tsx:56",
  },
  {
    fn: "billingKeys.admin.testPlans",
    actual: billingKeys.admin.testPlans(),
    expected: ["admin", "billing", "test-plans"],
    zrodlo: "src/components/admin/billing/AdminPaymentsDiagnosticsPanel.tsx:71",
  },
  {
    fn: "billingKeys.admin.jobRunner",
    actual: billingKeys.admin.jobRunner(),
    expected: ["admin", "billing", "job-runner"],
    zrodlo: "src/components/admin/billing/AdminBillingPanel.tsx:129",
  },
  {
    fn: "billingKeys.admin.members",
    actual: billingKeys.admin.members(),
    expected: ["admin-members"],
    zrodlo: "baec9c64 src/components/admin/members/MemberTierDialog.tsx:68",
  },
  {
    fn: "billingKeys.admin.membersDirectory",
    actual: billingKeys.admin.membersDirectory(MEMBER_PARAMS),
    expected: ["admin-members", MEMBER_PARAMS],
    zrodlo: "baec9c64 src/components/admin/members/MembersDirectoryPanel.tsx:68",
  },
  {
    fn: "billingKeys.admin.memberBilling",
    actual: billingKeys.admin.memberBilling(ID),
    expected: ["admin-member-billing", ID],
    zrodlo:
      "baec9c64 src/components/admin/members/MemberBillingDetails.tsx:20, MemberTierDialog.tsx:70",
  },
  {
    fn: "billingKeys.admin.memberBillingAll",
    actual: billingKeys.admin.memberBillingAll(),
    expected: ["admin-member-billing"],
    zrodlo: "nowy prefiks (SPEC §3.3: membership_grant.*)",
  },
  {
    fn: "billingKeys.admin.monetizationLedger",
    actual: billingKeys.admin.monetizationLedger("all"),
    expected: ["admin", "monetization", "ledger", "all"],
    zrodlo: "baec9c64 src/components/admin/monetization/organisms/AdminMonetizationLedger.tsx:28",
  },
  // Sierota długu przepisana w I0 na ISTNIEJĄCE funkcje fabryki.
  {
    fn: "billingKeys.orgSeats",
    actual: billingKeys.orgSeats(ID),
    expected: ["org-seats", ID],
    zrodlo: "baec9c64 src/routes/profile.organization.tsx:190",
  },
  {
    fn: "billingKeys.myOrganizationAll",
    actual: billingKeys.myOrganizationAll(),
    expected: ["my-organization"],
    zrodlo: "baec9c64 src/routes/profile.organization.tsx:191",
  },

  // ── Hub przychodu (`src/lib/revenue/keys.ts`) - kontrakt SPEC §5.3 ───────
  {
    fn: "revenueKeys.root",
    actual: revenueKeys.root(),
    expected: ["admin-revenue"],
    zrodlo: "SPEC §5.3",
  },
  {
    fn: "revenueKeys.domain",
    actual: revenueKeys.domain("mrr"),
    expected: ["admin-revenue", "mrr"],
    zrodlo: "SPEC §5.3",
  },
  {
    fn: "revenueKeys.domainTenant",
    actual: revenueKeys.domainTenant("mrr", T),
    expected: ["admin-revenue", "mrr", T],
    zrodlo: "SPEC §5.3",
  },
  {
    fn: "revenueKeys.query",
    actual: revenueKeys.query("funnel", T, RANGE, { track: "sales", currency: "PLN" }),
    expected: [
      "admin-revenue",
      "funnel",
      T,
      "month",
      RANGE.current.sinceIso,
      RANGE.current.untilIso,
      "PLN",
      null,
      null,
      null,
      "sales",
    ],
    zrodlo: "SPEC §5.3",
  },
  {
    fn: "revenueKeys.facts",
    actual: revenueKeys.facts(T),
    expected: ["admin-revenue", "diagnostics", T, "facts"],
    zrodlo: "SPEC §5.3 (N1)",
  },
  {
    fn: "revenueKeys.snoozes",
    actual: revenueKeys.snoozes(T),
    expected: ["admin-revenue", "diagnostics", T, "snoozes"],
    zrodlo: "SPEC §5.3",
  },
  {
    fn: "revenueKeys.accessInventory",
    actual: revenueKeys.accessInventory(T),
    expected: ["admin-revenue", "access", T, "inventory"],
    zrodlo: "SPEC §5.3",
  },
  {
    fn: "revenueKeys.offerMatrix",
    actual: revenueKeys.offerMatrix(T),
    expected: ["admin-revenue", "offer", T, "matrix"],
    zrodlo: "SPEC §5.3",
  },
  {
    fn: "revenueKeys.manualInputs",
    actual: revenueKeys.manualInputs(T, "2026-01-01", "2026-12-01"),
    expected: ["admin-revenue", "inputs", T, "2026-01-01", "2026-12-01"],
    zrodlo: "SPEC §5.3",
  },

  // ── Ścieżki (`src/lib/journeys/keys.ts`) - kontrakt DANE §4.5 + SPEC §5.3 ─
  {
    fn: "journeyKeys.root",
    actual: journeyKeys.root(),
    expected: ["admin", "journeys"],
    zrodlo: "DANE §4.5",
  },
  {
    fn: "journeyKeys.list",
    actual: journeyKeys.list(T, "active"),
    expected: ["admin", "journeys", "list", T, "active"],
    zrodlo: "DANE §4.5",
  },
  {
    fn: "journeyKeys.listAll",
    actual: journeyKeys.listAll(),
    expected: ["admin", "journeys", "list"],
    zrodlo: "DANE §4.5",
  },
  {
    fn: "journeyKeys.detail",
    actual: journeyKeys.detail(ID),
    expected: ["admin", "journeys", "detail", ID],
    zrodlo: "DANE §4.5",
  },
  {
    fn: "journeyKeys.version",
    actual: journeyKeys.version(ID, LEAD),
    expected: ["admin", "journeys", "version", ID, LEAD],
    zrodlo: "DANE §4.5",
  },
  {
    fn: "journeyKeys.versions",
    actual: journeyKeys.versions(ID),
    expected: ["admin", "journeys", "versions", ID],
    zrodlo: "DANE §4.5",
  },
  {
    fn: "journeyKeys.stats",
    actual: journeyKeys.stats(ID, null, RANGE.current.sinceIso, RANGE.current.untilIso),
    expected: [
      "admin",
      "journeys",
      "stats",
      ID,
      null,
      RANGE.current.sinceIso,
      RANGE.current.untilIso,
    ],
    zrodlo: "DANE §4.5",
  },
  {
    fn: "journeyKeys.statsFor",
    actual: journeyKeys.statsFor(ID),
    expected: ["admin", "journeys", "stats", ID],
    zrodlo: "DANE §4.5",
  },
  {
    fn: "journeyKeys.enrollments",
    actual: journeyKeys.enrollments(ID, "n3", "waiting", 2),
    expected: ["admin", "journeys", "enrollments", ID, "n3", "waiting", 2],
    zrodlo: "SPEC §5.3 (z węzłem)",
  },
  {
    fn: "journeyKeys.enrollmentsFor",
    actual: journeyKeys.enrollmentsFor(ID),
    expected: ["admin", "journeys", "enrollments", ID],
    zrodlo: "DANE §4.5",
  },
  {
    fn: "journeyKeys.forLead",
    actual: journeyKeys.forLead(LEAD),
    expected: ["admin", "journeys", "lead", LEAD],
    zrodlo: "DANE §4.5",
  },
  {
    fn: "journeyKeys.forLeadAll",
    actual: journeyKeys.forLeadAll(),
    expected: ["admin", "journeys", "lead"],
    zrodlo: "DANE §4.5",
  },
  {
    fn: "journeyKeys.templates",
    actual: journeyKeys.templates(T),
    expected: ["admin", "journeys", "templates", T],
    zrodlo: "DANE §4.5",
  },
  {
    fn: "journeyKeys.triggerEstimate",
    actual: journeyKeys.triggerEstimate(T, "paywall.hit.v1", "h1"),
    expected: ["admin", "journeys", "estimate", T, "paywall.hit.v1", "h1"],
    zrodlo: "DANE §4.5",
  },
  {
    fn: "journeyKeys.simulate",
    actual: journeyKeys.simulate(ID, LEAD, "c1"),
    expected: ["admin", "journeys", "simulate", ID, LEAD, "c1"],
    zrodlo: "DANE §4.5",
  },
  {
    fn: "journeyKeys.settings",
    actual: journeyKeys.settings(T),
    expected: ["admin", "journeys", "settings", T],
    zrodlo: "DANE §4.5",
  },
  {
    fn: "journeyKeys.engineHealth",
    actual: journeyKeys.engineHealth(T),
    expected: ["admin", "journeys", "health", T],
    zrodlo: "DANE §4.5",
  },
];

/** Fabryki w całości nowe w I0 - każda ich funkcja musi mieć wiersz w tabeli. */
const FABRYKI_I0: Readonly<Record<string, object>> = {
  accessKeys,
  checkoutKeys,
  couponKeys,
  crmKeys,
  journeyKeys,
  meteringKeys,
  newsletterKeys,
  retentionKeys,
  revenueKeys,
  workflowKeys,
};

/** Pozycje `billingKeys.admin` dopisane w I0 (reszta fabryki ma własne testy). */
const BILLING_I0 = [
  "plansAll",
  "paymentOrders",
  "paymentOrdersList",
  "testPlans",
  "jobRunner",
  "members",
  "membersDirectory",
  "memberBilling",
  "memberBillingAll",
  "monetizationLedger",
] as const;

function funkcje(nazwa: string, fabryka: object): string[] {
  return Object.entries(fabryka).flatMap(([pole, wartosc]) => {
    if (typeof wartosc === "function") return [`${nazwa}.${pole}`];
    if (typeof wartosc === "object" && wartosc !== null)
      return funkcje(`${nazwa}.${pole}`, wartosc);
    return [];
  });
}

const isPrefix = (prefix: readonly unknown[], key: readonly unknown[]) =>
  prefix.length <= key.length && prefix.every((el, i) => Object.is(el, key[i]));

describe("fabryki kluczy huba - wywołanie = literał z repo", () => {
  it.each(PARY.map((p) => [p.fn, p.zrodlo, p] as const))("%s ⇐ %s", (_fn, _zrodlo, para) => {
    expect(para.actual).toEqual(para.expected);
  });

  it("kompletność: każda funkcja nowych fabryk ma wiersz w tabeli", () => {
    const wTabeli = new Set(PARY.map((p) => p.fn));
    const wymagane = [
      ...Object.entries(FABRYKI_I0).flatMap(([n, f]) => funkcje(n, f)),
      ...BILLING_I0.map((k) => `billingKeys.admin.${k}`),
    ];
    expect(wymagane.filter((fn) => !wTabeli.has(fn))).toEqual([]);
    expect(BILLING_I0.filter((k) => typeof billingKeys.admin[k] !== "function")).toEqual([]);
  });
});

describe("fabryki kluczy huba - inwarianty", () => {
  it("klucze list i agregatów huba niosą najemcę", () => {
    // Bez najemcy przełączenie obszaru roboczego podałoby z cache agregaty
    // cudzej firmy (inwariant `lib/analytics/queryKeys.ts`).
    const zNajemca = [
      revenueKeys.domainTenant("snapshot", T),
      revenueKeys.query("snapshot", T, RANGE),
      revenueKeys.facts(T),
      revenueKeys.snoozes(T),
      revenueKeys.accessInventory(T),
      revenueKeys.offerMatrix(T),
      revenueKeys.manualInputs(T, "2026-01-01", "2026-03-01"),
      journeyKeys.list(T, null),
      journeyKeys.templates(T),
      journeyKeys.triggerEstimate(T, "account.registered.v1", "h"),
      journeyKeys.settings(T),
      journeyKeys.engineHealth(T),
    ];
    expect(zNajemca.filter((k) => !k.includes(T))).toEqual([]);
  });

  it("każda dziedzina ma prefiks, który obejmuje odczyt okresowy i odczyty bez okna", () => {
    expect(REVENUE_DOMAINS).toHaveLength(16);
    expect(REVENUE_DOMAINS).toContain("email");
    for (const d of REVENUE_DOMAINS) {
      expect(isPrefix(revenueKeys.domainTenant(d, T), revenueKeys.query(d, T, RANGE))).toBe(true);
      expect(isPrefix(revenueKeys.domain(d), revenueKeys.domainTenant(d, T))).toBe(true);
      expect(isPrefix(revenueKeys.root(), revenueKeys.domain(d))).toBe(true);
    }
    expect(isPrefix(revenueKeys.domainTenant("diagnostics", T), revenueKeys.facts(T))).toBe(true);
    expect(isPrefix(revenueKeys.domainTenant("diagnostics", T), revenueKeys.snoozes(T))).toBe(true);
    expect(isPrefix(revenueKeys.domainTenant("access", T), revenueKeys.accessInventory(T))).toBe(
      true,
    );
    expect(isPrefix(revenueKeys.domainTenant("offer", T), revenueKeys.offerMatrix(T))).toBe(true);
    expect(
      isPrefix(revenueKeys.domainTenant("inputs", T), revenueKeys.manualInputs(T, "a", "b")),
    ).toBe(true);
  });

  it("`revenueKeys.query` ma 11 pozycji i stałą kolejność filtrów", () => {
    const bezFiltrow = revenueKeys.query("mrr", T, RANGE);
    const pustePola = revenueKeys.query("mrr", T, RANGE, {
      currency: null,
      segment: undefined,
    });
    expect(bezFiltrow).toHaveLength(11);
    // Ten sam odczyt = ten sam klucz, niezależnie od tego, jak ekran podał brak filtra.
    expect(pustePola).toEqual(bezFiltrow);
    const pelne = revenueKeys.query("mrr", T, RANGE, {
      track: "t",
      category: "c",
      grain: "g",
      segment: "s",
      currency: "PLN",
    });
    expect(pelne.slice(6)).toEqual(["PLN", "s", "g", "c", "t"]);
  });

  it("prefiksy `*All` / `*For` / rodzica obejmują klucze szczegółowe", () => {
    const pary: [readonly unknown[], readonly unknown[]][] = [
      [crmKeys.leadsAll(), crmKeys.leads(LEAD_PARAMS)],
      [crmKeys.leadMeteringAll(), crmKeys.leadMetering(LEAD)],
      [crmKeys.tasksAll(), crmKeys.tasksDue()],
      [crmKeys.tasksAll(), crmKeys.tasksForLead(LEAD)],
      [crmKeys.funnelAll(), crmKeys.funnel(FUNNEL_PARAMS)],
      [crmKeys.companies(), crmKeys.companiesList("x")],
      [newsletterKeys.settings(), newsletterKeys.settingsInline()],
      [newsletterKeys.campaignsAll(), newsletterKeys.campaign(ID)],
      [newsletterKeys.campaign(ID), newsletterKeys.campaignEngagement(ID)],
      [newsletterKeys.campaign(ID), newsletterKeys.campaignAudience(ID, AUDIENCE)],
      [newsletterKeys.popupEventsAll(), newsletterKeys.popupEvents(7)],
      [accessKeys.ruleAll(), accessKeys.rule("page", ID)],
      [meteringKeys.impactPreviewAll(), meteringKeys.impactPreview(3)],
      [workflowKeys.runsAll(), workflowKeys.runs(null, "failed")],
      [couponKeys.admin(), couponKeys.plans()],
      [couponKeys.admin(), couponKeys.tiers()],
      [couponKeys.redemptionsAll(), couponKeys.redemptions(null, null)],
      [billingKeys.admin.paymentOrders(), billingKeys.admin.paymentOrdersList("paid", "live")],
      [billingKeys.admin.members(), billingKeys.admin.membersDirectory(MEMBER_PARAMS)],
      [billingKeys.admin.memberBillingAll(), billingKeys.admin.memberBilling(ID)],
      [billingKeys.admin.monetization(), billingKeys.admin.monetizationLedger("live")],
      [journeyKeys.listAll(), journeyKeys.list(T, "draft")],
      [journeyKeys.statsFor(ID), journeyKeys.stats(ID, LEAD, null, null)],
      [journeyKeys.enrollmentsFor(ID), journeyKeys.enrollments(ID, null, null, 1)],
      [journeyKeys.forLeadAll(), journeyKeys.forLead(LEAD)],
    ];
    expect(pary.filter(([p, k]) => !isPrefix(p, k)).map(([p]) => p)).toEqual([]);
    // Wszystko ścieżek leży pod korzeniem - jedno unieważnienie po wylogowaniu.
    for (const fn of funkcje("journeyKeys", journeyKeys)) {
      const name = fn.split(".")[1] as keyof typeof journeyKeys;
      const klucz = (journeyKeys[name] as (...a: unknown[]) => readonly unknown[])(T, T, T, T);
      expect(isPrefix(journeyKeys.root(), klucz), fn).toBe(true);
    }
  });

  it("prefiksy WSPÓŁDZIELONE z innymi kluczami NIE są prefiksem napisu", () => {
    // Inwalidacja dopasowuje ELEMENTY, nie litery - `crm-lead` nie obejmuje
    // `crm-lead-timeline`. Fabryka trzyma je jako osobne klucze celowo.
    expect(isPrefix(crmKeys.lead(LEAD).slice(0, 1), crmKeys.leadTimeline(LEAD))).toBe(false);
    expect(isPrefix(couponKeys.admin(), couponKeys.campaigns())).toBe(false);
  });
});

/* ----------------------------------------------- liście bez importów runtime */

/** Moduły kluczy czytane przez mapę szyny - wolno im tylko `import type`. */
const LISCIE = [
  "src/lib/access/keys.ts",
  "src/lib/admin/couponKeys.ts",
  "src/lib/admin/workflowKeys.ts",
  "src/lib/billing/keys.ts",
  "src/lib/crm/keys.ts",
  "src/lib/journeys/keys.ts",
  "src/lib/newsletter/keys.ts",
  "src/lib/retention/keys.ts",
  "src/lib/revenue/keys.ts",
] as const;

describe("moduły kluczy są liśćmi bez importów runtime", () => {
  it.each(LISCIE)("%s", (plik) => {
    // Komentarze zamaskowane: nagłówki tych plików OPISUJĄ zakazane importy.
    const kod = bezKomentarzy(readFileSync(plik, "utf8"));
    const importy = [...kod.matchAll(/^\s*import\b[^;]*;/gm)].map((m) => m[0].trim());
    expect(importy.filter((imp) => !/^import\s+type\s/.test(imp))).toEqual([]);
    expect(kod).not.toMatch(/^\s*export\s+(\*|\{[^}]*\})\s+from\b/m);
    expect(kod).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
    // Fabryka kluczy nie niesie klas: plik spoza `components/admin` trafia do
    // skanu arkusza PUBLICZNEGO (scripts/lib/adminCssPlugin.ts).
    expect(kod).not.toMatch(/className|\bcn\(/);
  });
});
