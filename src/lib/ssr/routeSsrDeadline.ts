// JEDEN ZEGAR NA ŻĄDANIE SSR - uogólnienie `homeSsrBudget.ts` na każdą trasę
// publiczną (audyt CWV 2026-09-20, F15 / §8 wiersz 2.2).
//
// PROBLEM, który to zamyka: poza stroną główną KAŻDA faza loadera miała WŁASNY
// budżet, a fazy były szeregowe, więc przy chorej bazie TTFB sumował budżety
// (trasa treści: 5 000 + 3 000 + 5 000 = 13 000 ms). Wspólny `deadlineAt`
// sprawia, że kolejne fazy dostają wyłącznie RESZTĘ czasu - suma nie może
// przekroczyć jednego budżetu, niezależnie od liczby faz.
//
// SSR tworzy jeden `QueryClient` na żądanie, więc to on jest kluczem zegara.
// W przeglądarce `QueryClient` żyje całą sesję: deadline z pierwszej nawigacji
// byłby „miniony" dla wszystkich kolejnych i każdy loader oddawałby sterowanie
// natychmiast. Zegar ma więc sens WYŁĄCZNIE na serwerze - ale od 2026-09-21
// nie wisi to już na dyscyplinie wołających (recenzja PR #382, P1): zegar
// pilnuje się sam TAM, GDZIE JEST CZYTANY. `loadResilient`
// (lib/ssr/resilientLoad.ts) honoruje `deadlineAt` i `budgetMs` tylko pod
// `isSsrRequest()` (lib/ssr/isSsrRequest.ts), a w przeglądarce czeka na
// zapytanie do skutku i po prostu ignoruje znacznik z tego modułu. Trasy mogą
// więc liczyć deadline bezwarunkowo.
//
// GWARANCJA NIE ROZCIĄGA SIĘ na wołających, którzy mierzą czas SAMI - gołe
// `withBudget(..., deadlineAt)` w `__root.tsx`, `$.tsx` czy bramkach modułów
// nie przechodzi przez `loadResilient`. Tam deadline nadal powstaje wyłącznie
// pod `isServer` (wzorzec `$.tsx`: `isServer ? routeSsrDeadline(...) :
// undefined`), a ten moduł sam środowiska nie zgaduje.
import type { QueryClient, QueryKey } from "@tanstack/react-query";

const deadlines = new WeakMap<QueryClient, number>();

/**
 * Wspólny deadline żądania: pierwszy wołający go TWORZY (`teraz + budgetMs`),
 * każdy kolejny dostaje TEN SAM znacznik. Loader korzenia i loader trasy biegną
 * równolegle na jednym `QueryClient`, więc „pierwszy" bywa którykolwiek z nich -
 * budżet późniejszego wołającego nie wydłuża zegara już nastawionego.
 */
export function routeSsrDeadline(queryClient: QueryClient, budgetMs: number): number {
  let deadline = deadlines.get(queryClient);
  if (deadline === undefined) {
    deadline = Date.now() + budgetMs;
    deadlines.set(queryClient, deadline);
  }
  return deadline;
}

/** Ile czasu faza może jeszcze czekać: mniej z (własny sufit, reszta do deadline'u), nigdy < 0. */
export function remainingBudget(deadlineAt: number, phaseLimitMs: number): number {
  return Math.max(0, Math.min(phaseLimitMs, deadlineAt - Date.now()));
}

/**
 * Czy zapytanie ma PRAWDZIWE dane z tego renderu. Pusty wynik (`null`, `[]`)
 * jest poprawny; brak wpisu, błąd i ZASIEW FALLBACKOWY (`dataUpdatedAt === 0`)
 * nie są - zasiew z definicji rodzi się przeterminowany, żeby klient go
 * dociągnął, więc nie wolno liczyć go jako rozgrzanego.
 */
export function hasSsrQueryData(queryClient: QueryClient, queryKey: QueryKey): boolean {
  const state = queryClient.getQueryState(queryKey);
  return state?.status === "success" && state.data !== undefined && state.dataUpdatedAt > 0;
}
