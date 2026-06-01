import { useEffect } from "react";
import type { Selection } from "../organisms/builder";

interface Params {
  selection: Selection;
  setSelection: (s: Selection) => void;
  undo: () => void;
  redo: () => void;
  copySelection: () => void;
  pasteFromClipboard: () => void;
  duplicateSection: (id: string) => void;
  duplicateColumn: (id: string) => void;
  duplicateWidget: (id: string) => void;
  removeSection: (id: string) => void;
  removeColumn: (id: string) => void;
  removeWidget: (id: string) => void;
}

export function useBuilderShortcuts(p: Params) {
  const {
    selection, setSelection, undo, redo, copySelection, pasteFromClipboard,
    duplicateSection, duplicateColumn, duplicateWidget,
    removeSection, removeColumn, removeWidget,
  } = p;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === "c") { copySelection(); }
      else if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); pasteFromClipboard(); }
      else if (mod && e.key.toLowerCase() === "d" && selection.id) {
        e.preventDefault();
        if (selection.kind === "section") duplicateSection(selection.id);
        else if (selection.kind === "column") duplicateColumn(selection.id);
        else if (selection.kind === "widget") duplicateWidget(selection.id);
      }
      else if (e.key === "Delete" && selection.id) {
        if (selection.kind === "section") removeSection(selection.id);
        else if (selection.kind === "column") removeColumn(selection.id);
        else if (selection.kind === "widget") removeWidget(selection.id);
      } else if (e.key === "Escape") setSelection({ kind: null, id: null });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, copySelection, pasteFromClipboard, selection, setSelection,
      duplicateSection, duplicateColumn, duplicateWidget,
      removeSection, removeColumn, removeWidget]);
}
