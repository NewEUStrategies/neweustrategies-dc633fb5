// Typy silnika wykresów (SVG, zero zależności runtime).
// Konfiguracja pochodzi z bloków CMS / widgetów buildera (Json) i jest
// defensywnie parsowana w parse.ts - komponenty widzą wyłącznie te typy.

export type ChartKind = "line" | "area" | "bar" | "bar-horizontal" | "pie" | "donut";

export const CHART_KINDS: readonly ChartKind[] = [
  "line",
  "area",
  "bar",
  "bar-horizontal",
  "pie",
  "donut",
];

/** Maksymalna liczba serii = liczba slotów palety (--chart-1..8). */
export const MAX_SERIES = 8;

export interface ChartSeries {
  name: string;
  /** null = luka w danych (linia się przerywa, słupek znika). */
  values: (number | null)[];
  /** Slot koloru 1..8; domyślnie pozycja serii. */
  colorSlot: number;
}

export interface ChartConfig {
  kind: ChartKind;
  title: string;
  description: string;
  /** Etykiety osi X (kategorie / okresy). */
  categories: string[];
  series: ChartSeries[];
  /** Słupki/pola skumulowane (stacked). */
  stacked: boolean;
  /** Jednostka doklejana do wartości (np. "%", " mld EUR"). */
  unit: string;
  /** Wysokość pola rysunku w px (bez ramki/legendy). */
  height: number;
  showLegend: boolean;
  showGrid: boolean;
  /** Bezpośrednie etykiety wartości na znacznikach (selektywne). */
  showValues: boolean;
  /** Animacja wejścia przy pierwszym pojawieniu się w viewport. */
  animate: boolean;
  /** Podpis źródła danych (np. "Źródło: Eurostat 2026"). */
  source: string;
}

export type MapRegion = "europe" | "world";

export interface MapDatum {
  /** ISO 3166-1 alpha-2 (wielkie litery). */
  id: string;
  value: number;
}

export interface DataMapConfig {
  region: MapRegion;
  title: string;
  description: string;
  unit: string;
  values: MapDatum[];
  showLegend: boolean;
  animate: boolean;
  source: string;
}

/** Kształt statycznego zasobu geometrii z public/geo/*.v1.json. */
export interface GeoAssetCountry {
  id: string;
  pl: string;
  en: string;
  d: string;
}

export interface GeoAsset {
  v: 1;
  license: string;
  viewBox: string;
  countries: GeoAssetCountry[];
}

export const GEO_ASSET_URL: Record<MapRegion, string> = {
  europe: "/geo/europe-50m.v1.json",
  world: "/geo/world-110m.v1.json",
};
