import { describe, it, expect } from "vitest";
import { normalizeQuestions, orderByIds } from "@/lib/programs/shape";

describe("normalizeQuestions", () => {
  it("returns [] for non-array input", () => {
    expect(normalizeQuestions(null)).toEqual([]);
    expect(normalizeQuestions(undefined)).toEqual([]);
    expect(normalizeQuestions("nope")).toEqual([]);
    expect(normalizeQuestions({ pl: "x" })).toEqual([]);
  });

  it("keeps entries with at least one non-empty language", () => {
    expect(
      normalizeQuestions([
        { pl: "Pytanie", en: "Question" },
        { pl: "Tylko PL", en: "" },
        { pl: "", en: "EN only" },
      ]),
    ).toEqual([
      { pl: "Pytanie", en: "Question" },
      { pl: "Tylko PL", en: "" },
      { pl: "", en: "EN only" },
    ]);
  });

  it("drops fully-empty and whitespace-only entries", () => {
    expect(
      normalizeQuestions([
        { pl: "", en: "" },
        { pl: "  ", en: "\t" },
      ]),
    ).toEqual([]);
  });

  it("coerces non-string fields and malformed items to empty strings", () => {
    expect(normalizeQuestions([{ pl: 5, en: true }, 42, null])).toEqual([]);
    expect(normalizeQuestions([{ pl: "ok", en: 9 }])).toEqual([{ pl: "ok", en: "" }]);
  });
});

describe("orderByIds", () => {
  const rows = [
    { id: "c", n: 3 },
    { id: "a", n: 1 },
    { id: "b", n: 2 },
  ];

  it("reorders rows to match the id order", () => {
    expect(orderByIds(rows, ["a", "b", "c"], (r) => r.id).map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("sorts rows whose id is absent from the order list to the end", () => {
    const withExtra = [...rows, { id: "z", n: 9 }];
    expect(orderByIds(withExtra, ["b", "a"], (r) => r.id).map((r) => r.id)).toEqual([
      "b",
      "a",
      "c",
      "z",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [...rows];
    orderByIds(input, ["a", "b", "c"], (r) => r.id);
    expect(input.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("returns an empty array unchanged", () => {
    expect(orderByIds([], ["a"], (r: { id: string }) => r.id)).toEqual([]);
  });
});
