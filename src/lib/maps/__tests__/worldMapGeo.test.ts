// Rachunek geometrii i harmonogramu widgetu „Mapa świata".
//
// To jest miejsce, w którym pilnujemy WIERNOŚCI pierwowzorowi: rzut punktu, łuk
// i podział cyklu na klatki są przepisane 1:1 z komponentu źródłowego, a
// framer-motion zastąpiły klatki CSS. Test porównuje wynik z liczbami
// wyprowadzonymi wprost ze wzorów pierwowzoru, więc podmiana wykonania nie może
// po cichu zmienić zachowania.
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ARC_LIFT_MAX,
  ARC_PAUSE_S,
  ARC_STAGGER_S,
  WORLD_DOTS_URL,
  arcLift,
  assignLabelRows,
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
  fitViewBox,
  opticalScale,
  pointPercent,
  sparkKeyframes,
  WORLD_VIEW_BOX,
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
    expect(css).toContain("0%{stroke-dashoffset:1;opacity:1}");
    expect(css).toContain(`${timing.startPct(1).toFixed(3)}%{stroke-dashoffset:1;opacity:1`);
    expect(css).toContain(`${timing.endPct(1).toFixed(3)}%{stroke-dashoffset:0;opacity:1}`);
    expect(css).toContain(`${timing.resetPct.toFixed(3)}%{stroke-dashoffset:0;opacity:1}`);
    // Łuk gaśnie na końcu cyklu zamiast znikać skokiem.
    expect(css).toContain("100%{stroke-dashoffset:0;opacity:0}");
  });

  it("samo rysowanie jest wyprowadzone krzywą, a harmonogram zostaje liniowy", () => {
    const timing = arcTiming(2, 1);
    const css = arcKeyframes("kf", 0, timing, true);
    // Krzywa siedzi w klatce STARTU (dotyczy odcinka start -> end), nie w 0%.
    const startFrame = css.slice(css.indexOf(`${timing.startPct(0).toFixed(3)}%`));
    expect(startFrame.startsWith(`${timing.startPct(0).toFixed(3)}%{`)).toBe(true);
    expect(startFrame).toContain("animation-timing-function:cubic-bezier");
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
      WORLD_VIEW_BOX,
    );
    const crowded = markers.filter((m) => m.point.lng > 0).map((m) => m.labelRow);
    expect(new Set(crowded).size).toBeGreaterThan(1);
    // Waszyngton nie ma z czym kolidować - zostaje w pierwszym wierszu.
    expect(markers.find((m) => m.point.label === "Waszyngton")?.labelRow).toBe(0);
  });

  it("jest deterministyczne (SSR == klient)", () => {
    const build = () =>
      resolveMarkers(
        arcsFromHub([
          [52.23, 21.01, "Warszawa"],
          [52.52, 13.4, "Berlin"],
          [50.45, 30.52, "Kijów"],
        ]),
      ).map((m) => `${m.key}:${m.labelRow}`);
    expect(build()).toEqual(build());
  });

  it("punkt bez etykiety nie zajmuje wiersza", () => {
    const markers = resolveMarkers(
      resolveArcs([{ start: { lat: 50.85, lng: 4.35 }, end: { lat: 52.23, lng: 21.01 } }]),
    );
    expect(markers.every((m) => m.labelRow === 0)).toBe(true);
  });
});

describe("fitViewBox", () => {
  const brussels = projectPoint(50.85, 4.35);
  const warsaw = projectPoint(52.23, 21.01);
  const washington = projectPoint(38.9, -77.04);

  it("tryb `world` zwraca całe płótno", () => {
    expect(fitViewBox([brussels, warsaw], "world")).toEqual(WORLD_VIEW_BOX);
  });

  it("bez punktów degraduje do całego świata (nie do kadru zerowej wielkości)", () => {
    expect(fitViewBox([], "auto")).toEqual(WORLD_VIEW_BOX);
  });

  it("`auto` przybliża do punktów, ale nie ciaśniej niż próg czytelności", () => {
    const view = fitViewBox([brussels, warsaw], "auto");
    expect(view.w).toBeLessThan(MAP_VIEW_W);
    expect(view.w).toBeGreaterThanOrEqual(150);
    // Oba punkty muszą zostać w kadrze, z zapasem na etykiety.
    for (const p of [brussels, warsaw]) {
      expect(p.x).toBeGreaterThan(view.x);
      expect(p.x).toBeLessThan(view.x + view.w);
      expect(p.y).toBeGreaterThan(view.y);
      expect(p.y).toBeLessThan(view.y + view.h);
    }
  });

  it("mieści łuk wznoszący się 50 jednostek nad wyższym końcem", () => {
    const view = fitViewBox([brussels, warsaw], "auto");
    expect(view.y).toBeLessThan(Math.min(brussels.y, warsaw.y) - 50);
  });

  it("trzyma proporcję płótna i nie wychodzi poza świat", () => {
    for (const pts of [[brussels], [brussels, washington], [warsaw]]) {
      const view = fitViewBox(pts, "auto");
      expect(view.w / view.h).toBeCloseTo(MAP_VIEW_W / MAP_VIEW_H, 6);
      expect(view.x).toBeGreaterThanOrEqual(0);
      expect(view.y).toBeGreaterThanOrEqual(0);
      expect(view.x + view.w).toBeLessThanOrEqual(MAP_VIEW_W + 1e-6);
      expect(view.y + view.h).toBeLessThanOrEqual(MAP_VIEW_H + 1e-6);
    }
  });

  it("kadr Europy obejmuje Brukselę i Warszawę, a nie Waszyngton", () => {
    const view = fitViewBox([], "europe");
    const inside = (p: { x: number; y: number }) =>
      p.x >= view.x && p.x <= view.x + view.w && p.y >= view.y && p.y <= view.y + view.h;
    expect(inside(brussels)).toBe(true);
    expect(inside(warsaw)).toBe(true);
    expect(inside(washington)).toBe(false);
  });

  it("skala optyczna maleje przy zbliżeniu (grubości linii nie puchną)", () => {
    expect(opticalScale(WORLD_VIEW_BOX)).toBe(1);
    expect(opticalScale(fitViewBox([brussels, warsaw], "auto"))).toBeLessThan(1);
  });

  it("pozycja procentowa punktu jest liczona względem kadru", () => {
    const view = fitViewBox([brussels, warsaw], "auto");
    const pct = pointPercent(view, brussels);
    expect(pct.left).toBeGreaterThan(0);
    expect(pct.left).toBeLessThan(100);
    expect(pointPercent(WORLD_VIEW_BOX, { x: 400, y: 200 })).toEqual({ left: 50, top: 50 });
  });
});

describe("sparkKeyframes", () => {
  it("iskra biegnie w oknie rysowania łuku i poza nim jest wygaszona", () => {
    const timing = arcTiming(2, 1);
    const css = sparkKeyframes("sp", 1, timing, true);
    expect(css).toContain("@keyframes sp{");
    expect(css).toContain("0%{stroke-dasharray:0.060 0.940;stroke-dashoffset:0.060;opacity:0}");
    expect(css).toContain(`${timing.endPct(1).toFixed(3)}%`);
    expect(css.trimEnd().endsWith("opacity:0}}")).toBe(true);
  });

  it("bez pętli przebiega raz od startu do końca trasy", () => {
    const css = sparkKeyframes("sp", 0, arcTiming(1, 1), false);
    expect(css).toContain("stroke-dashoffset:-1");
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

// ---------------------------------------------------------------------------
// DOMKNIĘCIE BRZEGÓW (dopisane 2026-09-02).
//
// Powyżej stoi dowód WIERNOŚCI pierwowzorowi. Poniżej - brzegi, których
// pierwowzór nie miał, bo nie miał ani kadrowania, ani rozkładania etykiet:
// klamry procentów, dociśnięcia wzniesienia łuku, zawijanie wierszy etykiet
// oraz trzy gałęzie kadru osiągalne WYŁĄCZNIE przez trzeci argument
// `fitViewBox` (proporcję inną niż 2:1). Ten argument istnieje dla wołającego,
// który rysuje mapę w innym kształcie niż widget - i to jego ścieżki tu domykamy.
// ---------------------------------------------------------------------------

describe("arcLift - trzy reżimy wzniesienia łuku", () => {
  it.each([
    // [cięciwa, oczekiwane wzniesienie, dlaczego]
    [0, 16, "punkty tożsame - podłoga, nie zero (płaska kreska zamiast łuku)"],
    [10, 16, "para bliskich miast - podłoga, inaczej łuk byłby niewidoczny"],
    [60, 18, "reżim proporcjonalny - 0,3 cięciwy"],
    [100, 30, "reżim proporcjonalny - 0,3 cięciwy"],
    [200, 50, "sufit pierwowzoru - łuk nie robi się pionową pętlą"],
  ])("cięciwa %i px -> wzniesienie %i (%s)", (chord, expected) => {
    // KONSEKWENCJA podłogi: Bruksela - Berlin (cięciwa ~20 px) przy wzniesieniu
    // proporcjonalnym dałaby 6 px, czyli linię prostą - rysunek przestaje
    // czytać się jako trasa. KONSEKWENCJA sufitu: para Bruksela - Sydney przy
    // wzniesieniu proporcjonalnym wyskakuje łukiem ponad kadr.
    expect(arcLift({ x: 0, y: 0 }, { x: chord, y: 0 })).toBeCloseTo(expected, 6);
  });

  it("wzniesienie liczy CIĘCIWĘ, a nie różnicę na jednej osi", () => {
    // Trójkąt 30-40-50: wzniesienie musi wyjść z przeciwprostokątnej (50*0,3=15
    // -> podłoga 16), a nie z boku 40 (40*0,3=12) ani 30.
    expect(arcLift({ x: 0, y: 0 }, { x: 30, y: 40 })).toBe(16);
    expect(arcLift({ x: 0, y: 0 }, { x: 120, y: 160 })).toBe(50); // hipot 200
  });

  it("`createCurvedPath` respektuje podane wzniesienie, nie tylko stałą domyślną", () => {
    const start = { x: 100, y: 200 };
    const end = { x: 140, y: 200 };
    // KONSEKWENCJA: gdyby `resolveArcs` gubiło trzeci argument, wszystkie łuki
    // wróciłyby do stałej 50 px z pierwowzoru i bliskie pary znów byłyby pętlami.
    expect(createCurvedPath(start, end, arcLift(start, end))).toBe(
      "M 100.0 200.0 Q 120.0 184.0 140.0 200.0",
    );
    expect(createCurvedPath(start, end)).toBe("M 100.0 200.0 Q 120.0 150.0 140.0 200.0");
  });
});

describe("arcTiming - brzegi czasu", () => {
  it.each([
    [0, "zero"],
    [-5, "wartość ujemna"],
  ])("czas rysowania %i (%s) schodzi na 0,1 s, a nie na cykl zerowej długości", (duration) => {
    const timing = arcTiming(1, duration);
    // KONSEKWENCJA: `cycleS === 0` daje `animation-duration:0s` i dzielenie
    // przez zero w `pct` (NaN w procentach klatki), czyli reguła @keyframes
    // odrzucona przez przeglądarkę - łuki nie rysują się WCALE.
    expect(timing.drawS).toBeCloseTo(ARC_STAGGER_S + 0.1, 6);
    expect(timing.cycleS).toBeCloseTo(ARC_STAGGER_S + 0.1 + ARC_PAUSE_S, 6);
    expect(timing.endPct(0)).toBeCloseTo((0.1 / timing.cycleS) * 100, 6);
    expect(Number.isNaN(timing.endPct(0))).toBe(false);
  });

  it("klamry `pct` dociskają indeks spoza harmonogramu do 0 i do 100", () => {
    const timing = arcTiming(1, 1);
    // Indeks ujemny i absurdalnie wysoki nie są osiągalne z pętli renderującej,
    // ale `startPct`/`endPct` są PUBLICZNE - `arcKeyframes` i `sparkKeyframes`
    // wołają je z zewnątrz. KONSEKWENCJA braku klamry: procent poza 0..100
    // unieważnia CAŁĄ regułę @keyframes, więc animacja znika, a nie „psuje się
    // trochę".
    expect(timing.startPct(-1)).toBe(0);
    expect(timing.endPct(1000)).toBe(100);
  });
});

describe("sparkKeyframes - harmonogram zdegenerowany", () => {
  it("okno odwrócone (koniec przed startem) nadal daje procenty w 0..100", () => {
    // Taki harmonogram nie powstaje w produkcji (duration >= 0,1 gwarantuje
    // end > start), ale `ArcTiming` jest typem publicznym i nic nie broni
    // wołającemu podać własnego. KONSEKWENCJA braku klamer `Math.min`/`Math.max`
    // na wygaszaniu: klatka na -7% albo 112% unieważnia regułę i iskra ginie.
    const degenerate = {
      cycleS: 1,
      drawS: 1,
      startPct: () => 60,
      endPct: () => 20,
      resetPct: 100,
    };
    const css = sparkKeyframes("sp", 0, degenerate, true);
    const percents = [...css.matchAll(/(\d+(?:\.\d+)?)%\{/g)].map((m) => Number(m[1]));
    expect(percents.length).toBeGreaterThan(0);
    for (const p of percents) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
    // Wygaszanie zostaje DOMKNIĘTE w oknie [koniec, start], nie wychodzi za nie.
    expect(css).toContain("20.000%");
    expect(css).toContain("60.000%");
  });
});

// UWAGA O JEDNEJ GAŁĘZI, KTÓREJ NIE DA SIĘ TRAFIĆ UCZCIWIE.
// `worldMapGeo.ts:320` liczy `(marker.point.label?.length ?? 0)`, ale `halfWidth`
// jest wołane DOPIERO za strażnikiem `if (!marker.point.label) continue`. Prawa
// strona `??` jest więc martwa strukturalnie: nie ma wejścia przez publiczny
// kontrakt, które by ją wykonało (pusty napis odpada na strażniku, a `null`
// tym bardziej). Zapisuję to wprost, zamiast dopisywać test, który by ją
// „trafiał" przez podstawiony obiekt i nie dowodził niczego o produkcie.
describe("assignLabelRows - wołane bezpośrednio", () => {
  const marker = (x: number, y: number, label: string | undefined, key = `${x},${y}`) => ({
    key,
    point: { lat: 0, lng: 0, ...(label === undefined ? {} : { label }) },
    xy: { x, y },
    labelRow: 0,
  });

  it("czwarta zbita etykieta ZAWIJA do wiersza 0, a nie ucieka na wiersz 3", () => {
    const rows = assignLabelRows(
      [
        marker(100, 100, "Etykieta A"),
        marker(105, 100, "Etykieta B"),
        marker(110, 100, "Etykieta C"),
        marker(115, 100, "Etykieta D"),
      ],
      WORLD_VIEW_BOX,
    ).map((m) => m.labelRow);
    // KONSEKWENCJA: `labelRow: 3` mnoży `--nes-wm-row` w CSS-ie chipa i odsuwa
    // napis tak wysoko, że przestaje wskazywać swoją kropkę (a przy pięciu
    // celach wychodzi poza płótno). Lepiej powtórzyć wiersz niż zgubić związek.
    expect(rows).toEqual([0, 1, 2, 0]);
    expect(Math.max(...rows)).toBeLessThan(3);
  });

  it("napisy oddalone w PIONIE nie kolidują, choć zachodzą na siebie w poziomie", () => {
    const rows = assignLabelRows(
      // Ten sam `x`, różnica `y` = 250 jednostek (rowGap przy kadrze świata to
      // 19,2). Fixture dociska też komparator: przy równym `x` porządek
      // rozstrzyga `y`.
      [marker(100, 300, "Etykieta A"), marker(100, 50, "Etykieta B")],
      WORLD_VIEW_BOX,
    );
    // KONSEKWENCJA: bez członu pionowego Oslo i Kair (ta sama długość
    // geograficzna) byłyby traktowane jako kolizja i drugi napis odjeżdżałby
    // o wiersz bez powodu.
    expect(rows.map((m) => m.labelRow)).toEqual([0, 0]);
    // Kolejność WYNIKU jest kolejnością wejścia, nie kolejnością sortowania -
    // inaczej klucze Reacta przeskakiwałyby między renderami.
    expect(rows.map((m) => m.key)).toEqual(["100,300", "100,50"]);
  });

  it("punkt bez etykiety nie rezerwuje miejsca dla sąsiada", () => {
    const rows = assignLabelRows(
      [marker(100, 100, undefined, "puste"), marker(102, 100, "Etykieta A")],
      WORLD_VIEW_BOX,
    );
    // KONSEKWENCJA: gdyby bezimienny punkt zajmował pas, jedyna nazwa na mapie
    // odjechałaby o wiersz od swojej kropki bez żadnego powodu widocznego dla oka.
    expect(rows.map((m) => m.labelRow)).toEqual([0, 0]);
  });

  it("ciaśniejszy kadr rozluźnia kolizje (napis zajmuje mniej JEDNOSTEK płótna)", () => {
    const pair = [marker(400, 200, "Etykieta bardzo długa"), marker(430, 200, "Etykieta druga")];
    const wide = assignLabelRows(pair, WORLD_VIEW_BOX).map((m) => m.labelRow);
    const zoomed = assignLabelRows(pair, { x: 380, y: 180, w: 100, h: 50 }).map((m) => m.labelRow);
    // KONSEKWENCJA: bez przeliczania px -> jednostki kadru mapa przybliżona na
    // Europę rozkładałaby napisy na trzy wiersze, choć na ekranie mają metry
    // powietrza między sobą.
    expect(wide).toEqual([0, 1]);
    expect(zoomed).toEqual([0, 0]);
  });
});

describe("resolveMarkers - scalanie i zaokrąglenie miejsca", () => {
  it("dokłada `avatar` i `role` z późniejszego łuku, nie tylko nazwę i odsyłacz", () => {
    const markers = resolveMarkers(
      resolveArcs([
        { start: { lat: 50.85, lng: 4.35, label: "Bruksela" }, end: { lat: 52.23, lng: 21.01 } },
        {
          start: {
            lat: 50.85,
            lng: 4.35,
            avatar: "https://cdn.example.com/zofia.webp",
            role: "Dyrektorka programowa",
          },
          end: { lat: 50.45, lng: 30.52 },
        },
      ]),
    );
    const hub = markers.find((m) => m.point.label === "Bruksela");
    // KONSEKWENCJA: bez scalania pole po polu etykieta „karta osoby" (zdjęcie +
    // rola) gubi się przez samą KOLEJNOŚĆ połączeń w panelu - redakcja widzi,
    // że dane są wpisane, a mapa ich nie pokazuje.
    expect(hub?.point.avatar).toBe("https://cdn.example.com/zofia.webp");
    expect(hub?.point.role).toBe("Dyrektorka programowa");
  });

  it("pierwsze wystąpienie NIE jest nadpisywane przez późniejsze niepuste", () => {
    const markers = resolveMarkers(
      resolveArcs([
        {
          start: { lat: 50.85, lng: 4.35, label: "Bruksela", href: "/o-nas" },
          end: { lat: 52.23, lng: 21.01 },
        },
        {
          start: { lat: 50.85, lng: 4.35, label: "Brussels", href: "/about" },
          end: { lat: 50.45, lng: 30.52 },
        },
      ]),
    );
    const hub = markers.find((m) => Math.abs(m.point.lng - 4.35) < 0.01);
    // KONSEKWENCJA odwrotnej kolejności: nazwa punktu zmieniałaby się przy
    // dopisaniu połączenia na końcu listy w panelu.
    expect(hub?.point.label).toBe("Bruksela");
    expect(hub?.point.href).toBe("/o-nas");
  });

  it("dwa punkty odległe o setne stopnia to JEDEN znacznik (klucz po pikselu)", () => {
    const markers = resolveMarkers(
      resolveArcs([
        {
          start: { lat: 50.85, lng: 4.35, label: "Bruksela" },
          end: { lat: 52.23, lng: 21.01, label: "Warszawa" },
        },
        {
          start: { lat: 50.86, lng: 4.36 },
          end: { lat: 52.24, lng: 21.02, label: "Warszawa - centrum" },
        },
      ]),
    );
    // KONSEKWENCJA: dwa wpisy tej samej stolicy różniące się zaokrągleniem
    // współrzędnych rysowałyby dwie kropki i dwa napisy jeden na drugim -
    // widoczne jako pogrubiony, nieczytelny tekst.
    expect(markers).toHaveLength(2);
    expect(markers.map((m) => m.point.label)).toEqual(["Bruksela", "Warszawa"]);
  });
});

describe("fitViewBox - gałęzie osiągalne tylko przez proporcję wołającego", () => {
  it("proporcja kwadratowa dociska wysokość do płótna i CENTRUJE kadr", () => {
    // `aspect = 1`: szerokość 800 wymusiłaby wysokość 800, a płótno ma 400.
    // KONSEKWENCJA braku dociśnięcia: `viewBox` wychodzi poniżej dolnej
    // krawędzi maski kropek - dolna połowa rysunku jest pustym tłem.
    expect(fitViewBox([], "world", 1)).toEqual({ x: 200, y: 0, w: 400, h: 400 });
  });

  it("kadr ciaśniejszy niż próg czytelności jest rozepchnięty do 150 jednostek", () => {
    // Przy proporcji 2:1 ta gałąź jest nieosiągalna (zapas na wzniesienie łuku
    // plus margines minimalny dają zawsze >= 268 jednostek). Wysoka proporcja
    // wołającego (0,5) schodzi poniżej progu.
    const view = fitViewBox([projectPoint(50.85, 4.35)], "auto", 0.5);
    // KONSEKWENCJA: poniżej 150 jednostek kropki lądu z maski robią się kulami,
    // a mapa przestaje być mapą.
    expect(view.w).toBe(150);
    expect(view.h).toBeCloseTo(300, 6);
    expect(view.x).toBeGreaterThanOrEqual(0);
    expect(view.y).toBeGreaterThanOrEqual(0);
  });

  it("para punktów na jednym południku jest ROZCIĄGANA do proporcji, nie zostaje paskiem", () => {
    // Ramka takich punktów ma szerokość ~0 i wysokość ~420 jednostek.
    const view = fitViewBox([projectPoint(70, 10), projectPoint(-40, 10)], "auto");
    // KONSEKWENCJA: bez rozciągnięcia `viewBox` byłby pionowym paskiem, a SVG
    // wpisany w płótno 2:1 dodałby po bokach dwa pasy pustego tła szersze niż
    // sam rysunek.
    expect(view.w / view.h).toBeCloseTo(MAP_VIEW_W / MAP_VIEW_H, 6);
    expect(view.w).toBeGreaterThan(view.h);
    expect(view).toEqual(WORLD_VIEW_BOX);
  });

  it("tryb `world` bez punktów zwraca całe płótno (kadr stały nie zależy od punktów)", () => {
    // Tania asercja domykająca komentarz o KOLEJNOŚCI gałęzi: skrót
    // „brak punktów -> świat" musi zostać POD gałęziami kadrów stałych.
    expect(fitViewBox([], "world")).toEqual(WORLD_VIEW_BOX);
    expect(fitViewBox([], "europe")).not.toEqual(WORLD_VIEW_BOX);
  });

  it("ramka punktów jest liczona bez założeń o ich kolejności", () => {
    const pts = [
      projectPoint(0, 0), // środek
      projectPoint(60, -60), // lewy górny
      projectPoint(-45, 120), // prawy dolny
    ];
    const view = fitViewBox(pts, "auto");
    // KONSEKWENCJA: gdyby którekolwiek z czterech porównań min/max było
    // odwrócone, punkt podany „w złej kolejności" wypadałby z kadru - a
    // kolejność połączeń w panelu jest kolejnością wpisywania, czyli losową.
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(view.x);
      expect(p.x).toBeLessThanOrEqual(view.x + view.w);
      expect(p.y).toBeGreaterThanOrEqual(view.y);
      expect(p.y).toBeLessThanOrEqual(view.y + view.h);
    }
  });
});

describe("kontrakty stałych modułu", () => {
  it("maska kropek jest WERSJONOWANA i faktycznie leży w `public/`", () => {
    // KONSEKWENCJA: `<image href>` w masce SVG wskazujący na nieistniejący plik
    // daje mapę bez lądów - sam gradient łuków na pustym tle. Odsyłacz jest
    // bezwzględny, bo SVG renderuje się na trasach o różnej głębokości.
    expect(WORLD_DOTS_URL.startsWith("/")).toBe(true);
    expect(WORLD_DOTS_URL).toMatch(/^\/geo\/world-dots\.v\d+\.svg$/);
    expect(existsSync(join(process.cwd(), "public", WORLD_DOTS_URL))).toBe(true);
  });

  it("sufit wzniesienia łuku i zapas kadru to TA SAMA liczba", () => {
    // `fitViewBox` odejmuje `ARC_LIFT_MAX` od górnej krawędzi ramki punktów.
    // KONSEKWENCJA rozjechania: łuk o maksymalnym wzniesieniu wychodziłby
    // dokładnie o różnicę tych dwóch stałych ponad kadr i byłby ucięty.
    expect(arcLift({ x: 0, y: 0 }, { x: 10_000, y: 0 })).toBe(ARC_LIFT_MAX);
    const view = fitViewBox([projectPoint(50.85, 4.35), projectPoint(52.23, 21.01)], "auto");
    expect(view.y).toBeLessThanOrEqual(
      Math.min(projectPoint(50.85, 4.35).y, projectPoint(52.23, 21.01).y) - ARC_LIFT_MAX,
    );
  });
});
