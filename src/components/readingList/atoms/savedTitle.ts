// Tytuł zapisanej pozycji w języku interfejsu, z zapasem na drugi język.
//
// ATOM: czysta funkcja prezentacji, bez I/O.
//
// DLACZEGO NIE `pickLocalized` Z `lib/i18n`. Kanoniczny picker traktuje ciąg
// z samych spacji jako PUSTY i zwraca wartość dosłownie; tutaj obowiązuje
// starsza, słabsza reguła (`title_pl || title_en`), w której " " jest wartością
// niepustą. Podmiana reguły zmieniłaby to, co czytelnik widzi na liście
// zapisanych stron dla tytułu z samych spacji - to zmiana ZACHOWANIA, a nie
// refaktor, więc zostaje na osobną decyzję.

/** Para kolumn tytułu w kształcie, w jakim przychodzi z bazy. */
export interface LocalizedTitleRow {
  title_pl: string | null;
  title_en: string | null;
}

/** Tytuł wpisu/strony: język interfejsu, potem drugi język. */
export function localizedTitle(row: LocalizedTitleRow, lang: "pl" | "en"): string | null {
  return lang === "en" ? row.title_en || row.title_pl : row.title_pl || row.title_en;
}

/**
 * Tytuł ZAPISANEJ STRONY. Ostatnim zapasem jest slug: pozycja bez tytułu
 * w żadnym języku musi zostać klikalna, bo czytelnik sam ją tu dodał.
 */
export function savedPageTitle(
  page: LocalizedTitleRow & { slug: string },
  lang: "pl" | "en",
): string {
  return localizedTitle(page, lang) || page.slug;
}
