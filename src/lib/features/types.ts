// Typy modułu NES Digital Features - interaktywne "digital features" w stylu
// CSIS (oś czasu, sankey, porównywarka państw, macierz ryzyka, karta
// wskaźnika, sieć powiązań, mapa korytarzy, biblioteka źródeł, nota
// metodologiczna). Konfiguracja pochodzi z widgetów buildera (Json) i jest
// defensywnie parsowana w parse.ts - komponenty widzą wyłącznie te typy.
//
// Konwencja i18n danych: pola tekstowe wewnątrz wierszy danych używają
// zapisu "PL|EN" w jednej komórce (liczby żyją raz, tłumaczenie inline);
// tytuły/opisy/źródła widgetu to zwykłe pola *_pl/_en rozwiązywane w
// adapterze buildera.

/** Tekst dwujęzyczny z komórki "PL|EN"; en spada do pl gdy brak "|". */
export interface BiText {
  pl: string;
  en: string;
}

export type FeatureLang = "pl" | "en";

export const pickBi = (t: BiText, lang: FeatureLang): string =>
  lang === "en" ? t.en || t.pl : t.pl || t.en;

/** Wspólna rama opisowa widgetu (tytuł/opis/źródło już rozwiązane per język). */
export interface FeatureFrameConfig {
  title: string;
  description: string;
  source: string;
}

// ---------- Oś czasu ----------

export interface TimelineEvent {
  /** Etykieta daty pokazywana wprost (np. "2026-03", "III kw. 2026"). */
  date: string;
  title: BiText;
  description: BiText;
  /** Slot koloru 1..8 (--chart-N); null = kolor marki. */
  colorSlot: number | null;
}

export interface TimelineConfig extends FeatureFrameConfig {
  events: TimelineEvent[];
  animate: boolean;
}

// ---------- Sankey (przepływy) ----------

export interface SankeyFlow {
  from: BiText;
  to: BiText;
  value: number;
}

export interface SankeyConfig extends FeatureFrameConfig {
  flows: SankeyFlow[];
  unit: string;
  height: number;
  animate: boolean;
}

// ---------- Porównywarka państw ----------

export interface CompareRow {
  /** Nazwa wskaźnika; jednostka w nawiasie kwadratowym "[%]" jest wyodrębniana. */
  indicator: BiText;
  unit: string;
  /** null = brak danych w kolumnie. */
  values: (number | null)[];
}

export interface CountryCompareConfig extends FeatureFrameConfig {
  /** Nagłówki kolumn (kody ISO-2 lub etykiety "Polska|Poland"). */
  columns: BiText[];
  rows: CompareRow[];
  /** Wyróżniona kolumna (indeks) lub null. */
  highlight: number | null;
  showBars: boolean;
}

// ---------- Macierz ryzyka ----------

export interface RiskItem {
  name: BiText;
  description: BiText;
  /** Prawdopodobieństwo 1..5. */
  likelihood: number;
  /** Wpływ 1..5. */
  impact: number;
}

export interface RiskMatrixConfig extends FeatureFrameConfig {
  items: RiskItem[];
  axisXLabel: string;
  axisYLabel: string;
  animate: boolean;
}

// ---------- Karta wskaźnika ----------

export type DeltaArrow = "up" | "down" | "none";
export type DeltaTone = "positive" | "negative" | "neutral";

export interface IndicatorCardConfig {
  label: string;
  /** Wartość jako tekst (formatowanie należy do redakcji, np. "38,2"). */
  value: string;
  unit: string;
  delta: string;
  deltaLabel: string;
  deltaArrow: DeltaArrow;
  deltaTone: DeltaTone;
  /** Dane sparkline (może być puste). */
  spark: number[];
  source: string;
  href: string;
}

// ---------- Sieć powiązań ----------

export interface NetworkEdge {
  a: BiText;
  b: BiText;
  /** Siła 1..5 (grubość krawędzi). */
  strength: number;
  label: BiText;
}

export interface NetworkGroupAssignment {
  node: BiText;
  group: BiText;
}

export interface RelationNetworkConfig extends FeatureFrameConfig {
  edges: NetworkEdge[];
  groups: NetworkGroupAssignment[];
  height: number;
  animate: boolean;
}

// ---------- Mapa korytarzy ----------

export interface CorridorPoint {
  lat: number;
  lon: number;
}

export interface Corridor {
  name: BiText;
  /** Slot koloru 1..8. */
  colorSlot: number;
  points: CorridorPoint[];
}

export interface CorridorMarker extends CorridorPoint {
  label: BiText;
}

export interface CorridorMapConfig extends FeatureFrameConfig {
  region: "europe" | "world";
  corridors: Corridor[];
  markers: CorridorMarker[];
  /** Kody ISO-2 krajów do podświetlenia. */
  highlightCountries: string[];
  animate: boolean;
}

// ---------- Biblioteka źródeł ----------

export interface SourceEntry {
  /** Typ źródła - klucz filtra (np. "raport", "dane", "traktat"). */
  kind: BiText;
  year: string;
  title: BiText;
  publisher: BiText;
  url: string;
}

export interface SourceLibraryConfig extends FeatureFrameConfig {
  entries: SourceEntry[];
  /** Sortowanie: authored (kolejność wpisów) lub year-desc. */
  sort: "authored" | "year-desc";
  showSearch: boolean;
}

// ---------- Nota metodologiczna ----------

export interface MethodologyNoteConfig {
  title: string;
  version: string;
  updated: string;
  /** Zsanityzowany HTML treści (sanityzacja po stronie widoku). */
  html: string;
  defaultOpen: boolean;
}
