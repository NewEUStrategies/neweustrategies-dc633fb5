// All builder tree mutations, extracted from Builder.tsx. The pure logic lives
// in @/lib/builder/operations; this hook binds each op to the deep-clone +
// history `update` cycle and owns the side effects that touch React state
// (selection after insert, section-template prompt, focused-column memo).
import { useCallback, useMemo, useRef } from "react";
import { makeWidget } from "@/lib/builder/registry";
import type {
  BuilderDocument, ColumnNode, SectionNode, WidgetNode, WidgetType, Device,
} from "@/lib/builder/types";
import type { History } from "@/lib/builder/useHistory";
import * as ops from "@/lib/builder/operations";
import { safeParseBuilderDoc } from "@/lib/builder/schema";
import { useSectionTemplates, type SectionTemplate } from "@/lib/builder/templates";
import { buildHomepageDocument } from "@/lib/builder/homepageTemplate";
import type { Selection, SelectionKind } from "../organisms/builder/types";

interface Args {
  history: History;
  doc: BuilderDocument;
  selection: Selection;
  setSelection: (s: Selection) => void;
  device: Device;
}

export function useBuilderOperations({ history, doc, selection, setSelection, device }: Args) {
  const templates = useSectionTemplates();

  const docRef = useRef(doc);
  docRef.current = doc;
  const update = useCallback((mut: (d: BuilderDocument) => void) => {
    const next: BuilderDocument = safeParseBuilderDoc(JSON.parse(JSON.stringify(docRef.current)));
    mut(next);
    const normalized = safeParseBuilderDoc(next);
    docRef.current = normalized;
    history.setDoc(normalized);
  }, [history]);

  // ---------- focused column / add widget ----------
  const focusedColumn = useMemo<ColumnNode | null>(() => {
    if (selection.kind === "column" && selection.id) return ops.findColumn(doc, selection.id);
    if (selection.kind === "widget" && selection.id) return ops.findWidget(doc, selection.id)?.column ?? null;
    const normalized = safeParseBuilderDoc(doc);
    for (const s of normalized.sections) for (const c of s.children) {
      if (c.kind === "column") return c;
      if (c.kind === "inner-section" && c.columns[0]) return c.columns[0];
    }
    return null;
  }, [doc, selection]);

  // ---------- structural ops ----------
  const addSection = (colsOrSpans: number | number[]) => update((d) => ops.addSection(d, colsOrSpans));
  const loadHomepage = useCallback(() => { history.setDoc(buildHomepageDocument()); }, [history]);
  const insertTemplateSection = (tpl: SectionTemplate) => update((d) => ops.insertSectionNode(d, ops.cloneSection(tpl.data)));
  const saveSectionAsTemplate = (sid: string) => {
    const s = ops.findSection(doc, sid);
    if (!s) return;
    const name = window.prompt("Nazwa szablonu sekcji:");
    if (!name) return;
    void templates.save(name.trim(), s);
  };
  const removeSection = (id: string) => update((d) => ops.removeSection(d, id));
  const moveSection = (id: string, dir: -1 | 1) => update((d) => ops.moveSection(d, id, dir));
  const duplicateSection = (id: string) => update((d) => ops.duplicateSection(d, id));
  const insertSectionAt = (index: number, colsOrSpans: number | number[]) =>
    update((d) => ops.insertSectionAt(d, index, colsOrSpans));
  const addInnerSection = (sectionId: string) => update((d) => ops.addInnerSection(d, sectionId));
  const addColumn = (sectionId: string) => update((d) => ops.addColumn(d, sectionId));
  const removeColumn = (colId: string) => update((d) => ops.removeColumn(d, colId));
  const duplicateColumn = (colId: string) => update((d) => ops.duplicateColumn(d, colId));
  const removeWidget = (wid: string) => update((d) => ops.removeWidget(d, wid));
  const duplicateWidget = (wid: string) => update((d) => ops.duplicateWidget(d, wid));
  const updateWidget = (wid: string, mut: (w: WidgetNode) => void) => update((d) => {
    const f = ops.findWidget(d, wid);
    if (f) mut(f.widget);
  });
  const updateSection = (sid: string, mut: (s: SectionNode) => void) => update((d) => {
    const s = ops.findSection(d, sid);
    if (s) mut(s);
  });
  const updateColumn = (cid: string, mut: (c: ColumnNode) => void) => update((d) => {
    const c = ops.findColumn(d, cid);
    if (c) mut(c);
  });

  const addWidgetToFocused = (type: WidgetType) => {
    const w = makeWidget(type);
    if (!focusedColumn) update((d) => ops.addWidgetToNewSection(d, w));
    else update((d) => ops.addWidgetToColumn(d, focusedColumn.id, w));
    setSelection({ kind: "widget", id: w.id });
  };
  const addWidgetToColumn = (colId: string, type: WidgetType) => {
    const w = makeWidget(type);
    update((d) => ops.addWidgetToColumn(d, colId, w));
    setSelection({ kind: "widget", id: w.id });
  };
  const insertWidgetNear = (targetWidgetId: string, pos: "before" | "after", type: WidgetType) => {
    const w = makeWidget(type);
    update((d) => ops.insertWidgetNear(d, targetWidgetId, pos, w));
    setSelection({ kind: "widget", id: w.id });
  };
  const appendWidgetToSection = (sectionId: string, type: WidgetType) => {
    const w = makeWidget(type);
    update((d) => ops.appendWidgetToSection(d, sectionId, w));
    setSelection({ kind: "widget", id: w.id });
  };

  const moveWidgetTo = (srcId: string, targetId: string, pos: "before" | "after") =>
    update((d) => ops.moveWidgetTo(d, srcId, targetId, pos));
  const moveWidgetToColumn = (srcId: string, targetColId: string) =>
    update((d) => ops.moveWidgetToColumn(d, srcId, targetColId));
  const moveWidgetToSection = (srcId: string, targetSectionId: string) =>
    update((d) => ops.moveWidgetToSection(d, srcId, targetSectionId));
  const moveSectionTo = (srcId: string, targetId: string, pos: "before" | "after") =>
    update((d) => ops.moveSectionTo(d, srcId, targetId, pos));

  const toggleHidden = (id: string, kind: NonNullable<SelectionKind>) =>
    update((d) => ops.toggleHidden(d, id, kind, device));

  return {
    update, focusedColumn,
    addSection, loadHomepage, insertTemplateSection, saveSectionAsTemplate,
    removeSection, moveSection, duplicateSection, insertSectionAt,
    addInnerSection, addColumn, removeColumn, duplicateColumn,
    removeWidget, duplicateWidget, updateWidget, updateSection, updateColumn,
    addWidgetToFocused, addWidgetToColumn, insertWidgetNear, appendWidgetToSection,
    moveWidgetTo, moveWidgetToColumn, moveWidgetToSection, moveSectionTo,
    toggleHidden,
  };
}
