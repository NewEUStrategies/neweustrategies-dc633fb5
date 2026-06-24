import { describe, it, expect } from "vitest";
import { processManualToc, slugifyHeading } from "../manualToc";

describe("slugifyHeading", () => {
  it("strips diacritics and spaces", () => {
    expect(slugifyHeading("Słowo wstępne")).toBe("slowo-wstepne");
  });
  it("returns fallback for empty input", () => {
    expect(slugifyHeading("  ")).toBe("section");
  });
});

describe("processManualToc", () => {
  it("returns unchanged html when marker absent (still adds heading ids)", () => {
    const { html, toc, hasMarker } = processManualToc("<h2>Intro</h2><p>x</p>", "pl");
    expect(hasMarker).toBe(false);
    expect(toc).toHaveLength(1);
    expect(html).toContain('id="intro"');
  });

  it("replaces first <!--TOC--> marker with rendered nav", () => {
    const src = `<p>lead</p><!--TOC--><h2>One</h2><h3>One.a</h3><h2>Two</h2>`;
    const { html, toc, hasMarker } = processManualToc(src, "pl");
    expect(hasMarker).toBe(true);
    expect(toc.map((t) => t.text)).toEqual(["One", "One.a", "Two"]);
    expect(html).toMatch(/<nav class="manual-toc"/);
    expect(html).toMatch(/href="#one"/);
    expect(html).toMatch(/href="#one-a"/);
    expect(html).toMatch(/href="#two"/);
  });

  it("strips additional markers and preserves only the first", () => {
    const src = `<!--TOC--><h2>A</h2><!--TOC--><h2>B</h2>`;
    const { html } = processManualToc(src, "en");
    const matches = html.match(/<nav class="manual-toc"/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("renders English heading when lang=en", () => {
    const { html } = processManualToc("<!--TOC--><h2>X</h2>", "en");
    expect(html).toContain("Table of contents");
  });

  it("deduplicates ids on repeated headings", () => {
    const { toc } = processManualToc("<!--TOC--><h2>Dup</h2><h2>Dup</h2>", "pl");
    expect(toc.map((t) => t.id)).toEqual(["dup", "dup-2"]);
  });

  it("respects existing id attributes", () => {
    const { html, toc } = processManualToc('<!--TOC--><h2 id="custom">X</h2>', "pl");
    expect(toc[0].id).toBe("custom");
    expect(html).toContain('id="custom"');
  });
});
