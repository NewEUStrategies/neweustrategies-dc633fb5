// Rejestr reguł diagnostyki (S7, SPEC §5.7): zamknięta lista 54 + 1 reguł,
// zgodność plików `checks/*` z listą, odnośniki napraw i modułów na trasy,
// które ISTNIEJĄ (z parametrami z kontraktu deep linków §2.6), lista
// niewyciszalnych, wyciszenia i kolejność listy.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { REVENUE_AREAS, REVENUE_SEVERITIES } from "@/lib/admin/revenue/hubTabs";
import { parseBillingSearch } from "@/lib/admin/billingTabs";
import { parsePaywallSearch } from "@/lib/admin/paywallTabs";
import { parsePricingSearch } from "@/lib/admin/pricingTabs";
import { isRevenueTab, parseRevenueHubSearch } from "@/lib/revenue/search";
import { EMPTY_REVENUE_FACTS, factHashOf, type RevenueFacts } from "../facts";
import {
  CHECK_KNOWLEDGE,
  REVENUE_CHECK_IDS,
  REVENUE_CHECKS,
  REVENUE_FIX_DIALOG_IDS,
  SPEC_CHECK_COUNT,
  UNSNOOZABLE_CHECK_IDS,
  compareFindings,
  evaluateRegistry,
  isOpenFinding,
  isRevenueCheckId,
  isRevenueFixDialogId,
  revenueCheck,
  snoozeApplies,
  type RevenueFinding,
  type RevenueSnooze,
} from "../registry";

const ROUTE_PATHS: ReadonlySet<string> = new Set(
  [...readFileSync("src/routeTree.gen.ts", "utf8").matchAll(/fullPath: '([^']+)'/g)].map((m) =>
    m[1] === "/" ? "/" : m[1].replace(/\/$/, ""),
  ),
);

/** Adres konkretny → trasa drzewa (dosłownie albo `$tab` huba z poprawną zakładką). */
function resolvesToRoute(path: string): boolean {
  if (ROUTE_PATHS.has(path)) return true;
  const match = /^\/admin\/revenue\/([a-z_]+)$/.exec(path);
  return match !== null && isRevenueTab(match[1]) && match[1] !== "overview";
}

/** Walidatory adresów modułów - parametr musi przejść BEZ utraty wartości. */
const MODULE_SEARCH: Readonly<Record<string, (raw: Record<string, unknown>) => object>> = {
  "/admin/paywall": parsePaywallSearch,
  "/admin/pricing": parsePricingSearch,
  "/admin/billing": parseBillingSearch,
  // Walidatory w plikach tras (chunk wejściowy) - wartości przepisane z nich.
  "/admin/workflows": (raw) => (raw.tab === "definitions" ? { tab: "definitions" } : {}),
  "/admin/community/clubs/applications": (raw) =>
    ["pending", "review", "accepted", "rejected", "needs_info"].includes(String(raw.status))
      ? { status: raw.status }
      : {},
};

/** Parametry po walidatorze trasy (`null` = trasa bez znanego walidatora). */
function parsedSearch(to: string, search: Readonly<Record<string, string>>): object | null {
  if (to.startsWith("/admin/revenue")) return parseRevenueHubSearch({ ...search });
  const parse = MODULE_SEARCH[to];
  return parse ? parse({ ...search }) : null;
}

describe("zamknięta lista reguł", () => {
  it("54 reguły SPEC + opcjonalna catalog.team_seats_over_cap, bez duplikatów", () => {
    expect(SPEC_CHECK_COUNT).toBe(54);
    expect(REVENUE_CHECK_IDS).toHaveLength(SPEC_CHECK_COUNT + 1);
    expect(new Set(REVENUE_CHECK_IDS).size).toBe(REVENUE_CHECK_IDS.length);
    expect(REVENUE_CHECK_IDS).toContain("catalog.team_seats_over_cap");
  });

  it("pliki checks/* = lista identyfikatorów (w obie strony)", () => {
    expect(REVENUE_CHECKS.map((c) => c.id).sort()).toEqual([...REVENUE_CHECK_IDS].sort());
  });

  it("obszar reguły = prefiks identyfikatora, waga z unii", () => {
    for (const check of REVENUE_CHECKS) {
      expect(check.id.startsWith(`${check.area}.`), check.id).toBe(true);
      expect(REVENUE_AREAS).toContain(check.area);
      expect(REVENUE_SEVERITIES).toContain(check.severity);
      expect(revenueCheck(check.id)).toBe(check);
    }
  });

  it("każdy z 16 obszarów ma co najmniej jedną regułę", () => {
    for (const area of REVENUE_AREAS) {
      expect(
        REVENUE_CHECKS.some((c) => c.area === area),
        area,
      ).toBe(true);
    }
  });

  it("strażnicy typów", () => {
    expect(isRevenueCheckId("crm.qualified_without_owner")).toBe(true);
    expect(isRevenueCheckId("crm.unknown")).toBe(false);
    expect(isRevenueCheckId(42)).toBe(false);
    expect(isRevenueFixDialogId("plan_tier")).toBe(true);
    expect(isRevenueFixDialogId("catalog.plan_without_tier")).toBe(false);
  });
});

describe("naprawy i odnośniki modułów", () => {
  it.each(REVENUE_CHECKS.map((c) => [c.id, c] as const))(
    "%s: odnośniki prowadzą na istniejące trasy",
    (_id, check) => {
      expect(resolvesToRoute(check.owner.to), `owner ${check.owner.to}`).toBe(true);
      if (check.owner.search) {
        expect(parsedSearch(check.owner.to, check.owner.search), check.owner.to).toEqual(
          check.owner.search,
        );
      }
      if (check.fix?.kind === "link") {
        expect(resolvesToRoute(check.fix.to), `fix ${check.fix.to}`).toBe(true);
        if (check.fix.search) {
          expect(parsedSearch(check.fix.to, check.fix.search), check.fix.to).toEqual(
            check.fix.search,
          );
        }
      }
      if (check.fix?.kind === "code") expect(check.fix.issueRef).toBe(check.id);
    },
  );

  it("każdy dialog naprawy ma co najmniej jedną regułę, a reguła wskazuje dialog z listy", () => {
    const used = new Set<string>();
    for (const check of REVENUE_CHECKS) {
      if (check.fix?.kind === "dialog") {
        expect(isRevenueFixDialogId(check.fix.dialog), check.id).toBe(true);
        used.add(check.fix.dialog);
      }
    }
    expect([...used].sort()).toEqual([...REVENUE_FIX_DIALOG_IDS].sort());
  });

  it("wiedza Insidera dotyczy wyłącznie istniejących reguł i niesie same identyfikatory", () => {
    for (const [id, knowledge] of Object.entries(CHECK_KNOWLEDGE)) {
      expect(isRevenueCheckId(id), id).toBe(true);
      for (const ref of [...(knowledge?.scenarios ?? []), ...(knowledge?.frameworks ?? [])]) {
        expect(ref).toMatch(/^[a-z0-9_-]+$/);
      }
    }
  });
});

describe("niewyciszalne", () => {
  it("krytyczne reguły sync i data_quality - dokładnie emit_errors i ledger_drift", () => {
    expect([...UNSNOOZABLE_CHECK_IDS].sort()).toEqual([
      "data_quality.ledger_drift",
      "sync.emit_errors",
    ]);
    for (const check of REVENUE_CHECKS) {
      expect(check.snoozable, check.id).toBe(!UNSNOOZABLE_CHECK_IDS.includes(check.id));
    }
  });
});

const NOW_MS = Date.parse("2026-10-20T12:00:00.000Z");

function snooze(overrides: Partial<RevenueSnooze> = {}): RevenueSnooze {
  return {
    id: "s1",
    checkId: "crm.auto_tasks_without_assignee",
    scopeKey: "*",
    kind: "days",
    until: new Date(NOW_MS + 86_400_000).toISOString(),
    reason: null,
    scopeHash: null,
    createdAt: null,
    ...overrides,
  };
}

const CRM_OPEN: RevenueFacts = {
  v: 1,
  computedAt: "2026-10-20T12:00:00.000Z",
  areas: { crm: { autoTasksUnassigned: { open: 3, overdue: 1 } } },
};

function crmFinding(facts: RevenueFacts, snoozes: RevenueSnooze[] = []): RevenueFinding {
  return evaluateRegistry(facts, snoozes, NOW_MS).find(
    (f) => f.checkId === "crm.auto_tasks_without_assignee",
  )!;
}

describe("evaluateRegistry i wyciszenia", () => {
  it("pusty zestaw faktów: każda reguła `unknown`, żadna otwarta", () => {
    const findings = evaluateRegistry(EMPTY_REVENUE_FACTS, [], NOW_MS);
    expect(findings).toHaveLength(REVENUE_CHECK_IDS.length);
    expect(findings.every((f) => f.state === "unknown")).toBe(true);
    expect(findings.filter(isOpenFinding)).toEqual([]);
  });

  it("diagnoza niesie odcisk faktów, wpływ i właściciela", () => {
    const finding = crmFinding(CRM_OPEN);
    expect(finding).toMatchObject({ state: "error", count: 3, impact: "high", snooze: null });
    expect(finding.factHash).toBe(factHashOf({ state: "error", count: 3, refs: [] }));
    expect(finding.owner.to).toBe("/admin/crm");
    expect(isOpenFinding(finding)).toBe(true);
  });

  it("wyciszenie na czas obowiązuje do terminu", () => {
    expect(crmFinding(CRM_OPEN, [snooze()]).snooze?.id).toBe("s1");
    const expired = snooze({ until: new Date(NOW_MS - 1).toISOString() });
    expect(crmFinding(CRM_OPEN, [expired]).snooze).toBeNull();
  });

  it("wyciszenie „świadomie” obowiązuje tylko przy tym samym odcisku faktów", () => {
    const hash = factHashOf({ state: "error", count: 3, refs: [] });
    const intentional = snooze({
      kind: "intentional",
      until: null,
      scopeHash: hash,
      reason: "B2B",
    });
    expect(crmFinding(CRM_OPEN, [intentional]).snooze?.id).toBe("s1");
    const changed: RevenueFacts = {
      ...CRM_OPEN,
      areas: { crm: { autoTasksUnassigned: { open: 4, overdue: 1 } } },
    };
    const finding = crmFinding(changed, [intentional]);
    expect(finding.snooze).toBeNull();
    expect(isOpenFinding(finding)).toBe(true);
  });

  it("wyciszenie innego zakresu albo innej reguły nie działa", () => {
    expect(crmFinding(CRM_OPEN, [snooze({ scopeKey: "lead:1" })]).snooze).toBeNull();
    expect(
      crmFinding(CRM_OPEN, [snooze({ checkId: "crm.qualified_without_owner" })]).snooze,
    ).toBeNull();
  });

  it("reguła niewyciszalna ignoruje każde wyciszenie", () => {
    expect(snoozeApplies(snooze(), { factHash: "f1:0", snoozable: false }, NOW_MS)).toBe(false);
    const facts: RevenueFacts = {
      ...CRM_OPEN,
      areas: { sync: { emitErrors24h: 2, emitErrors7d: 2 } },
    };
    const finding = evaluateRegistry(facts, [snooze({ checkId: "sync.emit_errors" })], NOW_MS).find(
      (f) => f.checkId === "sync.emit_errors",
    );
    expect(finding?.snooze).toBeNull();
    expect(finding?.state).toBe("error");
  });

  it("factHash nie zależy od kolejności refs, zależy od stanu i liczby", () => {
    expect(factHashOf({ state: "warn", count: 2, refs: ["b", "a"] })).toBe(
      factHashOf({ state: "warn", count: 2, refs: ["a", "b"] }),
    );
    expect(factHashOf({ state: "warn", count: 2 })).not.toBe(
      factHashOf({ state: "error", count: 2 }),
    );
    expect(factHashOf({ state: "warn", count: 2 })).toMatch(/^f1:[0-9a-f]{8}$/);
  });
});

describe("compareFindings - kolejność listy", () => {
  it("waga, potem skutek trwający przed uśpionym, potem liczba", () => {
    const facts: RevenueFacts = {
      v: 1,
      computedAt: "2026-10-20T12:00:00.000Z",
      areas: {
        crm: {
          autoTasksUnassigned: { open: 2, overdue: 0 },
          qualifiedWithoutOwner: { mqlSql: 0, opportunity: 1, refs: [] },
        },
        sync: { emitErrors24h: 0, emitErrors7d: 1 },
        newsletter: { defaultSender: true, campaignsSent30d: 4 },
      },
    };
    const open = evaluateRegistry(facts, [], NOW_MS).filter(isOpenFinding).sort(compareFindings);
    expect(open.map((f) => f.checkId)).toEqual([
      "newsletter.default_sender",
      "sync.emit_errors",
      "crm.auto_tasks_without_assignee",
      "crm.qualified_without_owner",
    ]);
  });
});
