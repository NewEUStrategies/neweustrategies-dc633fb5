// Szkic ustawień uczestnika: stan formularzy czterech ekranów, walidacja
// i ładunek zapisu `admin_event_participant_settings_save`.
//
// CZTERY EKRANY, JEDEN WIERSZ. Panel komunikacji (przypomnienia, kalendarz),
// panel zasad rejestracji (przekazanie, zwrot, oferty z listy rezerwowej)
// i dwa ekrany toru C (certyfikat, ankieta) zapisują ten sam wiersz
// `event_participant_settings`. RPC ma regułę „brak klucza = bez zmian",
// więc każdy ekran wysyła WYŁĄCZNIE swoje klucze (`SCREEN_FIELDS`) - zapis
// panelu komunikacji nie ma prawa nadpisać certyfikatu, który ktoś właśnie
// edytuje w drugiej karcie.
//
// LICZBY JAKO NAPISY. Kontrolowany input liczbowy musi trzymać napis
// (skasowanie ostatniej cyfry to `""`, nie `NaN`). Ten moduł jest jedynym
// miejscem, w którym napis zamienia się w liczbę - z tą samą regułą, którą
// sprawdza baza (liczba całkowita w zakresie; godziny certyfikatu zaokrąglane
// do setnych PRZED sprawdzeniem zakresu, dokładnie jak w SQL).
//
// KLUCZE KOMUNIKATÓW SĄ PEŁNE. `adminEventParticipant.errors.*` to literały,
// nie sklejanie - skaner kluczy widzi każdy liść, a nakładka
// `i18n-admin-event-participant.ts` musi mieć każdy z nich
// (`PARTICIPANT_SETTINGS_ERROR_KEYS`).
import type { Json } from "@/integrations/supabase/types";
import {
  PARTICIPANT_SETTINGS_LIMITS as L,
  type CertificateEligibility,
  type LeadPreset,
  type ParticipantSettingsValues,
  type RefundMode,
} from "@/lib/events/participantSettings";

export type ParticipantSettingsScreen = "communications" | "policies" | "certificate" | "survey";

/** Stan formularza; liczby jako napisy, pola tekstowe bez `null`. */
export interface ParticipantSettingsDraft {
  calendarExportEnabled: boolean;
  remindersEnabled: boolean;
  reminderEventLeadsMinutes: number[];
  sessionRemindersEnabled: boolean;
  sessionReminderLeadMinutes: string;
  reminderSmsEnabled: boolean;
  transferEnabled: boolean;
  transferDeadlineHours: string;
  refundMode: RefundMode;
  refundDeadlineHours: string;
  waitlistOfferHours: string;
  certificateEnabled: boolean;
  certificateEligibility: CertificateEligibility;
  certificateMinSessions: string;
  certificateRequireSurvey: boolean;
  certificateHours: string;
  certificateIssuerName: string;
  certificateSignatoryName: string;
  certificateSignatoryTitlePl: string;
  certificateSignatoryTitleEn: string;
  certificateBodyPl: string;
  certificateBodyEn: string;
  surveyEnabled: boolean;
  surveyAnonymous: boolean;
  surveyCloseAfterDays: string;
  surveyMinResults: string;
  surveyInviteEnabled: boolean;
  surveyIntroPl: string;
  surveyIntroEn: string;
}

export type ParticipantSettingsField = keyof ParticipantSettingsDraft;

/** Każdy klucz komunikatu walidacji - nakładka musi mieć każdy z nich. */
export const PARTICIPANT_SETTINGS_ERROR_KEYS = [
  "adminEventParticipant.errors.reminderLeads",
  "adminEventParticipant.errors.sessionLead",
  "adminEventParticipant.errors.transferDeadline",
  "adminEventParticipant.errors.refundDeadline",
  "adminEventParticipant.errors.offerHours",
  "adminEventParticipant.errors.certificateMinSessions",
  "adminEventParticipant.errors.certificateHours",
  "adminEventParticipant.errors.textLength",
  "adminEventParticipant.errors.surveyCloseDays",
  "adminEventParticipant.errors.surveyMinResults",
] as const;
export type ParticipantSettingsErrorKey = (typeof PARTICIPANT_SETTINGS_ERROR_KEYS)[number];

export interface DraftIssue {
  field: ParticipantSettingsField;
  messageKey: ParticipantSettingsErrorKey;
}

/** Pola każdego ekranu - jedyne klucze, które ekran wysyła do RPC. */
export const SCREEN_FIELDS: Readonly<
  Record<ParticipantSettingsScreen, readonly ParticipantSettingsField[]>
> = {
  communications: [
    "remindersEnabled",
    "reminderEventLeadsMinutes",
    "sessionRemindersEnabled",
    "sessionReminderLeadMinutes",
    "reminderSmsEnabled",
    "calendarExportEnabled",
  ],
  policies: [
    "transferEnabled",
    "transferDeadlineHours",
    "refundMode",
    "refundDeadlineHours",
    "waitlistOfferHours",
  ],
  certificate: [
    "certificateEnabled",
    "certificateEligibility",
    "certificateMinSessions",
    "certificateRequireSurvey",
    "certificateHours",
    "certificateIssuerName",
    "certificateSignatoryName",
    "certificateSignatoryTitlePl",
    "certificateSignatoryTitleEn",
    "certificateBodyPl",
    "certificateBodyEn",
  ],
  survey: [
    "surveyEnabled",
    "surveyAnonymous",
    "surveyCloseAfterDays",
    "surveyMinResults",
    "surveyInviteEnabled",
    "surveyIntroPl",
    "surveyIntroEn",
  ],
};

/** Etykiety gotowych wyprzedzeń przypomnień - pełne klucze. */
export const LEAD_PRESET_LABEL_KEYS: Record<
  LeadPreset,
  | "adminEventParticipant.communications.leads.p10080"
  | "adminEventParticipant.communications.leads.p4320"
  | "adminEventParticipant.communications.leads.p1440"
  | "adminEventParticipant.communications.leads.p720"
  | "adminEventParticipant.communications.leads.p180"
  | "adminEventParticipant.communications.leads.p60"
  | "adminEventParticipant.communications.leads.p30"
  | "adminEventParticipant.communications.leads.p15"
> = {
  10080: "adminEventParticipant.communications.leads.p10080",
  4320: "adminEventParticipant.communications.leads.p4320",
  1440: "adminEventParticipant.communications.leads.p1440",
  720: "adminEventParticipant.communications.leads.p720",
  180: "adminEventParticipant.communications.leads.p180",
  60: "adminEventParticipant.communications.leads.p60",
  30: "adminEventParticipant.communications.leads.p30",
  15: "adminEventParticipant.communications.leads.p15",
};

/** Pola tekstowe (puste = `null` w bazie) i ich limity (znaki, jak `char_length`). */
const TEXT_FIELDS = [
  "certificateIssuerName",
  "certificateSignatoryName",
  "certificateSignatoryTitlePl",
  "certificateSignatoryTitleEn",
  "certificateBodyPl",
  "certificateBodyEn",
  "surveyIntroPl",
  "surveyIntroEn",
] as const;
type TextField = (typeof TEXT_FIELDS)[number];

const TEXT_LIMITS: Readonly<Record<TextField, number>> = {
  certificateIssuerName: L.issuerMax,
  certificateSignatoryName: L.signatoryMax,
  certificateSignatoryTitlePl: L.signatoryMax,
  certificateSignatoryTitleEn: L.signatoryMax,
  certificateBodyPl: L.bodyMax,
  certificateBodyEn: L.bodyMax,
  surveyIntroPl: L.introMax,
  surveyIntroEn: L.introMax,
};

/** Pola liczb całkowitych NOT NULL (napis -> liczba przy zapisie). */
const INTEGER_FIELDS = [
  "sessionReminderLeadMinutes",
  "transferDeadlineHours",
  "refundDeadlineHours",
  "waitlistOfferHours",
  "surveyCloseAfterDays",
  "surveyMinResults",
] as const;
type IntegerField = (typeof INTEGER_FIELDS)[number];

function isTextField(field: ParticipantSettingsField): field is TextField {
  return (TEXT_FIELDS as readonly string[]).includes(field);
}

function isIntegerField(field: ParticipantSettingsField): field is IntegerField {
  return (INTEGER_FIELDS as readonly string[]).includes(field);
}

function numberText(value: number | null): string {
  return value === null ? "" : String(value);
}

/** Szkic z ustawień odczytanych z RPC. */
export function participantSettingsDraftFromSettings(
  s: ParticipantSettingsValues,
): ParticipantSettingsDraft {
  return {
    calendarExportEnabled: s.calendarExportEnabled,
    remindersEnabled: s.remindersEnabled,
    reminderEventLeadsMinutes: [...s.reminderEventLeadsMinutes],
    sessionRemindersEnabled: s.sessionRemindersEnabled,
    sessionReminderLeadMinutes: String(s.sessionReminderLeadMinutes),
    reminderSmsEnabled: s.reminderSmsEnabled,
    transferEnabled: s.transferEnabled,
    transferDeadlineHours: String(s.transferDeadlineHours),
    refundMode: s.refundMode,
    refundDeadlineHours: String(s.refundDeadlineHours),
    waitlistOfferHours: String(s.waitlistOfferHours),
    certificateEnabled: s.certificateEnabled,
    certificateEligibility: s.certificateEligibility,
    certificateMinSessions: numberText(s.certificateMinSessions),
    certificateRequireSurvey: s.certificateRequireSurvey,
    certificateHours: numberText(s.certificateHours),
    certificateIssuerName: s.certificateIssuerName ?? "",
    certificateSignatoryName: s.certificateSignatoryName ?? "",
    certificateSignatoryTitlePl: s.certificateSignatoryTitlePl ?? "",
    certificateSignatoryTitleEn: s.certificateSignatoryTitleEn ?? "",
    certificateBodyPl: s.certificateBodyPl ?? "",
    certificateBodyEn: s.certificateBodyEn ?? "",
    surveyEnabled: s.surveyEnabled,
    surveyAnonymous: s.surveyAnonymous,
    surveyCloseAfterDays: String(s.surveyCloseAfterDays),
    surveyMinResults: String(s.surveyMinResults),
    surveyInviteEnabled: s.surveyInviteEnabled,
    surveyIntroPl: s.surveyIntroPl ?? "",
    surveyIntroEn: s.surveyIntroEn ?? "",
  };
}

/** Liczba całkowita z napisu; `null` dla pustego albo nie-całkowitego. */
function parseInteger(value: string): number | null {
  const trimmed = value.trim();
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/** Godziny certyfikatu: przecinek albo kropka, zaokrąglenie do setnych jak `round(x, 2)`. */
function parseHours(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100) / 100;
}

function inRange(value: number | null, min: number, max: number): boolean {
  return value !== null && value >= min && value <= max;
}

/** Długość w znakach (punkty kodowe), po przycięciu - jak `char_length(btrim(x))`. */
function charLength(value: string): number {
  return [...value.trim()].length;
}

function validLeads(leads: readonly number[]): boolean {
  if (leads.length > L.leadsMax) return false;
  if (new Set(leads).size !== leads.length) return false;
  return leads.every((lead) => Number.isInteger(lead) && lead >= L.leadMin && lead <= L.leadMax);
}

/**
 * Błędy szkicu JEDNEGO ekranu - pusta tablica znaczy „można zapisać".
 * Wszystkie naraz, nie pierwszy z brzegu: organizator poprawia formularz raz.
 */
export function validateParticipantSettings(
  d: ParticipantSettingsDraft,
  screen: ParticipantSettingsScreen,
): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const add = (field: ParticipantSettingsField, messageKey: ParticipantSettingsErrorKey): void => {
    issues.push({ field, messageKey });
  };

  if (screen === "communications") {
    if (!validLeads(d.reminderEventLeadsMinutes)) {
      add("reminderEventLeadsMinutes", "adminEventParticipant.errors.reminderLeads");
    }
    if (!inRange(parseInteger(d.sessionReminderLeadMinutes), L.sessionLeadMin, L.sessionLeadMax)) {
      add("sessionReminderLeadMinutes", "adminEventParticipant.errors.sessionLead");
    }
  } else if (screen === "policies") {
    if (!inRange(parseInteger(d.transferDeadlineHours), 0, L.transferDeadlineMax)) {
      add("transferDeadlineHours", "adminEventParticipant.errors.transferDeadline");
    }
    if (!inRange(parseInteger(d.refundDeadlineHours), 0, L.refundDeadlineMax)) {
      add("refundDeadlineHours", "adminEventParticipant.errors.refundDeadline");
    }
    if (!inRange(parseInteger(d.waitlistOfferHours), L.offerHoursMin, L.offerHoursMax)) {
      add("waitlistOfferHours", "adminEventParticipant.errors.offerHours");
    }
  } else if (screen === "certificate") {
    const minBlank = d.certificateMinSessions.trim() === "";
    const minInvalid = minBlank
      ? d.certificateEligibility === "sessions_min"
      : !inRange(parseInteger(d.certificateMinSessions), 1, L.certMinSessionsMax);
    if (minInvalid) {
      add("certificateMinSessions", "adminEventParticipant.errors.certificateMinSessions");
    }
    if (d.certificateHours.trim() !== "") {
      const hours = parseHours(d.certificateHours);
      if (hours === null || hours <= 0 || hours > L.certHoursMax) {
        add("certificateHours", "adminEventParticipant.errors.certificateHours");
      }
    }
  } else {
    if (!inRange(parseInteger(d.surveyCloseAfterDays), L.surveyCloseMin, L.surveyCloseMax)) {
      add("surveyCloseAfterDays", "adminEventParticipant.errors.surveyCloseDays");
    }
    if (!inRange(parseInteger(d.surveyMinResults), L.surveyKMin, L.surveyKMax)) {
      add("surveyMinResults", "adminEventParticipant.errors.surveyMinResults");
    }
  }

  for (const field of SCREEN_FIELDS[screen]) {
    if (isTextField(field) && charLength(d[field]) > TEXT_LIMITS[field]) {
      add(field, "adminEventParticipant.errors.textLength");
    }
  }
  return issues;
}

function sortedLeads(leads: readonly number[]): number[] {
  return [...new Set(leads)].sort((a, b) => b - a);
}

function sameValue(
  a: ParticipantSettingsDraft,
  b: ParticipantSettingsDraft,
  field: ParticipantSettingsField,
): boolean {
  if (field === "reminderEventLeadsMinutes") {
    return (
      sortedLeads(a.reminderEventLeadsMinutes).join(",") ===
      sortedLeads(b.reminderEventLeadsMinutes).join(",")
    );
  }
  return a[field] === b[field];
}

/** Czy ekran ma niezapisane zmiany (tylko jego pola). */
export function participantSettingsDirty(
  a: ParticipantSettingsDraft,
  b: ParticipantSettingsDraft,
  screen: ParticipantSettingsScreen,
): boolean {
  return SCREEN_FIELDS[screen].some((field) => !sameValue(a, b, field));
}

/** `certificateSignatoryTitlePl` -> `certificate_signatory_title_pl`. */
function columnOf(field: ParticipantSettingsField): string {
  return field.replace(/[A-Z]/g, (chr) => `_${chr.toLowerCase()}`);
}

function payloadValue(d: ParticipantSettingsDraft, field: ParticipantSettingsField): Json {
  if (field === "reminderEventLeadsMinutes") return sortedLeads(d.reminderEventLeadsMinutes);
  if (field === "certificateMinSessions") return parseInteger(d.certificateMinSessions);
  if (field === "certificateHours") return parseHours(d.certificateHours);
  if (field === "refundMode") return d.refundMode;
  if (field === "certificateEligibility") return d.certificateEligibility;
  if (isIntegerField(field)) return parseInteger(d[field]);
  if (isTextField(field)) {
    const trimmed = d[field].trim();
    return trimmed === "" ? null : trimmed;
  }
  return d[field];
}

/**
 * Ładunek zapisu: `event_id` + WYŁĄCZNIE klucze danego ekranu (snake_case
 * = nazwy kolumn). Puste pole tekstowe jedzie jako `null` (baza i tak zamienia
 * pusty napis na NULL), wyprzedzenia bez duplikatów, malejąco.
 */
export function participantSettingsPayload(
  eventId: string,
  d: ParticipantSettingsDraft,
  screen: ParticipantSettingsScreen,
): { [key: string]: Json } {
  const payload: { [key: string]: Json } = { event_id: eventId };
  for (const field of SCREEN_FIELDS[screen]) {
    payload[columnOf(field)] = payloadValue(d, field);
  }
  return payload;
}
