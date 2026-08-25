// Szkic konfiguracji gieldy 1-1: stan formularza i jego walidacja.
//
// PO CO ODDZIELNY MODUL. Formularz konfiguracji ma dwadziescia pol, z ktorych
// polowa to liczby wpisywane recznie. Pole liczbowe w Reakcie MUSI trzymac
// napis, nie liczbe - inaczej skasowanie ostatniej cyfry daje `NaN` i input
// przestaje reagowac. Rownoczesnie baza przyjmuje liczby. Ten modul jest
// jedynym miejscem, w ktorym te dwa swiaty sie spotykaja, i jedynym, ktore
// wie, ktore wartosci sa sensowne. Dzieki temu regula "przerwa nie moze byc
// dluzsza od slotu" jest sprawdzalna testem, a nie ukryta w komponencie.
//
// WALIDUJEMY TO, CZEGO BAZA NIE POWIE PO LUDZKU. RPC odrzuci zla strefe czasowa
// i pusta liste grup - i te bledy mapujemy w `meetingsErrors.ts`. Natomiast
// "koniec dnia przed poczatkiem" baza przyjmie i wygeneruje ZERO slotow,
// czyli gielda cicho nie zadziala. Takie pulapki lapiemy tutaj, przed zapisem.
import type {
  MeetingSettings,
  MeetingSettingsInput,
  MeetingVisibility,
} from "@/lib/events/meetingsApi";

/** Stan formularza; liczby jako napisy, bo tak dziala kontrolowany input. */
export interface MeetingSettingsDraft {
  isEnabled: boolean;
  timezone: string;
  slotMinutes: string;
  breakMinutes: string;
  dayStartTime: string;
  dayEndTime: string;
  meetingDays: string[];
  invitesOpenAt: string;
  invitesCloseAt: string;
  inviteExpiresAfterHours: string;
  maxInvitesPerPerson: string;
  maxMeetingsPerDay: string;
  visibility: MeetingVisibility;
  introPl: string;
  introEn: string;
  requesterGroupIds: string[];
  inviteeGroupIds: string[];
}

/** Klucze bledow - komponent doklada do nich prefiks slownika, nie sklejam napisow. */
export const SETTINGS_ERROR_KEYS = [
  "timezoneRequired",
  "slotMinutesRange",
  "breakMinutesRange",
  "dayOrder",
  "dayTooShort",
  "meetingDaysRequired",
  "windowOrder",
  "expiryRange",
  "limitRange",
  "groupsRequired",
] as const;
export type MeetingSettingsErrorKey = (typeof SETTINGS_ERROR_KEYS)[number];

const SLOT_MIN = 5;
const SLOT_MAX = 240;
const BREAK_MAX = 120;
const EXPIRY_MIN = 1;
const EXPIRY_MAX = 720;
const LIMIT_MAX = 200;

/** `HH:MM` -> minuty od polnocy; `null`, gdy napis nie jest godzina. */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** `HH:MM:SS` z bazy -> `HH:MM` dla `<input type="time">`, ktory dluzszego nie przyjmie. */
function trimTime(value: string | null | undefined, fallback: string): string {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return value.trim().slice(0, 5);
}

/** ISO z bazy -> wartosc `datetime-local` (bez strefy, bo pole jej nie zna). */
function toLocalInput(value: string | null): string {
  if (value === null) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Wartosc `datetime-local` -> ISO; pusty napis znaczy "wyczysc" i idzie jako null. */
function fromLocalInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

/**
 * Szkic z odpowiedzi RPC.
 *
 * `configured === false` znaczy, ze wiersz jeszcze nie istnieje - RPC oddaje
 * wtedy wartosci domyslne, wiec formularz pokazuje propozycje, a nie pustke.
 */
export function draftFromSettings(settings: MeetingSettings): MeetingSettingsDraft {
  return {
    isEnabled: settings.is_enabled,
    timezone: settings.timezone || settings.event_timezone || "Europe/Warsaw",
    slotMinutes: String(settings.slot_minutes),
    breakMinutes: String(settings.break_minutes),
    dayStartTime: trimTime(settings.day_start_time, "09:00"),
    dayEndTime: trimTime(settings.day_end_time, "17:00"),
    meetingDays: [...settings.meeting_days].sort(),
    invitesOpenAt: toLocalInput(settings.invites_open_at),
    invitesCloseAt: toLocalInput(settings.invites_close_at),
    inviteExpiresAfterHours: String(settings.invite_expires_after_hours),
    maxInvitesPerPerson:
      settings.max_invites_per_person === null ? "" : String(settings.max_invites_per_person),
    maxMeetingsPerDay:
      settings.max_meetings_per_day === null ? "" : String(settings.max_meetings_per_day),
    visibility: settings.visibility,
    introPl: settings.intro_pl,
    introEn: settings.intro_en,
    requesterGroupIds: settings.requester_groups.map((group) => group.group_id),
    inviteeGroupIds: settings.invitee_groups.map((group) => group.group_id),
  };
}

/**
 * Lista bledow szkicu - pusta tablica znaczy "mozna zapisac".
 *
 * Zwracamy WSZYSTKIE bledy naraz, nie pierwszy z brzegu: organizator poprawia
 * formularz raz, zamiast klikac „Zapisz" cztery razy pod rzad.
 */
export function validateSettingsDraft(draft: MeetingSettingsDraft): MeetingSettingsErrorKey[] {
  const errors: MeetingSettingsErrorKey[] = [];

  if (draft.timezone.trim().length === 0) errors.push("timezoneRequired");

  const slot = numberOrNull(draft.slotMinutes);
  if (slot === null || slot < SLOT_MIN || slot > SLOT_MAX) errors.push("slotMinutesRange");

  const brk = numberOrNull(draft.breakMinutes);
  if (brk === null || brk < 0 || brk > BREAK_MAX) errors.push("breakMinutesRange");

  const start = timeToMinutes(draft.dayStartTime);
  const end = timeToMinutes(draft.dayEndTime);
  if (start === null || end === null || end <= start) {
    errors.push("dayOrder");
  } else if (slot !== null && slot > 0 && end - start < slot) {
    // Okno krotsze niz jeden slot generuje pusta siatke - gielda wygladalaby
    // na wlaczona, a nie miala ani jednego terminu do zaproponowania.
    errors.push("dayTooShort");
  }

  if (draft.isEnabled && draft.meetingDays.length === 0) errors.push("meetingDaysRequired");

  const open = fromLocalInput(draft.invitesOpenAt);
  const close = fromLocalInput(draft.invitesCloseAt);
  if (open !== null && close !== null && new Date(close) <= new Date(open)) {
    errors.push("windowOrder");
  }

  const expiry = numberOrNull(draft.inviteExpiresAfterHours);
  if (expiry === null || expiry < EXPIRY_MIN || expiry > EXPIRY_MAX) errors.push("expiryRange");

  for (const raw of [draft.maxInvitesPerPerson, draft.maxMeetingsPerDay]) {
    if (raw.trim().length === 0) continue;
    const limit = numberOrNull(raw);
    if (limit === null || limit < 1 || limit > LIMIT_MAX) {
      errors.push("limitRange");
      break;
    }
  }

  if (
    draft.visibility === "groups" &&
    (draft.requesterGroupIds.length === 0 || draft.inviteeGroupIds.length === 0)
  ) {
    errors.push("groupsRequired");
  }

  return errors;
}

/**
 * Szkic -> payload RPC.
 *
 * Grupy leca TYLKO przy regule `groups`: przy kazdej innej RPC i tak je
 * ignoruje, a wyslanie pustej tablicy przy `everyone` skasowaloby przydzial,
 * ktory organizator zobaczy z powrotem po przelaczeniu reguly.
 */
export function settingsInputFromDraft(
  eventId: string,
  draft: MeetingSettingsDraft,
): MeetingSettingsInput {
  const groups =
    draft.visibility === "groups"
      ? { requesterGroupIds: draft.requesterGroupIds, inviteeGroupIds: draft.inviteeGroupIds }
      : {};

  return {
    eventId,
    isEnabled: draft.isEnabled,
    timezone: draft.timezone.trim(),
    slotMinutes: numberOrNull(draft.slotMinutes) ?? 20,
    breakMinutes: numberOrNull(draft.breakMinutes) ?? 5,
    dayStartTime: draft.dayStartTime,
    dayEndTime: draft.dayEndTime,
    meetingDays: [...draft.meetingDays].sort(),
    invitesOpenAt: fromLocalInput(draft.invitesOpenAt),
    invitesCloseAt: fromLocalInput(draft.invitesCloseAt),
    inviteExpiresAfterHours: numberOrNull(draft.inviteExpiresAfterHours) ?? 72,
    maxInvitesPerPerson: numberOrNull(draft.maxInvitesPerPerson),
    maxMeetingsPerDay: numberOrNull(draft.maxMeetingsPerDay),
    visibility: draft.visibility,
    introPl: draft.introPl,
    introEn: draft.introEn,
    ...groups,
  };
}

/** Liczba slotow w jednym dniu przy obecnym szkicu - podglad siatki bez zapisu. */
export function slotsPerDay(draft: MeetingSettingsDraft): number {
  const start = timeToMinutes(draft.dayStartTime);
  const end = timeToMinutes(draft.dayEndTime);
  const slot = numberOrNull(draft.slotMinutes);
  const brk = numberOrNull(draft.breakMinutes) ?? 0;
  if (start === null || end === null || slot === null || slot <= 0 || end <= start) return 0;
  // Ta sama arytmetyka co `generate_series` w SQL-u: ostatni slot musi zmiescic
  // sie CALY przed koncem dnia, a przerwa liczy sie po nim, nie przed.
  const step = slot + Math.max(brk, 0);
  let count = 0;
  for (let cursor = start; cursor + slot <= end; cursor += step) count += 1;
  return count;
}
