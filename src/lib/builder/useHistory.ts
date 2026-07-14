// Undo/redo wrapper around a document state. Keeps last N snapshots and
// exposes commit/undo/redo. Pair with autosave on the rendered document.
//
// - MAX_HISTORY raised to 200.
// - setDoc(next, { label, coalesceKey }):
//   * `label` names the operation being recorded ("Przeniesiono widget");
//     it flows through so undo can toast "Cofnięto: X" and redo "Ponowiono: X".
//   * `coalesceKey` folds a *run* of edits sharing the same key into ONE
//     history entry (e.g. successive keystrokes on the same field). A new
//     key - or no key - starts a fresh entry.
//
// Semantics of labels:
// - Past stack entries carry the label of the OPERATION they represent, i.e.
//   the op the user would revert by pressing Ctrl+Z from that state.
// - Future stack entries mirror this for redo.
import { useCallback, useEffect, useRef, useState } from "react";
import type { BuilderDocument } from "./types";
import { safeParseBuilderDoc } from "./schema";

const MAX_HISTORY = 200;

export interface HistoryEntry {
  doc: BuilderDocument;
  label?: string;
}

export interface SetDocOpts {
  label?: string;
  coalesceKey?: string;
}

export interface History {
  doc: BuilderDocument;
  setDoc: (next: BuilderDocument, opts?: SetDocOpts) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Label of the top past entry (the operation an undo would revert). */
  lastLabel: string | null;
  /** Label of the top future entry (the operation a redo would re-apply). */
  nextLabel: string | null;
}

const eq = (a: BuilderDocument, b: BuilderDocument) => JSON.stringify(a) === JSON.stringify(b);

export function useHistory(
  initial: BuilderDocument,
  onChange: (d: BuilderDocument) => void,
): History {
  const normalizedInitial = safeParseBuilderDoc(initial);
  const [past, setPast] = useState<HistoryEntry[]>([]);
  const [present, setPresent] = useState<BuilderDocument>(normalizedInitial);
  const [future, setFuture] = useState<HistoryEntry[]>([]);
  const lastExternal = useRef<BuilderDocument>(normalizedInitial);
  const coalesceKeyRef = useRef<string | null>(null);

  // External value change (autosave refresh) - reset present without recording.
  useEffect(() => {
    const next = safeParseBuilderDoc(initial);
    if (!eq(next, lastExternal.current)) {
      lastExternal.current = next;
      setPresent(next);
      coalesceKeyRef.current = null;
    }
  }, [initial]);

  const setDoc = useCallback(
    (next: BuilderDocument, opts?: SetDocOpts) => {
      const normalized = safeParseBuilderDoc(next);
      const key = opts?.coalesceKey ?? null;
      const label = opts?.label;
      const coalesced = key !== null && coalesceKeyRef.current === key;

      setPast((p) => {
        if (coalesced && p.length > 0) {
          // Update the existing top entry's label if a newer one was provided,
          // but keep the snapshot untouched so undo returns to the pre-run state.
          if (label) {
            const copy = p.slice();
            copy[copy.length - 1] = { ...copy[copy.length - 1], label };
            return copy;
          }
          return p;
        }
        const entry: HistoryEntry = { doc: present, label };
        const np = [...p, entry];
        return np.length > MAX_HISTORY ? np.slice(np.length - MAX_HISTORY) : np;
      });
      coalesceKeyRef.current = key;
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
      setFuture((f) => [{ doc: present, label: prev.label }, ...f]);
      setPresent(prev.doc);
      lastExternal.current = prev.doc;
      coalesceKeyRef.current = null;
      onChange(prev.doc);
      return p.slice(0, -1);
    });
  }, [present, onChange]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setPast((p) => {
        const np = [...p, { doc: present, label: next.label }];
        return np.length > MAX_HISTORY ? np.slice(np.length - MAX_HISTORY) : np;
      });
      setPresent(next.doc);
      lastExternal.current = next.doc;
      coalesceKeyRef.current = null;
      onChange(next.doc);
      return f.slice(1);
    });
  }, [present, onChange]);

  return {
    doc: present,
    setDoc,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    lastLabel: past.length > 0 ? (past[past.length - 1].label ?? null) : null,
    nextLabel: future.length > 0 ? (future[0].label ?? null) : null,
  };
}
