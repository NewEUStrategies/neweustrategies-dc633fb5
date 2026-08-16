// Czyste helpery kolejności autorów wpisu. Kontrakt redakcyjny: PIERWSZY
// autor na liście jest autorem głównym (posts.author_id), kolejni to
// współautorzy zapisywani w post_authors z rosnącym sort_order. Logika żyje
// osobno od I/O, żeby dało się ją testować w izolacji i współdzielić między
// edytorem (UI) a funkcją serwerową (zapis).

export const MAX_POST_AUTHORS = 10;

/** Deduplikuje listę autorów zachowując kolejność wprowadzenia. */
export function normalizeAuthorOrder(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const v = id?.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Przesuwa autora o `delta` pozycji (np. -1 = w górę). Zwraca nową tablicę. */
export function moveAuthor(ids: readonly string[], index: number, delta: number): string[] {
  const next = [...ids];
  const target = index + delta;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Usuwa autora, ale nigdy nie pozwala opróżnić listy (musi zostać główny). */
export function removeAuthor(ids: readonly string[], id: string): string[] {
  const next = ids.filter((x) => x !== id);
  return next.length ? next : [...ids];
}

/** Rozbija uporządkowaną listę na autora głównego i współautorów. */
export function splitAuthors(ids: readonly string[]): { main: string | null; coAuthors: string[] } {
  const ordered = normalizeAuthorOrder(ids);
  return { main: ordered[0] ?? null, coAuthors: ordered.slice(1) };
}
