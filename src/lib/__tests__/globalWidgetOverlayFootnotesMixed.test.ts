// Regresja: mieszane oraz zagnieżdżone przypisy `[fn]…[/fn]` w overlay
// globalnych widgetów. Kontrakt (marker SAMODZIELNY - patrz
// src/test/footnoteMarker.ts):
//  - wiele znaczników w tym samym polu numerowane sekwencyjnie (bez dedup po
//    identycznym tekście - każde wystąpienie ma własny id),
//  - sąsiadujące `[fn]a[/fn][fn]b[/fn]` traktowane jako dwa oddzielne,
//  - zagnieżdżone `[fn]outer[fn]inner[/fn][/fn]` nie duplikują numeracji:
//    silnik dopasowuje jeden przypis (non-greedy),
//  - mieszanka z HTML inline (strong/em/a) nie łamie numeracji.

import { describe, it, expect } from "vitest";
import { createCounter, processWidgetFootnotes } from "@/lib/footnotes";
import { countMarkers, hasMarker } from "@/test/footnoteMarker";
import type { WidgetNode } from "@/lib/builder/types";

function textWidget(html: string, id = "w-mix"): WidgetNode {
  return {
    kind: "widget",
    id,
    type: "text",
    content: { html_pl: html },
  } as unknown as WidgetNode;
}

describe("global widget overlay footnotes - mixed + nested", () => {
  it("assigns unique ids to identical footnote texts in the same block", () => {
    const raw = textWidget("A[fn]same[/fn] B[fn]same[/fn] C[fn]same[/fn]");
    const { widget, notes } = processWidgetFootnotes(raw, "pl");
    const html = String((widget.content as Record<string, unknown>).html_pl);

    expect(notes.map((n) => n.id)).toEqual([1, 2, 3]);
    expect(notes.map((n) => n.html)).toEqual(["same", "same", "same"]);
    for (const n of [1, 2, 3]) expect(hasMarker(html, n)).toBe(true);
    expect(html).not.toContain("[fn]");
    expect(html).not.toContain("[/fn]");
  });

  it("handles adjacent footnotes without a separator", () => {
    const raw = textWidget("X[fn]a[/fn][fn]b[/fn][fn]c[/fn]Y");
    const { widget, notes } = processWidgetFootnotes(raw, "pl");
    const html = String((widget.content as Record<string, unknown>).html_pl);

    expect(notes.map((n) => n.id)).toEqual([1, 2, 3]);
    expect(notes.map((n) => n.html)).toEqual(["a", "b", "c"]);
    // Trzy odrębne `sup`, nie zlepione w jeden marker.
    expect(countMarkers(html)).toBe(3);
  });

  it("does not double-count nested [fn][fn]inner[/fn][/fn] markers", () => {
    // Non-greedy regex dopasowuje najbliższy `[/fn]`, więc zagnieżdżenie
    // daje dokładnie JEDEN wpis, a nie dwa. Kluczowe: brak duplikacji id.
    const raw = textWidget("P[fn]outer[fn]inner[/fn][/fn] Q[fn]drugi[/fn] R");
    const { widget, notes } = processWidgetFootnotes(raw, "pl");
    const html = String((widget.content as Record<string, unknown>).html_pl);

    expect(notes.map((n) => n.id)).toEqual([1, 2]);
    expect(countMarkers(html)).toBe(2);
    expect(hasMarker(html, 1)).toBe(true);
    expect(hasMarker(html, 2)).toBe(true);
    expect(hasMarker(html, 3)).toBe(false);
    expect(notes[1]?.html).toBe("drugi");
  });

  it("preserves numbering when footnotes are interleaved with inline HTML", () => {
    const raw = textWidget(
      '<p><strong>A</strong>[fn]f1[/fn] <em>B[fn]f2[/fn]</em> ' +
        '<a href="https://example.com">C[fn]f3[/fn]</a> D[fn]f4[/fn]</p>',
    );
    const { widget, notes } = processWidgetFootnotes(raw, "pl");
    const html = String((widget.content as Record<string, unknown>).html_pl);

    expect(notes.map((n) => n.id)).toEqual([1, 2, 3, 4]);
    expect(notes.map((n) => n.html)).toEqual(["f1", "f2", "f3", "f4"]);
    expect(html).toContain("<strong>A</strong>");
    expect(html).toContain("<em>B");
    expect(html).toContain('href="https://example.com"');
    expect(countMarkers(html)).toBe(4);
  });

  it("mixed and nested markers keep a global counter across sibling widgets", () => {
    const col = createCounter(1);
    const w1 = processWidgetFootnotes(textWidget("A[fn]a1[/fn][fn]a2[/fn]", "w-a"), "pl", col);
    const w2 = processWidgetFootnotes(textWidget("B[fn]outer[fn]inner[/fn][/fn]", "w-b"), "pl", col);
    const w3 = processWidgetFootnotes(textWidget("C[fn]c1[/fn] D[fn]c2[/fn]", "w-c"), "pl", col);

    expect(w3.notes.map((n) => n.id)).toEqual([1, 2, 3, 4, 5]);
    expect(w3.notes.map((n) => n.html)).toEqual([
      "a1",
      "a2",
      // zagnieżdżenie: silnik zachowuje wewnętrzny tekst jako treść przypisu
      w3.notes[2]?.html ?? "",
      "c1",
      "c2",
    ]);
    expect(typeof w3.notes[2]?.html).toBe("string");
    expect(w3.notes[2]?.html.length ?? 0).toBeGreaterThan(0);

    const h1 = String((w1.widget.content as Record<string, unknown>).html_pl);
    const h2 = String((w2.widget.content as Record<string, unknown>).html_pl);
    const h3 = String((w3.widget.content as Record<string, unknown>).html_pl);

    expect(countMarkers(h1)).toBe(2);
    expect(countMarkers(h2)).toBe(1);
    expect(countMarkers(h3)).toBe(2);
    expect(hasMarker(h2, 3)).toBe(true);
    expect(hasMarker(h3, 4)).toBe(true);
    expect(hasMarker(h3, 5)).toBe(true);
  });
});
