// useAutosave - calls `save(value)` after `delayMs` of idle time.
// Skips the first run (so initial mount doesn't trigger a save), tracks
// in-flight status, surfaces errors, exposes a manual flush and reports
// `isDirty` so navigation guards (useUnsavedChangesGuard) can block
// tab-close / route-change while changes are not yet persisted.
//
// Saves are SERIALIZED and always converge on the freshest value: a burst of
// edits made while a save is in flight is coalesced and re-saved, so the last
// value the user produced is the one that ends up persisted. Crucially,
// `flush()` REJECTS when the underlying save throws, so a caller can never mark
// the form clean or toast "Saved" for a save that did not actually persist -
// that lie caused silent, total data loss on the page builder, which has no
// other persistence path (no autosave, no revisions).
import { useCallback, useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface UseAutosaveOpts<T> {
  value: T;
  save: (value: T) => Promise<void>;
  delayMs?: number;
  enabled?: boolean;
  equals?: (a: T, b: T) => boolean;
}

export interface UseAutosaveResult<T> {
  status: AutosaveStatus;
  error: string | null;
  /**
   * Persist any pending changes now and resolve once the freshest value is
   * stored. REJECTS if the underlying save throws, so callers MUST treat a
   * rejection as "not saved" - never mark the form clean or toast success on a
   * rejected flush. Safe to call while a debounced save is already running (it
   * awaits that and any edits made in the meantime).
   */
  flush: () => Promise<void>;
  lastSavedAt: number | null;
  /** The last value successfully persisted; a stable target for "discard". */
  lastSaved: T;
  /** True while the current value differs from the last persisted snapshot. */
  isDirty: boolean;
}

export function useAutosave<T>({
  value,
  save,
  delayMs = 1500,
  enabled = true,
  equals = Object.is,
}: UseAutosaveOpts<T>): UseAutosaveResult<T> {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  // Mirror the last-saved value in state so `lastSaved` is a stable target a
  // consumer can reset to (e.g. "discard unsaved changes" without reverting to
  // the stale mount-time row).
  const [lastSaved, setLastSaved] = useState<T>(value);

  const lastSavedRef = useRef<T>(value);
  const valueRef = useRef<T>(value);
  valueRef.current = value;
  // Keep `save`/`equals` in refs so the save machinery has a stable identity and
  // the debounce effect does not restart on every render when the caller passes
  // an inline `save`/`equals` - that pushed the idle timer out by `delayMs` on
  // each re-render and, under a recurring re-render source, could starve
  // autosave entirely.
  const saveRef = useRef(save);
  saveRef.current = save;
  const equalsRef = useRef(equals);
  equalsRef.current = equals;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRunRef = useRef(true);
  const drainingRef = useRef<Promise<void> | null>(null);

  const markSaved = useCallback((snapshot: T) => {
    lastSavedRef.current = snapshot;
    setLastSaved(snapshot);
    setLastSavedAt(Date.now());
  }, []);

  // Persist the freshest value, coalescing concurrent callers into one running
  // chain. Keeps saving until valueRef === lastSavedRef so edits made while a
  // save was in flight are not lost. Rejects (and sets status "error") when a
  // save throws, so flush() can propagate the failure to its caller.
  const drain = useCallback((): Promise<void> => {
    if (drainingRef.current) return drainingRef.current;
    const run = (async () => {
      try {
        while (!equalsRef.current(valueRef.current, lastSavedRef.current)) {
          const snapshot = valueRef.current;
          setStatus("saving");
          await saveRef.current(snapshot);
          markSaved(snapshot);
        }
        setError(null);
        setStatus("saved");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
        throw e;
      } finally {
        drainingRef.current = null;
      }
    })();
    drainingRef.current = run;
    return run;
  }, [markSaved]);

  useEffect(() => {
    if (!enabled) return;
    if (firstRunRef.current) {
      firstRunRef.current = false;
      lastSavedRef.current = value;
      setLastSaved(value);
      return;
    }
    if (equalsRef.current(value, lastSavedRef.current)) return;
    // Debounced AUTO-save: mark dirty immediately, then persist after the editor
    // goes idle for `delayMs`. The timer restarts on every change, so one save
    // covers a whole burst of typing. `drain` reads valueRef (the freshest
    // value), never this closure's snapshot.
    setStatus("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void drain().catch(() => {
        // Failure is surfaced via status/error; the value stays dirty so the
        // navigation guard keeps protecting it and the next edit retries.
      });
    }, delayMs);
  }, [value, enabled, delayMs, drain]);

  // Clear any pending timer on unmount - the unsaved-changes guard (not a
  // fire-and-forget async save) is responsible for the closing-tab case.
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Drain to completion, then re-check: a value that arrived while the last
    // drain was finishing must still be saved before flush resolves. Each drain
    // persists the latest snapshot, so this converges as soon as edits stop; a
    // failing save throws out of `drain`, rejecting flush.
    while (!equalsRef.current(valueRef.current, lastSavedRef.current)) {
      await drain();
    }
  }, [drain]);

  const isDirty = enabled && !equals(value, lastSavedRef.current);

  return { status, error, flush, lastSavedAt, lastSaved, isDirty };
}
