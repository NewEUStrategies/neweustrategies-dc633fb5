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
  set: (next: T | ((prev: T) => T), opts?: { coalesceKey?: string }) => void;
  reset: (next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * useUndoRedo - tracks a single value with linear history.
 * Pass `{ coalesceKey }` to merge a *run* of changes sharing the same key into
 * one history entry (e.g. successive keystrokes in one field). A different key
 * - or no key - starts a new entry, so each field is its own undo step. (The
 * previous boolean `coalesce` latched on after the first edit and folded the
 * entire session into a single step.)
 */
export function useUndoRedo<T>(initial: T): UndoRedo<T> {
  const [s, setS] = useState<HistoryState<T>>({ past: [], present: initial, future: [] });
  const coalesceKeyRef = useRef<string | null>(null);

  const set = useCallback((next: T | ((prev: T) => T), opts?: { coalesceKey?: string }) => {
    setS((prev) => {
      const resolved = typeof next === "function" ? (next as (p: T) => T)(prev.present) : next;
      if (Object.is(resolved, prev.present)) return prev;
      const key = opts?.coalesceKey ?? null;
      if (key !== null && coalesceKeyRef.current === key) {
        return { past: prev.past, present: resolved, future: [] };
      }
      coalesceKeyRef.current = key;
      const past = [...prev.past, prev.present].slice(-MAX_HISTORY);
      return { past, present: resolved, future: [] };
    });
  }, []);

  const reset = useCallback((next: T) => {
    coalesceKeyRef.current = null;
    setS({ past: [], present: next, future: [] });
  }, []);

  const undo = useCallback(() => {
    coalesceKeyRef.current = null;
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
    coalesceKeyRef.current = null;
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
    state: s.present,
    set,
    reset,
    undo,
    redo,
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
  };
}
