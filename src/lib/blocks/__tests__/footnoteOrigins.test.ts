// Origins + edycja przypisów: gwarancje dla panelu „Przypisy źródłowe".
//
// Kluczowe niezmienniki:
// 1. Numeracja `id` jest identyczna z tą, którą wyprodukuje `precomputeFootnotes`
//    na tym samym dokumencie (kolejność dokumentowa, puste dropowane).
// 2. `updateFootnoteAtOrigin` podmienia DOKŁADNIE jedno wystąpienie, nawet gdy
//    w tym samym polu jest wiele `[fn]…[/fn]`, sąsiadujących lub identycznych.
// 3. Puste `newHtml` usuwa cały marker (zgodnie z silnikiem, który puste dropuje).
// 4. Update jest immutable - reszta dokumentu współdzielona referencyjnie.

import { describe, it, expect } from "vitest";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { createCounter } from "@/lib/footnotes";
import { precomputeFootnotes } from "@/components/blocks/renderer/footnotes";
import {
  collectFootnoteOrigins,
  updateFootnoteAtOrigin,
} from "@/lib/blocks/footnoteOrigins";

const doc = (blocks: Block[]): BlocksDoc => ({ blocks } as unknown as BlocksDoc);

describe("collectFootnoteOrigins", () => {
  it("numeruje identycznie jak precomputeFootnotes", () => {
    const blocks: Block[] = [
      { id: "p", type: "paragraph", data: { html: "A[fn]one[/fn] B[fn]two[/fn]" } },
      { id: "h", type: "heading", data: { level: 2, text: "H[fn]three[/fn]" } },
      { id: "l", type: "list", data: { items: ["x[fn]four[/fn]", "plain"] } },
      {
        id: "c",
        type: "columns",
        data: {
          left: [{ id: "cl", type: "paragraph", data: { html: "L[fn]five[/fn]" } }],
          right: [{ id: "cr", type: "paragraph", data: { html: "R[fn]six[/fn]" } }],
        },
      },
    ];
    const fn = createCounter(1);
    precomputeFootnotes(blocks, fn, new Map());
    const origins = collectFootnoteOrigins(doc(blocks));
    expect(origins.map((o) => o.id)).toEqual(fn.notes.map((n) => n.id));
    expect(origins.map((o) => o.html)).toEqual(fn.notes.map((n) => n.html));
  });

  it("puste [fn][/fn] nie zużywa numeru", () => {
    const blocks: Block[] = [
      { id: "p", type: "paragraph", data: { html: "A[fn]one[/fn] B[fn]  [/fn] C[fn]two[/fn]" } },
    ];
    const origins = collectFootnoteOrigins(doc(blocks));
    expect(origins.map((o) => o.id)).toEqual([1, 2]);
    expect(origins.map((o) => o.html)).toEqual(["one", "two"]);
    expect(origins.map((o) => o.origin.occurrence)).toEqual([0, 1]);
  });
});

describe("updateFootnoteAtOrigin", () => {
  it("edytuje N-ty przypis, nie ruszając pozostałych", () => {
    const blocks: Block[] = [
      { id: "p", type: "paragraph", data: { html: "A[fn]one[/fn] B[fn]two[/fn] C[fn]three[/fn]" } },
    ];
    const d = doc(blocks);
    const origins = collectFootnoteOrigins(d);
    const next = updateFootnoteAtOrigin(d, origins[1].origin, "TWO!");
    const html = (next.blocks[0].data as { html: string }).html;
    expect(html).toBe("A[fn]one[/fn] B[fn]TWO![/fn] C[fn]three[/fn]");
  });

  it("rozróżnia identyczne treści po occurrence", () => {
    const blocks: Block[] = [
      { id: "p", type: "paragraph", data: { html: "X[fn]same[/fn] Y[fn]same[/fn]" } },
    ];
    const d = doc(blocks);
    const origins = collectFootnoteOrigins(d);
    const next = updateFootnoteAtOrigin(d, origins[1].origin, "second");
    expect((next.blocks[0].data as { html: string }).html).toBe(
      "X[fn]same[/fn] Y[fn]second[/fn]",
    );
  });

  it("puste newHtml usuwa marker", () => {
    const blocks: Block[] = [
      { id: "p", type: "paragraph", data: { html: "A[fn]one[/fn] B[fn]two[/fn]" } },
    ];
    const d = doc(blocks);
    const origins = collectFootnoteOrigins(d);
    const next = updateFootnoteAtOrigin(d, origins[0].origin, "  ");
    expect((next.blocks[0].data as { html: string }).html).toBe(" B[fn]two[/fn]");
  });

  it("działa dla list, table, quote i kontenerów", () => {
    const blocks: Block[] = [
      { id: "l", type: "list", data: { items: ["x[fn]a[/fn]", "y[fn]b[/fn] z[fn]c[/fn]"] } },
      { id: "t", type: "table", data: { rows: [["cell[fn]d[/fn]"]] } },
      { id: "q", type: "quote", data: { text: "Q[fn]e[/fn]", cite: "C[fn]f[/fn]" } },
      {
        id: "g",
        type: "group",
        data: {
          children: [{ id: "gc", type: "paragraph", data: { html: "G[fn]g[/fn]" } }],
        },
      },
    ];
    const d = doc(blocks);
    const origins = collectFootnoteOrigins(d);
    expect(origins.map((o) => o.html)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    // Edycja "c" (drugi fn w items[1])
    const nc = updateFootnoteAtOrigin(d, origins[2].origin, "C-NEW");
    expect((nc.blocks[0].data as { items: string[] }).items[1]).toBe(
      "y[fn]b[/fn] z[fn]C-NEW[/fn]",
    );
    // Edycja "f" (cite w quote)
    const nf = updateFootnoteAtOrigin(d, origins[5].origin, "F-NEW");
    expect((nf.blocks[2].data as { cite: string }).cite).toBe("C[fn]F-NEW[/fn]");
    // Edycja "g" (wnętrze group)
    const ng = updateFootnoteAtOrigin(d, origins[6].origin, "G-NEW");
    const gChildren = (ng.blocks[3].data as { children: Block[] }).children;
    expect((gChildren[0].data as { html: string }).html).toBe("G[fn]G-NEW[/fn]");
  });

  it("update jest immutable - oryginał nietknięty, nieedytowane gałęzie współdzielone", () => {
    const blocks: Block[] = [
      { id: "p1", type: "paragraph", data: { html: "A[fn]one[/fn]" } },
      { id: "p2", type: "paragraph", data: { html: "B (bez fn)" } },
    ];
    const d = doc(blocks);
    const origins = collectFootnoteOrigins(d);
    const next = updateFootnoteAtOrigin(d, origins[0].origin, "ONE!");
    // Oryginał niezmieniony
    expect((d.blocks[0].data as { html: string }).html).toBe("A[fn]one[/fn]");
    // Nieedytowany blok - ta sama referencja (tania kopia strukturalna)
    expect(next.blocks[1]).toBe(d.blocks[1]);
    expect(next).not.toBe(d);
  });
});
