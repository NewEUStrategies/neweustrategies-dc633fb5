// Tree operations for A/B tests and global-widget instances.
import { describe, expect, it } from "vitest";
import type { BuilderDocument, ColumnNode, SectionNode, WidgetNode } from "../types";
import { endAbTest, startAbTest, unlinkGlobalWidget } from "../operations";

const widget = (id: string, globalId?: string): WidgetNode => ({
  id,
  kind: "widget",
  type: "text",
  content: { html_pl: "<p>x</p>" },
  ...(globalId ? { globalId } : {}),
});

const column = (id: string, children: WidgetNode[] = []): ColumnNode => ({
  id,
  kind: "column",
  span: { desktop: 12 },
  children,
});

const sectionWith = (id: string, children: ColumnNode[]): SectionNode => ({
  id,
  kind: "section",
  children,
});

const doc = (...sections: SectionNode[]): BuilderDocument => ({ version: 1, sections });

describe("startAbTest", () => {
  it("duplicates the section below the original and tags both variants", () => {
    const d = doc(sectionWith("s1", [column("c1", [widget("w1")])]), sectionWith("s2", []));
    startAbTest(d, "s1", "exp-1");

    expect(d.sections).toHaveLength(3);
    const [a, b, rest] = d.sections;
    expect(a.advanced?.abTest).toEqual({ experimentId: "exp-1", variant: "a" });
    expect(b.advanced?.abTest).toEqual({ experimentId: "exp-1", variant: "b" });
    expect(rest.id).toBe("s2");
    // The copy is a deep clone with fresh ids.
    expect(b.id).not.toBe(a.id);
    const bCol = b.children[0] as ColumnNode;
    expect(bCol.id).not.toBe("c1");
    expect(bCol.children[0]?.content).toEqual({ html_pl: "<p>x</p>" });
  });

  it("is a no-op for an unknown section", () => {
    const d = doc(sectionWith("s1", []));
    startAbTest(d, "missing", "exp-1");
    expect(d.sections).toHaveLength(1);
    expect(d.sections[0].advanced?.abTest).toBeUndefined();
  });
});

describe("endAbTest", () => {
  const testedDoc = () => {
    const d = doc(sectionWith("s1", []), sectionWith("s2", []));
    startAbTest(d, "s1", "exp-1");
    return d;
  };

  it("keep both: only removes the tags", () => {
    const d = testedDoc();
    endAbTest(d, "exp-1", "both");
    expect(d.sections).toHaveLength(3);
    expect(d.sections.every((s) => !s.advanced?.abTest)).toBe(true);
  });

  it("keep A: removes variant B and the tags", () => {
    const d = testedDoc();
    endAbTest(d, "exp-1", "a");
    expect(d.sections).toHaveLength(2);
    expect(d.sections[0].id).toBe("s1");
    expect(d.sections.every((s) => !s.advanced?.abTest)).toBe(true);
  });

  it("keep B: removes variant A and the tags", () => {
    const d = testedDoc();
    endAbTest(d, "exp-1", "b");
    expect(d.sections).toHaveLength(2);
    expect(d.sections[0].id).not.toBe("s1");
    expect(d.sections.every((s) => !s.advanced?.abTest)).toBe(true);
  });

  it("leaves unrelated experiments untouched", () => {
    const d = doc(sectionWith("s1", []), sectionWith("s2", []));
    startAbTest(d, "s1", "exp-1");
    startAbTest(d, "s2", "exp-2");
    endAbTest(d, "exp-1", "both");
    const tagged = d.sections.filter((s) => s.advanced?.abTest?.experimentId === "exp-2");
    expect(tagged).toHaveLength(2);
  });
});

describe("unlinkGlobalWidget", () => {
  it("removes only the globalId, keeping the snapshot as a local widget", () => {
    const d = doc(sectionWith("s1", [column("c1", [widget("w1", "g1"), widget("w2", "g1")])]));
    unlinkGlobalWidget(d, "w1");
    const col = d.sections[0].children[0] as ColumnNode;
    expect(col.children[0].globalId).toBeUndefined();
    expect(col.children[0].content).toEqual({ html_pl: "<p>x</p>" });
    // Sibling instance stays linked.
    expect(col.children[1].globalId).toBe("g1");
  });
});
