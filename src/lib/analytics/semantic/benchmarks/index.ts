// PLIK GENEROWANY przez scripts/benchmarks/import-benchmarks.ts - nie edytuj ręcznie.
// Wejście: docs/benchmarki/2026-10-18/przychod.json, docs/benchmarki/2026-10-18/przychod.overlay.json, docs/benchmarki/2026-10-18/retencja.json, docs/benchmarki/2026-10-18/retencja.overlay.json, docs/benchmarki/2026-10-18/ekonomika.json, docs/benchmarki/2026-10-18/ekonomika.overlay.json, docs/benchmarki/2026-10-18/lejek.json, docs/benchmarki/2026-10-18/lejek.overlay.json, docs/benchmarki/2026-10-18/email.json, docs/benchmarki/2026-10-18/email.overlay.json, docs/benchmarki/2026-10-18/spolecznosc.json, docs/benchmarki/2026-10-18/spolecznosc.overlay.json
// SHA-256 treści kanonicznej wejść: 1a6548e623e2ef2c09d0f98578be02ae782fcb013857109e8ad4a5ec96be6b00
// Zmiana treści = poprawka danych albo nakładki w docs/benchmarki i ponowny import;
// `--check` wykrywa ręczną edycję tego pliku i nieuruchomiony importer.
//
// Lekki indeks benchmarków - moduł KLIENTA: klucz, skrót, grupa, metryka
// i pary obowiązkowe. Treść (pasma, metody, źródła) pobiera `getBenchmarkGroup`.
import type { MetricId } from "../metrics";
import type { BenchGroup } from "./types";

export const BENCH_GROUPS: readonly BenchGroup[] = [
  "revenue",
  "retention",
  "economics",
  "funnel",
  "email",
  "community",
];

/** Stan rejestru = data dostępu do źródeł; typ literalny (stała bez adnotacji). */
export const BENCHMARK_REGISTRY_AS_OF = "2026-10-18";

export interface BenchmarkIndexEntry {
  key: string;
  abbr: string;
  group: BenchGroup;
  metricId?: MetricId;
  primary?: true;
}

export const BENCHMARK_INDEX: readonly BenchmarkIndexEntry[] = [
  {
    key: "mrr",
    abbr: "MRR",
    group: "revenue",
    metricId: "mrr",
  },
  {
    key: "arr",
    abbr: "ARR",
    group: "revenue",
    metricId: "arr",
  },
  {
    key: "arpa",
    abbr: "ARPA",
    group: "revenue",
    metricId: "arpa",
  },
  {
    key: "arpu",
    abbr: "ARPU",
    group: "revenue",
    metricId: "arpu",
  },
  {
    key: "mrr_growth_mom",
    abbr: "MoM MRR",
    group: "revenue",
    metricId: "mrr_growth_mom",
  },
  {
    key: "net_new_mrr",
    abbr: "NNMRR",
    group: "revenue",
    metricId: "net_new_mrr",
  },
  {
    key: "saas_quick_ratio",
    abbr: "QR",
    group: "revenue",
    metricId: "saas_quick_ratio",
  },
  {
    key: "expansion_share_new_mrr",
    abbr: "EXP %",
    group: "revenue",
    metricId: "expansion_share_new_mrr",
  },
  {
    key: "price_realization",
    abbr: "PR",
    group: "revenue",
    metricId: "price_realization",
  },
  {
    key: "average_discount",
    abbr: "ADD",
    group: "revenue",
    metricId: "average_discount",
  },
  {
    key: "coupon_redemption_rate",
    abbr: "CpRR",
    group: "revenue",
    metricId: "coupon_redemption_rate",
  },
  {
    key: "annual_plan_share",
    abbr: "APS",
    group: "revenue",
    metricId: "annual_plan_share",
  },
  {
    key: "logo_churn_monthly",
    abbr: "Logo churn (M)",
    group: "retention",
    metricId: "logo_churn_monthly",
  },
  {
    key: "logo_churn_annual",
    abbr: "Logo churn (12M)",
    group: "retention",
    metricId: "logo_churn_annual",
  },
  {
    key: "gross_revenue_churn",
    abbr: "GRC (gross MRR churn)",
    group: "retention",
    metricId: "gross_revenue_churn",
  },
  {
    key: "net_revenue_retention",
    abbr: "NRR (NDR)",
    group: "retention",
    metricId: "net_revenue_retention",
  },
  {
    key: "gross_revenue_retention",
    abbr: "GRR (GDR)",
    group: "retention",
    metricId: "gross_revenue_retention",
  },
  {
    key: "involuntary_churn_share",
    abbr: "Invol. churn %",
    group: "retention",
    metricId: "involuntary_churn_share",
  },
  {
    key: "dunning_recovery_rate",
    abbr: "Recovery rate",
    group: "retention",
    metricId: "dunning_recovery_rate",
  },
  {
    key: "cancellation_save_rate",
    abbr: "Save rate",
    group: "retention",
    metricId: "cancellation_save_rate",
  },
  {
    key: "winback_rate_12m",
    abbr: "Winback rate",
    group: "retention",
    metricId: "winback_rate_12m",
  },
  {
    key: "returning_subscriber_share",
    abbr: "Returning share",
    group: "retention",
    metricId: "returning_subscriber_share",
  },
  {
    key: "cohort_retention_m1",
    abbr: "M1 retention",
    group: "retention",
    metricId: "cohort_retention_m1",
  },
  {
    key: "cohort_retention_m3",
    abbr: "M3 retention",
    group: "retention",
    metricId: "cohort_retention_m3",
  },
  {
    key: "cohort_retention_m12",
    abbr: "M12 retention",
    group: "retention",
    metricId: "cohort_retention_m12",
  },
  {
    key: "ltv",
    abbr: "LTV / CLV",
    group: "economics",
    metricId: "ltv",
  },
  {
    key: "cac",
    abbr: "CAC",
    group: "economics",
    metricId: "cac",
  },
  {
    key: "new_cac_ratio",
    abbr: "New CAC Ratio",
    group: "economics",
    metricId: "new_cac_ratio",
  },
  {
    key: "ltv_cac_ratio",
    abbr: "LTV/CAC",
    group: "economics",
    metricId: "ltv_cac_ratio",
  },
  {
    key: "cac_payback_months",
    abbr: "CAC Payback",
    group: "economics",
    metricId: "cac_payback_months",
  },
  {
    key: "subscription_gross_margin",
    abbr: "GM",
    group: "economics",
    metricId: "subscription_gross_margin",
  },
  {
    key: "rule_of_40",
    abbr: "R40",
    group: "economics",
    metricId: "rule_of_40",
  },
  {
    key: "visitor_to_registration_rate",
    abbr: "V2R",
    group: "funnel",
    metricId: "visitor_to_registration_rate",
  },
  {
    key: "registered_to_paid_rate",
    abbr: "R2P",
    group: "funnel",
    metricId: "registered_to_paid_rate",
  },
  {
    key: "visitor_to_paid_rate",
    abbr: "V2P",
    group: "funnel",
  },
  {
    key: "paywall_conversion_rate",
    abbr: "PSCR",
    group: "funnel",
    metricId: "paywall_conversion_rate",
  },
  {
    key: "trial_to_paid_rate",
    abbr: "T2P",
    group: "funnel",
    metricId: "trial_to_paid_rate",
  },
  {
    key: "checkout_abandonment_rate",
    abbr: "CAR",
    group: "funnel",
    metricId: "checkout_abandonment_rate",
  },
  {
    key: "checkout_conversion_rate",
    abbr: "CCR",
    group: "funnel",
    metricId: "checkout_conversion_rate",
  },
  {
    key: "pricing_page_conversion_rate",
    abbr: "PPCR",
    group: "funnel",
    metricId: "pricing_page_conversion_rate",
  },
  {
    key: "signup_form_conversion_rate",
    abbr: "SFCR",
    group: "funnel",
    metricId: "signup_form_conversion_rate",
  },
  {
    key: "activation_rate",
    abbr: "ACT",
    group: "funnel",
  },
  {
    key: "time_to_value",
    abbr: "TTV",
    group: "funnel",
  },
  {
    key: "paywall_hit_rate",
    abbr: "PHR",
    group: "funnel",
    metricId: "paywall_hit_rate",
  },
  {
    key: "engagement_rate",
    abbr: "ER (GA4)",
    group: "funnel",
    metricId: "engagement_rate",
  },
  {
    key: "open_rate",
    abbr: "OR",
    group: "email",
    metricId: "email_open_rate",
  },
  {
    key: "click_through_rate",
    abbr: "CTR",
    group: "email",
    metricId: "email_ctr_delivered",
  },
  {
    key: "click_to_open_rate",
    abbr: "CTOR",
    group: "email",
    metricId: "email_ctr",
  },
  {
    key: "unsubscribe_rate",
    abbr: "UR",
    group: "email",
    metricId: "email_unsubscribe_rate",
  },
  {
    key: "hard_bounce_rate",
    abbr: "HBR",
    group: "email",
    metricId: "email_hard_bounce_rate",
  },
  {
    key: "soft_bounce_rate",
    abbr: "SBR",
    group: "email",
    metricId: "email_soft_bounce_rate",
  },
  {
    key: "spam_complaint_rate",
    abbr: "SCR",
    group: "email",
    metricId: "email_spam_complaint_rate",
  },
  {
    key: "list_growth_rate",
    abbr: "LGR",
    group: "email",
    metricId: "newsletter_list_growth_rate",
  },
  {
    key: "double_opt_in_confirmation_rate",
    abbr: "DOI CR",
    group: "email",
    metricId: "doi_confirmation_rate",
  },
  {
    key: "welcome_email_open_rate",
    abbr: "Welcome OR",
    group: "email",
    metricId: "journey_open_rate",
    primary: true,
  },
  {
    key: "welcome_email_click_rate",
    abbr: "Welcome CTR",
    group: "email",
    metricId: "journey_click_rate",
    primary: true,
  },
  {
    key: "automation_vs_campaign_rpr_ratio",
    abbr: "RPR A/C",
    group: "email",
  },
  {
    key: "email_conversion_rate",
    abbr: "CVR (e-mail)",
    group: "email",
    metricId: "journey_goal_rate",
    primary: true,
  },
  {
    key: "abandoned_cart_email_open_rate",
    abbr: "AC OR",
    group: "email",
    metricId: "journey_open_rate",
  },
  {
    key: "abandoned_cart_email_click_rate",
    abbr: "AC CTR",
    group: "email",
    metricId: "journey_click_rate",
  },
  {
    key: "abandoned_cart_email_conversion_rate",
    abbr: "AC CVR",
    group: "email",
    metricId: "journey_goal_rate",
  },
  {
    key: "inbox_placement_rate",
    abbr: "IPR",
    group: "email",
  },
  {
    key: "disaffection_rate",
    abbr: "DR",
    group: "email",
    metricId: "email_disaffection_rate",
  },
  {
    key: "dau_mau",
    abbr: "DAU/MAU",
    group: "community",
    metricId: "dau_mau",
  },
  {
    key: "wau_mau",
    abbr: "WAU/MAU",
    group: "community",
    metricId: "wau_mau",
  },
  {
    key: "nps",
    abbr: "NPS",
    group: "community",
  },
  {
    key: "event_attendance_rate",
    abbr: "EAR",
    group: "community",
    metricId: "event_attendance_rate",
  },
  {
    key: "no_show_rate",
    abbr: "NSR",
    group: "community",
    metricId: "no_show_rate",
  },
  {
    key: "event_registration_conversion",
    abbr: "RCR",
    group: "community",
    metricId: "event_registration_conversion",
  },
  {
    key: "event_nps",
    abbr: "Event NPS",
    group: "community",
  },
  {
    key: "community_active_member_rate",
    abbr: "AMR",
    group: "community",
    metricId: "club_active_member_rate",
  },
  {
    key: "community_contributor_rate",
    abbr: "CR 90-9-1",
    group: "community",
    metricId: "club_contributor_rate",
  },
  {
    key: "lead_to_mql_rate",
    abbr: "Lead→MQL",
    group: "community",
    metricId: "lead_to_mql_rate",
  },
  {
    key: "mql_to_sql_rate",
    abbr: "MQL→SQL",
    group: "community",
    metricId: "mql_to_sql_rate",
  },
  {
    key: "win_rate",
    abbr: "Win rate",
    group: "community",
    metricId: "win_rate",
  },
  {
    key: "lead_response_time",
    abbr: "STL",
    group: "community",
    metricId: "lead_response_time",
  },
  {
    key: "sales_cycle_length",
    abbr: "SCL",
    group: "community",
    metricId: "sales_cycle_length",
  },
];

/** Pary obowiązkowe w UI (brief 05 §5): wskaźnik → wskaźniki, bez których jest mylący. */
export const BENCHMARK_PAIRS: Readonly<Record<string, readonly string[]>> = {
  saas_quick_ratio: ["gross_revenue_churn"],
  gross_revenue_churn: ["saas_quick_ratio"],
  cancellation_save_rate: ["arpu"],
  ltv_cac_ratio: ["arpu", "logo_churn_monthly", "subscription_gross_margin", "cac"],
  visitor_to_registration_rate: ["paywall_hit_rate"],
  paywall_conversion_rate: ["paywall_hit_rate"],
  checkout_abandonment_rate: ["checkout_conversion_rate"],
  checkout_conversion_rate: ["checkout_abandonment_rate"],
  paywall_hit_rate: ["paywall_conversion_rate", "visitor_to_registration_rate"],
  engagement_rate: ["visitor_to_registration_rate", "paywall_hit_rate"],
};

export function benchmarkIndexEntry(key: string): BenchmarkIndexEntry | undefined {
  return BENCHMARK_INDEX.find((e) => e.key === key);
}

/** Wszystkie wpisy wskazujące metrykę (np. trzy e-maile ścieżek → jedna metryka). */
export function benchmarksForMetric(id: MetricId): readonly BenchmarkIndexEntry[] {
  return BENCHMARK_INDEX.filter((e) => e.metricId === id);
}

/** Wpis wiodący metryki: oznaczony `primary` albo jedyny. */
export function primaryBenchmarkFor(id: MetricId): BenchmarkIndexEntry | undefined {
  const all = benchmarksForMetric(id);
  return all.find((e) => e.primary === true) ?? (all.length === 1 ? all[0] : undefined);
}
