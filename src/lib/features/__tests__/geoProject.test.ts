import { describe, it, expect } from "vitest";
import { makeGeoProjector, corridorPath } from "../geoProject";
import type { GeoProjectionMeta } from "@/lib/charts/types";

// Metadane projekcji Europy - odczytane z public/geo/europe-50m.v1.json
// (LAEA, środek 52°N/10°E). Trzymać w zgodzie z generatorem, gdyby fit się zmienił.
const EUROPE_PROJ: GeoProjectionMeta = {
  type: "laea",
  lat0: 52,
  lon0: 10,
  minX: -0.26391015006089324,
  minY: -0.39553748746043516,
  scale: 1141.516660038249,
  padding: 8,
};

describe("makeGeoProjector", () => {
  it("returns null when projection metadata is missing", () => {
    expect(makeGeoProjector(undefined)).toBeNull();
  });

  it("projects the LAEA center to a sensible interior point of the canvas", () => {
    const project = makeGeoProjector(EUROPE_PROJ)!;
    expect(project).toBeTypeOf("function");
    // Środek projekcji to 10°E/52°N; okno Europy to lon -25..50.5, więc 10°E
    // wypada nieco na lewo od środka poziomego. Sprawdzamy, że to punkt
    // wewnętrzny kanwy 960x825 (kalibracja: ~x=309, ~y=345).
    const center = project(10, 52);
    expect(center.x).toBeGreaterThan(150);
    expect(center.x).toBeLessThan(560);
    expect(center.y).toBeGreaterThan(150);
    expect(center.y).toBeLessThan(560);
  });

  it("places Warsaw inside the Europe viewBox and east of Madrid", () => {
    const project = makeGeoProjector(EUROPE_PROJ)!;
    const warsaw = project(21.01, 52.23);
    const madrid = project(-3.7, 40.42);
    // Oba punkty mieszczą się w kanwie 960x825.
    for (const p of [warsaw, madrid]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(960);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(825);
    }
    // Warszawa jest na wschód od Madrytu (większe x) i wyżej (mniejsze y).
    expect(warsaw.x).toBeGreaterThan(madrid.x);
    expect(warsaw.y).toBeLessThan(madrid.y);
  });
});

describe("corridorPath", () => {
  it("returns empty string for no points", () => {
    expect(corridorPath([])).toBe("");
  });
  it("emits a lone moveto for a single point", () => {
    expect(corridorPath([{ x: 5, y: 6 }])).toBe("M5.0 6.0");
  });
  it("emits quadratic segments between waypoints", () => {
    const d = corridorPath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 10 },
    ]);
    expect(d.startsWith("M0.0 0.0")).toBe(true);
    expect((d.match(/Q/g) ?? []).length).toBe(2);
  });
});
