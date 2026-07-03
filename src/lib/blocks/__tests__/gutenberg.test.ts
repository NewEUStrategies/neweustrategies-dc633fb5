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
      "<!-- wp:paragraph --><p>Hello <strong>world</strong></p><!-- /wp:paragraph -->",
      '<!-- wp:list {"ordered":true} --><ol><li>One</li><li>Two</li></ol><!-- /wp:list -->',
      '<!-- wp:quote --><blockquote class="wp-block-quote"><p>Q</p><cite>A</cite></blockquote><!-- /wp:quote -->',
      '<!-- wp:image {"url":"/a.jpg"} --><figure class="wp-block-image"><img src="/a.jpg" alt="x"/><figcaption>cap</figcaption></figure><!-- /wp:image -->',
      '<!-- wp:code --><pre class="wp-block-code"><code>const a=1</code></pre><!-- /wp:code -->',
      "<!-- wp:separator --><hr/><!-- /wp:separator -->",
      '<!-- wp:embed {"url":"https://youtu.be/x"} --><figure class="wp-block-embed"></figure><!-- /wp:embed -->',
    ].join("\n");
    const doc = parseGutenberg(html);
    expect(isBlocksDoc(doc)).toBe(true);
    const types = doc.blocks.map((b) => b.type);
    expect(types).toEqual([
      "heading",
      "paragraph",
      "list",
      "quote",
      "image",
      "code",
      "separator",
      "embed",
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
      "<!-- wp:paragraph --><p>p</p><!-- /wp:paragraph -->",
      "<!-- wp:list --><ul><li>a</li></ul><!-- /wp:list -->",
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

describe("parseGutenberg - extended blocks", () => {
  it("unwraps core/group and core/columns into flat block list", () => {
    const html = [
      '<!-- wp:group --><div class="wp-block-group">',
      "<!-- wp:heading --><h2>G</h2><!-- /wp:heading -->",
      '<!-- wp:columns --><div class="wp-block-columns">',
      '<!-- wp:column --><div class="wp-block-column">',
      "<!-- wp:paragraph --><p>A</p><!-- /wp:paragraph -->",
      "<!-- /wp:column -->",
      '<!-- wp:column --><div class="wp-block-column">',
      "<!-- wp:paragraph --><p>B</p><!-- /wp:paragraph -->",
      "<!-- /wp:column -->",
      "</div><!-- /wp:columns -->",
      "</div><!-- /wp:group -->",
    ].join("");
    const doc = parseGutenberg(html);
    expect(doc.blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "paragraph"]);
  });

  it("expands core/gallery into multiple image blocks", () => {
    const html = [
      '<!-- wp:gallery --><figure class="wp-block-gallery">',
      '<figure><img src="/a.jpg" alt="A"/></figure>',
      '<figure><img src="/b.jpg" alt="B"/></figure>',
      "</figure><!-- /wp:gallery -->",
    ].join("");
    const doc = parseGutenberg(html);
    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks[0].type).toBe("image");
    expect(doc.blocks[0].data.url).toBe("/a.jpg");
    expect(doc.blocks[1].data.alt).toBe("B");
  });

  it("maps core/video, core/audio, core/file and extra embed providers", () => {
    const html = [
      '<!-- wp:video --><figure><video src="/v.mp4"></video></figure><!-- /wp:video -->',
      '<!-- wp:audio --><figure><audio src="/a.mp3"></audio></figure><!-- /wp:audio -->',
      '<!-- wp:file {"href":"/x.pdf"} --><div><a href="/x.pdf">X</a></div><!-- /wp:file -->',
      '<!-- wp:embed {"url":"https://instagram.com/p/x","providerNameSlug":"instagram"} --><figure></figure><!-- /wp:embed -->',
    ].join("");
    const doc = parseGutenberg(html);
    expect(doc.blocks.every((b) => b.type === "embed")).toBe(true);
    expect(doc.blocks).toHaveLength(4);
  });

  it("keeps unknown blocks lossless as html", () => {
    const html =
      '<!-- wp:my-plugin/widget --><div data-x="1">Custom</div><!-- /wp:my-plugin/widget -->';
    const doc = parseGutenberg(html);
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].type).toBe("html");
    expect(String(doc.blocks[0].data.html)).toContain('data-x="1"');
  });

  it("maps core/spacer to separator and verse to quote", () => {
    const html = [
      '<!-- wp:spacer --><div style="height:60px"></div><!-- /wp:spacer -->',
      '<!-- wp:verse --><pre class="wp-block-verse">Line</pre><!-- /wp:verse -->',
    ].join("");
    const doc = parseGutenberg(html);
    expect(doc.blocks.map((b) => b.type)).toEqual(["separator", "quote"]);
  });
});

describe("stripFoxizShortcodes - extended", () => {
  it("converts su_button, su_youtube, su_divider, su_spoiler", () => {
    const out = stripFoxizShortcodes(
      [
        '[su_button url="/x" target="blank"]Go[/su_button]',
        '[su_youtube url="https://y.tube/v"]',
        "[su_divider]",
        '[su_spoiler title="More"]hidden[/su_spoiler]',
      ].join(""),
    );
    expect(out).toContain('href="/x"');
    expect(out).toContain(">Go<");
    expect(out).toContain('<iframe src="https://y.tube/v"');
    expect(out).toContain("<hr>");
    expect(out).toContain("<details");
    expect(out).toContain("More");
  });

  it("handles [caption] and [embed] WP core shortcodes", () => {
    const out = stripFoxizShortcodes(
      '[caption]<img src="/a.jpg"/>Hi[/caption][embed]https://y.tube/v[/embed]',
    );
    expect(out).toContain("<figure>");
    expect(out).toContain("<figcaption>Hi</figcaption>");
    expect(out).toContain('<iframe src="https://y.tube/v"');
  });
});
