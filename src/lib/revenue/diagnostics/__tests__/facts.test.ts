// Kontrakt faktów `RevenueFacts v1` (S7, SPEC §5.7): tolerancyjny parser
// JSONB `admin_revenue_facts`, parytet kluczy SQL ↔ TS (`REVENUE_FACTS_KEYS`
// z `// rpc-shape`) i cegiełki oceny reguł.
//
// PARYTET Z SQL CZYTA MIGRACJE JAKO TEKST: każdy klucz z `REVENUE_FACTS_KEYS`
// musi wystąpić jako literał `'klucz'` w ciele funkcji `_revenue_facts_<obszar>`
// - nowe pole dopisane tylko po jednej stronie zapali test, zamiast dać
// regule „nie wiadomo" na produkcji.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { REVENUE_AREAS, type RevenueArea } from "@/lib/admin/revenue/hubTabs";
import {
  EMPTY_REVENUE_FACTS,
  OK,
  REVENUE_FACTS_KEYS,
  UNKNOWN,
  areaFacts,
  defaultImpact,
  ev,
  factHashOf,
  finding,
  parseRevenueFacts,
  sumKnown,
} from "../facts";

const SQL = [
  "supabase/migrations/20261020150000_revenue_facts.sql",
  "supabase/migrations/20261020150050_revenue_facts_operations.sql",
]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

/** Ciało `public._revenue_facts_<obszar>` - od nagłówka do zamykającego `$$;`. */
function functionBody(area: RevenueArea): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public._revenue_facts_${area}(`);
  expect(start, `brak funkcji _revenue_facts_${area}`).toBeGreaterThanOrEqual(0);
  const end = SQL.indexOf("\n$$;", start);
  return SQL.slice(start, end);
}

describe("parytet kluczy SQL ↔ REVENUE_FACTS_KEYS", () => {
  it("klucze obszarów to dokładnie 16 obszarów huba", () => {
    const areaKeys = Object.keys(REVENUE_FACTS_KEYS).filter(
      (k) => !["root", "catalogPlan", "catalogTier"].includes(k),
    );
    expect(areaKeys.sort()).toEqual([...REVENUE_AREAS].sort());
  });

  it.each(REVENUE_AREAS.map((area) => [area] as const))("%s: każdy klucz TS jest w SQL", (area) => {
    const body = functionBody(area);
    for (const key of REVENUE_FACTS_KEYS[area]) expect(body, `${area}.${key}`).toContain(`'${key}'`);
  });

  it("plan i warstwa katalogu - pola obiektów listy", () => {
    const body = functionBody("catalog");
    for (const key of [...REVENUE_FACTS_KEYS.catalogPlan, ...REVENUE_FACTS_KEYS.catalogTier]) {
      expect(body, key).toContain(`'${key}'`);
    }
  });

  it("korzeń: v, computedAt, areas z funkcji panelu", () => {
    const start = SQL.indexOf("CREATE OR REPLACE FUNCTION public.admin_revenue_facts()");
    const body = SQL.slice(start, SQL.indexOf("\n$$;", start));
    for (const key of REVENUE_FACTS_KEYS.root) expect(body).toContain(`'${key}'`);
    for (const area of REVENUE_AREAS) expect(body, area).toContain(`'${area}'`);
  });
});

describe("parseRevenueFacts - tolerancja zamiast wyjątku", () => {
  it.each([[null], [undefined], ["x"], [[]], [{ v: 2, areas: {} }], [{ areas: {} }]])(
    "nieznany kształt %j → pusty zestaw (unknown w każdej regule)",
    (raw) => {
      expect(parseRevenueFacts(raw)).toEqual(EMPTY_REVENUE_FACTS);
    },
  );

  it("obszar `null` zostaje `null`, obszar spoza listy znika, nie-obiekt znika", () => {
    const facts = parseRevenueFacts({
      v: 1,
      computedAt: "2026-10-20T12:00:00Z",
      areas: { crm: null, galaxy: { x: 1 }, sync: "broken", funnel: { signups30d: 3 } },
    });
    expect(facts.computedAt).toBe("2026-10-20T12:00:00Z");
    expect(facts.areas).toEqual({ crm: null, funnel: { signups30d: 3 } });
    expect(areaFacts(facts, "crm")).toBeNull();
    expect(areaFacts(facts, "sync")).toBeNull();
  });

  it("bigint jako napis cyfr jest liczbą; inne napisy i NaN znikają", () => {
    const facts = parseRevenueFacts({
      v: 1,
      areas: { funnel: { signups30d: "12", unknownSource30d: "abc", popupMembers7d: Number.NaN } },
    });
    expect(facts.areas.funnel).toEqual({ signups30d: 12 });
  });

  it("zdeformowany plan katalogu jest pomijany, poprawny zostaje (waluta wielkimi literami)", () => {
    const facts = parseRevenueFacts({
      v: 1,
      areas: {
        catalog: {
          plans: [
            { id: "p1" },
            {
              id: "p2",
              tierKey: "pro",
              tierFound: true,
              active: true,
              forSale: true,
              interval: "month",
              currency: "pln",
              priceCents: null,
              catalogPair: true,
            },
            "garbage",
          ],
        },
      },
    });
    expect(facts.areas.catalog?.plans).toEqual([
      {
        id: "p2",
        tierKey: "pro",
        tierFound: true,
        tierRank: null,
        active: true,
        forSale: true,
        interval: "month",
        currency: "PLN",
        priceCents: null,
        catalogPair: true,
      },
    ]);
  });

  it("pola `null` z SQL zostają `null` (redaktor bez kwot, brak migawek)", () => {
    const facts = parseRevenueFacts({
      v: 1,
      areas: {
        data_quality: { mrrCatalogBasis: null, ledgerDrift: null },
        workflows: { cancelRecipe: null },
        paywall: { lastHitAt: null, firstGatedAt: null },
      },
    });
    expect(facts.areas.data_quality).toEqual({ mrrCatalogBasis: null, ledgerDrift: null });
    expect(facts.areas.workflows).toEqual({ cancelRecipe: null });
    expect(facts.areas.paywall).toEqual({ lastHitAt: null, firstGatedAt: null });
  });

  it("listy tekstów odrzucają elementy nietekstowe", () => {
    const facts = parseRevenueFacts({
      v: 1,
      areas: { sync: { silentDaily: ["a", 1, null, "b"], silentWeekly: [] } },
    });
    expect(facts.areas.sync).toEqual({ silentDaily: ["a", "b"], silentWeekly: [] });
  });

  it("prezentacja kasy przyjmuje wyłącznie pl/en", () => {
    const facts = parseRevenueFacts({
      v: 1,
      areas: {
        checkout: {
          presentation: [
            { lang: "pl", displayCurrency: "PLN", chargeCurrencies: ["PLN"] },
            { lang: "de", displayCurrency: "EUR", chargeCurrencies: ["EUR"] },
          ],
        },
      },
    });
    expect(facts.areas.checkout?.presentation).toEqual([
      { lang: "pl", displayCurrency: "PLN", chargeCurrencies: ["PLN"] },
    ]);
  });
});

describe("cegiełki oceny", () => {
  it("OK i UNKNOWN to stany bez dowodów", () => {
    expect(OK).toEqual({ state: "ok" });
    expect(UNKNOWN).toEqual({ state: "unknown" });
  });

  it("finding przyjmuje jeden dowód albo listę i pomija puste pola", () => {
    expect(finding("warn", { evidence: ev("doiOff") })).toEqual({
      state: "warn",
      evidence: [{ key: "doiOff", params: {} }],
    });
    expect(
      finding("error", { count: 2, refs: ["a"], evidence: [ev("x", { count: 2 }), ev("y")] }),
    ).toEqual({
      state: "error",
      count: 2,
      refs: ["a"],
      evidence: [
        { key: "x", params: { count: 2 } },
        { key: "y", params: {} },
      ],
    });
  });

  it.each([
    ["critical", "error", "high"],
    ["warning", "error", "high"],
    ["info", "error", "medium"],
    ["critical", "warn", "medium"],
    ["warning", "warn", "low"],
    ["info", "warn", "low"],
    ["critical", "unknown", "low"],
    ["critical", "ok", "low"],
  ] as const)("defaultImpact(%s, %s) = %s", (severity, state, impact) => {
    expect(defaultImpact(severity, state)).toBe(impact);
  });

  it("factHashOf jest deterministyczny i ma prefiks wersji", () => {
    expect(factHashOf({ state: "error", count: 1, refs: ["x"] })).toBe(
      factHashOf({ state: "error", count: 1, refs: ["x"] }),
    );
    expect(factHashOf({ state: "error", count: 1 })).toMatch(/^f1:[0-9a-f]{8}$/);
  });

  it("sumKnown pomija brakujące pola, a bez żadnego daje undefined", () => {
    expect(sumKnown(1, undefined, 2)).toBe(3);
    expect(sumKnown(undefined, undefined)).toBeUndefined();
  });
});
