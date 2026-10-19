// @vitest-environment node
// Spójność krzyżowa benchmarków (brief 05 §5). Funkcje przeliczeń są jedynym
// miejscem wzorów; blok „prawdziwe pasma” sprawdza nimi dane po imporcie -
// poprawka granicy churnu miesięcznego bez bliźniaczej poprawki rocznego
// (albo CMGR bez kwartyli r/r) zapali ten test, zanim panel pokaże „dobry”
// i „słaby” dla tego samego klienta.
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  readGroupInputs,
} from "../../../../../../scripts/benchmarks/import-benchmarks";
import {
  annualizeChurn,
  cmgrFromYoy,
  mirrorBands,
  monthlyFromAnnual,
  quickRatioEfficiency,
} from "../consistency";
import type { BenchBand } from "../types";

const DOCS = path.resolve("docs/benchmarki/2026-10-18");

describe("annualizeChurn i monthlyFromAnnual", () => {
  it("przelicza churn miesięczny na roczny: 1 − (1 − m)^12 (wartości z pasm news B2C)", () => {
    expect(annualizeChurn(2.7)).toBeCloseTo(28.0, 1);
    expect(annualizeChurn(3.5)).toBeCloseTo(34.8, 1);
    expect(annualizeChurn(4.9)).toBeCloseTo(45.3, 1);
    expect(annualizeChurn(7)).toBeCloseTo(58.1, 1);
    expect(annualizeChurn(0)).toBe(0);
  });

  it("odwrotność wraca do wartości wyjściowej", () => {
    for (const m of [0.25, 1.8, 3.04, 4.62, 12.5]) {
      expect(monthlyFromAnnual(annualizeChurn(m))).toBeCloseTo(m, 10);
    }
    expect(monthlyFromAnnual(28)).toBeCloseTo(2.7, 1);
  });
});

describe("cmgrFromYoy i quickRatioEfficiency", () => {
  it("CMGR z kwartyli r/r SaaS Capital: 20/40/100 % → 1,53/2,84/5,95 % m/m", () => {
    expect(cmgrFromYoy(20)).toBeCloseTo(1.53, 2);
    expect(cmgrFromYoy(40)).toBeCloseTo(2.84, 2);
    expect(cmgrFromYoy(100)).toBeCloseTo(5.95, 2);
    expect(cmgrFromYoy(-5)).toBeCloseTo(-0.43, 2);
  });

  it("efektywność wzrostu 1 − 1/QR; QR ≤ 0 nie ma efektywności", () => {
    expect(quickRatioEfficiency(1)).toBe(0);
    expect(quickRatioEfficiency(2)).toBe(0.5);
    expect(quickRatioEfficiency(4)).toBe(0.75);
    expect(quickRatioEfficiency(0)).toBeNaN();
    expect(quickRatioEfficiency(-1)).toBeNaN();
  });
});

describe("mirrorBands - CCR ↔ CAR (suma 100)", () => {
  const ccr: BenchBand[] = [
    { tier: "critical", min: null, max: 45, basis: "B" },
    { tier: "weak", min: 45, max: 62, basis: "B" },
    { tier: "normal", min: 62, max: 75, basis: "B" },
    { tier: "good", min: 75, max: 85, basis: "B" },
    { tier: "optimal", min: 85, max: null, basis: "E" },
  ];

  it("odbija granice względem 100, sortuje rosnąco, poziom zostaje przy przedziale", () => {
    expect(mirrorBands(ccr)).toEqual([
      { tier: "optimal", min: null, max: 15, basis: "E" },
      { tier: "good", min: 15, max: 25, basis: "B" },
      { tier: "normal", min: 25, max: 38, basis: "B" },
      { tier: "weak", min: 38, max: 55, basis: "B" },
      { tier: "critical", min: 55, max: null, basis: "B" },
    ]);
  });

  it("dwa odbicia to tożsamość", () => {
    expect(mirrorBands(mirrorBands(ccr))).toEqual(ccr);
  });
});

describe("prawdziwe pasma po imporcie", () => {
  const registry = buildRegistry(readGroupInputs(DOCS, ["przychod", "retencja", "ekonomika"]));
  const contexts = new Map(
    [...registry.benchmarks.values()]
      .flat()
      .flatMap((e) => e.contexts.map((c) => [c.id, c] as const)),
  );
  const finite = (id: string): number[] => {
    const ctx = contexts.get(id);
    if (!ctx) throw new Error(`brak kontekstu ${id}`);
    return ctx.bands.flatMap((b) => (b.max === null ? [] : [b.max]));
  };
  const tiers = (id: string) => contexts.get(id)?.bands.map((b) => b.tier);

  it.each([
    ["news_b2c", "news_b2c_all"],
    ["b2b_smb", "b2b_smb"],
    ["b2b_mid_market", "b2b_mid_market"],
    ["b2b_enterprise", "b2b_enterprise"],
    ["membership", "membership"],
  ])("churn M↔R: logo_churn_monthly.%s ↔ logo_churn_annual.%s (±1 pp)", (monthly, annual) => {
    const m = finite(`logo_churn_monthly.${monthly}`);
    const r = finite(`logo_churn_annual.${annual}`);
    expect(m).toHaveLength(r.length);
    m.forEach((boundary, i) => {
      expect(Math.abs(annualizeChurn(boundary) - r[i])).toBeLessThanOrEqual(1);
    });
    // Te same poziomy w tej samej kolejności - granica nie „przeskakuje” pasma.
    expect(tiers(`logo_churn_monthly.${monthly}`)).toEqual(tiers(`logo_churn_annual.${annual}`));
  });

  it("CMGR B2B < 1 mln USD ARR = kwartyle r/r przeliczone wzorem (±0,1 pp)", () => {
    const [, p25, p50, p75] = finite("mrr_growth_mom.b2b_saas_under_1m_usd");
    expect(Math.abs(p25 - cmgrFromYoy(20))).toBeLessThanOrEqual(0.1);
    expect(Math.abs(p50 - cmgrFromYoy(40))).toBeLessThanOrEqual(0.1);
    expect(Math.abs(p75 - cmgrFromYoy(100))).toBeLessThanOrEqual(0.1);
  });

  it("efektywność Net New MRR odpowiada progom QR 2 i 4 (50 % i 75 %)", () => {
    const bounds = finite("net_new_mrr.growth_efficiency");
    expect(bounds).toContain(100 * quickRatioEfficiency(2));
    expect(bounds).toContain(100 * quickRatioEfficiency(4));
  });
});
