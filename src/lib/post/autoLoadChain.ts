// Reguły nieskończonego doładowywania kolejnych wpisów pod artykułem.
//
// DLACZEGO OSOBNY MODUŁ: warunki siedziały wewnątrz callbacku
// `IntersectionObserver` w `AutoLoadNextPost`. Ich sprawdzenie wymagało atrapy
// obserwatora, a atrapa obserwatora, która „widzi" sentinel w niewłaściwym
// momencie, dowodzi czegoś innego niż reguła. Tymczasem to te warunki
// powstrzymują PODWÓJNE żądanie (dwa wpisy naraz) i nieskończony łańcuch.

/** Domyślny limit sekwencyjnych doładowań w jednej sesji czytania. */
export const DEFAULT_MAX_CHAIN = 5;

/** Kursor: od którego wpisu szukamy następnego. */
export interface ChainCursor {
  id: string;
  publishedAt: string | null;
}

export interface ChainLink {
  post: { id: string; published_at: string | null };
}

/**
 * Czy sentinel wchodzący w widok ma wywołać pobranie następnego wpisu.
 *
 * Cztery blokady, każda z innego powodu:
 *   - `done`      - poprzednie pobranie zwróciło pustkę; nie ma czego szukać,
 *   - `maxChain`  - limit łańcucha (bez niego strona rośnie bez końca),
 *   - `loading`   - żądanie już leci,
 *   - `requested` - ref-strażnik przeciw DWÓM wywołaniom z jednego przecięcia
 *                   (obserwator potrafi wywołać callback wielokrotnie dla tego
 *                   samego przejścia, np. przy przewijaniu tam i z powrotem).
 */
export function shouldRequestNext(state: {
  done: boolean;
  chainLength: number;
  maxChain: number;
  loading: boolean;
  requested: boolean;
  intersecting: boolean;
}): boolean {
  if (!state.intersecting) return false;
  if (state.done) return false;
  if (state.chainLength >= state.maxChain) return false;
  if (state.loading || state.requested) return false;
  return true;
}

/**
 * Kursor dla następnego pobrania: OSTATNI doładowany wpis, a gdy łańcuch jest
 * pusty - wpis otwarty przez czytelnika. Pomyłka tutaj daje pętlę: pobieranie
 * wciąż tego samego „następnego" wpisu.
 */
export function nextCursor(chain: readonly ChainLink[], fallback: ChainCursor): ChainCursor {
  const last = chain.at(-1);
  if (!last) return fallback;
  return { id: last.post.id, publishedAt: last.post.published_at };
}

/** Identyfikator nagłówka doładowanego wpisu - kotwica dla podmiany adresu URL. */
export function chainHeadingId(postId: string): string {
  return `nextpost-${postId}`;
}
