// Ustawienia funkcji uczestnika (F1-F5) - kontrakt z tabelą
// `event_participant_settings` i RPC `admin_event_participant_settings_get`.
//
// PO CO CZYSTY MODUŁ. Panel komunikacji, panel zasad rejestracji i grupa
// „po wydarzeniu" (tor C) czytają TEN SAM wiersz. Każdy z nich potrzebuje
// tych samych limitów (np. „najwyżej 4 przypomnienia, od 15 minut do tygodnia")
// i tych samych wartości domyślnych, co kolumny tabeli. Gdyby każdy panel
// trzymał własne liczby, pierwsza zmiana migracji rozjechałaby formularz
// z bazą bez jednego czerwonego testu. Tu stoją raz - a test parytetu
// (`participantSettings.test.ts`) czyta migrację (po sufiksie nazwy) i pilnuje,
// że każda liczba i każda wartość domyślna zgadza się z DDL.
//
// PARSER NIE UFA ODPOWIEDZI. RPC zwraca `to_jsonb(wiersz)`: kształt jest
// pewny, ale typy JSON-a nie są gwarancją kompilatora. Wartość złego typu
// wraca do wartości domyślnej kolumny - panel pokaże propozycję, a nie
// `NaN` w polu liczbowym.

/** Tryby zwrotu (`event_participant_settings_refund_mode_values`). */
export const REFUND_MODES = ["policy", "none"] as const;
export type RefundMode = (typeof REFUND_MODES)[number];

/** Kryteria certyfikatu (`event_participant_settings_certificate_eligibility_values`). */
export const CERTIFICATE_ELIGIBILITY_MODES = ["attended", "sessions_min", "confirmed"] as const;
export type CertificateEligibility = (typeof CERTIFICATE_ELIGIBILITY_MODES)[number];

/** Gotowe wyprzedzenia przypomnień o wydarzeniu (minuty, malejąco: tydzień ... 15 min). */
export const REMINDER_LEAD_PRESETS_MINUTES = [10080, 4320, 1440, 720, 180, 60, 30, 15] as const;
export type LeadPreset = (typeof REMINDER_LEAD_PRESETS_MINUTES)[number];

/** Gotowe wyprzedzenia przypomnienia o sesji (minuty). */
export const SESSION_REMINDER_LEAD_PRESETS = [5, 10, 15, 30, 60] as const;
export type SessionLeadPreset = (typeof SESSION_REMINDER_LEAD_PRESETS)[number];

/** Granice wartości - lustro nazwanych CHECK-ów tabeli (parytet w teście). */
export const PARTICIPANT_SETTINGS_LIMITS = {
  leadsMax: 4,
  leadMin: 15,
  leadMax: 10080,
  sessionLeadMin: 5,
  sessionLeadMax: 240,
  transferDeadlineMax: 720,
  refundDeadlineMax: 2160,
  offerHoursMin: 2,
  offerHoursMax: 168,
  certMinSessionsMax: 100,
  certHoursMax: 999,
  issuerMax: 160,
  signatoryMax: 120,
  bodyMax: 600,
  introMax: 600,
  surveyCloseMin: 1,
  surveyCloseMax: 90,
  surveyKMin: 5,
  surveyKMax: 50,
} as const;

/** Wartości konfigurowalne - jedna właściwość na kolumnę ustawień. */
export interface ParticipantSettingsValues {
  calendarExportEnabled: boolean;
  remindersEnabled: boolean;
  reminderEventLeadsMinutes: number[];
  sessionRemindersEnabled: boolean;
  sessionReminderLeadMinutes: number;
  reminderSmsEnabled: boolean;
  transferEnabled: boolean;
  transferDeadlineHours: number;
  refundMode: RefundMode;
  refundDeadlineHours: number;
  waitlistOfferHours: number;
  certificateEnabled: boolean;
  certificateEligibility: CertificateEligibility;
  certificateMinSessions: number | null;
  certificateRequireSurvey: boolean;
  certificateHours: number | null;
  certificateIssuerName: string | null;
  certificateSignatoryName: string | null;
  certificateSignatoryTitlePl: string | null;
  certificateSignatoryTitleEn: string | null;
  certificateBodyPl: string | null;
  certificateBodyEn: string | null;
  surveyEnabled: boolean;
  surveyAnonymous: boolean;
  surveyCloseAfterDays: number;
  surveyMinResults: number;
  surveyInviteEnabled: boolean;
  surveyIntroPl: string | null;
  surveyIntroEn: string | null;
}

/** Odpowiedź panelu: wartości + metadane z RPC. */
export interface ParticipantSettings extends ParticipantSettingsValues {
  eventId: string;
  /** `false` = wiersza jeszcze nie ma, RPC oddało wartości domyślne kolumn. */
  hasRow: boolean;
  /** Czy wydarzenie ma punkty kontrolne sesji (warunek trybu `sessions_min`). */
  hasSessionCheckpoints: boolean;
  updatedAt: string | null;
}

/** DEFAULT-y kolumn `event_participant_settings` (parytet w teście). */
export const DEFAULT_PARTICIPANT_SETTINGS: Readonly<ParticipantSettingsValues> = Object.freeze({
  calendarExportEnabled: true,
  remindersEnabled: true,
  reminderEventLeadsMinutes: [1440, 60],
  sessionRemindersEnabled: true,
  sessionReminderLeadMinutes: 15,
  reminderSmsEnabled: false,
  transferEnabled: true,
  transferDeadlineHours: 24,
  refundMode: "policy",
  refundDeadlineHours: 168,
  waitlistOfferHours: 24,
  certificateEnabled: false,
  certificateEligibility: "attended",
  certificateMinSessions: null,
  certificateRequireSurvey: false,
  certificateHours: null,
  certificateIssuerName: null,
  certificateSignatoryName: null,
  certificateSignatoryTitlePl: null,
  certificateSignatoryTitleEn: null,
  certificateBodyPl: null,
  certificateBodyEn: null,
  surveyEnabled: false,
  surveyAnonymous: true,
  surveyCloseAfterDays: 14,
  surveyMinResults: 5,
  surveyInviteEnabled: true,
  surveyIntroPl: null,
  surveyIntroEn: null,
});

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : null;
}

function bool(source: Bag, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}

function int(source: Bag, key: string, fallback: number): number {
  const value = source[key];
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function nullableInt(source: Bag, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nullableNumber(source: Bag, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(source: Bag, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function leads(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_PARTICIPANT_SETTINGS.reminderEventLeadsMinutes];
  return value.filter((lead): lead is number => typeof lead === "number" && Number.isInteger(lead));
}

/**
 * Odpowiedź `admin_event_participant_settings_get` -> ustawienia panelu.
 * `null`, gdy odpowiedź nie jest obiektem albo nie niesie `event_id`.
 */
export function parseParticipantSettings(raw: unknown): ParticipantSettings | null {
  const row = bag(raw);
  if (row === null) return null;
  const eventId = text(row, "event_id");
  if (eventId === null) return null;
  const d = DEFAULT_PARTICIPANT_SETTINGS;
  return {
    eventId,
    hasRow: bool(row, "has_row", false),
    hasSessionCheckpoints: bool(row, "has_session_checkpoints", false),
    updatedAt: text(row, "updated_at"),
    calendarExportEnabled: bool(row, "calendar_export_enabled", d.calendarExportEnabled),
    remindersEnabled: bool(row, "reminders_enabled", d.remindersEnabled),
    reminderEventLeadsMinutes: leads(row["reminder_event_leads_minutes"]),
    sessionRemindersEnabled: bool(row, "session_reminders_enabled", d.sessionRemindersEnabled),
    sessionReminderLeadMinutes: int(
      row,
      "session_reminder_lead_minutes",
      d.sessionReminderLeadMinutes,
    ),
    reminderSmsEnabled: bool(row, "reminder_sms_enabled", d.reminderSmsEnabled),
    transferEnabled: bool(row, "transfer_enabled", d.transferEnabled),
    transferDeadlineHours: int(row, "transfer_deadline_hours", d.transferDeadlineHours),
    refundMode: oneOf(row["refund_mode"], REFUND_MODES, d.refundMode),
    refundDeadlineHours: int(row, "refund_deadline_hours", d.refundDeadlineHours),
    waitlistOfferHours: int(row, "waitlist_offer_hours", d.waitlistOfferHours),
    certificateEnabled: bool(row, "certificate_enabled", d.certificateEnabled),
    certificateEligibility: oneOf(
      row["certificate_eligibility"],
      CERTIFICATE_ELIGIBILITY_MODES,
      d.certificateEligibility,
    ),
    certificateMinSessions: nullableInt(row, "certificate_min_sessions"),
    certificateRequireSurvey: bool(row, "certificate_require_survey", d.certificateRequireSurvey),
    certificateHours: nullableNumber(row, "certificate_hours"),
    certificateIssuerName: text(row, "certificate_issuer_name"),
    certificateSignatoryName: text(row, "certificate_signatory_name"),
    certificateSignatoryTitlePl: text(row, "certificate_signatory_title_pl"),
    certificateSignatoryTitleEn: text(row, "certificate_signatory_title_en"),
    certificateBodyPl: text(row, "certificate_body_pl"),
    certificateBodyEn: text(row, "certificate_body_en"),
    surveyEnabled: bool(row, "survey_enabled", d.surveyEnabled),
    surveyAnonymous: bool(row, "survey_anonymous", d.surveyAnonymous),
    surveyCloseAfterDays: int(row, "survey_close_after_days", d.surveyCloseAfterDays),
    surveyMinResults: int(row, "survey_min_results", d.surveyMinResults),
    surveyInviteEnabled: bool(row, "survey_invite_enabled", d.surveyInviteEnabled),
    surveyIntroPl: text(row, "survey_intro_pl"),
    surveyIntroEn: text(row, "survey_intro_en"),
  };
}
