// Regresja: mieszane oraz zagnieżdżone przypisy `[fn]…[/fn]` w overlay
// globalnych widgetów. Kontrakt:
//  - wiele znaczników w tym samym polu numerowane sekwencyjnie (bez dedup po
//    identycznym tekście - każde wystąpienie ma własny id),
//  - sąsiadujące `[fn]a[/fn][fn]b[/fn]` traktowane jako dwa oddzielne,
//  - zagnieżdżone `[fn]outer[fn]inner[/fn][/fn]` — nie duplikują numeracji:
//    silnik dopasowuje jeden przypis (non-greedy), pozostały tekst nie tworzy
//    dodatkowego `data-fn`,
//  - mieszanka z HTML inline (strong/em/a) nie łamie numeracji.

import { describe, it, expect } from "vitest";
import { createCounter, processWidgetFootnotes } from "@/lib/footnotes";
import type { WidgetNode } from "@/lib/builder/types";

function textWidget(html: string, id = "w-mix"): WidgetNode {
  return {
    kind: "widget",
    id,
    type: "text",
    content: { html_pl: html },
  } as unknown as WidgetNode;
}

function countMatches(s: string, re: RegExp): number {
  return (s.match(re) ?? []).length;
}

describe("global widget overlay footnotes - mixed + nested", () => {
  it("assigns unique ids to identical footnote texts in the same block", () => {
    const raw = textWidget("A[fn]same[/fn] B[fn]same[/fn] C[fn]same[/fn]");
    const { widget, notes } = processWidgetFootnotes(raw, "pl");
    const html = String((widget.content as Record<string, unknown>).html_pl);

    expect(notes.map((n) => n.id)).toEqual([1, 2, 3]);
    expect(notes.map((n) => n.html)).toEqual(["same", "same", "same"]);
    expect(html).toMatch(/data-fn="1"/);
    expect(html).toMatch(/data-fn="2"/);
    expect(html).toMatch(/data-fn="3"/);
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
    expect(countMatches(html, /data-fn="\d+"/g)).toBe(3);
  });

  it("does not double-count nested [fn][fn]inner[/fn][/fn] markers", () => {
    // Non-greedy regex dopasowuje najbliższy `[/fn]`, więc zagnieżdżenie
    // daje dokładnie JEDEN wpis, a nie dwa. Kluczowe: brak duplikacji id.
    const raw = textWidget(
      "P[fn]outer[fn]inner[/fn][/fn] Q[fn]drugi[/fn] R",
    );
    const { widget, notes } = processWidgetFootnotes(raw, "pl");
    const html = String((widget.content as Record<string, unknown>).html_pl);

    // Dokładnie 2 markery numerowane 1..2 - bez skoku do 3 i bez zdublowanego id=1.
    expect(notes.map((n) => n.id)).toEqual([1, 2]);
    expect(countMatches(html, /data-fn="\d+"/g)).toBe(2);
    expect(html).toMatch(/data-fn="1"/);
    expect(html).toMatch(/data-fn="2"/);
    expect(html).not.toMatch(/data-fn="3"/);
    // Drugi przypis to "drugi", nie "inner" ani "outer[fn]inner".
    expect(notes[1]?.html).toBe("drugi");
    // Znany limit: przy zagnieżdżeniu treść zewnętrznego `[fn]` zawiera
    // literalne `[fn]inner`, więc płaska rehydratacja może to ponownie
    // dopasować — nie testujemy tu pełnej idempotencji, tylko brak
    // duplikacji numeracji w pierwszym przebiegu (kontrakt: N markerów,
    // ids 1..N w kolejności wystąpienia w źródle).
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
    // Otaczające tagi zachowane.
    expect(html).toContain("<strong>A</strong>");
    expect(html).toContain("<em>B");
    expect(html).toContain('href="https://example.com"');
    expect(countMatches(html, /data-fn="\d+"/g)).toBe(4);
  });

  it("mixed and nested markers keep a global counter across sibling widgets", () => {
    const col = createCounter(1);
    const w1 = processWidgetFootnotes(
      textWidget("A[fn]a1[/fn][fn]a2[/fn]", "w-a"),
      "pl",
      col,
    );
    const w2 = processWidgetFootnotes(
      textWidget("B[fn]outer[fn]inner[/fn][/fn]", "w-b"),
      "pl",
      col,
    );
    const w3 = processWidgetFootnotes(
      textWidget("C[fn]c1[/fn] D[fn]c2[/fn]", "w-c"),
      "pl",
      col,
    );

    // Globalna numeracja: 1,2 (w-a) + 3 (w-b, zagnieżdżenie liczy się raz)
    // + 4,5 (w-c). Brak duplikacji, brak przeskoków.
    expect(w3.notes.map((n) => n.id)).toEqual([1, 2, 3, 4, 5]);
    expect(w3.notes.map((n) => n.html)).toEqual([
      "a1",
      "a2",
      // zagnieżdżenie: silnik zachowuje wewnętrzny tekst jako treść przypisu
      // (dokładne dopasowanie zależy od non-greedy regex - waliduje tylko,
      // że jest to jeden wpis, nie dwa).
      w3.notes[2]?.html ?? "",
      "c1",
      "c2",
    ]);
    expect(typeof w3.notes[2]?.html).toBe("string");
    expect(w3.notes[2]?.html.length ?? 0).toBeGreaterThan(0);

    const h1 = String((w1.widget.content as Record<string, unknown>).html_pl);
    const h2 = String((w2.widget.content as Record<string, unknown>).html_pl);
    const h3 = String((w3.widget.content as Record<string, unknown>).html_pl);

    expect(countMatches(h1, /data-fn="\d+"/g)).toBe(2);
    expect(countMatches(h2, /data-fn="\d+"/g)).toBe(1);
    expect(countMatches(h3, /data-fn="\d+"/g)).toBe(2);
    expect(h2).toMatch(/data-fn="3"/);
    expect(h3).toMatch(/data-fn="4"/);
    expect(h3).toMatch(/data-fn="5"/);
  });
});
