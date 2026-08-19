// Reguły widoku logu webhooka maili autoryzacyjnych.
//
// PO CO OSOBNO. To diagnostyka jednej konkretnej awarii: użytkownik nie dostaje
// linku do resetu hasła albo dostaje go w złym języku. Panel odpowiada na
// pytanie „czy webhook w ogóle dostał zdarzenie i jaki język wybrał" - i jest
// jedynym miejscem, w którym to widać.
//
// Reguły, których pomyłka jest cicha:
//   * TON ODZNAKI STATUSU. „odrzucony" (webhook zadziałał, ale odmówił) i
//     „nieudany" (webhook się wywalił) wymagają różnych reakcji operatora;
//     wspólny ton zlepia je w jedno.
//   * JĘZYK WIERSZA. Brak języka to KRESKA, nie puste pole - puste pole czyta
//     się jako „polski", a to właśnie tego dotyczy cała diagnostyka.
//   * ŹRÓDŁO JĘZYKA. Wiersz z językiem WYWNIOSKOWANYM (fallback) jest
//     wyróżniony - to on tłumaczy, dlaczego użytkownik dostał maila po polsku.
//
// Filtry i stronicowanie są WSPÓLNE z logiem maili systemowych (`../logFilters`).
import type { AuthEventStatus } from "@/lib/auth-email-events.functions";
import { DEFAULT_PAGE_SIZE } from "../logFilters";

export {
  ALL_OPTION,
  filterOption,
  filterValue,
  rowTimestamp,
  searchValue,
  totalPages,
} from "../logFilters";

/** Okna czasowe raportu (dni). */
export const RANGES = [1, 7, 30] as const;
export type Range = (typeof RANGES)[number];

/** Typy maili autoryzacyjnych, jakie potrafi wysłać webhook. */
export const TYPES = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "reauthentication",
] as const;

/** Statusy zdarzenia webhooka - kolejność jest kolejnością listy filtra. */
export const STATUSES: readonly AuthEventStatus[] = ["enqueued", "rejected", "failed"];

export const PAGE_SIZE = DEFAULT_PAGE_SIZE;

/**
 * Ton odznaki statusu. „Zakolejkowany" na zielono, „odrzucony" ostrzegawczo
 * (webhook zadziałał, ale odmówił - to zwykle konfiguracja), „nieudany"
 * alarmowo (webhook się wywalił - użytkownik NIE dostał maila).
 */
export function statusTone(status: AuthEventStatus): string {
  if (status === "enqueued") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  if (status === "rejected") return "bg-amber-500/10 text-amber-600 border-amber-500/20";
  return "bg-destructive/10 text-destructive border-destructive/20";
}

/** Język wiersza; brak języka to KRESKA - puste pole czyta się jako „polski". */
export function langLabel(lang: string | null | undefined): string {
  return lang ?? "-";
}

/** Klucz tłumaczenia źródła języka; nieznane źródło ma awaryjny podpis. */
export function langSourceKey(source: string | null | undefined): {
  key: string;
  fallbackText: string;
} {
  return {
    key: `authEmailLogs.sources.${source ?? "unknown"}`,
    fallbackText: source ?? "-",
  };
}
