// Fragment „czego szukam" z profilu, w języku interfejsu, z zapasem na drugi.
//
// ATOM: czysta funkcja, bez I/O i bez Reacta.
//
// TO NIE JEST DŁUG I18N. Zwracana wartość to TREŚĆ WPISANA PRZEZ UŻYTKOWNIKA
// (kolumny `profiles.seeking_pl` / `seeking_en`), a nie kopia interfejsu -
// w słowniku i18n nie ma dla niej miejsca i nie ma czego zwracać jako klucz.
// Funkcja wybiera KOLUMNĘ, a nie napis aplikacji.
//
// TYP WEJŚCIA JEST SZERSZY NIŻ WYGENEROWANY `PersonHit` (`string | null`
// zamiast `string`), i to jest celowe: RPC `search_people` deklaruje te kolumny
// jako `text`, ale baza zwraca w nich NULL dla profilu, który nic nie wpisał -
// wygenerowane typy Supabase nie odwzorowują nullowalności kolumn RPC. Zapas
// `?? ""` w kodzie istniał właśnie dlatego; szerszy typ pozwala go PRZETESTOWAĆ
// bez ani jednego rzutowania.
export interface SeekingSource {
  seeking_pl: string | null;
  seeking_en: string | null;
}

/**
 * Tekst do pokazania albo `null`, gdy nie ma czego pokazywać.
 *
 * Wartość jest OBCIĘTA z białych znaków (`trim`), więc profil z samymi spacjami
 * nie zostawia na karcie pustej linii - dlatego to nie jest `pickPair`
 * z `lib/i18n/pickLocalized`, który zwraca wartość dosłownie.
 */
export function seekingText(person: SeekingSource, lang: string): string | null {
  const primary = lang === "en" ? person.seeking_en : person.seeking_pl;
  const secondary = lang === "en" ? person.seeking_pl : person.seeking_en;
  const value = (primary ?? "").trim() || (secondary ?? "").trim();
  return value.length > 0 ? value : null;
}
