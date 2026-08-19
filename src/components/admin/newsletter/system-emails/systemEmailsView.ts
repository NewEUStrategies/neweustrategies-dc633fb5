// Reguły widoku logu maili systemowych.
//
// PO CO OSOBNO. Panel jest jedynym miejscem, w którym operator widzi, czy maile
// systemowe (potwierdzenia, przypomnienia, zaproszenia) faktycznie wyszły.
// Pomyłki są tu ciche, bo panel zawsze coś pokazuje:
//
//   * WSKAŹNIK DORĘCZENIA. `null` (brak danych) to nie to samo co 0% - „0%"
//     w pustym logu czyta się jako awarię wysyłki.
//   * TON ODZNAKI STATUSU. DLQ to jedyny status wymagający reakcji operatora;
//     wspólny ton z „wysłane" schowałby awarię w tłumie zielonych wierszy.
//   * SERIE WYKRESU. Wysłane, nieudane i wstrzymane to trzy różne rzeczy;
//     zlepienie ich pokazuje wzrost tam, gdzie rosną same błędy.
//
// Sentynela „wszystkie", fraza wyszukiwania, liczba stron i znacznik czasu są
// WSPÓLNE z logiem webhooka maili autoryzacyjnych (`../logFilters`) - skopiowane
// rozjechałyby się cicho: jeden panel poprawiony, drugi nie.
import type { SystemEmailDayPoint, SystemEmailStatus } from "@/lib/email/system-log.server";
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

/** Statusy pokazywane w filtrze - kolejność jest kolejnością listy. */
export const STATUSES: readonly SystemEmailStatus[] = ["sent", "pending", "dlq", "suppressed"];

export const PAGE_SIZE = DEFAULT_PAGE_SIZE;

/** Wskaźnik doręczenia jako procent; brak danych to KRESKA, nie „0%". */
export function deliveryRateLabel(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "-";
  return `${(rate * 100).toFixed(1)}%`;
}

/** Ton odznaki statusu. Wysłane na zielono, w kolejce na żółto, DLQ alarmowo. */
export function statusTone(status: SystemEmailStatus): string {
  if (status === "sent") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  if (status === "pending") return "bg-amber-500/10 text-amber-600 border-amber-500/20";
  if (status === "suppressed") return "bg-muted text-muted-foreground border-border";
  return "bg-destructive/10 text-destructive border-destructive/20";
}

/** Etykieta dnia na osi wykresu. Dzień przychodzi jako `YYYY-MM-DD` w UTC. */
export function dayLabel(day: string, locale: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
}

/** Serie wykresu: wysłane / nieudane / wstrzymane, w kolejności dni raportu. */
export function chartValues(series: readonly SystemEmailDayPoint[]): {
  sent: number[];
  failed: number[];
  suppressed: number[];
} {
  return {
    sent: series.map((p) => p.sent),
    failed: series.map((p) => p.failed),
    suppressed: series.map((p) => p.suppressed),
  };
}
