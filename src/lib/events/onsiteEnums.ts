// Zamknięte słowniki modułu ON-SITE - LUSTRO ograniczeń CHECK z bazy.
//
// DLACZEGO OSOBNY, MALUTKI MODUŁ. Te same wartości czyta panel organizatora
// (`onsiteApi`, filtry dziennika, dialog punktu kontrolnego) i klient skanera
// na bramce. Skaner jest aplikacją instalowaną na telefonie wolontariusza -
// wciągnięcie do jego pakietu całego `onsiteApi` (z funkcjami administracyjnymi
// i ich typami) tylko po to, żeby poznać trzy tablice napisów, byłoby kosztem
// bez powodu. Jedno źródło, dwa importy, zero kopii.
//
// TE TABLICE MUSZĄ ZGADZAĆ SIĘ Z BAZĄ CO DO ZNAKU. Wcześniej nie zgadzały się:
// filtr dziennika odpraw oferował `denied_no_registration`, `denied_not_approved`,
// `denied_wrong_direction` i `denied_duplicate` - CZTERY wartości, których
// ograniczenie `event_checkins_result_values` NIE DOPUSZCZA. Skutek nie był
// kosmetyczny: filtr po odmowie zwracał pustą listę (baza nie ma takich
// wierszy), a prawdziwa odmowa `denied_not_registered` renderowała się jako
// goły klucz i18n, bo słownik znał tylko nieistniejące nazwy. Stąd komplet
// wartości przepisany z migracji, a nie z pamięci.
//
// Źródła (najnowsze definicje):
//   * `event_checkins_result_values`  -> 20260824101235_a8f6e612-…sql
//   * `event_checkpoints_direction_mode` -> 20260824100844_29c02b4d-…sql
//   * `event_badge_prints_reason_values` -> 20260824101451_98a0f340-…sql
//   * zakresy poświadczenia urządzenia -> `_event_scanner_device_auth`

/** Rodzaje punktów kontrolnych. */
export const CHECKPOINT_KINDS = [
  "event_entry",
  "session",
  "room",
  "zone",
  "catering",
  "cloakroom",
  "company_booth",
] as const;
export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

/** Kierunki obsługiwane przez punkt. `out_only` istnieje w bazie od początku. */
export const CHECKPOINT_DIRECTION_MODES = ["in_only", "out_only", "in_out"] as const;
export type CheckpointDirectionMode = (typeof CHECKPOINT_DIRECTION_MODES)[number];

/** `control` odmawia bez zapisu/miejsca, `track` liczy wejścia bez odmowy. */
export const CHECKPOINT_ACCESS_MODES = ["control", "track"] as const;
export type CheckpointAccessMode = (typeof CHECKPOINT_ACCESS_MODES)[number];

/** Zakresy poświadczenia urządzenia skanującego. */
export const SCANNER_SCOPES = ["checkin", "lead", "badge_print"] as const;
export type ScannerScope = (typeof SCANNER_SCOPES)[number];

export const CHECKIN_DIRECTIONS = ["in", "out"] as const;
export type CheckinDirection = (typeof CHECKIN_DIRECTIONS)[number];

/** Wyniki odprawy - dokładnie sześć wartości z ograniczenia CHECK. */
export const CHECKIN_RESULTS = [
  "granted",
  "denied_not_registered",
  "denied_registration_status",
  "denied_direction",
  "denied_capacity",
  "denied_checkpoint_inactive",
] as const;
export type CheckinResult = (typeof CHECKIN_RESULTS)[number];

/** Źródła wpisu w dzienniku odpraw. */
export const CHECKIN_SOURCES = ["qr_code", "manual_entry", "name_search", "self_service"] as const;
export type CheckinSource = (typeof CHECKIN_SOURCES)[number];

/** Powody wydruku identyfikatora. */
export const BADGE_PRINT_REASONS = [
  "first_issue",
  "reprint_lost",
  "reprint_damaged",
  "data_correction",
  "bulk_preprint",
] as const;
export type BadgePrintReason = (typeof BADGE_PRINT_REASONS)[number];

export function isCheckinResult(value: string): value is CheckinResult {
  return (CHECKIN_RESULTS as readonly string[]).includes(value);
}

export function isScannerScope(value: string): value is ScannerScope {
  return (SCANNER_SCOPES as readonly string[]).includes(value);
}
