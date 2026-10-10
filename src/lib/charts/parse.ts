// Defensywne parsowanie konfiguracji wykresów/map z Json (bloki CMS i widgety
// buildera). Ten sam wzorzec co parseItems w InteractiveViews: String()/Number()
// koercja, twarde klamry, zero any.

import type { Json } from "@/lib/blocks/types";
import { BAR_STYLES, type BarStyle } from "./palette";
import { SMOOTHING_DEFAULT } from "./smooth";
import {
  CHART_KINDS,
  isChartKind,
  isMapMethod,
  isMapRegion,
  isMapScheme,
  MAP_CLASSES_MAX,
  MAP_CLASSES_MIN,
  MAX_COLOR_SLOT,
  MAX_SERIES,
  type ChartConfig,
  type ChartMetric,
  type ChartKind,
  type ChartSeries,
  type DataMapConfig,
  type MapDatum,
  type MapRegion,
} from "./types";
import { slotForSeries } from "@/lib/charts/palette";
import { isChartPalette } from "./seriesStyle";
import { isMetricDirection, type ChartBand, type ChartTarget } from "./status";
import { isProvenance, isReliability, MAX_CHART_SOURCES, type ChartSource } from "./sources";

export const CHART_HEIGHT_MIN = 160;
export const CHART_HEIGHT_MAX = 640;
export const CHART_HEIGHT_DEFAULT = 320;
/** Twardy limit kategorii - edytor CMS, nie hurtownia danych. */
export const MAX_CATEGORIES = 60;

function asRecord(raw: Json | undefined): Record<string, Json> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

/**
 * Pole tekstowe konfiguracji. Napis zostaje napisem, liczba (np. jednostka
 * zapisana jako 2026) - jej zapisem dziesiętnym; obiekt, tablica albo
 * `true` to śmieć z uszkodzonej albo obcej treści i daje pusty napis.
 * Wcześniej `String(...)` wypisywał czytelnikowi „[object Object]" pod
 * wykresem i mapą.
 */
function text(raw: Json | undefined): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return "";
}

function num(raw: Json | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    // Pola tekstowe panelu (cel, pasmo, środek skali mapy) przyjmują zapis
    // z arkusza: spacja (także twarda i wąska) grupuje tysiące, a minus bywa
    // znakiem U+2212. Bez tego „1 234,5" i „−3" cicho stawały się brakiem.
    const v = Number(
      raw
        .replace(/[\s\u00a0\u202f]/g, "")
        .replace("\u2212", "-")
        .replace(",", "."),
    );
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
  const series = parseChartSeries(data.series, categories.length);
  return {
    kind: parseChartKind(kindSource),
    title: text(data.title),
    description: text(data.description),
    categories,
    series,
    stacked: data.stacked === true,
    unit: text(data.unit),
    height: Math.max(
      CHART_HEIGHT_MIN,
      Math.min(CHART_HEIGHT_MAX, heightRaw ?? CHART_HEIGHT_DEFAULT),
    ),
    showLegend: data.showLegend !== false,
    showGrid: data.showGrid !== false,
    showValues: data.showValues === true,
    animate: data.animate !== false,
    source: text(data.source),
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
    sourceDate: text(data.sourceDate),
    notesShows: text(data.notesShows),
    notesSurprising: text(data.notesSurprising),
    notesHidden: text(data.notesHidden),
    metric: parseChartMetric(data.metric),
    // Brak klucza = paleta ze specyfikacji (akcent + neutralne). Paletę
    // kategorialną autor wybiera jawnie - wtedy wracają kolory slotów.
    palette: isChartPalette(data.palette) ? data.palette : "focus",
    accentSeries: parseAccentSeries(data.accentSeries, series.length),
    accentCategory: parseAccentCategory(data.accentCategory, categories.length),
    band: parseChartBand(data.band),
    target: parseChartTarget(data.target),
    direction: isMetricDirection(data.direction) ? data.direction : null,
    provenance: isProvenance(data.provenance) ? data.provenance : null,
    demo: data.demo === true,
    sources: parseChartSources(data.sources),
    caption: text(data.caption),
  };
}

/**
 * Seria wyróżniona. Indeks spoza listy serii wraca do ZERA, a nie do
 * ostatniej serii: zapis wskazujący serię, której już nie ma (autor usunął
 * kolumnę), nie może przenieść akcentu na serię przypadkową - zero jest
 * zachowaniem sprzed wprowadzenia pola, więc jest jedynym neutralnym wyborem.
 */
export function parseAccentSeries(raw: Json | undefined, seriesCount: number): number {
  const value = num(raw);
  if (value === null) return 0;
  const index = Math.round(value);
  return index >= 0 && index < seriesCount ? index : 0;
}

/**
 * Wyróżniona kategoria tarczy. Brak, pusty napis albo indeks spoza listy
 * kategorii dają null - wtedy akcent dostaje wycinek największy, co jest
 * regułą rysunku, a nie wyborem, który trzeba by zapamiętać.
 */
export function parseAccentCategory(raw: Json | undefined, categoriesCount: number): number | null {
  const value = num(raw);
  if (value === null) return null;
  const index = Math.round(value);
  return index >= 0 && index < categoriesCount ? index : null;
}

/**
 * Pasmo optimum. Odwrócone krawędzie są zamieniane miejscami (autor wpisał
 * „4" i „2" - chodziło mu o przedział 2-4), a pasmo bez obu krawędzi
 * liczbowych nie istnieje. Źródło jest tylko WSKAZANIEM; czy pasmo wolno
 * narysować, rozstrzyga `effectiveBand` z listą źródeł w ręku.
 */
export function parseChartBand(raw: Json | undefined): ChartBand | null {
  const o = asRecord(raw);
  const a = num(o.min);
  const b = num(o.max);
  if (a === null || b === null) return null;
  const sourceId = String(o.sourceId ?? "").trim();
  return {
    min: Math.min(a, b),
    max: Math.max(a, b),
    sourceId: sourceId === "" ? null : sourceId,
    demo: o.demo === true,
  };
}

/** Linia celu: `{ value }` z bloku CMS albo sama liczba / napis liczbowy z widgetu. */
export function parseChartTarget(raw: Json | undefined): ChartTarget | null {
  const value = num(typeof raw === "number" || typeof raw === "string" ? raw : asRecord(raw).value);
  return value === null ? null : { value };
}

/**
 * Źródła wykresu. Wpis bez tytułu i bez adresu nie identyfikuje niczego,
 * więc odpada; identyfikator jest uzupełniany pozycją, gdy autor go nie
 * nadał - pasmo musi mieć na co wskazać. Duplikaty identyfikatora dostają
 * przyrostek, inaczej przypis wskazywałby dwa różne źródła naraz.
 */
export function parseChartSources(raw: Json | undefined): ChartSource[] {
  if (!Array.isArray(raw)) return [];
  const out: ChartSource[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, MAX_CHART_SOURCES)) {
    const o = asRecord(item);
    const title = String(o.title ?? "").trim();
    const url = String(o.url ?? "").trim();
    if (title === "" && url === "") continue;
    let id = String(o.id ?? "").trim() || `s${out.length + 1}`;
    while (seen.has(id)) id = `${id}-${out.length + 1}`;
    seen.add(id);
    out.push({
      id,
      author: String(o.author ?? "").trim(),
      title,
      container: String(o.container ?? "").trim(),
      publisher: String(o.publisher ?? "").trim(),
      published: String(o.published ?? "").trim(),
      accessed: String(o.accessed ?? "").trim(),
      url,
      reliability: isReliability(o.reliability) ? o.reliability : null,
    });
  }
  return out;
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

/**
 * Liczba klas mapy. Brak klucza, zero i liczba ujemna dają 0, czyli skalę
 * CIĄGŁĄ - to jest wygląd każdej mapy opublikowanej przed wprowadzeniem klas,
 * więc brak zapisu nie może jej przemalować. Liczba dodatnia jest dociskana
 * do 3..7: autor, który wpisał „2", prosił o klasy, a nie o skalę ciągłą.
 */
export function parseMapClasses(raw: Json | undefined): number {
  const value = num(raw);
  if (value === null) return 0;
  const rounded = Math.round(value);
  if (rounded <= 0) return 0;
  return Math.max(MAP_CLASSES_MIN, Math.min(MAP_CLASSES_MAX, rounded));
}

export function parseDataMapConfig(data: Record<string, Json>): DataMapConfig {
  return {
    region: parseMapRegion(data.region),
    title: text(data.title),
    description: text(data.description),
    unit: text(data.unit),
    values: parseMapValues(data.values),
    showLegend: data.showLegend !== false,
    animate: data.animate !== false,
    source: text(data.source),
    // Brak klucza = ramp sprzed wprowadzenia wyboru (te same kotwice co
    // `--chart-seq-min/max`), nieznany zapis z przyszłej wersji edytora też.
    scheme: isMapScheme(data.scheme) ? data.scheme : "blue",
    classes: parseMapClasses(data.classes),
    method: isMapMethod(data.method) ? data.method : "quantile",
    midpoint: num(data.midpoint),
    provenance: isProvenance(data.provenance) ? data.provenance : null,
    demo: data.demo === true,
    sources: parseChartSources(data.sources),
    caption: text(data.caption),
    sourceDate: text(data.sourceDate),
    // Ta sama reguła co przy wykresie: zero obserwacji nie jest podpisem.
    sampleSize: positiveIntOrNull(num(data.sampleSize)),
    notesShows: text(data.notesShows),
    notesSurprising: text(data.notesSurprising),
    notesHidden: text(data.notesHidden),
  };
}

/**
 * Pełny config mapy o wartościach domyślnych - odpowiednik
 * `defaultChartConfig` dla paneli, które budują mapę W KODZIE (pulpit
 * geograficzny). Funkcja, nie stała: config trzyma tablice.
 */
export function defaultDataMapConfig(): DataMapConfig {
  return parseDataMapConfig({});
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
