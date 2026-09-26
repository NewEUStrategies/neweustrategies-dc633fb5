// Geometria planu sali - funkcje pomocnicze płótna i nawigacji klawiaturą.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. `-0.00` z cosinusa i zaokrąglenie połówki „w górę” zamiast od zera
//      rozjeżdżają podgląd z bazą (parytet pilnuje reszty w osobnej bramce).
//   2. Obrót sekcji przesuwa miejsca w złą stronę - organizator widzi lustro.
//   3. Strzałki na płótnie gubią fokus na granicy rzędu albo przeskakują do
//      innej sekcji przy „w górę/w dół”.
import { describe, expect, it } from "vitest";

import {
  boundsOf,
  generateSectionSeats,
  isSeatNavKey,
  nextSeatId,
  orderSeats,
  planViewBox,
  roundCoord,
  roundTableRadius,
  rowLabel,
  seatRadius,
  toMapPoint,
  type NavigableSeat,
  type SectionLayoutParams,
} from "@/lib/events/seatingGeometry";

const ROWS: SectionLayoutParams = {
  kind: "rows",
  rowsCount: 2,
  seatsPerRow: 3,
  rowLabelScheme: "alpha",
  rowLabelStart: 1,
  seatNumbering: "ltr",
  seatNumberStart: 1,
  seatPitch: 50,
  rowPitch: 60,
  aisleAfter: [],
  tableShape: null,
  tableSeats: null,
};

describe("zaokrąglenie i etykiety", () => {
  it("roundCoord: połówka od zera jak w PostgreSQL, bez -0", () => {
    expect(roundCoord(0.125)).toBe(0.13);
    expect(roundCoord(-0.125)).toBe(-0.13);
    expect(Object.is(roundCoord(-0.001), 0)).toBe(true);
  });

  it("rowLabel: litery w podstawie bijektywnej, numery wprost", () => {
    expect(rowLabel("alpha", 1)).toBe("A");
    expect(rowLabel("alpha", 26)).toBe("Z");
    expect(rowLabel("alpha", 27)).toBe("AA");
    expect(rowLabel("alpha", 703)).toBe("AAA");
    expect(rowLabel("numeric", 7)).toBe("7");
  });

  it("promień stołu i kółka miejsca", () => {
    expect(roundTableRadius(50, 2)).toBe(50);
    expect(roundTableRadius(50, 12)).toBe(96);
    expect(seatRadius(50, 60)).toBe(19);
    expect(seatRadius(80, 40)).toBe(15.2);
  });
});

describe("generacja miejsc sekcji - braki w parametrach", () => {
  it("rzędy bez schematu i numeracji padają na alfabet i od lewej", () => {
    const seats = generateSectionSeats({ ...ROWS, rowLabelScheme: null, seatNumbering: null });
    expect(seats.map((seat) => `${seat.rowLabel}${seat.seatNumber}`)).toEqual([
      "A1",
      "A2",
      "A3",
      "B1",
      "B2",
      "B3",
    ]);
  });

  it("brak liczby rzędów/miejsc/krzeseł = pusta sekcja, a nie wyjątek", () => {
    expect(generateSectionSeats({ ...ROWS, rowsCount: null })).toEqual([]);
    expect(generateSectionSeats({ ...ROWS, seatsPerRow: null })).toEqual([]);
    expect(
      generateSectionSeats({ ...ROWS, kind: "table", tableShape: "round", tableSeats: null }),
    ).toEqual([]);
    expect(generateSectionSeats({ ...ROWS, kind: "table", tableShape: "rect", tableSeats: null })).toEqual(
      [],
    );
  });

  it("stół bez kształtu rysuje się jako okrągły", () => {
    const seats = generateSectionSeats({ ...ROWS, kind: "table", tableShape: null, tableSeats: 4 });
    expect(seats[0]).toEqual({ rowLabel: null, seatNumber: 1, x: 0, y: -50, sortKey: 0 });
  });
});

describe("przeniesienie na plan i obrys", () => {
  it("toMapPoint: przesunięcie i obrót zgodnie z ruchem wskazówek (oś y w dół)", () => {
    expect(toMapPoint({ x: 10, y: 0 }, { originX: 100, originY: 200, rotationDeg: 0 })).toEqual({
      x: 110,
      y: 200,
    });
    expect(toMapPoint({ x: 10, y: 0 }, { originX: 0, originY: 0, rotationDeg: 90 })).toEqual({
      x: 0,
      y: 10,
    });
  });

  it("boundsOf: obrys z marginesem; pusto = pudełko wokół zera", () => {
    expect(boundsOf([{ x: 1, y: 5 }, { x: -3, y: 2 }], 1)).toEqual({ minX: -4, minY: 1, maxX: 2, maxY: 6 });
    expect(boundsOf([])).toEqual({ minX: -0, minY: -0, maxX: 0, maxY: 0 });
    expect(boundsOf([], 5)).toEqual({ minX: -5, minY: -5, maxX: 5, maxY: 5 });
  });

  it("planViewBox obejmuje plan i to, co z niego wystaje", () => {
    expect(planViewBox(1000, 500, { minX: 10, minY: 10, maxX: 900, maxY: 400 })).toBe("0 0 1000 500");
    expect(planViewBox(1000, 500, { minX: -20, minY: -10, maxX: 1100, maxY: 600 })).toBe(
      "-20 -10 1120 610",
    );
  });
});

describe("nawigacja klawiaturą", () => {
  // Sekcja A: 2 rzędy (0: pozycje 0,1,2; 1: pozycje 0,1). Sekcja T: stół (jeden „rząd”).
  const seats: NavigableSeat[] = [
    { id: "a02", sectionId: "A", sectionOrder: 0, sortKey: 2 },
    { id: "t0", sectionId: "T", sectionOrder: 1, sortKey: 0 },
    { id: "a00", sectionId: "A", sectionOrder: 0, sortKey: 0 },
    { id: "a10", sectionId: "A", sectionOrder: 0, sortKey: 1000 },
    { id: "a01", sectionId: "A", sectionOrder: 0, sortKey: 1 },
    { id: "a11", sectionId: "A", sectionOrder: 0, sortKey: 1001 },
    { id: "t1", sectionId: "T", sectionOrder: 1, sortKey: 1 },
  ];
  const ordered = orderSeats(seats);

  it("orderSeats: sekcja po sekcji, w sekcji po sort_key", () => {
    expect(ordered.map((seat) => seat.id)).toEqual(["a00", "a01", "a02", "a10", "a11", "t0", "t1"]);
  });

  it("klawisze nawigacji rozpoznane, inne nie", () => {
    expect(isSeatNavKey("ArrowUp")).toBe(true);
    expect(isSeatNavKey("Enter")).toBe(false);
  });

  it("lewo/prawo po kolejności czytania, z zatrzymaniem na brzegach, Home/End", () => {
    expect(nextSeatId(ordered, "a02", "ArrowRight")).toBe("a10");
    expect(nextSeatId(ordered, "a00", "ArrowLeft")).toBe("a00");
    expect(nextSeatId(ordered, "t1", "ArrowRight")).toBe("t1");
    expect(nextSeatId(ordered, "a11", "Home")).toBe("a00");
    expect(nextSeatId(ordered, "a00", "End")).toBe("t1");
  });

  it("góra/dół w obrębie sekcji do najbliższej pozycji; brak rzędu = bez ruchu", () => {
    expect(nextSeatId(ordered, "a02", "ArrowDown")).toBe("a11");
    expect(nextSeatId(ordered, "a11", "ArrowUp")).toBe("a01");
    expect(nextSeatId(ordered, "a00", "ArrowUp")).toBe("a00");
    expect(nextSeatId(ordered, "a10", "ArrowDown")).toBe("a10");
  });

  it("przy stole góra/dół działają jak lewo/prawo", () => {
    expect(nextSeatId(ordered, "t0", "ArrowDown")).toBe("t1");
    expect(nextSeatId(ordered, "t1", "ArrowUp")).toBe("t0");
  });

  it("nieznane miejsce wraca na początek, pusty plan - bez zmiany", () => {
    expect(nextSeatId(ordered, "zzz", "ArrowRight")).toBe("a00");
    expect(nextSeatId([], "zzz", "ArrowRight")).toBe("zzz");
  });
});
