// Reguły widoku logu maili systemowych.
//
// PO CO OSOBNO. Panel jest jedynym miejscem, w którym operator widzi, czy maile
// systemowe (potwierdzenia, przypomnienia, zaproszenia) faktycznie wyszły.
// Pomyłki są tu ciche, bo panel zawsze coś pokazuje:
//
//   * WARTOŚĆ „wszystkie" w filtrze. Radix wywala się na `SelectItem value=""`,
//     więc sentynela musi być napisem - a przy zapisie MUSI wrócić na `null`.
//     Sentynela puszczona dalej jako nazwa szablonu filtruje log do zera i
//     operator widzi „brak wysyłek" tam, gdzie wysyłek są tysiące.
//   * LICZBA STRON. Zero wierszy musi dać JEDNĄ stronę, nie zero - inaczej
//     przycisk „następna" jest aktywny w pustym logu i prowadzi w nicość.
//   * WSKAŹNIK DORĘCZENIA. `null` (brak danych) to nie to samo co 0% - „0%"
//     w pustym logu czyta się jako awarię wysyłki.
import type { SystemEmailDayPoint, SystemEmailStatus } from "@/lib/email/system-log.server";

/** Okna czasowe raportu (dni). */
export const RANGES = [1, 7, 30] as const;
export type Range = (typeof RANGES)[number];

/** Statusy pokazywane w filtrze - kolejność jest kolejnością listy. */
export const STATUSES: readonly SystemEmailStatus[] = ["sent", "pending", "dlq", "suppressed"];

export const PAGE_SIZE = 50;

/**
 * Sentynela „wszystkie" w filtrach.
 *
 * Radix wywala się na `SelectItem value=""`, więc opcja „wszystkie" musi mieć
 * NIEPUSTĄ wartość. Nazwy szablonów przychodzą z bazy, więc sentynela nie może
 * być czymś, co da się pomylić z nazwą.
 */
export const ALL_OPTION = "all";

/** Wartość filtra z listy -> wartość do zapytania (`null` = bez filtra). */
export function filterValue(raw: string): string | null {
  return raw === ALL_OPTION ? null : raw;
}

/** Wartość do wyświetlenia w liście (`null` -> sentynela „wszystkie"). */
export function filterOption(value: string | null): string {
  return value ?? ALL_OPTION;
}

/** Fraza wyszukiwania do zapytania: puste i same spacje znaczą „bez filtra". */
export function searchValue(raw: string): string | null {
  return raw.trim() ? raw.trim() : null;
}

/**
 * Liczba stron. Pusty log ma JEDNĄ stronę - zero stron zapaliłoby „następna"
 * w pustym widoku.
 */
export function totalPages(rowsTotal: number, pageSize: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(rowsTotal / pageSize));
}

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

/** Znacznik czasu wiersza; brak daty to KRESKA, nie „Invalid Date". */
export function rowTimestamp(createdAt: string | null | undefined, locale: string): string {
  if (!createdAt) return "-";
  return new Date(createdAt).toLocaleString(locale, {
    dateStyle: "short",
    timeStyle: "short",
  });
}
