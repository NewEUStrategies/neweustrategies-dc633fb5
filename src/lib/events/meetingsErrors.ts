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
// LISTA JEST PRZEPISANA Z `RAISE EXCEPTION` I Z `_event_meeting_can_invite`
// w migracji `20260823190000_event_meetings.sql`, klucz po kluczu. Wcześniejsza
// wersja miała klucze WYMYŚLONE (`same_person`, `slot_invalid`,
// `counterpart_unavailable`, `group_not_allowed`, `availability_in_use`), których
// baza nigdy nie podnosi - każdy z nich degradował do komunikatu ogólnego,
// a najczęstsze odmowy giełdy (nakładające się okno, termin poza siatką, brak
// dostępności rozmówcy) uczestnik widział jako „Operacja się nie powiodła".
export const MEETING_ERROR_KEYS = [
  "forbidden",
  // `event_meeting_directory` i `event_meeting_directory_visibility_set`
  // odmawiaja gosciowi bez sesji wlasnym kluczem - reszta modulu uzywa
  // `forbidden`, ale te dwie mowia wprost, ze brakuje ZALOGOWANIA, a nie
  // uprawnienia.
  "auth_required",
  "invalid_payload",
  "invalid_decision",
  "invalid_window",
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
  "exchange_rule_closed",
  "rate_limited",
  "same_slot",
  "self_invite",
  "slot_not_in_grid",
  "requester_unavailable",
  "invitee_unavailable",
  "requester_not_participating",
  "invitee_not_participating",
  "requester_group_cannot_meet",
  "invitee_group_cannot_meet",
  "requester_group_not_allowed",
  "invitee_group_not_allowed",
  "requester_not_sponsor",
  "invite_limit_reached",
  "daily_limit_reached",
  "duplicate_invitation",
  "duplicate_meeting",
  "participant_busy",
  "table_busy",
  "table_inactive",
  "table_not_found",
  "table_seat_out_of_range",
  "no_free_table",
  "availability_overlap",
  "availability_has_meetings",
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
