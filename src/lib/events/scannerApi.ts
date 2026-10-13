// Płaszczyzna URZĄDZENIA: pięć RPC bramki, lista leadów i lista offline.
//
// TE FUNKCJE MAJĄ GRANT DLA `anon` I TO NIE JEST PRZEOCZENIE. Skaner na
// bramce nie ma konta - ma poświadczenie urządzenia. Dlatego każde wywołanie
// niesie `device_token` w ciele żądania, a baza sama wyprowadza z niego
// najemcę, wydarzenie, zakres i przypięty punkt kontrolny
// (`_event_scanner_device_auth`). NIE MA tu argumentu z identyfikatorem
// najemcy ani wydarzenia - i właśnie dlatego przechwycone poświadczenie nie
// otwiera cudzego kongresu.
//
// TOKEN NIE WCHODZI DO CACHE ZAPYTAŃ. React Query trzyma dane w pamięci strony
// i w narzędziach deweloperskich; poświadczenie bramki nie ma tam czego szukać,
// więc żaden `queryKey` w tym module go nie zawiera.
//
// ODPOWIEDŹ NIESIE MNIEJ NIŻ PANEL. `_event_onsite_person_card` celowo nie
// oddaje adresu poczty ani telefonu: bramka ich nie potrzebuje, a urządzenie
// bywa zgubione. Wyjątkiem jest skan leadu - tam dane kontaktowe wracają
// WYŁĄCZNIE przy udzielonej i niewycofanej zgodzie, i tak też je pokazujemy.
//
// KONTRAKT 20261013110500-110400 (OPS-04, OPS-08, OPS-12). Odpowiedzi niosą
// wynik `code_superseded` (kod zastąpiony - `superseded`, `display_name`),
// `denied_already_inside` i flagę ponownego wejścia (`reentry`,
// `reentry_previous_at`), zeskanowane poświadczenie (`credential`) i świeży
// znacznik kolejki (`queue_marker`). Konfiguracja i lista offline dostają
// w ładunku `client_caps` - baza wie, że ten klient stempluje kolejkę.
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { CheckinDirection } from "@/lib/events/onsiteEnums";
import { parseScannerSession, type ScannerSession } from "@/lib/events/scannerSession";
import { parseRosterPage, type RosterPage } from "@/lib/events/scannerRoster";
import {
  SCANNER_CLIENT_CAPS,
  parseQueueMarker,
  type QueueMarker,
} from "@/lib/events/scannerQueueMarker";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function nullableInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function payload(input: Record<string, unknown>): Json {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out as Json;
}

/* ------------------------------------------------------ termin żądania --- */

/**
 * Żądanie, na które nie przyszła odpowiedź w terminie.
 *
 * W przeglądarce `fetch` do bazy nie ma własnego terminu, a Wi-Fi z portalem
 * logowania albo zasięg „jedna kreska" potrafi trzymać żądanie minutami - przy
 * bramce to kręcące się kółko i kolejka ludzi. Po terminie skan idzie ścieżką
 * offline (kolejka + decyzja z listy), a spóźniona odpowiedź nic nie psuje:
 * ponowienie z kolejki niesie ten sam `client_scan_uid` i baza oddaje `replay`.
 * Komunikat NIE MA głowy `kod:` - dla klasyfikacji to błąd sieci (ponawiamy).
 */
export class ScannerTimeoutError extends Error {
  constructor() {
    super("Scanner request timed out");
    this.name = "ScannerTimeoutError";
  }
}

/** Obietnica z terminem: po `ms` odrzucenie `ScannerTimeoutError`. */
export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ScannerTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/* ----------------------------------------------------------- tożsamość --- */

/**
 * Konfiguracja skanera i świeży znacznik kolejki (OPS-12). Znacznik NIE jest
 * częścią sesji: środowisko zdejmuje go przed zapisem sesji i trzyma w sejfie
 * (`scannerQueueMarker.ts`), a sesja trafia do ekranu i pamięci podręcznej.
 */
export interface ScannerBootstrap extends ScannerSession {
  /** Brak = odpowiedź bez znacznika (starsza baza). */
  queueMarker?: QueueMarker | null;
}

/** Zdolności klienta w ładunku - baza wie, że ten klient stempluje kolejkę. */
function clientCaps(): string[] {
  return [...SCANNER_CLIENT_CAPS];
}

export async function bootstrapScanner(deviceToken: string): Promise<ScannerBootstrap> {
  const { data, error } = await supabase.rpc("event_scanner_bootstrap", {
    p_payload: payload({ device_token: deviceToken, client_caps: clientCaps() }),
  });
  if (error !== null) throw new Error(error.message);
  const session = parseScannerSession(data);
  if (session === null) throw new Error("invalid_device_token: bootstrap response is not readable");
  return { ...session, queueMarker: parseQueueMarker(data) };
}

/* -------------------------------------------------------------- osoba --- */

/** Minimum operatora bramki - bez adresu poczty i telefonu. Patrz nagłówek. */
export interface ScanPerson {
  personId: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  registrationId: string | null;
  registrationStatus: string | null;
  ticketNamePl: string | null;
  ticketNameEn: string | null;
  groupNamePl: string | null;
  groupNameEn: string | null;
  groupColor: string | null;
  badgePrinted: boolean;
  badgePrintedAt: string | null;
  badgePrintedVersion: number | null;
}

export function parseScanPerson(value: unknown): ScanPerson | null {
  if (value === null || value === undefined) return null;
  const row = record(value);
  if (Object.keys(row).length === 0) return null;
  return {
    personId: text(row.person_id),
    firstName: text(row.first_name),
    lastName: text(row.last_name),
    company: text(row.company),
    jobTitle: text(row.job_title),
    registrationId: text(row.registration_id),
    registrationStatus: text(row.registration_status),
    ticketNamePl: text(row.ticket_name_pl),
    ticketNameEn: text(row.ticket_name_en),
    groupNamePl: text(row.group_name_pl),
    groupNameEn: text(row.group_name_en),
    groupColor: text(row.group_color),
    badgePrinted: row.badge_printed === true,
    badgePrintedAt: text(row.badge_printed_at),
    badgePrintedVersion: nullableInt(row.badge_printed_version),
  };
}

export interface ScanCheckpointInfo {
  id: string | null;
  namePl: string | null;
  nameEn: string | null;
  kind: string | null;
  directionMode: string | null;
  accessMode: string | null;
  /** `allow` | `deny` (OPS-08); `null` = odpowiedź bez polityki. */
  reentryPolicy: string | null;
  capacity: number | null;
  occupancy: number | null;
}

function parseCheckpointInfo(value: unknown): ScanCheckpointInfo {
  const row = record(value);
  return {
    id: text(row.id),
    namePl: text(row.name_pl),
    nameEn: text(row.name_en),
    kind: text(row.kind),
    directionMode: text(row.direction_mode),
    accessMode: text(row.access_mode),
    reentryPolicy: text(row.reentry_policy),
    capacity: nullableInt(row.capacity),
    occupancy: nullableInt(row.occupancy),
  };
}

/* ------------------------------------------------------ kod zastąpiony --- */

/** Które poświadczenie zeskanowano: bilet (e-mail, portfel) czy wydrukowany identyfikator. */
export type ScanCredential = "ticket" | "badge";

/** Dlaczego kod przestał wpuszczać (OPS-04). */
export type SupersededReason = "reissued" | "revoked" | "invalidated";

/**
 * Kod ZASTĄPIONY (`code_superseded`): był ważny, ale zastąpił go nowszy
 * (dodruk identyfikatora, ponowne wydanie biletu), wyczyścił go zwrot albo
 * anulowanie, albo administrator unieważnił go jako zgubiony. Wartości spoza
 * słownika czytamy jako `null` - ekran pokazuje wtedy zdanie ogólne.
 */
export interface SupersededInfo {
  credential: ScanCredential | null;
  reason: SupersededReason | null;
  supersededAt: string | null;
}

function parseCredential(value: unknown): ScanCredential | null {
  return value === "ticket" || value === "badge" ? value : null;
}

function parseSuperseded(value: unknown): SupersededInfo | null {
  if (value === null || value === undefined) return null;
  const row = record(value);
  if (Object.keys(row).length === 0) return null;
  const reason = row.reason;
  return {
    credential: parseCredential(row.credential),
    reason:
      reason === "reissued" || reason === "revoked" || reason === "invalidated" ? reason : null,
    supersededAt: text(row.superseded_at),
  };
}

/* ------------------------------------------------------------ odprawa --- */

export interface CheckinScanResult {
  /**
   * `granted`, `repeat`, `unknown_code`, `wrong_event`, `code_superseded` albo
   * powód odmowy (w tym `denied_already_inside`).
   */
  outcome: string;
  /** JEDYNA odpowiedź na pytanie „wpuścić?" - liczy ją baza, nie ekran. */
  admit: boolean;
  /**
   * Co zrobiłaby baza bez decyzji urządzenia. Różni się od `admit` tylko przy
   * skanie, któremu urządzenie BEZ SIECI odmówiło, a baza by wpuściła: wiersz
   * trzyma odmowę bramki (człowieka odesłano, nie jest obecny), a to pole
   * mówi, że bilet był ważny - to jest konflikt „odesłany offline".
   */
  serverAdmit: boolean;
  result: string | null;
  checkinId: string | null;
  direction: CheckinDirection | null;
  occurredAt: string | null;
  repeatCount: number;
  previousCheckinAt: string | null;
  /** Urządzenie zablokowane po serii nieznanych kodów - ekran musi to podać. */
  deviceLocked: boolean;
  checkpoint: ScanCheckpointInfo;
  person: ScanPerson | null;
  /** Bilet z INNEGO wydarzenia tego samego najemcy - nazwa do komunikatu. */
  otherEventTitlePl: string | null;
  otherEventTitleEn: string | null;
  /**
   * Osoba była już W ŚRODKU punktu (OPS-08): przy polityce `allow` to zgoda na
   * PONOWNE wejście (osobny ton ekranu), przy `deny` powód
   * `denied_already_inside`. `false` przy pierwszym wejściu i przy wyjściu.
   */
  reentry: boolean;
  /** Chwila tamtego wejścia - ekran ją pokazuje. */
  reentryPreviousAt: string | null;
  /** Zeskanowane poświadczenie (bilet albo identyfikator). */
  credential: ScanCredential | null;
  /** Szczegóły `code_superseded`; `null` przy każdym innym wyniku. */
  superseded: SupersededInfo | null;
  /** Imię i nazwisko przy `code_superseded` (w terminie poświadczenia). */
  displayName: string | null;
  /** Świeży znacznik kolejki (OPS-12); brak = odpowiedź bez znacznika. */
  queueMarker?: QueueMarker | null;
}

function parseCheckinScan(value: unknown): CheckinScanResult {
  const row = record(value);
  const other = record(row.other_event);
  const direction = text(row.direction);
  return {
    outcome: text(row.outcome) ?? "unknown",
    admit: row.admit === true,
    // Odpowiedzi bez zapisu (`unknown_code`, `wrong_event`) nie niosą pola -
    // wtedy baza nie ma innego zdania niż `admit`.
    serverAdmit: typeof row.server_admit === "boolean" ? row.server_admit : row.admit === true,
    result: text(row.result),
    checkinId: text(row.checkin_id),
    direction: direction === "in" || direction === "out" ? direction : null,
    occurredAt: text(row.occurred_at),
    repeatCount: nullableInt(row.repeat_count) ?? 0,
    previousCheckinAt: text(row.previous_checkin_at),
    deviceLocked: row.device_locked === true,
    checkpoint: parseCheckpointInfo(row.checkpoint),
    person: parseScanPerson(row.person),
    otherEventTitlePl: text(other.title_pl),
    otherEventTitleEn: text(other.title_en),
    reentry: row.reentry === true,
    reentryPreviousAt: text(row.reentry_previous_at),
    credential: parseCredential(row.credential),
    superseded: parseSuperseded(row.superseded),
    displayName: text(row.display_name),
    queueMarker: parseQueueMarker(row),
  };
}

export interface CheckinScanInput {
  deviceToken: string;
  code: string;
  checkpointId?: string | null;
  direction?: CheckinDirection;
  /** Klucz idempotencji - ten sam przy każdym ponowieniu z kolejki. */
  clientScanUid?: string;
  /** Chwila SKANU, nie wysyłki - dziennik ma pokazać, kiedy ktoś stanął w bramce. */
  deviceScannedAt?: string;
  /** Skan z kolejki: nieznany kod nie liczy się do okna blokady urządzenia. */
  queued?: boolean;
  /** Decyzja urządzenia bez sieci (z listy offline) - baza ją utrwala. */
  offlineAdmitted?: boolean | null;
  offlineOutcome?: string | null;
  rosterGeneratedAt?: string | null;
  /**
   * Nieprzezroczysty znacznik kolejki (OPS-12) - ten, który był aktualny, gdy
   * pozycja trafiła do kolejki (`scannerQueueMarker.ts`). Bez niego baza po
   * terminie poświadczenia odrzuca skan (`device_expired`). Brak = pole nie
   * jedzie w ładunku.
   */
  queueMarker?: string | null;
}

/**
 * Podgląd decyzji BEZ zapisu w dzienniku.
 *
 * Potrzebny tam, gdzie operator najpierw patrzy na ekran, a dopiero potem
 * wpuszcza (kontrola wyrywkowa, wejście z listy gości). Zapisu nie robi, więc
 * nie potrzebuje klucza idempotencji.
 */
export async function resolveCheckinScan(input: CheckinScanInput): Promise<CheckinScanResult> {
  const { data, error } = await supabase.rpc("event_checkin_resolve", {
    p_payload: payload({
      device_token: input.deviceToken,
      code: input.code,
      checkpoint_id: input.checkpointId,
      direction: input.direction,
    }),
  });
  if (error !== null) throw new Error(error.message);
  return parseCheckinScan(data);
}

/** Zapis odprawy w dzienniku. Idempotentny po `client_scan_uid`. */
export async function recordCheckinScan(input: CheckinScanInput): Promise<CheckinScanResult> {
  const { data, error } = await supabase.rpc("event_checkin_record", {
    p_payload: payload({
      device_token: input.deviceToken,
      code: input.code,
      checkpoint_id: input.checkpointId,
      direction: input.direction,
      client_scan_uid: input.clientScanUid,
      device_scanned_at: input.deviceScannedAt,
      queued: input.queued,
      offline_admitted: input.offlineAdmitted,
      offline_outcome: input.offlineOutcome,
      roster_generated_at: input.rosterGeneratedAt,
      queue_marker: input.queueMarker,
    }),
  });
  if (error !== null) throw new Error(error.message);
  return parseCheckinScan(data);
}

/* --------------------------------------------------------------- lead --- */

/** Dane kontaktowe wracają WYŁĄCZNIE przy zgodzie - inaczej wszystko `null`. */
export interface LeadPerson {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
}

export interface LeadScanResult {
  outcome: string;
  leadId: string | null;
  scanCount: number;
  /** Zgoda na przekazanie danych partnerowi w chwili skanu. */
  consent: boolean;
  deviceLocked: boolean;
  person: LeadPerson | null;
  /** Szczegóły `code_superseded` - na stoisku bez imienia i nazwiska. */
  superseded: SupersededInfo | null;
  /** Świeży znacznik kolejki (OPS-12); brak = odpowiedź bez znacznika. */
  queueMarker?: QueueMarker | null;
}

function parseLeadPerson(value: unknown): LeadPerson | null {
  if (value === null || value === undefined) return null;
  const row = record(value);
  if (Object.keys(row).length === 0) return null;
  return {
    firstName: text(row.first_name),
    lastName: text(row.last_name),
    company: text(row.company),
    jobTitle: text(row.job_title),
    email: text(row.email),
    phone: text(row.phone),
  };
}

export interface LeadScanInput {
  deviceToken: string;
  code: string;
  note?: string | null;
  /** 1-5; baza odrzuca wartości spoza zakresu. */
  interestRating?: number | null;
  /**
   * Chwila skanu - baza przyjmuje skan sprzed terminu poświadczenia przez 72 h,
   * jeśli niesie znacznik kolejki (`queueMarker`).
   */
  deviceScannedAt?: string;
  queued?: boolean;
  /** Patrz `CheckinScanInput.queueMarker`. */
  queueMarker?: string | null;
}

export async function recordLeadScan(input: LeadScanInput): Promise<LeadScanResult> {
  const { data, error } = await supabase.rpc("event_lead_scan_record", {
    p_payload: payload({
      device_token: input.deviceToken,
      code: input.code,
      note: input.note,
      interest_rating: input.interestRating,
      device_scanned_at: input.deviceScannedAt,
      queued: input.queued,
      queue_marker: input.queueMarker,
    }),
  });
  if (error !== null) throw new Error(error.message);
  const row = record(data);
  return {
    outcome: text(row.outcome) ?? "unknown",
    leadId: text(row.lead_id),
    scanCount: nullableInt(row.scan_count) ?? 0,
    consent: row.consent === true,
    deviceLocked: row.device_locked === true,
    person: parseLeadPerson(row.person),
    superseded: parseSuperseded(row.superseded),
    queueMarker: parseQueueMarker(row),
  };
}

export interface LeadRow extends LeadPerson {
  leadId: string;
  firstScannedAt: string | null;
  lastScannedAt: string | null;
  scanCount: number;
  note: string | null;
  interestRating: number | null;
  consent: boolean;
}

export interface LeadListPage {
  totalCount: number;
  withConsentCount: number;
  rows: LeadRow[];
}

export async function fetchDeviceLeads(input: {
  deviceToken: string;
  limit: number;
  offset: number;
}): Promise<LeadListPage> {
  const { data, error } = await supabase.rpc("event_lead_scans_list", {
    p_payload: payload({
      device_token: input.deviceToken,
      limit: input.limit,
      offset: input.offset,
    }),
  });
  if (error !== null) throw new Error(error.message);
  const row = record(data);
  const rows = Array.isArray(row.rows) ? row.rows : [];
  return {
    totalCount: nullableInt(row.total_count) ?? 0,
    withConsentCount: nullableInt(row.with_consent_count) ?? 0,
    rows: rows.flatMap((item): LeadRow[] => {
      const lead = record(item);
      const leadId = text(lead.lead_id);
      if (leadId === null) return [];
      return [
        {
          leadId,
          firstScannedAt: text(lead.first_scanned_at),
          lastScannedAt: text(lead.last_scanned_at),
          scanCount: nullableInt(lead.scan_count) ?? 0,
          note: text(lead.note),
          interestRating: nullableInt(lead.interest_rating),
          consent: lead.consent === true,
          firstName: text(lead.first_name),
          lastName: text(lead.last_name),
          company: text(lead.company),
          jobTitle: text(lead.job_title),
          email: text(lead.email),
          phone: text(lead.phone),
        },
      ];
    }),
  };
}

/* ------------------------------------------------------- lista offline --- */

export interface RosterPageInput {
  deviceToken: string;
  /** `generated_at` poprzedniej synchronizacji - DOSŁOWNIE, jak przyszło. */
  since?: string;
  /** Kursor strony: identyfikator ostatniego zapisu poprzedniej strony. */
  after?: string;
  limit?: number;
}

/**
 * Strona listy offline (`event_scanner_roster`). Odpowiedź bez wersji
 * (`generated_at`) jest nieczytelna - lepiej zostać przy starej liście niż
 * nałożyć na nią pustkę.
 */
export async function fetchScannerRoster(input: RosterPageInput): Promise<RosterPage> {
  const { data, error } = await supabase.rpc("event_scanner_roster", {
    p_payload: payload({
      device_token: input.deviceToken,
      since: input.since,
      after: input.after,
      limit: input.limit,
      client_caps: clientCaps(),
    }),
  });
  if (error !== null) throw new Error(error.message);
  const page = parseRosterPage(data);
  if (page === null) throw new Error("roster_unreadable: roster response has no version");
  return page;
}

/* ------------------------------------------------------ identyfikator --- */

export interface BadgePrintScanResult {
  outcome: string;
  printId: string | null;
  templateId: string | null;
  templateVersion: number | null;
  copies: number;
  reason: string | null;
  previousPrints: number;
  deviceLocked: boolean;
  person: ScanPerson | null;
  /** Szczegóły `code_superseded` - kod zastąpiony nie drukuje i nie liczy się do blokady. */
  superseded: SupersededInfo | null;
}

export interface BadgePrintScanInput {
  deviceToken: string;
  code: string;
  templateId?: string | null;
  copies?: number;
  reason?: string | null;
}

export async function recordBadgePrintScan(
  input: BadgePrintScanInput,
): Promise<BadgePrintScanResult> {
  const { data, error } = await supabase.rpc("event_badge_print_record", {
    p_payload: payload({
      device_token: input.deviceToken,
      code: input.code,
      template_id: input.templateId,
      copies: input.copies,
      reason: input.reason,
    }),
  });
  if (error !== null) throw new Error(error.message);
  const row = record(data);
  return {
    outcome: text(row.outcome) ?? "unknown",
    printId: text(row.print_id),
    templateId: text(row.template_id),
    templateVersion: nullableInt(row.template_version),
    copies: nullableInt(row.copies) ?? 1,
    reason: text(row.reason),
    previousPrints: nullableInt(row.previous_prints) ?? 0,
    deviceLocked: row.device_locked === true,
    person: parseScanPerson(row.person),
    superseded: parseSuperseded(row.superseded),
  };
}
