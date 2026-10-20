// REJESTR REGUŁ DIAGNOSTYKI HUBA (S7, SPEC §5.7) - identyfikatory reguł
// i napraw, kontrakt `RevenueCheck`, lista niewyciszalnych, mapa wiedzy
// Insidera i ocena faktów w diagnozy.
//
// ZAMKNIĘTE LISTY. `REVENUE_CHECK_IDS` (54 reguły SPEC + `catalog.
// team_seats_over_cap` z Z-I9b-06) i `REVENUE_FIX_DIALOG_IDS` (jeden dialog
// na rodzinę napraw) to źródła typów: słownik i18n, `QuickFixSpec`, wyciszenia
// w SQL i `defectMap` odwołują się do nich, a test rejestru pilnuje, że
// każda reguła z plików `checks/*` jest na liście i odwrotnie.
//
// WYCISZENIE A WAGA. Reguły krytyczne w `sync` i `data_quality` są
// niewyciszalne: błąd emitera szyny albo rozjazd księgi przekłamuje KAŻDĄ
// liczbę huba, więc ukrycie ich z listy ukryłoby powód, dla którego reszta
// diagnozy może kłamać. Lista jest lustrem bloku `unsnoozable` w SQL
// (20261020150100) - parytet w `snoozeParity.test.ts`.
//
// WIEDZA INSIDERA BEZ TREŚCI. Do reguły przypinamy wyłącznie identyfikatory
// scenariuszy i frameworków (docs/benchmarki/insider-2026-10-19); treść
// „Plan naprawy / Teoria" i liczby czyta moduł wiedzy (I9). Zmyślanie liczb
// tutaj jest zakazane (SPEC: benchmarki tylko z rejestru S6).
import type { RevenueArea, RevenueSeverity } from "@/lib/admin/revenue/hubTabs";
import { CATALOG_CHECKS } from "./checks/catalog";
import { CHECKOUT_CHECKS } from "./checks/checkout";
import { CLUBS_CHECKS } from "./checks/clubs";
import { COUPONS_CHECKS } from "./checks/coupons";
import { CRM_CHECKS } from "./checks/crm";
import { DATA_QUALITY_CHECKS } from "./checks/dataQuality";
import { DUNNING_CHECKS } from "./checks/dunning";
import { EVENTS_CHECKS } from "./checks/events";
import { FUNNEL_CHECKS } from "./checks/funnel";
import { JOURNEYS_CHECKS } from "./checks/journeys";
import { METERING_CHECKS } from "./checks/metering";
import { NEWSLETTER_CHECKS } from "./checks/newsletter";
import { PAYWALL_CHECKS } from "./checks/paywall";
import { RETENTION_CHECKS } from "./checks/retention";
import { SYNC_CHECKS } from "./checks/sync";
import { WORKFLOWS_CHECKS } from "./checks/workflows";
import {
  defaultImpact,
  factHashOf,
  type RevenueCheckResult,
  type RevenueCheckState,
  type RevenueEvidence,
  type RevenueFacts,
  type RevenueImpact,
} from "./facts";

// ---------------------------------------------------------------------------
// Identyfikatory
// ---------------------------------------------------------------------------

/** Reguły SPEC §5.7 (54) + `catalog.team_seats_over_cap` (Z-I9b-06, odchylenie w raporcie). */
export const REVENUE_CHECK_IDS = [
  "catalog.plan_without_tier",
  "catalog.plan_without_catalog_pair",
  "catalog.enquiry_plan_buyable",
  "catalog.promise_without_gate",
  "catalog.provider_price_drift",
  "catalog.annual_discount_out_of_range",
  "catalog.subscription_unknown_price",
  "catalog.not_for_sale_still_visible",
  "catalog.price_change_without_notice",
  "catalog.team_seats_over_cap",
  "paywall.paid_without_buyable_plan",
  "paywall.rule_inactive_plan",
  "paywall.members_rank_no_cta",
  "paywall.measurement_silent",
  "metering.settings_row_missing",
  "metering.anon_zero_limit",
  "metering.rank_bypass",
  "checkout.abandon_window_default",
  "checkout.display_currency_mismatch",
  "coupons.campaign_sent_without_codes",
  "coupons.expiring_unused",
  "coupons.grant_tier_broken",
  "retention.not_configured",
  "retention.provider_cancel_bypasses_flow",
  "retention.cancel_flow_too_long",
  "retention.offer_once_discount",
  "dunning.b2b_past_due_unhandled",
  "funnel.signup_attribution_missing",
  "funnel.signup_popup_for_members",
  "crm.auto_tasks_without_assignee",
  "crm.qualified_without_owner",
  "crm.leads_without_user_id",
  "newsletter.doi_disabled",
  "newsletter.default_sender",
  "workflows.newsletter_confirmed_noop",
  "workflows.cancel_recipe_fires_on_pause",
  "workflows.overlaps_journey",
  "journeys.missing_core",
  "journeys.engine_disabled_with_active",
  "journeys.step_error_rate",
  "journeys.inbox_backlog",
  "journeys.dead_steps",
  "journeys.trigger_cycle",
  "events.ticket_benefit_unused",
  "events.upcoming_without_comms_journey",
  "clubs.rank_without_tier",
  "clubs.pending_applications_over_7d",
  "sync.emitter_silent",
  "sync.dead_event_types",
  "sync.emit_errors",
  "data_quality.documents_env_unknown",
  "data_quality.mrr_catalog_basis",
  "data_quality.ledger_drift",
  "data_quality.benchmark_stale",
  "data_quality.sandbox_only",
] as const;
export type RevenueCheckId = (typeof REVENUE_CHECK_IDS)[number];

/** Reguły z zamkniętej listy SPEC (bez opcjonalnej 55.). */
export const SPEC_CHECK_COUNT = 54;

/** Dialogi szybkich napraw - jeden na rodzinę (pakiet S7 §5.2). */
export const REVENUE_FIX_DIALOG_IDS = [
  "plan_tier",
  "plan_deactivate",
  "plan_not_for_sale",
  "tier_hide",
  "access_rule_plan",
  "metering_defaults",
  "metering_anon_limit",
  "checkout_abandon_window",
  "campaign_status",
  "retention_enable",
  "crm_assign_tasks",
  "crm_assign_owner",
  "newsletter_doi",
  "newsletter_sender",
  "workflow_disable",
] as const;
export type RevenueFixDialogId = (typeof REVENUE_FIX_DIALOG_IDS)[number];

export function isRevenueCheckId(raw: unknown): raw is RevenueCheckId {
  return typeof raw === "string" && (REVENUE_CHECK_IDS as readonly string[]).includes(raw);
}

export function isRevenueFixDialogId(raw: unknown): raw is RevenueFixDialogId {
  return typeof raw === "string" && (REVENUE_FIX_DIALOG_IDS as readonly string[]).includes(raw);
}

// ---------------------------------------------------------------------------
// Kontrakt reguły (SPEC §5.7)
// ---------------------------------------------------------------------------

export interface RevenueOwnerLink {
  /** Konkretny adres trasy z `routeTree.gen.ts` (bez szablonów `$param`). */
  to: string;
  search?: Readonly<Record<string, string>>;
}

export type RevenueCheckFix =
  | { kind: "dialog"; dialog: RevenueFixDialogId }
  | {
      kind: "link";
      to: string;
      search?: Readonly<Record<string, string>>;
      /**
       * Parametr adresu wypełniany pierwszym `refs` diagnozy - np. szablon
       * brakującej ścieżki (`/admin/revenue/journeys?new=1&template=<klucz>`).
       */
      refParam?: string;
    }
  | { kind: "code"; issueRef: string };

export interface RevenueCheckKnowledge {
  scenarios: readonly string[];
  frameworks: readonly string[];
}

export interface RevenueCheck {
  id: RevenueCheckId;
  area: RevenueArea;
  severity: RevenueSeverity;
  evaluate(facts: RevenueFacts): RevenueCheckResult;
  fix?: RevenueCheckFix;
  owner: RevenueOwnerLink;
  /** `false` dla reguł krytycznych w `sync` i `data_quality`. */
  snoozable: boolean;
}

// ---------------------------------------------------------------------------
// Rejestr
// ---------------------------------------------------------------------------

export const REVENUE_CHECKS: readonly RevenueCheck[] = [
  ...CATALOG_CHECKS,
  ...PAYWALL_CHECKS,
  ...METERING_CHECKS,
  ...CHECKOUT_CHECKS,
  ...COUPONS_CHECKS,
  ...RETENTION_CHECKS,
  ...DUNNING_CHECKS,
  ...FUNNEL_CHECKS,
  ...CRM_CHECKS,
  ...NEWSLETTER_CHECKS,
  ...WORKFLOWS_CHECKS,
  ...JOURNEYS_CHECKS,
  ...EVENTS_CHECKS,
  ...CLUBS_CHECKS,
  ...SYNC_CHECKS,
  ...DATA_QUALITY_CHECKS,
];

const BY_ID = new Map<RevenueCheckId, RevenueCheck>(REVENUE_CHECKS.map((c) => [c.id, c]));

export function revenueCheck(id: RevenueCheckId): RevenueCheck | undefined {
  return BY_ID.get(id);
}

/**
 * Niewyciszalne - lustro bloku `unsnoozable` w 20261020150100. Wyliczane
 * z rejestru (krytyczne w `sync`/`data_quality`), a test porównuje wynik
 * z tablicą SQL - dopisanie krytycznej reguły bez SQL zapali parytet.
 */
export const UNSNOOZABLE_CHECK_IDS: readonly RevenueCheckId[] = REVENUE_CHECKS.filter(
  (c) => c.severity === "critical" && (c.area === "sync" || c.area === "data_quality"),
).map((c) => c.id);

// ---------------------------------------------------------------------------
// Wiedza Insidera - same identyfikatory (pakiet S7 §5.1)
// ---------------------------------------------------------------------------

/** Identyfikatory wiedzy Insidera per reguła (bez treści) - renderuje moduł wiedzy (I9). */
export const CHECK_KNOWLEDGE: Readonly<Partial<Record<RevenueCheckId, RevenueCheckKnowledge>>> = {
  "newsletter.default_sender": { scenarios: ["subject", "spam"], frameworks: [] },
  "newsletter.doi_disabled": { scenarios: ["spamrate", "inbox"], frameworks: ["permission"] },
  "retention.not_configured": { scenarios: ["churn", "quickratio"], frameworks: [] },
  "retention.cancel_flow_too_long": { scenarios: ["effortless", "peakend"], frameworks: [] },
  "retention.offer_once_discount": { scenarios: ["prospect"], frameworks: [] },
  "dunning.b2b_past_due_unhandled": { scenarios: [], frameworks: ["quickratio"] },
  "funnel.signup_attribution_missing": {
    scenarios: ["unassigned", "measure"],
    frameworks: ["attribution", "dmmm"],
  },
  "funnel.signup_popup_for_members": { scenarios: ["nudge"], frameworks: [] },
  "checkout.abandon_window_default": { scenarios: ["cartaband"], frameworks: [] },
  "checkout.display_currency_mismatch": { scenarios: ["cartaband"], frameworks: [] },
  "crm.auto_tasks_without_assignee": { scenarios: ["leadspeed", "mqlsql"], frameworks: [] },
  "crm.qualified_without_owner": { scenarios: ["leadspeed", "mqlsql"], frameworks: [] },
  "events.upcoming_without_comms_journey": { scenarios: ["lowattend"], frameworks: [] },
  "journeys.missing_core": {
    scenarios: ["cartaband", "lowattend", "activation", "leadspeed", "churn"],
    frameworks: [],
  },
  "data_quality.benchmark_stale": {
    scenarios: ["measure", "unassigned", "tagcov"],
    frameworks: [],
  },
  "clubs.pending_applications_over_7d": { scenarios: [], frameworks: ["leadspeed", "slowresp"] },
};

// ---------------------------------------------------------------------------
// Diagnozy
// ---------------------------------------------------------------------------

/** Aktywne wyciszenie z `admin_revenue_diagnostic_snoozes()`. */
export interface RevenueSnooze {
  id: string;
  checkId: string;
  scopeKey: string;
  kind: "days" | "intentional";
  until: string | null;
  reason: string | null;
  scopeHash: string | null;
  createdAt: string | null;
}

export interface RevenueFinding {
  checkId: RevenueCheckId;
  area: RevenueArea;
  severity: RevenueSeverity;
  state: RevenueCheckState;
  count: number | null;
  refs: readonly string[];
  evidence: readonly RevenueEvidence[];
  impact: RevenueImpact;
  factHash: string;
  fix: RevenueCheckFix | null;
  owner: RevenueOwnerLink;
  snoozable: boolean;
  /** Wyciszenie, które NADAL obowiązuje (termin trwa / odcisk się zgadza). */
  snooze: RevenueSnooze | null;
}

/** Diagnoza otwarta = problem (warn|error) bez obowiązującego wyciszenia. */
export function isOpenFinding(finding: Pick<RevenueFinding, "state" | "snooze">): boolean {
  return (finding.state === "warn" || finding.state === "error") && finding.snooze === null;
}

/**
 * Czy wyciszenie obowiązuje dla wyniku: `days` - termin w przyszłości;
 * `intentional` - odcisk faktów bez zmian (inny stan, liczba albo lista
 * obiektów = nowa sytuacja, którą admin musi zobaczyć). Niewyciszalne nigdy.
 */
export function snoozeApplies(
  snooze: RevenueSnooze,
  finding: Pick<RevenueFinding, "factHash" | "snoozable">,
  nowMs: number,
): boolean {
  if (!finding.snoozable) return false;
  if (snooze.kind === "days") {
    const until = snooze.until === null ? Number.NaN : Date.parse(snooze.until);
    return Number.isFinite(until) && until > nowMs;
  }
  return snooze.scopeHash !== null && snooze.scopeHash === finding.factHash;
}

/** Wynik jednej reguły - wyjątek reguły (błąd kodu) = „nie wiadomo", nie awaria listy. */
export function runCheck(check: RevenueCheck, facts: RevenueFacts): RevenueCheckResult {
  try {
    return check.evaluate(facts);
  } catch {
    return { state: "unknown" };
  }
}

/** Ocena wszystkich reguł - diagnoza na regułę, także `ok` i `unknown`. */
export function evaluateRegistry(
  facts: RevenueFacts,
  snoozes: readonly RevenueSnooze[],
  nowMs: number,
  checks: readonly RevenueCheck[] = REVENUE_CHECKS,
): RevenueFinding[] {
  return checks.map((check) => {
    const result = runCheck(check, facts);
    const refs = result.refs ?? [];
    const factHash = result.factHash ?? factHashOf({ state: result.state, count: result.count, refs });
    const base = {
      checkId: check.id,
      area: check.area,
      severity: check.severity,
      state: result.state,
      count: result.count ?? null,
      refs,
      evidence: result.evidence ?? [],
      impact: result.impact ?? defaultImpact(check.severity, result.state),
      factHash,
      fix: check.fix ?? null,
      owner: check.owner,
      snoozable: check.snoozable,
    };
    const snooze =
      snoozes.find(
        (s) =>
          s.checkId === check.id &&
          s.scopeKey === "*" &&
          snoozeApplies(s, { factHash, snoozable: check.snoozable }, nowMs),
      ) ?? null;
    return { ...base, snooze };
  });
}

const SEVERITY_RANK: Readonly<Record<RevenueSeverity, number>> = {
  critical: 0,
  warning: 1,
  info: 2,
};
const STATE_RANK: Readonly<Record<RevenueCheckState, number>> = {
  error: 0,
  warn: 1,
  unknown: 2,
  ok: 3,
};
const IMPACT_RANK: Readonly<Record<RevenueImpact, number>> = { high: 0, medium: 1, low: 2 };

/** Kolejność listy: waga, stan (trwający skutek przed uśpionym), wpływ, liczba, id. */
export function compareFindings(a: RevenueFinding, b: RevenueFinding): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    STATE_RANK[a.state] - STATE_RANK[b.state] ||
    IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] ||
    (b.count ?? 0) - (a.count ?? 0) ||
    a.checkId.localeCompare(b.checkId)
  );
}
