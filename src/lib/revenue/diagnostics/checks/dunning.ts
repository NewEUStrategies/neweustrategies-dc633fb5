// Reguła obszaru „Windykacja płatności" (SPEC §5.7; P13: past_due niewidoczne).
//
// Instytucja z zaległą płatnością to rozmowa handlowa, nie sam mail
// operatora. Obsłużona = aktywna ścieżka `payment_failed_crm` (zadanie
// tworzy się samo) albo ręczne zadanie CRM po starcie cyklu windykacji.
import { areaFacts, ev, finding, OK, UNKNOWN } from "../facts";
import type { RevenueCheck } from "../registry";

export const DUNNING_CHECKS = [
  {
    id: "dunning.b2b_past_due_unhandled",
    area: "dunning",
    severity: "warning",
    evaluate(facts) {
      const dunning = areaFacts(facts, "dunning");
      if (
        dunning?.openB2b === undefined ||
        dunning.withoutTask === undefined ||
        dunning.journeyActive === undefined
      ) {
        return UNKNOWN;
      }
      if (dunning.openB2b === 0 || dunning.journeyActive) return OK;
      return finding(dunning.withoutTask > 0 ? "error" : "warn", {
        count: dunning.openB2b,
        refs: dunning.refs,
        evidence: ev(dunning.withoutTask > 0 ? "b2bPastDueNoTask" : "b2bPastDueNoJourney", {
          count: dunning.openB2b,
          withoutTask: dunning.withoutTask,
        }),
      });
    },
    fix: {
      kind: "link",
      to: "/admin/revenue/journeys",
      search: { new: "1", template: "payment_failed_crm" },
    },
    owner: { to: "/admin/billing", search: { tab: "subscriptions", status: "past_due" } },
    snoozable: true,
  },
] as const satisfies readonly RevenueCheck[];
