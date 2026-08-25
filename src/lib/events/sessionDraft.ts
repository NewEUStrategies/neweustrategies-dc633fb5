// Wersja robocza SESJI: wiersz bazy <-> pola formularza <-> payload RPC.
//
// DLACZEGO OSOBNY MODUŁ, A NIE STAN W DIALOGU. Formularz sesji ma dwadzieścia
// pól, z czego dwa to daty, trzy liczby, a sześć przełączników wpływających na
// siebie (limit miejsc wymaga zapisów). Konwersja rozsypana po `onChange` daje
// `NaN` w payloadzie i odmowę CHECK-a bez nazwy pola.
//
// PUSTY LIMIT TO BRAK LIMITU, NIE ZERO. `capacity = 0` znaczy sesję bez ani
// jednego miejsca, `capacity = null` - bez limitu. Sklejenie obu zamknęłoby
// zapisy na sesję, która miała ich nie ograniczać.
//
// WALIDACJA ODCINA ZAPIS PRZED ŻĄDANIEM. Każdy warunek, który baza sprawdza
// CHECK-iem albo `RAISE`, ma tu odpowiednik z kluczem komunikatu przy polu -
// odmowa `23514` nie mówi organizatorowi, które z dwudziestu pól poprawić.
import type {
  EventSessionDetailRow,
  EventSessionInput,
  SessionFormat,
  SessionStatus,
} from "@/lib/events/sessionsApi";
import { SESSION_FORMATS, SESSION_STATUSES } from "@/lib/events/sessionsApi";

export const SESSION_MAX_TITLE = 300;
export const SESSION_MAX_DESCRIPTION = 5000;
/** Górna granica limitu miejsc; wyżej to literówka, nie sala. */
export const SESSION_MAX_CAPACITY = 100_000;

export interface SessionDraft {
  /** `null` = nowa sesja; wtedy payload nie wysyła `id`. */
  id: string | null;
  titlePl: string;
  titleEn: string;
  descriptionPl: string;
  descriptionEn: string;
  /** `datetime-local` - input HTML nie zna dat, tylko znaki. */
  startsAt: string;
  endsAt: string;
  format: SessionFormat;
  status: SessionStatus;
  trackId: string | null;
  roomId: string | null;
  parentSessionId: string | null;
  requiresSignup: boolean;
  /** Pusty tekst = bez limitu miejsc. */
  capacity: string;
  minTierRank: string;
  chathamHouse: boolean;
  isPrivate: boolean;
  allowOverlap: boolean;
  streamUrl: string;
  recordingUrl: string;
  sortOrder: string;
}

export function emptySessionDraft(sortOrder: number): SessionDraft {
  return {
    id: null,
    titlePl: "",
    titleEn: "",
    descriptionPl: "",
    descriptionEn: "",
    startsAt: "",
    endsAt: "",
    format: "onsite",
    status: "draft",
    trackId: null,
    roomId: null,
    parentSessionId: null,
    requiresSignup: false,
    capacity: "",
    minTierRank: "0",
    chathamHouse: false,
    isPrivate: false,
    allowOverlap: true,
    streamUrl: "",
    recordingUrl: "",
    sortOrder: String(sortOrder),
  };
}

/** ISO z bazy -> wartość `datetime-local` (bez sekund, w czasie przeglądarki). */
export function toLocalInput(iso: string | null): string {
  if (iso === null || iso === "") return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** `datetime-local` -> ISO albo `null`, gdy pole puste/niepełne. */
export function fromLocalInput(value: string): string | null {
  if (value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function pick<T extends string>(allowed: readonly T[], value: string, fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOf(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function sessionDraftFromRow(row: EventSessionDetailRow): SessionDraft {
  const capacity = row.capacity;
  return {
    id: String(row.id),
    titlePl: textOf(row.title_pl),
    titleEn: textOf(row.title_en),
    descriptionPl: textOf(row.description_pl),
    descriptionEn: textOf(row.description_en),
    startsAt: toLocalInput(textOf(row.starts_at) || null),
    endsAt: toLocalInput(textOf(row.ends_at) || null),
    format: pick(SESSION_FORMATS, textOf(row.format), "onsite"),
    status: pick(SESSION_STATUSES, textOf(row.status), "draft"),
    trackId: typeof row.track_id === "string" ? row.track_id : null,
    roomId: typeof row.room_id === "string" ? row.room_id : null,
    parentSessionId: typeof row.parent_session_id === "string" ? row.parent_session_id : null,
    requiresSignup: row.requires_signup === true,
    // Kolumna jest NULL-owalna, a wygenerowany typ podaje liczbę - brak limitu
    // przychodzi jako `null` i MUSI zostać pustym polem, nie zerem.
    capacity: typeof capacity === "number" ? String(capacity) : "",
    minTierRank: String(numberOf(row.min_tier_rank, 0)),
    chathamHouse: row.chatham_house === true,
    isPrivate: row.is_private === true,
    // Domyślnie zgoda jest włączona; `false` blokuje nachodzenie zapisów.
    allowOverlap: row.allow_overlap !== false,
    streamUrl: textOf(row.stream_url),
    recordingUrl: textOf(row.recording_url),
    sortOrder: String(numberOf(row.sort_order, 0)),
  };
}

function intOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

export type SessionFieldError = { field: keyof SessionDraft; messageKey: string };

const V = "adminEventAgenda.sessionDialog.validation.";

/** Warunki, które baza sprawdza CHECK-iem - odmowa `23514` nie wskazuje pola. */
export function validateSessionDraft(draft: SessionDraft): SessionFieldError[] {
  const errors: SessionFieldError[] = [];

  if (draft.titlePl.trim() === "")
    errors.push({ field: "titlePl", messageKey: `${V}titleRequired` });
  if (draft.titleEn.trim() === "")
    errors.push({ field: "titleEn", messageKey: `${V}titleRequired` });

  const startsAt = fromLocalInput(draft.startsAt);
  const endsAt = fromLocalInput(draft.endsAt);
  if (startsAt === null) errors.push({ field: "startsAt", messageKey: `${V}timesRequired` });
  if (endsAt === null) errors.push({ field: "endsAt", messageKey: `${V}timesRequired` });
  if (startsAt !== null && endsAt !== null && Date.parse(endsAt) <= Date.parse(startsAt)) {
    errors.push({ field: "endsAt", messageKey: `${V}endBeforeStart` });
  }

  const capacity = intOrNull(draft.capacity);
  if (draft.capacity.trim() !== "" && capacity === null) {
    errors.push({ field: "capacity", messageKey: `${V}capacityNegative` });
  }
  if (capacity !== null && (capacity < 0 || capacity > SESSION_MAX_CAPACITY)) {
    errors.push({ field: "capacity", messageKey: `${V}capacityNegative` });
  }
  // `capacity_requires_signup` z migracji: limit bez zapisów nie ma czego liczyć.
  if (capacity !== null && !draft.requiresSignup) {
    errors.push({ field: "capacity", messageKey: `${V}capacityNeedsSignup` });
  }

  for (const field of ["streamUrl", "recordingUrl"] as const) {
    const value = draft[field].trim();
    if (value !== "" && !value.startsWith("https://")) {
      errors.push({ field, messageKey: `${V}urlNotHttps` });
    }
  }

  return errors;
}

/** Szkic -> payload RPC. Wołane TYLKO po pustej walidacji. */
export function sessionDraftToInput(draft: SessionDraft, eventId: string): EventSessionInput {
  const startsAt = fromLocalInput(draft.startsAt);
  const endsAt = fromLocalInput(draft.endsAt);
  if (startsAt === null || endsAt === null) {
    throw new Error("sessionDraftToInput: szkic bez godzin - najpierw walidacja");
  }
  const trimOrNull = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  };
  return {
    id: draft.id,
    eventId,
    titlePl: draft.titlePl.trim(),
    titleEn: draft.titleEn.trim(),
    descriptionPl: draft.descriptionPl.trim(),
    descriptionEn: draft.descriptionEn.trim(),
    startsAt,
    endsAt,
    format: draft.format,
    status: draft.status,
    trackId: draft.trackId,
    roomId: draft.roomId,
    parentSessionId: draft.parentSessionId,
    requiresSignup: draft.requiresSignup,
    capacity: intOrNull(draft.capacity),
    minTierRank: intOrNull(draft.minTierRank) ?? 0,
    chathamHouse: draft.chathamHouse,
    isPrivate: draft.isPrivate,
    allowOverlap: draft.allowOverlap,
    streamUrl: trimOrNull(draft.streamUrl),
    recordingUrl: trimOrNull(draft.recordingUrl),
    sortOrder: intOrNull(draft.sortOrder) ?? 100,
  };
}
