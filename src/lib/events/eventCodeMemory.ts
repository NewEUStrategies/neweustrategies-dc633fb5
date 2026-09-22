// Kod wpisany w formularzu zapisu przechodzi do kasy (ekran potwierdzenia).
// sessionStorage: tylko ta karta, nic nie trafia na serwer poza kasą,
// a o rabacie i tak decyduje baza (validate_event_ticket_coupon).
const keyFor = (eventId: string) => `nes-event-code-${eventId}`;

export function rememberEventCode(eventId: string, code: string): void {
  try {
    window.sessionStorage.setItem(keyFor(eventId), code.trim().toUpperCase().slice(0, 64));
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
