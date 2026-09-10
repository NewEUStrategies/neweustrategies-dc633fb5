// Defensywne parsowanie konfiguracji wykresów/map z Json (bloki CMS i widgety
// buildera). Ten sam wzorzec co parseItems w InteractiveViews: String()/Number()
// koercja, twarde klamry, zero any.

import type { Json } from "@/lib/blocks/types";
import { BAR_STYLES, type BarStyle } from "./palette";
import { SMOOTHING_DEFAULT } from "./smooth";
import {
  CHART_KINDS,
  MAX_SERIES,
  type ChartConfig,
  type ChartMetric,
  type ChartKind,
  type ChartSeries,
  type DataMapConfig,
  type MapDatum,
  type MapRegion,
} from "./types";

export const CHART_HEIGHT_MIN = 160;
export const CHART_HEIGHT_MAX = 640;
export const CHART_HEIGHT_DEFAULT = 320;
/** Twardy limit kategorii - edytor CMS, nie hurtownia danych. */
export const MAX_CATEGORIES = 60;

function asRecord(raw: Json | undefined): Record<string, Json> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function num(raw: Json | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const v = Number(raw.replace(",", "."));
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

export function parseChartKind(raw: Json | undefined): ChartKind {
  const s = String(raw ?? "");
  return (CHART_KINDS as readonly string[]).includes(s) ? (s as ChartKind) : "bar";
}

export function parseChartSeries(raw: Json | undefined, categoriesCount: number): ChartSeries[] {
  if (!Array.isArray(raw)) return [];
  const out: ChartSeries[] = [];
  for (const item of raw.slice(0, MAX_SERIES)) {
    const o = asRecord(item);
    const valuesRaw = Array.isArray(o.values) ? o.values : [];
    const values: (number | null)[] = Array.from({ length: categoriesCount }, (_, i) =>
      num(valuesRaw[i]),
    );
    const slotRaw = num(o.colorSlot);
    out.push({
      name: String(o.name ?? ""),
      values,
      colorSlot:
        slotRaw !== null && slotRaw >= 1 && slotRaw <= MAX_SERIES
          ? Math.round(slotRaw)
          : out.length + 1,
    });
  }
  return out;
}

export function parseChartConfig(data: Record<string, Json>): ChartConfig {
  const categories = (Array.isArray(data.categories) ? data.categories : [])
    .slice(0, MAX_CATEGORIES)
    .map((c) => String(c ?? ""));
  const heightRaw = num(data.height);
  // `variant` (toolbar szybkiego przełączania w edytorze bloków) ma
  // pierwszeństwo nad `kind`; edytor utrzymuje oba klucze spójnie.
  const kindSource =
    typeof data.variant === "string" && data.variant !== "" ? data.variant : data.kind;
  return {
    kind: parseChartKind(kindSource),
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    categories,
    series: parseChartSeries(data.series, categories.length),
    stacked: data.stacked === true,
    unit: String(data.unit ?? ""),
    height: Math.max(
      CHART_HEIGHT_MIN,
      Math.min(CHART_HEIGHT_MAX, heightRaw ?? CHART_HEIGHT_DEFAULT),
    ),
    showLegend: data.showLegend !== false,
    showGrid: data.showGrid !== false,
    showValues: data.showValues === true,
    animate: data.animate !== false,
    source: String(data.source ?? ""),
    // Wygładzanie: brak klucza znaczy DOMYŚLNE 0,55, a nie zero. Wszystkie
    // wykresy zapisane przed wprowadzeniem tego pola dostają więc kształt
    // z nowej specyfikacji bez migracji danych - a autor, który świadomie
    // chce łamaną, zapisuje 0 i to zero jest respektowane.
    smoothing: clamp01(num(data.smoothing) ?? SMOOTHING_DEFAULT),
    barStyle: parseBarStyle(data.barStyle),
    forecastFrom: parseForecastFrom(data.forecastFrom, categories.length),
    forecastBandPct: Math.max(0, Math.min(100, num(data.forecastBandPct) ?? 0)),
    // n: zero jest wartością nieprawdziwą dla liczby obserwacji, więc
    // traktujemy je jak brak - inaczej podpis twierdziłby "n = 0" o wykresie,
    // który coś rysuje.
    sampleSize: positiveIntOrNull(num(data.sampleSize)),
    sourceDate: String(data.sourceDate ?? ""),
    notesShows: String(data.notesShows ?? ""),
    notesSurprising: String(data.notesSurprising ?? ""),
    notesHidden: String(data.notesHidden ?? ""),
    metric: parseChartMetric(data.metric),
  };
}

/**
 * Wyjaśnienie wskaźnika. Zwraca null, gdy autor nie podał NAZWY - bez nazwy
 * nie ma czego zaczepić ikony, a tooltip z pustym nagłówkiem i pięcioma
 * pustymi polami jest gorszy niż jego brak. Pozostałe pola mogą zostać puste
 * i wtedy po prostu nie są rysowane: lepiej trzy wypełnione pola w stałych
 * miejscach niż zmyślone pięć.
 */
export function parseChartMetric(raw: Json | undefined): ChartMetric | null {
  const o = asRecord(raw);
  const name = String(o.name ?? "").trim();
  if (!name) return null;
  return {
    name,
    expansion: String(o.expansion ?? "").trim(),
    formula: String(o.formula ?? "").trim(),
    measures: String(o.measures ?? "").trim(),
    reading: String(o.reading ?? "").trim(),
    levers: String(o.levers ?? "").trim(),
    caution: String(o.caution ?? "").trim(),
  };
}

/**
 * Pełny config o wartościach domyślnych - punkt wyjścia dla paneli, które
 * budują wykres W KODZIE, a nie z Json (dashboardy newslettera, audytorium,
 * podgląd arkusza w edytorze). Bez tego każdy taki panel musiałby wypisać
 * wszystkie pola i przy dopisaniu kolejnego przestawałby się kompilować -
 * albo, co gorsza, ktoś rozluźniłby typ i panel zacząłby renderować wykres
 * z niezdefiniowanymi ustawieniami uczciwości.
 *
 * FUNKCJA, NIE STAŁA: config trzyma tablice (`categories`, `series`), więc
 * współdzielona stała rozniosłaby jedną tablicę po wszystkich panelach.
 */
export function defaultChartConfig(): ChartConfig {
  return parseChartConfig({});
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function positiveIntOrNull(value: number | null): number | null {
  if (value === null) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

/**
 * Indeks pierwszej kategorii prognozowanej. Zero jest ODRZUCANE świadomie:
 * wykres, którego cały szereg jest prognozą, nie ma historii, od której
 * prognozę odróżnia - separator stałby na lewej krawędzi i nie mówiłby nic.
 * Taki wykres autor opisuje jako prognozę w tytule, nie strefą.
 */
function parseForecastFrom(raw: Json | undefined, categoriesCount: number): number | null {
  const value = num(raw);
  if (value === null) return null;
  const index = Math.round(value);
  if (index < 1 || index > categoriesCount - 1) return null;
  return index;
}

const ISO2_RE = /^[A-Z]{2}$/;

export function parseMapValues(raw: Json | undefined): MapDatum[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: MapDatum[] = [];
  for (const item of raw) {
    const o = asRecord(item);
    const id = String(o.id ?? "").toUpperCase();
    const value = num(o.value);
    if (!ISO2_RE.test(id) || value === null || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, value });
  }
  return out;
}

export function parseDataMapConfig(data: Record<string, Json>): DataMapConfig {
  const regionRaw = String(data.region ?? "");
  const region: MapRegion = regionRaw === "world" ? "world" : "europe";
  return {
    region,
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    unit: String(data.unit ?? ""),
    values: parseMapValues(data.values),
    showLegend: data.showLegend !== false,
    animate: data.animate !== false,
    source: String(data.source ?? ""),
  };
}

/**
 * Wariant wypełnienia słupka. Nieznany zapis wraca do wariantu bladego, a nie
 * rzuca: konfiguracja bloku pochodzi z treści, więc musi znieść zapis
 * z przyszłej albo cofniętej wersji edytora bez wywracania strony.
 */
export function parseBarStyle(raw: Json | undefined): BarStyle {
  const value = typeof raw === "string" ? raw : "";
  return (BAR_STYLES as readonly string[]).includes(value) ? (value as BarStyle) : "pale";
}
