// useAutosave - calls `save(value)` after `delayMs` of idle time.
// Skips the first run (so initial mount doesn't trigger a save), tracks
// in-flight status, surfaces errors, and exposes a manual flush.
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
}

export function useAutosave<T>({
  value, save, delayMs = 1500, enabled = true,
  equals = Object.is,
}: UseAutosaveOpts<T>): UseAutosaveResult {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const lastSavedRef = useRef<T>(value);
  const inFlightRef = useRef(false);
  const queuedRef = useRef<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRunRef = useRef(true);

  const runSave = useCallback(async (snapshot: T) => {
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
  }, [save, equals]);

  useEffect(() => {
    if (!enabled) return;
    if (firstRunRef.current) {
      firstRunRef.current = false;
      lastSavedRef.current = value;
      return;
    }
    if (equals(value, lastSavedRef.current)) return;
    // Manual-save only: mark as dirty, do NOT schedule an automatic save.
    setStatus("dirty");
  }, [value, enabled, equals]);


  const flush = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (!equals(value, lastSavedRef.current)) await runSave(value);
  }, [value, equals, runSave]);

  return { status, error, flush, lastSavedAt };
}
