import { describe, expect, it } from "vitest";
import { countClubTopics } from "../topics";

describe("countClubTopics", () => {
  it("zlicza kluby po obszarze", () => {
    expect(
      countClubTopics([
        { policy_area: "energy" },
        { policy_area: "energy" },
        { policy_area: "trade" },
      ]),
    ).toEqual([
      { area: "energy", count: 2 },
      { area: "trade", count: 1 },
    ]);
  });

  it("klub bez obszaru nie tworzy zakładki", () => {
    expect(countClubTopics([{ policy_area: null }, { policy_area: "  " }])).toEqual([]);
  });

  it("kolejność jest deterministyczna: liczba malejąco, remis alfabetycznie", () => {
    const out = countClubTopics([
      { policy_area: "trade" },
      { policy_area: "climate" },
      { policy_area: "energy" },
      { policy_area: "energy" },
    ]);
    expect(out.map((o) => o.area)).toEqual(["energy", "climate", "trade"]);
  });
});
