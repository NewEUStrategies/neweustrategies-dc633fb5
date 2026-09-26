// Wersje robocze formularzy PLANU SALI: plan, sekcja, kategoria, blokada/rezerwacja.
//
// LICZBY TRZYMAMY JAKO NAPISY. Pole formularza z liczba bywa chwilowo puste
// albo niepoprawne ("12,", "-") - formularz nie moze go wtedy nadpisac zerem.
// Konwersja dzieje sie w walidacji i w `...ToInput`, w jednym miejscu.
//
// LIMITY SA LUSTREM CHECK-OW z migracji 20260926130000 (parytet pilnuje
// `seatingDbEnumParity.test.ts`). Formularz waliduje PRZED wyslaniem tylko po
// to, zeby organizator dowiedzial sie o bledzie od razu; ostatnie slowo ma baza.
//
// KLUCZE KOMUNIKATOW sa pelnymi literalami (`adminEventSeating.*.validation.*`),
// zeby bramki i18n widzialy kazdy z nich.
import type {
  SeatCategory,
  SeatCategoryInput,
  SeatMapInfo,
  SeatMapInput,
  SeatNumbering,
  SeatRowLabelScheme,
  SeatSection,
  SeatSectionInput,
  SeatSectionKind,
  SeatStatus,
  SeatTableShape,
  SeatsUpdateInput,
} from "@/lib/events/seatingApi";
import type { SectionLayoutParams } from "@/lib/events/seatingGeometry";

export const SEAT_MAP_NAME_MAX = 120;
export const SEAT_MAP_SIZE_MIN = 200;
export const SEAT_MAP_SIZE_MAX = 20000;
export const SEAT_SECTION_LABEL_MAX = 60;
export const SEAT_ROWS_MAX = 200;
export const SEAT_PER_ROW_MAX = 200;
export const SEAT_SECTION_SEATS_MAX = 2000;
export const SEAT_TABLE_SEATS_MAX = 24;
export const SEAT_PITCH_MIN = 10;
export const SEAT_PITCH_MAX = 500;
export const SEAT_ROW_START_MAX = 1000;
export const SEAT_NUMBER_START_MAX = 10000;
export const SEAT_AISLES_MAX = 20;
export const SEAT_POSITION_MIN = -20000;
export const SEAT_POSITION_MAX = 40000;
export const SEAT_ROTATION_MAX = 360;
export const SEAT_CATEGORY_KEY_PATTERN = /^[a-z][a-z0-9_]{1,48}$/;
export const SEAT_CATEGORY_NAME_MAX = 80;
export const SEAT_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const SEAT_NOTE_MAX = 200;

function numberOrNull(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function intOrNull(value: string): number | null {
  const parsed = numberOrNull(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function between(value: number | null, min: number, max: number): value is number {
  return value !== null && value >= min && value <= max;
}

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export interface FieldError<F extends string> {
  field: F;
  messageKey: string;
}

// ---------------------------------------------------------------------------
// PLAN
// ---------------------------------------------------------------------------

export interface MapDraft {
  id: string | null;
  name: string;
  roomId: string | null;
  sessionId: string | null;
  width: string;
  height: string;
  stageEnabled: boolean;
  stageX: string;
  stageY: string;
  stageW: string;
  stageH: string;
}

export function emptyMapDraft(): MapDraft {
  return {
    id: null,
    name: "",
    roomId: null,
    sessionId: null,
    width: "1200",
    height: "800",
    stageEnabled: true,
    stageX: "400",
    stageY: "20",
    stageW: "400",
    stageH: "80",
  };
}

export function mapDraftFromMap(map: SeatMapInfo): MapDraft {
  const empty = emptyMapDraft();
  return {
    id: map.id,
    name: map.name,
    roomId: map.roomId,
    sessionId: map.sessionId,
    width: String(map.width),
    height: String(map.height),
    stageEnabled: map.stage !== null,
    stageX: map.stage === null ? empty.stageX : String(map.stage.x),
    stageY: map.stage === null ? empty.stageY : String(map.stage.y),
    stageW: map.stage === null ? empty.stageW : String(map.stage.w),
    stageH: map.stage === null ? empty.stageH : String(map.stage.h),
  };
}

export type MapField = "name" | "width" | "height" | "stage";

const MV = "adminEventSeating.mapDialog.validation.";

export function validateMapDraft(draft: MapDraft): FieldError<MapField>[] {
  const errors: FieldError<MapField>[] = [];
  const name = draft.name.trim();
  if (name === "") errors.push({ field: "name", messageKey: `${MV}nameRequired` });
  if (name.length > SEAT_MAP_NAME_MAX)
    errors.push({ field: "name", messageKey: `${MV}nameTooLong` });
  const width = intOrNull(draft.width);
  const height = intOrNull(draft.height);
  if (!between(width, SEAT_MAP_SIZE_MIN, SEAT_MAP_SIZE_MAX)) {
    errors.push({ field: "width", messageKey: `${MV}sizeRange` });
  }
  if (!between(height, SEAT_MAP_SIZE_MIN, SEAT_MAP_SIZE_MAX)) {
    errors.push({ field: "height", messageKey: `${MV}sizeRange` });
  }
  if (draft.stageEnabled) {
    const x = numberOrNull(draft.stageX);
    const y = numberOrNull(draft.stageY);
    const w = numberOrNull(draft.stageW);
    const h = numberOrNull(draft.stageH);
    const inside =
      x !== null &&
      y !== null &&
      w !== null &&
      h !== null &&
      x >= 0 &&
      y >= 0 &&
      w > 0 &&
      h > 0 &&
      (width === null || x + w <= width) &&
      (height === null || y + h <= height);
    if (!inside) errors.push({ field: "stage", messageKey: `${MV}stageInside` });
  }
  return errors;
}

export function mapDraftToInput(draft: MapDraft, eventId: string): SeatMapInput {
  return {
    ...(draft.id === null ? { eventId } : { id: draft.id }),
    name: draft.name.trim(),
    roomId: draft.roomId,
    sessionId: draft.sessionId,
    width: intOrNull(draft.width) ?? 1200,
    height: intOrNull(draft.height) ?? 800,
    stage: draft.stageEnabled
      ? {
          x: numberOrNull(draft.stageX) ?? 0,
          y: numberOrNull(draft.stageY) ?? 0,
          w: numberOrNull(draft.stageW) ?? 0,
          h: numberOrNull(draft.stageH) ?? 0,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// SEKCJA
// ---------------------------------------------------------------------------

export interface SectionDraft {
  id: string | null;
  label: string;
  kind: SeatSectionKind;
  categoryId: string | null;
  originX: string;
  originY: string;
  rotationDeg: string;
  rowsCount: string;
  seatsPerRow: string;
  rowLabelScheme: SeatRowLabelScheme;
  rowLabelStart: string;
  seatNumbering: SeatNumbering;
  seatNumberStart: string;
  seatPitch: string;
  rowPitch: string;
  /** Przejscia jako lista numerow po przecinku: "3, 7". */
  aisles: string;
  tableShape: SeatTableShape;
  tableSeats: string;
}

export function emptySectionDraft(kind: SeatSectionKind): SectionDraft {
  return {
    id: null,
    label: "",
    kind,
    categoryId: null,
    originX: "100",
    originY: "160",
    rotationDeg: "0",
    rowsCount: "5",
    seatsPerRow: "10",
    rowLabelScheme: "alpha",
    rowLabelStart: "1",
    seatNumbering: "ltr",
    seatNumberStart: "1",
    seatPitch: "50",
    rowPitch: "60",
    aisles: "",
    tableShape: "round",
    tableSeats: "8",
  };
}

export function sectionDraftFromSection(section: SeatSection): SectionDraft {
  const empty = emptySectionDraft(section.kind);
  return {
    id: section.id,
    label: section.label,
    kind: section.kind,
    categoryId: section.categoryId,
    originX: String(section.originX),
    originY: String(section.originY),
    rotationDeg: String(section.rotationDeg),
    rowsCount: section.rowsCount === null ? empty.rowsCount : String(section.rowsCount),
    seatsPerRow: section.seatsPerRow === null ? empty.seatsPerRow : String(section.seatsPerRow),
    rowLabelScheme: section.rowLabelScheme ?? empty.rowLabelScheme,
    rowLabelStart: String(section.rowLabelStart),
    seatNumbering: section.seatNumbering ?? empty.seatNumbering,
    seatNumberStart: String(section.seatNumberStart),
    seatPitch: String(section.seatPitch),
    rowPitch: String(section.rowPitch),
    aisles: section.aisleAfter.join(", "),
    tableShape: section.tableShape ?? empty.tableShape,
    tableSeats: section.tableSeats === null ? empty.tableSeats : String(section.tableSeats),
  };
}

/** "3, 7" -> [3, 7] (bez powtorzen, rosnaco); cokolwiek niecalkowitego -> `null`. */
export function parseAisles(value: string): number[] | null {
  const parts = value
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const out: number[] = [];
  for (const part of parts) {
    const parsed = intOrNull(part);
    if (parsed === null) return null;
    if (!out.includes(parsed)) out.push(parsed);
  }
  return out.sort((a, b) => a - b);
}

export type SectionField =
  | "label"
  | "rowsCount"
  | "seatsPerRow"
  | "aisles"
  | "tableSeats"
  | "seatPitch"
  | "rowPitch"
  | "rowLabelStart"
  | "seatNumberStart"
  | "origin"
  | "rotationDeg";

const SV = "adminEventSeating.sectionDialog.validation.";

export function validateSectionDraft(draft: SectionDraft): FieldError<SectionField>[] {
  const errors: FieldError<SectionField>[] = [];
  const label = draft.label.trim();
  if (label === "") errors.push({ field: "label", messageKey: `${SV}labelRequired` });
  if (label.length > SEAT_SECTION_LABEL_MAX) {
    errors.push({ field: "label", messageKey: `${SV}labelTooLong` });
  }
  if (draft.kind === "rows") {
    const rows = intOrNull(draft.rowsCount);
    const perRow = intOrNull(draft.seatsPerRow);
    if (!between(rows, 1, SEAT_ROWS_MAX)) {
      errors.push({ field: "rowsCount", messageKey: `${SV}rowsRange` });
    }
    if (!between(perRow, 1, SEAT_PER_ROW_MAX)) {
      errors.push({ field: "seatsPerRow", messageKey: `${SV}perRowRange` });
    }
    if (rows !== null && perRow !== null && rows * perRow > SEAT_SECTION_SEATS_MAX) {
      errors.push({ field: "seatsPerRow", messageKey: `${SV}tooManySeats` });
    }
    const aisles = parseAisles(draft.aisles);
    if (
      aisles === null ||
      aisles.length > SEAT_AISLES_MAX ||
      aisles.some((after) => after < 1 || (perRow !== null && after >= perRow))
    ) {
      errors.push({ field: "aisles", messageKey: `${SV}aislesInvalid` });
    }
    if (!between(intOrNull(draft.rowLabelStart), 1, SEAT_ROW_START_MAX)) {
      errors.push({ field: "rowLabelStart", messageKey: `${SV}startRange` });
    }
  } else if (!between(intOrNull(draft.tableSeats), 1, SEAT_TABLE_SEATS_MAX)) {
    errors.push({ field: "tableSeats", messageKey: `${SV}tableSeatsRange` });
  }
  if (!between(intOrNull(draft.seatNumberStart), 1, SEAT_NUMBER_START_MAX)) {
    errors.push({ field: "seatNumberStart", messageKey: `${SV}startRange` });
  }
  if (!between(numberOrNull(draft.seatPitch), SEAT_PITCH_MIN, SEAT_PITCH_MAX)) {
    errors.push({ field: "seatPitch", messageKey: `${SV}pitchRange` });
  }
  if (!between(numberOrNull(draft.rowPitch), SEAT_PITCH_MIN, SEAT_PITCH_MAX)) {
    errors.push({ field: "rowPitch", messageKey: `${SV}pitchRange` });
  }
  if (
    !between(numberOrNull(draft.originX), SEAT_POSITION_MIN, SEAT_POSITION_MAX) ||
    !between(numberOrNull(draft.originY), SEAT_POSITION_MIN, SEAT_POSITION_MAX)
  ) {
    errors.push({ field: "origin", messageKey: `${SV}positionRange` });
  }
  if (!between(numberOrNull(draft.rotationDeg), -SEAT_ROTATION_MAX, SEAT_ROTATION_MAX)) {
    errors.push({ field: "rotationDeg", messageKey: `${SV}rotationRange` });
  }
  return errors;
}

/** Wejscie zapisu sekcji - wszystkie parametry ukladu zawsze obecne. */
export type SectionDraftInput = Required<Omit<SeatSectionInput, "id" | "mapId" | "sortOrder">> &
  Pick<SeatSectionInput, "id" | "mapId">;

/** Parametry podgladu na zywo - `null`, dopoki szkic nie przechodzi walidacji. */
export function sectionDraftLayout(draft: SectionDraft): SectionLayoutParams | null {
  if (validateSectionDraft(draft).length > 0) return null;
  // Te same liczby, ktore pojda do bazy - podglad nie ma wlasnej konwersji.
  const input = sectionDraftToInput(draft, "");
  return {
    kind: input.kind,
    rowsCount: input.rowsCount,
    seatsPerRow: input.seatsPerRow,
    rowLabelScheme: input.rowLabelScheme,
    rowLabelStart: input.rowLabelStart,
    seatNumbering: input.seatNumbering,
    seatNumberStart: input.seatNumberStart,
    seatPitch: input.seatPitch,
    rowPitch: input.rowPitch,
    aisleAfter: input.aisleAfter,
    tableShape: input.tableShape,
    tableSeats: input.tableSeats,
  };
}

export function sectionDraftToInput(draft: SectionDraft, mapId: string): SectionDraftInput {
  const rows = draft.kind === "rows";
  return {
    ...(draft.id === null ? { mapId } : { id: draft.id }),
    label: draft.label.trim(),
    kind: draft.kind,
    categoryId: draft.categoryId,
    originX: numberOrNull(draft.originX) ?? 0,
    originY: numberOrNull(draft.originY) ?? 0,
    rotationDeg: numberOrNull(draft.rotationDeg) ?? 0,
    rowsCount: rows ? intOrNull(draft.rowsCount) : null,
    seatsPerRow: rows ? intOrNull(draft.seatsPerRow) : null,
    rowLabelScheme: rows ? draft.rowLabelScheme : null,
    rowLabelStart: intOrNull(draft.rowLabelStart) ?? 1,
    seatNumbering: rows ? draft.seatNumbering : null,
    seatNumberStart: intOrNull(draft.seatNumberStart) ?? 1,
    seatPitch: numberOrNull(draft.seatPitch) ?? 50,
    rowPitch: numberOrNull(draft.rowPitch) ?? 60,
    aisleAfter: rows ? (parseAisles(draft.aisles) ?? []) : [],
    tableShape: rows ? null : draft.tableShape,
    tableSeats: rows ? null : intOrNull(draft.tableSeats),
  };
}

// ---------------------------------------------------------------------------
// KATEGORIA
// ---------------------------------------------------------------------------

export interface CategoryDraft {
  id: string | null;
  key: string;
  namePl: string;
  nameEn: string;
  color: string;
  ticketTypeIds: string[];
}

export function emptyCategoryDraft(color: string): CategoryDraft {
  return { id: null, key: "", namePl: "", nameEn: "", color, ticketTypeIds: [] };
}

export function categoryDraftFromCategory(category: SeatCategory): CategoryDraft {
  return {
    id: category.id,
    key: category.key,
    namePl: category.namePl,
    nameEn: category.nameEn,
    color: category.color,
    ticketTypeIds: [...category.ticketTypeIds],
  };
}

export type CategoryField = "key" | "namePl" | "nameEn" | "color";

const CV = "adminEventSeating.categoryDialog.validation.";

export function validateCategoryDraft(draft: CategoryDraft): FieldError<CategoryField>[] {
  const errors: FieldError<CategoryField>[] = [];
  // Klucz jest niezmienny po zapisie - przy edycji nie ma czego walidowac.
  if (draft.id === null && !SEAT_CATEGORY_KEY_PATTERN.test(draft.key.trim())) {
    errors.push({ field: "key", messageKey: `${CV}keyFormat` });
  }
  const namePl = draft.namePl.trim();
  const nameEn = draft.nameEn.trim();
  if (namePl === "" || namePl.length > SEAT_CATEGORY_NAME_MAX) {
    errors.push({ field: "namePl", messageKey: `${CV}nameRequired` });
  }
  if (nameEn === "" || nameEn.length > SEAT_CATEGORY_NAME_MAX) {
    errors.push({ field: "nameEn", messageKey: `${CV}nameRequired` });
  }
  if (!SEAT_COLOR_PATTERN.test(draft.color.trim())) {
    errors.push({ field: "color", messageKey: `${CV}colorFormat` });
  }
  return errors;
}

export function categoryDraftToInput(draft: CategoryDraft, eventId: string): SeatCategoryInput {
  return {
    ...(draft.id === null ? { eventId, key: draft.key.trim() } : { id: draft.id }),
    namePl: draft.namePl.trim(),
    nameEn: draft.nameEn.trim(),
    color: draft.color.trim().toUpperCase(),
    ticketTypeIds: [...draft.ticketTypeIds],
  };
}

// ---------------------------------------------------------------------------
// STATUS / REZERWACJA WYBRANYCH MIEJSC
// ---------------------------------------------------------------------------

/** Dla kogo trzymamy miejsca: firma z CRM, sponsor, zamowienie pakietowe albo sama notatka. */
export const HOLD_TARGETS = ["company", "sponsor", "package", "note"] as const;
export type HoldTarget = (typeof HOLD_TARGETS)[number];

export interface HoldDraft {
  status: SeatStatus;
  blockReason: string;
  target: HoldTarget;
  companyId: string | null;
  sponsorId: string | null;
  packageOrderId: string | null;
  note: string;
  /** Blokada zajetego miejsca zwalnia posiadacza tylko po jawnym zaznaczeniu. */
  release: boolean;
}

export function emptyHoldDraft(status: SeatStatus): HoldDraft {
  return {
    status,
    blockReason: "",
    target: "company",
    companyId: null,
    sponsorId: null,
    packageOrderId: null,
    note: "",
    release: false,
  };
}

export type HoldField = "blockReason" | "target" | "note";

const HV = "adminEventSeating.holdDialog.validation.";

export function validateHoldDraft(draft: HoldDraft): FieldError<HoldField>[] {
  const errors: FieldError<HoldField>[] = [];
  if (draft.status === "blocked" && draft.blockReason.trim().length > SEAT_NOTE_MAX) {
    errors.push({ field: "blockReason", messageKey: `${HV}noteTooLong` });
  }
  if (draft.status !== "held") return errors;
  if (draft.note.trim().length > SEAT_NOTE_MAX) {
    errors.push({ field: "note", messageKey: `${HV}noteTooLong` });
  }
  const missing =
    (draft.target === "company" && draft.companyId === null) ||
    (draft.target === "sponsor" && draft.sponsorId === null) ||
    (draft.target === "package" && draft.packageOrderId === null);
  if (missing) errors.push({ field: "target", messageKey: `${HV}targetRequired` });
  if (draft.target === "note" && draft.note.trim() === "") {
    errors.push({ field: "note", messageKey: `${HV}noteRequired` });
  }
  return errors;
}

export function holdDraftToInput(
  draft: HoldDraft,
  mapId: string,
  seatIds: readonly string[],
): SeatsUpdateInput {
  const held = draft.status === "held";
  return {
    mapId,
    seatIds: [...seatIds],
    status: draft.status,
    blockReason: draft.status === "blocked" ? trimOrNull(draft.blockReason) : null,
    holdCompanyId: held && draft.target === "company" ? draft.companyId : null,
    holdSponsorId: held && draft.target === "sponsor" ? draft.sponsorId : null,
    holdPackageOrderId: held && draft.target === "package" ? draft.packageOrderId : null,
    holdNote: held ? trimOrNull(draft.note) : null,
    release: draft.status === "blocked" ? draft.release : undefined,
  };
}
