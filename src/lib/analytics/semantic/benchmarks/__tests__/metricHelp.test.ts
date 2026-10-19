// `metricHelp` - jedno źródło objaśnień metryki dla tooltipa, kafla KPI,
// słownika i objaśnienia BI. Z benchmarkiem: treść zweryfikowana (ten sam
// kształt co `toChartMetric`). Bez benchmarku: słownik metryk - etykieta,
// wzór powiązania AUTORYTATYWNEGO (liczba z raportu), definicja i strażnicy;
// bez zmyślonych progów i dźwigni.
import { describe, expect, it } from "vitest";
import { toChartMetric, type LocalizedBenchmark } from "../adapter";
import { abbreviationOf, metricHelp } from "../../metricHelp";
import { authoritativeBinding, metricById } from "../../metrics";

const BENCH: LocalizedBenchmark = {
  key: "logo_churn_monthly",
  metricId: "logo_churn_monthly",
  group: "retention",
  abbr: "Logo churn (M)",
  name: "Monthly logo (customer) churn rate",
  expansion: "Churn – customer attrition.",
  formula: "Customers who left ÷ customers at the start of the month × 100%.",
  interpretation: "Shows what share of the paying base you lose each month.",
  levers: "Build the habit in the first weeks.",
  caveats: [{ text: "Data come mainly from the USA" }, { text: "Thresholds are heuristics." }],
  direction: "lower",
  confidence: "medium",
  asOf: "2026-10-18",
  reviewBy: "2027-10-18",
  contexts: [],
  defaultContextBySegment: {},
  pairs: [],
};

describe("metricHelp", () => {
  it("z benchmarkiem: dokładnie ChartMetric adaptera (ten sam tooltip co wykresy)", () => {
    expect(metricHelp("logo_churn_monthly", "en", BENCH)).toEqual(toChartMetric(BENCH));
    expect(metricHelp("logo_churn_monthly", "en", BENCH)).toMatchObject({
      name: "Logo churn (M)",
      measures: "Monthly logo (customer) churn rate",
      caution: "Data come mainly from the USA. Thresholds are heuristics.",
    });
  });

  it("bez benchmarku: etykieta, wzór powiązania autorytatywnego, definicja i strażnicy", () => {
    for (const lang of ["pl", "en"] as const) {
      const def = metricById("sessions");
      const label = lang === "pl" ? def.labelPl : def.labelEn;
      expect(metricHelp("sessions", lang, null)).toEqual({
        name: abbreviationOf(label),
        expansion: label,
        formula: authoritativeBinding("sessions").formula,
        measures: lang === "pl" ? def.definitionPl : def.definitionEn,
        reading: "",
        levers: "",
        caution: def.guards.join(" "),
      });
    }
  });

  it("metryki huba bez benchmarku też dostają objaśnienie ze słownika", () => {
    const help = metricHelp("revenue_realized", "pl");
    expect(help.formula).toBe(authoritativeBinding("revenue_realized").formula);
    expect(help.measures.length).toBeGreaterThan(20);
    expect(help.caution.length).toBeGreaterThan(0);
  });
});

describe("abbreviationOf", () => {
  it("pierwszy token wielkimi literami, a bez niego cała etykieta", () => {
    expect(abbreviationOf("CTOR newslettera")).toBe("CTOR");
    expect(abbreviationOf("LCP (p75)")).toBe("LCP");
    expect(abbreviationOf("Newsletter CTOR")).toBe("CTOR");
    expect(abbreviationOf("MRR")).toBe("MRR");
    expect(abbreviationOf("LTV/CAC")).toBe("LTV/CAC");
    expect(abbreviationOf("Sesje")).toBe("Sesje");
    expect(abbreviationOf("Współczynnik zaangażowania")).toBe("Współczynnik zaangażowania");
  });
});
