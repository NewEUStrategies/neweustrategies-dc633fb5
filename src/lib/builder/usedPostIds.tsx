// Cross-widget bookkeeping: which post IDs have already been rendered on this
// page. Lets `post-list` / `carousel` / `news-ticker` widgets opt-in to a
// "unique-post" mode that excludes IDs already shown by earlier widgets.
//
// Implementation is intentionally lightweight: a ref-backed set provided via
// React context. Widgets call `getSnapshot()` synchronously at query time and
// `register(ids)` after their data resolves. Order matches DOM render order.
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";

interface UsedPostIdsApi {
  /** Add post IDs to the shared set (after a widget fetches). */
  register: (ids: ReadonlyArray<string>) => void;
  /** Snapshot of currently used IDs at call time. */
  getSnapshot: () => string[];
}

const UsedPostIdsContext = createContext<UsedPostIdsApi | null>(null);

export function UsedPostIdsProvider({ children }: { children: ReactNode }) {
  const ref = useRef<Set<string>>(new Set());
  const api = useMemo<UsedPostIdsApi>(
    () => ({
      register: (ids) => {
        for (const id of ids) if (id) ref.current.add(id);
      },
      getSnapshot: () => Array.from(ref.current),
    }),
    [],
  );
  return <UsedPostIdsContext.Provider value={api}>{children}</UsedPostIdsContext.Provider>;
}

export function useUsedPostIds(): UsedPostIdsApi {
  const ctx = useContext(UsedPostIdsContext);
  // Fallback no-op API for usages outside a provider (e.g. isolated tests).
  return useMemo<UsedPostIdsApi>(
    () =>
      ctx ?? {
        register: () => {
          /* no-op */
        },
        getSnapshot: () => [],
      },
    [ctx],
  );
}

// Test hook: registers a callback to be invoked whenever ids change.
export function useRegisterPostIds(): (ids: ReadonlyArray<string>) => void {
  const { register } = useUsedPostIds();
  return useCallback((ids) => register(ids), [register]);
}
