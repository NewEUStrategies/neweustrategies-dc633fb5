// Atrapa dla KONTROLI DODATNIEJ bramki pauzy (`i18nOverlayDashGate.test.ts`).
//
// NIE jest słownikiem: nie rejestruje się w i18next, nie eksportuje kluczy
// i nie jest importowana przez kod produkcyjny. Jedyny znak U+2014 w linii
// niżej jest tu CELOWY - bez niego asercja „narzędzie widzi pauzę" nie
// dowodziłaby niczego, a bramka mogłaby świecić na zielono, nie sprawdzając
// nic. Znak jest wpisany DOSŁOWNIE, nie jako `\u2014`: skan czyta ŹRÓDŁO,
// więc sekwencja ucieczki przeszłaby obok niego.
export const dashFixture = { withDash: "przed — po" };
