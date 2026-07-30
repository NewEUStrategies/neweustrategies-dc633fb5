// Snapshot regresja: pełny HTML markerów `[fn]…[/fn]` w overlay globalnych
// widgetów. Ta ścieżka produkuje marker SAMODZIELNY (bez `href`/`id`/`data-fn`),
// bo przypisy globalnych widgetów nie mają dokumentowej sekcji końcowej -
// szczegóły w `ExpandOptions` (src/lib/footnotes.ts) i src/test/footnoteMarker.ts.
//
// Snapshoty łapią KAŻDĄ zmianę w strukturze markera, roli ARIA i treści
// atrybutu `title` (w tym HTML-escape) oraz numeracji między hydratacjami.

import { describe, it, expect } from "vitest";
import { createCounter, processWidgetFootnotes } from "@/lib/footnotes";
import type { WidgetNode } from "@/lib/builder/types";

function textWidget(html: string, id = "w-snap"): WidgetNode {
  return {
    kind: "widget",
    id,
    type: "text",
    content: { html_pl: html },
  } as unknown as WidgetNode;
}

function html(widget: WidgetNode): string {
  return String((widget.content as Record<string, unknown>).html_pl);
}

describe("footnote tooltip snapshots - hydration parity", () => {
  it("matches snapshot for a single footnote marker", () => {
    const { widget, notes } = processWidgetFootnotes(
      textWidget("Ala ma[fn]kota domowego[/fn]."),
      "pl",
    );
    expect(html(widget)).toMatchInlineSnapshot(
      `"Ala ma<sup class="fn-ref"><span title="kota domowego" role="note">[1]</span></sup>."`,
    );
    expect(notes).toMatchInlineSnapshot(`
      [
        {
          "html": "kota domowego",
          "id": 1,
        },
      ]
    `);
  });

  it("matches snapshot for sequential footnotes in one block", () => {
    const { widget } = processWidgetFootnotes(
      textWidget("A[fn]pierwszy[/fn] B[fn]drugi[/fn] C[fn]trzeci[/fn]."),
      "pl",
    );
    expect(html(widget)).toMatchInlineSnapshot(
      `"A<sup class="fn-ref"><span title="pierwszy" role="note">[1]</span></sup> B<sup class="fn-ref"><span title="drugi" role="note">[2]</span></sup> C<sup class="fn-ref"><span title="trzeci" role="note">[3]</span></sup>."`,
    );
  });

  it("HTML-escapes special characters in tooltip title", () => {
    const { widget } = processWidgetFootnotes(
      textWidget(`Zob.[fn]A & B <script>x</script> "cytat" 'apostrof'[/fn].`),
      "pl",
    );
    // `<`, `>`, `&`, `"`, `'` MUSZĄ być zescape'owane w title; tagi wewnętrzne
    // są stripowane przed escape (patrz footnotes.ts).
    expect(html(widget)).toMatchInlineSnapshot(
      `"Zob.<sup class="fn-ref"><span title="A &amp; B x &quot;cytat&quot; &#39;apostrof&#39;" role="note">[1]</span></sup>."`,
    );
  });

  it("stays byte-identical across repeated hydrations of the same payload", () => {
    const raw = textWidget("X[fn]a[/fn] Y[fn]b[/fn] Z[fn]c[/fn]");
    const first = processWidgetFootnotes(raw, "pl");
    const firstHtml = html(first.widget);

    expect(firstHtml).toMatchInlineSnapshot(
      `"X<sup class="fn-ref"><span title="a" role="note">[1]</span></sup> Y<sup class="fn-ref"><span title="b" role="note">[2]</span></sup> Z<sup class="fn-ref"><span title="c" role="note">[3]</span></sup>"`,
    );

    let current = first.widget;
    for (let i = 0; i < 3; i += 1) {
      const step = processWidgetFootnotes(current, "pl");
      expect(html(step.widget)).toBe(firstHtml);
      expect(step.notes).toEqual([]);
      current = step.widget;
    }
  });

  it("shares numbering across sibling widgets under a single document counter", () => {
    const col = createCounter(1);
    const w1 = processWidgetFootnotes(textWidget("A[fn]a1[/fn] B[fn]a2[/fn]", "w-a"), "pl", col);
    const w2 = processWidgetFootnotes(textWidget("C[fn]b1[/fn]", "w-b"), "pl", col);

    expect({
      w1: html(w1.widget),
      w2: html(w2.widget),
      notesTail: w2.notes,
    }).toMatchInlineSnapshot(`
      {
        "notesTail": [
          {
            "html": "a1",
            "id": 1,
          },
          {
            "html": "a2",
            "id": 2,
          },
          {
            "html": "b1",
            "id": 3,
          },
        ],
        "w1": "A<sup class="fn-ref"><span title="a1" role="note">[1]</span></sup> B<sup class="fn-ref"><span title="a2" role="note">[2]</span></sup>",
        "w2": "C<sup class="fn-ref"><span title="b1" role="note">[3]</span></sup>",
      }
    `);
  });
});
