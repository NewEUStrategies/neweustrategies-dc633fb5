import { describe, it, expect } from "vitest";
import { validateFootnotes } from "../footnoteValidation";
import type { BlocksDoc } from "../types";

function doc(...blocks: BlocksDoc["blocks"]): BlocksDoc {
  return { version: 1, blocks } as BlocksDoc;
}

function p(html: string) {
  return { id: "p", type: "paragraph", data: { html } } as never;
}

describe("validateFootnotes", () => {
  it("returns [] for a document without markers", () => {
    expect(validateFootnotes(doc(p("Zwykły akapit bez przypisów.")))).toEqual([]);
  });

  it("returns [] for balanced, non-empty markers", () => {
    const d = doc(p("Tekst [fn]źródło A[/fn] i [fn]źródło B[/fn]."));
    expect(validateFootnotes(d)).toEqual([]);
  });

  it("flags an unclosed [fn]", () => {
    const issues = validateFootnotes(doc(p("Tekst [fn]bez końca")));
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("UNCLOSED");
    expect(issues[0].path).toEqual([0, "data", "html"]);
  });

  it("flags a stray [/fn]", () => {
    const issues = validateFootnotes(doc(p("Tekst bez początku[/fn].")));
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("STRAY_CLOSE");
  });

  it("flags nested [fn][fn]…[/fn][/fn]", () => {
    const issues = validateFootnotes(doc(p("[fn]zewn [fn]wewn[/fn][/fn]")));
    // Zagnieżdżenie + zamknięty wewnętrzny (ok) + zamknięty zewnętrzny (ok).
    const kinds = issues.map((i) => i.kind);
    expect(kinds).toContain("NESTED");
  });

  it("flags empty [fn][/fn] as no-op", () => {
    const issues = validateFootnotes(doc(p("Tekst [fn][/fn] i dalej.")));
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("EMPTY");
  });

  it("flags malformed variants like [FN], [ fn ], [fn/]", () => {
    const issues = validateFootnotes(
      doc(p("A [FN]x[/FN] B [ fn ]y[ /fn ] C [fn/]z")),
    );
    const kinds = issues.map((i) => i.kind);
    // 4 warianty niepoprawnych tagów w powyższym łańcuchu.
    expect(kinds.filter((k) => k === "MALFORMED_TAG").length).toBeGreaterThanOrEqual(4);
  });

  it("resolves paths for list items and table cells", () => {
    const listBlock = {
      id: "l",
      type: "list",
      data: { items: ["ok", "[fn]bez końca"] },
    } as never;
    const tableBlock = {
      id: "t",
      type: "table",
      data: { rows: [["ok", "[/fn] sam"]] },
    } as never;
    const issues = validateFootnotes(doc(listBlock, tableBlock));
    const paths = issues.map((i) => i.path);
    expect(paths).toContainEqual([0, "data", "items", 1]);
    expect(paths).toContainEqual([1, "data", "rows", 0, 1]);
  });

  it("walks into columns and group children", () => {
    const inner = p("[fn]niedomkniete");
    const columns = {
      id: "c",
      type: "columns",
      data: { left: [inner], right: [] },
    } as never;
    const issues = validateFootnotes(doc(columns));
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("UNCLOSED");
    expect(issues[0].path).toEqual([0, "data", "left", 0, "data", "html"]);
  });

  it("does not flag correctly-paired markers even with malformed nearby", () => {
    const issues = validateFootnotes(
      doc(p("[fn]poprawny[/fn] oraz [FN]zly[/FN]")),
    );
    expect(issues.every((i) => i.kind === "MALFORMED_TAG")).toBe(true);
    expect(issues).toHaveLength(2);
  });
});
