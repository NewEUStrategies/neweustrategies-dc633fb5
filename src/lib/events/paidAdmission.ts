// Co opłacenie biletu zrobiło z miejscem - odczyt statusu zgłoszenia, który
// `payments_apply_event_ticket_outcome` odsyła po zaksięgowaniu wpłaty.
//
// DLACZEGO TO NIE JEST JUŻ OCZYWISTE. Do 20260926180000 opłacenie zawsze
// znaczyło „miejsce jest Twoje". Teraz baza rozstrzyga przyjęcie pod blokadą
// (wydarzenie -> pula -> zgłoszenie) i wpłata może wylądować:
//   - na liście rezerwowej, gdy ostatnie miejsce zajęto między kasą a webhookiem;
//   - w oczekiwaniu na decyzję organizatora, gdy bilet wymaga akceptacji
//     (wpłata NIE jest akceptacją);
//   - na zgłoszeniu odwołanym albo odrzuconym - wtedy to pieniądze do zwrotu.
//
// Czysta funkcja, bez importów: czyta ją webhook (czy wolno potwierdzić RSVP
// i wysłać „miejsce zarezerwowane") i moduł powiadomień (który szablon).

/** Skutek wpłaty dla miejsca na wydarzeniu. */
export type PaidAdmission = "seated" | "waitlisted" | "awaitingDecision" | "closed";

/**
 * Status zgłoszenia po wpłacie -> skutek dla miejsca.
 *
 * DOMYŚLNIE „SEATED". Obejmuje `approved`, `attended` i `no_show`, ale także
 * BRAK POLA - odpowiedź bazy sprzed migracji nie niesie `registration_status`,
 * a wtedy zachowanie ma zostać dokładnie takie jak dotąd.
 */
export function paidAdmission(status: unknown): PaidAdmission {
  switch (status) {
    case "waitlist":
      return "waitlisted";
    case "pending":
    case "draft":
      return "awaitingDecision";
    case "cancelled":
    case "rejected":
      return "closed";
    default:
      return "seated";
  }
}

/**
 * Czy wpłata potwierdziła miejsce - warunek RSVP „going" i maila „miejsce
 * zarezerwowane".
 *
 * BEZ ZAPISU W BAZIE (`applied !== true`, brak odpowiedzi, błąd RPC) ZOSTAJE
 * STARA ŚCIEŻKA. Zakup bez zgłoszenia z formularza (RSVP, bilet bez
 * rejestracji) nigdy nie miał wiersza, na którym baza mogłaby rozstrzygnąć
 * przyjęcie - a dla niego opłacenie nadal znaczy zapis.
 */
export function paidSeatConfirmed(
  payload: { applied?: unknown; registration_status?: unknown } | null,
): boolean {
  return payload?.applied !== true || paidAdmission(payload.registration_status) === "seated";
}
