import { describe, it, expect } from "vitest";
import {
  parseGutenberg,
  blocksToGutenberg,
  isGutenbergHtml,
  stripFoxizShortcodes,
} from "@/lib/blocks/gutenberg";
import { isBlocksDoc } from "@/lib/blocks/schema";

describe("isGutenbergHtml", () => {
  it("detects wp: comment markers", () => {
    expect(isGutenbergHtml("<!-- wp:paragraph --><p>hi</p><!-- /wp:paragraph -->")).toBe(true);
    expect(isGutenbergHtml("<p>hi</p>")).toBe(false);
    expect(isGutenbergHtml("")).toBe(false);
  });
});

describe("parseGutenberg", () => {
  it("parses core paragraph/heading/list/quote/image/code/separator/embed", () => {
    const html = [
      '<!-- wp:heading {"level":2,"anchor":"intro"} --><h2 id="intro">Intro</h2><!-- /wp:heading -->',
      '<!-- wp:paragraph --><p>Hello <strong>world</strong></p><!-- /wp:paragraph -->',
      '<!-- wp:list {"ordered":true} --><ol><li>One</li><li>Two</li></ol><!-- /wp:list -->',
      '<!-- wp:quote --><blockquote class="wp-block-quote"><p>Q</p><cite>A</cite></blockquote><!-- /wp:quote -->',
      '<!-- wp:image {"url":"/a.jpg"} --><figure class="wp-block-image"><img src="/a.jpg" alt="x"/><figcaption>cap</figcaption></figure><!-- /wp:image -->',
      '<!-- wp:code --><pre class="wp-block-code"><code>const a=1</code></pre><!-- /wp:code -->',
      '<!-- wp:separator --><hr/><!-- /wp:separator -->',
      '<!-- wp:embed {"url":"https://youtu.be/x"} --><figure class="wp-block-embed"></figure><!-- /wp:embed -->',
    ].join("\n");
    const doc = parseGutenberg(html);
    expect(isBlocksDoc(doc)).toBe(true);
    const types = doc.blocks.map((b) => b.type);
    expect(types).toEqual([
      "heading", "paragraph", "list", "quote", "image", "code", "separator", "embed",
    ]);
    expect(doc.blocks[0].data.anchor).toBe("intro");
    expect(doc.blocks[2].data.ordered).toBe(true);
    expect(doc.blocks[3].data.cite).toBe("A");
    expect(doc.blocks[4].data.caption).toBe("cap");
  });

  it("falls back to plain HTML parser when no wp: markers present", () => {
    const doc = parseGutenberg("<p>plain</p><hr>");
    expect(doc.blocks.length).toBeGreaterThan(0);
  });
});

describe("blocksToGutenberg (round-trip)", () => {
  it("round-trips core blocks back to parseable Gutenberg markup", () => {
    const src = [
      '<!-- wp:heading {"level":3,"anchor":"x"} --><h3 id="x">T</h3><!-- /wp:heading -->',
      '<!-- wp:paragraph --><p>p</p><!-- /wp:paragraph -->',
      '<!-- wp:list --><ul><li>a</li></ul><!-- /wp:list -->',
    ].join("\n");
    const doc = parseGutenberg(src);
    const out = blocksToGutenberg(doc);
    expect(isGutenbergHtml(out)).toBe(true);
    const doc2 = parseGutenberg(out);
    expect(doc2.blocks.map((b) => b.type)).toEqual(doc.blocks.map((b) => b.type));
  });
});

describe("stripFoxizShortcodes", () => {
  it("converts su_quote to blockquote and drops foxiz_* widgets", () => {
    const out = stripFoxizShortcodes('[su_quote cite="A"]Hi[/su_quote][foxiz_ads slot="x"]');
    expect(out).toContain("<blockquote>");
    expect(out).toContain("<cite>A</cite>");
    expect(out).not.toContain("foxiz_ads");
  });
});
