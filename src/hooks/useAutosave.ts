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
//
// `resetKey` names WHOSE value is being autosaved (e.g. the post id). When it
// changes, the current value becomes the new clean baseline: nothing is saved,
// a pending timer is dropped and a save still in flight for the previous key
// can no longer mark itself as `lastSaved`. Without it an editor that switched
// to another record without remounting kept the previous record's snapshot -
// "discard" restored record A into record B.
import { useCallback, useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface UseAutosaveOpts<T> {
  value: T;
  save: (value: T) => Promise<void>;
  delayMs?: number;
  enabled?: boolean;
  equals?: (a: T, b: T) => boolean;
  /**
   * Identity of the record behind `value`. A change re-baselines autosave on
   * the value of the same render (no save, clean state). Compared with
   * `Object.is`; leave undefined for a single-record consumer.
   */
  resetKey?: unknown;
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
  resetKey,
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
  // Key the current baseline belongs to, and a generation bumped on every
  // re-baseline: a save started for an older generation never touches the
  // state of the new one (no `lastSaved`, no status, no follow-up saves).
  const baselineKeyRef = useRef<unknown>(resetKey);
  const resetKeyRef = useRef<unknown>(resetKey);
  resetKeyRef.current = resetKey;
  const generationRef = useRef(0);

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
    const generation = generationRef.current;
    // Also stale once a render carries a key that is not baselined yet: its
    // value belongs to the next record and is about to become the baseline.
    const current = () =>
      generationRef.current === generation &&
      Object.is(resetKeyRef.current, baselineKeyRef.current);
    // `run` is read in `finally`, which executes SYNCHRONOUSLY when there is
    // nothing to save - hence `let` + `done` instead of a TDZ `const`, and no
    // registration of an already settled chain (it would answer every later
    // drain() without saving anything).
    let run: Promise<void> | undefined;
    let done = false;
    run = (async () => {
      try {
        while (current() && !equalsRef.current(valueRef.current, lastSavedRef.current)) {
          const snapshot = valueRef.current;
          setStatus("saving");
          await saveRef.current(snapshot);
          // Re-baselined meanwhile: this snapshot belongs to the previous
          // record and must not become the new record's `lastSaved`.
          if (!current()) return;
          markSaved(snapshot);
        }
        if (!current()) return;
        setError(null);
        setStatus("saved");
      } catch (e) {
        if (current()) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("error");
        }
        throw e;
      } finally {
        done = true;
        if (drainingRef.current === run) drainingRef.current = null;
      }
    })();
    if (!done) drainingRef.current = run;
    return run;
  }, [markSaved]);

  useEffect(() => {
    if (!enabled) return;
    if (firstRunRef.current || !Object.is(resetKey, baselineKeyRef.current)) {
      const rebase = !firstRunRef.current;
      firstRunRef.current = false;
      baselineKeyRef.current = resetKey;
      lastSavedRef.current = value;
      setLastSaved(value);
      if (rebase) {
        // New record: drop the previous record's pending save and detach a
        // save still in flight (its chain checks the generation and stops).
        generationRef.current += 1;
        drainingRef.current = null;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        setStatus("idle");
        setError(null);
        setLastSavedAt(null);
      }
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
  }, [value, enabled, delayMs, drain, resetKey]);

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
    const generation = generationRef.current;
    while (
      generationRef.current === generation &&
      Object.is(resetKeyRef.current, baselineKeyRef.current) &&
      !equalsRef.current(valueRef.current, lastSavedRef.current)
    ) {
      await drain();
    }
  }, [drain]);

  // A render whose key has not been baselined yet is clean by definition - the
  // effect above is about to make its value the baseline.
  const isDirty =
    enabled && Object.is(resetKey, baselineKeyRef.current) && !equals(value, lastSavedRef.current);

  return { status, error, flush, lastSavedAt, lastSaved, isDirty };
}
