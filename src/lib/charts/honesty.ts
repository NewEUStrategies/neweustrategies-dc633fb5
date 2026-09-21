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
/**
 * Kiedy pierścień jest ZŁYM WYBOREM formy - trzy granice, wszystkie policzalne.
 *
 * Kąt i powierzchnia siedzą w dolnej połowie hierarchii percepcyjnej
 * Clevelanda i McGilla, więc pierścień nigdy nie służy do PORÓWNYWANIA
 * udziałów - służy do pokazania, że coś jest częścią całości, a porównanie
 * robi wpisana w łuk liczba. Z tego wynikają trzy przypadki, w których lepszą
 * formą jest coś innego:
 *
 *   * `tooFew` - dwa albo trzy segmenty. Pierścień dwuelementowy to koło
 *     z dziurą; miernik albo jeden słupek 100% mówi to samo w jednej linijce
 *     i bez pytania czytelnika o kąt;
 *   * `tooClose` - udziały różniące się o mniej niż trzy punkty procentowe.
 *     Pierścień pokaże je jako IDENTYCZNE, więc struktura, którą miał
 *     pokazać, ginie; słupki poziome porównują długością, a długość jest
 *     najwyżej w hierarchii percepcyjnej;
 *   * `tooMany` - więcej kategorii, niż pierścień unosi. Powyżej limitu
 *     grupuj albo weź słupek skumulowany 100%.
 *
 * FUNKCJA CZYSTA I BEZ `ChartConfig`, i to jest tu istotne. Mianownik udziału
 * (suma DODATNICH) jest rozstrzygnięciem modelu tarczy, a nie regułą
 * uczciwości - policzenie go po raz drugi w tym module dałoby dwa źródła
 * prawdy o tym, co tarcza w ogóle rysuje. Wywołujący podaje więc udziały już
 * policzone modelem; ten moduł odpowiada wyłącznie na pytanie o FORMĘ.
 */
export type PieFormAdvice = "tooFew" | "tooClose" | "tooMany";

/** Poniżej tej różnicy udziałów (w punktach procentowych) łuki są nieodróżnialne. */
export const PIE_CLOSE_SHARES_PP = 3;

/**
 * Udział, poniżej którego wycinek jest drzazgą i nie wchodzi do porównania par.
 *
 * Bez tego progu ostrzeżenie `tooClose` odpalałoby na KAŻDYM rozkładzie
 * z długim ogonem: dwie kategorie po 0,5% różnią się o pół punktu, więc formalnie
 * są "nieodróżnialne" - tylko że obie są widocznie znikome i czytelnik nie ma
 * potrzeby ich porównywać. Ostrzeżenie, które widać zawsze, uczy ignorowania
 * wszystkich ostrzeżeń; to ta sama decyzja, którą edytor podjął przy kolizji
 * ochry z akcentem.
 */
export const PIE_SLIVER_SHARE = 0.05;

export function pieFormAdvice(
  shares: readonly number[],
  opts: { positives: number; maxSlices: number },
): PieFormAdvice[] {
  const advice: PieFormAdvice[] = [];
  if (opts.positives === 0) return advice;
  if (opts.positives <= 3) advice.push("tooFew");
  else if (opts.positives > opts.maxSlices) advice.push("tooMany");
  // Pary liczone tylko wśród wycinków, które czytelnik realnie porównuje.
  const znaczace = shares.filter((s) => s >= PIE_SLIVER_SHARE);
  // RÓŻNICA LICZONA NA JEDNYM MIEJSCU PO PRZECINKU, czyli na dokładności,
  // z jaką udział jest WYŚWIETLANY. Nie jest to kosmetyka: 0,36 - 0,33 daje
  // w podwójnej precyzji 2,9999999999999996 punktu, więc porównanie surowe
  // odpalało ostrzeżenie na parze różniącej się dokładnie o próg. Próg jest
  // granicą nieodróżnialności par, które czytelnik WIDZI, więc liczymy go na
  // tych samych liczbach, które widzi.
  const punkty = (a: number, b: number): number => Math.round(Math.abs(a - b) * 1000) / 10;
  const blisko = znaczace.some((a, i) =>
    znaczace.some((b, j) => i !== j && punkty(a, b) < PIE_CLOSE_SHARES_PP),
  );
  if (blisko) advice.push("tooClose");
  return advice;
}
