import { describe, it, expect } from "vitest";
import { emptyArticleBuilderDoc } from "../newArticleDoc";
import { parseBuilderDoc } from "../parse";

describe("emptyArticleBuilderDoc", () => {
  it("parses to one section/column holding a single rich-text widget", () => {
    // Round-tripping through the real parser proves the seed is a valid builder
    // doc and that the rich-text widget survives normalization (registered type).
    const doc = parseBuilderDoc(emptyArticleBuilderDoc());
    expect(doc.sections).toHaveLength(1);
    const child = doc.sections[0].children[0];
    expect(child.kind).toBe("column");
    if (child.kind !== "column") throw new Error("expected a column");
    expect(child.children).toHaveLength(1);
    expect(child.children[0].type).toBe("rich-text");
    expect(child.children[0].content.doc).toBeTruthy();
  });

  it("generates fresh ids on each call (stable React keys / no collisions)", () => {
    expect(emptyArticleBuilderDoc().sections[0].id).not.toBe(
      emptyArticleBuilderDoc().sections[0].id,
    );
  });
});
