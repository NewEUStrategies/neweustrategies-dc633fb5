// Parsery agregatów finansowych (S2): kontrakt kształtu i semantyka null ≠ 0.
//
// Czego pilnuje:
//   1. `*_KEYS` (`// rpc-shape`) = listy `set_eq` z pgTAP (etykieta asercji
//      nazywa stałą) i = klucze, które migracja naprawdę buduje;
//   2. przykład pełnej odpowiedzi parsuje się pole po polu (snake -> camel),
//      `null` zostaje `null`, zmierzone zero zostaje zerem;
//   3. zły kształt rzuca `RevenueFinanceShapeError` ze ścieżką pola;
//   4. most MRR: rozjazd > 0,5 % jest oznaczany (`reconciled: false`).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REVENUE_SNAPSHOT_KEYS } from "@/lib/analytics/semantic/revenueRaw";
import {
  CHURN_KEYS,
  COHORTS_KEYS,
  DUNNING_KEYS,
  ECONOMICS_KEYS,
  MRR_BRIDGE_KEYS,
  MRR_SERIES_KEYS,
  OFFER_MATRIX_KEYS,
  REALIZED_KEYS,
  RETENTION_OFFERS_KEYS,
  REVENUE_INPUTS_KEYS,
  REVENUE_INPUT_SAVE_KEYS,
  RevenueFinanceShapeError,
  parseChurn,
  parseCohorts,
  parseDunning,
  parseEconomics,
  parseMrrBridge,
  parseMrrSeries,
  parseOfferMatrix,
  parseRealized,
  parseRetentionOffers,
  parseRevenueInputSave,
  parseRevenueInputs,
} from "@/lib/revenue/finance/parse";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const MIGRATIONS = readdirSync(join(ROOT, "supabase/migrations"))
  .filter((f) => /^2026102011\d{4}_.+\.sql$/.test(f))
  .map((f) => read(`supabase/migrations/${f}`))
  .join("\n");

const PGTAP = ["revenue_aggregates", "retention_flow", "revenue_offer_inputs_economics"]
  .map((n) => read(`supabase/tests/${n}_test.sql`))
  .join("\n");

const KEYS: Record<string, Record<string, readonly string[]>> = {
  MRR_BRIDGE_KEYS,
  MRR_SERIES_KEYS,
  CHURN_KEYS,
  COHORTS_KEYS,
  DUNNING_KEYS,
  REALIZED_KEYS,
  RETENTION_OFFERS_KEYS,
  OFFER_MATRIX_KEYS,
  REVENUE_INPUTS_KEYS,
  REVENUE_INPUT_SAVE_KEYS,
  ECONOMICS_KEYS,
};

/** Asercje `set_eq(..., ARRAY[...], '... (NAZWA_KEYS.grupa)')` z plików pgTAP. */
function pgtapShapes(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /ARRAY\[([^\]]*)\],?\s*'[^']*?\b([A-Z_]+_KEYS)\.(\w+)\)?'/g;
  for (const m of PGTAP.matchAll(re)) {
    const keys = [...m[1].matchAll(/'([a-z_0-9]+)'/g)].map((k) => k[1]);
    out.set(`${m[2]}.${m[3]}`, keys);
  }
  return out;
}

describe("kontrakt kształtu: *_KEYS = pgTAP = migracja", () => {
  const shapes = pgtapShapes();

  it("pgTAP sprawdza kształt każdej funkcji panelu przynajmniej na poziomie korzenia", () => {
    for (const name of [
      "MRR_BRIDGE_KEYS.root",
      "MRR_BRIDGE_KEYS.currency",
      "MRR_SERIES_KEYS.point",
      "CHURN_KEYS.root",
      "CHURN_KEYS.currency",
      "COHORTS_KEYS.root",
      "DUNNING_KEYS.root",
      "REALIZED_KEYS.root",
      "RETENTION_OFFERS_KEYS.root",
      "OFFER_MATRIX_KEYS.root",
      "OFFER_MATRIX_KEYS.plan",
      "ECONOMICS_KEYS.root",
    ]) {
      expect(shapes.has(name), name).toBe(true);
    }
  });

  it.each([...pgtapShapes()].map(([name, keys]) => [name, keys] as const))(
    "%s: lista pgTAP = stała",
    (name, keys) => {
      const [constant, group] = name.split(".");
      const expected = KEYS[constant]?.[group];
      expect(expected, `brak stałej ${name}`).toBeDefined();
      expect([...keys].sort()).toEqual([...expected!].sort());
    },
  );

  it.each(
    Object.entries(KEYS).flatMap(([constant, groups]) =>
      Object.values(groups)
        .flat()
        .map((key) => [constant, key] as const),
    ),
  )("%s: migracja buduje klucz %s", (_constant, key) => {
    expect(MIGRATIONS).toContain(`'${key}', `);
  });

  it("komentarz rpc-shape stoi przy każdej stałej", () => {
    const source = read("src/lib/revenue/finance/parse.ts");
    for (const [constant, rpc] of [
      ["MRR_BRIDGE_KEYS", "admin_revenue_mrr_bridge"],
      ["MRR_SERIES_KEYS", "admin_revenue_mrr_series"],
      ["CHURN_KEYS", "admin_revenue_churn"],
      ["COHORTS_KEYS", "admin_revenue_cohorts"],
      ["DUNNING_KEYS", "admin_revenue_dunning"],
      ["REALIZED_KEYS", "admin_revenue_realized"],
      ["RETENTION_OFFERS_KEYS", "admin_revenue_retention_offers"],
      ["OFFER_MATRIX_KEYS", "admin_revenue_offer_matrix"],
      ["REVENUE_INPUTS_KEYS", "admin_revenue_inputs"],
      ["REVENUE_INPUT_SAVE_KEYS", "admin_revenue_input_upsert"],
      ["ECONOMICS_KEYS", "admin_revenue_economics"],
    ]) {
      expect(source).toContain(`// rpc-shape: ${rpc}\nexport const ${constant}`);
    }
  });

  it("migawka S2 = REVENUE_SNAPSHOT_KEYS (S6) - pgTAP sprawdza tę samą listę", () => {
    const m = /ARRAY\[([^\]]*)\],\s*'kształt: migawka = REVENUE_SNAPSHOT_KEYS/.exec(PGTAP);
    expect(m).not.toBeNull();
    const pgtap = [...m![1].matchAll(/'([a-z_0-9]+)'/g)].map((k) => k[1]).sort();
    const s6 = [
      ...REVENUE_SNAPSHOT_KEYS.meta,
      ...REVENUE_SNAPSHOT_KEYS.money,
      "movements",
      ...REVENUE_SNAPSHOT_KEYS.counts,
      ...REVENUE_SNAPSHOT_KEYS.fractions,
      ...REVENUE_SNAPSHOT_KEYS.nonNegative,
      ...REVENUE_SNAPSHOT_KEYS.signed,
    ].sort();
    expect(pgtap).toEqual(s6);
  });
});

// ── Przykłady odpowiedzi ────────────────────────────────────────────────────

const SINCE = "2026-09-01T00:00:00+00:00";
const UNTIL = "2026-10-01T00:00:00+00:00";

function bridgeRaw(over: Record<string, unknown> = {}) {
  return {
    since: SINCE,
    until: UNTIL,
    segment: "all",
    data_since: "2026-08-15T10:00:00+00:00",
    basis_mix: { provider: 0.75, catalog: 0.25 },
    currencies: [
      {
        currency: "PLN",
        start_minor: 10_000,
        opening_minor: 0,
        new_minor: 5_000,
        expansion_minor: 1_000,
        reactivation_minor: 0,
        contraction_minor: -500,
        churn_minor: -2_000,
        net_new_minor: 3_500,
        end_minor: 13_500,
        active_subscriptions: 4,
        active_customers: 3,
      },
    ],
    active_subscriptions: 4,
    active_customers: 3,
    ...over,
  };
}

describe("parseMrrBridge", () => {
  it("snake -> camel, most domknięty, podstawa D-05 w wyniku", () => {
    const dto = parseMrrBridge(bridgeRaw());
    expect(dto.basisMix).toEqual({ provider: 0.75, catalog: 0.25 });
    expect(dto.currencies?.[0]).toMatchObject({
      currency: "PLN",
      startMinor: 10_000,
      churnMinor: -2_000,
      endMinor: 13_500,
      netNewMinor: 3_500,
      residualMinor: 0,
      reconciled: true,
    });
  });

  it("null ≠ 0: `currencies: null` (księga nie zna okna) zostaje null, `[]` zostaje []", () => {
    expect(parseMrrBridge(bridgeRaw({ currencies: null, data_since: null })).currencies).toBeNull();
    expect(parseMrrBridge(bridgeRaw({ currencies: [] })).currencies).toEqual([]);
    expect(parseMrrBridge(bridgeRaw({ basis_mix: null })).basisMix).toBeNull();
  });

  it("rozjazd powyżej 0,5 % jest oznaczony, w tolerancji - nie", () => {
    const row = (end: number) =>
      parseMrrBridge(bridgeRaw({ currencies: [{ ...bridgeRaw().currencies[0], end_minor: end }] }))
        .currencies![0];
    expect(row(13_550)).toMatchObject({ residualMinor: 50, reconciled: true });
    expect(row(13_700)).toMatchObject({ residualMinor: 200, reconciled: false });
  });

  it("bigint jako napis cyfr jest przyjmowany, ułamek nie", () => {
    const c = { ...bridgeRaw().currencies[0], end_minor: "13500" };
    expect(parseMrrBridge(bridgeRaw({ currencies: [c] })).currencies![0].endMinor).toBe(13_500);
    const bad = { ...bridgeRaw().currencies[0], end_minor: 1.5 };
    expect(() => parseMrrBridge(bridgeRaw({ currencies: [bad] }))).toThrow(
      RevenueFinanceShapeError,
    );
  });

  it("brak pola i zła waluta rzucają ze ścieżką", () => {
    const { segment: _segment, ...noSegment } = bridgeRaw();
    try {
      parseMrrBridge(noSegment);
      expect.unreachable();
    } catch (error) {
      expect((error as RevenueFinanceShapeError).path).toBe("segment");
      expect((error as RevenueFinanceShapeError).rpc).toBe("admin_revenue_mrr_bridge");
    }
    const c = { ...bridgeRaw().currencies[0], currency: "pln" };
    expect(() => parseMrrBridge(bridgeRaw({ currencies: [c] }))).toThrow(
      /currencies\[0\]\.currency/,
    );
    expect(() => parseMrrBridge(bridgeRaw({ basis_mix: { provider: 75, catalog: 25 } }))).toThrow(
      /basis_mix\.provider/,
    );
  });
});

describe("parseMrrSeries", () => {
  const raw = {
    since: SINCE,
    until: UNTIL,
    grain: "week",
    time_zone: "Europe/Warsaw",
    points: [
      {
        bucket_start: "2026-09-01",
        at: "2026-09-08T00:00:00+02:00",
        currency: "EUR",
        mrr_minor: 9_000,
        active_subscriptions: 2,
        snapshot_mrr_minor: 9_100,
      },
      {
        bucket_start: "2026-09-08",
        at: "2026-09-15T00:00:00+02:00",
        currency: "EUR",
        mrr_minor: 0,
        active_subscriptions: 0,
        snapshot_mrr_minor: null,
      },
    ],
  };

  it("dryf = migawka − księga; bez migawki null (nie 0)", () => {
    const dto = parseMrrSeries(raw);
    expect(dto.points[0]).toMatchObject({ bucketStart: "2026-09-01", driftMinor: 100 });
    expect(dto.points[1]).toMatchObject({ mrrMinor: 0, snapshotMrrMinor: null, driftMinor: null });
  });

  it("ziarno spoza słownika i dzień w złym formacie rzucają", () => {
    expect(() => parseMrrSeries({ ...raw, grain: "year" })).toThrow(/grain/);
    expect(() =>
      parseMrrSeries({ ...raw, points: [{ ...raw.points[0], bucket_start: "2026-09-01T00:00" }] }),
    ).toThrow(/bucket_start/);
  });
});

describe("parseChurn", () => {
  const raw = {
    since: SINCE,
    until: UNTIL,
    customers_start: 10,
    customers_churned: 1,
    logo_churn_rate: 0.1,
    involuntary_share: null,
    currencies: [
      {
        currency: "PLN",
        mrr_start_minor: 100_000,
        churn_minor: -5_000,
        contraction_minor: 0,
        expansion_minor: 2_000,
        reactivation_minor: 0,
        gross_revenue_churn: 0.05,
        gross_revenue_retention: 0.95,
        net_revenue_retention: 1.02,
      },
    ],
    reasons: [
      { reason: "unpaid", movements: 1, amounts: [{ currency: "PLN", amount_minor: -5_000 }] },
    ],
  };

  it("NRR > 1 przyjęty, null zostaje null", () => {
    const dto = parseChurn(raw);
    expect(dto.involuntaryShare).toBeNull();
    expect(dto.currencies[0].netRevenueRetention).toBe(1.02);
    expect(dto.reasons[0]).toEqual({
      reason: "unpaid",
      movements: 1,
      amounts: [{ currency: "PLN", amountMinor: -5_000 }],
    });
  });

  it("udział logo w procentach (10 zamiast 0,1) to błąd jednostki", () => {
    expect(() => parseChurn({ ...raw, logo_churn_rate: 10 })).toThrow(/logo_churn_rate/);
  });

  it("nieznany powód churnu rzuca (słownik = CHECK)", () => {
    expect(() => parseChurn({ ...raw, reasons: [{ ...raw.reasons[0], reason: "fraud" }] })).toThrow(
      /reasons\[0\]\.reason/,
    );
  });
});

describe("parseCohorts", () => {
  it("komórki z udziałem null przy pustej kohorcie", () => {
    const dto = parseCohorts({
      from_month: "2026-07-01",
      to_month: "2026-09-01",
      max_offset: 12,
      cohorts: [
        {
          cohort_month: "2026-07-01",
          size: 2,
          retained: [
            { month_offset: 0, active: 2, share: 1 },
            { month_offset: 1, active: 1, share: 0.5 },
          ],
        },
      ],
    });
    expect(dto.cohorts[0].retained[1]).toEqual({ monthOffset: 1, active: 1, share: 0.5 });
  });
});

describe("parseDunning", () => {
  it("kwoty per waluta; mediana i stopa null bez cykli", () => {
    const dto = parseDunning({
      since: SINCE,
      until: UNTIL,
      started: 0,
      recovered: 0,
      lost: 0,
      open: 1,
      recovery_rate: null,
      median_days_to_recover: null,
      at_risk: [{ currency: "PLN", amount_minor: 4_900 }],
      recovered_mrr: [],
      lost_mrr: [],
    });
    expect(dto.recoveryRate).toBeNull();
    expect(dto.atRisk).toEqual([{ currency: "PLN", amountMinor: 4_900 }]);
    expect(dto.recoveredMrr).toEqual([]);
  });
});

describe("parseRealized", () => {
  it("kategorie, sumy i drugie źródło (zamówienia)", () => {
    const dto = parseRealized({
      since: SINCE,
      until: UNTIL,
      categories: [
        {
          category: "subscription",
          currency: "PLN",
          gross_minor: 10_000,
          refunds_minor: 1_000,
          net_minor: 9_000,
          documents: 3,
        },
      ],
      totals: [{ currency: "PLN", gross_minor: 10_000, refunds_minor: 1_000, net_minor: 9_000 }],
      orders: [{ currency: "PLN", amount_minor: 9_000, orders: 3 }],
      unknown_environment_documents: 2,
    });
    expect(dto.categories[0].netMinor).toBe(9_000);
    expect(dto.orders[0]).toEqual({ currency: "PLN", amountMinor: 9_000, orders: 3 });
    expect(dto.unknownEnvironmentDocuments).toBe(2);
  });
});

describe("parseRetentionOffers", () => {
  it("brak powodu (Z-09) i ankiety sprzed S2 są osobnymi licznikami", () => {
    const dto = parseRetentionOffers({
      since: SINCE,
      until: UNTIL,
      flows_started: 4,
      saved: 1,
      canceled: 2,
      abandoned: 1,
      open: 0,
      offers_shown: 2,
      offers_accepted: 1,
      save_rate_gross: 0.3333,
      save_rate_net: 0.25,
      reason_not_given: 1,
      legacy_responses: 1,
      reasons: [{ reason_id: null, reason_label: "Stara ankieta", responses: 1 }],
    });
    expect(dto.reasonNotGiven).toBe(1);
    expect(dto.reasons[0].reasonId).toBeNull();
  });
});

describe("parseOfferMatrix", () => {
  it("redaktor: liczba płacących null; problemy ze słownika", () => {
    const dto = parseOfferMatrix({
      plans: [
        {
          plan_id: "p1",
          tier_key: "student",
          interval: "month",
          price_cents: 1900,
          currency: "PLN",
          active: true,
          for_sale: true,
          catalog_price_id: "student_monthly",
          tier_active: false,
          pricing_visible: true,
          active_subscriptions: null,
          issues: ["tier_inactive"],
        },
      ],
      tiers: [
        {
          key: "student",
          rank: 10,
          active: false,
          pricing_visible: true,
          is_default: false,
          plans_for_sale: 1,
          issues: [],
        },
      ],
    });
    expect(dto.plans[0].activeSubscriptions).toBeNull();
    expect(dto.plans[0].issues).toEqual(["tier_inactive"]);
    expect(() =>
      parseOfferMatrix({ plans: [{ ...dto.plans[0], issues: ["broken"] }], tiers: [] }),
    ).toThrow(RevenueFinanceShapeError);
  });
});

describe("parseRevenueInputs / parseRevenueInputSave", () => {
  const row = {
    id: "i1",
    period_month: "2026-09-01",
    kind: "mrr_plan",
    segment: "all",
    currency: "PLN",
    amount_minor: 500_000,
    ratio: null,
    note: null,
    updated_at: "2026-10-19T08:00:00.123456+00:00",
    updated_by: "u1",
  };

  it("updated_at zostaje SUROWYM napisem (mikrosekundy - token współbieżności)", () => {
    const dto = parseRevenueInputs({
      from_month: "2026-08-01",
      to_month: "2026-09-01",
      rows: [row],
    });
    expect(dto.rows[0].updatedAt).toBe("2026-10-19T08:00:00.123456+00:00");
    expect(dto.rows[0].amountMinor).toBe(500_000);
  });

  it("delete bez wiersza, update z wierszem; update bez wiersza to błąd kształtu", () => {
    expect(parseRevenueInputSave({ op: "delete", row: null })).toEqual({ op: "delete", row: null });
    expect(parseRevenueInputSave({ op: "update", row }).row?.kind).toBe("mrr_plan");
    expect(() => parseRevenueInputSave({ op: "update", row: null })).toThrow(/row/);
  });
});

describe("parseEconomics", () => {
  const month = {
    month: "2026-09-01",
    currency: "PLN",
    mrr_end_minor: 100_000,
    customers_end: 10,
    arpa_minor: 10_000,
    new_customers: 2,
    logo_churn_rate: 0.05,
    realized_net_minor: 90_000,
    sales_marketing_cost_minor: null,
    cogs_minor: null,
    gross_margin: null,
    ebitda_margin: null,
    cac_minor: null,
    ltv_minor: null,
    ltv_cac_ratio: null,
    cac_payback_months: null,
    mrr_plan_minor: 120_000,
    plan_attainment: 0.8333,
    new_customers_plan: null,
    missing: [
      "new_customers_plan",
      "sales_marketing_cost",
      "gross_margin_pct",
      "ebitda_margin_pct",
    ],
  };

  it("brak wsadu = null + lista braków, nie zero", () => {
    const dto = parseEconomics({
      from_month: "2026-09-01",
      to_month: "2026-09-01",
      time_zone: "Europe/Warsaw",
      months: [month],
      missing: ["ebitda_margin_pct"],
      rule_of_40: null,
    });
    expect(dto.months[0].cacMinor).toBeNull();
    expect(dto.months[0].missing).toContain("sales_marketing_cost");
    expect(dto.ruleOf40).toBeNull();
  });

  it("Rule of 40 bez wartości wymaganej rzuca", () => {
    expect(() =>
      parseEconomics({
        from_month: "2026-09-01",
        to_month: "2026-09-01",
        time_zone: "Europe/Warsaw",
        months: [],
        missing: [],
        rule_of_40: {
          month: "2026-09-01",
          currency: "PLN",
          growth_yoy: 0.3,
          ebitda_margin: null,
          value: 0.4,
        },
      }),
    ).toThrow(/rule_of_40\.ebitda_margin/);
  });
});
