// Kontrakty biletu na wydarzenie - moduł bezpieczny dla przeglądarki
// (typy współdzielone przez server functions i komponenty).

export interface EventSeatState {
  eventId: string;
  capacity: number | null;
  going: number;
  waitlist: number;
  /** `null` = brak limitu miejsc. */
  seatsLeft: number | null;
  isFull: boolean;
  /** Znacznik odczytu - klient pokazuje, jak świeża jest liczba miejsc. */
  checkedAt: string;
}

/**
 * Jak posiadacz wchodzi na wydarzenie (REG-12) - karta na stronie wydarzenia
 * NIE jest biletem wstępu, więc mówi, gdzie jest prawdziwy kod:
 *   * `emailed_qr` - kod QR wyszedł mailem „Twój bilet" (`ticket_code_sent_at`);
 *   * `qr_pending` - zgłoszenie rozliczone, kod jeszcze nie wyszedł;
 *   * `contact_organizer` - mail z kodem nie dał się doręczyć;
 *   * `guest_list` - bez rozliczonego zgłoszenia (RSVP sprzed formularza
 *     zgłoszeń albo zgłoszenie bez wpłaty): wejście po nazwisku z listy.
 */
export type TicketEntryMode = "emailed_qr" | "qr_pending" | "contact_organizer" | "guest_list";

export interface MyEventTicket {
  eventId: string;
  slug: string;
  titlePl: string;
  titleEn: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  location: string | null;
  /**
   * Numer potwierdzenia `NES-XXXX-XXXX` (z zamówienia albo RSVP) - etykieta do
   * rozmowy z biurem, NIGDY kod wejścia ani treść kodu QR.
   */
  code: string;
  /** Gdzie jest prawdziwy kod wejścia - zdanie na karcie. */
  entry: TicketEntryMode;
  /** Numer transakcji u operatora - tylko dla biletów płatnych. */
  transactionId: string | null;
  amountCents: number | null;
  currency: string | null;
  paidAt: string | null;
  holderName: string | null;
  holderEmail: string | null;
}
