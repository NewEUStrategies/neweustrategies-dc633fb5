// Sprawdzenia uczciwości wykresu. Cała wartość tego modułu jest w tym, że
// nazywa rzeczy, które wykres i tak robi - i które bez nazwania przechodzą
// niezauważone.
import { describe, expect, it } from "vitest";
import { parseChartConfig } from "@/lib/charts/parse";
import {
  isForecastMissingBand,
  isZeroBaselineBroken,
  seriesOverSafePalette,
} from "@/lib/charts/honesty";
import { CATEGORICAL_SAFE_SERIES } from "@/lib/charts/types";
import type { Json } from "@/lib/blocks/types";

const cfg = (data: Record<string, Json>) => parseChartConfig(data);

describe("honesty - ucięta oś wartości", () => {
  it("linia o wartościach daleko od zera MA uciętą oś i to jest nazwane", () => {
    // Trzy wartości między 980 i 1020: oś pójdzie od 950 do 1050, więc
    // różnica 4% wygląda na różnicę o pół wykresu. Wolno tak rysować -
    // linia koduje położenie, nie długość - ale ucięcie musi być NAZWANE.
    expect(
      isZeroBaselineBroken(
        cfg({
          kind: "line",
          categories: ["a", "b", "c", "d"],
          series: [{ name: "S", values: [980, 1010, 995, 1020] }],
        }),
      ),
    ).toBe(true);
  });

  it("linia przechodząca przez zero NIE jest ucięta", () => {
    expect(
      isZeroBaselineBroken(
        cfg({
          kind: "line",
          categories: ["a", "b", "c"],
          series: [{ name: "S", values: [-5, 3, 8] }],
        }),
      ),
    ).toBe(false);
  });

  it("SŁUPKI nigdy nie są zgłaszane - ich domena zawsze obejmuje zero", () => {
    // Dla słupków pytanie nie istnieje: długość koduje wartość, więc ucięta
    // oś wprost zniekształca proporcję i silnik nie dopuszcza jej wcale.
    for (const kind of ["bar", "bar-horizontal", "waterfall"]) {
      expect(
        isZeroBaselineBroken(
          cfg({
            kind,
            categories: ["a", "b", "c"],
            series: [{ name: "S", values: [980, 1010, 995] }],
          }),
        ),
        kind,
      ).toBe(false);
    }
  });

  it("wykres bez rysowalnych serii nie twierdzi niczego o osi", () => {
    expect(
      isZeroBaselineBroken(
        cfg({
          kind: "line",
          categories: ["a", "b"],
          series: [{ name: "S", values: [null, null] }],
        }),
      ),
    ).toBe(false);
    expect(isZeroBaselineBroken(cfg({ kind: "line" }))).toBe(false);
  });

  it("wynik zgadza się ze skalą, którą naprawdę rysuje silnik", () => {
    // Ta asercja pilnuje WSPÓLNEGO `valueTickTarget`: gdyby sprawdzenie
    // liczyło skalę inną liczbą podziałek niż render, podpis "oś nie zaczyna
    // się od zera" pojawiałby się pod wykresem, na którym zaczyna.
    const data: Record<string, Json> = {
      kind: "line",
      categories: ["a", "b", "c", "d"],
      series: [{ name: "S", values: [12, 18, 15, 20] }],
    };
    // Ten sam szereg przy dwóch wysokościach - inna liczba podziałek, ta sama
    // odpowiedź, bo domena i tak nie obejmuje zera.
    expect(isZeroBaselineBroken(cfg({ ...data, height: 160 }))).toBe(true);
    expect(isZeroBaselineBroken(cfg({ ...data, height: 640 }))).toBe(true);
  });
});

describe("honesty - prognoza bez pasma", () => {
  it("prognoza bez pasma niepewności jest zgłaszana", () => {
    expect(
      isForecastMissingBand(
        cfg({
          kind: "line",
          categories: ["a", "b", "c", "d"],
          series: [{ name: "S", values: [1, 2, 3, 4] }],
          forecastFrom: 2,
        }),
      ),
    ).toBe(true);
  });

  it("prognoza z pasmem przechodzi, a wykres bez prognozy nie jest pytany", () => {
    const base: Record<string, Json> = {
      kind: "line",
      categories: ["a", "b", "c", "d"],
      series: [{ name: "S", values: [1, 2, 3, 4] }],
    };
    expect(isForecastMissingBand(cfg({ ...base, forecastFrom: 2, forecastBandPct: 15 }))).toBe(
      false,
    );
    expect(isForecastMissingBand(cfg(base))).toBe(false);
  });
});

describe("honesty - dyscyplina palety", () => {
  it("liczy NADWYŻKĘ serii nad zestawem bezpiecznym, nie samą flagę", () => {
    const series = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        name: `S${i}`,
        values: [i + 1],
        colorSlot: i + 1,
      }));
    expect(
      seriesOverSafePalette(
        cfg({ kind: "line", categories: ["a"], series: series(8) }),
        CATEGORICAL_SAFE_SERIES,
      ),
    ).toBe(8 - CATEGORICAL_SAFE_SERIES);
    expect(
      seriesOverSafePalette(
        cfg({ kind: "line", categories: ["a"], series: series(3) }),
        CATEGORICAL_SAFE_SERIES,
      ),
    ).toBe(0);
  });

  it("seria bez ani jednej wartości nie liczy się do budżetu kolorów", () => {
    // Puste serie nie zajmują koloru na wykresie, więc nie mogą zabierać
    // miejsca w budżecie - inaczej ostrzeżenie krzyczałoby o nic.
    expect(
      seriesOverSafePalette(
        cfg({
          kind: "line",
          categories: ["a"],
          series: [
            ...Array.from({ length: CATEGORICAL_SAFE_SERIES }, (_, i) => ({
              name: `S${i}`,
              values: [i + 1],
            })),
            { name: "pusta", values: [null] },
          ],
        }),
        CATEGORICAL_SAFE_SERIES,
      ),
    ).toBe(0);
  });
});
