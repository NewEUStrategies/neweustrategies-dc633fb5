// PARYTET SEGMENTÓW DANYCH: TS ⇄ SQL (SPEC §8.3, tabela PLAN_I0 §2.2).
//
// Segment ruchu MRR liczy baza (`revenue_segment_of_tier`), a panel opisuje
// go etykietami i filtrami z `segments.ts`. Rozjazd = kafel „B2B" w hubie
// liczony z innej listy warstw niż wiersze księgi. Test czyta pliki migracji
// jako tekst (bez bazy): komentarze wycięte, białe znaki sprowadzone do
// zapisu kanonicznego po obu stronach porównania. Funkcja jest
// redefiniowana (I0 090500 -> I9b 160000), więc porównanie bierze NAJNOWSZĄ
// definicję - jak baza po migracjach forward-only.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TIER_RANKS } from "@/lib/billing/tierRanks";
import { stripSqlComments } from "@/lib/ci/ownership";
import { REVENUE_SEGMENTS } from "../search";
import { REVENUE_DATA_SEGMENTS, REVENUE_SEGMENT_BY_TIER, revenueSegmentOfTier } from "../segments";

const KSIEGA = "supabase/migrations/20261020090000_hub_schema_revenue_ledger.sql";
const LEJEK = "supabase/migrations/20261020090100_hub_schema_funnel_ops.sql";
const MIGRACJE = "supabase/migrations";
const DEFINICJA = "FUNCTION public.revenue_segment_of_tier(";

/** Plik z najnowszą definicją funkcji (kolejność wersji = kolejność wdrożenia). */
function najnowszaDefinicja(): string {
  const pliki = readdirSync(MIGRACJE)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .filter((f) => stripSqlComments(readFileSync(`${MIGRACJE}/${f}`, "utf8")).includes(DEFINICJA));
  expect(pliki.length, "brak definicji revenue_segment_of_tier").toBeGreaterThan(0);
  return `${MIGRACJE}/${pliki[pliki.length - 1]}`;
}

/** Zapis kanoniczny: jedna spacja, bez spacji przy nawiasach i przecinkach. */
const kanon = (sql: string) =>
  sql
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();

function migracja(plik: string): string {
  expect(existsSync(plik), `brak migracji toru A: ${plik}`).toBe(true);
  return kanon(stripSqlComments(readFileSync(plik, "utf8")));
}

const lista = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(",");

describe("segmenty danych - parytet z CHECK", () => {
  it("mrr_movements.segment = REVENUE_DATA_SEGMENTS (090000)", () => {
    const fragment = kanon(
      `segment text NOT NULL CHECK (segment IN (${lista(REVENUE_DATA_SEGMENTS)}))`,
    );
    expect(migracja(KSIEGA)).toContain(fragment);
  });

  it("revenue_manual_inputs.segment = REVENUE_SEGMENTS z `all` (090100)", () => {
    const fragment = kanon(
      `segment text NOT NULL DEFAULT 'all' CHECK (segment IN (${lista(REVENUE_SEGMENTS)}))`,
    );
    expect(migracja(LEJEK)).toContain(fragment);
  });

  it("filtr URL to segmenty danych bez `other` plus `all`", () => {
    expect([...REVENUE_SEGMENTS].sort()).toEqual(
      ["all", ...REVENUE_DATA_SEGMENTS.filter((s) => s !== "other")].sort(),
    );
  });
});

describe("revenue_segment_of_tier ⇄ REVENUE_SEGMENT_BY_TIER (najnowsza migracja)", () => {
  /** Ciało `CASE … END` funkcji, rozłożone na mapę warstwa → segment. */
  function mapaZSql(): { mapa: Record<string, string>; inne: string | null } {
    const sql = migracja(najnowszaDefinicja());
    const start = sql.indexOf(DEFINICJA);
    expect(start, "brak definicji revenue_segment_of_tier").toBeGreaterThanOrEqual(0);
    const cialo = sql.slice(start, sql.indexOf(" END", sql.indexOf("CASE", start)) + 4);
    const mapa: Record<string, string> = {};
    for (const m of cialo.matchAll(/WHEN p_tier_key IN\(([^)]*)\)THEN '([a-z0-9_]+)'/g)) {
      for (const klucz of m[1].split(",")) mapa[klucz.replace(/'/g, "")] = m[2];
    }
    return { mapa, inne: /ELSE '([a-z0-9_]+)' END$/.exec(cialo)?.[1] ?? null };
  }

  it("ta sama mapa warstw i ten sam segment domyślny", () => {
    const { mapa, inne } = mapaZSql();
    expect(mapa).toEqual(REVENUE_SEGMENT_BY_TIER);
    expect(inne).toBe("other");
  });

  it("najnowsza definicja to redefinicja I9b (decyzja właściciela 2026-10-20)", () => {
    expect(najnowszaDefinicja()).toBe(
      "supabase/migrations/20261020160000_revenue_segment_institutions.sql",
    );
  });

  it("każdy segment z mapy jest segmentem danych", () => {
    const { mapa } = mapaZSql();
    for (const segment of Object.values(mapa)) {
      expect(REVENUE_DATA_SEGMENTS).toContain(segment);
    }
  });
});

describe("revenueSegmentOfTier", () => {
  it("każda warstwa katalogu ma segment; spoza mapy to `other`", () => {
    for (const tier of Object.keys(TIER_RANKS)) {
      const segment = revenueSegmentOfTier(tier);
      expect(REVENUE_DATA_SEGMENTS, tier).toContain(segment);
      expect(segment, tier).toBe(
        REVENUE_SEGMENT_BY_TIER[tier as keyof typeof REVENUE_SEGMENT_BY_TIER] ?? "other",
      );
    }
  });

  it("przypisania z typu klienta (decyzja właściciela 2026-10-20, Z-01)", () => {
    expect(revenueSegmentOfTier("student")).toBe("b2c_reduced");
    expect(revenueSegmentOfTier("educator")).toBe("b2c_reduced");
    expect(revenueSegmentOfTier("member")).toBe("b2c_individual");
    expect(revenueSegmentOfTier("pro")).toBe("b2c_individual");
    for (const tier of [
      "team",
      "business",
      "corporate",
      "partner",
      "partner_general",
      "presidents_circle",
      "ngo",
    ]) {
      expect(revenueSegmentOfTier(tier), tier).toBe("b2b_institution");
    }
    for (const tier of ["reader", "supporter", "vip", "decision_lab", "nieznana"]) {
      expect(revenueSegmentOfTier(tier), tier).toBe("other");
    }
  });

  it("brak warstwy i klucze dziedziczone z prototypu to `other`", () => {
    expect(revenueSegmentOfTier(null)).toBe("other");
    expect(revenueSegmentOfTier(undefined)).toBe("other");
    expect(revenueSegmentOfTier("")).toBe("other");
    expect(revenueSegmentOfTier("toString")).toBe("other");
    expect(revenueSegmentOfTier("__proto__")).toBe("other");
  });
});
