// Undo/redo history for BlocksDoc with debounced commits.
// Atomic, type-safe (no `any`), tenant-agnostic - operates on in-memory doc only.

import { useCallback, useEffect, useRef, useState } from "react";
import type { BlocksDoc } from "@/lib/blocks/types";

interface Options {
  /** Minimal interval (ms) between two snapshot commits for the same logical change. */
  debounceMs?: number;
  /** Maximum number of snapshots retained on the stack. */
  limit?: number;
}

export interface BlocksHistory {
  doc: BlocksDoc;
  setDoc: (next: BlocksDoc, immediate?: boolean) => void;
  reset: (next: BlocksDoc) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

interface InternalState {
  doc: BlocksDoc;
  past: BlocksDoc[];
  future: BlocksDoc[];
}

export function useBlocksHistory(initial: BlocksDoc, opts: Options = {}): BlocksHistory {
  const { debounceMs = 400, limit = 100 } = opts;
  const [state, setState] = useState<InternalState>({ doc: initial, past: [], future: [] });
  const lastCommitRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const setDoc = useCallback((next: BlocksDoc, immediate = false) => {
    setState((prev) => {
      if (prev.doc === next) return prev;
      const now = Date.now();
      const elapsed = now - lastCommitRef.current;
      const shouldCommit = immediate || elapsed > debounceMs;
      if (shouldCommit) {
        const past = [...prev.past, prev.doc];
        if (past.length > limit) past.shift();
        lastCommitRef.current = now;
        return { doc: next, past, future: [] };
      }
      // Debounce: schedule a delayed commit if not pending.
      if (!timerRef.current) {
        const snapshot = prev.doc;
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          lastCommitRef.current = Date.now();
          setState((s) => {
            const past = [...s.past, snapshot];
            if (past.length > limit) past.shift();
            return { ...s, past, future: [] };
          });
        }, debounceMs);
      }
      return { ...prev, doc: next };
    });
  }, [debounceMs, limit]);

  const undo = useCallback(() => {
    flushPending();
    setState((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return { doc: prev, past: s.past.slice(0, -1), future: [...s.future, s.doc] };
    });
  }, [flushPending]);

  const redo = useCallback(() => {
    flushPending();
    setState((s) => {
      const next = s.future[s.future.length - 1];
      if (!next) return s;
      return { doc: next, past: [...s.past, s.doc], future: s.future.slice(0, -1) };
    });
  }, [flushPending]);

  const reset = useCallback((next: BlocksDoc) => {
    flushPending();
    lastCommitRef.current = 0;
    setState({ doc: next, past: [], future: [] });
  }, [flushPending]);

  useEffect(() => () => flushPending(), [flushPending]);

  return {
    doc: state.doc,
    setDoc,
    reset,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
