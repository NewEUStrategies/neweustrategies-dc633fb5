// Centralne, świadome języka formatowanie dat i liczb dla powierzchni
// publicznej. Wcześniej ~20 plików robiło własne
// `toLocaleDateString(lang === "en" ? "en-US" : "pl-PL")` (z rozjazdem
// en-US/en-GB włącznie) - jedna definicja locale kończy dryf.
export type UiLang = "pl" | "en";

const LOCALE: Record<UiLang, string> = { pl: "pl-PL", en: "en-US" };

export function uiLocale(lang: string | undefined): string {
  return LOCALE[(lang ?? "pl").startsWith("en") ? "en" : "pl"];
}

/** Data artykułu/listingu: "12 lipca 2026" / "July 12, 2026". */
export function formatDate(
  date: string | number | Date,
  lang: string | undefined,
  opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" },
): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(uiLocale(lang), opts).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Krótka data listingu: "12.07.2026" / "7/12/2026". */
export function formatDateShort(date: string | number | Date, lang: string | undefined): string {
  return formatDate(date, lang, { year: "numeric", month: "numeric", day: "numeric" });
}

export function formatNumber(
  value: number,
  lang: string | undefined,
  opts?: Intl.NumberFormatOptions,
): string {
  try {
    return new Intl.NumberFormat(uiLocale(lang), opts).format(value);
  } catch {
    return String(value);
  }
}
