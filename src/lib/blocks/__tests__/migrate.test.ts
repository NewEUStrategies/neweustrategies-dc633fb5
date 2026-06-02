import { describe, it, expect } from "vitest";
import { htmlToBlocks, builderToBlocks, migratePostContent } from "@/lib/blocks/migrate";
import { isBlocksDoc } from "@/lib/blocks/schema";

describe("htmlToBlocks", () => {
  it("returns an empty doc for empty input", () => {
    const d = htmlToBlocks("");
    expect(d.blocks).toHaveLength(0);
    expect(isBlocksDoc(d)).toBe(true);
  });

  it("maps headings, paragraphs, lists, blockquote, hr, img", () => {
    const html = [
      "<h2 id=\"intro\">Intro</h2>",
      "<p>Hello <strong>world</strong></p>",
      "<ul><li>A</li><li>B</li></ul>",
      "<ol><li>1st</li></ol>",
      "<blockquote>Quote</blockquote>",
      "<hr>",
      "<p><img src=\"/a.jpg\" alt=\"x\"></p>",
      "<pre><code class=\"language-ts\">const a = 1</code></pre>",
    ].join("");
    const d = htmlToBlocks(html);
    const types = d.blocks.map((b) => b.type);
    expect(types).toEqual(expect.arrayContaining([
      "heading", "paragraph", "list", "quote", "separator", "code",
    ]));
    const heading = d.blocks.find((b) => b.type === "heading");
    expect(heading?.data.anchor).toBe("intro");
    expect(heading?.data.level).toBe(2);
    expect(isBlocksDoc(d)).toBe(true);
  });

  it("falls back to single paragraph for unstructured text", () => {
    const d = htmlToBlocks("Plain text without tags");
    expect(d.blocks).toHaveLength(1);
    expect(d.blocks[0].type).toBe("paragraph");
  });
});

describe("builderToBlocks", () => {
  it("extracts a heading + paragraph + image from a builder tree", () => {
    const tree = {
      type: "section",
      children: [
        { type: "heading", data: { level: 3, text: "Hi" } },
        { type: "richtext", data: { html: "<p>body</p>" } },
        { type: "image", data: { src: "/x.png", alt: "alt" } },
        { type: "divider" },
      ],
    };
    const d = builderToBlocks(tree);
    expect(d.blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "image", "separator"]);
    expect(isBlocksDoc(d)).toBe(true);
  });

  it("returns empty doc for null input", () => {
    expect(builderToBlocks(null).blocks).toHaveLength(0);
  });
});

describe("migratePostContent", () => {
  it("prefers HTML content when present", () => {
    const r = migratePostContent({ content_pl: "<p>PL</p>", content_en: "<p>EN</p>" });
    expect(r.source).toBe("html");
    expect(r.pl.blocks[0].type).toBe("paragraph");
    expect(r.en.blocks[0].type).toBe("paragraph");
  });

  it("falls back to builder JSON", () => {
    const r = migratePostContent({
      builder_data: { children: [{ type: "heading", data: { level: 2, text: "X" } }] },
    });
    expect(r.source).toBe("builder");
    expect(r.pl.blocks[0].type).toBe("heading");
  });

  it("returns empty docs when no input", () => {
    const r = migratePostContent({});
    expect(r.source).toBe("empty");
    expect(r.pl.blocks).toHaveLength(0);
  });
});
