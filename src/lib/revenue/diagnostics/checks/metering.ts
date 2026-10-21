// Reguły obszaru „Limit darmowych artykułów" (SPEC §5.7; def. 14 br. 02, P19).
import { areaFacts, ev, finding, OK, UNKNOWN } from "../facts";
import type { RevenueCheck } from "../registry";

const OWNER = { to: "/admin/paywall", search: { tab: "metering" } } as const;

export const METERING_CHECKS = [
  {
    // Brak wiersza ustawień = serwer traktuje licznik jak WYŁĄCZONY (def. 14),
    // choć formularz pokazuje wartości domyślne - czytelnik treści objętej
    // licznikiem dostaje twardy paywall zamiast darmowych artykułów.
    id: "metering.settings_row_missing",
    area: "metering",
    severity: "critical",
    evaluate(facts) {
      const metering = areaFacts(facts, "metering");
      if (metering?.settingsRow === undefined || metering.meteredRules === undefined)
        return UNKNOWN;
      if (metering.settingsRow) return OK;
      return finding(metering.meteredRules > 0 ? "error" : "warn", {
        count: metering.meteredRules,
        evidence: ev("meteringRowMissing", { count: metering.meteredRules }),
      });
    },
    fix: { kind: "dialog", dialog: "metering_defaults" },
    owner: OWNER,
    snoozable: true,
  },
  {
    id: "metering.anon_zero_limit",
    area: "metering",
    severity: "info",
    evaluate(facts) {
      const metering = areaFacts(facts, "metering");
      if (metering?.settingsRow === undefined) return UNKNOWN;
      // Bez wiersza o licznik pyta reguła wyżej; wyłączony licznik nie ma limitu gości.
      if (!metering.settingsRow || metering.enabled === false) return OK;
      if (
        metering.enabled === undefined ||
        metering.anonMonthlyLimit === undefined ||
        metering.anonMonthlyLimit === null ||
        metering.memberMonthlyLimit === undefined ||
        metering.memberMonthlyLimit === null
      ) {
        return UNKNOWN;
      }
      if (metering.anonMonthlyLimit > 0) return OK;
      // Licznik włączony, a ani gość, ani członek nie dostaje artykułu -
      // ustawienie sprzeczne; sam gość bez limitu to świadoma ściana rejestracji.
      return metering.memberMonthlyLimit === 0
        ? finding("error", { evidence: ev("meteringNobodyFree") })
        : finding("warn", {
            evidence: ev("meteringAnonZero", { members: metering.memberMonthlyLimit }),
          });
    },
    fix: { kind: "dialog", dialog: "metering_anon_limit" },
    owner: OWNER,
    snoozable: true,
  },
  {
    // P19: licznik wydawał treść z progiem rangi każdemu. Sonda czyta ciało
    // `_metered_view_consume` - poprawka 20261020120200 pyta o rangę
    // czytającego (`user_tier_rank`); jej brak = regresja.
    id: "metering.rank_bypass",
    area: "metering",
    severity: "critical",
    evaluate(facts) {
      const metering = areaFacts(facts, "metering");
      if (
        metering?.rankGatePresent === undefined ||
        metering.rankGatePresent === null ||
        metering.meteredTierGated === undefined
      ) {
        return UNKNOWN;
      }
      if (metering.rankGatePresent) return OK;
      return finding(metering.meteredTierGated > 0 ? "error" : "warn", {
        count: metering.meteredTierGated,
        evidence: ev("meteringRankBypass", { count: metering.meteredTierGated }),
      });
    },
    fix: { kind: "code", issueRef: "metering.rank_bypass" },
    owner: OWNER,
    snoozable: true,
  },
] as const satisfies readonly RevenueCheck[];
