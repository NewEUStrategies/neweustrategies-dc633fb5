// Numer potwierdzenia rezerwacji wyprowadzony deterministycznie z identyfikatora
// zamówienia (płatna wejściówka) albo wiersza RSVP (wejściówka bezpłatna).
//
// TO NIE JEST KOD WEJŚCIA (REG-12). Numer `NES-XXXX-XXXX` to etykieta dla
// człowieka: pozwala odnaleźć zakup w rozmowie z biurem. Skaner przy bramce
// przyjmuje WYŁĄCZNIE losowy kod biletu (32 znaki z `_event_new_qr_token()`),
// który przychodzi mailem „Twój bilet" i stoi na stronie biletu
// (`/events/<slug>/ticket#t=…`). Dawniej karta na stronie wydarzenia rysowała
// z tego numeru kod QR (adres `?ticket=NES-…`) - skaner go nie znał, a każdy
// taki skan liczył się do blokady urządzenia (20 nieznanych kodów w 10 minut).
// QR z numerem zniknął z interfejsu; zostaje bramka po stronie skanera
// (`assertScannableCode`), bo stare zrzuty ekranu i wydruki krążą dalej.

const ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // bez I i O (pomyłki przy odczycie)

/** Numer potwierdzenia w formacie `NES-XXXX-XXXX` (alfabet bez I i O). */
export const BOOKING_REFERENCE_PATTERN = /^NES-[0-9A-HJ-NP-Z]{4}-[0-9A-HJ-NP-Z]{4}$/i;

/** Numer potwierdzenia w formacie `NES-XXXX-XXXX`. */
export function ticketCodeFrom(seed: string): string {
  const hex = seed.replace(/[^0-9a-f]/gi, "").toUpperCase();
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    const chunk = hex.slice(i * 3, i * 3 + 3) || String(i);
    const value = Number.parseInt(chunk, 16);
    out += ALPHABET[(Number.isNaN(value) ? i : value) % ALPHABET.length];
  }
  return `NES-${out.slice(0, 4)}-${out.slice(4, 8)}`;
}

/**
 * Czym jest zeskanowany napis, ZANIM pójdzie do bazy:
 *   * `booking_reference` - numer potwierdzenia albo adres z nim w `?ticket=`
 *     (dawny QR z karty na stronie wydarzenia);
 *   * `url` - dowolny inny adres `http(s)://` (np. QR parowania urządzenia);
 *   * `candidate` - wszystko inne; o kodzie rozstrzyga baza.
 *
 * Reguła jest CELOWO wąska: odrzuca tylko to, co na pewno nie jest kodem
 * biletu. Kody o nietypowym kształcie (wydruki identyfikatorów, kody testowe)
 * nadal rozstrzyga baza.
 */
export function classifyScannedCode(raw: string): "booking_reference" | "url" | "candidate" {
  const value = raw.trim();
  if (BOOKING_REFERENCE_PATTERN.test(value)) return "booking_reference";
  if (!/^https?:\/\//i.test(value)) return "candidate";
  try {
    const ticket = new URL(value).searchParams.get("ticket");
    if (ticket !== null && BOOKING_REFERENCE_PATTERN.test(ticket.trim())) {
      return "booking_reference";
    }
  } catch {
    // Adres, którego nie da się przeczytać, i tak nie jest kodem biletu.
  }
  return "url";
}

/**
 * Odmowa „to nie kod biletu" - jedna treść dla bramki lokalnej i dla wyniku
 * `not_entry_code` z bazy (RPC skanera rozpoznają te same napisy przed
 * wyszukaniem kodu, przegląd R67).
 */
export const NOT_ENTRY_CODE_ERROR = "not_entry_code: booking reference or link, not a ticket code";

/**
 * Bramka skanera przed siecią i kolejką offline. Numer potwierdzenia i adres
 * nie są kodem biletu - odmowa z głową `not_entry_code` (klasa „odmowa":
 * bez ponawiania, bez kolejki, bez licznika nieznanych kodów urządzenia).
 */
export function assertScannableCode(raw: string): void {
  if (classifyScannedCode(raw) !== "candidate") {
    throw new Error(NOT_ENTRY_CODE_ERROR);
  }
}
