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

export type MyEventsBucket = "upcoming" | "current" | "past";

/**
 * TRWA = start już minął, a koniec jeszcze nie. Wydarzenie bez daty końca
 * traktujemy jak jednodniowe (doba od startu) - inaczej każdy miniony wpis bez
 * `ends_at` zostałby na zawsze „w trakcie".
 */
const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;

export function bucketOf(item: ParticipantRegistration, now: Date): MyEventsBucket {
  if (item.eventStartsAt === null) return "upcoming";
  const start = Date.parse(item.eventStartsAt);
  if (Number.isNaN(start)) return "upcoming";
  if (start >= now.getTime()) return "upcoming";
  const endRaw = item.eventEndsAt === null ? Number.NaN : Date.parse(item.eventEndsAt);
  const end = Number.isNaN(endRaw) ? start + DEFAULT_DURATION_MS : endRaw;
  return end >= now.getTime() ? "current" : "past";
}

/** Czy pozycja czeka na pieniądze - „opłać bilet" ma sens tylko wtedy. */
export function awaitsPayment(item: ParticipantRegistration): boolean {
  if (item.amountCents === null || item.amountCents <= 0) return false;
  if (item.cancelledAt !== null) return false;
  return item.paymentStatus !== "paid" && item.orderStatus !== "paid";
}

export interface MyEventsGroups {
  upcoming: ParticipantRegistration[];
  current: ParticipantRegistration[];
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
  const current: ParticipantRegistration[] = [];
  const past: ParticipantRegistration[] = [];
  for (const item of items) {
    const bucket = bucketOf(item, now);
    if (bucket === "upcoming") upcoming.push(item);
    else if (bucket === "current") current.push(item);
    else past.push(item);
  }
  const stamp = (item: ParticipantRegistration): number => {
    const value = item.eventStartsAt === null ? Number.NaN : Date.parse(item.eventStartsAt);
    return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
  };
  upcoming.sort((a, b) => stamp(a) - stamp(b));
  current.sort((a, b) => stamp(a) - stamp(b));
  past.sort((a, b) => stamp(b) - stamp(a));
  return { upcoming, current, past };
}
