// Lista offline skanera i decyzja BEZ SIECI - reguła czysta, bez IO.
//
// PO CO. Skan w kolejce mówi operatorowi tylko „zapisano"; przy bramce w hali
// bez zasięgu to znaczy „zgaduj". Urządzenie, któremu administrator pozwolił
// (`event_scanner_devices.offline_roster`), trzyma listę biletów tego wydarzenia
// w postaci SKRÓTÓW SHA-256 i z niej podejmuje decyzję TYMCZASOWĄ, podpisaną na
// ekranie jako decyzja offline. Po powrocie sieci baza i tak liczy swój wynik,
// a rozbieżność trafia na listę konfliktów.
//
// DWA KODY NA ZAPIS, PLUS KODY ZASTĄPIONE (OPS-04, 20261013110800). Wiersz
// listy niesie skrót BILETU (`h`, może być `null` - identyfikator wydrukowany
// dla zapisu bez biletu), skrót IDENTYFIKATORA (`bh`) i skróty kodów
// ZASTĄPIONYCH (`sh`: stary identyfikator po dodruku, stary bilet po ponownym
// wydaniu albo unieważnieniu). Indeks (`buildRosterIndex`) zna oba ważne kody,
// a zastąpione trzyma OSOBNO - wcześniej klucz był wyłącznie `h`, więc offline
// każdy wydrukowany identyfikator był „nieznanym kodem" (recenzja R1/R3).
//
// DECYZJA JEST LUSTREM `_event_checkin_evaluate`, W TEJ SAMEJ KOLEJNOŚCI:
//   1. kod nieznany na liście        -> `unknown_code` (baza: brak zapisu z tym
//      skrótem; offline nie odróżni biletu z innego wydarzenia ani zapisu
//      anulowanego - obu na liście nie ma, więc też odmowa);
//   2. kod ZASTĄPIONY                -> `code_superseded` (odmowa; baza nie
//      liczy go do okna blokady i nie pisze wiersza dziennika - pozycja jedzie
//      do bazy BEZ decyzji offline, patrz `queuedOfflineDecision`);
//   3. kierunek sprzeczny z punktem  -> `denied_direction`;
//   4. status inny niż approved/attended -> `denied_registration_status`;
//   5. powtórzenie w oknie punktu    -> `repeat` (lustro `dedupe_range`: zgoda
//      na tym samym punkcie, dla tego samego zapisu i kierunku, bez zgody
//      w przeciwnym kierunku pomiędzy - wejście po wyjściu to nowe przejście);
//   6. wejście osoby, która JEST W ŚRODKU punktu z polityką `deny` (tryb
//      `control`) -> `denied_already_inside` (OPS-08). „W środku" liczymy
//      z dziennika zgód urządzenia tą samą regułą co baza
//      (`_event_checkin_inside_since`, 20261013111000): ostatnia zgoda osoby
//      na TYM punkcie w bieżącej dobie WYDARZENIA (strefa wydarzenia), nie
//      późniejsza niż skan, była wejściem; wyjście na tym punkcie i początek
//      nowej doby zerują stan (bramka tylko-wejście: jedno wejście dziennie).
//      Przy polityce `allow` to zgoda z `reentryPreviousAt` (ponowne wejście);
//   7. limit obecności               -> NIE egzekwujemy: urządzenie offline nie
//      widzi wejść z innych bramek, więc liczyłoby tylko własne. Ekran mówi
//      wprost, że limit jest nieweryfikowany (`approximateCapacity`);
//   8. w przeciwnym razie            -> `granted`.
// Nieaktywnego punktu offline nie ma - konfiguracja skanera zawiera wyłącznie
// punkty aktywne. Dziennik zna wyłącznie zgody TEGO urządzenia: wejście przez
// inną bramkę offline nie widzi - wtedy wpuszcza, a baza po synchronizacji
// zapisze drugie wejście jako konflikt `admitted_offline`.
// `admit` liczymy regułą bazy: zgoda albo punkt `track` z odmową statusu.
import type { CheckinDirection, OfflineOutcome } from "@/lib/events/onsiteEnums";
import { isCheckinDirection, isOfflineOutcome } from "@/lib/events/onsiteEnums";
import type { ScanPerson } from "@/lib/events/scannerApi";
import { parseQueueMarker, type QueueMarker } from "@/lib/events/scannerQueueMarker";
import {
  parseReentryPolicy,
  type CheckpointReentryUpdate,
  type ScannerCheckpoint,
} from "@/lib/events/scannerSession";
import { eventDayKey } from "@/lib/events/timezone";

/* --------------------------------------------------------------- wiersz --- */

/**
 * Wiersz listy offline - minimum z `event_scanner_roster`, bez kontaktu.
 * Kody WYŁĄCZNIE jako skróty SHA-256 (OPS-06) - nigdy jawnie.
 */
export interface RosterEntry {
  registrationId: string;
  /** sha256 (hex) tokenu BILETU; `null` = zapis bez biletu (sam identyfikator). */
  hash: string | null;
  /** sha256 (hex) kodu IDENTYFIKATORA (wydruk); `null` = identyfikatora nie wydano. */
  badgeHash: string | null;
  /** sha256 (hex) kodów ZASTĄPIONYCH tego zapisu - odmowa `code_superseded`. */
  supersededHashes: string[];
  status: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  ticketNamePl: string | null;
  ticketNameEn: string | null;
  groupNamePl: string | null;
  groupNameEn: string | null;
  groupColor: string | null;
  badgePrinted: boolean;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Skrót z pola wiersza: `null` = pola nie ma, `false` = jest, ale nie jest
 * skrótem SHA-256 (np. jawny kod) - taki wiersz nie trafia ani do decyzji,
 * ani na dysk.
 */
function hashField(value: unknown): string | null | false {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" && HASH_PATTERN.test(value) ? value : false;
}

/** Skróty zastąpione: tylko poprawne skróty, bez powtórzeń i bez ważnych kodów wiersza. */
function supersededField(value: unknown, live: ReadonlyArray<string | null>): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && HASH_PATTERN.test(item) && !live.includes(item)) out.add(item);
  }
  return [...out];
}

/**
 * Wiersz bez identyfikatora zapisu, statusu albo BEZ ŻADNEGO ważnego kodu
 * (ani biletu, ani identyfikatora) nie nadaje się do decyzji; wiersz z polem
 * kodu w innym kształcie niż skrót - też (to nie jest lista, którą znamy).
 * Lista zapisana przed OPS-04 ma samo `h` - czyta się tak jak dotąd.
 */
export function parseRosterEntry(value: unknown): RosterEntry | null {
  const row = record(value);
  const registrationId = text(row.r);
  const status = text(row.s);
  const hash = hashField(row.h);
  const badgeHash = hashField(row.bh);
  if (registrationId === null || status === null) return null;
  if (hash === false || badgeHash === false) return null;
  if (hash === null && badgeHash === null) return null;
  return {
    registrationId,
    hash,
    badgeHash,
    supersededHashes: supersededField(row.sh, [hash, badgeHash]),
    status,
    firstName: text(row.fn),
    lastName: text(row.ln),
    company: text(row.co),
    ticketNamePl: text(row.t_pl),
    ticketNameEn: text(row.t_en),
    groupNamePl: text(row.g_pl),
    groupNameEn: text(row.g_en),
    groupColor: text(row.gc),
    badgePrinted: row.bp === true,
  };
}

/** Wiersz w kształcie odpowiedzi RPC - do trwałego zapisu listy na urządzeniu. */
export function rosterEntryToRecord(entry: RosterEntry): Record<string, unknown> {
  return {
    r: entry.registrationId,
    h: entry.hash,
    bh: entry.badgeHash,
    sh: entry.supersededHashes.length === 0 ? null : [...entry.supersededHashes],
    s: entry.status,
    fn: entry.firstName,
    ln: entry.lastName,
    co: entry.company,
    t_pl: entry.ticketNamePl,
    t_en: entry.ticketNameEn,
    g_pl: entry.groupNamePl,
    g_en: entry.groupNameEn,
    gc: entry.groupColor,
    bp: entry.badgePrinted,
  };
}

function parseEntries(value: unknown): RosterEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const entry = parseRosterEntry(item);
    return entry === null ? [] : [entry];
  });
}

/* --------------------------------------------------------------- strona --- */

export interface RosterPage {
  /** Chwila serwera - DOSŁOWNY napis, bo wraca jako `since` (mikrosekundy). */
  generatedAt: string;
  full: boolean;
  /** Liczba aktywnych zapisów - tylko w pierwszej stronie pełnego pobrania. */
  total: number | null;
  nextAfter: string | null;
  rows: RosterEntry[];
  /** Identyfikatory zapisów usuniętych od `since` (anulowane, odrzucone). */
  removed: string[];
  /**
   * Polityki ponownego wejścia punktów tego urządzenia (OPS-08) - zmiana
   * w panelu dociera z deltą listy. Brak = baza ich nie przysłała (bez zmian).
   */
  checkpoints?: CheckpointReentryUpdate[] | null;
  /** Świeży znacznik kolejki (OPS-12); brak = odpowiedź bez znacznika. */
  queueMarker?: QueueMarker | null;
}

function parseCheckpointPolicies(value: unknown): CheckpointReentryUpdate[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item): CheckpointReentryUpdate[] => {
    const row = record(item);
    const id = text(row.id);
    return id === null ? [] : [{ id, reentryPolicy: parseReentryPolicy(row.reentry_policy) }];
  });
}

/** Odpowiedź `event_scanner_roster` -> strona; bez `generated_at` nie ma wersji. */
export function parseRosterPage(value: unknown): RosterPage | null {
  const row = record(value);
  const generatedAt = text(row.generated_at);
  if (generatedAt === null) return null;
  const removed = Array.isArray(row.removed)
    ? row.removed.filter((item): item is string => typeof item === "string" && item !== "")
    : [];
  return {
    generatedAt,
    full: row.full === true,
    total: typeof row.total === "number" && Number.isFinite(row.total) ? row.total : null,
    nextAfter: text(row.next_after),
    rows: parseEntries(row.rows),
    removed,
    checkpoints: parseCheckpointPolicies(row.checkpoints),
    queueMarker: parseQueueMarker(row),
  };
}

/**
 * Nakłada stronę na listę: usuwa `removed`, podmienia wiersze po zapisie
 * (nowy skrót po ponownym wydaniu biletu wypiera stary), dokłada nowe.
 */
export function applyRosterPage(rows: readonly RosterEntry[], page: RosterPage): RosterEntry[] {
  const drop = new Set<string>(page.removed);
  const next = new Map<string, RosterEntry>();
  for (const entry of rows) {
    if (!drop.has(entry.registrationId)) next.set(entry.registrationId, entry);
  }
  for (const entry of page.rows) next.set(entry.registrationId, entry);
  return [...next.values()];
}

/** Indeks do decyzji: skrót kodu -> wiersz, osobno kody ważne i zastąpione. */
export interface RosterIndex {
  /** Ważny bilet ALBO ważny identyfikator -> wiersz. */
  live: ReadonlyMap<string, RosterEntry>;
  /** Kod zastąpiony -> wiersz zapisu, do którego należał. */
  superseded: ReadonlyMap<string, RosterEntry>;
}

export function buildRosterIndex(rows: readonly RosterEntry[]): RosterIndex {
  const live = new Map<string, RosterEntry>();
  for (const entry of rows) {
    if (entry.hash !== null) live.set(entry.hash, entry);
    if (entry.badgeHash !== null) live.set(entry.badgeHash, entry);
  }
  // Ważny kod wygrywa z zastąpionym - ta sama kolejność co `_event_scanner_code_lookup`.
  const superseded = new Map<string, RosterEntry>();
  for (const entry of rows) {
    for (const hash of entry.supersededHashes) {
      if (!live.has(hash)) superseded.set(hash, entry);
    }
  }
  return { live, superseded };
}

/** Wynik szukania skrótu na liście. */
export interface RosterMatch {
  entry: RosterEntry | null;
  /** Kod był ważny, ale został zastąpiony - `entry` to zapis, do którego należał. */
  superseded: boolean;
}

export function matchRoster(index: RosterIndex, hash: string): RosterMatch {
  const live = index.live.get(hash);
  if (live !== undefined) return { entry: live, superseded: false };
  const old = index.superseded.get(hash);
  return old === undefined ? { entry: null, superseded: false } : { entry: old, superseded: true };
}

/* ------------------------------------------------------ lista na dysku --- */

export interface RosterSnapshot {
  deviceId: string;
  /** Wersja listy = `generated_at` PIERWSZEJ strony ostatniej synchronizacji. */
  generatedAt: string;
  rows: RosterEntry[];
  /**
   * Termin poświadczenia, pod którym lista została pobrana (OPS-06). Po nim
   * lista osób znika z urządzenia przy każdym starcie i na odstępie - także
   * wtedy, gdy nikt już nie otworzy skanera tym poświadczeniem. Brak = lista
   * sprzed tej zmiany albo poświadczenie bez terminu.
   */
  expiresAt?: string | null;
}

export function rosterSnapshotToRecord(snapshot: RosterSnapshot): Record<string, unknown> {
  return {
    deviceId: snapshot.deviceId,
    generatedAt: snapshot.generatedAt,
    expiresAt: snapshot.expiresAt ?? null,
    rows: snapshot.rows.map(rosterEntryToRecord),
  };
}

/** Rekord z IndexedDB -> lista; uszkodzony rekord to BRAK listy, nie pół listy. */
export function parseRosterSnapshot(value: unknown): RosterSnapshot | null {
  const row = record(value);
  const deviceId = text(row.deviceId);
  const generatedAt = text(row.generatedAt);
  if (deviceId === null || generatedAt === null || !Array.isArray(row.rows)) return null;
  const expiresAt = text(row.expiresAt);
  // Tylko gdy jest: lista bez terminu ma ten sam kształt co przed tą zmianą.
  return {
    deviceId,
    generatedAt,
    rows: parseEntries(row.rows),
    ...(expiresAt === null ? {} : { expiresAt }),
  };
}

/** Czy termin listy minął (`nowMs` na zegarze skorygowanym, gdy jest znany). */
export function isRosterExpired(
  snapshot: Pick<RosterSnapshot, "expiresAt">,
  nowMs: number,
): boolean {
  if (snapshot.expiresAt === null || snapshot.expiresAt === undefined) return false;
  const expires = Date.parse(snapshot.expiresAt);
  return !Number.isNaN(expires) && expires <= nowMs;
}

/** Po tylu minutach lista jest „nieświeża" - ekran mówi to operatorowi. */
export const ROSTER_STALE_MS = 15 * 60_000;

export type RosterState = "disabled" | "none" | "fresh" | "stale";

/**
 * Stan listy dla ekranu. `nowMs === null` (pierwszy render, zanim zegar jest
 * znany) daje wynik deterministyczny: lista, która JEST, liczy się za świeżą.
 */
export function rosterState(input: {
  enabled: boolean;
  generatedAt: string | null;
  nowMs: number | null;
}): RosterState {
  if (!input.enabled) return "disabled";
  if (input.generatedAt === null) return "none";
  if (input.nowMs === null) return "fresh";
  const generated = Date.parse(input.generatedAt);
  if (Number.isNaN(generated)) return "stale";
  return input.nowMs - generated > ROSTER_STALE_MS ? "stale" : "fresh";
}

/* ---------------------------------------------------------- synchronizacja --- */

export interface RosterFetchInput {
  since?: string;
  after?: string;
}

export type RosterFetcher = (input: RosterFetchInput) => Promise<RosterPage>;

function headOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const separator = message.indexOf(":");
  return (separator === -1 ? message : message.slice(0, separator)).trim();
}

async function drain(
  fetchPage: RosterFetcher,
  base: readonly RosterEntry[],
  since: string | undefined,
): Promise<{ generatedAt: string; rows: RosterEntry[] }> {
  const request = (after?: string): RosterFetchInput =>
    since === undefined ? { after } : { since, after };
  let page = await fetchPage(request());
  const generatedAt = page.generatedAt;
  let rows = applyRosterPage(base, page);
  while (page.nextAfter !== null) {
    page = await fetchPage(request(page.nextAfter));
    rows = applyRosterPage(rows, page);
  }
  return { generatedAt, rows };
}

/**
 * Pobiera listę: przyrost od poprzedniej wersji, a gdy baza każe zacząć od
 * nowa (`roster_resync_required`) albo poprzedniej wersji nie ma - całość.
 * Strony idą po kolei do końca; każdy inny błąd wychodzi do wołającego, który
 * zostawia poprzednią listę (lepsza lista sprzed minuty niż żadna).
 */
export async function syncRosterSnapshot(input: {
  deviceId: string;
  previous: RosterSnapshot | null;
  fetchPage: RosterFetcher;
  /** Termin poświadczenia - lista dziedziczy go jako własny termin na urządzeniu. */
  expiresAt?: string | null;
}): Promise<RosterSnapshot> {
  const { deviceId, previous, fetchPage } = input;
  const term = input.expiresAt ?? null;
  const expiry = term === null ? {} : { expiresAt: term };
  if (previous !== null && previous.deviceId === deviceId) {
    try {
      const delta = await drain(fetchPage, previous.rows, previous.generatedAt);
      return { deviceId, ...delta, ...expiry };
    } catch (error: unknown) {
      if (headOf(error) !== "roster_resync_required") throw error;
    }
  }
  const full = await drain(fetchPage, [], undefined);
  return { deviceId, ...full, ...expiry };
}

/* ------------------------------------------------ lokalny dziennik decyzji --- */

/** Ostatnie ZGODY urządzenia - do wykrycia powtórzenia i obecności bez sieci. */
export interface LocalDecisionLogEntry {
  checkpointId: string;
  registrationId: string;
  direction: CheckinDirection;
  at: string;
}

/**
 * Pojemność dziennika. Z jednego klucza (punkt, zapis, kierunek) dziennik
 * trzyma tylko NAJNOWSZĄ zgodę (`appendDecisionLog`), więc dwa tysiące wpisów
 * to tysiąc osób z wejściem i wyjściem na jednej bramce w ciągu doby. Wpis
 * wypchnięty przepełnieniem kosztuje tylko tyle, że ponowne wejście tej osoby
 * offline przejdzie - a baza po synchronizacji zapisze je jako konflikt.
 */
export const LOCAL_LOG_CAPACITY = 2000;
/**
 * Wiek wpisu: najdłuższa doba wydarzenia (25 h - jesienna zmiana czasu).
 * Reguła „w środku" (OPS-08) zeruje się z początkiem doby wydarzenia, więc
 * starszy wpis nie ma już żadnego znaczenia - ani dla obecności, ani dla okna
 * powtórzeń. Wcześniej 12 h: osoba, która weszła o 7:00, o 20:00 była dla
 * urządzenia „poza punktem" mimo polityki `deny`.
 */
export const LOCAL_LOG_MAX_AGE_MS = 25 * 3_600_000;

export function parseDecisionLog(value: unknown): LocalDecisionLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): LocalDecisionLogEntry[] => {
    const row = record(item);
    const checkpointId = text(row.checkpointId);
    const registrationId = text(row.registrationId);
    const at = text(row.at);
    const direction = typeof row.direction === "string" ? row.direction : "";
    if (checkpointId === null || registrationId === null || at === null) return [];
    if (!isCheckinDirection(direction)) return [];
    return [{ checkpointId, registrationId, direction, at }];
  });
}

function sameKey(a: LocalDecisionLogEntry, b: LocalDecisionLogEntry): boolean {
  return (
    a.checkpointId === b.checkpointId &&
    a.registrationId === b.registrationId &&
    a.direction === b.direction
  );
}

/**
 * Dopisuje zgodę: wycina wpisy starsze niż doba wydarzenia, starsze zgody tej
 * samej osoby na tym samym punkcie i w tym samym kierunku (obie reguły -
 * okno powtórzeń i „w środku" - czytają tylko najnowszą) i przycina do
 * pojemności.
 */
export function appendDecisionLog(
  log: readonly LocalDecisionLogEntry[],
  entry: LocalDecisionLogEntry,
  nowMs: number,
): LocalDecisionLogEntry[] {
  const entryAt = Date.parse(entry.at);
  let superseded = false;
  const fresh = log.filter((row) => {
    const at = Date.parse(row.at);
    if (Number.isNaN(at) || nowMs - at > LOCAL_LOG_MAX_AGE_MS) return false;
    if (!sameKey(row, entry)) return true;
    // Spóźniony wpis (starszy niż trzymany) nie wypiera nowszej zgody.
    if (at > entryAt) superseded = true;
    return at > entryAt;
  });
  const next = superseded ? fresh : [...fresh, entry];
  return next.length > LOCAL_LOG_CAPACITY ? next.slice(next.length - LOCAL_LOG_CAPACITY) : next;
}

/**
 * Od kiedy osoba jest W ŚRODKU punktu według dziennika urządzenia - lustro
 * reguły bazy (OPS-08): ostatnia zgoda tej osoby na TYM punkcie w bieżącej
 * dobie wydarzenia (strefa wydarzenia, nie telefonu) była wejściem. Wyjście
 * na tym punkcie zeruje stan, początek nowej doby też. Wpis „z przyszłości"
 * (zegar przestawiony wstecz) się nie liczy. `null` = nie jest w środku.
 */
export function insideSince(input: {
  log: readonly LocalDecisionLogEntry[];
  checkpointId: string;
  registrationId: string;
  nowMs: number;
  timezone: string | null | undefined;
}): string | null {
  const today = eventDayKey(new Date(input.nowMs).toISOString(), input.timezone);
  let last: LocalDecisionLogEntry | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;
  for (const row of input.log) {
    if (row.checkpointId !== input.checkpointId || row.registrationId !== input.registrationId) {
      continue;
    }
    const at = Date.parse(row.at);
    if (Number.isNaN(at) || at > input.nowMs || at < lastAt) continue;
    if (eventDayKey(row.at, input.timezone) !== today) continue;
    // Przy równej chwili wygrywa wpis dopisany później (dziennik rośnie w czasie).
    last = row;
    lastAt = at;
  }
  return last !== null && last.direction === "in" ? last.at : null;
}

/* --------------------------------------------------------------- decyzja --- */

/**
 * Wynik decyzji offline: wartości kolumny `offline_outcome` plus
 * `code_superseded`, którego baza w dzienniku nie zapisuje (kod zastąpiony
 * nie ma wiersza - patrz `queuedOfflineDecision`).
 */
export type OfflineDecisionOutcome = OfflineOutcome | "code_superseded";

export interface OfflineDecision {
  outcome: OfflineDecisionOutcome;
  /** Odpowiedź na „wpuścić?" według reguły bazy - TYMCZASOWA. */
  admit: boolean;
  entry: RosterEntry | null;
  rosterGeneratedAt: string;
  /** Punkt ma limit obecności, którego offline nie da się sprawdzić. */
  approximateCapacity: boolean;
  /**
   * Chwila poprzedniego wejścia osoby, która jest już w środku punktu -
   * powód `denied_already_inside` albo (polityka `allow`) ponowne wejście.
   * `null` = pierwsze wejście, wyjście albo osoba poza punktem.
   */
  reentryPreviousAt: string | null;
}

function directionDenied(checkpoint: ScannerCheckpoint, direction: CheckinDirection): boolean {
  return (
    (direction === "in" && checkpoint.directionMode === "out_only") ||
    (direction === "out" && checkpoint.directionMode === "in_only")
  );
}

/**
 * Powtórzone piknięcie: zgoda w tym samym kierunku w oknie punktu, BEZ zgody
 * w przeciwnym kierunku pomiędzy (lustro R6, 20261013111000). Wejście po
 * wyjściu w oknie to NOWE przejście, a nie „już odprawiony" - inaczej jeden
 * kod wpuszczałby dwie osoby, a dziennik nie wiedziałby, że ktoś jest w środku.
 */
function grantedWithinWindow(input: {
  log: readonly LocalDecisionLogEntry[];
  checkpoint: ScannerCheckpoint;
  registrationId: string;
  direction: CheckinDirection;
  nowMs: number;
}): boolean {
  const windowMs = input.checkpoint.dedupeWindowSeconds * 1000;
  if (windowMs <= 0) return false;
  const mine = input.log.filter(
    (row) =>
      row.checkpointId === input.checkpoint.id && row.registrationId === input.registrationId,
  );
  return mine.some((row) => {
    if (row.direction !== input.direction) return false;
    const at = Date.parse(row.at);
    if (!(input.nowMs >= at && input.nowMs - at < windowMs)) return false;
    return !mine.some((other) => {
      if (other.direction === input.direction) return false;
      const crossed = Date.parse(other.at);
      return crossed > at && crossed <= input.nowMs;
    });
  });
}

// DECYZJA PO STATUSIE WYSTARCZA, BO LISTA JEST JUZ PRZESIANA. Bramka online
// odsyla przyjete, ale nierozliczone zgloszenie (poza furtka organizatora),
// a `event_scanner_roster` takiego wiersza w ogole nie eksportuje (delta oddaje
// go w `removed`, 20261012181500, przeglad R45) - kod QR wydrukowany na nim
// wczesniej nie ma tu czego dopasowac i konczy sie `unknown_code`.
export function decideOffline(input: {
  entry: RosterEntry | null;
  /** Skrót znaleziony wśród kodów ZASTĄPIONYCH (`matchRoster`). */
  superseded?: boolean;
  checkpoint: ScannerCheckpoint;
  direction: CheckinDirection;
  log: readonly LocalDecisionLogEntry[];
  nowMs: number;
  rosterGeneratedAt: string;
  /** Strefa wydarzenia - doba, w której liczy się „w środku". */
  timezone?: string | null;
}): OfflineDecision {
  const { entry, checkpoint, direction, rosterGeneratedAt } = input;
  const approximateCapacity = direction === "in" && checkpoint.capacity !== null;
  const decision = (
    outcome: OfflineDecisionOutcome,
    admit: boolean,
    reentryPreviousAt: string | null = null,
  ): OfflineDecision => ({
    outcome,
    admit,
    entry,
    rosterGeneratedAt,
    approximateCapacity,
    reentryPreviousAt,
  });

  if (entry === null) return decision("unknown_code", false);
  if (input.superseded === true) return decision("code_superseded", false);
  if (directionDenied(checkpoint, direction)) return decision("denied_direction", false);
  if (entry.status !== "approved" && entry.status !== "attended") {
    return decision("denied_registration_status", checkpoint.accessMode === "track");
  }
  const repeat = grantedWithinWindow({
    log: input.log,
    checkpoint,
    registrationId: entry.registrationId,
    direction,
    nowMs: input.nowMs,
  });
  if (repeat) return decision("repeat", true);
  if (direction === "out") return decision("granted", true);
  const since = insideSince({
    log: input.log,
    checkpointId: checkpoint.id,
    registrationId: entry.registrationId,
    nowMs: input.nowMs,
    timezone: input.timezone,
  });
  if (
    since !== null &&
    checkpoint.accessMode === "control" &&
    checkpoint.reentryPolicy === "deny"
  ) {
    return decision("denied_already_inside", false, since);
  }
  return decision("granted", true, since);
}

/**
 * Decyzja offline w postaci, którą przyjmuje `event_checkin_record`
 * (`offline_admitted`, `offline_outcome`, `roster_generated_at`) - albo `null`,
 * gdy pozycja ma jechać BEZ decyzji: `code_superseded` nie jest wartością
 * `offline_outcome` (baza nie pisze wiersza dla kodu zastąpionego), więc
 * o takim skanie decyduje sama baza - i odpowiada tym samym `code_superseded`.
 */
export function queuedOfflineDecision(decision: OfflineDecision): {
  offlineAdmitted: boolean;
  offlineOutcome: OfflineOutcome;
  rosterGeneratedAt: string;
} | null {
  const outcome = decision.outcome;
  if (!isOfflineOutcome(outcome)) return null;
  return {
    offlineAdmitted: decision.admit,
    offlineOutcome: outcome,
    rosterGeneratedAt: decision.rosterGeneratedAt,
  };
}

/** Wiersz listy -> karta osoby (ta sama molekuła co dla odpowiedzi serwera). */
export function rosterEntryToPerson(entry: RosterEntry): ScanPerson {
  return {
    personId: null,
    firstName: entry.firstName,
    lastName: entry.lastName,
    company: entry.company,
    jobTitle: null,
    registrationId: entry.registrationId,
    registrationStatus: entry.status,
    ticketNamePl: entry.ticketNamePl,
    ticketNameEn: entry.ticketNameEn,
    groupNamePl: entry.groupNamePl,
    groupNameEn: entry.groupNameEn,
    groupColor: entry.groupColor,
    badgePrinted: entry.badgePrinted,
    badgePrintedAt: null,
    badgePrintedVersion: null,
  };
}
