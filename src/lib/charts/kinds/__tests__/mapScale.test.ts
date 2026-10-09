// MODEL SKALI MAPY - przypadki, które w renderze nie są widoczne jako błąd,
// tylko jako mapa, która mówi coś innego niż dane: kwantyle zlepione przez
// duplikaty, klasa pusta z definicji, zmyślone maksimum przy jednej wartości,
// środek rozbieżny w przypadkowym przedziale, ciągła skala, która po cichu
// zmieniła odcienie opublikowanych map.
import { describe, expect, it } from "vitest";
import { MAP_CONTINUOUS_FLOOR, mapScale } from "@/lib/charts/kinds/mapScale";
import {
  MAP_CLASSES_MAX,
  MAP_CLASSES_MIN,
  MAP_SEQUENTIAL_SCHEMES,
  type MapScheme,
} from "@/lib/charts/types";

/** Udział końca maksymalnego zapisany w wyrażeniu koloru (0..100). */
function shareOf(color: string, scheme: string): number {
  if (color === `var(--chart-map-${scheme}-min)`) return 0;
  if (color === `var(--chart-map-${scheme}-max)`) return 100;
  const m = new RegExp(
    `^color-mix\\(in oklab, var\\(--chart-map-${scheme}-max\\) (\\d+)%, var\\(--chart-map-${scheme}-min\\)\\)$`,
  ).exec(color);
  if (!m) throw new Error(`nieoczekiwany kolor: ${color}`);
  return Number(m[1]);
}

/** Położenie koloru rozbieżnego: -100 (pełny ujemny) .. 0 (środek) .. 100. */
function divergingOf(color: string): number {
  if (color === "var(--chart-map-div-mid)") return 0;
  if (color === "var(--chart-negative)") return -100;
  if (color === "var(--chart-positive)") return 100;
  const m =
    /^color-mix\(in oklab, var\(--chart-(negative|positive)\) (\d+)%, var\(--chart-map-div-mid\)\)$/.exec(
      color,
    );
  if (!m) throw new Error(`nieoczekiwany kolor: ${color}`);
  return (m[1] === "negative" ? -1 : 1) * Number(m[2]);
}

describe("mapScale - skala ciągła (classes = 0)", () => {
  it("odtwarza wzór sprzed modelu: podłoga 15%, liniowo do 100%", () => {
    // Opublikowane mapy nie mają klucza `classes` i dostają skalę ciągłą -
    // każdy odcień musi być TEN SAM co przed wprowadzeniem modelu.
    const values = [10, 20, 30, 40, 110];
    const s = mapScale(values, "blue", 0, "quantile", null);
    expect(s.kind).toBe("continuous");
    expect(s.domain).toEqual([10, 110]);
    for (const v of values) {
      const expected = Math.round((MAP_CONTINUOUS_FLOOR + 0.85 * ((v - 10) / 100)) * 100);
      expect(shareOf(s.colorOf(v), "blue"), `wartość ${v}`).toBe(expected);
    }
    expect(s.colorOf(110)).toBe("var(--chart-map-blue-max)");
    expect(s.colorOf(10)).toBe(
      "color-mix(in oklab, var(--chart-map-blue-max) 15%, var(--chart-map-blue-min))",
    );
    expect(s.classIndexOf(30)).toBeNull();
    expect(s.midpoint).toBeNull();
  });

  it("legenda dostaje dwa przystanki: minimum i maksimum", () => {
    const s = mapScale([3, 9, 6], "teal", 0, "equal", null);
    expect(s.classes.map((c) => c.from)).toEqual([3, 9]);
    expect(s.classes[0].color).toBe(s.colorOf(3));
    expect(s.classes[1].color).toBe("var(--chart-map-teal-max)");
  });

  it("jedna wartość albo wszystkie równe: bez zmyślonej rozpiętości, podłoga rampu", () => {
    for (const values of [[7], [5, 5, 5]]) {
      const s = mapScale(values, "blue", 0, "quantile", null);
      expect(s.domain[0]).toBe(s.domain[1]);
      expect(shareOf(s.colorOf(values[0]), "blue")).toBe(15);
    }
  });

  it("wartości ujemne mają tę samą skalę co dodatnie", () => {
    const s = mapScale([-40, -10, 0, 20], "slate", 0, "quantile", null);
    expect(s.domain).toEqual([-40, 20]);
    expect(shareOf(s.colorOf(-40), "slate")).toBe(15);
    expect(shareOf(s.colorOf(20), "slate")).toBe(100);
    expect(shareOf(s.colorOf(-10), "slate")).toBe(Math.round((0.15 + 0.85 * 0.5) * 100));
  });

  it("kolor rośnie monotonicznie z wartością w każdej rampie", () => {
    const values = [-3, 0, 1, 1, 2, 8, 13, 21, 55];
    for (const scheme of MAP_SEQUENTIAL_SCHEMES) {
      const s = mapScale(values, scheme, 0, "quantile", null);
      const shares = values.map((v) => shareOf(s.colorOf(v), scheme));
      for (let i = 1; i < shares.length; i += 1) {
        expect(shares[i], `${scheme} ${values[i]}`).toBeGreaterThanOrEqual(shares[i - 1]);
      }
    }
  });

  it("rozbieżna: środek neutralny, ta sama odległość = ten sam kolor po obu stronach", () => {
    const s = mapScale([-5, -2, 0, 2, 10], "diverging", 0, "quantile", null);
    expect(s.midpoint).toBe(0);
    expect(s.colorOf(0)).toBe("var(--chart-map-div-mid)");
    expect(s.colorOf(10)).toBe("var(--chart-positive)");
    // Zasięg mierzy dalsza strona (10), więc -5 to połowa ujemnego.
    expect(divergingOf(s.colorOf(-5))).toBe(-50);
    expect(divergingOf(s.colorOf(-2))).toBe(-divergingOf(s.colorOf(2)));
    // Trzy przystanki legendy: minimum, środek, maksimum.
    expect(s.classes.map((c) => c.from)).toEqual([-5, 0, 10]);
    expect(s.classes[1].color).toBe("var(--chart-map-div-mid)");
  });

  it("rozbieżna wokół zadanego punktu środkowego (np. średniej UE)", () => {
    const s = mapScale([80, 95, 100, 120], "diverging", 0, "equal", 100);
    expect(s.midpoint).toBe(100);
    expect(s.colorOf(100)).toBe("var(--chart-map-div-mid)");
    expect(s.colorOf(120)).toBe("var(--chart-positive)");
    expect(s.colorOf(80)).toBe("var(--chart-negative)");
    expect(divergingOf(s.colorOf(95))).toBe(-25);
  });

  it("środek poza domeną: dwa przystanki legendy, kolory tylko po jednej stronie", () => {
    const s = mapScale([2, 4, 8], "diverging", 0, "quantile", null);
    expect(s.classes).toHaveLength(2);
    expect(divergingOf(s.colorOf(2))).toBeGreaterThan(0);
    expect(s.colorOf(8)).toBe("var(--chart-positive)");
  });
});

describe("mapScale - klasy kwantylowe", () => {
  it("pięć klas z dziesięciu wartości: po dwa kraje w klasie", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const s = mapScale(values, "blue", 5, "quantile", null);
    expect(s.kind).toBe("classed");
    expect(s.classes).toHaveLength(5);
    const counts = [0, 0, 0, 0, 0];
    for (const v of values) counts[s.classIndexOf(v) as number] += 1;
    expect(counts).toEqual([2, 2, 2, 2, 2]);
    // Krańce klas sklejają się bez szczeliny, pierwsza od minimum, ostatnia do maksimum.
    expect(s.classes[0].from).toBe(1);
    expect(s.classes[4].to).toBe(10);
    for (let i = 1; i < s.classes.length; i += 1) {
      expect(s.classes[i].from).toBe(s.classes[i - 1].to);
    }
  });

  it("kolory klas idą od końca minimalnego do maksymalnego, po równych krokach", () => {
    const s = mapScale([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "violet", 5, "quantile", null);
    expect(s.classes.map((c) => shareOf(c.color, "violet"))).toEqual([0, 25, 50, 75, 100]);
    expect(s.classes[0].color).toBe("var(--chart-map-violet-min)");
    expect(s.classes[4].color).toBe("var(--chart-map-violet-max)");
  });

  it("duplikaty zlepiają kwantyle - klas jest mniej, ale żadna nie jest pusta z definicji", () => {
    const values = [1, 1, 1, 1, 1, 1, 2, 3, 9];
    const s = mapScale(values, "blue", 5, "quantile", null);
    expect(s.classes.length).toBeLessThan(5);
    expect(s.classes.length).toBeGreaterThanOrEqual(2);
    // Granice rosną ściśle.
    for (const c of s.classes) expect(c.to).toBeGreaterThan(c.from);
    // Każda klasa ma co najmniej jeden kraj.
    const used = new Set(values.map((v) => s.classIndexOf(v)));
    expect(used.size).toBe(s.classes.length);
    // Wszystkie jedynki w jednej klasie - tej pierwszej.
    expect(s.classIndexOf(1)).toBe(0);
    // Kolory nadal rozpięte na całą rampę.
    expect(shareOf(s.classes[0].color, "blue")).toBe(0);
    expect(shareOf(s.classes[s.classes.length - 1].color, "blue")).toBe(100);
  });

  it("wartość równa granicy należy do klasy WYŻSZEJ (granica = „od”)", () => {
    const s = mapScale([0, 10, 20, 30], "blue", 3, "equal", null);
    expect(s.classes.map((c) => [c.from, c.to])).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
    ]);
    expect(s.classIndexOf(10)).toBe(1);
    expect(s.classIndexOf(9.999)).toBe(0);
    expect(s.classIndexOf(30)).toBe(2);
  });

  it("jedna wartość: jedna klasa w pełnym kolorze, bez zmyślonego przedziału", () => {
    const s = mapScale([42], "accent", 5, "quantile", null);
    expect(s.classes).toEqual([{ from: 42, to: 42, color: "var(--chart-map-accent-max)" }]);
    expect(s.classIndexOf(42)).toBe(0);
    expect(s.colorOf(42)).toBe("var(--chart-map-accent-max)");
  });

  it("wszystkie wartości równe: jedna klasa, dla obu metod", () => {
    for (const method of ["quantile", "equal"] as const) {
      const s = mapScale([3, 3, 3, 3], "teal", 4, method, null);
      expect(s.classes).toHaveLength(1);
      expect(s.domain).toEqual([3, 3]);
    }
  });

  it("wartości ujemne dzielą się jak dodatnie", () => {
    const s = mapScale([-50, -40, -30, -20, -10, 0], "slate", 3, "quantile", null);
    expect(s.classes).toHaveLength(3);
    expect(s.classIndexOf(-50)).toBe(0);
    expect(s.classIndexOf(0)).toBe(2);
  });

  it("kolor klasy rośnie monotonicznie z wartością", () => {
    const values = [0.1, 0.4, 2, 2, 3.5, 7, 7, 7, 12, 19, 40, 41];
    for (const method of ["quantile", "equal"] as const) {
      for (let k = MAP_CLASSES_MIN; k <= MAP_CLASSES_MAX; k += 1) {
        const s = mapScale(values, "blue", k, method, null);
        const shares = values.map((v) => shareOf(s.colorOf(v), "blue"));
        for (let i = 1; i < shares.length; i += 1) {
          expect(shares[i], `${method} k=${k} ${values[i]}`).toBeGreaterThanOrEqual(shares[i - 1]);
        }
      }
    }
  });
});

describe("mapScale - klasy równe", () => {
  it("równe przedziały między minimum a maksimum, odstający kraj zostawia klasy puste", () => {
    const values = [1, 2, 3, 4, 100];
    const s = mapScale(values, "blue", 4, "equal", null);
    expect(s.classes.map((c) => c.from)).toEqual([1, 25.75, 50.5, 75.25]);
    expect(values.map((v) => s.classIndexOf(v))).toEqual([0, 0, 0, 0, 3]);
  });
});

describe("mapScale - klasy rozbieżne", () => {
  it("równe przedziały SYMETRYCZNE wokół środka, klasa środkowa neutralna", () => {
    const s = mapScale([-2, 1, 4, 10], "diverging", 5, "equal", 0);
    // Zasięg = 10 (dalsza strona), skala od -10 do 10, pięć klas po 4.
    expect(s.classes.map((c) => [c.from, c.to])).toEqual([
      [-10, -6],
      [-6, -2],
      [-2, 2],
      [2, 6],
      [6, 10],
    ]);
    expect(s.classes.map((c) => divergingOf(c.color))).toEqual([-100, -50, 0, 50, 100]);
    expect(s.classIndexOf(-2)).toBe(2);
    expect(s.classIndexOf(1)).toBe(2);
    expect(s.colorOf(10)).toBe("var(--chart-positive)");
    // Domena to dane, nie symetryczna skala.
    expect(s.domain).toEqual([-2, 10]);
  });

  it("parzysta liczba klas: środek jest granicą, dwie klasy przy nim blade po swoich stronach", () => {
    const s = mapScale([-4, -1, 1, 4], "diverging", 4, "equal", null);
    const pos = s.classes.map((c) => divergingOf(c.color));
    expect(pos[0]).toBe(-100);
    expect(pos[3]).toBe(100);
    expect(pos[1]).toBeLessThan(0);
    expect(pos[2]).toBeGreaterThan(0);
    expect(pos[1]).toBe(-pos[2]);
  });

  it("kwantyle rozbieżne: kolor wg środka klasy względem punktu środkowego", () => {
    const values = [-9, -6, -3, -1, 1, 2, 3, 4, 5, 6];
    const s = mapScale(values, "diverging", 5, "quantile", 0);
    const pos = values.map((v) => divergingOf(s.colorOf(v)));
    for (let i = 1; i < pos.length; i += 1) expect(pos[i]).toBeGreaterThanOrEqual(pos[i - 1]);
    expect(pos[0]).toBe(-100);
    expect(divergingOf(s.classes[s.classes.length - 1].color)).toBeGreaterThan(0);
  });

  it("wszystkie wartości w środku: jedna klasa neutralna", () => {
    const s = mapScale([5, 5], "diverging", 5, "equal", 5);
    expect(s.classes).toEqual([{ from: 5, to: 5, color: "var(--chart-map-div-mid)" }]);
  });
});

describe("mapScale - dane brzegowe", () => {
  it("brak wartości: pusta legenda, brak klasy, kolor neutralny", () => {
    const schemes: MapScheme[] = ["blue", "diverging"];
    for (const scheme of schemes) {
      for (const classes of [0, 5]) {
        const s = mapScale([], scheme, classes, "quantile", null);
        expect(s.classes).toEqual([]);
        expect(s.domain).toEqual([0, 0]);
        expect(s.classIndexOf(1)).toBeNull();
        expect(typeof s.colorOf(1)).toBe("string");
      }
    }
  });

  it("NaN i nieskończoność nie rozciągają domeny", () => {
    const s = mapScale([1, Number.NaN, 5, Number.POSITIVE_INFINITY], "blue", 0, "equal", null);
    expect(s.domain).toEqual([1, 5]);
    expect(mapScale([1, 5], "blue", 3, "equal", null).classIndexOf(Number.NaN)).toBeNull();
  });

  it("liczba klas spoza 3..7 jest dociskana, zero i ujemna dają skalę ciągłą", () => {
    const values = Array.from({ length: 20 }, (_, i) => i);
    expect(mapScale(values, "blue", 1, "equal", null).classes).toHaveLength(MAP_CLASSES_MIN);
    expect(mapScale(values, "blue", 12, "equal", null).classes).toHaveLength(MAP_CLASSES_MAX);
    expect(mapScale(values, "blue", -2, "equal", null).kind).toBe("continuous");
    expect(mapScale(values, "blue", Number.NaN, "equal", null).kind).toBe("continuous");
  });

  it("kolory są wyłącznie wyrażeniami na tokenach - żadnego hexa", () => {
    const values = [-3, 0, 2, 7, 11];
    for (const scheme of [...MAP_SEQUENTIAL_SCHEMES, "diverging"] as const) {
      for (const classes of [0, 3, 7]) {
        const s = mapScale(values, scheme, classes, "quantile", null);
        for (const c of s.classes) expect(c.color).toMatch(/^(var|color-mix)\(/);
        for (const v of values) expect(s.colorOf(v)).not.toMatch(/#[0-9a-f]{3,6}/i);
      }
    }
  });
});
