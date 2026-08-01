import { describe, expect, it } from "vitest";
import { normalizeBuilderRichHtml } from "./normalizeRichHtml";

describe("normalizeBuilderRichHtml", () => {
  it("removes repeated empty list shells from imported Elementor HTML", () => {
    const html = "<ul><li><ul><li><ul><li>Treść</li><li>Drugi punkt</li></ul></li></ul></li></ul>";
    expect(normalizeBuilderRichHtml(html)).toBe("<ul><li>Treść</li><li>Drugi punkt</li></ul>");
  });

  it("preserves a genuine nested list", () => {
    const html = "<ul><li>Parent<ul><li>Child</li></ul></li><li>Sibling</li></ul>";
    expect(normalizeBuilderRichHtml(html)).toBe(html);
  });

  it("normalizes PL and EN markup without changing text", () => {
    const pl = "<ul><li><ul><li>Punkt PL</li></ul></li></ul>";
    const en = "<ul><li><ul><li>English item</li></ul></li></ul>";
    expect(normalizeBuilderRichHtml(pl)).toBe("<ul><li>Punkt PL</li></ul>");
    expect(normalizeBuilderRichHtml(en)).toBe("<ul><li>English item</li></ul>");
  });
});
