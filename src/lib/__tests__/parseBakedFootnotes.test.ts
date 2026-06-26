import { describe, it, expect } from "vitest";
import { parseBakedFootnotes } from "@/lib/footnotes";
import { footnotesSectionHtml } from "@/lib/builder/migrate/htmlToBuilder";

function mount(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("parseBakedFootnotes", () => {
  it("recovers notes from the baked footnotes-list markup", () => {
    const section = footnotesSectionHtml(
      [
        { id: 1, html: "First <strong>note</strong>" },
        { id: 2, html: "Second note" },
      ],
      "pl",
    );
    const notes = parseBakedFootnotes(mount(section));
    expect(notes).toEqual([
      { id: 1, html: "First <strong>note</strong>" },
      { id: 2, html: "Second note" },
    ]);
  });

  it("ignores the [N] marker span and keeps only the note body", () => {
    const notes = parseBakedFootnotes(
      mount(
        '<ol data-footnotes-list><li id="fn-3">' +
          '<span data-fn-marker>[3]</span> <span>body text</span> ' +
          '<a data-footnote-backlink href="#fnref-3">↩</a></li></ol>',
      ),
    );
    expect(notes).toEqual([{ id: 3, html: "body text" }]);
  });

  it("returns [] when there is no footnotes list", () => {
    expect(parseBakedFootnotes(mount("<p>no footnotes here</p>"))).toEqual([]);
  });

  it("skips malformed ids and empty bodies", () => {
    const notes = parseBakedFootnotes(
      mount(
        '<ol data-footnotes-list>' +
          '<li id="fn-x"><span>nope</span></li>' +
          '<li id="fn-0"><span>zero</span></li>' +
          '<li id="fn-5"><span data-fn-marker>[5]</span> <span>  </span></li>' +
          '<li id="fn-6"><span>kept</span></li>' +
          "</ol>",
      ),
    );
    expect(notes).toEqual([{ id: 6, html: "kept" }]);
  });
});
