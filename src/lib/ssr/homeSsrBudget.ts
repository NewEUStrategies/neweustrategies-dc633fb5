import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** Bounds data waiting in root + homepage, not middleware/network/React CPU. */
export const HOME_SSR_BUDGET_MS = 600;
export const HOME_THEME_BUDGET_MS = 400;
export const HOME_ABOVE_FOLD_BUDGET_MS = 500;

// SSR creates one QueryClient per request. Callers must not use this clock for
// SPA navigation, where a QueryClient lives for the whole browser session.
const deadlines = new WeakMap<QueryClient, number>();

export function homeSsrDeadline(queryClient: QueryClient): number {
  let deadline = deadlines.get(queryClient);
  if (deadline === undefined) {
    deadline = Date.now() + HOME_SSR_BUDGET_MS;
    deadlines.set(queryClient, deadline);
  }
  return deadline;
}

export function remainingHomeBudget(deadlineAt: number, phaseLimitMs: number): number {
  return Math.max(0, Math.min(phaseLimitMs, deadlineAt - Date.now()));
}

/** Empty successful results are valid; absent/error/seeded data is not. */
export function hasSsrQueryData(queryClient: QueryClient, queryKey: QueryKey): boolean {
  const state = queryClient.getQueryState(queryKey);
  return state?.status === "success" && state.data !== undefined && state.dataUpdatedAt > 0;
}
