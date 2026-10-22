// SKRÓTY WSKAŹNIKÓW DO WYSZUKIWARKI PANELU (⌘K) - „NRR · Wskaźniki" →
// `/admin/revenue/metrics?metric=net_revenue_retention` (SPEC §6.5, pakiet
// S7 §6.2 pkt 10). Wpis otwiera zakładkę Wskaźniki z arkuszem objaśnienia
// sterowanym adresem (`?metric=`), więc ⌘K prowadzi wprost do definicji,
// wartości i oceny wskaźnika, a nie do pustego słownika.
//
// LEKKO, BO NAWIGACJA JEDZIE W POWŁOCE PANELU. `adminNav.ts` buduje menu na
// każdej trasie panelu - import rejestru wskaźników (`metrics.ts`) albo
// indeksu benchmarków wciągnąłby setki kilobajtów do chunku powłoki. Lista
// niżej to same pary `{ metricId, abbr }` (typy importowane tylko jako
// `import type`), a ZGODNOŚĆ z rejestrem pilnuje test
// `metricSearchIndex.test.ts`: skrót = wiodący kod skrótu z rejestru
// benchmarków S6 (ten sam, który słownik pokazuje w wierszu: „NRR (NDR)" →
// „NRR", „LTV / CLV" → „LTV"), pełne pokrycie wskaźników huba z takim
// kodem, unikalność i rozmiar.
//
// Wskaźniki bez kodu („Logo churn (M)", „Win rate") szuka się po nazwie
// w samym słowniku - ⌘K ma tu skróty, nie drugi słownik.
import type { MetricId } from "@/lib/analytics/semantic/metrics";
import { canSeeTab } from "@/lib/admin/revenue/hubTabs";

export interface MetricShortcut {
  readonly metricId: MetricId;
  /** Kod wskaźnika - wiodący token skrótu z rejestru benchmarków S6. */
  readonly abbr: string;
}

/** Kolejność = kolejność rejestru huba (`HUB_METRIC_IDS`, SPEC §5.5). */
export const METRIC_SHORTCUTS: readonly MetricShortcut[] = [
  { metricId: "mrr", abbr: "MRR" },
  { metricId: "arr", abbr: "ARR" },
  { metricId: "arpa", abbr: "ARPA" },
  { metricId: "arpu", abbr: "ARPU" },
  { metricId: "net_new_mrr", abbr: "NNMRR" },
  { metricId: "saas_quick_ratio", abbr: "QR" },
  { metricId: "annual_plan_share", abbr: "APS" },
  { metricId: "price_realization", abbr: "PR" },
  { metricId: "average_discount", abbr: "ADD" },
  { metricId: "gross_revenue_churn", abbr: "GRC" },
  { metricId: "net_revenue_retention", abbr: "NRR" },
  { metricId: "gross_revenue_retention", abbr: "GRR" },
  { metricId: "visitor_to_registration_rate", abbr: "V2R" },
  { metricId: "registered_to_paid_rate", abbr: "R2P" },
  { metricId: "paywall_conversion_rate", abbr: "PSCR" },
  { metricId: "paywall_hit_rate", abbr: "PHR" },
  { metricId: "trial_to_paid_rate", abbr: "T2P" },
  { metricId: "checkout_conversion_rate", abbr: "CCR" },
  { metricId: "checkout_abandonment_rate", abbr: "CAR" },
  { metricId: "pricing_page_conversion_rate", abbr: "PPCR" },
  { metricId: "signup_form_conversion_rate", abbr: "SFCR" },
  { metricId: "ltv", abbr: "LTV" },
  { metricId: "cac", abbr: "CAC" },
  { metricId: "ltv_cac_ratio", abbr: "LTV/CAC" },
  { metricId: "subscription_gross_margin", abbr: "GM" },
  { metricId: "rule_of_40", abbr: "R40" },
  { metricId: "email_open_rate", abbr: "OR" },
  { metricId: "email_ctr_delivered", abbr: "CTR" },
  { metricId: "email_unsubscribe_rate", abbr: "UR" },
  { metricId: "email_hard_bounce_rate", abbr: "HBR" },
  { metricId: "email_soft_bounce_rate", abbr: "SBR" },
  { metricId: "email_spam_complaint_rate", abbr: "SCR" },
  { metricId: "newsletter_list_growth_rate", abbr: "LGR" },
  { metricId: "email_disaffection_rate", abbr: "DR" },
  { metricId: "journey_goal_rate", abbr: "CVR" },
  { metricId: "event_attendance_rate", abbr: "EAR" },
  { metricId: "no_show_rate", abbr: "NSR" },
  { metricId: "event_registration_conversion", abbr: "RCR" },
  { metricId: "club_active_member_rate", abbr: "AMR" },
  { metricId: "dau_mau", abbr: "DAU/MAU" },
  { metricId: "wau_mau", abbr: "WAU/MAU" },
  { metricId: "lead_response_time", abbr: "STL" },
  { metricId: "sales_cycle_length", abbr: "SCL" },
];

/** Zakładka Wskaźniki - ta sama ścieżka co skrót zakładki w ⌘K (`revenueTabPath`). */
export const METRICS_TAB_PATH = "/admin/revenue/metrics";

/** Wpis wyszukiwarki - kształt `AdminNavSearchEntry` (`adminNav.ts`). */
export interface MetricSearchEntry {
  to: string;
  search: Readonly<Record<string, string>>;
  label: string;
  keywords: string[];
}

/**
 * Skróty ⌘K dla ról sesji. Zakładkę Wskaźniki widzą administrator
 * i redaktor (`HUB_TABS`); rola spoza huba nie dostaje skrótu do ekranu
 * „brak dostępu". Słowa kluczowe: kod i identyfikator rejestru słowami
 * („net revenue retention"), bez diakrytyków - tak porównuje
 * `normalizeSearchText`.
 *
 * @param tabLabel przetłumaczona nazwa zakładki (`admin.nav.revenueTabs.metrics`)
 */
export function metricSearchEntries(
  tabLabel: string,
  roles: readonly string[],
): MetricSearchEntry[] {
  if (!canSeeTab("metrics", roles)) return [];
  return METRIC_SHORTCUTS.map(({ metricId, abbr }) => ({
    to: METRICS_TAB_PATH,
    search: { metric: metricId },
    label: `${abbr} · ${tabLabel}`,
    keywords: [abbr.toLowerCase(), metricId.replace(/_/g, " ")],
  }));
}
