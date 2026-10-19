// Kontrakt zakresów czasów animacji bloków: widok publiczny i edytor czytają
// TĘ SAMĄ funkcję i stałe, więc pole panelu pokazuje czas, którym animuje
// strona. Zachowanie widoków i pól (fałszywy zegar, wpis w pole) dowodzą
// testy `presentationViews`, `marketingSectionViews` i edytorów obok.
import { describe, expect, it } from "vitest";
import {
  CAROUSEL_INTERVAL_RANGE,
  STATS_COUNTER_DURATION_RANGE,
  clampAnimationMs,
} from "../animationRanges";

describe("zakresy czasów animacji", () => {
  it("licznik: 100-5000 ms, domyślnie 1500; karuzela: 1500-20000 ms, domyślnie 5000", () => {
    expect(STATS_COUNTER_DURATION_RANGE).toEqual({ min: 100, max: 5000, fallback: 1500 });
    expect(CAROUSEL_INTERVAL_RANGE).toEqual({ min: 1500, max: 20000, fallback: 5000 });
  });

  it.each([
    [2500, 2500],
    [100, 100],
    [5000, 5000],
    [99, 100],
    [-1, 100],
    [1e9, 5000],
    [2 ** 31, 5000],
  ])("czas licznika %s ms -> %s ms", (wejscie, wynik) => {
    expect(clampAnimationMs(wejscie, STATS_COUNTER_DURATION_RANGE)).toBe(wynik);
  });

  it.each([
    [8000, 8000],
    [100, 1500],
    [2 ** 31, 20000],
    [Number.MAX_VALUE, 20000],
  ])("interwał karuzeli %s ms -> %s ms", (wejscie, wynik) => {
    expect(clampAnimationMs(wejscie, CAROUSEL_INTERVAL_RANGE)).toBe(wynik);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["napis", "3000"],
    ["null", null],
    ["undefined", undefined],
    ["obiekt", { ms: 3000 }],
  ])("nie-liczba (%s) to wartość domyślna zakresu, nie granica", (_opis, wejscie) => {
    expect(clampAnimationMs(wejscie, STATS_COUNTER_DURATION_RANGE)).toBe(1500);
    expect(clampAnimationMs(wejscie, CAROUSEL_INTERVAL_RANGE)).toBe(5000);
  });
});
