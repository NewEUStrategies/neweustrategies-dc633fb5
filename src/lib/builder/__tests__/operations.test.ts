import { describe, it, expect } from "vitest";
import type {
  BuilderDocument, SectionNode, ColumnNode, InnerSectionNode, WidgetNode, SectionChild, WidgetType,
} from "../types";
import * as ops from "../operations";

// ---------- fixtures ----------
const w = (id: string, type: WidgetType = "text"): WidgetNode => ({ id, kind: "widget", type, content: {} });
const col = (id: string, children: WidgetNode[] = [], span = 12): ColumnNode =>
  ({ id, kind: "column", span: { desktop: span }, children });
const inner = (id: string, columns: ColumnNode[]): InnerSectionNode =>
  ({ id, kind: "inner-section", columns });
const sec = (id: string, children: SectionChild[]): SectionNode => ({ id, kind: "section", children });
const doc = (...sections: SectionNode[]): BuilderDocument => ({ version: 1, sections });

const ids = (c: ColumnNode) => c.children.map((x) => x.id);

describe("node factories", () => {
  it("newColumn defaults to span 12 and no children", () => {
    const c = ops.newColumn();
    expect(c.kind).toBe("column");
    expect(c.span).toEqual({ desktop: 12 });
    expect(c.children).toEqual([]);
    expect(c.id).toBeTruthy();
  });

  it("newSection(n) creates n equal columns summing to 12", () => {
    const s = ops.newSection(3);
    expect(s.children).toHaveLength(3);
    expect(s.children.every((c) => c.kind === "column" && c.span.desktop === 4)).toBe(true);
  });

  it("newSection([spans]) honours explicit spans", () => {
    const s = ops.newSection([8, 4]);
    expect((s.children as ColumnNode[]).map((c) => c.span.desktop)).toEqual([8, 4]);
  });

  it("newInnerSection has two 6-span columns", () => {
    const i = ops.newInnerSection();
    expect(i.columns).toHaveLength(2);
    expect(i.columns.map((c) => c.span.desktop)).toEqual([6, 6]);
  });
});

describe("section mutations", () => {
  it("addSection appends a section", () => {
    const d = doc(sec("s1", []));
    ops.addSection(d, 2);
    expect(d.sections).toHaveLength(2);
    expect(d.sections[1].children).toHaveLength(2);
  });

  it("insertSectionAt inserts at an index", () => {
    const d = doc(sec("s1", []), sec("s2", []));
    ops.insertSectionAt(d, 1, 1);
    expect(d.sections.map((s) => s.id).slice(0, 1)).toEqual(["s1"]);
    expect(d.sections).toHaveLength(3);
    expect(d.sections[2].id).toBe("s2");
  });

  it("removeSection drops the matching section", () => {
    const d = doc(sec("s1", []), sec("s2", []));
    ops.removeSection(d, "s1");
    expect(d.sections.map((s) => s.id)).toEqual(["s2"]);
  });

  it("moveSection swaps with the neighbour in the given direction", () => {
    const d = doc(sec("a", []), sec("b", []), sec("c", []));
    ops.moveSection(d, "b", -1);
    expect(d.sections.map((s) => s.id)).toEqual(["b", "a", "c"]);
    ops.moveSection(d, "b", 1);
    expect(d.sections.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("moveSection is a no-op at the boundaries", () => {
    const d = doc(sec("a", []), sec("b", []));
    ops.moveSection(d, "a", -1);
    expect(d.sections.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("duplicateSection inserts a deep copy with fresh ids right after", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]));
    ops.duplicateSection(d, "s1");
    expect(d.sections).toHaveLength(2);
    const copy = d.sections[1];
    expect(copy.id).not.toBe("s1");
    const copyCol = copy.children[0] as ColumnNode;
    expect(copyCol.id).not.toBe("c1");
    expect(copyCol.children[0].id).not.toBe("w1");
  });

  it("moveSectionTo reorders before/after a target", () => {
    const d = doc(sec("a", []), sec("b", []), sec("c", []));
    ops.moveSectionTo(d, "a", "c", "after");
    expect(d.sections.map((s) => s.id)).toEqual(["b", "c", "a"]);
    ops.moveSectionTo(d, "a", "b", "before");
    expect(d.sections.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("moveSectionTo is a no-op when src equals target", () => {
    const d = doc(sec("a", []), sec("b", []));
    ops.moveSectionTo(d, "a", "a", "before");
    expect(d.sections.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("column mutations", () => {
  it("addColumn rebalances span for the new column count", () => {
    const d = doc(sec("s1", [col("c1")]));
    ops.addColumn(d, "s1");
    const cols = d.sections[0].children as ColumnNode[];
    expect(cols).toHaveLength(2);
    expect(cols[1].span.desktop).toBe(6); // floor(12 / 2)
  });

  it("removeColumn removes top-level and inner columns", () => {
    const d = doc(sec("s1", [col("c1"), inner("i1", [col("ic1"), col("ic2")])]));
    ops.removeColumn(d, "c1");
    ops.removeColumn(d, "ic1");
    const children = d.sections[0].children;
    expect(children.find((c) => c.kind === "column")).toBeUndefined();
    const innerNode = children.find((c) => c.kind === "inner-section") as InnerSectionNode;
    expect(innerNode.columns.map((c) => c.id)).toEqual(["ic2"]);
  });

  it("duplicateColumn clones a top-level column with fresh ids", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]));
    ops.duplicateColumn(d, "c1");
    const cols = d.sections[0].children as ColumnNode[];
    expect(cols).toHaveLength(2);
    expect(cols[1].id).not.toBe("c1");
    expect(cols[1].children[0].id).not.toBe("w1");
  });

  it("addInnerSection appends an inner-section to a section", () => {
    const d = doc(sec("s1", [col("c1")]));
    ops.addInnerSection(d, "s1");
    expect(d.sections[0].children.some((c) => c.kind === "inner-section")).toBe(true);
  });
});

describe("widget mutations", () => {
  it("removeWidget removes from any column (incl. inner)", () => {
    const d = doc(sec("s1", [col("c1", [w("w1"), w("w2")]), inner("i1", [col("ic1", [w("w3")])])]));
    ops.removeWidget(d, "w1");
    ops.removeWidget(d, "w3");
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual(["w2"]);
    const innerNode = d.sections[0].children[1] as InnerSectionNode;
    expect(ids(innerNode.columns[0])).toEqual([]);
  });

  it("duplicateWidget inserts a fresh-id copy directly after", () => {
    const d = doc(sec("s1", [col("c1", [w("w1"), w("w2")])]));
    ops.duplicateWidget(d, "w1");
    const c = d.sections[0].children[0] as ColumnNode;
    expect(c.children).toHaveLength(3);
    expect(c.children[1].id).not.toBe("w1");
    expect(c.children[2].id).toBe("w2");
  });

  it("addWidgetToColumn pushes a ready widget", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]));
    ops.addWidgetToColumn(d, "c1", w("new"));
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual(["w1", "new"]);
  });

  it("addWidgetToNewSection wraps the widget in a fresh 1-column section", () => {
    const d = doc();
    ops.addWidgetToNewSection(d, w("new"));
    expect(d.sections).toHaveLength(1);
    const c = d.sections[0].children[0] as ColumnNode;
    expect(c.span.desktop).toBe(12);
    expect(ids(c)).toEqual(["new"]);
  });

  it("insertWidgetNear inserts before/after a target widget", () => {
    const d = doc(sec("s1", [col("c1", [w("w1"), w("w2")])]));
    ops.insertWidgetNear(d, "w1", "before", w("b"));
    ops.insertWidgetNear(d, "w2", "after", w("a"));
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual(["b", "w1", "w2", "a"]);
  });

  it("appendWidgetToSection creates a column when the section has none", () => {
    const d = doc(sec("s1", []));
    ops.appendWidgetToSection(d, "s1", w("new"));
    const c = d.sections[0].children[0] as ColumnNode;
    expect(c.kind).toBe("column");
    expect(ids(c)).toEqual(["new"]);
  });

  it("appendWidgetToSection appends a new full-width column even when one exists", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]));
    ops.appendWidgetToSection(d, "s1", w("new"));
    expect(d.sections[0].children).toHaveLength(2);
    const second = d.sections[0].children[1] as ColumnNode;
    expect(second.kind).toBe("column");
    expect(second.span).toBe(12);
    expect(ids(second)).toEqual(["new"]);
  });
});

describe("widget moves", () => {
  it("moveWidgetTo reorders within a column (before)", () => {
    const d = doc(sec("s1", [col("c1", [w("w1"), w("w2"), w("w3")])]));
    ops.moveWidgetTo(d, "w3", "w1", "before");
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual(["w3", "w1", "w2"]);
  });

  it("moveWidgetTo moves across columns (after)", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")]), col("c2", [w("w2")])]));
    ops.moveWidgetTo(d, "w1", "w2", "after");
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual([]);
    expect(ids(d.sections[0].children[1] as ColumnNode)).toEqual(["w2", "w1"]);
  });

  it("moveWidgetTo is a no-op when src equals target", () => {
    const d = doc(sec("s1", [col("c1", [w("w1"), w("w2")])]));
    ops.moveWidgetTo(d, "w1", "w1", "before");
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual(["w1", "w2"]);
  });

  it("moveWidgetToColumn appends to the target column", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")]), col("c2", [])]));
    ops.moveWidgetToColumn(d, "w1", "c2");
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual([]);
    expect(ids(d.sections[0].children[1] as ColumnNode)).toEqual(["w1"]);
  });

  it("moveWidgetToSection appends to the section's first column", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]), sec("s2", [col("c2", [])]));
    ops.moveWidgetToSection(d, "w1", "s2");
    expect(ids(d.sections[0].children[0] as ColumnNode)).toEqual([]);
    expect(ids(d.sections[1].children[0] as ColumnNode)).toEqual(["w1"]);
  });

  it("moveWidgetToSection creates a column when target section has none", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]), sec("s2", []));
    ops.moveWidgetToSection(d, "w1", "s2");
    const target = d.sections[1].children[0] as ColumnNode;
    expect(target.kind).toBe("column");
    expect(ids(target)).toEqual(["w1"]);
  });
});

describe("toggleHidden", () => {
  it("sets and clears per-device visibility on a widget", () => {
    const d = doc(sec("s1", [col("c1", [w("w1")])]));
    ops.toggleHidden(d, "w1", "widget", "mobile");
    const node = (d.sections[0].children[0] as ColumnNode).children[0];
    expect(node.advanced?.hideOn?.mobile).toBe(true);
    ops.toggleHidden(d, "w1", "widget", "mobile");
    expect(node.advanced?.hideOn?.mobile).toBe(false);
  });

  it("targets sections, columns and inner-sections by kind", () => {
    const d = doc(sec("s1", [col("c1"), inner("i1", [col("ic1")])]));
    ops.toggleHidden(d, "s1", "section", "desktop");
    ops.toggleHidden(d, "c1", "column", "tablet");
    ops.toggleHidden(d, "i1", "inner-section", "desktop");
    expect(d.sections[0].advanced?.hideOn?.desktop).toBe(true);
    expect((d.sections[0].children[0] as ColumnNode).advanced?.hideOn?.tablet).toBe(true);
    expect((d.sections[0].children[1] as InnerSectionNode).advanced?.hideOn?.desktop).toBe(true);
  });
});
