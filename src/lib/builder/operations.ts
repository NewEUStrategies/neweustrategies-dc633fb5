// Pure operations on a BuilderDocument tree: find / mutate / duplicate / move.
// Returns new ids on duplicate so React keys stay stable and undo/redo works.
//
// The mutation helpers in the "structural mutations" section below operate
// IN PLACE on a draft document (the Builder deep-clones before calling them,
// so they never touch the live tree). They were extracted verbatim from
// Builder.tsx so they can be unit-tested in isolation.
import type {
  BuilderDocument, SectionNode, ColumnNode, InnerSectionNode, WidgetNode, Device,
} from "./types";
import { newId } from "./types";
import { isKnownWidgetType } from "./schema";

export type NodeKind = "section" | "inner-section" | "column" | "widget";

export interface FoundPath {
  kind: NodeKind;
  sectionIdx: number;
  innerIdx?: number;      // index in section.children (the inner-section)
  childIdx?: number;      // column index inside section or inner-section
  widgetIdx?: number;     // widget index inside column
}

export function findPath(doc: BuilderDocument, id: string): FoundPath | null {
  if (!doc?.sections) return null;
  for (let si = 0; si < doc.sections.length; si++) {
    const s = doc.sections[si];
    if (!s) continue;
    if (s.id === id) return { kind: "section", sectionIdx: si };
    const children = s.children ?? [];
    for (let ci = 0; ci < children.length; ci++) {
      const c = children[ci];
      if (!c) continue;
      if (c.kind === "inner-section") {
        if (c.id === id) return { kind: "inner-section", sectionIdx: si, innerIdx: ci };
        const columns = c.columns ?? [];
        for (let ici = 0; ici < columns.length; ici++) {
          const col = columns[ici];
          if (!col) continue;
          if (col.id === id) return { kind: "column", sectionIdx: si, innerIdx: ci, childIdx: ici };
          const wchildren = col.children ?? [];
          for (let wi = 0; wi < wchildren.length; wi++) {
            const w = wchildren[wi];
            if (w?.id === id) return {
              kind: "widget", sectionIdx: si, innerIdx: ci, childIdx: ici, widgetIdx: wi,
            };
          }
        }
      } else {
        if (c.id === id) return { kind: "column", sectionIdx: si, childIdx: ci };
        const wchildren = c.children ?? [];
        for (let wi = 0; wi < wchildren.length; wi++) {
          const w = wchildren[wi];
          if (w?.id === id) return {
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
    const inner = (s.children ?? [])[p.innerIdx];
    if (!inner || inner.kind !== "inner-section") return null;
    return p.childIdx !== undefined ? (inner.columns ?? [])[p.childIdx] ?? null : null;
  }
  const c = p.childIdx !== undefined ? (s.children ?? [])[p.childIdx] : null;
  return c && c.kind === "column" ? c : null;
}

// ---------- deep clone with fresh ids ----------

export function cloneWidget(w: WidgetNode): WidgetNode {
  const copy = JSON.parse(JSON.stringify(w ?? {})) as Partial<WidgetNode>;
  return {
    ...copy,
    id: newId(),
    kind: "widget",
    type: isKnownWidgetType(copy.type) ? copy.type : "text",
    content: copy.content && typeof copy.content === "object" && !Array.isArray(copy.content) ? copy.content : {},
  } as WidgetNode;
}

export function cloneColumn(c: ColumnNode): ColumnNode {
  const copy = JSON.parse(JSON.stringify(c ?? {})) as ColumnNode;
  copy.id = newId();
  copy.kind = "column";
  copy.span = copy.span && typeof copy.span === "object" && !Array.isArray(copy.span) ? copy.span : {};
  copy.children = (Array.isArray(copy.children) ? copy.children : [])
    .filter((w): w is WidgetNode => !!w && isKnownWidgetType(w.type))
    .map(cloneWidget);
  return copy;
}

export function cloneInner(s: InnerSectionNode): InnerSectionNode {
  const copy = JSON.parse(JSON.stringify(s ?? {})) as InnerSectionNode;
  copy.id = newId();
  copy.kind = "inner-section";
  copy.columns = (Array.isArray(copy.columns) ? copy.columns : []).filter(Boolean).map(cloneColumn);
  return copy;
}

export function cloneSection(s: SectionNode): SectionNode {
  const copy = JSON.parse(JSON.stringify(s ?? {})) as SectionNode;
  copy.id = newId();
  copy.kind = "section";
  copy.children = (Array.isArray(copy.children) ? copy.children : []).filter(Boolean).map((c) =>
    c.kind === "inner-section" ? cloneInner(c) : cloneColumn(c),
  );
  return copy;
}

// ---------- find + remove ----------

export function findWidget(doc: BuilderDocument, id: string):
  { widget: WidgetNode; column: ColumnNode } | null {
  if (!doc?.sections) return null;
  for (const s of doc.sections) {
    if (!s) continue;
    const children = s.children ?? [];
    for (const child of children) {
      if (!child) continue;
      const cols = child.kind === "column" ? [child] : (child.columns ?? []);
      for (const col of cols) {
        if (!col) continue;
        const w = (col.children ?? []).find((x) => x?.id === id);
        if (w) return { widget: w, column: col };
      }
    }
  }
  return null;
}

export function findSection(doc: BuilderDocument, id: string): SectionNode | null {
  if (!doc?.sections) return null;
  return doc.sections.find((s) => s?.id === id) ?? null;
}

export function findColumn(doc: BuilderDocument, id: string): ColumnNode | null {
  if (!doc?.sections) return null;
  for (const s of doc.sections) {
    if (!s) continue;
    const children = s.children ?? [];
    for (const c of children) {
      if (!c) continue;
      if (c.kind === "column" && c.id === id) return c;
      if (c.kind === "inner-section") {
        const f = (c.columns ?? []).find((x) => x?.id === id);
        if (f) return f;
      }
    }
  }
  return null;
}

export function findInner(doc: BuilderDocument, id: string): InnerSectionNode | null {
  if (!doc?.sections) return null;
  for (const s of doc.sections) {
    if (!s) continue;
    const children = s.children ?? [];
    for (const c of children) {
      if (!c) continue;
      if (c.kind === "inner-section" && c.id === id) return c;
    }
  }
  return null;
}

// ---------- node factories ----------

export const newColumn = (span = 12): ColumnNode => ({
  id: newId(), kind: "column", span: { desktop: span }, children: [],
});

export const newSection = (colsOrSpans: number | number[] = 1): SectionNode => {
  const spans = Array.isArray(colsOrSpans)
    ? colsOrSpans
    : Array.from({ length: colsOrSpans }, () => 12 / colsOrSpans);
  return {
    id: newId(), kind: "section",
    children: spans.map((sp) => newColumn(sp)),
  };
};

export const newInnerSection = (): InnerSectionNode => ({
  id: newId(), kind: "inner-section",
  columns: [newColumn(6), newColumn(6)],
});

// ---------- structural mutations (mutate a draft doc in place) ----------

export function addSection(d: BuilderDocument, colsOrSpans: number | number[]): void {
  d.sections.push(newSection(colsOrSpans));
}

export function insertSectionAt(d: BuilderDocument, index: number, colsOrSpans: number | number[]): void {
  d.sections.splice(index, 0, newSection(colsOrSpans));
}

export function insertSectionNode(d: BuilderDocument, section: SectionNode): void {
  d.sections.push(section);
}

export function removeSection(d: BuilderDocument, id: string): void {
  d.sections = d.sections.filter((s) => s?.id !== id);
}

export function moveSection(d: BuilderDocument, id: string, dir: -1 | 1): void {
  const i = d.sections.findIndex((s) => s?.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= d.sections.length) return;
  [d.sections[i], d.sections[j]] = [d.sections[j], d.sections[i]];
}

export function duplicateSection(d: BuilderDocument, id: string): void {
  const i = d.sections.findIndex((s) => s?.id === id);
  if (i < 0) return;
  d.sections.splice(i + 1, 0, cloneSection(d.sections[i]));
}

export function moveSectionTo(d: BuilderDocument, srcId: string, targetId: string, pos: "before" | "after"): void {
  if (srcId === targetId) return;
  const i = d.sections.findIndex((s) => s?.id === srcId);
  if (i < 0) return;
  const [node] = d.sections.splice(i, 1);
  const j = d.sections.findIndex((s) => s?.id === targetId);
  if (j < 0) { d.sections.push(node); return; }
  d.sections.splice(pos === "before" ? j : j + 1, 0, node);
}

export function addInnerSection(d: BuilderDocument, sectionId: string): void {
  const s = d.sections.find((x) => x?.id === sectionId);
  if (s) {
    if (!s.children) s.children = [];
    s.children.push(newInnerSection());
  }
}

export function addColumn(d: BuilderDocument, sectionId: string): void {
  const s = d.sections.find((x) => x?.id === sectionId);
  if (s) {
    if (!s.children) s.children = [];
    const cols = s.children.filter((c) => c?.kind === "column").length;
    s.children.push(newColumn(Math.max(1, Math.floor(12 / (cols + 1)))));
  }
}

export function removeColumn(d: BuilderDocument, colId: string): void {
  for (const s of d.sections) {
    if (!s) continue;
    s.children = (s.children ?? []).filter((c) => !(c?.kind === "column" && c.id === colId));
    for (const c of s.children) if (c?.kind === "inner-section")
      c.columns = (c.columns ?? []).filter((x) => x?.id !== colId);
  }
}

export function duplicateColumn(d: BuilderDocument, colId: string): void {
  for (const s of d.sections) {
    if (!s) continue;
    const children = s.children ?? [];
    const i = children.findIndex((c) => c?.kind === "column" && c.id === colId);
    if (i >= 0) { s.children.splice(i + 1, 0, cloneColumn(children[i] as ColumnNode)); return; }
    for (const c of children) if (c?.kind === "inner-section") {
      const columns = c.columns ?? [];
      const j = columns.findIndex((x) => x?.id === colId);
      if (j >= 0) { c.columns.splice(j + 1, 0, cloneColumn(columns[j])); return; }
    }
  }
}

export function removeWidget(d: BuilderDocument, wid: string): void {
  for (const s of d.sections) {
    if (!s) continue;
    const children = s.children ?? [];
    for (const c of children) {
      if (!c) continue;
      const cols = c.kind === "column" ? [c] : (c.columns ?? []);
      for (const col of cols) {
        if (!col) continue;
        col.children = (col.children ?? []).filter((w) => w?.id !== wid);
      }
    }
  }
}

export function duplicateWidget(d: BuilderDocument, wid: string): void {
  for (const s of d.sections) {
    if (!s) continue;
    const children = s.children ?? [];
    for (const c of children) {
      if (!c) continue;
      const cols = c.kind === "column" ? [c] : (c.columns ?? []);
      for (const col of cols) {
        if (!col) continue;
        const wchildren = col.children ?? [];
        const i = wchildren.findIndex((w) => w?.id === wid);
        if (i >= 0) { col.children.splice(i + 1, 0, cloneWidget(wchildren[i])); return; }
      }
    }
  }
}

/** Push a ready-made widget node into a specific column. */
export function addWidgetToColumn(d: BuilderDocument, colId: string, widget: WidgetNode): void {
  const c = findColumn(d, colId);
  if (c) {
    if (!c.children) c.children = [];
    c.children.push(widget);
  }
}

/** Push a ready-made widget into a brand-new 1-column section. */
export function addWidgetToNewSection(d: BuilderDocument, widget: WidgetNode): void {
  const s = newSection(1);
  const col = s.children[0] as ColumnNode;
  if (!col.children) col.children = [];
  col.children.push(widget);
  d.sections.push(s);
}

/** Insert a ready-made widget before/after an existing widget (across columns). */
export function insertWidgetNear(d: BuilderDocument, targetWidgetId: string, pos: "before" | "after", widget: WidgetNode): void {
  for (const s of d.sections) {
    if (!s) continue;
    const children = s.children ?? [];
    for (const c of children) {
      if (!c) continue;
      const cols = c.kind === "column" ? [c] : (c.columns ?? []);
      for (const col of cols) {
        if (!col) continue;
        const wchildren = col.children ?? [];
        const i = wchildren.findIndex((x) => x?.id === targetWidgetId);
        if (i >= 0) { col.children.splice(pos === "before" ? i : i + 1, 0, widget); return; }
      }
    }
  }
}

/** Append a ready-made widget to the first column of a section (creating one if needed). */
export function appendWidgetToSection(d: BuilderDocument, sectionId: string, widget: WidgetNode): void {
  const s = d.sections.find((x) => x?.id === sectionId);
  if (!s) return;
  let col: ColumnNode | null = null;
  const children = s.children ?? [];
  for (const ch of children) {
    if (!ch) continue;
    if (ch.kind === "column") { col = ch; break; }
    if (ch.kind === "inner-section" && (ch.columns ?? [])[0]) { col = ch.columns[0]; break; }
  }
  if (!col) {
    const newCol = newColumn(12);
    if (!s.children) s.children = [];
    s.children.push(newCol);
    col = newCol;
  }
  if (!col.children) col.children = [];
  col.children.push(widget);
}

export function moveWidgetTo(d: BuilderDocument, srcId: string, targetId: string, pos: "before" | "after"): void {
  if (srcId === targetId) return;
  let src: WidgetNode | null = null;
  const removeFrom = (col: ColumnNode) => {
    if (!col?.children) return false;
    const i = col.children.findIndex((w) => w?.id === srcId);
    if (i >= 0) { src = col.children.splice(i, 1)[0]; return true; }
    return false;
  };
  for (const s of d.sections) {
    if (!s) continue;
    const children = s.children ?? [];
    for (const c of children) {
      if (!c) continue;
      const cols = c.kind === "column" ? [c] : (c.columns ?? []);
      for (const col of cols) if (removeFrom(col)) break;
      if (src) break;
    }
    if (src) break;
  }
  if (!src) return;
  for (const s of d.sections) {
    if (!s) continue;
    const children = s.children ?? [];
    for (const c of children) {
      if (!c) continue;
      const cols = c.kind === "column" ? [c] : (c.columns ?? []);
      for (const col of cols) {
        if (!col?.children) continue;
        const j = col.children.findIndex((w) => w?.id === targetId);
        if (j >= 0) { col.children.splice(pos === "before" ? j : j + 1, 0, src!); return; }
      }
    }
  }
}

export function moveWidgetToColumn(d: BuilderDocument, srcId: string, targetColId: string): void {
  let src: WidgetNode | null = null;
  for (const s of d.sections) {
    if (!s) continue;
    const children = s.children ?? [];
    for (const c of children) {
      if (!c) continue;
      const cols = c.kind === "column" ? [c] : (c.columns ?? []);
      for (const col of cols) {
        if (!col?.children) continue;
        const i = col.children.findIndex((w) => w?.id === srcId);
        if (i >= 0) {
          src = col.children.splice(i, 1)[0];
          break;
        }
      }
      if (src) break;
    }
    if (src) break;
  }
  if (!src) return;
  for (const s of d.sections) {
    if (!s) continue;
    const children = s.children ?? [];
    for (const c of children) {
      if (!c) continue;
      const cols = c.kind === "column" ? [c] : (c.columns ?? []);
      for (const col of cols) {
        if (col?.id === targetColId) {
          if (!col.children) col.children = [];
          col.children.push(src);
          return;
        }
      }
    }
  }
}

export function moveWidgetToSection(d: BuilderDocument, srcId: string, targetSectionId: string): void {
  let src: WidgetNode | null = null;
  for (const s of d.sections) {
    if (!s) continue;
    const children = s.children ?? [];
    for (const c of children) {
      if (!c) continue;
      const cols = c.kind === "column" ? [c] : (c.columns ?? []);
      for (const col of cols) {
        if (!col?.children) continue;
        const i = col.children.findIndex((w) => w?.id === srcId);
        if (i >= 0) {
          src = col.children.splice(i, 1)[0];
          break;
        }
      }
      if (src) break;
    }
    if (src) break;
  }
  if (!src) return;

  const targetSection = d.sections.find((section) => section?.id === targetSectionId);
  if (!targetSection) return;

  let targetColumn: ColumnNode | null = null;
  const tchildren = targetSection.children ?? [];
  for (const child of tchildren) {
    if (!child) continue;
    if (child.kind === "column") { targetColumn = child; break; }
    if (child.kind === "inner-section" && (child.columns ?? [])[0]) { targetColumn = child.columns[0]; break; }
  }

  if (!targetColumn) {
    const newCol = newColumn(12);
    if (!targetSection.children) targetSection.children = [];
    targetSection.children.push(newCol);
    targetColumn = newCol;
  }

  if (!targetColumn.children) targetColumn.children = [];
  targetColumn.children.push(src);
}

/** Toggle a node's per-device visibility flag. */
export function toggleHidden(d: BuilderDocument, id: string, kind: NodeKind, device: Device): void {
  const target =
    kind === "section" ? findSection(d, id) :
    kind === "inner-section" ? findInner(d, id) :
    kind === "column" ? findColumn(d, id) :
    findWidget(d, id)?.widget ?? null;
  if (!target) return;
  target.advanced = target.advanced ?? {};
  target.advanced.hideOn = { ...(target.advanced.hideOn ?? {}), [device]: !target.advanced.hideOn?.[device] };
}
