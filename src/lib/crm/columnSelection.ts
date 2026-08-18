// Wybór kolumn tabeli - reguła wspólna dla listy osób i listy firm.
//
// `LeadColumnManager` i `CompanyColumnManager` miały tę samą regułę w dwóch
// kopiach (81 linii każda, 0% pokrycia): przełącz kolumnę, zachowaj semantyczną
// KOLEJNOŚĆ definicji (nie kolejność klikania), nie pozwól ukryć kolumny
// wymaganej i nigdy nie zostaw tabeli bez żadnej kolumny.
//
// Moduł operuje na kluczach, nie na etykietach - tłumaczenia zostają w panelu.

/** Minimum, jakiego reguła potrzebuje od definicji kolumny. */
export interface ColumnLike<K extends string> {
  key: K;
  required?: boolean;
}

/**
 * Przełącza kolumnę w widoku.
 *
 * Wynik jest zawsze uporządkowany według `columns` - dzięki temu tabela nie
 * przestawia kolumn w zależności od kolejności klikania, a zapisany widok
 * (`saved_views`) odtwarza się tak samo po stronie każdego użytkownika.
 */
export function toggleColumn<K extends string>(
  columns: readonly ColumnLike<K>[],
  active: readonly K[],
  key: K,
  fallback: readonly K[],
): K[] {
  const required = columns.find((c) => c.key === key)?.required === true;
  if (required) return [...active];

  const selected = new Set(active);
  const next = columns
    .filter((c) => (c.key === key ? !selected.has(key) : selected.has(c.key)))
    .map((c) => c.key);
  // Tabela bez kolumn nie ma sensu - wracamy do kolumn wymaganych.
  return next.length > 0 ? next : [...fallback];
}

/** Kolumny wymagane danej tabeli - fallback, gdy użytkownik odznaczy wszystko. */
export function requiredColumns<K extends string>(columns: readonly ColumnLike<K>[]): K[] {
  return columns.filter((c) => c.required === true).map((c) => c.key);
}

/** Czy kolumna jest aktualnie widoczna (do stanu checkboxa). */
export function isColumnActive<K extends string>(active: readonly K[], key: K): boolean {
  return active.includes(key);
}

/** Definicje widocznych kolumn w kolejności tabeli - do renderu nagłówka. */
export function visibleColumns<K extends string, T extends ColumnLike<K>>(
  columns: readonly T[],
  active: readonly K[],
): T[] {
  const selected = new Set(active);
  return columns.filter((c) => selected.has(c.key));
}
