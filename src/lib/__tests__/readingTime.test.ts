import { describe, it, expect } from "vitest";
import { countWords, estimateReadingMinutes } from "@/lib/readingTime";

describe("readingTime", () => {
  it("countWords ignores whitespace", () => {
    expect(countWords("  hello   world  ")).toBe(2);
    expect(countWords("")).toBe(0);
  });

  it("estimates from HTML stripping tags", () => {
    const html = `<p>${"word ".repeat(440)}</p>`;
    expect(estimateReadingMinutes({ html })).toBe(2);
  });

  it("returns 0 for empty sources", () => {
    expect(estimateReadingMinutes({})).toBe(0);
  });

  it("aggregates docs recursively", () => {
    const doc = { blocks: [{ text: "word ".repeat(220) }, { children: ["word ".repeat(220)] }] };
    expect(estimateReadingMinutes({ docs: [doc] })).toBe(2);
  });

  it("clamps minimum to 1 when there are words", () => {
    expect(estimateReadingMinutes({ extraText: "hello world" })).toBe(1);
  });
});
