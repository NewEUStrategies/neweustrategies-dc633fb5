// Stan rozwinięcia wiersza listy edytowalnej, kluczowany POZYCJĄ.
//
// Edytor benefitów warstwy trzyma „który wiersz jest rozwinięty" w mapie
// indeks -> bool, bo `TierBenefit` nie ma własnego identyfikatora. Sama mapa
// jest w porządku; problemem jest to, że lista pod nią się PRZESUWA -
// przy zmianie kolejności i przy usuwaniu wiersza. Bez przesunięcia stanu
// rozwinięcie zostaje przy NUMERZE, nie przy benefitcie: redakcja przesuwa
// otwarty wiersz w dół, a otwiera się ten, który wskoczył na jego miejsce,
// razem z polami, których nikt nie chciał widzieć.
//
// Reguła mieszka tutaj, a nie w pliku komponentu, z dwóch powodów: jest czysta
// (więc testowalna bez renderowania) i dotyczy KAŻDEJ listy edytowalnej
// z rozwijanym wierszem, nie tylko benefitów.

/** Mapa „indeks wiersza -> czy rozwinięty". */
export type ExpandedRows = Record<number, boolean>;

/**
 * Przenosi stan rozwinięcia razem z wierszem po zamianie pozycji `i` i `j`.
 * Wiersze, których nikt nie rozwijał, NIE dostają wpisu - mapa nie rośnie
 * przy każdym przesunięciu.
 */
export function swapExpanded(state: ExpandedRows, i: number, j: number): ExpandedRows {
  const next = { ...state };
  const atI = state[i];
  const atJ = state[j];
  if (atJ === undefined) delete next[i];
  else next[i] = atJ;
  if (atI === undefined) delete next[j];
  else next[j] = atI;
  return next;
}

/** Zsuwa stan rozwinięcia o jeden po usunięciu wiersza `removed`. */
export function shiftExpandedAfterRemove(state: ExpandedRows, removed: number): ExpandedRows {
  const next: ExpandedRows = {};
  for (const [rawIndex, open] of Object.entries(state)) {
    const index = Number(rawIndex);
    if (index === removed) continue;
    next[index > removed ? index - 1 : index] = open;
  }
  return next;
}
