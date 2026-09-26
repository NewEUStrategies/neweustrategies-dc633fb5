// Szkic ustawień uczestnika: walidacja każdego ekranu, „brudność" i ładunek.
//
// STAWKA. RPC zapisu ma regułę „brak klucza = bez zmian". Ekran, który wyśle
// choć jeden klucz spoza SWOJEJ listy, nadpisze po cichu pole edytowane na
// innym ekranie (np. zapis przypomnień zerujący treść certyfikatu). Dlatego
// każdy ekran ma tu przypięty DOKŁADNY zbiór kluczy ładunku. Walidacja ma
// odrzucać to samo, co baza (te same granice co `invalid_*` w SQL), żeby
// organizator dostał komunikat przy polu, a nie ogólny błąd zapisu.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PARTICIPANT_SETTINGS,
  REFUND_MODES,
  REMINDER_LEAD_PRESETS_MINUTES,
} from "@/lib/events/participantSettings";
import {
  LEAD_PRESET_LABEL_KEYS,
  PARTICIPANT_SETTINGS_ERROR_KEYS,
  REFUND_MODE_HINT_KEYS,
  REFUND_MODE_LABEL_KEYS,
  SCREEN_FIELDS,
  participantSettingsDirty,
  participantSettingsDraftFromSettings,
  participantSettingsPayload,
  reminderLeadOptions,
  sessionLeadOptions,
  validateParticipantSettings,
  type ParticipantSettingsDraft,
  type ParticipantSettingsScreen,
} from "@/lib/events/participantSettingsDraft";
import { makeParticipantSettings } from "@/test/events/participantFixtures";

const EVENT = "e1111111-1111-4111-8111-111111111111";

function draft(overrides: Partial<ParticipantSettingsDraft> = {}): ParticipantSettingsDraft {
  return { ...participantSettingsDraftFromSettings(DEFAULT_PARTICIPANT_SETTINGS), ...overrides };
}

function keysOf(
  screen: ParticipantSettingsScreen,
  overrides: Partial<ParticipantSettingsDraft> = {},
): string[] {
  return validateParticipantSettings(draft(overrides), screen).map((i) => i.messageKey);
}

describe("participantSettingsDraftFromSettings", () => {
  it("liczby jako napisy, null jako pusty napis, kopia tablicy wyprzedzeń", () => {
    const settings = makeParticipantSettings({
      certificateMinSessions: 3,
      certificateHours: 7.5,
      certificateIssuerName: "Fundacja",
      surveyIntroEn: "Intro",
    });
    const d = participantSettingsDraftFromSettings(settings);
    expect(d.sessionReminderLeadMinutes).toBe("15");
    expect(d.transferDeadlineHours).toBe("24");
    expect(d.refundDeadlineHours).toBe("168");
    expect(d.waitlistOfferHours).toBe("24");
    expect(d.surveyCloseAfterDays).toBe("14");
    expect(d.surveyMinResults).toBe("5");
    expect(d.certificateMinSessions).toBe("3");
    expect(d.certificateHours).toBe("7.5");
    expect(d.certificateIssuerName).toBe("Fundacja");
    expect(d.surveyIntroEn).toBe("Intro");
    expect(d.certificateBodyPl).toBe("");
    d.reminderEventLeadsMinutes.push(15);
    expect(settings.reminderEventLeadsMinutes).toEqual([1440, 60]);
  });

  it("brak liczby (null) daje pusty napis", () => {
    const d = participantSettingsDraftFromSettings(DEFAULT_PARTICIPANT_SETTINGS);
    expect(d.certificateMinSessions).toBe("");
    expect(d.certificateHours).toBe("");
  });
});

describe("validateParticipantSettings - wartości domyślne przechodzą na każdym ekranie", () => {
  it.each(["communications", "policies", "certificate", "survey"] as const)("%s", (screen) => {
    expect(validateParticipantSettings(draft(), screen)).toEqual([]);
  });
});

describe("validateParticipantSettings - komunikacja", () => {
  it("najwyżej 4 wyprzedzenia", () => {
    expect(
      keysOf("communications", { reminderEventLeadsMinutes: [10080, 4320, 1440, 60] }),
    ).toEqual([]);
    expect(
      keysOf("communications", { reminderEventLeadsMinutes: [10080, 4320, 1440, 60, 15] }),
    ).toEqual(["adminEventParticipant.errors.reminderLeads"]);
  });

  it("zero wyprzedzeń wolno (przypomnienia o wydarzeniu wyłączone listą)", () => {
    expect(keysOf("communications", { reminderEventLeadsMinutes: [] })).toEqual([]);
  });

  it.each([[[60, 60]], [[14]], [[10081]], [[60.5]]])("odrzuca wyprzedzenia %j", (leads) => {
    expect(keysOf("communications", { reminderEventLeadsMinutes: leads })).toEqual([
      "adminEventParticipant.errors.reminderLeads",
    ]);
  });

  it.each(["4", "241", "", "abc", "15.5"])("odrzuca wyprzedzenie sesji %j", (value) => {
    expect(keysOf("communications", { sessionReminderLeadMinutes: value })).toEqual([
      "adminEventParticipant.errors.sessionLead",
    ]);
  });

  it.each(["5", "240", " 30 "])("przyjmuje wyprzedzenie sesji %j", (value) => {
    expect(keysOf("communications", { sessionReminderLeadMinutes: value })).toEqual([]);
  });

  it("pola innych ekranów nie są sprawdzane", () => {
    expect(keysOf("communications", { transferDeadlineHours: "x", surveyMinResults: "1" })).toEqual(
      [],
    );
  });
});

describe("validateParticipantSettings - zasady rejestracji", () => {
  it.each([
    ["transferDeadlineHours", "-1", "adminEventParticipant.errors.transferDeadline"],
    ["transferDeadlineHours", "721", "adminEventParticipant.errors.transferDeadline"],
    ["refundDeadlineHours", "2161", "adminEventParticipant.errors.refundDeadline"],
    ["refundDeadlineHours", "", "adminEventParticipant.errors.refundDeadline"],
    ["waitlistOfferHours", "1", "adminEventParticipant.errors.offerHours"],
    ["waitlistOfferHours", "169", "adminEventParticipant.errors.offerHours"],
  ] as const)("%s=%j -> %s", (field, value, key) => {
    expect(keysOf("policies", { [field]: value })).toEqual([key]);
  });

  it("granice włącznie", () => {
    expect(
      keysOf("policies", {
        transferDeadlineHours: "0",
        refundDeadlineHours: "2160",
        waitlistOfferHours: "2",
      }),
    ).toEqual([]);
    expect(
      keysOf("policies", {
        transferDeadlineHours: "720",
        refundDeadlineHours: "0",
        waitlistOfferHours: "168",
      }),
    ).toEqual([]);
  });

  it("zwraca wszystkie błędy naraz", () => {
    expect(
      validateParticipantSettings(
        draft({ transferDeadlineHours: "x", refundDeadlineHours: "x", waitlistOfferHours: "x" }),
        "policies",
      ).map((issue) => issue.field),
    ).toEqual(["transferDeadlineHours", "refundDeadlineHours", "waitlistOfferHours"]);
  });
});

describe("validateParticipantSettings - certyfikat", () => {
  it("sessions_min wymaga liczby sesji (pusta = błąd)", () => {
    expect(keysOf("certificate", { certificateEligibility: "sessions_min" })).toEqual([
      "adminEventParticipant.errors.certificateMinSessions",
    ]);
    expect(
      keysOf("certificate", {
        certificateEligibility: "sessions_min",
        certificateMinSessions: "3",
      }),
    ).toEqual([]);
  });

  it.each(["0", "101", "2.5", "x"])("odrzuca liczbę sesji %j", (value) => {
    expect(keysOf("certificate", { certificateMinSessions: value })).toEqual([
      "adminEventParticipant.errors.certificateMinSessions",
    ]);
  });

  it("pusta liczba sesji przy innym trybie jest dozwolona", () => {
    expect(keysOf("certificate", { certificateEligibility: "confirmed" })).toEqual([]);
  });

  it.each(["0", "0.001", "999.999", "1000", "-1", "x", "1,2,3"])(
    "odrzuca godziny %j (zaokrąglenie do setnych jak w SQL)",
    (value) => {
      expect(keysOf("certificate", { certificateHours: value })).toEqual([
        "adminEventParticipant.errors.certificateHours",
      ]);
    },
  );

  it.each(["", "0.01", "7,5", "999", "999.004", "0.005"])("przyjmuje godziny %j", (value) => {
    expect(keysOf("certificate", { certificateHours: value })).toEqual([]);
  });

  // `round(x::numeric, 2)` liczy na liczbie dziesiętnej: 1.005 -> 1.01, 0.015 -> 0.02.
  // Binarne `Number(x) * 100` dawało tu 1.00 i 0.01 (`100.4999…`, `1.4999…`).
  it.each([
    ["1.005", 1.01],
    ["0,015", 0.02],
    ["2.675", 2.68],
    ["7.554", 7.55],
    ["7.5", 7.5],
    ["12", 12],
    ["0.0049", 0],
    ["999.995", 1000],
  ])("godziny %j -> %s (połowa w górę na napisie, jak numeric w SQL)", (value, want) => {
    const payload = participantSettingsPayload(
      EVENT,
      draft({ certificateHours: value }),
      "certificate",
    );
    expect(payload.certificate_hours).toBe(want);
  });

  it.each([
    ["certificateIssuerName", 160],
    ["certificateSignatoryName", 120],
    ["certificateSignatoryTitlePl", 120],
    ["certificateSignatoryTitleEn", 120],
    ["certificateBodyPl", 600],
    ["certificateBodyEn", 600],
  ] as const)("limit długości %s = %i znaków (po przycięciu, punkty kodowe)", (field, max) => {
    expect(keysOf("certificate", { [field]: `  ${"ż".repeat(max)}  ` })).toEqual([]);
    expect(
      validateParticipantSettings(draft({ [field]: "ż".repeat(max + 1) }), "certificate"),
    ).toEqual([{ field, messageKey: "adminEventParticipant.errors.textLength" }]);
  });

  it("emoji liczy się jako jeden znak (jak char_length)", () => {
    expect(keysOf("certificate", { certificateIssuerName: "😀".repeat(160) })).toEqual([]);
  });
});

describe("validateParticipantSettings - ankieta", () => {
  it.each([
    ["surveyCloseAfterDays", "0", "adminEventParticipant.errors.surveyCloseDays"],
    ["surveyCloseAfterDays", "91", "adminEventParticipant.errors.surveyCloseDays"],
    ["surveyMinResults", "4", "adminEventParticipant.errors.surveyMinResults"],
    ["surveyMinResults", "51", "adminEventParticipant.errors.surveyMinResults"],
  ] as const)("%s=%j -> %s", (field, value, key) => {
    expect(keysOf("survey", { [field]: value })).toEqual([key]);
  });

  it("limit wstępu ankiety 600 znaków, pola certyfikatu poza ekranem", () => {
    expect(keysOf("survey", { surveyIntroEn: "x".repeat(601) })).toEqual([
      "adminEventParticipant.errors.textLength",
    ]);
    expect(keysOf("survey", { surveyIntroPl: "x".repeat(601) })).toEqual([
      "adminEventParticipant.errors.textLength",
    ]);
    expect(keysOf("survey", { certificateBodyPl: "x".repeat(601) })).toEqual([]);
  });
});

describe("participantSettingsDirty", () => {
  it("tylko pola danego ekranu", () => {
    const a = draft();
    expect(participantSettingsDirty(a, draft({ transferEnabled: false }), "communications")).toBe(
      false,
    );
    expect(participantSettingsDirty(a, draft({ transferEnabled: false }), "policies")).toBe(true);
    expect(participantSettingsDirty(a, draft(), "certificate")).toBe(false);
    expect(participantSettingsDirty(a, draft({ surveyIntroPl: "x" }), "survey")).toBe(true);
  });

  it("kolejność i duplikaty wyprzedzeń nie brudzą formularza, zmiana zbioru tak", () => {
    const a = draft({ reminderEventLeadsMinutes: [60, 1440] });
    expect(
      participantSettingsDirty(
        a,
        draft({ reminderEventLeadsMinutes: [1440, 60, 60] }),
        "communications",
      ),
    ).toBe(false);
    expect(
      participantSettingsDirty(a, draft({ reminderEventLeadsMinutes: [1440] }), "communications"),
    ).toBe(true);
  });
});

describe("participantSettingsPayload", () => {
  it.each(["communications", "policies", "certificate", "survey"] as const)(
    "%s wysyła WYŁĄCZNIE swoje klucze + event_id",
    (screen) => {
      const payload = participantSettingsPayload(EVENT, draft(), screen);
      const expected = [
        "event_id",
        ...SCREEN_FIELDS[screen].map((f) => f.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)),
      ];
      expect(Object.keys(payload).sort()).toEqual(expected.sort());
      expect(payload.event_id).toBe(EVENT);
    },
  );

  it("ekrany są rozłączne i razem pokrywają każde pole szkicu", () => {
    const all = Object.values(SCREEN_FIELDS).flat();
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(Object.keys(draft()).sort());
  });

  it("komunikacja: wyprzedzenia bez duplikatów malejąco, liczby jako liczby", () => {
    expect(
      participantSettingsPayload(
        EVENT,
        draft({
          reminderEventLeadsMinutes: [60, 1440, 60],
          sessionReminderLeadMinutes: " 30 ",
          reminderSmsEnabled: true,
        }),
        "communications",
      ),
    ).toEqual({
      event_id: EVENT,
      reminders_enabled: true,
      reminder_event_leads_minutes: [1440, 60],
      session_reminders_enabled: true,
      session_reminder_lead_minutes: 30,
      reminder_sms_enabled: true,
      calendar_export_enabled: true,
    });
  });

  it("zasady: tryb zwrotu jako napis, godziny jako liczby", () => {
    expect(
      participantSettingsPayload(
        EVENT,
        draft({ refundMode: "none", transferDeadlineHours: "48" }),
        "policies",
      ),
    ).toEqual({
      event_id: EVENT,
      transfer_enabled: true,
      transfer_deadline_hours: 48,
      refund_mode: "none",
      refund_deadline_hours: 168,
      waitlist_offer_hours: 24,
    });
  });

  it("certyfikat: puste pola = null, godziny z przecinkiem, tekst przycięty", () => {
    expect(
      participantSettingsPayload(
        EVENT,
        draft({
          certificateEnabled: true,
          certificateEligibility: "sessions_min",
          certificateMinSessions: "3",
          certificateHours: "7,555",
          certificateIssuerName: "  Fundacja  ",
          certificateBodyPl: "   ",
        }),
        "certificate",
      ),
    ).toEqual({
      event_id: EVENT,
      certificate_enabled: true,
      certificate_eligibility: "sessions_min",
      certificate_min_sessions: 3,
      certificate_require_survey: false,
      certificate_hours: 7.56,
      certificate_issuer_name: "Fundacja",
      certificate_signatory_name: null,
      certificate_signatory_title_pl: null,
      certificate_signatory_title_en: null,
      certificate_body_pl: null,
      certificate_body_en: null,
    });
    const blank = participantSettingsPayload(EVENT, draft(), "certificate");
    expect(blank.certificate_min_sessions).toBeNull();
    expect(blank.certificate_hours).toBeNull();
  });

  it("ankieta", () => {
    expect(
      participantSettingsPayload(
        EVENT,
        draft({ surveyAnonymous: false, surveyIntroEn: "Intro", surveyCloseAfterDays: "30" }),
        "survey",
      ),
    ).toEqual({
      event_id: EVENT,
      survey_enabled: false,
      survey_anonymous: false,
      survey_close_after_days: 30,
      survey_min_results: 5,
      survey_invite_enabled: true,
      survey_intro_pl: null,
      survey_intro_en: "Intro",
    });
  });
});

describe("klucze komunikatów i etykiet", () => {
  it("każdy gotowy preset ma pełny, literalny klucz etykiety", () => {
    expect(
      Object.keys(LEAD_PRESET_LABEL_KEYS)
        .map(Number)
        .sort((a, b) => b - a),
    ).toEqual([...REMINDER_LEAD_PRESETS_MINUTES]);
    for (const preset of REMINDER_LEAD_PRESETS_MINUTES) {
      expect(LEAD_PRESET_LABEL_KEYS[preset]).toBe(
        `adminEventParticipant.communications.leads.p${preset}`,
      );
    }
  });

  it("każdy klucz komunikatu jest pod prefiksem nakładki i jest unikalny", () => {
    expect(new Set(PARTICIPANT_SETTINGS_ERROR_KEYS).size).toBe(
      PARTICIPANT_SETTINGS_ERROR_KEYS.length,
    );
    for (const key of PARTICIPANT_SETTINGS_ERROR_KEYS) {
      expect(key).toMatch(/^adminEventParticipant\.errors\.[a-z][A-Za-z]+$/);
    }
  });
});

// ── Opcje wyprzedzeń i etykiety trybu zwrotu (ekrany F-c) ───────────────────
// Lista rozwijana i grupa pól wyboru nigdy nie gubią wartości zapisanej spoza
// gotowych; mapy trybu zwrotu mają pełne literały kluczy.

describe("reminderLeadOptions", () => {
  it("to osiem gotowych wyprzedzeń, malejąco", () => {
    expect(reminderLeadOptions([])).toEqual([10080, 4320, 1440, 720, 180, 60, 30, 15]);
  });

  it("dokłada wartości spoza listy i nie dubluje gotowych ani powtórzeń", () => {
    expect(reminderLeadOptions([1440, 90, 90])).toEqual([
      10080, 4320, 1440, 720, 180, 90, 60, 30, 15,
    ]);
  });
});

describe("sessionLeadOptions", () => {
  it("to gotowe wyprzedzenia sesji rosnąco, gdy bieżąca wartość jest gotowa", () => {
    expect(sessionLeadOptions("15")).toEqual(["5", "10", "15", "30", "60"]);
  });

  it("zapisana wartość spoza listy dostaje własną opcję na właściwym miejscu", () => {
    expect(sessionLeadOptions("20")).toEqual(["5", "10", "15", "20", "30", "60"]);
    expect(sessionLeadOptions("240")).toEqual(["5", "10", "15", "30", "60", "240"]);
  });
});

describe("REFUND_MODE_LABEL_KEYS / REFUND_MODE_HINT_KEYS", () => {
  it("każdy tryb zwrotu ma pełny literał etykiety i podpowiedzi", () => {
    for (const mode of REFUND_MODES) {
      expect(REFUND_MODE_LABEL_KEYS[mode]).toBe(
        `adminEventParticipant.policies.refund.modes.${mode}`,
      );
      expect(REFUND_MODE_HINT_KEYS[mode]).toBe(
        `adminEventParticipant.policies.refund.modes.${mode}Hint`,
      );
    }
  });
});
