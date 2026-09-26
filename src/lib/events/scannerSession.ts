// Sesja URZĄDZENIA skanującego: poświadczenie, wydarzenie, punkty kontrolne.
//
// TO JEST INNA PŁASZCZYZNA NIŻ RESZTA SERWISU. Skaner nie loguje się jako
// człowiek - przedstawia się TOKENEM URZĄDZENIA, a baza (`_event_scanner_device_auth`)
// wyprowadza z niego najemcę, wydarzenie, zakresy i przypięty punkt kontrolny.
// Ani najemcy, ani wydarzenia NIE DA SIĘ podać w żądaniu, więc przechwycone
// poświadczenie nie otwiera cudzego kongresu - otwiera dokładnie ten jeden,
// dla którego je wydano, do wygaśnięcia albo do unieważnienia.
//
// TOKEN JEST HASŁEM I TAK GO TRAKTUJEMY. Nie trafia do adresu (poza jednym
// wejściem z linku, który natychmiast czyścimy), nie trafia do cache zapytań,
// nie trafia do logów. Bramka bierze go z pamięci urządzenia i wkłada do
// ciała żądania.
//
// ZAKRES DECYDUJE O EKRANIE. Poświadczenie recepcji ma `checkin`, poświadczenie
// stoiska partnera ma `lead`, stanowisko druku ma `badge_print`. Pokazujemy
// tylko te tryby, które poświadczenie naprawdę niesie - inaczej wolontariusz
// klikałby w zakładkę, która zawsze kończy się odmową.
import type { CheckinDirection, ScannerScope } from "@/lib/events/onsiteEnums";
import { isScannerScope } from "@/lib/events/onsiteEnums";

/** Kształt tokenu wymuszany przez `_event_scanner_device_auth`. */
export const SCANNER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function isScannerToken(value: string): boolean {
  return SCANNER_TOKEN_PATTERN.test(value.trim());
}

export interface ScannerCheckpoint {
  id: string;
  namePl: string | null;
  nameEn: string | null;
  kind: string;
  directionMode: string;
  accessMode: string;
  capacity: number | null;
  dedupeWindowSeconds: number;
  sortOrder: number;
}

export interface ScannerEvent {
  id: string;
  slug: string | null;
  titlePl: string | null;
  titleEn: string | null;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
}

export interface ScannerSession {
  deviceId: string;
  label: string;
  scopes: ScannerScope[];
  expiresAt: string | null;
  /** Punkt przypięty do poświadczenia - operator nie może go zmienić. */
  pinnedCheckpointId: string | null;
  /** Partner, do którego należą skany leadów tego urządzenia. */
  sponsorId: string | null;
  event: ScannerEvent;
  checkpoints: ScannerCheckpoint[];
  /**
   * Zgoda administratora na listę offline NA TYM URZĄDZENIU. Bez niej skaner
   * nie pobiera listy osób i przy braku sieci tylko kolejkuje skany.
   */
  offlineRoster: boolean;
  /** Start ostatniego PEŁNEGO pobrania listy offline (informacyjnie). */
  rosterDownloadedAt: string | null;
  /** Zegar serwera w chwili odpowiedzi - z niego liczymy przesunięcie zegara. */
  serverNow: string | null;
}

/** Tryby ekranu - jeden na zakres poświadczenia. */
export const SCANNER_MODES = ["checkin", "lead", "badge"] as const;
export type ScannerMode = (typeof SCANNER_MODES)[number];

const MODE_SCOPE: Record<ScannerMode, ScannerScope> = {
  checkin: "checkin",
  lead: "lead",
  badge: "badge_print",
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function int(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function nullableInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function parseCheckpoints(value: unknown): ScannerCheckpoint[] {
  if (!Array.isArray(value)) return [];
  const out: ScannerCheckpoint[] = [];
  value.forEach((item, index) => {
    const row = record(item);
    const id = text(row.id);
    if (id === null) return;
    out.push({
      id,
      namePl: text(row.name_pl),
      nameEn: text(row.name_en),
      kind: text(row.kind) ?? "event_entry",
      directionMode: text(row.direction_mode) ?? "in_only",
      accessMode: text(row.access_mode) ?? "control",
      capacity: nullableInt(row.capacity),
      // Okno idempotencji z bazy - ekran pokazuje je operatorowi, żeby
      // „powtórzone piknięcie" nie wyglądało na awarię czytnika.
      dedupeWindowSeconds: int(row.dedupe_window_seconds, 0),
      sortOrder: int(row.sort_order, index),
    });
  });
  return out.sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Odpowiedź `event_scanner_bootstrap` -> sesja urządzenia.
 *
 * Zwraca `null`, gdy odpowiedź nie niesie ani identyfikatora urządzenia, ani
 * wydarzenia - bez tych dwóch rzeczy nie ma czego pokazać ani gdzie zapisać
 * skanu, a udawanie sesji kosztowałoby wolontariusza godzinę przy bramce.
 */
export function parseScannerSession(value: unknown): ScannerSession | null {
  const row = record(value);
  const deviceId = text(row.device_id);
  const event = record(row.event);
  const eventId = text(event.id);
  if (deviceId === null || eventId === null) return null;

  const scopes = Array.isArray(row.scopes)
    ? row.scopes.filter(
        (item): item is ScannerScope => typeof item === "string" && isScannerScope(item),
      )
    : [];

  return {
    deviceId,
    label: text(row.label) ?? "",
    scopes,
    expiresAt: text(row.expires_at),
    pinnedCheckpointId: text(row.pinned_checkpoint_id),
    sponsorId: text(row.sponsor_id),
    event: {
      id: eventId,
      slug: text(event.slug),
      titlePl: text(event.title_pl),
      titleEn: text(event.title_en),
      startsAt: text(event.starts_at),
      endsAt: text(event.ends_at),
      timezone: text(event.timezone),
    },
    checkpoints: parseCheckpoints(row.checkpoints),
    offlineRoster: row.offline_roster === true,
    rosterDownloadedAt: text(row.roster_downloaded_at),
    serverNow: text(row.server_now),
  };
}

/**
 * Sesja -> kształt odpowiedzi `event_scanner_bootstrap`.
 *
 * Pamięć podręczna sesji (zimny start bez sieci) trzyma SUROWY kształt bazy,
 * a nie obiekt aplikacji: odczyt przechodzi potem przez TEN SAM parser co
 * odpowiedź serwera, więc uszkodzony albo przestarzały rekord kończy się
 * `null` (ekran parowania), a nie sesją z dziurami. Tokenu tu nie ma.
 */
export function sessionToRecord(session: ScannerSession): Record<string, unknown> {
  return {
    device_id: session.deviceId,
    label: session.label,
    scopes: [...session.scopes],
    expires_at: session.expiresAt,
    pinned_checkpoint_id: session.pinnedCheckpointId,
    sponsor_id: session.sponsorId,
    offline_roster: session.offlineRoster,
    roster_downloaded_at: session.rosterDownloadedAt,
    server_now: session.serverNow,
    event: {
      id: session.event.id,
      slug: session.event.slug,
      title_pl: session.event.titlePl,
      title_en: session.event.titleEn,
      starts_at: session.event.startsAt,
      ends_at: session.event.endsAt,
      timezone: session.event.timezone,
    },
    checkpoints: session.checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      name_pl: checkpoint.namePl,
      name_en: checkpoint.nameEn,
      kind: checkpoint.kind,
      direction_mode: checkpoint.directionMode,
      access_mode: checkpoint.accessMode,
      capacity: checkpoint.capacity,
      dedupe_window_seconds: checkpoint.dedupeWindowSeconds,
      sort_order: checkpoint.sortOrder,
    })),
  };
}

/** Od tego przesunięcia zegara urządzenia ekran ostrzega operatora. */
export const CLOCK_SKEW_WARNING_MS = 90_000;

/**
 * Przesunięcie zegara urządzenia względem serwera (serwer − urządzenie, ms).
 *
 * Odpowiedź przyszła gdzieś między wysłaniem a odbiorem, więc porównujemy
 * `server_now` ze ŚRODKIEM tego odcinka. Bez `server_now` (starszy backend,
 * nieczytelna data) zakładamy zgodność - lepsze zero niż NaN w dzienniku.
 */
export function clockOffsetMs(
  serverNow: string | null,
  sentAtMs: number,
  receivedAtMs: number,
): number {
  if (serverNow === null) return 0;
  const server = Date.parse(serverNow);
  if (Number.isNaN(server)) return 0;
  return Math.round(server - (sentAtMs + receivedAtMs) / 2);
}

export function isClockSkewed(offsetMs: number): boolean {
  return Math.abs(offsetMs) > CLOCK_SKEW_WARNING_MS;
}

export function hasScope(session: ScannerSession, scope: ScannerScope): boolean {
  return session.scopes.includes(scope);
}

/** Tryby, które to poświadczenie naprawdę otwiera - w stałej kolejności. */
export function availableModes(session: ScannerSession): ScannerMode[] {
  return SCANNER_MODES.filter((mode) => hasScope(session, MODE_SCOPE[mode]));
}

export function modeScope(mode: ScannerMode): ScannerScope {
  return MODE_SCOPE[mode];
}

/**
 * Punkt kontrolny, od którego zaczyna ekran odprawy.
 *
 * Przypięcie z poświadczenia wygrywa zawsze - baza i tak odmówi zmiany
 * (`device_checkpoint_mismatch`), więc pokazywanie wyboru byłoby zaproszeniem
 * do błędu. Bez przypięcia bierzemy pierwszy punkt z listy, bo ekran bez
 * wybranego punktu nie umie wysłać ani jednego skanu.
 */
export function defaultCheckpointId(session: ScannerSession): string | null {
  if (session.pinnedCheckpointId !== null) return session.pinnedCheckpointId;
  return session.checkpoints[0]?.id ?? null;
}

export function findCheckpoint(
  session: ScannerSession,
  checkpointId: string | null,
): ScannerCheckpoint | null {
  if (checkpointId === null) return null;
  return session.checkpoints.find((checkpoint) => checkpoint.id === checkpointId) ?? null;
}

/** Kierunki, które da się zapisać na tym punkcie - lustro `direction_mode`. */
export function checkpointDirections(checkpoint: ScannerCheckpoint | null): CheckinDirection[] {
  if (checkpoint === null) return ["in"];
  if (checkpoint.directionMode === "out_only") return ["out"];
  if (checkpoint.directionMode === "in_out") return ["in", "out"];
  return ["in"];
}

/** Poświadczenie po terminie - ekran mówi o tym ZANIM ktoś zeskanuje bilet. */
export function isSessionExpired(session: ScannerSession, nowIso: string): boolean {
  if (session.expiresAt === null) return false;
  const expires = Date.parse(session.expiresAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(expires) || Number.isNaN(now)) return false;
  return expires <= now;
}

/** Ile godzin zostało do wygaśnięcia - `null`, gdy termin nie jest znany. */
export function hoursUntilExpiry(session: ScannerSession, nowIso: string): number | null {
  if (session.expiresAt === null) return null;
  const expires = Date.parse(session.expiresAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(expires) || Number.isNaN(now)) return null;
  return Math.floor((expires - now) / 3_600_000);
}
