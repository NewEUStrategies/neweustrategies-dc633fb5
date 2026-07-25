// Kontrakt derywacji kotwic dokumentu blokowego: renderer nagłówków i spis
// treści MUSZĄ czytać tę samą mapę, inaczej `href="#…"` rozjeżdża się z `id`.
import { describe, expect, it } from "vitest";
import { blockAnchor, resolveBlockAnchors } from "../anchors";
import type { Block } from "../types";
import { extractHeadingsFromBlockList } from "@/lib/toc/settings";

function heading(id: string, text: string, extra: Record<string, unknown> = {}): Block {
  return { id, type: "heading", data: { level: 2, text, ...extra } } as Block;
}

describe("resolveBlockAnchors", () => {
  it("maps heading block ids to canonical anchors", () => {
    const blocks = [heading("b1", "Wyzwania małych firm"), heading("b2", "Wnioski")];
    const map = resolveBlockAnchors(blocks);
    expect(map.get("b1")?.id).toBe("wyzwania-malych-firm");
    expect(map.get("b2")?.id).toBe("wnioski");
  });

  it("deduplicates repeated heading text in document order", () => {
    const blocks = [heading("b1", "Wnioski"), heading("b2", "Wnioski"), heading("b3", "Wnioski")];
    const map = resolveBlockAnchors(blocks);
    expect(map.get("b1")?.id).toBe("wnioski");
    expect(map.get("b2")?.id).toBe("wnioski-2");
    expect(map.get("b3")?.id).toBe("wnioski-3");
  });

  it("exposes the pre-unification anchor as a legacy alias", () => {
    const map = resolveBlockAnchors([heading("b1", "Wyzwania małych firm")]);
    expect(map.get("b1")?.legacyIds).toEqual(["wyzwania-ma-ych-firm"]);
  });

  it("emits no aliases for headings whose anchor never changed", () => {
    const map = resolveBlockAnchors([heading("b1", "Hello World")]);
    expect(map.get("b1")?.legacyIds).toEqual([]);
  });

  it("treats an author-supplied anchor as the contract (no slug, no aliases)", () => {
    const map = resolveBlockAnchors([
      heading("b1", "Wyzwania małych firm", { anchor: "rozdzial-1" }),
    ]);
    expect(map.get("b1")?.id).toBe("rozdzial-1");
    expect(map.get("b1")?.legacyIds).toEqual([]);
  });

  it("never lets a legacy alias collide with another heading's canonical anchor", () => {
    // The second heading's canonical anchor IS the first heading's legacy alias.
    const blocks = [heading("b1", "Wyzwania małych firm"), heading("b2", "Wyzwania ma ych firm")];
    const map = resolveBlockAnchors(blocks);
    const canonicalB2 = map.get("b2")?.id;
    expect(canonicalB2).toBe("wyzwania-ma-ych-firm-2");
    expect(map.get("b1")?.legacyIds).toEqual(["wyzwania-ma-ych-firm"]);
    expect(map.get("b1")?.legacyIds).not.toContain(canonicalB2);
  });

  it("skips non-heading and empty-text blocks", () => {
    const blocks = [
      { id: "p1", type: "paragraph", data: { html: "<p>x</p>" } } as Block,
      heading("h-empty", "   "),
      heading("h-ok", "Wnioski"),
    ];
    const map = resolveBlockAnchors(blocks);
    expect(map.has("p1")).toBe(false);
    expect(map.has("h-empty")).toBe(false);
    expect(map.get("h-ok")?.id).toBe("wnioski");
  });

  it("is stable across calls and cached per array reference", () => {
    const blocks = [heading("b1", "Wnioski")];
    expect(resolveBlockAnchors(blocks)).toBe(resolveBlockAnchors(blocks));
  });

  it("returns an empty map for empty input", () => {
    expect(resolveBlockAnchors(null).size).toBe(0);
    expect(resolveBlockAnchors(undefined).size).toBe(0);
    expect(resolveBlockAnchors([]).size).toBe(0);
  });
});

describe("blockAnchor", () => {
  it("reads the document-wide derivation when the block is top-level", () => {
    const blocks = [heading("b1", "Wnioski"), heading("b2", "Wnioski")];
    expect(blockAnchor(blocks[1], blocks).id).toBe("wnioski-2");
  });

  it("falls back to a local anchor for nested (non top-level) headings", () => {
    const nested = heading("nested", "Wyzwania małych firm");
    expect(blockAnchor(nested, []).id).toBe("wyzwania-malych-firm");
    expect(blockAnchor(nested, []).legacyIds).toEqual(["wyzwania-ma-ych-firm"]);
  });

  it("returns an empty anchor for a non-heading block", () => {
    const para = { id: "p1", type: "paragraph", data: {} } as Block;
    expect(blockAnchor(para, []).id).toBe("");
  });
});

describe("ToC href / heading id parity", () => {
  it("the ToC links exactly the anchors the renderer emits", () => {
    const blocks = [
      heading("b1", "Wyzwania małych firm"),
      heading("b2", "Wnioski"),
      heading("b3", "Wnioski"),
      heading("b4", "Rozdział czwarty", { anchor: "custom" }),
    ];
    const tocAnchors = extractHeadingsFromBlockList(blocks).map((h) => h.anchor);
    const renderedIds = blocks.map((b) => blockAnchor(b, blocks).id);
    expect(tocAnchors).toEqual(renderedIds);
    expect(tocAnchors).toEqual(["wyzwania-malych-firm", "wnioski", "wnioski-2", "custom"]);
  });
});
