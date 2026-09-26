// Kod wpisany w formularzu zapisu przechodzi do kasy (ekran potwierdzenia).
// sessionStorage: tylko ta karta, nic nie trafia na serwer poza kasą,
// a o rabacie i tak decyduje baza (validate_event_ticket_coupon).
//
// DWA KODY, DWIE SZUFLADY. Kod WYDARZENIA (`rememberEventCode`) to kupon
// z `b2b_coupons`: odsłania ukryte bilety i bywa rabatem. Kod DOSTĘPU biletu
// (`rememberTicketAccessCode`) to sekret jednej wejściówki
// (`event_ticket_types.access_code_hash`) - sprawdza go `event_register`
// przy zapisie i `event_ticket_checkout_quote` w kasie. Jedna szuflada
// mieszałaby oba: kod dostępu wpisany w formularzu wracałby w kasie jako
// kupon, a kupon - jako kod dostępu.
const keyFor = (eventId: string) => `nes-event-code-${eventId}`;
const accessKeyFor = (eventId: string, ticketTypeId: string) =>
  `nes-ticket-access-${eventId}-${ticketTypeId}`;

const normalized = (code: string): string => code.trim().toUpperCase().slice(0, 64);

export function rememberEventCode(eventId: string, code: string): void {
  try {
    window.sessionStorage.setItem(keyFor(eventId), normalized(code));
  } catch {
    /* prywatny tryb - kod można wpisać ręcznie w kasie */
  }
}

export function recallEventCode(eventId: string): string {
  try {
    return window.sessionStorage.getItem(keyFor(eventId)) ?? "";
  } catch {
    return "";
  }
}

/** Kod dostępu, z którym baza przyjęła zapis na TĘ wejściówkę. */
export function rememberTicketAccessCode(
  eventId: string,
  ticketTypeId: string,
  code: string,
): void {
  try {
    window.sessionStorage.setItem(accessKeyFor(eventId, ticketTypeId), normalized(code));
  } catch {
    /* prywatny tryb - kasa zapyta o kod, gdy baza go zażąda */
  }
}

export function recallTicketAccessCode(eventId: string, ticketTypeId: string): string {
  try {
    return window.sessionStorage.getItem(accessKeyFor(eventId, ticketTypeId)) ?? "";
  } catch {
    return "";
  }
}

/**
 * Kod dostępu do podpowiedzenia w formularzu i w kasie: najpierw ten, z którym
 * baza przyjęła zapis na TĘ wejściówkę, potem kod wydarzenia z linku `?code=`
 * - zaproszenie zwykle odsłania ukryty bilet i otwiera go tym samym napisem.
 * Czy pasuje, wie tylko baza; kod bez skrótu na bilecie baza pomija.
 */
export function recallAccessCodeHint(eventId: string, ticketTypeId: string): string {
  return recallTicketAccessCode(eventId, ticketTypeId) || recallEventCode(eventId);
}
