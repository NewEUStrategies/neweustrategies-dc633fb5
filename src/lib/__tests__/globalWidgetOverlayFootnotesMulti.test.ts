// Regresja: wielokrotne przypisy `[fn]…[/fn]` w overlay globalnych widgetów
// muszą być numerowane sekwencyjnie w kolejności wystąpienia, a wielokrotna
// hydratacja tego samego payloadu NIE może duplikować numeracji ani rosnąć
// zbiorów przypisów. Kontrakt: `processWidgetFootnotes` jest idempotentne dla
// stabilnego payloadu i produkuje marker SAMODZIELNY (src/test/footnoteMarker.ts).

import { describe, it, expect } from "vitest";
import { createCounter, processWidgetFootnotes } from "@/lib/footnotes";
import { hasMarker } from "@/test/footnoteMarker";
import type { WidgetNode } from "@/lib/builder/types";

function makeTextWidget(html: string, id = "w-1"): WidgetNode {
  return {
    kind: "widget",
    id,
    type: "text",
    content: { html_pl: html },
  } as unknown as WidgetNode;
}

describe("global widget overlay footnotes - multi + rehydration", () => {
  it("numbers many footnotes sequentially in document order", () => {
    const raw = makeTextWidget(
      "A[fn]pierwszy[/fn] B[fn]drugi[/fn] C[fn]trzeci[/fn] D[fn]czwarty[/fn] E[fn]piąty[/fn].",
    );
    const { widget, notes } = processWidgetFootnotes(raw, "pl");
    const html = String((widget.content as Record<string, unknown>).html_pl);

    expect(html).not.toContain("[fn]");
    expect(notes.map((n) => n.id)).toEqual([1, 2, 3, 4, 5]);
    expect(notes.map((n) => n.html)).toEqual([
      "pierwszy",
      "drugi",
      "trzeci",
      "czwarty",
      "piąty",
    ]);
    for (const n of [1, 2, 3, 4, 5]) expect(hasMarker(html, n)).toBe(true);
  });

  it("re-processing the same widget N times does not duplicate numbering", () => {
    const raw = makeTextWidget("X[fn]a[/fn] Y[fn]b[/fn] Z[fn]c[/fn]");
    const first = processWidgetFootnotes(raw, "pl");
    const firstHtml = String((first.widget.content as Record<string, unknown>).html_pl);

    let current = first.widget;
    for (let i = 0; i < 5; i += 1) {
      const step = processWidgetFootnotes(current, "pl");
      const stepHtml = String((step.widget.content as Record<string, unknown>).html_pl);
      expect(stepHtml).toBe(firstHtml);
      expect(step.notes).toEqual([]);
      expect(hasMarker(stepHtml, 4)).toBe(false);
      current = step.widget;
    }
  });

  it("shares a counter across sibling global widgets in document order", () => {
    const col = createCounter(1);
    const w1 = processWidgetFootnotes(makeTextWidget("A[fn]a1[/fn] B[fn]a2[/fn]", "w-a"), "pl", col);
    const w2 = processWidgetFootnotes(makeTextWidget("C[fn]b1[/fn]", "w-b"), "pl", col);
    const w3 = processWidgetFootnotes(makeTextWidget("D[fn]c1[/fn] E[fn]c2[/fn]", "w-c"), "pl", col);

    expect(w3.notes.map((n) => n.id)).toEqual([1, 2, 3, 4, 5]);
    expect(w3.notes.map((n) => n.html)).toEqual(["a1", "a2", "b1", "c1", "c2"]);

    const h1 = String((w1.widget.content as Record<string, unknown>).html_pl);
    const h2 = String((w2.widget.content as Record<string, unknown>).html_pl);
    const h3 = String((w3.widget.content as Record<string, unknown>).html_pl);

    expect(hasMarker(h1, 1)).toBe(true);
    expect(hasMarker(h1, 2)).toBe(true);
    expect(hasMarker(h2, 3)).toBe(true);
    expect(hasMarker(h2, 1)).toBe(false);
    expect(hasMarker(h3, 4)).toBe(true);
    expect(hasMarker(h3, 5)).toBe(true);
  });

  it("keeps numbering stable in accordion answers across rehydrations", () => {
    // Tylko `a_*` jest polem HTML akordeonu - `q_*` renderuje się jako tekst.
    const acc: WidgetNode = {
      kind: "widget",
      id: "w-acc",
      type: "accordion",
      content: {
        items: [
          { q_pl: "T1", a_pl: "C1[fn]c1[/fn] i[fn]c1b[/fn]" },
          { q_pl: "T2", a_pl: "C2[fn]c2[/fn]" },
          { q_pl: "T3", a_pl: "C3[fn]c3[/fn]" },
        ],
      },
    } as unknown as WidgetNode;

    const first = processWidgetFootnotes(acc, "pl");
    expect(first.notes.map((n) => n.id)).toEqual([1, 2, 3, 4]);
    expect(first.notes.map((n) => n.html)).toEqual(["c1", "c1b", "c2", "c3"]);

    const second = processWidgetFootnotes(first.widget, "pl");
    const third = processWidgetFootnotes(second.widget, "pl");

    const serialize = (w: WidgetNode) => JSON.stringify((w.content as { items: unknown[] }).items);

    expect(serialize(second.widget)).toBe(serialize(first.widget));
    expect(serialize(third.widget)).toBe(serialize(first.widget));
    expect(second.notes).toEqual([]);
    expect(third.notes).toEqual([]);
  });
});
