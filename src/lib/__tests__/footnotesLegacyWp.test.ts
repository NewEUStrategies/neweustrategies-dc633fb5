import { describe, expect, it } from "vitest";
import { createCounter, expandFootnotes, normalizeLegacyFootnoteHtml } from "@/lib/footnotes";
import { sanitizeHtml } from "@/lib/sanitize";

const LEGACY =
  'imperializmu<span class="footnote_referrer"><a role="button" tabindex="0"><sup id="footnote_plugin_tooltip_3920_11_12" class="footnote_plugin_tooltip_text">[12]</sup></a><span id="t" class="footnote_tooltip">A. Legucka, <em>Geopolityczne uwarunkowania</em>, str. 33-34</span></span>, dalej';

describe("legacy WP footnotes", () => {
  it("zamienia markup WP na shortcode", () => {
    expect(normalizeLegacyFootnoteHtml(LEGACY)).toContain("[fn]A. Legucka,");
  });
  it("przetrwa sanitizer i daje marker bez tekstu w akapicie", () => {
    const col = createCounter(1);
    const out = expandFootnotes(sanitizeHtml(LEGACY), col);
    expect(out).not.toContain("Legucka");
    expect(out).toContain('class="fn-ref"');
    expect(col.notes[0].html).toContain("<em>Geopolityczne uwarunkowania</em>");
  });
});
