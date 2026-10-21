// Reguły obszaru „Retencja" (SPEC §5.7; P01, P02, Z-09).
import { areaFacts, ev, finding, OK, UNKNOWN } from "../facts";
import type { RevenueCheck } from "../registry";

/** Najdłuższa dopuszczalna ścieżka anulowania (SPEC §2.2: „przepływ anulowania (≤ 2 kroki)"). */
export const RETENTION_MAX_STEPS = 2;

const OWNER = { to: "/admin/pricing", search: { tab: "retention" } } as const;

export const RETENTION_CHECKS = [
  {
    id: "retention.not_configured",
    area: "retention",
    severity: "warning",
    evaluate(facts) {
      const retention = areaFacts(facts, "retention");
      if (retention?.settingsRow === undefined) return UNKNOWN;
      if (retention.settingsRow && retention.enabled === true) return OK;
      if (retention.cancellations30d === undefined) return UNKNOWN;
      // Klienci odchodzą TERAZ bez kontroferty - utracona szansa trwa.
      return finding(retention.cancellations30d > 0 ? "error" : "warn", {
        count: retention.cancellations30d,
        evidence: ev(retention.settingsRow ? "retentionDisabled" : "retentionMissing", {
          count: retention.cancellations30d,
        }),
      });
    },
    fix: { kind: "dialog", dialog: "retention_enable" },
    owner: OWNER,
    snoozable: true,
  },
  {
    // P01: anulowanie z pominięciem przepływu. Wpis z portalu operatora
    // (`stripe:<kod>`) to obejście, ale z powodem (warn); anulowanie bez
    // żadnego wpisu to utracony powód i utracona szansa (error).
    id: "retention.provider_cancel_bypasses_flow",
    area: "retention",
    severity: "critical",
    evaluate(facts) {
      const bypass = areaFacts(facts, "retention")?.flowBypass;
      if (bypass?.withoutFeedback === undefined || bypass.providerOnly === undefined)
        return UNKNOWN;
      if (bypass.withoutFeedback + bypass.providerOnly === 0) return OK;
      return finding(bypass.withoutFeedback > 0 ? "error" : "warn", {
        count: bypass.withoutFeedback + bypass.providerOnly,
        refs: bypass.refs,
        evidence: [
          ...(bypass.withoutFeedback > 0
            ? [ev("cancelWithoutFeedback", { count: bypass.withoutFeedback })]
            : []),
          ...(bypass.providerOnly > 0
            ? [ev("cancelProviderOnly", { count: bypass.providerOnly })]
            : []),
        ],
      });
    },
    fix: { kind: "code", issueRef: "retention.provider_cancel_bypasses_flow" },
    owner: OWNER,
    snoozable: true,
  },
  {
    id: "retention.cancel_flow_too_long",
    area: "retention",
    severity: "critical",
    evaluate(facts) {
      const retention = areaFacts(facts, "retention");
      const steps = retention?.cancelPathSteps;
      if (steps === undefined) return UNKNOWN;
      if (steps > RETENTION_MAX_STEPS) {
        return finding("error", {
          count: steps,
          evidence: ev("cancelFlowSteps", { steps, max: RETENTION_MAX_STEPS }),
        });
      }
      if (steps < RETENTION_MAX_STEPS) return OK;
      // Na granicy dwóch kroków: jeśli większość klientów porzuca przepływ
      // w połowie, ścieżka jest dla nich za długa, choć mieści się w regule.
      const flows = retention?.flows30d;
      if (
        flows?.abandoned === undefined ||
        flows.canceled === undefined ||
        flows.saved === undefined
      ) {
        return UNKNOWN;
      }
      if (flows.abandoned > flows.canceled + flows.saved) {
        return finding("warn", {
          count: flows.abandoned,
          evidence: ev("cancelFlowAbandoned", {
            abandoned: flows.abandoned,
            finished: flows.canceled + flows.saved,
          }),
        });
      }
      return OK;
    },
    fix: { kind: "code", issueRef: "retention.cancel_flow_too_long" },
    owner: OWNER,
    snoozable: true,
  },
  {
    // P02: oferta przyjęta, a subskrypcja u operatora bez rabatu (kupon
    // niewykonalny albo jednorazowy) - klient dostał obietnicę bez skutku.
    // Rabat ustawiony na jeden okres to świadomy wybór, ale „jednorazowy" -
    // zgłaszamy jako uśpione ryzyko tego samego defektu.
    id: "retention.offer_once_discount",
    area: "retention",
    severity: "warning",
    evaluate(facts) {
      const retention = areaFacts(facts, "retention");
      if (
        retention?.acceptedWithoutDiscount30d === undefined ||
        retention.settingsRow === undefined
      ) {
        return UNKNOWN;
      }
      if (retention.acceptedWithoutDiscount30d > 0) {
        return finding("error", {
          count: retention.acceptedWithoutDiscount30d,
          evidence: ev("offerAcceptedNoDiscount", { count: retention.acceptedWithoutDiscount30d }),
        });
      }
      if (retention.settingsRow && retention.enabled === true && retention.discountPeriods === 1) {
        return finding("warn", { evidence: ev("offerSinglePeriod") });
      }
      return OK;
    },
    fix: { kind: "code", issueRef: "retention.offer_once_discount" },
    owner: OWNER,
    snoozable: true,
  },
] as const satisfies readonly RevenueCheck[];
