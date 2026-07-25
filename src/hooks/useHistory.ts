// Generic undo/redo history hook - single home for the two previous
// duplicates (`useHistory` under lib/builder and `useUndoRedo` under hooks).
// Keeps up to MAX_HISTORY snapshots and exposes a uniform API:
//   { state, set, undo, redo, canUndo, canRedo, reset, clear }
//
// - `set(next, opts?)`:
//   * `label` names the operation being recorded (e.g. "Przeniesiono
//     widget"); it flows through `lastLabel`/`nextLabel` so callers can toast
//     "Cofnięto: X" / "Ponowiono: X".
//   * `coalesceKey` folds a *run* of edits sharing the same key into ONE
//     history entry (e.g. successive keystrokes on the same field). A new
//     key - or no key - starts a fresh entry.
// - `reset(next)` replaces the state and wipes past/future (e.g. loading a
//   different document/record).
// - `clear()` wipes past/future but keeps the current state (e.g. "forget
//   history" without changing what's on screen).
//
// Labels: past stack entries carry the label of the OPERATION they
// represent, i.e. the op the user would revert by pressing Ctrl+Z from that
// state. Future stack entries mirror this for redo.
//
// `onChange` (optional) mirrors every committed state - past, undo and redo -
// to a side effect (e.g. the parent's autosave), matching the original
// builder hook's behavior.
//
// `syncExternal` (optional) re-synchronizes the internal state whenever the
// `initial` argument changes to a value not `isEqual` to the last seen one,
// without recording a history entry. This is only needed by consumers whose
// `initial` is itself a controlled prop that can change out from under the
// hook (e.g. an autosave refresh); consumers who own a stable initial value
// and call `reset()` explicitly should leave this off (the default).
import { useCallback, useEffect, useRef, useState } from "react";

const MAX_HISTORY = 200;

export interface HistoryEntry<T> {
  value: T;
  label?: string;
}

export interface SetOptions {
  label?: string;
  coalesceKey?: string;
}

export interface History<T> {
  state: T;
  set: (next: T | ((prev: T) => T), opts?: SetOptions) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reset: (next: T) => void;
  clear: () => void;
  /** Label of the top past entry (the operation an undo would revert). */
  lastLabel: string | null;
  /** Label of the top future entry (the operation a redo would re-apply). */
  nextLabel: string | null;
}

export interface UseHistoryOptions<T> {
  onChange?: (next: T) => void;
  isEqual?: (a: T, b: T) => boolean;
  syncExternal?: boolean;
}

const defaultIsEqual = <T>(a: T, b: T) => Object.is(a, b);

export function useHistory<T>(initial: T, options?: UseHistoryOptions<T>): History<T> {
  const onChange = options?.onChange;
  const isEqual = options?.isEqual ?? defaultIsEqual;
  const syncExternal = options?.syncExternal ?? false;

  const [past, setPast] = useState<HistoryEntry<T>[]>([]);
  const [present, setPresent] = useState<T>(initial);
  const [future, setFuture] = useState<HistoryEntry<T>[]>([]);
  const lastExternal = useRef<T>(initial);
  const coalesceKeyRef = useRef<string | null>(null);

  // External value change (e.g. autosave refresh) - reset present without
  // recording a history entry. Opt-in via `syncExternal`.
  useEffect(() => {
    if (!syncExternal) return;
    if (!isEqual(initial, lastExternal.current)) {
      lastExternal.current = initial;
      setPresent(initial);
      coalesceKeyRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, syncExternal]);

  const set = useCallback(
    (next: T | ((prev: T) => T), opts?: SetOptions) => {
      setPresent((prevPresent) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prevPresent) : next;
        const key = opts?.coalesceKey ?? null;
        const label = opts?.label;
        const coalesced = key !== null && coalesceKeyRef.current === key;

        setPast((p) => {
          if (coalesced && p.length > 0) {
            // Update the existing top entry's label if a newer one was
            // provided, but keep the snapshot untouched so undo returns to
            // the pre-run state.
            if (label) {
              const copy = p.slice();
              copy[copy.length - 1] = { ...copy[copy.length - 1], label };
              return copy;
            }
            return p;
          }
          const entry: HistoryEntry<T> = { value: prevPresent, label };
          const np = [...p, entry];
          return np.length > MAX_HISTORY ? np.slice(np.length - MAX_HISTORY) : np;
        });
        coalesceKeyRef.current = key;
        setFuture([]);
        lastExternal.current = resolved;
        onChange?.(resolved);
        return resolved;
      });
    },
    [onChange],
  );

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setPresent((currentPresent) => {
        setFuture((f) => [{ value: currentPresent, label: prev.label }, ...f]);
        lastExternal.current = prev.value;
        coalesceKeyRef.current = null;
        onChange?.(prev.value);
        return prev.value;
      });
      return p.slice(0, -1);
    });
  }, [onChange]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setPresent((currentPresent) => {
        setPast((p) => {
          const np = [...p, { value: currentPresent, label: next.label }];
          return np.length > MAX_HISTORY ? np.slice(np.length - MAX_HISTORY) : np;
        });
        lastExternal.current = next.value;
        coalesceKeyRef.current = null;
        onChange?.(next.value);
        return next.value;
      });
      return f.slice(1);
    });
  }, [onChange]);

  const reset = useCallback((next: T) => {
    coalesceKeyRef.current = null;
    lastExternal.current = next;
    setPast([]);
    setFuture([]);
    setPresent(next);
  }, []);

  const clear = useCallback(() => {
    coalesceKeyRef.current = null;
    setPast([]);
    setFuture([]);
  }, []);

  return {
    state: present,
    set,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    reset,
    clear,
    lastLabel: past.length > 0 ? (past[past.length - 1].label ?? null) : null,
    nextLabel: future.length > 0 ? (future[0].label ?? null) : null,
  };
}
