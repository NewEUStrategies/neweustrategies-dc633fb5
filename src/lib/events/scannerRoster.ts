// Lista offline skanera i decyzja BEZ SIECI - reguła czysta, bez IO.
//
// PO CO. Skan w kolejce mówi operatorowi tylko „zapisano"; przy bramce w hali
// bez zasięgu to znaczy „zgaduj". Urządzenie, któremu administrator pozwolił
// (`event_scanner_devices.offline_roster`), trzyma listę biletów tego wydarzenia
// w postaci SKRÓTÓW SHA-256 i z niej podejmuje decyzję TYMCZASOWĄ, podpisaną na
// ekranie jako decyzja offline. Po powrocie sieci baza i tak liczy swój wynik,
// a rozbieżność trafia na listę konfliktów.
//
// DECYZJA JEST LUSTREM `_event_checkin_evaluate`, W TEJ SAMEJ KOLEJNOŚCI:
//   1. kod nieznany na liście        -> `unknown_code` (baza: brak zapisu z tym
//      skrótem; offline nie odróżni biletu z innego wydarzenia ani zapisu
//      anulowanego - obu na liście nie ma, więc też odmowa);
//   2. kierunek sprzeczny z punktem  -> `denied_direction`;
//   3. status inny niż approved/attended -> `denied_registration_status`;
//   4. limit obecności               -> NIE egzekwujemy: urządzenie offline nie
//      widzi wejść z innych bramek, więc liczyłoby tylko własne. Ekran mówi
//      wprost, że limit jest nieweryfikowany (`approximateCapacity`);
//   5. w przeciwnym razie            -> `granted`.
// Nieaktywnego punktu offline nie ma - konfiguracja skanera zawiera wyłącznie
// punkty aktywne. Powtórzenie (`repeat`) to ZGODA na tym samym punkcie, dla
// tego samego zapisu i kierunku w oknie punktu (lustro `dedupe_range`).
// `admit` liczymy regułą bazy: zgoda albo punkt `track` z odmową statusu.
import type { CheckinDirection, OfflineOutcome } from "@/lib/events/onsiteEnums";
import { isCheckinDirection } from "@/lib/events/onsiteEnums";
import type { ScanPerson } from "@/lib/events/scannerApi";
import type { ScannerCheckpoint } from "@/lib/events/scannerSession";

/* --------------------------------------------------------------- wiersz --- */

/** Wiersz listy offline - minimum z `event_scanner_roster`, bez kontaktu. */
export interface RosterEntry {
  registrationId: string;
  /** sha256 (hex) tokenu biletu. */
  hash: string;
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

/** Wiersz bez identyfikatora, skrótu albo statusu nie nadaje się do decyzji. */
export function parseRosterEntry(value: unknown): RosterEntry | null {
  const row = record(value);
  const registrationId = text(row.r);
  const hash = text(row.h);
  const status = text(row.s);
  if (registrationId === null || hash === null || status === null) return null;
  if (!HASH_PATTERN.test(hash)) return null;
  return {
    registrationId,
    hash,
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

/** Indeks do decyzji: skrót tokenu -> wiersz. */
export function buildRosterIndex(rows: readonly RosterEntry[]): Map<string, RosterEntry> {
  return new Map(rows.map((entry) => [entry.hash, entry]));
}

/* ------------------------------------------------------ lista na dysku --- */

export interface RosterSnapshot {
  deviceId: string;
  /** Wersja listy = `generated_at` PIERWSZEJ strony ostatniej synchronizacji. */
  generatedAt: string;
  rows: RosterEntry[];
}

export function rosterSnapshotToRecord(snapshot: RosterSnapshot): Record<string, unknown> {
  return {
    deviceId: snapshot.deviceId,
    generatedAt: snapshot.generatedAt,
    rows: snapshot.rows.map(rosterEntryToRecord),
  };
}

/** Rekord z IndexedDB -> lista; uszkodzony rekord to BRAK listy, nie pół listy. */
export function parseRosterSnapshot(value: unknown): RosterSnapshot | null {
  const row = record(value);
  const deviceId = text(row.deviceId);
  const generatedAt = text(row.generatedAt);
  if (deviceId === null || generatedAt === null || !Array.isArray(row.rows)) return null;
  return { deviceId, generatedAt, rows: parseEntries(row.rows) };
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
}): Promise<RosterSnapshot> {
  const { deviceId, previous, fetchPage } = input;
  if (previous !== null && previous.deviceId === deviceId) {
    try {
      const delta = await drain(fetchPage, previous.rows, previous.generatedAt);
      return { deviceId, ...delta };
    } catch (error: unknown) {
      if (headOf(error) !== "roster_resync_required") throw error;
    }
  }
  const full = await drain(fetchPage, [], undefined);
  return { deviceId, ...full };
}

/* ------------------------------------------------ lokalny dziennik decyzji --- */

/** Ostatnie ZGODY urządzenia - do wykrycia powtórzenia bez sieci. */
export interface LocalDecisionLogEntry {
  checkpointId: string;
  registrationId: string;
  direction: CheckinDirection;
  at: string;
}

/** Więcej niż zmiana przy bramce; starsze wpisy nie mają żadnego okna. */
export const LOCAL_LOG_CAPACITY = 1000;
export const LOCAL_LOG_MAX_AGE_MS = 12 * 3_600_000;

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

/** Dopisuje zgodę; wycina wpisy starsze niż 12 h i przycina do pojemności. */
export function appendDecisionLog(
  log: readonly LocalDecisionLogEntry[],
  entry: LocalDecisionLogEntry,
  nowMs: number,
): LocalDecisionLogEntry[] {
  const fresh = log.filter((row) => {
    const at = Date.parse(row.at);
    return !Number.isNaN(at) && nowMs - at <= LOCAL_LOG_MAX_AGE_MS;
  });
  const next = [...fresh, entry];
  return next.length > LOCAL_LOG_CAPACITY ? next.slice(next.length - LOCAL_LOG_CAPACITY) : next;
}

/* --------------------------------------------------------------- decyzja --- */

export interface OfflineDecision {
  outcome: OfflineOutcome;
  /** Odpowiedź na „wpuścić?" według reguły bazy - TYMCZASOWA. */
  admit: boolean;
  entry: RosterEntry | null;
  rosterGeneratedAt: string;
  /** Punkt ma limit obecności, którego offline nie da się sprawdzić. */
  approximateCapacity: boolean;
}

function directionDenied(checkpoint: ScannerCheckpoint, direction: CheckinDirection): boolean {
  return (
    (direction === "in" && checkpoint.directionMode === "out_only") ||
    (direction === "out" && checkpoint.directionMode === "in_only")
  );
}

function grantedWithinWindow(input: {
  log: readonly LocalDecisionLogEntry[];
  checkpoint: ScannerCheckpoint;
  registrationId: string;
  direction: CheckinDirection;
  nowMs: number;
}): boolean {
  const windowMs = input.checkpoint.dedupeWindowSeconds * 1000;
  if (windowMs <= 0) return false;
  return input.log.some((row) => {
    if (row.checkpointId !== input.checkpoint.id) return false;
    if (row.registrationId !== input.registrationId || row.direction !== input.direction) {
      return false;
    }
    const at = Date.parse(row.at);
    return input.nowMs >= at && input.nowMs - at < windowMs;
  });
}

export function decideOffline(input: {
  entry: RosterEntry | null;
  checkpoint: ScannerCheckpoint;
  direction: CheckinDirection;
  log: readonly LocalDecisionLogEntry[];
  nowMs: number;
  rosterGeneratedAt: string;
}): OfflineDecision {
  const { entry, checkpoint, direction, rosterGeneratedAt } = input;
  const approximateCapacity = direction === "in" && checkpoint.capacity !== null;
  const decision = (outcome: OfflineOutcome, admit: boolean): OfflineDecision => ({
    outcome,
    admit,
    entry,
    rosterGeneratedAt,
    approximateCapacity,
  });

  if (entry === null) return decision("unknown_code", false);
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
  return decision(repeat ? "repeat" : "granted", true);
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
