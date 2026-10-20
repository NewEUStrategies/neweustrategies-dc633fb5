// Reguły obszaru „Paywall i reguły dostępu" (SPEC §5.7; P14, P18).
//
// Ślepe zaułki liczy SQL tymi samymi warunkami co inwentarz dostępu
// (`admin_revenue_access_inventory`, 120400), więc liczba w diagnozie
// i w zakładce Dostęp jest jedna. `error` = do zaułka trafił w ostatnich 30
// dniach czytelnik (uderzenie w paywall tej treści), `warn` = zaułek bez ruchu.
import { areaFacts, ev, finding, OK, UNKNOWN, type CountWithRefs } from "../facts";
import type { RevenueCheck, RevenueCheckFix } from "../registry";

/**
 * Tydzień bez ani jednego uderzenia w paywall przy treści płatnej = pomiar
 * milczy. Tydzień obejmuje pełny cykl ruchu (dni robocze + weekend), więc
 * cisza nie jest zwykłym spokojnym dniem. Próg operacyjny, nie benchmark.
 */
export const PAYWALL_SILENT_DAYS = 7;

const DAY_MS = 86_400_000;

const OWNER_OVERRIDES = { to: "/admin/paywall", search: { tab: "overrides" } } as const;

/** Ślepy zaułek: `error`, gdy dotarł do niego czytelnik w 30 dni. */
function deadEnd(
  value: CountWithRefs | undefined,
  key: string,
): ReturnType<RevenueCheck["evaluate"]> {
  if (value?.count === undefined || value.withHits30d === undefined) return UNKNOWN;
  if (value.count === 0) return OK;
  return finding(value.withHits30d > 0 ? "error" : "warn", {
    count: value.count,
    refs: value.refs,
    evidence: ev(key, { count: value.count, withHits: value.withHits30d }),
  });
}

const ACCESS_RULE_FIX: RevenueCheckFix = { kind: "dialog", dialog: "access_rule_plan" };

export const PAYWALL_CHECKS = [
  {
    id: "paywall.paid_without_buyable_plan",
    area: "paywall",
    severity: "critical",
    evaluate: (facts) => deadEnd(areaFacts(facts, "paywall")?.paidWithoutOffer, "paidWithoutOffer"),
    fix: ACCESS_RULE_FIX,
    owner: OWNER_OVERRIDES,
    snoozable: true,
  },
  {
    id: "paywall.rule_inactive_plan",
    area: "paywall",
    severity: "warning",
    evaluate: (facts) => deadEnd(areaFacts(facts, "paywall")?.danglingRules, "ruleInactivePlan"),
    fix: ACCESS_RULE_FIX,
    owner: OWNER_OVERRIDES,
    snoozable: true,
  },
  {
    id: "paywall.members_rank_no_cta",
    area: "paywall",
    severity: "warning",
    evaluate: (facts) =>
      deadEnd(areaFacts(facts, "paywall")?.membersRankNoCta, "membersRankNoCta"),
    fix: { kind: "link", to: "/admin/pricing", search: { tab: "tiers" } },
    owner: OWNER_OVERRIDES,
    snoozable: true,
  },
  {
    id: "paywall.measurement_silent",
    area: "paywall",
    severity: "warning",
    evaluate(facts) {
      const paywall = areaFacts(facts, "paywall");
      const now = facts.computedAt === null ? Number.NaN : Date.parse(facts.computedAt);
      if (
        !paywall ||
        paywall.gatedRules === undefined ||
        paywall.lastHitAt === undefined ||
        paywall.firstGatedAt === undefined ||
        !Number.isFinite(now)
      ) {
        return UNKNOWN;
      }
      if (paywall.gatedRules === 0) return OK;
      const silentSince = now - PAYWALL_SILENT_DAYS * DAY_MS;
      if (paywall.lastHitAt === null) {
        const gatedAt = paywall.firstGatedAt === null ? now : Date.parse(paywall.firstGatedAt);
        // Treść płatna stoi dłużej niż tydzień, a pomiar nie zapisał NIC.
        if (gatedAt < silentSince) {
          return finding("error", {
            count: paywall.gatedRules,
            evidence: ev("paywallNeverMeasured", {
              count: paywall.gatedRules,
              days: PAYWALL_SILENT_DAYS,
            }),
          });
        }
        return OK;
      }
      if (Date.parse(paywall.lastHitAt) < silentSince) {
        return finding("warn", {
          count: paywall.gatedRules,
          evidence: ev("paywallSilent", { count: paywall.gatedRules, days: PAYWALL_SILENT_DAYS }),
        });
      }
      return OK;
    },
    fix: { kind: "code", issueRef: "paywall.measurement_silent" },
    owner: { to: "/admin/paywall" },
    snoozable: true,
  },
] as const satisfies readonly RevenueCheck[];
