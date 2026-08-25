// Kolejka skanów czekających na sieć („outbox") - reguła czysta, bez IO.
//
// PO CO TO ISTNIEJE. Bramka kongresu stoi tam, gdzie zasięg jest najgorszy:
// w hali, w windzie, przy wejściu z betonowym stropem. Skaner, który przy
// braku sieci mówi „spróbuj ponownie", zatrzymuje kolejkę stu osób. Skaner,
// który zapisuje skan lokalnie i wysyła go, gdy sieć wróci, nie zatrzymuje
// nikogo - a lista obecności i tak zgadza się co do osoby.
//
// IDEMPOTENCJA JEST PO STRONIE BAZY, NIE NASZEJ NADZIEI. `event_checkin_record`
// przyjmuje `client_scan_uid` i `device_scanned_at`, a `_event_checkin_write`
// domyka je ograniczeniem EXCLUDE i oknem powtórzeń. Dlatego ponowienie tego
// samego wpisu NIE tworzy drugiej odprawy, tylko podnosi `repeat_count` albo
// wraca z tym samym wynikiem. To jest jedyny powód, dla którego ta kolejka
// w ogóle może istnieć.
//
// LEAD TAK, IDENTYFIKATOR NIE. `event_lead_scan_record` jest wstawieniem
// z `ON CONFLICT` po (najemca, partner, osoba), więc ponowienie najwyżej
// podbije `scan_count` - koszt znany i mały wobec straconego leadu.
// `event_badge_print_record` wstawia NOWY wiersz rejestru wydruków przy każdym
// wywołaniu; ponowienie po zgubionej odpowiedzi zostawiłoby ślad wydruku,
// którego nikt nie wydrukował. Rejestr wydruków jest dokumentem rozliczenia
// z drukarnią, więc druk wymaga sieci i mówi o tym wprost.
//
// ODMOWA POŚWIADCZENIA NIE JEST BŁĘDEM SIECI. Unieważniony, wygasły albo
// zablokowany token nie zacznie działać po dziesiątej próbie - takie pozycje
// zdejmujemy z kolejki i pokazujemy operatorowi, zamiast dobijać się do bazy
// aż do końca baterii.
import type { CheckinDirection } from "@/lib/events/onsiteEnums";

export const OUTBOX_KINDS = ["checkin", "lead"] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

export interface OutboxItem {
  /** Dla odprawy JEST to `client_scan_uid` - klucz idempotencji w bazie. */
  id: string;
  kind: OutboxKind;
  code: string;
  checkpointId: string | null;
  direction: CheckinDirection | null;
  note: string | null;
  interestRating: number | null;
  /** Chwila SKANU, nie chwila wysyłki - to ona trafia do dziennika. */
  deviceScannedAt: string;
  attempts: number;
  /** Nie ponawiamy przed tą chwilą (wykładnicze wycofanie). */
  nextAttemptAt: string;
  lastError: string | null;
}

/** Po tylu nieudanych próbach pozycja idzie do „wymaga uwagi", nie w nieskończoność. */
export const OUTBOX_MAX_ATTEMPTS = 8;

/** Więcej i tak nie zmieści się w jednej zmianie wolontariusza przy bramce. */
export const OUTBOX_CAPACITY = 500;

/** Odmowy, których ponawianie nie ma sensu - poświadczenie, nie sieć. */
const PERMANENT_HEADS: readonly string[] = [
  "invalid_device_token",
  "device_revoked",
  "device_inactive",
  "device_expired",
  "device_scope_missing",
  "device_checkpoint_mismatch",
  "checkpoint_not_found",
  "invalid_payload",
  "invalid_direction",
];

export function errorHead(message: string): string {
  const separator = message.indexOf(":");
  return (separator === -1 ? message : message.slice(0, separator)).trim();
}

export function isPermanentFailure(message: string): boolean {
  return PERMANENT_HEADS.includes(errorHead(message));
}

/**
 * Wykładnicze wycofanie z sufitem: 2 s, 4 s, 8 s … do 5 minut.
 *
 * Bez sufitu ósma próba wypadałaby po czterech minutach, a dziewiąta po ośmiu -
 * czyli po powrocie sieci kolejka stałaby dalej, mimo że wszystko już działa.
 */
export function backoffDelayMs(attempts: number): number {
  const step = Math.max(attempts, 0);
  return Math.min(2_000 * 2 ** step, 300_000);
}

function withDelay(nowIso: string, delayMs: number): string {
  const now = Date.parse(nowIso);
  return new Date((Number.isNaN(now) ? Date.now() : now) + delayMs).toISOString();
}

/**
 * Dokłada skan do kolejki.
 *
 * LEADY SKLEJAMY PO KODZIE. Ten sam gość podchodzi do stoiska trzy razy w ciągu
 * minuty; trzy pozycje w kolejce dałyby trzy wywołania i `scan_count` = 3 za
 * jedno spotkanie. Odprawy NIE sklejamy - dwa piknięcia na bramce to dwa
 * zdarzenia, a o tym, czy drugie jest powtórzeniem, decyduje okno w bazie.
 */
export function enqueueScan(queue: readonly OutboxItem[], item: OutboxItem): OutboxItem[] {
  if (item.kind === "lead") {
    const index = queue.findIndex((row) => row.kind === "lead" && row.code === item.code);
    if (index !== -1) {
      const next = [...queue];
      next[index] = {
        ...next[index],
        // Notatka i ocena z NOWSZEGO skanu wygrywają, ale nie kasują starszych
        // wartości pustką - operator dopisuje notatkę już po zeskanowaniu.
        note: item.note ?? next[index].note,
        interestRating: item.interestRating ?? next[index].interestRating,
        deviceScannedAt: item.deviceScannedAt,
      };
      return next;
    }
  }
  const next = [...queue, item];
  // Przepełnienie zjada NAJSTARSZE pozycje: świeży skan jest wart więcej niż
  // ten sprzed godziny, którego i tak nie udało się wysłać.
  return next.length > OUTBOX_CAPACITY ? next.slice(next.length - OUTBOX_CAPACITY) : next;
}

/** Pozycje, których termin ponowienia już minął, w kolejności skanowania. */
export function dueItems(queue: readonly OutboxItem[], nowIso: string): OutboxItem[] {
  const now = Date.parse(nowIso);
  const stamp = Number.isNaN(now) ? Date.now() : now;
  return queue
    .filter((item) => item.attempts < OUTBOX_MAX_ATTEMPTS)
    .filter((item) => {
      const due = Date.parse(item.nextAttemptAt);
      return Number.isNaN(due) || due <= stamp;
    })
    .sort((a, b) => Date.parse(a.deviceScannedAt) - Date.parse(b.deviceScannedAt));
}

/** Pozycje, które przestały być ponawiane - ekran musi je pokazać człowiekowi. */
export function stuckItems(queue: readonly OutboxItem[]): OutboxItem[] {
  return queue.filter((item) => item.attempts >= OUTBOX_MAX_ATTEMPTS);
}

export function withoutItem(queue: readonly OutboxItem[], id: string): OutboxItem[] {
  return queue.filter((item) => item.id !== id);
}

/** Nieudana próba: licznik w górę, następny termin wg wycofania. */
export function withFailure(
  queue: readonly OutboxItem[],
  id: string,
  message: string,
  nowIso: string,
): OutboxItem[] {
  if (isPermanentFailure(message)) return withoutItem(queue, id);
  return queue.map((item) => {
    if (item.id !== id) return item;
    const attempts = item.attempts + 1;
    return {
      ...item,
      attempts,
      lastError: message,
      nextAttemptAt: withDelay(nowIso, backoffDelayMs(attempts)),
    };
  });
}

export interface OutboxCounts {
  pending: number;
  stuck: number;
}

export function outboxCounts(queue: readonly OutboxItem[]): OutboxCounts {
  const stuck = stuckItems(queue).length;
  return { pending: queue.length - stuck, stuck };
}
