// Podział zgłoszeń uczestnika na „nadchodzące" i „minione" - czysta reguła,
// jedna dla wszystkich powierzchni (globalny profil, panel wydarzenia).
//
// GRANICĄ JEST START WYDARZENIA, NIE STATUS ZGŁOSZENIA. Zapis anulowany na
// przyszłe wydarzenie nadal należy do „nadchodzących", bo użytkownik szuka go
// tam, gdzie wydarzenie stoi w kalendarzu - a nie w archiwum.
//
// BRAK DATY = NADCHODZĄCE. Wydarzenie bez ustalonego terminu jeszcze się nie
// odbyło; wrzucenie go do archiwum ukryłoby aktywny zapis.
import type { ParticipantRegistration } from "@/lib/events/participantTicketsApi";

export type MyEventsBucket = "upcoming" | "past";

export function bucketOf(item: ParticipantRegistration, now: Date): MyEventsBucket {
  if (item.eventStartsAt === null) return "upcoming";
  const start = Date.parse(item.eventStartsAt);
  if (Number.isNaN(start)) return "upcoming";
  return start >= now.getTime() ? "upcoming" : "past";
}

/** Czy pozycja czeka na pieniądze - „opłać bilet" ma sens tylko wtedy. */
export function awaitsPayment(item: ParticipantRegistration): boolean {
  if (item.amountCents === null || item.amountCents <= 0) return false;
  if (item.cancelledAt !== null) return false;
  return item.paymentStatus !== "paid" && item.orderStatus !== "paid";
}

export interface MyEventsGroups {
  upcoming: ParticipantRegistration[];
  past: ParticipantRegistration[];
}

/**
 * Nadchodzące rosnąco (najbliższe u góry), minione malejąco (ostatnie u góry) -
 * w obu przypadkach pierwsza pozycja to ta, o którą użytkownik pyta najczęściej.
 */
export function groupMyEvents(
  items: ParticipantRegistration[],
  now: Date,
): MyEventsGroups {
  const upcoming: ParticipantRegistration[] = [];
  const past: ParticipantRegistration[] = [];
  for (const item of items) {
    if (bucketOf(item, now) === "upcoming") upcoming.push(item);
    else past.push(item);
  }
  const stamp = (item: ParticipantRegistration): number => {
    const value = item.eventStartsAt === null ? Number.NaN : Date.parse(item.eventStartsAt);
    return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
  };
  upcoming.sort((a, b) => stamp(a) - stamp(b));
  past.sort((a, b) => stamp(b) - stamp(a));
  return { upcoming, past };
}
