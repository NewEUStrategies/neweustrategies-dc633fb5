import { describe, it, expect } from "vitest";
import { parseBuilderDoc } from "./parse";

describe("parseBuilderDoc", () => {
  it("returns empty doc for null/undefined/non-object", () => {
    expect(parseBuilderDoc(null).sections).toEqual([]);
    expect(parseBuilderDoc(undefined).sections).toEqual([]);
    expect(parseBuilderDoc("x").sections).toEqual([]);
    expect(parseBuilderDoc(42).sections).toEqual([]);
  });

  it("returns empty doc for wrong version or missing sections", () => {
    expect(parseBuilderDoc({ version: 2, sections: [] }).sections).toEqual([]);
    expect(parseBuilderDoc({ version: 1 }).sections).toEqual([]);
    expect(parseBuilderDoc({ version: 1, sections: "x" }).sections).toEqual([]);
  });

  it("accepts valid shape", () => {
    const doc = parseBuilderDoc({ version: 1, sections: [{ id: "s1", columns: [] }] });
    expect(doc.version).toBe(1);
    expect(doc.sections).toHaveLength(1);
  });
});
