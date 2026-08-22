// „Dlaczego to widzę": wybór JEDNEGO powodu rekomendacji do pokazania na karcie.
//
// ATOM i18n-POPRAWNY: funkcja zwraca KLUCZ słownika, nigdy gotowy tekst -
// tłumaczenie robi komponent. Dzięki temu bramka parytetu PL/EN ma co
// porównywać, a asercje testów stoją na kluczach.
//
// KOLEJNOŚĆ = PRIORYTET. Karta pokazuje najbardziej OSOBISTY powód (obserwowany
// autor bije obserwowaną kategorię, kategoria bije tag), żeby nie tonęła
// w metadanych. RPC zwraca `reasons` jako tablicę bez gwarancji kolejności,
// więc priorytet musi być po stronie klienta.

/** Powody w kolejności ważności dla czytelnika. */
export const REASON_PRIORITY = ["author", "category", "tag", "history", "fresh"] as const;

/**
 * Klucz etykiety dla najistotniejszego powodu albo `null`, gdy powodów nie ma
 * (feed obserwowanych bez `reasons`) lub żaden nie jest rozpoznawany - nieznany
 * kod z nowszej wersji RPC ma NIE renderować pustego badge'a.
 */
export function reasonBadgeKey(reasons?: readonly string[]): string | null {
  const reason = REASON_PRIORITY.find((candidate) => (reasons ?? []).includes(candidate));
  return reason ? `readingList.reasons.${reason}` : null;
}
