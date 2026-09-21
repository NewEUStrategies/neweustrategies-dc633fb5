// Czyste reguły zwijania gałęzi dyskusji - wspólne dla wątków klubowych,
// komentarzy pod artykułami i ściany klubu.
//
// ZBIÓR TRZYMA WYJĄTKI, NIE STAN WSZYSTKIEGO. Pusty zbiór znaczy „wszystko
// rozwinięte". Dzięki temu odpowiedź, która właśnie przyszła, jest widoczna bez
// dopisywania jej gdziekolwiek - a gdyby zbiór trzymał OTWARTE, każda nowa
// gałąź startowałaby zwinięta i wyglądała jak zgubiona treść.
//
// KLUCZ TO ID, NIE POZYCJA. Lista odpowiedzi dostaje nowe partie w trakcie
// czytania; stan indeksowany pozycją przestawiłby się wtedy na inne gałęzie.

/** Węzeł dowolnego drzewa dyskusji - liczy się tylko to, że ma dzieci. */
export interface BranchNode<T> {
  children: T[];
}

/**
 * Ile wpisów wisi POD węzłem, licząc wszystkie poziomy. `children.length` dałby
 * tylko dzieci bezpośrednie, a przełącznik obiecuje czytelnikowi, ile treści
 * chowa - więc musi liczyć całą gałąź.
 */
export function countDescendants<T extends BranchNode<T>>(node: T): number {
  let total = 0;
  for (const child of node.children) {
    total += 1 + countDescendants(child);
  }
  return total;
}

/**
 * Przełącza gałąź w zbiorze ZWINIĘTYCH. Nie mutuje wejścia - stan Reacta musi
 * dostać nową referencję - i zwraca ten sam zbiór, gdy nic się nie zmienia,
 * żeby nie wywoływać zbędnego renderu.
 */
export function toggleBranch(
  collapsed: ReadonlySet<string>,
  id: string,
  open: boolean,
): ReadonlySet<string> {
  const isCollapsed = collapsed.has(id);
  if (open === !isCollapsed) return collapsed;
  const next = new Set(collapsed);
  if (open) next.delete(id);
  else next.add(id);
  return next;
}

/** Zdejmuje gałąź ze zbioru zwiniętych - po wysłaniu do niej odpowiedzi. */
export function revealBranch(
  collapsed: ReadonlySet<string>,
  id: string | null,
): ReadonlySet<string> {
  if (id === null) return collapsed;
  return toggleBranch(collapsed, id, true);
}
