// Parser lejka: kontrakt SQL <-> TS (S3, §4.2/§5.2).
//
// Trzy własności, których złamanie nie daje błędu kompilacji, tylko złe
// liczby na zakładce Lejek:
//   1. `null` z bazy zostaje `null` (brak mianownika, editor bez kwot),
//      a 0 zostaje 0 (wynik);
//   2. zły kształt RZUCA (rozjazd kontraktu ma być głośny, nie zerowy);
//   3. `FUNNEL_KEYS` (`// rpc-shape`) = klucze, które naprawdę buduje
//      migracja, a kontrakt S6 (`REVENUE_FUNNEL_KEYS`) jest ich podzbiorem -
//      inaczej wpięcie migawki (Z-S6-16) dałoby ciche „brak danych".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REVENUE_FUNNEL_KEYS } from "@/lib/analytics/semantic/revenueRaw";
import {
  FUNNEL_KEYS,
  RevenueFunnelShapeError,
  parseRevenueFunnel,
} from "@/lib/revenue/funnel/parse";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20261020120400_revenue_funnel_access.sql"),
  "utf8",
);

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    since: "2026-09-01T00:00:00+02:00",
    until: "2026-10-01T00:00:00+02:00",
    segment: "all",
    track: "all",
    amounts_visible: true,
    accounts: 3,
    active_accounts: 4,
    paywall_hit_accounts: 2,
    paywall_hit_visitors: 1,
    paywall_hits: 6,
    paywall_converted_accounts: 1,
    checkout_started: 4,
    checkout_paid: 1,
    checkout_abandoned: 3,
    checkout_expired: 1,
    first_payments: 1,
    registered_paid: 1,
    signup_form_views: 0,
    signup_form_submits: 0,
    visitors_first_party: "12",
    registered_to_paid_rate: 0.333333,
    paywall_conversion_rate: 0.5,
    paywall_hit_rate: "0.5",
    checkout_conversion_rate: 0.25,
    checkout_abandonment_rate: 0.75,
    coupon_redemption_rate: null,
    paid_amount: [{ currency: "PLN", amount_minor: 4900 }],
    signup_sources: [
      { source: "popup", accounts: 2 },
      { source: "paywall", accounts: 1 },
    ],
    paywall_reasons: [{ reason: "paid", accounts: 1, visitors: 0, hits: 3 }],
    paywall_data_since: "2026-09-20T10:00:00+00:00",
    sales: {
      stages: [
        { stage: "lead", leads: 1 },
        { stage: "customer", leads: 1 },
      ],
      open_tasks: 2,
      overdue_tasks: 1,
      done_tasks: 1,
    },
    ...overrides,
  };
}

describe("parseRevenueFunnel - poprawny kształt", () => {
  it("mapuje pola snake_case na DTO camelCase (liczby z napisów bigint też)", () => {
    const dto = parseRevenueFunnel(raw());
    expect(dto.track).toBe("all");
    expect(dto.amountsVisible).toBe(true);
    expect(dto.selfServe).toMatchObject({
      accounts: 3,
      activeAccounts: 4,
      paywallHitAccounts: 2,
      checkoutStarted: 4,
      checkoutPaid: 1,
      checkoutAbandoned: 3,
      visitorsFirstParty: 12,
      paidAmount: [{ currency: "PLN", amountMinor: 4900 }],
      paywallDataSince: "2026-09-20T10:00:00+00:00",
    });
    expect(dto.selfServe?.rates).toEqual({
      registeredToPaid: 0.333333,
      paywallConversion: 0.5,
      paywallHit: 0.5,
      checkoutConversion: 0.25,
      checkoutAbandonment: 0.75,
      couponRedemption: null,
    });
    expect(dto.sales).toEqual({
      stages: [
        { stage: "lead", leads: 1 },
        { stage: "customer", leads: 1 },
      ],
      openTasks: 2,
      overdueTasks: 1,
      doneTasks: 1,
    });
  });

  it("null zostaje null, a zero zostaje zerem - to dwie różne wiadomości", () => {
    const dto = parseRevenueFunnel(
      raw({ checkout_started: 0, checkout_paid: 0, checkout_conversion_rate: null }),
    );
    expect(dto.selfServe?.checkoutStarted).toBe(0);
    expect(dto.selfServe?.rates.checkoutConversion).toBeNull();
  });

  it("editor: paid_amount = null i amounts_visible = false -> brak kwot (nie zero)", () => {
    const dto = parseRevenueFunnel(raw({ amounts_visible: false, paid_amount: null }));
    expect(dto.amountsVisible).toBe(false);
    expect(dto.selfServe?.paidAmount).toBeNull();
  });

  it("kwoty przy amounts_visible = false nie przeciekają, nawet gdy przyszły", () => {
    const dto = parseRevenueFunnel(raw({ amounts_visible: false }));
    expect(dto.selfServe?.paidAmount).toBeNull();
  });

  it("tor sales: bez sekcji samoobsługi, z etapami CRM", () => {
    const only = {
      since: "2026-09-01T00:00:00Z",
      until: "2026-10-01T00:00:00Z",
      segment: "all",
      track: "sales",
      amounts_visible: true,
      sales: raw().sales,
    };
    const dto = parseRevenueFunnel(only);
    expect(dto.selfServe).toBeNull();
    expect(dto.sales?.openTasks).toBe(2);
  });

  it("tor self_serve: sales = null", () => {
    const dto = parseRevenueFunnel(raw({ track: "self_serve", sales: null }));
    expect(dto.sales).toBeNull();
    expect(dto.selfServe?.accounts).toBe(3);
  });
});

describe("parseRevenueFunnel - zły kształt rzuca", () => {
  it.each([
    ["brak liczby", { accounts: undefined }],
    ["liczba ujemna", { checkout_paid: -1 }],
    ["ułamek w procentach", { checkout_conversion_rate: 25 }],
    ["nieznane źródło", { signup_sources: [{ source: "hacker", accounts: 1 }] }],
    ["nieznany powód", { paywall_reasons: [{ reason: "x", accounts: 1, visitors: 0, hits: 1 }] }],
    ["zły tor", { track: "partner" }],
    ["zdeformowane kwoty admina", { paid_amount: [{ currency: "zł", amount_minor: 1 }] }],
    ["tor self_serve z danymi sprzedaży", { track: "self_serve" }],
  ])("%s", (_name, override) => {
    const input = raw(override);
    if ("accounts" in override && override.accounts === undefined) delete input.accounts;
    expect(() => parseRevenueFunnel(input)).toThrow(RevenueFunnelShapeError);
  });

  it("nie-obiekt", () => {
    expect(() => parseRevenueFunnel(null)).toThrow(/admin_revenue_funnel/);
  });
});

describe("FUNNEL_KEYS = klucze migracji (rpc-shape)", () => {
  it("komentarz rpc-shape przy stałej", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/revenue/funnel/parse.ts"), "utf8");
    expect(source).toMatch(/\/\/ rpc-shape: admin_revenue_funnel\nexport const FUNNEL_KEYS/);
  });

  it("każdy klucz kontraktu buduje migracja (literał 'klucz' w jsonb_build_object)", () => {
    const all = [
      ...FUNNEL_KEYS.root,
      ...FUNNEL_KEYS.counts,
      ...FUNNEL_KEYS.fractions,
      ...FUNNEL_KEYS.lists,
      ...FUNNEL_KEYS.sales,
    ];
    const missing = all.filter((key) => !MIGRATION.includes(`'${key}'`));
    expect(missing).toEqual([]);
  });

  it("lista kluczy w komentarzu rpc-shape migracji = liczności + ułamki + listy", () => {
    const block = /-- rpc-shape: admin_revenue_funnel \(klucze płaskie: ([\s\S]*?)\)\n/.exec(
      MIGRATION,
    );
    expect(block).not.toBeNull();
    const listed = block![1]
      .replace(/--/g, " ")
      .split(/[\s,]+/)
      .filter(Boolean)
      .sort();
    expect(listed).toEqual(
      [...FUNNEL_KEYS.counts, ...FUNNEL_KEYS.fractions, ...FUNNEL_KEYS.lists].sort(),
    );
  });

  it("kontrakt migawki S6 (REVENUE_FUNNEL_KEYS) jest podzbiorem kluczy lejka - wpięcie Z-S6-16", () => {
    const ours = new Set<string>([...FUNNEL_KEYS.counts, ...FUNNEL_KEYS.fractions]);
    const s6 = [
      ...REVENUE_FUNNEL_KEYS.counts,
      ...REVENUE_FUNNEL_KEYS.fractions,
      ...REVENUE_FUNNEL_KEYS.separate,
    ];
    expect(s6.filter((key) => !ours.has(key))).toEqual([]);
  });
});
