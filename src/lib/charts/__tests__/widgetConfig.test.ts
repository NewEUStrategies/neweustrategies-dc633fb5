// ADAPTER WIDGETU -> KONFIGURACJA. Dwie obietnice:
//   1. widget BEZ nowych kluczy dostaje konfigurację IDENTYCZNĄ z tą, którą
//      składał dawny widok widgetu - porównanie z zamrożoną kopią dawnego
//      adaptera (niżej), pole po polu, przez `toEqual` na całym obiekcie;
//   2. nowe klucze schematu przechodzą przez ten sam parser co blok CMS,
//      więc mają te same zakresy i te same wartości domyślne.
import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/blocks/types";
import type { ChartConfig, DataMapConfig } from "@/lib/charts/types";
import {
  CHART_HEIGHT_DEFAULT,
  CHART_HEIGHT_MAX,
  CHART_HEIGHT_MIN,
  defaultChartConfig,
  parseChartBand,
  parseChartKind,
  parseChartSources,
  parseChartTarget,
  parseMapRegion,
} from "@/lib/charts/parse";
import { isMetricDirection } from "@/lib/charts/status";
import { isProvenance } from "@/lib/charts/sources";
import { parseChartData, parseMapData } from "@/lib/charts/csv";
import { slotForSeries } from "@/lib/charts/palette";
import { widgetChartConfig, widgetMapConfig } from "@/lib/charts/widgetConfig";

type Content = Record<string, Json>;

// ---------------------------------------------------------------------------
// ZAMROŻONA KOPIA dawnego adaptera z `DataVizWidgets.tsx` (sprzed
// `widgetConfig.ts`). Nie importuje niczego z nowego modułu - jest wzorcem,
// do którego nowy adapter ma się równać przy braku nowych kluczy.
// ---------------------------------------------------------------------------
function getStr(c: Content, k: string): string {
  const v = c[k];
  return typeof v === "string" ? v : "";
}
function getNum(c: Content, k: string, dflt: number): number {
  const v = c[k];
  return typeof v === "number" ? v : dflt;
}
function i18nStr(c: Content, base: string, lang: "pl" | "en"): string {
  return getStr(c, `${base}_${lang}`) || getStr(c, `${base}_pl`) || getStr(c, `${base}_en`);
}
function legacyChart(c: Content, lang: "pl" | "en"): ChartConfig {
  const { categories, series } = parseChartData(getStr(c, "data"));
  const direction = getStr(c, "direction");
  const provenance = getStr(c, "provenance");
  const sources = parseChartSources([
    {
      id: "band",
      author: getStr(c, "bandSourceAuthor"),
      title: getStr(c, "bandSourceTitle"),
      container: getStr(c, "bandSourceContainer"),
      publisher: getStr(c, "bandSourcePublisher"),
      published: getStr(c, "bandSourcePublished"),
      accessed: getStr(c, "bandSourceAccessed"),
      url: getStr(c, "bandSourceUrl"),
      reliability: getStr(c, "bandSourceReliability"),
    },
  ]);
  return {
    ...defaultChartConfig(),
    kind: parseChartKind(getStr(c, "kind")),
    title: i18nStr(c, "title", lang),
    description: i18nStr(c, "description", lang),
    categories,
    series,
    stacked: getStr(c, "stacked") === "on",
    unit: getStr(c, "unit"),
    height: Math.max(
      CHART_HEIGHT_MIN,
      Math.min(CHART_HEIGHT_MAX, getNum(c, "height", CHART_HEIGHT_DEFAULT)),
    ),
    showLegend: getStr(c, "showLegend") !== "off",
    showGrid: getStr(c, "showGrid") !== "off",
    showValues: getStr(c, "showValues") === "on",
    animate: getStr(c, "animate") !== "off",
    source: i18nStr(c, "source", lang),
    caption: i18nStr(c, "caption", lang),
    palette: getStr(c, "palette") === "categorical" ? "categorical" : "focus",
    direction: isMetricDirection(direction) ? direction : null,
    provenance: isProvenance(provenance) ? provenance : null,
    band: parseChartBand({
      min: getStr(c, "bandMin"),
      max: getStr(c, "bandMax"),
      sourceId: sources.length > 0 ? "band" : "",
    }),
    target: parseChartTarget(getStr(c, "target")),
    sources,
  };
}
function legacyMap(c: Content, lang: "pl" | "en"): Partial<DataMapConfig> {
  return {
    region: parseMapRegion(getStr(c, "region")),
    title: i18nStr(c, "title", lang),
    description: i18nStr(c, "description", lang),
    unit: getStr(c, "unit"),
    values: parseMapData(getStr(c, "data")),
    showLegend: getStr(c, "showLegend") !== "off",
    animate: getStr(c, "animate") !== "off",
    source: i18nStr(c, "source", lang),
  };
}

const CHART: Content = {
  kind: "line",
  title_pl: "Handel",
  title_en: "Trade",
  description_pl: "Opis",
  unit: " mld",
  data: "; Eksport; Import; Saldo\n2023; 10; 7; 3\n2024; 14,5; 9; \n2025; 12; 11; 1",
  stacked: "off",
  height: 360,
  showLegend: "on",
  showGrid: "off",
  showValues: "on",
  animate: "off",
  source_pl: "Źródło: test",
  caption_en: "Caption",
  palette: "categorical",
  direction: "higher",
  provenance: "B",
  target: "12,5",
  bandMin: "8",
  bandMax: "11",
  bandSourceAuthor: "Eurostat",
  bandSourceTitle: "Benchmark",
  bandSourceReliability: "A",
};

const LEGACY_CASES: Array<[string, Content]> = [
  ["komplet kluczy sprzed modułu", CHART],
  ["pusta treść", {}],
  ["pasmo bez źródła", { ...CHART, bandSourceTitle: "", bandSourceAuthor: "" }],
  ["rodzaj nieznany i wysokość jako napis", { ...CHART, kind: "sparkle", height: "500" }],
  ["wysokość spoza zakresu", { ...CHART, height: 9000 }],
  ["paleta i kierunek nieznane", { ...CHART, palette: "neon", direction: "up" }],
  ["styl słupka ze starszego edytora", { ...CHART, kind: "bar", barStyle: "gradient" }],
];

describe("widgetChartConfig - bez nowych kluczy identyczny z dawnym widokiem", () => {
  for (const [opis, content] of LEGACY_CASES) {
    for (const lang of ["pl", "en"] as const) {
      it(`${opis} (${lang})`, () => {
        expect(widgetChartConfig(content, lang)).toEqual(legacyChart(content, lang));
      });
    }
  }
});

describe("widgetChartConfig - nowe klucze", () => {
  it("kolory serii: pozycja na liście = pozycja serii, pusta pozycja = slot domyślny", () => {
    const cfg = widgetChartConfig({ ...CHART, seriesColors: "8;;14" }, "pl");
    expect(cfg.series.map((s) => s.colorSlot)).toEqual([8, slotForSeries(1), 14]);
  });

  it("slot spoza palety albo nie-liczba wraca do slotu domyślnego po pozycji", () => {
    const cfg = widgetChartConfig({ ...CHART, seriesColors: "0; abc; 99" }, "pl");
    expect(cfg.series.map((s) => s.colorSlot)).toEqual([0, 1, 2].map(slotForSeries));
    // Krótsza lista zostawia resztę serii przy domyślnych.
    const short = widgetChartConfig({ ...CHART, seriesColors: "20" }, "pl");
    expect(short.series.map((s) => s.colorSlot)).toEqual([20, slotForSeries(1), slotForSeries(2)]);
  });

  it("seria wyróżniona: liczba albo napis, poza zakresem - zero", () => {
    expect(widgetChartConfig({ ...CHART, accentSeries: 2 }, "pl").accentSeries).toBe(2);
    expect(widgetChartConfig({ ...CHART, accentSeries: "1" }, "pl").accentSeries).toBe(1);
    expect(widgetChartConfig({ ...CHART, accentSeries: 7 }, "pl").accentSeries).toBe(0);
    expect(widgetChartConfig({ ...CHART, accentSeries: true }, "pl").accentSeries).toBe(0);
  });

  it("kategoria wyróżniona: pusta wartość = największy wycinek", () => {
    expect(widgetChartConfig({ ...CHART, accentCategory: 1 }, "pl").accentCategory).toBe(1);
    expect(widgetChartConfig({ ...CHART, accentCategory: "" }, "pl").accentCategory).toBeNull();
    expect(widgetChartConfig({ ...CHART, accentCategory: 3 }, "pl").accentCategory).toBeNull();
  });

  it("podpis: data, n, trzy zdania (z zapasem językowym), demo", () => {
    const cfg = widgetChartConfig(
      {
        ...CHART,
        sourceDate: "2026-06",
        sampleSize: "120",
        notesShows_pl: "Pokazuje",
        notesShows_en: "Shows",
        notesSurprising_pl: "Zaskakuje",
        notesHidden_en: "Hidden",
        demo: "on",
      },
      "en",
    );
    expect(cfg.sourceDate).toBe("2026-06");
    expect(cfg.sampleSize).toBe(120);
    expect(cfg.notesShows).toBe("Shows");
    expect(cfg.notesSurprising).toBe("Zaskakuje");
    expect(cfg.notesHidden).toBe("Hidden");
    expect(cfg.demo).toBe(true);
    expect(widgetChartConfig({ ...CHART, demo: "off" }, "pl").demo).toBe(false);
    expect(widgetChartConfig({ ...CHART, sampleSize: 0 }, "pl").sampleSize).toBeNull();
  });

  it("prognoza: granica w zakresie kategorii, deklaracja zapamiętana, pasmo w 0..100", () => {
    const ok = widgetChartConfig({ ...CHART, forecastFrom: 2, forecastBandPct: 15 }, "pl");
    expect(ok.forecastFrom).toBe(2);
    expect(ok.forecastFromDeclared).toBe(2);
    expect(ok.forecastBandPct).toBe(15);
    const poza = widgetChartConfig({ ...CHART, forecastFrom: "40", forecastBandPct: 500 }, "pl");
    expect(poza.forecastFrom).toBeNull();
    expect(poza.forecastFromDeclared).toBe(40);
    expect(poza.forecastBandPct).toBe(100);
    const puste = widgetChartConfig({ ...CHART, forecastFrom: "" }, "pl");
    expect(puste.forecastFrom).toBeNull();
    expect(puste.forecastFromDeclared).toBeNull();
  });
});

const MAP: Content = {
  region: "world",
  title_pl: "Mapa",
  title_en: "Map",
  description_en: "Desc",
  unit: "%",
  data: "PL; 38\nde; 84,5\nXX1; 3\nFR; abc",
  showLegend: "off",
  animate: "off",
  source_pl: "Eurostat",
};

describe("widgetMapConfig", () => {
  for (const [opis, content] of [
    ["komplet kluczy sprzed modułu", MAP],
    ["pusta treść", {}],
    ["region nieznany", { ...MAP, region: "mars" }],
  ] as Array<[string, Content]>) {
    for (const lang of ["pl", "en"] as const) {
      it(`bez nowych kluczy: pola dawnego widoku bez zmian, nowe domyślne - ${opis} (${lang})`, () => {
        const cfg = widgetMapConfig(content, lang);
        expect(cfg).toMatchObject(legacyMap(content, lang));
        expect(cfg.scheme).toBe("blue");
        expect(cfg.classes).toBe(0);
        expect(cfg.method).toBe("quantile");
        expect(cfg.midpoint).toBeNull();
        expect(cfg.provenance).toBeNull();
        expect(cfg.demo).toBe(false);
        expect(cfg.sources).toEqual([]);
        expect(cfg.caption).toBe("");
        expect(cfg.sampleSize).toBeNull();
      });
    }
  }

  it("nowe klucze: schemat, klasy, metoda, środek, pochodzenie, demo i podpis", () => {
    const cfg = widgetMapConfig(
      {
        ...MAP,
        scheme: "diverging",
        classes: "5",
        method: "equal",
        midpoint: "1,5",
        provenance: "W",
        demo: "on",
        caption_pl: "Podpis",
        caption_en: "Caption",
        sourceDate: "2026",
        sampleSize: 27,
        notesShows_pl: "a",
        notesSurprising_en: "b",
        notesHidden_pl: "c",
      },
      "en",
    );
    expect(cfg.scheme).toBe("diverging");
    expect(cfg.classes).toBe(5);
    expect(cfg.method).toBe("equal");
    expect(cfg.midpoint).toBe(1.5);
    expect(cfg.provenance).toBe("W");
    expect(cfg.demo).toBe(true);
    expect(cfg.caption).toBe("Caption");
    expect(cfg.sourceDate).toBe("2026");
    expect(cfg.sampleSize).toBe(27);
    expect([cfg.notesShows, cfg.notesSurprising, cfg.notesHidden]).toEqual(["a", "b", "c"]);
  });

  it("klasy jako liczba i zakres dociśnięty tak samo jak w bloku", () => {
    expect(widgetMapConfig({ ...MAP, classes: 9 }, "pl").classes).toBe(7);
    expect(widgetMapConfig({ ...MAP, classes: 0 }, "pl").classes).toBe(0);
    expect(widgetMapConfig({ ...MAP, scheme: "amber" }, "pl").scheme).toBe("blue");
  });
});
