// Czytniki jsonb planu sali.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. Tablica udaje obiekt - `bag([])` przepuściłby tablicę do parsera, który
//      czytałby z niej pola jak z karty miejsca.
//   2. Pusty napis z bazy zamienia się w „wartość” i karta pokazuje pustą salę.
//   3. `NaN`/`Infinity` przechodzą jako współrzędne i SVG rysuje nic.
import { describe, expect, it } from "vitest";

import { bag, flag, list, num, text } from "@/lib/events/seatingJson";

describe("czytniki jsonb planu sali", () => {
  it("bag przyjmuje wyłącznie obiekty", () => {
    expect(bag({ a: 1 })).toEqual({ a: 1 });
    expect(bag([])).toBeNull();
    expect(bag(null)).toBeNull();
    expect(bag("x")).toBeNull();
  });

  it("list oddaje tablicę albo pustą tablicę", () => {
    expect(list([1, 2])).toEqual([1, 2]);
    expect(list({})).toEqual([]);
  });

  it("text odrzuca puste i nie-napisy", () => {
    expect(text({ a: "A" }, "a")).toBe("A");
    expect(text({ a: "  " }, "a")).toBeNull();
    expect(text({ a: 5 }, "a")).toBeNull();
  });

  it("num przyjmuje tylko skończone liczby", () => {
    expect(num({ a: 12.5 }, "a")).toBe(12.5);
    expect(num({ a: Number.NaN }, "a")).toBeNull();
    expect(num({ a: "1" }, "a")).toBeNull();
  });

  it("flag oddaje wartość logiczną albo domyślną", () => {
    expect(flag({ a: true }, "a", false)).toBe(true);
    expect(flag({ a: "true" }, "a", false)).toBe(false);
  });
});
