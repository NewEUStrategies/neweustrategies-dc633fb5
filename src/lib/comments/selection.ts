// Czyste helpery zaznaczenia dla moderacji zbiorczej (kolejka komentarzy).
// Trzymamy logikę zaznaczenia poza komponentem trasy, żeby była testowalna w
// izolacji - stan „zaznacz widoczne" (all/some/none) steruje trójstanowym
// checkboxem nagłówka, a prune usuwa z zaznaczenia wiersze, które zniknęły po
// zmianie filtra albo po wykonaniu akcji (inaczej licznik „Zaznaczono: N"
// kłamie i akcja zbiorcza celowałaby w nieobecne id).

/** Stan checkboxa „zaznacz widoczne": wszystkie / część / żaden. */
export type SelectAllState = "all" | "some" | "none";

export function selectAllState(
  visibleIds: readonly string[],
  selected: ReadonlySet<string>,
): SelectAllState {
  if (visibleIds.length === 0) return "none";
  let count = 0;
  for (const id of visibleIds) if (selected.has(id)) count++;
  if (count === 0) return "none";
  if (count === visibleIds.length) return "all";
  return "some";
}

/** Przełącza pojedynczy wiersz (zwraca NOWY zbiór - nie mutuje wejścia). */
export function toggleSelected(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Przełącza wszystkie widoczne: gdy wszystkie widoczne są już zaznaczone -
 * odznacza je; w przeciwnym razie dozaznacza brakujące. Zaznaczenia spoza
 * widocznej listy (np. z innej strony wyników) pozostają nietknięte.
 */
export function toggleSelectAll(
  visibleIds: readonly string[],
  selected: ReadonlySet<string>,
): Set<string> {
  const next = new Set(selected);
  if (selectAllState(visibleIds, selected) === "all") {
    for (const id of visibleIds) next.delete(id);
  } else {
    for (const id of visibleIds) next.add(id);
  }
  return next;
}

/** Odsiewa z zaznaczenia id, których już nie ma na liście (po refetchu/akcji). */
export function retainExisting(
  selected: ReadonlySet<string>,
  existingIds: readonly string[],
): Set<string> {
  const present = new Set(existingIds);
  const next = new Set<string>();
  for (const id of selected) if (present.has(id)) next.add(id);
  return next;
}
