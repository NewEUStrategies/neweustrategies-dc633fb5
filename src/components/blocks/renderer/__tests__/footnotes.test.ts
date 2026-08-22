import { describe, it, expect } from "vitest";
import type { Block } from "@/lib/blocks/types";
import { createCounter, escapeAttr } from "@/lib/footnotes";
import { hasFn, precomputeFootnotes, replaceFootnotes, type FootnoteCollector } from "../footnotes";

describe("renderer/footnotes engine", () => {
  // Escapowanie żyje teraz w JEDNYM miejscu (lib/footnotes::escapeAttr) - warstwa
  // bloków nie ma własnej kopii, więc nie ma czego rozjechać.
  it("escapeAttr neutralises markup-significant characters", () => {
    expect(escapeAttr(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("hasFn detects the [fn] shortcode only on strings", () => {
    expect(hasFn("a [fn]note[/fn] b")).toBe(true);
    expect(hasFn("plain")).toBe(false);
    expect(hasFn(42)).toBe(false);
    expect(hasFn(null)).toBe(false);
  });

  it("replaceFootnotes numbers sequentially and collects note text", () => {
    const fn: FootnoteCollector = createCounter(1);
    const out = replaceFootnotes("First[fn]alpha[/fn] second[fn]beta[/fn]", fn);
    expect(fn.notes).toEqual([
      { id: 1, html: "alpha" },
      { id: 2, html: "beta" },
    ]);
    expect(out).toContain('href="#fn-1"');
    expect(out).toContain('href="#fn-2"');
    expect(out).toContain('data-fn="1"');
    expect(out).toContain('role="doc-noteref"');
    expect(out).toContain("[1]");
    expect(out).toContain("[2]");
    // Regresja: styl w PostContentStyle - tu żadnych klas Tailwind.
    expect(out).not.toContain("text-primary");
  });

  it("replaceFootnotes drops empty notes and leaves tooltip content to the shared overlay", () => {
    const fn: FootnoteCollector = createCounter(1);
    const out = replaceFootnotes("A[fn]  [/fn]B[fn]<b>x</b> & y[/fn]", fn);
    // The empty note is dropped; only the real one is collected.
    expect(fn.notes).toEqual([{ id: 1, html: "<b>x</b> & y" }]);
    // Brak `title` zapobiega pokazaniu drugiego, natywnego tooltipa przeglądarki.
    expect(out).not.toContain("title=");
  });

  it("precomputeFootnotes walks every text-bearing field with stable keys", () => {
    const blocks: Block[] = [
      { id: "p", type: "paragraph", data: { html: "Body[fn]p-note[/fn]" } },
      { id: "h", type: "heading", data: { level: 2, text: "Title[fn]h-note[/fn]" } },
      { id: "l", type: "list", data: { items: ["plain", "item[fn]l-note[/fn]"] } },
      { id: "q", type: "quote", data: { text: "Q[fn]q-text[/fn]", cite: "C[fn]q-cite[/fn]" } },
      {
        id: "t",
        type: "table",
        data: {
          rows: [
            ["h1", "h2"],
            ["cell[fn]t-note[/fn]", "plain"],
          ],
        },
      },
    ];
    const fn: FootnoteCollector = createCounter(1);
    const out = new Map<string, string>();
    precomputeFootnotes(blocks, fn, out);

    // paragraph/html always cached under the bare id.
    expect(out.has("p")).toBe(true);
    // field-level keys only when a footnote was present.
    expect(out.has("h:text")).toBe(true);
    expect(out.has("l:item:1")).toBe(true);
    expect(out.has("l:item:0")).toBe(false);
    expect(out.has("q:text")).toBe(true);
    expect(out.has("q:cite")).toBe(true);
    expect(out.has("t:cell:1:0")).toBe(true);

    // Document-order numbering across all fields.
    expect(fn.notes.map((n) => n.html)).toEqual([
      "p-note",
      "h-note",
      "l-note",
      "q-text",
      "q-cite",
      "t-note",
    ]);
    // Numeracja jawna, z kolektora - nie z indeksu tablicy w widoku.
    expect(fn.notes.map((n) => n.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("precomputeFootnotes obejmuje blok spoiler (też renderuje HTML)", () => {
    // `spoiler` wstawia `data.html` przez dangerouslySetInnerHTML dokładnie jak
    // paragraph/html, więc należy do tej samej rodziny. Wcześniej wypadał z
    // pre-passu i pokazywał dosłowny shortcode.
    const blocks: Block[] = [
      { id: "s", type: "spoiler", data: { summary: "Więcej", html: "Ukryte[fn]s-note[/fn]" } },
    ];
    const fn: FootnoteCollector = createCounter(1);
    const out = new Map<string, string>();
    precomputeFootnotes(blocks, fn, out);

    expect(out.has("s")).toBe(true);
    expect(out.get("s")).toContain('data-fn="1"');
    expect(fn.notes).toEqual([{ id: 1, html: "s-note" }]);
  });

  it("precomputeFootnotes recurses into columns (left then right) and containers", () => {
    const blocks: Block[] = [
      {
        id: "c",
        type: "columns",
        data: {
          left: [{ id: "cl", type: "paragraph", data: { html: "L[fn]left[/fn]" } }],
          right: [{ id: "cr", type: "paragraph", data: { html: "R[fn]right[/fn]" } }],
        },
      },
      {
        id: "g",
        type: "group",
        data: { children: [{ id: "gc", type: "paragraph", data: { html: "G[fn]grouped[/fn]" } }] },
      },
    ];
    const fn: FootnoteCollector = createCounter(1);
    const out = new Map<string, string>();
    precomputeFootnotes(blocks, fn, out);
    expect(fn.notes.map((n) => n.html)).toEqual(["left", "right", "grouped"]);
    expect(out.has("cl")).toBe(true);
    expect(out.has("cr")).toBe(true);
    expect(out.has("gc")).toBe(true);
  });
});
