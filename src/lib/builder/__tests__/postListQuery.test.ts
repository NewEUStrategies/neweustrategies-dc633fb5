import { describe, it, expect } from "vitest";
import { rankAndSlicePopular } from "@/lib/builder/postListQuery";

const row = (id: string) => ({ id });

describe("rankAndSlicePopular", () => {
  it("orders rows by the popularity ranking (most-popular first)", () => {
    const rows = [row("a"), row("b"), row("c")];
    const ranked = ["c", "a", "b"];
    expect(rankAndSlicePopular(rows, ranked, 0, 10).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("places rows absent from the ranking last", () => {
    const rows = [row("x"), row("a"), row("b")];
    const ranked = ["a", "b"];
    expect(rankAndSlicePopular(rows, ranked, 0, 10).map((r) => r.id)).toEqual(["a", "b", "x"]);
  });

  it("applies the offset/limit window after ranking", () => {
    const rows = [row("a"), row("b"), row("c"), row("d")];
    const ranked = ["d", "c", "b", "a"];
    expect(rankAndSlicePopular(rows, ranked, 1, 2).map((r) => r.id)).toEqual(["c", "b"]);
  });

  it("does not mutate the input rows", () => {
    const rows = [row("a"), row("b")];
    const snapshot = rows.map((r) => r.id);
    rankAndSlicePopular(rows, ["b", "a"], 0, 10);
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });

  it("clamps a negative offset and a zero limit", () => {
    const rows = [row("a"), row("b")];
    expect(rankAndSlicePopular(rows, ["a", "b"], -5, 1).map((r) => r.id)).toEqual(["a"]);
    expect(rankAndSlicePopular(rows, ["a", "b"], 0, 0)).toEqual([]);
  });
});
