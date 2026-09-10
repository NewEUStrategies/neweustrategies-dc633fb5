// Uczciwość wykresu, policzona zamiast obiecanej.
//
// Wykres łatwiej kłamie niż tabela, bo działa szybciej niż świadoma kontrola.
// Część z tych kłamstw da się WYKRYĆ ARYTMETYCZNIE - i wtedy nie ma sensu
// liczyć na czujność autora ani na listę kontrolną w dokumencie. Ten moduł
// trzyma te sprawdzenia jako czyste funkcje, a rama wykresu wypisuje ich
// wynik pod rysunkiem.
import { niceScale, seriesExtent } from "./scale";
import { valueTickTarget } from "./geometry";
import type { ChartConfig, ChartSeries } from "./types";

/** Serie, które cokolwiek rysują - reszta nie wpływa na domenę. */
function drawableSeries(config: ChartConfig): ChartSeries[] {
  return config.series.filter((s) => s.values.some((v) => v !== null));
}

/**
 * Czy oś wartości NIE obejmuje zera.
 *
 * Dla słupków pytanie nie istnieje: ich domena zawsze obejmuje zero
 * (`includeZero`), bo długość koduje wartość i ucięta oś wprost zniekształca
 * proporcję. Dla linii zero nie jest wymagane - linia koduje POŁOŻENIE, nie
 * długość - ale ucięcie musi być NAZWANE, bo różnice wyglądają wtedy na
 * większe niż są.
 *
 * Liczone tą samą skalą, którą rysuje silnik (wspólny `valueTickTarget`),
 * więc podpis nie może twierdzić czegoś innego niż podziałki na obrazku.
 */
export function isZeroBaselineBroken(config: ChartConfig): boolean {
  if (config.kind !== "line" && config.kind !== "area") return false;
  const series = drawableSeries(config);
  if (series.length === 0) return false;
  const extent = seriesExtent(series, config.categories.length, {
    stacked: false,
    includeZero: false,
  });
  const scale = niceScale(extent.min, extent.max, valueTickTarget(config.height, false));
  return scale.min > 0 || scale.max < 0;
}

/**
 * Czy wykres prosi o pasmo niepewności i go nie ma. Sama linia prognozy
 * sugeruje pewność, której nie ma - to jest ten sam gatunek błędu co ucięta
 * oś, tylko trudniejszy do zauważenia, bo brakuje czegoś, a nie jest coś
 * przekłamane.
 */
export function isForecastMissingBand(config: ChartConfig): boolean {
  return config.forecastFrom !== null && !(config.forecastBandPct > 0);
}

/**
 * Ile serii przekracza zestaw rozdzielny dla daltonizmu. 0 = w normie.
 * Zwracamy LICZBĘ, nie flagę, bo edytor pokazuje ją w ostrzeżeniu.
 */
export function seriesOverSafePalette(config: ChartConfig, safeMax: number): number {
  return Math.max(0, drawableSeries(config).length - safeMax);
}
