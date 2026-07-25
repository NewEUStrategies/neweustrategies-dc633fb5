// Regresja: wielokrotne przypisy `[fn]…[/fn]` w overlay globalnych widgetów
// muszą być numerowane sekwencyjnie w kolejności wystąpienia, a wielokrotna
// hydratacja tego samego payloadu NIE może duplikować numeracji ani rosnąc
// zbiorów przypisów. Kontrakt: processWidgetFootnotes jest idempotentne dla
// stabilnego payloadu i zwraca deterministyczną numerację 1..N.

import { describe, it, expect } from "vitest";
import { createCounter, processWidgetFootnotes } from "@/lib/footnotes";
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
    for (const n of [1, 2, 3, 4, 5]) {
      expect(html).toMatch(new RegExp(`data-fn="${n}"`));
    }
  });

  it("re-processing the same widget N times does not duplicate numbering", () => {
    const raw = makeTextWidget("X[fn]a[/fn] Y[fn]b[/fn] Z[fn]c[/fn]");
    const first = processWidgetFootnotes(raw, "pl");
    const firstHtml = String((first.widget.content as Record<string, unknown>).html_pl);

    let current = first.widget;
    for (let i = 0; i < 5; i += 1) {
      const step = processWidgetFootnotes(current, "pl");
      const stepHtml = String((step.widget.content as Record<string, unknown>).html_pl);
      // Payload nie może rosnąć ani zmieniać numeracji przy stabilnym wejściu.
      expect(stepHtml).toBe(firstHtml);
      // Rehydratacja już rozwiniętego HTML nie odkrywa nowych przypisów -
      // markery [1..3] pozostają, ale kolektor nie dostaje kolejnych wpisów.
      expect(step.notes).toEqual([]);
      // Nie ma nowych markerów [4], [5], … przy rehydratacji.
      expect(stepHtml).not.toMatch(/data-fn="4"/);
      current = step.widget;
    }
  });

  it("shares a counter across sibling global widgets in document order", () => {
    // Overlay wielu globalnych widgetów pod jednym dokumentem: numeracja
    // musi być globalna, nie per-widget.
    const col = createCounter(1);
    const w1 = processWidgetFootnotes(
      makeTextWidget("A[fn]a1[/fn] B[fn]a2[/fn]", "w-a"),
      "pl",
      col,
    );
    const w2 = processWidgetFootnotes(
      makeTextWidget("C[fn]b1[/fn]", "w-b"),
      "pl",
      col,
    );
    const w3 = processWidgetFootnotes(
      makeTextWidget("D[fn]c1[/fn] E[fn]c2[/fn]", "w-c"),
      "pl",
      col,
    );

    // Ostatni zwrot niesie skumulowany zbiór przypisów całego dokumentu.
    expect(w3.notes.map((n) => n.id)).toEqual([1, 2, 3, 4, 5]);
    expect(w3.notes.map((n) => n.html)).toEqual(["a1", "a2", "b1", "c1", "c2"]);

    const h1 = String((w1.widget.content as Record<string, unknown>).html_pl);
    const h2 = String((w2.widget.content as Record<string, unknown>).html_pl);
    const h3 = String((w3.widget.content as Record<string, unknown>).html_pl);

    expect(h1).toMatch(/data-fn="1"/);
    expect(h1).toMatch(/data-fn="2"/);
    expect(h2).toMatch(/data-fn="3"/);
    expect(h2).not.toMatch(/data-fn="1"/);
    expect(h3).toMatch(/data-fn="4"/);
    expect(h3).toMatch(/data-fn="5"/);
  });

  it("keeps numbering stable in accordion items across rehydrations", () => {
    const acc: WidgetNode = {
      kind: "widget",
      id: "w-acc",
      type: "accordion",
      content: {
        items: [
          { title_pl: "T1[fn]t1[/fn]", content_pl: "C1[fn]c1[/fn]" },
          { title_pl: "T2[fn]t2[/fn]", content_pl: "C2[fn]c2[/fn]" },
          { title_pl: "T3", content_pl: "C3[fn]c3[/fn]" },
        ],
      },
    } as unknown as WidgetNode;

    const first = processWidgetFootnotes(acc, "pl");
    expect(first.notes.map((n) => n.id)).toEqual([1, 2, 3, 4, 5]);
    expect(first.notes.map((n) => n.html)).toEqual(["t1", "c1", "t2", "c2", "c3"]);

    const second = processWidgetFootnotes(first.widget, "pl");
    const third = processWidgetFootnotes(second.widget, "pl");

    const serialize = (w: WidgetNode) =>
      JSON.stringify((w.content as { items: unknown[] }).items);

    expect(serialize(second.widget)).toBe(serialize(first.widget));
    expect(serialize(third.widget)).toBe(serialize(first.widget));
    expect(second.notes).toEqual(first.notes);
    expect(third.notes).toEqual(first.notes);
  });
});
