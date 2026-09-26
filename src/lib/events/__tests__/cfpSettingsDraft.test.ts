// Szkice panelu naboru: ustawienia i pytanie formularza.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - pilnowane niżej:
// Reguły są lustrem odmów bazy (`invalid_window`, `invalid_formats`,
// `invalid_criteria`, `key_immutable`...). Każda gałąź walidacji ma tu przypadek,
// bo zdanie przy polu jest jedyną informacją, jaką organizator dostaje PRZED
// zapisem - brakująca gałąź oznacza toast z bazy zamiast wskazania pola.
import { describe, expect, it } from "vitest";

import {
  CFP_KEY_PATTERN,
  cfpSettingsDirty,
  cfpSettingsDraftFromSettings,
  cfpSettingsPayload,
  emptyCriterionDraft,
  emptyFormatDraft,
  parseWholeNumber,
  suggestCfpKey,
  toggleId,
  validateCfpSettingsDraft,
  type CfpSettingsDraft,
} from "@/lib/events/cfpSettingsDraft";
import {
  CFP_MAX_OPTIONS,
  cfpFieldDraftFromRow,
  cfpFieldDraftToInput,
  emptyCfpFieldDraft,
  emptyOptionDraft,
  isChoiceType,
  moveItem,
  validateCfpFieldDraft,
  withLabelPl,
  type CfpFieldDraft,
} from "@/lib/events/cfpFieldDraft";
import type { CfpFieldRow } from "@/lib/events/cfpApi";
import { parseCfpSettings } from "@/lib/events/cfpSurface";

function settings() {
  return parseCfpSettings({
    status: "open",
    opens_at: "2026-09-01T10:00:00+00:00",
    closes_at: null,
    intro_pl: "Wstęp",
    formats: [{ key: "talk", label_pl: "Wykład", label_en: "Talk", duration_min: 30 }],
    track_ids: ["t1"],
    max_per_submitter: 2,
    allow_co_speakers: true,
    review_blind: false,
    score_max: 5,
    review_criteria: [{ key: "rel", label_pl: "Trafność", label_en: "Relevance", weight: 2 }],
    min_reviews: 2,
    speaker_group_id: "g1",
    speaker_ticket_type_id: null,
  });
}

function validDraft(): CfpSettingsDraft {
  return cfpSettingsDraftFromSettings(settings());
}

const fields = (draft: CfpSettingsDraft) => validateCfpSettingsDraft(draft).map((issue) => issue.field);

describe("cfpSettingsDraftFromSettings / payload", () => {
  it("liczby stają się napisami, a ładunek wraca do liczb i `null` dla pustych dat", () => {
    const draft = validDraft();
    expect(draft).toMatchObject({
      status: "open",
      opensAt: "2026-09-01T10:00:00+00:00",
      closesAt: "",
      maxPerSubmitter: "2",
      scoreMax: "5",
      minReviews: "2",
      formats: [{ key: "talk", durationMin: "30" }],
      criteria: [{ key: "rel", weight: "2" }],
      speakerGroupId: "g1",
    });
    const payload = cfpSettingsPayload("e1", {
      ...draft,
      formats: [{ key: " talk ", labelPl: " Wykład ", labelEn: " Talk ", durationMin: " 45 " }],
      criteria: [{ key: " rel ", labelPl: " T ", labelEn: " R ", weight: " 3 " }],
      opensAt: "",
      closesAt: "2026-10-01T00:00:00.000Z",
    });
    expect(payload).toEqual({
      eventId: "e1",
      status: "open",
      opensAt: null,
      closesAt: "2026-10-01T00:00:00.000Z",
      introPl: "Wstęp",
      introEn: "",
      guidelinesPl: "",
      guidelinesEn: "",
      formats: [{ key: "talk", label_pl: "Wykład", label_en: "Talk", duration_min: 45 }],
      trackIds: ["t1"],
      maxPerSubmitter: 2,
      allowCoSpeakers: true,
      reviewBlind: false,
      scoreMax: 5,
      reviewCriteria: [{ key: "rel", label_pl: "T", label_en: "R", weight: 3 }],
      minReviews: 2,
      speakerGroupId: "g1",
      speakerTicketTypeId: null,
    });
  });

  it("brak dat w bazie = puste pola, puste pola = `null` w ładunku", () => {
    const draft = cfpSettingsDraftFromSettings(parseCfpSettings({ opens_at: null, closes_at: null }));
    expect(draft.opensAt).toBe("");
    expect(draft.closesAt).toBe("");
    const payload = cfpSettingsPayload("e1", draft);
    expect(payload.opensAt).toBeNull();
    expect(payload.closesAt).toBeNull();
    expect(cfpSettingsPayload("e1", { ...draft, opensAt: "2026-09-01T00:00:00Z" }).opensAt).toBe(
      "2026-09-01T00:00:00Z",
    );
  });

  it("brudny szkic = różna treść", () => {
    const draft = validDraft();
    expect(cfpSettingsDirty(draft, validDraft())).toBe(false);
    expect(cfpSettingsDirty({ ...draft, introEn: "x" }, draft)).toBe(true);
  });
});

describe("validateCfpSettingsDraft", () => {
  it("poprawny szkic nie ma uwag", () => {
    expect(validateCfpSettingsDraft(validDraft())).toEqual([]);
  });

  it("okno: termin po otwarciu, porównanie CHWIL w różnych zapisach", () => {
    const draft = validDraft();
    expect(fields({ ...draft, closesAt: "2026-09-01T10:00:00.000Z" })).toEqual(["window"]);
    expect(fields({ ...draft, closesAt: "2026-08-31T10:00:00.000Z" })).toEqual(["window"]);
    expect(fields({ ...draft, closesAt: "2026-09-01T10:00:01.000Z" })).toEqual([]);
    expect(fields({ ...draft, opensAt: "", closesAt: "2026-08-01T00:00:00Z" })).toEqual([]);
  });

  it("teksty dłuższe niż 8000 znaków", () => {
    expect(fields({ ...validDraft(), guidelinesEn: "x".repeat(8001) })).toEqual(["texts"]);
  });

  it("formy: klucz, etykiety, minuty, powtórzenia i limit", () => {
    const base = validDraft();
    const ok = { key: "panel", labelPl: "Panel", labelEn: "Panel", durationMin: "45" };
    expect(fields({ ...base, formats: [ok, { ...ok }] })).toEqual(["formats"]);
    expect(fields({ ...base, formats: [{ ...ok, key: "1x" }] })).toEqual(["formats"]);
    expect(fields({ ...base, formats: [{ ...ok, labelEn: " " }] })).toEqual(["formats"]);
    expect(fields({ ...base, formats: [{ ...ok, labelPl: "x".repeat(81) }] })).toEqual(["formats"]);
    expect(fields({ ...base, formats: [{ ...ok, durationMin: "4" }] })).toEqual(["formats"]);
    expect(fields({ ...base, formats: [{ ...ok, durationMin: "481" }] })).toEqual(["formats"]);
    expect(fields({ ...base, formats: [{ ...ok, durationMin: "3a" }] })).toEqual(["formats"]);
    const many = Array.from({ length: 21 }, (_, i) => ({ ...ok, key: `f${i}x` }));
    expect(fields({ ...base, formats: many })).toEqual(["formats"]);
  });

  it("limity liczbowe", () => {
    const base = validDraft();
    expect(fields({ ...base, maxPerSubmitter: "0" })).toEqual(["maxPerSubmitter"]);
    expect(fields({ ...base, maxPerSubmitter: "21" })).toEqual(["maxPerSubmitter"]);
    expect(fields({ ...base, scoreMax: "2" })).toEqual(["scoreMax"]);
    expect(fields({ ...base, scoreMax: "11" })).toEqual(["scoreMax"]);
    expect(fields({ ...base, minReviews: "" })).toEqual(["minReviews"]);
    expect(fields({ ...base, minReviews: "21" })).toEqual(["minReviews"]);
  });

  it("kryteria: klucz, etykiety, waga, powtórzenia i limit", () => {
    const base = validDraft();
    const ok = { key: "depth", labelPl: "Głębia", labelEn: "Depth", weight: "1" };
    expect(fields({ ...base, criteria: [ok, { ...ok }] })).toEqual(["criteria"]);
    expect(fields({ ...base, criteria: [{ ...ok, weight: "0" }] })).toEqual(["criteria"]);
    expect(fields({ ...base, criteria: [{ ...ok, weight: "11" }] })).toEqual(["criteria"]);
    expect(fields({ ...base, criteria: [{ ...ok, key: "" }] })).toEqual(["criteria"]);
    const many = Array.from({ length: 11 }, (_, i) => ({ ...ok, key: `c${i}x` }));
    expect(fields({ ...base, criteria: many })).toEqual(["criteria"]);
  });

  it("każda uwaga ma dosłowny klucz komunikatu", () => {
    const issues = validateCfpSettingsDraft({
      ...validDraft(),
      closesAt: "2026-01-01T00:00:00Z",
      introPl: "x".repeat(9000),
      formats: [{ key: "", labelPl: "", labelEn: "", durationMin: "" }],
      maxPerSubmitter: "x",
      scoreMax: "x",
      minReviews: "x",
      criteria: [{ key: "", labelPl: "", labelEn: "", weight: "" }],
    });
    expect(issues.map((issue) => issue.messageKey)).toEqual([
      "adminEventCfp.settings.validation.window",
      "adminEventCfp.settings.validation.texts",
      "adminEventCfp.settings.validation.formats",
      "adminEventCfp.settings.validation.maxPerSubmitter",
      "adminEventCfp.settings.validation.scoreMax",
      "adminEventCfp.settings.validation.minReviews",
      "adminEventCfp.settings.validation.criteria",
    ]);
  });
});

describe("pomocnicze", () => {
  it("liczba całkowita z pola tekstowego", () => {
    expect(parseWholeNumber(" 12 ")).toBe(12);
    expect(parseWholeNumber("1.5")).toBeNull();
    expect(parseWholeNumber("")).toBeNull();
    expect(parseWholeNumber("1234567")).toBeNull();
  });

  it("podpowiedź klucza z etykiety PL", () => {
    expect(suggestCfpKey("Wykład główny")).toBe("wyklad_glowny");
    expect(suggestCfpKey("Łódź - panel")).toBe("lodz_panel");
    expect(suggestCfpKey("  42 Sesja!  ")).toBe("sesja");
    expect(suggestCfpKey("x".repeat(60))).toHaveLength(49);
    expect(CFP_KEY_PATTERN.test(suggestCfpKey("Panel dyskusyjny"))).toBe(true);
  });

  it("puste wiersze i przełącznik obecności", () => {
    expect(emptyFormatDraft()).toEqual({ key: "", labelPl: "", labelEn: "", durationMin: "30" });
    expect(emptyCriterionDraft()).toEqual({ key: "", labelPl: "", labelEn: "", weight: "1" });
    expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
  });
});

function row(overrides: Partial<CfpFieldRow> = {}): CfpFieldRow {
  return {
    id: "f1",
    key: "exp",
    field_type: "select",
    label_pl: "Doświadczenie",
    label_en: "Experience",
    help_pl: "",
    help_en: "",
    is_required: true,
    is_active: true,
    options: [{ value: "a", label_pl: "A", label_en: "A" }],
    sort_order: 10,
    answers_count: 0,
    ...overrides,
  };
}

function fieldDraft(overrides: Partial<CfpFieldDraft> = {}): CfpFieldDraft {
  return {
    ...emptyCfpFieldDraft(),
    key: "exp",
    labelPl: "Doświadczenie",
    labelEn: "Experience",
    ...overrides,
  };
}

const fieldIssues = (draft: CfpFieldDraft) => validateCfpFieldDraft(draft).map((issue) => issue.field);

describe("cfpFieldDraft", () => {
  it("szkic z wiersza: klucz zablokowany, nieznany typ -> tekst", () => {
    const draft = cfpFieldDraftFromRow(row());
    expect(draft).toMatchObject({
      id: "f1",
      key: "exp",
      keyTouched: true,
      fieldType: "select",
      options: [{ value: "a", labelPl: "A", labelEn: "A" }],
    });
    expect(cfpFieldDraftFromRow(row({ field_type: "rich" })).fieldType).toBe("text");
  });

  it("etykieta PL podpowiada klucz tylko w NOWYM pytaniu i tylko przed ręczną zmianą", () => {
    expect(withLabelPl(emptyCfpFieldDraft(), "Poziom zaawansowania").key).toBe("poziom_zaawansowania");
    const touched = { ...emptyCfpFieldDraft(), key: "moj", keyTouched: true };
    expect(withLabelPl(touched, "Inne").key).toBe("moj");
    const saved = cfpFieldDraftFromRow(row());
    expect(withLabelPl({ ...saved, keyTouched: false }, "Nowa").key).toBe("exp");
  });

  it("walidacja: klucz nowego pytania, etykiety, podpowiedź i opcje wyboru", () => {
    expect(fieldIssues(fieldDraft())).toEqual([]);
    expect(fieldIssues(fieldDraft({ key: "Zły" }))).toEqual(["key"]);
    // Klucz zapisanego pytania nie jest walidowany - i tak nie wychodzi w ładunku.
    expect(fieldIssues(fieldDraft({ id: "f1", key: "Zły" }))).toEqual([]);
    expect(fieldIssues(fieldDraft({ labelEn: "" }))).toEqual(["labels"]);
    expect(fieldIssues(fieldDraft({ labelPl: "x".repeat(201) }))).toEqual(["labels"]);
    expect(fieldIssues(fieldDraft({ helpPl: "x".repeat(501) }))).toEqual(["help"]);
    const option = { value: "a", labelPl: "A", labelEn: "A" };
    expect(fieldIssues(fieldDraft({ fieldType: "select", options: [option] }))).toEqual([]);
    expect(fieldIssues(fieldDraft({ fieldType: "select", options: [] }))).toEqual(["options"]);
    expect(fieldIssues(fieldDraft({ fieldType: "multiselect", options: [option, option] }))).toEqual([
      "options",
    ]);
    expect(fieldIssues(fieldDraft({ fieldType: "select", options: [{ ...option, value: "A!" }] }))).toEqual([
      "options",
    ]);
    expect(fieldIssues(fieldDraft({ fieldType: "select", options: [{ ...option, labelEn: "" }] }))).toEqual([
      "options",
    ]);
    expect(
      fieldIssues(fieldDraft({ fieldType: "select", options: [{ ...option, labelPl: "x".repeat(121) }] })),
    ).toEqual(["options"]);
    expect(
      fieldIssues(fieldDraft({ fieldType: "select", options: [{ ...option, labelEn: "x".repeat(121) }] })),
    ).toEqual(["options"]);
    expect(fieldIssues(fieldDraft({ fieldType: "select", options: [{ ...option, labelPl: " " }] }))).toEqual([
      "options",
    ]);
    const tooMany = Array.from({ length: CFP_MAX_OPTIONS + 1 }, (_, i) => ({ ...option, value: `o${i}` }));
    expect(fieldIssues(fieldDraft({ fieldType: "select", options: tooMany }))).toEqual(["options"]);
    expect(fieldIssues(fieldDraft({ fieldType: "text", options: [] }))).toEqual([]);
    expect(validateCfpFieldDraft(fieldDraft({ key: "" }))[0]?.messageKey).toBe(
      "adminEventCfp.form.validation.key",
    );
  });

  it("ładunek: nowe pytanie niesie wydarzenie i klucz, zapisane - identyfikator; opcje tylko przy wyborze", () => {
    expect(
      cfpFieldDraftToInput(
        "e1",
        fieldDraft({
          key: " exp ",
          helpPl: " h ",
          fieldType: "select",
          options: [{ value: " a ", labelPl: " A ", labelEn: " A-en " }],
        }),
      ),
    ).toEqual({
      id: undefined,
      eventId: "e1",
      key: "exp",
      fieldType: "select",
      labelPl: "Doświadczenie",
      labelEn: "Experience",
      helpPl: "h",
      helpEn: "",
      isRequired: false,
      isActive: true,
      options: [{ value: "a", label_pl: "A", label_en: "A-en" }],
    });
    const saved = cfpFieldDraftToInput(
      "e1",
      fieldDraft({ id: "f1", fieldType: "textarea", options: [{ value: "a", labelPl: "A", labelEn: "A" }] }),
    );
    expect(saved).toMatchObject({ id: "f1", eventId: undefined, key: undefined, options: [] });
  });

  it("typy wyboru, nowa opcja i przesuwanie", () => {
    expect(isChoiceType("select")).toBe(true);
    expect(isChoiceType("multiselect")).toBe(true);
    expect(isChoiceType("checkbox")).toBe(false);
    expect(emptyOptionDraft(2)).toEqual({ value: "opcja_3", labelPl: "", labelEn: "" });
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});
