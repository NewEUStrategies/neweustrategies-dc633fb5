import { useCallback } from "react";
import type {
  BuilderDocument, SectionNode, ColumnNode, InnerSectionNode, WidgetNode,
} from "@/lib/builder/types";
import { newId } from "@/lib/builder/types";
import {
  cloneSection, cloneColumn, cloneInner, cloneWidget,
  findWidget, findSection, findColumn, findInner,
} from "@/lib/builder/operations";
import { copyToClipboard, readClipboard, type ClipEnvelope } from "@/lib/builder/clipboard";
import type { Selection } from "../organisms/builder";

interface Params {
  doc: BuilderDocument;
  selection: Selection;
  focusedColumn: ColumnNode | null;
  update: (mut: (d: BuilderDocument) => void) => void;
}

export function useBuilderClipboard({ doc, selection, focusedColumn, update }: Params) {
  const copySelection = useCallback(() => {
    if (!selection.id || !selection.kind) return;
    const map = {
      section: () => findSection(doc, selection.id!),
      "inner-section": () => findInner(doc, selection.id!),
      column: () => findColumn(doc, selection.id!),
      widget: () => findWidget(doc, selection.id!)?.widget ?? null,
    } as const;
    const node = map[selection.kind]?.();
    if (node) copyToClipboard({ kind: selection.kind, node } as ClipEnvelope);
  }, [selection, doc]);

  const pasteFromClipboard = useCallback(() => {
    const env = readClipboard();
    if (!env) return;
    update((d) => {
      if (env.kind === "section") {
        const cloned = cloneSection(env.node as SectionNode);
        const i = selection.kind === "section" && selection.id
          ? d.sections.findIndex((s) => s.id === selection.id) : -1;
        if (i >= 0) d.sections.splice(i + 1, 0, cloned); else d.sections.push(cloned);
      } else if (env.kind === "widget") {
        const cloned = cloneWidget(env.node as WidgetNode);
        const colId = focusedColumn?.id;
        if (!colId) return;
        const col = findColumn(d, colId);
        if (col) col.children.push(cloned);
      } else if (env.kind === "column") {
        const cloned = cloneColumn(env.node as ColumnNode);
        if (selection.kind === "section" && selection.id) {
          const s = d.sections.find((x) => x.id === selection.id);
          if (s) s.children.push(cloned);
        } else { d.sections.push({ id: newId(), kind: "section", children: [cloned] }); }
      } else if (env.kind === "inner-section") {
        const cloned = cloneInner(env.node as InnerSectionNode);
        if (selection.kind === "section" && selection.id) {
          const s = d.sections.find((x) => x.id === selection.id);
          if (s) s.children.push(cloned);
        }
      }
    });
  }, [selection, focusedColumn, update]);

  return { copySelection, pasteFromClipboard };
}
