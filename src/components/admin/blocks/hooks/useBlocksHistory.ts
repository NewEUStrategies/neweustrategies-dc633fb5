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

export function useBlocksHistory(initial: BlocksDoc, opts: Options = {}): BlocksHistory {
  const { debounceMs = 400, limit = 100 } = opts;
  const [doc, setDocState] = useState<BlocksDoc>(initial);
  const pastRef = useRef<BlocksDoc[]>([]);
  const futureRef = useRef<BlocksDoc[]>([]);
  const lastCommitRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [version, setVersion] = useState(0);

  const commit = useCallback((prev: BlocksDoc) => {
    pastRef.current.push(prev);
    if (pastRef.current.length > limit) pastRef.current.shift();
    futureRef.current = [];
    lastCommitRef.current = Date.now();
    setVersion((v) => v + 1);
  }, [limit]);

  const setDoc = useCallback((next: BlocksDoc, immediate = false) => {
    setDocState((prev) => {
      if (prev === next) return prev;
      const now = Date.now();
      const elapsed = now - lastCommitRef.current;
      if (immediate || elapsed > debounceMs) {
        commit(prev);
      } else {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => commit(prev), debounceMs);
      }
      return next;
    });
  }, [commit, debounceMs]);

  const undo = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const prev = pastRef.current.pop();
    if (!prev) return;
    setDocState((current) => {
      futureRef.current.push(current);
      return prev;
    });
    setVersion((v) => v + 1);
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    setDocState((current) => {
      pastRef.current.push(current);
      return next;
    });
    setVersion((v) => v + 1);
  }, []);

  const reset = useCallback((next: BlocksDoc) => {
    pastRef.current = [];
    futureRef.current = [];
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setDocState(next);
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return {
    doc,
    setDoc,
    reset,
    undo,
    redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    // version forces re-render on undo/redo - intentionally referenced
    ...({ _v: version } as unknown as Record<string, never>),
  };
}
