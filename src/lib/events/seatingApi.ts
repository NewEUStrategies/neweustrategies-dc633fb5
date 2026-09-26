// Dostep panelu organizatora do PLANU SALI: plany, kategorie miejsc, sekcje,
// miejsca, przydzialy, kandydaci do rozsadzenia i eksport.
//
// NAZEWNICTWO. "Miejsce" w module wydarzen znaczy juz trzy rzeczy (wolna
// pojemnosc biletu, wejsciowka z pakietu, krzeslo przy stoliku gieldy) - tutaj
// zawsze chodzi o MIEJSCE NA SALI i dlatego wszystko nosi prefiks `seat*`/
// `seating*`, nigdy golego `seats` z modulu pakietow.
//
// AUTORYZACJA ZYJE W SQL. Kazda funkcja `admin_event_seat*` zaczyna od
// `assert_event_admin_tenant()`, a przydzialy dodatkowo serializuja sie
// blokada wiersza planu - ten modul tylko przenosi parametry i nie udaje
// bramki.
//
// TYPY. Funkcje zwracajace TABLE maja wiersze wyprowadzone z wygenerowanych
// `Database`; funkcje zwracajace `jsonb` (szczegol planu, wynik zapisu sekcji,
// przydzial) sa czytane DEFENSYWNIE pole po polu, bo generator opisuje je jako
// `Json`.
//
// KLUCZE POMINIETE (`undefined`) NIE SA WYSYLANE. SQL czyta `p_payload ? 'room_id'`,
// wiec brak klucza znaczy "zostaw", a jawny `null` - "wyczysc".
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { bag, flag, list, num, text, type JsonBag } from "@/lib/events/seatingJson";

type Fns = Database["public"]["Functions"];

export type SeatMapRow = Fns["admin_event_seat_maps_list"]["Returns"][number];
export type SeatingCandidateRow = Fns["admin_event_seating_candidates"]["Returns"][number];
export type SeatLookupRow = Fns["admin_event_seat_lookup"]["Returns"][number];
export type SeatExportRow = Fns["admin_event_seating_export"]["Returns"][number];

/** `event_seat_maps_status_values`. */
export const SEAT_MAP_STATUSES = ["draft", "published"] as const;
export type SeatMapStatus = (typeof SEAT_MAP_STATUSES)[number];

/** `event_seat_sections_kind_values`. */
export const SEAT_SECTION_KINDS = ["rows", "table"] as const;
export type SeatSectionKind = (typeof SEAT_SECTION_KINDS)[number];

/** `event_seat_sections_row_label_scheme_values`. */
export const SEAT_ROW_LABEL_SCHEMES = ["alpha", "numeric"] as const;
export type SeatRowLabelScheme = (typeof SEAT_ROW_LABEL_SCHEMES)[number];

/** `event_seat_sections_seat_numbering_values`. */
export const SEAT_NUMBERINGS = ["ltr", "rtl", "odd_even"] as const;
export type SeatNumbering = (typeof SEAT_NUMBERINGS)[number];

/** `event_seat_sections_table_shape_values`. */
export const SEAT_TABLE_SHAPES = ["round", "rect"] as const;
export type SeatTableShape = (typeof SEAT_TABLE_SHAPES)[number];

/** `event_seats_status_values`. */
export const SEAT_STATUSES = ["available", "blocked", "held"] as const;
export type SeatStatus = (typeof SEAT_STATUSES)[number];

/** `event_seat_assignments_source_values`. */
export const SEAT_ASSIGNMENT_SOURCES = ["manual", "auto", "import"] as const;
export type SeatAssignmentSource = (typeof SEAT_ASSIGNMENT_SOURCES)[number];

/** `event_seat_assignments_release_reason_values`. */
export const SEAT_RELEASE_REASONS = ["manual", "moved", "registration_status", "seat_blocked"] as const;
export type SeatReleaseReason = (typeof SEAT_RELEASE_REASONS)[number];

/**
 * Statusy zgloszen ZAJMUJACE miejsce na sali - dokladnie zbior z triggera
 * walidacji przydzialu i z `tg_event_registrations_sync_ticket_sold`.
 * Parytet z migracja pilnuje `seatingDbEnumParity.test.ts`.
 */
export const SEATABLE_REGISTRATION_STATUSES = ["approved", "attended", "no_show"] as const;

/** Limity funkcji SQL (lustro `RAISE`-ow `too_many_*`). */
export const SEAT_BATCH_LIMIT = 500;
export const SEAT_LOOKUP_LIMIT = 200;
export const SEAT_UPDATE_LIMIT = 2000;
export const SEAT_CANDIDATES_PAGE = 500;

export interface SeatStage {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SeatMapInfo {
  id: string;
  eventId: string;
  name: string;
  roomId: string | null;
  sessionId: string | null;
  status: SeatMapStatus;
  width: number;
  height: number;
  stage: SeatStage | null;
  sortOrder: number;
  publishedAt: string | null;
}

export interface SeatCategory {
  id: string;
  key: string;
  namePl: string;
  nameEn: string;
  color: string;
  sortOrder: number;
  ticketTypeIds: string[];
}

export interface SeatSection {
  id: string;
  label: string;
  kind: SeatSectionKind;
  categoryId: string | null;
  originX: number;
  originY: number;
  rotationDeg: number;
  rowsCount: number | null;
  seatsPerRow: number | null;
  rowLabelScheme: SeatRowLabelScheme | null;
  rowLabelStart: number;
  seatNumbering: SeatNumbering | null;
  seatNumberStart: number;
  seatPitch: number;
  rowPitch: number;
  aisleAfter: number[];
  tableShape: SeatTableShape | null;
  tableSeats: number | null;
  sortOrder: number;
}

export interface Seat {
  id: string;
  sectionId: string;
  /** Rodzaj i etykieta sekcji - doklejone przy odczycie, bo z nich sklada sie napis miejsca. */
  sectionKind: SeatSectionKind;
  sectionLabel: string;
  rowLabel: string | null;
  seatNumber: number;
  x: number;
  y: number;
  sortKey: number;
  categoryId: string | null;
  status: SeatStatus;
  blockReason: string | null;
  holdCompanyId: string | null;
  holdCompanyName: string | null;
  holdSponsorId: string | null;
  holdSponsorName: string | null;
  holdPackageOrderId: string | null;
  holdPackageBuyer: string | null;
  holdNote: string | null;
  isAccessible: boolean;
}

export interface SeatAssignment {
  id: string;
  seatId: string;
  registrationId: string;
  firstName: string;
  lastName: string;
  companyId: string | null;
  company: string | null;
  ticketTypeId: string | null;
  ticketNamePl: string | null;
  ticketNameEn: string | null;
  registrationStatus: string;
  source: SeatAssignmentSource;
  note: string | null;
}

export interface SeatMapDetail {
  map: SeatMapInfo;
  categories: SeatCategory[];
  sections: SeatSection[];
  seats: Seat[];
  assignments: SeatAssignment[];
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function orNull<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function stageOf(value: unknown): SeatStage | null {
  const raw = bag(value);
  if (raw === null) return null;
  const x = num(raw, "x");
  const y = num(raw, "y");
  const w = num(raw, "w");
  const h = num(raw, "h");
  if (x === null || y === null || w === null || h === null) return null;
  return { x, y, w, h };
}

function parseMap(raw: JsonBag): SeatMapInfo | null {
  const id = text(raw, "id");
  const eventId = text(raw, "event_id");
  if (id === null || eventId === null) return null;
  return {
    id,
    eventId,
    name: text(raw, "name") ?? "",
    roomId: text(raw, "room_id"),
    sessionId: text(raw, "session_id"),
    status: oneOf(text(raw, "status"), SEAT_MAP_STATUSES, "draft"),
    width: num(raw, "width") ?? 1200,
    height: num(raw, "height") ?? 800,
    stage: stageOf(raw.stage),
    sortOrder: num(raw, "sort_order") ?? 100,
    publishedAt: text(raw, "published_at"),
  };
}

function stringList(value: unknown): string[] {
  return list(value).filter((entry): entry is string => typeof entry === "string");
}

function parseCategory(value: unknown): SeatCategory | null {
  const raw = bag(value);
  const id = raw === null ? null : text(raw, "id");
  if (raw === null || id === null) return null;
  return {
    id,
    key: text(raw, "key") ?? "",
    namePl: text(raw, "name_pl") ?? "",
    nameEn: text(raw, "name_en") ?? "",
    color: text(raw, "color") ?? "#888888",
    sortOrder: num(raw, "sort_order") ?? 100,
    ticketTypeIds: stringList(raw.ticket_type_ids),
  };
}

function parseSection(value: unknown): SeatSection | null {
  const raw = bag(value);
  const id = raw === null ? null : text(raw, "id");
  if (raw === null || id === null) return null;
  return {
    id,
    label: text(raw, "label") ?? "",
    kind: oneOf(text(raw, "kind"), SEAT_SECTION_KINDS, "rows"),
    categoryId: text(raw, "category_id"),
    originX: num(raw, "origin_x") ?? 0,
    originY: num(raw, "origin_y") ?? 0,
    rotationDeg: num(raw, "rotation_deg") ?? 0,
    rowsCount: num(raw, "rows_count"),
    seatsPerRow: num(raw, "seats_per_row"),
    rowLabelScheme: orNull(text(raw, "row_label_scheme"), SEAT_ROW_LABEL_SCHEMES),
    rowLabelStart: num(raw, "row_label_start") ?? 1,
    seatNumbering: orNull(text(raw, "seat_numbering"), SEAT_NUMBERINGS),
    seatNumberStart: num(raw, "seat_number_start") ?? 1,
    seatPitch: num(raw, "seat_pitch") ?? 50,
    rowPitch: num(raw, "row_pitch") ?? 60,
    aisleAfter: list(raw.aisle_after).filter(
      (entry): entry is number => typeof entry === "number" && Number.isFinite(entry),
    ),
    tableShape: orNull(text(raw, "table_shape"), SEAT_TABLE_SHAPES),
    tableSeats: num(raw, "table_seats"),
    sortOrder: num(raw, "sort_order") ?? 100,
  };
}

type ParsedSeat = Omit<Seat, "sectionKind" | "sectionLabel">;

function parseSeat(value: unknown): ParsedSeat | null {
  const raw = bag(value);
  const id = raw === null ? null : text(raw, "id");
  const sectionId = raw === null ? null : text(raw, "section_id");
  const seatNumber = raw === null ? null : num(raw, "seat_number");
  if (raw === null || id === null || sectionId === null || seatNumber === null) return null;
  return {
    id,
    sectionId,
    rowLabel: text(raw, "row_label"),
    seatNumber,
    x: num(raw, "x") ?? 0,
    y: num(raw, "y") ?? 0,
    sortKey: num(raw, "sort_key") ?? 0,
    categoryId: text(raw, "category_id"),
    status: oneOf(text(raw, "status"), SEAT_STATUSES, "available"),
    blockReason: text(raw, "block_reason"),
    holdCompanyId: text(raw, "hold_company_id"),
    holdCompanyName: text(raw, "hold_company_name"),
    holdSponsorId: text(raw, "hold_sponsor_id"),
    holdSponsorName: text(raw, "hold_sponsor_name"),
    holdPackageOrderId: text(raw, "hold_package_order_id"),
    holdPackageBuyer: text(raw, "hold_package_buyer"),
    holdNote: text(raw, "hold_note"),
    isAccessible: flag(raw, "is_accessible", false),
  };
}

function parseAssignment(value: unknown): SeatAssignment | null {
  const raw = bag(value);
  const id = raw === null ? null : text(raw, "id");
  const seatId = raw === null ? null : text(raw, "seat_id");
  const registrationId = raw === null ? null : text(raw, "registration_id");
  if (raw === null || id === null || seatId === null || registrationId === null) return null;
  return {
    id,
    seatId,
    registrationId,
    firstName: text(raw, "first_name") ?? "",
    lastName: text(raw, "last_name") ?? "",
    companyId: text(raw, "company_id"),
    company: text(raw, "company"),
    ticketTypeId: text(raw, "ticket_type_id"),
    ticketNamePl: text(raw, "ticket_name_pl"),
    ticketNameEn: text(raw, "ticket_name_en"),
    registrationStatus: text(raw, "registration_status") ?? "approved",
    source: oneOf(text(raw, "source"), SEAT_ASSIGNMENT_SOURCES, "manual"),
    note: text(raw, "note"),
  };
}

function parsedList<T>(value: unknown, parse: (entry: unknown) => T | null): T[] {
  const out: T[] = [];
  for (const entry of list(value)) {
    const parsed = parse(entry);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

/**
 * `admin_event_seat_map_detail` -> komplet planu. Wiersz bez identyfikatora
 * jest pomijany (a nie zamieniany na atrape), a brak samego planu daje `null`.
 */
export function parseSeatMapDetail(value: unknown): SeatMapDetail | null {
  const raw = bag(value);
  const mapBag = raw === null ? null : bag(raw.map);
  const map = mapBag === null ? null : parseMap(mapBag);
  if (raw === null || map === null) return null;
  const sections = parsedList(raw.sections, parseSection);
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  // Miejsce bez znanej sekcji nie ma gdzie sie narysowac ani jak sie nazwac -
  // pomijamy je (w jednej migawce jsonb to sie nie zdarza, ale parser nie ufa).
  const seats = parsedList(raw.seats, parseSeat).flatMap((seat) => {
    const section = sectionById.get(seat.sectionId);
    return section === undefined
      ? []
      : [{ ...seat, sectionKind: section.kind, sectionLabel: section.label }];
  });
  return {
    map,
    categories: parsedList(raw.categories, parseCategory),
    sections,
    seats,
    assignments: parsedList(raw.assignments, parseAssignment),
  };
}

type PayloadInput = Record<string, Json | undefined>;

function payload(input: PayloadInput): Json {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function fetchSeatMaps(eventId: string): Promise<SeatMapRow[]> {
  const { data, error } = await supabase.rpc("admin_event_seat_maps_list", { p_event_id: eventId });
  fail(error);
  return data ?? [];
}

export async function fetchSeatMapDetail(mapId: string): Promise<SeatMapDetail> {
  const { data, error } = await supabase.rpc("admin_event_seat_map_detail", { p_map_id: mapId });
  fail(error);
  const parsed = parseSeatMapDetail(data);
  if (parsed === null) throw new Error("not_found: seat map payload is empty");
  return parsed;
}

export interface SeatMapInput {
  id?: string;
  eventId?: string;
  name?: string;
  roomId?: string | null;
  sessionId?: string | null;
  status?: SeatMapStatus;
  width?: number;
  height?: number;
  stage?: SeatStage | null;
  sortOrder?: number;
}

export async function saveSeatMap(input: SeatMapInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_seat_map_save", {
    p_payload: payload({
      id: input.id,
      event_id: input.eventId,
      name: input.name,
      room_id: input.roomId,
      session_id: input.sessionId,
      status: input.status,
      width: input.width,
      height: input.height,
      stage:
        input.stage === undefined
          ? undefined
          : input.stage === null
            ? null
            : { x: input.stage.x, y: input.stage.y, w: input.stage.w, h: input.stage.h },
      sort_order: input.sortOrder,
    }),
  });
  fail(error);
  return String(data);
}

export async function deleteSeatMap(mapId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_seat_map_delete", { p_map_id: mapId });
  fail(error);
  return data === true;
}

export interface SeatCategoryInput {
  id?: string;
  eventId?: string;
  key?: string;
  namePl?: string;
  nameEn?: string;
  color?: string;
  sortOrder?: number;
  ticketTypeIds?: string[];
}

export async function saveSeatCategory(input: SeatCategoryInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_seat_category_save", {
    p_payload: payload({
      id: input.id,
      event_id: input.eventId,
      key: input.key,
      name_pl: input.namePl,
      name_en: input.nameEn,
      color: input.color,
      sort_order: input.sortOrder,
      ticket_type_ids: input.ticketTypeIds,
    }),
  });
  fail(error);
  return String(data);
}

export async function deleteSeatCategory(categoryId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_seat_category_delete", {
    p_category_id: categoryId,
  });
  fail(error);
  return data === true;
}

export interface SeatSectionInput {
  id?: string;
  mapId?: string;
  label?: string;
  kind?: SeatSectionKind;
  categoryId?: string | null;
  originX?: number;
  originY?: number;
  rotationDeg?: number;
  rowsCount?: number | null;
  seatsPerRow?: number | null;
  rowLabelScheme?: SeatRowLabelScheme | null;
  rowLabelStart?: number;
  seatNumbering?: SeatNumbering | null;
  seatNumberStart?: number;
  seatPitch?: number;
  rowPitch?: number;
  aisleAfter?: number[];
  tableShape?: SeatTableShape | null;
  tableSeats?: number | null;
  sortOrder?: number;
}

export interface SeatSectionSaveResult {
  sectionId: string;
  seatsCreated: number;
  seatsRemoved: number;
  seatsKept: number;
}

export function parseSectionSaveResult(value: unknown): SeatSectionSaveResult {
  const raw = bag(value) ?? {};
  return {
    sectionId: text(raw, "section_id") ?? "",
    seatsCreated: num(raw, "seats_created") ?? 0,
    seatsRemoved: num(raw, "seats_removed") ?? 0,
    seatsKept: num(raw, "seats_kept") ?? 0,
  };
}

export async function saveSeatSection(input: SeatSectionInput): Promise<SeatSectionSaveResult> {
  const { data, error } = await supabase.rpc("admin_event_seat_section_save", {
    p_payload: payload({
      id: input.id,
      map_id: input.mapId,
      label: input.label,
      kind: input.kind,
      category_id: input.categoryId,
      origin_x: input.originX,
      origin_y: input.originY,
      rotation_deg: input.rotationDeg,
      rows_count: input.rowsCount,
      seats_per_row: input.seatsPerRow,
      row_label_scheme: input.rowLabelScheme,
      row_label_start: input.rowLabelStart,
      seat_numbering: input.seatNumbering,
      seat_number_start: input.seatNumberStart,
      seat_pitch: input.seatPitch,
      row_pitch: input.rowPitch,
      aisle_after: input.aisleAfter,
      table_shape: input.tableShape,
      table_seats: input.tableSeats,
      sort_order: input.sortOrder,
    }),
  });
  fail(error);
  return parseSectionSaveResult(data);
}

export async function deleteSeatSection(sectionId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_seat_section_delete", {
    p_section_id: sectionId,
  });
  fail(error);
  return data === true;
}

export interface SeatsUpdateInput {
  mapId: string;
  seatIds: string[];
  status?: SeatStatus;
  blockReason?: string | null;
  holdCompanyId?: string | null;
  holdSponsorId?: string | null;
  holdPackageOrderId?: string | null;
  holdNote?: string | null;
  /** Blokada zajetego miejsca zwalnia posiadacza tylko na wyrazna prosbe. */
  release?: boolean;
  isAccessible?: boolean;
  categoryId?: string | null;
}

export async function updateSeats(input: SeatsUpdateInput): Promise<number> {
  const { data, error } = await supabase.rpc("admin_event_seats_update", {
    p_payload: payload({
      map_id: input.mapId,
      seat_ids: input.seatIds,
      status: input.status,
      block_reason: input.blockReason,
      hold_company_id: input.holdCompanyId,
      hold_sponsor_id: input.holdSponsorId,
      hold_package_order_id: input.holdPackageOrderId,
      hold_note: input.holdNote,
      release: input.release,
      is_accessible: input.isAccessible,
      category_id: input.categoryId,
    }),
  });
  fail(error);
  return Number(data ?? 0);
}

export interface SeatAssignInput {
  mapId: string;
  seatId: string;
  registrationId: string;
  swap?: boolean;
  force?: boolean;
  note?: string | null;
}

export interface SeatAssignResult {
  assignmentId: string | null;
  movedFromSeatId: string | null;
  swappedRegistrationId: string | null;
}

export async function assignSeat(input: SeatAssignInput): Promise<SeatAssignResult> {
  const { data, error } = await supabase.rpc("admin_event_seat_assign", {
    p_payload: payload({
      map_id: input.mapId,
      seat_id: input.seatId,
      registration_id: input.registrationId,
      swap: input.swap,
      force: input.force,
      note: input.note,
    }),
  });
  fail(error);
  const raw = bag(data) ?? {};
  return {
    assignmentId: text(raw, "assignment_id"),
    movedFromSeatId: text(raw, "moved_from_seat_id"),
    swappedRegistrationId: text(raw, "swapped_registration_id"),
  };
}

export interface SeatBatchItem {
  seatId: string;
  registrationId: string;
}

export interface SeatBatchRejection extends SeatBatchItem {
  code: string;
}

export interface SeatBatchResult {
  applied: number;
  rejected: SeatBatchRejection[];
}

export function parseBatchResult(value: unknown): SeatBatchResult {
  const raw = bag(value) ?? {};
  const rejected: SeatBatchRejection[] = [];
  for (const entry of list(raw.rejected)) {
    const row = bag(entry);
    if (row === null) continue;
    rejected.push({
      seatId: text(row, "seat_id") ?? "",
      registrationId: text(row, "registration_id") ?? "",
      code: text(row, "code") ?? "unknown",
    });
  }
  return { applied: num(raw, "applied") ?? 0, rejected };
}

export async function assignSeatsBatch(input: {
  mapId: string;
  source: SeatAssignmentSource;
  items: readonly SeatBatchItem[];
}): Promise<SeatBatchResult> {
  const { data, error } = await supabase.rpc("admin_event_seat_assign_batch", {
    p_payload: {
      map_id: input.mapId,
      source: input.source,
      items: input.items.map((item) => ({
        seat_id: item.seatId,
        registration_id: item.registrationId,
      })),
    },
  });
  fail(error);
  return parseBatchResult(data);
}

export interface SeatReleaseInput {
  mapId: string;
  seatIds?: string[];
  registrationIds?: string[];
  all?: boolean;
}

export async function releaseSeats(input: SeatReleaseInput): Promise<number> {
  const { data, error } = await supabase.rpc("admin_event_seat_release", {
    p_payload: payload({
      map_id: input.mapId,
      seat_ids: input.seatIds,
      registration_ids: input.registrationIds,
      all: input.all,
    }),
  });
  fail(error);
  return Number(data ?? 0);
}

export interface SeatingCandidatesQuery {
  mapId: string;
  q?: string;
  ticketTypeId?: string | null;
  groupId?: string | null;
  companyId?: string | null;
  onlyUnassigned?: boolean;
  limit?: number;
  offset?: number;
}

export interface SeatingCandidatesPage {
  rows: SeatingCandidateRow[];
  total: number;
}

export async function fetchSeatingCandidates(
  query: SeatingCandidatesQuery,
): Promise<SeatingCandidatesPage> {
  const q = query.q?.trim() ?? "";
  const { data, error } = await supabase.rpc("admin_event_seating_candidates", {
    p_payload: payload({
      map_id: query.mapId,
      q: q === "" ? undefined : q,
      ticket_type_id: query.ticketTypeId ?? undefined,
      group_id: query.groupId ?? undefined,
      company_id: query.companyId ?? undefined,
      only_unassigned: query.onlyUnassigned === true ? true : undefined,
      limit: query.limit,
      offset: query.offset,
    }),
  });
  fail(error);
  const rows = data ?? [];
  return { rows, total: rows[0]?.total_count ?? 0 };
}

/**
 * Wszyscy kandydaci planu - dla auto-przydzialu, ktory musi widziec CALOSC.
 *
 * RPC tnie strone do 500 wierszy, wiec chodzimy po stronach. Granica 40 stron
 * (20 tysiecy zgloszen) chroni przed petla, gdyby licznik calosci kiedys
 * przestal przychodzic.
 */
export async function fetchAllSeatingCandidates(mapId: string): Promise<SeatingCandidateRow[]> {
  const out: SeatingCandidateRow[] = [];
  for (let page = 0; page < 40; page += 1) {
    const chunk = await fetchSeatingCandidates({
      mapId,
      limit: SEAT_CANDIDATES_PAGE,
      offset: out.length,
    });
    out.push(...chunk.rows);
    if (chunk.rows.length < SEAT_CANDIDATES_PAGE || out.length >= chunk.total) break;
  }
  return out;
}

/**
 * Miejsca na sali dla listy zgloszen. RPC przyjmuje do 200 identyfikatorow -
 * dluzsza liste (eksport CSV) dzielimy na paczki. Pusta lista nie pyta sieci.
 */
export async function fetchSeatLookup(
  eventId: string,
  registrationIds: readonly string[],
): Promise<SeatLookupRow[]> {
  const out: SeatLookupRow[] = [];
  for (let start = 0; start < registrationIds.length; start += SEAT_LOOKUP_LIMIT) {
    const { data, error } = await supabase.rpc("admin_event_seat_lookup", {
      p_payload: {
        event_id: eventId,
        registration_ids: registrationIds.slice(start, start + SEAT_LOOKUP_LIMIT),
      },
    });
    fail(error);
    out.push(...(data ?? []));
  }
  return out;
}

export async function fetchSeatingExport(
  mapId: string,
  companyId: string | null = null,
): Promise<SeatExportRow[]> {
  const { data, error } = await supabase.rpc("admin_event_seating_export", {
    p_payload: payload({ map_id: mapId, company_id: companyId ?? undefined }),
  });
  fail(error);
  return data ?? [];
}
