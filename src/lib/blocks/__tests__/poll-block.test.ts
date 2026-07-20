import { describe, it, expect } from "vitest";
import { BLOCK_SPECS, IMPLEMENTED_BLOCKS } from "../registry";
import { safeParseBlocks } from "../schema";

// Blok "poll" przechodzi przez wszystkie warstwy: rejestr (tworzenie),
// schemat (walidacja na granicach zaufania) i kolejność insertera.
describe("blok poll", () => {
  it("rejestr tworzy blok z pustym pollId w kategorii widgets", () => {
    const spec = BLOCK_SPECS.poll;
    expect(spec.category).toBe("widgets");
    const block = spec.create();
    expect(block.type).toBe("poll");
    expect(block.data.pollId).toBe("");
  });

  it("safeParseBlocks akceptuje dokument z blokiem poll", () => {
    const block = BLOCK_SPECS.poll.create();
    block.data.pollId = "7f0b8c9e-1234-4abc-9def-000000000000";
    const doc = { version: 1 as const, blocks: [block] };
    const parsed = safeParseBlocks(doc);
    expect(parsed).not.toBeNull();
    expect(parsed?.blocks[0]?.type).toBe("poll");
    expect(parsed?.blocks[0]?.data.pollId).toBe(block.data.pollId);
  });

  it("jest oznaczony jako zaimplementowany (inserter)", () => {
    expect(IMPLEMENTED_BLOCKS).toContain("poll");
  });
});
