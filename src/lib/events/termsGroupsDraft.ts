// Szkice formularzy GRUP i ZGOD: wiersz bazy <-> pola tekstowe <-> payload RPC.
//
// FORMULARZ TRZYMA TEKSTY, NIE LICZBY. Pole liczbowe w trakcie pisania bywa
// puste albo „12a"; typ `number` kazalby zgadywac, co znaczy `NaN`. Konwersja
// jest jedna i jest tutaj - dialog nie liczy, panel nie parsuje.
//
// WALIDACJA POWTARZA REGULY BAZY, NIE ZASTEPUJE ICH. Baza zostaje jedynym
// zrodlem prawdy (`invalid_key`, `invalid_names`); ta warstwa oszczedza tylko
// obieg sieciowy i pokazuje blad przy polu, a nie w toascie.
import {
  TERMS_GROUPS_KEY_PATTERN,
  type GroupInput,
  type GroupVisibility,
  type TermDisplay,
  type TermInput,
} from "@/lib/events/termsGroupsApi";

const VALIDATION = "adminEventTerms.validation.";

export const TERMS_MAX_NAME = 160;
export const TERMS_MAX_DESCRIPTION = 600;
export const TERMS_MAX_BODY = 8000;
export const TERMS_MAX_URL = 500;

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export interface TermsFieldError<F extends string> {
  field: F;
  messageKey: string;
}

function textOf(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function numberOf(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `false` = tekst nie jest liczba calkowita >= 0; `null` = pole puste. */
function intOrNull(raw: string): number | null | false {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return false;
  return Number(trimmed);
}

function intOr(raw: string, fallback: number): number {
  const parsed = intOrNull(raw);
  return parsed === false || parsed === null ? fallback : parsed;
}

function trimOrNull(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/* ----------------------------------------------------------------- grupy --- */

export interface GroupDraft {
  /** `null` = nowa grupa; klucz jest wtedy edytowalny. */
  id: string | null;
  key: string;
  namePl: string;
  nameEn: string;
  descriptionPl: string;
  descriptionEn: string;
  color: string;
  attendeeVisibility: GroupVisibility;
  canSeeAttendees: boolean;
  canMeet: boolean;
  canChat: boolean;
  canLeadRetrieval: boolean;
  canSeeRecording: boolean;
  minTierRank: string;
  sortOrder: string;
  isDefault: boolean;
  isSystem: boolean;
}

export function emptyGroupDraft(nextSortOrder: number): GroupDraft {
  return {
    id: null,
    key: "",
    namePl: "",
    nameEn: "",
    descriptionPl: "",
    descriptionEn: "",
    color: "",
    attendeeVisibility: "registered",
    canSeeAttendees: true,
    canMeet: false,
    canChat: true,
    canLeadRetrieval: false,
    canSeeRecording: true,
    minTierRank: "0",
    sortOrder: String(nextSortOrder),
    isDefault: false,
    isSystem: false,
  };
}

function visibilityOf(value: unknown): GroupVisibility {
  const text = textOf(value);
  return text === "none" || text === "own_group" || text === "everyone" ? text : "registered";
}

export function groupDraftFromRow(row: Record<string, unknown>): GroupDraft {
  return {
    id: String(row.id),
    key: textOf(row.key),
    namePl: textOf(row.name_pl),
    nameEn: textOf(row.name_en),
    descriptionPl: textOf(row.description_pl),
    descriptionEn: textOf(row.description_en),
    color: textOf(row.color),
    attendeeVisibility: visibilityOf(row.attendee_visibility),
    canSeeAttendees: row.can_see_attendees !== false,
    canMeet: row.can_meet === true,
    canChat: row.can_chat !== false,
    canLeadRetrieval: row.can_lead_retrieval === true,
    canSeeRecording: row.can_see_recording !== false,
    minTierRank: String(numberOf(row.min_tier_rank, 0)),
    sortOrder: String(numberOf(row.sort_order, 100)),
    isDefault: row.is_default === true,
    isSystem: row.is_system === true,
  };
}

export type GroupField = keyof GroupDraft;

export function validateGroupDraft(draft: GroupDraft): Array<TermsFieldError<GroupField>> {
  const errors: Array<TermsFieldError<GroupField>> = [];
  if (draft.id === null && !TERMS_GROUPS_KEY_PATTERN.test(draft.key.trim())) {
    errors.push({ field: "key", messageKey: `${VALIDATION}invalidKey` });
  }
  if (draft.namePl.trim() === "" || draft.nameEn.trim() === "") {
    errors.push({ field: "namePl", messageKey: `${VALIDATION}invalidNames` });
  }
  if (draft.color.trim() !== "" && !HEX_COLOR_PATTERN.test(draft.color.trim())) {
    errors.push({ field: "color", messageKey: `${VALIDATION}invalidColor` });
  }
  if (intOrNull(draft.minTierRank) === false || intOrNull(draft.sortOrder) === false) {
    errors.push({ field: "minTierRank", messageKey: `${VALIDATION}invalidNumber` });
  }
  return errors;
}

export function groupDraftToInput(draft: GroupDraft, eventId: string): GroupInput {
  // CHECK bazy: `can_see_attendees OR attendee_visibility = 'none'`. Wylaczony
  // wlacznik z zasiegiem innym niz `none` to odmowa - domykamy to tutaj, zeby
  // organizator nie dostawal komunikatu o warunku tabeli.
  const visibility: GroupVisibility = draft.canSeeAttendees ? draft.attendeeVisibility : "none";
  return {
    id: draft.id ?? undefined,
    eventId: draft.id === null ? eventId : undefined,
    key: draft.id === null ? draft.key.trim() : undefined,
    namePl: draft.namePl.trim(),
    nameEn: draft.nameEn.trim(),
    descriptionPl: draft.descriptionPl.trim(),
    descriptionEn: draft.descriptionEn.trim(),
    color: trimOrNull(draft.color),
    attendeeVisibility: visibility,
    canSeeAttendees: draft.canSeeAttendees,
    canMeet: draft.canMeet,
    canChat: draft.canChat,
    canLeadRetrieval: draft.canLeadRetrieval,
    canSeeRecording: draft.canSeeRecording,
    minTierRank: intOr(draft.minTierRank, 0),
    sortOrder: intOr(draft.sortOrder, 100),
    isDefault: draft.isDefault,
  };
}

/* ------------------------------------------------------------------ zgody --- */

export interface TermDraft {
  id: string | null;
  key: string;
  labelPl: string;
  labelEn: string;
  bodyPl: string;
  bodyEn: string;
  externalUrl: string;
  display: TermDisplay;
  isRequired: boolean;
  sortOrder: string;
  isActive: boolean;
  /** Zawsze `false` na wejsciu - podniesienie wersji jest decyzja, nie stanem. */
  bumpVersion: boolean;
  version: number;
}

export function emptyTermDraft(nextSortOrder: number): TermDraft {
  return {
    id: null,
    key: "",
    labelPl: "",
    labelEn: "",
    bodyPl: "",
    bodyEn: "",
    externalUrl: "",
    display: "registration",
    isRequired: false,
    sortOrder: String(nextSortOrder),
    isActive: true,
    bumpVersion: false,
    version: 1,
  };
}

function displayOf(value: unknown): TermDisplay {
  const text = textOf(value);
  return text === "access" || text === "registration_and_access" ? text : "registration";
}

export function termDraftFromRow(row: Record<string, unknown>): TermDraft {
  return {
    id: String(row.id),
    key: textOf(row.key),
    labelPl: textOf(row.label_pl),
    labelEn: textOf(row.label_en),
    bodyPl: textOf(row.body_pl),
    bodyEn: textOf(row.body_en),
    externalUrl: textOf(row.external_url),
    display: displayOf(row.display),
    isRequired: row.is_required === true,
    sortOrder: String(numberOf(row.sort_order, 100)),
    isActive: row.is_active !== false,
    bumpVersion: false,
    version: numberOf(row.version, 1),
  };
}

export type TermField = keyof TermDraft;

export function validateTermDraft(draft: TermDraft): Array<TermsFieldError<TermField>> {
  const errors: Array<TermsFieldError<TermField>> = [];
  if (draft.id === null && !TERMS_GROUPS_KEY_PATTERN.test(draft.key.trim())) {
    errors.push({ field: "key", messageKey: `${VALIDATION}invalidKey` });
  }
  if (draft.labelPl.trim() === "" || draft.labelEn.trim() === "") {
    errors.push({ field: "labelPl", messageKey: `${VALIDATION}invalidLabels` });
  }
  const url = draft.externalUrl.trim();
  if (url !== "" && !/^https:\/\/[^\s]+$/.test(url)) {
    errors.push({ field: "externalUrl", messageKey: `${VALIDATION}invalidUrl` });
  }
  if (intOrNull(draft.sortOrder) === false) {
    errors.push({ field: "sortOrder", messageKey: `${VALIDATION}invalidNumber` });
  }
  return errors;
}

export function termDraftToInput(draft: TermDraft, eventId: string): TermInput {
  return {
    id: draft.id ?? undefined,
    eventId: draft.id === null ? eventId : undefined,
    key: draft.id === null ? draft.key.trim() : undefined,
    labelPl: draft.labelPl.trim(),
    labelEn: draft.labelEn.trim(),
    bodyPl: draft.bodyPl.trim(),
    bodyEn: draft.bodyEn.trim(),
    externalUrl: trimOrNull(draft.externalUrl),
    display: draft.display,
    isRequired: draft.isRequired,
    sortOrder: intOr(draft.sortOrder, 100),
    isActive: draft.isActive,
    // Nowa zgoda startuje z wersja 1 - `bump_version` przy tworzeniu nie ma sensu.
    bumpVersion: draft.id === null ? undefined : draft.bumpVersion,
  };
}

/** Ile akceptacji przestalo byc aktualne po podniesieniu wersji. */
export function staleAcceptances(row: {
  acceptances_total: number;
  acceptances_current: number;
}): number {
  const stale = numberOf(row.acceptances_total, 0) - numberOf(row.acceptances_current, 0);
  return stale > 0 ? stale : 0;
}
