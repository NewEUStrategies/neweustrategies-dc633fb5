// Reguła roboczej listy kompetencji członka klubu.
//
// PO CO OSOBNY MODUŁ. Zapis kompetencji ZASTĘPUJE cały zbiór
// (`club_expertise_set`), więc formularz w `ClubRosterPanel` trzyma listę
// roboczą lokalnie i wysyła ją w całości. Przełączanie pozycji na tej liście
// nie jest jednak `setState(value)`: jest w nim GÓRNY LIMIT deklaracji, a limit
// to reguła produktowa. Trzymana wewnątrz handlera nie da się opisać tabelą
// przypadków - w interfejsie przepełniony przycisk jest wyłączony, więc
// zachowanie „przy limicie lista się nie zmienia" nie ma jak zostać dowiedzione
// z klikania.
//
// GRANICA LIMITU JEST PODAWANA, NIE LICZONA TUTAJ. Flaga `atLimit` przychodzi
// z tego samego renderu, który wyłączył przycisk - dzięki temu decyzja
// formularza i decyzja tej funkcji NIGDY się nie rozjeżdżają.
import { CLUB_EXPERTISE_MAX } from "./networkTypes";

/** Czy lista robocza dobiła do limitu deklaracji. */
export function isExpertiseDraftFull(
  draft: readonly string[],
  max: number = CLUB_EXPERTISE_MAX,
): boolean {
  return draft.length >= max;
}

/**
 * Przełącza obszar na liście roboczej.
 *
 * Trzy przypadki i trzeci jest tym, po co ta funkcja istnieje:
 * 1. obszar JEST na liście - wypada z niej (zdjęcie deklaracji zawsze wolno),
 * 2. obszar nie jest, a miejsce jest - dochodzi NA KOŃCU (kolejność deklaracji
 *    to kolejność klikania, nie kolejność katalogu),
 * 3. obszar nie jest, a limit dobity - wraca TA SAMA tablica, więc React nie
 *    przerysowuje formularza po kliknięciu, które nic nie zmieniło.
 */
export function toggleExpertiseDraft(draft: string[], key: string, atLimit: boolean): string[] {
  if (draft.includes(key)) return draft.filter((entry) => entry !== key);
  if (atLimit) return draft;
  return [...draft, key];
}
