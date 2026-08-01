import { describe, it, expect } from "vitest";
import {
  serializeBlocksForClipboard,
  parseBlocksFromClipboard,
  blocksToPlainText,
  plainTextToBlocks,
  regenerateBlockIds,
} from "@/lib/blocks/clipboard";
import type { Block } from "@/lib/blocks/types";

const sample: Block[] = [
  { id: "b_aaa", type: "heading", data: { level: 2, text: "Tytuł", anchor: "t" } },
  { id: "b_bbb", type: "paragraph", data: { html: "Hello <strong>world</strong>" } },
  { id: "b_ccc", type: "list", data: { ordered: true, items: ["Jeden", "Dwa"] } },
];

describe("serializeBlocksForClipboard / parseBlocksFromClipboard", () => {
  it("round-trips blocks losslessly through the sentinel layer", () => {
    const payload = serializeBlocksForClipboard(sample);
    const parsed = parseBlocksFromClipboard(payload.html, payload.text);
    expect(parsed).not.toBeNull();
    expect(parsed!.map((b) => b.type)).toEqual(["heading", "paragraph", "list"]);
    // Bezstratność: HTML inline akapitu przeżywa (warstwa Gutenberga by go zgubiła w liście).
    expect(parsed![1].data.html).toBe("Hello <strong>world</strong>");
    expect(parsed![2].data.items).toEqual(["Jeden", "Dwa"]);
  });

  it("regenerates block ids on paste (no collisions with the source)", () => {
    const payload = serializeBlocksForClipboard(sample);
    const parsed = parseBlocksFromClipboard(payload.html)!;
    const originalIds = new Set(sample.map((b) => b.id));
    for (const b of parsed) expect(originalIds.has(b.id)).toBe(false);
  });

  it("survives sanitizers that strip HTML comments' sentinel by falling back to Gutenberg markup", () => {
    const payload = serializeBlocksForClipboard(sample);
    const withoutSentinel = payload.html.replace(/<!--\s*nes:blocks[\s\S]*?-->/i, "");
    const parsed = parseBlocksFromClipboard(withoutSentinel);
    expect(parsed).not.toBeNull();
    expect(parsed!.map((b) => b.type)).toEqual(["heading", "paragraph", "list"]);
  });

  it("parses Gutenberg markup copied from WordPress (text/html)", () => {
    const wp = [
      '<!-- wp:heading {"level":2} --><h2>Z WordPressa</h2><!-- /wp:heading -->',
      "<!-- wp:paragraph --><p>Treść</p><!-- /wp:paragraph -->",
    ].join("\n");
    const parsed = parseBlocksFromClipboard(wp);
    expect(parsed).not.toBeNull();
    expect(parsed!.map((b) => b.type)).toEqual(["heading", "paragraph"]);
  });

  it("parses Gutenberg markup pasted as plain text (WP code editor copy)", () => {
    const wp = "<!-- wp:paragraph --><p>Kod</p><!-- /wp:paragraph -->";
    const parsed = parseBlocksFromClipboard("", wp);
    expect(parsed).not.toBeNull();
    expect(parsed![0].type).toBe("paragraph");
  });

  it("returns null for non-block clipboard content", () => {
    expect(parseBlocksFromClipboard("<p>zwykły html</p>", "zwykły tekst")).toBeNull();
    expect(parseBlocksFromClipboard("", "")).toBeNull();
    expect(parseBlocksFromClipboard(null, null)).toBeNull();
  });

  it("handles unicode content in the sentinel (base64 of UTF-8)", () => {
    const blocks: Block[] = [
      { id: "b_x", type: "paragraph", data: { html: "Zażółć gęślą jaźń 🚀 — «cytat»" } },
    ];
    const payload = serializeBlocksForClipboard(blocks);
    const parsed = parseBlocksFromClipboard(payload.html)!;
    expect(parsed[0].data.html).toBe("Zażółć gęślą jaźń 🚀 — «cytat»");
  });
});

describe("blocksToPlainText", () => {
  it("renders readable plain text per block type", () => {
    const text = blocksToPlainText(sample);
    expect(text).toContain("Tytuł");
    expect(text).toContain("Hello world");
    expect(text).toContain("1. Jeden");
    expect(text).toContain("2. Dwa");
  });
});

describe("plainTextToBlocks", () => {
  it("splits paragraphs on blank lines and escapes HTML", () => {
    const blocks = plainTextToBlocks("Pierwszy akapit\n\nDrugi <b>akapit</b>\nz łamaniem");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[1].data.html).toBe("Drugi &lt;b&gt;akapit&lt;/b&gt;<br>z łamaniem");
  });
});

describe("regenerateBlockIds", () => {
  it("regenerates ids of nested child blocks too", () => {
    const nested: Block[] = [
      {
        id: "b_parent",
        type: "columns",
        data: {
          left: [{ id: "b_child", type: "paragraph", data: { html: "x" } }],
          right: [],
        },
      },
    ];
    const out = regenerateBlockIds(nested);
    expect(out[0].id).not.toBe("b_parent");
    const left = out[0].data.left as unknown as Block[];
    expect(left[0].id).not.toBe("b_child");
    expect(left[0].data.html).toBe("x");
  });
});
