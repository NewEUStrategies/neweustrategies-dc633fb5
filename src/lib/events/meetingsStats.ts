// Odczyt statystyk gieldy spotkan 1-1 z odpowiedzi `admin_event_meeting_stats`.
//
// DLACZEGO OSOBNY MODUL, A NIE `as` W KOMPONENCIE. RPC oddaje `jsonb`, wiec typ
// po stronie klienta jest z definicji ZMYSLONY - nikt go nie sprawdza. Rzutowanie
// w komponencie znaczy, ze pierwsza zmiana nazwy pola w SQL-u konczy sie
// `undefined` wrenderowanym jako "NaN%" na ekranie organizatora, bez jednego
// bledu w konsoli. Tutaj kazde pole przechodzi przez funkcje, ktora zna swoj typ
// i ma zdefiniowana wartosc awaryjna - a brak pola degraduje do zera albo do
// `null`, nigdy do wysypanego ekranu.
//
// ZERO I NULL TO DWIE ROZNE ODPOWIEDZI, i modul ich nie skleja:
//   * `0` znaczy "policzono i wyszlo zero" - zero potwierdzonych spotkan;
//   * `null` znaczy "NIE MA Z CZEGO LICZYC" - wskaznik akceptacji przy zerze
//     rozstrzygnietych zaproszen nie wynosi 0%, tylko nie istnieje. RPC celowo
//     zwraca tam SQL-owy NULL, wiec sklejenie go z zerem zamienialoby "jeszcze
//     nikt nie odpowiedzial" w "wszyscy odmowili".
//
// KOLEJNOSC NIE JEST SORTOWANA PONOWNIE. `by_day` i `tables` przychodza juz
// uporzadkowane przez baze (dzien rosnaco, stoliki po `sort_order`), a drugie
// sortowanie po stronie klienta rozjezdzalo by sie z lista stolikow w zakladce
// obok przy pierwszej zmianie regul w SQL-u.
import type { Json } from "@/integrations/supabase/types";

/** Obciazenie jednego stolika policzone przez baze. */
export interface MeetingTableUtilisation {
  tableId: string;
  label: string;
  zone: string | null;
  capacity: number;
  isActive: boolean;
  slotsTaken: number;
  slotsCapacity: number;
  /** `null`, gdy nie ma siatki slotow - nie ma czego dzielic. */
  utilisationPct: number | null;
}

/** Rozklad spotkan w jednym dniu gieldy (data w strefie wydarzenia). */
export interface MeetingDayLoad {
  day: string;
  confirmed: number;
  invited: number;
  total: number;
}

/** Uczestnik bez ani jednego spotkania - lista robocza, nie metryka. */
export interface MeetingLonelyParticipant {
  registrationId: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  company: string | null;
  hasAvailability: boolean;
}

export interface MeetingStats {
  total: number;
  invited: number;
  expired: number;
  accepted: number;
  declined: number;
  cancelled: number;
  rescheduled: number;
  held: number;
  noShow: number;
  confirmed: number;
  /** Procent 0-100 albo `null`, gdy nie ma rozstrzygnietych zaproszen. */
  acceptanceRate: number | null;
  /** Procent 0-100 albo `null`, gdy organizator nic jeszcze nie odznaczyl. */
  attendanceRate: number | null;
  gridSlots: number;
  seatsCount: number;
  timezone: string;
  participantsCount: number;
  withAvailabilityCount: number;
  withoutAvailabilityCount: number;
  withMeetingCount: number;
  withoutMeetingCount: number;
  tables: MeetingTableUtilisation[];
  byDay: MeetingDayLoad[];
  withoutMeeting: MeetingLonelyParticipant[];
}

export const EMPTY_MEETING_STATS: MeetingStats = {
  total: 0,
  invited: 0,
  expired: 0,
  accepted: 0,
  declined: 0,
  cancelled: 0,
  rescheduled: 0,
  held: 0,
  noShow: 0,
  confirmed: 0,
  acceptanceRate: null,
  attendanceRate: null,
  gridSlots: 0,
  seatsCount: 0,
  timezone: "Europe/Warsaw",
  participantsCount: 0,
  withAvailabilityCount: 0,
  withoutAvailabilityCount: 0,
  withMeetingCount: 0,
  withoutMeetingCount: 0,
  tables: [],
  byDay: [],
  withoutMeeting: [],
};

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : null;
}

function int(source: Bag, key: string): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** Procent albo `null`. Wartosc spoza 0-100 jest odrzucana - to nie jest procent. */
function pct(source: Bag, key: string): number | null {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return Math.round(value);
}

function str(source: Bag, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function flag(source: Bag, key: string): boolean {
  return source[key] === true;
}

function list(source: Bag, key: string): Bag[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  const out: Bag[] = [];
  for (const item of value) {
    const row = bag(item);
    if (row !== null) out.push(row);
  }
  return out;
}

/**
 * Zamienia surowa odpowiedz RPC na typowany zestaw liczb.
 *
 * Wiersz bez identyfikatora jest POMIJANY, a nie renderowany z pustym kluczem:
 * lista Reacta bez stabilnego klucza to bug, ktory ujawnia sie dopiero przy
 * sortowaniu, a stolik bez `table_id` i tak nie da sie kliknac.
 */
export function parseMeetingStats(raw: Json | null | undefined): MeetingStats {
  const root = bag(raw);
  if (root === null) return EMPTY_MEETING_STATS;

  const tables: MeetingTableUtilisation[] = [];
  for (const row of list(root, "tables")) {
    const tableId = str(row, "table_id");
    if (tableId === null) continue;
    tables.push({
      tableId,
      label: str(row, "label") ?? "",
      zone: str(row, "zone"),
      capacity: int(row, "capacity"),
      isActive: flag(row, "is_active"),
      slotsTaken: int(row, "slots_taken"),
      slotsCapacity: int(row, "slots_capacity"),
      utilisationPct: pct(row, "utilisation_pct"),
    });
  }

  const byDay: MeetingDayLoad[] = [];
  for (const row of list(root, "by_day")) {
    const day = str(row, "day");
    if (day === null) continue;
    byDay.push({
      day,
      confirmed: int(row, "confirmed"),
      invited: int(row, "invited"),
      total: int(row, "total"),
    });
  }

  const withoutMeeting: MeetingLonelyParticipant[] = [];
  for (const row of list(root, "without_meeting")) {
    const registrationId = str(row, "registration_id");
    if (registrationId === null) continue;
    withoutMeeting.push({
      registrationId,
      firstName: str(row, "first_name"),
      lastName: str(row, "last_name"),
      jobTitle: str(row, "job_title"),
      company: str(row, "company"),
      hasAvailability: flag(row, "has_availability"),
    });
  }

  return {
    total: int(root, "total"),
    invited: int(root, "invited"),
    expired: int(root, "expired"),
    accepted: int(root, "accepted"),
    declined: int(root, "declined"),
    cancelled: int(root, "cancelled"),
    rescheduled: int(root, "rescheduled"),
    held: int(root, "held"),
    noShow: int(root, "no_show"),
    confirmed: int(root, "confirmed"),
    acceptanceRate: pct(root, "acceptance_rate"),
    attendanceRate: pct(root, "attendance_rate"),
    gridSlots: int(root, "grid_slots"),
    seatsCount: int(root, "seats_count"),
    timezone: str(root, "timezone") ?? EMPTY_MEETING_STATS.timezone,
    participantsCount: int(root, "participants_count"),
    withAvailabilityCount: int(root, "with_availability_count"),
    withoutAvailabilityCount: int(root, "without_availability_count"),
    withMeetingCount: int(root, "with_meeting_count"),
    withoutMeetingCount: int(root, "without_meeting_count"),
    tables,
    byDay,
    withoutMeeting,
  };
}

/** Pelne imie i nazwisko uczestnika albo `null`, gdy baza nie ma ani jednego czlonu. */
export function participantName(person: {
  firstName: string | null;
  lastName: string | null;
}): string | null {
  const name = [person.firstName, person.lastName]
    .filter((part) => part !== null)
    .join(" ")
    .trim();
  return name.length > 0 ? name : null;
}
