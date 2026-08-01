// Regresje dla wielu przypisów `[fn]…[/fn]` w JEDNYM bloku tekstu.
//
// Silnik jest wspólny (lib/footnotes::expandFootnotes), ale numeracja i
// zbieranie treści muszą być stabilne niezależnie od:
// - liczby markerów w polu (2, 3, sąsiadujące bez separatora),
// - HTML dookoła (tagi inline, entity, wielolinijkowa treść noty),
// - typu bloku, w którym pole żyje (paragraph/heading/list/table/quote/spoiler),
// - zagnieżdżenia w kontenerach (columns/group/row/stack/grid).
//
// Test istnieje osobno od `renderer/__tests__/footnotes.test.ts`, bo tamten
// weryfikuje KONTRAKT pre-passu (klucze mapy, zasięg), a ten - konkretną
// regresję "wiele fn w jednym bloku" opisaną przez autora treści.

import { describe, it, expect } from "vitest";
import type { Block } from "@/lib/blocks/types";
import { sanitizeHtml } from "@/lib/sanitize";
import { createCounter, expandFootnotes } from "@/lib/footnotes";
import {
  precomputeFootnotes,
  type FootnoteCollector,
} from "@/components/blocks/renderer/footnotes";

describe("multi [fn] w jednym stringu (silnik)", () => {
  it("sanitize zachowuje wszystkie tokeny [fn]", () => {
    const s = "First[fn]alpha[/fn] second[fn]beta[/fn] third[fn]gamma[/fn]";
    const out = sanitizeHtml(s);
    expect(out.match(/\[fn\]/g)?.length).toBe(3);
    expect(out.match(/\[\/fn\]/g)?.length).toBe(3);
  });

  it("markery numerują się kolejno w obrębie jednego stringa", () => {
    const col = createCounter(1);
    const out = expandFootnotes("A[fn]one[/fn] B[fn]two[/fn] C[fn]three[/fn]", col);
    expect(col.notes).toEqual([
      { id: 1, html: "one" },
      { id: 2, html: "two" },
      { id: 3, html: "three" },
    ]);
    for (const n of [1, 2, 3]) {
      expect(out).toContain(`href="#fn-${n}"`);
      expect(out).toContain(`id="fnref-${n}"`);
      expect(out).toContain(`data-fn="${n}"`);
      expect(out).toContain(`[${n}]`);
    }
  });

  it("sąsiadujące markery bez separatora nie sklejają się", () => {
    const col = createCounter(1);
    const out = expandFootnotes("A[fn]one[/fn][fn]two[/fn][fn]three[/fn]B", col);
    expect(col.notes.map((n) => n.id)).toEqual([1, 2, 3]);
    // Trzy różne markery, nie jeden zmutowany.
    expect(out.match(/class="fn-ref"/g)?.length).toBe(3);
  });

  it("wielolinijkowa treść noty nie łapie sąsiedniego markera", () => {
    const col = createCounter(1);
    expandFootnotes("A[fn]line1\nline2[/fn] B[fn]other[/fn]", col);
    expect(col.notes).toEqual([
      { id: 1, html: "line1\nline2" },
      { id: 2, html: "other" },
    ]);
  });

  it("markery między tagami inline (HTML w środku bloku)", () => {
    const col = createCounter(1);
    const out = expandFootnotes(
      "<p>A<strong>x[fn]one[/fn]</strong> B[fn]two[/fn] <em>C[fn]three[/fn]</em></p>",
      col,
    );
    expect(col.notes.map((n) => n.html)).toEqual(["one", "two", "three"]);
    expect(out).toMatch(/<strong>x<sup class="fn-ref">/);
  });

  it("puste [fn][/fn] w środku sekwencji nie zużywa numeru", () => {
    const col = createCounter(1);
    const out = expandFootnotes("A[fn]one[/fn] B[fn]  [/fn] C[fn]two[/fn]", col);
    expect(col.notes).toEqual([
      { id: 1, html: "one" },
      { id: 2, html: "two" },
    ]);
    expect(out).toContain("[1]");
    expect(out).toContain("[2]");
    expect(out).not.toContain("[3]");
  });
});

describe("multi [fn] w blokach (pre-pass renderera)", () => {
  it("paragraph z trzema przypisami: mapa zawiera wszystkie markery pod id bloku", () => {
    const blocks: Block[] = [
      {
        id: "p1",
        type: "paragraph",
        data: { html: "A[fn]one[/fn] B[fn]two[/fn] C[fn]three[/fn]" },
      },
    ];
    const fn: FootnoteCollector = createCounter(1);
    const out = new Map<string, string>();
    precomputeFootnotes(blocks, fn, out);

    const html = out.get("p1") ?? "";
    expect(fn.notes.map((n) => n.html)).toEqual(["one", "two", "three"]);
    for (const n of [1, 2, 3]) expect(html).toContain(`data-fn="${n}"`);
  });

  it("numeracja jest ciągła między kolejnymi blokami (dokumentowa kolejność)", () => {
    const blocks: Block[] = [
      { id: "a", type: "paragraph", data: { html: "A[fn]a1[/fn] A2[fn]a2[/fn]" } },
      { id: "h", type: "heading", data: { level: 2, text: "H[fn]h1[/fn]" } },
      { id: "b", type: "paragraph", data: { html: "B[fn]b1[/fn] B2[fn]b2[/fn]" } },
    ];
    const fn: FootnoteCollector = createCounter(1);
    precomputeFootnotes(blocks, fn, new Map());
    expect(fn.notes.map((n) => n.id)).toEqual([1, 2, 3, 4, 5]);
    expect(fn.notes.map((n) => n.html)).toEqual(["a1", "a2", "h1", "b1", "b2"]);
  });

  it("list/table/quote: wiele fn w jednej komórce/pozycji dostają unikalne numery", () => {
    const blocks: Block[] = [
      {
        id: "l",
        type: "list",
        data: {
          items: ["A[fn]l1[/fn] B[fn]l2[/fn]", "plain"],
        },
      },
      {
        id: "q",
        type: "quote",
        data: {
          text: "Q[fn]q1[/fn] R[fn]q2[/fn]",
          cite: "C[fn]q3[/fn]",
        },
      },
      {
        id: "t",
        type: "table",
        data: {
          rows: [["cell[fn]t1[/fn] more[fn]t2[/fn]", "plain"]],
        },
      },
    ];
    const fn: FootnoteCollector = createCounter(1);
    const out = new Map<string, string>();
    precomputeFootnotes(blocks, fn, out);
    expect(fn.notes.map((n) => n.html)).toEqual(["l1", "l2", "q1", "q2", "q3", "t1", "t2"]);
    // Pojedynczy klucz mapy dla pola nadal niesie oba markery.
    expect(out.get("l:item:0")).toMatch(/data-fn="1"[\s\S]*data-fn="2"/);
    expect(out.get("q:text")).toMatch(/data-fn="3"[\s\S]*data-fn="4"/);
    expect(out.get("t:cell:0:0")).toMatch(/data-fn="6"[\s\S]*data-fn="7"/);
  });

  it("kontenery (columns/group) zachowują ciągłą numerację między dziećmi", () => {
    const blocks: Block[] = [
      {
        id: "c",
        type: "columns",
        data: {
          left: [{ id: "cl", type: "paragraph", data: { html: "L[fn]l1[/fn] L2[fn]l2[/fn]" } }],
          right: [{ id: "cr", type: "paragraph", data: { html: "R[fn]r1[/fn]" } }],
        },
      },
      {
        id: "g",
        type: "group",
        data: {
          children: [{ id: "gc", type: "paragraph", data: { html: "G[fn]g1[/fn] G2[fn]g2[/fn]" } }],
        },
      },
    ];
    const fn: FootnoteCollector = createCounter(1);
    precomputeFootnotes(blocks, fn, new Map());
    expect(fn.notes.map((n) => n.html)).toEqual(["l1", "l2", "r1", "g1", "g2"]);
    expect(fn.notes.map((n) => n.id)).toEqual([1, 2, 3, 4, 5]);
  });
});
