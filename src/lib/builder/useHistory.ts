// Undo/redo wrapper around a document state. Keeps last N snapshots and
// exposes commit/undo/redo. Pair with autosave on the rendered document.
import { useCallback, useEffect, useRef, useState } from "react";
import type { BuilderDocument } from "./types";

const MAX_HISTORY = 50;

export interface History {
  doc: BuilderDocument;
  setDoc: (next: BuilderDocument) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const eq = (a: BuilderDocument, b: BuilderDocument) =>
  JSON.stringify(a) === JSON.stringify(b);

export function useHistory(
  initial: BuilderDocument,
  onChange: (d: BuilderDocument) => void,
): History {
  const [past, setPast] = useState<BuilderDocument[]>([]);
  const [present, setPresent] = useState<BuilderDocument>(initial);
  const [future, setFuture] = useState<BuilderDocument[]>([]);
  const lastExternal = useRef<BuilderDocument>(initial);

  // External value change (e.g. autosave refresh) → reset present without recording.
  useEffect(() => {
    if (!eq(initial, lastExternal.current)) {
      lastExternal.current = initial;
      setPresent(initial);
    }
  }, [initial]);

  const setDoc = useCallback((next: BuilderDocument) => {
    setPast((p) => {
      const np = [...p, present];
      return np.length > MAX_HISTORY ? np.slice(np.length - MAX_HISTORY) : np;
    });
    setFuture([]);
    setPresent(next);
    lastExternal.current = next;
    onChange(next);
  }, [present, onChange]);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [present, ...f]);
      setPresent(prev);
      lastExternal.current = prev;
      onChange(prev);
      return p.slice(0, -1);
    });
  }, [present, onChange]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setPast((p) => [...p, present]);
      setPresent(next);
      lastExternal.current = next;
      onChange(next);
      return f.slice(1);
    });
  }, [present, onChange]);

  return { doc: present, setDoc, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}
