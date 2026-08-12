// Kanoniczny znacznik BCP-47 do formatowania dat i liczb.
//
// STAN ZASTANY. Ten sam wybór („po polsku czy po angielsku?") był rozsypany po
// repo w kilkunastu kopiach dwóch wariantów zapisu - `isPl ? "pl-PL" : "en-GB"`
// w komponentach oraz `lang === "en" ? "en-GB" : "pl-PL"` w bibliotekach
// (`lib/access/metering.ts`, `lib/chat/time.ts`). Kopie nie są niewinne: to
// jedyne miejsce, w którym wybrany JĘZYK INTERFEJSU zamienia się na REGION
// formatowania, a rozjazd między nimi daje tę samą datę w dwóch formatach na
// jednym ekranie. Przy trzecim języku trzeba by je wszystkie znaleźć.
//
// Wybór regionu jest decyzją, nie przypadkiem: `en-GB` (a nie `en-US`), bo
// odbiorcą wersji angielskiej jest kontekst europejski - dzień przed miesiącem
// i zegar 24-godzinny, jak w polskiej wersji. Formaty różnią się wtedy
// separatorem i nazwami miesięcy, a nie kolejnością pól.
export type UiLang = "pl" | "en";

/** BCP-47 dla `toLocaleString` / `Intl.*` na podstawie języka interfejsu. */
export function dateLocale(lang: UiLang): "pl-PL" | "en-GB" {
  return lang === "en" ? "en-GB" : "pl-PL";
}

/**
 * Wariant dla miejsc, które mają pod ręką surowe `i18n.language` (może być
 * `undefined`, `"en-US"`, `"pl"`), a nie zawężony typ.
 */
export function dateLocaleFromLanguage(language: string | undefined): "pl-PL" | "en-GB" {
  return (language ?? "pl").startsWith("en") ? "en-GB" : "pl-PL";
}
