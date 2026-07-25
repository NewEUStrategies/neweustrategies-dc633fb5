// Snapshot regresja: pełny HTML markerów `[fn]…[/fn]` w overlay globalnych
// widgetów. Snapshoty łapią KAŻDĄ zmianę w:
//  - strukturze markera (`<sup class="fn-ref">…</sup>`),
//  - atrybutach ARIA (`aria-describedby`, `role="doc-noteref"`),
//  - treści atrybutu `title` (tekst tooltipa) - w tym HTML-escape,
//  - numeracji między hydratacjami (stabilny payload = stabilny snapshot).
//
// Jeśli którykolwiek z tych elementów świadomie się zmienia, aktualizuj
// snapshoty (`vitest -u`) razem z komentarzem migracyjnym w PR.

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
      `"Ala ma<sup class="fn-ref"><a href="#fn-1" id="fnref-1" data-fn="1" title="kota domowego" aria-describedby="footnotes-heading" role="doc-noteref">[1]</a></sup>."`,
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
      `"A<sup class="fn-ref"><a href="#fn-1" id="fnref-1" data-fn="1" title="pierwszy" aria-describedby="footnotes-heading" role="doc-noteref">[1]</a></sup> B<sup class="fn-ref"><a href="#fn-2" id="fnref-2" data-fn="2" title="drugi" aria-describedby="footnotes-heading" role="doc-noteref">[2]</a></sup> C<sup class="fn-ref"><a href="#fn-3" id="fnref-3" data-fn="3" title="trzeci" aria-describedby="footnotes-heading" role="doc-noteref">[3]</a></sup>."`,
    );
  });

  it("HTML-escapes special characters in tooltip title", () => {
    const { widget } = processWidgetFootnotes(
      textWidget(`Zob.[fn]A & B <script>x</script> "cytat" 'apostrof'[/fn].`),
      "pl",
    );
    // Kluczowe: `<`, `>`, `&`, `"`, `'` MUSZĄ być zescape'owane w title;
    // tagi wewnętrzne są stripowane przed escape (patrz footnotes.ts).
    expect(html(widget)).toMatchInlineSnapshot(
      `"Zob.<sup class="fn-ref"><a href="#fn-1" id="fnref-1" data-fn="1" title="A &amp; B x &quot;cytat&quot; &#39;apostrof&#39;" aria-describedby="footnotes-heading" role="doc-noteref">[1]</a></sup>."`,
    );
  });

  it("stays byte-identical across repeated hydrations of the same payload", () => {
    const raw = textWidget("X[fn]a[/fn] Y[fn]b[/fn] Z[fn]c[/fn]");
    const first = processWidgetFootnotes(raw, "pl");
    const firstHtml = html(first.widget);

    // Snapshot pierwszej hydratacji - zmiana wymaga świadomej aktualizacji.
    expect(firstHtml).toMatchInlineSnapshot(
      `"X<sup class="fn-ref"><a href="#fn-1" id="fnref-1" data-fn="1" title="a" aria-describedby="footnotes-heading" role="doc-noteref">[1]</a></sup> Y<sup class="fn-ref"><a href="#fn-2" id="fnref-2" data-fn="2" title="b" aria-describedby="footnotes-heading" role="doc-noteref">[2]</a></sup> Z<sup class="fn-ref"><a href="#fn-3" id="fnref-3" data-fn="3" title="c" aria-describedby="footnotes-heading" role="doc-noteref">[3]</a></sup>"`,
    );

    // Kolejne hydratacje nie mogą zmienić ani jednego bajtu markera ani
    // treści tooltipa - inaczej regresja parity preview↔published.
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
    const w1 = processWidgetFootnotes(
      textWidget("A[fn]a1[/fn] B[fn]a2[/fn]", "w-a"),
      "pl",
      col,
    );
    const w2 = processWidgetFootnotes(
      textWidget("C[fn]b1[/fn]", "w-b"),
      "pl",
      col,
    );

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
        "w1": "A<sup class="fn-ref"><a href="#fn-1" id="fnref-1" data-fn="1" title="a1" aria-describedby="footnotes-heading" role="doc-noteref">[1]</a></sup> B<sup class="fn-ref"><a href="#fn-2" id="fnref-2" data-fn="2" title="a2" aria-describedby="footnotes-heading" role="doc-noteref">[2]</a></sup>",
        "w2": "C<sup class="fn-ref"><a href="#fn-3" id="fnref-3" data-fn="3" title="b1" aria-describedby="footnotes-heading" role="doc-noteref">[3]</a></sup>",
      }
    `);
  });
});
