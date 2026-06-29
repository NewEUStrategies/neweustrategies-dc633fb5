import { useEffect } from "react";
import type { Selection } from "../organisms/builder";

interface Params {
  selection: Selection;
  setSelection: (s: Selection) => void;
  undo: () => void;
  redo: () => void;
  copySelection: () => void;
  cutSelection: () => void;
  pasteFromClipboard: () => void;
  duplicateSection: (id: string) => void;
  duplicateColumn: (id: string) => void;
  duplicateWidget: (id: string) => void;
  askRemoveSection: (id: string) => void;
  askRemoveColumn: (id: string) => void;
  askRemoveWidget: (id: string) => void;
  moveSection: (id: string, dir: -1 | 1) => void;
  onSave?: () => void;
  onToggleNavigator?: () => void;
}

export function useBuilderShortcuts(p: Params) {
  const {
    selection, setSelection, undo, redo,
    copySelection, cutSelection, pasteFromClipboard,
    duplicateSection, duplicateColumn, duplicateWidget,
    askRemoveSection, askRemoveColumn, askRemoveWidget,
    moveSection, onSave, onToggleNavigator,
  } = p;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      // Undo/redo/save always work, even inside property inputs.
      if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (mod && (k === "y" || (e.shiftKey && k === "z"))) { e.preventDefault(); redo(); return; }
      if (mod && k === "s" && onSave) { e.preventDefault(); onSave(); return; }

      // Remaining shortcuts must not hijack normal text editing inside inputs.
      if (isEditable) return;

      if (mod && k === "c") { copySelection(); return; }
      if (mod && k === "x") { e.preventDefault(); cutSelection(); return; }
      if (mod && k === "v") { e.preventDefault(); pasteFromClipboard(); return; }
      if (mod && k === "d" && selection.id) {
        e.preventDefault();
        if (selection.kind === "section") duplicateSection(selection.id);
        else if (selection.kind === "column") duplicateColumn(selection.id);
        else if (selection.kind === "widget") duplicateWidget(selection.id);
        return;
      }
      if (mod && e.shiftKey && k === "n" && onToggleNavigator) {
        e.preventDefault(); onToggleNavigator(); return;
      }
      if (e.altKey && (k === "arrowup" || k === "arrowdown") && selection.kind === "section" && selection.id) {
        e.preventDefault();
        moveSection(selection.id, k === "arrowup" ? -1 : 1);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selection.id) {
        e.preventDefault();
        if (selection.kind === "section") askRemoveSection(selection.id);
        else if (selection.kind === "column") askRemoveColumn(selection.id);
        else if (selection.kind === "widget") askRemoveWidget(selection.id);
        return;
      }
      if (e.key === "Escape") setSelection({ kind: null, id: null });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, copySelection, cutSelection, pasteFromClipboard, selection, setSelection,
      duplicateSection, duplicateColumn, duplicateWidget,
      askRemoveSection, askRemoveColumn, askRemoveWidget,
      moveSection, onSave, onToggleNavigator]);
}
