// Szkic okna „Pytanie formularza zgłoszenia" (studio: Nabór prelegentów ->
// Formularz zgłoszenia).
//
// OSOBNY OD `registrationFieldDraft`. Pytania naboru nie mają kwalifikacji
// (auto-akceptacja, odrzucenie) ani zgód, a mają typ `url` - wspólny szkic
// niósłby pola, których ten ekran nie pokazuje i których baza nie przyjmie.
//
// KLUCZ JEST NIEZMIENNY PO ZAPISIE (`key_immutable` w SQL-u): odpowiedzi leżą
// w `answers` po kluczu, więc zmiana klucza osieroca wszystkie odpowiedzi.
// Szkic nowego pytania podpowiada klucz z etykiety, dopóki organizator go nie
// zmieni ręcznie.
import {
  asOneOf,
  CFP_CHOICE_FIELD_TYPES,
  CFP_FIELD_TYPES,
  type CfpFieldType,
} from "@/lib/events/cfpEnums";
import type { CfpFieldInput, CfpFieldRow } from "@/lib/events/cfpApi";
import { CFP_KEY_PATTERN, suggestCfpKey } from "@/lib/events/cfpSettingsDraft";
import { parseCfpOptions } from "@/lib/events/cfpSurface";

export const CFP_OPTION_VALUE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,48}$/;
export const CFP_MAX_OPTIONS = 50;

export interface CfpOptionDraft {
  value: string;
  labelPl: string;
  labelEn: string;
}

export interface CfpFieldDraft {
  id: string | null;
  key: string;
  /** `true`, gdy organizator sam zmienił klucz - wtedy przestajemy go podpowiadać. */
  keyTouched: boolean;
  fieldType: CfpFieldType;
  labelPl: string;
  labelEn: string;
  helpPl: string;
  helpEn: string;
  isRequired: boolean;
  isActive: boolean;
  options: CfpOptionDraft[];
}

export type CfpFieldDraftField = "key" | "labels" | "help" | "options";

export interface CfpFieldIssue {
  field: CfpFieldDraftField;
  messageKey: string;
}

export function emptyCfpFieldDraft(): CfpFieldDraft {
  return {
    id: null,
    key: "",
    keyTouched: false,
    fieldType: "text",
    labelPl: "",
    labelEn: "",
    helpPl: "",
    helpEn: "",
    isRequired: false,
    isActive: true,
    options: [],
  };
}

export function cfpFieldDraftFromRow(row: CfpFieldRow): CfpFieldDraft {
  return {
    id: row.id,
    key: row.key,
    keyTouched: true,
    fieldType: asOneOf(CFP_FIELD_TYPES, row.field_type, "text"),
    labelPl: row.label_pl,
    labelEn: row.label_en,
    helpPl: row.help_pl,
    helpEn: row.help_en,
    isRequired: row.is_required,
    isActive: row.is_active,
    options: parseCfpOptions(row.options),
  };
}

/** Zmiana etykiety PL w NOWYM pytaniu podpowiada klucz (póki nie ruszony ręcznie). */
export function withLabelPl(draft: CfpFieldDraft, labelPl: string): CfpFieldDraft {
  const next = { ...draft, labelPl };
  return draft.id === null && !draft.keyTouched ? { ...next, key: suggestCfpKey(labelPl) } : next;
}

export function isChoiceType(fieldType: CfpFieldType): boolean {
  return CFP_CHOICE_FIELD_TYPES.includes(fieldType);
}

export function validateCfpFieldDraft(draft: CfpFieldDraft): CfpFieldIssue[] {
  const issues: CfpFieldIssue[] = [];
  if (draft.id === null && !CFP_KEY_PATTERN.test(draft.key.trim())) {
    issues.push({ field: "key", messageKey: "adminEventCfp.form.validation.key" });
  }
  const pl = draft.labelPl.trim();
  const en = draft.labelEn.trim();
  if (pl.length < 1 || pl.length > 200 || en.length < 1 || en.length > 200) {
    issues.push({ field: "labels", messageKey: "adminEventCfp.form.validation.labels" });
  }
  if (draft.helpPl.trim().length > 500 || draft.helpEn.trim().length > 500) {
    issues.push({ field: "help", messageKey: "adminEventCfp.form.validation.help" });
  }
  if (isChoiceType(draft.fieldType)) {
    const values = draft.options.map((option) => option.value.trim());
    const ok =
      draft.options.length >= 1 &&
      draft.options.length <= CFP_MAX_OPTIONS &&
      new Set(values).size === values.length &&
      draft.options.every(
        (option) =>
          CFP_OPTION_VALUE_PATTERN.test(option.value.trim()) &&
          option.labelPl.trim().length >= 1 &&
          option.labelPl.trim().length <= 120 &&
          option.labelEn.trim().length >= 1 &&
          option.labelEn.trim().length <= 120,
      );
    if (!ok) issues.push({ field: "options", messageKey: "adminEventCfp.form.validation.options" });
  }
  return issues;
}

export function cfpFieldDraftToInput(eventId: string, draft: CfpFieldDraft): CfpFieldInput {
  return {
    id: draft.id ?? undefined,
    eventId: draft.id === null ? eventId : undefined,
    key: draft.id === null ? draft.key.trim() : undefined,
    fieldType: draft.fieldType,
    labelPl: draft.labelPl.trim(),
    labelEn: draft.labelEn.trim(),
    helpPl: draft.helpPl.trim(),
    helpEn: draft.helpEn.trim(),
    isRequired: draft.isRequired,
    isActive: draft.isActive,
    options: isChoiceType(draft.fieldType)
      ? draft.options.map((option) => ({
          value: option.value.trim(),
          label_pl: option.labelPl.trim(),
          label_en: option.labelEn.trim(),
        }))
      : [],
  };
}

/** Nowa opcja: wartość podpowiedziana z kolejnego numeru, etykiety puste. */
export function emptyOptionDraft(index: number): CfpOptionDraft {
  return { value: `opcja_${index + 1}`, labelPl: "", labelEn: "" };
}

/** Zamiana miejscami sąsiednich elementów listy (przesuwanie w górę/dół). */
export function moveItem<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
