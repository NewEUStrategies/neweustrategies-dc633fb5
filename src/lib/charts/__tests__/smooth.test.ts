// Wygładzanie linii. Dowód jest tu JEDEN i najważniejszy: krzywa NIE
// PRZESTRZELIWUJE poza przedział wyznaczony przez sąsiednie obserwacje.
//
// Bez tego dowodu zdanie "monotoniczny Hermite nie rysuje maksimów, których
// nie było" jest obietnicą w komentarzu. Z nim jest liczbą: `maxOvershoot`
// liczy ekstremum każdego odcinka Béziera analitycznie i musi zwrócić zero.
import { describe, expect, it } from "vitest";
import {
  SMOOTHING_DEFAULT,
  SMOOTHING_MIN_POINTS,
  curveSegments,
  isSmoothingActive,
  maxOvershoot,
  monotoneTangents,
  pathFromPoints,
  type Point,
} from "@/lib/charts/smooth";

/** Szereg, na którym Catmull-Rom przestrzeliwuje w sposób podręcznikowy. */
const PLATEAU: Point[] = [
  [0, 100],
  [10, 40],
  [20, 38],
  [30, 37],
  [40, 10],
];

describe("smooth - monotoniczność", () => {
  it("wygładzona krzywa NIE wychodzi poza przedział sąsiednich obserwacji", () => {
    expect(maxOvershoot(PLATEAU, SMOOTHING_DEFAULT)).toBeCloseTo(0, 6);
  });

  it("nie przestrzeliwuje na żadnej sile wygładzenia z zakresu", () => {
    for (const strength of [0, 0.25, 0.55, 0.8, 1]) {
      expect(maxOvershoot(PLATEAU, strength), `siła ${strength}`).toBeCloseTo(0, 6);
    }
  });

  it("nie przestrzeliwuje na szeregu ze zmianami kierunku ani na monotonicznym", () => {
    const zigzag: Point[] = [
      [0, 10],
      [10, 90],
      [20, 20],
      [30, 80],
      [40, 30],
    ];
    const rising: Point[] = [
      [0, 1],
      [10, 2],
      [20, 40],
      [30, 41],
      [40, 100],
    ];
    expect(maxOvershoot(zigzag)).toBeCloseTo(0, 6);
    expect(maxOvershoot(rising)).toBeCloseTo(0, 6);
  });

  it("styczna w ekstremum lokalnym jest POZIOMA - to jest cała monotoniczność", () => {
    // Punkt 1 to szczyt (rośnie, potem maleje), więc jego styczna musi być
    // zerowa. Gdyby nie była, krzywa wybiegłaby za szczyt.
    const tangents = monotoneTangents([
      [0, 0],
      [10, 10],
      [20, 0],
    ]);
    expect(tangents[1]).toBe(0);
  });

  it("styczna na odcinku o zerowym nachyleniu też jest zerowa", () => {
    const tangents = monotoneTangents([
      [0, 5],
      [10, 5],
      [20, 9],
    ]);
    expect(tangents[1]).toBe(0);
  });

  it("dwa punkty w tej samej kolumnie nie rodzą NaN", () => {
    const tangents = monotoneTangents([
      [0, 0],
      [0, 10],
      [10, 20],
    ]);
    for (const t of tangents) expect(Number.isFinite(t)).toBe(true);
  });
});

describe("smooth - siła i warunki wyłączenia", () => {
  it("siła 0 daje łamaną: same polecenia L, zero krzywych", () => {
    const path = pathFromPoints(PLATEAU, 0);
    expect(path).toContain("L");
    expect(path).not.toContain("C");
  });

  it("siła domyślna daje krzywe", () => {
    expect(pathFromPoints(PLATEAU, SMOOTHING_DEFAULT)).toContain("C");
  });

  it("poniżej czterech punktów wygładzanie jest wyłączane BEZWARUNKOWO", () => {
    // Trzy obserwacje to nie trend, to dwa odcinki - krzywa opowiadałaby
    // o kształcie, którego dane nie potwierdzają.
    const three: Point[] = [
      [0, 0],
      [10, 10],
      [20, 5],
    ];
    expect(pathFromPoints(three, 1)).not.toContain("C");
    expect(isSmoothingActive(3, 1)).toBe(false);
    expect(isSmoothingActive(SMOOTHING_MIN_POINTS, 1)).toBe(true);
    expect(isSmoothingActive(10, 0)).toBe(false);
  });

  it("siła jest klamrowana do 0..1", () => {
    expect(curveSegments(PLATEAU, 5)).toEqual(curveSegments(PLATEAU, 1));
    expect(curveSegments(PLATEAU, -3)).toEqual(curveSegments(PLATEAU, 0));
  });

  it("siła 0 i 1 to KOŃCE tej samej interpolacji punktów kontrolnych", () => {
    // Przy 0 punkty kontrolne leżą na cięciwie (wariant prosty), przy 1 na
    // stycznych (wariant krzywy). Wartość pośrednia musi leżeć między nimi -
    // inaczej jedna stała nie steruje kształtem.
    const [flat] = curveSegments(PLATEAU, 0);
    const [curved] = curveSegments(PLATEAU, 1);
    const [half] = curveSegments(PLATEAU, 0.5);
    const between = (a: number, b: number, m: number): boolean =>
      m >= Math.min(a, b) - 1e-9 && m <= Math.max(a, b) + 1e-9;
    expect(between(flat.c1[1], curved.c1[1], half.c1[1])).toBe(true);
    expect(between(flat.c2[1], curved.c2[1], half.c2[1])).toBe(true);
  });
});

describe("smooth - ścieżka SVG", () => {
  it("pusty i jednopunktowy ciąg nie rodzą śmieci", () => {
    expect(pathFromPoints([], 0.55)).toBe("");
    expect(pathFromPoints([[12.34, 56.78]], 0.55)).toBe("M12.3 56.8");
    expect(curveSegments([[0, 0]], 0.55)).toEqual([]);
  });

  it("liczba odcinków to liczba punktów minus jeden", () => {
    expect(curveSegments(PLATEAU, 0.55)).toHaveLength(PLATEAU.length - 1);
  });

  it("współrzędne mają jedno miejsce po przecinku - ścieżka nie puchnie", () => {
    const path = pathFromPoints(
      [
        [1.23456, 2.34567],
        [11.111, 22.222],
        [33.333, 44.444],
        [55.555, 66.666],
      ],
      0.55,
    );
    expect(path).not.toMatch(/\d\.\d\d/);
  });

  it("punkty końcowe odcinka są DOKŁADNIE obserwacjami, nie przybliżeniem", () => {
    // Wygładzanie wolno zmienić drogę MIĘDZY punktami, nigdy same punkty.
    for (const seg of curveSegments(PLATEAU, 0.55)) {
      expect(PLATEAU).toContainEqual(seg.from);
      expect(PLATEAU).toContainEqual(seg.to);
    }
  });
});
