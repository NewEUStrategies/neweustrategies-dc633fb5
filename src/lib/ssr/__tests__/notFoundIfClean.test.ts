// Kontrola reguły „404 tylko z CZYSTEGO odczytu". Test ma KONTROLĘ NEGATYWNĄ:
// dowodzi nie tylko, że 404 leci, gdy ma lecieć, ale przede wszystkim że NIE
// leci przy degradacji - to ta druga gałąź jest naprawą (blip backendu nie
// może wypisywać URL-a z indeksu).
import { describe, expect, it } from "vitest";
import { isNotFound } from "@tanstack/react-router";

import { notFoundIfClean } from "@/lib/ssr/notFoundIfClean";

interface Row {
  readonly id: string;
}

const ROW: Row = { id: "r1" };

describe("notFoundIfClean", () => {
  it("oddaje wiersz z czystego odczytu", () => {
    expect(notFoundIfClean<Row>({ data: ROW, degraded: false })).toBe(ROW);
  });

  it("rzuca notFound(), gdy CZYSTY odczyt nie znalazł wiersza", () => {
    let thrown: unknown;
    try {
      notFoundIfClean<Row>({ data: null, degraded: false });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(isNotFound(thrown)).toBe(true);
  });

  it("przy degradacji zwraca null i NIE rzuca - 404 z niewiedzy wypisałby stronę z indeksu", () => {
    expect(notFoundIfClean<Row>({ data: null, degraded: true })).toBeNull();
  });

  it("degradacja wygrywa nad danymi zasianymi jako fallback", () => {
    // Fallback bywa niepusty (np. pusta lista), a i tak nie jest prawdą
    // backendu - sygnał `degraded` jest jedynym źródłem tej decyzji.
    expect(notFoundIfClean<Row>({ data: ROW, degraded: true })).toBeNull();
  });
});
