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
//
// GODZINY SĄ ZEGAREM W STREFIE WYDARZENIA, nie przeglądarki (klasa OPS-15).
// Szkic niesie strefę (`timeZone`), w której pola `datetime-local` są
// zapisane, i chwile z bazy (`savedTimes`) - nietknięte pole wraca do bazy co
// do milisekundy. Konwersje: `lib/events/eventLocalInput.ts`.
import {
  canonicalInstant,
  eventLocalInput,
  eventLocalInputToIso,
  type SavedInstants,
} from "@/lib/events/eventLocalInput";
import { eventTimeZone } from "@/lib/events/timezone";
import type {
  EventSessionDetailRow,
  EventSessionInput,
  SessionFormat,
  SessionStatus,
} from "@/lib/events/sessionsApi";
import { SESSION_FORMATS, SESSION_STATUSES } from "@/lib/events/sessionsApi";

export const SESSION_MAX_TITLE = 300;
export const SESSION_MAX_DESCRIPTION = 5000;
export const SESSION_MAX_AFFILIATION = 300;
/** Górna granica limitu miejsc; wyżej to literówka, nie sala. */
export const SESSION_MAX_CAPACITY = 100_000;

export interface SessionDraft {
  /** `null` = nowa sesja; wtedy payload nie wysyła `id`. */
  id: string | null;
  titlePl: string;
  titleEn: string;
  descriptionPl: string;
  descriptionEn: string;
  /** `datetime-local` w strefie `timeZone` - input HTML nie zna dat, tylko znaki. */
  startsAt: string;
  endsAt: string;
  /** Strefa wydarzenia (IANA, zwalidowana), w której pola godzin są zegarem. */
  timeZone: string;
  /** Chwile z bazy, z których powstały pola godzin (edycja); pusto dla nowej sesji. */
  savedTimes: SavedInstants<"startsAt" | "endsAt">;
  format: SessionFormat;
  status: SessionStatus;
  trackId: string | null;
  roomId: string | null;
  sponsorId: string | null;
  affiliationPl: string;
  affiliationEn: string;
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

export function emptySessionDraft(
  sortOrder: number,
  timeZone: string | null | undefined,
): SessionDraft {
  return {
    id: null,
    titlePl: "",
    titleEn: "",
    descriptionPl: "",
    descriptionEn: "",
    startsAt: "",
    endsAt: "",
    timeZone: eventTimeZone({ timezone: timeZone }),
    savedTimes: {},
    format: "onsite",
    status: "draft",
    trackId: null,
    roomId: null,
    sponsorId: null,
    affiliationPl: "",
    affiliationEn: "",
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

/** ISO z bazy -> wartość `datetime-local` w strefie wydarzenia (bez sekund). */
export function toLocalInput(iso: string | null, timeZone: string | null | undefined): string {
  return eventLocalInput(iso, timeZone);
}

/**
 * `datetime-local` w strefie wydarzenia -> ISO albo `null`, gdy pole
 * puste/niepełne. `saved` - chwila z bazy, którą nietknięte pole oddaje bez zmian.
 */
export function fromLocalInput(
  value: string,
  timeZone: string | null | undefined,
  saved: string | null = null,
): string | null {
  return eventLocalInputToIso(value, timeZone, saved);
}

/** Obie godziny szkicu jako chwile - jedno miejsce dla walidacji i payloadu. */
function draftInstants(draft: SessionDraft): { startsAt: string | null; endsAt: string | null } {
  return {
    startsAt: fromLocalInput(draft.startsAt, draft.timeZone, draft.savedTimes.startsAt ?? null),
    endsAt: fromLocalInput(draft.endsAt, draft.timeZone, draft.savedTimes.endsAt ?? null),
  };
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

export function sessionDraftFromRow(
  row: EventSessionDetailRow,
  timeZone: string | null | undefined,
): SessionDraft {
  const capacity = row.capacity;
  const zone = eventTimeZone({ timezone: timeZone });
  const startsAt = canonicalInstant(textOf(row.starts_at));
  const endsAt = canonicalInstant(textOf(row.ends_at));
  return {
    id: String(row.id),
    titlePl: textOf(row.title_pl),
    titleEn: textOf(row.title_en),
    descriptionPl: textOf(row.description_pl),
    descriptionEn: textOf(row.description_en),
    startsAt: toLocalInput(startsAt, zone),
    endsAt: toLocalInput(endsAt, zone),
    timeZone: zone,
    savedTimes: { startsAt, endsAt },
    format: pick(SESSION_FORMATS, textOf(row.format), "onsite"),
    status: pick(SESSION_STATUSES, textOf(row.status), "draft"),
    trackId: typeof row.track_id === "string" ? row.track_id : null,
    roomId: typeof row.room_id === "string" ? row.room_id : null,
    sponsorId: typeof row.sponsor_id === "string" ? row.sponsor_id : null,
    affiliationPl: textOf(row.affiliation_pl),
    affiliationEn: textOf(row.affiliation_en),
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

  const { startsAt, endsAt } = draftInstants(draft);
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

  if (draft.affiliationPl.trim().length > SESSION_MAX_AFFILIATION) {
    errors.push({ field: "affiliationPl", messageKey: `${V}affiliationTooLong` });
  }
  if (draft.affiliationEn.trim().length > SESSION_MAX_AFFILIATION) {
    errors.push({ field: "affiliationEn", messageKey: `${V}affiliationTooLong` });
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
  const { startsAt, endsAt } = draftInstants(draft);
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
    sponsorId: draft.sponsorId,
    affiliationPl: trimOrNull(draft.affiliationPl),
    affiliationEn: trimOrNull(draft.affiliationEn),
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
