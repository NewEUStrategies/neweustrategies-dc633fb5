// Który komunikat pustki pokazać w katalogu osób.
//
// ATOM i18n-POPRAWNY: zwraca KLUCZ słownika, nigdy gotowy tekst.
//
// PO CO ROZRÓŻNIENIE. Trzy różne przyczyny „zero wyników" wymagają trzech
// różnych zdań, bo prowadzą do trzech różnych działań czytelnika:
//   * filtry zawężają -> „nic nie pasuje do filtrów" (wyczyść filtry),
//   * jest fraza, nie ma filtrów -> „nic nie znaleziono" (zmień frazę),
//   * ani frazy, ani filtrów -> „katalog jest pusty" (nikt się jeszcze nie
//     ujawnił - czytelnik nie ma tu nic do naprawiania).
// Jeden wspólny komunikat mówiłby, że katalog jest pusty, kiedy jest tylko
// zawężony - ta klasa pomyłki wystąpiła w tym repo już wielokrotnie.
export function peopleEmptyKey(input: { hasActiveFilters: boolean; hasQuery: boolean }): string {
  if (input.hasActiveFilters) return "people.emptyFiltered";
  return input.hasQuery ? "people.empty" : "people.emptyDirectory";
}
