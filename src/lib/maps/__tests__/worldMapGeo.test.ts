// Rachunek geometrii i harmonogramu widgetu „Mapa świata".
//
// To jest miejsce, w którym pilnujemy WIERNOŚCI pierwowzorowi: rzut punktu, łuk
// i podział cyklu na klatki są przepisane 1:1 z komponentu źródłowego, a
// framer-motion zastąpiły klatki CSS. Test porównuje wynik z liczbami
// wyprowadzonymi wprost ze wzorów pierwowzoru, więc podmiana wykonania nie może
// po cichu zmienić zachowania.
import { describe, it, expect } from "vitest";
import {
  ARC_PAUSE_S,
  ARC_STAGGER_S,
  MAP_VIEW_H,
  MAP_VIEW_W,
  arcKeyframes,
  arcTiming,
  coerceLat,
  coerceLng,
  createCurvedPath,
  projectPoint,
  resolveArcs,
  resolveMarkers,
} from "../worldMapGeo";

describe("projectPoint", () => {
  it("rzutuje (0,0) na środek płótna", () => {
    expect(projectPoint(0, 0)).toEqual({ x: MAP_VIEW_W / 2, y: MAP_VIEW_H / 2 });
  });

  it("rzutuje narożniki zakresu na krawędzie płótna", () => {
    expect(projectPoint(90, -180)).toEqual({ x: 0, y: 0 });
    expect(projectPoint(-90, 180)).toEqual({ x: MAP_VIEW_W, y: MAP_VIEW_H });
  });

  it("odwzorowuje wzór pierwowzoru dla punktu pośredniego (Bruksela)", () => {
    const lat = 50.85;
    const lng = 4.35;
    expect(projectPoint(lat, lng)).toEqual({
      x: (lng + 180) * (800 / 360),
      y: (90 - lat) * (400 / 180),
    });
  });
});

describe("createCurvedPath", () => {
  it("unosi wierzchołek 50 px ponad wyższy z końców", () => {
    const d = createCurvedPath({ x: 100, y: 200 }, { x: 300, y: 240 });
    // midX = 200, midY = min(200, 240) - 50 = 150
    expect(d).toBe("M 100.0 200.0 Q 200.0 150.0 300.0 240.0");
  });

  it("daje identyczny napis przy tych samych wejściach (SSR == klient)", () => {
    const a = createCurvedPath({ x: 1 / 3, y: 2 / 3 }, { x: 10 / 3, y: 20 / 3 });
    const b = createCurvedPath({ x: 1 / 3, y: 2 / 3 }, { x: 10 / 3, y: 20 / 3 });
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d{3,}\.\d{3,}/);
  });
});

describe("arcTiming", () => {
  it("liczy cykl jak pierwowzór: stagger * liczba + czas + pauza", () => {
    const timing = arcTiming(4, 2);
    expect(timing.drawS).toBeCloseTo(4 * ARC_STAGGER_S + 2, 6);
    expect(timing.cycleS).toBeCloseTo(timing.drawS + ARC_PAUSE_S, 6);
  });

  it("zamienia `times` pierwowzoru na procenty tego samego cyklu", () => {
    const count = 3;
    const duration = 2;
    const timing = arcTiming(count, duration);
    const total = count * 0.3 + duration;
    const full = total + 2;
    for (let i = 0; i < count; i++) {
      expect(timing.startPct(i)).toBeCloseTo(((i * 0.3) / full) * 100, 6);
      expect(timing.endPct(i)).toBeCloseTo(((i * 0.3 + duration) / full) * 100, 6);
    }
    expect(timing.resetPct).toBeCloseTo((total / full) * 100, 6);
  });

  it("nie wypuszcza procentów poza 0..100 przy skrajnym czasie", () => {
    const timing = arcTiming(8, 10);
    expect(timing.startPct(7)).toBeGreaterThanOrEqual(0);
    expect(timing.endPct(7)).toBeLessThanOrEqual(100);
  });
});

describe("arcKeyframes", () => {
  it("w pętli czeka, rysuje, stoi i wraca do stanu początkowego", () => {
    const timing = arcTiming(2, 1);
    const css = arcKeyframes("kf", 1, timing, true);
    expect(css).toContain("@keyframes kf{");
    expect(css).toContain("0%{stroke-dashoffset:1}");
    expect(css).toContain("100%{stroke-dashoffset:1}");
    expect(css).toContain(`${timing.startPct(1).toFixed(3)}%{stroke-dashoffset:1}`);
    expect(css).toContain(`${timing.endPct(1).toFixed(3)}%{stroke-dashoffset:0}`);
    expect(css).toContain(`${timing.resetPct.toFixed(3)}%{stroke-dashoffset:0}`);
  });

  it("bez pętli rysuje raz i zostaje narysowany", () => {
    const css = arcKeyframes("kf", 0, arcTiming(1, 1), false);
    expect(css).toBe("@keyframes kf{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}");
  });
});

describe("resolveArcs", () => {
  it("zwraca stabilne klucze i gotowe ścieżki", () => {
    const arcs = resolveArcs([
      { start: { lat: 50.85, lng: 4.35, label: "Bruksela" }, end: { lat: 52.23, lng: 21.01 } },
    ]);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].path.startsWith("M ")).toBe(true);
    expect(arcs[0].key).toContain("50.85,4.35");
    expect(arcs[0].startPoint).toEqual(projectPoint(50.85, 4.35));
  });
});

describe("resolveMarkers", () => {
  const arcsFromHub = (ends: Array<[number, number, string]>) =>
    resolveArcs(
      ends.map(([lat, lng, label]) => ({
        start: { lat: 50.85, lng: 4.35, label: "Bruksela" },
        end: { lat, lng, label },
      })),
    );

  it("scala powtórzony punkt startowy w jeden znacznik", () => {
    const markers = resolveMarkers(
      arcsFromHub([
        [52.23, 21.01, "Warszawa"],
        [52.52, 13.4, "Berlin"],
        [50.45, 30.52, "Kijów"],
      ]),
    );
    // 1 centrala + 3 cele, a nie 6 końców łuków.
    expect(markers).toHaveLength(4);
    expect(markers.filter((m) => m.point.label === "Bruksela")).toHaveLength(1);
  });

  it("nie gubi etykiety ani linku dopisanych przy późniejszym łuku", () => {
    const markers = resolveMarkers(
      resolveArcs([
        { start: { lat: 50.85, lng: 4.35 }, end: { lat: 52.23, lng: 21.01, label: "Warszawa" } },
        {
          start: { lat: 50.85, lng: 4.35, label: "Bruksela", href: "/o-nas" },
          end: { lat: 50.45, lng: 30.52, label: "Kijów" },
        },
      ]),
    );
    const hub = markers.find((m) => Math.abs(m.point.lng - 4.35) < 0.01);
    expect(hub?.point.label).toBe("Bruksela");
    expect(hub?.point.href).toBe("/o-nas");
  });

  it("rozkłada zbite etykiety na kolejne wiersze, a odległe zostawia w pierwszym", () => {
    const markers = resolveMarkers(
      arcsFromHub([
        [52.23, 21.01, "Warszawa"],
        [52.52, 13.4, "Berlin"],
        [38.9, -77.04, "Waszyngton"],
      ]),
    );
    const crowded = markers.filter((m) => m.point.lng > 0).map((m) => m.labelDy);
    expect(new Set(crowded).size).toBeGreaterThan(1);
    // Waszyngton nie ma z czym kolidować - zostaje w pierwszym wierszu.
    expect(markers.find((m) => m.point.label === "Waszyngton")?.labelDy).toBe(-8);
  });

  it("jest deterministyczne (SSR == klient)", () => {
    const build = () =>
      resolveMarkers(
        arcsFromHub([
          [52.23, 21.01, "Warszawa"],
          [52.52, 13.4, "Berlin"],
          [50.45, 30.52, "Kijów"],
        ]),
      ).map((m) => `${m.key}:${m.labelDy}`);
    expect(build()).toEqual(build());
  });

  it("punkt bez etykiety nie zajmuje wiersza", () => {
    const markers = resolveMarkers(
      resolveArcs([{ start: { lat: 50.85, lng: 4.35 }, end: { lat: 52.23, lng: 21.01 } }]),
    );
    expect(markers.every((m) => m.labelDy === -8)).toBe(true);
  });
});

describe("walidacja współrzędnych", () => {
  it("przyjmuje zakres i odrzuca resztę", () => {
    expect(coerceLat(0)).toBe(0);
    expect(coerceLat(-90)).toBe(-90);
    expect(coerceLat(90.1)).toBeNull();
    expect(coerceLng(180)).toBe(180);
    expect(coerceLng(-180.5)).toBeNull();
    expect(coerceLat("52.23")).toBe(52.23);
    expect(coerceLat("brak")).toBeNull();
    expect(coerceLng(undefined)).toBeNull();
  });
});
