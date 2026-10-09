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

/**
 * WŁASNY budżet ścieżki krytycznej TREŚCI strony głównej (`home.page`,
 * `home.mode`; fala 3, P3.6b, R3a diagnozy `faza3/diagnoza/cache-dokumentu.md`).
 *
 * Treść to trzy szeregowe round-tripy (ustawienia czytania -> wiersz strony ->
 * ciało), z kolonii dalekiej od bazy 0,6-0,9 s. Przy wspólnym terminie 600 ms
 * połowa zimnych MISS-ów wychodziła jako „typ A": komunikat „Wczytujemy stronę
 * główną" zamiast treści, bez hero i bez zapisu do cache'u. Treść dostaje więc
 * dłuższy, ale nadal twardy termin, liczony od TEGO SAMEGO startu zegara
 * żądania co `HOME_SSR_BUDGET_MS`. Ustawienia, motyw, chrome i widgety nad
 * zgięciem zostają przy wspólnych 600 ms.
 */
export const HOME_CONTENT_BUDGET_MS = 1_200;

/**
 * Budżet bramki chrome'u strony głównej, gdy wspólny termin dokumentu minął,
 * zanim nagłówek dostał dane (P3.6b, R2c). Liczony od pierwszego odczytu
 * bramki w renderze. Zamiast natychmiastowego renderu na fallbackach (pasek
 * „Na czasie" doskakiwał po hydratacji, a dokument szedł `no-store`) granica
 * nagłówka czeka najwyżej tyle i dostrumieniowuje się; treść trasy jest
 * rodzeństwem tej granicy i flushuje się bez czekania.
 */
export const HOME_CHROME_LATE_BUDGET_MS = 1_200;

// SSR creates one QueryClient per request. Callers must not use this clock for
// SPA navigation, where a QueryClient lives for the whole browser session.
export function homeSsrDeadline(queryClient: QueryClient): number {
  return routeSsrDeadline(queryClient, HOME_SSR_BUDGET_MS);
}

/**
 * Termin ścieżki krytycznej treści (`HOME_CONTENT_BUDGET_MS`) na tym samym
 * zegarze co `homeSsrDeadline`: start żądania + budżet treści. Pierwszy
 * wołający zegara (loader korzenia albo trasy) wyznacza start dla obu.
 */
export function homeContentDeadline(queryClient: QueryClient): number {
  return homeSsrDeadline(queryClient) - HOME_SSR_BUDGET_MS + HOME_CONTENT_BUDGET_MS;
}

export function remainingHomeBudget(deadlineAt: number, phaseLimitMs: number): number {
  return remainingBudget(deadlineAt, phaseLimitMs);
}
