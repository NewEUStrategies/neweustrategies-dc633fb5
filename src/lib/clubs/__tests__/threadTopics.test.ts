// Kontrakt liczenia wątków po obszarze tematycznym - lustro testów `topics.test.ts`.
import { describe, expect, it } from "vitest";
import { countThreadTopics } from "../threadTopics";
import type { ClubThreadListRow } from "../types";

function thread(topic: string | null): Pick<ClubThreadListRow, "topic"> {
  return { topic } as Pick<ClubThreadListRow, "topic">;
}

describe("countThreadTopics", () => {
  it("zlicza wątki po obszarze", () => {
    expect(countThreadTopics([thread("energy"), thread("energy"), thread("trade")])).toEqual([
      { area: "energy", count: 2 },
      { area: "trade", count: 1 },
    ]);
  });

  it("wątek bez obszaru nie tworzy chipa", () => {
    expect(countThreadTopics([thread(null), thread("  "), thread("")])).toEqual([]);
  });

  it("kolejność jest deterministyczna: liczba malejąco, remis alfabetycznie", () => {
    const out = countThreadTopics([
      thread("trade"),
      thread("climate"),
      thread("energy"),
      thread("energy"),
    ]);
    expect(out.map((o) => o.area)).toEqual(["energy", "climate", "trade"]);
  });
});
