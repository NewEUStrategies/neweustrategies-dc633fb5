// Lista kontrolna paywalla (S7, `paywallChecklist.ts`).
//
// CO TEN PLIK DOWODZI.
//   1. Pozycje to reguły rejestru S7-A z obszarów ściany, licznika i kasy -
//      każda, także ta bez faktu („nie wiadomo"); obszary spoza listy odpadają.
//   2. Stan: `ok` = gotowe, problem = do zrobienia, wyciszony problem =
//      wyciszone, brak faktu = nie wiadomo (NIGDY „gotowe").
//   3. „Napraw": dialog → Diagnostyka z `?fix=`, odnośnik → cel naprawy,
//      kod → ekran-właściciel; pozycja gotowa i nieznana nie mają akcji.
//   4. Kolejność: ściana → licznik → kasa, w obszarze od najpoważniejszej.
import { describe, expect, it } from "vitest";

import {
  PAYWALL_CHECKLIST_AREAS,
  paywallChecklist,
  paywallChecklistSummary,
} from "@/lib/admin/revenue/paywallChecklist";
import { EMPTY_REVENUE_FACTS } from "@/lib/revenue/diagnostics/facts";
import { evaluateAreaFindings } from "@/lib/revenue/diagnostics/queries";
import {
  REVENUE_CHECKS,
  type RevenueFinding,
  type RevenueSnooze,
} from "@/lib/revenue/diagnostics/registry";

function finding(
  overrides: Partial<RevenueFinding> & Pick<RevenueFinding, "checkId">,
): RevenueFinding {
  return {
    area: "paywall",
    severity: "warning",
    state: "ok",
    count: null,
    refs: [],
    evidence: [],
    impact: "low",
    factHash: "h",
    fix: null,
    owner: { to: "/admin/paywall" },
    snoozable: true,
    snooze: null,
    ...overrides,
  };
}

const SNOOZE: RevenueSnooze = {
  id: "s-1",
  checkId: "checkout.abandon_window_default",
  scopeKey: "*",
  kind: "days",
  until: "2026-12-01T00:00:00Z",
  reason: null,
  scopeHash: null,
  createdAt: "2026-10-01T00:00:00Z",
};

describe("paywallChecklist - stany i akcje", () => {
  const items = paywallChecklist([
    finding({
      checkId: "checkout.abandon_window_default",
      area: "checkout",
      severity: "info",
      state: "warn",
      fix: { kind: "dialog", dialog: "checkout_abandon_window" },
      snooze: SNOOZE,
    }),
    finding({
      checkId: "metering.settings_row_missing",
      area: "metering",
      severity: "critical",
      state: "error",
      count: 1,
      fix: { kind: "dialog", dialog: "metering_defaults" },
    }),
    finding({ checkId: "paywall.measurement_silent", state: "unknown" }),
    finding({
      checkId: "paywall.members_rank_no_cta",
      state: "warn",
      fix: { kind: "link", to: "/admin/pricing", search: { tab: "tiers" } },
    }),
    finding({
      checkId: "paywall.paid_without_buyable_plan",
      severity: "critical",
      state: "ok",
    }),
    finding({
      checkId: "checkout.display_currency_mismatch",
      area: "checkout",
      state: "warn",
      fix: { kind: "code", issueRef: "P09" },
      owner: { to: "/admin/pricing" },
    }),
    // Obszar spoza listy kontrolnej - nie trafia na Dostęp.
    finding({ checkId: "coupons.expiring_unused", area: "coupons", state: "warn" }),
  ]);

  it("tylko obszary ściany, licznika i kasy - w tej kolejności, od najpoważniejszej", () => {
    expect(items.map((item) => item.checkId)).toEqual([
      "paywall.paid_without_buyable_plan",
      "paywall.measurement_silent",
      "paywall.members_rank_no_cta",
      "metering.settings_row_missing",
      "checkout.display_currency_mismatch",
      "checkout.abandon_window_default",
    ]);
  });

  it("stan: gotowe, nie wiadomo, do zrobienia, wyciszone", () => {
    const status = Object.fromEntries(items.map((item) => [item.checkId, item.status]));
    expect(status).toEqual({
      "paywall.paid_without_buyable_plan": "done",
      "paywall.measurement_silent": "unknown",
      "paywall.members_rank_no_cta": "todo",
      "metering.settings_row_missing": "todo",
      "checkout.display_currency_mismatch": "todo",
      "checkout.abandon_window_default": "snoozed",
    });
  });

  it("akcja: dialog → Diagnostyka z ?fix=, odnośnik → cel, kod → właściciel; gotowe bez akcji", () => {
    const action = Object.fromEntries(items.map((item) => [item.checkId, item.action]));
    expect(action["metering.settings_row_missing"]).toEqual({
      to: "/admin/revenue/diagnostics",
      search: { fix: "metering.settings_row_missing" },
    });
    expect(action["paywall.members_rank_no_cta"]).toEqual({
      to: "/admin/pricing",
      search: { tab: "tiers" },
    });
    expect(action["checkout.display_currency_mismatch"]).toEqual({ to: "/admin/pricing" });
    expect(action["paywall.paid_without_buyable_plan"]).toBeNull();
    expect(action["paywall.measurement_silent"]).toBeNull();
  });

  it("podsumowanie nie liczy nieznanych ani wyciszonych jako gotowych", () => {
    expect(paywallChecklistSummary(items)).toEqual({
      total: 6,
      done: 1,
      todo: 3,
      snoozed: 1,
      unknown: 1,
    });
  });
});

describe("paywallChecklist na rejestrze S7-A", () => {
  it("bez faktów każda reguła obszarów paywalla jest pozycją „nie wiadomo”", () => {
    const findings = evaluateAreaFindings(EMPTY_REVENUE_FACTS, [], PAYWALL_CHECKLIST_AREAS);
    const items = paywallChecklist(findings);
    const expected = REVENUE_CHECKS.filter((check) =>
      (PAYWALL_CHECKLIST_AREAS as readonly string[]).includes(check.area),
    ).map((check) => check.id);
    expect(items.map((item) => item.checkId).sort()).toEqual([...expected].sort());
    expect(items.every((item) => item.status === "unknown")).toBe(true);
    expect(paywallChecklistSummary(items).done).toBe(0);
  });
});
