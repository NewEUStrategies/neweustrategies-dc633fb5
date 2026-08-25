// Odczyt licznikow zapisow z odpowiedzi `admin_event_registrations_counts`.
//
// DLACZEGO OSOBNY MODUL, A NIE RZUTOWANIE W KOMPONENCIE. RPC oddaje `jsonb`,
// wiec typ po stronie klienta jest z definicji ZMYSLONY - nikt go nie sprawdza.
// Rzutowanie w komponencie konczy sie „NaN" wrenderowanym na zakladce statusu po
// pierwszej zmianie nazwy pola w SQL-u, bez jednego bledu w konsoli. Tutaj kazde
// pole przechodzi przez funkcje, ktora zna swoj typ i wartosc awaryjna.
//
// ZERO I NULL TO DWIE ROZNE ODPOWIEDZI:
//   * `0` znaczy „policzono i wyszlo zero" - zero zgloszen oczekujacych;
//   * `null` przy pojemnosci znaczy „wydarzenie NIE MA limitu miejsc". Sklejenie
//     go z zerem pokazywaloby „0 wolnych miejsc" na wydarzeniu bez limitu,
//     czyli komunikat dokladnie odwrotny do prawdy.
import type { Json } from "@/integrations/supabase/types";
import { REGISTRATION_STATUSES, type RegistrationStatus } from "@/lib/events/registrationsApi";

export type RegistrationStatusCounts = Record<RegistrationStatus, number>;

export interface RegistrationCounts {
  /** Liczba wierszy po filtrach, bez filtra statusu. */
  all: number;
  byStatus: RegistrationStatusCounts;
  /** Awansowani z rezerwy, ktorym nie wyslano jeszcze wiadomosci. */
  awaitingNotice: number;
  /** `null` = wydarzenie bez limitu miejsc. */
  capacity: number | null;
  /** `null` = nie ma limitu, wiec nie ma czego odejmowac. */
  seatsLeft: number | null;
}

function record(value: Json): Record<string, Json> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, Json>;
  }
  return {};
}

function count(source: Record<string, Json>, key: string): number {
  const raw = source[key];
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function nullableCount(source: Record<string, Json>, key: string): number | null {
  const raw = source[key];
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export function emptyRegistrationCounts(): RegistrationCounts {
  const byStatus = {} as RegistrationStatusCounts;
  for (const status of REGISTRATION_STATUSES) byStatus[status] = 0;
  return { all: 0, byStatus, awaitingNotice: 0, capacity: null, seatsLeft: null };
}

export function parseRegistrationCounts(input: Json | null | undefined): RegistrationCounts {
  const source = record(input ?? null);
  const byStatus = {} as RegistrationStatusCounts;
  for (const status of REGISTRATION_STATUSES) byStatus[status] = count(source, status);
  return {
    all: count(source, "all"),
    byStatus,
    awaitingNotice: count(source, "awaiting_notice"),
    capacity: nullableCount(source, "capacity"),
    seatsLeft: nullableCount(source, "seats_left"),
  };
}

/**
 * Wypelnienie sali w procentach albo `null`, gdy nie ma limitu miejsc.
 * Zajete = potwierdzone + obecne, bo to te wiersze trzymaja krzeslo.
 */
export function occupancyPct(counts: RegistrationCounts): number | null {
  if (counts.capacity === null || counts.capacity <= 0) return null;
  const taken = counts.byStatus.approved + counts.byStatus.attended;
  return Math.min(100, Math.round((taken / counts.capacity) * 100));
}
