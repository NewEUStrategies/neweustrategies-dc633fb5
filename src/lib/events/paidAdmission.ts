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
 * Co webhook robi z wpłatą za bilet po odpowiedzi bazy
 * (`payments_apply_event_ticket_outcome`).
 *
 *   - `seated`   - zgłoszenie dostało miejsce: RSVP „going" i „miejsce
 *                  zarezerwowane";
 *   - `rsvp`     - zakup BEZ zgłoszenia z formularza (`registration_not_found`):
 *                  miejsce RSVP rozstrzyga baza pod blokadą
 *                  (`_event_rsvp_claim_paid_seat`);
 *   - `awaiting` - wpłata zaksięgowana bez miejsca (kolejka, decyzja
 *                  organizatora, zgłoszenie zamknięte): bez RSVP i bez maila
 *                  o rezerwacji - właściwy szablon wysłał moduł powiadomień;
 *   - `refused`  - baza ODMÓWIŁA wpłaty (cudze zgłoszenie, niezgodny bilet albo
 *                  kwota, druga wpłata za to samo zgłoszenie): bez RSVP, zwrot
 *                  w kolejce albo znacznik do przeglądu (TIX-05);
 *   - `none`     - zamówienie nie jest biletem, który da się rozliczyć
 *                  (zanonimizowane konto).
 *
 * DO 20261012130100 KAŻDE `applied !== true` ZNACZYŁO „MIEJSCE". Odmowa bazy
 * (druga zakładka, wskazanie niezgodne) i połknięty błąd RPC dawały kupującemu
 * RSVP i drugi mail „miejsce zarezerwowane", a zgłoszenie zostawało
 * nieopłacone. Teraz miejsce daje wyłącznie zapis z miejscem albo jawna
 * ścieżka RSVP; błąd RPC rzuca wyżej (webhook ponawia).
 */
export type PaidTicketVerdict = "seated" | "rsvp" | "awaiting" | "refused" | "none";

/** Powody `applied: false`, które NIE są odmową wpłaty. */
const NOT_A_REFUSAL: ReadonlySet<unknown> = new Set([
  "registration_not_found",
  "not_a_ticket_order",
  "order_not_found",
]);

export function paidTicketVerdict(
  payload: {
    applied?: unknown;
    registration_status?: unknown;
    reason?: unknown;
    refused?: unknown;
  } | null,
): PaidTicketVerdict {
  if (payload === null) return "none";
  // Wpłata zaksięgowana na zgłoszeniu ODWOŁANYM albo ODRZUCONYM (`applied`,
  // ale `refused` i zwrot w kolejce) to odmowa wobec kupującego, nie miejsce.
  if (payload.refused === true) return "refused";
  if (payload.applied === true) {
    return paidAdmission(payload.registration_status) === "seated" ? "seated" : "awaiting";
  }
  if (payload.reason === "registration_not_found") return "rsvp";
  return NOT_A_REFUSAL.has(payload.reason) ? "none" : "refused";
}

/** Czy webhook ma zgłoszenie/zakup jako odmówione przez bazę. */
export function isTicketPaymentRefusal(
  payload: { applied?: unknown; reason?: unknown; refused?: unknown } | null,
): boolean {
  return paidTicketVerdict(payload) === "refused";
}

/**
 * Czy wpłata potwierdziła miejsce zgłoszenia - warunek RSVP „going" i maila
 * „miejsce zarezerwowane" dla zakupu ze zgłoszeniem. Ścieżkę RSVP (zakup bez
 * zgłoszenia) rozstrzyga osobno `_event_rsvp_claim_paid_seat`.
 */
export function paidSeatConfirmed(
  payload: { applied?: unknown; registration_status?: unknown; reason?: unknown } | null,
): boolean {
  return paidTicketVerdict(payload) === "seated";
}
