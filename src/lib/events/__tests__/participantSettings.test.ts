// Ustawienia uczestnika: parser odpowiedzi RPC i PARYTET z migracją.
//
// PO CO PARYTET. Limity (`PARTICIPANT_SETTINGS_LIMITS`), wartości domyślne
// (`DEFAULT_PARTICIPANT_SETTINGS`) i dwa wyliczenia (`REFUND_MODES`,
// `CERTIFICATE_ELIGIBILITY_MODES`) są w TS przepisane z DDL tabeli
// `event_participant_settings`. Kompilator nie zobaczy, że migracja zmieniła
// „najwyżej 4 przypomnienia" na 5 albo domyślny tryb zwrotu - formularz
// zacząłby odrzucać wartości, które baza przyjmuje (albo odwrotnie). Ten plik
// czyta migrację (po SUFIKSIE nazwy, nie po znaczniku czasu - Integracja może
// przenumerować) i przypina każdą liczbę.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CERTIFICATE_ELIGIBILITY_MODES,
  DEFAULT_PARTICIPANT_SETTINGS,
  PARTICIPANT_SETTINGS_LIMITS,
  REFUND_MODES,
  REMINDER_LEAD_PRESETS_MINUTES,
  SESSION_REMINDER_LEAD_PRESETS,
  parseParticipantSettings,
  type ParticipantSettingsValues,
} from "@/lib/events/participantSettings";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function migrationBySuffix(suffix: string): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(suffix));
  expect(files, `migracja *${suffix}`).toHaveLength(1);
  return readFileSync(join(MIGRATIONS_DIR, files[0]), "utf8");
}

const SQL = migrationBySuffix("_event_participant_foundation.sql");
const TABLE = SQL.slice(
  SQL.indexOf("CREATE TABLE IF NOT EXISTS public.event_participant_settings ("),
  SQL.indexOf("DROP TRIGGER IF EXISTS event_participant_settings_touch_updated_at"),
);

function snake(key: string): string {
  return key.replace(/[A-Z]/g, (chr) => `_${chr.toLowerCase()}`);
}

/** Kolumna -> literał DEFAULT (albo `null`, gdy kolumna nie ma DEFAULT). */
function columnDefaults(): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const re =
    /^\s{2}([a-z_]+) (?:boolean|integer\[\]|integer|text|numeric\(5,2\)|uuid|timestamptz)(?=[\s,])(.*?),?$/gm;
  for (const match of TABLE.matchAll(re)) {
    const def = /DEFAULT ('[^']*'|[^,\s]+)/.exec(match[2]);
    out.set(match[1], def === null ? null : def[1].trim());
  }
  return out;
}

function sqlLiteral(
  value: ParticipantSettingsValues[keyof ParticipantSettingsValues],
): string | null {
  if (value === null) return null;
  if (Array.isArray(value)) return `'{${value.join(",")}}'`;
  if (typeof value === "string") return `'${value}'`;
  return String(value);
}

function num(re: RegExp): number {
  const match = re.exec(TABLE);
  expect(match, `CHECK ${re.source}`).not.toBeNull();
  return Number(match?.[1]);
}

function enumValues(constraint: string): string[] {
  const re = new RegExp(`CONSTRAINT ${constraint}\\s+CHECK \\([a-z_]+ IN \\(([^)]*)\\)\\)`);
  const match = re.exec(TABLE);
  expect(match, constraint).not.toBeNull();
  return (match?.[1] ?? "").split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
}

describe("parytet z migracją event_participant_settings", () => {
  const defaults = columnDefaults();

  it("każda kolumna ustawień ma pole w TS, a każde pole TS ma kolumnę", () => {
    const meta = new Set(["id", "tenant_id", "event_id", "created_at", "updated_at", "updated_by"]);
    const columns = [...defaults.keys()].filter((column) => !meta.has(column)).sort();
    const fields = Object.keys(DEFAULT_PARTICIPANT_SETTINGS).map(snake).sort();
    expect(columns.length).toBeGreaterThan(25);
    expect(fields).toEqual(columns);
  });

  it.each(Object.entries(DEFAULT_PARTICIPANT_SETTINGS))(
    "DEFAULT kolumny dla %s zgadza się z TS",
    (key, value) => {
      expect(defaults.get(snake(key))).toBe(sqlLiteral(value));
    },
  );

  it("limity przypomnień i sesji", () => {
    const L = PARTICIPANT_SETTINGS_LIMITS;
    expect(num(/cardinality\(reminder_event_leads_minutes\) <= (\d+)/)).toBe(L.leadsMax);
    expect(num(/(\d+) <= ALL \(reminder_event_leads_minutes\)/)).toBe(L.leadMin);
    expect(num(/(\d+) >= ALL \(reminder_event_leads_minutes\)/)).toBe(L.leadMax);
    expect(num(/session_reminder_lead_minutes BETWEEN (\d+) AND/)).toBe(L.sessionLeadMin);
    expect(num(/session_reminder_lead_minutes BETWEEN \d+ AND (\d+)/)).toBe(L.sessionLeadMax);
  });

  it("limity przekazania, zwrotu i ofert", () => {
    const L = PARTICIPANT_SETTINGS_LIMITS;
    expect(num(/transfer_deadline_hours BETWEEN 0 AND (\d+)/)).toBe(L.transferDeadlineMax);
    expect(num(/refund_deadline_hours BETWEEN 0 AND (\d+)/)).toBe(L.refundDeadlineMax);
    expect(num(/waitlist_offer_hours BETWEEN (\d+) AND/)).toBe(L.offerHoursMin);
    expect(num(/waitlist_offer_hours BETWEEN \d+ AND (\d+)/)).toBe(L.offerHoursMax);
  });

  it("limity certyfikatu i ankiety", () => {
    const L = PARTICIPANT_SETTINGS_LIMITS;
    expect(num(/certificate_min_sessions BETWEEN 1 AND (\d+)/)).toBe(L.certMinSessionsMax);
    expect(num(/certificate_hours <= (\d+)/)).toBe(L.certHoursMax);
    expect(num(/char_length\(certificate_issuer_name\) <= (\d+)/)).toBe(L.issuerMax);
    for (const column of [
      "certificate_signatory_name",
      "certificate_signatory_title_pl",
      "certificate_signatory_title_en",
    ]) {
      expect(num(new RegExp(`char_length\\(${column}\\) <= (\\d+)`))).toBe(L.signatoryMax);
    }
    expect(num(/char_length\(certificate_body_pl\) <= (\d+)/)).toBe(L.bodyMax);
    expect(num(/char_length\(certificate_body_en\) <= (\d+)/)).toBe(L.bodyMax);
    expect(num(/char_length\(survey_intro_pl\) <= (\d+)/)).toBe(L.introMax);
    expect(num(/char_length\(survey_intro_en\) <= (\d+)/)).toBe(L.introMax);
    expect(num(/survey_close_after_days BETWEEN (\d+) AND/)).toBe(L.surveyCloseMin);
    expect(num(/survey_close_after_days BETWEEN \d+ AND (\d+)/)).toBe(L.surveyCloseMax);
    expect(num(/survey_min_results BETWEEN (\d+) AND/)).toBe(L.surveyKMin);
    expect(num(/survey_min_results BETWEEN \d+ AND (\d+)/)).toBe(L.surveyKMax);
  });

  it("wyliczenia = nazwane CHECK-i *_values", () => {
    expect(enumValues("event_participant_settings_refund_mode_values")).toEqual([...REFUND_MODES]);
    expect(enumValues("event_participant_settings_certificate_eligibility_values")).toEqual([
      ...CERTIFICATE_ELIGIBILITY_MODES,
    ]);
  });

  it("gotowe wyprzedzenia mieszczą się w limitach bazy", () => {
    const L = PARTICIPANT_SETTINGS_LIMITS;
    for (const lead of REMINDER_LEAD_PRESETS_MINUTES) {
      expect(lead).toBeGreaterThanOrEqual(L.leadMin);
      expect(lead).toBeLessThanOrEqual(L.leadMax);
    }
    for (const lead of SESSION_REMINDER_LEAD_PRESETS) {
      expect(lead).toBeGreaterThanOrEqual(L.sessionLeadMin);
      expect(lead).toBeLessThanOrEqual(L.sessionLeadMax);
    }
    // Wartości domyślne też muszą być wśród gotowych opcji formularza.
    for (const lead of DEFAULT_PARTICIPANT_SETTINGS.reminderEventLeadsMinutes) {
      expect(REMINDER_LEAD_PRESETS_MINUTES).toContain(lead);
    }
    expect(SESSION_REMINDER_LEAD_PRESETS).toContain(
      DEFAULT_PARTICIPANT_SETTINGS.sessionReminderLeadMinutes,
    );
  });
});

const FULL_ROW = {
  id: "s1",
  tenant_id: "t1",
  event_id: "e1",
  has_row: true,
  has_session_checkpoints: true,
  updated_at: "2030-01-01T00:00:00Z",
  calendar_export_enabled: false,
  reminders_enabled: false,
  reminder_event_leads_minutes: [4320, 60, 15],
  session_reminders_enabled: false,
  session_reminder_lead_minutes: 30,
  reminder_sms_enabled: true,
  transfer_enabled: false,
  transfer_deadline_hours: 48,
  refund_mode: "none",
  refund_deadline_hours: 72,
  waitlist_offer_hours: 12,
  certificate_enabled: true,
  certificate_eligibility: "sessions_min",
  certificate_min_sessions: 3,
  certificate_require_survey: true,
  certificate_hours: 7.5,
  certificate_issuer_name: "Fundacja",
  certificate_signatory_name: "Ala Nowak",
  certificate_signatory_title_pl: "Prezeska",
  certificate_signatory_title_en: "President",
  certificate_body_pl: "Treść",
  certificate_body_en: "Body",
  survey_enabled: true,
  survey_anonymous: false,
  survey_close_after_days: 30,
  survey_min_results: 10,
  survey_invite_enabled: false,
  survey_intro_pl: "Wstęp",
  survey_intro_en: "Intro",
};

describe("parseParticipantSettings", () => {
  it("mapuje pełny wiersz na camelCase", () => {
    expect(parseParticipantSettings(FULL_ROW)).toEqual({
      eventId: "e1",
      hasRow: true,
      hasSessionCheckpoints: true,
      updatedAt: "2030-01-01T00:00:00Z",
      calendarExportEnabled: false,
      remindersEnabled: false,
      reminderEventLeadsMinutes: [4320, 60, 15],
      sessionRemindersEnabled: false,
      sessionReminderLeadMinutes: 30,
      reminderSmsEnabled: true,
      transferEnabled: false,
      transferDeadlineHours: 48,
      refundMode: "none",
      refundDeadlineHours: 72,
      waitlistOfferHours: 12,
      certificateEnabled: true,
      certificateEligibility: "sessions_min",
      certificateMinSessions: 3,
      certificateRequireSurvey: true,
      certificateHours: 7.5,
      certificateIssuerName: "Fundacja",
      certificateSignatoryName: "Ala Nowak",
      certificateSignatoryTitlePl: "Prezeska",
      certificateSignatoryTitleEn: "President",
      certificateBodyPl: "Treść",
      certificateBodyEn: "Body",
      surveyEnabled: true,
      surveyAnonymous: false,
      surveyCloseAfterDays: 30,
      surveyMinResults: 10,
      surveyInviteEnabled: false,
      surveyIntroPl: "Wstęp",
      surveyIntroEn: "Intro",
    });
  });

  it("wartość złego typu wraca do DEFAULT-u kolumny, nie do NaN", () => {
    const parsed = parseParticipantSettings({
      event_id: "e1",
      has_row: "yes",
      reminders_enabled: "false",
      reminder_event_leads_minutes: "1440,60",
      session_reminder_lead_minutes: 12.5,
      transfer_deadline_hours: "24",
      refund_mode: "partial",
      certificate_eligibility: 7,
      certificate_min_sessions: 2.5,
      certificate_hours: Number.POSITIVE_INFINITY,
      certificate_issuer_name: "   ",
      survey_intro_pl: 5,
    });
    expect(parsed).toMatchObject({
      eventId: "e1",
      hasRow: false,
      hasSessionCheckpoints: false,
      updatedAt: null,
      remindersEnabled: DEFAULT_PARTICIPANT_SETTINGS.remindersEnabled,
      reminderEventLeadsMinutes: [1440, 60],
      sessionReminderLeadMinutes: 15,
      transferDeadlineHours: 24,
      refundMode: "policy",
      certificateEligibility: "attended",
      certificateMinSessions: null,
      certificateHours: null,
      certificateIssuerName: null,
      surveyIntroPl: null,
    });
  });

  it("odrzuca z tablicy wyprzedzeń wszystko, co nie jest liczbą całkowitą", () => {
    const parsed = parseParticipantSettings({
      event_id: "e1",
      reminder_event_leads_minutes: [60, "15", null, 30.5, 1440],
    });
    expect(parsed?.reminderEventLeadsMinutes).toEqual([60, 1440]);
  });

  it("wartości domyślne nie są współdzielone między wynikami", () => {
    const a = parseParticipantSettings({ event_id: "e1" });
    a?.reminderEventLeadsMinutes.push(15);
    expect(parseParticipantSettings({ event_id: "e2" })?.reminderEventLeadsMinutes).toEqual([
      1440, 60,
    ]);
    expect(DEFAULT_PARTICIPANT_SETTINGS.reminderEventLeadsMinutes).toEqual([1440, 60]);
  });

  it.each([null, undefined, "x", 5, [], [FULL_ROW]])("zwraca null dla %j", (raw) => {
    expect(parseParticipantSettings(raw)).toBeNull();
  });

  it("zwraca null bez event_id (także pustego)", () => {
    expect(parseParticipantSettings({ ...FULL_ROW, event_id: undefined })).toBeNull();
    expect(parseParticipantSettings({ ...FULL_ROW, event_id: " " })).toBeNull();
  });
});
