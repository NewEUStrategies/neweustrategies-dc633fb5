// Daty pozycji CV - wspólne dla profilu autora (`AuthorCvSections`) i arkusza
// PDF (`CvPrintSheet`). Osobny moduł, nie eksport z pliku komponentu: obie
// strony importują te same reguły, a plik komponentu eksportuje komponenty
// (react-refresh/only-export-components).
import type { TFunction } from "i18next";
import type { AppLang } from "@/lib/i18n/localePath";
import { DATE_ONLY_TIME_ZONE, formatDate } from "@/lib/i18n/format";
// `authorCv.present` - nakładka rejestruje klucz efektem ubocznym importu.
import "@/lib/i18n-author-cv";

/**
 * Miesiąc i rok z kolumny DATE (daty CV nie mają chwili). Formatujemy w UTC -
 * w strefie maszyny „2020-03-01" to w Nowym Jorku jeszcze luty, a serwer (UTC)
 * i przeglądarka czytelnika drukowałyby różne miesiące. Śmieć z bazy -> "".
 */
export function formatCvMonth(
  value: string | null,
  lang: AppLang,
  month: "short" | "long",
): string {
  if (!value) return "";
  return formatDate(`${value.slice(0, 10)}T00:00:00Z`, lang, {
    year: "numeric",
    month,
    timeZone: DATE_ONLY_TIME_ZONE,
  });
}

const dateMs = (value: string | null): number =>
  value ? Date.parse(`${value.slice(0, 10)}T00:00:00Z`) : Number.NaN;

/** Zakres dat pozycji CV - wspólny dla profilu i arkusza PDF. */
export function formatCvDateRange(
  start: string | null,
  end: string | null,
  isCurrent: boolean | null,
  lang: AppLang,
  t: TFunction,
): string {
  // Edytor profilu nie pilnuje kolejności dat, więc odwrócony zakres
  // pokazujemy chronologicznie zamiast „sty 2021 - maj 2018".
  const reversed = !isCurrent && dateMs(end) < dateMs(start);
  const s = formatCvMonth(reversed ? end : start, lang, "short");
  const e = isCurrent
    ? t("authorCv.present")
    : formatCvMonth(reversed ? start : end, lang, "short");
  if (s && e) return `${s} - ${e}`;
  return s || e;
}
