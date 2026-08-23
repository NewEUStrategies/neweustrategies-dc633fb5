// Skrócony dymek WP ("… Czytaj dalej") musi zostać uzupełniony pełną treścią
// z końcowej tabeli źródeł - także wtedy, gdy tabela jest w INNYM bloku.
import { describe, expect, it } from "vitest";
import { collectWpFootnoteTexts, normalizeLegacyFootnoteHtml } from "@/lib/footnotes";

const REF_TABLE = `<div id="footnote_references_container_3920_11"><table class="footnotes_table">
<tr class="footnotes_plugin_reference_row"><th scope="row" class="footnote_plugin_index_combi pointer"><a id="footnote_plugin_reference_3920_11_14" class="footnote_backlink"><span class="footnote_index_arrow">&#8593;</span>14</a></th>
<td class="footnote_plugin_text">Jest to sytuacja, w ktorej skala globalnego zaangazowania jest na tyle duza, ze dominacja imperium staje sie niemozliwa.</td></tr>
</table></div>`;

const BODY = `<p>tekst<span class="footnote_referrer"><a role="button"><sup id="footnote_plugin_tooltip_3920_11_14" class="footnote_plugin_tooltip_text">[14]</sup></a><span id="footnote_plugin_tooltip_text_3920_11_14" class="footnote_tooltip">Jest to sytuacja, w ktorej skala globalnego zaangazowania&nbsp;&#x2026; <span class="footnote_tooltip_continue">Czytaj dalej</span></span></span>.</p>`;

describe("WP footnotes - pelna tresc zamiast 'Czytaj dalej'", () => {
  it("zbiera tresci z tabeli zrodel", () => {
    const map = collectWpFootnoteTexts([REF_TABLE, BODY]);
    expect(map.get("3920_11_14")).toContain("niemozliwa.");
  });

  it("podmienia skrocony dymek na pelny przypis", () => {
    const out = normalizeLegacyFootnoteHtml(BODY, collectWpFootnoteTexts([REF_TABLE]));
    expect(out).toContain("[fn]Jest to sytuacja");
    expect(out).toContain("niemozliwa.[/fn]");
    expect(out).not.toContain("Czytaj dalej");
  });

  it("automatycznie odzyskuje pelny przypis z tabeli w tym samym HTML", () => {
    const out = normalizeLegacyFootnoteHtml(`${BODY}${REF_TABLE}`);
    expect(out).toContain("niemozliwa.[/fn]");
    expect(out).not.toContain("Czytaj dalej");
  });

  it("bez tabeli usuwa sam przycisk 'Czytaj dalej' i wielokropek", () => {
    const out = normalizeLegacyFootnoteHtml(BODY);
    expect(out).not.toContain("Czytaj dalej");
    expect(out).not.toMatch(/&#x2026;\[\/fn\]/);
  });
});
