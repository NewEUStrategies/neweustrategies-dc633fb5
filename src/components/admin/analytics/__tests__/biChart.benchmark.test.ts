// @vitest-environment node
// `biChart` z rejestru wskaźników i benchmarku (SPEC §5.5; PLAN S6 T4 pkt 6).
//
// Klasy defektów:
//   1. ZŁA SKALA PASMA. Churn w serii jest ułamkiem (0,035), a pasma -
//      punktami procentowymi (3,5). Strefa bez przeliczenia leży sto razy
//      wyżej niż dane i oś rozciąga się do 3,5 przy danych 0,03-0,06.
//   2. PASMO BEZ PRZYPISU. `effectiveBand` odrzuca pasmo, którego `sourceId`
//      nie ma na liście źródeł - wykres pokazałby „brak benchmarku” mimo
//      benchmarku. Przypis = pierwsze źródło aktywnego kontekstu.
//   3. WYMYŚLONA GRANICA. Strefa otwarta („NRR ≥ x”) nie ma górnej granicy -
//      dorysowanie jej byłoby liczbą bez źródła; wtedy linia progu.
//   4. POCHODZENIE. Jedno pasmo-heurystyka czyni całą skalę szacunkiem (E).
//   5. WSTECZNA ZGODNOŚĆ. Panele bez `metricId` dostają dokładnie to co dotąd.
import { describe, expect, it } from "vitest";
import { defaultChartConfig } from "@/lib/charts/parse";
import { effectiveBand } from "@/lib/charts/status";
import { MAX_CHART_SOURCES } from "@/lib/charts/sources";
import {
  toChartMetric,
  type LocalizedBenchmark,
} from "@/lib/analytics/semantic/benchmarks/adapter";
import { metricHelp } from "@/lib/analytics/semantic/metricHelp";
import { biChart, benchmarkZone, type BiChartInput } from "../biChart";
import { contextOf, payloadFor } from "../semantic/__tests__/benchmarkFixtures";

const BASE: BiChartInput = {
  kind: "line",
  categories: ["I", "II", "III"],
  series: [{ name: "Churn", values: [0.03, 0.045, 0.05] }],
};

function bench(group: Parameters<typeof payloadFor>[0], key: string, lang: "pl" | "en" = "pl") {
  const payload = payloadFor(group, lang);
  const b = payload.benchmarks.find((x) => x.key === key);
  if (!b) throw new Error(`fikstura: ${key}`);
  return { bench: b, sources: payload.sources };
}

function input(
  b: { bench: LocalizedBenchmark; sources: ReturnType<typeof payloadFor>["sources"] },
  ctxId: string,
): BiChartInput["benchmark"] {
  return { bench: b.bench, context: contextOf(b.bench, ctxId), sources: b.sources };
}

describe("biChart - wsteczna zgodność", () => {
  it("bez metricId i benchmarku pola uczciwości są domyślne (jak dotąd)", () => {
    const base = defaultChartConfig();
    const cfg = biChart(BASE);
    expect(cfg.metric).toBe(base.metric);
    expect(cfg.band).toBe(base.band);
    expect(cfg.target).toBe(base.target);
    expect(cfg.sources).toEqual(base.sources);
    expect(cfg.direction).toBe(base.direction);
    expect(cfg.provenance).toBe(base.provenance);
    expect(cfg.animate).toBe(false);
  });

  it("jawny kierunek bez benchmarku przechodzi do konfiguracji", () => {
    expect(biChart({ ...BASE, direction: "lower" }).direction).toBe("lower");
  });
});

describe("biChart - objaśnienie z rejestru", () => {
  it("metricId bez benchmarku: dymek z rejestru (metricHelp) w języku wykresu", () => {
    expect(biChart({ ...BASE, metricId: "sessions", lang: "en" }).metric).toEqual(
      metricHelp("sessions", "en"),
    );
  });

  it("metricId z benchmarkiem: dymek z benchmarku (skrót, rozwinięcie, dźwignie)", () => {
    const churn = bench("retention", "logo_churn_monthly");
    const cfg = biChart({
      ...BASE,
      metricId: "logo_churn_monthly",
      benchmark: input(churn, "logo_churn_monthly.news_b2c"),
    });
    expect(cfg.metric).toEqual(toChartMetric(churn.bench));
    expect(cfg.metric?.levers).toBe(churn.bench.levers);
  });
});

describe("biChart - strefa dobra, przypisy, kierunek, pochodzenie", () => {
  it("kierunek lower: strefa [0; 3,5 pp] w skali SERII (ułamek) z przypisem, który przechodzi effectiveBand", () => {
    const churn = bench("retention", "logo_churn_monthly");
    const ctx = contextOf(churn.bench, "logo_churn_monthly.news_b2c");
    const cfg = biChart({
      ...BASE,
      metricId: "logo_churn_monthly",
      benchmark: input(churn, ctx.id),
    });
    expect(cfg.band?.min).toBe(0);
    expect(cfg.band?.max).toBeCloseTo(0.035, 10);
    expect(cfg.band?.sourceId).toBe(ctx.sourceIds[0]);
    expect(
      effectiveBand(
        cfg.band,
        cfg.sources.map((s) => s.id),
      ),
    ).not.toBeNull();
    expect(cfg.direction).toBe("lower");
    expect(cfg.target).toBeNull();
  });

  it("przypisy tylko aktywnego kontekstu, w jego kolejności, najwyżej 12", () => {
    const churn = bench("retention", "logo_churn_monthly");
    const ctx = contextOf(churn.bench, "logo_churn_monthly.news_b2c");
    const cfg = biChart({
      ...BASE,
      metricId: "logo_churn_monthly",
      benchmark: input(churn, ctx.id),
    });
    expect(cfg.sources.map((s) => s.id)).toEqual(ctx.sourceIds.slice(0, MAX_CHART_SOURCES));
    expect(cfg.sources.length).toBeLessThanOrEqual(MAX_CHART_SOURCES);
  });

  it("pochodzenie: B tylko gdy KAŻDE pasmo jest z kwartyli źródła, inaczej E", () => {
    const churn = bench("retention", "logo_churn_monthly");
    for (const ctx of churn.bench.contexts) {
      const cfg = biChart({
        ...BASE,
        metricId: "logo_churn_monthly",
        benchmark: input(churn, ctx.id),
      });
      expect(cfg.provenance, ctx.id).toBe(ctx.bands.every((b) => b.basis === "B") ? "B" : "E");
    }
    const mrrPlan = bench("revenue", "mrr");
    expect(biChart({ ...BASE, benchmark: input(mrrPlan, "mrr.plan_attainment") }).provenance).toBe(
      "E",
    );
  });

  it("wskaźnik przedziałowy: strefa domknięta po obu stronach optimum (dobry-optymalny-dobry)", () => {
    const aps = bench("revenue", "annual_plan_share");
    const cfg = biChart({
      ...BASE,
      metricId: "annual_plan_share",
      benchmark: input(aps, "annual_plan_share.b2c_media"),
    });
    expect(cfg.band?.min).toBeCloseTo(0.4, 10);
    expect(cfg.band?.max).toBeCloseTo(0.75, 10);
    expect(cfg.direction).toBe("range");
  });

  it("strefa otwarta bez naturalnej granicy (NRR ≥ x): linia progu, nie pasmo", () => {
    const nrr = bench("retention", "net_revenue_retention");
    const ctx = contextOf(nrr.bench, "net_revenue_retention.b2b_smb");
    const zone = benchmarkZone(ctx, "net_revenue_retention");
    const cfg = biChart({
      ...BASE,
      metricId: "net_revenue_retention",
      benchmark: input(nrr, ctx.id),
    });
    expect(cfg.band).toBeNull();
    expect(cfg.target?.value).toBe(zone.target);
    const firstGood = ctx.bands.find((b) => b.tier === "good")?.min ?? Number.NaN;
    expect(cfg.target?.value).toBeCloseTo(firstGood / 100, 10);
  });

  it("kwota wobec pasma procentowego (MRR vs realizacja planu): bez strefy, ale z przypisami", () => {
    const mrr = bench("revenue", "mrr");
    const cfg = biChart({ ...BASE, metricId: "mrr", benchmark: input(mrr, "mrr.plan_attainment") });
    expect(cfg.band).toBeNull();
    expect(cfg.target).toBeNull();
    expect(cfg.sources.length).toBeGreaterThan(0);
  });

  it("bez metricId seria jest w jednostce kontekstu (bez przeliczenia)", () => {
    const aps = bench("revenue", "annual_plan_share");
    const cfg = biChart({ ...BASE, benchmark: input(aps, "annual_plan_share.b2c_media") });
    expect(cfg.band).toMatchObject({ min: 40, max: 75, demo: false });
    expect(cfg.metric).toEqual(toChartMetric(aps.bench));
  });

  it("jawny kierunek panelu wygrywa z kierunkiem kontekstu", () => {
    const churn = bench("retention", "logo_churn_monthly");
    const cfg = biChart({
      ...BASE,
      metricId: "logo_churn_monthly",
      direction: "range",
      benchmark: input(churn, "logo_churn_monthly.news_b2c"),
    });
    expect(cfg.direction).toBe("range");
  });
});
