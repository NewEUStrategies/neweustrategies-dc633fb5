import { describe, it, expect } from "vitest";
import { flattenBlockTree, blockSnippet } from "@/lib/blocks/tree";
import type { Block, Json } from "@/lib/blocks/types";

const p = (id: string, html: string): Block => ({ id, type: "paragraph", data: { html } });

describe("flattenBlockTree", () => {
  it("flattens nested containers in document order with depths and rootId", () => {
    const doc: Block[] = [
      p("a", "<p>Pierwszy</p>"),
      {
        id: "g",
        type: "group",
        data: {
          children: [
            p("g1", "<p>Dziecko 1</p>"),
            {
              id: "cols",
              type: "columns",
              data: {
                left: [p("l1", "<p>Lewa</p>")] as unknown as Json,
                right: [p("r1", "<p>Prawa</p>")] as unknown as Json,
              },
            } as unknown as Json,
          ] as unknown as Json,
        },
      },
      p("z", "<p>Ostatni</p>"),
    ];
    const rows = flattenBlockTree(doc);
    expect(rows.map((r) => r.id)).toEqual(["a", "g", "g1", "cols", "l1", "r1", "z"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 0, 1, 1, 2, 2, 0]);
    expect(rows.find((r) => r.id === "r1")?.rootId).toBe("g");
    expect(rows.find((r) => r.id === "z")?.rootId).toBe("z");
  });

  it("returns an empty list for an empty document", () => {
    expect(flattenBlockTree([])).toEqual([]);
  });
});

describe("blockSnippet", () => {
  it("extracts first-line text and truncates long content", () => {
    expect(blockSnippet(p("x", "<p>Hello <strong>world</strong></p>"))).toBe("Hello world");
    const long = "a".repeat(120);
    const snip = blockSnippet(p("y", `<p>${long}</p>`));
    expect(snip.length).toBeLessThanOrEqual(48);
    expect(snip.endsWith("…")).toBe(true);
  });

  it("is empty for blocks without text content", () => {
    expect(blockSnippet({ id: "s", type: "separator", data: { variant: "line" } })).toBe("---");
  });
});
