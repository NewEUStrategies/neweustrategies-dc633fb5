// @vitest-environment node
// MAPA WPIS BENCHMARKU → METRYKA (PLAN S6 §3.4, karta S6 kryterium 2).
//
// Mapa jest przypięta LITERALNIE, a nie wyliczana z rejestru: to kontrakt
// między nakładkami redakcyjnymi a słownikiem metryk. Pomylenie `click_
// through_rate` (CTR od doręczonych) z `click_to_open_rate` (CTOR) daje
// ocenę „optymalny” dla CTR 4 %, który przy pasmach CTOR jest słaby - i nie
// ma żadnego objawu poza złą oceną w kaflu.
//
// Druga połowa kontraktu: każda z 70 metryk huba MA benchmark albo jest
// świadomie na liście „bez benchmarku”, a każdy wpis bez metryki mówi, czego
// system nie mierzy (D-02, status N).
import { describe, expect, it } from "vitest";
import { HUB_METRIC_IDS, METRICS, type MetricId } from "../../metrics";
import type { GeneratedBenchmark } from "../adapter";
import { COMMUNITY_BENCHMARKS } from "../groups/community.server";
import { ECONOMICS_BENCHMARKS } from "../groups/economics.server";
import { EMAIL_BENCHMARKS } from "../groups/email.server";
import { FUNNEL_BENCHMARKS } from "../groups/funnel.server";
import { RETENTION_BENCHMARKS } from "../groups/retention.server";
import { REVENUE_BENCHMARKS } from "../groups/revenue.server";
import {
  BENCHMARK_INDEX,
  benchmarksForMetric,
  primaryBenchmarkFor,
  type BenchmarkIndexEntry,
} from "../index";
import type { BenchGroup } from "../types";

/** §3.4 słowo w słowo: grupa → wpis → metryka (`null` = świadomie bez metryki). */
const CONTRACT: Readonly<Record<BenchGroup, Readonly<Record<string, MetricId | null>>>> = {
  revenue: {
    mrr: "mrr",
    arr: "arr",
    arpa: "arpa",
    arpu: "arpu",
    mrr_growth_mom: "mrr_growth_mom",
    net_new_mrr: "net_new_mrr",
    saas_quick_ratio: "saas_quick_ratio",
    expansion_share_new_mrr: "expansion_share_new_mrr",
    price_realization: "price_realization",
    average_discount: "average_discount",
    coupon_redemption_rate: "coupon_redemption_rate",
    annual_plan_share: "annual_plan_share",
  },
  retention: {
    logo_churn_monthly: "logo_churn_monthly",
    logo_churn_annual: "logo_churn_annual",
    gross_revenue_churn: "gross_revenue_churn",
    net_revenue_retention: "net_revenue_retention",
    gross_revenue_retention: "gross_revenue_retention",
    involuntary_churn_share: "involuntary_churn_share",
    dunning_recovery_rate: "dunning_recovery_rate",
    cancellation_save_rate: "cancellation_save_rate",
    winback_rate_12m: "winback_rate_12m",
    returning_subscriber_share: "returning_subscriber_share",
    cohort_retention_m1: "cohort_retention_m1",
    cohort_retention_m3: "cohort_retention_m3",
    cohort_retention_m12: "cohort_retention_m12",
  },
  economics: {
    ltv: "ltv",
    cac: "cac",
    new_cac_ratio: "new_cac_ratio",
    ltv_cac_ratio: "ltv_cac_ratio",
    cac_payback_months: "cac_payback_months",
    subscription_gross_margin: "subscription_gross_margin",
    rule_of_40: "rule_of_40",
  },
  funnel: {
    visitor_to_registration_rate: "visitor_to_registration_rate",
    registered_to_paid_rate: "registered_to_paid_rate",
    visitor_to_paid_rate: null,
    paywall_conversion_rate: "paywall_conversion_rate",
    trial_to_paid_rate: "trial_to_paid_rate",
    checkout_abandonment_rate: "checkout_abandonment_rate",
    checkout_conversion_rate: "checkout_conversion_rate",
    pricing_page_conversion_rate: "pricing_page_conversion_rate",
    signup_form_conversion_rate: "signup_form_conversion_rate",
    activation_rate: null,
    time_to_value: null,
    paywall_hit_rate: "paywall_hit_rate",
  },
  email: {
    open_rate: "email_open_rate",
    click_through_rate: "email_ctr_delivered",
    click_to_open_rate: "email_ctr",
    unsubscribe_rate: "email_unsubscribe_rate",
    hard_bounce_rate: "email_hard_bounce_rate",
    soft_bounce_rate: "email_soft_bounce_rate",
    spam_complaint_rate: "email_spam_complaint_rate",
    list_growth_rate: "newsletter_list_growth_rate",
    double_opt_in_confirmation_rate: "doi_confirmation_rate",
    welcome_email_open_rate: "journey_open_rate",
    welcome_email_click_rate: "journey_click_rate",
    automation_vs_campaign_rpr_ratio: null,
    email_conversion_rate: "journey_goal_rate",
    abandoned_cart_email_open_rate: "journey_open_rate",
    abandoned_cart_email_click_rate: "journey_click_rate",
    abandoned_cart_email_conversion_rate: "journey_goal_rate",
    inbox_placement_rate: null,
    disaffection_rate: "email_disaffection_rate",
  },
  community: {
    dau_mau: "dau_mau",
    wau_mau: "wau_mau",
    nps: null,
    event_attendance_rate: "event_attendance_rate",
    no_show_rate: "no_show_rate",
    event_registration_conversion: "event_registration_conversion",
    event_nps: null,
    community_active_member_rate: "club_active_member_rate",
    community_contributor_rate: "club_contributor_rate",
    lead_to_mql_rate: "lead_to_mql_rate",
    mql_to_sql_rate: "mql_to_sql_rate",
    win_rate: "win_rate",
    lead_response_time: "lead_response_time",
    sales_cycle_length: "sales_cycle_length",
  },
};

/** Metryki huba ŚWIADOMIE bez benchmarku (SPEC §3.4) - kwoty bez porównywalnego rynku i procesy klubów. */
const WITHOUT_BENCHMARK: readonly MetricId[] = [
  "active_subscriptions",
  "revenue_realized",
  "event_ticket_revenue",
  "club_application_acceptance",
  "club_decision_time",
];

/** Wpisy wiodące metryk wskazanych przez kilka wpisów (ścieżki e-mail: powitalna vs koszyk). */
const PRIMARY: Readonly<Partial<Record<MetricId, string>>> = {
  journey_open_rate: "welcome_email_open_rate",
  journey_click_rate: "welcome_email_click_rate",
  journey_goal_rate: "email_conversion_rate",
};

const GROUPS: Readonly<Record<BenchGroup, readonly GeneratedBenchmark[]>> = {
  revenue: REVENUE_BENCHMARKS,
  retention: RETENTION_BENCHMARKS,
  economics: ECONOMICS_BENCHMARKS,
  funnel: FUNNEL_BENCHMARKS,
  email: EMAIL_BENCHMARKS,
  community: COMMUNITY_BENCHMARKS,
};

const METRIC_IDS = new Set<string>(METRICS.map((m) => m.id));

describe("mapa wpis → MetricId (§3.4)", () => {
  it.each(Object.keys(CONTRACT) as BenchGroup[])(
    "grupa %s: dokładnie wpisy i metryki z kontraktu",
    (group) => {
      const actual = Object.fromEntries(
        GROUPS[group].map((b) => [b.key, b.metricId ?? null] as const),
      );
      expect(actual).toEqual(CONTRACT[group]);
    },
  );

  it("indeks klienta niesie tę samą mapę", () => {
    const fromContract = Object.entries(CONTRACT).flatMap(([group, map]) =>
      Object.entries(map).map(([key, id]) => `${group}:${key}:${id ?? "-"}`),
    );
    const fromIndex = BENCHMARK_INDEX.map((e) => `${e.group}:${e.key}:${e.metricId ?? "-"}`);
    expect([...fromIndex].sort()).toEqual([...fromContract].sort());
  });

  it("każdy metricId istnieje w słowniku metryk", () => {
    for (const e of BENCHMARK_INDEX) {
      if (e.metricId) expect(METRIC_IDS.has(e.metricId), e.key).toBe(true);
    }
  });

  it("każda z 70 metryk huba ma benchmark albo jest na liście 5 „bez benchmarku”", () => {
    expect(HUB_METRIC_IDS).toHaveLength(70);
    const uncovered = HUB_METRIC_IDS.filter((id) => benchmarksForMetric(id).length === 0);
    expect([...uncovered].sort()).toEqual([...WITHOUT_BENCHMARK].sort());
    for (const id of WITHOUT_BENCHMARK) expect(HUB_METRIC_IDS).toContain(id);
  });

  it("7 wpisów bez MetricId, każdy z powodem (czego system nie mierzy)", () => {
    const all = Object.values(GROUPS).flat();
    const withoutMetric = all.filter((b) => !b.metricId);
    expect(withoutMetric.map((b) => b.key).sort()).toEqual(
      [
        "activation_rate",
        "automation_vs_campaign_rpr_ratio",
        "event_nps",
        "inbox_placement_rate",
        "nps",
        "time_to_value",
        "visitor_to_paid_rate",
      ].sort(),
    );
    for (const b of withoutMetric) {
      expect(b.noMetricReason?.pl.length ?? 0, b.key).toBeGreaterThan(20);
      expect(b.noMetricReason?.en.length ?? 0, b.key).toBeGreaterThan(20);
    }
    // Wpis Z metryką nie niesie powodu braku metryki - sprzeczność w UI.
    for (const b of all.filter((x) => x.metricId)) expect(b.noMetricReason, b.key).toBeUndefined();
  });

  it("primary: dokładnie jeden przy wielu wpisach na metrykę, brak przy jedynym", () => {
    const byMetric = new Map<MetricId, BenchmarkIndexEntry[]>();
    for (const e of BENCHMARK_INDEX) {
      if (!e.metricId) continue;
      byMetric.set(e.metricId, [...(byMetric.get(e.metricId) ?? []), e]);
    }
    const multi = [...byMetric].filter(([, list]) => list.length > 1).map(([id]) => id);
    expect([...multi].sort()).toEqual(Object.keys(PRIMARY).sort());
    for (const [id, list] of byMetric) {
      const primaries = list.filter((e) => e.primary === true);
      if (list.length > 1) {
        expect(
          primaries.map((e) => e.key),
          id,
        ).toEqual([PRIMARY[id]]);
      } else {
        expect(primaries, id).toEqual([]);
      }
      expect(primaryBenchmarkFor(id)?.key, id).toBe(PRIMARY[id] ?? list[0].key);
    }
  });

  it("skróty z decyzji D10: aktywacja = ACT, frekwencja wydarzeń = EAR", () => {
    expect(BENCHMARK_INDEX.find((e) => e.key === "activation_rate")?.abbr).toBe("ACT");
    expect(BENCHMARK_INDEX.find((e) => e.key === "event_attendance_rate")?.abbr).toBe("EAR");
  });
});
