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
//
// ZDJĘTE Z KOLEJKI NIE ZNIKA. Wcześniej `withFailure` po prostu usuwało pozycję
// z trwałą odmową - a obietnica „pokazujemy operatorowi" nie miała pokrycia:
// skan zapisany offline przed unieważnieniem poświadczenia ginął bez śladu.
// Teraz odmowa zwraca pozycję jako ODRZUCONĄ (`rejected`), którą środowisko
// uruchomieniowe dopisuje do trwałej listy odrzuconych z eksportem dla
// organizatora.
//
// DECYZJA OFFLINE JEDZIE Z POZYCJĄ. `offlineAdmitted`, `offlineOutcome`
// i `rosterGeneratedAt` są opcjonalne, bo kolejki zapisane przed tą zmianą
// (i skany bez listy offline) ich nie mają - baza przyjmuje wtedy skan jak
// dotąd.
//
// POZYCJA NALEŻY DO URZĄDZENIA. `deviceId` to urządzenie, pod którego
// poświadczeniem skan zapadł. Wysyłka pod innym tokenem (telefon przepięty na
// poświadczenie innego partnera albo innej bramki) zapisałaby lead pod cudzym
// sponsorem - taka pozycja idzie na listę odrzuconych (`device_mismatch`).
// Pozycje sprzed tej zmiany nie mają urządzenia i jadą jak dotąd.
//
// PRZEPEŁNIENIE TEŻ NIE ZNIKA. Pełna kolejka nadal wypycha najstarszą pozycję
// (świeży skan jest cenniejszy), ale `enqueueScanWithOverflow` ją ODDAJE,
// a środowisko dopisuje ją do odrzuconych (`outbox_overflow`).
import type { CheckinDirection, OfflineOutcome } from "@/lib/events/onsiteEnums";
import { isOfflineOutcome } from "@/lib/events/onsiteEnums";

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
  /** Co urządzenie zdecydowało bez sieci (z listy offline); brak = bez decyzji. */
  offlineAdmitted?: boolean | null;
  offlineOutcome?: OfflineOutcome | null;
  /** Wersja listy offline, z której zapadła decyzja. */
  rosterGeneratedAt?: string | null;
  /** Urządzenie, pod którego poświadczeniem zapadł skan; brak = kolejka sprzed tej zmiany. */
  deviceId?: string | null;
}

/** Pozycja zdjęta z kolejki trwałą odmową - czeka na organizatora. */
export interface RejectedScan {
  item: OutboxItem;
  /** Komunikat bazy (z głową `kod:`), z którym pozycja została odrzucona. */
  error: string;
  rejectedAt: string;
}

/**
 * Sufit listy odrzuconych. MUSI być wyraźnie większy niż `OUTBOX_CAPACITY`:
 * unieważnione poświadczenie zrzuca na tę listę CAŁĄ kolejkę naraz, a sufit
 * równy pojemności kolejki wypchnąłby wtedy po cichu wszystko, co już na niej
 * leżało - dokładnie tę utratę, którą lista ma zamykać.
 */
export const REJECTED_CAPACITY = 2_000;

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Rekord z pamięci urządzenia -> pozycja kolejki. Pozycja bez identyfikatora,
 * kodu albo znanego rodzaju nie nadaje się do wysłania i wypada; brakujące
 * pola opcjonalne (kolejki sprzed decyzji offline) dostają wartości puste.
 */
export function parseOutboxItem(value: unknown): OutboxItem | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.code !== "string") return null;
  if (row.kind !== "checkin" && row.kind !== "lead") return null;
  const deviceScannedAt = stringOrNull(row.deviceScannedAt) ?? "";
  const outcome = stringOrNull(row.offlineOutcome);
  return {
    id: row.id,
    kind: row.kind,
    code: row.code,
    checkpointId: stringOrNull(row.checkpointId),
    direction: row.direction === "in" || row.direction === "out" ? row.direction : null,
    note: stringOrNull(row.note),
    interestRating: numberOrNull(row.interestRating),
    deviceScannedAt,
    attempts: numberOrNull(row.attempts) ?? 0,
    nextAttemptAt: stringOrNull(row.nextAttemptAt) ?? deviceScannedAt,
    lastError: stringOrNull(row.lastError),
    offlineAdmitted: typeof row.offlineAdmitted === "boolean" ? row.offlineAdmitted : null,
    offlineOutcome: outcome !== null && isOfflineOutcome(outcome) ? outcome : null,
    rosterGeneratedAt: stringOrNull(row.rosterGeneratedAt),
    deviceId: stringOrNull(row.deviceId),
  };
}

/** Po tylu nieudanych próbach pozycja idzie do „wymaga uwagi", nie w nieskończoność. */
export const OUTBOX_MAX_ATTEMPTS = 8;

/** Więcej i tak nie zmieści się w jednej zmianie wolontariusza przy bramce. */
export const OUTBOX_CAPACITY = 500;

/**
 * Odmowy, których ponawianie nie ma sensu - poświadczenie, nie sieć.
 *
 * `device_inactive` (wstrzymanie w panelu) celowo tu NIE stoi: jest odwracalne
 * jak blokada czasowa - po „Wznów" te same pozycje mają się wysłać.
 */
const PERMANENT_HEADS: readonly string[] = [
  "invalid_device_token",
  "device_revoked",
  "device_expired",
  "device_scope_missing",
  "device_checkpoint_mismatch",
  "checkpoint_not_found",
  "invalid_payload",
  "invalid_direction",
  // Skan sprzed ponad 7 dni - baza odrzuca go trwale (20260926150000).
  "device_time_out_of_range",
  // Pozycja zapisana pod INNYM poświadczeniem - odrzucana lokalnie, bez bazy.
  "device_mismatch",
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

export interface EnqueueResult {
  queue: OutboxItem[];
  /** Pozycje wypchnięte przepełnieniem - środowisko oddaje je jako odrzucone. */
  overflow: OutboxItem[];
}

/**
 * Dokłada skan do kolejki.
 *
 * LEADY SKLEJAMY PO KODZIE (i urządzeniu). Ten sam gość podchodzi do stoiska
 * trzy razy w ciągu minuty; trzy pozycje w kolejce dałyby trzy wywołania
 * i `scan_count` = 3 za jedno spotkanie. Odprawy NIE sklejamy - dwa piknięcia
 * na bramce to dwa zdarzenia, a o tym, czy drugie jest powtórzeniem, decyduje
 * okno w bazie. Lead spod innego poświadczenia to inny partner - nie sklejamy.
 */
export function enqueueScanWithOverflow(
  queue: readonly OutboxItem[],
  item: OutboxItem,
): EnqueueResult {
  if (item.kind === "lead") {
    const device = item.deviceId ?? null;
    const index = queue.findIndex(
      (row) => row.kind === "lead" && row.code === item.code && (row.deviceId ?? null) === device,
    );
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
      return { queue: next, overflow: [] };
    }
  }
  const next = [...queue, item];
  // Przepełnienie wypycha NAJSTARSZE pozycje: świeży skan jest wart więcej niż
  // ten sprzed godziny, którego i tak nie udało się wysłać. Wypchnięte wracają
  // do wołającego - nie w próżnię.
  if (next.length <= OUTBOX_CAPACITY) return { queue: next, overflow: [] };
  const cut = next.length - OUTBOX_CAPACITY;
  return { queue: next.slice(cut), overflow: next.slice(0, cut) };
}

/** `enqueueScanWithOverflow` bez wypchniętych - dla wołających, którym wystarcza kolejka. */
export function enqueueScan(queue: readonly OutboxItem[], item: OutboxItem): OutboxItem[] {
  return enqueueScanWithOverflow(queue, item).queue;
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

export interface OutboxFailure {
  queue: OutboxItem[];
  /** Pozycja zdjęta trwałą odmową - `null`, gdy zostaje w kolejce do ponowienia. */
  rejected: RejectedScan | null;
}

/**
 * Nieudana próba: licznik w górę, następny termin wg wycofania. Trwała odmowa
 * zdejmuje pozycję z kolejki i ODDAJE ją jako odrzuconą - nigdy w próżnię.
 */
export function withFailure(
  queue: readonly OutboxItem[],
  id: string,
  message: string,
  nowIso: string,
): OutboxFailure {
  if (isPermanentFailure(message)) {
    const item = queue.find((row) => row.id === id);
    return {
      queue: withoutItem(queue, id),
      rejected: item === undefined ? null : { item, error: message, rejectedAt: nowIso },
    };
  }
  return {
    queue: queue.map((item) => {
      if (item.id !== id) return item;
      const attempts = item.attempts + 1;
      return {
        ...item,
        attempts,
        lastError: message,
        nextAttemptAt: withDelay(nowIso, backoffDelayMs(attempts)),
      };
    }),
    rejected: null,
  };
}

/** Wszystkie pozycje naraz jako odrzucone - poświadczenie przestało działać. */
export function rejectAll(
  queue: readonly OutboxItem[],
  message: string,
  nowIso: string,
): RejectedScan[] {
  return queue.map((item) => ({ item, error: message, rejectedAt: nowIso }));
}

/** Dopisuje odrzucone na koniec listy; przepełnienie zjada najstarsze. */
export function appendRejected(
  list: readonly RejectedScan[],
  added: readonly RejectedScan[],
): RejectedScan[] {
  const next = [...list, ...added];
  return next.length > REJECTED_CAPACITY ? next.slice(next.length - REJECTED_CAPACITY) : next;
}

export interface OutboxCounts {
  pending: number;
  stuck: number;
}

export function outboxCounts(queue: readonly OutboxItem[]): OutboxCounts {
  const stuck = stuckItems(queue).length;
  return { pending: queue.length - stuck, stuck };
}
