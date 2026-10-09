// Zakres osi kategorii (suwak, Shift + kółko) - czysta arytmetyka na indeksach.
import { describe, expect, it } from "vitest";
import { clampZoom, panBy, sliceConfig, zoomAround, ZOOM_MIN_SPAN } from "@/lib/charts/zoom";
import { parseChartConfig } from "@/lib/charts/parse";

describe("zakres osi", () => {
  it("clampZoom trzyma okno w granicach i nie węższe niż minimum", () => {
    expect(clampZoom({ start: -5, end: 80 }, 40)).toEqual({ start: 0, end: 39 });
    expect(clampZoom({ start: 10, end: 11 }, 40)).toEqual({
      start: 10,
      end: 10 + ZOOM_MIN_SPAN - 1,
    });
    expect(clampZoom({ start: 38, end: 39 }, 40)).toEqual({
      start: 39 - (ZOOM_MIN_SPAN - 1),
      end: 39,
    });
    expect(clampZoom({ start: 20, end: 5 }, 40)).toEqual({ start: 5, end: 20 });
  });

  it("przybliżenie zostawia kategorię pod kursorem pod kursorem", () => {
    const next = zoomAround({ start: 0, end: 39 }, 40, 0.5, 0.5);
    expect(next.end - next.start).toBeLessThan(39);
    expect((next.start + next.end) / 2).toBeCloseTo(19.5, 0);
  });

  it("oddalenie nie wychodzi poza oś", () => {
    expect(zoomAround({ start: 0, end: 39 }, 40, 0.5, 2)).toEqual({ start: 0, end: 39 });
  });

  it("przesunięcie zachowuje szerokość okna i zatrzymuje się na krawędzi", () => {
    expect(panBy({ start: 10, end: 19 }, 40, 5)).toEqual({ start: 15, end: 24 });
    expect(panBy({ start: 10, end: 19 }, 40, 100)).toEqual({ start: 30, end: 39 });
    expect(panBy({ start: 10, end: 19 }, 40, -100)).toEqual({ start: 0, end: 9 });
  });

  it("wycinek przesuwa granicę prognozy razem z oknem", () => {
    const config = parseChartConfig({
      kind: "line",
      categories: Array.from({ length: 40 }, (_, i) => String(i)),
      series: [{ name: "S", values: Array.from({ length: 40 }, (_, i) => i) }],
      forecastFrom: 30,
    });
    const okno = sliceConfig(config, 20, 35);
    expect(okno.categories).toHaveLength(16);
    expect(okno.series[0].values[0]).toBe(20);
    expect(okno.forecastFrom).toBe(10);
    expect(sliceConfig(config, 0, 25).forecastFrom).toBeNull();
    expect(sliceConfig(config, 32, 39).forecastFrom).toBe(0);
  });
});
