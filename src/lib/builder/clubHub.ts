// Czysty model widgetu „club-hub" (Klub: strona) - sekcje artykułów,
// komentarzy i zapisów w jednym bloku buildera.
//
// PO CO OSOBNY MODUŁ. Widget odwzorowuje stronę klubu z panelu (`/club/$slug`),
// więc ma trzy niezależne listy i trzy niezależne limity. Cała ta arytmetyka
// (co jest włączone, ile pozycji, jak brzmi data i skrót treści) jest czysta -
// nie potrzebuje DOM-u, Supabase ani React-a, a dzięki temu daje się sprawdzić
// testem jednostkowym, zamiast „wychodzić jakoś" przy renderze.
//
// JĘZYK JEST TABLICĄ, nie warunkiem `lang === "pl" ? … : …` - warunek po języku
// omija bramkę parytetu PL/EN i zamyka drogę do trzeciego języka.

/** Sekcje widgetu w kolejności, w jakiej stoją na stronie klubu w panelu. */
export const CLUB_HUB_SECTIONS = ["articles", "comments", "signups"] as const;
export type ClubHubSection = (typeof CLUB_HUB_SECTIONS)[number];

/** Wartości domyślne - te same liczby siedzą w `WIDGET_SCHEMAS` i w rejestrze. */
export const CLUB_HUB_DEFAULTS = {
  articlesLimit: 4,
  commentsLimit: 3,
  signupsLimit: 6,
  /** Platformowe 6 px zamiast `rounded-lg`. */
  radius: 6,
  /** Skrót treści komentarza - tyle znaków mieści się w dwóch wierszach. */
  excerptChars: 160,
} as const;

/** Twarde widełki limitu: 0 pozycji to sekcja-widmo, 12 to już osobna strona. */
export const CLUB_HUB_LIMIT_MIN = 1;
export const CLUB_HUB_LIMIT_MAX = 12;

export function clubHubLimit(raw: number, fallback: number): number {
  const value = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : fallback;
  return Math.min(Math.max(value, CLUB_HUB_LIMIT_MIN), CLUB_HUB_LIMIT_MAX);
}

const DATE_FORMAT: Record<"pl" | "en", Intl.DateTimeFormatOptions & { locale: string }> = {
  pl: { locale: "pl-PL", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" },
  en: { locale: "en-GB", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" },
};

/**
 * Znacznik czasu z bazy sprowadzony do napisu dla człowieka w języku WIDOKU.
 * Strefa jest przypięta do UTC, żeby data nie przeskakiwała o dobę zależnie od
 * tego, gdzie stoi serwer renderujący SSR.
 */
export function formatClubHubDate(raw: string | null, lang: "pl" | "en"): string {
  const value = (raw ?? "").trim();
  if (value === "") return "";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";
  const { locale, ...options } = DATE_FORMAT[lang];
  return new Intl.DateTimeFormat(locale, options).format(new Date(time));
}

/** Atrybut `datetime` dla `<time>`; pusty napis, gdy wartość nie jest datą. */
export function clubHubDateAttr(raw: string | null): string {
  const value = (raw ?? "").trim();
  if (value === "") return "";
  const time = Date.parse(value);
  return Number.isNaN(time) ? "" : new Date(time).toISOString();
}

/**
 * Skrót treści komentarza: białe znaki spłaszczone do pojedynczych spacji,
 * cięcie na granicy słowa, wielokropek TYLKO gdy faktycznie ucięto.
 */
export function clubHubExcerpt(
  body: string,
  max: number = CLUB_HUB_DEFAULTS.excerptChars,
): string {
  const flat = body.replace(/\s+/gu, " ").trim();
  const limit = Math.max(max, 1);
  if (flat.length <= limit) return flat;
  const head = flat.slice(0, limit);
  const cut = head.lastIndexOf(" ");
  return `${(cut > limit / 2 ? head.slice(0, cut) : head).trimEnd()}…`;
}

/** Inicjały do awatara zastępczego (bez zdjęcia w profilu). */
export function clubHubInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/u)
    .filter((part) => part.length > 0);
  if (parts.length === 0) return "?";
  const letters = parts.slice(0, 2).map((part) => [...part][0] ?? "");
  return letters.join("").toLocaleUpperCase("pl-PL");
}
