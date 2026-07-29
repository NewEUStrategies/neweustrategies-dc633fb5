// Czytelny numer biletu wyprowadzony deterministycznie z identyfikatora
// zamówienia (płatny bilet) albo wiersza RSVP (wejściówka bezpłatna).
//
// Kod jest wyłącznie etykietą dla człowieka i treścią kodu QR - weryfikacja
// przy wejściu i tak odpytuje backend, więc nie pełni roli sekretu.

const ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // bez I i O (pomyłki przy odczycie)

/** Numer biletu w formacie `NES-XXXX-XXXX`. */
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

/** Treść kodu QR - adres weryfikacyjny biletu. */
export function ticketQrPayload(origin: string, eventSlug: string, code: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/events/${eventSlug}?ticket=${encodeURIComponent(code)}`;
}
