// Tlumaczenie bledow RPC gieldy spotkan 1-1 na klucze i18n.
//
// KONTRAKT BAZY. Kazda funkcja modulu (`20260823190000_event_meetings.sql`)
// podnosi wyjatek w formacie `klucz: zdanie po angielsku`. Zdanie jest dla
// dziennika serwera i dla programisty czytajacego logi, KLUCZ jest dla
// interfejsu. Dlatego front nigdy nie pokazuje `error.message` wprost:
// pokazalby uczestnikowi "one of you already has a meeting in this slot"
// w polskim panelu i bez wskazania, co zrobic dalej.
//
// NIEZNANY KLUCZ NIE JEST BLEDEM KRYTYCZNYM. Gdy baza dostanie nowy warunek,
// a slownik jeszcze go nie zna, wracamy do `unknown` - komunikat ogolny jest
// gorszy od precyzyjnego, ale nieporownanie lepszy od pustego ekranu albo
// surowego tekstu wyjatku z nazwa ograniczenia w srodku.

/** Klucze bledow, ktore moduł gieldy potrafi podniesc. */
export const MEETING_ERROR_KEYS = [
  "forbidden",
  "invalid_payload",
  "invalid_decision",
  "not_found",
  "not_registered",
  "not_invitee",
  "not_a_party",
  "invitation_not_open",
  "invitation_expired",
  "decline_reason_required",
  "meeting_not_active",
  "meetings_disabled",
  "exchange_closed",
  "same_slot",
  "same_person",
  "slot_invalid",
  "slot_outside_availability",
  "counterpart_unavailable",
  "group_not_allowed",
  "invite_limit_reached",
  "daily_limit_reached",
  "duplicate_invitation",
  "participant_busy",
  "table_busy",
  "no_free_table",
  "availability_in_use",
  "unknown",
] as const;

export type MeetingErrorKey = (typeof MEETING_ERROR_KEYS)[number];

const KEY_SET = new Set<string>(MEETING_ERROR_KEYS);

/**
 * Wyjmuje klucz z komunikatu wyjatku Postgresa.
 *
 * Bierze wylacznie czlon przed pierwszym dwukropkiem i tylko wtedy, gdy wyglada
 * jak klucz techniczny (male litery i podkreslenia). Bez tego warunku komunikat
 * typu "ERROR: coś poszło nie tak" oddalby klucz "ERROR" i pokazal go
 * uzytkownikowi jako etykiete.
 */
export function meetingErrorKey(error: unknown): MeetingErrorKey {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "";

  const head = message.split(":", 1)[0]?.trim() ?? "";
  if (!/^[a-z][a-z0-9_]*$/.test(head)) return "unknown";
  return KEY_SET.has(head) ? (head as MeetingErrorKey) : "unknown";
}

/** Pelna sciezka klucza w slowniku i18n - jedno miejsce, zeby nie sklejac napisow w komponentach. */
export function meetingErrorI18nKey(error: unknown): string {
  return `eventMeetings.errors.${meetingErrorKey(error)}`;
}
