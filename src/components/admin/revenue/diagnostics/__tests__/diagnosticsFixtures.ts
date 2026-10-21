// Fikstury testów Diagnostyki (S7.1-ui): fakty `RevenueFacts v1` z czterema
// otwartymi problemami różnych rodzajów naprawy i ich wersja „po naprawie".
//
//   * `catalog.enquiry_plan_buyable` - ważna, dialog `plan_not_for_sale`,
//     odwracalna (plan „na zapytanie" w sprzedaży);
//   * `metering.settings_row_missing` - krytyczna, dialog `metering_defaults`;
//   * `checkout.abandon_window_default` - informacja, dialog z treścią liczbową;
//   * `sync.emit_errors` - krytyczna, NIEWYCISZALNA, naprawa w kodzie.
//
// `as const` + `clone()`: fikstura niezmienna, test dostaje głęboką kopię
// (JSON), a `clone` zwraca `unknown` - rzutowanie jest jawne w miejscu
// użycia. Bez JSX i bez komponentów: moduł bywa czytany z fabryk `vi.mock`.
import type { RevenueFacts } from "@/lib/revenue/diagnostics/facts";
import type { RevenueFinding, RevenueSnooze } from "@/lib/revenue/diagnostics/registry";

export const TENANT = "11111111-1111-4111-8111-111111111111";
export const ENQUIRY_PLAN_ID = "e7150000-0000-4000-8000-000000000001";

const ENQUIRY_PLAN = {
  id: ENQUIRY_PLAN_ID,
  tierKey: "decision_lab",
  tierFound: true,
  tierRank: 3,
  active: true,
  forSale: true,
  interval: "year",
  currency: "PLN",
  priceCents: 990_000,
  catalogPair: true,
} as const;

export const FACTS = {
  v: 1,
  computedAt: "2026-10-15T10:00:00.000Z",
  areas: {
    catalog: { plans: [ENQUIRY_PLAN] },
    metering: { settingsRow: false, meteredRules: 4 },
    checkout: { settingsRow: true, abandonAfterMinutes: 1440, abandonedJourneyActive: false },
    sync: { emitErrors24h: 2, emitErrors7d: 2 },
  },
} as const satisfies RevenueFacts;

/** Ten sam stan po wycofaniu planu ze sprzedaży - reguła enquiry jest „ok". */
export const FACTS_FIXED = {
  ...FACTS,
  computedAt: "2026-10-15T10:05:00.000Z",
  areas: { ...FACTS.areas, catalog: { plans: [{ ...ENQUIRY_PLAN, forSale: false }] } },
} as const satisfies RevenueFacts;

/** Głęboka kopia fikstury - `unknown`, rzutowanie w teście. */
export function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

export function factsRead(facts: RevenueFacts = FACTS): unknown {
  return { state: "ready", facts: clone(facts) };
}

export function snoozesRead(snoozes: readonly RevenueSnooze[] = []): unknown {
  return { state: "ready", snoozes: clone(snoozes) };
}

/** Wyciszenie „na czas" reguły - termin daleko w przyszłości (stały w testach). */
export function daysSnooze(checkId: string): RevenueSnooze {
  return {
    id: `snooze-${checkId}`,
    checkId,
    scopeKey: "*",
    kind: "days",
    until: "2099-01-01T00:00:00.000Z",
    reason: null,
    scopeHash: null,
    createdAt: "2026-10-10T00:00:00.000Z",
  };
}

/** Diagnoza zbudowana wprost (karta bez rejestru) - pola domyślne z otwartego problemu. */
export function finding(overrides: Partial<RevenueFinding> = {}): RevenueFinding {
  return {
    checkId: "catalog.enquiry_plan_buyable",
    area: "catalog",
    severity: "warning",
    state: "error",
    count: 1,
    refs: [ENQUIRY_PLAN_ID],
    evidence: [{ key: "enquiryPlanBuyable", params: { count: 1, active: 1 } }],
    impact: "medium",
    factHash: "hash-1",
    fix: { kind: "dialog", dialog: "plan_not_for_sale" },
    owner: { to: "/admin/paywall", search: { tab: "plans" } },
    snoozable: true,
    snooze: null,
    ...overrides,
  };
}
