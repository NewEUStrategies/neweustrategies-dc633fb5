// Wersje robocze formularzy modulu ON-SITE: punkt kontrolny, poswiadczenie
// urzadzenia, szablon identyfikatora.
//
// JEDEN PLIK, BO TO JEDEN LANCUCH DANYCH. Punkt kontrolny wyznacza miejsce
// odprawy, poswiadczenie przypina urzadzenie do tego punktu, szablon opisuje
// identyfikator drukowany przy tym samym stanowisku - trzy formularze dziela te
// same konwersje (tekst -> liczba, pusty tekst -> `null`, wzor koloru, wzor
// adresu, `datetime-local` -> ISO).
//
// PUSTY TEKST TO BRAK WARTOSCI, NIE ZERO. Punkt bez pojemnosci wpuszcza kazdego;
// punkt z pojemnoscia `0` nie wpusci nikogo. Formularz nie ma prawa skleic tych
// dwoch zdan.
//
// WALIDACJA STOI PRZED RPC, ALE GO NIE ZASTEPUJE. Baza dalej pilnuje przypisan
// do wydarzenia, limitu blokow szablonu i tego, ze punkt sesyjny wskazuje sesje;
// formularz tylko oszczedza organizatorowi podrozy po odmowe - przy bramce ta
// podroz kosztuje kolejke.
import {
  BADGE_ORIENTATIONS,
  BADGE_PAPER_FORMATS,
  CHECKPOINT_ACCESS_MODES,
  CHECKPOINT_DIRECTION_MODES,
  CHECKPOINT_KINDS,
  SCANNER_SCOPES,
  type BadgeOrientation,
  type BadgePaperFormat,
  type BadgeTemplateInput,
  type CheckpointAccessMode,
  type CheckpointDirectionMode,
  type CheckpointInput,
  type CheckpointKind,
  type ScannerDeviceIssueInput,
  type ScannerScope,
} from "@/lib/events/onsiteApi";

export const ONSITE_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const ONSITE_MAX_NAME = 200;
export const ONSITE_MIN_NAME = 2;
/** Lustro CHECK-a z migracji: kazdy bok identyfikatora 20-420 mm. */
export const BADGE_MIN_SIDE_MM = 20;
export const BADGE_MAX_SIDE_MM = 420;
export const BADGE_MIN_QR_MM = 10;
export const BADGE_MAX_QR_MM = 100;
export const CHECKPOINT_MAX_DEDUPE_SECONDS = 86_400;

const PREFIX = "adminEventOnsite.errors.";

export interface OnsiteFieldError<TField extends string> {
  field: TField;
  messageKey: string;
}

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** `null` = pole puste (brak deklaracji); `false` = wpisano cos, co nie jest liczba. */
export function intOrNull(value: string): number | null | false {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : false;
}

function intOr(value: string, fallback: number): number {
  const parsed = intOrNull(value);
  return parsed === null || parsed === false ? fallback : parsed;
}

/** Tlo szablonu: pelny `https://` albo sciezka wewnetrzna `/...`. */
export function isOnsiteUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("/")) return !trimmed.startsWith("//");
  return /^https:\/\/[^\s]+\.[^\s]+/.test(trimmed);
}

/** `datetime-local` -> ISO w UTC; pusty tekst = brak terminu. */
export function localToIso(value: string): string | null | false {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString();
}

/** ISO -> `datetime-local` (lokalna strefa przegladarki organizatora). */
export function isoToLocal(value: string | null | undefined): string {
  if (typeof value !== "string" || value === "") return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(
    parsed.getHours(),
  )}:${pad(parsed.getMinutes())}`;
}

function isKind(value: string): value is CheckpointKind {
  return (CHECKPOINT_KINDS as readonly string[]).includes(value);
}

function isDirectionMode(value: string): value is CheckpointDirectionMode {
  return (CHECKPOINT_DIRECTION_MODES as readonly string[]).includes(value);
}

function isAccessMode(value: string): value is CheckpointAccessMode {
  return (CHECKPOINT_ACCESS_MODES as readonly string[]).includes(value);
}

function isScope(value: string): value is ScannerScope {
  return (SCANNER_SCOPES as readonly string[]).includes(value);
}

function isPaperFormat(value: string): value is BadgePaperFormat {
  return (BADGE_PAPER_FORMATS as readonly string[]).includes(value);
}

function isOrientation(value: string): value is BadgeOrientation {
  return (BADGE_ORIENTATIONS as readonly string[]).includes(value);
}

/* ------------------------------------------------------- punkt kontrolny --- */

export interface CheckpointDraft {
  id?: string;
  namePl: string;
  nameEn: string;
  kind: string;
  sessionId: string;
  roomId: string;
  sponsorId: string;
  directionMode: string;
  accessMode: string;
  /** Pusty tekst = bez limitu pojemnosci. */
  capacity: string;
  dedupeWindowSeconds: string;
  isActive: boolean;
  sortOrder: string;
}

export function emptyCheckpointDraft(): CheckpointDraft {
  return {
    namePl: "",
    nameEn: "",
    kind: "event_entry",
    sessionId: "",
    roomId: "",
    sponsorId: "",
    directionMode: "in_only",
    accessMode: "control",
    capacity: "",
    dedupeWindowSeconds: "120",
    isActive: true,
    sortOrder: "0",
  };
}

export function checkpointDraftFromRow(row: {
  id?: string;
  name_pl?: string | null;
  name_en?: string | null;
  kind?: string | null;
  session_id?: string | null;
  room_id?: string | null;
  sponsor_id?: string | null;
  direction_mode?: string | null;
  access_mode?: string | null;
  capacity?: number | null;
  dedupe_window_seconds?: number | null;
  is_active?: boolean | null;
  sort_order?: number | null;
}): CheckpointDraft {
  const base = emptyCheckpointDraft();
  return {
    id: row.id,
    namePl: row.name_pl ?? "",
    nameEn: row.name_en ?? "",
    kind: row.kind ?? base.kind,
    sessionId: row.session_id ?? "",
    roomId: row.room_id ?? "",
    sponsorId: row.sponsor_id ?? "",
    directionMode: row.direction_mode ?? base.directionMode,
    accessMode: row.access_mode ?? base.accessMode,
    capacity: typeof row.capacity === "number" ? String(row.capacity) : "",
    dedupeWindowSeconds:
      typeof row.dedupe_window_seconds === "number"
        ? String(row.dedupe_window_seconds)
        : base.dedupeWindowSeconds,
    isActive: row.is_active !== false,
    sortOrder: typeof row.sort_order === "number" ? String(row.sort_order) : "0",
  };
}

export type CheckpointField =
  | "namePl"
  | "nameEn"
  | "kind"
  | "sessionId"
  | "sponsorId"
  | "directionMode"
  | "accessMode"
  | "capacity"
  | "dedupeWindowSeconds";

export function validateCheckpointDraft(
  draft: CheckpointDraft,
): OnsiteFieldError<CheckpointField>[] {
  const errors: OnsiteFieldError<CheckpointField>[] = [];
  const namePl = draft.namePl.trim();
  const nameEn = draft.nameEn.trim();

  if (namePl.length < ONSITE_MIN_NAME || namePl.length > ONSITE_MAX_NAME) {
    errors.push({ field: "namePl", messageKey: `${PREFIX}invalidNames` });
  }
  if (nameEn.length < ONSITE_MIN_NAME || nameEn.length > ONSITE_MAX_NAME) {
    errors.push({ field: "nameEn", messageKey: `${PREFIX}invalidNames` });
  }
  if (!isKind(draft.kind)) {
    errors.push({ field: "kind", messageKey: `${PREFIX}invalidKind` });
  }
  if (draft.kind === "session" && draft.sessionId.trim() === "") {
    errors.push({ field: "sessionId", messageKey: `${PREFIX}sessionRequired` });
  }
  if (draft.kind === "company_booth" && draft.sponsorId.trim() === "") {
    errors.push({ field: "sponsorId", messageKey: `${PREFIX}sponsorRequired` });
  }
  if (!isDirectionMode(draft.directionMode)) {
    errors.push({ field: "directionMode", messageKey: `${PREFIX}invalidPayload` });
  }
  if (!isAccessMode(draft.accessMode)) {
    errors.push({ field: "accessMode", messageKey: `${PREFIX}invalidPayload` });
  }
  if (intOrNull(draft.capacity) === false) {
    errors.push({ field: "capacity", messageKey: `${PREFIX}invalidPayload` });
  }
  const dedupe = intOrNull(draft.dedupeWindowSeconds);
  if (dedupe === false || dedupe === null || dedupe > CHECKPOINT_MAX_DEDUPE_SECONDS) {
    errors.push({ field: "dedupeWindowSeconds", messageKey: `${PREFIX}invalidPayload` });
  }
  return errors;
}

export function checkpointDraftToInput(draft: CheckpointDraft, eventId: string): CheckpointInput {
  const capacity = intOrNull(draft.capacity);
  const kind = isKind(draft.kind) ? draft.kind : "event_entry";
  return {
    id: draft.id,
    eventId: draft.id === undefined ? eventId : undefined,
    namePl: draft.namePl.trim(),
    nameEn: draft.nameEn.trim(),
    kind,
    // Powiazania czyscimy jawnym `null` - zmiana rodzaju punktu musi zdjac
    // wskazanie na sesje, bo inaczej zostaje sierota po poprzedniej wersji.
    sessionId: kind === "session" ? trimOrNull(draft.sessionId) : null,
    roomId: trimOrNull(draft.roomId),
    sponsorId: kind === "company_booth" ? trimOrNull(draft.sponsorId) : null,
    directionMode: isDirectionMode(draft.directionMode) ? draft.directionMode : "in_only",
    accessMode: isAccessMode(draft.accessMode) ? draft.accessMode : "control",
    capacity: capacity === false ? null : capacity,
    dedupeWindowSeconds: intOr(draft.dedupeWindowSeconds, 120),
    isActive: draft.isActive,
    sortOrder: intOr(draft.sortOrder, 0),
  };
}

/* ------------------------------------------------- poswiadczenie urzadzenia --- */

export interface ScannerDeviceDraft {
  label: string;
  scopes: string[];
  checkpointId: string;
  sponsorId: string;
  /** `datetime-local`; pusty = domyslny termin z bazy. */
  expiresAtLocal: string;
}

export function emptyScannerDeviceDraft(): ScannerDeviceDraft {
  return { label: "", scopes: ["checkin"], checkpointId: "", sponsorId: "", expiresAtLocal: "" };
}

export type ScannerDeviceField = "label" | "scopes" | "sponsorId" | "expiresAtLocal";

export function validateScannerDeviceDraft(
  draft: ScannerDeviceDraft,
  now: Date = new Date(),
): OnsiteFieldError<ScannerDeviceField>[] {
  const errors: OnsiteFieldError<ScannerDeviceField>[] = [];
  const label = draft.label.trim();
  if (label.length < ONSITE_MIN_NAME || label.length > ONSITE_MAX_NAME) {
    errors.push({ field: "label", messageKey: `${PREFIX}invalidLabel` });
  }
  const scopes = draft.scopes.filter(isScope);
  if (scopes.length === 0 || scopes.length !== draft.scopes.length) {
    errors.push({ field: "scopes", messageKey: `${PREFIX}invalidScopes` });
  }
  // Poswiadczenie leadowe bez sponsora nie ma czyjej zgody zapisywac.
  if (scopes.includes("lead") && draft.sponsorId.trim() === "") {
    errors.push({ field: "sponsorId", messageKey: `${PREFIX}sponsorRequired` });
  }
  const expires = localToIso(draft.expiresAtLocal);
  if (expires === false || (expires !== null && new Date(expires).getTime() <= now.getTime())) {
    if (draft.expiresAtLocal.trim() !== "") {
      errors.push({ field: "expiresAtLocal", messageKey: `${PREFIX}invalidExpiry` });
    }
  }
  return errors;
}

export function scannerDeviceDraftToInput(
  draft: ScannerDeviceDraft,
  eventId: string,
): ScannerDeviceIssueInput {
  const expires = localToIso(draft.expiresAtLocal);
  return {
    eventId,
    label: draft.label.trim(),
    scopes: draft.scopes.filter(isScope),
    checkpointId: trimOrNull(draft.checkpointId),
    sponsorId: trimOrNull(draft.sponsorId),
    expiresAt: expires === false || expires === null ? undefined : expires,
  };
}

/* --------------------------------------------- szablon identyfikatora --- */

export interface BadgeTemplateDraft {
  id?: string;
  name: string;
  paperFormat: string;
  orientation: string;
  widthMm: string;
  heightMm: string;
  showQr: boolean;
  qrSizeMm: string;
  doubleFold: boolean;
  backgroundColor: string;
  backgroundImageUrl: string;
  isDefault: boolean;
}

export function emptyBadgeTemplateDraft(): BadgeTemplateDraft {
  return {
    name: "",
    paperFormat: "a6",
    orientation: "portrait",
    widthMm: "",
    heightMm: "",
    showQr: true,
    qrSizeMm: "30",
    doubleFold: false,
    backgroundColor: "",
    backgroundImageUrl: "",
    isDefault: false,
  };
}

export function badgeTemplateDraftFromRow(row: {
  id?: string;
  name?: string | null;
  paper_format?: string | null;
  orientation?: string | null;
  width_mm?: number | null;
  height_mm?: number | null;
  show_qr?: boolean | null;
  qr_size_mm?: number | null;
  double_fold?: boolean | null;
  background_color?: string | null;
  background_image_url?: string | null;
  is_default?: boolean | null;
}): BadgeTemplateDraft {
  const base = emptyBadgeTemplateDraft();
  return {
    id: row.id,
    name: row.name ?? "",
    paperFormat: row.paper_format ?? base.paperFormat,
    orientation: row.orientation ?? base.orientation,
    widthMm: typeof row.width_mm === "number" ? String(row.width_mm) : "",
    heightMm: typeof row.height_mm === "number" ? String(row.height_mm) : "",
    showQr: row.show_qr !== false,
    qrSizeMm: typeof row.qr_size_mm === "number" ? String(row.qr_size_mm) : base.qrSizeMm,
    doubleFold: row.double_fold === true,
    backgroundColor: row.background_color ?? "",
    backgroundImageUrl: row.background_image_url ?? "",
    isDefault: row.is_default === true,
  };
}

export type BadgeTemplateField =
  | "name"
  | "paperFormat"
  | "orientation"
  | "widthMm"
  | "heightMm"
  | "qrSizeMm"
  | "backgroundColor"
  | "backgroundImageUrl";

export function validateBadgeTemplateDraft(
  draft: BadgeTemplateDraft,
): OnsiteFieldError<BadgeTemplateField>[] {
  const errors: OnsiteFieldError<BadgeTemplateField>[] = [];
  const name = draft.name.trim();
  if (name.length < ONSITE_MIN_NAME || name.length > ONSITE_MAX_NAME) {
    errors.push({ field: "name", messageKey: `${PREFIX}invalidName` });
  }
  if (!isPaperFormat(draft.paperFormat)) {
    errors.push({ field: "paperFormat", messageKey: `${PREFIX}invalidPaperFormat` });
  }
  if (!isOrientation(draft.orientation)) {
    errors.push({ field: "orientation", messageKey: `${PREFIX}invalidOrientation` });
  }

  const width = intOrNull(draft.widthMm);
  const height = intOrNull(draft.heightMm);
  if (draft.paperFormat === "custom") {
    if (width === null || width === false) {
      errors.push({ field: "widthMm", messageKey: `${PREFIX}customDimensionsRequired` });
    }
    if (height === null || height === false) {
      errors.push({ field: "heightMm", messageKey: `${PREFIX}customDimensionsRequired` });
    }
  }
  const inRange = (value: number | null | false) =>
    value === null || (value !== false && value >= BADGE_MIN_SIDE_MM && value <= BADGE_MAX_SIDE_MM);
  if (!inRange(width)) errors.push({ field: "widthMm", messageKey: `${PREFIX}invalidDimensions` });
  if (!inRange(height))
    errors.push({ field: "heightMm", messageKey: `${PREFIX}invalidDimensions` });

  if (draft.showQr) {
    const qr = intOrNull(draft.qrSizeMm);
    if (qr === null || qr === false || qr < BADGE_MIN_QR_MM || qr > BADGE_MAX_QR_MM) {
      errors.push({ field: "qrSizeMm", messageKey: `${PREFIX}invalidQrSize` });
    }
  }
  if (
    draft.backgroundColor.trim() !== "" &&
    !ONSITE_HEX_COLOR_PATTERN.test(draft.backgroundColor.trim())
  ) {
    errors.push({ field: "backgroundColor", messageKey: `${PREFIX}invalidBackgroundColor` });
  }
  if (draft.backgroundImageUrl.trim() !== "" && !isOnsiteUrl(draft.backgroundImageUrl)) {
    errors.push({ field: "backgroundImageUrl", messageKey: `${PREFIX}invalidBackgroundUrl` });
  }
  return errors;
}

export function badgeTemplateDraftToInput(
  draft: BadgeTemplateDraft,
  eventId: string,
): BadgeTemplateInput {
  const width = intOrNull(draft.widthMm);
  const height = intOrNull(draft.heightMm);
  return {
    id: draft.id,
    eventId: draft.id === undefined ? eventId : undefined,
    name: draft.name.trim(),
    paperFormat: isPaperFormat(draft.paperFormat) ? draft.paperFormat : "a6",
    orientation: isOrientation(draft.orientation) ? draft.orientation : "portrait",
    widthMm: width === false ? null : width,
    heightMm: height === false ? null : height,
    showQr: draft.showQr,
    qrSizeMm: intOr(draft.qrSizeMm, 30),
    doubleFold: draft.doubleFold,
    backgroundColor: trimOrNull(draft.backgroundColor),
    backgroundImageUrl: trimOrNull(draft.backgroundImageUrl),
    isDefault: draft.isDefault,
  };
}
