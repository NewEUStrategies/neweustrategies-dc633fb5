import { describe, it, expect } from "vitest";
import {
  WIDGET_TYPES,
  isKnownWidgetType,
  safeParseBuilderDoc,
  isBuilderDoc,
} from "./schema";
import { WIDGET_MAP } from "./registry";
import type { WidgetType } from "./types";

describe("WIDGET_TYPES ↔ registry drift guard", () => {
  it("lists exactly the widget types the registry implements", () => {
    const listed = [...WIDGET_TYPES].sort();
    const registered = (Object.keys(WIDGET_MAP) as WidgetType[]).sort();
    expect(listed).toEqual(registered);
  });

  it("has no duplicates", () => {
    expect(new Set(WIDGET_TYPES).size).toBe(WIDGET_TYPES.length);
  });
});

describe("isKnownWidgetType", () => {
  it("accepts known types and rejects everything else", () => {
    expect(isKnownWidgetType("heading")).toBe(true);
    expect(isKnownWidgetType("post-list")).toBe(true);
    expect(isKnownWidgetType("definitely-not-a-widget")).toBe(false);
    expect(isKnownWidgetType("")).toBe(false);
    expect(isKnownWidgetType(42)).toBe(false);
    expect(isKnownWidgetType(null)).toBe(false);
    expect(isKnownWidgetType(undefined)).toBe(false);
  });
});

describe("safeParseBuilderDoc — top level", () => {
  it("returns an empty doc for non-objects", () => {
    expect(safeParseBuilderDoc(null).sections).toEqual([]);
    expect(safeParseBuilderDoc(undefined).sections).toEqual([]);
    expect(safeParseBuilderDoc("x").sections).toEqual([]);
    expect(safeParseBuilderDoc(42).sections).toEqual([]);
    expect(safeParseBuilderDoc([]).sections).toEqual([]);
  });

  it("returns an empty doc for the wrong version or missing/invalid sections", () => {
    expect(safeParseBuilderDoc({ version: 2, sections: [] }).sections).toEqual([]);
    expect(safeParseBuilderDoc({ version: 1 }).sections).toEqual([]);
    expect(safeParseBuilderDoc({ version: 1, sections: "x" }).sections).toEqual([]);
    expect(safeParseBuilderDoc({ version: 1, sections: {} }).sections).toEqual([]);
  });

  it("always pins version to 1", () => {
    expect(safeParseBuilderDoc({ version: 1, sections: [] }).version).toBe(1);
  });
});

describe("safeParseBuilderDoc — sections", () => {
  it("drops non-object sections but keeps valid ones", () => {
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [null, "x", 7, { id: "s1", kind: "section", children: [] }],
    });
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].id).toBe("s1");
  });

  it("defaults a missing kind to 'section' and a missing children to []", () => {
    const doc = safeParseBuilderDoc({ version: 1, sections: [{ id: "s1" }] });
    expect(doc.sections[0].kind).toBe("section");
    expect(doc.sections[0].children).toEqual([]);
  });

  it("synthesizes an id when one is missing", () => {
    const doc = safeParseBuilderDoc({ version: 1, sections: [{ kind: "section" }] });
    expect(typeof doc.sections[0].id).toBe("string");
    expect(doc.sections[0].id.length).toBeGreaterThan(0);
  });

  it("preserves cosmetic fields untouched", () => {
    const background = { type: "classic", imageUrl: "https://x/y.jpg" };
    const style = { bgColor: "#fff" };
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [{ id: "s1", kind: "section", children: [], background, style, layout: { contentWidth: "full" } }],
    });
    expect(doc.sections[0].background).toEqual(background);
    expect(doc.sections[0].style).toEqual(style);
    expect(doc.sections[0].layout).toEqual({ contentWidth: "full" });
  });
});

describe("safeParseBuilderDoc — columns & widgets", () => {
  const wrap = (children: unknown[]) => ({
    version: 1,
    sections: [{ id: "s1", kind: "section", children }],
  });

  it("coerces a column and drops unknown / malformed widgets", () => {
    const doc = safeParseBuilderDoc(
      wrap([
        {
          id: "c1",
          kind: "column",
          span: { desktop: 6 },
          children: [
            { id: "w1", kind: "widget", type: "heading", content: { text_pl: "Hi" } },
            { id: "w2", kind: "widget", type: "totally-unknown", content: {} },
            "garbage",
            { id: "w3", kind: "widget", type: "button" }, // missing content
          ],
        },
      ]),
    );
    const col = doc.sections[0].children[0] as { kind: string; span: unknown; children: Array<{ id: string; content: unknown }> };
    expect(col.kind).toBe("column");
    expect(col.span).toEqual({ desktop: 6 });
    expect(col.children.map((w) => w.id)).toEqual(["w1", "w3"]);
    expect(col.children[1].content).toEqual({}); // defaulted
  });

  it("coerces a span, keeping only numeric breakpoints", () => {
    const doc = safeParseBuilderDoc(
      wrap([{ id: "c1", kind: "column", span: { desktop: 6, tablet: "x", mobile: 12 }, children: [] }]),
    );
    const col = doc.sections[0].children[0] as unknown as { span: Record<string, number> };
    expect(col.span).toEqual({ desktop: 6, mobile: 12 });
  });

  it("falls back to an empty span object when span is absent or invalid", () => {
    const doc = safeParseBuilderDoc(wrap([{ id: "c1", kind: "column", children: [] }]));
    const col = doc.sections[0].children[0] as { span: unknown };
    expect(col.span).toEqual({});
  });

  it("treats non-array column children as empty", () => {
    const doc = safeParseBuilderDoc(wrap([{ id: "c1", kind: "column", children: "nope" }]));
    const col = doc.sections[0].children[0] as { children: unknown[] };
    expect(col.children).toEqual([]);
  });
});

describe("safeParseBuilderDoc — inner sections", () => {
  it("detects an inner-section by its kind discriminator", () => {
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [
        {
          id: "s1",
          kind: "section",
          children: [
            {
              id: "inner1",
              kind: "inner-section",
              columns: [{ id: "ic1", kind: "column", span: { desktop: 6 }, children: [] }],
            },
          ],
        },
      ],
    });
    const inner = doc.sections[0].children[0] as { kind: string; columns: unknown[] };
    expect(inner.kind).toBe("inner-section");
    expect(inner.columns).toHaveLength(1);
  });

  it("detects an inner-section by shape (columns without children) and drops bad columns", () => {
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [
        {
          id: "s1",
          kind: "section",
          children: [{ id: "inner1", columns: [null, { id: "ic1", kind: "column", children: [] }] }],
        },
      ],
    });
    const inner = doc.sections[0].children[0] as { kind: string; columns: Array<{ id: string }> };
    expect(inner.kind).toBe("inner-section");
    expect(inner.columns.map((c) => c.id)).toEqual(["ic1"]);
  });

  it("treats non-array inner-section columns as empty", () => {
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [{ id: "s1", kind: "section", children: [{ id: "i", kind: "inner-section", columns: 5 }] }],
    });
    const inner = doc.sections[0].children[0] as { columns: unknown[] };
    expect(inner.columns).toEqual([]);
  });

  it("drops non-object section children", () => {
    const doc = safeParseBuilderDoc({
      version: 1,
      sections: [{ id: "s1", kind: "section", children: [null, 3, "x"] }],
    });
    expect(doc.sections[0].children).toEqual([]);
  });
});

describe("isBuilderDoc", () => {
  it("accepts a structurally valid doc", () => {
    expect(
      isBuilderDoc({
        version: 1,
        sections: [
          {
            id: "s1",
            kind: "section",
            children: [
              { id: "c1", kind: "column", span: {}, children: [{ id: "w1", kind: "widget", type: "heading", content: {} }] },
              { id: "i1", kind: "inner-section", columns: [] },
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects invalid shapes", () => {
    expect(isBuilderDoc(null)).toBe(false);
    expect(isBuilderDoc({ version: 2, sections: [] })).toBe(false);
    expect(isBuilderDoc({ version: 1, sections: "x" })).toBe(false);
    expect(isBuilderDoc({ version: 1, sections: [{ id: "s1" }] })).toBe(false); // no children array
    expect(isBuilderDoc({ version: 1, sections: [{ children: "x" }] })).toBe(false);
    expect(
      isBuilderDoc({ version: 1, sections: [{ children: [{ kind: "column", children: [{ type: "nope" }] }] }] }),
    ).toBe(false); // unknown widget type
    expect(isBuilderDoc({ version: 1, sections: [{ children: [3] }] })).toBe(false);
  });

  it("round-trips: safeParseBuilderDoc output is always a valid doc", () => {
    const messy = {
      version: 1,
      sections: [
        { id: "s1", children: [{ columns: [{ children: [{ type: "heading" }, { type: "junk" }] }] }] },
        "garbage",
      ],
    };
    expect(isBuilderDoc(safeParseBuilderDoc(messy))).toBe(true);
  });
});
