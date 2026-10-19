// OBJAŚNIENIE METRYKI JAKO `ChartMetric` (SPEC §5.5) - jedno źródło treści
// dla `MetricDefinitionPopover`, `MetricTooltip`, `KpiTile`, `MetricDictionary`
// i `MetricExplainer`.
//
// DWA ŹRÓDŁA, JEDEN KSZTAŁT. Gdy metryka ma benchmark, objaśnienie bierzemy
// z niego (skrót, rozwinięcie, wzór, interpretacja, dźwignie, zastrzeżenia -
// treść zweryfikowana i dwujęzyczna). Bez benchmarku zostaje słownik metryk:
// etykieta, wzór powiązania AUTORYTATYWNEGO (to on daje liczbę w raporcie)
// i strażnicy jako „na co uważać”. Komponent nie wie, skąd przyszła treść.
//
// Moduł NIE jest eksportowany z beczki `index.ts` (beczka wciąga dashboard
// GA4) i nie importuje treści grup - benchmark podaje wywołujący, pobrany
// przez `getBenchmarkGroup`.
import type { ChartLang } from "@/lib/charts/format";
import type { ChartMetric } from "@/lib/charts/types";
import { bi, toChartMetric, type LocalizedBenchmark } from "./benchmarks/adapter";
import { authoritativeBinding, metricById, type MetricId } from "./metrics";

/**
 * Skrót z etykiety: pierwszy token pisany wielkimi literami („CTOR
 * newslettera” → „CTOR”, „LCP (p75)” → „LCP”), a gdy go nie ma - cała
 * etykieta („Sesje”). Ikona objaśnienia stoi przy skrócie, więc „Wskaźnik
 * zaangażowania” nie może zamienić się w „W”.
 */
export function abbreviationOf(label: string): string {
  const token = /(?:^|\s)([A-Z][A-Z0-9/&]{1,})(?=$|[\s(),.:;-])/.exec(label);
  return token ? token[1] : label;
}

/** Objaśnienie metryki: z benchmarku, gdy jest, inaczej ze słownika metryk. */
export function metricHelp(
  metricId: MetricId,
  lang: ChartLang,
  bench?: LocalizedBenchmark | null,
): ChartMetric {
  if (bench) return toChartMetric(bench);
  const def = metricById(metricId);
  const label = bi({ pl: def.labelPl, en: def.labelEn }, lang);
  return {
    name: abbreviationOf(label),
    expansion: label,
    formula: authoritativeBinding(metricId).formula,
    measures: bi({ pl: def.definitionPl, en: def.definitionEn }, lang),
    // Bez benchmarku nie ma zweryfikowanych progów ani dźwigni - puste pola
    // `MetricTooltip` pomija, zamiast pokazać zmyślone „jak czytać”.
    reading: "",
    levers: "",
    caution: def.guards.join(" "),
  };
}
