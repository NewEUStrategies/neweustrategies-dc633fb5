// Normalizacja mapy stanowisk. RPC zwraca WYŁĄCZNIE stanowiska, na które ktoś
// zagłosował - pasek z dwoma z trzech opcji czyta się jako "trzeciej nie ma",
// a nie "nikt jej nie wybrał".
import { describe, expect, it } from "vitest";
import { toStanceTallies } from "../stances";

describe("toStanceTallies", () => {
  it("uzupełnia brakujące stanowiska zerami i trzyma kolejność słownika", () => {
    const out = toStanceTallies([{ stance: "support", total: 3, mine: true }]);
    expect(out.map((s) => s.stance)).toEqual(["support", "oppose", "abstain"]);
    expect(out.map((s) => s.total)).toEqual([3, 0, 0]);
  });

  it("pusty wynik daje trzy zera, nie pustą listę", () => {
    expect(toStanceTallies([]).every((s) => s.total === 0 && !s.mine)).toBe(true);
  });

  it("bigint z Postgresa przychodzi jako liczba, nie tekst", () => {
    // supabase-js oddaje `count(*)` (bigint) jako string. Bez konwersji
    // sumowanie dałoby "35" zamiast 8 i szerokości pasków byłyby bez sensu.
    const out = toStanceTallies([
      { stance: "support", total: "3" as unknown as number, mine: false },
      { stance: "oppose", total: "5" as unknown as number, mine: false },
    ]);
    expect(out.reduce((sum, s) => sum + s.total, 0)).toBe(8);
    expect(typeof out[0].total).toBe("number");
  });

  it("moje stanowisko przenosi się na właściwy wiersz i tylko na jeden", () => {
    const out = toStanceTallies([
      { stance: "support", total: 5, mine: false },
      { stance: "abstain", total: 1, mine: true },
    ]);
    expect(out.find((s) => s.mine)?.stance).toBe("abstain");
    expect(out.filter((s) => s.mine)).toHaveLength(1);
  });
});
