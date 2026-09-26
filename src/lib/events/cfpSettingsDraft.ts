// Szkic ekranu „Ustawienia naboru" - czysty stan formularza, walidacja
// i ładunek `admin_event_cfp_settings_save`.
//
// POLA LICZBOWE SĄ NAPISAMI. Pole tekstowe nie ma jak oddać „nic" inaczej niż
// pustym napisem, a „3a" musi dać czerwone zdanie przy polu, nie `NaN`
// w ładunku. Zamiana na liczby dzieje się dopiero w `cfpSettingsPayload`.
//
// WALIDACJA LUSTRZANA DO BAZY. Każda reguła tu ma odpowiednik w SQL-u
// (`invalid_formats`, `invalid_window`, ...). Baza jest ostatnią linią obrony,
// a ta warstwa daje zdanie PRZY POLU zamiast toasta po odbiciu zapisu.
//
// ŁADUNEK NIESIE KOMPLET PÓL - ekran edytuje wszystkie, więc PATCH po obecności
// klucza nie ma tu czego oszczędzać, a pominięte pole zostawiłoby w bazie
// wartość sprzed zmiany pod komunikatem „zapisano".
import type { CfpStatus } from "@/lib/events/cfpEnums";
import type { CfpSettingsInput } from "@/lib/events/cfpApi";
import type { CfpSettings } from "@/lib/events/cfpSurface";

export const CFP_KEY_PATTERN = /^[a-z][a-z0-9_]{1,48}$/;
export const CFP_MAX_FORMATS = 20;
export const CFP_MAX_CRITERIA = 10;
export const CFP_TEXT_MAX = 8000;
export const CFP_SCORE_MAX_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10] as const;

export interface CfpFormatDraft {
  key: string;
  labelPl: string;
  labelEn: string;
  durationMin: string;
}

export interface CfpCriterionDraft {
  key: string;
  labelPl: string;
  labelEn: string;
  weight: string;
}

export interface CfpSettingsDraft {
  status: CfpStatus;
  opensAt: string;
  closesAt: string;
  introPl: string;
  introEn: string;
  guidelinesPl: string;
  guidelinesEn: string;
  formats: CfpFormatDraft[];
  trackIds: string[];
  maxPerSubmitter: string;
  allowCoSpeakers: boolean;
  reviewBlind: boolean;
  scoreMax: string;
  minReviews: string;
  criteria: CfpCriterionDraft[];
  speakerGroupId: string | null;
  speakerTicketTypeId: string | null;
}

export type CfpSettingsField =
  "window" | "texts" | "formats" | "maxPerSubmitter" | "scoreMax" | "minReviews" | "criteria";

export interface CfpSettingsIssue {
  field: CfpSettingsField;
  messageKey: string;
}

export function cfpSettingsDraftFromSettings(settings: CfpSettings): CfpSettingsDraft {
  return {
    status: settings.status,
    opensAt: settings.opensAt ?? "",
    closesAt: settings.closesAt ?? "",
    introPl: settings.introPl,
    introEn: settings.introEn,
    guidelinesPl: settings.guidelinesPl,
    guidelinesEn: settings.guidelinesEn,
    formats: settings.formats.map((format) => ({
      key: format.key,
      labelPl: format.labelPl,
      labelEn: format.labelEn,
      durationMin: String(format.durationMin),
    })),
    trackIds: [...settings.trackIds],
    maxPerSubmitter: String(settings.maxPerSubmitter),
    allowCoSpeakers: settings.allowCoSpeakers,
    reviewBlind: settings.reviewBlind,
    scoreMax: String(settings.scoreMax),
    minReviews: String(settings.minReviews),
    criteria: settings.reviewCriteria.map((criterion) => ({
      key: criterion.key,
      labelPl: criterion.labelPl,
      labelEn: criterion.labelEn,
      weight: String(criterion.weight),
    })),
    speakerGroupId: settings.speakerGroupId,
    speakerTicketTypeId: settings.speakerTicketTypeId,
  };
}

/** Liczba całkowita z pola tekstowego; cokolwiek innego = `null`. */
export function parseWholeNumber(value: string): number | null {
  const trimmed = value.trim();
  return /^\d{1,6}$/.test(trimmed) ? Number(trimmed) : null;
}

function inRange(value: string, min: number, max: number): boolean {
  const parsed = parseWholeNumber(value);
  return parsed !== null && parsed >= min && parsed <= max;
}

function labelsOk(labelPl: string, labelEn: string): boolean {
  const pl = labelPl.trim();
  const en = labelEn.trim();
  return pl.length >= 1 && pl.length <= 80 && en.length >= 1 && en.length <= 80;
}

function uniqueKeys(keys: readonly string[]): boolean {
  return new Set(keys).size === keys.length;
}

export function validateCfpSettingsDraft(draft: CfpSettingsDraft): CfpSettingsIssue[] {
  const issues: CfpSettingsIssue[] = [];
  // Porównanie CHWIL, nie napisów: baza oddaje `+00:00`, kalendarz `.000Z`,
  // a porządek leksykalny dwóch zapisów tej samej chwili bywa odwrotny.
  if (
    draft.opensAt !== "" &&
    draft.closesAt !== "" &&
    !(Date.parse(draft.closesAt) > Date.parse(draft.opensAt))
  ) {
    issues.push({ field: "window", messageKey: "adminEventCfp.settings.validation.window" });
  }
  if (
    [draft.introPl, draft.introEn, draft.guidelinesPl, draft.guidelinesEn].some(
      (text) => text.length > CFP_TEXT_MAX,
    )
  ) {
    issues.push({ field: "texts", messageKey: "adminEventCfp.settings.validation.texts" });
  }
  const formatsOk =
    draft.formats.length <= CFP_MAX_FORMATS &&
    uniqueKeys(draft.formats.map((format) => format.key.trim())) &&
    draft.formats.every(
      (format) =>
        CFP_KEY_PATTERN.test(format.key.trim()) &&
        labelsOk(format.labelPl, format.labelEn) &&
        inRange(format.durationMin, 5, 480),
    );
  if (!formatsOk)
    issues.push({ field: "formats", messageKey: "adminEventCfp.settings.validation.formats" });
  if (!inRange(draft.maxPerSubmitter, 1, 20)) {
    issues.push({
      field: "maxPerSubmitter",
      messageKey: "adminEventCfp.settings.validation.maxPerSubmitter",
    });
  }
  if (!inRange(draft.scoreMax, 3, 10)) {
    issues.push({ field: "scoreMax", messageKey: "adminEventCfp.settings.validation.scoreMax" });
  }
  if (!inRange(draft.minReviews, 0, 20)) {
    issues.push({
      field: "minReviews",
      messageKey: "adminEventCfp.settings.validation.minReviews",
    });
  }
  const criteriaOk =
    draft.criteria.length <= CFP_MAX_CRITERIA &&
    uniqueKeys(draft.criteria.map((criterion) => criterion.key.trim())) &&
    draft.criteria.every(
      (criterion) =>
        CFP_KEY_PATTERN.test(criterion.key.trim()) &&
        labelsOk(criterion.labelPl, criterion.labelEn) &&
        inRange(criterion.weight, 1, 10),
    );
  if (!criteriaOk)
    issues.push({ field: "criteria", messageKey: "adminEventCfp.settings.validation.criteria" });
  return issues;
}

export function cfpSettingsPayload(eventId: string, draft: CfpSettingsDraft): CfpSettingsInput {
  return {
    eventId,
    status: draft.status,
    opensAt: draft.opensAt === "" ? null : draft.opensAt,
    closesAt: draft.closesAt === "" ? null : draft.closesAt,
    introPl: draft.introPl,
    introEn: draft.introEn,
    guidelinesPl: draft.guidelinesPl,
    guidelinesEn: draft.guidelinesEn,
    formats: draft.formats.map((format) => ({
      key: format.key.trim(),
      label_pl: format.labelPl.trim(),
      label_en: format.labelEn.trim(),
      duration_min: Number(format.durationMin.trim()),
    })),
    trackIds: [...draft.trackIds],
    maxPerSubmitter: Number(draft.maxPerSubmitter.trim()),
    allowCoSpeakers: draft.allowCoSpeakers,
    reviewBlind: draft.reviewBlind,
    scoreMax: Number(draft.scoreMax.trim()),
    reviewCriteria: draft.criteria.map((criterion) => ({
      key: criterion.key.trim(),
      label_pl: criterion.labelPl.trim(),
      label_en: criterion.labelEn.trim(),
      weight: Number(criterion.weight.trim()),
    })),
    minReviews: Number(draft.minReviews.trim()),
    speakerGroupId: draft.speakerGroupId,
    speakerTicketTypeId: draft.speakerTicketTypeId,
  };
}

export function cfpSettingsDirty(a: CfpSettingsDraft, b: CfpSettingsDraft): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** Klucz techniczny z etykiety: „Wykład główny" -> `wyklad_glowny`. */
export function suggestCfpKey(label: string): string {
  const folded = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "");
  return folded.slice(0, 49);
}

export function emptyFormatDraft(): CfpFormatDraft {
  return { key: "", labelPl: "", labelEn: "", durationMin: "30" };
}

export function emptyCriterionDraft(): CfpCriterionDraft {
  return { key: "", labelPl: "", labelEn: "", weight: "1" };
}

/** Przełącza obecność elementu na liście (np. ścieżki w zakresie). */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}
