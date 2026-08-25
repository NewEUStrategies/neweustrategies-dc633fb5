// Wersje robocze formularzy modulu SPONSORZY: poziomy, przypiecia firm, materialy.
//
// JEDEN PLIK, BO TO JEDEN LANCUCH DANYCH. Poziom nadaje limit, przypiecie nosi
// migawke firmy, material wisi na przypieciu - te trzy formularze dziela te same
// konwersje (tekst -> liczba, pusty tekst -> `null`, wzor koloru, wzor adresu).
// Rozbicie na trzy pliki zdublowaloby konwersje, a zdublowana konwersja
// rozjezdza sie przy pierwszej zmianie limitu w migracji.
//
// PUSTY TEKST TO BRAK WARTOSCI, NIE ZERO ANI PUSTY NAPIS. Poziom bez limitu firm
// przyjmie kazda firme; poziom z limitem `0` nie przyjmie zadnej. To dwa rozne
// zdania i formularz nie ma prawa ich sklejac.
//
// WALIDACJA STOI PRZED RPC, ALE GO NIE ZASTEPUJE. Baza dalej pilnuje limitow,
// unikalnosci klucza i tego, ze opublikowany sponsor ma poziom
// (`event_sponsors_published_needs_tier`); formularz tylko oszczedza
// organizatorowi podrozy po odmowe.
import type {
  SponsorInput,
  SponsorMaterialInput,
  SponsorMaterialKind,
  SponsorRole,
  SponsorTierInput,
  SponsorTierLogoSize,
} from "@/lib/events/sponsorsApi";

export const SPONSOR_KEY_PATTERN = /^[a-z][a-z0-9_]{1,48}$/;
export const SPONSOR_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const SPONSOR_MAX_NAME = 200;
export const SPONSOR_MAX_DESCRIPTION = 2000;
export const SPONSOR_MAX_NOTE = 2000;
export const SPONSOR_MAX_COMPANIES = 1000;

const PREFIX = "adminEventSponsors.errors.";

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOf(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** `null` = pole puste (brak deklaracji); `false` = wpisano cos, co nie jest liczba. */
function intOrNull(value: string): number | null | false {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : false;
}

function intOr(value: string, fallback: number): number {
  const parsed = intOrNull(value);
  return parsed === null || parsed === false ? fallback : parsed;
}

/** Adres materialu: pelny `https://` albo sciezka wewnetrzna `/...`. */
export function isSponsorUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("/")) return !trimmed.startsWith("//");
  return /^https:\/\/[^\s]+\.[^\s]+/.test(trimmed);
}

export interface SponsorFieldError<TField extends string> {
  field: TField;
  messageKey: string;
}

/* ---------------------------------------------------------------- poziomy --- */

export interface TierBenefitDraft {
  labelPl: string;
  labelEn: string;
  isHighlighted: boolean;
}

export interface TierDraft {
  id: string | null;
  key: string;
  namePl: string;
  nameEn: string;
  descriptionPl: string;
  descriptionEn: string;
  rank: string;
  accentColor: string;
  logoSize: SponsorTierLogoSize;
  /** Pusty tekst = bez limitu firm. */
  maxCompanies: string;
  sortOrder: string;
  isActive: boolean;
  benefits: TierBenefitDraft[];
}

export function emptyTierDraft(sortOrder: number, rank: number): TierDraft {
  return {
    id: null,
    key: "",
    namePl: "",
    nameEn: "",
    descriptionPl: "",
    descriptionEn: "",
    rank: String(rank),
    accentColor: "",
    logoSize: "md",
    maxCompanies: "",
    sortOrder: String(sortOrder),
    isActive: true,
    benefits: [],
  };
}

function benefitsFromJson(value: unknown): TierBenefitDraft[] {
  if (!Array.isArray(value)) return [];
  const out: TierBenefitDraft[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    out.push({
      labelPl: textOf(record.label_pl),
      labelEn: textOf(record.label_en),
      isHighlighted: record.is_highlighted === true,
    });
  }
  return out;
}

export function tierDraftFromRow(row: Record<string, unknown>): TierDraft {
  const logoSize = textOf(row.logo_size);
  return {
    id: String(row.id),
    key: textOf(row.key),
    namePl: textOf(row.name_pl),
    nameEn: textOf(row.name_en),
    descriptionPl: textOf(row.description_pl),
    descriptionEn: textOf(row.description_en),
    rank: String(numberOf(row.rank, 0)),
    accentColor: textOf(row.accent_color),
    logoSize: logoSize === "sm" || logoSize === "lg" ? (logoSize as SponsorTierLogoSize) : "md",
    maxCompanies: row.max_companies === null ? "" : String(numberOf(row.max_companies, 0)),
    sortOrder: String(numberOf(row.sort_order, 0)),
    isActive: row.is_active !== false,
    benefits: benefitsFromJson(row.benefits),
  };
}

export type TierField = keyof TierDraft;

export function validateTierDraft(draft: TierDraft): Array<SponsorFieldError<TierField>> {
  const errors: Array<SponsorFieldError<TierField>> = [];
  if (draft.id === null && !SPONSOR_KEY_PATTERN.test(draft.key.trim())) {
    errors.push({ field: "key", messageKey: `${PREFIX}invalidKey` });
  }
  if (draft.namePl.trim() === "" || draft.nameEn.trim() === "") {
    errors.push({ field: "namePl", messageKey: `${PREFIX}invalidNames` });
  }
  if (
    draft.accentColor.trim() !== "" &&
    !SPONSOR_HEX_COLOR_PATTERN.test(draft.accentColor.trim())
  ) {
    errors.push({ field: "accentColor", messageKey: `${PREFIX}invalidColor` });
  }
  const limit = intOrNull(draft.maxCompanies);
  if (limit === false || (limit !== null && limit > SPONSOR_MAX_COMPANIES)) {
    errors.push({ field: "maxCompanies", messageKey: `${PREFIX}invalidNumber` });
  }
  if (intOrNull(draft.rank) === false || intOrNull(draft.sortOrder) === false) {
    errors.push({ field: "rank", messageKey: `${PREFIX}invalidNumber` });
  }
  const emptyBenefit = draft.benefits.some(
    (benefit) => benefit.labelPl.trim() === "" || benefit.labelEn.trim() === "",
  );
  if (emptyBenefit) errors.push({ field: "benefits", messageKey: `${PREFIX}invalidBenefits` });
  return errors;
}

export function tierDraftToInput(draft: TierDraft, eventId: string): SponsorTierInput {
  const limit = intOrNull(draft.maxCompanies);
  return {
    id: draft.id ?? undefined,
    eventId: draft.id === null ? eventId : undefined,
    key: draft.id === null ? draft.key.trim() : undefined,
    namePl: draft.namePl.trim(),
    nameEn: draft.nameEn.trim(),
    descriptionPl: draft.descriptionPl.trim(),
    descriptionEn: draft.descriptionEn.trim(),
    rank: intOr(draft.rank, 0),
    accentColor: trimOrNull(draft.accentColor),
    logoSize: draft.logoSize,
    maxCompanies: limit === false ? null : limit,
    sortOrder: intOr(draft.sortOrder, 0),
    isActive: draft.isActive,
    benefits: draft.benefits.map((benefit) => ({
      labelPl: benefit.labelPl.trim(),
      labelEn: benefit.labelEn.trim(),
      isHighlighted: benefit.isHighlighted,
    })),
  };
}

/* -------------------------------------------------------------- sponsorzy --- */

export interface SponsorDraft {
  id: string | null;
  companyId: string;
  /** Tylko do pokazania w formularzu - nie jedzie do bazy. */
  companyLabel: string;
  /** Pusty tekst = bez poziomu (dozwolone wylacznie dla szkicu). */
  tierId: string;
  role: SponsorRole;
  isPublished: boolean;
  boothLabel: string;
  sortOrder: string;
  snapshotName: string;
  snapshotLogoUrl: string;
  snapshotWebsite: string;
  snapshotCountry: string;
  snapshotDescriptionPl: string;
  snapshotDescriptionEn: string;
  internalNote: string;
}

export function emptySponsorDraft(sortOrder: number): SponsorDraft {
  return {
    id: null,
    companyId: "",
    companyLabel: "",
    tierId: "",
    role: "sponsor",
    isPublished: false,
    boothLabel: "",
    sortOrder: String(sortOrder),
    snapshotName: "",
    snapshotLogoUrl: "",
    snapshotWebsite: "",
    snapshotCountry: "",
    snapshotDescriptionPl: "",
    snapshotDescriptionEn: "",
    internalNote: "",
  };
}

export function sponsorDraftFromRow(row: Record<string, unknown>): SponsorDraft {
  const role = textOf(row.role);
  return {
    id: String(row.id),
    companyId: textOf(row.company_id),
    companyLabel: textOf(row.crm_name) || textOf(row.snapshot_name),
    tierId: textOf(row.tier_id),
    role:
      role === "partner" || role === "media_partner" || role === "exhibitor"
        ? (role as SponsorRole)
        : "sponsor",
    isPublished: row.is_published === true,
    boothLabel: textOf(row.booth_label),
    sortOrder: String(numberOf(row.sort_order, 0)),
    snapshotName: textOf(row.snapshot_name),
    snapshotLogoUrl: textOf(row.snapshot_logo_url),
    snapshotWebsite: textOf(row.snapshot_website),
    snapshotCountry: textOf(row.snapshot_country),
    snapshotDescriptionPl: textOf(row.snapshot_description_pl),
    snapshotDescriptionEn: textOf(row.snapshot_description_en),
    internalNote: textOf(row.internal_note),
  };
}

export type SponsorField = keyof SponsorDraft;

export function validateSponsorDraft(draft: SponsorDraft): Array<SponsorFieldError<SponsorField>> {
  const errors: Array<SponsorFieldError<SponsorField>> = [];
  if (draft.id === null && draft.companyId.trim() === "") {
    errors.push({ field: "companyId", messageKey: `${PREFIX}invalidCompany` });
  }
  if (draft.snapshotName.trim() === "") {
    errors.push({ field: "snapshotName", messageKey: `${PREFIX}invalidName` });
  }
  if (draft.isPublished && draft.tierId.trim() === "") {
    errors.push({ field: "tierId", messageKey: `${PREFIX}sponsorTierRequired` });
  }
  if (draft.snapshotWebsite.trim() !== "" && !isSponsorUrl(draft.snapshotWebsite)) {
    errors.push({ field: "snapshotWebsite", messageKey: `${PREFIX}invalidUrl` });
  }
  if (draft.snapshotLogoUrl.trim() !== "" && !isSponsorUrl(draft.snapshotLogoUrl)) {
    errors.push({ field: "snapshotLogoUrl", messageKey: `${PREFIX}invalidUrl` });
  }
  if (intOrNull(draft.sortOrder) === false) {
    errors.push({ field: "sortOrder", messageKey: `${PREFIX}invalidNumber` });
  }
  return errors;
}

export function sponsorDraftToInput(draft: SponsorDraft, eventId: string): SponsorInput {
  return {
    id: draft.id ?? undefined,
    eventId: draft.id === null ? eventId : undefined,
    companyId: draft.id === null ? draft.companyId : undefined,
    tierId: trimOrNull(draft.tierId),
    role: draft.role,
    isPublished: draft.isPublished,
    boothLabel: trimOrNull(draft.boothLabel),
    sortOrder: intOr(draft.sortOrder, 0),
    snapshotName: draft.snapshotName.trim(),
    snapshotLogoUrl: trimOrNull(draft.snapshotLogoUrl),
    snapshotWebsite: trimOrNull(draft.snapshotWebsite),
    snapshotCountry: trimOrNull(draft.snapshotCountry),
    snapshotDescriptionPl: draft.snapshotDescriptionPl.trim(),
    snapshotDescriptionEn: draft.snapshotDescriptionEn.trim(),
    internalNote: trimOrNull(draft.internalNote),
  };
}

/* -------------------------------------------------------------- materialy --- */

export interface MaterialDraft {
  id: string | null;
  kind: SponsorMaterialKind;
  titlePl: string;
  titleEn: string;
  url: string;
  sortOrder: string;
  isPublished: boolean;
}

export function emptyMaterialDraft(sortOrder: number): MaterialDraft {
  return {
    id: null,
    kind: "document",
    titlePl: "",
    titleEn: "",
    url: "",
    sortOrder: String(sortOrder),
    isPublished: false,
  };
}

export function materialDraftFromRow(row: Record<string, unknown>): MaterialDraft {
  const kind = textOf(row.kind);
  const known = ["document", "presentation", "video", "link", "logo_pack"];
  return {
    id: String(row.id),
    kind: known.includes(kind) ? (kind as SponsorMaterialKind) : "document",
    titlePl: textOf(row.title_pl),
    titleEn: textOf(row.title_en),
    url: textOf(row.url),
    sortOrder: String(numberOf(row.sort_order, 0)),
    isPublished: row.is_published === true,
  };
}

export type MaterialField = keyof MaterialDraft;

export function validateMaterialDraft(
  draft: MaterialDraft,
): Array<SponsorFieldError<MaterialField>> {
  const errors: Array<SponsorFieldError<MaterialField>> = [];
  if (draft.titlePl.trim() === "" || draft.titleEn.trim() === "") {
    errors.push({ field: "titlePl", messageKey: `${PREFIX}invalidTitles` });
  }
  if (!isSponsorUrl(draft.url)) {
    errors.push({ field: "url", messageKey: `${PREFIX}invalidUrl` });
  }
  if (intOrNull(draft.sortOrder) === false) {
    errors.push({ field: "sortOrder", messageKey: `${PREFIX}invalidNumber` });
  }
  return errors;
}

export function materialDraftToInput(
  draft: MaterialDraft,
  sponsorId: string,
): SponsorMaterialInput {
  return {
    id: draft.id ?? undefined,
    sponsorId: draft.id === null ? sponsorId : undefined,
    kind: draft.kind,
    titlePl: draft.titlePl.trim(),
    titleEn: draft.titleEn.trim(),
    url: draft.url.trim(),
    sortOrder: intOr(draft.sortOrder, 0),
    isPublished: draft.isPublished,
  };
}
