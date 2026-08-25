// Wersja robocza POLA FORMULARZA ZAPISU: wiersz bazy <-> formularz <-> payload.
//
// OPCJE SĄ TABELĄ, NIE TEKSTEM. Lista wyboru musi mieć wartość techniczną
// (trafia do odpowiedzi zgłoszenia i nie może się zmieniać) oraz etykietę w dwóch
// językach. Jedna kolumna „opcje po przecinku" wymusiłaby na redaktorze
// tłumaczenie wartości, a wtedy zmiana etykiety zmieniałaby zapisane odpowiedzi.
//
// REGUŁA KWALIFIKACJI JEST NIEPODZIELNA. Baza odrzuca pole kwalifikujące bez
// operatora (`event_registration_fields_qualify_complete`), a lista bez opcji
// jest polem, którego nie da się wypełnić
// (`event_registration_fields_options_required`). Oba warunki mają tu
// odpowiednik, bo odmowa CHECK-a wraca bez nazwy pola.
//
// WARTOŚĆ WARUNKU ZALEŻY OD OPERATORA: `in`/`not_in` porównują z LISTĄ,
// `is_true`/`is_false`/`not_empty` nie porównują z niczym. Wysłanie napisu tam,
// gdzie SQL czyta tablicę, dawałoby regułę, która nigdy się nie spełnia - czyli
// bramkę, która wygląda na działającą i przepuszcza wszystkich.
import type { Json } from "@/integrations/supabase/types";
import type {
  EventRegistrationFieldRow,
  QualifyOperator,
  QualifyOutcome,
  RegistrationFieldInput,
  RegistrationFieldType,
} from "@/lib/events/registrationsApi";

export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{1,48}$/;
export const FIELD_MAX_LABEL = 200;
export const FIELD_MAX_HELP = 500;

/** Typy, które bez wariantów odpowiedzi są nie do wypełnienia. */
export const FIELD_TYPES_WITH_OPTIONS: readonly RegistrationFieldType[] = ["select", "multiselect"];

/** Operatory, które nie porównują z żadną wartością. */
export const OPERATORS_WITHOUT_VALUE: readonly QualifyOperator[] = [
  "is_true",
  "is_false",
  "not_empty",
];

/** Operatory, które porównują z listą wartości. */
export const OPERATORS_WITH_LIST: readonly QualifyOperator[] = ["in", "not_in"];

export interface FieldOptionDraft {
  value: string;
  labelPl: string;
  labelEn: string;
}

export interface RegistrationFieldDraft {
  id: string | null;
  key: string;
  fieldType: RegistrationFieldType;
  labelPl: string;
  labelEn: string;
  helpPl: string;
  helpEn: string;
  isRequired: boolean;
  options: FieldOptionDraft[];
  isQualifying: boolean;
  qualifyOperator: QualifyOperator;
  /** Jedna wartość albo wartości oddzielone nową linią (dla `in`/`not_in`). */
  qualifyValue: string;
  qualifyOutcome: QualifyOutcome;
  isActive: boolean;
  sortOrder: string;
}

export function emptyFieldDraft(sortOrder: number): RegistrationFieldDraft {
  return {
    id: null,
    key: "",
    fieldType: "text",
    labelPl: "",
    labelEn: "",
    helpPl: "",
    helpEn: "",
    isRequired: false,
    options: [],
    isQualifying: false,
    qualifyOperator: "none",
    qualifyValue: "",
    qualifyOutcome: "approval",
    isActive: true,
    sortOrder: String(sortOrder),
  };
}

function optionsFromJson(input: Json): FieldOptionDraft[] {
  if (!Array.isArray(input)) return [];
  const out: FieldOptionDraft[] = [];
  for (const entry of input) {
    // Historyczne wiersze mogą trzymać zwykły napis - czytamy je jako wartość
    // bez tłumaczenia, zamiast gubić opcję i cicho skrócić listę uczestnikowi.
    if (typeof entry === "string") {
      out.push({ value: entry, labelPl: entry, labelEn: entry });
      continue;
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, Json>;
    const value = typeof record.value === "string" ? record.value : "";
    if (value === "") continue;
    out.push({
      value,
      labelPl: typeof record.label_pl === "string" ? record.label_pl : value,
      labelEn: typeof record.label_en === "string" ? record.label_en : value,
    });
  }
  return out;
}

function qualifyValueToText(input: Json): string {
  if (input === null || input === undefined) return "";
  if (Array.isArray(input)) return input.map((entry) => String(entry)).join("\n");
  if (typeof input === "object") return "";
  return String(input);
}

export function fieldDraftFromRow(row: EventRegistrationFieldRow): RegistrationFieldDraft {
  return {
    id: row.id,
    key: row.key,
    fieldType: row.field_type as RegistrationFieldType,
    labelPl: row.label_pl,
    labelEn: row.label_en,
    helpPl: row.help_pl ?? "",
    helpEn: row.help_en ?? "",
    isRequired: row.is_required,
    options: optionsFromJson(row.options),
    isQualifying: row.is_qualifying,
    qualifyOperator: row.qualify_operator as QualifyOperator,
    qualifyValue: qualifyValueToText(row.qualify_value),
    qualifyOutcome: row.qualify_outcome as QualifyOutcome,
    isActive: row.is_active,
    sortOrder: String(row.sort_order ?? 100),
  };
}

export type FieldDraftField =
  | "key"
  | "labelPl"
  | "labelEn"
  | "helpPl"
  | "helpEn"
  | "options"
  | "qualifyOperator"
  | "qualifyValue"
  | "sortOrder";

export interface FieldDraftIssue {
  field: FieldDraftField;
  errorKey: string;
}

export function fieldDraftIssue(draft: RegistrationFieldDraft): FieldDraftIssue | null {
  if (draft.id === null && !FIELD_KEY_PATTERN.test(draft.key.trim())) {
    return { field: "key", errorKey: "invalidKey" };
  }
  if (draft.labelPl.trim() === "") return { field: "labelPl", errorKey: "invalidLabels" };
  if (draft.labelEn.trim() === "") return { field: "labelEn", errorKey: "invalidLabels" };
  if (draft.labelPl.trim().length > FIELD_MAX_LABEL) {
    return { field: "labelPl", errorKey: "invalidLabels" };
  }
  if (draft.labelEn.trim().length > FIELD_MAX_LABEL) {
    return { field: "labelEn", errorKey: "invalidLabels" };
  }
  if (draft.helpPl.length > FIELD_MAX_HELP) return { field: "helpPl", errorKey: "invalidRequest" };
  if (draft.helpEn.length > FIELD_MAX_HELP) return { field: "helpEn", errorKey: "invalidRequest" };

  const options = draft.options.filter((option) => option.value.trim() !== "");
  if (FIELD_TYPES_WITH_OPTIONS.includes(draft.fieldType) && options.length === 0) {
    return { field: "options", errorKey: "invalidOptions" };
  }
  const values = options.map((option) => option.value.trim());
  if (new Set(values).size !== values.length) {
    return { field: "options", errorKey: "duplicateKey" };
  }
  if (options.some((option) => option.labelPl.trim() === "" || option.labelEn.trim() === "")) {
    return { field: "options", errorKey: "invalidOptions" };
  }

  if (draft.isQualifying) {
    if (draft.qualifyOperator === "none") {
      return { field: "qualifyOperator", errorKey: "invalidRequest" };
    }
    if (
      !OPERATORS_WITHOUT_VALUE.includes(draft.qualifyOperator) &&
      draft.qualifyValue.trim() === ""
    ) {
      return { field: "qualifyValue", errorKey: "invalidRequest" };
    }
  }

  if (!/^\d+$/.test(draft.sortOrder.trim())) {
    return { field: "sortOrder", errorKey: "invalidRequest" };
  }
  return null;
}

/** Wartość warunku w postaci, w jakiej SQL ją porównuje. */
export function qualifyValueJson(draft: RegistrationFieldDraft): Json {
  if (!draft.isQualifying) return null;
  if (OPERATORS_WITHOUT_VALUE.includes(draft.qualifyOperator)) return null;
  const lines = draft.qualifyValue
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (OPERATORS_WITH_LIST.includes(draft.qualifyOperator)) return lines;
  // Liczby porównujemy jako liczby - `gte`/`lte` na napisie porównałoby
  // leksykograficznie i „9" byłoby większe od „10".
  const single = lines[0] ?? "";
  if (/^-?\d+(\.\d+)?$/.test(single)) return Number(single);
  return single;
}

export function fieldDraftToInput(
  draft: RegistrationFieldDraft,
  eventId: string,
): RegistrationFieldInput {
  const options = draft.options
    .filter((option) => option.value.trim() !== "")
    .map((option) => ({
      value: option.value.trim(),
      label_pl: option.labelPl.trim(),
      label_en: option.labelEn.trim(),
    }));
  return {
    id: draft.id,
    eventId,
    key: draft.key.trim(),
    fieldType: draft.fieldType,
    labelPl: draft.labelPl.trim(),
    labelEn: draft.labelEn.trim(),
    helpPl: draft.helpPl.trim(),
    helpEn: draft.helpEn.trim(),
    isRequired: draft.isRequired,
    // Typ bez wariantów wysyła pustą tablicę, a nie „zostaw jak było": zmiana
        // listy na tekst musi zabrać ze sobą osierocone warianty.
    options: (FIELD_TYPES_WITH_OPTIONS.includes(draft.fieldType) ? options : []) as unknown as Json,
    sortOrder: Number(draft.sortOrder.trim()),
    isQualifying: draft.isQualifying,
    qualifyOperator: draft.isQualifying ? draft.qualifyOperator : "none",
    qualifyValue: qualifyValueJson(draft),
    qualifyOutcome: draft.qualifyOutcome,
    isActive: draft.isActive,
  };
}
