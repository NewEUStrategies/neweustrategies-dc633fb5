// Reguły obszaru „Lejek" (SPEC §5.7; regresje P16 i P17, DZ §18.4).
import { areaFacts, ev, finding, OK, UNKNOWN } from "../facts";
import type { RevenueCheck } from "../registry";

/**
 * Więcej niż połowa rejestracji bez źródła = raport źródeł przestaje mówić
 * prawdę o kanałach (większość wiersza to „nieznane"). Granica logiczna
 * (większość), nie benchmark.
 */
export const ATTRIBUTION_UNKNOWN_MAJORITY = 0.5;

const OWNER = { to: "/admin/newsletter/popup" } as const;

export const FUNNEL_CHECKS = [
  {
    id: "funnel.signup_attribution_missing",
    area: "funnel",
    severity: "warning",
    evaluate(facts) {
      const funnel = areaFacts(facts, "funnel");
      if (funnel?.signups30d === undefined || funnel.unknownSource30d === undefined) return UNKNOWN;
      if (funnel.signups30d === 0 || funnel.unknownSource30d === 0) return OK;
      const share = funnel.unknownSource30d / funnel.signups30d;
      // Wszystkie rejestracje bez źródła = atrybucja martwa (regresja P16).
      if (funnel.unknownSource30d >= funnel.signups30d) {
        return finding("error", {
          count: funnel.unknownSource30d,
          evidence: ev("attributionDead", { count: funnel.signups30d }),
        });
      }
      if (share > ATTRIBUTION_UNKNOWN_MAJORITY) {
        return finding("warn", {
          count: funnel.unknownSource30d,
          evidence: ev("attributionMostlyUnknown", {
            unknown: funnel.unknownSource30d,
            total: funnel.signups30d,
          }),
        });
      }
      return OK;
    },
    fix: { kind: "code", issueRef: "funnel.signup_attribution_missing" },
    owner: OWNER,
    snoozable: true,
  },
  {
    // P17: zaproszenie do konta pokazywane zalogowanym. Ślad = zapis
    // z popupu przez konto założone wcześniej; w ostatnich 7 dniach regresja
    // trwa, starszy ślad w oknie 30 dni - historia do sprawdzenia.
    id: "funnel.signup_popup_for_members",
    area: "funnel",
    severity: "warning",
    evaluate(facts) {
      const funnel = areaFacts(facts, "funnel");
      if (funnel?.popupMembers7d === undefined || funnel.popupMembers30d === undefined)
        return UNKNOWN;
      if (funnel.popupMembers30d === 0) return OK;
      return finding(funnel.popupMembers7d > 0 ? "error" : "warn", {
        count: funnel.popupMembers30d,
        evidence: ev("popupForMembers", {
          recent: funnel.popupMembers7d,
          count: funnel.popupMembers30d,
        }),
      });
    },
    fix: { kind: "code", issueRef: "funnel.signup_popup_for_members" },
    owner: OWNER,
    snoozable: true,
  },
] as const satisfies readonly RevenueCheck[];
