// Wersje robocze KATALOGÓW agendy: ścieżek i sal.
//
// RAZEM, BO TO TA SAMA KLASA FORMULARZA: nazwa, kolejność, przełącznik i jedno
// pole liczbowe. Osobne pliki zdublowałyby konwersję tekstu na liczbę, a
// zdublowana konwersja rozjeżdża się przy pierwszej zmianie limitów.
//
// KLUCZ ŚCIEŻKI JEST NIEZMIENNY PO ZAPISIE - baza go nie czyta przy edycji, więc
// pole w dialogu musi być wtedy zablokowane, a nie „po cichu ignorowane".
//
// PUSTA POJEMNOŚĆ SALI TO BRAK DEKLARACJI, NIE ZERO. Sala na zero osób nie
// przyjmie żadnej sesji; sala bez deklarowanej pojemności przyjmie każdą.
import type {
  EventRoomInput,
  EventRoomRow,
  EventTrackInput,
  EventTrackRow,
} from "@/lib/events/sessionsApi";

export const AGENDA_KEY_PATTERN = /^[a-z][a-z0-9_]{1,48}$/;
export const AGENDA_MAX_NAME = 200;
export const ROOM_MAX_CAPACITY = 100_000;
/** Kolor akcentu ścieżki - `#RRGGBB`, bo tak wraca na publiczną agendę. */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOf(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function intOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// ---------------------------------------------------------------------------
// ŚCIEŻKI
// ---------------------------------------------------------------------------

export interface TrackDraft {
  id: string | null;
  key: string;
  namePl: string;
  nameEn: string;
  /** Pusty tekst = ścieżka bez własnego koloru. */
  accentColor: string;
  sortOrder: string;
  isActive: boolean;
}

export function emptyTrackDraft(sortOrder: number): TrackDraft {
  return {
    id: null,
    key: "",
    namePl: "",
    nameEn: "",
    accentColor: "",
    sortOrder: String(sortOrder),
    isActive: true,
  };
}

export function trackDraftFromRow(row: EventTrackRow): TrackDraft {
  return {
    id: String(row.id),
    key: textOf(row.key),
    namePl: textOf(row.name_pl),
    nameEn: textOf(row.name_en),
    accentColor: textOf(row.accent_color),
    sortOrder: String(numberOf(row.sort_order, 0)),
    isActive: row.is_active !== false,
  };
}

export type TrackFieldError = { field: keyof TrackDraft; messageKey: string };

const TV = "adminEventAgenda.tracks.dialog.validation.";

export function validateTrackDraft(draft: TrackDraft): TrackFieldError[] {
  const errors: TrackFieldError[] = [];
  // Klucz sprawdzamy TYLKO przy tworzeniu - przy edycji nie jest wysyłany.
  if (draft.id === null && !AGENDA_KEY_PATTERN.test(draft.key.trim())) {
    errors.push({ field: "key", messageKey: `${TV}keyRequired` });
  }
  if (draft.namePl.trim() === "")
    errors.push({ field: "namePl", messageKey: `${TV}namesRequired` });
  if (draft.nameEn.trim() === "")
    errors.push({ field: "nameEn", messageKey: `${TV}namesRequired` });
  return errors;
}

export function trackDraftToInput(draft: TrackDraft, eventId: string): EventTrackInput {
  const color = draft.accentColor.trim();
  return {
    id: draft.id,
    eventId,
    key: draft.key.trim(),
    namePl: draft.namePl.trim(),
    nameEn: draft.nameEn.trim(),
    // Kolor spoza wzoru `#RRGGBB` byłby dla publicznej agendy śmieciem w atrybucie
    // `style`, więc zamiast wysyłać go do bazy, zwracamy brak koloru.
    accentColor: HEX_COLOR_PATTERN.test(color) ? color.toLowerCase() : null,
    sortOrder: intOrNull(draft.sortOrder) ?? 100,
    isActive: draft.isActive,
  };
}

// ---------------------------------------------------------------------------
// SALE
// ---------------------------------------------------------------------------

export interface RoomDraft {
  id: string | null;
  name: string;
  /** Pusty tekst = pojemność niezadeklarowana. */
  capacity: string;
  floor: string;
  locationNote: string;
  sortOrder: string;
  isActive: boolean;
}

export function emptyRoomDraft(sortOrder: number): RoomDraft {
  return {
    id: null,
    name: "",
    capacity: "",
    floor: "",
    locationNote: "",
    sortOrder: String(sortOrder),
    isActive: true,
  };
}

export function roomDraftFromRow(row: EventRoomRow): RoomDraft {
  const capacity = row.capacity;
  return {
    id: String(row.id),
    name: textOf(row.name),
    capacity: typeof capacity === "number" ? String(capacity) : "",
    floor: textOf(row.floor),
    locationNote: textOf(row.location_note),
    sortOrder: String(numberOf(row.sort_order, 0)),
    isActive: row.is_active !== false,
  };
}

export type RoomFieldError = { field: keyof RoomDraft; messageKey: string };

const RV = "adminEventAgenda.rooms.dialog.validation.";

export function validateRoomDraft(draft: RoomDraft): RoomFieldError[] {
  const errors: RoomFieldError[] = [];
  if (draft.name.trim() === "") errors.push({ field: "name", messageKey: `${RV}nameRequired` });
  const capacity = intOrNull(draft.capacity);
  if (draft.capacity.trim() !== "" && capacity === null) {
    errors.push({ field: "capacity", messageKey: `${RV}capacityPositive` });
  }
  // Baza wymaga `capacity > 0` - zero to nie „bez limitu", tylko sala bez miejsc.
  if (capacity !== null && (capacity <= 0 || capacity > ROOM_MAX_CAPACITY)) {
    errors.push({ field: "capacity", messageKey: `${RV}capacityPositive` });
  }
  return errors;
}

export function roomDraftToInput(draft: RoomDraft, eventId: string): EventRoomInput {
  return {
    id: draft.id,
    eventId,
    name: draft.name.trim(),
    capacity: intOrNull(draft.capacity),
    floor: trimOrNull(draft.floor),
    locationNote: trimOrNull(draft.locationNote),
    sortOrder: intOrNull(draft.sortOrder) ?? 100,
    isActive: draft.isActive,
  };
}
