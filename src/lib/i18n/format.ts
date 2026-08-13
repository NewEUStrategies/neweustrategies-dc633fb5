// Centralne, świadome języka formatowanie dat i liczb dla powierzchni
// publicznej. Wcześniej ~20 plików robiło własne
// `toLocaleDateString(lang === "en" ? "en-US" : "pl-PL")` (z rozjazdem
// en-US/en-GB włącznie) - jedna definicja locale kończy dryf.
// Konwencja domu: wersja EN formatuje po europejsku (en-GB: dzień-miesiąc-rok),
// spójnie z resztą serwisu - nie en-US.
export type UiLang = "pl" | "en";

const LOCALE: Record<UiLang, string> = { pl: "pl-PL", en: "en-GB" };

export function uiLocale(lang: string | undefined): string {
  return LOCALE[uiLang(lang)];
}

/**
 * Surowe `i18n.language` (moze byc `undefined`, `"en-US"`, `"pl"`) zawezone do
 * dwoch jezykow interfejsu. Potrzebne wszedzie, gdzie wybieramy TRESC
 * z blizniaczych kolumn (`pickLocalized`) albo klucz w mapie `Record<UiLang, …>`.
 *
 * Istnieje, bo bez niego ta sama linia
 * `(i18n.language ?? "pl").startsWith("en") ? "en" : "pl"` powtarza sie
 * w kazdym komponencie - a to jest ta sama decyzja, ktora `uiLocale` juz raz
 * podejmuje. Jedno miejsce, jedna regula normalizacji.
 */
export function uiLang(lang: string | undefined): UiLang {
  return (lang ?? "pl").startsWith("en") ? "en" : "pl";
}

/** Data artykułu/listingu: "12 lipca 2026" / "12 July 2026". */
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

/** Krótka data listingu: "12.07.2026" / "12/07/2026". */
export function formatDateShort(date: string | number | Date, lang: string | undefined): string {
  return formatDate(date, lang, { year: "numeric", month: "numeric", day: "numeric" });
}

/**
 * Data z godziną: "12.07.2026, 14:30" / "12/07/2026, 14:30".
 *
 * Powstało dla dyskusji i moderacji, gdzie sama data nie wystarcza (dwa wpisy
 * z tego samego dnia trzeba móc uszeregować), a `toLocaleString()` bez locale -
 * którego moduł klubów używał w kilkunastu miejscach - daje wynik zależny od
 * ustawień przeglądarki, więc SSR i klient renderują różny tekst.
 */
export function formatDateTime(date: string | number | Date, lang: string | undefined): string {
  return formatDate(date, lang, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
