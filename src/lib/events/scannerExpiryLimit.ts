// Najpóźniejszy termin poświadczenia urządzenia skanującego - lustro
// `_event_scanner_expiry_limit` (20261013110500, OPS-12).
//
// PO CO PO STRONIE PANELU. `admin_event_scanner_device_issue` odmawia terminu
// późniejszego niż koniec wydarzenia + 7 dni (`expiry_too_late`), a gdy ta
// granica już minęła - nie wydaje poświadczenia wcale. Kalendarz, który pozwala
// wybrać datę, którą baza i tak odrzuci, kończy się czerwonym powiadomieniem po
// kliknięciu „Wydaj". Okno wydania zna granicę ZANIM operator ją przekroczy:
// ogranicza nią kalendarz (`max`), pokazuje ją w podpowiedzi i blokuje wydanie,
// gdy wydarzenie skończyło się ponad tydzień temu. Ostatnie słowo i tak ma baza.

/** Ile dni po końcu wydarzenia poświadczenie może jeszcze działać. */
export const SCANNER_EXPIRY_GRACE_DAYS = 7;

const DAY_MS = 24 * 3_600_000;

/**
 * Granica terminu: koniec wydarzenia (bez końca - start + 1 dzień) + 7 dni.
 * `null`, gdy wydarzenie nie ma czytelnej daty - wtedy granicę zna tylko baza.
 */
export function scannerExpiryLimit(
  event: { ends_at?: string | null; starts_at?: string | null } | null | undefined,
): string | null {
  if (event === null || event === undefined) return null;
  const ends = typeof event.ends_at === "string" ? Date.parse(event.ends_at) : Number.NaN;
  const starts = typeof event.starts_at === "string" ? Date.parse(event.starts_at) : Number.NaN;
  const end = Number.isNaN(ends) ? (Number.isNaN(starts) ? Number.NaN : starts + DAY_MS) : ends;
  if (Number.isNaN(end)) return null;
  return new Date(end + SCANNER_EXPIRY_GRACE_DAYS * DAY_MS).toISOString();
}

/** Czy wybrany termin przekracza granicę (`null` po którejkolwiek stronie = nie wiadomo, więc nie). */
export function isExpiryTooLate(expiresIso: string | null, limitIso: string | null): boolean {
  if (expiresIso === null || limitIso === null) return false;
  const expires = Date.parse(expiresIso);
  const limit = Date.parse(limitIso);
  if (Number.isNaN(expires) || Number.isNaN(limit)) return false;
  return expires > limit;
}

/** Czy granica już minęła - baza nie wyda poświadczenia z żadnym terminem. */
export function isIssueWindowClosed(limitIso: string | null, nowMs: number): boolean {
  if (limitIso === null) return false;
  const limit = Date.parse(limitIso);
  return !Number.isNaN(limit) && limit <= nowMs;
}
