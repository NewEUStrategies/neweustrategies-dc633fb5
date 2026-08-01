// Zaznaczenie wielokrotne bloków (zachowanie WordPress Gutenberg):
// Shift+klik zaznacza ZAKRES od kotwicy do klikniętego bloku,
// Ctrl/Cmd+klik przełącza pojedynczy blok w zaznaczeniu.
// Czyste funkcje na listach id - testowalne bez DOM.

/** Ciągły zakres id od `fromId` do `toId` (włącznie), w kolejności dokumentu. */
export function blockRange(ids: readonly string[], fromId: string, toId: string): string[] {
  const a = ids.indexOf(fromId);
  const b = ids.indexOf(toId);
  if (a < 0 || b < 0) return b >= 0 ? [toId] : a >= 0 ? [fromId] : [];
  const [start, end] = a <= b ? [a, b] : [b, a];
  return ids.slice(start, end + 1) as string[];
}

/** Przełącza obecność `id` w zaznaczeniu, zachowując kolejność dokumentu. */
export function toggleInSelection(
  ids: readonly string[],
  selected: readonly string[],
  id: string,
): string[] {
  const set = new Set(selected);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return ids.filter((x) => set.has(x)) as string[];
}
