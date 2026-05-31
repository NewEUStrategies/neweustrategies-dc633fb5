// Undo/redo state container - immutable history stack with cursor.
// Generic over T (the document type); pure data, no `any`.
import { useCallback, useRef, useState } from "react";

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

const MAX_HISTORY = 50;

export interface UndoRedo<T> {
  state: T;
  set: (next: T | ((prev: T) => T), opts?: { coalesce?: boolean }) => void;
  reset: (next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * useUndoRedo - tracks a single value with linear history.
 * Pass `{ coalesce: true }` to merge the change into the current entry
 * instead of pushing a new history step (useful for typing in inputs).
 */
export function useUndoRedo<T>(initial: T): UndoRedo<T> {
  const [s, setS] = useState<HistoryState<T>>({ past: [], present: initial, future: [] });
  const coalesceRef = useRef(false);

  const set = useCallback((next: T | ((prev: T) => T), opts?: { coalesce?: boolean }) => {
    setS((prev) => {
      const resolved = typeof next === "function"
        ? (next as (p: T) => T)(prev.present)
        : next;
      if (Object.is(resolved, prev.present)) return prev;
      if (opts?.coalesce && coalesceRef.current) {
        return { past: prev.past, present: resolved, future: [] };
      }
      coalesceRef.current = true;
      const past = [...prev.past, prev.present].slice(-MAX_HISTORY);
      return { past, present: resolved, future: [] };
    });
  }, []);

  const reset = useCallback((next: T) => {
    coalesceRef.current = false;
    setS({ past: [], present: next, future: [] });
  }, []);

  const undo = useCallback(() => {
    coalesceRef.current = false;
    setS((prev) => {
      if (!prev.past.length) return prev;
      const previous = prev.past[prev.past.length - 1]!;
      return {
        past: prev.past.slice(0, -1),
        present: previous,
        future: [prev.present, ...prev.future].slice(0, MAX_HISTORY),
      };
    });
  }, []);

  const redo = useCallback(() => {
    coalesceRef.current = false;
    setS((prev) => {
      if (!prev.future.length) return prev;
      const next = prev.future[0]!;
      return {
        past: [...prev.past, prev.present].slice(-MAX_HISTORY),
        present: next,
        future: prev.future.slice(1),
      };
    });
  }, []);

  return {
    state: s.present, set, reset, undo, redo,
    canUndo: s.past.length > 0, canRedo: s.future.length > 0,
  };
}
