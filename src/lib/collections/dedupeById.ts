// Deduplikacja rekordów po `id` z zachowaniem KOLEJNOŚCI pierwszego wystąpienia.
//
// PO CO WSPÓLNY MODUŁ. Dokładnie ten sam idiom
// (`Array.from(new Map(rows.map((r) => [r.id, r])).values())`) stał wpisany
// dwa razy: w feedzie obserwowanych (`/reading-list`) i w katalogu osób
// (`/people`). Obie kopie chronią przed tym samym zjawiskiem: paginacja
// OFFSETOWA nie jest stabilna - publikacja nowego wiersza między żądaniami
// przesuwa okno, więc ten sam rekord potrafi wrócić na kolejnej stronie
// i (bez deduplikacji) trafić do listy Reacta pod zduplikowanym `key`.
//
// KONTRAKT, KTÓREGO ŁATWO NIE ZAUWAŻYĆ: pozycję w wyniku wyznacza PIERWSZE
// wystąpienie, ale wartością jest OSTATNIE (`Map.set` nadpisuje). Dla feedów to
// zachowanie pożądane - świeższa strona niesie świeższą wersję wiersza -
// i właśnie dlatego jest tu opisane i objęte testem, a nie zostawione jako
// przypadkowy efekt idiomu.
export function dedupeById<T extends { id: string }>(rows: readonly T[]): T[] {
  return Array.from(new Map(rows.map((row) => [row.id, row])).values());
}
