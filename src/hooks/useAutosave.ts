// useAutosave - calls `save(value)` after `delayMs` of idle time.
// Skips the first run (so initial mount doesn't trigger a save), tracks
// in-flight status, surfaces errors, exposes a manual flush and reports
// `isDirty` so navigation guards (useUnsavedChangesGuard) can block
// tab-close / route-change while changes are not yet persisted.
import { useCallback, useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface UseAutosaveOpts<T> {
  value: T;
  save: (value: T) => Promise<void>;
  delayMs?: number;
  enabled?: boolean;
  equals?: (a: T, b: T) => boolean;
}

export interface UseAutosaveResult {
  status: AutosaveStatus;
  error: string | null;
  flush: () => Promise<void>;
  lastSavedAt: number | null;
  /** True while the current value differs from the last persisted snapshot. */
  isDirty: boolean;
}

export function useAutosave<T>({
  value,
  save,
  delayMs = 1500,
  enabled = true,
  equals = Object.is,
}: UseAutosaveOpts<T>): UseAutosaveResult {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const lastSavedRef = useRef<T>(value);
  const valueRef = useRef<T>(value);
  valueRef.current = value;
  const inFlightRef = useRef(false);
  const queuedRef = useRef<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRunRef = useRef(true);

  const runSave = useCallback(
    async (snapshot: T) => {
      if (inFlightRef.current) {
        queuedRef.current = snapshot;
        return;
      }
      inFlightRef.current = true;
      setStatus("saving");
      try {
        await save(snapshot);
        lastSavedRef.current = snapshot;
        setLastSavedAt(Date.now());
        setError(null);
        const q = queuedRef.current;
        queuedRef.current = null;
        inFlightRef.current = false;
        if (q !== null && !equals(q, lastSavedRef.current)) {
          await runSave(q);
        } else {
          setStatus("saved");
        }
      } catch (e) {
        inFlightRef.current = false;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    },
    [save, equals],
  );

  useEffect(() => {
    if (!enabled) return;
    if (firstRunRef.current) {
      firstRunRef.current = false;
      lastSavedRef.current = value;
      return;
    }
    if (equals(value, lastSavedRef.current)) return;
    // Debounced AUTO-save: mark dirty immediately, then persist after the
    // editor goes idle for `delayMs`. The timer restarts on every change, so
    // one save covers a whole burst of typing. Saving reads valueRef (the
    // freshest value), never the closure snapshot.
    setStatus("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!equals(valueRef.current, lastSavedRef.current)) {
        void runSave(valueRef.current);
      }
    }, delayMs);
  }, [value, enabled, equals, delayMs, runSave]);

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
    if (!equals(valueRef.current, lastSavedRef.current)) await runSave(valueRef.current);
  }, [equals, runSave]);

  const isDirty = enabled && !equals(value, lastSavedRef.current);

  return { status, error, flush, lastSavedAt, isDirty };
}
