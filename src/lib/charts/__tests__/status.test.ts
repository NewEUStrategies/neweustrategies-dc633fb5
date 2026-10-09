// Status względem przedziału, zmiana i domena odniesień - czyste reguły,
// które czytają tooltip, okno punktu i karta KPI.
import { describe, expect, it } from "vitest";
import {
  changeArrow,
  changeTone,
  effectiveBand,
  meaningKey,
  percentChange,
  rangeStatus,
  referenceExtent,
  statusColor,
  statusSymbol,
} from "@/lib/charts/status";
import { extendDomain } from "@/lib/charts/scale";

const BAND = { min: 2, max: 4, sourceId: "s1", demo: false };

describe("effectiveBand - przedział bez źródła nie istnieje", () => {
  it("pasmo ze źródłem z listy wolno narysować", () => {
    expect(effectiveBand(BAND, ["s1"])).toBe(BAND);
  });

  it("pasmo bez źródła albo ze źródłem wskazującym w próżnię - brak benchmarku", () => {
    expect(effectiveBand({ ...BAND, sourceId: null }, ["s1"])).toBeNull();
    expect(effectiveBand(BAND, ["inne"])).toBeNull();
  });

  it("pasmo demonstracyjne jest dozwolone bez źródła - i jawnie podpisane gdzie indziej", () => {
    expect(effectiveBand({ ...BAND, sourceId: null, demo: true }, [])).not.toBeNull();
  });
});

describe("rangeStatus", () => {
  it("dla wskaźnika przedziałowego każde wyjście z pasma jest odchyleniem", () => {
    expect(rangeStatus(1, BAND, "range")).toBe("below");
    expect(rangeStatus(3, BAND, "range")).toBe("within");
    expect(rangeStatus(5, BAND, "range")).toBe("above");
  });

  it("„lepiej niż przedział” istnieje tylko w stronę, w którą wskaźnik ma rosnąć", () => {
    expect(rangeStatus(5, BAND, "higher")).toBe("better");
    expect(rangeStatus(1, BAND, "higher")).toBe("below");
    expect(rangeStatus(1, BAND, "lower")).toBe("better");
    expect(rangeStatus(5, BAND, "lower")).toBe("above");
  });

  it("krawędzie należą do przedziału", () => {
    expect(rangeStatus(2, BAND, "range")).toBe("within");
    expect(rangeStatus(4, BAND, "range")).toBe("within");
  });

  it("bez pasma albo bez wartości - brak benchmarku, nie zgadywanie", () => {
    expect(rangeStatus(3, null, "higher")).toBe("none");
    expect(rangeStatus(null, BAND, "higher")).toBe("none");
    expect(rangeStatus(Number.NaN, BAND, "higher")).toBe("none");
  });
});

describe("symbole i kolory statusu - kolor nigdy nie jest jedynym nośnikiem", () => {
  it("każdy status ma symbol", () => {
    expect(statusSymbol("below", 1, BAND)).toBe("▼");
    expect(statusSymbol("within", 3, BAND)).toBe("✓");
    expect(statusSymbol("above", 5, BAND)).toBe("▲");
    expect(statusSymbol("none", null, null)).toBe("?");
  });

  it("„lepiej” bierze strzałkę POŁOŻENIA względem pasma", () => {
    expect(statusSymbol("better", 5, BAND)).toBe("▲");
    expect(statusSymbol("better", 1, BAND)).toBe("▼");
  });

  it("kolory z ról: poniżej czerwień, powyżej fiolet, lepiej dodatni, brak - łupek", () => {
    expect(statusColor("below")).toBe("var(--chart-negative)");
    expect(statusColor("above")).toBe("var(--chart-warn)");
    expect(statusColor("better")).toBe("var(--chart-positive)");
    expect(statusColor("none")).toBe("var(--chart-s-alt)");
    // „W normie" jest tłem na wykresie, a odpowiedzią na mapie statusów.
    expect(statusColor("within")).toBe("var(--chart-s-main)");
    expect(statusColor("within", "heatmap")).toBe("var(--chart-positive)");
  });

  it("zdanie „Znaczenie” zależy od kierunku", () => {
    expect(meaningKey("below", "higher")).toBe("meaning.belowHigher");
    expect(meaningKey("below", null)).toBe("meaning.belowRange");
    expect(meaningKey("above", "lower")).toBe("meaning.aboveLower");
    expect(meaningKey("better", "lower")).toBe("meaning.betterLower");
    expect(meaningKey("none", "higher")).toBe("meaning.none");
  });
});

describe("zmiana względem poprzedniego punktu", () => {
  it("procent od wartości bezwzględnej poprzedniego punktu", () => {
    expect(percentChange(100, 120)).toBeCloseTo(20);
    expect(percentChange(-100, -50)).toBeCloseTo(50);
  });

  it("od zera albo bez poprzedniego punktu zmiany nie ma", () => {
    expect(percentChange(0, 5)).toBeNull();
    expect(percentChange(null, 5)).toBeNull();
  });

  it("ocena zmiany idzie za kierunkiem: wzrost kosztu jest zły", () => {
    expect(changeTone(5, "higher")).toBe("good");
    expect(changeTone(5, "lower")).toBe("bad");
    expect(changeTone(-5, "lower")).toBe("good");
    expect(changeTone(5, null)).toBe("neutral");
    expect(changeTone(0, "higher")).toBe("neutral");
  });

  it("strzałka mówi o znaku: ▲ ▼ ■", () => {
    expect(changeArrow(3)).toBe("▲");
    expect(changeArrow(-3)).toBe("▼");
    expect(changeArrow(0)).toBe("■");
    expect(changeArrow(null)).toBe("■");
  });
});

describe("domena osi z odniesieniami", () => {
  it("pasmo i cel poszerzają domenę - pasmo przycięte rysunkiem kłamie", () => {
    expect(referenceExtent(BAND, { value: 10 })).toEqual({ min: 2, max: 10 });
    expect(referenceExtent(null, null)).toBeNull();
    expect(extendDomain({ min: 0, max: 5 }, [{ min: 2, max: 10 }])).toEqual({ min: 0, max: 10 });
  });

  it("4% zapasu nad DODATNIM maksimum, nigdy nad zerem serii ujemnej", () => {
    expect(extendDomain({ min: 0, max: 100 }, [], 0.04).max).toBeCloseTo(104);
    expect(extendDomain({ min: -50, max: 0 }, [], 0.04).max).toBe(0);
  });
});
