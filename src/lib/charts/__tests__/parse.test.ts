import { describe, expect, it } from "vitest";
import { MAX_SERIES } from "@/lib/charts/types";
import {
  CHART_HEIGHT_MAX,
  CHART_HEIGHT_MIN,
  parseChartConfig,
  parseDataMapConfig,
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
