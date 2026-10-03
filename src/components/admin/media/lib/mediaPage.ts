/**
 * Paginacja biblioteki mediów - czyste reguły wspólne dla menedżera i pickera.
 *
 * DLACZEGO KEYSET, A NIE `range(offset)`. Biblioteka zmienia się pod
 * przeglądającym: wgranie pliku dokłada wiersz NA POCZĄTKU listy (sort od
 * najnowszych), więc offset przesuwałby kolejne strony o jeden i ten sam plik
 * pojawiałby się dwa razy, a inny znikał. Kursor `(created_at, id)` wskazuje
 * KONKRETNY ostatni wiersz, a `id` rozstrzyga remis przy tym samym znaczniku
 * czasu (import hurtowy zapisuje wiele plików w jednej milisekundzie).
 *
 * Kolejność `created_at DESC, id DESC` niosą indeksy
 * `media_tenant_created_idx` i `media_tenant_folder_created_idx`
 * (migracja 20261003090000) - bez sortowania w pamięci bazy.
 */

/** Rozmiar strony: pełna siatka 6 kolumn x 10 wierszy w pickerze. */
export const MEDIA_PAGE_SIZE = 60;

export interface MediaCursor {
  createdAt: string;
  id: string;
}

export interface MediaPage<T> {
  rows: T[];
  nextCursor: MediaCursor | null;
}

/**
 * Filtr PostgREST `or` dla strony PO kursorze: starszy znacznik czasu albo ten
 * sam znacznik z mniejszym `id`. Wartości są w cudzysłowach, bo znacznik czasu
 * niesie znaki zarezerwowane w gramatyce filtrów (`.`, `:`).
 */
export function keysetAfter(cursor: MediaCursor): string {
  const at = JSON.stringify(cursor.createdAt);
  const id = JSON.stringify(cursor.id);
  return `created_at.lt.${at},and(created_at.eq.${at},id.lt.${id})`;
}

/**
 * Strona z wierszy pobranych z limitem `pageSize + 1`. Nadmiarowy wiersz
 * mówi, czy istnieje następna strona - bez osobnego zapytania liczącego
 * i bez fałszywej „następnej strony", gdy wierszy było dokładnie `pageSize`.
 */
export function toMediaPage<T extends { created_at: string; id: string }>(
  rows: readonly T[],
  pageSize: number = MEDIA_PAGE_SIZE,
): MediaPage<T> {
  const page = rows.slice(0, pageSize);
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor: rows.length > pageSize && last ? { createdAt: last.created_at, id: last.id } : null,
  };
}

/**
 * `placeholderData` dla zapytań biblioteki: przy zmianie folderu albo frazy
 * pokazujemy poprzednie wiersze, dopóki nie przyjdą nowe (lista nie mruga
 * pustką), ale WYŁĄCZNIE w obrębie tego samego tenanta. Klucz zapytania ma
 * tenanta na drugiej pozycji; po przełączeniu przestrzeni roboczej poprzednie
 * dane należą do innego tenanta i nie wolno ich pokazać ani przez chwilę.
 */
export function keepSameTenantData<T>(tenantId: string) {
  return (previous: T | undefined, previousQuery: { queryKey: readonly unknown[] } | undefined) =>
    previousQuery?.queryKey[1] === tenantId ? previous : undefined;
}

/**
 * Wzorzec `ILIKE` „zawiera" dla tekstu wpisanego przez użytkownika. `%` i `_`
 * są w LIKE symbolami wieloznacznymi, a `\` - znakiem ucieczki, więc bez
 * escapowania „100%" albo „a_b" dopasowywałyby zupełnie inne nazwy plików.
 */
export function ilikeContains(needle: string): string {
  return `%${needle.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
