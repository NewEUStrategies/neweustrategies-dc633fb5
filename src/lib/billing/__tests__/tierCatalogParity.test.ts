// Strażnik dryfu katalogu warstw: stałe TS (TIER_RANKS, TIER_CAPABILITIES)
// muszą pokrywać się z kanonicznym seedem DB (pricing_catalog_v3_rows) -
// dokładnie tak, jak domainEventCatalog.test.ts pilnuje kontraktu szyny
// zdarzeń. Skan czyta migracje z dysku (źródło prawdy), więc edycja seedu
// bez aktualizacji stałych (albo odwrotnie) obleje CI zamiast cicho dryfować.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TIER_RANKS } from "@/lib/billing/tiers";
import { TIER_CAPABILITIES } from "@/lib/billing/capabilities";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const CATALOG_FILE = "20260722230000_pricing_catalog_v3_retention.sql";

/** Ciało funkcji pricing_catalog_v3_rows() (od CREATE do zamykającego $$;). */
function catalogFunctionBody(): string {
  const sql = readFileSync(join(MIGRATIONS_DIR, CATALOG_FILE), "utf8");
  // Kotwica na CREATE (nazwa funkcji pada też w komentarzu nagłówkowym).
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.pricing_catalog_v3_rows()");
  expect(start, `pricing_catalog_v3_rows missing from ${CATALOG_FILE}`).toBeGreaterThan(-1);
  const end = sql.indexOf("$$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

/** Wiersze katalogu: pary (key, rank) z krotek VALUES ('key', rank, ...). */
function seededTierRanks(): Map<string, number> {
  const body = catalogFunctionBody();
  const out = new Map<string, number>();
  for (const m of body.matchAll(/\('([a-z_]+)',\s*(\d+),\s*'/g)) {
    out.set(m[1], Number(m[2]));
  }
  return out;
}

/** Flagi features włączone w seedzie (płaskie obiekty '{...}'::jsonb). */
function seededFeatureKeys(): Set<string> {
  const body = catalogFunctionBody();
  const keys = new Set<string>();
  for (const m of body.matchAll(/'(\{[^}]*\})'::jsonb/g)) {
    const parsed: unknown = JSON.parse(m[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (value === true) keys.add(key);
      }
    }
  }
  return keys;
}

function allMigrationsSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");
}

describe("tier catalog parity (TS constants vs DB seed)", () => {
  it("TIER_RANKS matches pricing_catalog_v3_rows exactly (keys and ranks)", () => {
    const seeded = seededTierRanks();
    expect(seeded.size, "catalog VALUES scan matched nothing").toBeGreaterThanOrEqual(10);

    const constant = new Map(Object.entries(TIER_RANKS));
    const missingInConstant = [...seeded.keys()].filter((key) => !constant.has(key));
    const missingInSeed = [...constant.keys()].filter((key) => !seeded.has(key));
    expect(missingInConstant, "seeded tiers absent from TIER_RANKS").toEqual([]);
    expect(missingInSeed, "TIER_RANKS keys absent from the DB seed").toEqual([]);

    for (const [key, rank] of seeded) {
      expect(constant.get(key), `rank of '${key}'`).toBe(rank);
    }
  });

  it("every feature flag enabled in the seed has a TIER_CAPABILITIES entry", () => {
    const seeded = seededFeatureKeys();
    expect(seeded.size).toBeGreaterThanOrEqual(5);
    const registry = new Set(TIER_CAPABILITIES.map((c) => c.key));
    const unregistered = [...seeded].filter((key) => !registry.has(key));
    expect(
      unregistered,
      "flags seeded in membership_tiers.features but missing from the capabilities registry",
    ).toEqual([]);
  });

  it("every ENFORCED capability key is present in migrations (its gate exists DB-side)", () => {
    const sql = allMigrationsSql();
    const missing = TIER_CAPABILITIES.filter((c) => c.enforced && !sql.includes(`'${c.key}'`)).map(
      (c) => c.key,
    );
    expect(missing, "enforced flags never referenced by any migration").toEqual([]);
  });

  it("cross-sell audience keys used by /pricing exist in the audience seed", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, CATALOG_FILE), "utf8");
    // pricing.tsx linkuje segmenty 'business' i 'team' (CrossSellBand) -
    // usunięcie ich z seedu wymaga zmiany strony, nie tylko danych.
    for (const key of ["individual", "business", "academic", "team"]) {
      expect(sql.includes(`('${key}', '`), `audience '${key}' in seed`).toBe(true);
    }
  });
});
