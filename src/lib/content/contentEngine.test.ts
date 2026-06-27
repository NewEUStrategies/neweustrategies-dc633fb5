import { describe, it, expect } from "vitest";
import { resolveContentEngine } from "./contentEngine";
import type { BuilderDocument } from "@/lib/builder/types";
import type { BlocksDoc } from "@/lib/blocks/types";

const builderDoc = (sectionCount: number): BuilderDocument => ({
  version: 1,
  sections: Array.from({ length: sectionCount }, (_, i) => ({
    id: `s${i}`,
    kind: "section" as const,
    children: [],
  })),
});

const blocksDoc = (blockCount: number): BlocksDoc =>
  ({
    version: 1,
    blocks: Array.from({ length: blockCount }, (_, i) => ({ id: `b${i}`, type: "paragraph", data: {} })),
  }) as unknown as BlocksDoc;

describe("resolveContentEngine", () => {
  it("selects builder for an explicit builder editor with sections", () => {
    expect(resolveContentEngine({ editor: "builder", builderDoc: builderDoc(1) })).toBe("builder");
  });

  it("falls back to html when the builder engine has no content", () => {
    expect(resolveContentEngine({ editor: "builder", builderDoc: builderDoc(0) })).toBe("html");
    expect(resolveContentEngine({ editor: "builder", builderDoc: null })).toBe("html");
  });

  it("falls back to html for legacy blocks editor (blocks strategy removed)", () => {
    expect(resolveContentEngine({ editor: "blocks", blocksDoc: blocksDoc(2) })).toBe("html");
    expect(resolveContentEngine({ editor: "blocks", blocksDoc: blocksDoc(0) })).toBe("html");
    expect(resolveContentEngine({ editor: "blocks", blocksDoc: null })).toBe("html");
  });

  it("falls back to html for richtext / markdown / unknown / missing editors", () => {
    expect(resolveContentEngine({ editor: "richtext" })).toBe("html");
    expect(resolveContentEngine({ editor: "markdown" })).toBe("html");
    expect(resolveContentEngine({ editor: null })).toBe("html");
    expect(resolveContentEngine({})).toBe("html");
  });

  it("lets the builder editor kind win when both documents are present", () => {
    expect(resolveContentEngine({ editor: "builder", builderDoc: builderDoc(1), blocksDoc: blocksDoc(3) })).toBe(
      "builder",
    );
  });
});
