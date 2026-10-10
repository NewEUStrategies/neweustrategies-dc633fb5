import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/blocks/types";
import {
  MAP_CLASSES_MAX,
  MAP_CLASSES_MIN,
  MAP_METHODS,
  MAP_SCHEMES,
  MAX_SERIES,
} from "@/lib/charts/types";
import {
  CHART_HEIGHT_MAX,
  CHART_HEIGHT_MIN,
  defaultChartConfig,
  defaultDataMapConfig,
  parseChartConfig,
  parseDataMapConfig,
  parseMapClasses,
  parseMapValues,
} from "../parse";

describe("parseChartConfig", () => {
  it("parses a complete block payload", () => {
    const cfg = parseChartConfig({
      kind: "line",
      title: "Tytuł",
      categories: ["a", "b"],
      series: [{ name: "S1", values: [1, "2,5"], colorSlot: 3 }],
      stacked: true,
      unit: "%",
      height: 400,
      showValues: true,
      source: "Źródło: X",
    });
    expect(cfg.kind).toBe("line");
    expect(cfg.series[0].values).toEqual([1, 2.5]);
    expect(cfg.series[0].colorSlot).toBe(3);
    expect(cfg.height).toBe(400);
    expect(cfg.stacked).toBe(true);
  });

  it("falls back to bar for unknown kinds and clamps height", () => {
    expect(parseChartConfig({ kind: "sparkle" }).kind).toBe("bar");
    expect(parseChartConfig({ height: 20 }).height).toBe(CHART_HEIGHT_MIN);
    expect(parseChartConfig({ height: 5000 }).height).toBe(CHART_HEIGHT_MAX);
  });

  it("prefers the quick-switch `variant` over `kind`", () => {
    expect(parseChartConfig({ kind: "bar", variant: "donut" }).kind).toBe("donut");
  });

  it("pads short series and nulls invalid cells", () => {
    const cfg = parseChartConfig({
      categories: ["a", "b", "c"],
      series: [{ name: "S", values: [1, "x"] }],
    });
    expect(cfg.series[0].values).toEqual([1, null, null]);
  });

  it("caps series at the palette size (never cycles hues)", () => {
    // Limit czytamy ze stałej, nie z literału: paleta rośnie razem z liczbą
    // slotów i test ma pilnować REGUŁY, a nie zapamiętanej liczby.
    const many = Array.from({ length: MAX_SERIES + 4 }, (_, i) => ({ name: `S${i}`, values: [1] }));
    expect(parseChartConfig({ categories: ["a"], series: many }).series).toHaveLength(MAX_SERIES);
  });
});

describe("parseMapValues / parseDataMapConfig", () => {
  it("accepts only ISO-2 codes with finite values, deduplicated", () => {
    const values = parseMapValues([
      { id: "pl", value: 1 },
      { id: "PL", value: 2 },
      { id: "POL", value: 3 },
      { id: "DE", value: "4,5" },
      { id: "FR", value: "abc" },
    ]);
    expect(values).toEqual([
      { id: "PL", value: 1 },
      { id: "DE", value: 4.5 },
    ]);
  });

  it("defaults region to europe", () => {
    expect(parseDataMapConfig({}).region).toBe("europe");
    expect(parseDataMapConfig({ region: "world" }).region).toBe("world");
    expect(parseDataMapConfig({ region: "mars" }).region).toBe("europe");
  });
});

describe("parseChartConfig - seria i kategoria wyróżniona", () => {
  const base = {
    categories: ["a", "b", "c"],
    series: [
      { name: "A", values: [1, 2, 3] },
      { name: "B", values: [3, 2, 1] },
      { name: "C", values: [2, 2, 2] },
    ],
  };

  it("brak klucza = pierwsza seria i wycinek największy - wygląd sprzed pola", () => {
    const cfg = parseChartConfig(base);
    expect(cfg.accentSeries).toBe(0);
    expect(cfg.accentCategory).toBeNull();
    expect(defaultChartConfig().accentSeries).toBe(0);
    expect(defaultChartConfig().accentCategory).toBeNull();
  });

  it("indeks w zakresie przechodzi, także jako napis i liczba niecałkowita", () => {
    expect(parseChartConfig({ ...base, accentSeries: 2 }).accentSeries).toBe(2);
    expect(parseChartConfig({ ...base, accentSeries: "1" }).accentSeries).toBe(1);
    expect(parseChartConfig({ ...base, accentSeries: 1.4 }).accentSeries).toBe(1);
    expect(parseChartConfig({ ...base, accentCategory: 2 }).accentCategory).toBe(2);
    expect(parseChartConfig({ ...base, accentCategory: "0" }).accentCategory).toBe(0);
  });

  it("seria spoza listy wraca do ZERA, nie do ostatniej serii", () => {
    // Autor usunął kolumnę, na którą wskazywał akcent - akcent nie może
    // przeskoczyć na serię przypadkową.
    for (const raw of [3, 99, -1, "x", null, Number.NaN]) {
      expect(parseChartConfig({ ...base, accentSeries: raw }).accentSeries, String(raw)).toBe(0);
    }
    expect(parseChartConfig({ categories: [], series: [], accentSeries: 0 }).accentSeries).toBe(0);
  });

  it("kategoria spoza listy i pusty napis dają null, a nie pierwszą kategorię", () => {
    for (const raw of [3, -1, "", "x", null]) {
      expect(
        parseChartConfig({ ...base, accentCategory: raw }).accentCategory,
        String(raw),
      ).toBeNull();
    }
  });
});

describe("parseDataMapConfig - schemat, klasy i podpis", () => {
  it("brak kluczy = skala ciągła na rampie blue - opublikowane mapy bez zmian", () => {
    const cfg = parseDataMapConfig({});
    expect(cfg.scheme).toBe("blue");
    expect(cfg.classes).toBe(0);
    expect(cfg.method).toBe("quantile");
    expect(cfg.midpoint).toBeNull();
    expect(cfg.provenance).toBeNull();
    expect(cfg.demo).toBe(false);
    expect(cfg.sources).toEqual([]);
    expect(cfg.caption).toBe("");
    expect(cfg.sourceDate).toBe("");
    expect(cfg.sampleSize).toBeNull();
    expect(cfg.notesShows).toBe("");
    expect(cfg.notesSurprising).toBe("");
    expect(cfg.notesHidden).toBe("");
    expect(defaultDataMapConfig()).toEqual(cfg);
  });

  it("każdy schemat i każda metoda z listy przechodzi, nieznany zapis wraca do domyślnego", () => {
    for (const scheme of MAP_SCHEMES) expect(parseDataMapConfig({ scheme }).scheme).toBe(scheme);
    for (const method of MAP_METHODS) expect(parseDataMapConfig({ method }).method).toBe(method);
    expect(parseDataMapConfig({ scheme: "amber" }).scheme).toBe("blue");
    expect(parseDataMapConfig({ scheme: 3 }).scheme).toBe("blue");
    expect(parseDataMapConfig({ method: "jenks" }).method).toBe("quantile");
  });

  it("klasy: 0 albo 3..7 - liczba dodatnia jest dociskana, zero i ujemna to skala ciągła", () => {
    const cases: Array<[Json, number]> = [
      [0, 0],
      [-4, 0],
      ["", 0],
      ["abc", 0],
      [null, 0],
      [1, MAP_CLASSES_MIN],
      [2, MAP_CLASSES_MIN],
      [3, 3],
      [5, 5],
      ["4", 4],
      [4.6, 5],
      [7, MAP_CLASSES_MAX],
      [12, MAP_CLASSES_MAX],
    ];
    for (const [raw, expected] of cases) {
      expect(parseDataMapConfig({ classes: raw }).classes, JSON.stringify(raw)).toBe(expected);
      expect(parseMapClasses(raw)).toBe(expected);
    }
  });

  it("punkt środkowy, pochodzenie, demo, źródła i podpis", () => {
    const cfg = parseDataMapConfig({
      midpoint: "1,5",
      provenance: "E",
      demo: true,
      sources: [{ title: "Eurostat" }, { title: "" }],
      caption: "Podpis",
      sourceDate: "2026-01",
      sampleSize: "27",
      notesShows: "a",
      notesSurprising: "b",
      notesHidden: "c",
    });
    expect(cfg.midpoint).toBe(1.5);
    expect(cfg.provenance).toBe("E");
    expect(cfg.demo).toBe(true);
    expect(cfg.sources.map((s) => s.title)).toEqual(["Eurostat"]);
    expect(cfg.caption).toBe("Podpis");
    expect(cfg.sourceDate).toBe("2026-01");
    expect(cfg.sampleSize).toBe(27);
    expect([cfg.notesShows, cfg.notesSurprising, cfg.notesHidden]).toEqual(["a", "b", "c"]);
  });

  it("zapis z bazy w złym typie degraduje do domyślnych, a nie rzuca", () => {
    const cfg = parseDataMapConfig({
      midpoint: "x",
      provenance: "Z",
      demo: "on",
      sources: "Eurostat",
      sampleSize: 0,
    });
    expect(cfg.midpoint).toBeNull();
    expect(cfg.provenance).toBeNull();
    expect(cfg.demo).toBe(false);
    expect(cfg.sources).toEqual([]);
    expect(cfg.sampleSize).toBeNull();
  });
});

describe("parse - ścieżki obronne przy danych z bazy", () => {
  // PO CO TA GRUPA. Konfiguracja bloku pochodzi z bazy i może być z przyszłej
  // albo cofniętej wersji edytora, z ręcznej edycji JSON-a, albo z importu.
  // Parser ma wtedy ZDEGRADOWAĆ do sensownej wartości, a nie rzucić i nie
  // przepuścić śmiecia do silnika - bo wykres, który się nie narysuje, znika
  // ze strony po cichu (granica błędu renderuje pusty element).
  //
  // Te ścieżki istniały od początku, ale nie były pokryte: dopóki nikt ich nie
  // przechodził, nie było dowodu, że degradacja faktycznie działa. Każdy nowy
  // rodzaj wykresu zwiększa liczbę pól konfiguracji, więc wartość tego dowodu
  // rośnie.

  it("liczba NIESKOŃCZONA i NaN są traktowane jak brak, nie jak zero", () => {
    // Zero jest legalną daną, a nieskończoność nie jest liczbą, którą można
    // narysować - odróżnienie tych dwóch przypadków jest całym sensem tej
    // ścieżki. Wysokość poza zakresem wraca do domyślnej, nie do zera.
    const cfg = parseChartConfig({
      categories: ["a"],
      series: [{ name: "S", values: [Number.POSITIVE_INFINITY] }],
      height: Number.NaN,
    });
    expect(cfg.series[0].values[0]).toBeNull();
    expect(cfg.height).toBeGreaterThanOrEqual(CHART_HEIGHT_MIN);
    expect(cfg.height).toBeLessThanOrEqual(CHART_HEIGHT_MAX);
  });

  it("seria BEZ tablicy wartości daje same luki, a nie wywrotkę", () => {
    // `values` niebędące tablicą to typowy skutek ręcznej edycji JSON-a.
    // Seria musi zostać (autor ją nazwał), tylko bez liczb.
    const cfg = parseChartConfig({
      categories: ["a", "b"],
      series: [{ name: "S", values: "1;2" }],
    });
    expect(cfg.series[0].values).toEqual([null, null]);
  });

  it("seria BEZ nazwy dostaje nazwę pustą, nie napis undefined", () => {
    // Napis "undefined" w legendzie jest wyciekiem, który łapie bramka macierzy
    // bloków - i słusznie, bo czytelnik widziałby wtedy techniczny bełkot.
    const cfg = parseChartConfig({ categories: ["a"], series: [{ values: [1] }] });
    expect(cfg.series[0].name).toBe("");
    expect(JSON.stringify(cfg)).not.toContain("undefined");
  });

  it("kategoria NULL staje się pustym napisem", () => {
    const cfg = parseChartConfig({ categories: ["a", null, 7], series: [] });
    expect(cfg.categories).toEqual(["a", "", "7"]);
  });

  it("wskaźnik z brakującymi polami nie zostawia napisu undefined", () => {
    // Tooltip wskaźnika ma pięć pól o stałej kolejności; brakujące zostają
    // puste i po prostu się nie renderują.
    const cfg = parseChartConfig({
      categories: ["a"],
      series: [],
      metric: { name: "ROIC" },
    });
    expect(cfg.metric?.name).toBe("ROIC");
    expect(cfg.metric?.formula).toBe("");
    expect(cfg.metric?.caution).toBe("");
    expect(JSON.stringify(cfg.metric)).not.toContain("undefined");
  });

  it("wpis mapy bez identyfikatora i bez wartości wypada, a nie psuje reszty", () => {
    // Mapa adresuje kraje kodem; wpis bez kodu nie ma czego pokolorować,
    // a wpis bez wartości nie ma czym. Oba muszą zniknąć POJEDYNCZO, nie
    // unieważniając całego zestawu.
    const values = parseMapValues([
      { id: "pl", value: 10 },
      { value: 5 },
      { id: "de" },
      { id: "cz", value: "3,5" },
    ]);
    expect(values.find((v) => v.id === "PL")?.value).toBe(10);
    expect(values.find((v) => v.id === "CZ")?.value).toBe(3.5);
    expect(values.some((v) => v.id === "")).toBe(false);
  });
});
