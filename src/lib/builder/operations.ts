// Pure operations on a BuilderDocument tree: find / mutate / duplicate / move.
// Returns new ids on duplicate so React keys stay stable and undo/redo works.
import type {
  BuilderDocument, SectionNode, ColumnNode, InnerSectionNode, WidgetNode,
} from "./types";
import { newId } from "./types";

export type NodeKind = "section" | "inner-section" | "column" | "widget";

export interface FoundPath {
  kind: NodeKind;
  sectionIdx: number;
  innerIdx?: number;      // index in section.children (the inner-section)
  childIdx?: number;      // column index inside section or inner-section
  widgetIdx?: number;     // widget index inside column
}

export function findPath(doc: BuilderDocument, id: string): FoundPath | null {
  for (let si = 0; si < doc.sections.length; si++) {
    const s = doc.sections[si];
    if (s.id === id) return { kind: "section", sectionIdx: si };
    for (let ci = 0; ci < s.children.length; ci++) {
      const c = s.children[ci];
      if (c.kind === "inner-section") {
        if (c.id === id) return { kind: "inner-section", sectionIdx: si, innerIdx: ci };
        for (let ici = 0; ici < c.columns.length; ici++) {
          const col = c.columns[ici];
          if (col.id === id) return { kind: "column", sectionIdx: si, innerIdx: ci, childIdx: ici };
          for (let wi = 0; wi < col.children.length; wi++) {
            if (col.children[wi].id === id) return {
              kind: "widget", sectionIdx: si, innerIdx: ci, childIdx: ici, widgetIdx: wi,
            };
          }
        }
      } else {
        if (c.id === id) return { kind: "column", sectionIdx: si, childIdx: ci };
        for (let wi = 0; wi < c.children.length; wi++) {
          if (c.children[wi].id === id) return {
            kind: "widget", sectionIdx: si, childIdx: ci, widgetIdx: wi,
          };
        }
      }
    }
  }
  return null;
}

export function getColumnByPath(doc: BuilderDocument, p: FoundPath): ColumnNode | null {
  const s = doc.sections[p.sectionIdx];
  if (!s) return null;
  if (p.innerIdx !== undefined) {
    const inner = s.children[p.innerIdx];
    if (!inner || inner.kind !== "inner-section") return null;
    return p.childIdx !== undefined ? inner.columns[p.childIdx] ?? null : null;
  }
  const c = p.childIdx !== undefined ? s.children[p.childIdx] : null;
  return c && c.kind === "column" ? c : null;
}

// ---------- deep clone with fresh ids ----------

export function cloneWidget(w: WidgetNode): WidgetNode {
  return { ...JSON.parse(JSON.stringify(w)) as WidgetNode, id: newId() };
}

export function cloneColumn(c: ColumnNode): ColumnNode {
  const copy = JSON.parse(JSON.stringify(c)) as ColumnNode;
  copy.id = newId();
  copy.children = copy.children.map((w) => ({ ...w, id: newId() }));
  return copy;
}

export function cloneInner(s: InnerSectionNode): InnerSectionNode {
  const copy = JSON.parse(JSON.stringify(s)) as InnerSectionNode;
  copy.id = newId();
  copy.columns = copy.columns.map(cloneColumn);
  return copy;
}

export function cloneSection(s: SectionNode): SectionNode {
  const copy = JSON.parse(JSON.stringify(s)) as SectionNode;
  copy.id = newId();
  copy.children = copy.children.map((c) =>
    c.kind === "inner-section" ? cloneInner(c) : cloneColumn(c),
  );
  return copy;
}

// ---------- find + remove ----------

export function findWidget(doc: BuilderDocument, id: string):
  { widget: WidgetNode; column: ColumnNode } | null {
  for (const s of doc.sections) {
    for (const child of s.children) {
      const cols = child.kind === "column" ? [child] : child.columns;
      for (const col of cols) {
        const w = col.children.find((x) => x.id === id);
        if (w) return { widget: w, column: col };
      }
    }
  }
  return null;
}

export function findSection(doc: BuilderDocument, id: string): SectionNode | null {
  return doc.sections.find((s) => s.id === id) ?? null;
}

export function findColumn(doc: BuilderDocument, id: string): ColumnNode | null {
  for (const s of doc.sections) for (const c of s.children) {
    if (c.kind === "column" && c.id === id) return c;
    if (c.kind === "inner-section") {
      const f = c.columns.find((x) => x.id === id);
      if (f) return f;
    }
  }
  return null;
}

export function findInner(doc: BuilderDocument, id: string): InnerSectionNode | null {
  for (const s of doc.sections) for (const c of s.children) {
    if (c.kind === "inner-section" && c.id === id) return c;
  }
  return null;
}
