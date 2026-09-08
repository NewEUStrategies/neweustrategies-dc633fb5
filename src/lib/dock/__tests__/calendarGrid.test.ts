import { describe, expect, it } from "vitest";
import { dayKey, monthGrid, monthRange, shiftMonth, type CalendarEntry } from "../calendarGrid";
import { freezeClock } from "@/test/time";

// ZAMROŻENIE ZEGARA, choć asercje niżej podają WSZYSTKIE daty jawnie.
// Powód jest w module pod testem, nie tutaj: `calendarGrid` dostał
// `siteDayKey()` i `siteMonth()` z domyślnym argumentem `Date.now()`, czyli
// od tej zmiany jest modułem CZYTAJĄCYM ZEGAR. Bramka `check:clock-freeze`
// liczy taki import jak własną zależność pliku testowego - słusznie, bo
// pierwsze wywołanie bez argumentu byłoby zależne od dnia przebiegu.
freezeClock();

const entry = (id: string, startsAt: string): CalendarEntry => ({
  id,
  title: id,
  startsAt,
  href: null,
  kind: "event",
});

describe("calendarGrid", () => {
  it("buduje siatkę 42 dni zaczynającą się od poniedziałku", () => {
    const grid = monthGrid(2026, 0, []); // styczeń 2026, 1 = czwartek
    expect(grid).toHaveLength(42);
    expect(grid[0]?.date.getDay()).toBe(1);
    expect(grid[0]?.inMonth).toBe(false);
    expect(grid.filter((day) => day.inMonth)).toHaveLength(31);
  });

  it("przypisuje wpisy do właściwego dnia i sortuje je po godzinie", () => {
    const late = entry("late", new Date(2026, 0, 15, 18, 0).toISOString());
    const early = entry("early", new Date(2026, 0, 15, 9, 0).toISOString());
    const grid = monthGrid(2026, 0, [late, early]);
    const day = grid.find((item) => item.key === "2026-01-15");
    expect(day?.entries.map((item) => item.id)).toEqual(["early", "late"]);
  });

  it("pomija wpisy z niepoprawną datą", () => {
    const grid = monthGrid(2026, 0, [entry("bad", "nie-data")]);
    expect(grid.every((day) => day.entries.length === 0)).toBe(true);
  });

  it("przesuwa miesiąc przez granicę roku", () => {
    expect(shiftMonth(2026, 0, -1)).toEqual([2025, 11]);
    expect(shiftMonth(2026, 11, 1)).toEqual([2027, 0]);
  });

  it("zakres miesiąca obejmuje pierwszy dzień i kończy się przed kolejnym", () => {
    const { from, to } = monthRange(2026, 1);
    expect(dayKey(from)).toBe("2026-02-01");
    expect(dayKey(to)).toBe("2026-03-01");
  });
});
