// Arytmetyka paginacji strony głównej w trybie „najnowsze wpisy" - czyste
// funkcje, bez Reacta i bez routera.
//
// PO CO OSOBNO. Oba wyrażenia siedziały w ciele komponentu trasy, a niosą
// KONTRAKT SEO: adres strony pierwszej musi zostać BEZ parametru (`/`, nie
// `/?page=1`), inaczej ta sama treść ma dwa indeksowalne adresy. Sprawdzenie
// tego przez montaż strony głównej wymaga atrap ustawień, reklam i archiwum;
// jako funkcja to jedna asercja.

/**
 * Liczba stron wyników. Dolny zawór `1` trzyma pasek paginacji w sensownym
 * stanie także dla pustego archiwum (0 wpisów to nadal „strona 1 z 1").
 *
 * `pageSize` przychodzi z `resolvePostsPerPage`, który gwarantuje zakres
 * 1..100, więc dzielenie przez zero nie jest tu osiągalne z produkcji.
 */
export function homeTotalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Search params adresu strony wyników. Strona pierwsza jest NIEJAWNA
 * (`undefined` znika z adresu) - ten sam kontrakt co `/blog`.
 */
export function homePageSearch(nextPage: number): { page: number | undefined } {
  return { page: nextPage > 1 ? nextPage : undefined };
}
