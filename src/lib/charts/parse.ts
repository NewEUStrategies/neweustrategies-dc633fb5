// Defensywne parsowanie konfiguracji wykresów/map z Json (bloki CMS i widgety
// buildera). Ten sam wzorzec co parseItems w InteractiveViews: String()/Number()
// koercja, twarde klamry, zero any.

import type { Json } from "@/lib/blocks/types";
import { BAR_STYLES, type BarStyle } from "./palette";
import { SMOOTHING_DEFAULT } from "./smooth";
import {
  CHART_KINDS,
  isChartKind,
  isMapRegion,
  MAX_COLOR_SLOT,
  MAX_SERIES,
  type ChartConfig,
  type ChartMetric,
  type ChartKind,
  type ChartSeries,
  type DataMapConfig,
  type MapColorMode,
  isMapColorMode,
  type MapDatum,
  type MapRegion,
} from "./types";
import { slotForSeries } from "@/lib/charts/palette";

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
        slotRaw !== null && slotRaw >= 1 && slotRaw <= MAX_COLOR_SLOT
          ? Math.round(slotRaw)
          : slotForSeries(out.length),
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
  // pierwszeństwo nad `kind`, ale WYŁĄCZNIE gdy jest znanym rodzajem wykresu.
  //
  // Wcześniej wygrywał każdy niepusty napis, a to jest defekt, bo `variant`
  // NIE JEST kluczem tego bloku: to generyczne pole wariantu STYLU, którego
  // inne rodzaje bloków używają na wartości w rodzaju "minimal". Blok wykresu
  // z `kind: "donut"` i odziedziczonym `variant: "minimal"` szedł więc przez
  // `parseChartKind("minimal")`, które degraduje nieznany zapis do słupków -
  // i pierścień cicho zamieniał się w kolumny, choć autor wybrał go wprost.
  //
  // Warunek "znany rodzaj" naprawia to bez odbierania toolbarowi funkcji:
  // gdy toolbar zapisze prawdziwy rodzaj, nadal wygrywa; gdy w polu siedzi
  // cokolwiek innego, decyduje `kind`, czyli jawny wybór autora.
  const kindSource = isChartKind(data.variant) ? data.variant : data.kind;
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
    forecastFromDeclared: parseDeclaredForecastFrom(data.forecastFrom),
    valuesBeyondCategories: countValuesBeyondCategories(data.series, categories.length),
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
 * Deklaracja granicy BEZ sprawdzania zakresu - do orzeczeń uczciwości.
 *
 * `parseForecastFrom` zwraca `null` i dla braku deklaracji, i dla deklaracji
 * nieużywalnej; model, który ma powiedzieć „granicę odrzucono", nie ma z czego
 * tych dwóch stanów odróżnić. Zaokrąglamy tak samo, żeby porównanie z wartością
 * użyteczną było porównaniem tej samej liczby.
 */
function parseDeclaredForecastFrom(raw: Json | undefined): number | null {
  const value = num(raw);
  return value === null ? null : Math.round(value);
}

/**
 * Ile liczb w seriach nie ma swojej kategorii.
 *
 * Liczone PRZED przycięciem, bo po przycięciu nadmiaru już nie ma - a to
 * właśnie o nim mają powiedzieć orzeczenia modeli. Granica `MAX_SERIES` jest
 * ta sama, co w `parseChartSeries`: seria, która i tak nie wejdzie do wykresu,
 * nie dokłada się do licznika liczb bez kategorii, bo jej brak ma własny
 * powód i własne zdanie.
 */
function countValuesBeyondCategories(raw: Json | undefined, categoriesCount: number): number {
  if (!Array.isArray(raw)) return 0;
  let out = 0;
  for (const item of raw.slice(0, MAX_SERIES)) {
    const values = asRecord(item).values;
    if (Array.isArray(values)) out += Math.max(0, values.length - categoriesCount);
  }
  return out;
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

/**
 * Kolor z treści albo `undefined`.
 *
 * PRZEPUSZCZAMY WYŁĄCZNIE `#rrggbb`, i to nie z pedanterii: ta wartość trafia
 * prosto do `fill` i do `color-mix()`, a treść bloku bierze się z bazy, więc
 * jest wejściem, którego nie pisaliśmy. Skrót `#abc` i nazwy CSS odpadają
 * świadomie - przy jednym dozwolonym zapisie porównanie „ile RÓŻNYCH barw
 * wybrał autor" jest porównaniem napisów, a nie zgadywanką, czy `#ff0000`,
 * `#f00` i `red` to trzy kolory czy jeden.
 */
function mapColor(raw: Json | undefined): string | undefined {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return /^#[0-9a-f]{6}$/.test(v) ? v : undefined;
}

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
    const color = mapColor(o.color);
    out.push(color === undefined ? { id, value } : { id, value, color });
  }
  return out;
}

/**
 * Tryb koloru z treści. Nieznany zapis wraca do rampy - tej samej ścieżki,
 * którą mapa jechała, zanim tryb ręczny w ogóle istniał, więc treść sprzed
 * tej zmiany (bez pola `colorMode`) rysuje się dokładnie jak dotąd.
 */
export function parseMapColorMode(raw: Json | undefined): MapColorMode {
  return isMapColorMode(raw) ? raw : "ramp";
}

/**
 * Barwa bazowa rampy. Pusty napis znaczy „jedź tokenami motywu" i jest
 * wartością DOMYŚLNĄ, nie awaryjną - zapis spoza `#rrggbb` też do niej wraca,
 * bo mapa bez koloru bazowego jest poprawna, a mapa z `fill: "javascript:…"`
 * nie jest.
 */
export function parseMapRampColor(raw: Json | undefined): string {
  return mapColor(raw) ?? "";
}

/**
 * Region mapy z zapisu w treści. Nieznany zapis wraca do Europy, a NIE rzuca -
 * tak samo, jak nieznany wariant słupka niżej: konfiguracja bloku pochodzi
 * z bazy i bywa z przyszłej albo cofniętej wersji edytora, a mapa jest blokiem
 * treści redakcyjnej, więc jej rzut wywraca cały wpis.
 *
 * Wcześniej stało tu `regionRaw === "world" ? "world" : "europe"`. To NIE JEST
 * ta sama funkcja: porównanie z dwoma literałami degraduje do Europy każdy
 * region, którego akurat nie wymieniono - więc po dopisaniu Azji do typu,
 * edytora i słownika mapa i tak rysowałaby Europę, bez jednego błędu
 * kompilacji po drodze.
 */
export function parseMapRegion(raw: Json | undefined): MapRegion {
  const value = String(raw ?? "");
  return isMapRegion(value) ? value : "europe";
}

export function parseDataMapConfig(data: Record<string, Json>): DataMapConfig {
  return {
    region: parseMapRegion(data.region),
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    unit: String(data.unit ?? ""),
    values: parseMapValues(data.values),
    showLegend: data.showLegend !== false,
    animate: data.animate !== false,
    source: String(data.source ?? ""),
    colorMode: parseMapColorMode(data.colorMode),
    rampColor: parseMapRampColor(data.rampColor),
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
