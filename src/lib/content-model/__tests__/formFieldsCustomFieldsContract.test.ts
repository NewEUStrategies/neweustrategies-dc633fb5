import { describe, expect, it } from "vitest";
import {
  collectCustomValues,
  parseCustomFields,
  pickLabel,
  pickPlaceholder,
  readI18nOverride,
  validateCustom,
  type CustomField,
} from "@/lib/content-model/formFields";
import { CONTACT_FIELD_LIMITS } from "@/lib/forms/contactLimits";

// Pola własne formularzy (kontakt, newsletter, rejestracja) redakcja wpisuje
// w panelu jako JSON - po jednym obiekcie na linię. `parseCustomFields` jest
// jedyną bramką między tym tekstem a formularzem, który widzi czytelnik:
// zła linia nie może wywrócić formularza, duplikat id nie może nadpisać
// odpowiedzi, a limit długości nie może przekroczyć limitu zapisu w CRM
// (AGENTS.md: limity wspólne dla klienta, serwera i liczników; wartości za
// długie są ODRZUCANE, nigdy przycinane). `formMessageLimits.test.ts` dowodzi
// samej granicy 500 znaków; tu - całej reszty kontraktu: parsowania, wyboru
// etykiet, zbierania wartości z FormData i walidacji.
// Moduł jest czysty; FormData pochodzi ze środowiska testowego (happy-dom).

describe("parseCustomFields - wejście z panelu", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["pusty string", ""],
    ["obiekt zamiast tablicy", { id: "x" }],
    ["liczba", 7],
  ])("%s daje pustą listę pól", (_l, raw) => {
    expect(parseCustomFields(raw)).toEqual([]);
  });

  it("czyta linie JSON i obiekty, pomija puste, zepsute i nie-obiektowe linie", () => {
    const fields = parseCustomFields([
      '{"id":"firma","type":"text","labelPl":"Firma"}',
      "   ",
      "{zepsuty json",
      '["tablica"]',
      "42",
      { id: "telefon", type: "tel" },
      ["a"],
      null,
    ]);
    expect(fields.map((f) => [f.id, f.type])).toEqual([
      ["firma", "text"],
      ["telefon", "tel"],
    ]);
  });

  it("pierwsze pole z danym id wygrywa - duplikat nie nadpisuje odpowiedzi", () => {
    const fields = parseCustomFields([
      { id: "a", labelPl: "Pierwsze" },
      { id: "a", labelPl: "Drugie" },
    ]);
    expect(fields).toHaveLength(1);
    expect(fields[0].labelPl).toBe("Pierwsze");
  });

  it("pole bez id (lub z samych spacji) jest pomijane", () => {
    expect(parseCustomFields([{ type: "text" }, { id: "   " }, { id: 5 }])).toEqual([]);
  });

  it("typ jest normalizowany do małych liter, a nieznany degraduje do text", () => {
    const fields = parseCustomFields([
      { id: "a", type: "EMAIL" },
      { id: "b", type: "date" },
      { id: "c", type: 3 },
    ]);
    expect(fields.map((f) => f.type)).toEqual(["email", "text", "text"]);
  });

  it.each([
    [true, true],
    ["1", true],
    ["true", true],
    [false, false],
    ["0", false],
    ["yes", false],
    [undefined, false],
  ])("required %j -> %s", (required, expected) => {
    expect(parseCustomFields([{ id: "a", required }])[0].required).toBe(expected);
  });

  it("etykiety są przycięte, puste znikają, a id ograniczone do 64 znaków", () => {
    const [field] = parseCustomFields([
      { id: `${"i".repeat(70)}`, labelPl: "  Firma  ", labelEn: "   ", placeholderPl: 5 },
    ]);
    expect(field.id).toHaveLength(64);
    expect(field.labelPl).toBe("Firma");
    expect(field.labelEn).toBeUndefined();
    expect(field.placeholderPl).toBeUndefined();
  });

  it("opcje listy: tylko obiekty z niepustą wartością, etykiety opcjonalne", () => {
    const [field] = parseCustomFields([
      {
        id: "temat",
        type: "select",
        options: [
          { value: "a", labelPl: "A pl", labelEn: "A en" },
          { value: "  " },
          null,
          "luźny napis",
          { value: "b" },
        ],
      },
    ]);
    expect(field.options).toEqual([
      { value: "a", labelPl: "A pl", labelEn: "A en" },
      { value: "b", labelPl: undefined, labelEn: undefined },
    ]);
  });

  it("opcje bez żadnej poprawnej pozycji (albo nie-tablica) dają brak opcji", () => {
    const fields = parseCustomFields([
      { id: "a", options: [{ value: "" }] },
      { id: "b", options: "a,b" },
    ]);
    expect(fields.map((f) => f.options)).toEqual([undefined, undefined]);
  });

  it.each([
    [120.9, 120],
    [0, 1],
    [-10, 1],
    [CONTACT_FIELD_LIMITS.custom + 1000, CONTACT_FIELD_LIMITS.custom],
  ])("maxLength %s domyka się do [1, limit zapisu] -> %s", (maxLength, expected) => {
    expect(parseCustomFields([{ id: "a", maxLength }])[0].maxLength).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, "200", null])(
    "maxLength %j nie-liczbowy jest ignorowany (obowiązuje limit zapisu)",
    (maxLength) => {
      expect(parseCustomFields([{ id: "a", maxLength }])[0].maxLength).toBeUndefined();
    },
  );
});

describe("readI18nOverride / pickLabel / pickPlaceholder - wybór języka", () => {
  it("override w bieżącym języku wygrywa, pusty spada na drugi język, potem na domyślny", () => {
    const cfg = { nameLabel_pl: "Imię", nameLabel_en: "  ", emailLabel_en: "E-mail" };
    expect(readI18nOverride(cfg, "nameLabel", "pl", "Domyślne")).toBe("Imię");
    expect(readI18nOverride(cfg, "nameLabel", "en", "Default")).toBe("Imię");
    expect(readI18nOverride(cfg, "emailLabel", "pl", "Domyślne")).toBe("E-mail");
    expect(readI18nOverride(cfg, "phoneLabel", "pl", "Telefon")).toBe("Telefon");
    expect(readI18nOverride({ x_pl: 5 }, "x", "pl", "fallback")).toBe("fallback");
  });

  const field = (patch: Partial<CustomField>): CustomField => ({
    id: "nip",
    type: "text",
    ...patch,
  });

  it("pickLabel: bieżący język -> drugi język -> id pola", () => {
    expect(pickLabel(field({ labelPl: "NIP", labelEn: "Tax ID" }), "en")).toBe("Tax ID");
    expect(pickLabel(field({ labelPl: "NIP" }), "en")).toBe("NIP");
    expect(pickLabel(field({ labelEn: "Tax ID" }), "pl")).toBe("Tax ID");
    expect(pickLabel(field({}), "pl")).toBe("nip");
  });

  it("pickPlaceholder: bieżący język -> drugi język -> brak", () => {
    expect(pickPlaceholder(field({ placeholderPl: "123", placeholderEn: "abc" }), "pl")).toBe(
      "123",
    );
    expect(pickPlaceholder(field({ placeholderPl: "123" }), "en")).toBe("123");
    expect(pickPlaceholder(field({}), "en")).toBe("");
  });
});

describe("collectCustomValues - wartości z FormData", () => {
  const fields = parseCustomFields([
    { id: "firma", type: "text" },
    { id: "zgoda", type: "checkbox" },
    { id: "uwagi", type: "textarea" },
    { id: "brak", type: "text" },
  ]);

  it("przycina tekst, zaznaczony checkbox zapisuje jako '1' i pomija puste pola", () => {
    const fd = new FormData();
    fd.set("custom_firma", "  ACME  ");
    fd.set("custom_zgoda", "on");
    fd.set("custom_uwagi", "   ");
    expect(collectCustomValues(fields, fd)).toEqual({ firma: "ACME", zgoda: "1" });
  });

  it("checkbox z wartością inną niż 'on' (manipulacja) liczy się jako niezaznaczony", () => {
    const fd = new FormData();
    fd.set("custom_zgoda", "1");
    expect(collectCustomValues(fields, fd)).toEqual({});
  });

  it("plik zamiast tekstu nie trafia do wartości jako [object File]", () => {
    const fd = new FormData();
    fd.set("custom_firma", new File(["x"], "a.txt"));
    expect(collectCustomValues(fields, fd)).toEqual({});
  });
});

describe("validateCustom - wymagane i limit długości", () => {
  const fields = parseCustomFields([
    { id: "wymagane", required: true },
    { id: "krotkie", maxLength: 5 },
    { id: "opcjonalne" },
  ]);

  it("puste pole wymagane dostaje komunikat, opcjonalne nie", () => {
    expect(validateCustom(fields, {}, "Wymagane")).toEqual({ wymagane: "Wymagane" });
  });

  it("za długa wartość dostaje komunikat długości (domyślnie ten sam tekst)", () => {
    expect(validateCustom(fields, { wymagane: "x", krotkie: "123456" }, "Błąd")).toEqual({
      krotkie: "Błąd",
    });
    expect(
      validateCustom(fields, { wymagane: "x", krotkie: "123456" }, "Wymagane", "Za długie"),
    ).toEqual({ krotkie: "Za długie" });
  });

  it("wartość równa limitowi pola jest poprawna", () => {
    expect(validateCustom(fields, { wymagane: "x", krotkie: "12345" }, "Błąd")).toEqual({});
  });

  it("pole bez maxLength podlega limitowi zapisu", () => {
    const over = "x".repeat(CONTACT_FIELD_LIMITS.custom + 1);
    expect(validateCustom(fields, { wymagane: "x", opcjonalne: over }, "W", "Za długie")).toEqual({
      opcjonalne: "Za długie",
    });
  });
});
