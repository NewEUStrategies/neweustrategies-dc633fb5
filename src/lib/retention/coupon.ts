// Czyste helpery kuponu retencyjnego - testowalne bez serwera.
// Kod jest zgodny z modułem kuponów B2B (normalizacja upper-case, format
// czytelny przy dyktowaniu przez telefon: bez 0/O i 1/I).

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Deterministyczne złożenie kodu z procentu i losowego sufiksu. */
export function retentionCouponCode(discountPct: number, suffix: string): string {
  const pct = Math.min(90, Math.max(1, Math.round(discountPct)));
  return `SAVE${pct}-${suffix.toUpperCase()}`;
}

/** Losowy sufiks kodu z bezpiecznego alfabetu (bajty -> znaki modulo). */
export function couponSuffixFromBytes(bytes: Uint8Array, length = 6): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[(bytes[i] ?? 0) % CODE_ALPHABET.length];
  }
  return out;
}

/** Data ważności kuponu: teraz + pełne doby (koniec dnia po stronie serwera). */
export function couponValidUntil(now: Date, validDays: number): Date {
  const days = Math.min(90, Math.max(1, Math.round(validDays)));
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
