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

export interface MyEventTicket {
  eventId: string;
  slug: string;
  titlePl: string;
  titleEn: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  location: string | null;
  /** Numer biletu prezentowany posiadaczowi i zakodowany w QR. */
  code: string;
  /** Numer transakcji u operatora - tylko dla biletów płatnych. */
  transactionId: string | null;
  amountCents: number | null;
  currency: string | null;
  paidAt: string | null;
  holderName: string | null;
  holderEmail: string | null;
}
