import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "@/lib/sanitize";
import { expandFootnotes, createCounter } from "@/lib/footnotes";

describe("multi [fn] in one text", () => {
  it("sanitize keeps [fn] tokens intact", () => {
    const s = "First[fn]alpha[/fn] second[fn]beta[/fn] third[fn]gamma[/fn]";
    const out = sanitizeHtml(s);
    expect(out.match(/\[fn\]/g)?.length).toBe(3);
  });

  it("HTML with tags between multiple [fn]", () => {
    const s = "<p>A<strong>x[fn]one[/fn]</strong> B[fn]two[/fn] <em>C[fn]three[/fn]</em></p>";
    const col = createCounter(1);
    const out = expandFootnotes(sanitizeHtml(s), col);
    expect(col.notes.map(n => n.id)).toEqual([1,2,3]);
    expect(col.notes.map(n => n.html)).toEqual(["one","two","three"]);
    expect(out).toContain("[1]"); expect(out).toContain("[2]"); expect(out).toContain("[3]");
  });

  it("adjacent [fn] with no separator", () => {
    const col = createCounter(1);
    const out = expandFootnotes("A[fn]one[/fn][fn]two[/fn][fn]three[/fn]B", col);
    expect(col.notes.length).toBe(3);
    expect(out).toContain('data-fn="1"');
    expect(out).toContain('data-fn="2"');
    expect(out).toContain('data-fn="3"');
  });

  it("multiline note bodies", () => {
    const col = createCounter(1);
    const out = expandFootnotes("A[fn]line1\nline2[/fn] B[fn]other[/fn]", col);
    expect(col.notes).toEqual([
      { id: 1, html: "line1\nline2" },
      { id: 2, html: "other" },
    ]);
    expect(out).toContain("[1]"); expect(out).toContain("[2]");
  });
});
