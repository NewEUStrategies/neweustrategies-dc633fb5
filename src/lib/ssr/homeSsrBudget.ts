// Budżet SSR STRONY GŁÓWNEJ - cienki wrapper nad `routeSsrDeadline.ts`.
//
// Mechanika (WeakMap per `QueryClient`, reszta budżetu, predykat rozgrzania)
// mieszka od 2026-09-20 w `routeSsrDeadline.ts`, bo ten sam zegar potrzebuje
// trasa treści (`routes/$.tsx`) - a wcześniej istniał tylko dla `/`. Ten plik
// zachowuje dotychczasowe nazwy eksportów, więc wołający (`__root.tsx`,
// `index.tsx`, `lib/builder/prefetch.ts`, `lib/queries/blocks.ts`) nie zmieniają
// ani linii. Stałe zostają LITERAŁAMI w tym pliku: bramka `check:ssr-budgets`
// rozwiązuje je po nazwie ze źródeł `src/lib`.
import type { QueryClient } from "@tanstack/react-query";
import { remainingBudget, routeSsrDeadline } from "./routeSsrDeadline";

export { hasSsrQueryData } from "./routeSsrDeadline";

/** Bounds data waiting in root + homepage, not middleware/network/React CPU. */
export const HOME_SSR_BUDGET_MS = 600;
export const HOME_THEME_BUDGET_MS = 400;
export const HOME_ABOVE_FOLD_BUDGET_MS = 500;

// SSR creates one QueryClient per request. Callers must not use this clock for
// SPA navigation, where a QueryClient lives for the whole browser session.
export function homeSsrDeadline(queryClient: QueryClient): number {
  return routeSsrDeadline(queryClient, HOME_SSR_BUDGET_MS);
}

export function remainingHomeBudget(deadlineAt: number, phaseLimitMs: number): number {
  return remainingBudget(deadlineAt, phaseLimitMs);
}
