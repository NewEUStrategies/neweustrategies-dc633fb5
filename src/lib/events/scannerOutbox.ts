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
// ODRZUCONA ZOSTAJE W KOLEJCE, DOPÓKI LISTA ODRZUCONYCH JEJ NIE PRZECHOWA.
// Kolejka (`nes-scanner`) i lista odrzuconych (`nes-scanner-offline`) to DWIE
// bazy IndexedDB - zapis do jednej nie jest atomowy z zapisem do drugiej.
// Usunięcie pozycji z kolejki w chwili odmowy oznaczało, że zamknięcie karty
// przed zapisem listy (albo lista żyjąca tylko w pamięci karty) gubiło skan.
// Dlatego `withFailure` i `markRejected` ZAMRAŻAJĄ pozycję (`rejectedAt`):
// nie jest już wysyłana, a środowisko zdejmuje ją (`withoutItems`) dopiero po
// TRWAŁYM zapisie listy odrzuconych. Pozycja zamrożona, której lista nie
// przechowała (start po zamknięciu karty), wraca na listę przy starcie
// (`reconcileRejected`).
//
// KLASYFIKACJA ODMOWY JEST JEDNA dla toru na żywo i kolejki
// (`scannerErrorKind.ts`) - wcześniej kolejka miała własną listę kodów
// i rozjeżdżała się z bramką przy każdym kodzie spoza niej.
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
//
// AWARIA PRZEJŚCIOWA NIE PROWADZI DO „WYMAGA UWAGI" (OPS-05). Wcześniej po
// ośmiu nieudanych próbach (4 + 8 + ... + 256 s, około 8,5 minuty) pozycja
// przestawała być ponawiana na zawsze, a jedyną akcją było „usuń". Portal
// Wi-Fi, jedna kreska zasięgu przy `navigator.onLine === true`, dziesięć minut
// awarii bazy albo trzydziestominutowa blokada urządzenia kończyły się więc
// utratą obecności i płatnych leadów. Teraz:
//   * awaria transportu, przekroczony termin, 5xx, blokada czasowa i dławik
//     (`OUTBOX_DISPOSITIONS`) to tylko WYCOFANIE: wykładnicze z losowym
//     rozrzutem, z sufitem minuty - bez limitu prób;
//   * `attempts` to wyłącznie wykładnik wycofania - kolejne przejściowe porażki
//     od ostatniego wyzerowania; zerują go powrót sieci, powrót karty na
//     wierzch, start aplikacji i przycisk „Ponów" (`resetBackoff`);
//   * jedyną drogą z kolejki poza wysłaniem jest TRWAŁA odmowa (lista
//     odrzuconych z eksportem) albo świadome usunięcie przez operatora.
//
// JAWNY KOD NIE WYCHODZI POZA PAMIĘĆ KARTY (OPS-06). `code` w pozycji żyje
// tylko w pamięci; magazyn zapisuje go zaszyfrowanego (`scannerVault.ts`).
// Pozycja ODRZUCONA (`RejectedItem`) nie ma kodu w ogóle - niesie skrót
// SHA-256 (`codeHash`, ten sam co `qr_token_hash` w bazie) i kilka pierwszych
// znaków (`codePrefix`): tyle wystarczy organizatorowi, a eksport krążący
// pocztą nie wpuści nikogo na salę.
//
// NOTATKA SPONSORA TEŻ NIE PRZECHODZI NA LISTĘ ODRZUCONYCH. W kolejce leży
// wyłącznie w sejfie (jak kod), a lista odrzuconych żyje poza sejfem: przeżywa
// unieważnienie poświadczenia (z nim znika token, czyli jedyny klucz) i jedzie
// w eksporcie JSON pocztą. Zaszyfrowana byłaby nieczytelna dokładnie wtedy, gdy
// trafia na listę (odmowa poświadczenia kasuje klucz), a jawna łamałaby obietnicę
// sejfu - więc odrzucony lead traci notatkę, tak jak kod i znacznik kolejki.
// Ekran ani eksport CSV i tak jej nie pokazywały.
//
// ZNACZNIK KOLEJKI (`queueMarker`, OPS-12) jest nieprzezroczysty: środowisko
// stempluje nim pozycję W CHWILI KOLEJKOWANIA (znacznik aktualny wtedy, nie
// przy wysyłce - patrz `scannerQueueMarker.ts`), kolejka go przechowa
// (zaszyfrowany, w części tajnej sejfu) i odeśle z ładunkiem przy wysyłce. Bez
// niego baza po terminie poświadczenia odrzuca skan (`device_expired`).
import type { CheckinDirection, OfflineOutcome } from "@/lib/events/onsiteEnums";
import { isOfflineOutcome } from "@/lib/events/onsiteEnums";
import {
  isPermanentScanError,
  scanErrorKind,
  scannerErrorHead,
  type ScanErrorKind,
} from "@/lib/events/scannerErrorKind";
import { codePrefixOf, isSealedBlob, type SealedBlob } from "@/lib/events/scannerVault";

export const OUTBOX_KINDS = ["checkin", "lead"] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

export interface OutboxItem {
  /** Dla odprawy JEST to `client_scan_uid` - klucz idempotencji w bazie. */
  id: string;
  kind: OutboxKind;
  /**
   * Jawny kod z biletu - WYŁĄCZNIE w pamięci karty; na dysku leży tylko
   * w zaszyfrowanym bloku. Pusty napis = kod niedostępny w tej karcie (blok
   * innego poświadczenia albo zapis bez sejfu) - taka pozycja nie wyjedzie.
   */
  code: string;
  /** sha256(btrim(kod)) - ten sam skrót co `qr_token_hash` w bazie i na liście offline. */
  codeHash?: string | null;
  /** Kilka pierwszych znaków kodu - to, co wolno pokazać i wyeksportować. */
  codePrefix?: string | null;
  checkpointId: string | null;
  direction: CheckinDirection | null;
  note: string | null;
  interestRating: number | null;
  /** Chwila SKANU, nie chwila wysyłki - to ona trafia do dziennika. */
  deviceScannedAt: string;
  /**
   * Kolejne PRZEJŚCIOWE porażki od ostatniego wyzerowania - wyłącznie wykładnik
   * wycofania. Nie ma sufitu i nie prowadzi do „wymaga uwagi" (patrz nagłówek).
   */
  attempts: number;
  /** Nie ponawiamy przed tą chwilą (wykładnicze wycofanie). */
  nextAttemptAt: string;
  lastError: string | null;
  /**
   * Znacznik kolejki aktualny w chwili, w której pozycja trafiła do kolejki -
   * odsyłany z ładunkiem przy wysyłce (OPS-12). Brak = pozycja sprzed tej
   * zmiany albo urządzenie, które nie dostało jeszcze żadnego znacznika.
   */
  queueMarker?: string | null;
  /**
   * Zaszyfrowana część tajna, której ta karta NIE otworzyła (blok spod innego
   * poświadczenia). Magazyn zapisuje ją z powrotem bez zmian, a środowisko
   * otwiera ją, gdy dostanie właściwy klucz.
   */
  sealed?: SealedBlob | null;
  /** Co urządzenie zdecydowało bez sieci (z listy offline); brak = bez decyzji. */
  offlineAdmitted?: boolean | null;
  offlineOutcome?: OfflineOutcome | null;
  /** Wersja listy offline, z której zapadła decyzja. */
  rosterGeneratedAt?: string | null;
  /** Urządzenie, pod którego poświadczeniem zapadł skan; brak = kolejka sprzed tej zmiany. */
  deviceId?: string | null;
  /**
   * Chwila trwałej odmowy. Pozycja z tym polem NIE jest już wysyłana - czeka,
   * aż lista odrzuconych zostanie trwale zapisana, i dopiero wtedy znika
   * z kolejki. Brak = pozycja żywa.
   */
  rejectedAt?: string | null;
}

/**
 * Pozycja na liście odrzuconych - BEZ jawnego kodu, notatki, bloku sejfu
 * i znacznika kolejki (patrz nagłówek). Do odnalezienia zgłoszenia wystarczą
 * `codeHash` i `codePrefix`.
 */
export type RejectedItem = Omit<OutboxItem, "code" | "note" | "sealed" | "queueMarker">;

/** Pola, które istnieją wyłącznie w sejfie kolejki - nigdy na liście odrzuconych. */
type VaultOnlyFields = Pick<OutboxItem, "code" | "note" | "sealed" | "queueMarker">;

/** Pozycja zdjęta z kolejki trwałą odmową - czeka na organizatora. */
export interface RejectedScan {
  item: RejectedItem;
  /** Komunikat bazy (z głową `kod:`), z którym pozycja została odrzucona. */
  error: string;
  rejectedAt: string;
}

/**
 * Pozycja kolejki -> wpis listy odrzuconych: kod i notatka znikają, zostają
 * skrót i prefiks (prefiks liczony z kodu, gdy pozycja go jeszcze nie miała).
 * JEDYNA droga na listę odrzuconych, do jej zapisu i do eksportu - pole spoza
 * `RejectedItem` (np. notatka z pamięci karty albo z rekordu sprzed tej zmiany)
 * nie przechodzi żadną z nich.
 */
export function toRejectedItem(item: OutboxItem | RejectedItem): RejectedItem {
  const source: Partial<VaultOnlyFields> & RejectedItem = item;
  const { code, note: _note, sealed: _sealed, queueMarker: _marker, ...rest } = source;
  const prefix =
    item.codePrefix ?? (typeof code === "string" && code !== "" ? codePrefixOf(code) : null);
  return { ...rest, codeHash: item.codeHash ?? null, codePrefix: prefix };
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
  const meta = parseItemMeta(value);
  if (meta === null) return null;
  const code = (value as Record<string, unknown>).code;
  if (typeof code !== "string") return null;
  return { ...meta, code };
}

/**
 * Wpis listy odrzuconych z dysku. Wpis zapisany przed tą zmianą niesie jawny
 * kod - wraca BEZ niego (prefiks liczony z kodu); skrót dolicza magazyn.
 */
export function parseRejectedItem(value: unknown): RejectedItem | null {
  const meta = parseItemMeta(value);
  if (meta === null) return null;
  const code = (value as Record<string, unknown>).code;
  return toRejectedItem({ ...meta, code: typeof code === "string" ? code : "" });
}

/**
 * Pola pozycji wspólne dla kolejki i listy odrzuconych - bez kodu. Pozycja
 * bez identyfikatora albo znanego rodzaju wypada.
 */
function parseItemMeta(value: unknown): Omit<OutboxItem, "code"> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string") return null;
  if (row.kind !== "checkin" && row.kind !== "lead") return null;
  const deviceScannedAt = stringOrNull(row.deviceScannedAt) ?? "";
  const outcome = stringOrNull(row.offlineOutcome);
  return {
    id: row.id,
    kind: row.kind,
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
    // Tylko gdy są: pozycja żywa nie dostaje pól, więc eksport odrzuconych
    // i zapisane kolejki mają ten sam kształt co przed tymi zmianami.
    ...(typeof row.rejectedAt === "string" ? { rejectedAt: row.rejectedAt } : {}),
    ...(typeof row.codeHash === "string" ? { codeHash: row.codeHash } : {}),
    ...(typeof row.codePrefix === "string" ? { codePrefix: row.codePrefix } : {}),
    ...(typeof row.queueMarker === "string" ? { queueMarker: row.queueMarker } : {}),
    ...(isSealedBlob(row.sealed) ? { sealed: row.sealed } : {}),
  };
}

/** Więcej i tak nie zmieści się w jednej zmianie wolontariusza przy bramce. */
export const OUTBOX_CAPACITY = 500;

/** Głowa komunikatu `kod: szczegóły` - ta sama, którą czyta klasyfikacja. */
export function errorHead(message: string): string {
  return scannerErrorHead(message);
}

/**
 * Odmowy, których ponawianie nie ma sensu: odmowa tej pozycji albo
 * poświadczenia. Wstrzymanie w panelu (`device_inactive`) i blokada czasowa
 * (`device_locked`) NIE są trwałe - po „Wznów" albo po minięciu blokady te
 * same pozycje mają się wysłać. Reguła wspólna z torem na żywo.
 */
export function isPermanentFailure(message: string): boolean {
  return isPermanentScanError(message);
}

/** Czy pozycja została już odrzucona i czeka tylko na trwały zapis listy. */
export function isRejectedItem(item: OutboxItem): boolean {
  return typeof item.rejectedAt === "string";
}

/* ------------------------------------------------- co robić z odmową --- */

/**
 * Co kolejka robi z błędem wysyłki - tabela, nie łańcuch warunków:
 *   * `retry`          - przejściowe: wycofanie BEZ limitu prób;
 *   * `hold`           - wstrzymanie w panelu: przebieg staje, pozycje nietknięte;
 *   * `reject`         - odmowa TEJ pozycji: na listę odrzuconych;
 *   * `reject_all`     - poświadczenie unieważnione: cała kolejka na listę, koniec sesji;
 *   * `reject_expired` - termin poświadczenia: baza liczy go PER POZYCJA (skan
 *                        sprzed terminu przechodzi jeszcze 72 h), więc odrzucamy
 *                        tę pozycję, ekran przechodzi w „wygasło", reszta jedzie.
 */
export type OutboxDisposition = "retry" | "hold" | "reject" | "reject_all" | "reject_expired";

export const OUTBOX_DISPOSITIONS: Readonly<Record<ScanErrorKind, OutboxDisposition>> = {
  transport: "retry",
  locked: "retry",
  throttled: "retry",
  paused: "hold",
  session: "reject_all",
  refused: "reject",
};

/** Wyjątki od klasy - po głowie `kod:` (termin jest klasy `session`, ale liczy się per pozycja). */
const DISPOSITION_BY_HEAD: Readonly<Partial<Record<string, OutboxDisposition>>> = {
  device_expired: "reject_expired",
};

export function outboxDisposition(error: unknown): OutboxDisposition {
  return DISPOSITION_BY_HEAD[scannerErrorHead(error)] ?? OUTBOX_DISPOSITIONS[scanErrorKind(error)];
}

/**
 * Porażka dotyczy CAŁEGO urządzenia (blokada czasowa, dławik) - następna
 * pozycja w tym przebiegu dostałaby to samo, więc przebieg staje.
 */
export function stopsFlushRun(error: unknown): boolean {
  const kind = scanErrorKind(error);
  return kind === "locked" || kind === "throttled";
}

/* --------------------------------------------------------- wycofanie --- */

/** Sufit wycofania: po powrocie sieci nic nie czeka dłużej niż minutę (plus odstęp tyknięcia). */
export const OUTBOX_BACKOFF_CAP_MS = 60_000;

/** Wycofanie bez rozrzutu: 2 s, 4 s, 8 s … do minuty. */
export function backoffBaseMs(attempts: number): number {
  const step = Math.min(Math.max(attempts, 0), 16);
  return Math.min(2_000 * 2 ** step, OUTBOX_BACKOFF_CAP_MS);
}

/**
 * Wycofanie z losowym rozrzutem w przedziale [połowa, całość] - dwadzieścia
 * telefonów, którym sieć wróciła w tej samej sekundzie, nie uderza w bazę
 * w tej samej sekundzie. Nigdy powyżej `OUTBOX_BACKOFF_CAP_MS`.
 */
export function backoffDelayMs(attempts: number, random: () => number = Math.random): number {
  const base = backoffBaseMs(attempts);
  const spread = Math.min(Math.max(random(), 0), 1);
  return Math.round(base / 2 + (base / 2) * spread);
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
      const marker = item.queueMarker ?? next[index].queueMarker;
      next[index] = {
        ...next[index],
        // Notatka i ocena z NOWSZEGO skanu wygrywają, ale nie kasują starszych
        // wartości pustką - operator dopisuje notatkę już po zeskanowaniu.
        note: item.note ?? next[index].note,
        interestRating: item.interestRating ?? next[index].interestRating,
        deviceScannedAt: item.deviceScannedAt,
        // Chwila skanu przechodzi na nowszy skan, więc znacznik też: baza
        // sprawdza je RAZEM (skan najwyżej kwadrans przed wydaniem znacznika).
        ...(marker === undefined ? {} : { queueMarker: marker }),
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
    .filter((item) => !isRejectedItem(item))
    .filter((item) => {
      const due = Date.parse(item.nextAttemptAt);
      return Number.isNaN(due) || due <= stamp;
    })
    .sort((a, b) => Date.parse(a.deviceScannedAt) - Date.parse(b.deviceScannedAt));
}

/**
 * Pozycje, które przestały być ponawiane - ekran musi je pokazać człowiekowi.
 * Po OPS-05 jest to WYŁĄCZNIE pozycja odrzucona, której lista odrzuconych NIE
 * przechowała trwale (np. prywatne okno): zostaje widoczna z powodem
 * i przyciskiem „usuń", zamiast zniknąć razem z kartą. Awaria przejściowa
 * nigdy tu nie prowadzi.
 */
export function stuckItems(queue: readonly OutboxItem[]): OutboxItem[] {
  return queue.filter(isRejectedItem);
}

/** Pozycje żywe, których ostatnia próba się nie udała - ekran daje przy nich „Ponów". */
export function retryingItems(queue: readonly OutboxItem[]): OutboxItem[] {
  return queue.filter((item) => !isRejectedItem(item) && item.lastError !== null);
}

/**
 * Zeruje wycofanie pozycji żywych (wszystkich albo wskazanych): powrót sieci,
 * powrót karty na wierzch, start aplikacji, „Ponów". Gdy nic się nie zmienia,
 * oddaje TĘ SAMĄ tablicę - wołający nie zapisuje kolejki bez potrzeby.
 */
export function resetBackoff(
  queue: readonly OutboxItem[],
  nowIso: string,
  ids?: readonly string[],
): readonly OutboxItem[] {
  const only = ids === undefined ? null : new Set(ids);
  const now = Date.parse(nowIso);
  let changed = false;
  const next = queue.map((item) => {
    if (isRejectedItem(item) || (only !== null && !only.has(item.id))) return item;
    const due = Date.parse(item.nextAttemptAt);
    if (item.attempts === 0 && !Number.isNaN(due) && due <= now) return item;
    changed = true;
    return { ...item, attempts: 0, nextAttemptAt: nowIso };
  });
  return changed ? next : queue;
}

export function withoutItem(queue: readonly OutboxItem[], id: string): OutboxItem[] {
  return queue.filter((item) => item.id !== id);
}

/** Kolejka bez pozycji o podanych identyfikatorach (zdjęcie po trwałym zapisie). */
export function withoutItems(queue: readonly OutboxItem[], ids: readonly string[]): OutboxItem[] {
  if (ids.length === 0) return [...queue];
  const drop = new Set(ids);
  return queue.filter((item) => !drop.has(item.id));
}

/** Zamraża pozycje odrzucone hurtem (`rejectAll`) - zostają do trwałego zapisu listy. */
export function markRejected(
  queue: readonly OutboxItem[],
  rejected: readonly RejectedScan[],
): OutboxItem[] {
  const byId = new Map(rejected.map((entry) => [entry.item.id, entry]));
  return queue.map((item) => {
    const entry = byId.get(item.id);
    if (entry === undefined || isRejectedItem(item)) return item;
    return { ...item, lastError: entry.error, rejectedAt: entry.rejectedAt };
  });
}

export interface RejectedReconciliation {
  /** Zamrożone pozycje, których lista odrzuconych nie zna - trzeba je dopisać. */
  orphans: RejectedScan[];
  /** Zamrożone pozycje, które lista już przechowuje - można zdjąć z kolejki. */
  settled: string[];
}

/**
 * Start po zamknięciu karty: zamrożona pozycja mogła nie doczekać zapisu listy
 * odrzuconych. Taka wraca na listę z tym samym powodem i chwilą; ta, którą
 * lista już ma, schodzi z kolejki. Pozycje żywe nie są dotykane.
 */
export function reconcileRejected(
  queue: readonly OutboxItem[],
  rejected: readonly RejectedScan[],
): RejectedReconciliation {
  const known = new Set(rejected.map((entry) => entry.item.id));
  const orphans: RejectedScan[] = [];
  const settled: string[] = [];
  for (const item of queue) {
    if (!isRejectedItem(item)) continue;
    if (known.has(item.id)) {
      settled.push(item.id);
      continue;
    }
    const { rejectedAt, ...live } = item;
    orphans.push({
      item: toRejectedItem(live),
      error: item.lastError ?? "",
      rejectedAt: rejectedAt ?? "",
    });
  }
  return { orphans, settled };
}

export interface OutboxFailure {
  queue: OutboxItem[];
  /** Pozycja zdjęta trwałą odmową - `null`, gdy zostaje w kolejce do ponowienia. */
  rejected: RejectedScan | null;
}

/**
 * Nieudana próba. Trwała odmowa ZAMRAŻA pozycję w kolejce (`rejectedAt`)
 * i ODDAJE ją jako odrzuconą (bez jawnego kodu) - z kolejki zdejmuje ją
 * środowisko, dopiero gdy lista odrzuconych zapisze ją trwale (patrz nagłówek).
 * Porażka przejściowa przesuwa wyłącznie termin następnej próby: wykładnik
 * wycofania w górę, sufit minuty, BEZ limitu prób. Nigdy w próżnię.
 */
export function withFailure(
  queue: readonly OutboxItem[],
  id: string,
  message: string,
  nowIso: string,
  random: () => number = Math.random,
): OutboxFailure {
  if (isPermanentFailure(message)) {
    const item = queue.find((row) => row.id === id);
    if (item === undefined) return { queue: [...queue], rejected: null };
    return {
      queue: queue.map((row) =>
        row.id === id ? { ...row, lastError: message, rejectedAt: nowIso } : row,
      ),
      rejected: { item: toRejectedItem(item), error: message, rejectedAt: nowIso },
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
        nextAttemptAt: withDelay(nowIso, backoffDelayMs(attempts, random)),
      };
    }),
    rejected: null,
  };
}

/**
 * Wszystkie ŻYWE pozycje naraz jako odrzucone - poświadczenie przestało
 * działać. Pozycja już zamrożona jest na liście odrzuconych (czeka tylko na jej
 * zapis), więc drugi wpis byłby duplikatem w eksporcie dla organizatora.
 */
export function rejectAll(
  queue: readonly OutboxItem[],
  message: string,
  nowIso: string,
): RejectedScan[] {
  return queue
    .filter((item) => !isRejectedItem(item))
    .map((item) => ({ item: toRejectedItem(item), error: message, rejectedAt: nowIso }));
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
