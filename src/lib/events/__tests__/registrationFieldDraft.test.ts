// Szkic pola formularza: warianty odpowiedzi i reguła kwalifikacji.
//
// Najgroźniejszy przypadek nie jest odmową bazy, a regułą, która NIGDY się nie
// spełnia: operator `in` porównuje z tablicą, więc wysłany napis daje bramkę,
// która wygląda na działającą i przepuszcza wszystkich. Drugi to `gte` na
// napisie - porównanie leksykograficzne, w którym „9" jest większe od „10".
import { describe, expect, it } from "vitest";
import {
  emptyFieldDraft,
  fieldDraftFromRow,
  fieldDraftIssue,
  fieldDraftToInput,
  qualifyValueJson,
  type RegistrationFieldDraft,
} from "@/lib/events/registrationFieldDraft";
import type { EventRegistrationFieldRow } from "@/lib/events/registrationsApi";

function valid(overrides: Partial<RegistrationFieldDraft> = {}): RegistrationFieldDraft {
  return {
    ...emptyFieldDraft(100),
    key: "sector",
    labelPl: "Sektor",
    labelEn: "Sector",
    ...overrides,
  };
}

const option = (value: string) => ({ value, labelPl: value, labelEn: value });

describe("fieldDraftIssue", () => {
  it("poprawne pole tekstowe przechodzi bez wariantów", () => {
    expect(fieldDraftIssue(valid())).toBeNull();
  });

  it("etykieta jest wymagana w obu językach", () => {
    expect(fieldDraftIssue(valid({ labelPl: " " }))?.errorKey).toBe("invalidLabels");
    expect(fieldDraftIssue(valid({ labelEn: "" }))?.field).toBe("labelEn");
  });

  it("lista bez wariantów nie przechodzi, tekst z wariantami tak", () => {
    expect(fieldDraftIssue(valid({ fieldType: "select" }))).toEqual({
      field: "options",
      errorKey: "invalidOptions",
    });
    expect(
      fieldDraftIssue(valid({ fieldType: "multiselect", options: [option("energy")] })),
    ).toBeNull();
  });

  it("zduplikowana wartość wariantu jest odmową, nie cichym scaleniem", () => {
    const issue = fieldDraftIssue(
      valid({ fieldType: "select", options: [option("a"), option(" a ")] }),
    );
    expect(issue).toEqual({ field: "options", errorKey: "duplicateKey" });
  });

  it("wariant bez etykiety w jednym języku nie przechodzi", () => {
    const issue = fieldDraftIssue(
      valid({ fieldType: "select", options: [{ value: "a", labelPl: "A", labelEn: "" }] }),
    );
    expect(issue?.errorKey).toBe("invalidOptions");
  });

  it("pole kwalifikujące wymaga operatora i wartości - poza operatorami bez wartości", () => {
    expect(fieldDraftIssue(valid({ isQualifying: true }))?.field).toBe("qualifyOperator");
    expect(fieldDraftIssue(valid({ isQualifying: true, qualifyOperator: "equals" }))?.field).toBe(
      "qualifyValue",
    );
    expect(
      fieldDraftIssue(valid({ isQualifying: true, qualifyOperator: "is_true" })),
    ).toBeNull();
    expect(
      fieldDraftIssue(valid({ isQualifying: true, qualifyOperator: "not_empty" })),
    ).toBeNull();
  });
});

describe("qualifyValueJson", () => {
  it("operatory listowe dostają tablicę, nie napis z nowymi liniami", () => {
    const value = qualifyValueJson(
      valid({ isQualifying: true, qualifyOperator: "in", qualifyValue: "energy\n rail \n" }),
    );
    expect(value).toEqual(["energy", "rail"]);
  });

  it("operator porównania liczbowego dostaje liczbę, nie napis", () => {
    expect(
      qualifyValueJson(valid({ isQualifying: true, qualifyOperator: "gte", qualifyValue: "10" })),
    ).toBe(10);
    expect(
      qualifyValueJson(valid({ isQualifying: true, qualifyOperator: "equals", qualifyValue: "PL" })),
    ).toBe("PL");
  });

  it("operator bez wartości i pole niekwalifikujące dają null", () => {
    expect(
      qualifyValueJson(
        valid({ isQualifying: true, qualifyOperator: "is_false", qualifyValue: "cokolwiek" }),
      ),
    ).toBeNull();
    expect(qualifyValueJson(valid({ qualifyValue: "PL" }))).toBeNull();
  });
});

describe("fieldDraftToInput", () => {
  it("zmiana typu z listy na tekst zabiera osierocone warianty", () => {
    const input = fieldDraftToInput(valid({ fieldType: "text", options: [option("a")] }), "e-1");
    expect(input.options).toEqual([]);
  });

  it("warianty jadą w kształcie, który czyta front publiczny", () => {
    const input = fieldDraftToInput(
      valid({ fieldType: "select", options: [{ value: "eu", labelPl: "UE", labelEn: "EU" }] }),
      "e-1",
    );
    expect(input.options).toEqual([{ value: "eu", label_pl: "UE", label_en: "EU" }]);
  });

  it("wyłączona kwalifikacja zeruje operator, żeby CHECK bazy nie odmówił", () => {
    const input = fieldDraftToInput(
      valid({ isQualifying: false, qualifyOperator: "equals", qualifyValue: "PL" }),
      "e-1",
    );
    expect(input.qualifyOperator).toBe("none");
    expect(input.qualifyValue).toBeNull();
  });
});

describe("fieldDraftFromRow", () => {
  const row = {
    id: "f-1",
    key: "sector",
    field_type: "select",
    label_pl: "Sektor",
    label_en: "Sector",
    help_pl: "",
    help_en: "",
    is_required: true,
    options: [{ value: "eu", label_pl: "UE", label_en: "EU" }, "legacy"],
    is_qualifying: true,
    qualify_operator: "in",
    qualify_value: ["eu", "legacy"],
    qualify_outcome: "auto_approve",
    is_active: true,
    sort_order: 30,
  } as unknown as EventRegistrationFieldRow;

  it("czyta warianty obiektowe i historyczne napisy", () => {
    const draft = fieldDraftFromRow(row);
    expect(draft.options).toEqual([
      { value: "eu", labelPl: "UE", labelEn: "EU" },
      { value: "legacy", labelPl: "legacy", labelEn: "legacy" },
    ]);
    expect(draft.qualifyValue).toBe("eu\nlegacy");
    expect(draft.qualifyOutcome).toBe("auto_approve");
  });

  it("brak wariantów i null w regule nie wysypują formularza", () => {
    const draft = fieldDraftFromRow({
      ...row,
      options: null,
      qualify_value: null,
    } as unknown as EventRegistrationFieldRow);
    expect(draft.options).toEqual([]);
    expect(draft.qualifyValue).toBe("");
  });
});
