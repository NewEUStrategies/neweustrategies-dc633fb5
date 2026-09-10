// Typy silnika wykresów (SVG, zero zależności runtime).
// Konfiguracja pochodzi z bloków CMS / widgetów buildera (Json) i jest
// defensywnie parsowana w parse.ts - komponenty widzą wyłącznie te typy.

export type ChartKind = "line" | "area" | "bar" | "bar-horizontal" | "pie" | "donut" | "waterfall";

export const CHART_KINDS: readonly ChartKind[] = [
  "line",
  "area",
  "bar",
  "bar-horizontal",
  "pie",
  "donut",
  "waterfall",
];

/** Maksymalna liczba serii = liczba slotów palety (--chart-1..8). */
export const MAX_SERIES = 8;

/**
 * Ile slotów jest rozdzielnych dla KAŻDEGO rodzaju widzenia barw. Powyżej tej
 * liczby kolor przestaje nieść kategorię: silnik dokłada kreskowanie, a edytor
 * ostrzega, żeby grupować albo iść w small multiples. Liczba jest wyprowadzona
 * z pomiaru, nie z gustu - patrz `src/lib/charts/palette.ts`.
 */
export const CATEGORICAL_SAFE_SERIES = 6;

/**
 * Powyżej tylu kategorii tarcza kołowa kłamie strukturalnie: koduje kątem
 * i powierzchnią, czyli kanałami z dolnej połowy hierarchii percepcyjnej,
 * a przy większej liczbie wycinków czytelnik nie porówna już żadnej pary.
 * Nadmiar zwija się w jeden wycinek zbiorczy (patrz `pieModel`), więc żadna
 * liczba nie ginie - pełne wartości niesie tabela danych.
 */
export const PIE_MAX_SLICES = 5;

export interface ChartSeries {
  name: string;
  /** null = luka w danych (linia się przerywa, słupek znika). */
  values: (number | null)[];
  /** Slot koloru 1..8; domyślnie pozycja serii. */
  colorSlot: number;
}

import type { BarStyle } from "./palette";

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

  /**
   * Siła wygładzenia linii, 0..1. Monotoniczny Hermite, nie Catmull-Rom -
   * patrz `src/lib/charts/smooth.ts`. 0 wyłącza wygładzanie (prawdziwe skoki
   * w szeregu, dokument techniczny); poniżej czterech punktów silnik wyłącza
   * je sam, bo krzywa opowiadałaby o kształcie, którego dane nie potwierdzają.
   */
  smoothing: number;
  /**
   * Wariant wypełnienia słupka. Domyślnie blady (obwódka mocna, wnętrze
   * blade); silnik zejdzie do solidnego sam wszędzie, gdzie blade wnętrze
   * przestaje wystarczać - patrz `resolveBarStyle`.
   */
  barStyle: BarStyle;

  /**
   * Indeks PIERWSZEJ kategorii prognozowanej albo null, gdy cały szereg jest
   * historią. Prognoza musi być odróżniona wizualnie od pomiaru: linia
   * przerywana, pionowy separator z etykietą i pasmo niepewności. Bez tego
   * wykres podaje interpolację za dane.
   */
  forecastFrom: number | null;

  /**
   * Połowa szerokości pasma niepewności prognozy, w procentach wartości
   * (0 = brak pasma). Sama linia prognozy bez pasma sugeruje pewność, której
   * nie ma - dlatego przy włączonej prognozie edytor podpowiada wartość.
   */
  forecastBandPct: number;

  /**
   * Liczba obserwacji na szereg. Wykres na trzech i na trzystu obserwacjach
   * wygląda tak samo, a znaczy co innego - dlatego `n` jedzie w podpisie.
   * null = autor nie podał.
   */
  sampleSize: number | null;

  /** Data danych (nie data publikacji wpisu) - do podpisu. */
  sourceDate: string;

  /**
   * Trzy zdania pod wykresem: co pokazuje, co jest zaskakujące, czego NIE
   * pokazuje. Ostatnie odróżnia wykres analityczny od ilustracji, więc jest
   * osobnym polem, a nie akapitem w opisie - inaczej nikt go nie napisze.
   */
  notesShows: string;
  notesSurprising: string;
  notesHidden: string;

  /**
   * Wyjaśnienie wskaźnika do tooltipa objaśniającego. null = wykres nie
   * potrzebuje wyjaśnienia (np. bezwzględne kwoty). Patrz `ChartMetric`.
   */
  metric: ChartMetric | null;
}

/**
 * Tooltip OBJAŚNIAJĄCY - druga, całkowicie osobna funkcja od tooltipa danych.
 * Tooltip danych mówi ILE; ten mówi CO TO ZNACZY i wisi przy nazwie
 * wskaźnika, nie nad punktem.
 *
 * PIĘĆ PÓL O STAŁEJ KOLEJNOŚCI, i to jest cała wartość tej struktury:
 * czytelnik, który raz zobaczył jeden taki tooltip, wie, gdzie w następnym
 * szukać progu interpretacyjnego. Dowolna kolejność albo "opis" w jednym
 * akapicie tego nie daje.
 *
 * Treść jest AUTORSKA, nie słownikowa, i dlatego siedzi w konfiguracji bloku,
 * a nie w słowniku i18n: blok wpisu jest już pisany w języku wpisu (tytuły,
 * kategorie, nazwy serii), więc wyjaśnienie wskaźnika idzie tą samą drogą.
 * Ze słownika pochodzą wyłącznie NAZWY pól (wzór, mierzy, czytanie,
 * dźwignie, uwaga) - te są niezależne od wskaźnika.
 */
export interface ChartMetric {
  /** Skrót, przy którym staje ikona - np. "ROIC". */
  name: string;
  /** Rozwinięcie skrótu i tłumaczenie - pierwszy wiersz tooltipa. */
  expansion: string;
  formula: string;
  measures: string;
  /** Jak czytać: z czym porównywać, gdzie są progi. */
  reading: string;
  /** Co realnie tym wskaźnikiem rusza. */
  levers: string;
  /** Na co uważać przy porównaniach. */
  caution: string;
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

/**
 * Metadane projekcji + dopasowania osadzone w zasobie przez generator
 * (scripts/generate-geo-maps.ts). Pozwalają rzutować dowolne lon/lat
 * (korytarze, markery miast) na TEN SAM canvas co geometria krajów:
 * px = (raw - min) * scale + padding, gdzie raw = projekcja z odwróconym y.
 */
export interface GeoProjectionMeta {
  type: "laea" | "naturalEarth1";
  /** Środek LAEA - tylko dla type "laea". */
  lat0?: number;
  lon0?: number;
  minX: number;
  minY: number;
  scale: number;
  padding: number;
}

export interface GeoAsset {
  v: 1;
  license: string;
  viewBox: string;
  /** Opcjonalne (starsze zcache'owane kopie zasobu mogą go nie mieć). */
  proj?: GeoProjectionMeta;
  countries: GeoAssetCountry[];
}

export const GEO_ASSET_URL: Record<MapRegion, string> = {
  europe: "/geo/europe-50m.v1.json",
  world: "/geo/world-110m.v1.json",
};
