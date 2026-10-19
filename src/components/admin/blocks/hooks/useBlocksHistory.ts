// Undo/redo history for BlocksDoc with debounced commits.
// Atomic, type-safe (no `any`), tenant-agnostic - operates on in-memory doc only.
//
// OKNO SCALAJĄCE (`debounceMs`): kolejne edycje w obrębie okna dają JEDEN krok
// cofnięcia. Stan sprzed otwarcia okna czeka w `pending` (w stanie haka, nie
// w domknięciu licznika), a każde zdarzenie, które kończy okno wcześniej -
// gest natychmiastowy (`immediate`), `undo`, `redo` - najpierw DOMYKA ten krok
// (dopisuje `pending` do `past`), zamiast go porzucić. Inaczej stos przestawał
// być chronologiczny (spóźniony licznik dokładał stan STARSZY nad nowszym),
// a jedno Ctrl+Z w otwartym oknie zjadało dwie zmiany naraz.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlocksDoc } from "@/lib/blocks/types";

interface Options {
  /** Minimal interval (ms) between two snapshot commits for the same logical change. */
  debounceMs?: number;
  /** Maximum number of snapshots retained on the stack. */
  limit?: number;
}

/**
 * Nowy dokument albo funkcja liczona na NAJŚWIEŻSZYM stanie. Wariant funkcyjny
 * jest dla zmian nakładanych na dokument niezależnie od kanwy (np. rejestr
 * encji inline w `meta`): kanwa oddaje pełny dokument policzony ze swojego
 * propsa, więc zmiana z tego samego ticku przekazana jako gotowy obiekt
 * zostałaby nadpisana.
 */
export type BlocksDocUpdate = BlocksDoc | ((prev: BlocksDoc) => BlocksDoc);

export interface BlocksHistory {
  doc: BlocksDoc;
  setDoc: (next: BlocksDocUpdate, immediate?: boolean) => void;
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
  /** Stan sprzed otwartego okna scalającego - krok, który jeszcze nie wszedł do `past`. */
  pending: BlocksDoc | null;
}

/** Dokłada krok na wierzch stosu i przycina NAJSTARSZE kroki ponad limit. */
function pushStep(past: readonly BlocksDoc[], step: BlocksDoc, limit: number): BlocksDoc[] {
  // Ten sam obiekt dwa razy z rzędu to nie dwa kroki - cofnięcie nic by nie zmieniło.
  if (past[past.length - 1] === step) return [...past];
  const next = [...past, step];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Domyka otwarte okno: krok sprzed pisania wchodzi do stosu, przyszłość gaśnie. */
function closePending(s: InternalState, limit: number): InternalState {
  if (!s.pending) return s;
  return { ...s, past: pushStep(s.past, s.pending, limit), future: [], pending: null };
}

export function useBlocksHistory(initial: BlocksDoc, opts: Options = {}): BlocksHistory {
  const { debounceMs = 400, limit = 100 } = opts;
  const [state, setState] = useState<InternalState>({
    doc: initial,
    past: [],
    future: [],
    pending: null,
  });
  const lastCommitRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const setDoc = useCallback(
    (update: BlocksDocUpdate, immediate = false) => {
      setState((prev) => {
        const next = typeof update === "function" ? update(prev.doc) : update;
        if (prev.doc === next) return prev;
        const now = Date.now();
        const elapsed = now - lastCommitRef.current;
        const shouldCommit = immediate || elapsed > debounceMs;
        if (shouldCommit) {
          // Okno otwarte wcześniej trzeba DOMKNĄĆ przed nowym krokiem - jego
          // licznik, gdyby dożył, dołożyłby stan sprzed pisania NAD bieżący.
          cancelTimer();
          const closed = closePending(prev, limit);
          lastCommitRef.current = now;
          return {
            doc: next,
            past: pushStep(closed.past, prev.doc, limit),
            future: [],
            pending: null,
          };
        }
        // Debounce: pierwszy krok okna zapamiętuje stan sprzed pisania, kolejne
        // tylko podmieniają dokument. Nowa edycja kasuje przyszłość od razu.
        if (!timerRef.current) {
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            lastCommitRef.current = Date.now();
            setState((s) => closePending(s, limit));
          }, debounceMs);
        }
        return { ...prev, doc: next, future: [], pending: prev.pending ?? prev.doc };
      });
    },
    [debounceMs, limit, cancelTimer],
  );

  const undo = useCallback(() => {
    cancelTimer();
    setState((s0) => {
      const s = closePending(s0, limit);
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return { doc: prev, past: s.past.slice(0, -1), future: [...s.future, s.doc], pending: null };
    });
  }, [cancelTimer, limit]);

  const redo = useCallback(() => {
    cancelTimer();
    setState((s0) => {
      // Edycja w otwartym oknie skasowała przyszłość - po domknięciu nie ma
      // czego ponawiać, a nie wolno porzucić tego, co redaktor właśnie napisał.
      const s = closePending(s0, limit);
      const next = s.future[s.future.length - 1];
      if (!next) return s;
      return { doc: next, past: [...s.past, s.doc], future: s.future.slice(0, -1), pending: null };
    });
  }, [cancelTimer, limit]);

  const reset = useCallback(
    (next: BlocksDoc) => {
      cancelTimer();
      lastCommitRef.current = 0;
      setState({ doc: next, past: [], future: [], pending: null });
    },
    [cancelTimer],
  );

  useEffect(() => () => cancelTimer(), [cancelTimer]);

  // Stabilna tożsamość między renderami bez zmiany stanu: rodzic trzyma ten
  // obiekt w zależnościach efektów (skróty klawiszowe) i `useCallback`.
  return useMemo(
    () => ({
      doc: state.doc,
      setDoc,
      reset,
      undo,
      redo,
      canUndo: state.past.length > 0 || state.pending !== null,
      canRedo: state.future.length > 0,
    }),
    [state, setDoc, reset, undo, redo],
  );
}
