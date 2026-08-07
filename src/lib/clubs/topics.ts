// Zliczanie klubów po obszarze polityki - czysta projekcja dla nawigacji
// tematycznej na stronie głównej klubów.
//
// Kluczowa decyzja siedzi w tym, czego ta funkcja NIE robi: nie zwraca
// obszarów ze słownika POLICY_AREAS, tylko te, w których faktycznie stoi
// jakiś klub. Zakładka, która po kliknięciu daje pusty ekran, jest obietnicą
// bez pokrycia - a na powierzchni odkrywania kosztuje więcej niż jej brak.

export interface ClubTopicCount {
  area: string;
  count: number;
}

/** Klub bez obszaru nie tworzy zakładki - trafia do "wszystkich" i tam
 *  da się go znaleźć. */
export function countClubTopics(
  clubs: readonly { policy_area: string | null }[],
): ClubTopicCount[] {
  const tally = new Map<string, number>();
  for (const club of clubs) {
    const area = club.policy_area;
    if (area === null || area.trim() === "") continue;
    tally.set(area, (tally.get(area) ?? 0) + 1);
  }
  // Najliczniejsze pierwsze, remisy alfabetycznie - kolejność musi być
  // deterministyczna, inaczej zakładki skaczą przy każdym refetchu.
  return [...tally.entries()]
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => b.count - a.count || a.area.localeCompare(b.area));
}
