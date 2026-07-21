/**
 * Multi-select state for the media grid/list.
 *
 * Mirrors Finder / iOS Files semantics:
 *   - plain click        -> select only that item
 *   - Cmd/Ctrl + click    -> toggle that item in/out of the set
 *   - Shift + click       -> extend the range from the last anchor
 *
 * `orderedFiles` is the current folder's files in display order; it defines
 * what "range" and "select all" mean and is the only external dependency.
 */
import { useCallback, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { MediaRow } from "../types";

export interface UseMediaSelectionResult {
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  lastAnchorId: string | null;
  setLastAnchorId: (id: string | null) => void;
  clearSelection: () => void;
  toggleSelect: (id: string, ev?: ReactMouseEvent) => void;
  selectAll: () => void;
  selectOnly: (id: string) => void;
}

export function useMediaSelection(orderedFiles: readonly MediaRow[]): UseMediaSelectionResult {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastAnchorId, setLastAnchorId] = useState<string | null>(null);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastAnchorId(null);
  }, []);

  const selectOnly = useCallback((id: string) => {
    setSelectedIds(new Set([id]));
    setLastAnchorId(id);
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(orderedFiles.map((f) => f.id)));
  }, [orderedFiles]);

  const toggleSelect = useCallback(
    (id: string, ev?: ReactMouseEvent) => {
      const meta = ev?.metaKey || ev?.ctrlKey;
      const shift = ev?.shiftKey;

      if (shift && lastAnchorId) {
        const ids = orderedFiles.map((f) => f.id);
        const a = ids.indexOf(lastAnchorId);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const range = new Set(selectedIds);
          for (let i = lo; i <= hi; i++) {
            const rangeId = ids[i];
            if (rangeId) range.add(rangeId);
          }
          setSelectedIds(range);
          return;
        }
      }

      if (meta) {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
        setLastAnchorId(id);
        return;
      }

      setSelectedIds(new Set([id]));
      setLastAnchorId(id);
    },
    [orderedFiles, selectedIds, lastAnchorId],
  );

  return {
    selectedIds,
    setSelectedIds,
    lastAnchorId,
    setLastAnchorId,
    clearSelection,
    toggleSelect,
    selectAll,
    selectOnly,
  };
}
