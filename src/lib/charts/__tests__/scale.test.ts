import { describe, expect, it } from "vitest";
import {
  forecastBandExtent,
  linearScale,
  niceScale,
  niceStep,
  seriesExtent,
  stackSeries,
} from "../scale";
import type { ChartSeries } from "../types";

const s = (values: (number | null)[], slot = 1): ChartSeries => ({
  name: `s${slot}`,
  values,
  colorSlot: slot,
});

describe("niceStep", () => {
  it("snaps to the 1-2-5 progression", () => {
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.7)).toBe(2);
    expect(niceStep(3.2)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.03)).toBe(0.05);
    expect(niceStep(230)).toBe(500);
  });

  it("survives zero and non-finite input", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });

  it("zwraca krok będący LICZBĄ na obu krańcach zakresu double", () => {
    // REGRESJA. Zaokrąglenie w górę po progresji 1-2-5 wypadało poza liczby:
    // `mult * base` przepełniało się do Infinity przy base === 1e308, a
    // `Math.pow(10, -324)` daje 0. Oba wyniki zamieniały `min / step` w NaN,
    // przez co oś przestawała być liczbą - `niceScale(0, 2.5e-323)` zwracało
    // {min: NaN, max: NaN, ticks: []}, czyli wykres bez osi i bez błędu.
    for (const rough of [Number.MAX_VALUE, 1.5e308, 1e308, 5e-324, 1e-323, Number.MIN_VALUE]) {
      const step = niceStep(rough);
      expect(Number.isFinite(step)).toBe(true);
      expect(step).toBeGreaterThan(0);
    }
  });
});

describe("niceScale", () => {
  it("expands the domain to nice bounds and returns even ticks", () => {
    const sc = niceScale(3, 97, 5);
    expect(sc.min).toBeLessThanOrEqual(3);
    expect(sc.max).toBeGreaterThanOrEqual(97);
    expect(sc.ticks[0]).toBe(sc.min);
    expect(sc.ticks[sc.ticks.length - 1]).toBe(sc.max);
    const step = sc.ticks[1] - sc.ticks[0];
    for (let i = 1; i < sc.ticks.length; i++) {
      expect(sc.ticks[i] - sc.ticks[i - 1]).toBeCloseTo(step, 8);
    }
  });

  it("handles a flat series without collapsing", () => {
    const sc = niceScale(50, 50);
    expect(sc.max).toBeGreaterThan(sc.min);
  });

  it("handles negative domains", () => {
    const sc = niceScale(-80, -20);
    expect(sc.min).toBeLessThanOrEqual(-80);
    expect(sc.max).toBeGreaterThanOrEqual(-20);
  });

  // REGRESJA. Jedna skrajna liczba w danych zawieszała RENDER, nie tylko oś.
  // Dwie różne arytmetyczne drogi do tej samej pętli bez końca:
  //  * `max - min` przepełnia się do Infinity, `niceStep(Infinity)` cofa krok
  //    do 1 i pętla dokłada podziałki po jednej przez 1e308,
  //  * `Math.ceil(max / step) * step` wypycha `niceMax` na Infinity, więc
  //    warunek `v <= niceMax` nie gaśnie nigdy.
  // Obie kończyły się RangeError na długości tablicy - zmierzone 13,8 s dla
  // MAX_VALUE i 45,4 s dla -MAX..MAX. `parse.ts` przepuszcza każdą liczbę
  // skończoną, a `honesty.ts` woła `niceScale` przy KAŻDYM renderze, również
  // serwerowym, więc jedna komórka w arkuszu wystarczała, żeby położyć SSR.
  const EKSTREMA: [string, number, number][] = [
    ["0..MAX_VALUE", 0, Number.MAX_VALUE],
    ["-MAX..MAX", -Number.MAX_VALUE, Number.MAX_VALUE],
    ["-MAX..0", -Number.MAX_VALUE, 0],
    ["1e308..MAX", 1e308, Number.MAX_VALUE],
    ["MAX..MAX (płaska)", Number.MAX_VALUE, Number.MAX_VALUE],
    ["-MAX..1", -Number.MAX_VALUE, 1],
    ["subnormalna", Number.MIN_VALUE, 1e-320],
    ["subnormalna przy zerze", 0, 2.5e-323],
    ["-MAX..-MAX (płaska)", -Number.MAX_VALUE, -Number.MAX_VALUE],
  ];

  it.each(EKSTREMA)("domyka się na skrajnej domenie: %s", (_nazwa, min, max) => {
    const start = performance.now();
    const sc = niceScale(min, max, 5);
    // Sekunda to trzy rzędy wielkości zapasu wobec zmierzonych 13,8 s, a wciąż
    // próg, którego pętla bez końca nie ma jak przejść.
    expect(performance.now() - start).toBeLessThan(1000);
    expect(sc.ticks.length).toBeGreaterThan(0);
    expect(sc.ticks.length).toBeLessThanOrEqual(1000);
    // Oś, która nie jest liczbą, kłamie tak samo jak oś ucięta.
    expect(Number.isFinite(sc.min)).toBe(true);
    expect(Number.isFinite(sc.max)).toBe(true);
    expect(sc.ticks.every((t) => Number.isFinite(t))).toBe(true);
  });

  it.each([2, 3, 5, 8, 13])(
    "skrajna domena daje oś z podziałkami, nie jedną kreską (targetTicks=%i)",
    (target) => {
      // Przy targetTicks 2 i 3 rozpiętość -MAX..MAX dzieliła się na dokładnie
      // MAX_VALUE, a `niceStep` zwracał wtedy Infinity - krok nieskończony
      // zostawiał oś z JEDNĄ podziałką. Sam brak zawieszenia to za mało:
      // oś z jedną kreską nie niesie skali.
      const sc = niceScale(-Number.MAX_VALUE, Number.MAX_VALUE, target);
      expect(sc.ticks.length).toBeGreaterThanOrEqual(3);
      expect(sc.ticks.every((t) => Number.isFinite(t))).toBe(true);
    },
  );

  it("skrajnie wysoki targetTicks nie rozdyma tablicy podziałek", () => {
    // Drugie wejście do tej samej pętli: nie przez dane, tylko przez liczbę
    // żądanych podziałek. `valueTickTarget` zwraca 3..~20, więc sufit nie
    // dotyka żadnej osi rysowanej z danych - jest bezpiecznikiem.
    expect(niceScale(0, 100, 1e6).ticks.length).toBeLessThanOrEqual(1000);
  });

  it("nie zmienia podziałek osi liczonych z realnych danych", () => {
    // Kontrakt bezpiecznika: dla wejść, które działały, wynik ma być CO DO
    // BITU ten sam. Wartości poniżej pochodzą z przebiegu sprzed zmiany.
    expect(niceScale(0, 100, 5).ticks).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceScale(2, 24, 5).ticks).toEqual([0, 5, 10, 15, 20, 25]);
    expect(niceScale(-80, -20, 5).ticks).toEqual([-80, -60, -40, -20]);
    expect(niceScale(0, 1e20, 5).ticks).toEqual([0, 2e19, 4e19, 6e19, 8e19, 1e20]);
  });
});

describe("linearScale", () => {
  it("maps domain to range linearly (and inverted ranges)", () => {
    const y = linearScale(0, 100, 200, 0);
    expect(y(0)).toBe(200);
    expect(y(100)).toBe(0);
    expect(y(50)).toBe(100);
  });
});

describe("seriesExtent", () => {
  it("computes min/max across series, skipping nulls", () => {
    const e = seriesExtent([s([1, null, 9]), s([-3, 4, null], 2)], 3, {
      stacked: false,
      includeZero: false,
    });
    expect(e).toEqual({ min: -3, max: 9 });
  });

  it("includes zero when requested (bars must grow from zero)", () => {
    const e = seriesExtent([s([5, 9])], 2, { stacked: false, includeZero: true });
    expect(e.min).toBe(0);
  });

  it("uses per-category sums when stacked", () => {
    const e = seriesExtent([s([5, 5]), s([7, 1], 2)], 2, { stacked: true, includeZero: true });
    expect(e.max).toBe(12);
  });
});

describe("stackSeries", () => {
  it("accumulates positive values upward per category", () => {
    const stacks = stackSeries([s([2, 3]), s([5, 1], 2)], 2);
    expect(stacks[0][0]).toEqual({ from: 0, to: 2, value: 2 });
    expect(stacks[1][0]).toEqual({ from: 2, to: 7, value: 5 });
    expect(stacks[1][1]).toEqual({ from: 3, to: 4, value: 1 });
  });

  it("stacks negatives downward independently", () => {
    const stacks = stackSeries([s([-2]), s([-3], 2), s([4], 3)], 1);
    expect(stacks[0][0]).toEqual({ from: 0, to: -2, value: -2 });
    expect(stacks[1][0]).toEqual({ from: -2, to: -5, value: -3 });
    expect(stacks[2][0]).toEqual({ from: 0, to: 4, value: 4 });
  });

  it("treats nulls as gaps that do not move the cursor", () => {
    const stacks = stackSeries([s([null, 2]), s([3, 3], 2)], 2);
    expect(stacks[0][0].value).toBeNull();
    expect(stacks[1][0]).toEqual({ from: 0, to: 3, value: 3 });
  });
});

describe("forecastBandExtent", () => {
  it("rozszerza zakres o obwiednię prognozy, żeby pasma nie ucięła krawędź", () => {
    // REGRESJA. Skala liczona z samych wartości pozwalała obwiedni wyjść ponad
    // najwyższą podziałkę - a ucięte pasmo niepewności sugeruje, że niepewność
    // KOŃCZY SIĘ tam, gdzie kończy się obszar kreślenia.
    const band = forecastBandExtent([s([10, 12, 13, 100])], 3, 20);
    expect(band).not.toBeNull();
    expect(band?.max).toBeCloseTo(120, 6);
    expect(band?.min).toBeCloseTo(80, 6);
  });

  it("punkt GRANICY jest pomijany - tam pasmo ma szerokość zero", () => {
    // Ostatnia obserwacja jest pomiarem, nie prognozą, więc nie ma wokół niej
    // niepewności prognozy i nie ma czym rozszerzać zakresu.
    const band = forecastBandExtent([s([1000, 10])], 1, 50);
    expect(band?.max).toBeCloseTo(15, 6);
    expect(band?.min).toBeCloseTo(5, 6);
  });

  it("milczy, gdy nie ma czego rozszerzać", () => {
    expect(forecastBandExtent([s([10, 12])], null, 12)).toBeNull();
    expect(forecastBandExtent([s([10, 12])], 1, 0)).toBeNull();
    expect(forecastBandExtent([s([10, null])], 1, 12)).toBeNull();
    expect(forecastBandExtent([], 1, 12)).toBeNull();
  });

  it("bierze skrajne wartości ze WSZYSTKICH serii, nie z pierwszej", () => {
    const band = forecastBandExtent([s([1, 2]), s([1, 50], 2)], 1, 10);
    expect(band?.max).toBeCloseTo(55, 6);
  });

  it("wartości ujemne rozszerzają zakres W DÓŁ", () => {
    const band = forecastBandExtent([s([0, -40])], 1, 25);
    expect(band?.min).toBeCloseTo(-50, 6);
    expect(band?.max).toBeCloseTo(-30, 6);
  });
});
