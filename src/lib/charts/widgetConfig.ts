// ADAPTER TREŚCI WIDGETU BUILDERA -> KONFIGURACJA SILNIKA WYKRESÓW I MAP.
//
// Widget trzyma ustawienia PŁASKO (pola `*_pl`/`*_en`, przełączniki "on"/"off",
// textarea CSV, jedno źródło pasma w polach `bandSource*`), a blok CMS - jako
// Json w kształcie konfiguracji. Do tej pory ChartWidgetView składał
// konfigurację ręcznie, pole po polu, i robił to inaczej niż parser bloku:
// połowy pól nie czytał wcale (notatki, data danych, n, prognoza, demo), więc
// ten sam wykres w bloku i w widgecie mówił czytelnikowi co innego.
//
// TU JEST JEDNO MIEJSCE i jedna droga: treść widgetu jest przekładana na Json
// w kształcie BLOKU i przechodzi przez TEN SAM parser (`parseChartConfig`,
// `parseDataMapConfig`). Klamry, zakresy i wartości domyślne są więc jedne dla
// obu powierzchni, a nowe pole konfiguracji wymaga tu jednej linijki, a nie
// drugiej implementacji parsera. Czytają go widok widgetu wykresu, widok
// widgetu mapy i podgląd w dialogu arkusza buildera.
//
// Klucze sprzed tego modułu są czytane DOKŁADNIE tak, jak czytał je widok
// widgetu (bramka `__tests__/widgetConfig.test.ts` porównuje wynik z kopią
// dawnego adaptera), więc opublikowane widgety bez nowych kluczy dostają
// identyczną konfigurację.
import type { Json } from "@/lib/blocks/types";
import { parseChartData, parseMapData } from "./csv";
import {
  CHART_HEIGHT_DEFAULT,
  parseChartConfig,
  parseChartSources,
  parseDataMapConfig,
} from "./parse";
import type { ChartConfig, DataMapConfig } from "./types";

type WidgetLang = "pl" | "en";

function str(c: Record<string, unknown>, key: string): string {
  const v = c[key];
  return typeof v === "string" ? v : "";
}

/** Pole dwujęzyczne: język strony, potem polski, potem angielski. */
function i18n(c: Record<string, unknown>, base: string, lang: WidgetLang): string {
  return str(c, `${base}_${lang}`) || str(c, `${base}_pl`) || str(c, `${base}_en`);
}

/**
 * Pole liczbowe NOWEGO klucza: liczba albo napis liczbowy (pole `text`
 * z przecinkiem dziesiętnym) przechodzi do parsera, który rozstrzyga zakres;
 * cokolwiek innego jest brakiem. Klucze sprzed modułu czytamy po staremu.
 */
function numeric(c: Record<string, unknown>, key: string): Json {
  const v = c[key];
  return typeof v === "number" || typeof v === "string" ? v : null;
}

/**
 * Sloty kolorów serii zapisane jako "3;4;8" - pozycja na liście to pozycja
 * serii. Pusta pozycja (albo brak klucza) zostawia slot domyślny po pozycji
 * (`slotForSeries` z `csv.ts`). Zakres 1..MAX_COLOR_SLOT sprawdza parser
 * serii: numer spoza palety wraca do slotu domyślnego po pozycji, a nie do
 * najbliższego numeru - to ta sama reguła co w bloku, a „najbliższy" kolor
 * byłby kolorem, którego nikt nie wybrał.
 */
function seriesColorSlots(raw: string): (number | null)[] {
  if (raw.trim() === "") return [];
  return raw.split(";").map((cell) => {
    const t = cell.trim();
    if (t === "") return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  });
}

export function widgetChartConfig(content: Record<string, unknown>, lang: WidgetLang): ChartConfig {
  const c = content;
  const { categories, series } = parseChartData(str(c, "data"));
  const slots = seriesColorSlots(str(c, "seriesColors"));
  // Jedno źródło pasma z pól płaskich. Pasmo dostaje odwołanie `band`
  // wyłącznie wtedy, gdy źródło przeżyje parser (ma tytuł albo adres) - bez
  // niego silnik pokaże „brak benchmarku", a nie przedział bez przypisu.
  const bandSource: Record<string, Json> = {
    id: "band",
    author: str(c, "bandSourceAuthor"),
    title: str(c, "bandSourceTitle"),
    container: str(c, "bandSourceContainer"),
    publisher: str(c, "bandSourcePublisher"),
    published: str(c, "bandSourcePublished"),
    accessed: str(c, "bandSourceAccessed"),
    url: str(c, "bandSourceUrl"),
    reliability: str(c, "bandSourceReliability"),
  };
  const hasBandSource = parseChartSources([bandSource]).length > 0;
  const height = c.height;
  return parseChartConfig({
    kind: str(c, "kind"),
    title: i18n(c, "title", lang),
    description: i18n(c, "description", lang),
    categories,
    series: series.map((s, i) => ({
      name: s.name,
      values: s.values,
      colorSlot: slots[i] ?? s.colorSlot,
    })),
    stacked: str(c, "stacked") === "on",
    unit: str(c, "unit"),
    // Wysokość jest polem `number` schematu - napis zostaje, jak dotąd,
    // wysokością domyślną.
    height: typeof height === "number" ? height : CHART_HEIGHT_DEFAULT,
    showLegend: str(c, "showLegend") !== "off",
    showGrid: str(c, "showGrid") !== "off",
    showValues: str(c, "showValues") === "on",
    animate: str(c, "animate") !== "off",
    source: i18n(c, "source", lang),
    caption: i18n(c, "caption", lang),
    palette: str(c, "palette") === "categorical" ? "categorical" : "focus",
    direction: str(c, "direction"),
    provenance: str(c, "provenance"),
    band: {
      min: str(c, "bandMin"),
      max: str(c, "bandMax"),
      sourceId: hasBandSource ? "band" : "",
    },
    target: str(c, "target"),
    sources: [bandSource],
    accentSeries: numeric(c, "accentSeries"),
    accentCategory: numeric(c, "accentCategory"),
    sourceDate: str(c, "sourceDate"),
    sampleSize: numeric(c, "sampleSize"),
    notesShows: i18n(c, "notesShows", lang),
    notesSurprising: i18n(c, "notesSurprising", lang),
    notesHidden: i18n(c, "notesHidden", lang),
    demo: str(c, "demo") === "on",
    forecastFrom: numeric(c, "forecastFrom"),
    forecastBandPct: numeric(c, "forecastBandPct"),
  });
}

export function widgetMapConfig(content: Record<string, unknown>, lang: WidgetLang): DataMapConfig {
  const c = content;
  return parseDataMapConfig({
    // Region przez parser - ta sama droga, co w bloku CMS; nieznany zapis
    // wraca do Europy.
    region: str(c, "region"),
    title: i18n(c, "title", lang),
    description: i18n(c, "description", lang),
    unit: str(c, "unit"),
    values: parseMapData(str(c, "data")).map((d) => ({ id: d.id, value: d.value })),
    showLegend: str(c, "showLegend") !== "off",
    animate: str(c, "animate") !== "off",
    source: i18n(c, "source", lang),
    scheme: str(c, "scheme"),
    classes: numeric(c, "classes"),
    method: str(c, "method"),
    midpoint: numeric(c, "midpoint"),
    provenance: str(c, "provenance"),
    demo: str(c, "demo") === "on",
    caption: i18n(c, "caption", lang),
    sourceDate: str(c, "sourceDate"),
    sampleSize: numeric(c, "sampleSize"),
    notesShows: i18n(c, "notesShows", lang),
    notesSurprising: i18n(c, "notesSurprising", lang),
    notesHidden: i18n(c, "notesHidden", lang),
  });
}
