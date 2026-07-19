// All builder tree mutations, extracted from Builder.tsx. The pure logic lives
// in @/lib/builder/operations; this hook binds each op to the deep-clone +
// history `update` cycle and owns the side effects that touch React state
// (selection after insert, section-template prompt, focused-column memo).
import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";
import { toast } from "sonner";
import { makeWidget } from "@/lib/builder/registry";
import type {
  BuilderDocument,
  ColumnNode,
  SectionNode,
  WidgetNode,
  WidgetType,
  Device,
} from "@/lib/builder/types";
import type { History } from "@/lib/builder/useHistory";
import * as ops from "@/lib/builder/operations";
import { safeParseBuilderDoc } from "@/lib/builder/schema";
import { useSectionTemplates, type SectionTemplate } from "@/lib/builder/templates";
import {
  useGlobalWidgets,
  makeGlobalInstance,
  type GlobalWidget,
} from "@/lib/builder/globalWidgets";
import { useExperimentsAdmin } from "@/lib/builder/experiments";
import { buildHomepageDocument } from "@/lib/builder/homepageTemplate";
import type { GlobalDragPayload } from "../organisms/builder/VisualCanvas";
import type { Selection, SelectionKind } from "../organisms/builder/types";

import { promptDialog } from "@/lib/appDialogs";
interface Args {
  history: History;
  doc: BuilderDocument;
  selection: Selection;
  setSelection: (s: Selection) => void;
  device: Device;
}

export function useBuilderOperations({ history, doc, selection, setSelection, device }: Args) {
  const { t } = useTranslation();
  const templates = useSectionTemplates();
  const globals = useGlobalWidgets();
  const experiments = useExperimentsAdmin();

  const docRef = useRef(doc);
  docRef.current = doc;
  const update = useCallback(
    (mut: (d: BuilderDocument) => void, opts?: { label?: string; coalesceKey?: string }) => {
      const next: BuilderDocument = safeParseBuilderDoc(JSON.parse(JSON.stringify(docRef.current)));
      mut(next);
      const normalized = safeParseBuilderDoc(next);
      docRef.current = normalized;
      history.setDoc(normalized, opts);
    },
    [history],
  );

  // ---------- focused column / add widget ----------
  const focusedColumn = useMemo<ColumnNode | null>(() => {
    if (selection.kind === "column" && selection.id) return ops.findColumn(doc, selection.id);
    if (selection.kind === "widget" && selection.id)
      return ops.findWidget(doc, selection.id)?.column ?? null;
    const normalized = safeParseBuilderDoc(doc);
    for (const s of normalized.sections)
      for (const c of s.children) {
        if (c.kind === "column") return c;
        if (c.kind === "inner-section" && c.columns[0]) return c.columns[0];
      }
    return null;
  }, [doc, selection]);

  // ---------- structural ops ----------
  // Labels feed the undo/redo toast so users see "Cofnięto: Dodano sekcję"
  // instead of a generic "Cofnięto".
  const addSection = (colsOrSpans: number | number[]) =>
    update((d) => ops.addSection(d, colsOrSpans), { label: t("builder.ops.addedSection") });
  const addContainer = (withTabs: boolean) =>
    update((d) => ops.insertSectionNode(d, ops.newContainerSection(withTabs)), {
      label: withTabs ? t("builder.ops.addedTabContainer") : t("builder.ops.addedContainer"),
    });
  const insertContainerAt = (index: number, withTabs: boolean) =>
    update((d) => ops.insertContainerAt(d, index, withTabs), {
      label: withTabs ? t("builder.ops.addedTabContainer") : t("builder.ops.addedContainer"),
    });
  const loadHomepage = useCallback(() => {
    history.setDoc(buildHomepageDocument(), { label: t("builder.ops.loadedHomepage") });
  }, [history, t]);
  const insertTemplateSection = (tpl: SectionTemplate) =>
    update((d) => ops.insertSectionNode(d, ops.cloneSection(tpl.data)), {
      label: t("builder.ops.insertedTemplate"),
    });
  const saveSectionAsTemplate = async (sid: string) => {
    const s = ops.findSection(doc, sid);
    if (!s) return;
    const name = await promptDialog({
      title: t("builder.ops.saveTplTitle"),
      label: t("builder.ops.saveTplLabel"),
      confirmLabel: t("builder.ops.save"),
    });
    if (!name?.trim()) return;
    void templates.save(name.trim(), s);
  };
  const removeSection = (id: string) =>
    update((d) => ops.removeSection(d, id), { label: t("builder.ops.removedSection") });
  const moveSection = (id: string, dir: -1 | 1) =>
    update((d) => ops.moveSection(d, id, dir), { label: t("builder.ops.movedSection") });
  const duplicateSection = (id: string) =>
    update((d) => ops.duplicateSection(d, id), { label: t("builder.ops.duplicatedSection") });
  const insertSectionAt = (index: number, colsOrSpans: number | number[]) =>
    update((d) => ops.insertSectionAt(d, index, colsOrSpans), {
      label: t("builder.ops.insertedSection"),
    });
  const addSectionToTab = (sectionId: string, tabId: string, colsOrSpans: number | number[]) =>
    update((d) => ops.addSectionToTab(d, sectionId, tabId, colsOrSpans), {
      label: t("builder.ops.addedSectionToTab"),
    });
  const addSectionToContainer = (sectionId: string, colsOrSpans: number | number[]) =>
    update((d) => ops.addSectionToContainer(d, sectionId, colsOrSpans), {
      label: t("builder.ops.addedSectionToContainer"),
    });
  const addInnerSection = (sectionId: string) =>
    update((d) => ops.addInnerSection(d, sectionId), { label: t("builder.ops.addedInnerSection") });
  const addColumn = (sectionId: string) =>
    update((d) => ops.addColumn(d, sectionId), { label: t("builder.ops.addedColumn") });
  const removeColumn = (colId: string) =>
    update((d) => ops.removeColumn(d, colId), { label: t("builder.ops.removedColumn") });
  const duplicateColumn = (colId: string) =>
    update((d) => ops.duplicateColumn(d, colId), { label: t("builder.ops.duplicatedColumn") });
  const removeWidget = (wid: string) =>
    update((d) => ops.removeWidget(d, wid), { label: t("builder.ops.removedWidget") });
  const duplicateWidget = (wid: string) =>
    update((d) => ops.duplicateWidget(d, wid), { label: t("builder.ops.duplicatedWidget") });
  // Property edits coalesce per widget/section/column so a run of keystrokes
  // in the same field becomes a single undo step.
  const updateWidget = (wid: string, mut: (w: WidgetNode) => void) =>
    update(
      (d) => {
        const f = ops.findWidget(d, wid);
        if (f) mut(f.widget);
      },
      { label: t("builder.ops.editWidget"), coalesceKey: `w:${wid}` },
    );
  const updateSection = (sid: string, mut: (s: SectionNode) => void) =>
    update(
      (d) => {
        const s = ops.findSection(d, sid);
        if (s) mut(s);
      },
      { label: t("builder.ops.editSection"), coalesceKey: `s:${sid}` },
    );
  const updateColumn = (cid: string, mut: (c: ColumnNode) => void) =>
    update(
      (d) => {
        const c = ops.findColumn(d, cid);
        if (c) mut(c);
      },
      { label: t("builder.ops.editColumn"), coalesceKey: `c:${cid}` },
    );

  // New widget nodes: either a fresh widget of `type`, or an instance of a
  // dragged global widget (snapshot + globalId reference).
  const makeNode = (type: WidgetType, global?: GlobalDragPayload): WidgetNode =>
    global ? makeGlobalInstance(global) : makeWidget(type);

  const addWidgetToFocused = (type: WidgetType) => {
    const w = makeWidget(type);
    if (!focusedColumn)
      update((d) => ops.addWidgetToNewSection(d, w), { label: t("builder.ops.addedWidget") });
    else
      update((d) => ops.addWidgetToColumn(d, focusedColumn.id, w), {
        label: t("builder.ops.addedWidget"),
      });
    setSelection({ kind: "widget", id: w.id });
  };
  const addGlobalWidgetToFocused = (g: Pick<GlobalWidget, "id" | "data">) => {
    const w = makeGlobalInstance(g);
    if (!focusedColumn)
      update((d) => ops.addWidgetToNewSection(d, w), { label: t("builder.ops.addedGlobalWidget") });
    else
      update((d) => ops.addWidgetToColumn(d, focusedColumn.id, w), {
        label: t("builder.ops.addedGlobalWidget"),
      });
    setSelection({ kind: "widget", id: w.id });
  };
  const addWidgetToColumn = (colId: string, type: WidgetType, global?: GlobalDragPayload) => {
    const w = makeNode(type, global);
    update((d) => ops.addWidgetToColumn(d, colId, w), { label: t("builder.ops.addedWidget") });
    setSelection({ kind: "widget", id: w.id });
  };
  const insertWidgetNear = (
    targetWidgetId: string,
    pos: "before" | "after",
    type: WidgetType,
    global?: GlobalDragPayload,
  ) => {
    const w = makeNode(type, global);
    update((d) => ops.insertWidgetNear(d, targetWidgetId, pos, w), {
      label: t("builder.ops.insertedWidget"),
    });
    setSelection({ kind: "widget", id: w.id });
  };
  const appendWidgetToSection = (
    sectionId: string,
    type: WidgetType,
    global?: GlobalDragPayload,
    tabId?: string,
  ) => {
    const w = makeNode(type, global);
    update((d) => ops.appendWidgetToSection(d, sectionId, w, tabId), {
      label: t("builder.ops.addedWidget"),
    });
    setSelection({ kind: "widget", id: w.id });
  };

  // ---------- global widgets ----------
  const saveWidgetAsGlobal = async (wid: string) => {
    const f = ops.findWidget(doc, wid);
    if (!f) return;
    const name = await promptDialog({
      title: t("builder.ops.saveGlobalTitle"),
      label: t("builder.ops.saveGlobalLabel"),
      confirmLabel: t("builder.ops.save"),
    });
    if (!name?.trim()) return;
    const id = await globals.save(name.trim(), f.widget);
    if (!id) {
      toast.error(t("builder.ops.saveGlobalErr"));
      return;
    }
    update((d) => {
      const found = ops.findWidget(d, wid);
      if (found) found.widget.globalId = id;
    });
    toast.success(t("builder.ops.saveGlobalOk"));
  };
  const unlinkGlobalWidget = (wid: string) => {
    update((d) => ops.unlinkGlobalWidget(d, wid));
    toast.info(t("builder.ops.unlinkedGlobal"));
  };

  // ---------- A/B tests ----------
  const startAbTest = async (sectionId: string) => {
    const s = ops.findSection(doc, sectionId);
    if (!s) return;
    const name = await promptDialog({
      title: t("builder.ops.newAbTitle"),
      label: t("builder.ops.newAbLabel"),
      confirmLabel: t("builder.ops.create"),
    });
    if (!name?.trim()) return;
    const experimentId = await experiments.create(name.trim());
    if (!experimentId) {
      toast.error(t("builder.ops.abCreateErr"));
      return;
    }
    update((d) => ops.startAbTest(d, sectionId, experimentId));
    toast.success(t("builder.ops.abCreateOk"));
  };
  const endAbTest = (experimentId: string, keep: "a" | "b" | "both") => {
    update((d) => ops.endAbTest(d, experimentId, keep));
    void experiments.setStatus(experimentId, "completed");
    toast.success(t("builder.ops.abEnded"));
  };

  const moveWidgetTo = (srcId: string, targetId: string, pos: "before" | "after") =>
    update((d) => ops.moveWidgetTo(d, srcId, targetId, pos), {
      label: t("builder.ops.movedWidget"),
    });
  const moveWidgetToColumn = (srcId: string, targetColId: string) =>
    update((d) => ops.moveWidgetToColumn(d, srcId, targetColId), {
      label: t("builder.ops.movedWidgetToColumn"),
    });
  const moveWidgetToSection = (srcId: string, targetSectionId: string) =>
    update((d) => ops.moveWidgetToSection(d, srcId, targetSectionId), {
      label: t("builder.ops.movedWidgetToSection"),
    });
  const moveSectionTo = (srcId: string, targetId: string, pos: "before" | "after") =>
    update((d) => ops.moveSectionTo(d, srcId, targetId, pos), {
      label: t("builder.ops.movedSection"),
    });

  const toggleHidden = (id: string, kind: NonNullable<SelectionKind>) =>
    update((d) => ops.toggleHidden(d, id, kind, device));

  return {
    update,
    focusedColumn,
    addSection,
    addContainer,
    insertContainerAt,
    loadHomepage,
    insertTemplateSection,
    saveSectionAsTemplate,
    removeSection,
    moveSection,
    duplicateSection,
    insertSectionAt,
    addSectionToTab,
    addSectionToContainer,
    addInnerSection,
    addColumn,
    removeColumn,
    duplicateColumn,
    removeWidget,
    duplicateWidget,
    updateWidget,
    updateSection,
    updateColumn,
    addWidgetToFocused,
    addWidgetToColumn,
    insertWidgetNear,
    appendWidgetToSection,
    addGlobalWidgetToFocused,
    saveWidgetAsGlobal,
    unlinkGlobalWidget,
    startAbTest,
    endAbTest,
    moveWidgetTo,
    moveWidgetToColumn,
    moveWidgetToSection,
    moveSectionTo,
    toggleHidden,
  };
}
