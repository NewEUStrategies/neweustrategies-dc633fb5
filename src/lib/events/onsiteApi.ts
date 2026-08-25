// Warstwa dostepu do modulu ON-SITE (odprawa, punkty kontrolne, urzadzenia
// skanujace, identyfikatory, leady sponsorskie).
//
// KAZDE ZAPYTANIE IDZIE PRZEZ RPC Z BRAMKA ROLI. Tabele `event_checkins`,
// `event_scanner_devices` i `event_lead_scans` nie sa czytane bezposrednio z
// klienta - decyzja o wpuszczeniu, tozsamosc urzadzenia i zgody marketingowe
// nie moga zalezec od tego, co klient wysle w filtrze.
//
// TOKEN URZADZENIA WRACA DOKLADNIE RAZ. `admin_event_scanner_device_issue`
// zwraca jawny token w odpowiedzi i nie istnieje funkcja, ktora pokaze go
// ponownie; dlatego wynik wydania ma wlasny typ i UI musi go pokazac od razu.
//
// UNDEFINED = „nie dotykaj", NULL = „wyczysc". Ta sama konwencja co w
// pozostalych modulach wydarzen: `args`/`payload` usuwaja `undefined`, a
// jawny `null` jedzie do bazy.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];

export type EventCheckpointRow = Fns["admin_event_checkpoints_list"]["Returns"][number];
export type EventCheckinRow = Fns["admin_event_checkins_list"]["Returns"][number];
export type CheckinSearchRow = Fns["admin_event_checkin_search"]["Returns"][number];
export type ScannerDeviceRow = Fns["admin_event_scanner_devices_list"]["Returns"][number];
export type BadgeTemplateRow = Fns["admin_event_badge_templates_list"]["Returns"][number];
export type BadgePrintRow = Fns["admin_event_badge_prints_list"]["Returns"][number];
export type LeadScanRow = Fns["admin_event_lead_scans_list"]["Returns"][number];

/** Rodzaje punktow kontrolnych - lustro CHECK-a z migracji. */
export const CHECKPOINT_KINDS = [
  "event_entry",
  "session",
  "room",
  "zone",
  "catering",
  "cloakroom",
  "company_booth",
] as const;
export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

export const CHECKPOINT_DIRECTION_MODES = ["in_only", "in_out"] as const;
export type CheckpointDirectionMode = (typeof CHECKPOINT_DIRECTION_MODES)[number];

/** `control` odmawia bez zapisu/miejsca, `track` liczy wejscia bez odmowy. */
export const CHECKPOINT_ACCESS_MODES = ["control", "track"] as const;
export type CheckpointAccessMode = (typeof CHECKPOINT_ACCESS_MODES)[number];

export const SCANNER_SCOPES = ["checkin", "lead", "badge_print"] as const;
export type ScannerScope = (typeof SCANNER_SCOPES)[number];

/** Panel zapisuje TYLKO te dwa zrodla - reszta nalezy do urzadzenia. */
export const MANUAL_CHECKIN_SOURCES = ["manual_entry", "name_search"] as const;
export type ManualCheckinSource = (typeof MANUAL_CHECKIN_SOURCES)[number];

export const CHECKIN_DIRECTIONS = ["in", "out"] as const;
export type CheckinDirection = (typeof CHECKIN_DIRECTIONS)[number];

export const CHECKIN_RESULTS = [
  "granted",
  "denied_no_registration",
  "denied_not_approved",
  "denied_capacity",
  "denied_wrong_direction",
  "denied_duplicate",
] as const;

export const BADGE_PAPER_FORMATS = ["a6", "a7", "cr80", "custom"] as const;
export type BadgePaperFormat = (typeof BADGE_PAPER_FORMATS)[number];

export const BADGE_ORIENTATIONS = ["portrait", "landscape"] as const;
export type BadgeOrientation = (typeof BADGE_ORIENTATIONS)[number];

/* ------------------------------------------------------------- narzedzia --- */

/** Usuwa `undefined` z argumentow RPC, zachowujac jawny `null`. */
function args<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

/** To samo dla ladunku jsonb - `payload` jedzie jako jedno pole. */
function payload(input: Record<string, unknown>): Json {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Json;
}

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error !== null) throw new Error(error.message);
  return (data ?? []) as T;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/* ---------------------------------------------------- punkty kontrolne --- */

export interface CheckpointInput {
  id?: string;
  eventId?: string;
  namePl: string;
  nameEn: string;
  kind: CheckpointKind;
  sessionId?: string | null;
  roomId?: string | null;
  sponsorId?: string | null;
  directionMode?: CheckpointDirectionMode;
  accessMode?: CheckpointAccessMode;
  /** `null` = bez limitu pojemnosci. */
  capacity?: number | null;
  dedupeWindowSeconds?: number;
  isActive?: boolean;
  sortOrder?: number;
}

export async function fetchCheckpoints(eventId: string): Promise<EventCheckpointRow[]> {
  const { data, error } = await supabase.rpc("admin_event_checkpoints_list", {
    p_event_id: eventId,
  });
  return unwrap<EventCheckpointRow[]>(data, error);
}

export async function saveCheckpoint(input: CheckpointInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_checkpoint_save", {
    p_payload: payload({
      id: input.id,
      event_id: input.eventId,
      name_pl: input.namePl,
      name_en: input.nameEn,
      kind: input.kind,
      session_id: input.sessionId,
      room_id: input.roomId,
      sponsor_id: input.sponsorId,
      direction_mode: input.directionMode,
      access_mode: input.accessMode,
      capacity: input.capacity,
      dedupe_window_seconds: input.dedupeWindowSeconds,
      is_active: input.isActive,
      sort_order: input.sortOrder,
    }),
  });
  if (error !== null) throw new Error(error.message);
  return String(data);
}

export async function deleteCheckpoint(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_checkpoint_delete", { _id: id });
  if (error !== null) throw new Error(error.message);
  return data === true;
}

/* --------------------------------------------------------------- odprawa --- */

export interface CheckinSearchQuery {
  eventId: string;
  q: string;
  limit?: number;
}

export async function searchCheckinPeople(query: CheckinSearchQuery): Promise<CheckinSearchRow[]> {
  const { data, error } = await supabase.rpc("admin_event_checkin_search", {
    p_payload: payload({ event_id: query.eventId, q: query.q, limit: query.limit }),
  });
  return unwrap<CheckinSearchRow[]>(data, error);
}

export interface ManualCheckinInput {
  eventId: string;
  checkpointId: string;
  personId: string;
  direction?: CheckinDirection;
  source?: ManualCheckinSource;
  note?: string | null;
  /** Idempotencja po stronie klienta - powtorzone kliknięcie nie tworzy wiersza. */
  clientScanUid?: string;
}

/** Wynik decyzji odprawy - baza zwraca jsonb o stalym ksztalcie. */
export interface CheckinOutcome {
  outcome: string;
  admit: boolean;
  result: string;
  checkinId: string | null;
  direction: string;
  occurredAt: string | null;
  repeatCount: number;
  previousCheckinAt: string | null;
  checkpoint: Record<string, unknown>;
  person: Record<string, unknown>;
}

export function parseCheckinOutcome(value: unknown): CheckinOutcome {
  const row = record(value);
  const repeat = row.repeat_count;
  return {
    outcome: typeof row.outcome === "string" ? row.outcome : "unknown",
    admit: row.admit === true,
    result: typeof row.result === "string" ? row.result : "unknown",
    checkinId: typeof row.checkin_id === "string" ? row.checkin_id : null,
    direction: typeof row.direction === "string" ? row.direction : "in",
    occurredAt: typeof row.occurred_at === "string" ? row.occurred_at : null,
    repeatCount: typeof repeat === "number" ? repeat : 0,
    previousCheckinAt: typeof row.previous_checkin_at === "string" ? row.previous_checkin_at : null,
    checkpoint: record(row.checkpoint),
    person: record(row.person),
  };
}

export async function recordManualCheckin(input: ManualCheckinInput): Promise<CheckinOutcome> {
  const { data, error } = await supabase.rpc("admin_event_checkin_manual", {
    p_payload: payload({
      event_id: input.eventId,
      checkpoint_id: input.checkpointId,
      person_id: input.personId,
      direction: input.direction,
      source: input.source,
      note: input.note,
      client_scan_uid: input.clientScanUid,
    }),
  });
  if (error !== null) throw new Error(error.message);
  return parseCheckinOutcome(data);
}

export interface CheckinsQuery {
  eventId: string;
  checkpointId?: string;
  direction?: CheckinDirection;
  /** `granted` albo konkretny powod odmowy; `all` filtruje po stronie UI. */
  result?: string;
  source?: string;
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function fetchCheckins(query: CheckinsQuery): Promise<EventCheckinRow[]> {
  const { data, error } = await supabase.rpc(
    "admin_event_checkins_list",
    args({
      p_event_id: query.eventId,
      p_checkpoint_id: query.checkpointId,
      p_direction: query.direction,
      p_result: query.result,
      p_source: query.source,
      p_from: query.from,
      p_to: query.to,
      p_q: query.q?.trim() === "" ? undefined : query.q,
      p_limit: query.limit,
      p_offset: query.offset,
    }),
  );
  return unwrap<EventCheckinRow[]>(data, error);
}

/* ---------------------------------------------------------- statystyki --- */

export interface OnsiteCheckpointStat {
  checkpointId: string;
  namePl: string;
  nameEn: string;
  kind: string;
  accessMode: string;
  capacity: number | null;
  occupancy: number;
  granted: number;
  denied: number;
  uniquePeople: number;
  lastCheckinAt: string | null;
}

export interface OnsiteHistogramBucket {
  bucketAt: string;
  grantedIn: number;
  grantedOut: number;
  denied: number;
}

export interface OnsiteStats {
  bucketMinutes: number;
  registeredTotal: number;
  arrivedTotal: number;
  arrivedRegistered: number;
  walkInTotal: number;
  noShowTotal: number;
  attendanceRate: number | null;
  deniedTotal: number;
  deniedByReason: Record<string, number>;
  repeatTotal: number;
  failedResolveTotal: number;
  badgesPrintedPeople: number;
  badgesPrintedCopies: number;
  leadScansTotal: number;
  leadScansWithConsent: number;
  histogram: OnsiteHistogramBucket[];
  checkpoints: OnsiteCheckpointStat[];
  devices: { total: number; active: number; locked: number; revoked: number; expired: number };
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Parser broni ekranu: brakujaca metryka to zero, a nie pusty pulpit. */
export function parseOnsiteStats(value: unknown): OnsiteStats {
  const row = record(value);
  const devices = record(row.devices);
  const reasons: Record<string, number> = {};
  for (const [key, count] of Object.entries(record(row.denied_by_reason))) {
    reasons[key] = num(count);
  }
  const histogram: OnsiteHistogramBucket[] = Array.isArray(row.histogram)
    ? row.histogram.map((item) => {
        const bucket = record(item);
        return {
          bucketAt: str(bucket.bucket_at),
          grantedIn: num(bucket.granted_in),
          grantedOut: num(bucket.granted_out),
          denied: num(bucket.denied),
        };
      })
    : [];
  const checkpoints: OnsiteCheckpointStat[] = Array.isArray(row.checkpoints)
    ? row.checkpoints.map((item) => {
        const stat = record(item);
        return {
          checkpointId: str(stat.checkpoint_id),
          namePl: str(stat.name_pl),
          nameEn: str(stat.name_en),
          kind: str(stat.kind),
          accessMode: str(stat.access_mode),
          capacity: nullableNum(stat.capacity),
          occupancy: num(stat.occupancy),
          granted: num(stat.granted),
          denied: num(stat.denied),
          uniquePeople: num(stat.unique_people),
          lastCheckinAt: typeof stat.last_checkin_at === "string" ? stat.last_checkin_at : null,
        };
      })
    : [];

  return {
    bucketMinutes: num(row.bucket_minutes, 15),
    registeredTotal: num(row.registered_total),
    arrivedTotal: num(row.arrived_total),
    arrivedRegistered: num(row.arrived_registered),
    walkInTotal: num(row.walk_in_total),
    noShowTotal: num(row.no_show_total),
    attendanceRate: nullableNum(row.attendance_rate),
    deniedTotal: num(row.denied_total),
    deniedByReason: reasons,
    repeatTotal: num(row.repeat_total),
    failedResolveTotal: num(row.failed_resolve_total),
    badgesPrintedPeople: num(row.badges_printed_people),
    badgesPrintedCopies: num(row.badges_printed_copies),
    leadScansTotal: num(row.lead_scans_total),
    leadScansWithConsent: num(row.lead_scans_with_consent),
    histogram,
    checkpoints,
    devices: {
      total: num(devices.total),
      active: num(devices.active),
      locked: num(devices.locked),
      revoked: num(devices.revoked),
      expired: num(devices.expired),
    },
  };
}

export async function fetchOnsiteStats(
  eventId: string,
  bucketMinutes?: number,
): Promise<OnsiteStats> {
  const { data, error } = await supabase.rpc(
    "admin_event_onsite_stats",
    args({ p_event_id: eventId, p_bucket_minutes: bucketMinutes }),
  );
  if (error !== null) throw new Error(error.message);
  return parseOnsiteStats(data);
}

/* -------------------------------------------------- urzadzenia skanujace --- */

export interface ScannerDeviceIssueInput {
  eventId: string;
  label: string;
  scopes: ScannerScope[];
  checkpointId?: string | null;
  sponsorId?: string | null;
  expiresAt?: string;
}

/** Jawny token zyje tylko w tej odpowiedzi - nie ma funkcji, ktora go powtorzy. */
export interface ScannerDeviceCredential {
  deviceId: string;
  label: string;
  token: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string | null;
}

export function parseScannerCredential(value: unknown): ScannerDeviceCredential {
  const row = record(value);
  const scopes = Array.isArray(row.scopes)
    ? row.scopes.filter((item): item is string => typeof item === "string")
    : [];
  return {
    deviceId: str(row.device_id),
    label: str(row.label),
    token: str(row.token),
    tokenPrefix: str(row.token_prefix),
    scopes,
    expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
  };
}

export async function fetchScannerDevices(eventId: string): Promise<ScannerDeviceRow[]> {
  const { data, error } = await supabase.rpc("admin_event_scanner_devices_list", {
    p_event_id: eventId,
  });
  return unwrap<ScannerDeviceRow[]>(data, error);
}

export async function issueScannerDevice(
  input: ScannerDeviceIssueInput,
): Promise<ScannerDeviceCredential> {
  const { data, error } = await supabase.rpc("admin_event_scanner_device_issue", {
    p_payload: payload({
      event_id: input.eventId,
      label: input.label,
      scopes: input.scopes,
      checkpoint_id: input.checkpointId,
      sponsor_id: input.sponsorId,
      expires_at: input.expiresAt,
    }),
  });
  if (error !== null) throw new Error(error.message);
  return parseScannerCredential(data);
}

export async function revokeScannerDevice(deviceId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_scanner_device_revoke", {
    p_payload: payload({ device_id: deviceId }),
  });
  if (error !== null) throw new Error(error.message);
  return data === true;
}

export async function setScannerDeviceActive(
  deviceId: string,
  isActive: boolean,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_scanner_device_set_active", {
    p_payload: payload({ device_id: deviceId, is_active: isActive }),
  });
  if (error !== null) throw new Error(error.message);
  return data === true;
}

/* ------------------------------------------------------- identyfikatory --- */

export interface BadgeTemplateInput {
  id?: string;
  eventId?: string;
  name: string;
  paperFormat: BadgePaperFormat;
  orientation: BadgeOrientation;
  widthMm?: number | null;
  heightMm?: number | null;
  showQr?: boolean;
  qrSizeMm?: number;
  doubleFold?: boolean;
  backgroundColor?: string | null;
  backgroundImageUrl?: string | null;
  isDefault?: boolean;
  elements?: Json;
}

export async function fetchBadgeTemplates(eventId: string): Promise<BadgeTemplateRow[]> {
  const { data, error } = await supabase.rpc("admin_event_badge_templates_list", {
    p_event_id: eventId,
  });
  return unwrap<BadgeTemplateRow[]>(data, error);
}

export async function saveBadgeTemplate(input: BadgeTemplateInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_badge_template_save", {
    p_payload: payload({
      id: input.id,
      event_id: input.eventId,
      name: input.name,
      paper_format: input.paperFormat,
      orientation: input.orientation,
      width_mm: input.widthMm,
      height_mm: input.heightMm,
      show_qr: input.showQr,
      qr_size_mm: input.qrSizeMm,
      double_fold: input.doubleFold,
      background_color: input.backgroundColor,
      background_image_url: input.backgroundImageUrl,
      is_default: input.isDefault,
      elements: input.elements,
    }),
  });
  if (error !== null) throw new Error(error.message);
  return String(data);
}

export async function deleteBadgeTemplate(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_badge_template_delete", { _id: id });
  if (error !== null) throw new Error(error.message);
  return data === true;
}

export interface BadgePrintInput {
  eventId: string;
  personId: string;
  templateId?: string;
  copies?: number;
  reason?: string;
  note?: string | null;
}

export async function recordBadgePrint(input: BadgePrintInput): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("admin_event_badge_print_record", {
    p_payload: payload({
      event_id: input.eventId,
      person_id: input.personId,
      template_id: input.templateId,
      copies: input.copies,
      reason: input.reason,
      note: input.note,
    }),
  });
  if (error !== null) throw new Error(error.message);
  return record(data);
}

export interface BadgePrintsQuery {
  eventId: string;
  personId?: string;
  limit?: number;
  offset?: number;
}

export async function fetchBadgePrints(query: BadgePrintsQuery): Promise<BadgePrintRow[]> {
  const { data, error } = await supabase.rpc(
    "admin_event_badge_prints_list",
    args({
      p_event_id: query.eventId,
      p_person_id: query.personId,
      p_limit: query.limit,
      p_offset: query.offset,
    }),
  );
  return unwrap<BadgePrintRow[]>(data, error);
}

/* ------------------------------------------------------ leady sponsorow --- */

export interface LeadScansQuery {
  eventId: string;
  sponsorId?: string;
  limit?: number;
  offset?: number;
}

export async function fetchLeadScans(query: LeadScansQuery): Promise<LeadScanRow[]> {
  const { data, error } = await supabase.rpc(
    "admin_event_lead_scans_list",
    args({
      p_event_id: query.eventId,
      p_sponsor_id: query.sponsorId,
      p_limit: query.limit,
      p_offset: query.offset,
    }),
  );
  return unwrap<LeadScanRow[]>(data, error);
}
