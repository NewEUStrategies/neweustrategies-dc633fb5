// Zamiatanie per-żądaniowego SSR QueryClienta przed serializacją.
//
// NAZWA TEGO MODUŁU KŁAMIE I TO JEST ŚWIADOMY DŁUG. „postRender" sugeruje, że
// zamiatanie biegnie PO renderze - biegnie PRZED. `createStartHandler` woła
// `routerInstance.load()` (wszystkie loadery), potem `serverSsr.dehydrate()` -
// stamtąd woła nas `src/router.tsx` - i DOPIERO POTEM render Reacta. Nazwa
// zostaje, bo jest w imporcie w kilku miejscach i zmiana jej to osobna, czysto
// mechaniczna zmiana; ten akapit istnieje, żeby następny czytelnik nie zbudował
// na odwrotnym modelu (co już się raz zdarzyło - patrz sprostowanie
// w `src/router.tsx` przy `options.dehydrate`).
//
// KONSEKWENCJA PRAKTYCZNA: obietnica, której loader nie awaituje, zostaje tu
// anulowana i usunięta, zanim React wyrenderuje choćby bajt. Rozgrzewka
// „fire-and-forget" nie dowozi w tym repozytorium NICZEGO.
//
// PROBLEM: w chwili dehydratacji w cache potrafią zostać zapytania, które
// nigdy się nie rozstrzygną w tym żądaniu:
//   * `fetchStatus !== "idle"` - fetch wciąż wisi (upstream nie odpowiada),
//   * `status === "pending"`, `fetchStatus === "idle"`, brak danych i
//     obserwatorów - promise, którego nikt już nie rozstrzygnie.
// Obie klasy trzymają serializację (seroval czeka na promisy) i kończą się
// uciętym HTML-em: "Serialization timeout after app render finished".
//
// SOLUTION: raz, w deterministycznym momencie (zamknięcie strażnika strumienia
// i na wejściu w dehydratację), anulujemy to, co jeszcze leci (`revert: true`,
// `silent: true`), a następnie usuwamy z cache wszystko, co nie może się już
// rozstrzygnąć. Nic nie tracimy - takie zapytania nie mają danych, a klient
// pobiera je ponownie po hydracji.

import type { QueryClient } from "@tanstack/react-query";

import { isUnresolvableQuery, pruneUnresolvedQueries } from "./pruneUnresolvedQueries";

export interface PostRenderSweepResult {
  /** Liczba zapytań, którym przerwaliśmy fetch. */
  cancelled: number;
  /** Klucze zapytań usuniętych z cache (nie mogły się rozstrzygnąć). */
  pruned: string[];
}

export interface PostRenderSweepOptions {
  /** Etykieta diagnostyczna - zwykle pathname. */
  label?: string;
  /** Powód wywołania (idle / timeout / dehydrate). */
  reason?: string;
  /** Loguj tylko wtedy, gdy faktycznie coś posprzątaliśmy. */
  quiet?: boolean;
}

/**
 * Anuluje trwające fetch-e i usuwa nierozstrzygalne zapytania. Server-only -
 * na kliencie ubiłoby to normalne, długie zapytania.
 */
export function sweepQueryCacheForSerialization(
  queryClient: QueryClient,
  options: PostRenderSweepOptions = {},
): PostRenderSweepResult {
  const cache = queryClient.getQueryCache();
  let cancelled = 0;

  for (const query of cache.getAll()) {
    if (query.state.fetchStatus === "idle") continue;
    cancelled += 1;
    // `revert: true` przywraca ostatni znany stan, `silent: true` nie budzi
    // obserwatorów w trakcie serializacji.
    void query.cancel({ revert: true, silent: true }).finally(() => {
      if (isUnresolvableQuery(query)) cache.remove(query);
    });
  }

  const pruned = pruneUnresolvedQueries(queryClient);

  if (!options.quiet && (cancelled > 0 || pruned.length > 0)) {
    console.warn(
      `[ssr-post-render-sweep] route=${options.label ?? "-"} ` +
        `reason=${options.reason ?? "-"} cancelled=${cancelled} pruned=${pruned.length}` +
        (pruned.length > 0 ? ` keys=${pruned.join(", ")}` : ""),
    );
  }

  return { cancelled, pruned };
}
