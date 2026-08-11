// Grupowanie WŁASNYCH klubów po obszarze tematycznym - czysta projekcja dla
// zakładek sekcji „Moje kluby".
//
// DLACZEGO OSOBNO OD `countClubTopics`. Tamta funkcja liczy obszary w KATALOGU
// (do paska odkrywania) i świadomie pomija kluby bez obszaru - pusta zakładka
// w odkrywaniu jest obietnicą bez pokrycia. Tutaj jest odwrotnie: to lista
// rzeczy, do których użytkownik NALEŻY, więc żaden jego klub nie ma prawa
// zniknąć z widoku. Klub bez obszaru trafia do grupy `null` („Pozostałe"),
// która stoi na końcu.
//
// Kolejność jest deterministyczna (najliczniejsze pierwsze, remisy po kluczu),
// bo zakładki nie mogą skakać przy każdym refetchu listy.

export interface MyClubGroup<T> {
  /** Klucz obszaru albo `null` dla klubów bez przypisanego obszaru. */
  area: string | null;
  clubs: T[];
}

export function groupMyClubs<T extends { policy_area: string | null }>(
  clubs: readonly T[],
): MyClubGroup<T>[] {
  const buckets = new Map<string, T[]>();
  const rest: T[] = [];

  for (const club of clubs) {
    const area = club.policy_area;
    if (area === null || area.trim() === "") {
      rest.push(club);
      continue;
    }
    const bucket = buckets.get(area);
    if (bucket === undefined) buckets.set(area, [club]);
    else bucket.push(club);
  }

  const groups: MyClubGroup<T>[] = [...buckets.entries()]
    .map(([area, rows]) => ({ area, clubs: rows }))
    .sort((a, b) => b.clubs.length - a.clubs.length || a.area!.localeCompare(b.area!));

  if (rest.length > 0) groups.push({ area: null, clubs: rest });
  return groups;
}

/**
 * Czy sekcja ma sens jako zakładki. Jedna grupa to nie jest wybór - pasek
 * z jednym przyciskiem tylko zabiera miejsce nad treścią.
 */
export function shouldTabMyClubs(groups: readonly { area: string | null }[]): boolean {
  return groups.length >= 2;
}
