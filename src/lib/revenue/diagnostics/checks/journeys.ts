// Reguły obszaru „Ścieżki komunikacji" (SPEC §5.7; S5).
//
// Progi operacyjne mają źródło w kodzie, nie w benchmarku: zaległość
// skrzynki mierzymy progami świeżości harmonogramu (`SCHEDULER_*_MS`, ta sama
// kropka „działa / opóźnienie / stoi" co w nagłówku huba), odsetek błędów -
// granicą większości (więcej nieudanych kroków niż udanych = awaria
// systemowa, nie pojedynczy kontakt).
import { SCHEDULER_FRESH_MS, SCHEDULER_LAGGING_MS } from "@/lib/jobs/scheduler";
import { areaFacts, ev, finding, OK, UNKNOWN } from "../facts";
import type { RevenueCheck } from "../registry";

/**
 * Rdzeń ścieżek (REK pakietu S7 §3.8 - SPEC listy nie podaje): M3 =
 * powitanie i porzucona kasa (bez nich lejek samoobsługi nie ma żadnego
 * kontaktu); rozszerzenie Insidera = opieka nad zapisanymi na wydarzenie,
 * zaległa płatność B2B i ratowanie zaplanowanego anulowania.
 */
export const CORE_JOURNEY_TEMPLATES = ["welcome_onboarding", "abandoned_checkout"] as const;
export const EXTENDED_CORE_JOURNEY_TEMPLATES = [
  "event_registration_nurture",
  "payment_failed_crm",
  "cancel_scheduled_save",
] as const;

/** Większość nieudanych kroków (≥ 50 %) = awaria systemowa. */
export const STEP_FAILURE_MAJORITY = 0.5;

const OWNER = { to: "/admin/revenue/journeys" } as const;

export const JOURNEYS_CHECKS = [
  {
    id: "journeys.missing_core",
    area: "journeys",
    severity: "warning",
    evaluate(facts) {
      const active = areaFacts(facts, "journeys")?.activeTemplates;
      if (!active) return UNKNOWN;
      const core = CORE_JOURNEY_TEMPLATES.filter((key) => !active.includes(key));
      const extended = EXTENDED_CORE_JOURNEY_TEMPLATES.filter((key) => !active.includes(key));
      if (core.length + extended.length === 0) return OK;
      return finding(core.length > 0 ? "error" : "warn", {
        count: core.length + extended.length,
        refs: [...core, ...extended],
        evidence: [
          ...(core.length > 0 ? [ev("journeysCoreMissing", { count: core.length })] : []),
          ...(extended.length > 0
            ? [ev("journeysExtendedMissing", { count: extended.length })]
            : []),
        ],
      });
    },
    fix: {
      kind: "link",
      to: "/admin/revenue/journeys",
      search: { new: "1" },
      refParam: "template",
    },
    owner: OWNER,
    snoozable: true,
  },
  {
    id: "journeys.engine_disabled_with_active",
    area: "journeys",
    severity: "warning",
    evaluate(facts) {
      const journeys = areaFacts(facts, "journeys");
      if (
        journeys?.engineEnabled === undefined ||
        journeys.activeCount === undefined ||
        journeys.pendingInbox === undefined
      ) {
        return UNKNOWN;
      }
      if (journeys.engineEnabled || journeys.activeCount === 0) return OK;
      // Zdarzenia czekają w skrzynce - kontakty, które powinny dostać
      // wiadomość, właśnie jej nie dostają.
      return finding(journeys.pendingInbox > 0 ? "error" : "warn", {
        count: journeys.activeCount,
        evidence: ev("engineOffWithActive", {
          count: journeys.activeCount,
          pending: journeys.pendingInbox,
        }),
      });
    },
    fix: { kind: "link", to: "/admin/revenue/journeys" },
    owner: OWNER,
    snoozable: true,
  },
  {
    id: "journeys.step_error_rate",
    area: "journeys",
    severity: "warning",
    evaluate(facts) {
      const runs = areaFacts(facts, "journeys")?.stepRuns24h;
      if (runs?.finished === undefined || runs.failed === undefined) return UNKNOWN;
      if (runs.finished === 0 || runs.failed === 0) return OK;
      const share = runs.failed / runs.finished;
      return finding(share >= STEP_FAILURE_MAJORITY ? "error" : "warn", {
        count: runs.failed,
        evidence: ev("stepFailures", {
          count: runs.failed,
          total: runs.finished,
          percent: Math.round(share * 100),
        }),
      });
    },
    fix: { kind: "link", to: "/admin/revenue/journeys" },
    owner: OWNER,
    snoozable: true,
  },
  {
    id: "journeys.inbox_backlog",
    area: "journeys",
    severity: "warning",
    evaluate(facts) {
      const journeys = areaFacts(facts, "journeys");
      const now = facts.computedAt === null ? Number.NaN : Date.parse(facts.computedAt);
      if (
        journeys?.pendingInbox === undefined ||
        journeys.oldestPendingAt === undefined ||
        !Number.isFinite(now)
      ) {
        return UNKNOWN;
      }
      if (journeys.pendingInbox === 0 || journeys.oldestPendingAt === null) return OK;
      const ageMs = now - Date.parse(journeys.oldestPendingAt);
      if (!Number.isFinite(ageMs) || ageMs <= SCHEDULER_FRESH_MS) return OK;
      const minutes = Math.round(ageMs / 60_000);
      return finding(ageMs > SCHEDULER_LAGGING_MS ? "error" : "warn", {
        count: journeys.pendingInbox,
        evidence: ev("inboxBacklog", { count: journeys.pendingInbox, minutes }),
      });
    },
    fix: { kind: "link", to: "/admin/revenue/journeys" },
    owner: OWNER,
    snoozable: true,
  },
  {
    id: "journeys.dead_steps",
    area: "journeys",
    severity: "warning",
    evaluate(facts) {
      const journeys = areaFacts(facts, "journeys");
      if (journeys?.deadSteps === undefined || journeys.deadJourneys === undefined) return UNKNOWN;
      if (journeys.deadSteps.length === 0) return OK;
      const unreached = journeys.deadSteps.reduce((sum, j) => sum + j.unreached, 0);
      // Ścieżka z zapisami, w której NIE wykonał się żaden krok - martwa cała.
      return finding(journeys.deadJourneys > 0 ? "error" : "warn", {
        count: unreached,
        refs: journeys.deadSteps.map((j) => j.journeyId),
        evidence: ev(journeys.deadJourneys > 0 ? "deadJourneys" : "deadSteps", {
          count: unreached,
          journeys: journeys.deadJourneys > 0 ? journeys.deadJourneys : journeys.deadSteps.length,
        }),
      });
    },
    fix: { kind: "link", to: "/admin/revenue/journeys" },
    owner: OWNER,
    snoozable: true,
  },
  {
    // Akcja ścieżki A emituje zdarzenie, na którym startuje ścieżka B, a B -
    // to, na którym startuje A. Przy ponownym wejściu (`reentry` inne niż
    // `never`) kontakt krąży bez końca.
    id: "journeys.trigger_cycle",
    area: "journeys",
    severity: "warning",
    evaluate(facts) {
      const cycles = areaFacts(facts, "journeys")?.cycles;
      if (!cycles) return UNKNOWN;
      if (cycles.bounded + cycles.unbounded === 0) return OK;
      return finding(cycles.unbounded > 0 ? "error" : "warn", {
        count: cycles.bounded + cycles.unbounded,
        refs: cycles.refs,
        evidence: ev(cycles.unbounded > 0 ? "triggerCycleUnbounded" : "triggerCycleBounded", {
          count: cycles.bounded + cycles.unbounded,
        }),
      });
    },
    fix: { kind: "link", to: "/admin/revenue/journeys" },
    owner: OWNER,
    snoozable: true,
  },
] as const satisfies readonly RevenueCheck[];
