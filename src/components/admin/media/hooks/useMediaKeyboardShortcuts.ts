/**
 * Global keyboard shortcuts for the media manager, matching Finder / iOS Files:
 *   Ctrl/Cmd + A         select all in the current folder
 *   Ctrl/Cmd + C / X / V  copy / cut / paste
 *   Ctrl/Cmd + Z          undo   (+ Shift or Ctrl/Cmd + Y to redo)
 *   Delete / Backspace    delete selection (opens confirm)
 *   F2                    rename the single selected file
 *   Escape                dismiss context menu + clear selection
 *
 * A single window listener is registered once; the latest handlers are read
 * from a ref so the listener never goes stale and never churns.
 */
import { useEffect, useRef } from "react";

export interface MediaKeyboardHandlers {
  hasSelection: boolean;
  /** The id of the sole selected file, or null when 0 or 2+ are selected. */
  singleSelectionId: string | null;
  canPaste: boolean;
  selectAll: () => void;
  copySelection: () => void;
  cutSelection: () => void;
  paste: () => void;
  undo: () => void;
  redo: () => void;
  requestDeleteSelection: () => void;
  beginRename: (id: string) => void;
  closeContextMenu: () => void;
  clearSelection: () => void;
}

export function useMediaKeyboardShortcuts(handlers: MediaKeyboardHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const h = ref.current;
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (meta && key === "a") {
        e.preventDefault();
        h.selectAll();
        return;
      }
      if (meta && key === "c" && h.hasSelection) {
        e.preventDefault();
        h.copySelection();
        return;
      }
      if (meta && key === "x" && h.hasSelection) {
        e.preventDefault();
        h.cutSelection();
        return;
      }
      if (meta && key === "v" && h.canPaste) {
        e.preventDefault();
        h.paste();
        return;
      }
      if (meta && e.shiftKey && key === "z") {
        e.preventDefault();
        h.redo();
        return;
      }
      if (meta && key === "z") {
        e.preventDefault();
        h.undo();
        return;
      }
      if (meta && key === "y") {
        e.preventDefault();
        h.redo();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && h.hasSelection) {
        e.preventDefault();
        h.requestDeleteSelection();
        return;
      }
      if (e.key === "F2" && h.singleSelectionId) {
        e.preventDefault();
        h.beginRename(h.singleSelectionId);
        return;
      }
      if (e.key === "Escape") {
        h.closeContextMenu();
        h.clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
