// STATUS WARTOŚCI WZGLĘDEM PRZEDZIAŁU OCENY i zmiana względem poprzedniego
// punktu. Czyste funkcje - liczą je tooltip, karta KPI, okno szczegółów
// i mapa statusów, więc reguła stoi w jednym miejscu.
//
// PRZEDZIAŁ BEZ ŹRÓDŁA NIE ISTNIEJE. Przedział oceny jest twierdzeniem
// („norma dla tego wskaźnika to 2-4%"), a twierdzenie bez przypisu jest
// zgadywaniem. Dlatego `effectiveBand` zwraca `null`, gdy autor nie wskazał
// źródła i nie oznaczył przedziału jako demonstracyjnego - wykres pokazuje
// wtedy „brak benchmarku", a nie pasmo, którego nikt nie potwierdził.
import { ROLE } from "./roles";

/** Kierunek wskaźnika: co jest dobre. */
export const METRIC_DIRECTIONS = ["higher", "lower", "range"] as const;
export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

export function isMetricDirection(raw: unknown): raw is MetricDirection {
  return typeof raw === "string" && (METRIC_DIRECTIONS as readonly string[]).includes(raw);
}

/** Pasmo optimum (przedział oceny) na osi wartości. */
export interface ChartBand {
  min: number;
  max: number;
  /** Identyfikator źródła z `ChartConfig.sources`; null = brak przypisu. */
  sourceId: string | null;
  /** Dane demonstracyjne - pasmo podpisane „optimum (demo)". */
  demo: boolean;
}

/** Linia celu. */
export interface ChartTarget {
  value: number;
}

export const RANGE_STATUSES = ["below", "within", "above", "better", "none"] as const;
export type RangeStatus = (typeof RANGE_STATUSES)[number];

/**
 * Pasmo, które WOLNO narysować i którym wolno oceniać: ze źródłem albo
 * jawnie demonstracyjne. Źródło musi istnieć na liście, nie tylko być
 * napisem - identyfikator wskazujący w próżnię jest tym samym co jego brak.
 */
export function effectiveBand(
  band: ChartBand | null,
  sourceIds: readonly string[],
): ChartBand | null {
  if (band === null) return null;
  if (band.demo) return band;
  if (band.sourceId !== null && sourceIds.includes(band.sourceId)) return band;
  return null;
}

/**
 * Status wartości względem przedziału.
 *
 * „Lepiej niż przedział" istnieje tylko dla wskaźnika kierunkowego: dla
 * konwersji wynik POWYŻEJ normy jest dobrą wiadomością, dla kosztu - wynik
 * PONIŻEJ. Dla wskaźnika przedziałowego („range") każde wyjście z pasma jest
 * odchyleniem.
 */
export function rangeStatus(
  value: number | null,
  band: Pick<ChartBand, "min" | "max"> | null,
  direction: MetricDirection | null,
): RangeStatus {
  if (band === null || value === null || !Number.isFinite(value)) return "none";
  if (value < band.min) return direction === "lower" ? "better" : "below";
  if (value > band.max) return direction === "higher" ? "better" : "above";
  return "within";
}

/**
 * Symbol statusu. „Lepiej niż przedział" bierze strzałkę POŁOŻENIA (wynik
 * jest nad albo pod pasmem), a dobrą wiadomość niesie kolor i słowo - symbol
 * mówi gdzie, nie czy dobrze.
 */
export function statusSymbol(
  status: RangeStatus,
  value: number | null,
  band: Pick<ChartBand, "min" | "max"> | null,
): string {
  switch (status) {
    case "below":
      return "▼";
    case "above":
      return "▲";
    case "within":
      return "✓";
    case "none":
      return "?";
    case "better":
      return band !== null && value !== null && value < band.min ? "▼" : "▲";
  }
}

/**
 * Kolor statusu. Mapa ciepła statusów maluje „w normie" dodatnim, bo tam
 * kolor JEST odpowiedzią na pytanie „czy wszystko w porządku"; na wykresie
 * liniowym „w normie" jest tłem (łupek), a uwagę bierze odchylenie.
 */
export function statusColor(status: RangeStatus, surface: "chart" | "heatmap" = "chart"): string {
  switch (status) {
    case "below":
      return ROLE.neg;
    case "within":
      return surface === "heatmap" ? ROLE.pos : ROLE.sMain;
    case "above":
      return ROLE.warn;
    case "better":
      return ROLE.pos;
    case "none":
      return ROLE.sAlt;
  }
}

/** Kolor NAPISU statusu (próg 4,5:1). */
export function statusTextColor(status: RangeStatus): string {
  switch (status) {
    case "below":
      return ROLE.negText;
    case "within":
      return ROLE.sMain;
    case "above":
      return ROLE.warn;
    case "better":
      return ROLE.posText;
    case "none":
      return ROLE.sAltText;
  }
}

/**
 * Zmiana procentowa względem poprzedniego punktu. `null`, gdy nie ma
 * poprzedniego punktu albo jest zerem - procent od zera nie istnieje, a „+∞%"
 * byłoby liczbą udającą informację.
 */
export function percentChange(previous: number | null, current: number | null): number | null {
  if (previous === null || current === null) return null;
  if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Ocena zmiany: czy ruch w tę stronę jest dla tego wskaźnika dobry. */
export type ChangeTone = "good" | "bad" | "neutral";

export function changeTone(change: number | null, direction: MetricDirection | null): ChangeTone {
  if (change === null || change === 0 || direction === null || direction === "range") {
    return "neutral";
  }
  const up = change > 0;
  return (direction === "higher") === up ? "good" : "bad";
}

/** Kolor tonu zmiany - tekstowy, bo zmiana jest zawsze napisem. */
export function changeToneColor(tone: ChangeTone): string {
  return tone === "good" ? ROLE.posText : tone === "bad" ? ROLE.negText : ROLE.ink3;
}

/** Strzałka zmiany: ▲ wzrost, ▼ spadek, ■ bez zmian. */
export function changeArrow(change: number | null): string {
  if (change === null || change === 0) return "■";
  return change > 0 ? "▲" : "▼";
}

/**
 * Domena wartości, którą oś MUSI objąć poza samymi danymi: krawędzie pasma
 * i linia celu. Pasmo przycięte krawędzią rysunku twierdziłoby, że norma
 * kończy się tam, gdzie kończy się obszar kreślenia.
 */
export function referenceExtent(
  band: Pick<ChartBand, "min" | "max"> | null,
  target: ChartTarget | null,
): { min: number; max: number } | null {
  const values: number[] = [];
  if (band !== null) values.push(band.min, band.max);
  if (target !== null) values.push(target.value);
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * Klucze słownika (prefiks `charts.`) - JAWNIE, nie sklejane z wartości
 * unii. Bramka rozjazdu kod-słownik czyta wyłącznie pełne ścieżki, więc klucz
 * sklejony szablonem byłby dla niej niewidoczny; mapa wyczerpująca nie
 * skompiluje się bez wpisu dla nowego statusu.
 */
export const STATUS_KEYS: Record<RangeStatus, string> = {
  below: "status.below",
  within: "status.within",
  above: "status.above",
  better: "status.better",
  none: "status.none",
};

export const DIRECTION_KEYS: Record<MetricDirection, string> = {
  higher: "direction.higher",
  lower: "direction.lower",
  range: "direction.range",
};

/**
 * Zdanie „Znaczenie" dla statusu i kierunku. Kierunek nieznany czyta się
 * jak przedziałowy: bez deklaracji autora nie wolno twierdzić, że wyjście
 * z pasma w którąkolwiek stronę jest dobre.
 */
export function meaningKey(status: RangeStatus, direction: MetricDirection | null): string {
  switch (status) {
    case "below":
      return direction === "higher" ? "meaning.belowHigher" : "meaning.belowRange";
    case "above":
      return direction === "lower" ? "meaning.aboveLower" : "meaning.aboveRange";
    case "within":
      return "meaning.within";
    case "better":
      return direction === "lower" ? "meaning.betterLower" : "meaning.betterHigher";
    case "none":
      return "meaning.none";
  }
}
