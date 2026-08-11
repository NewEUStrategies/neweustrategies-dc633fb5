import { describe, expect, it } from "vitest";
import { groupMyClubs, shouldTabMyClubs } from "@/lib/clubs/myClubGroups";

const club = (id: string, policy_area: string | null) => ({ id, policy_area });

describe("groupMyClubs", () => {
  it("grupuje po obszarze, najliczniejsze pierwsze", () => {
    const groups = groupMyClubs([
      club("a", "energy"),
      club("b", "finance"),
      club("c", "energy"),
    ]);
    expect(groups.map((g) => g.area)).toEqual(["energy", "finance"]);
    expect(groups[0]?.clubs).toHaveLength(2);
  });

  it("remisy rozstrzyga alfabetycznie - kolejność jest deterministyczna", () => {
    const groups = groupMyClubs([club("a", "transport"), club("b", "energy")]);
    expect(groups.map((g) => g.area)).toEqual(["energy", "transport"]);
  });

  it("kluby bez obszaru trafiają do grupy null na końcu, nie znikają", () => {
    const groups = groupMyClubs([club("a", null), club("b", "energy"), club("c", "  ")]);
    expect(groups.at(-1)?.area).toBeNull();
    expect(groups.at(-1)?.clubs).toHaveLength(2);
    expect(groups.flatMap((g) => g.clubs)).toHaveLength(3);
  });

  it("pusta lista nie tworzy grupy 'pozostałe'", () => {
    expect(groupMyClubs([])).toEqual([]);
  });
});

describe("shouldTabMyClubs", () => {
  it("jedna grupa nie zasługuje na pasek zakładek", () => {
    expect(shouldTabMyClubs([{ area: "energy" }])).toBe(false);
    expect(shouldTabMyClubs([])).toBe(false);
  });

  it("dwie grupy i więcej dostają zakładki", () => {
    expect(shouldTabMyClubs([{ area: "energy" }, { area: null }])).toBe(true);
  });
});
