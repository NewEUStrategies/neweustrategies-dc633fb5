// Undo/redo wrapper around a document state. Keeps last N snapshots and
// exposes commit/undo/redo. Pair with autosave on the rendered document.
import { useCallback, useEffect, useRef, useState } from "react";
import type { BuilderDocument } from "./types";
import { safeParseBuilderDoc } from "./schema";

const MAX_HISTORY = 50;

export interface History {
  doc: BuilderDocument;
  setDoc: (next: BuilderDocument) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const eq = (a: BuilderDocument, b: BuilderDocument) => JSON.stringify(a) === JSON.stringify(b);

export function useHistory(
  initial: BuilderDocument,
  onChange: (d: BuilderDocument) => void,
): History {
  const normalizedInitial = safeParseBuilderDoc(initial);
  const [past, setPast] = useState<BuilderDocument[]>([]);
  const [present, setPresent] = useState<BuilderDocument>(normalizedInitial);
  const [future, setFuture] = useState<BuilderDocument[]>([]);
  const lastExternal = useRef<BuilderDocument>(normalizedInitial);

  // External value change (e.g. autosave refresh) → reset present without recording.
  useEffect(() => {
    const next = safeParseBuilderDoc(initial);
    if (!eq(next, lastExternal.current)) {
      lastExternal.current = next;
      setPresent(next);
    }
  }, [initial]);

  const setDoc = useCallback(
    (next: BuilderDocument) => {
      const normalized = safeParseBuilderDoc(next);
      setPast((p) => {
        const np = [...p, present];
        return np.length > MAX_HISTORY ? np.slice(np.length - MAX_HISTORY) : np;
      });
      setFuture([]);
      setPresent(normalized);
      lastExternal.current = normalized;
      onChange(normalized);
    },
    [present, onChange],
  );

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
