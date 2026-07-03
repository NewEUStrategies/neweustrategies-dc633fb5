// Smoke tests for Foxiz-style extended block types.
import { describe, it, expect } from "vitest";
import { BlocksDocSchema, safeParseBlocks } from "../schema";
import { BLOCK_SPECS } from "../registry";
import type { BlockType } from "../types";

const EXTENDED: BlockType[] = [
  "review",
  "proscons",
  "spoiler",
  "faq",
  "toc",
  "newsletter",
  "affiliate",
  "xquote",
  "compare",
];

describe("extended Foxiz blocks", () => {
  for (const type of EXTENDED) {
    it(`registry creates valid default for ${type}`, () => {
      const spec = BLOCK_SPECS[type];
      expect(spec).toBeDefined();
      const block = spec.create();
      expect(block.type).toBe(type);
      const parsed = BlocksDocSchema.safeParse({ version: 1, blocks: [block] });
      expect(parsed.success).toBe(true);
    });
  }

  it("safeParseBlocks accepts a doc with all extended blocks", () => {
    const blocks = EXTENDED.map((t) => BLOCK_SPECS[t].create());
    const out = safeParseBlocks({ version: 1, blocks });
    expect(out.blocks).toHaveLength(EXTENDED.length);
  });
});
