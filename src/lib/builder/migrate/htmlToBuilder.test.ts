import { describe, it, expect } from "vitest";
import {
  htmlToBuilderDoc,
  processArticleHtml,
  footnotesSectionHtml,
  hasHtmlContent,
} from "./htmlToBuilder";
import { isBuilderDoc } from "../schema";

describe("footnotesSectionHtml", () => {
  it("is empty when there are no notes", () => {
    expect(footnotesSectionHtml([], "pl")).toBe("");
  });

  it("renders ids, markers and backlinks matching the public footnotes list", () => {
    const html = footnotesSectionHtml([{ id: 1, html: "<em>Źródło</em>" }], "pl");
    expect(html).toContain('id="footnotes-heading"');
    expect(html).toContain('id="fn-1"');
    expect(html).toContain("[1]");
    expect(html).toContain("<em>Źródło</em>");
    expect(html).toContain('href="#fnref-1"');
    expect(html).toContain("Przypisy źródłowe:");
  });

  it("localizes the heading", () => {
    expect(footnotesSectionHtml([{ id: 1, html: "x" }], "en")).toContain("Source notes:");
  });
});

describe("processArticleHtml", () => {
  it("converts [fn] shortcodes into refs + a footnotes section", () => {
    const out = processArticleHtml("<p>Claim[fn]the source[/fn].</p>", "en");
    expect(out).toContain('<sup class="fn-ref">');
    expect(out).toContain('href="#fn-1"'); // inline ref → note
    expect(out).toContain('id="fn-1"'); // note list item
    expect(out).toContain("the source");
  });

  it("expands the manual TOC marker and assigns heading ids", () => {
    const out = processArticleHtml("<h2>Intro</h2><!--TOC--><p>body</p>", "en");
    expect(out).toContain('id="intro"');
    expect(out).toContain('class="manual-toc"');
    expect(out).toContain('href="#intro"');
    expect(out).toContain("Table of contents");
  });

  it("leaves plain HTML without markers essentially intact", () => {
    const out = processArticleHtml("<p>Just text</p>", "pl");
    expect(out).toContain("<p>Just text</p>");
    expect(out).not.toContain("footnotes-heading");
    expect(out).not.toContain("manual-toc");
  });
});

describe("hasHtmlContent", () => {
  it("detects non-empty content in either language", () => {
    expect(hasHtmlContent("<p>x</p>", null)).toBe(true);
    expect(hasHtmlContent(null, "<p>y</p>")).toBe(true);
    expect(hasHtmlContent("   ", "")).toBe(false);
    expect(hasHtmlContent(null, undefined)).toBe(false);
  });
});

describe("htmlToBuilderDoc", () => {
  it("wraps processed HTML in a full-width text widget per language", () => {
    const doc = htmlToBuilderDoc("<p>PL[fn]p[/fn]</p>", "<p>EN</p>");
    expect(isBuilderDoc(doc)).toBe(true);

    const column = doc.sections[0].children[0] as unknown as { children: Array<{ type: string; content: Record<string, string> }> };
    const widget = column.children[0];
    expect(widget.type).toBe("text");
    expect(widget.content.html_pl).toContain('id="fn-1"'); // footnote baked
    expect(widget.content.html_en).toContain("<p>EN</p>");
  });

  it("omits a language key when that language has no content", () => {
    const doc = htmlToBuilderDoc("<p>only PL</p>", null);
    const column = doc.sections[0].children[0] as unknown as { children: Array<{ content: Record<string, string> }> };
    const content = column.children[0].content;
    expect(content.html_pl).toBeDefined();
    expect(content.html_en).toBeUndefined();
  });
});
