// Time formatting for chat surfaces (list timestamps, day separators).
export type ChatLang = "pl" | "en";

const locale = (lang: ChatLang) => (lang === "en" ? "en-US" : "pl-PL");

/** Compact relative time for conversation lists ("5 min", "2 h", "3 d"). */
export function relTime(iso: string, lang: ChatLang): string {
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: "auto", style: "narrow" });
  const then = new Date(iso).getTime();
  const diff = (then - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 604800) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(iso).toLocaleDateString(locale(lang), { day: "numeric", month: "short" });
}

/** Bubble timestamp - local clock time. */
export function clockTime(iso: string, lang: ChatLang): string {
  return new Date(iso).toLocaleTimeString(locale(lang), { hour: "2-digit", minute: "2-digit" });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Day separator label ("Dzisiaj" / "Wczoraj" / localized date). The
 * today/yesterday words come from i18n so callers pass them in.
 */
export function dayLabel(
  iso: string,
  lang: ChatLang,
  words: { today: string; yesterday: string },
): string {
  const date = new Date(iso);
  const now = new Date();
  if (isSameDay(date, now)) return words.today;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return words.yesterday;
  return date.toLocaleDateString(locale(lang), {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** True when two ISO timestamps fall on different calendar days. */
export function crossesDay(prevIso: string | undefined, iso: string): boolean {
  if (!prevIso) return true;
  return !isSameDay(new Date(prevIso), new Date(iso));
}

/** Messages sent within this window collapse into one visual group. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function sameGroup(prevIso: string | undefined, iso: string): boolean {
  if (!prevIso) return false;
  return new Date(iso).getTime() - new Date(prevIso).getTime() < GROUP_WINDOW_MS;
}
