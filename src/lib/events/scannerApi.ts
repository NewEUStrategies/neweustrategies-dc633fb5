// Płaszczyzna URZĄDZENIA: pięć RPC bramki i jedna lista leadów.
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
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { CheckinDirection } from "@/lib/events/onsiteEnums";
import { parseScannerSession, type ScannerSession } from "@/lib/events/scannerSession";

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

/* ----------------------------------------------------------- tożsamość --- */

export async function bootstrapScanner(deviceToken: string): Promise<ScannerSession> {
  const { data, error } = await supabase.rpc("event_scanner_bootstrap", {
    p_payload: payload({ device_token: deviceToken }),
  });
  if (error !== null) throw new Error(error.message);
  const session = parseScannerSession(data);
  if (session === null) throw new Error("invalid_device_token: bootstrap response is not readable");
  return session;
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
    capacity: nullableInt(row.capacity),
    occupancy: nullableInt(row.occupancy),
  };
}

/* ------------------------------------------------------------ odprawa --- */

export interface CheckinScanResult {
  /** `granted`, `repeat`, `unknown_code`, `wrong_event` albo powód odmowy. */
  outcome: string;
  /** JEDYNA odpowiedź na pytanie „wpuścić?" - liczy ją baza, nie ekran. */
  admit: boolean;
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
}

function parseCheckinScan(value: unknown): CheckinScanResult {
  const row = record(value);
  const other = record(row.other_event);
  const direction = text(row.direction);
  return {
    outcome: text(row.outcome) ?? "unknown",
    admit: row.admit === true,
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
}

export async function recordLeadScan(input: LeadScanInput): Promise<LeadScanResult> {
  const { data, error } = await supabase.rpc("event_lead_scan_record", {
    p_payload: payload({
      device_token: input.deviceToken,
      code: input.code,
      note: input.note,
      interest_rating: input.interestRating,
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
  };
}
