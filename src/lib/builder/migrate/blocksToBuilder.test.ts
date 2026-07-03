import { describe, it, expect } from "vitest";
import { localizedBlocksToBuilderDoc, hasBlocksContent } from "./blocksToBuilder";
import { isBuilderDoc, safeParseBuilderDoc } from "../schema";
import type { LocalizedBlocks } from "@/lib/blocks/types";

const para = (text: string) => ({
  version: 1 as const,
  blocks: [{ id: "b1", type: "paragraph" as const, data: { html: `<p>${text}</p>` } }],
});

const localized = (pl: number, en: number): LocalizedBlocks => ({
  pl: {
    version: 1,
    blocks: Array.from({ length: pl }, (_, i) => ({ id: `p${i}`, type: "paragraph", data: {} })),
  },
  en: {
    version: 1,
    blocks: Array.from({ length: en }, (_, i) => ({ id: `e${i}`, type: "paragraph", data: {} })),
  },
});

describe("hasBlocksContent", () => {
  it("is true when either language has blocks", () => {
    expect(hasBlocksContent(localized(1, 0))).toBe(true);
    expect(hasBlocksContent(localized(0, 2))).toBe(true);
  });
  it("is false for empty / missing documents", () => {
    expect(hasBlocksContent(localized(0, 0))).toBe(false);
    expect(hasBlocksContent(null)).toBe(false);
    expect(hasBlocksContent(undefined)).toBe(false);
    expect(hasBlocksContent({} as unknown as LocalizedBlocks)).toBe(false);
  });
});

describe("localizedBlocksToBuilderDoc", () => {
  it("wraps blocks in a full-width rich-text widget", () => {
    const blocks: LocalizedBlocks = { pl: para("Witaj"), en: para("Hello") };
    const doc = localizedBlocksToBuilderDoc(blocks);

    expect(doc.version).toBe(1);
    expect(doc.sections).toHaveLength(1);
    const section = doc.sections[0];
    expect(section.kind).toBe("section");
    expect(section.children).toHaveLength(1);

    const column = section.children[0] as unknown as {
      kind: string;
      span: Record<string, number>;
      children: unknown[];
    };
    expect(column.kind).toBe("column");
    expect(column.span).toEqual({ desktop: 12 });
    expect(column.children).toHaveLength(1);

    const widget = column.children[0] as { kind: string; type: string; content: { doc: unknown } };
    expect(widget.kind).toBe("widget");
    expect(widget.type).toBe("rich-text");
    // The original blocks document is embedded verbatim (no data loss).
    expect(widget.content.doc).toBe(blocks);
  });

  it("produces a structurally valid, render-safe builder document", () => {
    const doc = localizedBlocksToBuilderDoc({ pl: para("x"), en: para("y") });
    expect(isBuilderDoc(doc)).toBe(true);
    // Survives the renderer's own validation unchanged in shape.
    expect(safeParseBuilderDoc(doc).sections).toHaveLength(1);
  });

  it("generates unique node ids per call", () => {
    const a = localizedBlocksToBuilderDoc({ pl: para("x"), en: para("y") });
    const b = localizedBlocksToBuilderDoc({ pl: para("x"), en: para("y") });
    expect(a.sections[0].id).not.toBe(b.sections[0].id);
  });
});
