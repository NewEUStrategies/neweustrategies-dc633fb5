// Grupowanie, filtry i kondycja diagnoz (S7, SPEC §2.2 „Diagnostyka", §6.1).
//
// Jedna ocena dla listy, karty „Wymaga uwagi" i chipu: stan filtra
// (otwarte / wyciszone / w porządku / nie wiadomo), kolejność od
// najpoważniejszej, kondycja obszaru z OTWARTYCH diagnoz (wyciszone nie
// obniżają wyniku), a obszar bez ani jednej ocenionej reguły to „brak
// danych" (`null`), nigdy 100.
import { describe, expect, it } from "vitest";

import {
  areaHealth,
  areaHealthList,
  DEFAULT_DIAGNOSTIC_FILTERS,
  DIAGNOSTIC_STATE_FILTERS,
  filterFindings,
  groupFindingsByArea,
  isRevenueArea,
  isRevenueSeverity,
  matchesFilters,
  stateCounts,
  stateOf,
  topAttention,
} from "@/lib/admin/revenue/diagnosticGroups";
import { areaHealthScore, REVENUE_AREAS } from "@/lib/admin/revenue/hubTabs";
import type { RevenueFinding, RevenueSnooze } from "@/lib/revenue/diagnostics/registry";

const SNOOZE: RevenueSnooze = {
  id: "s1",
  checkId: "crm.auto_tasks_without_assignee",
  scopeKey: "*",
  kind: "days",
  until: "2099-01-01T00:00:00.000Z",
  reason: null,
  scopeHash: null,
  createdAt: null,
};

function finding(
  overrides: Partial<RevenueFinding> & Pick<RevenueFinding, "checkId">,
): RevenueFinding {
  const area = overrides.checkId.split(".")[0] as RevenueFinding["area"];
  return {
    area,
    severity: "warning",
    state: "warn",
    count: 1,
    refs: [],
    evidence: [],
    impact: "low",
    factHash: "f1:00000000",
    fix: null,
    owner: { to: "/admin/revenue" },
    snoozable: true,
    snooze: null,
    ...overrides,
  };
}

const CRIT_ERROR = finding({
  checkId: "metering.settings_row_missing",
  severity: "critical",
  state: "error",
  impact: "high",
});
const CRIT_WARN = finding({
  checkId: "metering.rank_bypass",
  severity: "critical",
  state: "warn",
  impact: "medium",
});
const WARN_OPEN = finding({
  checkId: "crm.qualified_without_owner",
  severity: "warning",
  state: "error",
  count: 7,
});
const WARN_SNOOZED = finding({
  checkId: "crm.auto_tasks_without_assignee",
  severity: "warning",
  state: "error",
  snooze: SNOOZE,
});
const INFO_OPEN = finding({
  checkId: "crm.leads_without_user_id",
  severity: "info",
  state: "warn",
});
const OK_ONE = finding({ checkId: "catalog.plan_without_tier", severity: "critical", state: "ok" });
const UNKNOWN_ONE = finding({
  checkId: "sync.emit_errors",
  severity: "critical",
  state: "unknown",
  snoozable: false,
});

const ALL = [OK_ONE, INFO_OPEN, WARN_SNOOZED, UNKNOWN_ONE, WARN_OPEN, CRIT_WARN, CRIT_ERROR];

describe("strażnicy adresu (?area=, waga)", () => {
  it("obszar i waga tylko z zamkniętych list huba", () => {
    expect(isRevenueArea("data_quality")).toBe(true);
    expect(isRevenueArea("billing")).toBe(false);
    expect(isRevenueArea(undefined)).toBe(false);
    expect(isRevenueSeverity("critical")).toBe(true);
    expect(isRevenueSeverity("crit")).toBe(false);
  });

  it("filtr domyślny = otwarte ze wszystkich obszarów i wag", () => {
    expect(DEFAULT_DIAGNOSTIC_FILTERS).toEqual({ area: null, severity: null, state: "open" });
    expect(DIAGNOSTIC_STATE_FILTERS).toEqual(["open", "snoozed", "ok", "unknown", "all"]);
  });
});

describe("stan diagnozy w języku filtra", () => {
  it("problem bez wyciszenia = otwarte, z wyciszeniem = wyciszone; ok i unknown wprost", () => {
    expect(stateOf(CRIT_ERROR)).toBe("open");
    expect(stateOf(INFO_OPEN)).toBe("open");
    expect(stateOf(WARN_SNOOZED)).toBe("snoozed");
    expect(stateOf(OK_ONE)).toBe("ok");
    expect(stateOf(UNKNOWN_ONE)).toBe("unknown");
  });

  it("filtry obszaru, wagi i stanu składają się koniunkcją; `all` przepuszcza każdy stan", () => {
    const crmWarnings = { area: "crm", severity: "warning", state: "all" } as const;
    expect(matchesFilters(WARN_OPEN, crmWarnings)).toBe(true);
    expect(matchesFilters(WARN_SNOOZED, crmWarnings)).toBe(true);
    expect(matchesFilters(INFO_OPEN, crmWarnings)).toBe(false);
    expect(matchesFilters(CRIT_ERROR, crmWarnings)).toBe(false);
    expect(matchesFilters(WARN_SNOOZED, { ...crmWarnings, state: "open" })).toBe(false);
  });

  it("liczniki stanów sumują się do wszystkich", () => {
    expect(stateCounts(ALL)).toEqual({ open: 4, snoozed: 1, ok: 1, unknown: 1, all: 7 });
  });
});

describe("kolejność listy", () => {
  it("otwarte od najpoważniejszej: waga, skutek trwający przed uśpionym, wpływ, liczba", () => {
    expect(filterFindings(ALL, DEFAULT_DIAGNOSTIC_FILTERS).map((f) => f.checkId)).toEqual([
      "metering.settings_row_missing",
      "metering.rank_bypass",
      "crm.qualified_without_owner",
      "crm.leads_without_user_id",
    ]);
  });

  it("„Wymaga uwagi”: trzy najpoważniejsze otwarte, bez wyciszonych; limit 0 = pusto", () => {
    expect(topAttention(ALL).map((f) => f.checkId)).toEqual([
      "metering.settings_row_missing",
      "metering.rank_bypass",
      "crm.qualified_without_owner",
    ]);
    expect(topAttention(ALL, 1)).toHaveLength(1);
    expect(topAttention(ALL, 0)).toEqual([]);
    expect(topAttention([OK_ONE, WARN_SNOOZED, UNKNOWN_ONE])).toEqual([]);
  });
});

describe("kondycja obszarów (areaHealthScore S6)", () => {
  it("wynik z otwartych diagnoz; wyciszona nie obniża kondycji", () => {
    const crm = areaHealth(ALL, "crm");
    expect(crm.counts).toEqual({ critical: 0, warning: 1, info: 1 });
    expect(crm.score).toBe(areaHealthScore({ critical: 0, warning: 1 }));
    const metering = areaHealth(ALL, "metering");
    expect(metering.score).toBe(areaHealthScore({ critical: 2, warning: 0 }));
  });

  it("obszar, którego żadnej reguły nie da się ocenić = `null` (brak danych), nie 100", () => {
    expect(areaHealth(ALL, "sync").score).toBeNull();
    expect(areaHealth(ALL, "events").score).toBeNull();
    expect(areaHealth(ALL, "catalog").score).toBe(100);
  });

  it("lista kondycji w kolejności REVENUE_AREAS (16 obszarów)", () => {
    expect(areaHealthList(ALL).map((h) => h.area)).toEqual([...REVENUE_AREAS]);
  });
});

describe("grupy listy po obszarze", () => {
  it("puste grupy pominięte; kondycja liczona ze WSZYSTKICH diagnoz obszaru, nie z filtra", () => {
    const groups = groupFindingsByArea(ALL, { area: null, severity: "warning", state: "open" });
    expect(groups.map((g) => g.area)).toEqual(["crm"]);
    expect(groups[0]!.findings.map((f) => f.checkId)).toEqual(["crm.qualified_without_owner"]);
    expect(groups[0]!.health.counts).toEqual({ critical: 0, warning: 1, info: 1 });
  });

  it("grupy w kolejności obszarów huba", () => {
    const groups = groupFindingsByArea(ALL, { area: null, severity: null, state: "all" });
    const order = groups.map((g) => REVENUE_AREAS.indexOf(g.area));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
